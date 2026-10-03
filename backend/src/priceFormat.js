// One price-formatting rule for banners and captions (dynamic precision):
//
//   >= $10,000   no decimals        BTC   $86,019
//   >= $1        2 decimals         ETH   $4,021.45
//   >= $0.01     3 decimals         DOGE  $0.096
//   <  $0.01     4 significant      SHIB  $0.00001234
//                digits (zeros after the decimals are trimmed, min 4 decimals)
//   stablecoins  3 decimals         USDT  $0.994   (so a depeg is actually visible)

/** Number of decimals to show for `price`. */
export function priceDecimals(price, { stable = false } = {}) {
  if (stable) return 3;
  if (price >= 10_000) return 0;
  if (price >= 1) return 2;
  if (price >= 0.01) return 3;
  return Math.min(12, Math.ceil(-Math.log10(price)) + 3);
}

export function formatPrice(price, { stable = false } = {}) {
  const decimals = priceDecimals(price, { stable });
  let text = price.toFixed(decimals);

  // Very small prices: drop trailing zeros, but keep at least 4 decimals.
  if (!stable && price < 0.01 && text.includes('.')) {
    const [whole, frac] = text.split('.');
    text = `${whole}.${frac.replace(/0+$/, '').padEnd(4, '0')}`;
  }

  const [whole, frac] = text.split('.');
  const grouped = Number(whole).toLocaleString('en-US');
  return `$${frac === undefined ? grouped : `${grouped}.${frac}`}`;
}
