// Account and storage. No personal data: an account is a random recovery code; its SHA-256 is the
// Firestore document id. Firebase anonymous sign-in only proves a request comes from the app.
// Without a Firebase config the app runs in demo mode and keeps everything in this browser.
import { CONFIG } from "../config.js";

const FB = "https://www.gstatic.com/firebasejs/10.14.1/";
const LS = { code: "pl.code", demo: "pl.demoAccount", demoAlerts: "pl.demoAlerts", demoLists: "pl.demoLists", hidden: "pl.hidden" };
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
export { ls };

// Starter list: the 10 largest coins by market cap (CoinPaprika, Oct 2026), leaving out stablecoins and wrapped or staked copies.
export const STARTER = [{ key: "CRYPTO:BTC", t: "BTC", n: "Bitcoin", m: "CRYPTO", ty: "C" }, { key: "CRYPTO:ETH", t: "ETH", n: "Ethereum", m: "CRYPTO", ty: "C" }, { key: "CRYPTO:BNB", t: "BNB", n: "BNB", m: "CRYPTO", ty: "C" }, { key: "CRYPTO:XRP", t: "XRP", n: "XRP", m: "CRYPTO", ty: "C" }, { key: "CRYPTO:SOL", t: "SOL", n: "Solana", m: "CRYPTO", ty: "C" }, { key: "CRYPTO:TRX", t: "TRX", n: "TRON", m: "CRYPTO", ty: "C" }, { key: "CRYPTO:ZEC", t: "ZEC", n: "Zcash", m: "CRYPTO", ty: "C" }, { key: "CRYPTO:HYPE", t: "HYPE", n: "Hyperliquid", m: "CRYPTO", ty: "C" }, { key: "CRYPTO:DOGE", t: "DOGE", n: "Dogecoin", m: "CRYPTO", ty: "C" }, { key: "CRYPTO:LINK", t: "LINK", n: "Chainlink", m: "CRYPTO", ty: "C" }];
// Chart settings for one coin: the person's defaults, then anything they set for that coin from its card.
export const chartSettings = (key) => ({ ...DEFAULT_CHART, ...(store.data?.settings?.chart || {}), ...((key && store.data?.settings?.chartBy?.[key]) || {}) });
export const DEFAULT_CHART = { range: "3M", interval: "auto", type: "candles", mas: [], lower: "RSI,MACD", levels: "off", order: "watchlist" };
export const DEFAULT_ACCOUNT = () => ({
  v: 2, createdAt: new Date().toISOString(),
  watchlists: [{ id: "w1", name: "My watchlist", syms: STARTER.slice() }],
  indicators: { added: ["ma", "rsi", "macd", "bb", "range50", "volume"], active: ["ma", "rsi", "macd", "volume"] },
  rules: [], settings: { theme: "dark", list: "all", chart: { ...DEFAULT_CHART } }, lists: [], fcm: [],
});

// Crockford base32, 30 characters = 150 random bits, shown as 6 groups of 5.
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(30));
  const s = [...b].map((x) => B32[x & 31]).join("");
  return s.match(/.{5}/g).join("-");
}
export const normCode = (c) => String(c || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const randomId = (n = 24) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => B32[x & 31]).join("").toLowerCase();

const listeners = new Set();
export const store = {
  mode: CONFIG.firebase ? "live" : "demo",
  id: null, code: null, data: null, alerts: [], lists: new Map(), explain: new Map(), indDocs: new Map(), moves: new Map(),
  ready: false, error: null,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(what) { listeners.forEach((fn) => fn(what)); },
};

let fb = null; // { db, auth, f: firestore module, unsubs: [] }

async function loadFirebase() {
  if (fb) return fb;
  const [{ initializeApp }, authMod, f] = await Promise.all([
    import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js"),
  ]);
  const app = initializeApp(CONFIG.firebase);
  const auth = authMod.getAuth(app);
  await authMod.signInAnonymously(auth);
  fb = { app, auth, db: f.getFirestore(app), f, unsubs: [] };
  return fb;
}

export async function init() {
  const code = ls.get(LS.code);
  if (store.mode === "demo") {
    store.data = ls.get(LS.demo);
    if (!store.data) { store.data = DEFAULT_ACCOUNT(); ls.set(LS.demo, store.data); }
    store.alerts = ls.get(LS.demoAlerts, []);
    for (const l of ls.get(LS.demoLists, [])) store.lists.set(l.id, l);
    store.id = "demo"; store.ready = true; store.emit("all");
    return { onboarding: false };
  }
  try { await loadFirebase(); } catch (e) { store.error = "Couldn't reach the server. Check your connection."; store.emit("error"); throw e; }
  if (!code) return { onboarding: true };
  const ok = await openAccount(code);
  return { onboarding: !ok };
}

