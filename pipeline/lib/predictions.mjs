// Prediction game, live accounts: lock start prices, resolve predictions that are due, and keep each profile score
// up to date. Runs in the data job with the service account, so nobody can change their own scores.
//
// Firestore layout (see firestore.rules):
//   accounts/{uid}/predictions/{TICKER}_{period}   open predictions, created by the app, one per coin and period
//   accounts/{uid}/results/{id}                    scored or voided predictions, written here only
//   accounts/{uid}.pscore                          { score, band, provisional, n, at }, written here only
import { settle, rowCache, krakenRows } from "../../web/js/predict.js";
import { profileScore } from "../../web/js/score.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One Kraken call about every second, as Kraken asks.
export function politeKraken(fetchFn = fetch) {
  let last = 0;
  return async (t, iv) => {
    const wait = last + 1100 - Date.now(); if (wait > 0) await sleep(wait);
    last = Date.now();
    return krakenRows(t, iv, fetchFn);
  };
}

// Candles for one run, each coin and size fetched once; a failed fetch counts as "no candles yet".
export const runRows = (fetchRows = politeKraken(), log = console.log) =>
  rowCache(async (t, iv) => { try { return await fetchRows(t, iv); } catch (e) { log(`candles: ${t} ${iv}m failed: ${e.message}`); return []; } });

// Returns a tally, plus results: each account's scored results (for the player cards), and open: each account's
// predictions still open (for streaks), for the accounts it read.
export async function settlePredictions(db, accounts, { now = Date.now(), fetchRows, log = console.log, rows = runRows(fetchRows, log) } = {}) {
  const tally = { locked: 0, scored: 0, void: 0, profiles: 0 }, scoredBy = new Map(), openBy = new Map();
  for (const a of accounts) {
    const open = a.open || await db.list(`accounts/${a.id}/predictions`);
    let resolved = 0; const still = []; openBy.set(a.id, still);
    for (const p of open) {
      const { id, path, ...doc } = p;
      let res;
      try { res = await settle(doc, { now, rows }); } catch (e) { log(`predictions: ${a.id}/${id} skipped: ${e.message}`); continue; }
      if (res.patch.p0 != null) tally.locked++;
      if (res.status === "open") { still.push({ ...doc, ...res.patch }); if (Object.keys(res.patch).length) await db.set(`accounts/${a.id}/predictions/${id}`, res.patch); continue; }
      // scored or voided: move it to results (a fresh id, as the same coin and period can be predicted again)
      const rid = `${id}_${Date.parse(doc.createdAt)}`;
      await db.set(`accounts/${a.id}/results/${rid}`, { ...doc, ...res.patch });
      await db.del(`accounts/${a.id}/predictions/${id}`);
      tally[res.status === "scored" ? "scored" : "void"]++; resolved++;
    }
    // Every run, not only when something resolved: older results fade, so the score moves with time.
    if (a.open ? !resolved : !open.length && !a.pscore) continue; // the quick run updates only scores that changed
    const results = (await db.list(`accounts/${a.id}/results`)).filter((r) => r.status === "scored");
    scoredBy.set(a.id, results);
    if (!results.length) continue;
    const ps = profileScore(results, now);
    a.pscore = { score: ps.score, band: ps.band, provisional: ps.provisional, n: ps.n, at: new Date(now).toISOString() }; // the player cards use it next
    await db.set(`accounts/${a.id}`, { pscore: a.pscore });
    tally.profiles++;
  }
  log(`predictions: ${tally.locked} locked, ${tally.scored} scored, ${tally.void} voided, ${tally.profiles} profile scores`);
  return { ...tally, results: scoredBy, open: openBy };
}

// The quick run (every 15 minutes): one query finds every open prediction, so only accounts with something open
// are touched and 30-minute and 1-hour calls are scored soon after they're due. Fading is left to the full run.
export async function settleOpen(db, opts = {}) {
  const by = new Map();
  for (const p of await db.group("predictions")) {
    const acct = (p.path || "").split("/")[1];
    if (acct) (by.get(acct) || by.set(acct, []).get(acct)).push(p);
  }
  return settlePredictions(db, [...by].map(([id, open]) => ({ id, open })), opts);
}
