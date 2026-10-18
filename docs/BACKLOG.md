# Pulse backlog

**Last updated: 18 Oct 2026, 22:50 IST** (live: 1.2.9)

How Pulse works and where everything is: `claude/pulse-handoff.md`
(repo: `docs/HANDOFF.md`). How to work: `claude/pulse-expectations.md` (repo: `docs/EXPECTATIONS.md`). Ordered by the priority in the
expectations: trust first, then "works on a real phone", then simplicity, then new features.

## Now: trust
1. **Score v2: make the score a credential** (score review, 18 Oct). The current score can be gamed, rewards luck and
   market direction, and barely separates real skill. v2 is designed and tested in simulation:
   `claude/pulse-score-v2-factors.md` (ten fundamentals, exact starting values, experiments). Waiting on Veer: fading
   at 9 months, looser proof for 650–800 with strict proof above 800, and the respect rule. Next: replay ~2 years of
   real Kraken prices through the same players, then real players. Still to test: stacking overlapping long calls.
   **Build "market" in from day one** (all-markets vision, 18 Oct): instrument ids tagged by market, a score per
   market, an overall score that combines evidence (not a plain average; shown only once two markets are proven,
   proposed), correlated calls across markets count as one. Cheap now, expensive later.
2. **Sign-in decision before real users.** Anyone who types a username can open that account; clearing Safari data
   loses the phone's sign-in. Options to weigh: Google sign-in, email link, passkeys. Conflicts with "no personal
   data" for email/Google: needs a decision on what "no personal data" means at scale.
3. **Compliance review before a wide launch:** game wording, leaderboard, groups, public scored calls, Learn, "your
   calls tend to…", Community. Ideally with a lawyer who knows SEBI's finfluencer and investment-adviser rules.
   Also ask:
   - Is a free, no-stakes prediction game on live Indian stock prices allowed at all? (SEBI: no real-time data
     sharing with virtual trading/fantasy platforms, May 2024; public warning, Nov 2024; educational platforms may use
     only 30-day-old data from 1 Jul 2026.) Our view: likely not as a live game; possible as blind-chart practice.
   - Which non-Indian market is cleanest to add second (US stocks, indices, gold, forex), including data licences?
   - Terms: minimum age, DPDP Act (usernames, device ids and connection data can be personal data).
4. **Trust and safety: the score must not become a tipster's badge.** Before a wide launch:
   - terms with a tick-box at sign-up, in plain words: no using the score to promote paid tips or advice;
   - share card says "Skill score, not advice" and links to the real profile so claims can be checked;
   - keep profiles free of bios, links and contact details;
   - a report button, a warn/hide/suspend process, and a record of actions taken;
   - never partner with or take money from tip-sellers;
   - decide who handles reports (minutes a week at CUG scale, a real job if Pulse grows).
   Terms alone don't protect: regulators look at what actually happens and whether Pulse acted.

## Next: works on a real phone, against the real database
- **Live-site check after each deploy:** a throwaway account signs up, makes a call, is deleted (catches what the
  emulators can't, e.g. slow live connection on a phone network).
- **Real-database tests still missing:** shared lists, price alerts, push notifications, username change, account
  deletion.
- **Live checks owed:** first morning push (7:47 AM IST run); daily.json crowd after a day's calls are scored;
  Community feeds returning items from GitHub Actions; `boards/followed` and `players/*/calls` after the 2-hour job;
  the share menu on a real iPhone and Android.
- **Two-account live test before CUG:** create a group, join by link, start a challenge, pick, invite, search,
  follow, reveal after the job runs.
- Feedback note still open: "formatting issue for bottom bar" (13 Oct, tab bar, 390×797); waiting for a screenshot.

## Waiting on Veer
- **Pulse brief** (`claude/pulse-brief.md`): who it's for, business model, stage and next milestone, resources,
  success metrics, competitors, compliance position, brand. Questions asked 18 Oct.
- **Candles vs TradingView / RSI:** Pulse uses Kraken USD candles (UTC days) and always shows the daily RSI. Label it
  ("Daily RSI · Kraken", "1D · 15-min" chip) or switch to Binance prices? Asked 15 Oct.
- **Account clean-up (offered, not built):** preview, then delete dead accounts only on Veer's go.

## Later / parked
- Full-screen chart: pivot labels crowd the price scale.
- More news for BNB, Hyperliquid and Chainlink (GDELT); BNB and HYPE need RSS sources.
- iOS has no vibration API: lock-in and reveal haptics work on Android only.
- Firebase MCP (local server via Claude desktop config): setup steps given 15 Oct; parked.
- Reddit mention counts: only if Reddit confirms Pulse's use is allowed; a number only, never posts.
- **More markets (the bigger picture):** a score per market and overall. Only after score v2 is proven on real
  players (this month's score predicts next month's results) and the lawyer's answers. Indian stocks as blind-chart
  practice (30+ day old charts, name and dates hidden); live credential markets outside India first.
- Brand: "Pulse" is a crowded name in fintech; run a trademark search before investing in the brand at scale.
- To discuss: compare two coins on one chart; moving an account to a new phone.

## Recent releases (details in git log and the handoff)
- **1.2.9 (17 Oct):** How Pulse works, a five-card guide; the score explainer row removed.
- **1.2.8 (17 Oct):** Call it in three steps; how sure and based on asked after Lock in (addable within 15 min).
- **1.2.7 (17 Oct):** sign-in without device limits; sign-out keeps the phone's sign-in; rules published by the
  deploy; deploys gated on real-database tests. See the RCA (`claude/pulse-rca-2026-10-17.md`).
- **1.2.1–1.2.6 (17 Oct):** passwords removed; typing, log-in and saving fixes; speed pass (1.2.2).
- **1.2.0 (17 Oct):** the MVP redesign: Feed · Calls · You, onboarding, Call it, replay, levels, public scored calls,
  Learn.
- **1.1.x (14–16 Oct):** profile and share card, habit loop, Community news; wrong-way calls never better than "Off".
