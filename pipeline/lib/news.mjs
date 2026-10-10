// News: fetch from GDELT (free, commercial use allowed with a citation), keep neutral outlets only,
// drop opinion and promotional headlines, and merge the same story across outlets.

// Outlets kept, by domain. Left out on purpose: Bloomberg (founder ran for US president), WSJ / Barron's /
// MarketWatch (News Corp, controlled by the Murdoch family, which also controls Fox News), Financial Times,
// The Economist and New York Times (editorial boards endorse parties or candidates), Mint / HT (chairperson was a
// nominated Rajya Sabha member), BBC (state-chartered broadcaster). CoinDesk is owned by the exchange Bullish.
export const OUTLETS = {
  "reuters.com": "Reuters", "apnews.com": "AP", "cnbc.com": "CNBC", "asia.nikkei.com": "Nikkei Asia",
  "axios.com": "Axios", "business-standard.com": "Business Standard", "economictimes.indiatimes.com": "Economic Times",
  "thehindubusinessline.com": "BusinessLine", "ptinews.com": "PTI", "coindesk.com": "CoinDesk",
  "prnewswire.com": "Company release", "businesswire.com": "Company release", "globenewswire.com": "Company release",
};
const BY_NAME = { reuters: "Reuters", "associated press": "AP", "ap news": "AP", cnbc: "CNBC", nikkei: "Nikkei Asia", axios: "Axios",
  "business standard": "Business Standard", "economic times": "Economic Times", businessline: "BusinessLine",
  "press trust of india": "PTI", pti: "PTI", coindesk: "CoinDesk" };
const RELEASES = ["prnewswire", "businesswire", "globenewswire", "company release"];

export function outletFor(domainOrName) {
  const s = String(domainOrName || "").toLowerCase().trim();
  const host = s.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  for (const d of Object.keys(OUTLETS)) if (host === d || host.endsWith("." + d)) return OUTLETS[d];
  const flat = s.replace(/\s+/g, "");
  if (RELEASES.some((r) => flat.includes(r.replace(/\s+/g, "")))) return "Company release";
  for (const [k, v] of Object.entries(BY_NAME)) if (flat.includes(k.replace(/\s+/g, ""))) return v;
  return null;
}

// Headlines that read as opinion, analysis, forecasts or stock tips rather than reported fact.
export const OPINION = new RegExp(
  "\\?|\\bwhy\\b|here'?s (why|what|how)|what'?s next|\\bexperts?\\b|analysts? (say|see|expect|weigh)|" +
  "\\b(could|should|might|may|would)\\b|forecast|outlook|predict|bullish|bearish|looks? (cheap|expensive)|" +
  "undervalued|overvalued|opinion|column|editorial|\\bview\\b|explained|lessons|playbook|top picks|" +
  "stocks? to (buy|watch|sell)|buy or sell|price target|target price|\\bwarns?\\b|\\bbets?\\b|" +
  "\\bvs\\.?\\b|upside|downside|rally (ahead|to come)|\\bcan .* (last|continue)\\b|^chart:|a look at|" +
  "trajectory|:\\s*[A-Z][\\w.'-]*(\\s[A-Z][\\w.'-]*){0,2}\\s*$", "i");
export const SPAM = /investigat|class action|lawsuit|shareholder alert|investors? who|deadline|law firm|rosen|pomerantz|levi ?& ?korsinsky|bragar|hbss|faruqi|glancy|schall|bronstein|kessler topaz/i;

export function keep(item) {
  if (!item.title || !item.url || !item.outlet) return false;
  if (OPINION.test(item.title)) return false;
  if (item.outlet === "Company release" && SPAM.test(item.title)) return false;
  return true;
}

// Same key as the web app uses for "What this means" explanations.
export function storyKey(title) {
  let h = 5381;
  const s = String(title).toLowerCase();
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return "n" + h.toString(36);
}

const STOP = new Set("the a an and or of to in on for at by with from as is are was were be its it this that after amid over into than up down new says said report reports year years per cent percent stock stocks shares share market markets price prices".split(" "));
const toks = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9₹$.%]+/g, " ").split(" ").filter((w) => w.length >= 3 && !STOP.has(w)));

