// The habit loop (1.1.0): streaks, the daily coin, how the crowd did on it, the "what happened" facts after a scored
// call, the "your calls tend to…" line, the weekly recap and the morning results summary. Plain ES module with no
// dependencies on the page, shared by the app and the data job. Everything here describes the past: no advice, no
// forecasts, and never anyone's price call.
import { HORIZONS, CLOSENESS_LABELS, BANDS, SCORE_MAX, typicalMove, isRight } from "./score.js";

const DAY = 864e5, IST = 5.5 * 36e5;
export const LABELS = CLOSENESS_LABELS.map(([, l]) => l); // Spot on, Very close, Close, Off, Far off
const CLOSE = new Set(LABELS.slice(0, 3));
const ADJ = { "30m": "30-minute", "1h": "1-hour", "1d": "1-day", "1y": "1-year" };

// ---------- days: everyone shares one calendar day, Indian time (so the daily coin and streaks agree for everyone)
export const istDay = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const dayNum = (d) => Math.round(Date.parse(d + "T00:00:00Z") / DAY);
const numDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const msUntilNextDay = (now = Date.now()) => (dayNum(istDay(now)) + 1) * DAY - IST - now;

// ---------- streaks: consecutive days with at least one 1-day call made (scored, open or not counted)
export const STREAK_BADGES = [7, 30, 100];
export function streakOf(calls, now = Date.now()) {
  const days = new Set(calls.filter((c) => c?.horizon === "1d" && c.createdAt).map((c) => dayNum(istDay(Date.parse(c.createdAt)))));
  const today = dayNum(istDay(now));
  let n = 0, d = days.has(today) ? today : today - 1; // a streak stays alive until the end of today
  while (days.has(d)) { n++; d--; }
  let best = 0, run = 0, prev = null;
  for (const x of [...days].sort((a, b) => a - b)) { run = prev === x - 1 ? run + 1 : 1; best = Math.max(best, run); prev = x; }
  return { n, best, today: days.has(today) };
}
export const streakBadges = (best) => STREAK_BADGES.filter((b) => best >= b).map((b) => `${b}-day streak`);

