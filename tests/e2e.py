"""End-to-end tests for the Pulse web app in demo mode.
Run:  cd web && python3 -m http.server 8773   (in another terminal)
      python3 tests/e2e.py [base_url]
Needs Python Playwright and Chromium. Prints a PASS/FAIL line per check and exits non-zero on any failure.
"""
import sys, time, json, re
from playwright.sync_api import sync_playwright

VERBOSE = "-v" in sys.argv
ARGS = [a for a in sys.argv[1:] if a != "-v"]
BASE = ARGS[0] if ARGS else "http://localhost:8773/"
CHROME = "/opt/pw-browsers/chromium"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    if VERBOSE or not ok:
        print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)

ORDER = ["BTC", "ETH", "BNB", "XRP", "SOL", "TRX", "ZEC", "HYPE", "DOGE", "LINK"]
COINS = set(ORDER)

# Kraken stand-in: the test browser has no internet, so every coin gets 2 years of made-up daily candles.
import json as _json, random as _random, re as _re
# The test browser can't reach Firebase, so the app is served with Firebase switched off (demo mode).
import pathlib as _pl
_CFG = _re.sub(r"firebase: \{[\s\S]*?\n  \},", "firebase: null,", (_pl.Path(__file__).parent.parent / "web/config.js").read_text())
def demo_mode(ctx):
    ctx.route("**/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=_CFG))

def kraken_route(route):
    pair = _re.search(r"pair=([A-Z]+)", route.request.url).group(1)
    iv = int(_re.search(r"interval=(\d+)", route.request.url).group(1)) if "interval=" in route.request.url else 1440
    rnd = _random.Random(pair + str(iv)); price = rnd.uniform(0.2, 900); rows = []
    step, count = (iv * 60, 400 if iv == 10080 else 720 if iv != 1440 else 730); t0 = (int(time.time()) // step * step if iv < 1440 else 1791504000) - (count - 1) * step  # intraday candles run up to now
    for k in range(count):
        o = price; c = o * (1 + rnd.gauss(0, 0.03)); h = max(o, c) * (1 + abs(rnd.gauss(0, 0.01))); l = min(o, c) * (1 - abs(rnd.gauss(0, 0.01)))
        rows.append([t0 + k * step, f"{o:.6f}", f"{h:.6f}", f"{l:.6f}", f"{c:.6f}", f"{c:.6f}", f"{rnd.uniform(1e3, 1e6):.2f}", 100]); price = c
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=_json.dumps({"error": [], "result": {pair: rows, "last": rows[-1][0]}}))

def binance_route(route):
    u = route.request.url; start = int(_re.search(r"startTime=(\d+)", u).group(1)); end_ms = 1791504000000 - 729 * 86400000
    rnd = _random.Random(u); price = 30.0; rows = []
    t = start
    while t < end_ms and len(rows) < 1000:
        o = price; c = o * (1 + rnd.gauss(0, 0.03)); h = max(o, c) * 1.01; l = min(o, c) * 0.99
        rows.append([t, f"{o:.6f}", f"{h:.6f}", f"{l:.6f}", f"{c:.6f}", f"{rnd.uniform(1e3, 1e6):.2f}", t + 86399999]); price = c; t += 86400000
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=_json.dumps(rows))

def active(p):
    return p.evaluate("(()=>{const c=document.querySelector('.card.active');return c?[c.getAttribute('aria-label'),c.dataset.view||'main',+c.dataset.i]:[null,null,-1]})()")

def pass_gate(p, name="chart_fan", three_months=True):
    """A new account must choose a username first; fill it in and continue (then use 3-month daily charts, as these checks expect)."""
    if p.locator("#gate").count():
        p.fill("#gIn", name); p.wait_for_timeout(400); p.click("#gGo"); p.wait_for_timeout(600)
    if three_months:
        p.evaluate("(()=>{const a=JSON.parse(localStorage.getItem('pl.demoAccount')); a.settings.chart={...a.settings.chart, range:'3M', v6:1}; localStorage.setItem('pl.demoAccount', JSON.stringify(a))})()")
        p.reload(); p.wait_for_timeout(2500)

def full_range(p, r):
    p.click("#full [data-frange]"); p.wait_for_timeout(350); p.click(f".sheet [data-fr='{r}']")

