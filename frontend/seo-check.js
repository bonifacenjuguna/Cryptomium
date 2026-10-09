// Production-build SEO regression checks. Run after `npm run build` with the same environment as Vercel.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist');
const errors = [];
const warnings = [];
const fail = message => errors.push(message);
const warn = message => warnings.push(message);

if (!fs.existsSync(root)) {
  console.error('[seo:check] dist/ is missing. Run npm run build first.');
  process.exit(1);
}

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const files = walk(root);
const htmlFiles = files.filter(file => file.endsWith('.html'));
const indexable = [];
const seenCanonicals = new Map();
const seenTitles = new Map();

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).split(path.sep).join('/');
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.trim();
  const description = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1];
  const robots = (html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i) || [])[1] || '';
  const canonical = (html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i) || [])[1];
  const noindex = /noindex/i.test(robots);
  // Lowercase coin URLs are deliberate aliases of the uppercase canonical URL.
  const lowercaseCoinAlias = /^coin\/[a-z0-9]+\.html$/.test(rel);
  const canonicalPage = !noindex && !lowercaseCoinAlias;

  if (!title) fail(`${rel}: missing title`);
  else {
    if (title.length > 70) warn(`${rel}: title is ${title.length} characters; review whether it can be more concise`);
    if (canonicalPage && seenTitles.has(title)) fail(`${rel}: duplicate indexable title also used by ${seenTitles.get(title)}`);
    if (canonicalPage) seenTitles.set(title, rel);
  }

  if (canonicalPage && !description) fail(`${rel}: indexable page is missing meta description`);
  if (description && description.length > 170) warn(`${rel}: description is ${description.length} characters`);
  if (canonicalPage && !canonical) fail(`${rel}: indexable page is missing canonical URL`);
  if (canonical && !/^https:\/\//i.test(canonical)) fail(`${rel}: canonical URL is not absolute HTTPS: ${canonical}`);
  if (canonical && canonicalPage) {
    if (seenCanonicals.has(canonical)) fail(`${rel}: duplicate canonical also used by ${seenCanonicals.get(canonical)}`);
    seenCanonicals.set(canonical, rel);
    indexable.push({ rel, canonical, html });
  }
  if (canonicalPage && !/<meta\s+property="og:image"\s+content="https:\/\//i.test(html)) {
    fail(`${rel}: indexable page is missing an absolute Open Graph image`);
  }

  for (const match of html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try { JSON.parse(match[1]); }
    catch { fail(`${rel}: invalid JSON-LD block`); }
  }
  if (canonicalPage && !/<h1(?:\s|>)/i.test(html)) warn(`${rel}: no H1 found in server-rendered HTML`);
}

const sitemapPath = path.join(root, 'sitemap.xml');
const robotsPath = path.join(root, 'robots.txt');
if (!fs.existsSync(sitemapPath)) fail('sitemap.xml was not generated (check SITE_URL).');
if (!fs.existsSync(robotsPath)) fail('robots.txt was not generated.');
if (fs.existsSync(sitemapPath)) {
  const xml = fs.readFileSync(sitemapPath, 'utf8');
  if (!xml.includes('<urlset')) fail('sitemap.xml is missing a urlset root.');
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
  if (!locs.length) fail('sitemap.xml contains no URLs.');
  const sitemapSet = new Set(locs);
  for (const page of indexable) {
    if (!sitemapSet.has(page.canonical)) fail(`${page.rel}: canonical URL is missing from sitemap: ${page.canonical}`);
  }
  for (const loc of locs) {
    if (!/^https:\/\//i.test(loc)) fail(`sitemap URL is not absolute HTTPS: ${loc}`);
  }
}
if (fs.existsSync(robotsPath)) {
  const robots = fs.readFileSync(robotsPath, 'utf8');
  if (!/Sitemap:\s+https:\/\//i.test(robots)) fail('robots.txt does not declare an absolute HTTPS sitemap URL.');
}

console.log(`[seo:check] Checked ${htmlFiles.length} HTML files; ${indexable.length} canonical indexable pages.`);
for (const message of warnings) console.warn(`[seo:check] WARN: ${message}`);
if (errors.length) {
  for (const message of errors) console.error(`[seo:check] FAIL: ${message}`);
  console.error(`[seo:check] ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`[seo:check] PASS: no critical SEO regressions. ${warnings.length} warning(s).`);
