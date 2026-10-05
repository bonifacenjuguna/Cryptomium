// Build step (Vercel): turns src/ into dist/.
//
//  - fills in the brand, channel and site address (site.config.json)
//  - inserts the shared header and footer into every page
//  - writes one real page per coin (dist/coin/BTC.html ...) so search engines and
//    link previews see the right title, plus a fallback coin page
//  - writes config.js (the backend address, public by nature), sitemap.xml and a
//    Content-Security-Policy that only allows this site and your backend
//
// The backend address comes from the API_URL environment variable if set
// (Vercel > Project > Settings > Environment Variables), otherwise from
// site.config.json. SITE_URL (optional) is the public address of this website,
// used for sitemap and link previews; Vercel's own address is used if it is not set.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  } catch {
    return fallback;
  }
}

const site = readJson('site.config.json', {});
const coins = readJson('coins.json', []);

const apiUrl = String(process.env.API_URL || '').trim().replace(/\/+$/, '');
if (!apiUrl) {
  console.error('[build] Missing required API_URL environment variable. Set API_URL in Vercel/local environment before building.');
  process.exit(1);
} else if (!/^https?:\/\//.test(apiUrl)) {
  console.error(`[build] The API address must start with https:// (got "${apiUrl}").`);
  process.exit(1);
}

const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '';
const siteUrl = String(process.env.SITE_URL || site.siteUrl || (vercelHost ? `https://${vercelHost}` : ''))
  .trim()
  .replace(/\/+$/, '');

const pkgVersion = readJson('package.json', {}).version || '';
const tokens = {
  VERSION: pkgVersion,
  BRAND: site.brand || 'Cryptomium',
  CHANNEL_HANDLE: site.channelHandle || '@cryptomiumx',
  CHANNEL_URL: site.channelUrl || 'https://t.me/cryptomiumx',
  BOT_HANDLE: site.botHandle || '@cryptomiumxbot',
  SITE_URL: siteUrl,
  YEAR: String(new Date().getFullYear()),
  X_URL: (site.social && site.social.x) || 'https://x.com/avoenix_',
  INSTAGRAM_URL: (site.social && site.social.instagram) || 'https://instagram.com/avoenix',
  YOUTUBE_URL: (site.social && site.social.youtube) || 'https://youtube.com/@avoenix',
  TIKTOK_URL: (site.social && site.social.tiktok) || 'https://tiktok.com/@avoenix',
  BOT_USERNAME: (site.botHandle || '@cryptomiumxbot').replace(/^@/, ''),
};

const fill = (text, extra = {}) =>
  text.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key) => (key in extra ? extra[key] : key in tokens ? tokens[key] : whole));

// Installable app: viewport that reaches the screen edges, theme colour, manifest and home-screen icons on every page.
const pwaHead = [
  '<meta name="theme-color" content="#090f15">',
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png">',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  `<meta name="apple-mobile-web-app-title" content="${tokens.BRAND}">`,
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  `<meta name="application-name" content="${tokens.BRAND}">`,
].join('\n  ');
const withPwa = html => {
  html = html.replace('content="width=device-width, initial-scale=1"', 'content="width=device-width, initial-scale=1, viewport-fit=cover"');
  return /<meta name="theme-color"[^>]*>/.test(html) ? html.replace(/<meta name="theme-color"[^>]*>/, pwaHead) : html.replace('</head>', `  ${pwaHead}\n</head>`);
};

const header = fs.readFileSync(path.join(src, 'partials/header.html'), 'utf8');
const footer = fs.readFileSync(path.join(src, 'partials/footer.html'), 'utf8');
const settingsNav = fs.readFileSync(path.join(src, 'partials/settings-nav.html'), 'utf8');
const tabbar = fs.readFileSync(path.join(src, 'partials/app-tabbar.html'), 'utf8');
const compose = html => withPwa(html.replace('<!--@header-->', header).replace('<!--@footer-->', footer + tabbar).replace('<!--@settings-nav-->', settingsNav));

