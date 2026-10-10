// AI relay with simulated Google sign-in, Firestore and Claude responses (run with: node tests/worker.test.mjs)
import worker from "../worker/worker.js";
const { subtle } = crypto;
const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
// service account key
const sa = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" }, true, ["sign","verify"]);
const pk = Buffer.from(await subtle.exportKey("pkcs8", sa.privateKey)).toString("base64");
const SA = JSON.stringify({ project_id: "proj", client_email: "x@proj.iam", private_key: `-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----\n` });
// firebase user token signer
const fk = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" }, true, ["sign","verify"]);
const jwk = { ...(await subtle.exportKey("jwk", fk.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const h = enc({ alg: "RS256", kid: "k1" }), p = enc({ aud: "proj", iss: "https://securetoken.google.com/proj", exp: Date.now()/1000 + 600, sub: "user1" });
const sig = Buffer.from(await subtle.sign("RSASSA-PKCS1-v1_5", fk.privateKey, new TextEncoder().encode(`${h}.${p}`))).toString("base64url");
const TOKEN = `${h}.${p}.${sig}`;
const store = {}; let claudeCalls = 0; let reply = 'Reported: ... {"text": "Reliance signed a two-year fuel supply deal worth about $2 billion with a state refiner, roughly 2% of its annual revenue of about $110 billion. It matters because it adds steady volume to the refining segment, which earns most of its sales. The thing to watch is whether the contract terms set pricing linked to benchmarks.", "sources":[{"label":"Reuters","url":"https://reuters.com/x"}]}';
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes("jwk/securetoken")) return new Response(JSON.stringify({ keys: [jwk] }));
  if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
  if (url.includes("firestore.googleapis.com")) {
    const path = decodeURIComponent(url.split("/documents/")[1].split("?")[0]);
    if (init.method === "GET") return store[path] ? new Response(JSON.stringify({ name: "x/documents/" + path, fields: store[path] })) : new Response("{}", { status: 404 });
    store[path] = { ...(store[path] || {}), ...JSON.parse(init.body).fields }; return new Response(JSON.stringify({}));
  }
  if (url.includes("anthropic")) { claudeCalls++; const b = JSON.parse(init.body); return new Response(JSON.stringify({ content: [{ type: "text", text: reply, citations: [{ url: "https://cnbc.com/y", title: "CNBC" }] }] })); }
  return new Response("{}", { status: 404 });
};
const env = { ANTHROPIC_API_KEY: "k", FIREBASE_SERVICE_ACCOUNT: SA };
const call = async (route, body, tok = TOKEN) => { const r = await worker.fetch(new Request("https://w" + route, { method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify(body) }), env); return [r.status, await r.json()]; };
const checks = [];
checks.push(["rejects requests without a valid sign-in", (await call("/explain", { key: "n1" }, "bad.x.y"))[0] === 401]);
let [s, o] = await call("/explain", { key: "n1", title: "Reliance deal", companies: [{ ticker: "RELIANCE", name: "Reliance", market: "NSE" }] });
checks.push(["explains a story with sources", s === 200 && o.doc.status === "done" && o.doc.sources.length >= 1]);
const before = claudeCalls; [s, o] = await call("/explain", { key: "n1" });
checks.push(["serves a cached explanation without calling Claude again", o.doc.status === "done" && claudeCalls === before]);
reply = '{"text": "Bitcoin fell and this looks like a buying opportunity before it will rise again soon. Traders see upside as the market rebounds from oversold levels with strong support and volume returning to exchanges across the week ahead, according to several reports seen today in markets."}';
[s, o] = await call("/why", { id: "m1", key: "CRYPTO:BTC", ticker: "BTC", name: "Bitcoin", market: "CRYPTO", date: "2026-10-10", changePct: -5, atrPct: 2 });
checks.push(["refuses text with advice or forecast words", o.doc.status === "failed"]);
reply = '{"matches":[{"ticker":"ETERNAL","market":"NSE"}]}';
[s, o] = await call("/resolve", { q: "zomato" });
checks.push(["resolves a nickname to a ticker", o.matches?.[0]?.ticker === "ETERNAL"]);
for (let i = 0; i < 3; i++) await call("/report", { key: "n1" });
checks.push(["hides an explanation after 3 reports", store["explain/n1"].status?.stringValue === "hidden"]);
const fails = checks.filter(([, ok]) => !ok);
fails.forEach(([n]) => console.log("FAIL worker: " + n));
console.log(`worker: ${checks.length - fails.length}/${checks.length} checks passed`);
process.exit(fails.length ? 1 : 0);
