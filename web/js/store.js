// Account and storage. No personal data: an account is this device's anonymous Firebase sign-in, and its
// Firestore document is accounts/{uid}, readable and writable only by that sign-in.
// Without a Firebase config the app runs in demo mode and keeps everything in this browser.
import { CONFIG } from "../config.js";
import { HORIZONS, checkPrediction, canPredict, profileScore, dueAt, relabel } from "./score.js";
import { settle, rowCache, SETTLE_DELAY } from "./predict.js";

const FB = "https://www.gstatic.com/firebasejs/10.14.1/";
const LS = { code: "pl.code", out: "pl.signedOut", demo: "pl.demoAccount", demoAlerts: "pl.demoAlerts", demoLists: "pl.demoLists", hidden: "pl.hidden", demoPreds: "pl.demoPreds", preds: "pl.preds" };
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
export const DEFAULT_CHART = { range: "1D", v6: 1, interval: "auto", type: "candles", mas: [], lower: "RSI,MACD", feed: "", levels: "off", order: "watchlist" };
export const DEFAULT_ACCOUNT = () => ({
  v: 2, createdAt: new Date().toISOString(),
  watchlists: [{ id: "w1", name: "My watchlist", syms: STARTER.slice() }],
  rules: [], settings: { theme: "dark", list: "all", chart: { ...DEFAULT_CHART } }, lists: [], fcm: [],
  following: [], groups: [], public: false, pickDefault: "counts", // people followed, group ids, leaderboard opt-in, group picks count by default
});

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const randomId = (n = 24) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => B32[x & 31]).join("").toLowerCase();

const listeners = new Set();
export const store = {
  mode: CONFIG.firebase ? "live" : "demo",
  id: null, code: null, data: null, alerts: [], lists: new Map(),
  preds: [], results: [], // prediction game: open predictions, and scored or voided ones
  ready: false, error: null,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(what) { listeners.forEach((fn) => fn(what)); },
};

let fb = null; // { db, auth, f: firestore module, unsubs: [] }
export const fbx = () => fb; // for social.js, once connected

// One sign-in for the whole app, however many callers ask at once (a second initializeApp would throw).
let fbLoading = null;
const loadFirebase = () => (fb ? Promise.resolve(fb) : (fbLoading ||= startFirebase().catch((e) => { fbLoading = null; throw e; })));
async function startFirebase() {
  const [{ initializeApp }, authMod, f] = await Promise.all([
    import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js"),
  ]);
  const app = initializeApp(CONFIG.firebase);
  const auth = authMod.getAuth(app), db = f.getFirestore(app);
  // Tests only (tests/live.py): the local Firebase emulators, with the same firestore.rules. Never set in config.js.
  if (EMU) { authMod.connectAuthEmulator(auth, `http://${EMU.host}:${EMU.auth}`, { disableWarnings: true }); f.connectFirestoreEmulator(db, EMU.host, EMU.firestore); }
  // Wait for this browser's saved sign-in to load before deciding anything: signing in straight away made a brand-new
  // anonymous account on every visit, so people lost their predictions and their username after a refresh.
  await auth.authStateReady();
  if (!auth.currentUser) await authMod.signInAnonymously(auth);
  fb = { app, auth, authMod, db, f, unsubs: [] };
  return fb;
}

// Plain HTTPS reads and writes for the steps a person waits on (opening the account, creating it, logging in). The
// database's live connection can take many seconds to open on a phone (since 1.0.1 the username check avoided it for
// that reason); one HTTPS request answers in well under a second. The live connection still runs in the background
// and keeps everything in sync once it's up. Same rules apply: each request carries this phone's sign-in.
const EMU = CONFIG.emulator || null;
const docsUrl = () => `${EMU ? `http://${EMU.host}:${EMU.firestore}` : "https://firestore.googleapis.com"}/v1/projects/${CONFIG.firebase.projectId}/databases/(default)/documents`;
const docName = (path) => `projects/${CONFIG.firebase.projectId}/databases/(default)/documents/${path}`;
async function rest(method, url, body, ms = 7000) {
  const token = await within(fb.auth.currentUser.getIdToken(), 5000).catch((e) => { throw e.message === "timeout" ? new Error("timeout: the sign-in server didn't answer") : e; });
  const r = await within(fetch(url, { method, headers: { authorization: "Bearer " + token, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }), ms).catch((e) => { throw e.message === "timeout" ? new Error("timeout: the database didn't answer") : e; });
  if (r.status === 404 && method === "GET") return null;
  if (!r.ok) {
    const j = await r.json().catch(() => ({})), e = new Error(j.error?.message || `http ${r.status}`);
    e.code = j.error?.status === "PERMISSION_DENIED" ? "permission-denied" : j.error?.status || String(r.status);
    throw e;
  }
  return r.json();
}
const toFS = (v) => v == null ? { nullValue: null } : typeof v === "boolean" ? { booleanValue: v } : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === "string" ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.filter((x) => x !== undefined).map(toFS) } }
  : { mapValue: { fields: fieldsOf(v) } };
