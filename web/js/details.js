// A card's details pane, "Before you call" (swipe left on the feed): how much the coin usually moves, the facts right
// now, your calls and alerts on it, and the folded sections about its price. Facts and explanations, never advice.
import { store, chartSettings } from "./store.js";
import { openCoinCalls } from "./calls.js";
import { TYLABEL } from "./search.js";
import { METRICS, OPS, fmt } from "./indicators.js";
import { describe } from "./describe.js";
import { swingLevels } from "./levels.js";
import { picks, OVERLAYS, PANELS } from "./studies.js";
import { openLearn } from "./interact.js";
import { HORIZONS, dailyVol, typicalMove, isRight } from "./score.js";
import { D, view, bigMove, storiesFor } from "./data.js";
import { esc, money, pct, fmtDay, DISCLAIMER } from "./ui.js";
import { openProfile } from "./pages.js";
import { PANE } from "./feed.js";

const addDays = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
// ---------- details pane
// How to use each part of the details pane, shown behind a small ⓘ. Educational only: what the number
// describes and how people read it, never what to do.
const HOW = {
  glance: "A short summary of the facts further down. It describes what has already happened; it doesn't predict what happens next.",
  today: "This is today's daily candle, which starts at midnight UTC (5:30 AM IST), so its move can differ from the 24-hour change at the top. Open is the first price of that day and Close the latest. The bar shows where the price sits between the day's low and high. Volume compares today's trading with a usual day: a high number means more people traded than normal, often around news.",
  perf: "Price change over each period up to the latest candle. Comparing short and long periods shows whether a move is recent or part of a longer run. Past performance doesn't tell you future returns.",
  trend: "A moving average is the average closing price over the last 20, 50 or 200 days, which smooths out daily noise. Price above an average means it is higher than its recent typical level. Many people watch the 50- and 200-day lines, so they're useful context, not signals.",
  vol: "The typical daily move is the 14-day Average True Range: how far the price usually travels in a day. Bigger numbers mean bigger swings, so the same news can move the price more. Comparing today's move with it shows whether today was unusual.",
  readings: "One reading for each indicator you chose, worked out on daily candles, with what the number means in plain words. The chart on the card can use shorter candles (15-minute on 1D), so its values can differ. Add or remove indicators with ƒx in the full-screen chart. Tap a reading for its guide.",
  ranges: "Where today's price sits between the lowest and highest prices of the period. The nearest support and resistance are prices where the chart turned more than once before. They describe the past, not where the price will go.",
  alerts: "Get told when a price or reading crosses a level you choose. Quickest way: hold the chart, slide to a price and tap the alert button.",
};
export function renderDetails(c, it) {
  const s = it.sym, v = view(s.key, { ...chartSettings(s.key), interval: "1D", range: "1Y" }), pane = c.querySelector('[data-pane="details"]');
  const rules = (store.data?.rules || []).filter((r) => r.sym === s.key || (r.sym === "*" && s.m === "CRYPTO"));
  const sec = (title, key, body) => `<section class="dsec"><h3>${title}${key ? `<button class="ibtn" data-how="${key}" aria-label="How to use: ${title}" aria-expanded="false">i</button>` : ""}</h3>${key ? `<p class="how" hidden>${esc(HOW[key])}</p>` : ""}${body}</section>`;
  const sign = (x, dg = 1) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(dg) + "%";
  let html = `<div class="pane-wrap det">`;
  if (!v) {
    html += `<div class="dhead"><div><h2>${esc(s.t)}</h2><span>${esc(s.n)}</span></div></div><div class="notice">Prices for ${esc(s.t)} haven't loaded yet.</div>`;
  } else {
    const all = D.series[s.key].bars, b = all.at(-1), d = v.daily.now, last = b.c;
    // the same move the card's chip shows: over the card's range (1D = the last 24 hours), so the two never disagree
    const cs = chartSettings(s.key), cv = view(s.key, cs), day = view(s.key, { ...cs, range: "1D" });
    const chg = day ? day.windowChange : d.changePct, dayLab = day ? "in 24h" : "today (UTC)";
    const hv = cv ? cv.windowChange : chg;
    const rng = (n) => { const w = all.slice(-n); const lo = Math.min(...w.map((x) => x.l)), hi = Math.max(...w.map((x) => x.h)); return { lo, hi, p: hi > lo ? ((last - lo) / (hi - lo)) * 100 : 50 }; };
    const yr = rng(Math.min(365, all.length)), typical = d.atrPct, moveX = typical ? Math.abs(chg) / typical : null;
    const avgs = [["20-day", d.sma20], ["50-day", d.sma50], ["200-day", d.sma200]].filter(([, x]) => x != null);
    html += `<div class="dhead"><div><h2>${esc(s.n)}</h2><span>${esc(s.t)}</span></div><div class="r"><b>${esc(money(last, s.m))}</b><span class="${hv >= 0 ? "up" : "down"}">${pct(hv, 1)}</span></div></div>
      <h2 class="dtitle">Before you call</h2>`;
    // 0. how much it usually moves, per call length (1.2.0): what every call is judged against
    const sg = dailyVol(all.map((x) => x.c));
    if (sg != null) html += `<section class="dsec"><h3>How much ${esc(s.n)} usually moves</h3><div class="usual">${Object.entries(HORIZONS).map(([h, o]) => `<div><b>${(Math.expm1(typicalMove(sg, h)) * 100).toFixed(h === "1y" ? 0 : 1)}%</b><span>${esc(o.label)}</span></div>`).join("")}</div><p class="hint">Either way, from the last 30 days. Your calls are judged against these sizes.</p></section>`;
    // 1. at a glance: three or four plain facts
    const names = (ls) => (ls.length > 1 ? ls.slice(0, -1).map((l) => l.replace("-day", "")).join(", ") + " and " + ls.at(-1) : ls[0] || "");
    const above = names(avgs.filter(([, x]) => last > x).map(([l]) => l)), below = names(avgs.filter(([, x]) => last <= x).map(([l]) => l));
    const glance = [
      `${chg >= 0 ? "Up" : "Down"} ${Math.abs(chg).toFixed(1)}% ${dayLab}${moveX != null ? `, ${moveX >= 1.5 ? "a bigger move than usual" : moveX <= 0.5 ? "a quiet day" : "a normal-sized move"}` : ""}${d.volRatio != null ? ` on ${fmt(d.volRatio, 1)}x the usual volume` : ""}.`,
      avgs.length ? `${above ? `Above its ${above}-day average${above.includes(" and ") ? "s" : ""}`.replace("-day-day", "-day") : ""}${above && below ? "; " : ""}${below ? `${above ? "below" : "Below"} its ${below}-day average${below.includes(" and ") ? "s" : ""}`.replace("-day-day", "-day") : ""}.` : "",
      `${yr.p >= 80 ? "Near the top" : yr.p <= 20 ? "Near the bottom" : yr.p >= 60 ? "In the upper part" : yr.p <= 40 ? "In the lower part" : "Around the middle"} of its ${all.length >= 365 ? "52-week" : `${all.length}-day`} range.`,
      d.rsi14 != null ? `Daily RSI ${d.rsi14.toFixed(0)}: ${describe("rsi14", d, v.daily.prev).toLowerCase()}` : "",
    ].filter(Boolean);
    html += sec("Right now", "glance", `<ul class="glance">${glance.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>`);
    // your record on this coin, and your alerts (1.2.0)
    const mine = store.results.filter((r) => r.coin === s.key && r.status === "scored"), rightN = mine.filter(isRight).length, waiting = store.preds.filter((p) => p.coin === s.key).length;
    html += `<button class="dcard" data-mycalls><span class="main"><span class="t">Your ${esc(s.t)} calls</span><span class="s">${mine.length ? `${mine.length} scored, right direction in ${rightN}. Last one: <b class="good">${esc(mine[0].label)}</b>.` : "None scored yet."}${waiting ? ` ${waiting} waiting.` : ""}</span></span><span class="chev">›</span></button>`;
    html += `<button class="dcard" data-addrule><span class="main"><span class="t">Price alerts</span><span class="s">${rules.length ? `${rules.length} on: ${rules.slice(0, 1).map((r) => `${esc(METRICS[r.metric]?.label || r.metric)} ${esc(OPS[r.op])} ${esc(r.value)}${esc(METRICS[r.metric]?.unit || "")}`).join("")}${rules.length > 1 ? "…" : "."}` : "Tell me when a price or a reading is crossed."}</span></span><span class="linkbtn">${rules.length ? "Edit" : "Add"}</span></button>`;
    html += `<h3 class="dmore">More about the price</h3><div class="folds">`;
    // 2. today
    const dayP = b.h > b.l ? ((b.c - b.l) / (b.h - b.l)) * 100 : 50;
    html += sec(`Daily candle · ${esc(fmtDay(b.t))}`, "today", `<div class="stat-grid">${[["Open", b.o], ["High", b.h], ["Low", b.l], ["Close", b.c]].map(([k, x]) => `<div><span>${k}</span><b>${esc(money(x, s.m))}</b></div>`).join("")}</div>
      <div class="rangerow"><span>Day's range</span><span>closed ${dayP.toFixed(0)}% of the way up</span></div><div class="rangebar"><i style="left:${dayP.toFixed(1)}%"></i></div><div class="rangerow"><span>${esc(money(b.l, s.m))}</span><span>${esc(money(b.h, s.m))}</span></div>
      ${d.volRatio != null ? `<p class="dline">Volume was <b>${fmt(d.volRatio, 1)}x</b> a usual day.</p>` : ""}`);
    if (bigMove(v)) html += `<section class="dsec box" data-movebox>${moveHtml(s, v)}</section>`;
    // 3. performance
    const back = (days) => { const cut = new Date(Date.parse(b.t) - days * 864e5).toISOString().slice(0, 10); const p = [...all].reverse().find((x) => x.t <= cut); return p ? ((last - p.c) / p.c) * 100 : null; };
    const perf = [["1W", 7], ["1M", 30], ["3M", 91], ["6M", 182], ["1Y", 365]].map(([l, n]) => [l, back(n)]).filter(([, x]) => x != null);
    html += sec("Performance", "perf", `<div class="perf">${perf.map(([l, x]) => `<div><span>${l}</span><b class="${x >= 0 ? "up" : "down"}">${pct(x, Math.abs(x) >= 100 ? 0 : 1)}</b></div>`).join("")}</div>`);
    // 4. trend: price against its moving averages
    if (avgs.length) html += sec("Trend", "trend", `<div class="mas">${avgs.map(([l, x]) => { const dist = ((last - x) / x) * 100; return `<div class="marow"><span>${l} average</span><b>${esc(money(x, s.m))}</b><em class="${dist >= 0 ? "up" : "down"}">${sign(dist)} ${dist >= 0 ? "above" : "below"}</em></div>`; }).join("")}</div>`);
    // 5. volatility
    if (typical != null) html += sec("Volatility", "vol", `<div class="vol"><div><span>Typical daily move</span><b>±${typical.toFixed(1)}%</b></div><div><span>Today's move</span><b>${moveX != null ? `${moveX.toFixed(1)}x typical` : "–"}</b></div></div>`);
    // 6. readings in plain words
    // readings for the indicators on your chart, in plain words
    const pkr = picks(store.data?.settings?.chart), seenM = new Set();
    const rows = [...pkr.over.map((k) => OVERLAYS[k]), ...pkr.lower.map((k) => PANELS[k])].filter((x) => x?.metric && !seenM.has(x.metric) && seenM.add(x.metric)).map((x) => ({ i: { id: Object.keys(OVERLAYS).find((k) => OVERLAYS[k] === x) || Object.keys(PANELS).find((k) => PANELS[k] === x) }, m: x.metric }));
    html += sec("Indicators · daily candles", "readings", rows.length ? `<div class="inds">${rows.map(({ i, m }) => {
      const meta = METRICS[m] || { label: m, digits: 2 }, x = d[m], st = PANELS[i.id] || OVERLAYS[i.id], [a, z] = st?.range || [];
      let g = "";
      if (x != null && a != null && z != null) { // a small gauge for indicators with a fixed scale, with the usual reference zone shaded
        const at = (n) => Math.max(0, Math.min(100, ((n - a) / (z - a)) * 100)), [r1, r2] = st.refs?.length === 2 ? st.refs : [];
        g = `<span class="gauge" aria-hidden="true">${r1 != null ? `<i style="left:${at(r1)}%;width:${at(r2) - at(r1)}%"></i>` : ""}<b style="left:${at(x)}%"></b></span>`;
      }
      return `<button class="ind" data-ind="${esc(i.id)}"><span class="ik">${esc(meta.label)}</span><span class="iv${!g && x != null && st?.zero ? (x >= 0 ? " up" : " down") : ""}">${fmt(x, meta.digits)}${meta.unit && x != null ? esc(meta.unit) : ""}</span>${g}<span class="idesc">${esc(describe(m, d, v.daily.prev))}</span></button>`;
    }).join("")}</div>` : `<p class="hint">No indicators chosen. Open the full-screen chart and tap ƒx to add some.</p>`);
    // 7. ranges and the nearest past turning points
    const lv = swingLevels({ bars: all, win: all.slice(-Math.min(182, all.length)), interval: "1D" }, { perSide: 1 });
    const r1 = lv.find((l) => l.kind === "R"), s1 = lv.find((l) => l.kind === "S");
    html += sec("Where the price sits", "ranges", [[30, "30-day range"], [Math.min(365, all.length), all.length >= 365 ? "52-week range" : `${all.length}-day range`]].map(([n, l]) => { const r = rng(n); return `<div class="rng"><div class="rangerow"><b>${l}</b><span>${r.p.toFixed(0)}% of the way up</span></div><div class="rangebar"><i style="left:${r.p.toFixed(1)}%"></i></div><div class="rangerow"><span>${esc(money(r.lo, s.m))}</span><span>${esc(money(r.hi, s.m))}</span></div></div>`; }).join("") +
      (r1 || s1 ? `<div class="srrow">${s1 ? `<div><span>Nearest support</span><b class="up">${esc(money(s1.price, s.m))}</b><em>${sign(((s1.price - last) / last) * 100)} · turned ${s1.touches}×</em></div>` : ""}${r1 ? `<div><span>Nearest resistance</span><b class="down">${esc(money(r1.price, s.m))}</b><em>${sign(((r1.price - last) / last) * 100)} · turned ${r1.touches}×</em></div>` : ""}</div>` : ""));
    html += `</div>`;
  }
  html += sec(`About ${esc(s.n)}`, "", `<p class="dline">${esc(s.n)} · ${esc(TYLABEL[s.ty] || "")}</p><p class="hint">Prices: ${esc(v?.source || "Kraken")} daily candles${v?.live ? ", refreshed when you opened the app" : ""}. Facts and explanations only, never advice.</p><p class="disclaimer">${esc(DISCLAIMER)}</p>`);
  pane.innerHTML = html + `</div>`;
  pane.querySelectorAll("[data-how]").forEach((bt) => (bt.onclick = () => { const p = bt.closest("section").querySelector(".how"); p.hidden = !p.hidden; bt.setAttribute("aria-expanded", String(!p.hidden)); }));
  pane.querySelectorAll("[data-ind]").forEach((bt) => (bt.onclick = () => openLearn(bt.dataset.ind, c._v)));
  pane.querySelector("[data-addrule]")?.addEventListener("click", () => openProfile("rules", s.key));
  pane.querySelector("[data-mycalls]")?.addEventListener("click", () => openCoinCalls(s));
  // the sections under "More about the price" start folded; tap a title to open it
  pane.querySelectorAll(".folds > .dsec > h3").forEach((h) => { h.setAttribute("role", "button"); h.tabIndex = 0; h.onclick = (e) => { if (e.target.closest(".ibtn")) return; h.parentElement.classList.toggle("open"); }; });
  const mb = pane.querySelector("[data-movebox]");
  mb?.querySelectorAll("[data-gonews]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); c._go(PANE.news); }));
}
// An unusually big day: the facts, and the headlines from around that day (no AI, no guessing at causes).
function moveHtml(s, v) {
  const d = v.daily.now, day = D.series[s.key].bars.at(-1).t;
  const news = storiesFor(s.key).filter((st) => st.date >= addDays(day, -1)).slice(0, 3);
  return `<div class="label">A big day</div><p style="font-weight:700">${esc(s.t)} ${d.changePct >= 0 ? "rose" : "fell"} ${Math.abs(d.changePct).toFixed(1)}%, about ${(Math.abs(d.changePct) / d.atrPct).toFixed(1)}x a typical day's move.</p>
    ${news.length ? `<p class="hint">In the news around then:</p><ul class="mnews">${news.map((st) => `<li><a href="${esc(st.links[0].url)}" target="_blank" rel="noopener">${esc(st.title)}</a> <span class="hint">${esc(st.outlets[0] || "")}</span></li>`).join("")}</ul><a href="#" data-gonews class="hint">All ${esc(s.t)} news →</a>`
      : `<p class="hint">No news found for that day. Big moves can also come from the wider market.</p>`}`;
}
