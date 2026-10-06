const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("imx", {
  openBrowser: () => ipcRenderer.invoke("browser:open"),
  stopBrowser: () => ipcRenderer.invoke("browser:stop"),
  getSystemStatus: () => ipcRenderer.invoke("system:status"),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  chooseAttachments: () => ipcRenderer.invoke("attachments:choose"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  listMissions: () => ipcRenderer.invoke("missions:list"),
  createMission: (input) => ipcRenderer.invoke("mission:create", input),
  renameMission: (id, name) => ipcRenderer.invoke("mission:rename", { id, name }),
  deleteMission: (id) => ipcRenderer.invoke("mission:delete", id),
  openMissionPreview: (id) => ipcRenderer.invoke("mission:preview", id),
  listTerminals: () => ipcRenderer.invoke("terminal:list"),
  getTerminalBuffer: (id) => ipcRenderer.invoke("terminal:buffer", id),

  createTerminal: (input) => ipcRenderer.invoke("terminal:create", input),
  writeTerminal: (id, data) => ipcRenderer.invoke("terminal:write", { id, data }),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke("terminal:resize", { id, cols, rows }),
  killTerminal: (id) => ipcRenderer.invoke("terminal:kill", id),

  startMission: (input) => ipcRenderer.invoke("mission:start", input),
  cancelMission: (missionId) => ipcRenderer.invoke("mission:cancel", missionId),
  sendAgentInstruction: (agentId, text) =>
    ipcRenderer.invoke("mission:agent-instruction", { agentId, text }),
  openPath: (targetPath) => ipcRenderer.invoke("path:open", targetPath),

  onTerminalRemoved: (callback) => subscribe("terminal:removed", callback),
  onTerminalCreated: (callback) => subscribe("terminal:created", callback),
  onTerminalData: (callback) => subscribe("terminal:data", callback),
  onTerminalStatus: (callback) => subscribe("terminal:status", callback),
  onTerminalExit: (callback) => subscribe("terminal:exit", callback),
  onMissionEvent: (callback) => subscribe("mission:event", callback)
});