def phone_tests(b):
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.route("https://api.kraken.com/**", kraken_route); ctx.route("https://data-api.binance.vision/**", binance_route); demo_mode(ctx)
    ctx.add_init_script(NOCOACH)  # the guided tour has its own test
    p = ctx.new_page(); errs = []
    p.on("pageerror", lambda e: errs.append(str(e)))
    p.goto(BASE); p.wait_for_timeout(2500)
    gate = p.locator("#gate").count() == 1 and p.is_visible("#gate")
    p.fill("#gIn", "ab"); p.wait_for_timeout(400); g_bad = p.inner_text("#gMsg"); g_dis = p.is_disabled("#gGo")
    gtxt = p.inner_text("#gate")
    p.fill("#gIn", "chart_fan"); p.wait_for_timeout(400); p.click("#gGo"); p.wait_for_timeout(700)
    check("phone: a new account must pick a username first, told it can be changed only twice", gate and "3 to 20" in g_bad and g_dis and "2 times" in gtxt and not p.locator("#gate").count(), f"gate={gate} {g_bad} disabled={g_dis}")
    # cards open on 1 day of 15-minute candles, and the move next to the name is over that range
    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1500)
    d_tf = p.get_attribute(".card.active [data-tf]", "aria-label"); d_chg = p.inner_text(".card.active .tkrow .chg")
    check("phone: cards open on 1D (15-minute candles) and the % beside the name says it's the 1D move", "1D" in d_tf and "15-min" in d_tf and p.inner_text(".card.active [data-tf]").strip() == "1D" and d_chg.strip().endswith("1D"), f"{d_tf} / {d_chg}")
    # the rest of these checks were written for 3 months of daily candles
    p.evaluate("(()=>{const a=JSON.parse(localStorage.getItem('pl.demoAccount')); a.settings.chart={...a.settings.chart, range:'3M', v6:1}; localStorage.setItem('pl.demoAccount', JSON.stringify(a))})()")
    p.reload(); p.wait_for_timeout(2500)
    cdp = ctx.new_cdp_session(p)

    def swipe(x0, y0, x1, y1, steps=12, dur=0.25, settle=900):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0}]})
        for i in range(1, steps + 1):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + (x1 - x0) * i / steps, "y": y0 + (y1 - y0) * i / steps}]})
            time.sleep(dur / steps)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        p.wait_for_timeout(settle)
    up = lambda: swipe(200, 620, 200, 200)
    down = lambda: swipe(200, 220, 200, 640)
    left = lambda: swipe(330, 560, 50, 560, 10, 0.2, 700)   # finger moves left → details
    right = lambda: swipe(50, 560, 330, 560, 10, 0.2, 700)  # finger moves right → news

    check("phone: app loads on the welcome card", active(p)[0] == "catchup", str(active(p)))
    seen = []
    for name in ORDER:
        up(); seen.append(active(p)[0])
    check("phone: swipe up visits every symbol in order", seen == ORDER, str(seen))
    up(); check("phone: caught-up card after the last symbol", active(p)[0] == "done", str(active(p)))
    up(); check("phone: feed loops back to the first symbol", active(p)[0] == ORDER[0], str(active(p)))
    down(); check("phone: swipe down goes back", active(p)[0] == "done", str(active(p)))

    # quick swipes: a second swipe while the first is still gliding must count, with no tap in between
    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1200)
    start = active(p)[2]
    swipe(200, 620, 200, 200, settle=120); swipe(200, 620, 200, 200, settle=120); swipe(200, 620, 200, 200, settle=1000)
    check("phone: three quick swipes in a row move three cards", active(p)[2] == start + 3, f"{start} -> {active(p)}")
    # the card glides into place (at least ~0.3 s) instead of jumping
    g0 = p.evaluate("document.getElementById('feed').scrollTop/document.getElementById('feed').clientHeight")
    swipe(200, 620, 200, 200, settle=120); mid = p.evaluate("document.getElementById('feed').scrollTop/document.getElementById('feed').clientHeight"); p.wait_for_timeout(900)
    end = p.evaluate("document.getElementById('feed').scrollTop/document.getElementById('feed').clientHeight")
    check("phone: cards glide into place rather than jump", round(end) == round(g0) + 1 and abs(mid - end) > 0.03, f"start={g0:.2f} at120ms={mid:.2f} end={end:.2f}")
    # nothing on the page is rewritten while a swipe is moving it (that is what makes phones drop the next swipe)
    p.evaluate("""(()=>{const i=+document.querySelector('.card.active').dataset.i, c=document.querySelectorAll('.card')[i+3]; c.innerHTML=''; delete c.dataset.filled})()""")
    p.evaluate("""window.__mut=0; window.__mo=new MutationObserver(m=>{window.__mut+=m.length}); window.__mo.observe(document.getElementById('feed'),{childList:true,subtree:true})""")
    a0 = active(p)[2]; swipe(200, 620, 200, 200, settle=60); during = p.evaluate("window.__mut"); p.wait_for_timeout(900); later = p.evaluate("window.__mut")
    check("phone: no page changes while scrolling; cards fill once it stops", during == 0 and later > 0, f"during={during} after={later} {a0}->{active(p)}")

    # sideways on every symbol card, from the start of the feed
    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1200)
    side_ok, side_detail = True, []
    for name in ORDER:
        a = active(p)
        left(); d = active(p)
        right(); m = active(p)
        right(); n = active(p)
        left(); back = active(p)
        ok = a[0] == name and d[1] == "details" and m[1] == "main" and n[1] == "news" and back[1] == "main"
        side_ok &= ok
        if not ok: side_detail.append(f"{name}: {a}{d}{m}{n}{back}")
        up()
    check("phone: every symbol opens details (finger left) and news (finger right) and returns", side_ok, "; ".join(side_detail))

    # vertical swipe inside news scrolls the news, not the feed
    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1200)
    right(); before = active(p)
    swipe(200, 650, 200, 300); after = active(p)
    check("phone: scrolling inside news stays on the same symbol", before[0] == after[0] and after[1] == "news", f"{before} -> {after}")
    nw = p.evaluate("""(() => { const n = document.querySelector('.card.active [data-pane=news]'); return { market: !!n.querySelector('[data-scope=market]'), ev: n.querySelectorAll('.pev').length, txt: (n.querySelector('.pev p')||{}).textContent || '' }; })()""")
    check("phone: news has no Market tab and always shows price events", not nw["market"] and nw["ev"] >= 1 and len(nw["txt"]) > 10, str(nw))
    if p.locator(".card.active [data-pane=news] .sgo").count():
        p.locator(".card.active [data-pane=news] .sgo").first.click(); p.wait_for_timeout(500)
        sb = p.inner_text("#sheet") if p.is_visible("#sheet") else ""
        check("phone: the › on a news story opens a short brief and links to every source", "In brief" in sb and "at the source" in sb and p.locator("#sheet a.row[href^=http]").count() >= 1, sb[:80].replace("\n", " "))
        p.click("#sheet [data-close]"); p.wait_for_timeout(400)
    left()

    # charts
    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1200)
    chart_ok, chart_detail, stock_ok, stock_detail = True, [], True, []
    for i, name in enumerate(ORDER):
        p.evaluate(f"document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight*{i+1})")
        p.wait_for_timeout(1300)
        info = p.evaluate("""(()=>{const c=document.querySelector('.card.active'); const svg=c.querySelector('.chartbox svg.chart');
          return {svg: !!svg, rects: svg? svg.querySelectorAll('rect').length:0, last: c.querySelector('.axlast')?.textContent||'', price: c.querySelector('.price')?.textContent||'',
          lower: c.querySelectorAll('.lower svg.chart').length, lowerText: [...c.querySelectorAll('.lower-label')].map(x=>x.textContent).join(' | '), frames: document.querySelectorAll('iframe').length}})()""")
        if name in COINS:
            ok = info["svg"] and info["rects"] >= 40 and info["last"] and info["price"] and info["lower"] == 2 and "RSI" in info["lowerText"] and "MACD" in info["lowerText"]
            chart_ok &= bool(ok)
            if not ok: chart_detail.append(f"{name}:{info}")
        stock_ok &= info["frames"] == 0
    check("phone: coin cards draw candlesticks, price, last-price label, and RSI and MACD panels", chart_ok, "; ".join(chart_detail))
    check("phone: all 10 coins draw our own candles, nothing loads from TradingView", chart_ok and stock_ok, "; ".join(chart_detail))

    # the card shows only the name, the price and today's move above the chart
    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1200)
    card = p.evaluate("""(()=>{const c=document.querySelector('.card.active [data-pane=main]');
      return {extra: ['.edges','[data-go]','.tags','.chips','.save','.next','.nm','.badge','.winlabel','.pinh'].filter(q=>c.querySelector(q)),
        head: c.querySelector('.head').innerText.replace(/\\s+/g,' '), chartH: c.querySelector('.chartbox').getBoundingClientRect().height}})()""")
    check("phone: card is just name, price, today's move and the chart", not card["extra"] and "BTC" in card["head"] and "%" in card["head"] and card["chartH"] > 250, str(card))
    left(); dv = active(p)[1]; right(); right(); nv = active(p)[1]; left()
    check("phone: details and news open by swiping alone", dv == "details" and nv == "news", f"{dv} {nv}")

    # the time axis names the months under the chart, and the chip says what the chart covers
    ax = p.locator(".card.active .xaxis span").all_inner_texts(); tf0 = p.inner_text(".card.active [data-tf]").strip() + " " + p.get_attribute(".card.active [data-tf]", "aria-label")
    import re as _r2
    check("phone: months are labelled under the chart and the chip shows the range (3M Daily)", len(ax) >= 2 and all(_r2.fullmatch(r"[A-Z][a-z]{2}|20\d\d|\d{1,2}", t) for t in ax) and tf0.startswith("3M") and "daily" in tf0.lower(), f"{ax} / {tf0}")
    # chart chip: change just this coin, then all coins
    p.click(".card.active [data-tf]"); p.wait_for_timeout(400)
    p.click("#sheet [data-scope=coin]"); p.click("#sheet [data-k=range][data-v='1Y']"); p.wait_for_timeout(300)
    p.click("#sheet [data-close]"); p.wait_for_timeout(900)
    btc_tf = p.inner_text(".card.active [data-tf]").strip() + " " + p.get_attribute(".card.active [data-tf]", "aria-label")
    up(); eth_tf = p.inner_text(".card.active [data-tf]").replace("\n", " ")
    check("phone: 'Just BTC' changes only BTC's chart (1Y weekly), other coins keep 3M", btc_tf.startswith("1Y") and "weekly" in btc_tf.lower() and eth_tf.startswith("3M"), f"BTC={btc_tf} ETH={eth_tf}")
    p.click(".card.active [data-tf]"); p.wait_for_timeout(400)
    p.click("#sheet [data-scope=all]"); p.click("#sheet [data-k=range][data-v='6M']"); p.wait_for_timeout(300)
    p.click("#sheet [data-close]"); p.wait_for_timeout(900)
    eth2 = p.inner_text(".card.active [data-tf]").replace("\n", " "); down(); btc2 = p.inner_text(".card.active [data-tf]").replace("\n", " ")
    check("phone: 'All my coins' changes every coin's chart (6M)", eth2.startswith("6M") and btc2.startswith("6M"), f"ETH={eth2} BTC={btc2}")
    p.click(".card.active [data-tf]"); p.wait_for_timeout(400); p.click("#sheet [data-k=range][data-v='3M']"); p.wait_for_timeout(300); p.click("#sheet [data-close]"); p.wait_for_timeout(900)
    # details pane is organised in clear sections
    left(); secs = p.locator(".card.active [data-pane=details] .dsec h3").all_inner_texts()
    nb = p.locator(".card.active [data-pane=details] .ibtn").count()
    hid0 = p.locator(".card.active [data-pane=details] .how:visible").count()
    p.locator(".card.active [data-pane=details] .ibtn").first.click(); p.wait_for_timeout(200)
    howt = p.locator(".card.active [data-pane=details] .how:visible").first.inner_text() if p.locator(".card.active [data-pane=details] .how:visible").count() else ""
    glance = p.locator(".card.active [data-pane=details] .glance li").count()
    right()
    check("phone: each analysis section has an ⓘ that opens a short how-to note; At a glance gives 3-4 facts", nb >= 8 and hid0 == 0 and "doesn't predict" in howt and 3 <= glance <= 4, f"i={nb} hidden0={hid0} glance={glance} '{howt[:50]}'")
    want = ["AT A GLANCE", "DAILY CANDLE", "PERFORMANCE", "TREND", "VOLATILITY", "INDICATORS", "WHERE THE PRICE SITS", "YOUR ALERTS", "WATCHLISTS", "ABOUT"]
    check("phone: details are in sections: At a glance, Daily candle, Performance, Trend, Volatility, Indicators, Ranges, Alerts, Watchlists, About", all(any(t.upper().startswith(w) for t in secs) for w in want), " | ".join(secs))

    # the day's move sits next to the coin's name
    hd = p.evaluate("(()=>{const c=document.querySelector('.card.active'); return !!c.querySelector('.tkrow .tk') && !!c.querySelector('.tkrow .chg')})()")
    check("phone: today's % move sits next to the coin's name", hd)
    # support & resistance: off by default; the S/R button opens one clear choice that applies to every coin
    n0 = p.locator(".card.active .chart .lvl").count()
    p.click(".card.active [data-lv]"); p.wait_for_timeout(400); p.click("#sheet [data-line=sr]"); p.wait_for_timeout(600)
    tags = p.locator(".card.active .lvtag").all_inner_texts(); n1 = p.locator(".card.active .chart .lvl").count()
    others = p.evaluate("[...document.querySelectorAll('.card')].filter(c=>c.dataset.filled && !c.classList.contains('active') && c.querySelector('.chartbox:not(.nodata)')).map(c=>c.querySelector('[data-lv]')?.getAttribute('aria-pressed'))")
    check("phone: S/R → Support & resistance draws lines with touch counts, and every other card on screen shows them too", n0 == 0 and n1 >= 1 and any(_re.match(r"[SR] \S+ · ", t) and ("×" in t or "high" in t or "low" in t) for t in tags) and others and all(x == "true" for x in others), f"before={n0} after={n1} others={others} {tags}")
    if tags: p.locator(".card.active .lvtag").first.click(); p.wait_for_timeout(500)
    sh = p.inner_text("#sheet") if p.is_visible("#sheet") else ""
    check("phone: tapping a line's label explains support and resistance", "Support and resistance" in sh and "predict" in sh, sh[:100].replace("\n", " "))
    if p.is_visible("#sheet"): p.click("#sheet [data-close]"); p.wait_for_timeout(500)
    p.click(".card.active [data-lv]"); p.wait_for_timeout(400); p.click("#sheet [data-line=pivots]"); p.wait_for_timeout(600)
    ptags = p.locator(".card.active .lvtag").all_inner_texts(); lvb = p.inner_text(".card.active [data-lv]")
    check("phone: pivot points (P, R1, S1…) can be chosen instead", any(t.startswith("P ") for t in ptags) and "Pivots" in lvb, f"{ptags} {lvb}")
    p.click(".card.active [data-lv]"); p.wait_for_timeout(400); p.click("#sheet [data-line=off]"); p.wait_for_timeout(500)
    check("phone: choosing Off hides the lines", p.locator(".card.active .chart .lvl").count() == 0)

    # hold and slide on the chart reads any day; releasing offers a one-tap alert at that level
    box = p.evaluate("(()=>{const r=document.querySelector('.card.active .chartbox').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    cx, cy = box[0] + box[2] * 0.5, box[1] + box[3] * 0.4
    pos0 = active(p); top0 = p.evaluate("document.getElementById('feed').scrollTop")
    RECTS = "(()=>{const c=document.querySelector('.card.active'); return ['.tk','.price','.chg','.chartbox'].map(q=>{const r=c.querySelector(q).getBoundingClientRect(); return [Math.round(r.top),Math.round(r.height)]})})()"
    rects0 = p.evaluate(RECTS)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": cx, "y": cy}]}); p.wait_for_timeout(450)
    for k in range(1, 9):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": cx - 15 * k, "y": cy + 4 * k}]}); time.sleep(0.03)
    st = p.evaluate("(()=>{const c=document.querySelector('.card.active');return {tk:c.querySelector('.tk').textContent, info:c.querySelector('.scrubcard')?.innerText||'', lines:c.querySelectorAll('.xh').length}})()")
    rects1 = p.evaluate(RECTS)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); p.wait_for_timeout(300)
    moved = p.evaluate("document.getElementById('feed').scrollTop") != top0 or active(p)[1] != "main"
    check("phone: holding the chart shows a readout card (date, open/high/low/close, RSI, MACD) without moving the feed",
          st["tk"] == "BTC" and all(w in st["info"] for w in ["Open", "High", "Low", "Close", "RSI", "MACD"]) and st["lines"] >= 3 and not moved and active(p)[0] == pos0[0], f"{st} moved={moved}")
    check("phone: while holding, the name, price and chart stay exactly in place and the same size", rects0 == rects1, f"{rects0} -> {rects1}")
    chip = p.locator(".card.active .alertchip")
    chip_text = chip.inner_text() if chip.count() else ""
    rules0 = p.evaluate("(JSON.parse(localStorage.getItem('pl.demoAccount'))||{}).rules?.length||0")
    if chip.count(): chip.click(); p.wait_for_timeout(400)
    rules1 = p.evaluate("(JSON.parse(localStorage.getItem('pl.demoAccount'))||{}).rules?.length||0")
    toast_t = p.inner_text("#toast") if p.is_visible("#toast") else ""
    check("phone: releasing offers 'Alert me if…' and one tap creates the alert", "Alert me if BTC goes" in chip_text and rules1 == rules0 + 1 and "Alert set" in toast_t, f"chip='{chip_text}' rules {rules0}->{rules1} toast='{toast_t}'")
    # tap a panel to learn what it shows
    p.click(".card.active .lower[data-learn=RSI]"); p.wait_for_timeout(500)
    sheet = p.inner_text("#sheet") if p.is_visible("#sheet") else ""
    check("phone: tapping the RSI panel explains it with today's reading", "RSI" in sheet and "right now" in sheet.lower() and "how to read" in sheet.lower(), sheet[:120].replace("\n", " "))
    p.click("#sheet [data-close]"); p.wait_for_timeout(500)
    # every panel that can be under the chart: tap it, then "Open the full guide" — the guide must stay open
    guide_ok, guide_detail = True, []
    for combo in ["RSI,MACD", "VOL,ADX"]:  # the feed shows two panels at a time
        p.evaluate("(c)=>{const a=JSON.parse(localStorage.getItem('pl.demoAccount')); a.settings.chart={...a.settings.chart, lower:c}; localStorage.setItem('pl.demoAccount', JSON.stringify(a))}", combo)
        p.reload(); p.wait_for_timeout(2500)
        p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1200)
        for kind in combo.split(","):
            p.click(f".card.active .lower[data-learn={kind}]"); p.wait_for_timeout(500)
            p.wait_for_timeout(600)
            after = p.inner_text("#sheet") if p.is_visible("#sheet") else ""
            heads = p.evaluate("[...document.querySelectorAll('#sheet .gsec h3')].map(h=>h.textContent)")
            ok = "right now" in after.lower() and "What it shows" in heads and "How to read it" in heads and heads.index("What it shows") < heads.index("How to read it")
            guide_ok &= ok; guide_detail.append(f"{kind}: {heads}")
            p.click("#sheet [data-close]"); p.wait_for_timeout(500)
    check("phone: RSI, MACD, volume and ADX panels open one guide with the same sections in the same order (stays on screen)", guide_ok, "; ".join(guide_detail))
    p.evaluate("(()=>{const a=JSON.parse(localStorage.getItem('pl.demoAccount')); a.settings.chart={...a.settings.chart, lower:'RSI,MACD'}; localStorage.setItem('pl.demoAccount', JSON.stringify(a))})()")
    p.reload(); p.wait_for_timeout(2500)
    # quiz on the caught-up card
    p.evaluate(f"document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight*{len(ORDER)+1})"); p.wait_for_timeout(1200)
    nq = p.locator(".card.active .qq").count()
    if nq: p.locator(".card.active .qq").first.locator(".qa").first.click(); p.wait_for_timeout(200)
    marked = p.locator(".card.active .qq").first.locator(".qa.right").count() if nq else 0
    p.wait_for_timeout(1300)
    vis = p.evaluate("""(()=>{const c=document.querySelector('.card.active'); const q=[...c.querySelectorAll('.qq')].find(x=>!x.hidden); const h=c.querySelector('h1');
      if(!q||!h) return false; return h.getBoundingClientRect().top >= document.querySelector('.topbar').getBoundingClientRect().bottom - 30 && q.getBoundingClientRect().bottom <= document.querySelector('.tabbar').getBoundingClientRect().top
        && c.querySelector('[data-qn]').textContent === '2'})()""")
    check("phone: caught-up card has a 3-question quiz that marks answers and fits on screen", active(p)[0] == "done" and nq == 3 and marked == 1 and vis, f"{active(p)} q={nq} marked={marked} fits={vis}")
    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1200)

    # layout: nothing hidden under the tab bar, no sideways page scroll
    lay = p.evaluate("""(()=>{const c=document.querySelector('.card.active'); const edge=c.querySelector('.dots').getBoundingClientRect(); const tab=document.querySelector('.tabbar').getBoundingClientRect();
      return {edgeBottom: edge.bottom, tabTop: tab.top, sw: document.documentElement.scrollWidth, w: innerWidth}})()""")
    check("phone: card controls sit above the tab bar", lay["edgeBottom"] <= lay["tabTop"], str(lay))
    check("phone: no sideways page scroll", lay["sw"] <= lay["w"], str(lay))
    tabs = p.evaluate("[...document.querySelectorAll('.tabbar button')].map(b=>b.dataset.tab).join(',')")
    tb = p.evaluate("(()=>{const r=document.querySelector('.tabbar').getBoundingClientRect();return [r.bottom, innerHeight]})()")
    check("phone: tab bar is Coins, Feed (centre), Predict and sits on the bottom edge", tabs == "dash,feed,play" and abs(tb[0] - tb[1]) < 1 and p.inner_text(".tabbar").split() == ["Coins", "Feed", "Predict"], f"{tabs} {tb}")
    ov = p.evaluate("""(()=>{const c=document.querySelector('.card.active'); return [...c.querySelectorAll('.lower')].every(l=>l.querySelector('.lower-label').getBoundingClientRect().bottom <= l.querySelector('svg.chart').getBoundingClientRect().top + 0.5)})()""")
    check("phone: RSI and MACD labels sit above their lines, not on them", ov)

    # add-stock sheet with a new watchlist
    p.click("#addBtn"); p.wait_for_timeout(500)
    p.fill("#addQ", "cardano"); p.wait_for_timeout(600)
    first = p.locator(".result").first.inner_text() if p.locator(".result").count() else ""
    check("phone: search finds Cardano (ADA)", "ADA" in first, first.replace("\n", " "))
    p.locator(".result").first.click(); p.wait_for_timeout(500)
    toast1 = p.inner_text("#toast") if p.is_visible("#toast") else ""; added1 = p.locator(".result").first.inner_text()
    check("phone: one tap adds the coin to the feed's watchlist, with Undo, and the sheet stays open for the next", "Added ADA" in toast1 and "Undo" in toast1 and "added" in added1.lower() and p.locator("#addQ").count() == 1, f"{toast1!r} / {added1!r}")
    p.locator(".result").first.click(); p.wait_for_timeout(300)  # tap again: choose its watchlists
    p.fill("#newWl", "Altcoins"); p.click("#doAdd"); p.wait_for_timeout(700)
    toast = p.inner_text("#toast") if p.is_visible("#toast") else ""
    check("phone: tapping an added coin changes its watchlists (here a new one), confirmed with Undo", "Altcoins" in toast and "Undo" in toast, toast)
    check("phone: sheet returns to search for the next coin", p.locator("#addQ").count() == 1)
    p.click("#sheet [data-close]"); p.wait_for_timeout(900)
    check("phone: feed jumps to the newly added stock", active(p)[0] == "ADA", str(active(p)))

    p.click("#switcher"); p.wait_for_timeout(500)
    rows = p.locator("#sheet [data-l]").all_inner_texts()
    check("phone: switcher lists All, My watchlist and Altcoins with counts", any("Altcoins" in r and "1 symbol" in r for r in rows) and any("All my coins" in r for r in rows), " | ".join(r.replace("\n", " ") for r in rows))
    p.locator("#sheet [data-l]").filter(has_text="Altcoins").click(); p.wait_for_timeout(1200)
    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1000)
    check("phone: choosing a watchlist shows only its stocks", active(p)[0] == "ADA" and p.inner_text("#switchName") == "Altcoins", f"{active(p)} {p.inner_text('#switchName')}")
    p.click("#switcher"); p.wait_for_timeout(400); p.locator("#sheet [data-l]").filter(has_text="All my coins").click(); p.wait_for_timeout(1200)

    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1000)
    left(); p.click(".card.active [data-pane=details] [data-save]"); p.wait_for_timeout(500)
    check("phone: Change watchlists in details opens the watchlist picker", p.locator("#sheet .check input[type=checkbox]").count() >= 2)
    p.click("#sheet [data-close]"); p.wait_for_timeout(700); right()

    # Coins (the old dashboard): watchlists and alerts only; predictions live on the Predict tab
    p.click(".tabbar [data-tab=dash]"); p.wait_for_timeout(800)
    check("phone: the Coins tab is titled Coins, with no predictions on it, and an Alerts section", p.inner_text("#dash h1") == "Coins" and not p.locator("#dash .pl-head, #dash .dswitch").count() and p.locator("#dash #dNewRule").count() == 1, p.inner_text("#dash h1"))
    rows = p.locator("#dash .list [data-open]").count()
    check("phone: Coins lists coins with data and the other symbols", rows >= len(ORDER), f"rows={rows}")
    p.locator("#dash [data-open='CRYPTO:XRP']").click(); p.wait_for_timeout(1300)
    check("phone: tapping a Coins row opens that card in the feed", active(p)[0] == "XRP", str(active(p)))

    # full-screen chart for one coin over longer periods
    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1200)
    p.click(".card.active [data-full]"); p.wait_for_timeout(800)
    fs = p.evaluate("(()=>{const f=document.getElementById('full'); return {open: !!f && !f.hidden, range: f?.querySelector('[data-frange] b')?.textContent, rects: f?.querySelectorAll('.chartbox svg rect').length||0, tk: f?.querySelector('.tk')?.textContent}})()")
    full_range(p, "Max"); p.wait_for_timeout(1500)
    f5 = p.evaluate("(()=>{const f=document.getElementById('full'); return {range: f.querySelector('[data-frange] b').textContent, note: f.querySelector('.fnote')?.textContent||'', rects: f.querySelectorAll('.chartbox svg rect').length}})()")
    check("phone: expand opens a full-screen chart of that coin over a longer range (3M feed → 6M), and Max loads weekly history",
          fs["open"] and fs["tk"] == "BTC" and fs["range"] == "6M" and fs["rects"] > 20 and f5["range"] == "Max" and "Weekly" in f5["note"] and f5["rects"] > 100, f"{fs} {f5}")
    # 4Y: daily candles reach back about 4 years (older ones joined on from Binance), and RSI/MACD panels get a grid
    full_range(p, "4Y"); p.wait_for_timeout(1800)
    f4 = p.evaluate("(()=>{const f=document.getElementById('full'); return {note: f.querySelector('.fnote').textContent, grid: f.querySelectorAll('.flowers .lfull .grid').length, axes: f.querySelectorAll('.flowers .lfull .ax').length}})()")
    yr = _re.search(r"(20\d\d)", f4["note"])
    check("phone: full-screen 4Y shows about 4 years of daily candles, with gridded, labelled RSI/MACD panels",
          "Daily" in f4["note"] and yr and int(yr.group(1)) <= 2023 and f4["grid"] >= 6 and f4["axes"] >= 3, str(f4))
    full_range(p, "6M"); p.wait_for_timeout(600)
    fb = p.evaluate("(()=>{const r=document.querySelector('#full .chartbox').getBoundingClientRect();return [r.left+r.width/2, r.top+r.height/2]})()")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": fb[0], "y": fb[1]}]}); p.wait_for_timeout(650)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": fb[0] - 50, "y": fb[1]}]}); p.wait_for_timeout(150)
    fcard = p.evaluate("document.querySelector('#full .scrubcard')?.innerText||''")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); p.wait_for_timeout(300)
    # interactive: wheel zoom, drag to pan, double-tap to reset, and intraday ranges
    COUNT = "document.querySelectorAll('#full .chartbox svg .wick').length"
    FIRST = "document.querySelector('#full .fnote').textContent.split('·')[1]"
    n0 = p.evaluate(COUNT); first0 = p.evaluate(FIRST)
    p.mouse.move(fb[0], fb[1]); p.mouse.wheel(0, 300); p.wait_for_timeout(300); n1 = p.evaluate(COUNT)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": fb[0], "y": fb[1]}]}); p.wait_for_timeout(300)
    for k in range(1, 9): cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": fb[0] + 20 * k, "y": fb[1]}]}); time.sleep(0.02)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); p.wait_for_timeout(300); first1 = p.evaluate(FIRST)
    for _ in range(2):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": fb[0], "y": fb[1]}]}); cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); p.wait_for_timeout(120)
    p.wait_for_timeout(300); n2 = p.evaluate(COUNT)
    check("phone: full-screen chart zooms (wheel), pans (a slow drag too) and resets (double-tap)", n1 > n0 and first1 != first0 and n2 == n0, f"candles {n0}->{n1}->{n2} first {first0}->{first1}")
    # zoomed in, dragging right moves back in time
    p.mouse.move(fb[0], fb[1]); p.mouse.wheel(0, -600); p.wait_for_timeout(300)
    FD = "document.querySelector('#full .fnote').textContent.split('·')[1].split('–')[0]"
    d0 = p.evaluate(FD)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": fb[0] - 100, "y": fb[1]}]})
    for k in range(1, 11): cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": fb[0] - 100 + 20 * k, "y": fb[1]}]}); time.sleep(0.016)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); p.wait_for_timeout(900)
    d1 = p.evaluate(FD)
    import datetime as _dt
    pd = lambda t: _dt.datetime.strptime(t.strip(), "%d %b %Y")
    check("phone: zoomed in, dragging right goes back in time", pd(d1) < pd(d0), f"{d0} -> {d1}")
    full_range(p, "1D"); p.wait_for_timeout(1200); d1 = p.evaluate("document.querySelector('#full .fnote').textContent")
    full_range(p, "1W"); p.wait_for_timeout(1200); w1 = p.evaluate("document.querySelector('#full .fnote').textContent")
    ax1 = p.locator("#full .xaxis span").all_inner_texts()
    check("phone: 1D and 1W ranges show 15-minute and 1-hour candles with times or dates on the axis", "15-minute" in d1 and "1-hour" in w1 and len(ax1) >= 2, f"{d1[:40]} / {w1[:40]} / {ax1}")
    hdr = p.evaluate("[document.querySelector('#full .fhead .chg').textContent.replace(/[^0-9.]/g,''), document.querySelector('#full .fnote span').textContent.replace(/[^0-9.]/g,'')]")
    p.click("#full [data-ffx]"); p.wait_for_timeout(400); fxs = p.is_visible("#sheet .fxrow"); p.click("#sheet [data-close]"); p.wait_for_timeout(400)
    check("phone: full screen has the feed's range chip and ƒx button, and its % is the move on screen", fxs and hdr[0] and abs(float(hdr[0]) - float(hdr[1])) < 0.06, f"fx={fxs} {hdr}")
    p.click("#full [data-fclose]"); p.wait_for_timeout(400)
    check("phone: hold-to-read works in full screen, and ✕ closes it back to the feed", "Open" in fcard and p.evaluate("document.getElementById('full').hidden") and active(p)[0] == "BTC", fcard[:60].replace("\n", " "))

    # the account sheet (the letter avatar on Predict): grouped settings and the app version; the username chosen at
    # the start can be changed only twice
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(500); p.click("#plMe"); p.wait_for_timeout(700)
    groups = p.locator("#sheet .label.pg").all_inner_texts(); sheet_txt = p.inner_text("#sheet")
    check("phone: the account sheet groups settings (People and privacy, Charts and alerts, Sharing, App), shows the version, and Admin for admins", [g.lower() for g in groups] == ["people and privacy", "charts and alerts", "sharing", "app"] and re.search(r"Pulse \d+\.\d+\.\d+", sheet_txt) and p.locator("#sheet [data-av=inbox]").count() == 1, " | ".join(groups))
    p.click("#sheet [data-av=account]"); p.wait_for_timeout(500)
    lefts = [p.inner_text("#profile .dline >> nth=0")]
    p.click("#aName"); p.wait_for_timeout(400)
    p.fill("#uIn", "pulse98765432"); bad2 = p.inner_text("#uMsg")
    for n in ["chart_fan2", "chart.fan3"]:
        if not p.is_visible("#sheet"): p.click("#aName"); p.wait_for_timeout(400)
        p.fill("#uIn", n); p.click("#uSave"); p.wait_for_timeout(600)
        lefts.append(p.inner_text("#profile .dline >> nth=0"))
    p.click("#aName"); p.wait_for_timeout(500)
    blocked = (p.inner_text("#toast") if p.is_visible("#toast") else "") and not p.is_visible("#sheet")
    check("phone: Account shows the app version", re.search(r"Pulse \d+\.\d+\.\d+", p.inner_text("#profile")))
    check("phone: username rejects phone-like numbers", "phone" in bad2, bad2)
    check("phone: the starting username can be changed twice, then no more", lefts[0].startswith("@chart_fan ·") and "2 changes left" in lefts[0] and "1 change left" in lefts[1] and "0 changes left" in lefts[2] and bool(blocked), " ; ".join(lefts))
    p.click("#pBack"); p.wait_for_timeout(500)
    check("phone: Back from a settings page returns to Predict with the account sheet open", not p.locator("#sPlay").get_attribute("hidden") and p.is_visible("#sheet [data-av=account]"), "")
    p.click("#sheet [data-close]"); p.wait_for_timeout(400)
    p.click(".tabbar [data-tab=feed]"); p.wait_for_timeout(600)

    # watchlists live on Coins: chips switch lists (and the feed), Edit removes a coin
    p.click(".tabbar [data-tab=dash]"); p.wait_for_timeout(500)
    chips = p.locator("#dash .wchip[data-l]").all_inner_texts()
    check("phone: Coins shows watchlist chips (All, My watchlist, Altcoins)", len(chips) >= 3 and any("Altcoins" in c for c in chips), " | ".join(chips))
    p.locator("#dash .wchip", has_text="Altcoins").click(); p.wait_for_timeout(500)
    n_alt = p.locator("#dash .list [data-open]").count()
    p.click(".tabbar [data-tab=feed]"); p.wait_for_timeout(1200)
    check("phone: picking a watchlist on Coins filters it and the feed", n_alt == 1 and p.inner_text("#switchName") == "Altcoins", f"rows={n_alt} feed={p.inner_text('#switchName')}")
    p.click(".tabbar [data-tab=dash]"); p.wait_for_timeout(500)
    p.locator("#dash .wchip", has_text="My watchlist").click(); p.wait_for_timeout(400)
    before = p.locator("#dash .list [data-open]").count()
    p.click("#dEdit"); p.wait_for_timeout(300); p.locator("#dash [data-rm]").first.click(); p.wait_for_timeout(300); p.click("#dDone"); p.wait_for_timeout(400)
    after = p.locator("#dash .list [data-open]").count()
    check("phone: Edit on Coins removes a coin from the watchlist", after == before - 1, f"{before} -> {after}")
    p.locator("#dash .wchip", has_text="All").first.click(); p.wait_for_timeout(400)

    # every settings page opens from the account sheet and goes back to it
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(500)
    pages_ok, bad = True, []
    for sub in ["chart", "rules", "alerts", "lists", "account", "appearance", "legal"]:
        if not p.is_visible("#sheet [data-av]"): p.click("#plMe"); p.wait_for_timeout(500)
        p.click(f"#sheet [data-av={sub}]"); p.wait_for_timeout(450)
        h = p.inner_text("#profile h1") if p.is_visible("#profile h1") else ""
        if not h: pages_ok = False; bad.append(sub)
        p.click("#pBack"); p.wait_for_timeout(450)
    check("phone: every settings page opens from the account sheet and goes back to it", pages_ok, ",".join(bad))

    # chart style changes reach the feed
    if not p.is_visible("#sheet [data-av]"): p.click("#plMe"); p.wait_for_timeout(500)
    p.click("#sheet [data-av=chart]"); p.wait_for_timeout(400)
    p.click("[data-k=range][data-v='1M']"); p.click("[data-k=type][data-v=line]"); p.wait_for_timeout(300)
    p.click(".tabbar [data-tab=feed]"); p.wait_for_timeout(1200)
    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1200)
    line = p.locator(".card.active .chartbox .pline").count(); low = p.inner_text(".card.active .lower-label")
    tf = p.inner_text(".card.active [data-tf]").replace("\n", " ")
    check("phone: chart style (1 month, line) applies to cards", line == 1 and "RSI" in low and tf.startswith("1M"), f"line={line} / {low} / {tf}")

    # indicators are added and removed from the ƒx chip on the feed card, and show on the full-screen chart too
    p.click(".card.active [data-fx]"); p.wait_for_timeout(400)
    p.click("#sheet [data-fxtab=over]"); p.wait_for_timeout(200); p.click("#sheet [data-stog=BB]"); p.wait_for_timeout(200); p.click("#sheet [data-fxtab=lower]"); p.wait_for_timeout(200); p.click("#sheet [data-stog=MACD]"); p.wait_for_timeout(200); p.click("#sheet [data-stog=STOCH]"); p.wait_for_timeout(200); p.click("#sheet [data-stog=MFI]"); p.wait_for_timeout(200)
    p.click("#sheet [data-close]"); p.wait_for_timeout(600)
    chip = p.inner_text(".card.active [data-fx]")
    p.click(".card.active [data-full]"); p.wait_for_timeout(1200)
    fi = p.evaluate("""(()=>{const f=document.getElementById('full'); return {leg: f.querySelector('.olegend')?.innerText||'', fill: f.querySelectorAll('.chartbox .ofill').length, panels: [...f.querySelectorAll('.flowers .lower')].map(l=>l.dataset.learn).join(','), find: !!f.querySelector('[data-find]')}})()""")
    check("phone: the ƒx chip on the card adds Bollinger Bands and swaps MACD for Stochastic and MFI (full screen shows all, no button there)", "BB" in fi["leg"] and fi["fill"] == 1 and fi["panels"] == "RSI,STOCH,MFI" and not fi["find"] and "4" in chip, f"{fi} chip={chip}")
    p.click("#full .flowers [data-rmstudy=MFI]"); p.wait_for_timeout(300)
    fp = p.evaluate("[...document.querySelectorAll('#full .flowers .lower')].map(l=>l.dataset.learn).join(',')")
    check("phone: ✕ on a full-screen panel removes that indicator", fp == "RSI,STOCH", fp)
    # a plain fact under each panel, and a one-tap alert at its own level from the panel guide
    fact = p.evaluate("document.querySelector('#full .flowers .lower[data-learn=RSI] .lfact')?.textContent || ''")
    nrules = p.evaluate("(JSON.parse(localStorage.getItem('pl.demoAccount')).rules||[]).length")
    p.click("#full .flowers .lower[data-learn=RSI] .lower-label"); p.wait_for_timeout(500)
    lsheet = p.inner_text("#sheet") if p.is_visible("#sheet") else ""
    p.click("#sheet [data-ra='0']"); p.wait_for_timeout(500)
    rules2 = p.evaluate("(JSON.parse(localStorage.getItem('pl.demoAccount')).rules||[]).map(r=>r.metric+' '+r.op+' '+r.value)")
    check("phone: panels state a plain fact and the RSI guide sets an alert at 70 in one tap",
          ("30 and 70" in fact or "Above 70" in fact or "Below 30" in fact) and "In this view" in lsheet and len(rules2) == nrules + 1 and rules2[-1] == "rsi14 crossAbove 70", f"{fact} / {rules2[-1:]}")
    p.click("#full [data-fclose]"); p.wait_for_timeout(900)
    # quick sets replace the picks in one tap
    p.click(".card.active [data-fx]"); p.wait_for_timeout(400); p.click("#sheet [data-sset=momentum]"); p.wait_for_timeout(300); p.click("#sheet [data-close]"); p.wait_for_timeout(600)
    ms = p.evaluate("[...document.querySelectorAll('.card.active .lower')].map(l=>l.dataset.learn).join(',') + '|' + (document.querySelector('.card.active .olegend')?.innerText||'')")
    check("phone: the Momentum quick set shows RSI, MACD and Stochastic on the card (a 2 × 2 grid from iPhone 12 width) and clears the price-chart lines", ms == "RSI,MACD,STOCH|" and p.locator(".card.active .lowers.g2").count() == 1, ms)
    p.click(".card.active [data-fx]"); p.wait_for_timeout(400)
    p.click("#sheet [data-sset=none]"); p.wait_for_timeout(200)
    p.click("#sheet [data-fxtab=over]"); p.wait_for_timeout(150); p.click("#sheet [data-stog=BB]"); p.wait_for_timeout(150); p.click("#sheet [data-fxtab=lower]"); p.wait_for_timeout(150)
    for c in ["RSI", "STOCH"]: p.click(f"#sheet .fxrow [data-stog={c}]"); p.wait_for_timeout(150)
    p.click("#sheet [data-close]"); p.wait_for_timeout(700)
    fd = p.evaluate("""(()=>{const c=document.querySelector('.card.active'); return {leg: c.querySelector('.olegend')?.innerText||'', panels: [...c.querySelectorAll('.lower')].map(l=>l.dataset.learn).join(',')}})()""")
    left(); txt = p.inner_text(".card.active [data-pane=details]")
    check("phone: the feed card shows the same indicators, and details read them in plain words", "BB" in fd["leg"] and fd["panels"] == "RSI,STOCH" and "Bollinger" in txt and "Stochastic" in txt, f"{fd} / {'Bollinger' in txt} {'Stochastic' in txt}")
    right()

    # feedback: hold any part still for 5 seconds, say yes, and leave a note about it; Feedback mode makes every tap a note
    p.click(".tabbar [data-tab=feed]"); p.wait_for_timeout(600)
    def hold5(x, y):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]}); p.wait_for_timeout(3300)
        asked = p.inner_text("#sheet") if p.is_visible("#sheet") else ""
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); p.wait_for_timeout(700)
        return asked
    sb = p.locator(".card.active [data-lv]").bounding_box()
    ask = hold5(sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2)
    still_ask = p.is_visible("#sheet [data-fbyes]")  # letting go didn't press S/R underneath
    if still_ask: p.click("#sheet [data-fbyes]"); p.wait_for_timeout(500)
    fs3 = p.inner_text("#sheet") if p.is_visible("#sheet") else ""
    fsz = p.evaluate("parseFloat(getComputedStyle(document.getElementById('fbText')||document.body).fontSize)")
    if p.locator("#fbText").count(): p.fill("#fbText", "Held S/R for 5 seconds"); p.click("#fbSend"); p.wait_for_timeout(500)
    check("phone: holding a button (S/R) for 3s asks to leave feedback, letting go doesn't press it, and the note is about S/R (16px+ box)", "Leave feedback?" in ask and "S/R button" in ask and still_ask and "S/R button" in fs3 and fsz >= 16, f"{ask[:50]!r} {still_ask} {fsz}")
    fbox = p.locator(".card.active .chartbox").bounding_box()
    ask2 = hold5(fbox["x"] + fbox["width"] * 0.5, fbox["y"] + fbox["height"] * 0.5)
    if p.is_visible("#sheet [data-fbno]"): p.click("#sheet [data-fbno]"); p.wait_for_timeout(500)
    check("phone: holding the chart for 3s offers feedback about that coin's price chart, and Not now closes it", "Price chart" in ask2 and _re.search(r"Feed · [A-Z]{2,5}", ask2) and not p.is_visible("#sheet"), ask2[:80].replace("\n", " "))
    p.click(".card.active [data-pexp]"); p.wait_for_timeout(600); np_ = p.locator("#sheet .pbig .lower").count(); p.click("#sheet [data-close]"); p.wait_for_timeout(500)
    check("phone: ⤢ opens the chart's indicator panels large in a sheet", np_ >= 1, str(np_))
    p.click(".card.active [data-fx]"); p.wait_for_timeout(600)
    hb = p.locator("#sheet .sh-head").bounding_box(); hx, hy = hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": hx, "y": hy}]})
    for k in range(1, 9): cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": hx, "y": hy + 30 * k}]}); time.sleep(0.02)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); p.wait_for_timeout(700)
    check("phone: a sheet closes by swiping it down", not p.is_visible("#sheet"), "")
    # more panels saved than fit: the app asks which to keep (the last ones added are pre-picked), and a 5th asks what to swap
    p.evaluate("(()=>{const k='pl.demoAccount', d=JSON.parse(localStorage.getItem(k)); d.settings=d.settings||{}; d.settings.chart=d.settings.chart||{}; d.settings.chart.lower='ADX,STOCH,MFI,CCI,RSI,MACD'; localStorage.setItem(k, JSON.stringify(d));})()")
    p.reload(); p.wait_for_timeout(3000)
    fit_t = p.inner_text("#shTitle") if p.is_visible("#sheet") else ""; pre = p.locator("#sheet [data-keep][aria-pressed=true]").all_inner_texts()
    if fit_t: p.click("#sheet #kGo"); p.wait_for_timeout(1200)
    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1200)
    shown_ = p.locator(".card.active .lowers .lower").count(); labs = " ".join(p.locator(".card.active .lowers .lower-label").all_inner_texts())
    check("phone: 6 saved panels on a 4-panel screen asks which 4 to keep, pre-picking the latest (RSI, MACD), then shows them", fit_t.startswith("Pick 4") and len(pre) == 4 and shown_ == 4 and "RSI" in labs and "MACD" in labs, f"{fit_t!r} {len(pre)} {shown_} {labs[:80]}")
    p.click(".card.active [data-fx]"); p.wait_for_timeout(500)
    p.click("#sheet [data-fxtab=lower]"); p.wait_for_timeout(200); p.click("#sheet .fxtog[data-stog=OBV]"); p.wait_for_timeout(300)
    sw = p.inner_text("#sheet .fxswap") if p.locator("#sheet .fxswap").count() else ""
    gone = p.inner_text("#sheet .fxswap [data-swap] >> nth=0") if sw else ""
    if sw: p.click("#sheet .fxswap [data-swap] >> nth=0"); p.wait_for_timeout(300)
    now_ = p.inner_text("#sheet .fxnow"); p.click("#sheet [data-close]"); p.wait_for_timeout(800)
    check("phone: adding a 5th panel asks which one to swap, then swaps it", "Swap one for" in sw and "On-Balance" in now_ and gone and gone not in now_, f"{sw[:60]!r} / {gone} / {now_[:80]!r}")
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(500); p.click("#plMe"); p.wait_for_timeout(500)
    p.click("#sheet [data-av=feedback]"); p.wait_for_timeout(700)
    p.click(".card.active [data-lv]"); p.wait_for_timeout(600); fs2 = p.inner_text("#sheet") if p.is_visible("#sheet") else ""
    p.fill("#fbText", "What does S/R mean?"); p.click("#fbSend"); p.wait_for_timeout(500); p.click("#fbBar [data-fbdone]"); p.wait_for_timeout(300)
    check("phone: Feedback mode turns a button tap into a note about that button (S/R), and Done turns it off", "S/R button" in fs2 and not p.locator("#fbBar").count(), fs2[:80].replace("\n", " "))
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(500); p.click("#plMe"); p.wait_for_timeout(700); p.click("#sheet [data-av=inbox]"); p.wait_for_timeout(700)
    ib = p.inner_text("#profile")
    p.click(".fbitem [data-fset=done] >> nth=0"); p.wait_for_timeout(500); ib2 = p.inner_text("#profile .seg")
    check("phone: the feedback inbox lists both notes with where they were left, and marking one done moves it", "Held S/R for 5 seconds" in ib and "What does S/R mean?" in ib and "S/R button" in ib and "Open 1" in ib2 and "Done 1" in ib2, ib2)
    p.click("#pBack"); p.wait_for_timeout(400); p.click("#sheet [data-close]") if p.is_visible("#sheet") else None; p.wait_for_timeout(300)

    # rules make alerts (demo mode checks rules on the phone); both live on the Coins tab now
    p.click(".tabbar [data-tab=dash]"); p.wait_for_timeout(500); p.click("#dNewRule"); p.wait_for_timeout(400)
    p.select_option("#rMetric", "rsi14"); p.select_option("#rOp", "below"); p.fill("#rVal", "99"); p.click("#rForm button"); p.wait_for_timeout(500)
    p.click("#pBack"); p.wait_for_timeout(500)
    on_coins = not p.locator("#sDash").get_attribute("hidden")
    fresh = p.locator("#dash .alertstrip").count(); rule_rows = p.locator("#dash [data-ron]").count()
    dot = p.is_visible('.tabbar [data-tab=dash] #alertDot')
    p.click("#dAlerts"); p.wait_for_timeout(400)
    n_alerts = p.locator("#profile .list .row").count()
    check("phone: a rule that is met creates alerts, shown on Coins, with the dot on the Coins tab", on_coins and fresh >= 1 and rule_rows >= 1 and n_alerts >= 1 and dot, f"coins={on_coins} new={fresh} rules={rule_rows} alerts={n_alerts} dot={dot}")
    p.click("#pBack"); p.wait_for_timeout(400)

    # appearance
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(400); p.click("#plMe"); p.wait_for_timeout(500); p.click("#sheet [data-av=appearance]"); p.wait_for_timeout(400); p.click("[data-t=light]"); p.wait_for_timeout(300)
    check("phone: light theme switches", p.evaluate("document.documentElement.dataset.theme") == "light")
    p.click("[data-t=dark]")

    # refresh
    p.click(".tabbar [data-tab=feed]"); p.wait_for_timeout(500); p.click("#status"); p.wait_for_timeout(9500)
    st = p.inner_text("#status")
    check("phone: refresh finishes (never stuck on Updating)", "Updating" not in st, st)

    # daily recap on the first card after the first visit
    p.evaluate("localStorage.setItem('pl.lastOpen', JSON.stringify(new Date(Date.now()-3600e3).toISOString()))"); p.reload(); p.wait_for_timeout(2500)
    rc = p.inner_text(".card.active") if p.locator(".card.active").count() else ""
    check("phone: the first card is a daily recap measured from midnight (up count, biggest rise and fall)", "daily recap" in rc.lower() and "biggest rise" in rc.lower() and "up today" in rc.lower() and "midnight" in rc.lower(), rc[:150].replace("\n", " "))
    check("phone: no JavaScript errors", not errs, " | ".join(errs[:3]))
    ctx.close()

