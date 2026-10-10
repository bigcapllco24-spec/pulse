const realST = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => realST(fn, 0);
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.includes("kraken")) {
    const rows = Array.from({ length: 120 }, (_, i) => [1767225600 + i * 86400, 100 + i, 103 + i, 98 + i, 101 + i + Math.sin(i) * 4, 0, 1000 + i * 3, 10]);
    return new Response(JSON.stringify({ error: [], result: { XXBTZUSD: rows, last: 1 } }));
  }
  if (url.includes("coingecko")) return new Response(JSON.stringify({ bitcoin: { usd: 220 } }));
  if (url.includes("gdelt")) return new Response(JSON.stringify({ articles: [
    { url: "https://www.reuters.com/a1", title: "Reliance Industries signs deal to supply fuel to state firm worth $2 billion", domain: "reuters.com", seendate: "20261010T080000Z" },
    { url: "https://www.cnbc.com/a2", title: "Reliance Industries signs $2 billion fuel supply deal with state firm", domain: "cnbc.com", seendate: "20261010T090000Z" },
    { url: "https://www.cnbc.com/a3", title: "Why Reliance could rally?", domain: "cnbc.com", seendate: "20261010T090000Z" } ] }));
  return new Response("{}", { status: 404 });
};
