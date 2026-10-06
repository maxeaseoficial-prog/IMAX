const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" };

function responds(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 400);
    });
    request.setTimeout(1500, () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function projectAt(root) {
  for (const folder of ["", "frontend", "client", "web", "app"]) {
    const cwd = path.join(root, folder);
    const file = path.join(cwd, "package.json");
    if (!fs.existsSync(file)) continue;
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (pkg.scripts?.dev && (deps.vite || /\bvite\b/.test(pkg.scripts.dev))) return { cwd, pkg, kind: "vite" };
    if (pkg.scripts?.dev && (deps.next || /\bnext\b/.test(pkg.scripts.dev))) return { cwd, pkg, kind: "next" };
    if (pkg.scripts?.start && deps["react-scripts"]) return { cwd, pkg, kind: "cra" };
  }
  for (const folder of ["dist", "build", "", "frontend/dist", "client/dist"]) {
    const cwd = path.join(root, folder);
    if (fs.existsSync(path.join(cwd, "index.html"))) return { cwd, kind: "static" };
  }
  throw new Error("Não encontrei uma prévia web compatível. São suportados Vite, Next.js, React Scripts e sites HTML estáticos.");
}

function missingDependencies(project) {
  const requireFromProject = createRequire(path.join(project.cwd, "package.json"));
  const engine = { vite: "vite", next: "next", cra: "react-scripts" }[project.kind];
  const names = new Set([...Object.keys(project.pkg.dependencies || {}), ...Object.keys(project.pkg.devDependencies || {}), engine]);
  return [...names].filter((name) => {
    if (!name) return false;
    const installed = (requireFromProject.resolve.paths(name) || []).some((folder) => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(folder, name, "package.json"), "utf8"));
        return Boolean(pkg.name || pkg.version);
      } catch { return false; }
    });
    if (!installed) return true;
    if (name === engine) {
      try { requireFromProject.resolve(name); } catch { return true; }
    }
    return false;
  });
}

class PreviewManager {
  constructor({ baseEnv, openExternal }) {
    this.baseEnv = baseEnv;
    this.openExternal = openExternal;
    this.previews = new Map();
    this.pending = new Map();
  }

  async open(mission) {
    if (this.pending.has(mission.id)) return this.pending.get(mission.id);
    const pending = this.start(mission).finally(() => this.pending.delete(mission.id));
    this.pending.set(mission.id, pending);
    return pending;
  }

  async start(mission) {
    const root = mission.resultPath || mission.cwd;
    const previous = this.previews.get(mission.id);
    if (previous?.root === root && await responds(previous.url)) {
      await this.openExternal(previous.url);
      return { url: previous.url };
    }
    await this.stop(mission.id);
    const project = projectAt(root);
    const entry = { root, log: "", child: null, server: null, url: null, closed: false };
    this.previews.set(mission.id, entry);
    try {
      if (project.kind === "static") {
        const realRoot = fs.realpathSync(project.cwd);
        entry.server = http.createServer((req, res) => {
          try {
            const requested = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
            let target = path.resolve(realRoot, "." + requested);
            if (target !== realRoot && !target.startsWith(realRoot + path.sep)) { res.writeHead(403); res.end(); return; }
            if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
            if (!fs.existsSync(target) && !path.extname(requested)) target = path.join(realRoot, "index.html");
            if (!fs.existsSync(target)) { res.writeHead(404); res.end(); return; }
            const realTarget = fs.realpathSync(target);
            if (!realTarget.startsWith(realRoot + path.sep)) { res.writeHead(403); res.end(); return; }
            res.writeHead(200, { "Content-Type": MIME[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
            fs.createReadStream(realTarget).on("error", () => res.destroy()).pipe(res);
          } catch { res.writeHead(400); res.end(); }
        });
        await new Promise((resolve, reject) => {
          entry.server.once("error", reject);
          entry.server.listen(0, "127.0.0.1", resolve);
        });
        entry.url = "http://127.0.0.1:" + entry.server.address().port;
      } else {
        // A folder can exist after a partial install or an install omitting dev deps.
        // Resolve the project's dependencies, never rely on the IMx Vite in PATH.
        if (missingDependencies(project).length) {
          await new Promise((resolve, reject) => {
            const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--include=dev", "--no-audit", "--no-fund"], {
              cwd: project.cwd, env: this.baseEnv, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32"
            });
            entry.child = child;
            const timer = setTimeout(() => reject(new Error("A instalação das dependências ultrapassou 180 segundos.")), 180000);
            const output = (data) => { entry.log = (entry.log + data).slice(-12000); };
            child.stdout.on("data", output);
            child.stderr.on("data", output);
            child.once("error", (error) => { clearTimeout(timer); reject(error); });
            child.once("exit", (code) => {
              clearTimeout(timer);
              if (entry.closed) reject(new Error("Prévia cancelada."));
              else if (code === 0) resolve();
              else reject(new Error("Instalação das dependências falhou.\n" + entry.log));
            });
          });
          entry.child = null;
          entry.log = "";
        }
        if (entry.closed) throw new Error("Prévia cancelada.");
        const missing = missingDependencies(project);
        if (missing.length) throw new Error("Dependências ainda ausentes após npm install: " + missing.join(", ") + ". Confira dependencies/devDependencies do package.json deste projeto.");
        const port = await freePort();
        entry.url = "http://127.0.0.1:" + port;
        const args = project.kind === "vite"
          ? ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"]
          : project.kind === "next"
            ? ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)]
            : ["run", "start"];
        entry.child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, {
          cwd: project.cwd, env: { ...this.baseEnv, HOST: "127.0.0.1", PORT: String(port), BROWSER: "none" },
          stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32"
        });
        const output = (data) => { entry.log = (entry.log + data).slice(-12000); };
        entry.child.stdout.on("data", output);
        entry.child.stderr.on("data", output);
        entry.child.on("error", (error) => { entry.failure = error.message; });
        entry.child.on("exit", (code) => { entry.exited = true; entry.failure ||= "Servidor de prévia encerrado (código " + code + ")."; });
        const deadline = Date.now() + 60000;
        while (!entry.closed && Date.now() < deadline) {
          if (entry.failure || entry.exited) throw new Error(entry.failure + "\n" + entry.log);
          if (await responds(entry.url)) break;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        if (entry.closed) throw new Error("Prévia cancelada.");
        if (!await responds(entry.url)) throw new Error("A prévia não respondeu em 60 segundos.\n" + entry.log);
      }
      if (entry.closed) throw new Error("Prévia cancelada.");
      await this.openExternal(entry.url);
      return { url: entry.url };
    } catch (error) {
      await this.stop(mission.id);
      throw new Error("Não foi possível abrir a prévia. Confira as dependências e o comando de desenvolvimento do projeto. " + error.message);
    }
  }

  async stop(id) {
    const entry = this.previews.get(id);
    if (!entry) return;
    entry.closed = true;
    this.previews.delete(id);
    if (entry.server) await new Promise((resolve) => { entry.server.close(resolve); entry.server.closeAllConnections?.(); });
    if (entry.child?.pid && !entry.exited) {
      const signal = (name) => {
        try {
          if (process.platform !== "win32") process.kill(-entry.child.pid, name);
          else entry.child.kill(name);
        } catch {}
      };
      signal("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => { signal("SIGKILL"); resolve(); }, 1500);
        entry.child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
  }

  async dispose() {
    await Promise.all([...this.previews.keys()].map((id) => this.stop(id)));
  }
}

module.exports = { PreviewManager, projectAt, missingDependencies };
