// The You tab (1.2.0): a plain-language read on how well you read the market, your score and its likely range, the
// breakdowns that open at level 3, where you rank, and the way to settings. Levels show effort (progress.js); the
// score shows skill (score.js). Everything here describes your own past calls only.
import { store, myScore, pendingHere } from "./store.js";
import { CHANCE, SCORE_MIN, SCORE_MAX, PROVISIONAL_UNDER, HORIZONS } from "./score.js";
import { $, esc, openSheet } from "./ui.js";
import { myName, myCard } from "./social.js";
import { verdictOf, VERDICT_AT, myLevel, ranksView, openAvatarSheet, myFullCard, levelAvatar, SURE, BASIS } from "./play.js";
import { APP, showTab } from "./app.js";
import { openShareSheet } from "./share.js";
import { svgIcon, cardHtml } from "./card.js";
import { UNLOCKS, callsFor } from "./progress.js";

export function initYou() {}
const num = (s) => `<span class="num">${s}</span>`;
const pc = (a, b) => (b ? Math.round((a / b) * 100) : null);
// the likely range of the score: narrows as calls are scored (±190/√n, never past the scale)
const rangeOf = (score, n) => { const w = Math.round(190 / Math.sqrt(Math.max(1, n))); return [Math.max(SCORE_MIN, score - w), Math.min(SCORE_MAX, score + w)]; };

