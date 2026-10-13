// People and groups: player cards, following, finding players, the leaderboard, groups, invites, group challenges
// and sealed picks. Live accounts use Firestore (see firestore.rules and pipeline/lib/challenges.mjs, players.mjs);
// demo mode keeps everything on this phone with a small cast of made-up players, settled the same way.
//
// Everyone is kept by account id, with their username alongside for display. Prices called in a group stay in each
// player's own picks until the data job scores them; groups only ever see who picked, then how close each was.
import { store, save, ls, randomId, fbx, connected, isoDates, myScore, makePrediction } from "./store.js";
import { HORIZONS, BANDS, checkPrediction, canPredict, challengeResults, addPoints } from "./score.js";
import { settle, rowCache, SETTLE_DELAY } from "./predict.js";

export const GROUP_MAX = 20, GROUPS_MAX = 10, FOLLOW_MAX = 200, RANK_MIN = 10;
// Group challenges: 1 hour, 1 day or 1 year. Picks stay open for a while after the start; everyone is scored at the
// same end time. (30 minutes stays solo: its pick window would be shorter than a push notification takes.)
export const CH_PERIODS = ["1h", "1d", "1y"];
export const PICK_MINS = { "1h": 20, "1d": 120, "1y": 1440 };
const LEN_MINS = { "1h": 60, "1d": 1440, "1y": 525600 };
const MIN = 60e3;

// S: what this phone knows. groups: id → group; challenges: group id → newest first; picks: my sealed picks;
// invites: to me; me: my player card; cards: other players' cards (cached).
export const S = { groups: new Map(), challenges: new Map(), picks: [], invites: [], me: null, cards: new Map(), board: null };
const listeners = new Set();
export const onSocial = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => listeners.forEach((fn) => fn());

export const me = () => (store.mode === "demo" ? "me" : store.id);
export const myName = () => store.data?.username || "";
const live = () => store.mode === "live";
const nowIso = () => new Date().toISOString();
export const bandOf = (score) => (score == null ? null : BANDS.find(([min]) => score >= min)[1]);

// ---------- demo mode: a made-up cast, stored on this phone
const CAST = [["kiran", 862, 340], ["lumen", 841, 198], ["tara.q", 829, 260], ["omar", 822, 155], ["asha", 814, 212], ["nilufer", 771, 90], ["rohan", 705, 64], ["ashwin", 655, 40], ["dev", 598, 22], ["aslan", 552, 4]]
  .map(([u, score, n], i) => ({ a: "demo_" + u, u, score, band: bandOf(score), prov: n < RANK_MIN, n, followers: [1204, 640, 512, 388, 1204, 77, 38, 12, 5, 0][i], public: true,
    spot: Math.round(n * 0.19), closePlus: 68 - i * 3, best: ["1d", "1h", "1y", "1d"][i % 4], badges: n >= 100 ? ["First Spot on", "10 scored", "100 scored"] : n >= 10 ? ["First Spot on", "10 scored"] : [],
    since: "2026-10", line: Array.from({ length: 12 }, (_, k) => ({ d: `2026-10-${String(k + 1).padStart(2, "0")}`, s: score - (11 - k) * 4 })) }));
const DEMO = "pl.demoSocial";
const demo = () => ls.get(DEMO, { groups: {}, ch: {}, picks: [] });
const keepDemo = (d) => { ls.set(DEMO, d); loadDemo(); };
function myDemoCard() {
  const sc = myScore(), n = sc?.n || 0, ranked = rankedDemo();
  return { a: "me", u: myName(), score: sc?.score ?? null, band: sc?.band ?? null, prov: sc ? !!sc.provisional : true, n, followers: 0, public: store.data?.public === true,
    rank: ranked.findIndex((p) => p.a === "me") + 1 || null, of: ranked.length, spot: store.results.filter((r) => r.label === "Spot on").length, closePlus: null, best: null, badges: [], since: String(store.data?.createdAt || "").slice(0, 7), line: [] };
}
function rankedDemo() {
  const sc = myScore(), mine = store.data?.public === true && sc?.score != null && (sc.n || 0) >= RANK_MIN ? [{ a: "me", u: myName(), score: sc.score, band: sc.band, n: sc.n }] : [];
  return [...CAST.filter((p) => p.public && p.n >= RANK_MIN), ...mine].sort((x, y) => y.score - x.score || y.n - x.n);
}
function loadDemo() {
  const d = demo();
  S.groups = new Map(Object.entries(d.groups).map(([id, g]) => [id, { id, ...g }]));
  S.challenges = new Map(Object.entries(d.ch).map(([g, list]) => [g, list.slice().sort((x, y) => Date.parse(y.at) - Date.parse(x.at))]));
  S.picks = d.picks.filter((p) => p.a === "me");
  S.invites = [];
  S.me = myDemoCard();
  emit();
}

