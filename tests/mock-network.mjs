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
    { url: "https://www.cnbc.com/a3", title: "Why Reliance could rally?", domain: "cnbc.com", seendate: "20261010T090000Z" },
    { url: "https://www.reuters.com/b1", title: "Bitcoin ETFs log record weekly inflows as BTC climbs", domain: "reuters.com", seendate: new Date(Date.now() - 3600e3).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z" } ] }));
  if (url.includes("github.com/bitcoin/bitcoin/releases.atom")) {
    const d = new Date(Date.now() - 5 * 864e5).toISOString();
    return new Response(`<feed><entry><title>Bitcoin Core 31.0</title><link href="https://github.com/bitcoin/bitcoin/releases/tag/v31.0"/><updated>${d}</updated></entry>
      <entry><title>Bitcoin Core 31.1rc1</title><link href="https://github.com/bitcoin/bitcoin/releases/tag/v31.1rc1"/><updated>${d}</updated></entry></feed>`);
  }
  if (/coindesk|theblock|decrypt|blockworks|dlnews/.test(url)) {
    const d = new Date(Date.now() - 1800e3).toUTCString();
    return new Response(`<rss><channel>
      <item><title><![CDATA[Bitcoin ETFs log record weekly inflows as BTC climbs]]></title><link>https://www.coindesk.com/b2</link><pubDate>${d}</pubDate></item>
      <item><title>XRP price prediction: can it reach $10?</title><link>https://www.coindesk.com/b3</link><pubDate>${d}</pubDate></item>
      <item><title>Click the link to claim your hype rewards</title><link>https://www.coindesk.com/b4</link><pubDate>${d}</pubDate></item>
    </channel></rss>`);
  }
  return new Response("{}", { status: 404 });
};
