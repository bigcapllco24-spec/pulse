// Prediction game: the rules every call follows and what a scored call shows (how close it was, in words). Plain ES
// module with no dependencies, shared by the app and the data jobs.
//
// Every distance is measured in "typical moves" for the coin and the period, not in percent, so a 30-minute call on
// Bitcoin and a 1-year call on Dogecoin are judged on the same footing. The score itself (300 to 900) is worked out by
// the data job only (pipeline/lib/score2.mjs) and stored on the account; the app shows it, never computes it.
// A prediction is a game entry about a price, never advice or a forecast published by the app.

export const HORIZONS = {
  "30m": { label: "30 minutes", days: 1 / 48 },
  "1h": { label: "1 hour", days: 1 / 24 },
  "1d": { label: "1 day", days: 1 },
  "1y": { label: "1 year", days: 365 },
};
export const MAX_MOVE = 6; // a call can be any size up to six typical moves, which keeps typos like "$1" out
export const VOL_FLOOR = 0.002; // daily volatility is never treated as lower than 0.2%
export const FLAT_BAND = 0.25; // "No change" is right when the price ends within a quarter of a typical move
// Group picks don't store the price shown, so their direction comes from the locked start price: they keep the old
// minimum of a quarter of a typical move, so a small lock-time move can't turn a pick around.
export const PICK_MIN_MOVE = 0.25;
export const PROVISIONAL_UNDER = 10; // "Provisional" until this many calls have been scored
export const SCORE_MIN = 300, SCORE_MAX = 900;
export const CHANCE = 550; // where everyone starts: about what guessing scores
export const BANDS = [[650, "Proven"], [CHANCE, "Building"], [SCORE_MIN, "Below guessing"]];
export const bandOf = (score) => (score == null ? null : BANDS.find(([min]) => score >= min)?.[1] ?? BANDS.at(-1)[1]);
// What people see for each call: how close it was, in words, judged in typical moves (so fair across periods).
export const CLOSENESS_LABELS = [[0.25, "Spot on"], [0.5, "Very close"], [1, "Close"], [2, "Off"], [Infinity, "Far off"]];

const DAY = 864e5;
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

// ---------- making a call
// The direction a call took: 1 higher, -1 lower, 0 "No change" (the price shown, exactly).
export const callDir = (p) => (p.target === p.clientP0 ? 0 : Math.sign(p.target - (pos(p.clientP0) ? p.clientP0 : p.p0)));
// Checks a new call before it's saved: a known period, real prices, and any size up to MAX_MOVE. The price shown itself
// is only allowed as "No change" (flat), so a typed price can't land on it by accident.
export function checkPrediction({ horizon, p0, target, sigmaD, flat = false, minMove = 0 }) {
  if (!HORIZONS[horizon]) return { ok: false, error: "Pick 30 minutes, 1 hour, 1 day or 1 year." };
  if (!pos(p0) || !pos(target)) return { ok: false, error: "Enter a price above zero." };
  if (flat) return target === p0 ? { ok: true, moves: 0 } : { ok: false, error: "No change is the price shown now." };
  const moves = Math.abs(Math.log(target / p0)) / typicalMove(sigmaD, horizon);
  if (moves === 0) return { ok: false, moves, error: "That's today's price. Tap No change to call that." };
  if (moves < minMove - 1e-9) return { ok: false, moves, error: "That's too close to today's price for a group pick. Call a move up or down." };
  if (moves > MAX_MOVE) return { ok: false, moves, error: "That's far outside how much this coin moves in that time. Check the price." };
  return { ok: true, moves };
}
// One open prediction per coin per period: a new one can be made once the last one has been scored.
export const canPredict = (predictions, coin, horizon) => !predictions.some((p) => p.coin === coin && p.horizon === horizon && p.actual == null);
// The sizes a call offers before "type my own": a share of a typical move for the period ("A usual day" = one).
const UNIT = { "30m": "half hour", "1h": "hour", "1d": "day", "1y": "year" };
export const callSizes = (horizon) => [["A touch", 0.25], ["A little", 0.5], [`A usual ${UNIT[horizon]}`, 1]];

// ---------- what a scored call shows
// p: { horizon, p0 (locked start price), target, clientP0, actual, sigmaD }. miss: how far off, in typical moves.
export function scorePrediction(p) {
  if (!HORIZONS[p?.horizon] || !pos(p.p0) || !pos(p.target) || !pos(p.actual)) return null;
  const m = typicalMove(p.sigmaD, p.horizon), d = callDir(p), went = Math.log(p.actual / p.p0) / m;
  const miss = d === 0 ? Math.abs(went) : Math.abs(Math.log(p.target / p.actual)) / m;
  const direction = d === 0 ? (Math.abs(went) <= FLAT_BAND ? 1 : 0) : went === 0 ? 0.5 : Math.sign(went) === d ? 1 : 0;
  return { miss, direction, pctOff: (p.target / p.actual - 1) * 100, label: labelFor(miss, direction) };
}
// A call that went the wrong way (or "No change" when it moved) is never better than "Off": near the price but on the
// wrong side isn't close (feedback, 16 Oct).
const ORDER = CLOSENESS_LABELS.map(([, l]) => l);
function labelFor(miss, direction) {
  const l = CLOSENESS_LABELS.find(([max]) => miss < max)[1];
  return direction === 0 && ORDER.indexOf(l) < ORDER.indexOf("Off") ? "Off" : l;
}
// Right direction: the price went the way the call said; for "No change", it stayed within a quarter of a typical move.
export const isRight = (r) => r?.status === "scored" && scorePrediction(r)?.direction === 1;
// A stored result with its label worked out again under today's rule.
export function relabel(r) {
  if (r?.status !== "scored") return r;
  const s = scorePrediction(r);
  return s && s.label !== r.label ? { ...r, label: s.label } : r;
}
// The line shown for a scored prediction, e.g. "0.6% above · Very close".
export const closenessText = (s) => `${Math.abs(s.pctOff) < 0.05 ? "Exact" : `${Math.abs(s.pctOff).toFixed(Math.abs(s.pctOff) < 10 ? 1 : 0)}% ${s.pctOff > 0 ? "above" : "below"}`} · ${s.label}`;

// ---------- group challenges (shared by the data job and the app's demo mode)
// Group points for one pick: by how close it was, plus 1 for calling the direction right.
export const POINTS = { "Spot on": 5, "Very close": 3, Close: 2, Off: 1, "Far off": 0 };

// The results table for one challenge, best first. Ties go to the smaller miss, then the earlier pick.
// Never includes a price called: only how close (label, % off), the direction, and the points.
export function challengeResults(ch, picks) {
  const rows = picks.map((p) => {
    const a = p.a ?? p.path.split("/")[1], u = ch.picked?.[a] || "player", base = { a, u, counts: !!p.counts };
    const s = p.status === "scored" ? scorePrediction(p) : null;
    if (!s) return { ...base, label: "Not counted", pts: 0, miss: Infinity, at: p.createdAt };
    const d = callDir(p), right = s.direction === 1;
    return { ...base, label: s.label, off: Math.round(s.pctOff * 100) / 100, up: d > 0, flat: d === 0, right, pts: POINTS[s.label] + (right ? 1 : 0), miss: s.miss, at: p.createdAt };
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
