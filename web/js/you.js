// The You tab: a plain-language read on how well you read the market, your score (worked out by the data job), the
// breakdowns that open at level 3, where you rank, and the way to settings. Levels show effort (progress.js); the
// score shows skill (score.js). Everything here describes your own past calls only.
import { store, ls, myScore, pendingHere } from "./store.js";
import { CHANCE, SCORE_MIN, SCORE_MAX, PROVISIONAL_UNDER, HORIZONS, isRight, bandOf } from "./score.js";
import { $, esc, openSheet } from "./ui.js";
import { myName, myCard } from "./social.js";
import { verdictOf, VERDICT_AT, myLevel, levelAvatar, resultRow, openResult, openAboutScore, openCoinPicker } from "./calls.js";
import { ranksView, myFullCard } from "./people.js";
import { openAvatarSheet } from "./account.js";
import { SURE, BASIS } from "./callit.js";
import { backLabel } from "./app.js";
import { openPage, closePage, backBtn } from "./nav.js";
import { openProfile } from "./pages.js";
import { openShareSheet } from "./share.js";
import { svgIcon, cardHtml } from "./card.js";
import { UNLOCKS, callsFor } from "./progress.js";

export function initYou() {}
const pc = (a, b) => (b ? Math.round((a / b) * 100) : null);

export function renderYou() {
  const el = $("you"), u = myName(), card = myCard(), lv = myLevel(), followers = card?.followers || 0;
  const sub = [`Level ${lv.level}`, followers ? `${followers} follower${followers === 1 ? "" : "s"}` : "", `${lv.toNext} call${lv.toNext === 1 ? "" : "s"} to level ${lv.level + 1}`].filter(Boolean).join(" · ");
  el.innerHTML = `<div class="you-top">
      <button class="you-me" id="youCard" aria-label="Your player card">${levelAvatar(u, lv.level, "lg")}<span class="main"><span class="t">@${esc(u || "you")}</span><span class="s">${esc(sub)}</span></span></button>
      <span class="pl-topb"><button class="iconbtn ghost" id="youShare" aria-label="Share your card">${svgIcon("share")}</button><button class="iconbtn ghost" id="youSet" aria-label="Settings"><svg viewBox="0 0 24 24" style="stroke-width:2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button></span>
    </div>
    ${recordHtml()}
    <div class="you-box">
      <h2 class="you-h2" style="margin-top:0">What your score doesn't show</h2>
      <p class="hint">It shows how well you read moves. Making money also depends on:</p>
      <ul class="you-list"><li>How much you put in</li><li>Borrowing to trade (leverage)</li><li>When you cut a loss</li><li>How you act with real money on the line</li><li>Fees and tax</li></ul>
      <button class="btn block" id="youLearn" style="margin-top:14px">Read the basics, 6 short reads</button>
    </div>
    <h2 class="you-h2">Where you rank</h2>
    <div class="pl-view" data-view="ranks"></div>
    <p class="hint" style="margin-top:14px">Levels show how much you've played, not how good you are. Scores describe your own past calls in a learning game. Not advice.</p>`;
  ranksView(el.querySelector(".pl-view"));
  el.querySelector("#youCard").onclick = openMyCard;
  wireNote(el);
  el.querySelector("#youShare").onclick = () => openShareSheet(myFullCard());
  el.querySelector("#youSet").onclick = () => openAvatarSheet();
  el.querySelector("#youLearn").onclick = () => openProfile("learn");
}
const wireNote = (el) => el.querySelector("[data-v2ok]")?.addEventListener("click", () => { ls.set(V2_NOTE, 1); el.querySelector("#youNote")?.remove(); });
export const openMyCard = () => openSheet("How others see you", cardHtml(myFullCard(), { mine: true }) + `<p class="hint">Other players see your username, level, score, followers and record. Your price calls are never shown unless you make them public once scored.</p>`, (body) => {
  body.querySelector("[data-how]")?.addEventListener("click", openAboutScore);
  body.querySelector("[data-first]")?.addEventListener("click", openCoinPicker);
});
// Your record (1.3.0): the same as the score part of You, as a page over Calls from its progress card.
export function openRecord() {
  const back = backLabel();
  openPage("sRecord");
  renderRecord(back);
}
export function renderRecord(back = $("record").dataset.back) {
  const el = $("record"); el.dataset.back = back;
  const done = [...pendingHere(), ...store.results].sort((a, b) => Date.parse(b.resolvedAt || 0) - Date.parse(a.resolvedAt || 0));
  el.innerHTML = `${backBtn(esc(back))}<h1 style="margin:6px 0 0">Your record</h1>${recordHtml()}
    ${done.length ? `<h2 class="you-h2">Scored calls</h2><div class="hl">${done.slice(0, 8).map(resultRow).join("")}</div>${done.length > 8 ? `<button class="linkbtn more" id="rcAll">See all ${done.length}<span aria-hidden="true"> ›</span></button>` : ""}` : ""}
    <p class="hint" style="margin-top:18px">The same record lives in the You tab.</p>`;
  el.querySelector("#pBack").onclick = () => closePage("sRecord");
  wireNote(el);
  const wire = (root) => root.querySelectorAll("[data-res]").forEach((b) => (b.onclick = () => openResult(done[+b.dataset.res])));
  wire(el);
  el.querySelector("#rcAll")?.addEventListener("click", () => openSheet("Scored calls", `<div class="hl">${done.map(resultRow).join("")}</div>`, wire));
}
// The quiet lines under the score: what changed with your last call, and anything holding it back. In plain words;
// never how the score is worked out.
const V2_NOTE = "pl.v2note", LAST = "pl.scoreLast";
const FLAG = { "always up": "Most of your calls are up.", "always down": "Most of your calls are down.", "always no change": "Most of your calls are No change.",
  "follows yesterday": "Most of your calls follow the day before's move.", "fades yesterday": "Most of your calls go against the day before's move.",
  "follows 90-day trend": "Most of your calls follow the last 90 days' trend.", "fades 90-day trend": "Most of your calls go against the last 90 days' trend." };
