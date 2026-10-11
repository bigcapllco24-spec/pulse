"""End-to-end tests for the Pulse web app in demo mode.
Run:  cd web && python3 -m http.server 8773   (in another terminal)
      python3 tests/e2e.py [base_url]
Needs Python Playwright and Chromium. Prints a PASS/FAIL line per check and exits non-zero on any failure.
"""
import sys, time, json
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

# Kraken stand-in: the test browser has no internet, so every coin gets 120 days of made-up daily candles.
import json as _json, random as _random, re as _re
def kraken_route(route):
    pair = _re.search(r"pair=([A-Z]+)", route.request.url).group(1)
    rnd = _random.Random(pair); price = rnd.uniform(0.2, 900); rows = []; t0 = 1781913600
    for k in range(120):
        o = price; c = o * (1 + rnd.gauss(0, 0.03)); h = max(o, c) * (1 + abs(rnd.gauss(0, 0.01))); l = min(o, c) * (1 - abs(rnd.gauss(0, 0.01)))
        rows.append([t0 + k * 86400, f"{o:.6f}", f"{h:.6f}", f"{l:.6f}", f"{c:.6f}", f"{c:.6f}", f"{rnd.uniform(1e3, 1e6):.2f}", 100]); price = c
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=_json.dumps({"error": [], "result": {pair: rows, "last": rows[-1][0]}}))

def active(p):
    return p.evaluate("(()=>{const c=document.querySelector('.card.active');return c?[c.getAttribute('aria-label'),c.dataset.view||'main',+c.dataset.i]:[null,null,-1]})()")

