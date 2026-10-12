// The indicator panels under a chart, opened large in a sheet (the ⤢ button on the feed card and the full-screen
// chart). Same candles and period as the chart they came from; tap a panel for its guide.
import { lowerChart } from "./chart.js";
import { openLearn } from "./interact.js";
import { esc, openSheet } from "./ui.js";

const ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 2h4v4M14 2l-5 5M6 14H2v-4M2 14l5-5"/></svg>`;
export const expandBtn = (n) => (n ? `<button class="pexp" data-pexp aria-label="Open the ${n} indicator panel${n > 1 ? "s" : ""} large">${ICON}</button>` : "");
export function openPanels(v, sym, days) {
  const ks = v?.picks?.lower || [];
  if (!ks.length) return;
  const geo = { full: true, count: v.count || v.win.length, shift: v.shift || 0, days };
  openSheet(`Indicators · ${esc(sym.t)}`, `<p class="hint">${v.ivLabel ? `${esc(v.ivLabel)} candles, ` : ""}the same period as the chart. Tap a panel for its guide.</p>
    <div class="pbig">${ks.map((k) => lowerChart(v.win, v.ov, k, geo)).join("")}</div>`,
  (body) => body.querySelectorAll("[data-learn]").forEach((p) => (p.onclick = () => openLearn(p.dataset.learn, v))));
}
