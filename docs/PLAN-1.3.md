# Pulse 1.3: plan (from the designer's feedback, 22 Oct)

**Last updated: 22 Oct 2026, 19:40 IST** (nothing built yet; live is 1.2.9)

Project copy: `claude/pulse-1.3-plan.md`. Repo copy: `docs/PLAN-1.3.md`. Keep them equal.

Mockups (canvas, private until shared): "Pulse feedback mockups", https://claude.ai/artifact/8FkebwoHzHg1BadkGw2bLB.
Rows: Onboarding · Feed · Calls and navigation · Charts and indicators. Prices and names on them are samples, and
the feed chart drawn there is a stand-in: **1.3 keeps the app's current candle chart.**

## Where this came from

A designer tried the live app (1.2.9) on Android and sent 12 points (22 Oct). Veer's call on each:

| # | Feedback | Decision |
|---|---|---|
| 1 | First thing onboarding asks is "make a call", with no context | **Do** (section B) |
| 2 | Use product images instead of generic icons in onboarding | Not now |
| 3 | Story-style bars at the top suggest tapping left/right; only swipes work | **Do** (section C) |
| 4 | No back buttons; Android back exits the site | **Do** (section A) |
| 5 | Removed graphs can't be added back; "ƒx" isn't common knowledge | Not now as its own item; mostly solved by section D |
| 6 | Indicator panels show values from the parent graph | Not now; check it in full screen during section D |
| 7 | Indicator panels can't be viewed full screen | Not now as its own item; solved by section D |
| 8 | "All coins" looks like a drop-down but swaps the whole page; the way back is unclear | **Do** (section C) |
| 9 | Moving to another section needs a transition to stay oriented | **Do** (section A) |
| 10 | Calls is a big feature but under-represented and under-explained | **Do** (section E) |
| 11 | In Calls it's unclear what can be tapped; add icons | **Do** (section E) |
| 12 | One news view for all coins, with filters | Not now (feature freeze advice in the 20 Oct review) |

## A. Navigation: back everywhere, pages slide in (4, 9)

Confirmed in the code: only the group page adds a history entry (`play.js`, `history.pushState({ grp })` and its
`popstate` handler). Every other page and sheet leaves Pulse on the phone's back button.

- **Every full page and every sheet adds a history entry.** The phone's back closes the top sheet or page, exactly
  like the on-screen back. Back on a tab's root does what the phone normally does (leaves the app).
- **Every pushed page has a back arrow top-left** naming where it goes: "‹ Calls", "‹ Feed".
- **Pages slide in from the right** over the page they came from (about 250–300 ms); back slides them out. Sheets
  slide up and close by swiping down (as today).
- **Tapping content never switches tab.** The progress card on Calls opens "Your record" as a page over Calls
  ("‹ Calls"), the same content as the score part of You, with "The same record lives in the You tab." The tab bar
  keeps Calls lit.
- **Full-screen chart:** a close button top-left, and the phone's back closes it.
- Mockups: Calls row, "Transition" and "Record".

## B. Onboarding: say what a call is first (1)

Flow: Welcome → **How Pulse works (new)** → Pick a username → First call → Locked in.

- **New screen** after Welcome: title "You make calls. Pulse keeps score." Three steps: 1 Pick a coin and a time
  (chips "Bitcoin", "1 day"); 2 Say where the price will be ("Higher or lower, and roughly how far. That's a call.");
  3 Get scored against the real price (chip "Very close" + "Right way, near your price"). Then: "Every call adds to
  your record. After about 30, it starts to show how well you really read the market. No money involved, and it's
  not advice." Button: Continue.
- **First call is 1 day, not 1 hour**: "Where will Bitcoin be tomorrow at <time>?" (from the 20 Oct review; Veer
  agreed 22 Oct).
- **No direction pre-selected** (`onboard.js` sets `dir = 1` today). Lock in stays grey, reading "Pick higher or
  lower", until a direction is picked. "How far" (the existing three sizes) and "Your call: ↑ about $…" appear after
  the direction.
