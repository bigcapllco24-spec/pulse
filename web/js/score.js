// Prediction game scoring. Plain ES module with no dependencies, shared by the app (to show scores) and the
// data job (which resolves predictions and writes the scores, so nobody can change their own).
//
// Two scores, kept separate on purpose:
//  1. Prediction score: one prediction on its own. It depends only on how close the call was and on its time
//     period, so two identical predictions always get the same score.
//  2. Profile score (300 to 900): the whole record. It weighs closeness, consistency, skill, direction and breadth
//     across every resolved prediction, so the same new prediction can move two profiles by different amounts.
//
// Every distance is measured in "typical moves" for the coin and the period, not in percent, so a 30-minute call on
// Bitcoin and a 1-year call on Dogecoin are judged on the same footing.
// A prediction is a game entry about a price, never advice or a forecast published by the app.

// ---------- settings (every number the algorithm uses lives here)
// days: length of the period. share: its part of the profile score and its value per prediction.
// k: resolved predictions at which the period carries half its share (confidence = n / (n + k)).
// halfLife: days after a prediction is scored until it counts half as much in the profile.
export const HORIZONS = {
  "30m": { label: "30 minutes", days: 1 / 48, share: 0.10, k: 20, halfLife: 90 },
  "1h": { label: "1 hour", days: 1 / 24, share: 0.15, k: 20, halfLife: 90 },
  "1d": { label: "1 day", days: 1, share: 0.30, k: 10, halfLife: 90 },
  "1y": { label: "1 year", days: 365, share: 0.45, k: 5, halfLife: 365 },
};
export const WEIGHTS = { closeness: 0.40, consistency: 0.25, skill: 0.20, direction: 0.10, breadth: 0.05 };
export const MIN_MOVE = 0.25; // a prediction must call at least a quarter of a typical move up or down
export const MAX_MOVE = 6; // and at most six typical moves, which keeps typos like "$1" out
export const VOL_FLOOR = 0.002; // daily volatility is never treated as lower than 0.2%
export const SHRINK_K = 10; // with few results the profile score is pulled toward chance level
export const PROVISIONAL_UNDER = 10; // "Provisional" until this many predictions have resolved
export const SCORE_MIN = 300, SCORE_MAX = 900;
// Calibration, from simulated players on random-walk prices (tests/score.test.mjs re-checks it): the raw mix of a
// perfect predictor averages 0.93 and a random caller (random direction and size) 0.426. The scale maps those to
// 900 and 550, so 550 means "about chance" and anything below it is worse than guessing.
export const CAL = { raw0: 0.066, raw1: 0.93 }; // raw values that map to 300 and 900
export const CHANCE = 550; // where a random caller lands, and where every new profile starts
export const BANDS = [[800, "Exceptional"], [700, "Very good"], [600, "Good"], [CHANCE, "Fair"], [SCORE_MIN, "Building"]];

const DAY = 864e5;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pos = (x) => typeof x === "number" && isFinite(x) && x > 0;

// ---------- volatility and the size of a typical move
// Daily volatility: standard deviation of daily log returns over the last n daily closes.
export function dailyVol(closes, n = 30) {
  const c = closes.slice(-(n + 1)).filter(pos);
  if (c.length < 3) return null;
  const r = c.slice(1).map((x, i) => Math.log(x / c[i]));
  const m = r.reduce((a, x) => a + x, 0) / r.length;
  return Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1));
}
// How far the price typically travels over a period, as a log move: daily volatility × √days.
export const typicalMove = (sigmaD, horizon) => Math.max(sigmaD || 0, VOL_FLOOR) * Math.sqrt(HORIZONS[horizon].days);
export const targetTime = (createdAt, horizon) => new Date(Date.parse(createdAt) + HORIZONS[horizon].days * DAY).toISOString();

