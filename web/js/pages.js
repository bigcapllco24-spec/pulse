// Coins (watchlists and alerts), the settings pages opened from the avatar sheet, sheets (add coins, watchlists,
// switcher, chart, indicators, lines) and the username step. The Predict tab and people live in play.js.
import { CONFIG } from "../config.js";
import { store, save, chartSettings, setUsername, checkUsername, usernameChangesLeft, USERNAME_CHANGES, allSyms, watchlists, listsOf, setSymLists, newWatchlist, renameWatchlist, deleteWatchlist, moveInWatchlist, markAlertsRead, clearAlerts, addDemoAlerts, createList, joinList, leaveList, enablePush, deleteAccount, listFeedback, setFeedbackStatus, myUid } from "./store.js";
import { leaveAllGroups, deleteMySocial } from "./social.js";
import { loadSymbols, searchSymbols, symbolIndex, MKLABEL, TYLABEL } from "./search.js";
import { METRICS, OPS, ruleMet, fmt } from "./indicators.js";
import { sparkline } from "./chart.js";
import { OVERLAYS, PANELS, MAX_OVERLAYS, maxPanels, SETS, picks } from "./studies.js";
import { D, view, storiesFor, RANGE_LABEL, resolveInterval, dailyOf } from "./data.js";
import { $, esc, money, pct, arrow, fmtDay, ago, toast, haptic, openSheet, setSheetBody, closeSheet, DISCLAIMER } from "./ui.js";
import { openLearn } from "./interact.js";
import { APP, buildFeed, showTab, currentSyms, applyTheme, doRefresh } from "./app.js";
import { openAvatarSheet, backFromProfile } from "./play.js";

const symDoc = (r) => ({ key: r.key, t: r.t, n: r.n, m: r.m, ty: r.ty });

export function initPages() {
  window.addEventListener("hashchange", () => {
    const m = location.hash.match(/^#\/join\/([a-z0-9]+)/);
    if (m) { showTab("profile", "lists"); joinFlow(m[1]); }
  });
  const m = location.hash.match(/^#\/join\/([a-z0-9]+)/);
  if (m) setTimeout(() => { showTab("profile", "lists"); joinFlow(m[1]); }, 300);
}

// ---------- add-stock sheet: search, then choose watchlists
export function openAddSheet(prefill = "") {
  const curList = store.data?.settings?.list;
  openSheet("Add a coin", "", (body) => { mountSearch(body, prefill); },
    () => { const added = APP.lastAdded; buildFeed({ keepKey: added || APP.seq[APP.active]?.sym?.key }); APP.lastAdded = null;
      if (added && !D.series[added]) doRefresh(false).then(() => { if (APP.tab === "dash") renderDash(); }); }); // fetch prices for a newly added coin

  // One tap adds: a coin goes straight into the watchlist the feed is showing (or your first one), the sheet stays
  // open for the next, and closing it takes the feed to the last coin added. Tap an added coin to change its lists.
  function target() { const wl = watchlists(); return wl.find((w) => w.id === curList) || wl[0] || null; }
  async function quickAdd(r, redraw) {
    let w = target();
    if (!w) { const id = await newWatchlist("My watchlist"); w = watchlists().find((x) => x.id === id); }
    await setSymLists(symDoc(r), [...new Set([...listsOf(r.key), w.id])]);
    APP.lastAdded = r.key; haptic(); redraw();
    toast(`Added ${r.t} to ${w.name}`, { action: "Undo", onAction: async () => { await setSymLists(symDoc(r), listsOf(r.key).filter((id) => id !== w.id)); redraw(); } });
  }
  function mountSearch(body, initial = "") {
    const w = target();
    body.innerHTML = `<input class="input" id="addQ" type="search" placeholder="Search coins, like “sol” or “dogecoin”" autocomplete="off" spellcheck="false" value="${esc(initial)}" aria-label="Search coins">
      <p class="hint addto">Tap a coin to add it${w ? ` to <b>${esc(w.name)}</b>` : ""}. Tap again to change its watchlists.</p>
      <div id="addRes"></div>`;
    const q = body.querySelector("#addQ");
    let rows = [];
    const draw = () => {
      // "Added" means added to the watchlist this sheet adds to, not to any list (a coin in another list still shows + Add).
      const text = q.value.trim(), w = target(), inList = new Set((w?.syms || []).map((s) => s.key)), idx = symbolIndex() || [];
      const pop = POPULAR.map((k) => idx.find((r) => r.key === k)).filter(Boolean).sort((x, y) => inList.has(x.key) - inList.has(y.key)); // not-yet-added first
      const btn = (r, i, src) => `<button class="result ${inList.has(r.key) ? "in" : ""}" data-${src}="${i}"><span class="t">${esc(r.t)}</span><span class="n">${esc(r.n)}</span><span class="x">${inList.has(r.key) ? "✓ Added" : "+ Add"}</span></button>`;
      body.querySelector("#addRes").innerHTML = !text
        ? `${pop.length ? `<div class="label" style="margin:10px 0 6px">Most traded coins</div>${pop.map((r, i) => btn(r, i, "p")).join("")}` : ""}${starterHtml()}`
        : rows.map((r, i) => btn(r, i, "i")).join("") || `<p class="hint">No coin matches “${esc(text)}”.</p>`;
      const pick = (r) => (inList.has(r.key) ? chooseLists(r, () => mountSearch(body, q.value)) : quickAdd(r, draw));
      body.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => pick(rows[+b.dataset.i])));
      body.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => pick(pop[+b.dataset.p])));
      body.querySelectorAll("[data-starter]").forEach((b) => (b.onclick = () => addStarter(b.dataset.starter)));
    };
    let t;
    q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(async () => { await loadSymbols().catch(() => {}); rows = searchSymbols(q.value, 8); draw(); }, 60); });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter" && rows[0]) { e.preventDefault(); body.querySelector("[data-i='0']")?.click(); } });
    loadSymbols().then(() => { if (q.value) rows = searchSymbols(q.value, 8); draw(); }).catch(() => draw());
    setTimeout(() => q.focus(), 280);
  }

  function chooseLists(r, back) {
    const wl = watchlists(), cur = listsOf(r.key);
    const pre = new Set(cur.length ? cur : [curList && curList !== "all" ? curList : wl[0]?.id].filter(Boolean));
    setSheetBody(`<button class="btn ghost sm" id="bk">‹ Back to search</button>
      <div class="row" style="padding-left:0"><div class="main"><span class="t" style="font-size:20px">${esc(r.t)} <span class="badge">${esc(MKLABEL[r.m])}</span></span><span class="s">${esc(r.n)} · ${esc(TYLABEL[r.ty])}</span></div></div>
      <div class="label" style="margin:8px 0 2px">Add to watchlists</div>
      ${wl.map((w) => `<label class="check"><input type="checkbox" value="${esc(w.id)}" ${pre.has(w.id) ? "checked" : ""}><span><b>${esc(w.name)}</b> <span class="hint">${(w.syms || []).length}</span></span></label>`).join("")}
      <div class="check"><span style="font-size:22px;width:22px;text-align:center;color:var(--accent)">+</span><input class="input" id="newWl" placeholder="New watchlist, e.g. Semiconductors" maxlength="32" style="padding:9px 12px"></div>
      <button class="btn primary block" id="doAdd" style="margin-top:14px">${cur.length ? "Save" : "Add"}</button>`);
    $("bk").onclick = back;
    $("doAdd").onclick = async () => {
      const ids = [...document.querySelectorAll("#sheet .check input[type=checkbox]:checked")].map((x) => x.value);
      const nw = $("newWl").value.trim();
      if (nw) ids.push(await newWatchlist(nw));
      if (!ids.length && !cur.length) return toast("Tick a watchlist or name a new one.");
      const before = cur.slice();
      await setSymLists(symDoc(r), ids);
      APP.lastAdded = r.key;
      const names = watchlists().filter((w) => ids.includes(w.id)).map((w) => w.name);
      toast(ids.length ? `Added ${r.t} to ${names.join(", ")}` : `Removed ${r.t}`, { action: "Undo", onAction: () => setSymLists(symDoc(r), before) });
      back();
    };
  }
}

