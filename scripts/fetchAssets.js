// Runs once at deploy time (via `npm run build` on Railway) — NOT on
// every post. Downloads each coin's logo from CoinGecko and the Source
// Serif 4 font files, storing them locally under /assets so the running
// bot never depends on external image/font hosts while serving posts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COINS } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const LOGOS_DIR = path.join(ASSETS_DIR, 'logos');
const FONTS_DIR = path.join(ASSETS_DIR, 'fonts');

const FONT_FILES = {
  'SpaceGrotesk-Regular.ttf':
    'https://raw.githubusercontent.com/floriankarsten/space-grotesk/master/fonts/ttf/SpaceGrotesk-Regular.ttf',
  'SpaceGrotesk-Bold.ttf':
    'https://raw.githubusercontent.com/floriankarsten/space-grotesk/master/fonts/ttf/SpaceGrotesk-Bold.ttf',
};

async function downloadToFile(url, destPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buffer);
}

async function fetchFonts() {
  for (const [filename, url] of Object.entries(FONT_FILES)) {
    const dest = path.join(FONTS_DIR, filename);
    try {
      await downloadToFile(url, dest);
      console.log(`[fetchAssets] Font saved: ${filename}`);
    } catch (err) {
      console.error(`[fetchAssets] FAILED to fetch font ${filename}: ${err.message}`);
    }
  }
}

async function fetchLogos() {
  for (const coin of COINS) {
    const dest = path.join(LOGOS_DIR, `${coin.ticker}.png`);
    try {
      const metaRes = await fetch(
        `https://api.coingecko.com/api/v3/coins/${coin.coingeckoId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`,
        { signal: AbortSignal.timeout(15_000) }
      );
      if (!metaRes.ok) throw new Error(`metadata request responded ${metaRes.status}`);
      const meta = await metaRes.json();
      const imageUrl = meta.image?.large;
      if (!imageUrl) throw new Error('no image.large field in response');

      await downloadToFile(imageUrl, dest);
      console.log(`[fetchAssets] Logo saved: ${coin.ticker}`);
    } catch (err) {
      console.error(`[fetchAssets] FAILED to fetch logo for ${coin.ticker}: ${err.message}`);
      // Non-fatal: imageGenerator.js falls back to a text-only layout for
      // any coin whose logo file is missing, so one failure here doesn't
      // block deployment.
    }
    // Be polite to CoinGecko's free-tier rate limit between calls.
    await new Promise(r => setTimeout(r, 1500));
  }
}

async function main() {
  await fs.mkdir(LOGOS_DIR, { recursive: true });
  await fs.mkdir(FONTS_DIR, { recursive: true });
  await fetchFonts();
  await fetchLogos();
  console.log('[fetchAssets] Done.');
}

main().catch(err => {
  console.error('[fetchAssets] Unexpected failure:', err);
  // Don't fail the whole deploy over asset fetching — the bot degrades
  // gracefully (text-only banners) if some assets are missing.
  process.exit(0);
});
