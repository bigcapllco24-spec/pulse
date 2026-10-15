// The Predict tab and everything people do together: your score as your identity, making calls, groups and their
// challenges, finding and following players, the leaderboard, player cards, and the avatar sheet (your settings).
// Data lives in store.js (your account and predictions) and social.js (people and groups).
import { CONFIG } from "../config.js";
import { store, ls, allSyms, makePrediction, myScore, enablePush, isAdmin, scoredHere, settleHere, nextDue } from "./store.js";
import { HORIZONS, PROVISIONAL_UNDER, CHANCE, checkPrediction, canPredict, allowedRange, dailyVol, dueAt, closenessText } from "./score.js";
import { settle, rowCache, krakenRows, SETTLE_DELAY } from "./predict.js";
import { D } from "./data.js";
import { $, esc, money, pct, toast, haptic, openSheet, setSheetBody, closeSheet } from "./ui.js";
import { APP, showTab } from "./app.js";
import { resetTours, startTour } from "./coach.js";
import { setFeedbackMode } from "./feedback.js";
import { cardHtml, HOW_SCORE, svgIcon, BAND_CLASS, SHORT } from "./card.js";
import { mixOf, streakOf, streakBadges, istDay, dailyCoin, msUntilNextDay, LABELS, weekRecap, tendency, whatHappened } from "./habit.js";
import { openShareSheet } from "./share.js";
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
const until = (iso) => { const m = Math.round((Date.parse(iso) - Date.now()) / 60000); return m <= 0 ? "now" : m < 60 ? `${m}m` : m < 2880 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${Math.round(m / 1440)} days`; };
const leftText = (iso, h) => (h === "1y" ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : Date.parse(iso) <= Date.now() ? "scoring" : `${until(iso)} left`);
const when = (iso, h) => new Date(iso).toLocaleString("en-IN", h === "1y" ? { day: "numeric", month: "short", year: "numeric" } : { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const lastPrice = (key) => D.series[key]?.bars?.at(-1)?.c;
const symOf = (key) => allSyms().find((s) => s.key === key) || { key, t: key.split(":")[1], n: key.split(":")[1], m: "CRYPTO", ty: "C" };
// volatility for checking a call: the 30 full days before today, as the start-price lock uses
const sigmaOf = (key) => { const b = D.series[key]?.bars || []; return dailyVol(b.slice(0, -1).map((x) => x.c)); };
const groupName = (g) => S.groups.get(g)?.name || "a group";

// ---------- the tab
export function initPlay() {
  onSocial(() => { badge(); if (APP.tab === "play") rerender(); });
  // a sideways swipe moves between Calls, Groups and Ranks (rows that scroll sideways keep their own swipe)
  const root = $("play"); let st = null;
  root.addEventListener("touchstart", (e) => { const t = e.touches[0]; st = e.touches.length > 1 || e.target.closest(".pchips, .utabs") ? null : { x: t.clientX, y: t.clientY, at: e.timeStamp }; }, { passive: true });
  root.addEventListener("touchend", (e) => {
    if (!st) return; const t = e.changedTouches[0], dx = t.clientX - st.x, dy = t.clientY - st.y, ms = e.timeStamp - st.at; st = null;
    if (ms > 600 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const order = ["calls", "groups", "ranks"], i = order.indexOf(APP.playView || "calls"), j = Math.max(0, Math.min(2, i + (dx < 0 ? 1 : -1)));
    if (j !== i) { APP.playView = order[j]; haptic(); renderPlay(); root.parentElement.scrollTop = 0; }
  }, { passive: true });
  root.addEventListener("touchcancel", () => (st = null), { passive: true });
  setInterval(() => { if (APP.tab === "play" && $("sheet").hidden && !document.hidden) { rerender(); if (APP.openGroup) drawGroup(); } }, 30000); // countdowns
  // score calls and challenges on this phone the moment they're due (the data job confirms them a few minutes later)
  store.on((w) => w === "preds" && scheduleScoring()); onSocial(scheduleScoring);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { tried = false; scheduleScoring(); } });
  scheduleScoring();
  badge();
  setTimeout(maybeDaily, 2500); // the daily popup, once a day
  document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(maybeDaily, 1500); });
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
// The Predict tab's badge: picks waiting for you. The Groups tab's dot: that, new results or invites.
export function badge() {
  const n = waitingForMe().length + S.invites.length, b = document.querySelector('.tabbar [data-tab="play"] .badge'); // picks and invites waiting for you
  if (b) { b.hidden = !n; b.textContent = n; }
}
const groupsNeedYou = () => waitingForMe().length + unseenResults().length + S.invites.length > 0;

export function renderPlay() {
  const el = $("play"), view = APP.playView || "calls", u = myName(), sc = myScore(), card = myCard();
  const followers = card?.followers || 0, rank = card?.rank;
  const sub = [`@${esc(u || "you")}`, followers ? `${num(followers)} follower${followers === 1 ? "" : "s"}` : "", rank ? `#${num(rank)}` : ""].filter(Boolean).join(" · ");
  const n = sc?.n || 0, prov = !sc || sc.provisional;
  const wait = view === "groups" ? null : waitingForMe()[0];
  // the three parts of the page, as tiles that say what's in each
  const openN = store.preds.length + S.picks.filter((p) => !p.counts && p.status !== "scored" && p.status !== "void").length, gN = myGroups().length;
  const rk = rank ? `#${num(rank)}` : store.data?.public !== true ? "Join" : n < RANK_MIN ? `${RANK_MIN - n} to go` : "Soon";
  const tiles = [
    ["calls", "Calls", openN ? `${openN} open` : "Make a call", `<path d="M3 17l5-6 4 4 4-7 5 9"/>`],
    ["groups", "Groups", gN ? `${gN} group${gN === 1 ? "" : "s"}` : "Play friends", `<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.3 3.4-5 6.5-5s5.5 1.7 6.5 5"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.6c2.7.2 4.6 1.9 5.4 4.9"/>`],
    ["ranks", "Ranks", rk, `<path d="M6 20V10M12 20V4M18 20v-7"/>`],
  ];
  const st = myStreak();
  el.innerHTML = `<div class="pl-top"><span class="label">Predict</span><span class="pl-topb"><button class="iconbtn ghost" id="plShare" aria-label="Share your card">${svgIcon("share")}</button><button class="iconbtn ghost" id="plMe" aria-label="Settings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button></span></div>
    <button class="pl-head" id="plCard" aria-label="Your profile">
      <span class="ava lg ${sc?.score != null && !prov ? BAND_CLASS[sc.band] || "" : "prov"}" aria-hidden="true">${esc((u || "?")[0].toUpperCase())}</span>
      <span class="pl-who">
        <span class="pl-score">${sc?.score != null ? `<b class="num">${sc.score}</b><span class="${BAND_CLASS[sc.band] || ""}t">${esc(sc.band)}</span>` : `<b class="num">0</b><span class="muted">No calls scored yet</span>`}</span>
        <span class="pl-sub">${sub}</span>
        ${st.n ? `<span class="pl-streak${st.today ? "" : " due"}">${svgIcon("flame")}<span>${num(st.n)}-day streak${st.today ? "" : " · call today to keep it"}</span></span>` : ""}
      </span>
      <span class="pl-go">Profile<span class="chev">›</span></span>
      ${prov ? `<span class="pl-progress"><span class="pl-prog" aria-hidden="true"><i style="width:${Math.min(100, (n / PROVISIONAL_UNDER) * 100)}%"></i></span><span class="hint">${sc?.score != null ? `${n} of ${PROVISIONAL_UNDER} calls scored. Your score settles at ${PROVISIONAL_UNDER}, then you can join the public leaderboard.` : `Make a call to start your score. The first scored call starts it at about ${CHANCE}, what guessing scores.`}</span></span>` : ""}
    </button>
    ${wait ? `<button class="strip" data-pick="${esc(wait.g)}|${esc(wait.id)}"><i></i><span class="m"><b>${esc(groupName(wait.g))} needs your pick</b><span class="s">${esc(wait.t)} · ${SHORT[wait.horizon]} · closes in ${num(until(wait.joinUntil))}</span></span><span class="chev">›</span></button>`
      : view !== "groups" && S.invites.length ? `<button class="strip" id="plInv"><i></i><span class="m"><b>@${esc(S.invites[0].from)} invited you to ${esc(S.invites[0].name)}</b><span class="s">${S.invites.length > 1 ? `${S.invites.length} invites · ` : ""}Join or decline in Groups</span></span><span class="chev">›</span></button>` : ""}
    <div class="pl-tiles" role="tablist" aria-label="Predict">${tiles.map(([k, l, s, icon]) => `<button role="tab" class="pl-tile" data-pv="${k}" aria-selected="${view === k}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><b>${l}${k === "groups" && groupsNeedYou() ? `<span class="dot" aria-label="needs you"></span>` : ""}</b><span class="${/^#?\d[\d,]*$/.test(s) ? "num" : ""}">${esc(s)}</span></button>`).join("")}</div>
    <div class="pl-view" data-view="${view}"></div>`;
  const body = el.querySelector(".pl-view");
  ({ calls: callsView, groups: groupsView, ranks: ranksView })[view](body);
  el.querySelector("#plMe").onclick = () => openAvatarSheet();
  el.querySelector("#plShare").onclick = () => openShareSheet(myFullCard());
  el.querySelector("#plCard").onclick = () => openPlayerCard(me());
  el.querySelectorAll("[data-pv]").forEach((b) => (b.onclick = () => { if (APP.playView !== b.dataset.pv) { APP.playView = b.dataset.pv; haptic(); renderPlay(); el.parentElement.scrollTop = 0; } }));
  el.querySelector("#plInv")?.addEventListener("click", () => { APP.playView = "groups"; haptic(); renderPlay(); el.parentElement.scrollTop = 0; });
  wirePicks(el);
}
function wirePicks(root) {
  root.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const [g, c] = b.dataset.pick.split("|"), ch = challengesOf(g).find((x) => x.id === c); if (ch) openPickSheet(g, ch); }));
}

// ---------- Calls: make one, your open calls, your scored ones
function callsView(el) {
  const coins = allSyms().filter((x) => D.series[x.key]?.bars?.length);
  // open: your predictions, plus group picks that don't count to your score (those that do are predictions too)
  // a call scored on this phone the moment it was due moves straight to Scored (marked "confirming" until the server's copy lands)
  const here = [...scoredHere.values()], isHere = (p) => here.some((r) => r.t === p.t && r.horizon === p.horizon && r.createdAt === p.createdAt);
  const open = [...store.preds.filter((p) => !isHere(p)).map((p) => ({ ...p, kind: "pred" })), ...S.picks.filter((p) => !p.counts && p.status !== "scored" && p.status !== "void").map((p) => ({ ...p, kind: "pick" }))]
    .sort((a, b) => Date.parse(dueAt(a)) - Date.parse(dueAt(b)));
  const done = [...here, ...store.results].sort((a, b) => Date.parse(b.resolvedAt || 0) - Date.parse(a.resolvedAt || 0));
  const callRow = (p) => {
    const due = dueAt(p), made = Date.parse(p.createdAt), share = Math.max(0, Math.min(1, (Date.now() - made) / Math.max(1, Date.parse(due) - made)));
    const now = lastPrice(p.coin), away = now ? Math.abs(p.target / now - 1) * 100 : null, grp = p.g ? ` · ${esc(groupName(p.g))}` : "";
    return `<div class="callrow"><div class="top"><span class="t">${esc(p.t)} · ${SHORT[p.horizon]}</span><span class="hint num">${esc(Date.now() >= Date.parse(due) ? "scoring…" : leftText(due, p.horizon))}</span></div>
      <span class="hint">${num(esc(m$(p.target)))} called${away != null && p.horizon !== "1y" ? ` · now ${num(away.toFixed(1) + "%")} away` : ""}${grp}${p.kind === "pick" ? " · group only" : ""}</span><div class="tbar" aria-hidden="true"><i style="width:${(share * 100).toFixed(1)}%"></i></div></div>`;
  };
  el.innerHTML = `${dailyBox(here)}
    <div class="label pl-sec">Make a call</div>
    ${coins.length ? `<div class="pchips">${coins.map((x) => `<button class="pchip" data-pp="${esc(x.key)}"><b>${esc(x.t)}</b><span class="num">${esc(money(D.series[x.key].bars.at(-1).c, x.m))}</span>${open.some((p) => p.coin === x.key) ? `<em aria-label="open call"></em>` : ""}</button>`).join("")}</div>`
      : `<p class="hint">Prices are loading. Add coins from the feed's + to call them here.</p>`}
    <div class="secrow"><span class="label">Open${open.length ? ` · ${open.length}` : ""}</span></div>
    ${open.length ? `<div class="hl">${open.map(callRow).join("")}</div>` : `<p class="hint pl-empty">Nothing open. Tap a coin above, or Predict on any chart, to make a call.</p>`}
    <div class="secrow"><span class="label">Scored</span>${done.length > 3 ? `<button class="linkbtn" id="plAll">All ${done.length}</button>` : ""}</div>
    ${done.length ? `<div class="hl pl-scored">${done.slice(0, 3).map(resultRow).join("")}</div><p class="hint" style="margin-top:6px">Tap a scored call to see what happened over its period.</p>` : `<p class="hint pl-empty">Scored calls show here, with how close each one was.</p>`}
    ${weekBox(done)}`;
  el.querySelectorAll("[data-pp]").forEach((b) => (b.onclick = () => openPredictSheet(symOf(b.dataset.pp), () => renderPlay())));
  el.querySelector("[data-dailyinfo]")?.addEventListener("click", () => openDaily());
  const wireRes = (root) => root.querySelectorAll("[data-res]").forEach((b) => (b.onclick = () => openResult(done[+b.dataset.res])));
  wireRes(el);
  el.querySelector("#plAll")?.addEventListener("click", () => openSheet("Scored calls", `<div class="hl">${done.map(resultRow).join("")}</div>`, wireRes));
}
// ---------- the daily coin: one coin a day for everyone (habit.js); yesterday's crowd shows once it's scored
function dailyState(here = [...scoredHere.values()]) {
  const now = Date.now(), day = istDay(now), dc = dailyCoin(day), all = [...store.preds, ...store.results, ...here];
  const mine = all.find((p) => p.coin === dc.key && p.horizon === "1d" && istDay(Date.parse(p.createdAt)) === day);
  const left = msUntilNextDay(now);
  return { day, dc, mine, blocked: !mine && !canPredict(store.preds, dc.key, "1d"), price: lastPrice(dc.key), left: `${Math.floor(left / 36e5)}h ${Math.floor((left % 36e5) / 6e4)}m` };
}
// a one-line banner on Calls; the explanation and yesterday's crowd live in the daily popup (tap the banner)
function dailyBox(here) {
  const { dc, mine, blocked, price, left } = dailyState(here);
  const right = mine ? `<span class="lab good">You're in</span>` : blocked ? `<span class="hint">1-day call open</span>` : `<span class="btn primary sm">Call</span>`;
  return `<button class="daily" data-dailyinfo><span class="daily-m"><span class="daily-k">Today's coin<span class="num"> · ${left} left</span></span><span class="daily-c"><b>${esc(dc.t)}</b>${price ? `<span class="num">${esc(m$(price))}</span>` : ""}</span></span>${right}</button>`;
}
// ---------- the daily popup: once a day, on the first open of the app that day (Indian time), until you've called it
const DAILY_SEEN = "pl.dailySeen";
const MIXC = ["var(--accent)", "color-mix(in srgb, var(--accent) 60%, transparent)", "color-mix(in srgb, var(--text) 62%, transparent)", "color-mix(in srgb, var(--muted) 55%, transparent)", "var(--warn)"];
export function openDaily() {
  const { day, dc, mine, blocked, price, left } = dailyState(), st = myStreak();
  const yday = istDay(Date.now() - 864e5), crowd = D.daily?.crowd?.[yday], yc = dailyCoin(yday);
  const counts = crowd ? LABELS.map((l) => crowd.labels?.[l] || 0) : null, close = counts ? counts[0] + counts[1] + counts[2] : 0;
  ls.set(DAILY_SEEN, day);
  openSheet("Today's coin", `<div class="dpop">
      <div class="dpop-main"><b>${esc(dc.n)}</b>${dc.n !== dc.t ? `<span class="muted">${esc(dc.t)}</span>` : ""}${price ? `<span class="num">${esc(m$(price))}</span>` : ""}</div>
      <p class="hint">${mine ? `You're in: ${num(esc(m$(mine.target)))}, scored ${esc(when(dueAt(mine), "1d"))}. Tomorrow you'll see how everyone did.`
        : blocked ? `You already have an open 1-day call on ${esc(dc.t)}, so today's can't be added. It still counts once it's scored.`
        : `Everyone calls the same coin today: a 1-day call that counts to your score${st.n && !st.today ? ` and keeps your ${st.n}-day streak` : ""}. Calls stay hidden until they're scored. ${left} left.`}</p>
      ${!mine && !blocked ? `<button class="btn primary block" id="dGo">Make my call on ${esc(dc.t)}</button><button class="btn block" data-close style="margin-top:8px">Not now</button>` : ""}
      ${crowd?.n ? `<div class="daily-crowd"><div class="pc2-row"><span class="label">Yesterday · ${esc(yc.n)}</span><span class="hint">${num(crowd.n)} player${crowd.n === 1 ? "" : "s"} · ${num(close)} Close or better</span></div>
        <div class="pc2-mixbar" aria-hidden="true">${counts.map((k, i) => (k ? `<i style="flex:${k};background:${MIXC[i]}"></i>` : "")).join("")}</div>
        <span class="hint">${LABELS.map((l, i) => (counts[i] ? `${counts[i]} ${esc(l)}` : "")).filter(Boolean).join(" · ")}</span></div>` : ""}
      <p class="hint" style="margin-top:12px">A learning game, not advice.</p></div>`, (body) => {
    body.querySelector("#dGo")?.addEventListener("click", () => { closeSheet(); setTimeout(() => openPredictSheet(dc, () => APP.tab === "play" && renderPlay(), "1d"), 280); });
  });
}
// shown by itself once a day: only when nothing else is on screen (no username step, tour or sheet) and not yet called
function maybeDaily() {
  if (!store.data?.username || document.hidden || $("gate") || $("coach") || !$("sheet").hidden || APP.openGroup) return;
  const s = dailyState();
  if (s.mine || s.blocked || !s.price || ls.get(DAILY_SEEN) === s.day) return;
  openDaily();
}
// ---------- your week and how your calls tend to land (habit.js): plain descriptions of your own past calls
function weekBox(done) {
  const scored = done.filter((r) => r.status === "scored"), wk = weekRecap(scored), td = tendency(scored);
  if (!wk && !td) return "";
  return `<div class="pc2-box weekbox"><span class="label">Your week</span>${wk ? `<b>${esc(wk.text)}</b>` : `<span class="hint">No calls scored in the last 7 days.</span>`}${td ? `<p class="hint">${esc(td.text)}</p>` : ""}</div>`;
}
// ---------- one scored call: how close it was, and what happened over its period (facts only)
function openResult(r) {
  if (!r || r.status !== "scored") return;
  const wh = whatHappened(r, D.news?.stories || []);
  openSheet(`${esc(r.t)} · ${SHORT[r.horizon]}`, `<div class="pc2-row" style="margin-bottom:10px"><span class="lab ${LABEL_CLASS[r.label] || ""}">${esc(r.label)}</span><span class="hint num">${esc(closenessText(r).split(" · ")[0])}</span></div>
    <div class="hl">
      <div class="row"><span class="main"><span class="t">Price when you called</span><span class="s">${esc(when(r.createdAt, r.horizon))}</span></span><b class="num">${esc(m$(r.p0))}</b></div>
      <div class="row"><span class="main"><span class="t">Your call</span></span><b class="num">${esc(m$(r.target))}</b></div>
      <div class="row"><span class="main"><span class="t">Price at the end</span><span class="s">${esc(when(dueAt(r), r.horizon))}</span></span><b class="num">${esc(m$(r.actual))}</b></div>
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
function ranksView(el) {
  const card = myCard(), sc = myScore(), pub = store.data?.public === true, n = sc?.n || 0;
  const everyone = card?.rank ? [`#${card.rank}`, `top ${Math.max(1, Math.ceil((card.rank / Math.max(1, card.of)) * 100))}%`]
    : !pub ? ["Join", "You're not on it"] : n < RANK_MIN ? [`${RANK_MIN - n} to go`, `scored calls till you're ranked`] : ["Soon", "ranked at the next update"];
  const fl = following(), fkey = fl.join();
  if (fl.length && followRank?.key !== fkey + "|" + (sc?.score ?? "")) {
    followRank = { key: fkey + "|" + (sc?.score ?? ""), place: null, of: fl.length + 1 };
    getCards(fl).then((cs) => { const mine = sc?.score ?? -1, place = cs.filter((c) => (c?.score ?? -1) > mine).length + 1; followRank = { ...followRank, place }; if (APP.tab === "play" && APP.playView === "ranks") rerender(); }).catch(() => {});
  }
  const rows = [["everyone", "Everyone", "Public players", ...everyone],
    ["following", "People you follow", fl.length ? "Only you see this board" : "Follow players to compare", fl.length && followRank?.place ? ord(followRank.place) : "–", fl.length ? `of ${fl.length + 1}` : ""],
    ...myGroups().map((g) => { const t = groupTable(g.id), i = t.findIndex((r) => r.a === me()), played = t.some((r) => r.pts > 0);
      return [g.id, g.name, `${new Date().toLocaleString("en-IN", { month: "long" })} · ${t.length} player${t.length === 1 ? "" : "s"}`, played && i >= 0 ? ord(i + 1) : "–", played ? `${t[i]?.pts ?? 0} pts` : "no results yet"]; })];
  el.innerHTML = `<button class="fieldbtn" id="plFind"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>Find players by @username</button>
    <div class="label pl-sec">Where you rank</div>
    <div class="pl-cards">${rows.map(([k, t, s, big, small]) => `<button class="rcard" data-board="${esc(k)}"><span class="main"><b>${esc(t)}</b><span class="s">${esc(s)}</span></span><span class="r"><b class="${/^[#\d]/.test(big) ? "num" : ""}">${esc(big)}</b><span class="hint">${esc(small)}</span></span></button>`).join("")}</div>
    <p class="hint" style="margin-top:14px">Skill scores in a learning game. Not advice.</p>`;
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
  const scored = [...scoredHere.values(), ...store.results].filter((r) => r.status === "scored"), mix = mixOf(scored), n = mix.reduce((a, x) => a + x, 0);
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

// The prediction sheet, from the Predict chip on a card or a coin on the Calls view. Can also start a group challenge.
export function openPredictSheet(sym, onDone, prefer = null) {
  const p0 = lastPrice(sym.key), sigmaD = sigmaOf(sym.key);
  if (!p0 || sigmaD == null) { toast(`${sym.t} prices haven't loaded yet.`); return; }
  const free = PERIODS.filter((h) => canPredict(store.preds, sym.key, h));
  let horizon = prefer && free.includes(prefer) ? prefer : free.includes("1d") ? "1d" : free[0], post = false, g = myGroups()[0]?.id || null;
  openSheet(`Predict ${esc(sym.t)}`, "", (body) => {
    const draw = (keep = "") => {
      if (!horizon) {
        body.innerHTML = `<p>You have an open prediction on every period for ${esc(sym.t)}. Each one can be made again once it has been scored.</p><button class="btn block" id="pSee">See your calls</button>`;
        body.querySelector("#pSee").onclick = () => { closeSheet(); APP.playView = "calls"; showTab("play"); };
        return;
      }
      const groups = myGroups(), canPost = groups.length && CH_PERIODS.includes(horizon);
      body.innerHTML = `<div class="utabs" role="group" aria-label="Time period">${PERIODS.map((h) => { const open = !canPredict(store.preds, sym.key, h); return `<button data-h="${h}" aria-selected="${h === horizon}" ${open ? "disabled" : ""}>${SHORT[h]}${open ? " · open" : ""}</button>`; }).join("")}</div>
        ${priceField("pIn", sym, horizon, keep)}
        <p class="hint">Scored against the price at <b>${esc(when(new Date(Date.now() + HORIZONS[horizon].days * 864e5).toISOString(), horizon))}</b>.</p>
        ${canPost ? `<div class="pl-post"><label class="pl-switchrow"><span><b>Also post to a group</b><span class="hint">Members get ${PICK_MINS[horizon] >= 60 ? `${PICK_MINS[horizon] / 60} hour${PICK_MINS[horizon] === 60 ? "" : "s"}` : `${PICK_MINS[horizon]} minutes`} to call the same end time</span></span><span class="switch"><input type="checkbox" id="pPost" ${post ? "checked" : ""}><span></span></span></label>
          ${post ? `<div class="opts">${groups.map((x) => `<button class="opt" data-pg="${esc(x.id)}" aria-pressed="${x.id === g}">${esc(x.name)}</button>`).join("")}</div>` : ""}</div>` : ""}
        <button class="btn primary block" id="pGo" disabled>${post && canPost ? "Lock in and start challenge" : "Lock in prediction"}</button>
        <p class="hint" style="text-align:center;margin-top:10px">Can't be changed or cancelled once locked. ${post && canPost ? "The group sees you called, not your price, until it's scored. " : ""}A learning game, not advice.</p>`;
      const go = body.querySelector("#pGo"), f = watchPrice(body, "pIn", sym, horizon, (ok) => (go.disabled = !ok));
      body.querySelectorAll("[data-h]").forEach((b) => (b.onclick = () => { horizon = b.dataset.h; draw(f.inp.value); }));
      body.querySelector("#pPost")?.addEventListener("change", (e) => { post = e.target.checked; draw(f.inp.value); });
      body.querySelectorAll("[data-pg]").forEach((b) => (b.onclick = () => { g = b.dataset.pg; draw(f.inp.value); }));
      go.onclick = async () => {
        go.disabled = true; const label = go.textContent; go.textContent = "Locking in…";
        try {
          if (post && canPost) await startChallenge({ g, sym, horizon, target: f.val(), p0: f.p0, sigmaD: f.sigmaD, counts: true });
          else await makePrediction({ sym, horizon, target: f.val(), p0: f.p0, sigmaD: f.sigmaD });
          lockFeel(go); go.textContent = "Locked in";
          setTimeout(() => { closeSheet(); toast(post && canPost ? `Locked in. ${groupName(g)} has a ${SHORT[horizon]} challenge on ${sym.t}.` : `Locked in: ${sym.t} at ${money(f.val(), sym.m)} in ${HORIZONS[horizon].label}.`, { ms: 4500 }); onDone?.(); }, 420);
        } catch (e) { const m = body.querySelector("#pInMsg"); m.className = "hint bad"; m.textContent = e.message || "Couldn't save. Try again."; go.disabled = false; go.textContent = label; }
      };
      setTimeout(() => f.inp.focus(), 250);
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
      ${row("tour", "Show the app tour again", "Swipes, charts and the Predict tab in a minute")}
      ${row("legal", "Legal and disclaimer", "Terms, privacy, grievance contact")}
      <span data-admin></span>
    </div>
    <p class="hint pl-ver">${esc(CONFIG.appName)} ${esc(CONFIG.version)}</p>`, (body) => {
    const go = (k) => {
      if (k === "card") { closeSheet(); return openPlayerCard(me()); }
      if (k === "following") return openFollowing();
      if (k === "push") return enablePush().then(() => toast("Notifications are on for this phone."), (e) => toast(e.message, { ms: 5000 }));
      if (k === "tour") { closeSheet(); resetTours(); showTab("feed"); setTimeout(() => startTour("feed"), 300); return; }
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
