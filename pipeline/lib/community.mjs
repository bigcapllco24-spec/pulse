// Community (1.1.0): what a coin's own community decided or started discussing, as facts only. Two free sources:
// - Snapshot (hub.snapshot.org, free public GraphQL, 100 requests a minute): governance votes, open or closed, with
//   the result as the share of votes for the leading choice. Only coins with a governance space have these.
// - The projects' own public forums (Discourse sites with free RSS feeds): new topics, title and link only.
// Never Reddit or X posts (paid, or not free for commercial use, and full of price calls). Titles about prices,
// trading or forecasts are dropped, and nothing here is written by us.

// Snapshot spaces by ticker (a space that doesn't exist simply returns nothing).
export const SPACES = {
  UNI: ["uniswapgovernance.eth"], AAVE: ["aavedao.eth", "aave.eth"], LDO: ["lido-snapshot.eth"], ARB: ["arbitrumfoundation.eth"],
  OP: ["opcollective.eth"], ENS: ["ens.eth"], CRV: ["curve.eth"], GNO: ["gnosis.eth"], SAFE: ["safe.eth"], BAL: ["balancer.eth"],
  CAKE: ["cakevote.eth"], COMP: ["comp-vote.eth"], "1INCH": ["1inch.eth"], SUSHI: ["sushigov.eth"],
};
// Official project forums (free Discourse RSS feeds of new topics).
export const FORUMS = {
  BTC: [["https://delvingbitcoin.org/latest.rss", "Delving Bitcoin (developer forum)"]],
  ETH: [["https://ethereum-magicians.org/latest.rss", "Ethereum Magicians (developer forum)"], ["https://ethresear.ch/latest.rss", "Ethereum Research forum"]],
  SOL: [["https://forum.solana.com/latest.rss", "Solana forum"]],
  ZEC: [["https://forum.zcashcommunity.com/latest.rss", "Zcash Community Forum"]],
  BNB: [["https://forum.bnbchain.org/latest.rss", "BNB Chain forum"]],
  UNI: [["https://gov.uniswap.org/latest.rss", "Uniswap governance forum"]],
  AAVE: [["https://governance.aave.com/latest.rss", "Aave governance forum"]],
  ARB: [["https://forum.arbitrum.foundation/latest.rss", "Arbitrum forum"]],
  OP: [["https://gov.optimism.io/latest.rss", "Optimism governance forum"]],
  LDO: [["https://research.lido.fi/latest.rss", "Lido research forum"]],
  ENS: [["https://discuss.ens.domains/latest.rss", "ENS forum"]],
};
// Anything about prices, trading or forecasts is left out, however it's phrased.
export const PRICE_TALK = /\b(price|prices|pump|dump|moon|buy|sell|trad(e|ing)|target|predict|prediction|speculat|bull|bear|ath|100x|10x|lambo|airdrop)\b/i;
const MAX_PER_COIN = 4;

const short = (s, n = 120) => (s.length > n ? s.slice(0, n - 1).trim() + "…" : s);
// One Snapshot vote → a factual line: "Uniswap vote closed: “Fee switch” · For 82%" or "… open until 18 Oct".
export function voteItem(p, now = Date.now()) {
  const name = (p.space?.name || p.space?.id || "Governance").replace(/\s*(DAO|Governance)$/i, "") || "Governance", title = short(String(p.title || "").trim());
  if (!title || PRICE_TALK.test(title) || !["active", "closed"].includes(p.state)) return null;
  const end = new Date((p.end || 0) * 1000), endTxt = end.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  let line;
  if (p.state === "active") line = `${name} vote open until ${endTxt}: “${title}”`;
  else {
    const scores = Array.isArray(p.scores) ? p.scores : [], total = p.scores_total || scores.reduce((a, x) => a + x, 0);
    const i = scores.length ? scores.indexOf(Math.max(...scores)) : -1;
    line = `${name} vote closed: “${title}”${total > 0 && i >= 0 && p.choices?.[i] ? ` · ${short(String(p.choices[i]), 30)} ${Math.round((scores[i] / total) * 100)}%` : ""}`;
  }
  const ts = new Date(((p.state === "active" ? p.start : p.end) || 0) * 1000).toISOString().slice(0, 19) + "Z";
  if (Date.parse(ts) > now + 864e5) return null;
  return { title: line, url: `https://snapshot.org/#/${p.space?.id}/proposal/${p.id}`, outlet: `${name} (Snapshot)`, community: true, date: ts.slice(0, 10), ts };
}

export async function snapshotVotes(tickers, { now = Date.now(), fetchFn = fetch, log = console.log } = {}) {
  const bySpace = new Map(tickers.flatMap((t) => (SPACES[t] || []).map((s) => [s, t])));
  if (!bySpace.size) return [];
  const query = `{ proposals(first: 60, where: { space_in: ${JSON.stringify([...bySpace.keys()])}, created_gte: ${Math.floor((now - 30 * 864e5) / 1000)} }, orderBy: "created", orderDirection: desc) { id title state start end choices scores scores_total space { id name } } }`;
  try {
    const r = await fetchFn("https://hub.snapshot.org/graphql", { method: "POST", headers: { "content-type": "application/json", "user-agent": "market-feed-pipeline/1.0" }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(r.status);
    const props = (await r.json())?.data?.proposals || [];
    const out = props.map((p) => { const it = voteItem(p, now); return it && { ...it, sym: `CRYPTO:${bySpace.get(p.space?.id)}` }; }).filter(Boolean);
    log(`community: ${out.length} Snapshot votes`);
    return out;
  } catch (e) { log(`community: Snapshot failed (${e.message})`); return []; }
}

// rss: the feed reader from news.mjs, passed in so this file has no other dependencies.
export async function forumTopics(t, rss) {
  const out = [];
  for (const [url, label] of FORUMS[t] || []) {
    for (const x of await rss(url, label, { days: 7 })) {
      if (!x.title || PRICE_TALK.test(x.title)) continue;
      out.push({ title: short(x.title, 140), url: x.url, outlet: label, community: true, date: x.date, ts: x.ts });
    }
  }
  return out.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, MAX_PER_COIN);
}