- Hint under the button: "Scored tomorrow at <time> against the real price. No money involved. Not advice."
- **Open:** a one-time hint on the first feed card that news and "Before you call" are a swipe away. Claude
  recommends it; waiting on Veer.
- Mockups: Onboarding row ("Main", "FirstCall"; the second is tappable).

## C. Feed: no story bars, a sheet for "All my coins" (3, 8)

- **Remove the story bars** (`#progress` in the top bar, `progress()` in `app.js`). They mark which coin of the list
  you're on, which reads as tap-to-advance. Show the position as a **thin vertical rail on the right edge** instead
  (current coin a longer bar). Hide it above 40 coins, as today.
- **No labels for the side views.** Swipe left and right stay as they are (Veer, 22 Oct).
- **"All my coins" opens a sheet**, not Your market: "Coins in your feed" with each list as a choice (All my coins,
  each watchlist and shared list, with counts) and a tick on the current one; then "See them as a list ›" and
  "Edit lists and coins ›".
- **The list view (Your market) is a pushed page** with "‹ Feed" top-left and the list name as its title. The
  chart-icon button that led back today goes.
- Mockups: Feed row ("Feed", "CoinsSheet", "CoinsList").

## D. Charts and indicators: ƒx and S/R move to full screen

Veer, 22 Oct: keep the current chart; ƒx and S/R live in the full-screen chart; RSI/MACD can stay on the feed for
those who want them.

