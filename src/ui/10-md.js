/* DOM helpers and a small Markdown renderer (escapes first). */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const fmtDate = ts => { const d = new Date(ts); return d.toLocaleDateString(undefined, {month: "numeric", day: "numeric", year: "numeric"}) + " · " + d.toLocaleTimeString(undefined, {hour: "2-digit", minute: "2-digit"}); };
const fmtK = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n || 0);
const secs = ms => (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + "s";
const pct = (x, d = 1) => U.isNum(x) ? (x * 100).toFixed(d) + "%" : "–";
const spct = (x, d = 1) => U.isNum(x) ? (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%" : "–";
const n2 = (x, d = 2) => U.isNum(x) ? U.fmtNum(x, d) : "–";
function toast(msg, ms = 3400) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); }
function verdictColor(v) {
  v = (v || "").toUpperCase();
  if (v.startsWith("STRONG BUY") || v === "BUY") return "var(--good)";
  if (v.startsWith("ACCUMULATE")) return "var(--good-2)";
  if (v.startsWith("HOLD")) return "var(--warn)";
  if (v.startsWith("REDUCE")) return "var(--orange)";
  if (v.startsWith("SELL") || v.startsWith("AVOID")) return "var(--bad)";
  return "var(--fg-2)";
}
function scoreColor(n) { n = +n; if (!n) return "var(--fg-2)"; if (n >= 8) return "var(--good)"; if (n >= 6) return "var(--good-2)"; if (n >= 5) return "var(--warn)"; if (n >= 4) return "var(--orange)"; return "var(--bad)"; }
function scoreWord(n) { n = +n; if (n >= 8) return "Strong"; if (n >= 6) return "Positive"; if (n >= 5) return "Neutral"; if (n >= 3) return "Weak"; return n ? "Poor" : "—"; }
const dirColor = d => d === "positive" ? "var(--good)" : d === "negative" ? "var(--bad)" : "var(--fg-2)";
const dirMark = d => d === "positive" ? "▲" : d === "negative" ? "▼" : "■";

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:])/g, "$1<em>$2</em>");
}
function md(src) {
  const L = esc(src || "").replace(/\r/g, "").split("\n"); let h = "", i = 0, para = [];
  const flush = () => { if (para.length) { h += "<p>" + inline(para.join(" ")) + "</p>"; para = []; } };
  const isRow = l => /^\s*\|.*\|\s*$/.test(l);
  while (i < L.length) {
    const l = L[i]; let m;
    if (/^\s*```/.test(l)) { flush(); const b = []; i++; while (i < L.length && !/^\s*```/.test(L[i])) b.push(L[i++]); i++; h += "<pre>" + b.join("\n") + "</pre>"; continue; }
    if (/^\s*$/.test(l)) { flush(); i++; continue; }
    if ((m = l.match(/^\s*(#{1,6})\s+(.*)$/))) { flush(); const n = Math.min(4, m[1].length); h += `<h${n}>${inline(m[2].replace(/#+\s*$/, ""))}</h${n}>`; i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); h += "<hr>"; i++; continue; }
    if (isRow(l) && i + 1 < L.length && /^\s*\|?\s*:?-{2,}/.test(L[i + 1])) {
      flush(); const cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => inline(c.trim()));
      let t = "<div class='tbl'><table><thead><tr>" + cells(l).map(c => "<th>" + c + "</th>").join("") + "</tr></thead><tbody>"; i += 2;
      while (i < L.length && isRow(L[i])) { t += "<tr>" + cells(L[i]).map(c => "<td>" + c + "</td>").join("") + "</tr>"; i++; }
      h += t + "</tbody></table></div>"; continue;
    }
    if (/^\s*([-*+•]|\d+[.)])\s+/.test(l)) {
      flush(); const ordered = /^\s*\d/.test(l); const items = [];
      while (i < L.length && (/^\s*([-*+•]|\d+[.)])\s+/.test(L[i]) || (/^\s{2,}\S/.test(L[i]) && items.length))) {
        if (/^\s*([-*+•]|\d+[.)])\s+/.test(L[i])) items.push(L[i].replace(/^\s*([-*+•]|\d+[.)])\s+/, "")); else items[items.length - 1] += " " + L[i].trim(); i++;
      }
      h += (ordered ? "<ol>" : "<ul>") + items.map(x => "<li>" + inline(x) + "</li>").join("") + (ordered ? "</ol>" : "</ul>"); continue;
    }
    if (/^\s*&gt;\s?/.test(l)) { flush(); const b = []; while (i < L.length && /^\s*&gt;\s?/.test(L[i])) b.push(L[i++].replace(/^\s*&gt;\s?/, "")); h += "<blockquote>" + inline(b.join(" ")) + "</blockquote>"; continue; }
    if ((m = l.match(/^([A-Z][A-Z0-9_]{2,30}):\s+(.*)$/))) { flush(); h += `<p class="kvl"><span>${m[1]}:</span> ${inline(m[2])}</p>`; i++; continue; }
    para.push(l.trim()); i++;
  }
  flush(); return h;
}
const sourcesHtml = list => list && list.length ? `<div class="sources"><span class="lbl">Sources</span><ol>${list.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>`).join("")}</ol></div>` : "";
