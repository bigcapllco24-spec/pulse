// Groups: the list on With friends, starting one, a group's own page (its challenges as a timeline, table and
// members), invites, and the challenge and pick sheets. Data lives in social.js.
import { CONFIG } from "../config.js";
import { store, allSyms } from "./store.js";
import { HORIZONS } from "./score.js";
import { D } from "./data.js";
import { $, esc, money, pct, toast, haptic, openSheet, closeSheet } from "./ui.js";
import { APP } from "./app.js";
import { addLayer, dropLayer, pageOpen } from "./nav.js";
import { openProfile } from "./pages.js";
import { SHORT } from "./card.js";
import { S, onSocial, me, CH_PERIODS, PICK_MINS, GROUP_MAX, GROUPS_MAX, getCards, findPlayers, myCard, myGroups, groupLink, createGroup, joinGroup, leaveGroup, removeMember, renameGroup, invite, declineInvite, challengesOf, myPick, picksOpen, waitingForMe, isSeen, markSeen, canCount, startChallenge, makePick, REACTIONS, react, groupTable } from "./social.js";
import { ord, groupName, num, until, ava, openLink, openListPage, renderFriends, rerender, badge, wirePicks, m$, LABEL_CLASS, when, renderPlay, symOf, lastPrice, sigmaOf } from "./calls.js";
import { openPlayerCard } from "./people.js";
import { priceField, countsHtml, watchPrice, lockFeel } from "./callit.js";