// Shown before typing: the largest, most traded coins (by market size, not a recommendation), one tap to add.
const POPULAR = ["CRYPTO:BTC", "CRYPTO:ETH", "CRYPTO:SOL", "CRYPTO:XRP", "CRYPTO:BNB", "CRYPTO:DOGE", "CRYPTO:ADA", "CRYPTO:TRX", "CRYPTO:LINK", "CRYPTO:AVAX", "CRYPTO:LTC", "CRYPTO:DOT"];
// One-tap starter watchlists, built from published groupings only (index membership, coin size). Never picks.
const STARTERS = {
  top10: { name: "Top 10 coins by market cap", keys: ["CRYPTO:BTC", "CRYPTO:ETH", "CRYPTO:BNB", "CRYPTO:XRP", "CRYPTO:SOL", "CRYPTO:TRX", "CRYPTO:ZEC", "CRYPTO:HYPE", "CRYPTO:DOGE", "CRYPTO:LINK"] },
  payments: { name: "Payment coins", keys: ["CRYPTO:BTC", "CRYPTO:XRP", "CRYPTO:LTC", "CRYPTO:BCH", "CRYPTO:XLM", "CRYPTO:DOGE"] },
  platforms: { name: "Smart-contract platforms", keys: ["CRYPTO:ETH", "CRYPTO:SOL", "CRYPTO:ADA", "CRYPTO:AVAX", "CRYPTO:DOT", "CRYPTO:NEAR"] },
};
function starterHtml() {
  return `<div class="label" style="margin:16px 0 8px">Starter watchlists</div><div class="opts">${Object.entries(STARTERS).map(([k, s]) => `<button class="opt" data-starter="${k}">${esc(s.name)}</button>`).join("")}</div>
    <p class="hint" style="margin-top:8px">Grouped by size or what the coin is for. Not recommendations.</p>`;
}
async function addStarter(k) {
  await loadSymbols();
  const s = STARTERS[k], idx = symbolIndex();
  const syms = s.keys.map((key) => idx.find((r) => r.key === key)).filter(Boolean).map(symDoc);
  const id = await newWatchlist(s.name);
  await save({ watchlists: watchlists().map((w) => (w.id === id ? { ...w, syms } : w)), settings: { ...store.data.settings, list: id } });
  toast(`Added “${s.name}” with ${syms.length} symbols.`);
  closeSheet();
  doRefresh(false);
}

// Watchlists for one symbol (from the bookmark on a card)
export function openListsFor(sym) {
  openSheet(esc(sym.t), "", (body) => {
    const cur = new Set(listsOf(sym.key));
    body.innerHTML = `<p class="hint">${esc(sym.n)}</p>${watchlists().map((w) => `<label class="check"><input type="checkbox" value="${esc(w.id)}" ${cur.has(w.id) ? "checked" : ""}><span><b>${esc(w.name)}</b></span></label>`).join("")}
      <div class="check"><span style="font-size:22px;width:22px;text-align:center;color:var(--accent)">+</span><input class="input" id="newWl2" placeholder="New watchlist" maxlength="32" style="padding:9px 12px"></div>
      <button class="btn primary block" id="saveL" style="margin-top:14px">Save</button>`;
    body.querySelector("#saveL").onclick = async () => {
      const ids = [...body.querySelectorAll("input[type=checkbox]:checked")].map((x) => x.value);
      const nw = body.querySelector("#newWl2").value.trim();
      if (nw) ids.push(await newWatchlist(nw));
      await setSymLists(sym, ids);
      closeSheet();
      toast(ids.length ? "Watchlists updated." : `${sym.t} removed from your watchlists.`);
    };
  }, () => buildFeed({ keepKey: sym.key }));
}

// Switch between "All my coins" and one watchlist
export function openSwitcher(onDone = () => buildFeed()) {
  const cur = store.data?.settings?.list || "all";
  const all = allSyms().length;
  openSheet("Show in your feed", `<p class="hint" style="margin:0 0 8px">Pick a watchlist. The feed and Your market follow it.</p>${[["all", "All my coins", all, ""], ...watchlists().map((w) => [w.id, w.name, (w.syms || []).length, ""]), ...[...store.lists.values()].map((l) => [l.id, l.name, (l.symbols || []).length, "Shared"])].map(([id, name, n, tag]) =>
    `<button class="row" data-l="${esc(id)}"><span class="main"><span class="t">${esc(name)}${tag ? ` <span class="pill">${tag}</span>` : ""}</span><span class="s">${n} coin${n === 1 ? "" : "s"}</span></span>${id === cur ? `<span style="color:var(--accent);font-weight:800">✓</span>` : ""}</button>`).join("")}
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn sm" id="nwl">New watchlist</button><button class="btn sm" id="mwl">Share a list</button></div>
    <div class="label" style="margin:18px 0 8px">Order</div><div class="opts">${[["watchlist", "Watchlist order"], ["move", "Biggest move"], ["news", "Most news"], ["rsi", "Lowest RSI"], ["az", "A to Z"]].map(([k, l]) => `<button class="opt" data-o="${k}" aria-pressed="${chartSettings().order === k}">${l}</button>`).join("")}</div>`, (body) => {
    body.querySelectorAll("[data-l]").forEach((b) => (b.onclick = async () => { await save({ settings: { ...store.data.settings, list: b.dataset.l } }); closeSheet(); }));
    body.querySelectorAll("[data-o]").forEach((b) => (b.onclick = async () => { await save({ settings: { ...store.data.settings, chart: { ...chartSettings(), order: b.dataset.o } } }); closeSheet(); }));
    body.querySelector("#nwl").onclick = async () => { const n = prompt("Name the watchlist", "Semiconductors"); if (n) { const id = await newWatchlist(n); await save({ settings: { ...store.data.settings, list: id } }); closeSheet(); openAddSheet(); } };
    body.querySelector("#mwl").onclick = () => { closeSheet(); APP.backTo = APP.tab; showTab("profile", "lists"); };
  }, onDone);
}

