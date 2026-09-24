import json, math, os, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE = ROOT / "universe.json"
FINANCIALS = ROOT / "financials.json"
REPORT = ROOT / "financial_qa.json"

SEC_HEADERS = {"User-Agent": os.environ.get("SEC_USER_AGENT", "Portfolio OS research app contact@example.com"), "Accept-Encoding": "gzip, deflate"}
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{}?period1=0&period2={}&interval=1d&events=split"

ANNUAL_FORMS=("10-K","10-K/A","20-F","20-F/A","40-F","40-F/A")
INSTANT_FORMS=("10-K","10-K/A","10-Q","10-Q/A","20-F","20-F/A","40-F","40-F/A","6-K","6-K/A")
TAXONOMIES=("us-gaap","ifrs-full")
ANNUAL_FORMS = ("10-K","10-K/A","20-F","20-F/A","40-F","40-F/A")
INSTANT_FORMS = ("10-K","10-K/A","10-Q","10-Q/A","20-F","20-F/A","40-F","40-F/A","6-K","6-K/A")
TAXONOMIES = ("us-gaap","ifrs-full")

TAGS = {
    "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "Revenue"],
    "gross_profit": ["GrossProfit"],
    "operating_income": ["OperatingIncomeLoss", "OperatingProfitLoss"],
    "net_income": ["NetIncomeLoss", "ProfitLoss"],
    "eps": ["EarningsPerShareDiluted"],
    "rnd": ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost", "ResearchAndDevelopmentExpenditure"],
    "da": ["DepreciationDepletionAndAmortization", "DepreciationDepletionAndAmortizationPropertyPlantAndEquipment", "DepreciationDepletionAndAmortizationAndAccretion", "DepreciationAndAmortisation"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsToAcquirePropertyPlantAndEquipmentAndOtherPropertyPlantAndEquipment", "PurchaseOfPropertyPlantAndEquipment"],
    "cfo": ["NetCashProvidedByUsedInOperatingActivities", "NetCashFlowsFromUsedInOperatingActivities"],
    "cash": ["CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalents"],
    "assets": ["Assets"],
    "equity": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "Equity"],
    "debt_current": ["ShortTermBorrowings", "LongTermDebtCurrent", "ShortTermDebt", "BorrowingsCurrent"],
    "debt_noncurrent": ["LongTermDebtNoncurrent", "LongTermDebt", "BorrowingsNoncurrent"],
    "shares_outstanding": ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"],
}

FLOW_METRICS = ["revenue","gross_profit","operating_income","net_income","eps","rnd","da","capex","cfo"]
INSTANT_METRICS = ["cash","assets","equity","debt_current","debt_noncurrent","shares_outstanding"]
TOL = {"eps": 0.015, "default": 0.001}
ANNUAL_FORMS = ("10-K","10-K/A","20-F","20-F/A","40-F","40-F/A")
INSTANT_FORMS = ("10-K","10-K/A","10-Q","10-Q/A","20-F","20-F/A","40-F","40-F/A","6-K","6-K/A")
TAXONOMIES = ("us-gaap","ifrs-full")

def get_json(url, headers=SEC_HEADERS):
    r = requests.get(url, headers=headers, timeout=45)
    r.raise_for_status()
    return r.json()

def _unit(units):
    if "USD" in units: return "USD"
    candidates=[u for u in units if u not in ("shares","pure","USD/shares") and "-per-" not in u]
    return candidates[0] if candidates else None

def _unit_for(units, metric):
    if metric == "eps":
        return next((u for u in units if "-per-" in u or u == "USD/shares"), None)
    if "USD" in units:
        return "USD"
    for u in units:
        if u not in ("shares","pure") and "-per-" not in u:
            return u
    return None

def annual_rows(facts, metric):
    rows = []
    for taxonomy in TAXONOMIES:
        source = facts.get("facts", {}).get(taxonomy, {})
        for tag in TAGS[metric]:
            obj = source.get(tag)
            if not obj:
                continue
            units = obj.get("units", {})
            unit = _unit_for(units, metric)
            if not unit:
                continue
            for x in units[unit]:
                if x.get("form") not in ANNUAL_FORMS or not x.get("start") or not x.get("end"):
                    continue
                try:
                    days = (date.fromisoformat(x["end"]) - date.fromisoformat(x["start"])).days
                except Exception:
                    continue
                if 300 <= days <= 400:
                    y = dict(x); y["_tag"] = tag; y["_taxonomy"] = taxonomy; y["_unit"] = unit
                    rows.append(y)
    return rows