function scoreNotes(sc) {
  const out = [], last = ls.get(LAST);
  if (!last || last.n !== sc.n || last.score !== sc.score) ls.set(LAST, { n: sc.n, score: sc.score, delta: last && sc.n > last.n ? sc.score - last.score : last?.n === sc.n ? last.delta ?? null : null });
  const d = ls.get(LAST)?.delta;
  if (sc.updating) out.push("Your score is being updated from all your calls. It's back within a couple of hours.");
  else if (sc.confirming) out.push("Your newest call is confirming. The score updates within 15 minutes.");
  else if (d != null) out.push(d ? `Score ${d > 0 ? "+" : "−"}${Math.abs(d)} after your last call.` : "Your last call didn't move the score.");
  if (sc.provisional) out.push(`Provisional until ${PROVISIONAL_UNDER} calls are scored.`);
  if (sc.held) out.push("Some of your progress is held until your record is longer.");
  if (sc.flag && FLAG[sc.flag]) out.push(FLAG[sc.flag]);
  return out.map(esc);
}
// The record: where you stand, your score, your tiles and (from level 3) the breakdowns.
function recordHtml() {
  const sc = myScore(), lv = myLevel();
  const scored = [...pendingHere(), ...store.results].filter((r) => r.status === "scored"), n = scored.length, v = verdictOf(sc, n);
  const right = scored.filter(isRight).length;
  const closePlus = scored.filter((r) => ["Spot on", "Very close", "Close"].includes(r.label)).length;
  const intro = v.key === "none" ? "Your first scored call starts your score. Tap Call it on any chart."
    : v.key === "early" ? `${n} call${n === 1 ? "" : "s"} so far. After ${VERDICT_AT}, your record starts to show how well you read the market.`
    : `Based on ${n} calls. Each call makes this surer.`;
  const pos = (x) => `${(((x - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * 100).toFixed(1)}%`;
  const byH = Object.keys(HORIZONS).map((h) => { const rs = scored.filter((r) => r.horizon === h); const ok = rs.filter(isRight).length; return { h, n: rs.length, p: pc(ok, rs.length) }; });
  const bars = (rows) => `<div class="ybars">${rows.map((r) => `<div class="ybar"><span>${esc(r.label)}</span>${r.p == null ? `<em class="hint">${esc(r.note || "No calls yet")}</em>` : `<i aria-hidden="true"><b style="width:${r.p}%"></b></i><strong class="num">${r.p}%</strong>`}</div>`).join("")}</div>`;
  const full = lv.level >= 3;
  const okOf = (rs) => rs.filter(isRight).length;
  const bySure = SURE.map(([k, l]) => { const rs = scored.filter((r) => r.sure === k); return { label: l, p: pc(okOf(rs), rs.length), note: rs.length ? "" : "No calls yet" }; });
  const byBasis = BASIS.map(([k, l]) => { const rs = scored.filter((r) => r.basis === k); return { label: l === "Gut" ? "Gut feeling" : l, p: pc(okOf(rs), rs.length), note: rs.length ? "" : "No calls yet" }; });
  const sureP = bySure.map((x) => x.p), sureLine = sureP[2] != null && sureP[1] != null ? (sureP[2] > sureP[1] + 5 ? "Your very sure calls do better than your fairly sure ones." : sureP[2] < sureP[1] - 5 ? "Your very sure calls do no better than your fairly sure ones." : "Being surer hasn't made much difference yet.") : "Needs a few calls of each kind.";
  const bestBasis = byBasis.filter((x) => x.p != null).sort((a, b) => b.p - a.p)[0];
  return `<p class="label" style="margin:22px 0 0">Where you stand</p>
    <h1 class="you-h1">${v.key === "well" ? "You’re reading it well" : esc(v.text)}</h1>
    <p class="hint" style="margin:6px 0 0">${esc(intro)}</p>
    ${v.key === "early" || v.key === "none" ? `<span class="pl-prog you-prog" aria-hidden="true"><i style="width:${Math.min(100, (n / VERDICT_AT) * 100)}%"></i></span>`
      : `<div class="you-seg" aria-hidden="true"><span class="${v.key === "learning" ? "on" : ""}" data-l="Still learning"></span><span class="${v.key === "well" ? "on good" : ""}" data-l="Reading it well"></span></div>`}
    <div class="pc2-box you-score">
      <div class="pc2-row"><span class="hint">${sc?.provisional || !sc ? "Your score so far" : "Your score"}</span><span class="hint">${!sc ? "" : sc.provisional ? "Provisional" : esc(sc.band || bandOf(sc.score))}</span></div>
      <b class="num you-big ${v.key === "well" ? "good" : ""}">${sc?.score != null ? sc.score : "–"}</b>
      ${sc?.score != null ? `<div class="you-scale" aria-hidden="true"><i class="mid" style="left:${pos(CHANCE)}"></i><i class="dot" style="left:${pos(sc.score)}"></i></div>
        <div class="pc2-row hint"><span>${SCORE_MIN}</span><span>${CHANCE} is where everyone starts</span><span>${SCORE_MAX}</span></div>
        ${scoreNotes(sc).map((t) => `<p class="hint" style="margin:8px 0 0">${t}</p>`).join("")}`
        : `<p class="hint" style="margin:8px 0 0">Everyone starts at ${CHANCE}. Your first scored call moves it.</p>`}
    </div>
    ${sc?.was && !ls.get(V2_NOTE) ? `<div class="notice you-note" id="youNote"><b>Your score was worked out again from all your scored calls.</b> Your calls haven't changed${sc.was.score != null ? `; your score was ${sc.was.score} before` : ""}. <button class="linkbtn" data-v2ok>Got it</button></div>` : ""}
    <div class="you-tiles">
      <div class="pc2-box"><b class="num">${n ? `${pc(right, n)}%` : `–`}</b><span>Right direction</span><em class="hint">${n ? `${right} of ${n} calls` : "No calls scored yet"}</em></div>
      <div class="pc2-box"><b class="num">${n ? `${pc(closePlus, n)}%` : `–`}</b><span>Close or better</span><em class="hint">${n ? `${closePlus} of ${n} calls` : "Spot on, Very close or Close"}</em></div>
    </div>
    ${n && n < VERDICT_AT ? `<p class="hint" style="margin:10px 0 0">Too few calls to read much into these yet.</p>` : ""}
    ${full ? `<h2 class="you-h2">Does being sure help?</h2><p class="hint" style="margin:0 0 10px">Right direction, by how sure you said you were. ${esc(sureLine)}</p>${bars(bySure)}
      <h2 class="you-h2">What works for you</h2><p class="hint" style="margin:0 0 10px">Right direction, by what your call was based on.${bestBasis ? ` ${esc(bestBasis.label)} calls are your strongest.` : ""}</p>${bars(byBasis)}
      <h2 class="you-h2">By time period</h2><p class="hint" style="margin:0 0 10px">Right direction, by how long the call was.</p>${bars(byH.map((x) => ({ label: HORIZONS[x.h].label, p: x.p, note: x.n ? "" : "No calls yet" })))}`
      : `<div class="you-lock"><b>Opens at level 3 (${callsFor(3)} calls)</b><span class="hint">${esc(UNLOCKS[3])}</span></div>`}`;
}
