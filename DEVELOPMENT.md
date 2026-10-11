# How changes are made and checked

Every change follows the same five steps. Nothing is reported as done until step 4 is green.

1. **Reproduce.** Turn the problem into a failing check in `tests/` (or confirm an existing check fails). If it can't be automated, write down the exact manual steps.
2. **Fix narrowly.** Change only the files involved. Keep each fix to the smallest edit that makes the check pass.
3. **Run one command.** `scripts/check.sh` runs every suite and prints only failures plus one line per suite:
   ```
   syntax: all files parse
   pipeline: 4/4 checks passed
   worker: 6/6 checks passed
   levels: 4/4 checks passed
   e2e: 75/75 checks passed
   ALL CHECKS PASSED
   ```
   While iterating, run one suite: `scripts/check.sh e2e` (add `-v` to list every check).
4. **Look only when the change is visual.** Screenshots are taken only for layout or design changes, at phone size (390×844), and only the screens that changed.
5. **Report.** What was wrong, what changed, the suite summary, and anything that could not be tested here (live TradingView, Firebase, push, real phones).

## What the suites cover

| Suite | File | Covers |
| --- | --- | --- |
| syntax | `scripts/check.sh` | Every JavaScript file parses |
| pipeline | `tests/pipeline.test.mjs` | Data job with simulated Kraken, CoinGecko and GDELT: candles written, stories merged across outlets, opinion headlines dropped |
| worker | `tests/worker.test.mjs` | AI relay with simulated sign-in, Firestore and Claude: rejects bad sign-ins, caches results, blocks advice and forecast wording, resolves nicknames, hides reported texts |
| levels | `tests/levels.test.mjs` | Support/resistance and pivot point maths on candles with known answers |
| e2e | `tests/e2e.py` | The app in a phone browser with real touch swipes, and on desktop with mouse wheel, trackpad, drag and keyboard: every card in order, looping, both side panels on every symbol, charts, stock-chart fallback, pins, layout, add-stock sheet and new watchlists, switcher, bookmark, dashboard, every profile page, chart style, indicators, rules and alerts, theme, refresh, no JavaScript errors |

## When adding a feature

Add at least one e2e check for it in `tests/e2e.py`, in the phone or desktop section, using the existing helpers (`swipe`, `up`, `down`, `left`, `right`, `active`).

## Not covered by automated tests

TradingView embeds (blocked in the test browser, so the fallback message is what gets tested), Firebase sign-in and sync, push notifications, the live Kraken fetch, and real phones. Check these by hand after deploying.
