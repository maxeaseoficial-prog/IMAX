import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type {
  AgentMeta,
  Attachment,
  Mission,
  MissionEvent,
  Settings,
  SystemStatus
} from "./types";

const ACTIVE_STATUSES = new Set(["planning", "preparing", "running", "integrating", "reviewing"]);

function upsertAgent(list: AgentMeta[], next: AgentMeta) {
  const index = list.findIndex((item) => item.id === next.id);
  if (index === -1) return [...list, next];
  const copy = [...list];
  copy[index] = { ...copy[index], ...next };
  return copy;
}

function missionStatusLabel(status?: string) {
  const labels: Record<string, string> = {
    draft: "NOVA MISSÃO",
    interrupted: "INTERROMPIDA",
    planning: "PLANEJANDO",
    preparing: "PREPARANDO",
    running: "EM EXECUÇÃO",
    integrating: "INTEGRANDO",
    reviewing: "REVISANDO",
    done: "CONCLUÍDA",
    blocked: "BLOQUEADA",
    error: "ERRO",
    canceled: "CANCELADA"
  };
  return labels[status || ""] || String(status || "AGUARDANDO").toUpperCase();
}

function agentStatusLabel(status?: string) {
  const labels: Record<string, string> = {
    idle: "IDLE",
    starting: "INICIANDO",
    running: "RODANDO",
    waiting: "AGUARDANDO",
    done: "PRONTO",
    error: "ERRO",
    stopped: "PARADO"
  };
  return labels[status || ""] || String(status || "IDLE").toUpperCase();
}

function shortPath(value?: string) {
  if (!value) return "nenhum workspace";
  const parts = value.split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : value;
}

