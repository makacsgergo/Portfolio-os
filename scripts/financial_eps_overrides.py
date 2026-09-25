"""Issuer-reported EPS fallbacks shared by financial generation and SEC QA."""

SEC_EPS_RESTATED_FALLBACKS = {
    # Canonical reported EPS for historical XBRL precision/restatement cases.
    "TRI": {"2017": 1.94, "2018": 5.88, "2019": 3.11, "2020": 2.25, "2021": 11.50},
    # SEC 2023 annual filing retrospectively adjusts FY2020 EPS for the 10-for-1 split.
    "SHOP": {"2020": 0.259},
}
