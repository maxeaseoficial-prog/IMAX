const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { execFile } = require("node:child_process");
const { TerminalManager } = require("./terminal-manager.cjs");
const { Orchestrator } = require("./orchestrator.cjs");
const { AppState } = require("./state.cjs");
const { PreviewManager } = require("./preview-manager.cjs");

const { BrowserBridge } = require("./browser-bridge.cjs");
const browserHandlers = new Map();
let browserBridge = null;
let bridgeStarting = null;
function handle(channel, callback) {
  browserHandlers.set(channel, callback);
  ipcMain.handle(channel, callback);
}

app.setName("IMx");

let mainWindow = null;
let terminalManager = null;
let orchestrator = null;
let state = null;
let previewManager = null;
let runtime = {
  baseEnv: { ...process.env },
  codexPath: null,
  codexVersion: null,
  shell: process.env.SHELL || "/bin/zsh"
};

function runShell(command) {
  const loginShell = process.env.SHELL || "/bin/zsh";
  return new Promise((resolve) => {
    execFile(loginShell, ["-lc", command], { env: process.env, encoding: "utf8" }, (error, stdout) => {
      resolve(error ? "" : String(stdout || "").trim());
    });
  });
}

function execText(file, args, env) {
  return new Promise((resolve) => {
    if (!file) return resolve("");
    execFile(file, args, { env, encoding: "utf8" }, (error, stdout) => {
      resolve(error ? "" : String(stdout || "").trim());
    });
  });
}

async function detectRuntime() {
  const loginPath = await runShell('printf "%s" "$PATH"');
  const codexPath = await runShell("command -v codex");
  const shellPath = await runShell('printf "%s" "$SHELL"');

  runtime.baseEnv = {
    ...process.env,
    PATH: loginPath || process.env.PATH || ""
  };
  runtime.codexPath = codexPath || null;
  runtime.shell = shellPath || process.env.SHELL || "/bin/zsh";
  runtime.codexVersion = runtime.codexPath
    ? await execText(runtime.codexPath, ["--version"], runtime.baseEnv)
    : null;
}

