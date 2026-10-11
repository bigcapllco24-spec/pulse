// Prediction game scoring on made-up predictions with known answers.
import { scorePrediction, profileScore, scoreChange, consistency, checkPrediction, canPredict, dailyVol, typicalMove, HORIZONS, SCORE_MIN, SCORE_MAX } from "../web/js/score.js";

const NOW = Date.parse("2026-10-11T12:00:00Z"), DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString();
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const COINS = ["CRYPTO:BTC", "CRYPTO:ETH", "CRYPTO:SOL", "CRYPTO:XRP", "CRYPTO:BNB"];
// A resolved prediction with a chosen closeness (0 to 1): calls one typical move up, and the price ends
// -ln(c) typical moves away from the call (alternating sides so direction and skill vary).
function pred(c, i, { h = "1d", coin = COINS[i % 5], made = NOW - (40 - i) * DAY, resolved = made + HORIZONS[h].days * DAY } = {}) {
  const m = typicalMove(0.025, h), target = 100 * Math.exp(m), actual = target * Math.exp(-Math.log(c) * m * (i % 2 ? 1 : -1));
  return { coin, horizon: h, p0: 100, target, actual, sigmaD: 0.025, createdAt: iso(made), resolvedAt: iso(resolved) };
}
const steady = Array.from({ length: 20 }, (_, i) => pred(0.7, i));
const streaky = Array.from({ length: 20 }, (_, i) => pred(i % 2 ? 1 : 0.4, i));

// 1. one prediction
const btc = scorePrediction({ horizon: "1d", p0: 82000, target: 84000, actual: 83500, sigmaD: 0.025 });
const perfect = Object.keys(HORIZONS).map((h) => scorePrediction({ horizon: h, p0: 100, target: 103, actual: 103, sigmaD: 0.025 }).score);
const sameMissTwoWays = [scorePrediction({ horizon: "30m", p0: 100, target: 101, actual: 100.6, sigmaD: 0.05 }), scorePrediction({ horizon: "30m", p0: 100, target: 101, actual: 100.6, sigmaD: 0.05 })];
// a 2% miss is poor over 30 minutes and good over a year; equal misses in typical moves score the same
const m30 = typicalMove(0.025, "30m"), m1y = typicalMove(0.025, "1y");
const short = scorePrediction({ horizon: "30m", p0: 100, target: 100 * Math.exp(m30), actual: 100 * Math.exp(m30) * Math.exp(-0.5 * m30), sigmaD: 0.025 });
const long = scorePrediction({ horizon: "1y", p0: 100, target: 100 * Math.exp(m1y), actual: 100 * Math.exp(m1y) * Math.exp(-0.5 * m1y), sigmaD: 0.025 });

// 2. the profile
const P = (ps) => profileScore(ps, NOW);
const miss = pred(0.3, 21), hit = pred(0.95, 21);
const dSteadyMiss = scoreChange(steady, miss, NOW).change, dStreakyMiss = scoreChange(streaky, miss, NOW).change;
// fading starts when a result is scored: a 1-year call made a year ago and scored today counts twice as much as
// one scored a year ago (365-day half-life), regardless of when either was made
const yrGood = pred(0.9, 1, { h: "1y", made: NOW - 365 * DAY, resolved: NOW }), yrBad = pred(0.3, 2, { h: "1y", made: NOW - 730 * DAY, resolved: NOW - 365 * DAY });
const fade = P([yrGood, yrBad]).perHorizon["1y"].closeness;
// long periods dominate: 40 thirty-minute, 20 one-day and 2 one-year results blend about 17% / 51% / 33%
const mix = P([...Array.from({ length: 40 }, (_, i) => pred(0.6, i, { h: "30m" })), ...Array.from({ length: 20 }, (_, i) => pred(0.6, i)), pred(0.6, 1, { h: "1y" }), pred(0.6, 2, { h: "1y" })]).perHorizon;
const one = P([pred(1, 1)]), none = P([]);
const many = Array.from({ length: 200 }, (_, k) => P(Array.from({ length: 1 + (k % 30) }, (_, i) => pred(0.02 + ((i * 37 + k * 11) % 98) / 100, i, { h: Object.keys(HORIZONS)[(i + k) % 4] }))).score);
const better = P(Array.from({ length: 15 }, (_, i) => pred(0.8, i))).score > P(Array.from({ length: 15 }, (_, i) => pred(0.5, i))).score;

// Calibration: simulated players on random-walk prices (fixed seed). Each makes 60 predictions across the 4 periods.
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const PLAYERS = { // the called move, in typical moves, given the true move z
  perfect: (z) => z, skilled: (z) => 0.7 * z + 0.5 * gauss(), decent: (z) => 0.4 * z + 0.8 * gauss(),
  random: () => (rnd() < 0.5 ? -1 : 1) * (0.25 + rnd() * 1.25), wrongWay: (z) => -Math.sign(z || 1) * (0.5 + rnd()),
};
const sim = {};
for (const [name, f] of Object.entries(PLAYERS)) {
  const runs = [];
  for (let run = 0; run < 30; run++) {
    const ps = Array.from({ length: 60 }, (_, i) => {
      const h = Object.keys(HORIZONS)[i % 4], m = typicalMove(0.03, h), z = gauss(); let c = f(z);
      if (Math.abs(c) < 0.25) c = 0.25 * Math.sign(c || 1); // the minimum-move rule
      const made = NOW - (200 - i) * DAY;
      return { coin: COINS[i % 5], horizon: h, p0: 100, target: 100 * Math.exp(c * m), actual: 100 * Math.exp(z * m), sigmaD: 0.03, createdAt: iso(made), resolvedAt: iso(made + DAY) };
    });
    runs.push(P(ps));
  }
  sim[name] = { raw: runs.reduce((a, r) => a + r.raw, 0) / runs.length, score: runs.reduce((a, r) => a + r.score, 0) / runs.length };
}

