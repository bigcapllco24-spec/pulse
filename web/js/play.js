// The Predict tab and everything people do together: your score as your identity, making calls, groups and their
// challenges, finding and following players, the leaderboard, player cards, and the avatar sheet (your settings).
// Data lives in store.js (your account and predictions) and social.js (people and groups).
import { CONFIG } from "../config.js";
import { store, ls, allSyms, makePrediction, myScore, enablePush, isAdmin, pendingHere, settleHere, nextDue } from "./store.js";
import { HORIZONS, PROVISIONAL_UNDER, CHANCE, checkPrediction, canPredict, allowedRange, dailyVol, dueAt, closenessText, typicalMove } from "./score.js";
import { settle, rowCache, krakenRows, SETTLE_DELAY } from "./predict.js";
import { D } from "./data.js";
import { $, esc, money, pct, toast, haptic, openSheet, setSheetBody, closeSheet } from "./ui.js";
import { APP, showTab } from "./app.js";
import { renderYou } from "./you.js";
import { setFeedbackMode } from "./feedback.js";
import { cardHtml, HOW_SCORE, svgIcon, BAND_CLASS, SHORT } from "./card.js";
import { mixOf, streakOf, streakBadges, istDay, dailyCoin, msUntilNextDay, whatHappened } from "./habit.js";
import { openShareSheet } from "./share.js";
import { levelOf, ringClass } from "./progress.js";
import { S, onSocial, me, myName, bandOf, RANK_MIN, CH_PERIODS, PICK_MINS, GROUP_MAX, getCards, getCard, findPlayers, getBoard, myCard, following, isFollowing, follow, setPublic, setPickDefault,
  myGroups, groupLink, createGroup, peekGroup, joinGroup, settleChallengesHere, nextChallengeEnd, leaveGroup, removeMember, renameGroup, invite, declineInvite, challengesOf, myPick, picksOpen, waitingForMe, isSeen, markSeen,
  unseenResults, canCount, startChallenge, makePick, REACTIONS, react, groupTable } from "./social.js";

const PERIODS = Object.keys(HORIZONS);
const LABEL_CLASS = { "Spot on": "good", "Very close": "good", Close: "mid", Off: "low", "Far off": "bad", "Not counted": "low" };
const m$ = (x) => money(x, "CRYPTO");
const num = (s) => `<span class="num">${s}</span>`;
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
// a letter avatar: the username's first letter, ringed in its band's colour (dashed while provisional)
export function ava(u, card, size = "", attrs = "") {
  const cls = card?.score != null && !card.prov ? BAND_CLASS[card.band || bandOf(card.score)] || "" : "prov";
  return `<span class="ava ${size} ${cls}" ${attrs}>${esc((u || "?")[0].toUpperCase())}</span>`;
}
// the level avatar (1.2.0): the letter ringed in the level's colour (progress.js), with the level in a small badge
export function levelAvatar(u, level, size = "", attrs = "") {
  return `<span class="ava lv ${size} ${ringClass(level)}" ${attrs}>${esc((u || "?")[0].toUpperCase())}<b class="lvb">${level}</b></span>`;
}
const until = (iso) => { const m = Math.round((Date.parse(iso) - Date.now()) / 60000); return m <= 0 ? "now" : m < 60 ? `${m}m` : m < 2880 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${Math.round(m / 1440)} days`; };
const leftText = (iso, h) => (h === "1y" ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : Date.parse(iso) <= Date.now() ? "scoring" : `${until(iso)} left`);
const when = (iso, h) => new Date(iso).toLocaleString("en-IN", h === "1y" ? { day: "numeric", month: "short", year: "numeric" } : { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const lastPrice = (key) => D.series[key]?.bars?.at(-1)?.c;
const symOf = (key) => allSyms().find((s) => s.key === key) || { key, t: key.split(":")[1], n: key.split(":")[1], m: "CRYPTO", ty: "C" };
// volatility for checking a call: the 30 full days before today, as the start-price lock uses
const sigmaOf = (key) => { const b = D.series[key]?.bars || []; return dailyVol(b.slice(0, -1).map((x) => x.c)); };
const groupName = (g) => S.groups.get(g)?.name || "a group";

// ---------- the Calls tab
export function initPlay() {
  onSocial(() => { badge(); if (APP.tab === "play") rerender(); });
  setInterval(() => { if (APP.tab === "play" && $("sheet").hidden && !document.hidden) { rerender(); if (APP.openGroup) drawGroup(); } }, 30000); // countdowns
  // score calls and challenges on this phone the moment they're due (the data job confirms them a few minutes later)
  store.on((w) => w === "preds" && scheduleScoring()); onSocial(scheduleScoring);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { tried = false; scheduleScoring(); } });
  scheduleScoring();
  badge();
}
let scoreT = 0, scoring = false, tried = false;
function scheduleScoring() {
  clearTimeout(scoreT);
  const next = Math.min(nextDue(), nextChallengeEnd()); if (next === Infinity) return;
  const wait = next <= Date.now() ? (tried ? 15000 : 300) : next - Date.now() + 1500; // overdue and not out yet: try again every 15 s
  scoreT = setTimeout(scoreDue, Math.min(wait, 2 ** 31 - 1));
}
async function scoreDue() {
  if (scoring || document.hidden) return;
  scoring = true; tried = true;
  const now = Date.now();
  try { if (nextDue() <= now) await settleHere(krakenRows, now); if (nextChallengeEnd() <= now) await settleChallengesHere(krakenRows, now); } catch {}
  scoring = false; scheduleScoring();
}
const rerender = () => { const pg = $("play").parentElement, y = pg.scrollTop; renderPlay(); pg.scrollTop = y; };
// The Calls tab's badge: picks waiting for you and invites.
export function badge() {
  const n = waitingForMe().length + S.invites.length, b = document.querySelector('.tabbar [data-tab="play"] .badge'); // picks and invites waiting for you
  if (b) { b.hidden = !n; b.textContent = n; }
}
const groupsNeedYou = () => waitingForMe().length + unseenResults().length + S.invites.length > 0;

// Calls: a search bar in the header, your progress, today's coin, friends, calls waiting and calls scored.
// "friends" is the With friends page (every group and shared list), opened from the Calls tab.
export function renderPlay() {
  const el = $("play"), view = APP.playView === "friends" ? "friends" : "calls";
  if (view === "friends") {
    el.innerHTML = `<button class="btn ghost sm" id="plBack" style="padding-left:0">‹ Calls</button><h1 style="margin:10px 0 4px">With friends</h1><p class="hint" style="margin:0 0 18px">Call the same coins as people you know.</p><div class="pl-view" data-view="friends"></div>`;
    el.querySelector("#plBack").onclick = () => { APP.playView = "calls"; renderPlay(); el.parentElement.scrollTop = 0; };
    groupsView(el.querySelector(".pl-view"));
    return;
  }
  el.innerHTML = `<div class="pl-top2"><h1>Calls</h1><button class="searchbar" id="plFind" aria-label="Find players"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg><span>Know how others are doing</span></button></div>
    <div class="pl-view" data-view="calls"></div>`;
  callsView(el.querySelector(".pl-view"));
  el.querySelector("#plFind").onclick = () => openSearch();
  wirePicks(el);
}
function wirePicks(root) {
  root.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const [g, c] = b.dataset.pick.split("|"), ch = challengesOf(g).find((x) => x.id === c); if (ch) openPickSheet(g, ch); }));
}
// The plain-language read on how well someone reads the market. Needs about 30 scored calls to mean anything.
export const VERDICT_AT = 30;
export function verdictOf(sc) {
  const n = sc?.n || 0;
  if (!n) return { text: "Make your first call", key: "none", n };
  if (n < VERDICT_AT) return { text: "Too early to tell", key: "early", n };
  return sc.score >= 600 ? { text: "Reading it well", key: "well", n } : { text: "Still learning", key: "learning", n };
}

// ---------- Calls: progress, today, with friends, waiting, scored
function callsView(el) {
  // waiting: your predictions, plus group picks that don't count to your score (those that do are predictions too)
  // a call scored on this phone the moment it was due moves straight to Scored (marked "confirming" until the server's copy lands)
  const here = pendingHere(), isHere = (p) => here.some((r) => r.t === p.t && r.horizon === p.horizon && r.createdAt === p.createdAt);
  const open = [...store.preds.filter((p) => !isHere(p)).map((p) => ({ ...p, kind: "pred" })), ...S.picks.filter((p) => !p.counts && p.status !== "scored" && p.status !== "void").map((p) => ({ ...p, kind: "pick" }))]
    .sort((a, b) => Date.parse(dueAt(a)) - Date.parse(dueAt(b)));
  const done = [...here, ...store.results].sort((a, b) => Date.parse(b.resolvedAt || 0) - Date.parse(a.resolvedAt || 0));
  const sc = myScore(), v = verdictOf(sc), st = myStreak(), n = sc?.n || 0;
  const callRow = (p) => {
    const due = dueAt(p), grp = p.g ? ` · ${esc(groupName(p.g))}` : "";
    return `<div class="row"><span class="main"><span class="t">${esc(p.t)} · ${SHORT[p.horizon]}</span><span class="s">Called ${num(esc(m$(p.target)))}${grp}${p.kind === "pick" ? " · group only" : ""}</span></span><b class="num">${esc(Date.now() >= Date.parse(due) ? "scoring…" : leftText(due, p.horizon))}</b></div>`;
  };
  const bits = [`${n} of about ${VERDICT_AT} calls`, st.n ? `${st.n}-day streak` : "", levelText()].filter(Boolean).join(" · ");
  const waits = waitingForMe(), groups = myGroups(), lists = [...store.lists.values()];
  const friendRows = [
    ...waits.slice(0, 2).map((ch) => `<button class="row" data-pick="${esc(ch.g)}|${esc(ch.id)}"><span class="main"><span class="t">${esc(groupName(ch.g))}</span><span class="s">Group, needs your pick, ${esc(until(ch.joinUntil))} left</span></span><span class="linkbtn">Pick</span></button>`),
    ...groups.filter((g) => !waits.some((w) => w.g === g.id)).slice(0, 2).map((g) => `<button class="row" data-g="${esc(g.id)}"><span class="main"><span class="t">${esc(g.name)}</span><span class="s">Group · ${Object.keys(g.members || {}).length} players</span></span><span class="chev">›</span></button>`),
    ...lists.slice(0, 2).map((l) => `<button class="row" data-list="${esc(l.id)}"><span class="main"><span class="t">${esc(l.name)}</span><span class="s">Shared list · ${(l.syms || []).length} coins · ${Object.keys(l.members || {}).length} members</span></span><span class="chev">›</span></button>`),
  ];
  el.innerHTML = `<button class="progcard" id="plProg"><span class="pc-top"><b>${esc(v.text)}</b><span class="chev">›</span></span><span class="pl-prog" aria-hidden="true"><i style="width:${Math.min(100, (n / VERDICT_AT) * 100)}%"></i></span><span class="hint">${esc(bits)}</span></button>
    <div class="secrow"><span class="label">Today</span></div>
    ${dailyBox(here)}
    <div class="secrow"><span class="label">With friends</span><button class="linkbtn" id="plFriends">All groups and lists${groupsNeedYou() ? ' <span class="dot" aria-label="needs you"></span>' : ""}</button></div>
    ${friendRows.length ? `<div class="hl">${friendRows.join("")}</div>` : `<p class="hint pl-empty">Start a group, or join one from a friend's link, to call the same coins together.</p>`}
    <div class="secrow"><span class="label">Waiting${open.length ? ` · ${open.length}` : ""}</span></div>
    ${open.length ? `<div class="hl">${open.map(callRow).join("")}</div>` : `<p class="hint pl-empty">Nothing waiting. Tap Call it on any chart in the feed.</p>`}
    <div class="secrow"><span class="label">Scored</span>${done.length > 3 ? `<button class="linkbtn" id="plAll">See all ${done.length}</button>` : ""}</div>
    ${done.length ? `<div class="hl pl-scored">${done.slice(0, 3).map(resultRow).join("")}</div>` : `<p class="hint pl-empty">Scored calls show here, with how close each one was.</p>`}`;
  el.querySelector("#plProg").onclick = () => showTab("you");
  el.querySelector("#plFriends").onclick = () => { APP.playView = "friends"; renderPlay(); el.parentElement.scrollTop = 0; };
  el.querySelector("[data-daily]")?.addEventListener("click", () => { const { dc, mine, blocked } = dailyState(here); if (!mine && !blocked) openPredictSheet(dc, () => APP.tab === "play" && renderPlay(), "1d"); });
  el.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => openGroup(b.dataset.g)));
  el.querySelectorAll("[data-list]").forEach((b) => (b.onclick = () => openListPage(b.dataset.list)));
  const wireRes = (root) => root.querySelectorAll("[data-res]").forEach((b) => (b.onclick = () => openResult(done[+b.dataset.res])));
  wireRes(el);
  el.querySelector("#plAll")?.addEventListener("click", () => openSheet("Scored calls", `<div class="hl">${done.map(resultRow).join("")}</div>`, wireRes));
}
// ---------- the daily coin: one coin a day for everyone (habit.js); yesterday's crowd shows once it's scored
function dailyState(here = pendingHere()) {
  const now = Date.now(), day = istDay(now), dc = dailyCoin(day), all = [...store.preds, ...store.results, ...here];
  const mine = all.find((p) => p.coin === dc.key && p.horizon === "1d" && istDay(Date.parse(p.createdAt)) === day);
  const left = msUntilNextDay(now);
  return { day, dc, mine, blocked: !mine && !canPredict(store.preds, dc.key, "1d"), price: lastPrice(dc.key), left: `${Math.floor(left / 36e5)}h ${Math.floor((left % 36e5) / 6e4)}m` };
}
// today's coin as a row: everyone calls the same coin today; it's a 1-day call like any other
function dailyBox(here) {
  const { dc, mine, blocked, left } = dailyState(here);
  const right = mine ? `<span class="lab good">You're in</span>` : blocked ? `<span class="hint">1-day call open</span>` : `<span class="linkbtn">Call</span>`;
  return `<div class="hl"><button class="row" data-daily><span class="main"><span class="t">Today's coin: ${esc(dc.n)}</span><span class="s">${mine ? `Called ${esc(m$(mine.target))}, scored ${esc(when(dueAt(mine), "1d"))}` : `Everyone calls it, ${esc(left)} left`}</span></span>${right}</button></div>`;
}
// the level line on the progress card (progress.js): effort, not skill
export const myLevel = () => levelOf([...store.results, ...pendingHere()]);
const levelText = () => `Level ${myLevel().level}`;
// a shared list's page lives with the settings pages for now (Sharing › Shared lists)
function openListPage(id) { APP.backTo = "play"; showTab("profile", "lists", id); }
// ---------- one scored call: how close it was, and what happened over its period (facts only)
function openResult(r) {
  if (!r || r.status !== "scored") return;
  const wh = whatHappened(r, D.news?.stories || []);
  openSheet(`${esc(r.t)} · ${SHORT[r.horizon]}`, `<div class="pc2-row" style="margin-bottom:10px"><span class="lab ${LABEL_CLASS[r.label] || ""}">${esc(r.label)}</span><span class="hint num">${esc(closenessText(r).split(" · ")[0])}</span></div>
    <div class="hl">
      <div class="row"><span class="main"><span class="t">Price when you called</span><span class="s">${esc(when(r.createdAt, r.horizon))}</span></span><b class="num">${esc(m$(r.p0))}</b></div>
      <div class="row"><span class="main"><span class="t">Your call</span></span><b class="num">${esc(m$(r.target))}</b></div>
      <div class="row"><span class="main"><span class="t">Price at the end</span><span class="s">${esc(when(dueAt(r), r.horizon))}</span></span><b class="num">${esc(m$(r.actual))}</b></div>
      ${(() => { const up = r.target > r.p0, went = r.actual === r.p0 ? null : r.actual > r.p0; return `<div class="row"><span class="main"><span class="t">Direction</span><span class="s">You called ${up ? "up" : "down"}, it went ${went == null ? "nowhere" : went ? "up" : "down"}</span></span><b class="${went == null ? "" : went === up ? "up" : "down"}">${went == null ? "Flat" : went === up ? "Right" : "Wrong"}</b></div>`; })()}
    </div>
    ${wh ? `<div class="pc2-box" style="margin-top:12px"><span class="label">What happened</span><p style="margin:0">${esc(wh.text)}</p></div>` : ""}
    <p class="hint">A typical move is how far ${esc(r.t)} usually travels in ${esc(HORIZONS[r.horizon].label)}, from its last 30 days. These facts describe the past only. A learning game, not advice.</p>`);
}
function resultRow(p, i) {
  return p.status === "scored"
    ? `<button class="row" data-res="${i}"><span class="main"><span class="t">${esc(p.t)} · ${SHORT[p.horizon]}</span><span class="s">${num(esc(closenessText(p).split(" · ")[0]))} · ${num(esc(m$(p.target)))} called, it was ${num(esc(m$(p.actual)))}${p.g ? ` · ${esc(groupName(p.g))}` : ""}${p.here ? " · confirming" : ""}</span></span><span class="lab ${LABEL_CLASS[p.label] || ""}">${esc(p.label)}</span></button>`
    : `<div class="row"><span class="main"><span class="t">${esc(p.t)} · ${SHORT[p.horizon]}</span><span class="s" style="white-space:normal">${esc(p.voidReason || "Not counted.")}</span></span><span class="lab low">Not counted</span></div>`;
}