// ---------- Your market (1.2.0): the feed as a list. Each coin shows today's move against its usual move, any call
// waiting, and your own record on it. Picking a watchlist here also sets what the feed shows.
export function renderDash() {
  const el = $("dash");
  el.innerHTML = `<div class="dview"></div>`;
  coinsView(el.querySelector(".dview"));
}
function coinsView(el) {
  const cs = chartSettings(), syms = currentSyms(), wl = watchlists();
  const cur = store.data?.settings?.list || "all", w = wl.find((x) => x.id === cur), editing = APP.dashEdit && w;
  // each row's %, sparkline and colour all describe the same period: the one that coin's chart shows (1D = 24 hours)
  const rec = (key) => { const rs = store.results.filter((r) => r.coin === key && r.status === "scored"); return { n: rs.length, ok: rs.filter((r) => (r.target > r.p0) === (r.actual > r.p0)).length }; };
  const withData = syms.map((s) => { const v = view(s.key, dailyOf(cs)), rv = v && view(s.key, chartSettings(s.key));
    const chg = rv ? rv.windowChange : v?.daily.now.changePct, typ = v?.daily.now.atrPct, x = typ ? Math.abs(chg) / typ : null;
    return { s, v, rv, chg, x, r: rec(s.key), waiting: store.preds.filter((p) => p.coin === s.key).length }; }).filter((x) => x.v);
  const noData = syms.filter((s) => !view(s.key, dailyOf(cs)));
  const sort = APP.dashSort || "move";
  if (!editing) withData.sort((a, b) => sort === "az" ? a.s.t.localeCompare(b.s.t) : sort === "record" ? (b.r.n ? b.r.ok / b.r.n : -1) - (a.r.n ? a.r.ok / a.r.n : -1) || b.r.n - a.r.n : sort === "uncalled" ? (a.waiting + a.r.n) - (b.waiting + b.r.n) : (b.x ?? 0) - (a.x ?? 0));
  const moving = withData.filter((x) => x.x != null && x.x >= 1.5).length, all = store.results.filter((r) => r.status === "scored"), allOk = all.filter((r) => (r.target > r.p0) === (r.actual > r.p0)).length;
  const row = ({ s, v, rv, chg: c, x, r, waiting }, i) => {
    return editing ? `<div class="row"><span class="main"><span class="t">${esc(s.t)}</span><span class="s">${esc(s.n)}</span></span>
      <button class="btn ghost sm" data-up="${esc(s.key)}" ${i === 0 ? "disabled" : ""} aria-label="Move ${esc(s.t)} up">↑</button><button class="btn ghost sm" data-dn="${esc(s.key)}" ${i === withData.length - 1 ? "disabled" : ""} aria-label="Move ${esc(s.t)} down">↓</button><button class="btn ghost sm danger" data-rm="${esc(s.key)}" aria-label="Remove ${esc(s.t)}">✕</button></div>`
    : `<button class="row mrow" data-open="${esc(s.key)}"><span class="main"><span class="t">${esc(s.n)}</span><span class="s">${x != null ? `<b class="${x >= 1.5 ? "warnt" : ""}">${x.toFixed(1)}× usual</b>` : ""}${r.n ? `${x != null ? ", " : ""}you ${r.ok} of ${r.n}` : waiting ? `${x != null ? ", " : ""}call waiting` : ""}</span></span>${sparkline((rv || v).win.map((b) => b.c), 64, 24, c >= 0)}<span class="r"><b>${esc(money((rv || v).lastBar.c, s.m))}</b><span class="${c >= 0 ? "up" : "down"}">${pct(c, 1)}</span></span></button>`;
  };
  el.innerHTML = `<div class="mtop"><button class="switcher" id="dSwitch"><span>${esc(w ? w.name : "All my coins")}</span><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
      <span class="mtopb"><button class="iconbtn" id="dFeed" aria-label="Back to the chart feed"><svg viewBox="0 0 24 24"><path d="M3 17l5-6 4 3 5-7 4 4"/></svg></button><button class="iconbtn ghost" id="dAdd" aria-label="Add a coin"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></span></div>
    <h1 style="margin:18px 0 0">Your market</h1>
    <p class="hint" style="margin:6px 0 0">${withData.length ? `${moving ? `${moving} of your ${withData.length} coins ${moving === 1 ? "is" : "are"} moving more than usual today.` : `None of your ${withData.length} coins is moving more than usual today.`}${all.length ? ` You've called the direction right ${allOk} time${allOk === 1 ? "" : "s"} in ${all.length}.` : ""}` : "Prices are loading."}</p>
    ${editing ? `<p class="hint" style="margin-top:14px">Reorder or remove coins in “${esc(w.name)}”. The feed follows this order.</p>` : `<div class="opts" style="margin:16px 0 4px">${[["move", "Moving most"], ["record", "My record"], ["uncalled", "Not called yet"], ["az", "A to Z"]].map(([k, l]) => `<button class="opt" data-s="${k}" aria-pressed="${sort === k}">${l}</button>`).join("")}</div>`}
    ${withData.length ? `<div class="hl mlist">${withData.map(row).join("")}</div>` : ""}
    ${noData.length ? `<p class="hint">Waiting for prices: ${noData.map((s) => esc(s.t)).join(", ")}.</p>` : ""}
    ${!syms.length ? `<div class="empty">Nothing in this watchlist yet.</div>` : ""}
    <div style="display:flex;gap:8px;margin-top:16px">${w ? (editing ? `<button class="btn ghost sm" id="dRen">Rename</button><button class="btn ghost sm danger" id="dDel">Delete</button><button class="btn sm" id="dDone">Done</button>` : `<button class="btn ghost sm" id="dEdit">Edit this watchlist</button>`) : ""}</div>
    <p class="hint" style="margin-top:12px">Choosing a watchlist here also sets what your feed shows. Moves are facts about the past, never advice.</p>`;
  const pick = async (id) => { APP.dashEdit = false; await save({ settings: { ...store.data.settings, list: id } }); APP.needsRebuild = true; renderDash(); };
  el.querySelector("#dSwitch").onclick = () => openSwitcher(() => renderDash());
  el.querySelector("#dFeed").onclick = () => showTab("feed");
  el.querySelector("#dAdd").onclick = () => openAddSheet();
  el.querySelector("#dEdit")?.addEventListener("click", () => { APP.dashEdit = true; renderDash(); });
  el.querySelector("#dDone")?.addEventListener("click", () => { APP.dashEdit = false; APP.needsRebuild = true; renderDash(); });
  el.querySelector("#dRen")?.addEventListener("click", async () => { const n = prompt("Rename", w.name); if (n) { await renameWatchlist(w.id, n); renderDash(); } });
  el.querySelector("#dDel")?.addEventListener("click", async () => { if (confirm(`Delete “${w.name}”? Its coins stay in your other watchlists.`)) { await deleteWatchlist(w.id); await pick("all"); } });
  el.querySelectorAll("[data-up]").forEach((b) => (b.onclick = async () => { await moveInWatchlist(w.id, b.dataset.up, -1); renderDash(); }));
  el.querySelectorAll("[data-dn]").forEach((b) => (b.onclick = async () => { await moveInWatchlist(w.id, b.dataset.dn, 1); renderDash(); }));
  el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { await save({ watchlists: watchlists().map((x) => (x.id === w.id ? { ...x, syms: x.syms.filter((s) => s.key !== b.dataset.rm) } : x)) }); APP.needsRebuild = true; renderDash(); }));
  el.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { APP.dashSort = b.dataset.s; renderDash(); }));
  el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => { showTab("feed"); buildFeed({ keepKey: b.dataset.open }); }));
}
// ---------- settings pages, opened from the avatar sheet on the Predict tab (or from Coins, for alerts and rules).
// Each has a Back button to wherever it was opened from. With no page given, the avatar sheet opens instead.
const PAGES = () => ({ watchlists: pWatchlists, chart: pChart, rules: pRules, alerts: pAlerts, lists: pLists, account: pAccount, appearance: pAppearance, legal: pLegal, inbox: pInbox });
export function renderProfile(sub, arg) {
  const el = $("profile"), fn = PAGES()[sub];
  if (!fn) { el.innerHTML = ""; setTimeout(() => { showTab("play"); if (sub !== "predictions") openAvatarSheet(); }, 0); return; }
  APP.profileSub = sub;
  fn(el, `<button class="btn ghost sm" id="pBack" style="padding-left:0">‹ Back</button>`, arg);
  el.querySelector("#pBack").onclick = () => backFromProfile();
  el.parentElement.scrollTop = 0;
}
const rePage = () => renderProfile(APP.profileSub);

