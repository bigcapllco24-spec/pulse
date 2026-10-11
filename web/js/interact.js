// Chart interactions on the feed: hold-and-slide to read any day, set an alert from the chart, tap a panel to
// learn what it shows, and a short quiz on the caught-up card. Facts and explanations only, never advice.
import { store, save, ls } from "./store.js";
import { describe } from "./describe.js";
import { fmt } from "./indicators.js";
import { esc, money, pct, arrow, fmtDay, toast, openSheet, closeSheet, haptic, DISCLAIMER } from "./ui.js";
import { APP } from "./app.js";
import { openIndicator } from "./pages.js";
import { coachEvent } from "./coach.js";

// Chart geometry (must match chart.js): viewBox 360 x 210, 46 px price gutter on the right, 22 px top, 14 px bottom.
const W = 360, H = 210, PR = 46, PT = 22, PB = 14;
const HOLD_MS = 280, SLOP = 8;

let hold = null, scrub = null, chip = null;

export function initInteract(feed) {
  feed.addEventListener("contextmenu", (e) => { if (e.target.closest(".pane.main")) e.preventDefault(); });
  feed.addEventListener("pointerdown", (e) => {
    clearChip(e.target);
    const box = e.target.closest(".pane.main .chartbox:not(.nodata), .pane.main .lower");
    if (!box || e.target.closest(".alertchip") || (e.pointerType === "mouse" && e.button !== 0)) return;
    const c = box.closest(".card");
    hold = { id: e.pointerId, x: e.clientX, y: e.clientY, c, timer: setTimeout(() => start(feed, e.pointerId), HOLD_MS) };
  });
  feed.addEventListener("pointermove", (e) => {
    if (scrub && e.pointerId === scrub.id) { move(e.clientX, e.clientY); return; }
    if (hold && e.pointerId === hold.id) { hold.x2 = e.clientX; hold.y2 = e.clientY; if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > SLOP) cancelHold(); }
  });
  const up = (e, cancelled) => {
    if (hold && e.pointerId === hold.id) cancelHold();
    if (scrub && e.pointerId === scrub.id) end(!cancelled);
  };
  feed.addEventListener("pointerup", (e) => up(e, false));
  feed.addEventListener("pointercancel", (e) => up(e, true));
}
const cancelHold = () => { if (hold) clearTimeout(hold.timer); hold = null; };

function start(feed, id) {
  const h = hold; hold = null;
  const c = h?.c, v = c?._v;
  if (!v || APP.dragging) return;
  const main = c.querySelector('[data-pane="main"]'), box = main.querySelector(".chartbox .plot"), svg = box?.querySelector("svg.chart");
  if (!svg) return;
  try { feed.setPointerCapture(id); } catch {}
  const q = (sel) => main.querySelector(sel) || c.parentElement?.querySelector(sel); // the full-screen chart keeps its header outside the card
  const head = { tk: q(".tk"), price: q(".price"), chg: q(".chg") };
  if (!head.price || !head.chg) return;
  scrub = { id, c, v, main, box, svg, head, saved: { price: head.price.textContent, chg: head.chg.outerHTML },
    lo: +svg.dataset.lo, hi: +svg.dataset.hi, level: null };
  APP.scrub = true;
  // Readout card floats inside the chart, so the name, price and chart never move or resize while holding.
  box.insertAdjacentHTML("beforeend", `<div class="xh"></div><div class="yh"><span></span></div><div class="scrubcard" aria-live="polite"></div>`);
  main.querySelectorAll(".lower .lplot").forEach((l) => l.insertAdjacentHTML("beforeend", `<div class="xh"></div>`));
  main.classList.add("scrubbing");
  coachEvent("scrub");
  haptic();
  move(h.x2 ?? h.x, h.y2 ?? h.y);
}

