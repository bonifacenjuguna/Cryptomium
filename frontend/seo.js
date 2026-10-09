// SEO layer for the build (imported by build.js).
//
// One place decides, for every page, what search engines, link previews and AI assistants see:
//  - <title>, description, robots directives (index + large previews, or noindex for app screens)
//  - canonical and hreflang
//  - Open Graph and Twitter/X cards (with image size and alt text)
//  - JSON-LD structured data (Organization, WebSite, WebPage types, BreadcrumbList, WebApplication, FAQPage)
//  - sitemap.xml, robots.txt groups, llms.txt
//
// Everything is generated from the real page list, so a new coin or page is picked up automatically.

const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripTags = s => String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const jsonLd = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

export const OG_IMAGE = { path: '/og.png', width: 1200, height: 630, type: 'image/png' };

// Pages that should be found in search. Key = file name inside src/. Anything not listed here (settings, portfolio,
// app shell, offline, 404, the fallback coin page) is kept OUT of the index.
export function pageRegistry({ brand, coinCount }) {
  return {
    'index.html': {
      path: '/', kind: 'home',
      title: `${brand}: Live Crypto Prices, Charts and Alerts`,
      description: `Track live prices, 24 hour and 7 day moves, charts, market cap and milestone alerts for ${coinCount} top coins, including Bitcoin, Ethereum and Solana. Free, no account.`,
      crumb: 'Home',
    },
    'markets.html': {
      path: '/markets', kind: 'collection',
      title: 'Live Crypto Market Overview: Prices, Gainers and Losers',
      description: 'Explore live cryptocurrency market prices, total market cap, 24-hour trading volume, Bitcoin dominance, market sentiment, top gainers and losers, and distance from all-time highs.',
      crumb: 'Market overview',
    },
    'screener.html': {
      path: '/screener', kind: 'app',
      title: 'Crypto Screener: Filter by Market Cap, Volume and ATH',
      description: 'Screen cryptocurrencies by live price, market cap, trading volume, 24-hour and 7-day performance, supply, and distance from all-time highs and lows. Free to use, no account required.',
      crumb: 'Screener',
      appName: `${brand} Crypto Screener`,
    },
    'news.html': {
      path: '/news', kind: 'collection',
      title: 'Crypto News Headlines from Leading Publishers',
      description: 'Browse cryptocurrency news headlines by coin and topic, with publisher attribution and links to original reporting from established crypto news outlets.',
      crumb: 'News',
    },
    'compare.html': {
      path: '/compare', kind: 'app',
      title: 'Compare Cryptocurrencies Side by Side',
      description: 'Compare cryptocurrencies side by side using live prices, 24-hour and 7-day performance, market cap, trading volume, circulating supply, and all-time highs and lows.',
      crumb: 'Compare',
      appName: `${brand} Crypto Comparison Tool`,
    },
    'converter.html': {
      path: '/converter', kind: 'app',
      title: 'Crypto Converter: Coins to Currencies at Live Prices',
      description: 'Convert cryptocurrency amounts using live prices. Check Bitcoin, Ethereum, Solana and other coins against USD, Kenyan shillings, euros, and supported currencies.',
      crumb: 'Converter',
      appName: `${brand} Crypto Converter`,
    },
    'about.html': {
      path: '/about', kind: 'about',
      title: `About ${brand}: How Crypto Alerts Work and FAQ`,
      description: `What ${brand} is, how milestone alerts work, where the numbers come from, which coins are covered, and answers to common questions.`,
      crumb: 'About',
    },
    'privacy.html': {
      path: '/privacy', kind: 'page',
      title: `Privacy: No Accounts, No Ads, No Tracking`,
      description: `What ${brand} keeps on your device, and the little it stores on its server if you turn on notifications. No accounts, no ads, no tracking.`,
      crumb: 'Privacy',
    },
  };
}

// One page per coin.
export function coinMeta({ brand, coin, about }) {
  const { name, ticker } = coin;
  const same = name.toUpperCase() === ticker;
  const label = same ? name : `${name} (${ticker})`;
  const base = `Live ${label} price in USD, chart, 24-hour change, market cap, volume and alerts on ${brand}.`;
  const extra = about ? firstSentence(about) : '';
  const description = clip(extra ? `${base} ${extra}` : base, 160);
  return {
    path: `/coin/${ticker}`, kind: 'coin',
    title: `${label} Price, Chart & Market Cap`,
    description,
    crumb: name,
    coin, about,
  };
}

function firstSentence(text) {
  const m = String(text).match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim();
}

const clip = (s, max) => (s.length <= max ? s : s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…');

// "Title | Brand" when it fits in about 60 characters, otherwise the title alone.
export function fullTitle(title, brand) {
  if (title.includes(brand)) return title;
  const joined = `${title} | ${brand}`;
  return joined.length <= 64 ? joined : title;
}

// Pulls the visible question and answer pairs out of the About page's FAQ (they are all on the page, as required).
export function faqFrom(html) {
  const out = [];
  for (const m of html.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)) {
    const q = stripTags(m[1]), a = stripTags(m[2]);
    if (q && a) out.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } });
  }
  return out;
}

