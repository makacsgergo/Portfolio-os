const S=window.PORTFOLIO_SEED;
const KEY="portfolio_os_v2";
let state=JSON.parse(localStorage.getItem(KEY)||"null")||structuredClone(S);
let current="home";
const $=s=>document.querySelector(s);
const money=x=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(x||0);
const pct=x=>(x>=0?"+":"")+Number(x||0).toFixed(2)+"%";
function save(){localStorage.setItem(KEY,JSON.stringify(state))}
function total(){return state.positions.reduce((a,x)=>a+x.value,0)}
function totalPL(){return state.positions.reduce((a,x)=>a+x.pl,0)}
function nav(tab){current=tab; render()}
function render(){
 document.body.innerHTML=`<div class="app">
  <header class="top"><div><div class="brand">Portfolio OS</div><div class="sub">Personal high-growth portfolio tracker</div></div>
  <div class="top-actions"><button class="btn primary" onclick="openTx()">＋ Transaction</button><button class="btn" onclick="importBroker()">Import</button></div></header>
  <nav class="nav">${["home","holdings","watchlist","allocate"].map((x,i)=>`<button class="${current===x?"active":""}" onclick="nav('${x}')">${["Dashboard","Holdings","Watchlist","Allocation"][i]}</button>`).join("")}</nav>
  <main>${current==="home"?home():current==="holdings"?holdings():current==="watchlist"?watchlist():allocation()}</main>
 </div>
 <nav class="bottom">${[["home","⌂","Home"],["holdings","▤","Holdings"],["watchlist","☆","Watch"],["allocate","◎","Allocate"],["more","☷","More"]].map(x=>`<button class="${current===x[0]?"active":""}" onclick="${x[0]==="more"?"showMore()":`nav('${x[0]}')`}"><b>${x[1]}</b>${x[2]}</button>`).join("")}</nav>
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
function allocation(){
 return `<div class="card"><div class="section-head"><div><span class="section-title">Concentrated new-capital plan</span><div class="muted small">High-growth / high-risk framework</div></div><span class="pill">100%</span></div>
 ${state.allocation.map(x=>`<div class="alloc-row"><b>${x.ticker}</b><div class="bar"><i style="width:${x.pct*3.2}%"></i></div><span>${x.pct}%</span></div>`).join("")}
 <div class="section"><button class="btn primary" onclick="allocationAmount()">Calculate an investment amount</button></div></div>`;
}
function stock(t){
 const x=state.positions.find(p=>p.ticker===t), w=state.watchlist.find(p=>p.ticker===t);
 $("#modal").innerHTML=`<div class="sheet"><div class="section-head"><div><div class="section-title">${t}</div><div class="muted">${x?money(x.value)+" position":w?.name||"Watchlist"}</div></div><button class="btn" onclick="closeModal()">×</button></div>
 ${x?`<div class="cards"><div class="card"><div class="label">Shares</div><div class="big">${x.shares.toFixed(4)}</div></div><div class="card"><div class="label">Price</div><div class="big">${money(x.price)}</div></div><div class="card"><div class="label">P/L</div><div class="big ${x.pl>=0?"green":"red"}">${money(x.pl)}</div></div><div class="card"><div class="label">Return</div><div class="big ${x.ret>=0?"green":"red"}">${pct(x.ret)}</div></div></div>`:""}
 <div class="section list"><div class="list-item"><b>Valuation</b><span class="muted">V3 live model</span></div><div class="list-item"><b>Thesis</b><span class="muted">V3 AI research layer</span></div><div class="list-item"><b>Catalysts & risks</b><span class="muted">V3 research layer</span></div></div></div>`;
 $("#modal").classList.add("open");
}
function openTx(){
 $("#modal").innerHTML=`<div class="sheet"><div class="section-head"><b>Add transaction</b><button class="btn" onclick="closeModal()">×</button></div>
 <div class="form"><label>Ticker<input id="tt" placeholder="AVGO"></label><label>Type<select id="typ"><option>BUY</option><option>SELL</option><option>DIVIDEND</option><option>DEPOSIT</option><option>WITHDRAWAL</option></select></label><label>Quantity<input id="qq" type="number" step="0.000001"></label><label>Price<input id="pp" type="number" step="0.01"></label><label class="span2">Date<input id="dd" type="date" value="${new Date().toISOString().slice(0,10)}"></label></div>
 <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:15px"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveTx()">Save transaction</button></div></div>`;
 $("#modal").classList.add("open");
}
function saveTx(){let x={ticker:$("#tt").value.trim().toUpperCase(),type:$("#typ").value,qty:+$("#qq").value||0,price:+$("#pp").value||0,date:$("#dd").value};if(!x.ticker||!x.date)return toast("Ticker and date required");state.transactions.push(x);save();closeModal();toast("Transaction saved");}
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
window.stock=stock;window.openTx=openTx;window.closeModal=closeModal;window.saveTx=saveTx;window.nav=nav;window.filterHold=filterHold;window.allocationAmount=allocationAmount;window.showMore=showMore;window.importBroker=importBroker;
save();render();
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});