function move(cx, cy) {
  const s = scrub, r = s.box.getBoundingClientRect(), n = s.v.win.length;
  const x = ((cx - r.left) / r.width) * W, step = (W - PR) / n;
  const i = Math.max(0, Math.min(n - 1, Math.floor(x / step)));
  const xPct = (((i + 0.5) * step) / W) * 100;
  s.main.querySelectorAll(".xh").forEach((el) => (el.style.left = xPct + "%"));
  // the horizontal line follows the finger and reads out a price level (used for the alert)
  const y = Math.max(PT, Math.min(H - PB, ((cy - r.top) / r.height) * H));
  s.level = s.lo + (1 - (y - PT) / (H - PT - PB)) * (s.hi - s.lo);
  const yh = s.box.querySelector(".yh");
  yh.style.top = (y / H) * 100 + "%"; yh.firstChild.textContent = fmtPrice(s.level);
  if (i === s.i) return;
  s.i = i;
  const b = s.v.win[i], g = s.v.bars.length - n + i, prev = s.v.bars[g - 1], chg = prev ? ((b.c - prev.c) / prev.c) * 100 : null;
  s.head.price.textContent = money(b.c, "CRYPTO");
  const chgEl = s.head.chg;
  chgEl.className = `chg ${chg == null || chg >= 0 ? "up" : "down"}`; chgEl.textContent = chg == null ? "–" : `${arrow(chg)} ${pct(chg)}`;
  const rsi = s.v.ov.rsi14?.[i], mh = s.v.ov.macdHist?.[i];
  const card = s.box.querySelector(".scrubcard");
  card.innerHTML = `<div class="sc-d"><b>${esc(fmtDay(b.t))}</b>${chg == null ? "" : `<span class="${chg >= 0 ? "up" : "down"}">${arrow(chg)} ${pct(chg)}</span>`}</div>
    <div class="sc-g"><span>Open</span><b>${fmtPrice(b.o)}</b><span>High</span><b>${fmtPrice(b.h)}</b><span>Low</span><b>${fmtPrice(b.l)}</b><span>Close</span><b>${fmtPrice(b.c)}</b></div>
    ${rsi != null || mh != null ? `<div class="sc-i">${rsi != null ? `RSI <b>${rsi.toFixed(0)}</b>` : ""}${mh != null ? `<i></i>MACD <b>${fmt(mh, 2)}</b>` : ""}</div>` : ""}`;
  card.classList.toggle("right", xPct < 50); // keep the card away from the finger
  if (navigator.vibrate && i % 5 === 0) haptic();
}

function end(offerAlert) {
  const s = scrub; scrub = null; APP.scrub = false; APP.scrubEndAt = Date.now();
  s.main.classList.remove("scrubbing");
  s.main.querySelectorAll(".xh,.scrubcard").forEach((el) => el.remove());
  s.head.price.textContent = s.saved.price;
  s.head.chg.outerHTML = s.saved.chg;
  const yh = s.box.querySelector(".yh");
  const sym = s.c._sym || APP.seq[+s.c.dataset.i]?.sym, last = s.v.lastBar.c;
  if (!offerAlert || !sym || s.level == null) { yh?.remove(); return; }
  // One tap turns the level under the finger into an alert rule.
  const level = +s.level.toPrecision(5), op = level >= last ? "above" : "below";
  yh.insertAdjacentHTML("beforeend", `<button class="alertchip">🔔 Alert me if ${esc(sym.t)} goes ${op} ${esc(money(level, "CRYPTO"))}</button>`);
  chip = { el: yh, timer: setTimeout(() => clearChip(), 5000) };
  yh.querySelector(".alertchip").onclick = async (e) => {
    e.stopPropagation();
    const rule = { id: Math.random().toString(36).slice(2, 10), sym: sym.key, metric: "price", op, value: level, note: "Set from the chart", active: true, createdAt: new Date().toISOString() };
    await save({ rules: [...(store.data.rules || []), rule] });
    clearChip();
    toast(`Alert set: ${sym.t} ${op} ${money(level, "CRYPTO")}`, { action: "Undo", onAction: () => save({ rules: (store.data.rules || []).filter((r) => r.id !== rule.id) }) });
  };
}
function clearChip(target) {
  if (!chip || (target && target.closest?.(".alertchip"))) return;
  clearTimeout(chip.timer); chip.el.remove(); chip = null;
}
const fmtPrice = (x) => (x >= 1000 ? x.toLocaleString("en-US", { maximumFractionDigits: 0 }) : x >= 1 ? x.toFixed(2) : x.toPrecision(3));

// A plain tap on the chart (no hold) reminds people the chart can be read, the first few times.
export function chartTapHint() {
  const n = ls.get("pl.scrubHint", 0);
  if (n < 3) { ls.set("pl.scrubHint", n + 1); toast("Hold and slide on the chart to read any day."); }
}

// ---------- tap a panel to learn what it shows
const LEARN = {
  RSI: { id: "rsi", metric: "rsi14", how: "The line moves between 0 and 100. The dotted lines mark 70 and 30, where gains or losses have clearly dominated the last 14 days." },
  MACD: { id: "macd", metric: "macdHist", how: "Blue line: the 12-day average minus the 26-day average. Yellow line: a 9-day average of the blue line. Bars: the gap between the two lines, green when blue is on top." },
  VOL: { id: "volume", metric: "volRatio", how: "Each bar is one day's trading volume, green on days that closed higher than they opened." },
  SR: { name: "Support and resistance", how: "Each dashed line marks a price where the chart turned more than once in this view: green lines below today's price (support), red lines above it (resistance). The number shows how many times it turned there; “recent high” or “recent low” marks a single clear turn. Lines move when you change the time range. They describe the past and do not predict where the price will go." },
  PIV: { name: "Pivot points", how: "Worked out from the previous month's high, low and close (the previous year's on weekly charts): P = (high + low + close) ÷ 3, R1 = 2P − low, S1 = 2P − high, R2 = P + (high − low), S2 = P − (high − low). Many traders watch these levels, which is why they are shown. They are arithmetic, not a forecast." },
};
export function openLearn(kind, v) {
  const L = LEARN[kind], ind = APP.catalogue.find((x) => x.id === L?.id);
  if (!L || !v) return;
  if (!L.metric) { // a line on the chart rather than a panel
    openSheet(esc(L.name), `<h3>How to read the lines</h3><p>${esc(L.how)}</p><p class="disclaimer">${esc(DISCLAIMER)}</p>`);
    return;
  }
  const d = v.daily.now, val = d[L.metric];
  openSheet(esc(ind?.name || kind), `
    <div class="learnnow"><span class="label">Right now</span><b>${val == null ? "–" : fmt(val, L.metric === "macdHist" ? 2 : 1)}${L.metric === "volRatio" && val != null ? "x usual" : ""}</b><p>${esc(describe(L.metric, d, v.daily.prev))}</p></div>
    ${ind?.short ? `<h3>What it measures</h3><p>${esc(ind.short)}</p>` : ""}
    <h3>How to read the panel</h3><p>${esc(L.how)}</p>
    <button class="btn block" data-guide="${esc(L.id)}">Open the full guide</button>
    <p class="disclaimer">${esc(DISCLAIMER)}</p>`, (body) => {
    body.querySelector("[data-guide]").onclick = () => { closeSheet(); openIndicator(L.id); };
  });
}