// ---------- live listeners: invites, my picks, my card, and each of my groups with its latest 8 challenges (reads stay small)
let liveFor = null, unsubs = [];
const groupSubs = new Map(); // group id → [unsubscribe group, unsubscribe challenges]
function startLive() {
  const fb = fbx();
  if (!fb || !store.id) return;
  if (liveFor !== store.id) {
    stopLive(); liveFor = store.id;
    const { f, db } = fb, id = store.id, keep = (q) => q.docs.map((d) => ({ id: d.id, ...isoDates(d.data({ serverTimestamps: "estimate" })) }));
    unsubs.push(f.onSnapshot(f.collection(db, "accounts", id, "invites"), (q) => { S.invites = keep(q); emit(); }, () => {}));
    unsubs.push(f.onSnapshot(f.collection(db, "accounts", id, "picks"), (q) => { S.picks = keep(q); emit(); }, () => {}));
    unsubs.push(f.onSnapshot(f.doc(db, "players", id), (d) => { S.me = d.exists() ? { a: id, ...d.data() } : null; emit(); }, () => {}));
  }
  syncGroups();
}
function stopLive() { unsubs.forEach((u) => u()); unsubs = []; for (const [, us] of groupSubs) us.forEach((u) => u()); groupSubs.clear(); S.groups.clear(); S.challenges.clear(); liveFor = null; }
function syncGroups() {
  const fb = fbx(); if (!fb) return;
  const { f, db } = fb, want = new Set(store.data?.groups || []);
  for (const [g, us] of groupSubs) if (!want.has(g)) { us.forEach((u) => u()); groupSubs.delete(g); S.groups.delete(g); S.challenges.delete(g); }
  for (const g of want) if (!groupSubs.has(g)) {
    groupSubs.set(g, [
      f.onSnapshot(f.doc(db, "groups", g), (d) => {
        // gone, or no longer a member (removed by its owner): drop it from my list
        if (!d.exists() || !(me() in (d.data().members || {}))) { S.groups.delete(g); emit(); if (d.exists() || !d.metadata.fromCache) forget(g); return; }
        S.groups.set(g, { id: g, ...isoDates(d.data()) }); emit();
      }, () => {}),
      f.onSnapshot(f.query(f.collection(db, "groups", g, "challenges"), f.orderBy("at", "desc"), f.limit(8)), (q) => {
        S.challenges.set(g, q.docs.map((d) => withHere({ id: d.id, g, ...isoDates(d.data({ serverTimestamps: "estimate" })) }))); emit();
      }, () => {}),
    ]);
  }
}
const forget = (g) => (store.data?.groups || []).includes(g) && save({ groups: store.data.groups.filter((x) => x !== g) }).catch(() => {});
export function initSocial() {
  if (!live()) { loadDemo(); store.on((w) => (w === "preds" || w === "account") && ((S.me = myDemoCard()), emit())); return; }
  store.on((w) => { if (w === "account") startLive(); });
  startLive();
}

