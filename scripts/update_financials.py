import json, os, time
from datetime import date
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE = ROOT / "universe.json"
OUTPUT = ROOT / "financials.json"
# Regeneration marker: historical EPS is normalized from SEC annual filings and
# only post-filing stock splits are applied. Bump this when the normalization
# logic changes so the full universe is regenerated from SEC source data.
FINANCIAL_DATA_LOGIC_VERSION = "2026-09-25-sec-historical-normalization-v5-hona"
UA = os.environ.get("SEC_USER_AGENT", "Portfolio OS research app contact@example.com")
HEADERS = {"User-Agent": UA, "Accept-Encoding": "gzip, deflate"}

PRICE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=5d&interval=1d"

ANNUAL_FORMS = ("10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A")
INSTANT_FORMS = ("10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "40-F/A", "6-K", "6-K/A")
TAXONOMIES = ("us-gaap", "ifrs-full")
TAGS = {
    "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "Revenue"],
    "gross_profit": ["GrossProfit"],
    "operating_income": ["OperatingIncomeLoss", "OperatingProfitLoss"],
    "net_income": ["NetIncomeLoss", "ProfitLoss"],
    "eps": ["EarningsPerShareDiluted", "DilutedEarningsLossPerShare", "BasicAndDilutedEarningsLossPerShare", "DilutedEarningsPerShare"],
    "cfo": ["NetCashProvidedByUsedInOperatingActivities", "NetCashFlowsFromUsedInOperatingActivities"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsToAcquirePropertyPlantAndEquipmentAndOtherPropertyPlantAndEquipment", "PurchaseOfPropertyPlantAndEquipment"],
    "rnd": ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost", "ResearchAndDevelopmentExpenditure"],
    "da": ["DepreciationDepletionAndAmortization", "DepreciationDepletionAndAmortizationPropertyPlantAndEquipment", "DepreciationDepletionAndAmortizationAndAccretion", "DepreciationAndAmortisation"],
    "tax_expense": ["IncomeTaxExpenseBenefit", "IncomeTaxExpenseContinuingOperations"],
    "pretax_income": ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "ProfitLossBeforeTax"],
    "buybacks": ["PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfCommonStockIncludingExcessTaxBenefit"],
    "cash": ["CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalents"],
    "assets": ["Assets"],
    "equity": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "Equity"],
    "debt_current": ["ShortTermBorrowings", "LongTermDebtCurrent", "ShortTermDebt", "BorrowingsCurrent"],
    "debt_noncurrent": ["LongTermDebtNoncurrent", "LongTermDebt", "BorrowingsNoncurrent"],
    "shares_outstanding": ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"],
}

# Issuer-reported annual EPS overrides for documented XBRL precision/restatement cases.
# These are canonical displayed EPS values from the company's annual reporting.
SEC_EPS_RESTATED_FALLBACKS = {
    "TRI": {"2017": 1.94, "2018": 5.88, "2019": 3.11, "2020": 2.25, "2021": 11.50},
}

# Issuer-reported annual revenue overrides for documented XBRL context/tag-selection
# errors. Values are in billions of USD and apply only to affected fiscal periods.
# HONA was spun out of Honeywell in June 2026. Its standalone historical
# financial statements for FY2023-FY2025 are included in the SEC-filed
# Form 10-12B/A / supplemental historical information. Because HONA did not
# have legacy standalone 10-K companyfacts for those periods, use these
# issuer-reported standalone figures rather than reconstructing them from
# Honeywell consolidated XBRL. Values are USD billions except EPS.
HONA_HISTORICAL_FINANCIALS = {
    "2023": {"revenue": 13.790, "gross_profit": 5.283, "operating_income": 3.564, "net_income": 2.886, "eps": 9.11},
    "2024": {"revenue": 15.445, "gross_profit": 5.502, "operating_income": 3.509, "net_income": 2.817, "eps": 8.89},
    "2025": {"revenue": 17.404, "gross_profit": 6.063, "operating_income": 3.257, "net_income": 1.780, "eps": 5.62},
}

