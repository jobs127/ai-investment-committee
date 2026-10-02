/* Preload for testing the runner offline: node -r ./tests/fetch-mock.cjs runner/run.mjs ... */
const {fixtureFor, anthropicSSE, batchMock} = require("./mock");
const BM = batchMock(1, process.env.AIC_MOCK_STATE || null);
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (/api\.anthropic\.com\/v1\/messages\/batches/.test(url)) { const r = BM.handle(opts.method || "GET", new URL(url).pathname, opts.body); return r.json ? new Response(JSON.stringify(r.json), {status: r.status}) : new Response(r.text, {status: r.status}); }
  if (/api\.anthropic\.com/.test(url)) return new Response(anthropicSSE(JSON.parse(opts.body)), {status: 200, headers: {"content-type": "text/event-stream"}});
  if (/api\.github\.com/.test(url)) { if (!opts.body) return new Response("[]", {status: 200}); const b = JSON.parse(opts.body); console.log("[mock] GitHub " + (b.title ? "issue: " + b.title : "update: " + JSON.stringify(b))); return new Response(JSON.stringify({number: 7}), {status: 201}); }
  const fx = fixtureFor(url); if (!fx) return new Response("nf", {status: 404});
  return new Response(fx.json ? JSON.stringify(fx.json) : fx.text, {status: 200});
};
