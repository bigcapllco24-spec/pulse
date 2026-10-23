// scripts/stamp-sw.mjs: the deploy step that writes each offline-copy file's fingerprint into sw.js.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { stamp } from "../scripts/stamp-sw.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else { fail++; console.log(`FAIL stamp: ${name}${detail ? `  [${detail}]` : ""}`); } };
const site = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-stamp-"));
  fs.mkdirSync(path.join(d, "js"));
  fs.writeFileSync(path.join(d, "index.html"), "<html>");
  fs.writeFileSync(path.join(d, "js/app.js"), "console.log(1)");
  fs.writeFileSync(path.join(d, "sw.js"), `const SHELL = "x";\nconst FILES = ["./", "index.html",\n  "js/app.js"];\nconst HASHES = null;\n`);
  return d;
};
const h12 = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);

{
  const d = site(), h = stamp(d), sw = fs.readFileSync(path.join(d, "sw.js"), "utf8");
  check("every file gets a fingerprint", Object.keys(h).length === 3);
  check("a fingerprint is the file's content hash", h["js/app.js"] === h12("console.log(1)"));
  check("./ is fingerprinted as index.html", h["./"] === h["index.html"] && h["./"] === h12("<html>"));
  check("the fingerprints are written into sw.js", sw.includes(`const HASHES = ${JSON.stringify(h)};`) && !sw.includes("HASHES = null"));
  fs.writeFileSync(path.join(d, "js/app.js"), "console.log(2)");
  fs.writeFileSync(path.join(d, "sw.js"), `const FILES = ["js/app.js"];\nconst HASHES = null;\n`);
  check("a changed file gets a new fingerprint", stamp(d)["js/app.js"] !== h["js/app.js"]);
}
{
  const d = site(); stamp(d);
  let threw = false; try { stamp(d); } catch { threw = true; }
  check("stamping twice is refused (the placeholder is gone)", threw);
}
{
  const d = site(); fs.rmSync(path.join(d, "js/app.js"));
  let threw = false; try { stamp(d); } catch { threw = true; }
  check("a listed file that doesn't exist stops the deploy", threw);
}
{
  const repo = fs.readFileSync(new URL("../web/sw.js", import.meta.url), "utf8");
  check("the repo's sw.js has the placeholder the deploy fills in", repo.includes("const HASHES = null;"));
}
console.log(fail ? `stamp: ${fail} failed, ${pass} passed` : `stamp: ${pass} checks passed`);
process.exit(fail ? 1 : 0);
