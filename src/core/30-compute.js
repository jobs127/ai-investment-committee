/* Computations done in code, not by the model: financial series from XBRL, ratios, quality scores,
   reverse DCF, technicals, insider analysis, filing-language diffs, transcript tone, leading signals,
   evidence-ledger contradictions, expected-value math, position sizing, calibration. */
(function (G) {
"use strict";
const AIC = G.AIC, U = AIC.util;
const C = AIC.compute = {};
const isN = U.isNum;

/* ======================= XBRL → series ======================= */
const CONCEPTS = {
  revenue:["Revenues","RevenueFromContractWithCustomerExcludingAssessedTax","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueNet","RevenuesNetOfInterestExpense","SalesRevenueGoodsNet","SalesRevenueServicesNet"],
  cogs:["CostOfRevenue","CostOfGoodsAndServicesSold","CostOfGoodsSold","CostOfServices"],
  gross:["GrossProfit"],
  opInc:["OperatingIncomeLoss"],
  netInc:["NetIncomeLoss","ProfitLoss","NetIncomeLossAvailableToCommonStockholdersBasic"],
  pretax:["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest","IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
  tax:["IncomeTaxExpenseBenefit"],
  cfo:["NetCashProvidedByUsedInOperatingActivities","NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex:["PaymentsToAcquirePropertyPlantAndEquipment","PaymentsToAcquireProductiveAssets","PaymentsForCapitalImprovements","PaymentsToAcquireOilAndGasPropertyAndEquipment"],
  da:["DepreciationDepletionAndAmortization","DepreciationAmortizationAndAccretionNet","DepreciationAndAmortization","DepreciationAccretionAndAmortization","DepreciationDepletionAndAmortizationPropertyPlantAndEquipment","Depreciation","CostDepreciationAmortizationAndDepletion"],
  sbc:["ShareBasedCompensation","AllocatedShareBasedCompensationExpense"],
  interest:["InterestExpense","InterestExpenseNonoperating","InterestExpenseDebt","InterestPaidNet"],
  sga:["SellingGeneralAndAdministrativeExpense","GeneralAndAdministrativeExpense"],
  buyback:["PaymentsForRepurchaseOfCommonStock"],
  div:["PaymentsOfDividends","PaymentsOfDividendsCommonStock"],
  acq:["PaymentsToAcquireBusinessesNetOfCashAcquired"],
  amort:["AmortizationOfIntangibleAssets"],
  dilShares:["WeightedAverageNumberOfDilutedSharesOutstanding","WeightedAverageNumberOfSharesOutstandingBasic"],
  eps:["EarningsPerShareDiluted","EarningsPerShareBasicAndDiluted"],
  // instants
  ar:["AccountsReceivableNetCurrent","ReceivablesNetCurrent"],
  inv:["InventoryNet"],
  ca:["AssetsCurrent"], cl:["LiabilitiesCurrent"], ta:["Assets"], tl:["Liabilities"],
  equity:["StockholdersEquity","StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  cash:["CashAndCashEquivalentsAtCarryingValue","CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents","Cash"],
  ltdTotal:["LongTermDebt"], ltdNon:["LongTermDebtNoncurrent","LongTermDebtAndCapitalLeaseObligations"], ltdCur:["LongTermDebtCurrent","DebtCurrent","LongTermDebtAndCapitalLeaseObligationsCurrent"], stb:["ShortTermBorrowings","CommercialPaper"],
  re:["RetainedEarningsAccumulatedDeficit"], ppe:["PropertyPlantAndEquipmentNet"],
  defRev:["ContractWithCustomerLiabilityCurrent","DeferredRevenueCurrent","ContractWithCustomerLiability","DeferredRevenue"],
  rpo:["RevenueRemainingPerformanceObligation"],
  goodwill:["Goodwill"], intang:["IntangibleAssetsNetExcludingGoodwill","FiniteLivedIntangibleAssetsNet"]
};
const INSTANT = new Set(["ar","inv","ca","cl","ta","tl","equity","cash","ltdTotal","ltdNon","ltdCur","stb","re","ppe","defRev","rpo","goodwill","intang"]);
const UNITS = {dilShares:"shares", eps:"USD/shares"};

function factsFor(facts, names, unit) {
  const tax = facts?.facts?.["us-gaap"] || {}, ifrs = facts?.facts?.["ifrs-full"] || {};
  const out = [];
  names.forEach((n, pri) => {
    const f = tax[n] || ifrs[n]; if (!f || !f.units) return;
    const arr = f.units[unit] || (unit === "USD" ? Object.values(f.units)[0] : null) || [];
    for (const e of arr) out.push(Object.assign({pri, concept: n}, e));
  });
  return out;
}
const durDays = e => e.start ? U.daysBetween(e.start, e.end) : 0;
function bestBy(list, keyFn) {
  const m = new Map();
  for (const e of list) {
    const k = keyFn(e); const cur = m.get(k);
    if (!cur || e.pri < cur.pri || (e.pri === cur.pri && (e.filed || "") > (cur.filed || ""))) m.set(k, e);
  }
  return m;
}

const MAXAGG = new Set(["da"]);
function maxBy(list, keyFn) { // largest value per period, newest filing wins ties
  const m = new Map();
  for (const e of list) { const k = keyFn(e); const cur = m.get(k); if (!cur || e.val > cur.val || (e.val === cur.val && (e.filed || "") > (cur.filed || ""))) m.set(k, e); }
  return m;
}
C.extractFinancials = function (facts) {
  if (!facts || !facts.facts) return null;
  const currencyUnit = (() => { const r = factsFor(facts, CONCEPTS.revenue, "USD"); return r.length ? "USD" : null; })();
  const unitOf = k => UNITS[k] || "USD";
  const annual = {}, quarterly = {}, instants = {};
  for (const k in CONCEPTS) {
    const list = factsFor(facts, CONCEPTS[k], unitOf(k));
    if (INSTANT.has(k)) { instants[k] = bestBy(list, e => e.end); continue; }
    const pick = MAXAGG.has(k) ? maxBy : bestBy;
    annual[k] = pick(list.filter(e => { const d = durDays(e); return d > 330 && d < 400; }), e => e.end);
    quarterly[k] = pick(list.filter(e => { const d = durDays(e); return d > 75 && d < 105; }), e => e.end);
  }
  // fiscal-year ends from revenue, else net income
  const fyKey = annual.revenue.size ? "revenue" : "netInc";
  const fyEnds = [...annual[fyKey].keys()].sort().slice(-7);
  const val = (map, end) => { const e = map && map.get(end); return e ? e.val : null; };
  const rows = fyEnds.map(end => {
    const r = {end, fy: end.slice(0, 4)};
    for (const k in CONCEPTS) r[k] = INSTANT.has(k) ? val(instants[k], end) : val(annual[k], end);
    return r;
  });
  rows.forEach(finishRow);
  // quarterly with derived Q4
  const qEnds = new Set();
  for (const k of ["revenue","opInc","netInc","cfo","capex","eps"]) for (const e of (quarterly[k] || new Map()).keys()) qEnds.add(e);
  const qrows = {};
  [...qEnds].sort().forEach(end => { const r = {end}; for (const k of ["revenue","gross","cogs","opInc","netInc","cfo","capex","da","sbc","eps","dilShares","interest"]) r[k] = val(quarterly[k], end); qrows[end] = r; });
  // derive Q4 = FY - (Q1+Q2+Q3)
  for (const end of fyEnds) {
    const aStart = annual[fyKey].get(end)?.start; if (!aStart) continue;
    if (qrows[end] && qrows[end].revenue != null) continue;
    const qs = Object.values(qrows).filter(q => q.end > aStart && q.end < end);
    if (qs.length !== 3) continue;
    const r = {end, derived: true};
    for (const k of ["revenue","gross","cogs","opInc","netInc","cfo","capex","da","sbc","interest"]) {
      const a = val(annual[k], end); r[k] = (a != null && qs.every(q => q[k] != null)) ? a - qs.reduce((s, q) => s + q[k], 0) : null;
    }
    r.eps = null; qrows[end] = r;
  }
  const qlist = Object.values(qrows).sort((a, b) => a.end < b.end ? -1 : 1).slice(-12);
  qlist.forEach(q => { if (q.gross == null && q.revenue != null && q.cogs != null) q.gross = q.revenue - q.cogs; });
  // latest instants (for most recent balance sheet)
  const latestInst = {};
  for (const k of INSTANT) { const m = instants[k]; if (m && m.size) { const end = [...m.keys()].sort().pop(); latestInst[k] = {val: m.get(end).val, end}; } }
  const dei = facts.facts.dei || {}, gaap = facts.facts["us-gaap"] || {};
  const latestOf = arr => arr && arr.length ? arr.slice().sort((a, b) => (a.end + (a.filed || "")) < (b.end + (b.filed || "")) ? -1 : 1).pop() : null;
  // share count: dei cover-page count (summed across classes when reported per class), then balance-sheet, then weighted averages
  let sharesOut = null;
  const so = dei.EntityCommonStockSharesOutstanding?.units?.shares || [];
  if (so.length) { const lastE = latestOf(so); const same = so.filter(x => x.end === lastE.end && x.accn === lastE.accn); sharesOut = {val: same.reduce((t, x) => t + x.val, 0), end: lastE.end, source: "cover-page shares outstanding (SEC)" + (same.length > 1 ? ", all classes" : "")}; }
  const tryInst = (concept, label) => { if (sharesOut) return; const a = gaap[concept]?.units?.shares; const e = latestOf(a); if (e && e.val > 0 && U.daysBetween(e.end, U.today()) < 500) sharesOut = {val: e.val, end: e.end, source: label}; };
  tryInst("CommonStockSharesOutstanding", "balance-sheet shares outstanding (SEC)");
  const tryDur = (concept, label) => { if (sharesOut) return; const a = (gaap[concept]?.units?.shares || []).filter(x => { const d = durDays(x); return d > 75 && d < 400; }); const e = latestOf(a); if (e && e.val > 0 && U.daysBetween(e.end, U.today()) < 500) sharesOut = {val: e.val, end: e.end, source: label}; };
  tryDur("WeightedAverageNumberOfDilutedSharesOutstanding", "diluted weighted-average shares (SEC)");
  tryDur("WeightedAverageNumberOfSharesOutstandingBasic", "basic weighted-average shares (SEC)");
  return {rows, quarters: qlist, latest: latestInst, sharesOutstanding: sharesOut, currency: currencyUnit || "USD", entity: facts.entityName};
};
function finishRow(r) {
  if (isN(r.da) && isN(r.capex) && isN(r.revenue) && r.revenue > 0 && r.da < 0.01 * r.revenue && r.capex > 15 * r.da) { r.daSuspect = true; r.da = null; }
  if (r.gross == null && r.revenue != null && r.cogs != null) r.gross = r.revenue - r.cogs;
  r.debt = r.ltdTotal != null ? r.ltdTotal + (r.stb || 0) : (r.ltdNon != null || r.ltdCur != null || r.stb != null) ? (r.ltdNon || 0) + (r.ltdCur || 0) + (r.stb || 0) : null;
  r.fcf = r.cfo != null && r.capex != null ? r.cfo - r.capex : (r.cfo != null ? r.cfo : null);
  r.ebitda = r.opInc != null ? r.opInc + (r.da || 0) : null;
}

/* ======================= metrics ======================= */
const div = (a, b) => isN(a) && isN(b) && b !== 0 ? a / b : null;
const growth = (a, b) => isN(a) && isN(b) && b > 0 ? a / b - 1 : null;
const avg2 = (a, b) => isN(a) && isN(b) ? (a + b) / 2 : (isN(a) ? a : b);

C.yearMetrics = function (rows) {
  return rows.map((r, i) => {
    const p = rows[i - 1] || {};
    const taxRate = U.clamp(isN(div(r.tax, r.pretax)) ? div(r.tax, r.pretax) : 0.21, 0, 0.35);
    const nopat = isN(r.opInc) ? r.opInc * (1 - taxRate) : null;
    const ic = isN(r.equity) ? r.equity + (r.debt || 0) - (r.cash || 0) : null;
    const icPrev = isN(p.equity) ? p.equity + (p.debt || 0) - (p.cash || 0) : null;
    return {
      fy: r.fy, end: r.end,
      revenue: r.revenue, revGrowth: growth(r.revenue, p.revenue),
      grossMargin: div(r.gross, r.revenue), opMargin: div(r.opInc, r.revenue), netMargin: div(r.netInc, r.revenue),
      fcf: r.fcf, fcfMargin: div(r.fcf, r.revenue), sbcPct: div(r.sbc, r.revenue), fcfAfterSbc: isN(r.fcf) ? r.fcf - (r.sbc || 0) : null,
      nopat, investedCapital: ic, roic: isN(nopat) && isN(ic) && ic > 0 ? nopat / avg2(ic, icPrev) : null,
      accruals: isN(r.netInc) && isN(r.cfo) && isN(r.ta) ? (r.netInc - r.cfo) / avg2(r.ta, p.ta) : null,
      dso: isN(r.ar) && isN(r.revenue) && r.revenue > 0 ? r.ar / r.revenue * 365 : null,
      dio: isN(r.inv) && isN(r.cogs) && r.cogs > 0 ? r.inv / r.cogs * 365 : null,
      capexToDA: div(r.capex, r.da), cashConversion: isN(r.netInc) && r.netInc > 0 ? div(r.cfo, r.netInc) : null,
      netDebtEbitda: isN(r.ebitda) && r.ebitda > 0 ? ((r.debt || 0) - (r.cash || 0)) / r.ebitda : null,
      interestCoverage: isN(r.interest) && r.interest > 0 ? div(r.opInc, r.interest) : null,
      shareChange: growth(r.dilShares, p.dilShares),
      defRevGrowth: growth(r.defRev, p.defRev), rpoGrowth: growth(r.rpo, p.rpo),
      arGrowth: growth(r.ar, p.ar), invGrowth: growth(r.inv, p.inv)
    };
  });
};
C.incrementalRoic = function (ym, years = 3) {
  if (ym.length < years + 1) return null;
  const a = ym[ym.length - 1 - years], b = ym[ym.length - 1];
  const dN = isN(b.nopat) && isN(a.nopat) ? b.nopat - a.nopat : null, dI = isN(b.investedCapital) && isN(a.investedCapital) ? b.investedCapital - a.investedCapital : null;
  return isN(dN) && isN(dI) && dI > 0 ? dN / dI : null;
};
C.ttm = function (quarters, key) {
  const q = quarters.filter(x => isN(x[key])); if (q.length < 4) return null;
  const last4 = q.slice(-4); if (U.daysBetween(last4[0].end, last4[3].end) > 300) return null;
  return last4.reduce((s, x) => s + x[key], 0);
};
C.qGrowthSeries = function (quarters, key = "revenue") {
  const out = [];
  for (let i = 0; i < quarters.length; i++) {
    const q = quarters[i]; if (!isN(q[key])) continue;
    const prior = quarters.find(p => Math.abs(U.daysBetween(p.end, q.end) - 365) < 25);
    if (prior && isN(prior[key]) && prior[key] > 0) out.push({end: q.end, g: q[key] / prior[key] - 1});
  }
  return out;
};

/* ======================= quality scores ======================= */
C.piotroski = function (r, p) {
  if (!r || !p) return null;
  const roa = div(r.netInc, r.ta), roaP = div(p.netInc, p.ta);
  const tests = [
    ["ROA positive", isN(roa) ? roa > 0 : null],
    ["Operating cash flow positive", isN(r.cfo) ? r.cfo > 0 : null],
    ["ROA improving", isN(roa) && isN(roaP) ? roa > roaP : null],
    ["Cash flow exceeds net income", isN(r.cfo) && isN(r.netInc) ? r.cfo > r.netInc : null],
    ["Leverage falling", isN(r.debt) && isN(p.debt) && isN(r.ta) && isN(p.ta) ? r.debt / r.ta <= p.debt / p.ta : null],
    ["Current ratio improving", isN(r.ca) && isN(r.cl) && isN(p.ca) && isN(p.cl) ? r.ca / r.cl > p.ca / p.cl : null],
    ["No share dilution", isN(r.dilShares) && isN(p.dilShares) ? r.dilShares <= p.dilShares * 1.005 : null],
    ["Gross margin improving", isN(div(r.gross, r.revenue)) && isN(div(p.gross, p.revenue)) ? r.gross / r.revenue > p.gross / p.revenue : null],
    ["Asset turnover improving", isN(r.revenue) && isN(r.ta) && isN(p.revenue) && isN(p.ta) ? r.revenue / r.ta > p.revenue / p.ta : null]
  ];
  const avail = tests.filter(t => t[1] !== null);
  return {score: avail.filter(t => t[1]).length, of: avail.length, tests};
};
C.altman = function (r, mcap) {
  if (!r || !isN(r.ta) || r.ta <= 0) return null;
  const wc = isN(r.ca) && isN(r.cl) ? r.ca - r.cl : null;
  const parts = [wc != null ? 1.2 * wc / r.ta : null, isN(r.re) ? 1.4 * r.re / r.ta : null, isN(r.opInc) ? 3.3 * r.opInc / r.ta : null,
    isN(mcap) && isN(r.tl) && r.tl > 0 ? 0.6 * mcap / r.tl : null, isN(r.revenue) ? 1.0 * r.revenue / r.ta : null];
  if (parts.some(x => x === null)) return {z: null, partial: true};
  const z = parts.reduce((s, x) => s + x, 0);
  return {z, zone: z > 2.99 ? "safe" : z > 1.81 ? "grey" : "distress"};
};
C.beneish = function (r, p) {
  if (!r || !p || !isN(r.revenue) || !isN(p.revenue) || !isN(r.ta) || !isN(p.ta)) return null;
  const missing = [];
  const v = (name, x, dflt) => { if (isN(x) && isFinite(x)) return x; missing.push(name); return dflt; };
  const DSRI = v("DSRI", div(div(r.ar, r.revenue), div(p.ar, p.revenue)), 1);
  const GMI = v("GMI", div(div(p.gross, p.revenue), div(r.gross, r.revenue)), 1);
  const aq = x => isN(x.ca) && isN(x.ppe) ? 1 - (x.ca + x.ppe) / x.ta : null;
  const AQI = v("AQI", div(aq(r), aq(p)), 1);
  const SGI = v("SGI", div(r.revenue, p.revenue), 1);
  const dep = x => isN(x.da) && isN(x.ppe) ? x.da / (x.da + x.ppe) : null;
  const DEPI = v("DEPI", div(dep(p), dep(r)), 1);
  const SGAI = v("SGAI", div(div(r.sga, r.revenue), div(p.sga, p.revenue)), 1);
  const lev = x => isN(x.cl) ? (x.cl + (x.ltdNon || x.ltdTotal || 0)) / x.ta : null;
  const LVGI = v("LVGI", div(lev(r), lev(p)), 1);
  const TATA = v("TATA", isN(r.netInc) && isN(r.cfo) ? (r.netInc - r.cfo) / r.ta : null, 0);
  const m = -4.84 + 0.92 * DSRI + 0.528 * GMI + 0.404 * AQI + 0.892 * SGI + 0.115 * DEPI - 0.172 * SGAI + 4.679 * TATA - 0.327 * LVGI;
  return {m, flag: m > -1.78, missing, parts: {DSRI, GMI, AQI, SGI, DEPI, SGAI, LVGI, TATA}};
};

/* ======================= reverse DCF ======================= */
C.reverseDCF = function ({ev, fcf0, revenue0, r = 0.09, g = 0.025, years = 10, fcfMargin}) {
  if (!isN(ev) || ev <= 0) return null;
  const pv = (G_, base) => { let s = 0, f = base; for (let t = 1; t <= years; t++) { f *= (1 + G_); s += f / Math.pow(1 + r, t); } const tv = f * (1 + g) / (r - g); return s + tv / Math.pow(1 + r, years); };
  let method, base;
  if (isN(fcf0) && fcf0 > 0) { method = "FCF"; base = fcf0; }
  else if (isN(revenue0) && revenue0 > 0) { method = "revenue at " + Math.round((fcfMargin || 0.1) * 100) + "% steady-state FCF margin"; base = revenue0 * (fcfMargin || 0.1); }
  else return null;
  let lo = -0.5, hi = 1.0;
  if (pv(hi, base) < ev) return {impliedGrowth: null, method, note: "Price implies more than 100% annual growth", r, g, years};
  if (pv(lo, base) > ev) return {impliedGrowth: lo, method, note: "Price implies shrinking cash flows", r, g, years};
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (pv(mid, base) > ev) hi = mid; else lo = mid; }
  const ig = (lo + hi) / 2;
  return {impliedGrowth: ig, method, r, g, years, impliedFcfYear10: base * Math.pow(1 + ig, years)};
};

/* ======================= technicals ======================= */
const sma = (a, n, i) => { if (i < n - 1) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += a[k]; return s / n; };
function emaSeries(a, n) { const k = 2 / (n + 1); const out = []; let e = null; a.forEach((x, i) => { e = e == null ? x : x * k + e * (1 - k); out.push(i >= n - 1 ? e : null); }); return out; }
C.rsi = function (closes, n = 14) {
  if (closes.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
};
C.mfi = function (bars, n = 14) {
  if (bars.length < n + 1) return null;
  let pos = 0, neg = 0;
  for (let i = bars.length - n; i < bars.length; i++) {
    const tp = (bars[i].h + bars[i].l + bars[i].c) / 3, tpp = (bars[i - 1].h + bars[i - 1].l + bars[i - 1].c) / 3, mf = tp * bars[i].v;
    if (tp > tpp) pos += mf; else if (tp < tpp) neg += mf;
  }
  return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
};
C.atr = function (bars, n = 14) {
  if (bars.length < n + 1) return null;
  const tr = []; for (let i = 1; i < bars.length; i++) { const b = bars[i], p = bars[i - 1]; tr.push(Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c))); }
  let a = U.mean(tr.slice(0, n)); for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n; return a;
};
C.technicals = function (bars, bench) {
  if (!bars || bars.length < 60) return null;
  const c = bars.map(b => b.c), n = c.length - 1, last = bars[n];
  const ma = k => sma(c, k, n), maAgo = (k, ago) => sma(c, k, n - ago);
  const ret = d => n - d >= 0 ? c[n] / c[n - d] - 1 : null;
  const macdL = (() => { const e12 = emaSeries(c, 12), e26 = emaSeries(c, 26); const m = c.map((_, i) => e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null); const valid = m.filter(x => x != null); const sig = emaSeries(valid, 9); return {macd: m[n], signal: sig[sig.length - 1], hist: m[n] - sig[sig.length - 1]}; })();
  const yr = bars.slice(-252);
  const hi = yr.reduce((a, b) => b.h > a.h ? b : a, yr[0]), lo = yr.reduce((a, b) => b.l < a.l ? b : a, yr[0]);
  const up = lo.t < hi.t; // swing direction: low then high = up-swing
  const range = hi.h - lo.l;
  const fib = [0.236, 0.382, 0.5, 0.618, 0.786].map(f => ({level: f, price: up ? hi.h - range * f : lo.l + range * f}));
  const vol = (() => { const r = []; for (let i = n - 59; i <= n; i++) if (i > 0) r.push(Math.log(c[i] / c[i - 1])); return U.stdev(r) * Math.sqrt(252); })();
  // OBV slope over 50d, normalized by avg volume
  let obv = 0; const obvS = []; for (let i = 1; i <= n; i++) { obv += c[i] > c[i - 1] ? bars[i].v : c[i] < c[i - 1] ? -bars[i].v : 0; obvS.push(obv); }
  const avgVol50 = U.mean(bars.slice(-50).map(b => b.v)), avgVol20 = U.mean(bars.slice(-20).map(b => b.v));
  const obvSlope = avgVol50 ? (obvS[obvS.length - 1] - obvS[obvS.length - 51]) / (avgVol50 * 50) : null;
  let upV = 0, dnV = 0; for (let i = n - 49; i <= n; i++) { if (c[i] > c[i - 1]) upV += bars[i].v; else if (c[i] < c[i - 1]) dnV += bars[i].v; }
  const avwap = fromIdx => { let pv = 0, vv = 0; for (let i = fromIdx; i <= n; i++) { const tp = (bars[i].h + bars[i].l + bars[i].c) / 3; pv += tp * bars[i].v; vv += bars[i].v; } return vv ? pv / vv : null; };
  const loIdx = bars.indexOf(lo), hiIdx = bars.indexOf(hi);
  const ma50 = ma(50), ma200 = ma(200), ma20 = ma(20);
  // crosses in last 60 days
  let cross = null;
  for (let i = n - 60; i <= n; i++) { if (i < 201) continue; const a = sma(c, 50, i) - sma(c, 200, i), b = sma(c, 50, i - 1) - sma(c, 200, i - 1); if (a > 0 && b <= 0) cross = {type: "golden cross", date: bars[i].t}; if (a < 0 && b >= 0) cross = {type: "death cross", date: bars[i].t}; }
  const regime = ma200 == null ? "insufficient history" : (last.c > ma200 && ma50 > ma200 ? "uptrend" : last.c < ma200 && ma50 < ma200 ? "downtrend" : "transition");
  // relative strength vs benchmark
  let rs = null;
  if (bench && bench.length > 60) {
    const bm = new Map(bench.map(b => [b.t, b.a || b.c]));
    const rel = d => { const i = n - d; if (i < 0) return null; const b0 = bm.get(bars[i].t), b1 = bm.get(last.t); if (!b0 || !b1) return null; return ((bars[n].a || c[n]) / (bars[i].a || c[i])) / (b1 / b0) - 1; };
    rs = {m3: rel(63), m6: rel(126), m12: rel(252)};
  }
  // seasonality: average return by calendar month (5y)
  const months = {};
  const monthly = []; let prevM = bars[0].t.slice(0, 7), startC = c[0];
  for (let i = 1; i <= n; i++) { const m = bars[i].t.slice(0, 7); if (m !== prevM) { monthly.push({m: prevM, r: c[i - 1] / startC - 1}); startC = c[i - 1]; prevM = m; } }
  monthly.forEach(x => { const k = x.m.slice(5); (months[k] = months[k] || []).push(x.r); });
  const seasonality = Object.keys(months).sort().map(k => ({month: +k, avg: U.mean(months[k]), n: months[k].length}));
  return {
    price: last.c, date: last.t, ma20, ma50, ma200,
    ma50Slope: ma50 && maAgo(50, 20) ? ma50 / maAgo(50, 20) - 1 : null, ma200Slope: ma200 && maAgo(200, 20) ? ma200 / maAgo(200, 20) - 1 : null,
    rsi14: C.rsi(c.slice(-300)), mfi14: C.mfi(bars), macd: macdL, atr14: C.atr(bars.slice(-300)), vol60: vol,
    high52: hi.h, high52Date: hi.t, low52: lo.l, low52Date: lo.t, fromHigh: last.c / hi.h - 1, fromLow: last.c / lo.l - 1,
    ret: {m1: ret(21), m3: ret(63), m6: ret(126), y1: ret(252)},
    fib: {direction: up ? "up-swing (low→high)" : "down-swing (high→low)", swingLow: lo.l, swingHigh: hi.h, levels: fib},
    obvSlope, upDownVol: dnV ? upV / dnV : null, avgVol20, adv20: avgVol20 * last.c, volVs50: avgVol50 ? avgVol20 / avgVol50 : null,
    avwapFromLow: avwap(loIdx), avwapFromHigh: avwap(hiIdx), cross, regime, rs, seasonality
  };
};
C.earningsReactions = function (bars, dates, bench) {
  if (!bars || !dates || !dates.length) return null;
  const idx = new Map(bars.map((b, i) => [b.t, i])); const bm = bench ? new Map(bench.map(b => [b.t, b.c])) : null;
  const out = [];
  for (const d of dates.slice(0, 12)) {
    let i = idx.get(d); if (i == null) { const k = bars.findIndex(b => b.t >= d); if (k < 0) continue; i = k; }
    if (i < 1 || i + 20 >= bars.length) continue;
    const day = bars[i + 1] ? bars[i + 1].c / bars[i - 1].c - 1 : null; // filing often after close → next day reaction
    let drift = bars[i + 20].c / bars[i + 1].c - 1;
    if (bm) { const b0 = bm.get(bars[i + 1].t), b1 = bm.get(bars[i + 20].t); if (b0 && b1) drift -= (b1 / b0 - 1); }
    out.push({date: d, reaction: day, drift20: drift});
  }
  return out.length ? {events: out, avgReaction: U.mean(out.map(x => x.reaction)), avgAbsReaction: U.mean(out.map(x => Math.abs(x.reaction))), avgDrift: U.mean(out.map(x => x.drift20)),
    driftFollows: U.mean(out.map(x => Math.sign(x.reaction) === Math.sign(x.drift20) ? 1 : 0))} : null;
};

/* ======================= insiders ======================= */
C.insiderSummary = function (forms) {
  if (!forms || !forms.length) return null;
  const tx = [];
  forms.forEach(f => f.tx.forEach(t => tx.push(Object.assign({owner: f.owner, role: f.role, plan: f.plan}, t))));
  const buys = tx.filter(t => t.code === "P"), sells = tx.filter(t => t.code === "S");
  const val = a => a.reduce((s, t) => s + t.shares * t.price, 0);
  // routine: 10b5-1 flagged, or same owner traded in the same calendar month in an earlier year
  const byOwner = {}; tx.forEach(t => (byOwner[t.owner] = byOwner[t.owner] || []).push(t));
  const routine = t => t.plan || (byOwner[t.owner] || []).some(o => o !== t && o.date.slice(5, 7) === t.date.slice(5, 7) && o.date.slice(0, 4) < t.date.slice(0, 4));
  const oppBuys = buys.filter(t => !routine(t)), oppSells = sells.filter(t => !routine(t));
  // clusters: >=2 distinct insiders buying within 30 days
  const clusters = [];
  const sb = buys.slice().sort((a, b) => a.date < b.date ? -1 : 1);
  for (let i = 0; i < sb.length; i++) {
    const win = sb.filter(t => t.date >= sb[i].date && U.daysBetween(sb[i].date, t.date) <= 30);
    const owners = [...new Set(win.map(t => t.owner))];
    if (owners.length >= 2 && !clusters.some(c => c.start === sb[i].date)) clusters.push({start: sb[i].date, owners, value: val(win)});
  }
  const recent = tx.filter(t => t.code === "P" || t.code === "S").sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 15);
  return {buyCount: buys.length, sellCount: sells.length, buyValue: val(buys), sellValue: val(sells), distinctBuyers: new Set(buys.map(t => t.owner)).size,
    opportunisticBuys: oppBuys.length, opportunisticBuyValue: val(oppBuys), opportunisticSells: oppSells.length, planSells: sells.filter(t => t.plan).length,
    clusters: clusters.slice(0, 4), recent, filings: forms.length};
};

/* ======================= filing-language diff ("Lazy Prices") ======================= */
C.extractSection = function (text, which) {
  const T = text;
  const pats = which === "risk"
    ? {start: /item\s*1a\.?\s*[\-–—:.]?\s*risk\s+factors/gi, end: /item\s*1b\.?|item\s*1c\.?|item\s*2\.?\s*[\-–—:.]?\s*properties/gi}
    : {start: /item\s*7\.?\s*[\-–—:.]?\s*management['’]?s\s+discussion/gi, end: /item\s*7a\.?|item\s*8\.?\s*[\-–—:.]?\s*financial\s+statements/gi};
  let best = "";
  let m; pats.start.lastIndex = 0;
  while ((m = pats.start.exec(T))) {
    pats.end.lastIndex = m.index + 50;
    const e = pats.end.exec(T);
    const seg = T.slice(m.index, e ? e.index : Math.min(T.length, m.index + 400000));
    if (seg.length > best.length) best = seg;
  }
  return best;
};
const sentences = t => String(t).replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z(])/).map(s => s.trim()).filter(s => s.length > 40 && s.length < 1200);
const normWords = s => s.toLowerCase().replace(/\d[\d,.]*/g, "#").replace(/[^a-z#\s]/g, " ").split(/\s+/).filter(Boolean);
function shingles(s) { const w = normWords(s); const out = new Set(); for (let i = 0; i + 2 < w.length; i++) out.add(w[i] + " " + w[i + 1] + " " + w[i + 2]); return out; }
C.cosine = function (a, b) {
  const tf = t => { const m = new Map(); for (const w of normWords(t)) if (w.length > 2) m.set(w, (m.get(w) || 0) + 1); return m; };
  const A = tf(a), B = tf(b); let dot = 0, na = 0, nb = 0;
  for (const [k, v] of A) { na += v * v; if (B.has(k)) dot += v * B.get(k); } for (const v of B.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : null;
};
C.diffSections = function (oldT, newT) {
  if (!oldT || !newT) return null;
  const so = sentences(oldT), sn = sentences(newT);
  const index = new Map(); const shO = so.map(shingles);
  shO.forEach((set, i) => set.forEach(sh => { if (!index.has(sh)) index.set(sh, []); index.get(sh).push(i); }));
  const matchedOld = new Set();
  const added = [];
  sn.forEach(s => {
    const set = shingles(s); if (!set.size) return;
    const counts = new Map(); set.forEach(sh => (index.get(sh) || []).forEach(i => counts.set(i, (counts.get(i) || 0) + 1)));
    let best = 0, bi = -1; counts.forEach((cnt, i) => { const j = cnt / (set.size + shO[i].size - cnt); if (j > best) { best = j; bi = i; } });
    if (best >= 0.5) matchedOld.add(bi); else added.push({s, sim: best});
  });
  const removed = so.filter((_, i) => !matchedOld.has(i));
  const RISKY = /(material weakness|going concern|covenant|default|impair|restat|investigation|subpoena|litigation|decline|loss of|terminat|concentrat|cybersecurity|tariff|sanction|downgrad|liquidity|substantial doubt|not be able|unable to|adverse)/i;
  const score = x => (RISKY.test(x.s || x) ? 1000 : 0) + (x.s || x).length;
  return {cosine: C.cosine(oldT, newT), sentencesOld: so.length, sentencesNew: sn.length,
    addedCount: added.length, removedCount: removed.length, changedShare: sn.length ? added.length / sn.length : null,
    added: added.sort((a, b) => score(b) - score(a)).slice(0, 8).map(x => x.s),
    removed: removed.sort((a, b) => score(b) - score(a)).slice(0, 5)};
};

/* ======================= transcript tone ======================= */
const HEDGE = ["approximately","believe","could","may","might","possibly","uncertain","uncertainty","unclear","depend","depends","appears","assume","fluctuate","roughly","somewhat","perhaps","likely","unlikely","probably","seems","suggest","tentative","cautious","challenging","headwind","headwinds","softness","pressure","pressures","volatile","volatility","difficult","slower","delay","delays"];
const POS = ["strong","record","growth","accelerat","momentum","robust","exceed","beat","outperform","confident","improv","expand","demand","win","wins","raise","raised"];
C.toneOf = function (text) {
  const w = String(text || "").toLowerCase().match(/[a-z']+/g) || []; if (w.length < 200) return null;
  const per = c => c / w.length * 1000;
  const hedge = w.filter(x => HEDGE.includes(x)).length, pos = w.filter(x => POS.some(p => x.startsWith(p))).length;
  const qa = text.search(/question[- ]and[- ]answer|q\s*&\s*a session|questions and answers/i);
  let qaStats = null;
  if (qa > 0) { const qaText = text.slice(qa); const ans = qaText.split(/\n(?=[A-Z][A-Za-z .'-]{2,40}:|\n)/).map(s => s.split(/\s+/).length).filter(n => n > 15); qaStats = {answers: ans.length, avgAnswerWords: U.mean(ans)}; }
  return {words: w.length, hedgePer1k: per(hedge), positivePer1k: per(pos), netTone: per(pos) - per(hedge), qa: qaStats};
};
C.transcriptAnalysis = function (docs) {
  const t = (docs || []).filter(d => d.kind === "transcript" && d.text).map(d => Object.assign({name: d.name}, C.toneOf(d.text))).filter(x => x.words);
  if (!t.length) return null;
  const out = {calls: t};
  if (t.length >= 2) { const [a, b] = t.slice(-2); out.change = {hedge: b.hedgePer1k - a.hedgePer1k, tone: b.netTone - a.netTone, from: a.name, to: b.name}; }
  return out;
};

/* ======================= leading signals ======================= */
C.leadingSignals = function (fs) {
  const S = [], add = (signal, value, direction, note) => S.push({signal, value, direction, note, source: "computed"});
  const ym = fs.yearMetrics || [], last = ym[ym.length - 1], prev = ym[ym.length - 2];
  const qg = fs.qGrowth || [];
  if (qg.length >= 3) { const a = qg[qg.length - 1].g, b = qg[qg.length - 3].g; add("Revenue growth acceleration (YoY, latest vs 2 quarters earlier)", U.pct(a) + " vs " + U.pct(b), a > b + 0.01 ? "positive" : a < b - 0.01 ? "negative" : "neutral", "Second derivative of growth"); }
  const qm = (fs.fin?.quarters || []).filter(q => isN(q.opInc) && isN(q.revenue));
  if (qm.length >= 8) { const m = a => a.reduce((s, q) => s + q.opInc, 0) / a.reduce((s, q) => s + q.revenue, 0); const t1 = m(qm.slice(-4)), t0 = m(qm.slice(-8, -4)); add("Operating margin, TTM vs prior TTM", U.pct(t1) + " vs " + U.pct(t0), t1 > t0 + 0.005 ? "positive" : t1 < t0 - 0.005 ? "negative" : "neutral", "Margin inflection"); }
  if (isN(fs.incRoic) && last && isN(last.roic)) add("Incremental ROIC (3y) vs average ROIC", U.pct(fs.incRoic) + " vs " + U.pct(last.roic), fs.incRoic > last.roic ? "positive" : "negative", "New capital earning more than old?");
  if (last && isN(last.rpoGrowth)) add("RPO / backlog growth vs revenue growth", U.pct(last.rpoGrowth) + " vs " + U.pct(last.revGrowth), last.rpoGrowth > (last.revGrowth || 0) ? "positive" : "negative", "Contracted revenue leads reported revenue");
  if (last && isN(last.defRevGrowth)) add("Deferred revenue growth vs revenue growth", U.pct(last.defRevGrowth) + " vs " + U.pct(last.revGrowth), last.defRevGrowth > (last.revGrowth || 0) ? "positive" : "negative", "Billings ahead of revenue");
  if (last && prev && isN(last.dso) && isN(prev.dso)) add("Days sales outstanding", last.dso.toFixed(0) + " vs " + prev.dso.toFixed(0) + " days", last.dso > prev.dso * 1.1 ? "negative" : "neutral", "Receivables growing faster than sales can flag channel stuffing");
  if (last && isN(last.invGrowth) && isN(last.revGrowth)) add("Inventory growth vs sales growth", U.pct(last.invGrowth) + " vs " + U.pct(last.revGrowth), last.invGrowth > last.revGrowth + 0.1 ? "negative" : "neutral", "Inventory build ahead of demand");
  if (ym.length >= 3) {
    const cd = ym.slice(-3).map(y => y.capexToDA); const fm = ym.slice(-3).map(y => y.fcfMargin);
    if (cd.every(isN) && fm.every(isN) && cd[0] > 1.5 && cd[2] < cd[0] * 0.8) add("Capex cliff (capex/D&A falling from a heavy build)", cd.map(x => x.toFixed(1) + "x").join(" → "), fm[2] > fm[0] ? "positive" : "neutral", "End of a spending cycle often precedes a free-cash-flow inflection");
  }
  if (last && isN(last.shareChange)) add("Diluted share count change (YoY)", U.pct(last.shareChange), last.shareChange < -0.01 ? "positive" : last.shareChange > 0.03 ? "negative" : "neutral", "Buybacks vs dilution");
  const ins = fs.insiders;
  if (ins) {
    if (ins.clusters.length) add("Insider buying cluster", ins.clusters.map(c => `${c.owners.length} insiders from ${c.start}`).join("; "), "positive", "Several insiders buying together is one of the stronger insider signals");
    else if (ins.opportunisticBuys) add("Opportunistic insider purchases (12m)", `${ins.opportunisticBuys} buys, $${U.fmtNum(ins.opportunisticBuyValue)}`, "positive", "Non-routine open-market buys");
    if (ins.opportunisticSells >= 5 && !ins.buyCount) add("Non-routine insider selling (12m)", `${ins.opportunisticSells} sales`, "negative", "Excludes 10b5-1 plan and same-month routine sellers");
  }
  if (fs.filingDiff?.risk && isN(fs.filingDiff.risk.cosine)) { const cs = fs.filingDiff.risk.cosine; add("Risk-factor language change vs prior 10-K", "similarity " + cs.toFixed(3) + `, ${fs.filingDiff.risk.addedCount} new sentences`, cs < 0.9 ? "negative" : "neutral", "Large changes in filing language predict weaker returns (Cohen, Malloy & Nguyen, 'Lazy Prices')"); }
  const rs = fs.tech?.rs; if (rs && isN(rs.m6)) add("Relative strength vs " + (fs.benchSymbol || "SPY") + " (6m)", U.pct(rs.m6), rs.m6 > 0.05 ? "positive" : rs.m6 < -0.05 ? "negative" : "neutral", "Price leadership");
  if (fs.activism && fs.activism.length) add("13D/13G filings (12m)", fs.activism.length + " filings, latest " + fs.activism[0].date, "neutral", "Activist or large-holder stakes");
  if (fs.earnings && isN(fs.earnings.avgDrift)) add("Post-earnings drift (avg 20d excess)", U.pct(fs.earnings.avgDrift), fs.earnings.avgDrift > 0.01 ? "positive" : fs.earnings.avgDrift < -0.01 ? "negative" : "neutral", "How the stock behaves after results");
  if (fs.transcripts?.change) add("Earnings-call hedging language (per 1k words)", (fs.transcripts.change.hedge >= 0 ? "+" : "") + fs.transcripts.change.hedge.toFixed(1), fs.transcripts.change.hedge > 1 ? "negative" : fs.transcripts.change.hedge < -1 ? "positive" : "neutral", "From uploaded transcripts");
  return S;
};

/* ======================= Data Desk markdown for the committee record ======================= */
C.factsheetMarkdown = function (fs) {
  if (!fs) return "";
  const L = [];
  const f = (x, d = 2) => isN(x) ? U.fmtNum(x, d) : "n/a";
  L.push(`DATA DESK FACT SHEET — ${fs.ticker}${fs.company?.name ? " · " + fs.company.name : ""} (computed in code from primary data; treat as the committee's reference numbers)`);
  if (fs.company) L.push(`Company: SIC ${fs.company.sic || "?"} ${fs.company.sicDescription || ""} · exchange ${fs.company.exchange || "?"} · fiscal year end ${fs.company.fyEnd || "?"} · playbook: ${fs.playbook?.name || "?"}`);
  if (fs.tech) { const t = fs.tech; L.push(`Price ${f(t.price)} ${fs.currency || ""} (close ${t.date}, ${fs.priceSource || ""}) · 52w ${f(t.low52)}–${f(t.high52)} · 1m ${U.pct(t.ret.m1)} · 3m ${U.pct(t.ret.m3)} · 1y ${U.pct(t.ret.y1)} · ADV $${f(t.adv20)}`); }
  const v = fs.valuation;
  if (v) L.push(`Valuation: mkt cap $${f(v.marketCap)} · EV $${f(v.ev)} · P/E TTM ${f(v.pe, 1)} · EV/EBITDA ${f(v.evEbitda, 1)} · EV/Sales ${f(v.evSales, 1)} · P/FCF ${f(v.pFcf, 1)} · FCF yield ${U.pct(v.fcfYield)} · FCF-after-SBC yield ${U.pct(v.fcfSbcYield)} · dividend yield ${U.pct(v.divYield)} · buyback yield ${U.pct(v.buybackYield)} · shares ${f(v.shares)}${v.shareSource ? " (" + v.shareSource + ")" : ""}`);
  if (fs.reverseDcf) { const r = fs.reverseDcf; L.push(`Reverse DCF (${r.method}, r=${(r.r * 100).toFixed(1)}%, g=${(r.g * 100).toFixed(1)}%, ${r.years}y): price implies ${isN(r.impliedGrowth) ? U.pct(r.impliedGrowth) + " annual growth" : r.note}`); }
  if (fs.yearMetrics?.length) {
    L.push("\n| FY | Revenue | Growth | Gross m | Op m | FCF | FCF−SBC | ROIC | Accruals | ND/EBITDA |\n|---|---|---|---|---|---|---|---|---|---|");
    fs.yearMetrics.slice(-5).forEach(y => L.push(`| ${y.fy} | ${f(y.revenue)} | ${U.pct(y.revGrowth)} | ${U.pct(y.grossMargin)} | ${U.pct(y.opMargin)} | ${f(y.fcf)} | ${f(y.fcfAfterSbc)} | ${U.pct(y.roic)} | ${U.pct(y.accruals)} | ${isN(y.netDebtEbitda) ? y.netDebtEbitda.toFixed(1) + "x" : "n/a"} |`));
  }
  if (fs.qGrowth?.length) L.push(`Quarterly revenue growth (YoY): ${fs.qGrowth.slice(-6).map(q => q.end.slice(0, 7) + " " + U.pct(q.g)).join(" · ")}`);
  if (isN(fs.incRoic)) L.push(`Incremental ROIC (3y): ${U.pct(fs.incRoic)}`);
  const q = fs.quality;
  if (q) L.push(`Quality: Piotroski F ${q.piotroski ? q.piotroski.score + "/" + q.piotroski.of : "n/a"} · Altman Z ${q.altman && isN(q.altman.z) ? q.altman.z.toFixed(2) + " (" + q.altman.zone + ")" : "n/a"} · Beneish M ${q.beneish ? q.beneish.m.toFixed(2) + (q.beneish.flag ? " (above −1.78: manipulation-risk flag)" : " (below −1.78)") + (q.beneish.missing.length ? ` [partial: ${q.beneish.missing.join(",")} defaulted]` : "") : "n/a"}`);
  if (fs.tech) { const t = fs.tech; L.push(`Technicals: MA20 ${f(t.ma20)} · MA50 ${f(t.ma50)} (slope ${U.pct(t.ma50Slope)}) · MA200 ${f(t.ma200)} (slope ${U.pct(t.ma200Slope)}) · regime ${t.regime}${t.cross ? " · " + t.cross.type + " " + t.cross.date : ""} · RSI14 ${f(t.rsi14, 1)} · MFI14 ${f(t.mfi14, 1)} · MACD hist ${f(t.macd?.hist, 3)} · ATR14 ${f(t.atr14)} · 60d vol ${U.pct(t.vol60)} · OBV slope ${f(t.obvSlope, 2)} · up/down volume ${f(t.upDownVol, 2)} · AVWAP from 52w low ${f(t.avwapFromLow)} · from 52w high ${f(t.avwapFromHigh)}`);
    L.push(`Fibonacci (${t.fib.direction}, swing ${f(t.fib.swingLow)}–${f(t.fib.swingHigh)}): ${t.fib.levels.map(l => (l.level * 100).toFixed(1) + "% " + f(l.price)).join(" · ")}`);
    if (t.rs) L.push(`Relative strength vs ${fs.benchSymbol}: 3m ${U.pct(t.rs.m3)} · 6m ${U.pct(t.rs.m6)} · 12m ${U.pct(t.rs.m12)}`); }
  if (fs.earnings) L.push(`Earnings reactions (last ${fs.earnings.events.length}): avg day-after move ${U.pct(fs.earnings.avgReaction)}, avg |move| ${U.pct(fs.earnings.avgAbsReaction)}, avg 20-day excess drift ${U.pct(fs.earnings.avgDrift)}`);
  if (fs.insiders) { const i = fs.insiders; L.push(`Insiders (Form 4, 12m): ${i.buyCount} buys $${f(i.buyValue)} (${i.opportunisticBuys} opportunistic, ${i.distinctBuyers} buyers), ${i.sellCount} sales $${f(i.sellValue)} (${i.planSells} under 10b5-1 plans)${i.clusters.length ? " · clusters: " + i.clusters.map(c => c.start + " (" + c.owners.join(", ") + ")").join("; ") : ""}`); }
  if (fs.activism?.length) L.push(`13D/13G filings: ${fs.activism.map(a => a.form + " " + a.date).join(", ")}`);
  if (fs.filingDiff) {
    const d = fs.filingDiff;
    for (const [k, lab] of [["risk", "Risk factors"], ["mdna", "MD&A"]]) { const x = d[k]; if (!x) continue;
      L.push(`${lab} change vs prior annual report (${d.oldDate} → ${d.newDate}): cosine similarity ${isN(x.cosine) ? x.cosine.toFixed(3) : "n/a"}, ${x.addedCount} new / ${x.removedCount} removed sentences.`);
      if (x.added.length) L.push("New language:\n" + x.added.slice(0, 5).map(s => "> " + s.slice(0, 400)).join("\n"));
      if (x.removed.length) L.push("Removed language:\n" + x.removed.slice(0, 3).map(s => "> " + s.slice(0, 300)).join("\n")); }
  }
  if (fs.transcripts) L.push(`Call tone (uploaded transcripts): ${fs.transcripts.calls.map(c => `${c.name}: hedging ${c.hedgePer1k.toFixed(1)}/1k, positive ${c.positivePer1k.toFixed(1)}/1k`).join(" · ")}`);
  if (fs.leading?.length) L.push("Leading signals (computed): " + fs.leading.map(s => `${s.signal}: ${s.value} [${s.direction}]`).join(" · "));
  if (fs.notes?.length) L.push("Data Desk notes: " + fs.notes.join(" · "));
  return L.join("\n");
};

/* ======================= Evidence ledger ======================= */
const FS_METRIC = fs => {
  if (!fs) return {};
  const v = fs.valuation || {}, t = fs.tech || {}, y = (fs.yearMetrics || []).slice(-1)[0] || {};
  return {price: t.price, market_cap: v.marketCap, pe_ttm: v.pe, ev_ebitda: v.evEbitda, ev_sales: v.evSales, p_fcf: v.pFcf, fcf_yield: isN(v.fcfYield) ? v.fcfYield * 100 : null,
    revenue_growth: isN(y.revGrowth) ? y.revGrowth * 100 : null, gross_margin: isN(y.grossMargin) ? y.grossMargin * 100 : null, op_margin: isN(y.opMargin) ? y.opMargin * 100 : null,
    roic: isN(y.roic) ? y.roic * 100 : null, net_debt_ebitda: y.netDebtEbitda, rsi14: t.rsi14, mfi14: t.mfi14, ma20: t.ma20, ma50: t.ma50, ma200: t.ma200, atr14: t.atr14,
    high_52w: t.high52, low_52w: t.low52, implied_growth: isN(fs.reverseDcf?.impliedGrowth) ? fs.reverseDcf.impliedGrowth * 100 : null};
};
const ANNUAL_KEYS = ["revenue_growth", "gross_margin", "op_margin", "roic", "net_debt_ebitda"];
const refAsOf = (fs, k) => { const y = (fs?.yearMetrics || []).slice(-1)[0]; return ANNUAL_KEYS.includes(k) && y ? "FY" + y.fy : fs?.tech?.date || ""; };
C.ledger = function (run) {
  const claims = [];
  for (const id in run.reports) { const r = run.reports[id]; (r.data?.claims || []).forEach(c => claims.push(Object.assign({seat: id}, c))); }
  const ref = FS_METRIC(run.factsheet);
  const groups = {};
  claims.forEach(c => { if (c.metric && isN(c.value)) { const k = String(c.metric).toLowerCase().replace(/[^a-z0-9_]/g, ""); (groups[k] = groups[k] || []).push(c); } });
  const contradictions = [];
  /* Units: one seat may write 2.77B as 2770000000, another as 2770 ($ millions) or 2.77 ($ billions); a margin may be 0.58 or 58.
     Before comparing, bring each value to the anchor's scale by a power of 1,000 (or ×100 for percentages) when that is what makes them agree. */
  const align = (v, anchor, k) => {
    if (!isN(v) || !isN(anchor) || v === 0 || anchor === 0 || Math.sign(v) !== Math.sign(anchor)) return v;
    const fs = [1, 1e3, 1e6, 1e9, 1e-3, 1e-6, 1e-9].concat(/margin|growth|yield|roic|roe|pct|percent|rate|share/.test(k) ? [100, 0.01] : []);
    let best = 1, bd = Infinity; for (const f of fs) { const d = Math.abs(Math.log(Math.abs(v * f / anchor))); if (d < bd - 1e-9) { bd = d; best = f; } }
    return best !== 1 && bd < Math.log(3) ? v * best : v;
  };
  const off = (a, b) => { if (!isN(a) || !isN(b)) return false; if (a === 0 || b === 0) return Math.abs(a - b) > 1; const r = Math.abs(a) > Math.abs(b) ? a / b : b / a; return r > 1.15 || r < 0; };
  for (const k in groups) {
    const anchor = isN(ref[k]) ? ref[k] : groups[k][0].value;
    const g = groups[k].map(c => { const v = align(c.value, anchor, k); return v === c.value ? c : Object.assign({}, c, {value: v, raw: c.value}); }); const vals = g.map(c => c.value);
    const mn = Math.min(...vals), mx = Math.max(...vals);
    if (g.length > 1 && off(mn, mx)) contradictions.push({metric: k, kind: "between seats", items: g.map(c => ({seat: c.seat, value: c.value, raw: c.raw, as_of: c.as_of}))});
    if (isN(ref[k])) { const bad = g.filter(c => off(c.value, ref[k])); if (bad.length) contradictions.push({metric: k, kind: "vs Data Desk", reference: ref[k], refAsOf: refAsOf(run.factsheet, k), items: bad.map(c => ({seat: c.seat, value: c.value, raw: c.raw, as_of: c.as_of}))}); }
  }
  const uncited = {};
  claims.forEach(c => { if ((c.source_type === "primary" || c.source_type === "secondary") && !c.source_url) uncited[c.seat] = (uncited[c.seat] || 0) + 1; });
  const types = {}; claims.forEach(c => types[c.source_type] = (types[c.source_type] || 0) + 1);
  return {claims, contradictions, uncited, types, primaryShare: claims.length ? (types.primary || 0) / claims.length : null};
};

/* ======================= CIO math ======================= */
C.evMath = function (scenarios, price) {
  if (!Array.isArray(scenarios) || !scenarios.length || !isN(price) || price <= 0) return null;
  const sc = scenarios.filter(s => isN(+s.price) && isN(+s.probability)).map(s => ({...s, price: +s.price, probability: +s.probability > 1 ? +s.probability / 100 : +s.probability}));
  const tot = sc.reduce((s, x) => s + x.probability, 0); if (!tot) return null;
  sc.forEach(s => s.p = s.probability / tot);
  const ev = sc.reduce((s, x) => s + x.p * x.price, 0);
  const down = sc.filter(s => s.price < price).reduce((s, x) => s + x.p * (x.price / price - 1), 0);
  const up = sc.filter(s => s.price > price).reduce((s, x) => s + x.p * (x.price / price - 1), 0);
  const base = sc.find(s => s.name === "base");
  return {ev, expReturn: ev / price - 1, downside: down, upside: up, upDownRatio: down < 0 ? up / -down : null,
    marginOfSafety: base ? (base.price - price) / base.price : null, horizon: U.median(sc.map(s => +s.horizon_months).filter(isN)), scenarios: sc, normalized: Math.abs(tot - 1) > 0.02};
};
C.formulaScore = function (cio) {
  if (!cio) return null;
  if (isN(cio.quality_score) && isN(cio.price_score)) return Math.round((0.5 * cio.quality_score + 0.5 * cio.price_score) * 10) / 10;
  const s = cio.scores || {}; return U.round(U.mean([s.macro, s.fundamentals, s.sentiment, s.risk, s.technicals, s.management]), 1);
};
C.consistency = function (cio, evm) {
  const out = []; if (!cio) return out;
  const v = U.verdictClass(cio.verdict);
  if (evm) {
    if (v === "bull" && evm.expReturn < 0) out.push(`Verdict ${cio.verdict} but the CIO's own scenarios imply ${U.pct(evm.expReturn)} expected return.`);
    if (v === "bear" && evm.expReturn > 0.15) out.push(`Verdict ${cio.verdict} but the scenarios imply +${U.pct(evm.expReturn)} expected return.`);
    if (evm.normalized) out.push("Scenario probabilities did not sum to 1; normalized in code.");
  }
  if (isN(cio.overall) && v === "bull" && cio.overall < 5) out.push(`Bullish verdict with a low overall score (${cio.overall}).`);
  if (isN(cio.overall) && v === "bear" && cio.overall > 7) out.push(`Bearish verdict with a high overall score (${cio.overall}).`);
  return out;
};

/* ======================= PM sizing ======================= */
C.sizing = function ({price, atr, stopPrice, support, portfolio, riskPct, riskProfile, adv, ddPct}) {
  if (!isN(price)) return null;
  const caps = {Conservative: 5, Moderate: 8, Aggressive: 12, Speculative: 15};
  const cap = caps[riskProfile] || 8;
  const atrStop = isN(atr) ? price - 2.5 * atr : null;
  const supStop = isN(support) && support < price ? support * 0.98 : null;
  const suggestedStop = isN(stopPrice) ? stopPrice : [atrStop, supStop].filter(isN).sort((a, b) => b - a)[0] ?? null;
  const out = {price, atr, atrStop, supStop, suggestedStop, capPct: cap};
  if (isN(suggestedStop) && suggestedStop < price) {
    out.stopDistance = (price - suggestedStop) / price;
    if (isN(portfolio) && portfolio > 0 && isN(riskPct)) {
      const riskDollars = portfolio * riskPct / 100;
      out.shares = Math.floor(riskDollars / (price - suggestedStop));
      out.positionDollars = out.shares * price;
      out.positionPct = out.positionDollars / portfolio * 100;
      if (out.positionPct > cap) { out.cappedPct = cap; out.cappedShares = Math.floor(portfolio * cap / 100 / price); }
      if (isN(adv) && adv > 0) out.pctOfAdv = Math.min(out.positionDollars, portfolio * cap / 100) / adv * 100;
    }
  }
  if (isN(ddPct)) out.ddNote = `Your drawdown tolerance is ${ddPct}%; a stop ${isN(out.stopDistance) ? (out.stopDistance * 100).toFixed(1) + "% below" : "n/a"} limits a single-position loss well inside it.`;
  return out;
};
C.correlations = function (bars, holdingsBars) {
  const rets = b => { const m = new Map(); for (let i = 1; i < b.length; i++) m.set(b[i].t, b[i].c / b[i - 1].c - 1); return m; };
  const base = rets(bars.slice(-253)); const out = [];
  for (const h of holdingsBars) {
    const r = rets(h.bars.slice(-253)); const a = [], b = [];
    for (const [t, v] of base) if (r.has(t)) { a.push(v); b.push(r.get(t)); }
    out.push({ticker: h.ticker, corr: U.corr(a, b)});
  }
  return out.sort((x, y) => (y.corr || 0) - (x.corr || 0));
};

/* ======================= Calibration ======================= */
C.forwardReturn = function (entry, bars, benchBars, months) {
  if (!bars || !isN(entry.price)) return null;
  const target = U.addDays(entry.date, Math.round(months * 30.44));
  if (target > U.today()) return null;
  const b = bars.find(x => x.t >= target); if (!b) return null;
  const r = b.c / entry.price - 1;
  let ex = null;
  if (benchBars) { const b0 = benchBars.find(x => x.t >= entry.date), b1 = benchBars.find(x => x.t >= target); if (b0 && b1) ex = r - (b1.c / b0.c - 1); }
  return {r, excess: ex, date: b.t};
};
C.calibration = function (entries) {
  const done = entries.filter(e => e.ret && isN(e.ret.r));
  const ex = e => isN(e.ret.excess) ? e.ret.excess : e.ret.r;
  const hit = e => { const v = U.verdictClass(e.verdict); return v === "bull" ? ex(e) > 0 : v === "bear" ? ex(e) < 0 : null; };
  const hits = done.map(hit).filter(x => x !== null);
  const buckets = [["1–4", 1, 4], ["5–6", 5, 6], ["7–8", 7, 8], ["9–10", 9, 10]].map(([label, a, b]) => {
    const g = done.filter(e => isN(e.overall) && e.overall >= a && e.overall <= b); return {label, n: g.length, avgExcess: U.mean(g.map(ex)), hitRate: U.mean(g.map(hit).filter(x => x !== null).map(Number))};
  });
  const byVerdict = {}; done.forEach(e => { const k = e.verdict || "?"; (byVerdict[k] = byVerdict[k] || []).push(ex(e)); });
  const verdicts = Object.keys(byVerdict).map(k => ({verdict: k, n: byVerdict[k].length, avgExcess: U.mean(byVerdict[k])}));
  const seatIds = new Set(); done.forEach(e => Object.keys(e.seatScores || {}).forEach(s => seatIds.add(s)));
  const seats = [...seatIds].map(s => ({seat: s, n: done.filter(e => isN(e.seatScores?.[s])).length, rho: U.spearman(done.map(e => e.seatScores?.[s]), done.map(ex))}));
  const bySector = {}; done.forEach(e => { const k = e.sector || "Unknown"; (bySector[k] = bySector[k] || []).push(ex(e)); });
  const sectors = Object.keys(bySector).map(k => ({sector: k, n: bySector[k].length, avgExcess: U.mean(bySector[k])}));
  return {n: done.length, total: entries.length, hitRate: hits.length ? U.mean(hits.map(Number)) : null, buckets, verdicts, seats, sectors,
    rhoOverall: U.spearman(done.map(e => e.overall), done.map(ex))};
};
C.calibrationNote = function (cal) {
  if (!cal || cal.n < 5) return cal ? `Track record: ${cal.n} matured calls so far (need 5+ before calibration is meaningful).` : "";
  const b = cal.buckets.filter(x => x.n).map(x => `scores ${x.label}: n=${x.n}, avg excess ${U.pct(x.avgExcess)}`).join("; ");
  return `Track record (${cal.n} matured forward-logged calls): hit rate ${U.pct(cal.hitRate, 0)}; score-to-return rank correlation ${isN(cal.rhoOverall) ? cal.rhoOverall.toFixed(2) : "n/a"}; ${b}. If high scores have not earned higher returns, temper conviction.`;
};
})(typeof globalThis !== "undefined" ? globalThis : window);
