// Pulse: the chart feed. Scroll up or down for the next symbol; swipe for its news (finger moves right)
// or its details (finger moves left). The feed loops through the watchlist with a "caught up" card between rounds.
import { CONFIG } from "../config.js";
import { store, ls, init, save, STARTER, chartSettings, allSyms, watchlists, settleDemoPredictions } from "./store.js";
import { krakenRows } from "./predict.js";
import { loadSymbols, TYLABEL, findSymbol } from "./search.js";
import { METRICS, OPS, ruleMet, fmt } from "./indicators.js";
import { describe } from "./describe.js";
import { mainChart, lowerChart } from "./chart.js";
import { levelsFor, swingLevels } from "./levels.js";
import { picks, studyWindow, maxPanels, OVERLAYS, PANELS } from "./studies.js";
import { startTour, coachEvent } from "./coach.js";
import { openFull } from "./full.js";
import { initFeedback } from "./feedback.js";
import { initInteract, openLearn, chartTapHint, quizHtml, wireQuiz } from "./interact.js";
import { D, loadCached, refresh, view, bigMove, storiesFor, RANGES, krakenBars, INTRA, intraState, IV_LABEL, resolveInterval, dailyOf } from "./data.js";
import { $, esc, money, pct, arrow, fmtDay, hhmm, ago, toast, haptic, DISCLAIMER } from "./ui.js";
import { initPages, renderDash, renderProfile, openAddSheet, openSwitcher, openListsFor, openIndicator, openChartSheet, openIndicatorsSheet, openLinesSheet, demoRules, openPredictSheet } from "./pages.js";

export const APP = { tab: "feed", seq: [], active: -1, syms: [], catalogue: [], built: false };

