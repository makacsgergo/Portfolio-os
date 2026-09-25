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
let financials={};
async function loadFinancials(){try{financials=await fetch("financials.json?ts="+Date.now(),{cache:"no-store"}).then(r=>r.json());if(current==="universe")render();}catch(e){console.error("Financial data load failed",e)}}
loadFinancials();
function companyFinancials(t){return financials[t]||null}
function financialChart(data,selectedName,ticker){
 const metrics=(data?.metrics||[]).filter(m=>(m.category||"income_statement")!=="balance_sheet"&&(m.values||[]).some(v=>v!=null&&Number.isFinite(Number(v))));
 if(!data?.years?.length||!metrics.length)return '<div class="financial-empty">Financial history is not available yet.</div>';
 const preferred=["Revenue","Operating income","Free cash flow","Diluted EPS","Net income"];
 const selected=metrics.find(m=>m.name===selectedName)||preferred.map(n=>metrics.find(m=>m.name===n)).find(Boolean)||metrics[0];
 const values=data.years.map((_,i)=>selected.values?.[i]==null?null:Number(selected.values[i]));
 const valid=values.filter(v=>v!=null&&Number.isFinite(v)),min=Math.min(...valid),max=Math.max(...valid),span=max-min||Math.max(Math.abs(max)*0.08,1);
 const left=104,right=766,top=28,bottom=174,xAt=i=>left+i*((right-left)/Math.max(1,values.length-1)),yAt=v=>bottom-((v-min)/span)*(bottom-top);
 const points=values.map((v,i)=>v==null?null:xAt(i)+","+yAt(v)).filter(Boolean).join(" ");
 const circles=values.map((v,i)=>v==null?"":'<circle cx="'+xAt(i)+'" cy="'+yAt(v)+'" r="4"><title>'+data.years[i]+': '+finFmt(v,selected.unit)+'</title></circle>').join("");
 let latestIndex=-1; for(let i=values.length-1;i>=0;i--)if(values[i]!=null){latestIndex=i;break}
 const latest=latestIndex>=0?finFmt(values[latestIndex],selected.unit):"—";
 const options=metrics.map(m=>'<option value="'+m.name.replace(/"/g,"&quot;")+'" '+(m.name===selected.name?"selected":"")+'>'+m.name+'</option>').join("");
 const yLabels=[0,1,2,3,4].map(i=>{const v=max-(span*i/4);const y=top+(bottom-top)*i/4;return '<g><line class="financial-chart-grid" x1="'+left+'" y1="'+y+'" x2="'+right+'" y2="'+y+'"></line><text class="financial-chart-axis-label" x="'+(left-10)+'" y="'+(y+4)+'" text-anchor="end">'+finFmt(v,selected.unit)+'</text></g>'}).join("");
 const yearLabels=data.years.map((y,i)=>'<text class="financial-chart-year-label" x="'+xAt(i)+'" y="204" text-anchor="middle">'+y+'</text>').join("");
 const delta=valid.length>1&&valid[0]!==0?((valid[valid.length-1]/valid[0]-1)*100):null;
 return '<div class="financial-chart" id="financial-chart-'+ticker+'"><div class="financial-chart-head"><div><div class="financial-chart-eyebrow">FINANCIAL TREND</div><div class="financial-chart-title">'+selected.name+'</div></div><label class="financial-chart-select-label">Metric<select aria-label="Select financial chart metric" onchange="renderFinancialChart(&quot;'+ticker+'&quot;,this.value)">'+options+'</select></label></div><div class="financial-chart-current"><strong>'+latest+'</strong><span>FY '+(data.years[latestIndex]||"—")+'</span>'+(delta===null?"":'<span class="'+(delta>=0?"positive":"negative")+'">'+(delta>=0?"+":"")+delta.toFixed(1)+"% across history</span>")+'</div><div class="financial-chart-plot"><svg viewBox="0 0 780 220" role="img" aria-label="'+selected.name+' trend over '+data.years.length+' fiscal years, with value scale and annual labels" preserveAspectRatio="none">'+yLabels+'<polyline points="'+points+'"></polyline>'+circles+yearLabels+'</svg></div><div class="financial-chart-caption">Annual SEC-reported values · '+(selected.unit==="B"||selected.unit==="M"?"USD "+selected.unit:"reported unit")+' · Hover a point for its exact value</div></div>';
}
function renderFinancialChart(ticker,name){
 const host=document.getElementById("financial-chart-"+ticker);
 if(host)host.outerHTML=financialChart(companyFinancials(ticker),name,ticker);
}


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
 const t=total(),p=totalPL(),cost=t-p,positions=[...state.positions].sort((a,b)=>b.value-a.value),top=positions.slice(0,5);
 const returnPct=cost?p/cost*100:0,topThree=positions.slice(0,3).reduce((n,x)=>n+x.value,0),concentration=t?topThree/t*100:0;
 return `<div class="dashboard">
 <div class="dashboard-heading"><div><div class="dashboard-kicker">PORTFOLIO OVERVIEW</div><h1>Your portfolio</h1><p>Performance, positions and capital allocation at a glance.</p></div><div class="dashboard-actions"><button class="btn" onclick="nav('holdings')">View holdings <span aria-hidden="true">→</span></button><button class="btn primary" onclick="openTx()">＋ Transaction</button></div></div>
 <div class="dashboard-metrics">
  <div class="dashboard-value"><div class="label">Market value</div><div class="dashboard-total">${money(t)}</div><div class="dashboard-note">${state.positions.length} active position${state.positions.length===1?"":"s"}</div></div>
  <div class="dashboard-stat"><div class="label">Unrealized P/L</div><div class="dashboard-stat-value ${p>=0?"green":"red"}">${money(p)}</div><div class="dashboard-note">Cost basis ${money(cost)}</div></div>
  <div class="dashboard-stat"><div class="label">Return on cost</div><div class="dashboard-stat-value ${returnPct>=0?"green":"red"}">${pct(returnPct)}</div><div class="dashboard-note">Across current holdings</div></div>
  <div class="dashboard-stat"><div class="label">Largest three</div><div class="dashboard-stat-value">${concentration.toFixed(1)}%</div><div class="dashboard-note">Portfolio concentration</div></div>
 </div>
 <div class="dashboard-panels">
  <section class="dashboard-panel dashboard-holdings"><div class="section-head"><div><div class="section-title">Largest positions</div><div class="muted small">Market value and portfolio weight</div></div><button class="btn dashboard-quiet" onclick="nav('holdings')">All holdings →</button></div>
  ${top.length?'<div class="dashboard-table-wrap"><table class="table dashboard-table"><thead><tr><th>Holding</th><th>Shares</th><th>Market value</th><th>Weight</th><th>Unrealized P/L</th></tr></thead><tbody>'+top.map(x=>'<tr onclick="stock(\''+x.ticker+'\')"><td><span class="dashboard-symbol">'+x.ticker+'</span><span class="dashboard-company">'+(universe.find(u=>u.ticker===x.ticker)?.name||x.ticker)+'</span></td><td>'+Number(x.shares||0).toFixed(3)+'</td><td>'+money(x.value)+'</td><td>'+(t?x.value/t*100:0).toFixed(1)+'%</td><td class="'+(x.pl>=0?"green":"red")+'">'+money(x.pl)+'</td></tr>').join("")+'</tbody></table></div>':'<div class="dashboard-empty"><div class="dashboard-empty-title">Your portfolio starts here</div><p>Add a transaction to see holdings, performance and allocation.</p><button class="btn primary" onclick="openTx()">＋ Add your first position</button></div>'}
  </section>
  <section class="dashboard-panel dashboard-allocation"><div class="section-head"><div><div class="section-title">Portfolio mix</div><div class="muted small">Position weights by market value</div></div><button class="btn dashboard-quiet" onclick="nav('allocate')">Allocation →</button></div>
  ${top.length?top.map((x,i)=>'<button class="dashboard-allocation-row" onclick="stock(\''+x.ticker+'\')"><span class="dashboard-dot dashboard-dot-'+i+'"></span><span class="dashboard-allocation-name">'+x.ticker+'</span><span class="dashboard-bar"><i style="width:'+Math.min(100,t?x.value/t*100:0)+'%"></i></span><span class="dashboard-weight">'+(t?x.value/t*100:0).toFixed(1)+'%</span></button>').join(""):'<div class="dashboard-empty dashboard-empty-compact">Allocation appears when you add holdings.</div>'}
  ${top.length?'<div class="dashboard-allocation-footer"><span>'+positions.length+' positions</span><span>Top three · '+concentration.toFixed(1)+'%</span></div>':""}</section>
 </div>
 <section class="dashboard-watch"><div><div class="section-title">Research watchlist</div><div class="muted small">Continue exploring companies you follow.</div></div><div class="dashboard-watch-items">${state.watchlist.slice(0,4).map(x=>'<button class="dashboard-watch-chip" onclick="stock(\''+x.ticker+'\')"><b>'+x.ticker+'</b><span>'+(x.name||"Company research")+'</span><span aria-hidden="true">↗</span></button>').join("")}${state.watchlist.length>4?'<button class="dashboard-watch-more" onclick="nav(\'watchlist\')">+'+(state.watchlist.length-4)+' more</button>':""}</div></section>
 </div>`;
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
function toggleWatch(t,keepStock=false){
 const u=universe.find(x=>x.ticker===t),wasWatched=isWatched(t);
 if(wasWatched)state.watchlist=state.watchlist.filter(x=>x.ticker!==t);
 else if(u)state.watchlist.push({ticker:t,name:u.name});
 else return;
 save();
 if(keepStock)stock(t);else render();
 toast(wasWatched?t+" removed from watchlist":t+" added to watchlist");
}
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
   ["FY2026 net income","$133.7B","+31% YoY GAAP"],
   ["FY2026 diluted EPS","$17.95","+32% YoY"],
   ["Microsoft Cloud revenue","$214.4B","+27% YoY"],
   ["Azure & other cloud","—","+41% FY2026"],
   ["Commercial RPO","$678B","+84% YoY"],
   ["FY2026 cash returned","$43B+","dividends + buybacks"]
  ],
  segments:[
   ["Productivity & Business Processes","Microsoft 365, LinkedIn, Dynamics and related services"],
   ["Intelligent Cloud","Azure, server products and enterprise cloud services"],
   ["More Personal Computing","Windows, gaming, search and devices"]
  ],
  thesis:[
   "Azure is the central growth engine: FY2026 Azure and other cloud services revenue grew 41%, while Q4 Azure growth was 43%.",
   "Microsoft has multiple ways to monetize AI through Azure, Microsoft 365 Copilot, GitHub Copilot and other first-party applications.",
   "The commercial backlog is substantial: remaining performance obligations reached $678B at FY2026 year-end.",
   "The main debate is not whether demand exists, but how quickly AI infrastructure spending converts into durable revenue and cash-flow returns."
  ],
  risks:[
   "AI infrastructure requires very large ongoing capital investment and has pressured cloud gross margins.",
   "Competition remains intense across cloud, AI, productivity software and search.",
   "AI monetization and infrastructure utilization need to justify the scale of current investment.",
   "Regulatory, cybersecurity and privacy issues can affect products and operating costs."
  ]
 };
}
function toggleProfileSection(id){const el=document.getElementById(id);if(el)el.style.display=el.style.display==="none"?"block":"none";}
function msftHistoryChart(){return financialChart(companyFinancials("MSFT"))}
function finFmt(v,u){if(v==null)return "—";if(u==="$")return "$"+Number(v).toFixed(2);if(u==="B")return Number(v).toFixed(2)+"B";if(u==="M")return Number(v).toFixed(1)+"M";if(u==="%")return (Number(v)*100).toFixed(1)+"%";if(u==="x")return Number(v).toFixed(2)+"x";return Number(v).toFixed(2)}
function financialSections(fd){
 const years=fd.years||[];
 const groups=[["Income statement","income_statement",true],["Cash flow","cash_flow",false],["Ratios & growth","ratios",false]];
 const table=(metrics,columns)=>'<div class="financial-table-wrap"><table class="table financial-table"><thead><tr><th>Metric</th>'+columns.map(c=>'<th>'+c.year+'</th>').join("")+'</tr></thead><tbody>'+metrics.map(m=>'<tr><th scope="row">'+m.name+'</th>'+columns.map(c=>'<td>'+finFmt(m.values?.[c.index],m.unit)+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
 const annual=groups.map(([title,cat,open])=>{
  const metrics=(fd.metrics||[]).filter(m=>(m.category||"income_statement")===cat);
  if(!metrics.length)return "";
  const recent=years.map((year,index)=>({year,index})).slice(-5);
  const full=years.map((year,index)=>({year,index}));
  return '<details class="financial-group" '+(open?"open":"")+'><summary><span>'+title+'</span><small>'+metrics.length+' metrics · '+years.length+' fiscal years</small><span class="financial-chevron" aria-hidden="true">⌄</span></summary><div class="financial-group-content"><div class="financial-table-note">Latest 5 fiscal years · all values retain their reported units</div>'+table(metrics,recent)+'<details class="financial-history"><summary>View full history · '+years.length+' years</summary>'+table(metrics,full)+'</details></div></details>';
 }).join("");
 const ttm=fd.latest_reported?.ttm||{};
 const ttmLabels={revenue:"Revenue",operating_income:"Operating income",net_income:"Net income",cfo:"Operating cash flow",capex:"Capital expenditures",fcf:"Free cash flow",rnd:"R&D",da:"D&A"};
 const ttmRows=Object.entries(ttmLabels).filter(([k])=>ttm[k]&&ttm[k].value!=null).map(([k,label])=>'<tr><th scope="row">'+label+'</th><td>'+finFmt(ttm[k].value,ttm[k].unit)+'</td></tr>').join("");
 const latest=fd.latest_reported?.metrics||{};
 const latestLabels={cash:"Cash",debt_current:"Current debt",debt_noncurrent:"Long-term debt",assets:"Total assets",equity:"Total equity",shares_outstanding:"Shares outstanding"};
 const latestRows=Object.entries(latestLabels).filter(([k])=>latest[k]&&latest[k].value!=null).map(([k,label])=>'<tr><th scope="row">'+label+'</th><td>'+finFmt(latest[k].value,latest[k].unit)+'</td></tr>').join("");
 const ratios=fd.latest_reported?.ratios||{};
 const ratioLabels={debt_equity:"Debt / equity",net_debt:"Net debt",net_debt_ebitda:"Net debt / EBITDA",net_debt_ebitda_ttm:"Net debt / TTM EBITDA",roic:"Approx. ROIC",roic_ttm:"Approx. ROIC (TTM)",roe:"ROE",roe_ttm:"ROE (TTM)",fcf_margin_ttm:"FCF margin (TTM)"};
 const ratioRows=Object.entries(ratioLabels).filter(([k])=>ratios[k]&&ratios[k].value!=null).map(([k,label])=>'<tr><th scope="row">'+label+'</th><td>'+finFmt(ratios[k].value,ratios[k].unit)+'</td></tr>').join("");
 const methods=Object.entries(ratioLabels).filter(([k])=>ratios[k]&&ratios[k].method).map(([k,label])=>'<li><b>'+label+':</b> '+ratios[k].method+'</li>').join("");
 const balanceMeta=fd.latest_reported||{};
 const supporting='<div class="financial-support-grid">'+(ttmRows?'<details class="financial-group"><summary><span>Trailing twelve months</span><small>Through '+(ttm.period_end||balanceMeta.period_end||"—")+'</small><span class="financial-chevron" aria-hidden="true">⌄</span></summary><div class="financial-group-content"><div class="financial-table-wrap"><table class="table financial-table"><thead><tr><th>Metric</th><th>TTM</th></tr></thead><tbody>'+ttmRows+'</tbody></table></div></div></details>':"")+(latestRows||ratioRows?'<details class="financial-group"><summary><span>Balance sheet & ratios</span><small>'+(balanceMeta.label||balanceMeta.period_end||"Latest reported")+'</small><span class="financial-chevron" aria-hidden="true">⌄</span></summary><div class="financial-group-content"><div class="financial-table-note">Point-in-time balance-sheet data · period end '+(balanceMeta.period_end||"—")+' · filed '+(balanceMeta.filed||"—")+'</div>'+(latestRows?'<div class="financial-table-wrap"><table class="table financial-table"><thead><tr><th>Balance-sheet metric</th><th>Latest</th></tr></thead><tbody>'+latestRows+'</tbody></table></div>':"")+(ratioRows?'<div class="financial-subheading">Latest ratios</div><div class="financial-table-wrap"><table class="table financial-table"><thead><tr><th>Metric</th><th>Latest</th></tr></thead><tbody>'+ratioRows+'</tbody></table></div>':"")+(methods?'<details class="financial-methods"><summary>Calculation notes</summary><ul>'+methods+'</ul><p>Net debt / EBITDA and ROIC use the latest fiscal-year income-statement denominator until TTM data is added.</p></details>':"")+'</div></details>':"")+'</div>';
 const source='<details class="financial-source"><summary>Sources & methodology</summary><p>Financial statements: SEC XBRL companyfacts. Historical diluted EPS is retrospectively adjusted for detected stock splits so every year is shown on the current share basis.</p><p>Price source: Yahoo Finance chart endpoint.</p></details>';
 return '<div class="financial-history-list">'+annual+supporting+source+'</div>';
}
function financialHighlights(fd){
 const metrics=fd.metrics||[];
 const picks=[["revenue","Revenue"],["operating income","Operating income"],["free cash flow","Free cash flow"],["diluted eps","Diluted EPS"]];
 const cards=picks.map(([needle,label])=>{
  const m=metrics.find(x=>(x.name||"").toLowerCase().includes(needle));
  if(!m)return "";
  let index=-1;for(let i=(m.values||[]).length-1;i>=0;i--)if(m.values[i]!=null){index=i;break}
  if(index<0)return "";
  return '<div class="financial-highlight"><span>'+label+'</span><b>'+finFmt(m.values[index],m.unit)+'</b><small>FY '+(fd.years[index]||"—")+'</small></div>';
 }).filter(Boolean).join("");
 return cards?'<div class="financial-highlights">'+cards+'</div>':"";
}
function scrollStockSection(id,button){
 const target=document.getElementById(id);
 if(!target)return;
 target.scrollIntoView({behavior:"smooth",block:"start"});
 const nav=button?.parentElement;
 if(nav)nav.querySelectorAll("button").forEach(b=>b.classList.remove("active"));
 if(button)button.classList.add("active");
}
function stock(t){
 const x=state.positions.find(p=>p.ticker===t),w=state.watchlist.find(p=>p.ticker===t),u=universe.find(p=>p.ticker===t),watched=isWatched(t);
 const research=t==="MSFT"?msftResearch():null,fd=companyFinancials(t),latestPrice=fd?.price;
 const financialId="financials-"+t,researchId="research-"+t;
 const companyName=u?.name||w?.name||t;
 const priceCards=latestPrice!=null?'<div class="stock-market-grid"><div class="stock-market-card stock-market-primary"><span>Market price</span><b>'+money(latestPrice)+'</b><small>Updated '+(fd.price_updated_utc?new Date(fd.price_updated_utc).toLocaleString():"recently")+'</small></div>'+(x?'<div class="stock-market-card"><span>Shares held</span><b>'+Number(x.shares||0).toFixed(4)+'</b></div><div class="stock-market-card"><span>Position value</span><b>'+money((x.shares||0)*latestPrice)+'</b></div><div class="stock-market-card"><span>Unrealized P/L</span><b class="'+(x.pl>=0?"positive":"negative")+'">'+money(x.pl)+'</b><small>'+pct(x.ret)+'</small></div>':"")+'</div>':(x?'<div class="stock-market-grid"><div class="stock-market-card"><span>Shares held</span><b>'+Number(x.shares||0).toFixed(4)+'</b></div><div class="stock-market-card"><span>Last saved price</span><b>'+money(x.price)+'</b></div><div class="stock-market-card"><span>Unrealized P/L</span><b class="'+(x.pl>=0?"positive":"negative")+'">'+money(x.pl)+'</b><small>'+pct(x.ret)+'</small></div></div>':"");
 const financialContent=fd?'<section class="stock-section" id="'+financialId+'"><div class="stock-section-heading"><div><div class="stock-section-kicker">FUNDAMENTALS</div><h2>Financials</h2><p>Reported annual results, trailing figures and balance-sheet data.</p></div><span class="data-source-badge">SEC XBRL</span></div>'+financialHighlights(fd)+financialChart(fd,null,t)+'<div class="financial-detail-heading"><div><h3>Detailed statements</h3><p>Choose a section to open. Tables start with the latest five years.</p></div></div>'+financialSections(fd)+'</section>':'<section class="stock-section" id="'+financialId+'"><div class="stock-section-heading"><div><div class="stock-section-kicker">FUNDAMENTALS</div><h2>Financials</h2></div></div><div class="financial-empty">Financial history is not available for this company yet.</div></section>';
 const researchContent=research?'<section class="stock-section" id="'+researchId+'"><div class="stock-section-heading"><div><div class="stock-section-kicker">COMPANY NOTES</div><h2>Business & investment notes</h2><p>Company-specific context for further review.</p></div></div><details class="research-group"><summary>Business segments <small>'+research.segments.length+' segments</small></summary><div class="research-segments">'+research.segments.map(a=>'<article><b>'+a[0]+'</b><span>'+a[1]+'</span></article>').join("")+'</div></details><details class="research-group"><summary>Investment thesis <small>'+research.thesis.length+' points</small></summary><ul>'+research.thesis.map(a=>'<li>'+a+'</li>').join("")+'</ul></details><details class="research-group"><summary>Key risks <small>'+research.risks.length+' items</small></summary><ul>'+research.risks.map(a=>'<li>'+a+'</li>').join("")+'</ul></details></section>':"";
 const nav='<nav class="stock-detail-nav" aria-label="Company sections"><button class="active" onclick="scrollStockSection(&quot;overview-'+t+'&quot;,this)">Overview</button>'+(fd?'<button onclick="scrollStockSection(&quot;'+financialId+'&quot;,this)">Financials</button>':"")+(research?'<button onclick="scrollStockSection(&quot;'+researchId+'&quot;,this)">Business & notes</button>':"")+'</nav>';
 $("#modal").innerHTML='<div class="sheet stock-sheet" role="dialog" aria-modal="true" aria-label="'+t+' company details"><div class="section-head stock-heading"><div><div class="stock-overline">COMPANY RESEARCH</div><h1>'+t+'</h1><div class="muted">'+companyName+(u?.sector?' <span class="stock-sector-separator">·</span> '+u.sector:"")+'</div></div><div class="stock-heading-actions"><button class="btn" onclick="toggleWatch(&quot;'+t+'&quot;,true)">'+(watched?"★ Watchlisted":"☆ Add to watchlist")+'</button><button class="btn stock-close" aria-label="Close company details" onclick="closeModal()">×</button></div></div>'+nav+'<section class="stock-section stock-overview" id="overview-'+t+'">'+priceCards+'<article class="company-description"><div class="stock-section-kicker">WHAT THE COMPANY DOES</div><p>'+businessDescription(t,u)+'</p></article></section>'+financialContent+researchContent+'</div>';
 $("#modal").classList.add("open");
}
function openTx(){
 $("#modal").innerHTML=`<div class="sheet"><div class="section-head"><b>Add transaction</b><button class="btn" onclick="closeModal()">×</button></div>
 <div class="form"><label>Ticker<input id="tt" placeholder="AVGO"></label><label>Type<select id="typ"><option>BUY</option><option>SELL</option><option>DIVIDEND</option><option>DEPOSIT</option><option>WITHDRAWAL</option></select></label><label>Quantity<input id="qq" type="number" step="0.000001"></label><label>Price<input id="pp" type="number" step="0.01"></label><label class="span2">Date<input id="dd" type="date" value="${new Date().toISOString().slice(0,10)}"></label></div>
 <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:15px"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveTx()">Save transaction</button></div></div>`;
 $("#modal").classList.add("open");
}
function saveTx(){
 let x={ticker:$("#tt").value.trim().toUpperCase(),type:$("#typ").value,qty:+$("#qq").value||0,price:+$("#pp").value||0,date:$("#dd").value};
 if(!x.ticker||!x.date)return toast("Ticker and date required");
 if(["BUY","SELL"].includes(x.type)&&(!x.qty||x.qty<=0))return toast("Enter a quantity greater than 0");
 if(["BUY","SELL"].includes(x.type)&&(!x.price||x.price<=0))return toast("Enter a price greater than 0");
 state.transactions.push(x);
 applyTransaction(x);
 x.applied=true;
 save();
 closeModal();
 render();
 toast(x.type==="BUY"?x.ticker+" added to portfolio":x.type==="SELL"?x.ticker+" position updated":"Transaction saved");
}
function closeModal(){$("#modal").classList.remove("open")}
function toast(s){let x=$("#toast");x.textContent=s;x.style.display="block";setTimeout(()=>x.style.display="none",1800)}
function allocationAmount(){let s=prompt("How much new capital (USD)?");let n=Number(s);if(!n||n<=0)return;alert(state.allocation.map(x=>`${x.ticker}: ${money(n*x.pct/100)}`).join("\n"))}
function showMore(){alert("More features coming: live quotes, broker sync, performance history, valuation models and AI research.")}
function importBroker(){
 const input=document.createElement("input"); input.type="file"; input.accept=".csv,text/csv";
 input.onchange=()=>{const f=input.files?.[0]; if(!f)return; const r=new FileReader(); r.onload=()=>{try{
  const rows=parseCSV(String(r.result||"")); const by={};
  for(const row of rows){const ticker=(row.Symbol||row.symbol||"").trim(); const type=(row["Transaction Type"]||row.transaction_type||"").trim().toUpperCase(); const qty=Number(row.Quantity||row.quantity||0); const px=Number(row["Purchase Price"]||row.purchase_price||0); const cur=Number(row["Current Price"]||row.current_price||0); if(!ticker||ticker==="$$CASH_TX"||type!=="BUY"||!qty)continue; if(!by[ticker])by[ticker]={ticker,shares:0,cost:0,price:cur||px}; by[ticker].shares+=qty; by[ticker].cost+=qty*px; if(cur)by[ticker].price=cur;}
  const positions=Object.values(by).map(x=>{const value=x.shares*x.price; const pl=value-x.cost; return {...x,value,pl,ret:x.cost?pl/x.cost*100:0}});
  state.positions=positions; save(); render(); toast(`Imported ${positions.length} positions locally.`);
 }catch(e){toast("Could not read that CSV.")}}; r.readAsText(f)}; input.click();
}
function parseCSV(text){const lines=text.split(/\r?\n/).filter(Boolean); if(!lines.length)return[]; const parseLine=line=>{const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q}else if(c===','&&!q){out.push(cur);cur=""}else cur+=c}out.push(cur);return out}; const h=parseLine(lines[0]); return lines.slice(1).map(l=>{const v=parseLine(l); return Object.fromEntries(h.map((k,i)=>[k,v[i]??""]))})}
window.stock=stock;window.openStockFromButton=(e,t)=>{e.preventDefault();e.stopPropagation();stock(t)};window.openTx=openTx;window.closeModal=closeModal;window.saveTx=saveTx;window.nav=nav;window.filterHold=filterHold;window.allocationAmount=allocationAmount;window.showMore=showMore;window.importBroker=importBroker;window.filterUniverse=filterUniverse;window.filterUniverseSector=filterUniverseSector;window.filterUniverseIndex=filterUniverseIndex;window.toggleWatch=toggleWatch;window.renderFinancialChart=renderFinancialChart;window.scrollStockSection=scrollStockSection;
save();render();
if("serviceWorker" in navigator){navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())).catch(()=>{});}