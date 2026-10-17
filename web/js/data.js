// Market data on the phone. Paints instantly from the last saved candles, then refreshes:
// coins straight from Kraken's free public API, everything else from the site's data files (built every 2 hours).
import { ls } from "./store.js";
import { buildSeries, compute, toWeekly } from "./indicators.js";

const KRAKEN = { BTC: "XBTUSD", DOGE: "XDGUSD", RNDR: "RENDERUSD" };
export const D = { series: {}, news: { stories: [] }, generatedAt: null, live: {}, status: "idle", error: null, intra: {} };

// Intraday candles from Kraken (15-minute or 1-hour), shared by feed cards, the full-screen chart and the recap.
const intraCache = new Map(); // `${t}:${interval}` → { at, bars }
// days: only that many recent days are asked for (the feed's cards); without it, the most Kraken gives (720 candles).
export async function krakenBars(t, iv, days = 0) {
  const k = `${t}:${iv}:${days}`, hit = intraCache.get(k) || (days && intraCache.get(`${t}:${iv}:0`)); // a full set covers a short ask
  if (hit && Date.now() - hit.at < (iv < 1440 ? 120e3 : 3600e3)) return hit.bars;
  const since = days ? `&since=${Math.floor(Date.now() / 1000) - days * 86400}` : "";
  const j = await getJSON(`https://api.kraken.com/0/public/OHLC?pair=${KRAKEN[t] || t + "USD"}&interval=${iv}${since}`, 9000);
  if (j.error?.length) throw new Error(j.error[0]);
  const rows = Object.entries(j.result).find(([x]) => x !== "last")?.[1] || [];
  const bars = rows.map((x) => ({ t: new Date(x[0] * 1000).toISOString().slice(0, iv < 1440 ? 16 : 10), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[6] }));
  if (bars.length < 5) throw new Error("no data");
  intraCache.set(k, { at: Date.now(), bars }); return bars;
}
// Feed ranges shorter than a month use intraday candles: [Kraken minutes, days shown].
export const INTRA = { "1D": [15, 1], "1W": [60, 7] };
// Days of intraday candles a card asks for: the days it shows plus ~250 candles before them, enough for every
// indicator to settle (a 200 average included). 4 days of 15-minute candles, 18 of hourly: about half of Kraken's 720.
const intraDays = (iv) => Math.ceil(Object.values(INTRA).find(([m]) => m === iv)[1] + (250 * iv) / 1440) + 1;
function loadIntra(key, iv) {
  const ik = `${key}|${iv}`;
  const prev = D.intra[ik];
  if (prev && !prev.stale) return;
  D.intra[ik] = { loading: true, bars: prev?.bars }; // keep showing the old candles while new ones load
  krakenBars(key.split(":")[1], iv, intraDays(iv))
    .then((bars) => { D.intra[ik] = { bars, at: Date.now() }; })
    .catch(() => { D.intra[ik] = { failed: true }; setTimeout(() => { if (D.intra[ik]?.failed) delete D.intra[ik]; }, 60e3); })
    .finally(() => document.dispatchEvent(new CustomEvent("pulse-intra", { detail: key })));
}
// The same chart settings on daily candles (for lists, sorting and rules, which always read daily data).
export const dailyOf = (c) => (INTRA[c.range] ? { ...c, range: "3M", interval: "1D" } : c);
export const intraState = (key, range) => (INTRA[range] ? D.intra[`${key}|${INTRA[range][0]}`] || {} : {});

const CACHE = "pl.candles";
function fromRows(rows) { return rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] || 0 })); }

export function loadCached() {
  const c = ls.get(CACHE);
  if (c?.series) { for (const [k, v] of Object.entries(c.series)) D.series[k] = { ...v, bars: fromRows(v.bars) }; D.generatedAt = c.generatedAt; }
}
function saveCache() {
  const series = {};
  for (const [k, v] of Object.entries(D.series)) series[k] = { ...v, bars: v.bars.slice(-730).map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]) };
  ls.set(CACHE, { generatedAt: D.generatedAt, series });
}