// ---------- Groups
function groupsView(el) {
  const waits = waitingForMe(), groups = myGroups();
  const status = (g) => {
    const list = challengesOf(g.id), open = list.find((ch) => ch.status === "open"), unseen = list.find((ch) => ch.status === "done" && !isSeen(ch.id) && (ch.results || []).some((r) => r.a === me()));
    const n = Object.keys(g.members || {}).length, mine = groupTable(g.id).findIndex((r) => r.a === me());
    if (unseen) return [`${esc(unseen.t)} · ${SHORT[unseen.horizon]} results are in`, `<span class="lab good">New</span>`];
    if (open) return [`${esc(open.t)} · ${SHORT[open.horizon]} · ${Object.keys(open.picked || {}).length} of ${n} picked`, picksOpen(open) ? `<span class="lab good">Live</span>` : ""];
    return [`${n} player${n === 1 ? "" : "s"}${groupTable(g.id).some((r) => r.pts > 0) && mine >= 0 ? ` · you're ${ord(mine + 1)} this month` : ""}`, ""];
  };
  el.innerHTML = `${S.invites.length ? `<div class="label">Invites</div><div class="hl">${S.invites.map((i) => `<div class="row"><span class="main"><span class="t">${esc(i.name)}</span><span class="s">from @${esc(i.from)}</span></span><button class="btn ghost sm" data-decline="${esc(i.g)}">Decline</button><button class="btn primary sm" data-join="${esc(i.g)}">Join</button></div>`).join("")}</div><div style="height:16px"></div>` : ""}
    ${waits.map((ch) => `<button class="strip" data-pick="${esc(ch.g)}|${esc(ch.id)}"><i></i><span class="m"><b>${esc(groupName(ch.g))} · ${esc(ch.t)} · ${SHORT[ch.horizon]}</b><span class="s">${Object.keys(ch.picked || {}).length} of ${Object.keys(S.groups.get(ch.g)?.members || {}).length} picked · closes in ${num(until(ch.joinUntil))}</span></span><span class="btn primary sm">Pick</span></button>`).join("")}
    ${groups.length ? `<div class="label pl-sec">Your groups</div><div class="pl-cards">${groups.map((g) => { const [s, tag] = status(g), ms = Object.entries(g.members || {}), n = ms.length;
      return `<button class="gcard" data-g="${esc(g.id)}"><span class="gcard-top"><b>${esc(g.name)}</b>${tag || `<span class="chev">›</span>`}</span>
        <span class="gcard-bot"><span class="stack" aria-hidden="true">${ms.slice(0, 5).map(([a, u]) => ava(u, a === me() ? myCard() : S.cards.get(a), "xs")).join("")}${n > 5 ? `<span class="ava xs more">+${n - 5}</span>` : ""}</span><span class="s">${s}</span></span></button>`; }).join("")}</div>`
      : `<div class="pl-intro"><b>Play with friends</b><p class="hint">A group calls the same coin over the same time and sees who was closest. Prices stay hidden until it's scored.</p></div>`}
    <button class="pl-newg" id="plNewG"><span class="plus" aria-hidden="true">+</span><span class="main"><b>Start a group</b><span class="s">Up to ${GROUP_MAX} players. Share its link, or invite players from their card.</span></span></button>`;
  el.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => openGroup(b.dataset.g)));
  el.querySelector("#plNewG").onclick = () => openNewGroup();
  el.querySelectorAll("[data-join]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { await joinGroup(b.dataset.join); haptic(); toast("You're in."); openGroup(b.dataset.join); } catch (e) { toast(e.message, { ms: 4500 }); b.disabled = false; } }));
  el.querySelectorAll("[data-decline]").forEach((b) => (b.onclick = async () => { b.disabled = true; await declineInvite(b.dataset.decline).catch(() => {}); }));
  // member letters on the rows are coloured by their cards, fetched once
  const others = groups.flatMap((g) => Object.keys(g.members || {}).slice(0, 3)).filter((a) => a !== me() && !S.cards.has(a));
  if (others.length) getCards(others).then(() => APP.tab === "play" && APP.playView === "groups" && rerender()).catch(() => {});
}

// ---------- Ranks
let followRank = null; // { key, place, of } for the People you follow board, worked out from their cards
export function ranksView(el) {
  const card = myCard(), sc = myScore(), pub = store.data?.public === true, n = sc?.n || 0;
  const everyone = card?.rank ? [`#${card.rank}`, `top ${Math.max(1, Math.ceil((card.rank / Math.max(1, card.of)) * 100))}%`]
    : !pub ? ["Join", "You're not on it"] : n < RANK_MIN ? [`${RANK_MIN - n} to go`, `scored calls till you're ranked`] : ["Soon", "ranked at the next update"];
  const fl = following(), fkey = fl.join();
  if (fl.length && followRank?.key !== fkey + "|" + (sc?.score ?? "")) {
    followRank = { key: fkey + "|" + (sc?.score ?? ""), place: null, of: fl.length + 1 };
    getCards(fl).then((cs) => { const mine = sc?.score ?? -1, place = cs.filter((c) => (c?.score ?? -1) > mine).length + 1; followRank = { ...followRank, place }; if (APP.tab === "you") renderYou(); }).catch(() => {});
  }
  const rows = [["everyone", "Everyone", "Public players", ...everyone],
    ["following", "People you follow", fl.length ? "Only you see this board" : "Follow players to compare", fl.length && followRank?.place ? ord(followRank.place) : "–", fl.length ? `of ${fl.length + 1}` : ""],
    ...myGroups().map((g) => { const t = groupTable(g.id), i = t.findIndex((r) => r.a === me()), played = t.some((r) => r.pts > 0);
      return [g.id, g.name, `${new Date().toLocaleString("en-IN", { month: "long" })} · ${t.length} player${t.length === 1 ? "" : "s"}`, played && i >= 0 ? ord(i + 1) : "–", played ? `${t[i]?.pts ?? 0} pts` : "no results yet"]; })];
  el.innerHTML = `<div class="pl-cards">${rows.map(([k, t, s, big, small]) => `<button class="rcard" data-board="${esc(k)}"><span class="main"><b>${esc(t)}</b><span class="s">${esc(s)}</span></span><span class="r"><b class="${/^[#\d]/.test(big) ? "num" : ""}">${esc(big)}</b><span class="hint">${esc(small)}</span></span></button>`).join("")}</div>
    <button class="row" id="plFind" style="margin-top:10px"><span class="main"><span class="t">Find players</span><span class="s">Follow people to compare</span></span><span class="chev">›</span></button>`;
  el.querySelector("#plFind").onclick = () => openSearch();
  el.querySelectorAll("[data-board]").forEach((b) => (b.onclick = () => (b.dataset.board === "everyone" && !pub ? openJoinBoard() : openBoard(b.dataset.board))));
}
function openJoinBoard() {
  const n = myScore()?.n || 0;
  openSheet("Public leaderboard", `<p>Show your username, score and rank to everyone on the public leaderboard. Your price calls stay private.</p>
    <p class="hint">You're ranked once ${RANK_MIN} calls are scored${n < RANK_MIN ? ` (you have ${n})` : ""}. You can leave any time from your account.</p>
    <button class="btn primary block" id="jbGo">Show me on the leaderboard</button><button class="btn block" id="jbSee" style="margin-top:8px">Just look</button>`, (body) => {
    body.querySelector("#jbGo").onclick = async () => { await setPublic(true); haptic(); closeSheet(); toast("You're on the public leaderboard."); if (APP.tab === "play") renderPlay(); };
    body.querySelector("#jbSee").onclick = () => openBoard("everyone");
  });
}

// ---------- the leaderboard sheet: Everyone, People you follow, and each group
export function openBoard(tab = "everyone") {
  const tabs = [["everyone", "Everyone"], ["following", "Following"], ...myGroups().map((g) => [g.id, g.name])];
  if (!tabs.some(([k]) => k === tab)) tab = "everyone";
  openSheet("Leaderboard", "", (body) => {
    const draw = async () => {
      body.innerHTML = `<div class="utabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-bt="${esc(k)}" aria-selected="${k === tab}">${esc(l)}</button>`).join("")}</div><div data-bl><p class="hint">Loading…</p></div>`;
      body.querySelectorAll("[data-bt]").forEach((b) => (b.onclick = () => { tab = b.dataset.bt; draw(); }));
      body.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
      const box = body.querySelector("[data-bl]");
      let rows = [], foot = "", meRow = null, note = "";
      const mine = myCard(), sc = myScore(), self = { a: me(), u: myName(), score: sc?.score ?? null, band: sc?.band, n: sc?.n || 0, prov: !sc || sc.provisional };
      try {
        if (tab === "everyone") {
          const b = await getBoard();
          rows = (b.rows || []).map((r) => ({ ...r, prov: false }));
          foot = `Public players with ${RANK_MIN}+ scored calls${b.at ? `, updated ${esc(new Date(b.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }))}` : ""}. Skill scores in a learning game. Not advice.`;
          if (!rows.some((r) => r.a === me())) meRow = mine?.rank ? { ...self, place: mine.rank } : null;
          if (!mine?.rank) note = store.data?.public !== true ? "You're not on this board: join it from Ranks → Everyone." : (sc?.n || 0) < RANK_MIN ? `You're ranked once ${RANK_MIN} of your calls are scored (${sc?.n || 0} so far).` : "You'll show here at the next update (every 2 hours).";
        } else if (tab === "following") {
          const cs = (await getCards(following())).filter(Boolean);
          rows = [...cs, self].filter((r) => r.score != null || r.a === me()).sort((x, y) => (y.score ?? -1) - (x.score ?? -1));
          foot = following().length ? "Only you see who you follow. Not advice." : "Follow players from their card to compare scores here.";
        } else {
          const t = groupTable(tab), cards = await getCards(t.map((r) => r.a).filter((a) => a !== me()));
          rows = t.map((r) => ({ ...r, ...(r.a === me() ? self : cards.find((c) => c?.a === r.a) || {}), u: r.u, pts: r.pts }));
          foot = `Points this month: Spot on 5, Very close 3, Close 2, Off 1, plus 1 for the right direction.`;
        }
      } catch { box.innerHTML = `<div class="empty">Couldn't load this board. Check your connection.</div>`; return; }
      const line = (r, i) => `<button class="row lbrow${r.a === me() ? " you" : ""}" data-a="${esc(r.a)}"><span class="num lbn">${r.place ?? i + 1}</span>${ava(r.u, r, "sm")}<span class="main"><span class="t">@${esc(r.u)}${r.a === me() ? " · you" : ""}</span><span class="s">${r.pts != null ? `${esc(r.band || "No score yet")}` : `${esc(r.band || "")}${r.n ? ` · ${r.n} scored` : ""}`}</span></span><b class="num lbs">${r.pts != null ? `${r.pts}<small> pts</small>` : r.score ?? "–"}</b></button>`;
      box.innerHTML = (note ? `<p class="notice" style="margin:0 0 10px">${esc(note)}</p>` : "") + (rows.length ? `<div class="hl">${rows.map(line).join("")}</div>${meRow ? `<div class="hl lbme">${line(meRow, 0)}</div>` : ""}<p class="hint" style="margin-top:10px">${foot}</p>` : `<div class="empty">${tab === "everyone" ? `Nobody's on the public leaderboard yet. Players show here once ${RANK_MIN} of their calls are scored and they choose to join.` : "No scores here yet."}</div><p class="hint">${foot}</p>`);
      box.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => openPlayerCard(b.dataset.a)));
    };
    draw();
  });
}