// 3. making a prediction
const open = [{ coin: "CRYPTO:BTC", horizon: "1d", p0: 1, target: 2 }, { coin: "CRYPTO:ETH", horizon: "1h", p0: 1, target: 2, actual: 2 }];
const vol = dailyVol([100, 110, 100, 110, 100]), r = Math.log(1.1);

const checks = [
  ["worked example: BTC 82,000 → called 84,000, ended 83,500 (1 day, 2.5% vol) scores closeness 78.8, 236 points, skill +0.49, direction hit", near(btc.closeness, 78.7567, 1e-3) && btc.score === 236 && near(btc.skill, 0.4863, 1e-3) && btc.direction === 1],
  ["an exact call earns the period's full value: 100, 150, 300, 450 points", JSON.stringify(perfect) === "[100,150,300,450]"],
  ["identical predictions always get the identical prediction score", JSON.stringify(sameMissTwoWays[0]) === JSON.stringify(sameMissTwoWays[1])],
  ["closeness is measured in typical moves, so half a typical move off scores 61 on both 30 minutes and 1 year", near(short.closeness, 100 * Math.exp(-0.5), 1e-9) && near(long.closeness, short.closeness, 1e-9)],
  ["consistency: steady at 70 gives 0.91, alternating 100/40 (same average) gives 0.44", near(consistency(Array(10).fill(0.7)), 0.91, 1e-9) && near(consistency([1, 0.4, 1, 0.4, 1, 0.4, 1, 0.4, 1, 0.4]), 0.44, 1e-9)],
  ["same average closeness, but the steady profile outscores the streaky one", P(steady).score > P(streaky).score && near(P(steady).parts.closeness, P(streaky).parts.closeness, 0.01)],
  ["the same new prediction moves two profiles by different amounts (a miss costs the steady profile more)", dSteadyMiss < dStreakyMiss && dSteadyMiss < 0 && scorePrediction(miss).score === scorePrediction(miss).score],
  ["a good new prediction raises both profiles", scoreChange(steady, hit, NOW).change > 0 && scoreChange(streaky, hit, NOW).change > 0],
  ["fading starts when a prediction is scored: a 1-year result scored today counts double one scored a year ago", near(fade, (2 * 0.9 + 0.3) / 3, 1e-9)],
  ["long periods dominate: 40×30m, 20×1d, 2×1y blend about 17% / 51% / 33%", near(mix["30m"].weight, 0.17, 0.01) && near(mix["1d"].weight, 0.51, 0.01) && near(mix["1y"].weight, 0.33, 0.01)],
  ["one perfect prediction is provisional and stays close to chance level (550)", one.provisional && one.score > 550 && one.score < 600],
  ["calibration still holds: a random caller's raw mix averages 0.426 and a perfect one's 0.93 (±0.02)", near(sim.random.raw, 0.426, 0.02) && near(sim.perfect.raw, 0.93, 0.02)],
  ["with 60 results a random caller scores about 550 and a perfect predictor about 850", near(sim.random.score, 550, 15) && near(sim.perfect.score, 850, 15)],
  ["better players always score higher: perfect > skilled > decent > random > always the wrong way", sim.perfect.score > sim.skilled.score && sim.skilled.score > sim.decent.score && sim.decent.score > sim.random.score && sim.random.score > sim.wrongWay.score],
  ["worse than chance falls below 550", sim.wrongWay.score < 550],
  ["no predictions means no score yet", none.score === null && none.band === "No score yet"],
  ["every profile score stays between 300 and 900", many.every((s) => s >= SCORE_MIN && s <= SCORE_MAX)],
  ["closer predictions give a higher profile score", better],
  ["a call within a quarter of a typical move is rejected; a real call is accepted", !checkPrediction({ horizon: "1d", p0: 82000, target: 82100, sigmaD: 0.025 }).ok && checkPrediction({ horizon: "1d", p0: 82000, target: 84000, sigmaD: 0.025 }).ok],
  ["a price far outside the coin's range is rejected", !checkPrediction({ horizon: "30m", p0: 82000, target: 1, sigmaD: 0.025 }).ok],
  ["one open prediction per coin per period; other periods and scored ones don't block", !canPredict(open, "CRYPTO:BTC", "1d") && canPredict(open, "CRYPTO:BTC", "1h") && canPredict(open, "CRYPTO:ETH", "1h")],
  ["daily volatility is the standard deviation of daily log returns", near(vol, Math.sqrt((4 * r * r) / 3), 1e-12)],
];
let ok = 0; for (const [n, pass] of checks) { if (pass) ok++; else console.log("FAIL score: " + n); }
if (process.argv.includes("-v")) for (const [n, pass] of checks) console.log(`${pass ? "ok  " : "FAIL"} ${n}`);
console.log(`score: ${ok}/${checks.length} checks passed`);
process.exit(ok === checks.length ? 0 : 1);
