// Pulse: the chart feed. Scroll up or down for the next symbol; swipe for its news (finger moves right)
// or its details (finger moves left). The feed loops through the watchlist with a "caught up" card between rounds.
import { CONFIG } from "../config.js";
import { store, ls, init, save, STARTER, allSyms, watchlists, callAI, getShared, getSharedMany } from "./store.js";
import { loadSymbols, MKLABEL, TYLABEL, findSymbol } from "./search.js";
import { METRICS, OPS, ruleMet, fmt } from "./indicators.js";
import { describe } from "./describe.js";
import { mainChart, lowerChart } from "./chart.js";
import { initInteract, openLearn, chartTapHint, quizHtml, wireQuiz } from "./interact.js";
import { D, loadCached, refresh, view, bigMove, storiesFor } from "./data.js";
import { $, esc, money, pct, arrow, fmtDay, hhmm, ago, toast, haptic, DISCLAIMER } from "./ui.js";
import { initPages, renderDash, renderProfile, openAddSheet, openSwitcher, openListsFor, openIndicator, renderOnboarding, demoRules } from "./pages.js";

export const APP = { tab: "feed", seq: [], active: -1, syms: [], catalogue: [], built: false };
const chartSettings = () => ({ window: 50, interval: "1D", type: "candles", mas: [], lower: "RSI,MACD", order: "watchlist", ...(store.data?.settings?.chart || {}) });
const LOWER_KEY = { RSI: "rsi14", MACD: "macdHist", VOL: "volRatio" };

// ---------- which symbols, in which order
export function currentSyms() {
  const list = store.data?.settings?.list || "all";
  let syms = list === "all" ? allSyms() : (watchlists().find((w) => w.id === list)?.syms || allSyms());
  const order = chartSettings().order;
  const chg = (s) => view(s.key, chartSettings())?.daily.now.changePct;
  if (order === "move") syms = [...syms].sort((a, b) => Math.abs(chg(b) ?? -1) - Math.abs(chg(a) ?? -1));
  else if (order === "news") syms = [...syms].sort((a, b) => storiesFor(b.key).length - storiesFor(a.key).length);
  else if (order === "az") syms = [...syms].sort((a, b) => a.t.localeCompare(b.t));
  else if (order === "rsi") syms = [...syms].sort((a, b) => (view(a.key, chartSettings())?.now.rsi14 ?? 999) - (view(b.key, chartSettings())?.now.rsi14 ?? 999));
  return syms;
}
export function listName() {
  const list = store.data?.settings?.list || "all";
  return list === "all" ? "All my coins" : watchlists().find((w) => w.id === list)?.name || "All my coins";
}

// ---------- feed construction (virtual: shells for every slot, content only near the visible card)
const feed = $("feed");
let io = null;

