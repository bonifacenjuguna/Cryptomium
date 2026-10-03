// Build step (Vercel): copies src/ to dist/ and writes dist/config.js with the
// backend address, so no code ever has to be edited.
//
// The address comes from the API_URL environment variable if it is set
// (Vercel > Project > Settings > Environment Variables), otherwise from
// site.config.json. Either way it is public: browsers download it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

function fromFile() {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(root, 'site.config.json'), 'utf8')).apiUrl || '');
  } catch {
    return '';
  }
}

const apiUrl = (process.env.API_URL || fromFile()).trim().replace(/\/+$/, '');
if (!apiUrl) {
  console.warn('[build] No API address found (API_URL or site.config.json). The site will build, but it will show a setup message instead of prices.');
} else if (!/^https?:\/\//.test(apiUrl)) {
  console.error(`[build] The API address must start with https:// (got "${apiUrl}").`);
  process.exit(1);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(src, dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'config.js'), `window.PRICEPING_API = ${JSON.stringify(apiUrl)};\n`);
console.log(`[build] Done. Using API: ${apiUrl || '(not set)'}`);
