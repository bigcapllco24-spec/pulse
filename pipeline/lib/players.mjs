// Player cards and the public leaderboard, every 2 hours with the data job (after scores are refreshed), plus a
// tidy-up of groups. Everything here is written by the job only, so nobody can change their own card or rank.
//
//   players/{acct}   u (username), score, band, prov, n, followers, public, rank, of, spot, closePlus, best, badges,
//                    since, line (the score at the end of each day, last 90 days), mix (calls per closeness label,
//                    Spot on → Far off), streak and bestStreak (days in a row with a 1-day call, Indian time)
//   boards/public    rows (top 100 public players), of (how many are ranked)
// A card never holds a price call. Followers are counted from everyone's "following" lists (which stay private).
import { HORIZONS, isRight } from "../../web/js/score.js";
import { mixOf, streakOf, streakBadges } from "../../web/js/habit.js";
import { levelOf } from "../../web/js/progress.js";

const CLOSE = new Set(["Spot on", "Very close", "Close"]);
export const RANK_MIN = 10; // scored calls before a public player is ranked (the score stops being provisional)

// What a card says about someone's record, from their scored results.
export function record(results, now = Date.now(), open = []) {
  const n = results.length, close = results.filter((r) => CLOSE.has(r.label)).length;
  let best = null, bestShare = -1;
  for (const h of Object.keys(HORIZONS)) {
    const xs = results.filter((r) => r.horizon === h);
    if (xs.length < 3) continue;
    const share = xs.filter((r) => CLOSE.has(r.label)).length / xs.length;
    if (share > bestShare) { best = h; bestShare = share; }
  }
  const spot = results.filter((r) => r.label === "Spot on").length;
  const st = streakOf([...results, ...open], now); // calls still open count too: a streak is about making calls
  const badges = [spot && "First Spot on", n >= 10 && "10 scored", n >= 100 && "100 scored", new Set(results.map((r) => r.horizon)).size === Object.keys(HORIZONS).length && "All 4 periods", ...streakBadges(st.best)].filter(Boolean);
  const right = results.filter(isRight).length;
  return { spot, closePlus: n ? Math.round((close / n) * 100) : null, right: n ? Math.round((right / n) * 100) : null, best, badges, mix: mixOf(results), streak: st.n, bestStreak: st.best, level: levelOf(results).level };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// accounts: every account (from the data job); scored: Map account → scored results (from settlePredictions).
export async function publishPlayers(db, accounts, scored = new Map(), { now = Date.now(), log = console.log, open = new Map() } = {}) {
  const named = accounts.filter((a) => typeof a.username === "string");
  const followers = new Map();
  for (const a of accounts) for (const f of new Set(Array.isArray(a.following) ? a.following : [])) if (f !== a.id) followers.set(f, (followers.get(f) || 0) + 1);
  const ranked = named.filter((a) => a.public === true && a.pscore?.score != null && (a.pscore.n || 0) >= RANK_MIN)
    .sort((x, y) => y.pscore.score - x.pscore.score || y.pscore.n - x.pscore.n || x.username.localeCompare(y.username));
  const rank = new Map(ranked.map((a, i) => [a.id, i + 1]));
  const old = new Map((await db.list("players")).map((p) => [p.id, p]));
  const today = new Date(now).toISOString().slice(0, 10), from = new Date(now - 90 * 864e5).toISOString().slice(0, 10);
  let wrote = 0;
  for (const a of named) {
    const ps = a.pscore || null, prev = old.get(a.id);
    // the score's daily line; a card from before score v2 starts its line again, so two methods never share one line
    const line = (prev?.v === 2 && Array.isArray(prev.line) ? prev.line : []).filter((x) => x.d > from && x.d !== today);
    if (ps?.score != null) line.push({ d: today, s: ps.score });
    const rec = scored.has(a.id) ? record(scored.get(a.id), now, open.get(a.id) || []) : { spot: prev?.spot ?? 0, closePlus: prev?.closePlus ?? null, right: prev?.right ?? null, level: prev?.level ?? 0, best: prev?.best ?? null, badges: prev?.badges ?? [], mix: prev?.mix ?? null, streak: prev?.streak ?? 0, bestStreak: prev?.bestStreak ?? 0 };
    const doc = { u: a.username, score: ps?.score ?? null, band: ps?.band ?? null, prov: ps ? !!ps.provisional : true, n: ps?.n || 0,
      followers: followers.get(a.id) || 0, public: a.public === true, rank: rank.get(a.id) || null, of: ranked.length,
      ...rec, since: String(a.createdAt || "").slice(0, 7), line, v: 2 };
    if (prev && same(Object.fromEntries(Object.keys(doc).map((k) => [k, prev[k] ?? null])), Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, v ?? null])))) continue;
    await db.set(`players/${a.id}`, { ...doc, at: new Date(now).toISOString() }); wrote++;
  }
  const keep = new Set(named.map((a) => a.id));
  for (const id of old.keys()) if (!keep.has(id)) await db.del(`players/${id}`); // account deleted, or no username
  await db.set("boards/public", { rows: ranked.slice(0, 100).map((a) => ({ a: a.id, u: a.username, score: a.pscore.score, band: a.pscore.band, n: a.pscore.n })), of: ranked.length, at: new Date(now).toISOString() });
  // most followed (1.2.0): what the search screen shows before anyone types
  const most = named.filter((a) => (followers.get(a.id) || 0) > 0).sort((x, y) => (followers.get(y.id) || 0) - (followers.get(x.id) || 0) || (y.pscore?.score || 0) - (x.pscore?.score || 0)).slice(0, 30);
  await db.set("boards/followed", { rows: most.map((a) => ({ a: a.id, u: a.username, score: a.pscore?.score ?? null, band: a.pscore?.band ?? null, n: a.pscore?.n || 0, followers: followers.get(a.id) || 0 })), at: new Date(now).toISOString() });
  // public scored calls (1.2.0): the scored calls a player chose to show, newest first, for their followers
  await publishCalls(db, scored, log);
  log(`players: ${named.length} cards (${wrote} updated), ${ranked.length} on the public board`);
  return { cards: named.length, wrote, ranked: ranked.length };
}

