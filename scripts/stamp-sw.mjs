// Deploy step (deploy.yml, after minifying): writes each offline-copy file's content fingerprint into sw.js, so a new
// release downloads only the files that changed and reuses the rest from the copy the phone already has.
// node scripts/stamp-sw.mjs <site dir>
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function stamp(dir) {
  const swPath = path.join(dir, "sw.js"), sw = fs.readFileSync(swPath, "utf8");
  const list = sw.match(/const FILES = (\[[\s\S]*?\]);/);
  if (!list || !sw.includes("const HASHES = null;")) throw new Error("sw.js: FILES list or HASHES placeholder not found");
  const files = JSON.parse(list[1]);
  const hashes = Object.fromEntries(files.map((f) => {
    const body = fs.readFileSync(path.join(dir, f === "./" ? "index.html" : f));
    return [f, crypto.createHash("sha256").update(body).digest("hex").slice(0, 12)];
  }));
  fs.writeFileSync(swPath, sw.replace("const HASHES = null;", `const HASHES = ${JSON.stringify(hashes)};`));
  return hashes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const h = stamp(process.argv[2] || "web");
  console.log(`sw.js: ${Object.keys(h).length} files fingerprinted`);
}
