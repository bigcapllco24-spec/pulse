// Full-screen chart for one coin, interactive like a trading chart: drag to move through time, pinch (or
// mouse wheel / trackpad) to zoom, double-tap to reset, hold to read any candle and set an alert.
// Ranges from 1 day (15-minute candles) to the coin's full weekly history, all from Kraken's free public data.
import { D } from "./data.js";
import { buildSeries, compute, toWeekly } from "./indicators.js";
import { mainChart, lowerChart } from "./chart.js";
import { levelsFor } from "./levels.js";
import { chartSettings } from "./store.js";
import { initInteract, openLearn, cancelPendingHold } from "./interact.js";
import { APP } from "./app.js";
import { esc, money, pct, arrow, haptic, fmtDay } from "./ui.js";

const KRAKEN = { BTC: "XBTUSD", DOGE: "XDGUSD", RNDR: "RENDERUSD" };
// range → candle size (Kraken minutes, or "d" for the app's daily candles) and how much time to show first
const RANGES = { "1D": [15, 1], "1W": [60, 7], "1M": ["d", 30], "3M": ["d", 91], "6M": ["d", 182], "1Y": [10080, 365], "2Y": [10080, 730], "5Y": [10080, 1826], Max: [10080, 1e6] };
const OPTS = Object.keys(RANGES);
const NEXT = { "1M": "6M", "3M": "1Y", "6M": "2Y", "1Y": "2Y", "2Y": "5Y" };
const IVLABEL = { 15: "15-minute", 60: "1-hour", d: "Daily", 10080: "Weekly" };
const MIN_BARS = 12;
const cache = new Map(); // `${t}:${interval}` → { at, bars }

