// The Predict tab and everything people do together: your score as your identity, making calls, groups and their
// challenges, finding and following players, the leaderboard, player cards, and the avatar sheet (your settings).
// Data lives in store.js (your account and predictions) and social.js (people and groups).
import { CONFIG } from "../config.js";
import { store, allSyms, makePrediction, myScore, enablePush, isAdmin } from "./store.js";
import { HORIZONS, PROVISIONAL_UNDER, CHANCE, checkPrediction, canPredict, allowedRange, dailyVol, dueAt, closenessText } from "./score.js";
import { settle, rowCache, krakenRows, SETTLE_DELAY } from "./predict.js";
import { D } from "./data.js";
import { $, esc, money, pct, toast, haptic, openSheet, setSheetBody, closeSheet } from "./ui.js";
import { APP, showTab } from "./app.js";
import { resetTours, startTour } from "./coach.js";
import { setFeedbackMode } from "./feedback.js";
import { S, onSocial, me, myName, bandOf, RANK_MIN, CH_PERIODS, PICK_MINS, GROUP_MAX, getCards, getCard, findPlayers, getBoard, myCard, following, isFollowing, follow, setPublic, setPickDefault,
  myGroups, groupLink, createGroup, joinGroup, leaveGroup, removeMember, renameGroup, invite, declineInvite, challengesOf, myPick, picksOpen, waitingForMe, isSeen, markSeen,
  unseenResults, canCount, startChallenge, makePick, REACTIONS, react, groupTable } from "./social.js";

const PERIODS = Object.keys(HORIZONS);
const SHORT = { "30m": "30 min", "1h": "1 hour", "1d": "1 day", "1y": "1 year" };
const LABEL_CLASS = { "Spot on": "good", "Very close": "good", Close: "mid", Off: "low", "Far off": "bad", "Not counted": "low" };
const BAND_CLASS = { Exceptional: "b5", "Very good": "b4", Good: "b3", Fair: "b2", Building: "b1" };
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
  setInterval(() => { if (APP.tab === "play" && $("sheet").hidden && !document.hidden) rerender(); }, 30000); // countdowns
  badge();
}
const rerender = () => { const pg = $("play").parentElement, y = pg.scrollTop; renderPlay(); pg.scrollTop = y; };
// The Predict tab's badge: picks waiting for you. The Groups tab's dot: that, new results or invites.
export function badge() {
  const n = waitingForMe().length, b = document.querySelector('.tabbar [data-tab="play"] .badge');
  if (b) { b.hidden = !n; b.textContent = n; }
}
const groupsNeedYou = () => waitingForMe().length + unseenResults().length + S.invites.length > 0;

