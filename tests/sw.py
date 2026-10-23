"""The offline copy of the app (web/sw.js) and new releases, in a real browser.
Run:  python3 tests/sw.py [-v]     (serves its own copy of web/ on this computer, in demo mode; needs Python Playwright)
Checks that a phone gets the offline copy and opens without a connection; that a release downloads only the files that
changed (fingerprints from scripts/stamp-sw.mjs) and reloads the app onto it while nobody has touched it; that once
someone is using the app it offers Update instead, and applies it when the app next comes back to the front; and that
a copy without fingerprints (the repo as it is) installs and updates too. Prints PASS/FAIL lines; non-zero on failure.
"""
import sys, os, re, time, shutil, tempfile, threading, subprocess, pathlib, functools, http.server
from playwright.sync_api import sync_playwright

VERBOSE = "-v" in sys.argv
ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = "/opt/pw-browsers/chromium" if os.path.exists("/opt/pw-browsers/chromium") else None  # else Playwright's own (CI)
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    if VERBOSE or not ok:
        gha = "::error::" if not ok and os.environ.get("GITHUB_ACTIONS") else ""
        print(f"{gha}{'PASS' if ok else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""), flush=True)

def make_site(stamped):
    """A copy of web/ in demo mode with the offline copy allowed on localhost; prices go nowhere (refused at once)."""
    site = pathlib.Path(tempfile.mkdtemp(prefix="pulse-sw-")) / "web"
    shutil.copytree(ROOT / "web", site)
    cfg = site / "config.js"
    cfg.write_text(re.sub(r"firebase: \{[\s\S]*?\n  \},", "firebase: null,\n  swTest: true,", cfg.read_text(), count=1))
    for f in (site / "js").glob("*.js"): f.write_text(f.read_text().replace("https://api.kraken.com", "http://localhost:9"))
    (site / "sw.tpl.js").write_text((site / "sw.js").read_text())
    if stamped: subprocess.run(["node", str(ROOT / "scripts/stamp-sw.mjs"), str(site)], check=True, capture_output=True)
    return site

def release(site, name, stamped):
    """A small release: the version file and one screen change, and the offline copy gets a new name."""
    for f in ["config.js", "js/you.js"]: (site / f).write_text((site / f).read_text() + f"\n// release {name}\n")
    (site / "sw.js").write_text(re.sub(r'const SHELL = "[^"]+"', f'const SHELL = "pulse-shell-test-{name}"', (site / "sw.tpl.js").read_text()))
    if stamped: subprocess.run(["node", str(ROOT / "scripts/stamp-sw.mjs"), str(site)], check=True, capture_output=True)

def serve(site):
    class H(http.server.SimpleHTTPRequestHandler):
        log = []; slow = [False]  # slow: a release's downloads take a while, so a tap can come before it takes over
        def log_message(self, *a): pass
        def do_GET(self):
            H.log.append(self.path)
            if H.slow[0] and "?v=" in self.path: time.sleep(1.5)
            del self.headers["If-Modified-Since"]  # this server dates files to the second, and test releases come faster
            super().do_GET()
        def end_headers(self): self.send_header("Cache-Control", "max-age=600"); super().end_headers()  # as GitHub Pages
    srv = http.server.ThreadingHTTPServer(("localhost", 0), functools.partial(H, directory=str(site)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, H.log, f"http://localhost:{srv.server_address[1]}/", H.slow

READY = "Promise.race([navigator.serviceWorker.ready.then((r) => !!r.active), new Promise((r) => setTimeout(r, 20000, false))])"
reloaded = lambda p: p.evaluate("sessionStorage.getItem('pl.swReload')")

def phone(b):
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, service_workers="allow")
    ctx.add_init_script("for (const k of ['pl.swipeHint', 'pl.guideSeen', 'pl.v2note']) localStorage.setItem(k, '1')")
    p = ctx.new_page(); errs = []; p.on("pageerror", lambda e: errs.append(str(e)))
    return ctx, p, errs

def run(b, stamped):
    kind = "fingerprinted" if stamped else "without fingerprints"
    site = make_site(stamped); srv, log, base, slow = serve(site)
    ctx, p, errs = phone(b)
    try:
        p.goto(base); p.wait_for_selector("#obNew", timeout=15000)
        check(f"{kind}: the offline copy installs", p.evaluate(READY))
        p.reload(); p.wait_for_selector("#obNew", timeout=15000)
        check(f"{kind}: the app runs from the offline copy", p.evaluate("!!navigator.serviceWorker.controller"))
        ctx.set_offline(True); p.reload(); ok = p.locator("#obNew").first.wait_for(timeout=15000) is None; ctx.set_offline(False)
        check(f"{kind}: the app opens without a connection", ok)

        # a release, nobody touching the app: the new version installs and the app reloads onto it
        p.evaluate("sessionStorage.clear()"); log.clear(); release(site, "a", stamped)
        p.goto(base)
        p.wait_for_function("sessionStorage.getItem('pl.swReload')", timeout=30000); p.wait_for_selector("#obNew", timeout=15000)
        check(f"{kind}: a release reloads the app while untouched", reloaded(p))
        p.evaluate(READY)
        cfg = p.evaluate("fetch('config.js').then((r) => r.text())")
        check(f"{kind}: the app runs the new release", "// release a" in cfg)
        got = sorted({x.split("?")[0] for x in log if "?v=" in x})
        if stamped:
            check(f"{kind}: a release downloads only the files that changed", got == ["/config.js", "/js/you.js"], ", ".join(got))
            same = p.evaluate("fetch('js/app.js').then((r) => r.text())") == (site / "js/app.js").read_text()
            check(f"{kind}: an unchanged file is reused intact", same)
            head = p.evaluate("fetch('js/app.js').then((r) => r.headers.get('content-type'))")
            check(f"{kind}: a reused file keeps its type", "javascript" in (head or ""), head)
        else:
            check(f"{kind}: a release downloads every file", len(got) >= 30, f"{len(got)} files")

        # a release while someone is using the app: no reload, an Update offer; applied when the app comes back
        p.evaluate("sessionStorage.clear()"); release(site, "b", stamped); slow[0] = True
        p.goto(base); p.wait_for_selector("#obNew", timeout=15000); p.mouse.click(195, 60)
        p.get_by_text("A new version of the app is ready.").wait_for(timeout=30000); slow[0] = False
        check(f"{kind}: in use, a release offers Update instead of reloading", not reloaded(p))
        p.evaluate("Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange'))")
        p.wait_for_function("sessionStorage.getItem('pl.swReload')", timeout=15000); p.wait_for_selector("#obNew", timeout=15000)
        cfg = p.evaluate("fetch('config.js').then((r) => r.text())")
        check(f"{kind}: back at the front, the app reloads onto the release", reloaded(p) and "// release b" in cfg)
        check(f"{kind}: no page errors", not errs, "; ".join(errs[:3]))
    finally:
        ctx.close(); srv.shutdown(); shutil.rmtree(site.parent, ignore_errors=True)

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME) if CHROME else pw.chromium.launch()
    for stamped in (True, False):
        try: run(b, stamped)
        except Exception as e: check(f"{'fingerprinted' if stamped else 'without fingerprints'}: ran to the end", False, str(e).splitlines()[0])
    b.close()

failed = [r for r in results if not r[1]]
print(f"sw: {len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
