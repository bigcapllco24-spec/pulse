// For the data jobs in tests/live.py: Kraken answers with the same steady prices the test browsers see
// (tests/e2e.py kraken_route), the local emulators are reached for real, and every other site answers empty, so the
// jobs never depend on the outside world.
const realFetch = globalThis.fetch;
const priceAt = (pair, t) => { const base = 50 + ([...pair].reduce((a, c) => a + c.charCodeAt(0), 0) % 50) * 20; return base * Math.exp(0.03 * Math.sin((t / 86400) * 2.1) + 0.004 * Math.sin(t / 3600)); };
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(u)) return realFetch(url, opts);
  if (u.includes("api.kraken.com")) {
    const pair = (u.match(/pair=([A-Z]+)/) || [])[1] || "XBTUSD", iv = Number((u.match(/interval=(\d+)/) || [])[1] || 1440), step = iv * 60;
    const now = Date.now() / 1000, end = Math.floor(now / step) * step, rows = [];
    for (let k = 719; k >= 0; k--) {
      const s0 = end - k * step, o = priceAt(pair, s0), c = priceAt(pair, Math.min(s0 + step - 60, now));
      rows.push([s0, o.toFixed(6), Math.max(o, c).toFixed(6), Math.min(o, c).toFixed(6), c.toFixed(6), c.toFixed(6), "1000", 10]);
    }
    return new Response(JSON.stringify({ error: [], result: { [pair]: rows, last: rows.at(-1)[0] } }), { headers: { "content-type": "application/json" } });
  }
  if (u.includes("fcm.googleapis.com")) return new Response(JSON.stringify({ error: { status: "NOT_FOUND" } }), { status: 404 });
  if (/gdelt|coingecko/.test(u)) return new Response("{}", { headers: { "content-type": "application/json" } });
  return new Response("", { status: 404 });
};
