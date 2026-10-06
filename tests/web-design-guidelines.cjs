const assert = require('node:assert/strict');
const {Orchestrator} = require('../electron/orchestrator.cjs');
const {WEB_DESIGN_GUIDELINES} = require('../electron/web-design-guidelines.cjs');
let capturedFollowUp, waits=0;
const mission={id:'site',brief:'Criar loja rosa',currentRequest:'Criar loja rosa',round:1,cwd:'/tmp/site',agentCount:1,autoEdit:true,agents:[],messages:[]};
const task={id:'ui',title:'Página inicial',role:'Frontend',instructions:'Preservar conteúdo'};
const workspace={cwd:'/tmp/site',branch:'imx/site'};
const manager=new Orchestrator({state:{listMissions:()=>[],upsertMission(){}},codexPath:'fixture',baseEnv:process.env,worktreesRoot:'/tmp',emit(){},terminalManager:{
 inject(){},getBuffer(){return 'ok'},
 create(input){capturedFollowUp=input.args.at(-1)},
 async waitForExit(id){if(waits++===0)manager.agentRuns.get(id).queue.push('Ajustar Hero');return {status:'done',exitCode:0}}
}});
function check(prompt) {
 assert.ok(prompt.includes(WEB_DESIGN_GUIDELINES));
 assert.ok(prompt.includes('O briefing explícito'));
 assert.ok(prompt.includes('Não invente números'));
 assert.ok(prompt.includes('NÃO foram validados'));
 assert.equal(prompt.includes('[INSERIR]'),false);
}
(async()=>{
 manager.runCodex=async(prompt)=>{check(prompt);assert.ok(prompt.includes('Retorne SOMENTE JSON'));return JSON.stringify({summary:'Plano',strategy:'Direção de arte comum',tasks:[task]})};
 assert.equal((await manager.planMission(mission)).tasks.length,1);
 const agentPrompt=manager.buildAgentPrompt(mission,task,workspace);check(agentPrompt);assert.ok(agentPrompt.includes('Sua tarefa exclusiva'));
 manager.runCodex=async(prompt)=>{check(prompt);assert.ok(prompt.includes('Somente inspecione o projeto. Não altere arquivos.'));return 'Revisado'};
 assert.equal(await manager.finalReview(mission,[]),'Revisado');
 await manager.waitForAgentTurns(mission,task,workspace,{id:'agent',title:'Frontend',role:'Frontend'});
 check(capturedFollowUp);assert.ok(capturedFollowUp.includes('Ajustar Hero'));
 console.log('PASS: website art direction in planner, agent, follow-up and read-only review; briefing/QA limits preserved without placeholder leakage (no Codex calls).');
})().catch(error=>{console.error(error);process.exitCode=1});