// ---------- player cards, finding players, the leaderboard
const fresh = new Map(); // account → when its card was fetched
export async function getCards(accts) {
  const want = [...new Set(accts.filter(Boolean))];
  if (!live()) { for (const a of want) S.cards.set(a, a === "me" ? myDemoCard() : CAST.find((p) => p.a === a) || null); return want.map((a) => S.cards.get(a)); }
  await connected();
  const { f, db } = fbx(), stale = want.filter((a) => !fresh.has(a) || Date.now() - fresh.get(a) > 120e3);
  for (let i = 0; i < stale.length; i += 30) {
    const part = stale.slice(i, i + 30), q = await f.getDocs(f.query(f.collection(db, "players"), f.where(f.documentId(), "in", part)));
    const got = new Map(q.docs.map((d) => [d.id, { a: d.id, ...d.data() }]));
    for (const a of part) { S.cards.set(a, got.get(a) || null); fresh.set(a, Date.now()); }
  }
  return want.map((a) => S.cards.get(a));
}
export const getCard = async (a) => (await getCards([a]))[0];
// Players whose username starts with what was typed (every username is findable; the leaderboard is opt-in).
export async function findPlayers(text) {
  const p = String(text || "").trim().toLowerCase().replace(/^@/, "");
  if (!p) return [];
  if (!live()) return CAST.filter((x) => x.u.startsWith(p)).slice(0, 10);
  await connected();
  const { f, db } = fbx();
  const q = await f.getDocs(f.query(f.collection(db, "usernames"), f.where(f.documentId(), ">=", p), f.where(f.documentId(), "<", p + ""), f.limit(10)));
  const hits = q.docs.map((d) => ({ u: d.id, a: d.data().acct })).filter((x) => x.a && x.a !== me());
  const cards = await getCards(hits.map((x) => x.a));
  return hits.map((x, i) => ({ ...(cards[i] || { score: null, n: 0, followers: 0, prov: true }), a: x.a, u: x.u }));
}
// The public leaderboard: the top 100 players who chose to be on it (refreshed by the data job every 2 hours).
let boardAt = 0;
export async function getBoard() {
  if (!live()) { const r = rankedDemo(); return (S.board = { rows: r.slice(0, 100), of: r.length, at: nowIso() }); }
  if (S.board && Date.now() - boardAt < 300e3) return S.board;
  await connected();
  const { f, db } = fbx(), d = await f.getDoc(f.doc(db, "boards", "public"));
  boardAt = Date.now();
  return (S.board = d.exists() ? d.data() : { rows: [], of: 0, at: null });
}
export const myCard = () => (live() ? S.me : (S.me = myDemoCard()));

// ---------- following (a private list on your own account; the people followed only see a count)
export const following = () => store.data?.following || [];
export const isFollowing = (a) => following().includes(a);
export async function follow(a, on = true) {
  if (!a || a === me()) return;
  const cur = following().filter((x) => x !== a);
  if (on && cur.length >= FOLLOW_MAX) throw new Error(`You can follow up to ${FOLLOW_MAX} players.`);
  await save({ following: on ? [...cur, a] : cur });
}
export const setPublic = (on) => save({ public: !!on });
export const setPickDefault = (v) => save({ pickDefault: v === "group" ? "group" : "counts" });

