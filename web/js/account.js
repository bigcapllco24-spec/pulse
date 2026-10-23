// The avatar sheet: your account and settings, opened from your avatar at the top of Calls and You.
import { CONFIG } from "../config.js";
import { store, save, myScore, enablePush, isAdmin } from "./store.js";
import { openGuide } from "./guide.js";
import { esc, toast, openSheet, closeSheet } from "./ui.js";
import { showTab } from "./app.js";
import { openMyCard } from "./you.js";
import { openProfile } from "./pages.js";
import { setFeedbackMode } from "./feedback.js";
import { myName, myCard, following, setPublic, setPickDefault } from "./social.js";
import { ava, num } from "./calls.js";
import { cardFromScore, openFollowing } from "./people.js";

// ---------- the avatar sheet: your account and settings (what Profile used to be)
let admin = null;
export function openAvatarSheet() {
  const sc = myScore(), card = myCard(), u = myName(), unread = store.alerts.filter((a) => !a.read).length;
  const row = (k, t, s, extra = `<span class="chev">›</span>`) => `<button class="row" data-av="${k}"><span class="main"><span class="t">${t}</span>${s ? `<span class="s">${s}</span>` : ""}</span>${extra}</button>`;
  const sw = (id, on, label) => `<span class="switch"><input type="checkbox" id="${id}" ${on ? "checked" : ""} aria-label="${label}"><span></span></span>`;
  openSheet("Settings", `<button class="row pl-me" data-av="card">${ava(u, cardFromScore(), "lg")}<span class="main"><span class="t" style="font-size:var(--t-xl)">@${esc(u || "you")}</span><span class="s">${sc?.score != null ? `${num(sc.score)} ${esc(sc.band)}` : `${num(0)} · No calls scored yet`}${card?.followers ? ` · ${card.followers} follower${card.followers === 1 ? "" : "s"}` : ""}</span><span class="s" style="color:var(--accent);font-weight:700">View your profile</span></span><span class="chev">›</span></button>
    <div class="label pg">People and privacy</div><div class="hl">
      ${row("following", "Following", following().length ? `${following().length} player${following().length === 1 ? "" : "s"} · only you can see who` : "Players you follow show here, only to you")}
      <div class="row"><span class="main"><span class="t">Public leaderboard</span><span class="s">Show my username, score and rank to everyone</span></span>${sw("avPub", store.data?.public === true, "Public leaderboard")}</div>
      <div class="row"><span class="main"><span class="t">Group picks count to my score</span><span class="s">The default when you pick in a group; you can change it each time</span></span>${sw("avCnt", store.data?.pickDefault !== "group", "Group picks count to my score")}</div>
      <div class="row"><span class="main"><span class="t">My scored calls are public</span><span class="s">To followers, once scored. Public or private, both count to your score. You can change it on each call.</span></span>${sw("avCalls", store.data?.callsPublic !== false, "My scored calls are public")}</div>
    </div>
    <div class="label pg">Charts and alerts</div><div class="hl">
      ${row("chart", "Chart style", "Time range, candles and lines")}
      ${row("rules", "Alert rules", "Get told when your levels are hit")}
      ${row("alerts", `Alerts${unread ? ` <span class="pill confirmed">${unread} new</span>` : ""}`, "Everything that has fired")}
      ${row("push", "Notifications", "Alerts, group challenges and results on this phone")}
    </div>
    <div class="label pg">Sharing</div><div class="hl">${row("lists", "Shared lists", "Follow a list of coins with friends")}</div>
    <div class="label pg">App</div><div class="hl">
      ${row("account", "Account", `Username (${esc(u ? "@" + u : "not set")}), sign out`)}
      ${row("guide", `How ${esc(CONFIG.appName)} works`, "A one-minute guide to the app")}
      ${row("appearance", "Appearance", "Dark, light or match phone")}
      ${row("feedback", "Give feedback", "Hold anything for 3 seconds, or switch on tap-to-comment")}
      ${row("legal", "Legal and disclaimer", "Terms, privacy, grievance contact")}
      <span data-admin></span>
    </div>
    <p class="hint pl-ver">${esc(CONFIG.appName)} ${esc(CONFIG.version)}</p>`, (body) => {
    const go = (k) => {
      if (k === "card") return openMyCard();
      if (k === "guide") { closeSheet(); return openGuide(); }
      if (k === "following") return openFollowing();
      if (k === "push") return enablePush().then(() => toast("Notifications are on for this phone."), (e) => toast(e.message, { ms: 5000 }));
      if (k === "feedback") { closeSheet(); setFeedbackMode(true); showTab("feed"); return; }
      closeSheet(); openProfile(k, null, { fromSettings: true });
    };
    body.querySelectorAll("[data-av]").forEach((b) => (b.onclick = () => go(b.dataset.av)));
    body.querySelector("#avPub").onchange = async (e) => { await setPublic(e.target.checked); toast(e.target.checked ? "You'll show on the public leaderboard at the next update." : "You're off the public leaderboard from the next update."); };
    body.querySelector("#avCnt").onchange = (e) => setPickDefault(e.target.checked ? "counts" : "group");
    body.querySelector("#avCalls").onchange = (e) => save({ callsPublic: e.target.checked });
    const showAdmin = () => { const a = body.querySelector("[data-admin]"); if (a && admin) { a.outerHTML = row("inbox", "Feedback inbox", "Admin · everyone's notes, newest first"); body.querySelector('[data-av="inbox"]').onclick = () => go("inbox"); } };
    if (admin === null) isAdmin().then((x) => { admin = x; showAdmin(); }); else showAdmin();
  });
}