// ---------- which symbols, in which order
export function currentSyms() {
  const list = store.data?.settings?.list || "all";
  let syms = list === "all" ? allSyms() : (watchlists().find((w) => w.id === list)?.syms || allSyms());
  const order = chartSettings().order;
  const chg = (s) => view(s.key, dailyOf(chartSettings()))?.daily.now.changePct;
  if (order === "move") syms = [...syms].sort((a, b) => Math.abs(chg(b) ?? -1) - Math.abs(chg(a) ?? -1));
  else if (order === "news") syms = [...syms].sort((a, b) => storiesFor(b.key).length - storiesFor(a.key).length);
  else if (order === "az") syms = [...syms].sort((a, b) => a.t.localeCompare(b.t));
  else if (order === "rsi") syms = [...syms].sort((a, b) => (view(a.key, dailyOf(chartSettings()))?.now.rsi14 ?? 999) - (view(b.key, dailyOf(chartSettings()))?.now.rsi14 ?? 999));
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
initFeedback(); // triple-tap anything (or Feedback mode in Profile) to leave a note about that part
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
  if (prevActive >= 0) coachEvent("card", { sym: it.type === "sym" });
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
  const s = it.sym, cs = chartSettings(s.key), v = view(s.key, cs);
  const main = c.querySelector('[data-pane="main"]');
  // Only what matters while scrolling: the name, today's price and move, and the chart. News and details are a swipe away.
  const dots = `<div class="dots" aria-hidden="true"><i></i><i class="on"></i><i></i></div>`;
  if (v) {
    const chg = v.daily.now.changePct;
    // The chip at the top right says what the chart covers and opens the chart settings for this coin.
    const own = !!store.data?.settings?.chartBy?.[s.key];
    const lvMode = cs.levels || "off";
    // indicators are one shared choice (the ƒx button); cards show as many panels as the screen fits
    const pk = picks(store.data?.settings?.chart), shown = pk.lower.slice(0, maxPanels()), ov = studyWindow(v.bars, v.ov, v.bars.length - v.win.length, v.bars.length, [...pk.over, ...shown]);
    c._v = { ...v, ov, picks: { over: pk.over, lower: shown } }; // what hold-to-read and the panel guides read from
    main.innerHTML = `<div class="head"><div class="hl"><div class="tkrow"><span class="tk">${esc(s.t)}</span><span class="chg ${chg >= 0 ? "up" : "down"}">${arrow(chg)} ${pct(chg)}</span></div>
      <div class="pxrow"><span class="price">${esc(money(v.lastBar.c, s.m))}</span></div></div>
      <div class="hr"><button class="tfbtn${own ? " own" : ""}" data-tf aria-label="Chart settings for ${esc(s.t)}: ${esc(v.range)}, ${esc(v.ivLabel.toLowerCase())} candles"><b>${esc(v.range)}</b><span>${esc(v.ivLabel)}</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4"/></svg></button>
      <div class="hr2"><button class="lvbtn fxchip" data-fx aria-label="Indicators: ${pk.over.length + pk.lower.length} on"><i>ƒx</i>${pk.over.length + pk.lower.length || "Add"}</button><button class="lvbtn" data-lv aria-pressed="${lvMode !== "off"}" aria-label="Support and resistance lines"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 5h14M1 11h14"/></svg>${lvMode === "pivots" ? "Pivots" : "S/R"}</button></div></div></div>
      <div class="chartbox"><button class="fxbtn" data-full aria-label="Open ${esc(s.t)} full screen"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg></button>${mainChart(v.win, ov, { type: cs.type, closeOnly: v.closeOnly, over: pk.over, interval: v.interval, days: RANGES[v.range], levels: levelsFor(v, lvMode) })}</div>
      ${shown.length ? `<div class="lowers${shown.length > 2 ? " g2" : ""}">${shown.map((k) => lowerChart(v.win, ov, k)).join("")}</div>` : ""}<div class="cfoot"><i></i>${dots}${predChip(s)}</div>`;
  } else {
    c._v = null;
    main.innerHTML = `<div class="head"><div class="hl"><div class="tk">${esc(s.t)}</div><div class="pxrow"><span class="price muted">–</span></div></div><div class="hr"><button class="tfbtn" data-tf aria-label="Chart settings for ${esc(s.t)}"><b>${esc(cs.range)}</b><span>${esc(IV_LABEL[resolveInterval(cs)] || "")}</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4"/></svg></button></div></div>
      <div class="chartbox nodata"><p>${INTRA[cs.range] && D.series[s.key] ? (intraState(s.key, cs.range).failed ? `${esc(s.t)}'s ${cs.range === "1D" ? "15-minute" : "hourly"} candles couldn't load just now. Tap the time chip to pick a longer range, or try again in a minute.` : `Loading ${cs.range === "1D" ? "15-minute" : "hourly"} candles for ${esc(s.t)}…`) : D.status === "refreshing" ? `Loading ${esc(s.t)} prices…` : `${esc(s.t)} prices couldn't load. Pull to refresh or tap “Updated” at the top.`}</p></div>${dots}`;
  }
}
const addDays = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
// ---------- news pane
function renderNews(c, it, scope) {
  const s = it.sym, pane = c.querySelector('[data-pane="news"]');
  scope = scope === "mine" ? "mine" : pane.dataset.scope === "mine" && !scope ? "mine" : "sym";
  pane.dataset.scope = scope;
  const keys = new Set(APP.syms.map((x) => x.key));
  const stories = (scope === "sym" ? storiesFor(s.key) : (D.news.stories || []).filter((st) => st.syms.some((k) => keys.has(k)))).slice(0, 40);
  const win = view(s.key, chartSettings(s.key))?.win;
  const winDates = new Set((win || []).map((b) => b.t));
  const by = (k) => stories.filter((st) => (k === "single" ? st.status === "single" : k === "official" ? st.status === "official" : st.status === "confirmed" || st.status === "company"));
  // Price events are worked out from our own daily candles, so this pane is never empty. Facts about the past only.
  const evSyms = scope === "sym" ? [s] : APP.syms;
  let events = evSyms.flatMap((x) => priceEvents(x).map((e) => ({ ...e, x })));
  if (scope === "mine" && events.some((e) => e.w)) events = events.filter((e) => e.w); // one summary per coin would crowd the list
  events = events.sort((p, q) => (q.t > p.t ? 1 : q.t < p.t ? -1 : q.w - p.w)).slice(0, scope === "sym" ? 6 : 10);
  const sect = (title, note, list) => (list.length ? `<h3 class="nsec">${title}<span>${note}</span></h3>${list.map((st) => storyHtml(st, winDates.has(st.date) && scope === "sym")).join("")}` : "");
  pane.innerHTML = `<div class="pane-wrap"><h2 class="side">News · ${esc(scope === "sym" ? s.t : "My coins")}</h2>
    <div class="seg" role="group" aria-label="Which news">${[["sym", s.t], ["mine", "All my coins"]].map(([k, l]) => `<button data-scope="${k}" aria-pressed="${k === scope}">${esc(l)}</button>`).join("")}</div>
    ${sect("Confirmed", "2+ independent outlets", by("confirmed"))}
    ${sect("From the project", "official releases and posts", by("official"))}
    ${sect("Also reported", "one trusted outlet so far", by("single"))}
    <h3 class="nsec">Price events<span>from the daily chart, last 30 days</span></h3>
    <div class="pevents">${events.map((e) => `<div class="pev ${e.dir || ""}"><span class="pd">${esc(fmtDay(e.t))}${scope === "mine" ? ` · <b>${esc(e.x.t)}</b>` : ""}</span><p>${esc(e.text)}</p></div>`).join("") || `<div class="empty">${esc(s.t)} prices are still loading.</div>`}</div>
    <p class="disclaimer">Headlines from Reuters, AP, CNBC, CoinDesk, The Block, Decrypt, Blockworks, DL News and other outlets without political or ownership conflicts, found via <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener">the GDELT Project</a> and the outlets' own feeds, then matched across outlets. “From the project” items come from each project's official release page or blog. Opinion, predictions and promotional posts are left out. Price events are calculated from daily prices and describe the past only. ${esc(DISCLAIMER)}</p></div>`;
  pane.querySelectorAll("[data-scope]").forEach((b) => (b.onclick = () => renderNews(c, it, b.dataset.scope)));
}
// Notable things the price did in the last 30 days, from daily candles: unusually big days (2x the 14-day ATR),
// unusually heavy volume (2x the 20-day average), new 52-week highs and lows, and crossings of the 200-day average.
// Always ends with a plain summary of the month, so there's something to read even when it was quiet.
function priceEvents(sym) {
  const bars = D.series[sym.key]?.bars;
  if (!bars || bars.length < 40) return [];
  const n = bars.length, out = [], from = Math.max(21, n - 30);
  const d = (i) => ((bars[i].c - bars[i - 1].c) / bars[i - 1].c) * 100;
  const tr = (i) => Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c)) / bars[i - 1].c * 100;
  const avg = (f, a, b) => { let t = 0; for (let j = a; j < b; j++) t += f(j); return t / (b - a); };
  const sinceBigger = (i, up) => { let k = i - 1; while (k > 0 && (up ? d(k) < d(i) : d(k) > d(i))) k--; return i - k; };
  const ma200 = (i) => (i >= 200 ? avg((j) => bars[j].c, i - 199, i + 1) : null);
  for (let i = from; i < n; i++) {
    const ch = d(i), atr = avg(tr, i - 14, i), t = bars[i].t;
    if (Math.abs(ch) >= 2 * atr) {
      const k = sinceBigger(i, ch > 0), span = k > 365 ? "in over a year" : `in ${k} days`;
      out.push({ t, w: 3, dir: ch > 0 ? "up" : "down", text: `${ch > 0 ? "Rose" : "Fell"} ${Math.abs(ch).toFixed(1)}% in a day, about ${(Math.abs(ch) / atr).toFixed(1)}× its typical daily move. Its biggest one-day ${ch > 0 ? "rise" : "fall"} ${span}.` });
    }
    const va = avg((j) => bars[j].v || 0, i - 20, i);
    if (va > 0 && bars[i].v >= 2 * va) out.push({ t, w: 2, text: `Traded ${(bars[i].v / va).toFixed(1)}× its usual daily volume (20-day average).` });
    if (i >= 365) {
      const prev = bars.slice(i - 365, i);
      if (bars[i].h > Math.max(...prev.map((b) => b.h))) out.push({ t, w: 2, dir: "up", text: `Set a new 52-week high at ${money(bars[i].h, sym.m)}.` });
      if (bars[i].l < Math.min(...prev.map((b) => b.l))) out.push({ t, w: 2, dir: "down", text: `Set a new 52-week low at ${money(bars[i].l, sym.m)}.` });
    }
    const m0 = ma200(i - 1), m1 = ma200(i);
    if (m0 && m1 && (bars[i - 1].c - m0) * (bars[i].c - m1) < 0) out.push({ t, w: 1, dir: bars[i].c > m1 ? "up" : "down", text: `Closed ${bars[i].c > m1 ? "above" : "below"} its 200-day average (${money(m1, sym.m)}) for the first time in a while.` });
  }
  // collapse repeated 52-week highs or lows into the latest one
  const seen = new Set(), ev = out.reverse().filter((e) => { const k = e.text.slice(0, 22); if (/52-week/.test(k)) { if (seen.has(k)) return false; seen.add(k); } return true; });
  const a = n - 31, mv = ((bars[n - 1].c - bars[a].c) / bars[a].c) * 100;
  let big = 0; for (let i = a + 1; i < n; i++) big = Math.max(big, Math.abs(d(i)));
  const hi = Math.max(...bars.slice(a).map((b) => b.h)), lo = Math.min(...bars.slice(a).map((b) => b.l));
  ev.push({ t: bars[n - 1].t, w: 0, dir: mv >= 0 ? "up" : "down", text: `Over 30 days: ${mv >= 0 ? "up" : "down"} ${Math.abs(mv).toFixed(1)}%, trading between ${money(lo, sym.m)} and ${money(hi, sym.m)}. ${ev.length ? "" : "A quiet month: "}${ev.length ? "The largest" : "the largest"} single-day move was ${big.toFixed(1)}%.` });
  return ev;
}
const STATUS = (st) => (st.status === "confirmed" ? `Confirmed by ${st.outlets.join(" + ")}` : st.status === "company" ? "From the company" : st.status === "official" ? `From the project: ${st.official || "official"}` : `Single source: ${st.outlets[0]}`);
function storyHtml(st, pinned) {
  const more = st.links.slice(1).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.source)} ↗</a>`).join(" ");
  return `<article class="story" id="st-${st.key}"><a class="h" href="${esc(st.links[0].url)}" target="_blank" rel="noopener">${esc(st.title)}</a>
    <div class="meta">${pinned ? `<span class="dotpin" title="Pinned on the chart"></span>` : ""}<span>${esc(fmtDay(st.date))}</span><span class="pill ${st.status}">${esc(STATUS(st))}</span>${more}</div>
