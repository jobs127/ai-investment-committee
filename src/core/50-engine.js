/* Engines.
   api    — Anthropic Messages API: instant (streaming) or Batch (half price, asynchronous).
            Seats write Markdown and end with one ```json block that the code parses (no extra round trip).
   claude — claude.ai `sample` capability (free with the user's Claude plan, no web access). */
(function (G) {
"use strict";
const AIC = G.AIC, U = AIC.util;
const E = AIC.engine = {};

class EngineError extends Error { constructor(msg, code, partial) { super(msg); this.code = code; this.partial = partial; } }
E.EngineError = EngineError;

/* ---------- output contract: field spec for the ```json block ---------- */
function typeHint(sch) {
  if (!sch) return "string";
  if (sch.enum) return sch.enum.join("|");
  if (sch.type === "integer") return sch.minimum === 1 && sch.maximum === 10 ? "integer 1-10" : "integer";
  if (sch.type === "number") return "number";
  if (sch.type === "boolean") return "true|false";
  if (sch.type === "array") return "[" + typeHint(sch.items) + "]";
  if (sch.type === "object") return "{" + Object.entries(sch.properties || {}).map(([k, v]) => k + ": " + typeHint(v)).join(", ") + "}";
  return "string";
}
E.fieldSpec = function (key) {
  const sc = AIC.schemaFor(key);
  return Object.entries(sc.properties).map(([k, v]) => `- ${k}: ${typeHint(v)}${v.description ? " — " + v.description : ""}`).join("\n");
};
E.jsonInstruction = key => `\n\nFinish with exactly one fenced \`\`\`json block (after the report) containing these fields — fill those you can, omit the rest:\n${E.fieldSpec(key)}`;
E.splitJson = function (text) {
  const t = String(text || ""); const i = t.lastIndexOf("```json");
  if (i < 0) return {text: t.trim(), data: null};
  const body = t.slice(i + 7).replace(/```\s*$/, "").replace(/```[\s\S]*$/, "");
  let data = null; try { data = JSON.parse(body.trim()); } catch { data = U.extractJSON(body); }
  return {text: t.slice(0, i).trim(), data};
};
/* strip a (possibly unfinished) trailing json block while streaming */
E.visibleText = t => { const i = String(t || "").lastIndexOf("```json"); return i < 0 ? t : t.slice(0, i).trimEnd(); };

/* ---------- transport ---------- */
function transport(o, path, viaGatewayForce) {
  const st = o.settings, env = AIC.env;
  const viaGateway = (st.gatewayAnthropic || viaGatewayForce) && env.gateway;
  const url = viaGateway ? env.gateway.replace(/\/+$/, "") + "/anthropic" + path : "https://api.anthropic.com" + path;
  const headers = {"content-type": "application/json", "anthropic-version": "2023-06-01"};
  if (viaGateway) { if (env.token) headers["x-aic-token"] = env.token; if (!st.gatewayAnthropic && o.apiKey) headers["x-api-key"] = o.apiKey; }
  else { headers["x-api-key"] = o.apiKey; if (!env.direct) headers["anthropic-dangerous-direct-browser-access"] = "true"; }
  return {url, headers, viaGateway};
}
async function errorFrom(res, model, viaGateway) {
  let msg = ""; try { const j = await res.json(); msg = j.error?.message || ""; } catch {}
  const s = res.status;
  const map = {401: viaGateway ? "The gateway rejected the request (check the access token, and the worker code is the latest version)." : "The API key was rejected. Use Change key to enter a valid key.",
    403: "This key isn't allowed to make that request. " + msg, 404: `Model "${model}" wasn't found for this key. Check Settings → Cost & models. ` + msg,
    429: "Rate limited by the API. Wait a minute, then press Resume.", 529: "The API is overloaded right now. Wait, then press Resume."};
  return new EngineError(map[s] || `API error ${s}: ${msg}`, "http_" + s);
}

/* ---------- request body ---------- */
E.buildParams = function (o) {
  const st = o.settings, cache = st.promptCaching !== false;
  const system = [{type: "text", text: o.system, ...(cache ? {cache_control: {type: "ephemeral"}} : {})}];
  const content = (o.blocks || []).map(b => ({type: "text", text: b.text}));
  if (cache && content.length) content[content.length - 1].cache_control = {type: "ephemeral"};
  content.push({type: "text", text: o.task + (o.schemaKey ? E.jsonInstruction(o.schemaKey) : "")});
  const tools = o.maxUses > 0 ? [{type: st.toolType || "web_search_20250305", name: "web_search", max_uses: o.maxUses}] : undefined;
  return {model: o.model, max_tokens: +o.maxTokens || +st.maxTokens || 8000, system, messages: [{role: "user", content}], ...(tools ? {tools} : {})};
};

/* assemble text, sources and searches from a finished message's content blocks */
function assemble(blocks, acc) {
  for (const b of blocks || []) {
    if (b.type === "server_tool_use") { if (b.input?.query) acc.searches.push(b.input.query); if (acc.segment.trim().length < 600) acc.segment = ""; else acc.segment += "\n\n"; }
    else if (b.type === "web_search_tool_result" && Array.isArray(b.content)) b.content.forEach(r => r.url && acc.results.set(r.url, r.title || r.url));
    else if (b.type === "text") { acc.segment += b.text || ""; (b.citations || []).forEach(c => c.url && acc.sources.set(c.url, c.title || c.url)); }
  }
}
function finish(acc, o, stop) {
  let text = (acc.final ? acc.final + "\n\n" : "") + acc.segment;
  if (stop === "max_tokens") text += "\n\n_[Report cut at the token limit — raise “Max tokens per seat” in Settings → Cost & models → Advanced.]_";
  const sp = E.splitJson(text);
  const usage = acc.usage; usage.cost = U.usageCost(usage, o.model, !!o.batch); usage.model = o.model; usage.batch = !!o.batch;
  return {text: sp.text, data: sp.data, sources: [...(acc.sources.size ? acc.sources : acc.results)].slice(0, 14).map(([url, title]) => ({url, title})), searches: acc.searches, usage};
}
const newAcc = () => ({final: "", segment: "", sources: new Map(), results: new Map(), searches: [], usage: {in: 0, out: 0, searches: 0, cacheRead: 0, cacheWrite: 0}});
const addMsgUsage = (acc, u) => { if (!u) return; acc.usage.in += u.input_tokens || 0; acc.usage.out += u.output_tokens || 0; acc.usage.cacheRead += u.cache_read_input_tokens || 0; acc.usage.cacheWrite += u.cache_creation_input_tokens || 0; acc.usage.searches += u.server_tool_use?.web_search_requests || 0; };

/* ---------- instant (streaming) ---------- */
E.callAPI = async function (o) {
  const params = E.buildParams(o);
  const acc = newAcc();
  for (let turn = 0; turn < 8; turn++) {
    const tr = transport(o, "/v1/messages");
    let res, attempt = 0;
    for (;;) {
      try { res = await fetch(tr.url, {method: "POST", headers: tr.headers, body: JSON.stringify({...params, stream: true}), signal: o.signal}); }
      catch (e) { if (e.name === "AbortError") throw new EngineError("Stopped.", "cancelled", acc.final + acc.segment); res = null; }
      if (res && res.ok) break;
      const status = res ? res.status : 0;
      if ((status === 0 || status === 429 || status === 529 || status >= 500) && attempt < 2 && !o.signal?.aborted) { attempt++; await U.sleep(attempt * 6000); continue; }
      if (!res) throw new EngineError("Couldn't reach the Anthropic API. Check your connection.", "network", acc.final + acc.segment);
      throw await errorFrom(res, params.model, tr.viaGateway);
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", blocks = [], stop = null;
    const handle = ev => {
      switch (ev.type) {
        case "message_start": addMsgUsage(acc, {input_tokens: ev.message?.usage?.input_tokens, cache_read_input_tokens: ev.message?.usage?.cache_read_input_tokens, cache_creation_input_tokens: ev.message?.usage?.cache_creation_input_tokens}); break;
        case "content_block_start": {
          const b = JSON.parse(JSON.stringify(ev.content_block));
          if (b.type === "text") b.text = b.text || "";
          if (b.type === "server_tool_use" || b.type === "tool_use") b._json = "";
          if (b.type === "thinking") b.thinking = b.thinking || "";
          blocks[ev.index] = b;
          if (b.type === "web_search_tool_result" && Array.isArray(b.content)) b.content.forEach(r => r.url && acc.results.set(r.url, r.title || r.url));
          if (b.type === "server_tool_use") { if (acc.segment.trim().length < 600) acc.segment = ""; else acc.segment += "\n\n"; }
          break; }
        case "content_block_delta": {
          const b = blocks[ev.index], d = ev.delta; if (!b) break;
          if (d.type === "text_delta") { b.text += d.text; acc.segment += d.text; o.onText && o.onText(E.visibleText((acc.final ? acc.final + "\n\n" : "") + acc.segment)); }
          else if (d.type === "input_json_delta") b._json += d.partial_json || "";
          else if (d.type === "citations_delta") { (b.citations = b.citations || []).push(d.citation); if (d.citation?.url) acc.sources.set(d.citation.url, d.citation.title || d.citation.url); }
          else if (d.type === "thinking_delta") b.thinking += d.thinking;
          else if (d.type === "signature_delta") b.signature = d.signature;
          break; }
        case "content_block_stop": {
          const b = blocks[ev.index];
          if (b && "_json" in b) { try { b.input = b._json ? JSON.parse(b._json) : {}; } catch { b.input = {}; } delete b._json;
            if (b.type === "server_tool_use" && b.input?.query) { acc.searches.push(b.input.query); o.onSearch && o.onSearch(b.input.query); } }
          break; }
        case "message_delta": stop = ev.delta?.stop_reason || stop; acc.usage.out += ev.usage?.output_tokens || 0; acc.usage.searches += ev.usage?.server_tool_use?.web_search_requests || 0; break;
        case "error": throw new EngineError("API stream error: " + (ev.error?.message || "unknown"), "stream", acc.final + acc.segment);
      }
    };
    try {
      for (;;) {
        const {value, done} = await reader.read(); if (done) break;
        buf += dec.decode(value, {stream: true});
        let k; while ((k = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, k); buf = buf.slice(k + 2);
          const line = chunk.split("\n").filter(x => x.startsWith("data:")).map(x => x.slice(5).trim()).join("");
          if (line && line !== "[DONE]") { let ev; try { ev = JSON.parse(line); } catch { continue; } handle(ev); }
        }
      }
    } catch (e) {
      if (e instanceof EngineError) throw e;
      if (e.name === "AbortError") throw new EngineError("Stopped.", "cancelled", acc.final + acc.segment);
      throw new EngineError("The connection dropped mid-report. Press Resume to retry this step.", "network", acc.final + acc.segment);
    }
    if (acc.segment) { acc.final = (acc.final ? acc.final + "\n\n" : "") + acc.segment; acc.segment = ""; }
    if (stop === "pause_turn") { params.messages.push({role: "assistant", content: blocks.filter(Boolean).map(b => { const c = {...b}; delete c._json; return c; })}); continue; }
    const out = finish(acc, o, stop);
    if (o.schemaKey && !out.data) out.data = await E.repairJson(out.text, o);
    out.data = E.normalize(o.schemaKey, out.data);
    return out;
  }
  throw new EngineError("Too many continuation turns.", "loop");
};

/* cheap JSON repair with the helper model (only the report text is sent, never the whole context) */
E.repairJson = async function (text, o) {
  if (!text || !o.schemaKey) return null;
  try {
    const helper = o.settings.helperModel || AIC.DEFAULTS.helperModel;
    const out = await E.callAPI({settings: o.settings, apiKey: o.apiKey, model: helper, system: "You convert investment-committee reports into JSON. Reply with only the JSON block.",
      blocks: [], task: "REPORT:\n" + text.slice(0, 30000), schemaKey: null, maxUses: 0, maxTokens: 2500, signal: o.signal});
    o.onExtraUsage && o.onExtraUsage(out.usage);
    return out.data || U.extractJSON(out.text);
  } catch { return null; }
};

/* ---------- Batch API (half price) ---------- */
E.batch = {};
/* jobs: [{customId, o, state}] where state persists {batchId, turn, messages} between polls/sessions.
   Returns when every job is finished. opts: {settings, apiKey, signal, defer, onStatus(info), save()} */
E.batch.run = async function (jobs, opts) {
  const st = opts.settings, any = jobs[0]?.o || {settings: st, apiKey: opts.apiKey};
  const call = async (path, init = {}) => {
    const try1 = async force => { const tr = transport({settings: st, apiKey: opts.apiKey}, path, force); return {res: await fetch(tr.url, {method: init.method || "GET", headers: tr.headers, body: init.body, signal: opts.signal}), tr}; };
    let r;
    try { r = await try1(!!E._batchViaGateway); }
    catch (e) {
      if (e.name === "AbortError") throw new EngineError("Stopped.", "cancelled");
      if (AIC.env.gateway && !E._batchViaGateway) { E._batchViaGateway = true; r = await try1(true); }
      else throw new EngineError(AIC.env.gateway ? "Couldn't reach the Batch API through the gateway. Update the Cloudflare worker code (see README) and try again." : "Your browser couldn't reach Anthropic's Batch API directly. Set up the data gateway (Settings → Data) — Saver then routes through it — or use the Balanced plan.", "network");
    }
    if (!r.res.ok) throw await errorFrom(r.res, any.model, r.tr.viaGateway);
    return r.res;
  };
  const pending = () => jobs.filter(j => !j.done);
  for (let round = 0; round < 10 && pending().length; round++) {
    // submit jobs without a live batch
    const toSubmit = pending().filter(j => !j.state.batchId);
    if (toSubmit.length) {
      const requests = toSubmit.map(j => {
        const params = j.state.params || E.buildParams(j.o);
        if (j.state.messages) params.messages = j.state.messages;
        j.state.params = null;
        return {custom_id: j.customId, params};
      });
      const res = await call("/v1/messages/batches", {method: "POST", body: JSON.stringify({requests})});
      const b = await res.json();
      toSubmit.forEach(j => { j.state.batchId = b.id; j.state.submittedAt = j.state.submittedAt || Date.now(); });
      opts.save && await opts.save();
    }
    // wait for each live batch
    const ids = [...new Set(pending().map(j => j.state.batchId))];
    for (const id of ids) {
      let info, polls = 0;
      for (;;) {
        info = await (await call(`/v1/messages/batches/${id}`)).json();
        opts.onStatus && opts.onStatus({id, status: info.processing_status, counts: info.request_counts, since: pending().find(j => j.state.batchId === id)?.state.submittedAt});
        if (info.processing_status === "ended") break;
        if (opts.defer) throw new EngineError("Waiting for Anthropic's batch to finish.", "deferred");
        polls++; await U.sleep(polls < 4 ? 15000 : 30000);
        if (opts.signal?.aborted) throw new EngineError("Stopped. The batch keeps running at Anthropic; press Resume to collect it.", "cancelled");
      }
      const resultsPath = info.results_url ? new URL(info.results_url).pathname : `/v1/messages/batches/${id}/results`;
      const lines = (await (await call(resultsPath)).text()).split("\n").filter(Boolean);
      const byId = new Map(lines.map(l => { const r = JSON.parse(l); return [r.custom_id, r.result]; }));
      for (const j of pending().filter(x => x.state.batchId === id)) {
        const r = byId.get(j.customId);
        if (!r || r.type !== "succeeded") { j.done = true; j.error = new EngineError(`Batch request ${r ? r.type : "missing"}${r?.error?.error?.message ? ": " + r.error.error.message : ""}. Press Resume to retry this seat.`, "batch_" + (r ? r.type : "missing")); continue; }
        const msg = r.message;
        const acc = j.state.acc ? Object.assign(newAcc(), j.state.acc, {sources: new Map(j.state.acc.sources || []), results: new Map(j.state.acc.results || [])}) : newAcc();
        addMsgUsage(acc, msg.usage);
        assemble(msg.content, acc);
        if (acc.segment) { acc.final = (acc.final ? acc.final + "\n\n" : "") + acc.segment; acc.segment = ""; }
        if (msg.stop_reason === "pause_turn") {
          const base = j.state.messages || E.buildParams(j.o).messages;
          j.state.messages = base.concat([{role: "assistant", content: msg.content}]);
          j.state.acc = {...acc, sources: [...acc.sources], results: [...acc.results]};
          j.state.batchId = null; continue;
        }
        const out = finish(acc, {...j.o, batch: true}, msg.stop_reason);
        if (j.o.schemaKey && !out.data) out.data = await E.repairJson(out.text, j.o);
        out.data = E.normalize(j.o.schemaKey, out.data);
        j.out = out; j.done = true;
      }
      opts.save && await opts.save();
    }
  }
  return jobs;
};

/* ---------- claude.ai sample capability ---------- */
const SUBMIT_DESC = "Submit the structured data for the report you just wrote. Call exactly once, after the Markdown report.";
function compact(schema) { return JSON.parse(JSON.stringify(schema, (k, v) => k === "description" ? undefined : v)); }
E.callClaude = async function (o) {
  const sample = AIC.env.sample; if (!sample) throw new EngineError("Claude isn't available in this view.", "no_sample");
  const parts = [o.system].concat((o.blocks || []).map(b => b.text)).concat([o.task]);
  let data = null;
  const schema = o.schemaKey ? compact(AIC.schemaFor(o.schemaKey)) : null;
  let tools;
  if (schema && JSON.stringify(schema).length < 4000 && AIC.env.sampleTools) tools = [{name: "submit_report", description: SUBMIT_DESC, inputSchema: schema, execute: input => { data = input; return "Recorded."; }}];
  const prompt = parts.join("\n\n---\n\n") + (schema && !tools ? E.jsonInstruction(o.schemaKey) : schema ? "\n\nWhen the report is finished, call the submit_report tool once with the structured data." : "");
  const errMap = {cancelled: "Stopped.", not_granted: "Claude access wasn't allowed for this page. Reload and allow it.", rate_limited: "You've hit a usage or rate limit. Wait, then press Resume.",
    session_expired: "Your claude.ai session expired. Sign in again, then press Resume.", refused: "Claude declined this step.", sampling_disabled: "Claude isn't available to this account from artifacts.",
    prompt_too_large: "The committee record got too long for one step. Remove member documents or use a smaller mode."};
  let text = "";
  try {
    const r = await sample(prompt, {modelTier: o.tier || "complex", ...(tools ? {tools} : {cache: false}), signal: o.signal, onText: ({text: t}) => { text = t; o.onText && o.onText(E.visibleText(t)); }});
    text = r.text; if (r.truncated) text += "\n\n_[Answer was cut short at the length limit.]_";
  } catch (e) {
    const c = e && e.code;
    if (c === "tools_unavailable" && tools) { AIC.env.sampleTools = false; return E.callClaude(o); }
    throw new EngineError(errMap[c] || ("Claude call failed (" + (c || "error") + "). Press Resume to retry."), c || "upstream_error", e && e.text);
  }
  const sp = E.splitJson(text); text = sp.text; data = data || sp.data;
  if (schema && !data) { try { data = await sample.json(`Extract structured data from this committee report. Reply with only one JSON object using these fields where the report supports them:\n${E.fieldSpec(o.schemaKey)}\n\nREPORT:\n${text.slice(0, 40000)}`, {modelTier: "quick"}); } catch { data = null; } }
  return {text, data: E.normalize(o.schemaKey, data), sources: [], usage: null};
};

E.call = o => (o.engine === "claude" ? E.callClaude(o) : E.callAPI(o));

/* coerce numbers and clamp scores */
E.normalize = function (key, d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const num = v => U.num(v);
  const score = v => { const n = num(v); return n == null ? null : U.clamp(Math.round(n), 1, 10); };
  for (const k of Object.keys(d)) if (/^score_|^overall$|_score$/.test(k)) d[k] = score(d[k]);
  if (d.scores && typeof d.scores === "object") for (const k in d.scores) d.scores[k] = score(d.scores[k]);
  for (const k of ["implied_growth_pct","intrinsic_low","intrinsic_high","normalized_eps","entry_low","entry_high","breakout","invalidation","base_rate_pct","upside_price","upside_probability_pct","horizon_months","price","position_pct_target","position_pct_max","revised_score","shares_outstanding","market_cap","price_target_mean","analyst_count","short_interest_pct"]) if (k in d) d[k] = num(d[k]);
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