// players/{acct}/calls/{rid}: a player's scored calls marked public (pub: true), the newest 100, with what happened.
// Open calls are never published, by anyone.
export async function publishCalls(db, scored, log = console.log) {
  let wrote = 0;
  for (const [acct, results] of scored) {
    const pub = results.filter((r) => r.pub === true && r.status === "scored").sort((a, b) => Date.parse(b.resolvedAt) - Date.parse(a.resolvedAt)).slice(0, 100);
    const old = new Map((await db.list(`players/${acct}/calls`)).map((c) => [c.id, c]));
    const keep = new Set();
    for (const r of pub) {
      const id = r.id || `${r.t}_${r.horizon}_${r.resolvedAt}`, doc = { coin: r.coin, t: r.t, horizon: r.horizon, target: r.target, p0: r.p0, actual: r.actual, label: r.label, pctOff: r.pctOff ?? null, createdAt: r.createdAt, resolvedAt: r.resolvedAt, sure: r.sure || null, basis: r.basis || null };
      keep.add(id);
      if (old.has(id) && same(Object.fromEntries(Object.keys(doc).map((k) => [k, old.get(id)[k] ?? null])), Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, v ?? null])))) continue;
      await db.set(`players/${acct}/calls/${id}`, doc); wrote++;
    }
    for (const id of old.keys()) if (!keep.has(id)) await db.del(`players/${acct}/calls/${id}`); // made private, or trimmed
  }
  if (wrote) log(`public calls: ${wrote} written`);
}

// Groups: keeps member names in step with usernames, drops members whose account is gone, hands a group whose owner
// left to the next member, and deletes empty groups. Writes only if nothing changed the group since it was read.
export async function tidyGroups(db, accounts, { log = console.log } = {}) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  let changed = 0, removed = 0;
  for (const g of await db.list("groups")) {
    const members = Object.fromEntries(Object.keys(g.members || {}).filter((a) => typeof byId.get(a)?.username === "string").map((a) => [a, byId.get(a).username]));
    const ids = Object.keys(members);
    if (!ids.length) { await db.del(`groups/${g.id}`); removed++; continue; }
    const owner = members[g.owner] ? g.owner : ids[0], patch = {};
    if (!same(members, g.members)) patch.members = members;
    if (owner !== g.owner) patch.owner = owner;
    if (members[owner] !== g.ownerName) patch.ownerName = members[owner];
    if (!Object.keys(patch).length) continue;
    try { await db.set(`groups/${g.id}`, patch, { ifUnchanged: g }); changed++; }
    catch (e) { if (e.status !== 400 && e.status !== 409) throw e; } // someone joined or left meanwhile: next run
  }
  log(`groups: ${changed} tidied, ${removed} empty ones removed`);
  return { changed, removed };
}
