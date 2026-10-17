// One-off: why can't @vxxrc01 log in? Prints only facts about the account's shape, no personal data.
import { serviceAccount, firestore } from "./lib/google.mjs";
const db = firestore(serviceAccount(process.env.FIREBASE_SERVICE_ACCOUNT));
const name = "vxxrc01", u = await db.get(`usernames/${name}`);
console.log("::notice::" + ["usernames doc exists:", !!u, "| has acct:", !!u?.acct].join(" "));
if (u?.acct) {
  const a = await db.get(`accounts/${u.acct}`);
  console.log("::notice::account exists: " + !!a);
  if (a) console.log("::notice::" + ["account.username:", JSON.stringify(a.username), "| matches:", a.username === name, "| devices:", Array.isArray(a.devices) ? a.devices.length : typeof a.devices, "| fields:", Object.keys(a).sort().join(",")].join(" "));
}
const n = (await db.list("usernames")).length; console.log("::notice::usernames in total: " + n);
