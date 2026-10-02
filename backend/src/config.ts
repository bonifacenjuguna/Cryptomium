// Load a local .env if present (Node 20.12+). Hosts like Railway inject real
// environment variables, so a missing file is fine.
try {
  process.loadEnvFile();
} catch {
  /* no .env file */
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  pollIntervalMs: Math.max(1000, Number(process.env.POLL_INTERVAL_MS ?? 2000)),
  coingeckoIntervalMs: Math.max(10_000, Number(process.env.COINGECKO_INTERVAL_MS ?? 30_000)),
  coingeckoApiKey: process.env.COINGECKO_API_KEY ?? '',
  corsOrigins: (process.env.CORS_ORIGIN ?? '*')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
};
