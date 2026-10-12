// Group challenges, every 15 minutes with the prediction run: scores each sealed pick, then reveals a challenge's
// results to its group once every pick is in, adds the points to the group's table and tells the members.
//
// Firestore layout (see firestore.rules):
//   groups/{g}                         name, owner, ownerName, members {account: username}, table (points, written here)
//   groups/{g}/challenges/{c}          coin, horizon, by, at, joinUntil, endAt, picked {account: username}, status, results
//   accounts/{acct}/picks/{c}          one sealed pick: g, c, target, counts, createdAt, endAt (+ the outcome, written here)
// Picks are deleted once their challenge is revealed (the results keep what's needed); a pick that counts to the public
// score is also an ordinary prediction, settled by predictions.mjs.
import { settle, SETTLE_DELAY } from "../../web/js/predict.js";
import { challengeResults, addPoints } from "../../web/js/score.js";
import { runRows } from "./predictions.mjs";

export { challengeResults, addPoints };
export { POINTS } from "../../web/js/score.js";
const PERIOD = { "1h": "1-hour", "1d": "1-day", "1y": "1-year" };

// notify(accounts, { title, body }): push to those accounts' phones (a no-op without a service account).
export async function settleChallenges(db, { now = Date.now(), fetchRows, log = console.log, rows = runRows(fetchRows, log), notify = async () => {} } = {}) {
  // Only open challenges have picks (picks are deleted when a challenge is revealed), so the picks say which challenges
  // to read: reads stay proportional to what's open, not to every challenge ever played.
  const picks = await db.group("picks");
  const paths = [...new Set(picks.filter((p) => p.g && p.c).map((p) => `groups/${p.g}/challenges/${p.c}`))];
  const challenges = await Promise.all(paths.map(async (path) => (await db.get(path)) || { path, id: path.split("/").pop(), status: "gone" }));
  const tally = { picks: 0, revealed: 0, started: 0, tidied: 0 }, iso = new Date(now).toISOString();
  // 1. move every sealed pick forward: lock its start price, score it once the shared end time has passed
  for (const p of picks) {
    if (p.status === "scored" || p.status === "void") continue;
    const { id, path, ...doc } = p;
    let res; try { res = await settle(doc, { now, rows }); } catch (e) { log(`challenges: pick ${path} skipped: ${e.message}`); continue; }
    if (Object.keys(res.patch).length) { await db.set(path, res.patch); Object.assign(p, res.patch); tally.picks++; }
  }
  // 2. challenges: tell members a new one started; reveal finished ones
  const groups = new Map();
  const groupOf = async (g) => { if (!groups.has(g)) groups.set(g, await db.get(`groups/${g}`)); return groups.get(g); };
  for (const ch of challenges) {
    const g = ch.path.split("/")[1], mine = picks.filter((p) => p.g === g && p.c === ch.id);
    if (ch.status === "gone") { for (const p of mine) await db.del(p.path); tally.tidied++; continue; } // the challenge was removed
    if (ch.status !== "open") continue;
    const grp = await groupOf(g);
    if (!grp) { for (const p of mine) await db.del(p.path); await db.del(ch.path); tally.tidied++; continue; } // its group is gone
    const members = Object.keys(grp.members || {}), what = `${ch.t} ${PERIOD[ch.horizon] || ch.horizon} challenge`;
    if (!ch.pushed) {
      const mins = Math.max(0, Math.round((Date.parse(ch.joinUntil) - now) / 60000));
      await notify(members.filter((a) => a !== ch.by), { title: `${grp.name}: new challenge`, body: `@${ch.byName} started a ${what}. ${mins >= 60 ? `${Math.round(mins / 60)} h` : `${mins} min`} left to make your pick.` });
      await db.set(ch.path, { pushed: true }); tally.started++;
    }
    if (now < Date.parse(ch.endAt) + SETTLE_DELAY) continue;
    if (mine.some((p) => p.status !== "scored" && p.status !== "void")) continue; // a price is still missing; next run
    const results = challengeResults(ch, mine), first = mine.filter((p) => p.status === "scored").sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt))[0];
    await db.set(ch.path, { status: "done", results, end: first?.actual ?? null, move: first ? Math.round((first.actual / first.p0 - 1) * 1e4) / 100 : null, doneAt: iso });
    if (results.length) {
      grp.table = addPoints(grp.table, results, ch.endAt.slice(0, 7));
      await db.set(`groups/${g}`, { table: grp.table });
    }
    await notify(members, { title: `${grp.name}: results are in`, body: `See how everyone did in the ${what}.` });
    for (const p of mine) await db.del(p.path);
    tally.revealed++;
  }
  log(`challenges: ${tally.picks} picks moved, ${tally.started} started, ${tally.revealed} revealed, ${tally.tidied} tidied`);
  return tally;
}

// Push to accounts' phones: one message per phone, dead tokens dropped from the account.
export function pusher(db, sa, sendPush, site = "") {
  const cache = new Map();
  return async (accts, { title, body }) => {
    for (const a of accts) {
      if (!cache.has(a)) cache.set(a, await db.get(`accounts/${a}`).catch(() => null));
      const acct = cache.get(a), tokens = Array.isArray(acct?.fcm) ? acct.fcm : [], dead = [];
      for (const t of tokens) if ((await sendPush(sa, t, { title, body, link: site ? site + "/#/predict" : undefined })) === "dead") dead.push(t);
      if (dead.length) { acct.fcm = tokens.filter((t) => !dead.includes(t)); await db.set(`accounts/${a}`, { fcm: acct.fcm }); }
    }
  };
}
