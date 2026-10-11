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


// ---- More indicators, each reduced to one daily reading people can read at a glance.
// EMA that tolerates leading nulls (for smoothing a series that starts late).
function emaL(values, n) {
  const out = new Array(values.length).fill(null), first = values.findIndex((x) => x != null);
  if (first < 0) return out;
  ema(values.slice(first).map((x) => x ?? 0), n).forEach((x, j) => (out[first + j] = x));
  return out;
}
const sumW = (a, i, n) => { let t = 0; for (let j = i - n + 1; j <= i; j++) t += a[j]; return t; };
const distPct = (c, line) => c.map((x, i) => (line[i] == null || !line[i] ? null : ((x - line[i]) / line[i]) * 100));
// change of a cumulative volume line over n days, as a share of all volume traded in those days
const flowShare = (line, v, n) => line.map((x, i) => { if (i < n) return null; const tv = sumW(v, i, n); return tv ? ((x - line[i - n]) / tv) * 100 : null; });
function wma(values, n) {
  const d = (n * (n + 1)) / 2;
  return values.map((_, i) => { if (i < n - 1) return null; let t = 0; for (let j = 0; j < n; j++) { const x = values[i - n + 1 + j]; if (x == null) return null; t += x * (j + 1); } return t / d; });
}
function psar(bars, step = 0.02, maxStep = 0.2) {
  const out = new Array(bars.length).fill(null); if (bars.length < 3) return out;
  let up = bars[1].c >= bars[0].c, sar = up ? bars[0].l : bars[0].h, ep = up ? bars[1].h : bars[1].l, af = step;
  for (let i = 1; i < bars.length; i++) {
    sar = sar + af * (ep - sar);
    const b = bars[i], p = bars[i - 1], p2 = bars[Math.max(0, i - 2)];
    if (up) {
      sar = Math.min(sar, p.l, p2.l);
      if (b.l < sar) { up = false; sar = ep; ep = b.l; af = step; }
      else if (b.h > ep) { ep = b.h; af = Math.min(maxStep, af + step); }
    } else {
      sar = Math.max(sar, p.h, p2.h);
      if (b.h > sar) { up = true; sar = ep; ep = b.h; af = step; }
      else if (b.l < ep) { ep = b.l; af = Math.min(maxStep, af + step); }
    }
    out[i] = sar;
  }
  return out;
}
function supertrend(bars, n = 10, mult = 3) {
  const a = atr(bars, n), line = new Array(bars.length).fill(null);
  let fu = null, fl = null, dirUp = true;
  for (let i = 0; i < bars.length; i++) {
    if (a[i] == null) continue;
    const mid = (bars[i].h + bars[i].l) / 2, bu = mid + mult * a[i], bl = mid - mult * a[i], pc = bars[i - 1]?.c;
    fu = fu == null || bu < fu || pc > fu ? bu : fu;
    fl = fl == null || bl > fl || pc < fl ? bl : fl;
    if (dirUp && bars[i].c < fl) dirUp = false; else if (!dirUp && bars[i].c > fu) dirUp = true;
    line[i] = dirUp ? fl : fu;
  }
  return line;
}
function extraSeries(bars, c, v) {
  const n = bars.length, h = bars.map((b) => b.h), l = bars.map((b) => b.l);
  const R = {};
  // volume flow
  const obv = [0]; for (let i = 1; i < n; i++) obv.push(obv[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0));
  R.obvFlow20 = flowShare(obv, v, 20);
  const mfm = bars.map((b) => (b.h === b.l ? 0 : ((b.c - b.l) - (b.h - b.c)) / (b.h - b.l))), mfv = mfm.map((m, i) => m * v[i]);
  const ad = []; mfv.forEach((x, i) => ad.push((ad[i - 1] || 0) + x));
  R.adFlow20 = flowShare(ad, v, 20);
  R.cmf20 = c.map((_, i) => { if (i < 19) return null; const tv = sumW(v, i, 20); return tv ? sumW(mfv, i, 20) / tv : null; });
  const tp = bars.map((b) => (b.h + b.l + b.c) / 3), rmf = tp.map((x, i) => x * v[i]);
  R.mfi14 = c.map((_, i) => { if (i < 14) return null; let pos = 0, neg = 0; for (let j = i - 13; j <= i; j++) { if (tp[j] > tp[j - 1]) pos += rmf[j]; else if (tp[j] < tp[j - 1]) neg += rmf[j]; } return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg); });
  // momentum
  const r = rsi(c, 14), rh = rollingExtreme(r.map((x) => x ?? -Infinity), 14, Math.max), rl = rollingExtreme(r.map((x) => x ?? Infinity), 14, Math.min);
  R.stochRsi = r.map((x, i) => (x == null || i < 27 || !isFinite(rh[i]) || !isFinite(rl[i]) ? null : rh[i] === rl[i] ? 50 : ((x - rl[i]) / (rh[i] - rl[i])) * 100));
  R.mom10 = c.map((x, i) => (i < 10 ? null : ((x - c[i - 10]) / c[i - 10]) * 100));
  R.cmo14 = c.map((_, i) => { if (i < 14) return null; let up = 0, dn = 0; for (let j = i - 13; j <= i; j++) { const d = c[j] - c[j - 1]; if (d > 0) up += d; else dn -= d; } return up + dn === 0 ? 0 : (100 * (up - dn)) / (up + dn); });
  const med = bars.map((b) => (b.h + b.l) / 2), m5 = sma(med, 5), m34 = sma(med, 34);
  R.aoPct = c.map((x, i) => (m34[i] == null ? null : ((m5[i] - m34[i]) / x) * 100));
  const e1 = ema(c, 15), e2 = emaL(e1, 15), e3 = emaL(e2, 15);
  R.trix15 = e3.map((x, i) => (x == null || e3[i - 1] == null ? null : ((x - e3[i - 1]) / e3[i - 1]) * 100));
  const bp = bars.map((b, i) => (i === 0 ? null : b.c - Math.min(b.l, bars[i - 1].c))), trr = bars.map((b, i) => (i === 0 ? null : Math.max(b.h, bars[i - 1].c) - Math.min(b.l, bars[i - 1].c)));
  const avgBP = (i, k) => { let a = 0, t = 0; for (let j = i - k + 1; j <= i; j++) { a += bp[j]; t += trr[j]; } return t ? a / t : 0; };
  R.uo = c.map((_, i) => (i < 28 ? null : (100 * (4 * avgBP(i, 7) + 2 * avgBP(i, 14) + avgBP(i, 28))) / 7));
  const rc = (k) => c.map((x, i) => (i < k ? null : ((x - c[i - k]) / c[i - k]) * 100)), sm = (a, k) => a.map((_, i) => { if (i < k - 1 || a.slice(i - k + 1, i + 1).some((x) => x == null)) return null; return a.slice(i - k + 1, i + 1).reduce((s, x) => s + x, 0) / k; });
  const k1 = sm(rc(10), 10), k2 = sm(rc(15), 10), k3 = sm(rc(20), 10), k4 = sm(rc(30), 15);
  R.kst = c.map((_, i) => (k4[i] == null ? null : k1[i] + 2 * k2[i] + 3 * k3[i] + 4 * k4[i]));
  // trend
  const e20 = ema(c, 20), d20 = emaL(e20, 20), t20 = emaL(d20, 20);
  R.demaDist = distPct(c, e20.map((x, i) => (d20[i] == null ? null : 2 * x - d20[i])));
  R.temaDist = distPct(c, e20.map((x, i) => (t20[i] == null ? null : 3 * x - 3 * d20[i] + t20[i])));
  const w10 = wma(c, 10), w20 = wma(c, 20);
  R.hmaDist = distPct(c, wma(c.map((_, i) => (w20[i] == null ? null : 2 * w10[i] - w20[i])), 4));
  R.sarDist = distPct(c, psar(bars));
  R.stDist = distPct(c, supertrend(bars));
  const hh25 = rollingExtreme(h, 26, Math.max), ll25 = rollingExtreme(l, 26, Math.min);
  const since = (arr, i, x) => { for (let j = i; j >= i - 25; j--) if (arr[j] === x) return i - j; return 25; };
  R.aroonOsc = c.map((_, i) => (hh25[i] == null ? null : (100 * (25 - since(h, i, hh25[i]))) / 25 - (100 * (25 - since(l, i, ll25[i]))) / 25));
  const trv = trueRange(bars);
  R.vortex = c.map((_, i) => { if (i < 14) return null; let vp = 0, vm = 0, t = 0; for (let j = i - 13; j <= i; j++) { vp += Math.abs(h[j] - l[j - 1]); vm += Math.abs(l[j] - h[j - 1]); t += trv[j]; } return t ? (vp - vm) / t : null; });
  const e13 = ema(c, 13);
  R.elderBull = bars.map((b, i) => (e13[i] == null ? null : ((b.h - e13[i]) / b.c) * 100));
  R.elderBear = bars.map((b, i) => (e13[i] == null ? null : ((b.l - e13[i]) / b.c) * 100));
  // Ichimoku: today's cloud was drawn 26 days ago from the 9/26 and 52-day midpoints
  const mid = (k) => { const hi = rollingExtreme(h, k, Math.max), lo = rollingExtreme(l, k, Math.min); return hi.map((x, i) => (x == null ? null : (x + lo[i]) / 2)); };
  const ten = mid(9), kij = mid(26), sb = mid(52);
  R.ichiCloud = c.map((x, i) => {
    const j = i - 26; if (j < 0 || kij[j] == null || sb[j] == null) return null;
    const a = (ten[j] + kij[j]) / 2, top = Math.max(a, sb[j]), bot = Math.min(a, sb[j]);
    return x > top ? ((x - top) / top) * 100 : x < bot ? ((x - bot) / bot) * 100 : 0;
  });
  // channels and volatility
  const a10 = atr(bars, 10), k20 = ema(c, 20);
  R.keltPos = c.map((x, i) => (a10[i] == null || k20[i] == null ? null : ((x - (k20[i] - 2 * a10[i])) / (4 * a10[i])) * 100));
  const dh = rollingExtreme(h, 20, Math.max), dl = rollingExtreme(l, 20, Math.min);
  R.donPos = c.map((x, i) => (dh[i] == null ? null : dh[i] === dl[i] ? 50 : ((x - dl[i]) / (dh[i] - dl[i])) * 100));
  const lr = c.map((x, i) => (i === 0 ? null : Math.log(x / c[i - 1])));
  R.hv20 = c.map((_, i) => { if (i < 20) return null; const w = lr.slice(i - 19, i + 1), m = w.reduce((s, x) => s + x, 0) / 20; return Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / 19) * Math.sqrt(365) * 100; });
  return R;
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
  obvFlow20: { label: "On-balance volume, 20 days", unit: "%", digits: 1 },
  adFlow20: { label: "Accumulation/distribution, 20 days", unit: "%", digits: 1 },
  cmf20: { label: "Chaikin Money Flow (20)", digits: 2 },
  mfi14: { label: "Money Flow Index (14)", digits: 1 },
  stochRsi: { label: "Stochastic RSI (14)", digits: 1 },
  mom10: { label: "Momentum (10)", unit: "%", digits: 2 },
  cmo14: { label: "Chande Momentum (14)", digits: 1 },
  aoPct: { label: "Awesome Oscillator", unit: "%", digits: 2 },
  trix15: { label: "TRIX (15)", unit: "%", digits: 3 },
  uo: { label: "Ultimate Oscillator", digits: 1 },
  kst: { label: "Know Sure Thing", digits: 1 },
  demaDist: { label: "Price vs DEMA (20)", unit: "%", digits: 2 },
  temaDist: { label: "Price vs TEMA (20)", unit: "%", digits: 2 },
  hmaDist: { label: "Price vs Hull average (20)", unit: "%", digits: 2 },
  sarDist: { label: "Price vs Parabolic SAR", unit: "%", digits: 2 },
  stDist: { label: "Price vs Supertrend (10, 3)", unit: "%", digits: 2 },
  aroonOsc: { label: "Aroon oscillator (25)", digits: 0 },
  vortex: { label: "Vortex VI+ minus VI− (14)", digits: 2 },
  elderBull: { label: "Elder bull power", unit: "%", digits: 2 },
  elderBear: { label: "Elder bear power", unit: "%", digits: 2 },
  ichiCloud: { label: "Price vs Ichimoku cloud", unit: "%", digits: 2 },
  keltPos: { label: "Keltner channel position", unit: "%", digits: 0 },
  donPos: { label: "Donchian channel position (20)", unit: "%", digits: 0 },
  hv20: { label: "Historical volatility (20, yearly)", unit: "%", digits: 1 },
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

export function compute(bars, s) {
  if (!bars || bars.length < 2) return null;
  s = s || buildSeries(bars); // callers that already built the series pass it in to save a second pass
  const n = bars.length;
  // the extra indicators only need their latest readings, so they run on the last 300 bars (plenty for every
  // look-back and for the averages to settle) instead of the whole history
  const tail = bars.slice(-300), ex = extraSeries(tail, tail.map((b) => b.c), tail.map((b) => b.v || 0)), m = tail.length;
  const at = (i, j) => { const r = readingAt(s, i); for (const k in ex) r[k] = ex[k][j] ?? null; return r; };
  return { bar: last(bars).t, now: at(n - 1, m - 1), prev: at(n - 2, m - 2) };
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
