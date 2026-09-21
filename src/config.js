// Central, single source of truth for every coin the bot tracks.
//
// coingeckoId   -> used for /simple/price and /coins/{id} (logo image) calls
// binanceSymbol -> used for the fallback price feed (Binance's public ticker API).
//                  null = no such pair exists (Binance has no USDTUSDT); that coin is
//                  simply skipped when the fallback feed is used.
// defaultThreshold -> starting milestone step size in dollars (owner can change per-coin in the bot)
// defaultPercent   -> starting milestone step size when a coin is switched to percentage
//                     steps (alert every time price moves this % from the last alert)
// stable        -> true for USDT/USDC, which use a depeg-band check instead of
//                  round-number milestones
// brandColor    -> the coin's own recognizable brand color, used as the
//                  banner background for that coin (SOL's brand is
//                  technically a purple->teal gradient; we use its primary
//                  purple as a single flat color for consistency with the
//                  other 11 coins)
export const COINS = [
  { ticker: 'BTC',  name: 'Bitcoin',   coingeckoId: 'bitcoin',           binanceSymbol: 'BTCUSDT',  defaultThreshold: 500, defaultPercent: 0.5, stable: false, brandColor: '#F7931A' },
  { ticker: 'ETH',  name: 'Ethereum',  coingeckoId: 'ethereum',          binanceSymbol: 'ETHUSDT',  defaultThreshold: 25, defaultPercent: 0.75, stable: false, brandColor: '#627EEA' },
  { ticker: 'XRP',  name: 'XRP',       coingeckoId: 'ripple',            binanceSymbol: 'XRPUSDT',  defaultThreshold: 0.02, defaultPercent: 1, stable: false, brandColor: '#23292F' },
  { ticker: 'BNB',  name: 'BNB',       coingeckoId: 'binancecoin',       binanceSymbol: 'BNBUSDT',  defaultThreshold: 5, defaultPercent: 0.75, stable: false, brandColor: '#F0B90B' },
  { ticker: 'SOL',  name: 'Solana',    coingeckoId: 'solana',            binanceSymbol: 'SOLUSDT',  defaultThreshold: 1, defaultPercent: 1, stable: false, brandColor: '#9945FF' },
  { ticker: 'TRX',  name: 'TRON',      coingeckoId: 'tron',              binanceSymbol: 'TRXUSDT',  defaultThreshold: 0.01, defaultPercent: 1, stable: false, brandColor: '#EF0027' },
  { ticker: 'DOGE', name: 'Dogecoin',  coingeckoId: 'dogecoin',          binanceSymbol: 'DOGEUSDT', defaultThreshold: 0.001, defaultPercent: 1, stable: false, brandColor: '#C2A633' },
  { ticker: 'ADA',  name: 'Cardano',   coingeckoId: 'cardano',           binanceSymbol: 'ADAUSDT',  defaultThreshold: 0.005, defaultPercent: 1, stable: false, brandColor: '#0033AD' },
  { ticker: 'LINK', name: 'Chainlink', coingeckoId: 'chainlink',         binanceSymbol: 'LINKUSDT', defaultThreshold: 0.25, defaultPercent: 1, stable: false, brandColor: '#2A5ADA' },
  { ticker: 'TON',  name: 'Toncoin',   coingeckoId: 'the-open-network',  binanceSymbol: 'TONUSDT',  defaultThreshold: 0.05, defaultPercent: 1, stable: false, brandColor: '#0098EA' },
  { ticker: 'USDT', name: 'Tether',    coingeckoId: 'tether',            binanceSymbol: null,       defaultThreshold: 0.005, defaultPercent: 0.5, stable: true,  brandColor: '#26A17B' },
  { ticker: 'USDC', name: 'USD Coin',  coingeckoId: 'usd-coin',          binanceSymbol: 'USDCUSDT', defaultThreshold: 0.005, defaultPercent: 0.5, stable: true,  brandColor: '#2775CA' },
];

export const TICKERS = COINS.map(c => c.ticker);

// Alert "modes": a multiplier applied to each coin's base step (x), for both
// dollar steps and percentage steps. Steady is the coin's own step as-is.
export const MODES = [
  { key: 'hyper',  emoji: '🚀', name: 'Hyper',  multiplier: 0.25, label: '¼x' },
  { key: 'fast',   emoji: '💨', name: 'Fast',   multiplier: 0.5,  label: '½x' },
  { key: 'steady', emoji: '🎯', name: 'Steady', multiplier: 1,    label: 'x' },
  { key: 'calm',   emoji: '😌', name: 'Calm',   multiplier: 2,    label: '2x' },
];
export const DEFAULT_MODE = 'steady';

export function modeByKey(key) {
  return MODES.find(m => m.key === key) || MODES.find(m => m.key === DEFAULT_MODE);
}

export function coinByTicker(ticker) {
  return COINS.find(c => c.ticker === ticker.toUpperCase());
}

export const CONFIG = {
  ownerId: Number(process.env.OWNER_TELEGRAM_ID),
  botToken: process.env.BOT_TOKEN,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  watermark: process.env.WATERMARK_HANDLE || '@priceping',
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Africa/Nairobi',
  // How often the price loop checks for milestone crossings.
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 30_000),
  // Optional CoinGecko demo/pro key. Not required, but raises the rate limit
  // (used for prices and for downloading logos).
  coingeckoApiKey: process.env.COINGECKO_API_KEY || '',
};

export function coingeckoHeaders() {
  return CONFIG.coingeckoApiKey ? { 'x-cg-demo-api-key': CONFIG.coingeckoApiKey } : {};
}
