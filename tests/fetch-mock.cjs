/* Preload for testing the runner offline: node -r ./tests/fetch-mock.cjs runner/run.mjs ... */
const {fixtureFor, anthropicSSE} = require("./mock");
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (/api\.anthropic\.com/.test(url)) return new Response(anthropicSSE(JSON.parse(opts.body)), {status: 200, headers: {"content-type": "text/event-stream"}});
  if (/api\.github\.com/.test(url)) { console.log("[mock] GitHub issue:", JSON.parse(opts.body).title); return new Response("{}", {status: 201}); }
  const fx = fixtureFor(url); if (!fx) return new Response("nf", {status: 404});
  return new Response(fx.json ? JSON.stringify(fx.json) : fx.text, {status: 200});
};
