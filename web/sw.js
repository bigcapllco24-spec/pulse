// Service worker: makes the app installable and opens instantly from cache; prices and news always come
// from the network first. Also receives push alerts when Firebase is configured (config arrives in the URL).
const SHELL = "pulse-shell-v30";
const FILES = ["./", "index.html", "styles.css", "config.js", "manifest.webmanifest", "icon.svg", "icon-192.png",
  "js/app.js", "js/pages.js", "js/store.js", "js/data.js", "js/chart.js", "js/studies.js", "js/indicators.js", "js/describe.js", "js/search.js", "js/interact.js", "js/levels.js", "js/coach.js", "js/full.js", "js/ui.js", "js/score.js", "js/predict.js", "js/feedback.js", "js/panels.js", "data/indicators.json"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const live = url.pathname.includes("/data/") && !url.pathname.endsWith("indicators.json");
  if (live) return; // prices and news: always the network (the app keeps its own saved copy)
  // App files: answer from the phone's copy at once and refresh that copy in the background, so opening the
  // app never waits for the network. A new release (new SHELL name) replaces the whole copy in one go.
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});

const config = JSON.parse(new URL(self.location.href).searchParams.get("config") || "null");
if (config) {
  importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
  firebase.initializeApp(config);
  firebase.messaging().onBackgroundMessage((payload) => {
    const n = payload.notification || payload.data || {};
    self.registration.showNotification(n.title || "Alert", { body: n.body || "", icon: "icon-192.png", badge: "icon-192.png", data: { link: payload.fcmOptions?.link || "./" } });
  });
}
self.addEventListener("notificationclick", (e) => { e.notification.close(); e.waitUntil(clients.openWindow(e.notification.data?.link || "./")); });
