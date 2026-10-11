# Pulse — chart feed with news and meaning

A phone-first web app (installable PWA). Your watchlist as a feed of charts, one symbol per screen:

- **Scroll** up or down for the next symbol. The feed loops: after the last one comes "You're all caught up", then round 2.
- **Swipe right** (finger moves right) for that symbol's news, cross-checked across outlets, with "What this means for …" researched by AI.
- **Swipe left** for details: today's numbers, "Why did it move?" on unusual days, readings in plain words, ranges, your rules.
- **Dashboard** tab: the whole list at a glance. **Profile** tab: watchlists, chart style, indicators, rules, alerts, shared lists, account, legal.

Information only. The AI explains what happened and what numbers measure; it never says buy, sell or hold and never forecasts.

## Try it now (demo mode, no setup)

```
cd web
python3 -m http.server 8000
```
Open http://localhost:8000 on your computer (or your phone on the same Wi-Fi, using your computer's IP). In demo mode everything is saved on the device, coins use sample closing prices until the data job runs, and AI features are off.

## Put it online for free (about 30 minutes)

### 1. GitHub Pages
1. Create a GitHub repository and push this folder to its `main` branch.
2. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables**: add `SITE_URL` = your Pages address (for example `https://yourname.github.io/pulse`).
4. The workflow in `.github/workflows/deploy.yml` publishes the app about a minute after every push (reusing the live prices and news), and every 2 hours refreshes coin candles and news, checks everyone's rules, and publishes again.

### 2. Firebase (free Spark plan) — accounts with no personal data, push alerts
1. https://console.firebase.google.com → **Add project**.
2. **Build → Authentication → Sign-in method → Anonymous → Enable**. Under **Settings → Authorized domains** add `yourname.github.io`.
3. **Build → Firestore Database → Create database** (production mode; region `asia-south1` for India). Open **Rules**, paste `firestore.rules`, **Publish**.
4. **Project settings → General → Your apps → Web app (</>)**. Copy the config object into `firebase` in `web/config.js`.
5. **Project settings → Cloud Messaging → Web Push certificates → Generate key pair**. Copy the key into `vapidKey` in `web/config.js`.
6. **Project settings → Service accounts → Generate new private key**. In GitHub **Settings → Secrets → Actions**, add a secret `FIREBASE_SERVICE_ACCOUNT` with the whole JSON file as its value. Never commit this file.

The config values in `web/config.js` are public by design; the Firestore rules protect the data.

### 3. AI relay (Cloudflare Workers free plan) — news explanations, "Why did it move?", Ask AI search, indicator research
1. Create a Cloudflare account and an Anthropic API key (https://console.anthropic.com). Claude API usage is billed per request; `DAILY_LIMIT` in `worker/wrangler.toml` caps requests per user per day, and every result is stored once and shared, so each story is researched only once.
2. On your computer, in the `worker` folder:
   ```
   npx wrangler login
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT     # paste the same JSON as above
   npx wrangler deploy
   ```
3. Set `ALLOWED_ORIGIN` in `wrangler.toml` to your Pages origin (for example `https://yourname.github.io`) and deploy again.
4. Copy the worker address into `workerUrl` in `web/config.js`, commit and push.

Optional: a free CoinGecko Demo API key as the GitHub secret `COINGECKO_DEMO_KEY` (used only to cross-check coin prices).

## Data sources and why

Every source is free and allowed for this use:

| Data | Source | Notes |
| --- | --- | --- |
| Coin candles | Kraken public API | Fetched on the phone when the app opens, and by the data job every 2 hours |
| Coin price check | CoinGecko | Shows a warning if Kraken and CoinGecko differ by more than 1%. Show "Powered by CoinGecko" if you use their key |
| Stock, ETF and index charts, quotes, company profile and financials | TradingView embeddable widgets | Their data licence covers the display. Attribution stays visible |
| News | GDELT Project | Free for commercial use with a citation (shown in the app). Headlines link to publishers; only neutral outlets are kept |
| AI explanations | Claude API with web search | Facts with linked sources, same text for every user |

**Stocks with our own charts, readings, fact tags and rules** need price data we are allowed to process and display. Free stock-price APIs only allow personal use, and NSE's website terms forbid scraping. When you choose a licensed vendor or a broker data API, add a provider in `pipeline/` that writes stock candles into `data/candles.json` in the same format as coins (`series["NSE:RELIANCE"] = { source, bars: [[date, o, h, l, c, v], …] }`). The app switches those symbols from TradingView embeds to its own charts automatically.

## Compliance built in

- No personal data: no name, email or phone. An account is a 30-character recovery code; its SHA-256 is the database key.
- AI guardrails in `worker/worker.js`: one shared text per story or move, a blocked-words check (buy, sell, hold, targets, forecasts, "oversold" and similar) with one rewrite then refusal, sources on every text, "AI-generated · date · not investment advice" labels, and a report button that hides a text after 3 reports.
- Fact tags state facts only ("Volume 2.1x usual", "New 50-day high"); starter watchlists use published groupings only.
- Outlook-style direction calls are not built (they would need SEBI Research Analyst registration).
- Before a public launch: lawyer review of the terms, the privacy notice, the fact-tag wording and the starter lists; fill in `grievanceEmail` and `companyName` in `web/config.js`.

## Files

```
web/                 the app (static files, no build step)
  index.html, styles.css, config.js, manifest.webmanifest, sw.js, icons
  js/app.js          feed: cards, panes, looping, catch-up and caught-up cards, refresh
  js/pages.js        dashboard, profile pages, add-stock and watchlist sheets, onboarding
  js/chart.js        our SVG charts: candles/line/area, moving averages, news pins, RSI/MACD/volume
  js/data.js         candles on the phone, live Kraken refresh, fact tags
  js/indicators.js   indicator maths (shared with the data job); matches TradingView's RSI method
  js/store.js        accounts, watchlists, shared lists, alerts, AI calls, push
  js/search.js       symbol and indicator search; data/symbols.json holds about 15,000 listings
  js/interact.js     hold-to-read chart, alert from chart, tap-to-learn panels, quiz
  js/levels.js       support/resistance (swing levels) and pivot points
  js/coach.js        first-time guided tours
  js/full.js         full-screen interactive chart (drag, pinch, 1D to full history)
  js/describe.js     plain-language meaning of each reading
pipeline/            data job run by GitHub Actions (no npm packages)
worker/              AI relay for Cloudflare Workers
firestore.rules      database security rules
```

## Checks

Run `scripts/check.sh` (needs Node 20+, Python 3 with Playwright and Chromium). It runs 92 checks across the app, the data job and the AI relay and prints one line per suite. See `DEVELOPMENT.md` for the process and what is and isn't covered.
