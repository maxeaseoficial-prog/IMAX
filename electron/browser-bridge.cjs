const http = require('node:http');
const crypto = require('node:crypto');
const ORIGINS = new Set(['https://imax-two.vercel.app', 'https://imax-trendradar1.vercel.app']);
class BrowserBridge {
  constructor({ handlers, port = 47831 }) {
    this.handlers = handlers; this.port = port; this.clients = new Set();
    this.token = crypto.randomBytes(32).toString('hex');
    this.server = http.createServer((req, res) => void this.handle(req, res));
  }
  async start() {
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port, '127.0.0.1', resolve); });
    this.port = this.server.address().port;
    return this;
  }
  async handle(req, res) {
    const json = (status, body) => { res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
    const origin = req.headers.origin;
    if (req.headers.host !== `127.0.0.1:${this.port}` || !ORIGINS.has(origin)) return json(403, {error:'Origem não autorizada.'});
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${this.token}`);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return json(401, {error:'Pareamento inválido. Abra o navegador pelo IMAX novamente.'});
    if (req.method === 'GET' && req.url === '/events') {
      if (this.clients.size >= 8) return json(429, {error:'Limite de conexões atingido.'});
      res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});
      res.write('data: {"channel":"bridge:ready"}\n\n'); this.clients.add(res);
      const timer = setInterval(() => res.write(': ping\n\n'), 15000);
      res.on('close', () => { clearInterval(timer); this.clients.delete(res); });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/rpc') return json(404, {error:'Rota não encontrada.'});
    if (!String(req.headers['content-type']).startsWith('application/json')) return json(415, {error:'JSON necessário.'});
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1024 * 1024) { json(413, {error:'Pedido muito grande.'}); return; } }
      const {channel, args = []} = JSON.parse(body);
      if (!Array.isArray(args) || args.length > 3 || !this.handlers.has(channel) || channel.startsWith('browser:')) return json(400, {error:'Operação não permitida.'});
      const result = await this.handlers.get(channel)(null, ...args);
      json(200, {result: result === undefined ? null : result});
    } catch (error) { if (!res.headersSent) json(400, {error:error.message || 'Falha na operação.'}); }
  }
  broadcast(channel, payload) {
    const message = `data: ${JSON.stringify({channel, payload})}\n\n`;
    for (const client of this.clients) { if (client.writableLength > 1024 * 1024) client.destroy(); else client.write(message); }
  }
  close() { for (const client of this.clients) client.destroy(); this.clients.clear(); this.server.close(); }
}
module.exports = {BrowserBridge};
