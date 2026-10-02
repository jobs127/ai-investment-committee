/* AI Stock Alert System — screens: Feed (sweep + ranked alerts), Alert list, Sweeps. */
const AL = A.alerts;
const ALS = { // alert-system state (its own ticker list, settings, feed and memory)
  list: [], settings: Object.assign({}, AL.DEFAULTS), feed: [], ctx: {}, index: [], latest: null,
  sweep: null, running: false, ctl: null, filter: {imp: "all", ticker: "", showDismissed: false}, sel: "all", open: null
};
function alLoad() {
  ALS.list = LS.get("al.list", []); ALS.settings = Object.assign({}, AL.DEFAULTS, LS.get("al.settings", {}));
  ALS.feed = LS.get("al.feed", []); ALS.ctx = LS.get("al.ctx", {}); ALS.index = LS.get("al.index", []); ALS.latest = LS.get("al.latest", null);
}
const alPersist = {
  list: () => LS.set("al.list", ALS.list), settings: () => LS.set("al.settings", ALS.settings), feed: () => LS.set("al.feed", ALS.feed.slice(0, 800)),
  ctx: () => LS.set("al.ctx", ALS.ctx), index: () => LS.set("al.index", ALS.index.slice(0, 120)), latest: () => LS.set("al.latest", ALS.latest)
};
const alOn = () => ALS.list.filter(w => w.ticker && w.on !== false);
const alUnseen = () => ALS.feed.filter(i => i.status === "new");
async function alSave(sw) {
  sw.cost = AL.totalCost(sw); await DB.putRun(sw);
  const s = {id: sw.id, createdAt: sw.createdAt, tickers: sw.tickers, scope: sw.scope, plan: sw.plan, status: sw.status, cost: sw.cost,
    items: Object.values(sw.results || {}).reduce((a, r) => a + r.items.length, 0), urgent: Object.values(sw.results || {}).reduce((a, r) => a + r.items.filter(i => i.urgent).length, 0)};
  const i = ALS.index.findIndex(x => x.id === sw.id); if (i >= 0) ALS.index[i] = s; else ALS.index.unshift(s); alPersist.index();
}

/* ---------- running a sweep ---------- */
async function alCtxFor(w) {
  const t = U.normTicker(w.ticker), th = S.theses.find(x => x.ticker === t);
  let run = null; const h = S.index.find(x => x.ticker === t && x.status === "done" && x.verdict); if (!th && h) run = await DB.getRun(h.id);
  return Object.assign({since: U.addDays(U.today(), -7)}, ALS.ctx[t] || {}, {terms: w.terms || "", below: w.below || "", above: w.above || "", thesis: AL.thesisLines(run, th)});
}
async function alSweep(tickers) {
  if (ALS.running || S.running) { toast("Wait for the current run to finish."); return; }
  if (!tickers.length) { toast("Add tickers on the Alert list first."); go("allist"); return; }
  if (!canRunEngine()) return;
  const est = AL.estimate({n: tickers.length, plan: ALS.settings.plan, searchDepth: ALS.settings.searchDepth});
  const left = Cost.budgetLeft(); if (left != null && est.sweep > left) { toast(`That sweep (≈ $${est.sweep.toFixed(2)}) would go over your monthly budget. Raise it in Settings → Cost & models.`, 8000); return; }
  const ctx = {}; for (const t of tickers) ctx[t] = await alCtxFor(ALS.list.find(w => U.normTicker(w.ticker) === t) || {ticker: t});
  const st = ALS.settings;
  const sw = AL.newSweep({tickers, ctx, plan: st.plan, searchDepth: st.searchDepth, reputableOnly: st.reputableOnly, blocked: st.blocked, urgentRule: st.urgentRule, scope: "all", engine: S.engine});
  await alSave(sw);
  return alExecute(sw);
}
async function alExecute(sw) {
  ALS.sweep = sw; ALS.running = true; ALS.ctl = new AbortController(); const t0 = Date.now(); ALS.t0 = t0;
  renderAlFeed();
  let tm = 0; const tick = () => { if (!tm) tm = setTimeout(() => { tm = 0; if (S.view === "alfeed") { renderAlBoard(); renderAlProgress(); } }, 200); };
  const timer = setInterval(() => { if (S.view === "alfeed") renderAlProgress(); }, 1000);
  try {
    await AL.execute(sw, {settings: S.settings, apiKey: S.key, signal: ALS.ctl.signal, save: alSave, onUpdate: tick});
    for (const t of sw.tickers) ALS.ctx[t] = AL.nextContext(ALS.ctx[t], sw, t);
    alPersist.ctx(); alMerge(sw.tickers.flatMap(t => sw.results[t].items));
    ALS.latest = {date: U.today(), at: Date.now(), sweepId: sw.id, cost: sw.cost, results: sw.results}; alPersist.latest();
    const n = sw.tickers.reduce((a, t) => a + sw.results[t].items.length, 0), u = sw.tickers.reduce((a, t) => a + sw.results[t].items.filter(i => i.urgent).length, 0);
    toast(`Sweep done: ${n} new item${n === 1 ? "" : "s"}${u ? `, ${u} urgent` : ""} · $${(sw.cost || 0).toFixed(2)}`, 6000);
    if (document.hidden) document.title = `✓ ${n} alerts${u ? " · " + u + " urgent" : ""}`;
  } catch (e) {
    sw.status = e.code === "cancelled" ? "stopped" : e.code === "budget" ? "budget" : "error"; sw.error = e.message;
    if (e.code !== "cancelled") toast(e.message, 7000);
  } finally {
    clearInterval(timer); ALS.running = false; ALS.ctl = null; await alSave(sw); updateNav();
    if (S.view === "alfeed") renderAlFeed(); else if (S.view === "alhist") renderAlHist();
  }
  return sw;
}
function alMerge(items) {
  const have = new Set(ALS.feed.map(i => i.ticker + "|" + i.id));
  ALS.feed = items.filter(i => !have.has(i.ticker + "|" + i.id)).concat(ALS.feed).slice(0, 800);
  alPersist.feed(); updateNav();
}

