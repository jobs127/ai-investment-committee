/* Playwright end-to-end test with mocked Anthropic API, mocked data gateway and local copies of the CDN libraries.
   Run: node tests/e2e.js <scratch dir with node_modules (pdfjs-dist, xlsx, mammoth, pdfkit)> <screenshot dir> */
"use strict";
const path = require("path"), fs = require("fs");
const SCR = process.argv[2], OUT = process.argv[3] || path.join(__dirname, "shots");
const {chromium} = require(process.env.PW || "/opt/npm-tools/node_modules/playwright");
const {fixtureFor, anthropicSSE} = require("./mock");
fs.mkdirSync(OUT, {recursive: true});
const strip = h => String(h).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const libs = {"pdf.min.js": "pdfjs-dist/build/pdf.min.js", "pdf.worker.min.js": "pdfjs-dist/build/pdf.worker.min.js", "xlsx.full.min.js": "xlsx/dist/xlsx.full.min.js", "mammoth.browser.min.js": "mammoth/mammoth.browser.min.js"};

async function makeDocs() {
  const PDFDocument = require(require.resolve("pdfkit", {paths: [SCR]}));
  const pdfPath = path.join(OUT, "Q2 earnings call transcript.pdf");
  await new Promise(res => { const d = new PDFDocument(); const s = fs.createWriteStream(pdfPath); d.pipe(s); d.text("Operator: Welcome to the second quarter call. " + "We believe recycled volumes could grow, although headwinds may persist. ".repeat(30) + " Question-and-answer session. " + "Strong record growth in water infrastructure. ".repeat(20)); d.end(); s.on("finish", res); });
  const XLSX = require(require.resolve("xlsx", {paths: [SCR]}));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Year", "Water volume (MMbbl)", "Revenue"], [2025, 820, 1520], [2026, 905, 1610]]), "Model");
  const xPath = path.join(OUT, "my water model.xlsx"); XLSX.writeFile(wb, xPath);
  return [pdfPath, xPath];
}

