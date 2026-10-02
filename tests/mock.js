/* Test fixtures: synthetic SEC/Yahoo responses and a mock Anthropic streaming API.
   Used by tests/core.test.js (Node) and tests/e2e.js (Playwright). Numbers are synthetic, for testing only. */
"use strict";
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function bars(n, start, drift, vol, seedv) {
  seed = seedv; const out = []; let p = start; const d0 = new Date("2021-10-01");
  for (let i = 0, day = 0; out.length < n; day++) {
    const d = new Date(d0.getTime() + day * 864e5); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const r = drift + vol * (rnd() - 0.5) * 2; const o = p; p = Math.max(1, p * (1 + r));
    const h = Math.max(o, p) * (1 + rnd() * 0.01), l = Math.min(o, p) * (1 - rnd() * 0.01);
    out.push({t: Math.floor(d.getTime() / 1000) + 14 * 3600, o, h, l, c: p, v: Math.round(800000 + rnd() * 600000)}); i++;
  }
  return out;
}
function yahoo(sym) {
  const b = sym === "SPY" ? bars(1260, 430, 0.0004, 0.012, 11) : sym === "OIH" ? bars(504, 250, 0.0002, 0.018, 13) : bars(1260, 6.2, 0.0006, 0.025, 5);
  return {chart: {result: [{meta: {currency: "USD", exchangeName: "NYQ", longName: sym === "WTTR" ? "Select Water Solutions, Inc." : sym}, timestamp: b.map(x => x.t),
    indicators: {quote: [{open: b.map(x => x.o), high: b.map(x => x.h), low: b.map(x => x.l), close: b.map(x => x.c), volume: b.map(x => x.v)}], adjclose: [{adjclose: b.map(x => x.c)}]}}]}};
}
const fyEnds = ["2020-12-31", "2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"];
function companyFacts() {
  const rev = [600e6, 760e6, 1390e6, 1585e6, 1450e6, 1520e6];
  const A = (vals, extra = {}) => fyEnds.map((end, i) => Object.assign({start: (+end.slice(0, 4)) + "-01-01", end, val: vals[i], fy: +end.slice(0, 4), fp: "FY", form: "10-K", filed: (+end.slice(0, 4) + 1) + "-02-20"}, extra));
  const I = vals => fyEnds.map((end, i) => ({end, val: vals[i], fy: +end.slice(0, 4), fp: "FY", form: "10-K", filed: (+end.slice(0, 4) + 1) + "-02-20"}));
  const Q = (annual, shares) => { const out = []; [2024, 2025].forEach((y, k) => { const a = annual[4 + k]; [[`${y}-01-01`, `${y}-03-31`], [`${y}-04-01`, `${y}-06-30`], [`${y}-07-01`, `${y}-09-30`]].forEach(([s, e], q) => out.push({start: s, end: e, val: a * shares[q], fy: y, fp: "Q" + (q + 1), form: "10-Q", filed: e.slice(0, 7) + "-28"})); }); return out; };
  const qs = [0.24, 0.255, 0.25];
  const u = {
    Revenues: {units: {USD: A(rev).concat(Q(rev, qs))}},
    CostOfRevenue: {units: {USD: A(rev.map(r => r * 0.78))}},
    OperatingIncomeLoss: {units: {USD: A([-90e6, -40e6, 70e6, 110e6, 80e6, 105e6]).concat(Q([0, 0, 0, 0, 80e6, 105e6], qs))}},
    NetIncomeLoss: {units: {USD: A([-90e6, -60e6, 55e6, 95e6, 40e6, 70e6])}},
    IncomeTaxExpenseBenefit: {units: {USD: A([1e6, 1e6, 3e6, 10e6, 9e6, 14e6])}},
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: {units: {USD: A([-89e6, -59e6, 58e6, 105e6, 49e6, 84e6])}},
    NetCashProvidedByUsedInOperatingActivities: {units: {USD: A([60e6, 30e6, 140e6, 280e6, 245e6, 290e6])}},
    PaymentsToAcquirePropertyPlantAndEquipment: {units: {USD: A([25e6, 60e6, 150e6, 160e6, 190e6, 140e6])}},
    DepreciationDepletionAndAmortization: {units: {USD: A([140e6, 110e6, 130e6, 145e6, 150e6, 155e6])}},
    ShareBasedCompensation: {units: {USD: A([10e6, 12e6, 13e6, 16e6, 18e6, 19e6])}},
    InterestExpense: {units: {USD: A([1e6, 1e6, 3e6, 7e6, 14e6, 16e6])}},
    SellingGeneralAndAdministrativeExpense: {units: {USD: A([80e6, 90e6, 140e6, 160e6, 165e6, 170e6])}},
    PaymentsForRepurchaseOfCommonStock: {units: {USD: A([5e6, 5e6, 40e6, 55e6, 20e6, 25e6])}},
    PaymentsOfDividends: {units: {USD: A([0, 0, 15e6, 24e6, 28e6, 30e6])}},
    WeightedAverageNumberOfDilutedSharesOutstanding: {units: {shares: A([85e6, 86e6, 110e6, 112e6, 103e6, 104e6])}},
    EarningsPerShareDiluted: {units: {"USD/shares": A([-1.05, -0.7, 0.5, 0.85, 0.39, 0.67])}},
    AccountsReceivableNetCurrent: {units: {USD: I([130e6, 210e6, 380e6, 330e6, 300e6, 320e6])}},
    InventoryNet: {units: {USD: I([30e6, 35e6, 55e6, 52e6, 50e6, 49e6])}},
    AssetsCurrent: {units: {USD: I([350e6, 400e6, 520e6, 470e6, 430e6, 460e6])}},
    LiabilitiesCurrent: {units: {USD: I([120e6, 180e6, 260e6, 230e6, 220e6, 235e6])}},
    Assets: {units: {USD: I([800e6, 1000e6, 1300e6, 1290e6, 1500e6, 1560e6])}},
    Liabilities: {units: {USD: I([200e6, 300e6, 470e6, 420e6, 640e6, 660e6])}},
    StockholdersEquity: {units: {USD: I([600e6, 700e6, 830e6, 870e6, 860e6, 900e6])}},
    CashAndCashEquivalentsAtCarryingValue: {units: {USD: I([160e6, 50e6, 8e6, 57e6, 20e6, 30e6])}},
    LongTermDebt: {units: {USD: I([0, 0, 145e6, 85e6, 250e6, 260e6])}},
    RetainedEarningsAccumulatedDeficit: {units: {USD: I([-500e6, -560e6, -505e6, -410e6, -370e6, -300e6])}},
    PropertyPlantAndEquipmentNet: {units: {USD: I([280e6, 320e6, 420e6, 450e6, 600e6, 640e6])}}
  };
  return {cik: 1693256, entityName: "Select Water Solutions, Inc.", facts: {"us-gaap": u, dei: {EntityCommonStockSharesOutstanding: {units: {shares: [{end: "2026-04-25", val: 103.5e6, filed: "2026-05-01"}]}}}}};
}
function submissions() {
  const f = [];
  const add = (form, date, doc, items) => f.push({form, date, doc, items: items || "", acc: "0001693256-" + date.replace(/-/g, "").slice(2) + "-" + String(f.length).padStart(6, "0")});
  add("4", "2026-08-20", "xslF345X05/form4a.xml"); add("4", "2026-08-05", "xslF345X05/form4b.xml"); add("4", "2026-07-15", "xslF345X05/form4c.xml");
  add("8-K", "2026-08-01", "q2.htm", "2.02,9.01"); add("10-Q", "2026-08-01", "q.htm"); add("8-K", "2026-05-01", "q1.htm", "2.02,9.01");
  add("SC 13G", "2026-02-10", "g.htm"); add("10-K", "2026-02-20", "k2025.htm"); add("8-K", "2026-02-19", "q4.htm", "2.02,9.01");
  add("8-K", "2025-11-03", "q3.htm", "2.02,9.01"); add("8-K", "2025-07-31", "q2b.htm", "2.02,9.01"); add("10-K", "2025-02-21", "k2024.htm"); add("8-K", "2025-02-20", "q4b.htm", "2.02");
  return {cik: "1693256", name: "Select Water Solutions, Inc.", sic: "1389", sicDescription: "Oil & Gas Field Services, NEC", exchanges: ["NYSE"], fiscalYearEnd: "1231", stateOfIncorporation: "DE",
    filings: {recent: {form: f.map(x => x.form), filingDate: f.map(x => x.date), reportDate: f.map(() => ""), accessionNumber: f.map(x => x.acc), primaryDocument: f.map(x => x.doc), items: f.map(x => x.items), primaryDocDescription: f.map(() => "")}}};
}
function form4(owner, rel, code, date, shares, price, plan) {
  return `<?xml version="1.0"?><ownershipDocument><issuer><issuerCik>0001693256</issuerCik></issuer><reportingOwner><reportingOwnerId><rptOwnerName>${owner}</rptOwnerName></reportingOwnerId>
  <reportingOwnerRelationship>${rel}</reportingOwnerRelationship></reportingOwner>${plan ? "<aff10b5One>1</aff10b5One>" : ""}<nonDerivativeTable><nonDerivativeTransaction><transactionDate><value>${date}</value></transactionDate>
  <transactionCoding><transactionCode>${code}</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>${shares}</value></transactionShares><transactionPricePerShare><value>${price}</value></transactionPricePerShare>
  <transactionAcquiredDisposedCode><value>${code === "P" ? "A" : "D"}</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`;
}
const RISK_OLD = "Our business depends on the level of activity in the oil and gas industry. Demand for our services may decline if commodity prices fall. We rely on a limited number of customers for a significant portion of our revenue. Regulation of saltwater disposal could increase our costs. Seismic activity near disposal wells may lead to restrictions on injection volumes. Competition from other water service providers could reduce our margins. Our indebtedness could limit our flexibility.";
const RISK_NEW = RISK_OLD.replace("Competition from other water service providers could reduce our margins.", "Recent seismicity response actions by the Railroad Commission have materially reduced permitted injection volumes in parts of the Delaware Basin, and further reductions could impair the value of our disposal assets. We may be unable to obtain new disposal permits on acceptable terms.");
const tenK = risk => `<html><body><p>Table of contents Item 1A. Risk Factors 12 Item 1B. Unresolved Staff Comments 30</p><h2>Item 1A. Risk Factors</h2><p>${risk}</p><h2>Item 1B. Unresolved Staff Comments</h2><p>None.</p>
  <h2>Item 7. Management's Discussion and Analysis of Financial Condition</h2><p>Revenue increased due to higher water infrastructure volumes. Recycled water volumes grew as operators shifted away from freshwater. We expect capital expenditures to decline in the coming year as major projects complete.</p><h2>Item 7A. Quantitative</h2></body></html>`;
