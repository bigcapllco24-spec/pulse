// The Calls tab: your record and score, today's coin, calls waiting and scored, the replay of a scored call, a coin's
// own calls and #/ links, plus the small display helpers the Calls pages share (avatars, labels, times).
// Making a call: callit.js. Groups: groups.js. Ranks, player cards and search: people.js. Your account: account.js.
// Data lives in store.js (your account and calls) and social.js (people and groups).
import { CONFIG } from "../config.js";
import { store, ls, allSyms, myScore, pendingHere, settleHere, nextDue } from "./store.js";
import { HORIZONS, canPredict, dailyVol, dueAt, closenessText, isRight, callDir, BANDS, PROVISIONAL_UNDER } from "./score.js";
import { krakenRows } from "./predict.js";
import { krakenBars, D } from "./data.js";
import { $, esc, money, pct, toast, haptic, openSheet, closeSheet, ago } from "./ui.js";
import { APP, showTab, backLabel } from "./app.js";
import { openRecord, renderRecord } from "./you.js";
import { openPage, closePage, backBtn, pageOpen } from "./nav.js";
import { openProfile, openAddSheet } from "./pages.js";
import { BAND_CLASS, SHORT, bandBar, bandTag } from "./card.js";
import { istDay, dailyCoin, msUntilNextDay, whatHappened } from "./habit.js";
import { levelOf, ringClass, ringOf, ringName, callsFor, UNLOCKS } from "./progress.js";
import { S, onSocial, myName, bandOf, myGroups, peekGroup, joinGroup, settleChallengesHere, nextChallengeEnd, challengesOf, waitingForMe, unseenResults } from "./social.js";
import { drawGroup, openPickSheet, openGroup, groupsView } from "./groups.js";
import { openSearch, myStreak } from "./people.js";
import { openPredictSheet, SURE, BASIS } from "./callit.js";

