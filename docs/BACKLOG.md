# Pulse backlog

**Last updated: 22 Oct 2026, 19:55 IST** (live: 1.2.9)

How Pulse works and where everything is: `claude/pulse-handoff.md` (repo: `docs/HANDOFF.md`). How to work:
`claude/pulse-expectations.md` (repo: `docs/EXPECTATIONS.md`). Ordered by the priority in the expectations: trust
first, then "works on a real phone", then simplicity, then new features.

## Next release: 1.3 (decided 22 Oct, nothing built)
From a designer's 12-point review of 1.2.9. Plan, exact copy and code pointers: `claude/pulse-1.3-plan.md` (repo:
`docs/PLAN-1.3.md`). Mockups: "Pulse feedback mockups", https://claude.ai/artifact/8FkebwoHzHg1BadkGw2bLB.
- **1.3.0 Navigation:** the phone's back closes pages and sheets (today it leaves the app everywhere except the group
  page); back arrows; pages slide in; the Calls progress card opens "Your record" over Calls; full-screen chart
  close.
- **1.3.1 Onboarding:** a "You make calls. Pulse keeps score." screen before the first call; first call 1 day; no
  direction pre-selected.
- **1.3.2 Feed, indicators, Calls:** no story bars (coin position as a rail on the right); "All my coins" as a sheet;
  list view with "‹ Feed"; current candle chart kept; ƒx and S/R only in full screen, with a visible expand icon;
  panels can be added to the feed (off by default, max 2, existing players keep theirs); Calls with an explanation
  line, clear tap affordances and the "About your score" sheet.
- **Open decisions** (end of the plan): one release or three steps; one-time swipe hint; "Make a call" button on
  Calls (needs a coin picker); S/R and lines on the feed; whether the takeover fix and real legal text join 1.3.0.
- Not now (designer's points 2, 5, 6, 7, 12): product images in onboarding; ƒx naming and recovery (mostly solved
  by moving ƒx to full screen); panel values (check in full screen); one news view with filters.

## Now: trust
1. **Fix before anyone outside uses the app** (20 Oct review, `claude/pulse-review-2026-10-20.md`):
   - **Account takeover:** any signed-in phone can add itself to any account that has a username, and usernames can
     be listed. Cheapest fix without personal data: a recovery code shown once at sign-up.
   - **Placeholder legal text is live** (`config.js`: grievance@example.com, "Your company Pvt Ltd").
   - **The live score is the gameable v1**, shown with verdicts and ranks: hide the number or label it "test".
