/* Node tests for the DOM-free core: computations on synthetic fixtures and a full mocked committee run.
   Run: node tests/core.test.js */
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const {fixtureFor, anthropicSSE, batchMock} = require("./mock");
const dir = path.join(__dirname, "../src/core");
for (const f of fs.readdirSync(dir).sort()) eval(fs.readFileSync(path.join(dir, f), "utf8"));
const A = globalThis.AIC, C = A.compute, U = A.util;
let calls = {anthropic: 0, data: 0, models: {}};
const BM = batchMock(1);
globalThis.fetch = async (url, opts = {}) => {
  if (/api\.anthropic\.com\/v1\/messages\/batches/.test(url)) {
    const r = BM.handle(opts.method || "GET", new URL(url).pathname, opts.body);
    if (opts.method === "POST" && opts.body) JSON.parse(opts.body).requests.forEach(q => calls.models[q.params.model] = (calls.models[q.params.model] || 0) + 1);
    return r.json ? new Response(JSON.stringify(r.json), {status: r.status}) : new Response(r.text, {status: r.status});
  }
  if (/api\.anthropic\.com/.test(url)) {
    calls.anthropic++;
    const body = JSON.parse(opts.body);
    calls.models[body.model] = (calls.models[body.model] || 0) + 1;
    assert.ok(opts.headers["x-api-key"], "api key header");
    const sse = anthropicSSE(body);
    return new Response(new ReadableStream({start(c) { const enc = new TextEncoder(); for (let i = 0; i < sse.length; i += 700) c.enqueue(enc.encode(sse.slice(i, i + 700))); c.close(); }}), {status: 200, headers: {"content-type": "text/event-stream"}});
  }
  calls.data++;
  const fx = fixtureFor(url);
  if (!fx) return new Response("not found", {status: 404});
  return fx.json ? new Response(JSON.stringify(fx.json), {status: 200}) : new Response(fx.text, {status: 200});
};
const ok = (name, cond, extra) => { console.log((cond ? "  ✓ " : "  ✗ ") + name + (extra !== undefined ? "  → " + extra : "")); if (!cond) process.exitCode = 1; };

