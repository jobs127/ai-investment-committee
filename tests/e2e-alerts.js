/* Playwright test of the AI Stock Alert System screens (mocked Anthropic + gateway).
   Run: node tests/e2e-alerts.js <screenshot dir> */
"use strict";
const path = require("path"), fs = require("fs");
const OUT = process.argv[2] || path.join(__dirname, "shots-alerts");
const {chromium} = require(process.env.PW || "/opt/npm-tools/node_modules/playwright");
const {fixtureFor, anthropicSSE, anthropicMessage, batchMock} = require("./mock");
const BM = batchMock(1);
fs.mkdirSync(OUT, {recursive: true});
const strip = h => String(h).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1400, height: 950}, acceptDownloads: true});
  await ctx.addInitScript(theme => { if (theme) localStorage.setItem("aic6.theme", JSON.stringify(theme));
    if (!localStorage.getItem("aic6.settings")) localStorage.setItem("aic6.settings", JSON.stringify({gateway: "https://gw.test", gatewayToken: "t0k"})); }, process.env.THEME || "");
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", e => errs.push("pageerror: " + e.message)); p.on("console", m => { if (m.type() === "error" && !/ERR_FAILED|net::|404/.test(m.text())) errs.push(m.text()); });
  const H = {"access-control-allow-origin": "*"}; const bodies = [];
  await p.route("https://fonts.googleapis.com/**", r => r.abort());
  await p.route("https://api.anthropic.com/**", async r => { const req = r.request(); const u = new URL(req.url());
    if (/batches/.test(u.pathname)) { const x = BM.handle(req.method(), u.pathname, req.postData()); return r.fulfill({status: x.status, headers: H, body: x.json ? JSON.stringify(x.json) : x.text}); }
    const b = JSON.parse(req.postData()); bodies.push(b); return b.stream ? r.fulfill({status: 200, headers: {...H, "content-type": "text/event-stream"}, body: anthropicSSE(b)}) : r.fulfill({status: 200, headers: H, body: JSON.stringify(anthropicMessage(b))}); });
  await p.route("https://gw.test/**", async r => { const u = new URL(r.request().url()); const fx = fixtureFor(u.searchParams.get("url"));
    if (!fx) return r.fulfill({status: 404, body: "nf", headers: H}); await r.fulfill({status: 200, headers: H, body: fx.json ? JSON.stringify(fx.json) : (u.searchParams.get("text") ? strip(fx.text) : fx.text)}); });
  const shot = (n, full) => p.screenshot({path: path.join(OUT, n + ".png"), fullPage: !!full});
  await p.goto("file://" + path.join(__dirname, "../index.html")); await p.waitForTimeout(500);
  await p.evaluate(() => { const s = AIC.util.sleep; AIC.util.sleep = ms => s(Math.min(ms, 300)); });
  await p.fill("#keyIn", "sk-ant-test"); await p.click("#keyForm button[type=submit]");
  await p.click('[data-app="alerts"]'); await p.waitForTimeout(200); await shot("a01-empty");
  const nav1 = await p.evaluate(() => ({title: document.querySelector("#appTitle").textContent, cHidden: document.querySelector('.nav [data-view="analysis"]').hidden, feedShown: !document.querySelector('.nav [data-view="alfeed"]').hidden}));
  // alert list
  await p.click('.nav [data-view="allist"]'); await p.type("#alNew", "wttr, xom"); const typedUpper = await p.inputValue("#alNew"); await p.click("#alAdd");
  await p.fill('[data-ali="0"] [data-alf="terms"]', "Select Water, John Schmitz"); await p.fill('[data-ali="0"] [data-alf="below"]', "20"); await p.click("#alSaveList");
  await shot("a02-list");
  const dl = await Promise.all([p.waitForEvent("download"), p.click("#alExport")]); const jf = path.join(OUT, "alerts.json"); await dl[0].saveAs(jf);
  // sweep on Balanced, all sources
  await p.click('.nav [data-view="alfeed"]'); await p.click('[data-alplan="balanced"]');
  const est = await p.textContent(".hint.est");
  await p.click("#alGo"); await p.waitForTimeout(300); await shot("a03-sweeping");
  await p.waitForFunction(() => !ALS.running && ALS.sweep && ALS.sweep.status === "done", null, {timeout: 90000}); await p.waitForTimeout(300);
  await shot("a04-feed"); await shot("a05-feed-full", true);
  const feed = await p.evaluate(() => ({items: document.querySelectorAll(".alitem").length, urgent: document.querySelectorAll(".alitem .badge.urg").length, unverified: document.querySelectorAll(".alitem .badge.unv").length, thesis: document.querySelectorAll(".alitem .thit").length, digestRows: document.querySelectorAll(".dgrow").length, badge: document.querySelector('.nav [data-view="alfeed"]').textContent}));
  await p.click('[data-alseat="social"]'); await p.waitForTimeout(300); await p.evaluate(() => document.querySelector("#alSeatPanel").scrollIntoView()); await shot("a05b-social-panel");
  const panel = await p.evaluate(() => ({items: document.querySelectorAll("#alSeatPanel .sp-items li").length, kept: document.querySelectorAll("#alSeatPanel li.kept").length, merged: document.querySelectorAll("#alSeatPanel li.merged").length, text: document.querySelector("#alSeatPanel").textContent.slice(0, 160)}));
  await p.click('[data-alseat="keys"]'); await p.waitForTimeout(200); await p.evaluate(() => document.querySelector("#alSeatPanel").scrollIntoView()); await shot("a05k-keywords");
  const kwPanel = await p.evaluate(() => ({chips: document.querySelectorAll("#alSeatPanel .kw").length, board: [...document.querySelectorAll(".stage-l")].map(x => x.textContent.trim())}));
  await p.click('[data-alseat="pods"]'); const pods = await p.evaluate(() => document.querySelector("#alSeatPanel").textContent.slice(0, 200));
  await p.click('[data-alseat="desk"]'); await shot("a05c-desk-panel"); await p.click('[data-alseat="desk"]');
  // filters and actions
  await p.click('[data-alimp="urgent"]'); const urgentOnly = await p.$$eval(".alitem", x => x.length);
  await p.click('[data-alimp="all"]'); await p.click(".alitem [data-alact=dismiss]"); const afterDismiss = await p.$$eval(".alitem", x => x.length);
  await p.click("#alSeenAll"); const unseen = await p.$$eval(".alitem.unseen", x => x.length);
  // Saver + reputable only, one ticker
  await p.click('[data-alplan="saver"]'); await p.click('[data-alsrc="rep"]'); await p.click('[data-aldepth="1.5"]'); await p.selectOption("#alSel", "XOM"); bodies.length = 0;
  await p.click("#alGo"); await p.waitForFunction(() => document.querySelector('.seat[data-st="waiting"]'), null, {timeout: 30000}); await shot("a06-saver-waiting");
  await p.waitForFunction(() => !ALS.running, null, {timeout: 90000});
  const saver = await p.evaluate(() => ({plan: ALS.sweep.plan, tickers: ALS.sweep.tickers, depth: ALS.sweep.searchDepth, blocked: ALS.sweep.blocked.length}));
  // sweeps view
  await p.click('.nav [data-view="allist"]'); await shot("a06b-list-keywords"); const kwCol = await p.evaluate(() => document.querySelector(".allist tbody tr td:nth-child(4)").textContent);
  await p.click('.nav [data-view="alhist"]'); await p.click("[data-alopen]"); await p.waitForTimeout(300); await shot("a07-sweeps", true);
  // settings alerts tab
  await p.click('.nav [data-view="settings"]'); await p.click('[data-stab="alerts"]'); await shot("a08-settings");
  // committee button jumps apps
  await p.click('.nav [data-view="alfeed"]'); await p.click(".alitem [data-alact=committee]"); const jumped = await p.evaluate(() => ({app: S.app, view: S.view, ticker: document.querySelector("#ticker").value}));
  await p.click('[data-app="alerts"]');
  // reload persistence
  await p.waitForTimeout(1500); await p.reload(); await p.waitForTimeout(1200); const persisted = await p.evaluate(() => ({app: S.app, view: S.view, items: document.querySelectorAll(".alitem").length, list: ALS.list.length}));
  await p.click('[data-alseat="news"]'); await p.waitForTimeout(200); const afterReload = await p.evaluate(() => document.querySelectorAll("#alSeatPanel .sp-items li").length);
  await p.setViewportSize({width: 400, height: 860}); await p.waitForTimeout(200); await shot("a09-mobile"); await p.evaluate(() => document.querySelector("#alFeed").scrollIntoView()); await shot("a10-mobile-feed");
  const hscroll = await p.evaluate(() => document.documentElement.scrollWidth);
  console.log(JSON.stringify({typedUpper, kwPanel, kwCol, panel, pods, afterReload, nav1, est, feed, urgentOnly, afterDismiss, unseen, saver, jumped, persisted, hscroll, alertsJson: JSON.parse(fs.readFileSync(jf, "utf8")), errors: errs}, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
