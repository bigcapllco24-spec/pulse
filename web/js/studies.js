// The indicators people can put on a chart: lines drawn on the price chart ("overlays") and panels below it.
// One shared choice for every coin, picked from the full-screen chart. Each entry says which per-candle series
// it draws, how to scale it, and which reading it adds to the details pane. Descriptive only, never advice.
import { extendedSeries } from "./indicators.js";

const C = { a: "var(--ma1)", b: "var(--ma2)", c: "var(--ma3)", acc: "var(--accent)", up: "var(--up)", down: "var(--down)", mut: "var(--muted)" };

// keys: series to slice for the window. base: true when buildSeries already has them.
export const OVERLAYS = {
  MA20: { name: "Moving average 20", tag: "MA 20", group: "Averages", short: "Average close of the last 20 candles.", read: "The line follows the average close. When candles sit above it, prices have been higher than their recent typical level; below it, lower. The longer the average, the slower it turns.", lines: [["sma20", C.a]], metric: "distSma20Pct", guide: "ma", base: true },
  MA50: { name: "Moving average 50", tag: "MA 50", group: "Averages", short: "Average close of the last 50 candles.", read: "The line follows the average close. When candles sit above it, prices have been higher than their recent typical level; below it, lower. The longer the average, the slower it turns.", lines: [["sma50", C.b]], metric: "distSma50Pct", guide: "ma", base: true },
  MA200: { name: "Moving average 200", tag: "MA 200", group: "Averages", short: "Average close of the last 200 candles, the long-run line many people watch.", read: "The slowest of the averages. Many people watch where the price sits relative to it as a broad picture of the long-run level.", lines: [["sma200", C.c]], guide: "ma", base: true },
  EMA20: { name: "Exponential average 20", tag: "EMA 20", group: "Averages", short: "Like the 20 average, but recent candles count more.", read: "Dashed line. It turns sooner than a simple average of the same length because recent candles count more.", lines: [["ema20", C.a, "dash"]], metric: "ema20", guide: "ema", base: true },
  EMA50: { name: "Exponential average 50", tag: "EMA 50", group: "Averages", short: "A 50-candle average weighted towards recent candles.", read: "Dashed line. It turns sooner than a simple average of the same length because recent candles count more.", lines: [["ema50", C.b, "dash"]], guide: "ema", base: true },
  BB: { name: "Bollinger Bands (20, 2)", tag: "BB", group: "Bands", short: "A band two standard deviations either side of the 20 average. Wider band, bigger swings.", read: "The shaded band is the middle average (dashed) plus and minus two standard deviations. A wide band means big recent swings, a narrow one means quiet trading. Closes outside the band are unusual, not a signal.", lines: [["bbUpper", C.acc], ["sma20", C.acc, "dash"], ["bbLower", C.acc]], fill: ["bbUpper", "bbLower"], metric: "pctB", guide: "bb", base: true },
  KC: { name: "Keltner Channels (20, 2)", tag: "KC", group: "Bands", short: "A channel two average daily ranges either side of the 20 exponential average.", read: "The shaded channel is the 20 exponential average (dashed) plus and minus two average daily ranges. It widens and narrows with the size of daily moves.", lines: [["kcUp", C.b], ["kcMid", C.b, "dash"], ["kcLow", C.b]], fill: ["kcUp", "kcLow"], metric: "keltPos", guide: "keltner" },
  DC: { name: "Donchian Channels (20)", tag: "DC", group: "Bands", short: "The highest high and lowest low of the last 20 candles.", read: "The top line is the highest high and the bottom line the lowest low of the last 20 candles; the dashed line is halfway. A close at the top line is a new 20-candle high.", lines: [["dcUp", C.c], ["dcMid", C.c, "dash"], ["dcLow", C.c]], fill: ["dcUp", "dcLow"], metric: "donPos", guide: "donchian" },
  ICHI: { name: "Ichimoku cloud", tag: "Ichimoku", group: "Trend", short: "A cloud built from past highs and lows, with the conversion (9) and base (26) lines.", read: "The shaded cloud is drawn from past highs and lows: green where span A is above span B, red where below. The blue line is the 9-candle midpoint, the red line the 26-candle midpoint. Price above, inside or below the cloud is the usual way it's described.", lines: [["tenkan", C.acc], ["kijun", C.down]], cloud: ["spanA", "spanB"], metric: "ichiCloud", guide: "ichimoku" },
  SAR: { name: "Parabolic SAR", tag: "SAR", group: "Trend", short: "Dots that trail the price and flip sides when it crosses them.", read: "Green dots below the candles mean the price is above the trailing level; red dots above mean it's below. The dots flip side when the price crosses them.", dots: "psar", metric: "sarDist", guide: "psar" },
  ST: { name: "Supertrend (10, 3)", tag: "Supertrend", group: "Trend", short: "A line three average ranges from price: green below it, red above it.", read: "Green while the price closes above the line, red while it closes below. The line moves only in the direction of the colour, and switches when a close crosses it.", trend: "stLine", metric: "stDist", guide: "supertrend" },
};

