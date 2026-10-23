// Other players: ranks, the leaderboard (everyone, people you follow, each group), player cards and their public
// calls, finding players, and who you follow. Data lives in social.js.
import { store, myScore, pendingHere } from "./store.js";
import { HORIZONS, isRight } from "./score.js";
import { $, esc, toast, haptic, openSheet, setSheetBody, closeSheet, ago } from "./ui.js";
import { APP } from "./app.js";
import { renderYou, openMyCard } from "./you.js";
import { mixOf, streakOf, streakBadges } from "./habit.js";
import { S, me, myName, RANK_MIN, GROUP_MAX, getCards, getCard, findPlayers, getBoard, myCard, following, isFollowing, follow, setPublic, myGroups, invite, groupTable, getFollowedBoard, getPublicCalls } from "./social.js";
import { ord, renderPlay, ava, PROVEN, levelAvatar, num, m$, LABEL_CLASS, shownLabel, openResult } from "./calls.js";

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
    <button class="row" id="rkFind" style="margin-top:10px"><span class="main"><span class="t">Find players</span><span class="s">Follow people to compare</span></span><span class="chev">›</span></button>`;
  el.querySelector("#rkFind").onclick = () => openSearch();
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
          if (!mine?.rank) note = store.data?.public !== true ? "You're not on this board: join it from You → Where you rank → Everyone." : (sc?.n || 0) < RANK_MIN ? `You're ranked once ${RANK_MIN} of your calls are scored (${sc?.n || 0} so far).` : "You'll show here at the next update (every 2 hours).";
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
      const line = (r, i) => `<button class="row lbrow${r.a === me() ? " you" : ""}" data-a="${esc(r.a)}" data-u="${esc(r.u || "")}"><span class="num lbn">${r.place ?? i + 1}</span>${ava(r.u, r, "sm")}<span class="main"><span class="t">@${esc(r.u)}${r.a === me() ? " · you" : ""}</span><span class="s">${r.pts != null ? `${esc(r.band || "No score yet")}` : `${esc(r.band || "")}${r.n ? ` · ${r.n} scored` : ""}`}</span></span><b class="num lbs">${r.pts != null ? `${r.pts}<small> pts</small>` : r.score ?? "–"}</b></button>`;
      box.innerHTML = (note ? `<p class="notice" style="margin:0 0 10px">${esc(note)}</p>` : "") + (rows.length ? `<div class="hl">${rows.map(line).join("")}</div>${meRow ? `<div class="hl lbme">${line(meRow, 0)}</div>` : ""}<p class="hint" style="margin-top:10px">${foot}</p>` : `<div class="empty">${tab === "everyone" ? `Nobody's on the public leaderboard yet. Players show here once ${RANK_MIN} of their calls are scored and they choose to join.` : "No scores here yet."}</div><p class="hint">${foot}</p>`);
      box.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => openPlayerCard(b.dataset.a, b.dataset.u)));
    };
    draw();
  });
}

