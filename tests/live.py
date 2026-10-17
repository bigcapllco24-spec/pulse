"""Real-database tests for Pulse: the app against the Firebase emulators (Auth + Firestore with firestore.rules), on an
iPhone (WebKit, Safari's engine) and an Android phone (Chromium, on a slow mobile connection), the way people use it:
typing key by key, tapping, signing out and in, two phones on one account, the data jobs scoring calls.

Run (GitHub Actions does this on every push, see .github/workflows/tests.yml):
  npx firebase-tools emulators:exec --project demo-pulse --only auth,firestore "python3 tests/live.py"
Needs: the emulators on 127.0.0.1:8080 (Firestore) and :9099 (Auth), Python Playwright with Chromium and WebKit,
Node 20+. Serves web/ itself. Prints PASS/FAIL per check and exits non-zero on any failure.
"""
import sys, os, time, json, re, subprocess, threading, functools, http.server, socketserver, urllib.request, tempfile, math
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
import e2e  # the Kraken stand-in (steady prices) and the PASS/FAIL list are shared with the demo-mode tests
from e2e import check, kraken_route, results

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = "demo-pulse"
FS = "http://127.0.0.1:8080"
AUTH = "http://127.0.0.1:9099"
DOCS = f"{FS}/v1/projects/{PROJECT}/databases/(default)/documents"
VERBOSE = "-v" in sys.argv
e2e.VERBOSE = VERBOSE
CHROME = os.environ.get("PW_CHROMIUM") or None  # CI uses Playwright's own browsers

# ---------- the site, served locally with a config.js that points at the emulators
CONFIG = re.sub(r"firebase: \{[\s\S]*?\n  \},", 'firebase: { apiKey: "demo-key", authDomain: "demo-pulse.firebaseapp.com", projectId: "demo-pulse", appId: "demo" },\n  emulator: { host: "127.0.0.1", firestore: 8080, auth: 9099 },',
                open(os.path.join(ROOT, "web/config.js")).read())
assert "emulator:" in CONFIG

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve():
    h = functools.partial(Quiet, directory=os.path.join(ROOT, "web"))
    s = socketserver.ThreadingTCPServer(("127.0.0.1", 0), h); s.daemon_threads = True
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{s.server_address[1]}/"

