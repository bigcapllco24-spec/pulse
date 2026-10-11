// Full-screen chart for one coin, interactive like a trading chart: drag to move through time, pinch (or
// mouse wheel / trackpad) to zoom, double-tap to reset, hold to read any candle and set an alert.
// Ranges from 1 day (15-minute candles) to the coin's full weekly history, from Kraken's free public data.
// Daily charts reach back about 4 years: older daily candles come from Binance's free public market-data
// mirror and are joined on before the app's own Kraken history, so you can keep dragging back in time.
import { D } from "./data.js";
import { buildSeries, compute, toWeekly, extendedSeries } from "./indicators.js";
import { OVERLAYS, PANELS, MAX_OVERLAYS, maxPanels, picks, keysOf } from "./studies.js";
import { mainChart, lowerChart } from "./chart.js";
import { levelsFor } from "./levels.js";
import { chartSettings, store, save } from "./store.js";
import { initInteract, openLearn, cancelPendingHold } from "./interact.js";
import { APP, buildFeed } from "./app.js";
import { esc, money, pct, arrow, haptic, fmtDay, toast } from "./ui.js";

const KRAKEN = { BTC: "XBTUSD", DOGE: "XDGUSD", RNDR: "RENDERUSD" };
// range → candle size (Kraken minutes, or "d" for the app's daily candles) and how much time to show first
const RANGES = { "1D": [15, 1], "1W": [60, 7], "1M": ["d", 30], "3M": ["d", 91], "6M": ["d", 182], "1Y": ["d", 365], "2Y": ["d", 730], "4Y": ["d", 1461], Max: [10080, 1e6] };
const OPTS = Object.keys(RANGES);
const NEXT = { "1M": "3M", "3M": "6M", "6M": "1Y", "1Y": "2Y", "2Y": "4Y" };
const IVLABEL = { 15: "15-minute", 60: "1-hour", d: "Daily", 10080: "Weekly" };
const MIN_BARS = 12;
const HIST_DAYS = 1461; // about 4 years of daily candles
const BINANCE = { HYPE: null }; // coins Binance doesn't list are left with the app's own 2 years
const cache = new Map(); // `${t}:${interval}` → { at, bars }