def instant_rows(facts, metric):
    rows = []
    taxonomies = list(TAXONOMIES) + (["dei"] if metric == "shares_outstanding" else [])
    for taxonomy in taxonomies:
        source = facts.get("facts", {}).get(taxonomy, {})
        for tag in TAGS.get(metric, []):
            obj = source.get(tag)
            if not obj:
                continue
            units = obj.get("units", {})
            unit = _unit_for(units, metric)
            if not unit:
                continue
            for x in units[unit]:
                if x.get("form") in INSTANT_FORMS and x.get("end") and not x.get("start"):
                    y = dict(x); y["_tag"] = tag; y["_taxonomy"] = taxonomy; y["_unit"] = unit
                    rows.append(y)
    return rows

def canonical_annual(rows):
    by_end = {}
    for x in rows:
        try:
            lag = (date.fromisoformat(x["filed"]) - date.fromisoformat(x["end"])).days
        except Exception:
            continue
        if lag < 0:
            continue
        rank = (0 if x.get("form") == "10-K" else 1, lag, x.get("filed",""))
        if x["end"] not in by_end or rank < by_end[x["end"]][0]:
            by_end[x["end"]] = (rank, x)
    out = {}
    for end, (_, x) in by_end.items():
        fy = str(x.get("fy") or date.fromisoformat(end).year)
        out[fy] = x
    return out

def latest_annual_eps(rows):
    by_end = {}
    for x in rows:
        try:
            days = (date.fromisoformat(x["end"]) - date.fromisoformat(x["start"])).days
        except Exception:
            continue
        if not (300 <= days <= 400):
            continue
        prev = by_end.get(x["end"])
        if prev is None or x.get("filed","") > prev.get("filed",""):
            by_end[x["end"]] = x
    return by_end

def get_splits(ticker):
    try:
        d = get_json(YAHOO_URL.format(ticker, int(time.time())), headers={"User-Agent":"Mozilla/5.0"})
        events = d["chart"]["result"][0].get("events", {}).get("splits", {})
        out=[]
        for ts,e in events.items():
            ratio=e.get("splitRatio","")
            if ":" not in ratio: continue
            a,b=ratio.split(":",1)
            factor=float(a)/float(b)
            if factor and factor != 1:
                out.append((date.fromtimestamp(int(ts)).isoformat(), factor))
        return sorted(out)
    except Exception:
        return []

def adjust_eps(row, splits):
    basis = row.get("filed") or row.get("end")
    factor = 1.0
    for split_date, share_factor in splits:
        if split_date > basis:
            factor /= share_factor
    return float(row["val"]) * factor

def close(a,b,tol):
    if a is None or b is None or not math.isfinite(a) or not math.isfinite(b):
        return False
    return abs(a-b) <= max(tol, abs(b)*0.002)

