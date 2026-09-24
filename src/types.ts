export type AgentStatus =
  | "idle"
  | "starting"
  | "running"
  | "waiting"
  | "done"
  | "error"
  | "stopped";

export type AgentKind = "shell" | "codex" | "mission";

export interface AgentMeta {
  id: string;
  title: string;
  role: string;
  kind: AgentKind;
  status: AgentStatus | string;
  cwd: string;
  missionId?: string | null;
  interactive: boolean;
  startedAt?: string;
  logPath?: string;
  taskId?: string;
  branch?: string | null;
}

export interface MissionTask {
  id: string;
  title: string;
  role: string;
  instructions: string;
}

export interface MissionPlan {
  summary: string;
  strategy: string;
  tasks: MissionTask[];
}

export interface Mission {
  id: string;
  brief: string;
  cwd: string;
  agentCount: number;
  autoEdit: boolean;
  status: string;
  createdAt: string;
  updatedAt?: string;
  finishedAt?: string;
  plan?: MissionPlan | null;
  agents?: AgentMeta[];
  summary?: string;
  error?: string;
  workspaceMode?: "pending" | "worktree" | "shared";
  baseHead?: string;
  baseBranch?: string;
  integrationBranch?: string;
  resultPath?: string;
  canceled?: boolean;
}

export interface SystemStatus {
  codexFound: boolean;
  codexPath: string | null;
  codexVersion: string | null;
  shell: string;
  platform: string;
  arch: string;
}

export interface Settings {
  workspace: string;
  agentCount: number;
  autoEdit: boolean;
}

export interface MissionEvent {
  type: string;
  missionId: string;
  mission: Mission;
  data?: string;
  stream?: "stdout" | "stderr";
  label?: string;
  message?: string;
  plan?: MissionPlan;
  agent?: AgentMeta;
  task?: MissionTask;
  branch?: string | null;
}

declare global {
  interface Window {
    imx: {
      getSystemStatus(): Promise<SystemStatus>;
      chooseWorkspace(): Promise<string | null>;
      getSettings(): Promise<Settings>;
      setSettings(patch: Partial<Settings>): Promise<Settings>;
      listMissions(): Promise<Mission[]>;
      listTerminals(): Promise<AgentMeta[]>;
      getTerminalBuffer(id: string): Promise<string>;

      createTerminal(input: {
        kind: "shell" | "codex";
        cwd: string;
        title?: string;
        role?: string;
      }): Promise<AgentMeta>;
      writeTerminal(id: string, data: string): Promise<boolean>;
      resizeTerminal(id: string, cols: number, rows: number): Promise<boolean>;
      killTerminal(id: string): Promise<boolean>;

      startMission(input: {
        brief: string;
        cwd: string;
        agentCount: number;
        autoEdit: boolean;
      }): Promise<Mission>;
      cancelMission(missionId: string): Promise<boolean>;
      openPath(targetPath: string): Promise<boolean>;

      onTerminalCreated(callback: (payload: AgentMeta) => void): () => void;
      onTerminalData(callback: (payload: { id: string; data: string }) => void): () => void;
      onTerminalStatus(callback: (payload: AgentMeta) => void): () => void;
      onTerminalExit(callback: (payload: {
        id: string;
        exitCode: number;
        signal: number;
        status: string;
        missionId?: string | null;
      }) => void): () => void;
      onMissionEvent(callback: (payload: MissionEvent) => void): () => void;
    };
  }
}

export {};
