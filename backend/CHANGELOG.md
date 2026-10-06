# Changelog

## 3.8.2

**The menu now behaves like a native drawer. Redeploy the frontend (the backend is unchanged apart from its version number).**

- Choosing an item in the menu (Watchlist, Compare, Converter, Price alerts, Settings, Learn, Help, Data sources, Data and privacy...) opens that screen over the menu, which stays open underneath. Back, from the arrow or the phone's Back button, returns to the open menu; Back again closes it. Inside those screens Back still goes one level at a time (for example Appearance, Settings, menu).
- The bottom bar stays hidden while you are back on the open menu, as before.
- Picking a main tab (Overview, Screener, News, Portfolio) from the menu still closes it, since you are switching tabs.

## 3.8.1

**Header consistency fixes for the installed app. Redeploy the frontend (the backend is unchanged apart from its version number).**

- **The brand no longer disappears when you scroll** on Home (it left an empty bar). Main screens keep Cryptomium, search and the menu; where a page has a big title, that title replaces the brand only once it has scrolled out of view.
- **Screens opened from a tab now have a back arrow only.** The menu button, search button, price strip and the "Settings" / "All markets" text links are gone there, so nothing sits next to the arrow and nothing leads out of the stack by accident. The page title appears in the bar once its big title scrolls away.
- A screen opened from outside (a link or notification) now has its main tab underneath it, and the back arrow returns there instead of leaving the app.

## 3.8.0

**The installed app now navigates like a native app, plus a new Watchlist and Data sources page. Redeploy the frontend (the backend is unchanged apart from its version number).**

