/* Pipeline: staged committee with parallel seats, rebuttal round, budget guard, derived analytics. */
(function (G) {
"use strict";
const AIC = G.AIC, U = AIC.util, C = AIC.compute, P = AIC.prompts, E = AIC.engine;
const PL = AIC.pipeline = {};
const isN = U.isNum;

PL.seatsForMode = function (mode, settings) {
  if (mode === "custom") return (settings.customSeats && settings.customSeats.length ? settings.customSeats : AIC.MODES.standard.seats).filter(id => AIC.seat(id));
  return (AIC.MODES[mode] || AIC.MODES.standard).seats.slice();
};

PL.newRun = function ({ticker, mode, profile, settings, prior, member, engine}) {
  const seats = PL.seatsForMode(mode, settings);
  if (!seats.includes("desk")) seats.unshift("desk");
  const reports = {};
  seats.forEach(id => reports[id] = {status: "queued", text: "", data: null, sources: [], searches: [], usage: null, ms: 0});
  return {id: U.uid(), ticker, createdAt: Date.now(), mode, seats, engine,
    model: engine === "claude" ? "claude.ai · most capable tier" : settings.model, promptVersion: AIC.PROMPT_VERSION, appVersion: AIC.VERSION,
    profile: Object.assign({}, profile), member: member || {note: "", docs: []},
    prior: prior ? {id: prior.id, createdAt: prior.createdAt, verdict: prior.cio?.verdict, overall: prior.cio?.overall, cio: prior.reports?.cio?.text || "", pm: prior.reports?.pm?.text || ""} : null,
    reanalysis: !!prior, reports, rebuttals: [], factsheet: null, playbook: null, status: "running", qa: [], usage: null};
};

PL.seatScore = function (id, data) {
  if (!data) return null; const sc = AIC.SCHEMAS[id]; if (!sc || !sc.score) return null;
  const v = data[sc.score]; return isN(v) ? v : null;
};
PL.lean = function (run) {
  const scores = run.seats.map(id => PL.seatScore(id, run.reports[id]?.data)).filter(isN);
  const bull = run.reports.bull?.data, bear = run.reports.bear?.data;
  const avg = U.mean(scores);
  return {avg: avg == null ? "n/a" : avg.toFixed(1), side: avg == null || avg >= 5.5 ? "LONG" : "SHORT", bullP: bull?.upside_probability_pct, bearRisk: bear?.score_risk};
};
PL.priceOf = run => run.factsheet?.tech?.price ?? run.reports.scout?.data?.price ?? null;
PL.totalUsage = function (run) {
  let u = null; for (const id in run.reports) u = U.addUsage(u, run.reports[id].usage); (run.rebuttals || []).forEach(r => u = U.addUsage(u, r.usage)); (run.qa || []).forEach(q => u = U.addUsage(u, q.usage)); return u;
};

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
  run.usage = PL.totalUsage(run);
  return run;
};

function searchesFor(seat, run, st) {
  if (run.engine !== "api") return 0;
  const depth = +st.searchDepth; if (!depth) return 0;
  if ((st.noSearchSeats || []).includes(seat.id)) return 0;
  const scale = AIC.MODES[run.mode]?.searchScale || 1;
  return seat.search ? Math.max(1, Math.round(seat.search * depth * scale)) : 0;
}
const globalCap = st => Math.max(1, Math.ceil(6 * (+st.searchDepth || 0)));
function modelFor(seat, st) {
  if (seat.id === "devil" && st.devilModel) return st.devilModel;
  if (seat.retrieval && st.retrievalModel) return st.retrievalModel;
  return st.model;
}

/* Run (or resume) the pipeline. hooks: {settings, apiKey, signal, onUpdate(run, seatId, kind), calibrationNote, holdingsInfo(run) -> {text, sizingInput}} */
PL.execute = async function (run, hooks) {
  const st = hooks.settings, upd = hooks.onUpdate || (() => {});
  run.status = "running";
  const system = P.houseRules(run.engine, run.ticker, run);
  const budgetCheck = () => {
    if (!st.budget) return; const cost = U.costOf(PL.totalUsage(run), st);
    if (cost != null && cost > +st.budget) { const e = new E.EngineError(`Budget of $${(+st.budget).toFixed(2)} reached (≈$${cost.toFixed(2)} spent). Raise the budget in Settings and press Resume to continue.`, "budget"); throw e; }
  };

  // ---- stage 0: Data Desk + Member's note (code only)
  const desk = run.reports.desk;
  if (desk && desk.status !== "done") {
    desk.status = "running"; const t0 = Date.now(); upd(run, "desk");
    try {
      run.factsheet = await AIC.buildFactsheet(run.ticker, {docs: run.member?.docs, settings: st, signal: hooks.signal, onProgress: m => { desk.progress = m; upd(run, "desk", "stream"); }});
      run.playbook = run.factsheet.playbook; desk.text = run.factsheet.markdown; desk.status = "done";
    } catch (e) { desk.status = "done"; desk.error = "Data Desk failed: " + e.message; run.factsheet = {ticker: run.ticker, status: "error", notes: [e.message], playbook: AIC.pickPlaybook()}; run.playbook = run.factsheet.playbook; }
    desk.ms = Date.now() - t0; upd(run, "desk");
  }
  if (run.reports.member && run.reports.member.status !== "done") {
    const m = run.member || {}; const has = (m.note && m.note.trim()) || (m.docs || []).length;
    run.reports.member.status = has ? "done" : "skipped";
    run.reports.member.text = has ? `${m.note || ""}${(m.docs || []).length ? "\n\nDocuments: " + m.docs.map(d => `${d.name} (${d.kind}, ${U.fmtNum(d.text?.length || 0, 0)} chars)`).join(", ") : ""}` : "";
    upd(run, "member");
  }

  const stages = [...new Set(run.seats.map(id => AIC.seat(id).stage))].filter(s => s > 0).sort((a, b) => a - b);
  for (const stage of stages) {
    if (hooks.signal?.aborted) throw new E.EngineError("Stopped.", "cancelled");
    const seats = run.seats.map(AIC.seat).filter(s => s.stage === stage && run.reports[s.id].status !== "done");
    if (!seats.length) continue;
    if (stage === 7 || stage === 9) PL.derive(run);
    if (stage === 8) { await PL.rebuttals(run, hooks, system); budgetCheck(); continue; }
    const runSeat = async seat => {
      const rep = run.reports[seat.id];
      rep.status = "running"; rep.text = ""; rep.searches = []; rep.sources = []; rep.error = null; rep.data = null;
      const t0 = Date.now(); upd(run, seat.id);
      const n = searchesFor(seat, run, st);
      const extra = {searches: n};
      if (seat.id === "devil") {
        extra.lean = PL.lean(run);
        extra.present = run.seats.filter(id => !["desk","member","devil","rebuttal","cio","pm"].includes(id)).map(id => AIC.seat(id).name).join(", ");
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
        const ddPct = U.num(run.profile.dd);
        const sizing = C.sizing({price: p, atr: t.atr14, stopPrice: null, support: chartD.invalidation ?? (chartD.support || [])[0], portfolio: U.num(run.profile.size), riskPct: U.num(run.profile.riskPerTrade) || 1,
          riskProfile: run.profile.risk, adv: t.adv20, ddPct});
        run.sizing = sizing;
        const hi = hooks.holdingsInfo ? await hooks.holdingsInfo(run) : null;
        run.holdingsContext = hi;
        extra.sizing = sizing ? `Price ${U.round(p, 2)} · ATR14 ${U.round(t.atr14, 2) ?? "n/a"} · ATR stop (2.5×ATR) ${U.round(sizing.atrStop, 2) ?? "n/a"} · support-based stop ${U.round(sizing.supStop, 2) ?? "n/a"} · suggested stop ${U.round(sizing.suggestedStop, 2) ?? "n/a"} (${isN(sizing.stopDistance) ? (sizing.stopDistance * 100).toFixed(1) + "% below" : "n/a"})`
          + (isN(sizing.positionPct) ? ` · risk-budget size ${sizing.shares} shares ≈ ${sizing.positionPct.toFixed(1)}% of portfolio` + (sizing.cappedPct ? ` (cap for ${run.profile.risk} profile: ${sizing.cappedPct}%)` : "") : " · portfolio size not set in profile")
          + (isN(sizing.pctOfAdv) ? ` · position ≈ ${sizing.pctOfAdv.toFixed(2)}% of average daily dollar volume` : "")
          + (run.evm ? ` · CIO expected value ${U.round(run.evm.ev, 2)} (${U.pct(run.evm.expReturn)}), downside-weighted ${U.pct(run.evm.downside)}` : "") : "No price available; size from the CIO's scenarios.";
        extra.holdings = hi && hi.text ? "Existing portfolio:\n" + hi.text : "No holdings entered.";
      }
      const ctx = P.seatContext(run, seat, extra);
      try {
        const out = await E.call({engine: run.engine, settings: st, apiKey: hooks.apiKey, model: modelFor(seat, st), system,
          blocks: P.recordBlocks(run, stage, {includeData: seat.id === "cio" || seat.id === "pm"}), task: P.seatPrompt(run, seat, ctx),
          schemaKey: seat.id, unified: true, maxUses: n > 0 ? globalCap(st) : (+st.searchDepth && run.engine === "api" ? globalCap(st) : 0), signal: hooks.signal,
          onText: txt => { rep.text = txt; upd(run, seat.id, "stream"); }, onSearch: q => { rep.searches.push(q); upd(run, seat.id, "stream"); }});
        Object.assign(rep, {text: out.text, data: out.data, sources: out.sources, usage: out.usage, status: "done", ms: Date.now() - t0});
        if (seat.id === "scout" && (!run.factsheet || run.factsheet.status !== "ok") && out.data) {
          run.playbook = AIC.pickPlaybook(null, out.data.sector, out.data.instrument_type);
          if (run.factsheet) run.factsheet.playbook = run.playbook;
        }
      } catch (e) {
        Object.assign(rep, {text: e.partial || rep.text || "", status: e.code === "cancelled" ? "stopped" : "error", error: e.message, ms: Date.now() - t0});
        throw e;
      } finally { upd(run, seat.id); }
    };
    if (st.parallel !== false && seats.length > 1) {
      const res = await Promise.allSettled(seats.map(runSeat));
      const bad = res.find(r => r.status === "rejected"); if (bad) throw bad.reason;
    } else for (const s of seats) await runSeat(s);
    PL.derive(run); upd(run, null);
    budgetCheck();
  }
  PL.derive(run);
  run.status = "done"; run.completedAt = Date.now();
  upd(run, null);
  return run;
};

/* Stage 8: attacked seats respond to the Devil's Advocate */
PL.rebuttals = async function (run, hooks, system) {
  const st = hooks.settings, upd = hooks.onUpdate || (() => {});
  const rep = run.reports.rebuttal; if (!rep) return;
  const crit = (run.reports.devil?.data?.critiques || []).filter(c => c && c.target && run.reports[c.target]?.status === "done" && AIC.seat(c.target) && !["cio","pm","devil"].includes(c.target));
  const sev = {high: 3, medium: 2, low: 1};
  const byTarget = {};
  crit.forEach(c => { const k = c.target; if (!byTarget[k] || sev[c.severity] > sev[byTarget[k].severity]) byTarget[k] = c; });
  const targets = Object.values(byTarget).sort((a, b) => (sev[b.severity] || 0) - (sev[a.severity] || 0)).slice(0, 4);
  rep.status = "running"; const t0 = Date.now(); upd(run, "rebuttal");
  if (!targets.length) { rep.status = "done"; rep.text = "No seat-specific critiques to answer."; rep.ms = 0; upd(run, "rebuttal"); return; }
  run.rebuttals = targets.map(c => ({seat: c.target, critique: c.issue, severity: c.severity, status: "running", text: ""}));
  const results = await Promise.allSettled(run.rebuttals.map(async rb => {
    const seat = AIC.seat(rb.seat);
    const task = `=== REBUTTAL — you are ${seat.name.toUpperCase()} (${seat.role}) ===\n` + P.tasks.rebuttal({T: run.ticker, critique: rb.critique});
    const out = await E.call({engine: run.engine, settings: st, apiKey: hooks.apiKey, model: st.model, system, blocks: P.recordBlocks(run, 8),
      task, schemaKey: "rebuttal", unified: true, maxUses: +st.searchDepth && run.engine === "api" ? globalCap(st) : 0, signal: hooks.signal,
      onText: t => { rb.text = t; upd(run, "rebuttal", "stream"); }});
    Object.assign(rb, {text: out.text, data: out.data, usage: out.usage, status: "done"});
    if (out.data && isN(out.data.revised_score)) { const sc = AIC.SCHEMAS[rb.seat]?.score; const d = run.reports[rb.seat].data; if (sc && d && d[sc] !== U.clamp(Math.round(out.data.revised_score), 1, 10)) { d._original_score = d[sc]; d[sc] = U.clamp(Math.round(out.data.revised_score), 1, 10); } }
  }));
  rep.usage = null; run.rebuttals.forEach(r => rep.usage = U.addUsage(rep.usage, r.usage));
  rep.text = run.rebuttals.map(r => `**${AIC.seat(r.seat).name}** — critique (${r.severity}): ${r.critique}\n\n${r.text || "_no response_"}`).join("\n\n---\n\n");
  rep.ms = Date.now() - t0;
  const bad = results.find(r => r.status === "rejected");
  if (bad) { rep.status = bad.reason?.code === "cancelled" ? "stopped" : "error"; rep.error = bad.reason?.message; upd(run, "rebuttal"); throw bad.reason; }
  rep.status = "done"; upd(run, "rebuttal");
};

/* Ask a seat a follow-up question */
PL.ask = async function (run, seatId, question, hooks) {
  const st = hooks.settings, seat = AIC.seat(seatId);
  const prev = (run.qa || []).filter(x => x.agent === seatId && x.a).slice(-3).map(x => `Q: ${x.q}\nA: ${x.a}`).join("\n\n");
  const task = `=== QUESTION FOR ${seat.name.toUpperCase()} (${seat.role}) ===\n${prev ? "Your earlier answers to this member:\n" + prev + "\n\n" : ""}A fund member asks you directly: ${question}\n\nAnswer in character, directly and concisely (under 250 words). Back claims with the committee record or fresh evidence, and say plainly if the question changes your view. Do not call submit_report.`;
  return E.call({engine: run.engine, settings: st, apiKey: hooks.apiKey, model: st.model, system: P.houseRules(run.engine, run.ticker, run),
    blocks: P.recordBlocks(run, 99), task, schemaKey: null, maxUses: run.engine === "api" && +st.searchDepth ? 2 : 0, signal: hooks.signal, onText: hooks.onText, onSearch: () => {}});
};
})(typeof globalThis !== "undefined" ? globalThis : window);
