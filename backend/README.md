# Cryptomium bot and API

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

## Settings (environment variables)

Everything is set through environment variables, so changing a value never
needs a code edit. Only `BOT_TOKEN` and `OWNER_TELEGRAM_ID` are required (plus
the Postgres and Redis URLs that Railway fills in). The full list, with
comments, is in `.env.example`.

| Variable | Default | What it does |
|---|---|---|
| `POLL_INTERVAL_MS` | 30000 | How often prices are checked for alerts |
| `POST_DELAY_MS` | 1200 | Pause between banners |
| `MAX_AUTO_POSTS_PER_HOUR` | 0 (no cap) | Cap on automatic alerts per rolling hour |
| `MIN_POST_GAP_SECONDS` | 0 (off) | Minimum gap between alerts for the same coin |
| `ALERT_MAX_ATTEMPTS` | 5 | Tries for a failing alert before it is dropped |
| `POST_LOG_RETENTION_DAYS` | 365 | Post history older than this is deleted (0 = keep) |
| `SOURCE_ALERT_COOLDOWN_MIN` | 60 | Minutes between price-source heads-up DMs |
| `LOGO_RETRY_MIN` | 30 | Minutes between logo download retries |
| `API_ENABLED` | true | Turn the website API on or off |
| `ALLOWED_ORIGIN` | `*` | Site(s) allowed to call the API (your Vercel address) |
| `API_REFRESH_MS` | 5000 | Website refresh rate when the data source is Binance/Kraken first |
| `API_SLOW_REFRESH_MS` | 30000 | Website refresh rate for Auto, CoinGecko only, CoinPaprika, Average |
| `API_RATE_LIMIT_PER_MIN` | 240 | Requests per visitor per minute |
| `TRUSTED_PROXY_HOPS` | 1 | Reverse proxies in front of the API (Railway = 1) |
| `WATERMARK_HANDLE` | @cryptomiumx | Handle printed on banners, charts and captions |

Settings changed in Telegram (steps, modes, mutes, data source, logo style) are
saved in the database and are separate from these.

## Website dashboard

The bot also serves a read-only API that the `frontend/` folder (in the same
download) uses to show live prices with logos on a Vercel site.

1. Deploy this backend on Railway as usual. In the service's **Settings >
   Networking**, click **Generate Domain** so it has a public address.
2. Deploy the `frontend/` folder on Vercel (see its README). Put the Railway
   address in `frontend/site.config.json` (or set an `API_URL` environment
   variable in Vercel), then deploy.
3. Back in Railway, set `ALLOWED_ORIGIN` to your Vercel address so only your
   site can call the API.

Endpoints (all read-only):

| Endpoint | What it returns | Cached |
|---|---|---|
| `/api/prices` | live price + 24h change per coin | 5s / 30s (by data source) |
| `/api/market` | market cap, volume, 24h range, 7d change, 7d sparkline | 5 min |
| `/api/history/<TICKER>?range=24h\|7d\|30d\|90d\|1y` | price history for charts | 2 min to 6 h by range |
| `/api/alerts?limit=20&ticker=BTC` | latest automatic alerts the bot posted | 15 s |
| `/api/rates` | fiat exchange rates (currency switcher) | 1 h |
| `/api/logos/<TICKER>.png` | coin logo | browser 24 h |
| `/health` | `ok` | no |

If a refresh fails, the last good reading is served (with `"stale": true`) and the
failing source is not asked again for 30-60 seconds.

The website uses the data source you pick in Telegram (🌐 Data source), with
the same fallbacks as the bot. The default is **Binance first, CoinGecko as
backup**. Binance prices move in real time, so the dashboard changes every few
seconds; CoinGecko only updates about once a minute, so with Auto or CoinGecko
only the numbers will look still between updates. The status line on the
dashboard shows which source is in use.

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
  change, e.g. `▲ BTC $81,385 · 24h +1.23% @cryptomiumx`. If the 24h change isn't
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

### Factory reset

Settings > 🧹 Factory reset (asks you to confirm) erases every coin setting,
all mutes, the post history, the chosen data source and logo style, and the
channel connection, and puts the defaults back. Send /start afterwards to
connect your channel again.

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
| 🤖 Auto | — | CoinGecko, then Binance, Kraken, CoinPaprika if needed |
| 🦎 CoinGecko only | aggregator | never uses another source |
| 🟨 Binance first (default) | exchange | CoinGecko as backup (and for stablecoins) |
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
when the bot starts and every `LOGO_RETRY_MIN` minutes (default 30) after. You get a private message if
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
rendering (line/candlestick parsing, custom ranges, degenerate data), the
alert loop (retry-safe milestones, pacing, caps, overlapping polls) and the
website API.

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
