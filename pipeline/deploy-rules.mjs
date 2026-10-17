// Publishes firestore.rules to the live database when they differ from what's live, so the rules can never fall
// behind the app again (17 Oct 2026: the app sent fields the live rules didn't know, and calls were refused).
// Run by the deploy workflow before the site is published; a rules file that doesn't compile stops the deploy.
// Usage: node pipeline/deploy-rules.mjs [--check]   (--check: compile and compare only, publish nothing)
// Env: FIREBASE_SERVICE_ACCOUNT
import fs from "node:fs";
import { serviceAccount } from "./lib/google.mjs";

const say = (m) => console.log((process.env.GITHUB_ACTIONS ? "::notice::" : "") + m);
const sa = serviceAccount(process.env.FIREBASE_SERVICE_ACCOUNT, "https://www.googleapis.com/auth/cloud-platform");
const P = `projects/${sa.projectId}`, API = "https://firebaserules.googleapis.com/v1";
async function call(method, path, body) {
  const r = await fetch(`${API}/${path}`, { method, headers: { authorization: "Bearer " + (await sa.accessToken()), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j.error || j).slice(0, 600)}`);
  return j;
}
const source = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const release = await call("GET", `${P}/releases/cloud.firestore`);
const live = await call("GET", release.rulesetName);
const liveSrc = live.source?.files?.[0]?.content || "";
if (liveSrc.trim() === source.trim()) { say(`Rules: the live rules already match firestore.rules (${release.rulesetName.split("/").pop()}).`); process.exit(0); }
// compiling happens when the ruleset is created: a mistake in the file fails here, before anything changes
const made = await call("POST", `${P}/rulesets`, { source: { files: [{ name: "firestore.rules", content: source }] } });
if (process.argv.includes("--check")) { say(`Rules: firestore.rules compiles (${made.name.split("/").pop()}) and differs from the live rules; not published (--check).`); process.exit(0); }
await call("PATCH", `${P}/releases/cloud.firestore`, { release: { name: `${P}/releases/cloud.firestore`, rulesetName: made.name } });
say(`Rules: published firestore.rules (${made.name.split("/").pop()}), replacing ${release.rulesetName.split("/").pop()}.`);
