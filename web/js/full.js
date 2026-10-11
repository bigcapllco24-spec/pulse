// Full-screen chart for one coin: a bigger chart over longer periods than the feed (up to Kraken's full
// weekly history), with the same hold-to-read, alerts from the chart and support/resistance lines.
import { D, view, RANGES } from "./data.js";
import { buildSeries, compute } from "./indicators.js";
import { mainChart, lowerChart } from "./chart.js";
import { levelsFor } from "./levels.js";
import { chartSettings } from "./store.js";
import { initInteract, openLearn } from "./interact.js";
import { esc, money, pct, arrow, haptic } from "./ui.js";

const KRAKEN = { BTC: "XBTUSD", DOGE: "XDGUSD", RNDR: "RENDERUSD" };
const LONG = { "5Y": 1826, Max: 1e6 };
const OPTS = ["1M", "3M", "6M", "1Y", "2Y", "5Y", "Max"];
const NEXT = { "1M": "6M", "3M": "1Y", "6M": "2Y", "1Y": "2Y", "2Y": "5Y" };
const weeklyCache = new Map();

async function weeklyBars(t) {
  if (weeklyCache.has(t)) return weeklyCache.get(t);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${KRAKEN[t] || t + "USD"}&interval=10080`, { signal: ctl.signal });
    const j = await r.json(); if (j.error?.length) throw new Error(j.error[0]);
    const rows = Object.entries(j.result).find(([k]) => k !== "last")?.[1] || [];
    const bars = rows.map((x) => ({ t: new Date(x[0] * 1000).toISOString().slice(0, 10), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[6] }));
    weeklyCache.set(t, bars); return bars;
  } finally { clearTimeout(timer); }
}
// Same shape as data.js view(), built from weekly bars for the long ranges.
function longView(key, bars, range) {
  const series = buildSeries(bars), n = bars.length;
  const cut = new Date(Date.parse(bars[n - 1].t) - LONG[range] * 864e5).toISOString().slice(0, 10);
  let from = bars.findIndex((b) => b.t > cut); if (from < 0 || n - from < 5) from = Math.max(0, n - 5);
  const ov = {}; for (const k of Object.keys(series)) ov[k] = series[k].slice(from);
  const r = compute(bars, series), daily = view(key, { range: "3M", interval: "1D" })?.daily || r;
  return { key, range, interval: "1W", bars, win: bars.slice(from), ov, now: r.now, prev: r.prev, daily, lastBar: bars[n - 1], source: "Kraken" };
}

let el = null, state = null;
export function openFull(sym) {
  if (!el) {
    el = document.createElement("div"); el.id = "full"; el.className = "full"; el.hidden = true;
    document.body.appendChild(el);
    initInteract(el); // hold-to-read and alerts work here too
    addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.hidden) closeFull(); });
  }
  const cs = chartSettings(sym.key);
  state = { sym, range: NEXT[cs.range] || "2Y", levels: cs.levels && cs.levels !== "off" ? cs.levels : "off", lower: cs.lower, type: cs.type };
  el.hidden = false; document.body.classList.add("fullopen");
  draw(); haptic();
}
export function closeFull() { if (!el) return; el.hidden = true; el.innerHTML = ""; document.body.classList.remove("fullopen"); state = null; }

async function draw() {
  const { sym, range } = state;
  let v = null, note = "";
  if (LONG[range]) {
    el.innerHTML = shell(null, `<p class="fload">Loading ${esc(range === "Max" ? "the full" : range)} history…</p>`);
    wireBar();
    try { v = longView(sym.key, await weeklyBars(sym.t), range); }
    catch { note = "Longer history couldn't load just now. Showing 2 years."; v = view(sym.key, { range: "2Y", interval: "auto" }); }
    if (!state || state.range !== range) return; // closed or changed while loading
  } else v = view(sym.key, { range, interval: "auto" });
  if (!v) { el.innerHTML = shell(null, `<p class="fload">Prices for ${esc(sym.t)} haven't loaded yet.</p>`); wireBar(); return; }
  const lowers = String(state.lower || "none").split(",").filter((k) => k !== "none");
  const first = v.win[0].t, span = `${first.slice(0, 4) === v.lastBar.t.slice(0, 4) ? "" : first.slice(0, 4) + " – "}${v.lastBar.t.slice(0, 4)}`;
  const winChg = ((v.lastBar.c - v.win[0].c) / v.win[0].c) * 100;
  el.innerHTML = shell(v, `<div class="chartbox">${mainChart(v.win, v.ov, { type: state.type, closeOnly: v.closeOnly, interval: v.interval, days: LONG[range] || RANGES[range], levels: levelsFor(v, state.levels) })}</div>
    ${lowers.map((k) => lowerChart(v.win, v.ov, k)).join("")}
    <p class="fnote">${note ? esc(note) + " " : ""}${v.interval === "1W" ? "Weekly" : "Daily"} candles · ${esc(span)} · <span class="${winChg >= 0 ? "up" : "down"}">${pct(winChg, 1)}</span> over this range · Hold the chart to read any ${v.interval === "1W" ? "week" : "day"}</p>`);
  const card = el.querySelector(".card"); card._v = v; card._sym = sym;
  card.querySelectorAll("[data-learn]").forEach((p) => p.addEventListener("click", (e) => { e.stopPropagation(); openLearn(p.dataset.learn, v); }));
  wireBar();
}
function shell(v, body) {
  const { sym, range, levels } = state, d = v?.daily?.now, chg = d?.changePct;
  return `<div class="fbar"><button class="fclose" data-fclose aria-label="Close full-screen chart">✕</button>
      <div class="fhead"><span class="tk">${esc(sym.t)}</span>${chg != null ? `<span class="chg ${chg >= 0 ? "up" : "down"}">${arrow(chg)} ${pct(chg)}</span>` : `<span class="chg"></span>`}
        <span class="price">${v ? esc(money(v.lastBar.c, sym.m)) : ""}</span></div></div>
    <div class="franges" role="group" aria-label="Time range">${OPTS.map((r) => `<button class="opt" data-fr="${r}" aria-pressed="${r === range}">${r}</button>`).join("")}
      <button class="lvbtn" data-flv aria-pressed="${levels !== "off"}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 5h14M1 11h14"/></svg>${levels === "pivots" ? "Pivots" : "S/R"}</button></div>
    <div class="card fcard"><div class="pane main" data-pane="main">${body}</div></div>`;
}
function wireBar() {
  el.querySelector("[data-fclose]").onclick = closeFull;
  el.querySelectorAll("[data-fr]").forEach((b) => (b.onclick = () => { state.range = b.dataset.fr; draw(); }));
  el.querySelector("[data-flv]").onclick = () => { state.levels = state.levels === "off" ? chartSettings(state.sym.key).levels !== "off" ? chartSettings(state.sym.key).levels : "sr" : "off"; draw(); };
}
