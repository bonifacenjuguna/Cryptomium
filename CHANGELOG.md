# Changelog

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
