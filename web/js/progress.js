// Levels (1.2.0): how much someone has played, never how good they are. Plain module shared by the app and the data job.
//  - Each scored call counts 1; 30-minute calls count ½; voided calls 0; at most 5 counted calls a day (Indian time).
//  - Level thresholds in counted calls: 1, 10, 30, 60, 100, 150, 210, 280, 360, 450, then +100 a level, for ever.
//  - Levels never go down and are never used for ranking.
//  - The avatar ring changes colour at levels 2, 4, 6, 9, 12, 16, 20, 25, 30… (gaps 2, 2, 3, 3, 4, 4…), through blue,
//    teal, green, gold, orange, rose, violet and white, then double rings.
import { istDay } from "./habit.js";

export const DAY_CAP = 5;
const BASE = [1, 10, 30, 60, 100, 150, 210, 280, 360, 450];
export const levelAt = (n) => (n < 1 ? 0 : n >= 450 ? 10 + Math.floor((n - 450) / 100) : BASE.filter((t) => n >= t).length);
export const callsFor = (level) => (level <= 0 ? 0 : level <= 10 ? BASE[level - 1] : 450 + (level - 10) * 100);

// Counted calls from scored results (each needs status, horizon, resolvedAt).
export function countedCalls(results) {
  const byDay = {};
  for (const r of results) {
    if (r.status !== "scored" || !r.resolvedAt) continue;
    const d = istDay(Date.parse(r.resolvedAt)), w = r.horizon === "30m" ? 0.5 : 1;
    byDay[d] = Math.min(DAY_CAP, (byDay[d] || 0) + w);
  }
  return Object.values(byDay).reduce((a, x) => a + x, 0);
}
export function levelOf(results) {
  const n = countedCalls(results), level = levelAt(n), next = callsFor(level + 1);
  return { level, n, next, toNext: Math.max(0, Math.ceil(next - n)) };
}

// Ring colours: a new one at level 2, 4, 6, 9, 12, 16, 20, 25, 30, 36, 42, 49… (gaps 2, 2, 3, 3, 4, 4…).
export const RING_NAMES = ["blue", "teal", "green", "gold", "orange", "rose", "violet", "white"];
export function ringLevels(count = 16) {
  const out = []; let l = 2, gap = 2, k = 0;
  while (out.length < count) { out.push(l); k++; l += gap; if (k % 2 === 0) gap++; }
  return out;
}
// Which ring a level wears: 0 = none (level 0–1), 1 = blue, … 8 = white, 9+ = double rings in the same order.
export function ringOf(level) {
  const ls = ringLevels(40);
  let k = 0; for (const l of ls) if (level >= l) k++;
  return k;
}
export const ringClass = (level) => { const k = ringOf(level); return k ? `ring r${((k - 1) % RING_NAMES.length) + 1}${k > RING_NAMES.length ? " dbl" : ""}` : ""; };
export const ringName = (level) => { const k = ringOf(level); return k ? RING_NAMES[(k - 1) % RING_NAMES.length] : null; };
// What unlocks at a level, in plain words (used by the level-up screen and You).
export const UNLOCKS = { 2: "Your score is no longer provisional, and you can join the public leaderboard.", 3: "Full breakdowns on You: what works for you and your strongest period." };
