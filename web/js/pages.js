// Dashboard, Profile, sheets (add stocks, watchlists, switcher) and onboarding.
import { CONFIG } from "../config.js";
import { store, save, chartSettings, setUsername, checkUsername, usernameChangesLeft, USERNAME_CHANGES, allSyms, watchlists, listsOf, setSymLists, newWatchlist, renameWatchlist, deleteWatchlist, moveInWatchlist,
  markAlertsRead, clearAlerts, addDemoAlerts, createList, joinList, leaveList,
  getShared, callAI, enablePush, signOutDevice, deleteAccount } from "./store.js";
import { loadSymbols, searchSymbols, searchIndicators, symbolIndex, MKLABEL, TYLABEL } from "./search.js";
import { METRICS, OPS, ruleMet, fmt } from "./indicators.js";
import { sparkline } from "./chart.js";
import { D, view, storiesFor, RANGE_LABEL, resolveInterval } from "./data.js";
import { $, esc, money, pct, arrow, fmtDay, ago, toast, openSheet, setSheetBody, closeSheet, DISCLAIMER } from "./ui.js";
import { startTour, resetTours } from "./coach.js";
import { APP, buildFeed, showTab, currentSyms, listName, applyTheme, doRefresh } from "./app.js";

const MAX_ACTIVE = 6;
const symDoc = (r) => ({ key: r.key, t: r.t, n: r.n, m: r.m, ty: r.ty });
const indById = (id) => [...APP.catalogue, ...(store.data?.customIndicators || [])].find((x) => x.id === id);

