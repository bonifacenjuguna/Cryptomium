# Changelog

## 1.4.0

**Fixed: ✨ Clean logo style looked bad**
- The old version relied on a backing disc color derived from the banner's
  own gradient math, a very faint 0.5-opacity hairline border, and a shadow
  that barely registered against a same-hue background — so the logo looked
  washed out and undefined, especially on real (non-synthetic) logo art.
- Reworked: a soft white glow just outside the logo, a crisp 0.92-opacity
  border, and a neutral pearl backing fill (instead of a brand-derived shade
  that could clash with the actual logo colors). Checked against a real
  Bitcoin logo, a non-circular (diamond-shaped) logo, and monogram fallbacks.

**New: 📈 Post history (Status > Post history)**
- Every banner actually sent — automatic milestone alerts and manual
  📣 Post prices sends — is now logged with its timestamp, direction and
  price.
- View totals for Last 24 hours / 7 days / 30 days / All time, split into
  auto vs. manual, with a per-coin breakdown. Answers "how many posts have
  gone out, and when."

**New: 🔭 Next alert (Status > Next alert)**
- Shows how close each unmuted coin is to triggering right now, in both
  directions, e.g. `ETH ▲ +$23.90 · ▼ -$26.10` (or in % for a percent-step
  coin; stablecoins show distance to the depeg band, or distance back inside
  it if already depegged). Useful for judging whether a step/mode is
  calibrated the way you want.

**New: per-preview logo style in 🧪 Test banner**
- A 🖼️ Style row on the Rise/Fall and custom-price screens lets you flip
  between ✨ Clean and ⚪ White ring for just that preview, without touching
  your saved default in Settings. The caption says which style was used.

**Tests:** 50 unit tests (16 new, covering the next-alert distance math for
ladder/percent/stablecoin cases) and 53 simulated menu-flow checks (11 new),
all passing.

## 1.3.0

**New coins:** AVAX (Avalanche), SUI, XLM (Stellar), HBAR (Hedera), DOT
(Polkadot), UNI (Uniswap), LTC (Litecoin), ZEC (Zcash), HYPE (Hyperliquid) —
21 coins total, up from 12. Each has a CoinGecko ID, a Binance symbol (for
the backup price source), a brand color for its banner, and starting $ steps
matching what was requested; starting % steps are a reasonable default and
worth tuning per coin.

No other changes — everything else (menus, banner design, data sources,
post prices) works the same for the new coins automatically, since the whole
bot reads from the one coin list in `src/config.js`. Confirmed by running the
full test suite and simulated menu flows with the new coins included, and by
rendering all 9 new banners to check layout and monogram fallback.

**Note:** logos for the new coins download the same way as any other coin
(single batched CoinGecko request, with fallback sources) — nothing extra to
configure.

## 1.2.1

**Fixes**
- 💰 Prices was sent as a code block (`<pre>`), which Telegram won't update in
  place — tapping Refresh always failed silently. It's now a normal formatted
  message, so Refresh actually refreshes (and tells you "Already the latest
  prices" if nothing changed, or the reason if the fetch failed, instead of
  failing silently).
- 🔍 Test sources now lists every Binance address it tried, not just the one
  that answered — so "main address blocked, data address OK" is visible
  instead of just showing Binance as healthy.
- Admin price cache: refresh throttle lowered from 3s to 2s.

**Notes**
- A ✅ on both CoinGecko and Binance in Test sources means your server is not
  region-blocked from either right now — no separate fix needed there.

## 1.2.0

**New: choose where prices come from (Settings > 🌐 Data source)**
- Auto (CoinGecko, Binance as backup), CoinGecko only, or Binance first
  (CoinGecko as backup). Saved across restarts.
- 🔍 Test sources: checks each provider live (✅/❌, speed, coins returned,
  plain-English errors such as "blocked from this server's region").
