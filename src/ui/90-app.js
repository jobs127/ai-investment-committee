/* Controllers, events and boot. */

function canRunEngine() {
  if (S.engine === "api" && !S.key && !(S.settings.gatewayAnthropic && S.settings.gateway)) { toast("Add your Anthropic API key first (or route calls through your gateway in Settings → Data)."); openKeyForm(); return false; }
  if (!S.engine || S.engine === "none") { toast("No engine available in this view."); return false; }
  return true;
}
function hooksFor(run, t0) {
  return {settings: S.settings, apiKey: S.key, signal: S.ctl.signal,
    calibrationNote: S.calNote,
    holdingsInfo: async r => holdingsInfo(r),
    onUpdate: (rr, id, kind) => { if (rr !== S.run) return; if (kind === "stream") queueStream(id); else { renderBoard(); if (S.tab === "minutes") { if (id && !document.getElementById("rep-" + id)) renderTabs(); else if (id) renderRepBody(id); } renderProgress(t0); if (!id) { renderResults(); renderTabs(); } } }};
}
let streamQ = new Set(), streamT = 0;
function queueStream(id) { streamQ.add(id); if (!streamT) streamT = setTimeout(() => { streamT = 0; for (const k of streamQ) if (S.tab === "minutes") { if (!document.getElementById("body-" + k)) renderTabs(); else renderRepBody(k); } streamQ.clear(); renderBoard(); }, 140); }

async function holdingsInfo(run) {
  const H = S.holdings.filter(h => h.ticker && h.ticker !== run.ticker); if (!H.length) return null;
  const tot = H.reduce((s, h) => s + (+h.shares || 0) * (h.last || +h.cost || 0), 0);
  const lines = H.map(h => { const v = (+h.shares || 0) * (h.last || +h.cost || 0); const lt = h.date ? (U.daysBetween(h.date, U.today()) > 365 ? "long-term" : "short-term") : "unknown"; return `${h.ticker}: ${h.shares} sh @ ${h.cost} (${h.account || "?"}, bought ${h.date || "?"}, ${lt}), ${tot ? (v / tot * 100).toFixed(1) + "% of holdings" : ""}${h.sector ? ", " + h.sector : ""}`; });
  const same = H.filter(h => h.sector && run.playbook && h.sector.toLowerCase().includes(run.playbook.name.toLowerCase().split(" ")[0]));
  if (same.length) lines.push(`Same-sector holdings: ${same.map(h => h.ticker).join(", ")}`);
  const held = S.holdings.find(h => h.ticker === run.ticker);
  if (held) lines.push(`ALREADY HELD: ${held.shares} sh of ${run.ticker} @ ${held.cost}, ${held.account}, bought ${held.date || "?"}`);
  let corr = null;
  const bars = A.barsOf(run.factsheet);
  if (bars && A.data.available()) {
    const hb = await U.pmap(H.slice(0, 8), async h => ({ticker: h.ticker, bars: (await A.data.prices(h.ticker, "1y")).bars}), 3);
    corr = C.correlations(bars, hb.filter(x => x && !x.__error && x.bars));
    lines.push("1-year daily return correlation with the candidate: " + corr.map(x => `${x.ticker} ${U.isNum(x.corr) ? x.corr.toFixed(2) : "n/a"}`).join(", "));
  }
  return {text: lines.join("\n"), corr};
}

