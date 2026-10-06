const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const pty = require("node-pty");

function preserveTranscript(text) {
  return String(text).replace(/\u001b\[[0-3]?J|\u001bc|\u001b\[\?(?:47|1047|1049)[hl]|\u001b\[(?:1;1)?H/g, "");
}

function safeName(value) {
  return String(value || "terminal")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "terminal";
}

class TerminalManager extends EventEmitter {
  constructor({ logsDir, baseEnv }) {
    super();
    this.logsDir = logsDir;
    this.baseEnv = baseEnv;
    this.sessions = new Map();
    this.lastExits = new Map();
    this.lastBuffers = new Map();
    this.records = new Map();
    this.registryPath = path.join(this.logsDir, "terminals.json");
    fs.mkdirSync(this.logsDir, { recursive: true });
    try {
      for (const record of JSON.parse(fs.readFileSync(this.registryPath, "utf8"))) {
        if (["running", "starting", "waiting"].includes(record.status)) record.status = "stopped";
        this.records.set(record.id, record);
      }
    } catch {}
  }

  restoreAgent(record) {
    if (!record?.id || this.records.has(record.id) || !record.logPath) return false;
    const logPath = path.resolve(record.logPath);
    if (!logPath.startsWith(path.resolve(this.logsDir) + path.sep) || !fs.existsSync(logPath)) return false;
    this.records.set(record.id, { ...record, logPath, status: ["running", "starting", "waiting"].includes(record.status) ? "stopped" : record.status });
    this.saveRecords();
    return true;
  }

  saveRecords() {
    const tmp = this.registryPath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify([...this.records.values()], null, 2));
    fs.renameSync(tmp, this.registryPath);
  }

  create(input) {
    const id = input.id || crypto.randomUUID();
    if (this.sessions.has(id)) throw new Error("Este terminal já está executando um processo.");
    const previous = this.records.get(id);
    const cwd = input.cwd || process.cwd();
    const command = input.command || process.env.SHELL || "/bin/zsh";
    const args = Array.isArray(input.args) ? input.args : [];
    const startedAt = new Date().toISOString();

    const meta = {
      id,
      title: input.title || "Terminal",
      role: input.role || "Manual",
      kind: input.kind || "shell",
      status: "running",
      cwd,
      missionId: input.missionId || null,
      interactive: input.interactive !== false,
      startedAt
    };

    const logFolder = input.missionId
      ? path.join(this.logsDir, safeName(input.missionId))
      : path.join(this.logsDir, "manual");

    fs.mkdirSync(logFolder, { recursive: true });
    const logPath = previous?.logPath || path.join(logFolder, `${safeName(meta.title)}-${id.slice(0, 8)}.log`);
    const log = fs.createWriteStream(logPath, { flags: "a" });

    const env = {
      ...this.baseEnv,
      ...input.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      FORCE_COLOR: "1"
    };

    let proc;
    try {
      proc = pty.spawn(command, args, {
        name: "xterm-256color",
        cols: input.cols || 100,
        rows: input.rows || 30,
        cwd,
        env
      });
    } catch (error) {
      log.end();
      throw error;
    }

    let resolveExit;
    const exitPromise = new Promise((resolve) => {
      resolveExit = resolve;
    });

    const previousBuffer = this.getBuffer(id);
    const session = { proc, meta, log, logPath, exitPromise, resolveExit, buffer: previousBuffer };
    this.lastExits.delete(id);
    this.sessions.set(id, session);
    this.records.set(id, { ...meta, logPath });
    this.saveRecords();
    this.emit("created", { ...meta, logPath });

    proc.onData((data) => {
      if (meta.kind === "mission" && !meta.interactive) {
        data = (session.escapeTail || "") + data;
        const incomplete = data.match(/\u001b(?:\[[0-?]*[ -\/]*)?$/);
        session.escapeTail = incomplete?.[0] || "";
        if (incomplete) data = data.slice(0, -incomplete[0].length);
        data = preserveTranscript(data);
      }
      session.buffer = session.buffer + data;
      try {
        log.write(data);
      } catch {}
      this.emit("data", { id, data });
    });

    proc.onExit(({ exitCode, signal }) => {
      const status = session.closing ? "stopped" : exitCode === 0 ? "done" : "error";
      meta.status = status;
      const payload = { id, exitCode, signal, status, missionId: meta.missionId };
      this.lastExits.set(id, payload);
      if (session.forget) this.lastBuffers.delete(id);
      else this.lastBuffers.set(id, session.buffer);
      if (!session.forget) this.records.set(id, { ...meta, logPath });
      this.saveRecords();
      this.emit("status", { ...meta });
      this.emit("exit", payload);
      resolveExit(payload);
      this.sessions.delete(id);
      try {
        log.end();
      } catch {}
    });

    return { ...meta, logPath };
  }

  list() {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  getBuffer(id) {
    const session = this.sessions.get(id);
    const record = this.records.get(id);
    // Log writes are queued, so use the live buffer until the stream is flushed.
    if (session) return session.buffer;
    if (this.lastBuffers.has(id)) return this.lastBuffers.get(id);
    if (record?.logPath) {
      try { const text = fs.readFileSync(record.logPath, "utf8"); return record.kind === "mission" && !record.interactive ? preserveTranscript(text) : text; } catch {}
    }
    return this.lastBuffers.get(id) || "";
  }

  inject(id, data) {
    const text = String(data || "");
    if (!text) return false;
    const session = this.sessions.get(id);

    if (session) {
      session.buffer = session.buffer + text;
      try {
        session.log.write(text);
      } catch {}
    } else {
      const current = this.lastBuffers.get(id) || "";
      const record = this.records.get(id);
      if (record?.logPath) fs.appendFileSync(record.logPath, text);
      this.lastBuffers.set(id, current + text);
    }

    this.emit("data", { id, data: text });
    return true;
  }

  write(id, data) {
    const session = this.sessions.get(id);
    if (!session || session.meta.interactive === false) return false;
    session.proc.write(String(data));
    return true;
  }

  resize(id, cols, rows) {
    const session = this.sessions.get(id);
    if (!session) return false;
    const safeCols = Math.max(20, Math.floor(Number(cols) || 80));
    const safeRows = Math.max(5, Math.floor(Number(rows) || 24));
    try {
      session.proc.resize(safeCols, safeRows);
      return true;
    } catch {
      return false;
    }
  }

  kill(id, { forget = true } = {}) {
    const session = this.sessions.get(id);
    if (forget) { this.records.delete(id); this.saveRecords(); }
    if (!session) {
      if (forget) this.lastBuffers.delete(id);
      return true;
    }
    if (session.closing) return true;
    session.closing = true;
    session.forget = forget;
    try {
      session.proc.kill();
      return true;
    } catch {
      session.closing = false;
      if (forget) { this.records.set(id, { ...session.meta, logPath: session.logPath }); this.saveRecords(); }
      return false;
    }
  }

  killMission(missionId, { forget = false } = {}) {
    for (const [id, record] of this.records.entries()) {
      if (record.missionId === missionId) {
        this.kill(id, { forget });
      }
    }
  }

  waitForExit(id) {
    const session = this.sessions.get(id);
    if (session) return session.exitPromise;
    if (this.lastExits.has(id)) return Promise.resolve(this.lastExits.get(id));
    return Promise.resolve({ id, exitCode: -1, signal: 0, status: "error" });
  }
}

module.exports = { TerminalManager };