- Private alerts when the main source starts failing, when every source fails,
  and when it recovers (throttled to one per hour per kind).
- Binance is now tried on two hosts (the main API is blocked from some server
  regions), retries with the full price list if one symbol is rejected, and is
  never used for USDT/USDC (no dollar price / false depeg risk) — those always
  come from CoinGecko, even in "Binance first".
- The fallback path is now covered by automated tests (simulated outages).

**New: 📣 Post prices**
- Post the current price of one coin, or all coins, to the channel, with a
  confirmation step. The chip shows the 24h direction; the caption adds the
  24h change. No chip if the 24h change isn't known.

**Banner tweaks**
- Coin icon ~12% smaller; more space between ticker and price. The direction
  chip stays exactly where it was.
- New default logo style ✨ Clean: no white ring, a subtle border and soft
  shadow. The old ⚪ White ring look is one tap away (Settings > 🖼️ Logo style).
- One dynamic price format everywhere: `$86,019`, `$4,021.45`, `$0.096`,
  `$0.00001234`; stablecoins show 3 decimals.

**Other**
- Main menu is now 3 rows of 2 buttons.
- The Prices screen shows which source served the reading (and "(backup)").
- Malformed provider responses are treated as a clean provider failure.

## 1.1.1

- Banner: logo a bit smaller (~165px) and the price a bit bigger (~153px), so
  the price is even more the focal point. Layout re-centered for the new
  proportions; the price still shrinks automatically if it would run too wide.

## 1.1.0

**Fixes**
- Missing coin logos (DOGE, ADA, LINK, and likely TON/USDT/USDC): the build
  fetched each logo with its own CoinGecko call and hit the free-tier rate
  limit after about six. Logos now come from a single batched request, with
  retries (honoring Retry-After), fallback icon sources, validation, and a
  retry at every bot start plus every 30 minutes. You get a private message if
  any are still missing.
- A missing logo no longer leaves a banner empty: it shows a coin-colored
  ticker badge until the real logo arrives.

**Banner**
- Focal point is the price: logo ~15% smaller, price ~20% bigger. The price
  shrinks automatically only when it would run too wide.

**New features (owner menu)**
- 💰 Prices: live prices with each coin's step and mode, plus refresh.
- 🧪 Test banner: preview any coin (rise / fall / custom price), sent only to
  you.
- 🔕 Bulk mute: mute or unmute all coins, or tick several, with the same
  durations as a single coin.
- Percentage steps per coin (alert each time price moves that % from the last
  alert), with defaults BTC 0.5%, ETH 0.75%, XRP 1%, BNB 0.75%, SOL 1%.
  Per-coin and all-coins switches between $ and %.
- Alert modes scaling each coin's step: 🚀 Hyper (¼x), 💨 Fast (½x),
  🎯 Steady (x, default), 😌 Calm (2x); per coin or for all coins.
- Status list now reads like `BTC — 0.5% 🔔`.
- Tapping a menu button now cancels any half-finished "type your answer" step.
- Optional `COINGECKO_API_KEY` environment variable.

**Under the hood**
- Database gains `step_unit`, `pct_threshold` and `mode` columns (added
  automatically on start; existing coins keep their $ steps and Steady mode).
- `npm test` (unit tests for steps/modes, input parsing and the logo
  downloader).

## 1.0.10

- Final banner layout: logo back to center-left at full size, ticker with a
  large price underneath (84 -> 132px at the original scale), both
  left-aligned.
- Direction chip moved up and to the right of the ticker, overhanging the
  price's right edge slightly; never overlaps the ticker on short prices.
- Chip colors are more saturated: a true green and a true red (were minty and
  pinkish). The chip's gloss is lighter so the colors stay rich.
- Background no longer leans red: the hue shifts in the gradient and glows
  were reduced for every coin, so Bitcoin reads as true orange.
- Fixed: the "keep the background darker so the chip is visible" rule was
  over-triggering (it turned Bitcoin fall banners brown); it now only applies
  when the brand color is genuinely close to the chip color (TRX, USDT).