function TerminalPane({
  agent,
  canSendInstruction,
  onClose
}: {
  agent: AgentMeta;
  canSendInstruction: boolean;
  onClose: (id: string) => Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [instruction, setInstruction] = useState("");
  const [sending, setSending] = useState(false);
  const [instructionState, setInstructionState] = useState("");

  const sendInstruction = async () => {
    const text = instruction.trim();
    if (!text || sending) return;

    setSending(true);
    setInstructionState("");

    try {
      const result = await window.imx.sendAgentInstruction(agent.id, text);
      setInstruction("");
      setInstructionState(`Enfileirada · posição ${result.position}`);
    } catch (error) {
      setInstructionState(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!hostRef.current) return;

    const terminal = new Terminal({
      cursorBlink: agent.interactive,
      cursorStyle: "bar",
      convertEol: true,
      fontFamily: '"SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.26,
      letterSpacing: 0.1,
      scrollback: 8000,
      theme: {
        background: "#070b12",
        foreground: "#dcecff",
        cursor: "#33b7ff",
        cursorAccent: "#06111d",
        selectionBackground: "#153a5d",
        black: "#101721",
        brightBlack: "#52657d",
        blue: "#2698ff",
        brightBlue: "#5bc8ff",
        cyan: "#22d3ee",
        brightCyan: "#67e8f9",
        green: "#67d9b0",
        brightGreen: "#8ce6c4",
        yellow: "#f0c96b",
        brightYellow: "#ffe09a",
        red: "#ff6b7a",
        brightRed: "#ff93a0",
        magenta: "#9aa8ff",
        brightMagenta: "#bdc5ff",
        white: "#dcecff",
        brightWhite: "#ffffff"
      }
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);

    let disposed = false;
    void window.imx.getTerminalBuffer(agent.id).then((buffer) => {
      if (!disposed && buffer) terminal.write(buffer);
    });

    const fit = () => {
      try {
        fitAddon.fit();
        void window.imx.resizeTerminal(agent.id, terminal.cols, terminal.rows);
      } catch {}
    };

    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(hostRef.current);

    const unsubscribeData = window.imx.onTerminalData(({ id, data }) => {
      if (id === agent.id) terminal.write(data);
    });

    const inputDisposable = terminal.onData((data) => {
      if (agent.interactive) void window.imx.writeTerminal(agent.id, data);
    });

    requestAnimationFrame(fit);

    return () => {
      disposed = true;
      unsubscribeData();
      inputDisposable.dispose();
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, [agent.id, agent.interactive]);

  return (
    <article className="agent-card">
      <header className="agent-card__head">
        <div className="agent-identity">
          <span className={`agent-dot agent-dot--${agent.status}`} />
          <div>
            <strong>{agent.title}</strong>
            <span>{agent.role}</span>
          </div>
        </div>

        <div className="agent-actions">
          <span className={`status-badge status-badge--${agent.status}`}>
            {agentStatusLabel(agent.status)}
          </span>
          <button
            className="icon-button"
            title="Encerrar terminal"
            onClick={() => void onClose(agent.id)}
          >
            ×
          </button>
        </div>
      </header>

      <div className="agent-meta">
        <span>{shortPath(agent.cwd)}</span>
        {agent.branch ? <span>{agent.branch}</span> : <span>{agent.kind}</span>}
      </div>

      <div ref={hostRef} className="terminal-host" />

      {agent.kind === "mission" ? (
        <div className="agent-command">
          <div className="agent-command__row">
            <input
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendInstruction();
                }
              }}
              placeholder={
                canSendInstruction
                  ? "Enviar uma instrução só para este agente…"
                  : "Este agente não está aceitando novas instruções"
              }
              disabled={!canSendInstruction || sending}
            />
            <button
              onClick={() => void sendInstruction()}
              disabled={!canSendInstruction || sending || !instruction.trim()}
            >
              {sending ? "…" : "ENVIAR"}
            </button>
          </div>
          <span className="agent-command__hint">
            {instructionState || "Você pode enviar enquanto ele trabalha; a instrução entra na fila deste agente."}
          </span>
        </div>
      ) : null}
    </article>
  );
}

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [settings, setSettings] = useState<Settings>({
    workspace: "",
    agentCount: 4,
    autoEdit: true
  });
  const [brief, setBrief] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mission, setMission] = useState<Mission | null>(null);
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const closedTerminals = useRef(new Set<string>());
  const [history, setHistory] = useState<Mission[]>([]);
  const [pilotLog, setPilotLog] = useState("");
  const [notice, setNotice] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const selectedMissionId = useRef<string | null>(null);
  const drafts = useRef(new Map<string, { brief: string; attachments: Attachment[] }>());
  const currentDraft = useRef({ brief, attachments });
  currentDraft.current = { brief, attachments };
  const [pilotLogs, setPilotLogs] = useState<Record<string, string>>({});
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [modal, setModal] = useState<{ type: "new" | "rename" | "delete"; id?: string } | null>(null);
  const [missionName, setMissionName] = useState("");
  const [missionFolder, setMissionFolder] = useState("");
  const [modalError, setModalError] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const workspace = mission?.cwd || settings.workspace;

  const selectMission = (next: Mission | null) => {
    drafts.current.set(selectedMissionId.current || "new", currentDraft.current);
    selectedMissionId.current = next?.id || null;
    const draft = drafts.current.get(next?.id || "new");
    setMission(next);
    if (next) setSettings((current) => ({ ...current, agentCount: next.agentCount, autoEdit: next.autoEdit }));
    setBrief(draft?.brief || "");
    setAttachments(draft?.attachments || []);
    setPilotLog("");
    setNotice("");
    setContextMenu(null);
  };

  const showModal = (type: "new" | "rename" | "delete", id?: string) => {
    const existing = history.find((item) => item.id === id);
    setMissionName(type === "new" ? "" : existing?.name || existing?.brief.slice(0, 80) || "Missão");
    setMissionFolder("");
    setModalError("");
    setContextMenu(null);
    setModal({ type, id });
  };

  useEffect(() => {
    const dismiss = () => setContextMenu(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setContextMenu(null); if (!modalBusy) setModal(null); }
    };
    window.addEventListener("click", dismiss);
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [modalBusy]);

  const activeMission = Boolean(mission && ACTIVE_STATUSES.has(mission.status));

  const missionAgents = useMemo(() => {
    if (!mission) return agents.filter((agent) => !agent.missionId);
    const scoped = agents.filter((agent) => agent.missionId === mission.id);
    const manual = agents.filter((agent) => !agent.missionId);
    return [...scoped, ...manual];
  }, [agents, mission]);

  const refreshHistory = async () => {
    const next = await window.imx.listMissions();
    setHistory(next);
  };

  useEffect(() => {
    let mounted = true;

    Promise.all([
      window.imx.getSystemStatus(),
      window.imx.getSettings(),
      window.imx.listMissions(),
      window.imx.listTerminals()
    ]).then(([systemInfo, storedSettings, storedMissions, terminals]) => {
      if (!mounted) return;
      setSystem(systemInfo);
      setSettings(storedSettings);
      setHistory(storedMissions);
      setAgents(terminals.filter((agent) => !closedTerminals.current.has(agent.id)));
    });

    const offCreated = window.imx.onTerminalCreated((agent) => {
      if (closedTerminals.current.has(agent.id)) return;
      setAgents((current) => upsertAgent(current, agent));
    });

    const offStatus = window.imx.onTerminalStatus((agent) => {
      if (closedTerminals.current.has(agent.id)) return;
      setAgents((current) => upsertAgent(current, agent));
    });

    const offExit = window.imx.onTerminalExit((payload) => {
      if (closedTerminals.current.has(payload.id)) return;
      setAgents((current) =>
        current.map((agent) =>
          agent.id === payload.id ? { ...agent, status: payload.status } : agent
        )
      );
    });

    const offMission = window.imx.onMissionEvent((event: MissionEvent) => {
      if (event.type !== "mission:pilot-output") {
        setHistory((current) => [event.mission, ...current.filter((item) => item.id !== event.missionId)]);
      }
      if (event.type === "mission:pilot-output" && event.data) {
        setPilotLogs((current) => ({ ...current, [event.missionId]: ((current[event.missionId] || "") + event.data).slice(-50000) }));
      }
      if (selectedMissionId.current !== event.missionId) return;
      setMission(event.mission);
      if (["mission:warning", "mission:error", "mission:blocked"].includes(event.type) && event.message) setNotice(event.message);
    });

    return () => {
      mounted = false;
      offCreated();
      offStatus();
      offExit();
      offMission();
    };
  }, []);

  const closeTerminal = async (id: string) => {
    if (closedTerminals.current.has(id)) return;
    // Suppress exit/status events before requesting process termination.
    closedTerminals.current.add(id);
    try {
      const closed = await window.imx.killTerminal(id);
      if (!closed) throw new Error("Não foi possível encerrar o terminal.");
      setAgents((current) => current.filter((agent) => agent.id !== id));
    } catch (error) {
      closedTerminals.current.delete(id);
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const persistSettings = async (patch: Partial<Settings>) => {
    const next = await window.imx.setSettings(patch);
    setSettings(next);
  };

  const chooseWorkspace = async () => {
    if (mission) { setNotice("A pasta pertence a esta missão. Use Nova missão para trabalhar em outro projeto."); return; }
    const selected = await window.imx.chooseWorkspace();
    if (selected) {
      await persistSettings({ workspace: selected });
      setNotice("");
    }
  };

  const chooseAttachments = async () => {
    const selected = await window.imx.chooseAttachments();
    if (!selected.length) return;

    setAttachments((current) => {
      const byPath = new Map(current.map((item) => [item.path, item]));
      for (const item of selected) byPath.set(item.path, item);
      return Array.from(byPath.values()).slice(0, 20);
    });
  };

  const removeAttachment = (path: string) => {
    setAttachments((current) => current.filter((item) => item.path !== path));
  };

  const startMission = async () => {
    if (!brief.trim()) {
      setNotice("Descreva o que o PILOTO deve entregar.");
      return;
    }

    if (!workspace) {
      setNotice("Escolha um workspace antes de iniciar.");
      return;
    }

    if (!system?.codexFound) {
      setNotice("Codex CLI não foi encontrado. Instale ou ajuste o PATH antes de iniciar o squad.");
      return;
    }

    setBusy(true);
    setNotice("");
    setPilotLog("");
    setAgents((current) => current.filter((agent) => agent.missionId !== mission?.id || agent.kind !== "mission"));

    try {
      const created = await window.imx.startMission({
        missionId: mission?.id,
        brief: brief.trim(),
        cwd: workspace,
        agentCount: settings.agentCount,
        autoEdit: settings.autoEdit,
        attachments
      });
      selectedMissionId.current = created.id;
      setMission(created);
      setHistory((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      drafts.current.delete(created.id);
      drafts.current.delete("new");
      setBrief("");
      setAttachments([]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const cancelMission = async () => {
    if (!mission) return;
    await window.imx.cancelMission(mission.id);
  };

  const createManual = async (kind: "shell" | "codex") => {
    let cwd = mission?.resultPath || workspace;
    if (!cwd) {
      const selected = await window.imx.chooseWorkspace();
      if (!selected) return;
      cwd = selected;
      await persistSettings({ workspace: selected });
    }

    try {
      await window.imx.createTerminal({
        kind,
        cwd,
        missionId: mission?.id,
        title: kind === "codex" ? "Codex manual" : "Terminal manual",
        role: kind === "codex" ? "Agente independente" : "Shell"
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const submitModal = async () => {
    if (!modal || modalBusy) return;
    setModalBusy(true);
    setModalError("");
    try {
      if (modal.type === "new") {
        if (!missionName.trim() || !missionFolder) throw new Error("Informe o nome e escolha uma pasta exclusiva para o projeto.");
        const created = await window.imx.createMission({ name: missionName.trim(), cwd: missionFolder, agentCount: settings.agentCount, autoEdit: settings.autoEdit });
        setHistory((current) => [created, ...current]);
        selectMission(created);
      } else if (modal.type === "rename" && modal.id) {
        const updated = await window.imx.renameMission(modal.id, missionName);
        setHistory((current) => current.map((item) => item.id === updated.id ? updated : item));
        if (selectedMissionId.current === updated.id) setMission(updated);
      } else if (modal.id) {
        const removed = await window.imx.deleteMission(modal.id);
        if (!removed) throw new Error("Missão não encontrada.");
        setHistory((current) => current.filter((item) => item.id !== modal.id));
        setAgents((current) => current.filter((agent) => agent.missionId !== modal.id));
        drafts.current.delete(modal.id);
        setPilotLogs((current) => { const next = { ...current }; delete next[modal.id!]; return next; });
        if (selectedMissionId.current === modal.id) selectMission(null);
      }
      setModal(null);
    } catch (error) {
      setModalError(error instanceof Error ? error.message : String(error));
    } finally { setModalBusy(false); }
  };

  const openPreview = async () => {
    if (!mission || previewBusy) return;
    setPreviewBusy(true);
    setNotice("Preparando a prévia local. As dependências serão instaladas se necessário…");
    try {
      const result = await window.imx.openMissionPreview(mission.id);
      setNotice("Prévia aberta no navegador: " + result.url);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setPreviewBusy(false); }
  };

  const displayedLog = mission ? pilotLogs[mission.id] || "" : pilotLog;

  return (
    <div className={`app ${sidebarCollapsed ? "app--sidebar-collapsed" : ""}`}>
      <aside className="sidebar" id="workspace-navigation" hidden={sidebarCollapsed}>
        <div className="brand">
          <div className="brand-mark">IM</div>
          <div>
            <strong>IMx</strong>
            <span>agent cockpit</span>
          </div>
        </div>

        <section className="sidebar-section">
          <div className="section-kicker">WORKSPACE</div>
          <button className="workspace-button" onClick={chooseWorkspace}>
            <span className="workspace-icon">⌂</span>
            <span>
              <strong>{workspace ? shortPath(workspace) : "Selecionar pasta"}</strong>
              <small>{workspace || "nenhuma pasta ativa"}</small>
            </span>
          </button>
        </section>

        <section className="sidebar-section sidebar-section--grow">
          <div className="section-row">
            <div className="section-kicker">MISSÕES</div>
            <span>{history.length}</span>
          </div>

          <button className="new-mission-button" onClick={() => showModal("new")}>+ Nova missão</button>
          <div className="history-list">
            {history.length === 0 ? (
              <div className="history-empty">Nenhuma missão ainda.</div>
            ) : (
              history.map((item) => (
                <button
                  key={item.id}
                  className={`history-item ${mission?.id === item.id ? "history-item--active" : ""}`}
                  onClick={() => selectMission(item)}
                  title={item.name || item.brief || "Nova missão"}
                  aria-haspopup="menu"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ id: item.id, x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 120) });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setContextMenu({ id: item.id, x: rect.right, y: Math.min(rect.top, window.innerHeight - 120) });
                    }
                  }}
                >
                  <span className={`history-state history-state--${item.status}`} />
                  <span>
                    <strong>{item.name || item.brief || "Nova missão"}</strong>
                    <small>
                      {item.agentCount} agentes · {missionStatusLabel(item.status)}
                    </small>
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        <div className="sidebar-footer">
          <div className={`connection ${system?.codexFound ? "connection--ok" : "connection--off"}`}>
            <span />
            <div>
              <strong>{system?.codexFound ? "Codex conectado" : "Codex não encontrado"}</strong>
              <small>{system?.codexVersion || "verifique a instalação"}</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-heading">
            <button
              type="button"
              className="sidebar-toggle"
              title={sidebarCollapsed ? "Mostrar navegação" : "Esconder navegação"}
              aria-label={sidebarCollapsed ? "Mostrar navegação" : "Esconder navegação"}
              aria-expanded={!sidebarCollapsed}
              aria-controls="workspace-navigation"
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" />
                <path d="M9 4v16" stroke="currentColor" strokeWidth="1.7" />
              </svg>
            </button>
            <div>
            <span className="eyebrow">LOCAL AGENTIC WORKSPACE</span>
            <h1>{mission?.name || "Squad Control"}</h1>
            </div>
          </div>

          <div className="topbar-actions">
            <button className="secondary-button" onClick={() => void createManual("shell")}>
              + Terminal
            </button>
            <button className="secondary-button secondary-button--blue" onClick={() => void createManual("codex")}>
              + Codex
            </button>
          </div>
        </header>

        <section className="pilot-card">
          <div className="pilot-card__top">
            <div className="pilot-title">
              <div className="pilot-orb">
                <span />
              </div>
              <div>
                <span className="pilot-label">PILOTO</span>
                <strong>{mission ? missionStatusLabel(mission.status) : "PRONTO PARA MISSÃO"}</strong>
              </div>
            </div>

            <div className="mission-config">
              <span className="config-label">AGENTES</span>
              <div className="segmented">
                {[1, 2, 3, 4, 5, 6].map((count) => (
                  <button
                    key={count}
                    className={settings.agentCount === count ? "active" : ""}
                    disabled={activeMission}
                    onClick={() => void persistSettings({ agentCount: count })}
                  >
                    {count}
                  </button>
                ))}
              </div>

              <label className="switch-control">
                <input
                  type="checkbox"
                  checked={settings.autoEdit}
                  disabled={activeMission}
                  onChange={(event) => void persistSettings({ autoEdit: event.target.checked })}
                />
                <span className="switch" />
                <span>edição automática</span>
              </label>
            </div>
          </div>

          {mission?.messages?.length ? (
            <div className="mission-chat" aria-label="Conversa da missão">
              {mission.messages.map((message) => (
                <div key={message.id} className={`chat-message chat-message--${message.role}`}>
                  <span>{message.role === "user" ? "VOCÊ" : "PILOTO"}</span>
                  <p>{message.text}</p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="brief-row">
            <div className="brief-composer">
              <textarea
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                placeholder={mission?.brief ? "Descreva os próximos ajustes deste projeto…" : "Descreva o site ou sistema que vamos construir…"}
                disabled={activeMission}
              />

              <div className="composer-toolbar">
                <button
                  className="attachment-button"
                  onClick={() => void chooseAttachments()}
                  disabled={activeMission}
                >
                  + Anexar arquivo
                </button>
                <span>PDF, imagem, documento, código ou qualquer arquivo local. Links podem ser colados na missão.</span>
              </div>

              {attachments.length ? (
                <div className="attachment-list">
                  {attachments.map((item) => (
                    <div className="attachment-chip" key={item.path}>
                      <span>{item.name}</span>
                      <button
                        title="Remover anexo"
                        disabled={activeMission}
                        onClick={() => removeAttachment(item.path)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {activeMission ? (
              <button className="danger-button" onClick={() => void cancelMission()}>
                CANCELAR
              </button>
            ) : (
              <button className="primary-button" disabled={busy} onClick={() => void startMission()}>
                {busy ? "ENVIANDO..." : mission?.brief ? "ENVIAR AJUSTES" : "INICIAR MISSÃO"}
                <span>→</span>
              </button>
            )}
          </div>

          {notice ? <div className="notice">{notice}</div> : null}

          {mission?.plan ? (
            <div className="plan-strip">
              <div className="plan-summary">
                <span>ESTRATÉGIA</span>
                <strong>{mission.plan.strategy}</strong>
              </div>
              <div className="task-chips">
                {mission.plan.tasks.map((task, index) => (
                  <div className="task-chip" key={task.id}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{task.role}</strong>
                      <small>{task.title}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {displayedLog ? (
            <div className="pilot-console">
              <div className="console-head">
                <span>PILOTO STREAM</span>
                <span>{mission?.workspaceMode || "pending"}</span>
              </div>
              <pre>{displayedLog}</pre>
            </div>
          ) : null}

          {mission?.status === "done" ? (
            <div className="delivery-card">
              <div>
                <span className="delivery-kicker">ENTREGA</span>
                <strong>{mission.integrationBranch || "workspace atualizado"}</strong>
                <p>{mission.summary || "Missão concluída."}</p>
              </div>
              {mission.resultPath ? (
                <button className="secondary-button secondary-button--blue" disabled={previewBusy} onClick={() => void openPreview()}>
                  {previewBusy ? "Abrindo prévia…" : "Abrir resultado"}
                </button>
              ) : null}
            </div>
          ) : null}

          {mission && (mission.status === "error" || mission.status === "blocked") ? (
            <div className="delivery-card delivery-card--error">
              <div>
                <span className="delivery-kicker">
                  {mission.status === "blocked" ? "MISSÃO BLOQUEADA" : "MISSÃO INTERROMPIDA"}
                </span>
                <strong>{mission.status === "blocked" ? "Codex indisponível para continuar" : "Nenhuma entrega válida"}</strong>
                <p>{mission.error || mission.summary || "A missão não foi concluída."}</p>
              </div>
            </div>
          ) : null}
        </section>

        <section className="workspace-head">
          <div>
            <span className="eyebrow">PANES</span>
            <h2>{missionAgents.length} terminais ativos/registrados</h2>
          </div>
          <div className="workspace-stats">
            <span>{mission?.workspaceMode === "worktree" ? "ISOLADO" : mission?.workspaceMode === "shared" ? "COMPARTILHADO" : "LOCAL"}</span>
            <span>{system?.platform || "—"} · {system?.arch || "—"}</span>
          </div>
        </section>

        <section className="agent-grid">
          {missionAgents.length === 0 ? (
            <div className="empty-grid">
              <div className="empty-grid__mark">IMx</div>
              <strong>Nenhum terminal aberto</strong>
              <p>Inicie uma missão com o PILOTO ou abra um Codex manual para trabalhar de forma independente.</p>
            </div>
          ) : (
            missionAgents.map((agent) => (
              <TerminalPane
                key={agent.id}
                agent={agent}
                onClose={closeTerminal}
                canSendInstruction={Boolean(
                  agent.kind === "mission" &&
                  agent.missionId === mission?.id &&
                  activeMission
                )}
              />
            ))
          )}
        </section>
      </main>
      {contextMenu ? (
        <div className="mission-context-menu" role="menu" aria-label="Opções da missão" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button role="menuitem" onClick={() => showModal("rename", contextMenu.id)}>Renomear missão</button>
          <button role="menuitem" className="menu-danger" onClick={() => showModal("delete", contextMenu.id)}>Excluir missão</button>
        </div>
      ) : null}
      {modal ? (
        <div className="modal-backdrop">
          <section className="mission-modal" role="dialog" aria-modal="true" aria-labelledby="mission-modal-title">
            <h2 id="mission-modal-title">{modal.type === "new" ? "Nova missão" : modal.type === "rename" ? "Renomear missão" : "Excluir missão"}</h2>
            {modal.type === "delete" ? (
              <p>Excluir “{missionName}” do histórico? Os arquivos do projeto serão preservados. Se houver uma execução ativa, cancele antes de excluir.</p>
            ) : (
              <label>Nome do projeto<input autoFocus value={missionName} maxLength={100} onChange={(event) => setMissionName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitModal(); }} /></label>
            )}
            {modal.type === "new" ? (
              <div className="mission-folder-picker">
                <p>Cada site ou sistema deve usar uma pasta própria, fora da pasta do IMx.</p>
                <button className="secondary-button" onClick={async () => { const folder = await window.imx.chooseWorkspace(); if (folder) setMissionFolder(folder); }}>Escolher ou criar pasta</button>
                <small>{missionFolder || "Nenhuma pasta selecionada"}</small>
              </div>
            ) : null}
            {modalError ? <p className="notice" role="alert">{modalError}</p> : null}
            <div className="modal-actions">
              <button className="secondary-button" disabled={modalBusy} onClick={() => setModal(null)}>Cancelar</button>
              <button className={modal.type === "delete" ? "danger-button" : "primary-button"} disabled={modalBusy} onClick={() => void submitModal()}>{modalBusy ? "Salvando…" : modal.type === "delete" ? "Excluir do histórico" : "Salvar"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

