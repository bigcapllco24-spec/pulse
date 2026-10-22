// Score v2 on made-up calls with known answers and on simulated moves (fixed seeds).
import { SETTINGS, callOf, points, assess, shown, scoreRecord } from "../pipeline/lib/score2.mjs";

const DAY = 864e5, T0 = Date.parse("2026-01-01T09:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function makeRand(seed) {
  const u = rng(seed);
  const g = () => { let x = 0, y = 0; while (!x) x = u(); while (!y) y = u(); return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * y); };
  return { u, g, sign: () => (u() < 0.5 ? -1 : 1) };
}
// A normalized 1-day call made on day d (0 = T0).
const call = (z, c, d, { dir = Math.sign(c), prev = 0, tr90 = 0, days = 1 } = {}) =>
  ({ z, c, dir, days, day: iso(T0 + d * DAY).slice(0, 10), at: T0 + d * DAY + days * DAY, prev, tr90 });
// A stored result that becomes the call (z, c) on day d: p0 100, 3% daily volatility.
function result(z, c, d, { h = "1d", days = 1, dir = Math.sign(c), coin = "CRYPTO:BTC", status = "scored" } = {}) {
  const m = 0.03 * Math.sqrt(days), target = 100 * Math.exp(c * m), made = T0 + d * DAY;
  return { coin, t: coin.split(":").pop(), horizon: h, p0: 100, clientP0: dir === 0 ? target : 100, target, actual: 100 * Math.exp(z * m), sigmaD: 0.03, createdAt: iso(made), resolvedAt: iso(made + days * DAY), status };
}
// An honest player: a hint that follows the move with correlation rho, and the best guess from it.
const honestGuess = (R, z, rho) => { const s2 = 1 / rho ** 2 - 1; return (z + Math.sqrt(s2) * R.g()) / (1 + s2); };
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;

// 1. the best guess pays best
const R1 = makeRand(11), sizes = { honest: [], half: [], double: [], smallest: [] };
for (let i = 0; i < 200000; i++) {
  const z = R1.g(), x = honestGuess(R1, z, 0.3), d = Math.sign(x);
  sizes.honest.push(points(z, x, d)); sizes.half.push(points(z, x / 2, d)); sizes.double.push(points(z, 2 * x, d)); sizes.smallest.push(points(z, 0.25 * d, d));
}
const P = Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, avg(v)]));

// 2. "No change" and a flipped call
const flat = callOf(result(0.1, 0, 0, { dir: 0 }));
const flipped = callOf({ ...result(0, 0, 0), clientP0: 100, target: 101, p0: 102, actual: 103 }); // called up from 100, locked at 102

// 3. balancing: always up in a market that rises 65% of days
const R3 = makeRand(23), upCalls = [];
for (let d = 0; d < 400; d++) { const z = Math.abs(R3.g()) * (R3.u() < 0.65 ? 1 : -1); upCalls.push(call(z, 0.05, d)); }
const upRaw = avg(upCalls.map((q) => points(q.z, q.c, q.dir))), upA = assess(upCalls, { patterns: false });

// 4. a new player, one wrong call (and a few)
const oneWrong = scoreRecord([result(-1.2, 1, 0)], { now: T0 });
const fewWrong = shown(assess([call(-1, 1, 0), call(0.8, -0.5, 1)])); // two days: no proof yet

// 5. a perfect player for 80 days, three 1-day calls a day
const R5 = makeRand(5), perfect = [];
for (let d = 0; d < 80; d++) for (let k = 0; k < 3; k++) { const z = R5.g(); perfect.push(call(z, z, d)); }
const perfA = assess(perfect), perfS = shown(perfA);

