import http from 'node:http';
import type { ServerResponse } from 'node:http';
import { config } from './config.js';
import { COIN_META } from './coins.js';
import { getHealth, getQuotes, startPolling, stopPolling, subscribe, type CoinQuote } from './store.js';

const clients = new Set<ServerResponse>();

// ------------------------------------------------------------------ CORS

function originAllowed(origin: string): boolean {
  return config.corsOrigins.some(rule => {
    if (rule === '*') return true;
    if (rule.startsWith('*.')) {
      try {
        return new URL(origin).hostname.endsWith(rule.slice(1));
      } catch {
        return false;
      }
    }
    return rule.replace(/\/$/, '') === origin;
  });
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  const wildcard = config.corsOrigins.includes('*');
  if (wildcard) return { 'Access-Control-Allow-Origin': '*' };
  if (origin && originAllowed(origin)) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  return { Vary: 'Origin' };
}

// ------------------------------------------------------------------- SSE

function send(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const pricesPayload = (quotes: CoinQuote[]) => ({ t: Date.now(), quotes });

subscribe(quotes => {
  const payload = pricesPayload(quotes);
  for (const res of clients) send(res, 'prices', payload);
});

// A named event (not a comment) so the browser can tell the link is alive.
const heartbeat = setInterval(() => {
  for (const res of clients) send(res, 'ping', { t: Date.now() });
}, 15_000);
heartbeat.unref();

// ---------------------------------------------------------------- server

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const cors = corsHeaders(req.headers.origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' });
    return res.end();
  }
  if (req.method !== 'GET') {
    res.writeHead(405, cors);
    return res.end();
  }

  const json = (status: number, body: unknown) => {
    res.writeHead(status, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  switch (url.pathname) {
    case '/':
      res.writeHead(200, { ...cors, 'Content-Type': 'text/plain' });
      return res.end('priceping API. Stream: /api/stream  Snapshot: /api/prices  Health: /health\n');

    case '/health':
      return json(200, { ok: true, coins: getQuotes().length, clients: clients.size, sources: getHealth() });

    case '/api/prices':
      return json(200, { coins: COIN_META, ...pricesPayload(getQuotes()) });

    case '/api/stream': {
      res.writeHead(200, {
        ...cors,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // stop nginx-style proxies from buffering the stream
      });
      res.write('retry: 3000\n\n');
      send(res, 'hello', { coins: COIN_META });
      const current = getQuotes();
      if (current.length > 0) send(res, 'prices', pricesPayload(current));

      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    default:
      return json(404, { error: 'not found' });
  }
});

server.listen(config.port, () => {
  console.log(`[server] listening on :${config.port} (poll every ${config.pollIntervalMs}ms)`);
  startPolling();
});

function shutdown(): void {
  stopPolling();
  for (const res of clients) res.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