async function openAccount(code) {
  const { db, f } = fb;
  const id = await sha256hex(normCode(code));
  const snap = await f.getDoc(f.doc(db, "accounts", id));
  if (!snap.exists()) return false;
  store.id = id; store.code = code; store.data = { ...DEFAULT_ACCOUNT(), ...snap.data() };
  ls.set(LS.code, code);
  fb.unsubs.forEach((u) => u()); fb.unsubs = [];
  fb.unsubs.push(f.onSnapshot(f.doc(db, "accounts", id), (s) => { if (s.exists()) { store.data = { ...DEFAULT_ACCOUNT(), ...s.data() }; store.emit("account"); watchLists(); } }));
  fb.unsubs.push(f.onSnapshot(f.query(f.collection(db, "accounts", id, "alerts"), f.orderBy("at", "desc"), f.limit(200)), (q) => {
    store.alerts = q.docs.map((d) => ({ id: d.id, ...d.data() })); store.emit("alerts");
  }));
  watchLists();
  store.ready = true; store.emit("all");
  return true;
}

const listUnsubs = new Map();
function watchLists() {
  if (store.mode === "demo" || !fb) return;
  const want = new Set((store.data.lists || []).map((l) => l.id));
  for (const [id, u] of listUnsubs) if (!want.has(id)) { u(); listUnsubs.delete(id); store.lists.delete(id); }
  for (const id of want) if (!listUnsubs.has(id)) {
    listUnsubs.set(id, fb.f.onSnapshot(fb.f.doc(fb.db, "lists", id), (s) => {
      if (s.exists()) store.lists.set(id, { id, ...s.data() }); else store.lists.delete(id);
      store.emit("lists");
    }, () => {}));
  }
}

export async function createAccount() {
  const code = newCode();
  const { db, f } = fb;
  const id = await sha256hex(normCode(code));
  await f.setDoc(f.doc(db, "accounts", id), DEFAULT_ACCOUNT());
  ls.set(LS.code, code);
  STARTER.forEach((s) => noteFollow(s));
  await openAccount(code);
  return code;
}

export async function restore(code) {
  if (store.mode === "demo") return false;
  return openAccount(code);
}

export async function save(patch) {
  store.data = { ...store.data, ...patch };
  store.emit("account");
  if (store.mode === "demo") { ls.set(LS.demo, store.data); return; }
  await fb.f.setDoc(fb.f.doc(fb.db, "accounts", store.id), patch, { merge: true });
}

// ---- watchlists. "All my coins" is every symbol in any watchlist, each once, in watchlist order.
export const watchlists = () => store.data?.watchlists || [];
export function allSyms() {
  const seen = new Set(), out = [];
  // Coins only for now: stock prices need a licensed data source before they can be shown.
  for (const w of watchlists()) for (const s of w.syms || []) if (s.m === "CRYPTO" && !seen.has(s.key)) { seen.add(s.key); out.push(s); }
  return out;
}
export const listsOf = (key) => watchlists().filter((w) => (w.syms || []).some((s) => s.key === key)).map((w) => w.id);
async function noteFollow(sym) {
  if (store.mode !== "live") return;
  // Tells the data pipeline which symbols need prices and news. Holds no account information.
  try { await fb.f.setDoc(fb.f.doc(fb.db, "follows", sym.key.replace(/[/]/g, "_")), { key: sym.key, t: sym.t, n: sym.n, m: sym.m, ty: sym.ty, at: new Date().toISOString() }); } catch {}
}
// Puts sym in exactly the watchlists in ids (adds and removes as needed).
export async function setSymLists(sym, ids) {
  const want = new Set(ids);
  const next = watchlists().map((w) => {
    const has = (w.syms || []).some((s) => s.key === sym.key);
    if (want.has(w.id) && !has) return { ...w, syms: [...(w.syms || []), sym] };
    if (!want.has(w.id) && has) return { ...w, syms: w.syms.filter((s) => s.key !== sym.key) };
    return w;
  });
  await save({ watchlists: next });
  if (ids.length) noteFollow(sym);
}
export async function newWatchlist(name) {
  const w = { id: "w" + randomId(8), name: name.trim().slice(0, 32) || "New watchlist", syms: [] };
  await save({ watchlists: [...watchlists(), w] });
  return w.id;
}
export const renameWatchlist = (id, name) => save({ watchlists: watchlists().map((w) => (w.id === id ? { ...w, name: name.slice(0, 32) } : w)) });
export const deleteWatchlist = (id) => save({ watchlists: watchlists().filter((w) => w.id !== id) });
export const moveInWatchlist = (id, key, dir) => save({ watchlists: watchlists().map((w) => {
  if (w.id !== id) return w;
  const a = w.syms.slice(), i = a.findIndex((s) => s.key === key), j = i + dir;
  if (i < 0 || j < 0 || j >= a.length) return w;
  [a[i], a[j]] = [a[j], a[i]];
  return { ...w, syms: a };
}) });

