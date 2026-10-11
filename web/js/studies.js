// The indicators people can put on a chart: lines drawn on the price chart ("overlays") and panels below it.
// One shared choice for every coin, picked from the full-screen chart. Each entry says which per-candle series
// it draws, how to scale it, and which reading it adds to the details pane. Descriptive only, never advice.
import { extendedSeries } from "./indicators.js";

const C = { a: "var(--ma1)", b: "var(--ma2)", c: "var(--ma3)", acc: "var(--accent)", up: "var(--up)", down: "var(--down)", mut: "var(--muted)" };

// keys: series to slice for the window. base: true when buildSeries already has them.
export const OVERLAYS = {
  MA20: { name: "Moving average 20", tag: "MA 20", group: "Averages", short: "Average close of the last 20 candles.", lines: [["sma20", C.a]], metric: "distSma20Pct", guide: "ma", base: true },
  MA50: { name: "Moving average 50", tag: "MA 50", group: "Averages", short: "Average close of the last 50 candles.", lines: [["sma50", C.b]], metric: "distSma50Pct", guide: "ma", base: true },
  MA200: { name: "Moving average 200", tag: "MA 200", group: "Averages", short: "Average close of the last 200 candles, the long-run line many people watch.", lines: [["sma200", C.c]], guide: "ma", base: true },
  EMA20: { name: "Exponential average 20", tag: "EMA 20", group: "Averages", short: "Like the 20 average, but recent candles count more.", lines: [["ema20", C.a, "dash"]], metric: "ema20", guide: "ema", base: true },
  EMA50: { name: "Exponential average 50", tag: "EMA 50", group: "Averages", short: "A 50-candle average weighted towards recent candles.", lines: [["ema50", C.b, "dash"]], guide: "ema", base: true },
  BB: { name: "Bollinger Bands (20, 2)", tag: "BB", group: "Bands", short: "A band two standard deviations either side of the 20 average. Wider band, bigger swings.", lines: [["bbUpper", C.acc], ["sma20", C.acc, "dash"], ["bbLower", C.acc]], fill: ["bbUpper", "bbLower"], metric: "pctB", guide: "bb", base: true },
  KC: { name: "Keltner Channels (20, 2)", tag: "KC", group: "Bands", short: "A channel two average daily ranges either side of the 20 exponential average.", lines: [["kcUp", C.b], ["kcMid", C.b, "dash"], ["kcLow", C.b]], fill: ["kcUp", "kcLow"], metric: "keltPos", guide: "keltner" },
  DC: { name: "Donchian Channels (20)", tag: "DC", group: "Bands", short: "The highest high and lowest low of the last 20 candles.", lines: [["dcUp", C.c], ["dcMid", C.c, "dash"], ["dcLow", C.c]], fill: ["dcUp", "dcLow"], metric: "donPos", guide: "donchian" },
  ICHI: { name: "Ichimoku cloud", tag: "Ichimoku", group: "Trend", short: "A cloud built from past highs and lows, with the conversion (9) and base (26) lines.", lines: [["tenkan", C.acc], ["kijun", C.down]], cloud: ["spanA", "spanB"], metric: "ichiCloud", guide: "ichimoku" },
  SAR: { name: "Parabolic SAR", tag: "SAR", group: "Trend", short: "Dots that trail the price and flip sides when it crosses them.", dots: "psar", metric: "sarDist", guide: "psar" },
  ST: { name: "Supertrend (10, 3)", tag: "Supertrend", group: "Trend", short: "A line three average ranges from price: green below it, red above it.", trend: "stLine", metric: "stDist", guide: "supertrend" },
};

