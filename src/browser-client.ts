const BASE = "http://127.0.0.1:47831";
export async function connectBrowser(token: string, disconnected: () => void) {
  const callbacks = new Map<string, Set<(payload: any) => void>>();
  const controller = new AbortController();
  const request = (path: string, init: RequestInit = {}) => fetch(BASE + path, {
    ...init, signal: controller.signal, cache: "no-store", credentials: "omit",
    headers: {"Authorization": "Bearer " + token, ...init.headers},
    targetAddressSpace: "loopback"
  } as RequestInit);
  async function invoke(channel: string, ...args: any[]) {
    const response = await request("/rpc", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({channel,args})});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Ponte local indisponível.");
    return body.result;
  }
  function subscribe(channel: string, callback: (payload: any) => void) {
    if (!callbacks.has(channel)) callbacks.set(channel, new Set());
    callbacks.get(channel)!.add(callback);
    return () => { callbacks.get(channel)?.delete(callback); };
  }
  const stream = await request("/events");
  if (!stream.ok || !stream.body) { controller.abort(); throw Object.assign(new Error("Conexão recusada pelo IMAX."), {status:stream.status}); }
  const reader = stream.body.getReader();
  const api: Window["imx"] = {
  getSystemStatus: () => invoke("system:status"),
  chooseWorkspace: () => invoke("workspace:choose"),
  chooseAttachments: () => invoke("attachments:choose"),
  getSettings: () => invoke("settings:get"),
  setSettings: (patch) => invoke("settings:set", patch),
  listMissions: () => invoke("missions:list"),
  createMission: (input) => invoke("mission:create", input),
  renameMission: (id, name) => invoke("mission:rename", { id, name }),
  deleteMission: (id) => invoke("mission:delete", id),
  openMissionPreview: (id) => invoke("mission:preview", id),
  listTerminals: () => invoke("terminal:list"),
  getTerminalBuffer: (id) => invoke("terminal:buffer", id),

  createTerminal: (input) => invoke("terminal:create", input),
  writeTerminal: (id, data) => invoke("terminal:write", { id, data }),
  resizeTerminal: (id, cols, rows) => invoke("terminal:resize", { id, cols, rows }),
  killTerminal: (id) => invoke("terminal:kill", id),

  startMission: (input) => invoke("mission:start", input),
  cancelMission: (missionId) => invoke("mission:cancel", missionId),
  sendAgentInstruction: (agentId, text) =>
    invoke("mission:agent-instruction", { agentId, text }),
  openPath: (targetPath) => invoke("path:open", targetPath),

  onTerminalRemoved: (callback) => subscribe("terminal:removed", callback),
  onTerminalCreated: (callback) => subscribe("terminal:created", callback),
  onTerminalData: (callback) => subscribe("terminal:data", callback),
  onTerminalStatus: (callback) => subscribe("terminal:status", callback),
  onTerminalExit: (callback) => subscribe("terminal:exit", callback),
  onMissionEvent: (callback) => subscribe("mission:event", callback)
};
  // Register the UI subscriptions before consuming the stream.
  let stopped = false;
  let started = false;
  const consume = async () => {
    const decoder = new TextDecoder(); let pending = "";
    try {
      while (!stopped) {
        const {value, done} = await reader.read(); if (done) break;
        pending += decoder.decode(value, {stream:true});
        let end;
        while ((end = pending.indexOf("\n\n")) >= 0) {
          const frame = pending.slice(0,end); pending = pending.slice(end+2);
          if (!frame.startsWith("data: ")) continue;
          const {channel,payload} = JSON.parse(frame.slice(6));
          for (const cb of callbacks.get(channel) || []) cb(payload);
        }
      }
    } catch { /* The UI reports loss of connection; never replay commands. */ }
    finally { if (!stopped) { controller.abort(); disconnected(); } }
  };
  return {api, start: () => { if (!started) { started = true; void consume(); } }, close: () => { stopped = true; controller.abort(); callbacks.clear(); }};
}

let pairing: Promise<string> | null = null;
export function pairBrowser(): Promise<string> {
  if (!pairing) pairing = (async () => {
    const response = await fetch(BASE + "/pair", {
      method:"POST", headers:{"Content-Type":"application/json"}, body:"{}",
      credentials:"omit", cache:"no-store", signal:AbortSignal.timeout(120000), targetAddressSpace:"loopback"
    } as RequestInit);
    if (response.status === 401 || response.status === 404) throw new Error("Atualize e reinicie o IMAX no Mac para ativar a conexão automática.");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Autorize a conexão no aplicativo IMAX.");
    if (!/^[a-f0-9]{64}$/.test(body.token)) throw new Error("Resposta de pareamento inválida.");
    return body.token;
  })().finally(() => { pairing = null; });
  return pairing;
}
