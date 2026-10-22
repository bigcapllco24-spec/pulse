// Back everywhere (1.3.0). Every page and sheet that opens over the app is a layer. While any layer is open, one
// history entry guards them, so the phone's back (Android's button, iPhone's edge swipe) closes the top layer instead
// of leaving Pulse. On-screen back and Done close the same layer; when the last one closes, the guard entry goes too.
// Back on a tab's own screen does what the phone normally does.
const layers = [];
let armed = false, pending = 0;

// close({ nav }) closes the layer's UI; nav is true when the phone's back did it.
export function addLayer(close) { const l = { close }; layers.push(l); arm(); return l; }
export function dropLayer(l) {
  const i = layers.indexOf(l); if (i < 0) return;
  layers.splice(i, 1);
  if (!layers.length && armed) { armed = false; pending++; history.back(); }
}
// The on-screen back: exactly what the phone's back does.
export function back() { layers.at(-1)?.close({}); }

function arm() {
  if (armed || pending || !layers.length) return; // with a back on its way, the guard is pushed once it has landed
  history.pushState({ pulse: 1 }, "");
  armed = true;
}
addEventListener("popstate", (e) => {
  if (pending) { pending--; arm(); return; } // our own back, consuming the guard
  if (e.state?.pulse) { armed = true; return; } // forward onto a guard entry
  armed = false;
  layers.pop()?.close({ nav: true });
  arm(); // more open underneath: guard again
});
// A reload while a guard entry was current leaves it behind: step off it so the next back isn't swallowed.
if (history.state?.pulse) { pending++; history.back(); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && layers.length) back(); });

// ---------- pages: full screens that slide in from the right over the screen they were opened from. The tab bar stays
// and keeps the tab they belong to lit. id: a <section class="screen"> in index.html.
const pages = [];
export function openPage(id, { onClose } = {}) {
  const el = document.getElementById(id);
  const cur = pages.find((p) => p.id === id);
  if (cur) { cur.onClose = onClose; return el; } // already open: the caller redraws it in place
  const p = { id, el, onClose, gen: (el._gen = (el._gen || 0) + 1) };
  p.layer = addLayer(() => closePage(id));
  pages.push(p);
  el.style.zIndex = 34 + pages.length;
  el.hidden = false; el.classList.add("pushed");
  el.querySelector(".page")?.scrollTo(0, 0);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("on")));
  return el;
}
export function closePage(id, { silent = false } = {}) {
  const i = pages.findIndex((p) => p.id === id); if (i < 0) return;
  const [p] = pages.splice(i, 1);
  dropLayer(p.layer);
  p.el.classList.remove("on");
  setTimeout(() => { if (p.el._gen === p.gen) { p.el.hidden = true; p.el.classList.remove("pushed"); } }, 280);
  if (!silent) p.onClose?.();
}
export function closeAllPages() { for (const p of [...pages].reverse()) closePage(p.id, { silent: true }); }
export const topPage = () => pages.at(-1)?.id || null;
export const pageOpen = (id) => pages.some((p) => p.id === id);
// The back button at the top of a page, naming where it goes ("‹ Calls").
export const backBtn = (label, id = "pBack") => `<button class="pgback" id="${id}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>${label}</button>`;
