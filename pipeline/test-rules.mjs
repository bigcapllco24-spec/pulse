// Checks the log-in rule with Firebase's own rules tester (no data is read or written). Run in CI.
import fs from "node:fs";
import { serviceAccount } from "./lib/google.mjs";
const sa = serviceAccount(process.env.FIREBASE_SERVICE_ACCOUNT, "https://www.googleapis.com/auth/cloud-platform");
const say = (m) => console.log("::notice::" + m);
const content = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const path = "/databases/(default)/documents/accounts/OWNER";
const acct = (devices) => ({ username: "ana", usernameChanges: 0, watchlists: [], devices });
const many = Array.from({ length: 15 }, (_, i) => "old" + i);
const getMock = (devices) => ({ function: "get", args: [{ anyValue: {} }], result: { value: { data: acct(devices) } } });
const exMock = { function: "exists", args: [{ anyValue: {} }], result: { value: true } };
const c = (name, expectation, uid, before, after) => ({ name, t: { expectation, request: { auth: { uid }, path, method: "update", resource: { data: acct(after) }, time: "2026-10-17T06:00:00Z" }, resource: { data: acct(before) }, functionMocks: [getMock(before), exMock, { function: "getAfter", args: [{ anyValue: {} }], result: { value: { data: acct(after) } } }, { function: "existsAfter", args: [{ anyValue: {} }], result: { value: true } }] } });
const cases = [
  c("a new phone adds itself", "ALLOW", "new1", ["a", "b"], ["a", "b", "new1"]),
  c("a new phone adds itself to an account already on 15 phones (no limit)", "ALLOW", "new1", many, [...many, "new1"]),
  c("a phone can't remove another phone", "DENY", "new1", ["a", "b"], ["b", "new1"]),
  c("a phone can't add someone else", "DENY", "new1", ["a"], ["a", "other"]),
];
const r = await fetch(`https://firebaserules.googleapis.com/v1/projects/${sa.projectId}:test`, { method: "POST", headers: { authorization: "Bearer " + (await sa.accessToken()), "content-type": "application/json" },
  body: JSON.stringify({ source: { files: [{ name: "firestore.rules", content }] }, testSuite: { testCases: cases.map((x) => x.t) } }) });
const j = await r.json();
if (!r.ok) { say("rules test call failed: " + JSON.stringify(j).slice(0, 500)); process.exit(1); }
let bad = 0;
(j.testResults || []).forEach((t, i) => { const ok = t.state === "SUCCESS"; if (!ok) bad++; say(`${ok ? "PASS" : "FAIL"} ${cases[i].name}${ok ? "" : " — " + JSON.stringify(t.debugMessages || t.errorPosition || t).slice(0, 300)}`); });
process.exit(bad ? 1 : 0);
