// Fixed, standardised charts drawn as SVG: the same window, scale rules and overlays for every symbol,
// so the eye learns the shapes while scrolling. No pan or zoom, so swipes never fight the chart.
const W = 360, H = 210, PR = 46, PT = 22, PB = 14; // right gutter for price labels, top room for the window label
const LH = 64;

const f = (x) => (Math.abs(x) >= 1000 ? x.toFixed(0) : Math.abs(x) >= 100 ? x.toFixed(1) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toPrecision(3));
const path = (pts) => pts.reduce((s, p, i) => (p == null ? s : s + (s && pts[i - 1] != null ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)), "");

export const MA_COLORS = ["var(--ma1)", "var(--ma2)", "var(--ma3)"];

// win: bars in the window [{t,o,h,l,c,v}], ov: {key: values[] aligned to win}, opts: {type, closeOnly, maKeys:[...]}
export function mainChart(win, ov, opts) {
  const n = win.length;
  if (!n) return "";
  const pw = W - PR, step = pw / n, bw = Math.max(1.5, step * 0.62);
  const vals = [];
  win.forEach((b) => vals.push(opts.closeOnly ? b.c : b.h, opts.closeOnly ? b.c : b.l));
  (opts.maKeys || []).forEach((k) => (ov[k] || []).forEach((x) => x != null && vals.push(x)));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  // support/resistance or pivot lines: keep those near the visible prices and widen the scale to fit them
  const span0 = hi - lo || hi * 0.02, lv = (opts.levels || []).filter((l) => l.price >= lo - span0 * 0.25 && l.price <= hi + span0 * 0.25);
  for (const l of lv) { lo = Math.min(lo, l.price); hi = Math.max(hi, l.price); }
  const pad = (hi - lo) * 0.06 || hi * 0.01 || 1; lo -= pad; hi += pad;
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const X = (i) => i * step + step / 2;
  const first = win[0].c, last = win[n - 1].c, up = last >= first;
  let body = "";
  // grid: three quiet lines
  for (const g of [0.25, 0.5, 0.75]) body += `<line x1="0" x2="${pw}" y1="${(PT + g * (H - PT - PB)).toFixed(1)}" y2="${(PT + g * (H - PT - PB)).toFixed(1)}" class="grid"/>`;
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
  // price labels as HTML so they keep their shape while the drawing stretches to fit the screen
  const ly = Y(last), top = (y) => ((y / H) * 100).toFixed(2) + "%";
  body += `<line x1="0" x2="${pw}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}" class="lastline"/>`;
  let lvHtml = "";
  for (const l of lv) {
    const y = Y(l.price), x0 = Math.max(0, X(l.from || 0) - step / 2), cls = l.kind[0] === "R" ? "r" : l.kind[0] === "S" ? "s" : "p";
    body += `<line x1="${x0.toFixed(1)}" x2="${pw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="lvl ${cls}"/>`;
    const tag = l.touches ? `${l.kind === "R" ? "Resistance" : "Support"} ${f(l.price)} · ${l.touches > 1 ? l.touches + "×" : l.kind === "R" ? "recent high" : "recent low"}` : `${l.kind} ${f(l.price)}`;
    lvHtml += `<button class="lvtag ${cls}" data-learn="${l.touches ? "SR" : "PIV"}" style="top:${((y / H) * 100).toFixed(2)}%;right:${((PR / W) * 100).toFixed(2)}%">${tag}</button>`;
  }
  // time axis like TradingView: month names (the year at each January), or day numbers on short ranges
  const ticks = timeTicks(win, opts.days || 91);
  for (const t of ticks) body += `<line x1="${X(t.i).toFixed(1)}" x2="${X(t.i).toFixed(1)}" y1="${PT}" y2="${H - PB}" class="grid vgrid"/>`;
  const xaxis = `<div class="xaxis" aria-hidden="true">${ticks.map((t) => `<span class="${t.major ? "maj" : ""}" style="left:${((X(t.i) / W) * 100).toFixed(2)}%">${t.label}</span>`).join("")}</div>`;
  const labels = `<span class="ax" style="top:${top(PT)}">${f(hi - pad)}</span><span class="ax" style="top:${top(H - PB)}">${f(lo + pad)}</span>` +
    `<span class="axlast ${up ? "pu" : "pd"}" style="top:${top(ly)}">${f(last)}</span>`;
  return `<div class="plot"><svg class="chart" data-lo="${lo}" data-hi="${hi}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${n} ${opts.interval === "1W" ? "weeks" : "days"}, ${up ? "up" : "down"} ${Math.abs(((last - first) / first) * 100).toFixed(1)}%, last ${f(last)}, from ${win[0].t} to ${win[n - 1].t}">${body}</svg>${labels}${lvHtml}</div>${xaxis}`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Where to put date labels under the chart: at most about 6, never crowded.
export function timeTicks(win, days) {
  const out = [];
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
export function lowerChart(win, s, kind) {
  const n = win.length, pw = W - PR, step = pw / n, X = (i) => i * step + step / 2;
  if (!n || kind === "none") return "";
  let body = "", label = "";
  if (kind === "RSI") {
    const Y = (v) => 4 + (1 - v / 100) * (LH - 8);
    body += `<line x1="0" x2="${pw}" y1="${Y(70)}" y2="${Y(70)}" class="ref"/><line x1="0" x2="${pw}" y1="${Y(30)}" y2="${Y(30)}" class="ref"/>`;
    body += `<path d="${path(s.rsi14.map((v, i) => (v == null ? null : [X(i), Y(v)])))}" class="rsi draw" pathLength="1"/>`;
    const lv = s.rsi14[n - 1];
    label = `RSI 14 <b>${lv == null ? "–" : lv.toFixed(1)}</b>`;
    label += `<span class="ax" style="top:${((Y(70) / LH) * 100).toFixed(1)}%">70</span><span class="ax" style="top:${((Y(30) / LH) * 100).toFixed(1)}%">30</span>`;
  } else if (kind === "MACD") {
    const all = [...s.macdHist, ...s.macd, ...s.macdSignal].filter((x) => x != null);
    const m = Math.max(...all.map(Math.abs)) || 1, Y = (v) => LH / 2 - (v / m) * (LH / 2 - 4);
    s.macdHist.forEach((v, i) => { if (v != null) body += `<rect x="${(X(i) - step * 0.3).toFixed(1)}" y="${Math.min(Y(v), Y(0)).toFixed(1)}" width="${(step * 0.6).toFixed(1)}" height="${Math.abs(Y(v) - Y(0)).toFixed(1)}" class="${v >= 0 ? "cu" : "cd"} soft"/>`; });
    body += `<path d="${path(s.macd.map((v, i) => (v == null ? null : [X(i), Y(v)])))}" class="macd"/><path d="${path(s.macdSignal.map((v, i) => (v == null ? null : [X(i), Y(v)])))}" class="sig"/>`;
    const h = s.macdHist[n - 1];
    label = `MACD hist <b>${h == null ? "–" : f(h)}</b>`;
  } else if (kind === "VOL") {
    const m = Math.max(...win.map((b) => b.v || 0)) || 1;
    win.forEach((b, i) => (body += `<rect x="${(X(i) - step * 0.3).toFixed(1)}" y="${(LH - ((b.v || 0) / m) * (LH - 6)).toFixed(1)}" width="${(step * 0.6).toFixed(1)}" height="${(((b.v || 0) / m) * (LH - 6)).toFixed(1)}" class="${b.c >= b.o ? "cu" : "cd"} soft"/>`));
    const r = s.volRatio[n - 1];
    label = `Volume <b>${r == null ? "–" : r.toFixed(1) + "x"}</b> usual`;
  }
  const [lab, ...axes] = label.split("<span class=\"ax\"");
  return `<div class="lower" data-learn="${kind}" role="button" aria-label="What ${kind === "VOL" ? "volume" : kind} shows"><span class="lower-label">${lab}</span><div class="lplot">${axes.map((a) => "<span class=\"ax\"" + a).join("")}<svg class="chart" viewBox="0 0 ${W} ${LH}" preserveAspectRatio="none" aria-hidden="true">${body}</svg></div></div>`;
}

export function sparkline(vals, w = 80, h = 28) {
  if (!vals?.length) return "";
  const lo = Math.min(...vals), hi = Math.max(...vals), up = vals[vals.length - 1] >= vals[0];
  const d = path(vals.map((v, i) => [(i / (vals.length - 1)) * w, h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)]));
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" class="${up ? "lu" : "ld"}"/></svg>`;
}
