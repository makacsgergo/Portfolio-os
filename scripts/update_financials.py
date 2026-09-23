import json, os, time
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE = ROOT / "universe.json"
OUTPUT = ROOT / "financials.json"
UA = os.environ.get("SEC_USER_AGENT", "Portfolio OS research app contact@example.com")
HEADERS = {"User-Agent": UA, "Accept-Encoding": "gzip, deflate"}

TAGS = {
    "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
    "operating_income": ["OperatingIncomeLoss"],
    "net_income": ["NetIncomeLoss", "ProfitLoss"],
    "eps": ["EarningsPerShareDiluted"],
    "cfo": ["NetCashProvidedByUsedInOperatingActivities"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment"],
}

def get_json(url):
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    time.sleep(0.12)
    return r.json()

def sec_ticker_map():
    data = get_json("https://www.sec.gov/files/company_tickers.json")
    return {v["ticker"].upper(): str(v["cik_str"]).zfill(10) for v in data.values()}

def annual_facts(companyfacts):
    facts = companyfacts.get("facts", {}).get("us-gaap", {})
    by_metric = {}
    for metric, candidates in TAGS.items():
        for tag in candidates:
            if tag not in facts:
                continue
            units = facts[tag].get("units", {})
            unit = "USD" if "USD" in units else ("USD/shares" if "USD/shares" in units else None)
            if not unit:
                continue
            rows = []
            for x in units[unit]:
                form = x.get("form", "")
                fp = x.get("fp", "")
                start, end = x.get("start"), x.get("end")
                if form not in ("10-K", "10-K/A") or fp != "FY" or not start or not end:
                    continue
                try:
                    days = (time.strptime(end, "%Y-%m-%d").tm_yday - time.strptime(start, "%Y-%m-%d").tm_yday)
                except Exception:
                    days = 365
                # Keep annual-like durations; fiscal years can cross calendar years.
                rows.append(x)
            if rows:
                by_metric[metric] = rows
                break
    return by_metric

def select_yearly(rows):
    out = {}
    for x in rows:
        fy = x.get("fy")
        end = x.get("end")
        if not fy or not end:
            continue
        # Prefer the latest filing for each fiscal year.
        key = str(fy)
        prev = out.get(key)
        if prev is None or x.get("filed", "") > prev.get("filed", ""):
            out[key] = x
    return out

def build_company(ticker, cik):
    facts = get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")
    metrics = annual_facts(facts)
    yearly = {m: select_yearly(rows) for m, rows in metrics.items()}
    years = sorted(set().union(*[set(v.keys()) for v in yearly.values()]), key=int)
    years = years[-10:]
    result = {"source": "SEC XBRL companyfacts", "cik": cik, "years": ["FY" + y for y in years], "currency": "USD", "metrics": []}

    specs = [
        ("Revenue", "revenue", "B"),
        ("Operating income", "operating_income", "B"),
        ("Net income", "net_income", "B"),
        ("Diluted EPS", "eps", "$"),
    ]
    for label, key, unit in specs:
        vals = []
        for y in years:
            v = yearly.get(key, {}).get(y)
            vals.append(round(float(v["val"]) / (1e9 if unit == "B" else 1), 6) if v else None)
        if any(v is not None for v in vals):
            result["metrics"].append({"name": label, "unit": unit, "values": vals})

    cfo = yearly.get("cfo", {})
    capex = yearly.get("capex", {})
    fcf = []
    for y in years:
        a, b = cfo.get(y), capex.get(y)
        if a and b:
            # SEC reports capex as a positive cash outflow in this tag; FCF = CFO - capex.
            fcf.append(round((float(a["val"]) - abs(float(b["val"]))) / 1e9, 6))
        else:
            fcf.append(None)
    if any(v is not None for v in fcf):
        result["metrics"].append({"name": "Free cash flow", "unit": "B", "values": fcf})
    return result

def main():
    universe = json.loads(UNIVERSE.read_text())
    tickers = sorted({x["ticker"].upper() for x in universe.get("stocks", [])})
    cmap = sec_ticker_map()
    existing = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {}
    # First automated pass: US-listed SEC filers using US-GAAP facts.
    processed = 0
    successful = 0
    failed = []
    missing = []
    for ticker in tickers:
        processed += 1
        cik = cmap.get(ticker)
        if not cik:
            missing.append(ticker)
            continue
        if not cik:
            continue
        try:
            data = build_company(ticker, cik)
            if len(data.get("years", [])) >= 2:
                existing[ticker] = data
                successful += 1
                print(ticker, "OK", len(data["years"]), "years")
            else:
                failed.append(ticker)
        except Exception as e:
            failed.append(ticker)
            print(ticker, "ERROR", repr(e))
    OUTPUT.write_text(json.dumps(existing, indent=2) + "\n")

if __name__ == "__main__":
    main()
