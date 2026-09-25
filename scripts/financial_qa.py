import argparse, json, math, os, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
import requests

from financial_eps_overrides import SEC_EPS_RESTATED_FALLBACKS
from financial_revenue_overrides import SEC_REVENUE_REPORTED_OVERRIDES
from financial_tag_selection import prefer_total_revenue_annual_facts

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
    "eps": ["EarningsPerShareDiluted", "DilutedEarningsLossPerShare", "BasicAndDilutedEarningsLossPerShare", "DilutedEarningsPerShare"],
    "rnd": ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost", "ResearchAndDevelopmentExpenditure"],
    "tax_expense": ["IncomeTaxExpenseBenefit", "IncomeTaxExpenseContinuingOperations"],
    "pretax_income": ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "ProfitLossBeforeTax"],
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

SEC_SPLIT_FALLBACKS = {
    "SHOP": [("2022-06-28", 10.0)],  # SEC: 10-for-1 split, effective June 28, 2022
}

# HONA is a special case: it became independently traded on June 29, 2026.
# Its historical FY2024/FY2025 financials were released by Honeywell Aerospace
# in SEC-filed supplemental historical information rather than legacy HONA 10-Ks.
HONA_HISTORICAL_FINANCIALS = {
    "2023": {"revenue": 13.790, "gross_profit": 5.283, "operating_income": 3.564, "net_income": 2.886, "eps": 9.11},
    "2024": {"revenue": 15.445, "gross_profit": 5.502, "operating_income": 3.509, "net_income": 2.817, "eps": 8.89},
    "2025": {"revenue": 17.404, "gross_profit": 6.063, "operating_income": 3.257, "net_income": 1.780, "eps": 5.62},
}


SPECIAL_SEC_COVERAGE = {
    "HONA": {"cik": "0002089271", "reason": "2026 spin-off; historical FY2024/FY2025 supplemental SEC filing; latest 10-Q available"}
}
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
    if metric == "revenue":
        rows = prefer_total_revenue_annual_facts(rows)
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

def latest_annual_by_end(rows):
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

def latest_annual_eps(rows):
    return latest_annual_by_end(rows)
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

