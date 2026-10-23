// The chart feed. Scroll up or down for the next coin; swipe for its news (finger moves right) or its details (finger
// moves left). The feed loops through the list with a "caught up" card between rounds. A card's main pane is drawn
// here; its news and details panes are news.js and details.js.
import { store, ls, saveSoon, chartSettings } from "./store.js";
import { openPredictSheet } from "./callit.js";
import { mainChart, lowerChart } from "./chart.js";
import { picks, studyWindow } from "./studies.js";
import { openPanels, withExpand } from "./panels.js";
import { openFull } from "./full.js";
import { topPage } from "./nav.js";
import { initFeedback } from "./feedback.js";
import { initInteract, openLearn, chartTapHint, quizHtml, wireQuiz, cancelPendingHold } from "./interact.js";
import { dueAt, HORIZONS } from "./score.js";
import { D, view, RANGES, INTRA, intraState, RANGE_LABEL } from "./data.js";
import { $, esc, money, pct, haptic } from "./ui.js";
import { openAddSheet, openChartSheet } from "./pages.js";
import { onboarding } from "./onboard.js";
import { APP, currentSyms, listName, openDash } from "./app.js";
import { renderNews } from "./news.js";
import { renderDetails } from "./details.js";

// ---------- feed construction (virtual: shells for every slot, content only near the visible card)
export const feed = $("feed");
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
initFeedback(); // press and hold anything for 3 seconds (or Feedback mode in Profile) to leave a note about that part
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
export function whenIdle(key, fn) { idleJobs.set(key, fn); if (idle()) flushIdle(); }
function flushIdle() { if (!idle()) return; const jobs = [...idleJobs.values()]; idleJobs.clear(); jobs.forEach((f) => f()); }
feed.addEventListener("scroll", () => { scrolling = true; clearTimeout(idleT); idleT = setTimeout(() => { scrolling = false; flushIdle(); }, 140); }, { passive: true });
export function buildFeed({ keepKey } = {}) {
  APP.syms = currentSyms();
  APP.seq = []; // 1.2.0: the feed opens on the first coin; the daily recap card is gone (the list view covers it)
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
  if (i >= APP.seq.length - 3) appendRound();
}
// Where you are in the list (1.3.2): a thin rail on the right edge, the current coin a longer bar. It replaced story-style
// bars at the top, which read as "tap to go on" (designer's feedback); the feed is swiped, never tapped through.
function progress() {
  const it = APP.seq[APP.active], n = APP.syms.length, el = $("rail");
  if (n < 2 || n > 40) { el.innerHTML = ""; return; }
  const pos = it?.type === "sym" ? it.j : it?.type === "done" ? n : -1;
  el.innerHTML = APP.syms.map((_, k) => `<i class="${k === pos ? "on" : k < pos ? "seen" : ""}"></i>`).join("");
}
function markSeen(key) { const s = ls.get("pl.seen", {}); s[key] = new Date().toISOString(); ls.set("pl.seen", s); }

