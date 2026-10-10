// Service worker: makes the app installable and opens instantly from cache; prices and news always come
// from the network first. Also receives push alerts when Firebase is configured (config arrives in the URL).
const SHELL = "pulse-shell-v2";
const FILES = ["./", "index.html", "styles.css", "config.js", "manifest.webmanifest", "icon.svg", "icon-192.png",
  "js/app.js", "js/pages.js", "js/store.js", "js/data.js", "js/chart.js", "js/indicators.js", "js/describe.js", "js/search.js", "js/tv.js", "js/ui.js", "data/indicators.json"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const live = url.pathname.includes("/data/") && !url.pathname.endsWith("indicators.json");
  if (live) return; // prices and news: always the network (the app keeps its own saved copy)
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
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
