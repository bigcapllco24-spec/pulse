// Prediction game, live accounts: lock start prices, resolve predictions that are due, and keep each score up to date
// (score2.mjs). Runs in the data jobs with the service account, so nobody can change their own score.
//
// Firestore layout (see firestore.rules):
//   accounts/{uid}/predictions/{TICKER}_{period}   open predictions, created by the app, one per coin and period
//   accounts/{uid}/results/{id}                    scored or voided predictions, written here only
//   accounts/{uid}.pscore                          { score, band, n, provisional, at, v, market, flag, held }, here only
import { settle, rowCache, krakenRows, contextAt } from "../../web/js/predict.js";
import { relabel } from "../../web/js/score.js";
import { scoreRecord } from "./score2.mjs";

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
  const tally = { locked: 0, scored: 0, void: 0, profiles: 0, context: 0 }, scoredBy = new Map(), openBy = new Map();
  for (const a of accounts) {
    try { await settleAccount(a); } catch (e) { log(`predictions: account ${a.id} skipped this run: ${e.message}`); } // one account's error never stops the rest
  }
  log(`predictions: ${tally.locked} locked, ${tally.scored} scored, ${tally.void} voided, ${tally.profiles} scores${tally.context ? `, ${tally.context} results given market context` : ""}`);
  return { ...tally, results: scoredBy, open: openBy };

  async function settleAccount(a) {
    const open = a.open || await db.list(`accounts/${a.id}/predictions`);
    let resolved = 0; const still = []; openBy.set(a.id, still);
    for (const p of open) {
      const { id, path, ...doc } = p;
      let res;
      try { res = await settle(doc, { now, rows }); } catch (e) { log(`predictions: ${a.id}/${id} skipped: ${e.message}`); continue; }
      if (res.patch.p0 != null) tally.locked++;
      if (res.status === "open") {
        still.push({ ...doc, ...res.patch });
        // only onto the prediction as it was read: if the other job scored and deleted it meanwhile, a patch would
        // bring back a broken half of it
        if (Object.keys(res.patch).length) { try { await db.set(`accounts/${a.id}/predictions/${id}`, res.patch, { ifUnchanged: p }); } catch (e) { log(`predictions: ${a.id}/${id} changed while settling, left for the next run (${e.status || e.message})`); } }
        continue;
      }
      // scored or voided: move it to results (a fresh id, as the same coin and period can be predicted again)
      const rid = `${id}_${Date.parse(doc.createdAt)}`;
      await db.set(`accounts/${a.id}/results/${rid}`, { ...doc, ...res.patch });
      await db.del(`accounts/${a.id}/predictions/${id}`);
      tally[res.status === "scored" ? "scored" : "void"]++; resolved++;
    }
    // The quick run updates only scores that changed; the full run also rescores everyone with a score from an older
    // method (pscore.v below 2), so switching methods recalculates every account from all its calls.
    if (a.open ? !resolved : !open.length && !a.pscore) return;
    const all = await db.list(`accounts/${a.id}/results`), results = all.filter((r) => r.status === "scored").map(relabel); // labels under today's rule
    tally.context += await backfillContext(db, a.id, results, rows, log);
    scoredBy.set(a.id, results);
    if (!results.length) return;
    const ps = scoreRecord(results, { now });
    if (!ps) return;
    // the quick run only knows the account's id: read its current score, so the old one is never lost
    const cur = "pscore" in a ? a.pscore : (db.get ? (await db.get(`accounts/${a.id}`))?.pscore : null);
    if (cur && cur.v !== 2) ps.was = { score: cur.score ?? null, v: cur.v || 1 }; // the score before v2, for the one-time note
    else if (cur?.was) ps.was = cur.was;
    a.pscore = ps; // the player cards use it next
    await db.set(`accounts/${a.id}`, { pscore: ps });
    tally.profiles++;
  }
}

// Results scored before 1.4.0 have no market context (prev, tr90): worked out once from Kraken's daily candles (720 days
// covers every result) and written back. Results whose candles can't be had are left for the next run.
async function backfillContext(db, acct, results, rows, log) {
  let n = 0;
  for (const r of results) {
    if ("prev" in r && "tr90" in r) continue;
    let daily, ctx; try { daily = await rows(r.t, 1440); ctx = contextAt(daily, r.createdAt); } catch { continue; }
    if (!daily.length) continue; // no candles this run (Kraken down, or a coin it doesn't list): try again next run
    // with candles but no context (too early in the coin's history): saved as unknown, so it isn't looked up again
    Object.assign(r, ctx);
    try { await db.set(`accounts/${acct}/results/${r.id}`, ctx); n++; } catch (e) { log(`predictions: context for ${acct}/${r.id} not saved: ${e.message}`); }
  }
  return n;
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