const HEAD_STRIP = [
  /\s*<title>[\s\S]*?<\/title>/g,
  /\s*<meta name="description"[^>]*>/g,
  /\s*<meta name="robots"[^>]*>/g,
  /\s*<link rel="canonical"[^>]*>/g,
  /\s*<meta property="og:[^>]*>/g,
  /\s*<meta name="twitter:[^>]*>/g,
  /\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
];

const ROBOTS_INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

// Rewrites the <head> of one built page. `meta` is null for pages that must not be indexed.
export function applySeo(html, meta, ctx) {
  const { brand, siteUrl, twitterHandle } = ctx;
  const titleFromFile = ((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || brand).trim(); // already escaped in the source
  for (const re of HEAD_STRIP) html = html.replace(re, '');

  let block;
  if (!meta) {
    // App screens, settings, portfolio, offline, 404, fallback coin page: out of the index, links not followed.
    block = [
      `<title>${titleFromFile}</title>`,
      '<meta name="robots" content="noindex, nofollow">',
      '<meta name="format-detection" content="telephone=no">',
    ];
  } else {
    const title = fullTitle(meta.title, brand);
    const desc = clip(meta.description, 160);
    const url = siteUrl ? `${siteUrl}${meta.path === '/' ? '/' : meta.path}` : '';
    const image = siteUrl ? `${siteUrl}${OG_IMAGE.path}` : '';
    const imageAlt = `${brand}: live crypto prices, charts and milestone alerts`;
    block = [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(desc)}">`,
      `<meta name="robots" content="${ROBOTS_INDEX}">`,
      '<meta name="format-detection" content="telephone=no">',
      `<meta name="author" content="${esc(brand)}">`,
    ];
    if (url) {
      block.push(
        `<link rel="canonical" href="${esc(url)}">`,
        `<link rel="alternate" hreflang="en" href="${esc(url)}">`,
        `<link rel="alternate" hreflang="x-default" href="${esc(url)}">`,
        `<link rel="sitemap" type="application/xml" href="${esc(siteUrl)}/sitemap.xml">`,
      );
    }
    block.push(
      `<meta property="og:site_name" content="${esc(brand)}">`,
      '<meta property="og:type" content="website">',
      '<meta property="og:locale" content="en_US">',
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:description" content="${esc(desc)}">`,
    );
    if (url) block.push(`<meta property="og:url" content="${esc(url)}">`);
    if (image) {
      block.push(
        `<meta property="og:image" content="${esc(image)}">`,
        `<meta property="og:image:secure_url" content="${esc(image)}">`,
        `<meta property="og:image:type" content="${OG_IMAGE.type}">`,
        `<meta property="og:image:width" content="${OG_IMAGE.width}">`,
        `<meta property="og:image:height" content="${OG_IMAGE.height}">`,
        `<meta property="og:image:alt" content="${esc(imageAlt)}">`,
      );
    }
    block.push(
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:title" content="${esc(title)}">`,
      `<meta name="twitter:description" content="${esc(desc)}">`,
    );
    if (twitterHandle) block.push(`<meta name="twitter:site" content="${esc(twitterHandle)}">`, `<meta name="twitter:creator" content="${esc(twitterHandle)}">`);
    if (image) block.push(`<meta name="twitter:image" content="${esc(image)}">`, `<meta name="twitter:image:alt" content="${esc(imageAlt)}">`);

    if (url) block.push(jsonLd(buildGraph({ meta, title, desc, url, ctx })));
  }

  const marker = html.match(/<meta name="viewport"[^>]*>/);
  const insert = '\n  ' + block.join('\n  ');
  return marker ? html.replace(marker[0], marker[0] + insert) : html.replace('</head>', insert + '\n</head>');
}