def audit_derived_metrics(g, facts=None):
    """Recompute stored derived series and latest ratios from generated inputs."""
    years = [str(y).replace("FY", "") for y in g.get("years", [])]
    size = len(years)
    metric_rows = {m.get("name"): m.get("values", []) for m in g.get("metrics", [])}

    def values(name):
        row = metric_rows.get(name, [])
        return row if len(row) == size else (row + [None] * size)[:size]

    def divide(a, b):
        return None if a is None or b in (None, 0) else a / b

    def combine(a, b, operation):
        return [None if x is None or y is None else operation(x, y) for x, y in zip(a, b)]

    rev = values("Revenue")
    gp = values("Gross profit")
    op = values("Operating income")
    ni = values("Net income")
    eps = values("Diluted EPS")
    da = values("D&A")
    cash = values("Cash")
    debtc = values("Current debt")
    debtl = values("Long-term debt")
    equity = values("Total equity")
    fcf = values("Free cash flow")
    capex = values("Capex spend")
    netdebt = [None if any(x is None for x in row) else row[0] + row[1] - row[2]
               for row in zip(debtc, debtl, cash)]
    ebitda = combine(op, da, lambda a, b: a + b)

    def growth(series):
        out = [None] if size else []
        for i in range(1, size):
            out.append(None if series[i] is None or series[i-1] in (None, 0)
                       else series[i] / series[i-1] - 1)
        return out

    expected = {
        "EBITDA": ebitda,
        "EBIT": op,
        "Net debt": netdebt,
        "Gross margin": [divide(gp[i], rev[i]) for i in range(size)],
        "Operating margin": [divide(op[i], rev[i]) for i in range(size)],
        "FCF margin": [divide(fcf[i], rev[i]) for i in range(size)],
        "Revenue growth": growth(rev),
        "EPS growth": growth(eps),
        "FCF growth": growth(fcf),
        "FCF conversion": [divide(fcf[i], ni[i]) for i in range(size)],
        "Debt / equity": [None if equity[i] in (None, 0) or debtc[i] is None or debtl[i] is None
                          else (debtc[i] + debtl[i]) / equity[i] for i in range(size)],
        "Net debt / EBITDA": [divide(netdebt[i], ebitda[i]) for i in range(size)],
    }

    # Independently reproduce annual FCF and ROIC from freshly fetched SEC facts.
    annual_nopat = [None] * size
    if facts is not None:
        def latest_fy(metric):
            rows = annual_rows(facts, metric)
            canonical = canonical_annual(rows)
            latest = latest_annual_by_end(rows)
            return {fy: latest.get(original.get("end"), original)
                    for fy, original in canonical.items()}

        cfo_by_fy = latest_fy("cfo")
        tax_by_fy = latest_fy("tax_expense")
        pretax_by_fy = latest_fy("pretax_income")
        fcf_expected = []
        for i, fy in enumerate(years):
            cfo = cfo_by_fy.get(fy)
            fcf_expected.append(None if cfo is None or capex[i] is None else
                                (float(cfo["val"]) - abs(capex[i] * 1e9)) / 1e9)
            tax, pretax = tax_by_fy.get(fy), pretax_by_fy.get(fy)
            if tax and pretax and float(pretax["val"]) != 0 and op[i] is not None:
                rate = max(0, min(1, float(tax["val"]) / float(pretax["val"])))
                annual_nopat[i] = op[i] * (1 - rate)
        expected["Free cash flow"] = fcf_expected
    else:
        expected["Free cash flow"] = [None] * size

    avg_equity = [None] + [
        None if equity[i] is None or equity[i-1] is None
        else (equity[i] + equity[i-1]) / 2 for i in range(1, size)
    ] if size else []
    expected["ROE"] = [divide(ni[i], avg_equity[i]) for i in range(size)]
    invested = [None if netdebt[i] is None or equity[i] is None else netdebt[i] + equity[i]
                for i in range(size)]
    avg_invested = [None] + [
        None if invested[i] is None or invested[i-1] is None
        else (invested[i] + invested[i-1]) / 2 for i in range(1, size)
    ] if size else []
    expected["ROIC"] = [divide(annual_nopat[i], avg_invested[i]) for i in range(size)]

    checks = {}

    def same(a, b):
        if a is None or b is None:
            return a is None and b is None
        try:
            return math.isfinite(float(a)) and math.isfinite(float(b)) and abs(float(a) - float(b)) <= 1.1e-6
        except (TypeError, ValueError):
            return False

    for name, exp_values in expected.items():
        actual = metric_rows.get(name)
        mismatches = []
        checked = 0
        if actual is None:
            actual_values = [None] * size
        else:
            actual_values = actual
            if len(actual_values) != size:
                mismatches.append({"reason": "length", "actual": len(actual_values), "expected": size})
        for i, fy in enumerate(years):
            exp = exp_values[i] if i < len(exp_values) else None
            got = actual_values[i] if i < len(actual_values) else None
            if exp is not None or got is not None:
                checked += 1
            if not same(got, exp):
                mismatches.append({"fy": "FY" + fy, "actual": got, "expected": exp})
        checks[name] = {"checked": checked, "mismatches": mismatches}

    latest = g.get("latest_reported", {})
    latest_metrics = latest.get("metrics", {})
    latest_ratios = latest.get("ratios", {})
    latest_cash = latest_metrics.get("cash", {}).get("value")
    latest_debtc = latest_metrics.get("debt_current", {}).get("value")
    latest_debtl = latest_metrics.get("debt_noncurrent", {}).get("value")
    latest_equity = latest_metrics.get("equity", {}).get("value")
    latest_debt = None if latest_debtc is None and latest_debtl is None else (latest_debtc or 0) + (latest_debtl or 0)
    latest_netdebt = None if latest_debt is None or latest_cash is None else latest_debt - latest_cash
    latest_invested = None if latest_equity is None or latest_debt is None or latest_cash is None else latest_equity + latest_debt - latest_cash
    latest_idx = size - 1 if size else None

    def scalar(label, expected_value, actual_value):
        mismatch = [] if same(actual_value, expected_value) else [
            {"actual": actual_value, "expected": expected_value}
        ]
        checks[label] = {"checked": 0 if expected_value is None and actual_value is None else 1,
                         "mismatches": mismatch}

    scalar("Latest net debt", latest_netdebt, latest_ratios.get("net_debt", {}).get("value"))
    scalar("Latest debt / equity", divide(latest_debt, latest_equity),
           latest_ratios.get("debt_equity", {}).get("value"))
    scalar("Latest net debt / annual EBITDA",
           divide(latest_netdebt, ebitda[latest_idx]) if latest_idx is not None else None,
           latest_ratios.get("net_debt_ebitda", {}).get("value"))
    scalar("Latest annual ROE",
           divide(ni[latest_idx], latest_equity) if latest_idx is not None else None,
           latest_ratios.get("roe", {}).get("value"))
    scalar("Latest annual ROIC",
           divide(annual_nopat[latest_idx], latest_invested) if latest_idx is not None else None,
           latest_ratios.get("roic", {}).get("value"))

    ttm = latest.get("ttm", {})
    ttm_fcf = ttm.get("fcf", {})
    ttm_cfo, ttm_capex = ttm.get("cfo", {}), ttm.get("capex", {})
    expected_ttm_fcf = None
    if (ttm_cfo.get("value") is not None and ttm_capex.get("value") is not None
            and ttm_cfo.get("period_end") == ttm_capex.get("period_end")):
        expected_ttm_fcf = ttm_cfo["value"] - abs(ttm_capex["value"])
    scalar("TTM free cash flow", expected_ttm_fcf, ttm_fcf.get("value"))

    ttm_rev = ttm.get("revenue", {}).get("value")
    ttm_op = ttm.get("operating_income", {}).get("value")
    ttm_ni = ttm.get("net_income", {}).get("value")
    ttm_da = ttm.get("da", {}).get("value")
    ttm_tax = ttm.get("tax_expense", {}).get("value")
    ttm_pretax = ttm.get("pretax_income", {}).get("value")
    ttm_ebitda = None if ttm_op is None or ttm_da is None else ttm_op + ttm_da
    ttm_nopat = None
    if ttm_op is not None and ttm_tax is not None and ttm_pretax not in (None, 0):
        ttm_rate = max(0, min(1, ttm_tax / ttm_pretax))
        ttm_nopat = ttm_op * (1 - ttm_rate)
    for key, label, expected_value in [
        ("net_debt_ebitda_ttm", "TTM net debt / EBITDA", divide(latest_netdebt, ttm_ebitda)),
        ("roic_ttm", "TTM ROIC", divide(ttm_nopat, latest_invested)),
        ("roe_ttm", "TTM ROE", divide(ttm_ni, latest_equity)),
        ("fcf_margin_ttm", "TTM FCF margin", divide(ttm_fcf.get("value"), ttm_rev)),
    ]:
        scalar(label, expected_value, latest_ratios.get(key, {}).get("value"))

    return checks

