import json, os, time
from datetime import date
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE = ROOT / "universe.json"
OUTPUT = ROOT / "prices.json"

UA = os.environ.get("SEC_USER_AGENT", "Portfolio OS research app contact@example.com")
HEADERS = {"User-Agent": UA, "Accept-Encoding": "gzip, deflate"}

# 1 year of daily closes is enough for the V3 performance chart and keeps
# prices.json a reasonable size across the ~500-stock universe.
CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=1y&interval=1d"


def get_json(url):
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    time.sleep(0.20)
    return r.json()


def get_daily_closes(ticker):
    """Return (dates, closes) as parallel lists of trading-day ISO dates and
    split-adjusted closing prices, skipping days with no reported close."""
    try:
        data = get_json(CHART_URL.format(ticker))
        result = data["chart"]["result"][0]
        timestamps = result.get("timestamp") or []
        closes = (result.get("indicators", {}).get("quote", [{}])[0] or {}).get("close") or []
        dates, out_closes = [], []
        for ts, close in zip(timestamps, closes):
            if close is None:
                continue
            dates.append(date.fromtimestamp(ts).isoformat())
            out_closes.append(round(float(close), 4))
        return dates, out_closes
    except Exception as e:
        print(ticker, "PRICE HISTORY ERROR", repr(e))
        return [], []


def main():
    universe = json.loads(UNIVERSE.read_text())
    tickers = sorted({x["ticker"].upper() for x in universe.get("stocks", [])})
    existing = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {}
    out_tickers = existing.get("tickers", {})

    successful, failed = 0, []
    for ticker in tickers:
        dates, closes = get_daily_closes(ticker)
        if len(dates) >= 2:
            out_tickers[ticker] = {"dates": dates, "closes": closes}
            successful += 1
            print(ticker, "OK", len(dates), "days")
        else:
            failed.append(ticker)

    result = {
        "source": "Yahoo Finance chart endpoint",
        "range": "1y",
        "interval": "1d",
        "updated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "tickers": out_tickers,
    }
    OUTPUT.write_text(json.dumps(result) + "\n")
    print(f"Daily prices: {successful} ok, {len(failed)} failed")
    if failed:
        print("Failed tickers:", ", ".join(failed))


if __name__ == "__main__":
    main()