// Mouse wheels and trackpads: one step per gesture. Trackpads keep sending "momentum" wheel events for a second or
// more after the fingers lift, so a fixed lock either swallows the next swipe or lets the tail scroll an extra card.
// A new gesture is recognised by a pause, a change of direction, or a delta that jumps up while momentum is fading.
export function wheelGesture(onStep, threshold) {
  let last = 0, locked = false, dir = 0, acc = 0, hist = [], stepAt = 0;
  return (d, now = performance.now()) => {
    const a = Math.abs(d), gap = now - last;
    last = now;
    const avg = hist.length ? hist.reduce((x, y) => x + y, 0) / hist.length : 0;
    // A short pause only starts a new gesture if the deltas are not still fading (a hiccup in the glide is not a swipe).
    const lastA = hist.length ? hist[hist.length - 1] : 0;
    const fresh = gap > 300 || (gap > 110 && a >= lastA * 0.9) || (locked && a > 4 && Math.sign(d) !== dir) ||
      (locked && now - stepAt > 200 && hist.length >= 3 && a > 8 && a > avg * 1.6);
    hist.push(a); if (hist.length > 5) hist.shift();
    if (fresh) { locked = false; acc = 0; if (gap > 110) hist = [a]; }
    if (locked) return;
    acc += d;
    if (Math.abs(acc) >= threshold) { dir = Math.sign(acc); locked = true; stepAt = now; acc = 0; onStep(dir); }
  };
}
// The feed pages one card at a time under our own control (like short-video apps) instead of the browser's
// scroll snapping. Native snapping stops a second quick swipe at the card the first one was already heading to,
// so the swipe feels lost. Here every swipe moves on from where the last one was going.
let fTarget = 0, anim = null;
const feedH = () => feed.clientHeight;
const maxIndex = () => feed.querySelectorAll(".card").length - 1;
// Smooth paging: after a finger swipe the card keeps the finger's speed and eases to a stop; wheel, trackpad
// and keys use a calm fixed glide. Never faster than 340 ms, so it doesn't feel like a jump.
export function goCard(i, { v = 0 } = {}) {
  fTarget = Math.max(0, Math.min(maxIndex(), i));
  const from = feed.scrollTop, to = fTarget * feedH(), dist = Math.abs(to - from), t0 = performance.now();
  cancelAnimationFrame(anim?.raf || 0);
  if (dist < 1) { feed.scrollTop = to; anim = null; return; }
  const ms = v ? Math.max(340, Math.min(620, (3 * dist) / Math.abs(v))) : 540;
  const ease = v ? (k) => 1 - Math.pow(1 - k, 3) : (k) => 1 - Math.pow(1 - k, 4);
  anim = { raf: 0 };
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    feed.scrollTop = from + (to - from) * ease(k);
    if (k < 1) anim.raf = requestAnimationFrame(tick); else anim = null;
  };
  anim.raf = requestAnimationFrame(tick);
}
const stepFeed = (dir) => goCard((anim ? fTarget : Math.round(feed.scrollTop / feedH())) + dir);
// Finger (and mouse) drags up and down. Sideways drags are handled per card in setupSwipe.
initInteract(feed);
let vd = null;
feed.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (e.target.closest(".pane.side, .sheet")) return; // news and details lists scroll on their own
  const base = anim ? fTarget : Math.round(feed.scrollTop / feedH());
  cancelAnimationFrame(anim?.raf || 0); anim = null;
  vd = { id: e.pointerId, x: e.clientX, y: e.clientY, top: feed.scrollTop, base, mode: null, pts: [[performance.now(), e.clientY]] };
});
feed.addEventListener("pointermove", (e) => {
  if (!vd || e.pointerId !== vd.id || APP.scrub) return;
  const mx = e.clientX - vd.x, my = e.clientY - vd.y;
  if (!vd.mode) {
    if (Math.abs(my) > 10 && Math.abs(my) * 1.2 >= Math.abs(mx)) { vd.mode = "v"; APP.dragging = true; try { feed.setPointerCapture(vd.id); } catch {} }
    else if (Math.abs(mx) > 10) { vd = null; return; }
    else return;
  }
  const h = feedH(), top = vd.top - my, lim = maxIndex() * h;
  feed.scrollTop = top < 0 ? top / 3 : top > lim ? lim + (top - lim) / 3 : top; // gentle resistance at the ends
  vd.pts.push([performance.now(), e.clientY]); if (vd.pts.length > 6) vd.pts.shift();
});
const vEnd = (e) => {
  if (!vd || e.pointerId !== vd.id) return;
  const d = vd; vd = null;
  if (d.mode !== "v") return;
  const my = e.clientY - d.y, [t1, y1] = d.pts[0], vel = (e.clientY - y1) / Math.max(1, performance.now() - t1); // px per ms
  const h = feedH(), dir = my < -0.15 * h || vel < -0.3 ? 1 : my > 0.15 * h || vel > 0.3 ? -1 : 0;
  goCard(d.base + dir, { v: dir ? Math.max(Math.abs(vel), 0.5) : 0.5 });
  APP.dragging = false; setTimeout(flushIdle, 300);
  swallowFeedClick = true; setTimeout(() => (swallowFeedClick = false), 60);
};
let swallowFeedClick = false;
feed.addEventListener("pointerup", vEnd);
feed.addEventListener("pointercancel", (e) => { if (vd && e.pointerId === vd.id) { const d = vd; vd = null; if (d.mode === "v") { goCard(d.base, { v: 0.6 }); APP.dragging = false; } } });
feed.addEventListener("click", (e) => { if (swallowFeedClick) { e.preventDefault(); e.stopPropagation(); } }, true);
addEventListener("resize", () => { if (APP.active >= 0) feed.scrollTop = APP.active * feedH(); });
const feedWheel = wheelGesture(stepFeed, 20);
feed.addEventListener("wheel", (e) => {
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? feed.clientHeight : 1);
  if (Math.abs(dy) <= Math.abs(e.deltaX)) return;
  const card = e.target.closest(".card");
  if (e.target.closest(".pane.side") && card && card.dataset.view && card.dataset.view !== "main") return;
  e.preventDefault();
  feedWheel(dy, e.timeStamp || performance.now());
}, { passive: false });

// Changing the page while a finger or trackpad is moving it makes phones drop the gesture (the next swipe then
// needs a tap first). So cards are filled, emptied and refreshed only once scrolling and dragging have stopped.
let scrolling = false, idleT = null, idleJobs = new Map();
const idle = () => !scrolling && !APP.dragging && !touching;
// A finger on the screen counts as busy too: replacing the card under it would cancel the swipe it is starting.
let touching = 0;
feed.addEventListener("touchstart", (e) => { touching = e.touches.length; }, { passive: true });
const touchEnd = (e) => { touching = e.touches.length; if (!touching) setTimeout(flushIdle, 0); };
feed.addEventListener("touchend", touchEnd, { passive: true });
feed.addEventListener("touchcancel", touchEnd, { passive: true });
function whenIdle(key, fn) { idleJobs.set(key, fn); if (idle()) flushIdle(); }
function flushIdle() { if (!idle()) return; const jobs = [...idleJobs.values()]; idleJobs.clear(); jobs.forEach((f) => f()); }
feed.addEventListener("scroll", () => { scrolling = true; clearTimeout(idleT); idleT = setTimeout(() => { scrolling = false; flushIdle(); }, 140); }, { passive: true });
export function buildFeed({ keepKey } = {}) {
  APP.syms = currentSyms();
  APP.seq = [{ type: "catchup" }];
  pushRound(1);
  feed.innerHTML = APP.seq.map((it, i) => shell(it, i)).join("");
  APP.active = -1;
  $("switchName").textContent = listName();
  observe();
  let target = 0;
  if (keepKey) { const i = APP.seq.findIndex((x) => x.sym?.key === keepKey); if (i >= 0) target = i; }
  cancelAnimationFrame(anim?.raf || 0); anim = null; fTarget = target;
  feed.scrollTop = target * feed.clientHeight;
  setActive(target);
  syncCards();
  APP.built = true;
}
function pushRound(round) {
  if (!APP.syms.length) { APP.seq.push({ type: "empty" }); return; }
  APP.syms.forEach((sym, j) => APP.seq.push({ type: "sym", sym, round, j }));
  APP.seq.push({ type: "done", round });
}
const shell = (it, i) => `<section class="card" data-i="${i}" aria-roledescription="slide" aria-label="${esc(it.sym ? it.sym.t : it.type)}"></section>`;
function appendRound() {
  const round = (APP.seq[APP.seq.length - 1].round || 1) + 1;
  const start = APP.seq.length;
  pushRound(round);
  feed.insertAdjacentHTML("beforeend", APP.seq.slice(start).map((it, k) => shell(it, start + k)).join(""));
  feed.querySelectorAll(".card").forEach((c) => io.observe(c));
}
function observe() {
  io?.disconnect();
  io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting && e.intersectionRatio > 0.6) setActive(+e.target.dataset.i);
  }, { root: feed, threshold: [0.6] });
  feed.querySelectorAll(".card").forEach((c) => io.observe(c));
}

