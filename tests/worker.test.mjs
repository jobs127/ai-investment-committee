/* Tests the Cloudflare Worker gateway offline with a mocked upstream fetch. Run: node tests/worker.test.mjs */
import worker from "../worker/gateway.js";
import assert from "node:assert";
const seen = [];
globalThis.fetch = async (u, o = {}) => { seen.push({u: String(u), o});
  if (String(u).includes("anthropic")) return new Response("event: message_stop\ndata: {}\n\n", {status: 200, headers: {"content-type": "text/event-stream"}});
  if (String(u).includes("k.htm")) return new Response("<html><body><h2>Item 1A. Risk Factors</h2><p>Risk &amp; more.</p><script>x()</script></body></html>", {status: 200, headers: {"content-type": "text/html"}});
  return new Response(JSON.stringify({ok: 1}), {status: 200, headers: {"content-type": "application/json"}}); };
const env = {ACCESS_TOKEN: "tok", SEC_USER_AGENT: "Test t@example.com", ANTHROPIC_API_KEY: "sk-x"}, ctx = {waitUntil() {}};
const call = (path, init = {}) => worker.fetch(new Request("https://gw.example" + path, init), env, ctx);
let r = await call("/"); assert.equal(r.status, 200); console.log("  ✓ health", await r.text());
r = await call("/fetch?url=" + encodeURIComponent("https://data.sec.gov/x.json")); assert.equal(r.status, 401); console.log("  ✓ token required");
r = await call("/fetch?url=" + encodeURIComponent("https://evil.com/x"), {headers: {"x-aic-token": "tok"}}); assert.equal(r.status, 403); console.log("  ✓ host allow-list");
r = await call("/fetch?url=" + encodeURIComponent("https://data.sec.gov/x.json"), {headers: {"x-aic-token": "tok"}}); assert.equal(r.status, 200); assert.equal(r.headers.get("access-control-allow-origin"), "*");
assert.equal(seen.at(-1).o.headers["User-Agent"], "Test t@example.com"); console.log("  ✓ SEC fetch with User-Agent + CORS");
r = await call("/fetch?text=1&url=" + encodeURIComponent("https://www.sec.gov/Archives/k.htm"), {headers: {"x-aic-token": "tok"}}); const t = await r.text(); assert.ok(t.includes("Risk & more") && !t.includes("<p>") && !t.includes("x()")); console.log("  ✓ HTML stripped:", JSON.stringify(t));
r = await call("/anthropic/v1/messages", {method: "POST", headers: {"x-aic-token": "tok", "content-type": "application/json"}, body: "{}"}); assert.equal(r.status, 200); assert.equal(seen.at(-1).o.headers["x-api-key"], "sk-x"); console.log("  ✓ Anthropic proxy adds the key");
r = await call("/fetch", {method: "OPTIONS"}); assert.equal(r.status, 204); console.log("  ✓ CORS preflight");
console.log("All worker tests passed.");
