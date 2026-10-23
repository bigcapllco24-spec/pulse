"""End-to-end tests for the Pulse web app (1.2.0) in demo mode.
Run:  cd web && python3 -m http.server 8773   (in another terminal)
      python3 tests/e2e.py [base_url] [-v]
Needs Python Playwright and Chromium. Prints a PASS/FAIL line per check and exits non-zero on any failure.
"""
import sys, time, json, re, math
from playwright.sync_api import sync_playwright

VERBOSE = "-v" in sys.argv
ARGS = [a for a in sys.argv[1:] if a != "-v"]
BASE = ARGS[0] if ARGS else "http://localhost:8773/"
CHROME = "/opt/pw-browsers/chromium" if __import__("os").path.exists("/opt/pw-browsers/chromium") else None  # else Playwright's own (CI)
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    if VERBOSE or not ok:
        gha = "::error::" if not ok and __import__("os").environ.get("GITHUB_ACTIONS") else ""  # failures show on the run's page
        line = ("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else "")
        print(gha + (line.replace("\n", " / ") if gha else line), flush=True)

# The test browser can't reach Firebase, so the app is served with Firebase switched off (demo mode).
import pathlib as _pl, random as _random
_CFG = re.sub(r"firebase: \{[\s\S]*?\n  \},", "firebase: null,", (_pl.Path(__file__).parent.parent / "web/config.js").read_text())
def demo_mode(ctx):
    ctx.route("**/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=_CFG))

# Kraken stand-in: steady, smooth prices for every coin and candle size, so the 1-day card and the daily history agree.
def kraken_route(route):
    u = route.request.url; pair = re.search(r"pair=([A-Z]+)", u).group(1); iv = int(re.search(r"interval=(\d+)", u).group(1)) if "interval=" in u else 1440
    base = 50 + (sum(map(ord, pair)) % 50) * 20
    px = lambda t: base * math.exp(0.03 * math.sin(t / 86400 * 2.1) + 0.004 * math.sin(t / 3600))
    step = iv * 60; end = int(time.time()) // step * step; rows = []
    for k in range(719, -1, -1):
        s0 = end - k * step; o = px(s0); c = px(min(s0 + step - 60, time.time()))
        rows.append([s0, f"{o:.6f}", f"{max(o, c):.6f}", f"{min(o, c):.6f}", f"{c:.6f}", f"{c:.6f}", "1000", 10])
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps({"error": [], "result": {pair: rows, "last": rows[-1][0]}}))
def binance_route(route):
    u = route.request.url; start = int(re.search(r"startTime=(\d+)", u).group(1)); end_ms = int(time.time() * 1000) - 729 * 86400000
    rnd = _random.Random(u); price = 30.0; rows = []; t = start
    while t < end_ms and len(rows) < 1000:
        o = price; c = o * (1 + rnd.gauss(0, 0.03)); h = max(o, c) * 1.01; l = min(o, c) * 0.99
        rows.append([t, f"{o:.6f}", f"{h:.6f}", f"{l:.6f}", f"{c:.6f}", f"{rnd.uniform(1e3, 1e6):.2f}", t + 86399999]); price = c; t += 86400000
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(rows))

def new_ctx(b, w=390, h=844, hint=False, **kw):
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=True, has_touch=True, **kw)
    if not hint: ctx.add_init_script("localStorage.setItem('pl.swipeHint','1')")  # the one-time swipe hint has its own check
    ctx.route("**/api.kraken.com/**", kraken_route); ctx.route("**/data-api.binance.vision/**", binance_route); demo_mode(ctx)
    p = ctx.new_page(); errs = []
    p.on("pageerror", lambda e: errs.append(str(e))); p.on("dialog", lambda d: d.accept())
    return ctx, p, errs

def onboard(p, name="chart_fan", first_call=False):
    """A new phone: welcome → create account (username) → first call (made or skipped)."""
    p.goto(BASE); p.wait_for_timeout(2500)
    if not p.locator("#obNew").count(): return
    p.click("#obNew"); p.wait_for_timeout(300); p.click("#obGo"); p.wait_for_timeout(300); typein(p, "#obU", name); p.wait_for_timeout(500); p.click("#obGo"); p.wait_for_timeout(2500)
    if first_call and p.locator("#obGo").count(): p.click("[data-dir='1']"); p.wait_for_timeout(200); p.click("#obGo"); p.wait_for_timeout(900); p.click("#obGo"); p.wait_for_timeout(700)
    elif p.locator("#obSkip").count(): p.click("#obSkip"); p.wait_for_timeout(600)
    p.wait_for_timeout(800)
    if p.locator("#gdSkip").count(): p.click("#gdSkip"); p.wait_for_timeout(300)  # the guide a new account sees once

def typein(p, sel, text):
    """Type the way a person does: one key at a time, so key handlers run (a plain fill skips them, and once hid a
    username box that dropped every key)."""
    p.fill(sel, ""); p.locator(sel).press_sequentially(text, delay=15)
    got = p.input_value(sel)
    if got != text: check(f"typing: {sel} shows what was typed", False, f"typed {text!r}, box shows {got!r}")

def active(p):
    return p.evaluate("(()=>{const c=document.querySelector('.card.active');return c?[c.getAttribute('aria-label'),c.dataset.view||'main',+c.dataset.i]:[null,null,-1]})()")
def demo_preds(p): return p.evaluate("JSON.parse(localStorage.getItem('pl.demoPreds')||'{}')")
def set_results(p, rs): p.evaluate("(rs)=>{const k='pl.demoPreds'; const d=JSON.parse(localStorage.getItem(k)||'{}'); d.results=rs; localStorage.setItem(k, JSON.stringify(d));}", rs)
def set_score(p, ps):  # the score is worked out by the data job; in demo mode the test puts one on the account
    p.evaluate("(ps)=>{const a=JSON.parse(localStorage.getItem('pl.demoAccount')); a.pscore=ps; localStorage.setItem('pl.demoAccount', JSON.stringify(a))}", ps)
def _iso(ms): return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms / 1000)) + ".000Z"
def fake_results(n, pub=True):
    now = time.time() * 1000; out = []
    for i in range(n):
        up = i % 3 != 0; right = i % 5 != 0; p0 = 100 + i; target = p0 * (1.02 if up else 0.98); actual = p0 * (1.015 if right == up else 0.985)
        out.append({"id": f"r{i}", "coin": "CRYPTO:" + ["BTC", "ETH", "SOL"][i % 3], "t": ["BTC", "ETH", "SOL"][i % 3], "horizon": ["1d", "1h", "30m", "1d"][i % 4], "target": target, "p0": p0, "actual": actual,
                    "status": "scored", "label": ["Close", "Spot on", "Off", "Very close"][i % 4], "pctOff": (actual / target - 1) * 100, "createdAt": _iso(now - 864e5 * (i + 2)), "resolvedAt": _iso(now - 864e5 * (i + 1)),
                    "sure": ["hunch", "fairly", "very"][i % 3], "basis": ["chart", "indicators", "news", "gut"][i % 4], "pub": pub})
    return out