// ---------- groups
export const myGroups = () => [...S.groups.values()].sort((x, y) => String(x.name).localeCompare(String(y.name)));
export const groupLink = (g) => location.origin + location.pathname + "#/g/" + g;
const needName = () => { if (!myName()) throw new Error("Pick a username first."); };
// The name I play under in a group: the one the group has for me (it catches up with a username change at the next data run).
const nameIn = (g) => S.groups.get(g)?.members?.[me()] || myName();
export async function createGroup(rawName) {
  needName();
  const name = String(rawName || "").trim().slice(0, 24);
  if (!name) throw new Error("Give the group a name.");
  if ((store.data.groups || []).length >= GROUPS_MAX) throw new Error(`You can be in up to ${GROUPS_MAX} groups.`);
  const id = randomId(20), doc = { name, owner: me(), ownerName: myName(), members: { [me()]: myName() } };
  if (!live()) { const d = demo(); d.groups[id] = { ...doc, createdAt: nowIso(), table: {}, demoCast: true }; Object.assign(d.groups[id].members, Object.fromEntries(CAST.filter((p) => ["asha", "rohan", "dev"].includes(p.u)).map((p) => [p.a, p.u]))); keepDemo(d); }
  else { await connected(); const { f, db } = fbx(); await f.setDoc(f.doc(db, "groups", id), { ...doc, createdAt: f.serverTimestamp() }); }
  await save({ groups: [...(store.data.groups || []), id] });
  if (live()) syncGroups();
  return id;
}
// A group someone shared a link to, before joining: its name, who started it and how many play. null if it's gone.
export async function peekGroup(g) {
  if (S.groups.has(g)) { const x = S.groups.get(g); return { name: x.name, ownerName: x.ownerName, n: Object.keys(x.members || {}).length, member: true }; }
  if (!live()) return null;
  await connected();
  const { f, db } = fbx(), s = await f.getDoc(f.doc(db, "groups", g));
  if (!s.exists()) return null;
  const d = s.data(), members = d.members || {};
  return { name: d.name, ownerName: d.ownerName, n: Object.keys(members).length, member: me() in members };
}
export async function joinGroup(g) {
  needName();
  if ((store.data.groups || []).includes(g) && S.groups.has(g)) return S.groups.get(g);
  if ((store.data.groups || []).length >= GROUPS_MAX) throw new Error(`You can be in up to ${GROUPS_MAX} groups. Leave one first.`);
  if (!live()) throw new Error("Joining a group needs the live app.");
  await connected();
  const { f, db } = fbx(), ref = f.doc(db, "groups", g), s = await f.getDoc(ref);
  if (!s.exists()) throw new Error("That group doesn't exist any more, or the link is wrong.");
  const members = s.data().members || {};
  if (!(me() in members)) {
    if (Object.keys(members).length >= GROUP_MAX) throw new Error(`That group is full (${GROUP_MAX} players).`);
    await f.updateDoc(ref, { [`members.${me()}`]: myName() });
  }
  await save({ groups: [...new Set([...(store.data.groups || []), g])] });
  await f.deleteDoc(f.doc(db, "accounts", me(), "invites", g)).catch(() => {});
  syncGroups();
  return { id: g, ...s.data() };
}
export async function leaveGroup(g) {
  const grp = S.groups.get(g);
  if (!live()) { const d = demo(); delete d.groups[g]; delete d.ch[g]; d.picks = d.picks.filter((p) => p.g !== g); keepDemo(d); }
  else if (grp) {
    const { f, db } = fbx(), ref = f.doc(db, "groups", g), others = Object.keys(grp.members || {}).filter((a) => a !== me());
    if (!others.length) await f.deleteDoc(ref);
    else if (grp.owner === me()) await f.updateDoc(ref, { [`members.${me()}`]: f.deleteField(), owner: others[0], ownerName: grp.members[others[0]] });
    else await f.updateDoc(ref, { [`members.${me()}`]: f.deleteField() });
  }
  await save({ groups: (store.data.groups || []).filter((x) => x !== g) });
  if (live()) syncGroups();
}
export async function removeMember(g, a) {
  const grp = S.groups.get(g);
  if (!grp || grp.owner !== me() || a === me()) return;
  if (!live()) { const d = demo(); delete d.groups[g].members[a]; keepDemo(d); return; }
  const { f, db } = fbx();
  await f.updateDoc(f.doc(db, "groups", g), { [`members.${a}`]: f.deleteField() });
}
export async function renameGroup(g, rawName) {
  const name = String(rawName || "").trim().slice(0, 24);
  if (!name) throw new Error("Give the group a name.");
  if (!live()) { const d = demo(); d.groups[g].name = name; keepDemo(d); return; }
  const { f, db } = fbx();
  await f.updateDoc(f.doc(db, "groups", g), { name });
}
// Invite a player by account: they see it in Predict → Groups. Returns false if an invite is already waiting for them.
export async function invite(g, a) {
  const grp = S.groups.get(g);
  if (!grp) throw new Error("Open the group first.");
  if (a in (grp.members || {})) throw new Error("They're already in this group.");
  if (!live()) return true;
  const { f, db } = fbx();
  try { await f.setDoc(f.doc(db, "accounts", a, "invites", g), { g, name: grp.name, from: grp.members[me()], fromAcct: me(), at: f.serverTimestamp() }); return true; }
  catch (e) { if (/permission|insufficient/i.test(e.code || e.message || "")) return false; throw e; }
}
export async function declineInvite(g) {
  if (!live()) return;
  const { f, db } = fbx();
  await f.deleteDoc(f.doc(db, "accounts", me(), "invites", g));
}