// ---------- Groups
export function groupsView(el) {
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
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px"><button class="btn primary" id="plNewG">Start a group</button><button class="btn" id="plJoinG">Join with a link</button></div>
    <div class="label pl-sec">Shared lists</div>
    ${[...store.lists.values()].length ? `<div class="hl">${[...store.lists.values()].map((l) => `<button class="row" data-list="${esc(l.id)}"><span class="main"><span class="t">${esc(l.name)}</span><span class="s">${(l.symbols || []).length} coins · ${esc(Object.values(l.members || {}).slice(0, 3).map((u) => "@" + u).join(", ") || "just you")}</span></span><span class="chev">›</span></button>`).join("")}</div>` : `<p class="hint pl-empty">Follow a list of coins with friends. Anyone with its link can add coins.</p>`}
    <button class="btn block" id="plNewL" style="margin-top:12px">New shared list</button>
    <p class="hint" style="margin-top:14px">Groups hold up to ${GROUP_MAX} players, and you can be in ${GROUPS_MAX}. Picks stay sealed until a challenge ends.</p>`;
  el.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => openGroup(b.dataset.g)));
  el.querySelector("#plNewG").onclick = () => openNewGroup();
  el.querySelector("#plJoinG").onclick = () => { const l = prompt("Paste the group's link"); const m = l && l.match(/#\/g\/[a-z0-9]{20,}/); if (m) openLink(m[0]); else if (l) toast("That doesn't look like a group link."); };
  el.querySelectorAll("[data-list]").forEach((b) => (b.onclick = () => openListPage(b.dataset.list)));
  el.querySelector("#plNewL").onclick = () => openProfile("lists");
  el.querySelectorAll("[data-join]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { await joinGroup(b.dataset.join); haptic(); toast("You're in."); openGroup(b.dataset.join); } catch (e) { toast(e.message, { ms: 4500 }); b.disabled = false; } }));
  el.querySelectorAll("[data-decline]").forEach((b) => (b.onclick = async () => { b.disabled = true; await declineInvite(b.dataset.decline).catch(() => {}); }));
  // member letters on the rows are coloured by their cards, fetched once
  const others = groups.flatMap((g) => Object.keys(g.members || {}).slice(0, 3)).filter((a) => a !== me() && !S.cards.has(a));
  if (others.length) getCards(others).then(() => pageOpen("sFriends") && renderFriends()).catch(() => {});
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
let grpOff = null, grpLayer = null; const opened = new Set(); // results rows unfolded on this visit
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
  grpLayer ||= addLayer(() => closeGroup());
  grpOff?.(); grpOff = onSocial(() => APP.openGroup === g && drawGroup());
  drawGroup(true);
}
// Back (the button, Escape, or the phone's back): the page slides away
export function closeGroup() {
  const el = $("grp"); if (!el || el.hidden) return;
  const l = grpLayer; grpLayer = null; dropLayer(l);
  grpOff?.(); grpOff = null; APP.openGroup = null; document.body.classList.remove("grpopen");
  el.classList.remove("on"); setTimeout(() => { if (!APP.openGroup) { el.hidden = true; el.innerHTML = ""; } }, 260);
  if (APP.tab === "play") rerender(); if (pageOpen("sFriends")) renderFriends(); badge();
}
const backFromGroup = () => closeGroup();

export function drawGroup(toBottom = false) {
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
  el.querySelectorAll(".grp-b [data-a]").forEach((x) => (x.onclick = () => openPlayerCard(x.dataset.a, x.dataset.u)));
  wirePicks(el);
  const need = Object.keys(grp.members || {}).filter((a) => a !== me() && !S.cards.has(a));
  if (need.length) getCards(need).then(() => APP.openGroup === g && drawGroup()).catch(() => {});
}
// This month's points table, from the group page's chart button.
function openGroupTable(g) {
  const t = groupTable(g), played = t.some((r) => r.pts > 0), month = new Date().toLocaleString("en-IN", { month: "long" });
  openSheet(`${esc(month)} table`, `${played ? `<div class="hl">${t.map((r, i) => `<button class="row" data-a="${esc(r.a)}" data-u="${esc(r.u || "")}"><span class="num lbn">${i + 1}</span>${ava(r.u, r.a === me() ? myCard() : S.cards.get(r.a), "xs")}<span class="main"><span class="t">@${esc(r.u)}${r.a === me() ? " · you" : ""}</span><span class="s">${r.all} pts all time</span></span><b class="num">${r.pts}<small class="muted"> pts</small></b></button>`).join("")}</div>`
    : `<div class="empty">No results this month yet. Points land when a challenge is scored.</div>`}
    <p class="hint" style="margin-top:10px">Spot on 5, Very close 3, Close 2, Off 1, plus 1 for the right direction. Starts again each month.</p>`, (body) => {
    body.querySelectorAll("[data-a]").forEach((x) => (x.onclick = () => openPlayerCard(x.dataset.a, x.dataset.u)));
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
    <div class="hl">${ms.map(([a, u]) => `<div class="row"><button class="pl-hit" data-a="${esc(a)}" data-u="${esc(u || "")}">${ava(u, a === me() ? myCard() : S.cards.get(a), "sm")}<span class="main"><span class="t">@${esc(u)}${a === me() ? " · you" : ""}</span><span class="s">${a === grp.owner ? "Started the group" : "Player"}</span></span></button>${owner && a !== me() ? `<button class="btn ghost sm danger" data-rm="${esc(a)}" data-u="${esc(u)}">Remove</button>` : ""}</div>`).join("")}</div>
    <div style="display:grid;gap:8px;margin-top:14px"><button class="btn block" id="giShare">Share the group link</button>${owner ? `<button class="btn block" id="giRen">Rename</button>` : ""}<button class="btn block danger" id="giLeave">Leave the group</button></div>
    <p class="hint">${owner ? "You started this group: you can rename it and remove players. If you leave, the next player looks after it." : `Started by @${esc(grp.ownerName)}.`}</p>`, (body) => {
    body.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => openPlayerCard(b.dataset.a, b.dataset.u)));
    body.querySelector("#giShare").onclick = () => shareLink(g);
    body.querySelector("#giRen")?.addEventListener("click", async () => { const n = prompt("Rename the group", grp.name); if (n && n.trim()) { try { await renameGroup(g, n); toast("Renamed."); closeSheet(); } catch (e) { toast(e.message); } } });
    body.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { if (confirm(`Remove @${b.dataset.u} from ${grp.name}?`)) { try { await removeMember(g, b.dataset.rm); toast(`Removed @${b.dataset.u}.`); closeSheet(); } catch { toast("Couldn't remove just now."); } } }));
    body.querySelector("#giLeave").onclick = async () => { if (!confirm(`Leave ${grp.name}?${ms.length === 1 ? " You're the last player, so the group will be deleted." : ""}`)) return; try { await leaveGroup(g); closeSheet(); if (APP.openGroup === g) backFromGroup(); toast(`You left ${grp.name}.`); if (APP.tab === "play") renderPlay(); } catch { toast("Couldn't leave just now. Try again."); } };
  });
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