def audit_one(stock, generated, cik_map):
    ticker = stock["ticker"].upper()
    cik = cik_map.get(ticker)
    if not cik or cik == "0000000000":
        return {"ticker":ticker,"status":"missing_cik"}
    try:
        facts=get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")
        g=generated.get(ticker)
        if not g:
            return {"ticker":ticker,"status":"missing_generated_data"}
        splits=get_splits(ticker)
        issues=[]
        checked=0
        metric_checks={}
        for metric in FLOW_METRICS:
            rows=annual_rows(facts,metric)
            can=canonical_annual(rows)
            gm=None
            if metric=="eps":
                gm=next((m for m in g.get("metrics",[]) if m.get("name")=="Diluted EPS"),None)
            else:
                labels={"revenue":"Revenue","gross_profit":"Gross profit","operating_income":"Operating income","net_income":"Net income","rnd":"R&D","da":"D&A","capex":"Capex spend","cfo":None}
                gm=next((m for m in g.get("metrics",[]) if m.get("name")==labels.get(metric)),None)
            vals=g.get("years",[])
            year_keys=[v.replace("FY","") for v in vals]
            mismatches=[]
            for i,y in enumerate(year_keys):
                if not gm or i >= len(gm.get("values",[])) or y not in can:
                    continue
                expected=float(can[y]["val"])
                if metric=="eps":
                    # Compare the app's value with the latest filed annual EPS
                    # normalized for every split after that filing date.
                    eps_rows = [x for x in rows if x.get("end") == can[y]["end"]]
                    if any(x.get("_taxonomy") == "us-gaap" for x in eps_rows):
                        eps_rows = [x for x in eps_rows if x.get("_taxonomy") == "us-gaap"]
                    latest = latest_annual_eps(eps_rows).get(can[y]["end"]) if eps_rows else None
                    if latest:
                        expected = adjust_eps(latest,splits) if latest.get("form") in ("10-K","10-K/A") else float(latest["val"])
                    actual=float(gm["values"][i])
                else:
                    actual=float(gm["values"][i]) * 1e9
                checked += 1
                if not close(actual, expected, TOL["eps"] if metric=="eps" else max(1.0,abs(expected))*0.001):
                    mismatches.append({"fy":y,"actual":actual,"expected":expected,"source_tag":can[y].get("_tag"),"filed":can[y].get("filed")})
            metric_checks[metric]={"checked":checked,"mismatches":mismatches}
            if mismatches:
                issues.append(metric)
        # Point-in-time balance sheet: compare app's latest reported period to the
        # latest common period represented by the generated metric rows.
        latest=g.get("latest_reported",{})
        latest_end=latest.get("period_end")
        bs_issues=[]
        for metric in INSTANT_METRICS:
            rows=instant_rows(facts,metric)
            if not rows or not latest_end:
                continue
            same=[x for x in rows if x.get("end")==latest_end]
            if not same:
                continue
            # Prefer the value from the latest filed fact on the same period.
            row=max(same,key=lambda x:x.get("filed",""))
            actual_obj=latest.get("metrics",{}).get(metric)
            if not actual_obj:
                bs_issues.append(metric); continue
            actual=float(actual_obj["value"]) * (1e6 if metric == "shares_outstanding" else 1e9)
            expected=float(row["val"])
            if not close(actual,expected,max(1.0,abs(expected))*0.001):
                bs_issues.append(metric)
        if bs_issues:
            issues.append("latest_"+",".join(bs_issues))
        return {"ticker":ticker,"status":"pass" if not issues else "mismatch","issues":issues,"checks":metric_checks,"latest_period":latest_end,"latest_form":latest.get("form")}
    except Exception as e:
        return {"ticker":ticker,"status":"error","error":repr(e)}

def main():
    universe=json.loads(UNIVERSE.read_text())
    generated=json.loads(FINANCIALS.read_text())
    stocks=universe.get("stocks",[])
    sec_map=get_json("https://www.sec.gov/files/company_tickers.json")
    cik_map={v["ticker"].upper():str(v["cik_str"]).zfill(10) for v in sec_map.values()}
    cik_map.update({"BF.B":"0000014693","BRK.B":"0001067983","EA":"0000712515","XOM":"0000034088"})
    # SEC's API is the accounting source of truth; v2 the audit independently
    # Full-universe audit: keep this workflow-triggering comment with the QA logic.
    # re-selects annual and point-in-time facts from fresh companyfacts data.
    results=[]
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs=[ex.submit(audit_one,s,generated,cik_map) for s in stocks]
        for fut in as_completed(futs):
            results.append(fut.result())
            if len(results)%25==0:
                print("audited",len(results),"of",len(stocks))
    results.sort(key=lambda x:x["ticker"])
    counts={}
    for r in results: counts[r["status"]]=counts.get(r["status"],0)+1
    mismatch=[r for r in results if r["status"]=="mismatch"]
    errors=[r for r in results if r["status"]=="error"]
    report={"generated_utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"universe_count":len(stocks),"counts":counts,"mismatch_tickers":[r["ticker"] for r in mismatch],"error_tickers":[r["ticker"] for r in errors],"results":results}
    REPORT.write_text(json.dumps(report,indent=2))
    missing_generated=[r["ticker"] for r in results if r["status"]=="missing_generated_data"]
    missing_cik=[r["ticker"] for r in results if r["status"]=="missing_cik"]
    print(json.dumps({"universe_count":len(stocks),"counts":counts,"mismatches":len(mismatch),"errors":len(errors),"missing_generated":missing_generated,"missing_cik":missing_cik},indent=2))
    # Do not fail on a mismatch: the report is the diagnostic artifact. Fail on
    # infrastructure/data retrieval errors only.
    if errors:
        raise SystemExit(2)

if __name__=="__main__":
    main()