// ---------- challenges and picks
export const challengesOf = (g) => S.challenges.get(g) || [];
export const myPick = (c) => S.picks.find((p) => p.c === c) || null;
export const picksOpen = (ch, now = Date.now()) => ch.status === "open" && now < Date.parse(ch.joinUntil);
// Challenges still waiting for my pick, soonest closing first.
export function waitingForMe(now = Date.now()) {
  const out = [];
  for (const [g, list] of S.challenges) for (const ch of list) if (S.groups.has(g) && picksOpen(ch, now) && !(me() in (ch.picked || {}))) out.push({ ...ch, g });
  return out.sort((x, y) => Date.parse(x.joinUntil) - Date.parse(y.joinUntil));
}
// Results not yet opened on this phone (they flip open on first view).
const SEEN = "pl.seenResults";
export const isSeen = (c) => (ls.get(SEEN, []) || []).includes(c);
export const markSeen = (c) => ls.set(SEEN, [...new Set([c, ...(ls.get(SEEN, []) || [])])].slice(0, 300));
export const unseenResults = () => [...S.challenges.values()].flat().filter((ch) => ch.status === "done" && (ch.results || []).some((r) => r.a === me()) && !isSeen(ch.id));
// Whether a pick may count to the public score: not if there's already an open prediction on that coin and period.
export const canCount = (coin, horizon) => canPredict(store.preds, coin, horizon);

function pickDoc({ g, c, sym, horizon, target, counts, endAt }) { return { g, c, coin: sym.key, t: sym.t, horizon, target, counts: !!counts, endAt }; }
function checkCall({ horizon, target, p0, sigmaD }) {
  const chk = checkPrediction({ horizon, p0, target, sigmaD });
  if (!chk.ok) throw new Error(chk.error);
}
// Start a challenge in a group: starting it is making the first pick.
export async function startChallenge({ g, sym, horizon, target, p0, sigmaD, counts }) {
  needName();
  if (!CH_PERIODS.includes(horizon)) throw new Error("Group challenges are 1 hour, 1 day or 1 year.");
  checkCall({ horizon, target, p0, sigmaD });
  if (counts && !canCount(sym.key, horizon)) throw new Error(`You already have an open ${HORIZONS[horizon].label} prediction on ${sym.t}, so this one can only be for the group.`);
  const c = randomId(20), at = new Date(Math.floor(Date.now() / 1000) * 1000), joinUntil = new Date(+at + PICK_MINS[horizon] * MIN), endAt = new Date(+at + LEN_MINS[horizon] * MIN);
  const ch = { coin: sym.key, t: sym.t, horizon, by: me(), byName: nameIn(g), at, joinUntil, endAt, picked: { [me()]: nameIn(g) }, status: "open" };
  if (!live()) return demoStart(g, c, ch, { sym, horizon, target, counts, p0, sigmaD });
  await connected();
  const { f, db } = fbx(), b = f.writeBatch(db), ts = f.serverTimestamp();
  b.set(f.doc(db, "groups", g, "challenges", c), ch);
  b.set(f.doc(db, "accounts", me(), "picks", c), { ...pickDoc({ g, c, sym, horizon, target, counts, endAt }), createdAt: ts });
  if (counts) b.set(f.doc(db, "accounts", me(), "predictions", `${sym.t}_${horizon}`), { coin: sym.key, t: sym.t, horizon, target, clientP0: p0, clientSigma: sigmaD, g, c, endAt, createdAt: ts });
  await b.commit().catch(writeError);
  return c;
}
// Join a challenge with a sealed pick.
export async function makePick({ g, ch, target, p0, sigmaD, counts }) {
  const sym = { key: ch.coin, t: ch.t };
  needName();
  if (!picksOpen(ch)) throw new Error("Picks for this challenge have closed.");
  if (me() in (ch.picked || {})) throw new Error("You've already picked.");
  checkCall({ horizon: ch.horizon, target, p0, sigmaD });
  if (counts && !canCount(ch.coin, ch.horizon)) throw new Error(`You already have an open ${HORIZONS[ch.horizon].label} prediction on ${ch.t}, so this one can only be for the group.`);
  const endAt = new Date(Date.parse(ch.endAt));
  if (!live()) return demoPick(g, ch, { sym, target, counts, p0, sigmaD });
  await connected();
  const { f, db } = fbx(), b = f.writeBatch(db), ts = f.serverTimestamp();
  b.set(f.doc(db, "accounts", me(), "picks", ch.id), { ...pickDoc({ g, c: ch.id, sym, horizon: ch.horizon, target, counts, endAt }), createdAt: ts });
  b.update(f.doc(db, "groups", g, "challenges", ch.id), { [`picked.${me()}`]: nameIn(g) });
  if (counts) b.set(f.doc(db, "accounts", me(), "predictions", `${ch.t}_${ch.horizon}`), { coin: ch.coin, t: ch.t, horizon: ch.horizon, target, clientP0: p0, clientSigma: sigmaD, g, c: ch.id, endAt, createdAt: ts });
  await b.commit().catch(writeError);
}
function writeError(e) {
  if (/permission|insufficient/i.test(e?.code || e?.message || "")) throw new Error("Couldn't save the pick: picks may have closed, or you already have an open call on this coin and period.");
  throw new Error("Couldn't save. Check your connection and try again.");
}
export const REACTIONS = [["nice", "Nice call"], ["close", "Close one"], ["unlucky", "Unlucky"], ["bold", "Bold call"]];
export async function react(g, c, kind) {
  if (!REACTIONS.some(([k]) => k === kind)) return;
  if (!live()) { const d = demo(), ch = (d.ch[g] || []).find((x) => x.id === c); if (ch) { ch.rx = { ...(ch.rx || {}), me: kind }; keepDemo(d); } return; }
  const { f, db } = fbx();
  await f.updateDoc(f.doc(db, "groups", g, "challenges", c), { [`rx.${me()}`]: kind, rxBy: me() });
}

