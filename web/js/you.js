// The You tab: a plain-language read on how well you read the market, your score (worked out by the data job), the
// breakdowns that open at level 3, where you rank, and the way to settings. Levels show effort (progress.js); the
// score shows skill (score.js). Everything here describes your own past calls only.
import { store, ls, myScore, pendingHere } from "./store.js";
import { CHANCE, SCORE_MIN, SCORE_MAX, PROVISIONAL_UNDER, HORIZONS, BANDS, isRight } from "./score.js";
import { $, esc, openSheet, closeSheet } from "./ui.js";
import { myName, myCard } from "./social.js";
import { verdictOf, VERDICT_AT, myLevel, levelAvatar, resultRow, openResult, openAboutScore, openCoinPicker, wrongWay, shownLabel } from "./calls.js";
import { ranksView, myFullCard, myStreak } from "./people.js";
import { openAvatarSheet } from "./account.js";
import { SURE, BASIS } from "./callit.js";
import { backLabel } from "./app.js";
import { openPage, closePage, backBtn } from "./nav.js";
import { openProfile } from "./pages.js";
import { openShareSheet } from "./share.js";
import { svgIcon, cardHtml, bandBar, bandTag } from "./card.js";
import { UNLOCKS, callsFor } from "./progress.js";

export function initYou() {}
const pc = (a, b) => (b ? Math.round((a / b) * 100) : null);