export function renderPlay() {
  const el = $("play"), view = APP.playView || "calls", u = myName(), sc = myScore(), card = myCard();
  const followers = card?.followers || 0, rank = card?.rank;
  const sub = [`@${esc(u || "you")}`, followers ? `${num(followers)} follower${followers === 1 ? "" : "s"}` : "", rank ? `#${num(rank)}` : ""].filter(Boolean).join(" · ");
  const n = sc?.n || 0, prov = !sc || sc.provisional;
  const wait = view === "groups" ? null : waitingForMe()[0];
  el.innerHTML = `<header class="pl-head">
      <button class="ava ${sc?.score != null && !prov ? BAND_CLASS[sc.band] || "" : "prov"}" id="plMe" aria-label="Your account and settings">${esc((u || "?")[0].toUpperCase())}</button>
      <button class="pl-who" id="plCard" aria-label="Your player card">
        <span class="pl-score">${sc?.score != null ? `<b class="num">${sc.score}</b><span class="${BAND_CLASS[sc.band] || ""}t">${esc(sc.band)}${prov ? " · Provisional" : ""}</span>` : `<span class="muted">No score yet</span>`}</span>
        <span class="pl-sub">${sub}</span>
      </button>
    </header>
    ${prov ? `<div class="pl-progress"><div class="pl-prog" aria-hidden="true"><i style="width:${Math.min(100, (n / PROVISIONAL_UNDER) * 100)}%"></i></div><p class="hint">${sc?.score != null ? `${n} of ${PROVISIONAL_UNDER} scored. Your score settles at ${PROVISIONAL_UNDER}, and then you can join the public leaderboard.` : `Make a call to start your score. Everyone starts at ${CHANCE}, about what guessing scores.`}</p></div>` : ""}
    ${wait ? `<button class="strip" data-pick="${esc(wait.g)}|${esc(wait.id)}"><i></i><span class="m"><b>${esc(groupName(wait.g))} needs your pick</b><span class="s">${esc(wait.t)} · ${SHORT[wait.horizon]} · closes in ${num(until(wait.joinUntil))}</span></span><span class="chev">›</span></button>` : ""}
    <div class="utabs" role="tablist" aria-label="Predict">${[["calls", "Calls"], ["groups", "Groups"], ["ranks", "Ranks"]].map(([k, l]) => `<button role="tab" data-pv="${k}" aria-selected="${view === k}">${l}${k === "groups" && groupsNeedYou() ? `<span class="dot" aria-label="needs you"></span>` : ""}</button>`).join("")}</div>
    <div class="pl-view" data-view="${view}"></div>`;
  const body = el.querySelector(".pl-view");
  ({ calls: callsView, groups: groupsView, ranks: ranksView })[view](body);
  el.querySelector("#plMe").onclick = () => openAvatarSheet();
  el.querySelector("#plCard").onclick = () => openPlayerCard(me());
  el.querySelectorAll("[data-pv]").forEach((b) => (b.onclick = () => { if (APP.playView !== b.dataset.pv) { APP.playView = b.dataset.pv; haptic(); renderPlay(); el.parentElement.scrollTop = 0; } }));
  wirePicks(el);
}
function wirePicks(root) {
  root.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const [g, c] = b.dataset.pick.split("|"), ch = challengesOf(g).find((x) => x.id === c); if (ch) openPickSheet(g, ch); }));
}