export function initPages() {
  window.addEventListener("hashchange", () => {
    const m = location.hash.match(/^#\/join\/([a-z0-9]+)/);
    if (m) { showTab("profile"); joinFlow(m[1]); }
  });
  const m = location.hash.match(/^#\/join\/([a-z0-9]+)/);
  if (m) setTimeout(() => { showTab("profile"); joinFlow(m[1]); }, 300);
}

// ---------- add-stock sheet: search, then choose watchlists
export function openAddSheet(prefill = "") {
  const curList = store.data?.settings?.list;
  openSheet("Add coins", "", (body) => { mountSearch(body, prefill); setTimeout(() => startTour("add"), 350); },
    () => { const added = APP.lastAdded; buildFeed({ keepKey: added || APP.seq[APP.active]?.sym?.key }); APP.lastAdded = null;
      if (added && !D.series[added]) doRefresh(false).then(() => { if (APP.tab === "dash") renderDash(); }); }); // fetch prices for a newly added coin

  function mountSearch(body, initial = "") {
    body.innerHTML = `<input class="input" id="addQ" type="search" placeholder="Company, ticker, ETF or coin" autocomplete="off" spellcheck="false" value="${esc(initial)}" aria-label="Search">
      <div id="addRes" style="margin-top:6px"></div>`;
    const q = body.querySelector("#addQ");
    let rows = [];
    const draw = (extra = "") => {
      const text = q.value.trim(), inAny = new Set(allSyms().map((s) => s.key));
      body.querySelector("#addRes").innerHTML = !text ? `<p class="hint">Search coins by name or symbol, like “bitcoin”, “eth” or “sol”.</p>${starterHtml()}` :
        (rows.map((r, i) => `<button class="result ${inAny.has(r.key) ? "in" : ""}" data-i="${i}"><span class="t">${esc(r.t)}</span><span class="n">${esc(r.n)}</span><span class="x">${inAny.has(r.key) ? "Added" : esc(MKLABEL[r.m] + " · " + TYLABEL[r.ty])}</span></button>`).join("") ||
          `<p class="hint">No listing matches “${esc(text)}”.</p>`) + extra +
        (text.length >= 3 && !extra ? `<button class="btn ghost sm" id="askAI" style="margin-top:8px">Not it? Ask AI what “${esc(text)}” means</button>` : "");
      body.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => chooseLists(rows[+b.dataset.i], () => mountSearch(body))));
      body.querySelector("#askAI")?.addEventListener("click", () => askAI(q.value.trim()));
      body.querySelectorAll("[data-starter]").forEach((b) => (b.onclick = () => addStarter(b.dataset.starter)));
    };
    const askAI = async (text) => {
      draw(`<p class="hint">Asking AI what “${esc(text)}” refers to…</p>`);
      try {
        const out = await callAI("/resolve", { q: text });
        const idx = symbolIndex() || [];
        rows = (out.matches || []).map((m) => { const t = String(m.ticker || "").toUpperCase(), mk = String(m.market || "").toUpperCase();
          return idx.find((x) => x.t === t && (mk === "US" ? ["NASDAQ", "NYSE", "ARCA"].includes(x.m) : mk === "NSE" ? ["NSE", "INDEX"].includes(x.m) : x.m === "CRYPTO")); }).filter(Boolean);
        draw(rows.length ? `<p class="hint">AI suggestions. Check the name before adding.</p>` : `<p class="hint">No listing found. Try the company's full name.</p>`);
      } catch (e) { draw(`<p class="hint">${esc(e.message)}</p>`); }
    };
    let t;
    q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(async () => { await loadSymbols().catch(() => {}); rows = searchSymbols(q.value, 8); draw(); }, 60); });
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
export function openSwitcher() {
  const cur = store.data?.settings?.list || "all";
  const all = allSyms().length;
  openSheet("Show in feed", `${[["all", "All my coins", all], ...watchlists().map((w) => [w.id, w.name, (w.syms || []).length])].map(([id, name, n]) =>
    `<button class="row" data-l="${esc(id)}"><span class="main"><span class="t">${esc(name)}</span><span class="s">${n} symbol${n === 1 ? "" : "s"}</span></span>${id === cur ? `<span style="color:var(--accent);font-weight:800">✓</span>` : ""}</button>`).join("")}
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn sm" id="nwl">New watchlist</button><button class="btn sm" id="mwl">Manage</button></div>
    <div class="label" style="margin:18px 0 8px">Order</div><div class="opts">${[["watchlist", "Watchlist order"], ["move", "Biggest move"], ["news", "Most news"], ["rsi", "Lowest RSI"], ["az", "A to Z"]].map(([k, l]) => `<button class="opt" data-o="${k}" aria-pressed="${chartSettings().order === k}">${l}</button>`).join("")}</div>`, (body) => {
    body.querySelectorAll("[data-l]").forEach((b) => (b.onclick = async () => { await save({ settings: { ...store.data.settings, list: b.dataset.l } }); closeSheet(); }));
    body.querySelectorAll("[data-o]").forEach((b) => (b.onclick = async () => { await save({ settings: { ...store.data.settings, chart: { ...chartSettings(), order: b.dataset.o } } }); closeSheet(); }));
    body.querySelector("#nwl").onclick = async () => { const n = prompt("Name the watchlist", "Semiconductors"); if (n) { const id = await newWatchlist(n); await save({ settings: { ...store.data.settings, list: id } }); closeSheet(); openAddSheet(); } };
    body.querySelector("#mwl").onclick = () => { closeSheet(); showTab("dash"); };
  }, () => buildFeed());
}

