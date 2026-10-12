// Small shared UI helpers: escaping, formatting, toast, bottom sheet.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const DISCLAIMER = "Information is for general understanding only. It is not investment advice or a recommendation to buy, sell or hold any security. We are not registered with SEBI or any other regulator as an adviser or research analyst.";

export function money(x, m) {
  if (x == null || !isFinite(x)) return "–";
  const a = Math.abs(x), d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  const n = x.toLocaleString(m === "NSE" || m === "INDEX" ? "en-IN" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return (m === "NSE" ? "₹" : m === "INDEX" ? "" : "$") + n;
}
export const pct = (x, d = 2) => (x == null || !isFinite(x) ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}%`);
export const arrow = (x) => (x >= 0 ? "▲" : "▼");
export const fmtDay = (d) => (!d ? "" : d.length > 10
  ? new Date(d + ":00Z").toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) // intraday candle
  : new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }));
export const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
export function ago(iso) {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

export function toast(msg, { action, onAction, ms = 3200 } = {}) {
  const t = $("toast");
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ""}`;
  t.hidden = false;
  if (action) t.querySelector("button").onclick = () => { t.hidden = true; onAction?.(); };
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}

let onCloseFn = null;
let closeTimer = null;
export function openSheet(title, body, onMount, onClose) {
  const sh = $("sheet"), bd = $("backdrop");
  // A sheet opened right after another one closes (e.g. "Open the full guide") must not be hidden by the
  // first sheet's closing animation.
  clearTimeout(closeTimer); closeTimer = null;
  sh.innerHTML = `<div class="grab"></div><div class="sh-head"><h2 id="shTitle">${title}</h2><button class="btn ghost" data-close aria-label="Close">Done</button></div><div class="sh-body">${body}</div>`;
  sh.hidden = false; bd.hidden = false;
  requestAnimationFrame(() => { sh.classList.add("on"); bd.classList.add("on"); });
  sh.querySelector("[data-close]").onclick = closeSheet;
  bd.onclick = closeSheet;
  onCloseFn = onClose || null;
  onMount?.(sh.querySelector(".sh-body"), sh);
}
export function setSheetBody(html) { const b = document.querySelector("#sheet .sh-body"); if (b) b.innerHTML = html; return b; }
export function closeSheet() {
  const sh = $("sheet"), bd = $("backdrop");
  if (sh.hidden) return;
  sh.classList.remove("on"); bd.classList.remove("on");
  closeTimer = setTimeout(() => { closeTimer = null; sh.hidden = true; bd.hidden = true; sh.innerHTML = ""; sh.style.bottom = sh.style.maxHeight = ""; }, 260);
  const fn = onCloseFn; onCloseFn = null; fn?.();
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
// Swipe a sheet down to close it, like any phone sheet: from its top bar, or from its content once that's scrolled to
// the top. A short drag springs back.
{
  let d = null;
  document.addEventListener("touchstart", (e) => {
    const sh = e.target.closest?.("#sheet"); if (!sh || e.touches.length > 1 || e.target.closest("input, textarea, select, .pchips, .fxchips, .opts")) return (d = null);
    const body = sh.querySelector(".sh-body"), inBody = body?.contains(e.target);
    d = { sh, y: e.touches[0].clientY, t: e.timeStamp, dy: 0, ok: !inBody || body.scrollTop <= 0 };
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!d?.ok) return;
    d.dy = e.touches[0].clientY - d.y;
    if (d.dy <= 0) { d.sh.style.transform = ""; return; }
    if (e.cancelable) e.preventDefault(); // the sheet follows the finger instead of the page bouncing
    d.sh.style.transition = "none"; d.sh.style.transform = `translateY(${d.dy}px)`;
  }, { passive: false });
  const end = (e) => {
    if (!d?.ok) return (d = null);
    const { sh, dy, t } = d; d = null;
    sh.style.transition = "";
    if (dy > 110 || (dy > 40 && dy / Math.max(1, e.timeStamp - t) > 0.6)) { closeSheet(); requestAnimationFrame(() => (sh.style.transform = "")); } // slides on down from where it was let go
    else sh.style.transform = "";
  };
  document.addEventListener("touchend", end, { passive: true });
  document.addEventListener("touchcancel", end, { passive: true });
}
// With the phone keyboard up, keep the open sheet just above it and no taller than the space left, so typing a
// note never pushes the page sideways or hides the text box.
if (window.visualViewport) {
  const vv = window.visualViewport, fit = () => {
    const sh = $("sheet"); if (!sh || sh.hidden) return;
    const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    sh.style.bottom = kb > 60 ? `${kb}px` : ""; sh.style.maxHeight = kb > 60 ? `${Math.round(vv.height - 12)}px` : "";
  };
  vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit);
}

// A short buzz where the phone supports it (Android browsers; iPhone browsers have no vibration for web pages).
export const haptic = (pattern = 6) => { try { navigator.vibrate?.(pattern); } catch {} };