function buildGraph({ meta, title, desc, url, ctx }) {
  const { brand, siteUrl, social, faq } = ctx;
  const org = `${siteUrl}/#organization`, site = `${siteUrl}/#website`, page = `${url}#webpage`;
  const sameAs = [social.telegram, social.x, social.instagram, social.youtube, social.tiktok].filter(Boolean);
  const graph = [
    {
      '@type': 'Organization', '@id': org, name: brand, url: `${siteUrl}/`,
      logo: { '@type': 'ImageObject', url: `${siteUrl}/icons/icon-512.png`, width: 512, height: 512 },
      image: `${siteUrl}${OG_IMAGE.path}`,
      description: 'Live crypto prices, charts, market overview and milestone alerts.',
      sameAs,
    },
    { '@type': 'WebSite', '@id': site, url: `${siteUrl}/`, name: brand, description: 'Live crypto prices, charts, market overview and milestone alerts.', inLanguage: 'en', publisher: { '@id': org } },
  ];
  const typeFor = { about: 'AboutPage', collection: 'CollectionPage' };
  const webpage = {
    '@type': typeFor[meta.kind] || 'WebPage', '@id': page, url, name: title, description: desc, inLanguage: 'en',
    isPartOf: { '@id': site }, publisher: { '@id': org },
    primaryImageOfPage: { '@type': 'ImageObject', url: `${siteUrl}${OG_IMAGE.path}`, width: OG_IMAGE.width, height: OG_IMAGE.height },
  };

  const crumbs = [{ name: 'Home', url: `${siteUrl}/` }];
  if (meta.kind === 'coin') crumbs.push({ name: 'Market overview', url: `${siteUrl}/markets` });
  if (meta.path !== '/') crumbs.push({ name: meta.crumb, url });
  if (crumbs.length > 1) {
    webpage.breadcrumb = { '@id': `${url}#breadcrumb` };
    graph.push({ '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`, itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })) });
  }

  const free = { '@type': 'Offer', price: '0', priceCurrency: 'USD' };
  if (meta.kind === 'home') {
    const app = { '@type': 'WebApplication', '@id': `${siteUrl}/#app`, name: brand, url: `${siteUrl}/`, applicationCategory: 'FinanceApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript', offers: free, description: 'Live crypto prices, charts, market overview, screener, news, converter and price alerts. Installable as an app.', publisher: { '@id': org } };
    graph.push(app);
    webpage.mainEntity = { '@id': app['@id'] };
  } else if (meta.kind === 'app') {
    const app = { '@type': 'WebApplication', '@id': `${url}#app`, name: meta.appName, url, applicationCategory: 'FinanceApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript', offers: free, description: desc, publisher: { '@id': org } };
    graph.push(app);
    webpage.mainEntity = { '@id': app['@id'] };
  } else if (meta.kind === 'about' && faq && faq.length) {
    const f = { '@type': 'FAQPage', '@id': `${url}#faq`, url: `${url}#faq`, name: `${brand} frequently asked questions`, inLanguage: 'en', mainEntity: faq };
    graph.push(f);
    webpage.mainEntity = { '@id': f['@id'] };
  } else if (meta.kind === 'coin') {
    const { coin, about } = meta;
    webpage.about = { '@type': 'Thing', name: coin.name, alternateName: coin.ticker, ...(about ? { description: about } : {}) };
  }
  graph.splice(2, 0, webpage);
  return { '@context': 'https://schema.org', '@graph': graph };
}

// Plain links to every coin for visitors and crawlers that do not run scripts (the pages draw the lists with scripts).
export const coinLinksNoscript = (coins, current = '') =>
  `<noscript><ul class="seo-coins">${coins.filter(c => c.ticker !== current).map(c => `<li><a href="/coin/${esc(c.ticker)}">${esc(c.name)} (${esc(c.ticker)}) price</a></li>`).join('')}</ul></noscript>`;

export function sitemapXml({ siteUrl, urls, lastmod }) {
  const body = urls.map(u => `  <url><loc>${esc(siteUrl + u)}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// Crawler groups. Search and "user asks" crawlers are what bring visitors from AI assistants; training crawlers are
// allowed too because the site is public market information. Remove a group here to opt out.
export const AI_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'Claude-SearchBot', 'Claude-User', 'ClaudeBot', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot'];

export function robotsTxt({ brand, siteUrl }) {
  const lines = [`# ${brand} robots.txt`, 'User-agent: *', 'Allow: /', ''];
  lines.push('# AI search and assistant crawlers: allowed.');
  for (const bot of AI_BOTS) lines.push(`User-agent: ${bot}`, 'Allow: /', '');
  if (siteUrl) lines.push(`Sitemap: ${siteUrl}/sitemap.xml`);
  return lines.join('\n') + '\n';
}

export function llmsTxt({ brand, siteUrl, coins, aboutMap, registry, channelUrl }) {
  const l = [];
  l.push(`# ${brand}`, '');
  l.push(`> ${brand} is a free website and installable app with live crypto prices, charts, a market overview, a screener, news headlines, a converter and milestone price alerts for ${coins.length} leading coins. No account, no ads, no tracking. Market information only, not financial advice.`, '');
  l.push('## Pages', '');
  for (const m of Object.values(registry)) l.push(`- [${m.crumb}](${siteUrl}${m.path}): ${m.description}`);
  l.push('', '## Coins', '');
  for (const c of coins) l.push(`- [${c.name} (${c.ticker})](${siteUrl}/coin/${c.ticker}): ${aboutMap[c.ticker] ? firstSentence(aboutMap[c.ticker]) : `Live ${c.name} price, chart and alerts.`}`);
  l.push('', '## Optional', '', `- [Telegram alerts channel](${channelUrl}): the same milestone alerts, posted as they happen.`, `- [Sitemap](${siteUrl}/sitemap.xml)`);
  return l.join('\n') + '\n';
}