NOCOACH = "localStorage.getItem('pl.coach')||localStorage.setItem('pl.coach', JSON.stringify({feed:1,dash:1,profile:1,add:1,play:1}))"

# Prediction game. Its own Kraken stand-in: one smooth made-up price per coin, so 1-minute and daily candles agree
# (the start price is locked from 1-minute candles, the volatility from daily ones).
import math as _math
def steady_kraken_route(route):
    u = route.request.url; pair = _re.search(r"pair=([A-Z]+)", u).group(1); iv = int(_re.search(r"interval=(\d+)", u).group(1)) if "interval=" in u else 1440
    base = 50 + (sum(map(ord, pair)) % 50) * 20
    px = lambda t: base * _math.exp(0.03 * _math.sin(t / 86400 * 2.1) + 0.004 * _math.sin(t / 3600))
    step = iv * 60; end = int(time.time()) // step * step; rows = []
    for k in range(719, -1, -1):
        s0 = end - k * step; o = px(s0); c = px(min(s0 + step - 60, time.time()))
        rows.append([s0, f"{o:.6f}", f"{max(o, c):.6f}", f"{min(o, c):.6f}", f"{c:.6f}", f"{c:.6f}", "1000", 10])
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=_json.dumps({"error": [], "result": {pair: rows, "last": rows[-1][0]}}))