// Username sheet: live checks, a clear count of changes left, and a warning against real names.
export function openUsernameSheet(onDone, reason) {
  const cur = store.data?.username || "", left = usernameChangesLeft();
  if (cur && left <= 0) { toast("You've used all your username changes."); return; }
  openSheet(cur ? "Change username" : "Choose a username", `
    ${reason ? `<p>${esc(reason)}</p>` : ""}<label class="field"><span>Username</span><div class="uname"><span>@</span><input id="uIn" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="21" value="${esc(cur)}" placeholder="e.g. chartwatcher"></div></label>
    <p class="hint" id="uMsg">3–20 letters, numbers, dots or underscores.</p>
    <div class="notice">Your username is public: other players see it with your score. Don't use your real name, email or phone number.</div>
    <p class="hint">${cur ? `Changing it uses 1 of your ${left} remaining change${left === 1 ? "" : "s"}.` : `After choosing one you can change it ${USERNAME_CHANGES} more times.`}</p>
    <button class="btn primary block" id="uSave" disabled>${cur ? "Change username" : "Save username"}</button>`, (body) => {
    const inp = body.querySelector("#uIn"), msg = body.querySelector("#uMsg"), btn = body.querySelector("#uSave");
    const check = () => { const { name, error } = checkUsername(inp.value); const same = name === cur; msg.textContent = error || (same ? "That's your current username." : `@${name} looks good.`); msg.className = "hint " + (error ? "bad" : same ? "" : "good"); btn.disabled = !!error || same; };
    inp.oninput = check; check(); setTimeout(() => inp.focus(), 250);
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "Saving…";
      try { const n = await setUsername(inp.value); closeSheet(); toast(`You're @${n}.`); if (onDone) onDone(); else if (APP.tab === "profile") rePage(); }
      catch (e) { msg.textContent = e.message || "Couldn't save. Try again."; msg.className = "hint bad"; btn.disabled = false; btn.textContent = cur ? "Change username" : "Save username"; }
    };
  });
}