2. **Keep the score method private (Veer, 22 Oct).** The repo is public and contains today's scoring code; the phone
   scores calls too. Before v2: make the repo private (check GitHub Pages' terms for private repos, or move hosting;
   Veer's go first), score only on the server, keep v2 details and simulation code out of the repo. Open: publish the
   factors at a general level (Claude's advice) or nothing beyond the app's three points.
3. **Score v2: make the score a credential** (score review, 18 Oct). Designed and simulated; everything is in the
   private `claude/pulse-score-v2-factors.md` (status table, factors, settings, experiments) and the deck "Pulse
   Score v2" (https://claude.ai/artifact/EuLb82vmbxEVYGTHVMvHsw).
   - **Agreed (18 and 20 Oct):** see the status table in the private doc.
   - **Open:** memory size; the display lines beside the score; what goes in the first release. The 20 Oct review
     argues to stop tuning constants until pilot data exists.
   - **Next:** replay ~2 years of real Kraken prices through the same players, then real players. Still to test:
     stacking overlapping long calls on one coin. The simulation code is only in an old session's workspace; save it
     privately (not to the public repo).
   - **Build "market" in from day one** (all-markets vision, 18 Oct): instrument ids tagged by market, a score per
     market, an overall score that combines evidence, correlated calls across markets count as one.
   - The Call it sheet needs free call sizes and should drop "how sure" from anything scored.
4. **Sign-in decision before real users.** Anyone who types a username can open that account; clearing Safari data
   loses the phone's sign-in. Options to weigh: recovery code (now), Google sign-in, email link, passkeys. Conflicts
   with "no personal data" for email/Google. Score v2 depends on it (one person, one record).
5. **Compliance review before a wide launch:** game wording, leaderboard, groups, public scored calls, Learn, "your
   calls tend to…", Community, the word "calls", the score as a public claim, data licences (Binance CC BY-NC-SA,
   Kraken and outlet terms). Ideally with a lawyer who knows SEBI's finfluencer and investment-adviser rules. Also ask:
   - Is a free, no-stakes prediction game on live Indian stock prices allowed at all? Our view: likely not as a live
     game; possible as blind-chart practice.
   - Which non-Indian market is cleanest to add second, including data licences?
   - Terms: minimum age, DPDP Act (usernames, device ids and connection data can be personal data).
6. **Trust and safety: the score must not become a tipster's badge.** Before a wide launch: terms with a tick-box at
   sign-up; share card says "Skill score, not advice" and links to the real profile; no bios, links or contact
   details; a report button and a warn/hide/suspend process with a record; never take money from tip-sellers;
   decide who handles reports.

## Next: works on a real phone, against the real database
- **Live-site check after each deploy:** a throwaway account signs up, makes a call, is deleted.
- **Real-database tests still missing:** shared lists, price alerts, push notifications, username change, account
  deletion. 1.3 adds the back button, the first call without a direction and feed panels.
- **Live checks owed:** first morning push (7:47 AM IST run); daily.json crowd after a day's calls are scored;
  Community feeds returning items from GitHub Actions; `boards/followed` and `players/*/calls` after the 2-hour job;
  the share menu on a real iPhone and Android.
- **Two-account live test before CUG:** create a group, join by link, start a challenge, pick, invite, search,
  follow, reveal after the job runs.
- Feedback note "formatting issue for bottom bar" (13 Oct, tab bar, 390×797): waiting for a screenshot.

## Waiting on Veer
- **1.3 open decisions** (above and in the plan).
- **The 20 Oct review's recommendations:** freeze new features until real players answer "want it, come back, trust
  it"; take 30-minute and 1-hour calls out of the score; credit Binance; news as headline and link; a 30–100 person
  pilot (2–3 college clubs plus a few non-Indian crypto users, six weeks); lawyer before any public launch.
- **Score method:** fully private, or factors published at a general level; making the repo private.
- **Score v2 open items** (private doc).
- **Pulse brief** (`claude/pulse-brief.md`): who it's for, business model, stage and next milestone, resources,
  success metrics, competitors, compliance position, brand. Asked 18 Oct.
- **Candles vs TradingView / RSI:** Pulse uses Kraken USD candles (UTC days) and always shows the daily RSI. Label it
  ("Daily RSI · Kraken", "1D · 15-min" chip) or switch to Binance prices? Asked 15 Oct. (The 20 Oct review saw two
  different RSIs on neighbouring screens.)
- **Account clean-up (offered, not built):** preview, then delete dead accounts only on Veer's go.

## Later / parked
- Designer's points not in 1.3: product images in onboarding, one news view with filters.
- Full-screen chart: pivot labels crowd the price scale.
- More news for BNB, Hyperliquid and Chainlink (GDELT); BNB and HYPE need RSS sources.
- iOS has no vibration API: lock-in and reveal haptics work on Android only.
- Firebase MCP (local server via Claude desktop config): setup steps given 15 Oct; parked.
- Reddit mention counts: only if Reddit confirms Pulse's use is allowed; a number only, never posts.
- **More markets:** a score per market and overall, only after score v2 is proven on real players and the lawyer's
  answers. Indian stocks as blind-chart practice; live credential markets outside India first.
- **Pulse Scholarship** (`claude/pulse-scholarship-plan.md`): waits on score v2, real sign-in, a lawyer's and a CA's
  opinion. Its "method published" line conflicts with the 22 Oct secrecy decision.
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