</article>`;
}
// ---------- details pane
// How to use each part of the details pane, shown behind a small ⓘ. Educational only: what the number
// describes and how people read it, never what to do.
const HOW = {
  glance: "A short summary of the facts further down. It describes what has already happened; it doesn't predict what happens next.",
  today: "Open is the first price of the day (UTC) and Close the latest. The bar shows where the price sits between the day's low and high. Volume compares today's trading with a usual day: a high number means more people traded than normal, often around news.",
  perf: "Price change over each period up to the latest candle. Comparing short and long periods shows whether a move is recent or part of a longer run. Past performance doesn't tell you future returns.",
  trend: "A moving average is the average closing price over the last 20, 50 or 200 days, which smooths out daily noise. Price above an average means it is higher than its recent typical level. Many people watch the 50- and 200-day lines, so they're useful context, not signals.",
  vol: "The typical daily move is the 14-day Average True Range: how far the price usually travels in a day. Bigger numbers mean bigger swings, so the same news can move the price more. Comparing today's move with it shows whether today was unusual.",
  readings: "One reading for each indicator on your chart, with what today's number means in plain words. Add or remove indicators with the ƒx button on any card. Tap a reading for its guide.",
  ranges: "Where today's price sits between the lowest and highest prices of the period. The nearest support and resistance are prices where the chart turned more than once before. They describe the past, not where the price will go.",
  alerts: "Get told when a price or reading crosses a level you choose. Quickest way: hold the chart, slide to a price and tap the alert button.",
};
function renderDetails(c, it) {
  const s = it.sym, v = view(s.key, { ...chartSettings(s.key), interval: "1D", range: "1Y" }), pane = c.querySelector('[data-pane="details"]');
  const lists = watchlists().filter((w) => (w.syms || []).some((x) => x.key === s.key)).map((w) => w.name);
  const rules = (store.data?.rules || []).filter((r) => r.sym === s.key || (r.sym === "*" && s.m === "CRYPTO"));
  const sec = (title, key, body) => `<section class="dsec"><h3>${title}${key ? `<button class="ibtn" data-how="${key}" aria-label="How to use: ${title}" aria-expanded="false">i</button>` : ""}</h3>${key ? `<p class="how" hidden>${esc(HOW[key])}</p>` : ""}${body}</section>`;
  const sign = (x, dg = 1) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(dg) + "%";
  let html = `<div class="pane-wrap det">`;
  if (!v) {
    html += `<div class="dhead"><div><h2>${esc(s.t)}</h2><span>${esc(s.n)}</span></div></div><div class="notice">Prices for ${esc(s.t)} haven't loaded yet.</div>`;
  } else {
    const all = D.series[s.key].bars, b = all.at(-1), d = v.daily.now, chg = d.changePct, last = b.c;
    const rng = (n) => { const w = all.slice(-n); const lo = Math.min(...w.map((x) => x.l)), hi = Math.max(...w.map((x) => x.h)); return { lo, hi, p: hi > lo ? ((last - lo) / (hi - lo)) * 100 : 50 }; };
    const yr = rng(Math.min(365, all.length)), typical = d.atrPct, moveX = typical ? Math.abs(chg) / typical : null;
    const avgs = [["20-day", d.sma20], ["50-day", d.sma50], ["200-day", d.sma200]].filter(([, x]) => x != null);
    html += `<div class="dhead"><div><h2>${esc(s.t)}</h2><span>${esc(s.n)}</span></div><div class="r"><b>${esc(money(last, s.m))}</b><span class="${chg >= 0 ? "up" : "down"}">${arrow(chg)} ${pct(chg)} today</span></div></div>`;
    // 1. at a glance: three or four plain facts
    const names = (ls) => (ls.length > 1 ? ls.slice(0, -1).map((l) => l.replace("-day", "")).join(", ") + " and " + ls.at(-1) : ls[0] || "");
    const above = names(avgs.filter(([, x]) => last > x).map(([l]) => l)), below = names(avgs.filter(([, x]) => last <= x).map(([l]) => l));
    const glance = [
      `${chg >= 0 ? "Up" : "Down"} ${Math.abs(chg).toFixed(1)}% today${moveX != null ? `, ${moveX >= 1.5 ? "a bigger move than usual" : moveX <= 0.5 ? "a quiet day" : "a normal-sized move"}` : ""}${d.volRatio != null ? ` on ${fmt(d.volRatio, 1)}x the usual volume` : ""}.`,
      avgs.length ? `${above ? `Above its ${above}-day average${above.includes(" and ") ? "s" : ""}`.replace("-day-day", "-day") : ""}${above && below ? "; " : ""}${below ? `${above ? "below" : "Below"} its ${below}-day average${below.includes(" and ") ? "s" : ""}`.replace("-day-day", "-day") : ""}.` : "",
      `${yr.p >= 80 ? "Near the top" : yr.p <= 20 ? "Near the bottom" : yr.p >= 60 ? "In the upper part" : yr.p <= 40 ? "In the lower part" : "Around the middle"} of its ${all.length >= 365 ? "52-week" : `${all.length}-day`} range.`,
      d.rsi14 != null ? `RSI ${d.rsi14.toFixed(0)}: ${describe("rsi14", d, v.daily.prev).toLowerCase()}` : "",
    ].filter(Boolean);
    html += sec("At a glance", "glance", `<ul class="glance">${glance.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>`);
    // 2. today
    const dayP = b.h > b.l ? ((b.c - b.l) / (b.h - b.l)) * 100 : 50;
    html += sec(`Today · ${esc(fmtDay(b.t))}`, "today", `<div class="stat-grid">${[["Open", b.o], ["High", b.h], ["Low", b.l], ["Close", b.c]].map(([k, x]) => `<div><span>${k}</span><b>${esc(money(x, s.m))}</b></div>`).join("")}</div>
      <div class="rangerow"><span>Day's range</span><span>closed ${dayP.toFixed(0)}% of the way up</span></div><div class="rangebar"><i style="left:${dayP.toFixed(1)}%"></i></div><div class="rangerow"><span>${esc(money(b.l, s.m))}</span><span>${esc(money(b.h, s.m))}</span></div>
      ${d.volRatio != null ? `<p class="dline">Volume was <b>${fmt(d.volRatio, 1)}x</b> a usual day.</p>` : ""}`);
    if (bigMove(v)) html += `<section class="dsec box" data-movebox>${moveHtml(s, v)}</section>`;
    // 3. performance
    const back = (days) => { const cut = new Date(Date.parse(b.t) - days * 864e5).toISOString().slice(0, 10); const p = [...all].reverse().find((x) => x.t <= cut); return p ? ((last - p.c) / p.c) * 100 : null; };
    const perf = [["1W", 7], ["1M", 30], ["3M", 91], ["6M", 182], ["1Y", 365]].map(([l, n]) => [l, back(n)]).filter(([, x]) => x != null);
    html += sec("Performance", "perf", `<div class="perf">${perf.map(([l, x]) => `<div><span>${l}</span><b class="${x >= 0 ? "up" : "down"}">${pct(x, 1)}</b></div>`).join("")}</div>`);
    // 4. trend: price against its moving averages
    if (avgs.length) html += sec("Trend", "trend", `<div class="mas">${avgs.map(([l, x]) => { const dist = ((last - x) / x) * 100; return `<div class="marow"><span>${l} average</span><b>${esc(money(x, s.m))}</b><em class="${dist >= 0 ? "up" : "down"}">${sign(dist)} ${dist >= 0 ? "above" : "below"}</em></div>`; }).join("")}</div>`);
    // 5. volatility
    if (typical != null) html += sec("Volatility", "vol", `<div class="vol"><div><span>Typical daily move</span><b>±${typical.toFixed(1)}%</b></div><div><span>Today's move</span><b>${moveX != null ? `${moveX.toFixed(1)}x typical` : "–"}</b></div></div>`);
    // 6. readings in plain words
    // readings for the indicators on your chart, in plain words
    const pkr = picks(store.data?.settings?.chart), seenM = new Set();
    const rows = [...pkr.over.map((k) => OVERLAYS[k]), ...pkr.lower.map((k) => PANELS[k])].filter((x) => x?.metric && !seenM.has(x.metric) && seenM.add(x.metric)).map((x) => ({ i: { id: Object.keys(OVERLAYS).find((k) => OVERLAYS[k] === x) || Object.keys(PANELS).find((k) => PANELS[k] === x) }, m: x.metric }));
    html += sec("Readings", "readings", rows.length ? `<div class="readings">${rows.map(({ i, m }) => { const meta = METRICS[m] || { label: m, digits: 2 }; return `<button class="reading" data-ind="${esc(i.id)}"><span class="k">${esc(meta.label)}</span><span class="v">${fmt(d[m], meta.digits)}${meta.unit && d[m] != null ? esc(meta.unit) : ""}</span><span class="d">${esc(describe(m, d, v.daily.prev))}</span></button>`; }).join("")}</div>` : `<p class="hint">No indicators on your chart. Tap ƒx on any card to add some.</p>`);
    // 7. ranges and the nearest past turning points
    const lv = swingLevels({ bars: all, win: all.slice(-Math.min(182, all.length)), interval: "1D" }, { perSide: 1 });
    const r1 = lv.find((l) => l.kind === "R"), s1 = lv.find((l) => l.kind === "S");
    html += sec("Where the price sits", "ranges", [[30, "30-day range"], [Math.min(365, all.length), all.length >= 365 ? "52-week range" : `${all.length}-day range`]].map(([n, l]) => { const r = rng(n); return `<div class="rng"><div class="rangerow"><b>${l}</b><span>${r.p.toFixed(0)}% of the way up</span></div><div class="rangebar"><i style="left:${r.p.toFixed(1)}%"></i></div><div class="rangerow"><span>${esc(money(r.lo, s.m))}</span><span>${esc(money(r.hi, s.m))}</span></div></div>`; }).join("") +
      (r1 || s1 ? `<div class="srrow">${s1 ? `<div><span>Nearest support</span><b class="up">${esc(money(s1.price, s.m))}</b><em>${sign(((s1.price - last) / last) * 100)} · turned ${s1.touches}×</em></div>` : ""}${r1 ? `<div><span>Nearest resistance</span><b class="down">${esc(money(r1.price, s.m))}</b><em>${sign(((r1.price - last) / last) * 100)} · turned ${r1.touches}×</em></div>` : ""}</div>` : ""));
    // 8. alerts
    html += sec("Your alerts", "alerts", `${rules.length ? `<div class="list">${rules.map((r) => { const met = ruleMet(r, d, v.daily.prev); return `<div class="row"><div class="main"><span class="t">${esc(METRICS[r.metric]?.label || r.metric)} ${esc(OPS[r.op])} ${esc(r.metric === "price" ? money(+r.value, s.m) : r.value)}</span><span class="s">${met ? "Met on the latest candle" : "Not met yet"}${r.note ? " · " + esc(r.note) : ""}</span></div>${met ? `<span class="tag rule" style="opacity:1;transform:none">Met</span>` : ""}</div>`; }).join("")}</div>` : `<p class="hint">No alerts for ${esc(s.t)} yet.</p>`}
      <button class="btn sm" data-addrule>Add an alert</button>`);
  }
  html += sec("Watchlists", "", `<p class="dline">${lists.length ? lists.map((n) => `<span class="pill">${esc(n)}</span>`).join(" ") : "Not in a watchlist"} <button class="btn ghost sm" data-save>Change</button></p>`);
  html += sec("About", "", `<p class="dline">${esc(s.n)} · ${esc(TYLABEL[s.ty] || "")}</p><p class="hint">Prices: ${esc(v?.source || "Kraken")} daily candles${v?.live ? ", refreshed when you opened the app" : ""}. Facts and explanations only, never advice.</p><p class="disclaimer">${esc(DISCLAIMER)}</p>`);
  pane.innerHTML = html + `</div>`;
  pane.querySelectorAll("[data-how]").forEach((bt) => (bt.onclick = () => { const p = bt.closest("section").querySelector(".how"); p.hidden = !p.hidden; bt.setAttribute("aria-expanded", String(!p.hidden)); }));
  pane.querySelectorAll("[data-ind]").forEach((bt) => (bt.onclick = () => openLearn(bt.dataset.ind, c._v)));
  pane.querySelector("[data-addrule]")?.addEventListener("click", () => { location.hash = ""; showTab("profile", "rules", s.key); });
  pane.querySelectorAll("[data-save]").forEach((bt) => (bt.onclick = () => openListsFor(s)));
  const mb = pane.querySelector("[data-movebox]");
  mb?.querySelectorAll("[data-gonews]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); c._go(PANE.news); }));
}
// An unusually big day: the facts, and the headlines from around that day (no AI, no guessing at causes).
function moveHtml(s, v) {
  const d = v.daily.now, day = D.series[s.key].bars.at(-1).t;
  const news = storiesFor(s.key).filter((st) => st.date >= addDays(day, -1)).slice(0, 3);
  return `<div class="label">A big day</div><p style="font-weight:700">${esc(s.t)} ${d.changePct >= 0 ? "rose" : "fell"} ${Math.abs(d.changePct).toFixed(1)}%, about ${(Math.abs(d.changePct) / d.atrPct).toFixed(1)}x a typical day's move.</p>
    ${news.length ? `<p class="hint">In the news around then:</p><ul class="mnews">${news.map((st) => `<li><a href="${esc(st.links[0].url)}" target="_blank" rel="noopener">${esc(st.title)}</a> <span class="hint">${esc(st.outlets[0] || "")}</span></li>`).join("")}</ul><a href="#" data-gonews class="hint">All ${esc(s.t)} news →</a>`
      : `<p class="hint">No news found for that day. Big moves can also come from the wider market.</p>`}`;
}

