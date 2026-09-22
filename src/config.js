// Central, single source of truth for every coin the bot tracks.
//
// coingeckoId   -> used for /simple/price and /coins/{id} (logo image) calls
// binanceSymbol -> used when Binance supplies prices (backup, or "Binance first").
//                  null = Binance is never used for that coin: it has no USDTUSDT pair,
//                  and its USDCUSDT price is USDC measured in USDT (not dollars), which
//                  would give false depeg signals. Stablecoins always come from CoinGecko.
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
  { ticker: 'AVAX', name: 'Avalanche', coingeckoId: 'avalanche-2',       binanceSymbol: 'AVAXUSDT', defaultThreshold: 0.25, defaultPercent: 2, stable: false, brandColor: '#E84142' },
  { ticker: 'SUI',  name: 'Sui',       coingeckoId: 'sui',               binanceSymbol: 'SUIUSDT',  defaultThreshold: 0.005, defaultPercent: 0.5, stable: false, brandColor: '#4DA2FF' },
  { ticker: 'XLM',  name: 'Stellar',   coingeckoId: 'stellar',           binanceSymbol: 'XLMUSDT',  defaultThreshold: 0.0025, defaultPercent: 1.25, stable: false, brandColor: '#14B6E7' },
  { ticker: 'HBAR', name: 'Hedera',    coingeckoId: 'hedera-hashgraph',  binanceSymbol: 'HBARUSDT', defaultThreshold: 0.001, defaultPercent: 1, stable: false, brandColor: '#8259EF' },
  { ticker: 'DOT',  name: 'Polkadot',  coingeckoId: 'polkadot',          binanceSymbol: 'DOTUSDT',  defaultThreshold: 0.025, defaultPercent: 1, stable: false, brandColor: '#E6007A' },
  { ticker: 'UNI',  name: 'Uniswap',   coingeckoId: 'uniswap',           binanceSymbol: 'UNIUSDT',  defaultThreshold: 0.025, defaultPercent: 1, stable: false, brandColor: '#FF007A' },
  { ticker: 'LTC',  name: 'Litecoin',  coingeckoId: 'litecoin',          binanceSymbol: 'LTCUSDT',  defaultThreshold: 0.25, defaultPercent: 0.5, stable: false, brandColor: '#345D9D' },
  { ticker: 'ZEC',  name: 'Zcash',     coingeckoId: 'zcash',             binanceSymbol: 'ZECUSDT',  defaultThreshold: 5, defaultPercent: 0.5, stable: false, brandColor: '#F4B728' },
  { ticker: 'HYPE', name: 'Hyperliquid', coingeckoId: 'hyperliquid',     binanceSymbol: 'HYPEUSDT', defaultThreshold: 0.25, defaultPercent: 0.5, stable: false, brandColor: '#26D9A5' },
  { ticker: 'USDT', name: 'Tether',    coingeckoId: 'tether',            binanceSymbol: null,       defaultThreshold: 0.005, defaultPercent: 0.5, stable: true,  brandColor: '#26A17B' },
  { ticker: 'USDC', name: 'USD Coin',  coingeckoId: 'usd-coin',          binanceSymbol: null,        defaultThreshold: 0.005, defaultPercent: 0.5, stable: true,  brandColor: '#2775CA' },
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

// Where prices come from. The owner picks this in Settings > Data source.
export const SOURCE_MODES = [
  { key: 'auto',      emoji: '🤖', name: 'Auto',           desc: 'CoinGecko first, Binance as backup' },
  { key: 'coingecko', emoji: '🦎', name: 'CoinGecko only', desc: 'never uses Binance' },
  { key: 'binance',   emoji: '🟨', name: 'Binance first',  desc: 'CoinGecko as backup (and for stablecoins)' },
];
export const DEFAULT_SOURCE_MODE = 'auto';

// How the coin logo is framed on banners. The owner can flip this in
// Settings > Logo style and compare with the Test banner button.
export const LOGO_STYLES = [
  { key: 'clean', emoji: '✨', name: 'Clean',      desc: 'subtle border and soft shadow' },
  { key: 'ring',  emoji: '⚪', name: 'White ring', desc: 'a white margin around the logo' },
];
export const DEFAULT_LOGO_STYLE = 'clean';

export function sourceModeByKey(key) {
  return SOURCE_MODES.find(m => m.key === key) || SOURCE_MODES.find(m => m.key === DEFAULT_SOURCE_MODE);
}

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