export const PERIODS = Object.keys(HORIZONS);
export const LABEL_CLASS = { "Spot on": "good", "Very close": "good", Close: "mid", Off: "low", "Far off": "bad", "Wrong way": "bad", "Not counted": "low" };
// What a scored call shows (1.2.0): its closeness label, or "Wrong way" when the price went the other way from the call.
// "Wrong way": the price went against a call up or down ("No change" calls are never shown as wrong way: they're Off).
export const wrongWay = (r) => r?.status === "scored" && r.p0 != null && r.actual != null && r.actual !== r.p0 && callDir(r) !== 0 && !isRight(r);
export const shownLabel = (r) => (wrongWay(r) ? "Wrong way" : r.label);
export const m$ = (x) => money(x, "CRYPTO");
export const num = (s) => `<span class="num">${s}</span>`;
export const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
// a letter avatar: the username's first letter, ringed in its band's colour (dashed while provisional)
export function ava(u, card, size = "", attrs = "") {
  const cls = card?.score != null && !card.prov ? BAND_CLASS[card.band || bandOf(card.score)] || "" : "prov";
  return `<span class="ava ${size} ${cls}" ${attrs}>${esc((u || "?")[0].toUpperCase())}</span>`;
}
// the level avatar (1.2.0): the letter ringed in the level's colour (progress.js), with the level in a small badge
export function levelAvatar(u, level, size = "", attrs = "") {
  return `<span class="ava lv ${size} ${ringClass(level)}" ${attrs}>${esc((u || "?")[0].toUpperCase())}<b class="lvb">${level}</b></span>`;
}
export const until = (iso) => { const m = Math.round((Date.parse(iso) - Date.now()) / 60000); return m <= 0 ? "now" : m < 60 ? `${m}m` : m < 2880 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${Math.round(m / 1440)} days`; };
const leftText = (iso, h) => (h === "1y" ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : Date.parse(iso) <= Date.now() ? "scoring" : `${until(iso)} left`);
export const when = (iso, h) => new Date(iso).toLocaleString("en-IN", h === "1y" ? { day: "numeric", month: "short", year: "numeric" } : { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const lastPrice = (key) => D.series[key]?.bars?.at(-1)?.c;
export const symOf = (key) => allSyms().find((s) => s.key === key) || { key, t: key.split(":")[1], n: key.split(":")[1], m: "CRYPTO", ty: "C" };
// volatility for checking a call: the 30 full days before today, as the start-price lock uses
export const sigmaOf = (key) => { const b = D.series[key]?.bars || []; return dailyVol(b.slice(0, -1).map((x) => x.c)); };
export const groupName = (g) => S.groups.get(g)?.name || "a group";

// ---------- the Calls tab
export function initPlay() {
  onSocial(() => { badge(); if (APP.tab === "play") rerender(); if (pageOpen("sFriends")) rerenderPages("friends"); });
  setInterval(() => { if ($("sheet").hidden && !document.hidden) { if (APP.tab === "play") rerender(); if (APP.openGroup) drawGroup(); } }, 30000); // countdowns
  // score calls and challenges on this phone the moment they're due (the data job confirms them a few minutes later)
  store.on((w) => w === "preds" && scheduleScoring()); onSocial(scheduleScoring);
  store.on((w) => (w === "preds" || w === "account" || w === "all") && checkLevelUp());
  setTimeout(checkLevelUp, 3000);
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
export const rerender = () => { const pg = $("play").parentElement, y = pg.scrollTop; renderPlay(); pg.scrollTop = y; };
// pages that live with Calls, redrawn in place when their data changes
export function rerenderPages(name) { if (name === "friends") renderFriends(); else if (name === "record") renderRecord(); }
// The Calls tab's badge: picks waiting for you and invites.
export function badge() {
  const n = waitingForMe().length + S.invites.length, b = document.querySelector('.tabbar [data-tab="play"] .badge'); // picks and invites waiting for you
  if (b) { b.hidden = !n; b.textContent = n || ""; }
}
const groupsNeedYou = () => waitingForMe().length + unseenResults().length + S.invites.length > 0;

// Calls (1.3.2): what a call is in one line, Make a call, your record, today's coin, calls waiting, friends, calls scored.
// Everything that can be tapped has a chevron or a button (designer's feedback, 22 Oct).
export function renderPlay() {
  const el = $("play");
  el.innerHTML = `<div class="pl-top2"><h1>Calls</h1><button class="iconbtn round" id="plFind" aria-label="Find players">${ICON.search}</button></div>
    <p class="hint pl-what">Say where a price will be. ${esc(CONFIG.appName)} scores how close you got. <button class="linkbtn" id="plAbout">About your score</button></p>
    <button class="btn primary block pl-make" id="plMake">${ICON.plus}Make a call</button>
    <div class="pl-view" data-view="calls"></div>`;
  callsView(el.querySelector(".pl-view"));
  el.querySelector("#plFind").onclick = () => openSearch();
  el.querySelector("#plAbout").onclick = () => openAboutScore();
  el.querySelector("#plMake").onclick = () => openCoinPicker();
  wirePicks(el);
}
const ICON = {
  search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  up: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>`,
  down: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>`,
  flat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14M5 15h14"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`,
  group: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="9" r="3.2"/><circle cx="16.5" cy="10" r="2.6"/><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M14.5 15c2.3-.3 4.6.8 5.5 4"/></svg>`,
  list: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>`,
  target: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/></svg>`,
  bars: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h4V10H4zM10 18h4V6h-4zM16 18h4V13h-4z"/></svg>`,
};
const CHEV = `<span class="chev" aria-hidden="true">›</span>`;
const dirOf = callDir;
const badgeOf = (d) => `<span class="dbadge ${d > 0 ? "up" : d < 0 ? "dn" : "flat"}">${d > 0 ? ICON.up : d < 0 ? ICON.down : ICON.flat}</span>`;
const callLine = (p) => { const d = dirOf(p); return d ? `${d > 0 ? "Higher" : "Lower"}, about ${num(esc(m$(p.target)))}` : `No change, about ${num(esc(m$(p.target)))}`; };
const coinName = (key, t) => symOf(key).n || t;
// About your score (exact copy, 22 Oct): the three things that matter, never how it's worked out.
export function openAboutScore() {
  openSheet("About your score", `<div class="about">
      <p>${ICON.up}<span>Calling the right direction matters.</span></p>
      <p>${ICON.target}<span>Getting close to the real price matters too.</span></p>
      <p>${ICON.bars}<span>One call can be luck. Your record shows skill over many calls: it starts to count after 10.</span></p>
    </div>
    <p class="about-note"><b>Every call builds your record.</b> The more you call, the sooner your skill shows, and the more your score says about you.</p>
    <button class="btn primary block" id="abMake">Make a call</button>`, (body) => { body.querySelector("#abMake").onclick = () => openCoinPicker(); });
}
// Make a call from Calls: pick one of your coins (the feed's list), then the usual Call it.
export function openCoinPicker() {
  const syms = allSyms().filter((x) => lastPrice(x.key));
  openSheet("Make a call", syms.length ? `<p class="hint" style="margin:0 0 10px">Pick a coin. Prices are the latest the app has.</p><div class="hl">${syms.map((x, i) => { const open = store.preds.filter((p) => p.coin === x.key).length;
      return `<button class="row" data-cp="${i}"><span class="main"><span class="t">${esc(x.n || x.t)} <span class="hint">${esc(x.t)}</span></span><span class="s">${num(esc(money(lastPrice(x.key), x.m)))}${open ? ` · ${open} waiting` : ""}</span></span>${CHEV}</button>`; }).join("")}</div>
    <button class="btn block" id="cpAdd" style="margin-top:12px">Add a coin</button>` : `<p class="hint">Prices are still loading. Try again in a moment.</p>`, (body) => {
    body.querySelectorAll("[data-cp]").forEach((b) => (b.onclick = () => openPredictSheet(syms[+b.dataset.cp], () => APP.tab === "play" && rerender())));
    body.querySelector("#cpAdd")?.addEventListener("click", () => { closeSheet(); openAddSheet(); });
  });
}
export function wirePicks(root) {
  root.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const [g, c] = b.dataset.pick.split("|"), ch = challengesOf(g).find((x) => x.id === c); if (ch) openPickSheet(g, ch); }));
}
// The plain-language read on how well someone reads the market: from 10 scored calls, when the score stops being
// provisional (score v2; until 1.4.2 it waited for 30, feedback 17 Oct).
export const VERDICT_AT = PROVISIONAL_UNDER, PROVEN = BANDS[0][0]; // "Reading it well" from the Proven band
// n: scored calls (the phone's count, which is ahead of the score while the job confirms the newest)
export function verdictOf(sc, n = sc?.n || 0) {
  if (!n) return { text: "Make your first call", key: "none", n };
  if (n < VERDICT_AT) return { text: "Too early to tell", key: "early", n };
  return sc?.score >= PROVEN ? { text: "Reading it well", key: "well", n } : { text: "Still learning", key: "learning", n };
}