// Only this site, Google Fonts, and the backend may be used by the pages. Two public icon sets are
// allowed for pictures only: the last-resort source for a coin logo the backend cannot supply.
const apiOrigin = apiUrl ? new URL(apiUrl).origin : '';
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  `img-src 'self' data: ${apiOrigin} https://cdn.jsdelivr.net https://assets.coincap.io`.trim(),
  `connect-src 'self' ${apiOrigin}`.trim(),
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');
const withCsp = html => html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// Plain files first (css, js, icons, coins list).
// Every .html under src (except partials and the coin template) is a page of its own.
fs.cpSync(src, dist, {
  recursive: true,
  filter: file => !file.includes(`${path.sep}partials`) && !file.endsWith('.html'),
});
const pageFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'partials') walk(full); }
    else if (entry.name.endsWith('.html') && entry.name !== 'coin.html') pageFiles.push(path.relative(src, full));
  }
})(src);

// Version stamp for css/js so a redeploy always reaches phones immediately.
import crypto from 'node:crypto';
const stamp = crypto.createHash('sha1');
for (const f of ['style.css', 'theme-init.js', 'sw.js', ...fs.readdirSync(path.join(src, 'js')).sort().map(n => 'js/' + n), ...fs.readdirSync(path.join(src, 'partials')).sort().map(n => 'partials/' + n)]) {
  try { stamp.update(fs.readFileSync(path.join(src, f))); } catch { /* optional */ }
}
stamp.update(pkgVersion);
const ver = stamp.digest('hex').slice(0, 8);
const bust = html => html.replace(/(href|src)="\/(style\.css|theme-init\.js|config\.js|js\/[a-z]+\.js)"/g, `$1="/$2?v=${ver}"`);

const write = (rel, text) => {
  const file = path.join(dist, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rel.endsWith('.html') ? bust(text) : text);
};

for (const name of pageFiles) {
  write(name, withCsp(fill(compose(fs.readFileSync(path.join(src, name), 'utf8')))));
}

write('coins.json', JSON.stringify(coins));

// Web app manifest and service worker (the worker is stamped so every deploy refreshes its cache).
const manifest = {
  id: '/',
  name: tokens.BRAND,
  short_name: tokens.BRAND,
  description: 'Live crypto prices, charts, market overview and price alerts.',
  lang: 'en',
  start_url: '/?source=app',
  scope: '/',
  display: 'standalone',
  display_override: ['standalone', 'minimal-ui'],
  background_color: '#090f15',
  theme_color: '#090f15',
  categories: ['finance', 'news'],
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: [
    { name: 'Market overview', short_name: 'Overview', url: '/markets', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    { name: 'Screener', short_name: 'Screener', url: '/screener', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    { name: 'News', short_name: 'News', url: '/news', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    { name: 'Portfolio', short_name: 'Portfolio', url: '/portfolio', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
  ],
};
if (siteUrl) { manifest.related_applications = [{ platform: 'webapp', url: `${siteUrl}/manifest.webmanifest` }]; manifest.prefer_related_applications = false; }
write('manifest.webmanifest', JSON.stringify(manifest, null, 2));
write('sw.js', fs.readFileSync(path.join(src, 'sw.js'), 'utf8').replace(/__VERSION__/g, ver));

// Coin pages: one per coin, plus a generic fallback used for any other /coin/<x> address.
const coinTemplate = withCsp(compose(fs.readFileSync(path.join(src, 'coin.html'), 'utf8')));
write('coin.html', fill(coinTemplate, { COIN_NAME: 'Coin', COIN_TICKER: 'price' }).replace(`${siteUrl}/coin/price`, `${siteUrl}/`).replace(/ \(price\)/g, ''));
for (const c of coins) {
  write(`coin/${c.ticker}.html`, fill(coinTemplate, { COIN_NAME: c.name, COIN_TICKER: c.ticker }));
}

// Everything non-HTML that carries tokens.
write('robots.txt', fill(fs.readFileSync(path.join(src, 'robots.txt'), 'utf8')).replace(/^Sitemap:.*\n?/m, siteUrl ? `Sitemap: ${siteUrl}/sitemap.xml\n` : ''));
if (siteUrl) {
  const urls = ['/', '/markets', '/screener', '/news', '/compare', '/about', ...coins.map(c => `/coin/${c.ticker}`)]; // /portfolio is noindex, so it is not listed
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${siteUrl}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
}

write(
  'config.js',
  `window.CRYPTOMIUM = ${JSON.stringify({
    apiUrl,
    brand: tokens.BRAND,
    channelUrl: tokens.CHANNEL_URL,
    channelHandle: tokens.CHANNEL_HANDLE,
  })};\n`
);

console.log(`[build] Done. API: ${apiUrl || '(not set)'} | site: ${siteUrl || '(not set)'} | ${coins.length} coin pages`);
