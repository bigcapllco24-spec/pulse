// The rules every call follows and what a scored call shows, on made-up calls with known answers. (The score itself is
// tested in tests/score2.test.mjs.)
import { scorePrediction, relabel, closenessText, checkPrediction, canPredict, callSizes, callDir, isRight, dailyVol, typicalMove, bandOf, HORIZONS, MAX_MOVE, PICK_MIN_MOVE } from "../web/js/score.js";

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const m1d = typicalMove(0.025, "1d"), at = (k) => 100 * Math.exp(k * m1d); // a price k typical moves from 100
const call = (target, actual, extra = {}) => ({ status: "scored", horizon: "1d", p0: 100, clientP0: 100, target, actual, sigmaD: 0.025, ...extra });

const btc = scorePrediction({ horizon: "1d", p0: 82000, clientP0: 82000, target: 84000, actual: 83500, sigmaD: 0.025 });
const m30 = typicalMove(0.025, "30m"), m1y = typicalMove(0.025, "1y");
const short = scorePrediction({ horizon: "30m", p0: 100, target: 100 * Math.exp(m30), actual: 100 * Math.exp(0.4 * m30), sigmaD: 0.025 });
const long = scorePrediction({ horizon: "1y", p0: 100, target: 100 * Math.exp(m1y), actual: 100 * Math.exp(0.4 * m1y), sigmaD: 0.025 });
const wrong = scorePrediction(call(at(0.3), at(-0.05)));
const flatIn = scorePrediction(call(100, at(0.2))), flatOut = scorePrediction(call(100, at(0.6)));
const passed = call(at(0.1), at(0.5), { p0: at(0.3), clientP0: 100 }); // called a little up; the price passed it before the lock

const checks = [
  ["typical move: daily volatility × √days, never below the 0.2% floor", near(typicalMove(0.02, "1d"), 0.02) && near(typicalMove(0.02, "1y"), 0.02 * Math.sqrt(365)) && near(typicalMove(0.0001, "1d"), 0.002)],
  ["daily volatility is the standard deviation of daily log returns", near(dailyVol([100, 101, 100, 101, 100]), Math.sqrt((4 * Math.log(1.01) ** 2) / 3), 1e-9) && dailyVol([100, 101]) === null],
  ["worked example: BTC 82,000 → called 84,000, ended 83,500 (1 day, 2.5% vol): 0.24 typical moves off, Spot on, right direction", near(btc.miss, Math.log(84000 / 83500) / 0.025, 1e-9) && btc.label === "Spot on" && btc.direction === 1],
  ["misses are measured in typical moves: 0.6 off is Close on 30 minutes and on 1 year alike", near(short.miss, 0.6, 1e-9) && near(long.miss, 0.6, 1e-9) && short.label === "Close" && long.label === "Close"],
  ["a call that went the wrong way is never better than Off, even when near the price", wrong.direction === 0 && wrong.label === "Off"],
  ["No change: Spot on when the price ends within a quarter of a typical move; otherwise never better than Off", flatIn.label === "Spot on" && flatIn.direction === 1 && flatOut.label === "Off" && flatOut.direction === 0],
  ["the direction is the one chosen against the price shown, even if the price passed the call before the lock", callDir(passed) === 1 && isRight(passed) && callDir(call(100, 100)) === 0 && callDir({ target: 90, p0: 100 }) === -1],
  ["right direction: up and up, down and down, No change and close", isRight(call(at(1), at(0.5))) && isRight(call(at(-1), at(-2))) && !isRight(call(at(1), at(-0.5))) && isRight(call(100, at(-0.1))) && !isRight(call(100, at(1))) && !isRight({ ...call(at(1), at(1)), status: "void" })],
  ["a call can be any size above zero, up to six typical moves", checkPrediction({ horizon: "1d", p0: 100, target: at(0.01), sigmaD: 0.025 }).ok && checkPrediction({ horizon: "1d", p0: 100, target: at(MAX_MOVE - 0.01), sigmaD: 0.025 }).ok && !checkPrediction({ horizon: "1d", p0: 100, target: at(MAX_MOVE + 0.01), sigmaD: 0.025 }).ok],
  ["today's price itself only as No change", !checkPrediction({ horizon: "1d", p0: 100, target: 100, sigmaD: 0.025 }).ok && checkPrediction({ horizon: "1d", p0: 100, target: 100, sigmaD: 0.025, flat: true }).ok && !checkPrediction({ horizon: "1d", p0: 100, target: 101, sigmaD: 0.025, flat: true }).ok],
  ["a group pick (no price-shown on record) keeps the quarter-move minimum; a call doesn't", !checkPrediction({ horizon: "1d", p0: 100, target: at(0.2), sigmaD: 0.025, minMove: PICK_MIN_MOVE }).ok && checkPrediction({ horizon: "1d", p0: 100, target: at(0.25), sigmaD: 0.025, minMove: PICK_MIN_MOVE }).ok && checkPrediction({ horizon: "1d", p0: 100, target: at(0.2), sigmaD: 0.025 }).ok],
  ["unknown periods and bad prices are refused", !checkPrediction({ horizon: "2d", p0: 100, target: 101, sigmaD: 0.025 }).ok && !checkPrediction({ horizon: "1d", p0: 0, target: 101, sigmaD: 0.025 }).ok],
  ["one open call per coin and period", !canPredict([{ coin: "CRYPTO:BTC", horizon: "1d" }], "CRYPTO:BTC", "1d") && canPredict([{ coin: "CRYPTO:BTC", horizon: "1d", actual: 1 }], "CRYPTO:BTC", "1d") && canPredict([{ coin: "CRYPTO:BTC", horizon: "1h" }], "CRYPTO:BTC", "1d")],
  ["the sizes offered: a touch, a little and a usual move for the period", JSON.stringify(callSizes("1d")) === JSON.stringify([["A touch", 0.25], ["A little", 0.5], ["A usual day", 1]]) && callSizes("1y")[2][0] === "A usual year"],
  ["relabel gives an old result today's label; the line reads % off and the label", relabel({ ...call(at(0.3), at(-0.05)), label: "Spot on" }).label === "Off" && closenessText({ pctOff: 0.62, label: "Very close" }) === "0.6% above · Very close" && closenessText({ pctOff: -0.01, label: "Spot on" }) === "Exact · Spot on"],
  ["bands: Below guessing under 550, Building to 649, Proven from 650", bandOf(549) === "Below guessing" && bandOf(550) === "Building" && bandOf(649) === "Building" && bandOf(650) === "Proven" && bandOf(null) === null],
  ["every period has a label and a length", Object.values(HORIZONS).every((h) => h.label && h.days > 0)],
];
let ok = 0; for (const [n, pass] of checks) { if (pass) ok++; else console.log("FAIL score: " + n); }
if (process.argv.includes("-v")) for (const [n, pass] of checks) console.log(`${pass ? "ok  " : "FAIL"} ${n}`);
console.log(`score: ${ok}/${checks.length} checks passed`);
process.exit(ok === checks.length ? 0 : 1);
