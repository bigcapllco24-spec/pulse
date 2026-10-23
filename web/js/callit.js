// Making a call: the Call it sheet (which way, how far, then optional extras after Lock in), and the price field and
// checks it shares with the challenge and pick sheets (groups.js).
import { store, makePrediction, addCallDetails } from "./store.js";
import { HORIZONS, callSizes, checkPrediction, canPredict, typicalMove, PICK_MIN_MOVE } from "./score.js";
import { esc, money, pct, toast, haptic, openSheet, closeSheet } from "./ui.js";
import { SHORT } from "./card.js";
import { CH_PERIODS, myGroups, canCount, startChallenge } from "./social.js";
import { lastPrice, sigmaOf, PERIODS, when, openCoinCalls, groupName } from "./calls.js";

// ---------- making a call: the shared parts of the predict, challenge and pick sheets
const priceHint = (sym) => `Type where you think ${sym.t} will be, up or down from now.`;
export function priceField(id, sym, horizon, keep) {
  const p0 = lastPrice(sym.key);
  return `<div class="pnow"><span>${esc(sym.t)} now</span><b class="num">${esc(money(p0, sym.m))}</b></div>
    <label class="field" style="margin:12px 0 0"><span>Where will ${esc(sym.t)} be ${horizon === "1y" ? "in a year" : `in ${esc(HORIZONS[horizon].label)}`}?</span>
      <div class="uname"><span>$</span><input id="${id}" class="num" inputmode="decimal" autocomplete="off" placeholder="${esc(money(p0, sym.m).replace("$", ""))}" value="${esc(keep || "")}"></div></label>
    <p class="hint" id="${id}Msg">${esc(priceHint(sym))}</p>`;
}
export function watchPrice(body, id, sym, horizon, onValid) {
  const inp = body.querySelector("#" + id), msg = body.querySelector("#" + id + "Msg"), p0 = lastPrice(sym.key), sigmaD = sigmaOf(sym.key);
  const val = () => parseFloat(inp.value.replace(/[^0-9.]/g, ""));
  const check = () => {
    if (!inp.value.trim()) { msg.className = "hint"; msg.textContent = priceHint(sym); onValid(false); return; }
    const c = checkPrediction({ horizon, p0, target: val(), sigmaD, minMove: PICK_MIN_MOVE });
    msg.className = "hint " + (c.ok ? "good" : "bad");
    msg.textContent = c.ok ? `${pct(((val() - p0) / p0) * 100, 1)} from now · a call ${val() > p0 ? "up" : "down"}` : c.error;
    onValid(c.ok);
  };
  inp.oninput = check; check();
  return { val, p0, sigmaD, inp };
}
// lock-in: a short buzz (where the phone supports it) and a press-and-ripple on the button
export function lockFeel(btn) { haptic([10, 40, 16]); btn.classList.remove("thump"); void btn.offsetWidth; btn.classList.add("thump"); }

