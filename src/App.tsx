import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type {
  AgentMeta,
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
    planning: "PLANEJANDO",
    preparing: "PREPARANDO",
    running: "EM EXECUÇÃO",
    integrating: "INTEGRANDO",
    reviewing: "REVISANDO",
    done: "CONCLUÍDA",
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

function TerminalPane({ agent }: { agent: AgentMeta }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

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
            onClick={() => void window.imx.killTerminal(agent.id)}
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
    </article>
  );
}

export default function App() {
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [settings, setSettings] = useState<Settings>({
    workspace: "",
    agentCount: 4,
    autoEdit: true
  });
  const [brief, setBrief] = useState("");
  const [mission, setMission] = useState<Mission | null>(null);
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [history, setHistory] = useState<Mission[]>([]);
  const [pilotLog, setPilotLog] = useState("");
  const [notice, setNotice] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const activeMission = Boolean(mission && ACTIVE_STATUSES.has(mission.status));

  const missionAgents = useMemo(() => {
    if (!mission) return agents;
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
      setAgents(terminals);
    });

    const offCreated = window.imx.onTerminalCreated((agent) => {
      setAgents((current) => upsertAgent(current, agent));
    });

    const offStatus = window.imx.onTerminalStatus((agent) => {
      setAgents((current) => upsertAgent(current, agent));
    });

    const offExit = window.imx.onTerminalExit((payload) => {
      setAgents((current) =>
        current.map((agent) =>
          agent.id === payload.id ? { ...agent, status: payload.status } : agent
        )
      );
    });

    const offMission = window.imx.onMissionEvent((event: MissionEvent) => {
      setMission(event.mission);

      if (event.type === "mission:pilot-output" && event.data) {
        setPilotLog((current) => {
          const next = current + event.data;
          return next.length > 50000 ? next.slice(-50000) : next;
        });
      }

      if (event.type === "mission:warning" && event.message) {
        setNotice(event.message);
      }

      if (event.type === "mission:error" && event.message) {
        setNotice(event.message);
      }

      if (
        event.type === "mission:completed" ||
        event.type === "mission:canceled" ||
        event.type === "mission:error"
      ) {
        void refreshHistory();
      }
    });

    return () => {
      mounted = false;
      offCreated();
      offStatus();
      offExit();
      offMission();
    };
  }, []);

  const persistSettings = async (patch: Partial<Settings>) => {
    const next = await window.imx.setSettings(patch);
    setSettings(next);
  };

  const chooseWorkspace = async () => {
    const selected = await window.imx.chooseWorkspace();
    if (selected) {
      await persistSettings({ workspace: selected });
      setNotice("");
    }
  };

  const startMission = async () => {
    if (!brief.trim()) {
      setNotice("Descreva o que o PILOTO deve entregar.");
      return;
    }

    if (!settings.workspace) {
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
    setAgents((current) => current.filter((agent) => !agent.missionId));

    try {
      const created = await window.imx.startMission({
        brief: brief.trim(),
        cwd: settings.workspace,
        agentCount: settings.agentCount,
        autoEdit: settings.autoEdit
      });
      setMission(created);
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
    let cwd = settings.workspace;
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
        title: kind === "codex" ? "Codex manual" : "Terminal manual",
        role: kind === "codex" ? "Agente independente" : "Shell"
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
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
              <strong>{settings.workspace ? shortPath(settings.workspace) : "Selecionar pasta"}</strong>
              <small>{settings.workspace || "nenhuma pasta ativa"}</small>
            </span>
          </button>
        </section>

        <section className="sidebar-section sidebar-section--grow">
          <div className="section-row">
            <div className="section-kicker">MISSÕES</div>
            <span>{history.length}</span>
          </div>

          <div className="history-list">
            {history.length === 0 ? (
              <div className="history-empty">Nenhuma missão ainda.</div>
            ) : (
              history.slice(0, 12).map((item) => (
                <button
                  key={item.id}
                  className={`history-item ${mission?.id === item.id ? "history-item--active" : ""}`}
                  onClick={() => setMission(item)}
                >
                  <span className={`history-state history-state--${item.status}`} />
                  <span>
                    <strong>{item.brief}</strong>
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
          <div>
            <span className="eyebrow">LOCAL AGENTIC WORKSPACE</span>
            <h1>Squad Control</h1>
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
                <strong>{activeMission ? missionStatusLabel(mission?.status) : "PRONTO PARA MISSÃO"}</strong>
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

          <div className="brief-row">
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="Ex.: Construa um site premium para esta loja. Use a identidade atual, crie frontend, backend, assets e valide tudo."
              disabled={activeMission}
            />

            {activeMission ? (
              <button className="danger-button" onClick={() => void cancelMission()}>
                CANCELAR
              </button>
            ) : (
              <button className="primary-button" disabled={busy} onClick={() => void startMission()}>
                {busy ? "INICIANDO..." : "INICIAR MISSÃO"}
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

          {pilotLog ? (
            <div className="pilot-console">
              <div className="console-head">
                <span>PILOTO STREAM</span>
                <span>{mission?.workspaceMode || "pending"}</span>
              </div>
              <pre>{pilotLog}</pre>
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
                <button className="secondary-button secondary-button--blue" onClick={() => void window.imx.openPath(mission.resultPath!)}>
                  Abrir resultado
                </button>
              ) : null}
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
            missionAgents.map((agent) => <TerminalPane key={agent.id} agent={agent} />)
          )}
        </section>
      </main>
    </div>
  );
}