const fieldsOf = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toFS(x)]));
const fromFS = (v) => "stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? v.doubleValue : "booleanValue" in v ? v.booleanValue
  : "timestampValue" in v ? v.timestampValue : "mapValue" in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromFS(x)]))
  : "arrayValue" in v ? (v.arrayValue.values || []).map(fromFS) : null;
// a document's fields as a plain object, or null when there's no such document
const restGet = async (path) => { const d = await rest("GET", `${docsUrl()}/${path}`); return d ? fromFS({ mapValue: { fields: d.fields || {} } }) : null; };
// several writes that all happen or none do (what the app's transactions did)
const restCommit = (writes) => rest("POST", `${docsUrl()}:commit`, { writes });
const setW = (path, data, { mask, exists } = {}) => ({ update: { name: docName(path), fields: fieldsOf(data) }, ...(mask ? { updateMask: { fieldPaths: Object.keys(data) } } : {}), ...(exists != null ? { currentDocument: { exists } } : {}) });
const denied = (e) => /permission|insufficient/i.test(e.code || e.message || "");

// Start instantly: the feed draws from the copy saved on this phone (or the starter account on a first visit)
// while Firebase signs in and loads the account in the background. No recovery code: an account belongs to this
// device's anonymous sign-in, which Firebase keeps between visits.
const LSACC = "pl.account", LSALERTS = "pl.accountAlerts", LSLINK = "pl.linked";
let pending = {}, connecting = null;
export async function init() {
  if (store.mode === "demo") {
    store.data = ls.get(LS.demo);
    if (!store.data) { store.data = DEFAULT_ACCOUNT(); ls.set(LS.demo, store.data); }
    store.alerts = ls.get(LS.demoAlerts, []);
    for (const l of ls.get(LS.demoLists, [])) store.lists.set(l.id, l);
    ({ open: store.preds = [], results: store.results = [] } = ls.get(LS.demoPreds, {}));
    store.id = "demo"; store.ready = true; store.emit("all");
    return { onboarding: false };
  }
  store.data = { ...DEFAULT_ACCOUNT(), ...(ls.get(LSACC) || {}) };
  store.alerts = ls.get(LSALERTS, []);
  ({ open: store.preds = [], results: store.results = [] } = ls.get(LS.preds, {}));
  store.results = store.results.map(relabel);
  store.ready = true;
  navigator.storage?.persist?.().catch(() => {}); // ask the browser to keep this site's storage (and so the sign-in)
  connecting = connect();
  return { onboarding: false };
}
export const connected = () => connecting || Promise.resolve();
async function connect() {
  try { await loadFirebase(); } catch (e) { store.error = "Couldn't reach the server. Your changes are saved on this phone."; store.emit("error"); return; }
  const { db, f, auth } = fb;
  if (signedOut()) { store.data = DEFAULT_ACCOUNT(); store.emit("account"); return; } // the welcome screen is up
  // an account this phone logged into by username comes first; if it's gone, the phone's own sign-in is used
  let id = auth.currentUser.uid, data;
  const OFF = Symbol("offline"), read = (path) => restGet(path).catch((e) => (denied(e) ? "gone" : OFF));
  const linked = ls.get(LSLINK);
  if (linked && linked !== id) {
    const d = await read(`accounts/${linked}`);
    if (d === OFF) return; // offline: keep the saved copy
    if (d && d !== "gone") { id = linked; data = d; } else ls.del(LSLINK);
  }
  if (data === undefined) { data = await read(`accounts/${id}`); if (data === OFF || data === "gone") return; }
  if (store.id && store.id !== id) return; // a username login on this phone finished first
  const ref = f.doc(db, "accounts", id);
  if (data) {
    // fields from older versions of the app (indicator picks now live in settings.chart) are dropped once
    const OLD = ["indicators", "customIndicators", "recovery"], { indicators, customIndicators, recovery, ...cur } = data;
    store.data = { ...DEFAULT_ACCOUNT(), ...cur, ...pending };
    const tidy = Object.fromEntries(OLD.filter((k) => k in data).map((k) => [k, f.deleteField()]));
    if (Object.keys(pending).length || Object.keys(tidy).length) await f.setDoc(ref, { ...pending, ...tidy }, { merge: true }).catch(() => {});
  } else {
    // No account yet: nothing is written until the username is chosen (see createAccount), so opening the app,
    // or a browser that can't keep its sign-in, never leaves empty accounts behind.
    // (a name cached on this phone from an older account doesn't belong to this one)
    const { username, usernameChanges, pscore, ...rest } = store.data || {};
    store.data = { ...DEFAULT_ACCOUNT(), ...rest }; ls.set(LSACC, store.data);
    newId = id; store.emit("account"); return;
  }
  attach(id, ref);
}
let newId = null;
// Writes the account the first time, from what this phone has, when its owner chooses a username.
async function createAccount() {
  const { db, f } = fb, ref = f.doc(db, "accounts", newId);
  const { username, usernameChanges, pscore, ...first } = { ...store.data, ...pending };
  await restCommit([setW(`accounts/${newId}`, first)]);
  STARTER.forEach((s) => noteFollow(s));
  attach(newId, ref); newId = null;
}
function attach(id, ref) {
  const { db, f } = fb;
  pending = {};
  store.id = id;
  ls.set(LSACC, store.data);
  fb.unsubs.forEach((u) => u()); fb.unsubs = [];
  // A username is never taken away by a late update: the server's copy of the account's first save (made just before
  // the name is added) can arrive after the name, and used to send a new player back to the welcome screen (live
  // tests, 17 Oct 2026). Names can't be removed anyway (firestore.rules).
  fb.unsubs.push(f.onSnapshot(ref, (s) => {
    if (!s.exists()) return;
    const d = s.data(), keep = !d.username && store.data?.username && store.id === id ? { username: store.data.username, usernameChanges: store.data.usernameChanges || 0 } : {};
    store.data = { ...DEFAULT_ACCOUNT(), ...d, ...keep }; ls.set(LSACC, store.data); store.emit("account"); watchLists();
  }));
  fb.unsubs.push(f.onSnapshot(f.query(f.collection(db, "accounts", id, "alerts"), f.orderBy("at", "desc"), f.limit(200)), (q) => {
    store.alerts = q.docs.map((d) => ({ id: d.id, ...d.data() })); ls.set(LSALERTS, store.alerts.slice(0, 50)); store.emit("alerts");
  }));
  // prediction game: open predictions, and the latest scored or voided ones (the data job writes those)
  const rows = (q) => q.docs.map((d) => ({ id: d.id, ...isoDates(d.data({ serverTimestamps: "estimate" })) }));
  const keepPreds = () => { ls.set(LS.preds, { open: store.preds, results: store.results.slice(0, 100) }); store.emit("preds"); };
  fb.unsubs.push(f.onSnapshot(f.collection(db, "accounts", id, "predictions"), (q) => { store.preds = rows(q); keepPreds(); }, () => {}));
  fb.unsubs.push(f.onSnapshot(f.query(f.collection(db, "accounts", id, "results"), f.orderBy("resolvedAt", "desc"), f.limit(300)), (q) => { store.results = rows(q).map(relabel); keepPreds(); }, () => {}));
  watchLists();
  store.emit("account");
}

