// Habit loop (web/js/habit.js, pipeline/lib/habit.mjs): streaks, the daily coin, crowd results, the record mix, the
// next band, what happened, the tendency line, the weekly recap and the morning summary. Run: node tests/habit.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as H from "../web/js/habit.js";
import { writeDaily, morningPush, isMorningRun } from "../pipeline/lib/habit.mjs";
import { record } from "../pipeline/lib/players.mjs";
import { voteItem, snapshotVotes, forumTopics, PRICE_TALK } from "../pipeline/lib/community.mjs";
import { groupStories } from "../pipeline/lib/news.mjs";

const verbose = process.argv.includes("-v");
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; if (verbose || !ok) console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `  [${detail}]` : ""}`); };
const DAY = 864e5, now = Date.parse("2026-10-14T08:00:00Z"); // 1:30 PM in India
const call = (iso, horizon = "1d", extra = {}) => ({ horizon, createdAt: iso, ...extra });

// streaks: Indian days, today or yesterday keeps it alive, only 1-day calls count
const st = H.streakOf([call("2026-10-14T01:00:00Z"), call("2026-10-13T05:00:00Z"), call("2026-10-12T19:00:00Z"), call("2026-10-10T05:00:00Z"), call("2026-10-11T05:00:00Z", "1h")], now);
check("streak: days in a row with a 1-day call, Indian time (19:00 UTC counts as the next day)", st.n === 2 && st.today && st.best === 2, JSON.stringify(st));
const st2 = H.streakOf([call("2026-10-13T05:00:00Z"), call("2026-10-12T05:00:00Z")], now);
check("streak: still alive today if yesterday had a call, and says today's is missing", st2.n === 2 && !st2.today, JSON.stringify(st2));
check("streak: broken after a missed day", H.streakOf([call("2026-10-12T05:00:00Z")], now).n === 0);
check("streak badges at 7, 30 and 100", JSON.stringify(H.streakBadges(31)) === JSON.stringify(["7-day streak", "30-day streak"]));

// the daily coin
const days = Array.from({ length: 16 }, (_, i) => H.dailyCoin(H.istDay(now + i * DAY)).t);
check("daily coin: one per day, every coin in the list in turn, the same for everyone", new Set(days.slice(0, 8)).size === 8 && days[0] === days[8] && H.DAILY_COINS.includes(days[0]), days.join(","));
check("daily coin: the day turns at midnight in India", H.istDay(Date.parse("2026-10-14T18:29:00Z")) === "2026-10-14" && H.istDay(Date.parse("2026-10-14T18:31:00Z")) === "2026-10-15");
const dc = H.dailyCoin("2026-10-13").key;
const r = (coin, label, created, extra = {}) => ({ status: "scored", horizon: "1d", coin, label, createdAt: created, ...extra });
const crowd = H.crowdOf([[r(dc, "Spot on", "2026-10-13T04:00:00Z"), r(dc, "Off", "2026-10-13T05:00:00Z")], [r(dc, "Close", "2026-10-13T06:00:00Z"), r("CRYPTO:NOPE", "Close", "2026-10-13T06:00:00Z"), r(dc, "Close", "2026-10-12T06:00:00Z"), { ...r(dc, "Close", "2026-10-13T06:00:00Z"), horizon: "1h" }]], "2026-10-13");
check("crowd: counts only that day's 1-day calls on that day's coin, as labels", crowd.n === 3 && crowd.labels["Spot on"] === 1 && crowd.labels.Close === 1 && crowd.labels.Off === 1, JSON.stringify(crowd));
check("crowd: never carries a price", !JSON.stringify(crowd).match(/target|actual|p0/));

// record, next band
check("mix: calls per label, Spot on → Far off, voided ones left out", JSON.stringify(H.mixOf([{ label: "Close" }, { label: "Close" }, { label: "Far off" }, { status: "void", label: "Close" }])) === "[0,0,2,0,1]");
const nb = H.nextBand(662);
check("next band: 662 is 38 points from Very good, 62% through Good", nb.name === "Very good" && nb.need === 38 && Math.abs(nb.share - 0.62) < 1e-9 && nb.here === "Good", JSON.stringify(nb));
check("next band: none above Exceptional; nothing without a score", H.nextBand(850).name === null && H.nextBand(null) === null);
const rec = record([r("CRYPTO:BTC", "Spot on", "2026-10-13T04:00:00Z")], now, [call("2026-10-14T04:00:00Z")]);
check("player card: carries the mix and a streak that counts calls still open", rec.mix[0] === 1 && rec.streak === 2, JSON.stringify(rec));

// facts after a call, tendency, recap, morning summary
const done = { status: "scored", horizon: "1d", coin: "CRYPTO:BTC", t: "BTC", p0: 100, actual: 103, target: 105, sigmaD: 0.02, createdAt: "2026-10-10T00:00:00Z", resolvedAt: "2026-10-11T00:01:00Z", label: "Close" };
const wh = H.whatHappened(done, [{ syms: ["CRYPTO:BTC"], ts: "2026-10-10T12:00:00Z" }, { syms: ["CRYPTO:BTC"], ts: "2026-10-12T12:00:00Z" }, { syms: ["CRYPTO:ETH"], ts: "2026-10-10T12:00:00Z" }]);
check("what happened: the move, in % and typical moves, and stories in that time, past tense", /rose 3\.0% over 1 day/.test(wh.text) && wh.news === 1 && /ran in that time/.test(wh.text), wh.text);
check("what happened: never says what to do next", !/should|buy|sell|will /i.test(wh.text));
const td = H.tendency(Array(10).fill(done));
check("tendency: needs 10 calls in a period, describes them plainly", H.tendency(Array(9).fill(done)) === null && /1-day calls expected a bigger move than happened in 10 of your last 10/.test(td.text), td?.text);
check("weekly recap: calls scored in the last 7 days", H.weekRecap([{ ...done, resolvedAt: "2026-10-13T00:00:00Z" }, { ...done, label: "Off", resolvedAt: "2026-10-12T00:00:00Z" }, { ...done, resolvedAt: "2026-10-01T00:00:00Z" }], now).text === "1 of 2 calls Close or better this week.");
const ms = H.morningSummary([{ ...done, resolvedAt: "2026-10-14T02:00:00Z" }, { ...done, label: "Spot on", resolvedAt: "2026-10-13T20:00:00Z" }, { ...done, resolvedAt: "2026-10-12T02:00:00Z" }], now);
check("morning summary: the calls scored since yesterday morning", ms.n === 2 && ms.body === "1 Spot on · 1 Close", JSON.stringify(ms));

// the data job's side
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-"));
const doc = writeDaily(dir, new Map([["a", [r(dc, "Close", "2026-10-13T06:00:00Z")]]]), now, () => {});
const file = JSON.parse(fs.readFileSync(path.join(dir, "daily.json")));
check("daily.json: today's and tomorrow's coin, and yesterday's crowd", file.today === H.dailyCoin("2026-10-14").key && file.tomorrow === H.dailyCoin("2026-10-15").key && file.crowd["2026-10-13"].n === 1, JSON.stringify(doc).slice(0, 160));
const morning = Date.parse("2026-10-14T02:17:00Z"); // 7:47 AM in India
check("morning run: only the run between 7 and 9:30 AM India time", isMorningRun(morning) && !isMorningRun(now));
const sent = [], writes = [];
const db = { set: async (p, d) => writes.push([p, d]) };
const accts = [{ id: "a", fcm: ["t1", "t2"] }, { id: "b", fcm: ["t3"], lastMorning: "2026-10-14" }, { id: "c" }];
const scoredBy = new Map([["a", [{ ...done, resolvedAt: "2026-10-14T01:00:00Z" }]], ["b", [{ ...done, resolvedAt: "2026-10-14T01:00:00Z" }]]]);
await morningPush(db, accts, scoredBy, async (t, msg) => { sent.push([t, msg]); return t === "t2" ? "dead" : "ok"; }, { now: morning, log: () => {} });
check("morning push: one summary per player with results, once a day, dead tokens dropped", sent.length === 2 && sent[0][1].title === "Your BTC call was scored" && writes.length === 1 && writes[0][1].lastMorning === "2026-10-14" && JSON.stringify(writes[0][1].fcm) === '["t1"]', JSON.stringify({ sent, writes }));

// community: governance votes and forum topics, facts only, no price talk
const v = voteItem({ id: "0xab", title: "Activate the fee switch", state: "closed", start: 1791000000, end: 1791400000, choices: ["For", "Against"], scores: [820, 180], scores_total: 1000, space: { id: "uniswapgovernance.eth", name: "Uniswap" } }, now);
check("community: a closed vote reads as a fact with the leading choice's share", v.title === "Uniswap vote closed: “Activate the fee switch” · For 82%" && v.community && v.url.includes("uniswapgovernance.eth/proposal/0xab"), v?.title);
check("community: votes or topics about prices or trading are dropped", voteItem({ id: "1", title: "Set a token price floor", state: "active", space: { id: "x" } }, now) === null && PRICE_TALK.test("Is it time to buy?") && !PRICE_TALK.test("EIP-7702 call for input"));
let asked = null;
const sv = await snapshotVotes(["UNI", "BTC"], { now, log: () => {}, fetchFn: async (u, o) => { asked = JSON.parse(o.body).query; return { ok: true, json: async () => ({ data: { proposals: [{ id: "9", title: "Grant program renewal", state: "active", start: 1791900000, end: 1792300000, space: { id: "uniswapgovernance.eth", name: "Uniswap DAO" } }] } }) }; } });
check("community: one Snapshot query for the followed coins' spaces, matched back to the coin", asked.includes("uniswapgovernance.eth") && sv.length === 1 && sv[0].sym === "CRYPTO:UNI" && sv[0].title.startsWith("Uniswap vote open until"), JSON.stringify(sv));
const ft = await forumTopics("ETH", async (url, label) => [{ title: "EIP-1234: new opcode", url: url + "/t/1", date: "2026-10-13", ts: "2026-10-13T00:00:00Z" }, { title: "ETH price thread", url: url + "/t/2", date: "2026-10-13", ts: "2026-10-13T01:00:00Z" }]);
check("community: forum topics keep title and link only, price talk left out", ft.length === 2 && ft.every((x) => x.community && !/price/i.test(x.title) && !x.intro), JSON.stringify(ft.map((x) => x.title)));
const gs = groupStories([{ ...ft[0], sym: "CRYPTO:ETH" }]);
check("community: shown as its own kind of story, never as outlet confirmation", gs[0].status === "community" && gs[0].outlets.length === 0 && gs[0].community.includes("Ethereum Magicians"), JSON.stringify(gs[0]).slice(0, 200));

console.log(`habit: ${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