export function fillCard(c, it) {
  c.dataset.filled = "1";
  if (it.type === "done") c.innerHTML = doneHtml(it.round);
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
  const s = it.sym, cs = chartSettings(s.key), v = view(s.key, cs);
  const main = c.querySelector('[data-pane="main"]');
  // Only what matters while scrolling: the name, today's price and move, and the chart. News and details are a swipe away.
  const dots = `<div class="dots" aria-hidden="true"><i></i><i class="on"></i><i></i></div>`;
  if (v) {
    const chg = v.windowChange; // the move over the time range on screen (1D: the last 24 hours), not the calendar day
    // 1.3.2: the card keeps to the candles, your open calls and up to two panels you chose for the feed. Indicators,
    // lines and support/resistance live in the full-screen chart (its expand button), where there's room to read them.
    const pk = picks(store.data?.settings?.chart), shown = pk.feed, ov = studyWindow(v.bars, v.ov, v.bars.length - v.win.length, v.bars.length, shown);
    c._v = Object.assign(Object.create(v), { ov, picks: { over: [], lower: shown } }); // what hold-to-read and the panel guides read from (a copy would work out the readings)
    const calls = callLevels(s, v);
    main.innerHTML = `<div class="head2"><div class="tkrow"><span class="tk">${esc(s.n || s.t)}</span><span class="tks">${esc(s.t)}</span></div>
      <div class="pxrow"><span class="price">${esc(money(v.lastBar.c, s.m))}</span><span class="chg ${chg >= 0 ? "up" : "down"}" title="Change over ${esc(RANGE_LABEL[v.range] || v.range)}">${pct(chg, 1)}<small>${esc(v.range === "1D" ? "today" : v.range)}</small></span></div>
      ${predChip(s)}</div>
      <div class="rangerow"><div class="seg" role="group" aria-label="Time range">${["1D", "1W", "1M", "1Y"].map((r) => `<button data-range="${r}" aria-pressed="${v.range === r}">${r}</button>`).join("")}</div>
        <button class="cfull" data-full aria-label="Open ${esc(s.t)} full screen, with indicators and lines"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg></button></div>
      <div class="chartbox">${mainChart(v.win, ov, { type: cs.type, closeOnly: v.closeOnly, over: [], interval: v.interval, days: RANGES[v.range], levels: calls })}</div>
      ${shown.length ? `<div class="lowers">${withExpand(shown.map((k) => lowerChart(v.win, ov, k)).join(""), shown.length)}</div>` : ""}`;
  } else {
    c._v = null;
    main.innerHTML = `<div class="head"><div class="hl"><div class="tk">${esc(s.t)}</div><div class="pxrow"><span class="price muted">–</span></div></div><div class="hr"><button class="tfbtn" data-tf aria-label="Chart settings for ${esc(s.t)}"><b>${esc(cs.range)}</b><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4"/></svg></button></div></div>
      <div class="chartbox nodata"><p>${INTRA[cs.range] && D.series[s.key] ? (intraState(s.key, cs.range).failed ? `${esc(s.t)}'s ${cs.range === "1D" ? "15-minute" : "hourly"} candles couldn't load just now. Tap the time chip to pick a longer range, or try again in a minute.` : `Loading ${cs.range === "1D" ? "15-minute" : "hourly"} candles for ${esc(s.t)}…`) : D.status === "refreshing" ? `Loading ${esc(s.t)} prices…` : `${esc(s.t)} prices couldn't load. Pull to refresh or tap “Updated” at the top.`}</p></div>${dots}`;
  }
}

// ---------- special cards
function doneHtml(round) {
  return `<div class="special done" style="align-items:flex-start"><svg class="done-ring" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34"/><path d="M26 41l9 9 19-20"/></svg>
    <h1>You're all caught up.</h1><p>You've seen all ${APP.syms.length} in ${esc(listName())}${round > 1 ? ` (round ${round})` : ""}. Prices refresh each time you open the app.</p>
    ${quizHtml(round)}<p><button class="btn" data-act="add">+ Add a coin</button></p><p class="hint">Keep scrolling to go round again.</p></div>`;
}
function emptyHtml() {
  return `<div class="special"><h1>Nothing here yet.</h1><p>Add coins to ${esc(listName())} to fill your feed.</p><button class="btn primary" data-act="add">Add coins</button></div>`;
}

// ---------- sideways swipes between a card's views: news (finger moves right), chart, details (finger moves left).
// Vertical swipes are never touched here; the browser scrolls the feed natively (touch-action: pan-y).
export const PANE = { news: 0, main: 1, details: 2 };
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
  if (APP.tab !== "feed" || topPage() || !$("sheet").hidden || /input|select|textarea/i.test(e.target.tagName)) return;
  const c = feed.querySelector(".card.active");
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); stepFeed(e.key === "ArrowDown" ? 1 : -1); }
  else if (c?._go && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { const cur = PANE[c.dataset.view || "main"]; c._go(cur + (e.key === "ArrowRight" ? 1 : -1)); }
});