// ---------- making a prediction
// Checks a new prediction before it is saved: a known period, real prices, and a move that is a real call.
export function checkPrediction({ horizon, p0, target, sigmaD }) {
  if (!HORIZONS[horizon]) return { ok: false, error: "Pick 30 minutes, 1 hour, 1 day or 1 year." };
  if (!pos(p0) || !pos(target)) return { ok: false, error: "Enter a price above zero." };
  const moves = Math.abs(Math.log(target / p0)) / typicalMove(sigmaD, horizon);
  if (moves < MIN_MOVE) return { ok: false, moves, error: "That's too close to today's price. Call a move up or down." };
  if (moves > MAX_MOVE) return { ok: false, moves, error: "That's far outside how much this coin moves in that time. Check the price." };
  return { ok: true, moves };
}
// One open prediction per coin per period: a new one can be made once the last one has been scored.
export const canPredict = (predictions, coin, horizon) => !predictions.some((p) => p.coin === coin && p.horizon === horizon && p.actual == null);
// The nearest valid prices either side of today's, for the prediction sheet to show.
export function allowedRange({ horizon, p0, sigmaD }) {
  const m = typicalMove(sigmaD, horizon);
  return { downFrom: p0 * Math.exp(-m * MIN_MOVE), upFrom: p0 * Math.exp(m * MIN_MOVE), lowest: p0 * Math.exp(-m * MAX_MOVE), highest: p0 * Math.exp(m * MAX_MOVE) };
}

// ---------- 1. the prediction score
// p: { horizon, p0 (price when made), target (predicted), actual (price at the end), sigmaD (daily volatility when made) }
// closeness: 100 × e^(−miss), the miss measured in typical moves. Exact = 100, one typical move off ≈ 37.
// score: closeness × the period's value (30 min ×1, 1 h ×1.5, 1 day ×3, 1 year ×4.5), so the most a prediction can
// earn is 100, 150, 300 or 450 points. Skill and direction are recorded for the profile but don't change this score.
export function scorePrediction(p) {
  const H = HORIZONS[p?.horizon];
  if (!H || !pos(p.p0) || !pos(p.target) || !pos(p.actual)) return null;
  const m = typicalMove(p.sigmaD, p.horizon);
  const miss = Math.abs(Math.log(p.target / p.actual)) / m; // how far off, in typical moves
  const missFlat = Math.abs(Math.log(p.p0 / p.actual)) / m; // how far off "no change" would have been
  const called = Math.log(p.target / p.p0), went = Math.log(p.actual / p.p0);
  const closeness = 100 * Math.exp(-miss);
  return {
    miss, missFlat, closeness,
    skill: clamp(missFlat - miss, -2, 2), // > 0 when the call beat guessing today's price
    called: Math.abs(called) / m >= MIN_MOVE,
    direction: went === 0 ? 0.5 : Math.sign(went) === Math.sign(called) ? 1 : 0,
    value: H.share * 10,
    score: Math.round(closeness * H.share * 10),
  };
}