def sheet_text(p): return p.inner_text("#sheet")
def close_sheet(p): p.click("#sheet [data-close]"); p.wait_for_timeout(400)

# ---------- 1. the first run: welcome, username, first call, locked in; then sign out and log in
def onboarding_test(b):
    ctx, p, errs = new_ctx(b, hint=True)
    p.goto(BASE); p.wait_for_timeout(2500)
    g = p.inner_text("#gate")
    check("start: a new phone sees the welcome screen with the tagline and two ways in", p.is_visible("#gate") and "Swipe the market" in g and "Call the move" in g and p.is_visible("#obNew") and p.is_visible("#obHave"), g[:120].replace("\n", " "))
    tabs = p.evaluate("[...document.querySelectorAll('.tabbar button')].map(b=>b.dataset.tab+':'+b.textContent.trim()).join()")
    check("start: the app's tabs are Feed, Calls and You, with the feed on the left", tabs == "feed:Feed,play:Calls,you:You", tabs)
    p.click("#obNew"); p.wait_for_timeout(300)
    h = p.inner_text("#gate")
    check("how it works: before any question, one screen says what a call is (coin and time, where the price will be, scored against the real price)", "You make calls" in h and "keeps score" in h and p.locator("#gate .ob-step").count() == 3 and "That's a call" in h and "Very close" in h and "After 10" in h and "not advice" in h and p.is_visible("#obBack"), h[:200].replace("\n", " "))
    p.click("#obGo"); p.wait_for_timeout(300)
    try: p.go_back(timeout=2500)
    except Exception: pass
    p.wait_for_timeout(400)
    check("onboarding: the phone's back steps back to How Pulse works, not out of the app", p.locator("#gate .ob-step").count() == 3)
    p.click("#obGo"); p.wait_for_timeout(300)
    check("account: only a username is asked for (no password field)", p.locator("#gate input").count() == 1 and not p.locator("#gate input[type=password]").count())
    typein(p, "#obU", "ab"); p.wait_for_timeout(450)
    check("account: a short username is refused before anything is sent", p.is_disabled("#obGo") and "3 to 20" in p.inner_text("#obUMsg"), p.inner_text("#obUMsg"))
    typein(p, "#obU", "chart_fan"); p.wait_for_timeout(500)
    check("account: a free username enables Create account", not p.is_disabled("#obGo") and "free" in p.inner_text("#obUMsg"))
    p.click("#obGo"); p.wait_for_timeout(2500)
    acct = p.evaluate("JSON.parse(localStorage.getItem('pl.demoAccount'))")
    check("account: the username is saved on the account", acct.get("username") == "chart_fan", json.dumps(acct)[:120])
    g = p.inner_text("#gate")
    check("first call: Bitcoin tomorrow; nothing is picked, Lock in waits on higher or lower, and how far isn't shown yet", "Bitcoin be tomorrow at" in g and p.is_visible("[data-dir='1']") and p.get_attribute("[data-dir='1']", "aria-pressed") == "false" and p.get_attribute("[data-dir='-1']", "aria-pressed") == "false" and p.is_disabled("#obGo") and "Pick higher or lower" in p.inner_text("#obGo") and not p.locator("#obFar [data-k]").count() and "No money involved" in g, g[:200].replace("\n", " "))
    now_px = float(re.search(r"\$([\d,.]+)", g).group(1).replace(",", ""))
    p.click("[data-dir='-1']"); p.wait_for_timeout(200)
    call = lambda: float(re.search(r"\$([\d,.]+)", p.inner_text("#obFar .pnow")).group(1).replace(",", ""))
    c1 = call(); p.click("#obFar [data-k='2']"); p.wait_for_timeout(200); c2 = call()
    check("first call: Lower shows how far (three sizes) and the call below the price; a bigger size moves it further; Lock in is on", p.locator("#obFar [data-k]").count() == 3 and "↓" in p.inner_text("#obFar .pnow") and now_px > c1 > c2 and not p.is_disabled("#obGo") and "Lock in" in p.inner_text("#obGo"), f"{now_px} {c1} {c2}")
    p.click("#obGo"); p.wait_for_timeout(1000)
    pr = demo_preds(p).get("open", [])
    check("first call: Lock in saves a 1-day Bitcoin call on the account and shows Locked in with when it's scored", len(pr) == 1 and pr[0]["horizon"] == "1d" and pr[0]["t"] == "BTC" and pr[0]["target"] < now_px and "Locked in" in p.inner_text("#gate") and "tomorrow" in p.inner_text("#gate") and p.is_visible("#obPush"), json.dumps(pr)[:160])
    p.click("#obGo"); p.wait_for_timeout(1200)
    # the guide: five cards, one idea each, once per account; no explanation of how scoring works
    g = p.inner_text("#guide") if p.locator("#guide").count() else ""
    check("guide: after the first call, a new account sees the guide (card 1 of 5, Skip and Next)", "Swipe up for the next coin" in g and p.locator("#guide .gd-dots i").count() == 5 and p.is_visible("#gdSkip") and p.is_visible("#gdNext"), g[:160].replace("\n", " "))
    seen, words = [], []
    for k in range(5): seen.append(p.inner_text("#guide .gd-h")); words.append(p.inner_text("#guide .gd-p")); p.click("#gdNext"); p.wait_for_timeout(250)
    check("guide: Next walks through the five cards and Start calling closes it", seen == ["Swipe up for the next coin", "Swipe sideways for more", "Call where it goes next", "See how you did", "Play with others"] and not p.locator("#guide").count(), str(seen))
    check("guide: it doesn't explain how scoring works", not any("score" in w.lower() for w in words), " | ".join(words))
    p.wait_for_timeout(1600)
    hint = p.inner_text(".card.active .swhint") if p.locator(".card.active .swhint").count() else ""
    p.evaluate("document.querySelector('.card.active')._go(2)"); p.wait_for_timeout(500)
    check("feed: once the guide is closed, the first coin shows a one-time hint that news and Before you call are a swipe away; a swipe clears it", "News" in hint and "Before you call" in hint and not p.locator(".card.active .swhint:not(.out)").count(), hint)
    p.evaluate("document.querySelector('.card.active')._go(1)"); p.wait_for_timeout(400)
    check("guide: it's remembered on the account and the phone", p.evaluate("JSON.parse(localStorage.getItem('pl.demoAccount')).guideSeen") == 1 and p.evaluate("localStorage.getItem('pl.guideSeen')") == "1")
    p.reload(); p.wait_for_timeout(2500)
    check("guide: it isn't shown again on the next open", not p.locator("#guide").count())
    check("first call: Explore closes the gate on the feed, on the first coin (no recap card)", not p.locator("#gate").count() and active(p)[0] == "BTC" and active(p)[2] == 0, str(active(p)))
    card = p.inner_text(".card.active")
    check("feed: the card says a call is waiting under Call it, and draws the call on the chart", "1 call waiting" in card and p.locator(".card.active .lvtag.c").count() == 1, card[:120].replace("\n", " "))
    # sign out, then log in with the username
    p.click(".tabbar [data-tab=you]"); p.wait_for_timeout(600); p.click("#youSet"); p.wait_for_timeout(600); p.click("#sheet [data-av=account]"); p.wait_for_timeout(800)
    t = p.inner_text("#profile")
    check("settings: Account shows the username and Sign out, and no password", "@chart_fan" in t and p.is_visible("#aOut") and not p.locator("#aPw").count(), t[:160].replace("\n", " "))
    p.click("#aOut"); p.wait_for_timeout(3000)
    check("sign out: the phone forgets the account and shows the welcome screen again", p.is_visible("#gate") and p.is_visible("#obHave"))
    p.click("#obHave"); p.wait_for_timeout(300)
    check("log in: only a username is asked for", p.locator("#gate input").count() == 1 and not p.locator("#gate input[type=password]").count())
    typein(p, "#obU", "chart_fan"); p.press("#obU", "Enter"); p.wait_for_timeout(1500)
    pr = demo_preds(p).get("open", [])
    check("log in: the username opens the account again, with its open call", not p.locator("#gate").count() and len(pr) == 1, json.dumps(pr)[:100])
    check("start: no JavaScript errors", not errs, " | ".join(errs[:3]))
    ctx.close()