def prediction_test(b):
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.route("https://api.kraken.com/**", steady_kraken_route); demo_mode(ctx); ctx.add_init_script(NOCOACH)
    p = ctx.new_page(); errs = []
    p.on("pageerror", lambda e: errs.append(str(e)))
    p.goto(BASE); p.wait_for_timeout(2500); pass_gate(p)
    p.keyboard.press("ArrowDown"); p.wait_for_timeout(1200)
    chip = p.locator(".card.active [data-pred]")
    check("predict: every coin card has a Predict chip", chip.count() == 1 and "Predict" in chip.inner_text(), str(active(p)))
    chip.click(); p.wait_for_timeout(500)
    periods = p.locator("#sheet .utabs [data-h]").all_inner_texts(); default = p.get_attribute("#sheet .utabs [aria-selected=true]", "data-h")
    check("predict: the sheet offers 30 min, 1 hour, 1 day and 1 year, starting on 1 day", [x.split("\n")[0] for x in periods] == ["30 min", "1 hour", "1 day", "1 year"] and default == "1d", f"{periods} {default}")
    now = p.evaluate("parseFloat(document.querySelector('.pnow b').textContent.replace(/[^0-9.]/g,''))")
    p.fill("#pIn", f"{now * 1.0003:.4f}"); p.wait_for_timeout(150)
    close_msg, close_off = p.inner_text("#pInMsg"), p.is_disabled("#pGo")
    p.fill("#pIn", f"{now * 1.05:.4f}"); p.wait_for_timeout(150)
    ok_msg, ok_on = p.inner_text("#pInMsg"), not p.is_disabled("#pGo")
    check("predict: a call too close to today's price is refused; a real call up is accepted", close_off and "too close" in close_msg and ok_on and "a call up" in ok_msg, f"{close_msg} / {ok_msg}")
    p.click("#pGo"); p.wait_for_timeout(1000)
    toast_txt = p.inner_text("#toast") if p.is_visible("#toast") else ""
    badge = p.inner_text(".card.active [data-pred]")
    p.click(".card.active [data-pred]"); p.wait_for_timeout(400)
    one_open = p.is_disabled("#sheet .utabs [data-h='1d']") and "open" in p.inner_text("#sheet .utabs [data-h='1d']") and p.get_attribute("#sheet .utabs [aria-selected=true]", "data-h") != "1d"
    p.click("[data-close]"); p.wait_for_timeout(400)
    check("predict: locking in confirms it, the chip counts it, and 1 day can't be predicted again while it's open", "Locked in" in toast_txt and "1" in badge and one_open, f"{toast_txt} / {badge!r}")
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(600)
    head0 = p.inner_text("#play .pl-head"); open0 = p.inner_text("#play .pl-view")
    check("predict: predictions live on the Predict tab: before anything is scored there's no score yet, and Calls lists the open one", "No score yet" in head0 and "@chart_fan" in head0 and "open · 1" in open0.lower() and "called" in open0, f"{head0!r} / {open0[:120]!r}")
    # an hour-long call made 3 hours ago (settled on the phone from 1-minute candles) and 11 earlier scored results
    p.evaluate("""(async()=>{const d=JSON.parse(localStorage.getItem('pl.demoPreds')), made=Date.now()-3*3600e3;
      const j=await (await fetch('https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=1')).json(), r=j.result.ETHUSD.filter(x=>x[0]*1000<=made).pop();
      d.open.push({id:'ETH_1h',coin:'CRYPTO:ETH',t:'ETH',horizon:'1h',target:+r[1]*1.01,createdAt:new Date(made).toISOString(),clientP0:+r[1],clientSigma:.03});
      [.15,.3,.6,.2,1.3,.4,.1,.8,.35,2.2,.5].forEach((m,i)=>{const h=['30m','1h','1d'][i%3], at=Date.now()-(20-i)*864e5, s=.03*Math.sqrt({'30m':1/48,'1h':1/24,'1d':1}[h]), t=100*Math.exp(s), a=t*Math.exp(-m*s);
        d.results.push({id:'X'+i,coin:'CRYPTO:SOL',t:'SOL',horizon:h,target:t,p0:100,sigmaD:.03,actual:a,createdAt:new Date(at).toISOString(),resolvedAt:new Date(at+3600e3).toISOString(),status:'scored',pctOff:(t/a-1)*100,label:'Close'});});
      localStorage.setItem('pl.demoPreds', JSON.stringify(d));})()""")
    p.reload(); p.wait_for_timeout(3500)
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(600)
    card = p.inner_text("#play .pl-head"); score = int(p.inner_text("#play .pl-score b"))
    ring = p.get_attribute("#plMe", "class")
    check("predict: with 12 scored predictions the header shows one score between 300 and 900 with its band, and the letter avatar is ringed in the band's colour", 300 <= score <= 900 and any(bnd in card for bnd in ["Exceptional", "Very good", "Good", "Fair", "Building"]) and "Provisional" not in card and _re.search(r"\bb[1-5]\b", ring) and "prov" not in ring, card.replace("\n", " ") + " " + ring)
    p.wait_for_timeout(2500)
    first = p.inner_text("#play .pl-view .hl:last-of-type .row >> nth=0") if p.locator("#play .pl-view .hl").count() else ""
    page = p.inner_text("#play")
    check("predict: the hour-long call settled on the phone from 1-minute candles and shows how close it was", first.startswith("ETH · 1 hour") and "it was $" in first and _re.search(r"\d+\.\d% (above|below)", first) and any(l in first for l in ["Spot on", "Very close", "Close", "Off", "Far off"]), first.replace("\n", " "))
    check("predict: each prediction shows only how close it was, never a per-prediction score", "points" not in page.lower() and "trade" not in page.lower(), "")
    first_el = p.evaluate("document.querySelector('#play .pl-view').firstElementChild?.textContent")
    check("predict: Calls starts with the ask (pick a coin, call its price), and has no 'How the score works'", first_el == "Make a call" and "How the score works" not in page and p.locator("#play .pchips [data-pp]").count() >= 1, str(first_el))
    p.click(".tabbar [data-tab=dash]"); p.wait_for_timeout(600)
    check("coins: Coins has the watchlist chips and no prediction header", p.locator("#dash .wchips").count() == 1 and p.locator("#dash .pl-head").count() == 0, "")
    colours = p.evaluate("[...document.querySelectorAll('#dash .list [data-open]')].map(r => [r.querySelector('.r span').className, r.querySelector('.spark path').getAttribute('class')])")
    check("coins: each coin's sparkline is red when its % is down and green when up (same period)", colours and all((c == "up") == (k == "lu") for c, k in colours), str(colours[:4]))
    check("predict: no JavaScript errors", not errs, " | ".join(errs[:3]))
    ctx.close()