// ---------- dashboard: your watchlists live here. Picking one also sets what the feed shows.
export function renderDash() {
  const el = $("dash"), cs = chartSettings(), syms = currentSyms(), wl = watchlists();
  const cur = store.data?.settings?.list || "all", w = wl.find((x) => x.id === cur), editing = APP.dashEdit && w;
  const withData = syms.map((s) => ({ s, v: view(s.key, cs) })).filter((x) => x.v);
  const noData = syms.filter((s) => !view(s.key, cs));
  const sort = APP.dashSort || "move";
  if (!editing) withData.sort((a, b) => sort === "az" ? a.s.t.localeCompare(b.s.t) : sort === "rsi" ? (a.v.now.rsi14 ?? 999) - (b.v.now.rsi14 ?? 999) : Math.abs(b.v.daily.now.changePct) - Math.abs(a.v.daily.now.changePct));
  const ups = withData.filter((x) => x.v.daily.now.changePct > 0).length;
  const today = new Date().toISOString().slice(0, 10), keys = new Set(syms.map((s) => s.key));
  const newsToday = (D.news.stories || []).filter((st) => st.date === today && st.syms.some((k) => keys.has(k))).length;
  const rulesToday = store.alerts.filter((a) => (a.at || "").slice(0, 10) === today).length;
  const chip = (id, name, n) => `<button class="wchip" data-l="${esc(id)}" aria-pressed="${id === cur}">${esc(name)} <span>${n}</span></button>`;
  const row = ({ s, v }, i) => { const c = v.daily.now.changePct;
    return editing ? `<div class="row"><span class="main"><span class="t">${esc(s.t)}</span><span class="s">${esc(s.n)}</span></span>
      <button class="btn ghost sm" data-up="${esc(s.key)}" ${i === 0 ? "disabled" : ""} aria-label="Move ${esc(s.t)} up">↑</button><button class="btn ghost sm" data-dn="${esc(s.key)}" ${i === withData.length - 1 ? "disabled" : ""} aria-label="Move ${esc(s.t)} down">↓</button><button class="btn ghost sm" data-rm="${esc(s.key)}" aria-label="Remove ${esc(s.t)}">✕</button></div>`
    : `<button class="row" data-open="${esc(s.key)}"><span class="main"><span class="t">${esc(s.t)}</span><span class="s">RSI ${fmt(v.now.rsi14, 1)} · ${storiesFor(s.key).length} stories</span></span>${sparkline(v.win.map((b) => b.c))}<span class="r"><b>${esc(money(v.lastBar.c, s.m))}</b><span class="${c >= 0 ? "up" : "down"}">${arrow(c)} ${pct(c)}</span></span></button>`; };
  el.innerHTML = `<h1>Dashboard</h1>
    <div class="wchips" role="tablist" aria-label="Watchlists">${chip("all", "All", allSyms().length)}${wl.map((x) => chip(x.id, x.name, (x.syms || []).filter((s) => s.m === "CRYPTO").length)).join("")}<button class="wchip add" id="dNew">+ New</button></div>
    <div class="wbar"><b>${esc(w ? w.name : "All my coins")}</b><span>${w ? `${editing ? `<button class="btn ghost sm" id="dRen">Rename</button><button class="btn ghost sm danger" id="dDel">Delete</button><button class="btn sm" id="dDone">Done</button>` : `<button class="btn ghost sm" id="dEdit">Edit</button>`}` : ""}<button class="btn sm" id="dAdd">+ Add coins</button></span></div>
    ${editing ? "" : `<div class="summary"><div><b>${ups}<span class="hint" style="font-size:14px">/${withData.length}</span></b><span>coins up today</span></div><div><b>${newsToday}</b><span>stories today</span></div><div><b>${rulesToday}</b><span>rules met today</span></div></div>`}
    ${withData.length ? `${editing ? `<p class="hint">Reorder or remove coins in “${esc(w.name)}”. The feed follows this order.</p>` : `<div class="opts" style="margin-bottom:10px">${[["move", "Biggest move"], ["rsi", "Lowest RSI"], ["az", "A to Z"]].map(([k, l]) => `<button class="opt" data-s="${k}" aria-pressed="${sort === k}">${l}</button>`).join("")}</div>`}
    <div class="list">${withData.map(row).join("")}</div>` : ""}
    ${noData.length ? `<p class="hint">Waiting for prices: ${noData.map((s) => esc(s.t)).join(", ")}.</p>` : ""}
    ${!syms.length ? `<div class="empty">Nothing in this watchlist yet.</div>` : ""}
    <p class="hint" style="margin-top:12px">Choosing a watchlist here also sets what your feed shows.</p>
    <p class="disclaimer">${esc(DISCLAIMER)}</p>`;
  const pick = async (id) => { APP.dashEdit = false; await save({ settings: { ...store.data.settings, list: id } }); APP.needsRebuild = true; renderDash(); };
  el.querySelectorAll("[data-l]").forEach((b) => (b.onclick = () => pick(b.dataset.l)));
  el.querySelector("#dNew").onclick = async () => { const n = prompt("Name the watchlist", "Layer 1 coins"); if (n) { const id = await newWatchlist(n); await pick(id); openAddSheet(); } };
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

// ---------- profile
// Profile: a header with the username, then settings grouped by what people come here to do.
const ICON = {
  chart: '<path d="M3 17l5-6 4 4 4-7 5 9"/>', indicators: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>', rules: '<path d="M12 3a6 6 0 016 6c0 5 2 6 2 6H4s2-1 2-6a6 6 0 016-6zM10 19a2 2 0 004 0"/>',
  alerts: '<path d="M4 4h16v12H5l-1 4z"/>', lists: '<circle cx="8" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M2 20c1-4 4-5 6-5s5 1 6 5M14 20c.5-2.5 2-3.5 3.5-3.5S21 17.5 22 20"/>',
  account: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>', appearance: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 000 16z"/>',
  tour: '<path d="M5 3l14 9-14 9z"/>', legal: '<path d="M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6"/>',
};
const GROUPS = [
  ["Charts & learning", [["chart", "Chart style", "Time range, candles, panels, lines"], ["indicators", "Indicators", "What the readings show"]]],
  ["Alerts", [["rules", "Alert rules", "Get told when your levels are hit"], ["alerts", "Alerts", "Everything that has fired"]]],
  ["Sharing", [["lists", "Shared lists", "Follow a list with friends"]]],
  ["Account & privacy", [["account", "Account", "Recovery code, devices, delete"], ["appearance", "Appearance", "Dark, light or match phone"]]],
  ["Help", [["tour", "Show the app tour again", "Swipes, charts and watchlists in a minute"], ["legal", "Legal and disclaimer", "Terms, privacy, grievance contact"]]],
];
const icon = (k) => `<svg class="pic" viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ""}</svg>`;
export function renderProfile(sub, arg) {
  const el = $("profile");
  const back = `<button class="btn ghost sm" id="pBack" style="padding-left:0">‹ Profile</button>`;
  if (!sub) {
    const unread = store.alerts.filter((a) => !a.read).length;
    const u = store.data?.username, left = usernameChangesLeft(), nW = watchlists().length, nC = allSyms().length;
    el.innerHTML = `<div class="phead">
        <div class="pav" aria-hidden="true">${u ? esc(u[0].toUpperCase()) : `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>`}</div>
        <div class="pwho"><b>${u ? "@" + esc(u) : "Your profile"}</b><span>${nC} coins · ${nW} watchlist${nW === 1 ? "" : "s"}${store.mode === "demo" ? " · saved on this phone" : ""}</span></div>
        ${u ? `<button class="btn sm" id="pName">Change</button>` : ""}
      </div>
      ${u ? `<p class="hint pleft">${left > 0 ? `${left} username change${left === 1 ? "" : "s"} left` : "No username changes left"}</p>` : ""}

      ${GROUPS.map(([g, rows]) => `<h2 class="pg">${g}</h2><div class="list pgl">${rows.map(([k, l, d]) => `<button class="row" data-p="${k}">${icon(k)}<span class="main"><span class="t">${l}${k === "alerts" && unread ? ` <span class="pill confirmed">${unread} new</span>` : ""}</span><span class="s">${d}</span></span><span class="chev">›</span></button>`).join("")}</div>`).join("")}
      <p class="disclaimer">${esc(DISCLAIMER)}</p>`;
    el.querySelector("#pName")?.addEventListener("click", () => openUsernameSheet());
    el.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => {
      if (b.dataset.p === "tour") { resetTours(); showTab("feed"); setTimeout(() => startTour("feed"), 300); return; }
      renderProfile(b.dataset.p);
    }));
    return;
  }
  const fn = { watchlists: pWatchlists, chart: pChart, indicators: pIndicators, rules: pRules, alerts: pAlerts, lists: pLists, account: pAccount, appearance: pAppearance, legal: pLegal }[sub];
  fn(el, back, arg);
  el.querySelector("#pBack").onclick = () => renderProfile();
  el.parentElement.scrollTop = 0;
}