(async () => {
  console.log("Compute primitives");
  const r = C.reverseDCF({ev: 1000, fcf0: 50, r: 0.09, g: 0.025});
  // check: PV with implied growth reproduces EV
  let s = 0, f = 50; for (let t = 1; t <= 10; t++) { f *= 1 + r.impliedGrowth; s += f / Math.pow(1.09, t); } s += f * 1.025 / (0.09 - 0.025) / Math.pow(1.09, 10);
  ok("reverse DCF reproduces EV", Math.abs(s - 1000) < 0.5, U.pct(r.impliedGrowth));
  ok("RSI of steady rise is 100", C.rsi(Array.from({length: 30}, (_, i) => 10 + i)) === 100);
  const evm = C.evMath([{name: "bear", price: 5, probability: 0.25}, {name: "base", price: 10, probability: 0.5}, {name: "bull", price: 20, probability: 0.25}], 10);
  ok("EV math", Math.abs(evm.ev - 11.25) < 1e-9 && Math.abs(evm.expReturn - 0.125) < 1e-9, evm.ev);
  ok("consistency flags bullish verdict with negative EV", C.consistency({verdict: "BUY"}, {expReturn: -0.1}).length === 1);
  const sz = C.sizing({price: 10, atr: 0.4, portfolio: 100000, riskPct: 1, riskProfile: "Moderate", adv: 5e6});
  ok("ATR sizing", sz.atrStop === 9 && sz.shares === 1000 && Math.abs(sz.positionPct - 10) < 1e-9 && sz.cappedPct === 8, JSON.stringify({stop: sz.suggestedStop, shares: sz.shares, pct: sz.positionPct}));
  const d = C.diffSections("Alpha risk sentence about oil prices falling sharply. Beta risk sentence about customers concentrating revenue. Gamma sentence about our debt and covenants.", "Alpha risk sentence about oil prices falling sharply. Gamma sentence about our debt and covenants. Delta new sentence warns that we may be unable to obtain permits on acceptable terms.");
  ok("filing diff finds added and removed sentences", d.addedCount === 1 && d.removedCount === 1, d.added[0]);
  const tone = C.toneOf(("We believe demand may soften and headwinds could persist. ".repeat(20)) + ("Strong record growth and robust momentum. ".repeat(10)));
  ok("transcript tone", tone && tone.hedgePer1k > 0 && tone.positivePer1k > 0, tone && tone.hedgePer1k.toFixed(1));
  const cal = C.calibration(Array.from({length: 8}, (_, i) => ({verdict: i < 4 ? "BUY" : "SELL", overall: i < 4 ? 8 : 3, ret: {r: i < 4 ? 0.2 : -0.1, excess: i < 4 ? 0.1 : -0.05}, seatScores: {hunter: i < 4 ? 8 : 4}})));
  ok("calibration hit rate and seat correlation", cal.hitRate === 1 && cal.seats[0].rho > 0.8, cal.hitRate);

  console.log("Data Desk on fixtures (Node direct mode)");
  A.env.direct = true; A.env.userAgent = "test test@example.com";
  const fsheet = await A.buildFactsheet("WTTR", {settings: A.DEFAULTS, docs: [{name: "Q1 transcript", kind: "transcript", text: "Operator: welcome. ".repeat(10) + "We believe volumes may be softer. ".repeat(40)}, {name: "Q2 transcript", kind: "transcript", text: "Strong record growth. ".repeat(50) + "We believe it could improve. ".repeat(10)}]});
  ok("status ok", fsheet.status === "ok", fsheet.notes.join(" | "));
  ok("playbook from SIC 1389 = water", fsheet.playbook.id === "water", fsheet.playbook.name);
  ok("6 fiscal years parsed", fsheet.yearMetrics.length === 6);
  ok("Q4 derived for quarterly series", fsheet.fin.quarters.some(q => q.derived), fsheet.fin.quarters.length + " quarters");
  ok("valuation computed", U.isNum(fsheet.valuation.marketCap) && U.isNum(fsheet.valuation.pe), `mcap ${U.fmtNum(fsheet.valuation.marketCap)} pe ${fsheet.valuation.pe.toFixed(1)}`);
  ok("reverse DCF", U.isNum(fsheet.reverseDcf.impliedGrowth), U.pct(fsheet.reverseDcf.impliedGrowth));
  ok("Piotroski", fsheet.quality.piotroski.of === 9, fsheet.quality.piotroski.score + "/9");
  ok("Altman Z", U.isNum(fsheet.quality.altman.z), fsheet.quality.altman.z.toFixed(2));
  ok("Beneish M", U.isNum(fsheet.quality.beneish.m), fsheet.quality.beneish.m.toFixed(2));
  ok("technicals", U.isNum(fsheet.tech.ma200) && U.isNum(fsheet.tech.rsi14) && fsheet.tech.rs && U.isNum(fsheet.tech.rs.m6), `RSI ${fsheet.tech.rsi14.toFixed(1)} regime ${fsheet.tech.regime}`);
  ok("insider cluster detected", fsheet.insiders.clusters.length >= 1 && fsheet.insiders.planSells === 1, JSON.stringify(fsheet.insiders.clusters[0]?.owners));
  ok("filing diff of 10-Ks", fsheet.filingDiff && fsheet.filingDiff.risk.addedCount >= 1, fsheet.filingDiff?.risk?.added[0]?.slice(0, 60));
  ok("earnings reactions", fsheet.earnings && fsheet.earnings.events.length >= 3, fsheet.earnings?.events.length);
  ok("transcript change", fsheet.transcripts && fsheet.transcripts.change, fsheet.transcripts?.change?.hedge.toFixed(1));
  ok("leading signals", fsheet.leading.length >= 6, fsheet.leading.map(s => s.signal.split(" ")[0]).join(","));
  ok("13G activity", fsheet.activism.length === 1);
  fs.writeFileSync(path.join(__dirname, "out-factsheet.md"), fsheet.markdown);

  console.log("Full committee run — Max plan (all Opus, instant)");
  const run = A.pipeline.newRun({ticker: "WTTR", mode: "full", plan: "max", profile: Object.assign({}, A.DEFAULT_PROFILE, {size: "250000"}), settings: A.DEFAULTS, engine: "api", member: {note: "Disposal permits are being cut in Reeves County.", docs: []}});
  let updates = 0; calls.models = {};
  await A.pipeline.execute(run, {settings: A.DEFAULTS, apiKey: "sk-test", onUpdate: () => updates++,
    holdingsInfo: async () => ({text: "XOM 100 sh", corr: []}), calibrationNote: "Track record: 0 matured calls."});
  ok("run done", run.status === "done");
  const seats = run.seats.filter(id => !A.seat(id).code_only);
  ok("no scouts on Max", !run.seats.includes("mscout") && !run.seats.includes("fscout"));
  ok("all seats done", seats.every(id => run.reports[id].status === "done"), seats.filter(id => run.reports[id].status !== "done").join(","));
  ok("structured data on every LLM seat (JSON block)", seats.filter(id => id !== "rebuttal").every(id => run.reports[id].data), seats.filter(id => id !== "rebuttal" && !run.reports[id].data).join(","));
  ok("missing JSON repaired by the helper model (Data Hunter)", run.reports.hunter.data && run.reports.hunter.data.score_fundamentals === 7 && calls.models["claude-haiku-4-5-20251001"] >= 1);
  ok("JSON block hidden from report text", !/```json/.test(run.reports.cio.text));
  ok("rebuttals ran for critiqued seats", run.rebuttals.length === 2 && run.rebuttals.every(r => r.status === "done"), run.rebuttals.map(r => r.seat).join(","));
  ok("CIO derived EV", run.evm && U.isNum(run.evm.ev), run.evm && run.evm.ev.toFixed(2));
  ok("formula score", run.cio.formula === 7);
  ok("ledger contradictions found (pe_ttm)", run.ledger.contradictions.some(c => c.metric === "pe_ttm"), run.ledger.contradictions.map(c => c.metric + ":" + c.kind).join(","));
  ok("sizing computed", run.sizing && U.isNum(run.sizing.atrStop), run.sizing && run.sizing.suggestedStop.toFixed(2));
  ok("usage + cache tracked", run.usage && run.usage.cacheRead > 0 && run.usage.searches > 0, JSON.stringify(run.usage));
  ok("cost computed from built-in prices", run.cost > 0, "$" + run.cost.toFixed(3));
  ok("all Opus on Max", Object.keys(calls.models).filter(m => m !== "claude-haiku-4-5-20251001").every(m => m === "claude-opus-5-5"), JSON.stringify(calls.models));
  ok("sources captured", run.reports.scout.sources.length > 0);
  ok("updates fired", updates > 20, updates);
  const maxCost = run.cost;

  console.log("Full committee — Balanced plan (lean, instant)");
  calls.models = {};
  const docText = "Water volume model. ".repeat(600);
  const runB = A.pipeline.newRun({ticker: "WTTR", mode: "full", plan: "balanced", profile: A.DEFAULT_PROFILE, settings: A.DEFAULTS, engine: "api", member: {note: "n", docs: [{name: "model.xlsx", kind: "model/data", text: docText}]}});
  const dcache = new Map();
  await A.pipeline.execute(runB, {settings: A.DEFAULTS, apiKey: "k", digestCache: {get: k => dcache.get(k), set: (k, v) => dcache.set(k, v)}, holdingsInfo: async () => null});
  ok("balanced done", runB.status === "done", runB.seats.filter(id => !["done", "skipped"].includes(runB.reports[id].status)).join(","));
  ok("three scouts added", ["scout", "mscout", "fscout"].every(id => runB.seats.includes(id)));
  ok("only scouts search", runB.seats.filter(id => (runB.reports[id].usage?.searches || 0) > 0).every(id => A.seat(id).scout), runB.seats.filter(id => (runB.reports[id].usage?.searches || 0) > 0).join(","));
  ok("judges on Opus, analysts on Sonnet", runB.reports.cio.model === "claude-opus-5-5" && runB.reports.devil.model === "claude-opus-5-5" && runB.reports.macro.model === "claude-sonnet-5-5", JSON.stringify(calls.models));
  ok("document digested once with the helper", runB.member.docs[0].digest && /DIGEST/.test(runB.member.docs[0].digest) && dcache.size === 1);
  ok("Bull skipped when clearly bullish (avg≥7) or ran", ["done", "skipped"].includes(runB.reports.bull.status), runB.reports.bull.status);
  ok("lean rebuttals: high severity only", runB.rebuttals.length === 1 && runB.rebuttals[0].severity === "high", runB.rebuttals.map(r => r.seat + ":" + r.severity).join(","));
  const recB = A.prompts.recordBlocks(runB, 8, {full: false}).map(b => b.text).join("\n");
  ok("later seats get summaries; only scouts' notes go in full", /summary\]/.test(recB) && (recB.match(/mock report/g) || []).length === 3, (recB.match(/mock report/g) || []).length + " full reports in record");
  ok("Balanced cheaper than Max", runB.cost < maxCost, `$${runB.cost.toFixed(3)} vs $${maxCost.toFixed(3)}`);

  console.log("Full committee — Saver plan (Batch API, resumable)");
  calls.models = {};
  const runS = A.pipeline.newRun({ticker: "WTTR", mode: "full", plan: "saver", profile: A.DEFAULT_PROFILE, settings: A.DEFAULTS, engine: "api"});
  let saves = 0, deferrals = 0;
  const hooksS = {settings: A.DEFAULTS, apiKey: "k", defer: true, save: async () => saves++, holdingsInfo: async () => null,
    findRecent: async (t, o) => o.need === "desk" ? null : null};
  for (let i = 0; i < 40 && runS.status !== "done"; i++) {
    try { await A.pipeline.execute(runS, hooksS); }
    catch (e) { if (e.code === "deferred") { deferrals++; continue; } throw e; }
  }
  ok("saver finished through deferred resumes", runS.status === "done", `${deferrals} deferrals, ${BM.stats.created} batches`);
  ok("batch per stage, not per seat", BM.stats.created < runS.seats.length, `${BM.stats.created} batches for ${runS.seats.length} seats`);
  ok("batch state persisted between resumes", saves > 5, saves);
  ok("Saver about half of Balanced on tokens", runS.cost < runB.cost * 0.75, `$${runS.cost.toFixed(3)} vs $${runB.cost.toFixed(3)}`);

  console.log("Reuse within 72 h");
  calls.models = {};
  const before = Object.values(calls.models).reduce((a, b) => a + b, 0);
  const runR = A.pipeline.newRun({ticker: "WTTR", mode: "standard", plan: "balanced", profile: A.DEFAULT_PROFILE, settings: A.DEFAULTS, engine: "api"});
  await A.pipeline.execute(runR, {settings: A.DEFAULTS, apiKey: "k", findRecent: async (t, o) => runB, holdingsInfo: async () => null});
  ok("Data Desk and scouts reused", runR.reports.desk.reused && runR.reports.scout.reused && runR.reports.mscout.reused, Object.keys(runR.reports).filter(k => runR.reports[k].reused).join(","));
  ok("reused seats cost nothing", !runR.reports.scout.usage);

  console.log("Estimates");
  const eMax = A.pipeline.estimate({mode: "full", plan: "max", settings: A.DEFAULTS}), eBal = A.pipeline.estimate({mode: "full", plan: "balanced", settings: A.DEFAULTS}), eSav = A.pipeline.estimate({mode: "full", plan: "saver", settings: A.DEFAULTS});
  ok("estimates ordered Max > Balanced > Saver", eMax.cost > eBal.cost && eBal.cost > eSav.cost, `$${eMax.cost.toFixed(2)} / $${eBal.cost.toFixed(2)} / $${eSav.cost.toFixed(2)}`);

  console.log("Per-run cap");
  const run2 = A.pipeline.newRun({ticker: "WTTR", mode: "quick", plan: "max", profile: A.DEFAULT_PROFILE, settings: A.DEFAULTS, engine: "api"});
  try { await A.pipeline.execute(run2, {settings: Object.assign({}, A.DEFAULTS, {runCap: "0.01"}), apiKey: "k"}); ok("cap stop", false); }
  catch (e) { ok("cap stop", e.code === "budget", e.message.slice(0, 60)); }

  console.log("Screen mode");
  const runSc = A.pipeline.newRun({ticker: "WTTR", mode: "screen", plan: "balanced", profile: A.DEFAULT_PROFILE, settings: A.DEFAULTS, engine: "api"});
  await A.pipeline.execute(runSc, {settings: A.DEFAULTS, apiKey: "k"});
  ok("screen gives a call", runSc.reports.screen.data && runSc.reports.screen.data.call === "PROMISING", runSc.seats.join(","));

  console.log("Features");
  const ideas = await A.features.ideaHunt({engine: "api", settings: A.DEFAULTS, apiKey: "k"}); ok("idea hunt", ideas.data.ideas.length === 1);
  const sp = await A.features.spinoffs(); ok("spin-off feed", sp.length === 1 && sp[0].cik === 111111, sp[0]?.company);
  const ib = await A.features.insiderBuys(10); ok("insider buys scan", ib.length === 1 && ib[0].ticker === "WTTR", ib[0] && ib[0].value);
  const th = A.features.thesisFromRun(run); ok("thesis from run", th.kill.length >= 2 && th.catalysts.length >= 2);
  const chk = await A.features.checkThesis(th, {engine: "api", settings: A.DEFAULTS, apiKey: "k"}); ok("thesis check", chk.data.status === "intact");
  const cmp = await A.features.compareJudge([run, run], {engine: "api", settings: A.DEFAULTS, apiKey: "k", profile: A.DEFAULT_PROFILE}); ok("compare judge", cmp.ranking.length === 2);
  const te = A.features.trackEntry(run); ok("track entry", U.isNum(te.price) && te.verdict === "ACCUMULATE" && Object.keys(te.seatScores).length > 5);
  ok("eval summary", A.features.evalSummary(run).claims > 0);
  fs.writeFileSync(path.join(__dirname, "out-run.json"), JSON.stringify(run, null, 1));
  console.log(process.exitCode ? "\nSOME TESTS FAILED" : "\nAll core tests passed.");
})().catch(e => { console.error(e); process.exitCode = 1; });

/* Regression: multi-class share structure (no single SEC share count) and a mis-tagged D&A line */
(async () => {
  await new Promise(r => setTimeout(r, 3000));
  const A = globalThis.AIC, U = A.util, C = A.compute;
  const {fixtureFor} = require("./mock");
  const facts = JSON.parse(JSON.stringify(fixtureFor("https://data.sec.gov/api/xbrl/companyfacts/CIK0001693256.json").json));
  delete facts.facts.dei; delete facts.facts["us-gaap"].WeightedAverageNumberOfDilutedSharesOutstanding;
  facts.facts["us-gaap"].DepreciationDepletionAndAmortization.units.USD.forEach(e => { if (e.fy >= 2023) e.val = 3e6; });
  const fin = C.extractFinancials(facts);
  const ok = (n, c, x) => { console.log((c ? "  ✓ " : "  ✗ ") + n + (x !== undefined ? "  → " + x : "")); if (!c) process.exitCode = 1; };
  console.log("Regression: multi-class shares + mis-tagged D&A");
  ok("no share count from SEC", !fin.sharesOutstanding);
  ok("tiny D&A flagged and dropped", fin.rows.filter(r => r.daSuspect).length === 3);
  const fs = {fin, tech: {price: 12}, notes: []};
  fs.yearMetrics = C.yearMetrics(fin.rows);
  ok("valuation waits for shares", A.valuate(fs, null) === false && !fs.valuation);
  ok("valuation completes from Scout shares", A.valuate(fs, 120e6, "shares from Data Scout") && Math.abs(fs.valuation.marketCap - 1.44e9) < 1, U.fmtNum(fs.valuation.marketCap));
  ok("capex/D&A no longer absurd", fs.yearMetrics.every(y => !U.isNum(y.capexToDA) || y.capexToDA < 15));
  console.log(process.exitCode ? "REGRESSION FAILED" : "Regression tests passed.");
})();