def tour_test(b):
    # A brand-new user: the feed teaches itself step by step, each step finishing when the gesture is done.
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    ctx.route("https://api.kraken.com/**", kraken_route); ctx.route("https://data-api.binance.vision/**", binance_route); demo_mode(ctx)
    p = ctx.new_page(); p.goto(BASE); p.wait_for_timeout(2500); pass_gate(p); p.wait_for_timeout(900); cdp = ctx.new_cdp_session(p)
    def swipe(x0, y0, x1, y1, settle=1100):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0}]})
        for i in range(1, 11):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + (x1 - x0) * i / 10, "y": y0 + (y1 - y0) * i / 10}]}); time.sleep(0.02)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); p.wait_for_timeout(settle)
    step = lambda: p.inner_text("#coach .cn") if p.locator("#coach").count() else "none"
    seen = [step()]
    swipe(200, 620, 200, 200); seen.append(step())            # up → first coin
    swipe(330, 560, 50, 560); seen.append(step())             # left → details
    swipe(50, 560, 330, 560); swipe(50, 560, 330, 560); seen.append(step())  # right, right → news
    swipe(330, 560, 50, 560); seen.append(step())             # left → chart
    box = p.evaluate("(()=>{const r=document.querySelector('.card.active .chartbox').getBoundingClientRect();return [r.left+r.width/2, r.top+r.height/2]})()")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": box[0], "y": box[1]}]}); p.wait_for_timeout(450)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": box[0] - 40, "y": box[1]}]}); p.wait_for_timeout(200)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); p.wait_for_timeout(1900); seen.append(step())
    p.click(".card.active [data-tf]"); p.wait_for_timeout(900); seen.append(step())
    want = ["1 / 6", "2 / 6", "3 / 6", "4 / 6", "5 / 6", "6 / 6", "none"]
    check("tour: the feed tour moves on as each gesture is done (up, left, right, left, hold, tap)", seen == want, str(seen))
    p.click("#sheet [data-close]"); p.wait_for_timeout(500)
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(900)
    d = [step()]
    for _ in range(3):
        if p.locator("#coach [data-next]").count(): p.click("#coach [data-next]"); p.wait_for_timeout(250)
    d.append(step())
    p.click(".tabbar [data-tab=feed]"); p.wait_for_timeout(400); p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(900); d.append(step())
    check("tour: the Predict tab explains your score, Calls/Groups/Ranks and making a call once, in 3 steps, and not again", d == ["1 / 3", "none", "none"], str(d))
    p.click(".tabbar [data-tab=dash]"); p.wait_for_timeout(900); c1 = p.locator("#coach").count()
    if c1: p.click("#coach [data-next]"); p.wait_for_timeout(250)
    p.click(".tabbar [data-tab=feed]"); p.wait_for_timeout(400); p.click(".tabbar [data-tab=dash]"); p.wait_for_timeout(900)
    check("tour: Coins explains itself once in one step", c1 == 1 and not p.locator("#coach").count(), str(c1))
    p.reload(); p.wait_for_timeout(2500)
    check("tour: never shown again after it is finished", step() == "none")
    ctx.close()

