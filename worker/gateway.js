/* AI Investment Committee — data gateway (Cloudflare Worker).
   Fetches SEC EDGAR and price data for the browser app (those sites block direct browser calls),
   and can optionally hold your Anthropic API key so it never sits in a browser.

   Routes
     GET  /                      health check
     GET  /fetch?url=<https url>[&text=1][&max=N]   allow-listed hosts only; text=1 strips HTML
     GET|POST /anthropic/v1/...   forwards to Anthropic (Messages and Message Batches) using ANTHROPIC_API_KEY if set,
                                  otherwise the x-api-key header the app sends

   Settings (Cloudflare dashboard → your worker → Settings → Variables and Secrets)
     ACCESS_TOKEN     (secret, recommended) the app must send this in the x-aic-token header
     SEC_USER_AGENT   (text, required by the SEC) e.g. "Jane Smith jane@example.com"
     ANTHROPIC_API_KEY (secret, optional) enables the /anthropic route
     ALLOWED_ORIGIN   (text, optional) e.g. https://yourname.github.io — defaults to *
*/
const ALLOW = new Set(["www.sec.gov", "data.sec.gov", "efts.sec.gov", "query1.finance.yahoo.com", "query2.finance.yahoo.com", "stooq.com"]);
const TTL = host => host.endsWith("sec.gov") ? 6 * 3600 : 900;

function stripHtml(html) {
  return String(html || "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#8217;|&rsquo;|&#x2019;/gi, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"').replace(/&#8212;|&mdash;/gi, "—").replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}

export default {
  async fetch(req, env, ctx) {
    const origin = env.ALLOWED_ORIGIN || "*";
    const cors = {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-aic-token, x-api-key, anthropic-version, anthropic-beta, anthropic-dangerous-direct-browser-access", "Access-Control-Max-Age": "86400", "Vary": "Origin"};
    const reply = (body, status = 200, extra = {}) => new Response(body, {status, headers: {...cors, ...extra}});
    if (req.method === "OPTIONS") return reply(null, 204);
    const url = new URL(req.url);
    if (url.pathname === "/") return reply(JSON.stringify({ok: true, service: "aic-gateway", anthropic: !!env.ANTHROPIC_API_KEY, secUserAgent: !!env.SEC_USER_AGENT}), 200, {"content-type": "application/json"});
    if (env.ACCESS_TOKEN && req.headers.get("x-aic-token") !== env.ACCESS_TOKEN) return reply("Unauthorized: wrong or missing access token", 401);

    if (url.pathname === "/fetch" && req.method === "GET") {
      let target;
      try { target = new URL(url.searchParams.get("url") || ""); } catch { return reply("Bad url", 400); }
      if (target.protocol !== "https:" || !ALLOW.has(target.hostname)) return reply("Host not allowed", 403);
      const text = url.searchParams.get("text") === "1", max = Math.min(+url.searchParams.get("max") || 0, 4000000);
      const cache = typeof caches !== "undefined" ? caches.default : null;
      const cacheKey = new Request(url.toString().replace(/[?&]?token=[^&]*/, ""), {method: "GET"});
      if (cache) { const hit = await cache.match(cacheKey); if (hit) { const h = new Headers(hit.headers); Object.entries(cors).forEach(([k, v]) => h.set(k, v)); return new Response(hit.body, {status: hit.status, headers: h}); } }
      const ua = target.hostname.endsWith("sec.gov") ? (env.SEC_USER_AGENT || "AI Investment Committee gateway contact@example.com") : "Mozilla/5.0 (compatible; aic-gateway/1.0)";
      const up = await fetch(target.toString(), {headers: {"User-Agent": ua, "Accept": "*/*"}});
      if (!up.ok) return reply(`Upstream ${up.status}`, up.status === 404 ? 404 : 502);
      const ctype = up.headers.get("content-type") || "";
      let body, outType = ctype;
      if (text) { let t = await up.text(); t = /html|xml/i.test(ctype) || /<html|<body|<div/i.test(t.slice(0, 2000)) ? stripHtml(t) : t; if (max && t.length > max) t = t.slice(0, max); body = t; outType = "text/plain; charset=utf-8"; }
      else body = await up.arrayBuffer();
      const res = reply(body, 200, {"content-type": outType || "application/octet-stream", "Cache-Control": `public, max-age=${TTL(target.hostname)}`});
      if (cache) ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    }

    if (url.pathname.startsWith("/anthropic/v1/") && (req.method === "POST" || req.method === "GET")) {
      const key = env.ANTHROPIC_API_KEY || req.headers.get("x-api-key");
      if (!key) return reply("No Anthropic key: set the ANTHROPIC_API_KEY secret on the worker, or send x-api-key.", 401);
      const up = await fetch("https://api.anthropic.com" + url.pathname.slice("/anthropic".length) + url.search, {method: req.method, body: req.method === "POST" ? req.body : undefined,
        headers: {"content-type": "application/json", "x-api-key": key, "anthropic-version": req.headers.get("anthropic-version") || "2023-06-01",
          ...(req.headers.get("anthropic-beta") ? {"anthropic-beta": req.headers.get("anthropic-beta")} : {})}});
      const h = new Headers(up.headers); Object.entries(cors).forEach(([k, v]) => h.set(k, v));
      return new Response(up.body, {status: up.status, headers: h});
    }
    return reply("Not found", 404);
  }
};