function pWatchlists(el, back) {
  const wl = watchlists();
  el.innerHTML = `${back}<h1>Watchlists</h1>
    ${wl.map((w) => `<div class="box"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3>${esc(w.name)}</h3><span><button class="btn ghost sm" data-ren="${esc(w.id)}">Rename</button><button class="btn ghost sm danger" data-del="${esc(w.id)}">Delete</button></span></div>
      ${(w.syms || []).length ? `<div class="list" style="margin-top:8px;background:var(--surface2)">${w.syms.map((s, i) => `<div class="row"><span class="main"><span class="t">${esc(s.t)}</span><span class="s">${esc(s.n)}</span></span>
        <button class="btn ghost sm" data-up="${esc(w.id)}|${esc(s.key)}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button><button class="btn ghost sm" data-dn="${esc(w.id)}|${esc(s.key)}" ${i === w.syms.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button><button class="btn ghost sm" data-rm="${esc(w.id)}|${esc(s.key)}" aria-label="Remove">✕</button></div>`).join("")}</div>` : `<p class="hint">Empty.</p>`}</div>`).join("")}
    <button class="btn primary block" id="wAdd">Add coins</button><button class="btn block" id="wNew" style="margin-top:8px">New watchlist</button>`;
  const re = () => pWatchlists(el, back) || (el.querySelector("#pBack").onclick = () => backFromProfile());
  el.querySelector("#wAdd").onclick = () => openAddSheet();
  el.querySelector("#wNew").onclick = async () => { const n = prompt("Name the watchlist", "Semiconductors"); if (n) { await newWatchlist(n); re(); } };
  el.querySelectorAll("[data-ren]").forEach((b) => (b.onclick = async () => { const w = wl.find((x) => x.id === b.dataset.ren); const n = prompt("Rename", w.name); if (n) { await renameWatchlist(w.id, n); re(); } }));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (confirm("Delete this watchlist? Its symbols stay in your other watchlists.")) { await deleteWatchlist(b.dataset.del); if (store.data.settings.list === b.dataset.del) await save({ settings: { ...store.data.settings, list: "all" } }); re(); } }));
  const pair = (b, k) => b.dataset[k].split("|");
  el.querySelectorAll("[data-up]").forEach((b) => (b.onclick = async () => { const [w, k] = pair(b, "up"); await moveInWatchlist(w, k, -1); re(); }));
  el.querySelectorAll("[data-dn]").forEach((b) => (b.onclick = async () => { const [w, k] = pair(b, "dn"); await moveInWatchlist(w, k, 1); re(); }));
  el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { const [w, k] = pair(b, "rm"); await save({ watchlists: watchlists().map((x) => (x.id === w ? { ...x, syms: x.syms.filter((s) => s.key !== k) } : x)) }); re(); }));
}

// Chart options, shared by Settings → Chart style (everyone's default) and the chip on each feed card.
const RANGE_OPTS = [["1D", "1D"], ["1W", "1W"], ["1M", "1M"], ["3M", "3M"], ["6M", "6M"], ["1Y", "1Y"], ["2Y", "2Y"]];
const CANDLE_OPTS = [["auto", "Auto"], ["1D", "Daily"], ["1W", "Weekly"]];
const TYPE_OPTS = [["candles", "Candles"], ["line", "Line"], ["area", "Area"]];
const LEVEL_OPTS = [["off", "Off"], ["sr", "Support & resistance"], ["pivots", "Pivot points"]];
const LINES_HINT = "Support & resistance: prices where the chart turned at least twice. Pivot points: levels worked out from the previous day, month or year. Both describe the past, not the future.";
function chartOptsHtml(c, { lines = true } = {}) {
  const opt = (key, vals) => `<div class="opts">${vals.map(([v, l]) => `<button class="opt" data-k="${key}" data-v="${v}" aria-pressed="${String(c[key]) === String(v)}">${l}</button>`).join("")}</div>`;
  const iv = resolveInterval(c);
  const each = { "15m": "15 minutes", "1h": "one hour", "1D": "one day", "1W": "one week" }[iv];
  const intra = iv === "15m" || iv === "1h";
  return `<h2>Time range</h2>${opt("range", RANGE_OPTS)}<p class="hint">${esc(RANGE_LABEL[c.range] || "")} of candles. Each candle is ${each}.</p>
    ${intra ? "" : `<h2>Candle size</h2>${opt("interval", CANDLE_OPTS)}<p class="hint">Auto uses daily candles up to 6 months and weekly candles for 1 and 2 years, so the chart never gets crowded.</p>`}
    <h2>Chart type</h2>${opt("type", TYPE_OPTS)}
    <p class="hint" style="margin-top:14px">Indicators such as RSI, MACD and Bollinger Bands: tap <b>ƒx</b> on any card.</p>
    ${lines ? `<h2>Lines on the chart</h2>${opt("levels", LEVEL_OPTS)}<p class="hint">${LINES_HINT} Applies to every coin; the S/R button on a card changes it too.</p>` : `<p class="hint">Lines on the chart (support & resistance, pivots): tap <b>S/R</b> on any card.</p>`}`;
}
function pChart(el, back) {
  const c = chartSettings(), custom = Object.keys(store.data.settings?.chartBy || {});
  el.innerHTML = `${back}<h1>Chart style</h1><p class="hint">Your default for every coin. To change one coin, tap the time chip on its card in the feed.</p>
    ${chartOptsHtml(c)}
    ${custom.length ? `<h2>Coins with their own chart</h2><p>${custom.map((k) => `<span class="pill">${esc(k.split(":")[1])}</span>`).join(" ")} <button class="btn ghost sm" id="cReset">Reset all to default</button></p>` : ""}`;
  const re = () => { pChart(el, back); el.querySelector("#pBack").onclick = () => backFromProfile(); };
  const set = async ({ _pick, ...patch }) => { await save({ settings: { ...store.data.settings, ...(_pick ? { levelsPick: patch.levels } : {}), chart: { ...store.data.settings.chart, ...patch } } }); APP.needsRebuild = true; re(); };
  el.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => (b.dataset.k === "levels" ? setLines(b.dataset.v).then(re) : set({ [b.dataset.k]: b.dataset.v }))));
  el.querySelector("#cReset")?.addEventListener("click", async () => { await save({ settings: { ...store.data.settings, chartBy: {} } }); APP.needsRebuild = true; re(); });
}

// The time chip on a feed card: change this coin's chart, or every coin in the list the feed is showing.
export function openChartSheet(sym, onChange) {
  const list = store.data?.settings?.list || "all", w = watchlists().find((x) => x.id === list);
  let scope = store.data?.settings?.chartBy?.[sym.key] ? "coin" : "all";
  const draw = (body) => {
    const own = !!store.data?.settings?.chartBy?.[sym.key];
    body.innerHTML = `<div class="seg scope" role="group" aria-label="Apply to">${[["coin", `Just ${sym.t}`], ["all", w ? `All in ${w.name}` : "All my coins"]].map(([k, l]) => `<button data-scope="${k}" aria-pressed="${scope === k}">${esc(l)}</button>`).join("")}</div>
      ${chartOptsHtml(chartSettings(sym.key), { lines: false })}
      ${own ? `<p style="margin-top:14px"><button class="btn ghost sm" id="csReset">Use my default chart for ${esc(sym.t)}</button></p>` : ""}`;
    body.querySelectorAll("[data-scope]").forEach((b) => (b.onclick = () => { scope = b.dataset.scope; draw(body); }));
    body.querySelectorAll("[data-k]").forEach((b) => (b.onclick = async () => {
      if (b.dataset.k === "levels" && b.dataset.v !== "off") await save({ settings: { ...store.data.settings, levelsPick: b.dataset.v } });
      await applyChart(sym, scope, w, { [b.dataset.k]: b.dataset.v }); draw(body); onChange?.();
    }));
    body.querySelector("#csReset")?.addEventListener("click", async () => { const by = { ...(store.data.settings.chartBy || {}) }; delete by[sym.key]; await save({ settings: { ...store.data.settings, chartBy: by } }); scope = "all"; draw(body); onChange?.(); });
  };
  openSheet(`Chart · ${esc(sym.t)}`, "", draw, () => buildFeed({ keepKey: sym.key }));
}
async function applyChart(sym, scope, w, patch) {
  const st = store.data.settings, by = { ...(st.chartBy || {}) };
  if (scope === "coin") by[sym.key] = { ...(by[sym.key] || {}), ...patch };
  else if (w) for (const x of w.syms || []) by[x.key] = { ...(by[x.key] || {}), ...patch };
  else { // all my coins: becomes the default, and no coin keeps an older value for these settings
    for (const k of Object.keys(by)) { const o = { ...by[k] }; for (const p of Object.keys(patch)) delete o[p]; if (Object.keys(o).length) by[k] = o; else delete by[k]; }
    await save({ settings: { ...st, chart: { ...(st.chart || {}), ...patch }, chartBy: by } });
    return;
  }
  await save({ settings: { ...st, chartBy: by } });
}

// Every guide uses the one template in interact.js, so all explanations read the same way.
export const openIndicator = (id) => openLearn(id);

const RULE_METRICS = ["price", "changePct", "rsi14", "stochRsi", "mfi14", "cmo14", "uo", "cmf20", "aroonOsc", "hv20", "distSma20Pct", "distSma50Pct", "macdHist", "pctB", "distHigh50Pct", "volRatio", "atrPct", "stochK", "willR", "cci20", "adx14", "roc12"];
function pRules(el, back, preKey) {
  const coins = allSyms().filter((s) => s.m === "CRYPTO"), rules = store.data.rules || [];
  const label = (r) => `${r.sym === "*" ? "Any coin" : esc(r.sym.split(":")[1])}: ${esc(METRICS[r.metric]?.label || r.metric)} ${esc(OPS[r.op])} ${esc(r.value)}${esc(METRICS[r.metric]?.unit || "")}`;
  el.innerHTML = `${back}<h1>Rules</h1><p class="hint">Get an alert when one of your own levels is hit. Rules run after every data refresh.</p>
    ${coins.length ? `<form class="box" id="rForm"><div class="field"><label for="rSym">Applies to</label><select id="rSym"><option value="*">Any coin I follow</option>${coins.map((s) => `<option value="${esc(s.key)}" ${s.key === preKey ? "selected" : ""}>${esc(s.t)}</option>`).join("")}</select></div>
      <div class="field"><label for="rMetric">Reading</label><select id="rMetric">${RULE_METRICS.map((m) => `<option value="${m}">${esc(METRICS[m].label)}</option>`).join("")}</select></div>
      <div style="display:flex;gap:8px"><div class="field" style="flex:1"><label for="rOp">Condition</label><select id="rOp">${Object.entries(OPS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
      <div class="field" style="width:110px"><label for="rVal">Value</label><input id="rVal" inputmode="decimal" required></div></div>
      <div class="field"><label for="rNote">Note (optional)</label><input id="rNote" maxlength="80"></div><button class="btn primary block">Add rule</button></form>` : `<div class="empty">Add a coin to a watchlist to set rules.</div>`}
    <h2>Your rules</h2>${rules.length ? `<div class="list">${rules.map((r) => `<div class="row"><span class="main"><span class="t">${label(r)}</span><span class="s">${esc(r.note || "")}${r.lastFired ? ` · last met ${esc(fmtDay(r.lastFired))}` : ""}</span></span>
      <label class="switch"><input type="checkbox" data-on="${esc(r.id)}" ${r.active !== false ? "checked" : ""} aria-label="Rule on"><span></span></label><button class="btn ghost sm" data-del="${esc(r.id)}" aria-label="Delete">✕</button></div>`).join("")}</div>` : `<div class="empty">No rules yet.</div>`}`;
  const re = () => { pRules(el, back); el.querySelector("#pBack").onclick = () => backFromProfile(); };
  el.querySelector("#rForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = parseFloat(el.querySelector("#rVal").value);
    if (!isFinite(value)) return toast("Enter a number.");
    await save({ rules: [...rules, { id: Math.random().toString(36).slice(2, 10), sym: el.querySelector("#rSym").value, metric: el.querySelector("#rMetric").value, op: el.querySelector("#rOp").value, value, note: el.querySelector("#rNote").value.trim(), active: true, createdAt: new Date().toISOString() }] });
    if (store.mode === "demo") demoRules();
    toast("Rule added. It's checked after every refresh."); re();
  });
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { await save({ rules: rules.filter((r) => r.id !== b.dataset.del) }); re(); }));
  el.querySelectorAll("[data-on]").forEach((c) => (c.onchange = () => save({ rules: rules.map((r) => (r.id === c.dataset.on ? { ...r, active: c.checked } : r)) })));
}
// Demo mode checks rules on the phone; the live app checks them in the data job and sends push alerts.
export function demoRules() {
  const fresh = [], have = new Set(store.alerts.map((a) => a.id)), cs = chartSettings();
  for (const r of store.data?.rules || []) {
    if (r.active === false) continue;
    const keys = r.sym === "*" ? allSyms().filter((s) => s.m === "CRYPTO").map((s) => s.key) : [r.sym];
    for (const k of keys) {
      const v = view(k, { ...dailyOf(cs), interval: "1D" }); if (!v || !ruleMet(r, v.now, v.prev)) continue;
      const id = `${r.id}-${k}-${v.lastBar.t}`.replace(/[^\w-]/g, "_"); if (have.has(id)) continue;
      const m = METRICS[r.metric];
      fresh.push({ id, at: new Date().toISOString(), sym: k, read: false, text: `${k.split(":")[1]}: ${m.label} ${OPS[r.op]} ${r.value}${m.unit || ""} (now ${fmt(v.now[r.metric], m.digits)}${m.unit || ""}).${r.note ? " " + r.note : ""}` });
    }
  }
  if (fresh.length) addDemoAlerts(fresh);
}

function pAlerts(el, back) {
  const a = store.alerts;
  el.innerHTML = `${back}<h1>Alerts</h1><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><button class="btn sm" id="aPush">Turn on push alerts</button>${a.some((x) => !x.read) ? `<button class="btn sm" id="aRead">Mark all read</button>` : ""}${a.length ? `<button class="btn ghost sm" id="aClear">Clear</button>` : ""}</div>
    ${a.length ? `<div class="list">${a.map((x) => `<div class="row"><span class="main"><span class="t" style="${x.read ? "font-weight:500" : ""}">${esc(x.text)}</span><span class="s">${esc(ago(x.at))}</span></span>${x.read ? "" : `<span class="pill confirmed">New</span>`}</div>`).join("")}</div>` : `<div class="empty">No alerts yet. Set a rule to get one.</div>`}
    <p class="disclaimer">Alerts state facts about your own levels. They are not signals or advice.</p>`;
  const re = () => { pAlerts(el, back); el.querySelector("#pBack").onclick = () => backFromProfile(); };
  el.querySelector("#aRead")?.addEventListener("click", async () => { await markAlertsRead(a.filter((x) => !x.read).map((x) => x.id)); re(); });
  el.querySelector("#aClear")?.addEventListener("click", async () => { await clearAlerts(); re(); });
  el.querySelector("#aPush").onclick = async () => { try { await enablePush(); toast("Push alerts are on for this phone."); } catch (e) { toast(e.message, { ms: 5000 }); } };
}

function pLists(el, back) {
  const lists = [...store.lists.values()];
  const link = (id) => location.origin + location.pathname + "#/join/" + id;
  el.innerHTML = `${back}<h1>Shared lists</h1><p class="hint">Anyone with a list's link can see and edit it. Members show by a nickname; we never ask for names.</p>
    <form class="box" id="lForm"><div class="field"><label for="lName">New shared list</label><input id="lName" maxlength="40" required placeholder="e.g. Weekend watchlist"></div><p class="hint">Members see each other by username${store.data?.username ? `: you're @${esc(store.data.username)}` : ". You'll pick one when you create or join a list"}.</p><button class="btn primary block">Create</button></form>
    ${lists.map((l) => `<div class="box"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><h3>${esc(l.name)}</h3><span><button class="btn sm" data-copy="${esc(l.id)}">Invite link</button> <button class="btn ghost sm" data-leave="${esc(l.id)}">Leave</button></span></div>
      <p class="hint">Members: ${esc(Object.values(l.members || {}).join(", ") || "just you")}</p><p>${(l.symbols || []).map((s) => esc(s.t)).join(", ") || `<span class="hint">Empty</span>`}</p>
      ${(l.symbols || []).length ? `<button class="btn primary sm" data-scroll="${esc(l.id)}">Scroll these in the feed</button> <button class="btn sm" data-copyto="${esc(l.id)}">Copy into a watchlist</button>` : ""}</div>`).join("")}`;
  el.querySelectorAll("[data-scroll]").forEach((b) => (b.onclick = async () => { await save({ settings: { ...store.data.settings, list: b.dataset.scroll } }); APP.needsRebuild = true; showTab("feed"); }));
  const re = () => { pLists(el, back); el.querySelector("#pBack").onclick = () => backFromProfile(); };
  el.querySelector("#lForm").onsubmit = (e) => {
    e.preventDefault();
    const name = el.querySelector("#lName").value.trim();
    withUsername(async () => { try { await createList(name, store.data.username); re(); } catch (err) { toast(err.message); } });
  };
  el.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(link(b.dataset.copy)); toast("Invite link copied."); } catch { prompt("Copy this link", link(b.dataset.copy)); } }));
  el.querySelectorAll("[data-leave]").forEach((b) => (b.onclick = async () => { if (confirm("Leave this list?")) { await leaveList(b.dataset.leave); re(); } }));
  el.querySelectorAll("[data-copyto]").forEach((b) => (b.onclick = async () => { const l = store.lists.get(b.dataset.copyto); const id = await newWatchlist(l.name); await save({ watchlists: watchlists().map((w) => (w.id === id ? { ...w, syms: l.symbols } : w)) }); toast(`Copied into “${l.name}”.`); }));
}
async function joinFlow(id) {
  history.replaceState(null, "", location.pathname);
  withUsername(async () => {
    try { await joinList(id, store.data.username); toast("Joined. Find it in Account → Shared lists."); renderProfile("lists"); } catch (e) { toast(e.message, { ms: 5000 }); }
  });
}
// Every account starts by choosing its username: a full-screen first step that can't be skipped. It's the name
// on the prediction game and in shared lists; it can be changed twice later. Closes by itself if the account
// turns out to have one already (for example once the server copy loads).
function withUsername(fn) {
  if (store.data?.username) return fn();
  openUsernameSheet(fn, "Shared lists show members by username, so pick one first.");
}

function pAccount(el, back) {
  const n = store.data?.username;
  el.innerHTML = `${back}<h1>Account</h1>
    <p>Your account has no name, email or phone number. It belongs to this app on this phone${store.mode === "demo" ? " (demo mode)" : ""}.</p>
    <p class="hint">Uninstalling the app or clearing the browser's site data starts a fresh account. Moving to another phone will come later.</p>
    <h2>Username</h2><p class="dline">${n ? `@${esc(n)} · ${usernameChangesLeft()} change${usernameChangesLeft() === 1 ? "" : "s"} left` : "Not set yet."} <button class="btn ghost sm" id="aName">${n ? "Change" : "Add"}</button></p>
    <h2>Delete</h2><button class="btn danger" id="del">Delete my account and all its data</button>
    <h2>Sign-in id</h2><p class="dline"><code class="uid">${esc(myUid() || "connecting…")}</code> <button class="btn ghost sm" id="aUid">Copy</button></p><p class="hint">Only needed if you help run the app: an admin adds this id to give access to the feedback inbox.</p>
    <h2>App version</h2><p class="dline">${esc(CONFIG.appName)} ${esc(CONFIG.version)}</p>`;
  el.querySelector("#aUid").onclick = () => navigator.clipboard?.writeText(myUid() || "").then(() => toast("Copied."), () => toast("Couldn't copy."));
  el.querySelector("#aName").onclick = () => openUsernameSheet(() => pAccount(el, back) || (el.querySelector("#pBack").onclick = () => backFromProfile()));
  el.querySelector("#del").onclick = async () => { if (confirm("Delete your account, watchlists, rules, alerts, predictions and groups? This can't be undone.")) await deleteAccount(leaveAllGroups, deleteMySocial); };
}
function pAppearance(el, back) {
  const t = store.data.settings?.theme || "dark";
  el.innerHTML = `${back}<h1>Appearance</h1><div class="opts">${[["dark", "Dark"], ["light", "Light"], ["auto", "Match phone"]].map(([k, l]) => `<button class="opt" data-t="${k}" aria-pressed="${t === k}">${l}</button>`).join("")}</div>`;
  el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = async () => { await save({ settings: { ...store.data.settings, theme: b.dataset.t } }); applyTheme(); pAppearance(el, back); el.querySelector("#pBack").onclick = () => backFromProfile(); }));
}
function pLegal(el, back) {
  el.innerHTML = `${back}<h1>Legal and disclaimer</h1>
    <h2>Not investment advice</h2><p>${esc(DISCLAIMER)} Check facts and consult a registered adviser before investing.</p>
    <h2>Prediction game</h2><p>Predicting a coin's price is a game for learning how markets move. There is no money, no prizes and nothing to buy. Your price calls are private and the app never publishes them. In a group you choose to play in, members see that you made a call and, once it is scored, how close it was and which way you called, never your price. Other players can see your username, score, band and follower count, and your rank if you join the public leaderboard. A prediction, a score or a rank is not advice and says nothing about where prices will go.</p>
    <h2>Fact tags and sorting</h2><p>Tags such as “Volume 2.1x usual” or “New 50-day high” state facts about the latest data. Sorting by move, news or RSI orders your own list by that fact. Neither is a signal or a ranking of investments.</p>
    <h2>Privacy</h2><p>We don't ask for or store your name, email, phone number, location or contacts, and use no tracking or advertising cookies. We keep a random account ID for this app on this phone, the username you chose, your watchlists, chart style, rules and indicator choices, list nicknames, the players you follow (seen only by you), the groups you're in and, if you turn on alerts, a push token. You can delete everything from Account.</p>
    <h2>App version</h2><p>${esc(CONFIG.appName)} ${esc(CONFIG.version)}</p>
    <h2>Data sources</h2><p>Coin prices from Kraken's public data, checked against CoinGecko. News found via the GDELT Project and linked to each publisher.</p>
    <h2>Age</h2><p>For people aged 18 and over.</p>
    <h2>Grievance contact</h2><p>${esc(CONFIG.companyName)} · <a href="mailto:${esc(CONFIG.grievanceEmail)}">${esc(CONFIG.grievanceEmail)}</a>. Complaints acknowledged within 24 hours, resolved within 15 days.</p>
    <p class="hint">Summary only. Full terms and privacy notice to be reviewed by a lawyer before public launch.</p>`;
}

// ---------- indicators: add or remove from the feed card's ƒx button. One shared choice for every coin.
// The ƒx sheet, built to scan fast: what's on now (tap ✕ to remove), one row of quick sets, then one list at a
// time (lines on the price chart, or panels below it) as compact rows grouped by what they measure.
let fxTab = "lower";
export function openIndicatorsSheet(onChange) {
  const pk = picks(store.data?.settings?.chart);
  let swap = null; // full up: the indicator waiting to replace one already on
  const persist = () => {
    const ch = store.data?.settings?.chart || {};
    save({ settings: { ...store.data.settings, chart: { ...ch, over: [...pk.over], lower: pk.lower.join(",") || "none", mas: [] } } }).catch(() => {});
    APP.needsRebuild = true; onChange?.();
  };
  const reg = () => (fxTab === "over" ? OVERLAYS : PANELS), mine = () => (fxTab === "over" ? pk.over : pk.lower);
  const cap = () => (fxTab === "over" ? MAX_OVERLAYS : maxPanels());
  const nameOf = (c) => (OVERLAYS[c] || PANELS[c]).name.replace(/ \(.*\)$/, "");
  const chips = () => [...pk.over, ...pk.lower].map((c) => `<span class="fxon">${esc(nameOf(c))}<button data-stog="${c}" aria-label="Remove ${esc(nameOf(c))}">✕</button></span>`).join("") || `<span class="hint">Nothing yet: just the price.</span>`;
  const list = () => {
    const groups = {};
    for (const [code, x] of Object.entries(reg())) (groups[x.group] ||= []).push([code, x]);
    return Object.entries(groups).map(([g, items]) => `<div class="fxgrp"><div class="sgroup">${esc(g)}</div>${items.map(([code, x]) => {
      const on = mine().includes(code);
      return `<div class="fxrow${on ? " on" : ""}"><button class="fxname" data-sguide="${code}"><b>${esc(x.name)}</b><span>${esc(x.short)}</span></button>
        <button class="fxtog" data-stog="${code}" aria-pressed="${on}" aria-label="${on ? "Remove" : "Add"} ${esc(x.name)}">${on ? "✓" : "+"}</button></div>`;
    }).join("")}</div>`).join("");
  };
  const swapBox = () => {
    if (!swap) return "";
    const isOver = !!OVERLAYS[swap], l = isOver ? pk.over : pk.lower, max = isOver ? MAX_OVERLAYS : maxPanels();
    return `<div class="fxswap" role="alert"><b>${isOver ? `Up to ${max} on the price chart` : `Your screen fits ${max} panels`}. Swap one for ${esc(nameOf(swap))}?</b>
      <div class="fxchips">${l.map((c) => `<button class="opt" data-swap="${c}">${esc(nameOf(c))}</button>`).join("")}<button class="opt" data-swap="">Cancel</button></div></div>`;
  };
  const body = () => `${swapBox()}<div class="fxnow"><div class="cap">On your charts · ${pk.over.length + pk.lower.length}</div><div class="fxchips">${chips()}</div></div>
    <div class="fxsets">${SETS.map((x) => `<button class="opt" data-sset="${x.id}" aria-pressed="${x.over.join() === pk.over.join() && x.lower.slice(0, maxPanels()).join() === pk.lower.join()}">${esc(x.name)}</button>`).join("")}<button class="opt" data-sset="none">Clear</button></div>
    <div class="seg fxseg" role="tablist">${[["lower", "Panels below", pk.lower.length, maxPanels()], ["over", "On the price", pk.over.length, MAX_OVERLAYS]].map(([k, l, n, m]) => `<button data-fxtab="${k}" aria-pressed="${fxTab === k}">${l} <small>${n}/${m}</small></button>`).join("")}</div>
    ${list()}
    <p class="disclaimer">Indicators are arithmetic on past prices and volume. They describe what happened, not what will happen. Tap a name for its guide.</p>`;
  const wire = (root) => {
    const redo = () => { const top = root.scrollTop; root.innerHTML = body(); wire(root); root.scrollTop = top; };
    root.querySelectorAll("[data-stog]").forEach((b) => (b.onclick = () => {
      const code = b.dataset.stog, isOver = !!OVERLAYS[code], l = isOver ? pk.over : pk.lower, i = l.indexOf(code), max = isOver ? MAX_OVERLAYS : maxPanels();
      if (i >= 0) l.splice(i, 1);
      else if (l.length >= max) { swap = code; root.innerHTML = body(); wire(root); root.scrollTop = 0; return; } // full: ask which one it replaces
      else l.push(code);
      swap = null; persist(); redo();
    }));
    root.querySelectorAll("[data-swap]").forEach((b) => (b.onclick = () => {
      if (b.dataset.swap) { const l = OVERLAYS[swap] ? pk.over : pk.lower; l.splice(l.indexOf(b.dataset.swap), 1, swap); persist(); haptic(); }
      swap = null; redo();
    }));
    root.querySelectorAll("[data-fxtab]").forEach((b) => (b.onclick = () => { fxTab = b.dataset.fxtab; root.innerHTML = body(); wire(root); }));
    root.querySelectorAll("[data-sset]").forEach((b) => (b.onclick = () => { const x = SETS.find((y) => y.id === b.dataset.sset) || { over: [], lower: [] }; pk.over.splice(0, 99, ...x.over); pk.lower.splice(0, 99, ...x.lower.slice(0, maxPanels())); persist(); redo(); }));
    root.querySelectorAll("[data-sguide]").forEach((b) => (b.onclick = () => openIndicator(b.dataset.sguide)));
  };
  openSheet("Indicators", body(), wire);
}

// More panels saved than this screen fits (a smaller phone, or picks from before the limit): ask once which to keep,
// rather than quietly dropping the last ones added.
const askedFit = new Set();
export function checkPanelFit(onDone) {
  const pk = picks(store.data?.settings?.chart), max = maxPanels(), sig = `${pk.lower.join()}|${max}`;
  if (pk.lower.length <= max || askedFit.has(sig) || !$("sheet").hidden || document.getElementById("gate")) return;
  askedFit.add(sig);
  let keep = pk.lower.slice(-max); // the most recently added, which are the ones that were being cut
  openSheet(`Pick ${max} panels`, "", (body) => {
    const draw = () => {
      body.innerHTML = `<p class="hint">You've chosen ${pk.lower.length} panels, and this screen fits ${max} under the price. Which ${max} should show? The others come off (add them back any time with ƒx).</p>
        <div class="choices">${pk.lower.map((k) => `<button class="choice" data-keep="${k}" aria-pressed="${keep.includes(k)}"><b>${esc(PANELS[k].name)}</b><span>${esc(PANELS[k].short)}</span></button>`).join("")}</div>
        <p style="margin-top:12px"><button class="btn primary block" id="kGo" ${keep.length ? "" : "disabled"}>Show ${keep.length === 1 ? "this one" : `these ${keep.length}`}</button></p>`;
      body.querySelectorAll("[data-keep]").forEach((b) => (b.onclick = () => {
        const k = b.dataset.keep, i = keep.indexOf(k);
        if (i >= 0) keep.splice(i, 1); else { if (keep.length >= max) keep.shift(); keep.push(k); }
        haptic(); draw();
      }));
      body.querySelector("#kGo").onclick = async () => {
        const order = pk.lower.filter((k) => keep.includes(k)), ch = store.data?.settings?.chart || {};
        closeSheet(); await save({ settings: { ...store.data.settings, chart: { ...ch, lower: order.join(",") || "none" } } }).catch(() => {});
        APP.needsRebuild = true; onDone?.();
      };
    };
    draw();
  });
}

// ---------- lines on the chart (S/R button on every card): one choice for every coin
export async function setLines(mode) {
  const st = store.data.settings, by = { ...(st.chartBy || {}) };
  for (const k of Object.keys(by)) { const o = { ...by[k] }; delete o.levels; if (Object.keys(o).length) by[k] = o; else delete by[k]; }
  await save({ settings: { ...st, ...(mode !== "off" ? { levelsPick: mode } : {}), chart: { ...(st.chart || {}), levels: mode }, chartBy: by } });
  APP.needsRebuild = true;
}
export function openLinesSheet(onChange) {
  const cur = () => store.data?.settings?.chart?.levels || "off";
  const desc = { off: "Just the candles.", sr: "Dashed lines at prices where the chart turned at least twice in this view: green below the price, red above it.", pivots: "Levels worked out from the previous period's high, low and close (the previous day, month or year)." };
  const draw = (body) => {
    body.innerHTML = `<p class="hint">Applies to every coin. Tap a line's label on the chart to learn how it's drawn.</p>
      <div class="choices">${LEVEL_OPTS.map(([v, l]) => `<button class="choice" data-line="${v}" aria-pressed="${cur() === v}"><b>${esc(l)}</b><span>${esc(desc[v])}</span></button>`).join("")}</div>
      <p class="disclaimer">Lines describe past prices. They don't predict where the price will go.</p>`;
    body.querySelectorAll("[data-line]").forEach((b) => (b.onclick = async () => { await setLines(b.dataset.line); haptic(); onChange?.(); closeSheet(); }));
  };
  openSheet("Lines on the chart", "", draw);
}