SEC_REVENUE_REPORTED_OVERRIDES = {
    "AMT": {"2019": 7.5803},
    "CFG": {"2019": 6.491},
    "COF": {"2018": 28.076},
    "DOC": {"2016": 0.241034, "2017": 0.343584, "2018": 0.422551},
    "ECHO": {"2021": 2.720916},
    "GPN": {"2017": 3.975163},
    "HIG": {"2017": 17.162},
    "KEY": {"2022": 7.272},
    "MET": {"2018": 67.941},
    "MTB": {"2022": 7.662},
    "SBAC": {"2017": 1.727674},
    "URI": {"2019": 9.351},
    "NBIS": {"2022": 0.0135},
}

def get_json(url):
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    time.sleep(0.20)
    return r.json()

def sec_ticker_map():
    data = get_json("https://www.sec.gov/files/company_tickers.json")
    m = {v["ticker"].upper(): str(v["cik_str"]).zfill(10) for v in data.values()}
    if "BRK-B" in m: m["BRK.B"] = m["BRK-B"]
    if "BF-B" in m: m["BF.B"] = m["BF-B"]
    m["HONA"] = "0002089271"
    m["EA"] = "0000712515"
    m["BF.B"] = "0000014693"
    m["XOM"] = "0000034088"
    return m

def _fact_sources(companyfacts):
    return [(taxonomy, companyfacts.get("facts", {}).get(taxonomy, {})) for taxonomy in TAXONOMIES]

def _monetary_unit(units):
    if "USD" in units: return "USD"
    candidates=[u for u in units if u not in ("USD/shares","shares","pure") and "-per-" not in u]
    return candidates[0] if candidates else None

def annual_facts(companyfacts):
    by_metric={}
    for metric,candidates in TAGS.items():
        if metric in {"cash","assets","equity","debt_current","debt_noncurrent","shares_outstanding"}: continue
        rows=[]
        for taxonomy,facts in _fact_sources(companyfacts):
            for tag in candidates:
                obj=facts.get(tag)
                if not obj: continue
                units=obj.get("units",{})
                unit="USD/shares" if "USD/shares" in units else _monetary_unit(units)
                if not unit: continue
                for x in units[unit]:
                    if x.get("form","") not in ANNUAL_FORMS or not x.get("start") or not x.get("end"): continue
                    try: days=(date.fromisoformat(x["end"])-date.fromisoformat(x["start"])).days
                    except Exception: continue
                    if 300<=days<=400:
                        row=dict(x); row["_tag"]=tag; row["_taxonomy"]=taxonomy; row["_unit"]=unit; rows.append(row)
        if rows: by_metric[metric]=rows
    return by_metric

def select_instant(rows, allowed_forms=INSTANT_FORMS):
    by_end={}
    for x in rows:
        end,filed=x.get("end"),x.get("filed")
        if x.get("form","") not in allowed_forms or not end or not filed: continue
        try:
            lag=(date.fromisoformat(filed)-date.fromisoformat(end)).days
        except Exception: continue
        if lag<0: continue
        candidate=(lag,filed); prev=by_end.get(end)
        if prev is None or candidate<prev["_rank"]:
            row=dict(x); row["_rank"]=candidate; by_end[end]=row
    return by_end

def select_latest_period(rows):
    """Return the latest reported balance-sheet fact by period end."""
    selected = select_instant(rows)
    if not selected:
        return None
    end = max(selected)
    row = dict(selected[end])
    row.pop("_rank", None)
    row["_period_end"] = end
    return row

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

def select_latest_annual_period(rows, canonical_years):
    """Use the latest annual SEC filing for each fiscal period.

    Later 10-Ks can contain corrected/recast comparative figures. Selecting
    the latest annual observation for the same period keeps historical values
    aligned with the issuer's most recently reported accounting basis.
    """
    by_end = {}
    for x in rows:
        end, filed = x.get("end"), x.get("filed")
        if not end or not filed or x.get("form") not in ANNUAL_FORMS:
            continue
        try:
            days = (date.fromisoformat(end) - date.fromisoformat(x["start"])).days
        except Exception:
            continue
        if not (300 <= days <= 400):
            continue
        prev = by_end.get(end)
        if prev is None or filed > prev.get("filed", ""):
            by_end[end] = dict(x)
    return {
        str(fy): by_end.get(original.get("end"), original)
        for fy, original in canonical_years.items()
    }

