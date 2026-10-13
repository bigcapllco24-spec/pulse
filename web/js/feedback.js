// Feedback on any part of the app. Press and hold anything (text, a chart, a panel, a button) for 3 seconds to leave
// a note about that exact part, on any screen or sheet; or switch on Feedback mode in the Account sheet, where every tap on a page
// (buttons too) opens the note instead of acting.
// Notes go to Firestore "feedback" with where they were left, so whoever builds from them knows exactly what's meant.
import { esc, openSheet, closeSheet, toast, haptic } from "./ui.js";
import { sendFeedback, ls } from "./store.js";
import { APP } from "./app.js";

const VERSION = "pulse-web";
const DAILY = 20; // notes per phone per day, so one person can't flood the list
let mode = false, held = false, quietUntil = 0;
const HOLD_MS = 3000;

// A readable name for what was tapped: the nearest labelled part, from the most specific to the screen.
function describeTarget(el) {
  const t = (sel) => el.closest(sel);
  const txt = (n) => (n?.getAttribute?.("aria-label") || n?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  const card = t(".card"), it = card ? APP.seq[+card.dataset.i] : null, coin = it?.sym?.t || null;
  const view = card?.dataset.view || "main";
  const screen = t("#gate") ? "Username step" : t("#grp") ? `Group page · ${t("#grp").querySelector(".grp-t b")?.textContent || ""}` : t("#full") ? "Full-screen chart" : t(".sheet") ? "Sheet" : t("#sDash") ? "Coins" : t("#sPlay") ? "Predict" : t("#sProfile") ? "Settings" : t(".tabbar") ? "Tab bar" : t(".topbar") ? "Top bar" : "Feed";
  const parts = [
    [".lower[data-learn]", (n) => `${n.dataset.learn} panel`], [".oli", (n) => `${txt(n).split(" ")[0]} line`], [".lvtag", () => "Support/resistance label"],
    [".scrubcard", () => "Hold-to-read card"], ["[data-fx]", () => "ƒx (indicators) button"], ["[data-lv]", () => "S/R button"], ["[data-tf]", () => "Time range chip"], [".head .chg", () => "Change % next to the coin name"],
    ["[data-pred]", () => "Predict button"], ["[data-full]", () => "Full-screen button"], [".chartbox", () => "Price chart"], [".story", (n) => `News story: ${txt(n.querySelector(".h"))}`],
    [".nsec", (n) => `News section: ${txt(n)}`], [".pev", () => "Price event"], [".dsec", (n) => `Details · ${txt(n.querySelector("h3"))}`], [".reading", (n) => `Reading: ${txt(n.querySelector(".k"))}`],
    [".srow", (n) => `Indicator: ${txt(n.querySelector(".t"))}`], [".sset", (n) => `Quick set: ${txt(n.querySelector("b"))}`], [".choice", (n) => `Option: ${txt(n.querySelector("b"))}`],
    [".gsec", (n) => `Guide · ${txt(n.querySelector("h3"))}`], [".recap div", (n) => `Recap tile: ${txt(n.querySelector("span"))}`], [".special", () => "Recap card"], [".pl-head", () => "Prediction score"],
    [".row", (n) => `Row: ${txt(n.querySelector(".t") || n)}`], [".head", () => "Coin header"], [".tabbar button", (n) => `Tab: ${txt(n)}`], ["#switcher", () => "Watchlist switcher"], ["#status", () => "Updated / refresh"],
    ["h1, h2, h3", (n) => `Heading: ${txt(n)}`], ["button", (n) => `Button: ${txt(n)}`],
  ];
  let where = null;
  for (const [sel, name] of parts) { const n = t(sel); if (n) { where = name(n); break; } }
  const sheet = t(".sheet")?.querySelector("#shTitle")?.textContent;
  return {
    where: where || `${el.tagName.toLowerCase()}: ${txt(el) || "(no text)"}`,
    screen: sheet ? `Sheet · ${sheet}` : screen + (screen === "Feed" && view !== "main" ? ` · ${view}` : "") + (screen === "Profile" ? ` · ${document.querySelector("#profile h1")?.textContent || "home"}` : ""),
    coin, detail: txt(el),
  };
}

// The question after a 3-second hold: about this part, yes or not now.
function askFeedback(el) {
  const ctx = describeTarget(el);
  haptic();
  openSheet("Leave feedback?", `<p class="fbwhere"><span class="cap">About</span><b>${esc(ctx.where)}</b><span>${esc(ctx.screen)}${ctx.coin ? ` · ${esc(ctx.coin)}` : ""}</span></p>
    <div class="fbrow fbask" data-fbsheet><button class="btn ghost" data-fbno>Not now</button><button class="btn primary" data-fbyes>Add feedback</button></div>`, (body) => {
    body.querySelector("[data-fbno]").onclick = closeSheet;
    body.querySelector("[data-fbyes]").onclick = () => openFeedback(el, ctx); // where it was held, worked out before this sheet replaced it
  });
}
export function openFeedback(el, ctx = describeTarget(el)) {
  const day = new Date().toISOString().slice(0, 10), sent = ls.get("pl.fbDay", {});
  const count = sent.day === day ? sent.n : 0;
  haptic();
  openSheet("Feedback", `<p class="fbwhere"><span class="cap">About</span><b>${esc(ctx.where)}</b><span>${esc(ctx.screen)}${ctx.coin ? ` · ${esc(ctx.coin)}` : ""}</span></p>
    <textarea id="fbText" class="input fbtext" maxlength="1000" rows="5" placeholder="What would make this better? What's confusing or broken?"></textarea>
    <div class="fbrow"><span class="hint" id="fbCount">0 / 1000</span><button class="btn primary" id="fbSend" disabled>Send</button></div>
    <p class="hint" data-fbsheet>Your note is saved with the part of the app it's about. No name or contact details are attached.</p>`, (body) => {
    const ta = body.querySelector("#fbText"), btn = body.querySelector("#fbSend");
    setTimeout(() => ta.focus(), 250);
    ta.oninput = () => { body.querySelector("#fbCount").textContent = `${ta.value.length} / 1000`; btn.disabled = !ta.value.trim(); };
    btn.onclick = async () => {
      if (count >= DAILY) return toast(`That's ${DAILY} notes today, thank you! Try again tomorrow.`);
      btn.disabled = true; btn.textContent = "Sending…";
      try {
        await sendFeedback({ text: ta.value.trim(), where: ctx.where, screen: ctx.screen, coin: ctx.coin, detail: ctx.detail,
          ctx: { w: innerWidth, h: innerHeight, landscape: innerWidth > innerHeight, tab: APP.tab, v: VERSION } });
        ls.set("pl.fbDay", { day, n: count + 1 });
        closeSheet(); toast("Thanks, your feedback was sent.");
      } catch { btn.disabled = false; btn.textContent = "Send"; toast("Couldn't send just now. Check your connection and try again."); }
    };
  });
}

// Feedback mode: a banner at the top, and every tap outside the banner and the feedback sheet opens a note.
export function setFeedbackMode(on) {
  mode = on;
  document.body.classList.toggle("fbmode", on);
  let bar = document.getElementById("fbBar");
  if (on && !bar) {
    bar = document.createElement("div"); bar.id = "fbBar"; bar.className = "fbbar";
    bar.innerHTML = `<span>Feedback mode: tap anything to comment. Swipes and tabs still work.</span><button class="btn sm" data-fbdone>Done</button>`;
    document.body.appendChild(bar);
    bar.querySelector("[data-fbdone]").onclick = () => setFeedbackMode(false);
  }
  if (!on) bar?.remove();
}

export function initFeedback() {
  // capture phase, so in feedback mode a tap never reaches the button underneath
  addEventListener("click", (e) => {
    if (!mode || e.target.closest("#fbBar, .sheet, .backdrop, .toast, .tabbar")) return; // the tab bar still moves between screens
    e.preventDefault(); e.stopPropagation(); openFeedback(e.target);
  }, true);
  // Press and hold anything still for 3 seconds: a small popup asks whether to leave a note about that part.
  // (Triple-tapping clashed with buttons and with the phone's double-tap zoom.)
  let hold = null;
  const stop = () => { if (hold) { clearTimeout(hold.t); hold = null; } };
  addEventListener("pointerdown", (e) => {
    stop();
    // anywhere, sheets included, except text boxes and the feedback sheets themselves
    if (mode || e.button > 0 || e.target.closest("input, textarea, select, #fbBar, .backdrop") || (e.target.closest(".sheet") && document.querySelector(".sheet [data-fbsheet]"))) return;
    const el = e.target, x = e.clientX, y = e.clientY;
    hold = { x, y, t: setTimeout(() => { hold = null; held = true; askFeedback(el); }, HOLD_MS) };
  }, true);
  addEventListener("pointermove", (e) => { if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 12) stop(); }, true);
  // letting go after the popup appeared must not also press the button underneath
  addEventListener("pointerup", (e) => { stop(); if (held) { held = false; quietUntil = e.timeStamp + 500; } }, true);
  addEventListener("pointercancel", stop, true);
  addEventListener("click", (e) => { if (e.timeStamp < quietUntil) { e.preventDefault(); e.stopPropagation(); } }, true);
}