// ---------- special cards
function catchupHtml() {
  const first = !ls.get("pl.lastOpen");
  const since = ls.get("pl.prevOpen");
  const facts = [];
  if (first) {
    return `<div class="special"><div class="label">Welcome to ${esc(CONFIG.appName)}</div><h1>Your coins,<br>one chart at a time.</h1>
      <p>Swipe through your watchlist like a feed. Every chart is drawn the same way, so moves are easy to compare.</p>
      <p class="hint">Information only, never advice.</p></div>`;
  }
  // Daily recap: every coin's change since the day started (12:00 AM your time), a fixed point that doesn't depend on
  // when you last opened the app. Worked out from 15-minute candles; until they arrive, nothing misleading is shown.
  const ref = since9Ref(), m9 = APP.s9?.ref === ref.key ? APP.s9.chg : null;
  const vs = APP.syms.map((s) => ({ s, c: m9?.[s.key] })).filter((x) => x.c != null);
  const chg = (x) => x.c;
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
  if (!m9 && APP.syms.length) loadSince9(ref);
  return `<div class="special" data-recap><div class="label">Daily recap · ${esc(today)}</div>
    <h1>${vs.length ? `${ups} of ${vs.length} up today.` : APP.s9?.failed ? "Couldn't load the latest prices." : "Checking today's prices…"}</h1>
    <p class="hint" style="margin:-4px 0 10px">Change from ${esc(ref.label)} to now.</p>${tiles}${facts.join("")}
    <p class="hint">${APP.syms.length} in ${esc(listName())} · swipe up to start</p></div>`;
}
// The start of today (12:00 AM) in the person's own time zone.
function since9Ref() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return { ms: d.getTime(), key: d.toISOString().slice(0, 16), label: "midnight (12:00 AM) your time" };
}
let s9busy = null;
function loadSince9(ref) {
  if (s9busy === ref.key) return;
  s9busy = ref.key;
  Promise.all(APP.syms.map(async (s) => {
    try {
      const bars = await krakenBars(s.t, 15), i = bars.findIndex((b) => Date.parse(b.t + ":00Z") >= ref.ms);
      if (i < 0) return [s.key, 0]; // the first candle of the day hasn't closed yet
      return [s.key, ((bars[bars.length - 1].c - bars[i].o) / bars[i].o) * 100];
    } catch { return [s.key, null]; }
  })).then((rows) => {
    const chg = Object.fromEntries(rows.filter(([, x]) => x != null));
    APP.s9 = { ref: ref.key, chg, failed: !Object.keys(chg).length };
    s9busy = APP.s9.failed ? null : s9busy;
    const c = document.querySelector(".card [data-recap]")?.closest(".card");
    if (c) c.innerHTML = catchupHtml();
  });
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
    coachEvent("pane", { view: c.dataset.view });
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
  c.querySelectorAll("[data-learn]").forEach((p) => p.addEventListener("click", (e) => { e.stopPropagation(); if (!justScrubbed()) openLearn(p.dataset.learn, c._v); }));
  // ƒx chip: add or remove indicators. S/R chip: pick the lines on the chart. Both apply to every coin, so every
  // card on screen redraws at once.
  c.querySelector("[data-fx]")?.addEventListener("click", (e) => { e.stopPropagation(); openIndicatorsSheet(() => redrawCards()); });
  c.querySelector("[data-lv]")?.addEventListener("click", (e) => { e.stopPropagation(); openLinesSheet(() => redrawCards()); });
  c.querySelector(".chartbox:not(.nodata)")?.addEventListener("click", () => { if (!justScrubbed()) chartTapHint(); });
  c.querySelector("[data-full]")?.addEventListener("click", (e) => { e.stopPropagation(); if (!justScrubbed()) { coachEvent("full"); openFull(it.sym); } });
  c.querySelector("[data-tf]")?.addEventListener("click", (e) => { e.stopPropagation(); coachEvent("tf"); openChartSheet(it.sym, () => redrawCards()); });
  c.querySelector("[data-pred]")?.addEventListener("click", (e) => { e.stopPropagation(); openPredictSheet(it.sym, () => redrawCards(it.sym.key)); });
}
// Prediction game: the Predict chip on a card, with how many predictions are open on that coin.
function predChip(s) {
  const n = store.preds.filter((p) => p.coin === s.key).length;
  return `<button class="lvbtn pdbtn" data-pred aria-label="Predict ${esc(s.t)}'s price${n ? `, ${n} open` : ""}"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5"/></svg>Predict${n ? `<b>${n}</b>` : ""}</button>`;
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
document.addEventListener("pulse-intra", (e) => redrawCards(e.detail));
// turning the phone changes how many panels fit, so cards redraw once the rotation settles
let rzT = 0, lastFit = maxPanels();
addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(() => { if (maxPanels() !== lastFit) { lastFit = maxPanels(); redrawCards(); } }, 250); });