// ---------- Calls: your record, today, waiting, with friends, scored
function callsView(el) {
  // waiting: your predictions, plus group picks that don't count to your score (those that do are predictions too)
  // a call scored on this phone the moment it was due moves straight to Scored (marked "confirming" until the server's copy lands)
  const here = pendingHere(), isHere = (p) => here.some((r) => r.t === p.t && r.horizon === p.horizon && r.createdAt === p.createdAt);
  const open = [...store.preds.filter((p) => !isHere(p)).map((p) => ({ ...p, kind: "pred" })), ...S.picks.filter((p) => !p.counts && p.status !== "scored" && p.status !== "void").map((p) => ({ ...p, kind: "pick" }))]
    .sort((a, b) => Date.parse(dueAt(a)) - Date.parse(dueAt(b)));
  const done = [...here, ...store.results].sort((a, b) => Date.parse(b.resolvedAt || 0) - Date.parse(a.resolvedAt || 0));
  const sc = myScore(), n = done.filter((r) => r.status === "scored").length, v = verdictOf(sc, n), st = myStreak();
  const callRow = (p, i) => {
    const due = dueAt(p), grp = p.g ? ` · ${esc(groupName(p.g))}` : "";
    return `<button class="row crow" data-open="${i}">${badgeOf(dirOf(p))}<span class="main"><span class="t">${esc(coinName(p.coin, p.t))} · ${SHORT[p.horizon]}</span><span class="s">${callLine(p)}${grp}${p.kind === "pick" ? " · group only" : ""}</span></span><span class="when">${ICON.clock}${esc(Date.now() >= Date.parse(due) ? "scoring" : until(due))}</span>${CHEV}</button>`;
  };
  // 1.5.0 (feedback 16 Oct: too much in this box): the score, its band and the verdict; the streak moved to Today
  const up = sc?.score != null ? [...BANDS].reverse().find(([min]) => min > sc.score) : null;
  const bits = [`${n} scored call${n === 1 ? "" : "s"}`, n < VERDICT_AT ? `${VERDICT_AT - n} to go` : up ? `${up[0] - sc.score} to ${up[1]}` : ""].filter(Boolean).join(" · ");
  const waits = waitingForMe(), groups = myGroups(), lists = [...store.lists.values()];
  const friendRows = [
    ...waits.slice(0, 2).map((ch) => `<div class="row"><span class="gicon">${ICON.group}</span><span class="main"><span class="t">${esc(groupName(ch.g))}</span><span class="s warnt">Needs your pick · ${esc(until(ch.joinUntil))} left</span></span><button class="btn primary sm" data-pick="${esc(ch.g)}|${esc(ch.id)}">Pick</button></div>`),
    ...groups.filter((g) => !waits.some((w) => w.g === g.id)).slice(0, 2).map((g) => `<button class="row" data-g="${esc(g.id)}"><span class="gicon">${ICON.group}</span><span class="main"><span class="t">${esc(g.name)}</span><span class="s">Group · ${Object.keys(g.members || {}).length} players</span></span>${CHEV}</button>`),
    ...lists.slice(0, 2).map((l) => `<button class="row" data-list="${esc(l.id)}"><span class="gicon">${ICON.list}</span><span class="main"><span class="t">${esc(l.name)}</span><span class="s">Shared list · ${(l.symbols || []).length} coins · ${Object.keys(l.members || {}).length} members</span></span>${CHEV}</button>`),
  ];
  const link = (id, text) => `<button class="linkbtn more" id="${id}">${text}<span aria-hidden="true"> ›</span></button>`;
  el.innerHTML = `<button class="progcard pc3" id="plProg"><span class="pc3-row"><span class="pc3-score"><b class="num">${sc?.score ?? "–"}</b>${bandTag(sc, "pc3-band")}</span><span class="pc3-main"><span class="label">Your record</span><b>${esc(v.text)}</b><span class="s">${esc(bits)}</span></span>${CHEV}</span>${bandBar(sc?.score, "pc3-bar")}</button>
    <div class="secrow"><span class="label">Today</span>${st.n ? `<span class="streak">${FLAME}${st.n}-day streak</span>` : ""}</div>
    ${dailyBox(here, st.n)}
    <div class="secrow"><span class="label">Waiting${open.length ? ` · ${open.length}` : ""}</span></div>
    ${open.length ? `<div class="hl">${open.map(callRow).join("")}</div>` : `<p class="hint pl-empty">Nothing waiting. Make a call above, or tap Call it on any chart in the feed.</p>`}
    <div class="secrow"><span class="label">With friends</span>${link("plFriends", `All groups${groupsNeedYou() ? ' <span class="dot" aria-label="needs you"></span>' : ""}`)}</div>
    ${friendRows.length ? `<div class="hl">${friendRows.join("")}</div>` : `<p class="hint pl-empty">Start a group, or join one from a friend's link, to call the same coins together.</p>`}
    <div class="secrow"><span class="label">Scored</span>${done.length > 3 ? link("plAll", `See all ${done.length}`) : ""}</div>
    ${done.length ? `<div class="hl pl-scored">${done.slice(0, 3).map(resultRow).join("")}</div>` : `<p class="hint pl-empty">Scored calls show here, with how close each one was.</p>`}`;
  el.querySelector("#plProg").onclick = () => openRecord();
  el.querySelector("#plFriends").onclick = () => openFriends();
  el.querySelector("[data-daily]")?.addEventListener("click", () => { const { dc, mine, blocked } = dailyState(here); if (!mine && !blocked) openPredictSheet(dc, () => APP.tab === "play" && renderPlay(), "1d"); else if (mine) (mine.status === "scored" ? openResult(mine) : mine.actual == null ? openWaiting(mine) : null); });
  el.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => openGroup(b.dataset.g)));
  el.querySelectorAll("[data-list]").forEach((b) => (b.onclick = () => openListPage(b.dataset.list)));
  el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openWaiting(open[+b.dataset.open])));
  const wireRes = (root) => root.querySelectorAll("[data-res]").forEach((b) => (b.onclick = () => openResult(done[+b.dataset.res])));
  wireRes(el);
  el.querySelector("#plAll")?.addEventListener("click", () => openSheet("Scored calls", `<div class="hl">${done.map(resultRow).join("")}</div>`, wireRes));
}
// A call that's waiting: what was called, from where, where the price is now, and when it's scored. Facts only.
function openWaiting(p) {
  if (!p) return;
  const now = lastPrice(p.coin), from = p.p0 ?? p.clientP0, d = dirOf(p), due = dueAt(p);
  openSheet(`${esc(coinName(p.coin, p.t))} · ${SHORT[p.horizon]}`, `<div class="pc2-row" style="margin-bottom:10px">${badgeOf(d)}<span style="flex:1;font-weight:700">${callLine(p)}</span></div>
    <div class="hl">
      <div class="row"><span class="main"><span class="t">Price when you called</span><span class="s">${esc(when(p.createdAt, p.horizon))}</span></span><b class="num">${from != null ? esc(m$(from)) : "–"}</b></div>
      <div class="row"><span class="main"><span class="t">Your call</span></span><b class="num">${esc(m$(p.target))}</b></div>
      <div class="row"><span class="main"><span class="t">Price now</span><span class="s">${now != null && from ? `${pct((now / from - 1) * 100, 1)} since you called` : ""}</span></span><b class="num">${now != null ? esc(m$(now)) : "–"}</b></div>
      <div class="row"><span class="main"><span class="t">Scored</span></span><b>${esc(when(due, p.horizon))}</b></div>
    </div>
    <p class="hint">A call can't be changed or taken back once it's locked in.${p.g ? ` Posted to ${esc(groupName(p.g))}.` : ""} Not advice.</p>`);
}
// ---------- the daily coin: one coin a day for everyone (habit.js); yesterday's crowd shows once it's scored
function dailyState(here = pendingHere()) {
  const now = Date.now(), day = istDay(now), dc = dailyCoin(day), all = [...store.preds, ...store.results, ...here];
  const mine = all.find((p) => p.coin === dc.key && p.horizon === "1d" && istDay(Date.parse(p.createdAt)) === day);
  const left = msUntilNextDay(now);
  return { day, dc, mine, blocked: !mine && !canPredict(store.preds, dc.key, "1d"), price: lastPrice(dc.key), left: `${Math.floor(left / 36e5)}h ${Math.floor((left % 36e5) / 6e4)}m` };
}
// today's coin as a row: everyone calls the same coin today; it's a 1-day call like any other
const FLAME = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 2 1.3 3 2.5 3 0-3-1-5 0-8z"/></svg>`;
function dailyBox(here, streak = 0) {
  const { dc, mine, blocked, left } = dailyState(here);
  const right = mine ? `<span class="chip good">You're in</span>${CHEV}` : blocked ? `<span class="hint">1-day call open</span>` : `<span class="btn primary sm" aria-hidden="true">Call</span>`;
  return `<div class="hl"><button class="row" data-daily><span class="gicon">${ICON.target}</span><span class="main"><span class="t">Today's coin: ${esc(dc.n)}</span><span class="s">${mine ? `Called ${esc(m$(mine.target))}, scored ${esc(when(dueAt(mine), "1d"))}` : `${streak ? "Call it to keep your streak" : "Everyone calls it"}, ${esc(left)} left`}</span></span>${right}</button></div>`;
}
// Level up (1.2.0): shown once when the level rises, with what it opens. Remembered on this phone.
const LS_LEVEL = "pl.level";
function checkLevelUp() {
  if (!store.ready || !store.data?.username) return;
  const { level } = myLevel(), seen = ls.get(LS_LEVEL);
  if (seen == null) { ls.set(LS_LEVEL, level); return; }
  if (level <= seen) return;
  ls.set(LS_LEVEL, level);
  if (level < 2 || !$("sheet").hidden || $("gate")) return;
  const next = callsFor(level + 1), name = ringName(level), newRing = ringOf(level) !== ringOf(level - 1);
  openSheet("Level up", `<div class="lvlup">${levelAvatar(myName(), level, "lg xl")}<span class="hint" style="color:var(--accent);font-weight:600">${newRing ? `Level ${level}, and a new ring colour: ${name}` : `Level ${level}`}</span>
      <h2 style="margin:6px 0 0">${callsFor(level)} calls scored</h2>
      <p class="hint" style="max-width:300px;margin:10px auto 0">${esc(UNLOCKS[level] || "Keep going. Levels show how much you've played; your score shows how well.")}</p></div>
    <div class="pc2-box" style="margin-top:20px;gap:6px"><div class="pc2-row"><b>Next: level ${level + 1}</b><span class="hint">${next - callsFor(level)} calls to go</span></div><span class="pl-prog" aria-hidden="true"><i style="width:0%"></i></span>${UNLOCKS[level + 1] ? `<span class="hint">${esc(UNLOCKS[level + 1])}</span>` : ""}</div>
    <button class="btn primary block" data-close style="margin-top:16px">Keep going</button>
    <p class="hint" style="text-align:center">Levels show how much you've played, not how good you are. Your score shows that.</p>`, (body) => { body.querySelector("[data-close]").onclick = closeSheet; haptic([10, 40, 16]); });
}
// the level line on the progress card (progress.js): effort, not skill
export const myLevel = () => levelOf([...store.results, ...pendingHere()]);
// With friends (every group and shared list): a page over Calls.
export function openFriends() {
  const back = backLabel();
  openPage("sFriends");
  $("friends").dataset.back = back; renderFriends();
}
export function renderFriends() {
  const el = $("friends");
  el.innerHTML = `${backBtn(esc(el.dataset.back || "Calls"))}<h1 style="margin:10px 0 4px">With friends</h1><p class="hint" style="margin:0 0 18px">Call the same coins as people you know.</p><div class="pl-view" data-view="friends"></div>`;
  el.querySelector("#pBack").onclick = () => closePage("sFriends");
  groupsView(el.querySelector(".pl-view"));
}
// a shared list's page lives with the settings pages for now (Sharing › Shared lists)
export const openListPage = (id) => openProfile("lists", id);
// ---------- the replay (1.2.0): one scored call, played back on a small chart, with what happened over its period
export function openResult(r) {
  if (!r || r.status !== "scored") return;
  const wh = whatHappened(r, D.news?.stories || []), d = callDir(r), went = r.actual === r.p0 ? null : r.actual > r.p0, wrong = wrongWay(r);
  const missPct = Math.abs(r.actual / r.target - 1) * 100;
  openSheet(`${esc(r.t)} · ${SHORT[r.horizon]}`, `<div class="pc2-row" style="margin-bottom:6px"><span class="lab ${LABEL_CLASS[shownLabel(r)] || ""}" style="font-size:var(--t-xl)">${esc(shownLabel(r))}</span><span class="hint num">${esc(closenessText(r).split(" · ")[0])}</span></div>
    <p class="hint" style="margin:0 0 10px">${d === 0 ? (isRight(r) ? "You called no change, and it stayed close." : `You called no change; it went ${went ? "up" : "down"} further than that.`) : wrong ? `You called ${d > 0 ? "up" : "down"}, it went ${went ? "up" : "down"}.` : `Right direction. ${missPct < 0.05 ? "Exact." : `Missed by ${missPct.toFixed(1)}%.`}`}</p>
    <div class="replay" id="rpChart"><p class="hint">Loading the price path…</p></div>
    <div class="hl">
      <div class="row"><span class="main"><span class="t">Price when you called</span><span class="s">${esc(when(r.createdAt, r.horizon))}</span></span><b class="num">${esc(m$(r.p0))}</b></div>
      <div class="row"><span class="main"><span class="t">Your call</span>${r.sure || r.basis ? `<span class="s">${esc([SURE.find((x) => x[0] === r.sure)?.[1], BASIS.find((x) => x[0] === r.basis)?.[1] && `based on ${BASIS.find((x) => x[0] === r.basis)[1].toLowerCase()}`].filter(Boolean).join(" · "))}</span>` : ""}</span><b class="num">${esc(m$(r.target))}</b></div>
      <div class="row"><span class="main"><span class="t">Price at the end</span><span class="s">${esc(when(dueAt(r), r.horizon))}</span></span><b class="num">${esc(m$(r.actual))}</b></div>
    </div>
    ${wh ? `<div class="pc2-box" style="margin-top:12px"><span class="label">What happened</span><p style="margin:0">${esc(wh.text)}</p></div>` : ""}
    <p class="hint">A typical move is how far ${esc(r.t)} usually travels in ${esc(HORIZONS[r.horizon].label)}, from its last 30 days. These facts describe the past only. Not advice.</p>`, (body) => {
    drawReplay(body.querySelector("#rpChart"), r).catch(() => { const el = body.querySelector("#rpChart"); if (el) el.innerHTML = `<p class="hint">The price path couldn't load just now.</p>`; });
  });
}
// the replay chart: closes from the call to its end, the call as a dashed line, start and end dots
async function drawReplay(el, r) {
  const from = Date.parse(r.createdAt), to = Date.parse(dueAt(r)), span = to - from;
  const iv = span <= 36e5 * 2 ? 1 : span <= 864e5 * 2 ? 15 : span <= 864e5 * 60 ? 240 : 1440;
  const bars = (await krakenBars(r.t, iv)).filter((b) => { const t = Date.parse(b.t.length > 10 ? b.t + ":00Z" : b.t + "T00:00:00Z"); return t >= from - iv * 60000 && t <= to + iv * 60000; });
  if (!el.isConnected) return;
  const vals = bars.map((b) => b.c); if (vals.length < 2) { el.innerHTML = `<p class="hint">Not enough candles to draw this one.</p>`; return; }
  const W = 340, H = 120, lo = Math.min(...vals, r.target, r.p0, r.actual), hi = Math.max(...vals, r.target, r.p0, r.actual), pad = (hi - lo) * 0.1 || 1;
  const R = 84, Y = (v) => 8 + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 16), X = (i) => (i / (vals.length - 1)) * (W - R);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
  const upc = r.actual >= r.p0 ? "var(--up)" : "var(--down)";
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price from ${m$(r.p0)} to ${m$(r.actual)}; you called ${m$(r.target)}">
    <line x1="0" x2="${W - R}" y1="${Y(r.target).toFixed(1)}" y2="${Y(r.target).toFixed(1)}" stroke="var(--accent)" stroke-width="1.2" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
    <path d="${d}" fill="none" stroke="${upc}" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <circle cx="${X(0).toFixed(1)}" cy="${Y(r.p0).toFixed(1)}" r="3.5" fill="var(--text)"/><circle cx="${X(vals.length - 1).toFixed(1)}" cy="${Y(r.actual).toFixed(1)}" r="4" fill="${upc}"/>
    <text x="${W - R + 8}" y="${(Y(r.target) + 4).toFixed(1)}" font-size="10" font-weight="700" fill="var(--accent)">call ${esc(m$(r.target).replace("$", ""))}</text>
    <text x="${W - R + 8}" y="${(Y(r.actual) + (Math.abs(Y(r.actual) - Y(r.target)) < 12 ? (Y(r.actual) > Y(r.target) ? 14 : -8) : 4)).toFixed(1)}" font-size="10" font-weight="700" fill="${upc}">end ${esc(m$(r.actual).replace("$", ""))}</text>
  </svg><div class="pc2-row hint"><span>${esc(when(r.createdAt, r.horizon))}</span><span>${esc(when(dueAt(r), r.horizon))}</span></div>`;
}
export function resultRow(p, i) {
  return p.status === "scored"
    ? `<button class="row" data-res="${i}"><span class="main"><span class="t">${esc(coinName(p.coin, p.t))} · ${SHORT[p.horizon]}</span><span class="s">${esc(ago(p.resolvedAt))}${p.g ? ` · ${esc(groupName(p.g))}` : ""}${p.here ? " · confirming" : ""}</span></span><span class="chip ${LABEL_CLASS[shownLabel(p)] || ""}">${esc(shownLabel(p))}</span>${CHEV}</button>`
    : `<div class="row"><span class="main"><span class="t">${esc(coinName(p.coin, p.t))} · ${SHORT[p.horizon]}</span><span class="s" style="white-space:normal">${esc(p.voidReason || "Not counted.")}</span></span><span class="chip low">Not counted</span></div>`;
}

// ---------- links: #/g/<id> joins a group (after the username step); #/predict opens the tab
export async function openLink(hash = location.hash) {
  const m = hash.match(/^#\/g\/([a-z0-9]{20,})/);
  if (/^#\/predict/.test(hash) || m) { history.replaceState(null, "", location.pathname); showTab("play"); }
  if (!m) return;
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
// Your calls on one coin (from the feed's "Before you call"): waiting and scored, in a sheet over the feed.
export function openCoinCalls(sym) {
  const here = pendingHere().filter((r) => r.coin === sym.key), open = store.preds.filter((p) => p.coin === sym.key && !here.some((r) => r.createdAt === p.createdAt && r.horizon === p.horizon)).sort((a, b) => Date.parse(dueAt(a)) - Date.parse(dueAt(b)));
  const done = [...here, ...store.results.filter((r) => r.coin === sym.key)].sort((a, b) => Date.parse(b.resolvedAt || 0) - Date.parse(a.resolvedAt || 0));
  openSheet(`Your ${esc(sym.t)} calls`, `${open.length ? `<div class="label">Waiting</div><div class="hl">${open.map((p) => `<div class="row"><span class="main"><span class="t">${esc(p.t)} · ${SHORT[p.horizon]}</span><span class="s">Called ${num(esc(m$(p.target)))}</span></span><b class="num">${esc(Date.now() >= Date.parse(dueAt(p)) ? "scoring…" : leftText(dueAt(p), p.horizon))}</b></div>`).join("")}</div>` : ""}
    ${done.length ? `<div class="label" style="margin-top:${open.length ? 16 : 0}px">Scored</div><div class="hl">${done.map(resultRow).join("")}</div>` : `<p class="hint">None scored yet. Tap Call it on the ${esc(sym.t)} chart to make one.</p>`}`, (body) => {
    body.querySelectorAll("[data-res]").forEach((b) => (b.onclick = () => openResult(done[+b.dataset.res])));
  });
}
