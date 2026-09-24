const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { ...options, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

function slug(value) {
  return String(value || "agent")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "agent";
}

function cleanJsonText(text) {
  const trimmed = String(text || "").trim();
  const unfenced = trimmed
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start >= 0 && end > start) return unfenced.slice(start, end + 1);
  return unfenced;
}

function stripAnsi(text) {
  return String(text || "").replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "");
}

function parseSessionId(text) {
  const clean = stripAnsi(text);
  const human = Array.from(clean.matchAll(/session id:\s*([0-9a-f-]{20,})/gi));
  if (human.length) return human[human.length - 1][1];

  const json = Array.from(clean.matchAll(/"thread_id"\s*:\s*"([^"]+)"/g));
  if (json.length) return json[json.length - 1][1];

  return null;
}

function hasUsageLimit(text) {
  return /hit your usage limit|usage limit|try again at/i.test(stripAnsi(text));
}

function safeAttachmentName(value) {
  return path.basename(String(value || "arquivo"))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 120) || "arquivo";
}

const FALLBACK_ROLES = [
  ["Arquitetura", "Mapeie a solução, contratos entre módulos, riscos e critérios de conclusão. Faça mudanças estruturais somente quando necessárias."],
  ["Frontend", "Implemente a interface, estados, componentes e experiência visual relacionada à missão."],
  ["Backend", "Implemente lógica, integrações, persistência, APIs e infraestrutura necessária à missão."],
  ["Design & Assets", "Cuide do sistema visual, assets, consistência de interface e detalhes de apresentação. Não adicione texto dentro de imagens."],
  ["Pesquisa", "Valide referências, documentação e decisões técnicas. Converta descobertas em mudanças objetivas no projeto quando necessário."],
  ["QA", "Teste o fluxo, encontre regressões, corrija bugs e valide build, lint e comportamento final."],
  ["Performance", "Revise performance, bundle, concorrência, uso de recursos e gargalos observáveis."],
  ["Integração", "Revise a integração entre as partes e corrija inconsistências entre módulos sem reescrever trabalho válido."]
];

class Orchestrator {
  constructor({ terminalManager, state, codexPath, baseEnv, worktreesRoot, emit }) {
    this.terminalManager = terminalManager;
    this.state = state;
    this.codexPath = codexPath;
    this.baseEnv = baseEnv;
    this.worktreesRoot = worktreesRoot;
    this.emit = emit;
    this.missions = new Map();
    this.children = new Map();
    this.agentRuns = new Map();
    fs.mkdirSync(this.worktreesRoot, { recursive: true });
  }

  snapshot(mission) {
    mission.updatedAt = new Date().toISOString();
    this.state.upsertMission(mission);
    return JSON.parse(JSON.stringify(mission));
  }

  emitMission(type, mission, extra = {}) {
    const missionView = type === "mission:pilot-output"
      ? JSON.parse(JSON.stringify(mission))
      : this.snapshot(mission);

    const payload = {
      type,
      missionId: mission.id,
      mission: missionView,
      ...extra
    };
    this.emit(payload);
  }

  fallbackPlan(brief, count) {
    const tasks = [];
    for (let i = 0; i < count; i += 1) {
      const [role, instructions] = FALLBACK_ROLES[i % FALLBACK_ROLES.length];
      tasks.push({
        id: `task-${i + 1}`,
        title: count === 1 ? "Executar missão de ponta a ponta" : `${role}: parte ${i + 1}`,
        role,
        instructions
      });
    }
    return {
      summary: "Plano local de contingência criado pelo IMx.",
      strategy: "Dividir a missão em responsabilidades independentes e executar em paralelo.",
      tasks
    };
  }

  parsePlan(text, brief, count) {
    try {
      const parsed = JSON.parse(cleanJsonText(text));
      const source = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      const tasks = source.slice(0, count).map((task, index) => ({
        id: task.id || `task-${index + 1}`,
        title: String(task.title || `Tarefa ${index + 1}`),
        role: String(task.role || FALLBACK_ROLES[index % FALLBACK_ROLES.length][0]),
        instructions: String(task.instructions || task.objective || "Execute sua parte da missão.")
      }));

      if (tasks.length < count) {
        const fallback = this.fallbackPlan(brief, count).tasks;
        while (tasks.length < count) tasks.push(fallback[tasks.length]);
      }

      return {
        summary: String(parsed.summary || "Plano gerado pelo PILOTO."),
        strategy: String(parsed.strategy || "Execução paralela por especialidade."),
        tasks
      };
    } catch {
      return this.fallbackPlan(brief, count);
    }
  }