def ios_homescreen_test(b):
    # Simulates the iOS Home Screen bug: the page is laid out 56 px shorter than the screen.
    ctx = b.new_context(viewport={"width": 390, "height": 788}, is_mobile=True, has_touch=True,
                        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")
    ctx.add_init_script("Object.defineProperty(navigator,'standalone',{get:()=>true}); Object.defineProperty(screen,'height',{get:()=>844}); Object.defineProperty(screen,'width',{get:()=>390});")
    ctx.route("https://api.kraken.com/**", kraken_route); ctx.route("https://data-api.binance.vision/**", binance_route); demo_mode(ctx)
    p = ctx.new_page(); p.goto(BASE); p.wait_for_timeout(1500)
    r = p.evaluate("(()=>{const t=document.querySelector('.tabbar').getBoundingClientRect(), f=document.getElementById('feed'); return [t.bottom, f.clientHeight, getComputedStyle(document.documentElement).getPropertyValue('--gapb').trim()]})()")
    check("iOS Home Screen: tab bar and feed reach the real bottom of the screen (no empty strip)", abs(r[0] - 844) < 1 and r[1] == 844, str(r))
    ctx.close()

def landscape_test(b):
    # a phone on its side: vertical swipes page the feed from the first page and between coins
    ctx = b.new_context(viewport={"width": 844, "height": 390}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.route("https://api.kraken.com/**", kraken_route); ctx.route("https://data-api.binance.vision/**", binance_route); demo_mode(ctx)
    ctx.add_init_script("localStorage.setItem('pl.coach', JSON.stringify({feed:1,dash:1,profile:1,add:1,play:1}))")
    p = ctx.new_page(); p.goto(BASE); p.wait_for_timeout(1500); pass_gate(p, "sideways1", three_months=False); p.wait_for_timeout(1500)
    cdp = ctx.new_cdp_session(p)
    def vs(y0, y1, x=300):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y0}]})
        for k in range(1, 11): cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y0 + (y1 - y0) * k / 10}]}); time.sleep(0.016)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); p.wait_for_timeout(800)
    at = lambda: round(p.evaluate("document.getElementById('feed').scrollTop/document.getElementById('feed').clientHeight"), 2)
    seq = []
    for x in (300, 300, 700): vs(300, 80, x); seq.append(at())
    vs(80, 300); seq.append(at())
    pr = p.evaluate("(()=>{const a=document.querySelector('.card.active .price').getBoundingClientRect(), b=document.querySelector('.card.active [data-pred]').getBoundingClientRect(), c=document.querySelector('.card.active [data-tf]').getBoundingClientRect(); return [b.left < c.left - 4 || b.top > c.bottom, Math.abs(b.top - a.bottom) < 60]})()")
    check("landscape: swipes page the feed from the first page and over the side panels, and Predict sits by the price without overlap", seq == [1, 2, 3, 2] and all(pr), f"{seq} {pr}")
    ctx.close()

def desktop_tests(b):
    p = b.new_page(viewport={"width": 1280, "height": 800}); errs = []
    p.route("https://api.kraken.com/**", kraken_route); p.add_init_script(NOCOACH); demo_mode(p)
    p.on("pageerror", lambda e: errs.append(str(e)))
    p.goto(BASE); p.wait_for_timeout(2500); pass_gate(p)
    p.mouse.move(640, 450)
    p.mouse.wheel(0, 100); p.wait_for_timeout(1100)
    check("desktop: one mouse-wheel notch moves to the next card", active(p)[0] == ORDER[0], str(active(p)))
    p.mouse.wheel(0, 100); p.wait_for_timeout(1100)
    check("desktop: the next notch moves one more card", active(p)[0] == ORDER[1], str(active(p)))
    # trackpad: a burst of small deltas with a momentum tail = one card
    for d in [4, 10, 18, 26, 30, 28, 22, 16, 10, 6, 3, 2, 1]:
        p.mouse.wheel(0, d); p.wait_for_timeout(16)
    p.wait_for_timeout(1100)
    check("desktop: one trackpad swipe moves exactly one card", active(p)[0] == ORDER[2], str(active(p)))
    # a real trackpad: the glide keeps sending events for over a second after the fingers lift
    tail = [max(1, round(30 * 0.94 ** k)) for k in range(70)]
    s0 = active(p)[2]
    for d in [4, 12, 24] + tail: p.mouse.wheel(0, d); p.wait_for_timeout(16)
    p.wait_for_timeout(900)
    check("desktop: one trackpad swipe with a long glide moves exactly one card", active(p)[2] == s0 + 1, f"{s0} -> {active(p)}")
    s0 = active(p)[2]
    for d in [4, 12, 24] + tail[:30] + [6, 14, 26, 34] + tail: p.mouse.wheel(0, d); p.wait_for_timeout(16)
    p.wait_for_timeout(900)
    check("desktop: a second trackpad swipe during the glide counts (no tap needed)", active(p)[2] == s0 + 2, f"{s0} -> {active(p)}")
    for _ in range(4): p.mouse.wheel(0, -100); p.wait_for_timeout(1100)
    check("desktop: wheel up goes back one card", active(p)[0] == ORDER[1], str(active(p)))
    for d in [4, 10, 20, 30, 25, 15, 8, 3]:
        p.mouse.wheel(d, 0); p.wait_for_timeout(16)
    p.wait_for_timeout(700)
    check("desktop: trackpad sideways (fingers left) opens details", active(p)[1] == "details", str(active(p)))
    for d in [4, 10, 20, 30, 25, 15, 8, 3]:
        p.mouse.wheel(-d, 0); p.wait_for_timeout(16)
    p.wait_for_timeout(700)
    check("desktop: trackpad sideways (fingers right) returns to the chart", active(p)[1] == "main", str(active(p)))
    for d in [4, 10, 20, 30, 25, 15, 8, 3]:
        p.mouse.wheel(-d, 0); p.wait_for_timeout(16)
    p.wait_for_timeout(700)
    before = p.evaluate("document.querySelector('.card.active [data-pane=news]').scrollTop")
    p.mouse.wheel(0, 300); p.wait_for_timeout(800)
    after = p.evaluate("document.querySelector('.card.active [data-pane=news]').scrollTop")
    check("desktop: wheel inside news scrolls the news list, not the feed", active(p)[1] == "news" and active(p)[0] == ORDER[1], f"{active(p)} scroll {before}->{after}")
    for d in [4, 10, 20, 30, 25, 15, 8, 3]:
        p.mouse.wheel(d, 0); p.wait_for_timeout(16)
    p.wait_for_timeout(700)
    p.mouse.move(800, 450); p.mouse.down(); p.mouse.move(500, 455, steps=10); p.mouse.up(); p.wait_for_timeout(700)
    check("desktop: mouse drag left opens details", active(p)[1] == "details", str(active(p)))
    p.keyboard.press("ArrowLeft"); p.wait_for_timeout(500)
    check("desktop: left arrow returns to the chart", active(p)[1] == "main", str(active(p)))
    p.keyboard.press("ArrowDown"); p.wait_for_timeout(1100)
    check("desktop: down arrow moves to the next card", active(p)[0] == ORDER[2], str(active(p)))
    check("desktop: no JavaScript errors", not errs, " | ".join(errs[:3]))
    p.close()

