// Prediction game settling: start-price lock, exact-time resolution, voids, and the data job's Firestore step,
// with simulated Kraken candles and an in-memory Firestore.
import { settle, priceAt, intervalFor, sigmaBefore, rowCache } from "../web/js/predict.js";
import { settlePredictions, settleOpen } from "../pipeline/lib/predictions.mjs";
import { scorePrediction, typicalMove, HORIZONS } from "../web/js/score.js";

const MIN = 60e3, DAY = 864e5;
const NOW = Date.parse("2026-10-11T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
// Made-up market: m minutes from the test time the price is 100 × e^(0.0001·m), so every candle's open is known.
const priceOf = (ms) => 100 * Math.exp(0.0001 * (Math.floor(ms / MIN) - NOW / MIN));
// Daily closes swing ±2% around 100, so daily volatility is known and the same on every day.
function rows(t, iv, now = NOW) {
  const len = iv * MIN, end = Math.floor(now / len) * len, out = [];
  for (let k = 719; k >= 0; k--) {
    const s = end - k * len, o = iv === 1440 ? 100 * (k % 2 ? 1.02 : 1) : priceOf(s), c = iv === 1440 ? 100 * (k % 2 ? 1 : 1.02) : priceOf(s + len - MIN);
    out.push([s / 1000, String(o), String(Math.max(o, c)), String(Math.min(o, c)), String(c), String(c), "10", 5]);
  }
  return out;
}
const calls = [];
const fakeRows = (now) => async (t, iv) => { calls.push(`${t}:${iv}`); return rows(t, iv, now); };
const sigma = sigmaBefore(rows("BTC", 1440), iso(NOW));
const tm = (h) => typicalMove(sigma, h);

// 1. a 1-hour call made 3 hours ago: locked and scored in one pass, from 1-minute candles
const made = NOW - 3 * 3600e3, p0 = priceOf(made), due = made + 3600e3, real = priceOf(due);
const target = p0 * Math.exp(tm("1h")); // one typical move up
const r1 = await settle({ coin: "CRYPTO:BTC", t: "BTC", horizon: "1h", target, createdAt: iso(made) }, { now: NOW, rows: rowCache(fakeRows(NOW)) });
const want = scorePrediction({ horizon: "1h", p0, target, actual: real, sigmaD: sigma });

// 2. a 1-day call made 2 hours ago: locked now, still open
const made2 = NOW - 2 * 3600e3;
const r2 = await settle({ coin: "CRYPTO:BTC", t: "BTC", horizon: "1d", target: priceOf(made2) * 1.05, createdAt: iso(made2) }, { now: NOW, rows: rowCache(fakeRows(NOW)) });

// 3. the price moved before the lock: the call is now right on top of the real start price, and a call made part-way
// through a minute, locked at the open of the next one (a price nobody could see when calling)
const r3 = await settle({ coin: "CRYPTO:BTC", t: "BTC", horizon: "1d", target: priceOf(made2), clientP0: priceOf(made2) * 0.999, createdAt: iso(made2) }, { now: NOW, rows: rowCache(fakeRows(NOW)) });
const r3b = await settle({ coin: "CRYPTO:BTC", t: "BTC", horizon: "1d", target: 101, createdAt: iso(made2 + 25e3) }, { now: NOW, rows: rowCache(fakeRows(NOW)) });
const r3c = await settle({ coin: "CRYPTO:BTC", t: "BTC", horizon: "1h", target: 101, createdAt: iso(NOW - 20e3) }, { now: NOW - 10e3, rows: rowCache(fakeRows(NOW - 10e3)) });
// 4. a typo-sized call
const r4 = await settle({ coin: "CRYPTO:BTC", t: "BTC", horizon: "30m", target: 1, createdAt: iso(made2) }, { now: NOW, rows: rowCache(fakeRows(NOW)) });
// 5. already locked, resolved two days after its target time: falls back to 15-minute candles
const made5 = NOW - 3 * DAY, due5 = made5 + DAY;
const r5 = await settle({ coin: "CRYPTO:BTC", t: "BTC", horizon: "1d", target: 130, createdAt: iso(made5), p0: 99, sigmaD: sigma }, { now: NOW, rows: rowCache(fakeRows(NOW)) });
// 6. not due yet within the one-minute settle delay
const r6 = await settle({ coin: "CRYPTO:BTC", t: "BTC", horizon: "30m", target: 130, createdAt: iso(NOW - 30 * MIN + 10e3), p0: 99, sigmaD: sigma }, { now: NOW, rows: rowCache(fakeRows(NOW)) });

// 7. the data job against an in-memory Firestore
const store = new Map();
const db = {
  async group(id) { return [...store].filter(([k]) => k.split("/").at(-2) === id).map(([k, v]) => ({ id: k.split("/").pop(), path: k, ...v })); },
  async list(coll) { const pre = coll + "/"; return [...store].filter(([k]) => k.startsWith(pre) && !k.slice(pre.length).includes("/")).map(([k, v]) => ({ id: k.slice(pre.length), path: k, ...v })); },
  async set(path, data) { store.set(path, { ...(store.get(path) || {}), ...data }); },
  async del(path) { store.delete(path); },
};
store.set("accounts/u1", {});
store.set("accounts/u1/predictions/BTC_1h", { coin: "CRYPTO:BTC", t: "BTC", horizon: "1h", target, createdAt: iso(made) });
store.set("accounts/u1/predictions/BTC_1d", { coin: "CRYPTO:BTC", t: "BTC", horizon: "1d", target: priceOf(made2) * 1.05, createdAt: iso(made2) });
store.set("accounts/u2", {});
calls.length = 0;
const tally = await settlePredictions(db, await db.list("accounts"), { now: NOW, fetchRows: fakeRows(NOW), log: () => {} });
const res = await db.list("accounts/u1/results"), openLeft = await db.list("accounts/u1/predictions");
// the 15-minute run: one query finds open predictions; with nothing newly due, it only touches the open account
const quick = await settleOpen(db, { now: NOW + 60e3, fetchRows: fakeRows(NOW), log: () => {} });

const checks = [
  ["candle sizes: 1 minute for the last 12 hours, then 15 minutes, hourly, 4-hourly, daily", intervalFor(NOW - 11 * 3600e3, NOW) === 1 && intervalFor(NOW - 2 * DAY, NOW) === 15 && intervalFor(NOW - 20 * DAY, NOW) === 60 && intervalFor(NOW - 100 * DAY, NOW) === 240 && intervalFor(NOW - 300 * DAY, NOW) === 1440 && intervalFor(NOW - 800 * DAY, NOW) === null],
  ["the price at a moment is the open of the 1-minute candle containing it", near(priceAt(rows("BTC", 1), made + 25e3, 1), priceOf(made))],
  ["a due 1-hour call is locked at the real start price and scored at the exact end price", r1.status === "scored" && near(r1.patch.p0, p0) && near(r1.patch.actual, real) && near(r1.patch.sigmaD, sigma)],
  ["its closeness label and % off match the scoring module", r1.patch.label === want.label && near(r1.patch.pctOff, want.pctOff)],
  ["a call that isn't due yet is locked and stays open", r2.status === "open" && near(r2.patch.p0, priceOf(made2)) && r2.patch.actual === undefined],
  ["a call the price moved onto before the lock still counts (it keeps its direction; no 'too close' void)", r3.status === "open" && near(r3.patch.p0, priceOf(made2))],
  ["the start price is the open of the first full candle after the call; until that candle is out, it waits", near(r3b.patch.p0, priceOf(made2 + MIN)) && r3c.status === "open" && r3c.patch.p0 === undefined],
  ["the lock records what the market had just done (the last day's move and the 90-day trend)", [-1, 0, 1].includes(r3.patch.prev) && [-1, 0, 1].includes(r3.patch.tr90)],
  ["a typo-sized call is voided", r4.status === "void" && /far outside/.test(r4.patch.voidReason)],
  ["a call scored two days late uses 15-minute candles at its exact target time", r5.status === "scored" && near(r5.patch.actual, priceOf(Math.floor(due5 / (15 * MIN)) * 15 * MIN))],
  ["nothing is scored until a minute after the target time", r6.status === "open" && r6.patch.actual === undefined],
  ["data job: the due call moves to results, the other stays open with its start price locked", res.length === 1 && res[0].status === "scored" && openLeft.length === 1 && openLeft[0].id === "BTC_1d" && near(openLeft[0].p0, priceOf(made2))],
  ["data job: the score (v2) is written to the account, and only for accounts with results", store.get("accounts/u1").pscore?.v === 2 && store.get("accounts/u1").pscore?.score >= 550 && store.get("accounts/u1").pscore?.score < 650 && store.get("accounts/u1").pscore?.flag === null && store.get("accounts/u1").pscore?.n === 1 && store.get("accounts/u1").pscore?.provisional === true && !store.get("accounts/u2").pscore],
  ["15-minute run: finds the still-open call through one query and leaves it open, scoring nothing twice", quick.scored === 0 && quick.void === 0 && (await db.list("accounts/u1/predictions")).length === 1 && (await db.list("accounts/u1/results")).length === 1],
  ["data job: each coin and candle size is fetched once per run", new Set(calls).size === calls.length && tally.scored === 1 && tally.locked === 2],
];
let ok = 0; for (const [n, pass] of checks) { if (pass) ok++; else console.log("FAIL predict: " + n); }
if (process.argv.includes("-v")) for (const [n, pass] of checks) console.log(`${pass ? "ok  " : "FAIL"} ${n}`);
console.log(`predict: ${ok}/${checks.length} checks passed`);
process.exit(ok === checks.length ? 0 : 1);
