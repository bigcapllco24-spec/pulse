// Pulse: the app's frame. Tabs (Feed, Calls, You) and the pages that slide in over them, refreshing prices, the
// theme, starting up, and the offline copy with its releases (sw.js). The feed itself is feed.js; a card's news and
// details panes are news.js and details.js.
import { CONFIG } from "../config.js";
import { store, ls, init, save, STARTER, chartSettings, allSyms, watchlists, settleDemoPredictions, connected } from "./store.js";
import { initSocial, settleDemoChallenges } from "./social.js";
import { initPlay, renderPlay, openLink, badge, rerenderPages } from "./calls.js";
import { closeGroup } from "./groups.js";
import { krakenRows } from "./predict.js";
import { loadSymbols } from "./search.js";
import { closeFull } from "./full.js";
import { openPage, closeAllPages, topPage, pageOpen } from "./nav.js";
import { D, loadCached, refresh, view, storiesFor, dailyOf } from "./data.js";
import { $, hhmm, toast } from "./ui.js";
import { initPages, renderDash, openSwitcher, openAddSheet, demoRules } from "./pages.js";
import { startOnboarding, onboarding, needsOnboarding } from "./onboard.js";
import { openGuide, guideSeen } from "./guide.js";
import { initYou, renderYou } from "./you.js";
import { redrawCards, buildFeed, whenIdle, feed, fillCard, swipeHint } from "./feed.js";

export const APP = { tab: "feed", seq: [], active: -1, syms: [], catalogue: [], built: false };

// ---------- which symbols, in which order
export function currentSyms() {
  const list = store.data?.settings?.list || "all";
  // a watchlist, or a shared list (1.2.0: "Scroll these in the feed")
  let syms = list === "all" ? allSyms() : (watchlists().find((w) => w.id === list)?.syms || (store.lists.get(list)?.symbols || []).filter((x) => x.m === "CRYPTO") || allSyms());
  if (!syms.length) syms = allSyms();
  const order = chartSettings().order;
  const chg = (s) => view(s.key, dailyOf(chartSettings()))?.daily.now.changePct;
  if (order === "move") syms = [...syms].sort((a, b) => Math.abs(chg(b) ?? -1) - Math.abs(chg(a) ?? -1));
  else if (order === "news") syms = [...syms].sort((a, b) => storiesFor(b.key).length - storiesFor(a.key).length);
  else if (order === "az") syms = [...syms].sort((a, b) => a.t.localeCompare(b.t));
  else if (order === "rsi") syms = [...syms].sort((a, b) => (view(a.key, dailyOf(chartSettings()))?.now.rsi14 ?? 999) - (view(b.key, dailyOf(chartSettings()))?.now.rsi14 ?? 999));
  return syms;
}
export function listName() {
  const list = store.data?.settings?.list || "all";
  return list === "all" ? "All my coins" : watchlists().find((w) => w.id === list)?.name || "All my coins";
}
let dashT = 0;
// new intraday prices: the open cards redraw, and Coins or Predict (prices, "now x% away") once things settle
document.addEventListener("pulse-intra", (e) => { redrawCards(e.detail); if (onScreen("dash") || onScreen("play")) { clearTimeout(dashT); dashT = setTimeout(() => keepScroll(onScreen("dash") ? "dash" : "play"), 300); } });
// redraw a screen in place, keeping where it was scrolled to
export const keepScroll = (name) => { const el = $(name), pg = el.parentElement, y = pg.scrollTop; ({ dash: renderDash, you: renderYou, play: renderPlay }[name] || (() => rerenderPages(name)))(); pg.scrollTop = y; };

