// Market data on the phone. Paints instantly from the last saved candles, then refreshes:
// coins straight from Kraken's free public API, everything else from the site's data files (built every 2 hours).
import { ls } from "./store.js";
import { buildSeries, compute, toWeekly } from "./indicators.js";

const KRAKEN = { BTC: "XBTUSD", DOGE: "XDGUSD", RNDR: "RENDERUSD" };
export const D = { series: {}, news: { stories: [] }, generatedAt: null, live: {}, status: "idle", error: null };

const CACHE = "pl.candles";
function fromRows(rows) { return rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] || 0 })); }

export function loadCached() {
  const c = ls.get(CACHE);
  if (c?.series) { for (const [k, v] of Object.entries(c.series)) D.series[k] = { ...v, bars: fromRows(v.bars) }; D.generatedAt = c.generatedAt; }
}
function saveCache() {
  const series = {};
  for (const [k, v] of Object.entries(D.series)) series[k] = { ...v, bars: v.bars.slice(-260).map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]) };
  ls.set(CACHE, { generatedAt: D.generatedAt, series });
}

// Every request gives up after 8 seconds, so a slow or blocked source never leaves the app stuck on "Updating".
async function getJSON(url, ms = 8000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { cache: "no-store", signal: ctl.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

async function kraken(t) {
  const j = await getJSON(`https://api.kraken.com/0/public/OHLC?pair=${KRAKEN[t] || t + "USD"}&interval=1440`);
  if (j.error?.length) throw new Error(j.error[0]);
  const rows = Object.entries(j.result).find(([k]) => k !== "last")?.[1] || [];
  return rows.slice(-300).map((x) => ({ t: new Date(x[0] * 1000).toISOString().slice(0, 10), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[6] }));
}

// One refresh for the whole watchlist. A failed symbol never breaks the others.
export async function refresh(syms) {
  D.status = "refreshing"; D.error = null;
  try {
    const [candles, news] = await Promise.all([getJSON("data/candles.json").catch(() => null), getJSON("data/news.json").catch(() => null)]);
    if (candles?.series) {
      for (const [k, v] of Object.entries(candles.series)) {
        const cur = D.series[k];
        if (!cur || cur.closeOnly || !v.closeOnly) D.series[k] = { ...v, bars: fromRows(v.bars) };
      }
      D.generatedAt = candles.generatedAt;
    }
    if (news) D.news = news;
    const coins = [...new Set(syms.filter((s) => s.m === "CRYPTO").map((s) => s.t))].slice(0, 25);
    await Promise.all(coins.map(async (t) => {
      try { const bars = await kraken(t); if (bars.length > 30) D.series["CRYPTO:" + t] = { source: "Kraken", closeOnly: false, bars, live: true }; }
      catch { /* keep the file or cached copy */ }
    }));
    D.refreshedAt = new Date().toISOString();
    D.status = "ok";
    saveCache();
  } catch (e) { D.status = "error"; D.error = "Couldn't refresh. Showing saved data."; }
}

// Everything a card needs for one symbol under the current chart settings.
// Results are cached per series object and window, so lists, sorting and the dashboard don't recompute every
// indicator on each call. A refresh replaces the series object, which drops its cache automatically.
const viewCache = new WeakMap();
export function view(key, chart) {
  const s = D.series[key];
  if (!s?.bars?.length) return null;
  const ck = `${chart.interval}|${chart.window}`;
  let m = viewCache.get(s);
  if (!m) viewCache.set(s, (m = new Map()));
  if (!m.has(ck)) m.set(ck, computeView(key, s, chart));
  return m.get(ck);
}
function computeView(key, s, chart) {
  const bars = chart.interval === "1W" ? toWeekly(s.bars) : s.bars;
  const series = buildSeries(bars);
  const n = bars.length, w = Math.min(chart.window, n), from = n - w;
  const slice = (a) => a.slice(from);
  const win = bars.slice(from);
  const ov = {};
  for (const k of Object.keys(series)) ov[k] = slice(series[k]);
  const r = compute(bars, series);
  const daily = chart.interval === "1W" ? compute(s.bars) : r;
  return { key, source: s.source, closeOnly: !!s.closeOnly, live: !!s.live, bars, win, ov, now: r.now, prev: r.prev, daily, lastBar: bars[n - 1], prevBar: bars[n - 2],
    windowChange: ((win[w - 1].c - win[0].c) / win[0].c) * 100 };
}

// Was today's move unusually large? (more than twice the typical daily move)
export function bigMove(v) {
  const d = v?.daily?.now;
  return d && d.atrPct && d.changePct != null && Math.abs(d.changePct) >= 2 * d.atrPct;
}

export const storiesFor = (key) => (D.news.stories || []).filter((st) => st.syms.includes(key));