# ---------- the database, as its admin (the emulator's "owner"), to check what the app wrote
def http(method, url, body=None, token="owner"):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"authorization": "Bearer " + token, "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")
def val(v):
    if v is None: return None
    for k in ("stringValue", "booleanValue", "doubleValue", "timestampValue"):
        if k in v: return v[k]
    if "integerValue" in v: return int(v["integerValue"])
    if "nullValue" in v: return None
    if "arrayValue" in v: return [val(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v: return {k: val(x) for k, x in v["mapValue"].get("fields", {}).items()}
def doc(path):
    st, d = http("GET", f"{DOCS}/{path}")
    return {k: val(x) for k, x in d.get("fields", {}).items()} if st == 200 else None
def docs(coll):
    st, d = http("GET", f"{DOCS}/{coll}?pageSize=300")
    return [{"_id": x["name"].split("/")[-1], **{k: val(v) for k, v in x.get("fields", {}).items()}} for x in d.get("documents", [])] if st == 200 else []
def patch(path, fields):
    enc = lambda v: {"timestampValue": v} if isinstance(v, str) and re.match(r"^\d{4}-\d\d-\d\dT", v) else {"stringValue": v} if isinstance(v, str) else {"doubleValue": v} if isinstance(v, float) else {"integerValue": str(v)}
    mask = "&".join(f"updateMask.fieldPaths={k}" for k in fields)
    return http("PATCH", f"{DOCS}/{path}?{mask}", {"fields": {k: enc(v) for k, v in fields.items()}})
def wipe():
    http("DELETE", f"{FS}/emulator/v1/projects/{PROJECT}/databases/(default)/documents")
    http("DELETE", f"{AUTH}/emulator/v1/projects/{PROJECT}/accounts")
def stranger():
    """A brand-new signed-in visitor, straight from the Auth emulator: (uid, token)."""
    req = urllib.request.Request(f"{AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key", method="POST", data=b'{"returnSecureToken":true}', headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r: j = json.loads(r.read())
    return j["localId"], j["idToken"]
def iso(ms): return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms / 1000)) + ".000Z"
def eventually(fn, secs=12, every=0.4):
    end = time.time() + secs; last = None
    while time.time() < end:
        try:
            last = fn()
            if last: return last
        except Exception as e: last = e
        time.sleep(every)
    return last if not isinstance(last, Exception) else None

# ---------- the data jobs, against the emulator, with steady Kraken prices
def job(script, *args):
    env = {**os.environ, "FIREBASE_SERVICE_ACCOUNT": json.dumps({"project_id": PROJECT}), "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080", "SITE_URL": "http://127.0.0.1"}
    r = subprocess.run(["node", "--import", os.path.join(ROOT, "tests/live/mock-net.mjs"), os.path.join(ROOT, script), *args], cwd=ROOT, env=env, capture_output=True, text=True, timeout=300)
    if VERBOSE or r.returncode: print(f"--- {script} (exit {r.returncode})\n{r.stdout[-1500:]}{r.stderr[-1500:]}", flush=True)
    return r.returncode == 0

# ---------- phones
PHONES = []
STATE = """JSON.stringify({body: document.body.className, tab: (document.querySelector('.tabbar [aria-current=page]')||{}).dataset?.tab,
  gate: document.querySelector('#gate')?.innerText.slice(0, 160), sheet: document.querySelector('#sheet').hidden ? null : document.querySelector('#sheet').innerText.slice(0, 160),
  signedOut: localStorage.getItem('pl.signedOut'), user: JSON.parse(localStorage.getItem('pl.account') || '{}').username || null})"""
def phone(pw, kind, base):
    if kind == "iphone":
        b = pw.webkit.launch()
        ctx = b.new_context(**pw.devices["iPhone 13"])
    else:
        b = pw.chromium.launch(**({"executable_path": CHROME} if CHROME else {}))
        ctx = b.new_context(**pw.devices["Pixel 7"])
    ctx.route("**/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=CONFIG))
    ctx.route("**/api.kraken.com/**", kraken_route)
    p = ctx.new_page(); p.errs = []
    # Safari reports the database's open connection being cut off when the page reloads (signing out reloads it) as
    # an error; that's the browser closing a request on purpose, not a fault in the app
    p.on("pageerror", lambda e: None if re.search(r"Firestore/(Listen|Write)/channel.*access control checks", str(e)) else p.errs.append(str(e)))
    p.on("dialog", lambda d: d.accept())
    if kind == "android":  # a slow mobile connection: 1.6 Mbps down, 150 ms
        cdp = ctx.new_cdp_session(p); cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 150, "downloadThroughput": 200e3, "uploadThroughput": 90e3})
    p.kind = kind; p.browser_ = b; PHONES.append(p)
    p.goto(base); return p

def typein(p, sel, text):
    p.locator(sel).click(); p.fill(sel, ""); p.locator(sel).press_sequentially(text, delay=20)
    got = p.input_value(sel)
    if got != text: check(f"{p.kind}: typing into {sel} shows what was typed", False, f"typed {text!r}, box shows {got!r}")

def uid_of(name):
    u = doc(f"usernames/{name}"); return u and u.get("acct")

def create_account(p, name, first_call=True):
    p.wait_for_selector("#obNew", timeout=20000); p.click("#obNew")
    typein(p, "#obU", name)
    p.wait_for_function("document.querySelector('#obUMsg')?.textContent.includes('free')", timeout=15000)
    t0 = time.time(); p.click("#obGo")
    p.wait_for_function("!document.querySelector('#obU')", timeout=20000)
    took = time.time() - t0
    if first_call:
        p.wait_for_selector("#obSizes [data-k]", timeout=20000); p.click("#obGo")
        p.wait_for_function("document.querySelector('#gate')?.innerText.includes('Locked in')", timeout=20000)
        p.click("#obGo")
    else:
        p.wait_for_selector("#obSkip", timeout=20000); p.click("#obSkip")
    p.wait_for_function("!document.querySelector('#gate')", timeout=10000)
    p.wait_for_selector("#gdSkip", timeout=5000); p.click("#gdSkip")  # the guide a new account sees once
    p.wait_for_function("!document.querySelector('#guide')", timeout=5000)
    return took

def open_settings(p, page):
    p.click(".tabbar [data-tab=you]"); p.wait_for_selector("#youSet"); p.click("#youSet")
    p.wait_for_selector(f"#sheet [data-av={page}]"); p.click(f"#sheet [data-av={page}]"); p.wait_for_timeout(500)

def sign_out(p):
    open_settings(p, "account"); p.click("#aOut"); p.wait_for_selector("#obHave", timeout=20000)

