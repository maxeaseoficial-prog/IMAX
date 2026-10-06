const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {Orchestrator}=require('../electron/orchestrator.cjs');const {AppState}=require('../electron/state.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'imx-agent-continuity-'));const repo=path.join(root,'site');fs.mkdirSync(repo);
function git(args,cwd=repo){return execFileSync('git',args,{cwd,encoding:'utf8'}).trim()}
git(['init','-b','main']);git(['config','user.name','Test']);git(['config','user.email','test@example.com']);fs.writeFileSync(path.join(repo,'index.html'),'<h1>Site</h1>');git(['add','.']);git(['commit','-m','initial']);const original=git(['rev-parse','HEAD']);
const state=new AppState(path.join(root,'state'));const calls=[],sessions=new Map();let nextId=0;
const terminalManager={
 create(input){const meta={...input,id:input.id||'agent-'+(++nextId),status:'running'};calls.push(meta);sessions.set(meta.id,meta);return meta},
 inject(){},getBuffer(id){return 'session id: '+(id==='agent-1'?'11111111-1111-1111-1111-111111111111':'22222222-2222-2222-2222-222222222222')},
 async waitForExit(id){const input=sessions.get(id);fs.writeFileSync(path.join(input.cwd,input.role+'.txt'),input.args.at(-1));return {status:'done',exitCode:0}},killMission(){}
};
function makeManager(){return new Orchestrator({terminalManager,state,codexPath:'fixture',baseEnv:process.env,worktreesRoot:path.join(root,'worktrees'),emit(){}})}
let manager=makeManager();
manager.planMission=async m=>({strategy:'test',tasks:Array.from({length:m.agentCount},(_,i)=>({id:'task-'+i,role:i?'Design':'Frontend',title:'Ajuste',instructions:m.currentRequest}))});
manager.finalReview=async()=>'Entrega revisada';
(async()=>{
 const draft=manager.createMission({cwd:repo,name:'Site',agentCount:2});
 manager.startMission({missionId:draft.id,brief:'Criar site',agentCount:2});await manager.executions.get(draft.id);await Promise.resolve();
 const first=state.getMission(draft.id);assert.equal(first.status,'done');assert.equal(first.workspaceMode,'worktree');
 const ids=first.agents.map(a=>a.id),paths=first.agents.map(a=>a.cwd);assert.equal(ids.length,2);assert.ok(first.agents.every(a=>a.sessionId));
 const next=manager.startMission({missionId:draft.id,brief:'Ajustar cores sem resetar',agentCount:6});assert.equal(next.agents.length,2);assert.equal(next.agentCount,2);
 await manager.executions.get(draft.id);await Promise.resolve();const second=state.getMission(draft.id);
 assert.equal(second.status,'done');assert.equal(second.workspaceMode,'worktree');assert.deepEqual(second.agents.map(a=>a.id),ids);assert.deepEqual(second.agents.map(a=>a.cwd),paths);
 for(const call of calls.slice(2)){assert.ok(call.args.includes('resume'));assert.ok(call.args.includes(second.agents.find(a=>a.id===call.id).sessionId));assert.ok(call.args.at(-1).includes('Ajustar cores sem resetar'))}
 assert.ok(fs.existsSync(path.join(second.resultPath,'Frontend.txt')));assert.ok(fs.existsSync(path.join(second.resultPath,'Design.txt')));assert.equal(git(['rev-parse','HEAD']),original);assert.equal(git(['branch','--show-current']),'main');
 // Closing a card while planning must not recreate it or shift another agent's slot.
 const callCount=calls.length;
 manager.startMission({missionId:draft.id,brief:'Ajuste final',agentCount:2});manager.closeAgent(ids[0]);
 await manager.executions.get(draft.id);await Promise.resolve();
 assert.deepEqual(calls.slice(callCount).map(a=>a.id),[ids[1]]);
 assert.deepEqual(state.getMission(draft.id).agents.map(a=>a.id),[ids[1]]);
 // Metadata survives reload; explicitly closed agents do not return.
 const restored=makeManager();restored.closeAgent(ids[0]);assert.deepEqual(state.getMission(draft.id).agents.map(a=>a.id),[ids[1]]);
 assert.equal(state.getMission(draft.id).agents[0].sessionId,second.agents[1].sessionId);
 console.log('PASS: two real Git rounds preserve agent IDs, workspaces, Codex resume IDs and accumulated files; user branch intact, close/reload persistence (CLI fixture).');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
