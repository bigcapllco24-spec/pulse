// Prediction game: locking the start price and resolving predictions from Kraken's public candles. Shared by the
// data job (live accounts) and the app (demo mode), so both settle predictions exactly the same way.
//
// A prediction is made with the price the app showed. The real start price is then locked from Kraken's candles: the
// open of the first full candle after the call was made (at most a minute later normally, a price nobody could see
// when calling). The end price is taken at the exact target time: 1-minute candles when they still exist (Kraken keeps
// the last 12 hours), otherwise the finest candles that still cover that moment.
import { HORIZONS, MAX_MOVE, PICK_MIN_MOVE, typicalMove, dueAt, dailyVol, scorePrediction, callDir } from "./score.js";

export const KRAKEN_PAIR = { BTC: "XBTUSD", DOGE: "XDGUSD", RNDR: "RENDERUSD" };
export const krakenPair = (t) => KRAKEN_PAIR[t] || t + "USD";
// Kraken returns the latest 720 candles at each size, so each size reaches back 720 × its length.
const LADDER = [1, 15, 60, 240, 1440]; // candle size in minutes
const KEEP = 720;
const MIN = 60e3, DAY = 864e5;
// A price that moved between seeing it and the lock is fine (the call keeps its direction); only a call clearly outside
// what the coin can do is voided.
export const LOCK_TOLERANCE = { max: MAX_MOVE * 1.5, pickMin: PICK_MIN_MOVE * 0.5 };
export const SETTLE_DELAY = MIN; // wait a minute after the target time so its candle exists
export const GIVE_UP_AFTER = 7 * DAY; // a price still missing a week later voids the prediction

// Kraken OHLC rows: [time (s), open, high, low, close, vwap, volume, count], oldest first.
export async function krakenRows(t, minutes, fetchFn = fetch) {
  const r = await fetchFn(`https://api.kraken.com/0/public/OHLC?pair=${krakenPair(t)}&interval=${minutes}`);
  const j = await r.json();
  if (j.error?.length) throw new Error(j.error.join(", "));
  return Object.entries(j.result).find(([k]) => k !== "last")?.[1] || [];
}
// The finest candle size that still covers a moment, or null when it's too long ago.
export function intervalFor(tMs, now) {
  for (const iv of LADDER) if (now - tMs < (KEEP - 2) * iv * MIN) return iv;
  return null;
}
// The price at a moment: the open of the candle that contains it (at most one candle's length old),
// or, if that candle is missing, the close of the latest candle before it.
export function priceAt(rows, tMs, iv) {
  const len = iv * MIN, start = Math.floor(tMs / len) * len;
  let best = null;
  for (const r of rows) { if (r[0] * 1000 <= tMs) best = r; else break; }
  if (!best) return null;
  const s = best[0] * 1000;
  if (s === start) return +best[1];
  return tMs - s < 3 * len ? +best[4] : null;
}
// The open of the first full candle starting at or after a moment, or null while it isn't out yet.
export function openAfter(rows, tMs, iv) {
  const len = iv * MIN, start = Math.ceil(tMs / len) * len;
  const r = rows.find((x) => x[0] * 1000 >= start);
  return r && r[0] * 1000 - start < 3 * len ? +r[1] : null;
}
// Daily volatility as it stood when the prediction was made: the 30 full days before that day.
export function sigmaBefore(dailyRows, createdAt) {
  const day = Math.floor(Date.parse(createdAt) / DAY) * DAY;
  return dailyVol(dailyRows.filter((r) => r[0] * 1000 < day).map((r) => +r[4]));
}
// What the market had just done when the call was made (UTC days): prev, the sign of the last full day's move; tr90, the
// sign of the 90 days before the call's day. Each -1, 0 or 1, or null without enough history.
export function contextAt(dailyRows, createdAt) {
  const day = Math.floor(Date.parse(createdAt) / DAY) * DAY, c = new Map(dailyRows.map((r) => [r[0] * 1000, +r[4]]));
  const at = (k) => c.get(day - k * DAY), sign = (a, b) => (a != null && b != null ? Math.sign(a - b) : null);
  return { prev: sign(at(1), at(2)), tr90: sign(at(1), at(91)) };
}

// Moves one prediction forward as far as it can go right now.
// p: { coin, t, horizon, target, createdAt, endAt? (a group challenge's shared end time), p0?, sigmaD? }. rows(t, minutes) → Kraken rows (cache them per run).
// Returns { status: "open" | "scored" | "void", patch } where patch holds the fields to add to the prediction.
export async function settle(p, { now = Date.now(), rows }) {
  const patch = {}, iso = new Date(now).toISOString();
  const voided = (reason) => ({ status: "void", patch: { ...patch, status: "void", voidReason: reason, resolvedAt: iso } });
  if (!HORIZONS[p.horizon] || !(p.target > 0)) return voided("This prediction wasn't valid.");
  let cur = p;
  if (cur.p0 == null) { // 1. lock the start price, the volatility and what the market had just done
    const made = Date.parse(cur.createdAt), iv = intervalFor(made, now);
    if (!iv) return voided("The price at the time it was made couldn't be found.");
    const p0 = openAfter(await rows(cur.t, iv), made, iv);
    if (p0 == null) return now - made > GIVE_UP_AFTER ? voided("The price at the time it was made couldn't be found.") : { status: "open", patch };
    const daily = await rows(cur.t, 1440), sigmaD = sigmaBefore(daily, cur.createdAt);
    if (sigmaD == null) return voided("This coin didn't have enough price history yet.");
    Object.assign(patch, { p0, sigmaD, ...contextAt(daily, cur.createdAt), lockedAt: iso });
    cur = { ...cur, p0, sigmaD };
    const moves = Math.abs(Math.log(cur.target / p0)) / typicalMove(sigmaD, cur.horizon);
    if (callDir(cur) !== 0 && moves > LOCK_TOLERANCE.max) return voided("The call was far outside how much this coin moves in that time.");
    if (cur.clientP0 == null && moves < LOCK_TOLERANCE.pickMin) return voided("The price moved before it was locked in, so the pick ended up too close to it."); // group picks only
  }
  // 2. resolve once the target time has passed
  const due = Date.parse(dueAt(cur));
  if (now < due + SETTLE_DELAY) return { status: "open", patch };
  const iv = intervalFor(due, now);
  const actual = iv ? priceAt(await rows(cur.t, iv), due, iv) : null;
  if (actual == null) return now - due > GIVE_UP_AFTER || !iv ? voided("The price at the end couldn't be found.") : { status: "open", patch };
  const s = scorePrediction({ ...cur, actual });
  Object.assign(patch, { status: "scored", actual, resolvedAt: iso, pctOff: s.pctOff, label: s.label });
  return { status: "scored", patch };
}

// A cache for one settling run, so each coin and candle size is fetched once.
export function rowCache(fetchRows) {
  const m = new Map();
  return (t, iv) => { const k = `${t}:${iv}`; if (!m.has(k)) m.set(k, fetchRows(t, iv)); return m.get(k); };
}
