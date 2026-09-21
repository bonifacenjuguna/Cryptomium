# priceping

Owner-only Telegram bot that posts milestone crypto price alerts to a
channel as branded image banners — one coin-colored card per coin, with
the ticker, direction arrow, and price.

## What it does

- Watches BTC, ETH, XRP, BNB, SOL, TRX, DOGE, ADA, LINK, TON, USDT, USDC
- Posts an image + caption to your channel whenever a coin crosses a
  round-number milestone (e.g. BTC every $500, configurable per coin)
- USDT/USDC use a depeg-band check instead (alerts if price strays too
  far from $1.00)
- You control everything via buttons in a private chat with the bot —
  set custom thresholds per coin, mute a coin indefinitely or until a
  specific time (defaults to Africa/Nairobi, or any timezone you specify)
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
6. Railway will run `npm run build` (downloads coin logos + font files
   into `/assets` once) and then `npm start`

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
bot (only `/start` is a slash command):

- **⚙️ Settings** — browse coins, view or edit each one's milestone
  threshold
- **🔕 Mute** — mute a coin indefinitely or until a specific time
  ("in 3 hours", "18:30", "9pm", or add a zone like "9pm EST" for a
  custom timezone)
- **📊 Status** — see every coin's current threshold and mute state at a
  glance

## Notes on the image banners

- Each coin's banner (1536x480) uses that coin's own known brand color as
  the full-bleed background (e.g. Bitcoin orange, Ethereum blue-purple)
- Only the direction arrow is colored — vivid green (rise) or red
  (fall). The ticker and price are white. All text has a soft dark
  outline behind it so it stays legible on any brand color (including
  light ones like BNB yellow and TRON's red)
- The coin logo has a thin white ring around it
- Coin logos are downloaded once at deploy time (`npm run build`) and
  stored locally; the Poppins font is bundled in `assets/fonts` — the bot
  never depends on external image or font hosts while actually posting
- If a coin's logo failed to download for any reason, that one banner
  falls back to a text-only layout rather than breaking the whole post
