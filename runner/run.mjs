#!/usr/bin/env node
/* Headless committee runner for GitHub Actions (or any machine with Node 20+).
   Uses the same core engine as the browser app, calling SEC/Yahoo directly (no gateway needed server-side).

   Commands
     node runner/run.mjs watchlist [--all] [--ticker WTTR]   re-run due watchlist tickers, check alerts, open an issue
     node runner/run.mjs eval [--label name] [--mode quick]   run the benchmark in evals/benchmark.json
     node runner/run.mjs track                                 update forward returns for the track record
     node runner/run.mjs run WTTR [--mode standard]            one committee run

   Environment: ANTHROPIC_API_KEY (required), SEC_USER_AGENT ("Name email", required by the SEC),
                GITHUB_TOKEN + GITHUB_REPOSITORY (optional, to open alert issues), AIC_MODEL (optional override) */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.join(ROOT, "src/core");
for (const f of fs.readdirSync(CORE).sort()) vm.runInThisContext(fs.readFileSync(path.join(CORE, f), "utf8"), {filename: f});
const A = globalThis.AIC, U = A.util, F = A.features, PL = A.pipeline;

const args = process.argv.slice(2), cmd = args[0] || "watchlist";
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : d; };
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); } catch { return d; } };
const writeJSON = (p, v) => { fs.mkdirSync(path.dirname(path.join(ROOT, p)), {recursive: true}); fs.writeFileSync(path.join(ROOT, p), JSON.stringify(v, null, 1)); };
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
const summary = md => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n"); console.log(md); };

const KEY = process.env.ANTHROPIC_API_KEY;
A.env.direct = true;
A.env.userAgent = process.env.SEC_USER_AGENT || "AI Investment Committee runner contact@example.com";
const wl = readJSON("watchlist.json", {tickers: [], profile: {}, settings: {}});
const settings = Object.assign({}, A.DEFAULTS, wl.settings || {}, process.env.AIC_MODEL ? {model: process.env.AIC_MODEL} : {});
const profile = Object.assign({}, A.DEFAULT_PROFILE, wl.profile || {});
if (!KEY && cmd !== "track") { console.error("ANTHROPIC_API_KEY is not set. Add it as a repository secret."); process.exit(1); }

async function runOne(ticker, mode, prior) {
  const run = PL.newRun({ticker, mode, profile, settings, prior, engine: "api"});
  let last = "";
  await PL.execute(run, {settings, apiKey: KEY, onUpdate: (r, id, kind) => { if (id && kind !== "stream" && r.reports[id]?.status !== last) { log(`${ticker} · ${A.seat(id).name}: ${r.reports[id].status}`); } }});
  PL.derive(run);
  return run;
}
function saveRun(run) {
  const rel = `results/${run.ticker}/${new Date(run.createdAt).toISOString().slice(0, 10)}-${run.id}.json`;
  writeJSON(rel, run);
  const idx = readJSON("results/index.json", {runs: [], alerts: []});
  idx.runs = [{id: run.id, ticker: run.ticker, createdAt: run.createdAt, mode: run.mode, verdict: run.cio?.verdict || null, overall: run.cio?.overall ?? null, expReturn: run.evm?.expReturn ?? null, path: rel}].concat(idx.runs.filter(r => r.id !== run.id)).slice(0, 500);
  idx.updated = new Date().toISOString(); writeJSON("results/index.json", idx);
  const track = readJSON("results/track.json", []); track.unshift(F.trackEntry(run)); writeJSON("results/track.json", track);
  return rel;
}
const cadenceDays = c => ({weekly: 7, monthly: 30, quarterly: 91, "after earnings": 91}[c] || 30);

