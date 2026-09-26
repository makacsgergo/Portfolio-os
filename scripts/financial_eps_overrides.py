"""Issuer-reported EPS fallbacks shared by financial generation and SEC QA."""

SEC_EPS_RESTATED_FALLBACKS = {
    # Canonical reported EPS for historical XBRL precision/restatement cases.
    "TRI": {"2017": 1.94, "2018": 5.88, "2019": 3.11, "2020": 2.25, "2021": 11.50},
    # SEC 2023 annual filing retrospectively adjusts FY2020 EPS for the 10-for-1 split.
    "SHOP": {"2020": 0.259},
    # Albemarle's FY2022 10-K (filed 2023-02-15) tags its own fiscal-year focus
    # as 2021 instead of 2022, so FY2022's real EPS (22.84, the 2022 lithium
    # boom) collides with and overwrites FY2021's real EPS under the "2021"
    # key everywhere that filing's facts appear, including in later filings
    # that copy the same tag. Restore FY2021's correct, originally-filed EPS.
    "ALB": {"2021": 1.06},
}
