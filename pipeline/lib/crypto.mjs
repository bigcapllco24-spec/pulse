// Coin candles from Kraken's free public API, with CoinGecko's price as a cross-check.
const KRAKEN_PAIR = { BTC: "XBTUSD", DOGE: "XDGUSD", RNDR: "RENDERUSD" };
const GECKO = { BTC: "bitcoin", ETH: "ethereum", XRP: "ripple", SOL: "solana", ADA: "cardano", DOGE: "dogecoin", DOT: "polkadot", LTC: "litecoin",
  LINK: "chainlink", AVAX: "avalanche-2", TRX: "tron", XLM: "stellar", BCH: "bitcoin-cash", ATOM: "cosmos", UNI: "uniswap", AAVE: "aave", NEAR: "near",
  ALGO: "algorand", FIL: "filecoin", ETC: "ethereum-classic", SHIB: "shiba-inu", PEPE: "pepe", SUI: "sui", APT: "aptos", ARB: "arbitrum", OP: "optimism",
  POL: "polygon-ecosystem-token", HBAR: "hedera-hashgraph", ICP: "internet-computer", INJ: "injective-protocol", TON: "the-open-network", XMR: "monero",
  MKR: "maker", CRV: "curve-dao-token", LDO: "lido-dao", RNDR: "render-token", GRT: "the-graph", SAND: "the-sandbox", MANA: "decentraland",
  AXS: "axie-infinity", USDT: "tether", USDC: "usd-coin", PAXG: "pax-gold", TRUMP: "official-trump", WIF: "dogwifcoin", BONK: "bonk",
  SEI: "sei-network", TIA: "celestia", ENA: "ethena", ONDO: "ondo-finance" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kraken(t) {
  const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${KRAKEN_PAIR[t] || t + "USD"}&interval=1440`);
  const j = await r.json();
  if (j.error?.length) throw new Error(j.error.join(", "));
  const rows = Object.entries(j.result).find(([k]) => k !== "last")?.[1] || [];
  // [time, open, high, low, close, vwap, volume, count]; the last row is today's bar, still forming.
  return rows.slice(-300).map((x) => [new Date(x[0] * 1000).toISOString().slice(0, 10), +x[1], +x[2], +x[3], +x[4], +x[6]]);
}

async function gecko(tickers) {
  const ids = tickers.map((t) => GECKO[t]).filter(Boolean);
  if (!ids.length) return {};
  const key = process.env.COINGECKO_DEMO_KEY;
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`, { headers: key ? { "x-cg-demo-api-key": key } : {} });
  if (!r.ok) return {};
  const j = await r.json();
  return Object.fromEntries(tickers.filter((t) => j[GECKO[t]]?.usd).map((t) => [t, j[GECKO[t]].usd]));
}

// → { "CRYPTO:BTC": { source, bars: [[date, o, h, l, c, v], ...], check } }
export async function fetchCrypto(tickers, { log = console.log } = {}) {
  const out = {};
  const cg = await gecko(tickers).catch(() => ({}));
  for (const t of tickers) {
    try {
      const bars = await kraken(t);
      if (bars.length < 30) throw new Error("too little history");
      const last = bars[bars.length - 1][4], ref = cg[t];
      out["CRYPTO:" + t] = { source: "Kraken", bars, check: ref ? { coingecko: ref, gapPct: ((last - ref) / ref) * 100 } : null };
      log(`crypto ${t}: ${bars.length} bars, last ${last}`);
    } catch (e) { log(`crypto ${t} skipped: ${e.message}`); }
    await sleep(1100); // about one call a second, as Kraken asks
  }
  return out;
}