// ---------- a player's card (card.js): the same card is a sheet for other players and your own full profile page
const cardOf = (c, a, actions = "") => cardHtml(c, { mine: a === me(), actions, common: a === me() ? [] : myGroups().filter((g) => a in (g.members || {})) });
// your own card, with your record worked out from this phone's results (fresher than the card the job writes)
export function myFullCard() {
  const scored = [...pendingHere(), ...store.results].filter((r) => r.status === "scored"), mix = mixOf(scored), n = mix.reduce((a, x) => a + x, 0);
  const base = { ...myCard(), ...cardFromScore() }, st = myStreak();
  return { ...base, mix, spot: mix[0], closePlus: n ? Math.round(((mix[0] + mix[1] + mix[2]) / n) * 100) : base.closePlus ?? null, streak: st.n,
    badges: [...new Set([...(base.badges || []).filter((b) => !/-day streak$/.test(b)), ...streakBadges(Math.max(st.best, base.bestStreak || 0))])] };
}
export const myStreak = () => streakOf([...store.preds, ...store.results, ...S.picks.filter((p) => !p.counts)]);
function wireCard(root) {
  root.querySelector("[data-how]")?.addEventListener("click", () => openSheet("How the score works", HOW_SCORE));
  root.querySelector("[data-first]")?.addEventListener("click", () => { closeProfile(); APP.playView = "calls"; showTab("play"); });
}
export async function openPlayerCard(a) {
  if (a === me()) { openProfile(); return; }
  openSheet("Player", `<p class="hint">Loading…</p>`);
  let c; try { c = await getCard(a); } catch { c = null; }
  if (!c) { setSheetBody(`<div class="empty">This player's card isn't ready yet. Cards update every 2 hours.</div>`); return; }
  const draw = () => {
    const on = isFollowing(a);
    setSheetBody(cardOf(c, a, `<div class="pc-acts"><button class="btn ${on ? "" : "primary"}" id="pcFollow">${on ? "Following" : "Follow"}</button><button class="btn" id="pcInvite">Invite to a group</button></div>`)
      + `<p class="hint">Scores and results only; price calls are never shown. A learning game, not advice.</p>`);
    const sh = $("sheet"); wireCard(sh);
    sh.querySelector("#pcFollow")?.addEventListener("click", async () => { try { await follow(a, !on); haptic(); if (!on) c.followers = (c.followers || 0) + 1; else c.followers = Math.max(0, (c.followers || 0) - 1); draw(); } catch (e) { toast(e.message); } });
    sh.querySelector("#pcInvite")?.addEventListener("click", () => chooseGroupToInvite(a, c.u));
  };
  draw();
}
// ---------- your profile: a page of its own (from the top of Predict), with the way to settings on it
let profOn = false;
function openProfile() {
  let el = $("prof");
  if (!el) { el = document.createElement("section"); el.id = "prof"; el.className = "grp"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); document.body.appendChild(el); }
  profOn = true; el.hidden = false; document.body.classList.add("grpopen"); requestAnimationFrame(() => el.classList.add("on"));
  if (!history.state?.prof) history.pushState({ prof: 1 }, "");
  drawProfile();
}
function drawProfile() {
  const el = $("prof"); if (!el || !profOn) return;
  const c = myFullCard(), fl = following().length, pub = store.data?.public === true;
  const row = (id, ic, t, sub, plain = false) => `<button class="row irow" id="${id}"><span class="ic${plain ? " n" : ""}">${svgIcon(ic)}</span><span class="main"><span class="t">${t}</span><span class="s">${sub}</span></span><span class="chev">›</span></button>`;
  el.innerHTML = `<div class="grp-h"><button class="iconbtn ghost" id="prBack" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button><span class="grp-t"><b>Your profile</b><span class="hint">What other players see</span></span><button class="iconbtn ghost" id="prShare" aria-label="Share your card">${svgIcon("share")}</button></div>
    <div class="grp-b prof-b">${cardHtml(c, { mine: true })}
      <div class="prof-list">
        ${row("prFollowing", "people", "Following", fl ? `${fl} player${fl === 1 ? "" : "s"} · only you see who` : "Find players to follow from Ranks")}
        ${row("prBoard", "bars", "Public leaderboard", pub ? (c.rank ? `You're on it · rank #${c.rank}` : "You're on it") : "You're not on it")}
        ${row("prSettings", "sliders", "Settings", "Username, alerts, chart style, appearance, notifications", true)}
      </div>
      <p class="hint" style="text-align:center">Other players see your username, score, band, followers, rank, streak and record. Your price calls are never shown. A learning game, not advice.</p></div>`;
  wireCard(el);
  el.querySelector("#prBack").onclick = backFromProfilePage;
  el.querySelector("#prShare").onclick = () => openShareSheet(myFullCard());
  el.querySelector("#prFollowing").onclick = () => openFollowing();
  el.querySelector("#prBoard").onclick = () => (pub ? openBoard("everyone") : openJoinBoard());
  el.querySelector("#prSettings").onclick = () => openAvatarSheet();
}
export function closeProfile() {
  const el = $("prof"); if (!el || el.hidden) return;
  profOn = false; el.classList.remove("on"); if (!APP.openGroup) document.body.classList.remove("grpopen");
  setTimeout(() => { if (!profOn) { el.hidden = true; el.innerHTML = ""; } }, 260);
}
const backFromProfilePage = () => (history.state?.prof ? history.back() : closeProfile());
addEventListener("popstate", () => { if (profOn && !history.state?.prof) { closeSheet(); closeProfile(); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && profOn && !APP.openGroup && $("sheet").hidden) backFromProfilePage(); });
const cardFromScore = () => { const sc = myScore(); return sc ? { u: myName(), score: sc.score, band: sc.band, prov: sc.provisional, n: sc.n } : { u: myName(), score: null, n: 0, prov: true }; };
function chooseGroupToInvite(a, u) {
  const gs = myGroups().filter((g) => !(a in (g.members || {})));
  if (!myGroups().length) { toast("Start a group first, from Predict → Groups."); return; }
  if (!gs.length) { toast(`@${u} is already in all your groups.`); return; }
  openSheet(`Invite @${esc(u)}`, `<div class="hl">${gs.map((g) => `<button class="row" data-ig="${esc(g.id)}"><span class="main"><span class="t">${esc(g.name)}</span><span class="s">${Object.keys(g.members || {}).length} of ${GROUP_MAX} players</span></span><span class="chev">›</span></button>`).join("")}</div>`, (body) => {
    body.querySelectorAll("[data-ig]").forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { const sent = await invite(b.dataset.ig, a); haptic(); closeSheet(); toast(sent ? `Invite sent to @${u}.` : `@${u} already has an invite to that group.`); } catch (e) { toast(e.message); b.disabled = false; }
    }));
  });
}

// ---------- find players
export function openSearch() {
  openSheet("Find players", `<label class="uname"><span>@</span><input id="fpIn" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="21" placeholder="username" aria-label="Username"></label><div id="fpRes" style="margin-top:8px"></div>`, (body) => {
    const inp = body.querySelector("#fpIn"), res = body.querySelector("#fpRes");
    let seq = 0;
    const row = (c) => `<div class="row"><button class="pl-hit" data-a="${esc(c.a)}">${ava(c.u, c, "sm")}<span class="main"><span class="t">@${esc(c.u)}</span><span class="s">${c.score != null ? `${num(c.score)} ${esc(c.band || "")}` : "New player"} · ${num((c.followers || 0).toLocaleString("en-IN"))} follower${c.followers === 1 ? "" : "s"}</span></span></button>
      <button class="btn sm ${isFollowing(c.a) ? "" : "primary"}" data-f="${esc(c.a)}">${isFollowing(c.a) ? "Following" : "Follow"}</button></div>`;
    const wire = (list) => {
      res.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => openPlayerCard(b.dataset.a)));
      res.querySelectorAll("[data-f]").forEach((b) => (b.onclick = async () => { const a = b.dataset.f, on = !isFollowing(a); try { await follow(a, on); haptic(); b.textContent = on ? "Following" : "Follow"; b.classList.toggle("primary", !on); } catch (e) { toast(e.message); } }));
    };
    const top = async () => {
      try { const b = await getBoard(), ids = (b.rows || []).slice(0, 5).filter((r) => r.a !== me()), cards = await getCards(ids.map((r) => r.a)); const list = ids.map((r, i) => ({ ...r, ...(cards[i] || {}) }));
        res.innerHTML = list.length ? `<div class="label" style="margin-top:12px">Top of the leaderboard</div><div class="hl">${list.map(row).join("")}</div>` : `<p class="hint">Type the start of a username.</p>`; wire(list); } catch { res.innerHTML = ""; }
    };
    const go = async () => {
      const q = inp.value.trim().replace(/^@/, ""), my = ++seq;
      if (!q) return top();
      res.innerHTML = `<p class="hint">Searching…</p>`;
      try { const list = await findPlayers(q); if (my !== seq) return; res.innerHTML = list.length ? `<div class="hl">${list.map(row).join("")}</div>` : `<p class="hint">No player called @${esc(q)}…</p>`; wire(list); }
      catch { if (my === seq) res.innerHTML = `<p class="hint">Couldn't search just now. Check your connection.</p>`; }
    };
    let t = 0; inp.oninput = () => { clearTimeout(t); t = setTimeout(go, 220); };
    top(); setTimeout(() => inp.focus(), 280);
  });
}

