# Cryptomium SEO operations guide

This guide describes the current implementation and the repeatable checks to run before shipping SEO changes. It is not a promise of rankings; search engines decide whether and when to index pages.

## Build-time SEO

`seo.js` is the single source of truth for the indexable page registry and generated metadata. It generates titles, descriptions, canonical URLs, robots directives, Open Graph/X cards, JSON-LD, the sitemap, robots.txt and llms.txt. Keep this central rather than adding duplicate metadata to individual templates.

The build emits real HTML for the main pages and each tracked coin. This gives crawlers meaningful titles, descriptions, coin explanations and canonical URLs before the browser runs market-data JavaScript.

### Intended index policy

Indexable pages:
- Home
- Market overview
- Screener
- News index
- Coin comparison
- Converter
- About / FAQ
- Privacy
- One canonical page for each tracked coin

Do not index private or user-specific app surfaces such as portfolio, settings, offline shell, app shell, 404, or the unknown-coin fallback. Lowercase coin URLs are aliases of the uppercase ticker URL and should canonicalize to that one URL. Keep the sitemap limited to the preferred canonical URLs.

## Run checks locally or in CI

Use the same required build configuration as the Vercel project:

```sh
cd frontend
API_URL=https://your-backend.example SITE_URL=https://cryptomium.vercel.app npm run build
npm run seo:check
```

On PowerShell:

```powershell
cd frontend
$env:API_URL = "https://your-backend.example"
$env:SITE_URL = "https://cryptomium.vercel.app"
npm run build
npm run seo:check
```

Use the actual production backend URL and the exact canonical domain selected for Cryptomium. If a custom domain becomes primary, set `SITE_URL` to that domain in Vercel and redeploy. Do not publish separate canonical identities for the custom domain and the Vercel alias.

The SEO checker examines built HTML for missing/duplicate titles, descriptions and canonicals, absolute HTTPS URLs, Open Graph images, parseable JSON-LD, sitemap coverage and the robots.txt sitemap declaration. Warnings need human review; a passing checker is not a substitute for testing the live website.

## Search Console launch checklist

1. Verify the preferred site property in Google Search Console. Prefer a Domain property when DNS access is available; otherwise verify the exact URL-prefix property.
2. Verify the same domain in Bing Webmaster Tools. Importing from Search Console is an option if offered.
3. Submit `https://YOUR-CANONICAL-DOMAIN/sitemap.xml` in both tools.
4. Inspect the home page, `/markets`, a representative coin page such as `/coin/BTC`, and one tool page with URL Inspection. Confirm that the rendered page has the intended title, canonical, indexability and primary text.
5. Review Page Indexing / indexing status, sitemap processing, crawl errors, Core Web Vitals and manual actions periodically.
6. After meaningful content or URL changes, inspect affected URLs and request recrawling where appropriate. Submission is a discovery hint, not a guarantee of indexing.
7. Keep records of baseline impressions, clicks, CTR and average position so improvements can be evaluated over weeks rather than by a single search.

These account-verification and submission steps require the site owner's Search Console / Webmaster Tools access and cannot be completed just by changing repository files.

## Content and keyword strategy

Prioritize useful pages for clear intents:
- Coin pages: live price in USD, chart, daily movement, market cap, volume, all-time high/low and a genuinely useful coin explanation.
- Market overview: broad market movement, dominance, sentiment and top movers.
- Screener: discovery and filtering by price, performance, volume, supply and ATH distance.
- Comparison: understandable side-by-side metrics and transparent explanation of calculated insights.
- Converter: supported currencies and a clear statement that displayed conversions use indicative market data.
- About / methodology: where data comes from, refresh behaviour, differences between providers, how milestone alerts work, and limitations.

Avoid doorway pages, near-identical text across coins, keyword stuffing, invented editorial expertise, unsupported financial claims, and pages created only to capture search phrases. Coin explanations should be reviewed for accuracy whenever token names, tickers, or projects change. Add new educational pages only when they answer a real question in sufficient depth and can be maintained.

## Technical and performance checks

- Confirm clean URLs and the permanent `/coin/TON` → `/coin/GRAM` redirect stay aligned with the canonical ticker in the current coin list.
- Check every URL in the sitemap returns a successful page and canonicalizes to itself. Check missing coin routes and unknown tickers return an actual 404 response where routing allows, not a successful indexable fallback.
- Test the mobile layout, keyboard accessibility, semantic headings, internal links, image alt text and visible content with JavaScript disabled or delayed.
- Use PageSpeed Insights / Lighthouse on home, market overview, and coin pages. Address real Core Web Vitals issues instead of chasing a single lab score.
- Keep third-party scripts and fonts lean. Preserve working market updates, PWA installation and offline behaviour while optimizing.
- Test Open Graph cards using real production URLs after deploy.
- Review security headers and API origin restrictions separately from SEO; never expose secrets in frontend code.

## International and Kenya relevance

Cryptomium supports currencies including Kenyan shillings, so make this capability easy to discover in the visible converter and help text. Do not add Kenya-specific landing pages unless they contain genuinely localized, useful information. Use language/region metadata only for real language or regional variants; do not add artificial hreflang pages.

## Important limits

- A meta description can influence a search snippet, but Google may choose another excerpt.
- Structured data helps explain content; it does not guarantee a rich result or higher ranking.
- Sitemap submission does not guarantee crawling or indexing.
- The `llms.txt` file and AI crawler rules are supplementary; they do not replace crawlable HTML, accurate source content, links, or Search Console monitoring.
- Rankings and organic traffic take time and depend on competition, external reputation, content quality, and search-engine systems as well as technical implementation.
