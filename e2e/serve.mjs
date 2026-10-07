// Static server for frontend/dist with Vercel-style clean URLs, plus mocked /api for browser tests.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
let DIST = '/home/claude/frontend/dist';
const coins = JSON.parse(fs.readFileSync(DIST + '/coins.json'));
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json', '.xml':'application/xml', '.txt':'text/plain' };
export function start(port = 4173) {
  const state = { offline: false, block: new Set(), hits: [], setDist(d) { DIST = d; } };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); state.hits.push(req.method + ' ' + u.pathname);
    if (u.pathname.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', '*');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      if (state.offline) { res.writeHead(503); return res.end('{}'); }
      res.setHeader('Content-Type', 'application/json');
      if (u.pathname === '/api/prices') {
        return res.end(JSON.stringify({ updatedAt: new Date().toISOString(), refreshMs: 5000, stale: false, coins: coins.map((c, i) => ({ ticker: c.ticker, name: c.name, price: 100000 / (i + 1) + 1.234, change24h: ((i * 37) % 17) - 8.1, stable: false, color: null, logo: null })) }));
      }
      if (u.pathname === '/api/push/key') { res.writeHead(404); return res.end('{"enabled":false}'); }
      res.writeHead(404); return res.end('{}');
    }
    if (state.block.has(u.pathname)) { res.writeHead(500); return res.end('blocked'); }
    let p = decodeURIComponent(u.pathname); if (/^\/coin\/[^/]+$/.test(p) && !fs.existsSync(path.join(DIST, p + '.html')) && !fs.existsSync(path.join(DIST, p, 'index.html'))) p = '/coin.html'; let f = path.join(DIST, p);
    const tries = [f, f + '.html', path.join(f, 'index.html')];
    const hit = tries.find(t => fs.existsSync(t) && fs.statSync(t).isFile());
    if (!hit) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(DIST + '/404.html')); }
    res.setHeader('Content-Type', types[path.extname(hit)] || 'application/octet-stream');
    if (hit.endsWith('sw.js')) res.setHeader('Service-Worker-Allowed', '/');
    res.end(fs.readFileSync(hit));
  });
  return new Promise(r => server.listen(port, () => r({ server, state, url: `http://localhost:${port}` })));
}