# ---------- 2. the feed card, Call it, details and news, Your market
def feed_test(b):
    ctx, p, errs = new_ctx(b)
    onboard(p); p.wait_for_timeout(800)
    c = ".card.active"
    head = p.inner_text(f"{c} .head2")
    check("feed: the card shows the coin's name and ticker, the price and the move, with Call it under them", "Bitcoin" in head and "BTC" in head and "$" in head and "%" in head and p.is_visible(f"{c} .callit"), head.replace("\n", " "))
    check("feed: one quiet row holds the time range (1D 1W 1M 1Y) and a visible full-screen button; no ƒx or S/R on the card", p.inner_text(f"{c} .seg").split() == ["1D", "1W", "1M", "1Y"] and p.is_visible(f"{c} .rangerow .cfull") and not p.locator(f"{c} [data-fx]").count() and not p.locator(f"{c} [data-lv]").count())
    check("feed: a new player's cards show no indicator panels and no story bars; no pager dots", p.locator(f"{c} .lowers .lower").count() == 0 and not p.locator("#progress").count() and not p.locator(f"{c} .dots").count())
    rail = p.evaluate("[...document.querySelectorAll('#rail i')].map(i=>i.className)")
    check("feed: where you are in the list shows as a thin rail on the right, the current coin longer", len(rail) == 10 and rail[0] == "on" and rail.count("on") == 1, str(rail))
    p.click(f"{c} [data-range='1W']"); p.wait_for_timeout(900)
    check("feed: tapping 1W changes every card's range (one shared choice)", p.get_attribute(f"{c} [data-range='1W']", "aria-pressed") == "true" and p.evaluate("JSON.parse(localStorage.getItem('pl.demoAccount')).settings.chart.range") == "1W")
    p.click(f"{c} [data-range='1D']"); p.wait_for_timeout(900)
    # a coin with its own range follows the shared choice too (feedback 15 Oct: "didn't apply to all coins")
    p.evaluate("(async () => { const m = await import('./js/store.js'); await m.save({ settings: { ...m.store.data.settings, chartBy: { 'CRYPTO:ETH': { range: '1M', type: 'line' } } } }); })()"); p.wait_for_timeout(300)
    p.click(f"{c} [data-range='1W']"); p.wait_for_timeout(900)
    by = p.evaluate("JSON.parse(localStorage.getItem('pl.demoAccount')).settings.chartBy")
    check("feed: a range tap applies to every coin, also one with its own range (its other choices stay)", by == {"CRYPTO:ETH": {"type": "line"}}, json.dumps(by))
    p.click(f"{c} [data-range='1D']"); p.wait_for_timeout(900)
    # Call it
    p.click(f"{c} .callit"); p.wait_for_timeout(700)
    s = sheet_text(p); sl = s.lower()
    # 1.2.8: one decision per screen. 1 · the period and which way
    check("call it, step 1: just the price, the four periods and Higher / Lower (nothing else on screen)", all(x in sl for x in ["now $", "30 min", "1 hour", "1 day", "1 year", "higher", "lower"]) and not any(x in sl for x in ["how sure", "based on", "by how much", "followers", "lock in"]), s[:200].replace("\n", " "))
    now_px = float(re.search(r"Now \$([\d,.]+)", s).group(1).replace(",", "").rstrip("."))
    p.click("#sheet [data-dir='1']"); p.wait_for_timeout(400)
    s = sheet_text(p); sl = s.lower()
    check("call it, step 2: how far (three sizes with prices, usual picked), Lock in, scored when; how sure isn't asked yet", "higher in 1 day" in sl and p.locator("#sheet .csize").count() == 3 and p.get_attribute("#sheet [data-k='1']", "aria-pressed") == "true" and "usual day" in sl and "lock in $" in sl and "scored" in sl and "how sure" not in sl, s[:200].replace("\n", " "))
    p.click("#pOwnOpen"); p.wait_for_timeout(300); typein(p, "#pOwn", "2.5%"); p.wait_for_timeout(300)
    btn = p.inner_text("#pGo"); px = float(re.search(r"\$([\d,.]+)", btn).group(1).replace(",", ""))
    check("call it: typing your own move as a percentage turns it into a price, shown on the button", abs(px / now_px - 1.025) < 0.002 and p.get_attribute("#sheet [data-k='1']", "aria-pressed") == "false", f"{now_px} {btn}")
    p.click("#pGo"); p.wait_for_timeout(1200)
    pr = demo_preds(p).get("open", [])
    s = sheet_text(p).lower()
    check("call it, step 3: Lock in saves the call at once (public by default); then Locked in asks how sure and based on, both optional", len(pr) == 1 and pr[0]["horizon"] == "1d" and pr[0].get("pub") is True and abs(pr[0]["target"] / now_px - 1.025) < 0.002 and "locked in" in s and "how sure" in s and "based on" in s and p.is_visible("#pDone"), json.dumps(pr)[:200] + " | " + s[:100])
    p.click("[data-sure='very']"); p.click("[data-basis='news']"); p.wait_for_timeout(200); p.click("#pDone"); p.wait_for_timeout(800)
    pr = demo_preds(p).get("open", [])
    check("call it: the extras are added to the saved call", pr and pr[0].get("sure") == "very" and pr[0].get("basis") == "news" and not p.is_visible("#sheet"), json.dumps(pr)[:200])
    p.wait_for_timeout(600)
    check("feed: the new call shows on the card and on the chart", "1 call waiting" in p.inner_text(f"{c} .callrow2") and p.locator(f"{c} .lvtag.c").count() == 1)
    # details
    p.evaluate("document.querySelector('.card.active')._go(2)"); p.wait_for_timeout(800)
    d = p.inner_text(f"{c} .pane.details").lower()
    check("details: Before you call opens with how much the coin usually moves (30 min to 1 year), Right now, your calls and alerts", "before you call" in d and "usually moves" in d and "right now" in d and "your btc calls" in d and "1 waiting" in d and "price alerts" in d, d[:200].replace("\n", " "))
    folded = p.locator(f"{c} .folds .dsec").count() >= 5 and not p.locator(f"{c} .folds .dsec.open").count()
    p.click(f"{c} .folds .dsec:nth-child(2) > h3"); p.wait_for_timeout(300)
    check("details: the rest is folded under More about the price and opens on a tap", folded and p.locator(f"{c} .folds .dsec.open").count() == 1)
    p.evaluate("document.querySelector('.card.active')._go(0)"); p.wait_for_timeout(600); p.evaluate("document.querySelector('.card.active')._go(0)"); p.wait_for_timeout(800)
    n = p.inner_text(f"{c} .pane.news")
    check("news: the pane marks where your call was made", "Since your call" in n, n[:120].replace("\n", " "))
    # All my coins: a sheet, then the list view as a page
    p.click("#switcher"); p.wait_for_timeout(700)
    sw = sheet_text(p)
    check("coins: All my coins opens a sheet: each list with counts, a tick on the current one, See them as a list, Edit lists and coins", "Coins in your feed" in sw and "All my coins" in sw and "10 coins" in sw and p.locator("#sheet .tick").count() == 1 and p.is_visible("#swList") and p.is_visible("#swEdit") and p.is_visible("#sFeed"), sw[:200].replace("\n", " "))
    p.click("#swList"); p.wait_for_timeout(900)
    m = p.inner_text("#dash")
    check("your market: the list is a page with ‹ Feed and the list's name, how much each coin moves against usual, and sorts", p.is_visible("#sDash") and p.inner_text("#dash #dFeed").strip() == "Feed" and "All my coins" in p.inner_text("#dash h1") and p.locator("#dash .mrow").count() == 10 and "× usual" in m and "Moving most" in m, m[:160].replace("\n", " "))
    want = p.inner_text("#dash .mrow >> nth=3 >> .t")
    p.click("#dash .mrow >> nth=3"); p.wait_for_timeout(1000)
    check("your market: tapping a coin opens it in the feed", not p.is_visible("#sDash") and p.inner_text(".card.active .tk") == want, f"{want} vs {p.inner_text('.card.active .tk')}")
    check("feed: no JavaScript errors", not errs, " | ".join(errs[:3]))
    ctx.close()