async function startRun(opts = {}) {
  if (S.running) return null;
  const T = U.normTicker(opts.ticker || $("#ticker").value);
  if (!T) { $("#ticker").focus(); toast("Enter a ticker."); return null; }
  if (!U.validTicker(T)) { toast("That doesn't look like a ticker."); return null; }
  if (!canRunEngine()) return null;
  const mode = opts.mode || S.mode;
  let prior = null;
  if (opts.re || mode === "earnings") { const p = S.index.find(h => h.ticker === T && h.status === "done"); if (p) prior = await DB.getRun(p.id); }
  S.calNote = C.calibrationNote(C.calibration(S.track));
  const run = PL.newRun({ticker: T, mode, profile: S.profile, settings: S.settings, prior, engine: S.engine,
    member: opts.quiet ? {note: "", docs: []} : {note: S.member.note, docs: S.member.docs.map(d => ({name: d.name, kind: d.kind, text: d.text}))}});
  if (opts.noTrack) run.noTrack = true;
  $("#ticker").value = T; S.run = run; S.open = {}; S.tab = "minutes";
  if (!opts.quiet) { S.view = "analysis"; updateNav(); }
  await saveRun(run);
  return execute(run, opts.quiet);
}
async function resumeRun() {
  if (S.running || !S.run || !canRunEngine()) return;
  for (const id of S.run.seats) { const r = S.run.reports[id]; if (r.status !== "done" && r.status !== "skipped") { r.status = "queued"; r.error = null; } }
  return execute(S.run);
}
async function execute(run, quiet) {
  S.running = true; S.ctl = new AbortController(); const t0 = Date.now();
  renderAll();
  const timer = setInterval(() => renderProgress(t0), 600);
  try {
    await PL.execute(run, hooksFor(run, t0));
    run.seats.forEach(id => S.open[id] = id === "cio" || id === "pm");
    if (!run.noTrack) { const te = F.trackEntry(run); const i = S.track.findIndex(x => x.runId === run.id); if (i >= 0) S.track[i] = te; else S.track.unshift(te); persist.track(); }
    const w = S.watchlist.find(x => x.ticker === run.ticker); if (w && run.pm) { w.lastRun = run.id; }
    if (!quiet) toast(`${run.ticker}: ${run.cio?.verdict || "done"} · ${run.cio?.overall ?? "?"}/10`);
  } catch (e) {
    run.status = e.code === "cancelled" ? "stopped" : e.code === "budget" ? "budget" : "error"; run.error = e.message;
    if (e.code !== "cancelled") toast(e.message, 7000);
  } finally {
    clearInterval(timer); S.running = false; S.ctl = null;
    await saveRun(run); renderAll(); renderProgress(t0);
    if (run.status === "done" && !quiet && S.run === run) $("#results").scrollIntoView({behavior: "smooth", block: "start"});
  }
  return run;
}
function stopRun() { if (S.ctl) S.ctl.abort(); }

async function ask() {
  const run = S.run; if (!run || S.asking || S.running) return;
  const q = $("#askQ").value.trim(); if (!q || !canRunEngine()) return;
  const id = $("#askAgent").value;
  const item = {agent: id, q, a: "", at: Date.now(), status: "running"};
  run.qa = run.qa || []; run.qa.push(item); $("#askQ").value = ""; S.asking = true; S.tab = "qa"; renderTabs(); renderConsole();
  S.askCtl = new AbortController();
  try {
    const out = await PL.ask(run, id, q, {settings: S.settings, apiKey: S.key, signal: S.askCtl.signal, onText: t => { item.a = t; if (S.tab === "qa") renderTabs(); }});
    Object.assign(item, {a: out.text, sources: out.sources, usage: out.usage, status: "done"});
  } catch (e) { Object.assign(item, {a: e.partial || item.a, error: e.message, status: "error"}); }
  S.asking = false; await saveRun(run); renderTabs(); renderConsole();
}

