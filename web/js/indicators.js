// Indicator engine. Plain ES module with no dependencies, shared by the browser and the Node data pipeline.
// Input: daily bars [{t: 'YYYY-MM-DD', o, h, l, c, v}] oldest first. Output: readings for the latest bar and the bar before.

const last = (a) => a[a.length - 1];

export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i === n - 1) prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
    else if (i >= n) prev = values[i] * k + prev * (1 - k);
    if (i >= n - 1) out[i] = prev;
  }
  return out;
}

// Wilder's smoothing, as charting platforms use for RSI, ATR and ADX.
function wilder(values, n) {
  const out = new Array(values.length).fill(null);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    if (prev == null) {
      const start = i - n + 1;
      if (start < 0 || values.slice(start, i + 1).some((v) => v == null)) continue;
      prev = values.slice(start, i + 1).reduce((a, b) => a + b, 0) / n;
    } else prev = (prev * (n - 1) + values[i]) / n;
    out[i] = prev;
  }
  return out;
}

export function rsi(closes, n = 14) {
  const gains = [null], losses = [null];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  const ag = wilder(gains, n), al = wilder(losses, n);
  return closes.map((_, i) => (ag[i] == null ? null : al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i])));
}

function trueRange(bars) {
  return bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))));
}

export function atr(bars, n = 14) {
  return wilder(trueRange(bars), n);
}

export function adx(bars, n = 14) {
  const plus = [null], minus = [null];
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].h - bars[i - 1].h, down = bars[i - 1].l - bars[i].l;
    plus.push(up > down && up > 0 ? up : 0);
    minus.push(down > up && down > 0 ? down : 0);
  }
  const tr = trueRange(bars); tr[0] = null;
  const str = wilder(tr, n), sp = wilder(plus, n), sm = wilder(minus, n);
  const dx = bars.map((_, i) => {
    if (str[i] == null || !str[i]) return null;
    const pdi = (100 * sp[i]) / str[i], mdi = (100 * sm[i]) / str[i];
    return pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
  });
  return wilder(dx, n);
}

function rollingExtreme(values, n, fn) {
  return values.map((_, i) => (i < n - 1 ? null : fn(...values.slice(i - n + 1, i + 1))));
}

export function stochK(bars, n = 14) {
  const hh = rollingExtreme(bars.map((b) => b.h), n, Math.max), ll = rollingExtreme(bars.map((b) => b.l), n, Math.min);
  return bars.map((b, i) => (hh[i] == null ? null : hh[i] === ll[i] ? 50 : (100 * (b.c - ll[i])) / (hh[i] - ll[i])));
}

export function williamsR(bars, n = 14) {
  return stochK(bars, n).map((k) => (k == null ? null : k - 100));
}

export function cci(bars, n = 20) {
  const tp = bars.map((b) => (b.h + b.l + b.c) / 3), m = sma(tp, n);
  return tp.map((v, i) => {
    if (m[i] == null) return null;
    const win = tp.slice(i - n + 1, i + 1), md = win.reduce((a, x) => a + Math.abs(x - m[i]), 0) / n;
    return md === 0 ? 0 : (v - m[i]) / (0.015 * md);
  });
}

export function roc(closes, n = 12) {
  return closes.map((c, i) => (i < n ? null : ((c - closes[i - n]) / closes[i - n]) * 100));
}

// Every reading the app can show or alert on. key → {label, unit, digits}.
export const METRICS = {
  price: { label: "Price", digits: 4 },
  changePct: { label: "Day change", unit: "%", digits: 2 },
  sma20: { label: "20-day average", digits: 4 },
  sma50: { label: "50-day average", digits: 4 },
  ema20: { label: "20-day exponential average", digits: 4 },
  distSma20Pct: { label: "Price vs 20-day average", unit: "%", digits: 2 },
  distSma50Pct: { label: "Price vs 50-day average", unit: "%", digits: 2 },
  rsi14: { label: "RSI (14)", digits: 1 },
  macd: { label: "MACD line", digits: 4 },
  macdSignal: { label: "MACD signal", digits: 4 },
  macdHist: { label: "MACD histogram", digits: 4 },
  pctB: { label: "Bollinger %B", digits: 2 },
  high50: { label: "50-day high", digits: 4 },
  low50: { label: "50-day low", digits: 4 },
  distHigh50Pct: { label: "Price vs 50-day high", unit: "%", digits: 2 },
  volRatio: { label: "Volume vs 20-day average", unit: "x", digits: 2 },
  atr14: { label: "ATR (14)", digits: 4 },
  atrPct: { label: "ATR as % of price", unit: "%", digits: 2 },
  stochK: { label: "Stochastic %K (14)", digits: 1 },
  willR: { label: "Williams %R (14)", digits: 1 },
  cci20: { label: "CCI (20)", digits: 0 },
  adx14: { label: "ADX (14)", digits: 1 },
  roc12: { label: "Rate of change (12)", unit: "%", digits: 2 },
};