// ---------- groups: start one, open one (its challenges, table and members)
function openNewGroup() {
  openSheet("Start a group", `<label class="field"><span>Name</span><input class="input" id="ngIn" maxlength="24" placeholder="e.g. Weekend crew" autocomplete="off"></label>
    <p class="hint">You'll get a link to share. Up to ${GROUP_MAX} players; everyone plays under their username.</p><button class="btn primary block" id="ngGo">Create group</button>`, (body) => {
    const inp = body.querySelector("#ngIn"), go = body.querySelector("#ngGo");
    go.onclick = async () => {
      go.disabled = true; go.textContent = "Creating…";
      try { const g = await createGroup(inp.value); haptic(); closeSheet(); setTimeout(() => openGroup(g, { fresh: true }), 300); }
      catch (e) { toast(e.message); go.disabled = false; go.textContent = "Create group"; }
    };
    setTimeout(() => inp.focus(), 280);
  });
}
async function shareLink(g) {
  const url = groupLink(g), text = `Join my group “${groupName(g)}” on ${CONFIG.appName}: call the same coin and see who's closest.`;
  try { if (navigator.share) { await navigator.share({ title: groupName(g), text, url }); return; } } catch (e) { if (e?.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(url); toast("Group link copied."); } catch { prompt("Copy this link", url); }
}
// ---------- a group's own page: its challenges as a timeline, oldest first, newest at the bottom (like a chat, with
// no chat). Older results fold to one line; the live challenge and the latest results show in full.
let grpOff = null; const opened = new Set(); // results rows unfolded on this visit
const dayLabel = (iso) => {
  const d = new Date(iso), t = new Date(), y = new Date(Date.now() - 864e5), same = (a, b) => a.toDateString() === b.toDateString();
  return same(d, t) ? "Today" : same(d, y) ? "Yesterday" : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
};
export function openGroup(g, { fresh = false } = {}) {
  let el = $("grp");
  if (APP.openGroup === g && el && !el.hidden) { drawGroup(true); return; }
  if (!el) { el = document.createElement("section"); el.id = "grp"; el.className = "grp"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); document.body.appendChild(el); }
  APP.openGroup = g; APP.groupFresh = fresh; opened.clear();
  el.hidden = false; document.body.classList.add("grpopen"); requestAnimationFrame(() => el.classList.add("on"));
  if (history.state?.grp !== g) history.pushState({ grp: g }, "");
  grpOff?.(); grpOff = onSocial(() => APP.openGroup === g && drawGroup());
  drawGroup(true);
}
// Back (the button, Escape, or the phone's back): the page slides away
export function closeGroup() {
  const el = $("grp"); if (!el || el.hidden) return;
  grpOff?.(); grpOff = null; APP.openGroup = null; if (!profOn) document.body.classList.remove("grpopen");
  el.classList.remove("on"); setTimeout(() => { if (!APP.openGroup) { el.hidden = true; el.innerHTML = ""; } }, 260);
  if (APP.tab === "play") renderPlay(); badge();
}
const backFromGroup = () => (history.state?.grp ? history.back() : closeGroup());
addEventListener("popstate", () => { if (APP.openGroup && history.state?.grp !== APP.openGroup) { closeSheet(); closeGroup(); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && APP.openGroup && $("sheet").hidden) backFromGroup(); });

