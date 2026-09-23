import json, os, time
from datetime import date
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE = ROOT / "universe.json"
OUTPUT = ROOT / "financials.json"
UA = os.environ.get("SEC_USER_AGENT", "Portfolio OS research app contact@example.com")
HEADERS = {"User-Agent": UA, "Accept-Encoding": "gzip, deflate"}

PRICE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=5d&interval=1d"

TAGS = {
    "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
    "gross_profit": ["GrossProfit"],
    "operating_income": ["OperatingIncomeLoss"],
    "net_income": ["NetIncomeLoss", "ProfitLoss"],
    "eps": ["EarningsPerShareDiluted"],
    "cfo": ["NetCashProvidedByUsedInOperatingActivities"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment"],
    "rnd": ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
    "da": ["DepreciationDepletionAndAmortization", "DepreciationDepletionAndAmortizationPropertyPlantAndEquipment", "DepreciationDepletionAndAmortizationAndAccretion"],
    "tax_expense": ["IncomeTaxExpenseBenefit"],
    "pretax_income": ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
    "buybacks": ["PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfCommonStockIncludingExcessTaxBenefit"],
    "cash": ["CashAndCashEquivalentsAtCarryingValue"],
    "assets": ["Assets"],
    "equity": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "debt_current": ["ShortTermBorrowings", "LongTermDebtCurrent", "ShortTermDebt"],
    "debt_noncurrent": ["LongTermDebtNoncurrent", "LongTermDebt"],
    "shares_outstanding": ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"],
}

def get_json(url):
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    time.sleep(0.20)
    return r.json()

def sec_ticker_map():
    data = get_json("https://www.sec.gov/files/company_tickers.json")
    return {v["ticker"].upper(): str(v["cik_str"]).zfill(10) for v in data.values()}

def annual_facts(companyfacts):
    facts = companyfacts.get("facts", {}).get("us-gaap", {})
    by_metric = {}
    for metric, candidates in TAGS.items():
        rows = []
        for tag in candidates:
            if tag not in facts:
                continue
            units = facts[tag].get("units", {})
            unit = "USD/shares" if "USD/shares" in units else ("USD" if "USD" in units else None)
            if not unit:
                continue
            for x in units[unit]:
                if x.get("form", "") not in ("10-K", "10-K/A") or not x.get("start") or not x.get("end"):
                    continue
                # Require a genuine annual reporting period. This prevents
                # six-month/YTD facts carrying an FY label from being treated
                # as the full-year result.
                try:
                    days = (date.fromisoformat(x["end"]) - date.fromisoformat(x["start"])).days
                except Exception:
                    continue
                if 300 <= days <= 400:
                    row = dict(x)
                    row["_tag"] = tag
                    rows.append(row)
        if rows:
            by_metric[metric] = rows
    return by_metric

def select_instant(rows):
    by_end = {}
    for x in rows:
        end, filed = x.get("end"), x.get("filed")
        if not end or not filed:
            continue
        try:
            end_date = date.fromisoformat(end)
            filed_date = date.fromisoformat(filed)
            lag = (filed_date - end_date).days
        except Exception:
            continue
        if lag < 0:
            continue
        candidate = (lag, filed)
        prev = by_end.get(end)
        if prev is None or candidate < prev["_rank"]:
            row = dict(x)
            row["_rank"] = candidate
            by_end[end] = row
    return by_end

def select_yearly(rows):
    # SEC companyfacts includes comparative annual facts inside later 10-Ks.
    # Those comparative facts can carry the later filing's FY label, which
    # causes fiscal years to shift backward if we key only on x["fy"].
    # Instead, identify each annual period by its END date and prefer the
    # original 10-K filed closest after that period end.
    by_end = {}
    for x in rows:
        end = x.get("end")
        filed = x.get("filed")
        if not end or not filed:
            continue
        try:
            end_date = date.fromisoformat(end)
            filed_date = date.fromisoformat(filed)
            lag = (filed_date - end_date).days
        except Exception:
            continue
        if lag < 0:
            continue

        form_rank = 0 if x.get("form") == "10-K" else 1
        candidate = (form_rank, lag, filed)
        prev = by_end.get(end)
        if prev is None or candidate < prev["_rank"]:
            row = dict(x)
            row["_rank"] = candidate
            by_end[end] = row

    # Return keyed by the fiscal year label from the filing that originally
    # reported that period. This keeps FY2024/FY2025/FY2026 aligned even when
    # a newer 10-K contains comparative figures.
    out = {}
    for end, x in by_end.items():
        fy = x.get("fy")
        if not fy:
            # Fallback: derive a calendar-year label only when SEC did not
            # provide a fiscal-year focus.
            fy = date.fromisoformat(end).year
        row = dict(x)
        row.pop("_rank", None)
        out[str(fy)] = row
    return out

def get_market_data(ticker):
    try:
        data = get_json(PRICE_URL.format(ticker))
        result = data["chart"]["result"][0]
        meta = result.get("meta", {})
        price = meta.get("regularMarketPrice")
        if price is None:
            closes = [x for x in (result.get("indicators", {}).get("quote", [{}])[0].get("close", []) or []) if x is not None]
            price = closes[-1] if closes else None
        return price, meta.get("currency", "USD"), meta.get("exchangeName")
    except Exception as e:
        print(ticker, "PRICE ERROR", repr(e))
        return None, None, None

def get_splits(ticker):
    # Yahoo's chart endpoint exposes historical forward and reverse stock splits.
    # Each event has a ratio such as 10:1 (forward) or 1:10 (reverse).
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?period1=0&period2={int(time.time())}&interval=1d&events=split"
        data = get_json(url)
        result = data["chart"]["result"][0]
        events = result.get("events", {}).get("splits", {})
        out = []
        for ts, event in events.items():
            ratio = str(event.get("splitRatio", ""))
            if ":" not in ratio:
                continue
            a, b = ratio.split(":", 1)
            try:
                factor = float(a) / float(b)
                split_date = date.fromtimestamp(int(ts)).isoformat()
            except Exception:
                continue
            if factor > 0 and factor != 1:
                out.append((split_date, factor, ratio))
        return sorted(out)
    except Exception as e:
        print(ticker, "SPLIT ERROR", repr(e))
        return []

def eps_split_adjustment(period_end, splits):
    # EPS moves inversely to the number of shares after a split.
    # A 10:1 forward split therefore divides historical EPS by 10;
    # a 1:10 reverse split multiplies it by 10.
    factor = 1.0
    for split_date, share_factor, _ratio in splits:
        if split_date > period_end:
            factor /= share_factor
    return factor

def build_company(ticker, cik):
    facts = get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")
    metrics = annual_facts(facts)
    raw_facts = facts.get("facts", {}).get("us-gaap", {})
    dei_facts = facts.get("facts", {}).get("dei", {})
    yearly = {m: select_yearly(rows) for m, rows in metrics.items()}
    for metric in ["cash", "assets", "equity", "debt_current", "debt_noncurrent", "shares_outstanding"]:
        rows = []
        for tag in TAGS.get(metric, []):
            source_facts = dei_facts if tag == "EntityCommonStockSharesOutstanding" else raw_facts
            if tag not in source_facts:
                continue
            units = source_facts[tag].get("units", {})
            unit = "shares" if "shares" in units else ("USD" if "USD" in units else None)
            if not unit:
                continue
            for x in units[unit]:
                if x.get("form", "") not in ("10-K", "10-K/A") or not x.get("end") or x.get("start"):
                    continue
                row = dict(x)
                row["_tag"] = tag
                rows.append(row)
        if rows:
            yearly[metric] = select_instant(rows)
    years = sorted(set().union(*[set(v.keys()) for v in yearly.values()]), key=int)
    years = years[-10:]
    price, currency, exchange = get_market_data(ticker)
    splits = get_splits(ticker)
    result = {"source": "SEC XBRL companyfacts", "cik": cik, "price": price, "price_currency": currency or "USD", "exchange": exchange, "price_source": "Yahoo Finance chart endpoint", "price_updated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "years": ["FY" + y for y in years], "currency": "USD", "metrics": []}

    specs = [
        ("Revenue", "revenue", "B"),
        ("Gross profit", "gross_profit", "B"),
        ("Operating income", "operating_income", "B"),
        ("Net income", "net_income", "B"),
        ("Diluted EPS", "eps", "$"),
        ("R&D", "rnd", "B"),
        ("D&A", "da", "B"),
        ("Cash", "cash", "B"),
        ("Current debt", "debt_current", "B"),
        ("Long-term debt", "debt_noncurrent", "B"),
        ("Total assets", "assets", "B"),
        ("Total equity", "equity", "B"),
        ("Shares outstanding", "shares_outstanding", "M"),
    ]
    for label, key, unit in specs:
        vals = []
        for y in years:
            v = yearly.get(key, {}).get(y)
            if v:
                value = float(v["val"])
                if key == "eps":
                    value *= eps_split_adjustment(v["end"], splits)
                divisor = 1e9 if unit == "B" else (1e6 if unit == "M" else 1)
                vals.append(round(value / divisor, 6))
            else:
                vals.append(None)
        if any(v is not None for v in vals):
            result["metrics"].append({"name": label, "unit": unit, "values": vals})

    cfo = yearly.get("cfo", {})
    capex = yearly.get("capex", {})
    fcf = []
    for y in years:
        a, b = cfo.get(y), capex.get(y)
        if a and b:
            fcf.append(round((float(a["val"]) - abs(float(b["val"]))) / 1e9, 6))
        else:
            fcf.append(None)
    if any(v is not None for v in fcf):
        result["metrics"].append({"name": "Free cash flow", "unit": "B", "values": fcf})

    def arr(name):
        for m in result["metrics"]:
            if m["name"] == name:
                return m["values"]
        return [None] * len(years)

    rev, op, ni, eps, gp, da = arr("Revenue"), arr("Operating income"), arr("Net income"), arr("Diluted EPS"), arr("Gross profit"), arr("D&A")
    cash, debtc, debtl, assets, equity = arr("Cash"), arr("Current debt"), arr("Long-term debt"), arr("Total assets"), arr("Total equity")
    fcfv, rnd, shares = arr("Free cash flow"), arr("R&D"), arr("Shares outstanding")

    def derived(name, values, unit="ratio"):
        if any(v is not None for v in values):
            result["metrics"].append({"name": name, "unit": unit, "values": [None if v is None else round(v, 6) for v in values]})

    # Derived operating and capital-efficiency metrics.
    ebitda = [None if op[i] is None or da[i] is None else op[i] + da[i] for i in range(len(years))]
    netdebt = [None if cash[i] is None or debtc[i] is None or debtl[i] is None else debtc[i] + debtl[i] - cash[i] for i in range(len(years))]
    opmargin = [None if rev[i] in (None,0) or op[i] is None else op[i]/rev[i] for i in range(len(years))]
    grossmargin = [None if rev[i] in (None,0) or gp[i] is None else gp[i]/rev[i] for i in range(len(years))]
    fcfmargin = [None if rev[i] in (None,0) or fcfv[i] is None else fcfv[i]/rev[i] for i in range(len(years))]
    fcfconv = [None if ni[i] in (None,0) or fcfv[i] is None else fcfv[i]/ni[i] for i in range(len(years))]
    debt_equity = [None if equity[i] in (None,0) or debtc[i] is None or debtl[i] is None else (debtc[i]+debtl[i])/equity[i] for i in range(len(years))]
    netdebt_ebitda = [None if ebitda[i] in (None,0) or netdebt[i] is None else netdebt[i]/ebitda[i] for i in range(len(years))]

    revenue_growth = [None] + [None if rev[i] is None or rev[i-1] in (None,0) else rev[i]/rev[i-1]-1 for i in range(1,len(years))]
    eps_growth = [None] + [None if eps[i] is None or eps[i-1] in (None,0) else eps[i]/eps[i-1]-1 for i in range(1,len(years))]
    fcf_growth = [None] + [None if fcfv[i] is None or fcfv[i-1] in (None,0) else fcfv[i]/fcfv[i-1]-1 for i in range(1,len(years))]

    avg_equity = [None] + [None if equity[i] is None or equity[i-1] is None else (equity[i]+equity[i-1])/2 for i in range(1,len(years))]
    roe = [None if avg_equity[i] in (None,0) or ni[i] is None else ni[i]/avg_equity[i] for i in range(len(years))]
    avg_invested = [None] + [None if netdebt[i] is None or equity[i] is None or netdebt[i-1] is None or equity[i-1] is None else ((netdebt[i]+equity[i])+(netdebt[i-1]+equity[i-1]))/2 for i in range(1,len(years))]
    tax = yearly.get("tax_expense", {})
    pretax = yearly.get("pretax_income", {})
    tax_rates=[]
    nopat=[]
    for y in years:
        t,p=tax.get(y),pretax.get(y)
        if t and p and float(p["val"]) != 0:
            rate=max(0,min(1,float(t["val"])/float(p["val"])))
            tax_rates.append(rate)
            idx=years.index(y)
            nopat.append(None if op[idx] is None else op[idx]*(1-rate))
        else:
            tax_rates.append(None); nopat.append(None)
    roic=[None if avg_invested[i] in (None,0) or nopat[i] is None else nopat[i]/avg_invested[i] for i in range(len(years))]

    derived("EBITDA", ebitda, "B")
    derived("EBIT", op, "B")
    derived("Net debt", netdebt, "B")
    derived("Gross margin", grossmargin)
    derived("Operating margin", opmargin)
    derived("FCF margin", fcfmargin)
    derived("Revenue growth", revenue_growth)
    derived("EPS growth", eps_growth)
    derived("FCF growth", fcf_growth)
    derived("FCF conversion", fcfconv)
    derived("ROE", roe)
    derived("ROIC", roic)
    derived("Debt / equity", debt_equity)
    derived("Net debt / EBITDA", netdebt_ebitda)
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