def select_latest_annual_eps(rows, canonical_years):
    return select_latest_annual_period(rows, canonical_years)

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

def eps_split_adjustment(basis_date, splits, allow_external_splits=True):
    if not allow_external_splits:
        return 1.0
    # EPS is reported on the share basis used in the filing. A later stock
    # split is not necessarily reflected in older filings, so normalize based
    # on the filing date rather than the fiscal period end.
    #
    # Example: NVIDIA FY2022 EPS was reported in a 2022 10-K after the 2021
    # 4-for-1 split, but before the 2024 10-for-1 split. We therefore divide
    # that historical EPS by 10, but must not divide by the already-reflected
    # 4-for-1 split again.
    factor = 1.0
    for split_date, share_factor, _ratio in splits:
        if split_date > basis_date:
            factor /= share_factor
    return factor
def build_company(ticker, cik):
    facts = get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")
    metrics = annual_facts(facts)
    raw_facts = facts.get("facts", {}).get("us-gaap", {})
    dei_facts = facts.get("facts", {}).get("dei", {})
    yearly = {m: select_yearly(rows) for m, rows in metrics.items()}

    # Historical flow metrics are normalized to the latest annual SEC filing
    # available for each fiscal period. This captures retrospective corrections
    # and comparative recasts instead of freezing the original filing forever.
    for metric, rows in metrics.items():
        if metric in yearly and metric != "eps":
            yearly[metric] = select_latest_annual_period(rows, yearly[metric])

    # EPS is special: later 10-Ks generally restate historical EPS after
    # stock splits. Use the latest annual filing for each period so EPS growth
    # is calculated on a consistent current-share basis. This avoids applying
    # a market-data split factor to SEC EPS that may already be split-adjusted.
    if "eps" in metrics:
        yearly["eps"] = select_latest_annual_eps(metrics["eps"], yearly.get("eps", {}))

    # Instant balance-sheet facts are keyed by period-end dates, while annual
    # income/cash-flow facts are keyed by SEC fiscal-year labels. Normalize
    # instant facts onto the same fiscal-year keys before building the output.
    instant_by_metric = {}
    for metric in ("cash","assets","equity","debt_current","debt_noncurrent","shares_outstanding"):
        rows=[]
        for taxonomy, source_facts in _fact_sources(facts):
            for tag in TAGS.get(metric,[]):
                obj=source_facts.get(tag)
                if not obj: continue
                units=obj.get("units",{})
                unit="shares" if "shares" in units else ("USD" if "USD" in units else _monetary_unit(units))
                if not unit: continue
                for x in units[unit]:
                    if x.get("form","") not in INSTANT_FORMS or not x.get("end") or x.get("start"): continue
                    row=dict(x); row["_tag"]=tag; row["_taxonomy"]=taxonomy; row["_unit"]=unit; rows.append(row)
        if rows: instant_by_metric[metric]=select_instant(rows)

    # The annual facts provide the canonical fiscal-year labels and period
    # ends. Match each instant fact to the annual fiscal year with the same
    # period end. This avoids trying to sort ISO dates as integer FY labels.
    years = set()
    annual_end_by_year = {}
    for metric_rows in yearly.values():
        for fy, row in metric_rows.items():
            years.add(str(fy))
            annual_end_by_year.setdefault(str(fy), row.get("end"))
    years = sorted(years, key=int)[-10:]

    for metric, instant_rows in instant_by_metric.items():
        normalized = {}
        for fy in years:
            end = annual_end_by_year.get(fy)
            if end and end in instant_rows:
                normalized[fy] = instant_rows[end]
        if normalized:
            yearly[metric] = normalized

    latest_quarter = {}
    for metric, rows in instant_by_metric.items():
        latest = select_latest_period(rows.values())
        if latest:
            latest_quarter[metric] = latest

    # Use one common period across point-in-time metrics so the UI never
    # combines balance-sheet facts from different filings/periods.
    period_counts = {}
    for row in latest_quarter.values():
        period = row.get("_period_end")
        if period:
            period_counts[period] = period_counts.get(period, 0) + 1
    common_period = max(period_counts, key=lambda p: (period_counts[p], p)) if period_counts else None
    if common_period:
        common_latest = {}
        for metric, rows in instant_by_metric.items():
            row = rows.get(common_period)
            if row:
                common_latest[metric] = dict(row)
                common_latest[metric]["_period_end"] = common_period
        latest_quarter = common_latest

    price, currency, exchange = get_market_data(ticker)
    splits = get_splits(ticker)

    # Normalize annual SEC EPS to the current share basis. The selected
    # observation is the latest annual filing containing that fiscal period,
    # so later splits must be applied based on filing date rather than fiscal
    # period end. This handles multiple split eras without double adjustment.
    for fy, row in yearly.get("eps", {}).items():
        basis_date = row.get("filed") or row.get("end")
        if basis_date:
            row["val"] = float(row["val"]) * eps_split_adjustment(basis_date, splits, allow_external_splits=row.get("form") in ANNUAL_FORMS)
        if ticker in SEC_EPS_RESTATED_FALLBACKS and fy in SEC_EPS_RESTATED_FALLBACKS[ticker]:
            row["val"] = float(SEC_EPS_RESTATED_FALLBACKS[ticker][fy])
    latest_period_end = common_period
    latest_form = None
    latest_filed = None
    if latest_period_end:
        latest_rows = list(latest_quarter.values())
        forms = {row.get("form") for row in latest_rows}
        filed_dates = [row.get("filed") for row in latest_rows if row.get("filed")]
        latest_filed = min(filed_dates) if filed_dates else None
        latest_form = ("10-Q" if "10-Q" in forms else "10-Q/A" if "10-Q/A" in forms else "6-K" if "6-K" in forms else "6-K/A" if "6-K/A" in forms else "10-K" if "10-K" in forms else "10-K/A" if "10-K/A" in forms else "20-F" if "20-F" in forms else "20-F/A" if "20-F/A" in forms else "40-F" if "40-F" in forms else "40-F/A" if "40-F/A" in forms else None)
    result = {
        "source": "SEC XBRL companyfacts",
        "financial_data_logic_version": FINANCIAL_DATA_LOGIC_VERSION,
        "cik": cik,
        "price": price,
        "price_currency": currency or "USD",
        "exchange": exchange,
        "price_source": "Yahoo Finance chart endpoint",
        "price_updated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "years": ["FY" + y for y in years],
        "currency": next((yearly.get("revenue",{}).get(y,{}).get("_unit") for y in years if yearly.get("revenue",{}).get(y,{}).get("_unit")), "USD"),
        "latest_reported": {
            "period_end": latest_period_end,
            "form": latest_form,
            "filed": latest_filed,
            "is_quarterly": latest_form in ("10-Q", "10-Q/A", "6-K", "6-K/A") if latest_form else False,
            "label": ("Latest quarter" if latest_form in ("10-Q", "10-Q/A") else
                      "Latest annual report" if latest_form in ("10-K", "10-K/A") else
                      "Latest reported"),
            "metrics": {}
        },
        "metrics": []
    }
    # HONA standalone historical normalization: use issuer-reported
    # standalone figures from the SEC-filed 10-12B/A supplemental information.
    if ticker == "HONA":
        years = ["2023", "2024", "2025"]
        result["years"] = ["FY" + y for y in years]
        for metric in ("revenue", "gross_profit", "operating_income", "net_income", "eps"):
            for fy, vals in HONA_HISTORICAL_FINANCIALS.items():
                yearly.setdefault(metric, {})[fy] = {
                    "val": vals[metric] * (1e9 if metric != "eps" else 1.0),
                    "end": fy + "-12-31", "filed": "2026-06-08",
                    "form": "10-12B/A", "_unit": "USD" if metric != "eps" else "USD/shares",
                    "_taxonomy": "special_sec_supplemental", "_tag": "HONA_STANDALONE_HISTORICAL"
                }
    # Apply documented issuer-reported revenue corrections after SEC fact selection.
    for fy, value in SEC_REVENUE_REPORTED_OVERRIDES.get(ticker, {}).items():
        if fy in yearly.get("revenue", {}):
            yearly["revenue"][fy]["val"] = float(value) * 1e9
    for metric, row in latest_quarter.items():
        result["latest_reported"]["metrics"][metric] = {
            "value": round(float(row["val"]) / (1e6 if metric == "shares_outstanding" else 1e9), 6),
            "unit": "M" if metric == "shares_outstanding" else "B",
            "period_end": row.get("_period_end"),
            "form": row.get("form")
        }

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
        ("Share repurchases", "buybacks", "B"),
        ("Capex spend", "capex", "B"),
    ]
    for label, key, unit in specs:
        vals = []
        for y in years:
            v = yearly.get(key, {}).get(y)
            if v:
                value = float(v["val"])
                divisor = 1e9 if unit == "B" else (1e6 if unit == "M" else 1)
                vals.append(round(value / divisor, 6))
            else:
                vals.append(None)
        if any(v is not None for v in vals):
            # Capex is an annual cash-flow metric, so it follows the same 10-year
            # historical series as the other annual financial metrics.
            category = ("income_statement" if label in ["Revenue","Gross profit","Operating income","Net income","Diluted EPS","R&D","D&A"]
                        else "balance_sheet" if label in ["Cash","Current debt","Long-term debt","Total assets","Total equity","Shares outstanding"]
                        else "cash_flow")
            result["metrics"].append({"name": label, "unit": unit, "category": category, "values": vals})

    buybacks = yearly.get("buybacks", {})
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
        result["metrics"].append({"name": "Free cash flow", "unit": "B", "category": "cash_flow", "values": fcf})

    def arr(name):
        for m in result["metrics"]:
            if m["name"] == name:
                return m["values"]
        return [None] * len(years)

    rev, op, ni, eps, gp, da = arr("Revenue"), arr("Operating income"), arr("Net income"), arr("Diluted EPS"), arr("Gross profit"), arr("D&A")
    cash, debtc, debtl, assets, equity = arr("Cash"), arr("Current debt"), arr("Long-term debt"), arr("Total assets"), arr("Total equity")
    fcfv, rnd, shares = arr("Free cash flow"), arr("R&D"), arr("Shares outstanding")

    def derived(name, values, unit="%", category="ratios"):
        if any(v is not None for v in values):
            result["metrics"].append({"name": name, "unit": unit, "category": category, "values": [None if v is None else round(v, 6) for v in values]})

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

    derived("EBITDA", ebitda, "B", "income_statement")
    derived("EBIT", op, "B", "income_statement")
    derived("Net debt", netdebt, "B", "balance_sheet")
    derived("Gross margin", grossmargin)
    derived("Operating margin", opmargin)
    derived("FCF margin", fcfmargin)
    derived("Revenue growth", revenue_growth)
    derived("EPS growth", eps_growth)
    derived("FCF growth", fcf_growth)
    derived("FCF conversion", fcfconv)
    derived("ROE", roe)
    derived("ROIC", roic)
    derived("Debt / equity", debt_equity, "x")
    derived("Net debt / EBITDA", netdebt_ebitda, "x")

    # Latest point-in-time ratios use the latest reported balance sheet rather
    # than the last annual balance-sheet snapshot. Flow denominators remain
    # annual here; they are explicitly labeled as such until TTM data is added.
    latest_metrics = result["latest_reported"]["metrics"]
    latest_cash = latest_metrics.get("cash", {}).get("value")
    latest_debtc = latest_metrics.get("debt_current", {}).get("value")
    latest_debtl = latest_metrics.get("debt_noncurrent", {}).get("value")
    latest_equity = latest_metrics.get("equity", {}).get("value")
    latest_debt = None if latest_debtc is None and latest_debtl is None else (latest_debtc or 0) + (latest_debtl or 0)
    latest_net_debt = None if latest_debt is None or latest_cash is None else latest_debt - latest_cash
    latest_annual_idx = len(years) - 1 if years else None
    latest_ebitda = ebitda[latest_annual_idx] if latest_annual_idx is not None else None
    latest_nopat = nopat[latest_annual_idx] if latest_annual_idx is not None else None
    latest_invested = None if latest_equity is None or latest_debt is None or latest_cash is None else latest_equity + latest_debt - latest_cash
    latest_ni = ni[latest_annual_idx] if latest_annual_idx is not None else None

    latest_ratios = {}
    if latest_debt is not None:
        latest_ratios["net_debt"] = {"value": round(latest_net_debt, 6) if latest_net_debt is not None else None, "unit": "B", "method": "Latest reported debt less latest reported cash"}
    if latest_equity not in (None, 0) and latest_debt is not None:
        latest_ratios["debt_equity"] = {"value": round(latest_debt / latest_equity, 6), "unit": "x", "method": "Latest reported total debt / latest reported equity"}
    if latest_net_debt is not None and latest_ebitda not in (None, 0):
        latest_ratios["net_debt_ebitda"] = {"value": round(latest_net_debt / latest_ebitda, 6), "unit": "x", "method": "Latest reported net debt / latest fiscal-year EBITDA"}
    if latest_invested not in (None, 0) and latest_nopat is not None:
        latest_ratios["roic"] = {"value": round(latest_nopat / latest_invested, 6), "unit": "%", "method": "Latest fiscal-year NOPAT / latest reported invested capital"}
    if latest_equity not in (None, 0) and latest_ni is not None:
        latest_ratios["roe"] = {"value": round(latest_ni / latest_equity, 6), "unit": "%", "method": "Latest fiscal-year net income / latest reported equity"}
    result["latest_reported"]["ratios"] = latest_ratios

    # TTM flow metrics: use the latest four reported quarters from SEC 10-Q/10-K
    # data where available. These are used for current-period capital efficiency
    # ratios and are kept separate from the annual historical series.
    def quarterly_facts(metric):
        rows = []
        for tag in TAGS.get(metric, []):
            if tag not in raw_facts:
                continue
            units = raw_facts[tag].get("units", {})
            unit = "USD/shares" if "USD/shares" in units else ("USD" if "USD" in units else None)
            if not unit:
                continue
            for x in units[unit]:
                if x.get("form") not in ("10-Q", "10-Q/A", "10-K", "10-K/A") or not x.get("start") or not x.get("end"):
                    continue
                try:
                    days = (date.fromisoformat(x["end"]) - date.fromisoformat(x["start"])).days
                except Exception:
                    continue
                # Standalone quarter facts are ~3 months; annual facts are ~12 months.
                # Keep both because the TTM builder below derives standalone quarters
                # from cumulative YTD filings when necessary.
                row = dict(x); row["_tag"] = tag; rows.append(row)
        return rows

    def ttm_from_sec(metric):
        rows = quarterly_facts(metric)
        if not rows:
            return None, None
        # Prefer direct quarterly facts (roughly 70-110 days).
        direct = [r for r in rows if 70 <= (date.fromisoformat(r["end"]) - date.fromisoformat(r["start"])).days <= 110]
        by_end = {}
        for r in direct:
            end=r["end"]; filed=r.get("filed",""); rank=(0, filed)
            if end not in by_end or rank < by_end[end][0]: by_end[end]=(rank,r)
        direct = {e:r for e,(rank,r) in by_end.items()}
        if len(direct) >= 4:
            ends=sorted(direct)[-4:]
            return sum(float(direct[e]["val"]) for e in ends), ends[-1]

        # Otherwise derive standalone quarters from cumulative YTD 10-Q values.
        qrows=[]
        for r in rows:
            days=(date.fromisoformat(r["end"])-date.fromisoformat(r["start"])).days
            if r.get("form") not in ("10-Q","10-Q/A") or not (120 <= days <= 300):
                continue
            qrows.append(r)
        by_end={}
        for r in qrows:
            end=r["end"]; rank=(0 if r.get("form")=="10-Q" else 1,r.get("filed",""))
            if end not in by_end or rank < by_end[end][0]: by_end[end]=(rank,r)
        cumulative={e:r for e,(rank,r) in by_end.items()}
        quarters=[]
        for end,r in sorted(cumulative.items()):
            end_date=date.fromisoformat(end)
            # Same fiscal-year cumulative periods: Q1 itself, Q2 YTD minus Q1,
            # Q3 YTD minus Q2. Q4 is annual FY minus Q3 YTD.
            quarters.append((end,r))
        standalone=[]
        for idx,(end,r) in enumerate(quarters):
            fy=r.get("fy")
            prev_same=[(pe,pr) for pe,pr in quarters[:idx] if pr.get("fy")==fy]
            if prev_same:
                prev=prev_same[-1][1]
                val=float(r["val"])-float(prev["val"])
            else:
                val=float(r["val"])
            standalone.append((end,val))
        # Add annual-minus-Q3 for each FY when an annual fact exists.
        annual=select_yearly(rows)
        for fy,ar in annual.items():
            q3=[(e,v) for e,v in standalone if cumulative.get(e,{}).get("fy")==ar.get("fy")]
            if q3:
                q3_end,q3_val=q3[-1]
                if date.fromisoformat(ar["end"]) > date.fromisoformat(q3_end):
                    standalone.append((ar["end"],float(ar["val"])-q3_val))
        by_end={e:v for e,v in standalone}
        ends=sorted(by_end)[-4:]
        if len(ends)<4: return None, None
        return sum(by_end[e] for e in ends), ends[-1]

    ttm_metrics={}
    for metric in ("revenue","operating_income","net_income","cfo","capex","rnd","da","tax_expense","pretax_income"):
        value, period=ttm_from_sec(metric)
        if value is not None:
            divisor=1e9
            ttm_metrics[metric]={"value":round(value/divisor,6),"unit":"B","period_end":period}
    if "cfo" in ttm_metrics and "capex" in ttm_metrics:
        ttm_metrics["fcf"]={"value":round(ttm_metrics["cfo"]["value"]-abs(ttm_metrics["capex"]["value"]),6),"unit":"B","period_end":ttm_metrics["capex"]["period_end"]}
    if ttm_metrics:
        ttm_periods=[v.get("period_end") for v in ttm_metrics.values() if v.get("period_end")]
        if ttm_periods:
            ttm_metrics["period_end"]=max(ttm_periods)
        result["latest_reported"]["ttm"]=ttm_metrics

        ttm_rev=ttm_metrics.get("revenue",{}).get("value")
        ttm_op=ttm_metrics.get("operating_income",{}).get("value")
        ttm_ni=ttm_metrics.get("net_income",{}).get("value")
        ttm_da=ttm_metrics.get("da",{}).get("value")
        ttm_tax=ttm_metrics.get("tax_expense",{}).get("value")
        ttm_pre=ttm_metrics.get("pretax_income",{}).get("value")
        ttm_ebitda=None if ttm_op is None or ttm_da is None else ttm_op+ttm_da
        ttm_nopat=None
        if ttm_op is not None:
            tax_rate=(max(0,min(1,ttm_tax/ttm_pre)) if ttm_tax is not None and ttm_pre not in (None,0) else None)
            ttm_nopat=ttm_op*(1-tax_rate) if tax_rate is not None else None
        if latest_net_debt is not None and ttm_ebitda not in (None,0):
            result["latest_reported"]["ratios"]["net_debt_ebitda_ttm"]={"value":round(latest_net_debt/ttm_ebitda,6),"unit":"x","method":"Latest reported net debt / TTM EBITDA"}
        if latest_invested not in (None,0) and ttm_nopat is not None:
            result["latest_reported"]["ratios"]["roic_ttm"]={"value":round(ttm_nopat/latest_invested,6),"unit":"%","method":"TTM NOPAT / latest reported invested capital"}
        if latest_equity not in (None,0) and ttm_ni is not None:
            result["latest_reported"]["ratios"]["roe_ttm"]={"value":round(ttm_ni/latest_equity,6),"unit":"%","method":"TTM net income / latest reported equity"}
        if ttm_rev not in (None,0) and ttm_ni is not None:
            result["latest_reported"]["ratios"]["fcf_margin_ttm"]={"value":round(ttm_metrics.get("fcf",{}).get("value",0)/ttm_rev,6),"unit":"%","method":"TTM free cash flow / TTM revenue"}
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
            if len(data.get("years", [])) >= 1:
                existing[ticker] = data
                successful += 1
                print(ticker, "OK", len(data["years"]), "years")
            else:
                failed.append(ticker)
        except Exception as e:
            failed.append(ticker)
            print(ticker, "ERROR", repr(e))
    OUTPUT.write_text(json.dumps(existing, indent=2) + "
")
    print("Financial schema: categorized income statement, balance sheet, cash flow and ratios")

if __name__ == "__main__":
    main()