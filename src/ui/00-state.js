/* UI state and persistence. Small things in localStorage; full runs in IndexedDB (no 5 MB cap). */
"use strict";
const A = window.AIC, U = A.util, C = A.compute, PL = A.pipeline, F = A.features;
const S = {
  view: "analysis", tab: "minutes", portTab: "holdings", recTab: "track", setTab: "profile",
  engine: null, inClaude: false, downloads: null,
  key: "", settings: Object.assign({}, A.DEFAULTS), profile: Object.assign({}, A.DEFAULT_PROFILE),
  index: [],          // run summaries (newest first)
  run: null, running: false, ctl: null, asking: false, open: {},
  track: [], journal: [], holdings: [], watchlist: [], theses: [], evals: [], compares: [], ideas: null, discover: {},
  member: {note: "", docs: []}, mode: "standard", plan: "saver", busy: {}, bg: {}, bgCtl: new Set()
};
const LS = {
  get(k, d) { try { const v = localStorage.getItem("aic6." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    const val = JSON.stringify(v);
    try { localStorage.setItem("aic6." + k, val); return true; }
    catch { if (k.startsWith("cache.")) return false; // full: drop data caches (they refill on demand) and try once more
      try { Object.keys(localStorage).filter(x => x.startsWith("aic6.cache.")).forEach(x => localStorage.removeItem(x)); localStorage.setItem("aic6." + k, val); return true; } catch { return false; } }
  },
  del(k) { try { localStorage.removeItem("aic6." + k); } catch {} }
};
A.cacheGet = k => { const c = LS.get("cache." + k, null); return c && c.exp > Date.now() ? c.v : null; };
A.cacheSet = (k, v, ttl) => { if (!LS.set("cache." + k, {v, exp: Date.now() + ttl})) LS.del("cache." + k); };

/* IndexedDB for runs (falls back to memory if unavailable) */
const DB = {
  db: null, mem: new Map(),
  async open() {
    if (this.db !== null) return this.db;
    this.db = await new Promise(res => {
      try {
        const r = indexedDB.open("aic6", 1);
        r.onupgradeneeded = () => { r.result.createObjectStore("runs", {keyPath: "id"}); r.result.createObjectStore("kv", {keyPath: "k"}); };
        r.onsuccess = () => res(r.result); r.onerror = () => res(false); r.onblocked = () => res(false);
      } catch { res(false); }
    });
    return this.db;
  },
  async tx(store, mode, fn) {
    const db = await this.open();
    if (!db) return fn(null);
    return new Promise((res, rej) => { const t = db.transaction(store, mode); const s = t.objectStore(store); let out; Promise.resolve(fn(s)).then(v => out = v); t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  },
  async putRun(run) {
    const copy = JSON.parse(JSON.stringify(run));
    try { await this.tx("runs", "readwrite", s => { if (!s) { this.mem.set(copy.id, copy); return; } s.put(copy); }); } catch (e) { this.mem.set(copy.id, copy); }
  },
  async getRun(id) {
    if (this.mem.has(id)) return JSON.parse(JSON.stringify(this.mem.get(id)));
    return this.tx("runs", "readonly", s => s ? new Promise(r => { const q = s.get(id); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null); }) : null);
  },
  async delRun(id) { this.mem.delete(id); try { await this.tx("runs", "readwrite", s => s && s.delete(id)); } catch {} },
  async allRuns() {
    const list = await this.tx("runs", "readonly", s => s ? new Promise(r => { const q = s.getAll(); q.onsuccess = () => r(q.result || []); q.onerror = () => r([]); }) : []).catch(() => []);
    return (list || []).concat([...this.mem.values()]);
  }
};

function summaryOf(run) {
  return {id: run.id, ticker: run.ticker, createdAt: run.createdAt, mode: run.mode, status: run.status, engine: run.engine, model: run.model,
    verdict: run.cio?.verdict || null, overall: run.cio?.overall ?? null, reanalysis: run.reanalysis, sector: run.playbook?.name || "", expReturn: run.evm?.expReturn ?? null,
    plan: run.plan || null, cost: U.isNum(run.cost) ? run.cost : (PL.totalCost(run) || null), screen: run.reports.screen?.data?.call || null};
}
async function saveRun(run) {
  PL.derive(run);
  await DB.putRun(run);
  const s = summaryOf(run); const i = S.index.findIndex(x => x.id === run.id);
  if (i >= 0) S.index[i] = s; else S.index.unshift(s);
  S.index.sort((a, b) => b.createdAt - a.createdAt);
  LS.set("index", S.index);
}
function loadState() {
  S.settings = Object.assign({}, A.DEFAULTS, LS.get("settings", {}));
  S.profile = Object.assign({}, A.DEFAULT_PROFILE, LS.get("profile", {}));
  S.index = LS.get("index", []);
  S.track = LS.get("track", []); S.journal = LS.get("journal", []); S.holdings = LS.get("holdings", []);
  S.watchlist = LS.get("watchlist", []); S.theses = LS.get("theses", []); S.evals = LS.get("evals", []); S.compares = LS.get("compares", []);
  if (!LS.get("settings", {}).judgeModel && LS.get("settings", {}).model) S.settings.judgeModel = LS.get("settings", {}).model; // carry over a v6.0 model choice
  S.mode = LS.get("mode", S.settings.defaultMode || "standard");
  S.plan = LS.get("plan", S.settings.plan || "saver"); if (!A.PLANS[S.plan]) S.plan = "saver";
  alLoad(); S.app = LS.get("app", "committee") === "alerts" ? "alerts" : "committee"; if (S.app === "alerts") S.view = "alfeed";
  S.key = LS.get("key", "") || (() => { try { return sessionStorage.getItem("aic6.key") || ""; } catch { return ""; } })();
  applyEnv();
}
function applyEnv() {
  A.env.gateway = S.inClaude ? "" : (S.settings.gateway || "").trim();
  A.env.token = S.settings.gatewayToken || "";
  A.env.direct = false;
  A.data.clearMemo && A.data.clearMemo();
}
const persist = {
  track: () => LS.set("track", S.track), journal: () => LS.set("journal", S.journal), holdings: () => LS.set("holdings", S.holdings),
  watchlist: () => LS.set("watchlist", S.watchlist), theses: () => LS.set("theses", S.theses), evals: () => LS.set("evals", S.evals), compares: () => LS.set("compares", S.compares.slice(0, 15))
};

/* ---------- cost bookkeeping (no extra toggles: plan, monthly budget, per-run cap) ---------- */
const Cost = {
  month: () => new Date().toISOString().slice(0, 7),
  spentThisMonth() { const m = Cost.month(); return ALS.index.filter(h => U.isNum(h.cost) && new Date(h.createdAt).toISOString().slice(0, 7) === m).reduce((a, h) => a + h.cost, 0) + S.index.filter(h => U.isNum(h.cost) && new Date(h.createdAt).toISOString().slice(0, 7) === m).reduce((a, h) => a + h.cost, 0) + (LS.get("extraSpend", {})[m] || 0); },
  addExtra(usage) { if (!usage || !U.isNum(usage.cost)) return; const m = Cost.month(), x = LS.get("extraSpend", {}); x[m] = (x[m] || 0) + usage.cost; LS.set("extraSpend", x); },
  learn(run) { // remember what each seat really cost on each plan, so estimates get better over time
    if (run.status !== "done" || !run.plan || run.engine !== "api") return;
    const st = LS.get("coststats", {}), key = Cost.key(run.plan, run.searchDepth ?? S.settings.searchDepth); const P_ = st[key] = st[key] || {};
    for (const id of run.seats) { const r = run.reports[id]; if (!r || r.reused || !r.usage || !U.isNum(r.usage.cost)) continue;
      const h = P_[id] = P_[id] || {n: 0, avg: 0}; const n = Math.min(h.n, 9); h.avg = (h.avg * n + r.usage.cost) / (n + 1); h.n++; }
    LS.set("coststats", st);
  },
  key: (plan, depth) => `${plan}@${+depth}`, // estimates learn per plan and search depth
  estimate(mode, plan) { const st = LS.get("coststats", {}); return PL.estimate({mode, plan, settings: S.settings, stats: {[plan]: st[Cost.key(plan, S.settings.searchDepth)]}}); },
  budgetLeft() { const b = U.num(S.settings.monthlyBudget); return U.isNum(b) && b > 0 ? b - Cost.spentThisMonth() : null; }
};