// Username sheet: live checks, a clear count of changes left, and a warning against real names.
export function openUsernameSheet(onDone, reason) {
  const cur = store.data?.username || "", left = usernameChangesLeft();
  if (cur && left <= 0) { toast("You've used all your username changes."); return; }
  openSheet(cur ? "Change username" : "Choose a username", `
    ${reason ? `<p>${esc(reason)}</p>` : ""}<label class="field"><span>Username</span><div class="uname"><span>@</span><input id="uIn" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="21" value="${esc(cur)}" placeholder="e.g. chartwatcher"></div></label>
    <p class="hint" id="uMsg">3–20 letters, numbers, dots or underscores.</p>
    <div class="notice">Your username is public in shared lists. Don't use your real name, email or phone number.</div>
    <p class="hint">${cur ? `Changing it uses 1 of your ${left} remaining change${left === 1 ? "" : "s"}.` : `After choosing one you can change it ${USERNAME_CHANGES} more times.`}</p>
    <button class="btn primary block" id="uSave" disabled>${cur ? "Change username" : "Save username"}</button>`, (body) => {
    const inp = body.querySelector("#uIn"), msg = body.querySelector("#uMsg"), btn = body.querySelector("#uSave");
    const check = () => { const { name, error } = checkUsername(inp.value); const same = name === cur; msg.textContent = error || (same ? "That's your current username." : `@${name} looks good.`); msg.className = "hint " + (error ? "bad" : same ? "" : "good"); btn.disabled = !!error || same; };
    inp.oninput = check; check(); setTimeout(() => inp.focus(), 250);
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "Saving…";
      try { const n = await setUsername(inp.value); closeSheet(); toast(`You're @${n}.`); if (onDone) onDone(); else renderProfile(); }
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
  const re = () => pWatchlists(el, back) || (el.querySelector("#pBack").onclick = () => renderProfile());
  el.querySelector("#wAdd").onclick = () => openAddSheet();
  el.querySelector("#wNew").onclick = async () => { const n = prompt("Name the watchlist", "Semiconductors"); if (n) { await newWatchlist(n); re(); } };
  el.querySelectorAll("[data-ren]").forEach((b) => (b.onclick = async () => { const w = wl.find((x) => x.id === b.dataset.ren); const n = prompt("Rename", w.name); if (n) { await renameWatchlist(w.id, n); re(); } }));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (confirm("Delete this watchlist? Its symbols stay in your other watchlists.")) { await deleteWatchlist(b.dataset.del); if (store.data.settings.list === b.dataset.del) await save({ settings: { ...store.data.settings, list: "all" } }); re(); } }));
  const pair = (b, k) => b.dataset[k].split("|");
  el.querySelectorAll("[data-up]").forEach((b) => (b.onclick = async () => { const [w, k] = pair(b, "up"); await moveInWatchlist(w, k, -1); re(); }));
  el.querySelectorAll("[data-dn]").forEach((b) => (b.onclick = async () => { const [w, k] = pair(b, "dn"); await moveInWatchlist(w, k, 1); re(); }));
  el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { const [w, k] = pair(b, "rm"); await save({ watchlists: watchlists().map((x) => (x.id === w ? { ...x, syms: x.syms.filter((s) => s.key !== k) } : x)) }); re(); }));
}