// ---------- Calls: make one, your open calls, your scored ones
const previews = new Map(); // a due prediction's result worked out on the phone, until the server confirms it
const pkey = (p) => `${p.t}_${p.horizon}_${p.createdAt}`;
const previewRows = rowCache((t, iv) => krakenRows(t, iv));
function previewDue(open) {
  const now = Date.now();
  for (const p of open) {
    const k = pkey(p);
    if (previews.has(k) || now < Date.parse(dueAt(p)) + SETTLE_DELAY) continue;
    previews.set(k, "pending");
    settle(p, { now, rows: previewRows }).then((r) => { previews.set(k, r); if (APP.tab === "play") rerender(); }).catch(() => previews.delete(k));
  }
}
function callsView(el) {
  const coins = allSyms().filter((x) => D.series[x.key]?.bars?.length);
  // open: your predictions, plus group picks that don't count to your score (those that do are predictions too)
  const open = [...store.preds.map((p) => ({ ...p, kind: "pred" })), ...S.picks.filter((p) => !p.counts && p.status !== "scored" && p.status !== "void").map((p) => ({ ...p, kind: "pick" }))]
    .sort((a, b) => Date.parse(dueAt(a)) - Date.parse(dueAt(b)));
  previewDue(store.preds);
  const done = [...store.results].sort((a, b) => Date.parse(b.resolvedAt || 0) - Date.parse(a.resolvedAt || 0));
  const callRow = (p) => {
    const due = dueAt(p), made = Date.parse(p.createdAt), share = Math.max(0, Math.min(1, (Date.now() - made) / Math.max(1, Date.parse(due) - made)));
    const r = p.kind === "pred" ? previews.get(pkey(p)) : null;
    if (r && r !== "pending" && r.status === "scored") { const x = { ...p, ...r.patch }; return `<div class="callrow"><div class="top"><span class="t">${esc(p.t)} · ${SHORT[p.horizon]}</span><span class="lab ${LABEL_CLASS[x.label]}">${esc(x.label)}</span></div><span class="hint">${num(esc(m$(p.target)))} called · it was ${num(esc(m$(x.actual)))} · confirming</span></div>`; }
    const now = lastPrice(p.coin), away = now ? Math.abs(p.target / now - 1) * 100 : null, grp = p.g ? ` · ${esc(groupName(p.g))}` : "";
    return `<div class="callrow"><div class="top"><span class="t">${esc(p.t)} · ${SHORT[p.horizon]}</span><span class="hint num">${esc(r === "pending" ? "checking…" : leftText(due, p.horizon))}</span></div>
      <span class="hint">${num(esc(m$(p.target)))} called${away != null && p.horizon !== "1y" ? ` · now ${num(away.toFixed(1) + "%")} away` : ""}${grp}${p.kind === "pick" ? " · group only" : ""}</span><div class="tbar" aria-hidden="true"><i style="width:${(share * 100).toFixed(1)}%"></i></div></div>`;
  };
  el.innerHTML = `<div class="label">Make a call</div>
    ${coins.length ? `<div class="pchips">${coins.map((x) => `<button class="pchip" data-pp="${esc(x.key)}"><b>${esc(x.t)}</b><span class="num">${esc(money(D.series[x.key].bars.at(-1).c, x.m))}</span>${open.some((p) => p.coin === x.key) ? `<em aria-label="open call"></em>` : ""}</button>`).join("")}</div>`
      : `<p class="hint">Prices are loading. Add coins from the feed's + to call them here.</p>`}
    <div class="secrow"><span class="label">Open${open.length ? ` · ${open.length}` : ""}</span></div>
    ${open.length ? `<div class="hl">${open.map(callRow).join("")}</div>` : `<p class="hint pl-empty">Nothing open. Tap a coin above, or Predict on any chart, to make a call.</p>`}
    <div class="secrow"><span class="label">Scored</span>${done.length > 3 ? `<button class="linkbtn" id="plAll">All ${done.length}</button>` : ""}</div>
    ${done.length ? `<div class="hl">${done.slice(0, 3).map(resultRow).join("")}</div>` : `<p class="hint pl-empty">Scored calls show here, with how close each one was.</p>`}`;
  el.querySelectorAll("[data-pp]").forEach((b) => (b.onclick = () => openPredictSheet(symOf(b.dataset.pp), () => renderPlay())));
  el.querySelector("#plAll")?.addEventListener("click", () => openSheet("Scored calls", `<div class="hl">${done.map(resultRow).join("")}</div>`));
}
function resultRow(p) {
  return p.status === "scored"
    ? `<div class="row"><span class="main"><span class="t">${esc(p.t)} · ${SHORT[p.horizon]}</span><span class="s">${num(esc(closenessText(p).split(" · ")[0]))} · ${num(esc(m$(p.target)))} called, it was ${num(esc(m$(p.actual)))}${p.g ? ` · ${esc(groupName(p.g))}` : ""}</span></span><span class="lab ${LABEL_CLASS[p.label] || ""}">${esc(p.label)}</span></div>`
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
  el.innerHTML = `${waits.map((ch) => `<button class="strip" data-pick="${esc(ch.g)}|${esc(ch.id)}"><i></i><span class="m"><b>${esc(groupName(ch.g))} · ${esc(ch.t)} · ${SHORT[ch.horizon]}</b><span class="s">${Object.keys(ch.picked || {}).length} of ${Object.keys(S.groups.get(ch.g)?.members || {}).length} picked · closes in ${num(until(ch.joinUntil))}</span></span><span class="btn primary sm">Pick</span></button>`).join("")}
    ${groups.length ? `<div class="label">Your groups</div><div class="hl">${groups.map((g) => { const [s, tag] = status(g), ms = Object.entries(g.members || {}).slice(0, 3);
      return `<button class="row" data-g="${esc(g.id)}"><span class="stack" aria-hidden="true">${ms.map(([a, u]) => ava(u, a === me() ? myCard() : S.cards.get(a), "xs")).join("")}</span><span class="main"><span class="t">${esc(g.name)}</span><span class="s">${s}</span></span>${tag || `<span class="chev">›</span>`}</button>`; }).join("")}</div>`
      : `<div class="pl-intro"><b>Play with friends</b><p class="hint">A group calls the same coin over the same time and sees who was closest. Prices stay hidden until it's scored.</p></div>`}
    ${S.invites.length ? `<div class="label" style="margin-top:16px">Invites</div><div class="hl">${S.invites.map((i) => `<div class="row"><span class="main"><span class="t">${esc(i.name)}</span><span class="s">from @${esc(i.from)}</span></span><button class="btn ghost sm" data-decline="${esc(i.g)}">Decline</button><button class="btn primary sm" data-join="${esc(i.g)}">Join</button></div>`).join("")}</div>` : ""}
    <button class="btn block pl-new" id="plNewG">Start a group</button>
    <p class="hint">Up to ${GROUP_MAX} players a group. Share a group's link, or invite players from their card.</p>`;
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
    : !pub ? ["Join", "You're not on it"] : n < RANK_MIN ? [`${n}/${RANK_MIN}`, `ranked after ${RANK_MIN} scored`] : ["Soon", "ranked at the next update"];
  const fl = following(), fkey = fl.join();
  if (fl.length && followRank?.key !== fkey + "|" + (sc?.score ?? "")) {
    followRank = { key: fkey + "|" + (sc?.score ?? ""), place: null, of: fl.length + 1 };
    getCards(fl).then((cs) => { const mine = sc?.score ?? -1, place = cs.filter((c) => (c?.score ?? -1) > mine).length + 1; followRank = { ...followRank, place }; if (APP.tab === "play" && APP.playView === "ranks") rerender(); }).catch(() => {});
  }
  const rows = [["everyone", "Everyone", "Public players", ...everyone],
    ["following", "People you follow", fl.length ? "Only you see this board" : "Follow players to compare", fl.length && followRank?.place ? ord(followRank.place) : "–", fl.length ? `of ${fl.length + 1}` : ""],
    ...myGroups().map((g) => { const t = groupTable(g.id), i = t.findIndex((r) => r.a === me()), played = t.some((r) => r.pts > 0);
      return [g.id, g.name, `${new Date().toLocaleString("en-IN", { month: "long" })} · ${t.length} player${t.length === 1 ? "" : "s"}`, played && i >= 0 ? ord(i + 1) : "–", played ? `${t[i]?.pts ?? 0} pts` : "no results yet"]; })];
  el.innerHTML = `<button class="fieldbtn" id="plFind"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="8" r="4"/><path d="M3 20c1.2-3.4 3.8-5 7-5s5.8 1.6 7 5M19 8v6M16 11h6"/></svg>Find players by @username</button>
    <div class="label" style="margin-top:16px">Where you rank</div>
    <div class="hl">${rows.map(([k, t, s, big, small]) => `<button class="row" data-board="${esc(k)}"><span class="main"><span class="t">${esc(t)}</span><span class="s">${esc(s)}</span></span><span class="r"><b class="${/^[#\d]/.test(big) ? "num" : ""}">${esc(big)}</b><span class="hint">${esc(small)}</span></span><span class="chev">›</span></button>`).join("")}</div>
    <p class="hint" style="margin-top:12px">Skill scores in a learning game. Not advice.</p>`;
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
      let rows = [], foot = "", meRow = null;
      const mine = myCard(), sc = myScore(), self = { a: me(), u: myName(), score: sc?.score ?? null, band: sc?.band, n: sc?.n || 0, prov: !sc || sc.provisional };
      try {
        if (tab === "everyone") {
          const b = await getBoard();
          rows = (b.rows || []).map((r) => ({ ...r, prov: false }));
          foot = `Public players with ${RANK_MIN}+ scored calls${b.at ? `, updated ${esc(new Date(b.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }))}` : ""}. Skill scores in a learning game. Not advice.`;
          if (!rows.some((r) => r.a === me())) meRow = mine?.rank ? { ...self, place: mine.rank } : null;
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
      box.innerHTML = rows.length ? `<div class="hl">${rows.map(line).join("")}</div>${meRow ? `<div class="hl lbme">${line(meRow, 0)}</div>` : ""}<p class="hint" style="margin-top:10px">${foot}</p>` : `<div class="empty">${tab === "everyone" ? "Nobody's on the public leaderboard yet." : "No scores here yet."}</div><p class="hint">${foot}</p>`;
      box.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => openPlayerCard(b.dataset.a)));
    };
    draw();
  });
}

