// ESLint, for two mistakes the browser tests can miss on screens they don't reach: a name used but never imported or
// defined (no-undef: the screen would throw), and code nothing uses (no-unused-vars). Run by scripts/check.sh.
// browser-globals.json: every name a Chromium page has (written once from a real browser).
import fs from "node:fs";
const browser = Object.fromEntries(JSON.parse(fs.readFileSync(new URL("browser-globals.json", import.meta.url), "utf8")).map((n) => [n, "readonly"]));
const node = Object.fromEntries(["process", "console", "Buffer", "URL", "URLSearchParams", "fetch", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "AbortController", "AbortSignal", "TextEncoder", "TextDecoder", "structuredClone", "performance", "crypto", "atob", "btoa", "Response", "Request", "Headers", "FormData", "Blob"].map((n) => [n, "readonly"]));
const rules = { "no-undef": "error", "no-unused-vars": ["error", { vars: "all", args: "none", caughtErrors: "none", ignoreRestSiblings: true }], "no-redeclare": "error" };
export default [
  { files: ["web/**/*.js"], languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: browser }, rules },
  { files: ["web/sw.js"], languageOptions: { sourceType: "script", globals: { ...browser, caches: "readonly", clients: "readonly", importScripts: "readonly", firebase: "readonly" } } },
  { files: ["pipeline/**/*.mjs", "scripts/**/*.mjs", "tests/**/*.mjs"], languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: node }, rules },
];
