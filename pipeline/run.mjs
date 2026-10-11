// Data job, run by GitHub Actions every 2 hours (and on every deploy).
// 1. Reads which symbols anyone follows (Firestore "follows", no account data).
// 2. Writes data/candles.json (coins, from Kraken) and data/news.json (GDELT, outlet policy, story matching).
// 3. Checks every account's rules on the latest bar, stores alerts and sends push notifications.
// 4. Prediction game: locks start prices, scores predictions that are due and updates profile scores.
// Usage: node pipeline/run.mjs web/data
// Env: FIREBASE_SERVICE_ACCOUNT (JSON; without it only starter symbols are refreshed and no alerts are sent),
//      COINGECKO_DEMO_KEY (optional), SITE_URL (for alert links), MAX_NEWS_SYMBOLS (default 150)
import fs from "node:fs";
import path from "node:path";
import { serviceAccount, firestore, sendPush } from "./lib/google.mjs";
import { fetchCrypto } from "./lib/crypto.mjs";
import { fetchNews } from "./lib/news.mjs";
import { settlePredictions } from "./lib/predictions.mjs";
import { compute, ruleMet, METRICS, OPS, fmt } from "../web/js/indicators.js";

const outDir = process.argv[2] || "web/data";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const STARTER = [["CRYPTO", "BTC", "Bitcoin", "C"], ["CRYPTO", "ETH", "Ethereum", "C"], ["CRYPTO", "BNB", "BNB", "C"], ["CRYPTO", "XRP", "XRP", "C"], ["CRYPTO", "SOL", "Solana", "C"], ["CRYPTO", "TRX", "TRON", "C"], ["CRYPTO", "ZEC", "Zcash", "C"], ["CRYPTO", "HYPE", "Hyperliquid", "C"], ["CRYPTO", "DOGE", "Dogecoin", "C"], ["CRYPTO", "LINK", "Chainlink", "C"]]
  .map(([m, t, n, ty]) => ({ key: `${m}:${t}`, m, t, n, ty }));

async function main() {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT ? serviceAccount(process.env.FIREBASE_SERVICE_ACCOUNT) : null;
  const db = sa ? firestore(sa) : null;
  let symbols = STARTER;
  if (db) {
    const f = await db.list("follows");
    const seen = new Set(STARTER.map((s) => s.key));
    symbols = [...STARTER, ...f.map((d) => ({ key: d.key, m: d.m, t: d.t, n: d.n, ty: d.ty })).filter((s) => s.key && s.t && !seen.has(s.key))];
    log(`${symbols.length} symbols followed`);
  } else log("No FIREBASE_SERVICE_ACCOUNT: starter symbols only, no alerts");

  const coins = [...new Set(symbols.filter((s) => s.m === "CRYPTO").map((s) => s.t))];
  const series = await fetchCrypto(coins, { log });
  const stories = await fetchNews(symbols.slice(0, Number(process.env.MAX_NEWS_SYMBOLS || 150)), { log });

  fs.mkdirSync(outDir, { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, "candles.json"), JSON.stringify({ generatedAt: now, series }));
  fs.writeFileSync(path.join(outDir, "news.json"), JSON.stringify({ generatedAt: now, stories: stories.slice(0, 800) }));
  log(`wrote ${Object.keys(series).length} coins, ${stories.length} stories`);

  if (db) {
    const accounts = await checkRules(sa, db, series);
    await settlePredictions(db, accounts, { log });
  }
}

async function checkRules(sa, db, series) {
  const readings = {};
  for (const [k, v] of Object.entries(series)) {
    const bars = v.bars.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
    readings[k] = compute(bars);
  }
  const accounts = await db.list("accounts");
  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  let fired = 0;
  for (const a of accounts) {
    const rules = Array.isArray(a.rules) ? a.rules : [];
    if (!rules.length) continue;
    const coins = [...new Set((a.watchlists || []).flatMap((w) => w.syms || []).filter((s) => s.m === "CRYPTO").map((s) => s.key))];
    const alerts = [];
    const updated = rules.map((r) => {
      if (r.active === false) return r;
      let lastBar = r.lastBar || {}, changed = false;
      for (const k of r.sym === "*" ? coins : [r.sym]) {
        const d = readings[k];
        if (!d || lastBar[k] === d.bar || !ruleMet(r, d.now, d.prev)) continue;
        const m = METRICS[r.metric] || { label: r.metric, digits: 2 };
        alerts.push({ id: `${r.id}-${k}-${d.bar}`.replace(/[^\w-]/g, "_"), at: new Date().toISOString(), sym: k, ruleId: r.id, read: false,
          text: `${k.split(":")[1]}: ${m.label} ${OPS[r.op]} ${r.value}${m.unit || ""} (now ${fmt(d.now[r.metric], m.digits)}${m.unit || ""}).${r.note ? " " + r.note : ""}` });
        lastBar = { ...lastBar, [k]: d.bar }; changed = true;
      }
      return changed ? { ...r, lastBar, lastFired: new Date().toISOString().slice(0, 10) } : r;
    });
    if (!alerts.length) continue;
    for (const { id, ...doc } of alerts) {
      try { await db.set(`accounts/${a.id}/alerts/${id}`, doc, { mustNotExist: true }); } catch (e) { if (![400, 409].includes(e.status)) throw e; }
    }
    await db.set(`accounts/${a.id}`, { rules: updated });
    fired += alerts.length;
    const tokens = Array.isArray(a.fcm) ? a.fcm : [], dead = [];
    for (const t of tokens) {
      const res = await sendPush(sa, t, { title: alerts.length === 1 ? "Your rule was met" : `${alerts.length} of your rules were met`, body: alerts.map((x) => x.text).join("\n").slice(0, 300), link: site ? site + "/" : undefined });
      if (res === "dead") dead.push(t);
    }
    if (dead.length) await db.set(`accounts/${a.id}`, { fcm: tokens.filter((t) => !dead.includes(t)) });
  }
  log(`rules: ${fired} alerts across ${accounts.length} accounts`);
  return accounts;
}

main().catch((e) => { console.error(e); process.exit(1); });
