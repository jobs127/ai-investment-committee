/* Engines: Anthropic Messages API (browser direct, via gateway, or Node) and claude.ai `sample`.
   Every seat writes Markdown, then submits structured data through the submit_report tool. */
(function (G) {
"use strict";
const AIC = G.AIC, U = AIC.util;
const E = AIC.engine = {};

class EngineError extends Error { constructor(msg, code, partial) { super(msg); this.code = code; this.partial = partial; } }
E.EngineError = EngineError;

/* One unified submit_report schema for all committee seats: identical tool definitions keep the prompt cache warm across seats. */
E.unifiedSchema = function () {
  if (E._uni) return E._uni;
  const props = {};
  for (const k in AIC.SCHEMAS) { if (["ask","ideas","compare","thesis"].includes(k)) continue; const s = AIC.schemaFor(k); Object.assign(props, s.properties); }
  return (E._uni = {type: "object", properties: props, required: ["summary"]});
};
E.fieldsFor = key => { const sc = AIC.SCHEMAS[key]; return ["summary", "claims", "data_gaps"].concat(Object.keys(sc ? sc.extra : {})); };
function compact(schema) { // strip descriptions (sample tools cap schemas at 4 KB)
  return JSON.parse(JSON.stringify(schema, (k, v) => k === "description" ? undefined : v));
}
const SUBMIT_DESC = "Submit the structured data for the report you just wrote. Call exactly once, after the Markdown report. Fill only the fields relevant to your seat.";

/* -------- Anthropic Messages API -------- */
E.callAPI = async function (o) {
  const st = o.settings, env = AIC.env;
  const viaGateway = st.gatewayAnthropic && env.gateway;
  const url = viaGateway ? env.gateway.replace(/\/+$/, "") + "/anthropic/v1/messages" : "https://api.anthropic.com/v1/messages";
  const headers = {"content-type": "application/json", "anthropic-version": "2023-06-01"};
  if (viaGateway) { if (env.token) headers["x-aic-token"] = env.token; }
  else { headers["x-api-key"] = o.apiKey; if (!env.direct) headers["anthropic-dangerous-direct-browser-access"] = "true"; }
  const cache = st.promptCaching !== false;
  const system = [{type: "text", text: o.system, ...(cache ? {cache_control: {type: "ephemeral"}} : {})}];
  const content = (o.blocks || []).map(b => ({type: "text", text: b.text}));
  if (cache && content.length) content[content.length - 1].cache_control = {type: "ephemeral"};
  content.push({type: "text", text: o.task});
  const messages = [{role: "user", content}];
  const tools = [];
  if (o.maxUses > 0) tools.push({type: st.toolType || "web_search_20250305", name: "web_search", max_uses: o.maxUses});
  const submitSchema = o.schemaKey ? (o.unified ? E.unifiedSchema() : AIC.schemaFor(o.schemaKey)) : null;
  if (submitSchema) tools.push({name: "submit_report", description: SUBMIT_DESC + (o.unified ? " Fields for your seat: " + E.fieldsFor(o.schemaKey).join(", ") + "." : ""), input_schema: submitSchema});

  const usage = {in: 0, out: 0, searches: 0, cacheRead: 0, cacheWrite: 0};
  let finalText = "", segment = "", data = null, toolChoice = null;
  const sources = new Map(), results = new Map();
  for (let turn = 0; turn < 8; turn++) {
    const body = {model: o.model || st.model, max_tokens: +o.maxTokens || +st.maxTokens || 8000, system, messages, ...(tools.length ? {tools} : {}), ...(toolChoice ? {tool_choice: toolChoice} : {}), stream: true};
    let res, attempt = 0;
    for (;;) {
      try { res = await fetch(url, {method: "POST", headers, body: JSON.stringify(body), signal: o.signal}); }
      catch (e) { if (e.name === "AbortError") throw new EngineError("Stopped.", "cancelled", finalText + segment); res = null; }
      if (res && res.ok) break;
      const status = res ? res.status : 0;
      let msg = ""; if (res) { try { const j = await res.json(); msg = j.error?.message || ""; } catch {} }
      if ((status === 0 || status === 429 || status === 529 || status >= 500) && attempt < 2 && !o.signal?.aborted) { attempt++; await U.sleep(attempt * 6000); continue; }
      const map = {0: "Couldn't reach the Anthropic API. Check your connection" + (viaGateway ? " and the gateway URL." : "."), 401: viaGateway ? "The gateway rejected the request (check the access token and the gateway's ANTHROPIC_API_KEY secret)." : "The API key was rejected. Use Change key to enter a valid key.",
        403: "This key isn't allowed to make that request. " + msg, 404: `Model "${body.model}" wasn't found for this key. Check Settings → Engine. ` + msg,
        429: "Rate limited by the API. Wait a minute, then press Resume.", 529: "The API is overloaded right now. Wait, then press Resume."};
      throw new EngineError(map[status] || `API error ${status}: ${msg}`, "http_" + status, finalText + segment);
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", blocks = [], stop = null, submitBlock = null;
    const handle = ev => {
      switch (ev.type) {
        case "message_start": { const u = ev.message?.usage || {}; usage.in += u.input_tokens || 0; usage.cacheRead += u.cache_read_input_tokens || 0; usage.cacheWrite += u.cache_creation_input_tokens || 0; break; }
        case "content_block_start": {
          const b = JSON.parse(JSON.stringify(ev.content_block));
          if (b.type === "text") b.text = b.text || "";
          if (b.type === "server_tool_use" || b.type === "tool_use") b._json = "";
          if (b.type === "thinking") b.thinking = b.thinking || "";
          blocks[ev.index] = b;
          if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url) results.set(r.url, r.title || r.url);
          if (b.type === "server_tool_use") { if (segment.trim().length < 600) segment = ""; else segment += "\n\n"; }
          break; }
        case "content_block_delta": {
          const b = blocks[ev.index], d = ev.delta; if (!b) break;
          if (d.type === "text_delta") { b.text += d.text; segment += d.text; o.onText && o.onText((finalText ? finalText + "\n\n" : "") + segment); }
          else if (d.type === "input_json_delta") b._json += d.partial_json || "";
          else if (d.type === "citations_delta") { (b.citations = b.citations || []).push(d.citation); if (d.citation?.url) sources.set(d.citation.url, d.citation.title || d.citation.url); }
          else if (d.type === "thinking_delta") b.thinking += d.thinking;
          else if (d.type === "signature_delta") b.signature = d.signature;
          break; }
        case "content_block_stop": {
          const b = blocks[ev.index];
          if (b && "_json" in b) { try { b.input = b._json ? JSON.parse(b._json) : {}; } catch { b.input = {}; } delete b._json;
            if (b.type === "server_tool_use" && b.input?.query) o.onSearch && o.onSearch(b.input.query);
            if (b.type === "tool_use" && b.name === "submit_report") submitBlock = b; }
          break; }
        case "message_delta": stop = ev.delta?.stop_reason || stop; usage.out += ev.usage?.output_tokens || 0; usage.searches += ev.usage?.server_tool_use?.web_search_requests || 0; break;
        case "error": throw new EngineError("API stream error: " + (ev.error?.message || "unknown"), "stream", finalText + segment);
      }
    };
    try {
      for (;;) {
        const {value, done} = await reader.read(); if (done) break;
        buf += dec.decode(value, {stream: true});
        let k; while ((k = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, k); buf = buf.slice(k + 2);
          const dataLine = chunk.split("\n").filter(x => x.startsWith("data:")).map(x => x.slice(5).trim()).join("");
          if (dataLine && dataLine !== "[DONE]") { let ev; try { ev = JSON.parse(dataLine); } catch { continue; } handle(ev); }
        }
      }
    } catch (e) {
      if (e instanceof EngineError) throw e;
      if (e.name === "AbortError") throw new EngineError("Stopped.", "cancelled", finalText + segment);
      throw new EngineError("The connection dropped mid-report. Press Resume to retry this step.", "network", finalText + segment);
    }
    if (segment) finalText = (finalText ? finalText + "\n\n" : "") + segment; segment = "";
    const assistantContent = blocks.filter(Boolean).map(b => { const c = Object.assign({}, b); delete c._json; return c; });
    if (submitBlock) data = submitBlock.input;
    if (stop === "pause_turn") { messages.push({role: "assistant", content: assistantContent}); continue; }
    if (submitSchema && submitBlock && !finalText.trim() && turn < 6) {
      // submitted before writing: ask for the report
      messages.push({role: "assistant", content: assistantContent});
      messages.push({role: "user", content: [{type: "tool_result", tool_use_id: submitBlock.id, content: "Recorded. Now write your full Markdown report for the committee."}]});
      toolChoice = {type: "none"}; continue;
    }
    if (submitSchema && !data && stop !== "max_tokens" && turn < 6) {
      messages.push({role: "assistant", content: assistantContent.length ? assistantContent : [{type: "text", text: finalText || "(no text)"}]});
      messages.push({role: "user", content: [{type: "text", text: "Now call submit_report once with the structured data for the report you just wrote."}]});
      toolChoice = {type: "tool", name: "submit_report"}; continue;
    }
    if (stop === "max_tokens") finalText += "\n\n_[Report cut at the token limit — raise “Max tokens per seat” in Settings.]_";
    break;
  }
  const src = [...(sources.size ? sources : results)].slice(0, 14).map(([url, title]) => ({url, title}));
  return {text: finalText.trim(), data: E.normalize(o.schemaKey, data), sources: src, usage};
};

/* -------- claude.ai sample capability -------- */
E.callClaude = async function (o) {
  const sample = AIC.env.sample; if (!sample) throw new EngineError("Claude isn't available in this view.", "no_sample");
  const parts = [o.system].concat((o.blocks || []).map(b => b.text)).concat([o.task]);
  let data = null;
  const schema = o.schemaKey ? compact(AIC.schemaFor(o.schemaKey)) : null;
  let tools;
  if (schema && JSON.stringify(schema).length < 4000 && AIC.env.sampleTools) {
    tools = [{name: "submit_report", description: SUBMIT_DESC.slice(0, 900), inputSchema: schema, execute: input => { data = input; return "Recorded."; }}];
  }
  const prompt = parts.join("\n\n---\n\n") + (schema && !tools ? "\n\n(When finished, end your answer with the Markdown report only; structured data will be extracted separately.)" : "");
  const errMap = {cancelled: "Stopped.", not_granted: "Claude access wasn't allowed for this page. Reload and allow it.", rate_limited: "You've hit a usage or rate limit. Wait, then press Resume.",
    session_expired: "Your claude.ai session expired. Sign in again, then press Resume.", refused: "Claude declined this step.", sampling_disabled: "Claude isn't available to this account from artifacts.",
    prompt_too_large: "The committee record got too long for one step. Remove member documents or use a smaller mode.", tools_unavailable: "Tools unavailable"};
  let text = "";
  try {
    const r = await sample(prompt, {modelTier: o.tier || "complex", ...(tools ? {tools} : {cache: false}), signal: o.signal, onText: ({text: t}) => { text = t; o.onText && o.onText(t); }});
    text = r.text; if (r.truncated) text += "\n\n_[Answer was cut short at the length limit.]_";
  } catch (e) {
    const c = e && e.code;
    if (c === "tools_unavailable" && tools) { AIC.env.sampleTools = false; return E.callClaude(o); }
    throw new EngineError(errMap[c] || ("Claude call failed (" + (c || "error") + "). Press Resume to retry."), c || "upstream_error", e && e.text);
  }
  if (schema && !data) {
    try {
      data = await sample.json(`Extract structured data from this committee report. Reply with only one JSON object using these fields where the report supports them: ${JSON.stringify(schema).slice(0, 6000)}\n\nREPORT:\n${text.slice(0, 40000)}`, {modelTier: "quick"});
    } catch { data = null; }
  }
  // strip a trailing JSON block the model may have echoed
  text = text.replace(/```json[\s\S]*?```\s*$/, "").trim();
  return {text, data: E.normalize(o.schemaKey, data), sources: [], usage: null};
};

E.call = o => (o.engine === "claude" ? E.callClaude(o) : E.callAPI(o));

/* coerce numbers and clamp scores */
E.normalize = function (key, d) {
  if (!d || typeof d !== "object") return null;
  const num = v => U.num(v);
  const score = v => { const n = num(v); return n == null ? null : U.clamp(Math.round(n), 1, 10); };
  for (const k of Object.keys(d)) if (/^score_|^overall$|_score$/.test(k)) d[k] = score(d[k]);
  if (d.scores && typeof d.scores === "object") for (const k in d.scores) d.scores[k] = score(d.scores[k]);
  for (const k of ["implied_growth_pct","intrinsic_low","intrinsic_high","normalized_eps","entry_low","entry_high","breakout","invalidation","base_rate_pct","upside_price","upside_probability_pct","horizon_months","price","position_pct_target","position_pct_max","revised_score"]) if (k in d) d[k] = num(d[k]);
  if (Array.isArray(d.claims)) d.claims = d.claims.filter(c => c && c.text).map(c => Object.assign(c, {value: c.value == null ? null : num(c.value)}));
  if (Array.isArray(d.scenarios)) d.scenarios = d.scenarios.map(s => Object.assign(s, {price: num(s.price), probability: num(s.probability), horizon_months: num(s.horizon_months)}));
  if (Array.isArray(d.tranches)) d.tranches = d.tranches.map(t => Object.assign(t, {low: num(t.low), high: num(t.high), pct: num(t.pct)}));
  if (d.stop) d.stop.price = num(d.stop.price);
  if (Array.isArray(d.targets)) d.targets = d.targets.map(t => Object.assign(t, {price: num(t.price)}));
  if (Array.isArray(d.drawdown_scenarios)) d.drawdown_scenarios = d.drawdown_scenarios.map(s => Object.assign(s, {price: num(s.price), loss_pct: num(s.loss_pct), probability_pct: num(s.probability_pct)}));
  if (d.verdict) { const v = String(d.verdict).toUpperCase(); d.verdict = AIC.VERDICTS.find(x => v.startsWith(x)) || AIC.VERDICTS.find(x => v.includes(x)) || v; }
  return d;
};
})(typeof globalThis !== "undefined" ? globalThis : window);
