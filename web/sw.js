// Service worker: makes the app installable and opens instantly from cache; prices and news always come
// from the network first. Also receives push alerts when Firebase is configured (config arrives in the URL).
const SHELL = "pulse-shell-v52"; // 1.1.4
const FILES = ["./", "index.html", "styles.css", "config.js", "manifest.webmanifest", "icon.svg", "icon-192.png",
  "js/app.js", "js/pages.js", "js/store.js", "js/data.js", "js/chart.js", "js/studies.js", "js/indicators.js", "js/describe.js", "js/search.js", "js/interact.js", "js/levels.js", "js/coach.js", "js/full.js", "js/ui.js", "js/score.js", "js/predict.js", "js/social.js", "js/play.js", "js/feedback.js", "js/panels.js", "js/habit.js", "js/card.js", "js/share.js", "data/indicators.json"];
// cache: "reload" skips the browser's own cache (GitHub Pages lets it keep files 10 minutes), so a release never caches old files
// Each file is fetched with the release name in its address, so a CDN copy of the previous release can never end up in
// the new set, then saved under its plain address.
self.addEventListener("install", (e) => { e.waitUntil(caches.open(SHELL).then((c) => Promise.all(FILES.map(async (f) => {
  const r = await fetch(new Request(`${f}${f.includes("?") ? "&" : "?"}v=${SHELL}`, { cache: "reload" }));
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  await c.put(new Request(f), r);
}))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const live = url.pathname.includes("/data/") && !url.pathname.endsWith("indicators.json");
  if (live) return; // prices and news: always the network (the app keeps its own saved copy)
  // App files: answer from this release's copy, so opening the app never waits for the network. The copy is never
  // refreshed file by file (that once mixed two releases: new styles with old code, 1.1.0); a new release (new SHELL
  // name) installs a complete new set, and the app reloads onto it (app.js).
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    const r = await fetch(e.request, { cache: "no-cache" });
    if (r.ok) c.put(e.request, r.clone());
    return r;
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
