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
async function loadFinancials(){try{financials=await fetch("financials.json").then(r=>r.json());if(current==="universe")render();}catch(e){console.error("Financial data load failed",e)}}
loadFinancials();
function companyFinancials(t){return financials[t]||null}
function financialChart(data){if(!data?.years?.length)return "<div class=\"muted small\">Financial history not available yet.</div>";const metrics=data.metrics||[];return metrics.map(m=>{const vals=m.values||[],max=Math.max(...vals.map(Number),1),first=Number(vals[0]||0),last=Number(vals[vals.length-1]||0),growth=first?((last/first)-1)*100:null;return '<div style="margin:16px 0;padding:12px;border:1px solid #303b4d;border-radius:10px;background:#0f1722"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:10px"><b>'+m.name+'</b><span>'+(m.unit==="$"?"$":"")+last.toFixed(m.unit==="$"?2:1)+(m.unit==="B"?"B":"")+(growth===null?"":" · "+(growth>=0?"+":"")+growth.toFixed(0)+"%")+'</span></div><div style="display:flex;align-items:flex-end;gap:8px;height:130px">'+vals.map((v,j)=>'<div style="flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center"><div style="font-size:10px;margin-bottom:4px">'+(m.unit==="$"?"$":"")+Number(v).toFixed(m.unit==="$"?2:1)+(m.unit==="B"?"B":"")+'</div><div style="width:70%;height:'+Math.max(8,(Number(v)/max)*100)+'px;background:#5b9cff;border-radius:5px 5px 0 0"></div><div style="font-size:10px;opacity:.6;margin-top:5px">'+data.years[j]+'</div></div>').join("")+'</div></div>'}).join("")}

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
function stock(t){
 const x=state.positions.find(p=>p.ticker===t), w=state.watchlist.find(p=>p.ticker===t), u=universe.find(p=>p.ticker===t), watched=isWatched(t);
 const r=t==="MSFT"?msftResearch():null;
 const fd=companyFinancials(t);
 const finId="fin-"+t, segId="seg-"+t, thesisId="thesis-"+t, riskId="risk-"+t;
 $("#modal").innerHTML=`<div class="sheet"><div class="section-head"><div><div class="section-title">${t}</div><div class="muted">${u?.name||x?.ticker||w?.name||"Company"}</div></div><div><button class="btn" onclick="toggleWatch(&quot;${t}&quot;)">${watched?"★":"☆"} ${watched?"Watchlisted":"Add to watchlist"}</button> <button class="btn" onclick="closeModal()">×</button></div></div>
 ${x?`<div class="cards"><div class="card"><div class="label">Shares</div><div class="big">${x.shares.toFixed(4)}</div></div><div class="card"><div class="label">Price</div><div class="big">${money(x.price)}</div></div><div class="card"><div class="label">P/L</div><div class="big ${x.pl>=0?"green":"red"}">${money(x.pl)}</div></div><div class="card"><div class="label">Return</div><div class="big ${x.ret>=0?"green":"red"}">${pct(x.ret)}</div></div></div>`:""}
 <div class="section"><div class="card"><div class="label">What they do</div><div style="margin-top:6px;line-height:1.5">${businessDescription(t,u)}</div></div></div>
 ${r?`<div class="section"><div class="section-head"><div><div class="section-title">Company research</div><div class="muted small">Tap a section to expand it</div></div></div>
 <div class="profile-section"><button class="profile-toggle" onclick="toggleProfileSection('${finId}')"><b>Financials</b><span>＋</span></button><div id="${finId}" class="profile-content" style="display:none">
   <div class="card"><div class="label">Historical financials</div><div class="muted small" style="margin:4px 0 10px">FY2023–FY2026 · USD billions except EPS</div>
   <div class="table-wrap"><table class="table"><thead><tr><th>Metric</th><th>FY2023</th><th>FY2024</th><th>FY2025</th><th>FY2026</th></tr></thead><tbody>
   <tr><td>Revenue</td><td>$211.9B</td><td>$245.1B</td><td>$281.7B</td><td>$331.8B</td></tr>
   <tr><td>Operating income</td><td>$88.5B</td><td>$109.4B</td><td>$128.5B</td><td>$155.2B</td></tr>
   <tr><td>Net income</td><td>$72.4B</td><td>$88.1B</td><td>$101.8B</td><td>$133.7B</td></tr>
   <tr><td>Diluted EPS</td><td>$9.68</td><td>$11.80</td><td>$13.64</td><td>$17.95</td></tr>
   </tbody></table></div></div>
   <div class="card" style="margin-top:10px"><div class="label">Growth visualization</div>${financialChart(fd)}</div>
   <div class="card" style="margin-top:10px">${r.financials.map(a=>`<div class="list-item"><b>${a[0]}</b><span>${a[1]} <span class="muted">${a[2]}</span></span></div>`).join("")}</div>
 </div></div>
 <div class="profile-section"><button class="profile-toggle" onclick="toggleProfileSection('${segId}')"><b>Business segments</b><span>＋</span></button><div id="${segId}" class="profile-content" style="display:none">${r.segments.map(a=>`<div class="list-item"><b>${a[0]}</b><span class="muted">${a[1]}</span></div>`).join("")}</div></div>
 <div class="profile-section"><button class="profile-toggle" onclick="toggleProfileSection('${thesisId}')"><b>Investment thesis</b><span>＋</span></button><div id="${thesisId}" class="profile-content" style="display:none">${r.thesis.map(a=>`<div class="list-item"><span>${a}</span></div>`).join("")}</div></div>
 <div class="profile-section"><button class="profile-toggle" onclick="toggleProfileSection('${riskId}')"><b>Key risks</b><span>＋</span></button><div id="${riskId}" class="profile-content" style="display:none">${r.risks.map(a=>`<div class="list-item"><span>${a}</span></div>`).join("")}</div></div>
 </div>`:""}
 <div class="section list"><div class="list-item"><b>Valuation</b><span class="muted">Coming later</span></div><div class="list-item"><b>Research & catalysts</b><span class="muted">Coming later</span></div></div></div>`;
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
window.stock=stock;window.openStockFromButton=(e,t)=>{e.preventDefault();e.stopPropagation();stock(t)};window.openTx=openTx;window.closeModal=closeModal;window.saveTx=saveTx;window.nav=nav;window.filterHold=filterHold;window.allocationAmount=allocationAmount;window.showMore=showMore;window.importBroker=importBroker;window.filterUniverse=filterUniverse;window.filterUniverseSector=filterUniverseSector;window.filterUniverseIndex=filterUniverseIndex;window.toggleWatch=toggleWatch;
save();render();
if("serviceWorker" in navigator){navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())).catch(()=>{});}