function drawGroup(toBottom = false) {
  const g = APP.openGroup, el = $("grp"); if (!g || !el) return;
  const grp = S.groups.get(g);
  if (!grp) { el.innerHTML = `<div class="grp-h"><button class="iconbtn ghost" id="grBack" aria-label="Back">‹</button><span class="grp-t"><b>Group</b></span></div><div class="grp-b"><div class="empty">${!(store.data?.groups || []).includes(g) ? "You're not in this group any more." : "Loading the group…"}</div></div>`; el.querySelector("#grBack").onclick = backFromGroup; return; }
  const box = el.querySelector(".grp-b"), nearEnd = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 80, y = box?.scrollTop || 0;
  const n = Object.keys(grp.members || {}).length, list = challengesOf(g).slice().reverse(), t = groupTable(g), mi = t.findIndex((r) => r.a === me()), played = t.some((r) => r.pts > 0);
  let day = "", rows = "";
  for (const ch of list) {
    const d = dayLabel(ch.at); if (d !== day) { day = d; rows += `<span class="grp-day">${esc(d)}</span>`; }
    const mineIn = (ch.results || []).some((r) => r.a === me());
    const fold = ch.status === "done" && (isSeen(ch.id) || !mineIn) && !opened.has(ch.id); // seen results (and ones you weren't in) fold to one line; tap to open
    if (fold) {
      const r = (ch.results || []), win = r.find((x) => x.rank === 1), mine = r.find((x) => x.a === me());
      rows += `<button class="grp-res" data-open="${esc(ch.id)}"><span class="main"><span class="t">${esc(ch.t)} · ${SHORT[ch.horizon]} · results</span><span class="s">${win ? `${win.a === me() ? "You" : "@" + esc(win.u)} won` : "No one scored"}${mine && win?.a !== me() ? ` · you were ${mine.rank ? ord(mine.rank) : "not counted"}, ${esc(mine.label)}` : ""}</span></span><span class="chev">›</span></button>`;
    } else rows += chCard(g, ch, n);
  }
  el.innerHTML = `<div class="grp-h"><button class="iconbtn ghost" id="grBack" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <button class="grp-t" id="grInfo2"><b>${esc(grp.name)}</b><span class="hint">${n} player${n === 1 ? "" : "s"}${played && mi >= 0 ? ` · you're ${ord(mi + 1)} in ${new Date().toLocaleString("en-IN", { month: "long" })}` : ""}</span></button>
      <button class="iconbtn ghost" id="grInv" aria-label="Invite"><svg viewBox="0 0 24 24"><circle cx="10" cy="8" r="4"/><path d="M3 20c1.2-3.4 3.8-5 7-5s5.8 1.6 7 5M19 8v6M16 11h6"/></svg></button>
      <button class="iconbtn ghost" id="grTable" aria-label="This month's table"><svg viewBox="0 0 24 24"><path d="M6 20V10M12 20V4M18 20v-7"/></svg></button>
      <button class="iconbtn ghost" id="grInfo" aria-label="Group and players"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></button></div>
    <div class="grp-b">
      ${APP.groupFresh || n === 1 ? `<div class="notice">Share the group's link so friends can join.${n === 1 ? " It's just you so far." : ""} <button class="linkbtn" id="grShare">Share link</button></div>` : ""}
      ${rows || `<div class="pl-intro grp-empty"><b>No challenges yet</b><p class="hint">Start one: pick a coin and a period, make your call, and everyone in the group gets the same end time. Prices stay hidden until it's scored.</p></div>`}
    </div>
    <div class="grp-f"><button class="btn primary block" id="grNew">New challenge</button></div>`;
  const b = el.querySelector(".grp-b");
  b.scrollTop = toBottom || nearEnd ? b.scrollHeight : y;
  el.querySelector("#grBack").onclick = backFromGroup;
  el.querySelector("#grNew").onclick = () => openChallengeSheet(g);
  el.querySelector("#grInv").onclick = () => openInviteSheet(g);
  el.querySelector("#grInfo").onclick = el.querySelector("#grInfo2").onclick = () => openGroupInfo(g);
  el.querySelector("#grTable").onclick = () => openGroupTable(g);
  el.querySelector("#grShare")?.addEventListener("click", () => shareLink(g));
  el.querySelectorAll("[data-open]").forEach((x) => (x.onclick = () => { opened.add(x.dataset.open); drawGroup(); }));
  el.querySelectorAll("[data-fold]").forEach((x) => (x.onclick = () => { markSeen(x.dataset.fold); opened.delete(x.dataset.fold); drawGroup(); }));
  el.querySelectorAll("[data-reveal]").forEach((x) => (x.onclick = () => { markSeen(x.dataset.reveal); opened.add(x.dataset.reveal); haptic([8, 30, 8]); APP.flip = x.dataset.reveal; drawGroup(); APP.flip = null; badge(); el.querySelector(".chcard.flip")?.scrollIntoView({ block: "start", behavior: "smooth" }); }));
  el.querySelectorAll("[data-rx]").forEach((x) => (x.onclick = async () => { const [c, k] = x.dataset.rx.split("|"); try { await react(g, c, k); haptic(); } catch { toast("Couldn't react just now."); } }));
  el.querySelectorAll("[data-again]").forEach((x) => (x.onclick = () => { const ch = list.find((c) => c.id === x.dataset.again); openChallengeSheet(g, { coin: ch.coin, horizon: ch.horizon }); }));
  el.querySelectorAll("[data-share]").forEach((x) => (x.onclick = () => shareResult(g, list.find((c) => c.id === x.dataset.share))));
  el.querySelectorAll(".grp-b [data-a]").forEach((x) => (x.onclick = () => openPlayerCard(x.dataset.a)));
  wirePicks(el);
  const need = Object.keys(grp.members || {}).filter((a) => a !== me() && !S.cards.has(a));
  if (need.length) getCards(need).then(() => APP.openGroup === g && drawGroup()).catch(() => {});
}
// This month's points table, from the group page's chart button.
function openGroupTable(g) {
  const t = groupTable(g), played = t.some((r) => r.pts > 0), month = new Date().toLocaleString("en-IN", { month: "long" });
  openSheet(`${esc(month)} table`, `${played ? `<div class="hl">${t.map((r, i) => `<button class="row" data-a="${esc(r.a)}"><span class="num lbn">${i + 1}</span>${ava(r.u, r.a === me() ? myCard() : S.cards.get(r.a), "xs")}<span class="main"><span class="t">@${esc(r.u)}${r.a === me() ? " · you" : ""}</span><span class="s">${r.all} pts all time</span></span><b class="num">${r.pts}<small class="muted"> pts</small></b></button>`).join("")}</div>`
    : `<div class="empty">No results this month yet. Points land when a challenge is scored.</div>`}
    <p class="hint" style="margin-top:10px">Spot on 5, Very close 3, Close 2, Off 1, plus 1 for the right direction. Starts again each month.</p>`, (body) => {
    body.querySelectorAll("[data-a]").forEach((x) => (x.onclick = () => openPlayerCard(x.dataset.a)));
  });
}
function chCard(g, ch, n) {
  const picked = Object.entries(ch.picked || {}), grp = S.groups.get(g), missing = Object.entries(grp?.members || {}).filter(([a]) => !(a in (ch.picked || {})));
  const title = `${esc(ch.t)} · ${SHORT[ch.horizon]}`, by = ch.by === me() ? "you" : `@${esc(ch.byName)}`;
  if (ch.status === "done") {
    const mineIn = (ch.results || []).some((r) => r.a === me());
    if (mineIn && !isSeen(ch.id)) return `<button class="sealed" data-reveal="${esc(ch.id)}"><span class="label" style="color:var(--accent)">Results are in</span><b>${title}</b><span class="stack" aria-hidden="true">${(ch.results || []).slice(0, 6).map((r) => ava(r.u, r.a === me() ? myCard() : S.cards.get(r.a), "xs")).join("")}</span><span class="btn primary sm">Tap to reveal</span></button>`;
    const rx = ch.rx || {}, counts = Object.fromEntries(REACTIONS.map(([k]) => [k, Object.values(rx).filter((v) => v === k).length]));
    const mineRx = rx[me()];
    return `<div class="chcard${APP.flip === ch.id ? " flip" : ""}">
      <div class="secrow" style="margin:0"><b>${title}</b><span class="hint" style="flex:1;text-align:right">${ch.end != null ? `ended ${num(esc(m$(ch.end)))}${ch.move != null ? ` <span class="${ch.move >= 0 ? "up" : "down"} num">${esc(pct(ch.move, 1))}</span>` : ""}` : ""}</span><button class="linkbtn chfold" data-fold="${esc(ch.id)}">Fold</button></div>
      <div class="hl">${(ch.results || []).map((r, i) => `<button class="row rrow${r.a === me() ? " you" : ""}${APP.flip === ch.id ? " rin" : ""}" style="${APP.flip === ch.id ? `animation-delay:${0.2 + i * 0.09}s` : ""}" data-a="${esc(r.a)}"><span class="num lbn">${r.rank ?? "–"}</span>${ava(r.u, r.a === me() ? myCard() : S.cards.get(r.a), "xs")}<span class="main"><span class="t">@${esc(r.u)}</span><span class="s"><span class="lab ${LABEL_CLASS[r.label] || ""}">${esc(r.label)}</span> ${r.label === "Not counted" ? "couldn't be scored" : `${num(Math.abs(r.off).toFixed(1) + "%")} off · ${r.up ? "up" : "down"}`} · ${r.counts ? "counts" : "group only"}</span></span><b class="num rpts">+${r.pts}</b></button>`).join("")}
        ${missing.length ? `<div class="row"><span class="main"><span class="s">${missing.map(([, u]) => "@" + esc(u)).join(", ")} didn't pick</span></span></div>` : ""}</div>
      ${mineIn && ch.here ? `<p class="hint" style="margin:0">Scored on your phone just now · confirming. Reactions open in a few minutes.</p>` : ""}
      ${mineIn && !ch.here ? `<div class="opts">${REACTIONS.map(([k, l]) => `<button class="opt" data-rx="${esc(ch.id)}|${k}" aria-pressed="${mineRx === k}">${l}${counts[k] ? ` · ${counts[k]}` : ""}</button>`).join("")}</div>` : ""}
      ${mineIn ? `<div class="pc-acts"><button class="btn" data-again="${esc(ch.id)}">Rematch</button><button class="btn" data-share="${esc(ch.id)}">Share result</button></div>` : ""}
    </div>`;
  }
  const mine = myPick(ch.id), open = picksOpen(ch), iPicked = me() in (ch.picked || {});
  return `<div class="chcard${open ? " live" : ""}">
    <div class="secrow" style="margin:0"><b>${title}</b><span class="lab ${open ? "good" : "low"}">${open ? "Picking" : "Waiting"}</span></div>
    <span class="hint">Started by ${by} · scored ${esc(when(ch.endAt, ch.horizon))}, the same end time for everyone</span>
    <div class="pc-acts" style="align-items:center"><span class="stack" aria-hidden="true">${picked.slice(0, 7).map(([a, u]) => ava(u, a === me() ? myCard() : S.cards.get(a), "xs")).join("")}${open ? missing.slice(0, 4).map(([, u]) => `<span class="ava xs empty">${esc(u[0].toUpperCase())}</span>`).join("") : ""}</span><span class="hint" style="flex:1">${picked.length} of ${n} picked · prices hidden</span></div>
    ${open && !iPicked ? `<div class="pc-acts" style="align-items:center"><span style="flex:1;display:grid"><span class="label">Closes in</span><b class="num" style="font-size:22px">${until(ch.joinUntil)}</b></span><button class="btn primary" data-pick="${esc(g)}|${esc(ch.id)}">Make your pick</button></div>` : ""}
    ${iPicked ? `<span class="hint">${mine ? `Your call: ${num(esc(m$(mine.target)))} · ${mine.counts ? "counts to your score" : "group only"}` : "You've picked."}${open ? ` · picks close in ${num(until(ch.joinUntil))}` : ""}</span>` : !open ? `<span class="hint">You didn't pick this one.</span>` : ""}
  </div>`;
}
async function shareResult(g, ch) {
  const r = (ch?.results || []).find((x) => x.a === me());
  if (!r) return;
  const text = `${groupName(g)} · ${ch.t} ${SHORT[ch.horizon]}: I came ${r.rank ? ord(r.rank) : "in"} of ${ch.results.length} (${r.label}) on ${CONFIG.appName}.`;
  try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e?.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text); toast("Result copied."); } catch { prompt("Copy this", text); }
}
function openInviteSheet(g) {
  openSheet("Invite to the group", `<button class="btn primary block" id="ivLink">Share the group link</button>
    <p class="hint">Anyone with the link can join (up to ${GROUP_MAX} players). Or invite a player by username:</p>
    <label class="uname"><span>@</span><input id="ivIn" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="21" placeholder="username" aria-label="Username"></label><div id="ivRes" style="margin-top:8px"></div>`, (body) => {
    body.querySelector("#ivLink").onclick = () => shareLink(g);
    const inp = body.querySelector("#ivIn"), res = body.querySelector("#ivRes"); let t = 0, seq = 0;
    inp.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      const q = inp.value.trim(), my = ++seq; if (!q) { res.innerHTML = ""; return; }
      try { const list = await findPlayers(q); if (my !== seq) return; const grp = S.groups.get(g);
        res.innerHTML = list.length ? `<div class="hl">${list.map((c) => `<div class="row">${ava(c.u, c, "sm")}<span class="main"><span class="t">@${esc(c.u)}</span><span class="s">${c.score != null ? `${c.score} ${esc(c.band || "")}` : "New player"}</span></span>${c.a in (grp?.members || {}) ? `<span class="hint">In the group</span>` : `<button class="btn primary sm" data-iv="${esc(c.a)}" data-u="${esc(c.u)}">Invite</button>`}</div>`).join("")}</div>` : `<p class="hint">No player called @${esc(q)}…</p>`;
        res.querySelectorAll("[data-iv]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { const sent = await invite(g, b.dataset.iv); haptic(); b.textContent = sent ? "Invited" : "Already invited"; } catch (e) { toast(e.message); b.disabled = false; } }));
      } catch { if (my === seq) res.innerHTML = `<p class="hint">Couldn't search just now.</p>`; }
    }, 220); };
    setTimeout(() => inp.focus(), 280);
  });
}
function openGroupInfo(g) {
  const grp = S.groups.get(g); if (!grp) return;
  const owner = grp.owner === me(), ms = Object.entries(grp.members || {});
  openSheet(esc(grp.name), `<div class="label">Players · ${ms.length} of ${GROUP_MAX}</div>
    <div class="hl">${ms.map(([a, u]) => `<div class="row"><button class="pl-hit" data-a="${esc(a)}">${ava(u, a === me() ? myCard() : S.cards.get(a), "sm")}<span class="main"><span class="t">@${esc(u)}${a === me() ? " · you" : ""}</span><span class="s">${a === grp.owner ? "Started the group" : "Player"}</span></span></button>${owner && a !== me() ? `<button class="btn ghost sm danger" data-rm="${esc(a)}" data-u="${esc(u)}">Remove</button>` : ""}</div>`).join("")}</div>
    <div style="display:grid;gap:8px;margin-top:14px"><button class="btn block" id="giShare">Share the group link</button>${owner ? `<button class="btn block" id="giRen">Rename</button>` : ""}<button class="btn block danger" id="giLeave">Leave the group</button></div>
    <p class="hint">${owner ? "You started this group: you can rename it and remove players. If you leave, the next player looks after it." : `Started by @${esc(grp.ownerName)}.`}</p>`, (body) => {
    body.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => openPlayerCard(b.dataset.a)));
    body.querySelector("#giShare").onclick = () => shareLink(g);
    body.querySelector("#giRen")?.addEventListener("click", async () => { const n = prompt("Rename the group", grp.name); if (n && n.trim()) { try { await renameGroup(g, n); toast("Renamed."); closeSheet(); } catch (e) { toast(e.message); } } });
    body.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { if (confirm(`Remove @${b.dataset.u} from ${grp.name}?`)) { try { await removeMember(g, b.dataset.rm); toast(`Removed @${b.dataset.u}.`); closeSheet(); } catch { toast("Couldn't remove just now."); } } }));
    body.querySelector("#giLeave").onclick = async () => { if (!confirm(`Leave ${grp.name}?${ms.length === 1 ? " You're the last player, so the group will be deleted." : ""}`)) return; try { await leaveGroup(g); closeSheet(); if (APP.openGroup === g) backFromGroup(); toast(`You left ${grp.name}.`); if (APP.tab === "play") renderPlay(); } catch { toast("Couldn't leave just now. Try again."); } };
  });
}