# ---------- 3. the Calls tab, the replay, Wrong way, With friends
def calls_test(b):
    ctx, p, errs = new_ctx(b)
    onboard(p); p.wait_for_timeout(500)
    rs = fake_results(2)
    now = time.time() * 1000
    rs[1].update({"target": 400, "p0": 391, "actual": 385, "label": "Off", "pctOff": 3.9, "horizon": "1h", "t": "ETH", "coin": "CRYPTO:ETH", "createdAt": _iso(now - 3 * 36e5), "resolvedAt": _iso(now - 2 * 36e5)})  # called up, went down
    set_results(p, rs); p.reload(); p.wait_for_timeout(3000)
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(800)
    t = p.inner_text("#play"); tl = t.lower()
    check("calls: the header has a search button and one line on what a call is; Make a call; your record card; today, waiting, with friends and scored", p.is_visible("#plFind") and "say where a price will be" in tl and p.is_visible("#plAbout") and p.is_visible("#plMake") and "your record" in tl and "too early to tell" in tl and "2 of 10 scored calls" in tl and "today's coin" in tl and "with friends" in tl and "waiting" in tl and "scored" in tl, t[:200].replace("\n", " "))
    check("calls: everything tappable has a chevron or a button: scored rows end in a chevron, the record card says Open", p.locator("#play [data-res] .chev").count() == 2 and "Open" in p.inner_text("#plProg"))
    p.click("#plAbout"); p.wait_for_timeout(600)
    ab = sheet_text(p)
    check("calls: About your score says the three points, the note, and offers Make a call, nothing about how it's worked out", all(x in ab for x in ["Calling the right direction matters.", "Getting close to the real price matters too.", "One call can be luck. Your record shows skill over many calls: it starts to count after 10.", "Every call builds your record.", "The more you call, the sooner your skill shows, and the more your score says about you."]) and p.is_visible("#abMake") and "refin" not in ab.lower() and "typical" not in ab.lower(), ab[:300].replace("\n", " "))
    p.click("#abMake"); p.wait_for_timeout(600)
    pk = sheet_text(p)
    p.click("#sheet [data-cp='0']"); p.wait_for_timeout(600)
    check("calls: Make a call lists your coins; picking one opens Call it for that coin, with Higher, Lower and No change", "Make a call" in pk and p.locator("#sheet [data-dir]").count() == 3 and p.is_visible("#sheet .cflat") and "Call " in p.inner_text("#shTitle"), pk[:120].replace("\n", " "))
    p.click("#sheet [data-dir='0']"); p.wait_for_timeout(300)
    s0 = sheet_text(p)
    check("call it: No change skips how far and locks in the price shown", "no change" in p.inner_text("#pGo").lower() and not p.locator("#sheet .csize").count() and "close to today's price" in s0, s0[:160].replace("\n", " "))
    p.click("#pGo"); p.wait_for_timeout(1200)
    pr = [x for x in demo_preds(p).get("open", []) if x.get("target") == x.get("clientP0")]
    check("call it: a No change call is saved with the price shown as its target", len(pr) == 1, json.dumps(demo_preds(p).get("open", []))[:200])
    p.click("#pDone"); p.wait_for_timeout(500)
    check("calls: a call that went the wrong way is labelled Wrong way", "Wrong way" in t)
    p.click("#play [data-res='0']"); p.wait_for_timeout(1500)
    s = sheet_text(p)
    check("replay: a scored call opens as a replay: label, direction, the price path, the three prices and what happened", "Wrong way" in s and "You called up, it went down" in s and p.locator("#rpChart svg").count() == 1 and "Price when you called" in s and "Your call" in s and "Price at the end" in s, s[:200].replace("\n", " "))
    close_sheet(p)
    p.click("#plProg"); p.wait_for_timeout(600)
    lit = p.get_attribute(".tabbar [data-tab=play]", "aria-current")
    check("calls: the progress card opens Your record over Calls (‹ Calls), and Calls stays lit", p.is_visible("#sRecord") and "where you stand" in p.inner_text("#record").lower() and p.inner_text("#record #pBack").strip() == "Calls" and lit == "page")
    p.click("#record #pBack"); p.wait_for_timeout(500)
    check("record: back returns to Calls", not p.is_visible("#sRecord") and p.is_visible("#sPlay"))
    p.click("#plFriends"); p.wait_for_timeout(500)
    f = p.inner_text("#friends").lower()
    check("with friends: the hub explains groups, offers Start a group and Join with a link, and shared lists", "with friends" in f and p.is_visible("#plNewG") and p.is_visible("#plJoinG") and "shared lists" in f and p.is_visible("#plNewL"), f[:160].replace("\n", " "))
    p.click("#friends #pBack"); p.wait_for_timeout(500)
    check("with friends: Back returns to Calls", not p.is_visible("#sFriends") and "Today's coin" in p.inner_text("#play"))
    check("calls: no JavaScript errors", not errs, " | ".join(errs[:3]))
    ctx.close()

