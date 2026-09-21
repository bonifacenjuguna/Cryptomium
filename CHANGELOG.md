# Changelog

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