// range: fixed [min, max] or null for automatic. refs: dotted reference levels. zero: draw the zero line.
export const PANELS = {
  RSI: { name: "RSI (14)", label: "RSI 14", group: "Momentum", short: "Average gains against average losses over 14 candles, 0 to 100.", lines: [["rsi14", C.acc]], range: [0, 100], refs: [30, 70], band: [30, 70], metric: "rsi14", guide: "rsi", base: true },
  MACD: { name: "MACD (12, 26, 9)", label: "MACD hist", group: "Momentum", short: "The gap between a fast and a slow average, and its signal line.", hist: "macdHist", lines: [["macd", C.acc], ["macdSignal", C.a]], zero: true, sym: true, metric: "macdHist", guide: "macd", base: true },
  VOL: { name: "Volume", label: "Volume", group: "Volume", short: "How much traded in each candle, green when it closed higher than it opened.", vol: true, metric: "volRatio", guide: "volume", base: true },
  STOCH: { name: "Stochastic (14, 3)", label: "Stoch %K", group: "Momentum", short: "Where the close sits in the 14-candle high–low range, with a 3-candle average.", read: "Moves between 0 and 100. The blue line (%K) is where the close sits in its 14-candle range; the yellow line (%D) is its 3-candle average. The dotted lines mark 80 and 20.", lines: [["stochK", C.acc], ["stochD", C.a]], range: [0, 100], refs: [20, 80], metric: "stochK", guide: "stoch", baseKeys: ["stochK"] },
  STOCHRSI: { name: "Stochastic RSI (14)", label: "Stoch RSI", group: "Momentum", short: "Where RSI sits within its own 14-candle range.", read: "Moves between 0 and 100: 100 means RSI is at its highest of the last 14 candles, 0 its lowest. It swings a lot, often from one end to the other within days.", lines: [["stochRsi", C.acc]], range: [0, 100], refs: [20, 80], metric: "stochRsi", guide: "stochrsi" },
  MFI: { name: "Money Flow Index (14)", label: "MFI 14", group: "Volume", short: "A volume-weighted RSI, 0 to 100.", read: "Moves between 0 and 100, like RSI but weighted by volume. The dotted lines mark 80 and 20, where buying or selling pressure has clearly dominated.", lines: [["mfi14", C.acc]], range: [0, 100], refs: [20, 80], metric: "mfi14", guide: "mfi" },
  CCI: { name: "Commodity Channel Index (20)", label: "CCI 20", group: "Momentum", short: "How far the typical price is from its 20 average, in usual-deviation units.", read: "Zero is the average. The dotted lines at +100 and −100 mark an unusually large distance above or below it.", lines: [["cci20", C.acc]], refs: [-100, 100], zero: true, metric: "cci20", guide: "cci", base: true },
  WILLR: { name: "Williams %R (14)", label: "Williams %R", group: "Momentum", short: "How far the close is below the 14-candle high, 0 to −100.", read: "Moves between 0 (close at the 14-candle high) and −100 (close at the low). The dotted lines mark −20 and −80.", lines: [["willR", C.acc]], range: [-100, 0], refs: [-80, -20], metric: "willR", guide: "willr", base: true },
  ADX: { name: "ADX and DI (14)", label: "ADX 14", group: "Trend", short: "Trend strength (ADX), with upward (+DI) and downward (−DI) movement.", read: "The blue line (ADX) shows trend strength in either direction: under 20 is weak, over 40 strong. Green (+DI) above red (−DI) means upward moves have been bigger than downward ones.", lines: [["adx14", C.acc], ["plusDI", C.up], ["minusDI", C.down]], range: [0, null], refs: [20, 40], metric: "adx14", guide: "adx", baseKeys: ["adx14"] },
  AROON: { name: "Aroon (25)", label: "Aroon", group: "Trend", short: "How recently the 25-candle high (green) and low (red) were set.", read: "Green is 100 on the day of a new 25-candle high and falls each candle after; red does the same for lows. Whichever is higher had its extreme more recently.", lines: [["aroonUp", C.up], ["aroonDown", C.down]], range: [0, 100], refs: [50], metric: "aroonOsc", guide: "aroon" },
  ATR: { name: "Average True Range (14)", label: "ATR % of price", group: "Volatility", short: "The typical size of a candle's range, as a share of price.", read: "Higher means bigger daily ranges. It shows how much prices have been moving, not which way.", lines: [["atrPctS", C.acc]], range: [0, null], metric: "atrPct", guide: "atr" },
  HV: { name: "Historical volatility (20)", label: "Volatility (yearly %)", group: "Volatility", short: "How much prices swung over 20 days, scaled to a year.", read: "Higher means bigger swings. It's the 20-day spread of daily changes, scaled to a year so coins can be compared.", lines: [["hv20", C.acc]], range: [0, null], metric: "hv20", guide: "hv" },
  OBV: { name: "On-Balance Volume", label: "OBV", group: "Volume", short: "Running total of volume: added on up days, taken away on down days.", read: "A rising line means more volume on up days than down days; a falling line the reverse. The level itself doesn't matter, only the direction.", lines: [["obv", C.acc]], metric: "obvFlow20", guide: "obv" },
  CMF: { name: "Chaikin Money Flow (20)", label: "CMF 20", group: "Volume", short: "Whether closes sat near the highs or lows of their candles, weighted by volume.", read: "Bars above zero mean closes have tended to sit near the day's high, weighted by volume; below zero, near the low.", hist: "cmf20", zero: true, sym: true, metric: "cmf20", guide: "cmf" },
  ROC: { name: "Rate of change (12)", label: "ROC 12 %", group: "Momentum", short: "Percentage change over the last 12 candles.", read: "Above zero means the price is higher than 12 candles ago; below zero, lower. The number is the percentage change.", lines: [["roc12", C.acc]], zero: true, metric: "roc12", guide: "roc", base: true },
  CMO: { name: "Chande Momentum (14)", label: "CMO 14", group: "Momentum", short: "Up-candle gains minus down-candle losses, −100 to 100.", read: "Moves between −100 and 100. Above 50 means gains have clearly outweighed losses over 14 candles; below −50, the reverse.", lines: [["cmo14", C.acc]], range: [-100, 100], refs: [-50, 50], zero: true, metric: "cmo14", guide: "cmo" },
  AO: { name: "Awesome Oscillator", label: "AO % of price", group: "Momentum", short: "The 5 average of each candle's midpoint minus the 34 average.", read: "Bars above zero mean the 5-candle average is above the 34-candle one; green bars are higher than the bar before, red lower.", hist: "aoPct", zero: true, sym: true, metric: "aoPct", guide: "ao" },
  UO: { name: "Ultimate Oscillator", label: "Ultimate", group: "Momentum", short: "Close position blended over 7, 14 and 28 candles, 0 to 100.", read: "Moves between 0 and 100. The dotted lines mark 70 and 30. It blends three time spans so short spikes count for less.", lines: [["uo", C.acc]], range: [0, 100], refs: [30, 70], metric: "uo", guide: "ultimate" },
};
export const MAX_OVERLAYS = 4;
// Panels below the chart: up to 4 (as a 2 × 2 grid on cards) on screens at least as wide as an iPhone 12
// (390 px); narrower phones get 2, which is all that stays readable there.
export const WIDE_PX = 390;
// The width is read once and on resize: reading innerWidth while cards are being drawn forces the browser to lay the
// page out again each time (that was ~80 ms per open on a mid-range phone).
let vw = typeof innerWidth === "number" ? innerWidth : WIDE_PX;
if (typeof addEventListener === "function") addEventListener("resize", () => (vw = innerWidth));
export const maxPanels = () => (vw >= WIDE_PX ? 4 : 2);

