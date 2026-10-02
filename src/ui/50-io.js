/* Files in and out: document upload parsing, exports (CSV, HTML, ICS, alerts, watchlist.json, journal, backup), GitHub sync. */

function loadScript(src) {
  return new Promise((res, rej) => { if ([...document.scripts].some(s => s.src === src)) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load " + src.split("/").pop())); document.head.appendChild(s); });
}
const LIBS = {
  pdf: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  mammoth: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"
};
async function readDoc(file) {
  const name = file.name, ext = (name.split(".").pop() || "").toLowerCase();
  let text = "";
  if (ext === "pdf") {
    await loadScript(LIBS.pdf); const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
    const doc = await lib.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise;
    const pages = []; for (let i = 1; i <= Math.min(doc.numPages, 300); i++) { const p = await doc.getPage(i); const tc = await p.getTextContent(); pages.push(tc.items.map(x => x.str).join(" ")); }
    text = pages.join("\n\n");
  } else if (["xlsx", "xlsm", "xls"].includes(ext)) {
    await loadScript(LIBS.xlsx); const wb = window.XLSX.read(new Uint8Array(await file.arrayBuffer()), {type: "array"});
    text = wb.SheetNames.slice(0, 12).map(n => `## Sheet: ${n}\n` + window.XLSX.utils.sheet_to_csv(wb.Sheets[n]).split("\n").filter(l => l.replace(/,/g, "").trim()).slice(0, 400).join("\n")).join("\n\n");
  } else if (ext === "docx") {
    await loadScript(LIBS.mammoth); text = (await window.mammoth.extractRawText({arrayBuffer: await file.arrayBuffer()})).value;
  } else if (["htm", "html"].includes(ext)) text = U.stripHtml(await file.text());
  else text = await file.text();
  text = text.replace(/\u0000/g, "").trim();
  const kind = /transcript|earnings[-_ ]?call|conference[-_ ]?call|\bcall\b/i.test(name) ? "transcript" : ["xlsx", "xlsm", "xls", "csv"].includes(ext) ? "model/data" : ext === "pdf" ? "pdf" : "document";
  return {name, kind, text, size: file.size};
}
async function addDocs(files) {
  for (const f of files) {
    if (f.size > 40 * 1024 * 1024) { toast(`${f.name} is over 40 MB.`); continue; }
    try { toast(`Reading ${f.name}…`, 1500); const d = await readDoc(f); if (!d.text) { toast(`No text found in ${f.name}.`); continue; } S.member.docs.push(d); }
    catch (e) { toast(`Couldn't read ${f.name}: ${e.message}`, 5000); }
  }
  renderConsole();
}

async function saveFile(filename, data, mime) {
  if (S.inClaude) {
    try { if (!S.downloads) S.downloads = await window.claude.use("downloads"); } catch {}
    if (!S.downloads) { toast("Downloads aren't available in this view."); return; }
    try { await S.downloads.save({filename, data: new Blob([data], {type: mime})}); } catch (e) { if (!["cancelled", "declined"].includes(e?.code)) toast("Download didn't complete."); }
    return;
  }
  const url = URL.createObjectURL(new Blob([data], {type: mime})); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
const csvCell = v => { v = String(v ?? ""); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const toCSV = rows => "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");
const stamp = r => `${r.ticker}_${new Date(r.createdAt).toISOString().slice(0, 10)}`;

function exportCSV(r) {
  const c = r.cio || {scores: {}}, p = r.pm || {}, fs = r.factsheet || {}, ev = r.evm || {};
  const rows = [["Section", "Field", "Value"], ["Run", "Ticker", r.ticker], ["Run", "Date", new Date(r.createdAt).toISOString()], ["Run", "Mode", r.mode], ["Run", "Model", r.model], ["Run", "Prompt version", r.promptVersion], ["Run", "Profile", A.prompts.profileText(r.profile)],
    ["Scorecard", "Verdict", c.verdict], ["Scorecard", "Conviction", c.conviction], ["Scorecard", "Overall", c.overall], ["Scorecard", "Formula score", c.formula], ["Scorecard", "Quality", c.quality_score], ["Scorecard", "Price", c.price_score],
    ...Object.entries(c.scores || {}).map(([k, v]) => ["Scorecard", k, v]),
    ["Scorecard", "Rationale", c.rationale], ["Scorecard", "Thesis", c.thesis], ["Scorecard", "Variant view", c.variant_view], ["Scorecard", "Catalyst", c.catalyst ? c.catalyst.event + " " + (c.catalyst.date || "") : ""],
    ...(c.falsification || []).map(x => ["Scorecard", "Falsification", x]),
    ...(ev.scenarios || []).map(s => ["Scenario", s.name, `${s.price} @ p=${s.p?.toFixed(2)} · ${s.horizon_months || ""} mo · ${s.driver || ""}`]),
    ["Expected value", "EV", ev.ev], ["Expected value", "Expected return", ev.expReturn], ["Expected value", "Margin of safety", ev.marginOfSafety],
    ["Market", "Implied growth (reverse DCF)", fs.reverseDcf?.impliedGrowth], ["Market", "Price", PL.priceOf(r)],
    ["Plan", "Action", p.action], ["Plan", "Position % target", p.position_pct_target], ["Plan", "Position % max", p.position_pct_max],
    ...(p.tranches || []).map((t, i) => ["Plan", "Tranche " + (i + 1), `${t.low}${t.high ? "–" + t.high : ""} | ${t.pct}% | ${t.trigger || ""}`]),
    ["Plan", "Stop", p.stop ? `${p.stop.price} (${p.stop.type || ""})` : ""], ...(p.targets || []).map((t, i) => ["Plan", "Target " + (i + 1), `${t.price} ${t.timeframe || ""}`]), ["Plan", "Risk/reward", p.risk_reward], ["Plan", "Review", p.review_trigger],
    ...(fs.yearMetrics || []).map(y => ["Financials", "FY" + y.fy, `rev ${y.revenue} · growth ${U.round(y.revGrowth, 4)} · op m ${U.round(y.opMargin, 4)} · FCF ${y.fcf} · ROIC ${U.round(y.roic, 4)}`]),
    ...(fs.leading || []).map(s => ["Leading signal", s.signal, `${s.value} [${s.direction}]`]),
    ...(r.ledger?.contradictions || []).map(x => ["Contradiction", x.metric, x.items.map(i => i.seat + "=" + i.value).join("; ")]),
    ...r.seats.filter(id => r.reports[id]?.text).map(id => ["Report", A.seat(id).name, r.reports[id].text]),
    ...(r.ledger?.claims || []).map(cl => ["Claim", A.seat(cl.seat)?.name || cl.seat, `${cl.text} | ${cl.metric || ""}=${cl.value ?? ""} | ${cl.source_type} | ${cl.source_url || ""}`]),
    ...r.seats.flatMap(id => (r.reports[id]?.sources || []).map(s => ["Source", A.seat(id).name, s.title + " — " + s.url]))];
  saveFile(`${stamp(r)}_committee.csv`, toCSV(rows), "text/csv");
}
function exportHTML(r) {
  const c = r.cio || {};
  const body = `<h1>${esc(r.ticker)} — ${esc(c.verdict || "")} ${c.overall != null ? "· " + c.overall + "/10" : ""}</h1><p class="m">${esc(fmtDate(r.createdAt))} · ${esc(A.MODES[r.mode]?.label || r.mode)} · ${esc(r.model)} · ${esc(A.prompts.profileText(r.profile))}</p>`
    + (r.evm ? `<p><b>Expected value</b> ${n2(r.evm.ev)} (${spct(r.evm.expReturn)}) · margin of safety ${spct(r.evm.marginOfSafety)} · ${r.evm.scenarios.map(s => `${s.name} ${n2(s.price)} @ ${(s.p * 100).toFixed(0)}%`).join(" · ")}</p>` : "")
    + (c.variant_view ? `<p><b>Variant view.</b> ${esc(c.variant_view)}</p>` : "")
    + (r.factsheet?.markdown ? `<section><h2>Data Desk</h2>${md(r.factsheet.markdown)}</section>` : "")
    + r.seats.filter(id => id !== "desk").map(id => { const x = r.reports[id], a = A.seat(id); return x?.text ? `<section><h2>${esc(a.name)} <small>${esc(a.role)} · stage ${a.stage}</small></h2>${md(x.text)}${x.sources?.length ? "<p class='m'>Sources: " + x.sources.map(s => `<a href="${esc(s.url)}">${esc(s.title || s.url)}</a>`).join(" · ") + "</p>" : ""}</section>` : ""; }).join("")
    + (r.qa?.length ? "<h2>Questions to the committee</h2>" + r.qa.map(q => `<p><b>${esc(A.seat(q.agent)?.name)}:</b> ${esc(q.q)}</p>${md(q.a)}`).join("") : "")
    + `<p class="m">Research tool output, not investment advice.</p>`;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.ticker)} — AI Investment Committee</title><style>body{font:15px/1.6 Georgia,serif;max-width:860px;margin:40px auto;padding:0 20px;color:#111}h1{font-family:Helvetica,Arial,sans-serif}h2{font:600 15px Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;border-top:1px solid #ccc;padding-top:18px;margin-top:28px}h2 small{color:#777;font-weight:400}h3,h4{font-family:Helvetica,Arial,sans-serif}table{border-collapse:collapse;font:13px Helvetica,Arial,sans-serif}td,th{border:1px solid #ccc;padding:4px 8px}.m{color:#666;font-size:12px}.kvl span{color:#666}pre{white-space:pre-wrap}blockquote{color:#444;border-left:3px solid #ccc;margin:0;padding-left:12px}</style></head><body>${body}</body></html>`;
  saveFile(`${stamp(r)}_committee.html`, doc, "text/html");
}
function icsDate(s) { const m = String(s || "").match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/); if (m) return m[1] + m[2] + (m[3] || "15"); const q = String(s || "").match(/^(\d{4})-?Q([1-4])/i); if (q) return q[1] + String(+q[2] * 3 - 1).padStart(2, "0") + "15"; return null; }
function exportICS(r) {
  const ev = [];
  (r.reports.catalyst?.data?.catalysts || []).forEach(c => ev.push([icsDate(c.date), `${r.ticker}: ${c.event}`, `Impact: ${c.impact || ""}${c.probability_pct ? " · p=" + c.probability_pct + "%" : ""}`]));
  if (r.cio?.catalyst?.date) ev.push([icsDate(r.cio.catalyst.date), `${r.ticker}: ${r.cio.catalyst.event} (CIO catalyst)`, r.cio.variant_view || ""]);
  (r.cio?.monitoring || []).forEach(m => m.date && ev.push([icsDate(m.date), `${r.ticker} monitor: ${m.item}`, ""]));
  const evs = ev.filter(e => e[0]);
  if (!evs.length) { toast("No dated catalysts or monitoring items in this run."); return; }
  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AI Investment Committee//EN", ...evs.flatMap((e, i) => ["BEGIN:VEVENT", `UID:${r.id}-${i}@aic`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${e[0]}`, `SUMMARY:${e[1].replace(/[,;]/g, " ")}`, `DESCRIPTION:${e[2].replace(/[,;\n]/g, " ").slice(0, 400)}`, "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");
  saveFile(`${stamp(r)}_catalysts.ics`, ics, "text/calendar");
}
function exportAlerts(r) {
  const p = r.pm || {}; const rows = [["Ticker", "Type", "Value", "Note"]];
  if (U.isNum(p.stop?.price)) rows.push([r.ticker, "price_below", p.stop.price, "Stop: " + (p.stop.type || "")]);
  (p.targets || []).forEach((t, i) => U.isNum(t.price) && rows.push([r.ticker, "price_above", t.price, "Target " + (i + 1)]));
  (p.tranches || []).forEach((t, i) => U.isNum(t.high ?? t.low) && rows.push([r.ticker, "price_below", t.high ?? t.low, "Tranche " + (i + 1) + ": " + (t.trigger || "")]));
  (p.alerts || []).forEach(a => rows.push([r.ticker, a.type, a.value, a.note || ""]));
  saveFile(`${stamp(r)}_alerts.csv`, toCSV(rows), "text/csv");
}
function exportWatchlist() {
  const data = {app: "ai-investment-committee", version: A.VERSION, generated: new Date().toISOString(), profile: S.profile,
    settings: {model: S.settings.model, searchDepth: S.settings.searchDepth, discountRate: S.settings.discountRate, terminalGrowth: S.settings.terminalGrowth},
    tickers: S.watchlist.map(w => ({ticker: w.ticker, cadence: w.cadence, mode: w.mode, alerts: w.alerts || []}))};
  saveFile("watchlist.json", JSON.stringify(data, null, 2), "application/json");
}
function exportJournal() {
  saveFile(`committee_journal_${U.today()}.csv`, toCSV([["Date", "Ticker", "Committee verdict", "Score", "Decision", "Price", "Size", "Notes"]].concat(S.journal.map(j => [j.date, j.ticker, j.verdict, j.overall, j.decision, j.price, j.size, j.notes]))), "text/csv");
}
async function exportAll() {
  const runs = await DB.allRuns();
  const data = {app: "ai-investment-committee", version: A.VERSION, exported: new Date().toISOString(), runs, track: S.track, journal: S.journal, holdings: S.holdings, watchlist: S.watchlist, theses: S.theses, evals: S.evals, profile: S.profile};
  saveFile(`committee_backup_${U.today()}.json`, JSON.stringify(data), "application/json");
}
async function importRuns(list) {
  let n = 0;
  for (const r of list) { if (!r || !r.id || !r.ticker || !r.reports) continue; if (S.index.some(x => x.id === r.id)) continue; r.seats = r.seats || Object.keys(r.reports); await saveRun(r); n++;
    if (r.status === "done" && !S.track.some(t => t.runId === r.id)) S.track.push(F.trackEntry(r)); }
  S.track.sort((a, b) => a.date < b.date ? 1 : -1); persist.track();
  return n;
}
async function importAll(file) {
  try {
    const j = JSON.parse(await file.text());
    const runs = Array.isArray(j) ? j : j.runs || j.history || [];
    const n = await importRuns(runs);
    for (const k of ["journal", "holdings", "watchlist", "theses", "evals"]) if (Array.isArray(j[k]) && !S[k].length) { S[k] = j[k]; persist[k](); }
    if (Array.isArray(j.track)) { const ids = new Set(S.track.map(t => t.runId)); j.track.forEach(t => !ids.has(t.runId) && S.track.push(t)); persist.track(); }
    toast(`Imported ${n} runs.`); renderAll();
  } catch { toast("That file isn't a committee export."); }
}
async function syncGitHub() {
  const {ghOwner: o, ghRepo: r, ghBranch: b} = S.settings; if (!o || !r) return;
  const base = `https://raw.githubusercontent.com/${encodeURIComponent(o)}/${encodeURIComponent(r)}/${encodeURIComponent(b || "main")}/`;
  try {
    const idx = await (await fetch(base + "results/index.json", {cache: "no-store"})).json();
    const todo = (idx.runs || []).filter(x => !S.index.some(h => h.id === x.id)).slice(0, 40);
    const runs = [];
    for (const x of todo) { try { runs.push(await (await fetch(base + x.path, {cache: "no-store"})).json()); } catch {} }
    const n = await importRuns(runs);
    (idx.alerts || []).forEach(a => (S.alertHits = S.alertHits || []).push({ticker: a.ticker, text: a.text + " (GitHub " + (a.date || "") + ")"}));
    toast(`Synced ${n} new runs from GitHub.`); renderAll();
  } catch (e) { toast("Couldn't read results/index.json from GitHub: " + e.message, 6000); }
}
