// Prediction game scoring. Plain ES module with no dependencies, shared by the app and the data job (which resolves
// predictions and writes the scores, so nobody can change their own).
//
// One public number: the profile score (300 to 900), comparable between people.
//  - Trade score (internal, 0 to 100): one prediction on its own, from how close it was, whether it beat guessing
//    "no change", and whether the direction was right. It depends only on the prediction, so identical predictions
//    always get the identical trade score. People never see it: each prediction shows only how close it was.
//  - Profile score: built only from trade scores. Per period it combines their average (quality) with how steady they
//    are (consistency), then blends the periods with longer ones counting more. So the same trade score can move two
//    profiles by different amounts, depending on what came before.
//
// Every distance is measured in "typical moves" for the coin and the period, not in percent, so a 30-minute call on
// Bitcoin and a 1-year call on Dogecoin are judged on the same footing.
// A prediction is a game entry about a price, never advice or a forecast published by the app.

// ---------- settings (every number the algorithm uses lives here)
// days: length of the period. share: its part of the profile score.
// k: scored predictions at which the period carries half its share (confidence = n / (n + k)).
// halfLife: days after a prediction is scored until it counts half as much in the profile.
export const HORIZONS = {
  "30m": { label: "30 minutes", days: 1 / 48, share: 0.10, k: 20, halfLife: 90 },
  "1h": { label: "1 hour", days: 1 / 24, share: 0.15, k: 20, halfLife: 90 },
  "1d": { label: "1 day", days: 1, share: 0.30, k: 10, halfLife: 90 },
  "1y": { label: "1 year", days: 365, share: 0.45, k: 5, halfLife: 365 },
};
// Trade score parts (add up to 1). Together with the profile weights below they give the overall mix agreed on:
// closeness 45%, consistency 25%, direction 15%, skill 10%, breadth 5%.
export const TRADE = { closeness: 9 / 14, skill: 1 / 7, direction: 3 / 14 };
export const PROFILE = { quality: 0.70, consistency: 0.25, breadth: 0.05 };
export const MIN_MOVE = 0.25; // a prediction must call at least a quarter of a typical move up or down
export const MAX_MOVE = 6; // and at most six typical moves, which keeps typos like "$1" out
export const VOL_FLOOR = 0.002; // daily volatility is never treated as lower than 0.2%
export const SHRINK_K = 10; // with few results the profile score is pulled toward chance level
export const PROVISIONAL_UNDER = 10; // "Provisional" until this many predictions have been scored
export const SCORE_MIN = 300, SCORE_MAX = 900;
// Calibration, from simulated players on random-walk prices (tests/score.test.mjs re-checks it): CAL.chance is the
// average raw mix of a random caller (random direction and size) and CAL.perfect that of a perfect predictor. They map
// to 550 and 900, so 550 means "about chance" and anything below it is worse than guessing.
export const CAL = { chance: 0.443, perfect: 0.949 };
export const CHANCE = 550; // where a random caller lands, and where every new profile starts
export const BANDS = [[800, "Exceptional"], [700, "Very good"], [600, "Good"], [CHANCE, "Fair"], [SCORE_MIN, "Building"]];
// What people see for each prediction: how close it was, in words, judged in typical moves (so fair across periods).
export const CLOSENESS_LABELS = [[0.25, "Spot on"], [0.5, "Very close"], [1, "Close"], [2, "Off"], [Infinity, "Far off"]];

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
// When a prediction is scored: its period after it was made, or, for a group challenge, the end time everyone shares.
export const dueAt = (p) => (p.endAt ? new Date(Date.parse(p.endAt)).toISOString() : targetTime(p.createdAt, p.horizon));

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
// The sizes a call offers before "type my own": a share of a typical move for the period ("A usual day" = one).
const UNIT = { "30m": "half hour", "1h": "hour", "1d": "day", "1y": "year" };
export const callSizes = (horizon) => [["A little", 0.5], [`A usual ${UNIT[horizon]}`, 1], ["A big move", 2]];
export const canPredict = (predictions, coin, horizon) => !predictions.some((p) => p.coin === coin && p.horizon === horizon && p.actual == null);
// The nearest valid prices either side of today's, for the prediction sheet to show.
export function allowedRange({ horizon, p0, sigmaD }) {
  const m = typicalMove(sigmaD, horizon);
  return { downFrom: p0 * Math.exp(-m * MIN_MOVE), upFrom: p0 * Math.exp(m * MIN_MOVE), lowest: p0 * Math.exp(-m * MAX_MOVE), highest: p0 * Math.exp(m * MAX_MOVE) };
}