// 6. soft ends, on extreme and random assessments
const R6 = makeRand(6), ends = [];
for (let i = 0; i < 20000; i++) {
  const est = 550 + (R6.u() - 0.5) * 20000, m = (est - 550) / 1000, se = R6.u() * 2;
  ends.push(shown({ est, lo90: m - se, lo975: m - 2 * se, hi90: m + se * (R6.u() - 0.5), months: R6.u() * 600, n: 100 }).score);
}
const top = shown({ est: 1e9, lo90: 1e6, lo975: 1e6, hi90: 1e6, months: 1e6 }).score, bottom = shown({ est: -1e9, lo90: -1e6, lo975: -1e6, hi90: -1e6, months: 0, n: 100 }).score, provBottom = shown({ est: -1e9, lo90: -1e6, lo975: -1e6, hi90: -1e6, months: 0, n: 9 }).score;

// 7. pattern removal never raises lo975 (copiers, honest players and mixes)
const R7 = makeRand(7), lows = [];
for (let p = 0; p < 60; p++) {
  const xs = [], kind = p % 4; let last = 1;
  for (let d = 0; d < 300; d++) {
    const z = R7.g() + (kind === 2 ? 0.3 * last : 0), tr = d % 120 < 60 ? 1 : -1;
    const x = kind === 0 ? 0.05 : kind === 1 ? honestGuess(R7, z, 0.3) : kind === 2 ? 0.05 * last : (R7.u() < 0.5 ? 0.05 * tr : honestGuess(R7, z, 0.3));
    xs.push(call(z, x, d, { prev: last, tr90: tr })); last = Math.sign(z) || 1;
  }
  lows.push([assess(xs).lo975, assess(xs, { patterns: false }).lo975]);
}
const upFlag = assess(upCalls).flag;

// 8. stored results: determinism, voids, markets, edge cases
const R8 = makeRand(8), docs = [];
for (let d = 0; d < 120; d++) { const z = R8.g(); docs.push(result(z, honestGuess(R8, z, 0.3), d, { coin: ["CRYPTO:BTC", "CRYPTO:ETH", "CRYPTO:SOL"][d % 3] })); }
const NOW = T0 + 200 * DAY, base = scoreRecord(docs, { now: NOW });
const shuffled = [...docs].sort(() => 0).reverse(), noise = [...docs, result(3, 1, 5, { status: "void" }), result(3, 1, 6, { coin: "NSE:RELIANCE" }), { status: "scored", coin: "CRYPTO:BTC", horizon: "2w" }, null];
const bare = docs.map((r) => ({ ...r, coin: r.t }));
const oneDay = scoreRecord(Array.from({ length: 30 }, (_, i) => result(1, 1, 0, { coin: "CRYPTO:C" + i })), { now: T0 });
const oneDayA = assess(Array.from({ length: 30 }, () => call(1, 1, 0)));
const constRule = assess([call(1, 1, 0), call(1, 1, 1), call(1, 1, 2), call(1, 1, 3)]);
const KEYS = "score,band,n,provisional,at,v,market,flag,held";

