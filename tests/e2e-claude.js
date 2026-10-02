/* Simulates the claude.ai artifact runtime (window.claude.use("sample")) to test the knowledge-mode engine.
   Run: node tests/e2e-claude.js <screenshot dir> */
"use strict";
const path = require("path");
const {chromium} = require(process.env.PW || "/opt/npm-tools/node_modules/playwright");
const {SEAT_DATA} = require("./mock");
const OUT = process.argv[2] || __dirname;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport: {width: 1300, height: 900}});
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.route("https://fonts.googleapis.com/**", r => r.abort()); await p.route("https://cdnjs.cloudflare.com/**", r => r.abort());
  await p.addInitScript(DATA => {
    let calls = 0, toolCalls = 0;
    const sample = async (prompt, opts = {}) => {
      calls++; await new Promise(r => setTimeout(r, 20));
      const m = prompt.match(/YOUR SEAT: ([A-Z' &]+?) —/); const key = /=== REBUTTAL/.test(prompt) ? "REBUTTAL" : m ? m[1].trim() : null;
      const text = key ? `## ${key}\n\nKnowledge-mode report (figures unverified).` : "Answer.";
      opts.onText && opts.onText({text, delta: text});
      if (opts.tools && key && DATA[key]) { toolCalls++; await opts.tools[0].execute(DATA[key], {signal: new AbortController().signal}); }
      return {text, truncated: false, modelTierApplied: opts.modelTier || "default"};
    };
    sample.limits = async () => ({maxPromptBytes: 262144, tools: {maxCount: 8}});
    sample.json = async () => ({summary: "extracted"});
    window.__stats = () => ({calls, toolCalls});
    window.claude = {use: async name => name === "sample" ? sample : name === "downloads" ? {save: async () => ({status: "saved"})} : null};
  }, SEAT_DATA);
  await p.goto("file://" + path.join(__dirname, "../index.html")); await p.waitForTimeout(400);
  await p.selectOption("#modeSel", "standard"); await p.fill("#ticker", "WTTR"); await p.click("#runBtn");
  await p.waitForFunction(() => /DONE|ERROR/.test(document.querySelector("#progStep").textContent), null, {timeout: 30000});
  await p.waitForTimeout(400); await p.screenshot({path: path.join(OUT, "claude-mode.png")});
  const st = await p.evaluate(() => ({stats: window.__stats(), engine: document.querySelector("#engineBar .status").textContent, step: document.querySelector("#progStep").textContent, verdict: document.querySelector("#headChip").textContent, desk: document.querySelector("#body-desk")?.textContent.slice(0, 120)}));
  console.log(JSON.stringify({st, errs}, null, 1)); await b.close();
})();
