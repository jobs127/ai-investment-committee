/* Utilities (DOM-free) */
(function (G) {
"use strict";
const AIC = G.AIC;
const U = AIC.util = {};

U.sleep = ms => new Promise(r => setTimeout(r, ms));
U.clamp = (x, a, b) => Math.max(a, Math.min(b, x));
U.isNum = x => typeof x === "number" && isFinite(x);
U.num = x => { if (U.isNum(x)) return x; const m = String(x ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/); return m ? +m[0] : null; };
U.round = (x, d = 2) => U.isNum(x) ? Math.round(x * 10 ** d) / 10 ** d : null;
U.pct = (x, d = 1) => U.isNum(x) ? (x * 100).toFixed(d) + "%" : "n/a";
U.fmtNum = (x, d = 2) => {
  if (!U.isNum(x)) return "n/a";
  const a = Math.abs(x);
  if (a >= 1e12) return (x / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return (x / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (x / 1e6).toFixed(1) + "M";
  if (a >= 1e4) return (x / 1e3).toFixed(1) + "k";
  return x.toFixed(d);
};
U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
U.today = () => new Date().toISOString().slice(0, 10);
U.longDate = () => new Date().toLocaleDateString("en-US", {year:"numeric", month:"long", day:"numeric"});
U.daysBetween = (a, b) => (new Date(b) - new Date(a)) / 864e5;
U.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
U.normTicker = t => String(t || "").trim().toUpperCase().replace(/^\$/, "").replace(/\s+/g, "");
U.validTicker = t => /^[A-Z0-9.\-:=^]{1,20}$/.test(t);
U.mean = a => { const v = a.filter(U.isNum); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
U.median = a => { const v = a.filter(U.isNum).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
U.stdev = a => { const v = a.filter(U.isNum); if (v.length < 2) return null; const m = U.mean(v); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); };
U.corr = (a, b, minN = 10) => {
  const n = Math.min(a.length, b.length); if (n < minN) return null;
  const x = a.slice(-n), y = b.slice(-n), mx = U.mean(x), my = U.mean(y);
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; }
  return sx && sy ? sxy / Math.sqrt(sx * sy) : null;
};
U.rank = a => { // average ranks for ties
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length);
  for (let k = 0; k < idx.length;) { let j = k; while (j + 1 < idx.length && idx[j + 1][0] === idx[k][0]) j++; const avg = (k + j) / 2 + 1; for (let m = k; m <= j; m++) r[idx[m][1]] = avg; k = j + 1; }
  return r; };
U.spearman = (a, b) => { const p = []; for (let i = 0; i < a.length; i++) if (U.isNum(a[i]) && U.isNum(b[i])) p.push([a[i], b[i]]); if (p.length < 5) return null; return U.corr(U.rank(p.map(x => x[0])), U.rank(p.map(x => x[1])), 5); };

/* concurrency-limited map */
U.pmap = async function (items, fn, limit = 4) {
  const out = new Array(items.length); let i = 0;
  const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = {__error: e}; } }
  });
  await Promise.all(workers); return out;
};

/* tolerant JSON extraction from model text */
U.extractJSON = function (text) {
  if (!text) return null;
  const tryParse = s => { try { return JSON.parse(s); } catch { return undefined; } };
  let v = tryParse(text.trim()); if (v !== undefined) return v;
  const fences = [...String(text).matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (let i = fences.length - 1; i >= 0; i--) { v = tryParse(fences[i][1].trim()); if (v !== undefined) return v; }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { v = tryParse(text.slice(a, b + 1)); if (v !== undefined) return v; }
  return null;
};

/* KEY: value lines (fallback parser) */
U.parseKV = function (text) {
  const out = {};
  for (const raw of String(text || "").split("\n")) {
    const line = raw.replace(/^[\s>*#-]+/, "").replace(/\*\*/g, "");
    const m = line.match(/^([A-Z][A-Z0-9_ ]{1,30}?)\s*:\s*(.+)$/);
    if (m) { const k = m[1].trim().replace(/\s+/g, "_"); if (!(k in out)) out[k] = m[2].trim(); }
  }
  return out;
};

U.stripHtml = function (html) {
  return String(html || "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#8217;|&rsquo;|&#x2019;/gi, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"').replace(/&#8212;|&mdash;/gi, "—").replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
};

/* minimal XML helpers for Form 4 / Atom (no DOMParser in Node) */
U.xmlAll = (xml, tag) => { const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"); const out = []; let m; while ((m = re.exec(xml))) out.push(m[1]); return out; };
U.xmlOne = (xml, tag) => { const a = U.xmlAll(xml, tag); return a.length ? a[0] : ""; };
U.xmlVal = (xml, path) => { let cur = xml; for (const t of path.split("/")) { cur = U.xmlOne(cur, t); if (!cur) return ""; } return cur.replace(/<[^>]+>/g, "").trim(); };

/* cost */
U.costOf = function (usage, st) {
  if (!usage || st.priceIn === "" || st.priceOut === "" || st.priceIn == null || st.priceOut == null) return null;
  const inTok = (usage.in || 0) + (usage.cacheWrite || 0) * 1.25 + (usage.cacheRead || 0) * 0.1;
  return inTok / 1e6 * +st.priceIn + (usage.out || 0) / 1e6 * +st.priceOut + (st.priceSearch !== "" && st.priceSearch != null ? (usage.searches || 0) / 1000 * +st.priceSearch : 0);
};
U.addUsage = (a, b) => { if (!b) return a; a = a || {in:0, out:0, searches:0, cacheRead:0, cacheWrite:0}; for (const k of ["in","out","searches","cacheRead","cacheWrite"]) a[k] = (a[k] || 0) + (b[k] || 0); return a; };

U.verdictClass = v => { v = String(v || "").toUpperCase(); if (AIC.BULLISH.some(x => v.startsWith(x))) return "bull"; if (AIC.BEARISH.some(x => v.startsWith(x))) return "bear"; if (v.startsWith("HOLD")) return "hold"; return "none"; };
})(typeof globalThis !== "undefined" ? globalThis : window);
