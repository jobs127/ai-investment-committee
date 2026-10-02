/* Pipeline: staged committee, parallel seats, rebuttals, and the cost plans.
   Lean plans (Saver, Balanced): three Scouts do all web research; later seats read compact summaries;
   judge seats on Opus, analysts on Sonnet; documents digested once; recent work reused; Bull skipped when
   the committee is already clearly bullish; rebuttals only for serious critiques. Saver sends each stage
   to Anthropic's Batch API at half price. Max: every seat on Opus with its own searches (v6.0 behaviour). */
(function (G) {
"use strict";
const AIC = G.AIC, U = AIC.util, C = AIC.compute, P = AIC.prompts, E = AIC.engine;
const PL = AIC.pipeline = {};
const isN = U.isNum;

PL.planOf = (plan, engine) => engine === "api" ? (AIC.PLANS[plan] ? plan : "saver") : "max";

PL.seatsForMode = function (mode, settings, plan) {
  let seats = mode === "custom" ? (settings.customSeats && settings.customSeats.length ? settings.customSeats : AIC.MODES.standard.seats).filter(id => AIC.seat(id))
    : (AIC.MODES[mode] || AIC.MODES.standard).seats.slice();
  const lean = AIC.PLANS[plan]?.lean;
  seats = seats.filter(id => !AIC.seat(id).leanOnly);
  if (lean && mode !== "screen") {
    if (!seats.includes("scout")) seats.push("scout");
    seats.push("mscout");
    if (seats.some(id => ["industry", "scuttle", "catalyst", "historian"].includes(id))) seats.push("fscout");
  }
  if (!seats.includes("desk")) seats.unshift("desk");
  const order = AIC.SEATS.map(s => s.id);
  return [...new Set(seats)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
};

PL.newRun = function ({ticker, mode, profile, settings, prior, member, engine, plan}) {
  plan = PL.planOf(plan || settings.plan, engine);
  const seats = PL.seatsForMode(mode, settings, plan);
  const reports = {};
  seats.forEach(id => reports[id] = {status: "queued", text: "", data: null, sources: [], searches: [], usage: null, ms: 0});
  const P_ = AIC.PLANS[plan];
  return {id: U.uid(), ticker, createdAt: Date.now(), mode, seats, engine, plan, lean: !!P_.lean && engine === "api", batch: !!P_.batch && engine === "api",
    model: engine === "claude" ? "claude.ai · most capable tier" : (P_.lean ? `${AIC.PLANS[plan].label}: Opus 5.5 judges + Sonnet 5.5 analysts` : settings.judgeModel || settings.model),
    promptVersion: AIC.PROMPT_VERSION, appVersion: AIC.VERSION,
    profile: Object.assign({}, profile), member: member || {note: "", docs: []},
    prior: prior ? {id: prior.id, createdAt: prior.createdAt, verdict: prior.cio?.verdict, overall: prior.cio?.overall, cio: prior.reports?.cio?.text || "", pm: prior.reports?.pm?.text || ""} : null,
    reanalysis: !!prior, reports, rebuttals: [], factsheet: null, playbook: null, status: "running", qa: [], usage: null, extraUsage: null};
};

PL.seatScore = function (id, data) {
  if (!data) return null; const sc = AIC.SCHEMAS[id]; if (!sc || !sc.score) return null;
  const v = data[sc.score]; return isN(v) ? v : null;
};
PL.lean = function (run) {
  const scores = run.seats.filter(id => id !== "screen").map(id => PL.seatScore(id, run.reports[id]?.data)).filter(isN);
  const avg = U.mean(scores);
  return {avg: avg == null ? "n/a" : avg.toFixed(1), avgN: avg, min: scores.length ? Math.min(...scores) : null, side: avg == null || avg >= 5.5 ? "LONG" : "SHORT"};
};
PL.priceOf = run => run.factsheet?.tech?.price ?? run.reports.scout?.data?.price ?? null;
PL.totalUsage = function (run) {
  let u = null; for (const id in run.reports) u = U.addUsage(u, run.reports[id].usage);
  (run.rebuttals || []).forEach(r => u = U.addUsage(u, r.usage)); (run.qa || []).forEach(q => u = U.addUsage(u, q.usage)); u = U.addUsage(u, run.extraUsage);
  return u;
};
PL.totalCost = run => U.costOf(PL.totalUsage(run)) || 0;

PL.derive = function (run) {
  run.ledger = C.ledger(run);
  const cioD = run.reports.cio?.data;
  if (cioD) {
    run.cio = Object.assign({}, cioD);
    run.evm = C.evMath(cioD.scenarios, PL.priceOf(run));
    run.cio.formula = C.formulaScore(cioD);
    run.consistency = C.consistency(cioD, run.evm);
  }
  if (run.reports.pm?.data) run.pm = run.reports.pm.data;
  run.usage = PL.totalUsage(run); run.cost = run.usage?.cost || 0;
  return run;
};

function searchesFor(seat, run, st) {
  if (run.engine !== "api") return 0;
  const depth = +st.searchDepth; if (!depth) return 0;
  if (run.lean && !seat.scout && seat.id !== "screen") return 0;
  const scale = AIC.MODES[run.mode]?.searchScale || 1;
  return seat.search ? Math.max(1, Math.round(seat.search * depth * scale)) : 0;
}
const globalCap = st => Math.max(1, Math.ceil(6 * (+st.searchDepth || 0)));
PL.modelFor = function (seatId, run, st) {
  const judge = st.judgeModel || st.model || AIC.DEFAULTS.judgeModel;
  if (!run.lean) return judge;
  return AIC.JUDGE_SEATS.includes(seatId) ? judge : (st.analystModel || AIC.DEFAULTS.analystModel);
};

/* ---------- cost estimate (before a run) ---------- */
const EST = { // rough $ per seat on Max, refined by the user's own history
  scout: 0.35, mscout: 0.3, fscout: 0.3, screen: 0.08, expect: 0.18, macro: 0.18, industry: 0.25, sent: 0.2, scuttle: 0.22, hunter: 0.22, forensic: 0.16, mgmt: 0.18,
  chart: 0.12, catalyst: 0.2, historian: 0.16, bull: 0.18, bear: 0.2, devil: 0.24, rebuttal: 0.12, cio: 0.18, pm: 0.1};
const EST_LEAN = {scout: 0.13, mscout: 0.12, fscout: 0.13, screen: 0.05, expect: 0.03, macro: 0.03, industry: 0.04, sent: 0.03, scuttle: 0.03, hunter: 0.09, forensic: 0.03, mgmt: 0.03,
  chart: 0.03, catalyst: 0.03, historian: 0.03, bull: 0.04, bear: 0.04, devil: 0.13, rebuttal: 0.04, cio: 0.13, pm: 0.04};
PL.estimate = function ({mode, plan, settings, stats}) {
  const seats = PL.seatsForMode(mode, settings, plan).filter(id => !AIC.seat(id).code_only);
  const P_ = AIC.PLANS[plan] || AIC.PLANS.saver, depth = +settings.searchDepth;
  let total = 0;
  for (const id of seats) {
    const hist = stats && stats[plan] && stats[plan][id];
    let c = hist && hist.n >= 2 ? hist.avg : (P_.lean ? EST_LEAN[id] : EST[id]) || 0.1;
    if (!hist && AIC.seat(id).search) c *= 0.4 + 0.6 * (depth || 0);
    if (!hist && P_.batch) c *= 0.55;
    total += c;
  }
  return {cost: total, seats: seats.length, minutes: P_.batch ? "usually 15–60 min (up to a few hours when Anthropic is busy)" : mode === "full" ? "about 6–12 min" : "about 3–8 min"};
};

/* ---------- running a set of seat jobs: instant (streaming, cache-warmed) or batch ---------- */
async function runJobs(run, jobs, hooks) {
  if (!jobs.length) return;
  const upd = hooks.onUpdate || (() => {});
  if (run.batch && run.engine === "api") {
    jobs.forEach(j => { j.target.status = "waiting"; j.target.batch = j.target.batch || {}; j.state = j.target.batch; j.target.error = null; });
    upd(run, null);
    try {
      await E.batch.run(jobs, {settings: hooks.settings, apiKey: hooks.apiKey, signal: hooks.signal, defer: hooks.defer,
        onStatus: info => { jobs.filter(j => j.state.batchId === info.id).forEach(j => j.target.batchInfo = info); upd(run, null, "batch"); },
        save: async () => { hooks.save && await hooks.save(run); }});
    } catch (e) {
      if (e.code === "cancelled") { for (const id of new Set(jobs.map(j => j.state.batchId).filter(Boolean))) E.batch.cancel && E.batch.cancel(id, hooks).catch(() => {}); jobs.forEach(j => { if (!j.done) { j.target.status = "stopped"; j.target.batch = null; } }); }
      throw e;
    }
    for (const j of jobs) {
      if (j.error) { j.target.status = "error"; j.target.error = j.error.message; j.target.batch = null; upd(run, j.id); throw j.error; }
      j.target.batch = null; j.target.batchInfo = null;
      j.onDone(j.out); upd(run, j.id);
    }
    return;
  }
  // instant: start the first job, let it write the prompt cache, then start the rest
  const start = j => {
    j.target.status = "running"; j.t0 = Date.now(); upd(run, j.id);
    let firstText; const gotText = new Promise(r => firstText = r);
    const p = E.call(Object.assign({}, j.o, {signal: hooks.signal,
      onText: t => { firstText(); j.target.text = t; upd(run, j.id, "stream"); }, onSearch: q => { firstText(); (j.target.searches = j.target.searches || []).push(q); upd(run, j.id, "stream"); }}))
      .then(out => { j.onDone(out); upd(run, j.id); }, e => { j.target.status = e.code === "cancelled" ? "stopped" : "error"; j.target.error = e.message; j.target.text = e.partial || j.target.text || ""; upd(run, j.id); throw e; });
    return {p, gotText};
  };
  const first = start(jobs[0]);
  if (jobs.length > 1) await Promise.race([first.gotText, first.p.catch(() => {}), U.sleep(9000)]);
  const rest = jobs.slice(1).map(start);
  const res = await Promise.allSettled([first.p, ...rest.map(r => r.p)]);
  const bad = res.find(r => r.status === "rejected"); if (bad) throw bad.reason;
}
E.batch.cancel = async function (id, hooks) {
  const env = AIC.env, st = hooks.settings;
  const via = (st.gatewayAnthropic || E._batchViaGateway) && env.gateway;
  const url = via ? env.gateway.replace(/\/+$/, "") + `/anthropic/v1/messages/batches/${id}/cancel` : `https://api.anthropic.com/v1/messages/batches/${id}/cancel`;
  const headers = {"anthropic-version": "2023-06-01"};
  if (via) { if (env.token) headers["x-aic-token"] = env.token; if (!st.gatewayAnthropic) headers["x-api-key"] = hooks.apiKey; } else { headers["x-api-key"] = hooks.apiKey; if (!env.direct) headers["anthropic-dangerous-direct-browser-access"] = "true"; }
  await fetch(url, {method: "POST", headers});
};

const hashStr = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + s.length.toString(36); };

/* Run (or resume) the pipeline.
   hooks: {settings, apiKey, signal, onUpdate(run, seatId, kind), save(run), defer, calibrationNote, holdingsInfo(run),
           findRecent(ticker, {maxAgeH, need}) -> run, digestCache {get(k), set(k, v)}} */
PL.execute = async function (run, hooks) {
  const st = hooks.settings, upd = hooks.onUpdate || (() => {});
  run.status = "running";
  const system = P.houseRules(run.engine, run.ticker, run);
  const fresh = run.reanalysis || run.mode === "earnings";
  const capCheck = () => {
    const cap = +st.runCap; if (!cap) return; const cost = PL.totalCost(run);
    if (cost > cap) throw new E.EngineError(`This run reached its $${cap.toFixed(2)} cap (≈$${cost.toFixed(2)} spent). Raise the per-run cap in Settings → Cost & models and press Resume to continue.`, "budget");
  };
  const recent = async (need, maxAgeH) => { try { return hooks.findRecent ? await hooks.findRecent(run.ticker, {need, maxAgeH, excludeId: run.id}) : null; } catch { return null; } };

  // ---- stage 0: Data Desk (code) — reused if built in the last 24 h
  const desk = run.reports.desk;
  if (desk && desk.status !== "done") {
    desk.status = "running"; const t0 = Date.now(); upd(run, "desk");
    const prev = !fresh ? await recent("desk", 24) : null;
    if (prev && prev.factsheet && prev.factsheet.status === "ok") {
      run.factsheet = JSON.parse(JSON.stringify(prev.factsheet));
      run.factsheet.transcripts = C.transcriptAnalysis(run.member?.docs); run.factsheet.leading = C.leadingSignals(run.factsheet); run.factsheet.markdown = C.factsheetMarkdown(run.factsheet);
      desk.reused = {from: prev.id, at: prev.createdAt};
    } else {
      try { run.factsheet = await AIC.buildFactsheet(run.ticker, {docs: run.member?.docs, settings: st, signal: hooks.signal, onProgress: m => { desk.progress = m; upd(run, "desk", "stream"); }}); }
      catch (e) { desk.error = "Data Desk failed: " + e.message; run.factsheet = {ticker: run.ticker, status: "error", notes: [e.message], playbook: AIC.pickPlaybook()}; }
    }
    run.playbook = run.factsheet.playbook; desk.text = run.factsheet.markdown || ""; desk.status = "done";
    desk.ms = Date.now() - t0; upd(run, "desk"); hooks.save && await hooks.save(run);
  }
  // ---- Member's note; documents digested once (lean plans) with the helper model
  if (run.reports.member && run.reports.member.status !== "done") {
    const m = run.member || {}; const has = (m.note && m.note.trim()) || (m.docs || []).length;
    if (has && run.lean && run.engine === "api") {
      for (const d of m.docs || []) {
        if (d.digest || !d.text || d.text.length < 6000) { if (!d.digest && d.text) d.digest = d.text; continue; }
        const key = "dg_" + hashStr(d.name + d.text.slice(0, 2000) + d.text.length);
        const cached = hooks.digestCache && hooks.digestCache.get(key);
        if (cached) { d.digest = cached; continue; }
        run.reports.member.status = "running"; run.reports.member.progress = "Digesting " + d.name; upd(run, "member", "stream");
        try {
          const out = await E.callAPI({settings: st, apiKey: hooks.apiKey, model: st.helperModel || AIC.DEFAULTS.helperModel, system: "You prepare documents for an investment committee.",
            blocks: [], task: `Digest this document for an investment committee analyzing ${run.ticker}. Keep every decision-relevant number, assumption, table and claim (with units and dates); drop boilerplate. Up to about 1,200 words.\n\nDOCUMENT: ${d.name} (${d.kind})\n${d.text.slice(0, 120000)}`,
            schemaKey: null, maxUses: 0, maxTokens: 3000, signal: hooks.signal});
          d.digest = out.text; run.extraUsage = U.addUsage(run.extraUsage, out.usage);
          hooks.digestCache && hooks.digestCache.set(key, out.text);
        } catch (e) { d.digest = d.text.slice(0, 12000); }
      }
    }
    run.reports.member.status = has ? "done" : "skipped";
    run.reports.member.text = has ? `${m.note || ""}${(m.docs || []).length ? "\n\nDocuments: " + m.docs.map(d => `${d.name} (${d.kind}, ${U.fmtNum(d.text?.length || 0, 0)} chars${d.digest && d.digest !== d.text ? ", digested" : ""})`).join(", ") : ""}` : "";
    upd(run, "member");
  }

  const stages = [...new Set(run.seats.map(id => AIC.seat(id).stage))].filter(s => s > 0).sort((a, b) => a - b);
  for (const stage of stages) {
    if (hooks.signal?.aborted) throw new E.EngineError("Stopped.", "cancelled");
    if (stage === 7 || stage === 9) PL.derive(run);
    if (stage === 8) { await PL.rebuttals(run, hooks, system); capCheck(); continue; }
    let seats = run.seats.map(AIC.seat).filter(s => s.stage === stage && !["done", "skipped"].includes(run.reports[s.id].status));
    if (!seats.length) continue;

    // reuse: Scouts' research (72 h) and the Macro view (same day) on lean plans
    if (run.lean && !fresh) {
      for (const s of seats.slice()) {
        const hours = s.scout ? 72 : s.id === "macro" ? 12 : 0; if (!hours) continue;
        const prev = await recent(s.id, hours);
        const pr = prev && prev.reports[s.id];
        if (pr && pr.status === "done" && pr.text) {
          Object.assign(run.reports[s.id], {status: "done", text: pr.text, data: pr.data, sources: pr.sources, searches: [], usage: null, ms: 0, reused: {from: prev.id, at: prev.createdAt}});
          upd(run, s.id); seats = seats.filter(x => x !== s);
        }
      }
    }
    // smart depth: skip the Bull when the committee is already clearly bullish (Bear and Devil always run)
    if (run.lean && stage === 6 && seats.some(s => s.id === "bull")) {
      const L = PL.lean(run);
      if (isN(L.avgN) && L.avgN >= 7 && isN(L.min) && L.min >= 5) {
        Object.assign(run.reports.bull, {status: "skipped", text: `Skipped to save cost: the committee is already clearly bullish (average seat score ${L.avg}, none below ${L.min}). The Bear and the Devil's Advocate still test the case.`});
        upd(run, "bull"); seats = seats.filter(s => s.id !== "bull");
      }
    }
    if (!seats.length) continue;

    const jobs = [];
    for (const seat of seats) {
      const rep = run.reports[seat.id];
      if (rep.status !== "waiting") { rep.text = ""; rep.searches = []; rep.sources = []; rep.error = null; rep.data = null; }
      const n = searchesFor(seat, run, st);
      const extra = {searches: n};
      if (seat.id === "devil") {
        extra.lean = PL.lean(run);
        extra.present = run.seats.filter(id => !["desk", "member", "devil", "rebuttal", "cio", "pm", "mscout", "fscout"].includes(id) && run.reports[id]?.status === "done").map(id => AIC.seat(id).name).join(", ");
        const L = C.ledger(run);
        extra.contradictions = L.contradictions.slice(0, 8).map(c => `- ${c.metric} (${c.kind}${isN(c.reference) ? ", Data Desk " + U.round(c.reference, 2) : ""}): ` + c.items.map(i => `${i.seat}=${i.value}`).join(", ")).join("\n");
        extra.uncited = Object.entries(L.uncited).map(([k, v]) => `${k}: ${v}`).join(", ");
      }
      if (seat.id === "cio") {
        extra.calibration = hooks.calibrationNote || "";
        extra.disputes = (run.rebuttals || []).filter(r => r.data && r.data.stance !== "concede").map(r => `- ${AIC.seat(r.seat).name} ${r.data.stance}s: ${(r.critique || "").slice(0, 200)} → ${(r.data.response || r.text || "").slice(0, 300)}`).join("\n");
        extra.contradictions = (run.ledger?.contradictions || []).slice(0, 8).map(c => `- ${c.metric}: ` + c.items.map(i => `${i.seat}=${i.value}`).join(", ") + (isN(c.reference) ? ` (Data Desk ${U.round(c.reference, 2)})` : "")).join("\n");
      }
      if (seat.id === "pm") {
        const fs = run.factsheet || {}, t = fs.tech || {};
        const chartD = run.reports.chart?.data || {};
        const p = PL.priceOf(run);
        const sizing = C.sizing({price: p, atr: t.atr14, stopPrice: null, support: chartD.invalidation ?? (chartD.support || [])[0], portfolio: U.num(run.profile.size), riskPct: U.num(run.profile.riskPerTrade) || 1,
          riskProfile: run.profile.risk, adv: t.adv20, ddPct: U.num(run.profile.dd)});
        run.sizing = sizing;
        const hi = hooks.holdingsInfo ? await hooks.holdingsInfo(run) : null;
        run.holdingsContext = hi;
        extra.sizing = sizing ? `Price ${U.round(p, 2)} · ATR14 ${U.round(t.atr14, 2) ?? "n/a"} · ATR stop (2.5×ATR) ${U.round(sizing.atrStop, 2) ?? "n/a"} · support-based stop ${U.round(sizing.supStop, 2) ?? "n/a"} · suggested stop ${U.round(sizing.suggestedStop, 2) ?? "n/a"} (${isN(sizing.stopDistance) ? (sizing.stopDistance * 100).toFixed(1) + "% below" : "n/a"})`
          + (isN(sizing.positionPct) ? ` · risk-budget size ${sizing.shares} shares ≈ ${sizing.positionPct.toFixed(1)}% of portfolio` + (sizing.cappedPct ? ` (cap for ${run.profile.risk} profile: ${sizing.cappedPct}%)` : "") : " · portfolio size not set in profile")
          + (isN(sizing.pctOfAdv) ? ` · position ≈ ${sizing.pctOfAdv.toFixed(2)}% of average daily dollar volume` : "")
          + (run.evm ? ` · CIO expected value ${U.round(run.evm.ev, 2)} (${U.pct(run.evm.expReturn)}), downside-weighted ${U.pct(run.evm.downside)}` : "") : "No price available; size from the CIO's scenarios.";
        extra.holdings = hi && hi.text ? "Existing portfolio:\n" + hi.text : "No holdings entered.";
      }
      const full = !run.lean || ["devil", "cio", "pm"].includes(seat.id);
      const model = PL.modelFor(seat.id, run, st);
      const o = {engine: run.engine, settings: st, apiKey: hooks.apiKey, model, system,
        blocks: P.recordBlocks(run, stage, {includeData: seat.id === "cio" || seat.id === "pm", full, rawDocs: seat.id === "hunter"}), task: P.seatPrompt(run, seat, P.seatContext(run, seat, extra)),
        schemaKey: seat.id, maxUses: run.lean ? n : (n > 0 || (+st.searchDepth && run.engine === "api") ? globalCap(st) : 0)};
      jobs.push({id: seat.id, customId: seat.id, target: rep, o, onDone: out => {
        Object.assign(rep, {text: out.text, data: out.data, sources: out.sources, searches: out.searches || rep.searches, usage: out.usage, status: "done", ms: rep.status === "running" && rep.t0 ? Date.now() - rep.t0 : rep.ms || 0, model});
        if (seat.id === "scout" && out.data && run.factsheet && run.factsheet.fin && !run.factsheet.valuation) {
          const d = out.data, px = run.factsheet.tech?.price;
          const sh = U.num(d.shares_outstanding) || (U.num(d.market_cap) && px ? U.num(d.market_cap) / px : null);
          if (sh && AIC.valuate(run.factsheet, sh, U.num(d.shares_outstanding) ? "shares from Data Scout (web, verify)" : "implied from Data Scout market cap (web, verify)", st)) {
            const fs = run.factsheet; fs.notes = (fs.notes || []).filter(x => !/^Valuation pending/.test(x));
            fs.leading = C.leadingSignals(fs); fs.markdown = C.factsheetMarkdown(fs); run.reports.desk.text = fs.markdown;
          }
        }
        if (seat.id === "scout" && (!run.factsheet || run.factsheet.status !== "ok") && out.data) {
          run.playbook = AIC.pickPlaybook(null, out.data.sector, out.data.instrument_type);
          if (run.factsheet) run.factsheet.playbook = run.playbook;
        }
      }});
      rep.t0 = Date.now();
    }
    await runJobs(run, jobs, hooks);
    PL.derive(run); upd(run, null); hooks.save && await hooks.save(run);
    capCheck();
  }
  PL.derive(run);
  run.status = "done"; run.completedAt = Date.now();
  upd(run, null);
  return run;
};

/* Stage 8: attacked seats respond to the Devil's Advocate (lean plans: serious critiques only) */
PL.rebuttals = async function (run, hooks, system) {
  const st = hooks.settings, upd = hooks.onUpdate || (() => {});
  const rep = run.reports.rebuttal; if (!rep || rep.status === "done") return;
  if (!run.rebuttals || !run.rebuttals.length) {
    const sev = {high: 3, medium: 2, low: 1};
    const crit = (run.reports.devil?.data?.critiques || []).filter(c => c && c.target && run.reports[c.target]?.status === "done" && AIC.seat(c.target) && !["cio", "pm", "devil", "mscout", "fscout"].includes(c.target) && (!run.lean || c.severity === "high"));
    const byTarget = {};
    crit.forEach(c => { const k = c.target; if (!byTarget[k] || sev[c.severity] > sev[byTarget[k].severity]) byTarget[k] = c; });
    const targets = Object.values(byTarget).sort((a, b) => (sev[b.severity] || 0) - (sev[a.severity] || 0)).slice(0, run.lean ? 2 : 4);
    if (!targets.length) { rep.status = "done"; rep.text = run.lean ? "No serious critiques to answer, so no rebuttals were needed." : "No seat-specific critiques to answer."; rep.ms = 0; upd(run, "rebuttal"); return; }
    run.rebuttals = targets.map(c => ({seat: c.target, critique: c.issue, severity: c.severity, status: "queued", text: ""}));
  }
  rep.status = "running"; const t0 = Date.now(); upd(run, "rebuttal");
  const jobs = run.rebuttals.filter(rb => rb.status !== "done").map((rb, i) => {
    const seat = AIC.seat(rb.seat), model = PL.modelFor(rb.seat, run, st);
    const own = run.lean ? `\nYOUR ORIGINAL REPORT:\n${(run.reports[rb.seat]?.text || "").slice(0, 8000)}\n` : "";
    return {id: "rebuttal", customId: "rebuttal-" + rb.seat, target: rb, o: {engine: run.engine, settings: st, apiKey: hooks.apiKey, model, system, blocks: P.recordBlocks(run, 8),
      task: `=== REBUTTAL — you are ${seat.name.toUpperCase()} (${seat.role}) ===${own}\n` + P.tasks.rebuttal({T: run.ticker, critique: rb.critique}), schemaKey: "rebuttal", maxUses: run.lean ? 0 : (+st.searchDepth && run.engine === "api" ? globalCap(st) : 0)},
      onDone: out => {
        Object.assign(rb, {text: out.text, data: out.data, usage: out.usage, status: "done"});
        if (out.data && isN(out.data.revised_score)) { const sc = AIC.SCHEMAS[rb.seat]?.score; const d = run.reports[rb.seat].data; const v = U.clamp(Math.round(out.data.revised_score), 1, 10); if (sc && d && d[sc] !== v) { d._original_score = d[sc]; d[sc] = v; } }
      }};
  });
  try { await runJobs(run, jobs, hooks); }
  catch (e) { rep.status = e.code === "cancelled" ? "stopped" : e.code === "deferred" ? "waiting" : "error"; rep.error = e.code === "deferred" ? null : e.message; upd(run, "rebuttal"); throw e; }
  rep.usage = null; run.rebuttals.forEach(r => rep.usage = U.addUsage(rep.usage, r.usage)); run.rebuttals.forEach(r => r.usage = null);
  rep.text = run.rebuttals.map(r => `**${AIC.seat(r.seat).name}** — critique (${r.severity}): ${r.critique}\n\n${r.text || "_no response_"}`).join("\n\n---\n\n");
  rep.ms = Date.now() - t0; rep.status = "done"; upd(run, "rebuttal");
};

/* Ask a seat a follow-up question (always instant) */
PL.ask = async function (run, seatId, question, hooks) {
  const st = hooks.settings, seat = AIC.seat(seatId);
  const prev = (run.qa || []).filter(x => x.agent === seatId && x.a).slice(-3).map(x => `Q: ${x.q}\nA: ${x.a}`).join("\n\n");
  const task = `=== QUESTION FOR ${seat.name.toUpperCase()} (${seat.role}) ===\n${prev ? "Your earlier answers to this member:\n" + prev + "\n\n" : ""}A fund member asks you directly: ${question}\n\nAnswer in character, directly and concisely (under 250 words). Back claims with the committee record or fresh evidence, and say plainly if the question changes your view. No JSON block is needed for this answer.`;
  return E.call({engine: run.engine, settings: st, apiKey: hooks.apiKey, model: PL.modelFor(seatId, run, st), system: P.houseRules(run.engine, run.ticker, run),
    blocks: P.recordBlocks(run, 99, {full: true}), task, schemaKey: null, maxUses: run.engine === "api" && +st.searchDepth ? 2 : 0, signal: hooks.signal, onText: hooks.onText, onSearch: () => {}});
};
})(typeof globalThis !== "undefined" ? globalThis : window);
