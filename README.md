# AI Investment Committee — v6.0.4

A staged committee of AI analysts debates one stock or ETF and delivers four things: a verdict, a probability-weighted expected value, a variant view (where the market is wrong), and an executable trade plan. You pick one of three cost plans (below). On **Max** every seat runs on **Claude Opus 5.5**; on **Saver** and **Balanced** the judges run on Opus 5.5 and the analysts on Sonnet 5.5. The numbers that matter (financials, ratios, quality scores, technicals, insider activity, filing-language changes, expected value and position sizing) are **computed in code from primary data**, not by the model.

The app is still one HTML file, so it runs in Chrome on a Chromebook with nothing to install. The optional pieces are a free Cloudflare Worker that fetches SEC and price data, and GitHub Actions that run your watchlist on a schedule.

> Research tool, not investment advice. Models make mistakes, data can be stale, and scores are judgments. Verify before acting.

---

## Cost plans (new in 6.0.3)

There are only three choices, shown as buttons under the ticker box:

| Plan | Cost | Speed | How |
|---|---|---|---|
| **Saver** (default) | about ¼ of Max | usually within an hour | Anthropic's **Batch API** (half price) + the lean engine. You can close the tab; the run continues when you come back. |
| **Balanced** | about ½ of Max | minutes | The same lean engine, answered immediately. |
| **Max** | full price | minutes | Every seat on Opus 5.5 with its own searches and the full committee record (the v6.0 behaviour). |

Next to the plans, **Web search: Light · Standard · Deep** sets how much research is done, on any plan. On Saver and Balanced it sets how many searches the three Scouts make; on Max, every research seat. The estimate updates as you switch, and each run keeps the depth it started with.

