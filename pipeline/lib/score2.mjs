// Pulse score v2 (server only). One account's scored results in, the stored score fields out. No dependencies.
import { HORIZONS, BANDS, bandOf } from "../../web/js/score.js";

export const SETTINGS = {
  BAND: 0.25, // "No change" is right within this many typical moves
  DUR_K: 0.31405, // duration weight 1 + DUR_K·√days
  MEMORY: 720, // duration-weighted calls after which a call counts half
  PRIOR: 160, // evidence needed before the score follows the average fully
  FLAG_SHARE: 0.7, // share of calls matching one simple rule that flags it
  VOL_FLOOR: 0.002, MAX_MOVE: 6, // as v1 (MAX_MOVE is checked when the call is made, not here)
  TOP: 750, TOP_SPAN: 50, // memory doubles from 750 to 800
  CHANCE: 550, PROVEN: 650, FLOOR_N: 0.05, // FLOOR_N: smallest size used for the simple rules
  ALPHA: { lo90: 0.10, lo975: 0.025, hi90: 0.10 },
  SOFT: { hi: 800, lo: 400, scale: 100 }, MIN: 301, MAX: 899, PROVISIONAL_UNDER: 10,
};
export const RULES = ["always up", "always down", "always no change", "follows yesterday", "fades yesterday", "follows 90-day trend", "fades 90-day trend"];
export { BANDS, bandOf }; // one set of bands for the app and the job (web/js/score.js)

const S = SETTINGS, DAY = 864e5, MONTH = 30.4 * DAY;
const pos = (x) => typeof x === "number" && isFinite(x) && x > 0;
const fin = (x) => typeof x === "number" && isFinite(x);
const sg = (x) => (x === 1 || x === -1 ? x : 0);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const marketOf = (coin) => { const s = String(coin ?? ""), i = s.indexOf(":"); return i > 0 ? s.slice(0, i) : "CRYPTO"; };

// One stored result → { z, c, dir, days, day, at, prev, tr90 }, or null if it can't be scored.
export function callOf(r) {
  if (!r || r.status !== "scored") return null;
  const H = HORIZONS[r.horizon], { p0, target, actual } = r;
  const made = Date.parse(r.createdAt), at = Date.parse(r.resolvedAt);
  if (!H || !pos(p0) || !pos(target) || !pos(actual) || !fin(made) || !fin(at)) return null;
  const days = H.days, m = Math.max(fin(r.sigmaD) ? r.sigmaD : 0, S.VOL_FLOOR) * Math.sqrt(days);
  const z = Math.log(actual / p0) / m;
  let c = Math.log(target / p0) / m;
  const dir = Math.sign(target - (pos(r.clientP0) ? r.clientP0 : p0)); // 0 = "No change"
  if (dir !== 0 && Math.sign(c) !== dir) c = 0; // passed the target before the start price locked
  return { z, c, dir, days, day: new Date(made).toISOString().slice(0, 10), at, prev: sg(r.prev), tr90: sg(r.tr90) };
}

// Points for one call (z: real move, c: call, both in typical moves; dir: the direction chosen).
export const points = (z, c, dir) => (dir === 0 ? (Math.abs(z) <= S.BAND ? 1 : -1) : dir * Math.sign(z) + Math.abs(z) - Math.abs(z - c));

const usable = (q) => q && fin(q.z) && fin(q.c) && fin(q.days) && q.days > 0 && fin(q.at) && [-1, 0, 1].includes(q.dir);
const tOf = (neff, a) => Math.sqrt((1 + 100 / neff) * (Math.log(1 + neff / 100) + 2 * Math.log(1 / a)));
// Day-grouped standard error of the weighted mean m (Infinity with fewer than 2 days).
function seOf(xs, w, s, m, W) {
  const G = new Map(); xs.forEach((q, i) => G.set(q.day, (G.get(q.day) || 0) + w[i] * (s[i] - m)));
  let v = 0; for (const a of G.values()) v += a * a;
  return G.size > 1 ? Math.sqrt((v * G.size) / (G.size - 1)) / W : Infinity;
}

