// The first run (1.2.0): welcome, a username (no password: a username creates or opens the account, as in 1.1.4), then a
// first call on Bitcoin in an hour, so the first result arrives within the first session. Everything sits in one
// full-screen gate (#gate) over the app; the feed keeps loading behind it.
import { CONFIG } from "../config.js";
import { store, ls, checkUsername, usernameFree, setUsername, loginUsername, makePrediction, enablePush, USERNAME_CHANGES, signedOut } from "./store.js";
import { HORIZONS, typicalMove } from "./score.js";
import { D } from "./data.js";
import { $, esc, money, toast, haptic } from "./ui.js";

const FIRST_COIN = "CRYPTO:BTC", FIRST_H = "1h";
const SEEN = "pl.firstCall"; // the first-call step has been shown (made or skipped) on this phone
let gate = null, onDone = null;

// Is anything needed before the app can be used? (The feed draws behind the gate meanwhile.)
export const needsOnboarding = () => (!store.data?.username || signedOut() ? "welcome" : null);
export function startOnboarding(done) {
  onDone = done;
  const step = needsOnboarding();
  if (!step) return done?.();
  show(step);
}
export const onboarding = () => !!gate;

function frame(html, { back = null } = {}) {
  if (!gate) {
    gate = document.createElement("div"); gate.id = "gate"; gate.className = "gate";
    gate.setAttribute("role", "dialog"); gate.setAttribute("aria-modal", "true");
    document.body.appendChild(gate); document.body.classList.add("gated");
  }
  gate.innerHTML = `<div class="gatein ob">${back ? `<button class="btn ghost sm ob-back" id="obBack" aria-label="Back">‹ Back</button>` : ""}${html}</div>`;
  gate.scrollTop = 0;
  if (back) gate.querySelector("#obBack").onclick = () => show(back);
  return gate;
}
function finish() {
  if (gate) { gate.remove(); gate = null; }
  document.body.classList.remove("gated");
  const d = onDone; onDone = null; d?.();
}
const LOGO = `<span class="ob-logo"><svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><path d="M3 15h5l2.5-7 4 13 3-9 1.5 3H25" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><b>${esc(CONFIG.appName)}</b></span>`;
const field = (id, label) => `<label class="field"><span>${label}</span><div class="uname"><span>@</span><input id="${id}" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="21" enterkeyhint="go"></div></label>`;

function show(step) {
  ({ welcome, create, login, firstcall }[step] || welcome)();
}
// 1 · Welcome
function welcome() {
  frame(`${LOGO}
    <svg class="ob-art" viewBox="0 0 342 200" role="img" aria-label="A price line rising towards a dashed line marking a call">
      <line x1="0" y1="62" x2="342" y2="62" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="5 6"/>
      <path d="M0 160 L30 148 L52 156 L80 132 L104 140 L130 112 L152 120 L178 98 L204 108 L228 84 L252 92 L276 72 L300 70" fill="none" stroke="var(--text)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="300" cy="70" r="5" fill="var(--text)"/><circle cx="300" cy="70" r="12" fill="none" stroke="var(--up)" stroke-width="2"/>
      <text x="342" y="52" text-anchor="end" font-size="13" font-weight="600" fill="var(--accent)" font-family="inherit">Your call</text></svg>
    <h1 class="ob-h1">Swipe the market.<br>Call the move.</h1>
    <p>Everyone has a market opinion. ${esc(CONFIG.appName)} keeps score.</p>
    <div class="ob-actions"><button class="btn primary block" id="obNew">Get started</button><button class="btn ghost block" id="obHave">I already have an account</button></div>`);
  gate.querySelector("#obNew").onclick = () => show("create");
  gate.querySelector("#obHave").onclick = () => show("login");
}

