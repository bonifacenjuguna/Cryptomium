# Changelog

## v1.2.0 — the actual root cause

The real reason the bot never posted coin data, since the very first
version: **`bot.launch()` in Telegraf 4.x returns a promise that only
resolves when the bot *stops*** — it awaits the entire long-polling loop,
not just the startup handshake. Every prior version of `src/index.js`
awaited that promise directly before calling `startScheduler(bot)`,
which meant the scheduler was unreachable code — it would only run after
the bot had already been shut down. (v1.1.0's `launchWithRetry` fixed a
different, real bug — an undefined-function crash — but still had this
same underlying `await bot.launch()` problem baked in, so it wouldn't
have posted data either.)

Fixed by using Telegraf's `onLaunch` callback to resolve startup instead
of awaiting the launch promise, while still retrying on genuine 409
conflicts during Railway rolling deploys, and still detecting if the
polling loop later stops unexpectedly during normal operation.

**Also hardened:** if the custom font files ever fail to download at
deploy time, image generation now falls back to a generic sans-serif
font instead of throwing — which, given the pattern above, would
otherwise have silently failed every single post again. Plus a couple of
smaller defensive additions: `setMyCommands` failures no longer throw
unhandled, and a per-tick log line makes scheduler activity visible in
Railway's logs for future debugging.

## v1.1.0

**Bug fix:** the bot would connect to the channel successfully but never
post any milestone data afterward. Root cause: an incomplete edit had
left a call to an undefined `launchWithRetry` function in `src/index.js`,
which crashed the process on every boot (via `ReferenceError`) before the
price-polling scheduler ever started — after the one-time "Connected."
message had already gone out from an earlier, working boot. Fixed by
properly implementing `launchWithRetry`, which also now handles Telegram
409 conflicts during Railway rolling deploys with backoff instead of
crashing outright.

**Also hardened:** if both CoinGecko and Binance fail to return prices,
the bot now DMs the owner a one-time alert (rate-limited to once per 30
minutes) instead of only logging to a console the owner may not be
watching.

**Visual rework of the banner:**
- Only the arrow character (▲/▼) carries the direction color now; the
  ticker and price digits are always bold white on every coin, avoiding
  the readability clash on TRON (red) and USDT/USDC (green) that a fully
  colored price text had
- Banner height increased slightly (width/length unchanged at 1536px) so
  the inset card border reads as a subtle frame rather than a heavy dark
  bezel
- Added a thin white ring around each coin's logo for legibility when a
  logo's own art shares the card's brand color (e.g. Bitcoin's orange
  glyph on an orange card)
- Swapped the image font from Source Serif Pro (serif) to Space Grotesk
  (geometric sans-serif) — caption text is unaffected, since Telegram
  captions can't carry custom fonts anyway
