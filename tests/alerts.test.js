/* Alert System core tests (offline: mocked SEC/Yahoo/Anthropic). Run: node tests/alerts.test.js */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const {fixtureFor, anthropicSSE, anthropicMessage, batchMock} = require("./mock");
const BM = batchMock(1);
global.fetch = async (url, opts = {}) => {
  url = String(url);
  if (/api\.anthropic\.com\/v1\/messages\/batches/.test(url)) { const r = BM.handle(opts.method || "GET", new URL(url).pathname, opts.body); return new Response(r.json ? JSON.stringify(r.json) : r.text, {status: r.status}); }
  if (/api\.anthropic\.com/.test(url)) { const b = JSON.parse(opts.body); global.lastBodies.push(b); return b.stream ? new Response(anthropicSSE(b), {status: 200}) : new Response(JSON.stringify(anthropicMessage(b)), {status: 200}); }
  const fx = fixtureFor(url); if (!fx) return new Response("nf", {status: 404});
  return new Response(fx.json ? JSON.stringify(fx.json) : fx.text, {status: 200});
};
global.lastBodies = [];
const CORE = path.join(__dirname, "../src/core");
for (const f of fs.readdirSync(CORE).sort()) vm.runInThisContext(fs.readFileSync(path.join(CORE, f), "utf8"), {filename: f});
const A = global.AIC, AL = A.alerts, U = A.util;
A.env.direct = true; A.env.userAgent = "test test@example.com"; A.util.sleep = () => Promise.resolve();
const st = Object.assign({}, A.DEFAULTS);
const ok = m => console.log("  ✓ " + m);

(async () => {
  // 1. Balanced, all sources, everything
  let sw = AL.newSweep({tickers: ["WTTR", "XOM"], ctx: {WTTR: {since: "2026-07-01", below: "20", thesis: ["Monitor: recycling contracts"]}}, plan: "balanced", searchDepth: 1, scope: "all"});
  assert.equal(sw.tasks.WTTR.length, 11); ok("on-demand sweep runs all 11 sentinels");
  await AL.execute(sw, {settings: st, apiKey: "k"});
  assert.equal(sw.status, "done");
  const w = sw.results.WTTR;
  assert(w.items.length >= 5, "items " + w.items.length);
  assert(w.items.some(i => i.seat === "sec" && i.kind === "insider buy"), "Form 4 insider buy found");
  assert(w.items.some(i => i.seat === "tape" && i.key.endsWith(":below")), "price level hit kept");
  assert(w.items.some(i => i.thesisHit && i.urgent), "thesis hit is urgent");
  assert(!w.items.some(i => /duplicate/.test(i.title)), "desk merged duplicates");
  assert.equal(w.buzz, "elevated");
  ok(`WTTR: ${w.items.length} items, urgent ${w.items.filter(i => i.urgent).length}, headline "${w.headline}"`);
  assert(sw.cost > 0); ok("cost $" + sw.cost.toFixed(3));
  const sentBodies = global.lastBodies.filter(b => b.tools);
  assert(sentBodies.every(b => !b.tools[0].blocked_domains), "no blocked domains when all sources");
  assert(sentBodies.some(b => /claude-haiku/.test(b.model)) && global.lastBodies.some(b => /ALERT DESK/.test(JSON.stringify(b.messages)) && /sonnet/.test(b.model)), "models");
  ok("Haiku sentinels, Sonnet desk on Balanced");

  // 2. carry-over context: next sweep skips what was seen
  const ctx2 = AL.nextContext(sw.ctx.WTTR, sw, "WTTR");
  assert(ctx2.seenKeys.length > 5 && ctx2.since === U.today());
  ok("seen keys carried: " + ctx2.seenKeys.length);

  // 3. Saver + reputable only + scheduled cadence (weekly seats skipped when run this week)
  global.lastBodies = [];
  const created = BM.stats.created;
  sw = AL.newSweep({tickers: ["WTTR"], ctx: {WTTR: Object.assign({}, ctx2, {since: "2026-07-01", lastWeekly: U.today()})}, plan: "saver", searchDepth: 0.5, reputableOnly: true, blocked: AL.DEFAULTS.blocked, scope: "scheduled"});
  assert(!sw.tasks.WTTR.includes("pods") && sw.tasks.WTTR.includes("social"), "cadence");
  await AL.execute(sw, {settings: st, apiKey: "k"});
  assert.equal(BM.stats.created - created, 1, "one batch for the sentinels; desk skipped (nothing new)");
  assert.equal(sw.reports["WTTR|desk"].status, "skipped");
  const reqs = BM.lastRequests || [];
  const w2 = sw.results.WTTR;
  assert(!w2.items.some(i => ctx2.seenKeys.includes(i.key)), "already-seen items not repeated");
  ok(`Saver scheduled sweep: ${BM.stats.created - created} batches, ${w2.items.length} new items`);

  // 4. blocked domains + social prompt for reputable only
  const p = AL.seatTask(sw, "WTTR", "social"); assert(/named, established sources only/.test(p));
  const params = A.engine.buildParams({settings: st, model: "m", system: "s", blocks: [], task: "t", schemaKey: null, maxUses: 2, blockedDomains: sw.blocked});
  assert(params.tools[0].blocked_domains.includes("reddit.com")); ok("reputable-only blocks forums & social sites");

  // 5. digest + estimate
  const md = AL.digestMarkdown({WTTR: w}); assert(/Needs attention/.test(md) && /WTTR/.test(md)); ok("digest markdown");
  const e = AL.estimate({n: 5, plan: "saver", searchDepth: 1}); assert(e.month > 5 && e.month < 80); ok(`estimate: $${e.sweep.toFixed(2)}/sweep, $${e.month.toFixed(0)}/month for 5 tickers`);
  console.log("All alert tests passed.");
})().catch(e => { console.error(e); process.exit(1); });
