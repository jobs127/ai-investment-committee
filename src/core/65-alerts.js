/* AI Stock Alert System — core (DOM-free; runs in the browser and in the GitHub runner).
   A "sweep" checks a list of tickers for anything new since the last look:
     stage 0  free, computed in code: SEC filings (8-K items, Form 4, 144, 13D/G, offerings, late filings) and price/volume/calendar
     stage 1  the Keyword Finder: AI works out the names, people, products and places to search for (kept 30 days)
     stage 2  web sentinels (each searches one kind of source)
     stage 3  the Alert Desk: removes duplicates, scores importance, checks your thesis, writes the headline
   It reuses the committee engine: the same plans (Saver = Batch API), prompt caching and cost accounting. */
(function (G) {
"use strict";
const AIC = G.AIC, U = AIC.util, E = AIC.engine, PL = AIC.pipeline, S = AIC.S;
const AL = AIC.alerts = {};
const isN = U.isNum;

AL.SENTINELS = [
  {id: "sec",     code: "SEC", name: "SEC Filings",          stage: 0, free: true, color: "var(--c-desk)",     blurb: "8-Ks, insider buys & sales, 144s, 13D/G stakes, offerings, late filings"},
  {id: "tape",    code: "PX",  name: "Price & Calendar",     stage: 0, free: true, color: "var(--c-chart)",    blurb: "Big moves, unusual volume, 52-week extremes, your price levels, earnings dates"},
  {id: "feeds",   code: "FD",  name: "Direct Feeds",         stage: 0, free: true, color: "var(--c-sent)",     blurb: "StockTwits, Reddit, YouTube, podcasts, Google News, SEC full-text — and measured buzz"},
  {id: "keys",    code: "KW",  name: "Keyword Finder",       stage: 1, color: "var(--c-member)",   blurb: "Works out what to search for: company names, people, products, places, customers, rivals"},
  {id: "news",    code: "NW",  name: "News & Trade Press",   stage: 2, search: 4, cadence: "daily",  color: "var(--c-scout)",    blurb: "Company news, deals, contracts, lawsuits, accidents, trade publications"},
  {id: "press",   code: "NP",  name: "Newspapers",           stage: 2, search: 3, cadence: "daily",  color: "var(--c-historian)", blurb: "National papers and local papers where the company operates"},
  {id: "analyst", code: "AN",  name: "Analyst Changes",      stage: 2, search: 3, cadence: "daily",  color: "var(--c-hunter)",   blurb: "Upgrades, downgrades, initiations, price targets, estimate revisions"},
  {id: "social",  code: "SO",  name: "Social Chatter",       stage: 2, search: 4, cadence: "daily",  color: "var(--c-sent)",     blurb: "Reddit, StockTwits, X, forums, blogs, Seeking Alpha — what people are saying"},
  {id: "pods",    code: "PC",  name: "Podcasts & Interviews", stage: 2, search: 3, cadence: "weekly", color: "var(--c-expect)",   blurb: "Management on podcasts, conference talks, episodes about the stock"},
  {id: "regs",    code: "RG",  name: "Regulators & Courts",  stage: 2, search: 3, cadence: "weekly", color: "var(--c-forensic)", blurb: "Permits, agency actions, lawsuits, government contracts"},
  {id: "peers",   code: "PR",  name: "Customers & Rivals",   stage: 2, search: 3, cadence: "weekly", color: "var(--c-industry)", blurb: "Read-through from customers, competitors and suppliers"},
  {id: "shorts",  code: "SH",  name: "Shorts & Ownership",   stage: 2, search: 3, cadence: "weekly", color: "var(--c-bear)",     blurb: "Short reports, short interest, big holders, index changes, credit ratings"},
  {id: "desk",    code: "AD",  name: "Alert Desk",           stage: 3, color: "var(--c-cio)",      blurb: "Removes duplicates, ranks what matters, checks your thesis"}
];
AL.sentinel = id => AL.SENTINELS.find(s => s.id === id);
AL.WEB = AL.SENTINELS.filter(s => s.stage === 2).map(s => s.id);
AL.KEYWORD_DAYS = 30;

AL.PLAN_TEXT = {
  saver:    {short: "cheapest · ready within about an hour", note: "Anthropic's Batch API (half price). Sentinels on Haiku 4.5, Alert Desk on Sonnet 5.5."},
  balanced: {short: "cheap · results in minutes",            note: "Same models as Saver, answered immediately."},
  max:      {short: "best models · results in minutes",      note: "Sentinels on Sonnet 5.5, Alert Desk on Opus 5.5."}
};
AL.URGENT_RULES = {
  thesis: "High importance (4–5) or anything that hits your thesis",
  high:   "High importance only (4–5)",
  medium: "Medium and above (3–5)"
};
AL.DEFAULT_BLOCKED = ["reddit.com", "stocktwits.com", "x.com", "twitter.com", "facebook.com", "tiktok.com", "instagram.com", "discord.com", "investorshub.advfn.com", "4chan.org", "quora.com", "medium.com", "threads.net"];
AL.DEFAULTS = {plan: "saver", searchDepth: 1, reputableOnly: false, urgentRule: "thesis", blocked: AL.DEFAULT_BLOCKED.join(", ")};

const ITEM = S.obj({
  title: S.str("Headline in your own words, max 14 words"),
  summary: S.str("What happened, max 40 words, with the key number"),
  url: S.str("Link to the source (required)"),
  source: S.str("Publisher or platform, e.g. Reuters, r/stocks, StockTwits"),
  date: S.str("Publication date YYYY-MM-DD"),
  kind: S.str("Short type, e.g. contract, lawsuit, upgrade, price target, podcast, permit, short report"),
  sentiment: S.enm(["positive", "negative", "neutral", "mixed"], "For the stock"),
  importance: S.int10("How much this could matter for the stock: 1 trivia … 5 thesis-changing (use 1–5 only)"),
  reputable: {type: "boolean", description: "false for anonymous posts, forums, unverified social media"}
});
AIC.SCHEMAS.al_keys = {bare: true, score: null, extra: {
  company_name: S.str("The company's usual name, e.g. Select Water Solutions"),
  aliases: S.arr(S.str(""), "Other names it goes by: legal name, short name, former names, common abbreviations", 6),
  people: S.arr(S.obj({name: S.str(""), role: S.str("")}), "CEO, CFO, chair, founders and other executives often in the news", 8),
  products: S.arr(S.str(""), "Brands, products, services, projects and key assets", 10),
  subsidiaries: S.arr(S.str(""), "Subsidiaries, joint ventures and recently acquired companies", 8),
  places: S.arr(S.str(""), "Where it operates: basins, counties, states, cities, facilities", 10),
  customers: S.arr(S.str(""), "Main customers", 8),
  competitors: S.arr(S.str(""), "Main competitors", 8),
  industry_terms: S.arr(S.str(""), "Industry words that bring up news relevant to this company", 10),
  avoid: S.arr(S.str(""), "Things with similar names or tickers to ignore (to avoid false matches)", 6)
}};
for (const s of AL.SENTINELS.filter(x => x.stage === 2)) AIC.SCHEMAS["al_" + s.id] = {bare: true, score: null, extra: {
  nothing_new: {type: "boolean", description: "true if you found nothing new in the window"},
  items: S.arr(ITEM, "New items, most important first (max 8)", 8),
  ...(s.id === "social" ? {buzz: S.enm(["quiet", "normal", "elevated", "spiking"], "Volume of chatter vs normal"), tone: S.enm(["bullish", "bearish", "mixed", "neutral"], "Overall tone")} : {})
}};
AIC.SCHEMAS.al_desk = {bare: true, score: null, extra: {
  headline: S.str("One sentence: what changed for this stock since the last look (or 'Quiet — nothing material')"),
  mood: S.enm(["positive", "negative", "mixed", "quiet"], "Overall"),
  items: S.arr(S.obj({
    ref: S.num("Number of the candidate this is about"),
    also: S.arr(S.num(""), "Numbers of duplicate candidates about the same event", 8),
    title: S.str("Clean headline, max 14 words"),
    why: S.str("Why it matters for an owner of this stock, max 30 words"),
    importance: S.num("1 trivia, 2 minor, 3 notable, 4 important, 5 thesis-changing"),
    thesis_hit: S.str("If it bears on a thesis line or monitoring item, quote which; else empty"),
    novelty: S.enm(["new", "update", "repeat"], "repeat = already in the 'already reported' list"),
    sentiment: S.enm(["positive", "negative", "neutral", "mixed"], "")
  }), "Every candidate worth keeping, most important first; leave out noise and repeats", 25)
}};

/* ---------------- free, code-only sentinels ---------------- */
const ITEMS_8K = {"1.01": [3, "Material agreement"], "1.02": [3, "Agreement terminated"], "1.03": [5, "Bankruptcy or receivership"], "1.05": [4, "Cybersecurity incident"],
  "2.01": [4, "Acquisition or disposal completed"], "2.02": [3, "Results announced"], "2.03": [3, "New debt obligation"], "2.04": [5, "Debt acceleration trigger"], "2.05": [4, "Restructuring / exit costs"],
  "2.06": [4, "Material impairment"], "3.01": [5, "Delisting notice"], "3.02": [3, "Unregistered share sale"], "3.03": [3, "Shareholder rights changed"], "4.01": [4, "Auditor change"],
  "4.02": [5, "Past financials can no longer be relied on"], "5.01": [5, "Change in control"], "5.02": [4, "Director or officer change"], "5.03": [2, "Bylaws amended"], "5.07": [2, "Shareholder vote results"],
  "7.01": [2, "Reg FD disclosure"], "8.01": [2, "Other event"]};
function formRule(f) {
  const t = f.form.toUpperCase();
  if (t === "8-K" || t === "8-K/A") {
    const its = String(f.items || "").split(",").map(x => x.trim()).filter(x => ITEMS_8K[x]);
    if (!its.length) return null;
    const top = Math.max(...its.map(x => ITEMS_8K[x][0]));
    return [top, "8-K: " + its.map(x => ITEMS_8K[x][1]).join("; "), "filing"];
  }
  if (/^NT 10-[KQ]/.test(t)) return [5, `${t}: late filing notice`, "red flag"];
  if (/13D/.test(t)) return [/\/A/.test(t) ? 3 : 4, `${t}: a holder above 5% with intent to influence${/\/A/.test(t) ? " (amended)" : ""}`, "ownership"];
  if (/13G/.test(t)) return [/\/A/.test(t) ? 2 : 3, `${t}: passive holder above 5%${/\/A/.test(t) ? " (amended)" : ""}`, "ownership"];
  if (/^(S-1|S-3|S-3ASR|F-3)$/.test(t)) return [3, `${t}: registration for new securities (possible dilution)`, "offering"];
  if (/^424B[1-5]/.test(t)) return [/424B[45]/.test(t) ? 4 : 3, `${t}: prospectus — an offering is happening`, "offering"];
  if (t === "144") return [2, "Form 144: an insider plans to sell", "insider"];
  if (/^(SC TO-T|SC 14D9|SC TO-I|425|DEFM14A|PREM14A)$/.test(t)) return [5, `${t}: tender offer or merger document`, "deal"];
  if (/^(15-12B|15-12G|25-NSE|25)$/.test(t)) return [5, `${t}: deregistration or delisting`, "red flag"];
  if (/^(10-K|10-Q|20-F|40-F)$/.test(t)) return [2, `${t} filed`, "report"];
  if (/^(DEF 14A|DEFA14A|DFAN14A|PRRN14A)$/.test(t)) return [/DFAN|PRRN/.test(t) ? 4 : 1, t === "DFAN14A" ? "Dissident proxy material (proxy fight)" : `${t}: proxy statement`, "governance"];
  return null;
}
AL.scanSec = async function (ticker, since, {signal} = {}) {
  const D = AIC.data; if (!D.available()) return {status: "offline", items: [], note: "No data gateway — SEC filings skipped."};
  const cik = await D.cikFor(ticker); if (!cik) return {status: "done", items: [], note: "Not an SEC filer (non-US or fund) — skipped."};
  const sub = await D.submissions(cik); const all = D.recentFilings(sub).filter(f => f.date >= since);
  const items = [];
  for (const f of all) {
    if (f.form === "4") continue;
    const r = formRule(f); if (!r) continue;
    items.push({key: "sec:" + f.acc, seat: "sec", title: r[1], summary: `${f.form} filed ${f.date}${f.desc ? " — " + f.desc : ""}`, url: D.archiveUrl(cik, f.acc, f.doc.replace(/^xsl[^/]*\//i, "")), source: "SEC EDGAR", date: f.date, kind: r[2], importance: r[0], reputable: true, sentiment: r[0] >= 5 ? "negative" : "neutral"});
  }
  const f4 = all.filter(f => f.form === "4");
  if (f4.length) {
    const docs = await D.form4s(cik, f4, 25, signal);
    for (const d of docs) {
      const buys = d.tx.filter(t => t.code === "P"), sells = d.tx.filter(t => t.code === "S");
      const val = a => a.reduce((s, t) => s + t.shares * t.price, 0);
      if (buys.length) { const v = val(buys); items.push({key: `f4:${d.filed}:${d.owner}:P`, seat: "sec", title: `Insider BUY: ${d.owner} (${d.role}) bought $${U.fmtNum(v, 0)}`, summary: `${U.fmtNum(buys.reduce((s, t) => s + t.shares, 0), 0)} shares at about $${(v / Math.max(1, buys.reduce((s, t) => s + t.shares, 0))).toFixed(2)} on ${buys[0].date}${d.plan ? " (10b5-1 plan)" : ""}.`, url: "", source: "SEC Form 4", date: d.filed, kind: "insider buy", importance: d.plan ? 3 : (v >= 100000 && d.role !== "Other" ? 4 : 3), reputable: true, sentiment: "positive"}); }
      if (sells.length) { const v = val(sells); items.push({key: `f4:${d.filed}:${d.owner}:S`, seat: "sec", title: `Insider sale: ${d.owner} (${d.role}) sold $${U.fmtNum(v, 0)}`, summary: `${U.fmtNum(sells.reduce((s, t) => s + t.shares, 0), 0)} shares on ${sells[0].date}${d.plan ? " under a 10b5-1 plan" : ""}${isN(sells[sells.length - 1].after) ? `; still owns ${U.fmtNum(sells[sells.length - 1].after, 0)}` : ""}.`, url: "", source: "SEC Form 4", date: d.filed, kind: "insider sale", importance: !d.plan && v >= 1e6 ? 3 : 2, reputable: true, sentiment: "negative"}); }
    }
  }
  const earnings = D.recentFilings(sub).filter(f => /^8-K/.test(f.form) && /2\.02/.test(f.items || "")).map(f => f.date);
  return {status: "done", items, name: sub.name || "", cik, earnings, note: `${all.length} filing${all.length === 1 ? "" : "s"} since ${since}`};
};
AL.scanTape = async function (ticker, since, ctx = {}, {signal} = {}) {
  const D = AIC.data; if (!D.available()) return {status: "offline", items: [], note: "No data gateway — price checks skipped."};
  const p = await D.prices(ticker, "1y", signal); const b = p.bars; if (!b || b.length < 30) return {status: "done", items: [], note: "Not enough price history."};
  const items = [], last = b[b.length - 1], key = k => `px:${last.t}:${k}`;
  const recent = b.filter(x => x.t > since); const win = recent.length ? recent : [last];
  const first = b[b.length - 1 - win.length] || b[0];
  const chg = last.c / first.c - 1;
  const one = last.c / b[b.length - 2].c - 1;
  const add = (k, imp, title, summary, sentiment) => items.push({key: key(k), seat: "tape", title, summary, url: `https://finance.yahoo.com/quote/${D.yahooSymbol(ticker)}`, source: "Price data", date: last.t, kind: "price", importance: imp, reputable: true, sentiment});
  const a = Math.abs(one);
  if (a >= 0.05) add("move", a >= 0.15 ? 5 : a >= 0.08 ? 4 : 3, `${one > 0 ? "Up" : "Down"} ${(a * 100).toFixed(1)}% on ${last.t}`, `Closed at $${last.c.toFixed(2)}${win.length > 1 ? `; ${U.pct(chg)} since ${since}` : ""}.`, one > 0 ? "positive" : "negative");
  else if (win.length > 1 && Math.abs(chg) >= 0.1) add("drift", Math.abs(chg) >= 0.2 ? 4 : 3, `${chg > 0 ? "Up" : "Down"} ${(Math.abs(chg) * 100).toFixed(1)}% since ${since}`, `Now $${last.c.toFixed(2)}.`, chg > 0 ? "positive" : "negative");
  const v20 = U.mean(b.slice(-21, -1).map(x => x.v));
  if (v20 && last.v / v20 >= 2.5) add("vol", last.v / v20 >= 5 ? 4 : 3, `Unusual volume: ${(last.v / v20).toFixed(1)}× the 20-day average`, `${U.fmtNum(last.v, 0)} shares traded on ${last.t}.`, "neutral");
  const prev = b.slice(-253, -1); const hi = Math.max(...prev.map(x => x.h)), lo = Math.min(...prev.map(x => x.l));
  if (last.h > hi) add("hi", 3, "New 52-week high", `Traded at $${last.h.toFixed(2)}; previous high $${hi.toFixed(2)}.`, "positive");
  if (last.l < lo) add("lo", 3, "New 52-week low", `Traded at $${last.l.toFixed(2)}; previous low $${lo.toFixed(2)}.`, "negative");
  const below = U.num(ctx.below), above = U.num(ctx.above);
  if (isN(below) && last.c <= below) add("below", 4, `Price at or below your $${below} level`, `Closed at $${last.c.toFixed(2)}.`, "negative");
  if (isN(above) && last.c >= above) add("above", 4, `Price at or above your $${above} level`, `Closed at $${last.c.toFixed(2)}.`, "positive");
  // earnings date estimate: last results 8-K + ~91 days
  const e = (ctx.earnings || [])[0];
  if (e) { const next = U.addDays(e, 91), days = U.daysBetween(U.today(), next);
    if (days >= -3 && days <= 10) items.push({key: "cal:earn:" + next.slice(0, 7), seat: "tape", title: `Earnings expected around ${next}`, summary: `Based on the last results filing (${e}). Check the company's investor-relations page for the exact date.`, url: "", source: "Calendar estimate", date: U.today(), kind: "calendar", importance: 2, reputable: true, sentiment: "neutral"}); }
  return {status: "done", items, price: last.c, note: `$${last.c.toFixed(2)} on ${last.t}`};
};

/* ---------------- direct feeds (free): read the platforms' own data instead of hoping web search finds them ---------------- */
const shortName = n => String(n || "").replace(/,?\s+(Inc|Incorporated|Corp|Corporation|Co|Company|Ltd|Limited|plc|LLC|L\.P\.|LP|Holdings?|Group)\.?$/i, "").replace(/,?\s+(Inc|Corp)\.?$/i, "").trim();
const clip = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const median = a => { a = a.filter(isN).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");
AL.FEED_SOURCES = {stocktwits: "StockTwits", reddit: "Reddit", youtube: "YouTube", podcasts: "Podcasts (Apple)", gnews: "Google News", secfts: "SEC full-text search", wiki: "Wikipedia views"};
AL.scanFeeds = async function (ticker, since, c = {}, {signal} = {}) {
  const D = AIC.data;
  if (!D.available()) return {status: "offline", items: [], feed: {}, notes: {}, note: "No data gateway — direct feeds skipped."};
  const name = shortName(c.name || c.keywords?.company_name || ""), T = U.normTicker(ticker), sinceMs = Date.parse(since + "T00:00:00Z") || Date.now() - 7 * 864e5;
  const q = name ? `"${name}"` : T, feed = {}, notes = {}, wk = Date.now() - 7 * 864e5;
  const run = async (key, fn) => { try { feed[key] = await fn(); notes[key] = `${feed[key].length} new`; } catch (e) { feed[key] = []; notes[key] = e.code === "not_setup" ? "not set up" : "unavailable (" + String(e.message).slice(0, 60) + ")"; } };
  const buzz = {date: U.today()};
  await Promise.all([
    run("stocktwits", async () => {
      const j = await D.get(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(T)}.json`, {type: "json", signal});
      const msgs = (j.messages || []).map(m => ({src: "stocktwits", id: m.id, title: clip(m.body, 280), url: `https://stocktwits.com/${m.user?.username}/message/${m.id}`, date: m.created_at, author: m.user?.username, sentiment: m.entities?.sentiment?.basic || "", score: m.likes?.total || 0}));
      const day = msgs.filter(m => Date.parse(m.date) > Date.now() - 864e5);
      buzz.st24 = day.length; buzz.stCapped = day.length >= msgs.length && msgs.length >= 30;
      if (buzz.stCapped) { const ts = msgs.map(m => Date.parse(m.date)), span = (Math.max(...ts) - Math.min(...ts)) / 3600e3; buzz.st24 = Math.round(msgs.length * 24 / Math.max(span, 0.5)); } // busy: estimate the daily rate buzz.stFollowers = j.symbol?.watchlist_count ?? null;
      buzz.stBull = day.filter(m => m.sentiment === "Bullish").length; buzz.stBear = day.filter(m => m.sentiment === "Bearish").length;
      return msgs.filter(m => Date.parse(m.date) >= sinceMs).slice(0, 30);
    }),
    run("reddit", async () => {
      const terms = [name ? `"${name}"` : "", `"$${T}"`, T.length > 2 ? `"${T}"` : ""].filter(Boolean).join(" OR ");
      const j = await D.gatewayRoute("/reddit", {q: terms, t: "month"}, {signal});
      const posts = (j.posts || []).map(p => ({src: "reddit", id: p.id, title: clip(p.title, 200), text: clip(p.text, 300), url: p.url, date: new Date(p.created * 1000).toISOString(), author: "r/" + p.sub, score: p.score, comments: p.comments}));
      buzz.reddit7 = posts.filter(p => Date.parse(p.date) > wk).length;
      return posts.filter(p => Date.parse(p.date) >= sinceMs).slice(0, 30);
    }),
    run("youtube", async () => {
      const j = await D.gatewayRoute("/youtube", {q: name ? `"${name}" | ${T} stock` : `${T} stock`, after: new Date(Math.min(sinceMs, Date.now() - 864e5)).toISOString()}, {signal});
      const v = (j.videos || []).map(x => ({src: "youtube", id: x.id, title: clip(x.title, 200), text: clip(x.text, 200), url: x.url, date: x.published, author: x.channel}));
      buzz.yt7 = v.filter(x => Date.parse(x.date) > wk).length; return v.slice(0, 20);
    }),
    run("podcasts", async () => {
      const who = [name || T].concat((c.keywords?.people || []).slice(0, 1).map(p => typeof p === "string" ? p : p.name)).filter(Boolean);
      const out = [];
      for (const term of who) {
        const j = await D.get(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=podcastEpisode&limit=25`, {type: "json", signal});
        (j.results || []).forEach(e => out.push({src: "podcasts", id: e.trackId, title: clip(e.trackName, 200), text: clip(e.shortDescription || e.description, 240), url: e.trackViewUrl, date: e.releaseDate, author: e.collectionName}));
      }
      const win = Math.min(sinceMs, Date.now() - 21 * 864e5); // podcasts: look back three weeks
      return [...new Map(out.map(x => [x.id, x])).values()].filter(x => Date.parse(x.date) >= win).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 15);
    }),
    run("gnews", async () => {
      const xml = await D.get(`https://news.google.com/rss/search?q=${encodeURIComponent(`${q} OR "${T}" when:7d`)}&hl=en-US&gl=US&ceid=US:en`, {signal});
      const items = U.xmlAll(xml, "item").map(it => ({src: "gnews", title: clip(U.xmlOne(it, "title").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'), 200), url: U.xmlOne(it, "link").trim(), date: new Date(U.xmlOne(it, "pubDate")).toISOString(), author: U.xmlOne(it, "source").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")}));
      buzz.news7 = items.length; return items.filter(x => Date.parse(x.date) >= sinceMs).slice(0, 30);
    }),
    run("secfts", async () => {
      if (!name) return [];
      const j = await D.get(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"' + name + '"')}&dateRange=custom&startdt=${since}&enddt=${U.today()}`, {type: "json", signal});
      const own = String(c.cik || "").replace(/^0+/, "");
      return (j.hits?.hits || []).map(h => { const s = h._source || {}, [adsh, file] = String(h._id || "").split(":"), cik = String((s.ciks || [])[0] || "").replace(/^0+/, "");
        return {src: "secfts", id: h._id, title: clip(`${(s.display_names || [])[0] || "A filer"} mentions ${name} in a ${s.form || s.file_type || "filing"}`, 200), url: cik && adsh ? `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, "")}/${file || ""}` : "", date: s.file_date, author: (s.display_names || [])[0] || "", cik}; })
        .filter(x => x.cik && x.cik !== own).slice(0, 15);
    }),
    run("wiki", async () => {
      if (!name) return [];
      let title = c.wikiTitle;
      if (!title) { const j = await D.get(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=1`, {type: "json", signal});
        const t = j.query?.search?.[0]?.title || ""; if (!t || !t.toLowerCase().includes(name.toLowerCase().split(" ")[0])) throw new Error("no matching article"); title = t; }
      buzz.wikiTitle = title;
      const end = new Date(Date.now() - 864e5), start = new Date(Date.now() - 61 * 864e5);
      const j = await D.get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g, "_"))}/daily/${ymd(start)}/${ymd(end)}`, {type: "json", signal});
      const v = (j.items || []).map(x => x.views); if (v.length < 10) throw new Error("too little history");
      buzz.wikiLast = v[v.length - 1]; buzz.wikiMed = median(v.slice(-31, -1)); buzz.wikiSeries = v.slice(-30);
      return [];
    })
  ]);
  // measured buzz: compare with this ticker's own normal (needs a few days of history, except Wikipedia which has 60 days)
  const hist = (c.buzzHist || []).filter(h => h.date !== buzz.date);
  const spikes = [], ratio = (now, base) => isN(now) && isN(base) && base > 0 ? now / base : null;
  const check = (k, label, min, mult) => { const base = median(hist.map(h => h[k])); const r = ratio(buzz[k], base); buzz[k + "Base"] = base;
    if (hist.filter(h => isN(h[k])).length >= 5 && isN(buzz[k]) && buzz[k] >= min && r >= mult) spikes.push({k, label, now: buzz[k], base, r}); };
  check("st24", "StockTwits messages (24 h)", 10, 3); check("reddit7", "Reddit posts (7 days)", 5, 3); check("news7", "news articles (7 days)", 8, 2.5); check("yt7", "YouTube videos (7 days)", 4, 3);
  if (isN(buzz.wikiLast) && isN(buzz.wikiMed) && buzz.wikiLast >= 200 && buzz.wikiLast / Math.max(1, buzz.wikiMed) >= 3) spikes.push({k: "wiki", label: "Wikipedia views (yesterday)", now: buzz.wikiLast, base: buzz.wikiMed, r: buzz.wikiLast / Math.max(1, buzz.wikiMed)});
  const rs = [ratio(buzz.st24, buzz.st24Base), ratio(buzz.reddit7, buzz.reddit7Base), ratio(buzz.news7, buzz.news7Base), isN(buzz.wikiLast) && buzz.wikiMed ? buzz.wikiLast / buzz.wikiMed : null].filter(isN);
  buzz.level = spikes.length ? "spiking" : rs.some(r => r >= 1.8) ? "elevated" : rs.length && rs.every(r => r < 0.6) ? "quiet" : rs.length ? "normal" : null;
  buzz.baselineDays = hist.length; buzz.spikes = spikes;
  const items = spikes.map(sp => ({key: `buzz:${buzz.date}:${sp.k}`, seat: "feeds", title: `Chatter spike: ${sp.label} ${sp.r.toFixed(1)}× normal`, summary: `${Math.round(sp.now)} vs a usual ${Math.round(sp.base)}. Something is getting attention — check what people are reacting to.`, url: sp.k === "st24" ? `https://stocktwits.com/symbol/${T}` : sp.k === "wiki" && buzz.wikiTitle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(buzz.wikiTitle.replace(/ /g, "_"))}` : "", source: "Measured buzz", date: U.today(), kind: "buzz", importance: sp.r >= 6 ? 4 : 3, reputable: true, sentiment: "neutral"}));
  const total = Object.values(feed).reduce((a, x) => a + x.length, 0);
  return {status: "done", items, feed, notes, buzz, note: `${total} posts and articles collected${spikes.length ? " · " + spikes.length + " spike" + (spikes.length > 1 ? "s" : "") : ""}`};
};
AL.FEED_FOR = {social: ["stocktwits", "reddit", "youtube"], pods: ["podcasts", "youtube"], news: ["gnews"], press: ["gnews"], analyst: ["gnews"], peers: ["secfts"], shorts: ["gnews", "reddit"]};
AL.feedLines = function (sw, ticker, seatId) {
  const f = sw.reports[AL.rk(ticker, "feeds")]?.data?.feed || {}; const srcs = AL.FEED_FOR[seatId] || [];
  const cap = {stocktwits: 12, reddit: 12, youtube: 6, podcasts: 10, gnews: 20, secfts: 10};
  let rows = srcs.flatMap(k => (f[k] || []).slice(0, seatId === "analyst" || seatId === "shorts" ? 40 : cap[k] || 10));
  if (seatId === "analyst") rows = rows.filter(x => /upgrade|downgrade|price target|initiat|rating|analyst|outperform|underperform|overweight|underweight|buy rating|sell rating/i.test(x.title));
  if (seatId === "shorts") rows = rows.filter(x => /short|13F|stake|holder|index|S&P|Russell|rating|Moody|Fitch|debt|notes due/i.test(x.title + " " + (x.text || "")));
  return rows.slice(0, seatId === "social" ? 30 : 20).map(x => `- [${AL.FEED_SOURCES[x.src] || x.src}] ${String(x.date || "").slice(0, 10)} ${x.author ? x.author + ": " : ""}${x.title}${x.text ? " — " + clip(x.text, 160) : ""}${x.sentiment ? " (" + x.sentiment + ")" : ""}${isN(x.score) && x.src === "reddit" ? ` (${x.score} upvotes, ${x.comments} comments)` : ""} ${x.url || ""}`);
};

/* ---------------- prompts ---------------- */
AL.system = sw => `You are a sentinel in a personal stock alert system. Your job is to find what is NEW about a stock — not to analyze it.
Rules:
- Only report items published inside the window you are given. Older background does not count.
- Every item needs a working URL and a date. Never invent items, quotes, numbers or links. If you can't confirm something, leave it out.
- Prefer primary sources (company releases, filings, regulators, the outlet that broke the story) over re-writes.
- One item per event; if many outlets cover the same story, report it once and cite the best source.
- Be specific: who, what, how much, when.${sw.reputableOnly ? "\n- Use reputable, named sources only: established news outlets, company and government sources, named analysts. Ignore anonymous forums and social media." : "\n- Social media and forums are allowed; mark them reputable=false and say when a claim is unverified."}
- Write a short plain-English report (a few bullet points), then the JSON block. If there is nothing new, say so in one line and set nothing_new=true with an empty items list.`;

const TASKS = {
  news: c => `Search for news about ${c.who} published since ${c.since}: earnings and guidance, contracts and customer wins or losses, acquisitions, divestitures, financing, management changes, accidents, outages, lawsuits, layoffs, expansions, product launches, and industry trade-press coverage (for energy and water companies e.g. trade outlets covering oilfield services, produced water and midstream).`,
  press: c => `Search newspapers for ${c.who} since ${c.since}: national business papers (WSJ, FT, NYT, Bloomberg, Reuters, Barron's) and LOCAL papers in the places where the company operates or is headquartered — local papers often report plant openings, closures, layoffs, permits, accidents, lawsuits and community disputes first.`,
  analyst: c => `Search for sell-side analyst actions on ${c.who} since ${c.since}: upgrades, downgrades, initiations, price-target changes (old → new target and the firm), estimate revisions, and notable notes. Give the firm and analyst name when available.`,
  social: c => c.reputableOnly
    ? `Search for commentary on ${c.who} since ${c.since} from named, established sources only: Seeking Alpha articles by named authors, Morningstar, Barron's, well-known newsletters and named professional investors. Summarize the arguments and the overall tone. Note whether attention seems quiet, normal, elevated or spiking.`
    : `Search for what people are saying online about ${c.who} since ${c.since}: Reddit (r/stocks, r/investing, r/wallstreetbets, r/SecurityAnalysis and industry subreddits), StockTwits, X/Twitter, Seeking Alpha articles and comments, Yahoo Finance conversations, YouTube, forums and blogs. Report notable posts and claims (flag unverified ones), recurring arguments, whether chatter is quiet, normal, elevated or spiking versus usual, and the overall tone.`,
  pods: c => `Search for podcasts, interviews and conference appearances about ${c.who} since ${c.since}: episodes where the CEO, CFO or other executives appear, investor-conference presentations and fireside chats, and podcast episodes or YouTube videos that discuss the stock. Note anything management said that sounds new (guidance, tone, strategy) — quote only what the source shows.`,
  regs: c => `Search for regulatory, legal and government items about ${c.who} since ${c.since}: permits granted, denied or restricted (state and federal agencies; for oil, gas and water companies e.g. the Texas Railroad Commission, New Mexico Oil Conservation Division, EPA, disposal-well and seismicity rules), enforcement actions, lawsuits filed or decided, court rulings, government contracts, tariffs and legislation that affect the company.`,
  peers: c => `Search for news since ${c.since} about the CUSTOMERS, COMPETITORS and SUPPLIERS of ${c.who} that could read through to it: customers changing budgets, activity or contracts; competitors winning or losing business, pricing, deals and results; supplier problems. First identify the main customers and competitors, then search. Explain each read-through in one line.`,
  shorts: c => `Search for items on ${c.who} since ${c.since} about short sellers and ownership: activist short reports, changes in short interest or days to cover, borrow becoming hard, large holders buying or selling (13F changes, activist stakes), index additions or deletions, and credit-rating changes or debt news.`
};
AL.keywordTask = (sw, ticker) => {
  const c = sw.ctx[ticker] || {};
  return `KEYWORD FINDER — ${ticker}
Work out the search keywords a news-monitoring system should use for the stock ${ticker}${c.name ? " (" + c.name + ")" : ""}${c.terms ? `. The owner already added: ${c.terms}` : ""}.
Use a quick search to confirm the company and its current leadership. List the names people would actually use in news, filings, podcasts and social posts: the company's names, executives, brands and products, subsidiaries, places it operates, main customers and competitors, and industry terms. Also list look-alikes to ignore (other companies or things with similar names or tickers). Be concrete and current; no generic words like "stock" or "earnings".
Write a two-line note, then the JSON block.`;
};
const kwList = (k, f, n) => (k && Array.isArray(k[f]) ? k[f] : []).map(x => typeof x === "string" ? x : x && x.name ? x.name + (x.role ? " (" + x.role + ")" : "") : "").filter(Boolean).slice(0, n);
AL.keywordLine = function (c) {
  const k = c.keywords || {};
  const bits = [...kwList(k, "aliases", 3), ...kwList(k, "people", 3).map(x => x.replace(/ \(.*\)$/, "")), ...kwList(k, "products", 4), ...kwList(k, "subsidiaries", 3)];
  if (c.terms) bits.unshift(...String(c.terms).split(/\s*,\s*/).filter(Boolean));
  return [...new Set(bits)].slice(0, 14).join(", ");
};
AL.seatTask = function (sw, ticker, seatId) {
  const c = sw.ctx[ticker] || {}, s = AL.sentinel(seatId), k = c.keywords || {};
  const name = c.name || k.company_name || "";
  const kw = AL.keywordLine(c);
  let who = `${name ? name + " (" + ticker + ")" : ticker}${kw ? " — also search for: " + kw : ""}`;
  if (seatId === "peers" && (kwList(k, "customers", 1).length || kwList(k, "competitors", 1).length)) who += `. Known customers: ${kwList(k, "customers", 8).join(", ") || "unknown"}. Known competitors: ${kwList(k, "competitors", 8).join(", ") || "unknown"}`;
  if (seatId === "regs" && kwList(k, "places", 1).length) who += `. Operates in: ${kwList(k, "places", 10).join(", ")}`;
  if (seatId === "pods" && kwList(k, "people", 1).length) who += `. Executives: ${kwList(k, "people", 6).join(", ")}`;
  if (["news", "press"].includes(seatId) && kwList(k, "industry_terms", 1).length) who += `. Useful industry terms: ${kwList(k, "industry_terms", 6).join(", ")}`;
  if (kwList(k, "avoid", 1).length) who += `. Do NOT confuse with: ${kwList(k, "avoid", 6).join(", ")}`;
  const n = AL.searchesFor(seatId, sw, ticker);
  let t = `ALERT SENTINEL: ${s.name.toUpperCase()} — ${ticker}\nWindow: items published from ${c.since} to today (${U.today()}).\n\n` + TASKS[seatId]({who, since: c.since, reputableOnly: sw.reputableOnly});
  const fl = AL.feedLines(sw, ticker, seatId);
  if (fl.length) t += `\n\nDIRECT FEED — collected by code from the platforms themselves (newest first). Report the ones that matter, using their URLs; use web search for what this feed misses:\n${fl.join("\n")}`;
  t += `\n\nYou have up to ${n} web search${n === 1 ? "" : "es"}. Spend them on new information.`;
  if ((c.seenTitles || []).length) t += `\n\nALREADY REPORTED (do not repeat unless there is a real update):\n${c.seenTitles.slice(0, 25).map(x => "- " + x).join("\n")}`;
  return t;
};
AL.deskTask = function (sw, ticker, cands) {
  const c = sw.ctx[ticker] || {};
  const list = cands.map((x, i) => `[${i}] ${x.date || "?"} · ${AL.sentinel(x.seat)?.name || x.seat} · ${x.source || ""}${x.reputable === false ? " (unverified)" : ""} · hint ${x.importance || "?"}\n    ${x.title}${x.summary ? " — " + x.summary : ""}`).join("\n");
  return `ALERT DESK — ${ticker}${c.name ? " · " + c.name : ""}
You are the editor of a personal stock alert system. The sentinels found the candidates below since ${c.since}. Decide what the owner of this stock needs to know.
- Merge duplicates (same event from several sources): keep the best source as ref, list the others in also.
- Drop noise, rehashes of old news and anything in ALREADY REPORTED unless it is a real update (then novelty=update).
- Score importance honestly: 5 = could change the investment case (fraud, bankruptcy, restatement, takeover, loss of a major customer, CEO exit); 4 = clearly material (big contract, guidance change, downgrade from a major bank, large insider buy, activist stake, ≥8% move); 3 = notable; 2 = minor; 1 = trivia.
- Unverified social posts rarely deserve more than 2 unless the claim is serious and specific (then say it is unverified).
- thesis_hit: if an item bears on one of the owner's thesis or monitoring lines below, quote that line.

THESIS AND MONITORING LINES:
${(c.thesis || []).length ? c.thesis.map(x => "- " + x).join("\n") : "(none recorded — judge importance from the facts)"}
${c.below || c.above ? `PRICE LEVELS: below ${c.below || "–"}, above ${c.above || "–"}` : ""}

${AL.prefsText(sw.prefs)}ALREADY REPORTED:
${(c.seenTitles || []).slice(0, 30).map(x => "- " + x).join("\n") || "(nothing yet)"}

CANDIDATES:
${list || "(none)"}

Write two or three sentences for the owner, then the JSON block.`;
};

/* ---------------- sweeps ---------------- */
AL.searchesFor = (seatId, sw, ticker) => { const s = AL.sentinel(seatId); if (!s.search) return 0; let n = Math.max(1, Math.round(s.search * (+sw.searchDepth || 1)));
  if (ticker && AL.feedLines(sw, ticker, seatId).length >= 8) n = Math.max(1, n - 1); // the direct feed already covers part of the ground
  return n; };
AL.modelFor = (seatId, sw, st) => {
  const max = sw.plan === "max";
  if (seatId === "desk") return max ? (st.judgeModel || AIC.DEFAULTS.judgeModel) : (st.analystModel || AIC.DEFAULTS.analystModel);
  return max ? (st.analystModel || AIC.DEFAULTS.analystModel) : (st.helperModel || AIC.DEFAULTS.helperModel);
};
const safeId = t => String(t).replace(/[^A-Za-z0-9]/g, "-");
AL.rk = (ticker, seat) => ticker + "|" + seat;

/* ctx per ticker: {since, terms, below, above, seenTitles, seenKeys, thesis, lastWeekly} · scope: "all" (on demand) or "scheduled" (cadence) */
AL.newSweep = function ({tickers, ctx, plan, searchDepth, reputableOnly, blocked, urgentRule, scope, engine, prefs}) {
  plan = AIC.PLANS[plan] ? plan : "saver";
  const sw = {id: U.uid(), kind: "sweep", createdAt: Date.now(), tickers: tickers.slice(), ctx: {}, plan, engine: engine || "api", batch: !!AIC.PLANS[plan].batch, lean: true,
    searchDepth: +searchDepth || 1, reputableOnly: !!reputableOnly, blocked: reputableOnly ? String(blocked || "").split(/[\s,]+/).map(x => x.trim().toLowerCase()).filter(Boolean) : [],
    urgentRule: urgentRule || "thesis", scope: scope || "all", prefs: AL.prefsFrom(prefs), plan_text: AL.PLAN_TEXT[plan].short, seats: AL.SENTINELS.map(s => s.id), tasks: {}, reports: {}, results: {}, status: "running", extraUsage: null, appVersion: AIC.VERSION};
  for (const t of tickers) {
    const c = Object.assign({since: U.addDays(U.today(), -7), seenTitles: [], seenKeys: [], thesis: []}, ctx[t] || {});
    sw.ctx[t] = c;
    // weekly sentinels: Mondays (or if missed for 8+ days); daily ones every sweep; a manual sweep runs everything
    const weeklyDue = scope !== "scheduled" || !c.lastWeekly || new Date().getDay() === 1 || U.daysBetween(c.lastWeekly, U.today()) >= 8;
    sw.tasks[t] = AL.SENTINELS.filter(s => s.stage !== 2 || s.cadence === "daily" || weeklyDue).map(s => s.id);
    for (const id of sw.tasks[t]) sw.reports[AL.rk(t, id)] = {status: "queued", text: "", data: null, sources: [], searches: [], usage: null, ms: 0};
  }
  return sw;
};

AL.candidates = function (sw, ticker) {
  const out = [], seen = new Set(sw.ctx[ticker]?.seenKeys || []), have = new Set();
  for (const id of sw.tasks[ticker] || []) {
    if (id === "desk" || id === "keys") continue;
    const r = sw.reports[AL.rk(ticker, id)]; const its = (r && r.data && r.data.items) || [];
    for (const x of its) {
      const it = Object.assign({seat: id}, x, {importance: Math.max(1, Math.min(5, Math.round(+x.importance || 2)))});
      it.key = it.key || AL.keyOf(it);
      if (seen.has(it.key) || have.has(it.key)) continue;
      have.add(it.key); out.push(it);
    }
  }
  return out;
};
AL.keyOf = it => { if (it.url) { try { const u = new URL(it.url); return "u:" + u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, ""); } catch {} } return "t:" + String(it.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80); };
/* the owner's Useful / Noise feedback: examples for the Alert Desk, plus sources muted after repeated "noise" */
AL.hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
AL.prefsFrom = function (p) {
  p = p || {}; const fb = Array.isArray(p.feedback) ? p.feedback : [];
  const byHost = {}; fb.forEach(f => { if (!f.host) return; const h = byHost[f.host] = byHost[f.host] || {u: 0, n: 0}; if (f.v === "useful") h.u++; else h.n++; });
  const auto = Object.entries(byHost).filter(([, v]) => v.n >= 3 && v.u === 0).map(([k]) => k);
  const muted = [...new Set((p.muted || []).concat(auto))].filter(h => !(p.unmuted || []).includes(h));
  const ex = v => fb.filter(f => f.v === v).slice(0, 12).map(f => `${f.seat ? (AL.sentinel(f.seat)?.name || f.seat) + " · " : ""}${f.kind ? f.kind + " · " : ""}${f.title}`);
  return {useful: ex("useful"), noise: ex("noise"), muted};
};
AL.prefsText = p => !p || (!p.useful.length && !p.noise.length) ? "" : `OWNER FEEDBACK — calibrate to it:
${p.useful.length ? "Found USEFUL (rank items like these higher):\n" + p.useful.map(x => "+ " + x).join("\n") + "\n" : ""}${p.noise.length ? "Marked as NOISE (leave out or rank low items like these):\n" + p.noise.map(x => "- " + x).join("\n") + "\n" : ""}
`;
AL.isUrgent = (it, rule) => rule === "medium" ? it.importance >= 3 || !!it.thesisHit : rule === "high" ? it.importance >= 4 : it.importance >= 4 || !!it.thesisHit;

/* turn the desk's edit into final items (falls back to the raw candidates if the desk failed) */
AL.finalize = function (sw, ticker) {
  const cands = AL.candidates(sw, ticker), d = sw.reports[AL.rk(ticker, "desk")]?.data;
  let items = [];
  const mk = (c, e = {}) => ({id: c.key, key: c.key, ticker, seat: c.seat, title: e.title || c.title, summary: c.summary || "", why: e.why || "", url: c.url || "", source: c.source || "", date: c.date || U.today(),
    kind: c.kind || "", importance: Math.max(1, Math.min(5, Math.round(+e.importance || c.importance || 2))), thesisHit: e.thesis_hit || "", novelty: e.novelty || "new", sentiment: e.sentiment || c.sentiment || "neutral",
    reputable: c.reputable !== false, also: (e.also || []).map(i => cands[i]).filter(Boolean).map(x => ({url: x.url, source: x.source})), sweepId: sw.id, foundAt: Date.now(), status: "new"});
  if (d && Array.isArray(d.items)) {
    const used = new Set();
    for (const e of d.items) { const c = cands[+e.ref]; if (!c || used.has(+e.ref) || e.novelty === "repeat") continue; used.add(+e.ref); (e.also || []).forEach(i => used.add(+i)); items.push(mk(c, e)); }
    cands.forEach((c, i) => { if (!used.has(i) && c.importance >= 4 && (c.seat === "sec" || c.seat === "tape")) items.push(mk(c)); }); // never lose a code-detected major event
  } else items = cands.map(c => mk(c));
  const muted = new Set(sw.prefs?.muted || []);
  if (muted.size) items = items.filter(it => !muted.has(AL.hostOf(it.url)) || it.seat === "sec" || it.seat === "tape" || it.seat === "feeds");
  items.forEach(it => it.urgent = AL.isUrgent(it, sw.urgentRule));
  items.sort((a, b) => (b.urgent - a.urgent) || (b.importance - a.importance) || String(b.date).localeCompare(String(a.date)));
  const social = sw.reports[AL.rk(ticker, "social")]?.data, measured = sw.reports[AL.rk(ticker, "feeds")]?.data?.buzz;
  sw.results[ticker] = {items, headline: d?.headline || (items.length ? items[0].title : "Quiet — nothing new found."), mood: d?.mood || (items.length ? "mixed" : "quiet"),
    buzz: measured?.level || social?.buzz || null, buzzMeasured: !!measured?.level, tone: social?.tone || null, price: sw.ctx[ticker]?.price ?? null, name: sw.ctx[ticker]?.name || ""};
  return sw.results[ticker];
};

AL.totalUsage = sw => { let u = null; for (const k in sw.reports) if (sw.reports[k].usage) u = U.addUsage(u, sw.reports[k].usage); return sw.extraUsage ? U.addUsage(u, sw.extraUsage) : u; };
AL.totalCost = sw => U.costOf(AL.totalUsage(sw)) || 0;
AL.seatStatus = function (sw, seatId) {
  const rs = sw.tickers.filter(t => (sw.tasks[t] || []).includes(seatId)).map(t => sw.reports[AL.rk(t, seatId)]);
  if (!rs.length) return {status: "idle", n: 0};
  const c = st => rs.filter(r => r.status === st).length;
  const items = rs.reduce((s, r) => s + ((r.data && r.data.items) || []).length, 0);
  const status = c("running") ? "running" : c("waiting") ? "waiting" : c("error") ? (c("done") ? "done" : "error") : c("done") + c("skipped") === rs.length ? "done" : c("stopped") ? "stopped" : "queued";
  return {status, n: rs.length, done: c("done") + c("skipped"), items, waiting: rs.find(r => r.status === "waiting"), usage: rs.reduce((u, r) => r.usage ? U.addUsage(u, r.usage) : u, null)};
};

/* run (or resume) a sweep. hooks: {settings, apiKey, signal, defer, onUpdate(sw, key, kind), save(sw)} */
AL.execute = async function (sw, hooks) {
  const st = hooks.settings, upd = hooks.onUpdate || (() => {});
  sw.status = "running";
  const system = AL.system(sw);
  // stage 0: free checks, in code
  for (const t of sw.tickers) {
    const c = sw.ctx[t];
    for (const id of ["sec", "tape", "feeds"]) {
      const r = sw.reports[AL.rk(t, id)]; if (!r || r.status === "done") continue;
      r.status = "running"; const t0 = Date.now(); upd(sw, AL.rk(t, id));
      try {
        const out = id === "sec" ? await AL.scanSec(t, c.since, {signal: hooks.signal}) : id === "tape" ? await AL.scanTape(t, c.since, c, {signal: hooks.signal}) : await AL.scanFeeds(t, c.since, c, {signal: hooks.signal});
        if (id === "sec") { if (out.name && !c.name) c.name = out.name.replace(/,? (Inc|Corp|Corporation|Co|Ltd|plc|LLC)\.?$/i, ""); c.earnings = out.earnings || []; if (out.cik) c.cik = out.cik; }
        if (id === "tape" && isN(out.price)) c.price = out.price;
        if (id === "feeds") { c.buzzToday = out.buzz || null; if (out.buzz?.wikiTitle) c.wikiTitle = out.buzz.wikiTitle; }
        Object.assign(r, {status: "done", data: {items: out.items, feed: out.feed, notes: out.notes, buzz: out.buzz}, text: out.note || "", ms: Date.now() - t0, offline: out.status === "offline"});
      } catch (e) { Object.assign(r, {status: "done", data: {items: []}, text: "Check failed: " + e.message, error: null, ms: Date.now() - t0}); }
      upd(sw, AL.rk(t, id));
    }
  }
  hooks.save && await hooks.save(sw);
  // stage 1: Keyword Finder — reused for 30 days, so usually free and instant
  const kjobs = [];
  for (const t of sw.tickers) {
    const r = sw.reports[AL.rk(t, "keys")], c = sw.ctx[t]; if (!r || ["done", "skipped"].includes(r.status)) continue;
    if (c.keywords && c.keywordsAt && U.daysBetween(c.keywordsAt, U.today()) < AL.KEYWORD_DAYS) {
      Object.assign(r, {status: "done", data: c.keywords, text: "", reused: {at: c.keywordsAt}, ms: 0}); upd(sw, AL.rk(t, "keys")); continue; }
    if (r.status !== "waiting") Object.assign(r, {text: "", data: null, sources: [], searches: [], error: null});
    const model = AL.modelFor("keys", sw, st);
    kjobs.push({id: AL.rk(t, "keys"), customId: safeId(t) + "_keys", target: r,
      o: {engine: "api", settings: st, apiKey: hooks.apiKey, model, system: "You are the Keyword Finder of a personal stock alert system. Be concrete and current.", blocks: [], task: AL.keywordTask(sw, t), schemaKey: "al_keys", maxUses: 2, maxTokens: 2000},
      onDone: out => { Object.assign(r, {text: out.text, data: out.data || {}, sources: out.sources, searches: out.searches || r.searches, usage: out.usage, status: "done", model, ms: r.t0 ? Date.now() - r.t0 : 0});
        if (out.data) { c.keywords = out.data; c.keywordsAt = U.today(); if (!c.name && out.data.company_name) c.name = out.data.company_name; } }});
    r.t0 = Date.now();
  }
  await runAll(sw, kjobs, hooks);
  // stage 2: web sentinels — one batch (Saver) or a parallel burst for every ticker
  const jobs = [];
  for (const t of sw.tickers) for (const id of (sw.tasks[t] || []).filter(x => AL.WEB.includes(x))) {
    const r = sw.reports[AL.rk(t, id)]; if (["done", "skipped"].includes(r.status)) continue;
    if (r.status !== "waiting") Object.assign(r, {text: "", data: null, sources: [], searches: [], error: null});
    const model = AL.modelFor(id, sw, st), n = AL.searchesFor(id, sw, t);
    jobs.push({id: AL.rk(t, id), customId: safeId(t) + "_" + id, target: r,
      o: {engine: "api", settings: st, apiKey: hooks.apiKey, model, system, blocks: [], task: AL.seatTask(sw, t, id), schemaKey: "al_" + id, maxUses: n, maxTokens: 3000, blockedDomains: sw.blocked},
      onDone: out => Object.assign(r, {text: out.text, data: out.data || {items: []}, sources: out.sources, searches: out.searches || r.searches, usage: out.usage, status: "done", model, ms: r.t0 ? Date.now() - r.t0 : 0})});
    r.t0 = Date.now();
  }
  await runAll(sw, jobs, hooks);
  // stage 3: the Alert Desk, one per ticker (skipped when there is nothing to edit)
  const djobs = [];
  for (const t of sw.tickers) {
    const r = sw.reports[AL.rk(t, "desk")]; if (!r || ["done", "skipped"].includes(r.status)) continue;
    const cands = AL.candidates(sw, t);
    if (!cands.length) { Object.assign(r, {status: "skipped", text: "Nothing new to edit — no cost."}); upd(sw, AL.rk(t, "desk")); continue; }
    if (r.status !== "waiting") Object.assign(r, {text: "", data: null, error: null});
    const model = AL.modelFor("desk", sw, st);
    djobs.push({id: AL.rk(t, "desk"), customId: safeId(t) + "_desk", target: r,
      o: {engine: "api", settings: st, apiKey: hooks.apiKey, model, system: "You are the Alert Desk editor of a personal stock alert system. Be precise and brief.", blocks: [], task: AL.deskTask(sw, t, cands), schemaKey: "al_desk", maxUses: 0, maxTokens: 3000},
      onDone: out => Object.assign(r, {text: out.text, data: out.data, usage: out.usage, status: "done", model, ms: r.t0 ? Date.now() - r.t0 : 0})});
    r.t0 = Date.now();
  }
  await runAll(sw, djobs, hooks);
  for (const t of sw.tickers) AL.finalize(sw, t);
  sw.cost = AL.totalCost(sw); sw.status = "done"; sw.completedAt = Date.now();
  upd(sw, null); hooks.save && await hooks.save(sw);
  return sw;
};
async function runAll(sw, jobs, hooks) {
  if (!jobs.length) return;
  // one failing sentinel must not sink the sweep: run, then mark failures and carry on
  const wrapped = jobs.map(j => Object.assign({}, j, {onDone: out => { try { j.onDone(out); } catch (e) { j.target.status = "error"; j.target.error = e.message; } }}));
  try { await PL.runJobs(sw, wrapped, hooks); }
  catch (e) {
    if (e.code === "cancelled" || e.code === "deferred" || e.code === "budget") throw e;
    for (const j of wrapped) { if (j.target.status !== "done" && j.out && !j.error) j.onDone(j.out); }
    for (const j of wrapped) if (j.target.status !== "done") Object.assign(j.target, {status: "done", data: {items: []}, text: "This sentinel failed: " + (j.target.error || e.message), usage: j.target.usage || null});
  }
  hooks.save && await hooks.save(sw);
}

/* what the sweep learned, to carry into the next one */
AL.nextContext = function (prev, sw, ticker) {
  const c = Object.assign({}, prev || {}), res = sw.results[ticker] || {items: []};
  const keys = AL.candidates(sw, ticker).map(x => x.key).concat(res.items.map(x => x.key));
  c.seenKeys = [...new Set(keys.concat(c.seenKeys || []))].slice(0, 400);
  c.seenTitles = res.items.map(x => `${x.date} ${x.title}`).concat(c.seenTitles || []).slice(0, 60);
  c.since = U.today(); c.lastSweep = sw.createdAt;
  if ((sw.tasks[ticker] || []).some(id => AL.sentinel(id)?.cadence === "weekly")) c.lastWeekly = U.today();
  if (sw.ctx[ticker]?.name) c.name = sw.ctx[ticker].name;
  const bz = sw.ctx[ticker]?.buzzToday;
  if (bz) { const {date, st24, reddit7, news7, yt7, wikiLast, stFollowers} = bz; c.buzzHist = [{date, st24, reddit7, news7, yt7, wikiLast, stFollowers}].concat((c.buzzHist || []).filter(h => h.date !== date)).slice(0, 60); }
  if (sw.ctx[ticker]?.wikiTitle) c.wikiTitle = sw.ctx[ticker].wikiTitle;
  if (sw.ctx[ticker]?.cik) c.cik = sw.ctx[ticker].cik;
  if (sw.ctx[ticker]?.keywords) { c.keywords = sw.ctx[ticker].keywords; c.keywordsAt = sw.ctx[ticker].keywordsAt; }
  return c;
};
AL.thesisLines = function (run, th) {
  const out = [];
  if (th) { (th.kill || []).forEach(k => out.push("Would prove us wrong: " + k.criterion)); (th.monitoring || []).forEach(m => out.push("Monitor: " + (m.item || m))); (th.catalysts || []).filter(x => !x.done).forEach(x => out.push("Catalyst: " + x.event + (x.date ? " (" + x.date + ")" : ""))); if (th.thesis) out.unshift("Thesis: " + th.thesis); }
  else if (run && run.cio) { const c = run.cio; if (c.thesis) out.push("Thesis: " + c.thesis); (c.falsification || []).forEach(k => out.push("Would prove us wrong: " + k)); (c.monitoring || []).forEach(m => out.push("Monitor: " + (m.item || m))); if (c.catalyst?.event) out.push("Catalyst: " + c.catalyst.event); }
  return out.slice(0, 14);
};

/* estimate: per sweep (everything) and per month for the weekday morning digest */
AL.estimate = function ({n, plan, searchDepth}) {
  n = Math.max(0, n || 0); plan = AIC.PLANS[plan] ? plan : "saver"; const d = +searchDepth || 1;
  const half = AIC.PLANS[plan].batch ? 0.5 : 1, mult = plan === "max" ? 2 : 1; // Haiku vs Sonnet sentinels
  const seat = id => { const s = Math.max(1, Math.round(AL.sentinel(id).search * d)); return (0.01 + 0.006 * s) * mult * half + 0.01 * s; };
  const desk = (plan === "max" ? 0.05 : 0.025) * half;
  const daily = AL.WEB.filter(id => AL.sentinel(id).cadence === "daily").reduce((a, id) => a + seat(id), 0) + desk;
  const weekly = AL.WEB.filter(id => AL.sentinel(id).cadence === "weekly").reduce((a, id) => a + seat(id), 0);
  return {sweep: n * (daily + weekly), month: n * (daily * 21.7 + weekly * 4.35), minutes: AIC.PLANS[plan].batch ? "usually 15–60 min" : "about 2–5 min"};
};

/* plain-text digest (GitHub issue / markdown) */
AL.digestMarkdown = function (results, {title, date} = {}) {
  const imp = n => "●".repeat(n) + "○".repeat(5 - n);
  let md = `## ${title || "Morning digest"} — ${date || U.today()}\n\n`;
  const ts = Object.keys(results).sort((a, b) => (results[b].items[0]?.importance || 0) - (results[a].items[0]?.importance || 0));
  const urgent = ts.flatMap(t => results[t].items.filter(i => i.urgent).map(i => ({t, i})));
  if (urgent.length) md += `### 🚨 Needs attention\n${urgent.map(({t, i}) => `- **${t}** ${i.title}${i.thesisHit ? ` — _thesis: ${i.thesisHit}_` : ""}${i.url ? ` ([source](${i.url}))` : ""}`).join("\n")}\n\n`;
  for (const t of ts) {
    const r = results[t];
    md += `### ${t}${r.name ? " · " + r.name : ""}${isN(r.price) ? ` · $${(+r.price).toFixed(2)}` : ""}\n${r.headline}${r.buzz ? ` _(chatter: ${r.buzz}${r.tone ? ", " + r.tone : ""})_` : ""}\n\n`;
    md += r.items.length ? r.items.slice(0, 12).map(i => `- ${imp(i.importance)} ${i.title}${i.why ? " — " + i.why : ""}${i.reputable ? "" : " _(unverified)_"}${i.url ? ` ([${i.source || "source"}](${i.url}))` : i.source ? ` (${i.source})` : ""}`).join("\n") + "\n\n" : "_Nothing new._\n\n";
  }
  return md;
};
})(typeof globalThis !== "undefined" ? globalThis : window);
