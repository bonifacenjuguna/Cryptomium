// Build step (Vercel): turns src/ into dist/.
//
//  - fills in the brand, channel and site address (site.config.json)
//  - inserts the shared header and footer into every page
//  - writes one real page per coin (dist/coin/BTC.html ...) so search engines and
//    link previews see the right title, plus a fallback coin page
//  - writes config.js (the backend address from API_URL, public by nature), sitemap.xml and a
//    Content-Security-Policy that only allows this site and your backend
//
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

// The backend address comes ONLY from the API_URL environment variable
// (Vercel > Project > Settings > Environment Variables). There is no fallback and no address in
// site.config.json: the build stops if API_URL is missing. SITE_URL (optional) is the public address
// of this website, used for sitemap and link previews; Vercel's own address is used if it is not set.
const apiUrl = String(process.env.API_URL || '').trim().replace(/\/+$/, '');
if (!apiUrl) {
  console.error('[build] API_URL is not set. Set the API_URL environment variable to your backend address (https://...) and build again.');
  process.exit(1);
}
if (!/^https?:\/\//.test(apiUrl)) {
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
  CHANNEL_HANDLE: site.channelHandle || '@CryptomiumApp',
  CHANNEL_URL: site.channelUrl || 'https://t.me/CryptomiumApp',
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
const compose = html => withPwa(html.replace('<!--@header-->', header).replace('<!--@footer-->', footer + tabbar).replace('<!--@settings-nav-->', settingsNav).replace('<!--@tabbar-->', tabbar));

// Only this site, Google Fonts, and the backend may be used by the pages. Two public icon sets are
// allowed for pictures only: the last-resort source for a coin logo the backend cannot supply.
const apiOrigin = new URL(apiUrl).origin;
const csp = [
  "default-src 'self'",
  "script-src 'self' 'inline-speculation-rules'",
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
// Hover effects only where a pointer can really hover: on a touch screen a tap would leave them stuck on.
// Top-level rules that mention :hover are moved into @media (hover: hover); everything else is untouched.
function hoverOnly(css) {
  let out = '', i = 0;
  const n = css.length;
  while (i < n) {
    if (css.startsWith('/*', i)) { const e = css.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; out += css.slice(i, end); i = end; continue; }
    const open = css.indexOf('{', i);
    if (open < 0) { out += css.slice(i); break; }
    let depth = 1, j = open + 1;
    while (j < n && depth) {
      if (css.startsWith('/*', j)) { const e = css.indexOf('*/', j + 2); j = e < 0 ? n : e + 2; continue; }
      if (css[j] === '{') depth++; else if (css[j] === '}') depth--;
      j++;
    }
    const prelude = css.slice(i, open), body = css.slice(open, j);
    const head = prelude.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (head.startsWith('@') || !head.includes(':hover')) { out += prelude + body; }
    else {
      const sels = []; let d = 0, cur = '';
      for (const ch of head) { if (ch === '(' || ch === '[') d++; if (ch === ')' || ch === ']') d--; if (ch === ',' && !d) { sels.push(cur.trim()); cur = ''; } else cur += ch; }
      sels.push(cur.trim());
      const hov = sels.filter(x => x.includes(':hover')), rest = sels.filter(x => !x.includes(':hover'));
      if (rest.length) out += rest.join(', ') + body + '\n';
      out += '@media (hover: hover) { ' + hov.join(', ') + body + ' }';
    }
    i = j;
  }
  return out;
}
fs.writeFileSync(path.join(dist, 'style.css'), hoverOnly(fs.readFileSync(path.join(src, 'style.css'), 'utf8')));
const pageFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'partials') walk(full); }
    else if (entry.name.endsWith('.html') && entry.name !== 'coin.html') pageFiles.push(path.relative(src, full));
  }
})(src);

// Build id: a hash of every input (pages, scripts, styles, coin list, settings, API address, version), so any
// change at all gives a new id. It names the service-worker caches and busts css/js addresses.
import crypto from 'node:crypto';
const stamp = crypto.createHash('sha1');
(function hashDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) hashDir(full);
    else { stamp.update(path.relative(src, full)); stamp.update(fs.readFileSync(full)); }
  }
})(src);
stamp.update(JSON.stringify([coins, site, apiUrl, siteUrl, pkgVersion]));
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
write('version.json', JSON.stringify({ version: pkgVersion, build: ver }));

// Web app manifest and service worker (the worker is stamped so every deploy refreshes its cache).
const manifest = {
  id: '/',
  name: tokens.BRAND,
  short_name: tokens.BRAND,
  description: 'Live crypto prices, charts, market overview and price alerts.',
  lang: 'en',
  start_url: '/app?source=app',
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
    { name: 'Market overview', short_name: 'Overview', url: '/app?go=/markets', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    { name: 'Screener', short_name: 'Screener', url: '/app?go=/screener', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    { name: 'News', short_name: 'News', url: '/app?go=/news', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    { name: 'Portfolio', short_name: 'Portfolio', url: '/app?go=/portfolio', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
  ],
};
if (siteUrl) { manifest.related_applications = [{ platform: 'webapp', url: `${siteUrl}/manifest.webmanifest` }]; manifest.prefer_related_applications = false; }
write('manifest.webmanifest', JSON.stringify(manifest, null, 2));

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
    version: pkgVersion,
    build: ver,
  })};\n`
);

// Service worker: knows exactly which files make one complete version of the app.
const cleanUrl = rel => '/' + rel.replace(/\.html$/, '').replace(/(^|\/)index$/, '$1').replace(/\/$/, '');
const walkFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walkFiles(path.join(dir, e.name)) : [path.relative(dist, path.join(dir, e.name))]));
const built = walkFiles(dist).map(f => f.split(path.sep).join('/'));
const pagesList = built.filter(f => f.endsWith('.html') && !f.startsWith('coin/')).map(f => (f === 'index.html' ? '/' : cleanUrl(f)));
const assetsList = built.filter(f => /\.(css|js|json|svg|webmanifest)$/.test(f) && !['sw.js', 'version.json'].includes(f)).map(f => '/' + f);
const precache = [...new Set([...pagesList, ...assetsList])].sort();
const optional = [...coins.map(c => `/coin/${c.ticker}`), ...built.filter(f => /\.png$/.test(f) && f.startsWith('icons/')).map(f => '/' + f)];
write(
  'sw.js',
  fs.readFileSync(path.join(src, 'sw.js'), 'utf8')
    .replace(/__VERSION__/g, ver)
    .replace(/__APP_VERSION__/g, pkgVersion)
    .replace(/__API_ORIGIN__/g, apiOrigin)
    .replace('__PRECACHE__', JSON.stringify(precache))
    .replace('__OPTIONAL__', JSON.stringify(optional))
);

console.log(`[build] Done. API: ${apiUrl} | site: ${siteUrl || '(not set)'} | ${coins.length} coin pages | v${pkgVersion} build ${ver} | ${precache.length} files saved for offline`);
