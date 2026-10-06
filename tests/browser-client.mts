import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {connectBrowser} from '../src/browser-client.ts';
const require=createRequire(import.meta.url);
const {BrowserBridge}=require('../electron/browser-bridge.cjs');
let writes=0;
const bridge=await new BrowserBridge({port:0,handlers:new Map([
 ['terminal:write',(_event:any,{data}:any)=>{ writes++; return data==='hello'; }],
 ['terminal:buffer',()=> 'previous output'],
 ['terminal:list',()=>[{id:'persistent-terminal'}]]
])}).start();
const originalFetch=globalThis.fetch;
globalThis.fetch=((url:any,init:any)=>originalFetch(String(url).replace(':47831',':'+bridge.port),{...init,headers:{...init.headers,Origin:'https://imax-two.vercel.app'}})) as typeof fetch;
let connection:any;
try {
 let disconnected!:()=>void;
 const lost=new Promise<void>(resolve=>{disconnected=resolve;});
 connection=await connectBrowser(bridge.token,disconnected);
 let received!: (value:any)=>void;
 const output=new Promise(resolve=>{received=resolve;});
 connection.api.onTerminalData(received);
 connection.start();
 assert.equal(await connection.api.getTerminalBuffer('persistent-terminal'),'previous output');
 assert.equal(await connection.api.writeTerminal('persistent-terminal','hello'),true);
 bridge.broadcast('terminal:data',{id:'persistent-terminal',data:'new output'});
 assert.deepEqual(await output,{id:'persistent-terminal',data:'new output'});
 bridge.close();
 await lost;
 assert.equal(writes,1);
 console.log('PASS: browser adapter sends input once, restores buffer, receives live output and detects disconnect.');
} finally { connection?.close(); globalThis.fetch=originalFetch; bridge.close(); bridge.server.closeAllConnections(); }
