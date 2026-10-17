// Quick prediction run, every 15 minutes (see .github/workflows/settle.yml): locks start prices and scores
// predictions that are due, then does the same for group picks and reveals finished group challenges (with a push to
// the group). Prices, news, alerts and player cards stay with the full data job (pipeline/run.mjs).
// Env: FIREBASE_SERVICE_ACCOUNT (JSON). Without it there is nothing to do. SITE_URL (optional, for push links).
import { serviceAccount, firestore, sendPush } from "./lib/google.mjs";
import { settleOpen, runRows } from "./lib/predictions.mjs";
import { settleChallenges, pusher } from "./lib/challenges.mjs";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
if (!process.env.FIREBASE_SERVICE_ACCOUNT) { log("No FIREBASE_SERVICE_ACCOUNT: nothing to settle"); process.exit(0); }
const sa = serviceAccount(process.env.FIREBASE_SERVICE_ACCOUNT), db = firestore(sa);
const rows = runRows(undefined, log); // one set of candles for both steps
const site = (process.env.SITE_URL || "https://bigcapllco24-spec.github.io/pulse").replace(/\/$/, "");
try {
  await settleOpen(db, { log, rows });
  await settleChallenges(db, { log, rows, notify: pusher(db, sa, sendPush, site) });
} catch (e) { console.error(e); process.exit(1); }