// your own card, with your record worked out from this phone's results (fresher than the card the job writes)
export function myFullCard() {
  const scored = [...pendingHere(), ...store.results].filter((r) => r.status === "scored"), mix = mixOf(scored), n = mix.reduce((a, x) => a + x, 0);
  const base = { ...myCard(), ...cardFromScore() }, st = myStreak();
  return { ...base, mix, spot: mix[0], closePlus: n ? Math.round(((mix[0] + mix[1] + mix[2]) / n) * 100) : base.closePlus ?? null, streak: st.n,
    badges: [...new Set([...(base.badges || []).filter((b) => !/-day streak$/.test(b)), ...streakBadges(Math.max(st.best, base.bestStreak || 0))])] };
}
export const myStreak = () => streakOf([...store.preds, ...store.results, ...S.picks.filter((p) => !p.counts)]);
export async function openPlayerCard(a, u = "") {
  if (a === me()) { openMyCard(); return; }
  openSheet("Player", `<p class="hint">Loading…</p>`);
  let c; try { c = await getCard(a); } catch { c = null; }
  // A new player's card is made by the 2-hour data job; until then they can still be followed (17 Oct 2026: the
  // card said "not ready" and had no Follow button, so someone who just joined couldn't be followed for 2 hours).
  if (!c && !u) { setSheetBody(`<div class="empty">This player's card isn't ready yet. Cards update every 2 hours.</div>`); return; }
  c ||= { u, score: null, prov: true, n: 0, followers: 0, level: 0, fresh: true };
  const draw = () => {
    const on = isFollowing(a), common = myGroups().filter((g) => a in (g.members || {})), lvl = c.level || 0;
    const v = c.score == null || c.prov ? (c.n ? "Too early to tell" : "No calls scored yet") : c.score >= PROVEN ? "Reading it well" : "Still learning";
    setSheetBody(`<div class="pcard2">
      ${levelAvatar(c.u, lvl, "lg")}<b class="pc2-name">@${esc(c.u)}</b>
      <span class="hint">${[`Level ${lvl}`, `${c.followers || 0} follower${c.followers === 1 ? "" : "s"}`, c.rank ? `#${c.rank} of ${c.of}` : ""].filter(Boolean).join(" · ")}</span></div>
      <div class="pc2-box you-score" style="margin-top:16px"><span class="hint">${esc(v)}</span>
        <span style="display:flex;align-items:baseline;gap:10px"><b class="num you-big ${c.score >= PROVEN && !c.prov ? "good" : ""}" style="font-size:44px">${c.score ?? "–"}</b>${c.score != null && c.band ? `<span class="hint">${esc(c.band)}</span>` : ""}</span>
        <span class="hint">${c.n ? `From ${c.n} scored call${c.n === 1 ? "" : "s"}` : "Everyone starts at 550"}</span></div>
      <div class="you-tiles"><div class="pc2-box"><b class="num">${c.right != null ? `${c.right}%` : "–"}</b><span>Right direction</span></div><div class="pc2-box"><b class="num">${c.closePlus != null ? `${c.closePlus}%` : "–"}</b><span>Close or better</span></div></div>
      ${c.best || common.length ? `<p class="hint" style="margin:12px 0 0">${[c.best ? `Strongest at ${HORIZONS[c.best]?.label || c.best} calls.` : "", common.length ? `You're both in ${esc(common.map((g) => g.name).join(", "))}.` : ""].filter(Boolean).join(" ")}</p>` : ""}
      <button class="row dcard" id="pcCalls" style="margin-top:14px"><span class="main"><span class="t">Scored calls, public</span><span class="s">${on ? "The calls @" + esc(c.u) + " has made public, once scored" : "Follow to see the calls they've made public"}</span></span><span class="chev">›</span></button>
      <div class="pc-acts" style="margin-top:14px"><button class="btn ${on ? "" : "primary"}" id="pcFollow">${on ? "Following" : "Follow"}</button><button class="btn" id="pcInvite">Invite to a group</button></div>
      <p class="hint" style="text-align:center">Only calls made public show, and only once they're scored. Open calls are never shown. Never advice.</p>`);
    const sh = $("sheet");
    sh.querySelector("#pcFollow")?.addEventListener("click", async () => { try { await follow(a, !on); haptic(); if (!on) c.followers = (c.followers || 0) + 1; else c.followers = Math.max(0, (c.followers || 0) - 1); draw(); } catch (e) { toast(e.message); } });
    sh.querySelector("#pcInvite")?.addEventListener("click", () => chooseGroupToInvite(a, c.u));
    sh.querySelector("#pcCalls")?.addEventListener("click", () => openPublicCalls(a, c));
  };
  draw();
}
// A player's public scored calls (1.2.0): what happened, after it happened. Tap one for its replay.
async function openPublicCalls(a, c) {
  openSheet(`@${esc(c.u)} · scored calls`, `<p class="hint">Loading…</p>`, async (body) => {
    let list; try { list = await getPublicCalls(a); } catch { list = []; }
    if (list === null) { body.innerHTML = `<div class="empty">Follow @${esc(c.u)} to see the calls they've made public.</div>`; return; }
    if (!list.length) { body.innerHTML = `<div class="empty">@${esc(c.u)} hasn't made any scored calls public yet.</div>`; return; }
    const right = list.filter((r) => isRight({ ...r, status: "scored" })).length;
    body.innerHTML = `<p class="hint" style="margin:0 0 10px">${list.length} public of ${c.n || list.length} scored. Right direction in ${Math.round((right / list.length) * 100)}%.</p><div class="hl">${list.map((r, i) => `<button class="row" data-pc="${i}"><span class="main"><span class="t">${esc(r.t)}, ${esc(HORIZONS[r.horizon]?.label || r.horizon)}</span><span class="s">${esc(ago(r.resolvedAt))} · called ${num(esc(m$(r.target)))} from ${num(esc(m$(r.p0)))}</span></span><span class="lab ${LABEL_CLASS[shownLabel(r)] || ""}">${esc(shownLabel(r))}</span></button>`).join("")}</div>
      <p class="hint" style="margin-top:12px">What happened, after it happened. Open calls are never shown. Not advice.</p>`;
    body.querySelectorAll("[data-pc]").forEach((b) => (b.onclick = () => openResult({ ...list[+b.dataset.pc], status: "scored" })));
  });
}
export const cardFromScore = () => { const sc = myScore(); return sc ? { u: myName(), score: sc.score, band: sc.band, prov: sc.provisional, n: sc.n } : { u: myName(), score: null, n: 0, prov: true }; };
function chooseGroupToInvite(a, u) {
  const gs = myGroups().filter((g) => !(a in (g.members || {})));
  if (!myGroups().length) { toast("Start a group first, from Calls → With friends."); return; }
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
  openSheet("Find players", `<label class="uname"><span>@</span><input id="fpIn" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="21" placeholder="search a username" aria-label="Username"></label><div id="fpRes" style="margin-top:8px"></div>`, (body) => {
    const inp = body.querySelector("#fpIn"), res = body.querySelector("#fpRes");
    let seq = 0;
    const row = (c) => `<div class="row"><button class="pl-hit" data-a="${esc(c.a)}" data-u="${esc(c.u || "")}">${levelAvatar(c.u, c.level || 0, "sm")}<span class="main"><span class="t">@${esc(c.u)}</span><span class="s">${c.score != null ? `${num(c.score)}` : "New player"} · ${num((c.followers || 0).toLocaleString("en-IN"))} follower${c.followers === 1 ? "" : "s"}</span></span></button>
      <button class="btn sm ${isFollowing(c.a) ? "" : "primary"}" data-f="${esc(c.a)}">${isFollowing(c.a) ? "Following" : "Follow"}</button></div>`;
    const wire = (list) => {
      res.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => openPlayerCard(b.dataset.a, b.dataset.u)));
      res.querySelectorAll("[data-f]").forEach((b) => (b.onclick = async () => { const a = b.dataset.f, on = !isFollowing(a); try { await follow(a, on); haptic(); b.textContent = on ? "Following" : "Follow"; b.classList.toggle("primary", !on); } catch (e) { toast(e.message); } }));
    };
    const top = async () => {
      try { const b = await getFollowedBoard(), ids = (b.rows || []).filter((r) => r.a !== me()).slice(0, 10), cards = await getCards(ids.map((r) => r.a)); const list = ids.map((r, i) => ({ ...r, ...(cards[i] || {}), followers: r.followers }));
        res.innerHTML = list.length ? `<div class="label" style="margin-top:12px">Most followed</div><div class="hl">${list.map(row).join("")}</div><p class="hint" style="margin-top:12px">People you follow only see a count, never who follows them. Open calls are never shown, by anyone.</p>` : `<p class="hint">Type the start of a username.</p>`; wire(list); } catch { res.innerHTML = `<p class="hint">Type the start of a username.</p>`; }
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
export function openFollowing() {
  openSheet("Following", `<p class="hint">Only you can see who you follow. They see a follower count, never your name.</p><div id="flList"><p class="hint">Loading…</p></div>`, async (body) => {
    const box = body.querySelector("#flList"), ids = following();
    if (!ids.length) { box.innerHTML = `<div class="empty">You don't follow anyone yet.</div><button class="btn primary block" id="flFind">Find players</button>`; box.querySelector("#flFind").onclick = () => openSearch(); return; }
    const cards = await getCards(ids).catch(() => ids.map(() => null));
    box.innerHTML = `<div class="hl">${ids.map((a, i) => { const c = cards[i] || { u: "player", score: null }; return `<div class="row"><button class="pl-hit" data-a="${esc(a)}" data-u="${esc(c.u || "")}">${ava(c.u, c, "sm")}<span class="main"><span class="t">@${esc(c.u)}</span><span class="s">${c.score != null ? `${c.score} ${esc(c.band || "")}` : "No score yet"}</span></span></button><button class="btn ghost sm" data-uf="${esc(a)}">Unfollow</button></div>`; }).join("")}</div>`;
    box.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => openPlayerCard(b.dataset.a, b.dataset.u)));
    box.querySelectorAll("[data-uf]").forEach((b) => (b.onclick = async () => { await follow(b.dataset.uf, false); b.closest(".row").remove(); }));
  });
}
