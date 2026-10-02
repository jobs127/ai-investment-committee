/* Analysis view: console, staged board, verdict/EV/variant/plan, tabs (minutes, data desk, chart, evidence, debate, Q&A). */

function seatsShown() { return S.run ? S.run.seats : PL.seatsForMode(S.mode, S.settings); }

function renderConsole() {
  const sel = $("#modeSel");
  if (!sel.options.length) sel.innerHTML = Object.entries(A.MODES).map(([k, m]) => `<option value="${k}">${esc(m.label)}</option>`).join("");
  sel.value = S.mode; $("#modeNote").textContent = A.MODES[S.mode]?.note || "";
  const T = U.normTicker($("#ticker").value), r = S.run;
  const prior = S.index.find(h => h.ticker === T && h.status === "done");
  $("#runBtn").disabled = S.running; $("#stopBtn").hidden = !S.running;
  $("#reBtn").hidden = S.running || !T || !prior;
  $("#resumeBtn").hidden = S.running || !r || ["done", "running"].includes(r.status) || T !== r.ticker;
  $("#ticker").disabled = S.running; sel.disabled = S.running;
  $("#memberCount").textContent = (S.member.note.trim() ? "note" : "") + (S.member.docs.length ? (S.member.note.trim() ? " + " : "") + S.member.docs.length + " doc" + (S.member.docs.length > 1 ? "s" : "") : "") || "empty";
  $("#docChips").innerHTML = S.member.docs.map((d, i) => `<span class="fchip">${esc(d.name)} <small>${esc(d.kind)} · ${U.fmtNum(d.text.length, 0)} chars</small><button type="button" data-rmdoc="${i}" aria-label="Remove ${esc(d.name)}">×</button></span>`).join("");
  $("#askBar").hidden = !(r && S.view === "analysis" && r.seats.some(id => r.reports[id]?.status === "done" && !A.seat(id).code_only));
  $("#askBtn").disabled = S.running || S.asking;
  renderPlans();
  $("#hint").textContent = S.running ? "The committee is in session — each stage reads every earlier stage; seats in a stage work in parallel" : "Enter one stock or ETF ticker · choose a mode · optionally add your note and documents · run";
}

function renderPlans() {
  const box = $("#planBox"), est = $("#estLine"), show = S.engine === "api";
  box.hidden = est.hidden = !show; if (!show) return;
  box.innerHTML = Object.entries(A.PLANS).map(([k, p]) => `<button type="button" role="radio" class="plan-opt" data-plan="${k}" aria-checked="${S.plan === k}" ${S.running ? "disabled" : ""}><b>${esc(p.label)}</b><span>${esc(p.short)}</span></button>`).join("");
  const e = Cost.estimate(S.mode, S.plan), spent = Cost.spentThisMonth(), b = U.num(S.settings.monthlyBudget);
  est.innerHTML = `Estimated <b class="num">≈ $${e.cost.toFixed(2)}</b> for this run · ${esc(e.minutes)} · spent this month <b class="num">$${spent.toFixed(2)}</b>${U.isNum(b) && b > 0 ? ` of $${b.toFixed(0)}` : ""}${S.plan === "saver" ? ` · <span class="muted">you can close the tab while it waits — it picks up when you come back</span>` : ""}`;
}

function waitMins(r) { const t = r?.batchInfo?.since || r?.batch?.submittedAt; return t ? Math.max(0, Math.round((Date.now() - t) / 60000)) : 0; }

function renderBoard() {
  const ids = seatsShown(), run = S.run;
  const stages = [...new Set(ids.map(id => A.seat(id).stage))].sort((a, b) => a - b);
  const stageName = {0: "Data", 1: "Facts", 2: "Expectations", 3: "Field work", 4: "Analysis", 5: "Calendar & history", 6: "Bull vs Bear", 7: "Critique", 8: "Rebuttals", 9: "Verdict", 10: "Execution"};
  $("#board").innerHTML = stages.map(st => `<div class="stage"><div class="stage-l"><span class="num">${st}</span>${stageName[st] || ""}</div><div class="stage-seats">${
    ids.filter(id => A.seat(id).stage === st).map(id => {
      const a = A.seat(id), r = run?.reports[id]; const s = r?.status || "idle";
      let state = "";
      if (s === "running") state = id === "desk" ? (r.progress || "fetching…") : r.searches?.length ? `searching · ${r.searches.length}` : "writing…";
      else if (s === "done") { const sc = PL.seatScore(id, r.data); state = `✓ ${secs(r.ms || 0)}${sc ? " · " + sc + "/10" : ""}${r.usage?.searches ? " · " + r.usage.searches + " src" : ""}`; }
      else if (s === "waiting") state = `⧗ queued at Anthropic · ${waitMins(r)}m`;
      else if (s === "skipped") state = id === "member" ? "no input" : "skipped (saves cost)"; else if (s !== "idle") state = s;
      if (s === "done" && r.reused) state = "↺ reused · free";
      return `<button class="seat" type="button" data-st="${s}" data-id="${id}" style="--c:${a.color}"><span class="glyph">${a.code}</span><span class="name">${esc(a.name)}</span><span class="blurb">${esc(a.blurb)}</span>${state ? `<span class="state">${esc(state)}</span>` : ""}</button>`;
    }).join("")}</div></div>`).join("");
}

function renderProgress(t0) {
  const p = $("#progress"), run = S.run; if (!run) { p.hidden = true; return; }
  p.hidden = false;
  const ids = run.seats.filter(id => run.reports[id].status !== "skipped");
  const waiting = ids.filter(id => run.reports[id].status === "waiting");
  const done = ids.filter(id => run.reports[id].status === "done").length;
  const cur = ids.filter(id => run.reports[id].status === "running").map(id => A.seat(id).name);
  $("#progBar").style.width = (done / ids.length * 100) + "%";
  $("#progStep").textContent = S.running && waiting.length ? `WAITING FOR ANTHROPIC'S BATCH · ${waiting.map(id => A.seat(id).name).join(" · ").toUpperCase()} · ${waitMins(run.reports[waiting[0]])} MIN` : S.running && cur.length ? cur.join(" · ").toUpperCase() : `${done}/${ids.length} SEATS · ${run.status.toUpperCase()}`;
  const u = PL.totalUsage(run), cost = PL.totalCost(run), cap = +S.settings.runCap;
  $("#progMeta").textContent = (u ? `${fmtK(u.in + u.cacheRead + u.cacheWrite)} in${u.cacheRead ? " (" + fmtK(u.cacheRead) + " cached)" : ""} · ${fmtK(u.out)} out · ${u.searches} searches` : run.engine === "claude" ? "claude.ai engine" : "")
    + (run.engine === "api" ? ` · $${cost.toFixed(2)}${cap ? " of $" + cap.toFixed(2) + " cap" : ""}` : "") + (run.plan && run.engine === "api" ? " · " + (A.PLANS[run.plan]?.label || run.plan) : "") + (S.running && t0 ? ` · ${secs(Date.now() - t0)}` : "");
}

