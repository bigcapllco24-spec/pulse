# Pulse — chart feed with news and meaning

A phone-first web app (installable PWA), crypto first. Your coins as a feed of charts, one coin per screen:

- **Scroll** up or down for the next coin. The feed loops: after the last one comes "You're all caught up", then round 2.
- **Swipe right** (finger moves right) for that coin's news, cross-checked across outlets, plus price events from its own daily candles.
- **Swipe left** for "Before you call": how much it usually moves, the facts right now, your calls and alerts, readings in plain words, ranges.
- **Call it** on any card: Higher, Lower or No change, and by how much, over 30 minutes, 1 hour, 1 day or 1 year. Calls are scored when their time is up, and they add up to one score from 300 to 900 (how it works in general: `docs/prediction-score.md`). A game: no money, not advice.
- **Calls** tab: your calls, today's coin, groups and challenges with friends, the leaderboard. **You** tab: your record and score.

Information only: facts and plain-language explanations, never buy, sell or hold, and never forecasts.

## Try it now (demo mode, no setup)

```
cd web
python3 -m http.server 8000
```
Open http://localhost:8000 on your computer (or your phone on the same Wi-Fi, using your computer's IP). In demo mode everything is saved on the device, coins use sample closing prices until the data job runs.

## Put it online for free (about 30 minutes)

### 1. GitHub Pages
1. Create a GitHub repository and push this folder to its `main` branch.
2. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables**: add `SITE_URL` = your Pages address (for example `https://yourname.github.io/pulse`).
4. The workflow in `.github/workflows/deploy.yml` publishes the app about a minute after every push (reusing the live prices and news), and every 2 hours refreshes coin candles and news, checks everyone's rules, and publishes again. `.github/workflows/settle.yml` scores prediction-game calls every 15 minutes (`pipeline/settle.mjs`, about 20 seconds a run).

### 2. Firebase (free Spark plan) — accounts with no personal data, push alerts
1. https://console.firebase.google.com → **Add project**.
2. **Build → Authentication → Sign-in method → Anonymous → Enable**. Under **Settings → Authorized domains** add `yourname.github.io`.
3. **Build → Firestore Database → Create database** (production mode; region `asia-south1` for India). Open **Rules**, paste `firestore.rules`, **Publish**.
4. **Project settings → General → Your apps → Web app (</>)**. Copy the config object into `firebase` in `web/config.js`.
5. **Project settings → Cloud Messaging → Web Push certificates → Generate key pair**. Copy the key into `vapidKey` in `web/config.js`.
6. **Project settings → Service accounts → Generate new private key**. In GitHub **Settings → Secrets → Actions**, add a secret `FIREBASE_SERVICE_ACCOUNT` with the whole JSON file as its value. Never commit this file.

The config values in `web/config.js` are public by design; the Firestore rules protect the data.


Optional: a free CoinGecko Demo API key as the GitHub secret `COINGECKO_DEMO_KEY` (used only to cross-check coin prices).

## Data sources and why

Every source is free. Whether each licence covers a public launch is on the compliance list (`docs/BACKLOG.md`):

| Data | Source | Notes |
| --- | --- | --- |
| Coin candles | Kraken public API | Fetched on the phone when the app opens, and by the data job every 2 hours |
| Long daily history (full-screen chart) | Binance public market data | About 4 years of daily candles, fetched on the phone. Licence: CC BY-NC-SA (to be credited) |
| Coin price check | CoinGecko | Shows a warning if Kraken and CoinGecko differ by more than 1%. Show "Powered by CoinGecko" if you use their key |
| News | GDELT Project, outlets' own feeds, projects' and exchanges' official pages, Snapshot and project forums | Free for this use with a citation (shown in the app). Headlines link to publishers; only neutral outlets are kept |

## Compliance built in

- No personal data: no name, email or phone. An account is a username on a sign-in kept on the phone.
- Fact tags state facts only ("Volume 2.1x usual", "New 50-day high"); starter watchlists use published groupings only.
- Outlook-style direction calls are not built (they would need SEBI Research Analyst registration).
- Before a public launch: lawyer review of the terms, the privacy notice, the fact-tag wording and the starter lists; fill in `grievanceEmail` and `companyName` in `web/config.js`.

## Files

```
web/                 the app (static files; the deploy minifies them and fingerprints the offline copy)
  index.html, styles.css, config.js, manifest.webmanifest, sw.js (the offline copy), icons
  js/app.js          the frame: tabs, refresh, theme, start-up, releases
  js/feed.js         the chart feed: paging, swipes, cards; news.js and details.js are a card's side panes
  js/calls.js        the Calls tab; callit.js makes a call; groups.js and people.js are groups and other players
  js/you.js          the You tab and Your record; account.js the account sheet; onboard.js and guide.js the first run
  js/pages.js        the coins list, settings pages, alerts, shared lists, chart and indicator sheets
  js/chart.js        our SVG charts; full.js the full-screen chart; levels.js support/resistance; studies.js what can be drawn
  js/data.js         prices on the phone (saved copy, live Kraken refresh); indicators.js the maths (shared with the jobs)
  js/store.js        account, alerts, shared lists, calls, push; social.js groups, following, player cards
  js/score.js        the rules a call follows and what a scored call shows; predict.js settling a call (shared)
pipeline/            data jobs run by GitHub Actions (no npm packages); lib/score2.mjs works out the score
scripts/             check.sh (every check), stamp-sw.mjs (deploy step)
tests/               e2e.py (demo mode), live.py (real-database, emulators), sw.py (offline copy), Node unit tests
firestore.rules      database security rules
```

## Checks

Run `scripts/check.sh` (needs Node 20+, Python 3 with Playwright and Chromium). It runs the static checks, ESLint, the Node tests, the demo-mode browser tests and the offline-copy tests, and prints one line per suite. The real-database tests (`tests/live.py`) run on GitHub against the Firebase emulators. See `DEVELOPMENT.md` for the process and what is and isn't covered.
