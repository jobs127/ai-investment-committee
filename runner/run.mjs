#!/usr/bin/env node
/* Headless committee runner for GitHub Actions (or any machine with Node 20+).
   Uses the same engine as the browser app and calls SEC/Yahoo directly (no gateway needed server-side).
   Runs use the Saver plan by default: each stage goes to Anthropic's Batch API (half price). Because a batch can
   take a while, the runner never waits: every invocation advances queued runs one step and exits, and the
   scheduled workflow calls it again every 30 minutes until the runs finish.

   Commands
     node runner/run.mjs queue            advance queued runs; start due watchlist tickers; daily price-alert check;
                                          Stock Alert System: 4:30 am Central sweep, 6:30 am digest, free urgent checks in market hours
     node runner/run.mjs alerts [--now]   only the Alert System (--now: start a sweep immediately)
     node runner/run.mjs eval [--label name] [--mode quick]   queue the benchmark in evals/benchmark.json
     node runner/run.mjs track            update forward returns for the track record
     node runner/run.mjs run WTTR [--mode standard] [--plan balanced]   one run, waiting until done

   Environment: ANTHROPIC_API_KEY (required), SEC_USER_AGENT ("Name email", required by the SEC),
                GITHUB_TOKEN + GITHUB_REPOSITORY (optional, alert issues), AIC_PLAN (optional: saver|balanced|max) */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.join(ROOT, "src/core");
for (const f of fs.readdirSync(CORE).sort()) vm.runInThisContext(fs.readFileSync(path.join(CORE, f), "utf8"), {filename: f});
const A = globalThis.AIC, U = A.util, F = A.features, PL = A.pipeline, AL = A.alerts;

const args = process.argv.slice(2), cmd = args[0] || "queue";
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : d; };
const abs = p => path.join(ROOT, p);
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(abs(p), "utf8")); } catch { return d; } };
const writeJSON = (p, v) => { fs.mkdirSync(path.dirname(abs(p)), {recursive: true}); fs.writeFileSync(abs(p), JSON.stringify(v, null, 1)); };
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
const summary = md => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n"); console.log(md); };

const KEY = process.env.ANTHROPIC_API_KEY;
A.env.direct = true;
A.env.userAgent = process.env.SEC_USER_AGENT || "AI Investment Committee runner contact@example.com";
// optional: reach the gateway's Reddit and YouTube routes (keys stay in Cloudflare)
if (process.env.AIC_GATEWAY_URL) A.env.gwExtra = {url: process.env.AIC_GATEWAY_URL, token: process.env.AIC_GATEWAY_TOKEN || ""};
const wl = readJSON("watchlist.json", {tickers: [], profile: {}, settings: {}});
const settings = Object.assign({}, A.DEFAULTS, wl.settings || {});
if (process.env.AIC_PLAN) settings.plan = process.env.AIC_PLAN;
if (settings.model && !wl.settings?.judgeModel) settings.judgeModel = settings.model;
settings.runCap = settings.runCap || "3";
const profile = Object.assign({}, A.DEFAULT_PROFILE, wl.profile || {});
if (!KEY && cmd !== "track") { console.error("ANTHROPIC_API_KEY is not set. Add it as a repository secret."); process.exit(1); }

/* ---------- storage ---------- */
const QUEUE = "results/queue.json";
const loadQueue = () => readJSON(QUEUE, {pending: [], lastAlertDay: "", evals: {}});
const pendingPath = id => `results/pending/${id}.json`;
function finalize(run) {
  const rel = `results/${run.ticker}/${new Date(run.createdAt).toISOString().slice(0, 10)}-${run.id}.json`;
  writeJSON(rel, run);
  const idx = readJSON("results/index.json", {runs: [], alerts: []});
  idx.runs = [{id: run.id, ticker: run.ticker, createdAt: run.createdAt, mode: run.mode, plan: run.plan, verdict: run.cio?.verdict || null, overall: run.cio?.overall ?? null, expReturn: run.evm?.expReturn ?? null, cost: run.cost ?? null, path: rel}]
    .concat(idx.runs.filter(r => r.id !== run.id)).slice(0, 500);
  idx.updated = new Date().toISOString(); writeJSON("results/index.json", idx);
  if (!run.noTrack) { const track = readJSON("results/track.json", []); track.unshift(F.trackEntry(run)); writeJSON("results/track.json", track); }
  return rel;
}
const findRecent = async (ticker, {need, maxAgeH, excludeId}) => {
  const idx = readJSON("results/index.json", {runs: []});
  const hit = idx.runs.find(r => r.ticker === ticker && r.id !== excludeId && Date.now() - r.createdAt < maxAgeH * 3600e3);
  if (!hit) return null; const run = readJSON(hit.path, null);
  return run && run.reports[need] && run.reports[need].status === "done" ? run : (need === "desk" && run?.factsheet ? run : null);
};
const hooksFor = run => ({settings, apiKey: KEY, defer: true, findRecent, save: async r => writeJSON(pendingPath(r.id), r),
  onUpdate: (r, id, kind) => { if (id && kind !== "stream") log(`${r.ticker} · ${A.seat(id).name}: ${r.reports[id]?.status}`); }});