// Call it: the period, higher, lower or no change, a size (a touch, a little, a usual move) or your own price or
// percentage, how sure you are, what it's based on, and whether followers may see it once scored. Can also post the
// call to a group as a challenge (not a No change call: group picks are always a price up or down).
export const SURE = [["hunch", "A hunch"], ["fairly", "Fairly sure"], ["very", "Very sure"]];
export const BASIS = [["chart", "Chart"], ["indicators", "Indicators"], ["news", "News"], ["gut", "Gut"]];
// One decision per screen. 1 · the period and which way (nothing picked for you); 2 · how far, then Lock in (your own
// price opens on a tap; public and posting to a group sit in one quiet line; No change goes straight to Lock in);
// 3 · locked in, with "how sure" and "based on" as optional extras that can't slow the call down (it's already saved).
export function openPredictSheet(sym, onDone, prefer = null) {
  const p0 = lastPrice(sym.key), sigmaD = sigmaOf(sym.key);
  if (!p0 || sigmaD == null) { toast(`${sym.t} prices haven't loaded yet.`); return; }
  const free = PERIODS.filter((h) => canPredict(store.preds, sym.key, h));
  let horizon = prefer && free.includes(prefer) ? prefer : free.includes("1d") ? "1d" : free[0];
  let step = "dir", dir = 1, size = 1, own = null, typing = false, sure = null, basis = null, pub = store.data?.callsPublic !== false, post = false, g = myGroups()[0]?.id || null, made = null;
  const tm = () => typicalMove(sigmaD, horizon);
  const sizes = () => callSizes(horizon);
  const price = () => (dir === 0 ? p0 : own != null ? own : p0 * Math.exp(dir * sizes()[size][1] * tm()));
  const scored = () => when(new Date(Date.now() + HORIZONS[horizon].days * 864e5).toISOString(), horizon);
  openSheet(`Call ${esc(sym.t)}`, "", (body) => {
    const draw = () => {
      const sh = body.closest("#sheet"), head = sh?.querySelector("#shTitle"), x = sh?.querySelector(".sh-head [data-close]");
      if (head) head.textContent = step === "done" ? "Locked in" : `Call ${sym.t}`;
      if (x) { x.textContent = "Close"; x.hidden = step === "done"; } // nothing is saved until Lock in; after it, Done below
      if (!horizon) {
        body.innerHTML = `<p>You have a call waiting on every period for ${esc(sym.t)}. Each one can be made again once it has been scored.</p><button class="btn block" id="pSee">See your calls</button>`;
        body.querySelector("#pSee").onclick = () => openCoinCalls(sym);
        return;
      }
      if (step === "dir") return drawDir();
      if (step === "size") return drawSize();
      return drawDone();
    };
    // 1 · the period and which way
    const drawDir = () => {
      body.innerHTML = `<p class="hint" style="margin:0">Now <b class="num">${esc(money(p0, sym.m))}</b></p>
        <div class="utabs" role="group" aria-label="Time period" style="margin-top:14px">${PERIODS.map((h) => { const open = !canPredict(store.preds, sym.key, h); return `<button data-h="${h}" aria-selected="${h === horizon}" ${open ? "disabled" : ""}>${SHORT[h]}${open ? " · waiting" : ""}</button>`; }).join("")}</div>
        <div class="cdir"><button data-dir="1" class="up">▲ Higher</button><button data-dir="-1" class="dn">▼ Lower</button></div>
        <button class="cflat" data-dir="0">= No change<small>About where it is now</small></button>`;
      body.querySelectorAll("[data-h]").forEach((b) => (b.onclick = () => { horizon = b.dataset.h; drawDir(); }));
      body.querySelectorAll("[data-dir]").forEach((b) => (b.onclick = () => { dir = +b.dataset.dir; own = null; typing = false; size = 1; haptic(); step = "size"; draw(); }));
    };
    // 2 · how far, then Lock in
    const drawSize = () => {
      const groups = myGroups(), canPost = dir !== 0 && groups.length && CH_PERIODS.includes(horizon), target = price(), chk = checkPrediction({ horizon, p0, target, sigmaD, flat: dir === 0 });
      body.innerHTML = `<button class="linkbtn cback" id="pBack">‹ Back</button>
        ${dir === 0 ? `<p class="cq">${esc(sym.t)} <span class="flat">about ${esc(money(p0, sym.m))}</span> ${horizon === "1d" ? "tomorrow" : horizon === "1y" ? "in a year" : `in ${esc(HORIZONS[horizon].label)}`}</p><p class="hint" style="margin:0">Right if it ends close to today's price.</p>` : `<p class="cq">${esc(sym.t)} <span class="${dir > 0 ? "up" : "dn"}">${dir > 0 ? "higher" : "lower"}</span> in ${esc(HORIZONS[horizon].label)}, by…</p>
        <div class="csizes">${sizes().map(([l, k], i) => { const v = p0 * Math.exp(dir * k * tm()); return `<button class="csize" data-k="${i}" aria-pressed="${own == null && i === size}"><span><b>${esc(l)}</b><small>${pct((v / p0 - 1) * 100, 1)}</small></span><b class="num">${esc(money(v, sym.m))}</b></button>`; }).join("")}</div>
        ${dir === 0 ? "" : typing ? `<label class="cown"><input id="pOwn" class="num" inputmode="decimal" placeholder="A price, or a % like 2.5%" value="${own != null ? esc(String(+own.toPrecision(8))) : ""}"></label><p class="hint ${own != null && !chk.ok ? "bad" : ""}" id="pOwnMsg" style="margin:6px 0 0">${own != null ? esc(chk.ok ? `${pct((own / p0 - 1) * 100, 1)} from now` : chk.error) : "Type a price, or a percentage with %."}</p>`
          : `<button class="linkbtn cownbtn" id="pOwnOpen">Type my own price</button>`}`}
        ${post && canPost ? `<div class="opts" style="margin-top:12px">${groups.map((x) => `<button class="opt" data-pg="${esc(x.id)}" aria-pressed="${x.id === g}">${esc(x.name)}</button>`).join("")}</div>` : ""}
        <button class="btn primary block" id="pGo" style="margin-top:16px" ${chk.ok ? "" : "disabled"}>${post && canPost ? "Lock in and start challenge" : dir === 0 ? "Lock in No change" : `Lock in ${esc(money(target, sym.m))}`}</button>
        <p class="hint" style="text-align:center;margin-top:8px">Scored ${esc(scored())} · Not advice</p>
        <div class="cmore"><button class="linkbtn" id="pPubT">${pub ? "Public once scored" : "Private"} · <b>Change</b></button>${canPost ? `<button class="linkbtn" id="pPostT">${post ? "Don't post to a group" : "Post to a group"}</button>` : ""}</div>`;
      body.querySelector("#pBack").onclick = () => { step = "dir"; draw(); };
      body.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { size = +b.dataset.k; own = null; typing = false; haptic(); drawSize(); }));
      body.querySelector("#pOwnOpen")?.addEventListener("click", () => { typing = true; drawSize(); body.querySelector("#pOwn").focus(); });
      body.querySelector("#pPubT").onclick = () => { pub = !pub; drawSize(); };
      body.querySelector("#pPostT")?.addEventListener("click", () => { post = !post; drawSize(); });
      body.querySelectorAll("[data-pg]").forEach((b) => (b.onclick = () => { g = b.dataset.pg; drawSize(); }));
      const inp = body.querySelector("#pOwn"), go = body.querySelector("#pGo"), msg = body.querySelector("#pOwnMsg");
      if (inp) inp.oninput = () => {
        // "83130" is a price; "2.5%" is a percentage from now
        const raw = inp.value.trim(), x = parseFloat(raw.replace(/[^0-9.\-]/g, ""));
        if (!raw || !isFinite(x)) { own = null; go.disabled = true; msg.className = "hint"; msg.textContent = "Type a price, or a percentage with %."; return; }
        own = /%/.test(raw) ? p0 * (1 + x / 100) : x;
        const c = checkPrediction({ horizon, p0, target: own, sigmaD });
        body.querySelectorAll("[data-k]").forEach((b) => b.setAttribute("aria-pressed", "false"));
        go.disabled = !c.ok; go.textContent = post ? "Lock in and start challenge" : `Lock in ${money(own, sym.m)}`;
        msg.className = "hint " + (c.ok ? "good" : "bad"); msg.textContent = c.ok ? `${money(own, sym.m)}, ${pct((own / p0 - 1) * 100, 1)} from now` : c.error;
      };
      go.onclick = async () => {
        go.disabled = true; const label = go.textContent; go.textContent = "Locking in…";
        const target = price();
        try {
          if (post && canPost) await startChallenge({ g, sym, horizon, target, p0, sigmaD, counts: true });
          else await makePrediction({ sym, horizon, target, p0, sigmaD, pub, flat: dir === 0 });
          lockFeel(go); made = { target, group: post && canPost ? g : null }; onDone?.();
          setTimeout(() => { step = "done"; draw(); }, 300);
        } catch (e) { go.disabled = false; go.textContent = label; const m = body.querySelector("#pErr") || go.insertAdjacentElement("afterend", Object.assign(document.createElement("p"), { id: "pErr" })); m.className = "hint bad"; m.style.margin = "8px 0 0"; m.textContent = e.message || "Couldn't save. Try again."; }
      };
    };
    // 3 · locked in, with the optional extras
    const drawDone = () => {
      body.innerHTML = `<div class="cdone"><svg viewBox="0 0 80 80" aria-hidden="true" class="done-ring"><circle cx="40" cy="40" r="34"/><path d="M26 41l9 9 19-20"/></svg>
          <p>${esc(sym.t)} ${made.target === p0 ? "about" : "at"} <b class="num">${esc(money(made.target, sym.m))}</b>${made.target === p0 ? " (no change)" : ""}, scored ${esc(scored())}.${made.group ? ` Posted to ${esc(groupName(made.group))}.` : ""}</p></div>
        ${made.group ? "" : `<div class="label" style="margin-top:20px">How sure are you? <span class="opt-l">optional</span></div>
        <div class="opts">${SURE.map(([k, l]) => `<button class="opt" data-sure="${k}" aria-pressed="${sure === k}">${l}</button>`).join("")}</div>
        <div class="label" style="margin-top:16px">Based on <span class="opt-l">optional</span></div>
        <div class="opts">${BASIS.map(([k, l]) => `<button class="opt" data-basis="${k}" aria-pressed="${basis === k}">${l}</button>`).join("")}</div>`}
        <button class="btn primary block" id="pDone" style="margin-top:20px">Done</button>`;
      body.querySelectorAll("[data-sure]").forEach((b) => (b.onclick = () => { sure = sure === b.dataset.sure ? null : b.dataset.sure; drawDone(); }));
      body.querySelectorAll("[data-basis]").forEach((b) => (b.onclick = () => { basis = basis === b.dataset.basis ? null : b.dataset.basis; drawDone(); }));
      body.querySelector("#pDone").onclick = async () => {
        closeSheet();
        if (sure || basis) addCallDetails({ sym, horizon, sure, basis }).catch(() => toast("Your call is saved; how sure and based on couldn't be added."));
      };
    };
    draw();
  });
}
// "Where it counts" for a group pick: counts to your public score (and is a normal prediction), or group only.
export function countsHtml(coin, horizon, counts) {
  const can = canCount(coin, horizon), t = coin.split(":")[1];
  return `<div class="label" style="margin-top:6px">Where it counts</div>
    <label class="optc${can && counts ? " on" : ""}${can ? "" : " off"}"><input type="radio" name="pcnt" value="counts" ${can && counts ? "checked" : ""} ${can ? "" : "disabled"}><span><b>Counts to my score</b><span class="hint">${can ? `Also a normal ${HORIZONS[horizon].label} prediction. Your public score moves with it.` : `You already have an open ${HORIZONS[horizon].label} prediction on ${esc(t)}, so this one is for the group only.`}</span></span></label>
    <label class="optc${!can || !counts ? " on" : ""}"><input type="radio" name="pcnt" value="group" ${!can || !counts ? "checked" : ""}><span><b>Group only</b><span class="hint">Scored for this group's table. Your public score doesn't change.</span></span></label>`;
}