const atom = (form, entries) => `<?xml version="1.0"?><feed>${entries.map(e => `<entry><title>${form} - ${e.co} (${e.cik}) (${e.role})</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/${e.cik}/${e.acc}/${e.acc}-index.htm"/><updated>2026-09-30T16:00:00-04:00</updated></entry>`).join("")}</feed>`;

function fixtureFor(url) {
  const u = decodeURIComponent(url);
  if (u.includes("company_tickers.json")) return {json: {"0": {cik_str: 1693256, ticker: "WTTR", title: "Select Water Solutions, Inc."}, "1": {cik_str: 320193, ticker: "AAPL", title: "Apple Inc."}, "2": {cik_str: 111111, ticker: "SPIN", title: "SpinCo Holdings"}}};
  if (/submissions\/CIK0001693256/.test(u)) return {json: submissions()};
  if (/companyfacts\/CIK0001693256/.test(u)) return {json: companyFacts()};
  if (/form4a\.xml$/.test(u)) return {text: form4("Jane Director", "<isDirector>1</isDirector>", "P", "2026-08-18", 20000, 9.8)};
  if (/form4b\.xml$/.test(u)) return {text: form4("Bob Director", "<isDirector>1</isDirector>", "P", "2026-08-03", 15000, 10.2)};
  if (/form4c\.xml$/.test(u)) return {text: form4("Chris CFO", "<isOfficer>1</isOfficer><officerTitle>CFO</officerTitle>", "S", "2026-07-14", 30000, 11.1, true)};
  if (/k2025\.htm/.test(u)) return {text: tenK(RISK_NEW)};
  if (/k2024\.htm/.test(u)) return {text: tenK(RISK_OLD)};
  if (/chart\/(WTTR|SPY|OIH|XOM)/.test(u)) return {json: yahoo(u.match(/chart\/([A-Z]+)/)[1])};
  if (/getcurrent.*type=10-12B/.test(u)) return {text: atom("10-12B", [{co: "SpinCo Holdings", cik: "0000111111", acc: "000011111126000001", role: "Filer"}])};
  if (/getcurrent.*type=(SC%2013D|SC 13D)/.test(u)) return {text: atom("SC 13D", [{co: "Select Water Solutions, Inc.", cik: "0001693256", acc: "000169325626000099", role: "Subject"}])};
  if (/getcurrent.*type=4&/.test(u)) return {text: atom("4", [{co: "Select Water Solutions, Inc.", cik: "0001693256", acc: "000169325626000050", role: "Issuer"}])};
  if (/000169325626000050\/index\.json/.test(u)) return {json: {directory: {item: [{name: "xslF345X05/x.xml"}, {name: "form4a.xml"}]}}};
  if (/000169325626000050\/form4a\.xml/.test(u)) return {text: form4("Jane Director", "<isDirector>1</isDirector>", "P", "2026-09-29", 40000, 9.5)};
  return null;
}