async function openIssue(title, body) {
  const repo = process.env.GITHUB_REPOSITORY, tok = process.env.GITHUB_TOKEN;
  if (!repo || !tok) { log("No GITHUB_TOKEN/GITHUB_REPOSITORY; alert issue not created."); return; }
  const r = await fetch(`https://api.github.com/repos/${repo}/issues`, {method: "POST", headers: {authorization: `Bearer ${tok}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "aic-runner"}, body: JSON.stringify({title, body, labels: ["committee-alert"]})});
  log("Issue:", r.status);
}

if (cmd === "run") {
  const t = U.normTicker(args[1]); const run = await runOne(t, opt("mode", "standard"));
  log("Saved", saveRun(run)); summary(`**${t}**: ${run.cio?.verdict} · ${run.cio?.overall}/10 · expected return ${U.pct(run.evm?.expReturn)}`);
}

if (cmd === "watchlist") {
  const idx = readJSON("results/index.json", {runs: []});
  const only = opt("ticker"), all = opt("all", false);
  const alerts = [];
  for (const w of wl.tickers || []) {
    const t = U.normTicker(w.ticker); if (only && only !== true && U.normTicker(only) !== t) continue;
    const prevMeta = idx.runs.find(r => r.ticker === t);
    // price alerts first (cheap)
    try {
      const p = await A.data.lastPrice(t);
      for (const a of w.alerts || []) { const v = U.num(a.value); if (!U.isNum(v) || !p) continue;
        if (a.type === "price_below" && p.price <= v) alerts.push({ticker: t, date: p.date, text: `price ${p.price.toFixed(2)} at or below ${v}${a.note ? " (" + a.note + ")" : ""}`});
        if (a.type === "price_above" && p.price >= v) alerts.push({ticker: t, date: p.date, text: `price ${p.price.toFixed(2)} at or above ${v}${a.note ? " (" + a.note + ")" : ""}`}); }
    } catch (e) { log(t, "price check failed:", e.message); }
    const due = all || only || !prevMeta || (Date.now() - prevMeta.createdAt) / 864e5 >= cadenceDays(w.cadence);
    if (!due) { log(t, "not due"); continue; }
    const prior = prevMeta ? readJSON(prevMeta.path, null) : null;
    log(`${t}: running ${w.mode || "quick"} committee`);
    try {
      const run = await runOne(t, w.mode || "quick", w.mode === "earnings" || prior ? prior : null);
      saveRun(run);
      if (prevMeta && prevMeta.verdict && run.cio?.verdict && prevMeta.verdict !== run.cio.verdict) alerts.push({ticker: t, date: U.today(), text: `verdict changed ${prevMeta.verdict} → ${run.cio.verdict}`});
      summary(`| ${t} | ${run.cio?.verdict || run.status} | ${run.cio?.overall ?? "–"} | ${U.pct(run.evm?.expReturn)} |`);
    } catch (e) { log(t, "run failed:", e.message); alerts.push({ticker: t, date: U.today(), text: "run failed: " + e.message}); }
  }
  const idx2 = readJSON("results/index.json", {runs: []}); idx2.alerts = alerts; idx2.updated = new Date().toISOString(); writeJSON("results/index.json", idx2);
  if (alerts.length) await openIssue(`Committee alerts ${U.today()}: ${[...new Set(alerts.map(a => a.ticker))].join(", ")}`, alerts.map(a => `- **${a.ticker}** ${a.text}`).join("\n") + "\n\nOpen the app and use Portfolio → Watchlist → Sync results from GitHub.");
  log(`Done. ${alerts.length} alerts.`);
}

if (cmd === "eval") {
  const bench = readJSON("evals/benchmark.json", {tickers: ["AAPL", "KO", "XOM", "PLTR", "WTTR"], mode: "quick"});
  const mode = opt("mode", bench.mode || "quick"), label = opt("label", "ci");
  const ev = {at: Date.now(), label, mode, model: settings.model, promptVersion: A.PROMPT_VERSION, results: []};
  for (const t of bench.tickers) { log("eval", t); try { const run = await runOne(U.normTicker(t), mode); ev.results.push(F.evalSummary(run)); } catch (e) { ev.results.push({ticker: t, status: "error", error: e.message}); } }
  const file = `evals/results/${new Date().toISOString().slice(0, 10)}-${String(label).replace(/[^\w-]/g, "_")}.json`; writeJSON(file, ev);
  summary(`### Benchmark ${label} (${A.PROMPT_VERSION}, ${settings.model}, ${mode})\n| Ticker | Verdict | Score | Contradictions | Uncited | Citations | Out tokens |\n|---|---|---|---|---|---|---|\n` + ev.results.map(r => `| ${r.ticker} | ${r.verdict || r.status} | ${r.overall ?? "–"} | ${r.contradictions ?? "–"} | ${r.uncited ?? "–"} | ${r.citations ?? "–"} | ${r.outTok ?? "–"} |`).join("\n"));
  log("Saved", file, "— import it into the app's Lab by copying into a backup, or compare files directly.");
}

if (cmd === "track") {
  const track = readJSON("results/track.json", []);
  await F.updateTrack(track, (i, n, t) => log(`track ${i}/${n} ${t}`));
  writeJSON("results/track.json", track);
  const cal = A.compute.calibration(track);
  summary(`Track record: ${cal.n} matured of ${cal.total}; hit rate ${U.pct(cal.hitRate, 0)}; score/return rank corr ${U.isNum(cal.rhoOverall) ? cal.rhoOverall.toFixed(2) : "n/a"}`);
}