export async function krakenBars(t, iv) {
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

// Older daily candles (USDT pairs, which track USD closely), oldest first. Two pages of 1000 days.
async function olderDaily(t) {
  const k = `${t}:hist`, hit = cache.get(k);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.bars;
  if (BINANCE[t] === null) return [];
  const sym = (BINANCE[t] || t) + "USDT", start = Date.now() - HIST_DAYS * 864e5, out = [];
  for (let from = start, page = 0; page < 2; page++) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=1d&limit=1000&startTime=${from}`, { signal: ctl.signal });
      if (!r.ok) break;
      const rows = await r.json(); if (!Array.isArray(rows) || !rows.length) break;
      for (const x of rows) out.push({ t: new Date(x[0]).toISOString().slice(0, 10), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] });
      if (rows.length < 1000) break;
      from = rows[rows.length - 1][0] + 864e5;
    } finally { clearTimeout(timer); }
  }
  cache.set(k, { at: Date.now(), bars: out }); return out;
}

let el = null, st = null, raf = 0, fling = 0;
export function openFull(sym) {
  if (!el) {
    el = document.createElement("div"); el.id = "full"; el.className = "full"; el.hidden = true;
    document.body.appendChild(el);
    initInteract(el, { holdMs: 480 }); // hold still to read (longer than the feed, so a slow drag still pans)
    wireGestures(el);
    addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.hidden) closeFull(); });
  }
  const cs = chartSettings(sym.key);
  st = { sym, range: NEXT[cs.range] || "2Y", levels: cs.levels && cs.levels !== "off" ? cs.levels : "off", type: cs.type, ...picks(store.data?.settings?.chart) };
  el.hidden = false; document.body.classList.add("fullopen");
  load(); haptic();
}
export function closeFull() {
  if (!el) return; stopFling();
  if (st?.changed) { const k = st.sym.key; setTimeout(() => buildFeed({ keepKey: k }), 0); } /* the feed picks up new indicators */ el.hidden = true; el.innerHTML = ""; document.body.classList.remove("fullopen"); st = null; }

// ---------- data for the chosen range
async function load() {
  const s = st, [iv, days] = RANGES[s.range], daily = D.series[s.sym.key]?.bars || [];
  el.innerHTML = shell(`<p class="fload">Loading…</p>`); wireBar();
  let bars = null, note = "";
  if (iv === "d") bars = s.hist || daily;
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
  if (iv === "d" && !s.hist && daily.length) joinHistory(s, daily);
}
// Join older daily candles on before the app's own, keeping what's on screen exactly where it is.
async function joinHistory(s, daily) {
  let old = [];
  try { old = await olderDaily(s.sym.t); } catch {}
  const first = daily[0].t, add = old.filter((b) => b.t < first);
  s.hist = add.length ? [...add, ...daily] : daily;
  if (st !== s || !add.length || RANGES[s.range][0] !== "d") return;
  const keep = { end: s.end + add.length, count: s.count };
  s.bars = s.hist; s.series = buildSeries(s.bars); s.end = keep.end; s.count = keep.count;
  s.home = { end: s.home.end + add.length, count: s.home.count };
  if (RANGES[s.range][1] > daily.length) { s.count = Math.min(s.bars.length, RANGES[s.range][1]); s.home.count = s.count; } // a 4Y view can now show 4 years
  s.note = ""; redraw();
}

// ---------- drawing the visible window (called on every pan/zoom frame)
const VIEW_KEYS = ["rsi14", "macd", "macdSignal", "macdHist", "volRatio"];
function viewOf(s) {
  // the window can start part-way through a candle, so dragging moves smoothly instead of a candle at a time
  const endF = s.end, startF = endF - s.count, from = Math.max(0, Math.floor(startF)), end = Math.min(s.bars.length, Math.ceil(endF)), ov = {};
  const codes = [...s.over, ...s.lower], keys = new Set(VIEW_KEYS);
  for (const c of codes) for (const k of keysOf(OVERLAYS[c] || PANELS[c] || {})) keys.add(k);
  let ext = null;
  for (const k of keys) { const src = s.series[k] || (ext ||= extendedSeries(s.bars))[k]; if (src) ov[k] = src.slice(from, end); }
  const bars = s.bars.slice(0, Math.max(1, Math.round(endF))); // levels and the readout look back from the right edge of what's on screen
  return { key: s.sym.key, interval: s.iv === 10080 ? "1W" : s.iv === "d" ? "1D" : "intraday", bars, win: s.bars.slice(from, end), ov, from, count: s.count, shift: startF - from, lastBar: s.bars[s.bars.length - 1], daily: { now: s.daily } };
}
function draw() {
  raf = 0;
  const s = st; if (!s?.bars) return;
  const v = viewOf(s), box = el.querySelector(".chartbox"); if (!box) return;
  const spanDays = (Date.parse(v.win[v.win.length - 1].t.slice(0, 10)) - Date.parse(v.win[0].t.slice(0, 10))) / 864e5 + 1;
  // support/resistance is worked out again only when the view settles, not on every frame of a drag
  const lk = `${s.levels}|${Math.round(s.end)}|${Math.round(s.count)}`;
  if (s.lvKey !== lk && !s.moving) { s.lvKey = lk; s.lv = levelsFor(v, s.levels); }
  const geo = { count: v.count, shift: v.shift, days: spanDays, full: true };
  box.innerHTML = mainChart(v.win, v.ov, { type: s.type, interval: v.interval, levels: s.levels === "off" ? [] : s.lv || [], over: s.over, ...geo });
  el.querySelector(".flowers").innerHTML = s.lower.map((k) => lowerChart(v.win, v.ov, k, geo)).join("");
  const chg = ((v.win[v.win.length - 1].c - v.win[0].c) / v.win[0].c) * 100, older = Math.floor(s.end - s.count);
  const when = (t) => (t.length > 10 ? fmtDay(t) : new Date(t + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }));
  el.querySelector(".fnote").innerHTML = `${IVLABEL[s.iv]} candles · ${esc(when(v.win[0].t))} – ${esc(when(v.win[v.win.length - 1].t))} · <span class="${chg >= 0 ? "up" : "down"}">${pct(chg, 1)}</span>${s.note ? " · " + esc(s.note) : ""}<br><span class="hint">${older > 0 ? "Drag right for older prices" : "Start of the history"} · pinch or scroll to zoom · double-tap to reset · hold still to read</span>`;
  const card = el.querySelector(".card"); card._v = { ...v, picks: { over: s.over, lower: s.lower } }; card._sym = s.sym;
  el.querySelectorAll(".flowers [data-learn]").forEach((p) => (p.onclick = (e) => { e.stopPropagation(); openLearn(p.dataset.learn, v); }));
  el.querySelectorAll("[data-learn-ov]").forEach((p) => (p.onclick = (e) => { e.stopPropagation(); openLearn(p.dataset.learnOv, v); }));
  el.querySelectorAll("[data-rmstudy]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); toggleStudy(b.dataset.rmstudy); }));
}
const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
function clampView(s) {
  s.count = Math.max(MIN_BARS, Math.min(s.bars.length, s.count));
  s.end = Math.max(s.count, Math.min(s.bars.length, s.end));
}
const stopFling = () => { if (fling) cancelAnimationFrame(fling); fling = 0; };

// ---------- gestures: one finger pans, two fingers zoom, wheel/trackpad zooms or pans, double-tap resets
function wireGestures(root) {
  const pts = new Map(); let g = null, lastTap = 0;
  const plotW = () => root.querySelector(".chartbox .plot")?.getBoundingClientRect().width * (314 / 360) || 300; // drawing area without the price gutter
  const settle = () => { if (st) { st.moving = false; redraw(); } };
  root.addEventListener("pointerdown", (e) => {
    if (!st?.bars || !e.target.closest(".fcard") || e.target.closest("button")) return;
    stopFling();
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { cancelPendingHold(); const [a, b] = [...pts.values()]; g = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, count0: st.count, end0: st.end, cx: (a.x + b.x) / 2 }; }
    else g = { kind: "maybe", x0: e.clientX, y0: e.clientY, end0: st.end, vx: 0, lx: e.clientX, lt: e.timeStamp };
  });
  root.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId) || !st?.bars || APP.scrub) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g?.kind === "pinch" && pts.size >= 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const r = root.querySelector(".chartbox .plot").getBoundingClientRect(), f = Math.min(1, Math.max(0, (g.cx - r.left) / plotW()));
      const count = g.count0 * (g.d0 / d), anchor = g.end0 - g.count0 * (1 - f); // keep the candle under the fingers in place
      st.moving = true; st.count = count; st.end = anchor + count * (1 - f); clampView(st); redraw();
    } else if (g && pts.size === 1) {
      const dx = e.clientX - g.x0;
      if (g.kind === "maybe" && Math.abs(dx) > 4) { g.kind = "pan"; g.x0 = e.clientX; g.end0 = st.end; cancelPendingHold(); try { root.setPointerCapture(e.pointerId); } catch {} } // capture only once dragging, so taps still reach panels
      if (g.kind === "pan") {
        const dt = Math.max(1, e.timeStamp - g.lt); g.vx = 0.8 * ((e.clientX - g.lx) / dt) + 0.2 * g.vx; g.lx = e.clientX; g.lt = e.timeStamp;
        st.moving = true; st.end = g.end0 - (e.clientX - g.x0) / (plotW() / st.count); clampView(st); redraw();
      }
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (g?.kind === "maybe" && pts.size === 0 && !APP.scrub) { // a tap: two quick taps reset the view
      if (Date.now() - lastTap < 320 && st?.home) { Object.assign(st, st.home); redraw(); lastTap = 0; } else lastTap = Date.now();
    }
    if (g?.kind === "pan" && pts.size === 0 && st && Math.abs(g.vx) > 0.15 && e.timeStamp - g.lt < 80) { // let a flick keep gliding, like a trading chart
      let v = g.vx, t0 = performance.now();
      const step = (now) => {
        const dt = Math.min(40, now - t0); t0 = now; v *= Math.pow(0.994, dt);
        if (!st || Math.abs(v) < 0.02) { fling = 0; settle(); return; }
        const before = st.end; st.end -= (v * dt) / (plotW() / st.count); clampView(st); draw();
        if (st.end === before) { fling = 0; settle(); return; }
        fling = requestAnimationFrame(step);
      };
      fling = requestAnimationFrame(step);
    } else if (pts.size === 0) settle();
    if (pts.size === 0) g = null; else if (pts.size === 1) { const [p] = [...pts.values()]; g = { kind: "pan", x0: p.x, end0: st.end, vx: 0, lx: p.x, lt: e.timeStamp }; }
  };
  root.addEventListener("pointerup", up); root.addEventListener("pointercancel", up);
  let wheelT = 0;
  root.addEventListener("wheel", (e) => {
    if (!st?.bars || !e.target.closest(".fcard")) return;
    e.preventDefault(); stopFling();
    const r = root.querySelector(".chartbox .plot")?.getBoundingClientRect(); if (!r) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) { st.end += (e.deltaX / plotW()) * st.count; }
    else {
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / plotW())), anchor = st.end - st.count * (1 - f);
      st.count *= Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.002)); st.end = anchor + st.count * (1 - f);
    }
    st.moving = true; clearTimeout(wheelT); wheelT = setTimeout(settle, 160);
    clampView(st); redraw();
  }, { passive: false });
}

// ---------- header and range buttons
function shell(body) {
  const { sym, range, levels, daily } = st, bars = st.bars, chg = daily?.changePct;
  const last = bars?.[bars.length - 1]?.c ?? D.series[sym.key]?.bars?.at(-1)?.c;
  return `<div class="fbar"><button class="fclose" data-fclose aria-label="Close full-screen chart">✕</button>
      <div class="fhead"><span class="row1"><span class="tk">${esc(sym.t)}</span>${chg != null ? `<span class="chg ${chg >= 0 ? "up" : "down"}">${arrow(chg)} ${pct(chg)}</span>` : `<span class="chg"></span>`}</span>
        <span class="price">${last != null ? esc(money(last, sym.m)) : ""}</span></div></div>
    <div class="franges" role="group" aria-label="Time range">${OPTS.map((r) => `<button class="opt" data-fr="${r}" aria-pressed="${r === range}">${r}</button>`).join("")}
      <button class="lvbtn" data-flv aria-pressed="${levels !== "off"}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 5h14M1 11h14"/></svg>${levels === "pivots" ? "Pivots" : "S/R"}</button></div>
    <div class="card fcard"><div class="pane main" data-pane="main">${body}</div></div>`;
}
function wireBar() {
  el.querySelector("[data-fclose]").onclick = closeFull;
  el.querySelectorAll("[data-fr]").forEach((b) => (b.onclick = () => { stopFling(); st.range = b.dataset.fr; load(); }));
  el.querySelector("[data-flv]").onclick = (e) => {
    const pick = chartSettings(st.sym.key).levels; st.levels = st.levels === "off" ? (pick && pick !== "off" ? pick : "sr") : "off";
    e.currentTarget.setAttribute("aria-pressed", st.levels !== "off"); e.currentTarget.lastChild.textContent = st.levels === "pivots" ? "Pivots" : "S/R";
    st.lvKey = null; if (st.bars) redraw();
  };
}

// ---------- indicators: add or remove, one shared choice for every coin's chart
function toggleStudy(code) {
  const isOver = !!OVERLAYS[code], list = isOver ? st.over : st.lower, i = list.indexOf(code);
  if (i >= 0) list.splice(i, 1);
  else if (list.length >= (isOver ? MAX_OVERLAYS : maxPanels())) { toast(`Up to ${isOver ? MAX_OVERLAYS : maxPanels()} ${isOver ? "on the price chart" : "panels"} at a time. Remove one first.`); return false; }
  else list.push(code);
  saveStudies(); return true;
}
function saveStudies() {
  st.changed = true; haptic();
  const ch = store.data?.settings?.chart || {};
  save({ settings: { ...store.data.settings, chart: { ...ch, over: [...st.over], lower: st.lower.join(",") || "none", mas: [] } } }).catch(() => {});
  APP.needsRebuild = true;
  if (st.bars) redraw();
}
