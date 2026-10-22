// A player's card (1.1.0): your profile page and other players' cards share this markup. It explains the score as
// well as showing it: a dial split into the five bands, how far it is to the next band, a record with a note on each
// number, how close calls landed, and the last 90 days with the band lines drawn. Never shows a price call.
import { esc } from "./ui.js";
import { BANDS, CHANCE, PROVISIONAL_UNDER, SCORE_MIN, SCORE_MAX } from "./score.js";
import { LABELS, nextBand } from "./habit.js";

export const BAND_CLASS = { Proven: "b5", Building: "b3", "Below guessing": "b1" };
export const SHORT = { "30m": "30 min", "1h": "1 hour", "1d": "1 day", "1y": "1 year" };
const ADJ = { "30m": "30-minute", "1h": "1-hour", "1d": "1-day", "1y": "1-year" };
const num = (s) => `<span class="num">${s}</span>`;
const icon = (d, extra = "") => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
export const ICONS = {
  flame: `<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.6 1.2 2.5 2.2 2.5C10.5 8.5 11 5.5 12 3z"/>`,
  star: `<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>`,
  share: `<path d="M12 4v11M7.5 8.5L12 4l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>`,
  people: `<circle cx="9" cy="9" r="3.5"/><path d="M3 19c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5M16 7.5a3 3 0 0 1 0 5.5M18 14.8c1.5.6 2.6 1.9 3 4.2"/>`,
  bars: `<path d="M5 20V11M12 20V5M19 20v-6"/>`,
  sliders: `<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>`,
};
export const svgIcon = (name, extra = "") => icon(ICONS[name], extra);

// the band colour as a CSS variable, for everything on the card that takes the band's colour
const bandVar = (c) => (c.score != null && !c.prov ? `var(--${BAND_CLASS[c.band] || "b2"})` : "var(--accent)");

// ---------- the dial: 300 to 900 as a half circle split into the five bands, a dot at the score
const G = { cx: 150, cy: 150, r: 116 };
const P = (v) => { const a = Math.PI * (1 - (v - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)); return [G.cx + G.r * Math.cos(a), G.cy - G.r * Math.sin(a)]; };
const arc = (a, b) => { const p = P(a), q = P(b); return `M${p[0].toFixed(1)} ${p[1].toFixed(1)} A${G.r} ${G.r} 0 0 1 ${q[0].toFixed(1)} ${q[1].toFixed(1)}`; };
export function dialSvg(score, { sub = "out of 900" } = {}) {
  const bands = [...BANDS].reverse().map(([min, name], i, a) => [min, i + 1 < a.length ? a[i + 1][0] : SCORE_MAX, name]); // lowest band first
  const segs = bands.map(([lo, hi, name]) => `<path d="${arc(lo + 3, hi - 3)}" style="stroke:var(--${BAND_CLASS[name]});opacity:${score != null && lo <= score ? 1 : 0.28}"/>`).join("");
  const m = score != null ? P(score) : null;
  return `<svg class="pc2-dial" viewBox="0 0 300 172" role="img" aria-label="${score != null ? `Score ${score} of 900` : "Score 0: no calls scored yet"}">${segs}
    ${m ? `<circle cx="${m[0].toFixed(1)}" cy="${m[1].toFixed(1)}" r="10" class="pc2-mark"/>` : ""}
    <text x="150" y="122" text-anchor="middle" class="pc2-big">${score ?? 0}</text>
    <text x="150" y="148" text-anchor="middle" class="pc2-sub">${esc(score != null ? sub : "no calls scored yet")}</text>
    <text x="32" y="170" text-anchor="middle" class="pc2-end">300</text><text x="268" y="170" text-anchor="middle" class="pc2-end">900</text></svg>`;
}

