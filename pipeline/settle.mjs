// Quick prediction run, every 15 minutes (see .github/workflows/settle.yml): locks start prices and scores
// predictions that are due. Prices, news and alerts stay with the full data job (pipeline/run.mjs).
// Env: FIREBASE_SERVICE_ACCOUNT (JSON). Without it there is nothing to do.
import { serviceAccount, firestore } from "./lib/google.mjs";
import { settleOpen } from "./lib/predictions.mjs";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
if (!process.env.FIREBASE_SERVICE_ACCOUNT) { log("No FIREBASE_SERVICE_ACCOUNT: nothing to settle"); process.exit(0); }
const db = firestore(serviceAccount(process.env.FIREBASE_SERVICE_ACCOUNT));
settleOpen(db, { log }).catch((e) => { console.error(e); process.exit(1); });
