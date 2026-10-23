// Static checks for mistakes the browser tests can't reach (they run in demo mode, without Firebase).
// 1. A name imported into a file and then declared again inside it (1.2.0: `let onboarding = false` hid the imported
//    onboarding() function, so the app threw "t is not a function" while logging in).
// 2. A name imported from one of the app's files that the file doesn't export.
// 3. An app file missing from the offline copy (sw.js FILES: the app wouldn't open offline) or from index.html's
//    preloads (it would load later, one step behind the file that imports it).
import fs from "node:fs";
const files = fs.readdirSync("web/js").filter((f) => f.endsWith(".js")).map((f) => "web/js/" + f);
let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8"), names = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
  for (const m of src.matchAll(/import\s+(\w+)\s+from/g)) names.add(m[1]);
  src.split("\n").forEach((line, i) => {
    for (const n of names) {
      const decl = new RegExp(`\\b(let|const|var)\\s+(${n}\\b|\\{[^}]*\\b${n}\\b[^}]*\\}\\s*=)|\\bfunction\\s+${n}\\s*\\(|\\b(let|const|var)\\s+[^;=]*,\\s*${n}\\s*(=|,|;)`);
      if (decl.test(line) && !/^\s*\/\//.test(line)) { console.log(`FAIL lint: ${f}:${i + 1} declares "${n}", which is also imported: ${line.trim().slice(0, 120)}`); bad++; }
    }
  });
}
const exportsOf = (f) => {
  const src = fs.readFileSync(f, "utf8"), out = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|class)\s+([\w$]+)/g)) out.add(m[1]);
  // export const A = 1, B = 2: every name before an "=" (a comma inside a value can only add names, never hide one)
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([^;\n]*)/g)) for (const d of m[1].matchAll(/(?:^|,)\s*([\w$]+)\s*=/g)) out.add(d[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) out.add(n); }
  return out;
};
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/([\w.-]+)"/g)) {
    const target = "web/js/" + m[2];
    if (!fs.existsSync(target)) { console.log(`FAIL lint: ${f} imports from ${m[2]}, which doesn't exist`); bad++; continue; }
    const ex = exportsOf(target);
    for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/)[0]; if (n && !ex.has(n)) { console.log(`FAIL lint: ${f} imports "${n}" from ${m[2]}, which doesn't export it`); bad++; } }
  }
}
const sw = fs.readFileSync("web/sw.js", "utf8"), html = fs.readFileSync("web/index.html", "utf8");
const offline = new Set(JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\]);/)[1]));
for (const f of files.map((x) => x.replace("web/", ""))) {
  if (!offline.has(f)) { console.log(`FAIL lint: ${f} is missing from the offline copy (web/sw.js FILES)`); bad++; }
  if (!html.includes(`<link rel="modulepreload" href="${f}">`)) { console.log(`FAIL lint: ${f} is missing from index.html's modulepreload links`); bad++; }
}
for (const f of offline) if (f !== "./" && !fs.existsSync("web/" + f)) { console.log(`FAIL lint: web/sw.js FILES lists ${f}, which doesn't exist`); bad++; }
console.log(bad ? `lint: ${bad} problem(s)` : `lint: ${files.length} files: imports match exports, none declared again, all in the offline copy and preloaded`);
process.exit(bad ? 1 : 0);
