// Plain-language meaning of a reading. Describes what the number shows; never what to do about it.
import { fmt } from "./indicators.js";

const pct = (x) => fmt(Math.abs(x), 1) + "%";

export function describe(metric, now, prev) {
  const v = now?.[metric];
  if (v == null) return "Not enough history yet.";
  switch (metric) {
    case "rsi14":
      if (v >= 70) return "Gains have far outweighed losses over 14 days.";
      if (v <= 30) return "Losses have far outweighed gains over 14 days.";
      if (v >= 55) return "Gains slightly ahead of losses over 14 days.";
      if (v <= 45) return "Losses slightly ahead of gains over 14 days.";
      return "Gains and losses roughly balanced over 14 days.";
    case "distSma20Pct": return `${pct(v)} ${v >= 0 ? "above" : "below"} its 20-day average.`;
    case "distSma50Pct": return `${pct(v)} ${v >= 0 ? "above" : "below"} its 50-day average.`;
    case "ema20": { const d = ((now.price - v) / v) * 100; return `${pct(d)} ${d >= 0 ? "above" : "below"} its 20-day exponential average.`; }
    case "macdHist": {
      const p = prev?.macdHist;
      const turned = p != null && Math.sign(p) !== Math.sign(v) ? (v > 0 ? " Turned positive on the latest bar." : " Turned negative on the latest bar.") : "";
      return (v >= 0 ? "Fast average is above its signal line." : "Fast average is below its signal line.") + turned;
    }
    case "pctB":
      if (v > 1) return "Above the upper band.";
      if (v < 0) return "Below the lower band.";
      return `${Math.round(v * 100)}% of the way from the lower to the upper band.`;
    case "distHigh50Pct": return v >= -0.05 ? "At its 50-day high." : `${pct(v)} below its 50-day high.`;
    case "volRatio": return `${fmt(v, 1)} times the usual daily volume.`;
    case "atrPct": return `Moves about ${fmt(v, 1)}% on a typical day.`;
    case "stochK": return `Closed ${Math.round(v)}% of the way up its 14-day range.`;
    case "willR": return `Closed ${Math.round(-v)}% below the top of its 14-day range.`;
    case "cci20": return Math.abs(v) <= 100 ? "Within its usual distance from the average." : `Unusually far ${v > 0 ? "above" : "below"} its average.`;
    case "adx14": return v < 20 ? "Weak trend: prices mostly moving sideways." : v < 40 ? "A moderate trend is in place." : "A strong trend is in place.";
    case "roc12": return `${v >= 0 ? "Up" : "Down"} ${pct(v)} over 12 trading days.`;
    case "changePct": return `${v >= 0 ? "Up" : "Down"} ${pct(v)} on the day.`;
    default: return "";
  }
}
