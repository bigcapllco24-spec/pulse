// Built by scripts/bundle-worker.sh from worker/worker.js and pipeline/lib/google.mjs. Don't edit by hand.
// Google service-account access with no SDK: OAuth token via a signed JWT, Firestore REST and FCM HTTP v1.
// Uses Web Crypto only, so the same file runs in Node 20+ (GitHub Actions) and in Cloudflare Workers.

const b64url = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function importKey(pem) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

function serviceAccount(json) {
  const sa = typeof json === "string" ? JSON.parse(json) : json;
  let token = null, exp = 0;
  async function accessToken() {
    if (token && Date.now() < exp - 60000) return token;
    const now = Math.floor(Date.now() / 1000);
    const head = enc({ alg: "RS256", typ: "JWT" });
    const claim = enc({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await importKey(sa.private_key), new TextEncoder().encode(`${head}.${claim}`));
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${head}.${claim}.${b64url(sig)}`,
    });
    const j = await r.json();
    if (!j.access_token) throw new Error("Google token failed: " + JSON.stringify(j).slice(0, 200));
    token = j.access_token; exp = Date.now() + j.expires_in * 1000;
    return token;
  }
  return { projectId: sa.project_id, accessToken };
}

// ---- Firestore typed values
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toFs(x)])) } };
}
function fromFs(v) {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFs);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]));
  return null;
}
const docOut = (d) => ({ id: d.name.split("/").pop(), path: d.name.split("/documents/")[1], ...fromFs({ mapValue: { fields: d.fields || {} } }) });

function firestore(sa) {
  const base = () => `https://firestore.googleapis.com/v1/projects/${sa.projectId}/databases/(default)/documents`;
  async function call(method, url, body) {
    const r = await fetch(url, { method, headers: { authorization: "Bearer " + (await sa.accessToken()), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 404) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(`Firestore ${method} ${r.status}: ${JSON.stringify(j).slice(0, 200)}`); e.status = r.status; throw e; }
    return j;
  }
  return {
    async get(path) { const d = await call("GET", `${base()}/${path}`); return d ? docOut(d) : null; },
    async list(collPath, pageSize = 300) {
      const out = []; let token = "";
      do {
        const j = await call("GET", `${base()}/${collPath}?pageSize=${pageSize}${token ? "&pageToken=" + encodeURIComponent(token) : ""}`);
        (j?.documents || []).forEach((d) => out.push(docOut(d)));
        token = j?.nextPageToken || "";
      } while (token);
      return out;
    },
    // Writes the given fields only (merge). Pass {mustNotExist:true} to create without overwriting.
    async set(path, data, { mustNotExist = false } = {}) {
      const mask = Object.keys(data).map((k) => "updateMask.fieldPaths=" + encodeURIComponent("`" + k.replace(/`/g, "\\`") + "`")).join("&");
      const pre = mustNotExist ? "&currentDocument.exists=false" : "";
      return call("PATCH", `${base()}/${path}?${mask}${pre}`, { fields: toFs(data).mapValue.fields });
    },
    async del(path) { return call("DELETE", `${base()}/${path}`); },
  };
}

async function sendPush(sa, token, { title, body, link }) {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.projectId}/messages:send`, {
    method: "POST", headers: { authorization: "Bearer " + (await sa.accessToken()), "content-type": "application/json" },
    body: JSON.stringify({ message: { token, notification: { title, body }, webpush: { fcm_options: link ? { link } : undefined } } }),
  });
  if (r.ok) return "sent";
  const j = await r.json().catch(() => ({}));
  const code = j?.error?.details?.find?.((d) => d.errorCode)?.errorCode || j?.error?.status;
  return code === "UNREGISTERED" || code === "NOT_FOUND" || code === "INVALID_ARGUMENT" ? "dead" : "failed";
}
// Pulse AI relay (Cloudflare Worker, free plan). Holds the Claude API key, checks that each request comes from a
// signed-in app user, writes every result once to Firestore so all users share it, and enforces the AI policy:
// facts and context only, never buy/sell/hold, targets or forecasts.
// Routes: POST /explain, /why, /resolve, /indicator, /report
// Secrets: ANTHROPIC_API_KEY, FIREBASE_SERVICE_ACCOUNT (JSON). Vars: ALLOWED_ORIGIN, MODEL, QUICK_MODEL, DAILY_LIMIT

const POLICY = `Rules you must follow: Describe facts and context only. Never say or imply that anyone should buy, sell, hold, accumulate or avoid anything. Never give price targets, forecasts or the likely direction of a price. Write in the past or present tense about events; no predictions. Do not invent numbers, quotes or sources; every number must come from a source you found. Plain English, no jargon without a short explanation. Do not mention how many outlets reported a story.`;
const ADVICE = /\b(buy(ing)?|sell(ing)?|hold(ing)? (on|the)|accumulate|book (profits?|gains)|price target|target price|upside|downside|bounce back|rebound ahead|will (rise|fall|go up|go down|climb|drop|rally|surge)|likely to (rise|fall|gain|drop)|undervalued|overvalued|oversold|overbought|breakout|recommend(ed|s)?|should (buy|invest)|good time to|opportunity)\b/i;
const strip = (t) => String(t || "").replace(/sell-?offs?/gi, "decline");

export default {
  async fetch(req, env, ctx) {
    const cors = { "access-control-allow-origin": env.ALLOWED_ORIGIN || "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS", "vary": "origin" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json" } });
    try {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      const sa = serviceAccount(env.FIREBASE_SERVICE_ACCOUNT);
      const db = firestore(sa);
      const uid = await verifyUser(req, sa.projectId).catch(() => null);
      if (!uid) return json({ error: "Please sign in again." }, 401);
      const body = await req.json();
      const route = new URL(req.url).pathname;
      if (route === "/report") return json(await report(db, body));
      if (!(await underLimit(db, uid, Number(env.DAILY_LIMIT || 40)))) return json({ error: "Daily AI limit reached. It resets at midnight UTC." }, 429);
      if (route === "/explain") return json(await explain(env, db, body));
      if (route === "/why") return json(await why(env, db, body));
      if (route === "/resolve") return json(await resolve(env, body));
      if (route === "/indicator") return json(await indicator(env, db, body));
      return json({ error: "Unknown route" }, 404);
    } catch (e) {
      return json({ error: e.userMessage || "The AI service had a problem. Try again in a minute." }, 500);
    }
  },
};

// ---- Firebase ID token check (anonymous sign-in is enough: it proves the request came from the app)
let JWKS = null, jwksAt = 0;
async function verifyUser(req, projectId) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [h, p, s] = tok.split(".");
  if (!s) return null;
  const dec = (x) => JSON.parse(new TextDecoder().decode(b64(x)));
  const head = dec(h), pay = dec(p), now = Date.now() / 1000;
  if (pay.aud !== projectId || pay.iss !== `https://securetoken.google.com/${projectId}` || pay.exp < now || !pay.sub) return null;
  if (!JWKS || Date.now() - jwksAt > 3600e3) { JWKS = (await (await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")).json()).keys; jwksAt = Date.now(); }
  const jwk = JWKS.find((k) => k.kid === head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64(s), new TextEncoder().encode(`${h}.${p}`));
  return ok ? pay.sub : null;
}
function b64(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

async function underLimit(db, uid, limit) {
  const id = `${new Date().toISOString().slice(0, 10)}_${uid}`.replace(/[^\w-]/g, "_");
  const d = await db.get(`usage/${id}`);
  const n = (d?.n || 0) + 1;
  if (n > limit) return false;
  await db.set(`usage/${id}`, { n });
  return true;
}

// ---- Claude
async function claude(env, { prompt, search = true, quick = false, maxTokens = 1200 }) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: quick ? env.QUICK_MODEL || "claude-haiku-5-5" : env.MODEL || "claude-sonnet-5-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      ...(search ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }] } : {}),
    }),
  });
  const j = await r.json();
  if (!r.ok) { const e = new Error("claude " + r.status + " " + JSON.stringify(j).slice(0, 200)); e.userMessage = "The AI service is busy. Try again shortly."; throw e; }
  const texts = (j.content || []).filter((b) => b.type === "text");
  const text = texts.map((b) => b.text).join("");
  const cited = []; const seen = new Set();
  for (const b of texts) for (const c of b.citations || []) if (c.url && !seen.has(c.url)) { seen.add(c.url); cited.push({ label: c.title || new URL(c.url).hostname, url: c.url }); }
  const a = text.indexOf("{"), z = text.lastIndexOf("}");
  let out = null;
  try { out = JSON.parse(text.slice(a, z + 1)); } catch { out = null; }
  return { out, cited };
}
const words = (t) => String(t || "").trim().split(/\s+/).filter(Boolean).length;
const okText = (t) => t && words(t) >= 25 && words(t) <= 90 && !ADVICE.test(strip(t));
async function guarded(env, prompt, field = "text") {
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = attempt ? prompt + `\n\nYour previous draft broke the rules (advice or forecast words, or wrong length). Rewrite it: 50 to 70 words, facts and context only.` : prompt;
    const { out, cited } = await claude(env, { prompt: p });
    if (out && okText(out[field])) return { out, cited };
  }
  return null;
}
const sources = (out, cited) => {
  const list = [...(Array.isArray(out?.sources) ? out.sources : []), ...cited].filter((s) => /^https?:\/\//.test(s?.url || ""));
  const seen = new Set();
  return list.filter((s) => !seen.has(s.url) && seen.add(s.url)).slice(0, 3).map((s) => ({ label: String(s.label || "Source").slice(0, 60), url: s.url }));
};
const safeId = (s) => String(s).replace(/[^\w-]/g, "_").slice(0, 120);

// ---- /explain: what a news story means for the company
async function explain(env, db, b) {
  const key = safeId(b.key);
  const cached = await db.get(`explain/${key}`);
  if (cached?.status === "done" || cached?.status === "hidden") return { doc: cached };
  const cos = (b.companies || []).map((c) => `${c.name} (${c.ticker}, ${c.market})`).join("; ") || "the market";
  const prompt = `You explain one news story to retail investors who want to understand the company better.
Story: "${b.title}" (${b.date}). Links: ${(b.urls || []).join(" , ")}. Company or instrument: ${cos}.
Research: search for this story and read reports of it, then look up the company's size and main businesses (latest annual revenue, segments).
Write ONE paragraph of 50 to 70 words covering, in order: the concrete fact with its key numbers; why it matters to this company's business, tied to the segment it touches and its scale (for example, a deal compared with annual revenue); and the one thing to watch next. For a coin, ETF or index, explain it through what drives that instrument instead of company revenue.
${POLICY}
End your reply with a single JSON object and nothing after it: {"text": "...", "sources": [{"label": "outlet", "url": "https://..."}]}`;
  const res = await guarded(env, prompt);
  const doc = res ? { status: "done", text: res.out.text.trim(), sources: sources(res.out, res.cited), who: (b.companies || []).map((c) => c.ticker).join(", "), title: String(b.title).slice(0, 300), at: new Date().toISOString(), reports: 0 }
    : { status: "failed", error: "Not enough reliable information found", title: String(b.title).slice(0, 300), at: new Date().toISOString() };
  await db.set(`explain/${key}`, doc);
  return { doc };
}

// ---- /why: why a symbol moved unusually on its latest bar (past tense, sourced)
async function why(env, db, b) {
  const id = safeId(b.id);
  const cached = await db.get(`moves/${id}`);
  if (cached?.status === "done") return { doc: cached };
  const prompt = `${b.name} (${b.ticker}, ${b.market}) moved ${Number(b.changePct).toFixed(2)}% on ${b.date}, about ${(Math.abs(b.changePct) / (b.atrPct || 1)).toFixed(1)} times its usual daily move${b.volRatio ? `, on ${Number(b.volRatio).toFixed(1)} times its usual volume` : ""}.
Headlines we have from that day: ${(b.stories || []).map((s) => `"${s.title}" (${s.url})`).join("; ") || "none"}.
Research what was reported about ${b.name} on or just before ${b.date}, and any broad market or sector move that day.
Write ONE paragraph of 50 to 70 words, in the past tense, explaining what was reported around the move. If you find no specific news, say so plainly and describe any market-wide or sector move that day instead. Do not say what will happen next.
${POLICY}
End your reply with a single JSON object and nothing after it: {"text": "...", "sources": [{"label": "outlet", "url": "https://..."}]}`;
  const res = await guarded(env, prompt);
  const doc = res ? { status: "done", text: res.out.text.trim(), sources: sources(res.out, res.cited), key: b.key, date: b.date, at: new Date().toISOString() }
    : { status: "failed", key: b.key, date: b.date, at: new Date().toISOString() };
  await db.set(`moves/${id}`, doc);
  return { doc };
}

// ---- /resolve: nicknames, brands, misspellings → candidate tickers (checked against the app's index on the phone)
async function resolve(env, b) {
  const q = String(b.q || "").slice(0, 80);
  const { out } = await claude(env, { quick: true, search: false, maxTokens: 400, prompt: `Someone typed "${q}" into a watchlist search box. It may be a company, brand, product, nickname, misspelling, index or cryptocurrency. List up to 5 listed instruments they most likely mean, best guess first, limited to NSE (India) stocks and ETFs, US stocks and ETFs, and cryptocurrencies. If a brand belongs to a parent company, give the parent's listing. Use exact tickers (NSE codes like HDFCBANK, US tickers like GOOGL, coins like BTC). Reply only with JSON: {"matches":[{"ticker":"...","market":"NSE|US|CRYPTO"}]}` });
  return { matches: Array.isArray(out?.matches) ? out.matches.slice(0, 5) : [] };
}

// ---- /indicator: researched explainer, shared by everyone, marked not yet reviewed
async function indicator(env, db, b) {
  const name = String(b.name || "").slice(0, 60);
  const id = safeId(b.id || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  const cached = await db.get(`indicatorDocs/${id}`);
  if (cached?.measures) return { doc: { ...cached, id } };
  const { out, cited } = await claude(env, { prompt: `Research the technical or fundamental indicator "${name}" for a plain-English explainer for retail investors. If the name is not a real, recognised indicator, reply {"unknown": true}.
Otherwise reply with JSON only at the end: {"name": "standard name", "aliases": ["..."], "category": "Trend|Momentum|Volatility|Volume|Levels|Fundamental|Risk", "short": "one sentence, what it shows", "measures": "2 sentences", "calc": "how it is calculated, 1-2 sentences", "settings": "usual settings", "limits": "what it misses or gets wrong, 1-2 sentences", "sources": [{"label": "...", "url": "https://..."}]}
Describe what it measures; never say a reading is a signal to buy or sell. ${POLICY}` });
  if (!out || out.unknown || !out.measures) { const e = new Error("unknown"); e.userMessage = `Couldn't find an indicator called “${name}”.`; throw e; }
  for (const f of ["short", "measures", "calc", "settings", "limits"]) if (ADVICE.test(strip(out[f]))) out[f] = String(out[f]).replace(ADVICE, "—");
  const doc = { name: String(out.name || name).slice(0, 60), aliases: (out.aliases || []).slice(0, 8), category: out.category || "Other", short: out.short || "", measures: out.measures, calc: out.calc || "", settings: out.settings || "", limits: out.limits || "",
    sources: sources(out, cited), reviewed: false, requestedAt: new Date().toISOString() };
  await db.set(`indicatorDocs/${id}`, doc);
  return { doc: { ...doc, id } };
}

// ---- /report: three reports hide an explanation until someone reviews it
async function report(db, b) {
  const key = safeId(b.key);
  const d = await db.get(`explain/${key}`);
  if (!d) return { ok: true };
  const reports = (d.reports || 0) + 1;
  await db.set(`explain/${key}`, reports >= 3 ? { reports, status: "hidden" } : { reports });
  return { ok: true };
}