// ---------- the last 90 days, with the band lines it crossed or came near
function lineSvg(line) {
  const xs = (line || []).filter((x) => x.s != null);
  if (xs.length < 2) return "";
  let lo = Math.min(...xs.map((x) => x.s)), hi = Math.max(...xs.map((x) => x.s));
  lo = Math.max(SCORE_MIN, lo - 20); hi = Math.min(SCORE_MAX, hi + 20);
  const Y = (s) => 104 - ((s - lo) / Math.max(1, hi - lo)) * 96, X = (i) => 4 + (i / (xs.length - 1)) * 318;
  const d = xs.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(x.s).toFixed(1)}`).join(" ");
  const marks = [...BANDS].filter(([min]) => min > lo && min < hi).map(([min, name]) => `<line x1="0" x2="326" y1="${Y(min).toFixed(1)}" y2="${Y(min).toFixed(1)}" style="stroke:var(--${BAND_CLASS[name]})" class="pc2-th"/><text x="2" y="${(Y(min) - 4).toFixed(1)}" style="fill:var(--${BAND_CLASS[name]})" class="pc2-thl">${esc(name)} ${min}</text>`).join("");
  const diff = xs.at(-1).s - xs[0].s;
  return `<div class="pc2-box"><div class="pc2-row"><span class="label">Last 90 days</span><span class="hint num">${xs[0].s} → ${xs.at(-1).s}${diff ? ` <span class="${diff > 0 ? "up" : "down"}">${diff > 0 ? "+" : "−"}${Math.abs(diff)}</span>` : ""}</span></div>
    <svg class="pc2-line" viewBox="0 0 326 112" role="img" aria-label="Score from ${xs[0].s} to ${xs.at(-1).s}">${marks}<path d="${d}"/><circle cx="${X(xs.length - 1).toFixed(1)}" cy="${Y(xs.at(-1).s).toFixed(1)}" r="5"/></svg></div>`;
}

// c: a card ({ u, score, band, prov, n, followers, rank, of, spot, closePlus, best, badges, since, line, mix, streak }).
// opts: mine (your own profile), actions (buttons under the hero), common (groups you share), howId (id for the help link).
export function cardHtml(c, { mine = false, actions = "", common = [] } = {}) {
  const n = c.n || 0, score = c.score ?? null, nb = nextBand(score), bv = bandVar(c);
  const avaCls = score != null && !c.prov ? BAND_CLASS[c.band] || "" : "prov";
  const mix = Array.isArray(c.mix) && c.mix.length === LABELS.length ? c.mix : null, mixN = mix ? mix.reduce((a, x) => a + x, 0) : 0;
  const close = mix ? mix[0] + mix[1] + mix[2] : null;
  const top = c.rank ? Math.max(1, Math.ceil((c.rank / Math.max(1, c.of)) * 100)) : null;
  const since = c.since ? new Date(c.since + "-01").toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "";
  const chips = [
    score != null ? `<span class="pc2-chip band"><i></i>${esc(c.band)}${c.prov ? " · provisional" : ""}</span>` : `<span class="pc2-chip">New player</span>`,
    c.rank ? `<span class="pc2-chip">Top ${top}% · ${num("#" + c.rank)}</span>` : "",
    `<span class="pc2-chip">${num((c.followers || 0).toLocaleString("en-IN"))} follower${c.followers === 1 ? "" : "s"}</span>`,
    c.streak ? `<span class="pc2-chip streak">${svgIcon("flame")}<span>${num(c.streak)}-day streak</span></span>` : "",
  ].join("");
  const tiles = [
    [num(n), "Calls scored", n < PROVISIONAL_UNDER ? `Provisional until ${PROVISIONAL_UNDER}` : "Past provisional"],
    [num(c.spot ?? 0), "Spot on", "Missed by under ¼ of a typical move", "acc"],
    [c.closePlus != null ? num(c.closePlus + "%") : "–", "Close or better", close != null && mixN ? `${close} of ${mixN} calls` : "Spot on, Very close or Close"],
    [c.best ? esc(SHORT[c.best].replace(" ", " ")) : "–", "Best period", c.best ? `${mine ? "Your" : "Their"} ${ADJ[c.best]} calls land closest` : "Needs 3 calls in a period"],
  ];
  const MIXC = ["var(--accent)", "color-mix(in srgb, var(--accent) 60%, transparent)", "color-mix(in srgb, var(--text) 62%, transparent)", "color-mix(in srgb, var(--muted) 55%, transparent)", "var(--warn)"];
  const MIXD = ["under ¼ move", "¼ to ½", "½ to 1", "1 to 2", "2 or more"];
  return `<div class="pc2" style="--bandc:${bv}">
    <div class="pc2-hero">
      <div class="pc2-avwrap"><svg class="pc2-pulse" viewBox="0 0 358 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 32 H52 L60 32 L66 20 L74 46 L82 12 L90 40 L96 32 H262 L268 32 L274 22 L282 44 L290 16 L298 38 L304 32 H358"/></svg>
        <span class="ava xl ${avaCls}">${esc((c.u || "?")[0].toUpperCase())}</span></div>
      <b class="pc2-u">@${esc(c.u)}</b>
      <div class="pc2-chips">${chips}</div>
      ${since || c.best ? `<span class="hint">${[since && `Playing since ${esc(since)}`, c.best && `best at ${ADJ[c.best]} calls`].filter(Boolean).join(" · ")}</span>` : ""}
    </div>
    ${actions}
    <div class="pc2-box">
      <div class="pc2-row"><span class="label">Prediction score</span><button class="linkbtn" data-how>How it works</button></div>
      ${dialSvg(score)}
      ${score == null ? `<div class="pc2-next"><b>${mine ? `Make ${PROVISIONAL_UNDER} calls to get your score` : "No scored calls yet"}</b><span class="hint">The first scored call starts it at about ${CHANCE}, what guessing scores.</span>${mine ? `<button class="btn primary block" data-first>Make your first call</button>` : ""}</div>`
        : nb?.name ? `<div class="pc2-next"><div class="pc2-row"><b>${num(nb.need)} point${nb.need === 1 ? "" : "s"} to ${esc(nb.name)}</b><span class="hint">${Math.round(nb.share * 100)}% there</span></div><span class="pc2-bar" aria-hidden="true"><i style="width:${(nb.share * 100).toFixed(1)}%"></i></span><div class="pc2-row hint"><span>${esc(nb.here)} · ${nb.from}</span><span>${esc(nb.name)} · ${nb.to}</span></div></div>`
        : `<div class="pc2-next"><b>${esc(BANDS[0][1])}</b><span class="hint">The top band, from ${BANDS[0][0]}. Every point above it has to be earned over many calls.</span></div>`}
      <div class="pc2-key">${[...BANDS].reverse().map(([min, name]) => `<span><i style="background:var(--${BAND_CLASS[name]})"></i>${esc(name)} ${num(min)}</span>`).join("")}</div>
    </div>
    <div class="pc2-tiles">${tiles.map(([v, t, h, cls]) => `<div class="pc2-tile"><b class="${cls || ""}">${v}</b><span class="t">${t}</span><span class="hint">${h}</span></div>`).join("")}</div>
    ${mix && mixN ? `<div class="pc2-box"><div class="pc2-row"><span class="label">How close ${mine ? "your" : "their"} calls land</span><span class="hint">${num(mixN)} call${mixN === 1 ? "" : "s"}</span></div>
      <div class="pc2-mixbar" aria-hidden="true">${mix.map((k, i) => (k ? `<i style="flex:${k};background:${MIXC[i]}"></i>` : "")).join("")}</div>
      <div class="pc2-mix">${LABELS.map((l, i) => `<div><i style="background:${MIXC[i]}"></i><span class="t">${esc(l)}</span><span class="hint">${MIXD[i]}</span><b class="num">${mix[i]}</b></div>`).join("")}</div>
      <p class="hint" style="margin:0">Misses are measured in typical moves, so a 30-minute call and a 1-year call compare fairly.</p></div>` : ""}
    ${lineSvg(c.line)}
    ${(c.badges || []).length ? `<div><span class="label">Badges</span><div class="pc2-badges">${c.badges.map((b) => `<span class="pc2-badge">${svgIcon("star")}${esc(b)}</span>`).join("")}</div></div>` : ""}
    ${common.length ? `<div><span class="label">Groups in common</span><p style="margin:4px 0 0">${common.map((g) => esc(g.name)).join(", ")}</p></div>` : ""}
  </div>`;
}
