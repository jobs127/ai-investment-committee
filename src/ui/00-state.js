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
  member: {note: "", docs: []}, mode: "standard", busy: {}
};
const LS = {
  get(k, d) { try { const v = localStorage.getItem("aic6." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("aic6." + k, JSON.stringify(v)); return true; } catch { return false; } },
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
    verdict: run.cio?.verdict || null, overall: run.cio?.overall ?? null, reanalysis: run.reanalysis, sector: run.playbook?.name || "", expReturn: run.evm?.expReturn ?? null};
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
  S.mode = LS.get("mode", S.settings.defaultMode || "standard");
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