def group_test(b):
    # Groups and challenges, end to end on one phone (demo mode: three made-up friends join every group you start and pick too).
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.route("https://api.kraken.com/**", steady_kraken_route); demo_mode(ctx); ctx.add_init_script(NOCOACH)
    p = ctx.new_page(); errs = []
    p.on("pageerror", lambda e: errs.append(str(e))); p.on("dialog", lambda d: d.accept())
    social = lambda: p.evaluate("JSON.parse(localStorage.getItem('pl.demoSocial')||'{}')")
    p.goto(BASE); p.wait_for_timeout(2500); pass_gate(p, three_months=False); p.wait_for_timeout(1200)
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(600); p.click("[data-pv=groups]"); p.wait_for_timeout(300)
    check("groups: with no groups, Groups explains itself and offers to start one", "Play with friends" in p.inner_text("#play") and p.is_visible("#plNewG"))
    p.click("#plNewG"); p.wait_for_timeout(500); p.fill("#ngIn", "Weekend crew"); p.click("#ngGo"); p.wait_for_timeout(1300)
    st = social(); gid = next(iter(st.get("groups", {})), None); grp = st["groups"].get(gid, {}) if gid else {}
    acct = p.evaluate("JSON.parse(localStorage.getItem('pl.demoAccount'))")
    check("groups: a new group records who started it (account and username) and lists them as its first member, and the group is on my account",
          grp.get("owner") == "me" and grp.get("ownerName") == "chart_fan" and grp.get("members", {}).get("me") == "chart_fan" and acct.get("groups") == [gid] and len(gid or "") == 20, json.dumps(grp)[:200])
    check("groups: the new group opens on its own page, with its link to share", p.is_visible("#grp") and not p.is_visible("#sheet") and "Weekend crew" in p.inner_text("#grp .grp-t") and p.is_visible("#grShare") and p.is_visible("#grp #grNew"))
    p.click("#grNew"); p.wait_for_timeout(600); p.click("#sheet [data-h='1h']"); p.wait_for_timeout(300)
    hint = p.inner_text("#cInMsg"); hi = float(_re.search(r"\$([\d,.]+) or higher", hint).group(1).replace(",", ""))
    p.fill("#cIn", f"{hi * 1.01:.4f}"); p.wait_for_timeout(200)
    counts_default = p.is_checked("#sheet input[name=pcnt][value=counts]")
    p.click("#cGo"); p.wait_for_timeout(1500)
    st = social(); ch = (st.get("ch", {}).get(gid) or [{}])[0]
    preds = p.evaluate("JSON.parse(localStorage.getItem('pl.demoPreds')).open")
    cp = [x for x in preds if x.get("c") == ch.get("id")]
    check("challenge: starting one is the first pick; the group's friends pick too; it ends one hour later for everyone",
          ch.get("by") == "me" and ch.get("byName") == "chart_fan" and ch.get("horizon") == "1h" and sorted(ch.get("picked", {}).values()) == ["asha", "chart_fan", "dev", "rohan"]
          and abs((_dt(ch["endAt"]) - _dt(ch["at"])) - 3600) < 2 and abs((_dt(ch["joinUntil"]) - _dt(ch["at"])) - 1200) < 2, json.dumps(ch)[:240])
    check("challenge: a pick that counts (the default) is also an ordinary prediction with the challenge's end time", counts_default and len(cp) == 1 and cp[0].get("endAt") == ch.get("endAt") and cp[0].get("g") == gid, str(cp)[:200])
    body = p.inner_text("#grp")
    check("challenge: the card shows who started it, how many picked and that prices are hidden", "Started by you" in body and "4 of 4 picked" in body and "prices hidden" in body and "Your call:" in body, body[:200].replace("\n", " "))
    p.click("#grBack"); p.wait_for_timeout(500)
    check("groups: the back button closes the group page", not p.is_visible("#grp") and p.is_visible("#play"))
    p.click("#play [data-g]"); p.wait_for_timeout(600); p.go_back(); p.wait_for_timeout(600)
    check("groups: the phone's back button closes the group page too", not p.is_visible("#grp") and p.is_visible("#play"))
    p.click("[data-pv=calls]"); p.wait_for_timeout(300)
    check("calls: the open call shows which group it's for", "Weekend crew" in p.inner_text("#play .pl-view"))
    # a friend starts an ETH challenge: it waits for my pick
    p.evaluate("""((g)=>{const d=JSON.parse(localStorage.getItem('pl.demoSocial')), M=60000, now=Date.now(), iso=(x)=>new Date(x).toISOString(), c='waitingforpickxxxxxxx';
      d.ch[g].push({id:c,coin:'CRYPTO:ETH',t:'ETH',horizon:'1h',by:'demo_asha',byName:'asha',at:iso(now-2*M),joinUntil:iso(now+18*M),endAt:iso(now+58*M),picked:{demo_asha:'asha'},status:'open'});
      d.picks.push({a:'demo_asha',g,c,coin:'CRYPTO:ETH',t:'ETH',horizon:'1h',target:1,counts:false,createdAt:iso(now-2*M),endAt:iso(now+58*M),cast:true});
      localStorage.setItem('pl.demoSocial', JSON.stringify(d));})""", gid)
    p.reload(); p.wait_for_timeout(3000); p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(600)
    badge = p.inner_text(".tabbar [data-tab=play] .badge") if p.locator(".tabbar [data-tab=play] .badge").is_visible() else ""
    strip = p.inner_text("#play [data-pick]") if p.locator("#play [data-pick]").count() else ""
    check("challenge: a challenge waiting for my pick shows on the Predict tab (badge) and at the top of the page", badge.strip() == "1" and "Weekend crew needs your pick" in strip and "ETH · 1 hour" in strip and "closes in" in strip, f"{badge!r} {strip!r}")
    p.click("#play [data-pick]"); p.wait_for_timeout(700)
    hint = p.inner_text("#kInMsg"); lo = float(_re.search(r"\$([\d,.]+) or lower", hint).group(1).replace(",", ""))
    p.fill("#kIn", f"{lo * 0.99:.4f}"); p.wait_for_timeout(200); p.click("#sheet input[name=pcnt][value=group]"); p.wait_for_timeout(200); p.click("#kGo"); p.wait_for_timeout(1500)
    st = social(); eth = [c for c in st["ch"][gid] if c["t"] == "ETH"][0]; mine = [x for x in st["picks"] if x.get("a") == "me" and x["c"] == eth["id"]]
    check("challenge: making a group-only pick seals it and adds me to the challenge, with no prediction", "me" in eth["picked"] and len(mine) == 1 and mine[0]["counts"] is False and not any(x.get("c") == eth["id"] for x in p.evaluate("JSON.parse(localStorage.getItem('pl.demoPreds')).open")), str(mine)[:200])
    check("challenge: once picked, nothing waits for me", not p.locator(".tabbar [data-tab=play] .badge").is_visible() or p.inner_text(".tabbar [data-tab=play] .badge").strip() in ("", "0"))
    if p.is_visible("#sheet"): p.click("#sheet [data-close]"); p.wait_for_timeout(400)
    # fast-forward: both challenges ended 10 minutes ago
    p.evaluate("""(()=>{const d=JSON.parse(localStorage.getItem('pl.demoSocial')), M=60000, end=Date.now()-10*M, iso=(x)=>new Date(x).toISOString();
      for (const g in d.ch) for (const c of d.ch[g]) { c.at=iso(end-60*M); c.joinUntil=iso(end-40*M); c.endAt=iso(end); }
      for (const p of d.picks) { p.createdAt=iso(end-58*M); p.endAt=iso(end); delete p.p0; delete p.status; }
      localStorage.setItem('pl.demoSocial', JSON.stringify(d));
      const q=JSON.parse(localStorage.getItem('pl.demoPreds')); for (const p of q.open) if (p.c) { p.createdAt=iso(end-58*M); p.endAt=iso(end); } localStorage.setItem('pl.demoPreds', JSON.stringify(q)); })()""")
    p.reload(); p.wait_for_timeout(3000); p.click("#status"); p.wait_for_timeout(6000)
    st = social(); chs = st["ch"][gid]; done = [c for c in chs if c["status"] == "done"]
    res = [r for c in done for r in c.get("results", [])]
    check("results: both challenges are scored at their shared end time; picks are deleted once revealed; the group's table gets the points",
          len(done) == 2 and not st["picks"] and st["groups"][gid].get("table", {}).get("me", {}).get("all", -1) >= 0 and all(set(r) >= {"a", "u", "label", "pts", "rank"} for r in res)
          and not any(k in json.dumps(res) for k in ["target", "actual", "p0"]), json.dumps([(c["t"], c["status"], [(r["u"], r["label"], r["pts"]) for r in c.get("results", [])]) for c in chs])[:300])
    p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(600); p.click("[data-pv=groups]"); p.wait_for_timeout(400)
    check("results: Groups says new results are in", "results are in" in p.inner_text("#play [data-g]"))
    p.click("#play [data-g]"); p.wait_for_timeout(800)
    sealed = p.locator("#grp [data-reveal]").count()
    check("results: results stay sealed until tapped (no labels shown yet)", sealed == 2 and "Spot on" not in p.inner_text("#grp .sealed >> nth=0"), str(sealed))
    p.click("#grp [data-reveal] >> nth=0"); p.wait_for_timeout(120); flipped = p.locator("#grp .chcard.flip").count(); p.wait_for_timeout(1300)
    card = p.inner_text("#grp .chcard >> nth=0")
    check("results: tapping flips the card open: everyone ranked with how close and which way, and their points, never a price",
          flipped == 1 and _re.search(r"@chart_fan", card) and _re.search(r"\+\d", card) and any(l in card for l in ["Spot on", "Very close", "Close", "Off", "Far off", "Not counted"]) and "called" not in card, card.replace("\n", " ")[:300])
    p.click("#grp [data-rx$='|nice'] >> nth=0"); p.wait_for_timeout(600)
    check("results: reacting to a result is saved and shown", p.get_attribute("#grp [data-rx$='|nice'] >> nth=0", "aria-pressed") == "true" and "Nice call · 1" in p.inner_text("#grp [data-rx$='|nice'] >> nth=0"))
    p.click("#grp [data-reveal] >> nth=0"); p.wait_for_timeout(1400)
    sealed_left = p.locator("#grp [data-reveal]").count(); p.click("#grTable"); p.wait_for_timeout(500); tbl = p.inner_text("#sheet")
    check("results: once both are opened, nothing is left sealed and the table shows this month's points", sealed_left == 0 and "table" in tbl.lower() and "pts" in tbl, tbl[:120].replace("\n", " "))
    p.click("#sheet [data-close]"); p.wait_for_timeout(400); p.click("#grBack"); p.wait_for_timeout(500); p.click("#play [data-g]"); p.wait_for_timeout(700)
    tl = p.evaluate("[...document.querySelectorAll('#grp .grp-b > *')].map(e => e.className.split(' ')[0]).join(',')")
    check("group page: a timeline with day labels; results already seen fold to one neat line each", p.locator("#grp .grp-res").count() == 2 and p.locator("#grp .chcard").count() == 0 and "grp-day" in tl and p.is_hidden(".tabbar"), tl)
    p.click("#grp .grp-res >> nth=0"); p.wait_for_timeout(400)
    check("group page: tapping a folded result opens it in full", p.locator("#grp .grp-res").count() == 1 and p.locator("#grp .chcard").count() == 1)
    p.click("#grBack"); p.wait_for_timeout(500); p.click("[data-pv=ranks]"); p.wait_for_timeout(400)
    rk = p.inner_text(f"#play [data-board='{gid}']")
    check("ranks: the group shows on Ranks with my place this month", "Weekend crew" in rk and _re.search(r"\d(st|nd|rd|th)", rk) and "pts" in rk, rk.replace("\n", " "))
    # find and follow a player
    p.click("#plFind"); p.wait_for_timeout(600); p.fill("#fpIn", "as"); p.wait_for_timeout(700)
    hits = p.locator("#fpRes .pl-hit .t").all_inner_texts()
    check("search: typing the start of a username finds players", hits == ["@asha", "@ashwin", "@aslan"], str(hits))
    p.click("#fpRes [data-f='demo_asha']"); p.wait_for_timeout(500)
    acct = p.evaluate("JSON.parse(localStorage.getItem('pl.demoAccount'))")
    check("search: following a player saves them to my private list", p.inner_text("#fpRes [data-f='demo_asha']") == "Following" and acct.get("following") == ["demo_asha"], str(acct.get("following")))
    p.click("#fpRes [data-a='demo_asha']"); p.wait_for_timeout(700)
    pc = p.inner_text("#sheet")
    check("player card: shows the username, score, followers and record, with Follow and Invite", "@asha" in pc and "814" in pc and "followers" in pc and "Following" in p.inner_text("#pcFollow") and p.is_visible("#pcInvite") and "groups in common" in pc.lower(), pc.replace("\n", " ")[:200])
    p.click("#sheet [data-close]"); p.wait_for_timeout(500)
    fr = p.inner_text("#play [data-board=following]")
    check("ranks: 'People you follow' ranks me against who I follow", _re.search(r"\d(st|nd|rd|th)", fr) and "of 2" in fr, fr.replace("\n", " "))
    p.click("#plMe"); p.wait_for_timeout(500); p.click("#sheet [data-av=following]"); p.wait_for_timeout(600)
    check("following: the account sheet lists who I follow, only to me", "@asha" in p.inner_text("#flList"))
    p.click("#sheet [data-close]"); p.wait_for_timeout(400)
    # the public leaderboard is opt-in
    p.click("#play [data-board=everyone]"); p.wait_for_timeout(500)
    join = p.is_visible("#jbGo"); p.click("#jbGo"); p.wait_for_timeout(600)
    acct = p.evaluate("JSON.parse(localStorage.getItem('pl.demoAccount'))")
    p.click("#play [data-board=everyone]"); p.wait_for_timeout(700)
    rows = p.locator("#sheet .lbrow").count(); tabs = p.locator("#sheet [data-bt]").all_inner_texts()
    check("leaderboard: joining it is a choice; the board lists public players and has tabs for following and each group", join and acct.get("public") is True and rows >= 5 and tabs[:2] == ["Everyone", "Following"] and "Weekend crew" in tabs, f"{rows} {tabs}")
    p.click("#sheet [data-bt='following']"); p.wait_for_timeout(500)
    check("leaderboard: the Following tab shows me and who I follow", "@asha" in p.inner_text("#sheet [data-bl]") and "you" in p.inner_text("#sheet [data-bl]"))
    p.click("#sheet [data-close]"); p.wait_for_timeout(400)
    # leave the group: it's gone from my account and the page
    p.click("[data-pv=groups]"); p.wait_for_timeout(300); p.click("#play [data-g]"); p.wait_for_timeout(700); p.click("#grInfo"); p.wait_for_timeout(500)
    info = p.inner_text("#sheet")
    check("group info: lists the players, who started it, and lets the starter rename and remove", "Started the group" in info and p.is_visible("#giRen") and p.locator("#sheet [data-rm]").count() == 3, info[:160].replace("\n", " "))
    p.click("#giLeave"); p.wait_for_timeout(900)
    acct = p.evaluate("JSON.parse(localStorage.getItem('pl.demoAccount'))")
    check("groups: leaving a group removes it from my account and the page", acct.get("groups") == [] and gid not in social().get("groups", {}) and "Play with friends" in p.inner_text("#play"), str(acct.get("groups")))
    # holding anything for 3 seconds asks for feedback, inside sheets too
    p.click("#plMe"); p.wait_for_timeout(600); cdp = ctx.new_cdp_session(p)
    bx = p.locator("#sheet [data-av=chart]").bounding_box(); x, y = bx["x"] + 60, bx["y"] + bx["height"] / 2
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]}); p.wait_for_timeout(3300)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); p.wait_for_timeout(500)
    asked = p.inner_text("#sheet") if p.is_visible("#sheet") else ""
    check("feedback: holding a row in a sheet for 3 seconds asks to leave feedback about that row", "Leave feedback?" in p.inner_text("#shTitle") and "Chart style" in asked and "Sheet · Account" in asked, asked[:120].replace("\n", " "))
    p.click("#sheet [data-fbyes]"); p.wait_for_timeout(500); p.fill("#fbText", "Test note"); p.click("#fbSend"); p.wait_for_timeout(700)
    notes = p.evaluate("JSON.parse(localStorage.getItem('pl.demoFeedback')||'[]')")
    check("feedback: the note is saved with where it was left", bool(notes) and notes[0]["where"].startswith("Row: Chart style") and notes[0]["screen"] == "Sheet · Account", str(notes[:1])[:160])
    check("groups: no JavaScript errors", not errs, " | ".join(errs[:3]))
    ctx.close()

