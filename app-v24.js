const S=window.PORTFOLIO_SEED;
const KEY="portfolio_os_v2";
const THEME_KEY="portfolio_os_theme";
let state=JSON.parse(localStorage.getItem(KEY)||"null")||structuredClone(S);
let current="home";
function isDark(){
 const saved=localStorage.getItem(THEME_KEY);
 return saved?saved==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function applyThemeMeta(){
 const m=document.querySelector('meta[name="theme-color"]');
 if(m)m.setAttribute("content",isDark()?"#0b1310":"#eef3ef");
}
(function(){const saved=localStorage.getItem(THEME_KEY); if(saved)document.documentElement.setAttribute("data-theme",saved); applyThemeMeta();})();
function toggleTheme(){
 localStorage.setItem(THEME_KEY,isDark()?"light":"dark");
 document.documentElement.setAttribute("data-theme",isDark()?"dark":"light");
 applyThemeMeta();
 render();
}
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
let prices=null,pricesLoading=false;
async function loadPrices(){
 if(prices||pricesLoading)return;
 pricesLoading=true;
 try{prices=await fetch("prices.json?ts="+Date.now(),{cache:"no-store"}).then(r=>r.json())}
 catch(e){console.error("Price history load failed",e);prices={tickers:{}}}
 pricesLoading=false;
 if(current==="home")render();
}
function performanceSeries(){
 const txs=[...(state.transactions||[])].filter(x=>["BUY","SELL"].includes(x.type)&&x.date&&x.ticker).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
 if(!txs.length||!prices)return null;
 const tickers=[...new Set(txs.map(x=>x.ticker))];
 const priceMaps={};
 tickers.forEach(t=>{
  const s=prices.tickers?.[t];
  if(!s)return;
  const m={};
  s.dates.forEach((d,i)=>{if(s.closes[i]!=null)m[d]=s.closes[i]});
  priceMaps[t]=m;
 });
 const dateSet=new Set();
 Object.values(priceMaps).forEach(m=>Object.keys(m).forEach(d=>dateSet.add(d)));
 const earliest=txs[0].date;
 const dates=[...dateSet].filter(d=>d>=earliest).sort();
 if(!dates.length)return null;
 const shares={},lastClose={};
 let ti=0;
 return dates.map(d=>{
  while(ti<txs.length&&txs[ti].date<=d){const x=txs[ti];shares[x.ticker]=(shares[x.ticker]||0)+(x.type==="BUY"?x.qty:-x.qty);ti++}
  let value=0;
  for(const t of tickers){
   const sh=shares[t]||0;
   if(sh<=0)continue;
   const pm=priceMaps[t];
   if(pm&&pm[d]!=null)lastClose[t]=pm[d];
   const px=lastClose[t];
   if(px!=null)value+=sh*px;
  }
  return{date:d,value};
 });
}
function fmtShortDate(iso){return new Date(iso+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}
function performanceChartHtml(){
 const hasTx=(state.transactions||[]).some(x=>["BUY","SELL"].includes(x.type));
 if(!hasTx)return{filled:false,html:"Add a transaction to see your performance history."};
 if(!prices)return{filled:false,html:"Loading price history…"};
 const pts=performanceSeries();
 if(!pts||pts.length<2)return{filled:false,html:"Price history not available yet for your holdings."};
 const w=600,h=140,pad=6;
 const vals=pts.map(p=>p.value);
 const min=Math.min(...vals),max=Math.max(...vals),range=(max-min)||1;
 const stepX=(w-pad*2)/(pts.length-1);
 const xy=pts.map((p,i)=>[pad+i*stepX,h-pad-((p.value-min)/range)*(h-pad*2)]);
 const line=xy.map((p,i)=>(i===0?"M":"L")+p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
 const area=line+` L${xy[xy.length-1][0].toFixed(1)},${h-pad} L${xy[0][0].toFixed(1)},${h-pad} Z`;
 const first=vals[0],last=vals[vals.length-1],chg=first?((last/first)-1)*100:0,up=last>=first;
 const color=up?"var(--green)":"var(--red)";
 return{filled:true,html:`<div class="perf-head"><div><b class="${up?"green":"red"}">${money(last)}</b> <span class="muted small">${pct(chg)}</span></div><span class="muted small">since ${fmtShortDate(pts[0].date)}</span></div>
 <svg class="perf-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${area}" fill="${color}" opacity=".16" stroke="none"></path><path d="${line}" fill="none" stroke="${color}" stroke-width="2"></path></svg>
 <div class="perf-range muted small"><span>${fmtShortDate(pts[0].date)}</span><span>${fmtShortDate(pts[pts.length-1].date)}</span></div>`};
}
function chartableMetrics(fd){return (fd?.metrics||[]).filter(m=>(m.category||"income_statement")!=="balance_sheet"&&(m.values||[]).some(v=>v!=null))}
function interactiveChartHtml(fd,t){
 const opts=chartableMetrics(fd);
 if(!fd?.years?.length||!opts.length)return '<div class="muted small">Financial history not available yet.</div>';
 const chosen=opts.find(m=>m.name===window.profileMetric)||opts.find(m=>m.name==="Revenue")||opts[0];
 window.profileMetric=chosen.name;
 const maxYears=fd.years.length;
 const rangeOpts=[...new Set([5,10,maxYears].filter(n=>n>0&&n<=maxYears))].sort((a,b)=>a-b);
 let range=window.profileRange; if(!rangeOpts.includes(range))range=rangeOpts.includes(10)?10:maxYears;
 window.profileRange=range;
 const n=Math.min(range,maxYears);
 const years=fd.years.slice(-n), vals=chosen.values.slice(-n);
 const nums=vals.map(Number).filter(Number.isFinite);
 const first=vals.find(v=>v!=null), last=vals[vals.length-1];
 const growth=first?((Number(last)/Number(first))-1)*100:null;
 const w=640,h=200,padL=54,padR=14,padT=16,padB=28;
 const minV=Math.min(0,...nums), maxV=Math.max(...nums,1), spanV=(maxV-minV)||1;
 const stepX=n>1?(w-padL-padR)/(n-1):0;
 const xy=vals.map((v,i)=>[padL+i*stepX, h-padB-((Number(v)||0)-minV)/spanV*(h-padT-padB)]);
 const line=xy.map((p,i)=>(i===0?"M":"L")+p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
 const gridN=4;
 const gridLines=Array.from({length:gridN+1},(_,i)=>{
  const val=minV+spanV*i/gridN, y=h-padB-(val-minV)/spanV*(h-padT-padB);
  return `<line x1="${padL}" x2="${w-padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"></line><text x="${padL-8}" y="${(y+4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${finFmt(val,chosen.unit)}</text>`;
 }).join("");
 const dots=xy.map((p,i)=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" fill="var(--teal)" stroke="#fff" stroke-width="1.5" style="cursor:pointer" onmouseenter="showChartTip(event,'${years[i]}','${finFmt(vals[i],chosen.unit)}')" onmouseleave="hideChartTip()" ontouchstart="showChartTip(event,'${years[i]}','${finFmt(vals[i],chosen.unit)}')"></circle>`).join("");
 const xLabels=years.map((y,i)=>`<text x="${xy[i][0].toFixed(1)}" y="${h-8}" text-anchor="middle" font-size="10" fill="var(--muted)">${y}</text>`).join("");
 return `<div class="chart-controls">
  <label>Metric <select onchange="setProfileMetric('${t}',this.value)">${opts.map(m=>`<option value="${m.name}" ${m.name===chosen.name?"selected":""}>${m.name}</option>`).join("")}</select></label>
  <label>Period <select onchange="setProfileRange('${t}',this.value)">${rangeOpts.map(n2=>`<option value="${n2}" ${n2===range?"selected":""}>${n2===maxYears?"Max":n2+"Y"}</option>`).join("")}</select></label>
 </div>
 <div style="margin-top:10px"><b style="font-size:22px">${finFmt(last,chosen.unit)}</b> <span class="muted small">${years[years.length-1]}</span>${growth===null?"":` <span class="small ${growth>=0?"green":"red"}">${growth>=0?"+":""}${growth.toFixed(1)}% across ${n===1?"1 year":n+" years"}</span>`}</div>
 <div class="chart-figure"><svg viewBox="0 0 ${w} ${h}" style="width:100%;height:200px;margin-top:6px" preserveAspectRatio="none">${gridLines}<path d="${line}" fill="none" stroke="var(--teal)" stroke-width="2.5"></path>${dots}${xLabels}</svg><div class="chart-tip" id="charttip"></div></div>
 <div class="chart-caption">Annual SEC-reported values${chosen.unit==="B"?" · USD B":chosen.unit==="M"?" · USD M":""} · Hover a point for its exact value</div>`;
}
function renderProfileChart(t){const el=document.getElementById("pchart-"+t); if(el)el.innerHTML=interactiveChartHtml(companyFinancials(t),t)}
function setProfileMetric(t,name){window.profileMetric=name; renderProfileChart(t)}
function setProfileRange(t,years){window.profileRange=Number(years); renderProfileChart(t)}
function showChartTip(evt,label,value){
 const tip=document.getElementById("charttip"); if(!tip)return;
 const fig=tip.parentElement, rect=fig.getBoundingClientRect();
 const p=evt.touches?evt.touches[0]:evt;
 tip.innerHTML="<b>"+value+"</b><span>"+label+"</span>";
 tip.style.left=(p.clientX-rect.left)+"px"; tip.style.top=(p.clientY-rect.top)+"px";
 tip.style.display="block";
}
function hideChartTip(){const t=document.getElementById("charttip"); if(t)t.style.display="none"}

const $=s=>document.querySelector(s);
const money=x=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(x||0);
const pct=x=>(x>=0?"+":"")+Number(x||0).toFixed(2)+"%";
function save(){localStorage.setItem(KEY,JSON.stringify(state))}
function nextTxId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function migrateTransactions(){
  let changed=false;
  for(const x of state.transactions||[]){
    if(!x.id){x.id=nextTxId();changed=true}
    if(x.commission==null){x.commission=0;changed=true}
    if("applied" in x){delete x.applied;changed=true}
  }
  if(changed)save();
}
migrateTransactions();
function recomputePositions(){
  const byTicker={};
  let realizedPL=0;
  const txs=[...(state.transactions||[])].filter(x=>["BUY","SELL"].includes(x.type)&&x.ticker&&x.qty>0)
    .sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
  for(const x of txs){
    const commission=Number(x.commission)||0;
    let p=byTicker[x.ticker];
    if(x.type==="BUY"){
      if(!p)p=byTicker[x.ticker]={ticker:x.ticker,shares:0,cost:0,price:x.price||0};
      p.shares+=x.qty;
      p.cost+=x.qty*x.price+commission;
      p.price=x.price||p.price||0;
    }else if(p&&p.shares>0){
      const sold=Math.min(x.qty,p.shares);
      const avgCost=p.shares>0?p.cost/p.shares:0;
      realizedPL+=(sold*x.price-commission)-sold*avgCost;
      p.shares-=sold;
      p.cost=Math.max(0,p.cost-sold*avgCost);
      p.price=x.price||p.price||0;
      if(p.shares<=0)delete byTicker[x.ticker];
    }
  }
  state.positions=Object.values(byTicker).map(p=>{
    const value=p.shares*p.price, pl=value-p.cost;
    return {...p,value,pl,ret:p.cost?pl/p.cost*100:0};
  });
  state.realizedPL=realizedPL;
}
recomputePositions();
function total(){return state.positions.reduce((a,x)=>a+x.value,0)}
function totalPL(){return state.positions.reduce((a,x)=>a+x.pl,0)}
function nav(tab){current=tab; if(tab==="home")loadPrices(); render()}
function render(){
 document.body.innerHTML=`<div class="app">
  <header class="top"><div><div class="brand">Portfolio OS</div><div class="sub">Personal high-growth portfolio tracker</div></div>
  <div class="top-actions"><button class="btn icon-btn" onclick="toggleTheme()" title="Toggle theme">${isDark()?"☀":"☾"}</button><button class="btn primary" onclick="openTx()">＋ Transaction</button><button class="btn" onclick="importBroker()">Import</button></div></header>
  <nav class="nav">${["home","holdings","watchlist","allocate","universe"].map((x,i)=>`<button class="${current===x?"active":""}" onclick="nav('${x}')">${["Dashboard","Holdings","Watchlist","Allocation","Universe"][i]}</button>`).join("")}</nav>
  <main>${current==="home"?home():current==="holdings"?holdings():current==="watchlist"?watchlist():current==="allocate"?allocation():universePage()}</main>
 </div>
 <nav class="bottom">${[["home","⌂","Home"],["holdings","▤","Holdings"],["watchlist","☆","Watch"],["allocate","◎","Allocate"],["universe","◉","Universe"]].map(x=>`<button class="${current===x[0]?"active":""}" onclick="${x[0]==="more"?"showMore()":`nav('${x[0]}')`}"><b>${x[1]}</b>${x[2]}</button>`).join("")}</nav>
 <div id="modal"></div><div id="toast" class="toast"></div>`;
}
function home(){
 const t=total(),p=totalPL(),cost=t-p, top=[...state.positions].sort((a,b)=>b.value-a.value).slice(0,6);
 const perf=performanceChartHtml();
 const hasPositions=state.positions.length>0;
 const top3=hasPositions?top.slice(0,3).reduce((a,x)=>a+x.value,0)/t*100:0;
 return `<div class="page-head"><div><div class="eyebrow">Portfolio overview</div><div class="h1">Your portfolio</div><div class="lede">Performance, positions and capital allocation at a glance.</div></div>
 <div class="actions"><button class="btn" onclick="nav('holdings')">View holdings →</button><button class="btn primary" onclick="openTx()">+ Transaction</button></div></div>
 <div class="cards">
 <div class="card hi"><div class="label">Market value</div><div class="big">${money(t)}</div><div class="foot">${state.positions.length} active position${state.positions.length===1?"":"s"}</div></div>
 <div class="card"><div class="label">Unrealized P/L</div><div class="big ${p>=0?"green":"red"}">${money(p)}</div><div class="foot">Cost basis ${money(cost)}${state.realizedPL?` · Realized ${money(state.realizedPL)}`:""}</div></div>
 <div class="card"><div class="label">Return on cost</div><div class="big ${p>=0?"green":"red"}">${pct(cost?p/cost*100:0)}</div><div class="foot">Across current holdings</div></div>
 <div class="card"><div class="label">Largest three</div><div class="big">${top3.toFixed(1)}%</div><div class="foot">Portfolio concentration</div></div></div>
 <div class="grid2 section">
 <div class="card"><div class="section-head"><span class="section-title">Performance</span></div><div class="chart${perf.filled?" filled":""}">${perf.html}</div></div>
 <div class="card"><div class="section-head"><div><span class="section-title">Portfolio mix</span><div class="section-sub">Position weights by market value</div></div><button class="link" onclick="nav('allocate')">Allocation →</button></div>${hasPositions?top.map(x=>`<div class="alloc-row"><b>${x.ticker}</b><div class="bar"><i style="width:${Math.min(100,x.value/t*300)}%"></i></div><span>${(x.value/t*100).toFixed(1)}%</span></div>`).join(""):'<div class="muted small">Allocation appears when you add holdings.</div>'}</div>
 </div>
 <div class="section"><div class="card"><div class="section-head"><div><span class="section-title">Largest positions</span><div class="section-sub">Market value and portfolio weight</div></div><button class="link" onclick="nav('holdings')">All holdings →</button></div>
 ${hasPositions?`<div class="list">${top.slice(0,4).map(x=>`<div class="list-item" onclick="stock('${x.ticker}')"><div><span class="ticker">${x.ticker}</span><div class="muted small">${money(x.value)} position</div></div><div class="${x.pl>=0?"green":"red"}">${money(x.pl)}<br><span class="small">${pct(x.ret)}</span></div></div>`).join("")}</div>`:`<div class="empty"><b>Your portfolio starts here</b><p>Add a transaction to see holdings, performance and allocation.</p><button class="btn primary" onclick="openTx()">+ Add your first position</button></div>`}</div></div>
 <div class="section"><div class="section-head"><div><span class="section-title">Research watchlist</span><div class="section-sub">Continue exploring companies you follow.</div></div></div>
 <div class="chip-row">${state.watchlist.slice(0,4).map(x=>`<button class="chip" onclick="stock('${x.ticker}')"><b>${x.ticker}</b>${x.name}</button>`).join("")}${state.watchlist.length>4?`<button class="chip" onclick="nav('watchlist')">+${state.watchlist.length-4} more</button>`:""}</div></div>`;
}
function holdings(){
 const txs=[...(state.transactions||[])].sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0);
 return `<div class="page-head"><div><div class="eyebrow">Positions</div><div class="h2">Holdings</div><div class="lede">${state.positions.length} current position${state.positions.length===1?"":"s"}.</div></div>
 <div class="actions"><input class="search" placeholder="Search ticker" oninput="filterHold(this.value)"></div></div>
 <div class="table-wrap"><table class="table" id="ht"><thead><tr><th>Ticker</th><th>Shares</th><th>Price</th><th>Value</th><th>P/L</th><th>Return</th><th>Weight</th></tr></thead><tbody>${[...state.positions].sort((a,b)=>b.value-a.value).map(x=>`<tr data-t="${x.ticker}" onclick="stock('${x.ticker}')"><td class="ticker">${x.ticker}</td><td>${x.shares.toFixed(4)}</td><td>${money(x.price)}</td><td>${money(x.value)}</td><td class="${x.pl>=0?"green":"red"}">${money(x.pl)}</td><td class="${x.ret>=0?"green":"red"}">${pct(x.ret)}</td><td>${(x.value/total()*100).toFixed(2)}%</td></tr>`).join("")}</tbody></table></div>
 <div class="section"><div class="section-head"><div><span class="section-title">Transaction history</span><div class="section-sub">Tap a row to edit or delete it.</div></div></div>
 ${txs.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Ticker</th><th>Type</th><th>Qty</th><th>Price</th><th>Commission</th></tr></thead><tbody>${txs.map(x=>`<tr style="cursor:pointer" onclick="openTx('${x.id}')"><td>${x.date}</td><td class="ticker">${x.ticker}</td><td>${x.type}</td><td>${x.qty?Number(x.qty).toFixed(4):"—"}</td><td>${x.price?money(x.price):"—"}</td><td>${x.commission?money(x.commission):"—"}</td></tr>`).join("")}</tbody></table></div>`:'<div class="muted small">No transactions yet.</div>'}</div>`;
}
function filterHold(q){document.querySelectorAll("#ht tbody tr").forEach(r=>r.style.display=r.dataset.t.toLowerCase().includes(q.toLowerCase())?"":"none")}
function watchlist(){
 return `<div class="page-head"><div><div class="eyebrow">Research</div><div class="h2">Watchlist</div><div class="lede">Companies you're tracking but don't yet hold.</div></div></div>
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
 return `<div class="page-head"><div><div class="eyebrow">Screener</div><div class="h2">Stock universe</div><div class="lede">${rows.length} of ${universe.length} stocks · ranked by market cap.</div></div>
 <div class="actions"><input class="search" placeholder="Search ticker or company" value="${window.universeQuery||""}" oninput="filterUniverse(this.value)"></div></div>
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
 return `<div class="page-head"><div><div class="eyebrow">Capital plan</div><div class="h2">Allocation</div><div class="lede">Where new capital goes across the current high-conviction plan.</div></div></div>
 <div class="card"><div class="section-head"><div><span class="section-title">Concentrated new-capital plan</span><div class="section-sub">High-growth / high-risk framework</div></div><span class="pill">100%</span></div>
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
function toggleProfileSection(id){
 const el=document.getElementById(id); if(!el)return;
 const opening=el.style.display==="none";
 el.style.display=opening?"block":"none";
 const chev=el.previousElementSibling?.querySelector?.(".chev");
 if(chev)chev.textContent=opening?"⌃":"⌄";
}
function finFmt(v,u){if(v==null)return "—";if(u==="$")return "$"+Number(v).toFixed(2);if(u==="B")return Number(v).toFixed(2)+"B";if(u==="M")return Number(v).toFixed(1)+"M";if(u==="%")return (Number(v)*100).toFixed(1)+"%";if(u==="x")return Number(v).toFixed(2)+"x";return Number(v).toFixed(2)}
function financialSections(fd,t){
 const sections=[];
 const groups=[["Income statement","income_statement"],["Cash flow","cash_flow"],["Ratios & growth","ratios"]];
 groups.forEach(([title,cat])=>{
  const ms=(fd.metrics||[]).filter(m=>(m.category||"income_statement")===cat);
  if(!ms.length)return;
  const showYears=fd.years.slice(-5), off=fd.years.length-showYears.length;
  sections.push({title,count:ms.length+" metrics · "+fd.years.length+" fiscal years",sub:"Latest 5 fiscal years · all values retain their reported units",
   body:'<div class="table-wrap"><table class="table"><thead><tr><th>Metric</th>'+showYears.map(y=>'<th>'+y+'</th>').join("")+'</tr></thead><tbody>'+ms.map(m=>'<tr><td><b>'+m.name+'</b></td>'+showYears.map((_,i)=>'<td>'+finFmt(m.values?.[off+i],m.unit)+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>'});
 });
 const capexMetric=(fd.metrics||[]).find(m=>m.name==="Capex spend"&&m.category==="cash_flow");
 if(capexMetric&&capexMetric.values?.some(v=>v!=null)){
  sections.push({title:"Capital expenditures",count:fd.years.length+" fiscal years",sub:"Annual Capex spend across the available fiscal-year history",
   body:'<div class="table-wrap"><table class="table"><thead><tr><th>Fiscal year</th>'+fd.years.map(y=>'<th>'+y+'</th>').join("")+'</tr></thead><tbody><tr><td><b>Capex spend</b></td>'+fd.years.map((_,i)=>'<td>'+finFmt(capexMetric.values?.[i],capexMetric.unit)+'</td>').join("")+'</tr></tbody></table></div>'});
 }
 const ttm=fd.latest_reported?.ttm||{};
 const ttmLabels={revenue:"Revenue",operating_income:"Operating income",net_income:"Net income",cfo:"Operating cash flow",capex:"Capex spend",fcf:"Free cash flow",rnd:"R&D",da:"D&A"};
 const ttmRows=Object.entries(ttmLabels).filter(([k])=>ttm[k]&&ttm[k].value!=null).map(([k,label])=>'<tr><td><b>'+label+'</b></td><td>'+finFmt(ttm[k].value,ttm[k].unit)+'</td></tr>').join("");
 if(ttmRows){
  sections.push({title:"TTM financials",count:"Trailing twelve months",sub:"Through "+(ttm.period_end||fd.latest_reported.period_end||"—"),
   body:'<div class="table-wrap"><table class="table"><thead><tr><th>Metric</th><th>TTM</th></tr></thead><tbody>'+ttmRows+'</tbody></table></div>'});
 }
 const latest=fd.latest_reported?.metrics||{};
 const labels={cash:"Cash",debt_current:"Current debt",debt_noncurrent:"Long-term debt",assets:"Total assets",equity:"Total equity",shares_outstanding:"Shares outstanding"};
 const latestRows=Object.entries(labels).filter(([k])=>latest[k]).map(([k,label])=>'<tr><td><b>'+label+'</b></td><td>'+finFmt(latest[k].value,latest[k].unit)+'</td></tr>').join("");
 const latestRatios=fd.latest_reported?.ratios||{};
 const ratioLabels={debt_equity:"Debt / equity",net_debt:"Net debt",net_debt_ebitda:"Net debt / EBITDA",net_debt_ebitda_ttm:"Net debt / TTM EBITDA",roic:"Approx. ROIC",roic_ttm:"Approx. ROIC (TTM)",roe:"ROE",roe_ttm:"ROE (TTM)",fcf_margin_ttm:"FCF margin (TTM)"};
 const latestRatioRows=Object.entries(ratioLabels).filter(([k])=>latestRatios[k]&&latestRatios[k].value!=null).map(([k,label])=>'<tr><td><b>'+label+'</b></td><td>'+finFmt(latestRatios[k].value,latestRatios[k].unit)+'</td></tr>').join("");
 const ratioMethods=Object.entries(ratioLabels).filter(([k])=>latestRatios[k]&&latestRatios[k].method).map(([k,label])=>'<div>'+label+': '+latestRatios[k].method+'</div>').join("");
 if(latestRows){
  sections.push({title:"Balance sheet",count:fd.latest_reported.label||"Latest reported",sub:"Period end: "+(fd.latest_reported.period_end||"—")+" · filed: "+(fd.latest_reported.filed||"—")+" · "+(fd.latest_reported.form||"SEC filing"),
   body:'<div class="table-wrap"><table class="table"><thead><tr><th>Metric</th><th>Latest</th></tr></thead><tbody>'+latestRows+'</tbody></table></div>'+(latestRatioRows?'<div class="section-title" style="margin:14px 0 8px;font-size:14px">Latest balance-sheet ratios</div><div class="table-wrap"><table class="table"><thead><tr><th>Metric</th><th>Latest</th></tr></thead><tbody>'+latestRatioRows+'</tbody></table></div><div class="muted small" style="margin-top:8px">Methodology: '+ratioMethods+'. Net debt / EBITDA and ROIC use the latest fiscal-year income statement denominator until TTM data is added.</div>':"")});
 }
 return sections.map((s,i)=>{
  const id="stmt-"+t+"-"+i;
  return `<div class="profile-section"><button class="profile-toggle" onclick="toggleProfileSection('${id}')"><div><b>${s.title}</b><div class="muted small" style="margin-top:2px">${s.sub}</div></div><div style="display:flex;align-items:center;gap:10px;white-space:nowrap"><span class="muted small">${s.count}</span><span class="chev">⌄</span></div></button><div id="${id}" class="profile-content" style="display:none">${s.body}</div></div>`;
 }).join("");
}
function researchSectionsHtml(r,t){
 if(!r)return "";
 const items=[["Business segments","seg-"+t,r.segments.map(a=>`<div class="list-item"><b>${a[0]}</b><span class="muted">${a[1]}</span></div>`).join("")],
  ["Investment thesis","thesis-"+t,r.thesis.map(a=>`<div class="list-item"><span>${a}</span></div>`).join("")],
  ["Key risks","risk-"+t,r.risks.map(a=>`<div class="list-item"><span>${a}</span></div>`).join("")]];
 return items.map(([title,id,body])=>`<div class="profile-section"><button class="profile-toggle" onclick="toggleProfileSection('${id}')"><b>${title}</b><span class="chev">⌄</span></button><div id="${id}" class="profile-content" style="display:none">${body}</div></div>`).join("");
}
function snapshotCards(fd){
 const fy=fd.years?.[fd.years.length-1]||"";
 return ["Revenue","Operating income","Free cash flow","Diluted EPS"].map(name=>{
  const m=(fd.metrics||[]).find(x=>x.name===name);
  const v=m?.values?.[m.values.length-1];
  return `<div class="card"><div class="label">${name}</div><div class="big">${finFmt(v,m?.unit)}</div><div class="foot">${fy}</div></div>`;
 }).join("");
}
function stock(t,tab){
 tab=(tab==="overview"||tab==="financials")?tab:(window.profileTab||"overview");
 window.profileTab=tab;
 const x=state.positions.find(p=>p.ticker===t), w=state.watchlist.find(p=>p.ticker===t), u=universe.find(p=>p.ticker===t), watched=isWatched(t);
 const r=t==="MSFT"?msftResearch():null, fd=companyFinancials(t);
 const latestPrice=fd?.price;
 const overviewHtml=`
 ${latestPrice!=null?`<div class="cards"><div class="card"><div class="label">Market price</div><div class="big">${money(latestPrice)}</div><div class="foot">Updated ${fd.price_updated_utc?new Date(fd.price_updated_utc).toLocaleString():"recently"}</div></div>${x?`<div class="card"><div class="label">Shares</div><div class="big">${x.shares.toFixed(4)}</div></div><div class="card"><div class="label">Position value</div><div class="big">${money(x.shares*latestPrice)}</div></div><div class="card"><div class="label">P/L</div><div class="big ${x.pl>=0?"green":"red"}">${money(x.pl)}</div></div>`:""}</div>`:x?`<div class="cards"><div class="card"><div class="label">Shares</div><div class="big">${x.shares.toFixed(4)}</div></div><div class="card"><div class="label">Price</div><div class="big">${money(x.price)}</div></div><div class="card"><div class="label">P/L</div><div class="big ${x.pl>=0?"green":"red"}">${money(x.pl)}</div></div></div>`:""}
 <div class="section"><div class="card"><div class="label">What they do</div><div style="margin-top:8px;line-height:1.5">${businessDescription(t,u)}</div></div></div>
 <div class="section">${researchSectionsHtml(r,t)}</div>
 <div class="section list"><div class="list-item"><b>Valuation</b><span class="muted">Coming later</span></div><div class="list-item"><b>Research & catalysts</b><span class="muted">Coming later</span></div></div>`;
 const financialsHtml=fd?`
 <div class="section-head" style="align-items:flex-start;margin-top:14px">
  <div><div class="eyebrow">Fundamentals</div><div class="section-title" style="font-size:20px;margin-top:2px">Financials</div><div class="section-sub">Reported annual results, trailing figures and balance-sheet data.</div></div>
  <span class="pill">SEC XBRL</span>
 </div>
 <div class="cards" style="margin-top:16px">${snapshotCards(fd)}</div>
 <div class="card section"><div class="eyebrow">Financial trend</div><div id="pchart-${t}">${interactiveChartHtml(fd,t)}</div></div>
 <div class="section"><div class="section-title">Detailed statements</div><div class="section-sub">Choose a section to open.</div><div style="margin-top:10px">${financialSections(fd,t)}</div></div>
 <div class="muted small" style="margin-top:10px">Source: SEC XBRL companyfacts. Price source: Yahoo Finance chart endpoint. Historical diluted EPS is retrospectively adjusted for detected stock splits (forward and reverse) so all years are shown on the current share basis.</div>`
 :'<div class="muted small" style="padding:24px 0">Financial history not available yet.</div>';
 $("#modal").innerHTML=`<div class="sheet"><div class="section-head"><div><div class="eyebrow">Company research</div><div class="h1" style="font-size:28px;margin-top:2px">${t}</div><div class="muted">${u?.name||x?.ticker||w?.name||"Company"}</div></div><div style="display:flex;gap:8px"><button class="btn" onclick="toggleWatch('${t}')">${watched?"★ Watchlisted":"☆ Add to watchlist"}</button><button class="btn" onclick="closeModal()">×</button></div></div>
 <div class="subtabs"><button class="${tab==="overview"?"active":""}" onclick="stock('${t}','overview')">Overview</button><button class="${tab==="financials"?"active":""}" onclick="stock('${t}','financials')">Financials</button></div>
 ${tab==="overview"?overviewHtml:financialsHtml}</div>`;
 $("#modal").classList.add("open");
}
function openTx(id){
 const editing=id?state.transactions.find(x=>x.id===id):null;
 window.editingTxId=editing?id:null;
 const v=editing||{ticker:"",type:"BUY",qty:"",price:"",commission:"",date:new Date().toISOString().slice(0,10)};
 $("#modal").innerHTML=`<div class="sheet"><div class="section-head"><b>${editing?"Edit transaction":"Add transaction"}</b><button class="btn" onclick="closeModal()">×</button></div>
 <div class="form"><label>Ticker<input id="tt" placeholder="AVGO" value="${v.ticker||""}"></label><label>Type<select id="typ"><option ${v.type==="BUY"?"selected":""}>BUY</option><option ${v.type==="SELL"?"selected":""}>SELL</option><option ${v.type==="DIVIDEND"?"selected":""}>DIVIDEND</option><option ${v.type==="DEPOSIT"?"selected":""}>DEPOSIT</option><option ${v.type==="WITHDRAWAL"?"selected":""}>WITHDRAWAL</option></select></label><label>Quantity<input id="qq" type="number" step="0.000001" value="${v.qty||""}"></label><label>Price<input id="pp" type="number" step="0.01" value="${v.price||""}"></label><label>Commission <span class="muted">(optional)</span><input id="cc" type="number" step="0.01" placeholder="0.00" value="${v.commission||""}"></label><label>Date<input id="dd" type="date" value="${v.date}"></label></div>
 <div style="display:flex;justify-content:space-between;gap:8px;margin-top:15px">${editing?`<button class="btn" onclick="deleteTx('${editing.id}')" style="color:var(--red)">Delete</button>`:"<span></span>"}<div style="display:flex;gap:8px"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveTx()">${editing?"Save changes":"Save transaction"}</button></div></div></div>`;
 $("#modal").classList.add("open");
}
function saveTx(){
 let x={ticker:$("#tt").value.trim().toUpperCase(),type:$("#typ").value,qty:+$("#qq").value||0,price:+$("#pp").value||0,commission:+$("#cc").value||0,date:$("#dd").value};
 if(!x.ticker||!x.date)return toast("Ticker and date required");
 if(["BUY","SELL"].includes(x.type)&&(!x.qty||x.qty<=0))return toast("Enter a quantity greater than 0");
 if(["BUY","SELL"].includes(x.type)&&(!x.price||x.price<=0))return toast("Enter a price greater than 0");
 const editingId=window.editingTxId;
 if(editingId){
  const i=state.transactions.findIndex(t=>t.id===editingId);
  if(i>-1)state.transactions[i]={...state.transactions[i],...x};
 }else{
  x.id=nextTxId();
  state.transactions.push(x);
 }
 window.editingTxId=null;
 recomputePositions();
 save();
 closeModal();
 render();
 toast(editingId?"Transaction updated":(x.type==="BUY"?x.ticker+" added to portfolio":x.type==="SELL"?x.ticker+" position updated":"Transaction saved"));
}
function deleteTx(id){
 if(!confirm("Delete this transaction? This can't be undone."))return;
 state.transactions=state.transactions.filter(x=>x.id!==id);
 recomputePositions();
 save();
 closeModal();
 render();
 toast("Transaction deleted");
}
function closeModal(){$("#modal").classList.remove("open")}
function toast(s){let x=$("#toast");x.textContent=s;x.style.display="block";setTimeout(()=>x.style.display="none",1800)}
function allocationAmount(){let s=prompt("How much new capital (USD)?");let n=Number(s);if(!n||n<=0)return;alert(state.allocation.map(x=>`${x.ticker}: ${money(n*x.pct/100)}`).join("\n"))}
function showMore(){alert("More features coming: live quotes, broker sync, performance history, valuation models and AI research.")}
function importBroker(){
 const input=document.createElement("input"); input.type="file"; input.accept=".csv,text/csv";
 input.onchange=()=>{const f=input.files?.[0]; if(!f)return; const r=new FileReader(); r.onload=()=>{try{
  const rows=parseCSV(String(r.result||"")); const imported=[];
  for(const row of rows){
   const ticker=(row.Symbol||row.symbol||"").trim();
   const type=(row["Transaction Type"]||row.transaction_type||"").trim().toUpperCase();
   const qty=Number(row.Quantity||row.quantity||0);
   const px=Number(row["Purchase Price"]||row.purchase_price||0);
   const commission=Number(row.Commission||row.commission||0);
   const rawDate=row.Date||row.date||row["Open Date"]||row["Date Opened"]||"";
   const parsedDate=rawDate&&!isNaN(Date.parse(rawDate))?new Date(rawDate).toISOString().slice(0,10):new Date().toISOString().slice(0,10);
   if(!ticker||ticker==="$$CASH_TX"||!["BUY","SELL"].includes(type)||!qty||!px)continue;
   imported.push({id:nextTxId(),ticker,type,qty,price:px,commission,date:parsedDate});
  }
  if(!imported.length)return toast("No BUY/SELL rows found in that CSV.");
  state.transactions.push(...imported);
  recomputePositions(); save(); render();
  toast(`Imported ${imported.length} transaction${imported.length===1?"":"s"} locally.`);
 }catch(e){toast("Could not read that CSV.")}}; r.readAsText(f)}; input.click();
}
function parseCSV(text){const lines=text.split(/\r?\n/).filter(Boolean); if(!lines.length)return[]; const parseLine=line=>{const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q}else if(c===','&&!q){out.push(cur);cur=""}else cur+=c}out.push(cur);return out}; const h=parseLine(lines[0]); return lines.slice(1).map(l=>{const v=parseLine(l); return Object.fromEntries(h.map((k,i)=>[k,v[i]??""]))})}
window.stock=stock;window.openStockFromButton=(e,t)=>{e.preventDefault();e.stopPropagation();stock(t)};window.openTx=openTx;window.closeModal=closeModal;window.saveTx=saveTx;window.nav=nav;window.filterHold=filterHold;window.allocationAmount=allocationAmount;window.showMore=showMore;window.importBroker=importBroker;window.filterUniverse=filterUniverse;window.filterUniverseSector=filterUniverseSector;window.filterUniverseIndex=filterUniverseIndex;window.toggleWatch=toggleWatch;window.setProfileMetric=setProfileMetric;window.setProfileRange=setProfileRange;window.showChartTip=showChartTip;window.hideChartTip=hideChartTip;window.toggleProfileSection=toggleProfileSection;window.toggleTheme=toggleTheme;window.deleteTx=deleteTx;
save();render();
if(current==="home")loadPrices();
if("serviceWorker" in navigator){navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())).catch(()=>{});}