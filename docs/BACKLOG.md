# Pulse backlog

**Last updated: 23 Oct 2026, 02:53 IST** (live: 1.4.0)

How Pulse works and where everything is: `claude/pulse-handoff.md` (repo: `docs/HANDOFF.md`). How to work:
`claude/pulse-expectations.md` (repo: `docs/EXPECTATIONS.md`). Ordered by the priority in the expectations: trust
first, then "works on a real phone", then simplicity, then new features.

## Now: check what shipped on 22–23 Oct (1.3.0, 1.3.1, 1.4.0)
- **Veer on a real phone (Android and iPhone):** the phone's back on every page and sheet (never leaves Pulse from
  one); onboarding (How Pulse works, first call with nothing picked, No change); feed rail, coins sheet, expand
  button, indicators "+ Feed"; Calls tab rows and About your score; You and Your record after the score switch.
- **Score v2 recalculation:** after the first full data job on 1.4.0, read every account's `pscore` (v, score, was)
  in Veer's Chrome (handoff section 8 shows how) and look at anyone who moved by more than ~100 points, and why.
- **Real-price replay of score v2** (build doc section 7): still not done. It was the gate for switching; Veer chose
  to switch straight away (22 Oct). Do it next, with the simulation code from `claude/pulse-score-v2-simulation-code.md`
  run privately (not in the public repo).

## Now: trust
1. **Fix before anyone outside uses the app** (20 Oct review, `claude/pulse-review-2026-10-20.md`):
   - **Account takeover:** any signed-in phone can add itself to any account that has a username, and usernames can
     be listed. Cheapest fix without personal data: a recovery code shown once at sign-up. "One person, one record"
     (the point of score v2) means little until this is fixed.
   - **Placeholder legal text is live** (`config.js`: grievance@example.com, "Your company Pvt Ltd").
2. **Make the score method private (Veer: later).** Score v2's code is `pipeline/lib/score2.mjs` in the public repo
   (Veer, 22 Oct night: public for now). Plan: a private `pulse-score` repo the data jobs check out with a read-only
   token secret `SCORE_REPO_TOKEN` (build doc, decision D1), or make `pulse` private (Pages on a private repo needs a
   paid plan). The phone no longer scores, so only the jobs need it. Open: publish the factors at a general level
   (Claude's advice) or nothing beyond the app's three points.
3. **Score v2 follow-ups:** 30-minute and 1-hour calls still count (the 20 Oct review says take them out); memory 720
   and the display lines as in the build doc; "No change" for group picks needs `clientP0` on picks (a rules change);
   1-week to 9-month periods, end price from 3 exchanges, hour-and-weekday ruler, recent-weighted volatility, stacked
   long calls on one coin, a percentile at the top: later (build doc section 8). Build "market" in from day one is
   done for crypto (`market: "CRYPTO"`); other markets need a score per market and an overall one.
4. **Sign-in decision before real users.** Anyone who types a username can open that account; clearing Safari data
   loses the phone's sign-in. Options: recovery code (now), Google sign-in, email link, passkeys (email/Google conflict
   with "no personal data").
5. **Compliance review before a wide launch:** game wording, leaderboard, groups, public scored calls, Learn, "your
   calls tend to…", Community, the word "calls", the score as a public claim, data licences (Binance CC BY-NC-SA,
   Kraken and outlet terms). Ideally with a lawyer who knows SEBI's finfluencer and investment-adviser rules. Also:
   Indian stocks as a live game (our view: likely not; blind-chart practice instead); which non-Indian market second;
   terms, minimum age, DPDP Act.
6. **Trust and safety: the score must not become a tipster's badge.** Terms with a tick-box at sign-up; share card
   says "Skill score, not advice" and links to the real profile; no bios, links or contact details; a report button
   and a warn/hide/suspend process with a record; never take money from tip-sellers; decide who handles reports.