// Firestore timestamps as ISO strings, the way the rest of the app (and the data job) reads them
export function isoDates(x) { for (const k in x) if (x[k]?.toDate) x[k] = x[k].toDate().toISOString(); return x; }

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

export async function save(patch) {
  store.data = { ...store.data, ...patch };
  store.emit("account");
  if (store.mode === "demo") { ls.set(LS.demo, store.data); return; }
  ls.set(LSACC, store.data);
  if (!store.id) { pending = { ...pending, ...patch }; return; } // written once the account has loaded
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

// Signing out keeps this phone's own sign-in (as 1.1.4 did) and shows the welcome screen until someone logs in.
// 1.2.0 threw the sign-in away instead, so every sign-out and log-in added a new entry to the account's devices,
// and the account hit the old 10-device limit (17 Oct 2026). A new sign-in is made only to create a new account.
export function signOutDevice() {
  ls.set(LS.out, 1);
  if (store.mode !== "demo") { ls.del(LS.code); ls.del(LSACC); ls.del(LSALERTS); ls.del(LS.preds); ls.del(LSLINK); }
  location.hash = ""; location.reload();
}
export const signedOut = () => !!ls.get(LS.out);

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
// Whether a name is free (or already this account's). Demo mode has no other users.
// gives up after ms, so a slow or stuck network never leaves a spinner on screen
const within = (p, ms = 8000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);
export async function usernameFree(name) {
  if (store.mode === "demo") return "free";
  // only needs the sign-in, not the whole account load. One plain HTTPS read: the database's live connection can take
  // seconds to open on a phone's first visit, and the person is waiting on this answer while they type.
  await within(loadFirebase());
  let acct;
  try {
    const token = await within(fb.auth.currentUser.getIdToken(), 5000);
    const r = await within(fetch(`${docsUrl()}/usernames/${encodeURIComponent(name)}?mask.fieldPaths=acct`, { headers: { authorization: "Bearer " + token } }), 5000);
    if (r.status === 404) acct = null;
    else if (r.ok) acct = (await r.json()).fields?.acct?.stringValue ?? null;
    else throw new Error("http " + r.status);
  } catch { // fall back to the database connection
    const d = await within(fb.f.getDoc(fb.f.doc(fb.db, "usernames", name)));
    acct = d.exists() ? d.data().acct : null;
  }
  // a name can also be free again if the account that held it no longer exists; the save finds out
  return !acct || acct === store.id ? "free" : "held";
}
// Log in by username (MVP: the username alone opens the account; a password or Google sign-in comes later).
// This phone's sign-in is added to the account's devices, and the rules let any listed device use the account.
// A name whose account no longer exists is claimed for this phone instead, as a new username.
export async function loginUsername(raw, step = () => {}) {
  const { name, error } = checkUsername(raw);
  if (error) throw new Error(error);
  if (store.mode === "demo") { if (!store.data?.username || store.data.username !== name) throw new Error(`There's no account called @${name}. Check the spelling, or go back and create it.`); ls.del(LS.out); store.emit("account"); return name; }
  // only the sign-in is needed, not the account load that may still be running; every step gives up in time
  const go = async (label, p, ms = 12000) => { step(label); const t0 = Date.now(); try { return await within(p, ms); } catch (e) { if (/^timeout/.test(e.message)) throw new Error(`${label} took too long (${e.message.slice(9) || "no answer"} after ${Math.round((Date.now() - t0) / 1000)} s). Check your connection and tap again.`); throw e; } };
  await go("Signing in", loadFirebase());
  const { db, f, auth } = fb, me = auth.currentUser.uid;
  // plain HTTPS requests: each answers in under a second, where the live connection can take many seconds to open
  const u = await go(`Finding @${name}`, restGet(`usernames/${name}`));
  if (!u?.acct) throw new Error(`There's no account called @${name}. Check the spelling, or go back and create it.`);
  const acct = u.acct, ref = f.doc(db, "accounts", acct), path = `accounts/${acct}`;
  // this phone may already be on the account (it made it, or logged in before): then it simply opens
  let data = await go("Opening your account", restGet(path).catch((e) => (denied(e) ? "locked" : Promise.reject(e))));
  if (data === "locked") {
    try { await go("Adding this phone to the account", restCommit([{ transform: { document: docName(path), fieldTransforms: [{ fieldPath: "devices", appendMissingElements: { values: [{ stringValue: me }] } }] }, currentDocument: { exists: true } }])); }
    catch (e) { if (denied(e)) throw new Error(`The server wouldn't add this phone to @${name}'s account (${e.message.slice(0, 80)}). Nothing was changed.`); throw e; }
    data = await go("Opening your account", restGet(path));
  }
  if (!data) throw new Error(`@${name}'s account no longer exists. Go back and create a new account.`);
  ls.del(LS.out);
  ls.set(LSLINK, acct); newId = null;
  store.data = { ...DEFAULT_ACCOUNT(), ...data };
  attach(acct, ref);
  return name;
}
// A brand-new sign-in on this phone, for a new account after signing out of another one.
async function freshSignIn() {
  try { await within(loadFirebase(), 12000); } catch { throw new Error("Couldn't reach the server. Check your connection and tap again."); }
  fb.unsubs.forEach((u) => u()); fb.unsubs = [];
  await within(fb.auth.signOut().then(() => fb.authMod.signInAnonymously(fb.auth)), 12000).catch(() => { throw new Error("Couldn't reach the server. Check your connection and tap again."); });
  store.id = null; newId = fb.auth.currentUser.uid; pending = {}; store.data = DEFAULT_ACCOUNT(); store.preds = []; store.results = [];
  ls.del(LSLINK); ls.del(LS.out); connecting = Promise.resolve();
}
export async function setUsername(raw) {
  const { name, error } = checkUsername(raw);
  if (error) throw new Error(error);
  if (store.mode === "demo" && ls.get(LS.out)) { ls.del(LS.out); ls.del(LS.demoPreds); store.data = DEFAULT_ACCOUNT(); store.preds = []; store.results = []; }
  if (store.mode !== "demo" && ls.get(LS.out)) await freshSignIn(); // this phone's sign-in may already own an account
  const old = store.data?.username || null;
  if (old === name) return name;
  if (usernameChangesLeft() <= 0) throw new Error("You've used all your username changes.");
  const changes = (store.data.usernameChanges || 0) + (old ? 1 : 0);
  if (store.mode === "demo") { await save({ username: name, usernameChanges: changes }); return name; }
  try { await within(connected(), 12000); } catch { throw new Error("Couldn't reach the server. Check your connection and tap again."); }
  if (!store.id && newId) await createAccount();
  if (!store.id) throw new Error("Couldn't reach the server. Try again in a moment.");
  // the name, the old name's release and the account all change together, or none do; the rules decide whether a
  // name held by someone else can be taken
  try {
    await restCommit([
      setW(`usernames/${name}`, { acct: store.id, at: new Date().toISOString() }),
      ...(old ? [{ delete: docName(`usernames/${old}`) }] : []),
      setW(`accounts/${store.id}`, { username: name, usernameChanges: changes }, { mask: true, exists: true }),
    ]);
  } catch (e) {
    if (denied(e)) throw new Error("That username is taken. Try another.");
    if (e.message === "timeout") throw new Error("The server took too long to answer. Check your connection and tap again.");
    throw e;
  }
  store.data = { ...store.data, username: name, usernameChanges: changes };
  store.emit("account");
  return name;
}

// ---- prediction game. One open prediction per coin and period; it can't be changed or cancelled once made.
const PERIOD = (h) => HORIZONS[h].label.replace(/^1 /, "");
// group: { g, c, endAt } when the prediction is also a group pick (demo mode only; live ones go in social.js's batch)
export async function makePrediction({ sym, horizon, target, p0, sigmaD, group = null, sure = null, basis = null, pub = null }) {
  if (!canPredict(store.preds, sym.key, horizon)) throw new Error(`You already have an open ${PERIOD(horizon)} call on ${sym.t}.`);
  const chk = checkPrediction({ horizon, p0, target, sigmaD });
  if (!chk.ok) throw new Error(chk.error);
  const doc = { coin: sym.key, t: sym.t, horizon, target, clientP0: p0, clientSigma: sigmaD, ...(sure ? { sure } : {}), ...(basis ? { basis } : {}), ...(pub != null ? { pub } : {}) };
  if (store.mode === "demo") {
    store.preds = [...store.preds, { id: `${sym.t}_${horizon}`, ...doc, ...(group || {}), createdAt: new Date().toISOString() }];
    saveDemoPreds(); return;
  }
  await connected();
  if (!store.id) throw new Error("Couldn't reach the server. Try again in a moment.");
  const write = (d) => fb.f.setDoc(fb.f.doc(fb.db, "accounts", store.id, "predictions", `${sym.t}_${horizon}`), { ...d, createdAt: fb.f.serverTimestamp() });
  try { await write(doc); return; }
  catch (e) { if (e?.code !== "permission-denied") throw new Error("Couldn't save the call. Check your connection and try again."); }
  // Refused. Database rules from before 1.2.0 don't know "how sure", "based on" or "public": the call is saved without
  // them rather than lost (they're kept once the 1.2.0 rules are published).
  if (sure || basis || pub != null) {
    const { sure: _s, basis: _b, pub: _p, ...plain } = doc;
    try { await write(plain); return; } catch { /* refused for another reason */ }
  }
  // Only say "already open" when that's what the server can mean: a call on this coin and period from another phone.
  throw new Error(`Couldn't save the call. If you made a ${PERIOD(horizon)} call on ${sym.t} on another phone, it's still open; otherwise try again.`);
}
// "How sure" and "based on", added to a call just after it's locked in (the step after Lock in; both optional).
export async function addCallDetails({ sym, horizon, sure = null, basis = null }) {
  const extra = { ...(sure ? { sure } : {}), ...(basis ? { basis } : {}) };
  if (!Object.keys(extra).length) return;
  const id = `${sym.t}_${horizon}`;
  if (store.mode === "demo") { store.preds = store.preds.map((p) => (p.id === id && p.actual == null ? { ...p, ...extra } : p)); saveDemoPreds(); return; }
  await fb.f.updateDoc(fb.f.doc(fb.db, "accounts", store.id, "predictions", id), extra);
}
function saveDemoPreds() { ls.set(LS.demoPreds, { open: store.preds, results: store.results }); store.emit("preds"); }
// Demo mode settles predictions on the phone, the same way the data job does for live accounts.
export async function settleDemoPredictions(fetchRows) {
  if (store.mode !== "demo" || !store.preds.length) return 0;
  const rows = rowCache(fetchRows), keep = [], done = [];
  for (const p of store.preds) {
    let r; try { r = await settle(p, { rows }); } catch { keep.push(p); continue; }
    if (r.status === "open") keep.push({ ...p, ...r.patch }); else done.push({ ...p, ...r.patch, id: `${p.id}_${Date.parse(p.createdAt)}` });
  }
  store.preds = keep; store.results = [...done, ...store.results];
  saveDemoPreds();
  return done.length;
}
// Scored here, the moment it's due: a live prediction is scored on the phone with the same code and the same Kraken
// prices the data job uses, so the result and the score show at once; the job's copy replaces it within minutes.
export const scoredHere = new Map(); // prediction key → the prediction with its result
// The same moment can arrive written two ways: to the millisecond from the phone ("…:12.345Z") and to the microsecond
// (or with no fraction) from the server ("…:12.345678Z", "…:12Z"). Compared as written, a call scored on the phone
// never matched its server copy and was counted twice (live tests, 17 Oct 2026). So the key uses the millisecond.
const msOf = (s) => String(s || "").replace(/(:\d\d)(?:\.(\d+))?Z$/, (_, sec, f = "") => `${sec}.${(f + "000").slice(0, 3)}Z`);
const keyOf = (p) => `${p.t}_${p.horizon}_${msOf(p.createdAt)}`;
// Calls scored here whose server copy hasn't arrived yet. Once it's in results, the phone's copy goes, so a call is
// never listed or counted twice (feedback, 16 Oct: the same DOGE call showed twice, once "confirming").
export function pendingHere() {
  const done = new Set(store.results.map(keyOf));
  for (const k of [...scoredHere.keys()]) if (done.has(k)) scoredHere.delete(k);
  return [...scoredHere.values()];
}
let settling = false;
export async function settleHere(fetchRows, now = Date.now()) {
  if (store.mode === "demo") return settleDemoPredictions(fetchRows);
  const open = new Set(store.preds.map(keyOf));
  for (const k of scoredHere.keys()) if (!open.has(k)) scoredHere.delete(k); // the data job has moved it to results
  const due = store.preds.filter((p) => !scoredHere.has(keyOf(p)) && now >= Date.parse(dueAt(p)) + SETTLE_DELAY);
  if (!due.length || settling) return 0;
  settling = true;
  const rows = rowCache(fetchRows); let n = 0; // fresh prices on every pass
  try {
    for (const p of due) {
      let r; try { r = await settle(p, { now, rows }); } catch { continue; }
      if (r.status === "open") continue; // its closing price isn't out yet: next pass
      scoredHere.set(keyOf(p), { ...p, ...r.patch, status: r.status, resolvedAt: r.patch.resolvedAt || new Date(now).toISOString(), here: true }); n++;
    }
  } finally { settling = false; }
  if (n) store.emit("preds");
  return n;
}
// When the next open prediction is due (ms), to wake up for it.
export const nextDue = () => Math.min(Infinity, ...store.preds.map((p) => Date.parse(dueAt(p)) + SETTLE_DELAY));

// The profile score: written by the data job for live accounts, worked out on the phone in demo mode, and on the phone
// straight away when a prediction has just been scored here (the job writes the same number a few minutes later).
export function myScore() {
  const here = pendingHere().filter((r) => r.status === "scored");
  if (store.mode !== "demo" && here.length && store.results.length < 300) {
    const ps = profileScore([...store.results.filter((r) => r.status === "scored"), ...here]);
    if (ps.score != null) return { score: ps.score, band: ps.band, provisional: ps.provisional, n: ps.n, here: true };
  }
  if (store.mode !== "demo") return store.data?.pscore || null;
  const ps = profileScore(store.results.filter((r) => r.status === "scored"));
  return ps.score == null ? null : { score: ps.score, band: ps.band, provisional: ps.provisional, n: ps.n };
}

// beforeDelete: leaves groups and the like first (social.js), while the account still exists to prove membership
export async function deleteAccount(beforeDelete = async () => {}, afterDelete = async () => {}) {
  if (store.mode === "demo") { [LS.demo, LS.demoAlerts, LS.demoLists, LS.hidden, LS.demoPreds, "pl.demoSocial"].forEach(ls.del); location.reload(); return; }
  await beforeDelete();
  for (const l of store.data.lists || []) await leaveList(l.id);
  await clearAlerts();
  if (store.data?.username) { const b = fb.f.writeBatch(fb.db); b.delete(fb.f.doc(fb.db, "usernames", store.data.username)); b.delete(fb.f.doc(fb.db, "accounts", store.id)); await b.commit(); }
  else await fb.f.deleteDoc(fb.f.doc(fb.db, "accounts", store.id));
  // predictions and results can be removed only once the account is gone (so results can't be picked over)
  for (const [coll, list] of [["predictions", store.preds], ["results", store.results]]) for (const p of list) await fb.f.deleteDoc(fb.f.doc(fb.db, "accounts", store.id, coll, p.id)).catch(() => {});
  await afterDelete().catch(() => {});
  await fb.authMod.signOut(fb.auth).catch(() => {}); // the next visit starts a brand-new anonymous account
  signOutDevice();
}

// ---------- feedback: anyone can add a note; only admins (a document in /admins with their sign-in id) can read them
const LSFB = "pl.demoFeedback";
const fbNow = () => new Date().toISOString();
export async function sendFeedback(item) {
  const doc = { text: String(item.text).slice(0, 1000), where: String(item.where || "").slice(0, 200), screen: String(item.screen || "").slice(0, 120),
    coin: item.coin || null, detail: String(item.detail || "").slice(0, 200), ctx: item.ctx || {}, status: "open" };
  if (store.mode === "demo") { const l = ls.get(LSFB, []); l.unshift({ ...doc, id: randomId(10), uid: "demo", createdAt: fbNow() }); ls.set(LSFB, l.slice(0, 300)); return; }
  await connected();
  if (!fb) throw new Error("offline");
  await fb.f.addDoc(fb.f.collection(fb.db, "feedback"), { ...doc, uid: fb.auth.currentUser.uid, createdAt: fb.f.serverTimestamp() });
}
export async function isAdmin() {
  if (store.mode === "demo") return true;
  await connected();
  try { return !!fb && (await fb.f.getDoc(fb.f.doc(fb.db, "admins", fb.auth.currentUser.uid))).exists(); } catch { return false; }
}
export async function listFeedback() {
  if (store.mode === "demo") return ls.get(LSFB, []);
  const { f, db } = fb, q = await f.getDocs(f.query(f.collection(db, "feedback"), f.orderBy("createdAt", "desc"), f.limit(300)));
  return q.docs.map((d) => { const x = d.data(); return { ...x, id: d.id, createdAt: x.createdAt?.toDate?.().toISOString?.() || "" }; });
}
export async function setFeedbackStatus(id, status, note = "") {
  if (store.mode === "demo") { ls.set(LSFB, ls.get(LSFB, []).map((x) => (x.id === id ? { ...x, status, note, doneAt: fbNow() } : x))); return; }
  await fb.f.updateDoc(fb.f.doc(fb.db, "feedback", id), { status, note: String(note).slice(0, 500), doneAt: fbNow() });
}
export const myUid = () => (store.mode === "demo" ? "demo" : fb?.auth?.currentUser?.uid || null);
