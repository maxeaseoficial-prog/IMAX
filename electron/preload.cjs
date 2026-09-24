const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("imx", {
  getSystemStatus: () => ipcRenderer.invoke("system:status"),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  listMissions: () => ipcRenderer.invoke("missions:list"),
  listTerminals: () => ipcRenderer.invoke("terminal:list"),

  createTerminal: (input) => ipcRenderer.invoke("terminal:create", input),
  writeTerminal: (id, data) => ipcRenderer.invoke("terminal:write", { id, data }),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke("terminal:resize", { id, cols, rows }),
  killTerminal: (id) => ipcRenderer.invoke("terminal:kill", id),

  startMission: (input) => ipcRenderer.invoke("mission:start", input),
  cancelMission: (missionId) => ipcRenderer.invoke("mission:cancel", missionId),
  openPath: (targetPath) => ipcRenderer.invoke("path:open", targetPath),

  onTerminalCreated: (callback) => subscribe("terminal:created", callback),
  onTerminalData: (callback) => subscribe("terminal:data", callback),
  onTerminalStatus: (callback) => subscribe("terminal:status", callback),
  onTerminalExit: (callback) => subscribe("terminal:exit", callback),
  onMissionEvent: (callback) => subscribe("mission:event", callback)
});