/* ---------- mock Anthropic SSE ---------- */
const SEAT_DATA = {
  "DATA SCOUT": {summary: "Results beat; water infrastructure growing; data solid.", instrument_type: "stock", sector: "Oilfield services / water", price: 9.9, data_quality: "High", claims: [{text: "P/E is about 14x", metric: "pe_ttm", value: 14.2, source_type: "secondary", confidence: "medium"}, {text: "Q2 revenue beat consensus", source_type: "primary", source_url: "https://www.sec.gov/x", confidence: "high"}]},
  "MARKET EXPECTATIONS": {summary: "Price implies modest growth.", implied_growth_pct: 4.1, consensus_narrative: "A cyclical services company with a growing infrastructure arm.", what_must_be_true: ["Mid-single-digit FCF growth"], variant_hypotheses: ["Infrastructure mix shift is under-appreciated", "Seismic restrictions raise recycling pricing"]},
  "MACRO STRATEGIST": {summary: "Backdrop neutral.", score_macro: 6, drivers: [{driver: "Oil price", direction: "stable", impact: "high"}]},
  "INDUSTRY SPECIALIST": {summary: "Operators shifting to recycled water.", score_industry: 7, channel_signals: [{source: "customer", signal: "Large operator plans 60% recycled water", direction: "positive", as_of: "2026-08-01"}]},
  "SENTIMENT ANALYST": {summary: "Neglected; insiders buying.", score_sentiment: 7, crowding: "neglected", signals: [{signal: "Two directors bought in August", direction: "positive"}], claims: [{text: "P/E 19x", metric: "pe_ttm", value: 19.5, source_type: "secondary", confidence: "low"}]},
  "SCUTTLEBUTT": {summary: "Hiring for pipeline operators up.", score_scuttlebutt: 7, ground_signals: [{type: "hiring", observation: "Pipeline operator postings up 30% QoQ", direction: "positive", as_of: "2026-09-15"}]},
  "DATA HUNTER": {summary: "Normalized FCF supports value above price.", score_fundamentals: 7, intrinsic_low: 11, intrinsic_high: 15, situation_flags: ["Growth capex depressing FCF", "Acquisition amortization"]},
  "FORENSIC ACCOUNTANT": {summary: "Clean books.", score_quality: 7, earnings_quality: "Medium", red_flags: [{flag: "Rising receivables in 2022", severity: "low"}]},
  "MANAGEMENT & GOVERNANCE": {summary: "Founder-led, aligned.", score_management: 7, capital_allocation_grade: "B", alignment: "strong"},
  "THE CHARTIST": {summary: "Uptrend.", score_technicals: 6, trend: "uptrend", entry_low: 9.2, entry_high: 9.8, breakout: 11.2, invalidation: 8.4, support: [9.2, 8.4], resistance: [11.2]},
  "CATALYST HUNTER": {summary: "Q3 results and permit decisions.", catalysts: [{event: "Q3 earnings", date: "2026-11-02", type: "earnings", impact: "binary", probability_pct: 100}, {event: "RRC disposal permit ruling", date: "2026-12", type: "regulatory", impact: "positive", probability_pct: 60}]},
  "THE HISTORIAN": {summary: "Base rate favorable.", base_rate_description: "Small-cap OFS with FCF yield >10%", base_rate_pct: 58, analogs: [{name: "Example analog", period: "2017-2019", setup: "similar", outcome: "+40%"}]},
  "THE BULL": {summary: "Infrastructure re-rating.", upside_price: 16, upside_probability_pct: 30, horizon_months: 24, what_market_misses: "Recycling becomes the default as disposal is restricted."},
  "THE BEAR": {summary: "Cycle risk.", score_risk: 5, thesis_killer: "Permian activity falls 25%", drawdown_scenarios: [{name: "Activity bust", price: 6, loss_pct: -40, probability_pct: 20, mechanism: "rig count drop"}]},
  "DEVIL'S ADVOCATE": {summary: "Committee leans long on thin evidence.", critiques: [{target: "hunter", issue: "Intrinsic value assumes capex falls, unproven.", severity: "high"}, {target: "sent", issue: "P/E figure conflicts with Scout.", severity: "medium"}], blind_spot: "Customer consolidation", groupthink: "Everyone anchors on recycling", counter_thesis: "Margins peak as competitors add recycling capacity.", anchoring_detected: true},
  "REBUTTAL": {summary: "Defend.", stance: "defend", response: "Capex guidance in the 10-K supports the decline.", revised_score: 7},
  "THE CIO": {summary: "Accumulate.", verdict: "ACCUMULATE", conviction: "Medium", overall: 7, quality_score: 7, price_score: 7, scores: {macro: 6, fundamentals: 7, sentiment: 7, risk: 5, technicals: 6, management: 7}, score_reasoning: "Quality and price both above average; cyclical risk caps conviction.",
    rationale: "Test rationale.", thesis: "Infrastructure mix shift drives re-rating.", variant_view: "Market prices WTTR as a cyclical service company; we see a regulated-like infrastructure stream.", catalyst: {event: "RRC permit ruling", date: "2026-12"},
    scenarios: [{name: "bear", price: 6.5, probability: 0.25, horizon_months: 18, driver: "activity bust"}, {name: "base", price: 12.5, probability: 0.5, horizon_months: 18, driver: "steady"}, {name: "bull", price: 16, probability: 0.25, horizon_months: 18, driver: "re-rating"}],
    falsification: ["Infrastructure revenue growth below 5% for two quarters"], monitoring: [{item: "Q3 recycled volumes", date: "2026-11-02"}]},
  "PORTFOLIO MANAGER": {summary: "Scale in.", action: "Start a 2% position and add on pullbacks", position_pct_target: 4, position_pct_max: 6, tranches: [{low: 9.6, high: 10, pct: 40, trigger: "now"}, {low: 9.2, high: 9.4, pct: 30, trigger: "MA50"}, {low: 8.6, high: 8.8, pct: 30, trigger: "AVWAP"}],
    stop: {price: 8.1, type: "closing basis", rationale: "below invalidation"}, targets: [{price: 12.5, timeframe: "12 months"}, {price: 16, timeframe: "24 months"}], risk_reward: "1:1.5", alt_entry: {strategy: "cash-secured put", strike: 9, expiry: "60 days", rationale: "paid to wait"},
    review_trigger: "After Q3 results", alerts: [{type: "price_below", value: "8.1", note: "stop"}], tax_note: "New lot", liquidity_note: "Under 1% of ADV"}
};
/* Builds the mock assistant message for a Messages API request body (used for streaming and batch). */
function anthropicMessage(body) {
  const task = body.messages[0].content.map(c => c.text || "").join("\n");
  const sys = (body.system || []).map ? (body.system || []).map(x => x.text || "").join("") : String(body.system || "");
  const m = task.match(/YOUR SEAT: ([A-Z' &]+?) —/) || task.match(/REBUTTAL — you are ([A-Z' &]+?) \(/);
  let key = m ? m[1].trim() : null; if (/=== REBUTTAL/.test(task)) key = "REBUTTAL";
  const isAsk = /=== QUESTION FOR/.test(task), isIdeas = /idea hunter/.test(task), isCompare = /Rank these candidates/.test(task), isThesis = /Check whether this investment thesis/.test(task);
  const isDigest = /^Digest this document/.test(task), isRepair = /convert investment-committee reports into JSON/.test(sys);
  const content = []; let idx = 0;
  const hasSearch = body.tools && body.tools.some(t => t.name === "web_search");
  if (hasSearch) {
    content.push({type: "server_tool_use", id: "s0", name: "web_search", input: {query: (key || "q") + " latest"}});
    content.push({type: "web_search_tool_result", tool_use_id: "s0", content: [{type: "web_search_result", url: "https://example.com/" + (key || "q").replace(/\W/g, ""), title: "Example source"}]});
  }
  let data = null, text = "";
  const al = task.match(/ALERT SENTINEL: ([A-Z&' ]+?) — (\S+)/), ad = task.match(/ALERT DESK — (\S+)/);
  if (al) { const nm = al[1].trim(), t = al[2]; const slug = nm.toLowerCase().replace(/\W+/g, "-");
    data = nm === "PODCASTS & INTERVIEWS" ? {summary: "Nothing new.", nothing_new: true, items: []} : {summary: nm + " found items.", nothing_new: false, items: [
      {title: `${t} ${nm.toLowerCase()} item one`, summary: "Something happened with a number: 12%.", url: `https://example.com/${slug}/${t}/1`, source: nm === "SOCIAL CHATTER" ? "r/stocks" : "Reuters", date: "2026-09-30", kind: "news", sentiment: "positive", importance: nm === "ANALYST CHANGES" ? 4 : 3, reputable: nm !== "SOCIAL CHATTER"},
      {title: `${t} duplicate of item one`, summary: "Same event elsewhere.", url: `https://example.org/${slug}/${t}/dup`, source: "Yahoo", date: "2026-09-30", kind: "news", sentiment: "positive", importance: 2, reputable: true}],
      ...(nm === "SOCIAL CHATTER" ? {buzz: "elevated", tone: "bullish"} : {})};
    text = `- ${nm}: mock findings for ${t}`; }
  else if (ad) { const lines = task.split("\n"), refs = []; lines.forEach((l, k) => { const m = l.match(/^\[(\d+)\]/); if (m) refs.push({i: +m[1], dup: /duplicate/.test(lines[k + 1] || "")}); });
    data = {headline: `${ad[1]}: analyst upgrade and new contract news.`, mood: "positive", items: refs.filter(r => !r.dup).map(r => r.i).map((i, k) => ({ref: i, also: refs.some(r => r.i === i + 1 && r.dup) ? [i + 1] : [], title: "Edited headline " + i, why: "Matters because of the recycling thesis.", importance: k === 0 ? 4 : 3, thesis_hit: k === 0 ? "Monitor: recycling contracts" : "", novelty: "new", sentiment: "positive"}))};
    text = "Two things matter today."; }
  else if (isDigest) text = "DIGEST: water volumes 820→905 MMbbl; revenue 1520→1610.";
  else if (isRepair) text = "```json\n" + JSON.stringify({summary: "repaired", score_fundamentals: 7, intrinsic_low: 11, intrinsic_high: 15}) + "\n```";
  else if (isIdeas) { text = "Ideas found."; data = {summary: "ideas", ideas: [{ticker: "WTTR", name: "Select Water Solutions", situation: "Capex cliff", why_overlooked: "Classified as oilfield services", leading_signal: "Recycling contracts", catalyst: "Q3", key_risk: "Activity"}]}; }
  else if (isCompare) { text = "WTTR ranks first."; data = {summary: "rank", ranking: [{ticker: "WTTR", rank: 1, reason: "Best EV"}, {ticker: "XOM", rank: 2, reason: "Lower upside"}]}; }
  else if (isThesis) { text = "Thesis intact."; data = {summary: "ok", status: "intact", kill_checks: [{criterion: "Infrastructure revenue growth below 5% for two quarters", status: "not_triggered", evidence: "Q2 +12%"}], catalyst_updates: [{event: "RRC disposal permit ruling", update: "Hearing scheduled"}]}; }
  else if (isAsk) text = "Because normalized free cash flow supports it.";
  else { text = `## ${key || "Report"}\n\nThis is a **mock report** for testing.\n\n| Metric | Value |\n|---|---|\n| Price | 9.90 |\n\n- point one\n- point two`; data = SEAT_DATA[key] || {summary: "ok"}; }
  // the Data Hunter "forgets" its JSON block to exercise the cheap repair path
  if (data && key !== "DATA HUNTER") text += "\n\n```json\n" + JSON.stringify(data) + "\n```";
  content.push({type: "text", text, ...(hasSearch ? {citations: [{type: "web_search_result_location", url: "https://example.com/cite", title: "Cited source"}]} : {})});
  return {id: "msg_" + Math.random().toString(36).slice(2), type: "message", role: "assistant", model: body.model, content, stop_reason: "end_turn",
    usage: {input_tokens: 2400, cache_read_input_tokens: 1800, cache_creation_input_tokens: 600, output_tokens: 700, server_tool_use: {web_search_requests: hasSearch ? 1 : 0}}};
}
function anthropicSSE(body) {
  const msg = anthropicMessage(body);
  const ev = [{type: "message_start", message: {usage: {input_tokens: msg.usage.input_tokens, cache_read_input_tokens: msg.usage.cache_read_input_tokens, cache_creation_input_tokens: msg.usage.cache_creation_input_tokens}}}];
  msg.content.forEach((b, i) => {
    if (b.type === "server_tool_use") ev.push({type: "content_block_start", index: i, content_block: {type: "server_tool_use", id: b.id, name: b.name, input: {}}}, {type: "content_block_delta", index: i, delta: {type: "input_json_delta", partial_json: JSON.stringify(b.input)}}, {type: "content_block_stop", index: i});
    else if (b.type === "text") { ev.push({type: "content_block_start", index: i, content_block: {type: "text", text: ""}}); for (const ch of b.text.match(/[\s\S]{1,30}/g)) ev.push({type: "content_block_delta", index: i, delta: {type: "text_delta", text: ch}}); (b.citations || []).forEach(c => ev.push({type: "content_block_delta", index: i, delta: {type: "citations_delta", citation: c}})); ev.push({type: "content_block_stop", index: i}); }
    else ev.push({type: "content_block_start", index: i, content_block: b}, {type: "content_block_stop", index: i});
  });
  ev.push({type: "message_delta", delta: {stop_reason: msg.stop_reason}, usage: {output_tokens: msg.usage.output_tokens, server_tool_use: msg.usage.server_tool_use}}, {type: "message_stop"});
  return ev.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}
/* Mock Message Batches API: batches end after `polls` status checks */
function batchMock(polls = 1, stateFile = null) {
  const fs = require("fs"); let batches = new Map(), n = 0;
  if (stateFile && fs.existsSync(stateFile)) { const d = JSON.parse(fs.readFileSync(stateFile, "utf8")); batches = new Map(d.b); n = d.n; }
  const persist = () => stateFile && fs.writeFileSync(stateFile, JSON.stringify({b: [...batches], n})); const stats = {created: 0, requests: 0, cancels: 0};
  return {stats, handle(method, path, bodyText) {
    try { return this._h(method, path, bodyText); } finally { persist(); }
  }, _h(method, path, bodyText) {
    let m;
    if (method === "POST" && /\/v1\/messages\/batches$/.test(path)) {
      const body = JSON.parse(bodyText); const id = "msgbatch_" + (++n) + (stateFile ? "_" + Date.now() : "");
      batches.set(id, {left: polls, results: body.requests.map(r => ({custom_id: r.custom_id, result: {type: "succeeded", message: anthropicMessage(r.params)}}))});
      stats.created++; stats.requests += body.requests.length;
      return {status: 200, json: {id, processing_status: "in_progress", request_counts: {processing: body.requests.length}}};
    }
    if ((m = path.match(/\/v1\/messages\/batches\/([^/]+)\/cancel$/))) { stats.cancels++; return {status: 200, json: {id: m[1], processing_status: "canceling"}}; }
    if ((m = path.match(/\/v1\/messages\/batches\/([^/]+)\/results$/))) return {status: 200, text: batches.get(m[1]).results.map(r => JSON.stringify(r)).join("\n")};
    if ((m = path.match(/\/v1\/messages\/batches\/([^/]+)$/))) { const b = batches.get(m[1]); const ended = b.left-- <= 0;
      return {status: 200, json: {id: m[1], processing_status: ended ? "ended" : "in_progress", request_counts: {}, results_url: ended ? `https://api.anthropic.com/v1/messages/batches/${m[1]}/results` : null}}; }
    return null;
  }};
}
SEAT_DATA["MARKET SCOUT"] = {summary: "Consensus Hold, PT 13; short interest 6%.", consensus_rating: "Hold", price_target_mean: 13, analyst_count: 7, short_interest_pct: 6.1, peers: [{ticker: "AESI", pe: 14, ev_ebitda: 6.1}], claims: [{text: "Short interest 6.1% of float", metric: "short_interest_pct", value: 6.1, source_type: "secondary", source_url: "https://example.com/si", confidence: "medium"}]};
SEAT_DATA["FIELD SCOUT"] = {summary: "Operators shifting to recycled water.", catalysts: [{event: "Q3 earnings", date: "2026-11-02", impact: "binary"}]};
SEAT_DATA["SCREENER"] = {summary: "Worth a look.", score_screen: 7, call: "PROMISING", reasons: ["Capex cliff"], questions: ["Durability of recycling pricing?"]};

module.exports = {fixtureFor, anthropicSSE, anthropicMessage, batchMock, SEAT_DATA};