export function renderYou() {
  const el = $("you"), u = myName(), sc = myScore(), card = myCard(), v = verdictOf(sc), lv = myLevel();
  const scored = [...pendingHere(), ...store.results].filter((r) => r.status === "scored"), n = scored.length;
  const right = scored.filter((r) => r.direction === "right" || (r.direction == null && (r.target > r.p0) === (r.actual > r.p0))).length;
  const closePlus = scored.filter((r) => ["Spot on", "Very close", "Close"].includes(r.label)).length;
  const followers = card?.followers || 0;
  const sub = [`Level ${lv.level}`, followers ? `${followers} follower${followers === 1 ? "" : "s"}` : "", `${lv.toNext} call${lv.toNext === 1 ? "" : "s"} to level ${lv.level + 1}`].filter(Boolean).join(" · ");
  const intro = v.key === "none" ? "Your first scored call starts your score. Tap Call it on any chart."
    : v.key === "early" ? `${n} call${n === 1 ? "" : "s"} so far. Around ${VERDICT_AT} shows how well you really read the market.`
    : `Based on ${n} calls. Each call makes this surer.`;
  const [lo, hi] = sc?.score != null ? rangeOf(sc.score, n) : [null, null];
  const pos = (x) => `${(((x - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * 100).toFixed(1)}%`;
  const byH = Object.keys(HORIZONS).map((h) => { const rs = scored.filter((r) => r.horizon === h); const ok = rs.filter((r) => (r.target > r.p0) === (r.actual > r.p0)).length; return { h, n: rs.length, p: pc(ok, rs.length) }; });
  const bars = (rows) => `<div class="ybars">${rows.map((r) => `<div class="ybar"><span>${esc(r.label)}</span>${r.p == null ? `<em class="hint">${esc(r.note || "No calls yet")}</em>` : `<i aria-hidden="true"><b style="width:${r.p}%"></b></i><strong class="num">${r.p}%</strong>`}</div>`).join("")}</div>`;
  const full = lv.level >= 3;
  const okOf = (rs) => rs.filter((r) => (r.target > r.p0) === (r.actual > r.p0)).length;
  const bySure = SURE.map(([k, l]) => { const rs = scored.filter((r) => r.sure === k); return { label: l, p: pc(okOf(rs), rs.length), note: rs.length ? "" : "No calls yet" }; });
  const byBasis = BASIS.map(([k, l]) => { const rs = scored.filter((r) => r.basis === k); return { label: l === "Gut" ? "Gut feeling" : l, p: pc(okOf(rs), rs.length), note: rs.length ? "" : "No calls yet" }; });
  const sureP = bySure.map((x) => x.p), sureLine = sureP[2] != null && sureP[1] != null ? (sureP[2] > sureP[1] + 5 ? "Your very sure calls do better than your fairly sure ones." : sureP[2] < sureP[1] - 5 ? "Your very sure calls do no better than your fairly sure ones." : "Being surer hasn't made much difference yet.") : "Needs a few calls of each kind.";
  const bestBasis = byBasis.filter((x) => x.p != null).sort((a, b) => b.p - a.p)[0];
  el.innerHTML = `<div class="you-top">
      <button class="you-me" id="youCard" aria-label="Your player card">${levelAvatar(u, lv.level, "lg")}<span class="main"><span class="t">@${esc(u || "you")}</span><span class="s">${esc(sub)}</span></span></button>
      <span class="pl-topb"><button class="iconbtn ghost" id="youShare" aria-label="Share your card">${svgIcon("share")}</button><button class="iconbtn ghost" id="youSet" aria-label="Settings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg></button></span>
    </div>
    <p class="label" style="margin:22px 0 0">Where you stand</p>
    <h1 class="you-h1">${v.key === "well" ? "You’re reading it well" : esc(v.text)}</h1>
    <p class="hint" style="margin:6px 0 0">${esc(intro)}</p>
    ${v.key === "early" || v.key === "none" ? `<span class="pl-prog you-prog" aria-hidden="true"><i style="width:${Math.min(100, (n / VERDICT_AT) * 100)}%"></i></span>`
      : `<div class="you-seg" aria-hidden="true"><span class="${v.key === "learning" ? "on" : ""}" data-l="Still learning"></span><span class="${v.key === "well" ? "on good" : ""}" data-l="Reading it well"></span></div>`}
    <div class="pc2-box you-score">
      <div class="pc2-row"><span class="hint">${sc?.provisional || !sc ? "Your score so far" : "Your score"}</span><span class="hint">${!sc ? "" : sc.provisional ? "Provisional" : esc(sc.band)}</span></div>
      <b class="num you-big ${v.key === "well" ? "good" : ""}">${sc?.score != null ? sc.score : "–"}</b>
      ${sc?.score != null ? `<div class="you-scale" aria-hidden="true"><i class="range" style="left:${pos(lo)};width:calc(${pos(hi)} - ${pos(lo)})"></i><i class="mid" style="left:${pos(CHANCE)}"></i><i class="dot" style="left:${pos(sc.score)}"></i></div>
        <div class="pc2-row hint"><span>${SCORE_MIN}</span><span>${CHANCE} is where everyone starts</span><span>${SCORE_MAX}</span></div>
        <p class="hint" style="margin:8px 0 0">${sc.provisional ? `Near ${CHANCE}, where everyone starts. It settles at your ${PROVISIONAL_UNDER}th call.` : `Your likely range is ${lo} to ${hi}, ${sc.score >= CHANCE + 25 ? "clearly above" : sc.score <= CHANCE - 25 ? "below" : "around"} where everyone starts. It narrows as you call more.`}</p>`
        : `<p class="hint" style="margin:8px 0 0">Everyone starts at ${CHANCE}. Your first scored call moves it.</p>`}
    </div>
    <div class="you-tiles">
      <div class="pc2-box"><b class="num">${n ? `${pc(right, n)}%` : `–`}</b><span>Right direction</span><em class="hint">${n ? `${right} of ${n} calls` : "No calls scored yet"}</em></div>
      <div class="pc2-box"><b class="num">${n ? `${pc(closePlus, n)}%` : `–`}</b><span>Close or better</span><em class="hint">${n ? `${closePlus} of ${n} calls` : "Spot on, Very close or Close"}</em></div>
    </div>
    ${n && n < VERDICT_AT ? `<p class="hint" style="margin:10px 0 0">Too few calls to read much into these yet.</p>` : ""}
    ${full ? `<h2 class="you-h2">Does being sure help?</h2><p class="hint" style="margin:0 0 10px">Right direction, by how sure you said you were. ${esc(sureLine)}</p>${bars(bySure)}
      <h2 class="you-h2">What works for you</h2><p class="hint" style="margin:0 0 10px">Right direction, by what your call was based on.${bestBasis ? ` ${esc(bestBasis.label)} calls are your strongest.` : ""}</p>${bars(byBasis)}
      <h2 class="you-h2">By time period</h2><p class="hint" style="margin:0 0 10px">Right direction, by how long the call was.</p>${bars(byH.map((x) => ({ label: HORIZONS[x.h].label, p: x.p, note: x.n ? "" : "No calls yet" })))}`
      : `<div class="you-lock"><b>Opens at level 3 (${callsFor(3)} calls)</b><span class="hint">${esc(UNLOCKS[3])}</span></div>`}
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
  el.querySelector("#youCard").onclick = () => openSheet("How others see you", cardHtml(myFullCard(), { mine: true }) + `<p class="hint">Other players see your username, level, score, followers and record. Your price calls are never shown unless you make them public once scored.</p>`);
  el.querySelector("#youShare").onclick = () => openShareSheet(myFullCard());
  el.querySelector("#youSet").onclick = () => openAvatarSheet();
  el.querySelector("#youLearn").onclick = () => { APP.backTo = "you"; showTab("profile", "learn"); };
}