export const keysOf = (st) => [...(st.lines || []).map((l) => l[0]), ...(st.fill || []), ...(st.cloud || []), st.dots, st.trend, st.hist].filter(Boolean);
const needsExt = (st) => !st.base && keysOf(st).some((k) => !(st.baseKeys || []).includes(k));

// Series for the candles from..end, merging the base series (already sliced in ov) with the extra ones.
export function studyWindow(bars, ov, from, end, codes) {
  const out = { ...ov };
  const list = codes.map((c) => OVERLAYS[c] || PANELS[c]).filter(Boolean);
  if (list.some(needsExt)) {
    const ext = extendedSeries(bars);
    for (const st of list) for (const k of keysOf(st)) if (!(k in out) && ext[k]) out[k] = ext[k].slice(from, end);
  }
  return out;
}

// The current picks, from settings, with older settings carried over (moving averages and the old panel string).
const MA_OLD = { sma20: "MA20", sma50: "MA50", sma200: "MA200", ema20: "EMA20", ema50: "EMA50" };
// feed (1.3.2): the panels also shown on feed cards, at most FEED_MAX, always among those shown in full screen. Accounts
// from before 1.3.2 have no feed setting and keep the panels their cards showed; new accounts start with none.
export const FEED_MAX = 2;
export function picks(chart) {
  const over = chart?.over || (chart?.mas || []).map((k) => MA_OLD[k]).filter(Boolean);
  const lower = String(chart?.lower ?? "RSI,MACD").split(",").filter((k) => PANELS[k]);
  const feed = chart?.feed == null ? lower.slice(0, FEED_MAX) : String(chart.feed).split(",").filter((k) => lower.includes(k)).slice(0, FEED_MAX);
  return { over: over.filter((k) => OVERLAYS[k]), lower, feed };
}

