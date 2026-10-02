/* Other views: Discover, Compare, Portfolio (holdings · watchlist · theses), Record (track record · journal), History, Lab, Settings. */

const needGateway = what => `<p class="muted small">${S.inClaude ? `${what} needs live data, which claude.ai pages can't fetch. Use the standalone (GitHub) version with a data gateway.` : `${what} needs a data gateway. Set one up in Settings → Data (free Cloudflare Worker, about 5 minutes).`}</p>`;

/* ---------------- Discover ---------------- */
function renderDiscover() {
  const d = S.discover, gw = A.data.available();
  const list = (key, title, note) => {
    const x = d[key];
    return `<div class="card"><div class="sechead"><h3 class="h3">${title}</h3><button class="btn small" type="button" data-disc="${key}" ${!gw || S.busy[key] ? "disabled" : ""}>${S.busy[key] ? "Loading…" : x ? "Refresh" : "Load"}</button></div><p class="small muted">${note}</p>
      ${!gw ? needGateway(title) : ""}
      ${x && x.error ? `<p class="err">${esc(x.error)}</p>` : ""}
      ${x && x.items ? (x.items.length ? `<ul class="disc">${x.items.slice(0, 25).map(it => `<li><span class="num muted">${esc(it.updated || it.last || "")}</span> <b>${esc(it.ticker || "")}</b> ${esc(it.company || it.issuer || "")} <span class="tag">${esc(it.kind)}</span>${it.buyers ? ` <span class="small muted">${it.buyers.map(esc).join("; ")} · $${n2(it.value)}</span>` : ""}
        ${it.href ? ` <a href="${esc(it.href)}" target="_blank" rel="noopener noreferrer">filing</a>` : ""}${it.ticker ? ` <button class="linkbtn" type="button" data-send="${esc(it.ticker)}">Send to committee →</button>` : ""}</li>`).join("")}</ul>` : `<p class="muted small">Nothing found right now.</p>`) : ""}</div>`;
  };
  const ideas = S.ideas;
  $("#viewDiscover").innerHTML = `<main class="wrap"><div class="sechead"><span class="lbl">Discover — ideas conventional screens miss</span></div>
  <div class="card"><h3 class="h3">Idea hunter</h3><p class="small muted">An Opus agent searches for companies in situations that screens misjudge, then you send the best to the committee.${S.engine === "claude" ? " In claude.ai it works from model knowledge only." : ""}</p>
    <form id="ideaForm" class="ideaform"><input class="field grow" id="ideaFocus" placeholder="Focus (optional): e.g. Permian water and oilfield services, small-cap industrials" value="${esc(S.ideaFocus || "")}">
      <input class="field" id="ideaCap" placeholder="Market cap, e.g. $300M–$10B" value="${esc(S.ideaCap || "")}">
      <button class="btn primary" type="submit" ${S.busy.ideas ? "disabled" : ""}>${S.busy.ideas ? "Hunting…" : "Hunt for ideas"}</button></form>
    <div class="sitchecks">${F.SITUATIONS.map((s, i) => `<label class="check"><input type="checkbox" data-sit="${i}" ${(S.ideaSits || []).includes(i) ? "checked" : ""}> ${esc(s)}</label>`).join("")}</div>
    ${ideas ? `${ideas.error ? `<p class="err">${esc(ideas.error)}</p>` : ""}
      ${(ideas.list || []).length ? `<div class="ideas">${ideas.list.map(x => `<div class="idea"><div class="idea-h"><b class="tk">${esc(x.ticker)}</b> ${esc(x.name || "")}<span class="tag">${esc(x.situation || "")}</span></div>
        <p><b>Why overlooked:</b> ${esc(x.why_overlooked || "")}</p>${x.leading_signal ? `<p><b>Leading signal:</b> ${esc(x.leading_signal)}</p>` : ""}${x.catalyst ? `<p><b>Catalyst:</b> ${esc(x.catalyst)}</p>` : ""}${x.key_risk ? `<p><b>Key risk:</b> ${esc(x.key_risk)}</p>` : ""}
        <div class="row-actions"><button class="btn small" type="button" data-send="${esc(x.ticker)}" data-mode="quick">Quick committee</button><button class="btn small primary" type="button" data-send="${esc(x.ticker)}" data-mode="full">Full committee</button></div></div>`).join("")}</div>`
        : ideas.text ? `<div class="md">${md(ideas.text)}</div>` : ""}` : ""}
  </div>
  <div class="grid2">${list("spin", "Spin-offs & new registrations", "Form 10 filings: forced selling by index funds and little analyst coverage often misprice new spin-offs.")}
  ${list("act", "Activist stakes (13D)", "New Schedule 13D filings: an activist has taken 5%+ and intends to push for change.")}</div>
  ${list("ins", "Insider buying (latest Form 4s)", "Open-market purchases from the most recent Form 4 filings, grouped by company. Several insiders buying together is the stronger signal.")}
  </main>`;
}
async function loadDiscover(key) {
  S.busy[key] = true; renderDiscover();
  try {
    const items = key === "spin" ? await F.spinoffs() : key === "act" ? await F.activism() : await F.insiderBuys(80);
    if (key !== "ins") { const m = await A.data.tickerMap().catch(() => null); items.forEach(it => it.ticker = it.ticker || (m && m.byC[it.cik]) || ""); }
    S.discover[key] = {items};
  } catch (e) { S.discover[key] = {error: e.message}; }
  S.busy[key] = false; renderDiscover();
}
async function huntIdeas() {
  if (!canRunEngine()) return;
  S.ideaFocus = $("#ideaFocus").value.trim(); S.ideaCap = $("#ideaCap").value.trim();
  S.ideaSits = $$("[data-sit]").filter(x => x.checked).map(x => +x.dataset.sit);
  S.busy.ideas = true; S.ideas = {text: ""}; renderDiscover();
  try {
    const out = await F.ideaHunt({focus: S.ideaFocus, cap: S.ideaCap, situations: S.ideaSits.map(i => F.SITUATIONS[i]), engine: S.engine, settings: S.settings, apiKey: S.key, member: S.profile.expertise,
      onText: t => { S.ideas.text = t; const el = $(".ideas") || null; if (!el) { /* light refresh */ } }});
    S.ideas = {text: out.text, list: out.data?.ideas || [], usage: out.usage};
  } catch (e) { S.ideas = {error: e.message, text: e.partial || ""}; }
  S.busy.ideas = false; renderDiscover();
}

