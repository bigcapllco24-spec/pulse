// One-off (17 Oct 2026): @vxxrc01 reached the 10-device limit. Empties the account's device list (sign-in ids only;
// calls, score and settings are untouched), then prints the count.
import { serviceAccount, firestore } from "./lib/google.mjs";
const db = firestore(serviceAccount(process.env.FIREBASE_SERVICE_ACCOUNT));
const u = await db.get("usernames/vxxrc01");
await db.set(`accounts/${u.acct}`, { devices: [] });
const a = await db.get(`accounts/${u.acct}`);
console.log("::notice::" + ["devices now:", a.devices.length, "| username:", a.username, "| watchlists kept:", (a.watchlists || []).length].join(" "));