// Chart options, shared by Profile → Chart style (everyone's default) and the chip on each feed card.
const RANGE_OPTS = [["1M", "1M"], ["3M", "3M"], ["6M", "6M"], ["1Y", "1Y"], ["2Y", "2Y"]];
const CANDLE_OPTS = [["auto", "Auto"], ["1D", "Daily"], ["1W", "Weekly"]];
const TYPE_OPTS = [["candles", "Candles"], ["line", "Line"], ["area", "Area"]];
const LEVEL_OPTS = [["off", "Off"], ["sr", "Support & resistance"], ["pivots", "Pivot points"]];
const LOWER_OPTS = [["RSI,MACD", "RSI + MACD"], ["RSI", "RSI"], ["MACD", "MACD"], ["VOL", "Volume"], ["none", "None"]];
function chartOptsHtml(c) {
  const opt = (key, vals) => `<div class="opts">${vals.map(([v, l]) => `<button class="opt" data-k="${key}" data-v="${v}" aria-pressed="${String(c[key]) === String(v)}">${l}</button>`).join("")}</div>`;
  const iv = resolveInterval(c);
  return `<h2>Time range</h2>${opt("range", RANGE_OPTS)}<p class="hint">${esc(RANGE_LABEL[c.range] || "")} of ${iv === "1W" ? "weekly" : "daily"} candles. Each ${iv === "1W" ? "candle is one week" : "candle is one day"}.</p>
    <h2>Candle size</h2>${opt("interval", CANDLE_OPTS)}<p class="hint">Auto uses daily candles up to 6 months and weekly candles for 1 and 2 years, so the chart never gets crowded.</p>
    <h2>Chart type</h2>${opt("type", TYPE_OPTS)}
    <h2>Panels under the chart</h2>${opt("lower", LOWER_OPTS)}
    <h2>Lines on the chart</h2>${opt("levels", LEVEL_OPTS)}<p class="hint">Support & resistance: prices where the chart turned at least twice. Pivot points: levels worked out from the previous month (or year). Both describe the past, not the future.</p>`;
}
function pChart(el, back) {
  const c = chartSettings(), custom = Object.keys(store.data.settings?.chartBy || {});
  el.innerHTML = `${back}<h1>Chart style</h1><p class="hint">Your default for every coin. To change one coin, tap the time chip on its card in the feed.</p>
    ${chartOptsHtml(c)}
    <h2>Moving averages</h2><div class="opts">${[["sma20", "SMA 20"], ["sma50", "SMA 50"], ["sma200", "SMA 200"], ["ema20", "EMA 20"], ["ema50", "EMA 50"]].map(([v, l]) => `<button class="opt" data-ma="${v}" aria-pressed="${(c.mas || []).includes(v)}">${l}</button>`).join("")}</div><p class="hint">Up to 3.</p>
    ${custom.length ? `<h2>Coins with their own chart</h2><p>${custom.map((k) => `<span class="pill">${esc(k.split(":")[1])}</span>`).join(" ")} <button class="btn ghost sm" id="cReset">Reset all to default</button></p>` : ""}`;
  const re = () => { pChart(el, back); el.querySelector("#pBack").onclick = () => renderProfile(); };
  const set = async ({ _pick, ...patch }) => { await save({ settings: { ...store.data.settings, ...(_pick ? { levelsPick: patch.levels } : {}), chart: { ...store.data.settings.chart, ...patch } } }); APP.needsRebuild = true; re(); };
  el.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => set(b.dataset.k === "levels" && b.dataset.v !== "off" ? { levels: b.dataset.v, _pick: 1 } : { [b.dataset.k]: b.dataset.v })));
  el.querySelectorAll("[data-ma]").forEach((b) => (b.onclick = () => {
    const m = new Set(c.mas || []);
    if (m.has(b.dataset.ma)) m.delete(b.dataset.ma); else { if (m.size >= 3) return toast("Up to 3 averages keep charts readable."); m.add(b.dataset.ma); }
    set({ mas: [...m] });
  }));
  el.querySelector("#cReset")?.addEventListener("click", async () => { await save({ settings: { ...store.data.settings, chartBy: {} } }); APP.needsRebuild = true; re(); });
}

