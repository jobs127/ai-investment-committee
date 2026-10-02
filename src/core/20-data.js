/* Data layer: routes requests through the data gateway (browser) or directly (Node runner).
   Sources: SEC EDGAR (submissions, XBRL company facts, filings, Form 4, current feeds), Yahoo Finance chart API, Stooq fallback. */
(function (G) {
"use strict";
const AIC = G.AIC, U = AIC.util;
const D = AIC.data = {};

AIC.env = AIC.env || {gateway:"", token:"", userAgent:"", direct:false};
const memo = new Map();

class DataError extends Error { constructor(msg, code) { super(msg); this.code = code; } }
D.DataError = DataError;
D.available = () => !!(AIC.env.gateway || AIC.env.direct);

/* GET a URL as json or text. opts: {type:'json'|'text', strip:bool, max:number, ttl} */
D.get = async function (url, opts = {}) {
  const key = url + "|" + (opts.strip ? 1 : 0) + "|" + (opts.max || "");
  const hit = memo.get(key); if (hit && Date.now() - hit.at < 600000) return hit.p; // remembered for 10 minutes
  const p = (async () => {
    let res;
    if (AIC.env.gateway) {
      const g = AIC.env.gateway.replace(/\/+$/, "");
      const q = `${g}/fetch?url=${encodeURIComponent(url)}${opts.strip ? "&text=1" : ""}${opts.max ? "&max=" + opts.max : ""}`;
      res = await fetch(q, {headers: AIC.env.token ? {"x-aic-token": AIC.env.token} : {}, signal: opts.signal});
    } else if (AIC.env.direct) {
      res = await fetch(url, {headers: {"User-Agent": AIC.env.userAgent || "AI Investment Committee research@example.com", "Accept-Encoding": "gzip, deflate"}, signal: opts.signal});
    } else throw new DataError("No data gateway configured.", "no_gateway");
    if (!res.ok) throw new DataError(`HTTP ${res.status} for ${url.replace(/\?.*/, "")}`, "http_" + res.status);
    if (opts.type === "json") return await res.json();
    let t = await res.text();
    if (opts.strip && !AIC.env.gateway) t = U.stripHtml(t);
    if (opts.max && t.length > opts.max) t = t.slice(0, opts.max);
    return t;
  })();
  memo.set(key, {p, at: Date.now()});
  p.catch(() => memo.delete(key));
  return p;
};
D.clearMemo = () => memo.clear();

/* keyed social routes on the gateway (/reddit, /youtube). The GitHub runner reaches them through AIC.env.gwExtra. */
const gwBase = () => AIC.env.gateway ? {url: AIC.env.gateway, token: AIC.env.token} : AIC.env.gwExtra && AIC.env.gwExtra.url ? AIC.env.gwExtra : null;
D.gatewayRoute = async function (path, params, {signal} = {}) {
  const g = gwBase(); if (!g) throw new DataError("No gateway for " + path, "no_gateway");
  const qs = Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
  const res = await fetch(`${g.url.replace(/\/+$/, "")}${path}?${qs}`, {headers: g.token ? {"x-aic-token": g.token} : {}, signal});
  if (res.status === 501) throw new DataError("not set up", "not_setup");
  if (!res.ok) throw new DataError(`${path} ${res.status}`, "http_" + res.status);
  return res.json();
};
D.gatewayHealth = async function () { const g = gwBase(); if (!g) return null; try { return await (await fetch(g.url.replace(/\/+$/, "") + "/")).json(); } catch { return null; } };

/* ---------------- EDGAR ---------------- */
const pad10 = cik => String(cik).replace(/\D/g, "").padStart(10, "0");
D.secTicker = t => U.normTicker(t).replace(/\./g, "-");

D.tickerMap = async function () {
  if (D._tmap) return D._tmap;
  let raw = AIC.cacheGet && AIC.cacheGet("sec_tickers");
  if (!raw) { raw = await D.get("https://www.sec.gov/files/company_tickers.json", {type:"json"}); AIC.cacheSet && AIC.cacheSet("sec_tickers", raw, 7 * 864e5); }
  const byT = {}, byC = {};
  for (const k in raw) { const r = raw[k]; byT[r.ticker.toUpperCase()] = {cik: r.cik_str, title: r.title}; if (!byC[r.cik_str]) byC[r.cik_str] = r.ticker.toUpperCase(); }
  return (D._tmap = {byT, byC});
};
D.cikFor = async function (ticker) { const m = await D.tickerMap(); const r = m.byT[D.secTicker(ticker)]; return r ? r.cik : null; };

D.submissions = async cik => D.get(`https://data.sec.gov/submissions/CIK${pad10(cik)}.json`, {type:"json"});
D.companyFacts = async cik => D.get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad10(cik)}.json`, {type:"json"});
D.archiveUrl = (cik, acc, doc) => `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${String(acc).replace(/-/g, "")}/${doc}`;

D.recentFilings = function (sub) {
  const r = sub?.filings?.recent; if (!r || !r.form) return [];
  return r.form.map((f, i) => ({form: f, date: r.filingDate[i], reportDate: r.reportDate?.[i] || "", acc: r.accessionNumber[i],
    doc: r.primaryDocument?.[i] || "", items: r.items?.[i] || "", desc: r.primaryDocDescription?.[i] || ""}));
};

/* Form 4 */
D.parseForm4 = function (xml) {
  const owner = U.xmlVal(xml, "reportingOwner/reportingOwnerId/rptOwnerName");
  const rel = U.xmlOne(xml, "reportingOwnerRelationship");
  const isDir = /<isDirector>\s*(1|true)/i.test(rel), isOff = /<isOfficer>\s*(1|true)/i.test(rel), ten = /<isTenPercentOwner>\s*(1|true)/i.test(rel);
  const title = U.xmlVal(rel, "officerTitle");
  const plan = /<aff10b5One>\s*(1|true)/i.test(xml) || /10b5-1/i.test(U.xmlOne(xml, "footnotes"));
  const tx = U.xmlAll(xml, "nonDerivativeTransaction").map(t => ({
    date: U.xmlVal(t, "transactionDate/value"), code: U.xmlVal(t, "transactionCoding/transactionCode"),
    shares: +U.xmlVal(t, "transactionAmounts/transactionShares/value") || 0, price: +U.xmlVal(t, "transactionAmounts/transactionPricePerShare/value") || 0,
    ad: U.xmlVal(t, "transactionAmounts/transactionAcquiredDisposedCode/value"),
    after: +U.xmlVal(t, "postTransactionAmounts/sharesOwnedFollowingTransaction/value") || null
  }));
  return {owner, role: isOff ? (title || "Officer") : isDir ? "Director" : ten ? "10% owner" : "Other", plan, tx};
};
D.form4s = async function (cik, filings, maxN = 30, signal) {
  const cutoff = U.addDays(U.today(), -400);
  const list = filings.filter(f => f.form === "4" && f.date >= cutoff).slice(0, maxN);
  const out = await U.pmap(list, async f => {
    const doc = f.doc.replace(/^xsl[^/]*\//i, "");
    const xml = await D.get(D.archiveUrl(cik, f.acc, doc), {signal});
    return Object.assign(D.parseForm4(xml), {filed: f.date});
  }, 4);
  return out.filter(x => x && !x.__error);
};

/* Annual report text (for language-change diffs) */
D.annualReports = function (filings) {
  return filings.filter(f => /^(10-K|10-K405|20-F|40-F)$/.test(f.form)).slice(0, 2);
};
D.filingText = async (cik, f, signal) => D.get(D.archiveUrl(cik, f.acc, f.doc), {strip: true, max: 1500000, signal});

/* Current filings feed (Atom) — used by Discover */
D.currentFeed = async function (type, count = 40) {
  const xml = await D.get(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(type)}&company=&dateb=&owner=include&start=0&count=${count}&output=atom`);
  return U.xmlAll(xml, "entry").map(e => {
    const title = U.xmlOne(e, "title").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
    const href = (e.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || "";
    const updated = U.xmlOne(e, "updated").slice(0, 10);
    const m = title.match(/^(.*?) - (.*?) \((\d{6,10})\) \((\w+)\)/);
    return {title, href, updated, form: m ? m[1] : type, company: m ? m[2] : title, cik: m ? +m[3] : null, role: m ? m[4] : ""};
  });
};
D.filingIndex = async function (href) {
  const base = href.replace(/[^/]*$/, "");
  return D.get(base + "index.json", {type:"json"});
};

