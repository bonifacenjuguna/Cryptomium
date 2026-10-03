# PricePing dashboard (Vercel)

A static page that shows live prices, 24h change and logos from the PricePing
backend, and refreshes by itself (no page reload).

## Deploy on Vercel

1. Put this `frontend/` folder in a Git repo (or in the same repo as the
   backend). In Vercel, choose **Add New > Project** and import it.
   - If the repo also holds the backend, set **Root Directory** to `frontend`.
   - **Framework Preset:** Other. `vercel.json` already sets the build command
     (`node build.js`) and output folder (`dist`).
2. Deploy. The backend address is read from `site.config.json`
   (already set to your Railway backend).
3. In Railway, set the backend's `ALLOWED_ORIGIN` to your Vercel address
   (for example `https://priceping.vercel.app`) so only this site can call
   the API.

Prefer the CLI? Run `npx vercel` in this folder, then `npx vercel --prod`.

## Changing the backend address

Either edit `apiUrl` in `site.config.json`, or set an `API_URL` environment
variable in Vercel (it wins over the file), then redeploy. No trailing slash.

If no address is found, the site shows a short setup message instead of prices.

## Files

- `src/` — the page (`index.html`, `style.css`, `app.js`)
- `build.js` — copies `src/` to `dist/` and writes `config.js` with the backend address
- `site.config.json` — the backend address
- `vercel.json` — build settings and security headers