// ---------- tabs and refresh
// Tabs: Feed, Calls ("play") and You. Everything else is a page sliding in over the tab it was opened from (nav.js):
// the coins list ("dash"), With friends, Your record and the settings pages ("profile"). The tab bar keeps that tab lit.
export function showTab(tab) {
  closeAllPages(); closeGroup(); closeFull(); // a tab tap always lands on the tab itself
  APP.tab = tab;
  $("sFeed").hidden = tab !== "feed"; $("sPlay").hidden = tab !== "play"; $("sYou").hidden = tab !== "you";
  document.querySelectorAll(".tabbar button").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false"));
  if (tab === "play") renderPlay();
  if (tab === "you") renderYou();
  if (tab === "feed" && APP.needsRebuild) { APP.needsRebuild = false; buildFeed({ keepKey: APP.seq[APP.active]?.sym?.key }); }
}
// What's on screen: the top page, or the tab.
export const onScreen = (name) => (topPage() ? topPage() === PAGE_OF[name] : APP.tab === name);
const PAGE_OF = { dash: "sDash", friends: "sFriends", record: "sRecord", profile: "sProfile" };
// Where a page's back button goes, in words: the page under it, or the tab.
export const backLabel = () => ({ sDash: "Coins", sFriends: "With friends", sRecord: "Your record", sProfile: "Back" }[topPage()] || { feed: "Feed", play: "Calls", you: "You" }[APP.tab]);
// The coins in your feed, as a list (Your market).
export function openDash() {
  APP.dashBack = backLabel();
  openPage("sDash", { onClose: () => { if (APP.tab === "feed" && APP.needsRebuild) { APP.needsRebuild = false; buildFeed({ keepKey: APP.seq[APP.active]?.sym?.key }); } } });
  renderDash();
}
document.querySelectorAll(".tabbar button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
$("addBtn").onclick = () => openAddSheet();
$("switcher").onclick = () => openSwitcher();
$("status").onclick = () => doRefresh(true);

function setStatus() {
  const el = $("status");
  el.classList.toggle("refreshing", D.status === "refreshing");
  el.textContent = D.status === "refreshing" ? "Updating…" : D.status === "error" ? "Offline · saved" : D.refreshedAt ? `Updated ${hhmm(D.refreshedAt)}` : "Tap to update";
}
let lastRefresh = 0;
export async function doRefresh(manual) {
  if (D.status === "refreshing") return;
  setStatus(); D.status = "refreshing"; setStatus();
  // redraw nearby cards in place, keeping the user's position (only once nothing is moving)
  const refill = () => whenIdle("refill", () => feed.querySelectorAll(".card").forEach((c) => {
    if (!c.dataset.filled || Math.abs(+c.dataset.i - APP.active) > 2 || (c.dataset.view && c.dataset.view !== "main")) return;
    delete c.dataset.filled; delete c.dataset.view; c.innerHTML = ""; fillCard(c, APP.seq[+c.dataset.i]); c.classList.toggle("active", +c.dataset.i === APP.active);
  }));
  await refresh(allSyms(), () => { if (APP.built && !manual) refill(); });
  lastRefresh = Date.now();
  setStatus();
  if (store.mode === "demo") { demoRules(); settleDemoPredictions(krakenRows).catch(() => {}); settleDemoChallenges(krakenRows).catch(() => {}); } // the data jobs do these for live accounts
  const keep = APP.seq[APP.active]?.sym?.key;
  if (manual || !APP.built) buildFeed({ keepKey: keep }); else refill();
  if (manual) toast("Up to date.");
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") ls.set("pl.lastOpen", new Date().toISOString());
  else if (Date.now() - lastRefresh > 60000) doRefresh(false);
});

// Nothing is ever pushed below the visible area. (Until 1.0.9 the app pushed its bottom bars down to cover a strip that
// older iPhones left under Home Screen apps; on current iOS that strip isn't drawn, so the bars' lower half - tab
// labels, sheet ends, the group page's button - was cut off. A plain strip in the app's colour is the safe trade.)
document.documentElement.style.setProperty("--gapb", "0px");

export function applyTheme() {
  const t = store.data?.settings?.theme || "dark";
  const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#0B0F14" : "#F4F6F8";
}

