// The habit loop's server side (1.1.0), run by the data job every 2 hours:
// - data/daily.json: the daily coin for today and tomorrow, and how the crowd did on the last 7 days' coins (label
//   counts only, never a price call). The app works out the coin itself too; the file just carries the crowd.
// - the morning summary: once a day, in the run between 7 and 9:30 AM Indian time, one notification per player with
//   the calls scored since yesterday morning (and, on Mondays, last week's recap).
import fs from "node:fs";
import path from "node:path";
import { istDay, dailyCoin, crowdOf, morningSummary, weekRecap } from "../../web/js/habit.js";

const DAY = 864e5, IST = 5.5 * 36e5;

export function writeDaily(outDir, scoredBy, now = Date.now(), log = console.log) {
  const all = [...scoredBy.values()], days = {};
  for (let i = 1; i <= 7; i++) { // yesterday back: a day's calls are scored a day later
    const d = istDay(now - i * DAY), c = crowdOf(all, d);
    if (c.n) days[d] = c;
  }
  const doc = { generatedAt: new Date(now).toISOString(), today: dailyCoin(istDay(now)).key, tomorrow: dailyCoin(istDay(now + DAY)).key, crowd: days };
  fs.writeFileSync(path.join(outDir, "daily.json"), JSON.stringify(doc));
  log(`daily: today ${doc.today}, crowd for ${Object.keys(days).length} day(s)`);
  return doc;
}

export const isMorningRun = (now = Date.now()) => { const h = ((now + IST) % DAY) / 36e5; return h >= 7 && h < 9.5; };

// accounts: every account; scoredBy: account → scored results; send(token, msg) → "ok" | "dead".
export async function morningPush(db, accounts, scoredBy, send, { now = Date.now(), log = console.log, site = "" } = {}) {
  if (!isMorningRun(now)) return 0;
  const today = istDay(now), monday = new Date(now + IST).getUTCDay() === 1;
  let sent = 0;
  for (const a of accounts) {
    const tokens = Array.isArray(a.fcm) ? a.fcm : [];
    if (!tokens.length || a.lastMorning === today) continue;
    const rs = scoredBy.get(a.id) || [], m = morningSummary(rs, now), wk = monday ? weekRecap(rs, now) : null;
    if (!m && !wk) continue;
    const msg = { title: m ? m.title : "Your week on Pulse", body: [m?.body, wk && `Last week: ${wk.text.replace(" this week", "")}`].filter(Boolean).join("\n"), link: site ? `${site}/#/predict` : undefined };
    const dead = [];
    for (const t of tokens) if ((await send(t, msg)) === "dead") dead.push(t);
    await db.set(`accounts/${a.id}`, { lastMorning: today, ...(dead.length ? { fcm: tokens.filter((t) => !dead.includes(t)) } : {}) });
    sent++;
  }
  log(`morning: summaries sent to ${sent} player(s)`);
  return sent;
}
