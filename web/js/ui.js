// Small shared UI helpers: escaping, formatting, toast, bottom sheet.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const DISCLAIMER = "Information and AI explanations are for general understanding only. They are not investment advice or a recommendation to buy, sell or hold any security. We are not registered with SEBI or any other regulator as an adviser or research analyst.";

export function money(x, m) {
  if (x == null || !isFinite(x)) return "–";
  const a = Math.abs(x), d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  const n = x.toLocaleString(m === "NSE" || m === "INDEX" ? "en-IN" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return (m === "NSE" ? "₹" : m === "INDEX" ? "" : "$") + n;
}
export const pct = (x, d = 2) => (x == null || !isFinite(x) ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}%`);
export const arrow = (x) => (x >= 0 ? "▲" : "▼");
export const fmtDay = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "");
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
  closeTimer = setTimeout(() => { closeTimer = null; sh.hidden = true; bd.hidden = true; sh.innerHTML = ""; }, 260);
  const fn = onCloseFn; onCloseFn = null; fn?.();
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

export const haptic = () => { try { navigator.vibrate?.(6); } catch {} };
