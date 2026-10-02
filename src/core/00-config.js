/* AI Investment Committee — core config (DOM-free; runs in browser and Node) */
(function (G) {
"use strict";
const AIC = G.AIC = G.AIC || {};

AIC.VERSION = "6.2.0";
AIC.PROMPT_VERSION = "p6.3";

AIC.DEFAULTS = {
  plan: "saver",               // saver | balanced | max  (see AIC.PLANS)
  judgeModel: "claude-opus-5-5",      // CIO, Devil's Advocate, Data Hunter (and every seat on Max)
  analystModel: "claude-sonnet-5-5",  // the other seats on Saver/Balanced
  helperModel: "claude-haiku-4-5-20251001", // document digests, JSON repair
  model: "claude-opus-5-5",    // legacy alias of judgeModel
  searchDepth: 1,              // 0 off, .5 light, 1 standard, 1.5 deep
  toolType: "web_search_20250305",
  maxTokens: 8000,
  runCap: "3",                 // $ cap per run (blank = none)
  monthlyBudget: "",           // $ per calendar month (blank = none)
  gateway: "", gatewayToken: "", gatewayAnthropic: false,
  secUserAgent: "",
  discountRate: 9, terminalGrowth: 2.5,
  ghOwner: "", ghRepo: "", ghBranch: "main",
  defaultMode: "standard",
  customSeats: null,
  promptCaching: true, parallel: true
};

/* Three plans — the only cost choice the user makes */
AIC.PLANS = {
  saver:    {label: "Saver", short: "about ¼ of Max · results usually within an hour", batch: true,  lean: true,
             note: "Anthropic's Batch API (half price) + the lean engine. You can close the page; the run continues when you come back."},
  balanced: {label: "Balanced", short: "about ½ of Max · results in minutes", batch: false, lean: true,
             note: "Same lean engine as Saver, answered immediately."},
  max:      {label: "Max", short: "full price · all Opus · results in minutes", batch: false, lean: false,
             note: "Every seat on Opus 5.5 with its own web searches and the full committee record. The v6.0 behaviour."}
};
/* Which seats keep the most capable model on the lean plans */
AIC.JUDGE_SEATS = ["cio", "devil", "hunter"];

/* $ per million tokens (Anthropic list prices, Oct 2026). Batch = 50% off tokens. Web search $10 / 1,000. */
AIC.PRICES = {
  "claude-opus-5-5":   {in: 4,  out: 20, cw: 5,     cr: 0.20},
  "claude-sonnet-5-5": {in: 2,  out: 10, cw: 2.5,   cr: 0.20},
  "claude-haiku-4-5":  {in: 1,  out: 5,  cw: 1.25,  cr: 0.10},
  "claude-fable-5-1":  {in: 10, out: 50, cw: 12.5,  cr: 0.25},
  "claude-opus-5":     {in: 5,  out: 25, cw: 6.25,  cr: 0.50},
  "claude-sonnet-5":   {in: 2,  out: 10, cw: 2.5,   cr: 0.20},
  "claude-opus-4-8":   {in: 5,  out: 25, cw: 6.25,  cr: 0.50}
};
AIC.SEARCH_PRICE = 10 / 1000;
AIC.priceFor = model => { const m = String(model || ""); const k = Object.keys(AIC.PRICES).sort((a, b) => b.length - a.length).find(x => m.startsWith(x)); return AIC.PRICES[k] || AIC.PRICES["claude-opus-5-5"]; };

AIC.DEFAULT_PROFILE = {
  style: "Balanced (quality at a fair price)", horizon: "Buy & hold (3–5 years)", risk: "Moderate", dd: "-25%",
  other: "", size: "", ccy: "USD", riskPerTrade: "1", expertise: "", accounts: "Taxable"
};

AIC.VERDICTS = ["STRONG BUY", "BUY", "ACCUMULATE", "HOLD", "REDUCE", "SELL", "AVOID", "INSUFFICIENT INFORMATION"];
AIC.BULLISH = ["STRONG BUY", "BUY", "ACCUMULATE"];
AIC.BEARISH = ["REDUCE", "SELL", "AVOID"];

/* Metric vocabulary shared by agents and the code, so claims can be cross-checked */
AIC.METRIC_KEYS = ["price","market_cap","pe_ttm","pe_fwd","ev_ebitda","ev_sales","p_fcf","fcf_yield","revenue_growth","revenue_ttm",
  "gross_margin","op_margin","net_margin","roic","net_debt_ebitda","interest_coverage","short_interest_pct","days_to_cover",
  "insider_ownership_pct","institutional_ownership_pct","rsi14","mfi14","ma20","ma50","ma200","dividend_yield","eps_ttm","eps_fwd",
  "price_target_mean","analyst_count","implied_growth","beta","atr14","high_52w","low_52w"];

/* Seats. stage = execution order; seats in the same stage run in parallel and read every earlier stage. */
AIC.SEATS = [
  {id:"desk",   code:"DD",  name:"Data Desk",            role:"Primary data & computations", blurb:"EDGAR XBRL, prices, filings — computed in code", color:"var(--c-desk)",  stage:0, code_only:true},
  {id:"member", code:"MB",  name:"Member's Note",        role:"Your edge",                   blurb:"Your own view and documents",         color:"var(--c-member)", stage:0, code_only:true},
  {id:"scout",  code:"DS",  name:"Data Scout",           role:"Company & primary sources",   blurb:"Filings, results, guidance, gaps",    color:"var(--c-scout)",  stage:1, search:6, words:800, retrieval:true, scout:true},
  {id:"mscout", code:"MK",  name:"Market Scout",         role:"Estimates, positioning, macro", blurb:"Consensus, short interest, 13F, peers, macro", color:"var(--c-sent)", stage:1, search:6, words:900, scout:true, leanOnly:true},
  {id:"fscout", code:"FS",  name:"Field Scout",          role:"Industry & ground truth",     blurb:"Channel checks, hiring, permits, catalysts", color:"var(--c-industry)", stage:1, search:7, words:900, scout:true, leanOnly:true},
  {id:"screen", code:"SC",  name:"Screener",             role:"Is it worth a committee?",    blurb:"One quick read on the Data Desk",     color:"var(--c-expect)", stage:2, search:3, words:450},
  {id:"expect", code:"MX",  name:"Market Expectations",  role:"Variant-perception setup",    blurb:"What the price already assumes",      color:"var(--c-expect)", stage:2, search:2, words:450},
  {id:"macro",  code:"MS",  name:"Macro Strategist",     role:"Cycle, rates, drivers",       blurb:"Leading indicators & sensitivities",  color:"var(--c-macro)",  stage:3, search:3, words:450},
  {id:"industry",code:"IS", name:"Industry Specialist",  role:"Channel checks",              blurb:"Customers, suppliers, competitors",   color:"var(--c-industry)",stage:3, search:5, words:550, retrieval:true},
  {id:"sent",   code:"SA",  name:"Sentiment Analyst",    role:"Positioning & flows",         blurb:"Revisions, insiders, skilled funds",  color:"var(--c-sent)",   stage:3, search:4, words:450},
  {id:"scuttle",code:"SB",  name:"Scuttlebutt",          role:"Ground truth",                blurb:"Hiring, reviews, traffic, forums",    color:"var(--c-scuttle)",stage:3, search:5, words:450, retrieval:true},
  {id:"hunter", code:"DH",  name:"Data Hunter",          role:"Fundamentals",                blurb:"Normalized earnings, ROIC, MAS",       color:"var(--c-hunter)", stage:4, search:3, words:650},
  {id:"forensic",code:"FA", name:"Forensic Accountant",  role:"Earnings quality",            blurb:"Accruals, M-score, red flags",        color:"var(--c-forensic)",stage:4, search:2, words:450},
  {id:"mgmt",   code:"MG",  name:"Management & Governance", role:"People & incentives",      blurb:"Capital allocation, pay, candor",     color:"var(--c-mgmt)",   stage:4, search:3, words:450},
  {id:"chart",  code:"CH",  name:"The Chartist",         role:"Technical analyst",           blurb:"Computed indicators, levels",         color:"var(--c-chart)",  stage:4, search:1, words:450},
  {id:"catalyst",code:"CT", name:"Catalyst Hunter",      role:"Dated events",                blurb:"12-month catalyst calendar",          color:"var(--c-catalyst)",stage:5, search:4, words:400, retrieval:true},
  {id:"historian",code:"HI",name:"The Historian",        role:"Base rates & analogs",        blurb:"What happened to similar setups",     color:"var(--c-historian)",stage:5, search:2, words:450},
  {id:"bull",   code:"BL",  name:"The Bull",             role:"Upside analyst",              blurb:"What the market is missing",          color:"var(--c-bull)",   stage:6, search:2, words:500},
  {id:"bear",   code:"BR",  name:"The Bear",             role:"Risk analyst",                blurb:"Pre-mortem, drawdown odds",           color:"var(--c-bear)",   stage:6, search:2, words:550},
  {id:"devil",  code:"DA",  name:"Devil's Advocate",     role:"Thesis critic",               blurb:"Steelmans the other side",            color:"var(--c-devil)",  stage:7, search:2, words:600},
  {id:"rebuttal",code:"RB", name:"Rebuttal Round",       role:"Attacked seats respond",      blurb:"Concede or defend",                   color:"var(--c-rebuttal)",stage:8, search:0, words:160, dynamic:true},
  {id:"cio",    code:"CIO", name:"The CIO",              role:"Chief Investment Officer",    blurb:"Expected value, verdict, scorecard",  color:"var(--c-cio)",    stage:9, search:0, words:650},
  {id:"pm",     code:"PM",  name:"Portfolio Manager",    role:"Execution & sizing",          blurb:"Sizing, tranches, stop, alerts",      color:"var(--c-pm)",     stage:10, search:0, words:500}
];
AIC.seat = id => AIC.SEATS.find(s => s.id === id);

AIC.MODES = {
  screen:   {label:"Screen", seats:["desk","member","screen"], note:"Data Desk plus one quick read: is this worth a committee run? Costs cents."},
  full:     {label:"Full committee", seats:AIC.SEATS.map(s=>s.id).filter(id => id !== "screen"), note:"Every seat + rebuttals. Deepest."},
  standard: {label:"Standard", seats:["desk","member","scout","expect","macro","sent","hunter","forensic","chart","bull","bear","devil","rebuttal","cio","pm"], note:"Core seats plus Bull, Expectations, Forensic and rebuttals."},
  quick:    {label:"Quick", seats:["desk","member","scout","expect","hunter","bear","cio","pm"], note:"Fast screen: facts, expectations, fundamentals, risk, verdict.", searchScale:0.5},
  earnings: {label:"Earnings update", seats:["desk","member","scout","expect","hunter","sent","forensic","cio","pm"], note:"Re-run focused on what changed in the latest results. Uses the prior run as context.", earnings:true},
  classic:  {label:"Classic 9", seats:["desk","member","scout","macro","hunter","sent","bear","chart","devil","cio","pm"], note:"The original nine seats."},
  custom:   {label:"Custom", seats:null, note:"Choose seats in Settings."}
};

/* Sector playbooks: KPIs, leading indicators and where to look. Chosen from SEC SIC code or the Scout's sector call. */
AIC.PLAYBOOKS = [
  {id:"software", name:"Software / SaaS", sic:[[7370,7379]], kw:["software","saas","cloud","internet"], etf:"IGV",
   kpis:["ARR and ARR growth","Net revenue retention / gross retention","RPO and current RPO","CAC payback, magic number","Rule of 40","SBC as % of revenue","FCF margin after SBC"],
   leading:["cRPO growth vs revenue growth","billings and deferred revenue","hiring of quota-carrying reps","seat expansion commentary","price increases","app/web traffic trends"],
   sources:["10-Q RPO footnote","investor-day cohort charts","job postings by function","G2/Gartner reviews"]},
  {id:"semis", name:"Semiconductors", sic:[[3674,3674],[3672,3672]], kw:["semiconductor","chip"], etf:"SOXX",
   kpis:["Book-to-bill","Inventory days (own and customers')","Gross margin through the cycle","Utilization","Design wins","Capex intensity"],
   leading:["customer inventory digestion","lead times","hyperscaler/OEM capex guidance","WSTS and SIA billings","DRAM/NAND contract prices"],
   sources:["customers' earnings calls","SIA monthly sales","Taiwan monthly revenue reports of peers"]},
  {id:"banks", name:"Banks", sic:[[6020,6029],[6035,6036]], kw:["bank","bancorp"], etf:"KRE",
   kpis:["Net interest margin","Deposit beta and mix (non-interest-bearing share)","Loan growth","Net charge-offs and reserves","CET1","Efficiency ratio","AOCI losses","CRE/office exposure","Uninsured deposits"],
   leading:["H.8 weekly deposit data","criticized/classified loans","FDIC call reports","loan pipeline commentary"],
   sources:["FFIEC call reports","FDIC BankFind","10-Q loan tables"]},
  {id:"insurance", name:"Insurance", sic:[[6311,6399],[6411,6411]], kw:["insurance","reinsurance"], etf:"KIE",
   kpis:["Combined ratio","Reserve development","Premium growth and rate change","Float growth","Investment yield","Book value per share growth"],
   leading:["pricing commentary at renewals","cat losses","reserve charges at peers"], sources:["statutory filings (NAIC)","rate filings"]},
  {id:"reit", name:"REITs / Real estate", sic:[[6798,6798],[6500,6553]], kw:["reit","real estate","properties"], etf:"VNQ",
   kpis:["FFO/AFFO per share","Occupancy","Same-store NOI","Lease spreads","Implied cap rate vs cost of debt","Debt maturities","Payout ratio"],
   leading:["leasing pipeline","new supply in key markets","cap-rate transactions","tenant credit"], sources:["supplemental packages","CoStar/market reports","county records"]},
  {id:"water", name:"Oilfield water & services", sic:[[1381,1389]], kw:["oilfield","water solutions","produced water","frac","well services","oil & gas field services"], etf:"OIH",
   kpis:["Produced-water volumes (bbl/d) and $/bbl","Recycled-water share","Disposal capacity and permitted injection","Pipeline vs trucked mix","Contract term, dedications and acreage","Utilization and pricing","Backlog","Capex per bbl of capacity"],
   leading:["operator completion schedules and rig/frac counts by basin/county","water-to-oil ratios rising","injection permits and seismicity response areas","RRC/OCD disposal limits","customer capex budgets","M&A of water assets"],
   sources:["Texas RRC injection/disposal permits (H-1, H-10)","New Mexico OCD filings","FracFocus completions","Baker Hughes / Enverus rig counts","Primary Vision frac spread count","operators' capex guidance"]},
  {id:"eandp", name:"Oil & gas producers", sic:[[1311,1311],[2911,2911]], kw:["exploration","production","petroleum","oil","natural gas"], etf:"XOP",
   kpis:["Production growth and mix","Decline rates","Breakeven and FCF yield at strip","Reserves (PV-10, R/P)","Inventory depth (years of locations)","Capex per boe, LOE","Hedge book"],
   leading:["futures curve shape (backwardation/contango)","rig and frac counts","well productivity trends","takeaway capacity","DUC inventory"],
   sources:["EIA weekly and DPR","state production data","10-K reserve tables","investor presentations"]},
  {id:"midstream", name:"Midstream / pipelines", sic:[[4610,4619],[4920,4925]], kw:["pipeline","midstream","gathering"], etf:"AMLP",
   kpis:["Throughput volumes","Fee-based % and MVC coverage","Contract tenor","Leverage","Distribution/dividend coverage","Growth capex backlog"],
   leading:["producer activity on dedicated acreage","FERC filings","new takeaway projects"], sources:["FERC eLibrary","state pipeline data"]},
  {id:"utilities", name:"Utilities", sic:[[4900,4991]], kw:["utility","electric","water utility"], etf:"XLU",
   kpis:["Rate base growth","Allowed vs earned ROE","Regulatory lag","Capex plan","Load growth (data centers)","Credit metrics (FFO/debt)"],
   leading:["rate case filings and settlements","interconnection queues","large-load contracts"], sources:["state PUC dockets","FERC filings","IRPs"]},
  {id:"retail", name:"Retail / consumer discretionary", sic:[[5200,5999]], kw:["retail","stores","apparel","restaurant"], etf:"XRT",
   kpis:["Same-store sales (traffic vs ticket)","Inventory vs sales growth","Gross margin","Store count and productivity","E-commerce share"],
   leading:["card-spend panels","web/app traffic","promotional intensity","inventory build at peers"], sources:["10-Q inventory notes","Census retail sales","job postings"]},
  {id:"staples", name:"Consumer staples", sic:[[2000,2099],[2840,2844],[2111,2111]], kw:["food","beverage","household","tobacco"], etf:"XLP",
   kpis:["Organic growth split into price and volume","Gross margin vs input costs","Market share","A&P spend","Private-label pressure"],
   leading:["scanner data","commodity input costs","retailer inventory commentary"], sources:["Nielsen/Circana commentary","retailers' calls"]},
  {id:"biopharma", name:"Biotech / pharma", sic:[[2833,2836],[8731,8731]], kw:["pharma","therapeutics","biotech","bio"], etf:"XBI",
   kpis:["Pipeline by phase","Upcoming readouts and PDUFA dates","Cash runway","Patent cliffs/LOE","Launch trajectories (scripts)","Payer mix"],
   leading:["ClinicalTrials.gov enrollment changes","FDA calendar","script data","conference abstracts"], sources:["ClinicalTrials.gov","FDA approvals and CRLs","patent filings"]},
  {id:"medtech", name:"Medical devices", sic:[[3841,3851]], kw:["medical","device","surgical"], etf:"IHI",
   kpis:["Procedure volumes","ASP trends","Approvals and reimbursement","Installed base and utilization"],
   leading:["510(k)/PMA approvals","CMS reimbursement rules","hospital capex"], sources:["FDA databases","CMS proposed rules"]},
  {id:"aero", name:"Aerospace & defense", sic:[[3720,3728],[3760,3769],[3812,3812]], kw:["aerospace","defense"], etf:"ITA",
   kpis:["Backlog and funded backlog","Book-to-bill","Program margins","Deliveries","Budget cycle exposure"],
   leading:["DoD contract awards","appropriations","OEM delivery schedules"], sources:["USAspending.gov","defense.gov contract announcements","FAA data"]},
  {id:"industrial", name:"Industrials / machinery", sic:[[3400,3599],[3600,3669],[3690,3699],[3800,3829]], kw:["industrial","machinery","equipment"], etf:"XLI",
   kpis:["Orders and book-to-bill","Backlog","Price vs cost","Incremental margins","Capacity utilization","Aftermarket mix"],
   leading:["ISM new orders","customer capex plans","distributor inventories","dealer surveys"], sources:["customers' calls","trade association data"]},
  {id:"transport", name:"Transportation", sic:[[4011,4731]], kw:["railroad","trucking","airline","shipping","logistics"], etf:"IYT",
   kpis:["Volumes","Yield/revenue per unit","Operating ratio","Fuel","Capacity"],
   leading:["Cass freight index","AAR weekly carloads","spot vs contract rates","TSA throughput"], sources:["AAR","DAT","BTS"]},
  {id:"telecom", name:"Telecom & media", sic:[[4812,4899],[7810,7841]], kw:["telecom","wireless","media","broadband","streaming"], etf:"XLC",
   kpis:["Subscribers and net adds","ARPU","Churn","Capex intensity","Content spend"],
   leading:["app downloads","porting data","pricing actions"], sources:["FCC filings","app-store rankings"]},
  {id:"autos", name:"Autos", sic:[[3711,3716]], kw:["auto","vehicle"], etf:"CARZ",
   kpis:["Units and mix","ASP and incentives","Inventory days","EV transition economics"],
   leading:["dealer inventory","incentive spend","registration data"], sources:["Cox/Wards data","state registrations"]},
  {id:"mining", name:"Mining & metals", sic:[[1000,1099],[1400,1499],[3310,3399]], kw:["mining","gold","copper","steel","metals","lithium"], etf:"XME",
   kpis:["AISC / cash cost","Grade and recovery","Production guidance","Reserve life","Commodity price sensitivity"],
   leading:["commodity futures curve","exchange inventories","permitting milestones"], sources:["NI 43-101/S-K 1300 reports","LME/COMEX inventories"]},
  {id:"chemicals", name:"Chemicals & materials", sic:[[2800,2832],[2850,2899]], kw:["chemical","materials"], etf:"XLB",
   kpis:["Spreads vs feedstock","Volumes","Utilization","Pricing actions"],
   leading:["ACC chemical activity barometer","feedstock prices","destocking commentary"], sources:["ACC data","customers' calls"]},
  {id:"homebuilders", name:"Homebuilders & building", sic:[[1520,1542],[2421,2452],[3270,3299]], kw:["homebuilder","homes","building products"], etf:"XHB",
   kpis:["Net orders","Backlog","Cancellation rate","Gross margin and incentives","Land supply (years)"],
   leading:["mortgage applications","building permits","new-home inventory","NAHB sentiment"], sources:["Census permits","county permit data"]},
  {id:"general", name:"General", sic:[], kw:[], etf:"SPY",
   kpis:["Revenue growth and drivers","Gross and operating margin","ROIC vs WACC","FCF conversion","Balance sheet"],
   leading:["backlog/RPO","hiring","pricing","customer commentary"], sources:["10-K/10-Q","investor presentations"]}
];
AIC.ETF_PLAYBOOK = {id:"etf", name:"ETF / fund", etf:"SPY",
  kpis:["Holdings and weights","Expense ratio","Tracking difference","Concentration (top 10 %)","Flows","Premium/discount to NAV","Factor and sector exposure","Liquidity of underlying"],
  leading:["fund flows","holdings' estimate revisions","factor rotation"], sources:["issuer holdings files","N-PORT filings"]};

AIC.pickPlaybook = function (sic, sectorText, instrument) {
  if (instrument && /etf|fund/i.test(instrument)) return AIC.ETF_PLAYBOOK;
  const n = parseInt(sic, 10);
  if (n) for (const p of AIC.PLAYBOOKS) if (p.sic.some(([a, b]) => n >= a && n <= b)) return p;
  const t = String(sectorText || "").toLowerCase();
  if (t) for (const p of AIC.PLAYBOOKS) if (p.kw.some(k => t.includes(k))) return p;
  return AIC.PLAYBOOKS.find(p => p.id === "general");
};

/* ---------- structured output schemas (submit_report tool) ---------- */
const S = {
  str: (d) => ({type:"string", description:d}),
  num: (d) => ({type:"number", description:d}),
  int10: (d) => ({type:"integer", minimum:1, maximum:10, description:d}),
  arr: (items, d, max) => ({type:"array", items, description:d, ...(max?{maxItems:max}:{})}),
  obj: (props, req) => ({type:"object", properties:props, ...(req?{required:req}:{})}),
  enm: (vals, d) => ({type:"string", enum:vals, description:d})
};
AIC.S = S;
const CLAIM = S.obj({
  text: S.str("The claim in one sentence"),
  metric: S.str("Metric key from the shared vocabulary if the claim is a number (e.g. pe_ttm, revenue_growth), else omit"),
  value: S.num("Numeric value if applicable (percentages as numbers, e.g. 12.5 for 12.5%)"),
  as_of: S.str("Date of the figure, YYYY-MM-DD if known"),
  source_url: S.str("URL of the source if any"),
  source_type: S.enm(["primary","secondary","computed","estimate","member","model_knowledge"], "primary = filing/exchange/company/government data; secondary = press/aggregator"),
  confidence: S.enm(["high","medium","low"], "Confidence")
}, ["text","source_type","confidence"]);
const BASE = {
  summary: S.str("Your conclusion in at most 40 words"),
  claims: S.arr(CLAIM, "The 4-12 most important factual claims in your report", 12),
  data_gaps: S.arr(S.str(""), "What you could not verify", 6)
};
const SIGNAL = S.obj({signal:S.str("Observation"), direction:S.enm(["positive","negative","neutral"],""), as_of:S.str(""), source_url:S.str("")}, ["signal","direction"]);
AIC.SCHEMAS = {
  scout: {score:null, extra:{
    instrument_type: S.enm(["stock","etf","adr","fund","other"], ""), sector:S.str("Sector and industry"),
    price: S.num("Last price"), price_as_of: S.str("Timestamp/date of last price"), currency: S.str("Trading currency"),
    shares_outstanding: S.num("Total shares outstanding, all classes (e.g. Class A + Class B), as a plain number"), market_cap: S.num("Market capitalization in the trading currency, as a plain number"),
    next_earnings_date: S.str("YYYY-MM-DD if known"), data_quality: S.enm(["High","Medium","Low"], "Quality of the data you found")}},
  mscout: {score:null, extra:{
    consensus_rating: S.str(""), price_target_mean: S.num(""), analyst_count: S.num(""),
    short_interest_pct: S.num(""), peers: S.arr(S.obj({ticker:S.str(""), pe:S.num(""), ev_ebitda:S.num(""), fcf_yield_pct:S.num("")},["ticker"]), "", 4)}},
  fscout: {score:null, extra:{
    catalysts: S.arr(S.obj({event:S.str(""), date:S.str(""), impact:S.enm(["positive","negative","binary"],"")},["event","date"]), "Dated events found", 10)}},
  screen: {score:"score_screen", extra:{
    score_screen: S.int10("10 = clearly worth a full committee"), call: S.enm(["PROMISING","MIXED","PASS"], ""),
    reasons: S.arr(S.str(""), "", 5), questions: S.arr(S.str(""), "What a full committee should answer", 5)}},
  expect: {score:null, extra:{
    implied_growth_pct: S.num("Annual growth the price implies (use the Data Desk reverse DCF if available)"),
    consensus_narrative: S.str("The story the market is telling, 2 sentences"),
    what_must_be_true: S.arr(S.str(""), "Conditions the current price requires", 5),
    variant_hypotheses: S.arr(S.str(""), "Specific ways the market could be wrong, either direction", 5)}},
  macro: {score:"score_macro", extra:{ score_macro:S.int10("10 = very supportive backdrop"),
    drivers: S.arr(S.obj({driver:S.str(""), direction:S.enm(["improving","deteriorating","stable"],""), impact:S.enm(["high","medium","low"],"")},["driver","direction"]), "2-3 drivers that matter most", 4)}},
  industry: {score:"score_industry", extra:{ score_industry:S.int10("10 = strongly improving industry position"),
    kpis: S.arr(S.obj({name:S.str(""), value:S.str(""), trend:S.enm(["up","down","flat","unknown"],"")},["name"]), "Sector KPIs from the playbook", 8),
    channel_signals: S.arr(S.obj({source:S.enm(["customer","supplier","competitor","regulator","other"],""), signal:S.str(""), direction:S.enm(["positive","negative","neutral"],""), as_of:S.str(""), source_url:S.str("")},["source","signal","direction"]), "Signals from the value chain", 8)}},
  sent: {score:"score_sentiment", extra:{ score_sentiment:S.int10("10 = supportive positioning"),
    crowding: S.enm(["crowded","neutral","neglected"], ""), signals: S.arr(SIGNAL, "Positioning signals", 8)}},
  scuttle: {score:"score_scuttlebutt", extra:{ score_scuttlebutt:S.int10("10 = ground truth strongly positive"),
    ground_signals: S.arr(S.obj({type:S.enm(["hiring","reviews","traffic","app","pricing","permits","forums","supply_chain","other"],""), observation:S.str(""), direction:S.enm(["positive","negative","neutral"],""), as_of:S.str(""), source_url:S.str("")},["type","observation","direction"]), "Ground-truth signals", 10)}},
  hunter: {score:"score_fundamentals", extra:{ score_fundamentals:S.int10(""),
    intrinsic_low:S.num("Intrinsic value per share, low"), intrinsic_high:S.num("Intrinsic value per share, high"),
    normalized_eps:S.num("Normalized EPS if relevant"), situation_flags: S.arr(S.str(""), "Why the stock may not screen well (acquisition amortization, growth capex, cyclical trough, spin-off, hidden assets, segment masking, etc.)", 6)}},
  forensic: {score:"score_quality", extra:{ score_quality:S.int10("Earnings quality, 10 = pristine"),
    earnings_quality: S.enm(["High","Medium","Low"], ""),
    red_flags: S.arr(S.obj({flag:S.str(""), severity:S.enm(["high","medium","low"],"")},["flag","severity"]), "", 8)}},
  mgmt: {score:"score_management", extra:{ score_management:S.int10(""),
    capital_allocation_grade: S.enm(["A","B","C","D","F"], ""), alignment: S.enm(["strong","mixed","weak"], ""),
    guidance_accuracy: S.str("How past guidance compared with results")}},
  chart: {score:"score_technicals", extra:{ score_technicals:S.int10(""),
    trend: S.enm(["uptrend","downtrend","range","transition"], ""),
    entry_low:S.num(""), entry_high:S.num(""), breakout:S.num(""), invalidation:S.num(""),
    support: S.arr(S.num(""), "", 4), resistance: S.arr(S.num(""), "", 4)}},
  catalyst: {score:null, extra:{
    catalysts: S.arr(S.obj({event:S.str(""), date:S.str("YYYY-MM-DD, or YYYY-MM, or YYYY-Qn"), type:S.enm(["earnings","regulatory","product","corporate","macro","legal","index","other"],""), impact:S.enm(["positive","negative","binary"],""), probability_pct:S.num("")},["event","date","impact"]), "Dated catalysts in the next 12 months", 10)}},
  historian: {score:null, extra:{
    analogs: S.arr(S.obj({name:S.str(""), period:S.str(""), setup:S.str(""), outcome:S.str("")},["name","outcome"]), "", 5),
    base_rate_description: S.str("The reference class"), base_rate_pct: S.num("% of the reference class with a good outcome")}},
  bull: {score:null, extra:{
    upside_price:S.num("Bull-case value per share"), upside_probability_pct:S.num(""), horizon_months:S.num(""),
    what_market_misses: S.str("One paragraph")}},
  bear: {score:"score_risk", extra:{ score_risk:S.int10("10 = low, contained risk"),
    thesis_killer: S.str("The single thing that would prove the bull case wrong"),
    drawdown_scenarios: S.arr(S.obj({name:S.str(""), price:S.num(""), loss_pct:S.num(""), probability_pct:S.num(""), mechanism:S.str("")},["name","price","probability_pct"]), "", 4)}},
  devil: {score:null, extra:{
    critiques: S.arr(S.obj({target:S.str("Seat id: scout, expect, macro, industry, sent, scuttle, hunter, forensic, mgmt, chart, catalyst, historian, bull, bear"), issue:S.str(""), severity:S.enm(["high","medium","low"],"")},["target","issue","severity"]), "", 12),
    blind_spot:S.str(""), groupthink:S.str(""), counter_thesis:S.str(""), anchoring_detected: {type:"boolean"}}},
  rebuttal: {score:null, extra:{
    stance: S.enm(["concede","partial","defend"], ""), response: S.str("At most 120 words"), revised_score: S.num("Revised self-score if changed")}},
  cio: {score:"overall", extra:{
    verdict: S.enm(["STRONG BUY","BUY","ACCUMULATE","HOLD","REDUCE","SELL","AVOID","INSUFFICIENT INFORMATION"], ""),
    conviction: S.enm(["Low","Medium","High"], ""),
    overall: S.int10("Overall score"), quality_score: S.int10("Business quality, ignoring price"), price_score: S.int10("Attractiveness of the price, ignoring quality"),
    scores: S.obj({macro:S.int10(""), fundamentals:S.int10(""), sentiment:S.int10(""), risk:S.int10("10 = low risk"), technicals:S.int10(""), management:S.int10("")}),
    score_reasoning: S.str(""), rationale: S.str("3-4 sentences"), thesis: S.str("One sentence"),
    variant_view: S.str("Where the committee disagrees with the market and why"),
    catalyst: S.obj({event:S.str(""), date:S.str("")}),
    scenarios: S.arr(S.obj({name:S.enm(["bear","base","bull"],""), price:S.num("Value per share"), probability:S.num("0-1"), horizon_months:S.num(""), driver:S.str("")},["name","price","probability"]), "Exactly three scenarios", 3),
    falsification: S.arr(S.str(""), "Measurable sell/reverse conditions", 5),
    monitoring: S.arr(S.obj({item:S.str(""), date:S.str("")},["item"]), "", 6),
    change_vs_prior: S.str("UPGRADE / DOWNGRADE / UNCHANGED — reason (re-analysis only)")}},
  pm: {score:null, extra:{
    action: S.str("What to do now, one line"),
    position_pct_target: S.num(""), position_pct_max: S.num(""),
    tranches: S.arr(S.obj({low:S.num(""), high:S.num(""), pct:S.num("% of the position"), trigger:S.str("")},["low","pct"]), "", 4),
    stop: S.obj({price:S.num(""), type:S.str("hard / closing basis / thesis-based"), rationale:S.str("")}),
    targets: S.arr(S.obj({price:S.num(""), timeframe:S.str("")},["price"]), "", 2),
    risk_reward: S.str(""),
    alt_entry: S.obj({strategy:S.str("e.g. cash-secured put"), strike:S.num(""), expiry:S.str(""), rationale:S.str("")}),
    review_trigger: S.str(""),
    alerts: S.arr(S.obj({type:S.enm(["price_below","price_above","date","event"],""), value:S.str(""), note:S.str("")},["type","value"]), "", 6),
    tax_note: S.str(""), liquidity_note: S.str("")}},
  ask: {score:null, extra:{}},
  ideas: {score:null, extra:{
    ideas: S.arr(S.obj({ticker:S.str(""), name:S.str(""), situation:S.str(""), why_overlooked:S.str(""), leading_signal:S.str(""), catalyst:S.str(""), key_risk:S.str("")},["ticker","situation","why_overlooked"]), "", 10)}},
  compare: {score:null, extra:{
    ranking: S.arr(S.obj({ticker:S.str(""), rank:S.num(""), reason:S.str("")},["ticker","rank","reason"]), "", 6)}},
  thesis: {score:null, extra:{
    status: S.enm(["intact","weakening","broken"], ""),
    kill_checks: S.arr(S.obj({criterion:S.str(""), status:S.enm(["not_triggered","watch","triggered"],""), evidence:S.str("")},["criterion","status"]), "", 6),
    catalyst_updates: S.arr(S.obj({event:S.str(""), update:S.str("")},["event","update"]), "", 6)}}
};
AIC.schemaFor = function (key) {
  const sc = AIC.SCHEMAS[key] || {extra:{}};
  const props = sc.bare ? Object.assign({summary: BASE.summary}, sc.extra) : Object.assign({}, BASE, sc.extra);
  return {type:"object", properties:props, required:["summary"].concat(sc.score ? [sc.score] : [])};
};
})(typeof globalThis !== "undefined" ? globalThis : window);
