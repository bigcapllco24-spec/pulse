// Support and resistance lines, drawn the two standard ways chart platforms offer. Both describe past prices
// only: where the chart turned before, or levels worked out from the previous period. Neither is a forecast.
//
// 1. Swing levels ("Support & resistance"): find swing highs and lows (a candle whose high or low is the
//    extreme of the k candles on each side, as TradingView's pivothigh/pivotlow do), group swings that sit
//    within about half a typical candle's range of each other, and keep the levels touched most often and
//    most recently. Levels above the last close are resistance, below are support.
// 2. Pivot points ("Pivot points", Traditional): from the previous period's high, low and close,
//    P = (H + L + C) / 3, R1 = 2P − L, S1 = 2P − H, R2 = P + (H − L), S2 = P − (H − L).
//    Daily charts use the previous month (TradingView's "Auto" for daily charts); weekly charts use the
//    previous year.

const avgRange = (bars) => bars.reduce((s, b) => s + (b.h - b.l), 0) / Math.max(1, bars.length);

export function swingLevels(v, { perSide = 2 } = {}) {
  const all = v.bars, w = v.win.length, n = all.length;
  const look = Math.min(n, w * 2), start = n - look, bars = all.slice(start); // the visible window plus the same again before it
  const k = Math.max(2, Math.min(8, Math.round(w / 18)));
  const swings = [];
  for (let i = k; i < bars.length - k; i++) {
    let hi = true, lo = true;
    for (let j = i - k; j <= i + k; j++) { if (bars[j].h > bars[i].h) hi = false; if (bars[j].l < bars[i].l) lo = false; }
    if (hi) swings.push({ p: bars[i].h, i, t: bars[i].t });
    if (lo) swings.push({ p: bars[i].l, i, t: bars[i].t });
  }
  if (!swings.length) return [];
  const tol = 0.5 * avgRange(bars.slice(-Math.max(14, w)));
  swings.sort((a, b) => a.p - b.p);
  const groups = [];
  for (const s of swings) {
    const g = groups[groups.length - 1];
    if (g && s.p - g.mean <= tol) { g.items.push(s); g.mean = g.items.reduce((x, y) => x + y.p, 0) / g.items.length; }
    else groups.push({ items: [s], mean: s.p });
  }
  const last = all[n - 1].c, winStart = n - w;
  const levels = groups.map((g) => {
    const lastI = Math.max(...g.items.map((x) => x.i)), firstI = Math.min(...g.items.map((x) => x.i));
    const touches = g.items.length, recency = lastI / bars.length;
    return { price: g.mean, touches, score: touches + recency * 1.5, last: bars[lastI].t, from: Math.max(0, start + firstI - winStart) };
  }).filter((l) => l.touches >= 2 || l.score >= 1.8); // two touches, or one recent clear swing
  const pick = (side) => levels.filter((l) => (side === "R" ? l.price > last : l.price < last))
    .sort((a, b) => b.score - a.score).slice(0, perSide).map((l) => ({ ...l, kind: side }));
  return [...pick("R"), ...pick("S")];
}

export function pivotLevels(v) {
  const daily = v.interval !== "1W", all = v.bars, n = all.length, w = v.win.length;
  const period = (t) => (daily ? t.slice(0, 7) : t.slice(0, 4)); // month or year
  const cur = period(all[n - 1].t);
  let end = n - 1; while (end >= 0 && period(all[end].t) === cur) end--;
  if (end < 0) return [];
  const prevKey = period(all[end].t); let s0 = end; while (s0 > 0 && period(all[s0 - 1].t) === prevKey) s0--;
  const prev = all.slice(s0, end + 1);
  const H = Math.max(...prev.map((b) => b.h)), L = Math.min(...prev.map((b) => b.l)), C = prev[prev.length - 1].c;
  const P = (H + L + C) / 3, from = Math.max(0, end + 1 - (n - w));
  return [["R2", P + (H - L)], ["R1", 2 * P - L], ["P", P], ["S1", 2 * P - H], ["S2", P - (H - L)]]
    .map(([kind, price]) => ({ kind, price, from, period: daily ? "previous month" : "previous year" }));
}

export const levelsFor = (v, mode) => (!v || !mode || mode === "off" ? [] : mode === "pivots" ? pivotLevels(v) : swingLevels(v));