The **lean engine** does these automatically — no toggles:
- Three **Scouts** (Data, Market, Field) do the web research once for the whole committee; other seats read their findings instead of searching again.
- **Judges** (CIO, Devil's Advocate, Data Hunter) use Opus 5.5; analysts use Sonnet 5.5; small chores (document digests, JSON fixes) use Haiku 4.5.
- Later seats read **summaries** of earlier reports; the Devil's Advocate, CIO and Portfolio Manager still read everything in full. Reports are **not shortened**.
- Your documents are **digested once**, not re-sent to every seat.
- **Recent work is reused** for the same ticker: Data Desk 24 h, Scouts 72 h, Macro 12 h (never for Re-analysis or Earnings mode). Reused seats are labelled and cost nothing.
- **Smart depth:** the Bull is skipped when every seat is already clearly bullish (the Bear and Devil's Advocate always run), and rebuttals only answer serious critiques.
- **Screen** mode: a cheap first look (Data Desk + one Screener) that tells you whether a ticker deserves a full committee.

Spending controls (Settings → **Cost & models**): default plan, **monthly budget** (a run that would exceed it won't start), and **stop a run above $X** (Resume continues it). The **Cost** tab on every run shows each seat's model, tokens, searches and dollars, and what the same run would have cost on Max. Estimates learn from your own runs.

**Saver in the browser** calls Anthropic's Batch API. If your browser can't reach it directly, the app automatically routes Batch calls through your data gateway — that needs the 6.0.3 worker code (re-paste `worker/gateway.js` in Cloudflare → your worker → Edit code → Deploy).

---

## What changed from v5

| Area | v5 | v6 |
|---|---|---|
| Seats | 9, strictly one after another | 18 + a rebuttal round, in 11 stages; seats within a stage run in parallel |
| Data | Web search snippets | **Data Desk**: SEC XBRL financials, filings, Form 4s, 10-K language diffs and 5-year prices, computed in code |
| Question asked | "Is this a good stock?" | "What does the price assume, and where is the market wrong?" (reverse DCF + variant hypotheses) |
| Verdict | One score | Separate quality and price scores, a formula score next to the CIO's, three scenarios → expected value, and a consistency check |
| Output format | Regex on text | Structured `submit_report` tool on every seat, validated in code |
| Feedback | None | Forward-logged track record, calibration by score/verdict/seat/sector, journal, Lab benchmarks |
| Beyond one run | History | Discover, Compare, Portfolio (holdings, watchlist, thesis tracker), scheduled GitHub runs and alerts |

---

## The committee

Stages run in order, and every stage reads all earlier stages. Seats in the same stage run in parallel.

| Stage | Seat | What it does differently |
|---|---|---|
| 0 | **Data Desk** (code) | SEC XBRL → 6 years of financials, TTM, derived Q4. Computes P/E, EV/EBITDA, FCF and FCF-after-SBC yields, ROIC, incremental ROIC, accruals, DSO/DIO, capex/D&A, Piotroski F, Altman Z, Beneish M, a reverse DCF, MA20/50/200, RSI, MFI, MACD, ATR, relative strength vs SPY and the sector ETF, OBV, anchored VWAPs, Fibonacci levels, seasonality, post-earnings drift, Form 4 clusters (opportunistic vs 10b5-1), 13D/13G filings, and a **risk-factor/MD&A diff of the last two 10-Ks** |
| 0 | **Member's Note** | Your own view and uploaded documents (10-Ks, transcripts, your Excel models). Transcripts get hedging/tone analysis |
| 1 | Data Scout | Primary sources first: filings, comment letters, permits, dockets |
| 2 | **Market Expectations** | What the price implies; consensus narrative; 3–5 testable variant hypotheses |
| 3 | Macro Strategist | Leading indicators and second derivatives; company-specific sensitivities; dated policy pipeline |
| 3 | **Industry Specialist** | Sector-playbook KPIs; channel checks on customers', suppliers' and competitors' calls; VC-funded entrants |
| 3 | Sentiment Analyst | Revision breadth, opportunistic insiders, named skilled funds, borrow cost, options, call language, neglect |
| 3 | **Scuttlebutt** | Job postings, employee and customer reviews, traffic, pricing pages, permits, import records |
| 4 | Data Hunter | Normalized earnings; flags the situations screens miss (spin-offs, amortization, growth capex, hidden assets, trough earnings…); SOTP; intrinsic range |
| 4 | **Forensic Accountant** | Interprets the quality scores; non-GAAP gap, auditor, related parties, covenants, filing-language changes |
| 4 | **Management & Governance** | Proxy incentives, 10-year capital-allocation grade, guidance accuracy, turnover |
| 4 | The Chartist | Interprets the computed indicators; entry, breakout and invalidation; timing weighted by your horizon |
| 5 | **Catalyst Hunter** | Dated 12-month calendar (exports to .ics) |
| 5 | **The Historian** | Reference class, analogs and base rates |
| 6 | **The Bull** / The Bear | Symmetric, quantified cases; the Bear writes a pre-mortem and a thesis killer |
| 7 | Devil's Advocate | Steelmans the opposite of the committee's lean; gets the code-detected contradictions and uncited claims; checks for anchoring and groupthink. It can run on a different model |
| 8 | **Rebuttal round** | Up to 4 attacked seats concede or defend; revised scores are applied |
| 9 | The CIO | Three scenarios → EV in code; quality and price scores; variant view; dated catalyst; may return INSUFFICIENT INFORMATION; sees the track-record calibration |
| 10 | Portfolio Manager | Gets ATR stop, support stop, risk-budget size, % of daily volume and correlation with your holdings (all computed in code); tranches, stop, targets, cash-secured-put alternative, alerts, tax and liquidity notes |

**Modes:** Full (all seats), Standard (default), Quick, Earnings update (uses the prior run as context), Classic 9, Custom (choose seats in Settings).

**Sector playbooks** (picked from the SEC SIC code) tell every seat which KPIs, leading indicators and primary sources matter. There are 21 sector playbooks plus a general one and one for ETFs, including oilfield water (Texas RRC injection permits, NM OCD, FracFocus, rig and frac counts), E&P, midstream, banks, SaaS, semis, biotech and REITs.

## Analysis screen

- **Verdict card:** score, verdict, conviction, quality vs price, CIO score vs formula score, a calibration note, and consistency warnings (e.g. "BUY, but the CIO's own scenarios imply −8%").
- **Expected value:** a bear/base/bull strip sized by probability, with EV, expected return, downside-weighted return, up/down ratio and margin of safety.
- **Variant perception:** what the market implies, what the committee believes, and what closes the gap.
- **Trade plan:** tranches, stop, targets, computed sizing, holdings correlation; add to watchlist, track the thesis, export alerts.
- **Leading signals:** computed signals plus channel checks, scuttlebutt and sentiment, sorted by direction.
- **Tabs:**
  - Minutes (streaming reports with summaries and sources)
  - Data Desk
  - Chart (price, MAs, volume, Fibonacci, entry zones, stop and targets, with a hover tooltip)
  - Evidence (claims ledger, primary-source share, contradictions, uncited claims)
  - Debate (Bull vs Bear, the Devil's critiques with rebuttals)
  - Q&A (ask any seat a follow-up question)
- **Your decision:** a one-line journal entry, compared later with the committee and the outcome.

## Other screens

- **Discover:**
  - An idea hunter (Opus with web search) for 10 kinds of mis-screened situations.
  - Live EDGAR feeds: new spin-off registrations (Form 10), activist 13D stakes, and insider open-market buying from the latest Form 4s.
- **Compare:** runs the committee on any ticker without a recent run, then the CIO ranks 2–5 names side by side.
- **Portfolio:**
  - Holdings: cost, lots and account types.
  - Watchlist: cadence, mode, price alerts, "run due now", export of watchlist.json, and sync of results from GitHub.
  - Thesis tracker: catalysts, kill criteria, and "Check now" with a live search.
- **Record:**
  - Track record: forward returns at 3/6/12 months vs SPY, hit rate, average excess return by score bucket and verdict, which seats' scores predict returns, and returns by sector.
  - Journal.
- **Lab:** benchmark a fixed ticker set and compare runs, e.g. after changing prompts or models. It shows verdict flips, score deltas, contradictions, uncited claims, primary-source share, citations, tokens and searches.
- **Settings:** Profile (including your expertise), Engine, Data gateway, Seats, GitHub and Storage.

---

## Setup

### 1. Run it (2 minutes)
1. Open `index.html` in Chrome (or your GitHub Pages URL, see step 3).
2. Paste your Anthropic API key and press **Run committee**.

Without a gateway, everything works except the Data Desk and EDGAR feeds; agents use web search instead.

### 2. Add the data gateway (about 5 minutes, free)
SEC EDGAR and Yahoo Finance block direct browser requests, so the app uses a tiny Cloudflare Worker.

1. Create a free account at dash.cloudflare.com → **Workers & Pages → Create → Create Worker**. Name it `aic-gateway`, then Deploy.
2. Choose **Edit code**, replace everything with `worker/gateway.js`, and Deploy.
3. Go to **Settings → Variables and Secrets** and add:
   - `SEC_USER_AGENT` (text): your name and email, e.g. `Todd Example todd@example.com`. The SEC requires this.
   - `ACCESS_TOKEN` (secret): any long random string.
   - Optional `ANTHROPIC_API_KEY` (secret): lets the app call Anthropic without keeping a key in the browser.
   - Optional `ALLOWED_ORIGIN`: e.g. `https://yourname.github.io`.
4. In the app, go to **Settings → Data**. Paste the worker URL and access token, then press **Test connection**.

If you prefer the command line: `cd worker && npx wrangler deploy`, then `npx wrangler secret put ACCESS_TOKEN`.

### 3. Put it on GitHub (Pages, schedule, alerts)
1. Create a repository and upload every file in this folder, including `.github/`.
2. **Settings → Pages → Source: GitHub Actions.** Your app URL becomes `https://<you>.github.io/<repo>/`.
3. For scheduled watchlist runs:
   - **Settings → Secrets and variables → Actions:** add the secret `ANTHROPIC_API_KEY` and the variable `SEC_USER_AGENT`.
   - In the app, go to Portfolio → Watchlist → **⇩ watchlist.json** and commit that file to the repo root.
   - The **Committee queue** workflow runs every 30 minutes. It starts watchlist tickers that are due (on the Saver plan by default, i.e. Batch prices), advances runs that are waiting on Anthropic one step at a time, checks price alerts once a day, flags verdict changes, opens a GitHub issue when something fires (GitHub emails you), and commits results to `results/`. Waiting runs are kept in `results/pending/`. The plan comes from your app settings when you export watchlist.json (Saver if not set).
   - In the app, set Settings → GitHub (owner, repo) and use **Sync results from GitHub**. The repo must be public for this, or download the results and use Import.
4. **Benchmark (Lab)** workflow: run it manually to queue `evals/benchmark.json`; the Committee queue finishes it at Batch prices and writes `evals/results/`.

### Inside claude.ai
The artifact version runs on your Claude account's most capable model with no API key. Claude pages can't reach the open web or a gateway, so there's no live search and no Data Desk; agents work from model knowledge and mark market figures unverified. Use it for quick reads, and the GitHub version for real work.

---

## Cost

See **Cost plans** at the top. Rough guide at current prices (Opus 5.5 $4/$20 per million input/output tokens, Sonnet 5.5 $2/$10, Haiku 4.5 $1/$5, web search $10 per 1,000, Batch half price): a Full committee is a few dollars on Max, about half that on Balanced and about a quarter on Saver; Quick and Screen cost much less. The estimate under the plan buttons is the number to trust — it learns from your runs.

## Privacy

- Your key, holdings, journal and runs stay in your browser (IndexedDB and localStorage).
- Requests go only to Anthropic and your own gateway.
- Uploaded documents are sent to Anthropic as part of the committee record.
- The GitHub runner commits results to your repository. Keep the repo private if you don't want them public, and use Import instead of Sync.

## Honest limits

- **No backtest.** Language models know what happened after their training dates, so historical backtests are contaminated. The track record only counts calls logged going forward.
- **XBRL data varies by company.** Some filers use unusual tags, and the Data Desk then shows n/a. Altman Z, Beneish M and ROIC are not meaningful for banks and insurers (the app says so). Foreign listings and ETFs get prices and technicals but no SEC fundamentals.
- **No free data for some sources.** Options-implied moves, borrow fees, job postings and app traffic come from web search, not computed feeds.
- **Yahoo Finance's chart endpoint is unofficial.** The gateway falls back to Stooq for US tickers if it fails.

---

## Project layout

```
index.html                 the app (built — open this)
dist/artifact.html         the same app as a claude.ai artifact fragment
src/styles.css, src/markup.html
src/core/                  DOM-free engine shared by the browser and the Node runner
  00-config.js             seats, stages, modes, sector playbooks, output schemas
  10-util.js 20-data.js    helpers; EDGAR / Form 4 / prices via gateway or direct
  30-compute.js            all computations (financials, quality, reverse DCF, technicals, diffs, EV, sizing, calibration)
  35-desk.js               Data Desk assembly
  40-prompts.js            house rules, seat tasks, committee record
  50-engine.js             Anthropic streaming + submit_report tool, prompt caching, retries; claude.ai sample engine
  60-pipeline.js           plans, lean engine, batch/instant jobs, reuse, estimates, caps, rebuttals, Ask
  70-features.js           Discover, Compare, thesis checks, track record, Lab
src/ui/                    browser UI
worker/                    Cloudflare Worker data gateway
runner/run.mjs             headless runner for GitHub Actions
.github/workflows/         pages, watchlist (scheduled), eval (manual), tests
tests/                     offline tests with synthetic fixtures and a mock Anthropic API
watchlist.json, evals/benchmark.json
```

Edit files in `src/`, then run `bash build.sh` to rebuild `index.html` and `dist/artifact.html`.

Tests (offline, no API calls): `node tests/core.test.js` and `node tests/worker.test.mjs`. The Playwright tests `tests/e2e.js` and `tests/e2e-claude.js` need Playwright installed locally.

To customize a seat, edit its task in `src/core/40-prompts.js` and its schema in `src/core/00-config.js`. Then bump `PROMPT_VERSION` and benchmark the change in the Lab.
