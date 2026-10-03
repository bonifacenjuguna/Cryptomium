// Parsing of the owner's typed answers (kept free of Telegram/DB imports so it is easy to test).

/**
 * Test-banner price answer: "81500", "$81,500", "81500 up", "0.235 down".
 * Returns { price, direction: 'up' | 'down' | null } or null if it isn't a price.
 */
export function parseTestPrice(text) {
  const match = text.trim().toLowerCase().match(/^\$?\s*([\d,]*\.?\d+)\s*(up|down|rise|fall|▲|▼)?$/);
  if (!match) return null;
  const price = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(price) || price <= 0) return null;
  const dir = match[2];
  const direction = !dir ? null : ['up', 'rise', '▲'].includes(dir) ? 'up' : 'down';
  return { price, direction };
}
