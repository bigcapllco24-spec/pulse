// Group challenges, player cards and the leaderboard, with simulated Kraken candles and an in-memory Firestore:
// sealed picks scored at one shared end time, results ranked and revealed, points added, pushes sent, player cards
// and the public board written, groups tidied.
import { settle, rowCache, sigmaBefore } from "../web/js/predict.js";
import { dueAt, typicalMove } from "../web/js/score.js";
import { settleChallenges, challengeResults, addPoints, POINTS } from "../pipeline/lib/challenges.mjs";
import { publishPlayers, tidyGroups, record } from "../pipeline/lib/players.mjs";

const MIN = 60e3, DAY = 864e5, NOW = Date.parse("2026-10-11T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const priceOf = (ms) => 100 * Math.exp(0.0001 * (Math.floor(ms / MIN) - NOW / MIN));
function rows(t, iv, now = NOW) {
  const len = iv * MIN, end = Math.floor(now / len) * len, out = [];
  for (let k = 719; k >= 0; k--) {
    const s = end - k * len, o = iv === 1440 ? 100 * (k % 2 ? 1.02 : 1) : priceOf(s), c = iv === 1440 ? 100 * (k % 2 ? 1 : 1.02) : priceOf(s + len - MIN);
    out.push([s / 1000, String(o), String(Math.max(o, c)), String(Math.min(o, c)), String(c), String(c), "10", 5]);
  }
  return out;
}
const fake = (now) => async (t, iv) => rows(t, iv, now);
const sigma = sigmaBefore(rows("BTC", 1440), iso(NOW)), tm = typicalMove(sigma, "1h");

// in-memory Firestore, with the same calls as pipeline/lib/google.mjs
const store = new Map();
const db = {
  async get(path) { return store.has(path) ? { id: path.split("/").pop(), path, ...store.get(path) } : null; },
  async group(id) { return [...store].filter(([k]) => k.split("/").at(-2) === id).map(([k, v]) => ({ id: k.split("/").pop(), path: k, ...v })); },
  async list(coll) { const pre = coll + "/"; return [...store].filter(([k]) => k.startsWith(pre) && !k.slice(pre.length).includes("/")).map(([k, v]) => ({ id: k.slice(pre.length), path: k, ...v })); },
  async set(path, data) { store.set(path, { ...(store.get(path) || {}), ...data }); },
  async del(path) { store.delete(path); },
};

// 1. an end time shared by the group overrides a prediction's own period
const made = NOW - 3 * 3600e3, endAt = iso(made + 2 * 3600e3); // a 1-hour challenge that someone joined an hour late
const shared = await settle({ coin: "CRYPTO:BTC", t: "BTC", horizon: "1h", target: priceOf(made) * Math.exp(tm), createdAt: iso(made), endAt }, { now: NOW, rows: rowCache(fake(NOW)) });

// 2. a group, a challenge and three picks: close up, far down, and a typo far outside what the coin can do
const at = NOW - 90 * MIN, end = at + 60 * MIN, g = "g".repeat(20), c = "c".repeat(20);
store.set(`groups/${g}`, { name: "Weekend crew", owner: "a1", ownerName: "asha", members: { a1: "asha", a2: "veer", a3: "rohan", a4: "dev" } });
store.set(`groups/${g}/challenges/${c}`, { coin: "CRYPTO:BTC", t: "BTC", horizon: "1h", by: "a1", byName: "asha", at: iso(at), joinUntil: iso(at + 20 * MIN), endAt: iso(end), picked: { a1: "asha", a2: "veer", a3: "rohan" }, status: "open" });
const pick = (a, target, mins, counts) => store.set(`accounts/${a}/picks/${c}`, { g, c, coin: "CRYPTO:BTC", t: "BTC", horizon: "1h", target, counts, createdAt: iso(at + mins * MIN), endAt: iso(end) });
pick("a1", priceOf(end) * 1.0001, 0, true); // nearly exact, called up
pick("a2", priceOf(at + 5 * MIN) * Math.exp(-2 * tm), 5, false); // two typical moves down: wrong way
pick("a3", 1, 10, false); // "$1": voided at the lock
store.set(`groups/${g}/challenges/${"d".repeat(20)}`, { t: "ETH", horizon: "1d", by: "a1", byName: "asha", at: iso(NOW - 10 * MIN), joinUntil: iso(NOW + 110 * MIN), endAt: iso(NOW + DAY - 10 * MIN), picked: { a1: "asha" }, status: "open" });
store.set(`accounts/a1/picks/${"d".repeat(20)}`, { g, c: "d".repeat(20), coin: "CRYPTO:ETH", t: "ETH", horizon: "1d", target: 1, counts: false, createdAt: iso(NOW - 10 * MIN), endAt: iso(NOW + DAY - 10 * MIN) });
store.set(`groups/${"z".repeat(20)}/challenges/${"e".repeat(20)}`, { t: "BTC", horizon: "1h", by: "x", status: "open", endAt: iso(NOW), joinUntil: iso(NOW), picked: { x: "x" } }); // its group was deleted
store.set(`accounts/x/picks/${"e".repeat(20)}`, { g: "z".repeat(20), c: "e".repeat(20), coin: "CRYPTO:BTC", t: "BTC", horizon: "1h", target: 1, counts: false, createdAt: iso(NOW - 60 * MIN), endAt: iso(NOW) });
store.set(`accounts/y/picks/${"f".repeat(20)}`, { g: "y".repeat(20), c: "f".repeat(20), coin: "CRYPTO:BTC", t: "BTC", horizon: "1h", target: 1, counts: false, createdAt: iso(NOW - 60 * MIN), endAt: iso(NOW) }); // its challenge is gone
const reads = []; const get0 = db.get; db.get = async (p) => (reads.push(p), get0(p));
const pushes = [];
const t1 = await settleChallenges(db, { now: NOW, fetchRows: fake(NOW), log: () => {}, notify: async (accts, m) => pushes.push([accts.slice().sort().join(","), m.title]) });
const ch = store.get(`groups/${g}/challenges/${c}`), table = store.get(`groups/${g}`).table, chD = store.get(`groups/${g}/challenges/${"d".repeat(20)}`);
db.get = get0;
const picksGone = !store.has(`accounts/a1/picks/${c}`) && !store.has(`accounts/a2/picks/${c}`), orphanGone = !store.has(`groups/${"z".repeat(20)}/challenges/${"e".repeat(20)}`) && !store.has(`accounts/x/picks/${"e".repeat(20)}`) && !store.has(`accounts/y/picks/${"f".repeat(20)}`);

// 3. results ranking on its own
const ranked = challengeResults({ picked: { x: "x", y: "y" } }, [
  { path: "accounts/x/picks/c", status: "scored", horizon: "1d", p0: 100, target: 110, actual: 101, sigmaD: 0.03, createdAt: iso(NOW) },
  { path: "accounts/y/picks/c", status: "scored", horizon: "1d", p0: 100, target: 101.2, actual: 101, sigmaD: 0.03, createdAt: iso(NOW + MIN) },
]);
const pts = addPoints({ a1: { all: 4, mpts: 4, m: "2026-09" } }, [{ a: "a1", pts: 6 }, { a: "a9", pts: 1 }], "2026-10");

// 4. player cards and the board
store.clear();
const results = (n, label, h = "1d") => Array.from({ length: n }, () => ({ label, horizon: h }));
const accounts = [
  { id: "a1", username: "asha", public: true, pscore: { score: 812, band: "Exceptional", provisional: false, n: 12 }, following: ["a2"], createdAt: "2026-10-01T00:00:00Z" },
  { id: "a2", username: "veer", public: true, pscore: { score: 700, band: "Very good", provisional: false, n: 15 }, following: ["a1", "a1", "a2"] },
  { id: "a3", username: "rohan", public: false, pscore: { score: 900, band: "Exceptional", provisional: false, n: 30 }, following: ["a1"] },
  { id: "a4", username: "newbie", public: true, pscore: { score: 600, band: "Good", provisional: true, n: 3 } },
  { id: "a5", following: ["a1"] }, // no username yet: no card, but its follow counts
];
store.set("players/gone", { u: "old" });
const p1 = await publishPlayers(db, accounts, new Map([["a1", [...results(6, "Spot on"), ...results(6, "Off", "1h")]]]), { now: NOW, log: () => {} });
const card = store.get("players/a1"), board = store.get("boards/public");
const p2 = await publishPlayers(db, accounts, new Map([["a1", [...results(6, "Spot on"), ...results(6, "Off", "1h")]]]), { now: NOW + 3600e3, log: () => {} });

// 5. groups tidied
store.set("groups/g1", { name: "A", owner: "gone", ownerName: "x", members: { gone: "x", a1: "old_name", a2: "veer" } });
store.set("groups/g2", { name: "B", owner: "gone", ownerName: "x", members: { gone: "x" } });
store.set("groups/g3", { name: "C", owner: "a1", ownerName: "asha", members: { a1: "asha" } });
const tg = await tidyGroups(db, accounts, { log: () => {} });

const checks = [
  ["a pick in a group challenge is scored at the shared end time, not at its own period", shared.status === "scored" && near(shared.patch.actual, priceOf(Date.parse(endAt))) && dueAt({ endAt, createdAt: iso(made), horizon: "1h" }) === endAt],
  ["a finished challenge is revealed: ranked results with how close and which way, never a price", ch.status === "done" && ch.results.length === 3 && ch.results[0].a === "a1" && ch.results[0].label === "Spot on" && ch.results.every((r) => !("target" in r) && !("actual" in r) && !("p0" in r))],
  ["points: 5 for Spot on + 1 for the right direction; a wrong-way far call earns its label's points only; a voided pick 0 and no rank", ch.results[0].pts === 6 && ch.results[0].right === true && ch.results[1].right === false && ch.results[1].pts === POINTS[ch.results[1].label] && ch.results[2].label === "Not counted" && ch.results[2].pts === 0 && ch.results[2].rank === null],
  ["results keep whether each pick counted to the public score", ch.results.find((r) => r.a === "a1").counts === true && ch.results.find((r) => r.a === "a2").counts === false],
  ["the group's table gets the points, for all time and this month", table.a1.all === 6 && table.a1.mpts === 6 && table.a1.m === "2026-10" && table.a2.all === ch.results[1].pts],
  ["revealed picks are deleted; the challenge still taking picks keeps its pick list", picksGone && chD.status === "open"],
  ["members are told about a new challenge (not its starter) and everyone about results, once", pushes.some(([a, t]) => a === "a2,a3,a4" && /new challenge/.test(t)) && pushes.some(([a, t]) => a === "a1,a2,a3,a4" && /results are in/.test(t)) && chD.pushed === true && t1.revealed === 1],
  ["a challenge whose group was deleted is tidied away with its picks, and so are picks whose challenge is gone", orphanGone && t1.tidied === 2],
  ["only challenges that still have picks are read (not every challenge ever played)", reads.filter((p) => p.includes("/challenges/")).length === 4],
  ["ranking: more points first, then the smaller miss", ranked[0].a === "y" && ranked[0].rank === 1 && ranked[1].rank === 2],
  ["points table: a new month starts the month's points again; new members join it", pts.a1.all === 10 && pts.a1.mpts === 6 && pts.a9.all === 1],
  ["player cards: one per username, with followers counted once each from everyone's lists (not your own)", card.u === "asha" && card.followers === 3 && store.get("players/a2").followers === 1 && !store.has("players/a5") && !store.has("players/gone")],
  ["public board: only public players with 10+ scored calls, best first; private and provisional players left out", board.rows.map((r) => r.u).join() === "asha,veer" && board.of === 2 && card.rank === 1 && store.get("players/a3").rank === null && store.get("players/a4").rank === null],
  ["a card holds the record (Spot on count, share Close or better, best period, badges) and never a price", card.spot === 6 && card.closePlus === 50 && card.best === "1d" && card.badges.includes("First Spot on") && card.badges.includes("10 scored") && !JSON.stringify(card).includes("target")],
  ["the card's score line keeps one point per day; nothing is rewritten when nothing changed", card.line.length === 1 && p2.wrote === 0 && p1.wrote === 4],
  ["record: the best period needs 3 results", record([{ label: "Spot on", horizon: "1y" }]).best === null],
  ["groups: names follow usernames, a gone owner hands over, empty groups are removed", store.get("groups/g1").owner === "a1" && store.get("groups/g1").members.a1 === "asha" && !("gone" in store.get("groups/g1").members) && store.get("groups/g1").ownerName === "asha" && !store.has("groups/g2") && tg.changed === 1 && tg.removed === 1],
];
let ok = 0; for (const [n, pass] of checks) { if (pass) ok++; else console.log("FAIL social: " + n); }
if (process.argv.includes("-v")) for (const [n, pass] of checks) console.log(`${pass ? "ok  " : "FAIL"} ${n}`);
console.log(`social: ${ok}/${checks.length} checks passed`);
process.exit(ok === checks.length ? 0 : 1);