// ---- alerts
export async function markAlertsRead(ids) {
  if (store.mode === "demo") {
    store.alerts = store.alerts.map((a) => (ids.includes(a.id) ? { ...a, read: true } : a));
    ls.set(LS.demoAlerts, store.alerts); store.emit("alerts"); return;
  }
  const b = fb.f.writeBatch(fb.db);
  ids.forEach((id) => b.update(fb.f.doc(fb.db, "accounts", store.id, "alerts", id), { read: true }));
  await b.commit();
}
export async function clearAlerts() {
  if (store.mode === "demo") { store.alerts = []; ls.set(LS.demoAlerts, []); store.emit("alerts"); return; }
  const b = fb.f.writeBatch(fb.db);
  store.alerts.slice(0, 400).forEach((a) => b.delete(fb.f.doc(fb.db, "accounts", store.id, "alerts", a.id)));
  await b.commit();
}
// Demo only: the pipeline writes alerts in live mode.
export function addDemoAlerts(list) {
  store.alerts = [...list, ...store.alerts].slice(0, 200);
  ls.set(LS.demoAlerts, store.alerts); store.emit("alerts");
}

// ---- shared lists. Anyone with the link can view and edit; members appear by a nickname only.
async function memberKey(listId) { return (await sha256hex((store.id || "demo") + ":" + listId)).slice(0, 16); }
export async function createList(name, nick) {
  const id = randomId(24);
  const doc = { name: name.slice(0, 40), symbols: [], members: { [await memberKey(id)]: nick.slice(0, 24) }, createdAt: new Date().toISOString() };
  if (store.mode === "demo") { store.lists.set(id, { id, ...doc }); ls.set(LS.demoLists, [...store.lists.values()]); }
  else await fb.f.setDoc(fb.f.doc(fb.db, "lists", id), doc);
  await save({ lists: [...(store.data.lists || []), { id }] });
  return id;
}
export async function joinList(id, nick) {
  if (store.mode === "demo") throw new Error("Shared lists need the live app.");
  const ref = fb.f.doc(fb.db, "lists", id);
  const s = await fb.f.getDoc(ref);
  if (!s.exists()) throw new Error("That list doesn't exist or the link is wrong.");
  await fb.f.updateDoc(ref, { [`members.${await memberKey(id)}`]: nick.slice(0, 24) });
  if (!(store.data.lists || []).some((l) => l.id === id)) await save({ lists: [...(store.data.lists || []), { id }] });
}
export async function leaveList(id) {
  if (store.mode === "live") { try { await fb.f.updateDoc(fb.f.doc(fb.db, "lists", id), { [`members.${await memberKey(id)}`]: fb.f.deleteField() }); } catch {} }
  else { store.lists.delete(id); ls.set(LS.demoLists, [...store.lists.values()]); }
  await save({ lists: (store.data.lists || []).filter((l) => l.id !== id) });
}

// ---- shared AI results (written by the AI worker, readable by everyone)
const cacheFor = (coll) => (coll === "explain" ? store.explain : coll === "moves" ? store.moves : store.indDocs);
export async function getShared(coll, id) {
  const cache = cacheFor(coll);
  if (cache.has(id)) return cache.get(id);
  if (store.mode === "demo" || !fb) return null;
  try {
    const s = await fb.f.getDoc(fb.f.doc(fb.db, coll, id));
    const v = s.exists() ? s.data() : null;
    if (v) cache.set(id, v);
    return v;
  } catch { return null; }
}
export async function getSharedMany(coll, ids) {
  await Promise.all(ids.filter((id) => !cacheFor(coll).has(id)).map((id) => getShared(coll, id)));
}