def phone_tests(b):
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.route("https://api.kraken.com/**", kraken_route)
    p = ctx.new_page(); errs = []
    p.on("pageerror", lambda e: errs.append(str(e)))
    p.goto(BASE); p.wait_for_timeout(2500)
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
    left()

    # charts
    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1200)
    chart_ok, chart_detail, stock_ok, stock_detail = True, [], True, []
    for i, name in enumerate(ORDER):
        p.evaluate(f"document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight*{i+1})")
        p.wait_for_timeout(1300)
        info = p.evaluate("""(()=>{const c=document.querySelector('.card.active'); const svg=c.querySelector('.chartbox svg.chart');
          return {svg: !!svg, rects: svg? svg.querySelectorAll('rect').length:0, last: c.querySelector('.axlast')?.textContent||'', price: c.querySelector('.price')?.textContent||'',
          lower: c.querySelectorAll('.lower svg').length, lowerText: [...c.querySelectorAll('.lower-label')].map(x=>x.textContent).join(' | '), frames: document.querySelectorAll('iframe').length}})()""")
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

    # hold and slide on the chart reads any day; releasing offers a one-tap alert at that level
    box = p.evaluate("(()=>{const r=document.querySelector('.card.active .chartbox').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    cx, cy = box[0] + box[2] * 0.5, box[1] + box[3] * 0.4
    pos0 = active(p); top0 = p.evaluate("document.getElementById('feed').scrollTop")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": cx, "y": cy}]}); p.wait_for_timeout(450)
    for k in range(1, 9):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": cx - 15 * k, "y": cy + 4 * k}]}); time.sleep(0.03)
    st = p.evaluate("(()=>{const c=document.querySelector('.card.active');return {tk:c.querySelector('.tk').textContent, info:c.querySelector('.scrubinfo')?.textContent||'', lines:c.querySelectorAll('.xh').length}})()")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); p.wait_for_timeout(300)
    moved = p.evaluate("document.getElementById('feed').scrollTop") != top0 or active(p)[1] != "main"
    check("phone: holding the chart shows that day's date, prices, RSI and MACD without moving the feed",
          "·" in st["tk"] and "RSI" in st["info"] and "MACD" in st["info"] and st["lines"] >= 3 and not moved and active(p)[0] == pos0[0], f"{st} moved={moved}")
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
    check("phone: tab bar is Dashboard, Feed (centre), Profile and sits on the bottom edge", tabs == "dash,feed,profile" and abs(tb[0] - tb[1]) < 1, f"{tabs} {tb}")
    ov = p.evaluate("""(()=>{const c=document.querySelector('.card.active'); return [...c.querySelectorAll('.lower')].every(l=>l.querySelector('.lower-label').getBoundingClientRect().bottom <= l.querySelector('svg').getBoundingClientRect().top + 0.5)})()""")
    check("phone: RSI and MACD labels sit above their lines, not on them", ov)

    # add-stock sheet with a new watchlist
    p.click("#addBtn"); p.wait_for_timeout(500)
    p.fill("#addQ", "cardano"); p.wait_for_timeout(600)
    first = p.locator(".result").first.inner_text() if p.locator(".result").count() else ""
    check("phone: search finds Cardano (ADA)", "ADA" in first, first.replace("\n", " "))
    p.locator(".result").first.click(); p.wait_for_timeout(300)
    p.fill("#newWl", "Altcoins"); p.click("#doAdd"); p.wait_for_timeout(700)
    toast = p.inner_text("#toast") if p.is_visible("#toast") else ""
    check("phone: adding to a new watchlist confirms with Undo", "Altcoins" in toast and "Undo" in toast, toast)
    check("phone: sheet returns to search for the next stock", p.locator("#addQ").count() == 1)
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

    # dashboard
    p.click(".tabbar [data-tab=dash]"); p.wait_for_timeout(800)
    rows = p.locator("#dash .list [data-open]").count()
    check("phone: dashboard lists coins with data and the other symbols", rows >= len(ORDER), f"rows={rows}")
    p.locator("#dash [data-open='CRYPTO:XRP']").click(); p.wait_for_timeout(1300)
    check("phone: tapping a dashboard row opens that card in the feed", active(p)[0] == "XRP", str(active(p)))

    # watchlists live on the dashboard: chips switch lists (and the feed), Edit removes a coin
    p.click(".tabbar [data-tab=dash]"); p.wait_for_timeout(500)
    chips = p.locator("#dash .wchip[data-l]").all_inner_texts()
    check("phone: dashboard shows watchlist chips (All, My watchlist, Altcoins)", len(chips) >= 3 and any("Altcoins" in c for c in chips), " | ".join(chips))
    p.locator("#dash .wchip", has_text="Altcoins").click(); p.wait_for_timeout(500)
    n_alt = p.locator("#dash .list [data-open]").count()
    p.click(".tabbar [data-tab=feed]"); p.wait_for_timeout(1200)
    check("phone: picking a watchlist on the dashboard filters it and the feed", n_alt == 1 and p.inner_text("#switchName") == "Altcoins", f"rows={n_alt} feed={p.inner_text('#switchName')}")
    p.click(".tabbar [data-tab=dash]"); p.wait_for_timeout(500)
    p.locator("#dash .wchip", has_text="My watchlist").click(); p.wait_for_timeout(400)
    before = p.locator("#dash .list [data-open]").count()
    p.click("#dEdit"); p.wait_for_timeout(300); p.locator("#dash [data-rm]").first.click(); p.wait_for_timeout(300); p.click("#dDone"); p.wait_for_timeout(400)
    after = p.locator("#dash .list [data-open]").count()
    check("phone: Edit on the dashboard removes a coin from the watchlist", after == before - 1, f"{before} -> {after}")
    p.locator("#dash .wchip", has_text="All").first.click(); p.wait_for_timeout(400)

    # profile pages
    p.click(".tabbar [data-tab=profile]"); p.wait_for_timeout(500)
    pages_ok, bad = True, []
    for sub in ["chart", "indicators", "rules", "alerts", "lists", "account", "appearance", "legal"]:
        p.click(f"[data-p={sub}]"); p.wait_for_timeout(350)
        h = p.inner_text("#profile h1")
        if not h: pages_ok = False; bad.append(sub)
        p.click("#pBack"); p.wait_for_timeout(250)
    check("phone: every profile page opens and goes back", pages_ok, ",".join(bad))

    # chart style changes reach the feed
    p.click("[data-p=chart]"); p.wait_for_timeout(300)
    p.click("[data-k=window][data-v='20']"); p.click("[data-k=type][data-v=line]"); p.click("[data-k=lower][data-v=MACD]"); p.wait_for_timeout(300)
    p.click(".tabbar [data-tab=feed]"); p.wait_for_timeout(1200)
    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1200)
    line = p.locator(".card.active .chartbox .pline").count(); low = p.inner_text(".card.active .lower-label")
    check("phone: chart style (line, MACD) applies to cards", line == 1 and "MACD" in low, f"line={line} / {low}")

    # indicator switch reaches details
    p.click(".tabbar [data-tab=profile]"); p.wait_for_timeout(300); p.click("#pBack") if p.locator("#pBack").count() else None
    p.click("[data-p=indicators]"); p.wait_for_timeout(300)
    p.locator("[data-act=bb]").check(); p.wait_for_timeout(300)
    p.click(".tabbar [data-tab=feed]"); p.wait_for_timeout(1200)
    p.evaluate("document.getElementById('feed').scrollTo(0, document.getElementById('feed').clientHeight)"); p.wait_for_timeout(1200)
    left(); txt = p.inner_text(".card.active [data-pane=details]")
    check("phone: switching on Bollinger %B adds it to details", "Bollinger" in txt)
    right()

    # rules make alerts (demo mode checks rules on the phone)
    p.click(".tabbar [data-tab=profile]"); p.wait_for_timeout(300); p.click("#pBack") if p.locator("#pBack").count() else None
    p.click("[data-p=rules]"); p.wait_for_timeout(300)
    p.select_option("#rMetric", "rsi14"); p.select_option("#rOp", "below"); p.fill("#rVal", "99"); p.click("#rForm button"); p.wait_for_timeout(500)
    p.click("#pBack"); p.click("[data-p=alerts]"); p.wait_for_timeout(300)
    n_alerts = p.locator("#profile .list .row").count()
    check("phone: a rule that is met creates alerts and the red dot", n_alerts >= 1 and p.is_visible("#alertDot"), f"alerts={n_alerts}")

    # appearance
    p.click("#pBack"); p.click("[data-p=appearance]"); p.click("[data-t=light]"); p.wait_for_timeout(300)
    check("phone: light theme switches", p.evaluate("document.documentElement.dataset.theme") == "light")
    p.click("[data-t=dark]")

    # refresh
    p.click(".tabbar [data-tab=feed]"); p.wait_for_timeout(500); p.click("#status"); p.wait_for_timeout(9500)
    st = p.inner_text("#status")
    check("phone: refresh finishes (never stuck on Updating)", "Updating" not in st, st)

    # daily recap on the first card after the first visit
    p.evaluate("localStorage.setItem('pl.lastOpen', JSON.stringify(new Date(Date.now()-3600e3).toISOString()))"); p.reload(); p.wait_for_timeout(2500)
    rc = p.inner_text(".card.active") if p.locator(".card.active").count() else ""
    check("phone: the first card is a daily recap (up count, biggest rise and fall)", "daily recap" in rc.lower() and "biggest rise" in rc.lower() and "up today" in rc.lower(), rc[:150].replace("\n", " "))
    check("phone: no JavaScript errors", not errs, " | ".join(errs[:3]))
    ctx.close()

