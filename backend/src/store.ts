// Keeps the latest price for every coin and tells listeners when it changes.
//
//   every POLL_INTERVAL_MS : Binance -> Kraken (only for what Binance lacks)
//   every ~30s (separately): CoinGecko, for 24h change + last-resort prices
//
// Price comes from the fastest source that has the coin; 24h change prefers
// Binance, then CoinGecko, then Kraken's (today's-open based) figure.

import { COINS } from './coins.js';
import { config } from './config.js';
import { fetchBinance, fetchCoinGecko, fetchKraken, type QuoteMap } from './providers.js';

export interface CoinQuote {
  ticker: string;
  price: number;
  change24h: number | null;
  source: 'binance' | 'kraken' | 'coingecko';
}

export interface SourceHealth {
  ok: boolean;
  lastOkAt: number | null;
  error: string | null;
}

type Listener = (quotes: CoinQuote[]) => void;
type SourceName = 'binance' | 'kraken' | 'coingecko';

const CG_MAX_AGE_MS = 5 * 60_000; // ignore CoinGecko prices older than this

const quotes = new Map<string, CoinQuote>();
const listeners = new Set<Listener>();
const health: Record<SourceName, SourceHealth> = {
  binance: { ok: false, lastOkAt: null, error: 'not polled yet' },
  kraken: { ok: false, lastOkAt: null, error: 'not polled yet' },
  coingecko: { ok: false, lastOkAt: null, error: 'not polled yet' },
};
let coingecko: { at: number; quotes: QuoteMap } | null = null;
let stopped = false;

export const getQuotes = (): CoinQuote[] => COINS.flatMap(c => quotes.get(c.ticker) ?? []);
export const getHealth = () => health;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function attempt(name: SourceName, run: () => Promise<QuoteMap>): Promise<QuoteMap> {
  try {
    const result = await run();
    if (!health[name].ok) console.log(`[prices] ${name} is up (${result.size} coins)`);
    health[name] = { ok: true, lastOkAt: Date.now(), error: null };
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (health[name].ok || health[name].error === 'not polled yet') console.warn(`[prices] ${name} failing: ${message}`);
    health[name] = { ...health[name], ok: false, error: message };
    return new Map();
  }
}

async function pollExchanges(): Promise<void> {
  const binance = await attempt('binance', fetchBinance);
  const missing = COINS.filter(c => !binance.has(c.ticker)).map(c => c.ticker);
  const kraken = missing.length ? await attempt('kraken', () => fetchKraken(missing)) : new Map();

  const cgFresh = coingecko && Date.now() - coingecko.at < CG_MAX_AGE_MS ? coingecko.quotes : new Map();
  const changed: CoinQuote[] = [];

  for (const coin of COINS) {
    const b = binance.get(coin.ticker);
    const k = kraken.get(coin.ticker);
    const g = cgFresh.get(coin.ticker);

    const source: SourceName | null = b ? 'binance' : k ? 'kraken' : g ? 'coingecko' : null;
    if (!source) continue; // nothing new; keep whatever we had

    const price = (b ?? k ?? g)!.price;
    const prev = quotes.get(coin.ticker);
    const next: CoinQuote = {
      ticker: coin.ticker,
      price,
      change24h: b?.change24h ?? g?.change24h ?? k?.change24h ?? prev?.change24h ?? null,
      source,
    };

    quotes.set(coin.ticker, next);
    if (!prev || prev.price !== next.price || prev.change24h !== next.change24h) changed.push(next);
  }

  if (changed.length > 0) {
    const all = getQuotes();
    for (const fn of listeners) fn(all);
  }
}

async function pollCoinGecko(): Promise<void> {
  const result = await attempt('coingecko', fetchCoinGecko);
  if (result.size > 0) coingecko = { at: Date.now(), quotes: result };
}

/** Repeatedly runs `job`, waiting `ms` after each run finishes (no overlap). */
function loop(job: () => Promise<void>, ms: number): void {
  const run = async () => {
    if (stopped) return;
    try {
      await job();
    } catch (err) {
      console.error('[prices] poll error:', err);
    }
    if (!stopped) setTimeout(run, ms).unref?.();
  };
  void run();
}

export function startPolling(): void {
  // CoinGecko first, so its 24h change is ready by the first exchange poll.
  void pollCoinGecko().finally(() => loop(pollExchanges, config.pollIntervalMs));
  setInterval(() => void pollCoinGecko(), config.coingeckoIntervalMs).unref();
}

export function stopPolling(): void {
  stopped = true;
}
