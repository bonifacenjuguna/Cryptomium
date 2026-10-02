# priceping

Owner-only Telegram bot that posts milestone crypto price alerts to a
channel as branded image banners — one coin-colored card per coin, with
the ticker, direction arrow, and price.

## What it does

- Watches BTC, ETH, XRP, BNB, SOL, TRX, DOGE, ADA, LINK, TON, AVAX, SUI, XLM,
  HBAR, DOT, UNI, LTC, ZEC, HYPE, USDT, USDC (21 coins)
- Prices can come from CoinGecko, Binance, Kraken, CoinPaprika, or a real-time
  blend of the first three (see Data source below) — Auto tries the first
  four in order
- Posts an image + caption to your channel whenever a coin crosses a
  milestone — either a dollar step (e.g. BTC every $500) or a percentage
  step (e.g. BTC every 0.5%), configurable per coin
- Four alert **modes** scale each coin's step up or down (see below)
- USDT/USDC use a depeg-band check instead (alerts if price strays too
  far from $1.00)
- You control everything via buttons in a private chat with the bot —
  steps, modes, mute (one coin, several, or all), live prices, posting
  current prices to the channel, price sources, and a test banner. Mutes can be indefinite or until a specific time (defaults to
  Africa/Nairobi, or any timezone you specify)
- Only you (the configured owner) can interact with the bot at all

## One-time setup

### 1. Create the bot