// 2 · Create account: just a username
function create() {
  frame(`<div class="label">Create your account</div>
    <h1>Pick a username</h1>
    ${field("obU", "Username")}<p class="hint" id="obUMsg">3–20 letters, numbers, dots or underscores. Not your real name.</p>
    <button class="btn primary block" id="obGo" disabled>Create account</button>
    <p class="hint" style="text-align:center">Your username is public with your score. You can change it ${USERNAME_CHANGES} times.</p>`, { back: "welcome" });
  const u = $("obU"), um = $("obUMsg"), go = $("obGo");
  let seq = 0, uok = false;
  const set = (t, cls) => { um.textContent = t; um.className = "hint " + (cls || ""); };
  const checkU = async () => {
    const { name, error } = checkUsername(u.value), my = ++seq; uok = false; go.disabled = true;
    if (error) return set(u.value ? error : "3–20 letters, numbers, dots or underscores. Not your real name.", u.value ? "bad" : "");
    set(`Checking @${name}…`);
    try { const st = await usernameFree(name); if (my !== seq) return; uok = st === "free"; set(uok ? `@${name} is free.` : `@${name} is taken. If it's yours, log in instead.`, uok ? "good" : "bad"); }
    catch { if (my === seq) { uok = true; set(`Couldn't check @${name} just now; you'll find out when you continue.`); } }
    go.disabled = !uok;
  };
  let t = 0; u.oninput = () => { clearTimeout(t); t = setTimeout(checkU, 250); };
  const submit = async () => {
    if (go.disabled) return;
    go.disabled = true; go.textContent = "Creating…";
    try { const n = await setUsername(u.value); haptic(); toast(`Welcome, @${n}.`); ls.get(SEEN) ? finish() : firstcall(); }
    catch (e) { set(e.message || "Couldn't create the account. Try again.", "bad"); go.disabled = false; go.textContent = "Create account"; }
  };
  go.onclick = submit; u.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); }); // never return false from a key handler: that drops the keystroke
  setTimeout(() => u.focus(), 200);
}

// 2b · Log in: type the username, this phone joins that account
function login() {
  frame(`<div class="label">Welcome back</div>
    <h1>Log in</h1>
    ${field("obU", "Username")}<p class="hint bad" id="obMsg" hidden></p>
    <button class="btn primary block" id="obGo">Log in</button>`, { back: "welcome" });
  const u = $("obU"), msg = $("obMsg"), go = $("obGo");
  const submit = async () => {
    go.disabled = true; msg.hidden = true; const was = go.textContent;
    try { const n = await loginUsername(u.value, (t) => (go.textContent = `${t}…`)); toast(`Welcome back, @${n}.`); haptic(); finish(); }
    catch (e) { msg.hidden = false; msg.textContent = e.message || "Couldn't log in."; go.disabled = false; go.textContent = was; }
  };
  go.onclick = submit; u.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); }); // never return false from a key handler: that drops the keystroke
  setTimeout(() => u.focus(), 200);
}