def _dt(s):
    import datetime as _d
    return _d.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

def screens_test(b):
    # Every new screen at common phone sizes, a phone on its side, a desktop window and the light theme:
    # nothing wider than the screen, nothing cut off at the side.
    sizes = [(320, 640, False, "dark"), (360, 780, False, "dark"), (390, 844, False, "light"), (430, 932, False, "dark"), (844, 390, False, "dark"), (1280, 800, True, "dark")]
    over = """((sel)=>{const W=innerWidth, bad=[]; const root=document.querySelector(sel); if(!root) return ['missing '+sel];
      if (document.documentElement.scrollWidth>W+1) bad.push('page '+document.documentElement.scrollWidth);
      for (const e of root.querySelectorAll('*')) { const r=e.getBoundingClientRect(); if(!r.width||!r.height) continue;
        let p=e.parentElement, clipped=false; while(p&&p!==document.body){const s=getComputedStyle(p); if(/(auto|scroll|hidden)/.test(s.overflowX)&&p.scrollWidth>p.clientWidth+1){clipped=true;break;} p=p.parentElement;}
        if(!clipped&&(r.right>W+1||r.left<-1)) bad.push((e.id||e.className||e.tagName)+' '+Math.round(r.left)+'..'+Math.round(r.right)); }
      return bad.slice(0,5);})"""
    for w, h, desk, theme in sizes:
        ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=not desk, has_touch=not desk, color_scheme=theme)
        ctx.route("https://api.kraken.com/**", steady_kraken_route); demo_mode(ctx); ctx.add_init_script(NOCOACH)
        p = ctx.new_page(); errs = []; p.on("pageerror", lambda e: errs.append(str(e))); p.on("dialog", lambda d: d.accept())
        p.goto(BASE); p.wait_for_timeout(2500); pass_gate(p, three_months=False); p.wait_for_timeout(1000)
        if theme == "light":
            p.evaluate("(()=>{const a=JSON.parse(localStorage.getItem('pl.demoAccount')); a.settings.theme='light'; localStorage.setItem('pl.demoAccount', JSON.stringify(a))})()"); p.reload(); p.wait_for_timeout(2500)
        tag = f"{w}x{h}{' desktop' if desk else ''} {theme}"
        bad = {}
        p.click(".tabbar [data-tab=play]"); p.wait_for_timeout(600)
        for v in ["calls", "groups", "ranks"]:
            p.click(f"[data-pv={v}]"); p.wait_for_timeout(300); bad[v] = p.evaluate(over, "#play")
        p.click("[data-pv=groups]"); p.click("#plNewG"); p.wait_for_timeout(500); p.fill("#ngIn", "A group with a long name"); p.click("#ngGo"); p.wait_for_timeout(1200)
        p.click("#grNew"); p.wait_for_timeout(600); bad["challenge sheet"] = p.evaluate(over, "#sheet")
        hint = p.inner_text("#cInMsg"); hi = float(_re.search(r"\$([\d,.]+) or higher", hint).group(1).replace(",", ""))
        p.fill("#cIn", f"{hi * 1.01:.4f}"); p.wait_for_timeout(200); p.click("#cGo"); p.wait_for_timeout(1500)
        bad["group page"] = p.evaluate(over, "#grp")
        foot = p.evaluate("(()=>{const f=document.querySelector('#grp .grp-f'); if(!f) return 'missing'; const r=f.getBoundingClientRect(); return r.bottom<=innerHeight+1 && r.top>=0 ? 'ok' : r.top+'..'+r.bottom})()")
        p.click("#grInfo"); p.wait_for_timeout(500); bad["group info"] = p.evaluate(over, "#sheet")
        p.click("#sheet [data-close]"); p.wait_for_timeout(400); p.click("#grBack"); p.wait_for_timeout(500)
        p.click("#plMe"); p.wait_for_timeout(500); bad["account sheet"] = p.evaluate(over, "#sheet")
        p.click("#sheet [data-av=card]"); p.wait_for_timeout(600); bad["player card"] = p.evaluate(over, "#sheet")
        p.click("#sheet [data-close]"); p.wait_for_timeout(400)
        p.click("[data-pv=ranks]"); p.wait_for_timeout(300); p.click("#play [data-board=following]"); p.wait_for_timeout(600); bad["leaderboard"] = p.evaluate(over, "#sheet")
        p.click("#sheet [data-close]"); p.wait_for_timeout(400)
        p.click("[data-pv=calls]"); p.click("#play [data-pp] >> nth=0"); p.wait_for_timeout(600); bad["predict sheet"] = p.evaluate(over, "#sheet")
        p.click("#sheet [data-close]"); p.wait_for_timeout(400)
        p.click(".tabbar [data-tab=dash]"); p.wait_for_timeout(700); bad["coins"] = p.evaluate(over, "#dash")
        tabs = p.evaluate("(()=>{const t=document.querySelector('.tabbar').getBoundingClientRect(); return t.bottom<=innerHeight+1 && t.right<=innerWidth+1})()")
        if theme == "light": check(f"screens {tag}: the light theme is on", p.get_attribute("html", "data-theme") == "light")
        bad = {k: v for k, v in bad.items() if v}
        check(f"screens {tag}: Predict, groups, sheets and Coins fit the screen (no sideways overflow)", not bad, json.dumps(bad)[:400])
        check(f"screens {tag}: the group page's New challenge button and the tab bar stay on screen", foot == "ok" and tabs, f"{foot} {tabs}")
        check(f"screens {tag}: no JavaScript errors", not errs, " | ".join(errs[:3]))
        ctx.close()

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME)
    try: tour_test(b)
    except Exception as e: check("tour: test ran", False, repr(e)[:300])
    try: ios_homescreen_test(b)
    except Exception as e: check("iOS Home Screen: test ran", False, repr(e)[:300])
    try: phone_tests(b)
    except Exception as e: check("phone: suite ran to the end", False, repr(e)[:300])
    try: landscape_test(b)
    except Exception as e: check("landscape: test ran", False, repr(e)[:300])
    try: desktop_tests(b)
    except Exception as e: check("desktop: suite ran to the end", False, repr(e)[:300])
    try: prediction_test(b)
    except Exception as e: check("predict: suite ran to the end", False, repr(e)[:300])
    try: group_test(b)
    except Exception as e: check("groups: suite ran to the end", False, repr(e)[:300])
    try: screens_test(b)
    except Exception as e: check("screens: suite ran to the end", False, repr(e)[:300])
    b.close()

fails = [r for r in results if not r[1]]
print(f"e2e: {len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
