import { CONFIG, coinByTicker } from './config.js';
import { formatPrice } from './priceFormat.js';

// The direction marker used in captions. Kept in one place so it is easy to change.
export const CAPTION_MARKERS = { up: '▲', down: '▼' };

/**
 * Caption under a banner, e.g. "▲ BTC $81,385 @cryptomiumx".
 * `changePct` (optional, used by "Post prices") adds the 24h change, and a
 * missing `direction` omits the marker.
 */
export function buildCaption({ ticker, price, direction = null, changePct = null }) {
  const coin = coinByTicker(ticker);
  const parts = [];
  if (direction) parts.push(CAPTION_MARKERS[direction]);
  parts.push(ticker, formatPrice(price, { stable: Boolean(coin?.stable) }));
  if (typeof changePct === 'number' && Number.isFinite(changePct)) {
    parts.push(`· 24h ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`);
  }
  parts.push(CONFIG.watermark);
  return parts.join(' ');
}
