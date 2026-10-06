# Cryptomium website (Vercel)

The public site for Cryptomium: a live tile board and markets table, a page for
each of the 31 coins (chart, market stats, that coin's alerts), the latest
Telegram alerts, About and FAQ. It needs no framework and no install step.

## Deploy on Vercel (same as before)

Nothing about the setup changes: push this `frontend/` folder, keep **Framework
Preset: Other** (and **Root Directory: `frontend`** if the repo also holds the
backend), and redeploy. `vercel.json` already sets the build command
(`node build.js`), the output folder (`dist`), clean URLs and the `/coin/<TICKER>`
address rewrite.

After deploying, set `ALLOWED_ORIGIN` on the Railway backend to your site address
(for example `https://cryptomium.com`). If you use both a custom domain and the
`*.vercel.app` address, list both separated by a comma.

## Environment variables

| Variable | Needed | Meaning |
|---|---|---|
| `API_URL` | yes | Your backend address (https://...). The only place it is set. The build stops without it. |
| `SITE_URL` | no | Public address of the site, for the sitemap and link previews. |

## Settings

`site.config.json` (everything is public on the website):

| Key | Meaning |
|---|---|
| (none) | The backend address is NOT stored here. It comes only from the `API_URL` environment variable, and the build stops if it is missing. |
| `brand` | Site name |
| `channelHandle`, `channelUrl` | Telegram channel shown on every Join button |
| `botHandle` | Mentioned on the About page as the account that posts alerts (it is not linked, because the bot only answers its owner) |
| `siteUrl` | Public address of the site, used for link previews and the sitemap. Optional: Vercel's own address is used when empty. Set `SITE_URL` in Vercel after you add a custom domain. |

## What is where

- `src/` pages (`index.html`, `coin.html`, `about.html`, `404.html`), `style.css`, `js/`
- `src/partials/` shared header, footer and bottom bar, inserted at build time
- `src/sw.js` service worker (offline app shell, versioned caches, updates only when the app asks); `src/js/net.js` connection health, last-known-good data and the offline banner; `src/js/pwa.js` install card, update manager and bottom bar
- `coins.json` the 31 coins (used for search and for building one static page per coin)
- `build.js` builds `dist/`: fills in the brand, writes `dist/coin/BTC.html` and the other
  coin pages, the sitemap, `config.js` and a Content-Security-Policy that allows only
  this site, Google Fonts and your backend
- `vercel.json` build settings, rewrites and security headers

Visitors' choices (theme, currency, starred coins) are saved in their own browser only.

## Adding or removing a coin

Add it to the backend `src/config.js`, then add its ticker and name to `coins.json`
here (and to `POPULAR` in `src/js/home.js` to choose where it sits in the list) and redeploy.

## Needs from the backend (v2.2.0 or newer)

`/api/prices`, `/api/market`, `/api/history/<TICKER>`, `/api/alerts`, `/api/rates` and
`/api/logos/<TICKER>.png`. If one is missing the page still works and quietly leaves
that part out.
