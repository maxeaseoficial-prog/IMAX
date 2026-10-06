# Missões e projetos

Use **+ Nova missão** na navegação para dar um nome ao projeto e selecionar uma pasta exclusiva. A pasta do IMx, suas subpastas e seus diretórios ancestrais não podem ser usados como workspace de uma missão. Uma pasta já associada a uma missão deve ser retomada pela entrada existente.

Clique com o botão direito em uma missão (ou use Shift+F10 com a entrada focada) para renomear ou excluir. A exclusão remove o histórico e encerra os terminais e a prévia associados; os arquivos do projeto e os worktrees são preservados. Cancele e aguarde uma execução ativa antes de excluir.

O chat do PILOTO permanece associado ao projeto. Depois de uma entrega, envie outro pedido no mesmo campo para planejar e distribuir os ajustes. A nova rodada parte do último resultado integrado e inclui a conversa recente no contexto de planejamento. Missões de outros projetos continuam separadas, inclusive seus terminais e rascunhos. O histórico é salvo entre aberturas do aplicativo; execuções interrompidas pelo encerramento podem receber um novo pedido.

**Abrir resultado** inicia uma prévia do resultado integrado e abre o navegador padrão em `http://127.0.0.1:<porta>`. São reconhecidos Vite, Next.js, React Scripts e HTML estático, na raiz ou nos diretórios comuns de frontend. Cada prévia usa uma porta própria, sem disputar a 5173 do IMx. Dependências ausentes de projetos Node são instaladas com npm; falhas e formatos não reconhecidos aparecem na interface. Projetos com backend ou serviços externos podem exigir configuração própria antes de serem visualizados.

Enviar outra rodada encerra a prévia anterior. Excluir a missão ou sair do IMx encerra seus servidores de prévia. O botão utiliza o navegador padrão configurado no sistema (Safari, Chrome ou outro).

## Verificação

Com as dependências do IMx instaladas:

```sh
npx tsc --noEmit
npm run build
node tests/projects.cjs
node tests/main-ipc.cjs
node tests/codex-workspaces.cjs
node tests/mission-metrics.cjs
node tests/mission-completion.cjs
node tests/web-design-guidelines.cjs
```

Os testes usam projetos temporários e não enviam missões ao Codex. A validação de Electron, node-pty e abertura do navegador padrão deve ser feita no desktop local.

## Pastas sem Git

Projetos novos podem começar em pastas sem repositório Git. O IMx passa `--skip-git-repo-check` ao planejamento, aos agentes e à retomada de execuções nas pastas selecionadas para a missão. Isso evita a recusa `Not inside a trusted directory`; não desativa o sandbox nem altera a política de aprovação. Sem Git, os agentes usam o modo de workspace compartilhado existente.

## Conclusão e tempos

Ao concluir uma rodada, o cabeçalho fixo mostra o botão azul **Abrir resultado** e a interface informa a conclusão. A parte inferior da entrega mostra o tempo total real da rodada (planejamento, preparação, agentes, integração e revisão), a estimativa de tempo serial e a economia estimada.

A comparação soma as durações medidas das tarefas e mantém o restante do tempo da rodada; a economia corresponde à sobreposição entre tarefas. Não é um benchmark de um único agente, que pode executar o trabalho de outra maneira. Com apenas um agente ou tarefas sem sobreposição, a economia estimada é zero. Dados históricos insuficientes aparecem como não disponíveis. Cada novo pedido reinicia a medição; o tempo de criação do projeto não é contado como tempo da rodada.

## Direção de arte dos sites

O PILOTO, os agentes, as instruções adicionais e a revisão final recebem diretrizes resumidas do prompt-mestre de Henrique, em `electron/web-design-guidelines.cjs`. A referência completa está em `docs/web-design-master.md`. As regras se aplicam às tarefas de web/UI; o briefing e o escopo explícitos prevalecem. Não impõem a identidade do IMx aos sites. A revisão final permanece somente leitura, e os agentes devem declarar limitações de QA visual.