// Every request gives up after 8 seconds, so a slow or blocked source never leaves the app stuck on "Updating".
// The site's data files are revalidated rather than re-downloaded ("no-cache": an unchanged file costs a 304, not its
// full size; they change once every 2 hours). Kraken answers are always fresh.
async function getJSON(url, ms = 8000, cache = "no-store") {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { cache, signal: ctl.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
// index.html starts the three data files downloading before any script has loaded; the first refresh uses those.
const fileJSON = (f) => {
  const pre = globalThis.__pre?.[f];
  if (pre) { delete globalThis.__pre[f]; return pre; }
  return getJSON(`data/${f}.json`, 8000, "no-cache").catch(() => null);
};

const dayRows = (rows) => rows.map((x) => ({ t: new Date(x[0] * 1000).toISOString().slice(0, 10), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[6] }));
const krakenDaily = async (t, since) => {
  const j = await getJSON(`https://api.kraken.com/0/public/OHLC?pair=${KRAKEN[t] || t + "USD"}&interval=1440${since ? `&since=${since}` : ""}`);
  if (j.error?.length) throw new Error(j.error[0]);
  return dayRows(Object.entries(j.result).find(([k]) => k !== "last")?.[1] || []);
};
// Live daily candles: only the last few days are asked for (a handful of rows instead of 720) and laid over the
// history the phone already has from the data file or its saved copy. The full history is fetched only when there's
// nothing to lay them over.
const RECENT_DAYS = 4;
function lay(base, recent) {
  if (!base?.length || !recent.length || base.at(-1).t < recent[0].t) return null; // a gap: can't join them
  return [...base.filter((b) => b.t < recent[0].t), ...recent].slice(-730);
}

// One refresh for the whole watchlist. A failed symbol never breaks the others.
export async function refresh(syms, onFile) {
  D.status = "refreshing"; D.error = null;
  for (const st of Object.values(D.intra)) if (st.bars && !(Date.now() - st.at < 60e3)) st.stale = true; // intraday candles over a minute old reload on the next draw (not the ones the cards just fetched)
  try {
    const coins = [...new Set(syms.filter((s) => s.m === "CRYPTO").map((s) => s.t))].slice(0, 25);
    const since = Math.floor(Date.now() / 1000) - RECENT_DAYS * 86400;
    // the data files and the live prices download at the same time
    const live = new Map(coins.map((t) => [t, krakenDaily(t, since).catch(() => null)]));
    const [candles, news, daily] = await Promise.all([fileJSON("candles"), fileJSON("news"), fileJSON("daily")]);
    if (daily) D.daily = daily; // the daily coin's crowd results (habit.js)
    if (candles?.series) {
      for (const [k, v] of Object.entries(candles.series)) {
        const cur = D.series[k];
        if (!cur || cur.closeOnly || !v.closeOnly) D.series[k] = { ...v, bars: fromRows(v.bars) };
      }
      D.generatedAt = candles.generatedAt;
    }
    if (news) D.news = news;
    // draw from the data file straight away only if live prices are slow; usually they're in already and the
    // cards draw once, with both
    const allLive = Promise.all(live.values());
    if (await Promise.race([allLive.then(() => true), new Promise((r) => setTimeout(r, 350, false))]) === false) onFile?.();
    await Promise.all(coins.map(async (t) => {
      const key = "CRYPTO:" + t, recent = await live.get(t);
      if (!recent) return; // Kraken unreachable: keep the file or saved copy (no second try that would wait again)
      try {
        const bars = (recent && lay(D.series[key]?.bars, recent)) || (await krakenDaily(t));
        if (bars.length > 30) D.series[key] = { source: "Kraken", closeOnly: false, bars, live: true };
      } catch { /* keep the file or cached copy */ }
    }));
    D.refreshedAt = new Date().toISOString();
    D.status = "ok";
    (globalThis.requestIdleCallback || ((f) => setTimeout(f, 300)))(saveCache, { timeout: 4000 }); // ~1 MB of JSON: written when the phone is idle, not mid-draw
  } catch (e) { D.status = "error"; D.error = "Couldn't refresh. Showing saved data."; }
}

// Everything a card needs for one symbol under the current chart settings.
// Chart time ranges in days. Candles are daily up to 6 months and weekly from 1 year, unless the person picks one.
export const RANGES = { "1D": 1, "1W": 7, "1M": 30, "3M": 91, "6M": 182, "1Y": 365, "2Y": 730 };
export const RANGE_LABEL = { "1D": "1 day", "1W": "1 week", "1M": "1 month", "3M": "3 months", "6M": "6 months", "1Y": "1 year", "2Y": "2 years" };
// candle size: 15m and 1h for the intraday ranges; otherwise daily, or weekly from a year (or as picked)
export const resolveInterval = (c) => (c.range === "1D" ? "15m" : c.range === "1W" ? "1h" : c.interval === "1D" || c.interval === "1W" ? c.interval : (RANGES[c.range] || 91) >= 365 ? "1W" : "1D");
export const IV_LABEL = { "15m": "15-min", "1h": "Hourly", "1D": "Daily", "1W": "Weekly" };

// Results are cached per series object and window, so lists, sorting and the dashboard don't recompute every
// indicator on each call. A refresh replaces the series object, which drops its cache automatically.
const viewCache = new WeakMap();
export function view(key, chart) {
  const s = D.series[key];
  if (!s?.bars?.length) return null;
  if (INTRA[chart.range]) { // intraday: drawn once its candles arrive (cards redraw on "pulse-intra")
    const [iv] = INTRA[chart.range], st = D.intra[`${key}|${iv}`];
    if (!st || st.stale) loadIntra(key, iv);
    if (!st?.bars) return null;
    let m = viewCache.get(st);
    if (!m) viewCache.set(st, (m = new Map()));
    if (!m.has(chart.range)) m.set(chart.range, computeView(key, s, chart, st.bars));
    // a new intraday object replaces the old one when it loads, so the cache above is per download
    return m.get(chart.range);
  }
  const ck = `${resolveInterval(chart)}|${chart.range}`;
  let m = viewCache.get(s);
  if (!m) viewCache.set(s, (m = new Map()));
  if (!m.has(ck)) m.set(ck, computeView(key, s, chart));
  return m.get(ck);
}
// Daily readings for a series (every indicator's latest value), worked out once per series object and only when
// something reads them (the details pane, Your market's sorting, rules), not for every card that's drawn.
const dailyCache = new WeakMap();
const dailyReadings = (s) => { let r = dailyCache.get(s); if (r === undefined) dailyCache.set(s, (r = compute(s.bars))); return r; };
function computeView(key, s, chart, intraBars) {
  const interval = intraBars ? "intraday" : resolveInterval(chart);
  const bars = intraBars || (interval === "1W" ? toWeekly(s.bars) : s.bars);
  const series = buildSeries(bars);
  // window by calendar time: every candle whose date falls inside the chosen range (at least 5 candles)
  const tms = (t) => Date.parse(t.length > 10 ? t + ":00Z" : t);
  const n = bars.length, cut = new Date(tms(bars[n - 1].t) - (RANGES[chart.range] || 91) * 864e5).toISOString().slice(0, intraBars ? 16 : 10);
  let from = bars.findIndex((b) => b.t > cut); if (from < 0 || n - from < 5) from = Math.max(0, n - 5);
  const w = n - from;
  const slice = (a) => a.slice(from);
  const win = bars.slice(from);
  const ov = {};
  for (const k of Object.keys(series)) ov[k] = slice(series[k]);
  const out = { key, range: chart.range, interval, ivLabel: intraBars ? IV_LABEL[resolveInterval(chart)] : IV_LABEL[interval], source: s.source, closeOnly: !!s.closeOnly, live: !!s.live, bars, win, ov, lastBar: bars[n - 1], prevBar: bars[n - 2],
    windowChange: ((win[w - 1].c - win[0].o) / win[0].o) * 100 }; // from the first candle's open to now
  // the readings are worked out on first use (daily candles share one set per coin)
  let r;
  const own = () => (r ??= interval === "1D" ? dailyReadings(s) : compute(bars, series));
  Object.defineProperties(out, {
    now: { get: () => own()?.now, enumerable: true },
    prev: { get: () => own()?.prev, enumerable: true },
    daily: { get: () => dailyReadings(s), enumerable: true }, // the details pane always reads daily candles
  });
  return out;
}

// Was today's move unusually large? (more than twice the typical daily move)
export function bigMove(v) {
  const d = v?.daily?.now;
  return d && d.atrPct && d.changePct != null && Math.abs(d.changePct) >= 2 * d.atrPct;
}

export const storiesFor = (key) => (D.news.stories || []).filter((st) => st.syms.includes(key));