def log_in(p, name):
    p.click("#obHave"); typein(p, "#obU", name); t0 = time.time(); p.press("#obU", "Enter")
    p.wait_for_function("!document.querySelector('#gate') || !document.querySelector('#obMsg')?.hidden", timeout=20000)
    return time.time() - t0, (p.inner_text("#obMsg") if p.locator("#obMsg").count() and p.is_visible("#obMsg") else "")

def make_call(p, period="1d", pct=None, sure=None, basis=None, public=None, up=True):
    """Call it the way a person does (1.2.8): period and Higher/Lower, how far (or type your own), Lock in, then the
    optional extras on the Locked in step."""
    p.click(".card.active .callit"); p.wait_for_selector("#sheet [data-dir]", timeout=10000)
    if p.locator(f"#sheet [data-h='{period}']").count(): p.click(f"#sheet [data-h='{period}']"); p.wait_for_timeout(300)
    p.click(f"#sheet [data-dir='{1 if up else -1}']"); p.wait_for_selector("#pGo", timeout=5000)
    if pct is not None: p.click("#pOwnOpen"); typein(p, "#pOwn", f"{pct}%"); p.wait_for_timeout(300)
    if public is not None and ("Public" in p.inner_text("#pPubT")) != public: p.click("#pPubT"); p.wait_for_timeout(200)
    p.click("#pGo")
    p.wait_for_function("document.querySelector('#pDone') || /couldn|already|refused/i.test(document.querySelector('#sheet').innerText)", timeout=20000)
    text = p.inner_text("#sheet")
    if p.locator("#pDone").count():
        if sure: p.click(f"[data-sure='{sure}']")
        if basis: p.click(f"[data-basis='{basis}']")
        p.click("#pDone"); p.wait_for_timeout(600)
    return text

def no_errors(p, label):
    check(f"{p.kind}: no JavaScript errors ({label})", not p.errs, " | ".join(p.errs[:3])); p.errs.clear()