# ---------- 4. You: verdicts, score, levels, breakdowns, Learn, settings
def you_test(b):
    ctx, p, errs = new_ctx(b)
    onboard(p); p.wait_for_timeout(500)
    p.click(".tabbar [data-tab=you]"); p.wait_for_timeout(700)
    y = p.inner_text("#you")
    check("you: with no calls, You says to make the first one, the score waits at 550 and the breakdowns are locked until level 3", "Make your first call" in y and "550" in y and "Opens at level 3" in y and "Level 0" in y, y[:160].replace("\n", " "))
    set_results(p, fake_results(9)); set_score(p, {"score": 561, "band": "Building", "n": 9, "provisional": True, "v": 2, "flag": None, "held": False}); p.reload(); p.wait_for_timeout(3000); p.click(".tabbar [data-tab=you]"); p.wait_for_timeout(700)
    y = p.inner_text("#you")
    check("you: with 9 calls it's Too early to tell, the score is provisional and the right-direction tiles show counts", "Too early to tell" in y and "9 calls so far" in y and "Provisional" in y and "of 9 calls" in y and "Level 1" in y, y[:200].replace("\n", " "))
    p.evaluate("localStorage.setItem('pl.level', '1')"); set_results(p, fake_results(40)); set_score(p, {"score": 668, "band": "Proven", "n": 40, "provisional": False, "v": 2, "flag": "always up", "held": True, "was": {"score": 702, "v": 1}}); p.reload(); p.wait_for_timeout(3500)
    lv = sheet_text(p) if p.is_visible("#sheet") else ""
    check("levels: going up a level shows the level-up sheet with what it opens", "Level up" in lv and "Level 3" in lv and "30 calls scored" in lv and "breakdowns" in lv, lv[:160].replace("\n", " "))
    if p.is_visible("#sheet"): close_sheet(p)
    p.click(".tabbar [data-tab=you]"); p.wait_for_timeout(700)
    y = p.inner_text("#you")
    check("you: with 40 calls and a Proven score the verdict is Reading it well; the score shows its band and no range; the breakdowns open", "reading it well" in y and "668" in y and "Proven" in y and "likely range" not in y.lower() and "Does being sure help" in y and "What works for you" in y and "By time period" in y and "Level 3" in y, y[:200].replace("\n", " "))
    check("you: quiet lines under the score: progress held, and a pattern named in plain words", "Some of your progress is held until your record is longer." in y and "Most of your calls are up." in y)
    check("you: a one-time note says the score was worked out again from all calls, with the old number", "worked out again from all your scored calls" in y and "702" in y)
    p.click("#you [data-v2ok]"); p.wait_for_timeout(300); p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(300); p.click(".tabbar [data-tab=you]"); p.wait_for_timeout(500)
    check("you: Got it hides the note for good", "worked out again" not in p.inner_text("#you"))
    y = p.inner_text("#you")
    check("you: Where you rank lists Everyone, People you follow and Find players; no How the score works explainer", "Where you rank" in y and "Everyone" in y and "People you follow" in y and p.is_visible("#rkFind") and "How the score works" not in y)
    p.click("#youLearn"); p.wait_for_timeout(600)
    l = p.inner_text("#profile")
    check("learn: six short reads on what a score doesn't show", "Before you put money in" in l and p.locator("#profile .dsec.read").count() == 6 and "Leverage" in l, l[:120].replace("\n", " "))
    p.click("#profile #pBack"); p.wait_for_timeout(500)
    check("learn: Back returns to You", p.is_visible("#sYou") and not p.is_visible("#sProfile"))
    # settings: public calls default
    p.click("#youSet"); p.wait_for_timeout(600)
    s = sheet_text(p)
    check("settings: has the public-calls default, Account (sign out), and no password or tour", "My scored calls are public" in s and "sign out" in s and "password" not in s.lower() and "tour" not in s.lower(), s[:200].replace("\n", " "))
    check("settings: How Pulse works is in Settings", "How Pulse works" in s)
    p.click("#sheet [data-av=guide]"); p.wait_for_timeout(500)
    check("settings: How Pulse works opens the guide again", p.locator("#guide").count() == 1 and "Swipe up" in p.inner_text("#guide"))
    p.click("#gdSkip"); p.wait_for_timeout(300); p.click("#youSet"); p.wait_for_timeout(600)
    p.click("#avCalls"); p.wait_for_timeout(400)
    check("settings: switching public calls off is saved as the default for new calls", p.evaluate("JSON.parse(localStorage.getItem('pl.demoAccount')).callsPublic") is False)
    check("you: no JavaScript errors", not errs, " | ".join(errs[:3]))
    ctx.close()