- README: added a Previews section.

## 1.0.9

- New layout (following the reference): logo top-left with the ticker beside
  it, a direction chip at the right end of the row, and the price below.
- The arrow is now always white, inside a small pill that is green for a rise
  and red for a fall (replaces the colored arrow).
- Logo badge pushed up to make room for the price; its size, the banner size
  (1600x418) and the watermark are unchanged.

## 1.0.8

- Redesigned the text block. Clear hierarchy: a big hero price (84 -> 108px)
  with the ticker above it, and the direction arrow now sits right beside the
  ticker instead of floating left of the price. Ticker and price share one
  left edge.
- Crisper text shadows (less blur/fuzz).

## 1.0.7

- Banner size is now 1600x418 (matches the reference card). Layout scales
  with height and stays well inside the middle of the image, where Telegram
  crops wide photos.
- Direction arrows are smaller (66x58 -> ~45x40) and no longer glow; just a
  tight soft shadow.

## 1.0.6

- Background is now a web-style glowing gradient: hue-shifted base, soft
  luminous light orbs (screen-blended) and a glass-like diagonal sheen.
- Direction arrows: removed the white border; now solid, softly rounded and
  lightly glowing. Background is kept darker for coins whose brand color is
  close to the arrow color (TRX, USDT) so the arrow stays visible.
- Whites are more refined: text has a subtle white-to-pearl gradient, the
  logo margin is pearl white, shadows are brand-tinted instead of black.
- Yellow brands (BNB, DOGE) shift toward amber instead of going olive/muddy.

## 1.0.5

- Cleaned up the 1.0.4 look, which rendered muddy: removed the glow, light
  sweep and vignette that showed up as smudges in the background (now a
  simple, clean gradient), and removed the shading that dirtied the white
  marks inside logos (like the Bitcoin B).
- Softer text/arrow shadows (no dirty halo) and a flat white logo margin with
  a drop shadow instead of a grey gradient and hairline.

## 1.0.4

- Banner redesign: multi-tone gradient background derived from the brand
  color (no longer the same flat color as the logo), with a glow behind the
  logo and light grain to prevent banding.
- Logo is bigger (200 -> 250px), sits in a thicker white margin (4 -> 12px)
  and has a light 3D treatment (drop shadow, highlight, shading).
- Ticker is bigger (64 -> 84px), heavier and letter-spaced, and sits above
  the price. Dark text outlines removed in favor of soft drop shadows.
- Direction arrow is smaller (76x64 -> 60x52) with a gradient fill and thin
  white edge.
- Content moved left; watermark opacity raised (0.55 -> 0.8).

## 1.0.3

- Banner is taller (1536x401 -> 1536x480; width unchanged) and the dark frame
  around the brand color is gone — the color now fills the whole banner.
- Font switched from Source Serif 4 to Poppins (geometric sans), bundled in
  `assets/fonts` instead of downloaded at build time.
- Direction arrow is now drawn as a vector triangle instead of a font glyph.

## 1.0.2

- Banner restyle: only the direction arrow is colored (green up / red down);
  the price is now white.
- Ticker (e.g. BTC) is now bold and white instead of regular and black/white.
- Thin white ring around the coin logo.

## 1.0.1

- **Fix:** bot posted "Connected." but never posted coin data. In Telegraf 4.x
  `await bot.launch()` doesn't resolve while polling, so `startScheduler()` was
  never reached. Launch now resolves via the `onLaunch` callback.
- **Fix:** Binance fallback feed always failed (HTTP 400) because `USDTUSDT`
  isn't a real pair. Coins without a Binance pair are now skipped in the fallback.
- Log a line on every price tick (prices fetched, channel connected or not).
- Catch errors from `setMyCommands`; round the initial baseline to avoid float drift.

## 1.0.0

- Initial release.
