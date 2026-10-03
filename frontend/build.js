// Netlify build step: copies src/ to dist/ and writes dist/config.js from the
// API_URL environment variable, so no code ever has to be edited.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

const apiUrl = (process.env.API_URL || '').trim().replace(/\/+$/, '');
if (!apiUrl) {
  console.warn('[build] API_URL is not set. The site will build, but it will show a setup message instead of prices.');
} else if (!/^https?:\/\//.test(apiUrl)) {
  console.error(`[build] API_URL must start with https:// (got "${apiUrl}").`);
  process.exit(1);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(src, dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'config.js'), `window.PRICEPING_API = ${JSON.stringify(apiUrl)};\n`);
console.log(`[build] Done. Using API: ${apiUrl || '(not set)'}`);
