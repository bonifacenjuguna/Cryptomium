import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, mergeNews, tagItem, stripTags } from '../src/news.js';
import { buildBreadth, fetchGlobal } from '../src/globalData.js';
import { fetchMarket } from '../src/marketData.js';
import { COINS } from '../src/config.js';

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Bitcoin ETF inflows hit a record &amp; analysts react]]></title><link>https://example.com/a?utm=1</link>
<pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>BlackRock&#39;s fund took in <b>billions</b>.</p>]]></description></item>
<item><title>No link here</title><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Solana network upgrade ships</title><link>https://example.com/b</link><pubDate>Mon, 05 Oct 2026 12:00:00 GMT</pubDate><description>${'x '.repeat(300)}</description></item>
</channel></rss>`;
const ATOM = `<feed><entry><title>Hack drains exchange</title><link href="https://example.org/c"/><updated>2026-10-05T09:00:00Z</updated><summary>Exploit found</summary></entry></feed>`;

test('news: parses RSS and Atom, decodes entities, drops items without a link or date', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Bitcoin ETF inflows hit a record & analysts react');
  assert.equal(items[0].summary, "BlackRock's fund took in billions .");
  assert.equal(parseFeed(ATOM)[0].link, 'https://example.org/c');
});

test('news: excerpts are capped so we never republish an article', () => {
  const long = parseFeed(RSS)[1];
  assert.ok(long.summary.length <= 221);
});

test('news: tags coins and categories from the headline', () => {
  const t = tagItem({ title: 'Bitcoin ETF inflows hit a record', summary: '' });
  assert.deepEqual(t.coins, ['BTC']);
  assert.ok(t.categories.includes('etf') && t.categories.includes('bitcoin'));
  assert.ok(tagItem({ title: 'Hack drains exchange', summary: '' }).categories.includes('security'));
});

test('news: merge sorts newest first, drops duplicates and future-dated items', () => {
  const feedA = { id: 'a', name: 'A' }, feedB = { id: 'b', name: 'B' };
  const now = Date.parse('2026-10-05T13:00:00Z');
  const out = mergeNews([
    { feed: feedA, items: parseFeed(RSS) },
    { feed: feedB, items: [{ title: 'dup', link: 'https://example.com/a', summary: '', at: now }, { title: 'future', link: 'https://x.com/f', summary: '', at: now + 5 * 3600_000 }] },
  ], { now });
  assert.deepEqual(out.map(i => i.publisher), ['A', 'A']);
  assert.ok(out[0].at > out[1].at);
});

test('news: stripTags handles double-encoded markup', () => {
  assert.equal(stripTags('&lt;p&gt;Hi &amp;amp; bye&lt;/p&gt;'), 'Hi & bye');
});

test('global: reads CoinGecko /global and rejects odd responses', async () => {
  const ok = { data: { total_market_cap: { usd: 3e12 }, total_volume: { usd: 1e11 }, market_cap_percentage: { btc: 55.5, eth: 12 }, market_cap_change_percentage_24h_usd: -1.2, active_cryptocurrencies: 15000 } };
  const g = await fetchGlobal({ get: async () => ({ res: { ok: true, json: async () => ok } }) });
  assert.equal(g.marketCap, 3e12); assert.equal(g.btcDominance, 55.5); assert.equal(g.marketCapChange24h, -1.2);
  await assert.rejects(fetchGlobal({ get: async () => ({ res: { ok: true, json: async () => ({}) } }) }));
});

test('global: breadth ignores stablecoins for direction but counts their cap', () => {
  const coins = {};
  const nonStable = COINS.filter(c => !c.stable), stable = COINS.filter(c => c.stable);
  nonStable.forEach((c, i) => { coins[c.ticker] = { marketCap: 100, volume24h: 10, change24h: i % 2 ? 2 : -2 }; });
  stable.forEach(c => { coins[c.ticker] = { marketCap: 1000, volume24h: 10, change24h: 0.01 }; });
  const b = buildBreadth({ coins }, { marketCap: 1e6 });
  assert.equal(b.up + b.down + b.flat, nonStable.length);
  assert.equal(b.stableCap, stable.length * 1000);
  assert.ok(b.stableShare > 0);
});

test('market: exposes ATL and distance fields', async () => {
  const item = id => ({ id, market_cap: 1, total_volume: 1, ath: 10, ath_change_percentage: -50, atl: 1, atl_date: '2020-01-01T00:00:00Z', atl_change_percentage: 400 });
  const data = COINS.slice(0, 2).map(c => item(c.coingeckoId));
  const m = await fetchMarket({ get: async () => ({ res: { ok: true, json: async () => data } }) });
  const t = COINS[0].ticker;
  assert.equal(m.coins[t].atl, 1); assert.equal(m.coins[t].athChange, -50); assert.equal(m.coins[t].atlChange, 400);
});
