# IMx

IMx é um cockpit desktop local para coordenar múltiplos agentes Codex em paralelo.

A ideia central é simples: você entrega uma missão ampla para o **PILOTO**, escolhe quantos agentes quer usar e o IMx divide o trabalho em responsabilidades especializadas. Cada agente roda em seu próprio terminal visível, com logs em tempo real.

## MVP

- Aplicação desktop local em Electron.
- Interface dark com identidade azul/ciano.
- PILOTO para decompor uma missão em tarefas paralelizáveis.
- 1 a 6 agentes configuráveis pela interface (arquitetura suporta até 8).
- Terminais reais usando `node-pty`.
- Codex CLI reutilizando o login já existente na máquina.
- Modo manual com terminal shell ou Codex interativo independente.
- Modo squad com planejamento, execução paralela, status, cancelamento e logs.
- Worktrees Git isoladas quando o projeto está limpo.
- Histórico local básico de missões.
- Resultado final em uma branch `imx/mission-<id>` e worktree de integração.

## Segurança

O IMx não ativa bypass irrestrito de permissões.

No modo squad, a opção **edição automática** habilita `codex exec --full-auto`, permitindo edição do workspace pelo agente dentro do sandbox apropriado. Sem essa opção, o Codex fica mais restrito.

O IMx não faz push, release ou deploy automaticamente.

## Requisitos

- Node.js 20+.
- Git.
- Codex CLI instalado e autenticado.

```bash
npm install -g @openai/codex
codex --version
```

## Rodar

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Fluxo

1. Abra o IMx.
2. Selecione a pasta do projeto.
3. Escolha a quantidade de agentes.
4. Descreva a missão para o PILOTO.
5. Clique em **INICIAR MISSÃO**.
6. Acompanhe cada terminal trabalhando em paralelo.
7. Ao final, abra a worktree/branch integrada indicada no painel.

Também é possível clicar em **+ Codex** para abrir um Codex interativo normal dentro de um pane, sem usar o PILOTO.

## Arquitetura

```text
Electron Main
├─ TerminalManager
│  ├─ node-pty
│  ├─ shell local
│  └─ Codex CLI
├─ Orchestrator / PILOTO
│  ├─ codex exec para planejamento
│  ├─ agentes paralelos
│  ├─ Git worktrees
│  └─ integração/revisão
├─ AppState
│  ├─ settings.json
│  └─ missions.json
└─ IPC via preload
   ↓
React + Vite
├─ cockpit
├─ missão/PILOTO
├─ panes xterm.js
└─ histórico/status
```

## Direção de produto

O MVP prioriza o núcleo:

**um comando → um squad → execução paralela → resultado integrado.**

Próximas evoluções:

- Codex app-server/SDK para streaming estruturado e aprovações;
- outros CLIs como Claude Code, Gemini e modelos locais;
- templates de squads;
- dependências entre tarefas e gates;
- custos/tokens quando houver dados confiáveis;
- memória compartilhada;
- browser/preview embutido;
- voz para comandar o PILOTO.