// ---------- demo: the cast picks too, and everything settles on the phone like the data job does
const seeded = (seed) => { let x = 0; for (const ch of seed) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); };
async function demoStart(g, c, ch, { sym, horizon, target, counts, p0, sigmaD }) {
  const iso = (x) => new Date(x).toISOString();
  const rec = { ...ch, id: c, at: iso(ch.at), joinUntil: iso(ch.joinUntil), endAt: iso(ch.endAt) };
  if (counts) await makePrediction({ sym, horizon, target, p0, sigmaD, group: { g, c, endAt: rec.endAt } });
  const d = demo(), grp = d.groups[g];
  const add = (a, tgt, isMe) => d.picks.push({ a, g, c, coin: sym.key, t: sym.t, horizon, target: tgt, counts: isMe ? !!counts : false, createdAt: nowIso(), endAt: rec.endAt, ...(isMe ? {} : { cast: true }) });
  add("me", target, true);
  // the made-up members call too: a move of 0.5 to 2 typical moves either way (sealed, like everyone's)
  const rnd = seeded(c), m = Math.max(sigmaD || 0, 0.002) * Math.sqrt(HORIZONS[horizon].days);
  for (const a of Object.keys(grp.members).filter((x) => x.startsWith("demo_"))) { add(a, p0 * Math.exp((rnd() < 0.5 ? -1 : 1) * m * (0.5 + 1.5 * rnd())), false); rec.picked[a] = grp.members[a]; }
  (d.ch[g] ||= []).push(rec);
  keepDemo(d);
  return c;
}
async function demoPick(g, ch, { sym, target, counts, p0, sigmaD }) {
  if (counts) await makePrediction({ sym, horizon: ch.horizon, target, p0, sigmaD, group: { g, c: ch.id, endAt: ch.endAt } });
  const d = demo(), rec = (d.ch[g] || []).find((x) => x.id === ch.id);
  d.picks.push({ a: "me", g, c: ch.id, coin: ch.coin, t: ch.t, horizon: ch.horizon, target, counts: !!counts, createdAt: nowIso(), endAt: ch.endAt });
  if (rec) rec.picked = { ...rec.picked, me: myName() };
  keepDemo(d);
}
export async function settleDemoChallenges(fetchRows, now = Date.now()) {
  if (live()) return 0;
  const d = demo(); if (!d.picks.length) return 0;
  const rows = rowCache(fetchRows);
  for (const p of d.picks) {
    if (p.status === "scored" || p.status === "void") continue;
    try { const r = await settle(p, { now, rows }); Object.assign(p, r.patch); } catch {}
  }
  let done = 0;
  for (const [g, list] of Object.entries(d.ch)) for (const ch of list) {
    if (ch.status !== "open" || now < Date.parse(ch.endAt) + SETTLE_DELAY) continue;
    const mine = d.picks.filter((p) => p.g === g && p.c === ch.id);
    if (mine.some((p) => p.status !== "scored" && p.status !== "void")) continue;
    ch.results = challengeResults(ch, mine); ch.status = "done"; ch.doneAt = new Date(now).toISOString();
    const first = mine.filter((p) => p.status === "scored")[0]; ch.end = first?.actual ?? null; ch.move = first ? Math.round((first.actual / first.p0 - 1) * 1e4) / 100 : null;
    d.groups[g].table = addPoints(d.groups[g].table, ch.results, ch.endAt.slice(0, 7));
    d.picks = d.picks.filter((p) => !(p.g === g && p.c === ch.id));
    done++;
  }
  keepDemo(d);
  return done;
}

