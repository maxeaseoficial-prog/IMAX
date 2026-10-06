const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserBridge } = require('../electron/browser-bridge.cjs');
test('authenticated loopback bridge shares handlers and streams, rejects foreign origins and tokens', async () => {
  let writes = 0;
  const bridge = await new BrowserBridge({port:0, handlers:new Map([
    ['terminal:write', (_event, input) => { writes++; return input.data; }],
    ['browser:open', () => { throw Error('should never run'); }]
  ])}).start();
  const base = `http://127.0.0.1:${bridge.port}`;
  const headers = {Origin:'https://imax-two.vercel.app', Authorization:`Bearer ${bridge.token}`, 'Content-Type':'application/json'};
  const rpc = (patch={}, channel='terminal:write') => fetch(base+'/rpc', {method:'POST',headers:{...headers,...patch},body:JSON.stringify({channel,args:[{data:'echo test'}]})});
  try {
    assert.equal(bridge.server.address().address, '127.0.0.1');
    assert.equal((await rpc({Authorization:'Bearer invalid'})).status, 401);
    assert.equal((await rpc({Origin:'https://evil.example'})).status, 403);
    const deniedHost = await new Promise(resolve => {
      require('node:http').get(base+'/events', {headers:{...headers,Host:'evil.example'}}, res => { res.resume(); resolve(res.statusCode); });
    });
    assert.equal(deniedHost, 403);
    assert.equal((await rpc({}, 'browser:open')).status, 400);
    assert.equal((await rpc({}, 'unknown')).status, 400);
    assert.equal(writes, 0);
    assert.equal((await (await rpc()).json()).result, 'echo test');
    assert.equal(writes, 1);
    const preflight = await fetch(base+'/rpc', {method:'OPTIONS',headers:{Origin:headers.Origin}});
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers.get('access-control-allow-origin'),headers.Origin);
    const abort = new AbortController();
    const stream = await fetch(base+'/events', {headers,signal:abort.signal});
    const reader = stream.body.getReader(); await reader.read();
    bridge.broadcast('terminal:data',{id:'same-id',data:'hello'});
    assert.match(new TextDecoder().decode((await reader.read()).value), /same-id/);
    abort.abort();
    // Disconnecting a viewer must not invoke any terminal action.
    await new Promise(r=>setTimeout(r,30)); assert.equal(writes,1);
    const second = new AbortController();
    const restored = await fetch(base+'/events',{headers,signal:second.signal});
    assert.equal(restored.status,200); second.abort();
  } finally { bridge.close(); bridge.server.closeAllConnections(); }
});
test('first pairing requires local consent; foreign origins never prompt; revocation invalidates old credentials', async () => {
  let prompts=0; let allow=false;
  const bridge=await new BrowserBridge({port:0,handlers:new Map(),approvePairing:async()=>{prompts++;return allow;}}).start();
  const url=`http://127.0.0.1:${bridge.port}/pair`;
  const pair=(origin='https://imax-two.vercel.app')=>fetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
  try {
    assert.equal((await pair('https://evil.example')).status,403); assert.equal(prompts,0);
    assert.equal((await pair()).status,403); assert.equal(prompts,1);
    assert.equal((await pair()).status,429);
    bridge.lastPairing=0;allow=true;
    const approved=await pair(); assert.equal(approved.status,200);
    assert.equal((await approved.json()).token,bridge.token);
    const restart=new BrowserBridge({handlers:new Map(),token:bridge.token});
    assert.equal(restart.token,bridge.token);
    const revoked=new BrowserBridge({handlers:new Map()});
    assert.notEqual(revoked.token,bridge.token);
  } finally {bridge.close();bridge.server.closeAllConnections();}
});