// Ready-made ways to look at a chart. Learning sets, not strategies: each groups indicators that answer one question.
export const SETS = [
  { id: "trend", name: "Trend", q: "Which way has it been heading?", over: ["MA50", "MA200"], lower: ["ADX"] },
  { id: "momentum", name: "Momentum", q: "How strong have recent moves been?", over: [], lower: ["RSI", "MACD", "STOCH"] },
  { id: "volatility", name: "Volatility", q: "How big have the swings been?", over: ["BB"], lower: ["ATR"] },
  { id: "volume", name: "Volume", q: "Has trading backed the moves?", over: [], lower: ["VOL", "OBV", "MFI"] },
];

// The value an indicator shows at candle i of a window (for the hold-to-read card and the legend).
export function valueAt(code, ov, i) {
  const st = OVERLAYS[code] || PANELS[code]; if (!st) return null;
  const k = st.fill ? st.lines[1][0] : st.hist || st.lines?.[0]?.[0] || st.dots || st.trend || (st.vol ? "volRatio" : null);
  const v = k ? ov[k]?.[i] : null;
  return v == null || !isFinite(v) ? null : v;
}
export const tagOf = (code) => OVERLAYS[code]?.tag || PANELS[code]?.label?.replace(/ %$| % of price$| \(yearly %\)$/, "") || code;