// The record over normalized calls. `patterns: false` skips the pattern removal (tests only).
export function assess(calls, { memory = S.MEMORY, patterns = true } = {}) {
  const xs = (calls || []).filter(usable), n = xs.length;
  if (!n) return null;
  const dw = xs.map((q) => 1 + S.DUR_K * Math.sqrt(q.days)), Wn = dw.reduce((a, v) => a + v, 0);
  const ord = xs.map((_, i) => i).sort((a, b) => xs[a].at - xs[b].at || a - b);
  const cum = new Float64Array(n); let acc = 0; for (const i of ord) cum[i] = acc += dw[i];
  // memory weights, then up and down moves rebalanced to half each (left alone while one side is empty)
  const weigh = (H) => {
    const w = dw.map((d, i) => d * 0.5 ** ((Wn - cum[i]) / H));
    let U = 0, D = 0; xs.forEach((q, i) => (q.z > 0 ? (U += w[i]) : (D += w[i])));
    if (U > 0 && D > 0) xs.forEach((q, i) => (w[i] *= (U + D) / 2 / (q.z > 0 ? U : D)));
    return w;
  };
  const wmean = (w, v) => v.reduce((a, x, i) => a + w[i] * x, 0) / w.reduce((a, x) => a + x, 0);
  let s = xs.map((q) => points(q.z, q.c, q.dir)), w = weigh(memory);
  const lvl0 = S.CHANCE + (1000 * wmean(w, s) * Wn) / (Wn + S.PRIOR);
  if (lvl0 > S.TOP) w = weigh(memory * (1 + Math.min(1, (lvl0 - S.TOP) / S.TOP_SPAN))); // calls move the score less at the top
  const W = w.reduce((a, v) => a + v, 0), mean = wmean(w, s);
  let m = mean;
  // simple rules the calls could be copied from: take out the best one's share, flag the closest match
  const sr = RULES.map(() => new Float64Array(n)), match = RULES.map(() => 0);
  xs.forEach((q, i) => {
    const sz = Math.max(Math.abs(q.c), S.FLOOR_N), ys = q.prev || 1, tr = q.tr90 || 1;
    [sz, -sz, 0, ys * sz, -ys * sz, tr * sz, -tr * sz].forEach((rc, r) => {
      const dr = Math.sign(rc); sr[r][i] = points(q.z, rc, dr); if (dr === q.dir) match[r] += w[i];
    });
  });
  let best = { gain: 0, r: -1, beta: 0 }, flag = { share: 0, r: -1 };
  for (let r = 0; r < RULES.length; r++) {
    const mr = wmean(w, sr[r]); let cov = 0, vr = 0;
    for (let i = 0; i < n; i++) { cov += w[i] * (s[i] - m) * (sr[r][i] - mr); vr += w[i] * (sr[r][i] - mr) ** 2; }
    const beta = vr > 1e-12 * W ? clamp(cov / vr, 0, 1) : 0; // a rule that scores the same every time explains nothing
    if (beta * mr > best.gain) best = { gain: beta * mr, r, beta };
    if (match[r] / W > flag.share) flag = { share: match[r] / W, r };
  }
  let origSe = 0;
  if (patterns && best.gain > 0) {
    origSe = seOf(xs, w, s, m, W);
    s = s.map((v, i) => v - best.beta * sr[best.r][i]); m = wmean(w, s);
  }
  // proof lines: a day's calls count as one piece of evidence; always valid, however often the score is checked
  const G = new Map(); xs.forEach((q, i) => { const g = G.get(q.day) || [0, 0]; g[0] += w[i] * (s[i] - m); g[1] += w[i]; G.set(q.day, g); });
  let lo90 = -Infinity, lo975 = -Infinity, hi90 = Infinity, se = Infinity, neff = 0;
  if (G.size >= 3) {
    let v = 0, w2 = 0; for (const [a, wg] of G.values()) { v += a * a; w2 += wg * wg; }
    se = Math.max(Math.sqrt((v * G.size) / (G.size - 1)) / W, origSe); // removing a pattern never makes a record look more certain
    neff = (W * W) / w2;
    lo90 = m - tOf(neff, S.ALPHA.lo90) * se; lo975 = m - tOf(neff, S.ALPHA.lo975) * se; hi90 = m + tOf(neff, S.ALPHA.hi90) * se;
  }
  const ats = xs.map((q) => q.at), months = (Math.max(...ats) - Math.min(...ats)) / MONTH;
  return {
    est: S.CHANCE + (1000 * m * Wn) / (Wn + S.PRIOR), m, mean, lo90, lo975, hi90, se, neff, groups: G.size, months, n, Wn, W,
    flag: flag.share >= S.FLAG_SHARE ? RULES[flag.r] : null, flagShare: flag.share,
    removed: patterns && best.gain > 0 ? { rule: RULES[best.r], beta: best.beta } : null,
  };
}