export async function callAI(path, body) {
  if (!CONFIG.workerUrl) throw new Error("AI features aren't set up yet (workerUrl in config.js).");
  if (store.mode === "demo") throw new Error("AI features need the live app (Firebase set up).");
  const token = await fb.auth.currentUser.getIdToken();
  const r = await fetch(CONFIG.workerUrl.replace(/\/$/, "") + path, {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || "The AI service didn't answer. Try again.");
  return out;
}

// ---- push alerts (Firebase Cloud Messaging over web push)
export async function enablePush() {
  if (store.mode === "demo") throw new Error("Push alerts need the live app.");
  if (!("Notification" in window) || !("serviceWorker" in navigator)) throw new Error("This browser can't receive push alerts. On iPhone, add the app to your home screen first.");
  if (!CONFIG.vapidKey) throw new Error("Push isn't set up yet (vapidKey in config.js).");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications are blocked for this site in your browser settings.");
  const m = await import(FB + "firebase-messaging.js");
  const reg = await navigator.serviceWorker.ready;
  const token = await m.getToken(m.getMessaging(fb.app), { vapidKey: CONFIG.vapidKey, serviceWorkerRegistration: reg });
  const fcm = [...new Set([...(store.data.fcm || []), token])].slice(-5);
  await save({ fcm });
  return true;
}

export function signOutDevice() {
  ls.del(LS.code);
  location.hash = "";
  location.reload();
}

// ---- username: a public display name, set once and changed at most twice more (three names in total).
// Names are unique: usernames/{name} points at the account that holds it. firestore.rules enforces the limit.
export const USERNAME_CHANGES = 2;
export const usernameChangesLeft = () => (store.data?.username ? USERNAME_CHANGES - (store.data.usernameChanges || 0) : USERNAME_CHANGES + 1);
const RESERVED = /^(admin|administrator|pulse|support|help|official|moderator|mod|team|staff|root|system|null|undefined)$/;
export function checkUsername(raw) {
  const name = String(raw || "").trim().toLowerCase().replace(/^@/, "");
  if (name.length < 3 || name.length > 20) return { name, error: "Use 3 to 20 characters." };
  if (!/^[a-z0-9_.]+$/.test(name)) return { name, error: "Use letters, numbers, dots or underscores only." };
  if (/^[._]|[._]$|\.\./.test(name)) return { name, error: "It can't start or end with a dot or underscore." };
  if (/\d{7,}/.test(name)) return { name, error: "Long runs of numbers look like phone numbers. Please pick something else." };
  if (RESERVED.test(name)) return { name, error: "That name is reserved." };
  return { name, error: null };
}
export async function setUsername(raw) {
  const { name, error } = checkUsername(raw);
  if (error) throw new Error(error);
  const old = store.data?.username || null;
  if (old === name) return name;
  if (usernameChangesLeft() <= 0) throw new Error("You've used all your username changes.");
  const changes = (store.data.usernameChanges || 0) + (old ? 1 : 0);
  if (store.mode === "demo") { await save({ username: name, usernameChanges: changes }); return name; }
  const { db, f } = fb;
  await f.runTransaction(db, async (tx) => {
    const ref = f.doc(db, "usernames", name), taken = await tx.get(ref);
    if (taken.exists() && taken.data().acct !== store.id) throw new Error("That username is taken. Try another.");
    tx.set(ref, { acct: store.id, at: new Date().toISOString() });
    if (old) tx.delete(f.doc(db, "usernames", old));
    tx.update(f.doc(db, "accounts", store.id), { username: name, usernameChanges: changes });
  });
  store.data = { ...store.data, username: name, usernameChanges: changes };
  store.emit("account");
  return name;
}

export async function deleteAccount() {
  if (store.mode === "demo") { [LS.demo, LS.demoAlerts, LS.demoLists, LS.hidden].forEach(ls.del); location.reload(); return; }
  for (const l of store.data.lists || []) await leaveList(l.id);
  await clearAlerts();
  if (store.data?.username) { const b = fb.f.writeBatch(fb.db); b.delete(fb.f.doc(fb.db, "usernames", store.data.username)); b.delete(fb.f.doc(fb.db, "accounts", store.id)); await b.commit(); }
  else await fb.f.deleteDoc(fb.f.doc(fb.db, "accounts", store.id));
  signOutDevice();
}
