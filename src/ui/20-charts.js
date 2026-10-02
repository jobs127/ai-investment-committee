/* Charts as inline SVG: price with levels, scenario range strip, calibration bars. Colors from CSS tokens. */
const Charts = {};

Charts.price = function (el, fs, run, range) {
  const bars = A.barsOf(fs); if (!bars || bars.length < 30) { el.innerHTML = `<p class="muted">No price history. Add a data gateway in Settings to load prices.</p>`; return; }
  const days = {"6M": 126, "1Y": 252, "2Y": 504}[range || "1Y"] || 252;
  const all = bars, c = all.map(b => b.c);
  const sma = (n, i) => i < n - 1 ? null : c.slice(i - n + 1, i + 1).reduce((s, x) => s + x, 0) / n;
  const start = Math.max(0, all.length - days); const B = all.slice(start);
  const series = B.map((b, k) => { const i = start + k; return {t: b.t, c: b.c, v: b.v, m20: sma(20, i), m50: sma(50, i), m200: sma(200, i)}; });
  const pm = run?.pm || {}, chartD = run?.reports?.chart?.data || {};
  const levels = [];
  if (U.isNum(pm.stop?.price)) levels.push({y: pm.stop.price, label: "Stop", cls: "lv-stop"});
  (pm.targets || []).forEach((t, i) => U.isNum(t.price) && levels.push({y: t.price, label: "T" + (i + 1), cls: "lv-target"}));
  const zone = (pm.tranches || []).filter(t => U.isNum(t.low));
  const fib = fs.tech?.fib?.levels || [];
  const W = 1180, H = 380, padL = 8, padR = 70, padT = 14, volH = 54, plotH = H - padT - volH - 24;
  let lo = Math.min(...series.map(s => Math.min(s.c, s.m200 ?? s.c))), hi = Math.max(...series.map(s => Math.max(s.c, s.m200 ?? s.c)));
  levels.forEach(l => { if (l.y > lo * 0.6 && l.y < hi * 1.6) { lo = Math.min(lo, l.y); hi = Math.max(hi, l.y); } });
  const padY = (hi - lo) * 0.06; lo -= padY; hi += padY;
  const x = i => padL + i / (series.length - 1) * (W - padL - padR), y = v => padT + (hi - v) / (hi - lo) * plotH;
  const path = key => { let d = "", on = false; series.forEach((s, i) => { const v = s[key]; if (v == null) { on = false; return; } d += (on ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); on = true; }); return d; };
  const vmax = Math.max(...series.map(s => s.v)) || 1, bw = Math.max(1, (W - padL - padR) / series.length - 1);
  const ticks = 4, grid = Array.from({length: ticks + 1}, (_, k) => lo + (hi - lo) * k / ticks);
  const lastS = series[series.length - 1];
  const labelAt = (key, txt, cls) => lastS[key] != null ? `<text class="${cls}" x="${W - padR + 6}" y="${y(lastS[key]) + 4}">${txt}</text>` : "";
  const months = []; series.forEach((s, i) => { if (i && s.t.slice(5, 7) !== series[i - 1].t.slice(5, 7) && (+s.t.slice(5, 7) - 1) % (days > 300 ? 3 : 1) === 0) months.push(i); });
  el.innerHTML = `<div class="chart-head"><div class="legend"><span><i style="background:var(--fg)"></i>Close</span><span><i style="background:var(--s1)"></i>MA20</span><span><i style="background:var(--s2)"></i>MA50</span><span><i style="background:var(--s3)"></i>MA200</span>${zone.length ? '<span><i class="zone"></i>Entry tranches</span>' : ""}</div>
    <div class="seg" role="group" aria-label="Range">${["6M", "1Y", "2Y"].map(r => `<button type="button" data-range="${r}" aria-pressed="${(range || "1Y") === r}">${r}</button>`).join("")}</div></div>
  <div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" class="pchart" role="img" aria-label="${esc(fs.ticker)} price chart with moving averages and trade levels">
    ${grid.map(g => `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(g)}" y2="${y(g)}"/><text class="axis" x="${W - padR + 6}" y="${y(g) + 4}">${n2(g)}</text>`).join("")}
    ${months.map(i => `<text class="axis" x="${x(i)}" y="${H - 4}" text-anchor="middle">${series[i].t.slice(2, 7)}</text>`).join("")}
    ${zone.map(t => { const a = y(Math.max(t.low, t.high || t.low)), b = y(Math.min(t.low, t.high || t.low)); return `<rect class="zone" x="${padL}" width="${W - padL - padR}" y="${a - 1}" height="${Math.max(2, b - a + 2)}"/>`; }).join("")}
    ${(() => { let lastY = -99; return fib.filter(f => f.price > lo && f.price < hi).sort((a, b) => b.price - a.price).map(f => { const yy = y(f.price); const lab = yy - lastY > 13; if (lab) lastY = yy; return `<line class="fib" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/>${lab ? `<text class="fibt" x="${padL + 4}" y="${yy - 3}">fib ${(f.level * 100).toFixed(1)}%</text>` : ""}`; }).join(""); })()}
    ${levels.filter(l => l.y > lo && l.y < hi).map(l => `<line class="${l.cls}" x1="${padL}" x2="${W - padR}" y1="${y(l.y)}" y2="${y(l.y)}"/><text class="${l.cls}-t" x="${W - padR - 4}" y="${y(l.y) - 4}" text-anchor="end">${l.label} ${n2(l.y)}</text>`).join("")}
    ${series.map((s, i) => `<rect class="vol" x="${x(i) - bw / 2}" y="${H - 22 - s.v / vmax * volH}" width="${bw}" height="${s.v / vmax * volH}"/>`).join("")}
    <path class="l-m200" d="${path("m200")}"/><path class="l-m50" d="${path("m50")}"/><path class="l-m20" d="${path("m20")}"/><path class="l-px" d="${path("c")}"/>
    <circle class="endpt" cx="${x(series.length - 1)}" cy="${y(lastS.c)}" r="4"/>
    ${labelAt("m200", "MA200", "dl s3")}
    <line class="xh" id="xh" x1="0" x2="0" y1="${padT}" y2="${H - 22}" visibility="hidden"/>
    <rect class="hit" x="${padL}" y="0" width="${W - padL - padR}" height="${H}"/>
  </svg><div class="tip" id="ptip" hidden></div></div>`;
  const svg = el.querySelector("svg"), tip = el.querySelector("#ptip"), xh = el.querySelector("#xh");
  const move = ev => {
    const r = svg.getBoundingClientRect(); const px = (ev.clientX - r.left) / r.width * W;
    const i = U.clamp(Math.round((px - padL) / (W - padL - padR) * (series.length - 1)), 0, series.length - 1); const s = series[i];
    xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.setAttribute("visibility", "visible");
    tip.hidden = false; tip.innerHTML = `<b>${s.t}</b><br>Close ${n2(s.c)}<br>MA20 ${n2(s.m20)} · MA50 ${n2(s.m50)} · MA200 ${n2(s.m200)}<br>Vol ${U.fmtNum(s.v, 0)}`;
    const left = x(i) / W * r.width; tip.style.left = Math.min(r.width - 190, Math.max(0, left + 12)) + "px"; tip.style.top = "8px";
  };
  const hit = el.querySelector(".hit");
  hit.addEventListener("pointermove", move); hit.addEventListener("pointerleave", () => { tip.hidden = true; xh.setAttribute("visibility", "hidden"); });
  el.querySelectorAll("[data-range]").forEach(b => b.onclick = () => { S.chartRange = b.dataset.range; Charts.price(el, fs, run, b.dataset.range); });
};

/* Scenario range strip: bear/base/bull values sized by probability, current price and EV markers */
Charts.scenarios = function (evm, price) {
  if (!evm || !evm.scenarios.length) return "";
  const vals = evm.scenarios.map(s => s.price).concat([price, evm.ev]);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.12 || hi * 0.1; lo -= pad; hi += pad;
  const W = 520, H = 112, x = v => 14 + (v - lo) / (hi - lo) * (W - 28);
  const col = n => n === "bear" ? "var(--bad)" : n === "bull" ? "var(--good)" : "var(--accent)";
  return `<svg viewBox="0 0 ${W} ${H}" class="schart" role="img" aria-label="Scenario values versus current price">
    <line class="axisl" x1="14" x2="${W - 14}" y1="62" y2="62"/>
    <line class="cur" x1="${x(price)}" x2="${x(price)}" y1="18" y2="96"/><text class="curt" x="${x(price)}" y="12" text-anchor="middle">Now ${n2(price)}</text>
    ${evm.scenarios.map(s => `<circle cx="${x(s.price)}" cy="62" r="${6 + 14 * s.p}" fill="${col(s.name)}" fill-opacity=".85" stroke="var(--panel)" stroke-width="2"><title>${esc(s.name)} ${n2(s.price)} · p=${(s.p * 100).toFixed(0)}%</title></circle>
      <text class="st" x="${x(s.price)}" y="${s.name === "base" ? 104 : 104}" text-anchor="middle">${esc(s.name)} ${n2(s.price)} · ${(s.p * 100).toFixed(0)}%</text>`).join("")}
    <path d="M${x(evm.ev)} 40 l6 8 l-6 8 l-6 -8z" class="evm"/><text class="evt" x="${x(evm.ev)}" y="34" text-anchor="middle">EV ${n2(evm.ev)}</text>
  </svg>`;
};

/* Calibration: average excess return by score bucket (diverging around zero) */
Charts.buckets = function (buckets) {
  const b = buckets.filter(x => x.n);
  if (!b.length) return `<p class="muted">No matured calls yet.</p>`;
  const m = Math.max(0.05, ...b.map(x => Math.abs(x.avgExcess || 0)));
  const W = 520, H = 190, mid = 95, bwid = 70, gap = (W - 40 - b.length * bwid) / Math.max(1, b.length - 1);
  return `<svg viewBox="0 0 ${W} ${H}" class="bchart" role="img" aria-label="Average excess return by score bucket">
    <line class="axisl" x1="10" x2="${W - 10}" y1="${mid}" y2="${mid}"/>
    ${b.map((x, i) => { const v = x.avgExcess || 0, h = Math.abs(v) / m * 70, X = 20 + i * (bwid + gap);
      return `<rect x="${X}" y="${v >= 0 ? mid - h : mid}" width="${bwid}" height="${Math.max(2, h)}" rx="3" fill="${v >= 0 ? "var(--good)" : "var(--bad)"}"><title>${x.label}: ${spct(v)} (n=${x.n})</title></rect>
      <text class="bt" x="${X + bwid / 2}" y="${v >= 0 ? mid - h - 6 : mid + h + 14}" text-anchor="middle">${spct(v)}</text>
      <text class="axis" x="${X + bwid / 2}" y="${H - 4}" text-anchor="middle">score ${x.label} · n=${x.n}</text>`; }).join("")}
  </svg>`;
};
Charts.spark = function (vals, w = 90, h = 22) {
  const v = vals.filter(U.isNum); if (v.length < 2) return "";
  const lo = Math.min(...v), hi = Math.max(...v), x = i => i / (v.length - 1) * (w - 4) + 2, y = a => h - 2 - (a - lo) / ((hi - lo) || 1) * (h - 4);
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" width="${w}" height="${h}" aria-hidden="true"><path d="${v.map((a, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(a).toFixed(1)).join("")}"/><circle cx="${x(v.length - 1)}" cy="${y(v[v.length - 1])}" r="2.5"/></svg>`;
};