/* ---------------- Compare ---------------- */
function renderCompare() {
  const cmp = S.compareCurrent;
  $("#viewCompare").innerHTML = `<main class="wrap"><div class="sechead"><span class="lbl">Compare peers side by side</span></div>
  <form class="card cmpform" id="cmpForm"><input class="field grow" id="cmpTickers" placeholder="2–5 tickers, e.g. WTTR, AESI, LBRT" value="${esc(S.cmpTickers || "")}" aria-label="Tickers">
    <select class="field" id="cmpMode" aria-label="Mode for tickers without a recent run">${["quick", "standard", "full"].map(m => `<option value="${m}" ${S.cmpMode === m ? "selected" : ""}>${A.MODES[m].label} for missing</option>`).join("")}</select>
    <label class="check"><input type="checkbox" id="cmpReuse" ${S.cmpReuse !== false ? "checked" : ""}> Reuse runs from the last 14 days</label>
    <button class="btn primary" type="submit" ${S.running || S.busy.compare ? "disabled" : ""}>${S.busy.compare ? esc(S.busy.compare) : "Compare"}</button></form>
  ${cmp ? compareTable(cmp) : `<p class="muted">Runs the committee on any ticker without a recent analysis, then the CIO ranks them for your profile.</p>`}
  ${S.compares.length ? `<div class="card"><h3 class="h3">Earlier comparisons</h3><ul class="disc">${S.compares.map((c, i) => `<li><span class="num muted">${esc(new Date(c.at).toLocaleDateString())}</span> ${c.rows.map(r => esc(r.ticker)).join(" · ")} <button class="linkbtn" type="button" data-cmpopen="${i}">Open</button></li>`).join("")}</ul></div>` : ""}</main>`;
}
function compareTable(cmp) {
  const R = cmp.rows, rank = t => (cmp.ranking || []).find(r => String(r.ticker).toUpperCase() === t);
  const rows = [["Rank", r => rank(r.ticker)?.rank ?? "–"], ["Verdict", r => `<span class="chip sm" style="color:${verdictColor(r.verdict)}">${esc(r.verdict || "–")}</span>`], ["Overall", r => r.overall ?? "–"], ["Quality", r => r.quality ?? "–"], ["Price", r => r.price ?? "–"],
    ["Expected return", r => spct(r.expReturn)], ["Market-implied growth", r => spct(r.implied)], ["Revenue growth", r => spct(r.revGrowth)], ["Op margin", r => pct(r.opMargin)], ["FCF yield", r => pct(r.fcfYield)],
    ["ROIC", r => pct(r.roic)], ["Net debt/EBITDA", r => U.isNum(r.ndEbitda) ? r.ndEbitda.toFixed(1) + "×" : "–"], ["P/E", r => n2(r.pe, 1)], ["RS vs SPY 6m", r => spct(r.rs6)], ["Piotroski", r => r.piotroski ?? "–"]];
  return `<div class="card"><div class="tblwrap"><table class="dt cmp"><thead><tr><th></th>${R.map(r => `<th><button class="linkbtn" type="button" data-openrun="${esc(r.runId || "")}">${esc(r.ticker)}</button></th>`).join("")}</tr></thead><tbody>
    ${rows.map(([k, f]) => `<tr><th>${k}</th>${R.map(r => `<td class="num">${f(r)}</td>`).join("")}</tr>`).join("")}
    <tr><th>Thesis</th>${R.map(r => `<td class="small">${esc(r.thesis || "")}</td>`).join("")}</tr></tbody></table></div>
    ${(cmp.ranking || []).length ? `<h4 class="h4">CIO ranking</h4><ol>${cmp.ranking.slice().sort((a, b) => a.rank - b.rank).map(r => `<li><b>${esc(r.ticker)}</b> — ${esc(r.reason)}</li>`).join("")}</ol>` : cmp.text ? `<div class="md">${md(cmp.text)}</div>` : ""}</div>`;
}
async function runCompare() {
  const tickers = [...new Set($("#cmpTickers").value.split(/[\s,;]+/).map(U.normTicker).filter(U.validTicker))].slice(0, 5);
  if (tickers.length < 2) { toast("Enter 2–5 tickers."); return; }
  if (!canRunEngine()) return;
  S.cmpTickers = tickers.join(", "); S.cmpMode = $("#cmpMode").value; S.cmpReuse = $("#cmpReuse").checked;
  const reuse = [], fresh = [];
  for (const t of tickers) { const recent = S.cmpReuse && S.index.find(h => h.ticker === t && h.status === "done" && Date.now() - h.createdAt < 14 * 864e5); if (recent) reuse.push(t); else fresh.push(t); }
  if (!budgetOk(S.cmpMode, S.plan, fresh.length)) return;
  let left = fresh.length; S.busy.compare = fresh.length ? `Running ${fresh.join(", ")} side by side${S.plan === "saver" ? " (Saver: usually within an hour)" : ""}…` : "Loading…"; renderCompare();
  const runs = await Promise.all(tickers.map(async t => { if (reuse.includes(t)) { const h = S.index.find(x => x.ticker === t && x.status === "done"); return DB.getRun(h.id); }
    const r = await runQuiet({ticker: t, mode: S.cmpMode}); left--; S.busy.compare = left ? `${left} still running…` : "Ranking…"; renderCompare(); return r; }));
  const bad = runs.find(r => !r || r.status !== "done");
  if (bad) { S.busy.compare = false; renderCompare(); toast(`${bad?.ticker || "A run"} didn't finish (${bad?.error || "stopped"}); comparison stopped.`, 7000); return; }
  S.busy.compare = "Ranking…"; renderCompare();
  try {
    const res = await F.compareJudge(runs, {engine: S.engine, settings: S.settings, apiKey: S.key, profile: S.profile});
    res.rows.forEach((r, i) => r.runId = runs[i].id);
    S.compareCurrent = {at: Date.now(), rows: res.rows, ranking: res.ranking, text: res.text};
    S.compares.unshift(S.compareCurrent); persist.compares();
  } catch (e) { toast(e.message, 6000); }
  S.busy.compare = false; S.view = "compare"; updateNav(); renderCompare();
}