// ---------- the trade score (internal) and what people see
// p: { horizon, p0 (price when made), target (predicted), actual (price at the end), sigmaD (daily volatility when made) }
export function scorePrediction(p) {
  if (!HORIZONS[p?.horizon] || !pos(p.p0) || !pos(p.target) || !pos(p.actual)) return null;
  const m = typicalMove(p.sigmaD, p.horizon);
  const miss = Math.abs(Math.log(p.target / p.actual)) / m; // how far off, in typical moves
  const missFlat = Math.abs(Math.log(p.p0 / p.actual)) / m; // how far off "no change" would have been
  const called = Math.log(p.target / p.p0), went = Math.log(p.actual / p.p0);
  const closeness = Math.exp(-miss); // 1 = exact, 0.37 = one typical move off
  const skill = clamp(missFlat - miss, -2, 2); // > 0 when the call beat guessing today's price, in typical moves
  const direction = went === 0 ? 0.5 : Math.sign(went) === Math.sign(called) ? 1 : 0;
  const trade = 100 * (TRADE.closeness * closeness + TRADE.skill * (0.5 + 0.5 * Math.tanh(skill)) + TRADE.direction * direction);
  return {
    trade, // internal only
    miss, missFlat, closeness, skill, direction,
    // shown to people
    pctOff: (p.target / p.actual - 1) * 100, // + means the call was above the actual price
    label: labelFor(miss, direction),
  };
}
// The closeness label, from the miss in typical moves. A call that went the wrong way is never better than "Off":
// near the price but on the wrong side isn't close (feedback, 16 Oct).
const ORDER = CLOSENESS_LABELS.map(([, l]) => l);
function labelFor(miss, direction) {
  const l = CLOSENESS_LABELS.find(([max]) => miss < max)[1];
  return direction === 0 && ORDER.indexOf(l) < ORDER.indexOf("Off") ? "Off" : l;
}
// A stored result with its label worked out again under today's rule (results scored before 16 Oct carry the old one).
export function relabel(r) {
  if (r?.status !== "scored") return r;
  const s = scorePrediction(r);
  return s && s.label !== r.label ? { ...r, label: s.label } : r;
}
// The line shown for a scored prediction, e.g. "0.6% above · Very close".
export const closenessText = (s) => `${Math.abs(s.pctOff) < 0.05 ? "Exact" : `${Math.abs(s.pctOff).toFixed(Math.abs(s.pctOff) < 10 ? 1 : 0)}% ${s.pctOff > 0 ? "above" : "below"}`} · ${s.label}`;

// ---------- the profile score (public)
// predictions: every prediction of one person, each with { coin, horizon, p0, target, sigmaD, createdAt } and, once
// scored, { actual, resolvedAt }. now: when the score is worked out (ms), so old results can fade.
export function profileScore(predictions, now = Date.now()) {
  const done = predictions.map((p) => ({ p, s: p.actual != null ? scorePrediction(p) : null })).filter((x) => x.s);
  const n = done.length;
  const perHorizon = {};
  for (const [h, H] of Object.entries(HORIZONS)) {
    const xs = done.filter((x) => x.p.horizon === h);
    if (!xs.length) continue;
    // A result starts fading when it is scored, not when it was made, so long calls aren't punished for waiting.
    // Fading only sets how results weigh against each other; the weights are rescaled to add up to the count.
    const w0 = xs.map((x) => 0.5 ** (Math.max(0, now - Date.parse(x.p.resolvedAt || x.p.createdAt)) / DAY / H.halfLife));
    const w = w0.map((v) => (v * xs.length) / w0.reduce((a, b) => a + b, 0));
    const t = xs.map((x) => x.s.trade / 100);
    const quality = wmean(t, w), steady = consistency(t, w);
    perHorizon[h] = {
      n: xs.length, quality, consistency: steady,
      sub: (PROFILE.quality * quality + PROFILE.consistency * steady) / (PROFILE.quality + PROFILE.consistency),
      confidence: xs.length / (xs.length + H.k),
      // what went into quality, for diagnostics
      closeness: wmean(xs.map((x) => x.s.closeness), w), skill: wmean(xs.map((x) => x.s.skill), w), direction: wmean(xs.map((x) => x.s.direction), w),
    };
  }
  if (!n) return { score: null, band: "No score yet", provisional: true, n: 0, perHorizon, parts: null };
  // Periods blend by their share times how much evidence they have, so long periods dominate once they have results.
  const hs = Object.keys(perHorizon), a = hs.map((h) => HORIZONS[h].share * perHorizon[h].confidence), A = a.reduce((x, y) => x + y, 0);
  hs.forEach((h, i) => (perHorizon[h].weight = a[i] / A));
  const blend = (key) => hs.reduce((s, h) => s + perHorizon[h].weight * perHorizon[h][key], 0);
  const b = breadth(done.map((x) => x.p));
  const raw = (1 - PROFILE.breadth) * blend("sub") + PROFILE.breadth * b;
  // place raw on the calibrated scale, then pull it toward chance level while there are few results
  const scaled = CHANCE + ((SCORE_MAX - CHANCE) * (raw - CAL.chance)) / (CAL.perfect - CAL.chance);
  const score = Math.round(clamp(CHANCE + (scaled - CHANCE) * (n / (n + SHRINK_K)), SCORE_MIN, SCORE_MAX));
  return {
    score, band: BANDS.find(([min]) => score >= min)[1], provisional: n < PROVISIONAL_UNDER, n,
    parts: { quality: blend("quality"), consistency: blend("consistency"), breadth: b },
    perHorizon, raw,
  };
}
// How one more prediction changes a profile (internal, e.g. for testing and tuning).
export function scoreChange(predictions, extra, now = Date.now()) {
  const before = profileScore(predictions, now), after = profileScore([...predictions, extra], now);
  return { before: before.score, after: after.score, change: before.score == null ? null : after.score - before.score };
}