function setActive(i) {
  if (i === APP.active || !APP.seq[i]) return;
  const prevActive = APP.active;
  APP.active = i;
  if (prevActive >= 0) haptic();
  const cards = feed.querySelectorAll(".card");
  if (!cards[i].dataset.filled) fillCard(cards[i], APP.seq[i]);
  cards.forEach((c, k) => c.classList.toggle("active", k === i));
  const it = APP.seq[i];
  if (it.type === "sym") markSeen(it.sym.key);
  progress();
  whenIdle("sync", syncCards);
}
// Fill the neighbours and empty far cards so memory stays flat.
function syncCards() {
  const i = APP.active, cards = feed.querySelectorAll(".card");
  cards.forEach((c, k) => {
    const near = Math.abs(k - i) <= 2;
    if (near && !c.dataset.filled) fillCard(c, APP.seq[k]);
    if (!near && c.dataset.filled && Math.abs(k - i) > 6) { c.innerHTML = ""; delete c.dataset.filled; }
  });
  const it = APP.seq[i];
  if (i >= APP.seq.length - 3) appendRound();
}
function progress() {
  const it = APP.seq[APP.active], n = APP.syms.length, el = $("progress");
  if (!n || n > 40) { el.innerHTML = ""; return; }
  const pos = it?.type === "sym" ? it.j : it?.type === "done" ? n : -1;
  el.innerHTML = APP.syms.map((_, k) => `<i class="${k === pos ? "on" : k < pos ? "seen" : ""}"></i>`).join("");
}
function markSeen(key) { const s = ls.get("pl.seen", {}); s[key] = new Date().toISOString(); ls.set("pl.seen", s); }

function fillCard(c, it) {
  c.dataset.filled = "1";
  if (it.type === "catchup") c.innerHTML = catchupHtml();
  else if (it.type === "done") c.innerHTML = doneHtml(it.round);
  else if (it.type === "empty") c.innerHTML = emptyHtml();
  else {
    c.innerHTML = `<div class="panes"><div class="pane side news" data-pane="news"></div><div class="pane main" data-pane="main"></div><div class="pane side details" data-pane="details"></div></div>`;
    renderMain(c, it);
    c._go = setupSwipe(c, it);
  }
  wire(c, it);
}