def audit_one(stock, generated, cik_map):
    ticker = stock["ticker"].upper()
    cik = cik_map.get(ticker)
    if not cik or cik == "0000000000":
        special=SPECIAL_SEC_COVERAGE.get(ticker)
        if special:
            return {"ticker":ticker,"status":"special_source","cik":special["cik"],"reason":special["reason"]}
        return {"ticker":ticker,"status":"missing_cik"}
    try:
        if ticker == "HONA":
            g = generated.get(ticker)
            if not g:
                return {"ticker": ticker, "status": "missing_generated_data", "reason": "HONA special-source normalization missing"}
            labels = {"revenue": "Revenue", "gross_profit": "Gross profit", "operating_income": "Operating income", "net_income": "Net income", "eps": "Diluted EPS"}
            issues = []
            years = [y.replace("FY", "") for y in g.get("years", [])]
            for metric in ("revenue", "gross_profit", "operating_income", "net_income", "eps"):
                gm = next((m for m in g.get("metrics", []) if m.get("name") == labels[metric]), None)
                if not gm:
                    issues.append(metric + "_missing")
                    continue
                for fy, expected in HONA_HISTORICAL_FINANCIALS.items():
                    if fy not in years:
                        issues.append(metric + "_" + fy + "_missing")
                        continue
                    actual = float(gm["values"][years.index(fy)])
                    target = expected[metric]
                    tol = 0.015 if metric == "eps" else max(0.001, abs(target) * 0.001)
                    if not close(actual, target, tol):
                        issues.append({"metric": metric, "fy": fy, "actual": actual, "expected": target})
            derived_checks = audit_derived_metrics(g)
            if any(check["mismatches"] for check in derived_checks.values()):
                issues.append("derived_metrics")
            return {"ticker": ticker, "status": "pass" if not issues else "mismatch", "issues": issues, "derived_checks": derived_checks, "special_source": "SEC-filed HONA standalone historical information"}
        facts=get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")
        g=generated.get(ticker)
        if not g:
            special=SPECIAL_SEC_COVERAGE.get(ticker)
            if special:
                # Confirm the dedicated SEC filer exists and has current XBRL filings.
                sub=get_json(f"https://data.sec.gov/submissions/CIK{special['cik']}.json")
                forms=sub.get("filings",{}).get("recent",{}).get("form",[])
                period=sub.get("filings",{}).get("recent",{}).get("reportDate",[])
                return {"ticker":ticker,"status":"special_source","cik":special["cik"],"reason":special["reason"],"latest_forms":forms[:10],"latest_report_dates":period[:10]}
            return {"ticker":ticker,"status":"missing_generated_data"}
        splits=get_splits(ticker)
        if ticker in SEC_SPLIT_FALLBACKS:
            known={d:f for d,f in splits}
            for d,f in SEC_SPLIT_FALLBACKS[ticker]:
                known[d]=f
            splits=sorted(known.items())
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
            latest_by_end = latest_annual_by_end(rows)
            latest_can = {y: latest_by_end.get(original.get("end"), original) for y, original in can.items()}
            for i,y in enumerate(year_keys):
                if not gm or i >= len(gm.get("values",[])) or y not in latest_can:
                    continue
                expected=float(latest_can[y]["val"])
                if metric == "revenue" and ticker in SEC_REVENUE_REPORTED_OVERRIDES and y in SEC_REVENUE_REPORTED_OVERRIDES[ticker]:
                    expected = float(SEC_REVENUE_REPORTED_OVERRIDES[ticker][y]) * 1e9
                if metric=="eps":
                    # Compare the app's value with the latest filed annual EPS
                    # normalized for every split after that filing date.
                    eps_rows = [x for x in rows if x.get("end") == latest_can[y]["end"]]
                    if any(x.get("_taxonomy") == "us-gaap" for x in eps_rows):
                        eps_rows = [x for x in eps_rows if x.get("_taxonomy") == "us-gaap"]
                    latest = latest_annual_eps(eps_rows).get(can[y]["end"]) if eps_rows else None
                    if latest:
                        expected = adjust_eps(latest,splits) if latest.get("form") in ("10-K","10-K/A") else float(latest["val"])
                    # Some issuers retrospectively restate historical EPS after a split.
                    # Prefer the explicitly documented SEC restatement over the original filing basis.
                    if ticker in SEC_EPS_RESTATED_FALLBACKS and y in SEC_EPS_RESTATED_FALLBACKS[ticker]:
                        expected = float(SEC_EPS_RESTATED_FALLBACKS[ticker][y])
                raw_actual = gm["values"][i]
                if raw_actual is None:
                    checked += 1
                    mismatches.append({"fy": y, "actual": None, "expected": expected,
                                       "source_tag": latest_can[y].get("_tag"),
                                       "filed": latest_can[y].get("filed")})
                    continue
                actual = float(raw_actual) if metric == "eps" else float(raw_actual) * 1e9
                checked += 1
                if not close(actual, expected, TOL["eps"] if metric=="eps" else max(1.0,abs(expected))*0.001):
                    mismatches.append({"fy":y,"actual":actual,"expected":expected,"source_tag":latest_can[y].get("_tag"),"filed":latest_can[y].get("filed")})
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
        derived_checks = audit_derived_metrics(g, facts)
        if any(check["mismatches"] for check in derived_checks.values()):
            issues.append("derived_metrics")
        return {"ticker":ticker,"status":"pass" if not issues else "mismatch","issues":issues,"checks":metric_checks,"derived_checks":derived_checks,"latest_period":latest_end,"latest_form":latest.get("form")}
    except Exception as e:
        return {"ticker":ticker,"status":"error","error":repr(e)}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--count", type=int, default=0)
    parser.add_argument("--output", default=str(REPORT))
    args = parser.parse_args()

    universe=json.loads(UNIVERSE.read_text())
    generated=json.loads(FINANCIALS.read_text())
    stocks=universe.get("stocks",[])
    stocks = sorted(stocks, key=lambda x: x["ticker"].upper())
    if args.count > 0:
        stocks = stocks[args.start:args.start + args.count]
    else:
        stocks = stocks[args.start:]
    sec_map=get_json("https://www.sec.gov/files/company_tickers.json")
    cik_map={v["ticker"].upper():str(v["cik_str"]).zfill(10) for v in sec_map.values()}
    cik_map.update({"BF.B":"0000014693","BRK.B":"0001067983","EA":"0000712515","XOM":"0000034088"})
    # SEC's API is the accounting source of truth; v2 the audit independently
    # Full-universe audit: keep this workflow-triggering comment with the QA logic.
    # re-selects annual and point-in-time facts from fresh companyfacts data.
    results=[]
    with ThreadPoolExecutor(max_workers=2) as ex:
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
    for r in mismatch[:10]:
        print("MISMATCH", r["ticker"], json.dumps({k:v for k,v in r["checks"].items() if v["mismatches"]}, separators=(",", ":")))
    for r in errors[:10]:
        print("ERROR", r["ticker"], r.get("error"))
    quality = {
        "missing_eps_tickers": [], "year_gaps": [], "revenue_jumps": [],
        "eps_growth_jumps": [], "fcf_growth_jumps": [], "fiscal_year_order": [],
        "metric_coverage": {}, "ttm_metric_coverage": {}, "latest_balance_sheet_coverage": {},
    }
    for ticker, g in generated.items():
        years = g.get("years", [])
        eps_metric = next((m for m in g.get("metrics", []) if m.get("name") == "Diluted EPS"), None)
        if not eps_metric or not any(v is not None for v in eps_metric.get("values", [])):
            quality["missing_eps_tickers"].append(ticker)
        nums = [int(y.replace("FY","")) for y in years if str(y).startswith("FY") and str(y)[2:].isdigit()]
        if nums != sorted(set(nums)):
            quality["fiscal_year_order"].append({"ticker":ticker,"years":years})
        for a,b in zip(nums, nums[1:]):
            if b-a > 1:
                quality["year_gaps"].append({"ticker":ticker,"from":f"FY{a}","to":f"FY{b}","gap":b-a})
        rev = next((m for m in g.get("metrics", []) if m.get("name") == "Revenue"), None)
        if rev:
            vals = rev.get("values", [])
            for i in range(1, min(len(vals), len(years))):
                a,b=vals[i-1],vals[i]
                if a is None or b is None or abs(a) < 0.2:
                    continue
                ratio=b/a
                if ratio < 0.30 or ratio > 3.50:
                    quality["revenue_jumps"].append({"ticker":ticker,"from":years[i-1],"to":years[i],"from_value":a,"to_value":b,"ratio":ratio})
        for metric_name, diagnostic_name in (("Diluted EPS", "eps_growth_jumps"), ("Free cash flow", "fcf_growth_jumps")):
            metric = next((m for m in g.get("metrics", []) if m.get("name") == metric_name), None)
            if not metric:
                continue
            vals = metric.get("values", [])
            for i in range(1, min(len(vals), len(years))):
                a,b=vals[i-1],vals[i]
                if a is None or b is None or a <= 0 or b <= 0 or a < 0.1:
                    continue
                ratio=b/a
                if ratio < 0.30 or ratio > 3.50:
                    quality[diagnostic_name].append({"ticker":ticker,"from":years[i-1],"to":years[i],"from_value":a,"to_value":b,"ratio":ratio})
    metric_names = ["Revenue", "Operating income", "Net income", "Diluted EPS", "Free cash flow", "EBITDA", "ROE", "ROIC"]
    all_year_slots = sum(len(g.get("years", [])) for g in generated.values())
    for name in metric_names:
        available_values = 0
        stocks_with_values = 0
        latest_year_available = 0
        missing_tickers = []
        for ticker, g in generated.items():
            row = next((m for m in g.get("metrics", []) if m.get("name") == name), None)
            vals = row.get("values", []) if row else []
            count = sum(v is not None for v in vals)
            available_values += count
            if count:
                stocks_with_values += 1
            else:
                missing_tickers.append(ticker)
            if vals and vals[-1] is not None:
                latest_year_available += 1
        quality["metric_coverage"][name] = {
            "stocks_with_values": stocks_with_values,
            "stocks_missing": len(missing_tickers),
            "missing_tickers": missing_tickers,
            "available_year_values": available_values,
            "expected_year_slots": all_year_slots,
            "missing_year_values": all_year_slots - available_values,
            "latest_year_available_stocks": latest_year_available,
        }

    ttm_names = ["revenue", "operating_income", "net_income", "cfo", "capex", "fcf", "tax_expense", "pretax_income"]
    for name in ttm_names:
        available = [ticker for ticker, g in generated.items()
                     if g.get("latest_reported", {}).get("ttm", {}).get(name, {}).get("value") is not None]
        quality["ttm_metric_coverage"][name] = {
            "stocks_with_values": len(available),
            "stocks_missing": len(generated) - len(available),
            "missing_tickers": sorted(set(generated) - set(available)),
        }

    bs_names = ["cash", "assets", "equity", "debt_current", "debt_noncurrent", "shares_outstanding"]
    for name in bs_names:
        available = [ticker for ticker, g in generated.items()
                     if g.get("latest_reported", {}).get("metrics", {}).get(name, {}).get("value") is not None]
        quality["latest_balance_sheet_coverage"][name] = {
            "stocks_with_values": len(available),
            "stocks_missing": len(generated) - len(available),
            "missing_tickers": sorted(set(generated) - set(available)),
        }

    report={"generated_utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"universe_count":len(stocks),"counts":counts,"mismatch_tickers":[r["ticker"] for r in mismatch],"error_tickers":[r["ticker"] for r in errors],"quality_diagnostics":quality,"results":results}
    output_path = Path(args.output)
    output_path.write_text(json.dumps(report,indent=2))
    missing_generated=[r["ticker"] for r in results if r["status"]=="missing_generated_data"]
    missing_cik=[r["ticker"] for r in results if r["status"]=="missing_cik"]
    print(json.dumps({"universe_count":len(stocks),"counts":counts,"mismatches":len(mismatch),"errors":len(errors),"missing_generated":missing_generated,"missing_cik":missing_cik},indent=2))
    # Do not fail on a mismatch: the report is the diagnostic artifact. Fail on
    # infrastructure/data retrieval errors only.
    if errors:
        raise SystemExit(2)

if __name__=="__main__":
    main()