// ---------- tabs and refresh
export function showTab(tab, sub, arg) {
  APP.tab = tab;
  $("sFeed").hidden = tab !== "feed"; $("sDash").hidden = tab !== "dash"; $("sProfile").hidden = tab !== "profile";
  document.querySelectorAll(".tabbar button").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false"));
  if (tab === "dash") { renderDash(); setTimeout(() => APP.tab === "dash" && startTour("dash"), 350); }
  if (tab === "profile") { renderProfile(sub, arg); if (!sub) setTimeout(() => APP.tab === "profile" && startTour("profile"), 350); }
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
  // redraw nearby cards in place, keeping the user's position (only once nothing is moving)
  const refill = () => whenIdle("refill", () => feed.querySelectorAll(".card").forEach((c) => {
    if (!c.dataset.filled || Math.abs(+c.dataset.i - APP.active) > 2 || (c.dataset.view && c.dataset.view !== "main")) return;
    delete c.dataset.filled; delete c.dataset.view; c.innerHTML = ""; fillCard(c, APP.seq[+c.dataset.i]); c.classList.toggle("active", +c.dataset.i === APP.active);
  }));
  await refresh(allSyms(), () => { if (APP.built && !manual) refill(); });
  lastRefresh = Date.now();
  setStatus();
  if (store.mode === "demo") { demoRules(); settleDemoPredictions(krakenRows).catch(() => {}); } // the data job does both for live accounts
  const keep = APP.seq[APP.active]?.sym?.key;
  if (manual || !APP.built) buildFeed({ keepKey: keep }); else refill();
  if (manual) toast("Up to date.");
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") ls.set("pl.lastOpen", new Date().toISOString());
  else if (Date.now() - lastRefresh > 60000) doRefresh(false);
});

