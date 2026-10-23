// A card's news pane (swipe right on the feed): confirmed stories, official sources, single reports, community
// posts, and price events worked out from the coin's own daily candles.
import { store, chartSettings } from "./store.js";
import { D, view, storiesFor } from "./data.js";
import { esc, money, fmtDay, openSheet, DISCLAIMER } from "./ui.js";
import { APP } from "./app.js";

// ---------- news pane
export function renderNews(c, it, scope) {
  const s = it.sym, pane = c.querySelector('[data-pane="news"]');
  scope = scope === "mine" ? "mine" : pane.dataset.scope === "mine" && !scope ? "mine" : "sym";
  pane.dataset.scope = scope;
  const keys = new Set(APP.syms.map((x) => x.key));
  const stories = (scope === "sym" ? storiesFor(s.key) : (D.news.stories || []).filter((st) => st.syms.some((k) => keys.has(k)))).slice(0, 40);
  const win = view(s.key, chartSettings(s.key))?.win;
  const winDates = new Set((win || []).map((b) => b.t));
  const by = (k) => stories.filter((st) => (k === "single" || k === "official" || k === "community" ? st.status === k : st.status === "confirmed" || st.status === "company"));
  // Price events are worked out from our own daily candles, so this pane is never empty. Facts about the past only.
  const evSyms = scope === "sym" ? [s] : APP.syms;
  let events = evSyms.flatMap((x) => priceEvents(x).map((e) => ({ ...e, x })));
  if (scope === "mine" && events.some((e) => e.w)) events = events.filter((e) => e.w); // one summary per coin would crowd the list
  events = events.sort((p, q) => (q.t > p.t ? 1 : q.t < p.t ? -1 : q.w - p.w)).slice(0, scope === "sym" ? 6 : 10);
  // since your call (1.2.0): a marker between stories newer and older than your oldest open call on this coin
  const oldest = scope === "sym" ? store.preds.filter((p) => p.coin === s.key).map((p) => p.createdAt).sort()[0] : null;
  let marked = false;
  const withMark = (list) => list.map((st, i) => { const at = st.ts || st.date, before = oldest && at && at < oldest; const mk = oldest && !marked && before ? (marked = true, `<div class="sincecall"><i></i><span>Since your call · ${esc(new Date(oldest).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" }))}</span><i></i></div>`) : ""; return mk + storyHtml(st, winDates.has(st.date) && scope === "sym"); }).join("");
  const sect = (title, note, list) => (list.length ? `<h3 class="nsec">${title}<span>${note}</span></h3>${withMark(list)}` : "");
  pane.innerHTML = `<div class="pane-wrap"><h2 class="side">News · ${esc(scope === "sym" ? s.t : "My coins")}</h2>
    <div class="seg" role="group" aria-label="Which news">${[["sym", s.t], ["mine", "All my coins"]].map(([k, l]) => `<button data-scope="${k}" aria-pressed="${k === scope}">${esc(l)}</button>`).join("")}</div>
    ${sect("Confirmed", "2+ independent outlets", by("confirmed"))}
    ${sect("Official sources", "projects, exchanges, regulators", by("official"))}
    ${sect("Also reported", "one trusted outlet so far", by("single"))}
    ${sect("Community", "governance votes and project forums", by("community"))}
    <h3 class="nsec">Price events<span>from the daily chart, last 30 days</span></h3>
    <div class="pevents">${events.map((e) => `<div class="pev ${e.dir || ""}"><span class="pd">${esc(fmtDay(e.t))}${scope === "mine" ? ` · <b>${esc(e.x.t)}</b>` : ""}</span><p>${esc(e.text)}</p></div>`).join("") || `<div class="empty">${esc(s.t)} prices are still loading.</div>`}</div>
    <p class="disclaimer">Headlines from Reuters, AP, CNBC, CoinDesk, The Block, Decrypt, Blockworks, DL News, Cointelegraph, Unchained, CryptoSlate, Fortune and other outlets, found via <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener">the GDELT Project</a> and the outlets' own feeds, then matched across outlets. “Official sources” are the projects' own release pages and blogs, exchange announcements (Kraken) and regulators (SEC). “Community” lists governance votes (from Snapshot) and new topics on the projects' own forums, as posted by their communities; anything about prices or trading is left out. Opinion, predictions and promotional posts are left out. Price events are calculated from daily prices and describe the past only. ${esc(DISCLAIMER)}</p></div>`;
  pane.querySelectorAll("[data-scope]").forEach((b) => (b.onclick = () => renderNews(c, it, b.dataset.scope)));
  pane.querySelectorAll("[data-story]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const st = stories.find((x) => x.key === b.dataset.story); if (st) openStory(st); }));
}
// Notable things the price did in the last 30 days, from daily candles: unusually big days (2x the 14-day ATR),
// unusually heavy volume (2x the 20-day average), new 52-week highs and lows, and crossings of the 200-day average.
// Always ends with a plain summary of the month, so there's something to read even when it was quiet.
function priceEvents(sym) {
  const bars = D.series[sym.key]?.bars;
  if (!bars || bars.length < 40) return [];
  const n = bars.length, out = [], from = Math.max(21, n - 30);
  const d = (i) => ((bars[i].c - bars[i - 1].c) / bars[i - 1].c) * 100;
  const tr = (i) => Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c)) / bars[i - 1].c * 100;
  const avg = (f, a, b) => { let t = 0; for (let j = a; j < b; j++) t += f(j); return t / (b - a); };
  const sinceBigger = (i, up) => { let k = i - 1; while (k > 0 && (up ? d(k) < d(i) : d(k) > d(i))) k--; return i - k; };
  const ma200 = (i) => (i >= 200 ? avg((j) => bars[j].c, i - 199, i + 1) : null);
  for (let i = from; i < n; i++) {
    const ch = d(i), atr = avg(tr, i - 14, i), t = bars[i].t;
    if (Math.abs(ch) >= 2 * atr) {
      const k = sinceBigger(i, ch > 0), span = k > 365 ? "in over a year" : `in ${k} days`;
      out.push({ t, w: 3, dir: ch > 0 ? "up" : "down", text: `${ch > 0 ? "Rose" : "Fell"} ${Math.abs(ch).toFixed(1)}% in a day, about ${(Math.abs(ch) / atr).toFixed(1)}× its typical daily move. Its biggest one-day ${ch > 0 ? "rise" : "fall"} ${span}.` });
    }
    const va = avg((j) => bars[j].v || 0, i - 20, i);
    if (va > 0 && bars[i].v >= 2 * va) out.push({ t, w: 2, text: `Traded ${(bars[i].v / va).toFixed(1)}× its usual daily volume (20-day average).` });
    if (i >= 365) {
      const prev = bars.slice(i - 365, i);
      if (bars[i].h > Math.max(...prev.map((b) => b.h))) out.push({ t, w: 2, dir: "up", text: `Set a new 52-week high at ${money(bars[i].h, sym.m)}.` });
      if (bars[i].l < Math.min(...prev.map((b) => b.l))) out.push({ t, w: 2, dir: "down", text: `Set a new 52-week low at ${money(bars[i].l, sym.m)}.` });
    }
    const m0 = ma200(i - 1), m1 = ma200(i);
    if (m0 && m1 && (bars[i - 1].c - m0) * (bars[i].c - m1) < 0) out.push({ t, w: 1, dir: bars[i].c > m1 ? "up" : "down", text: `Closed ${bars[i].c > m1 ? "above" : "below"} its 200-day average (${money(m1, sym.m)}) for the first time in a while.` });
  }
  // collapse repeated 52-week highs or lows into the latest one
  const seen = new Set(), ev = out.reverse().filter((e) => { const k = e.text.slice(0, 22); if (/52-week/.test(k)) { if (seen.has(k)) return false; seen.add(k); } return true; });
  const a = n - 31, mv = ((bars[n - 1].c - bars[a].c) / bars[a].c) * 100;
  let big = 0; for (let i = a + 1; i < n; i++) big = Math.max(big, Math.abs(d(i)));
  const hi = Math.max(...bars.slice(a).map((b) => b.h)), lo = Math.min(...bars.slice(a).map((b) => b.l));
  ev.push({ t: bars[n - 1].t, w: 0, dir: mv >= 0 ? "up" : "down", text: `Over 30 days: ${mv >= 0 ? "up" : "down"} ${Math.abs(mv).toFixed(1)}%, trading between ${money(lo, sym.m)} and ${money(hi, sym.m)}. ${ev.length ? "" : "A quiet month: "}${ev.length ? "The largest" : "the largest"} single-day move was ${big.toFixed(1)}%.` });
  return ev;
}
const STATUS = (st) => (st.status === "confirmed" ? `Confirmed by ${st.outlets.join(" + ")}` : st.status === "company" ? "From the company" : st.status === "official" ? `Official: ${st.official || "source"}` : st.status === "community" ? `Community: ${st.community || "forum"}` : `Single source: ${st.outlets[0]}`);
function storyHtml(st, pinned) {
  const more = st.links.slice(1).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.source)} ↗</a>`).join(" ");
  return `<article class="story" id="st-${st.key}"><div class="srow2"><a class="h" href="${esc(st.links[0].url)}" target="_blank" rel="noopener">${esc(st.title)}</a>
    <button class="sgo" data-story="${esc(st.key)}" aria-label="More about this story"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2l4 4-4 4"/></svg></button></div>
    <div class="meta">${pinned ? `<span class="dotpin" title="Pinned on the chart"></span>` : ""}<span>${esc(fmtDay(st.date))}</span><span class="pill ${st.status}">${esc(STATUS(st))}</span>${more}</div>
</article>`;
}
// The › on a story: the publisher's own short summary (from its feed, never written by us) and every source.
function openStory(st) {
  openSheet("Story", `<p class="sttl">${esc(st.title)}</p>
    <div class="meta"><span>${esc(fmtDay(st.date))}</span><span class="pill ${st.status}">${esc(STATUS(st))}</span></div>
    ${st.intro ? `<section class="gsec"><h3>In brief</h3><p>${esc(st.intro)}</p><p class="hint">Summary from ${esc(st.introBy)}'s own feed.</p></section>` : `<section class="gsec"><h3>In brief</h3><p class="hint">The publisher didn't include a summary. Open a source below to read the story.</p></section>`}
    <section class="gsec"><h3>Read it at the source${st.links.length > 1 ? `s (${st.links.length})` : ""}</h3>
      <div class="list">${st.links.map((l) => `<a class="row" href="${esc(l.url)}" target="_blank" rel="noopener"><span class="main"><span class="t">${esc(l.source)}</span><span class="s">${esc(l.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0])}</span></span><span class="chev">↗</span></a>`).join("")}</div></section>
    <p class="disclaimer">Headlines and summaries belong to their publishers. ${esc(DISCLAIMER)}</p>`);
}
