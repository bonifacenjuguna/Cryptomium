// Runs once at deploy time (via `npm run build` on Railway) — NOT on every
// post. Downloads each coin's logo into /assets/logos so the running bot never
// depends on an external image host while serving posts. (Fonts are bundled in
// /assets/fonts, so there is nothing to download for them.)
//
// The heavy lifting lives in src/logoService.js, which is also used at boot to
// heal any logo this build step could not get (see startLogoHealer).
import { fetchMissingLogos } from '../src/logoService.js';

const { saved, failed } = await fetchMissingLogos({ force: true }).catch(err => {
  console.error('[fetchAssets] Unexpected failure:', err);
  return { saved: [], failed: [] };
});

console.log(`[fetchAssets] Done. Saved: ${saved.join(', ') || 'none'}.`);
if (failed.length > 0) {
  // Non-fatal: the bot retries these at startup, and banners fall back to a
  // monogram badge until then.
  console.warn(`[fetchAssets] Could not fetch: ${failed.join(', ')} (will retry at startup).`);
}
process.exit(0);
