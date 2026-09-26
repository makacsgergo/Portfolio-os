"""Issuer-reported net income overrides shared by financial generation and SEC QA."""

SEC_NET_INCOME_OVERRIDES = {
    # Airbnb IPO'd in Dec 2020, so it has no standalone SEC annual filing for
    # FY2019 or earlier. The only SEC record of FY2019's net loss is a
    # comparative column inside the FY2021 10-K (filed 2022-02-25), and that
    # column is tagged with the filing's own fiscal-year focus (2021) rather
    # than the year it actually covers (2019) -- so our FY2019 net loss
    # figure incorrectly overwrites the real FY2021 net loss. Restore
    # FY2021's correct, originally-filed net loss (values in billions).
    "ABNB": {"2021": -0.352},
}