## Next: works on a real phone, against the real database
- **Live-site check after each deploy:** a throwaway account signs up, makes a call, is deleted.
- **Real-database tests still missing:** shared lists, price alerts, push notifications, username change, account
  deletion, the feed-panel setting, a No change call settled by the job, the v2 score written by the 2-hour job.
- **Live checks owed:** first morning push (7:47 AM IST run); daily.json crowd after a day's calls are scored;
  Community feeds from GitHub Actions; `boards/followed` and `players/*/calls` after the 2-hour job; the share menu
  on a real iPhone and Android.
- **Two-account live test before CUG:** create a group, join by link, start a challenge, pick, invite, search,
  follow, reveal after the job runs.
- **Deploy safety:** a manual or scheduled deploy publishes `main` without tests; only move `main` to tested code.
  Consider making the 2-hourly run skip publishing when the last push's tests failed. From 17 to 22 Oct those runs
  published nothing (site stuck on 18 Oct; fixed 23 Oct). Runners pinned to Ubuntu 24.04 for Playwright 1.56; move
  to Ubuntu 26 together with a Playwright upgrade.
- Feedback note "formatting issue for bottom bar" (13 Oct, tab bar, 390×797): waiting for a screenshot.

## Waiting on Veer
- **The 20 Oct review's recommendations:** freeze new features until real players answer "want it, come back, trust
  it"; take 30-minute and 1-hour calls out of the score; credit Binance; news as headline and link; a 30–100 person
  pilot (2–3 college clubs plus a few non-Indian crypto users, six weeks); lawyer before any public launch.
- **Score method:** fully private, or factors published at a general level; when to make the code private.
- **Pulse brief** (`claude/pulse-brief.md`): who it's for, business model, stage and next milestone, resources,
  success metrics, competitors, compliance position, brand. Asked 18 Oct.
- **Candles vs TradingView / RSI:** label it ("Daily RSI · Kraken", "1D · 15-min" chip) or switch to Binance prices?
  Asked 15 Oct.
- **Account clean-up (offered, not built):** preview, then delete dead accounts only on Veer's go.
- **Old branches** on GitHub (callit-steps, diag, live-tests, mvp, rules-check, verify, and the release-1.3.0/1.3.1/
  1.4.0 branches once merged): delete in the GitHub UI after checking each is merged.

## Later / parked
- Designer's points not done: product images in onboarding (2), ƒx naming (5, mostly solved), panel values (6),
  one news view with filters (12).
- Full-screen chart: pivot labels crowd the price scale.
- More news for BNB, Hyperliquid and Chainlink (GDELT); BNB and HYPE need RSS sources.
- iOS has no vibration API: lock-in and reveal haptics work on Android only.
- Firebase MCP (local server via Claude desktop config): parked.
- Reddit mention counts: only if Reddit confirms Pulse's use is allowed; a number only, never posts.
- **More markets:** only after score v2 is proven on real players and the lawyer's answers.
- **Pulse Scholarship** (`claude/pulse-scholarship-plan.md`): waits on real sign-in, a lawyer's and a CA's opinion.
- Brand: "Pulse" is a crowded name in fintech; trademark search before investing in the brand at scale.
- To discuss: compare two coins on one chart; moving an account to a new phone.

## Recent releases (details in git log and the handoff)
- **1.4.0 (23 Oct):** score v2 is the score (jobs only), everyone recalculated with a one-time note; Higher, Lower or
  No change; any call size; start price after the call; no "too close" void; tidy (dead code and ~12 KB of CSS).
- **1.3.1 (23 Oct):** feed rail instead of story bars; coins sheet; ƒx and S/R in full screen; up to 2 panels on the
  feed; Calls tab with About your score, Make a call, clear rows; Your record page.
- **1.3.0 (23 Oct):** back everywhere (phone back closes sheets and pages), pages slide in; onboarding explains a
  call; first call 1 day with nothing picked; one-time swipe hint.
- **1.2.9 (17 Oct):** How Pulse works, a five-card guide.
- **1.2.0–1.2.8 (17 Oct):** the MVP redesign, Call it in three steps, sign-in without passwords or device limits.