# ---------- 5. people: search (most followed), player cards, following, public calls, groups end to end
def people_test(b):
    ctx, p, errs = new_ctx(b)
    onboard(p); p.wait_for_timeout(500)
    social = lambda: p.evaluate("JSON.parse(localStorage.getItem('pl.demoSocial')||'{}')")
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(600); p.click("#plFind"); p.wait_for_timeout(900)
    s = sheet_text(p).lower()
    check("find players: before typing, the most-followed public accounts show with score, followers and a Follow button", "most followed" in s and "1,204 followers" in s and p.locator("#fpRes [data-f]").count() >= 5 and "open calls are never shown" in s, s[:160].replace("\n", " "))
    typein(p, "#fpIn", "ro"); p.wait_for_timeout(700)
    check("find players: typing searches usernames", "@rohan" in sheet_text(p) and "most followed" not in sheet_text(p).lower())
    p.click("#fpRes [data-a]"); p.wait_for_timeout(900)
    s = sheet_text(p)
    check("player card: level, followers, a verdict, the score with its band, right direction and close or better, Scored calls and Follow", "@rohan" in s and "Level" in s and "follower" in s and "Proven" in s and "likely" not in s and "Right direction" in s and "Close or better" in s and "Scored calls, public" in s and p.is_visible("#pcFollow"), s[:200].replace("\n", " "))
    p.click("#pcCalls"); p.wait_for_timeout(700)
    check("public calls: before following, a player's calls stay hidden", "Follow @rohan to see" in sheet_text(p), sheet_text(p)[:100])
    close_sheet(p)
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(300); p.click("#plFind"); p.wait_for_timeout(700); typein(p, "#fpIn", "ro"); p.wait_for_timeout(600); p.click("#fpRes [data-a]"); p.wait_for_timeout(800)
    p.click("#pcFollow"); p.wait_for_timeout(600)
    check("follow: Follow adds the player to my private following list", "demo_rohan" in p.evaluate("JSON.parse(localStorage.getItem('pl.demoAccount')).following") and "Following" in p.inner_text("#pcFollow"))
    p.click("#pcCalls"); p.wait_for_timeout(900)
    s = sheet_text(p)
    check("public calls: after following, their public scored calls list with what was called, from what, and the label; never an open call", "scored calls" in s and "called $" in s and "from $" in s and "Open calls are never shown" in s and p.locator("#sheet [data-pc]").count() >= 1, s[:200].replace("\n", " "))
    p.click("#sheet [data-pc] >> nth=0"); p.wait_for_timeout(1200)
    check("public calls: a call opens as a replay", "Price when you called" in sheet_text(p) and p.locator("#rpChart").count() == 1)
    close_sheet(p)
    # groups end to end (demo mode: three made-up friends join every group you start and pick too)
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(400); p.click("#plFriends"); p.wait_for_timeout(500)
    p.click("#plNewG"); p.wait_for_timeout(500); typein(p, "#ngIn", "Weekend crew"); p.click("#ngGo"); p.wait_for_timeout(1300)
    st = social(); gid = next(iter(st.get("groups", {})), None); grp = st["groups"].get(gid, {}) if gid else {}
    check("groups: a new group records who started it and opens on its own page with a link to share", grp.get("owner") == "me" and grp.get("members", {}).get("me") == "chart_fan" and p.is_visible("#grp") and p.is_visible("#grShare") and p.is_visible("#grNew"), json.dumps(grp)[:160])
    p.click("#grNew"); p.wait_for_timeout(600); p.click("#sheet [data-h='1h']"); p.wait_for_timeout(300)
    hi = float(re.search(r"\$([\d,.]+)", p.inner_text("#sheet .pnow")).group(1).replace(",", ""))  # the price now
    typein(p, "#cIn", f"{hi * 1.01:.4f}"); p.wait_for_timeout(200); p.click("#cGo"); p.wait_for_timeout(1500)
    st = social(); ch = (st.get("ch", {}).get(gid) or [{}])[0]
    check("challenge: starting one is the first pick, the friends pick too, and it ends an hour later for everyone", ch.get("horizon") == "1h" and sorted(ch.get("picked", {}).values()) == ["asha", "chart_fan", "dev", "rohan"], json.dumps(ch)[:200])
    p.click("#grBack"); p.wait_for_timeout(500)
    check("groups: Back closes the group page onto Calls, where the group shows", not p.is_visible("#grp") and "Weekend crew" in p.inner_text("#play"))
    check("people: no JavaScript errors", not errs, " | ".join(errs[:3]))
    ctx.close()

# ---------- 6. indicators (1.3.2): ƒx and S/R in full screen; up to 2 panels on the feed, chosen there
def charts_test(b):
    ctx, p, errs = new_ctx(b)
    onboard(p); p.wait_for_timeout(800)
    acct = lambda: p.evaluate("JSON.parse(localStorage.getItem('pl.demoAccount')).settings.chart")
    p.click(".card.active [data-full]"); p.wait_for_timeout(1200)
    check("full screen: ƒx and S/R are here, with the panels chosen (none on the feed yet)", p.is_visible("#full [data-ffx]") and p.is_visible("#full [data-flv]") and p.locator("#full .flowers .lower").count() == 2 and not p.locator("#full .onfeed").count())
    p.click("#full [data-ffx]"); p.wait_for_timeout(600)
    s0 = sheet_text(p)
    fits = lambda: p.evaluate("[...document.querySelectorAll('#sheet .fxseg button')].every((x) => x.scrollWidth <= x.clientWidth + 1 && x.getBoundingClientRect().right <= innerWidth)")
    tabs = p.inner_text("#sheet .fxseg").replace("\n", " ")
    p.set_viewport_size({"width": 320, "height": 640}); p.wait_for_timeout(300); narrow = fits(); p.set_viewport_size({"width": 390, "height": 844}); p.wait_for_timeout(300)
    check("indicators: the Panels and Lines tabs fit their box, also on a 320-pixel phone (feedback 23 Oct)", re.search(r"Panels \d/\d", tabs) and "Lines on price" in tabs and fits() and narrow, tabs)
    p.click("#sheet [data-sfeed='RSI']"); p.wait_for_timeout(300)
    s1 = sheet_text(p)
    check("indicators: each shown panel has + Feed; tapping it puts the panel on the feed (1 of 2)", "+ Feed" in s0 and "On your feed: 0 of 2" in s0 and p.get_attribute("#sheet [data-sfeed='RSI']", "aria-pressed") == "true" and "On your feed: 1 of 2" in s1, s1[:200].replace("\n", " "))
    p.check("#sheet [data-stog='VOL']"); p.wait_for_timeout(300); p.click("#sheet [data-sfeed='MACD']"); p.wait_for_timeout(300)
    s2 = sheet_text(p)
    check("indicators: with 2 on the feed, the other + Feed buttons go grey and the sheet says to turn one off", "On your feed: 2 of 2. Turn one off to add another." in s2 and p.is_disabled("#sheet [data-sfeed='VOL']"), s2[:200].replace("\n", " "))
    p.uncheck("#sheet [data-stog='RSI']"); p.wait_for_timeout(300)
    ch = acct()
    check("indicators: turning a panel off also takes it off the feed; the choice is saved on the account", "On your feed: 1 of 2" in sheet_text(p) and ch.get("feed") == "MACD" and "RSI" not in ch.get("lower", ""), json.dumps(ch)[:200])
    close_sheet(p); p.wait_for_timeout(500)
    check("full screen: a panel that's also on the feed is tagged On feed", p.locator("#full .onfeed").count() == 1)
    p.click("#full [data-fclose]"); p.wait_for_timeout(1000)
    check("feed: the card shows the one panel chosen for the feed", p.locator(".card.active .lowers .lower").count() == 1 and p.get_attribute(".card.active .lowers .lower", "data-learn") == "MACD")
    # someone from before 1.3.2 keeps the panels their cards showed
    p.evaluate("(()=>{const a=JSON.parse(localStorage.getItem('pl.demoAccount')); a.settings.chart.lower='RSI,MACD,VOL'; delete a.settings.chart.feed; localStorage.setItem('pl.demoAccount', JSON.stringify(a))})()")
    p.reload(); p.wait_for_timeout(3000)
    kinds = p.evaluate("[...document.querySelectorAll('.card.active .lowers .lower')].map(x=>x.dataset.learn)")
    check("feed: an existing player keeps their panels on the feed (up to 2) without being asked", kinds == ["RSI", "MACD"], str(kinds))
    check("charts: no JavaScript errors", not errs, " | ".join(errs[:3]))
    ctx.close()