// The time chip on a feed card: change this coin's chart, or every coin in the list the feed is showing.
export function openChartSheet(sym, onChange) {
  const list = store.data?.settings?.list || "all", w = watchlists().find((x) => x.id === list);
  let scope = store.data?.settings?.chartBy?.[sym.key] ? "coin" : "all";
  const draw = (body) => {
    const own = !!store.data?.settings?.chartBy?.[sym.key];
    body.innerHTML = `<div class="seg scope" role="group" aria-label="Apply to">${[["coin", `Just ${sym.t}`], ["all", w ? `All in ${w.name}` : "All my coins"]].map(([k, l]) => `<button data-scope="${k}" aria-pressed="${scope === k}">${esc(l)}</button>`).join("")}</div>
      ${chartOptsHtml(chartSettings(sym.key))}
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

function pIndicators(el, back) {
  const ind = store.data.indicators || { added: [], active: [] }, active = new Set(ind.active);
  const added = ind.added.map(indById).filter(Boolean), term = APP.indQ || "";
  const pool = [...APP.catalogue, ...(store.data.customIndicators || [])].filter((c) => !ind.added.includes(c.id));
  const found = term ? searchIndicators(pool, term).slice(0, 8) : [];
  el.innerHTML = `${back}<h1>Indicators</h1><p class="hint">Switch on up to ${MAX_ACTIVE}; they appear as readings in every card's details. Tap a name to learn what it measures.</p>
    <div class="list">${added.map((i) => `<div class="row"><button class="main" data-info="${esc(i.id)}" style="background:none;border:0;text-align:left;color:var(--text);cursor:pointer"><span class="t">${esc(i.name)}${i.custom ? ` <span class="pill single">Not yet reviewed</span>` : ""}</span><span class="s" style="white-space:normal">${esc(i.short || "")}</span></button>
      <label class="switch"><input type="checkbox" data-act="${esc(i.id)}" ${active.has(i.id) ? "checked" : ""} aria-label="Show ${esc(i.name)}"><span></span></label></div>`).join("")}</div>
    <h2>Add an indicator</h2><input class="input" id="indQ" value="${esc(term)}" placeholder="e.g. stochastic, vwap, ichimoku" autocomplete="off">
    <div style="margin-top:8px">${term ? (found.length ? `<div class="list">${found.map((i) => `<div class="row"><span class="main"><span class="t">${esc(i.name)}</span><span class="s">${esc(i.category)}</span></span><button class="btn sm primary" data-add="${esc(i.id)}">Add</button></div>`).join("")}</div>` : "") +
      `<div class="box" style="margin-top:8px;display:flex;gap:10px;align-items:center"><span style="flex:1">Not listed? AI researches “${esc(term)}” and adds an explainer for everyone, marked not yet reviewed.</span><button class="btn sm" id="indAI">Research it</button></div>` : ""}</div>`;
  const re = () => { pIndicators(el, back); el.querySelector("#pBack").onclick = () => renderProfile(); };
  const inp = el.querySelector("#indQ");
  inp.oninput = () => { APP.indQ = inp.value; const p = inp.selectionStart; re(); const n = el.querySelector("#indQ"); n.focus(); n.setSelectionRange(p, p); };
  el.querySelectorAll("[data-act]").forEach((c) => (c.onchange = async () => {
    const on = new Set(store.data.indicators.active);
    if (c.checked) { if (on.size >= MAX_ACTIVE) { c.checked = false; return toast(`Up to ${MAX_ACTIVE} at a time.`); } on.add(c.dataset.act); } else on.delete(c.dataset.act);
    await save({ indicators: { ...store.data.indicators, active: [...on] } });
  }));
  el.querySelectorAll("[data-info]").forEach((b) => (b.onclick = () => openIndicator(b.dataset.info)));
  el.querySelectorAll("[data-add]").forEach((b) => (b.onclick = async () => {
    const on = new Set(ind.active); if (on.size < MAX_ACTIVE) on.add(b.dataset.add);
    APP.indQ = ""; await save({ indicators: { added: [...ind.added, b.dataset.add], active: [...on] } }); re(); openIndicator(b.dataset.add);
  }));
  el.querySelector("#indAI")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Researching…";
    try {
      const { doc } = await callAI("/indicator", { name: term });
      const known = indById(doc.id);
      const entry = known || { id: doc.id, name: doc.name, aliases: doc.aliases || [], category: doc.category || "Other", metrics: [], tv: null, computed: false, short: doc.short || "", custom: true };
      store.indDocs.set(doc.id, doc); APP.indQ = "";
      await save({ customIndicators: [...(store.data.customIndicators || []).filter((x) => x.id !== entry.id), ...(known ? [] : [entry])], indicators: { ...ind, added: [...new Set([...ind.added, entry.id])] } });
      re(); openIndicator(entry.id);
    } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = "Research it"; }
  });
}
export async function openIndicator(id) {
  const i = indById(id); if (!i) return;
  let ex = i.explainer, reviewed = true;
  if (!ex) { const d = await getShared("indicatorDocs", id); if (d) { ex = d; reviewed = !!d.reviewed; } }
  const srcs = (ex?.sources || []).filter((s) => /^https?:\/\//.test(s.url || "")).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label || s.url)}</a></li>`).join("");
  openSheet(esc(i.name), ex ? `${[["What it measures", ex.measures], ["How it's calculated", ex.calc], ["Usual settings", ex.settings], ["What it misses", ex.limits]].map(([k, v]) => `<div class="label" style="margin-top:12px">${k}</div><p>${esc(v)}</p>`).join("")}
    ${srcs ? `<div class="label" style="margin-top:12px">Sources</div><ul>${srcs}</ul>` : ""}${reviewed ? "" : `<p class="ai">AI-researched · not yet reviewed · not investment advice</p>`}` : `<p>${esc(i.short || "No explainer yet.")}</p>`);
}

