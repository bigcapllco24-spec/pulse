// Share your card as an image (1.1.0). The phone draws the card itself (Story 1080×1920 or Square 1080×1080, in Paper
// or the dark theme) and hands it to the phone's share menu; where that can't take files it saves the PNG instead.
// Nothing is uploaded or stored. The card shows the username, score, band, record and (optionally) rank and streak,
// never a price call.
import { CONFIG } from "../config.js";
import { toast, openSheet, haptic } from "./ui.js";
import { BANDS, SCORE_MIN, SCORE_MAX } from "./score.js";
import { BAND_CLASS } from "./card.js";
import { ls } from "./store.js";

const LOOKS = { // the app's own two themes (styles.css)
  light: { bg: "#F4F6F8", surface: "#FFFFFF", s2: "#EEF1F4", line: "#DCE2E8", text: "#131C24", muted: "#5A6774", accent: "#2B4FC7", up: "#0B7A4B", down: "#C0362C", b1: "#A35A3F", b2: "#5A6774", b3: "#8A6A1E", b4: "#7B4FD6", b5: "#2E7A60" },
  dark: { bg: "#0B0F14", surface: "#131A21", s2: "#1A232C", line: "#24303B", text: "#E8EEF3", muted: "#8A98A6", accent: "#7EA2FF", up: "#3DD68C", down: "#FF6B61", b1: "#B9775F", b2: "#A3B0BD", b3: "#BFA05E", b4: "#B48CFF", b5: "#4E9C82" },
};
const SIZES = { story: [360, 640], square: [360, 360] };
const SCALE = 3; // 1080 px wide
const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', MONO = '"Geist Mono", ui-monospace, Menlo, monospace';
const PREF = "pl.share";
export const siteText = () => (location.host + location.pathname).replace(/\/(index\.html)?$/, "");

