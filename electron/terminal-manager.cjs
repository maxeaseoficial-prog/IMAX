const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const pty = require("node-pty");

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
    fs.mkdirSync(this.logsDir, { recursive: true });
  }

  create(input) {
    const id = input.id || crypto.randomUUID();
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
    const logPath = path.join(logFolder, `${safeName(meta.title)}-${id.slice(0, 8)}.log`);
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

    const previousBuffer = this.lastBuffers.get(id) || "";
    const session = { proc, meta, log, logPath, exitPromise, resolveExit, buffer: previousBuffer };
    this.lastExits.delete(id);
    this.sessions.set(id, session);
    this.emit("created", { ...meta, logPath });

    proc.onData((data) => {
      session.buffer = (session.buffer + data).slice(-120000);
      try {
        log.write(data);
      } catch {}
      this.emit("data", { id, data });
    });

    proc.onExit(({ exitCode, signal }) => {
      const status = exitCode === 0 ? "done" : "error";
      meta.status = status;
      const payload = { id, exitCode, signal, status, missionId: meta.missionId };
      this.lastExits.set(id, payload);
      this.lastBuffers.set(id, session.buffer);
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
    return Array.from(this.sessions.values()).map(({ meta, logPath }) => ({
      ...meta,
      logPath
    }));
  }

  getBuffer(id) {
    const session = this.sessions.get(id);
    if (session) return session.buffer;
    return this.lastBuffers.get(id) || "";
  }

  inject(id, data) {
    const text = String(data || "");
    if (!text) return false;
    const session = this.sessions.get(id);

    if (session) {
      session.buffer = (session.buffer + text).slice(-120000);
      try {
        session.log.write(text);
      } catch {}
    } else {
      const current = this.lastBuffers.get(id) || "";
      this.lastBuffers.set(id, (current + text).slice(-120000));
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

  kill(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    try {
      session.proc.kill();
      return true;
    } catch {
      return false;
    }
  }

  killMission(missionId) {
    for (const [id, session] of this.sessions.entries()) {
      if (session.meta.missionId === missionId) {
        this.kill(id);
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
