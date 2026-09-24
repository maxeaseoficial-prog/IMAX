const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { execFile } = require("node:child_process");
const { TerminalManager } = require("./terminal-manager.cjs");
const { Orchestrator } = require("./orchestrator.cjs");
const { AppState } = require("./state.cjs");

app.setName("IMx");

let mainWindow = null;
let terminalManager = null;
let orchestrator = null;
let state = null;
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
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function ensureWorkspace(cwd) {
  if (!cwd || typeof cwd !== "string") throw new Error("Workspace inválido.");
  const stat = fs.statSync(cwd);
  if (!stat.isDirectory()) throw new Error("O workspace precisa ser uma pasta.");
  return cwd;
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
  ipcMain.handle("system:status", async () => ({
    codexFound: Boolean(runtime.codexPath),
    codexPath: runtime.codexPath,
    codexVersion: runtime.codexVersion,
    shell: runtime.shell,
    platform: process.platform,
    arch: process.arch
  }));

  ipcMain.handle("workspace:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Escolha o workspace do IMx",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    state.setSettings({ workspace: result.filePaths[0] });
    return result.filePaths[0];
  });

  ipcMain.handle("attachments:choose", async () => {
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

  ipcMain.handle("settings:get", () => state.getSettings());
  ipcMain.handle("settings:set", (_event, patch) => state.setSettings(patch || {}));
  ipcMain.handle("missions:list", () => state.listMissions());
  ipcMain.handle("terminal:list", () => terminalManager.list());
  ipcMain.handle("terminal:buffer", (_event, id) => terminalManager.getBuffer(id));

  ipcMain.handle("terminal:create", (_event, input = {}) => {
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
      interactive: true
    });
  });

  ipcMain.handle("terminal:write", (_event, { id, data }) => terminalManager.write(id, data));
  ipcMain.handle("terminal:resize", (_event, { id, cols, rows }) => terminalManager.resize(id, cols, rows));
  ipcMain.handle("terminal:kill", (_event, id) => terminalManager.kill(id));

  ipcMain.handle("mission:start", (_event, input = {}) => {
    const cwd = ensureWorkspace(input.cwd || state.getSettings().workspace);
    return orchestrator.startMission({ ...input, cwd });
  });

  ipcMain.handle("mission:cancel", (_event, missionId) => orchestrator.cancelMission(missionId));
  ipcMain.handle("mission:agent-instruction", (_event, { agentId, text }) =>
    orchestrator.sendAgentInstruction(agentId, text)
  );

  ipcMain.handle("path:open", async (_event, targetPath) => {
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