// ---------- making a call: the shared parts of the predict, challenge and pick sheets
function priceField(id, sym, horizon, keep) {
  const p0 = lastPrice(sym.key), r = allowedRange({ horizon, p0, sigmaD: sigmaOf(sym.key) });
  return `<div class="pnow"><span>${esc(sym.t)} now</span><b class="num">${esc(money(p0, sym.m))}</b></div>
    <label class="field" style="margin:12px 0 0"><span>Where will ${esc(sym.t)} be ${horizon === "1y" ? "in a year" : `in ${esc(HORIZONS[horizon].label)}`}?</span>
      <div class="uname"><span>$</span><input id="${id}" class="num" inputmode="decimal" autocomplete="off" placeholder="${esc(money(r.upFrom, sym.m).replace("$", ""))}" value="${esc(keep || "")}"></div></label>
    <p class="hint" id="${id}Msg">Call a move: ${esc(money(r.downFrom, sym.m))} or lower, or ${esc(money(r.upFrom, sym.m))} or higher.</p>`;
}
function watchPrice(body, id, sym, horizon, onValid) {
  const inp = body.querySelector("#" + id), msg = body.querySelector("#" + id + "Msg"), p0 = lastPrice(sym.key), sigmaD = sigmaOf(sym.key), r = allowedRange({ horizon, p0, sigmaD });
  const val = () => parseFloat(inp.value.replace(/[^0-9.]/g, ""));
  const check = () => {
    if (!inp.value.trim()) { msg.className = "hint"; msg.textContent = `Call a move: ${money(r.downFrom, sym.m)} or lower, or ${money(r.upFrom, sym.m)} or higher.`; onValid(false); return; }
    const c = checkPrediction({ horizon, p0, target: val(), sigmaD });
    msg.className = "hint " + (c.ok ? "good" : "bad");
    msg.textContent = c.ok ? `${pct(((val() - p0) / p0) * 100, 1)} from now · a call ${val() > p0 ? "up" : "down"}` : c.error;
    onValid(c.ok);
  };
  inp.oninput = check; check();
  return { val, p0, sigmaD, inp };
}
// lock-in: a short buzz (where the phone supports it) and a press-and-ripple on the button
function lockFeel(btn) { haptic([10, 40, 16]); btn.classList.remove("thump"); void btn.offsetWidth; btn.classList.add("thump"); }

