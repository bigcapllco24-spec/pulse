// Fixed, standardised charts drawn as SVG: the same window, scale rules and overlays for every symbol,
// so the eye learns the shapes while scrolling. No pan or zoom, so swipes never fight the chart.
const W = 360, H = 210, PR = 46, PT = 12, PB = 14; // right gutter for price labels, top room for the window label
const LH = 64;

const f = (x) => (Math.abs(x) >= 1000 ? x.toFixed(0) : Math.abs(x) >= 100 ? x.toFixed(1) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toPrecision(3));
const path = (pts) => pts.reduce((s, p, i) => (p == null ? s : s + (s && pts[i - 1] != null ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)), "");

import { OVERLAYS, PANELS, keysOf, panelFact } from "./studies.js";
export const MA_COLORS = ["var(--ma1)", "var(--ma2)", "var(--ma3)"];

// win: bars in the window [{t,o,h,l,c,v}], ov: {key: values[] aligned to win}, opts: {type, closeOnly, maKeys:[...]}
export function mainChart(win, ov, opts) {
  const n = win.length;
  if (!n) return "";
  // opts.count/opts.shift: the full-screen chart scrolls smoothly by fractions of a candle
  const pw = W - PR, step = pw / (opts.count || n), sh = opts.shift || 0, bw = Math.max(1.5, step * 0.62);
  const vals = [];
  win.forEach((b) => vals.push(opts.closeOnly ? b.c : b.h, opts.closeOnly ? b.c : b.l));
  (opts.maKeys || []).forEach((k) => (ov[k] || []).forEach((x) => x != null && vals.push(x)));
  const overs = (opts.over || []).map((c) => [c, OVERLAYS[c]]).filter(([, o]) => o);
  for (const [, o] of overs) for (const k of keysOf(o)) (ov[k] || []).forEach((x) => x != null && isFinite(x) && vals.push(x));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  // support/resistance or pivot lines: keep those near the visible prices and widen the scale to fit them
  const span0 = hi - lo || hi * 0.02, nearLv = (l, k) => l.price >= lo - span0 * k && l.price <= hi + span0 * k;
  // your own calls (kind C) widen the scale up to a full span; further away they sit at the edge as a marker
  const lv = (opts.levels || []).filter((l) => (l.kind === "C" ? nearLv(l, 1) : nearLv(l, 0.25))), far = (opts.levels || []).filter((l) => l.kind === "C" && !nearLv(l, 1));
  for (const l of lv) { lo = Math.min(lo, l.price); hi = Math.max(hi, l.price); }
  const pad = (hi - lo) * 0.06 || hi * 0.01 || 1; lo -= pad; hi += pad;
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const X = (i) => (i - sh) * step + step / 2;
  const first = win[0].c, last = win[n - 1].c, up = last >= first;
  let body = "";
  // grid: three quiet lines (the full-screen chart gets more, each with its price)
  const gl = opts.full ? [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875] : [0.25, 0.5, 0.75];
  for (const g of gl) body += `<line x1="0" x2="${pw}" y1="${(PT + g * (H - PT - PB)).toFixed(1)}" y2="${(PT + g * (H - PT - PB)).toFixed(1)}" class="grid"/>`;
  // indicator fills and clouds sit behind the candles
  const line = (arr) => path((arr || []).map((v, i) => (v == null ? null : [X(i), Y(v)])));
  // filled area between two lines, one closed shape per unbroken run (so gaps never draw stray diagonals)
  const area = (a, b) => {
    let d = "", top = [], bot = [];
    const flush = () => { if (top.length > 1) d += "M" + [...top, ...bot.reverse()].map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + "Z"; top = []; bot = []; };
    (a || []).forEach((v, i) => { if (v != null && b?.[i] != null) { top.push([X(i), Y(v)]); bot.push([X(i), Y(b[i])]); } else flush(); });
    flush(); return d;
  };
  for (const [, o] of overs) {
    if (o.fill) body += `<path d="${area(ov[o.fill[0]], ov[o.fill[1]])}" class="ofill" style="fill:${o.lines[0][1]}"/>`;
    if (o.cloud) { // green where span A is above span B, red where below
      const a = ov[o.cloud[0]] || [], b = ov[o.cloud[1]] || [];
      body += `<path d="${area(a.map((x, i) => (x != null && b[i] != null && x >= b[i] ? x : null)), b.map((x, i) => (x != null && a[i] != null && a[i] >= x ? x : null)))}" class="ocloud u"/>`;
      body += `<path d="${area(b.map((x, i) => (x != null && a[i] != null && x > a[i] ? x : null)), a.map((x, i) => (x != null && b[i] != null && b[i] > x ? x : null)))}" class="ocloud d"/>`;
    }
  }
  const type = opts.closeOnly && opts.type === "candles" ? "area" : opts.type;
  if (type === "candles") {
    win.forEach((b, i) => {
      const cls = b.c >= b.o ? "cu" : "cd", x = X(i);
      const yo = Y(b.o), yc = Y(b.c);
      body += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${Y(b.h).toFixed(1)}" y2="${Y(b.l).toFixed(1)}" class="${cls} wick"/>` +
        `<rect x="${(x - bw / 2).toFixed(1)}" y="${Math.min(yo, yc).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(yc - yo)).toFixed(1)}" class="${cls}"/>`;
    });
  } else {
    const d = path(win.map((b, i) => [X(i), Y(b.c)]));
    if (type === "area") body += `<path d="${d}L${X(n - 1).toFixed(1)} ${H - PB}L${X(0).toFixed(1)} ${H - PB}Z" class="area ${up ? "au" : "ad"}"/>`;
    body += `<path d="${d}" class="pline draw ${up ? "lu" : "ld"}" pathLength="1"/>`;
  }
  (opts.maKeys || []).forEach((k, j) => {
    const d = path((ov[k] || []).map((v, i) => (v == null ? null : [X(i), Y(v)])));
    if (d) body += `<path d="${d}" class="ma draw" style="stroke:${MA_COLORS[j % 3]}" pathLength="1"/>`;
  });
  // indicator lines and dots on top of the price
  const legend = [];
  for (const [code, o] of overs) {
    for (const [k, col, dash] of o.lines || []) { const d = line(ov[k]); if (d) body += `<path d="${d}" class="oline${dash ? " dash" : ""}" style="stroke:${col}"/>`; }
    if (o.dots) (ov[o.dots] || []).forEach((v, i) => { if (v != null) body += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${Math.max(0.8, Math.min(1.8, step * 0.3)).toFixed(1)}" class="odot ${v < win[i].c ? "u" : "d"}"/>`; });
    if (o.trend) { const t = ov[o.trend] || []; for (const up of [true, false]) body += `<path d="${path(t.map((v, i) => (v == null || (v < win[i].c) !== up ? null : [X(i), Y(v)])))}" class="oline trend ${up ? "u" : "d"}"/>`; }
    const k0 = o.lines?.[1]?.[0] && o.fill ? o.lines[1][0] : o.lines?.[0]?.[0] || o.dots || o.trend, arr = ov[k0] || [];
    let lv = null; for (let i = arr.length - 1; i >= 0 && lv == null; i--) lv = arr[i];
    legend.push(`<span class="oli" data-learn-ov="${code}"><i style="background:${o.lines?.[0]?.[1] || (o.trend ? "var(--up)" : "var(--muted)")}"></i>${o.tag}${lv != null ? ` <b>${f(lv)}</b>` : ""}${opts.full ? `<button class="orm" data-rmstudy="${code}" aria-label="Remove ${o.name}">✕</button>` : ""}</span>`);
  }
  const legendHtml = legend.length ? `<div class="olegend">${legend.join("")}</div>` : "";
  // price labels as HTML so they keep their shape while the drawing stretches to fit the screen
  const ly = Y(last), top = (y) => ((y / H) * 100).toFixed(2) + "%";
  body += `<line x1="0" x2="${pw}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}" class="lastline"/>`;
  let lvHtml = "";
  for (const l of lv) {
    const y = Y(l.price), x0 = Math.max(0, X(l.from || 0) - step / 2), cls = l.kind === "C" ? "c" : l.kind[0] === "R" ? "r" : l.kind[0] === "S" ? "s" : "p";
    body += `<line x1="${x0.toFixed(1)}" x2="${pw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="lvl ${cls}"/>`;
    if (l.kind === "C") { // your own call (1.2.0): a dashed line from when it was made, tagged with the price called
      body += `<circle cx="${(x0 + (l.from ? step / 2 : 0)).toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" class="lvdot"/>`;
      lvHtml += `<button class="lvtag c" data-call="${l.id || ""}" style="top:${((y / H) * 100).toFixed(2)}%;right:${((PR / W) * 100).toFixed(2)}%">${l.label || "Your call"} ${f(l.price)}</button>`;
      continue;
    }
    const tag = l.touches ? `${l.kind} ${f(l.price)} · ${l.touches > 1 ? l.touches + "×" : l.kind === "R" ? "high" : "low"}` : `${l.kind} ${f(l.price)}`; // S = support, R = resistance
    lvHtml += `<button class="lvtag ${cls}" data-learn="${l.touches ? "SR" : "PIV"}" style="top:${((y / H) * 100).toFixed(2)}%;right:${((PR / W) * 100).toFixed(2)}%">${tag}</button>`;
  }
  for (const l of far) lvHtml += `<button class="lvtag c edge" data-call="${l.id || ""}" style="top:${l.price > hi ? 2 : 86}%;right:${((PR / W) * 100).toFixed(2)}%">${l.label || "Your call"} ${f(l.price)} ${l.price > hi ? "↑" : "↓"}</button>`;
  // time axis like TradingView: month names (the year at each January), or day numbers on short ranges
  const ticks = timeTicks(win, opts.days || 91);
  for (const t of ticks) body += `<line x1="${X(t.i).toFixed(1)}" x2="${X(t.i).toFixed(1)}" y1="${PT}" y2="${H - PB}" class="grid vgrid"/>`;
  const xaxis = `<div class="xaxis" aria-hidden="true">${ticks.map((t) => `<span class="${t.major ? "maj" : ""}" style="left:${((X(t.i) / W) * 100).toFixed(2)}%">${t.label}</span>`).join("")}</div>`;
  const near = (y) => Math.abs(y - ly) < 14; // the latest-price tag wins over a high/low label it would cover
  const labels = `${near(PT) ? "" : `<span class="ax" style="top:${top(PT)}">${f(hi - pad)}</span>`}${near(H - PB) ? "" : `<span class="ax" style="top:${top(H - PB)}">${f(lo + pad)}</span>`}` +
    `<span class="axlast ${up ? "pu" : "pd"}" style="top:${top(ly)}">${f(last)}</span>`;
  const gridLabels = opts.full ? gl.filter((g) => Math.abs(PT + g * (H - PT - PB) - ly) > 9).map((g) => `<span class="ax gl" style="top:${top(PT + g * (H - PT - PB))}">${f(hi - g * (hi - lo))}</span>`).join("") : "";
  if (sh || opts.count) body = `<clipPath id="pclip"><rect x="0" y="0" width="${pw}" height="${H}"/></clipPath><g clip-path="url(#pclip)">${body}</g>`;
  return `<div class="plot"><svg class="chart" data-lo="${lo}" data-hi="${hi}" data-step="${step}" data-shift="${sh}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${n} ${opts.interval === "1W" ? "weeks" : "days"}, ${up ? "up" : "down"} ${Math.abs(((last - first) / first) * 100).toFixed(1)}%, last ${f(last)}, from ${win[0].t} to ${win[n - 1].t}">${body}</svg>${labels}${gridLabels}${lvHtml}${legendHtml}</div>${xaxis}`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Where to put date labels under the chart: at most about 6, never crowded.
export function timeTicks(win, days) {
  const out = [];
  if (win[0].t.length > 10) { // intraday candles ("2026-10-11T09:15", UTC): hours, and the date where a day starts
    const loc = win.map((b) => new Date(b.t + ":00Z")), spanH = (loc[loc.length - 1] - loc[0]) / 36e5;
    const stepH = [1, 2, 3, 6, 12, 24].find((h) => spanH / h <= 6) || 24;
    loc.forEach((d, i) => {
      if (i === 0) return;
      const newDay = d.getDate() !== loc[i - 1].getDate();
      if (newDay) out.push({ i, label: `${d.getDate()} ${MON[d.getMonth()]}`, major: true });
      else if (i > win.length * 0.06 && d.getMinutes() === 0 && d.getHours() % stepH === 0 && stepH < 24 && !out.some((t) => Math.abs(t.i - i) < win.length / 8)) out.push({ i, label: String(d.getHours()).padStart(2, "0") + ":00" });
    });
    return out;
  }
  if (days <= 45) { // short range: day numbers each week, the month name where a month starts
    let lastMonth = win[0].t.slice(5, 7);
    win.forEach((b, i) => {
      const m = b.t.slice(5, 7), d = +b.t.slice(8, 10);
      if (m !== lastMonth) { out.push({ i, label: MON[+m - 1], major: true }); lastMonth = m; }
      else if (i > 1 && i < win.length - 1 && new Date(b.t + "T00:00:00Z").getUTCDay() === 1 && !out.some((t) => Math.abs(t.i - i) < 4)) out.push({ i, label: String(d) });
    });
    return out;
  }
  const starts = [];
  win.forEach((b, i) => { if (i > 0 && b.t.slice(0, 7) !== win[i - 1].t.slice(0, 7)) starts.push({ i, m: +b.t.slice(5, 7), y: b.t.slice(0, 4) }); });
  const every = starts.length <= 7 ? 1 : starts.length <= 14 ? 2 : starts.length <= 21 ? 3 : 6;
  for (const s of starts) if (s.m === 1 || (s.m - 1) % every === 0) out.push({ i: s.i, label: s.m === 1 ? s.y : MON[s.m - 1], major: s.m === 1 });
  return out;
}

// Lower panel: RSI with 30/70 lines, MACD histogram + lines, or volume bars.
export function lowerChart(win, s, kind, opts = {}) {
  const P = PANELS[kind], n = win.length;
  if (!n || !P) return "";
  const pw = W - PR, step = pw / (opts.count || n), sh = opts.shift || 0, X = (i) => (i - sh) * step + step / 2;
  const full = !!opts.full, LHf = full ? 96 : LH;
  const at = (y) => ((y / LHf) * 100).toFixed(1) + "%", hline = (y, cls = "ref") => `<line x1="0" x2="${pw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="${cls}"/>`;
  let body = "", axes = "";
  if (full) for (const t of timeTicks(win, opts.days || 91)) body += `<line x1="${X(t.i).toFixed(1)}" x2="${X(t.i).toFixed(1)}" y1="0" y2="${LHf}" class="grid vgrid"/>`;
  let label = P.label, now = null;
  if (P.vol) {
    const m = Math.max(...win.map((b) => b.v || 0)) || 1;
    if (full) for (const g of [0.25, 0.5, 0.75]) body += hline(LHf - g * (LHf - 6), "grid");
    win.forEach((b, i) => (body += `<rect x="${(X(i) - step * 0.3).toFixed(1)}" y="${(LHf - ((b.v || 0) / m) * (LHf - 6)).toFixed(1)}" width="${(step * 0.6).toFixed(1)}" height="${(((b.v || 0) / m) * (LHf - 6)).toFixed(1)}" class="${b.c >= b.o ? "cu" : "cd"} soft"/>`));
    const r = s.volRatio?.[n - 1];
    label = `Volume <b>${r == null ? "–" : r.toFixed(1) + "x"}</b> usual`;
    if (full) axes = `<span class="ax" style="top:${at(6)}">${f(m)}</span><span class="ax" style="top:${at(LHf / 2 + 3)}">${f(m / 2)}</span>`;
  } else {
    // scale: a fixed range (RSI 0–100), or fitted to what's on screen, centred on zero for oscillators
    const keys = [...(P.lines || []).map((l) => l[0]), P.hist].filter(Boolean), vals = [];
    for (const k of keys) (s[k] || []).forEach((x) => x != null && isFinite(x) && vals.push(x));
    if (!vals.length) return `<div class="lower${full ? " lfull" : ""}" data-learn="${kind}" role="button"><span class="lower-label">${esc(P.label)} <b>–</b></span><div class="lplot"><p class="lnone">Not enough history in this view.</p></div>${full ? rm(kind) : ""}</div>`;
    let lo = P.range?.[0] ?? Math.min(...vals), hi = P.range?.[1] ?? Math.max(...vals);
    if (P.sym) { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -m; hi = m; }
    for (const r of P.refs || []) if (P.range?.[1] == null) { hi = Math.max(hi, r); lo = Math.min(lo, r); }
    if (P.zero && !P.sym) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (hi === lo) { hi += 1; lo -= 1; }
    const Y = (v) => 4 + (1 - (v - lo) / (hi - lo)) * (LHf - 8);
    if (full && P.band) body += `<rect x="0" width="${pw}" y="${Y(P.band[1]).toFixed(1)}" height="${(Y(P.band[0]) - Y(P.band[1])).toFixed(1)}" class="band"/>`;
    if (full) for (let g = 1; g < 4; g++) body += hline(4 + (g / 4) * (LHf - 8), "grid");
    if (P.zero && lo < 0 && hi > 0) body += hline(Y(0), "grid mid");
    for (const r of P.refs || []) body += hline(Y(r));
    if (P.hist) (s[P.hist] || []).forEach((v, i) => { if (v != null) body += `<rect x="${(X(i) - step * 0.3).toFixed(1)}" y="${Math.min(Y(v), Y(0)).toFixed(1)}" width="${(step * 0.6).toFixed(1)}" height="${Math.abs(Y(v) - Y(0)).toFixed(1)}" class="${v >= 0 ? "cu" : "cd"} soft"/>`; });
    for (const [k, col] of P.lines || []) body += `<path d="${path((s[k] || []).map((v, i) => (v == null ? null : [X(i), Y(v)])))}" class="pl${full ? "" : " draw"}" style="stroke:${col}" pathLength="1"/>`;
    const k0 = P.hist || P.lines[0][0], arr = s[k0] || [];
    for (let i = arr.length - 1; i >= 0 && now == null; i--) now = arr[i];
    label = `${esc(P.label)} <b>${now == null ? "–" : nf(now)}</b>`;
    if (full && (P.lines || []).length > 1) label += ` <i>${P.lines.map(([k, col]) => `<em style="background:${col}"></em>${esc(LEG[k] || k)}`).join(" ")}</i>`;
    const ticks = full ? [...new Set([...(P.refs || []), ...(P.zero && lo < 0 && hi > 0 ? [0] : []), ...(P.range?.[1] != null && P.band ? [(P.range[0] + P.range[1]) / 2] : []), ...(P.refs?.length ? [] : [hi, lo].map((x) => +f(x)))])] : (P.refs || []);
    axes = ticks.map((g) => `<span class="ax" style="top:${at(Y(g))}">${Number.isInteger(g) ? g : nf(g)}</span>`).join("");
  }
  if (sh || opts.count) body = `<clipPath id="lclip"><rect x="0" y="0" width="${pw}" height="${LHf}"/></clipPath><g clip-path="url(#lclip)">${body}</g>`;
  const fact = full ? panelFact(kind, s, win) : "";
  return `<div class="lower${full ? " lfull" : ""}" data-learn="${kind}" role="button" aria-label="What ${esc(P.name)} shows"><span class="lower-label">${label}</span><div class="lplot">${axes}<svg class="chart" viewBox="0 0 ${W} ${LHf}" preserveAspectRatio="none" aria-hidden="true">${body}</svg></div>${fact ? `<p class="lfact">${esc(fact)}</p>` : ""}${full ? rm(kind) : ""}</div>`;
}
const nf = (x) => (Math.abs(x) >= 1000 ? f(x) : Math.abs(x) >= 10 ? x.toFixed(1) : Math.abs(x) >= 0.1 ? x.toFixed(2) : x.toPrecision(2));
const LEG = { macd: "MACD", macdSignal: "signal", stochK: "%K", stochD: "%D", adx14: "ADX", plusDI: "+DI", minusDI: "−DI", aroonUp: "up", aroonDown: "down" };
const rm = (k) => `<button class="orm lrm" data-rmstudy="${k}" aria-label="Remove ${esc(PANELS[k]?.name || k)}">✕</button>`;
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function sparkline(vals, w = 80, h = 28, up = vals?.length ? vals[vals.length - 1] >= vals[0] : true) { // up: the colour, when the caller's % says which way
  if (!vals?.length) return "";
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const d = path(vals.map((v, i) => [(i / (vals.length - 1)) * w, h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)]));
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" class="${up ? "lu" : "ld"}"/></svg>`;
}
