// Static checks for mistakes the browser tests can't reach (they run in demo mode, without Firebase).
// 1. A name imported into a file and then declared again inside it (1.2.0: `let onboarding = false` hid the imported
//    onboarding() function, so the app threw "t is not a function" while logging in).
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
console.log(bad ? `lint: ${bad} problem(s)` : `lint: ${files.length} files, no imported name declared again`);
process.exit(bad ? 1 : 0);
