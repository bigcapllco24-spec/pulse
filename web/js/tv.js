// TradingView's free embeddable widgets for stocks, ETFs and indices. Their data licence covers the display,
// which keeps the app within free, compliant sources until licensed data or a user's own broker feed is added.
const SRC = "https://s3.tradingview.com/external-embedding/";

export function tvSymbol(s) {
  if (s.m === "CRYPTO") return s.t === "PAXG" ? "KRAKEN:PAXGUSD" : `KRAKEN:${s.t === "BTC" ? "XBT" : s.t}USD`;
  if (s.m === "INDEX") return s.t === "SENSEX" ? "BSE:SENSEX" : "NSE:" + s.t;
  if (s.m === "ARCA") return "AMEX:" + s.t;
  return s.m + ":" + s.t.replace(".", "_");
}
const theme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function mount(el, script, config) {
  el.querySelectorAll(".tradingview-widget-container").forEach((n) => n.remove());
  const box = document.createElement("div");
  box.className = "tradingview-widget-container";
  box.innerHTML = `<div class="tradingview-widget-container__widget" style="height:100%"></div>`;
  const s = document.createElement("script");
  s.src = SRC + script; s.async = true; s.textContent = JSON.stringify(config);
  box.appendChild(s);
  el.prepend(box);
}
export const unmount = (el) => el.querySelectorAll(".tradingview-widget-container").forEach((n) => n.remove());

const MA = { sma20: ["MASimple@tv-basicstudies", 20], sma50: ["MASimple@tv-basicstudies", 50], sma200: ["MASimple@tv-basicstudies", 200], ema20: ["MAExp@tv-basicstudies", 20], ema50: ["MAExp@tv-basicstudies", 50] };
const LOWER = { RSI: "RSI@tv-basicstudies", MACD: "MACD@tv-basicstudies", VOL: "Volume@tv-basicstudies" };
const RANGE = (chart) => (chart.interval === "1W" ? (chart.window <= 50 ? "12M" : "60M") : chart.window <= 20 ? "1M" : chart.window <= 50 ? "3M" : chart.window <= 100 ? "6M" : "12M");

export function quote(el, sym) {
  mount(el, "embed-widget-single-quote.js", { symbol: tvSymbol(sym), width: "100%", isTransparent: true, colorTheme: theme(), locale: "en" });
}
// Same settings as our own charts: window, interval, chart type, moving averages and lower panel.
export function chart(el, sym, c) {
  const studies = (c.mas || []).filter((k) => MA[k]).map((k) => ({ id: MA[k][0], inputs: { length: MA[k][1] } }));
  if (LOWER[c.lower]) studies.push(LOWER[c.lower]);
  mount(el, "embed-widget-advanced-chart.js", {
    symbol: tvSymbol(sym), interval: c.interval === "1W" ? "W" : "D", range: RANGE(c), timezone: "Etc/UTC", theme: theme(),
    style: c.type === "line" ? "2" : c.type === "area" ? "3" : "1", locale: "en", hide_top_toolbar: true, hide_side_toolbar: true, hide_legend: false,
    allow_symbol_change: false, save_image: false, calendar: false, studies, autosize: true, backgroundColor: "rgba(0,0,0,0)", support_host: "https://www.tradingview.com",
  });
}
export function profile(el, sym) {
  mount(el, "embed-widget-symbol-profile.js", { symbol: tvSymbol(sym), width: "100%", height: 340, isTransparent: true, colorTheme: theme(), locale: "en" });
}
export function financials(el, sym) {
  mount(el, "embed-widget-financials.js", { symbol: tvSymbol(sym), width: "100%", height: 480, isTransparent: true, colorTheme: theme(), displayMode: "regular", locale: "en" });
}
export function quotes(el, syms) {
  mount(el, "embed-widget-market-quotes.js", {
    width: "100%", height: 420, locale: "en", colorTheme: theme(), isTransparent: true, showSymbolLogo: true,
    symbolsGroups: [{ name: "Your stocks", symbols: syms.map((s) => ({ name: tvSymbol(s), displayName: s.t })) }],
  });
}
