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
// cmcId          -> CoinMarketCap's numeric coin ID, used only if COINMARKETCAP_API_KEY is
//                   set (see priceService.js — CMC's key-free tier is not reliable enough
//                   to depend on, so the bot never uses it without a key).
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
  { ticker: 'BTC',  name: 'Bitcoin',   coingeckoId: 'bitcoin',           binanceSymbol: 'BTCUSDT',  krakenSymbol: 'XBTUSD',  coinpaprikaId: 'btc-bitcoin',      cmcId: 1,     defaultThreshold: 500, defaultPercent: 0.5, stable: false, brandColor: '#F7931A' },
  { ticker: 'ETH',  name: 'Ethereum',  coingeckoId: 'ethereum',          binanceSymbol: 'ETHUSDT',  krakenSymbol: 'ETHUSD',  coinpaprikaId: 'eth-ethereum',     cmcId: 1027,  defaultThreshold: 25, defaultPercent: 0.75, stable: false, brandColor: '#627EEA' },
  { ticker: 'XRP',  name: 'XRP',       coingeckoId: 'ripple',            binanceSymbol: 'XRPUSDT',  krakenSymbol: 'XRPUSD',  coinpaprikaId: 'xrp-xrp',          cmcId: 52,    defaultThreshold: 0.02, defaultPercent: 1, stable: false, brandColor: '#23292F' },
  { ticker: 'BNB',  name: 'BNB',       coingeckoId: 'binancecoin',       binanceSymbol: 'BNBUSDT',  krakenSymbol: null,      coinpaprikaId: 'bnb-binance-coin', cmcId: 1839,  defaultThreshold: 5, defaultPercent: 0.75, stable: false, brandColor: '#F0B90B' },
  { ticker: 'SOL',  name: 'Solana',    coingeckoId: 'solana',            binanceSymbol: 'SOLUSDT',  krakenSymbol: 'SOLUSD',  coinpaprikaId: 'sol-solana',       cmcId: 5426,  defaultThreshold: 1, defaultPercent: 1, stable: false, brandColor: '#9945FF' },
  { ticker: 'TRX',  name: 'TRON',      coingeckoId: 'tron',              binanceSymbol: 'TRXUSDT',  krakenSymbol: 'TRXUSD',  coinpaprikaId: 'trx-tron',         cmcId: 1958,  defaultThreshold: 0.01, defaultPercent: 1, stable: false, brandColor: '#EF0027' },
  { ticker: 'DOGE', name: 'Dogecoin',  coingeckoId: 'dogecoin',          binanceSymbol: 'DOGEUSDT', krakenSymbol: 'XDGUSD',  coinpaprikaId: 'doge-dogecoin',    cmcId: 74,    defaultThreshold: 0.001, defaultPercent: 1, stable: false, brandColor: '#C2A633' },
  { ticker: 'ADA',  name: 'Cardano',   coingeckoId: 'cardano',           binanceSymbol: 'ADAUSDT',  krakenSymbol: 'ADAUSD',  coinpaprikaId: 'ada-cardano',      cmcId: 2010,  defaultThreshold: 0.005, defaultPercent: 1, stable: false, brandColor: '#0033AD' },
  { ticker: 'LINK', name: 'Chainlink', coingeckoId: 'chainlink',         binanceSymbol: 'LINKUSDT', krakenSymbol: 'LINKUSD', coinpaprikaId: 'link-chainlink',   cmcId: 1975,  defaultThreshold: 0.25, defaultPercent: 1, stable: false, brandColor: '#2A5ADA' },
  { ticker: 'TON',  name: 'Toncoin',   coingeckoId: 'the-open-network',  binanceSymbol: 'TONUSDT',  krakenSymbol: 'TONUSD',  coinpaprikaId: 'ton-toncoin',      cmcId: 11419, defaultThreshold: 0.05, defaultPercent: 1, stable: false, brandColor: '#0098EA' },
  { ticker: 'AVAX', name: 'Avalanche', coingeckoId: 'avalanche-2',       binanceSymbol: 'AVAXUSDT', krakenSymbol: 'AVAXUSD', coinpaprikaId: 'avax-avalanche',   cmcId: 5805,  defaultThreshold: 0.25, defaultPercent: 2, stable: false, brandColor: '#E84142' },
  { ticker: 'SUI',  name: 'Sui',       coingeckoId: 'sui',               binanceSymbol: 'SUIUSDT',  krakenSymbol: 'SUIUSD',  coinpaprikaId: 'sui-sui',          cmcId: 20947, defaultThreshold: 0.005, defaultPercent: 0.5, stable: false, brandColor: '#4DA2FF' },
  { ticker: 'XLM',  name: 'Stellar',   coingeckoId: 'stellar',           binanceSymbol: 'XLMUSDT',  krakenSymbol: 'XLMUSD',  coinpaprikaId: 'xlm-stellar',      cmcId: 512,   defaultThreshold: 0.0025, defaultPercent: 1.25, stable: false, brandColor: '#14B6E7' },
  { ticker: 'HBAR', name: 'Hedera',    coingeckoId: 'hedera-hashgraph',  binanceSymbol: 'HBARUSDT', krakenSymbol: 'HBARUSD', coinpaprikaId: 'hbar-hedera-hashgraph', cmcId: 4642, defaultThreshold: 0.001, defaultPercent: 1, stable: false, brandColor: '#8259EF' },
  { ticker: 'DOT',  name: 'Polkadot',  coingeckoId: 'polkadot',          binanceSymbol: 'DOTUSDT',  krakenSymbol: 'DOTUSD',  coinpaprikaId: 'dot-polkadot',     cmcId: 6636,  defaultThreshold: 0.025, defaultPercent: 1, stable: false, brandColor: '#E6007A' },
  { ticker: 'UNI',  name: 'Uniswap',   coingeckoId: 'uniswap',           binanceSymbol: 'UNIUSDT',  krakenSymbol: 'UNIUSD',  coinpaprikaId: 'uni-uniswap',      cmcId: 7083,  defaultThreshold: 0.025, defaultPercent: 1, stable: false, brandColor: '#FF007A' },
  { ticker: 'LTC',  name: 'Litecoin',  coingeckoId: 'litecoin',          binanceSymbol: 'LTCUSDT',  krakenSymbol: 'LTCUSD',  coinpaprikaId: 'ltc-litecoin',     cmcId: 2,     defaultThreshold: 0.25, defaultPercent: 0.5, stable: false, brandColor: '#345D9D' },
  { ticker: 'ZEC',  name: 'Zcash',     coingeckoId: 'zcash',             binanceSymbol: 'ZECUSDT',  krakenSymbol: 'ZECUSD',  coinpaprikaId: 'zec-zcash',        cmcId: 1437,  defaultThreshold: 5, defaultPercent: 0.5, stable: false, brandColor: '#F4B728' },
  { ticker: 'HYPE', name: 'Hyperliquid', coingeckoId: 'hyperliquid',     binanceSymbol: 'HYPEUSDT', krakenSymbol: null,      coinpaprikaId: 'hype-hyperliquid', cmcId: 32196, defaultThreshold: 0.25, defaultPercent: 0.5, stable: false, brandColor: '#26D9A5' },
  { ticker: 'USDT', name: 'Tether',    coingeckoId: 'tether',            binanceSymbol: null,       krakenSymbol: 'USDTUSD', coinpaprikaId: 'usdt-tether',      cmcId: 825,   defaultThreshold: 0.005, defaultPercent: 0.5, stable: true,  brandColor: '#26A17B' },
  { ticker: 'USDC', name: 'USD Coin',  coingeckoId: 'usd-coin',          binanceSymbol: null,       krakenSymbol: 'USDCUSD', coinpaprikaId: 'usdc-usd-coin',    cmcId: 3408,  defaultThreshold: 0.005, defaultPercent: 0.5, stable: true,  brandColor: '#2775CA' },
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
//   - 'aggregator'  : one call covers every coin (CoinGecko, CoinPaprika, CoinMarketCap)
//   - 'exchange'     : real order-book prices, but only for coins that exchange lists
//                      (Binance, Kraken)
//   - 'dex'          : an on-chain liquidity-pool price rather than one clean reference
//                      price — architecturally different from the others (DexScreener)
//
// "inAuto" sources are the ones 🤖 Auto will try, in order. CoinMarketCap and
// DexScreener are deliberately left OUT of Auto:
//   - CoinMarketCap's key-free tier is not reliable enough to depend on, and even
//     its cheapest keyed tier (10-15k calls/month) can't sustain this bot's default
//     30-second polling as a live source — it's only useful as an occasional
//     backup or for 🔍 Test sources, never as the thing Auto silently switches to.
//   - CoinPaprika's free tier (~20-25k calls/month) has the same ceiling, so it's
//     listed here but should really only be reached when the primary is down, not
//     polled every 30s as a steady diet — Auto only calls a backup when the
//     primary fails, so this is fine in practice.
//   - DexScreener needs a specific liquidity-pool address per coin (see
//     priceService.js) and isn't configured for any coin by default, since a
//     wrong address would silently return a different token's price.
export const SOURCE_MODES = [
  { key: 'auto',        emoji: '🤖', name: 'Auto',            role: 'aggregator', desc: 'CoinGecko, then Binance, Kraken, CoinPaprika if needed' },
  { key: 'coingecko',   emoji: '🦎', name: 'CoinGecko only',  role: 'aggregator', desc: 'never uses another source' },
  { key: 'binance',     emoji: '🟨', name: 'Binance first',   role: 'exchange',   desc: 'CoinGecko as backup (and for stablecoins)' },
  { key: 'kraken',      emoji: '🐙', name: 'Kraken first',    role: 'exchange',   desc: 'CoinGecko as backup' },
  { key: 'coinpaprika', emoji: '🌶️', name: 'CoinPaprika first', role: 'aggregator', desc: 'CoinGecko as backup — mind the ~25k calls/month free limit' },
  { key: 'coinmarketcap', emoji: '🏅', name: 'CoinMarketCap first', role: 'aggregator', desc: 'needs COINMARKETCAP_API_KEY; CoinGecko as backup' },
  { key: 'dexscreener', emoji: '🦎‍⬛', name: 'DexScreener',   role: 'dex',        desc: 'on-chain pool price — only for coins you configure; CoinGecko fills the rest' },
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
  // Required for the CoinMarketCap source to be usable at all — see the long
  // comment above SOURCE_MODES for why there's no key-free fallback for it.
  coinMarketCapApiKey: process.env.COINMARKETCAP_API_KEY || '',
};

export function coingeckoHeaders() {
  return CONFIG.coingeckoApiKey ? { 'x-cg-demo-api-key': CONFIG.coingeckoApiKey } : {};
}

// DexScreener prices a specific liquidity pool, not "the" price of a coin, so
// unlike the other sources there's no safe generic way to derive which pool to
// read for a given ticker — the wrong pool (or a copy-cat token with the same
// symbol) would silently return a completely different asset's price. Nothing
// is filled in here by default; add an entry only once you've verified the
// pool address yourself (e.g. on dexscreener.com), for example:
//   SOL: { chainId: 'solana', pairAddress: '<verified pair address>' },
// A coin with no entry here is simply skipped by the DexScreener source (and
// filled in from CoinGecko instead, like any other gap).
export const DEXSCREENER_PAIRS = {
  // (empty by default — see comment above)
};