const checks = [
  [`the honest best guess earns most on average (${P.honest.toFixed(4)}) vs half ${P.half.toFixed(4)}, double ${P.double.toFixed(4)}, smallest ${P.smallest.toFixed(4)}`, P.honest > P.half && P.honest > P.double && P.honest > P.smallest],
  ["\"No change\": +1 within a quarter typical move, -1 outside", points(0.25, 0, 0) === 1 && points(-0.2, 0, 0) === 1 && points(0.26, 0, 0) === -1 && points(-3, 0, 0) === -1],
  ["\"No change\" is read from target = shown price", flat.dir === 0 && near(flat.c, 0) && near(flat.z, 0.1)],
  ["a call the price passed before locking keeps its direction with size 0", flipped.dir === 1 && flipped.c === 0 && near(points(flipped.z, flipped.c, flipped.dir), 1)],
  ["without clientP0 the direction comes from the start price", callOf({ ...result(0.5, -1, 0), clientP0: undefined }).dir === -1],
  ["a call's points: right way plus how much closer than no change", near(points(1, 0.5, 1), 1.5) && near(points(-1, 0.5, 1), -1.5) && points(0, 0.5, 1) === -0.5],
  [`balancing: always up in a market up 65% of days averages ${upA.mean.toFixed(3)} (raw ${upRaw.toFixed(2)})`, upRaw > 0.2 && Math.abs(upA.mean) < 0.03 && Math.abs(upA.est - 550) < 10],
  ["always up is flagged by name", upFlag === "always up"],
  [`respect rule: a new player with one wrong call shows 550 (${oneWrong.score}), and with two on two days (${fewWrong.score})`, oneWrong.score === 550 && oneWrong.band === "Building" && oneWrong.provisional && fewWrong.score === 550],
  [`experience ceiling: a perfect player over 80 days stays at 700 (estimate ${Math.round(perfA.est)}, shown ${perfS.score})`, perfA.months < 3 && perfA.est > 700 && perfS.score === 700 && perfS.held],
  [`never "Below guessing" while provisional (fewer than 10 calls), however bad the record (${provBottom})`, provBottom === 550],
  [`soft ends: never 900 or 300 (range ${Math.min(...ends)}..${Math.max(...ends)}, extremes ${bottom}/${top})`, ends.every((s) => s > 300 && s < 900) && top === 899 && bottom === 301],
  ["pattern removal never raises lo975", lows.every(([a, b]) => a <= b + 1e-12) && lows.some(([a, b]) => a < b)],
  ["the same input always gives the same output, in any order", JSON.stringify(scoreRecord(docs, { now: NOW })) === JSON.stringify(base) && JSON.stringify(scoreRecord(shuffled, { now: NOW })) === JSON.stringify(base)],
  ["voids, other markets and broken results are ignored", JSON.stringify(scoreRecord(noise, { now: NOW })) === JSON.stringify(base)],
  ["results without a market prefix count as crypto; other markets score on their own", JSON.stringify(scoreRecord(bare, { now: NOW })) === JSON.stringify(base) && scoreRecord(noise, { market: "NSE", now: NOW }).n === 1 && scoreRecord(noise, { market: "NSE", now: NOW }).market === "NSE"],
  ["nothing scored means no score", [null, undefined, [], [result(1, 1, 0, { status: "void" })], [result(1, 1, 0, { coin: "NSE:X" })]].every((x) => scoreRecord(x) === null) && assess([]) === null],
  [`only the agreed fields are stored (${Object.keys(base).join(",")})`, Object.keys(base).join() === KEYS && base.v === 2 && base.market === "CRYPTO" && base.n === 120 && !base.provisional && base.at === iso(NOW)],
  ["one call: a score, provisional, near 550", (() => { const r = scoreRecord([result(1, 1, 0)], { now: T0 }); return r.n === 1 && r.provisional && r.score >= 550 && r.score < 570; })()],
  [`all calls on one day: no proof yet, so held at most at 650 (${oneDay.score})`, oneDayA.lo90 === -Infinity && oneDayA.hi90 === Infinity && oneDay.score <= 650 && oneDay.held],
  ["a rule that scores the same on every call gives no NaN", Number.isFinite(constRule.est) && Number.isFinite(shown(constRule).score)],
  ["settings as agreed", SETTINGS.BAND === 0.25 && SETTINGS.MEMORY === 720 && SETTINGS.PRIOR === 160 && SETTINGS.FLAG_SHARE === 0.7 && SETTINGS.VOL_FLOOR === 0.002],
];
let ok = 0; for (const [n, pass] of checks) { if (pass) ok++; else console.log("FAIL score2: " + n); }
if (process.argv.includes("-v")) for (const [n, pass] of checks) console.log(`${pass ? "ok  " : "FAIL"} ${n}`);
console.log(`score2: ${ok}/${checks.length} checks passed`);
process.exit(ok === checks.length ? 0 : 1);