Talk to [@BotFather](https://t.me/BotFather) on Telegram, create a new
bot, and copy the token it gives you.

### 2. Find your Telegram user ID

Message [@userinfobot](https://t.me/userinfobot) — it replies with your
numeric ID. That's `OWNER_TELEGRAM_ID`.

### 3. Deploy to Railway

1. Push this project to a GitHub repo (or use Railway's CLI to deploy
   directly)
2. In Railway, create a new project from that repo
3. Add a **Postgres** plugin to the project
4. Add a **Redis** plugin to the project
5. Set the environment variables from `.env.example` in the Railway
   service settings (`BOT_TOKEN`, `OWNER_TELEGRAM_ID` — Railway wires up
   `DATABASE_URL` and `REDIS_URL` automatically once you add those
   plugins)
6. Railway will run `npm run build` (downloads coin logos
   into `/assets`) and then `npm start`. Any logo the build couldn't get is
   retried automatically when the bot starts (see "Coin logos" below)

### 4. Enable Redis keyspace notifications (for auto-unmute)

Scheduled mutes rely on Redis firing an event the instant their timer
expires, so the bot can lift the mute immediately rather than waiting for
the next price check. The bot tries to configure this itself on boot, but
some managed Redis plans block `CONFIG SET` from clients. If scheduled
mutes don't seem to auto-lift, connect to your Railway Redis instance's
CLI and run:

```
CONFIG SET notify-keyspace-events Ex
```

### 5. Connect the bot to your channel

1. Add the bot to your Telegram channel as an **admin** (it needs "Post
   Messages" permission)
2. Open a private chat with the bot and send `/start`
3. Forward any message from the channel into that chat (or just send the
   channel's `@username`)
4. The bot confirms the connection to you privately, then posts a
   one-time "Connected." message in the channel itself so you can see it
   went through

That confirmation post only happens the first time you connect (or if you
later reconnect to a different channel) — it never reposts on ordinary
redeploys or restarts.

## Using the bot

Once connected, everything is button-driven in your private chat with the
bot (only `/start` is a slash command). The menu:

```
[💰 Prices]   [📣 Post prices]
[📊 Status]   [⚙️ Settings]
[🔕 Mute]     [🧪 Test banner]
```

- **💰 Prices** — live price, step and mode for every coin, with a refresh
  button (and a shortcut to Post prices). It's a normal formatted message
  (not a code block), so Refresh edits it in place instead of failing to
  update
- **📣 Post prices** — post the *current* price of one coin, or of all coins,
  to the channel. You confirm first. Each banner uses the live price, and the
  chip shows the 24h direction (green up / red down); the caption adds the 24h
  change, e.g. `▲ BTC $81,385 · 24h +1.23% @priceping`. If the 24h change isn't
  available the banner simply has no chip
- **📊 Chart** (inside 📣 Post prices) — a price-history chart for one coin:
  pick the coin, a time range (24H/7D/30D/90D/1Y or a custom day count), then
  📈 Line or 🕯️ Candlesticks. **Nothing renders until you tap a style** — picking
  a coin or a range alone never fetches or draws anything. The rendered chart
  is shown to you first, with a button to post it to the channel
- **📊 Status** — every coin's step and mute state at a glance, e.g.
  `BTC — 0.5% 🔔`, `ETH — 0.75% 🔔`, `SOL — 0.5% 💨 🔔` (a coin that isn't
  on Steady also shows its mode icon). Two buttons underneath: **📈 Post
  history** and **🔭 Next alert** (see below)
- **⚙️ Settings** — per coin: edit the base step, switch between `$` steps
  and `%` steps, and choose a mode. "Modes · all coins" and "% / $ · all
  coins" change every coin at once. Also **🌐 Data source** and
  **🖼️ Logo style** (see below)
- **🔕 Mute** — mute or unmute one coin, **all** coins, or **several**
  (tick the ones you want). Durations: until you unmute, or until a time
  ("in 3 hours", "18:30", "9pm", or add a zone like "9pm EST")
- **🧪 Test banner** — pick a coin, then Rise, Fall, or a custom price. The
  preview is sent only to you, never to the channel. A **🖼️ Style** row lets
  you flip between ✨ Clean and ⚪ White ring for just that preview, without
  changing your saved default (Settings > Logo style)

### Post history & Next alert

Two screens reached from **📊 Status**:

- **📈 Post history** — how many banners have actually been sent, over
  **Last 24 hours / 7 days / 30 days / All time**, split into automatic
  milestone alerts vs. manual 📣 Post prices sends, with a per-coin
  breakdown. This is how you answer "how many posts went out this week?"
- **🔭 Next alert** — for every unmuted coin, how close the current price is
  to triggering in each direction right now, e.g. `ETH ▲ +$23.90 · ▼ -$26.10`
  (or in % for a percent-step coin). Muted coins are hidden from the list.
  Useful for judging whether a coin's step/mode is calibrated the way you want

### Steps and modes

Each coin has a **base step (x)**, either in dollars (`$500` for BTC) or in
percent (`0.5%` for BTC). A **mode** multiplies it:

| Mode | Multiplier | BTC at $500 / 0.5% |
|---|---|---|
| 🚀 Hyper | ¼x | $125 / 0.125% |
| 💨 Fast | ½x | $250 / 0.25% |
| 🎯 Steady (default) | x | $500 / 0.5% |
| 😌 Calm | 2x | $1,000 / 1% |

- **$ steps**: alerts when the price crosses a round-number level; the
  banner shows that level
- **% steps**: alerts each time the price has moved that % from the last
  alert (up or down); the banner shows the actual price
- Default % steps: BTC 0.5%, ETH 0.75%, XRP 1%, BNB 0.75%, SOL 1%, the rest
  1% (USDT/USDC 0.5%). New coins default to a sensible starting % too (see
  `src/config.js`) but you'll likely want to tune them to your own targets.
  Existing coins stay on `$` steps until you switch
- Switching between $ and % restarts a coin from its current price, so it
  never fires an instant alert
- For USDT/USDC the step is the depeg band (± dollars, or ± percent)

### Data source (where prices come from)

Prices are fetched every 30 seconds. **Settings > 🌐 Data source** lets you
choose:

| Option | Role | Behavior |
|---|---|---|
| 🤖 Auto (default) | — | CoinGecko, then Binance, Kraken, CoinPaprika if needed |
| 🦎 CoinGecko only | aggregator | never uses another source |
| 🟨 Binance first | exchange | CoinGecko as backup (and for stablecoins) |
| 🐙 Kraken first | exchange | CoinGecko as backup |
| 🌶️ CoinPaprika first | aggregator | CoinGecko as backup |
| 🧮 Average price | blend | CoinGecko + Binance + Kraken at once, midpoint of the range |

**Why Auto only reaches CoinPaprika as a last resort:** its free tier
(~20-25k calls/month) can't sustain 30-second polling as a steady live feed —
it's still a real pick (and used by 🔍 Test sources), but Auto only calls it
if CoinGecko, Binance **and** Kraken all fail at once, which is rare enough to
stay well inside its quota.

- Every source's choice is saved and survives a restart
- **CoinGecko API key**: if `COINGECKO_API_KEY` is set, the bot uses it and
  auto-detects whether it's a free **Demo** key (`api.coingecko.com`) or a
  paid **Pro** key (`pro-api.coingecko.com`) — these use different hosts and
  header names, and a Pro key sent to the Demo host (or vice versa) is simply
  rejected. The bot tries Demo first and, only if that's rejected, tries Pro
  once and remembers whichever worked. **This means upgrading to a paid
  CoinGecko plan needs no code or settings change** — just keep
  `COINGECKO_API_KEY` set to whatever key you have (if CoinGecko issues you a
  brand new key string on upgrade rather than upgrading the same one, paste
  that new value into the same Railway variable; nothing else changes)
- **🧮 Average price** queries CoinGecko, Binance and Kraken concurrently
  (CoinPaprika is deliberately left out here too, for the same quota reason)
  and uses **(lowest + highest) ÷ 2** as the price for milestones and banners.
  The 💰 Prices screen shows the full range next to the result, e.g.
  `$86,700–$86,820 → $86,760`, so the spread itself is visible, not just the
  blended number. Still works if one of the three sources fails; only errors
  if all three do
- **Stablecoins (USDT, USDC)** come from CoinGecko or Kraken — both are real
  fiat-rail exchanges/aggregators that quote them in actual dollars. Binance
  never supplies them: it has no USDT/USD pair, and its USDC price is
  measured in USDT, which could cause a false depeg alert
- **Binance** is tried on two hosts (`api.binance.com`, then
  `data-api.binance.vision`) because the first is blocked from some server
  regions — Binance's main address is always tried first on every attempt (not
  skipped even if it failed before), so if you ever change your server's
  region and it becomes reachable again, the bot picks that up automatically
- **Kraken** batches all coins in one call; if even one requested pair name
  is invalid it retries once against Kraken's whole market and filters
  client-side, the same resilience Binance already has for an unknown symbol.
  BNB and HYPE are skipped (not listed on Kraken) and filled from the backup
- **🔍 Test sources** checks all five providers right now and shows ✅ / ❌,
  the response time and how many coins came back — the way to confirm a
  backup actually works from your server. If Binance's main address is
  blocked but its data address works, both attempts are listed so you can see
  why
- You get a private message when the main source starts failing (after 2 bad
  readings in a row) and when it recovers (after 3 good ones), and a 🚨
  message if every source is failing. Messages are limited to one per hour
  per kind

### Logo style

**Settings > 🖼️ Logo style** switches how the coin logo is framed on banners:
✨ **Clean** (default — no ring; a soft white glow and a crisp bright border
give it definition against the background without a hard margin) or
⚪ **White ring** (a full white margin around the logo — the earlier look).
Use 🧪 Test banner's own style toggle to compare them on a real coin before
committing to one in Settings.

### Price format

One rule for banners, captions and the Prices screen (dynamic precision):

| Price | Shown as |
|---|---|
| $10,000 and up | no decimals — `$86,019` |
| $1 to $10,000 | 2 decimals — `$4,021.45` |
| $0.01 to $1 | 3 decimals — `$0.096` |
| below $0.01 | 4 significant digits — `$0.00001234` |
| USDT / USDC | 3 decimals — `$0.994` (so a depeg is visible) |

### Charts

📣 Post prices > 📊 Chart renders a price-history chart for one coin, styled
dark and gridded (the same visual language as most trading platforms — not a
pixel-for-pixel clone, but a real, detailed, labeled chart: title, current
price, colored period change, a labeled price axis and time axis, and a
watermark).

- **Ranges**: 24H, 7D, 30D, 90D, 1Y, or a custom day count (1-365 — CoinGecko's
  free tier only keeps a year of history)
- **Styles**: 📈 Line (gradient-filled, from CoinGecko's finer-grained price
  history) or 🕯️ Candlesticks (open/high/low/close, from CoinGecko's OHLC
  endpoint — green up, red down). Candlesticks aren't available for a custom
  range (CoinGecko's OHLC endpoint only accepts fixed day counts); picking
  candles for a custom range quietly renders a line chart instead and says so
- **Nothing is automatic**: picking a coin or a range alone never fetches or
  renders anything — only tapping a style button does, and it's shown to you
  first with a "📣 Post to channel" button, never posted directly

### Coin logos

Logos are downloaded in one CoinGecko request (with retries and fallback
icon sources) at build time, and any that are still missing are fetched again
when the bot starts and every 30 minutes after. You get a private message if
some still can't be downloaded. Meanwhile a banner shows a coin-colored
badge with the ticker instead of the logo, so it never looks empty. Setting
the optional `COINGECKO_API_KEY` (a free demo key) raises CoinGecko's rate
limit.

### Tests

```
npm test
```

Covers the step/mode logic (dollar, percent, stablecoin), the next-alert
distance math, input parsing, price formatting and captions, the logo
downloader (rate limits, retries, fallbacks), all five price sources
(response parsing, the Average price blend, the CoinGecko Demo/Pro
auto-detection, fallback chains, health alerts), and chart data-fetching and
rendering (line/candlestick parsing, custom ranges, degenerate data).

## Previews

**Current banners (1.4.0)** — top: Bitcoin, ✨ Clean logo style (reworked —
a soft glow and a crisp border give the logo definition without a white
ring); middle: DOGE with a fall chip (the coin-colored ticker badge used
when a logo file hasn't downloaded; with the logo present, the real logo is
shown); bottom: Bitcoin in the optional ⚪ White ring style. Everything is
derived from each coin's own brand color, so it applies to every coin
automatically.

![Current banners](docs/previews/current-banners.png)

**Earlier layout (1.0.10)** — much larger logo, smaller price. Top: rise, bottom:
fall.

![Layout 1.0.10](docs/previews/final-layout.png)

**Other coins (1.0.10)** — same engine (letter circles stand in for real
logos).

![Other coins](docs/previews/other-coins.png)

**Earlier still** — the version with the chip inline right after the ticker.

![Earlier layout](docs/previews/previous-layout.png)

## Notes on the image banners

- Each coin's banner (1600x418) has a web-style glowing gradient built
  from that coin's brand color: a base that stays true to the brand hue,
  soft luminous light orbs, and a glass-like diagonal sheen — deliberately
  not the flat brand color, so the logo stands out
- Layout: a small coin logo on the left, vertically centered; to its right
  the ticker (bold, letter-spaced), a clear gap, then a big price, both
  left-aligned (the price shrinks automatically only if it would be too
  wide, e.g. $123,456). A direction chip sits up and to the right of the ticker,
  overhanging the price's right edge slightly. The chip is a small vivid
  green (rise) or red (fall) pill with a white arrow inside — the arrow is
  always white. For coins whose brand color is close to the chip's (TRON
  red, USDT green) the background is kept darker so the chip never
  disappears into it
- Text is white with a subtle pearl gradient and a soft brand-tinted
  shadow — no outlines
- The coin logo has two selectable framings (Settings > 🖼️ Logo style): a
  pearl-white circular margin with a soft drop shadow (⚪ White ring), or
  (✨ Clean, default) no margin — a soft white glow plus a crisp bright
  border give it definition instead. Nothing darkens the logo itself
- Coin logos are stored locally and the Poppins font is bundled in
  `assets/fonts` — posting a banner never waits on an external image or font
  host
- If a coin's logo file is missing, that banner uses a coin-colored ticker
  badge instead of the logo rather than breaking the post

---

# Live prices website (`frontend/` + `backend/`)

Alongside the Telegram bot, this repo contains a website where the same 21 coins update in real time with no page refresh. The bot (everything at the repo root: `src/`, `scripts/`, `test/`, ...) is unchanged and deploys exactly as before.

```
priceping/
├── src/ scripts/ test/ assets/ ...   Telegram bot (unchanged)
├── backend/                          Node + TypeScript: polls prices, pushes them to browsers (SSE)
├── frontend/                         Vite + React + TypeScript: the website
└── README.md
```

## How it stays live

```
Binance ─┐
Kraken  ─┼─► backend (polls every 2s) ──SSE──► browser ──► rows flash green/red
CoinGecko┘        keeps latest price           one open connection
```

- The backend asks the exchanges for prices every 2 seconds and keeps the latest value per coin.
- Each browser opens one connection to `/api/stream`. When a price changes, the backend pushes all prices down it. The browser never polls.
- Price source: Binance first, then Kraken for what Binance lacks (USDT, USDC), then CoinGecko as a last resort. 24h change comes from Binance, otherwise CoinGecko.
- The coins are the same ones the bot tracks (`backend/src/coins.ts`).
- The page reconnects on its own if the connection drops.

## Run the website locally

Needs Node 20.12 or newer. Use two terminals:

```bash
cd backend  && npm install && npm run dev     # API on :3001
cd frontend && npm install && npm run dev     # site on :5173
```

Open http://localhost:5173 (Vite forwards `/api` to the backend, so no setup is needed). Handy backend URLs: `/health` (is each price source up?), `/api/prices` (JSON snapshot), `/api/stream` (the live stream).

## Deploy the website

Three separate services from this one repo. The bot's Railway service (Root Directory = repo root) stays as it is.

1. **Backend: Railway** (or Render, Fly.io). New service from this repo, Root Directory `backend`. It detects `npm run build` and `npm start`. Variables (see `backend/.env.example`): `CORS_ORIGIN` = your frontend URL (`https://x.vercel.app`; wildcards like `*.vercel.app` work); `COINGECKO_API_KEY` optional. Generate a public domain and check `<url>/health` shows `"ok": true`.
2. **Frontend: Vercel or Netlify (or both).** Root/Base directory `frontend`. Add `VITE_API_URL` = the backend URL (no trailing slash), then deploy. Redeploy after changing it, because Vite bakes it in at build time. `vercel.json` and `netlify.toml` are included.
3. Put the frontend URL(s) in the backend's `CORS_ORIGIN` (comma separated if more than one).

Vercel and Netlify can't host the backend (it keeps connections open), and the browser should connect to it directly rather than through their rewrites.

Tip: a push that only changes `frontend/` or `backend/` will also redeploy the bot's service. In the bot's Railway settings you can add watch paths (`/src`, `/scripts`, `/assets`, `/package.json`) to avoid that.

## Website notes

- Sparklines only show changes since the page was opened; there is no stored history yet.
- Prices are held in memory; there is no database for the website.
- Logos load from a public icon CDN; coins it lacks fall back to a coloured badge.
