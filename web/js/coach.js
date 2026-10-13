// First-time guided tours. Each part of the app teaches itself the first time it is opened, by doing:
// an animated finger shows the gesture and the step moves on when the person actually does it.
// Every step also has Next, and the whole tour can be skipped. Shown once per part, remembered on the device.
import { ls } from "./store.js";

const KEY = "pl.coach";
const done = (id) => !!ls.get(KEY, {})[id];
const markDone = (id) => ls.set(KEY, { ...ls.get(KEY, {}), [id]: 1 });

let tour = null; // { id, steps, k, el }

// Gestures and actions the app reports, so a step can finish when the person does the thing it teaches.
export const coachEvent = (type, extra = {}) => document.dispatchEvent(new CustomEvent("pulse-coach", { detail: { type, ...extra } }));
document.addEventListener("pulse-coach", (e) => {
  const st = tour?.steps[tour.k];
  if (st?.until && st.until(e.detail)) setTimeout(next, st.delay ?? 450);
});
addEventListener("resize", () => tour && place());

export const TOURS = {
  feed: [
    { target: ".card.active", text: "Swipe up to see your first coin.", hand: "up", until: (d) => d.type === "card" && d.sym },
    { target: ".card.active .chartbox", text: "Swipe left for details: today's numbers, readings and ranges.", hand: "left", until: (d) => d.type === "pane" && d.view === "details" },
    { target: ".card.active", text: "Swipe right to come back, and right again for the news.", hand: "right", until: (d) => d.type === "pane" && d.view === "news" },
    { target: ".card.active", text: "Swipe left to return to the chart.", hand: "left", until: (d) => d.type === "pane" && d.view === "main" },
    { target: ".card.active .chartbox", text: "Hold the chart, then slide, to read any day. Let go to set an alert at that price.", hand: "hold", until: (d) => d.type === "scrub", delay: 1400 },
    { target: ".card.active [data-tf]", text: "Tap here to change the time range or chart type, for this coin or all of them. The S/R button shows support and resistance lines.", hand: "tap", ring: true, until: (d) => d.type === "tf" },
  ],
  dash: [{ target: "#dash .wchips", text: "Your coins, by watchlist. Picking one here also sets what the feed shows. Your alerts are further down.", ring: true }],
  play: [
    { target: "#play .pl-head", text: "This is you: your username and prediction score, from 300 to 900. Tap it for your profile; the gear above is settings.", ring: true },
    { target: "#play .pl-tiles", text: "Calls are your predictions. Groups are friends calling the same coin over the same time. Ranks show where you stand.", ring: true },
    { target: "#play .pchips", text: "Tap a coin to call its price. It's a game for learning: no money, not advice.", ring: true, hand: "tap" },
  ],
  add: [{ target: "#addQ", text: "Type a coin's name or symbol, like “sol”. Tap the result, then pick its watchlists.", ring: true }],
};

export function startTour(id) {
  if (done(id) || tour?.id === id) return;
  if (tour) finish(true); // one tour at a time
  const el = document.createElement("div");
  el.id = "coach"; el.className = "coach";
  el.innerHTML = `<div class="ring" hidden></div><div class="hand" hidden></div><div class="bubble" role="dialog" aria-live="polite"><p></p><div class="cb"><button data-skip>Skip tour</button><span class="cn"></span><button data-next class="primary">Next</button></div></div>`;
  document.body.appendChild(el);
  el.querySelector("[data-skip]").onclick = () => finish(true);
  el.querySelector("[data-next]").onclick = next;
  tour = { id, steps: TOURS[id], k: 0, el };
  show();
}
function show() {
  const st = tour.steps[tour.k], el = tour.el;
  el.querySelector(".bubble p").textContent = st.text;
  el.querySelector(".cn").textContent = tour.steps.length > 1 ? `${tour.k + 1} / ${tour.steps.length}` : "";
  el.querySelector("[data-next]").textContent = tour.k === tour.steps.length - 1 ? "Got it" : "Next";
  el.querySelector("[data-skip]").hidden = tour.steps.length === 1;
  const hand = el.querySelector(".hand");
  hand.className = "hand" + (st.hand ? " h-" + st.hand : ""); hand.hidden = !st.hand;
  el.querySelector(".bubble").classList.remove("in"); void el.offsetWidth; el.querySelector(".bubble").classList.add("in");
  place();
}
function place() {
  const st = tour.steps[tour.k], el = tour.el, t = document.querySelector(st.target);
  const ring = el.querySelector(".ring"), hand = el.querySelector(".hand"), bub = el.querySelector(".bubble");
  if (!t) { ring.hidden = true; hand.hidden = true; bub.style.top = ""; bub.classList.add("bottom"); return; }
  const r = t.getBoundingClientRect(), H = innerHeight;
  ring.hidden = !st.ring;
  if (st.ring) Object.assign(ring.style, { left: r.left - 6 + "px", top: r.top - 6 + "px", width: r.width + 12 + "px", height: r.height + 12 + "px" });
  const cy = Math.min(H * 0.62, r.top + r.height / 2);
  if (st.hand) Object.assign(hand.style, { left: r.left + r.width / 2 + "px", top: (st.ring ? r.top + r.height / 2 : cy) + "px" });
  // the bubble sits clear of what it points at: below small things near the top, otherwise above the tab bar
  bub.classList.remove("bottom");
  if (st.ring && r.bottom < H * 0.55) bub.style.top = r.bottom + 16 + "px";
  else if (st.ring) bub.style.top = Math.max(70, r.top - 150) + "px";
  else { bub.style.top = ""; bub.classList.add("bottom"); }
}
function next() {
  if (!tour) return;
  if (tour.k < tour.steps.length - 1) { tour.k++; show(); } else finish(false);
}
function finish() { if (!tour) return; markDone(tour.id); tour.el.remove(); tour = null; }
export const resetTours = () => ls.set(KEY, {});