// items: [{title, url, outlet, date:'YYYY-MM-DD', ts, sym?, scope?}] → stories, newest first.
export function groupStories(items) {
  const list = items.filter(keep).map((x) => ({ ...x, t: toks(x.title) }));
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      let same = a.url === b.url || a.title.toLowerCase() === b.title.toLowerCase();
      if (!same) {
        let shared = 0;
        for (const w of a.t) if (b.t.has(w)) shared++;
        same = shared >= 4 && shared / Math.min(a.t.size, b.t.size) >= 0.5;
      }
      if (same) parent[find(i)] = find(j);
    }
  const groups = new Map();
  list.forEach((x, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x); });
  const stories = [...groups.values()].map((g) => {
    g.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
    const outlets = [...new Set(g.filter((x) => x.outlet !== "Company release").map((x) => x.outlet))];
    const links = [], seen = new Set();
    for (const x of g) if (!seen.has(x.url)) { seen.add(x.url); links.push({ source: x.outlet, url: x.url }); }
    const title = g[0].title;
    return {
      key: storyKey(title), title,
      date: g.map((x) => x.date).sort().pop(), ts: g.map((x) => x.ts || "").sort().pop(),
      outlets, company: g.some((x) => x.outlet === "Company release"),
      status: outlets.length >= 2 ? "confirmed" : outlets.length === 1 ? "single" : "company",
      links: links.slice(0, 6),
      syms: [...new Set(g.map((x) => x.sym).filter(Boolean))],
      scopes: [...new Set(g.map((x) => x.scope).filter(Boolean))],
    };
  });
  return stories.sort((a, b) => (b.ts || b.date || "").localeCompare(a.ts || a.date || ""));
}

// ---- GDELT DOC 2.0 API. One request every 5+ seconds, as GDELT asks.
const DOMAIN_FILTER = "(" + Object.keys(OUTLETS).map((d) => "domainis:" + d).join(" OR ") + ")";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function queryFor(sym) {
  // Company names without legal suffixes read better as search phrases.
  const name = String(sym.name || sym.ticker)
    .replace(/\(.*?\)/g, "").replace(/\b(Inc|Incorporated|Corp|Corporation|Ltd|Limited|plc|Holdings|Co|Company|Class [A-C]|ETF|Trust|Index|Shares)\b\.?/gi, "")
    .replace(/[,·]+/g, " ").replace(/\s+/g, " ").trim();
  return `"${name || sym.ticker}"`;
}

export const GENERAL = [
  { scope: "IN", q: '(sensex OR nifty OR "Reserve Bank of India" OR SEBI)' },
  { scope: "US", q: '("S&P 500" OR "Wall Street" OR "Federal Reserve" OR Nasdaq)' },
  { scope: "CRYPTO", q: "(bitcoin OR ethereum OR cryptocurrency)" },
];

export async function gdelt(query, { days = 3, max = 50 } = {}) {
  const url = "https://api.gdeltproject.org/api/v2/doc/doc?format=json&mode=ArtList&sort=DateDesc&sourcelang=english" +
    `&maxrecords=${max}&timespan=${days}d&query=` + encodeURIComponent(`${query} ${DOMAIN_FILTER}`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "market-feed-pipeline/1.0" } });
      const text = await r.text();
      if (!r.ok || !text.trim().startsWith("{")) throw new Error(`${r.status} ${text.slice(0, 120)}`);
      const arts = JSON.parse(text).articles || [];
      return arts.map((a) => {
        const sd = a.seendate || ""; // 20261010T120000Z
        const ts = sd ? `${sd.slice(0, 4)}-${sd.slice(4, 6)}-${sd.slice(6, 8)}T${sd.slice(9, 11)}:${sd.slice(11, 13)}:00Z` : "";
        return { title: (a.title || "").trim(), url: a.url, outlet: outletFor(a.domain || a.url), date: ts.slice(0, 10), ts };
      });
    } catch (e) {
      if (attempt === 1) { console.warn("gdelt failed:", query, e.message); return []; }
      await sleep(6000);
    }
  }
  return [];
}

export async function fetchNews(symbols, { log = console.log } = {}) {
  const items = [];
  for (const g of GENERAL) {
    (await gdelt(g.q, { days: 2, max: 40 })).forEach((x) => items.push({ ...x, scope: g.scope }));
    await sleep(5500);
  }
  for (const s of symbols) {
    const got = await gdelt(queryFor(s), { days: 3, max: 25 });
    got.forEach((x) => items.push({ ...x, sym: s.key }));
    log(`news ${s.key}: ${got.length}`);
    await sleep(5500);
  }
  return groupStories(items);
}
