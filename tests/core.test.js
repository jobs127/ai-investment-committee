/* Node tests for the DOM-free core: computations on synthetic fixtures and a full mocked committee run.
   Run: node tests/core.test.js */
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const {fixtureFor, anthropicSSE} = require("./mock");
const dir = path.join(__dirname, "../src/core");
for (const f of fs.readdirSync(dir).sort()) eval(fs.readFileSync(path.join(dir, f), "utf8"));
const A = globalThis.AIC, C = A.compute, U = A.util;
let calls = {anthropic: 0, data: 0};
globalThis.fetch = async (url, opts = {}) => {
  if (/api\.anthropic\.com/.test(url)) {
    calls.anthropic++;
    const body = JSON.parse(opts.body);
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

  console.log("Full committee run (mocked Anthropic)");
  const run = A.pipeline.newRun({ticker: "WTTR", mode: "full", profile: Object.assign({}, A.DEFAULT_PROFILE, {size: "250000"}), settings: A.DEFAULTS, engine: "api", member: {note: "Disposal permits are being cut in Reeves County.", docs: []}});
  let updates = 0;
  await A.pipeline.execute(run, {settings: Object.assign({}, A.DEFAULTS, {priceIn: "5", priceOut: "25", priceSearch: "10"}), apiKey: "sk-test", onUpdate: () => updates++,
    holdingsInfo: async () => ({text: "XOM 100 sh", corr: []}), calibrationNote: "Track record: 0 matured calls."});
  ok("run done", run.status === "done");
  const seats = run.seats.filter(id => !A.seat(id).code_only);
  ok("all seats done", seats.every(id => run.reports[id].status === "done"), seats.filter(id => run.reports[id].status !== "done").join(","));
  ok("structured data on every LLM seat", seats.filter(id => id !== "rebuttal").every(id => run.reports[id].data), seats.filter(id => id !== "rebuttal" && !run.reports[id].data).join(","));
  ok("forced submit_report follow-up worked (Data Hunter)", run.reports.hunter.data && run.reports.hunter.data.score_fundamentals != null);
  ok("rebuttals ran for critiqued seats", run.rebuttals.length === 2 && run.rebuttals.every(r => r.status === "done"), run.rebuttals.map(r => r.seat).join(","));
  ok("revised score applied", run.reports.hunter.data._original_score === 7 || run.reports.hunter.data.score_fundamentals === 7);
  ok("CIO derived EV", run.evm && U.isNum(run.evm.ev), run.evm && run.evm.ev.toFixed(2));
  ok("formula score", run.cio.formula === 7);
  ok("ledger contradictions found (pe_ttm)", run.ledger.contradictions.some(c => c.metric === "pe_ttm"), run.ledger.contradictions.map(c => c.metric + ":" + c.kind).join(","));
  ok("sizing computed", run.sizing && U.isNum(run.sizing.atrStop), run.sizing && run.sizing.suggestedStop.toFixed(2));
  ok("usage + cache tracked", run.usage && run.usage.cacheRead > 0 && run.usage.searches > 0, JSON.stringify(run.usage));
  ok("cost estimate", U.costOf(run.usage, {priceIn: 5, priceOut: 25, priceSearch: 10}) > 0, U.costOf(run.usage, {priceIn: 5, priceOut: 25, priceSearch: 10}).toFixed(3));
  ok("sources captured", run.reports.scout.sources.length > 0);
  ok("updates fired", updates > 20, updates);
  const lean = A.pipeline.lean(run); ok("lean computed", lean.side === "LONG", lean.avg);
  // parallelism: stage 3 seats overlap in time — verified indirectly by call count
  ok("anthropic calls", calls.anthropic >= 19, calls.anthropic);

  console.log("Budget guard");
  const run2 = A.pipeline.newRun({ticker: "WTTR", mode: "quick", profile: A.DEFAULT_PROFILE, settings: A.DEFAULTS, engine: "api"});
  try { await A.pipeline.execute(run2, {settings: Object.assign({}, A.DEFAULTS, {priceIn: "5", priceOut: "25", budget: "0.01"}), apiKey: "k"}); ok("budget stop", false); }
  catch (e) { ok("budget stop", e.code === "budget", e.message.slice(0, 60)); }

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