  buildExecArgs(prompt, { fullAuto = false, resumeSessionId = null } = {}) {
    const args = [];
    if (fullAuto) {
      args.push("-a", "never");
    }

    args.push("exec");

    if (fullAuto) {
      args.push("--sandbox", "workspace-write");
    }

    if (resumeSessionId) {
      args.push("resume", resumeSessionId);
    }

    args.push(prompt);
    return args;
  }

  runCodex(prompt, cwd, mission, { fullAuto = false, label = "PILOTO" } = {}) {
    if (!this.codexPath) {
      return Promise.reject(new Error("Codex CLI não encontrado."));
    }

    const args = this.buildExecArgs(prompt, { fullAuto });

    return new Promise((resolve, reject) => {
      const child = spawn(this.codexPath, args, {
        cwd,
        env: this.baseEnv,
        stdio: ["ignore", "pipe", "pipe"]
      });

      if (mission) this.children.set(mission.id, child);

      let stdout = "";
      let stderr = "";

      const push = (chunk, stream) => {
        const data = chunk.toString();
        if (stream === "stdout") stdout += data;
        else stderr += data;
        if (mission) {
          this.emitMission("mission:pilot-output", mission, {
            data,
            stream,
            label
          });
        }
      };

      child.stdout.on("data", (chunk) => push(chunk, "stdout"));
      child.stderr.on("data", (chunk) => push(chunk, "stderr"));

      child.on("error", (error) => {
        if (mission) this.children.delete(mission.id);
        reject(error);
      });

      child.on("close", (code) => {
        if (mission) this.children.delete(mission.id);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          const error = new Error(stderr.trim() || `Codex encerrou com código ${code}.`);
          error.exitCode = code;
          reject(error);
        }
      });
    });
  }

  async planMission(mission) {
    const prompt = [
      "Você é o PILOTO do IMx, um orquestrador de agentes de desenvolvimento.",
      "Sua função é decompor a missão em tarefas realmente paralelizáveis, com o mínimo possível de sobreposição de arquivos.",
      `Missão do usuário: ${mission.brief}`,
      `Número exato de agentes: ${mission.agentCount}`,
      "",
      "Retorne SOMENTE JSON válido, sem markdown, exatamente neste formato:",
      "{",
      '  "summary": "resumo curto",',
      '  "strategy": "como o squad será dividido",',
      '  "tasks": [',
      '    {"id":"task-1","title":"...","role":"...","instructions":"..."}',
      "  ]",
      "}",
      "",
      `A lista tasks deve conter exatamente ${mission.agentCount} itens.`,
      "Cada agente deve conseguir começar imediatamente sem esperar os outros.",
      "Separe frontend, backend, pesquisa, design/assets, QA ou integração quando isso fizer sentido.",
      "Não invente trabalho só para preencher vagas; quando houver poucos agentes, agrupe responsabilidades de forma coerente."
    ].join("\n");

    try {
      const output = await this.runCodex(prompt, mission.cwd, mission, { fullAuto: false, label: "PILOTO · planejamento" });
      return this.parsePlan(output, mission.brief, mission.agentCount);
    } catch (error) {
      this.emitMission("mission:warning", mission, {
        message: `O PILOTO não conseguiu gerar o plano via Codex; usando divisão local de contingência. ${error.message}`
      });
      return this.fallbackPlan(mission.brief, mission.agentCount);
    }
  }

  async git(args, cwd) {
    return execFileAsync("git", args, { cwd, env: this.baseEnv });
  }

  async prepareWorkspaces(mission) {
    try {
      const inside = await this.git(["rev-parse", "--is-inside-work-tree"], mission.cwd);
      if (inside.stdout.trim() !== "true") throw new Error("não é um repositório Git");

      const dirty = await this.git(["status", "--porcelain"], mission.cwd);
      if (dirty.stdout.trim()) {
        throw new Error("o repositório possui alterações locais não commitadas");
      }

      const baseHead = (await this.git(["rev-parse", "HEAD"], mission.cwd)).stdout.trim();
      const baseBranch = (await this.git(["branch", "--show-current"], mission.cwd)).stdout.trim() || "detached";
      const shortId = mission.id.slice(0, 8);
      const integrationBranch = `imx/mission-${shortId}`;
      const root = path.join(this.worktreesRoot, mission.id);
      const integrationPath = path.join(root, "integration");

      fs.mkdirSync(root, { recursive: true });
      await this.git(["branch", integrationBranch, baseHead], mission.cwd);
      await this.git(["worktree", "add", integrationPath, integrationBranch], mission.cwd);

      const agentWorkspaces = [];
      for (let i = 0; i < mission.plan.tasks.length; i += 1) {
        const task = mission.plan.tasks[i];
        const branch = `imx/${shortId}/${i + 1}-${slug(task.role)}`;
        const agentPath = path.join(root, `agent-${i + 1}`);
        await this.git(["worktree", "add", "-b", branch, agentPath, integrationBranch], mission.cwd);
        agentWorkspaces.push({
          taskId: task.id,
          cwd: agentPath,
          branch
        });
      }

      mission.workspaceMode = "worktree";
      mission.baseHead = baseHead;
      mission.baseBranch = baseBranch;
      mission.integrationBranch = integrationBranch;
      mission.resultPath = integrationPath;
      mission.agentWorkspaces = agentWorkspaces;
      this.emitMission("mission:workspace", mission, {
        message: `Execução isolada em worktrees. Resultado: ${integrationBranch}`
      });
      return;
    } catch (error) {
      mission.workspaceMode = "shared";
      mission.resultPath = mission.cwd;
      mission.agentWorkspaces = mission.plan.tasks.map((task) => ({
        taskId: task.id,
        cwd: mission.cwd,
        branch: null
      }));
      this.emitMission("mission:warning", mission, {
        message: `Worktrees não foram ativadas (${error.message}). Os agentes compartilharão a mesma pasta.`
      });
    }
  }

  stageAttachments(mission, workspace, task) {
    const source = Array.isArray(mission.attachments) ? mission.attachments : [];
    if (!source.length) return [];

    const folder = path.join(workspace.cwd, ".imx-input", mission.id, slug(task.id || task.role));
    fs.mkdirSync(folder, { recursive: true });

    const staged = [];
    for (let index = 0; index < source.length; index += 1) {
      const item = source[index];
      const sourcePath = typeof item === "string" ? item : item.path;
      if (!sourcePath || !fs.existsSync(sourcePath)) continue;

      const target = path.join(
        folder,
        `${String(index + 1).padStart(2, "0")}-${safeAttachmentName(sourcePath)}`
      );

      fs.copyFileSync(sourcePath, target);
      staged.push({
        name: typeof item === "string" ? path.basename(sourcePath) : (item.name || path.basename(sourcePath)),
        path: target
      });
    }

    return staged;
  }

  cleanupAttachments(staged) {
    const roots = new Set((staged || []).map((item) => path.dirname(item.path)).filter(Boolean));
    for (const root of roots) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {}
    }
  }

  buildAgentPrompt(mission, task, workspace, stagedAttachments = []) {
    const attachmentLines = stagedAttachments.length
      ? [
          "",
          "ARQUIVOS ANEXADOS PELO USUÁRIO:",
          ...stagedAttachments.map((item) => `- ${item.name}: ${item.path}`),
          "Leia/inspecione esses arquivos quando forem relevantes para sua tarefa."
        ]
      : [];

    return [
      `Você é um agente do squad IMx. Seu papel é: ${task.role}.`,
      `Missão geral: ${mission.brief}`,
      `Sua tarefa exclusiva: ${task.title}`,
      `Instruções: ${task.instructions}`,
      ...attachmentLines,
      "",
      "REGRAS:",
      "- Comece imediatamente e trabalhe apenas no escopo da sua tarefa.",
      "- Inspecione o projeto antes de alterar arquivos.",
      "- Preserve trabalho existente e não desfaça mudanças válidas.",
      "- Evite editar arquivos que não sejam necessários para a sua responsabilidade.",
      "- Execute verificações, build ou testes relevantes antes de encerrar.",
      "- Não faça push, release ou deploy.",
      "- Não altere credenciais nem arquivos fora do workspace.",
      workspace.branch
        ? `- Você está em uma worktree isolada na branch ${workspace.branch}; não troque de branch.`
        : "- Você está compartilhando o workspace com outros agentes; minimize sobreposição e seja conservador.",
      "- Ao terminar, responda com um resumo curto do que mudou, testes executados e qualquer pendência."
    ].join("\n");
  }

  async commitAgentWork(mission, workspace, task) {
    if (mission.workspaceMode !== "worktree") return { changed: false, branch: null };
    const status = (await this.git(["status", "--porcelain"], workspace.cwd)).stdout.trim();
    if (!status) return { changed: false, branch: workspace.branch };

    await this.git(["add", "-A"], workspace.cwd);
    await this.git([
      "-c", "user.name=IMx",
      "-c", "user.email=imx@local",
      "commit",
      "-m", `imx(${slug(task.role)}): ${task.title.slice(0, 72)}`
    ], workspace.cwd);

    const head = (await this.git(["rev-parse", "HEAD"], workspace.cwd)).stdout.trim();
    return { changed: true, branch: workspace.branch, head };
  }

  async resolveMergeConflict(mission, branch) {
    const prompt = [
      "Você é o integrador do IMx.",
      `A integração da branch ${branch} gerou conflitos no workspace atual.`,
      "Resolva os conflitos preservando a intenção válida dos dois lados.",
      "Inspecione os arquivos em conflito, execute testes/build relevantes e deixe o repositório sem marcadores de conflito.",
      "Não aborte o merge. Não faça push nem deploy.",
      "Pode editar e testar, mas não altere trabalho não relacionado."
    ].join("\n");

    await this.runCodex(prompt, mission.resultPath, mission, {
      fullAuto: true,
      label: "PILOTO · integração"
    });

    const unresolved = (await this.git(["diff", "--name-only", "--diff-filter=U"], mission.resultPath)).stdout.trim();
    if (unresolved) throw new Error(`Conflitos não resolvidos: ${unresolved}`);

    const mergeHead = await this.git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], mission.resultPath)
      .then(() => true)
      .catch(() => false);

    if (mergeHead) {
      await this.git(["add", "-A"], mission.resultPath);
      await this.git([
        "-c", "user.name=IMx",
        "-c", "user.email=imx@local",
        "commit",
        "-m", `imx: integrate ${branch}`
      ], mission.resultPath);
    }
  }

  async mergeAgentBranches(mission, results) {
    if (mission.workspaceMode !== "worktree") return;

    mission.status = "integrating";
    this.emitMission("mission:status", mission);

    for (const result of results) {
      if (result.exit.status !== "done") {
        this.emitMission("mission:warning", mission, {
          message: `${result.task.role} encerrou com erro e não será integrado automaticamente.`
        });
        continue;
      }
      if (!result.commit?.changed || !result.commit.branch) continue;
      try {
        await this.git([
          "-c", "user.name=IMx",
          "-c", "user.email=imx@local",
          "merge",
          "--no-ff",
          result.commit.branch,
          "-m",
          `imx: merge ${result.task.role}`
        ], mission.resultPath);
      } catch (error) {
        this.emitMission("mission:warning", mission, {
          message: `Conflito ao integrar ${result.task.role}; o PILOTO tentará resolver automaticamente.`
        });
        await this.resolveMergeConflict(mission, result.commit.branch);
      }
    }
  }

  async finalReview(mission, results) {
    const statuses = results
      .map((item) => `- ${item.task.role}: ${item.exit.status} (exit ${item.exit.exitCode})`)
      .join("\n");

    const prompt = [
      "Você é o PILOTO do IMx em modo de revisão final.",
      "Somente inspecione o projeto. Não altere arquivos.",
      `Missão original: ${mission.brief}`,
      "Resultados dos agentes:",
      statuses,
      "",
      "Faça um resumo objetivo com: o que foi entregue, verificações que ainda devem ser feitas, riscos ou pendências.",
      mission.integrationBranch ? `O resultado integrado está na branch ${mission.integrationBranch}.` : ""
    ].join("\n");

    try {
      return await this.runCodex(prompt, mission.resultPath || mission.cwd, mission, {
        fullAuto: false,
        label: "PILOTO · revisão"
      });
    } catch (error) {
      return `Missão encerrada. A revisão automática final não pôde ser executada: ${error.message}`;
    }
  }

  startMission(input) {
    if (!this.codexPath) throw new Error("Codex CLI não encontrado no PATH do usuário.");
    if (!input?.brief?.trim()) throw new Error("Descreva a missão.");
    if (!input?.cwd) throw new Error("Selecione um workspace.");

    const mission = {
      id: crypto.randomUUID(),
      brief: input.brief.trim(),
      cwd: input.cwd,
      agentCount: clamp(input.agentCount, 1, 8),
      autoEdit: input.autoEdit !== false,
      status: "planning",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plan: null,
      agents: [],
      summary: "",
      attachments: (Array.isArray(input.attachments) ? input.attachments : [])
        .filter((item) => item && item.path && fs.existsSync(item.path))
        .slice(0, 20)
        .map((item) => ({
          path: item.path,
          name: item.name || path.basename(item.path),
          size: Number(item.size) || 0
        })),
      workspaceMode: "pending",
      canceled: false
    };

    this.missions.set(mission.id, mission);
    this.emitMission("mission:created", mission);
    this.executeMission(mission).catch((error) => {
      if (mission.canceled) return;
      mission.status = "error";
      mission.error = error.message;
      this.emitMission("mission:error", mission, { message: error.message });
    });

    return this.snapshot(mission);
  }

  async executeMission(mission) {
    mission.plan = await this.planMission(mission);
    if (mission.canceled) return;

    mission.status = "preparing";
    this.emitMission("mission:plan", mission, { plan: mission.plan });

    await this.prepareWorkspaces(mission);
    if (mission.canceled) return;

    mission.status = "running";
    this.emitMission("mission:status", mission);

    const runs = mission.plan.tasks.map(async (task, index) => {
      const workspace = mission.agentWorkspaces[index];
      const args = ["exec"];
      if (mission.autoEdit) args.push("--full-auto");
      args.push(this.buildAgentPrompt(mission, task, workspace));

      const agent = this.terminalManager.create({
        title: `${index + 1}. ${task.role}`,
        role: task.role,
        kind: "mission",
        cwd: workspace.cwd,
        command: this.codexPath,
        args,
        interactive: false,
        missionId: mission.id
      });

      mission.agents.push({ ...agent, taskId: task.id, branch: workspace.branch });
      this.emitMission("mission:agent", mission, { agent, task, branch: workspace.branch });

      const exit = await this.terminalManager.waitForExit(agent.id);
      const commit = await this.commitAgentWork(mission, workspace, task).catch((error) => ({
        changed: false,
        branch: workspace.branch,
        error: error.message
      }));

      return { task, workspace, agent, exit, commit };
    });

    const results = await Promise.all(runs);
    if (mission.canceled) return;

    await this.mergeAgentBranches(mission, results);
    if (mission.canceled) return;

    mission.status = "reviewing";
    this.emitMission("mission:status", mission);
    mission.summary = await this.finalReview(mission, results);

    mission.status = "done";
    mission.finishedAt = new Date().toISOString();
    this.emitMission("mission:completed", mission, { results });
  }

  cancelMission(missionId) {
    const mission = this.missions.get(missionId);
    if (!mission) return false;

    mission.canceled = true;
    mission.status = "canceled";
    mission.finishedAt = new Date().toISOString();

    const child = this.children.get(missionId);
    if (child) {
      try {
        child.kill("SIGTERM");
      } catch {}
      this.children.delete(missionId);
    }

    this.terminalManager.killMission(missionId);
    this.emitMission("mission:canceled", mission);
    return true;
  }
}

module.exports = { Orchestrator };
