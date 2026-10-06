# IMAX no navegador

O site https://imax-two.vercel.app pode controlar as mesmas sessões do IMAX no Mac.
Esta primeira versão funciona no navegador do próprio Mac. Não oferece acesso de
outro computador nem executa agentes na Vercel.

## Uso

1. Atualize o aplicativo desktop com esta implementação e inicie `npm run dev`.
2. No cabeçalho, clique **Abrir no navegador**.
3. O navegador padrão abre a página com um pareamento temporário. Use Chrome e
   autorize o acesso à rede local se ele solicitar. O código de pareamento é
   removido da barra de endereço e mantido apenas na sessão dessa aba.
4. O painel mostra as missões e terminais existentes. O seletor de pastas e anexos
   aparece no Mac. Abrir resultado também usa o navegador padrão do Mac.
5. Fechar a aba não mata os terminais. Reconectar restaura o buffer e a missão.
6. **Desconectar navegador** revoga o pareamento e fecha as conexões. Um novo
   clique em Abrir no navegador gera um novo token. Fechar o IMAX encerra tudo.

O navegador padrão é usado; se ele for Safari, copie a URL de pareamento para o
Chrome antes de ela ser consumida, ou configure Chrome como navegador padrão.
Não compartilhe essa URL: ela dá acesso aos terminais durante esse pareamento.

## Implementação

Electron é a autoridade de estado, PTYs, processos Codex e persistência. Os mesmos
handlers atendem IPC desktop e RPC autenticado. A ponte escuta exclusivamente em
127.0.0.1:47831, somente depois de uma ação do usuário. HTTP POST envia operações;
fetch com SSE recebe eventos. CORS aceita apenas os dois domínios de produção
explicitamente listados. Host e token aleatório de 256 bits são verificados;
rotas de pareamento não são expostas por RPC. Não há comandos repetidos ao reconectar.
Clientes lentos são desconectados e o limite é de oito espectadores simultâneos.

A Vercel hospeda apenas React, sem tokens de Codex ou arquivos de projetos.
O token de conexão não vai em query string, cookie ou log. O acesso via web tem
os mesmos poderes do usuário local pareado. Os testes usam processos simulados
para não gastar cota Codex. Validação nativa de Electron/Chrome no Mac é necessária.

## Verificação

- `node --test tests/browser-bridge.cjs tests/main-ipc.cjs tests/terminal-history.cjs tests/agent-continuity.cjs`
- `node --experimental-strip-types tests/browser-client.mts` (Node 22.6+)
- `npx tsc --noEmit`
- `npm run build`

Os repositórios maxeaseoficial-prog/IMAX (feat/imx-mvp) e HeadHenrique/imax
(main da cópia web) não têm sincronização automática entre si. A Vercel acompanha
HeadHenrique/imax. Mudanças no desktop devem manter o contrato de IPC/RPC compatível.