// ---------- boot
(async function boot() {
  document.title = CONFIG.appName;
  ls.set("pl.prevOpen", ls.get("pl.lastOpen"));
  loadCached();
  // nothing waits on the network before the first chart is drawn
  APP.catalogue = [];
  fetch("data/indicators.json").then((r) => r.json()).then((c) => (APP.catalogue = c)).catch(() => {});
  try { await init(); } catch { toast(store.error || "Couldn't start. Check your connection."); }
  // Cleaner cards (v2): candles on their own by default; moving averages and the lower panel are opt-in.
  const ch = store.data?.settings?.chart;
  if (store.data && !store.data.settings?.coinsOnly) {
    // Coins only (v3): drop stocks from watchlists; an untouched starter list becomes the top 10 coins.
    const OLD = new Set(["CRYPTO:BTC", "NSE:RELIANCE", "NSE:HDFCBANK", "NASDAQ:NVDA", "CRYPTO:XRP", "ARCA:VOO", "CRYPTO:PAXG"]);
    const wl = watchlists().map((w) => ((w.syms || []).every((x) => OLD.has(x.key)) && w.id === "w1" ? { ...w, syms: STARTER.slice() } : { ...w, syms: (w.syms || []).filter((x) => x.m === "CRYPTO") }));
    save({ watchlists: wl, settings: { ...store.data.settings, coinsOnly: 1 } }).catch(() => {});
  }
  // v5: windows in bars (20/50/100/200) become time ranges (1M/3M/3M/6M); candle size picks itself unless set.
  if (ch && "window" in ch) { const { window: w, ...rest } = store.data.settings.chart; save({ settings: { ...store.data.settings, chart: { ...rest, range: { 20: "1M", 50: "3M", 100: "3M", 200: "6M" }[w] || "3M", interval: rest.interval === "1W" ? "1W" : "auto" } } }).catch(() => {}); }
  // v6: cards open on 1 day (15-minute candles), and the move next to the name follows the time range shown.
  if (ch && !ch.v6) save({ settings: { ...store.data.settings, chart: { ...ch, range: "1D", v6: 1 } } }).catch(() => {});
  // v4: RSI and MACD panels under every chart by default.
  if (ch && ch.v2 && !ch.v4) save({ settings: { ...store.data.settings, chart: { ...ch, lower: "RSI,MACD", v4: 1 } } }).catch(() => {});
  if (ch && !ch.v2) save({ settings: { ...store.data.settings, chart: { ...ch, type: "candles", mas: [], lower: "RSI,MACD", v2: 1, v4: 1 } } }).catch(() => {});
  applyTheme();
  initPages();
  initSocial();
  initPlay();
  initYou();
  store.on((what) => {
    $("alertDot").hidden = !store.alerts.some((a) => !a.read);
    if (what === "account") { applyTheme(); APP.needsRebuild = true; if (pageOpen("sDash")) keepScroll("dash"); if (store.ready && needsOnboarding() && !onboarding()) startOnboarding(); }
    if (what === "alerts" && pageOpen("sDash")) keepScroll("dash");
    if (what === "preds" && APP.tab === "feed" && APP.built) redrawCards(); else if (what === "preds") APP.needsRebuild = true; // cards show calls waiting and draw them on the chart
    // Calls, You and Your record follow new and scored calls, and your name or score changing
    if ((what === "preds" || what === "account") && $("sheet").hidden) { if (APP.tab === "play") keepScroll("play"); if (APP.tab === "you") keepScroll("you"); if (pageOpen("sRecord")) keepScroll("record"); }
    badge();
  });
  $("alertDot").hidden = !store.alerts.some((a) => !a.read);
  buildFeed();
  const named = new Promise((r) => startOnboarding(r)); // a new account is made first (welcome, username, first call)
  if (/^#\/(g\/|predict)/.test(location.hash)) named.then(() => openLink()); // a group's invite link, or a push about a challenge
  addEventListener("hashchange", () => { if (/^#\/(g\/|predict)/.test(location.hash)) named.then(() => openLink()); });
  await doRefresh(false);
  startOfflineCopy();
  await named;
  // the guide, once per account: accounts made before it existed see it on their next open (new ones see it after
  // their first call, from onboard.js). Waits briefly for the account so one that has seen it elsewhere isn't shown it.
  if (store.data?.username && !guideSeen() && !location.hash) { await Promise.race([connected(), new Promise((r) => setTimeout(r, 4000))]); if (store.data?.username && !guideSeen() && !onboarding()) openGuide(); }
  swipeHint();
  setTimeout(() => ls.set("pl.lastOpen", new Date().toISOString()), 4000);
  loadSymbols().catch(() => {});
})();
// ---------- the offline copy of the app (sw.js) and new releases
// Off on plain http, except the release test (tests/sw.py) on this computer.
const SW = "serviceWorker" in navigator && (location.protocol === "https:" || (CONFIG.swTest && location.hostname === "localhost"));
// Started once the first prices are in (boot), so its download of every app file never competes with them on a slow
// connection. An installed copy is asked about a new release at the same moment: the browser's own check comes only
// seconds later, and a release found sooner shows sooner.
function startOfflineCopy() {
  if (!SW) return;
  navigator.serviceWorker.register("sw.js" + (CONFIG.firebase ? "?config=" + encodeURIComponent(JSON.stringify(CONFIG.firebase)) : ""))
    .then((r) => { if (r.active) return r.update(); }).catch(() => {});
}
if (SW) {
  // A new release took over. A Home Screen app is usually resumed rather than restarted, so it could run an old
  // version for days: reload at once if the app has just opened or come back to the front and hasn't been touched
  // yet (nothing is lost: everything is saved). Once someone is using it, never pull the screen away from them:
  // offer Update, and apply it anyway the next time the app comes back to the front.
  const hadController = !!navigator.serviceWorker.controller;
  let frontSince = performance.now(), touched = false, updateReady = false;
  for (const ev of ["pointerdown", "keydown", "wheel"]) addEventListener(ev, () => (touched = true), { capture: true, passive: true });
  const toFront = () => { frontSince = performance.now(); touched = false; };
  const reloadNow = () => {
    const last = +sessionStorage.getItem("pl.swReload") || 0;
    if (Date.now() - last < 20000) return false; // never loop
    sessionStorage.setItem("pl.swReload", Date.now()); location.reload(); return true;
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    updateReady = true;
    if (!touched && performance.now() - frontSince < 10000 && reloadNow()) return;
    toast("A new version of the app is ready.", { action: "Update", onAction: () => location.reload(), ms: 10 * 60e3 });
  });
  // every time the app comes back to the front: apply a release that's waiting, or check for one
  const check = () => navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    toFront();
    if (updateReady && reloadNow()) return;
    check();
  });
  addEventListener("pageshow", (e) => { if (e.persisted) { toFront(); check(); } });
}