- **Screens stack on top of each tab.** Opening a coin, a settings page or anything else from a tab slides it in over that tab, and the tab underneath stays exactly as it was. Back (the arrow in the top bar or the phone's Back button) slides it away and you are exactly where you came from: the same scroll position on Home, Screener and every other tab. Each tab keeps its own stack, tapping the lit tab returns to its main screen, then the top.
- **The menu and search disappear at once** when you pick something: nothing is left hanging on screen while the next screen arrives, and nothing is open when you come back.
- **Top bar:** on main screens the brand fades away as you scroll; on screens below them the brand is replaced by the back arrow and the screen's title.
- Browser tabs: going Back to a page now returns to the exact spot, even though its content fills in after it loads.
- **Watchlist redesigned:** the coins you follow are rich cards with the live price and move (tinted green or red), then a clear gap, then every other coin as a plain one-line row with just a star to add it. An empty watchlist explains what to do.
- **Data sources redesigned:** a live status card with a pulsing dot, the price source, last update and response time, then a flow of every source (live prices, history, market size, exchange rates, fear and greed) with what it gives and how often it refreshes.

## 3.7.0

**Coin header redone as a hero, and the Screener now looks like a scanner instead of a second Home. Redeploy the frontend (the backend is unchanged apart from its version number). The website on a computer keeps its table.**

- **Coin header hero:** a soft glow behind the header that turns green or red with the coin's 24h direction, a glowing ring around the logo, the name with small TICKER and Rank chips, round glass star and share buttons, a very large price whose cents fade back, and one capsule that shows the arrow, the 24h percent, the dollar move and "24H" together. The coin still slides into the top bar when the price scrolls away.
- **Screener on a phone:** a market pulse strip (how many coins are rising and falling, the average move, and a split bar), round view chips (Largest, Gainers, Losers, Volume, Near ATH...), a one-line caption that says what the view shows, and a card for every coin that puts the one number the view is about (market cap, 24h move, volume, distance from ATH...) in large type with a bar under it to compare coins at a glance. Home keeps its price lists; the Screener shows what Home cannot.

## 3.6.0

**Installed app: all five tabs now live at once, and a redesigned coin header. Redeploy the frontend (the backend is unchanged apart from its version number). The website in a browser tab is untouched.**

- **Tabs switch with no loading.** On a phone the installed app opens as one thin shell that keeps Home, Overview, Screener, News and Portfolio alive side by side. Tapping a tab just shows it, with its scroll position, open sheets and typed text kept. The opened tab loads first, the others in the background one by one. Prices keep updating in every tab. Works on every phone, not only Android Chrome.
- A coin opened from a tab opens inside that tab; Back returns to where you were, and Back also undoes a tab switch. Tapping the lit tab again goes back to its main screen, then to the top.
- The menu drawer and pop-up sheets cover the whole screen as before: the bar slides away while one is open (and while typing) and returns after.
- Old links, shortcuts and the home screen icon still work: a tab page opened on its own is handed to the shell. The frame header is now `SAMEORIGIN` so the shell can hold the pages.
- **Coin header redesigned:** a smaller flat logo (no white ring), the coin name as the only title with "TICKER · Rank #n" as a quiet line under it (not repeated when the name is the ticker), soft round star and share buttons, the price large below and aligned with the logo, and the 24h change as a light tinted line with an arrow instead of a solid pill. When the price scrolls away, the coin's logo, ticker and live price slide into the top bar.

## 3.5.3

**Installed app: instant tabs, white Settings icons, a cleaner App updates page, and no pull-to-refresh. Redeploy the frontend (the backend is unchanged apart from its version number). The website is untouched.**

- **Bottom tabs are prepared in the background.** Home, Overview, Screener, News and Portfolio load quietly after the app opens, so a tap shows a ready screen with its place kept, with no loading. (Android Chrome; other browsers keep the fast cached loading.) The content-security policy now allows the browser's page-preparation rules.
- **Settings icons are white by default** (the theme's text colour) and take the colour of any other accent you pick under Appearance. The menu drawer icons are back to their original look.
- **Pull-to-refresh is gone.** The app already keeps itself up to date.
- **App updates page redesigned:** one status card (icon, version, a state badge, a short message, one button), a compact install-mode row, a tidy offline-data list, and a quiet Troubleshooting row. All messages are shorter.
- Tab and settings code no longer writes the "last tab" memory from a page that is only being prepared in the background.

## 3.5.2

**Installed app polish. Redeploy the frontend (the backend is unchanged apart from its version number). The website is untouched.**

- **Settings icons are calmer:** a neutral tile with the glyph in the theme's accent colour, instead of a solid yellow block. The menu drawer uses the same glyph colour.
- **Social icons:** one slim row of four small neutral icons at the bottom of About, with the brand colour showing only while pressed. "Telegram channel" no longer wraps.
- **One Touch feedback setting** (Settings > Experimental, off by default) now covers both the chart and the app's tabs, switches and controls.
- **Smoother bottom tabs:** no page fade between tabs, header and bar stay fixed, the tab indicator moves on the tap itself, the next tab is warmed as soon as a finger touches it, and the Home tiles no longer animate in.
- **Dead space at the bottom of pages removed:** the end-of-page block and extra padding are gone, leaving just the bar plus a small gap (including Portfolio).

## 3.5.1

**Fix: the installed app's menu opened as a short bar showing only the logo and version. Redeploy the frontend (the backend is unchanged).** The new translucent header trapped the side menu inside its own height. The header is solid again, and the menu opens full height as before.

## 3.5.0

**The installed app now looks and feels native on every screen. Redeploy the frontend (the backend is unchanged apart from its version number). The website in a browser tab is untouched: every new rule applies only to the installed app.**

- **Flat, solid surfaces everywhere.** No borders, shadows, glows or gradients on cards, tiles, panels, charts, tables or sheets. Depth comes from tone alone (white cards on a soft grey page, raised charcoal cards on the dark page).
- **System fonts and numerals** in the app, so text and prices match the phone. The brand name keeps its own letters.
- **Settings as grouped lists:** a coloured icon tile, title, value and a chevron per row, hairline dividers, small caps group titles. Detail pages use grouped sections with labels left and controls right.
- **Real social icons** (X, Instagram, YouTube, TikTok) in Settings replace the "Follow" text links.
- **Large titles that collapse into the top bar** as you scroll, and a header hairline that appears only once content scrolls under it.
- **Translucent header and bottom bar** (system-style blur). The current tab is shown by a bar above its icon and a heavier icon, no pill.
- **Pull to refresh** from the top of a page (not inside charts, tables, sheets or the menu), light **haptic ticks** on switches, tabs and the bottom bar where the phone allows it, and no hover effects or underlines.
- **Launch splash** (logo on the page colour) once per app launch.
- The status bar colour of the light theme now matches the app's page colour.
- New file: `js/appfeel.js`.

## 3.4.1

**Installed app: the Market overview row is gone from Home, because Overview is already in the bottom bar. Redeploy the frontend (the backend is unchanged). The website keeps the row.**

## 3.4.0

**Portfolio rebuilt as a real ledger, and the installed app's Home loses its web headline. Redeploy the frontend. The backend is unchanged apart from its version number and a new test.**

- **Portfolio is now a ledger of buys and sells.** Record what you bought or sold, at what price, with fees, on which date, with an optional note. Profit uses average cost with fees included. You now see **unrealized** profit (what you hold) and **realized** profit (what sales locked in), cost basis, and each coin's average buy price. Coins added without a price still count in value but never distort profit.
- **Several portfolios** (up to 8), for example Long term and Trading, switched from a row of chips at the top. Rename, set a goal or delete each one from Options.
- **Value chart you can scrub.** Touch or hover to read the value at any point. 7D shows today's holdings across the past week; "Mine" is your own history, saved on this device each time the app is open.
- **Allocation donut** (tap a legend row to focus a coin), **What moved today** (each coin's contribution in money, biggest first), **Holdings** sortable by value, today, profit or name, and an **Activity** list.
- **Tap a holding** for its own sheet: amount, average buy, cost basis, unrealized and realized profit, fees, every transaction, and Buy or Sell buttons. Tap any transaction to edit or delete it. A sale larger than what you held on that date is refused with a clear message.
- **Goal** progress bar per portfolio, **Hide amounts** (eye button) for screenshots and public places, **Export and Import CSV** (columns: date, type, ticker, amount, price_usd, fee_usd, note).
- Still no accounts and no uploads: everything stays in this browser. Holdings saved by 3.3.x become opening buys automatically on the first visit. Settings > Data and privacy backups now include the whole ledger.
- **Installed app, Home:** the headline and tagline are gone. A small status line (Crypto market, Live) sits above one big market-cap card with its trend line, a slim volume row and the Market overview row. The website keeps its headline.
- New files: `js/ledger.js` (pure logic), `backend/test/ledger.test.js` (11 tests). `openPanel` added to `js/ui.js` for bottom sheets.

## 3.3.0

**Native-app pass: the installed app now behaves, works offline and updates like an app. Redeploy the frontend. The backend only changes its default banner watermark.**

Frontend build change to know about: `API_URL` is now the only source of the backend address. `site.config.json` no longer has `apiUrl`, and `node build.js` stops with a clear message if `API_URL` is not set (set it in Vercel > Settings > Environment Variables). The Telegram channel is now `@CryptomiumApp`.

- **Bottom bar, fixed at the cause.** The active tab is now decided in one place before first paint (`theme-init.js`) and the tap handler only reverts to that value. This removes three ways a wrong tab could show: a page restored by Back still showing the tab that had been tapped, a coin page always lighting Home even when opened from Overview or Screener (it now keeps the tab it was opened from, remembered per history entry), and tapping Home while on a coin page only scrolling. The 120 ms colour fade on the bar is gone, so the highlight moves on the tap itself. A guess is undone if the navigation never happens.
- **Menu reorganised** by how often things are used: Your coins (Watchlist, Compare, Converter), Alerts (Price alerts, Telegram channel), App (Update app, Settings), Learn and info (Learn, Help and about, Data sources, Data and privacy). Icons, chevrons, and an "Update ready" badge. Nothing already in the bottom bar is repeated (Portfolio is hidden from Settings inside the app). The old website footer's items now live in the menu and in Settings > About this app (including the social links).
- **Android Back** rebuilt as a queue: opening and closing a menu, sheet or search in quick succession, or pressing Back repeatedly, can no longer close the wrong thing or leave a stray history entry. The phone search box now closes on Back too.
- **Logo tap no longer reloads.** On a phone it scrolls to the top (the link is switched off); in a wide installed window it only goes Home when you are somewhere else.
- **Long-press and selection.** Controls and headings never select. Content worth copying stays selectable: coin stats, lessons, the glossary, FAQ answers, fields and code (`data-selectable`). Preferences > Select text still turns it on everywhere.
- **Hover effects only on devices that can hover** (applied when building the CSS), so nothing sticks after a tap.
- **Offline, properly.** The service worker saves a whole version of the app (every page, script, coin page, fonts, coin logos) all-or-nothing and opens it without a network. The last good copy of prices, market details, charts, sentiment and news is kept and shown, labelled with its age, instead of an empty screen. A non-blocking banner explains what is happening and can be dismissed to a small chip in the top bar. Three cases are told apart: **offline** ("Offline, showing last available data"), **online but the live service is not delivering** ("Live data temporarily unavailable"), and **one source failing** (everything else carries on, no global error). When the connection returns the app refreshes in place, keeps the current screen, and says "Back online". Price alerts never fire on a saved price.
- **App updates.** New Settings > App updates screen (also the menu's Update app): current version and build, Check for updates, Update now, and clear states (checking, downloading, ready, up to date, could not complete with Try again, offline). A new version downloads quietly and only switches on when asked, or in Automatic mode (the default) when the app is opened or put away, never mid-use. Manual mode installs nothing until you tap Update now. A release that fails to download completely is discarded and the current version keeps running. Settings, watchlist, alerts and portfolio are untouched. "Repair app files" clears a stuck copy.
- Installs from 3.2.x upgrade by themselves on the next visit.
- Versioning: one number (`package.json`) feeds the menu, Settings, `config.js`, `version.json`, the service worker and its cache names. The build id is now a hash of every input, so any change gets a new cache.
- New files: `js/net.js`, `settings/updates.html`, `version.json` (generated). Backend: default watermark `@CryptomiumApp`.

## 3.2.2

**Long-press no longer selects text, and Compare scrolls sideways. Redeploy the frontend (the backend is unchanged).**
- **No text selection on touch screens by default.** In 3.2.1 reading text (intro lines, About, FAQ) was still selectable, so a long-press still highlighted words and opened Google's search panel. Now nothing on a touch screen selects on long-press, in the app and in the browser. Text fields, code and anything marked `data-selectable` always allow it.
- **New setting: Preferences > Touch > Select text** (off by default). Turn it on to allow selecting and copying text with a long-press again; the app's long-press menu comes back with it.
- **Compare:** only the first coin was visible on phones because the label column took too much room and nothing hinted at more. The table now scrolls sideways like the Screener (finger, trackpad, or dragging with a mouse), the label column is slimmer and stays in view, and the next coin peeks in from the edge.
- Internal: the mouse drag-scroll helper is shared by Screener and Compare.

## 3.2.1

**The installed app now behaves like an app, not a website. Redeploy the frontend (the backend is unchanged). The normal website in a browser tab is unchanged.**
- **Bottom tab bar glitch, fixed at the cause.** The bar used to be built by script after each page loaded, and the page transition then cross-faded the old bar into the new one, so the old tab seemed to react late and the bar jumped. The bar is now part of every page, the current tab is known before the first frame, the tapped tab lights up instantly, and the bar keeps its own layer during page changes so it never blinks. Tapping the tab you are already on scrolls to the top. The bar tucks away while the keyboard is open.
- **Bottom bar holds only the five main destinations** (Home, Overview, Screener, News, Portfolio). Menu items live in the menu.
- **Menu is a side drawer** in the app (phones): slides in over a dimmed backdrop, the page behind cannot be touched or scrolled, Android Back closes it, swipe left or tap outside closes it, choosing an item closes it and opens the page with no leftover history. It now also carries Tools, Learn and info, Settings, the Telegram channel and the disclaimer, plus the version.
- **Website footer is gone inside the app.** Nothing was lost: Help and about, Data sources, Data and privacy, the Telegram channel, version and the "not financial advice" note are in the menu and in an "About this app" section in Settings.
- **Back arrow** in the top bar on inner pages (coin pages, Compare, About, Settings pages).
- **Android Back** closes sheets (coin and currency pickers) and the full screen chart before leaving the page. Sheets slide away and can be pulled down to dismiss.
- **No web-style touch behaviour:** no text selection or long-press menus on buttons, links, tabs, tiles, headings and the menu; no link drag, no double-tap zoom delay. Fields, code and reading text (About, FAQ, lead paragraphs) stay selectable.
- **Faster page switching:** pages open instantly from the saved copy and refresh quietly in the background. Page changes only fade the content, shorter than before, and respect "reduce motion".
- **Toasts** sit above the tab bar. The floating back-to-top button is off in the app.
- Build: `{{VERSION}}` is filled in from package.json, and the offline cache now refreshes when any page part changes.
- New files: `js/backstack.js`, `partials/app-tabbar.html`.

## 3.2.0

**Cryptomium is now an installable app (PWA). Redeploy the frontend (the backend is unchanged).**
- **Install card** at the bottom of Settings. Android and desktop Chrome/Edge: one tap opens the browser's own install dialog. iPhone/iPad: a "Show me how" panel with the Share > Add to Home Screen steps (Safari only). Other browsers: generic steps. The card disappears once the app is installed (with a short "installed" confirmation) and while you are inside the app, and comes back if the app is removed (the browser offers the install again, which clears the "installed" note).
- **App look**: opens full screen with no browser bars; content reaches the screen edges and keeps clear of the notch, status bar and home bar; the status bar colour follows the light/dark theme; on phones a bottom tab bar (Home, Overview, Screener, News, Portfolio) appears inside the installed app; page changes fade smoothly; long-press the app icon for shortcuts (Overview, Screener, News, Portfolio).
- **Icon**: the cube on a dark background with a soft glow, as a standard icon, a full-bleed maskable icon for Android's shaped icons, and an iOS home-screen icon. Browser tab icon unchanged.
- **Offline**: pages and files open fast from a cache, and a friendly "You are offline" page shows when there is no connection. Prices and news are never cached by the app.
- **Fix**: the phone menu and the search results could sit a little off-centre after 3.1.1. Fixed.
- New files: `manifest.webmanifest` and `sw.js` (both generated at build), `offline.html`, `icons/`, `js/pwa.js`. `vercel.json` has headers for the manifest and the worker.

## 3.1.5

**A more inviting Market overview entry on the home page. Redeploy the frontend (the backend is unchanged).**
- **Home**: the Market overview row now carries a live line (for example "Fear & Greed 62, Greed · 21 of 30 coins up") that updates with the market, a pulsing dot, and an accent-coloured Open button, so it reads as something worth opening rather than a plain link. Before the data arrives it describes what is inside.

## 3.1.4

**The home page opens on the markets, and the "leading gainer" highlight lives in the Market overview. Redeploy the frontend (the backend is unchanged).**
- **Home**: the "Leading gainer / Live" chip under the title is removed. The Market overview page now opens with two standout chips instead: the leading gainer and the biggest drop (stablecoins left out), each linking to the coin.
- **Phones**: the top of the home page is tighter (smaller title, compact snapshot tiles, a one-line Market overview row, less spacing) so the first screen ends with the Markets heading, the tap hint and the All / Starred / Gainers / Losers tabs.

## 3.1.3

**A shorter top of the home page, so the markets start sooner. Redeploy the frontend (the backend is unchanged).**
- **Home snapshot**: Market cap and 24h volume stay. The Bitcoin share and Market mood tiles are gone from the home page (the Market overview already shows BTC dominance, Fear & Greed and breadth), and the separate Market overview card is replaced by one tile in the same row that links there.
- **Footer**: the "Moving now" card is removed, since Top movers on the home page shows the same thing. The Market overview link stays under Tools.
- **Markets list**: 20 coins are shown first instead of 10 (still 10, 20 or 50 in Settings, Home). Anyone who had picked a size keeps it.

## 3.1.2

**Coin pages look the same for every coin, a tidier Markets control, and the market overview is easy to find. Redeploy the frontend (the backend is unchanged).**
- **Coin pages**: the Insights and In the news sections now appear on every coin instead of only some. Stablecoins get their own insights (peg to $1, 24h range, volume activity) rather than none. When no headline names a coin, the section says so and shows the latest market headlines; before market data loads, Insights shows a short placeholder.
- **Market overview**: the page is now called Overview in the top navigation and Market overview in its title, and the home page links to it from a card under the market snapshot and from Top movers. It was previously linked from the footer only.
- **Markets page**: the Gainers & losers / Most active / Highs & lows selector no longer wraps into a lopsided pill on phones. It becomes an even row with short labels (Movers, Active, Highs/lows), and the period buttons sit evenly below it.

## 3.1.1

**A gentler header on narrow desktop windows. Redeploy the frontend (the backend is unchanged).**
- **Header**: desktop keeps its tabs at every width instead of switching to the menu button at 1100px. As the window narrows, search first folds into an icon that opens a search box over the bar, then the tabs tighten slightly. The menu button is only for phones and small tablets (820px and below).

## 3.1.0

**Movers logo fix, a news section on the home page and a draggable Screener. Redeploy the frontend (the backend is unchanged).**
- **Top movers**: coin logos no longer sit on top of the symbols. A rule meant for the Markets page was squeezing the logo column on the home page.
- **Home**: new **In the news** section after Latest moves, with a top story (excerpt, publisher, time, related coins) and three more headlines linking to the originals, plus an "All news" button. It uses the existing `/api/news` and stays hidden if the feeds cannot be reached.
- **Screener**: the table scrolls sideways on phones too (it was cut off), and on desktop it can be dragged with the mouse as well as scrolled with the bar, trackpad or Shift + wheel. The coin column stays in view.
- **Header**: below 1100px wide the navigation switched to the menu button. (Reworked in 3.1.1.)

## 3.0.0

**Cryptomium becomes a market intelligence site: Markets, Screener, News, Compare, portfolio analytics and more alert types. Still no accounts. Redeploy both the backend and the frontend (backend first).**
- **Markets (`/markets`)**: total market cap and 24h change, 24h volume, BTC and ETH dominance, Fear & Greed, stablecoin share and active-asset count in one strip; a breadth bar (how many tracked coins are up, flat, down); a 7-day line of the tracked market; and ranked **Gainers & losers** (1H / 24H / 7D / 30D), **Most active** (24h volume as a share of market cap) and **Highs & lows** (closest to / furthest from the all-time high, biggest recovery from the all-time low). Market totals come from CoinGecko's keyless `/global` endpoint.
- **Screener (`/screener`)**: filter the tracked coins by market cap, price, volume, volume/market cap, 24h and 7d change, distance from the all-time high, gain above the all-time low, circulating supply, rank and stablecoin or not. Amounts accept `500m`, `2.5b`. Quick views (Largest, Gainers, Losers, Volume, Near ATH, Far from ATH, ATL recovery), sortable columns, filters kept in the address so a screen can be bookmarked. Filtering runs in the browser on one shared market reading, so it costs no extra requests.
- **News (`/news`)**: headlines from CoinDesk, Cointelegraph, Decrypt and Bitcoin Magazine through their own public RSS feeds, no API key. Only the headline, a short excerpt, publisher, time and a link to the original are shown. Topics (Bitcoin, Ethereum, Altcoins, DeFi, Regulation, ETFs, Exchanges, Security, Network, Macro) and coins are matched automatically from the headline. If a feed is down the others still show, and the page says which one could not be reached. Coin pages show up to four related headlines.
- **Compare (`/compare?coins=BTC,ETH`)**: up to three coins side by side (price, 24h/7d/30d/1y change, market cap, rank, volume, all-time high and low with dates, distance from each, circulating and maximum supply), the better value marked, plus plain-language Insights. The overlay price chart on coin pages is unchanged.
- **Insights**: Momentum, 7-day trend, Volatility and Volume activity on coin pages and in Compare. Each is a stated rule on numbers we already have ("How these are calculated" is on the page). Nothing is predicted.
- **Portfolio analytics**: optional "price paid" per holding gives cost basis, average buy price, unrealized profit and loss (per holding and total), best and weakest performer, 24H / 7D / 30D / 1Y performance of what you hold, and a 7-day value line. Existing holdings keep working and simply show no profit and loss until a price is added. Coins added later without a price never distort profit and loss. Everything stays in this browser, and the page now says so. Realized profit from sales is not tracked.
- **Alerts**: new types besides price above/below: a 24h move of X% or more, a new all-time high, a new all-time low. Checked on the device while the site is open, like before (browser notifications included). Alerts from 2.x load unchanged.
- **Backend**: `GET /api/global` and `GET /api/news` (cached 3 and 10 minutes, shared by all visitors, last good copy served if a source fails). `GET /api/market` now also returns `atl`, `atlDate`, `athChange`, `atlChange`.
- **Site**: new navigation (Markets, Screener, News, Compare, Portfolio, About), footer links, sitemap and per-page metadata for the new pages. Portfolio stays out of the sitemap (it is personal).
- Not included: a global market-cap history chart (CoinGecko only offers it on paid plans, so the 7-day line covers the tracked coins instead), alerts for volume spikes and 7-day highs/lows (there is no live volume feed to check them against), and a "Trending by searches" ranking (we have no real traffic data, so "Most active" is based on volume).
- Worth checking after deploying: open `/news` once. The four feed addresses could not be test-fetched while this release was written, so confirm each publisher appears in the line under the title; a feed that has moved is a one-line change in `backend/src/news.js` (`FEEDS`).

## 2.8.2

**Chart zoom is much easier, and it now works when comparing two coins. Redeploy the frontend (the backend is unchanged).**
- Pinching with two fingers zooms about 1.5x further for the same finger movement than in 2.8.x (the pinch curve went from 2.1 to 3.2). The mouse wheel / trackpad pinch is about 1.8x quicker, and the + / - keys step 2.2x.
- New + and - buttons in the top-left corner of every chart zoom in and out with one tap or click, so a mouse user no longer needs Ctrl + wheel. "Reset zoom" appears next to them while zoomed in.
- Wheel and trackpad zooming redraws once per frame, so fast scrolling no longer feels sticky.
- Compare mode: zooming and panning were switched off when a second coin was selected. They now work the same as on a single coin (pinch, Ctrl/Cmd + wheel, + / - buttons, drag to pan, double tap to reset). While zoomed, both lines are measured from the first moment on screen, so each starts at 0% again and the percentages describe just the part you are looking at.
- The numbers sit at the top of `src/js/chart.js` (`PINCH_GAIN`, `WHEEL_ZOOM`, `WHEEL_ZOOM_LINES`, `KEY_ZOOM`) if you want to fine-tune them.

## 2.8.1

**The bot answers commands and button taps quickly again. Redeploy the backend only (nothing changes on the website).**
- Cause: Telegram updates were handled in batches, and the bot did not ask Telegram for the next batch until every handler in the current one had finished. One slow action (rendering a chart, "Post all", a price fetch, "Test sources") therefore froze every other command and tap until it was done. Each update now runs on its own, so the bot keeps listening while a slow one works.
- The Prices, Next alert and Status screens read all coin settings in one database query instead of one per coin (31 round trips before).
- Prices, Next alert, Test banner and the post confirmation screen accept a price reading up to 60 seconds old (the scheduler refreshes it every poll) instead of often waiting on a fresh fetch. The Refresh button still forces a new one.
- Refresh on the Prices screen, and changing a coin's mode, acknowledge your tap immediately so the button stops spinning; if a refresh fails you now get a short message instead of a pop-up.

## 2.8.0

**Zooming is more responsive again. Redeploy the frontend.**
- Pinching with two fingers now zooms about 1.4x further for the same finger movement than in 2.7.x (the pinch curve went from 1.45 to 2.1; 1 would be fingers exactly). The mouse wheel and trackpad pinch are about 1.6x quicker, and the + / - keys step 1.8x instead of 1.6x.
- Pinch zooming redraws once per frame instead of on every touch event, so fast pinches are smoother as well as stronger.
- The numbers sit at the top of `src/js/chart.js` (`PINCH_GAIN`, `WHEEL_ZOOM`, `WHEEL_ZOOM_LINES`, `KEY_ZOOM`) if you want to fine-tune them.

## 2.7.1

**The chart header (the time, change and price above the chart) now always takes exactly 3 rows. Redeploy the frontend.**
- Row 1 is the time, row 2 the change, row 3 the values (High / Low / Last, Price when you touch the chart, or O / H / L / C on candles). Row 3 stays on one line and no longer wraps, so the chart no longer jumps up and down while you analyse it. Comparing coins keeps the same 3 rows.
- The 2.7.0 change (5 fixed price rows inside the chart and the Telegram chart images) stays.

## 2.7.0

**Ten more coins, TON is now GRAM, steadier charts, easier zooming and a white margin round the coin logo. Redeploy both the backend and the frontend.**
- New coins: Monero (XMR), Shiba Inu (SHIB), Bitcoin Cash (BCH), NEAR Protocol (NEAR), Aptos (APT), Cosmos (ATOM), Internet Computer (ICP), Ethereum Classic (ETC), Filecoin (FIL) and Algorand (ALGO). That makes 31 coins. They sit after the main coins (and before the stablecoins) in the Telegram lists and on the website, not at the top. Each starts with a step of roughly 1% of its price; change any of them in Settings.
- XMR has no Binance pair (Binance delisted Monero spot), so it is priced from CoinGecko, Kraken or CoinPaprika. The other nine are on all three.
- TON is now GRAM. The token was renamed from Toncoin on 15 June 2026 (the network is still called TON). Prices, alerts, logos and pages all use GRAM. On the first start after the update the database moves the old TON row (step, mode, mute) and its post history to GRAM, so nothing is lost. On the website, old `/coin/TON` links redirect to `/coin/GRAM`, and saved favourites, recent searches, portfolio holdings and price alerts that said TON are moved over on the visitor's device.
- Very small steps (SHIB): a step such as $0.00000004 was read as "0 decimals" and rounded to zero. It now keeps the right number of decimals everywhere.
- Charts, both the Telegram images and the website: the price scale now always shows the same 5 rows, evenly spaced. Before, the number of rows changed with the price range, so the grid jumped while you dragged across a chart.
- Zoom: pinching, the wheel / trackpad pinch and the + / - keys now react about 1.5-1.8x faster than before (normal, not fast).
- Coin page: the ring between the logo and the header card was the page colour (black in dark mode). It is now a thin white margin (3px instead of 5px).
- Kraken: a pair we asked for by name is now matched exactly before falling back to the looser match.
- Worth a check after deploying: Use "Test sources" in Settings > Data source to confirm GRAM and the ten new coins show prices on every source (CoinGecko's id for GRAM is kept as `the-open-network`; CoinPaprika's id for GRAM is unconfirmed).

## 2.6.0

**Real coin logos everywhere, much smaller Fear & Greed cards in better places, and a Clear button for recent searches. Redeploy both the backend and the frontend.**
- Logos: the website no longer settles for the letter badge (BTC, ETH...). If a logo fails to load it is
  retried as a plain picture (a browser that cached an older copy without CORS headers was refusing it),
  then from two public icon sets, and only then does it show letters. Logos also appear in the search list.
- Backend: `GET /api/logos/<TICKER>.png` now downloads a missing logo on the spot (shared between
  simultaneous requests, and not retried for 5 minutes after a failure), so a fresh deploy or a wiped disk
  no longer leaves coins without logos until the next healing pass.
- Fear & Greed: one compact card instead of a huge panel (a small dial, the reading, and
  yesterday / last week / last month in a single row). On the home page it now comes after the coins list and
  before Top movers; on a coin page it sits at the bottom, above "Explore more coins".
- Search: the Recent list has a Clear button. (Settings > Data and privacy still has one too.)
- The Content-Security-Policy allows pictures from cdn.jsdelivr.net and assets.coincap.io (images only) as the
  last-resort logo source.

## 2.5.0

**Zoomable charts, Fear & Greed, a rebuilt Settings area and a round of polish. Redeploy both the backend and the frontend.**
- Backend: new `GET /api/sentiment`. The whole-market Fear & Greed Index comes from alternative.me
  (free, no key; the response names the source) and each coin gets its own 0-100 reading that we
  calculate from price momentum, the day range and trading activity. `/api/market` now includes
  `change24h`. Logo images are served with a CORS header so the site can size them to fit.
- Charts: pinch with two fingers (or Ctrl/Cmd + wheel, or a trackpad pinch) to zoom, drag to pan,
  double tap / double click, 0 or "Reset zoom" to return. One finger is always one crosshair, so
  the ghost second line is gone. The price scale is held still while a moment is selected, which
  stops the chart shaking as you drag.
- Fear & Greed: a dial on the home page (with a small "Source: alternative.me") and a reading on
  every coin page.
- Coin page: redesigned header card with a properly fitted logo, a real price-alert card (rises to /
  falls to, quick +/- percentages, your alerts for the coin), and a coin picker sheet in place of
  the plain dropdown for Compare, Portfolio and Price alerts.
- Logos: every logo is measured once and scaled so it fills its round tile the same way everywhere.
- Market map: stepped colours, white labels, a colour key, a 24H / 7D switch and a "More coins" tile.
- Footer: the Cryptomium wordmark now fits the page width exactly on every screen; the back-to-top
  button lives in the footer instead of floating over the page.
- Live market bar: can be hidden completely (Settings > Appearance).
- Snapshot: the market cap sparkline no longer sits over the text. The currency / coin search field
  no longer gets squashed.
- Settings rebuilt into Appearance, Preferences, Home and coin pages, Watchlist, Price alerts,
  Learn crypto, Data sources, Data and privacy, Advanced and Experimental, with a live preview on
  desktop. New options: text size, clear (colour-blind friendly) up/down colours, hide any home
  or coin page section, markets list length, data saver, number detail, keyboard shortcuts, price
  in the tab title, alert chime and touch feedback.

## 2.4.0

**A deeper website: clearer charts, a portfolio, a market map, and a tidier look. Redeploy both the backend and the frontend.**
- Backend: `/api/market` now also returns each coin's rank, circulating / total / max supply,
  all-time high (and its date) and the 1 hour, 30 day and 1 year price changes. Nothing else changes.
- Charts: values appear in a line above the chart instead of a card on top of it. The chart runs
  edge to edge and taller on phones, has a full screen mode, and can overlay a second coin.
- Markets: the whole row opens the coin page, with an arrow and a hint so it is clear. Rows start
  with the best-known coins (stablecoins last), "Show more coins" adds ten at a time, and rows are
  compact on phones. Prices no longer flash unless turned on in Settings.
- Home: market snapshot, top movers, market map, and "Latest moves" that only shows fresh alerts
  and live movers.
- New Portfolio page, coin pages with performance, supply, all-time high and an About section,
  copy-price and share buttons, recent searches.
- Settings: compact rows on phones, accent colours with names (fixes the empty circles), a currency
  picker with search, density Auto / Roomy / Compact, equal-width toggles, and the price tape
  now shows prices on every page and pauses only while held.
- New footer with the real Telegram, X, Instagram, YouTube and TikTok logos, a live "Moving now"
  list, a round back-to-top button, and Inter Tight for headings and numbers (Syne stays for the
  Cryptomium name).

## 2.3.0

**Everything on the website is now live, plus a Settings area and candle charts.**
- Live prices: the website now reads prices from an exchange every ~2 seconds
  (Binance, then Kraken, then the normal source as a fallback), independent of the
  bot's own price source. Prices, the price tape, sparklines and charts move as
  they happen. The feed only runs while someone is on the site.
- New `/api/stream` (Server-Sent Events) pushes updates to open pages; pages fall
  back to polling automatically if streaming is unavailable.
- `/api/history/<TICKER>?style=candles` returns candles (Binance, then CoinGecko).
- New optional settings: `API_LIVE_REFRESH_MS` (default 2000) and
  `API_MAX_STREAMS` (default 1500).
- Website: Settings hub (Preferences, Watchlist, Price alerts, Data and privacy),
  accent colours, density, line/candle toggle, crosshair that stays put until you
  tap elsewhere or press Esc, price tape, currency converter on coin pages,
  price alerts with browser notifications, backup/restore of your settings.

## 2.2.5

**Website, home page and footer (frontend only; the backend is unchanged apart from the version).**
- The home page opens with a short headline, "The crypto market, live.", and the
  Markets table starts right below it. The market summary card and the two buttons
  are gone.
- The latest alert now appears as a single line under the headline (for example
  "BTC rose to $86,500, 4 min ago") and links to the full Latest alerts list.
- The Live indicator moved next to the Markets heading.
- No more coin counts in the text ("21 coins" and "Show all 21 coins" are now
  "the leading coins" and "Show all coins").
- New footer: brand and Telegram logo, a Popular coins column linking to Bitcoin,
  Ethereum, Solana, XRP and BNB, an Explore column, a Back to top link, and a large
  faded Cryptomium wordmark along the bottom.

## 2.2.4

**Website now stands on its own (frontend only; the backend is unchanged apart from the version).**
- Telegram no longer runs through the site. The Join buttons are gone from the header
  menu, the home page, coin pages, the About page and the footer banner, and the
  Telegram sample post is removed.
- The only Telegram mention is a Telegram logo link in the footer.
- The home page now describes the site itself (live prices, charts, market size and
  alerts), and the main buttons are "See all markets" and "Latest alerts".
- Latest alerts show in two columns on desktop, and coin pages use the same alert
  design as the home page.
- Page titles, descriptions and FAQ wording no longer lead with Telegram.

## 2.2.3

**Website, home page tidy-up (frontend only; the backend is unchanged apart from the version).**
- Removed the coloured coin tiles from the top of the home page. The Markets table
  already shows every coin, so the page now goes from the intro straight to Markets.
- Latest alerts redesigned: each alert shows the coin logo with a direction badge,
  the coin, "Rose to" / "Fell to" in green or red, the price and how long ago.
- The Telegram sample is now shown as a real channel post, with the channel name and
  a "just now" banner, next to the Join button.
- Quick answers sit beside a "Read the full FAQ" button on desktop.
- New footer: a Telegram call-to-action band, tidy Explore and Follow columns, and a
  copyright line with the disclaimer.
- Fixed the sample banner's placeholder price showing a stray word before prices load.

## 2.2.2

**Website, proper phone navigation (frontend only; the backend is unchanged apart from the version).**
- On phones the header is now just the logo, a search button and a menu button.
  The menu opens a panel with Markets, Alerts, About, the currency picker, the
  light/dark switch and the Join button. Desktop keeps the full header.
- The header can no longer push the page sideways; checked at 320, 360, 412 and 768 px
  with a deliberately wide font.
- Redeploys now reach phones straight away: the stylesheet and scripts are no longer
  cached for an hour, and every build stamps them with a version, so an older copy of
  the site cannot linger on a phone after an update.
- Phone search opens as a bar under the header instead of floating over the page.

## 2.2.1

**Website, phone fixes (frontend only; the backend is unchanged apart from the version).**
- Coin tiles no longer overlap: each tile now stacks symbol, price and 24h change,
  and coin symbols use a narrower typeface.
- The page no longer drags sideways. The header's Join button is removed on phones
  (the Join button in the hero stays), and sideways overflow is blocked everywhere.
- The markets list shows 8 coins on phones with a "Show all 21 coins" button, so the
  page is much shorter. Desktop is unchanged.
- Coin page: long prices (KES, NGN) wrap safely, and the chart makes room for long
  price labels.

## 2.2.0

**Rebrand: Cryptomium.** The default banner/caption watermark is now `@cryptomiumx`
(set `WATERMARK_HANDLE` on Railway if you already override it, that value still wins).

**New website (frontend/ is a full redesign).** Home page with a live tile board,
sortable markets table, latest alerts and Telegram join section; a page per coin
with a price chart, market stats and that coin's alerts; About and FAQ; search,
starred coins, light/dark theme and a currency switcher (USD, EUR, GBP, KES, NGN,
ZAR and more). The old "last refreshed" text, source label and red refresh flash
are gone: prices just update quietly.

**New API endpoints (read-only, cached):**
- `GET /api/market`: market cap, volume, 24h range, 7d change and a 7-day sparkline
  for every coin (one CoinGecko call, reused for 5 minutes).
- `GET /api/history/<TICKER>?range=24h|7d|30d|90d|1y`: price history for charts.
- `GET /api/alerts?limit=20&ticker=BTC`: the latest automatic alerts the bot posted
  (manual "Post prices" sends are not included).
- `GET /api/rates`: fiat exchange rates for the currency switcher.
All of them share cached readings between visitors, remember failures for a short
time so a struggling upstream is not hammered, and serve the last good reading
(marked `stale`) when a refresh fails.

**Fixes found while preparing the site:**
- Website traffic no longer counts towards the "price source failing" alerts
  (a busy site could have triggered false alarms within seconds).
- A failing gap-fill source (usually CoinGecko, rate-limited) is no longer retried
  on every fast refresh, and the site slows down while prices come from a backup.
- The visitor's address for rate limiting now comes from the end of
  `X-Forwarded-For` (the start can be faked). New `TRUSTED_PROXY_HOPS` (default 1).
  Default `API_RATE_LIMIT_PER_MIN` raised from 120 to 240 because the site polls.
- A failed snapshot rebuild is no longer retried on every request.
- An error in any single bot handler no longer stops the whole bot (it is logged).
- Clean shutdown: the process now exits on SIGTERM instead of hanging.
- Chart captions use the configured watermark instead of a hard-coded handle.

**Tests:** new `test/website.test.js` plus two price-service tests (111 -> 113 total).

## 2.1.3

- **Dashboard hosting moved from Netlify to Vercel.** `frontend/` now has
  `vercel.json` (replacing `netlify.toml`) and a `package.json`. The backend
  address is read from `site.config.json` (already set to your Railway
  backend), and an `API_URL` environment variable in Vercel overrides it.
- Docs and examples now refer to Vercel.

## 2.1.2

- **Dashboard now shows moving prices.** The old default (Auto = CoinGecko
  first) only updates about once a minute, so the website kept repeating the
  same numbers. The default data source is now **Binance first, CoinGecko as
  backup** (existing installs keep whatever was chosen in 🌐 Data source).
- The website refreshes every 5 seconds on Binance/Kraken and every 30 seconds
  on aggregator sources (`API_REFRESH_MS`, `API_SLOW_REFRESH_MS`).
- With Binance first, 24h changes for every coin now come from CoinGecko, and
  that reading is reused for a minute (the old code asked CoinGecko again on
  every price check). Auto mode is unchanged.
- `/api/prices` now includes `source`, and the dashboard shows it
  ("Live · Binance + CoinGecko · updated 3s ago").
- Frontend: `netlify.toml` now contains the Railway `API_URL`.

## 2.1.1

- Removed the preview images (and the Previews section) from the README to
  keep the download small.

## 2.1.0

**New: website API (for a Netlify dashboard)**
- The bot now also serves a small read-only HTTP API on `PORT`:
  `GET /api/prices` (live price, 24h change, brand colour and logo link per
  coin), `GET /api/logos/<TICKER>.png`, and `GET /health`. It only reads the
  price cache the bot already keeps, so website visitors add no extra calls to
  the price sources. Visitors share one reading per `API_REFRESH_MS`, requests
  are limited per visitor, and CORS is restricted with `ALLOWED_ORIGIN`.
- New `frontend/` folder in the download: a static dashboard for Netlify that
  refreshes by itself. It takes the backend address from the `API_URL`
  environment variable at build time.

**Fixed: alerts could be lost**
- A milestone is now marked as used only after its banner was actually sent.
  If rendering or Telegram fails, it is retried on the next poll (up to
  `ALERT_MAX_ATTEMPTS`, then dropped with a log line).
- Overlapping polls can no longer stack up: a poll that is still running makes
  the next one skip.
- Automatic alerts are paced `POST_DELAY_MS` apart, and a Telegram "too many
  requests" reply pauses sending instead of burning alerts.

**New: optional limits**
- `MAX_AUTO_POSTS_PER_HOUR` and `MIN_POST_GAP_SECONDS` (both off by default).
  Held-back alerts are not consumed; they post when there is room.

**New: 🧹 Factory reset** (Settings, with a confirmation step)
- Erases coin settings, mutes, post history, the chosen data source and logo
  style, and the channel connection, then restores the defaults.

**Housekeeping**
- Post history older than `POST_LOG_RETENTION_DAYS` (default 365) is pruned.
- Previously hard-coded timings are now environment variables: `POST_DELAY_MS`,
  `SOURCE_ALERT_COOLDOWN_MIN`, `LOGO_RETRY_MIN`.
- The alert loop moved into `src/alertRunner.js` so it can be unit-tested
  (new tests for it and for the API).
- Removed the last mentions of the old CoinMarketCap/DexScreener sources
  from the tests, and the outdated preview images from the README.

## 2.0.0

**CoinGecko: Demo/Pro auto-detection**
- The bot now auto-detects whether `COINGECKO_API_KEY` is a free Demo key
  (`api.coingecko.com`) or a paid Pro key (`pro-api.coingecko.com`) — these
  use different hosts and header names and are not interchangeable. It tries
  Demo first and, only if rejected, tries Pro once and remembers whichever
  worked. Upgrading to a paid CoinGecko plan needs no other change. Shared by
  both live price fetching and the logo downloader.

**Removed: CoinMarketCap and DexScreener sources**
- Both are gone from Settings > Data source, 🔍 Test sources, and
  `src/config.js`/`src/priceService.js`. `COINMARKETCAP_API_KEY` is no longer
  read or needed.

**New: 🧮 Average price source**
- Queries CoinGecko, Binance and Kraken concurrently and uses the midpoint of
  whatever range they return — (lowest + highest) ÷ 2 — as the live price.
  Still works if one of the three fails; only errors if all three do.
  💰 Prices shows the full range next to the result when this is active, e.g.
  `$86,700–$86,820 → $86,760`.
- CoinPaprika is deliberately excluded from the Average blend (same
  free-tier-quota reasoning as it being last-resort-only in Auto).

**New: 📊 Chart (under 📣 Post prices)**
- Renders a price-history chart for one coin: pick the coin, a time range
  (24H/7D/30D/90D/1Y or a custom day count up to 365), then 📈 Line or
  🕯️ Candlesticks. Styled dark and gridded — title, current price, colored
  period change, labeled price/time axes, watermark.
- Nothing renders until you explicitly tap a style button; the result is
  shown to you first, with a button to post it to the channel.
- Candlesticks aren't available for a custom range (CoinGecko's OHLC endpoint
  only accepts fixed day counts); picking candles there quietly falls back to
  a line chart and says so in the caption.
- New modules: `src/chartData.js` (fetching CoinGecko's `market_chart`/`ohlc`
  endpoints), `src/chartGenerator.js` (rendering), `src/fonts.js` (font
  registration, factored out and now shared with the banner generator).

**Threshold recalibration**
- Based on real Post history data, the six most-frequently-alerting coins
  (UNI, ZEC, HYPE, LTC, SUI, HBAR) had their base $ and % steps raised
  noticeably (so even 🚀 Hyper mode's ¼x no longer over-alerts), and the eight
  least-frequently-alerting (TRX, TON, LINK, AVAX, ETH, ADA, DOT, BNB) had
  theirs lowered moderately. These are still just starting points — tune
  further in Settings once you see how they behave for you.

**Confirmed, no change needed**
- Binance's main address (`api.binance.com`) was already always tried first
  on every price fetch (never permanently skipped after a failure), so if
  your server's region changes and it becomes reachable again, the bot picks
  that up automatically on the next tick.

**Tests:** 85 unit tests (14 new: CoinGecko Demo/Pro detection, the Average
blend, chart data-fetching, chart rendering) and 66 simulated menu-flow checks
(8 new: the full chart flow, the new/changed Data source list), all passing.

## 1.5.0

**New price sources: Kraken, CoinPaprika, CoinMarketCap, DexScreener**
(Settings > 🌐 Data source now lists 6 sources plus Auto, up from 2.)

- **Kraken** (exchange, no key) — genuinely USD-quoted, so unlike Binance it
  covers stablecoins too. Handles Kraken's legacy X/Z-prefixed response keys
  (a quirk affecting BTC/ETH/LTC/XRP/XLM) via fuzzy matching rather than a
  hardcoded table, and retries against the full market if a requested pair
  name is rejected — the same resilience Binance already had.
- **CoinPaprika** (aggregator, no key) — one batched call covers all 21
  coins, matched by CoinPaprika's own coin ID (not the ticker) to avoid
  symbol collisions with unrelated coins.
- **CoinMarketCap** (aggregator, needs `COINMARKETCAP_API_KEY`) — the
  key-free "trial" tier is explicitly not meant for production and can be
  withdrawn without notice, so this bot never uses it; without a key the
  source fails fast (no network call) with a clear message instead.
- **DexScreener** (on-chain pool price) — architecturally different from the
  others: it prices one specific liquidity pool, not "the" reference price of
  a coin. Nothing is configured by default (a wrong pool address could
  silently return a different token's price); coins are added one at a time
  to `DEXSCREENER_PAIRS` in `src/config.js` only once verified.
- 🤖 **Auto** now tries CoinGecko → Binance → Kraken → CoinPaprika. CMC and
  DexScreener are deliberately excluded from Auto (rate-limit / configuration
  reasons — see the README) but remain available as an explicit pick and are
  included in 🔍 Test sources.
- 🔍 **Test sources** now checks all six and explains the two "off by
  default" ones (CMC needs a key; DexScreener needs configured pairs) instead
  of just showing them as failed.

**Tests:** 65 unit tests (15 new, covering response parsing and fallback
behavior for all four new sources) and 58 simulated menu-flow checks (5 new),
all passing.

## 1.4.0

**Fixed: ✨ Clean logo style looked bad**
- The old version relied on a backing disc color derived from the banner's
  own gradient math, a very faint 0.5-opacity hairline border, and a shadow
  that barely registered against a same-hue background — so the logo looked
  washed out and undefined, especially on real (non-synthetic) logo art.
- Reworked: a soft white glow just outside the logo, a crisp 0.92-opacity
  border, and a neutral pearl backing fill (instead of a brand-derived shade
  that could clash with the actual logo colors). Checked against a real
  Bitcoin logo, a non-circular (diamond-shaped) logo, and monogram fallbacks.

**New: 📈 Post history (Status > Post history)**
- Every banner actually sent — automatic milestone alerts and manual
  📣 Post prices sends — is now logged with its timestamp, direction and
  price.
- View totals for Last 24 hours / 7 days / 30 days / All time, split into
  auto vs. manual, with a per-coin breakdown. Answers "how many posts have
  gone out, and when."

**New: 🔭 Next alert (Status > Next alert)**
- Shows how close each unmuted coin is to triggering right now, in both
  directions, e.g. `ETH ▲ +$23.90 · ▼ -$26.10` (or in % for a percent-step
  coin; stablecoins show distance to the depeg band, or distance back inside
  it if already depegged). Useful for judging whether a step/mode is
  calibrated the way you want.

**New: per-preview logo style in 🧪 Test banner**
- A 🖼️ Style row on the Rise/Fall and custom-price screens lets you flip
  between ✨ Clean and ⚪ White ring for just that preview, without touching
  your saved default in Settings. The caption says which style was used.

**Tests:** 50 unit tests (16 new, covering the next-alert distance math for
ladder/percent/stablecoin cases) and 53 simulated menu-flow checks (11 new),
all passing.

## 1.3.0

**New coins:** AVAX (Avalanche), SUI, XLM (Stellar), HBAR (Hedera), DOT
(Polkadot), UNI (Uniswap), LTC (Litecoin), ZEC (Zcash), HYPE (Hyperliquid) —
21 coins total, up from 12. Each has a CoinGecko ID, a Binance symbol (for
the backup price source), a brand color for its banner, and starting $ steps
matching what was requested; starting % steps are a reasonable default and
worth tuning per coin.

No other changes — everything else (menus, banner design, data sources,
post prices) works the same for the new coins automatically, since the whole
bot reads from the one coin list in `src/config.js`. Confirmed by running the
full test suite and simulated menu flows with the new coins included, and by
rendering all 9 new banners to check layout and monogram fallback.

**Note:** logos for the new coins download the same way as any other coin
(single batched CoinGecko request, with fallback sources) — nothing extra to
configure.

## 1.2.1

**Fixes**
- 💰 Prices was sent as a code block (`<pre>`), which Telegram won't update in
  place — tapping Refresh always failed silently. It's now a normal formatted
  message, so Refresh actually refreshes (and tells you "Already the latest
  prices" if nothing changed, or the reason if the fetch failed, instead of
  failing silently).
- 🔍 Test sources now lists every Binance address it tried, not just the one
  that answered — so "main address blocked, data address OK" is visible
  instead of just showing Binance as healthy.
- Admin price cache: refresh throttle lowered from 3s to 2s.

**Notes**
- A ✅ on both CoinGecko and Binance in Test sources means your server is not
  region-blocked from either right now — no separate fix needed there.

## 1.2.0

**New: choose where prices come from (Settings > 🌐 Data source)**
- Auto (CoinGecko, Binance as backup), CoinGecko only, or Binance first
  (CoinGecko as backup). Saved across restarts.
- 🔍 Test sources: checks each provider live (✅/❌, speed, coins returned,
  plain-English errors such as "blocked from this server's region").
- Private alerts when the main source starts failing, when every source fails,
  and when it recovers (throttled to one per hour per kind).
- Binance is now tried on two hosts (the main API is blocked from some server
  regions), retries with the full price list if one symbol is rejected, and is
  never used for USDT/USDC (no dollar price / false depeg risk) — those always
  come from CoinGecko, even in "Binance first".
- The fallback path is now covered by automated tests (simulated outages).

**New: 📣 Post prices**
- Post the current price of one coin, or all coins, to the channel, with a
  confirmation step. The chip shows the 24h direction; the caption adds the
  24h change. No chip if the 24h change isn't known.

**Banner tweaks**
- Coin icon ~12% smaller; more space between ticker and price. The direction
  chip stays exactly where it was.
- New default logo style ✨ Clean: no white ring, a subtle border and soft
  shadow. The old ⚪ White ring look is one tap away (Settings > 🖼️ Logo style).
- One dynamic price format everywhere: `$86,019`, `$4,021.45`, `$0.096`,
  `$0.00001234`; stablecoins show 3 decimals.

**Other**
- Main menu is now 3 rows of 2 buttons.
- The Prices screen shows which source served the reading (and "(backup)").
- Malformed provider responses are treated as a clean provider failure.

## 1.1.1

- Banner: logo a bit smaller (~165px) and the price a bit bigger (~153px), so
  the price is even more the focal point. Layout re-centered for the new
  proportions; the price still shrinks automatically if it would run too wide.

## 1.1.0

**Fixes**
- Missing coin logos (DOGE, ADA, LINK, and likely TON/USDT/USDC): the build
  fetched each logo with its own CoinGecko call and hit the free-tier rate
  limit after about six. Logos now come from a single batched request, with
  retries (honoring Retry-After), fallback icon sources, validation, and a
  retry at every bot start plus every 30 minutes. You get a private message if
  any are still missing.
- A missing logo no longer leaves a banner empty: it shows a coin-colored
  ticker badge until the real logo arrives.

**Banner**
- Focal point is the price: logo ~15% smaller, price ~20% bigger. The price
  shrinks automatically only when it would run too wide.

**New features (owner menu)**
- 💰 Prices: live prices with each coin's step and mode, plus refresh.
- 🧪 Test banner: preview any coin (rise / fall / custom price), sent only to
  you.
- 🔕 Bulk mute: mute or unmute all coins, or tick several, with the same
  durations as a single coin.
- Percentage steps per coin (alert each time price moves that % from the last
  alert), with defaults BTC 0.5%, ETH 0.75%, XRP 1%, BNB 0.75%, SOL 1%.
  Per-coin and all-coins switches between $ and %.
- Alert modes scaling each coin's step: 🚀 Hyper (¼x), 💨 Fast (½x),
  🎯 Steady (x, default), 😌 Calm (2x); per coin or for all coins.
- Status list now reads like `BTC — 0.5% 🔔`.
- Tapping a menu button now cancels any half-finished "type your answer" step.
- Optional `COINGECKO_API_KEY` environment variable.

**Under the hood**
- Database gains `step_unit`, `pct_threshold` and `mode` columns (added
  automatically on start; existing coins keep their $ steps and Steady mode).
- `npm test` (unit tests for steps/modes, input parsing and the logo
  downloader).

## 1.0.10

- Final banner layout: logo back to center-left at full size, ticker with a
  large price underneath (84 -> 132px at the original scale), both
  left-aligned.
- Direction chip moved up and to the right of the ticker, overhanging the
  price's right edge slightly; never overlaps the ticker on short prices.
- Chip colors are more saturated: a true green and a true red (were minty and
  pinkish). The chip's gloss is lighter so the colors stay rich.
- Background no longer leans red: the hue shifts in the gradient and glows
  were reduced for every coin, so Bitcoin reads as true orange.
- Fixed: the "keep the background darker so the chip is visible" rule was
  over-triggering (it turned Bitcoin fall banners brown); it now only applies
  when the brand color is genuinely close to the chip color (TRX, USDT).
- README: added a Previews section.

## 1.0.9

- New layout (following the reference): logo top-left with the ticker beside
  it, a direction chip at the right end of the row, and the price below.
- The arrow is now always white, inside a small pill that is green for a rise
  and red for a fall (replaces the colored arrow).
- Logo badge pushed up to make room for the price; its size, the banner size
  (1600x418) and the watermark are unchanged.

## 1.0.8

- Redesigned the text block. Clear hierarchy: a big hero price (84 -> 108px)
  with the ticker above it, and the direction arrow now sits right beside the
  ticker instead of floating left of the price. Ticker and price share one
  left edge.
- Crisper text shadows (less blur/fuzz).

## 1.0.7

- Banner size is now 1600x418 (matches the reference card). Layout scales
  with height and stays well inside the middle of the image, where Telegram
  crops wide photos.
- Direction arrows are smaller (66x58 -> ~45x40) and no longer glow; just a
  tight soft shadow.

## 1.0.6

- Background is now a web-style glowing gradient: hue-shifted base, soft
  luminous light orbs (screen-blended) and a glass-like diagonal sheen.
- Direction arrows: removed the white border; now solid, softly rounded and
  lightly glowing. Background is kept darker for coins whose brand color is
  close to the arrow color (TRX, USDT) so the arrow stays visible.
- Whites are more refined: text has a subtle white-to-pearl gradient, the
  logo margin is pearl white, shadows are brand-tinted instead of black.
- Yellow brands (BNB, DOGE) shift toward amber instead of going olive/muddy.

## 1.0.5

- Cleaned up the 1.0.4 look, which rendered muddy: removed the glow, light
  sweep and vignette that showed up as smudges in the background (now a
  simple, clean gradient), and removed the shading that dirtied the white
  marks inside logos (like the Bitcoin B).
- Softer text/arrow shadows (no dirty halo) and a flat white logo margin with
  a drop shadow instead of a grey gradient and hairline.

## 1.0.4

- Banner redesign: multi-tone gradient background derived from the brand
  color (no longer the same flat color as the logo), with a glow behind the
  logo and light grain to prevent banding.
- Logo is bigger (200 -> 250px), sits in a thicker white margin (4 -> 12px)
  and has a light 3D treatment (drop shadow, highlight, shading).
- Ticker is bigger (64 -> 84px), heavier and letter-spaced, and sits above
  the price. Dark text outlines removed in favor of soft drop shadows.
- Direction arrow is smaller (76x64 -> 60x52) with a gradient fill and thin
  white edge.
- Content moved left; watermark opacity raised (0.55 -> 0.8).

## 1.0.3

- Banner is taller (1536x401 -> 1536x480; width unchanged) and the dark frame
  around the brand color is gone — the color now fills the whole banner.
- Font switched from Source Serif 4 to Poppins (geometric sans), bundled in
  `assets/fonts` instead of downloaded at build time.
- Direction arrow is now drawn as a vector triangle instead of a font glyph.

## 1.0.2

- Banner restyle: only the direction arrow is colored (green up / red down);
  the price is now white.
- Ticker (e.g. BTC) is now bold and white instead of regular and black/white.
- Thin white ring around the coin logo.

## 1.0.1

- **Fix:** bot posted "Connected." but never posted coin data. In Telegraf 4.x
  `await bot.launch()` doesn't resolve while polling, so `startScheduler()` was
  never reached. Launch now resolves via the `onLaunch` callback.
- **Fix:** Binance fallback feed always failed (HTTP 400) because `USDTUSDT`
  isn't a real pair. Coins without a Binance pair are now skipped in the fallback.
- Log a line on every price tick (prices fetched, channel connected or not).
- Catch errors from `setMyCommands`; round the initial baseline to avoid float drift.

## 1.0.0

- Initial release.