# ---------- 7. back everywhere (1.3.0): the phone's back closes the top sheet or page and never leaves the app from one
def nav_test(b):
    ctx, p, errs = new_ctx(b)
    onboard(p); p.wait_for_timeout(500)
    set_results(p, fake_results(3)); p.reload(); p.wait_for_timeout(3000)
    if p.is_visible("#sheet"): close_sheet(p)
    here = lambda: p.evaluate("location.href")
    start = here()
    def phone_back():
        try: p.go_back(timeout=2500)
        except Exception: pass
        p.wait_for_timeout(500)
    p.click(".card.active .callit"); p.wait_for_timeout(600)
    phone_back()
    check("back: the phone's back closes a sheet and stays in the app", not p.is_visible("#sheet") and here() == start and p.is_visible("#sFeed"))
    p.click("#switcher"); p.wait_for_timeout(600); p.click("#swList"); p.wait_for_timeout(700)
    open_ok = p.is_visible("#sDash") and "Feed" in p.inner_text("#dash #dFeed")
    phone_back()
    check("back: the coins list slides in with ‹ Feed, and the phone's back closes it", open_ok and not p.is_visible("#sDash") and p.is_visible("#sFeed") and here() == start)
    p.click(".card.active [data-full]"); p.wait_for_timeout(900)
    full_ok = p.is_visible("#full") and p.is_visible("#full [data-fclose]")
    phone_back()
    check("back: the full-screen chart has a close button, and the phone's back closes it", full_ok and not p.is_visible("#full"), str(full_ok))
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(600)
    p.click("#plProg"); p.wait_for_timeout(600)
    rec = p.is_visible("#sRecord")
    phone_back()
    check("back: Your record closes with the phone's back, back on Calls", rec and not p.is_visible("#sRecord") and p.is_visible("#sPlay"))
    # page, then a sheet on it, then back twice
    p.click("#plFriends"); p.wait_for_timeout(500); p.click("#plNewG"); p.wait_for_timeout(500)
    both = p.is_visible("#sFriends") and p.is_visible("#sheet")
    phone_back(); one = p.is_visible("#sFriends") and not p.is_visible("#sheet")
    phone_back()
    check("back: a sheet over a page closes first, then the page", both and one and not p.is_visible("#sFriends") and p.is_visible("#sPlay"), f"{both} {one}")
    # group page
    p.click("#plFriends"); p.wait_for_timeout(500); p.click("#plNewG"); p.wait_for_timeout(500); typein(p, "#ngIn", "Backers"); p.click("#ngGo"); p.wait_for_timeout(1300)
    g = p.is_visible("#grp")
    phone_back(); g1 = not p.is_visible("#grp") and p.is_visible("#sFriends")
    phone_back()
    check("back: the group page closes with the phone's back, then With friends", g and g1 and not p.is_visible("#sFriends"), f"{g} {g1}")
    # settings page from the Settings sheet returns to the sheet
    p.click(".tabbar [data-tab=you]"); p.wait_for_timeout(600); p.click("#youSet"); p.wait_for_timeout(500); p.click("#sheet [data-av=appearance]"); p.wait_for_timeout(600)
    lab = p.inner_text("#profile #pBack").strip() if p.is_visible("#sProfile") else ""
    phone_back()
    check("back: a settings page says ‹ Settings and back reopens the Settings sheet", lab == "Settings" and not p.is_visible("#sProfile") and "Settings" in (p.inner_text("#shTitle") if p.is_visible("#sheet") else ""), lab)
    close_sheet(p)
    # nothing left open: history is back where it started, and a tab tap closes any page
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(500); p.click("#plProg"); p.wait_for_timeout(500); p.click(".tabbar [data-tab=you]"); p.wait_for_timeout(700)
    check("back: tapping a tab closes the page on top", not p.is_visible("#sRecord") and p.is_visible("#sYou"))
    p.wait_for_timeout(300)
    check("back: with everything closed, no extra history entries are left behind", p.evaluate("history.state") in (None, {}) and here() == start, json.dumps(p.evaluate("history.state")))
    check("back: no JavaScript errors", not errs, " | ".join(errs[:3]))
    ctx.close()

