const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {once}=require('node:events');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'imx-terminal-history-'));
const processes=[];
const pty={spawn(){const p={onData(fn){this.data=fn},onExit(fn){this.exit=fn},kill(){this.exit({exitCode:0,signal:0})},resize(){},write(){}};processes.push(p);return p}};
const sandbox={require:name=>name==='node-pty'?pty:require(name),module:{exports:{}},process,console};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/terminal-manager.cjs'),'utf8'),sandbox);
const {TerminalManager}=sandbox.module.exports;
const options={logsDir:root,baseEnv:process.env};
(async()=>{
 const m=new TerminalManager(options);const agent=m.create({id:'agent',missionId:'one',kind:'mission',title:'Frontend',interactive:false});
 processes[0].data('primeira conversa\r\n\x1b[');processes[0].data('2Jhistórico preservado\r\n');
 const stream=m.sessions.get(agent.id).log;processes[0].exit({exitCode:0,signal:0});await once(stream,'finish');
 assert.equal(m.list().length,1);assert.match(m.getBuffer('agent'),/primeira conversa/);assert.equal(m.getBuffer('agent').includes('\x1b[2J'),false);
 m.inject('agent','pedido de ajuste\r\n');m.create({...agent});
 assert.throws(()=>m.create({...agent}),/já está executando/);
 processes[1].data('segunda conversa\r\n');const stream2=m.sessions.get('agent').log;processes[1].exit({exitCode:0,signal:0});await once(stream2,'finish');
 const restored=new TerminalManager(options);assert.equal(restored.list()[0].id,'agent');
 assert.match(restored.getBuffer('agent'),/primeira conversa[\s\S]*pedido de ajuste[\s\S]*segunda conversa/);
 // Cancel/quit preserves the card and transcript; X explicitly removes it.
 restored.create({...agent});const stream3=restored.sessions.get('agent').log;restored.killMission('one');await once(stream3,'finish');
 assert.equal(restored.list()[0].status,'stopped');assert.match(restored.getBuffer('agent'),/segunda conversa/);
 restored.kill('agent');assert.equal(restored.list().length,0);
 assert.equal(new TerminalManager(options).list().length,0);
 console.log('PASS: completed terminal retained, same ID appends history, restart restores logs, cancel preserves and X removes (PTY fixture).');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
