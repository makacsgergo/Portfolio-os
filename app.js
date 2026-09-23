const S=window.PORTFOLIO_SEED;
const KEY="portfolio_os_v2";
let state=JSON.parse(localStorage.getItem(KEY)||"null")||structuredClone(S);
let current="home";
let universe=[];
let universeMarketCaps={};
async function loadUniverse(){
 try{
  const d=await fetch("universe.json").then(r=>r.json());
  universe=d.stocks||[];
  const wanted=new Set(universe.map(x=>x.ticker));
  let offset=0, pages=0;
  while(pages<15 && wanted.size){
   const r=await fetch("https://top-us-stock-tickers.zyhe.me/api/v2/tickers?limit=100&offset="+offset+"&sort=market_cap&order=desc");
   if(!r.ok)break;
   const page=await r.json();
   for(const x of (page.items||[])){
    if(wanted.has(x.symbol)) universeMarketCaps[x.symbol]=Number(x.market_cap||x.marketCap||0);
   }
   const next=page.next_offset;
   if(next==null || !(page.items||[]).length)break;
   offset=next; pages++;
   if(Object.keys(universeMarketCaps).length>=universe.length)break;
  }
  universe.sort((a,b)=>(universeMarketCaps[b.ticker]||0)-(universeMarketCaps[a.ticker]||0));
  if(current==="universe")render();
 }catch(e){
  console.error("Universe load failed",e);
 }
}
loadUniverse();
const $=s=>document.querySelector(s);
const money=x=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(x||0);
const pct=x=>(x>=0?"+":"")+Number(x||0).toFixed(2)+"%";
function save(){localStorage.setItem(KEY,JSON.stringify(state))}
function applyTransaction(x){
  if(!x||!["BUY","SELL"].includes(x.type)||!x.ticker||!x.qty||x.qty<=0)return;
  let p=state.positions.find(v=>v.ticker===x.ticker);
  if(x.type==="BUY"){
    if(!p)p={ticker:x.ticker,shares:0,cost:0,price:x.price||0,value:0,pl:0,ret:0};
    const oldShares=p.shares||0, oldCost=p.cost||0;
    p.shares=oldShares+x.qty;
    p.cost=oldCost+x.qty*x.price;
    p.price=x.price||p.price||0;
    p.value=p.shares*p.price;
    p.pl=p.value-p.cost;
    p.ret=p.cost?p.pl/p.cost*100:0;
    if(!state.positions.includes(p))state.positions.push(p);
  }else if(p){
    const sold=Math.min(x.qty,p.shares||0);
    const avgCost=(p.shares||0)>0?(p.cost||0)/(p.shares||1):0;
    p.shares-=sold;
    p.cost=Math.max(0,(p.cost||0)-sold*avgCost);
    p.price=x.price||p.price||0;
    p.value=p.shares*p.price;
    p.pl=p.value-p.cost;
    p.ret=p.cost?p.pl/p.cost*100:0;
    if(p.shares<=0)state.positions=state.positions.filter(v=>v!==p);
  }
}
function migrateUnappliedTransactions(){
  let changed=false;
  for(const x of state.transactions||[]){
    if(!x.applied&&["BUY","SELL"].includes(x.type)){applyTransaction(x);x.applied=true;changed=true}
  }
  if(changed)save();
}
migrateUnappliedTransactions()
function total(){return state.positions.reduce((a,x)=>a+x.value,0)}
function totalPL(){return state.positions.reduce((a,x)=>a+x.pl,0)}
function nav(tab){current=tab; render()}
function render(){
 document.body.innerHTML=`<div class="app">
  <header class="top"><div><div class="brand">Portfolio OS</div><div class="sub">Personal high-growth portfolio tracker</div></div>
  <div class="top-actions"><button class="btn primary" onclick="openTx()">＋ Transaction</button><button class="btn" onclick="importBroker()">Import</button></div></header>
  <nav class="nav">${["home","holdings","watchlist","allocate","universe"].map((x,i)=>`<button class="${current===x?"active":""}" onclick="nav('${x}')">${["Dashboard","Holdings","Watchlist","Allocation","Universe"][i]}</button>`).join("")}</nav>
  <main>${current==="home"?home():current==="holdings"?holdings():current==="watchlist"?watchlist():current==="allocate"?allocation():universePage()}</main>
 </div>
 <nav class="bottom">${[["home","⌂","Home"],["holdings","▤","Holdings"],["watchlist","☆","Watch"],["allocate","◎","Allocate"],["universe","◉","Universe"]].map(x=>`<button class="${current===x[0]?"active":""}" onclick="${x[0]==="more"?"showMore()":`nav('${x[0]}')`}"><b>${x[1]}</b>${x[2]}</button>`).join("")}</nav>
 <div id="modal"></div><div id="toast" class="toast"></div>`;
}
function home(){
 const t=total(),p=totalPL(),cost=t-p, top=[...state.positions].sort((a,b)=>b.value-a.value).slice(0,6);
 return `<div class="cards">
 <div class="card"><div class="label">Portfolio</div><div class="big">${money(t)}</div></div>
 <div class="card"><div class="label">P/L</div><div class="big ${p>=0?"green":"red"}">${money(p)}</div></div>
 <div class="card"><div class="label">Return</div><div class="big ${p>=0?"green":"red"}">${pct(cost?p/cost*100:0)}</div></div>
 <div class="card"><div class="label">Positions</div><div class="big">${state.positions.length}</div></div></div>
 <div class="grid2 section"><div class="card"><div class="section-head"><span class="section-title">Performance</span><span class="pill">V2</span></div><div class="chart">Historical performance chart connects in V3 with daily prices.</div></div>
 <div class="card"><div class="section-head"><span class="section-title">Top positions</span></div>${top.map(x=>`<div class="alloc-row"><b>${x.ticker}</b><div class="bar"><i style="width:${Math.min(100,x.value/t*300)}%"></i></div><span>${(x.value/t*100).toFixed(1)}%</span></div>`).join("")}</div></div>
 <div class="section"><div class="section-head"><span class="section-title">Portfolio snapshot</span><button class="btn" onclick="nav('allocate')">Where to put new money →</button></div>
 <div class="list">${top.slice(0,4).map(x=>`<div class="list-item" onclick="stock('${x.ticker}')"><div><span class="ticker">${x.ticker}</span><div class="muted small">${money(x.value)} position</div></div><div class="${x.pl>=0?"green":"red"}">${money(x.pl)}<br><span class="small">${pct(x.ret)}</span></div></div>`).join("")}</div></div>`;
}
function holdings(){
 return `<div class="section-head"><div><span class="section-title">Holdings</span><div class="muted small">${state.positions.length} current positions</div></div><input class="search" placeholder="Search ticker" oninput="filterHold(this.value)"></div>
 <div class="table-wrap"><table class="table" id="ht"><thead><tr><th>Ticker</th><th>Shares</th><th>Price</th><th>Value</th><th>P/L</th><th>Return</th><th>Weight</th></tr></thead><tbody>${[...state.positions].sort((a,b)=>b.value-a.value).map(x=>`<tr data-t="${x.ticker}" onclick="stock('${x.ticker}')"><td class="ticker">${x.ticker}</td><td>${x.shares.toFixed(4)}</td><td>${money(x.price)}</td><td>${money(x.value)}</td><td class="${x.pl>=0?"green":"red"}">${money(x.pl)}</td><td class="${x.ret>=0?"green":"red"}">${pct(x.ret)}</td><td>${(x.value/total()*100).toFixed(2)}%</td></tr>`).join("")}</tbody></table></div>`;
}
function filterHold(q){document.querySelectorAll("#ht tbody tr").forEach(r=>r.style.display=r.dataset.t.toLowerCase().includes(q.toLowerCase())?"":"none")}
function watchlist(){
 return `<div class="section-head"><div><span class="section-title">Watchlist</span><div class="muted small">Research candidates</div></div></div>
 <div class="watch-grid">${state.watchlist.map(x=>`<div class="card" onclick="stock('${x.ticker}')"><div class="section-head"><b>${x.ticker}</b><span class="pill">WATCH</span></div><div>${x.name}</div><div class="muted small" style="margin-top:8px">Open company research →</div></div>`).join("")}</div>`;
}
function fmtCap(x){
 if(!x)return "—";
 if(x>=1e12)return "$"+(x/1e12).toFixed(2)+"T";
 if(x>=1e9)return "$"+(x/1e9).toFixed(1)+"B";
 if(x>=1e6)return "$"+(x/1e6).toFixed(0)+"M";
 return "$"+x.toLocaleString();
}
function isWatched(t){return state.watchlist.some(x=>x.ticker===t)}
function toggleWatch(t){const u=universe.find(x=>x.ticker===t);if(!u)return;if(isWatched(t))state.watchlist=state.watchlist.filter(x=>x.ticker!==t);else state.watchlist.push({ticker:t,name:u.name});save();render();toast(isWatched(t)?t+' added to watchlist':t+' removed from watchlist')}
function universePage(){
 const q=(window.universeQuery||"").toLowerCase();
 const sector=window.universeSector||"ALL";
 const idx=window.universeIndex||"ALL";
 const sectors=[...new Set(universe.map(x=>x.sector).filter(Boolean))].sort();
 let rows=universe.filter(x=>{
   const matchesQ=!q||x.ticker.toLowerCase().includes(q)||x.name.toLowerCase().includes(q)||x.sector.toLowerCase().includes(q);
   const matchesSector=sector==="ALL"||x.sector===sector;
   const matchesIndex=idx==="ALL"||x.index.includes(idx);
   return matchesQ&&matchesSector&&matchesIndex;
 });
 rows.sort((a,b)=>(universeMarketCaps[b.ticker]||0)-(universeMarketCaps[a.ticker]||0));
 return `<div class="section-head"><div><span class="section-title">Stock Universe</span><div class="muted small">${rows.length} of ${universe.length} stocks • ranked by market cap</div></div>
 <input class="search" placeholder="Search ticker or company" value="${window.universeQuery||""}" oninput="filterUniverse(this.value)"></div>
 <div class="filters" style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
   <select class="search" onchange="filterUniverseSector(this.value)"><option value="ALL">All sectors</option>${sectors.map(s=>`<option value="${s}" ${sector===s?"selected":""}>${s}</option>`).join("")}</select>
   <select class="search" onchange="filterUniverseIndex(this.value)">
     <option value="ALL" ${idx==="ALL"?"selected":""}>All indices</option>
     <option value="S&P 500" ${idx==="S&P 500"?"selected":""}>S&P 500</option>
     <option value="Nasdaq-100" ${idx==="Nasdaq-100"?"selected":""}>Nasdaq-100</option>
   </select>
 </div>
 <div class="table-wrap"><table class="table" id="ut"><thead><tr><th>#</th><th>Ticker</th><th>Company</th><th>Market Cap</th><th>Sector</th><th>Index</th><th></th></tr></thead><tbody>${rows.map((x,i)=>`<tr data-universe-ticker="${x.ticker}" style="cursor:pointer"><td>${i+1}</td><td class="ticker"><button class="btn" type="button" onclick="openStockFromButton(event,'${x.ticker}')">${x.ticker}</button></td><td><button class="btn" type="button" onclick="openStockFromButton(event,'${x.ticker}')">${x.name}</button></td><td>${fmtCap(universeMarketCaps[x.ticker])}</td><td>${x.sector||"—"}</td><td><span class="pill">${x.index.replace("S&P 500 + ","S&P + ")}</span></td><td><button class="btn" type="button" onclick="openStockFromButton(event,'${x.ticker}')">Open</button></td></tr>`).join("")}</tbody></table></div>`;
}
function filterUniverse(q){window.universeQuery=q; render();}
function filterUniverseSector(v){window.universeSector=v; render();}
function filterUniverseIndex(v){window.universeIndex=v; render();}
function allocation(){
 return `<div class="card"><div class="section-head"><div><span class="section-title">Concentrated new-capital plan</span><div class="muted small">High-growth / high-risk framework</div></div><span class="pill">100%</span></div>
 ${state.allocation.map(x=>`<div class="alloc-row"><b>${x.ticker}</b><div class="bar"><i style="width:${x.pct*3.2}%"></i></div><span>${x.pct}%</span></div>`).join("")}
 <div class="section"><button class="btn primary" onclick="allocationAmount()">Calculate an investment amount</button></div></div>`;
}
function businessDescription(t,u){
 const d={
  AAPL:"Designs and sells consumer electronics, software and digital services, including the iPhone, Mac, iPad and a large services ecosystem.",
  MSFT:"Develops software, cloud infrastructure and productivity products, including Azure, Microsoft 365, Windows, Dynamics and AI products.",
  META:"Operates social and messaging platforms including Facebook, Instagram, WhatsApp and Messenger, and develops advertising, AI and virtual/augmented reality products.",
  NVDA:"Designs GPUs, networking products and software used for accelerated computing, artificial intelligence, gaming and data centers.",
  AMZN:"Operates e-commerce marketplaces, logistics and cloud infrastructure through Amazon Web Services, alongside advertising and other consumer businesses.",
  GOOGL:"Operates internet services including Google Search, YouTube and Android, while generating substantial revenue from digital advertising and cloud services.",
  AVGO:"Designs semiconductors and infrastructure software used across networking, connectivity, storage and enterprise IT environments.",
  NOW:"Provides cloud-based enterprise workflow software that helps organizations automate IT, employee and customer processes.",
  UBER:"Operates a global technology platform connecting consumers with drivers, couriers and merchants across mobility, delivery and related services.",
  MELI:"Operates a Latin American commerce and financial-services ecosystem spanning e-commerce, payments, logistics, advertising and credit.",
  NU:"Provides digital banking and financial services to consumers and businesses across Latin America.",
  CRWV:"Provides cloud infrastructure optimized for artificial intelligence and accelerated computing, including access to large-scale GPU capacity.",
  NBIS:"Builds AI-focused cloud infrastructure and provides compute, storage and related services for artificial-intelligence workloads.",
  OUST:"Develops lidar sensors and perception software used for robotics, industrial automation, automotive and other physical-world applications.",
  APP:"Provides mobile advertising and software-based monetization technology connecting app developers, advertisers and consumers.",
  CRDO:"Develops high-speed connectivity products and semiconductors that move data between processors, networking equipment and data-center infrastructure.",
  RKLB:"Provides space launch services and develops spacecraft, satellite systems and other space infrastructure.",
  GRAB:"Operates a Southeast Asian super-app spanning mobility, food and grocery delivery, digital payments and financial services.",
  BN:"Owns and operates an alternative-asset management and investment platform spanning infrastructure, real estate, renewable power, private equity and credit.",
  BSX:"Develops and manufactures medical devices, particularly products used in cardiovascular and other minimally invasive procedures."
 };
 if(d[t])return d[t];
 const s=(u?.sector||"").toLowerCase();
 const templates={
  "information technology":`${u?.name||t} develops technology products and services used by businesses or consumers, with its activities focused on the information-technology sector.`,
  "health care":`${u?.name||t} develops, provides or distributes healthcare products and services, serving patients, providers or other healthcare organizations.`,
  "financials":`${u?.name||t} provides financial products or services such as banking, payments, insurance, lending, investment or financial infrastructure.`,
  "consumer discretionary":`${u?.name||t} sells consumer products or services, with its business focused primarily on discretionary spending and consumer demand.`,
  "consumer staples":`${u?.name||t} provides everyday consumer products or services, including goods that tend to be purchased relatively consistently across economic cycles.`,
  "communication services":`${u?.name||t} operates in communications, media, entertainment or internet-related services, connecting users, advertisers or content providers.`,
  "industrials":`${u?.name||t} provides industrial products, equipment, infrastructure or specialized services to businesses and other organizations.`,
  "energy":`${u?.name||t} operates in the energy industry, developing, producing, transporting, supplying or servicing energy and related infrastructure.`,
  "materials":`${u?.name||t} produces or supplies raw materials, chemicals, metals or other inputs used across industrial and consumer supply chains.`,
  "real estate":`${u?.name||t} owns, develops, manages or finances real-estate assets and related property businesses.`,
  "utilities":`${u?.name||t} provides essential utility services or develops and operates infrastructure for electricity, gas, water or related services.`
 };
 return templates[s]||`${u?.name||t} is a publicly traded company operating in the ${u?.sector||"business"} sector.`;
}
function msftResearch(){
 return {
  business:"Microsoft develops software, cloud infrastructure, AI products and digital services for consumers and enterprises. Its major businesses span Microsoft 365, Azure, Dynamics, LinkedIn, Windows, gaming, search and AI offerings.",
  financials:[
   ["FY2026 revenue","$331.8B","+18% YoY"],
   ["FY2026 operating income","$155.2B","+21% YoY"],
   ["FY2026 net income","$133.7B","+31% YoY"],
   ["FY2026 diluted EPS","$17.95","+32% YoY"],
   ["Microsoft Cloud revenue","$214.4B","+27% YoY"],
   ["Commercial RPO","$678B","+84% YoY"]
  ],
  history:[
   {year:"2023",revenue:211.915,operating:88.523,net:72.361,eps:9.68},
   {year:"2024",revenue:245.122,operating:109.433,net:88.136,eps:11.80},
   {year:"2025",revenue:281.724,operating:128.528,net:101.832,eps:13.64},
   {year:"2026",revenue:331.839,operating:155.157,net:133.680,eps:17.95}
  ],
  segments:[
   ["Productivity & Business Processes","Microsoft 365, LinkedIn, Dynamics and related services"],
   ["Intelligent Cloud","Azure, server products and enterprise cloud services"],
   ["More Personal Computing","Windows, gaming, search and devices"]
  ],
  thesis:[
   "Azure is the central growth engine: FY2026 Azure and other cloud services revenue grew 41%, while Q4 Azure growth was 43%.",
   "Microsoft has multiple ways to monetize AI through Azure, Microsoft 365 Copilot, GitHub Copilot and other first-party applications.",
   "Commercial remaining performance obligations reached $678B at FY2026 year-end.",
   "The key debate is how quickly AI infrastructure spending converts into durable revenue and cash-flow returns."
  ],
  risks:[
   "AI infrastructure requires very large ongoing capital investment and has pressured cloud gross margins.",
   "Competition remains intense across cloud, AI, productivity software and search.",
   "AI monetization and infrastructure utilization need to justify the scale of current investment.",
   "Regulatory, cybersecurity and privacy issues can affect products and operating costs."
  ]
 };
}
function msftFinancialsHtml(){
 const r=msftResearch();
 const max=Math.max(...r.history.map(x=>x.revenue));
 const bars=r.history.map(x=>`<div style="display:grid;grid-template-columns:42px 1fr;gap:7px;align-items:center;margin:8px 0"><b>${x.year}</b><div style="position:relative;height:28px;background:#0c121a;border-radius:7px;overflow:hidden"><i style="display:block;height:100%;width:${x.revenue/max*100}%;background:var(--blue);opacity:.8"></i><span style="position:absolute;left:8px;top:5px;font-size:12px;font-weight:750">$${x.revenue.toFixed(1)}B</span></div></div>`).join("");
 return `<div class="section"><div class="section-head"><div><span class="section-title">Financials</span><div class="muted small">FY2023–FY2026 • USD billions unless noted</div></div></div>
 <div class="cards">
  <div class="card"><div class="label">Revenue</div><div class="big">$${r.history.at(-1).revenue.toFixed(1)}B</div></div>
  <div class="card"><div class="label">Operating income</div><div class="big">$${r.history.at(-1).operating.toFixed(1)}B</div></div>
  <div class="card"><div class="label">Net income</div><div class="big">$${r.history.at(-1).net.toFixed(1)}B</div></div>
  <div class="card"><div class="label">Diluted EPS</div><div class="big">$${r.history.at(-1).eps.toFixed(2)}</div></div>
 </div>
 <div class="card" style="margin-top:9px"><div class="label">Revenue growth</div>${bars}</div>
 <div class="table-wrap" style="margin-top:9px"><table class="table"><thead><tr><th>FY</th><th>Revenue</th><th>Operating income</th><th>Net income</th><th>EPS</th></tr></thead><tbody>${r.history.map(x=>`<tr><td>${x.year}</td><td>$${x.revenue.toFixed(1)}B</td><td>$${x.operating.toFixed(1)}B</td><td>$${x.net.toFixed(1)}B</td><td>$${x.eps.toFixed(2)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function stock(t){
 const x=state.positions.find(p=>p.ticker===t), w=state.watchlist.find(p=>p.ticker===t), u=universe.find(p=>p.ticker===t), watched=isWatched(t);
 const desc=businessDescription(t,u);
 const ms=t==="MSFT"?msftResearch():null;
 $("#modal").innerHTML=`<div class="sheet"><div class="section-head"><div><div class="section-title">${t}</div><div class="muted">${u?.name||x?.ticker||w?.name||"Company"}</div></div><div><button class="btn" onclick="toggleWatch(&quot;${t}&quot;)">${watched?"★":"☆"} ${watched?"Watchlisted":"Add to watchlist"}</button> <button class="btn" onclick="closeModal()">×</button></div></div>
 <div class="section"><div class="card"><div class="label">What they do</div><div style="margin-top:6px;line-height:1.5">${desc}</div></div></div>
 ${x?`<div class="cards"><div class="card"><div class="label">Shares</div><div class="big">${x.shares.toFixed(4)}</div></div><div class="card"><div class="label">Price</div><div class="big">${money(x.price)}</div></div><div class="card"><div class="label">P/L</div><div class="big ${x.pl>=0?"green":"red"}">${money(x.pl)}</div></div><div class="card"><div class="label">Return</div><div class="big ${x.ret>=0?"green":"red"}">${pct(x.ret)}</div></div></div>`:""}
 ${ms?`<div class="section list">
 <button class="btn" type="button" onclick="toggleCompanySection('msft-financials')">Financials <span class="muted">▾</span></button>
 <div id="msft-financials" style="display:none">${msftFinancialsHtml()}</div>
 <button class="btn" type="button" onclick="toggleCompanySection('msft-segments')">Business segments <span class="muted">▾</span></button>
 <div id="msft-segments" style="display:none" class="section card">${ms.segments.map(a=>`<div class="list-item"><b>${a[0]}</b><span class="muted">${a[1]}</span></div>`).join("")}</div>
 <button class="btn" type="button" onclick="toggleCompanySection('msft-thesis')">Investment thesis <span class="muted">▾</span></button>
 <div id="msft-thesis" style="display:none" class="section card">${ms.thesis.map(a=>`<div class="list-item"><span>${a}</span></div>`).join("")}</div>
 <button class="btn" type="button" onclick="toggleCompanySection('msft-risks')">Key risks <span class="muted">▾</span></button>
 <div id="msft-risks" style="display:none" class="section card">${ms.risks.map(a=>`<div class="list-item"><span>${a}</span></div>`).join("")}</div>
 </div>`:`<div class="section list"><div class="list-item"><b>Valuation</b><span class="muted">Research layer</span></div><div class="list-item"><b>Thesis</b><span class="muted">Research layer</span></div><div class="list-item"><b>Catalysts & risks</b><span class="muted">Research layer</span></div></div>`}
 </div>`;
 $("#modal").classList.add("open");
}
function toggleCompanySection(id){const e=document.getElementById(id);if(e)e.style.display=e.style.display==="none"?"block":"none"}
}