# ---------- 8. every screen at common phone sizes, sideways, desktop and the light theme: nothing wider than the screen
def screens_test(b):
    sizes = [(320, 640, False, "dark"), (360, 780, False, "dark"), (390, 844, False, "light"), (430, 932, False, "dark"), (844, 390, False, "dark"), (1280, 800, True, "light")]
    over = """((sel)=>{const W=innerWidth, bad=[]; const root=document.querySelector(sel); if(!root) return ['missing '+sel];
      if (document.documentElement.scrollWidth>W+1) bad.push('page '+document.documentElement.scrollWidth);
      for (const e of root.querySelectorAll('*')) { const r=e.getBoundingClientRect(); if(!r.width||!r.height) continue;
        let p=e.parentElement, clipped=false; while(p&&p!==document.body){const s=getComputedStyle(p); if(/(auto|scroll|hidden)/.test(s.overflowX)&&p.scrollWidth>p.clientWidth+1){clipped=true;break;} p=p.parentElement;}
        if(!clipped&&(r.right>W+1||r.left<-1)) bad.push((e.id||e.className||e.tagName)+' '+Math.round(r.left)+'..'+Math.round(r.right)); }
      return bad.slice(0,5);})"""
    for w, h, desk, theme in sizes:
        ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=not desk, has_touch=not desk, color_scheme=theme)
        ctx.route("**/api.kraken.com/**", kraken_route); ctx.route("**/data-api.binance.vision/**", binance_route); demo_mode(ctx)
        p = ctx.new_page(); errs = []; p.on("pageerror", lambda e: errs.append(str(e))); p.on("dialog", lambda d: d.accept())
        p.goto(BASE); p.wait_for_timeout(2000)
        bad = {"welcome": p.evaluate(over, "#gate")}
        p.click("#obNew"); p.wait_for_timeout(300); bad["how it works"] = p.evaluate(over, "#gate"); p.click("#obGo"); p.wait_for_timeout(300); bad["create"] = p.evaluate(over, "#gate")
        typein(p, "#obU", "sizer"); p.wait_for_timeout(500); p.click("#obGo"); p.wait_for_timeout(2500)
        if p.locator("#obFar").count(): p.click("[data-dir='1']"); p.wait_for_timeout(200); bad["first call"] = p.evaluate(over, "#gate"); p.evaluate("document.querySelector('#obSkip').click()")
        p.wait_for_timeout(1000)
        if p.locator("#guide").count(): bad["guide"] = p.evaluate(over, "#guide"); p.click("#gdSkip"); p.wait_for_timeout(300)
        if theme == "light":
            p.evaluate("(()=>{const a=JSON.parse(localStorage.getItem('pl.demoAccount')); a.settings.theme='light'; localStorage.setItem('pl.demoAccount', JSON.stringify(a))})()")
        set_results(p, fake_results(12)); p.reload(); p.wait_for_timeout(3000)
        if p.is_visible("#sheet"): close_sheet(p)
        tag = f"{w}x{h}{' desktop' if desk else ''} {theme}"
        bad["feed card"] = p.evaluate(over, ".card.active")
        p.click(".card.active .callit"); p.wait_for_timeout(600); bad["call it"] = p.evaluate(over, "#sheet"); close_sheet(p)
        p.evaluate("document.querySelector('.card.active')._go(2)"); p.wait_for_timeout(600); bad["details"] = p.evaluate(over, ".card.active .pane.details")
        p.click("#switcher"); p.wait_for_timeout(600); bad["coins sheet"] = p.evaluate(over, "#sheet"); p.click("#swList"); p.wait_for_timeout(700); bad["your market"] = p.evaluate(over, "#dash")
        p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(600); bad["calls"] = p.evaluate(over, "#play")
        p.click("#play [data-res='0']"); p.wait_for_timeout(1200); bad["replay"] = p.evaluate(over, "#sheet"); close_sheet(p)
        p.click("#plFind"); p.wait_for_timeout(800); bad["find players"] = p.evaluate(over, "#sheet"); close_sheet(p)
        p.click("#plFriends"); p.wait_for_timeout(500); bad["with friends"] = p.evaluate(over, "#friends")
        p.click("#plNewG"); p.wait_for_timeout(500); typein(p, "#ngIn", "A group with a long name"); p.click("#ngGo"); p.wait_for_timeout(1200); bad["group page"] = p.evaluate(over, "#grp")
        foot = p.evaluate("(()=>{const f=document.querySelector('#grp .grp-f'); if(!f) return 'missing'; const r=f.getBoundingClientRect(); return r.bottom<=innerHeight+1 && r.top>=0 ? 'ok' : r.top+'..'+r.bottom})()")
        p.click("#grBack"); p.wait_for_timeout(500)
        p.click(".tabbar [data-tab=you]"); p.wait_for_timeout(700); bad["you"] = p.evaluate(over, "#you")
        p.click("#youSet"); p.wait_for_timeout(500); bad["settings"] = p.evaluate(over, "#sheet"); p.click("#sheet [data-av=account]"); p.wait_for_timeout(600); bad["account"] = p.evaluate(over, "#profile")
        tabs = p.evaluate("(()=>{const t=document.querySelector('.tabbar').getBoundingClientRect(); return t.bottom<=innerHeight+1 && t.right<=innerWidth+1})()")
        if theme == "light": check(f"screens {tag}: the light theme is on", p.get_attribute("html", "data-theme") == "light")
        bad = {k: v for k, v in bad.items() if v}
        check(f"screens {tag}: onboarding, feed, Call it, details, Your market, Calls, replay, people, groups, You and settings fit the screen", not bad, json.dumps(bad)[:400])
        check(f"screens {tag}: the group page's button and the tab bar stay on screen", foot == "ok" and tabs, f"{foot} {tabs}")
        check(f"screens {tag}: no JavaScript errors", not errs, " | ".join(errs[:3]))
        ctx.close()

def ios_homescreen_test(b):
    # Simulates the iOS Home Screen bug: the page is laid out 56 px shorter than the screen.
    ctx = b.new_context(viewport={"width": 390, "height": 788}, is_mobile=True, has_touch=True,
                        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")
    ctx.add_init_script("Object.defineProperty(navigator,'standalone',{get:()=>true}); Object.defineProperty(screen,'height',{get:()=>844}); Object.defineProperty(screen,'width',{get:()=>390});")
    ctx.route("**/api.kraken.com/**", kraken_route); ctx.route("**/data-api.binance.vision/**", binance_route); demo_mode(ctx)
    p = ctx.new_page(); p.goto(BASE); p.wait_for_timeout(1500)
    r = p.evaluate("(()=>{const t=document.querySelector('.tabbar').getBoundingClientRect(), l=[...document.querySelectorAll('.tabbar button')].map(b=>b.getBoundingClientRect().bottom); return [t.bottom, innerHeight, Math.max(...l)]})()")
    check("iOS Home Screen: the tab bar and its labels sit fully inside the visible area (nothing pushed below it)", abs(r[0] - r[1]) < 1 and r[2] <= r[1] + 0.5, str(r))
    ctx.close()

if __name__ == "__main__":
    with sync_playwright() as pw:
        b = pw.chromium.launch(**({"executable_path": CHROME} if CHROME else {}))
        only = set(filter(None, __import__("os").environ.get("ONLY", "").split(",")))  # e.g. ONLY=nav,calls while working on them
        for name, fn in [("start", onboarding_test), ("feed", feed_test), ("calls", calls_test), ("you", you_test), ("people", people_test), ("charts", charts_test), ("nav", nav_test), ("screens", screens_test), ("iOS Home Screen", ios_homescreen_test)]:
            if only and name not in only: continue
            try: fn(b)
            except Exception as e: check(f"{name}: suite ran to the end", False, repr(e)[:300])
        b.close()

    fails = [r for r in results if not r[1]]
    print(f"e2e: {len(results) - len(fails)}/{len(results)} checks passed")
    sys.exit(1 if fails else 0)