- **Feed card:** current candle chart, range chip (1D/1W/1M/1Y), your open calls drawn on it, hold to read a candle,
  Call it. **No ƒx or S/R buttons.** A **visible expand icon** on the chart's top-right corner opens full screen
  (the only route to ƒx and S/R now, so it can't be hidden).
- **Full screen:** close button, range chip (1D–Max), ƒx (with a count of what's on), S/R toggle, panels under the
  chart. Tapping a panel opens its guide (as today). A small "On feed" tag on panels that are also on the feed.
- **Indicators sheet (ƒx in full screen):** "Panels under the chart": each has a Show switch; once shown, a
  "+ Feed" button that turns into "✓ On feed". **At most 2 panels on the feed**; when 2 are on, the other "+ Feed"
  buttons go grey and the sheet says "On your feed: 2 of 2. Turn one off to add another." Turning a panel's Show off
  also takes it off the feed. "Lines on the chart" (averages, bands…) are full screen only.
- **Defaults:** new players have nothing on the feed. **Existing players keep the panels they have**, up to 2, shown
  on the feed (don't change someone's setup without asking).
- **Storage:** `accounts/{acct}.settings.chart` already holds the indicator picks; add which panels are on the feed
  there. The account rules don't restrict keys inside `settings`, so **no rules change** is expected; confirm in
  `tests/live.py`.
- With at most 2 panels on the feed, the "which panels fit" chooser (`checkPanelFit`) should no longer be needed on
  the feed; check before removing it.
- **Open:** S/R off the feed entirely (Claude's recommendation) or faint lines without labels; price-chart lines on
  the feed card at all (the mockup assumes not).
- Mockups: Feed row ("Feed") and the Charts and indicators row ("FeedPanels", "FullChart", "FullChartFx"; the sheet
  is tappable).

## E. Calls: explain it, make it central, show what's tappable (10, 11)

- **Header:** "Calls", a round search button (Find players), and one line: "Say where a price will be. Pulse scores
  how close you got. **About your score**" (link opens the sheet below).
- **"Make a call"**, a full-width primary button under the header. **Open:** it needs a coin picker (today a call
  can only start from a coin card in the feed); Claude proposed it, Veer hasn't said keep or drop.
- **Your record card:** "Too early to tell" (or the verdict), progress bar, "n of about 30 scored calls · streak",
  "Open ›". Opens the Record page (section A).
- **Waiting rows:** a round direction badge (green ↑ / red ↓), "Coin · period", "Higher, about $…", a clock icon with
  the time left, and a chevron.
- **With friends:** group row with a group icon, "Needs your pick · time left" in amber, and a "Pick" button; "All
  groups ›" as a link.
- **Scored rows:** coin and period, when, a result chip ("Very close" green, "Wrong way" red, "Close" neutral), chevron.
- **Rule:** everything tappable has a chevron or a button; section labels are plain grey capitals; links are blue
  with an arrow.
- **"About your score" sheet** (exact copy, Veer 22 Oct):
  - "Calling the right direction matters."
  - "Getting close to the real price matters too."
  - "One call can be luck. Your record shows skill over many calls, so give it about 30."
  - Highlighted: "**Every call builds your record.** The more you call, the sooner your skill shows, and the more
    your score says about you."
  - Button: "Make a call".
  - Nothing more about how the score is worked out; never say the score is being refined.
- Mockups: Calls row ("Calls", "Scoring").

## The score method is proprietary (Veer, 22 Oct)

- Veer: the scoring method is the one proprietary thing Pulse has; it stays secret. The app says only the points in
  section E.
- **This reverses an earlier decision:** score v2 (20 Oct) and the scholarship plan both say the method is
  published. Claude's advice, recorded: keep the constants and code private, but publish the factors at a general
  level, as credit scores do (they publish what counts and roughly how much, never the formula), because a credential
  others accept needs a method they can trust, and v2's protection is that the honest call scores best, not
  secrecy. **Waiting on Veer's final word.**
- **The score isn't secret today:** the repo `bigcapllco24-spec/pulse` is public, and today's scoring code is in it
  (`web/js/score.js`, `pipeline/`); the phone also scores calls itself, so the code reaches every browser. To keep
  v2 private: make the repo private (check GitHub Pages' current terms for private repos first, or move hosting),
  score only on the server, and keep the v2 simulation code and `claude/pulse-score-v2-factors.md` out of the repo.
  Making the repo private is a live change: Veer's go first.
- Docs in the repo (public) carry no v2 constants; they point to the project's private doc.

## Release plan

Veer, 22 Oct: one big version upgrade with all of this. **Claude's recommendation:** call it 1.3, but ship it in
three gated steps, because 1.2.0 (one big redesign) broke sign-in and saving for three hours (RCA, 17 Oct):

1. **1.3.0 Navigation** (section A): history for every page and sheet, back arrows, slide-in, Record page, full-screen
   close.
2. **1.3.1 Onboarding** (section B).
3. **1.3.2 Feed, indicators and Calls** (sections C, D, E).

Each step: `SHELL` and `version` bumped, `check.sh` and `tests/live.py` pass on GitHub, and a check on a real phone.
New tests to add: the phone's back button (Playwright `page.goBack()`) closes sheets and pages and never leaves the
app from a pushed page; the first call can't be locked without a direction; feed panels on/off and the 2-panel cap
saved against the emulators; existing players' panels carried over.

## Not in 1.3, but should come first (20 Oct review)

The 20 Oct review found two things to fix before anyone outside uses the app. They aren't in this plan; Veer to
decide whether they join 1.3.0:
- **Anyone can open anyone's account** by typing a username (the rules let any signed-in phone add itself).
  Cheapest fix without personal data: a recovery code shown once at sign-up.
- **Placeholder legal text is live** (`config.js`: grievance@example.com, "Your company Pvt Ltd").

## Open decisions (Veer)

1. One release or three steps (above).
2. One-time swipe hint on the first feed card.
3. "Make a call" on Calls (needs a coin picker): keep or drop.
4. S/R on the feed: off entirely, or faint lines.
5. Price-chart lines on the feed card: none (mockup) or allowed.
6. Score method: fully secret, or factors published at a general level; and making the repo private.
7. Recovery-code sign-in and real legal text: in 1.3.0 or separate.
