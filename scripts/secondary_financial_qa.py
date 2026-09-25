import argparse, json, re, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import requests
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]
UNIVERSE=ROOT/"universe.json"
FINANCIALS=ROOT/"financials.json"
HEADERS={"User-Agent":"Portfolio OS independent financial cross-check/1.0","Accept-Language":"en-US,en;q=0.9"}
METRIC_ROWS={"Revenue":("Revenue",),"Gross profit":("Gross Profit",),"Operating income":("Operating Income",),"Net income":("Net Income",),"Diluted EPS":("EPS (Diluted)","Earnings Per Share","Diluted EPS")}

def parse_num(s):
    s=s.strip().replace(",","")
    if not s or s in {"-","—","–"}: return None
    neg=s.startswith("(") and s.endswith(")")
    s=s.strip("()")
    m=re.match(r"^([+-]?[0-9]*\.?[0-9]+)\s*([BMK]?)$",s,re.I)
    if not m: return None
    v=float(m.group(1)); u=m.group(2).upper()
    if u=="B": v*=1000
    elif u=="K": v/=1000
    return -v if neg else v

def parse_page(ticker):
    url=f"https://stockanalysis.com/stocks/{ticker.lower()}/financials/"
    r=requests.get(url,headers=HEADERS,timeout=30); r.raise_for_status()
    soup=BeautifulSoup(r.text,"html.parser")
    target=None
    for table in soup.find_all("table"):
        txt=" ".join(table.stripped_strings)
        if "Fiscal Year" in txt and "Revenue" in txt and "Net Income" in txt:
            target=table; break
    if target is None: raise ValueError("annual financial table not found")
    rows=[]
    for tr in target.find_all("tr"):
        cells=[c.get_text(" ",strip=True) for c in tr.find_all(["th","td"])]
        if cells: rows.append(cells)
    fiscal=next((r[1:] for r in rows if r and r[0]=="Fiscal Year"),None)
    if not fiscal: raise ValueError("fiscal-year header not found")
    out={}
    for row in rows:
        if not row: continue
        metric_name = next((name for name, labels in METRIC_ROWS.items()
                            if any(row[0] == label or row[0].startswith(label + " ") for label in labels)), None)
        if not metric_name: continue
        parsed={}
        for fy,v in zip(fiscal,row[1:]):
            m=re.search(r"(?:FY\s*|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+|^)(\d{4})\b",fy)
            if m: parsed["FY"+m.group(1)]=parse_num(v)
        out[metric_name]=parsed
    return {"ticker":ticker,"url":url,"metrics":out}

def compare(ticker,generated):
    try:
        ext=parse_page(ticker); g=generated[ticker]; mismatches=[]; compared=0
        for gm in g.get("metrics",[]):
            name=gm.get("name"); label=METRIC_ROWS.get(name)
            if not label or name not in ext["metrics"]: continue
            ev=ext["metrics"][name]
            for fy,actual in zip(g.get("years",[]),gm.get("values",[])):
                if fy not in ev or actual is None or ev[fy] is None: continue
                expected=ev[fy]; app=actual*1000 if name!="Diluted EPS" else actual
                compared+=1
                tol=max(abs(expected)*0.005,0.01 if name=="Diluted EPS" else 1.0)
                if abs(app-expected)>tol:
                    mismatches.append({"metric":name,"fy":fy,"app":app,"external":expected,"diff_pct":(app/expected-1)*100 if expected else None})
        status = "unavailable" if compared == 0 else ("flag" if mismatches else "match")
        result = {"ticker":ticker,"status":status,"compared":compared,"mismatches":mismatches,"source":ext["url"]}
        if compared == 0:
            result["error"] = "no overlapping financial values to compare"
        return result
    except Exception as e:
        return {"ticker":ticker,"status":"unavailable","error":repr(e)}

def main():
    p=argparse.ArgumentParser(); p.add_argument("--start",type=int,default=0); p.add_argument("--count",type=int,default=50); p.add_argument("--output",default="secondary_qa.json"); args=p.parse_args()
    universe=json.loads(UNIVERSE.read_text()); generated=json.loads(FINANCIALS.read_text())
    stocks=sorted(universe["stocks"],key=lambda x:x["ticker"])[args.start:args.start+args.count]
    results=[]
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs=[ex.submit(compare,s["ticker"],generated) for s in stocks]
        for i,f in enumerate(as_completed(futs),1):
            r=f.result(); results.append(r)
            print(i,r["ticker"],r["status"],"compared",r.get("compared",0),"mismatches",len(r.get("mismatches",[])))
            if r["ticker"] in {"GIS","MTB","AMT","COF","MET","SBAC","KEY"}:
                print("DETAIL",r["ticker"],json.dumps(r.get("mismatches",[])[:20],separators=(",",":")))
            if r["status"]=="unavailable":
                print("UNAVAILABLE_DETAIL",r["ticker"],r.get("error","no overlapping financial values"))
    results.sort(key=lambda x:x["ticker"]); counts={}
    for r in results: counts[r["status"]]=counts.get(r["status"],0)+1
    Path(args.output).write_text(json.dumps({"generated_utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"start":args.start,"count":len(results),"counts":counts,"results":results},indent=2))
    print(json.dumps({"start":args.start,"count":len(results),"counts":counts,"flagged":[r["ticker"] for r in results if r["status"]=="flag"]},indent=2))
if __name__=="__main__": main()