// ---------- feedback inbox (admins only): every note with where it was left; copy the open ones to hand to Claude
function pInbox(el, back) {
  const st = APP.inboxFilter || "open";
  el.innerHTML = `${back}<h1>Feedback inbox</h1><p class="hint">Loading…</p>`;
  listFeedback().then((all) => {
    const shown = all.filter((x) => st === "all" || (x.status || "open") === st), n = (k) => all.filter((x) => (x.status || "open") === k).length;
    const when = (t) => (t ? new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
    el.innerHTML = `${back}<h1>Feedback inbox</h1>
      <div class="seg" role="group" aria-label="Show">${[["open", `Open ${n("open")}`], ["done", `Done ${n("done")}`], ["declined", `Declined ${n("declined")}`], ["all", "All"]].map(([k, l]) => `<button data-fs="${k}" aria-pressed="${st === k}">${l}</button>`).join("")}</div>
      ${st === "open" && shown.length ? `<p><button class="btn block" id="fbCopy">Copy all open notes for Claude</button></p>` : ""}
      ${shown.length ? `<div class="fblist">${shown.map((x) => `<article class="fbitem" data-id="${esc(x.id)}">
          <div class="fbmeta"><b>${esc(x.where || "")}</b><span>${esc(x.screen || "")}${x.coin ? ` · ${esc(x.coin)}` : ""} · ${esc(when(x.createdAt))}</span></div>
          <p>${esc(x.text)}</p>${x.note ? `<p class="hint">Note: ${esc(x.note)}</p>` : ""}
          <div class="fbact">${(x.status || "open") === "open" ? `<button class="btn sm" data-fset="done">Done</button><button class="btn ghost sm" data-fset="declined">Decline</button>` : `<span class="pill ${x.status === "done" ? "confirmed" : "single"}">${esc(x.status)}</span><button class="btn ghost sm" data-fset="open">Reopen</button>`}</div>
        </article>`).join("")}</div>` : `<div class="empty">Nothing here.</div>`}`;
    el.querySelector("#pBack").onclick = () => backFromProfile();
    el.querySelectorAll("[data-fs]").forEach((b) => (b.onclick = () => { APP.inboxFilter = b.dataset.fs; pInbox(el, back); }));
    el.querySelectorAll("[data-fset]").forEach((b) => (b.onclick = async () => { await setFeedbackStatus(b.closest("[data-id]").dataset.id, b.dataset.fset); pInbox(el, back); }));
    el.querySelector("#fbCopy")?.addEventListener("click", () => {
      const text = shown.map((x, i) => `${i + 1}. [${x.screen}${x.coin ? " · " + x.coin : ""}] ${x.where}\n   "${x.text}" (id ${x.id})`).join("\n");
      navigator.clipboard?.writeText(`Pulse feedback, ${shown.length} open notes:\n${text}`).then(() => toast("Copied. Paste it into Claude."), () => toast("Couldn't copy."));
    });
  }).catch(() => { el.innerHTML = `${back}<h1>Feedback inbox</h1><div class="empty">Couldn't load feedback. Only admins can see it.</div>`; el.querySelector("#pBack").onclick = () => backFromProfile(); });
}