(async () => {
  const docs = await makeDocs();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1400, height: 950}, acceptDownloads: true});
  await ctx.addInitScript(() => {
    if (!localStorage.getItem("aic6.settings")) localStorage.setItem("aic6.settings", JSON.stringify({gateway: "https://gw.test", gatewayToken: "t0k", priceIn: "5", priceOut: "25", priceSearch: "10"}));
    if (!localStorage.getItem("aic6.profile")) localStorage.setItem("aic6.profile", JSON.stringify({size: "250000", riskPerTrade: "1", expertise: "Permian produced-water operations"}));
  });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push("pageerror: " + e.message)); p.on("console", m => { if (m.type() === "error" && !/ERR_FAILED|net::/.test(m.text())) errs.push(m.text()); });
  let api = 0, gw = 0;
  await p.route("https://fonts.googleapis.com/**", r => r.abort());
  await p.route("https://cdnjs.cloudflare.com/**", r => { const f = r.request().url().split("/").pop(); const loc = libs[f]; return loc ? r.fulfill({path: path.join(SCR, "node_modules", loc), contentType: "application/javascript"}) : r.abort(); });
  await p.route("https://api.anthropic.com/**", async r => { api++; const body = JSON.parse(r.request().postData()); await r.fulfill({status: 200, headers: {"content-type": "text/event-stream", "access-control-allow-origin": "*"}, body: anthropicSSE(body)}); });
  await p.route("https://gw.test/**", async r => {
    gw++; const u = new URL(r.request().url()); const target = u.searchParams.get("url"); const fx = fixtureFor(target);
    if (r.request().headers()["x-aic-token"] !== "t0k") return r.fulfill({status: 401, body: "bad token"});
    if (!fx) return r.fulfill({status: 404, body: "nf", headers: {"access-control-allow-origin": "*"}});
    const body = fx.json ? JSON.stringify(fx.json) : (u.searchParams.get("text") ? strip(fx.text) : fx.text);
    await r.fulfill({status: 200, body, headers: {"access-control-allow-origin": "*", "content-type": fx.json ? "application/json" : "text/plain"}});
  });
  const shot = async (n, full) => p.screenshot({path: path.join(OUT, n + ".png"), fullPage: !!full});
  await p.goto("file://" + path.join(__dirname, "../index.html"));
  await p.waitForTimeout(500);
  await shot("01-start");
  await p.fill("#keyIn", "sk-ant-test"); await p.click("#keyForm button[type=submit]");
  await p.click("#memberBox summary");
  await p.fill("#memberNote", "Two large Delaware operators move to recycled water next year; Reeves County disposal permits are being cut after the earthquakes.");
  await p.setInputFiles("#docFiles", docs);
  await p.waitForFunction(() => document.querySelectorAll(".fchip").length === 2, null, {timeout: 15000});
  await p.selectOption("#modeSel", "full");
  await p.fill("#ticker", "wttr"); await p.click("#runBtn");
  await p.waitForTimeout(400); await shot("02-running");
  await p.waitForFunction(() => /DONE/.test(document.querySelector("#progStep").textContent), null, {timeout: 60000});
  await p.waitForTimeout(800);
  await p.evaluate(() => scrollTo(0, 0)); await shot("03-done-top");
  await p.evaluate(() => document.querySelector("#results").scrollIntoView()); await p.waitForTimeout(200); await shot("04-results");
  await shot("05-full", true);
  for (const t of ["desk", "chart", "evidence", "debate"]) { await p.click(`[data-tab="${t}"]`); await p.waitForTimeout(250); await p.evaluate(() => document.querySelector("#tabSec").scrollIntoView()); await shot("06-tab-" + t); }
  await p.click('[data-tab="chart"]'); const box = await p.$(".pchart .hit"); const bb = await box.boundingBox(); await p.mouse.move(bb.x + bb.width * 0.7, bb.y + 100); await p.waitForTimeout(150); await shot("07-chart-hover");
  await p.selectOption("#askAgent", "hunter"); await p.fill("#askQ", "Why is intrinsic value above the price?"); await p.click("#askBtn"); await p.waitForTimeout(800); await shot("08-qa");
  await p.click('[data-tab="minutes"]');
  await p.selectOption("#jDecision", "Bought"); await p.fill("#jPrice", "9.9"); await p.fill("#jNotes", "Recycling thesis"); await p.click("#jform button[type=submit]");
  await p.click('[data-act="watch"]'); await p.click('[data-act="thesis"]');
  const dl = await Promise.all([p.waitForEvent("download"), p.click('[data-act="csv"]')]); const csvPath = path.join(OUT, "export.csv"); await dl[0].saveAs(csvPath);
  const ics = await Promise.all([p.waitForEvent("download"), p.click('[data-act="ics"]')]); await ics[0].saveAs(path.join(OUT, "cal.ics"));
  // Discover
  await p.click('.nav [data-view="discover"]'); for (const k of ["spin", "act", "ins"]) { await p.click(`[data-disc="${k}"]`); await p.waitForTimeout(400); }
  await p.click("#ideaForm button[type=submit]"); await p.waitForTimeout(800); await shot("09-discover", true);
  // Compare (XOM is not in the SEC fixture map: exercises the partial Data Desk path)
  await p.click('.nav [data-view="compare"]'); await p.fill("#cmpTickers", "WTTR, XOM"); await p.click("#cmpForm button[type=submit]");
  await p.waitForFunction(() => document.querySelector(".dt.cmp"), null, {timeout: 60000}); await p.waitForTimeout(300); await shot("10-compare", true);
  // Portfolio
  await p.click('.nav [data-view="portfolio"]'); await p.click("#hAdd"); await p.fill('[data-hf="ticker"]', "XOM"); await p.fill('[data-hf="shares"]', "100"); await p.fill('[data-hf="cost"]', "105"); await p.click("#hSave"); await p.click("#hPrices"); await p.waitForTimeout(500); await shot("11-holdings");
  await p.click('[data-ptab="watchlist"]'); await p.click("#wCheck"); await p.waitForTimeout(500); await shot("12-watchlist");
  const wl = await Promise.all([p.waitForEvent("download"), p.click("#wExport")]); await wl[0].saveAs(path.join(OUT, "watchlist.json"));
  await p.click('[data-ptab="theses"]'); await p.click('[data-tcheck="0"]'); await p.waitForTimeout(800); await shot("13-theses", true);
  // Record
  await p.click('.nav [data-view="record"]'); await p.click("#tUpdate"); await p.waitForTimeout(800); await shot("14-record", true);
  await p.click('[data-rtab="journal"]'); await shot("15-journal");
  // Lab
  await p.click('.nav [data-view="lab"]'); await p.fill("#labTickers", "WTTR"); await p.selectOption("#labMode", "quick"); await p.fill("#labLabel", "baseline"); await p.click("#labForm button[type=submit]");
  await p.waitForFunction(() => !document.querySelector("#labForm button").disabled && document.querySelectorAll("[data-edel]").length === 1, null, {timeout: 60000});
  await p.fill("#labLabel", "candidate"); await p.click("#labForm button[type=submit]");
  await p.waitForFunction(() => document.querySelectorAll("[data-edel]").length === 2 && !document.querySelector("#labForm button").disabled, null, {timeout: 60000});
  await p.click("#labCmp"); await p.waitForTimeout(200); await shot("16-lab", true);
  // Settings + history
  await p.click('.nav [data-view="settings"]'); for (const t of ["profile", "engine", "data", "seats"]) { await p.click(`[data-stab="${t}"]`); await p.waitForTimeout(100); }
  await p.click('[data-stab="data"]'); await p.click("#gTest"); await p.waitForTimeout(400); await shot("17-settings-data");
  await p.click('.nav [data-view="history"]'); await shot("18-history");
  // reload persistence
  await p.reload(); await p.waitForTimeout(800); const persisted = await p.evaluate(() => ({hist: document.querySelector("#navHistory").textContent, verdict: document.querySelector("#headChip").textContent}));
  // mobile
  await p.setViewportSize({width: 400, height: 860}); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(200); await shot("19-mobile");
  await p.evaluate(() => document.querySelector("#results").scrollIntoView()); await shot("20-mobile-results");
  const hscroll = await p.evaluate(() => document.documentElement.scrollWidth);
  const csv = fs.readFileSync(csvPath, "utf8");
  console.log(JSON.stringify({api, gw, persisted, hscroll, csvRows: csv.split("\n").length, ics: fs.readFileSync(path.join(OUT, "cal.ics"), "utf8").split("BEGIN:VEVENT").length - 1, watchlist: JSON.parse(fs.readFileSync(path.join(OUT, "watchlist.json"))).tickers, errors: errs}, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
