// Same rule as the Telegram bot's priceFormat.js:
//   >= 10,000 no decimals | >= 1 two | >= 0.01 three | smaller: 4 significant digits
//   stablecoins always 3 decimals so a depeg is visible.

function decimals(price: number, stable: boolean): number {
  if (stable) return 3;
  if (price >= 10_000) return 0;
  if (price >= 1) return 2;
  if (price >= 0.01) return 3;
  return Math.min(12, Math.ceil(-Math.log10(price)) + 3);
}

export function formatPrice(price: number, stable = false): string {
  const d = decimals(price, stable);
  return price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function formatChange(change: number | null): string {
  if (change === null) return '–';
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  return `${sign}${Math.abs(change).toFixed(2)}%`;
}