// Consistency (0 to 1) from trade scores (0 to 1): reliably good, with no disasters.
//  40% hit rate: share of trade scores of 50 or more
//  30% tight spread: 1 minus the gap between the 25th and 75th percentile
//  30% no disasters: the average of the worst 20%
// Needs at least 3 results; until then it sits at the middle (0.5).
export function consistency(x, w = x.map(() => 1)) {
  if (x.length < 3) return 0.5;
  const hit = wmean(x.map((v) => (v >= 0.5 ? 1 : 0)), w);
  const spread = wquantile(x, w, 0.75) - wquantile(x, w, 0.25);
  return 0.4 * hit + 0.3 * (1 - spread) + 0.3 * worstShare(x, w, 0.2);
}
// Breadth (0 to 1): different coins (up to 5), periods played (of 4), and months active (up to 6).
export function breadth(preds) {
  const coins = new Set(preds.map((p) => p.coin)).size, hs = new Set(preds.map((p) => p.horizon)).size;
  const months = new Set(preds.map((p) => String(p.createdAt).slice(0, 7))).size;
  return 0.5 * Math.min(coins / 5, 1) + 0.3 * (hs / Object.keys(HORIZONS).length) + 0.2 * Math.min(months / 6, 1);
}

// ---------- group challenges (shared by the data job and the app's demo mode)
// Group points for one pick: by how close it was, plus 1 for calling the direction right.
export const POINTS = { "Spot on": 5, "Very close": 3, Close: 2, Off: 1, "Far off": 0 };
const PERIOD = { "1h": "1-hour", "1d": "1-day", "1y": "1-year" };
const acctOf = (path) => path.split("/")[1];

// The results table for one challenge, best first. Ties go to the smaller miss, then the earlier pick.
// Never includes a price called: only how close (label, % off), the direction, and the points.
export function challengeResults(ch, picks) {
  const rows = picks.map((p) => {
    const a = p.a ?? p.path.split("/")[1], u = ch.picked?.[a] || "player", base = { a, u, counts: !!p.counts };
    const s = p.status === "scored" ? scorePrediction(p) : null;
    if (!s) return { ...base, label: "Not counted", pts: 0, miss: Infinity, at: p.createdAt };
    const up = p.target > p.p0, right = p.actual !== p.p0 && (p.actual > p.p0) === up;
    return { ...base, label: s.label, off: Math.round(s.pctOff * 100) / 100, up, right, pts: POINTS[s.label] + (right ? 1 : 0), miss: s.miss, at: p.createdAt };
  });
  rows.sort((x, y) => y.pts - x.pts || x.miss - y.miss || Date.parse(x.at) - Date.parse(y.at));
  return rows.map(({ miss, at, ...r }, i) => ({ ...r, rank: r.label === "Not counted" ? null : i + 1 }));
}

// Adds a challenge's points to a group's table: all-time, and this month's (mpts, for month m).
export function addPoints(table = {}, results, month) {
  const t = { ...table };
  for (const r of results) {
    const cur = t[r.a] || { all: 0, mpts: 0, m: month };
    t[r.a] = { all: cur.all + r.pts, mpts: (cur.m === month ? cur.mpts : 0) + r.pts, m: month };
  }
  return t;
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
