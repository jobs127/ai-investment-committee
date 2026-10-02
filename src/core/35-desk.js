/* Data Desk (stage 0): assembles the fact sheet from primary data, entirely in code. */
(function (G) {
"use strict";
const AIC = G.AIC, U = AIC.util, D = AIC.data, C = AIC.compute;
const isN = U.isNum;

/* opts: {docs, settings, signal, onProgress(msg)} */
AIC.buildFactsheet = async function (ticker, opts = {}) {
  const st = opts.settings || AIC.DEFAULTS, say = opts.onProgress || (() => {});
  const fs = {ticker, builtAt: new Date().toISOString(), notes: [], sources: []};
  // uploaded transcripts work without a gateway
  fs.transcripts = C.transcriptAnalysis(opts.docs);
  if (!D.available()) {
    fs.status = "offline";
    fs.notes.push("No data gateway: primary-data fetches and computed metrics are off. Agents rely on web search.");
    fs.playbook = AIC.pickPlaybook(null, null);
    fs.leading = C.leadingSignals(fs);
    fs.markdown = C.factsheetMarkdown(fs);
    return fs;
  }
  fs.status = "partial";
  let cik = null, sub = null, facts = null, filings = [];
  try { say("Resolving SEC CIK…"); cik = await D.cikFor(ticker); } catch (e) { fs.notes.push("SEC ticker map unavailable: " + e.message); }
  if (cik) {
    try {
      say("Reading SEC submissions…"); sub = await D.submissions(cik); filings = D.recentFilings(sub);
      fs.company = {cik, name: sub.name, sic: sub.sic, sicDescription: sub.sicDescription, exchange: (sub.exchanges || [])[0] || "", fyEnd: sub.fiscalYearEnd ? sub.fiscalYearEnd.replace(/(\d\d)(\d\d)/, "$1-$2") : "", state: sub.stateOfIncorporation || "", category: sub.category || ""};
      fs.sources.push({title: "SEC EDGAR submissions", url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`});
    } catch (e) { fs.notes.push("Submissions: " + e.message); }
    try { say("Reading XBRL financials…"); facts = await D.companyFacts(cik); fs.fin = C.extractFinancials(facts); fs.sources.push({title: "SEC XBRL company facts", url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`}); }
    catch (e) { fs.notes.push("XBRL facts: " + e.message); }
  } else fs.notes.push("Not found in SEC's ticker list (foreign listing, ETF or fund): fundamentals from filings are unavailable.");

  fs.playbook = AIC.pickPlaybook(fs.company?.sic, fs.company?.sicDescription);
  fs.benchSymbol = "SPY";

  // prices
  let px = null, bench = null, sector = null;
  try {
    say("Loading price history…");
    [px, bench] = await Promise.all([D.prices(ticker, "5y", opts.signal), D.prices("SPY", "5y", opts.signal).catch(() => null)]);
    fs.currency = px.currency; fs.priceSource = px.source; if (!fs.company && px.name) fs.company = {name: px.name, exchange: px.exchange};
    fs.sources.push({title: px.source + " price history", url: `https://finance.yahoo.com/quote/${encodeURIComponent(px.symbol)}`});
    if (fs.playbook.etf && fs.playbook.etf !== "SPY") sector = await D.prices(fs.playbook.etf, "2y", opts.signal).catch(() => null);
  } catch (e) { fs.notes.push("Prices: " + e.message); }
  if (px && px.bars.length) {
    fs.tech = C.technicals(px.bars, bench?.bars);
    if (sector && fs.tech) { const t2 = C.technicals(px.bars.slice(-504), sector.bars); fs.tech.rsSector = t2 && t2.rs; fs.sectorEtf = fs.playbook.etf; }
    fs.bars = px.bars.slice(-520).map(b => [b.t, +b.o.toFixed(4), +b.h.toFixed(4), +b.l.toFixed(4), +b.c.toFixed(4), b.v]);
    fs.benchBars = bench ? bench.bars.slice(-520).map(b => [b.t, +b.c.toFixed(4)]) : null;
  }

  // fundamentals & valuation
  if (fs.fin && fs.fin.rows.length) {
    const rows = fs.fin.rows; fs.yearMetrics = C.yearMetrics(rows); fs.incRoic = C.incrementalRoic(fs.yearMetrics);
    fs.qGrowth = C.qGrowthSeries(fs.fin.quarters);
    const last = rows[rows.length - 1], prev = rows[rows.length - 2];
    const sh = fs.fin.sharesOutstanding;
    const shares = sh?.val || last.dilShares || null;
    fs.shareSource = sh?.val ? sh.source : last.dilShares ? "diluted weighted-average shares (XBRL)" : null;
    if (rows.some(r => r.daSuspect)) fs.notes.push("Depreciation & amortization looked mis-tagged in some years (far below capex), so it was left out of EBITDA and capex/D&A for those years.");
    AIC.valuate(fs, shares, fs.shareSource, st);
    if (!fs.valuation) fs.notes.push("Valuation pending: SEC filings don't give a single share count for this company (often a multi-class structure). The Data Scout's share count is used once it reports.");
    if (/^6[0-7]/.test(String(fs.company?.sic || ""))) fs.notes.push("Financial company: Altman Z, Beneish and ROIC are not meaningful; use the bank/insurance playbook KPIs.");
  }

  // filings-based signals
  if (cik && filings.length) {
    const earnDates = filings.filter(f => f.form === "8-K" && /2\.02/.test(f.items)).map(f => f.date).slice(0, 12);
    if (px && earnDates.length) fs.earnings = C.earningsReactions(px.bars, earnDates, bench?.bars);
    fs.nextFilingHint = earnDates[0] ? `Last earnings 8-K filed ${earnDates[0]}` : "";
    fs.activism = filings.filter(f => /^(SC 13D|SC 13G|SCHEDULE 13D|SCHEDULE 13G)/.test(f.form) && f.date >= U.addDays(U.today(), -365)).slice(0, 8).map(f => ({form: f.form, date: f.date}));
    try { say("Parsing insider Form 4 filings…"); const f4 = await D.form4s(cik, filings, 30, opts.signal); fs.insiders = C.insiderSummary(f4); }
    catch (e) { fs.notes.push("Form 4: " + e.message); }
    const ars = D.annualReports(filings);
    if (ars.length === 2) {
      try {
        say("Comparing the last two annual reports…");
        const [tNew, tOld] = await Promise.all([D.filingText(cik, ars[0], opts.signal), D.filingText(cik, ars[1], opts.signal)]);
        const d = {newDate: ars[0].date, oldDate: ars[1].date, form: ars[0].form,
          newUrl: D.archiveUrl(cik, ars[0].acc, ars[0].doc), oldUrl: D.archiveUrl(cik, ars[1].acc, ars[1].doc)};
        d.risk = C.diffSections(C.extractSection(tOld, "risk"), C.extractSection(tNew, "risk"));
        d.mdna = C.diffSections(C.extractSection(tOld, "mdna"), C.extractSection(tNew, "mdna"));
        if (d.risk || d.mdna) { fs.filingDiff = d; fs.sources.push({title: `${ars[0].form} filed ${ars[0].date}`, url: d.newUrl}); }
      } catch (e) { fs.notes.push("Filing diff: " + e.message); }
    }
    fs.recentFilings = filings.slice(0, 25).map(f => ({form: f.form, date: f.date, url: f.doc ? D.archiveUrl(cik, f.acc, f.doc) : "", items: f.items}));
  }
  fs.leading = C.leadingSignals(fs);
  fs.status = (fs.fin || fs.tech) ? "ok" : "partial";
  fs.markdown = C.factsheetMarkdown(fs);
  say("Data Desk complete.");
  return fs;
};
/* valuation from a share count; callable again after the Data Scout reports shares */
AIC.valuate = function (fs, shares, source, st) {
  st = st || AIC.DEFAULTS;
  if (!fs || !fs.fin || !fs.fin.rows.length) return false;
  const rows = fs.fin.rows, last = rows[rows.length - 1], prev = rows[rows.length - 2];
  const price = fs.tech?.price;
  const lat = fs.fin.latest;
  const debt = (() => { const l = k => lat[k]?.val; if (isN(l("ltdTotal"))) return l("ltdTotal") + (l("stb") || 0); const s = (l("ltdNon") || 0) + (l("ltdCur") || 0) + (l("stb") || 0); return s || last.debt || 0; })();
  const cash = lat.cash?.val ?? last.cash ?? 0;
  const q = fs.fin.quarters;
  const ttm = k => C.ttm(q, k) ?? last[k];
  const T = {revenue: ttm("revenue"), opInc: ttm("opInc"), netInc: ttm("netInc"), cfo: ttm("cfo"), capex: ttm("capex"), da: last.da, sbc: ttm("sbc") ?? last.sbc};
  const qda = C.ttm(q, "da"); if (isN(qda) && (!isN(T.da) || qda >= T.da * 0.5)) T.da = qda;
  T.fcf = isN(T.cfo) ? T.cfo - (T.capex || 0) : null; T.ebitda = isN(T.opInc) ? T.opInc + (T.da || 0) : null;
  fs.ttm = T;
  if (isN(price) && isN(shares) && shares > 0) {
    const mcap = price * shares, ev = mcap + debt - cash;
    fs.valuation = {price, shares, shareSource: source || "", marketCap: mcap, ev, debt, cash,
      pe: isN(T.netInc) && T.netInc > 0 ? mcap / T.netInc : null, evEbitda: isN(T.ebitda) && T.ebitda > 0 ? ev / T.ebitda : null,
      evSales: isN(T.revenue) && T.revenue > 0 ? ev / T.revenue : null, pFcf: isN(T.fcf) && T.fcf > 0 ? mcap / T.fcf : null,
      fcfYield: isN(T.fcf) ? T.fcf / mcap : null, fcfSbcYield: isN(T.fcf) ? (T.fcf - (T.sbc || 0)) / mcap : null,
      divYield: isN(last.div) ? last.div / mcap : null, buybackYield: isN(last.buyback) ? last.buyback / mcap : null};
    const bestFcfMargin = Math.max(0.05, ...(fs.yearMetrics || []).map(y => y.fcfMargin).filter(isN));
    fs.reverseDcf = C.reverseDCF({ev, fcf0: T.fcf, revenue0: T.revenue, r: (+st.discountRate || 9) / 100, g: (+st.terminalGrowth || 2.5) / 100, fcfMargin: Math.min(bestFcfMargin, 0.35)});
  }
  fs.quality = {piotroski: C.piotroski(last, prev), altman: C.altman(last, fs.valuation?.marketCap), beneish: C.beneish(last, prev)};
  return !!fs.valuation;
};
AIC.barsOf = fs => (fs && fs.bars) ? fs.bars.map(b => ({t: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5]})) : null;
})(typeof globalThis !== "undefined" ? globalThis : window);
