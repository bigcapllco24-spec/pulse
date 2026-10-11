// Data job with simulated Kraken, CoinGecko and GDELT responses (run with: node --import ./tests/mock-network.mjs tests/pipeline.test.mjs)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const out = fs.mkdtempSync("/tmp/pulse-data-");
execFileSync("node", ["--import", new URL("./mock-network.mjs", import.meta.url).pathname, "pipeline/run.mjs", out], { stdio: "pipe" });
const news = JSON.parse(fs.readFileSync(out + "/news.json")), c = JSON.parse(fs.readFileSync(out + "/candles.json"));
const checks = [
  ["writes coin candles", Object.keys(c.series).length >= 1 && c.series["CRYPTO:BTC"].bars.length >= 100],
  ["candles are [date, o, h, l, c, v]", c.series["CRYPTO:BTC"].bars[0].length === 6],
  ["official project releases are labelled From the project, stable releases only", news.stories.some((s) => s.status === "official" && s.official === "Bitcoin Core" && /31\.0 released/.test(s.title)) && !news.stories.some((s) => /rc1/.test(s.title))],
  ["drops opinion headlines", !news.stories.some((s) => /\?|could/i.test(s.title))],
  ["a coin story reported by two outlets (GDELT + a crypto desk's feed) is Confirmed", news.stories.some((s) => s.syms.includes("CRYPTO:BTC") && s.status === "confirmed" && s.outlets.includes("Reuters") && s.outlets.includes("CoinDesk"))],
  ["drops price predictions and doesn't match ordinary words to tickers (link, hype)", !news.stories.some((s) => /prediction/i.test(s.title)) && !news.stories.some((s) => /claim your/i.test(s.title) && (s.syms.includes("CRYPTO:LINK") || s.syms.includes("CRYPTO:HYPE")))],
];
const fails = checks.filter(([, ok]) => !ok);
fails.forEach(([n]) => console.log("FAIL pipeline: " + n));
console.log(`pipeline: ${checks.length - fails.length}/${checks.length} checks passed`);
process.exit(fails.length ? 1 : 0);
