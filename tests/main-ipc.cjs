const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const handlers={};const root=require('node:path').resolve(__dirname,'..');
const app={setName(){},whenReady(){return {then(){}}},on(){}};
const sandbox={require(name){if(name==='electron')return {app,ipcMain:{handle(name,fn){handlers[name]=fn}},dialog:{},shell:{}};if(name.startsWith('./'))return {};return require(name)},__dirname:root+'/electron',process,console};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync(root+'/electron/main.cjs','utf8'),sandbox);
const created=[],deleted=[];
const project=fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'imx-ipc-'));
vm.runInContext('orchestrator = { createMission(input) { return input; }, getMission() {return {id:"test",cwd:"'+project+'",status:"done"}}, renameMission(id,name){return {id,name}}, deleteMission(id){return true}, startMission(input){return input} }; previewManager = { stop:async()=>{}, open:async()=>({url:"http://127.0.0.1:1234"}) }; terminalManager = {killMission(){}}; state={getSettings(){return {}}};',sandbox);
vm.runInContext('registerIpc()',sandbox);
(async()=>{
 assert.throws(()=>handlers['mission:create'](null,{cwd:root,name:'Wrong'}),/fora da pasta/);
 assert.throws(()=>handlers['mission:create'](null,{cwd:require('node:path').dirname(root)}),/fora da pasta/);
 assert.equal(handlers['mission:create'](null,{cwd:project,name:'Site'}).name,'Site');
 assert.equal((await handlers['mission:preview'](null,'test')).url,'http://127.0.0.1:1234');
 assert.equal(await handlers['mission:delete'](null,'test'),true);
 console.log('PASS: IPC de projetos, bloqueio da própria pasta/ancestrais do IMx e abertura de prévia');
 fs.rmSync(project,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exitCode=1});