const RULE_METRICS = ["price", "changePct", "rsi14", "distSma20Pct", "distSma50Pct", "macdHist", "pctB", "distHigh50Pct", "volRatio", "atrPct", "stochK", "willR", "cci20", "adx14", "roc12"];
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
  const re = () => { pRules(el, back); el.querySelector("#pBack").onclick = () => renderProfile(); };
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
      const v = view(k, { ...cs, interval: "1D" }); if (!v || !ruleMet(r, v.now, v.prev)) continue;
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
  const re = () => { pAlerts(el, back); el.querySelector("#pBack").onclick = () => renderProfile(); };
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
      ${(l.symbols || []).length ? `<button class="btn sm" data-copyto="${esc(l.id)}">Copy into a watchlist</button>` : ""}</div>`).join("")}`;
  const re = () => { pLists(el, back); el.querySelector("#pBack").onclick = () => renderProfile(); };
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
    try { await joinList(id, store.data.username); toast("Joined. Find it in Profile → Shared lists."); renderProfile("lists"); } catch (e) { toast(e.message, { ms: 5000 }); }
  });
}
// A username is only asked for when it's needed: shared lists show members by username.
function withUsername(fn) {
  if (store.data?.username) return fn();
  openUsernameSheet(fn, "Shared lists show members by username, so pick one first.");
}