def ios_homescreen_test(b):
    # Simulates the iOS Home Screen bug: the page is laid out 56 px shorter than the screen.
    ctx = b.new_context(viewport={"width": 390, "height": 788}, is_mobile=True, has_touch=True,
                        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")
    ctx.add_init_script("Object.defineProperty(navigator,'standalone',{get:()=>true}); Object.defineProperty(screen,'height',{get:()=>844}); Object.defineProperty(screen,'width',{get:()=>390});")
    ctx.route("https://api.kraken.com/**", kraken_route)
    p = ctx.new_page(); p.goto(BASE); p.wait_for_timeout(1500)
    r = p.evaluate("(()=>{const t=document.querySelector('.tabbar').getBoundingClientRect(), f=document.getElementById('feed'); return [t.bottom, f.clientHeight, getComputedStyle(document.documentElement).getPropertyValue('--gapb').trim()]})()")
    check("iOS Home Screen: tab bar and feed reach the real bottom of the screen (no empty strip)", abs(r[0] - 844) < 1 and r[1] == 844, str(r))
    ctx.close()

def desktop_tests(b):
    p = b.new_page(viewport={"width": 1280, "height": 800}); errs = []
    p.route("https://api.kraken.com/**", kraken_route)
    p.on("pageerror", lambda e: errs.append(str(e)))
    p.goto(BASE); p.wait_for_timeout(2500)
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

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME)
    try: ios_homescreen_test(b)
    except Exception as e: check("iOS Home Screen: test ran", False, repr(e)[:300])
    try: phone_tests(b)
    except Exception as e: check("phone: suite ran to the end", False, repr(e)[:300])
    try: desktop_tests(b)
    except Exception as e: check("desktop: suite ran to the end", False, repr(e)[:300])
    b.close()

fails = [r for r in results if not r[1]]
print(f"e2e: {len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