// ---------- player card
export async function openPlayerCard(a) {
  const self = a === me();
  openSheet(self ? "Your player card" : "Player", `<p class="hint">Loading…</p>`);
  let c;
  try { c = self ? { ...myCard(), ...cardFromScore() } : await getCard(a); } catch { c = null; }
  if (!c) { setSheetBody(`<div class="empty">This player's card isn't ready yet. Cards update every 2 hours.</div>`); return; }
  const common = myGroups().filter((g) => a in (g.members || {}) && !self);
  const line = (c.line || []).filter((x) => x.s != null), lo = Math.min(...line.map((x) => x.s)), hi = Math.max(...line.map((x) => x.s));
  const path = line.length > 1 ? line.map((x, i) => `${i ? "L" : "M"}${((i / (line.length - 1)) * 354).toFixed(1)} ${(56 - ((x.s - lo) / Math.max(1, hi - lo)) * 48).toFixed(1)}`).join(" ") : "";
  const draw = () => {
    const on = isFollowing(a);
    setSheetBody(`<div class="pc-top">${ava(c.u, c, "lg")}<div><b class="pc-u">@${esc(c.u)}</b><span class="hint">${c.band ? `<span class="${BAND_CLASS[c.band] || ""}t" style="font-weight:700">${esc(c.band)}</span>` : "New player"}${c.prov && c.score != null ? " · Provisional" : ""}${c.since ? ` · since ${esc(new Date(c.since + "-01").toLocaleDateString("en-IN", { month: "short", year: "numeric" }))}` : ""}</span></div></div>
      <div class="pc-score"><div><span class="label">Prediction score</span><b class="num">${c.score ?? "–"}</b></div><div class="pc-meta"><span><b class="num">${(c.followers || 0).toLocaleString("en-IN")}</b> <span class="muted">follower${c.followers === 1 ? "" : "s"}</span></span>${c.rank ? `<span><b class="num">#${c.rank}</b> <span class="muted">· top ${Math.max(1, Math.ceil((c.rank / Math.max(1, c.of)) * 100))}%</span></span>` : ""}</div></div>
      ${self ? `<button class="btn block" id="pcEdit">Privacy and leaderboard</button>` : `<div class="pc-acts"><button class="btn ${on ? "" : "primary"}" id="pcFollow">${on ? "Following" : "Follow"}</button><button class="btn" id="pcInvite">Invite to a group</button></div>`}
      ${path ? `<div><div class="secrow" style="margin-top:0"><span class="label">Last 90 days</span><span class="hint num">${line[0].s} → ${line.at(-1).s}</span></div><svg class="pc-line" viewBox="0 0 354 60" preserveAspectRatio="none" role="img" aria-label="Score from ${line[0].s} to ${line.at(-1).s}"><path d="${path}"/></svg></div>` : ""}
      <div class="pc-stats"><span><b class="num">${c.n || 0}</b><span>scored</span></span><span><b class="num">${c.spot ?? 0}</b><span>Spot on</span></span><span><b class="num">${c.closePlus != null ? c.closePlus + "%" : "–"}</b><span>Close+</span></span><span><b>${c.best ? SHORT[c.best] : "–"}</b><span>best</span></span></div>
      ${(c.badges || []).length ? `<div><span class="label">Badges</span><p style="margin:4px 0 0">${(c.badges || []).map(esc).join(" · ")}</p></div>` : ""}
      ${common.length ? `<div><span class="label">Groups in common</span><p style="margin:4px 0 0">${common.map((g) => esc(g.name)).join(", ")}</p></div>` : ""}
      <p class="hint">Scores and results only; price calls are never shown. A learning game, not advice.</p>`);
    const sh = $("sheet");
    sh.querySelector("#pcEdit")?.addEventListener("click", () => openAvatarSheet());
    sh.querySelector("#pcFollow")?.addEventListener("click", async () => { try { await follow(a, !on); haptic(); if (!on) c.followers = (c.followers || 0) + 1; else c.followers = Math.max(0, (c.followers || 0) - 1); draw(); } catch (e) { toast(e.message); } });
    sh.querySelector("#pcInvite")?.addEventListener("click", () => chooseGroupToInvite(a, c.u));
  };
  draw();
}
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
export function openGroup(g, { fresh = false } = {}) {
  APP.openGroup = g;
  openSheet(esc(groupName(g)), "", (body) => {
    const draw = () => {
      const grp = S.groups.get(g);
      if (!grp) { body.innerHTML = `<div class="empty">Loading the group…</div>`; return; }
      const n = Object.keys(grp.members || {}).length, list = challengesOf(g), t = groupTable(g), mi = t.findIndex((r) => r.a === me());
      $("shTitle").textContent = grp.name;
      const played = t.some((r) => r.pts > 0);
      body.innerHTML = `<div class="gr-head"><span class="hint">${n} player${n === 1 ? "" : "s"}${played && mi >= 0 ? ` · you're ${ord(mi + 1)} this month` : ""}</span>
          <span><button class="iconbtn ghost" id="grInv" aria-label="Invite"><svg viewBox="0 0 24 24"><circle cx="10" cy="8" r="4"/><path d="M3 20c1.2-3.4 3.8-5 7-5s5.8 1.6 7 5M19 8v6M16 11h6"/></svg></button><button class="iconbtn ghost" id="grInfo" aria-label="Group and members"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></button></span></div>
        ${fresh || n === 1 ? `<div class="notice">Share the group's link so friends can join. ${n === 1 ? "It's just you so far." : ""} <button class="linkbtn" id="grShare">Share link</button></div>` : ""}
        ${list.length ? list.map((ch) => chCard(g, ch, n)).join("") : `<div class="pl-intro"><b>No challenges yet</b><p class="hint">Start one: pick a coin and a period, make your call, and everyone in the group gets the same end time.</p></div>`}
        ${played ? `<div class="label" style="margin-top:6px">${new Date().toLocaleString("en-IN", { month: "long" })} table</div><div class="hl">${t.map((r, i) => `<div class="row"><span class="num lbn">${i + 1}</span>${ava(r.u, r.a === me() ? myCard() : S.cards.get(r.a), "xs")}<span class="main"><span class="t">@${esc(r.u)}${r.a === me() ? " · you" : ""}</span></span><b class="num">${r.pts}<small class="muted"> pts</small></b></div>`).join("")}</div>` : ""}
        <div class="shfoot"><button class="btn primary block" id="grNew">New challenge</button></div>`;
      body.querySelector("#grNew").onclick = () => openChallengeSheet(g);
      body.querySelector("#grInv").onclick = () => openInviteSheet(g);
      body.querySelector("#grInfo").onclick = () => openGroupInfo(g);
      body.querySelector("#grShare")?.addEventListener("click", () => shareLink(g));
      body.querySelectorAll("[data-reveal]").forEach((b) => (b.onclick = () => { markSeen(b.dataset.reveal); haptic([8, 30, 8]); APP.flip = b.dataset.reveal; draw(); APP.flip = null; badge(); }));
      body.querySelectorAll("[data-rx]").forEach((b) => (b.onclick = async () => { const [c, k] = b.dataset.rx.split("|"); try { await react(g, c, k); haptic(); } catch { toast("Couldn't react just now."); } }));
      body.querySelectorAll("[data-again]").forEach((b) => (b.onclick = () => { const ch = list.find((x) => x.id === b.dataset.again); openChallengeSheet(g, { coin: ch.coin, horizon: ch.horizon }); }));
      body.querySelectorAll("[data-share]").forEach((b) => (b.onclick = () => shareResult(g, list.find((x) => x.id === b.dataset.share))));
      body.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => openPlayerCard(b.dataset.a)));
      wirePicks(body);
      const need = Object.keys(grp.members || {}).filter((a) => a !== me() && !S.cards.has(a));
      if (need.length) getCards(need).then(() => APP.openGroup === g && !$("sheet").hidden && draw()).catch(() => {});
    };
    draw();
    const off = onSocial(() => { if (APP.openGroup === g && document.getElementById("sheet").contains(body)) draw(); else off(); });
  }, () => { APP.openGroup = null; });
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
      <div class="secrow" style="margin:0"><b>${title}</b><span class="hint">${ch.end != null ? `ended ${num(esc(m$(ch.end)))}${ch.move != null ? ` <span class="${ch.move >= 0 ? "up" : "down"} num">${esc(pct(ch.move, 1))}</span>` : ""}` : ""}</span></div>
      <div class="hl">${(ch.results || []).map((r, i) => `<button class="row rrow${r.a === me() ? " you" : ""}${APP.flip === ch.id ? " rin" : ""}" style="${APP.flip === ch.id ? `animation-delay:${0.2 + i * 0.09}s` : ""}" data-a="${esc(r.a)}"><span class="num lbn">${r.rank ?? "–"}</span>${ava(r.u, r.a === me() ? myCard() : S.cards.get(r.a), "xs")}<span class="main"><span class="t">@${esc(r.u)}</span><span class="s"><span class="lab ${LABEL_CLASS[r.label] || ""}">${esc(r.label)}</span> ${r.label === "Not counted" ? "couldn't be scored" : `${num(Math.abs(r.off).toFixed(1) + "%")} off · ${r.up ? "up" : "down"}`} · ${r.counts ? "counts" : "group only"}</span></span><b class="num rpts">+${r.pts}</b></button>`).join("")}
        ${missing.length ? `<div class="row"><span class="main"><span class="s">${missing.map(([, u]) => "@" + esc(u)).join(", ")} didn't pick</span></span></div>` : ""}</div>
      ${mineIn ? `<div class="opts">${REACTIONS.map(([k, l]) => `<button class="opt" data-rx="${esc(ch.id)}|${k}" aria-pressed="${mineRx === k}">${l}${counts[k] ? ` · ${counts[k]}` : ""}</button>`).join("")}</div>
      <div class="pc-acts"><button class="btn" data-again="${esc(ch.id)}">Rematch</button><button class="btn" data-share="${esc(ch.id)}">Share result</button></div>` : ""}
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
  }, () => setTimeout(() => S.groups.has(g) && openGroup(g), 280));
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
    body.querySelector("#giRen")?.addEventListener("click", async () => { const n = prompt("Rename the group", grp.name); if (n && n.trim()) { try { await renameGroup(g, n); toast("Renamed."); openGroup(g); } catch (e) { toast(e.message); } } });
    body.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { if (confirm(`Remove @${b.dataset.u} from ${grp.name}?`)) { try { await removeMember(g, b.dataset.rm); toast(`Removed @${b.dataset.u}.`); openGroup(g); } catch { toast("Couldn't remove just now."); } } }));
    body.querySelector("#giLeave").onclick = async () => { if (!confirm(`Leave ${grp.name}?${ms.length === 1 ? " You're the last player, so the group will be deleted." : ""}`)) return; try { await leaveGroup(g); closeSheet(); toast(`You left ${grp.name}.`); if (APP.tab === "play") renderPlay(); } catch { toast("Couldn't leave just now. Try again."); } };
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
export function openPredictSheet(sym, onDone) {
  const p0 = lastPrice(sym.key), sigmaD = sigmaOf(sym.key);
  if (!p0 || sigmaD == null) { toast(`${sym.t} prices haven't loaded yet.`); return; }
  const free = PERIODS.filter((h) => canPredict(store.preds, sym.key, h));
  let horizon = free.includes("1d") ? "1d" : free[0], post = false, g = myGroups()[0]?.id || null;
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
        <p class="hint" style="text-align:center">Can't be changed or cancelled once locked. ${post && canPost ? "The group sees you called, not your price, until it's scored. " : ""}A learning game, not advice.</p>`;
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
  openSheet("Account", `<button class="row pl-me" data-av="card">${ava(u, cardFromScore(), "lg")}<span class="main"><span class="t" style="font-size:var(--t-xl)">@${esc(u || "you")}</span><span class="s">${sc?.score != null ? `${num(sc.score)} ${esc(sc.band)}` : "No score yet"}${card?.followers ? ` · ${card.followers} follower${card.followers === 1 ? "" : "s"}` : ""}</span><span class="s" style="color:var(--accent);font-weight:700">View your player card</span></span><span class="chev">›</span></button>
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
      if (k === "card") return openPlayerCard(me());
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
  APP.playView = "groups";
  try { const grp = await joinGroup(m[1]); toast(`You're in ${grp.name}.`); haptic(); openGroup(m[1]); }
  catch (e) { toast(e.message, { ms: 5000 }); }
}
// After the profile pages: back to where you came from (the avatar sheet reopens on Predict)
export function backFromProfile() {
  const to = APP.backTo || "play"; APP.backTo = null;
  showTab(to);
  if (to === "play") setTimeout(openAvatarSheet, 50);
}