function pAccount(el, back) {
  const n = store.data?.username;
  el.innerHTML = `${back}<h1>Account</h1>
    <p>Your account has no name, email or phone number. It belongs to this app on this phone${store.mode === "demo" ? " (demo mode)" : ""}.</p>
    <p class="hint">Uninstalling the app or clearing the browser's site data starts a fresh account. Moving to another phone will come later.</p>
    <h2>Username</h2><p class="dline">${n ? `@${esc(n)} · ${usernameChangesLeft()} change${usernameChangesLeft() === 1 ? "" : "s"} left` : "Not set. You only need one for shared lists."} <button class="btn ghost sm" id="aName">${n ? "Change" : "Add"}</button></p>
    <h2>Delete</h2><button class="btn danger" id="del">Delete my account and all its data</button>`;
  el.querySelector("#aName").onclick = () => openUsernameSheet(() => pAccount(el, back) || (el.querySelector("#pBack").onclick = () => renderProfile()));
  el.querySelector("#del").onclick = async () => { if (confirm("Delete your account, watchlists, rules and alerts? This can't be undone.")) await deleteAccount(); };
}
function pAppearance(el, back) {
  const t = store.data.settings?.theme || "dark";
  el.innerHTML = `${back}<h1>Appearance</h1><div class="opts">${[["dark", "Dark"], ["light", "Light"], ["auto", "Match phone"]].map(([k, l]) => `<button class="opt" data-t="${k}" aria-pressed="${t === k}">${l}</button>`).join("")}</div>`;
  el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = async () => { await save({ settings: { ...store.data.settings, theme: b.dataset.t } }); applyTheme(); pAppearance(el, back); el.querySelector("#pBack").onclick = () => renderProfile(); }));
}
function pLegal(el, back) {
  el.innerHTML = `${back}<h1>Legal and disclaimer</h1>
    <h2>Not investment advice</h2><p>${esc(DISCLAIMER)} Check facts and consult a registered adviser before investing.</p>
    <h2>How AI is used</h2><p>Explanations of news, price moves and indicators are written by an AI model from linked sources, once per story or move, and are the same for every user. They describe what happened and what a number measures. They never say whether to buy, sell or hold and never predict prices. Each is labelled with its date and sources.</p>
    <h2>Fact tags and sorting</h2><p>Tags such as “Volume 2.1x usual” or “New 50-day high” state facts about the latest data. Sorting by move, news or RSI orders your own list by that fact. Neither is a signal or a ranking of investments.</p>
    <h2>Privacy</h2><p>We don't ask for or store your name, email, phone number, location or contacts, and use no tracking or advertising cookies. We keep a random account ID derived from your recovery code, the username you choose (if any), your watchlists, chart style, rules and indicator choices, list nicknames and, if you turn on alerts, a push token. You can delete everything from Account.</p>
    <h2>Data sources</h2><p>Coin prices from Kraken's public data, checked against CoinGecko. News found via the GDELT Project and linked to each publisher.</p>
    <h2>Age</h2><p>For people aged 18 and over.</p>
    <h2>Grievance contact</h2><p>${esc(CONFIG.companyName)} · <a href="mailto:${esc(CONFIG.grievanceEmail)}">${esc(CONFIG.grievanceEmail)}</a>. Complaints acknowledged within 24 hours, resolved within 15 days.</p>
    <p class="hint">Summary only. Full terms and privacy notice to be reviewed by a lawyer before public launch.</p>`;
}

// ---------- onboarding (live mode, no account on this phone)