/* ---------- Feed ---------- */
function renderAlFeed() {
  if (S.inClaude || S.engine === "claude") {
    $("#alTop").innerHTML = ""; $("#alBoardSec").hidden = true; $("#alDigest").innerHTML = "";
    $("#alFeed").innerHTML = `<div class="card"><h3 class="h3">The Stock Alert System runs in the GitHub version</h3><p>It needs live web search and SEC data, which pages inside claude.ai can't reach. Open your GitHub Pages app to sweep tickers and get the 6:30 am digest.</p></div>`;
    return;
  }
  renderAlTop(); renderAlBoard(); renderAlProgress(); renderAlDigest(); renderAlItems();
}
function renderAlTop() {
  const on = alOn(), st = ALS.settings, run = ALS.running;
  const est = AL.estimate({n: ALS.sel === "all" ? on.length : 1, plan: st.plan, searchDepth: st.searchDepth});
  const estAll = AL.estimate({n: on.length, plan: st.plan, searchDepth: st.searchDepth});
  const dep = +st.searchDepth;
  $("#alTop").innerHTML = `<div class="lbl">Sweep the web for news about your stocks</div>
    <div class="row">
      <select class="field" id="alSel" aria-label="Which tickers" ${run ? "disabled" : ""}><option value="all">All on the alert list (${on.length})</option>${on.map(w => `<option value="${esc(U.normTicker(w.ticker))}" ${ALS.sel === U.normTicker(w.ticker) ? "selected" : ""}>${esc(U.normTicker(w.ticker))}</option>`).join("")}</select>
      <button class="btn primary" id="alGo" type="button" ${run || !on.length ? "disabled" : ""}>▶ Sweep now</button>
      ${run ? `<button class="btn stop" id="alStop" type="button">■ Stop</button>` : ""}
      ${on.length ? "" : `<button class="btn" type="button" data-view-go="allist">＋ Add tickers</button>`}
    </div>
    <div class="plans" role="radiogroup" aria-label="Cost plan">${Object.entries(A.PLANS).map(([k, p]) => `<button type="button" role="radio" class="plan-opt" data-alplan="${k}" aria-checked="${st.plan === k}" ${run ? "disabled" : ""}><b>${esc(p.label)}</b><span>${esc(AL.PLAN_TEXT[k].short)}</span></button>`).join("")}</div>
    <div class="depths"><span class="lbl">Web search</span>${[["0.5", "Light"], ["1", "Standard"], ["1.5", "Deep"]].map(([v, l]) => `<button type="button" role="radio" class="depth-opt" data-aldepth="${v}" aria-checked="${dep === +v}" ${run ? "disabled" : ""}>${l}</button>`).join("")}
      <span class="sep"></span><span class="lbl">Sources</span><button type="button" role="radio" class="depth-opt" data-alsrc="all" aria-checked="${!st.reputableOnly}" ${run ? "disabled" : ""} title="News, papers, analysts, podcasts plus Reddit, StockTwits, X, forums and blogs">All, incl. social</button><button type="button" role="radio" class="depth-opt" data-alsrc="rep" aria-checked="${!!st.reputableOnly}" ${run ? "disabled" : ""} title="Drops Reddit, StockTwits, X, forums and anonymous blogs">Reputable only</button></div>
    <div class="hint est">This sweep ≈ <b class="num">$${est.sweep.toFixed(2)}</b> · ${esc(est.minutes)} · the weekday 6:30 am digest for ${on.length} ticker${on.length === 1 ? "" : "s"} ≈ <b class="num">$${estAll.month.toFixed(0)}/month</b> on this plan · spent this month <b class="num">$${Cost.spentThisMonth().toFixed(2)}</b></div>
    <div class="progress" id="alProg" hidden><span id="alProgStep" class="num"></span><div class="bar"><i id="alProgBar" style="width:0%"></i></div><span id="alProgMeta" class="num"></span></div>`;
}
function renderAlBoard() {
  const sw = ALS.sweep, box = $("#alBoard"); $("#alBoardSec").hidden = false;
  const stages = [[0, "Free", "computed in code"], [1, "Web sentinels", ""], [2, "Editor", ""]];
  box.innerHTML = stages.map(([n, l, sub]) => `<div class="stage"><div class="stage-l"><span class="num">${n}</span>${l}${sub ? `<small>${sub}</small>` : ""}</div><div class="stage-seats">${
    AL.SENTINELS.filter(s => s.stage === n).map(s => {
      let state = s.free ? "free" : s.cadence ? (s.cadence === "daily" ? "daily" : "weekly") + " in the digest" : "";
      let dst = "idle";
      if (sw && (sw.status === "running" || ALS.sweep === sw)) {
        const x = AL.seatStatus(sw, s.id); dst = x.status;
        if (x.status === "running") state = `working · ${x.done}/${x.n}`;
        else if (x.status === "waiting") state = `⧗ queued at Anthropic · ${waitMins(x.waiting)}m`;
        else if (x.status === "done") state = `✓ ${x.items} item${x.items === 1 ? "" : "s"}${x.usage && U.isNum(x.usage.cost) ? " · $" + x.usage.cost.toFixed(2) : ""}`;
        else if (x.status === "idle") { state = "not due"; dst = "skipped"; }
        else if (x.status !== "queued") state = x.status;
      }
      return `<div class="seat" data-st="${dst}" style="--c:${s.color}"><span class="glyph">${s.code}</span><span class="name">${esc(s.name)}</span><span class="blurb">${esc(s.blurb)}</span>${state ? `<span class="state">${esc(state)}</span>` : ""}</div>`;
    }).join("")}</div></div>`).join("");
}
function renderAlProgress() {
  const p = $("#alProg"), sw = ALS.sweep; if (!p) return;
  if (!sw || (!ALS.running && sw.status === "done" && Date.now() - (sw.completedAt || 0) > 600000)) { p.hidden = true; return; }
  p.hidden = false;
  const keys = Object.keys(sw.reports), done = keys.filter(k => ["done", "skipped"].includes(sw.reports[k].status)).length;
  const waiting = keys.filter(k => sw.reports[k].status === "waiting");
  $("#alProgBar").style.width = (done / Math.max(1, keys.length) * 100) + "%";
  $("#alProgStep").textContent = ALS.running ? (waiting.length ? `WAITING FOR ANTHROPIC'S BATCH · ${waiting.length} CHECKS · ${waitMins(sw.reports[waiting[0]])} MIN` : `SWEEPING ${sw.tickers.join(" · ")} · ${done}/${keys.length}`) : `${done}/${keys.length} CHECKS · ${sw.status.toUpperCase()}`;
  const u = AL.totalUsage(sw);
  $("#alProgMeta").textContent = `${u ? u.searches + " searches · " : ""}$${AL.totalCost(sw).toFixed(2)} · ${A.PLANS[sw.plan]?.label || ""}${ALS.running ? " · " + secs(Date.now() - (ALS.t0 || sw.createdAt)) : ""}`;
}
const moodColor = m => m === "positive" ? "var(--good)" : m === "negative" ? "var(--bad)" : m === "mixed" ? "var(--warn)" : "var(--muted)";
function renderAlDigest() {
  const L = ALS.latest, box = $("#alDigest");
  if (!L || !L.results) { box.innerHTML = ""; return; }
  const ts = Object.keys(L.results);
  box.innerHTML = `<div class="card aldigest"><div class="sechead"><h3 class="h3">Latest sweep · ${esc(new Date(L.at).toLocaleString([], {weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}))}</h3><span class="muted small">${ts.length} ticker${ts.length === 1 ? "" : "s"}${U.isNum(L.cost) ? " · $" + L.cost.toFixed(2) : ""}</span></div>
    <div class="dg">${ts.map(t => { const r = L.results[t]; const u = r.items.filter(i => i.urgent).length;
      return `<button type="button" class="dgrow" data-alfilter="${esc(t)}" style="--m:${moodColor(r.mood)}"><span class="tk">${esc(t)}</span><span class="hl">${esc(r.headline)}</span><span class="meta">${u ? `<span class="urg">${u} urgent</span>` : ""}${r.items.length} item${r.items.length === 1 ? "" : "s"}${r.buzz ? ` · chatter ${esc(r.buzz)}` : ""}</span></button>`; }).join("")}</div></div>`;
}
function renderAlItems() {
  const f = ALS.filter, box = $("#alFeed");
  let items = ALS.feed.filter(i => (f.showDismissed || i.status !== "dismissed") && (!f.ticker || i.ticker === f.ticker)
    && (f.imp === "all" || (f.imp === "urgent" ? i.urgent : i.importance >= 3)));
  const tickers = [...new Set(ALS.feed.map(i => i.ticker))].sort();
  const unseen = alUnseen().length;
  let h = `<div class="sechead alhead"><span class="lbl">Alerts${unseen ? ` <span class="cnt">${unseen} new</span>` : ""}</span>
    <div class="seg" role="radiogroup" aria-label="Importance">${[["urgent", "Urgent"], ["notable", "Notable +"], ["all", "Everything"]].map(([k, l]) => `<button type="button" role="radio" data-alimp="${k}" aria-checked="${f.imp === k}">${l}</button>`).join("")}</div>
    <select class="field small" id="alTick" aria-label="Ticker"><option value="">All tickers</option>${tickers.map(t => `<option ${f.ticker === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
    <button class="btn small" type="button" id="alSeenAll" ${unseen ? "" : "disabled"}>✓ Mark all seen</button>
    <button class="btn small" type="button" id="alSync" title="Read the morning digest results from your GitHub repo">⟳ Sync from GitHub</button></div>`;
  if (!ALS.feed.length) { box.innerHTML = h + `<div class="emptybox">No alerts yet. ${alOn().length ? "Press <b>Sweep now</b>, or set up the 6:30 am digest on GitHub (see the Alert list)." : "Start by adding tickers to the <button class='linkbtn' type='button' data-view-go='allist'>Alert list</button>."}</div>`; return; }
  if (!items.length) { box.innerHTML = h + `<div class="emptybox">Nothing matches this filter.</div>`; return; }
  const day = i => String(i.date || "").slice(0, 10) || new Date(i.foundAt).toISOString().slice(0, 10);
  const groups = {}; items.slice(0, 300).forEach(i => (groups[day(i)] = groups[day(i)] || []).push(i));
  const label = d => d === U.today() ? "Today" : d === U.addDays(U.today(), -1) ? "Yesterday" : new Date(d + "T12:00").toLocaleDateString([], {weekday: "short", month: "short", day: "numeric", year: d.slice(0, 4) === U.today().slice(0, 4) ? undefined : "numeric"});
  h += Object.keys(groups).sort().reverse().map(d => `<div class="alday"><div class="alday-l">${esc(label(d))}</div>${groups[d].sort((a, b) => (b.urgent - a.urgent) || (b.importance - a.importance)).map(alItemHtml).join("")}</div>`).join("");
  box.innerHTML = h;
}
function alItemHtml(i) {
  const s = AL.sentinel(i.seat) || {code: "?", name: i.seat, color: "var(--fg-2)"};
  let host = ""; try { host = i.url ? new URL(i.url).hostname.replace(/^www\./, "") : ""; } catch {}
  return `<article class="alitem imp-${i.importance} ${i.status === "new" ? "unseen" : ""} ${i.status === "dismissed" ? "dismissed" : ""}" data-alid="${esc(i.ticker + "|" + i.id)}" style="--c:${s.color}">
    <div class="imp" title="Importance ${i.importance} of 5"><b>${i.importance}</b><span>${"●".repeat(i.importance)}${"○".repeat(5 - i.importance)}</span></div>
    <div class="albody">
      <div class="top"><span class="tk">${esc(i.ticker)}</span><span class="glyph" style="--c:${s.color}">${esc(s.code)}</span><span class="cat">${esc(s.name)}${i.kind ? " · " + esc(i.kind) : ""}</span>
        ${i.urgent ? `<span class="badge urg">Urgent</span>` : ""}${i.novelty === "update" ? `<span class="badge">Update</span>` : ""}${i.reputable ? "" : `<span class="badge unv">Unverified</span>`}
        <span class="sent" style="color:${dirColor(i.sentiment)}">${dirMark(i.sentiment)}</span></div>
      <h4>${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a>` : esc(i.title)}</h4>
      ${i.summary ? `<p class="sum">${esc(i.summary)}</p>` : ""}
      ${i.why ? `<p class="why"><b>Why it matters</b> ${esc(i.why)}</p>` : ""}
      ${i.thesisHit ? `<p class="thit">⚑ Thesis: ${esc(i.thesisHit)}</p>` : ""}
      <div class="src">${esc(i.source || host || "")}${host && i.source && !i.source.includes(host) ? ` · ${esc(host)}` : ""}${(i.also || []).length ? ` · also ${i.also.slice(0, 3).map(a => a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.source || "source")}</a>` : esc(a.source || "")).join(", ")}` : ""}</div>
    </div>
    <div class="acts">${i.status === "new" ? `<button class="btn small" type="button" data-alact="seen" title="Mark seen">✓</button>` : ""}<button class="btn small" type="button" data-alact="${i.status === "dismissed" ? "restore" : "dismiss"}">${i.status === "dismissed" ? "Restore" : "Dismiss"}</button><button class="btn small" type="button" data-alact="committee" title="Open the Investment Committee on this ticker">Committee →</button></div>
  </article>`;
}

/* ---------- Alert list ---------- */
function renderAlList() {
  const L = ALS.list;
  $("#viewAllist").innerHTML = `<main class="wrap"><div class="sechead"><span class="lbl">Alert list — the stocks the Alert System watches</span></div>
  <div class="card"><div class="tblwrap"><table class="dt allist"><thead><tr><th>On</th><th>Ticker</th><th>Also search for <span class="muted small">(names, products, people)</span></th><th>Alert if price ≤</th><th>Alert if price ≥</th><th>Last checked</th><th></th></tr></thead><tbody>
    ${L.map((w, i) => { const c = ALS.ctx[U.normTicker(w.ticker)]; return `<tr data-ali="${i}"><td><input type="checkbox" data-alf="on" ${w.on !== false ? "checked" : ""} aria-label="Watch ${esc(w.ticker)}"></td><td><b>${esc(w.ticker)}</b>${c?.name ? `<div class="muted small">${esc(c.name)}</div>` : ""}</td>
      <td><input class="field small" data-alf="terms" value="${esc(w.terms || "")}" placeholder="e.g. Select Water, John Schmitz"></td><td><input class="field small num" data-alf="below" value="${esc(w.below || "")}" inputmode="decimal" placeholder="–"></td><td><input class="field small num" data-alf="above" value="${esc(w.above || "")}" inputmode="decimal" placeholder="–"></td>
      <td class="small muted">${c?.lastSweep ? esc(fmtDate(c.lastSweep)) : "never"}</td><td><button class="del" type="button" data-aldel="${i}" aria-label="Remove ${esc(w.ticker)}">×</button></td></tr>`; }).join("") || `<tr><td colspan="7" class="muted">No tickers yet.</td></tr>`}
  </tbody></table></div>
  <div class="jrow"><input class="field" id="alNew" placeholder="Add tickers, e.g. WTTR, AESI" aria-label="Add tickers"><button class="btn primary small" type="button" id="alAdd">＋ Add</button>
    ${S.watchlist.length || S.holdings.length ? `<button class="btn small" type="button" id="alCopy">Copy from Committee watchlist & holdings</button>` : ""}
    <button class="btn small" type="button" id="alSaveList">✓ Save</button></div></div>
  <div class="card"><h3 class="h3">Morning digest by email (6:30 am Central, weekdays)</h3>
    <ol class="steps"><li>Press <button class="btn small" type="button" id="alExport">⇩ alerts.json</button> and add the file to the top folder of your GitHub repository (the same place as watchlist.json).</li>
      <li>That's it, if the Committee schedule is already set up (the <code>ANTHROPIC_API_KEY</code> secret and <code>SEC_USER_AGENT</code> variable). The <b>Committee queue</b> workflow starts the sweep at 4:30 am so Saver's half-price batch is done by 6:30, then opens a <b>☀ Morning digest</b> issue — GitHub emails it to you. Urgent items get their own <b>🚨</b> email, and during market hours free checks of filings and prices run every 30 minutes.</li>
      <li>Here, press <b>Sync from GitHub</b> on the Feed to see those results in the app.</li></ol>
    <p class="small muted">The file carries your plan (${esc(A.PLANS[ALS.settings.plan]?.label || "")}), search depth, sources choice and urgent rule. Export it again after you change them.</p></div></main>`;
}
function alReadList() { $$("[data-ali]").forEach(tr => { const w = ALS.list[+tr.dataset.ali]; if (!w) return; tr.querySelectorAll("[data-alf]").forEach(inp => { w[inp.dataset.alf] = inp.type === "checkbox" ? inp.checked : inp.value.trim(); }); }); }
function alExport() {
  alReadList(); alPersist.list();
  const st = ALS.settings;
  saveFile("alerts.json", JSON.stringify({app: "ai-stock-alert-system", version: A.VERSION, generated: new Date().toISOString(),
    settings: {plan: st.plan, searchDepth: +st.searchDepth, reputableOnly: !!st.reputableOnly, urgentRule: st.urgentRule, blocked: st.blocked},
    tickers: ALS.list.map(w => ({ticker: U.normTicker(w.ticker), on: w.on !== false, terms: w.terms || "", below: w.below || "", above: w.above || ""}))}, null, 2), "application/json");
}
async function alSync() {
  const {ghOwner: o, ghRepo: r, ghBranch: b} = S.settings; if (!o || !r) { toast("Set your GitHub owner and repository in Settings → GitHub first."); return; }
  const base = `https://raw.githubusercontent.com/${encodeURIComponent(o)}/${encodeURIComponent(r)}/${encodeURIComponent(b || "main")}/results/alerts/`;
  try {
    const feed = await (await fetch(base + "feed.json", {cache: "no-store"})).json();
    const before = ALS.feed.length; alMerge(feed.items || []);
    try { const L = await (await fetch(base + "latest.json", {cache: "no-store"})).json(); if (L && (!ALS.latest || L.at > ALS.latest.at)) { ALS.latest = L; alPersist.latest(); } } catch {}
    toast(`Synced ${ALS.feed.length - before} new alert${ALS.feed.length - before === 1 ? "" : "s"} from GitHub.`); renderAlFeed();
  } catch (e) { toast("No alert results on GitHub yet (results/alerts/feed.json). They appear after the first morning sweep.", 6000); }
}

/* ---------- Sweeps (history) ---------- */
async function renderAlHist() {
  const I = ALS.index;
  let h = `<main class="wrap"><div class="sechead"><span class="lbl">Sweeps run in this browser</span></div>`;
  if (!I.length) h += `<div class="emptybox">No sweeps yet.</div>`;
  else h += `<div class="hist">${I.map(x => `<div class="hrow" role="button" tabindex="0" data-alopen="${x.id}"><span class="t">${esc(x.tickers.slice(0, 4).join(" · "))}${x.tickers.length > 4 ? " +" + (x.tickers.length - 4) : ""}</span><span class="d num">${esc(fmtDate(x.createdAt))}</span>
    <span class="chip" style="color:${x.status === "done" ? "var(--good)" : x.status === "running" ? "var(--accent)" : "var(--bad)"}">${esc(x.status)}</span><span class="small">${x.items} items${x.urgent ? ` · <b style="color:var(--bad)">${x.urgent} urgent</b>` : ""}</span>
    <span class="tag">${esc(A.PLANS[x.plan]?.label || x.plan)}</span><span class="go"><span class="muted small num">$${(x.cost || 0).toFixed(2)}</span><button class="del" type="button" data-aldelsw="${x.id}" aria-label="Delete sweep">Delete</button>→</span></div>`).join("")}</div>`;
  h += `<div id="alSwDetail"></div></main>`;
  $("#viewAlhist").innerHTML = h;
  if (ALS.open) alShowSweep(ALS.open);
}
async function alShowSweep(id) {
  ALS.open = id; const sw = ALS.sweep?.id === id ? ALS.sweep : await DB.getRun(id); const box = $("#alSwDetail"); if (!box) return;
  if (!sw) { box.innerHTML = `<p class="muted">Not stored in this browser.</p>`; return; }
  const canResume = !ALS.running && sw.status !== "done";
  box.innerHTML = `<div class="card"><div class="sechead"><h3 class="h3">Sweep · ${esc(new Date(sw.createdAt).toLocaleString())}</h3><span class="muted small">${esc(A.PLANS[sw.plan]?.label || "")} · search ${({0.5: "Light", 1: "Standard", 1.5: "Deep"})[sw.searchDepth] || sw.searchDepth} · ${sw.reputableOnly ? "reputable sources only" : "all sources"} · $${AL.totalCost(sw).toFixed(2)}</span>${canResume ? `<button class="btn small" type="button" data-alresume="${sw.id}">⟳ Resume</button>` : ""}</div>
    ${sw.tickers.map(t => { const r = sw.results?.[t];
      return `<h4 class="h4">${esc(t)}${r ? ` · <span style="color:${moodColor(r.mood)}">${esc(r.headline)}</span>` : ""}</h4><div class="tblwrap"><table class="dt"><thead><tr><th>Sentinel</th><th>Status</th><th>Found</th><th>Searches</th><th>Model</th><th>Cost</th><th>Notes</th></tr></thead><tbody>${(sw.tasks[t] || []).map(sid => { const rep = sw.reports[AL.rk(t, sid)], s = AL.sentinel(sid);
        return `<tr><td style="color:${s.color}"><b>${esc(s.name)}</b></td><td class="small">${esc(rep.status)}</td><td class="num">${(rep.data?.items || []).length}</td><td class="num">${rep.usage?.searches ?? (s.free ? "–" : 0)}</td><td class="small">${esc(shortModel(rep.model || (s.free ? "code" : "")))}</td><td class="num">${rep.usage && U.isNum(rep.usage.cost) ? "$" + rep.usage.cost.toFixed(3) : s.free || rep.status === "skipped" ? "$0" : "–"}</td><td class="small">${rep.text ? `<details><summary>${esc(rep.text.split("\n")[0].replace(/^[-*#\s]+/, "").slice(0, 80))}</summary><div class="md">${md(rep.text)}</div>${sourcesHtml(rep.sources)}</details>` : ""}${rep.error ? `<span class="err">${esc(rep.error)}</span>` : ""}</td></tr>`; }).join("")}</tbody></table></div>`; }).join("")}</div>`;
}

/* ---------- events ---------- */
function alBind() {
  document.addEventListener("click", async e => {
    const t = e.target.closest("button, [data-alopen]"); if (!t) return; const d = t.dataset;
    if (d.app) { setApp(d.app); return; }
    if (d.viewGo) { go(d.viewGo); return; }
    if (d.alplan) { ALS.settings.plan = d.alplan; alPersist.settings(); renderAlTop(); renderEngine(); updateNav(); return; }
    if (d.aldepth) { ALS.settings.searchDepth = +d.aldepth; alPersist.settings(); renderAlTop(); return; }
    if (d.alsrc) { ALS.settings.reputableOnly = d.alsrc === "rep"; alPersist.settings(); renderAlTop(); return; }
    if (t.id === "alGo") { const v = $("#alSel").value; ALS.sel = v; alSweep(v === "all" ? alOn().map(w => U.normTicker(w.ticker)) : [v]); return; }
    if (t.id === "alStop") { ALS.ctl && ALS.ctl.abort(); return; }
    if (d.alimp) { ALS.filter.imp = d.alimp; renderAlItems(); return; }
    if (d.alfilter) { ALS.filter.ticker = ALS.filter.ticker === d.alfilter ? "" : d.alfilter; renderAlItems(); document.getElementById("alFeed").scrollIntoView({behavior: "smooth", block: "start"}); return; }
    if (t.id === "alSeenAll") { ALS.feed.forEach(i => { if (i.status === "new") i.status = "seen"; }); alPersist.feed(); updateNav(); renderAlItems(); return; }
    if (t.id === "alSync") { alSync(); return; }
    if (d.alact) { const card = t.closest("[data-alid]"); const it = ALS.feed.find(i => i.ticker + "|" + i.id === card.dataset.alid); if (!it) return;
      if (d.alact === "committee") { setApp("committee"); $("#ticker").value = it.ticker; renderConsole(); $("#ticker").focus(); return; }
      it.status = d.alact === "dismiss" ? "dismissed" : "seen"; alPersist.feed(); updateNav(); renderAlItems(); return; }
    // alert list
    if (t.id === "alAdd") { alReadList(); const add = $("#alNew").value.split(/[\s,;]+/).map(U.normTicker).filter(U.validTicker);
      add.forEach(tk => { if (!ALS.list.some(w => U.normTicker(w.ticker) === tk)) ALS.list.push({ticker: tk, on: true, terms: "", below: "", above: ""}); }); alPersist.list(); renderAlList(); updateNav(); return; }
    if (t.id === "alCopy") { alReadList(); let n = 0; S.watchlist.concat(S.holdings).forEach(w => { const tk = U.normTicker(w.ticker); if (U.validTicker(tk) && !ALS.list.some(x => U.normTicker(x.ticker) === tk)) { ALS.list.push({ticker: tk, on: true, terms: "", below: "", above: ""}); n++; } }); alPersist.list(); renderAlList(); toast(`Added ${n} ticker${n === 1 ? "" : "s"}.`); return; }
    if (t.id === "alSaveList") { alReadList(); alPersist.list(); toast("Alert list saved."); updateNav(); return; }
    if (d.aldel) { alReadList(); ALS.list.splice(+d.aldel, 1); alPersist.list(); renderAlList(); updateNav(); return; }
    if (t.id === "alExport") { alExport(); return; }
    if (t.id === "alBlockReset") { $("#alBlocked").value = AL.DEFAULTS.blocked; return; }
    // sweeps
    if (d.aldelsw) { e.stopPropagation(); if (d.confirm !== "1") { d.confirm = "1"; t.textContent = "Confirm"; setTimeout(() => { if (t.isConnected) { d.confirm = ""; t.textContent = "Delete"; } }, 3000); return; }
      await DB.delRun(d.aldelsw); ALS.index = ALS.index.filter(x => x.id !== d.aldelsw); alPersist.index(); if (ALS.open === d.aldelsw) ALS.open = null; renderAlHist(); return; }
    if (d.alresume) { const sw = await DB.getRun(d.alresume); if (!sw || !canRunEngine()) return; for (const k in sw.reports) { const r = sw.reports[k]; if (!["done", "skipped"].includes(r.status) && !(r.status === "waiting" && r.batch?.batchId)) { r.status = "queued"; r.error = null; } } go("alfeed"); alExecute(sw); return; }
    if (d.alopen) { alShowSweep(d.alopen); return; }
  });
  document.addEventListener("change", e => { if (e.target.id === "alTick") { ALS.filter.ticker = e.target.value; renderAlItems(); } if (e.target.id === "alSel") { ALS.sel = e.target.value; renderAlTop(); } });
}

/* ---------- switching apps ---------- */
function setApp(app) {
  S.app = app === "alerts" ? "alerts" : "committee"; LS.set("app", S.app);
  S.view = S.app === "alerts" ? (S.alView || "alfeed") : (S.cView || "analysis");
  updateNav(); renderEngine(); renderView(); if (S.app === "committee") renderConsole(); scrollTo(0, 0);
}
async function alBoot() {
  // sweeps that were waiting on Anthropic's Batch API keep going
  for (const x of ALS.index.filter(x => x.status === "running")) {
    const sw = await DB.getRun(x.id); if (!sw) continue;
    const waiting = Object.values(sw.reports).some(r => r.status === "waiting" && r.batch?.batchId);
    if (waiting && S.engine === "api" && (S.key || (S.settings.gatewayAnthropic && S.settings.gateway)) && !ALS.running) { toast("Picking up a sweep waiting at Anthropic's Batch API.", 5000); alExecute(sw); }
    else { sw.status = "stopped"; Object.values(sw.reports).forEach(r => { if (["running", "waiting"].includes(r.status)) { r.status = "stopped"; r.error = "Interrupted when the page closed. Open it under Sweeps and press Resume."; } }); await alSave(sw); }
  }
}
