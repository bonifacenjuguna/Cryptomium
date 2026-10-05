// Crypto headlines from publishers' own public RSS feeds. No API key, no scraping:
// we read the feed a publisher offers for exactly this purpose, keep only the headline,
// a short excerpt, the date and the link, and send readers to the original article.
// Each feed is fetched at most once per cache window and a broken feed never hides the others.
import { COINS } from './config.js';

export const FEEDS = [
  { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { id: 'decrypt', name: 'Decrypt', url: 'https://decrypt.co/feed' },
  { id: 'bitcoinmagazine', name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/.rss/full/' },
];

export const CATEGORIES = {
  bitcoin: /\b(bitcoin|btc|satoshi|halving)\b/i,
  ethereum: /\b(ethereum|ether|eth|layer[- ]?2|rollup)\b/i,
  defi: /\b(defi|dex|uniswap|aave|lending|stablecoin yield|liquidity pool|staking)\b/i,
  regulation: /\b(sec|cftc|regulat\w*|lawsuit|court|ban|law|legislat\w*|congress|senate|mica|tax\w*|compliance)\b/i,
  etf: /\b(etf|etfs|blackrock|fidelity|grayscale|spot (bitcoin|ether))\b/i,
  exchanges: /\b(binance|coinbase|kraken|okx|bybit|bitget|exchange|listing|delist\w*)\b/i,
  security: /\b(hack\w*|exploit\w*|stolen|theft|breach|phishing|scam|drain\w*|vulnerab\w*|rug ?pull)\b/i,
  network: /\b(upgrade|hard fork|mainnet|testnet|protocol|validator|node|fork)\b/i,
  macro: /\b(fed|inflation|interest rates?|treasury|cpi|jobs report|tariff\w*|recession|dollar)\b/i,
};

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
export const decode = s =>
  String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, m => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
export const stripTags = s => decode(decode(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};

/** RSS 2.0 <item> and Atom <entry> → [{ title, link, summary, at }]. */
export function parseFeed(xml) {
  const out = [];
  const blocks = String(xml).match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const title = stripTags(tag(b, 'title'));
    let link = stripTags(tag(b, 'link'));
    if (!link) link = (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    const when = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const at = Date.parse(decode(when).trim());
    const raw = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded');
    let summary = stripTags(raw);
    if (summary.length > 220) summary = summary.slice(0, 217).replace(/\s+\S*$/, '') + '…'; // an excerpt, never the article
    if (!title || !/^https?:\/\//i.test(link) || !Number.isFinite(at)) continue;
    out.push({ title, link, summary, at });
  }
  return out;
}

const NAME_HITS = COINS.filter(c => !c.stable).map(c => ({
  ticker: c.ticker,
  re: new RegExp(`\\b(${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${c.ticker.length >= 3 ? '|' + c.ticker : ''})\\b`, c.ticker.length >= 3 ? 'i' : ''),
}));

/** Coins and categories a headline is about (matched on the headline + excerpt only). */
export function tagItem(item) {
  const text = `${item.title} ${item.summary}`;
  const coins = NAME_HITS.filter(h => h.re.test(text)).map(h => h.ticker).slice(0, 4);
  const categories = Object.entries(CATEGORIES).filter(([, re]) => re.test(text)).map(([k]) => k);
  if (coins.includes('BTC') && !categories.includes('bitcoin')) categories.push('bitcoin');
  if (coins.includes('ETH') && !categories.includes('ethereum')) categories.push('ethereum');
  const alt = coins.some(t => t !== 'BTC' && t !== 'ETH');
  if (alt) categories.push('altcoins');
  return { coins, categories: [...new Set(categories)] };
}

/** Merges feeds: newest first, one entry per link, same story from two outlets kept apart. */
export function mergeNews(results, { limit = 120, now = Date.now() } = {}) {
  const seen = new Set();
  const all = [];
  for (const { feed, items } of results) {
    for (const it of items) {
      const key = it.link.replace(/[?#].*$/, '');
      if (seen.has(key) || it.at > now + 60 * 60_000) continue;
      seen.add(key);
      all.push({ ...it, publisher: feed.name, publisherId: feed.id, ...tagItem(it) });
    }
  }
  all.sort((a, b) => b.at - a.at);
  return all.slice(0, limit).map(i => ({ ...i, at: new Date(i.at).toISOString() }));
}

export async function fetchNews({ feeds = FEEDS, fetchImpl = fetch } = {}) {
  const settled = await Promise.allSettled(
    feeds.map(async feed => {
      const res = await fetchImpl(feed.url, {
        headers: { 'User-Agent': 'CryptomiumNewsReader/3.0 (+headline aggregator; links to originals)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`${feed.name} responded ${res.status}`);
      return { feed, items: parseFeed((await res.text()).slice(0, 2_000_000)) };
    })
  );
  const ok = settled.filter(r => r.status === 'fulfilled').map(r => r.value).filter(r => r.items.length > 0);
  if (ok.length === 0) throw new Error('No news feed could be read');
  return {
    updatedAt: new Date().toISOString(),
    publishers: ok.map(r => ({ id: r.feed.id, name: r.feed.name, count: r.items.length })),
    unavailable: feeds.filter(f => !ok.some(r => r.feed.id === f.id)).map(f => f.name),
    items: mergeNews(ok),
  };
}