# =====================================================================================================
def run(pw, base):
    wipe()
    iphone = phone(pw, "iphone", base)

    # ---- 1. a new account on an iPhone, by typing, then the first call
    took = create_account(iphone, "ana_live")
    ana = uid_of("ana_live"); acct = ana and doc(f"accounts/{ana}")
    check("iphone: creating an account by typing a username saves the name and the account in the database", bool(ana) and acct and acct.get("username") == "ana_live", json.dumps(acct)[:160] if acct else "no account")
    check("iphone: creating the account answers within 6 s", took < 6, f"{took:.1f}s")
    preds = eventually(lambda: docs(f"accounts/{ana}/predictions"))
    check("iphone: the first call (Bitcoin, 1 hour) is saved in the database", preds and preds[0]["_id"] == "BTC_1h" and preds[0].get("target", 0) > 0, json.dumps(preds)[:200])
    no_errors(iphone, "sign-up")

    # ---- 2. Call it with everything: own %, how sure, based on, public
    msg = make_call(iphone, "1d", pct="2.5", sure="very", basis="news", public=True)
    d = eventually(lambda: (lambda x: x if x and x.get("sure") else None)(doc(f"accounts/{ana}/predictions/BTC_1d")))
    check("iphone: Call it saves a 1-day call with how sure, what it was based on and public", d and d.get("sure") == "very" and d.get("basis") == "news" and d.get("pub") is True, (json.dumps(d) if d else "nothing saved") + " | " + msg[:120])
    iphone.wait_for_timeout(800)
    check("iphone: the card shows 2 calls waiting", "2 calls waiting" in iphone.inner_text(".card.active"), iphone.inner_text(".card.active .head2")[:120])
    iphone.click(".card.active .callit"); iphone.wait_for_selector("#sheet [data-dir]")
    check("iphone: a period with an open call can't be called again (1 day shows waiting)", iphone.is_disabled("#sheet [data-h='1d']") and iphone.is_disabled("#sheet [data-h='1h']"))
    iphone.click("#sheet [data-close]"); iphone.wait_for_timeout(400)
    no_errors(iphone, "calls")

    # ---- 3. sign out, log back in by username
    sign_out(iphone)
    check("iphone: signing out shows the welcome screen", iphone.is_visible("#obHave"))
    took, err = log_in(iphone, "nobody_here")
    check("iphone: logging in with a name nobody has says so", "no account called @nobody_here" in err.lower(), err)
    iphone.click("#obBack"); iphone.wait_for_selector("#obHave")
    took, err = log_in(iphone, "ana_live")
    check("iphone: logging in by username opens the account within 5 s", not err and not iphone.locator("#gate").count() and took < 5, f"{took:.1f}s {err}")
    check("iphone: after logging in, both open calls are there", eventually(lambda: "2 calls waiting" in iphone.inner_text(".card.active"), 15), iphone.inner_text(".card.active .head2")[:120])
    no_errors(iphone, "sign out and in")

    # ---- 4. a second phone (Android, slow connection): someone else, and the same account on another phone
    android = phone(pw, "android", base)
    create_account(android, "ben_live", first_call=False)
    ben = uid_of("ben_live")
    check("android: a second person can create an account on a slow connection", bool(ben))
    android.click(".tabbar [data-tab=play]"); android.wait_for_selector("#plFind"); android.click("#plFind")
    typein(android, "#fpIn", "ana")
    found = eventually(lambda: android.locator("#fpRes [data-a]").count() > 0, 10)
    check("android: searching 'ana' finds @ana_live", found and "@ana_live" in android.inner_text("#fpRes"), android.inner_text("#sheet")[:160])
    if found:
        android.click("#fpRes [data-a]"); android.wait_for_selector("#pcFollow", timeout=10000); android.click("#pcFollow")
        check("android: Follow saves @ana_live in ben's following list", eventually(lambda: ana in (doc(f"accounts/{ben}") or {}).get("following", [])), json.dumps(doc(f"accounts/{ben}") or {})[:200])
        android.click("#pcCalls"); android.wait_for_timeout(1500)
        check("android: ana's calls aren't shown while they're open", eventually(lambda: "hasn't made any scored calls public" in android.inner_text("#sheet"), 8) and not android.locator("#sheet [data-pc]").count(), android.inner_text("#sheet")[:160])
        android.click("#sheet [data-close]"); android.wait_for_timeout(400)
    no_errors(android, "people")

    # the same account on a second phone: log in as ana on another Android, see her calls, make one, see it on the iPhone
    other = phone(pw, "android", base)
    other.wait_for_selector("#obHave", timeout=20000)
    took, err = log_in(other, "ana_live")
    check("android 2: logging in to ana's account from a second phone works", not err and not other.locator("#gate").count(), err)
    check("android 2: the second phone shows ana's 2 open calls", eventually(lambda: "2 calls waiting" in other.inner_text(".card.active"), 20))
    other.evaluate("document.querySelector('.card.active')"); other.mouse.wheel(0, 900); other.wait_for_timeout(1500)  # next coin
    coin = other.inner_text(".card.active .tks")
    make_call(other, "1h")
    check(f"android 2: a call on {coin} from the second phone is saved to ana's account", eventually(lambda: doc(f"accounts/{ana}/predictions/{coin}_1h")), coin)
    iphone.click(".tabbar [data-tab=play]")
    check("iphone: the call made on the other phone appears on the iPhone without reopening the app", eventually(lambda: coin in iphone.inner_text("#play"), 15), iphone.inner_text("#play")[:200])
    no_errors(other, "second phone")

    # ---- 5. the rules: what strangers and other players can't do
    s_uid, s_tok = stranger()
    st, _ = http("GET", f"{DOCS}/accounts/{ana}", token=s_tok)
    check("rules: a stranger can't read someone's account", st == 403, str(st))
    st, _ = http("GET", f"{DOCS}/accounts/{ana}/predictions/BTC_1d", token=s_tok)
    check("rules: a stranger can't read someone's open call", st == 403, str(st))
    st, _ = http("PATCH", f"{DOCS}/usernames/ana_live", {"fields": {"acct": {"stringValue": s_uid}, "at": {"stringValue": "x"}}}, token=s_tok)
    check("rules: a taken username can't be taken over", st == 403, str(st))
    http("PATCH", f"{DOCS}/accounts/{s_uid}", {"fields": {"watchlists": {"arrayValue": {}}}}, token=s_tok)
    st, _ = http("PATCH", f"{DOCS}/accounts/{s_uid}?updateMask.fieldPaths=pscore", {"fields": {"pscore": {"mapValue": {"fields": {"score": {"integerValue": "999"}}}}}}, token=s_tok)
    check("rules: nobody can write their own score", st == 403, str(st))
    st, _ = http("PATCH", f"{DOCS}/accounts/{s_uid}/predictions/BTC_1d?currentDocument.exists=false", {"fields": {"coin": {"stringValue": "CRYPTO:BTC"}, "t": {"stringValue": "BTC"}, "horizon": {"stringValue": "1d"}, "target": {"doubleValue": 100}, "sure": {"stringValue": "certain"}}}, token=s_tok)
    check("rules: a call with a made-up 'how sure' value is refused", st == 403, str(st))
    # a call's details can be added after it's locked in, but the call itself can never change
    name = f"projects/{PROJECT}/databases/(default)/documents/accounts/{s_uid}/predictions/ETH_1d"
    st, _ = http("POST", f"{DOCS}:commit", {"writes": [{"update": {"name": name, "fields": {"coin": {"stringValue": "CRYPTO:ETH"}, "t": {"stringValue": "ETH"}, "horizon": {"stringValue": "1d"}, "target": {"doubleValue": 100.0}, "clientP0": {"doubleValue": 99.0}, "clientSigma": {"doubleValue": 0.03}}}, "updateTransforms": [{"fieldPath": "createdAt", "setToServerValue": "REQUEST_TIME"}], "currentDocument": {"exists": False}}]}, token=s_tok)
    check("rules: a player can make a call on their own account", st == 200, str(st))
    st, _ = http("PATCH", f"{DOCS}/accounts/{s_uid}/predictions/ETH_1d?updateMask.fieldPaths=sure&updateMask.fieldPaths=basis", {"fields": {"sure": {"stringValue": "very"}, "basis": {"stringValue": "chart"}}}, token=s_tok)
    check("rules: how sure and based on can be added to your call just after making it", st == 200, str(st))
    st, _ = http("PATCH", f"{DOCS}/accounts/{s_uid}/predictions/ETH_1d?updateMask.fieldPaths=target", {"fields": {"target": {"doubleValue": 150.0}}}, token=s_tok)
    check("rules: a locked-in call's price can't be changed", st == 403, str(st))

    # ---- 6. the data jobs score calls; the app shows the results; public calls reach followers
    now = time.time() * 1000
    patch(f"accounts/{ana}/predictions/BTC_1h", {"createdAt": iso(now - 2.2 * 36e5)})
    patch(f"accounts/{ana}/predictions/BTC_1d", {"createdAt": iso(now - 26 * 36e5)})
    ok = job("pipeline/settle.mjs")
    check("jobs: the 15-minute scoring job runs against the database", ok)
    res = eventually(lambda: docs(f"accounts/{ana}/results"), 10)
    scored = [r for r in (res or []) if r.get("status") == "scored"]
    check("jobs: both due calls are scored and moved to results", len(scored) == 2 and not doc(f"accounts/{ana}/predictions/BTC_1h") and not doc(f"accounts/{ana}/predictions/BTC_1d"), json.dumps(res)[:300])
    check("jobs: the public call keeps how sure, based on and public in its result", any(r.get("pub") is True and r.get("sure") == "very" and r.get("basis") == "news" for r in scored), json.dumps(scored)[:300])
    iphone.click(".tabbar [data-tab=play]")
    check("iphone: the scored calls appear in Calls without reopening the app", eventually(lambda: "scored" in iphone.inner_text("#play").lower() and iphone.locator("#play [data-res]").count() >= 2, 15), iphone.inner_text("#play")[:200])
    state = lambda p: p.evaluate("JSON.stringify({body: document.body.className, gate: document.querySelector('#gate')?.innerText.slice(0,200), sheet: document.querySelector('#sheet').hidden ? null : document.querySelector('#sheet').innerText.slice(0,200), signedOut: localStorage.getItem('pl.signedOut'), user: (JSON.parse(localStorage.getItem('pl.account')||'{}')).username})")
    if not iphone.is_visible(".tabbar [data-tab=you]"): check("iphone: the app stays open after calls are scored (no screen in the way)", False, state(iphone))
    else:
        iphone.click(".tabbar [data-tab=you]")
        check("iphone: You counts the 2 scored calls", eventually(lambda: "2 calls so far" in iphone.inner_text("#you"), 10), iphone.inner_text("#you")[:160] + " " + state(iphone))
    out = tempfile.mkdtemp()
    ok = job("pipeline/run.mjs", out)
    check("jobs: the 2-hour data job runs against the database", ok)
    card = doc(f"players/{ana}")
    check("jobs: ana's player card is published with her level and record", card and card.get("u") == "ana_live", json.dumps(card)[:200] if card else "none")
    pub = docs(f"players/{ana}/calls")
    check("jobs: only the public scored call is published for followers (not the private one, never an open one)", len(pub) == 1 and pub[0].get("t") == "BTC", json.dumps(pub)[:300])
    android.click(".tabbar [data-tab=play]"); android.click("#plFind"); typein(android, "#fpIn", "ana")
    if eventually(lambda: android.locator("#fpRes [data-a]").count() > 0, 10):
        android.click("#fpRes [data-a]"); android.wait_for_selector("#pcCalls", timeout=10000); android.click("#pcCalls")
        check("android: a follower sees ana's public scored call", eventually(lambda: android.locator("#sheet [data-pc]").count() == 1, 10), android.inner_text("#sheet")[:200])
        android.click("#sheet [data-close]"); android.wait_for_timeout(400)
    st, _ = http("GET", f"{DOCS}/players/{ana}/calls", token=s_tok)
    check("rules: someone who doesn't follow ana can't read her public calls", st == 403, str(st))
    no_errors(android, "public calls")

    # ---- 7. groups: start one, join by link on another phone, a challenge, a pick
    iphone.click(".tabbar [data-tab=play]"); iphone.click("#plFriends"); iphone.wait_for_selector("#plNewG"); iphone.click("#plNewG")
    typein(iphone, "#ngIn", "Desk"); iphone.click("#ngGo")
    gid = eventually(lambda: next((g["_id"] for g in docs("groups") if g.get("name") == "Desk"), None), 10)
    check("groups: starting a group saves it with ana as its owner", gid and (doc(f"groups/{gid}") or {}).get("owner") == ana, str(gid))
    if gid:
        android.goto(base + "#/g/" + gid); android.wait_for_selector("#jgGo", timeout=25000)
        check("groups: opening the invite link asks before joining, naming the group", "Desk" in android.inner_text("#sheet"))
        android.click("#jgGo")
        check("groups: joining by link adds ben to the group", eventually(lambda: ben in ((doc(f"groups/{gid}") or {}).get("members") or {}), 12), json.dumps(doc(f"groups/{gid}"))[:200])
        iphone.wait_for_selector("#grp", timeout=10000); iphone.click("#grNew"); iphone.wait_for_selector("#cGo")
        iphone.click("#sheet [data-h='1h']"); iphone.wait_for_timeout(300)
        hi = float(re.search(r"\$([\d,.]+) or higher", iphone.inner_text("#cInMsg")).group(1).replace(",", ""))
        typein(iphone, "#cIn", f"{hi * 1.01:.4f}"); iphone.click("#cGo")
        ch = eventually(lambda: docs(f"groups/{gid}/challenges"), 12)
        check("groups: starting a challenge saves it with ana's pick", ch and ana in (ch[0].get("picked") or {}), json.dumps(ch)[:200])
        if ch:
            if android.is_visible("#grBack"): android.click("#grBack"); android.wait_for_timeout(400)  # the group page covers the tabs
            android.click(".tabbar [data-tab=play]")
            if eventually(lambda: android.locator("[data-pick]").count() > 0, 15):
                android.click("[data-pick] >> nth=0"); android.wait_for_selector("#kGo", timeout=10000)
                lo = re.search(r"\$([\d,.]+) or higher", android.inner_text("#kInMsg"))
                typein(android, "#kIn", f"{float(lo.group(1).replace(',', '')) * 1.01:.4f}" if lo else "1")
                android.click("#kGo")
                check("groups: ben's pick is saved and the challenge shows he picked", eventually(lambda: ben in ((doc(f"groups/{gid}/challenges/{ch[0]['_id']}") or {}).get("picked") or {}), 12))
            else: check("groups: ben sees the challenge waiting for his pick", False, android.inner_text("#play")[:200])
    no_errors(iphone, "groups"); no_errors(android, "groups")

    for p in (iphone, android, other): p.browser_.close()

if __name__ == "__main__":
    base = serve()
    with sync_playwright() as pw:
        try: run(pw, base)
        except Exception as e:
            check("live: suite ran to the end", False, repr(e)[:300])
            for i, p in enumerate(PHONES):
                try: check(f"state of phone {i + 1} ({p.kind}) when it stopped", False, p.evaluate(STATE))
                except Exception as e2: pass
    fails = [r for r in results if not r[1]]
    for n, ok, d in results:
        if not ok and not VERBOSE: pass  # already printed by check()
    print(("::notice::" if os.environ.get("GITHUB_ACTIONS") else "") + f"live: {len(results) - len(fails)}/{len(results)} checks passed")
    sys.exit(1 if fails else 0)