// The shown number from an assessment: { score, band, held }.
export function shown(a) {
  if (!a) return null;
  const P = S.PROVEN, k = (x) => 1000 * Math.max(0, fin(x) ? x : 0);
  let sc = fin(a.est) ? Math.min(a.est, P + k(a.lo90)) : S.CHANCE;
  if (sc > S.TOP) sc = Math.max(S.TOP, Math.min(sc, P + k(a.lo975)));
  const mo = fin(a.months) ? a.months : 0; // experience ceiling: 700 to 3 months, 750 at 6, +50 per 6 months
  sc = Math.min(sc, mo < 3 ? 700 : mo < 6 ? 700 + ((mo - 3) * 50) / 3 : 750 + ((mo - 6) * 50) / 6);
  if (sc < S.CHANCE) sc = Math.max(sc, a.hi90 < 0 && a.n >= S.PROVISIONAL_UNDER ? S.CHANCE + 1000 * a.hi90 : S.CHANCE); // below 550 only with proof, never while provisional
  const held = a.est > P && a.est - sc >= 5;
  const { hi, lo, scale } = S.SOFT; // soft ends: approached, never reached
  if (sc > hi) sc = hi + scale * (1 - Math.exp(-(sc - hi) / scale));
  if (sc < lo) sc = lo - scale * (1 - Math.exp(-(lo - sc) / scale));
  const score = clamp(Math.round(sc), S.MIN, S.MAX);
  return { score, band: bandOf(score), held };
}

// What the job stores in accounts/{acct}.pscore, or null when there is nothing to score.
export function scoreRecord(results, { market = "CRYPTO", now = Date.now() } = {}) {
  const rows = (Array.isArray(results) ? results : []).filter((r) => r && marketOf(r.coin) === market)
    .map((r) => ({ q: callOf(r), k: [Date.parse(r.createdAt), String(r.coin ?? ""), String(r.horizon ?? "")] })).filter((x) => x.q);
  const cmp = (a, b) => { if (a.q.at !== b.q.at) return a.q.at - b.q.at; for (let i = 0; i < 3; i++) if (a.k[i] !== b.k[i]) return a.k[i] < b.k[i] ? -1 : 1; return 0; };
  const a = assess(rows.sort(cmp).map((x) => x.q)); // sorted, so the order results are listed in never matters
  if (!a) return null;
  const { score, band, held } = shown(a);
  return { score, band, n: a.n, provisional: a.n < S.PROVISIONAL_UNDER, at: new Date(now).toISOString(), v: 2, market, flag: a.n >= S.PROVISIONAL_UNDER ? a.flag : null, held }; // no pattern is named on a handful of calls
}