// ---------- interactions on a card
function wire(c, it) {
  c.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => (b.dataset.act === "add" ? openAddSheet() : openDash())));
  if (it.type === "done") wireQuiz(c);
  if (it.type !== "sym") return;
  const justScrubbed = () => Date.now() - (APP.scrubEndAt || 0) < 400;
  c.querySelectorAll("[data-learn]").forEach((p) => p.addEventListener("click", (e) => { e.stopPropagation(); if (!justScrubbed()) openLearn(p.dataset.learn, c._v); }));
  c.querySelector("[data-pexp]")?.addEventListener("click", (e) => { e.stopPropagation(); openPanels(c._v, it.sym, RANGES[c._v?.range]); });
  // the time range is one choice for every coin: it becomes the default and no coin keeps an older range of its own
  // (until 1.4.2 a coin with its own range kept it, feedback 15 Oct); drawn at once, saved in the background
  c.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation(); if (b.getAttribute("aria-pressed") === "true") return;
    const st = store.data.settings, by = {};
    for (const [k, o] of Object.entries(st.chartBy || {})) { const { range, ...rest } = o; if (Object.keys(rest).length) by[k] = rest; }
    saveSoon({ settings: { ...st, chartBy: by, chart: { ...st.chart, range: b.dataset.range } } });
    redrawCards();
  }));
  c.querySelector(".chartbox:not(.nodata)")?.addEventListener("click", () => { if (!justScrubbed()) chartTapHint(); });
  // two fingers on a card's chart: open it full screen, where pinching zooms the chart
  c.querySelector(".chartbox")?.addEventListener("touchstart", (e) => { if (e.touches.length === 2) { cancelPendingHold(); openFull(it.sym); } }, { passive: true });
  c.querySelector("[data-full]")?.addEventListener("click", (e) => { e.stopPropagation(); if (!justScrubbed()) openFull(it.sym); });
  c.querySelector("[data-tf]")?.addEventListener("click", (e) => { e.stopPropagation(); openChartSheet(it.sym, () => redrawCards()); });
  c.querySelector("[data-pred]")?.addEventListener("click", (e) => { e.stopPropagation(); openPredictSheet(it.sym, () => redrawCards(it.sym.key)); });
}
// Call it (1.2.0): the small button under the price, with how many calls are waiting on that coin.
function predChip(s) {
  const open = store.preds.filter((p) => p.coin === s.key).sort((a, b) => Date.parse(dueAt(a)) - Date.parse(dueAt(b)));
  const next = open[0], left = next ? Math.max(0, Math.round((Date.parse(dueAt(next)) - Date.now()) / 60000)) : 0;
  const leftText = !next ? "" : left <= 0 ? "scoring now" : left < 60 ? `${left} min` : left < 2880 ? `${Math.floor(left / 60)} h` : `${Math.round(left / 1440)} days`;
  return `<div class="callrow2"><button class="callit" data-pred aria-label="Call ${esc(s.t)}${open.length ? `, ${open.length} waiting` : ""}">Call it</button>${open.length ? `<span class="hint">${open.length} call${open.length === 1 ? "" : "s"} waiting${leftText ? `, ${leftText}` : ""}</span>` : ""}</div>`;
}
// Your open calls on this coin, as lines on its chart (1.2.0): from the candle they were made in, at the price called.
function callLevels(s, v) {
  const out = [];
  for (const p of store.preds) {
    if (p.coin !== s.key || !p.target) continue;
    const made = p.createdAt ? p.createdAt.slice(0, v.win[0]?.t?.length || 10) : null;
    let from = made ? v.win.findIndex((b) => b.t >= made) : -1;
    if (from < 0 && made && v.win.length && made > v.win.at(-1).t) from = v.win.length - 1;
    out.push({ kind: "C", price: p.target, from: Math.max(0, from), id: p.id || "", label: p.horizon ? `Your ${HORIZONS[p.horizon]?.label || ""} call` : "Your call" });
  }
  return out;
}
// Redraw every filled coin card in place (after a chart setting changes or intraday candles arrive), so no card
// on screen shows an older setting. key: only that coin's cards.
export function redrawCards(key) {
  feed.querySelectorAll(".card").forEach((c) => {
    const it = APP.seq[+c.dataset.i];
    if (!c.dataset.filled || it?.type !== "sym" || (key && it.sym.key !== key)) return;
    renderMain(c, it); wire(c, it);
    if (c.querySelector('[data-pane="details"]')?.childElementCount) renderDetails(c, it);
  });
  APP.needsRebuild = true;
}

// Once per phone (1.3.1): a quiet hint on the first coin that its news and "Before you call" are a swipe away. It goes at
// the first sideways swipe, a tap, or after 8 seconds. Waits until nothing else is on top.
export function swipeHint(tries = 0) {
  if (ls.get("pl.swipeHint") || tries > 120) return;
  const c = feed.querySelector(".card.active");
  if (APP.tab !== "feed" || topPage() || onboarding() || document.getElementById("guide") || !$("sheet").hidden || !c?.querySelector(".chartbox")) { setTimeout(() => swipeHint(tries + 1), 1000); return; }
  ls.set("pl.swipeHint", 1);
  const h = document.createElement("div"); h.className = "swhint"; h.setAttribute("role", "note");
  h.innerHTML = `<span>‹ News</span><b>Swipe sideways</b><span>Before you call ›</span>`;
  c.querySelector('[data-pane="main"]').appendChild(h);
  const off = () => { h.classList.add("out"); setTimeout(() => h.remove(), 300); };
  h.onclick = off; setTimeout(off, 8000);
  new MutationObserver((_, o) => { if (c.dataset.view && c.dataset.view !== "main") { off(); o.disconnect(); } }).observe(c, { attributes: true, attributeFilter: ["data-view"] });
}