/* advance one run; returns "done" | "waiting" | "error" */
async function advance(run) {
  try { await PL.execute(run, hooksFor(run)); PL.derive(run); return "done"; }
  catch (e) {
    if (e.code === "deferred") { writeJSON(pendingPath(run.id), run); return "waiting"; }
    log(run.ticker, "error:", e.message); run.status = "error"; run.error = e.message; writeJSON(pendingPath(run.id), run); return "error";
  }
}
const cadenceDays = c => ({weekly: 7, monthly: 30, quarterly: 91, "after earnings": 91}[c] || 30);

const gh = async (pathq, method = "GET", body) => {
  const repo = process.env.GITHUB_REPOSITORY, tok = process.env.GITHUB_TOKEN;
  if (!repo || !tok) return null;
  try { const r = await fetch(`https://api.github.com/repos/${repo}${pathq}`, {method, headers: {authorization: `Bearer ${tok}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "aic-runner"}, body: body ? JSON.stringify(body) : undefined});
  try { return await r.json(); } catch { return {status: r.status}; } } catch (e) { log("GitHub API:", e.message); return null; }
};
async function openIssue(title, body, labels = ["committee-alert"]) {
  if (!process.env.GITHUB_REPOSITORY || !process.env.GITHUB_TOKEN) { log("No GITHUB_TOKEN/GITHUB_REPOSITORY; issue not created:", title); return null; }
  const owner = process.env.GITHUB_REPOSITORY_OWNER; // the @mention makes GitHub email you
  const r = await gh("/issues", "POST", {title: title.slice(0, 250), body: body + (owner ? `\n\n@${owner}` : ""), labels});
  log("Issue:", r?.number || r?.status); return r;
}

/* ---------- queue processing ---------- */
async function processQueue({startDue = true} = {}) {
  const q = loadQueue(); const alerts = [];
  // 1. advance pending runs
  for (const item of q.pending.slice()) {
    const run = readJSON(pendingPath(item.id), null);
    if (!run) { q.pending = q.pending.filter(x => x.id !== item.id); continue; }
    if (run.status === "error") { // retry errored runs once per invocation, at most 3 times
      item.retries = (item.retries || 0) + 1; if (item.retries > 3) { q.pending = q.pending.filter(x => x.id !== item.id); alerts.push({ticker: run.ticker, text: "run failed: " + run.error}); continue; }
      run.status = "running"; for (const id of run.seats) if (run.reports[id].status === "error") run.reports[id].status = "queued";
    }
    log(`${run.ticker}: advancing (${item.kind})`);
    const st = await advance(run);
    if (st === "done") {
      finalize(run); fs.rmSync(abs(pendingPath(run.id)), {force: true}); q.pending = q.pending.filter(x => x.id !== item.id);
      summary(`| ${run.ticker} | ${run.cio?.verdict || run.status} | ${run.cio?.overall ?? "–"} | ${U.pct(run.evm?.expReturn)} | $${(run.cost || 0).toFixed(2)} |`);
      if (item.prevVerdict && run.cio?.verdict && item.prevVerdict !== run.cio.verdict) alerts.push({ticker: run.ticker, date: U.today(), text: `verdict changed ${item.prevVerdict} → ${run.cio.verdict}`});
      if (item.kind === "eval") { (q.evals[item.label] = q.evals[item.label] || {results: [], expected: item.expected, mode: run.mode, at: Date.now()}).results.push(F.evalSummary(run)); }
    }
  }
  // 2. finished benchmarks
  for (const [label, ev] of Object.entries(q.evals)) {
    if (ev.results.length < ev.expected) continue;
    const file = `evals/results/${new Date().toISOString().slice(0, 10)}-${String(label).replace(/[^\w-]/g, "_")}.json`;
    writeJSON(file, {at: ev.at, label, mode: ev.mode, plan: settings.plan, model: settings.judgeModel, promptVersion: A.PROMPT_VERSION, results: ev.results});
    summary(`### Benchmark ${label} done → ${file}`); delete q.evals[label];
  }
  // 3. start due watchlist tickers
  if (startDue) {
    const idx = readJSON("results/index.json", {runs: []});
    for (const w of wl.tickers || []) {
      const t = U.normTicker(w.ticker);
      if (q.pending.some(x => x.ticker === t && x.kind === "watch")) continue;
      const prev = idx.runs.find(r => r.ticker === t);
      const due = opt("all", false) || (opt("ticker") && U.normTicker(opt("ticker")) === t) || !prev || (Date.now() - prev.createdAt) / 864e5 >= cadenceDays(w.cadence);
      if (!due || (opt("ticker") && U.normTicker(opt("ticker")) !== t)) continue;
      const prior = (w.mode === "earnings" && prev) ? readJSON(prev.path, null) : null;
      const run = PL.newRun({ticker: t, mode: w.mode || "quick", plan: w.plan || settings.plan, profile, settings, prior, engine: "api"});
      q.pending.push({id: run.id, ticker: t, kind: "watch", prevVerdict: prev?.verdict || null});
      log(`${t}: starting ${run.mode} on ${run.plan}`);
      const st = await advance(run);
      if (st === "done") { finalize(run); fs.rmSync(abs(pendingPath(run.id)), {force: true}); q.pending = q.pending.filter(x => x.id !== run.id); }
    }
  }
  // 4. daily price alerts
  if (q.lastAlertDay !== U.today()) {
    q.lastAlertDay = U.today();
    for (const w of wl.tickers || []) {
      try { const p = await A.data.lastPrice(w.ticker);
        for (const a of w.alerts || []) { const v = U.num(a.value); if (!U.isNum(v) || !p) continue;
          if (a.type === "price_below" && p.price <= v) alerts.push({ticker: w.ticker, date: p.date, text: `price ${p.price.toFixed(2)} at or below ${v}${a.note ? " (" + a.note + ")" : ""}`});
          if (a.type === "price_above" && p.price >= v) alerts.push({ticker: w.ticker, date: p.date, text: `price ${p.price.toFixed(2)} at or above ${v}${a.note ? " (" + a.note + ")" : ""}`}); } }
      catch (e) { log(w.ticker, "price check failed:", e.message); }
    }
  }
  writeJSON(QUEUE, q);
  if (alerts.length) {
    const idx = readJSON("results/index.json", {runs: []}); idx.alerts = alerts; writeJSON("results/index.json", idx);
    await openIssue(`Committee alerts ${U.today()}: ${[...new Set(alerts.map(a => a.ticker))].join(", ")}`, alerts.map(a => `- **${a.ticker}** ${a.text}`).join("\n") + "\n\nOpen the app and use Portfolio → Watchlist → Sync results from GitHub.");
  }
  log(`Queue: ${q.pending.length} run(s) still waiting.`);
}

/* ---------- AI Stock Alert System ---------- */
const ALERTS = readJSON("alerts.json", null);
const chicago = () => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23"}).formatToParts(new Date()).map(x => [x.type, x.value]));
  return {date: `${p.year}-${p.month}-${p.day}`, hm: +p.hour * 100 + +p.minute, weekday: !["Sat", "Sun"].includes(p.weekday)}; };
const AST = "results/alerts/state.json";
function alertCtx(stt, w) {
  const t = U.normTicker(w.ticker), idx = readJSON("results/index.json", {runs: []});
  const last = idx.runs.find(r => r.ticker === t && r.verdict); const run = last ? readJSON(last.path, null) : null;
  return Object.assign({since: U.addDays(U.today(), -7)}, stt.ctx[t] || {}, {terms: w.terms || "", below: w.below || "", above: w.above || "", thesis: AL.thesisLines(run, null)});
}
function appendFeed(items) {
  if (!items.length) return;
  const feed = readJSON("results/alerts/feed.json", {items: []}); const have = new Set(feed.items.map(i => i.ticker + i.id));
  feed.items = items.filter(i => !have.has(i.ticker + i.id)).concat(feed.items).slice(0, 1500); feed.updated = new Date().toISOString();
  writeJSON("results/alerts/feed.json", feed);
}
const itemLine = (t, i) => `- **${t}** ${i.title}${i.why ? " — " + i.why : ""}${i.thesisHit ? ` _(thesis: ${i.thesisHit})_` : ""}${i.url ? ` ([${i.source || "source"}](${i.url}))` : i.source ? ` (${i.source})` : ""}`;
async function processAlerts({now: force = false} = {}) {
  const list = (ALERTS?.tickers || []).filter(w => w.ticker && w.on !== false);
  if (!list.length) return;
  const AS = Object.assign({}, AL.DEFAULTS, ALERTS.settings || {});
  const stt = readJSON(AST, {ctx: {}, started: "", digest: "", pending: null, tries: 0});
  const now = chicago(); log(`Alerts: Chicago ${now.date} ${now.hm}, ${list.length} tickers, plan ${AS.plan}`);
  // 1. start the morning sweep (4:30 am Central so Saver's batch is done by 6:30)
  if (!stt.pending && ((now.weekday && now.hm >= 430 && stt.started !== now.date) || force)) {
    const ctx = {}; list.forEach(w => ctx[U.normTicker(w.ticker)] = alertCtx(stt, w));
    const sw = AL.newSweep({tickers: list.map(w => U.normTicker(w.ticker)), ctx, plan: AS.plan, searchDepth: AS.searchDepth, reputableOnly: AS.reputableOnly, blocked: AS.blocked, urgentRule: AS.urgentRule, scope: force ? "all" : "scheduled", prefs: ALERTS.feedback || null});
    stt.pending = sw.id; stt.started = now.date; stt.tries = 0; writeJSON(`results/alerts/pending/${sw.id}.json`, sw); log(`Alerts: sweep ${sw.id} started`);
  }
  // 2. advance it
  if (stt.pending) {
    const file = `results/alerts/pending/${stt.pending}.json`, sw = readJSON(file, null);
    if (!sw) stt.pending = null;
    else try {
      await AL.execute(sw, {settings: Object.assign({}, settings), apiKey: KEY, defer: true, save: async x => writeJSON(file, x), onUpdate: (x, k) => k && log("  " + k + ": " + x.reports[k]?.status)});
      for (const t of sw.tickers) stt.ctx[t] = AL.nextContext(stt.ctx[t], sw, t);
      writeJSON(`results/alerts/sweeps/${now.date}-${sw.id}.json`, sw); fs.rmSync(abs(file), {force: true});
      writeJSON("results/alerts/latest.json", {date: now.date, at: Date.now(), sweepId: sw.id, cost: sw.cost, results: sw.results});
      appendFeed(sw.tickers.flatMap(t => sw.results[t].items));
      const urgent = sw.tickers.flatMap(t => sw.results[t].items.filter(i => i.urgent).map(i => itemLine(t, i)));
      if (urgent.length) await openIssue(`🚨 Stock alert: ${[...new Set(sw.tickers.filter(t => sw.results[t].items.some(i => i.urgent)))].join(", ")}`, urgent.join("\n") + "\n\nFull details in the app: AI Stock Alert System → Feed → Sync from GitHub.", ["stock-alert", "urgent"]);
      summary(`Alert sweep done: ${sw.tickers.length} tickers, ${sw.tickers.reduce((a, t) => a + sw.results[t].items.length, 0)} items, $${(sw.cost || 0).toFixed(2)}`);
      stt.pending = null;
    } catch (e) {
      if (e.code === "deferred") log("Alerts: waiting on Anthropic's batch");
      else { log("Alerts: sweep error:", e.message); if (++stt.tries > 3) { stt.pending = null; await openIssue("Stock alert sweep failed", "The morning sweep failed: " + e.message, ["stock-alert"]); } }
    }
  }
  // 3. the 6:30 am digest (sent as soon as the morning sweep has finished, never before 6:30)
  if (now.weekday && now.hm >= 630 && stt.digest !== now.date && stt.started === now.date && !stt.pending) {
    const latest = readJSON("results/alerts/latest.json", null);
    if (latest && latest.date === now.date) {
      const md = AL.digestMarkdown(latest.results, {title: "Morning digest", date: now.date});
      fs.mkdirSync(abs("results/alerts/digests"), {recursive: true}); fs.writeFileSync(abs(`results/alerts/digests/${now.date}.md`), md);
      const old = await gh("/issues?labels=stock-digest&state=open&per_page=20");
      const made = await openIssue(`☀ Morning digest ${now.date}: ${Object.keys(latest.results).map(t => `${t}${latest.results[t].items.some(i => i.urgent) ? "🚨" : ""}`).join(" ")}`, md + `\n_Cost of this sweep: $${(latest.cost || 0).toFixed(2)}_`, ["stock-digest"]);
      if (Array.isArray(old)) for (const o of old) if (o.number && o.number !== made?.number) await gh(`/issues/${o.number}`, "PATCH", {state: "closed"});
    }
    stt.digest = now.date;
  }
  // 4. market hours: free, code-only checks for urgent filings and price moves (every run, about every 30 minutes)
  if (now.weekday && now.hm >= 830 && now.hm <= 1530 && stt.digest === now.date && !stt.pending) {
    const hits = [], found = [];
    for (const w of list) {
      const t = U.normTicker(w.ticker), c = stt.ctx[t] || {since: now.date, seenKeys: []};
      const seen = new Set(c.seenKeys || []);
      const items = [];
      try { items.push(...(await AL.scanSec(t, c.since || now.date)).items); } catch (e) { log(t, "sec:", e.message); }
      try { items.push(...(await AL.scanTape(t, c.since || now.date, {below: w.below, above: w.above, earnings: []})).items.filter(i => i.kind !== "calendar")); } catch (e) { log(t, "tape:", e.message); }
      const fresh = items.filter(i => !seen.has(i.key)).map(i => Object.assign(i, {id: i.key, ticker: t, why: "", thesisHit: "", novelty: "new", foundAt: Date.now(), status: "new", urgent: AL.isUrgent(i, AS.urgentRule) && i.importance >= 4}));
      fresh.forEach(i => seen.add(i.key)); c.seenKeys = [...seen].slice(-400); stt.ctx[t] = c;
      found.push(...fresh); fresh.filter(i => i.urgent).forEach(i => hits.push(itemLine(t, i)));
    }
    appendFeed(found);
    if (hits.length) await openIssue(`🚨 Stock alert (intraday): ${hits.length} item${hits.length > 1 ? "s" : ""}`, hits.join("\n"), ["stock-alert", "urgent"]);
  }
  writeJSON(AST, stt);
}

if (cmd === "queue" || cmd === "watchlist") { await processQueue({startDue: true}); try { await processAlerts(); } catch (e) { log("Alerts failed:", e.message); } }
if (cmd === "alerts") await processAlerts({now: !!opt("now", false)});

if (cmd === "eval") {
  const bench = readJSON("evals/benchmark.json", {tickers: ["AAPL", "KO", "XOM", "PLTR", "WTTR"], mode: "quick"});
  const mode = opt("mode", bench.mode || "quick"), label = String(opt("label", "ci"));
  const q = loadQueue();
  for (const t of bench.tickers) {
    const run = PL.newRun({ticker: U.normTicker(t), mode, plan: settings.plan, profile, settings, engine: "api"}); run.noTrack = true;
    writeJSON(pendingPath(run.id), run);
    q.pending.push({id: run.id, ticker: run.ticker, kind: "eval", label, expected: bench.tickers.length});
  }
  writeJSON(QUEUE, q);
  log(`Queued benchmark "${label}" (${bench.tickers.length} tickers, ${mode}, ${settings.plan}).`);
  await processQueue({startDue: false});
}

if (cmd === "run") {
  const t = U.normTicker(args[1]);
  const run = PL.newRun({ticker: t, mode: opt("mode", "standard"), plan: opt("plan", settings.plan), profile, settings, engine: "api"});
  await PL.execute(run, {...hooksFor(run), defer: false});
  log("Saved", finalize(run)); summary(`**${t}**: ${run.cio?.verdict} · ${run.cio?.overall}/10 · expected return ${U.pct(run.evm?.expReturn)} · cost $${(run.cost || 0).toFixed(2)}`);
}

if (cmd === "track") {
  const track = readJSON("results/track.json", []);
  await F.updateTrack(track, (i, n, t) => log(`track ${i}/${n} ${t}`));
  writeJSON("results/track.json", track);
  const cal = A.compute.calibration(track);
  summary(`Track record: ${cal.n} matured of ${cal.total}; hit rate ${U.pct(cal.hitRate, 0)}; score/return rank corr ${U.isNum(cal.rhoOverall) ? cal.rhoOverall.toFixed(2) : "n/a"}`);
}