// ---------- live: a challenge is scored on each member's phone the moment it ends, with the same code and prices as
// the data job (everyone's picks can be read once it's over), so results show at once. The job's copy, a few minutes
// later, is the record: it adds the points to the table and deletes the picks; until then these are "confirming".
const doneHere = new Map(); // challenge id → { results, end, move } worked out here, or "trying"
const withHere = (ch) => { const h = doneHere.get(ch.id); return ch.status === "open" && h && h !== "trying" ? { ...ch, status: "done", ...h, here: true } : ch; };
export async function settleChallengesHere(fetchRows, now = Date.now()) {
  if (!live()) return settleDemoChallenges(fetchRows, now);
  const due = [...S.challenges.values()].flat().filter((ch) => ch.status === "open" && !doneHere.has(ch.id) && now >= Date.parse(ch.endAt) + SETTLE_DELAY);
  if (!due.length) return 0;
  const { f, db } = fbx(), rows = rowCache(fetchRows); let n = 0;
  for (const ch of due) {
    doneHere.set(ch.id, "trying");
    try {
      const picks = (await Promise.all(Object.keys(ch.picked || {}).map(async (a) => {
        const d = await f.getDoc(f.doc(db, "accounts", a, "picks", ch.id));
        return d.exists() ? { ...isoDates(d.data()), path: `accounts/${a}/picks/${ch.id}` } : null;
      }))).filter(Boolean);
      const out = [];
      for (const pk of picks) {
        if (pk.status === "scored" || pk.status === "void") { out.push(pk); continue; }
        const r = await settle(pk, { now, rows });
        if (r.status === "open") throw new Error("price not out yet");
        out.push({ ...pk, ...r.patch });
      }
      const first = out.filter((x) => x.status === "scored").sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt))[0];
      doneHere.set(ch.id, { results: challengeResults(ch, out), end: first?.actual ?? null, move: first ? Math.round((first.actual / first.p0 - 1) * 1e4) / 100 : null, doneAt: new Date(now).toISOString() });
      n++;
    } catch { doneHere.delete(ch.id); } // not ready (or picks already tidied by the job): the next pass, or the job, has it
  }
  if (n) { for (const [g, list] of S.challenges) S.challenges.set(g, list.map(withHere)); emit(); }
  return n;
}
// When the next open challenge ends (ms), to wake up for it.
export const nextChallengeEnd = () => Math.min(Infinity, ...[...S.challenges.values()].flat().filter((ch) => ch.status === "open" && !doneHere.has(ch.id)).map((ch) => Date.parse(ch.endAt) + SETTLE_DELAY));

// ---------- your group standings this month, best first: [{ a, u, pts }] (with results scored here added in)
export function groupTable(g, month = new Date().toISOString().slice(0, 7)) {
  const grp = S.groups.get(g); if (!grp) return [];
  let t = grp.table || {};
  for (const ch of S.challenges.get(g) || []) if (ch.here) t = addPoints(t, ch.results || [], ch.endAt.slice(0, 7));
  return Object.entries(grp.members || {}).map(([a, u]) => ({ a, u, pts: t[a]?.m === month ? t[a].mpts : 0, all: t[a]?.all || 0 }))
    .sort((x, y) => y.pts - x.pts || y.all - x.all || x.u.localeCompare(y.u));
}

// ---------- leaving everything when the account is deleted
export async function leaveAllGroups() { for (const g of [...(store.data?.groups || [])]) await leaveGroup(g).catch(() => {}); }
export async function deleteMySocial() {
  if (!live()) return;
  const { f, db } = fbx();
  for (const p of S.picks) await f.deleteDoc(f.doc(db, "accounts", me(), "picks", p.id)).catch(() => {});
  for (const i of S.invites) await f.deleteDoc(f.doc(db, "accounts", me(), "invites", i.id)).catch(() => {});
}
