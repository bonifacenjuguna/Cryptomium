// The same 21 coins the Telegram bot tracks (copied from its src/config.js).
//
// binanceSymbol -> null means Binance is never used for that coin (it has no
//                  USDT/USD pair, and USDC/USDT is not a dollar price).
// krakenSymbol  -> null means Kraken doesn't list it.
// stable        -> shown with 3 decimals so a depeg is visible.

export interface Coin {
  ticker: string;
  name: string;
  brandColor: string;
  stable: boolean;
  coingeckoId: string;
  binanceSymbol: string | null;
  krakenSymbol: string | null;
}

export const COINS: Coin[] = [
  { ticker: 'BTC',  name: 'Bitcoin',     brandColor: '#F7931A', stable: false, coingeckoId: 'bitcoin',          binanceSymbol: 'BTCUSDT',  krakenSymbol: 'XBTUSD' },
  { ticker: 'ETH',  name: 'Ethereum',    brandColor: '#627EEA', stable: false, coingeckoId: 'ethereum',         binanceSymbol: 'ETHUSDT',  krakenSymbol: 'ETHUSD' },
  { ticker: 'XRP',  name: 'XRP',         brandColor: '#23292F', stable: false, coingeckoId: 'ripple',           binanceSymbol: 'XRPUSDT',  krakenSymbol: 'XRPUSD' },
  { ticker: 'BNB',  name: 'BNB',         brandColor: '#F0B90B', stable: false, coingeckoId: 'binancecoin',      binanceSymbol: 'BNBUSDT',  krakenSymbol: null },
  { ticker: 'SOL',  name: 'Solana',      brandColor: '#9945FF', stable: false, coingeckoId: 'solana',           binanceSymbol: 'SOLUSDT',  krakenSymbol: 'SOLUSD' },
  { ticker: 'TRX',  name: 'TRON',        brandColor: '#EF0027', stable: false, coingeckoId: 'tron',             binanceSymbol: 'TRXUSDT',  krakenSymbol: 'TRXUSD' },
  { ticker: 'DOGE', name: 'Dogecoin',    brandColor: '#C2A633', stable: false, coingeckoId: 'dogecoin',         binanceSymbol: 'DOGEUSDT', krakenSymbol: 'XDGUSD' },
  { ticker: 'ADA',  name: 'Cardano',     brandColor: '#0033AD', stable: false, coingeckoId: 'cardano',          binanceSymbol: 'ADAUSDT',  krakenSymbol: 'ADAUSD' },
  { ticker: 'LINK', name: 'Chainlink',   brandColor: '#2A5ADA', stable: false, coingeckoId: 'chainlink',        binanceSymbol: 'LINKUSDT', krakenSymbol: 'LINKUSD' },
  { ticker: 'TON',  name: 'Toncoin',     brandColor: '#0098EA', stable: false, coingeckoId: 'the-open-network', binanceSymbol: 'TONUSDT',  krakenSymbol: 'TONUSD' },
  { ticker: 'AVAX', name: 'Avalanche',   brandColor: '#E84142', stable: false, coingeckoId: 'avalanche-2',      binanceSymbol: 'AVAXUSDT', krakenSymbol: 'AVAXUSD' },
  { ticker: 'SUI',  name: 'Sui',         brandColor: '#4DA2FF', stable: false, coingeckoId: 'sui',              binanceSymbol: 'SUIUSDT',  krakenSymbol: 'SUIUSD' },
  { ticker: 'XLM',  name: 'Stellar',     brandColor: '#14B6E7', stable: false, coingeckoId: 'stellar',          binanceSymbol: 'XLMUSDT',  krakenSymbol: 'XLMUSD' },
  { ticker: 'HBAR', name: 'Hedera',      brandColor: '#8259EF', stable: false, coingeckoId: 'hedera-hashgraph', binanceSymbol: 'HBARUSDT', krakenSymbol: 'HBARUSD' },
  { ticker: 'DOT',  name: 'Polkadot',    brandColor: '#E6007A', stable: false, coingeckoId: 'polkadot',         binanceSymbol: 'DOTUSDT',  krakenSymbol: 'DOTUSD' },
  { ticker: 'UNI',  name: 'Uniswap',     brandColor: '#FF007A', stable: false, coingeckoId: 'uniswap',          binanceSymbol: 'UNIUSDT',  krakenSymbol: 'UNIUSD' },
  { ticker: 'LTC',  name: 'Litecoin',    brandColor: '#345D9D', stable: false, coingeckoId: 'litecoin',         binanceSymbol: 'LTCUSDT',  krakenSymbol: 'LTCUSD' },
  { ticker: 'ZEC',  name: 'Zcash',       brandColor: '#F4B728', stable: false, coingeckoId: 'zcash',            binanceSymbol: 'ZECUSDT',  krakenSymbol: 'ZECUSD' },
  { ticker: 'HYPE', name: 'Hyperliquid', brandColor: '#26D9A5', stable: false, coingeckoId: 'hyperliquid',      binanceSymbol: 'HYPEUSDT', krakenSymbol: null },
  { ticker: 'USDT', name: 'Tether',      brandColor: '#26A17B', stable: true,  coingeckoId: 'tether',           binanceSymbol: null,       krakenSymbol: 'USDTUSD' },
  { ticker: 'USDC', name: 'USD Coin',    brandColor: '#2775CA', stable: true,  coingeckoId: 'usd-coin',         binanceSymbol: null,       krakenSymbol: 'USDCUSD' },
];

/** What the browser needs to know about each coin (no provider details). */
export const COIN_META = COINS.map(({ ticker, name, brandColor, stable }) => ({
  ticker,
  name,
  brandColor,
  stable,
}));