// range: fixed [min, max] or null for automatic. refs: dotted reference levels. zero: draw the zero line.
export const PANELS = {
  RSI: { name: "RSI (14)", label: "RSI 14", group: "Momentum", short: "Average gains against average losses over 14 candles, 0 to 100.", lines: [["rsi14", C.acc]], range: [0, 100], refs: [30, 70], band: [30, 70], metric: "rsi14", guide: "rsi", base: true },
  MACD: { name: "MACD (12, 26, 9)", label: "MACD hist", group: "Momentum", short: "The gap between a fast and a slow average, and its signal line.", hist: "macdHist", lines: [["macd", C.acc], ["macdSignal", C.a]], zero: true, sym: true, metric: "macdHist", guide: "macd", base: true },
  VOL: { name: "Volume", label: "Volume", group: "Volume", short: "How much traded in each candle, green when it closed higher than it opened.", vol: true, metric: "volRatio", guide: "volume", base: true },
  STOCH: { name: "Stochastic (14, 3)", label: "Stoch %K", group: "Momentum", short: "Where the close sits in the 14-candle high–low range, with a 3-candle average.", lines: [["stochK", C.acc], ["stochD", C.a]], range: [0, 100], refs: [20, 80], metric: "stochK", guide: "stoch", baseKeys: ["stochK"] },
  STOCHRSI: { name: "Stochastic RSI (14)", label: "Stoch RSI", group: "Momentum", short: "Where RSI sits within its own 14-candle range.", lines: [["stochRsi", C.acc]], range: [0, 100], refs: [20, 80], metric: "stochRsi", guide: "stochrsi" },
  MFI: { name: "Money Flow Index (14)", label: "MFI 14", group: "Volume", short: "A volume-weighted RSI, 0 to 100.", lines: [["mfi14", C.acc]], range: [0, 100], refs: [20, 80], metric: "mfi14", guide: "mfi" },
  CCI: { name: "Commodity Channel Index (20)", label: "CCI 20", group: "Momentum", short: "How far the typical price is from its 20 average, in usual-deviation units.", lines: [["cci20", C.acc]], refs: [-100, 100], zero: true, metric: "cci20", guide: "cci", base: true },
  WILLR: { name: "Williams %R (14)", label: "Williams %R", group: "Momentum", short: "How far the close is below the 14-candle high, 0 to −100.", lines: [["willR", C.acc]], range: [-100, 0], refs: [-80, -20], metric: "willR", guide: "willr", base: true },
  ADX: { name: "ADX and DI (14)", label: "ADX 14", group: "Trend", short: "Trend strength (ADX), with upward (+DI) and downward (−DI) movement.", lines: [["adx14", C.acc], ["plusDI", C.up], ["minusDI", C.down]], range: [0, null], refs: [20, 40], metric: "adx14", guide: "adx", baseKeys: ["adx14"] },
  AROON: { name: "Aroon (25)", label: "Aroon", group: "Trend", short: "How recently the 25-candle high (green) and low (red) were set.", lines: [["aroonUp", C.up], ["aroonDown", C.down]], range: [0, 100], refs: [50], metric: "aroonOsc", guide: "aroon" },
  ATR: { name: "Average True Range (14)", label: "ATR % of price", group: "Volatility", short: "The typical size of a candle's range, as a share of price.", lines: [["atrPctS", C.acc]], range: [0, null], metric: "atrPct", guide: "atr" },
  HV: { name: "Historical volatility (20)", label: "Volatility (yearly %)", group: "Volatility", short: "How much prices swung over 20 days, scaled to a year.", lines: [["hv20", C.acc]], range: [0, null], metric: "hv20", guide: "hv" },
  OBV: { name: "On-Balance Volume", label: "OBV", group: "Volume", short: "Running total of volume: added on up days, taken away on down days.", lines: [["obv", C.acc]], metric: "obvFlow20", guide: "obv" },
  CMF: { name: "Chaikin Money Flow (20)", label: "CMF 20", group: "Volume", short: "Whether closes sat near the highs or lows of their candles, weighted by volume.", hist: "cmf20", zero: true, sym: true, metric: "cmf20", guide: "cmf" },
  ROC: { name: "Rate of change (12)", label: "ROC 12 %", group: "Momentum", short: "Percentage change over the last 12 candles.", lines: [["roc12", C.acc]], zero: true, metric: "roc12", guide: "roc", base: true },
  CMO: { name: "Chande Momentum (14)", label: "CMO 14", group: "Momentum", short: "Up-candle gains minus down-candle losses, −100 to 100.", lines: [["cmo14", C.acc]], range: [-100, 100], refs: [-50, 50], zero: true, metric: "cmo14", guide: "cmo" },
  AO: { name: "Awesome Oscillator", label: "AO % of price", group: "Momentum", short: "The 5 average of each candle's midpoint minus the 34 average.", hist: "aoPct", zero: true, sym: true, metric: "aoPct", guide: "ao" },
  UO: { name: "Ultimate Oscillator", label: "Ultimate", group: "Momentum", short: "Close position blended over 7, 14 and 28 candles, 0 to 100.", lines: [["uo", C.acc]], range: [0, 100], refs: [30, 70], metric: "uo", guide: "ultimate" },
};
export const MAX_OVERLAYS = 4, MAX_PANELS = 4, FEED_PANELS = 2;

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
export function picks(chart) {
  const over = chart?.over || (chart?.mas || []).map((k) => MA_OLD[k]).filter(Boolean);
  const lower = String(chart?.lower ?? "RSI,MACD").split(",").filter((k) => PANELS[k]);
  return { over: over.filter((k) => OVERLAYS[k]), lower };
}
