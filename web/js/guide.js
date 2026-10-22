// How Pulse works (1.2.9): a five-card guide, one idea per card. Shown once to every account (right after a new
// account's first call; to existing accounts on their next open) and any time from Settings → How Pulse works.
// It only sits on top of the app: closing it leaves everything exactly where it was.
import { CONFIG } from "../config.js";
import { store, ls, save } from "./store.js";
import { esc, haptic } from "./ui.js";
import { addLayer, dropLayer } from "./nav.js";

const SEEN = "pl.guideSeen";
export const guideSeen = () => !!ls.get(SEEN) || !!store.data?.guideSeen;

const ART = {
  feed: `<svg viewBox="0 0 160 120" aria-hidden="true"><rect x="45" y="6" width="70" height="108" rx="12" class="g-ph"/><rect x="53" y="18" width="54" height="36" rx="6" class="g-card"/><path d="M57 46l10-8 8 4 10-12 10 6" class="g-line"/><rect x="53" y="62" width="54" height="36" rx="6" class="g-card dim"/><path d="M80 104V86m0 0l-7 7m7-7l7 7" class="g-arrow" transform="translate(0,-20)"/></svg>`,
  sides: `<svg viewBox="0 0 160 120" aria-hidden="true"><rect x="8" y="22" width="40" height="76" rx="8" class="g-card dim"/><rect x="60" y="14" width="40" height="92" rx="9" class="g-ph"/><path d="M66 70l8-7 7 3 7-10 6 4" class="g-line"/><rect x="112" y="22" width="40" height="76" rx="8" class="g-card dim"/><text x="28" y="64" class="g-t">News</text><text x="132" y="64" class="g-t">Details</text><path d="M56 112h-18m0 0l5-4m-5 4l5 4M104 112h18m0 0l-5-4m5 4l-5 4" class="g-arrow"/></svg>`,
  call: `<svg viewBox="0 0 160 120" aria-hidden="true"><rect x="18" y="20" width="58" height="38" rx="10" class="g-up"/><text x="47" y="44" class="g-t up">▲ Higher</text><rect x="84" y="20" width="58" height="38" rx="10" class="g-dn"/><text x="113" y="44" class="g-t dn">▼ Lower</text><rect x="18" y="70" width="124" height="32" rx="10" class="g-go"/><text x="80" y="91" class="g-t ink">Lock in</text></svg>`,
  score: `<svg viewBox="0 0 160 120" aria-hidden="true"><line x1="10" y1="34" x2="150" y2="34" class="g-target"/><path d="M10 96l18-8 14 5 18-16 14 6 18-20 14 4 18-22 16-6" class="g-line"/><circle cx="146" cy="40" r="6" class="g-hit"/><text x="10" y="26" class="g-t l">Your call</text></svg>`,
  people: `<svg viewBox="0 0 160 120" aria-hidden="true"><circle cx="50" cy="52" r="18" class="g-av a"/><circle cx="80" cy="44" r="22" class="g-av b"/><circle cx="110" cy="52" r="18" class="g-av c"/><rect x="34" y="86" width="92" height="22" rx="11" class="g-go"/><text x="80" y="101" class="g-t ink">Follow</text></svg>`,
};
const CARDS = [
  ["feed", "Swipe up for the next coin", "Your feed is one coin at a time: its price, how it moved and its chart."],
  ["sides", "Swipe sideways for more", "Left for the coin's news, right for the details: how much it usually moves, and your calls on it."],
  ["call", "Call where it goes next", "Tap Call it under the price. Pick higher or lower, how far, then lock it in. That's it."],
  ["score", "See how you did", "When the time's up, your call is checked against the real price, and you see how close you were."],
  ["people", "Play with others", "On Calls, find players and follow them, or start a group and call the same coin together. A learning game, never advice."],
];

let el = null;
export function openGuide({ first = false } = {}) {
  if (el) return;
  let i = 0;
  el = document.createElement("div");
  el.id = "guide"; el.className = "guide"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", `How ${CONFIG.appName} works`);
  document.body.appendChild(el); document.body.classList.add("guided");
  const layer = addLayer(() => close()); // the phone's back closes it
  const close = () => {
    dropLayer(layer);
    ls.set(SEEN, 1);
    if (store.data?.username && !store.data.guideSeen) save({ guideSeen: 1 }).catch(() => {});
    el.remove(); el = null; document.body.classList.remove("guided");
  };
  const draw = () => {
    const [art, title, text] = CARDS[i], last = i === CARDS.length - 1;
    el.innerHTML = `<div class="gd-in">
        <div class="gd-top"><span class="label">${first ? `Welcome to ${esc(CONFIG.appName)}` : `How ${esc(CONFIG.appName)} works`}</span>${last ? "" : `<button class="linkbtn gd-skip" id="gdSkip">Skip</button>`}</div>
        <div class="gd-art">${ART[art]}</div>
        <h1 class="gd-h">${esc(title)}</h1>
        <p class="gd-p">${esc(text)}</p>
        <div class="gd-foot"><div class="gd-dots" aria-hidden="true">${CARDS.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
          <div class="gd-btns">${i ? `<button class="btn ghost" id="gdBack">Back</button>` : ""}<button class="btn primary" id="gdNext">${last ? "Start calling" : "Next"}</button></div></div>
      </div>`;
    el.querySelector("#gdSkip")?.addEventListener("click", close);
    el.querySelector("#gdBack")?.addEventListener("click", () => { i--; draw(); });
    el.querySelector("#gdNext").onclick = () => { if (last) return close(); i++; haptic(); draw(); };
  };
  // a sideways swipe moves between cards too
  let x0 = null;
  el.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (dx < -50 && i < CARDS.length - 1) { i++; draw(); } else if (dx > 50 && i > 0) { i--; draw(); }
  }, { passive: true });
  draw();
}
