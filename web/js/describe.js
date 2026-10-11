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
    case "obvFlow20": case "adFlow20": return `Over 20 days, ${v >= 0 ? "buying" : "selling"}-side volume outweighed the other side by ${pct(v)} of all volume.`;
    case "cmf20": return Math.abs(v) < 0.05 ? "Closes have sat near the middle of each day's range, on balance." : `Over 20 days, closes have tended to sit near the day's ${v > 0 ? "high" : "low"}, weighted by volume.`;
    case "mfi14": return v >= 80 ? "Volume-weighted buying has far outweighed selling over 14 days." : v <= 20 ? "Volume-weighted selling has far outweighed buying over 14 days." : "Volume-weighted buying and selling within the usual range over 14 days.";
    case "stochRsi": return `RSI is ${Math.round(v)}% of the way up its own 14-day range.`;
    case "mom10": return `${v >= 0 ? "Up" : "Down"} ${pct(v)} over 10 days.`;
    case "cmo14": return Math.abs(v) < 20 ? "Up days and down days roughly balanced over 14 days." : `${v > 0 ? "Up" : "Down"} days have outweighed ${v > 0 ? "down" : "up"} days over 14 days.`;
    case "aoPct": return `The 5-day midpoint average is ${pct(v)} of price ${v >= 0 ? "above" : "below"} the 34-day one.`;
    case "trix15": return `The triple-smoothed average ${v >= 0 ? "rose" : "fell"} ${fmt(Math.abs(v), 3)}% on the latest day.`;
    case "uo": return v >= 70 ? "Closes have been near the top of their ranges across 7, 14 and 28 days." : v <= 30 ? "Closes have been near the bottom of their ranges across 7, 14 and 28 days." : "Closes mid-range across 7, 14 and 28 days.";
    case "kst": return `Weighted price change across four time spans is ${v >= 0 ? "positive" : "negative"}${prev?.kst != null && Math.sign(prev.kst) !== Math.sign(v) ? ", and turned on the latest day" : ""}.`;
    case "demaDist": return `${pct(v)} ${v >= 0 ? "above" : "below"} its 20-day double-exponential average.`;
    case "temaDist": return `${pct(v)} ${v >= 0 ? "above" : "below"} its 20-day triple-exponential average.`;
    case "hmaDist": return `${pct(v)} ${v >= 0 ? "above" : "below"} its 20-day Hull average.`;
    case "sarDist": return `Price is ${v >= 0 ? "above" : "below"} the SAR dots, ${pct(v)} away.`;
    case "stDist": return `Price is ${v >= 0 ? "above" : "below"} the Supertrend line, ${pct(v)} away.`;
    case "aroonOsc": return v > 50 ? "The 25-day high is much more recent than the 25-day low." : v < -50 ? "The 25-day low is much more recent than the 25-day high." : "The 25-day high and low are about as recent as each other.";
    case "vortex": return Math.abs(v) < 0.05 ? "Upward and downward movement about equal over 14 days." : `${v > 0 ? "Upward" : "Downward"} movement stronger over 14 days.`;
    case "elderBull": return `Today's high was ${pct(v)} of price ${v >= 0 ? "above" : "below"} the 13-day average.`;
    case "elderBear": return `Today's low was ${pct(v)} of price ${v >= 0 ? "above" : "below"} the 13-day average.`;
    case "ichiCloud": return v === 0 ? "Price is inside the cloud." : `Price is ${pct(v)} ${v > 0 ? "above" : "below"} the cloud.`;
    case "keltPos": return v > 100 ? "Above the upper Keltner band." : v < 0 ? "Below the lower Keltner band." : `${Math.round(v)}% of the way from the lower to the upper band.`;
    case "donPos": return `Closed ${Math.round(v)}% of the way up its 20-day high–low channel.`;
    case "hv20": return `Daily swings over 20 days, scaled to a year, come to about ${fmt(v, 0)}%.`;
    case "changePct": return `${v >= 0 ? "Up" : "Down"} ${pct(v)} on the day.`;
    default: return "";
  }
}