// One plain fact about what a panel has done in this view: how long it has been above or below a level, or
// above or below its partner line. Past only, never a signal.
const LINE_NAME = { macd: "the MACD line", macdSignal: "its signal line", stochK: "%K", stochD: "%D", plusDI: "+DI", minusDI: "−DI", aroonUp: "Aroon up", aroonDown: "Aroon down" };
export function panelFact(code, ov, win) {
  const P = PANELS[code], n = win.length; if (!P || n < 3) return "";
  const gap = n > 1 ? (Date.parse(win[n - 1].t.slice(0, 10)) - Date.parse(win[n - 2].t.slice(0, 10))) / 864e5 : 1;
  const unit = win[0].t.length > 10 ? "candles" : gap >= 6 ? "weeks" : "days";
  const run = (test) => { let k = 0; for (let i = n - 1; i >= 0 && test(i); i--) k++; return k; };
  const span = (k) => (k >= n ? "for this whole view" : `for the last ${k} ${k === 1 ? unit.replace(/s$/, "") : unit}`);
  if (P.vol) { const v = ov.volRatio?.[n - 1]; let mx = 0, mi = 0; win.forEach((b, i) => { if ((b.v || 0) > (win[mx].v || 0)) mx = i; }); return `Busiest candle in this view: ${win[mx].t.slice(0, 10)}${v != null ? `. The latest is ${v.toFixed(1)}× the usual volume.` : "."}`; }
  if ((P.lines || []).length >= 2 && !P.refs?.length || code === "MACD" || code === "STOCH" || code === "ADX" || code === "AROON") {
    const [a, b] = code === "ADX" ? ["plusDI", "minusDI"] : [P.lines[0][0], P.lines[1][0]];
    const A = ov[a], B = ov[b];
    if (A?.[n - 1] != null && B?.[n - 1] != null) {
      const above = A[n - 1] >= B[n - 1], k = run((i) => A[i] != null && B[i] != null && (A[i] >= B[i]) === above);
      return `${cap(LINE_NAME[a] || a)} has been ${above ? "above" : "below"} ${LINE_NAME[b] || b} ${span(k)}.`;
    }
  }
  const key = P.hist || P.lines[0][0], s = ov[key] || [], last = s[n - 1];
  if (last == null) return "";
  if (P.refs?.length >= 2) {
    const [lo, hi] = [Math.min(...P.refs), Math.max(...P.refs)], zone = (x) => (x > hi ? 1 : x < lo ? -1 : 0), z = zone(last);
    const k = run((i) => s[i] != null && zone(s[i]) === z);
    return `${z === 1 ? `Above ${hi}` : z === -1 ? `Below ${lo}` : `Between ${lo} and ${hi}`} ${span(k)}.`;
  }
  if (P.zero) { const pos = last >= 0, k = run((i) => s[i] != null && (s[i] >= 0) === pos); return `${pos ? "Above" : "Below"} zero ${span(k)}.`; }
  if (P.refs?.length === 1) { const r = P.refs[0], pos = last >= r, k = run((i) => s[i] != null && (s[i] >= r) === pos); return `${pos ? "Above" : "Below"} ${r} ${span(k)}.`; }
  const vals = s.filter((x) => x != null), mx = Math.max(...vals), mn = Math.min(...vals), avg = vals.reduce((x, y) => x + y, 0) / vals.length;
  if (last >= mx) return "At its highest in this view.";
  if (last <= mn) return "At its lowest in this view.";
  return `${Math.abs(((last - avg) / (Math.abs(avg) || 1)) * 100).toFixed(0)}% ${last >= avg ? "above" : "below"} its average in this view.`;
}
const cap = (x) => x[0].toUpperCase() + x.slice(1);
