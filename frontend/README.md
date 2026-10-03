# PricePing dashboard (Netlify)

A static page that shows live prices, 24h change and logos from the PricePing
backend, and refreshes by itself (no page reload).

## Deploy

1. Create a Netlify site from this folder (drag-and-drop the folder, or connect a
   repo whose root is this folder). `netlify.toml` already sets the build
   command (`node build.js`) and publish folder (`dist`).
2. In **Site configuration > Environment variables**, add:
   - `API_URL` — your Railway backend address, e.g.
     `https://priceping-production.up.railway.app` (no trailing slash)
3. Deploy. If you change `API_URL` later, trigger a new deploy.
4. In Railway, set the backend's `ALLOWED_ORIGIN` to this site's address so only
   it can call the API.

If `API_URL` is missing, the site shows a short setup message instead of prices.

## Files

- `src/` — the page (`index.html`, `style.css`, `app.js`)
- `build.js` — copies `src/` to `dist/` and writes `config.js` from `API_URL`
