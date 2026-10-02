/* Features beyond a single run: idea discovery, peer comparison, thesis checks, track record, evals. */
(function (G) {
"use strict";
const AIC = G.AIC, U = AIC.util, D = AIC.data, C = AIC.compute, E = AIC.engine, P = AIC.prompts, PL = AIC.pipeline;
const F = AIC.features = {};
const isN = U.isNum;

/* ---------- Discover: EDGAR feeds ---------- */
F.spinoffs = async () => (await D.currentFeed("10-12B", 40)).concat(await D.currentFeed("10-12G", 20).catch(() => []))
  .filter(e => e.role === "Filer").map(e => ({...e, kind: "Spin-off / new registration"}));
F.activism = async () => {
  const a = await D.currentFeed("SC 13D", 60).catch(() => []);
  const b = await D.currentFeed("SCHEDULE 13D", 60).catch(() => []);
  return a.concat(b).filter(e => e.role === "Subject").map(e => ({...e, kind: "Activist / 13D stake"}));
};
F.insiderBuys = async function (count = 60, onProgress) {
  const feed = (await D.currentFeed("4", count)).filter(e => e.role === "Issuer");
  const map = await D.tickerMap().catch(() => null);
  const seen = new Set(); const list = feed.filter(e => { const k = e.href; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
  let done = 0;
  const parsed = await U.pmap(list, async e => {
    const idx = await D.filingIndex(e.href);
    const item = (idx.directory?.item || []).find(i => /\.xml$/i.test(i.name) && !/^xsl/i.test(i.name));
    if (!item) return null;
    const xml = await D.get(e.href.replace(/[^/]*$/, "") + item.name);
    onProgress && onProgress(++done, list.length);
    return Object.assign(D.parseForm4(xml), {issuer: e.company, cik: e.cik});
  }, 4);
  const by = {};
  parsed.filter(x => x && !x.__error).forEach(f => f.tx.filter(t => t.code === "P").forEach(t => {
    const k = f.cik; by[k] = by[k] || {cik: k, issuer: f.issuer, ticker: map?.byC[k] || "", buyers: new Set(), value: 0, last: ""};
    by[k].buyers.add(f.owner + " (" + f.role + ")"); by[k].value += t.shares * t.price; if (t.date > by[k].last) by[k].last = t.date;
  }));
  return Object.values(by).filter(x => x.value >= 25000).map(x => ({...x, buyers: [...x.buyers], kind: x.buyers.size > 1 ? "Insider buying cluster" : "Insider open-market buy"})).sort((a, b) => b.value - a.value);
};

/* ---------- Discover: LLM idea hunter ---------- */
F.SITUATIONS = ["Neglected / low analyst coverage","Inflection: margins or growth turning","Hidden assets / sum-of-the-parts","Cyclical trough earnings","Spin-off or post-reorganization equity","Business-model transition","Regulatory overhang about to resolve","Capex cliff: FCF about to inflect","Insider buying clusters","Acquisition amortization hiding cash earnings"];
F.ideaHunt = async function ({focus, situations, cap, engine, settings, apiKey, signal, onText, onSearch, member}) {
  const task = `You are the fund's idea hunter. Find up to 8 listed companies that conventional screens are likely to miss or misjudge, in these situations: ${(situations && situations.length ? situations : F.SITUATIONS).join("; ")}.
${focus ? "Focus: " + focus + "." : ""} ${cap ? "Market-cap range: " + cap + "." : ""} ${member ? "Member expertise to lean on: " + member + "." : ""}
For each: ticker, name, the situation, why it is overlooked or mis-screened, the leading signal that suggests the puck is moving, a dated catalyst if any, and the key risk. Prefer evidence from primary sources (filings, permits, contracts, insider Form 4s, 13Ds). Avoid mega-caps and crowded names. Write a short Markdown list, then the JSON block.`;
  return E.call({engine, settings, apiKey, model: settings.plan === "max" ? (settings.judgeModel || settings.model) : (settings.analystModel || settings.model), system: `Today is ${U.longDate()}. You find investment ideas the crowd has not priced yet. Be specific and verifiable. Never invent tickers.`,
    blocks: [], task, schemaKey: "ideas", maxUses: engine === "api" && +settings.searchDepth ? Math.max(4, Math.round(10 * settings.searchDepth)) : 0, signal, onText, onSearch});
};

/* ---------- Compare ---------- */
F.compareRow = function (run) {
  const fs = run.factsheet || {}, v = fs.valuation || {}, y = (fs.yearMetrics || []).slice(-1)[0] || {}, c = run.cio || {};
  return {ticker: run.ticker, date: run.createdAt, verdict: c.verdict, overall: c.overall, quality: c.quality_score, price: c.price_score, conviction: c.conviction,
    expReturn: run.evm?.expReturn, implied: fs.reverseDcf?.impliedGrowth, revGrowth: y.revGrowth, opMargin: y.opMargin, fcfYield: v.fcfYield, roic: y.roic,
    ndEbitda: y.netDebtEbitda, rs6: fs.tech?.rs?.m6, pe: v.pe, piotroski: fs.quality?.piotroski?.score, thesis: c.thesis, variant: c.variant_view};
};
F.compareJudge = async function (runs, {engine, settings, apiKey, signal, onText, profile}) {
  const rows = runs.map(F.compareRow);
  const brief = runs.map(r => `## ${r.ticker}\nVerdict ${r.cio?.verdict} · overall ${r.cio?.overall} · quality ${r.cio?.quality_score} · price ${r.cio?.price_score} · expected return ${U.pct(r.evm?.expReturn)}\nThesis: ${r.cio?.thesis || ""}\nVariant view: ${r.cio?.variant_view || ""}\nBear thesis killer: ${r.reports.bear?.data?.thesis_killer || ""}\nKey metrics: ${JSON.stringify(F.compareRow(r))}`).join("\n\n");
  const task = `Rank these candidates for the investor profile below, as the fund's CIO allocating one new position. Weigh expected return, quality, the strength of the variant view, catalyst timing and risk. Then give the JSON block.\nInvestor profile: ${P.profileText(profile)}\n\n${brief}`;
  const out = await E.call({engine, settings, apiKey, model: settings.judgeModel || settings.model, system: `Today is ${U.longDate()}. You are the CIO comparing committee outputs.`, blocks: [], task, schemaKey: "compare", maxUses: 0, signal, onText});
  return {rows, text: out.text, ranking: out.data?.ranking || [], usage: out.usage};
};

/* ---------- Thesis tracker ---------- */
F.thesisFromRun = function (run) {
  const c = run.cio || {}, cat = run.reports.catalyst?.data?.catalysts || [];
  return {id: run.ticker, ticker: run.ticker, runId: run.id, createdAt: run.createdAt, verdict: c.verdict, thesis: c.thesis || "", variant: c.variant_view || "",
    catalysts: [c.catalyst && c.catalyst.event ? {event: c.catalyst.event, date: c.catalyst.date || "", done: false} : null].concat(cat.map(x => ({event: x.event, date: x.date, impact: x.impact, done: false}))).filter(Boolean).slice(0, 10),
    kill: (c.falsification || []).map(k => ({criterion: k, status: "not_triggered", evidence: ""})).concat(run.reports.bear?.data?.thesis_killer ? [{criterion: "Bear's thesis killer: " + run.reports.bear.data.thesis_killer, status: "not_triggered", evidence: ""}] : []),
    monitoring: c.monitoring || [], status: "intact", notes: "", checks: []};
};
F.checkThesis = async function (th, {engine, settings, apiKey, signal, onText}) {
  const task = `Check whether this investment thesis on ${th.ticker} still holds as of today. Search for news, filings and results since ${new Date(th.createdAt).toISOString().slice(0, 10)}.
Thesis: ${th.thesis}
Variant view: ${th.variant}
Kill criteria:\n${th.kill.map((k, i) => `${i + 1}. ${k.criterion}`).join("\n")}
Catalysts:\n${th.catalysts.map(c => `- ${c.event} (${c.date})`).join("\n")}
For each kill criterion, give a status (not_triggered, watch or triggered) with evidence. Give an update on each catalyst. Give an overall status: intact, weakening or broken. Write a short Markdown summary, then the JSON block.`;
  return E.call({engine, settings, apiKey, model: settings.plan === "max" ? (settings.judgeModel || settings.model) : (settings.analystModel || settings.model), system: `Today is ${U.longDate()}. You monitor theses for a fund. Be factual and cite sources.`, blocks: [], task, schemaKey: "thesis",
    maxUses: engine === "api" && +settings.searchDepth ? 4 : 0, signal, onText});
};

/* ---------- Track record ---------- */
F.trackEntry = function (run) {
  const scores = {}; run.seats.forEach(id => { const s = PL.seatScore(id, run.reports[id]?.data); if (isN(s)) scores[id] = s; });
  const fs = run.factsheet || {};
  return {runId: run.id, ticker: run.ticker, date: (fs.tech?.date) || new Date(run.createdAt).toISOString().slice(0, 10), price: PL.priceOf(run),
    verdict: run.cio?.verdict || null, overall: run.cio?.overall ?? null, quality: run.cio?.quality_score ?? null, priceScore: run.cio?.price_score ?? null,
    expReturn: run.evm?.expReturn ?? null, seatScores: scores, sector: run.playbook?.name || "", mode: run.mode, promptVersion: run.promptVersion, ret: null, rets: {}};
};
F.updateTrack = async function (entries, onProgress) {
  const bench = await D.prices("SPY", "5y").catch(() => null);
  let i = 0;
  for (const e of entries) {
    onProgress && onProgress(++i, entries.length, e.ticker);
    if (!isN(e.price)) continue;
    try {
      const px = await D.prices(e.ticker, "5y");
      e.rets = {};
      for (const m of [3, 6, 12]) { const r = C.forwardReturn(e, px.bars, bench?.bars, m); if (r) e.rets["m" + m] = r; }
      const last = px.bars[px.bars.length - 1];
      let ex = null; if (bench) { const b0 = bench.bars.find(x => x.t >= e.date), b1 = bench.bars[bench.bars.length - 1]; if (b0) ex = (last.c / e.price - 1) - (b1.c / b0.c - 1); }
      e.now = {price: last.c, date: last.t, r: last.c / e.price - 1, excess: ex};
      e.ret = e.rets.m6 || e.rets.m3 || null; // matured return used for calibration (3m minimum)
      e.updated = U.today();
    } catch (err) { e.error = err.message; }
  }
  return entries;
};
F.manualMark = function (e, price, date) {
  e.now = {price, date: date || U.today(), r: price / e.price - 1, excess: null};
  if (U.daysBetween(e.date, e.now.date) >= 90) e.ret = {r: e.now.r, excess: null, date: e.now.date, manual: true};
  return e;
};

/* ---------- Evals (Lab) ---------- */
F.evalSummary = function (run) {
  const L = run.ledger || C.ledger(run), u = run.usage || PL.totalUsage(run);
  const words = Object.values(run.reports).reduce((s, r) => s + ((r.text || "").split(/\s+/).length), 0);
  const cites = Object.values(run.reports).reduce((s, r) => s + (r.sources || []).length, 0);
  return {ticker: run.ticker, verdict: run.cio?.verdict, overall: run.cio?.overall, quality: run.cio?.quality_score, priceScore: run.cio?.price_score,
    expReturn: run.evm?.expReturn, contradictions: L.contradictions.length, uncited: Object.values(L.uncited).reduce((a, b) => a + b, 0), claims: L.claims.length,
    primaryShare: L.primaryShare, citations: cites, words, inTok: u?.in || 0, outTok: u?.out || 0, searches: u?.searches || 0,
    cost: run.cost ?? (u ? u.cost : null), plan: run.plan, ms: Object.values(run.reports).reduce((s, r) => s + (r.ms || 0), 0), consistencyFlags: (run.consistency || []).length, status: run.status};
};
F.evalDiff = function (a, b) {
  const tick = [...new Set(a.results.map(r => r.ticker).concat(b.results.map(r => r.ticker)))];
  return tick.map(t => { const x = a.results.find(r => r.ticker === t) || {}, y = b.results.find(r => r.ticker === t) || {};
    return {ticker: t, a: x, b: y, verdictChanged: x.verdict !== y.verdict, scoreDelta: isN(x.overall) && isN(y.overall) ? y.overall - x.overall : null}; });
};
})(typeof globalThis !== "undefined" ? globalThis : window);
