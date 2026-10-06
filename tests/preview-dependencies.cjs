const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {PreviewManager,projectAt,missingDependencies}=require('../electron/preview-manager.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'imx-preview-deps-'));
const cwd=path.join(root,'Loja de carros');const bin=path.join(root,'bin');fs.mkdirSync(cwd);fs.mkdirSync(bin);
fs.mkdirSync(path.join(cwd,'node_modules'));
fs.writeFileSync(path.join(cwd,'package.json'),JSON.stringify({scripts:{dev:'vite'},devDependencies:{vite:'*','@vitejs/plugin-react':'*'}}));
const fakeNpm=path.join(bin,'npm');
fs.writeFileSync(fakeNpm,'#!'+process.execPath+'\n'+`
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const args=process.argv.slice(2);
fs.appendFileSync('commands.jsonl',JSON.stringify(args)+'\\n');
if(args[0]==='install') {
 if(process.env.SKIP_REPAIR==='1')process.exit(0);
 if(!args.includes('--include=dev'))process.exit(2);
 for(const name of ['vite','@vitejs/plugin-react']) {
  const folder=path.join('node_modules',name);fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'package.json'),JSON.stringify({name,version:'1.0.0',main:'index.js'}));
  fs.writeFileSync(path.join(folder,'index.js'),'module.exports={}');
 }
} else {
 const port=Number(args[args.indexOf('--port')+1]);
 const server=http.createServer((req,res)=>res.end('<h1>preview-ok</h1>'));
 server.listen(port,'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit()));
}
`,{mode:0o755});
const urls=[];const previews=new PreviewManager({baseEnv:{...process.env,PATH:bin+path.delimiter+process.env.PATH,NODE_ENV:'production'},openExternal:async url=>urls.push(url)});
(async()=>{
 assert.deepEqual(missingDependencies(projectAt(cwd)),['vite','@vitejs/plugin-react']);
 const first=await previews.open({id:'site',cwd});assert.match(await (await fetch(first.url)).text(),/preview-ok/);
 assert.deepEqual(missingDependencies(projectAt(cwd)),[]);
 let commands=fs.readFileSync(path.join(cwd,'commands.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(commands[0][0],'install');assert.ok(commands[0].includes('--include=dev'));assert.equal(commands[1][0],'run');
 await previews.stop('site');
 await previews.open({id:'site',cwd});
 commands=fs.readFileSync(path.join(cwd,'commands.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(commands.filter(c=>c[0]==='install').length,1);assert.equal(urls.length,2);
 await previews.stop('site');
 fs.rmSync(path.join(cwd,'node_modules','@vitejs/plugin-react'),{recursive:true,force:true});
 previews.baseEnv.SKIP_REPAIR='1';
 await assert.rejects(previews.open({id:'broken',cwd}),/Dependências ainda ausentes/);
 assert.equal(urls.length,2);
 console.log('PASS: incomplete node_modules triggers repair with dev dependencies, browser opens only after ready, installed project is reused; npm/server simulated.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await previews.dispose();fs.rmSync(root,{recursive:true,force:true})});