/* ---------------- engine & key bar ---------------- */
async function detectEngine() {
  if (window.claude && typeof window.claude.use === "function") {
    S.inClaude = true; applyEnv();
    try {
      const s = await window.claude.use("sample");
      if (s) { A.env.sample = s; try { const lim = await s.limits(); A.env.sampleTools = !!lim.tools; } catch { A.env.sampleTools = false; } return "claude"; }
    } catch {}
    return "none";
  }
  return "api";
}
function renderEngine() {
  const bar = $("#engineBar"), w = bar.querySelector(".wrap"); bar.classList.remove("off");
  const gw = A.data.available() ? `<span class="pill ok">Data gateway ✓</span>` : S.inClaude ? "" : `<span class="pill">No data gateway — <button class="linkbtn" type="button" data-goset="data">set up</button></span>`;
  if (S.engine === null) { w.innerHTML = `<span class="status">Connecting…</span>`; return; }
  if (S.engine === "claude") { w.innerHTML = `<span class="status">✓ Claude account active</span><span class="note">Running inside claude.ai on your account's most capable model. Live web search and the data gateway aren't available here, so market figures come from model knowledge and are flagged unverified. For Opus 5.5 with live search and SEC data, use the GitHub version.</span>`; return; }
  if (S.engine === "none") { bar.classList.add("off"); w.innerHTML = `<span class="status">Engine unavailable</span><span class="note">This view can't reach Claude. Open the artifact on claude.ai and allow it to use Claude, or run index.html with an Anthropic API key.</span>`; return; }
  if (S.settings.gatewayAnthropic && S.settings.gateway && !S._editKey) { w.innerHTML = `<span class="status">✓ Anthropic via gateway</span><span class="note">Calls go through your gateway, which holds the key · model ${esc(S.settings.model)}</span>${gw}`; return; }
  if (S.key && !S._editKey) {
    w.innerHTML = `<span class="status">✓ API key active</span><span class="note">Key ending ${esc(S.key.slice(-4))} · ${LS.get("key", "") ? "remembered on this device" : "this session only"} · model ${esc(S.settings.model)}</span>${gw}<button class="btn small" id="chgKey" type="button">🔑 Change key</button><button class="btn small" id="forgetKey" type="button">Forget</button>`;
    $("#chgKey").onclick = openKeyForm; $("#forgetKey").onclick = () => { S.key = ""; LS.del("key"); try { sessionStorage.removeItem("aic6.key"); } catch {} renderEngine(); };
  } else {
    bar.classList.add("off");
    w.innerHTML = `<span class="status">API key needed</span><form class="keyform" id="keyForm"><input class="field" type="password" id="keyIn" placeholder="sk-ant-…  (console.anthropic.com → API keys)" autocomplete="off" spellcheck="false" aria-label="Anthropic API key"><label class="check"><input type="checkbox" id="keyRemember" checked> Remember on this device</label><button class="btn primary small" type="submit">Save key</button>${S.key ? '<button class="btn small" type="button" id="keyCancel">Cancel</button>' : ""}</form>${gw}`;
    $("#keyForm").onsubmit = e => { e.preventDefault(); const k = $("#keyIn").value.trim(); if (!k) return; S.key = k; S._editKey = false; if ($("#keyRemember").checked) LS.set("key", k); else { LS.del("key"); try { sessionStorage.setItem("aic6.key", k); } catch {} } renderEngine(); toast("Key saved."); };
    const c = $("#keyCancel"); if (c) c.onclick = () => { S._editKey = false; renderEngine(); };
  }
}
function openKeyForm() { S._editKey = true; renderEngine(); setTimeout(() => $("#keyIn")?.focus(), 0); }