/* ---------------- Portfolio ---------------- */
function renderPortfolio() {
  const tabs = [["holdings", "Holdings"], ["watchlist", "Watchlist"], ["theses", "Thesis tracker"]];
  let body = "";
  if (S.portTab === "holdings") body = holdingsHtml(); else if (S.portTab === "watchlist") body = watchlistHtml(); else body = thesesHtml();
  $("#viewPortfolio").innerHTML = `<main class="wrap"><div class="tabbar" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-ptab="${k}" aria-selected="${S.portTab === k}">${l}</button>`).join("")}</div>${body}</main>`;
}
function holdingsHtml() {
  const H = S.holdings;
  return `<div class="card"><p class="small muted">Holdings let the Portfolio Manager check correlation, sector exposure and tax lots. They stay in this browser.</p>
  <div class="tblwrap"><table class="dt edit"><thead><tr><th>Ticker</th><th>Shares</th><th>Cost / share</th><th>Bought</th><th>Account</th><th>Sector</th><th>Last</th><th>P/L</th><th></th></tr></thead><tbody>
  ${H.map((h, i) => `<tr data-hi="${i}"><td><input class="field sm" data-hf="ticker" value="${esc(h.ticker)}" aria-label="Ticker"></td><td><input class="field sm" data-hf="shares" value="${esc(h.shares ?? "")}" inputmode="decimal" aria-label="Shares"></td>
    <td><input class="field sm" data-hf="cost" value="${esc(h.cost ?? "")}" inputmode="decimal" aria-label="Cost"></td><td><input class="field sm" type="date" data-hf="date" value="${esc(h.date || "")}" aria-label="Purchase date"></td>
    <td><select class="field sm" data-hf="account" aria-label="Account">${["Taxable", "IRA", "Roth IRA", "401(k)", "HSA", "Other"].map(a => `<option ${h.account === a ? "selected" : ""}>${a}</option>`).join("")}</select></td>
    <td><input class="field sm" data-hf="sector" value="${esc(h.sector || "")}" aria-label="Sector"></td><td class="num">${n2(h.last)}</td><td class="num" style="color:${(h.last - h.cost) >= 0 ? "var(--good)" : "var(--bad)"}">${U.isNum(h.last) && U.isNum(+h.cost) && +h.cost ? spct(h.last / h.cost - 1) : "–"}</td>
    <td><button class="del" type="button" data-hdel="${i}" aria-label="Remove">×</button></td></tr>`).join("") || `<tr><td colspan="9" class="muted">No holdings yet.</td></tr>`}</tbody></table></div>
  <div class="row-actions"><button class="btn small" type="button" id="hAdd">＋ Add row</button><button class="btn small primary" type="button" id="hSave">Save</button><button class="btn small" type="button" id="hPrices" ${A.data.available() ? "" : "disabled"}>Refresh prices</button></div>
  <details class="paste"><summary>Paste CSV (ticker, shares, cost, date, account)</summary><textarea class="field" id="hCsv" rows="4" placeholder="WTTR, 1000, 9.50, 2025-03-14, Taxable"></textarea><button class="btn small" type="button" id="hImport">Import</button></details></div>`;
}
function watchlistHtml() {
  const W = S.watchlist, due = W.filter(isDue);
  return `<div class="card"><p class="small muted">The app checks the watchlist each time it opens. For runs on a schedule while your computer is off, export watchlist.json to your GitHub repo — the included GitHub Action re-runs due tickers and opens an issue when an alert fires.</p>
  ${due.length ? `<div class="warnbox"><b>${due.length} due for review:</b> ${due.map(w => esc(w.ticker)).join(", ")} ${S.busy.watch ? `<span class="small muted">${esc(S.busy.watch)}</span>` : `<button class="btn small" type="button" id="wRunDue">Run due now</button>`}</div>` : ""}
  ${(S.alertHits || []).length ? `<div class="warnbox bad"><b>Alerts triggered:</b>${S.alertHits.map(a => `<div>${esc(a.ticker)}: ${esc(a.text)}</div>`).join("")}</div>` : ""}
  <div class="tblwrap"><table class="dt edit"><thead><tr><th>Ticker</th><th>Cadence</th><th>Mode</th><th>Alerts</th><th>Last run</th><th>Verdict</th><th>Status</th><th></th></tr></thead><tbody>
  ${W.map((w, i) => { const last = S.index.find(h => h.ticker === w.ticker && h.status === "done");
    return `<tr data-wi="${i}"><td><b>${esc(w.ticker)}</b></td><td><select class="field sm" data-wf="cadence" aria-label="Cadence">${["weekly", "monthly", "quarterly", "after earnings"].map(c => `<option ${w.cadence === c ? "selected" : ""}>${c}</option>`).join("")}</select></td>
    <td><select class="field sm" data-wf="mode" aria-label="Mode">${["quick", "standard", "earnings", "full"].map(m => `<option value="${m}" ${w.mode === m ? "selected" : ""}>${A.MODES[m].label}</option>`).join("")}</select></td>
    <td><input class="field sm wide" data-wf="alertsText" value="${esc(alertsText(w.alerts))}" placeholder="below 8.5; above 14" aria-label="Alerts"></td>
    <td class="num">${last ? esc(new Date(last.createdAt).toLocaleDateString()) : "never"}</td><td>${last?.verdict ? `<span class="chip sm" style="color:${verdictColor(last.verdict)}">${esc(last.verdict)}</span>` : ""}</td>
    <td>${isDue(w) ? `<span style="color:var(--warn)">due</span>` : "ok"}</td><td><button class="del" type="button" data-wdel="${i}" aria-label="Remove">×</button></td></tr>`; }).join("") || `<tr><td colspan="8" class="muted">Add tickers from a committee result ("＋ Watchlist") or below.</td></tr>`}</tbody></table></div>
  <div class="row-actions"><input class="field sm" id="wNew" placeholder="Ticker" aria-label="Add ticker"><button class="btn small" type="button" id="wAdd">＋ Add</button><button class="btn small primary" type="button" id="wSave">Save</button>
    <button class="btn small" type="button" id="wCheck" ${A.data.available() ? "" : "disabled"}>Check price alerts</button><button class="btn small" type="button" id="wExport">⇩ watchlist.json</button><button class="btn small" type="button" id="wSync" ${S.settings.ghOwner && S.settings.ghRepo && !S.inClaude ? "" : "disabled"}>Sync results from GitHub</button></div>
  ${!S.settings.ghRepo ? `<p class="small muted">Set your GitHub repo in Settings → GitHub to import scheduled results.</p>` : ""}</div>`;
}
const alertsText = al => (al || []).map(a => a.type === "price_below" ? "below " + a.value : a.type === "price_above" ? "above " + a.value : a.type + " " + a.value).join("; ");
function parseAlerts(t) { return String(t || "").split(/[;,]/).map(s => s.trim()).filter(Boolean).map(s => { const m = s.match(/^(below|above)\s+([\d.]+)/i); return m ? {type: m[1].toLowerCase() === "below" ? "price_below" : "price_above", value: m[2]} : {type: "event", value: s}; }); }
function isDue(w) {
  const last = S.index.find(h => h.ticker === w.ticker && h.status === "done"); if (!last) return true;
  const days = (Date.now() - last.createdAt) / 864e5;
  return w.cadence === "weekly" ? days >= 7 : w.cadence === "monthly" ? days >= 30 : w.cadence === "quarterly" ? days >= 91 : days >= 91;
}
function thesesHtml() {
  if (!S.theses.length) return `<div class="card"><p class="muted">Track a thesis from any committee result ("Track thesis"). Each one keeps the variant view, dated catalysts and kill criteria, and can be re-checked with a live search.</p></div>`;
  return S.theses.map((t, i) => `<div class="card thesis-card" data-ti="${i}"><div class="sechead"><h3 class="h3">${esc(t.ticker)} <span class="chip sm" style="color:${verdictColor(t.verdict)}">${esc(t.verdict || "")}</span></h3>
    <select class="field sm" data-tf="status" aria-label="Status">${["intact", "weakening", "broken"].map(s => `<option ${t.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    <button class="btn small" type="button" data-tcheck="${i}" ${S.busy["th" + i] ? "disabled" : ""}>${S.busy["th" + i] ? "Checking…" : "Check now"}</button><button class="del" type="button" data-tdel="${i}" aria-label="Remove thesis">×</button></div>
    <p><b>Thesis:</b> ${esc(t.thesis)}</p>${t.variant ? `<p><b>Variant view:</b> ${esc(t.variant)}</p>` : ""}
    <div class="grid2"><div><h4 class="h4">Catalysts</h4><ul class="checklist">${t.catalysts.map((c, k) => `<li><label class="check"><input type="checkbox" data-tcat="${k}" ${c.done ? "checked" : ""}> <span class="num muted">${esc(c.date || "")}</span> ${esc(c.event)}</label>${c.update ? `<div class="small muted">${esc(c.update)}</div>` : ""}</li>`).join("")}</ul></div>
    <div><h4 class="h4">Kill criteria</h4><ul class="checklist">${t.kill.map(k => `<li><span class="tag ${k.status}">${esc(k.status.replace("_", " "))}</span> ${esc(k.criterion)}${k.evidence ? `<div class="small muted">${esc(k.evidence)}</div>` : ""}</li>`).join("")}</ul></div></div>
    <textarea class="field" data-tf="notes" rows="2" placeholder="Your notes" aria-label="Notes">${esc(t.notes || "")}</textarea>
    ${t.checks?.length ? `<details><summary class="small">Last check ${esc(new Date(t.checks[0].at).toLocaleDateString())} — ${esc(t.checks[0].status || "")}</summary><div class="md">${md(t.checks[0].text)}</div></details>` : ""}</div>`).join("");
}
async function checkThesis(i) {
  if (!canRunEngine()) return;
  const t = S.theses[i]; S.busy["th" + i] = true; renderPortfolio();
  try {
    const out = await F.checkThesis(t, {engine: S.engine, settings: S.settings, apiKey: S.key});
    const d = out.data || {};
    if (d.status) t.status = d.status;
    (d.kill_checks || []).forEach(k => { const m = t.kill.find(x => x.criterion.toLowerCase().includes(String(k.criterion).toLowerCase().slice(0, 30)) || String(k.criterion).toLowerCase().includes(x.criterion.toLowerCase().slice(0, 30))); if (m) { m.status = k.status; m.evidence = k.evidence || ""; } });
    (d.catalyst_updates || []).forEach(u => { const m = t.catalysts.find(c => c.event.toLowerCase().includes(String(u.event).toLowerCase().slice(0, 25)) || String(u.event).toLowerCase().includes(c.event.toLowerCase().slice(0, 25))); if (m) m.update = u.update; });
    t.checks = [{at: Date.now(), status: d.status, text: out.text}].concat(t.checks || []).slice(0, 5);
    persist.theses();
  } catch (e) { toast(e.message, 6000); }
  S.busy["th" + i] = false; renderPortfolio();
}