// ---------- main pane
function renderMain(c, it) {
  const s = it.sym, cs = chartSettings(), v = view(s.key, cs);
  const main = c.querySelector('[data-pane="main"]');
  c._v = v;
  // Only what matters while scrolling: the name, today's price and move, and the chart. News and details are a swipe away.
  const dots = `<div class="dots" aria-hidden="true"><i></i><i class="on"></i><i></i></div>` + (ls.get("pl.hinted") ? "" : `<div class="swipehint">Swipe ← details · → news</div>`);
  if (v) {
    const chg = v.daily.now.changePct;
    main.innerHTML = `<div class="head"><div class="tk">${esc(s.t)}</div><div class="pxrow"><span class="price">${esc(money(v.lastBar.c, s.m))}</span>
      <span class="chg ${chg >= 0 ? "up" : "down"}">${arrow(chg)} ${pct(chg)}</span></div></div>
      <div class="chartbox">${mainChart(v.win, v.ov, { type: cs.type, closeOnly: v.closeOnly, maKeys: cs.mas, interval: cs.interval })}</div>
      ${String(cs.lower || "none").split(",").filter((k) => k !== "none").map((k) => lowerChart(v.win, v.ov, k)).join("")}${dots}`;
  } else {
    main.innerHTML = `<div class="head"><div class="tk">${esc(s.t)}</div><div class="pxrow"><span class="price muted">–</span></div></div>
      <div class="chartbox nodata"><p>${D.status === "refreshing" ? `Loading ${esc(s.t)} prices…` : `${esc(s.t)} prices couldn't load. Pull to refresh or tap “Updated” at the top.`}</p></div>${dots}`;
  }
}
const addDays = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
// ---------- news pane
const whyRunning = new Set(), whyErr = new Map();
function renderNews(c, it, scope) {
  const s = it.sym, pane = c.querySelector('[data-pane="news"]');
  scope = scope || pane.dataset.scope || "sym";
  pane.dataset.scope = scope;
  const keys = new Set(APP.syms.map((x) => x.key));
  let stories = scope === "sym" ? storiesFor(s.key) : scope === "mine" ? (D.news.stories || []).filter((st) => st.syms.some((k) => keys.has(k))) : (D.news.stories || []).filter((st) => st.scopes?.length);
  stories = stories.slice(0, 40);
  const win = view(s.key, chartSettings())?.win;
  const winDates = new Set((win || []).map((b) => b.t));
  pane.innerHTML = `<div class="pane-wrap"><h2 class="side">News · ${esc(s.t)}</h2>
    <div class="seg" role="group" aria-label="Which news">${[["sym", s.t], ["mine", "All my news"], ["market", "Market"]].map(([k, l]) => `<button data-scope="${k}" aria-pressed="${k === scope}">${esc(l)}</button>`).join("")}</div>
    ${stories.length ? stories.map((st) => storyHtml(st, winDates.has(st.date) && scope === "sym")).join("") : `<div class="empty">No news in the last few days${scope === "sym" ? ` for ${esc(s.t)}` : ""}. That's information too.</div>`}
    <p class="disclaimer">News found via <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener">the GDELT Project</a> from outlets without political or ownership conflicts; headlines link to their publishers. ${esc(DISCLAIMER)}</p></div>`;
  pane.querySelectorAll("[data-scope]").forEach((b) => (b.onclick = () => renderNews(c, it, b.dataset.scope)));
  getSharedMany("explain", stories.slice(0, 20).map((x) => x.key)).then(() => patchWhy(pane));
  wireWhy(pane);
}
const STATUS = (st) => (st.status === "confirmed" ? `Confirmed by ${st.outlets.join(" + ")}` : st.status === "company" ? "From the company" : `Single source: ${st.outlets[0]}`);
function storyHtml(st, pinned) {
  const more = st.links.slice(1).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.source)} ↗</a>`).join(" ");
  return `<article class="story" id="st-${st.key}"><a class="h" href="${esc(st.links[0].url)}" target="_blank" rel="noopener">${esc(st.title)}</a>
    <div class="meta">${pinned ? `<span class="dotpin" title="Pinned on the chart"></span>` : ""}<span>${esc(fmtDay(st.date))}</span><span class="pill ${st.status}">${esc(STATUS(st))}</span>${more}</div>
    <div data-whybox="${st.key}">${whyHtml(st)}</div></article>`;
}
const hiddenWhy = () => new Set(ls.get("pl.hidden", []));
function whyHtml(st) {
  const ex = store.explain.get(st.key);
  if (ex?.status === "done") {
    if (hiddenWhy().has(st.key)) return `<button class="btn ghost sm" data-show="${st.key}">Show what this means</button>`;
    const srcs = (ex.sources || []).filter((x) => /^https?:\/\//.test(x.url || "")).slice(0, 3).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label || "Source")}</a>`).join(", ");
    return `<div class="why"><div class="why-head"><span class="label">What this means for ${esc(ex.who || "the company")}</span><button class="btn ghost sm" data-hide="${st.key}">Hide</button></div><p>${esc(ex.text)}</p>
      <div class="ai">AI-generated · ${esc(fmtDay((ex.at || "").slice(0, 10)))} · not investment advice${srcs ? ` · ${srcs}` : ""} · <button class="btn ghost sm" style="padding:0" data-report="${st.key}">Report</button></div></div>`;
  }
  const busy = whyRunning.has(st.key), err = whyErr.get(st.key) || (ex?.status === "failed" ? "Couldn't find enough on this story." : "");
  const tks = st.syms.map((k) => k.split(":")[1]);
  const who = !tks.length ? "the market" : tks.length <= 3 ? tks.join(", ") : "these companies";
  return `<button class="btn sm" data-why="${st.key}" ${busy ? "disabled" : ""}>${busy ? "Researching…" : `What this means for ${esc(who)}`}</button>${err || busy ? `<div class="hint" style="margin-top:4px">${esc(busy ? "Takes about a minute." : err)}</div>` : ""}`;
}
function patchWhy(root) {
  root.querySelectorAll("[data-whybox]").forEach((b) => { const st = (D.news.stories || []).find((x) => x.key === b.dataset.whybox); if (st) b.innerHTML = whyHtml(st); });
  wireWhy(root);
}
function wireWhy(root) {
  root.querySelectorAll("[data-why]").forEach((b) => (b.onclick = () => explain(b.dataset.why, root)));
  root.querySelectorAll("[data-hide]").forEach((b) => (b.onclick = () => { const h = hiddenWhy(); h.add(b.dataset.hide); ls.set("pl.hidden", [...h].slice(-500)); patchWhy(root); }));
  root.querySelectorAll("[data-show]").forEach((b) => (b.onclick = () => { const h = hiddenWhy(); h.delete(b.dataset.show); ls.set("pl.hidden", [...h]); patchWhy(root); }));
  root.querySelectorAll("[data-report]").forEach((b) => (b.onclick = async () => { try { await callAI("/report", { kind: "explain", key: b.dataset.report }); toast("Thanks. Reported texts are hidden after 3 reports until reviewed."); } catch (e) { toast(e.message); } }));
}
async function explain(key, root) {
  const st = (D.news.stories || []).find((x) => x.key === key);
  if (!st || whyRunning.has(key)) return;
  whyRunning.add(key); whyErr.delete(key); patchWhy(root);
  try {
    const companies = st.syms.map((k) => { const r = findSymbol(k); return { ticker: k.split(":")[1], name: r?.n || k.split(":")[1], market: k.split(":")[0] }; });
    const out = await callAI("/explain", { key, title: st.title, date: st.date, urls: st.links.map((l) => l.url).slice(0, 3), outlets: st.outlets, companies, scopes: st.scopes });
    if (out.doc) store.explain.set(key, out.doc);
  } catch (e) { whyErr.set(key, e.message); }
  finally { whyRunning.delete(key); patchWhy(root); }
}