// Call it (1.2.0): the period, higher or lower, a size (a little, a usual move, a big move) or your own move as a
// percentage or a price, how sure you are, what it's based on, and whether followers may see it once scored. Can
// also post the call to a group as a challenge.
export const SURE = [["hunch", "A hunch"], ["fairly", "Fairly sure"], ["very", "Very sure"]];
export const BASIS = [["chart", "Chart"], ["indicators", "Indicators"], ["news", "News"], ["gut", "Gut"]];
const SIZES = [["A little", 0.5], ["A usual move", 1], ["A big move", 2]];
export function openPredictSheet(sym, onDone, prefer = null) {
  const p0 = lastPrice(sym.key), sigmaD = sigmaOf(sym.key);
  if (!p0 || sigmaD == null) { toast(`${sym.t} prices haven't loaded yet.`); return; }
  const free = PERIODS.filter((h) => canPredict(store.preds, sym.key, h));
  let horizon = prefer && free.includes(prefer) ? prefer : free.includes("1d") ? "1d" : free[0];
  let dir = 1, size = 1, own = null, sure = "fairly", basis = null, pub = store.data?.callsPublic !== false, post = false, g = myGroups()[0]?.id || null;
  const price = () => (own != null ? own : p0 * Math.exp(dir * SIZES[size][1] * typicalMove(sigmaD, horizon)));
  openSheet(`Call ${esc(sym.t)}`, "", (body) => {
    const draw = () => {
      if (!horizon) {
        body.innerHTML = `<p>You have a call waiting on every period for ${esc(sym.t)}. Each one can be made again once it has been scored.</p><button class="btn block" id="pSee">See your calls</button>`;
        body.querySelector("#pSee").onclick = () => { closeSheet(); APP.playView = "calls"; showTab("play"); };
        return;
      }
      const groups = myGroups(), canPost = groups.length && CH_PERIODS.includes(horizon), tm = typicalMove(sigmaD, horizon), usual = (Math.expm1(tm) * 100).toFixed(horizon === "1y" ? 0 : 1);
      const target = price(), chk = checkPrediction({ horizon, p0, target, sigmaD }), ownPct = own != null ? ((own / p0 - 1) * 100) : null;
      body.innerHTML = `<div class="utabs" role="group" aria-label="Time period">${PERIODS.map((h) => { const open = !canPredict(store.preds, sym.key, h); return `<button data-h="${h}" aria-selected="${h === horizon}" ${open ? "disabled" : ""}>${SHORT[h]}${open ? " · waiting" : ""}</button>`; }).join("")}</div>
        <p class="hint" style="margin:10px 0 0">Now <b class="num">${esc(money(p0, sym.m))}</b>. In ${esc(HORIZONS[horizon].label)} ${esc(sym.t)} usually moves about ${usual}%. Scored ${esc(when(new Date(Date.now() + HORIZONS[horizon].days * 864e5).toISOString(), horizon))}.</p>
        <div class="ob-dir" style="margin-top:14px"><button class="opt big" data-dir="1" aria-pressed="${dir === 1}">Higher</button><button class="opt big dn" data-dir="-1" aria-pressed="${dir === -1}">Lower</button></div>
        <div class="label" style="margin-top:16px">By how much?</div>
        <div class="sizes3">${SIZES.map(([l, k], i) => `<button class="size3" data-k="${i}" aria-pressed="${own == null && i === size}"><b class="num">${esc(money(p0 * Math.exp(dir * k * tm), sym.m))}</b><span>${l}</span></button>`).join("")}</div>
        <div class="ownrow"><span class="hint">Or your own:</span><label class="ownf"><input id="pPct" class="num" inputmode="decimal" placeholder="${(dir * 2 * Math.expm1(tm) * 100 / 2).toFixed(1)}" value="${own != null ? ownPct.toFixed(2) : ""}"><span>%</span></label><span class="hint">or</span><label class="ownf wide"><input id="pPx" class="num" inputmode="decimal" placeholder="${esc(money(target, sym.m).replace("$", ""))}" value="${own != null ? own : ""}"><span>$</span></label></div>
        <p class="hint ${own != null && !chk.ok ? "bad" : ""}" id="pOwnMsg" style="margin:6px 0 0">${own != null && !chk.ok ? esc(chk.error) : "Type either one; the other fills in."}</p>
        <div class="label" style="margin-top:16px">How sure are you?</div>
        <div class="sizes3">${SURE.map(([k, l]) => `<button class="size3 sm" data-sure="${k}" aria-pressed="${sure === k}">${l}</button>`).join("")}</div>
        <div class="label" style="margin-top:16px">Based on <span style="font-weight:400;color:var(--muted);text-transform:none;letter-spacing:0">optional</span></div>
        <div class="opts">${BASIS.map(([k, l]) => `<button class="opt" data-basis="${k}" aria-pressed="${basis === k}">${l}</button>`).join("")}</div>
        <label class="pl-switchrow" style="margin-top:14px"><span><b>Show to followers once scored</b><span class="hint">Counts to your score either way</span></span><span class="switch"><input type="checkbox" id="pPub" ${pub ? "checked" : ""}><span></span></span></label>
        ${canPost ? `<label class="pl-switchrow"><span><b>Also post to a group</b><span class="hint">Members get ${PICK_MINS[horizon] >= 60 ? `${PICK_MINS[horizon] / 60} hour${PICK_MINS[horizon] === 60 ? "" : "s"}` : `${PICK_MINS[horizon]} minutes`} to call the same end time</span></span><span class="switch"><input type="checkbox" id="pPost" ${post ? "checked" : ""}><span></span></span></label>
          ${post ? `<div class="opts">${groups.map((x) => `<button class="opt" data-pg="${esc(x.id)}" aria-pressed="${x.id === g}">${esc(x.name)}</button>`).join("")}</div>` : ""}` : ""}
        <button class="btn primary block" id="pGo" style="margin-top:16px" ${chk.ok ? "" : "disabled"}>${post && canPost ? "Lock in and start challenge" : `Lock in, ${esc(sym.t)} at ${esc(money(target, sym.m))}`}</button>
        <p class="hint" style="text-align:center;margin-top:10px">Locked calls can't be changed. ${post && canPost ? "The group sees you called, not your price, until it's scored. " : ""}Not advice.</p>`;
      body.querySelectorAll("[data-h]").forEach((b) => (b.onclick = () => { horizon = b.dataset.h; own = null; draw(); }));
      body.querySelectorAll("[data-dir]").forEach((b) => (b.onclick = () => { dir = +b.dataset.dir; own = null; haptic(); draw(); }));
      body.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { size = +b.dataset.k; own = null; haptic(); draw(); }));
      body.querySelectorAll("[data-sure]").forEach((b) => (b.onclick = () => { sure = b.dataset.sure; draw(); }));
      body.querySelectorAll("[data-basis]").forEach((b) => (b.onclick = () => { basis = basis === b.dataset.basis ? null : b.dataset.basis; draw(); }));
      body.querySelector("#pPub").onchange = (e) => (pub = e.target.checked);
      body.querySelector("#pPost")?.addEventListener("change", (e) => { post = e.target.checked; draw(); });
      body.querySelectorAll("[data-pg]").forEach((b) => (b.onclick = () => { g = b.dataset.pg; draw(); }));
      // your own move: a percentage or a price; the other field follows, and the presets step aside
      const pctIn = body.querySelector("#pPct"), pxIn = body.querySelector("#pPx"), go = body.querySelector("#pGo"), msg = body.querySelector("#pOwnMsg");
      const useOwn = (v) => { own = v; const c = checkPrediction({ horizon, p0, target: v, sigmaD }); body.querySelectorAll("[data-k]").forEach((b) => b.setAttribute("aria-pressed", "false")); go.disabled = !c.ok; go.textContent = `Lock in, ${sym.t} at ${money(v, sym.m)}`; msg.className = "hint " + (c.ok ? "good" : "bad"); msg.textContent = c.ok ? `${pct((v / p0 - 1) * 100, 1)} from now, a call ${v > p0 ? "up" : "down"}` : c.error; };
      pctIn.oninput = () => { const x = parseFloat(pctIn.value.replace(/[^0-9.\-]/g, "")); if (!isFinite(x) || !pctIn.value.trim()) { own = null; return draw(); } const v = p0 * (1 + x / 100); pxIn.value = money(v, sym.m).replace("$", ""); useOwn(v); };
      pxIn.oninput = () => { const v = parseFloat(pxIn.value.replace(/[^0-9.]/g, "")); if (!isFinite(v) || !pxIn.value.trim()) { own = null; return draw(); } pctIn.value = ((v / p0 - 1) * 100).toFixed(2); useOwn(v); };
      go.onclick = async () => {
        go.disabled = true; const label = go.textContent; go.textContent = "Locking in…";
        const target = price();
        try {
          if (post && canPost) await startChallenge({ g, sym, horizon, target, p0, sigmaD, counts: true });
          else await makePrediction({ sym, horizon, target, p0, sigmaD, sure, basis, pub });
          lockFeel(go); go.textContent = "Locked in";
          setTimeout(() => { closeSheet(); toast(post && canPost ? `Locked in. ${groupName(g)} has a ${SHORT[horizon]} challenge on ${sym.t}.` : `Locked in: ${sym.t} at ${money(target, sym.m)} in ${HORIZONS[horizon].label}.`, { ms: 4500 }); onDone?.(); }, 420);
        } catch (e) { msg.className = "hint bad"; msg.textContent = e.message || "Couldn't save. Try again."; go.disabled = false; go.textContent = label; }
      };
    };
    draw();
  });
}
// "Where it counts" for a group pick: counts to your public score (and is a normal prediction), or group only.
function countsHtml(coin, horizon, counts) {
  const can = canCount(coin, horizon), t = coin.split(":")[1];
  return `<div class="label" style="margin-top:6px">Where it counts</div>
    <label class="optc${can && counts ? " on" : ""}${can ? "" : " off"}"><input type="radio" name="pcnt" value="counts" ${can && counts ? "checked" : ""} ${can ? "" : "disabled"}><span><b>Counts to my score</b><span class="hint">${can ? `Also a normal ${HORIZONS[horizon].label} prediction. Your public score moves with it.` : `You already have an open ${HORIZONS[horizon].label} prediction on ${esc(t)}, so this one is for the group only.`}</span></span></label>
    <label class="optc${!can || !counts ? " on" : ""}"><input type="radio" name="pcnt" value="group" ${!can || !counts ? "checked" : ""}><span><b>Group only</b><span class="hint">Scored for this group's table. Your public score doesn't change.</span></span></label>`;
}
// Start a challenge in a group (from the group, or Rematch).
export function openChallengeSheet(g, pre = {}) {
  const coins = allSyms().filter((x) => D.series[x.key]?.bars?.length);
  if (!coins.length) { toast("Prices haven't loaded yet."); return; }
  let key = pre.coin && coins.some((c) => c.key === pre.coin) ? pre.coin : coins[0].key, horizon = pre.horizon || "1d", counts = store.data?.pickDefault !== "group";
  openSheet(`New challenge · ${esc(groupName(g))}`, "", (body) => {
    const draw = (keep = "") => {
      const sym = symOf(key);
      body.innerHTML = `<div class="label">Coin</div><div class="pchips">${coins.map((x) => `<button class="pchip${x.key === key ? " on" : ""}" data-ck="${esc(x.key)}" aria-pressed="${x.key === key}"><b>${esc(x.t)}</b><span class="num">${esc(money(lastPrice(x.key), x.m))}</span></button>`).join("")}</div>
        <div class="utabs" role="group" aria-label="Time period" style="margin-top:12px">${CH_PERIODS.map((h) => `<button data-h="${h}" aria-selected="${h === horizon}">${SHORT[h]}</button>`).join("")}</div>
        ${priceField("cIn", sym, horizon, keep)}
        <p class="hint">Picks stay open for ${PICK_MINS[horizon] >= 60 ? `${PICK_MINS[horizon] / 60} hour${PICK_MINS[horizon] === 60 ? "" : "s"}` : `${PICK_MINS[horizon]} minutes`}. Everyone is scored at <b>${esc(when(new Date(Date.now() + HORIZONS[horizon].days * 864e5).toISOString(), horizon))}</b>.</p>
        ${countsHtml(key, horizon, counts)}
        <button class="btn primary block" id="cGo" disabled style="margin-top:12px">Lock in and start</button>
        <p class="hint" style="text-align:center">Can't be changed once locked. The group sees you called, never your price, until it's scored. Not advice.</p>`;
      const go = body.querySelector("#cGo"), f = watchPrice(body, "cIn", sym, horizon, (ok) => (go.disabled = !ok));
      body.querySelectorAll("[data-ck]").forEach((b) => (b.onclick = () => { key = b.dataset.ck; draw(); }));
      body.querySelectorAll("[data-h]").forEach((b) => (b.onclick = () => { horizon = b.dataset.h; draw(f.inp.value); }));
      body.querySelectorAll('input[name="pcnt"]').forEach((r) => (r.onchange = () => { counts = r.value === "counts"; draw(f.inp.value); }));
      go.onclick = async () => {
        go.disabled = true; go.textContent = "Starting…";
        const useCounts = counts && canCount(key, horizon);
        try { await startChallenge({ g, sym, horizon, target: f.val(), p0: f.p0, sigmaD: f.sigmaD, counts: useCounts }); lockFeel(go); go.textContent = "Locked in";
          setTimeout(() => { closeSheet(); toast("Challenge started. The group's been told."); setTimeout(() => openGroup(g), 300); }, 420); }
        catch (e) { const m = body.querySelector("#cInMsg"); m.className = "hint bad"; m.textContent = e.message; go.disabled = false; go.textContent = "Lock in and start"; }
      };
    };
    draw();
  });
}
// Your pick for a challenge someone started.
export function openPickSheet(g, ch) {
  const sym = symOf(ch.coin);
  if (!lastPrice(ch.coin) || sigmaOf(ch.coin) == null) { toast(`${ch.t} prices haven't loaded yet. Add ${ch.t} to a watchlist to call it.`, { ms: 4500 }); return; }
  let counts = store.data?.pickDefault !== "group";
  openSheet(`Your pick · ${esc(ch.t)} · ${SHORT[ch.horizon]}`, "", (body) => {
    const draw = (keep = "") => {
      body.innerHTML = `<p class="hint" style="margin-top:0">${esc(groupName(g))} · picks close in ${num(until(ch.joinUntil))} · scored ${esc(when(ch.endAt, ch.horizon))}</p>
        ${priceField("kIn", sym, ch.horizon, keep)}
        ${countsHtml(ch.coin, ch.horizon, counts)}
        <button class="btn primary block" id="kGo" disabled style="margin-top:12px">Lock in pick</button>
        <p class="hint" style="text-align:center">Can't be changed once locked. The group sees you picked, never your price, until it's scored. Not advice.</p>`;
      const go = body.querySelector("#kGo"), f = watchPrice(body, "kIn", sym, ch.horizon, (ok) => (go.disabled = !ok));
      body.querySelectorAll('input[name="pcnt"]').forEach((r) => (r.onchange = () => { counts = r.value === "counts"; draw(f.inp.value); }));
      go.onclick = async () => {
        go.disabled = true; go.textContent = "Locking in…";
        try { await makePick({ g, ch, target: f.val(), p0: f.p0, sigmaD: f.sigmaD, counts: counts && canCount(ch.coin, ch.horizon) }); lockFeel(go); go.textContent = "Locked in";
          setTimeout(() => { closeSheet(); toast(`Picked. Results land ${when(ch.endAt, ch.horizon)}.`, { ms: 4000 }); }, 420); }
        catch (e) { const m = body.querySelector("#kInMsg"); m.className = "hint bad"; m.textContent = e.message; go.disabled = false; go.textContent = "Lock in pick"; }
      };
      setTimeout(() => f.inp.focus(), 250);
    };
    draw();
  });
}

