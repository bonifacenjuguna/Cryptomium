// Price providers, ported from the Telegram bot's priceService.js.
// Each returns a Map<ticker, Quote>; coins a provider can't supply are absent.

import { COINS } from './coins.js';
import { config } from './config.js';

export interface Quote {
  price: number;
  change24h?: number; // percent
}
export type QuoteMap = Map<string, Quote>;

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<{ status: number; data: T | null }> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
  const data = res.ok || res.status === 400 ? ((await res.json().catch(() => null)) as T | null) : null;
  return { status: res.status, data };
}

const num = (v: unknown): number => (typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN);
const good = (n: number) => Number.isFinite(n) && n > 0;

// ---------------------------------------------------------------- Binance
// Fastest and most "live". One call returns price + 24h change for every coin.
// Stablecoins are never taken from Binance (see coins.ts).

const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
const badBinance = new Set<string>(); // symbols Binance rejected; skipped from then on

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
}

async function binanceFrom(host: string): Promise<QuoteMap> {
  const coins = COINS.filter(c => c.binanceSymbol && !c.stable && !badBinance.has(c.binanceSymbol));
  const symbols = coins.map(c => c.binanceSymbol as string);
  const url = `${host}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;

  const { status, data } = await getJson<BinanceTicker[]>(url);

  let rows: BinanceTicker[] = [];
  if (status === 400) {
    // One unknown symbol makes Binance reject the WHOLE batch. Probe each
    // symbol once, remember the bad ones, and use what came back.
    const singles = await Promise.all(
      symbols.map(async symbol => {
        const r = await getJson<BinanceTicker>(`${host}/api/v3/ticker/24hr?symbol=${symbol}`);
        if (r.status === 400) badBinance.add(symbol);
        return r.data && r.status === 200 ? r.data : null;
      })
    );
    rows = singles.filter((r): r is BinanceTicker => r !== null);
  } else if (status === 200 && Array.isArray(data)) {
    rows = data;
  } else {
    throw new Error(`Binance (${new URL(host).host}) responded ${status}`);
  }

  const bySymbol = new Map(rows.map(r => [r.symbol, r]));
  const out: QuoteMap = new Map();
  for (const coin of coins) {
    const row = bySymbol.get(coin.binanceSymbol as string);
    const price = num(row?.lastPrice);
    if (!good(price)) continue;
    const change = num(row?.priceChangePercent);
    out.set(coin.ticker, { price, change24h: Number.isFinite(change) ? change : undefined });
  }
  if (out.size === 0) throw new Error('Binance returned no usable prices');
  return out;
}

export async function fetchBinance(): Promise<QuoteMap> {
  let last: unknown;
  // api.binance.com is blocked from some server regions; the vision host is a fallback.
  for (const host of BINANCE_HOSTS) {
    try {
      return await binanceFrom(host);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

// ----------------------------------------------------------------- Kraken
// USD-quoted, so it covers USDT/USDC (which Binance can't). Only asks for the
// tickers we still need.

const KRAKEN_URL = 'https://api.kraken.com/0/public/Ticker';
const badKraken = new Set<string>();

interface KrakenEntry {
  c?: string[]; // last trade [price, lot volume]
  o?: string; // today's opening price
}
interface KrakenResponse {
  error?: string[];
  result?: Record<string, KrakenEntry>;
}

async function krakenCall(pairs: string[]): Promise<Record<string, KrakenEntry>> {
  const { data } = await getJson<KrakenResponse>(`${KRAKEN_URL}?pair=${pairs.join(',')}`);
  return data?.result ?? {};
}

export async function fetchKraken(tickers: string[]): Promise<QuoteMap> {
  const coins = COINS.filter(c => c.krakenSymbol && tickers.includes(c.ticker) && !badKraken.has(c.krakenSymbol));
  const out: QuoteMap = new Map();
  if (coins.length === 0) return out;

  const pairs = coins.map(c => c.krakenSymbol as string);
  let result = await krakenCall(pairs);

  if (Object.keys(result).length === 0) {
    // One bad pair name rejects the whole batch. Probe individually once.
    result = {};
    await Promise.all(
      pairs.map(async pair => {
        const r = await krakenCall([pair]);
        if (Object.keys(r).length === 0) badKraken.add(pair);
        else Object.assign(result, r);
      })
    );
  }
  if (Object.keys(result).length === 0) throw new Error('Kraken returned no usable prices');

  for (const coin of coins) {
    // Kraken keys its response by its own pair name; older assets carry X…Z prefixes
    // (XBTUSD -> XXBTZUSD, ETHUSD -> XETHZUSD), stablecoins carry a Z (USDTUSD -> USDTZUSD).
    const symbol = coin.krakenSymbol as string;
    const base = symbol.replace(/USD$/, '');
    const entry = [symbol, `X${base}ZUSD`, `${base}ZUSD`].map(k => result[k]).find(Boolean);
    const price = num(entry?.c?.[0]);
    if (!good(price)) continue;
    const open = num(entry?.o);
    out.set(coin.ticker, { price, change24h: good(open) ? ((price - open) / open) * 100 : undefined });
  }
  if (out.size === 0) throw new Error('Kraken returned no usable prices');
  return out;
}

// -------------------------------------------------------------- CoinGecko
// Slower (called every ~30s). Supplies a proper 24h change and is the last
// resort for price. Detects Demo vs Pro key automatically.

const CG_DEMO = { base: 'https://api.coingecko.com/api/v3', header: 'x-cg-demo-api-key' };
const CG_PRO = { base: 'https://pro-api.coingecko.com/api/v3', header: 'x-cg-pro-api-key' };
let cgEndpoint: typeof CG_DEMO | null = null;

async function cgGet(path: string): Promise<Response> {
  const call = (ep: typeof CG_DEMO) =>
    fetch(`${ep.base}${path}`, {
      headers: config.coingeckoApiKey ? { [ep.header]: config.coingeckoApiKey } : {},
      signal: AbortSignal.timeout(10_000),
    });

  let ep = cgEndpoint ?? CG_DEMO;
  let res = await call(ep);
  if (!cgEndpoint && config.coingeckoApiKey && (res.status === 401 || res.status === 403)) {
    const pro = await call(CG_PRO);
    if (pro.ok) {
      ep = CG_PRO;
      res = pro;
    }
  }
  if (res.ok) cgEndpoint = cgEndpoint ?? ep;
  return res;
}

export async function fetchCoinGecko(): Promise<QuoteMap> {
  const ids = COINS.map(c => c.coingeckoId).join(',');
  const res = await cgGet(`/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
  if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
  const data = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;

  const out: QuoteMap = new Map();
  for (const coin of COINS) {
    const entry = data?.[coin.coingeckoId];
    const price = num(entry?.usd);
    if (!good(price)) continue;
    const change = num(entry?.usd_24h_change);
    out.set(coin.ticker, { price, change24h: Number.isFinite(change) ? change : undefined });
  }
  if (out.size === 0) throw new Error('CoinGecko returned no usable prices');
  return out;
}