// ---------- details pane
function renderDetails(c, it) {
  const s = it.sym, cs = chartSettings(), v = view(s.key, cs), pane = c.querySelector('[data-pane="details"]');
  const lists = watchlists().filter((w) => (w.syms || []).some((x) => x.key === s.key)).map((w) => w.name);
  const rules = (store.data?.rules || []).filter((r) => r.sym === s.key || (r.sym === "*" && s.m === "CRYPTO"));
  let html = `<div class="pane-wrap"><h2 class="side">${esc(s.t)} details</h2>`;
  if (v) {
    const b = v.daily ? D.series[s.key].bars.at(-1) : v.lastBar, d = v.daily.now;
    html += v.closeOnly ? `<div class="stat-grid" style="grid-template-columns:1fr 1fr"><div><span>Close ${esc(fmtDay(b.t))}</span><b>${esc(money(b.c, s.m))}</b></div><div><span>Change</span><b class="${d.changePct >= 0 ? "up" : "down"}">${pct(d.changePct)}</b></div></div>` : `<div class="stat-grid">${[["Open", b.o], ["High", b.h], ["Low", b.l], ["Close", b.c]].map(([k, x]) => `<div><span>${k}</span><b>${esc(money(x, s.m))}</b></div>`).join("")}</div>`;
    if (bigMove(v)) html += `<div class="box" data-movebox>${moveHtml(s, v)}</div>`;
    const act = (store.data?.indicators?.active || []).map((id) => APP.catalogue.find((x) => x.id === id)).filter(Boolean);
    const rows = act.flatMap((i) => (i.metrics || []).map((m) => ({ i, m })));
    html += `<h2>Readings</h2>${rows.map(({ i, m }) => { const meta = METRICS[m] || { label: m, digits: 2 }; return `<button class="reading" data-ind="${esc(i.id)}"><span class="k">${esc(meta.label)}</span><span class="v">${fmt(d[m], meta.digits)}${meta.unit && d[m] != null ? esc(meta.unit) : ""}</span><span class="d">${esc(describe(m, d, v.daily.prev))}</span></button>`; }).join("") || `<p class="hint">No indicators switched on. Choose them in Profile → Indicators.</p>`}`;
    const all = D.series[s.key].bars, last = all.at(-1).c;
    const rng = (n) => { const w = all.slice(-n); const lo = Math.min(...w.map((x) => x.l)), hi = Math.max(...w.map((x) => x.h)); return { lo, hi, p: hi > lo ? ((last - lo) / (hi - lo)) * 100 : 50 }; };
    html += `<h2>Where the price sits</h2>${[[50, "50-day range"], [Math.min(250, all.length), all.length >= 250 ? "52-week range" : `${all.length}-day range`]].map(([n, l]) => { const r = rng(n); return `<div class="box"><div class="rangerow"><b style="color:var(--text)">${l}</b><span>${r.p.toFixed(0)}% of the way up</span></div><div class="rangebar"><i style="left:${r.p.toFixed(1)}%"></i></div><div class="rangerow"><span>${esc(money(r.lo, s.m))}</span><span>${esc(money(r.hi, s.m))}</span></div></div>`; }).join("")}`;
    html += `<h2>Your rules</h2>${rules.length ? `<div class="list">${rules.map((r) => { const met = ruleMet(r, d, v.daily.prev); return `<div class="row"><div class="main"><span class="t">${esc(METRICS[r.metric]?.label || r.metric)} ${esc(OPS[r.op])} ${esc(r.value)}</span><span class="s">${met ? "Met on the latest bar" : "Not met"}${r.note ? " · " + esc(r.note) : ""}</span></div>${met ? `<span class="tag rule" style="opacity:1;transform:none">Met</span>` : ""}</div>`; }).join("")}</div>` : `<p class="hint">No rules for ${esc(s.t)} yet.</p>`}
      <button class="btn sm" data-addrule style="margin-top:8px">Add a rule for ${esc(s.t)}</button>`;
    html += `<h2>About</h2><div class="box"><p>${esc(s.n)} · ${esc(TYLABEL[s.ty] || "")} · ${esc(MKLABEL[s.m] || s.m)}</p><p class="hint">Data: ${esc(v.source)}${v.live ? ", refreshed when you opened the app" : ""}.</p></div>`;
  } else {
    html += `<div class="notice">Prices for ${esc(s.t)} haven't loaded yet.</div>`;
  }
  html += `<h2>In your watchlists</h2><p>${lists.length ? lists.map(esc).join(", ") : "None"} · <button class="btn ghost sm" data-save>Change</button></p>
    <p class="disclaimer">${esc(DISCLAIMER)}</p></div>`;
  pane.innerHTML = html;
  pane.querySelectorAll("[data-ind]").forEach((b) => (b.onclick = () => openIndicator(b.dataset.ind)));
  pane.querySelector("[data-addrule]")?.addEventListener("click", () => { location.hash = ""; showTab("profile", "rules", s.key); });
  pane.querySelectorAll("[data-save]").forEach((b) => (b.onclick = () => openListsFor(s)));
  const mb = pane.querySelector("[data-movebox]");
  if (mb) { const id = moveId(s, v); getShared("moves", id).then(() => { mb.innerHTML = moveHtml(s, v); wireMove(mb, s, v); }); wireMove(mb, s, v); }
}
const moveId = (s, v) => (s.key + "_" + D.series[s.key].bars.at(-1).t).replace(/[^\w-]/g, "_");
const moveBusy = new Set();
function moveHtml(s, v) {
  const id = moveId(s, v), m = store.moves.get(id), d = v.daily.now;
  const head = `<div class="label">Why did it move?</div><p style="font-weight:700">${esc(s.t)} ${d.changePct >= 0 ? "rose" : "fell"} ${Math.abs(d.changePct).toFixed(1)}% on the latest bar, about ${(Math.abs(d.changePct) / d.atrPct).toFixed(1)}x its usual daily move.</p>`;
  if (m?.status === "done") {
    const srcs = (m.sources || []).filter((x) => /^https?:\/\//.test(x.url || "")).slice(0, 3).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label || "Source")}</a>`).join(", ");
    return head + `<p>${esc(m.text)}</p><div class="ai">AI-generated · ${esc(fmtDay((m.at || "").slice(0, 10)))} · past move only, not a forecast or advice${srcs ? ` · ${srcs}` : ""}</div>`;
  }
  return head + `<button class="btn sm" data-moveai ${moveBusy.has(id) ? "disabled" : ""}>${moveBusy.has(id) ? "Looking into it…" : "Explain this move"}</button>`;
}
function wireMove(box, s, v) {
  const b = box.querySelector("[data-moveai]");
  if (!b) return;
  b.onclick = async () => {
    const id = moveId(s, v); moveBusy.add(id); box.innerHTML = moveHtml(s, v);
    try {
      const bar = D.series[s.key].bars.at(-1), day = bar.t;
      const stories = storiesFor(s.key).filter((st) => st.date >= addDays(day, -1)).slice(0, 5).map((st) => ({ title: st.title, url: st.links[0].url, outlets: st.outlets }));
      const out = await callAI("/why", { id, key: s.key, ticker: s.t, name: s.n, market: s.m, date: day, changePct: v.daily.now.changePct, close: bar.c, atrPct: v.daily.now.atrPct, volRatio: v.daily.now.volRatio, stories });
      if (out.doc) store.moves.set(id, out.doc);
    } catch (e) { toast(e.message); }
    moveBusy.delete(id); box.innerHTML = moveHtml(s, v); wireMove(box, s, v);
  };
}

// ---------- special cards
function catchupHtml() {
  const first = !ls.get("pl.lastOpen");
  const since = ls.get("pl.prevOpen");
  const facts = [];
  if (first) {
    return `<div class="special"><div class="label">Welcome to ${esc(CONFIG.appName)}</div><h1>Your watchlist,<br>one chart at a time.</h1>
      <div class="fact"><span class="ic acc">↕</span><div><b>Scroll</b> for the next chart. Every chart is drawn the same way, so moves are easy to compare.</div></div>
      <div class="fact"><span class="ic acc">→</span><div><b>Swipe right</b> for the news behind the chart, with what it means for the company.</div></div>
      <div class="fact"><span class="ic acc">←</span><div><b>Swipe left</b> for the details: readings in plain words, ranges and your rules.</div></div>
      <div class="fact"><span class="ic acc">+</span><div><b>Add coins</b> and sort them into watchlists like “Semiconductors”.</div></div>
      <p class="hint">Information only, never advice. Swipe up to start.</p></div>`;
  }
  // Daily recap: today's moves across the list, then what is new since the last visit.
  const cs = chartSettings();
  const vs = APP.syms.map((s) => ({ s, v: view(s.key, cs) })).filter((x) => x.v);
  const chg = (x) => x.v.daily.now.changePct;
  const ups = vs.filter((x) => chg(x) > 0).length;
  const best = vs.reduce((a, x) => (!a || chg(x) > chg(a) ? x : a), null), worst = vs.reduce((a, x) => (!a || chg(x) < chg(a) ? x : a), null);
  const keys = new Set(APP.syms.map((s) => s.key)), stories = D.news.stories || [];
  const newsBy = vs.map((x) => ({ x, n: stories.filter((st) => st.syms.includes(x.s.key)).length })).sort((a, b) => b.n - a.n)[0];
  const tile = (label, val, sub, cls = "") => `<div><span>${label}</span><b class="${cls}">${val}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
  const tiles = vs.length ? `<div class="recap">${tile("Up today", `${ups}/${vs.length}`, "coins")}${best ? tile("Biggest rise", esc(best.s.t), pct(chg(best)), chg(best) >= 0 ? "up" : "down") : ""}${worst && worst !== best ? tile("Biggest fall", esc(worst.s.t), pct(chg(worst)), chg(worst) >= 0 ? "up" : "down") : ""}${newsBy?.n ? tile("Most news", esc(newsBy.x.s.t), `${newsBy.n} ${newsBy.n === 1 ? "story" : "stories"}`) : ""}</div>` : "";
  const fresh = stories.filter((st) => st.syms.some((k) => keys.has(k)) && (!since || (st.ts || st.date) > since));
  if (fresh.length) {
    const top = fresh.find((st) => st.status === "confirmed") || fresh[0];
    facts.push(`<div class="fact"><span class="ic acc">${fresh.length}</span><div><b>${fresh.length} new ${fresh.length === 1 ? "story" : "stories"}</b> since you last looked. Latest: “${esc(top.title.slice(0, 80))}${top.title.length > 80 ? "…" : ""}”</div></div>`);
  }
  const unread = store.alerts.filter((a) => !a.read).length;
  if (unread) facts.push(`<div class="fact"><span class="ic acc">!</span><div><b>${unread} alert${unread === 1 ? "" : "s"}</b> waiting. See Profile → Alerts.</div></div>`);
  const today = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return `<div class="special"><div class="label">Daily recap · ${esc(today)}${since ? ` · last visit ${esc(ago(since))}` : ""}</div>
    <h1>${vs.length ? `${ups} of ${vs.length} up today.` : "Prices are loading."}</h1>${tiles}${facts.join("")}
    <p class="hint">${APP.syms.length} in ${esc(listName())} · swipe up to start</p></div>`;
}
function doneHtml(round) {
  return `<div class="special done" style="align-items:flex-start"><svg class="done-ring" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34"/><path d="M26 41l9 9 19-20"/></svg>
    <h1>You're all caught up.</h1><p>You've seen all ${APP.syms.length} in ${esc(listName())}${round > 1 ? ` (round ${round})` : ""}. Prices refresh each time you open the app.</p>
    ${quizHtml(round)}<p class="hint">Keep scrolling to go round again.</p></div>`;
}
function emptyHtml() {
  return `<div class="special"><h1>Nothing here yet.</h1><p>Add coins to ${esc(listName())} to fill your feed.</p><button class="btn primary" data-act="add">Add coins</button></div>`;
}

// ---------- sideways swipes between a card's views: news (finger moves right), chart, details (finger moves left).
// Vertical swipes are never touched here; the browser scrolls the feed natively (touch-action: pan-y).
const PANE = { news: 0, main: 1, details: 2 };
function setupSwipe(c, it) {
  const track = c.querySelector(".panes");
  let idx = 1, sx = 0, sy = 0, dx = 0, t0 = 0, mode = null, pid = null, sides = false, swallowClick = false;
  const ensureSides = () => { if (!sides) { sides = true; renderNews(c, it); renderDetails(c, it); } };
  const go = (i) => {
    idx = Math.max(0, Math.min(2, i));
    track.classList.remove("dragging");
    track.style.transform = `translate3d(${(-idx * 100) / 3}%, 0, 0)`;
    if (idx !== 1) ensureSides();
    c.dataset.view = ["news", "main", "details"][idx];
    c.querySelectorAll(".dots i").forEach((d, k) => d.classList.toggle("on", k === idx));
    if (idx !== 1 && !ls.get("pl.hinted")) { ls.set("pl.hinted", 1); feed.querySelectorAll(".swipehint").forEach((h) => h.remove()); }
  };
  track.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pid = e.pointerId; sx = e.clientX; sy = e.clientY; dx = 0; mode = null; t0 = performance.now();
  });
  track.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pid || APP.scrub) return;
    const mx = e.clientX - sx, my = e.clientY - sy;
    if (!mode) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.2) { mode = "h"; APP.dragging = true; try { track.setPointerCapture(pid); } catch {} track.classList.add("dragging"); ensureSides(); }
      else if (Math.abs(my) > 10) { mode = "v"; return; }
      else return;
    }
    if (mode !== "h") return;
    dx = mx;
    const w = track.clientWidth / 3, off = Math.max(-2.15 * w, Math.min(0.15 * w, -idx * w + dx));
    track.style.transform = `translate3d(${off}px, 0, 0)`;
  });
  const end = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    if (mode === "h") {
      const w = track.clientWidth / 3, v = dx / Math.max(1, performance.now() - t0);
      go(dx < -0.22 * w || v < -0.45 ? idx + 1 : dx > 0.22 * w || v > 0.45 ? idx - 1 : idx);
      swallowClick = true; setTimeout(() => (swallowClick = false), 60);
    }
    mode = null;
    if (APP.dragging) { APP.dragging = false; setTimeout(flushIdle, 0); }
  };
  // Once a sideways swipe has started, stop the browser treating it as Back/Forward navigation.
  track.addEventListener("touchmove", (e) => { if (mode === "h" && e.cancelable) e.preventDefault(); }, { passive: false });
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);
  track.addEventListener("click", (e) => { if (swallowClick) { e.preventDefault(); e.stopPropagation(); } }, true);
  // Trackpads and mice send sideways swipes as wheel events: one pane per gesture, ignoring the momentum tail.
  const paneWheel = wheelGesture((dir) => go(idx + dir), 30);
  track.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical: leave it to the feed
    e.preventDefault();
    paneWheel(e.deltaX, e.timeStamp || performance.now());
  }, { passive: false });
  return go;
}

// Keyboard on desktop: up/down for the next symbol, left/right for news and details.
document.addEventListener("keydown", (e) => {
  if (APP.tab !== "feed" || !$("sheet").hidden || /input|select|textarea/i.test(e.target.tagName)) return;
  const c = feed.querySelector(".card.active");
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); stepFeed(e.key === "ArrowDown" ? 1 : -1); }
  else if (c?._go && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { const cur = PANE[c.dataset.view || "main"]; c._go(cur + (e.key === "ArrowRight" ? 1 : -1)); }
});

// ---------- interactions on a card
function wire(c, it) {
  c.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => (b.dataset.act === "add" ? openAddSheet() : showTab("dash"))));
  if (it.type === "done") wireQuiz(c);
  if (it.type !== "sym") return;
  const justScrubbed = () => Date.now() - (APP.scrubEndAt || 0) < 400;
  c.querySelectorAll("[data-learn]").forEach((p) => p.addEventListener("click", () => { if (!justScrubbed()) openLearn(p.dataset.learn, c._v); }));
  c.querySelector(".chartbox:not(.nodata)")?.addEventListener("click", () => { if (!justScrubbed()) chartTapHint(); });
}

// ---------- tabs and refresh
export function showTab(tab, sub, arg) {
  APP.tab = tab;
  $("sFeed").hidden = tab !== "feed"; $("sDash").hidden = tab !== "dash"; $("sProfile").hidden = tab !== "profile";
  document.querySelectorAll(".tabbar button").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false"));
  if (tab === "dash") renderDash();
  if (tab === "profile") renderProfile(sub, arg);
  if (tab === "feed" && APP.needsRebuild) { APP.needsRebuild = false; buildFeed({ keepKey: APP.seq[APP.active]?.sym?.key }); }
}
document.querySelectorAll(".tabbar button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
$("addBtn").onclick = () => openAddSheet();
$("switcher").onclick = () => openSwitcher();
$("status").onclick = () => doRefresh(true);

function setStatus() {
  const el = $("status");
  el.classList.toggle("refreshing", D.status === "refreshing");
  el.textContent = D.status === "refreshing" ? "Updating…" : D.status === "error" ? "Offline · saved" : D.refreshedAt ? `Updated ${hhmm(D.refreshedAt)}` : "Tap to update";
}
let lastRefresh = 0;
export async function doRefresh(manual) {
  if (D.status === "refreshing") return;
  setStatus(); D.status = "refreshing"; setStatus();
  await refresh(allSyms());
  lastRefresh = Date.now();
  setStatus();
  if (store.mode === "demo") demoRules();
  // redraw visible cards in place, keeping the user's position
  const keep = APP.seq[APP.active]?.sym?.key;
  if (manual || !APP.built) buildFeed({ keepKey: keep });
  else whenIdle("refill", () => feed.querySelectorAll(".card").forEach((c) => {
    if (!c.dataset.filled || Math.abs(+c.dataset.i - APP.active) > 2 || (c.dataset.view && c.dataset.view !== "main")) return;
    delete c.dataset.filled; delete c.dataset.view; c.innerHTML = ""; fillCard(c, APP.seq[+c.dataset.i]); c.classList.toggle("active", +c.dataset.i === APP.active);
  }));
  if (manual) toast("Up to date.");
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") ls.set("pl.lastOpen", new Date().toISOString());
  else if (Date.now() - lastRefresh > 60000) doRefresh(false);
});

export function applyTheme() {
  const t = store.data?.settings?.theme || "dark";
  const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#0B0F14" : "#F4F6F8";
}

// ---------- boot
(async function boot() {
  document.title = CONFIG.appName;
  ls.set("pl.prevOpen", ls.get("pl.lastOpen"));
  loadCached();
  APP.catalogue = await fetch("data/indicators.json").then((r) => r.json()).catch(() => []);
  let onboarding = false;
  try { ({ onboarding } = await init()); } catch { toast(store.error || "Couldn't start. Check your connection."); }
  // Cleaner cards (v2): candles on their own by default; moving averages and the lower panel are opt-in.
  const ch = store.data?.settings?.chart;
  if (store.data && !store.data.settings?.coinsOnly) {
    // Coins only (v3): drop stocks from watchlists; an untouched starter list becomes the top 10 coins.
    const OLD = new Set(["CRYPTO:BTC", "NSE:RELIANCE", "NSE:HDFCBANK", "NASDAQ:NVDA", "CRYPTO:XRP", "ARCA:VOO", "CRYPTO:PAXG"]);
    const wl = watchlists().map((w) => ((w.syms || []).every((x) => OLD.has(x.key)) && w.id === "w1" ? { ...w, syms: STARTER.slice() } : { ...w, syms: (w.syms || []).filter((x) => x.m === "CRYPTO") }));
    save({ watchlists: wl, settings: { ...store.data.settings, coinsOnly: 1 } }).catch(() => {});
  }
  // v4: RSI and MACD panels under every chart by default.
  if (ch && ch.v2 && !ch.v4) save({ settings: { ...store.data.settings, chart: { ...ch, lower: "RSI,MACD", v4: 1 } } }).catch(() => {});
  if (ch && !ch.v2) save({ settings: { ...store.data.settings, chart: { ...ch, type: "candles", mas: [], lower: "RSI,MACD", v2: 1, v4: 1 } } }).catch(() => {});
  applyTheme();
  initPages();
  store.on((what) => {
    $("alertDot").hidden = !store.alerts.some((a) => !a.read);
    if (what === "account") { applyTheme(); APP.needsRebuild = true; if (APP.tab === "dash") renderDash(); }
  });
  if (onboarding) { renderOnboarding(); return; }
  $("alertDot").hidden = !store.alerts.some((a) => !a.read);
  buildFeed();
  await doRefresh(false);
  setTimeout(() => ls.set("pl.lastOpen", new Date().toISOString()), 4000);
  loadSymbols().catch(() => {});
})();
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js" + (CONFIG.firebase ? "?config=" + encodeURIComponent(JSON.stringify(CONFIG.firebase)) : "")).catch(() => {});
}
