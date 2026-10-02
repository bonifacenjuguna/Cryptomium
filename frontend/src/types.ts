export interface Coin {
  ticker: string;
  name: string;
  brandColor: string;
  stable: boolean;
}

export interface Quote {
  ticker: string;
  price: number;
  change24h: number | null;
  source: 'binance' | 'kraken' | 'coingecko';
}

export type Status = 'connecting' | 'live' | 'reconnecting';