async function krakenBars(t, iv) {
  const k = `${t}:${iv}`, hit = cache.get(k);
  if (hit && Date.now() - hit.at < (iv < 1440 ? 120e3 : 3600e3)) return hit.bars;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${KRAKEN[t] || t + "USD"}&interval=${iv}`, { signal: ctl.signal });
    const j = await r.json(); if (j.error?.length) throw new Error(j.error[0]);
    const rows = Object.entries(j.result).find(([x]) => x !== "last")?.[1] || [];
    const bars = rows.map((x) => ({ t: new Date(x[0] * 1000).toISOString().slice(0, iv < 1440 ? 16 : 10), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[6] }));
    if (bars.length < 5) throw new Error("no data");
    cache.set(k, { at: Date.now(), bars }); return bars;
  } finally { clearTimeout(timer); }
}

let el = null, st = null, raf = 0;
export function openFull(sym) {
  if (!el) {
    el = document.createElement("div"); el.id = "full"; el.className = "full"; el.hidden = true;
    document.body.appendChild(el);
    initInteract(el); // hold-to-read and alerts
    wireGestures(el);
    addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.hidden) closeFull(); });
  }
  const cs = chartSettings(sym.key);
  st = { sym, range: NEXT[cs.range] || "2Y", levels: cs.levels && cs.levels !== "off" ? cs.levels : "off", lower: cs.lower, type: cs.type };
  el.hidden = false; document.body.classList.add("fullopen");
  load(); haptic();
}
export function closeFull() { if (!el) return; el.hidden = true; el.innerHTML = ""; document.body.classList.remove("fullopen"); st = null; }

// ---------- data for the chosen range
async function load() {
  const s = st, [iv, days] = RANGES[s.range], daily = D.series[s.sym.key]?.bars || [];
  el.innerHTML = shell(`<p class="fload">Loading…</p>`); wireBar();
  let bars = null, note = "";
  if (iv === "d") bars = daily;
  else {
    try { bars = await krakenBars(s.sym.t, iv); }
    catch { if (iv === 10080 && daily.length) { bars = toWeekly(daily); note = "Showing the last 2 years; longer history couldn't load just now."; } }
  }
  if (st !== s) return; // closed or switched while loading
  if (!bars?.length) { el.innerHTML = shell(`<p class="fload">${iv === "d" ? `Prices for ${esc(s.sym.t)} haven't loaded yet.` : "Couldn't load these candles just now. Try another range."}</p>`); wireBar(); return; }
  const last = Date.parse(bars[bars.length - 1].t.length > 10 ? bars[bars.length - 1].t + ":00Z" : bars[bars.length - 1].t);
  const first = bars.findIndex((b) => Date.parse(b.t.length > 10 ? b.t + ":00Z" : b.t) > last - days * 864e5);
  Object.assign(s, { iv, bars, series: buildSeries(bars), note, end: bars.length, count: Math.max(MIN_BARS, bars.length - Math.max(0, first)) });
  s.home = { end: s.end, count: s.count };
  s.daily = compute(daily.length ? daily : bars)?.now;
  el.innerHTML = shell(`<div class="chartbox"></div><div class="flowers"></div><p class="fnote"></p>`); wireBar();
  draw();
}

// ---------- drawing the visible window (called on every pan/zoom frame)
function viewOf(s) {
  const end = Math.round(s.end), from = Math.max(0, end - Math.round(s.count)), ov = {};
  for (const k of Object.keys(s.series)) ov[k] = s.series[k].slice(from, end);
  const bars = s.bars.slice(0, end); // levels and the readout look back from the right edge of what's on screen
  return { key: s.sym.key, interval: s.iv === 10080 ? "1W" : s.iv === "d" ? "1D" : "intraday", bars, win: s.bars.slice(from, end), ov, from, lastBar: s.bars[s.bars.length - 1], daily: { now: s.daily } };
}
function draw() {
  raf = 0;
  const s = st; if (!s?.bars) return;
  const v = viewOf(s), box = el.querySelector(".chartbox"); if (!box) return;
  const spanDays = (Date.parse(v.win[v.win.length - 1].t.slice(0, 10)) - Date.parse(v.win[0].t.slice(0, 10))) / 864e5 + 1;
  box.innerHTML = mainChart(v.win, v.ov, { type: s.type, interval: v.interval, days: spanDays, levels: levelsFor(v, s.levels) });
  const lowers = String(s.lower || "none").split(",").filter((k) => k !== "none");
  el.querySelector(".flowers").innerHTML = lowers.map((k) => lowerChart(v.win, v.ov, k)).join("");
  const chg = ((v.win[v.win.length - 1].c - v.win[0].c) / v.win[0].c) * 100;
  const when = (t) => (t.length > 10 ? fmtDay(t) : new Date(t + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }));
  el.querySelector(".fnote").innerHTML = `${IVLABEL[s.iv]} candles · ${esc(when(v.win[0].t))} – ${esc(when(v.win[v.win.length - 1].t))} · <span class="${chg >= 0 ? "up" : "down"}">${pct(chg, 1)}</span>${s.note ? " · " + esc(s.note) : ""}<br><span class="hint">Drag to move · pinch or scroll to zoom · double-tap to reset · hold to read</span>`;
  const card = el.querySelector(".card"); card._v = v; card._sym = s.sym;
  el.querySelectorAll(".flowers [data-learn]").forEach((p) => (p.onclick = (e) => { e.stopPropagation(); openLearn(p.dataset.learn, v); }));
}
const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
function clampView(s) {
  s.count = Math.max(MIN_BARS, Math.min(s.bars.length, s.count));
  s.end = Math.max(s.count, Math.min(s.bars.length, s.end));
}

// ---------- gestures: one finger pans, two fingers zoom, wheel/trackpad zooms or pans, double-tap resets
function wireGestures(root) {
  const pts = new Map(); let g = null, lastTap = 0;
  const plotW = () => root.querySelector(".chartbox .plot")?.getBoundingClientRect().width * (314 / 360) || 300; // drawing area without the price gutter
  root.addEventListener("pointerdown", (e) => {
    if (!st?.bars || !e.target.closest(".fcard") || e.target.closest("button")) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { cancelPendingHold(); const [a, b] = [...pts.values()]; g = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, count0: st.count, end0: st.end, cx: (a.x + b.x) / 2 }; }
    else g = { kind: "maybe", x0: e.clientX, y0: e.clientY, end0: st.end };
  });
  root.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId) || !st?.bars || APP.scrub) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g?.kind === "pinch" && pts.size >= 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const r = root.querySelector(".chartbox .plot").getBoundingClientRect(), f = Math.min(1, Math.max(0, (g.cx - r.left) / plotW()));
      const count = g.count0 * (g.d0 / d), anchor = g.end0 - g.count0 * (1 - f); // keep the candle under the fingers in place
      st.count = count; st.end = anchor + count * (1 - f); clampView(st); redraw();
    } else if (g && pts.size === 1) {
      const dx = e.clientX - g.x0;
      if (g.kind === "maybe" && Math.abs(dx) > 8) { g.kind = "pan"; cancelPendingHold(); }
      if (g.kind === "pan") { st.end = g.end0 - dx / (plotW() / st.count); clampView(st); redraw(); }
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (g?.kind === "maybe" && pts.size === 0 && !APP.scrub) { // a tap: two quick taps reset the view
      if (Date.now() - lastTap < 320 && st?.home) { Object.assign(st, st.home); redraw(); lastTap = 0; } else lastTap = Date.now();
    }
    if (pts.size === 0) g = null; else if (pts.size === 1) { const [p] = [...pts.values()]; g = { kind: "pan", x0: p.x, end0: st.end }; }
  };
  root.addEventListener("pointerup", up); root.addEventListener("pointercancel", up);
  root.addEventListener("wheel", (e) => {
    if (!st?.bars || !e.target.closest(".fcard")) return;
    e.preventDefault();
    const r = root.querySelector(".chartbox .plot")?.getBoundingClientRect(); if (!r) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) { st.end += (e.deltaX / plotW()) * st.count; }
    else {
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / plotW())), anchor = st.end - st.count * (1 - f);
      st.count *= Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.002)); st.end = anchor + st.count * (1 - f);
    }
    clampView(st); redraw();
  }, { passive: false });
}

// ---------- header and range buttons
function shell(body) {
  const { sym, range, levels, daily } = st, bars = st.bars, chg = daily?.changePct;
  const last = bars?.[bars.length - 1]?.c ?? D.series[sym.key]?.bars?.at(-1)?.c;
  return `<div class="fbar"><button class="fclose" data-fclose aria-label="Close full-screen chart">✕</button>
      <div class="fhead"><span class="tk">${esc(sym.t)}</span>${chg != null ? `<span class="chg ${chg >= 0 ? "up" : "down"}">${arrow(chg)} ${pct(chg)}</span>` : `<span class="chg"></span>`}
        <span class="price">${last != null ? esc(money(last, sym.m)) : ""}</span></div></div>
    <div class="franges" role="group" aria-label="Time range">${OPTS.map((r) => `<button class="opt" data-fr="${r}" aria-pressed="${r === range}">${r}</button>`).join("")}
      <button class="lvbtn" data-flv aria-pressed="${levels !== "off"}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 5h14M1 11h14"/></svg>${levels === "pivots" ? "Pivots" : "S/R"}</button></div>
    <div class="card fcard"><div class="pane main" data-pane="main">${body}</div></div>`;
}
function wireBar() {
  el.querySelector("[data-fclose]").onclick = closeFull;
  el.querySelectorAll("[data-fr]").forEach((b) => (b.onclick = () => { st.range = b.dataset.fr; load(); }));
  el.querySelector("[data-flv]").onclick = (e) => {
    const pick = chartSettings(st.sym.key).levels; st.levels = st.levels === "off" ? (pick && pick !== "off" ? pick : "sr") : "off";
    e.currentTarget.setAttribute("aria-pressed", st.levels !== "off"); e.currentTarget.lastChild.textContent = st.levels === "pivots" ? "Pivots" : "S/R";
    if (st.bars) redraw();
  };
}
