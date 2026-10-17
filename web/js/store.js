// Account and storage. No personal data: an account is this device's anonymous Firebase sign-in, and its
// Firestore document is accounts/{uid}, readable and writable only by that sign-in.
// Without a Firebase config the app runs in demo mode and keeps everything in this browser.
import { CONFIG } from "../config.js";
import { HORIZONS, checkPrediction, canPredict, profileScore, dueAt, relabel } from "./score.js";
import { settle, rowCache, SETTLE_DELAY } from "./predict.js";

const FB = "https://www.gstatic.com/firebasejs/10.14.1/";
const LS = { code: "pl.code", demoPw: "pl.demoPw", demo: "pl.demoAccount", demoAlerts: "pl.demoAlerts", demoLists: "pl.demoLists", hidden: "pl.hidden", demoPreds: "pl.demoPreds", preds: "pl.preds" };
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
export const DEFAULT_CHART = { range: "1D", v6: 1, interval: "auto", type: "candles", mas: [], lower: "RSI,MACD", levels: "off", order: "watchlist" };
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
  const auth = authMod.getAuth(app);
  // Wait for this browser's saved sign-in to load before deciding anything: signing in straight away made a brand-new
  // anonymous account on every visit, so people lost their predictions and their username after a refresh.
  await auth.authStateReady();
  if (!auth.currentUser) await authMod.signInAnonymously(auth);
  fb = { app, auth, authMod, db: f.getFirestore(app), f, unsubs: [] };
  return fb;
}

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
  // an account this phone logged into by username comes first; if it's gone, the phone's own sign-in is used
  let id = auth.currentUser.uid, ref = f.doc(db, "accounts", id), snap = null;
  const linked = ls.get(LSLINK);
  if (linked && linked !== id) {
    const ls2 = await f.getDoc(f.doc(db, "accounts", linked)).catch((e) => (/permission|insufficient/i.test(e.code || e.message || "") ? "gone" : null));
    if (ls2 === null) return; // offline: keep the saved copy
    if (ls2 !== "gone" && ls2.exists()) { id = linked; ref = ls2.ref; snap = ls2; } else ls.del(LSLINK);
  }
  snap ||= await f.getDoc(ref).catch(() => null);
  if (!snap || (store.id && store.id !== id)) return; // offline, or a username login on this phone finished first
  if (snap.exists()) {
    // fields from older versions of the app (indicator picks now live in settings.chart) are dropped once
    const OLD = ["indicators", "customIndicators", "recovery"], { indicators, customIndicators, recovery, ...cur } = snap.data();
    store.data = { ...DEFAULT_ACCOUNT(), ...cur, ...pending };
    const tidy = Object.fromEntries(OLD.filter((k) => k in snap.data()).map((k) => [k, f.deleteField()]));
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
  await f.setDoc(ref, first);
  STARTER.forEach((s) => noteFollow(s));
  attach(newId, ref); newId = null;
}
function attach(id, ref) {
  const { db, f } = fb;
  pending = {};
  store.id = id;
  ls.set(LSACC, store.data);
  fb.unsubs.forEach((u) => u()); fb.unsubs = [];
  fb.unsubs.push(f.onSnapshot(ref, (s) => { if (s.exists()) { store.data = { ...DEFAULT_ACCOUNT(), ...s.data() }; ls.set(LSACC, store.data); store.emit("account"); watchLists(); } }));
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

export function signOutDevice() {
  ls.del(LS.code); ls.del(LSACC); ls.del(LSALERTS); ls.del(LS.preds); ls.del(LSLINK); ls.del(LS.demoPw);
  const done = () => { location.hash = ""; location.reload(); };
  if (store.mode === "demo" || !fb) return done();
  fb.auth.signOut().catch(() => {}).then(done); // the next visit starts as a fresh anonymous sign-in
}

// ---- password sign-in (1.2.0). An account is a username and a password, nothing else: the password lives in
// Firebase's own sign-in (email + password, the "email" being <username>@pulse.app, never shown or mailed), so it is
// never stored where the app could read it. There is no email, so there is no reset: a one-time recovery code, kept as
// a hash on the account, lets the data job set a new password (see requestReset).
const EMAIL = (name) => `${name}@pulse.app`;
export const PASSWORD_MIN = 8;
export function checkPassword(pw) {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) return `At least ${PASSWORD_MIN} characters.`;
  if (pw.length > 100) return "At most 100 characters.";
  return null;
}
const authError = (e) => {
  const c = e?.code || "";
  if (/wrong-password|invalid-credential|invalid-login-credentials/.test(c)) return "Wrong password.";
  if (/user-not-found/.test(c)) return "No account with that username.";
  if (/too-many-requests/.test(c)) return "Too many tries. Wait a few minutes and try again.";
  if (/network-request-failed/.test(c)) return "Couldn't reach the server. Check your connection.";
  if (/email-already-in-use|credential-already-in-use/.test(c)) return "That username is taken. Try another.";
  if (/weak-password/.test(c)) return `At least ${PASSWORD_MIN} characters.`;
  if (/requires-recent-login/.test(c)) return "Please sign in again, then change your password.";
  if (/operation-not-allowed/.test(c)) return "Password sign-in isn't switched on yet.";
  return e?.message || "Something went wrong. Try again.";
};
// Does this sign-in have a password? (Accounts from before 1.2.0 were username only.)
export const hasPassword = () => (store.mode === "demo" ? !!ls.get(LS.demoPw) : !!fb?.auth?.currentUser?.providerData?.some((p) => p.providerId === "password"));
// Can a password be set here? Only on the sign-in that owns the account, not on a phone that opened it by username.
export const ownsSignIn = () => store.mode === "demo" || (!!store.id && fb?.auth?.currentUser?.uid === store.id);
// Create an account: the password is attached to this phone's anonymous sign-in (keeping its id, which is the account
// id), then the username is claimed and the account written. If the name turns out to be taken, the password is detached again.
export async function createAccountPassword(rawName, pw) {
  const { name, error } = checkUsername(rawName);
  if (error) throw new Error(error);
  const pe = checkPassword(pw); if (pe) throw new Error(pe);
  if (store.mode === "demo") { await setUsername(name); ls.set(LS.demoPw, await sha256hex(pw)); return name; }
  await within(loadFirebase());
  const { auth, authMod } = fb;
  if (hasPassword()) throw new Error("This phone already has an account. Sign out first to make another.");
  try { await within(authMod.linkWithCredential(auth.currentUser, authMod.EmailAuthProvider.credential(EMAIL(name), pw)), 15000); }
  catch (e) { throw new Error(authError(e)); }
  try { await setUsername(name); }
  catch (e) { await authMod.unlink(auth.currentUser, "password").catch(() => {}); throw e; }
  return name;
}
// Log in with a username and password. Firebase swaps this phone's sign-in for the account's own, so the account id
// is the sign-in id again and the old "devices" list is never needed.
export async function loginPassword(rawName, pw, step = () => {}) {
  const { name, error } = checkUsername(rawName);
  if (error) throw new Error(error);
  if (!pw) throw new Error("Enter your password.");
  if (store.mode === "demo") {
    const h = ls.get(LS.demoPw);
    if (!store.data?.username || store.data.username !== name) throw new Error("No account with that username.");
    if (h && h !== (await sha256hex(pw))) throw new Error("Wrong password.");
    return name;
  }
  step("Signing in");
  await within(loadFirebase());
  const { auth, authMod } = fb;
  try { await within(authMod.signInWithEmailAndPassword(auth, EMAIL(name), pw), 15000); }
  catch (e) {
    if (/user-not-found|invalid-credential|invalid-login-credentials/.test(e?.code || "")) {
      // a username from before passwords: its account exists but has no password yet
      const u = await fb.f.getDoc(fb.f.doc(fb.db, "usernames", name)).catch(() => null);
      if (u?.exists() && !/invalid-credential|invalid-login/.test(e?.code || "")) throw new Error(`@${name} has no password yet. Open Pulse on the phone it was made on and set one in Settings.`);
    }
    throw new Error(authError(e));
  }
  step("Opening your account");
  ls.del(LSLINK); ls.del(LSACC); ls.del(LSALERTS); ls.del(LS.preds);
  store.id = null; newId = null; store.preds = []; store.results = []; store.alerts = [];
  fb.unsubs.forEach((u) => u()); fb.unsubs = [];
  connecting = connect(); await within(connecting, 15000);
  if (!store.id) throw new Error("Couldn't open the account. Check your connection and try again.");
  return name;
}
// Set a password on an account that has none (from before 1.2.0), or change it (the current one is asked for).
export async function setPassword(pw, current = null) {
  const pe = checkPassword(pw); if (pe) throw new Error(pe);
  if (store.mode === "demo") { ls.set(LS.demoPw, await sha256hex(pw)); return; }
  if (!ownsSignIn()) throw new Error("Passwords can only be set on the phone this account was made on.");
  const { auth, authMod } = fb, user = auth.currentUser, name = store.data?.username;
  if (!name) throw new Error("Pick a username first.");
  try {
    if (!hasPassword()) await authMod.linkWithCredential(user, authMod.EmailAuthProvider.credential(EMAIL(name), pw));
    else {
      if (current) await authMod.reauthenticateWithCredential(user, authMod.EmailAuthProvider.credential(EMAIL(name), current));
      await authMod.updatePassword(user, pw);
    }
  } catch (e) { throw new Error(authError(e)); }
}
// Recovery code: 12 letters and digits, shown once. Only its hash is kept, on the account.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const newRecoveryCode = () => [...crypto.getRandomValues(new Uint8Array(12))].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join("").replace(/(.{4})(?=.)/g, "$1-");
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export async function saveRecoveryCode(code) { await save({ recoveryHash: await sha256hex(normCode(code)), recoveryAt: new Date().toISOString() }); }
// Forgot the password: with the username and recovery code, the data job (which runs every 15 minutes) checks the
// code and sets the new password. The request is written under this phone's sign-in; the job deletes the password
// from it as soon as it has acted, and the request can be read only by this phone.
export async function requestReset(rawName, code, pw) {
  const { name, error } = checkUsername(rawName);
  if (error) throw new Error(error);
  if (normCode(code).length !== 12) throw new Error("The recovery code is 12 letters and digits.");
  const pe = checkPassword(pw); if (pe) throw new Error(pe);
  if (store.mode === "demo") {
    if (store.data?.username !== name) throw new Error("No account with that username.");
    if (store.data.recoveryHash !== (await sha256hex(normCode(code)))) throw new Error("That code doesn't match.");
    ls.set(LS.demoPw, await sha256hex(pw)); return "done";
  }
  await within(loadFirebase());
  const { db, f, auth } = fb, id = auth.currentUser.uid;
  await f.setDoc(f.doc(db, "resets", id), { name, codeHash: await sha256hex(normCode(code)), pw, status: "waiting", at: f.serverTimestamp() });
  return "waiting";
}
export async function resetStatus() {
  if (store.mode === "demo" || !fb) return null;
  const d = await fb.f.getDoc(fb.f.doc(fb.db, "resets", fb.auth.currentUser.uid)).catch(() => null);
  return d?.exists() ? d.data().status : null;
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
    const r = await within(fetch(`https://firestore.googleapis.com/v1/projects/${CONFIG.firebase.projectId}/databases/(default)/documents/usernames/${encodeURIComponent(name)}?mask.fieldPaths=acct`, { headers: { authorization: "Bearer " + token } }), 5000);
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
export async function setUsername(raw) {
  const { name, error } = checkUsername(raw);
  if (error) throw new Error(error);
  const old = store.data?.username || null;
  if (old === name) return name;
  if (usernameChangesLeft() <= 0) throw new Error("You've used all your username changes.");
  const changes = (store.data.usernameChanges || 0) + (old ? 1 : 0);
  if (store.mode === "demo") { await save({ username: name, usernameChanges: changes }); return name; }
  await connected();
  if (!store.id && newId) await createAccount();
  if (!store.id) throw new Error("Couldn't reach the server. Try again in a moment.");
  const { db, f } = fb;
  try {
    await f.runTransaction(db, async (tx) => {
      const ref = f.doc(db, "usernames", name);
      await tx.get(ref); // read first, as transactions need; the rules decide whether a name held by someone else can be taken
      tx.set(ref, { acct: store.id, at: new Date().toISOString() });
      if (old) tx.delete(f.doc(db, "usernames", old));
      tx.update(f.doc(db, "accounts", store.id), { username: name, usernameChanges: changes });
    });
  } catch (e) {
    if (/permission|insufficient/i.test(e.code || e.message || "")) throw new Error("That username is taken. Try another.");
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
  try { await fb.f.setDoc(fb.f.doc(fb.db, "accounts", store.id, "predictions", `${sym.t}_${horizon}`), { ...doc, createdAt: fb.f.serverTimestamp() }); }
  catch (e) { throw new Error(e?.code === "permission-denied" ? `You already have an open ${PERIOD(horizon)} call on ${sym.t}.` : "Couldn't save. Try again."); }
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
const keyOf = (p) => `${p.t}_${p.horizon}_${p.createdAt}`;
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
