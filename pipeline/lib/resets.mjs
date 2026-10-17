// Password resets (1.2.0). An account has a username and a password but no email, so "forgot my password" works with
// the recovery code shown once at sign-up: the app writes resets/{signInId} = {name, codeHash, pw, status: "waiting"},
// readable only by that sign-in. This job (every 15 minutes) checks the code's hash against the account's, sets the
// new password on the account's sign-in through the Identity Toolkit admin API, removes the password from the
// request and marks it done (or bad). A request older than a day is deleted either way.
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const EMAIL = (name) => `${name}@pulse.app`;

export async function processResets(db, sa, { log = () => {} } = {}) {
  const reqs = await db.list("resets");
  let done = 0, bad = 0;
  for (const r of reqs) {
    const age = Date.now() - Date.parse(r.at || 0);
    if (r.status !== "waiting" || !r.pw) { if (age > 864e5) await db.del(`resets/${r.id}`).catch(() => {}); continue; }
    try {
      const nameDoc = await db.get(`usernames/${r.name}`), acct = nameDoc?.acct && (await db.get(`accounts/${nameDoc.acct}`));
      const ok = acct && acct.recoveryHash && r.codeHash === acct.recoveryHash && typeof r.pw === "string" && r.pw.length >= 8 && r.pw.length <= 100;
      if (ok) {
        await setPassword(sa, nameDoc.acct, EMAIL(r.name), r.pw);
        await db.set(`accounts/${nameDoc.acct}`, { recoveryHash: sha("used:" + r.codeHash), recoveryUsedAt: new Date().toISOString() }); // one-time: the code can't be reused
        done++;
      } else bad++;
      await db.set(`resets/${r.id}`, { pw: "", codeHash: "", status: ok ? "done" : "bad", doneAt: new Date().toISOString() });
    } catch (e) { log("reset failed", r.id, e.message); }
  }
  if (reqs.length) log(`resets: ${done} done, ${bad} bad of ${reqs.length}`);
}

// Identity Toolkit: find the sign-in by its id and set a password (and the email the app logs in with, in case the
// sign-in has none yet). Needs the service account's token with the identitytoolkit scope (google.mjs asks for it).
async function setPassword(sa, uid, email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.projectId}/accounts:update`, {
    method: "POST", headers: { authorization: "Bearer " + (await sa.accessToken()), "content-type": "application/json" },
    body: JSON.stringify({ localId: uid, email, password }),
  });
  if (!r.ok) throw new Error(`accounts:update ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