// ---------- the daily coin: one coin a day for everyone, rotating through major coins (always on Kraken)
export const DAILY_COINS = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "LINK", "TRX"];
export const DAILY_NAMES = { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", XRP: "XRP", BNB: "BNB", DOGE: "Dogecoin", LINK: "Chainlink", TRX: "TRON" };
export function dailyCoin(day) {
  const t = DAILY_COINS[((dayNum(day) % DAILY_COINS.length) + DAILY_COINS.length) % DAILY_COINS.length];
  return { key: `CRYPTO:${t}`, t, n: DAILY_NAMES[t], m: "CRYPTO", ty: "C" };
}
// A daily-coin call is simply a 1-day call on that day's coin, made that day (no extra data is stored).
export const isDailyCall = (p) => p?.horizon === "1d" && p.createdAt && dailyCoin(istDay(Date.parse(p.createdAt))).key === p.coin;
// How everyone did on one day's coin, from everyone's scored results: label counts only.
export function crowdOf(resultsByAccount, day) {
  const coin = dailyCoin(day).key, labels = Object.fromEntries(LABELS.map((l) => [l, 0]));
  let n = 0;
  for (const rs of resultsByAccount) for (const r of rs) {
    if (r.status !== "scored" || r.horizon !== "1d" || r.coin !== coin || istDay(Date.parse(r.createdAt)) !== day || !(r.label in labels)) continue;
    labels[r.label]++; n++;
  }
  return { coin, n, labels };
}

// ---------- your record: how many calls landed at each closeness
export function mixOf(results) {
  const m = Object.fromEntries(LABELS.map((l) => [l, 0]));
  for (const r of results) if (r.status !== "void" && r.label in m) m[r.label]++;
  return LABELS.map((l) => m[l]);
}
// The band above a score and how far there is to go: { name, need, share } (share = progress through this band).
export function nextBand(score) {
  if (score == null) return null;
  const asc = [...BANDS].reverse(); // Below guessing 300 … Proven 650
  const i = asc.findIndex(([min], k) => score >= min && (k === asc.length - 1 || score < asc[k + 1][0]));
  if (i === asc.length - 1) return { name: null, need: 0, share: Math.min(1, (score - asc[i][0]) / (SCORE_MAX - asc[i][0])) };
  const [lo] = asc[i], [hi, name] = asc[i + 1];
  return { name, need: hi - score, share: (score - lo) / (hi - lo), from: lo, to: hi, here: asc[i][1] };
}

// ---------- what happened over a scored call's period: facts only, in the past tense
// stories: news stories ({ syms, at|time }) to count those about the coin during the period.
export function whatHappened(r, stories = []) {
  if (r?.status !== "scored" || !(r.p0 > 0) || !(r.actual > 0)) return null;
  const went = (r.actual / r.p0 - 1) * 100, m = typicalMove(r.sigmaD, r.horizon), moves = Math.abs(Math.log(r.actual / r.p0)) / m;
  const from = Date.parse(r.createdAt), to = Date.parse(r.resolvedAt || r.createdAt) || from;
  const news = stories.filter((s) => (s.syms || []).includes(r.coin) && (t => t >= from && t <= to)(Date.parse(s.ts || s.date || 0))).length;
  const size = moves < 0.5 ? "a small move" : moves < 1.25 ? "about a typical move" : "a bigger move than usual";
  return { went, moves, news, text: `${r.t} ${went >= 0 ? "rose" : "fell"} ${Math.abs(went).toFixed(Math.abs(went) < 10 ? 1 : 0)}% over ${HORIZONS[r.horizon].label}, ${size} for it (${moves.toFixed(1)} typical moves).${news ? ` ${news} news stor${news === 1 ? "y" : "ies"} about it ran in that time.` : ""}` };
}

// ---------- "your calls tend to…": a plain description of your own last calls in one period (needs 10)
export function tendency(results, horizon = null) {
  const per = Object.keys(HORIZONS).map((h) => [h, results.filter((r) => r.status === "scored" && r.horizon === h && r.p0 > 0 && r.actual > 0)])
    .filter(([h, xs]) => xs.length >= 10 && (!horizon || h === horizon)).sort((a, b) => b[1].length - a[1].length);
  if (!per.length) return null;
  const [h, all] = per[0], xs = all.slice(0, 10), name = ADJ[h];
  const bigger = xs.filter((r) => Math.abs(Math.log(r.target / r.p0)) > Math.abs(Math.log(r.actual / r.p0))).length;
  const right = xs.filter(isRight).length;
  const size = bigger >= 7 ? `expected a bigger move than happened in ${bigger} of your last 10`
    : bigger <= 3 ? `expected a smaller move than happened in ${10 - bigger} of your last 10` : `were about evenly split between expecting too big and too small a move`;
  return { horizon: h, text: `Your ${name} calls ${size}. The direction matched what happened in ${right} of 10.` };
}

// ---------- the week: your calls scored in the last 7 days
export function weekRecap(results, now = Date.now()) {
  const xs = results.filter((r) => r.status === "scored" && Date.parse(r.resolvedAt) > now - 7 * DAY && Date.parse(r.resolvedAt) <= now);
  if (!xs.length) return null;
  const close = xs.filter((r) => CLOSE.has(r.label)).length, spot = xs.filter((r) => r.label === "Spot on").length;
  return { n: xs.length, close, spot, text: `${close} of ${xs.length} call${xs.length === 1 ? "" : "s"} Close or better this week${spot ? `, ${spot} Spot on` : ""}.` };
}

// ---------- the morning summary: calls scored since the last morning, for one notification
export function morningSummary(results, now = Date.now()) {
  const xs = results.filter((r) => r.status === "scored" && Date.parse(r.resolvedAt) > now - DAY && Date.parse(r.resolvedAt) <= now);
  if (!xs.length) return null;
  const counts = LABELS.map((l) => [l, xs.filter((r) => r.label === l).length]).filter(([, n]) => n);
  return { n: xs.length, title: xs.length === 1 ? `Your ${xs[0].t} call was scored` : `${xs.length} of your calls were scored`, body: counts.map(([l, n]) => `${n} ${l}`).join(" · ") };
}
