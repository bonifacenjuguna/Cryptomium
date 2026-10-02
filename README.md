# priceping — live prices

A website where crypto prices update by themselves. No refresh button.

```
priceping/
├── backend/    Node + TypeScript. Polls prices, pushes them to browsers (SSE)
├── frontend/   Vite + React + TypeScript. The website
└── README.md
```

## How it stays live

```
Binance ─┐
Kraken  ─┼─► backend (polls every 2s) ──SSE──► browser ──► rows flash green/red
CoinGecko┘        keeps latest price           one open connection
```

- The **backend** asks the exchanges for prices every 2 seconds and keeps the latest value for each coin.
- Each browser opens **one** connection to `/api/stream`. Whenever a price changes, the backend pushes all prices down that connection. The browser never polls.
- **Price source:** Binance first, then Kraken for anything Binance lacks (USDT, USDC, ...), then CoinGecko as a last resort. **24h change** comes from Binance, otherwise CoinGecko.
- The 21 coins are the same ones the Telegram bot tracks (`backend/src/coins.ts`).
- The page reconnects on its own if the connection drops, and shows Live / Reconnecting in the corner.

## Run it locally

Needs Node 20.12 or newer.

```bash
npm run install:all    # installs backend + frontend (+ root helper)
npm install            # installs `concurrently` for the next command
npm run dev            # starts both
```

Open http://localhost:5173. The Vite dev server forwards `/api` to the backend on port 3001, so no setup is needed.

Or run them separately: `cd backend && npm install && npm run dev`, and `cd frontend && npm install && npm run dev`.

Useful backend URLs while developing:

| URL | What |
| --- | --- |
| `http://localhost:3001/health` | Is each price source working? |
| `http://localhost:3001/api/prices` | One-off JSON snapshot |
| `http://localhost:3001/api/stream` | The live stream (SSE) |

## Deploy

The two halves deploy to different places, because the backend keeps connections open and Vercel/Netlify functions can't do that.

### 1. Backend → Railway (or Render, Fly.io)

1. New project from this repo, set **Root Directory** to `backend`.
2. Build command `npm run build`, start command `npm start` (Railway detects both).
3. Variables (see `backend/.env.example`):
   - `CORS_ORIGIN` = your frontend URL, e.g. `https://priceping.vercel.app` (wildcards like `*.vercel.app` work, and `*` allows everyone)
   - `COINGECKO_API_KEY` = optional
4. Deploy, then copy the public URL. Check `<url>/health` shows `"ok": true`.

If Binance is blocked from your host's region, `/health` will show it failing; Kraken and CoinGecko then take over automatically. Choose a different region if you want Binance's speed.

### 2. Frontend → Vercel or Netlify (or both)

Set the **Root Directory / Base directory** to `frontend`, then add one variable:

```
VITE_API_URL = https://your-backend.up.railway.app
```

Redeploy after changing it (Vite bakes it in at build time). `vercel.json` and `netlify.toml` are already there. Deploying to both is fine; add both URLs to `CORS_ORIGIN`, comma separated.

The browser connects straight to the backend. Don't route `/api` through Vercel/Netlify rewrites, since they can buffer or time out streams.

## Notes

- Sparklines only show changes seen since the page was opened; there is no stored history yet.
- The backend holds prices in memory. There is no database.
- Logos load from a public icon CDN; coins it lacks fall back to a coloured badge.
