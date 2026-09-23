// Central, single source of truth for every coin the bot tracks.
//
// coingeckoId    -> used for /simple/price and /coins/{id} (logo image) calls
// binanceSymbol  -> used when Binance supplies prices (backup, or "Binance first").
//                   null = Binance is never used for that coin: it has no USDTUSDT pair,
//                   and its USDCUSDT price is USDC measured in USDT (not dollars), which
//                   would give false depeg signals. Stablecoins always come from CoinGecko
//                   when Binance is involved.
// krakenPair     -> altname Kraken's public Ticker endpoint accepts for this coin's
//                   USD market (e.g. "XBTUSD"). null = not listed on Kraken. Unlike
//                   Binance, Kraken quotes USDT/USDC directly against USD, so it is
//                   trusted for stablecoins too.
// coinpaprikaId  -> CoinPaprika's own id format ("btc-bitcoin"). Used for its bulk
//                   /v1/tickers endpoint (keyless, also reports USD for stablecoins).
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
  { ticker: 'BTC',  name: 'Bitcoin',   coingeckoId: 'bitcoin',           binanceSymbol: 'BTCUSDT',  krakenPair: 'XBTUSD',  coinpaprikaId: 'btc-bitcoin',          defaultThreshold: 500, defaultPercent: 0.5, stable: false, brandColor: '#F7931A' },
  { ticker: 'ETH',  name: 'Ethereum',  coingeckoId: 'ethereum',          binanceSymbol: 'ETHUSDT',  krakenPair: 'ETHUSD',  coinpaprikaId: 'eth-ethereum',         defaultThreshold: 25, defaultPercent: 0.75, stable: false, brandColor: '#627EEA' },
  { ticker: 'XRP',  name: 'XRP',       coingeckoId: 'ripple',            binanceSymbol: 'XRPUSDT',  krakenPair: 'XRPUSD',  coinpaprikaId: 'xrp-xrp',              defaultThreshold: 0.02, defaultPercent: 1, stable: false, brandColor: '#23292F' },
  { ticker: 'BNB',  name: 'BNB',       coingeckoId: 'binancecoin',       binanceSymbol: 'BNBUSDT',  krakenPair: 'BNBUSD',  coinpaprikaId: 'bnb-binance-coin',     defaultThreshold: 5, defaultPercent: 0.75, stable: false, brandColor: '#F0B90B' },
  { ticker: 'SOL',  name: 'Solana',    coingeckoId: 'solana',            binanceSymbol: 'SOLUSDT',  krakenPair: 'SOLUSD',  coinpaprikaId: 'sol-solana',           defaultThreshold: 1, defaultPercent: 1, stable: false, brandColor: '#9945FF' },
  { ticker: 'TRX',  name: 'TRON',      coingeckoId: 'tron',              binanceSymbol: 'TRXUSDT',  krakenPair: 'TRXUSD',  coinpaprikaId: 'trx-tron',             defaultThreshold: 0.01, defaultPercent: 1, stable: false, brandColor: '#EF0027' },
  { ticker: 'DOGE', name: 'Dogecoin',  coingeckoId: 'dogecoin',          binanceSymbol: 'DOGEUSDT', krakenPair: 'XDGUSD',  coinpaprikaId: 'doge-dogecoin',        defaultThreshold: 0.001, defaultPercent: 1, stable: false, brandColor: '#C2A633' },
  { ticker: 'ADA',  name: 'Cardano',   coingeckoId: 'cardano',           binanceSymbol: 'ADAUSDT',  krakenPair: 'ADAUSD',  coinpaprikaId: 'ada-cardano',          defaultThreshold: 0.005, defaultPercent: 1, stable: false, brandColor: '#0033AD' },
  { ticker: 'LINK', name: 'Chainlink', coingeckoId: 'chainlink',         binanceSymbol: 'LINKUSDT', krakenPair: 'LINKUSD', coinpaprikaId: 'link-chainlink',       defaultThreshold: 0.25, defaultPercent: 1, stable: false, brandColor: '#2A5ADA' },
  { ticker: 'TON',  name: 'Toncoin',   coingeckoId: 'the-open-network',  binanceSymbol: 'TONUSDT',  krakenPair: 'TONUSD',  coinpaprikaId: 'ton-toncoin',          defaultThreshold: 0.05, defaultPercent: 1, stable: false, brandColor: '#0098EA' },
  { ticker: 'AVAX', name: 'Avalanche', coingeckoId: 'avalanche-2',       binanceSymbol: 'AVAXUSDT', krakenPair: 'AVAXUSD', coinpaprikaId: 'avax-avalanche',       defaultThreshold: 0.25, defaultPercent: 2, stable: false, brandColor: '#E84142' },
  { ticker: 'SUI',  name: 'Sui',       coingeckoId: 'sui',               binanceSymbol: 'SUIUSDT',  krakenPair: 'SUIUSD',  coinpaprikaId: 'sui-sui',              defaultThreshold: 0.005, defaultPercent: 0.5, stable: false, brandColor: '#4DA2FF' },
  { ticker: 'XLM',  name: 'Stellar',   coingeckoId: 'stellar',           binanceSymbol: 'XLMUSDT',  krakenPair: 'XLMUSD',  coinpaprikaId: 'xlm-stellar',          defaultThreshold: 0.0025, defaultPercent: 1.25, stable: false, brandColor: '#14B6E7' },
  { ticker: 'HBAR', name: 'Hedera',    coingeckoId: 'hedera-hashgraph',  binanceSymbol: 'HBARUSDT', krakenPair: 'HBARUSD', coinpaprikaId: 'hbar-hedera-hashgraph', defaultThreshold: 0.001, defaultPercent: 1, stable: false, brandColor: '#8259EF' },
  { ticker: 'DOT',  name: 'Polkadot',  coingeckoId: 'polkadot',          binanceSymbol: 'DOTUSDT',  krakenPair: 'DOTUSD',  coinpaprikaId: 'dot-polkadot',         defaultThreshold: 0.025, defaultPercent: 1, stable: false, brandColor: '#E6007A' },
  { ticker: 'UNI',  name: 'Uniswap',   coingeckoId: 'uniswap',           binanceSymbol: 'UNIUSDT',  krakenPair: 'UNIUSD',  coinpaprikaId: 'uni-uniswap',          defaultThreshold: 0.025, defaultPercent: 1, stable: false, brandColor: '#FF007A' },
  { ticker: 'LTC',  name: 'Litecoin',  coingeckoId: 'litecoin',          binanceSymbol: 'LTCUSDT',  krakenPair: 'LTCUSD',  coinpaprikaId: 'ltc-litecoin',         defaultThreshold: 0.25, defaultPercent: 0.5, stable: false, brandColor: '#345D9D' },
  { ticker: 'ZEC',  name: 'Zcash',     coingeckoId: 'zcash',             binanceSymbol: 'ZECUSDT',  krakenPair: 'ZECUSD',  coinpaprikaId: 'zec-zcash',            defaultThreshold: 5, defaultPercent: 0.5, stable: false, brandColor: '#F4B728' },
  { ticker: 'HYPE', name: 'Hyperliquid', coingeckoId: 'hyperliquid',     binanceSymbol: 'HYPEUSDT', krakenPair: 'HYPEUSD', coinpaprikaId: 'hype-hyperliquid',     defaultThreshold: 0.25, defaultPercent: 0.5, stable: false, brandColor: '#26D9A5' },
  { ticker: 'USDT', name: 'Tether',    coingeckoId: 'tether',            binanceSymbol: null,       krakenPair: 'USDTUSD', coinpaprikaId: 'usdt-tether',          defaultThreshold: 0.005, defaultPercent: 0.5, stable: true,  brandColor: '#26A17B' },
  { ticker: 'USDC', name: 'USD Coin',  coingeckoId: 'usd-coin',          binanceSymbol: null,       krakenPair: 'USDCUSD', coinpaprikaId: 'usdc-usd-coin',        defaultThreshold: 0.005, defaultPercent: 0.5, stable: true,  brandColor: '#2775CA' },
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
// "Auto" and "Kraken first" are the two modes with the full resilience chain
// behind them (see priceService.js's providerOrder): CoinGecko/Kraken lead,
// with Binance, CoinPaprika, CoinMarketCap (only if a key is configured) and
// DexScreener as further backups. "CoinGecko only" and "Binance first" are
// deliberately left as their original single-backup pairing, so an owner who
// picked them for a specific reason (e.g. wanting exactly one fallback) sees
// exactly the behavior the name promises.
export const SOURCE_MODES = [
  { key: 'auto',      emoji: '🤖', name: 'Auto',           desc: 'CoinGecko first, then Binance, Kraken, CoinPaprika and further backups' },
  { key: 'coingecko', emoji: '🦎', name: 'CoinGecko only', desc: 'never uses any other source' },
  { key: 'binance',   emoji: '🟨', name: 'Binance first',  desc: 'CoinGecko as backup (and for stablecoins)' },
  { key: 'kraken',    emoji: '🐙', name: 'Kraken first',   desc: 'Binance, then CoinGecko and further backups' },
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
  // Optional CoinGecko demo/pro key. Not required — CoinGecko's public
  // endpoint works keyless — but setting one raises the rate limit for both
  // prices and logo downloads. COINGECKO_API_PLAN picks which endpoint/header
  // the key is valid for; almost everyone wants the default 'demo' (the free
  // key you get from coingecko.com/en/api). Set it to 'pro' only if you hold
  // a paid CoinGecko Pro key.
  coingeckoApiKey: process.env.COINGECKO_API_KEY || '',
  coingeckoApiPlan: (process.env.COINGECKO_API_PLAN || 'demo').toLowerCase() === 'pro' ? 'pro' : 'demo',
  // Optional CoinMarketCap key. CMC has no keyless tier, so it's used only as
  // an extra (tertiary) backup, and only when this is set — see priceService.js.
  coinmarketcapApiKey: process.env.COINMARKETCAP_API_KEY || '',
};

/** Header CoinGecko expects the key under — differs between its demo and pro tiers. */
export function coingeckoHeaders() {
  if (!CONFIG.coingeckoApiKey) return {};
  return CONFIG.coingeckoApiPlan === 'pro'
    ? { 'x-cg-pro-api-key': CONFIG.coingeckoApiKey }
    : { 'x-cg-demo-api-key': CONFIG.coingeckoApiKey };
}

/** CoinGecko's demo key works against the free public host; a pro key needs the pro host. */
export function coingeckoBaseUrl() {
  return CONFIG.coingeckoApiPlan === 'pro' ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
}