// ---------- three quick questions on the caught-up card
const QUIZ = [
  ["What does RSI 14 compare?", ["Average gains with average losses over 14 periods", "Price with volume", "Today's close with yesterday's"], 0],
  ["RSI always sits between…", ["0 and 100", "-1 and 1", "It has no fixed range"], 0],
  ["A MACD histogram bar above zero means…", ["The MACD line is above its signal line", "The price rose today", "Volume was above average"], 0],
  ["The standard MACD settings are…", ["12, 26 and 9", "14, 70 and 30", "20, 50 and 200"], 0],
  ["A candle is green when…", ["It closed above where it opened", "It closed above yesterday's close", "Volume was high"], 0],
  ["The thin wick on a candle shows…", ["The highest and lowest prices of that period", "The opening and closing prices", "The average price"], 0],
  ["A 50-day moving average is…", ["The average closing price of the last 50 days", "The highest price in 50 days", "The price 50 days ago"], 0],
  ["A coin's market cap is…", ["Its price times the coins in circulation", "Its 24-hour trading volume", "The most it has ever been worth"], 0],
  ["A stablecoin is designed to…", ["Hold a steady value, usually 1 US dollar", "Rise steadily over time", "Track the price of Bitcoin"], 0],
  ["RSI above 70 tells you that…", ["Gains have clearly outweighed losses over 14 days", "The price will fall next", "It is a good time to sell"], 0],
  ["Average True Range (ATR) measures…", ["The typical size of a day's price range", "The trend's direction", "How many people are trading"], 0],
  ["Daily volume tells you…", ["How much was traded that day", "How much the price moved", "How many holders a coin has"], 0],
];
export function quizHtml(round) {
  const day = Math.floor(Date.now() / 864e5), start = ((day * 3 + (round - 1) * 3) % QUIZ.length + QUIZ.length) % QUIZ.length;
  const qs = [0, 1, 2].map((k) => (start + k) % QUIZ.length);
  const st = ls.get("pl.quiz", { right: 0, total: 0 });
  return `<div class="quiz"><div class="label">Quick check · <span data-qn>1</span>/3${st.total ? ` · ${st.right}/${st.total} right so far` : ""}</div>${qs.map((qi, k) => {
    const [q, opts, ok] = QUIZ[qi], order = [0, 1, 2].sort((a, b) => ((qi * 7 + a * 3) % 5) - ((qi * 7 + b * 3) % 5));
    return `<div class="qq" data-q="${qi}" ${k ? "hidden" : ""}><p>${esc(q)}</p><div class="qopts">${order.map((o) => `<button class="qa" data-qa="${o}" data-ok="${o === ok ? 1 : 0}">${esc(opts[o])}</button>`).join("")}</div></div>`;
  }).join("")}</div>`;
}
export function wireQuiz(root) {
  root.querySelectorAll(".qq").forEach((q) => q.querySelectorAll(".qa").forEach((b) => (b.onclick = () => {
    if (q.dataset.done) return;
    q.dataset.done = "1";
    const right = b.dataset.ok === "1";
    q.querySelectorAll(".qa").forEach((x) => { x.disabled = true; if (x.dataset.ok === "1") x.classList.add("right"); });
    if (!right) b.classList.add("wrong");
    const st = ls.get("pl.quiz", { right: 0, total: 0 });
    ls.set("pl.quiz", { right: st.right + (right ? 1 : 0), total: st.total + 1 });
    haptic();
    // one question at a time: the next one slides in after a moment
    const next = q.nextElementSibling;
    setTimeout(() => {
      if (next?.classList.contains("qq")) { q.hidden = true; next.hidden = false; const n = root.querySelector("[data-qn]"); if (n) n.textContent = +n.textContent + 1; }
      else q.insertAdjacentHTML("afterend", `<p class="hint">Done for today. New questions tomorrow.</p>`);
    }, 1100);
  })));
}
