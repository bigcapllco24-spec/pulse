// Data job with simulated Kraken, CoinGecko and GDELT responses (run with: node --import ./tests/mock-network.mjs tests/pipeline.test.mjs)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const out = fs.mkdtempSync("/tmp/pulse-data-");
execFileSync("node", ["--import", new URL("./mock-network.mjs", import.meta.url).pathname, "pipeline/run.mjs", out], { stdio: "pipe" });
const news = JSON.parse(fs.readFileSync(out + "/news.json")), c = JSON.parse(fs.readFileSync(out + "/candles.json"));
const checks = [
  ["writes coin candles", Object.keys(c.series).length >= 1 && c.series["CRYPTO:BTC"].bars.length >= 100],
  ["candles are [date, o, h, l, c, v]", c.series["CRYPTO:BTC"].bars[0].length === 6],
  ["merges one story across two outlets as Confirmed", news.stories[0]?.status === "confirmed" && news.stories[0].outlets.length === 2],
  ["drops opinion headlines", !news.stories.some((s) => /\?|could/i.test(s.title))],
];
const fails = checks.filter(([, ok]) => !ok);
fails.forEach(([n]) => console.log("FAIL pipeline: " + n));
console.log(`pipeline: ${checks.length - fails.length}/${checks.length} checks passed`);
process.exit(fails.length ? 1 : 0);
