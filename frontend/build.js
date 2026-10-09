// Build step (Vercel): turns src/ into dist/.
//
//  - fills in the brand, channel and site address (site.config.json)
//  - inserts the shared header and footer into every page
//  - writes one real page per coin (dist/coin/BTC.html ...) so search engines and
//    link previews see the right title, plus a fallback coin page
//  - writes config.js (the backend address from API_URL, public by nature), sitemap.xml, robots.txt, llms.txt and a
//    Content-Security-Policy that only allows this site and your backend
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pageRegistry, coinMeta, applySeo, faqFrom, coinLinksNoscript, sitemapXml, robotsTxt, llmsTxt } from './seo.js';

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
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
// A page that carries its own inline style/script (only the offline page, which must work with nothing else loaded) gets
// those exact blocks allowed by hash; every other page keeps the strict policy.
const sha = text => `'sha256-${crypto.createHash('sha256').update(text).digest('base64')}'`;
const withCsp = html => {
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => sha(m[1]));
  const scripts = [...html.matchAll(/<script(?![^>]*\ssrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].map(m => sha(m[1]));
  let policy = csp;
  if (styles.length) policy = policy.replace("style-src 'self'", `style-src 'self' ${styles.join(' ')}`);
  if (scripts.length) policy = policy.replace("script-src 'self'", `script-src 'self' ${scripts.join(' ')}`);
  return html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${policy}">`);
};

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
const stamp = crypto.createHash('sha1');
(function hashDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) hashDir(full);
    else { stamp.update(path.relative(src, full)); stamp.update(fs.readFileSync(full)); }
  }
})(src);
stamp.update(fs.readFileSync(path.join(root, 'seo.js')));
stamp.update(JSON.stringify([coins, site, apiUrl, siteUrl, pkgVersion]));
const ver = stamp.digest('hex').slice(0, 8);
const bust = html => html.replace(/(href|src)="\/(style\.css|theme-init\.js|config\.js|js\/[a-z]+\.js)"/g, `$1="/$2?v=${ver}"`);

const write = (rel, text) => {
  const file = path.join(dist, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rel.endsWith('.html') ? bust(text) : text);
};

// ---- SEO ------------------------------------------------------------------------------------------------------
// Search, link-preview and AI-assistant metadata for every page comes from seo.js (one registry), not from each file.
const { ABOUT: aboutMap } = await import(pathToFileURL(path.join(src, 'js/about-coins.js')).href);
const registry = pageRegistry({ brand: tokens.BRAND, coinCount: coins.length });
const lastSeg = u => String(u || '').replace(/\/+$/, '').split('/').pop().replace(/^@/, '');
const seoCtx = {
  brand: tokens.BRAND,
  siteUrl,
  twitterHandle: lastSeg(tokens.X_URL) ? `@${lastSeg(tokens.X_URL)}` : '',
  social: { telegram: tokens.CHANNEL_URL, x: tokens.X_URL, instagram: tokens.INSTAGRAM_URL, youtube: tokens.YOUTUBE_URL, tiktok: tokens.TIKTOK_URL },
};
if (!siteUrl) console.warn('[build] SITE_URL is not set: canonical links, link-preview images, structured data and the sitemap are skipped. Set SITE_URL (https://your-domain) in Vercel.');
const seoDone = (html, meta) => applySeo(html, meta, seoCtx);

for (const name of pageFiles) {
  let html = fill(compose(fs.readFileSync(path.join(src, name), 'utf8')));
  const meta = registry[name.split(path.sep).join('/')] || null;
  if (meta) {
    seoCtx.faq = meta.kind === 'about' ? faqFrom(html) : null;
    if (name === 'index.html' || name === 'markets.html') html = html.replace('</main>', `${coinLinksNoscript(coins)}\n</main>`);
  }
  write(name, withCsp(seoDone(html, meta)));
}
seoCtx.faq = null;

write('coins.json', JSON.stringify(coins));
write('version.json', JSON.stringify({ version: pkgVersion, build: ver }));

