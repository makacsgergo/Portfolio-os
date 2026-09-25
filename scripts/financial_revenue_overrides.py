"""Issuer-reported annual revenue corrections shared by generation and SEC QA.

Amounts are USD billions and apply only to the listed fiscal years.
These override XBRL tag/context selections verified against issuer filings.
"""

SEC_REVENUE_REPORTED_OVERRIDES = {
    "AMT": {"2019": 7.5803},
    "CFG": {"2019": 6.491},
    "COF": {"2018": 28.076},
    "DOC": {"2016": 0.241034, "2017": 0.343584, "2018": 0.422551},
    "ECHO": {"2021": 2.720916},
    "GIS": {"2021": 18.127, "2024": 19.8572},
    "GPN": {"2017": 3.975163},
    "HIG": {"2017": 17.162},
    "KEY": {"2022": 7.272},
    "MET": {"2018": 67.941},
    "MTB": {"2022": 7.662, "2024": 9.279},
    "SBAC": {"2017": 1.727674},
    "URI": {"2019": 9.351},
    "NBIS": {"2022": 0.0135},
}
