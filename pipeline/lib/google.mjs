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

export function serviceAccount(json, scope = "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging") {
  const sa = typeof json === "string" ? JSON.parse(json) : json;
  let token = null, exp = 0;
  async function accessToken() {
    if (token && Date.now() < exp - 60000) return token;
    const now = Math.floor(Date.now() / 1000);
    const head = enc({ alg: "RS256", typ: "JWT" });
    const claim = enc({ iss: sa.client_email, scope,
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
export function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toFs(x)])) } };
}
export function fromFs(v) {
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
// A document as a plain object with its id and path. When it was last written rides along out of sight (_t), so a
// write can be made only if nothing changed it since it was read (see set's ifUnchanged).
function docOut(d) {
  const o = { id: d.name.split("/").pop(), path: d.name.split("/documents/")[1], ...fromFs({ mapValue: { fields: d.fields || {} } }) };
  return Object.defineProperty(o, "_t", { value: d.updateTime, enumerable: false });
}

export function firestore(sa) {
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
    // Writes the given fields only (merge). Pass {mustNotExist:true} to create without overwriting, or
    // {ifUnchanged: doc} to write only if that document (as read) hasn't been written since.
    async set(path, data, { mustNotExist = false, ifUnchanged = null } = {}) {
      const mask = Object.keys(data).map((k) => "updateMask.fieldPaths=" + encodeURIComponent("`" + k.replace(/`/g, "\\`") + "`")).join("&");
      const pre = mustNotExist ? "&currentDocument.exists=false" : ifUnchanged?._t ? "&currentDocument.updateTime=" + encodeURIComponent(ifUnchanged._t) : "";
      return call("PATCH", `${base()}/${path}?${mask}${pre}`, { fields: toFs(data).mapValue.fields });
    },
    async del(path) { return call("DELETE", `${base()}/${path}`); },
    // Every document in all collections with this id (for example every account's "predictions"), in one query.
    async group(collectionId) {
      const j = await call("POST", `${base()}:runQuery`, { structuredQuery: { from: [{ collectionId, allDescendants: true }] } });
      return (j || []).filter((x) => x.document).map((x) => docOut(x.document));
    },
  };
}

export async function sendPush(sa, token, { title, body, link }) {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.projectId}/messages:send`, {
    method: "POST", headers: { authorization: "Bearer " + (await sa.accessToken()), "content-type": "application/json" },
    body: JSON.stringify({ message: { token, notification: { title, body }, webpush: { fcm_options: link ? { link } : undefined } } }),
  });
  if (r.ok) return "sent";
  const j = await r.json().catch(() => ({}));
  const code = j?.error?.details?.find?.((d) => d.errorCode)?.errorCode || j?.error?.status;
  return code === "UNREGISTERED" || code === "NOT_FOUND" || code === "INVALID_ARGUMENT" ? "dead" : "failed";
}