function send(channel, payload) {
  browserBridge?.broadcast(channel, payload);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function ensureWorkspace(cwd) {
  if (!cwd || typeof cwd !== "string") throw new Error("Workspace inválido.");
  const stat = fs.statSync(cwd);
  if (!stat.isDirectory()) throw new Error("O workspace precisa ser uma pasta.");
  return cwd;
}

function ensureProjectWorkspace(cwd) {
  const selected = fs.realpathSync(ensureWorkspace(cwd));
  const appRoot = fs.realpathSync(path.join(__dirname, ".."));
  if (selected === appRoot || selected.startsWith(appRoot + path.sep) || appRoot.startsWith(selected + path.sep)) {
    throw new Error("Escolha uma pasta do seu projeto fora da pasta do IMx. Isso protege o aplicativo de alterações da missão.");
  }
  return selected;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#05070b",
    title: "IMx",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function wireTerminalEvents() {
  terminalManager.on("created", (payload) => send("terminal:created", payload));
  terminalManager.on("data", (payload) => send("terminal:data", payload));
  terminalManager.on("status", (payload) => send("terminal:status", payload));
  terminalManager.on("exit", (payload) => send("terminal:exit", payload));
}

function registerIpc() {
  ipcMain.handle("browser:open", async () => {
    if (!browserBridge) {
      if (!bridgeStarting) bridgeStarting = new BrowserBridge({ handlers: browserHandlers }).start();
      try { browserBridge = await bridgeStarting; }
      catch (error) { bridgeStarting = null; throw new Error("Não foi possível abrir a ponte local (porta 47831): " + error.message); }
    }
    await shell.openExternal("https://imax-two.vercel.app/#pair=" + browserBridge.token);
    return true;
  });
  ipcMain.handle("browser:stop", () => {
    browserBridge?.close(); browserBridge = null; bridgeStarting = null; return true;
  });
  handle("system:status", async () => ({
    codexFound: Boolean(runtime.codexPath),
    codexPath: runtime.codexPath,
    codexVersion: runtime.codexVersion,
    shell: runtime.shell,
    platform: process.platform,
    arch: process.arch
  }));

  handle("workspace:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Escolha o workspace do IMx",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    state.setSettings({ workspace: result.filePaths[0] });
    return result.filePaths[0];
  });

  handle("attachments:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Anexar arquivos à missão",
      properties: ["openFile", "multiSelections"]
    });

    if (result.canceled) return [];

    return result.filePaths.slice(0, 20).map((filePath) => {
      let size = 0;
      try {
        size = fs.statSync(filePath).size;
      } catch {}

      return {
        path: filePath,
        name: path.basename(filePath),
        size
      };
    });
  });

  handle("settings:get", () => state.getSettings());
  handle("settings:set", (_event, patch) => state.setSettings(patch || {}));
  handle("missions:list", () => state.listMissions());
  handle("mission:create", (_event, input = {}) => {
    const cwd = ensureProjectWorkspace(input.cwd);
    return orchestrator.createMission({ ...input, cwd });
  });
  handle("mission:rename", (_event, { id, name }) => orchestrator.renameMission(id, name));
  handle("mission:delete", async (_event, id) => {
    const removed = orchestrator.deleteMission(id);
    await previewManager.stop(id);
    terminalManager.killMission(id, { forget: true });
    return removed;
  });
  handle("mission:preview", async (_event, id) => {
    const mission = orchestrator.getMission(id);
    if (!mission) throw new Error("Missão não encontrada.");
    if (mission.status !== "done") throw new Error("Conclua a missão antes de abrir o resultado.");
    ensureProjectWorkspace(mission.resultPath || mission.cwd);
    return previewManager.open(mission);
  });
  handle("terminal:list", () => terminalManager.list());
  handle("terminal:buffer", (_event, id) => terminalManager.getBuffer(id));

  handle("terminal:create", (_event, input = {}) => {
    const cwd = ensureWorkspace(input.cwd || state.getSettings().workspace);
    const kind = input.kind === "codex" ? "codex" : "shell";

    if (kind === "codex" && !runtime.codexPath) {
      throw new Error("Codex CLI não encontrado. Instale ou ajuste seu PATH.");
    }

    return terminalManager.create({
      title: input.title || (kind === "codex" ? "Codex" : "Terminal"),
      role: input.role || (kind === "codex" ? "Agente manual" : "Manual"),
      kind,
      cwd,
      command: kind === "codex" ? runtime.codexPath : runtime.shell,
      args: kind === "codex" ? [] : ["-l"],
      interactive: true,
      missionId: input.missionId || null
    });
  });

  handle("terminal:write", (_event, { id, data }) => terminalManager.write(id, data));
  handle("terminal:resize", (_event, { id, cols, rows }) => terminalManager.resize(id, cols, rows));
  handle("terminal:kill", (_event, id) => {
    const killed = terminalManager.kill(id);
    if (killed) { orchestrator.closeAgent(id); send("terminal:removed", { id }); }
    return killed;
  });

  handle("mission:start", async (_event, input = {}) => {
    const existing = input.missionId ? orchestrator.getMission(input.missionId) : null;
    const cwd = ensureProjectWorkspace(existing?.resultPath || existing?.cwd || input.cwd || state.getSettings().workspace);
    if (existing) await previewManager.stop(existing.id);
    return orchestrator.startMission({ ...input, cwd });
  });

  handle("mission:cancel", (_event, missionId) => orchestrator.cancelMission(missionId));
  handle("mission:agent-instruction", (_event, { agentId, text }) =>
    orchestrator.sendAgentInstruction(agentId, text)
  );

  handle("path:open", async (_event, targetPath) => {
    if (!targetPath || !fs.existsSync(targetPath)) return false;
    const error = await shell.openPath(targetPath);
    return !error;
  });
}

app.whenReady().then(async () => {
  await detectRuntime();

  const userData = app.getPath("userData");
  state = new AppState(userData);

  terminalManager = new TerminalManager({
    logsDir: path.join(userData, "logs"),
    baseEnv: runtime.baseEnv
  });

  orchestrator = new Orchestrator({
    terminalManager,
    state,
    codexPath: runtime.codexPath,
    baseEnv: runtime.baseEnv,
    worktreesRoot: path.join(userData, "worktrees"),
    emit: (payload) => send("mission:event", payload)
  });

  previewManager = new PreviewManager({ baseEnv: runtime.baseEnv, openExternal: (url) => shell.openExternal(url) });

  wireTerminalEvents();
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});


let quitting = false;
app.on("before-quit", (event) => {
  if (quitting || !previewManager) return;
  event.preventDefault();
  quitting = true;
  browserBridge?.close();
  for (const mission of orchestrator.missions.values()) orchestrator.cancelMission(mission.id);
  for (const terminal of terminalManager.list()) terminalManager.kill(terminal.id, { forget: false });
  previewManager.dispose().finally(() => app.quit());
});

