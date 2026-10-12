// Symbol and indicator search. The symbol index (data/symbols.json) holds about 15,000 listings:
// [ticker, name, market, type, weight]. Ranked by match quality, then popularity.
export const MKLABEL = { NSE: "NSE", NASDAQ: "Nasdaq", NYSE: "NYSE", ARCA: "NYSE Arca", CRYPTO: "Crypto", INDEX: "Index" };
export const TYLABEL = { S: "Stock", E: "ETF", C: "Coin", I: "Index" };

const ALIAS = { google: "GOOGL", alphabet: "GOOGL", facebook: "META", sbi: "SBIN", "state bank": "SBIN", "l&t": "LT", lnt: "LT", airtel: "BHARTIARTL",
  zomato: "ETERNAL", ril: "RELIANCE", hul: "HINDUNILVR", "hindustan lever": "HINDUNILVR", "m&m": "M&M", mahindra: "M&M", "tata motors": "TMPV",
  "bajaj finance": "BAJFINANCE", kotak: "KOTAKBANK", "asian paints": "ASIANPAINT", "sun pharma": "SUNPHARMA", dmart: "DMART", spacex: "SPCX",
  berkshire: "BRK.B", "s&p 500": "VOO", sp500: "VOO", "s&p": "VOO", "nasdaq 100": "QQQ", bitcoin: "BTC", ether: "ETH", ripple: "XRP", gold: "PAXG",
  sensex: "SENSEX", "nifty 50": "NIFTY", nifty: "NIFTY", lic: "LICI", vodafone: "IDEA", paytm: "PAYTM", nykaa: "NYKAA", swiggy: "SWIGGY",
  infy: "INFY", tcs: "TCS", hcl: "HCLTECH", ongc: "ONGC", ntpc: "NTPC", itc: "ITC", adani: "ADANIENT" };

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9&. ]+/g, " ").replace(/\s+/g, " ").trim();
const compact = (s) => String(s).toLowerCase().replace(/[^a-z0-9&]/g, "");

let IDX = null, loading = null;
export function symKey(t, m) { return m + ":" + t; }

export function loadSymbols() {
  if (IDX) return Promise.resolve(IDX);
  if (!loading) loading = fetch("data/symbols.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((rows) => {
    IDX = rows.map(([t, n, m, ty, w]) => { const nl = n.toLowerCase(); return { key: symKey(t, m), t, n, m, ty, w, tl: t.toLowerCase(), nl, words: nl.split(/[^a-z0-9&]+/).filter(Boolean), nc: compact(n) }; });
    return IDX;
  }).catch((e) => { loading = null; throw e; });
  return loading;
}
export const symbolIndex = () => IDX;

function score(r, q, qc, toks) {
  let s = 0;
  if (r.tl === q || r.tl === qc) s = 1000;
  else if (r.tl.startsWith(qc)) s = 760 - 8 * (r.tl.length - qc.length);
  if (r.nl.startsWith(q)) s = Math.max(s, 640);
  else if (qc.length >= 3 && r.nc.startsWith(qc)) s = Math.max(s, 560);
  if (s < 520 && toks.length && toks.every((t) => r.words.some((w) => w.startsWith(t)))) s = Math.max(s, 520 - 10 * r.words.findIndex((w) => w.startsWith(toks[0])));
  if (s < 300 && qc.length >= 3 && r.nc.includes(qc)) s = 300;
  if (s < 200 && qc.length >= 2 && r.tl.includes(qc)) s = 200;
  return s ? s + r.w * 28 : 0;
}

export function searchSymbols(text, limit = 8) {
  const q = norm(text), qc = compact(text);
  if (!q || !IDX) return [];
  const toks = q.split(" ").filter(Boolean), best = [];
  for (const r of IDX) {
    const s = score(r, q, qc, toks);
    if (!s) continue;
    if (best.length < limit || s > best[best.length - 1].s) { best.push({ r, s }); best.sort((a, b) => b.s - a.s); if (best.length > limit) best.pop(); }
  }
  const al = ALIAS[q];
  if (al) {
    const hit = IDX.find((r) => r.t === al);
    if (hit) { const i = best.findIndex((b) => b.r === hit); if (i >= 0) best.splice(i, 1); best.unshift({ r: hit, s: 1e4 }); if (best.length > limit) best.pop(); }
  }
  return best.map((b) => b.r);
}