const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, "0");
function rrect(x, y, w, h, r, ctx) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
function text(ctx, s, x, y, { size = 14, weight = 400, color, font = FONT, align = "left", spacing = 0 } = {}) {
  ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(s, x, y);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
}
const width = (ctx, s, size, weight, font = FONT) => { ctx.font = `${weight} ${size}px ${font}`; return ctx.measureText(s).width; };
const fit = (ctx, s, size, weight, max) => { if (width(ctx, s, size, weight) <= max) return s; while (s.length > 2 && width(ctx, s + "…", size, weight) > max) s = s.slice(0, -1); return s + "…"; };
function logo(ctx, x, y, s, k) { // the pulse mark and the app's name
  ctx.save(); ctx.translate(x, y); ctx.scale(s / 24, s / 24); ctx.strokeStyle = k.accent; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(2, 12); ctx.lineTo(7, 12); ctx.lineTo(9.5, 6); ctx.lineTo(14.5, 18); ctx.lineTo(17, 12); ctx.lineTo(22, 12); ctx.stroke(); ctx.restore();
  text(ctx, CONFIG.appName, x + s + 6, y + s * 0.78, { size: s * 0.78, weight: 800, color: k.text });
}
function avatar(ctx, cx, cy, r, u, k) {
  ctx.fillStyle = alpha(k.band, 0.2); ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, 7); ctx.fill();
  ctx.fillStyle = k.bg; ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, 7); ctx.fill();
  ctx.fillStyle = k.s2; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
  ctx.strokeStyle = k.band; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, r - 1.5, 0, 7); ctx.stroke();
  ctx.textBaseline = "middle"; ctx.font = `800 ${r * 0.8}px ${FONT}`; ctx.fillStyle = k.text; ctx.textAlign = "center"; ctx.fillText((u || "?")[0].toUpperCase(), cx, cy + 1);
}
function chips(ctx, list, cx, y, k, { align = "center", x0 = 0 } = {}) { // [[label, kind]] → pills in one row
  const h = 24, pad = 10, gap = 6, ws = list.map(([s]) => width(ctx, s, 12, 700) + pad * 2 + 0);
  let x = align === "center" ? cx - (ws.reduce((a, w) => a + w, 0) + gap * (list.length - 1)) / 2 : x0;
  list.forEach(([s, kind], i) => {
    ctx.fillStyle = kind === "band" ? alpha(k.band, 0.18) : k.s2; rrect(x, y, ws[i], h, h / 2, ctx); ctx.fill();
    text(ctx, s, x + pad, y + 16.5, { size: 12, weight: 700, color: kind === "band" && k.bandText ? k.bandText : k.text });
    x += ws[i] + gap;
  });
}
function dial(ctx, cx, cy, r, sw, score, k, { big = 54, sub = "out of 900" } = {}) {
  const P = (v) => Math.PI * (1 + (v - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)); // canvas angles: π (left) → 2π (right)
  const bands = [...BANDS].reverse().map(([min, name], i, a) => [min, i + 1 < a.length ? a[i + 1][0] : SCORE_MAX, name]);
  ctx.lineWidth = sw; ctx.lineCap = "butt";
  for (const [lo, hi, name] of bands) {
    ctx.strokeStyle = k[BAND_CLASS[name]]; ctx.globalAlpha = lo <= score ? 1 : 0.28;
    ctx.beginPath(); ctx.arc(cx, cy, r, P(lo + 3), P(hi - 3)); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const a = P(score), mx = cx + r * Math.cos(a), my = cy + r * Math.sin(a);
  ctx.fillStyle = k.text; ctx.strokeStyle = k.bg; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(mx, my, sw * 0.62, 0, 7); ctx.fill(); ctx.stroke();
  text(ctx, String(score), cx, cy - r * 0.24, { size: big, weight: 600, color: k.text, font: MONO, align: "center", spacing: -2 });
  if (sub) text(ctx, sub, cx, cy - r * 0.02, { size: 12.5, color: k.muted, align: "center" });
}
function stats(ctx, x, y, w, h, c, k, size = 20) {
  ctx.fillStyle = k.surface; rrect(x, y, w, h, 18, ctx); ctx.fill(); ctx.strokeStyle = k.line; ctx.lineWidth = 1; ctx.stroke();
  const cols = [[String(c.n || 0), "calls scored", k.text], [String(c.spot ?? 0), "Spot on", k.accent], [c.closePlus != null ? c.closePlus + "%" : "–", "Close or better", k.text]];
  cols.forEach(([v, l, col], i) => {
    const mid = x + (w / 3) * (i + 0.5);
    if (i) { ctx.strokeStyle = k.line; ctx.beginPath(); ctx.moveTo(x + (w / 3) * i, y + 12); ctx.lineTo(x + (w / 3) * i, y + h - 12); ctx.stroke(); }
    text(ctx, v, mid, y + h / 2 + 2, { size, weight: 600, color: col, font: MONO, align: "center" });
    text(ctx, l, mid, y + h / 2 + 18, { size: 11, color: k.muted, align: "center" });
  });
}
function line(ctx, x, y, w, h, pts, k) {
  const xs = pts.filter((p) => p.s != null); if (xs.length < 2) return false;
  const lo = Math.min(...xs.map((p) => p.s)) - 5, hi = Math.max(...xs.map((p) => p.s)) + 5;
  ctx.strokeStyle = k.accent; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath();
  xs.forEach((p, i) => { const px = x + (i / (xs.length - 1)) * w, py = y + h - ((p.s - lo) / (hi - lo)) * h; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.stroke(); return true;
}

// Draws the card. c: your card; o: { fmt: "story"|"square", look: "light"|"dark", rank: bool, streak: bool }.
export async function drawCard(c, o) {
  try { await Promise.all([document.fonts.load(`800 20px ${FONT}`), document.fonts.load(`600 40px ${MONO}`)]); } catch {} // the image waits for the app's fonts
  const [W, H] = SIZES[o.fmt] || SIZES.story, k = { ...LOOKS[o.look] || LOOKS.light };
  k.band = k[BAND_CLASS[c.band] || "b3"]; k.bandText = BAND_CLASS[c.band] === "b2" ? k.muted : k.band; // the grey is too faint for text
  const cv = document.createElement("canvas"); cv.width = W * SCALE; cv.height = H * SCALE;
  const ctx = cv.getContext("2d"); ctx.scale(SCALE, SCALE);
  ctx.fillStyle = k.bg; ctx.fillRect(0, 0, W, H);
  const list = [[c.band + (c.prov ? " · provisional" : ""), "band"]];
  if (o.rank && c.rank) list.push([`Top ${Math.max(1, Math.ceil((c.rank / Math.max(1, c.of)) * 100))}% · #${c.rank}`]);
  if (o.streak && c.streak) list.push([`${c.streak}-day streak`]);
  const url = siteText();
  if (o.fmt === "square") {
    logo(ctx, 20, 18, 19, k); text(ctx, "PREDICTION SCORE", W - 20, 33, { size: 9.5, weight: 700, color: k.muted, align: "right", spacing: 1 });
    avatar(ctx, 49, 92, 27, c.u, k);
    text(ctx, fit(ctx, "@" + c.u, 17, 700, 140), 20, 148, { size: 17, weight: 700, color: k.text });
    list.forEach(([s, kind], i) => (i === 0 ? chips(ctx, [[s, kind]], 0, 158, k, { align: "left", x0: 20 }) : text(ctx, s, 20, 200 + (i - 1) * 17, { size: 11.5, color: k.muted })));
    dial(ctx, 252, 175, 76, 13, c.score, k, { big: 42, sub: "" });
    stats(ctx, 20, 252, W - 40, 58, c, k, 18);
    text(ctx, url, 20, 340, { size: 11, weight: 600, color: k.accent });
    text(ctx, "A learning game, not advice", W - 20, 340, { size: 9, color: k.muted, align: "right" });
  } else {
    logo(ctx, 26, 24, 22, k); text(ctx, "PREDICTION SCORE", W - 26, 41, { size: 10, weight: 700, color: k.muted, align: "right", spacing: 1 });
    avatar(ctx, W / 2, 118, 38, c.u, k);
    text(ctx, fit(ctx, "@" + c.u, 21, 700, W - 60), W / 2, 190, { size: 21, weight: 700, color: k.text, align: "center" });
    chips(ctx, list, W / 2, 204, k);
    dial(ctx, W / 2, 384, 104, 14, c.score, k);
    stats(ctx, 26, 412, W - 52, 66, c, k);
    const pts = c.line || [];
    if (pts.filter((p) => p.s != null).length >= 2) {
      const xs = pts.filter((p) => p.s != null), d = xs.at(-1).s - xs[0].s;
      text(ctx, "Last 90 days", 26, 506, { size: 11, color: k.muted });
      text(ctx, `${xs[0].s} → ${xs.at(-1).s}${d ? `  ${d > 0 ? "+" : "−"}${Math.abs(d)}` : ""}`, W - 26, 506, { size: 11, color: d > 0 ? k.up : d < 0 ? k.down : k.muted, font: MONO, align: "right" });
      line(ctx, 30, 516, W - 60, 36, pts, k);
    } else { // no score history yet: the five bands, so the number has a scale
      const bands = [...BANDS].reverse(), cw = (W - 52) / bands.length;
      text(ctx, "Score bands", 26, 510, { size: 11, color: k.muted });
      bands.forEach(([min, name], i) => {
        const x = 26 + i * cw; ctx.fillStyle = k[BAND_CLASS[name]]; rrect(x, 520, cw - 4, 6, 3, ctx); ctx.fill();
        text(ctx, name, x, 542, { size: 10, weight: 600, color: name === c.band ? k.text : k.muted });
        text(ctx, String(min), x, 556, { size: 10, color: k.muted, font: MONO });
      });
    }
    text(ctx, `Make your own calls on ${CONFIG.appName}`, W / 2, 586, { size: 13, weight: 700, color: k.text, align: "center" });
    text(ctx, url, W / 2, 604, { size: 11, weight: 600, color: k.accent, align: "center" });
    text(ctx, "A learning game, not advice. Price calls are never shown.", W / 2, 624, { size: 9.5, color: k.muted, align: "center" });
  }
  return cv;
}
const toBlob = (cv) => new Promise((res) => cv.toBlob(res, "image/png"));

function save(blob, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// The share sheet: a live preview, size and look, rank and streak switches, then Share or Save image.
export function openShareSheet(c) {
  if (c.score == null) { toast("Your card can be shared once your first call is scored."); return; }
  const dark = document.documentElement.dataset.theme !== "light";
  const o = { fmt: "story", look: dark ? "dark" : "light", rank: true, streak: true, ...ls.get(PREF, {}) };
  let blob = null, seq = 0;
  const name = () => `${CONFIG.appName.toLowerCase()}-${c.u}-${o.fmt}.png`;
  openSheet("Share your card", `<div class="sh-prev"><img id="shImg" alt="Your card"></div>
    <div class="sh-opts"><div><span class="label">Size</span><div class="opts" data-k="fmt"><button class="opt" data-v="story">Story</button><button class="opt" data-v="square">Square</button></div></div>
      <div><span class="label">Look</span><div class="opts" data-k="look"><button class="opt" data-v="light">Light</button><button class="opt" data-v="dark">Dark</button></div></div></div>
    <div class="hl">${c.rank ? `<label class="row pl-switchrow"><span class="main"><span class="t">Show my rank</span></span><span class="switch"><input type="checkbox" id="shRank"><span></span></span></label>` : ""}
      ${c.streak ? `<label class="row pl-switchrow"><span class="main"><span class="t">Show my streak</span></span><span class="switch"><input type="checkbox" id="shStreak"><span></span></span></label>` : ""}</div>
    <p class="hint">Shows your username, score, band and record. Never your price calls.</p>
    <div class="sh-acts"><button class="btn primary" id="shGo">Share</button><button class="btn" id="shSave">Save image</button></div>`, (body) => {
    const img = body.querySelector("#shImg"), go = body.querySelector("#shGo");
    const draw = async () => {
      const my = ++seq;
      body.querySelectorAll(".opts").forEach((g) => g.querySelectorAll(".opt").forEach((b) => b.setAttribute("aria-pressed", String(o[g.dataset.k] === b.dataset.v))));
      const r = body.querySelector("#shRank"), s = body.querySelector("#shStreak"); if (r) r.checked = o.rank; if (s) s.checked = o.streak;
      body.querySelector(".sh-prev").dataset.fmt = o.fmt;
      go.disabled = true;
      const cv = await drawCard(c, o); if (my !== seq) return;
      blob = await toBlob(cv); if (my !== seq) return;
      if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
      img.src = img.dataset.url = URL.createObjectURL(blob); go.disabled = false;
      ls.set(PREF, { fmt: o.fmt, look: o.look, rank: o.rank, streak: o.streak });
    };
    body.querySelectorAll(".opts").forEach((g) => g.querySelectorAll(".opt").forEach((b) => (b.onclick = () => { o[g.dataset.k] = b.dataset.v; draw(); })));
    body.querySelector("#shRank")?.addEventListener("change", (e) => { o.rank = e.target.checked; draw(); });
    body.querySelector("#shStreak")?.addEventListener("change", (e) => { o.streak = e.target.checked; draw(); });
    go.onclick = async () => {
      if (!blob) return;
      const file = new File([blob], name(), { type: "image/png" }), text = `My ${CONFIG.appName} prediction score: ${c.score} (${c.band}). ${location.origin}${location.pathname}`;
      try {
        if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); haptic(); return; }
      } catch (e) { if (e?.name === "AbortError") return; }
      save(blob, name()); toast("This browser can't share images directly, so the image was saved instead.", { ms: 4500 });
    };
    body.querySelector("#shSave").onclick = () => { if (blob) { save(blob, name()); toast("Image saved."); } };
    draw();
  }, () => { const i = document.querySelector("#shImg"); if (i?.dataset.url) URL.revokeObjectURL(i.dataset.url); });
}