// 3 · The first call: Bitcoin in an hour, higher or lower, then a size. Scored in an hour, by notification.
function firstcall() {
  ls.set(SEEN, 1);
  const sym = { key: FIRST_COIN, t: "BTC", n: "Bitcoin", m: "CRYPTO", ty: "C" };
  const bars = D.series[FIRST_COIN]?.bars || [], p0 = bars.at(-1)?.c;
  const closes = bars.slice(0, -1).map((b) => b.c), sigmaD = closes.length > 3 ? dailyVolOf(closes) : null;
  if (!p0 || !sigmaD) {
    frame(`<div class="label">Welcome, @${esc(store.data?.username || "")}</div><h1>Loading Bitcoin's price…</h1><p class="hint">Your first call is a few seconds away.</p><button class="btn ghost block" id="obSkip">Skip for now</button>`);
    gate.querySelector("#obSkip").onclick = finish;
    setTimeout(() => gate && gate.querySelector("#obSkip") && firstcall(), 1500);
    return;
  }
  const tm = typicalMove(sigmaD, FIRST_H), sizes = [["A little", 0.5], ["About a usual move", 1], ["A big move", 2]];
  let dir = 1, size = 1;
  const price = (k) => p0 * Math.exp(dir * k * tm);
  frame(`<div class="ob-top"><span class="label">Welcome, @${esc(store.data?.username || "")}</span><button class="btn ghost sm" id="obSkip">Skip</button></div>
    <h1>Where will Bitcoin be in an hour?</h1>
    <p>It's <b class="num">${esc(money(p0, "CRYPTO"))}</b> now. In an hour it usually moves about ${(Math.expm1(tm) * 100).toFixed(1)}%, either way.</p>
    <div class="ob-dir"><button class="opt big" data-dir="1" aria-pressed="true">Higher</button><button class="opt big" data-dir="-1" aria-pressed="false">Lower</button></div>
    <div class="label" style="margin-top:14px">By how much?</div>
    <div class="ob-sizes" id="obSizes"></div>
    <button class="btn primary block" id="obGo" style="margin-top:14px">Lock in my call</button>
    <p class="hint" style="text-align:center">Scored at ${esc(new Date(Date.now() + 36e5).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }))} against the real price. It's saved to your account. Not advice.</p>`);
  const sizesEl = $("obSizes");
  const draw = () => {
    sizesEl.innerHTML = sizes.map(([l, k], i) => `<button class="ob-size" data-k="${i}" aria-pressed="${i === size}"><span>${l}</span><b class="num">${esc(money(price(k), "CRYPTO"))}</b></button>`).join("");
    sizesEl.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { size = +b.dataset.k; haptic(); draw(); }));
  };
  gate.querySelectorAll("[data-dir]").forEach((b) => (b.onclick = () => { dir = +b.dataset.dir; gate.querySelectorAll("[data-dir]").forEach((x) => x.setAttribute("aria-pressed", x === b)); haptic(); draw(); }));
  draw();
  gate.querySelector("#obSkip").onclick = finish;
  const go = $("obGo");
  go.onclick = async () => {
    go.disabled = true; go.textContent = "Locking in…";
    const target = price(sizes[size][1]);
    try { await makePrediction({ sym, horizon: FIRST_H, target, p0, sigmaD }); haptic([10, 40, 16]); locked(target, p0); }
    catch (e) { toast(e.message || "Couldn't save the call. Try again."); go.disabled = false; go.textContent = "Lock in my call"; }
  };
}
function dailyVolOf(closes) { const c = closes.slice(-31); const r = c.slice(1).map((x, i) => Math.log(x / c[i])); const m = r.reduce((a, x) => a + x, 0) / r.length; return Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1)); }

// 4 · Locked in: the result comes in an hour; explore meanwhile
function locked(target, p0) {
  const at = new Date(Date.now() + HORIZONS[FIRST_H].days * 864e5);
  frame(`<div class="ob-lock"><svg viewBox="0 0 80 80" aria-hidden="true" class="done-ring"><circle cx="40" cy="40" r="34"/><path d="M26 41l9 9 19-20"/></svg></div>
    <h1>Locked in</h1>
    <p>Bitcoin at <b class="num">${esc(money(target, "CRYPTO"))}</b> in an hour, from ${esc(money(p0, "CRYPTO"))}. You'll see how it went at <b>${esc(at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }))}</b>.</p>
    <label class="pl-switchrow"><span><b>Tell me when it's scored</b><span class="hint">One notification, when the hour is up</span></span><span class="switch"><input type="checkbox" id="obPush"><span></span></span></label>
    <button class="btn primary block" id="obGo" style="margin-top:14px">Explore the charts while you wait</button>`);
  $("obPush").onchange = async (e) => { if (!e.target.checked) return; try { await enablePush(); toast("You'll get a notification when it's scored."); } catch (err) { e.target.checked = false; toast(err.message); } };
  $("obGo").onclick = finish;
}
