// Support/resistance and pivot point maths on made-up candles with known answers.
import { swingLevels, pivotLevels } from "../web/js/levels.js";
const day = (i) => new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10);
// A range market: highs keep turning near 100, lows near 80, last close 90.
const bars = [];
for (let i = 0; i < 120; i++) {
  const ph = i % 20, base = ph < 10 ? 80 + ph * 2 : 100 - (ph - 10) * 2; // zig-zag 80 → 100 → 80
  bars.push({ t: day(i), o: base - 0.5, h: base + 1, l: base - 1, c: base + 0.5, v: 1 });
}
bars[119].c = 90;
const v = { bars, win: bars.slice(-91), interval: "1D" };
const sw = swingLevels(v);
const R = sw.filter((l) => l.kind === "R"), S = sw.filter((l) => l.kind === "S");
// Pivot points from the previous calendar month (March 2026 here, as the last bar is in April).
const piv = Object.fromEntries(pivotLevels(v).map((l) => [l.kind, l.price]));
const mar = bars.filter((b) => b.t.startsWith("2026-03")), H = Math.max(...mar.map((b) => b.h)), L = Math.min(...mar.map((b) => b.l)), C = mar.at(-1).c, P = (H + L + C) / 3;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const checks = [
  ["finds resistance where highs turned (~101) with several touches", R.length >= 1 && Math.abs(R[0].price - 101) < 1.5 && R[0].touches >= 3],
  ["finds support where lows turned (~79) with several touches", S.length >= 1 && Math.abs(S[0].price - 79) < 1.5 && S[0].touches >= 3],
  ["at most 2 lines each side, resistance above and support below the last close", R.length <= 2 && S.length <= 2 && R.every((l) => l.price > 90) && S.every((l) => l.price < 90)],
  ["pivot points follow the Traditional formulas from the previous month", near(piv.P, P) && near(piv.R1, 2 * P - L) && near(piv.S1, 2 * P - H) && near(piv.R2, P + (H - L)) && near(piv.S2, P - (H - L))],
];
let ok = 0; for (const [n, pass] of checks) { if (pass) ok++; else console.log("FAIL levels: " + n, JSON.stringify(sw)); }
console.log(`levels: ${ok}/${checks.length} checks passed`);
process.exit(ok === checks.length ? 0 : 1);