/* ---------------- Record: track record + journal ---------------- */
function renderRecord() {
  const tabs = [["track", "Track record"], ["journal", "Journal"]];
  $("#viewRecord").innerHTML = `<main class="wrap"><div class="tabbar" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-rtab="${k}" aria-selected="${S.recTab === k}">${l}</button>`).join("")}</div>${S.recTab === "track" ? trackHtml() : journalHtml()}</main>`;
}
function trackHtml() {
  const cal = C.calibration(S.track);
  return `<div class="card"><p class="small muted">Every completed run is logged with its price on the day — forward only. Backtesting old dates with a language model is contaminated because the model already knows what happened. Returns are measured against SPY at 3, 6 and 12 months.</p>
    <div class="tiles"><div class="tile"><span>Calls logged</span><b class="num">${S.track.length}</b></div><div class="tile"><span>Matured (≥3 mo)</span><b class="num">${cal.n}</b></div><div class="tile"><span>Hit rate</span><b class="num">${pct(cal.hitRate, 0)}</b><small>bullish beat SPY / bearish lagged</small></div><div class="tile"><span>Score → return rank corr.</span><b class="num">${U.isNum(cal.rhoOverall) ? cal.rhoOverall.toFixed(2) : "–"}</b></div></div>
    <div class="row-actions"><button class="btn small primary" type="button" id="tUpdate" ${A.data.available() && !S.busy.track ? "" : "disabled"}>${S.busy.track ? esc(S.busy.track) : "Update prices"}</button>${!A.data.available() ? `<span class="small muted">No gateway: enter current prices by hand below.</span>` : ""}</div></div>
  <div class="grid2"><div class="card"><h3 class="h3">Average excess return by score</h3>${Charts.buckets(cal.buckets)}</div>
    <div class="card"><h3 class="h3">By verdict</h3><table class="dt"><thead><tr><th>Verdict</th><th>n</th><th>Avg excess</th></tr></thead><tbody>${cal.verdicts.map(v => `<tr><td><span class="chip sm" style="color:${verdictColor(v.verdict)}">${esc(v.verdict)}</span></td><td class="num">${v.n}</td><td class="num">${spct(v.avgExcess)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">No matured calls.</td></tr>`}</tbody></table>
    <h3 class="h3">Which seats predict returns</h3><table class="dt"><thead><tr><th>Seat</th><th>n</th><th>Rank corr. (self-score vs excess return)</th></tr></thead><tbody>${cal.seats.filter(s => s.n).map(s => `<tr><td>${esc(A.seat(s.seat)?.name || s.seat)}</td><td class="num">${s.n}</td><td class="num">${U.isNum(s.rho) ? s.rho.toFixed(2) : "need 5+"}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Not enough data yet.</td></tr>`}</tbody></table>
    ${cal.sectors.length ? `<h3 class="h3">By sector</h3><table class="dt"><tbody>${cal.sectors.map(s => `<tr><td>${esc(s.sector)}</td><td class="num">${s.n}</td><td class="num">${spct(s.avgExcess)}</td></tr>`).join("")}</tbody></table>` : ""}</div></div>
  <div class="card"><h3 class="h3">Calls</h3><div class="tblwrap"><table class="dt"><thead><tr><th>Date</th><th>Ticker</th><th>Verdict</th><th>Score</th><th>Entry</th><th>Exp. return</th><th>3m</th><th>6m</th><th>12m</th><th>Now</th><th>vs SPY</th><th>Manual price</th></tr></thead><tbody>
  ${S.track.map((e, i) => `<tr><td class="num">${esc(e.date)}</td><td><b>${esc(e.ticker)}</b></td><td><span class="chip sm" style="color:${verdictColor(e.verdict)}">${esc(e.verdict || "–")}</span></td><td class="num">${e.overall ?? "–"}</td><td class="num">${n2(e.price)}</td><td class="num">${spct(e.expReturn)}</td>
    ${["m3", "m6", "m12"].map(k => `<td class="num">${e.rets?.[k] ? spct(e.rets[k].r) : "–"}</td>`).join("")}<td class="num">${e.now ? spct(e.now.r) : "–"}</td><td class="num">${e.now ? spct(e.now.excess) : "–"}</td>
    <td><input class="field sm" data-tm="${i}" placeholder="price" inputmode="decimal" aria-label="Current price for ${esc(e.ticker)}"></td></tr>`).join("") || `<tr><td colspan="12" class="muted">Complete a committee run to start the record.</td></tr>`}</tbody></table></div></div>`;
}
function journalHtml() {
  const J = S.journal;
  const agree = J.filter(j => j.decision && j.verdict).map(j => { const v = U.verdictClass(j.verdict), d = j.decision; const buy = ["Bought", "Added"].includes(d), sell = ["Sold", "Trimmed"].includes(d); return v === "bull" ? buy : v === "bear" ? sell || d === "Passed" : !buy && !sell; });
  return `<div class="card"><div class="tiles"><div class="tile"><span>Decisions logged</span><b class="num">${J.length}</b></div><div class="tile"><span>Followed the committee</span><b class="num">${agree.length ? pct(U.mean(agree.map(Number)), 0) : "–"}</b></div></div>
  <div class="row-actions"><button class="btn small" type="button" id="jExport">⇩ Journal CSV</button></div>
  <div class="tblwrap"><table class="dt"><thead><tr><th>Date</th><th>Ticker</th><th>Committee</th><th>You</th><th>Price</th><th>Size</th><th>Since</th><th>Notes</th><th></th></tr></thead><tbody>
  ${J.map((j, i) => { const tr = S.track.find(t => t.runId === j.runId); const since = tr?.now && U.isNum(+j.price) && +j.price ? tr.now.price / +j.price - 1 : null;
    return `<tr><td class="num">${esc(j.date)}</td><td><b>${esc(j.ticker)}</b></td><td><span class="chip sm" style="color:${verdictColor(j.verdict)}">${esc(j.verdict || "–")}</span></td><td>${esc(j.decision)}</td><td class="num">${esc(j.price ?? "")}</td><td>${esc(j.size ?? "")}</td><td class="num">${spct(since)}</td><td class="small">${esc(j.notes || "")}</td><td><button class="del" type="button" data-jdel="${i}" aria-label="Delete">×</button></td></tr>`; }).join("") || `<tr><td colspan="9" class="muted">Log a decision under any committee result.</td></tr>`}</tbody></table></div></div>`;
}

/* ---------------- History ---------------- */
function renderHistory() {
  const L = $("#histList");
  if (!S.index.length) { L.innerHTML = `<div class="emptybox">No analyses yet. Run the committee on a ticker and it will be listed here.</div>`; return; }
  L.innerHTML = S.index.map(h => `<div class="hrow" role="button" tabindex="0" data-id="${h.id}"><span class="t">${esc(h.ticker)}</span><span class="d num">${esc(fmtDate(h.createdAt))}</span>
    ${h.verdict ? `<span class="chip" style="color:${verdictColor(h.verdict)}">${esc(h.verdict)}</span>` : `<span class="chip" style="color:var(--muted)">${esc(h.status)}</span>`}
    ${h.overall != null ? `<span class="s num" style="color:${scoreColor(h.overall)}">${h.overall}/10</span>` : ""}${U.isNum(h.expReturn) ? `<span class="small num">${spct(h.expReturn)} EV</span>` : ""}
    ${h.reanalysis ? `<span class="re">↻ RE</span>` : ""}<span class="tag">${esc(A.MODES[h.mode]?.label || h.mode || "")}</span>
    <span class="go"><span class="muted small">${esc(h.engine === "claude" ? "claude.ai" : h.model || "")}</span><button class="del" type="button" data-del="${h.id}" aria-label="Delete ${esc(h.ticker)} analysis">Delete</button>→</span></div>`).join("");
}

/* ---------------- Lab (evals) ---------------- */
function renderLab() {
  const E = S.evals;
  $("#viewLab").innerHTML = `<main class="wrap"><div class="sechead"><span class="lbl">Lab — evaluate prompt and model changes</span></div>
  <form class="card" id="labForm"><p class="small muted">Run a fixed set of tickers after changing prompts, models or settings, then compare against an earlier benchmark: verdict flips, score shifts, contradictions, uncited claims, primary-source share, cost and time. Runs go side by side in the background on your current plan. The GitHub Action can run the same benchmark overnight at Batch prices (workflow "Benchmark (Lab)").</p>
    <div class="jrow"><input class="field grow" id="labTickers" value="${esc(S.labTickers || "AAPL, KO, XOM, PLTR, WTTR")}" aria-label="Benchmark tickers"><select class="field" id="labMode" aria-label="Mode">${["quick", "standard", "full"].map(m => `<option value="${m}">${A.MODES[m].label}</option>`).join("")}</select>
    <input class="field" id="labLabel" placeholder="Label, e.g. 'devil on other model'" aria-label="Label"><button class="btn primary" type="submit" ${S.running || S.busy.lab ? "disabled" : ""}>${S.busy.lab ? esc(S.busy.lab) : "Run benchmark"}</button></div></form>
  ${E.length ? `<div class="card"><h3 class="h3">Benchmarks</h3><ul class="disc">${E.map((e, i) => `<li><span class="num muted">${esc(new Date(e.at).toLocaleString())}</span> <b>${esc(e.label || "unlabeled")}</b> <span class="tag">${esc(e.promptVersion)} · ${esc(e.model)} · ${esc(e.mode)}</span> ${e.results.length} tickers <button class="del" type="button" data-edel="${i}" aria-label="Delete benchmark">×</button></li>`).join("")}</ul>
    ${E.length >= 2 ? `<div class="jrow"><select class="field" id="labA" aria-label="Baseline">${E.map((e, i) => `<option value="${i}" ${i === 1 ? "selected" : ""}>${esc(e.label || new Date(e.at).toLocaleString())}</option>`).join("")}</select> vs <select class="field" id="labB" aria-label="Candidate">${E.map((e, i) => `<option value="${i}">${esc(e.label || new Date(e.at).toLocaleString())}</option>`).join("")}</select><button class="btn small" type="button" id="labCmp">Compare</button></div>` : ""}
    <div id="labDiff"></div></div>` : ""}</main>`;
}
function labDiffHtml(a, b) {
  const D = F.evalDiff(a, b); const sum = k => r => r.reduce((s, x) => s + (x[k] || 0), 0);
  const agg = (e, k) => sum(k)(e.results);
  return `<div class="tblwrap"><table class="dt"><thead><tr><th>Ticker</th><th>Verdict A → B</th><th>Score Δ</th><th>Contradictions</th><th>Uncited</th><th>Primary share</th><th>Citations</th><th>Output tokens</th><th>Searches</th><th>Cost</th></tr></thead><tbody>
  ${D.map(d => `<tr><td><b>${esc(d.ticker)}</b></td><td>${esc(d.a.verdict || "–")} → <span style="color:${d.verdictChanged ? "var(--warn)" : "inherit"}">${esc(d.b.verdict || "–")}</span></td><td class="num">${U.isNum(d.scoreDelta) ? (d.scoreDelta > 0 ? "+" : "") + d.scoreDelta : "–"}</td>
    <td class="num">${d.a.contradictions ?? "–"} → ${d.b.contradictions ?? "–"}</td><td class="num">${d.a.uncited ?? "–"} → ${d.b.uncited ?? "–"}</td><td class="num">${pct(d.a.primaryShare, 0)} → ${pct(d.b.primaryShare, 0)}</td><td class="num">${d.a.citations ?? "–"} → ${d.b.citations ?? "–"}</td><td class="num">${fmtK(d.a.outTok)} → ${fmtK(d.b.outTok)}</td><td class="num">${d.a.searches ?? "–"} → ${d.b.searches ?? "–"}</td><td class="num">${U.isNum(d.a.cost) ? "$" + d.a.cost.toFixed(2) : "–"} → ${U.isNum(d.b.cost) ? "$" + d.b.cost.toFixed(2) : "–"}</td></tr>`).join("")}
  <tr><th>Total</th><td>${D.filter(d => d.verdictChanged).length} flips</td><td></td><td class="num">${agg(a, "contradictions")} → ${agg(b, "contradictions")}</td><td class="num">${agg(a, "uncited")} → ${agg(b, "uncited")}</td><td></td><td class="num">${agg(a, "citations")} → ${agg(b, "citations")}</td><td class="num">${fmtK(agg(a, "outTok"))} → ${fmtK(agg(b, "outTok"))}</td><td class="num">${agg(a, "searches")} → ${agg(b, "searches")}</td><td class="num">$${agg(a, "cost").toFixed(2)} → $${agg(b, "cost").toFixed(2)}</td></tr></tbody></table></div>`;
}
async function runLab() {
  const tickers = [...new Set($("#labTickers").value.split(/[\s,;]+/).map(U.normTicker).filter(U.validTicker))].slice(0, 10);
  if (!tickers.length || !canRunEngine()) return;
  S.labTickers = tickers.join(", ");
  const mode = $("#labMode").value, label = $("#labLabel").value.trim();
  if (!budgetOk(mode, S.plan, tickers.length)) return;
  const ev = {at: Date.now(), label, mode, plan: S.engine === "claude" ? "" : S.plan, model: S.engine === "claude" ? "claude.ai" : (A.PLANS[S.plan]?.label || "") + " plan", promptVersion: A.PROMPT_VERSION, results: []};
  let done = 0; S.busy.lab = `${tickers.length} tickers running side by side${S.plan === "saver" ? " (Saver: usually within an hour)" : ""}…`; renderLab();
  const runs = await U.pmap(tickers, async t => { const r = await runQuiet({ticker: t, mode, noTrack: true}); done++; S.busy.lab = `${done}/${tickers.length} finished…`; if (S.view === "lab") renderLab(); return r; }, 5);
  for (const run of runs) if (run && run.status === "done") ev.results.push(Object.assign(F.evalSummary(run), {runId: run.id}));
  const failed = runs.filter(r => !r || r.status !== "done"); if (failed.length) toast(`${failed.length} benchmark run(s) didn't finish: ${failed.map(r => r?.ticker).join(", ")}`, 7000);
  S.evals.unshift(ev); persist.evals(); S.busy.lab = false; S.view = "lab"; updateNav(); renderLab();
}

/* ---------------- Settings ---------------- */
function renderSettings() {
  const st = S.settings, p = S.profile;
  const tabs = [["profile", "Profile"], ["engine", "Cost & models"], ["alerts", "Alerts"], ["data", "Data"], ["seats", "Seats"], ["github", "GitHub"], ["storage", "Appearance & storage"]];
  const sel = (id, opts, val) => `<select class="field" id="${id}">${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(val) === String(v) ? "selected" : ""}>${esc(l)}</option>`; }).join("")}</select>`;
  const f = (id, label, ctl, wide) => `<div class="f ${wide ? "wide" : ""}"><label class="lbl" for="${id}">${label}</label>${ctl}</div>`;
  const inp = (id, val, ph, type) => `<input class="field" id="${id}" value="${esc(val ?? "")}" placeholder="${esc(ph || "")}" ${type ? `type="${type}"` : ""} spellcheck="false">`;
  let body = "";
  if (S.setTab === "profile") body = `<form class="card" id="profileForm"><div class="pgrid">
    ${f("pStyle", "Style", sel("pStyle", ["Balanced (quality at a fair price)", "Growth (revenue growth)", "Value (margin of safety)", "Dividend / income", "Momentum", "GARP", "Deep value / special situations"], p.style))}
    ${f("pHorizon", "Horizon", sel("pHorizon", ["Swing (weeks)", "Medium term (6–18 months)", "Buy & hold (3–5 years)", "Buy & hold (5+ years)"], p.horizon))}
    ${f("pRisk", "Risk", sel("pRisk", ["Conservative", "Moderate", "Aggressive", "Speculative"], p.risk))}
    ${f("pDD", "Max drawdown tolerance", sel("pDD", ["-15%", "-25%", "-35%", "-50%"], p.dd))}
    ${f("pSize", "Portfolio size ($)", inp("pSize", p.size, "250000"))}
    ${f("pRpt", "Risk per position at stop (%)", inp("pRpt", p.riskPerTrade, "1"))}
    ${f("pCcy", "Base currency", inp("pCcy", p.ccy, "USD"))}
    ${f("pAcc", "Account types", inp("pAcc", p.accounts, "Taxable, Roth IRA"))}
    ${f("pOther", "Other criteria", inp("pOther", p.other, "no banks, ESG, min FCF yield 5%"), true)}
    ${f("pExp", "Your expertise (Member's seat)", `<textarea class="field" id="pExp" rows="3" placeholder="e.g. 20 years in Permian produced-water operations; know disposal economics, RRC permitting and operator recycling decisions">${esc(p.expertise)}</textarea>`, true)}
    </div><div class="formfoot"><button class="btn primary" type="submit">✓ Save profile</button></div></form>`;
  if (S.setTab === "engine") { const spent = Cost.spentThisMonth();
    body = `<form class="card" id="costForm"><p class="small">Three choices decide what you spend. Everything else is automatic: Scouts do the web research once for the whole committee, judges (CIO, Devil's Advocate, Data Hunter) use Opus 5.5 and analysts Sonnet 5.5, later seats read summaries, documents are digested once, and research from the last few days is reused.</p>
    <div class="pgrid">
    ${f("sPlan", "Default plan", sel("sPlan", Object.entries(A.PLANS).map(([k, p]) => [k, `${p.label} — ${p.short}`]), st.plan || "saver"), true)}
    ${f("sMonthly", "Monthly budget ($)", inp("sMonthly", st.monthlyBudget, "blank = no limit"))}
    ${f("sCap", "Stop a run above ($)", inp("sCap", st.runCap, "blank = no cap"))}
    <div class="f"><span class="lbl">Spent this month</span><b class="num" style="font-size:20px">$${spent.toFixed(2)}</b></div>
    </div>
    <p class="small muted">${Object.values(A.PLANS).map(p => `<b>${esc(p.label)}</b>: ${esc(p.note)}`).join("<br>")}</p>
    <details class="adv"><summary class="lbl">Advanced (you normally don't need these)</summary><div class="pgrid">
    ${f("sJudge", "Judge model", inp("sJudge", st.judgeModel))}
    ${f("sAnalyst", "Analyst model (Saver, Balanced)", inp("sAnalyst", st.analystModel))}
    ${f("sHelper", "Helper model (digests)", inp("sHelper", st.helperModel))}
    ${f("sSearch", "Web search depth", sel("sSearch", [["0", "Off"], ["0.5", "Light"], ["1", "Standard"], ["1.5", "Deep"]], st.searchDepth))}
    ${f("sMax", "Max tokens per seat", inp("sMax", st.maxTokens, "", "number"))}
    ${f("sTool", "Search tool version", inp("sTool", st.toolType))}
    ${f("sMode", "Default mode", sel("sMode", Object.keys(A.MODES).map(k => [k, A.MODES[k].label]), st.defaultMode))}
    ${f("sDR", "Discount rate % (reverse DCF)", inp("sDR", st.discountRate))}
    ${f("sTG", "Terminal growth %", inp("sTG", st.terminalGrowth))}
    </div></details>
    <div class="formfoot"><button class="btn primary" type="submit">✓ Save</button></div></form>`; }
  if (S.setTab === "alerts") { const a = ALS.settings;
    body = `<form class="card" id="alSetForm"><p class="small">Settings for the <b>AI Stock Alert System</b>. Plan, web-search depth and sources are chosen on the Feed screen; the tickers on the Alert list.</p><div class="pgrid">
    ${f("alRule", "Send an urgent email for", sel("alRule", Object.entries(AL.URGENT_RULES), a.urgentRule), true)}
    ${f("alBlocked", "Sites left out when you choose “Reputable only”", `<textarea class="field" id="alBlocked" rows="3">${esc(a.blocked)}</textarea>`, true)}
    </div><p class="small muted">The morning digest arrives at 6:30 am Central on weekdays through the GitHub schedule (see Alert list). Weekly sentinels — podcasts, regulators, customers & rivals, shorts & ownership — run in Monday's digest; daily ones every weekday. A manual sweep always runs all of them.</p>
    <div class="formfoot"><button class="btn primary" type="submit">✓ Save</button><button class="btn" type="button" id="alBlockReset">Reset the list</button></div></form>
    ${alLearningHtml()}${alFeedSetupHtml()}`; }
  if (S.setTab === "data") body = `<form class="card" id="dataForm"><p class="small">The <b>data gateway</b> is a tiny Cloudflare Worker (in the repo's <code>worker/</code> folder) that fetches SEC EDGAR and price data for the browser, which those sites block directly. It can also hold your Anthropic key so the key never sits in the browser.</p>
    ${S.inClaude ? `<p class="warnline">Inside claude.ai the page can't reach a gateway. These settings apply to the standalone version.</p>` : ""}
    <div class="pgrid">${f("gUrl", "Gateway URL", inp("gUrl", st.gateway, "https://aic-gateway.yourname.workers.dev"), true)}
    ${f("gTok", "Gateway access token", inp("gTok", st.gatewayToken, "the ACCESS_TOKEN you set on the worker", "password"))}
    ${f("gAnth", "Send Anthropic calls through the gateway", sel("gAnth", [["false", "No — use my key in this browser"], ["true", "Yes — the gateway holds the key"]], st.gatewayAnthropic))}</div>
    <div class="formfoot"><button class="btn primary" type="submit">✓ Save</button><button class="btn" type="button" id="gTest">Test connection</button><span class="small" id="gTestOut"></span></div></form>`;
  if (S.setTab === "seats") body = `<form class="card" id="seatsForm"><p class="small muted">Choose the seats for <b>Custom</b> mode. (On Saver and Balanced the three Scouts are added automatically and do the web research for everyone.)</p>
    <div class="tblwrap"><table class="dt"><thead><tr><th>Seat</th><th>Stage</th><th>In Custom mode</th></tr></thead><tbody>${A.SEATS.map(s => `<tr><td style="color:${s.color}"><b>${esc(s.name)}</b> <span class="muted small">${esc(s.role)}</span></td><td class="num">${s.stage}</td>
      <td><input type="checkbox" data-cs="${s.id}" ${(st.customSeats || A.MODES.standard.seats).includes(s.id) ? "checked" : ""} ${s.id === "desk" ? "disabled checked" : ""} aria-label="Include ${esc(s.name)}"></td></tr>`).join("")}</tbody></table></div>
    <div class="formfoot"><button class="btn primary" type="submit">✓ Save seats</button></div></form>`;
  if (S.setTab === "github") body = `<form class="card" id="ghForm"><p class="small">Point the app at your GitHub copy of this project to import results produced by the scheduled GitHub Action. The repo must be public for the app to read it, or use Import JSON on the History page.</p>
    <div class="pgrid">${f("ghO", "Owner", inp("ghO", st.ghOwner, "your-github-name"))}${f("ghR", "Repository", inp("ghR", st.ghRepo, "ai-investment-committee"))}${f("ghB", "Branch", inp("ghB", st.ghBranch, "main"))}</div>
    <div class="formfoot"><button class="btn primary" type="submit">✓ Save</button></div></form>`;
  if (S.setTab === "storage") body = `<div class="card"><div class="pgrid">${f("themeSel", "Appearance", sel("themeSel", [["dark", "Dark"], ["light", "Light"], ["system", "Match my device"]], LS.get("theme", "dark")))}</div></div><div class="card"><p class="small">Runs are stored in this browser (IndexedDB); profile, holdings, journal and the track record in local storage. Nothing is sent anywhere except to Anthropic and your own gateway.</p>
    <div class="row-actions"><button class="btn small" type="button" id="exportAll">⇩ Export everything (JSON)</button><label class="btn small" for="importAll">Import backup</label><input type="file" id="importAll" accept="application/json" hidden><button class="btn small" type="button" id="clearCache">Clear data caches</button></div></div>`;
  $("#viewSettings").innerHTML = `<main class="wrap"><div class="tabbar" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-stab="${k}" aria-selected="${S.setTab === k}">${l}</button>`).join("")}</div>${body}<p class="disclaimer">App v${A.VERSION} · prompts ${A.PROMPT_VERSION}</p></main>`;
}