// ---------- 2. the profile score
// predictions: every prediction of one person, each with { coin, horizon, p0, target, sigmaD, createdAt } and, once
// scored, { actual, resolvedAt }. now: when the score is worked out (ms), so old results can fade.
export function profileScore(predictions, now = Date.now()) {
  const done = predictions.map((p) => ({ p, s: p.actual != null ? scorePrediction(p) : null })).filter((x) => x.s);
  const n = done.length;
  const perHorizon = {};
  for (const [h, H] of Object.entries(HORIZONS)) {
    const xs = done.filter((x) => x.p.horizon === h);
    if (!xs.length) continue;
    // a result starts fading when it is scored, not when it was made, so long calls aren't punished for waiting
    // Fading only sets how results weigh against each other: the weights are rescaled to add up to the number of
    // results, so old results don't weaken the evidence behind the direction hit rate.
    const w0 = xs.map((x) => 0.5 ** (Math.max(0, now - Date.parse(x.p.resolvedAt || x.p.createdAt)) / DAY / H.halfLife));
    const w = w0.map((v) => (v * xs.length) / w0.reduce((a, b) => a + b, 0));
    const c = xs.map((x) => x.s.closeness / 100);
    const calls = xs.map((x, i) => [x, w[i]]).filter(([x]) => x.s.called);
    const parts = {
      closeness: wmean(c, w),
      consistency: consistency(c, w),
      // how much closer than "no change" the calls were on average, in typical moves, squeezed into 0 to 1
      skill: 0.5 + 0.5 * Math.tanh(wmean(xs.map((x) => x.s.skill), w)),
      // hit rate on real calls, starting from 2 hits in 4 so one lucky call can't read as 100%
      direction: (calls.reduce((a, [x, wi]) => a + wi * x.s.direction, 0) + 2) / (calls.reduce((a, [, wi]) => a + wi, 0) + 4),
    };
    const sub = (WEIGHTS.closeness * parts.closeness + WEIGHTS.consistency * parts.consistency + WEIGHTS.skill * parts.skill + WEIGHTS.direction * parts.direction) / (1 - WEIGHTS.breadth);
    perHorizon[h] = { n: xs.length, ...parts, sub, confidence: xs.length / (xs.length + H.k) };
  }
  if (!n) return { score: null, band: "No score yet", provisional: true, n: 0, perHorizon, parts: null, breadth: 0 };
  // Periods blend by their share times how much evidence they have, so long periods dominate once they have results.
  const hs = Object.keys(perHorizon), a = hs.map((h) => HORIZONS[h].share * perHorizon[h].confidence), A = a.reduce((x, y) => x + y, 0);
  const blend = (key) => hs.reduce((s, h, i) => s + (a[i] / A) * perHorizon[h][key], 0);
  for (const [h, i] of hs.map((h, i) => [h, i])) perHorizon[h].weight = a[i] / A;
  const b = breadth(done.map((x) => x.p));
  const raw = (1 - WEIGHTS.breadth) * blend("sub") + WEIGHTS.breadth * b;
  // place raw on the calibrated scale, then pull it toward chance level while there are few results
  const scaled = SCORE_MIN + ((SCORE_MAX - SCORE_MIN) * (raw - CAL.raw0)) / (CAL.raw1 - CAL.raw0);
  const shrunk = CHANCE + (scaled - CHANCE) * (n / (n + SHRINK_K));
  const score = Math.round(clamp(shrunk, SCORE_MIN, SCORE_MAX));
  return {
    score, band: BANDS.find(([min]) => score >= min)[1], provisional: n < PROVISIONAL_UNDER, n,
    parts: { closeness: blend("closeness"), consistency: blend("consistency"), skill: blend("skill"), direction: blend("direction"), breadth: b },
    perHorizon, raw,
  };
}
// How one more prediction changes a profile (for "this moved your score by …").
export function scoreChange(predictions, extra, now = Date.now()) {
  const before = profileScore(predictions, now), after = profileScore([...predictions, extra], now);
  return { before: before.score, after: after.score, change: before.score == null ? null : after.score - before.score };
}

// Consistency (0 to 1) from closeness values (0 to 1): reliably close, with no disasters.
//  40% hit rate: share of predictions scoring 50 or more (within about 0.7 typical moves)
//  30% tight spread: 1 minus the gap between the 25th and 75th percentile
//  30% no disasters: the average of the worst 20%
// Needs at least 3 results; until then it sits at the middle (0.5).
export function consistency(c, w = c.map(() => 1)) {
  if (c.length < 3) return 0.5;
  const hit = wmean(c.map((x) => (x >= 0.5 ? 1 : 0)), w);
  const spread = wquantile(c, w, 0.75) - wquantile(c, w, 0.25);
  return 0.4 * hit + 0.3 * (1 - spread) + 0.3 * worstShare(c, w, 0.2);
}
// Breadth (0 to 1): different coins (up to 5), periods played (of 4), and months active (up to 6).
export function breadth(preds) {
  const coins = new Set(preds.map((p) => p.coin)).size, hs = new Set(preds.map((p) => p.horizon)).size;
  const months = new Set(preds.map((p) => String(p.createdAt).slice(0, 7))).size;
  return 0.5 * Math.min(coins / 5, 1) + 0.3 * (hs / Object.keys(HORIZONS).length) + 0.2 * Math.min(months / 6, 1);
}

// ---------- weighted statistics
function wmean(x, w) { const W = w.reduce((a, b) => a + b, 0); return W ? x.reduce((a, v, i) => a + v * w[i], 0) / W : 0; }
function sorted(x, w) { return x.map((v, i) => [v, w[i]]).sort((p, q) => p[0] - q[0]); }
// The value at which the running share of weight first reaches q.
function wquantile(x, w, q) {
  const s = sorted(x, w), W = w.reduce((a, b) => a + b, 0);
  let acc = 0; for (const [v, wi] of s) { acc += wi; if (acc / W >= q - 1e-12) return v; }
  return s[s.length - 1][0];
}
// Weighted average of the lowest values making up a share f of the total weight.
function worstShare(x, w, f) {
  const s = sorted(x, w), need = f * w.reduce((a, b) => a + b, 0);
  let got = 0, sum = 0;
  for (const [v, wi] of s) { const take = Math.min(wi, need - got); if (take <= 0) break; sum += v * take; got += take; }
  return got ? sum / got : 0;
}
