// Central, single source of truth for every coin the bot tracks.
//
// coingeckoId    -> used for /simple/price and /coins/{id} (logo image) calls
// binanceSymbol  -> used when Binance supplies prices. null = Binance is never used for
//                   that coin: it has no USDTUSDT pair, and its USDCUSDT price is USDC
//                   measured in USDT (not dollars), which would give false depeg signals.
// krakenSymbol   -> used when Kraken supplies prices. Unlike Binance, Kraken genuinely
//                   quotes USDT and USDC against real USD (it's a fiat-rail exchange), so
//                   stablecoins ARE included here. null = not confident Kraken lists it
//                   (BNB is a rival exchange's token and isn't listed there; HYPE is too
//                   new to be confident about) — that coin is simply skipped on Kraken.
// coinpaprikaId  -> used when CoinPaprika supplies prices (its "id" field, not the ticker,
//                   since several unrelated coins can share a ticker symbol).
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
  { ticker: 'BTC',  name: 'Bitcoin',   coingeckoId: 'bitcoin',           binanceSymbol: 'BTCUSDT',  krakenSymbol: 'XBTUSD',  coinpaprikaId: 'btc-bitcoin',     defaultThreshold: 500, defaultPercent: 0.5, stable: false, brandColor: '#F7931A' },
  { ticker: 'ETH',  name: 'Ethereum',  coingeckoId: 'ethereum',          binanceSymbol: 'ETHUSDT',  krakenSymbol: 'ETHUSD',  coinpaprikaId: 'eth-ethereum',  defaultThreshold: 15, defaultPercent: 0.5, stable: false, brandColor: '#627EEA' },
  { ticker: 'XRP',  name: 'XRP',       coingeckoId: 'ripple',            binanceSymbol: 'XRPUSDT',  krakenSymbol: 'XRPUSD',  coinpaprikaId: 'xrp-xrp',    defaultThreshold: 0.02, defaultPercent: 1, stable: false, brandColor: '#23292F' },
  { ticker: 'BNB',  name: 'BNB',       coingeckoId: 'binancecoin',       binanceSymbol: 'BNBUSDT',  krakenSymbol: null,      coinpaprikaId: 'bnb-binance-coin',  defaultThreshold: 3, defaultPercent: 0.5, stable: false, brandColor: '#F0B90B' },
  { ticker: 'SOL',  name: 'Solana',    coingeckoId: 'solana',            binanceSymbol: 'SOLUSDT',  krakenSymbol: 'SOLUSD',  coinpaprikaId: 'sol-solana',  defaultThreshold: 1, defaultPercent: 1, stable: false, brandColor: '#9945FF' },
  { ticker: 'TRX',  name: 'TRON',      coingeckoId: 'tron',              binanceSymbol: 'TRXUSDT',  krakenSymbol: 'TRXUSD',  coinpaprikaId: 'trx-tron',  defaultThreshold: 0.004, defaultPercent: 0.5, stable: false, brandColor: '#EF0027' },
  { ticker: 'DOGE', name: 'Dogecoin',  coingeckoId: 'dogecoin',          binanceSymbol: 'DOGEUSDT', krakenSymbol: 'XDGUSD',  coinpaprikaId: 'doge-dogecoin',    defaultThreshold: 0.001, defaultPercent: 1, stable: false, brandColor: '#C2A633' },
  { ticker: 'ADA',  name: 'Cardano',   coingeckoId: 'cardano',           binanceSymbol: 'ADAUSDT',  krakenSymbol: 'ADAUSD',  coinpaprikaId: 'ada-cardano',  defaultThreshold: 0.003, defaultPercent: 0.6, stable: false, brandColor: '#0033AD' },
  { ticker: 'LINK', name: 'Chainlink', coingeckoId: 'chainlink',         binanceSymbol: 'LINKUSDT', krakenSymbol: 'LINKUSD', coinpaprikaId: 'link-chainlink',  defaultThreshold: 0.15, defaultPercent: 0.6, stable: false, brandColor: '#2A5ADA' },
  { ticker: 'TON',  name: 'Toncoin',   coingeckoId: 'the-open-network',  binanceSymbol: 'TONUSDT',  krakenSymbol: 'TONUSD',  coinpaprikaId: 'ton-toncoin', defaultThreshold: 0.025, defaultPercent: 0.6, stable: false, brandColor: '#0098EA' },
  { ticker: 'AVAX', name: 'Avalanche', coingeckoId: 'avalanche-2',       binanceSymbol: 'AVAXUSDT', krakenSymbol: 'AVAXUSD', coinpaprikaId: 'avax-avalanche',  defaultThreshold: 0.15, defaultPercent: 1.25, stable: false, brandColor: '#E84142' },
  { ticker: 'SUI',  name: 'Sui',       coingeckoId: 'sui',               binanceSymbol: 'SUIUSDT',  krakenSymbol: 'SUIUSD',  coinpaprikaId: 'sui-sui', defaultThreshold: 0.03, defaultPercent: 1.5, stable: false, brandColor: '#4DA2FF' },
  { ticker: 'XLM',  name: 'Stellar',   coingeckoId: 'stellar',           binanceSymbol: 'XLMUSDT',  krakenSymbol: 'XLMUSD',  coinpaprikaId: 'xlm-stellar',   defaultThreshold: 0.0025, defaultPercent: 1.25, stable: false, brandColor: '#14B6E7' },
  { ticker: 'HBAR', name: 'Hedera',    coingeckoId: 'hedera-hashgraph',  binanceSymbol: 'HBARUSDT', krakenSymbol: 'HBARUSD', coinpaprikaId: 'hbar-hedera-hashgraph', defaultThreshold: 0.006, defaultPercent: 1.5, stable: false, brandColor: '#8259EF' },
  { ticker: 'DOT',  name: 'Polkadot',  coingeckoId: 'polkadot',          binanceSymbol: 'DOTUSDT',  krakenSymbol: 'DOTUSD',  coinpaprikaId: 'dot-polkadot',  defaultThreshold: 0.015, defaultPercent: 0.6, stable: false, brandColor: '#E6007A' },
  { ticker: 'UNI',  name: 'Uniswap',   coingeckoId: 'uniswap',           binanceSymbol: 'UNIUSDT',  krakenSymbol: 'UNIUSD',  coinpaprikaId: 'uni-uniswap',  defaultThreshold: 0.15, defaultPercent: 1.5, stable: false, brandColor: '#FF007A' },
  { ticker: 'LTC',  name: 'Litecoin',  coingeckoId: 'litecoin',          binanceSymbol: 'LTCUSDT',  krakenSymbol: 'LTCUSD',  coinpaprikaId: 'ltc-litecoin',     defaultThreshold: 1.5, defaultPercent: 1, stable: false, brandColor: '#345D9D' },
  { ticker: 'ZEC',  name: 'Zcash',     coingeckoId: 'zcash',             binanceSymbol: 'ZECUSDT',  krakenSymbol: 'ZECUSD',  coinpaprikaId: 'zec-zcash',  defaultThreshold: 25, defaultPercent: 1, stable: false, brandColor: '#F4B728' },
  { ticker: 'HYPE', name: 'Hyperliquid', coingeckoId: 'hyperliquid',     binanceSymbol: 'HYPEUSDT', krakenSymbol: null,      coinpaprikaId: 'hype-hyperliquid', defaultThreshold: 1.5, defaultPercent: 1.5, stable: false, brandColor: '#26D9A5' },
  { ticker: 'USDT', name: 'Tether',    coingeckoId: 'tether',            binanceSymbol: null,       krakenSymbol: 'USDTUSD', coinpaprikaId: 'usdt-tether',   defaultThreshold: 0.005, defaultPercent: 0.5, stable: true,  brandColor: '#26A17B' },
  { ticker: 'USDC', name: 'USD Coin',  coingeckoId: 'usd-coin',          binanceSymbol: null,       krakenSymbol: 'USDCUSD', coinpaprikaId: 'usdc-usd-coin',  defaultThreshold: 0.005, defaultPercent: 0.5, stable: true,  brandColor: '#2775CA' },
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
//
// Each source has a "role" that explains why it's positioned the way it is:
//   - 'aggregator' : one call covers every coin (CoinGecko, CoinPaprika)
//   - 'exchange'    : real order-book prices, but only for coins that exchange lists
//                     (Binance, Kraken)
//   - 'blend'       : not a single source at all — queries several sources at once and
//                      combines them (🧮 Average price; see fetchAverage() in priceService.js)
//
// 🤖 Auto tries CoinGecko, Binance and Kraken (all comfortably sustainable at this
// bot's 30-second polling), and only reaches CoinPaprika as a last resort if all
// three of those fail at once — which is rare enough to stay well inside
// CoinPaprika's free-tier ceiling (~20-25k calls/month; NOT enough to poll
// every 30s as a steady diet, hence it isn't tried first).
export const SOURCE_MODES = [
  { key: 'auto',        emoji: '🤖', name: 'Auto',            role: 'aggregator', desc: 'CoinGecko, then Binance, Kraken, CoinPaprika if needed' },
  { key: 'coingecko',   emoji: '🦎', name: 'CoinGecko only',  role: 'aggregator', desc: 'never uses another source' },
  { key: 'binance',     emoji: '🟨', name: 'Binance first',   role: 'exchange',   desc: 'CoinGecko as backup (and for stablecoins)' },
  { key: 'kraken',      emoji: '🐙', name: 'Kraken first',    role: 'exchange',   desc: 'CoinGecko as backup' },
  { key: 'coinpaprika', emoji: '🌶️', name: 'CoinPaprika first', role: 'aggregator', desc: 'CoinGecko as backup — mind the ~25k calls/month free limit' },
  { key: 'average',     emoji: '🧮', name: 'Average price',   role: 'blend',      desc: 'CoinGecko + Binance + Kraken, midpoint of the range' },
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
  // (used for prices and for downloading logos). The bot auto-detects
  // whether this is a Demo or Pro-tier key (see priceService.js), so
  // upgrading to a paid CoinGecko plan needs no other change here.
  coingeckoApiKey: process.env.COINGECKO_API_KEY || '',
};

export function coingeckoHeaders() {
  return CONFIG.coingeckoApiKey ? { 'x-cg-demo-api-key': CONFIG.coingeckoApiKey } : {};
}