// ---------- the avatar sheet: your account and settings (what Profile used to be)
let admin = null;
export function openAvatarSheet() {
  const sc = myScore(), card = myCard(), u = myName(), unread = store.alerts.filter((a) => !a.read).length;
  const row = (k, t, s, extra = `<span class="chev">›</span>`) => `<button class="row" data-av="${k}"><span class="main"><span class="t">${t}</span>${s ? `<span class="s">${s}</span>` : ""}</span>${extra}</button>`;
  const sw = (id, on, label) => `<span class="switch"><input type="checkbox" id="${id}" ${on ? "checked" : ""} aria-label="${label}"><span></span></span>`;
  openSheet("Account", `<button class="row pl-me" data-av="card">${ava(u, cardFromScore(), "lg")}<span class="main"><span class="t" style="font-size:var(--t-xl)">@${esc(u || "you")}</span><span class="s">${sc?.score != null ? `${num(sc.score)} ${esc(sc.band)}` : `${num(0)} · No calls scored yet`}${card?.followers ? ` · ${card.followers} follower${card.followers === 1 ? "" : "s"}` : ""}</span><span class="s" style="color:var(--accent);font-weight:700">View your profile</span></span><span class="chev">›</span></button>
    <div class="label pg">People and privacy</div><div class="hl">
      ${row("following", "Following", following().length ? `${following().length} player${following().length === 1 ? "" : "s"} · only you can see who` : "Players you follow show here, only to you")}
      <div class="row"><span class="main"><span class="t">Public leaderboard</span><span class="s">Show my username, score and rank to everyone</span></span>${sw("avPub", store.data?.public === true, "Public leaderboard")}</div>
      <div class="row"><span class="main"><span class="t">Group picks count to my score</span><span class="s">The default when you pick in a group; you can change it each time</span></span>${sw("avCnt", store.data?.pickDefault !== "group", "Group picks count to my score")}</div>
    </div>
    <div class="label pg">Charts and alerts</div><div class="hl">
      ${row("chart", "Chart style", "Time range, candles and lines")}
      ${row("rules", "Alert rules", "Get told when your levels are hit")}
      ${row("alerts", `Alerts${unread ? ` <span class="pill confirmed">${unread} new</span>` : ""}`, "Everything that has fired")}
      ${row("push", "Notifications", "Alerts, group challenges and results on this phone")}
    </div>
    <div class="label pg">Sharing</div><div class="hl">${row("lists", "Shared lists", "Follow a list of coins with friends")}</div>
    <div class="label pg">App</div><div class="hl">
      ${row("account", "Account", `Username (${esc(u ? "@" + u : "not set")}), sign-in id, delete your data`)}
      ${row("appearance", "Appearance", "Dark, light or match phone")}
      ${row("feedback", "Give feedback", "Hold anything for 3 seconds, or switch on tap-to-comment")}
      ${row("legal", "Legal and disclaimer", "Terms, privacy, grievance contact")}
      <span data-admin></span>
    </div>
    <p class="hint pl-ver">${esc(CONFIG.appName)} ${esc(CONFIG.version)}</p>`, (body) => {
    const go = (k) => {
      if (k === "card") { closeSheet(); return openPlayerCard(me()); }
      if (k === "following") return openFollowing();
      if (k === "push") return enablePush().then(() => toast("Notifications are on for this phone."), (e) => toast(e.message, { ms: 5000 }));
      if (k === "feedback") { closeSheet(); setFeedbackMode(true); showTab("feed"); return; }
      closeSheet(); APP.backTo = APP.tab === "profile" ? APP.backTo : APP.tab; showTab("profile", k);
    };
    body.querySelectorAll("[data-av]").forEach((b) => (b.onclick = () => go(b.dataset.av)));
    body.querySelector("#avPub").onchange = async (e) => { await setPublic(e.target.checked); toast(e.target.checked ? "You'll show on the public leaderboard at the next update." : "You're off the public leaderboard from the next update."); };
    body.querySelector("#avCnt").onchange = (e) => setPickDefault(e.target.checked ? "counts" : "group");
    const showAdmin = () => { const a = body.querySelector("[data-admin]"); if (a && admin) { a.outerHTML = row("inbox", "Feedback inbox", "Admin · everyone's notes, newest first"); body.querySelector('[data-av="inbox"]').onclick = () => go("inbox"); } };
    if (admin === null) isAdmin().then((x) => { admin = x; showAdmin(); }); else showAdmin();
  });
}
function openFollowing() {
  openSheet("Following", `<p class="hint">Only you can see who you follow. They see a follower count, never your name.</p><div id="flList"><p class="hint">Loading…</p></div>`, async (body) => {
    const box = body.querySelector("#flList"), ids = following();
    if (!ids.length) { box.innerHTML = `<div class="empty">You don't follow anyone yet.</div><button class="btn primary block" id="flFind">Find players</button>`; box.querySelector("#flFind").onclick = () => openSearch(); return; }
    const cards = await getCards(ids).catch(() => ids.map(() => null));
    box.innerHTML = `<div class="hl">${ids.map((a, i) => { const c = cards[i] || { u: "player", score: null }; return `<div class="row"><button class="pl-hit" data-a="${esc(a)}">${ava(c.u, c, "sm")}<span class="main"><span class="t">@${esc(c.u)}</span><span class="s">${c.score != null ? `${c.score} ${esc(c.band || "")}` : "No score yet"}</span></span></button><button class="btn ghost sm" data-uf="${esc(a)}">Unfollow</button></div>`; }).join("")}</div>`;
    box.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => openPlayerCard(b.dataset.a)));
    box.querySelectorAll("[data-uf]").forEach((b) => (b.onclick = async () => { await follow(b.dataset.uf, false); b.closest(".row").remove(); }));
  });
}

// ---------- links: #/g/<id> joins a group (after the username step); #/predict opens the tab
export async function openLink(hash = location.hash) {
  const m = hash.match(/^#\/g\/([a-z0-9]{20,})/);
  if (/^#\/predict/.test(hash) || m) { history.replaceState(null, "", location.pathname); showTab("play"); }
  if (!m) return;
  APP.playView = "groups"; renderPlay();
  const g = m[1];
  let info; try { info = await peekGroup(g); } catch { toast("Couldn't open that group just now. Check your connection and try the link again.", { ms: 5000 }); return; }
  if (!info) { toast("That group doesn't exist any more, or the link is wrong.", { ms: 5000 }); return; }
  if (info.member) { openGroup(g); return; }
  // a link never adds anyone by itself: say which group it is, and join only on a yes
  openSheet("Join this group?", `<div class="pl-intro" style="text-align:center"><b style="font-size:var(--t-xl)">${esc(info.name)}</b><p class="hint">Started by @${esc(info.ownerName || "someone")} · ${info.n} player${info.n === 1 ? "" : "s"}</p></div>
    <p class="hint">You'll play under @${esc(myName() || "your username")}. The group sees your username, your picks once they're scored, and your points in its table, never your other calls.</p>
    <button class="btn primary block" id="jgGo">Join ${esc(info.name)}</button><button class="btn block" id="jgNo" style="margin-top:8px">Not now</button>`, (body) => {
    body.querySelector("#jgNo").onclick = closeSheet;
    body.querySelector("#jgGo").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Joining…";
      try { const grp = await joinGroup(g); closeSheet(); haptic(); toast(`You're in ${grp.name}.`); setTimeout(() => openGroup(g), 280); }
      catch (err) { toast(err.message, { ms: 5000 }); e.target.disabled = false; e.target.textContent = `Join ${info.name}`; }
    };
  });
}
// After the profile pages: back to where you came from (the avatar sheet reopens on Predict)
export function backFromProfile() {
  const to = APP.backTo || "play"; APP.backTo = null;
  showTab(to);
  if (to === "play") setTimeout(openAvatarSheet, 50);
}