/* ---------------- Prices ---------------- */
D.yahooSymbol = t => U.normTicker(t).replace(/\.(?=[A-Z]$)/, "-"); // BRK.B -> BRK-B ; PKN.WA stays
D.prices = async function (ticker, range = "5y", signal) {
  const sym = D.yahooSymbol(ticker);
  try {
    const j = await D.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d&events=div,split`, {type:"json", signal});
    const r = j?.chart?.result?.[0]; if (!r || !r.timestamp) throw new DataError("no data", "empty");
    const q = r.indicators.quote[0], ac = r.indicators.adjclose?.[0]?.adjclose;
    const bars = [];
    r.timestamp.forEach((ts, i) => {
      if (q.close[i] == null) return;
      bars.push({t: new Date(ts * 1000).toISOString().slice(0, 10), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0, a: ac ? ac[i] : q.close[i]});
    });
    return {symbol: sym, currency: r.meta?.currency || "", exchange: r.meta?.exchangeName || "", name: r.meta?.longName || r.meta?.shortName || "", bars, source: "Yahoo Finance"};
  } catch (e) {
    if (/\./.test(sym) && !/-[A-Z]$/.test(sym)) throw e; // non-US: no stooq fallback mapping
    const csv = await D.get(`https://stooq.com/q/d/l/?s=${sym.toLowerCase()}.us&i=d`, {signal});
    const rows = csv.trim().split(/\r?\n/).slice(1).map(l => l.split(","));
    const bars = rows.filter(r => r.length >= 6 && +r[4]).map(r => ({t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] || 0, a: +r[4]}));
    if (!bars.length) throw e;
    const cut = U.addDays(U.today(), -365 * 5 - 10);
    return {symbol: sym, currency: "USD", exchange: "", name: "", bars: bars.filter(b => b.t >= cut), source: "Stooq"};
  }
};
D.lastPrice = async function (ticker) {
  const p = await D.prices(ticker, "5d"); const b = p.bars[p.bars.length - 1]; return b ? {price: b.c, date: b.t} : null;
};
})(typeof globalThis !== "undefined" ? globalThis : window);