export function renderYou() {
  const el = $("you"), u = myName(), card = myCard(), lv = myLevel(), followers = card?.followers || 0;
  const sub = [`Level ${lv.level}`, followers ? `${followers} follower${followers === 1 ? "" : "s"}` : "", `${lv.toNext} call${lv.toNext === 1 ? "" : "s"} to level ${lv.level + 1}`].filter(Boolean).join(" · ");
  el.innerHTML = `<div class="you-top">
      <button class="you-me" id="youCard" aria-label="Your player card">${levelAvatar(u, lv.level)}<span class="main"><span class="t">@${esc(u || "you")}</span><span class="s">${esc(sub)}</span></span></button>
      <span class="you-acts"><button class="you-ib" id="youShare" aria-label="Share your card">${svgIcon("share")}</button><button class="you-ib" id="youSet" aria-label="Settings">${GEAR}</button></span>
    </div>
    ${recordHtml()}
    <h2 class="you-h2">Where you rank</h2>
    <div class="you-card you-rank" style="margin-top:0"><div class="pl-view" data-view="ranks"></div></div>
    <button class="you-row" id="youDoesnt"><span class="main"><span class="t">What your score doesn't show</span><span class="s">Money also depends on size, leverage, losses, fees and tax</span></span><span class="chev">›</span></button>
    <p class="you-foot">Levels show how much you've played, not how good you are. Scores describe your own past calls in a learning game. Not advice.</p>`;
  ranksView(el.querySelector(".pl-view"));
  el.querySelector("#youCard").onclick = openMyCard;
  wireRecord(el);
  el.querySelector("#youShare").onclick = () => openShareSheet(myFullCard());
  el.querySelector("#youSet").onclick = () => openAvatarSheet();
  el.querySelector("#youDoesnt").onclick = openDoesnt;
}
const GEAR = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
// What the score leaves out (1.5.0: one line on You, the list in a sheet).
function openDoesnt() {
  openSheet("What your score doesn't show", `<p class="hint">It shows how well you read moves. Making money also depends on:</p>
    <ul class="you-list"><li>How much you put in</li><li>Borrowing to trade (leverage)</li><li>When you cut a loss</li><li>How you act with real money on the line</li><li>Fees and tax</li></ul>
    <button class="btn block" id="youLearn" style="margin-top:16px">Read the basics, 6 short reads</button>`, (body) => {
    body.querySelector("#youLearn").onclick = () => { closeSheet(); openProfile("learn"); };
  });
}
const wireNote = (el) => el.querySelector("[data-v2ok]")?.addEventListener("click", () => { ls.set(V2_NOTE, 1); el.querySelector("#youNote")?.remove(); });
// The note, and the last-10 squares (each opens its replay).
function wireRecord(el) {
  wireNote(el);
  const last = lastScored();
  el.querySelectorAll("[data-last]").forEach((b) => (b.onclick = () => openResult(last[+b.dataset.last])));
  el.querySelector("[data-record]")?.addEventListener("click", openRecord);
}
const lastScored = () => [...pendingHere(), ...store.results].filter((r) => r.status === "scored").sort((a, b) => Date.parse(b.resolvedAt || 0) - Date.parse(a.resolvedAt || 0)).slice(0, 10);
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
  el.innerHTML = `${backBtn(esc(back))}<h1 style="margin:6px 0 0">Your record</h1>${recordHtml({ page: true })}
    ${done.length ? `<h2 class="you-h2">Scored calls</h2><div class="hl">${done.slice(0, 8).map(resultRow).join("")}</div>${done.length > 8 ? `<button class="linkbtn more" id="rcAll">See all ${done.length}<span aria-hidden="true"> ›</span></button>` : ""}` : ""}
    <p class="hint" style="margin-top:18px">The same record lives in the You tab.</p>`;
  el.querySelector("#pBack").onclick = () => closePage("sRecord");
  wireRecord(el);
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
function recordHtml({ page = false } = {}) {
  const sc = myScore(), lv = myLevel();
  const scored = [...pendingHere(), ...store.results].filter((r) => r.status === "scored"), n = scored.length, v = verdictOf(sc, n);
  const right = scored.filter(isRight).length;
  const closePlus = scored.filter((r) => ["Spot on", "Very close", "Close"].includes(r.label)).length;
  const intro = v.key === "none" ? "Your first scored call starts your score. Tap Call it on any chart."
    : v.key === "early" ? `${n} call${n === 1 ? "" : "s"} so far. After ${VERDICT_AT}, your record starts to show how well you read the market.`
    : `Based on ${n} calls. Each call makes this surer.`;
  const byH = Object.keys(HORIZONS).map((h) => { const rs = scored.filter((r) => r.horizon === h); const ok = rs.filter(isRight).length; return { h, n: rs.length, p: pc(ok, rs.length) }; });
  const bars = (rows) => `<div class="ybars">${rows.map((r) => `<div class="ybar"><span>${esc(r.label)}</span>${r.p == null ? `<em class="hint">${esc(r.note || "No calls yet")}</em>` : `<i aria-hidden="true"><b style="width:${r.p}%"></b></i><strong class="num">${r.p}%</strong>`}</div>`).join("")}</div>`;
  const full = lv.level >= 3;
  const okOf = (rs) => rs.filter(isRight).length;
  const bySure = SURE.map(([k, l]) => { const rs = scored.filter((r) => r.sure === k); return { label: l, p: pc(okOf(rs), rs.length), note: rs.length ? "" : "No calls yet" }; });
  const byBasis = BASIS.map(([k, l]) => { const rs = scored.filter((r) => r.basis === k); return { label: l === "Gut" ? "Gut feeling" : l, p: pc(okOf(rs), rs.length), note: rs.length ? "" : "No calls yet" }; });
  const sureP = bySure.map((x) => x.p), sureLine = sureP[2] != null && sureP[1] != null ? (sureP[2] > sureP[1] + 5 ? "Your very sure calls do better than your fairly sure ones." : sureP[2] < sureP[1] - 5 ? "Your very sure calls do no better than your fairly sure ones." : "Being surer hasn't made much difference yet.") : "Needs a few calls of each kind.";
  const bestBasis = byBasis.filter((x) => x.p != null).sort((a, b) => b.p - a.p)[0];
  // 1.5.0 (feedback 16, 19 and 23 Oct): one score block with the verdict beside the number, the bands as a quiet bar
  // in their own colours, then a row of three numbers and your last ten calls; smaller type throughout
  const up = sc?.score != null ? [...BANDS].reverse().find(([min]) => min > sc.score) : null; // the next band up
  const verdict = v.key === "none" ? v.text : `${v.key === "well" ? "Reading it well" : v.text} · ${n} call${n === 1 ? "" : "s"}`;
  const st = myStreak(), last = lastScored(), kind = (r) => (wrongWay(r) ? "bad" : ["Spot on", "Very close"].includes(r.label) ? "good" : r.label === "Close" ? "close" : "off");
  const toL3 = Math.max(0, Math.ceil(callsFor(3) - lv.n));
  return `<section class="you-card ys">
      <div class="ys-top"><span class="ys-lab">${sc?.provisional || !sc ? "Your score so far" : "Your score"}</span>${bandTag(sc)}</div>
      <div class="ys-main"><b class="num ys-big">${sc?.score ?? "–"}</b><span class="ys-verdict">${esc(verdict)}</span></div>
      ${bandBar(sc?.score)}
      <div class="ys-ends"><span>${SCORE_MIN}</span><span>${CHANCE} start</span><span>${BANDS[0][0]} ${esc(BANDS[0][1])}</span><span>${SCORE_MAX}</span></div>
      <div class="ys-notes">${[sc?.score != null ? (up ? `${up[0] - sc.score} points to ${esc(up[1])}` : `In the top band`) : `Everyone starts at ${CHANCE}. Your first scored call moves it.`, v.key !== "well" && v.key !== "learning" ? esc(intro) : "", ...(sc ? scoreNotes(sc) : [])].filter(Boolean).map((t, i) => `<p class="${i ? "" : "lead"}">${t}</p>`).join("")}</div>
    </section>
    ${sc?.was && !ls.get(V2_NOTE) ? `<div class="notice you-note" id="youNote"><b>Your score was worked out again from all your scored calls.</b> Your calls haven't changed${sc.was.score != null ? `; your score was ${sc.was.score} before` : ""}. <button class="linkbtn" data-v2ok>Got it</button></div>` : ""}
    <div class="you-card ystats">
      <div><b class="num">${n ? `${pc(right, n)}%` : "–"}</b><span>Right direction</span><em>${n ? `${right} of ${n} calls` : "No calls yet"}</em></div>
      <div><b class="num">${n ? `${pc(closePlus, n)}%` : "–"}</b><span>Close or better</span><em>${n ? `${closePlus} of ${n} calls` : "Spot on, Very close or Close"}</em></div>
      <div><b>${st.n} day${st.n === 1 ? "" : "s"}</b><span>Streak</span><em>${st.best ? `Best ${st.best}` : "Call a coin for 1 day"}</em></div>
    </div>
    ${last.length ? `<div class="you-card ylast">
      <div class="ylast-h"><span class="t">Last ${last.length === 1 ? "call" : `${last.length} calls`}</span>${page ? "" : `<button class="linkbtn" data-record>Your record<span aria-hidden="true"> ›</span></button>`}</div>
      <div class="ylast-sq">${last.map((r, i) => `<button class="${kind(r)}" data-last="${i}" aria-label="${esc(r.t || "")} ${esc(HORIZONS[r.horizon]?.label || "")}: ${esc(shownLabel(r))}"></button>`).join("")}</div>
      <div class="ylast-key"><span><i class="good"></i>Spot on, very close</span><span><i class="close"></i>Close</span><span><i class="off"></i>Off</span><span><i class="bad"></i>Wrong way</span></div>
    </div>` : ""}
    ${n && n < VERDICT_AT ? `<p class="hint you-few">Too few calls to read much into these yet.</p>` : ""}
    ${full ? `<h2 class="you-h2">Does being sure help?</h2><p class="hint" style="margin:0 0 10px">Right direction, by how sure you said you were. ${esc(sureLine)}</p>${bars(bySure)}
      <h2 class="you-h2">What works for you</h2><p class="hint" style="margin:0 0 10px">Right direction, by what your call was based on.${bestBasis ? ` ${esc(bestBasis.label)} calls are your strongest.` : ""}</p>${bars(byBasis)}
      <h2 class="you-h2">By time period</h2><p class="hint" style="margin:0 0 10px">Right direction, by how long the call was.</p>${bars(byH.map((x) => ({ label: HORIZONS[x.h].label, p: x.p, note: x.n ? "" : "No calls yet" })))}`
      : `<div class="you-card ylock"><div class="ylock-h">${LOCK}<span class="t">What works for you</span><span class="s">${toL3} call${toL3 === 1 ? "" : "s"} to go</span></div>
        <span class="ylock-bar" aria-hidden="true"><i style="width:${Math.min(100, (lv.n / callsFor(3)) * 100).toFixed(0)}%"></i></span>
        <span class="hint">Opens at level 3 (${callsFor(3)} calls): ${esc(UNLOCKS[3])}</span></div>`}`;
}
const LOCK = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