/* ---------------- nav ---------------- */
const VIEWS = ["analysis", "discover", "compare", "portfolio", "record", "history", "lab", "settings"];
function updateNav() {
  $("#navHistory").textContent = `History (${S.index.length})`;
  const due = S.watchlist.filter(isDue).length; $("#navPortfolio").innerHTML = "Portfolio" + (due ? ` <span class="cnt">${due}</span>` : "");
  VIEWS.forEach(v => { const b = document.querySelector(`.nav [data-view="${v}"]`); if (b) { if (S.view === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }
    document.getElementById("view" + v[0].toUpperCase() + v.slice(1)).hidden = S.view !== v; });
  const hc = $("#headChip"), c = S.run?.cio;
  if (S.run && c?.verdict) { hc.hidden = false; hc.style.color = verdictColor(c.verdict); hc.textContent = `${S.run.ticker} · ${c.verdict}`; }
  else if (S.run) { hc.hidden = false; hc.style.color = "var(--fg-2)"; hc.textContent = `${S.run.ticker} · ${S.running ? "in session" : S.run.status}`; }
  else hc.hidden = true;
  $("#eyebrow").textContent = S.engine === "claude" ? "Private · Alpha Fund · v6 · Claude · knowledge mode" : `Private · Alpha Fund · v6 · ${S.settings.model === "claude-opus-5-5" ? "Opus 5.5" : S.settings.model} · ${+S.settings.searchDepth ? "web search" : "no search"}${A.data.available() ? " · SEC data" : ""}`;
}
function renderView() {
  if (S.view === "discover") renderDiscover(); else if (S.view === "compare") renderCompare(); else if (S.view === "portfolio") renderPortfolio();
  else if (S.view === "record") renderRecord(); else if (S.view === "history") renderHistory(); else if (S.view === "lab") renderLab(); else if (S.view === "settings") renderSettings();
}
function renderAll() { updateNav(); renderEngine(); renderConsole(); renderBoard(); renderResults(); renderTabs(); renderProgress(); if (S.view !== "analysis") renderView(); }
function go(view) { S.view = view; updateNav(); renderView(); renderConsole(); scrollTo(0, 0); }

async function openRun(id) {
  if (S.running) { toast("Wait for the current run to finish."); return; }
  const r = await DB.getRun(id); if (!r) { toast("That run isn't stored in this browser."); return; }
  S.run = r; S.open = {}; if (r.status === "done") r.seats.forEach(x => S.open[x] = x === "cio" || x === "pm");
  S.tab = "minutes"; $("#ticker").value = r.ticker; S.view = "analysis"; renderAll(); scrollTo(0, 0);
}

/* ---------------- events ---------------- */
function bind() {
  document.querySelectorAll(".nav [data-view]").forEach(b => b.onclick = () => go(b.dataset.view));
  $("#navPdf").onclick = () => { if (!S.run) { toast("Run or open an analysis first."); return; } if (S.inClaude) { exportHTML(S.run); toast("Printing isn't available inside claude.ai — saving a printable report instead."); return; } go("analysis"); S.open = {}; S.run.seats.forEach(id => S.open[id] = true); S.tab = "minutes"; renderTabs(); setTimeout(() => window.print(), 60); };
  $("#runForm").onsubmit = e => { e.preventDefault(); startRun(); };
  $("#reBtn").onclick = () => startRun({re: true});
  $("#resumeBtn").onclick = resumeRun; $("#stopBtn").onclick = stopRun;
  $("#ticker").addEventListener("input", renderConsole);
  $("#modeSel").onchange = e => { S.mode = e.target.value; LS.set("mode", S.mode); renderConsole(); if (!S.run) renderBoard(); };
  $("#memberNote").addEventListener("input", e => { S.member.note = e.target.value; renderConsole(); });
  $("#docFiles").onchange = e => { addDocs([...e.target.files]); e.target.value = ""; };
  const drop = $("#memberBox");
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("drag"); addDocs([...e.dataTransfer.files]); });
  $("#askForm").onsubmit = e => { e.preventDefault(); ask(); };
  $("#askAgent").innerHTML = A.SEATS.filter(s => !s.code_only && s.id !== "rebuttal").map(s => `<option value="${s.id}">${s.code} · ${esc(s.name)}</option>`).join("");
  $("#importHist").onchange = e => { const f = e.target.files[0]; if (f) importAll(f); e.target.value = ""; };
  $("#exportHist").onclick = exportAll;

  document.addEventListener("click", async e => {
    const t = e.target.closest("button, [data-goto], [data-id], .hrow"); if (!t) return;
    const d = t.dataset;
    if (t.classList.contains("seat") && d.id && S.run) { if (S.run.reports[d.id]?.status === "queued") return; S.tab = "minutes"; S.open[d.id] = true; renderTabs(); document.getElementById("rep-" + d.id)?.scrollIntoView({behavior: "smooth", block: "start"}); return; }
    if (t.matches(".rep>header[data-id]") || (t.closest(".rep>header[data-id]") && t.tagName !== "BUTTON")) return; // handled below
    if (d.tab) { S.tab = d.tab; renderTabs(); return; }
    if (d.goto) { S.tab = d.goto; renderTabs(); return; }
    if (d.goset) { S.setTab = d.goset; go("settings"); return; }
    if (d.rmdoc) { S.member.docs.splice(+d.rmdoc, 1); renderConsole(); return; }
    if (d.act && S.run) {
      if (d.act === "csv") exportCSV(S.run); if (d.act === "html") exportHTML(S.run); if (d.act === "ics") exportICS(S.run); if (d.act === "alerts") exportAlerts(S.run);
      if (d.act === "watch") { const al = []; const p = S.run.pm || {}; if (U.isNum(p.stop?.price)) al.push({type: "price_below", value: String(p.stop.price)}); (p.targets || []).forEach(x => U.isNum(x.price) && al.push({type: "price_above", value: String(x.price)}));
        const w = S.watchlist.find(x => x.ticker === S.run.ticker); if (w) w.alerts = al; else S.watchlist.push({ticker: S.run.ticker, cadence: "monthly", mode: "earnings", alerts: al}); persist.watchlist(); updateNav(); toast(`${S.run.ticker} is on the watchlist with ${al.length} alerts.`); }
      if (d.act === "thesis") { const th = F.thesisFromRun(S.run); const i = S.theses.findIndex(x => x.ticker === th.ticker); if (i >= 0) S.theses[i] = Object.assign(th, {notes: S.theses[i].notes}); else S.theses.unshift(th); persist.theses(); toast(`Tracking the ${th.ticker} thesis in Portfolio → Thesis tracker.`); }
      return;
    }
    if (t.id === "expandAll" && S.run) { S.run.seats.forEach(id => S.open[id] = true); renderTabs(); return; }
    if (t.id === "collapseAll" && S.run) { S.run.seats.forEach(id => S.open[id] = false); renderTabs(); return; }
    // history
    if (d.del) { e.stopPropagation(); if (d.confirm !== "1") { d.confirm = "1"; t.textContent = "Confirm"; setTimeout(() => { if (t.isConnected) { d.confirm = ""; t.textContent = "Delete"; } }, 3000); return; }
      await DB.delRun(d.del); S.index = S.index.filter(x => x.id !== d.del); LS.set("index", S.index); if (S.run?.id === d.del && !S.running) S.run = null; renderAll(); renderHistory(); return; }
    if (t.classList.contains("hrow")) { openRun(d.id); return; }
    if (d.openrun) { openRun(d.openrun); return; }
    // discover
    if (d.disc) { loadDiscover(d.disc); return; }
    if (d.send) { $("#ticker").value = d.send; if (d.mode) { S.mode = d.mode; } go("analysis"); renderConsole(); if (d.mode) startRun({ticker: d.send, mode: d.mode}); else $("#ticker").focus(); return; }
    if (d.cmpopen) { S.compareCurrent = S.compares[+d.cmpopen]; renderCompare(); return; }
    // portfolio
    if (d.ptab) { S.portTab = d.ptab; renderPortfolio(); return; }
    if (t.id === "hAdd") { readHoldings(); S.holdings.push({ticker: "", shares: "", cost: "", date: "", account: "Taxable", sector: ""}); renderPortfolio(); return; }
    if (t.id === "hSave") { readHoldings(); persist.holdings(); toast("Holdings saved."); renderPortfolio(); return; }
    if (d.hdel) { readHoldings(); S.holdings.splice(+d.hdel, 1); persist.holdings(); renderPortfolio(); return; }
    if (t.id === "hImport") { const rows = $("#hCsv").value.split(/\n/).map(l => l.split(",").map(x => x.trim())).filter(r => r[0]); rows.forEach(r => S.holdings.push({ticker: U.normTicker(r[0]), shares: r[1] || "", cost: r[2] || "", date: r[3] || "", account: r[4] || "Taxable", sector: r[5] || ""})); persist.holdings(); renderPortfolio(); toast(`Added ${rows.length} holdings.`); return; }
    if (t.id === "hPrices") { readHoldings(); t.disabled = true; await U.pmap(S.holdings.filter(h => h.ticker), async h => { const p = await A.data.lastPrice(h.ticker); if (p) h.last = p.price; }, 3); persist.holdings(); renderPortfolio(); return; }
    if (t.id === "wAdd") { readWatch(); const tk = U.normTicker($("#wNew").value); if (U.validTicker(tk) && !S.watchlist.some(w => w.ticker === tk)) S.watchlist.push({ticker: tk, cadence: "monthly", mode: "quick", alerts: []}); persist.watchlist(); renderPortfolio(); updateNav(); return; }
    if (t.id === "wSave") { readWatch(); persist.watchlist(); toast("Watchlist saved."); renderPortfolio(); updateNav(); return; }
    if (d.wdel) { readWatch(); S.watchlist.splice(+d.wdel, 1); persist.watchlist(); renderPortfolio(); updateNav(); return; }
    if (t.id === "wExport") { readWatch(); persist.watchlist(); exportWatchlist(); return; }
    if (t.id === "wSync") { syncGitHub(); return; }
    if (t.id === "wCheck") { t.disabled = true; await checkAlerts(); renderPortfolio(); return; }
    if (t.id === "wRunDue") { for (const w of S.watchlist.filter(isDue)) { const r = await startRun({ticker: w.ticker, mode: w.mode, quiet: true}); if (!r || r.status !== "done") break; } renderPortfolio(); updateNav(); return; }
    if (d.tcheck) { checkThesis(+d.tcheck); return; }
    if (d.tdel) { S.theses.splice(+d.tdel, 1); persist.theses(); renderPortfolio(); return; }
    // record
    if (d.rtab) { S.recTab = d.rtab; renderRecord(); return; }
    if (t.id === "tUpdate") { S.busy.track = "Updating…"; renderRecord(); await F.updateTrack(S.track, (i, n, tk) => { S.busy.track = `${tk} ${i}/${n}`; renderRecord(); }); persist.track(); S.busy.track = false; renderRecord(); return; }
    if (t.id === "jExport") { exportJournal(); return; }
    if (d.jdel) { S.journal.splice(+d.jdel, 1); persist.journal(); renderRecord(); return; }
    // lab
    if (t.id === "labCmp") { const a = S.evals[+$("#labA").value], b = S.evals[+$("#labB").value]; $("#labDiff").innerHTML = labDiffHtml(a, b); return; }
    if (d.edel) { S.evals.splice(+d.edel, 1); persist.evals(); renderLab(); return; }
    // settings
    if (d.stab) { S.setTab = d.stab; renderSettings(); return; }
    if (t.id === "gTest") { const out = $("#gTestOut"); out.textContent = "Testing…"; readDataForm(); applyEnv();
      try { const m = await A.data.tickerMap(); out.textContent = `✓ Connected — ${Object.keys(m.byT).length.toLocaleString()} SEC tickers loaded.`; out.style.color = "var(--good)"; }
      catch (err) { out.textContent = "✗ " + err.message; out.style.color = "var(--bad)"; } renderEngine(); return; }
    if (t.id === "exportAll") { exportAll(); return; }
    if (t.id === "clearCache") { Object.keys(localStorage).filter(k => k.startsWith("aic6.cache.")).forEach(k => localStorage.removeItem(k)); A.data.clearMemo(); A.data._tmap = null; toast("Data caches cleared."); return; }
  });
  // report accordion
  const toggleRep = h => { const id = h.dataset.id, art = h.parentElement, open = art.classList.contains("closed"); S.open[id] = open; art.classList.toggle("closed", !open); h.setAttribute("aria-expanded", open); };
  document.addEventListener("click", e => { const h = e.target.closest(".rep>header[data-id]"); if (h && !e.target.closest("button")) toggleRep(h); });
  document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches(".rep>header[data-id]")) { e.preventDefault(); toggleRep(e.target); } if (e.key === "Enter" && e.target.classList.contains("hrow")) openRun(e.target.dataset.id); });
  document.addEventListener("change", e => {
    const t = e.target, d = t.dataset;
    if (t.id === "lfSeat" || t.id === "lfType") { S.ledgerFilter = {seat: $("#lfSeat").value, type: $("#lfType").value}; renderTabs(); return; }
    if (d.tf) { const i = +t.closest("[data-ti]").dataset.ti; S.theses[i][d.tf] = t.value; persist.theses(); return; }
    if (d.tcat) { const i = +t.closest("[data-ti]").dataset.ti; S.theses[i].catalysts[+d.tcat].done = t.checked; persist.theses(); return; }
    if (d.tm) { const v = U.num(t.value); if (U.isNum(v)) { F.manualMark(S.track[+d.tm], v); persist.track(); renderRecord(); } return; }
    if (t.id === "importAll") { const f = t.files[0]; if (f) importAll(f); t.value = ""; }
  });
  document.addEventListener("submit", async e => {
    const f = e.target; if (!["jform", "ideaForm", "cmpForm", "labForm", "profileForm", "engineForm", "dataForm", "seatsForm", "ghForm"].includes(f.id)) return;
    e.preventDefault();
    if (f.id === "jform" && S.run) { const j = {runId: S.run.id, ticker: S.run.ticker, date: U.today(), verdict: S.run.cio?.verdict, overall: S.run.cio?.overall, decision: $("#jDecision").value, price: $("#jPrice").value, size: $("#jSize").value, notes: $("#jNotes").value};
      if (!j.decision) { toast("Choose a decision."); return; } const i = S.journal.findIndex(x => x.runId === j.runId); if (i >= 0) S.journal[i] = j; else S.journal.unshift(j); persist.journal(); toast("Decision logged in the journal."); }
    if (f.id === "ideaForm") huntIdeas();
    if (f.id === "cmpForm") runCompare();
    if (f.id === "labForm") runLab();
    if (f.id === "profileForm") { S.profile = {style: $("#pStyle").value, horizon: $("#pHorizon").value, risk: $("#pRisk").value, dd: $("#pDD").value, size: $("#pSize").value.trim(), riskPerTrade: $("#pRpt").value.trim(), ccy: $("#pCcy").value.trim() || "USD", accounts: $("#pAcc").value.trim(), other: $("#pOther").value.trim(), expertise: $("#pExp").value.trim()}; LS.set("profile", S.profile); toast("Profile saved."); }
    if (f.id === "engineForm") { Object.assign(S.settings, {model: $("#sModel").value.trim() || A.DEFAULTS.model, retrievalModel: $("#sRetr").value.trim(), devilModel: $("#sDevil").value.trim(), searchDepth: +$("#sSearch").value, toolType: $("#sTool").value.trim() || A.DEFAULTS.toolType,
      maxTokens: Math.max(1000, +$("#sMax").value || A.DEFAULTS.maxTokens), promptCaching: $("#sCache").value === "true", parallel: $("#sPar").value === "true", budget: $("#sBudget").value.trim(), priceIn: $("#sPin").value.trim(), priceOut: $("#sPout").value.trim(), priceSearch: $("#sPsearch").value.trim(),
      discountRate: +$("#sDR").value || 9, terminalGrowth: +$("#sTG").value || 2.5, defaultMode: $("#sMode").value}); LS.set("settings", S.settings); updateNav(); renderEngine(); toast("Engine settings saved."); }
    if (f.id === "dataForm") { readDataForm(); LS.set("settings", S.settings); applyEnv(); renderEngine(); updateNav(); toast("Data settings saved."); }
    if (f.id === "seatsForm") { S.settings.customSeats = ["desk"].concat($$("[data-cs]").filter(x => x.checked && x.dataset.cs !== "desk").map(x => x.dataset.cs)); S.settings.noSearchSeats = $$("[data-ns]").filter(x => !x.checked).map(x => x.dataset.ns); LS.set("settings", S.settings); toast("Seats saved. Choose Custom mode to use them."); }
    if (f.id === "ghForm") { Object.assign(S.settings, {ghOwner: $("#ghO").value.trim(), ghRepo: $("#ghR").value.trim(), ghBranch: $("#ghB").value.trim() || "main"}); LS.set("settings", S.settings); toast("GitHub settings saved."); }
  });
  addEventListener("beforeunload", e => { if (S.running) { e.preventDefault(); e.returnValue = ""; } });
}
function readDataForm() { if (!$("#gUrl")) return; Object.assign(S.settings, {gateway: $("#gUrl").value.trim().replace(/\/+$/, ""), gatewayToken: $("#gTok").value.trim(), gatewayAnthropic: $("#gAnth").value === "true"}); }
function readHoldings() { $$("[data-hi]").forEach(tr => { const h = S.holdings[+tr.dataset.hi]; if (!h) return; tr.querySelectorAll("[data-hf]").forEach(inp => { h[inp.dataset.hf] = inp.dataset.hf === "ticker" ? U.normTicker(inp.value) : inp.value.trim(); }); }); }
function readWatch() { $$("[data-wi]").forEach(tr => { const w = S.watchlist[+tr.dataset.wi]; if (!w) return; tr.querySelectorAll("[data-wf]").forEach(inp => { if (inp.dataset.wf === "alertsText") w.alerts = parseAlerts(inp.value); else w[inp.dataset.wf] = inp.value; }); }); }
async function checkAlerts() {
  S.alertHits = [];
  for (const w of S.watchlist) {
    if (!(w.alerts || []).some(a => a.type.startsWith("price"))) continue;
    try { const p = await A.data.lastPrice(w.ticker); if (!p) continue;
      for (const a of w.alerts) { const v = U.num(a.value); if (!U.isNum(v)) continue;
        if (a.type === "price_below" && p.price <= v) S.alertHits.push({ticker: w.ticker, text: `${n2(p.price)} is at or below ${v} (${p.date})`});
        if (a.type === "price_above" && p.price >= v) S.alertHits.push({ticker: w.ticker, text: `${n2(p.price)} is at or above ${v} (${p.date})`}); } } catch {}
  }
  if (!S.alertHits.length) toast("No price alerts triggered.");
}

/* ---------------- boot ---------------- */
(async function boot() {
  loadState(); bind();
  const fixed = []; // runs interrupted by closing the page
  for (const h of S.index) if (h.status === "running") { const r = await DB.getRun(h.id); if (r) { r.status = "stopped"; r.seats.forEach(id => { if (r.reports[id].status === "running") { r.reports[id].status = "stopped"; r.reports[id].error = "Interrupted when the page closed. Press Resume."; } }); await saveRun(r); fixed.push(r.id); } }
  const last = S.index[0]; if (last) { const r = await DB.getRun(last.id); if (r) { S.run = r; if (r.status === "done") r.seats.forEach(x => S.open[x] = x === "cio" || x === "pm"); $("#ticker").value = r.ticker; } }
  S.calNote = C.calibrationNote(C.calibration(S.track));
  renderAll();
  S.engine = await detectEngine(); applyEnv();
  renderAll();
  const due = S.watchlist.filter(isDue); if (due.length) toast(`${due.length} watchlist ticker${due.length > 1 ? "s are" : " is"} due for review — see Portfolio → Watchlist.`, 6000);
})();