// Every script-to-script import carries the build id too (./pwa.js -> ./pwa.js?v=<build>), like the page's own script tags.
// The service worker can then tell which build a file belongs to and never mixes two builds in one page.
for (const f of fs.readdirSync(path.join(dist, 'js')).filter(n => n.endsWith('.js'))) {
  const file = path.join(dist, 'js', f);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/((?:\bfrom\s+|\bimport\()\s*)(['"])(\.\/[a-z-]+\.js)\2/g, `$1$2$3?v=${ver}$2`));
}

// Web app manifest and service worker (the worker is stamped so every deploy refreshes its cache).
const manifest = {
  id: '/',
  name: tokens.BRAND,
  short_name: tokens.BRAND,
  description: 'Live crypto prices, charts, market overview, screener, news, converter and milestone price alerts. Free, no account.',
  lang: 'en',
  start_url: '/app?source=app',
  scope: '/',
  display: 'standalone',
  display_override: ['standalone', 'minimal-ui'],
  launch_handler: { client_mode: ['focus-existing', 'auto'] }, // a notification or link brings the open app forward instead of starting a second copy
  orientation: 'portrait-primary',
  background_color: '#090f15',
  theme_color: '#090f15',
  categories: ['finance', 'news'],
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/icon-monochrome-512.png', sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
  ],
  shortcuts: [
    { name: 'Market overview', short_name: 'Overview', url: '/app?go=/markets', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    { name: 'Screener', short_name: 'Screener', url: '/app?go=/screener', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    { name: 'Price alerts', short_name: 'Alerts', url: '/app?go=/settings/alerts', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    { name: 'Portfolio', short_name: 'Portfolio', url: '/app?go=/portfolio', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
  ],
};
if (siteUrl) { manifest.related_applications = [{ platform: 'webapp', url: `${siteUrl}/manifest.webmanifest` }]; manifest.prefer_related_applications = false; }
write('manifest.webmanifest', JSON.stringify(manifest, null, 2));

// Coin pages: one per coin (real text in the HTML: title, description, About paragraph), plus a generic fallback used
// for any other /coin/<x> address. The fallback is kept out of the index. Lower-case addresses (/coin/btc) serve the
// same page and point their canonical at the upper-case one, so there is one version in search.
const coinBase = compose(fs.readFileSync(path.join(src, 'coin.html'), 'utf8'));
write('coin.html', withCsp(seoDone(fill(coinBase, { COIN_NAME: 'Coin', COIN_TICKER: 'price' }).replace(/ \(price\)/g, ''), null)));
for (const c of coins) {
  const about = aboutMap[c.ticker] || '';
  let html = fill(coinBase, { COIN_NAME: c.name, COIN_TICKER: c.ticker });
  if (about) html = html.replace('<p id="about-text">&nbsp;</p>', `<p id="about-text">${about.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`);
  html = html.replace('<ul class="others" id="others"></ul>', `<ul class="others" id="others"></ul>\n      ${coinLinksNoscript(coins, c.ticker)}`);
  const page = withCsp(seoDone(html, coinMeta({ brand: tokens.BRAND, coin: c, about })));
  write(`coin/${c.ticker}.html`, page);
  const lower = c.ticker.toLowerCase();
  if (lower !== c.ticker) write(`coin/${lower}.html`, page);
}

// Everything non-HTML that carries tokens.
write('robots.txt', robotsTxt({ brand: tokens.BRAND, siteUrl }));
if (siteUrl) {
  const urls = [...Object.values(registry).map(m => m.path), ...coins.map(c => `/coin/${c.ticker}`)]; // noindex pages (portfolio, settings, app) are not listed
  write('sitemap.xml', sitemapXml({ siteUrl, urls, lastmod: new Date().toISOString().slice(0, 10) }));
  write('llms.txt', llmsTxt({ brand: tokens.BRAND, siteUrl, coins, aboutMap, registry, channelUrl: tokens.CHANNEL_URL }));
}
// Optional IndexNow (Bing, Yandex and others learn about new pages at once). Set INDEXNOW_KEY in Vercel (8 to 128 letters,
// digits or dashes); the key file is written to the site root. Tell the search engines with a request to
// https://api.indexnow.org/indexnow?url=<page>&key=<key> after a deploy.
const indexNowKey = String(process.env.INDEXNOW_KEY || '').trim();
if (indexNowKey) {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(indexNowKey)) { console.error('[build] INDEXNOW_KEY must be 8 to 128 letters, digits or dashes.'); process.exit(1); }
  write(`${indexNowKey}.txt`, indexNowKey);
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

// Android app (Trusted Web Activity): the website must vouch for the app, or Chrome shows an address bar.
// Set ANDROID_PACKAGE (for example com.cryptomium.app) and ANDROID_SHA256_CERTS (the signing certificate fingerprint(s)
// from Play Console > App integrity, comma separated) in Vercel. With neither set, nothing is written.
const androidPackage = String(process.env.ANDROID_PACKAGE || '').trim();
const androidCerts = String(process.env.ANDROID_SHA256_CERTS || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
if (androidPackage && androidCerts.length) {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(androidPackage) || androidCerts.some(c => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(c))) {
    console.error('[build] ANDROID_PACKAGE or ANDROID_SHA256_CERTS is malformed (fingerprints look like AA:BB:...:FF, 32 pairs).');
    process.exit(1);
  }
  write('.well-known/assetlinks.json', JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: androidPackage, sha256_cert_fingerprints: androidCerts } }], null, 2));
}

// Service worker: knows exactly which files make one complete version of the app.
const cleanUrl = rel => '/' + rel.replace(/\.html$/, '').replace(/(^|\/)index$/, '$1').replace(/\/$/, '');
const walkFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walkFiles(path.join(dir, e.name)) : [path.relative(dist, path.join(dir, e.name))]));
const built = walkFiles(dist).map(f => f.split(path.sep).join('/'));
const pagesList = built.filter(f => f.endsWith('.html') && !f.startsWith('coin/')).map(f => (f === 'index.html' ? '/' : cleanUrl(f)));
const assetsList = built.filter(f => /\.(css|js|json|svg|webmanifest)$/.test(f) && !['sw.js', 'version.json'].includes(f) && !f.startsWith('.well-known/')).map(f => '/' + f);
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
    .replace('__OFFLINE_HTML__', () => JSON.stringify(fs.readFileSync(path.join(dist, 'offline.html'), 'utf8')))
);

console.log(`[build] Done. API: ${apiUrl} | site: ${siteUrl || '(not set)'} | ${coins.length} coin pages | v${pkgVersion} build ${ver} | ${precache.length} files saved for offline`);

// Fail the deployment if generated SEO metadata or sitemap output regresses.
const seoCheck = spawnSync(process.execPath, [path.join(root, 'seo-check.js')], { cwd: root, stdio: 'inherit' });
if (seoCheck.error) throw seoCheck.error;
if (seoCheck.status !== 0) process.exit(seoCheck.status || 1);