/* ---------------- results ---------------- */
function renderResults() {
  const box = $("#results"), run = S.run;
  if (!run) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  const c = run.cio, fs = run.factsheet || {}, price = PL.priceOf(run);
  let h = "";
  const scr = run.reports.screen?.data;
  if (!c && scr) {
    const col = scr.call === "PROMISING" ? "var(--good)" : scr.call === "PASS" ? "var(--bad)" : "var(--warn)";
    h += `<div class="sechead"><span class="lbl">Screen · ${esc(run.ticker)}${fs.company?.name ? " · " + esc(fs.company.name) : ""}</span><span class="muted small">${esc(fmtDate(run.createdAt))} · ${U.isNum(run.cost) ? "$" + run.cost.toFixed(2) : ""}</span></div>
      <div class="card hero" style="--v:${col}"><div class="hero-top"><div class="big num">${scr.score_screen ?? "–"}<small>/ 10</small></div><div class="verdict-box"><span class="chip" style="color:${col}">${esc(scr.call || "—")}</span><span class="conv">Quick screen — not a verdict</span></div></div>
      ${(scr.reasons || []).length ? `<p><b>Why</b></p><ul class="tight">${scr.reasons.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${(scr.questions || []).length ? `<p><b>What the full committee should answer</b></p><ul class="tight">${scr.questions.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <div class="row-actions"><button class="btn primary small" type="button" data-send="${esc(run.ticker)}" data-mode="standard">▶ Run the full committee</button></div></div>`;
  }
  if (c) {
    const vc = verdictColor(c.verdict), ov = c.overall;
    h += `<div class="sechead"><span class="lbl">Scorecard · ${esc(run.ticker)}${fs.company?.name ? " · " + esc(fs.company.name) : ""}</span>
      <span class="muted small">${esc(fmtDate(run.createdAt))} · ${esc(A.MODES[run.mode]?.label || run.mode)} · ${esc(run.model)}${run.reanalysis ? " · re-analysis" : ""}</span>
      <button class="btn small" data-act="csv" type="button">⇩ CSV/Excel</button><button class="btn small" data-act="html" type="button">⇩ Report</button><button class="btn small" data-act="ics" type="button">⇩ Calendar</button></div>
    <div class="grid-hero">
      <div class="card hero" style="--v:${vc}">
        <div class="hero-top"><div class="big num">${ov ?? "–"}<small>/ 10</small></div>
          <div class="verdict-box"><span class="chip" style="color:${vc}">${esc(c.verdict || "—")}</span><span class="conv">Conviction: ${esc(c.conviction || "—")}</span>${c.change_vs_prior ? `<span class="conv" style="color:var(--accent)">vs prior: ${esc(c.change_vs_prior)}</span>` : ""}</div></div>
        <div class="ticks">${Array.from({length: 10}, (_, k) => `<i class="${ov != null && k < ov ? "on" : ""}"></i>`).join("")}</div>
        <div class="qp">
          <div><span class="k">Business quality</span><b class="num" style="color:${scoreColor(c.quality_score)}">${c.quality_score ?? "–"}</b><div class="m"><i style="width:${(c.quality_score || 0) * 10}%;background:${scoreColor(c.quality_score)}"></i></div></div>
          <div><span class="k">Price attractiveness</span><b class="num" style="color:${scoreColor(c.price_score)}">${c.price_score ?? "–"}</b><div class="m"><i style="width:${(c.price_score || 0) * 10}%;background:${scoreColor(c.price_score)}"></i></div></div>
        </div>
        <p class="meanline">CIO score <b class="num">${ov ?? "–"}</b> · formula score <b class="num">${c.formula ?? "–"}</b> <span class="muted">(${U.isNum(c.quality_score) ? "½ quality + ½ price" : "mean of dimensions"})</span>. ${esc(c.score_reasoning || "")}</p>
        ${S.calNote ? `<p class="calnote">${esc(S.calNote)}</p>` : ""}
        ${(run.consistency || []).length ? `<div class="warnbox"><b>Consistency check</b>${run.consistency.map(x => `<div>${esc(x)}</div>`).join("")}</div>` : ""}
      </div>
      <div class="card ev">
        <h3>Expected value</h3>
        ${run.evm && U.isNum(price) ? Charts.scenarios(run.evm, price) + `<dl class="kv4">
          <div><dt>Expected value</dt><dd class="num">${n2(run.evm.ev)}</dd></div><div><dt>Expected return</dt><dd class="num" style="color:${run.evm.expReturn >= 0 ? "var(--good)" : "var(--bad)"}">${spct(run.evm.expReturn)}</dd></div>
          <div><dt>Downside-weighted</dt><dd class="num">${spct(run.evm.downside)}</dd></div><div><dt>Up/down ratio</dt><dd class="num">${U.isNum(run.evm.upDownRatio) ? run.evm.upDownRatio.toFixed(1) + "×" : "–"}</dd></div>
          <div><dt>Margin of safety (base)</dt><dd class="num">${spct(run.evm.marginOfSafety)}</dd></div><div><dt>Horizon</dt><dd class="num">${run.evm.horizon ? run.evm.horizon + " mo" : "–"}</dd></div></dl>` : `<p class="muted small">Scenarios or a current price are missing, so expected value couldn't be computed.</p>`}
      </div>
    </div>`;
    // variant perception
    const ex = run.reports.expect?.data || {}, hu = run.reports.hunter?.data || {};
    const implied = U.isNum(fs.reverseDcf?.impliedGrowth) ? fs.reverseDcf.impliedGrowth : (U.isNum(ex.implied_growth_pct) ? ex.implied_growth_pct / 100 : null);
    const cats = (run.reports.catalyst?.data?.catalysts || []).slice(0, 4);
    h += `<div class="grid3">
      <div class="card vp"><h3>Market implies</h3><p class="bignum num">${implied != null ? spct(implied) : "–"}<small> annual growth</small></p><p class="small muted">${esc(fs.reverseDcf?.method ? "Reverse DCF on " + fs.reverseDcf.method : "From Market Expectations")}</p><p>${esc(ex.consensus_narrative || "")}</p>
        ${(ex.what_must_be_true || []).length ? `<ul class="tight">${ex.what_must_be_true.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>
      <div class="card vp"><h3>Committee believes</h3><p>${esc(c.variant_view || "No variant view stated.")}</p>${U.isNum(hu.intrinsic_low) ? `<p class="small">Data Hunter intrinsic value: <b class="num">${n2(hu.intrinsic_low)}–${n2(hu.intrinsic_high)}</b></p>` : ""}
        ${(hu.situation_flags || []).length ? `<div class="flags">${hu.situation_flags.map(f => `<span class="tag">${esc(f)}</span>`).join("")}</div>` : ""}</div>
      <div class="card vp"><h3>What closes the gap</h3>${c.catalyst?.event ? `<p><b>${esc(c.catalyst.event)}</b> <span class="muted">${esc(c.catalyst.date || "")}</span></p>` : `<p class="muted">No catalyst named — patience required.</p>`}
        ${cats.length ? `<ul class="tight">${cats.map(x => `<li><span class="num muted">${esc(x.date)}</span> ${esc(x.event)} <span style="color:${x.impact === "negative" ? "var(--bad)" : x.impact === "positive" ? "var(--good)" : "var(--warn)"}">${esc(x.impact || "")}</span></li>`).join("")}</ul>` : ""}</div>
    </div>`;
    // dimensions
    const dims = [["Macro", "macro"], ["Fundamentals", "fundamentals"], ["Sentiment", "sentiment"], ["Risk", "risk"], ["Technicals", "technicals"], ["Management", "management"]];
    const seatTiles = ["industry", "scuttle", "forensic"].filter(id => run.reports[id]?.data).map(id => [A.seat(id).name, PL.seatScore(id, run.reports[id].data)]);
    h += `<div class="dims">${dims.map(([k, id]) => { const v = c.scores?.[id]; const col = scoreColor(v); return `<div class="dim"><div class="k">${k}</div><div class="v num" style="color:${col}">${v ?? "–"}</div><div class="m"><i style="width:${(v || 0) * 10}%;background:${col}"></i></div><div class="t">${scoreWord(v)}</div></div>`; }).join("")}
      ${seatTiles.map(([k, v]) => `<div class="dim seatdim"><div class="k">${esc(k)}</div><div class="v num" style="color:${scoreColor(v)}">${v ?? "–"}</div><div class="m"><i style="width:${(v || 0) * 10}%;background:${scoreColor(v)}"></i></div><div class="t">seat self-score</div></div>`).join("")}</div>`;
    h += `<div class="thesis card">${c.rationale ? `<div><b>Rationale</b>${esc(c.rationale)}</div>` : ""}${c.thesis ? `<div><b>Thesis</b>${esc(c.thesis)}</div>` : ""}
      ${(c.falsification || []).length ? `<div><b>Falsification</b><ul class="tight">${c.falsification.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      ${(c.monitoring || []).length ? `<div><b>Monitoring</b><ul class="tight">${c.monitoring.map(x => `<li>${x.date ? `<span class="num muted">${esc(x.date)}</span> ` : ""}${esc(x.item)}</li>`).join("")}</ul></div>` : ""}</div>`;
  }
  // plan
  if (run.pm || (c && S.running)) h += planHtml(run);
  // leading signals summary
  const ls = leadingAll(run);
  if (ls.length) h += `<div class="card"><h3 class="h3">Leading signals <span class="muted small">computed + field work</span></h3><ul class="signals">${ls.slice(0, 12).map(s => `<li><span class="dir" style="color:${dirColor(s.direction)}">${dirMark(s.direction)}</span><span><b>${esc(s.signal)}</b>${s.value ? ` <span class="num">${esc(s.value)}</span>` : ""} <span class="muted small">${esc(s.from)}${s.as_of ? " · " + esc(s.as_of) : ""}</span>${s.source_url ? ` <a href="${esc(s.source_url)}" target="_blank" rel="noopener noreferrer">source</a>` : ""}</span></li>`).join("")}</ul></div>`;
  if (c) h += journalFormHtml(run);
  box.innerHTML = h;
}
function leadingAll(run) {
  const out = [];
  (run.factsheet?.leading || []).forEach(s => out.push(Object.assign({from: "Data Desk"}, s)));
  (run.reports.industry?.data?.channel_signals || []).forEach(s => out.push({signal: s.signal, direction: s.direction, from: "Channel check · " + s.source, as_of: s.as_of, source_url: s.source_url}));
  (run.reports.scuttle?.data?.ground_signals || []).forEach(s => out.push({signal: s.observation, direction: s.direction, from: "Scuttlebutt · " + s.type, as_of: s.as_of, source_url: s.source_url}));
  (run.reports.sent?.data?.signals || []).forEach(s => out.push({signal: s.signal, direction: s.direction, from: "Sentiment", as_of: s.as_of, source_url: s.source_url}));
  const rank = d => d === "neutral" ? 1 : 0;
  return out.sort((a, b) => rank(a.direction) - rank(b.direction));
}
function planHtml(run) {
  const pm = run.pm, sz = run.sizing;
  if (!pm) return `<div class="card plan"><h3>Trade plan · Portfolio Manager</h3><p class="muted small">The Portfolio Manager writes the plan after the CIO's verdict.</p></div>`;
  return `<div class="card plan"><h3>Trade plan · Portfolio Manager</h3>
    ${pm.action ? `<p class="action">${esc(pm.action)}</p>` : ""}
    <div class="plan-grid">
      <div>
        <dl class="kv"><dt>Position</dt><dd>${U.isNum(pm.position_pct_target) ? pm.position_pct_target + "% target" : "–"}${U.isNum(pm.position_pct_max) ? " · " + pm.position_pct_max + "% max" : ""}</dd>
        ${pm.risk_reward ? `<dt>Risk / reward</dt><dd>${esc(pm.risk_reward)}</dd>` : ""}${pm.review_trigger ? `<dt>Review</dt><dd>${esc(pm.review_trigger)}</dd>` : ""}</dl>
        ${(pm.tranches || []).length ? `<div class="tblwrap"><table class="tranches"><thead><tr><th>Tranche</th><th>Zone</th><th>Size</th><th>Trigger</th></tr></thead><tbody>${pm.tranches.map((t, k) => `<tr><td>T${k + 1}</td><td class="num">${n2(t.low)}${U.isNum(t.high) && t.high !== t.low ? "–" + n2(t.high) : ""}</td><td class="num">${U.isNum(t.pct) ? t.pct + "%" : "–"}</td><td>${esc(t.trigger || "")}</td></tr>`).join("")}</tbody></table></div>` : ""}
        <div class="levels">
          <div class="lvl stop"><div class="k">Stop</div><div class="v num">${n2(pm.stop?.price)}</div><div class="s">${esc(pm.stop?.type || "")}</div></div>
          ${(pm.targets || []).slice(0, 2).map((t, i) => `<div class="lvl tgt"><div class="k">Target ${i + 1}</div><div class="v num">${n2(t.price)}</div><div class="s">${esc(t.timeframe || "")}</div></div>`).join("")}
        </div>
      </div>
      <div>
        ${sz ? `<div class="computed"><span class="lbl">Computed in code</span><dl class="kv">
          <dt>ATR stop</dt><dd class="num">${n2(sz.atrStop)}</dd><dt>Support stop</dt><dd class="num">${n2(sz.supStop)}</dd>
          ${U.isNum(sz.positionPct) ? `<dt>Risk-budget size</dt><dd class="num">${sz.shares} sh · ${sz.positionPct.toFixed(1)}%${sz.cappedPct ? ` (cap ${sz.cappedPct}%)` : ""}</dd>` : `<dt>Risk-budget size</dt><dd class="muted">Set portfolio size in Settings → Profile</dd>`}
          ${U.isNum(sz.pctOfAdv) ? `<dt>Of daily volume</dt><dd class="num">${sz.pctOfAdv.toFixed(2)}%</dd>` : ""}</dl></div>` : ""}
        ${run.holdingsContext?.corr?.length ? `<div class="computed"><span class="lbl">Correlation with your holdings (1y daily)</span><div class="corrs">${run.holdingsContext.corr.slice(0, 6).map(x => `<span class="tag">${esc(x.ticker)} <b class="num">${U.isNum(x.corr) ? x.corr.toFixed(2) : "–"}</b></span>`).join("")}</div></div>` : ""}
        ${pm.alt_entry?.strategy ? `<p class="small"><b>Alternative entry:</b> ${esc(pm.alt_entry.strategy)}${U.isNum(+pm.alt_entry.strike) && pm.alt_entry.strike ? " · strike " + n2(+pm.alt_entry.strike) : ""}${pm.alt_entry.expiry ? " · " + esc(pm.alt_entry.expiry) : ""}. ${esc(pm.alt_entry.rationale || "")}</p>` : ""}
        ${pm.tax_note ? `<p class="small"><b>Tax:</b> ${esc(pm.tax_note)}</p>` : ""}${pm.liquidity_note ? `<p class="small"><b>Liquidity:</b> ${esc(pm.liquidity_note)}</p>` : ""}
        ${(pm.alerts || []).length ? `<p class="small"><b>Alerts:</b> ${pm.alerts.map(a => `${esc(a.type.replace("_", " "))} ${esc(a.value)}`).join(" · ")}</p>` : ""}
      </div>
    </div>
    <div class="row-actions"><button class="btn small" data-act="watch" type="button">＋ Watchlist with these alerts</button><button class="btn small" data-act="thesis" type="button">Track thesis</button><button class="btn small" data-act="alerts" type="button">⇩ Alerts CSV</button></div>
  </div>`;
}
function journalFormHtml(run) {
  const j = S.journal.find(x => x.runId === run.id) || {};
  return `<form class="card jform" id="jform"><h3 class="h3">Your decision</h3><div class="jrow">
    <select class="field" id="jDecision" aria-label="Decision">${["", "Bought", "Added", "Trimmed", "Sold", "Passed", "Watching"].map(o => `<option ${j.decision === o ? "selected" : ""} value="${o}">${o || "Choose…"}</option>`).join("")}</select>
    <input class="field" id="jPrice" placeholder="Price" value="${esc(j.price ?? "")}" inputmode="decimal" aria-label="Price">
    <input class="field" id="jSize" placeholder="Size (shares or %)" value="${esc(j.size ?? "")}" aria-label="Size">
    <input class="field grow" id="jNotes" placeholder="Why — in your words" value="${esc(j.notes ?? "")}" aria-label="Notes">
    <button class="btn primary small" type="submit">Log decision</button></div><p class="small muted">The journal compares your decisions with the committee's and tracks outcomes.</p></form>`;
}

/* ---------------- tabs ---------------- */
const TABS = [["minutes", "Minutes"], ["desk", "Data Desk"], ["chart", "Chart"], ["evidence", "Evidence"], ["debate", "Debate"], ["qa", "Q&A"], ["cost", "Cost"]];
function renderTabs() {
  const run = S.run, sec = $("#tabSec");
  if (!run) { sec.hidden = true; return; }
  sec.hidden = false;
  const counts = {evidence: run.ledger?.contradictions?.length, qa: run.qa?.length};
  $("#tabBar").innerHTML = TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}${counts[k] ? ` <span class="cnt">${counts[k]}</span>` : ""}</button>`).join("");
  const b = $("#tabBody");
  if (S.tab === "minutes") renderMinutes(b);
  else if (S.tab === "desk") b.innerHTML = deskHtml(run.factsheet);
  else if (S.tab === "chart") { b.innerHTML = `<div class="card" id="pchartBox"></div>${techHtml(run.factsheet)}`; Charts.price($("#pchartBox"), run.factsheet || {}, run, S.chartRange); }
  else if (S.tab === "evidence") b.innerHTML = evidenceHtml(run);
  else if (S.tab === "debate") b.innerHTML = debateHtml(run);
  else if (S.tab === "qa") renderQA(b);
  else if (S.tab === "cost") b.innerHTML = costHtml(run);
}

/* ---------- Cost ---------- */
function costHtml(run) {
  if (run.engine !== "api") return `<p class="muted">Runs inside claude.ai use your Claude plan, so there's no per-run bill to show.</p>`;
  const rows = run.seats.filter(id => !A.seat(id).code_only || id === "desk").map(id => { const r = run.reports[id] || {}, u = r.usage;
    const note = A.seat(id).code_only ? "computed in code · free" : r.reused ? "reused · free" : r.status === "skipped" ? "skipped" : r.status === "waiting" ? "waiting" : (u?.batch ? "batch ½ price" : r.status === "done" ? "instant" : r.status);
    return `<tr><td style="color:${A.seat(id).color}"><b>${esc(A.seat(id).name)}</b></td><td class="small">${esc(shortModel(r.model || u?.model || (A.seat(id).code_only ? "code" : "")))}</td><td class="small muted">${esc(note)}</td><td class="num">${u ? fmtK(u.in + (u.cacheRead || 0) + (u.cacheWrite || 0)) : "–"}</td><td class="num">${u ? fmtK(u.out) : "–"}</td><td class="num">${u?.searches ?? "–"}</td><td class="num">${u && U.isNum(u.cost) ? "$" + u.cost.toFixed(3) : r.reused || A.seat(id).code_only ? "$0" : "–"}</td></tr>`; });
  (run.rebuttals || []).filter(x => x.usage).forEach(x => rows.push(`<tr><td>Rebuttal · ${esc(A.seat(x.seat)?.name || x.seat)}</td><td class="small">${esc(shortModel(x.usage.model))}</td><td class="small muted">${x.usage.batch ? "batch ½ price" : "instant"}</td><td class="num">${fmtK(x.usage.in + (x.usage.cacheRead || 0) + (x.usage.cacheWrite || 0))}</td><td class="num">${fmtK(x.usage.out)}</td><td class="num">${x.usage.searches || 0}</td><td class="num">$${(x.usage.cost || 0).toFixed(3)}</td></tr>`));
  if (run.extraUsage) rows.push(`<tr><td>Helper (document digests, JSON fixes)</td><td class="small">${esc(shortModel(S.settings.helperModel))}</td><td></td><td class="num">${fmtK(run.extraUsage.in)}</td><td class="num">${fmtK(run.extraUsage.out)}</td><td class="num">0</td><td class="num">$${(run.extraUsage.cost || 0).toFixed(3)}</td></tr>`);
  const total = PL.totalCost(run), maxEst = Cost.estimate(run.mode, "max").cost;
  return `<div class="card"><div class="tiles"><div class="tile"><span>This run</span><b class="num">$${total.toFixed(2)}</b><small>${esc(A.PLANS[run.plan]?.label || run.plan || "")} plan</small></div>
    ${run.plan !== "max" ? `<div class="tile"><span>Same run on Max (est.)</span><b class="num">$${maxEst.toFixed(2)}</b><small>${maxEst > total ? "saved ≈ $" + (maxEst - total).toFixed(2) : ""}</small></div>` : ""}
    <div class="tile"><span>Spent this month</span><b class="num">$${Cost.spentThisMonth().toFixed(2)}</b>${U.num(S.settings.monthlyBudget) ? `<small>of $${(+S.settings.monthlyBudget).toFixed(0)} budget</small>` : ""}</div></div>
    <p class="small muted">Prices per million tokens: Opus 5.5 $4 in / $20 out, Sonnet 5.5 $2 / $10, Haiku 4.5 $1 / $5; web searches $10 per 1,000; batch work is half price; cached input is billed at a small fraction. Estimates learn from your own runs.</p></div>
    <div class="card"><div class="tblwrap"><table class="dt"><thead><tr><th>Seat</th><th>Model</th><th>How</th><th>In</th><th>Out</th><th>Searches</th><th>Cost</th></tr></thead><tbody>${rows.join("")}
    <tr><th>Total</th><td></td><td></td><td></td><td></td><td></td><td class="num"><b>$${total.toFixed(2)}</b></td></tr></tbody></table></div></div>`;
}
function shortModel(m) { m = String(m || ""); return /opus/.test(m) ? "Opus 5.5" : /sonnet/.test(m) ? "Sonnet 5.5" : /haiku/.test(m) ? "Haiku 4.5" : m; }

function renderMinutes(b) {
  const run = S.run;
  const ids = run.seats.filter(id => run.reports[id].status !== "queued" && !(run.reports[id].status === "skipped" && !run.reports[id].text));
  b.innerHTML = `<div class="sechead"><span class="lbl">Committee minutes</span><button class="btn small" id="expandAll" type="button">Expand all</button><button class="btn small" id="collapseAll" type="button">Collapse all</button></div>
  <div class="reports">${ids.map(id => { const a = A.seat(id), r = run.reports[id]; const open = S.open[id] !== undefined ? S.open[id] : r.status !== "done";
    return `<article class="rep ${open ? "" : "closed"}" id="rep-${id}" style="--c:${a.color}"><header data-id="${id}" role="button" tabindex="0" aria-expanded="${open}"><span class="glyph">${a.code}</span>
      <span class="who"><b>${esc(a.name)}</b><span>${esc(a.role)} · stage ${a.stage}</span></span><span class="meta" id="meta-${id}">${repMeta(id)}</span></header><div class="body" id="body-${id}"></div></article>`; }).join("")}</div>`;
  ids.forEach(renderRepBody);
}
function repMeta(id) {
  const r = S.run.reports[id], bits = [];
  if (id === "cio" && S.run.cio?.verdict) bits.push(`<span class="chip sm" style="color:${verdictColor(S.run.cio.verdict)}">${esc(S.run.cio.verdict)}</span>`);
  const sc = PL.seatScore(id, r.data); if (sc) bits.push(`<span class="num" style="color:${scoreColor(sc)}">${sc}/10</span>`);
  if (r.data?._original_score) bits.push(`<span class="muted small">revised from ${r.data._original_score}</span>`);
  if (r.status === "done" && r.reused) bits.push(`<span class="tag">↺ reused ${esc(fmtDate(r.reused.at))}</span>`);
  if (r.status === "done") { bits.push(`<span class="num">${secs(r.ms || 0)}</span>`); if (r.usage) bits.push(`<span class="num">${fmtK(r.usage.in + r.usage.out + (r.usage.cacheRead || 0) + (r.usage.cacheWrite || 0))} tok</span>`); if (r.usage?.searches) bits.push(`<span>${r.usage.searches} searches</span>`); }
  else if (r.status === "running") bits.push(`<span style="color:${A.seat(id).color}">● live</span>`);
  else if (r.status === "waiting") bits.push(`<span class="muted">⧗ batch · ${waitMins(r)}m</span>`);
  else if (r.status === "skipped") bits.push(`<span class="muted">skipped</span>`);
  else bits.push(`<span style="color:var(--bad)">${esc(r.status)}</span>`);
  bits.push(`<span class="tw">▾</span>`); return bits.join("");
}
function renderRepBody(id) {
  const el = document.getElementById("body-" + id); if (!el || !S.run) return;
  const r = S.run.reports[id], a = A.seat(id); let h = "";
  if (r.reused) h += `<p class="small muted">↺ Reused from the ${esc(fmtDate(r.reused.at))} run on this ticker — no new cost.${id === "desk" ? "" : " Re-analysis and Earnings mode always do fresh research."}</p>`;
  if (id === "desk") { h += r.status === "running" ? `<p class="muted">${esc(r.progress || "Fetching primary data…")}<span class="cursor"></span></p>` : deskSummaryHtml(S.run.factsheet); }
  else if (id === "member") h = `<div class="md">${md(r.text)}</div>`;
  else if (r.status === "skipped") h = `<p class="muted">${esc(r.text)}</p>`;
  else if (r.status === "waiting") h = `<p class="muted">Sent to Anthropic's Batch API at half price ${waitMins(r)} min ago${r.batchInfo?.status ? " · " + esc(r.batchInfo.status.replace("_", " ")) : ""}. Most batches finish within an hour. You can close this tab — the app picks it up when you come back.<span class="cursor"></span></p>`;
  else {
    if (r.status === "running" && r.searches?.length) h += `<div class="searching">${r.searches.slice(-4).map(q => `<div>${esc(q)}</div>`).join("")}</div>`;
    if (r.text) h += `<div class="md">${md(r.text)}${r.status === "running" ? '<span class="cursor"></span>' : ""}</div>`;
    else if (r.status === "running") h += `<div class="md muted">${r.searches?.length ? "Researching…" : "Reading the committee record…"}<span class="cursor"></span></div>`;
    if (r.data?.summary && r.status === "done") h = `<p class="summary"><b>Summary</b> ${esc(r.data.summary)}</p>` + h;
    if (r.data?.data_gaps?.length) h += `<p class="small muted"><b>Data gaps:</b> ${r.data.data_gaps.map(esc).join(" · ")}</p>`;
  }
  if (r.error) h += `<p class="err">${esc(r.error)}</p>`;
  h += sourcesHtml(r.sources);
  el.innerHTML = h;
  const m = document.getElementById("meta-" + id); if (m) m.innerHTML = repMeta(id);
}

/* ---------- Data Desk ---------- */
function deskSummaryHtml(fs) {
  if (!fs) return `<p class="muted">No fact sheet.</p>`;
  if (fs.status === "offline") return `<p class="muted">Data Desk is offline — ${S.inClaude ? "claude.ai pages can't reach external data." : "add a data gateway in Settings → Data to fetch SEC filings and prices."} The committee relied on ${S.run?.engine === "api" ? "web search" : "model knowledge"}.</p>${fs.transcripts ? "<p>Transcript tone analysis ran on your uploads.</p>" : ""}`;
  return `<p>${esc(fs.company?.name || fs.ticker)} · ${esc(fs.playbook?.name || "")} playbook · ${fs.yearMetrics?.length || 0} years of XBRL financials · ${fs.bars?.length || 0} price bars${fs.insiders ? ` · ${fs.insiders.filings} Form 4s` : ""}${fs.filingDiff ? " · annual-report language diff" : ""}. <button class="linkbtn" type="button" data-goto="desk">Open the Data Desk tab →</button></p>${fs.notes?.length ? `<p class="small muted">${fs.notes.map(esc).join(" · ")}</p>` : ""}`;
}
function deskHtml(fs) {
  if (!fs) return `<p class="muted">The Data Desk runs first in every committee.</p>`;
  if (fs.status === "offline") return `<div class="card">${deskSummaryHtml(fs)}${fs.transcripts ? transcriptHtml(fs.transcripts) : ""}</div>`;
  const v = fs.valuation || {}, q = fs.quality || {}, t = fs.tech;
  let h = `<div class="card"><div class="deskhead"><div><h3 class="h3">${esc(fs.company?.name || fs.ticker)}</h3><p class="small muted">${fs.company?.sic ? "SIC " + esc(fs.company.sic) + " · " + esc(fs.company.sicDescription || "") + " · " : ""}${esc(fs.company?.exchange || "")} · FY end ${esc(fs.company?.fyEnd || "?")} · playbook <b>${esc(fs.playbook?.name || "")}</b> · built ${esc((fs.builtAt || "").slice(0, 16).replace("T", " "))}</p></div></div>
    ${fs.notes?.length ? `<p class="small muted">${fs.notes.map(esc).join(" · ")}</p>` : ""}
    <div class="tiles">${[["Price", n2(v.price ?? t?.price)], ["Market cap", "$" + n2(v.marketCap)], ["EV", "$" + n2(v.ev)], ["P/E TTM", n2(v.pe, 1)], ["EV/EBITDA", n2(v.evEbitda, 1)], ["EV/Sales", n2(v.evSales, 1)], ["FCF yield", pct(v.fcfYield)], ["FCF−SBC yield", pct(v.fcfSbcYield)], ["Div yield", pct(v.divYield)], ["Buyback yield", pct(v.buybackYield)]].map(([k, x]) => `<div class="tile"><span>${k}</span><b class="num">${x}</b></div>`).join("")}</div>
    ${fs.reverseDcf ? `<p class="rdcf">Reverse DCF: the price implies <b class="num">${U.isNum(fs.reverseDcf.impliedGrowth) ? spct(fs.reverseDcf.impliedGrowth) : esc(fs.reverseDcf.note)}</b> annual growth for ${fs.reverseDcf.years} years (${esc(fs.reverseDcf.method)}, discount ${(fs.reverseDcf.r * 100).toFixed(1)}%, terminal ${(fs.reverseDcf.g * 100).toFixed(1)}%). Change the rates in Settings → Valuation.</p>` : ""}</div>`;
  if (fs.yearMetrics?.length) h += `<div class="card"><h3 class="h3">Financials (XBRL)</h3><div class="tblwrap"><table class="dt"><thead><tr><th>FY</th><th>Revenue</th><th>Growth</th><th>Gross m</th><th>Op m</th><th>FCF</th><th>FCF−SBC</th><th>SBC %</th><th>ROIC</th><th>Accruals</th><th>Capex/D&A</th><th>ND/EBITDA</th><th>Shares Δ</th></tr></thead><tbody>
    ${fs.yearMetrics.slice(-6).map(y => `<tr><td>${y.fy}</td><td class="num">${n2(y.revenue)}</td><td class="num">${spct(y.revGrowth)}</td><td class="num">${pct(y.grossMargin)}</td><td class="num">${pct(y.opMargin)}</td><td class="num">${n2(y.fcf)}</td><td class="num">${n2(y.fcfAfterSbc)}</td><td class="num">${pct(y.sbcPct)}</td><td class="num">${pct(y.roic)}</td><td class="num">${pct(y.accruals)}</td><td class="num">${U.isNum(y.capexToDA) ? y.capexToDA.toFixed(1) + "×" : "–"}</td><td class="num">${U.isNum(y.netDebtEbitda) ? y.netDebtEbitda.toFixed(1) + "×" : "–"}</td><td class="num">${spct(y.shareChange)}</td></tr>`).join("")}</tbody></table></div>
    <p class="small muted">Incremental ROIC (3y): <b class="num">${pct(fs.incRoic)}</b>${fs.qGrowth?.length ? " · quarterly revenue growth: " + fs.qGrowth.slice(-6).map(x => esc(x.end.slice(0, 7)) + " " + spct(x.g)).join(" · ") : ""}</p></div>`;
  if (q.piotroski || q.altman || q.beneish) h += `<div class="card"><h3 class="h3">Earnings quality</h3><div class="tiles">
    <div class="tile"><span>Piotroski F</span><b class="num">${q.piotroski ? q.piotroski.score + " / " + q.piotroski.of : "–"}</b></div>
    <div class="tile"><span>Altman Z</span><b class="num">${q.altman && U.isNum(q.altman.z) ? q.altman.z.toFixed(2) : "–"}</b><small>${esc(q.altman?.zone || "")}</small></div>
    <div class="tile ${q.beneish?.flag ? "flagged" : ""}"><span>Beneish M</span><b class="num">${q.beneish ? q.beneish.m.toFixed(2) : "–"}</b><small>${q.beneish ? (q.beneish.flag ? "above −1.78: flag" : "below −1.78") : ""}</small></div></div>
    ${q.piotroski ? `<ul class="checks">${q.piotroski.tests.map(([k, v]) => `<li class="${v === true ? "ok" : v === false ? "no" : "na"}">${v === true ? "✓" : v === false ? "✗" : "–"} ${esc(k)}</li>`).join("")}</ul>` : ""}
    ${q.beneish?.missing?.length ? `<p class="small muted">Beneish components defaulted (data missing): ${q.beneish.missing.join(", ")}</p>` : ""}</div>`;
  if (fs.leading?.length) h += `<div class="card"><h3 class="h3">Leading signals (computed)</h3><ul class="signals">${fs.leading.map(s => `<li><span class="dir" style="color:${dirColor(s.direction)}">${dirMark(s.direction)}</span><span><b>${esc(s.signal)}</b> <span class="num">${esc(s.value)}</span> <span class="muted small">${esc(s.note)}</span></span></li>`).join("")}</ul></div>`;
  if (fs.insiders) { const i = fs.insiders; h += `<div class="card"><h3 class="h3">Insiders (Form 4, last 12 months)</h3><div class="tiles">
    <div class="tile"><span>Buys</span><b class="num">${i.buyCount}</b><small>$${n2(i.buyValue)} · ${i.distinctBuyers} buyers</small></div><div class="tile"><span>Opportunistic buys</span><b class="num">${i.opportunisticBuys}</b><small>$${n2(i.opportunisticBuyValue)}</small></div>
    <div class="tile"><span>Sales</span><b class="num">${i.sellCount}</b><small>$${n2(i.sellValue)}</small></div><div class="tile"><span>Under 10b5-1 plans</span><b class="num">${i.planSells}</b></div></div>
    ${i.clusters.length ? `<p><b>Buying clusters:</b> ${i.clusters.map(c => `${esc(c.start)} — ${c.owners.map(esc).join(", ")} ($${n2(c.value)})`).join("; ")}</p>` : ""}
    ${i.recent.length ? `<div class="tblwrap"><table class="dt"><thead><tr><th>Date</th><th>Insider</th><th>Role</th><th>Type</th><th>Shares</th><th>Price</th><th>Plan</th></tr></thead><tbody>${i.recent.map(t => `<tr><td>${esc(t.date)}</td><td>${esc(t.owner)}</td><td>${esc(t.role)}</td><td style="color:${t.code === "P" ? "var(--good)" : "var(--bad)"}">${t.code === "P" ? "Buy" : "Sale"}</td><td class="num">${U.fmtNum(t.shares, 0)}</td><td class="num">${n2(t.price)}</td><td>${t.plan ? "10b5-1" : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}</div>`; }
  if (fs.filingDiff) { const d = fs.filingDiff; h += `<div class="card"><h3 class="h3">What changed in the annual report</h3><p class="small muted">${esc(d.form)} filed ${esc(d.newDate)} vs ${esc(d.oldDate)} · <a href="${esc(d.newUrl)}" target="_blank" rel="noopener noreferrer">new</a> · <a href="${esc(d.oldUrl)}" target="_blank" rel="noopener noreferrer">old</a>. Low similarity and new risk language tend to precede weaker returns.</p>
    ${[["risk", "Risk factors"], ["mdna", "MD&A"]].map(([k, l]) => d[k] ? `<h4 class="h4">${l} · similarity <span class="num">${U.isNum(d[k].cosine) ? d[k].cosine.toFixed(3) : "–"}</span> · ${d[k].addedCount} new · ${d[k].removedCount} removed</h4>
      ${d[k].added.length ? `<div class="diff add">${d[k].added.map(s => `<p>＋ ${esc(s)}</p>`).join("")}</div>` : ""}${d[k].removed.length ? `<div class="diff rem">${d[k].removed.map(s => `<p>− ${esc(s)}</p>`).join("")}</div>` : ""}` : "").join("")}</div>`; }
  if (fs.earnings) h += `<div class="card"><h3 class="h3">How the stock reacts to earnings</h3><p class="small">Average next-day move <b class="num">${spct(fs.earnings.avgReaction)}</b> · average absolute move <b class="num">${pct(fs.earnings.avgAbsReaction)}</b> · average 20-day drift vs SPY <b class="num">${spct(fs.earnings.avgDrift)}</b> · drift follows the first move ${pct(fs.earnings.driftFollows, 0)} of the time</p>
    <div class="tblwrap"><table class="dt"><thead><tr><th>8-K date</th><th>Next day</th><th>20d excess drift</th></tr></thead><tbody>${fs.earnings.events.map(e => `<tr><td>${esc(e.date)}</td><td class="num">${spct(e.reaction)}</td><td class="num">${spct(e.drift20)}</td></tr>`).join("")}</tbody></table></div></div>`;
  if (fs.transcripts) h += `<div class="card">${transcriptHtml(fs.transcripts)}</div>`;
  if (fs.recentFilings?.length) h += `<div class="card"><h3 class="h3">Recent filings</h3><ul class="filings">${fs.recentFilings.map(f => `<li><span class="num muted">${esc(f.date)}</span> <b>${esc(f.form)}</b>${f.items ? ` <span class="muted small">items ${esc(f.items)}</span>` : ""} ${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">open</a>` : ""}</li>`).join("")}</ul></div>`;
  h += `<div class="card">${sourcesHtml(fs.sources)}</div>`;
  return h;
}
function transcriptHtml(tr) {
  return `<h3 class="h3">Earnings-call language (your uploads)</h3><div class="tblwrap"><table class="dt"><thead><tr><th>Transcript</th><th>Words</th><th>Hedging /1k</th><th>Positive /1k</th><th>Net tone</th><th>Avg answer</th></tr></thead><tbody>${tr.calls.map(c => `<tr><td>${esc(c.name)}</td><td class="num">${U.fmtNum(c.words, 0)}</td><td class="num">${c.hedgePer1k.toFixed(1)}</td><td class="num">${c.positivePer1k.toFixed(1)}</td><td class="num">${c.netTone.toFixed(1)}</td><td class="num">${c.qa ? Math.round(c.qa.avgAnswerWords) + " words" : "–"}</td></tr>`).join("")}</tbody></table></div>${tr.change ? `<p class="small">From ${esc(tr.change.from)} to ${esc(tr.change.to)}: hedging ${tr.change.hedge >= 0 ? "+" : ""}${tr.change.hedge.toFixed(1)}/1k, net tone ${tr.change.tone >= 0 ? "+" : ""}${tr.change.tone.toFixed(1)}.</p>` : ""}`;
}
function techHtml(fs) {
  const t = fs?.tech; if (!t) return "";
  const tile = (k, v, s) => `<div class="tile"><span>${k}</span><b class="num">${v}</b>${s ? `<small>${s}</small>` : ""}</div>`;
  return `<div class="card"><h3 class="h3">Computed technicals · ${esc(t.date)}</h3><div class="tiles">
    ${tile("Regime", esc(t.regime), t.cross ? esc(t.cross.type + " " + t.cross.date) : "")}${tile("RSI 14", n2(t.rsi14, 1))}${tile("MFI 14", n2(t.mfi14, 1))}${tile("MACD hist", n2(t.macd?.hist, 3))}
    ${tile("ATR 14", n2(t.atr14), pct(t.atr14 / t.price) + " of price")}${tile("60d vol", pct(t.vol60))}${tile("From 52w high", spct(t.fromHigh))}${tile("Up/down volume", n2(t.upDownVol, 2), "50 days")}
    ${tile("RS vs SPY 6m", spct(t.rs?.m6))}${tile("RS vs " + esc(fs.sectorEtf || "sector") + " 6m", spct(t.rsSector?.m6))}${tile("AVWAP from low", n2(t.avwapFromLow))}${tile("AVWAP from high", n2(t.avwapFromHigh))}</div>
    <p class="small muted">Fibonacci (${esc(t.fib.direction)}): ${t.fib.levels.map(l => (l.level * 100).toFixed(1) + "% " + n2(l.price)).join(" · ")}</p>
    ${t.seasonality?.length ? `<p class="small muted">Seasonality (avg monthly return, 5y): ${t.seasonality.map(s => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][s.month - 1] + " " + spct(s.avg, 1)).join(" · ")}</p>` : ""}</div>`;
}

/* ---------- Evidence ---------- */
function evidenceHtml(run) {
  const L = run.ledger || C.ledger(run); const f = S.ledgerFilter || {seat: "", type: ""};
  const claims = L.claims.filter(c => (!f.seat || c.seat === f.seat) && (!f.type || c.source_type === f.type));
  const seats = [...new Set(L.claims.map(c => c.seat))];
  const dq = run.reports.scout?.data?.data_quality;
  return `<div class="card"><h3 class="h3">Evidence quality</h3><div class="tiles">
      <div class="tile"><span>Claims logged</span><b class="num">${L.claims.length}</b></div><div class="tile"><span>Primary-source share</span><b class="num">${pct(L.primaryShare, 0)}</b></div>
      <div class="tile ${L.contradictions.length ? "flagged" : ""}"><span>Contradictions</span><b class="num">${L.contradictions.length}</b></div><div class="tile"><span>Uncited "sourced" claims</span><b class="num">${Object.values(L.uncited).reduce((a, b) => a + b, 0)}</b></div>
      ${dq ? `<div class="tile"><span>Scout data quality</span><b>${esc(dq)}</b></div>` : ""}</div>
      ${Object.keys(L.types).length ? `<p class="small muted">By source type: ${Object.entries(L.types).map(([k, v]) => `${esc(k)} ${v}`).join(" · ")}</p>` : ""}</div>
    ${L.contradictions.length ? `<div class="card"><h3 class="h3">Contradictions found in code</h3><ul class="contra">${L.contradictions.map(c => `<li><b>${esc(c.metric)}</b> <span class="muted small">${esc(c.kind)}</span>${U.isNum(c.reference) ? ` · Data Desk <b class="num">${n2(c.reference)}</b>` : ""}: ${c.items.map(i => `${esc(A.seat(i.seat)?.name || i.seat)} <b class="num">${n2(i.value)}</b>${i.as_of ? ` <span class="muted small">(${esc(i.as_of)})</span>` : ""}`).join(" · ")}</li>`).join("")}</ul></div>` : ""}
    <div class="card"><div class="sechead"><h3 class="h3">Claims ledger</h3>
      <select class="field small" id="lfSeat" aria-label="Filter by seat"><option value="">All seats</option>${seats.map(s => `<option value="${s}" ${f.seat === s ? "selected" : ""}>${esc(A.seat(s)?.name || s)}</option>`).join("")}</select>
      <select class="field small" id="lfType" aria-label="Filter by source type"><option value="">All sources</option>${["primary", "secondary", "computed", "estimate", "member", "model_knowledge"].map(s => `<option ${f.type === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div class="tblwrap"><table class="dt ledger"><thead><tr><th>Seat</th><th>Claim</th><th>Metric</th><th>As of</th><th>Source</th><th>Conf.</th></tr></thead><tbody>
      ${claims.map(c => `<tr><td style="color:${A.seat(c.seat)?.color}">${esc(A.seat(c.seat)?.code || c.seat)}</td><td>${esc(c.text)}</td><td class="num">${c.metric ? esc(c.metric) + (U.isNum(c.value) ? " = " + n2(c.value) : "") : ""}</td><td class="num">${esc(c.as_of || "")}</td><td>${c.source_url ? `<a href="${esc(c.source_url)}" target="_blank" rel="noopener noreferrer">${esc(c.source_type)}</a>` : `<span class="${["primary", "secondary"].includes(c.source_type) ? "uncited" : ""}">${esc(c.source_type || "")}</span>`}</td><td>${esc(c.confidence || "")}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No structured claims yet.</td></tr>`}
      </tbody></table></div></div>`;
}

/* ---------- Debate ---------- */
function debateHtml(run) {
  const dv = run.reports.devil?.data, bull = run.reports.bull?.data, bear = run.reports.bear?.data;
  let h = "";
  if (bull || bear) h += `<div class="grid2"><div class="card" style="--c:var(--c-bull)"><h3 class="h3" style="color:var(--c-bull)">The Bull</h3>${bull ? `<p class="bignum num">${n2(bull.upside_price)}<small> · ${U.isNum(+bull.upside_probability_pct) ? bull.upside_probability_pct + "% probability" : ""}${bull.horizon_months ? " · " + bull.horizon_months + " mo" : ""}</small></p><p>${esc(bull.what_market_misses || bull.summary || "")}</p>` : `<p class="muted">Not in this mode.</p>`}</div>
    <div class="card"><h3 class="h3" style="color:var(--c-bear)">The Bear</h3>${bear ? `<p>${esc(bear.summary || "")}</p>${(bear.drawdown_scenarios || []).length ? `<ul class="tight">${bear.drawdown_scenarios.map(s => `<li><b>${esc(s.name)}</b> → ${n2(s.price)} (${U.isNum(s.loss_pct) ? s.loss_pct + "%" : "–"}, p=${U.isNum(s.probability_pct) ? s.probability_pct + "%" : "–"}) ${esc(s.mechanism || "")}</li>`).join("")}</ul>` : ""}${bear.thesis_killer ? `<p><b>Thesis killer:</b> ${esc(bear.thesis_killer)}</p>` : ""}` : `<p class="muted">Not in this mode.</p>`}</div></div>`;
  if (dv) {
    h += `<div class="card"><h3 class="h3" style="color:var(--c-devil)">Devil's Advocate</h3>
      ${dv.counter_thesis ? `<p><b>Strongest counter-thesis.</b> ${esc(dv.counter_thesis)}</p>` : ""}${dv.blind_spot ? `<p><b>Blind spot.</b> ${esc(dv.blind_spot)}</p>` : ""}${dv.groupthink ? `<p><b>Groupthink check.</b> ${esc(dv.groupthink)}</p>` : ""}
      ${dv.anchoring_detected ? `<p class="warnline">Anchoring detected: members adopted an early framing without testing it.</p>` : ""}
      <div class="critiques">${(dv.critiques || []).map(c => { const rb = (run.rebuttals || []).find(r => r.seat === c.target && r.critique === c.issue); const seat = A.seat(c.target);
        return `<div class="crit sev-${esc(c.severity)}"><div class="crit-h"><span class="glyph" style="--c:${seat?.color || "var(--fg-2)"}">${esc(seat?.code || "?")}</span><b>${esc(seat?.name || c.target)}</b><span class="tag">${esc(c.severity)}</span></div><p>${esc(c.issue)}</p>
        ${rb ? `<div class="reb"><span class="tag ${esc(rb.data?.stance || "")}">${esc((rb.data?.stance || "response").toUpperCase())}</span> ${esc(rb.data?.response || rb.text.replace(/\*\*(CONCEDE|PARTIAL|DEFEND)\*\*:?/i, "").trim())}${U.isNum(rb.data?.revised_score) ? ` <span class="muted small">revised score ${rb.data.revised_score}</span>` : ""}</div>` : ""}</div>`; }).join("")}</div></div>`;
  }
  return h || `<p class="muted">The debate appears once the Bull, Bear and Devil's Advocate have reported.</p>`;
}

/* ---------- Q&A ---------- */
function renderQA(b) {
  const run = S.run;
  b.innerHTML = (run.qa || []).length ? `<div class="qa">${run.qa.map(x => { const a = A.seat(x.agent) || A.SEATS[2];
    return `<article class="rep" style="--c:${a.color}"><header style="cursor:default"><span class="glyph">${a.code}</span><span class="who"><b>${esc(a.name)}</b><span>${esc(new Date(x.at).toLocaleString())}</span></span></header>
    <div class="body"><p class="q"><b>Q</b>${esc(x.q)}</p><div class="md">${x.a ? md(x.a) : '<span class="muted">Thinking…</span>'}${x.status === "running" ? '<span class="cursor"></span>' : ""}</div>${x.error ? `<p class="err">${esc(x.error)}</p>` : ""}${sourcesHtml(x.sources)}</div></article>`; }).join("")}</div>`
    : `<p class="muted">Ask any seat a follow-up question with the bar at the bottom of the screen. Answers use the full committee record.</p>`;
}