// iOS Home Screen apps sometimes lay the page out shorter than the screen (by about the status bar's height),
// leaving an empty strip under the tab bar. Measure it and stretch the layout to the real bottom edge.
function fitScreen() {
  const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  const portrait = innerHeight > innerWidth, sh = portrait ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width);
  const gap = standalone && /iPhone|iPad|iPod/.test(navigator.userAgent) ? Math.max(0, Math.min(80, sh - innerHeight)) : 0;
  document.documentElement.style.setProperty("--gapb", gap + "px");
}
fitScreen();
addEventListener("resize", fitScreen);
addEventListener("orientationchange", () => setTimeout(fitScreen, 300));

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
  // nothing waits on the network before the first chart is drawn
  APP.catalogue = [];
  fetch("data/indicators.json").then((r) => r.json()).then((c) => (APP.catalogue = c)).catch(() => {});
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
  // v5: windows in bars (20/50/100/200) become time ranges (1M/3M/3M/6M); candle size picks itself unless set.
  if (ch && "window" in ch) { const { window: w, ...rest } = store.data.settings.chart; save({ settings: { ...store.data.settings, chart: { ...rest, range: { 20: "1M", 50: "3M", 100: "3M", 200: "6M" }[w] || "3M", interval: rest.interval === "1W" ? "1W" : "auto" } } }).catch(() => {}); }
  // v4: RSI and MACD panels under every chart by default.
  if (ch && ch.v2 && !ch.v4) save({ settings: { ...store.data.settings, chart: { ...ch, lower: "RSI,MACD", v4: 1 } } }).catch(() => {});
  if (ch && !ch.v2) save({ settings: { ...store.data.settings, chart: { ...ch, type: "candles", mas: [], lower: "RSI,MACD", v2: 1, v4: 1 } } }).catch(() => {});
  applyTheme();
  initPages();
  store.on((what) => {
    $("alertDot").hidden = !store.alerts.some((a) => !a.read);
    if (what === "account") { applyTheme(); APP.needsRebuild = true; if (APP.tab === "dash") renderDash(); }
    if (what === "preds") APP.needsRebuild = true; // the Predict chips show open counts
    // the profile's score card and predictions page follow new and scored predictions
    if ((what === "preds" || what === "account") && APP.tab === "profile" && (!APP.profileSub || APP.profileSub === "predictions")) {
      const pg = $("profile").parentElement, y = pg.scrollTop; renderProfile(APP.profileSub); pg.scrollTop = y;
    }
  });
  $("alertDot").hidden = !store.alerts.some((a) => !a.read);
  buildFeed();
  await doRefresh(false);
  setTimeout(() => APP.tab === "feed" && startTour("feed"), 700);
  setTimeout(() => ls.set("pl.lastOpen", new Date().toISOString()), 4000);
  loadSymbols().catch(() => {});
})();
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js" + (CONFIG.firebase ? "?config=" + encodeURIComponent(JSON.stringify(CONFIG.firebase)) : "")).catch(() => {});
  // When a new release takes over right after opening, reload once so the new version shows straight away.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && performance.now() < 8000 && !sessionStorage.getItem("pl.swReload")) { sessionStorage.setItem("pl.swReload", "1"); location.reload(); } });
}