// Readings for the bar at index i of precomputed series.
function readingAt(s, i) {
  const r = {};
  for (const k of Object.keys(s)) r[k] = s[k][i] ?? null;
  const p = r.price;
  const pct = (a, b) => (a == null || b == null || !b ? null : ((a - b) / b) * 100);
  r.distSma20Pct = pct(p, r.sma20);
  r.distSma50Pct = pct(p, r.sma50);
  r.distHigh50Pct = pct(p, r.high50);
  r.atrPct = r.atr14 == null || !p ? null : (r.atr14 / p) * 100;
  return r;
}

// Every series for a run of bars, oldest first (used by charts and by compute()).
export function buildSeries(bars) {
  const c = bars.map((b) => b.c), v = bars.map((b) => b.v || 0);
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const macdLine = c.map((_, i) => (e12[i] == null || e26[i] == null ? null : e12[i] - e26[i]));
  const firstMacd = macdLine.findIndex((x) => x != null);
  const sig = new Array(c.length).fill(null);
  if (firstMacd >= 0) ema(macdLine.slice(firstMacd), 9).forEach((x, j) => (sig[firstMacd + j] = x));
  const m20 = sma(c, 20);
  const sd20 = c.map((_, i) => (m20[i] == null ? null : Math.sqrt(c.slice(i - 19, i + 1).reduce((a, x) => a + (x - m20[i]) ** 2, 0) / 20)));
  const vAvg = sma(v, 20);
  const s = {
    price: c,
    changePct: c.map((x, i) => (i === 0 ? null : ((x - c[i - 1]) / c[i - 1]) * 100)),
    sma20: m20,
    sma50: sma(c, 50),
    ema20: ema(c, 20),
    rsi14: rsi(c, 14),
    macd: macdLine,
    macdSignal: sig,
    macdHist: macdLine.map((x, i) => (x == null || sig[i] == null ? null : x - sig[i])),
    pctB: c.map((x, i) => (sd20[i] ? (x - (m20[i] - 2 * sd20[i])) / (4 * sd20[i]) : null)),
    high50: rollingExtreme(bars.map((b) => b.h), 50, Math.max),
    low50: rollingExtreme(bars.map((b) => b.l), 50, Math.min),
    volRatio: v.map((x, i) => (i < 20 || !vAvg[i - 1] ? null : x / vAvg[i - 1])),
    atr14: atr(bars, 14),
    stochK: stochK(bars, 14),
    willR: williamsR(bars, 14),
    cci20: cci(bars, 20),
    adx14: adx(bars, 14),
    roc12: roc(c, 12),
  };
  s.ema50 = ema(c, 50); s.sma200 = sma(c, 200); s.bbUpper = m20.map((m, i) => (m == null ? null : m + 2 * sd20[i])); s.bbLower = m20.map((m, i) => (m == null ? null : m - 2 * sd20[i]));
  return s;
}

export function compute(bars) {
  if (!bars || bars.length < 2) return null;
  const s = buildSeries(bars);
  const n = bars.length;
  return { bar: last(bars).t, now: readingAt(s, n - 1), prev: readingAt(s, n - 2) };
}

// Rule check. op: above | below | crossAbove | crossBelow.
export function ruleMet(rule, now, prev) {
  const a = now?.[rule.metric], b = prev?.[rule.metric], x = Number(rule.value);
  if (a == null || !isFinite(x)) return false;
  if (rule.op === "above") return a > x;
  if (rule.op === "below") return a < x;
  if (b == null) return false;
  if (rule.op === "crossAbove") return b <= x && a > x;
  if (rule.op === "crossBelow") return b >= x && a < x;
  return false;
}

export const OPS = { above: "is above", below: "is below", crossAbove: "crosses above", crossBelow: "crosses below" };

export function fmt(x, digits = 2) {
  if (x == null || !isFinite(x)) return "–";
  const a = Math.abs(x);
  const d = digits >= 4 ? (a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 4) : digits;
  return x.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Weekly candles from daily ones, weeks starting Monday.
export function toWeekly(bars) {
  const out = [];
  for (const b of bars) {
    const d = new Date(b.t + "T00:00:00Z"), dow = (d.getUTCDay() + 6) % 7;
    const wk = new Date(d.getTime() - dow * 864e5).toISOString().slice(0, 10);
    const w = out[out.length - 1];
    if (w && w.t === wk) { w.h = Math.max(w.h, b.h); w.l = Math.min(w.l, b.l); w.c = b.c; w.v += b.v || 0; }
    else out.push({ t: wk, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 });
  }
  return out;
}
