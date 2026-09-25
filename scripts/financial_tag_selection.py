"""Choose the broadest available standard revenue fact for each SEC period.

RevenueFromContractWithCustomerExcludingAssessedTax can represent only one
component of total revenue for issuers with lease, interest, insurance, or
other revenue. Use it only when no broader standard revenue concept exists.
"""

REVENUE_TAG_PRIORITY = {
    "Revenues": 0,
    "SalesRevenueNet": 1,
    "Revenue": 2,
    "RevenueFromContractWithCustomerExcludingAssessedTax": 3,
}


def _prefer_revenue_facts(rows, period_key):
    groups = {}
    for row in rows:
        key = period_key(row)
        if key is not None:
            groups.setdefault(key, []).append(row)

    selected = []
    taxonomy_priority = {"us-gaap": 0, "ifrs-full": 1}
    for candidates in groups.values():
        chosen = min(candidates, key=lambda row: (
            REVENUE_TAG_PRIORITY.get(row.get("_tag"), len(REVENUE_TAG_PRIORITY)),
            taxonomy_priority.get(row.get("_taxonomy"), 2),
        ))
        chosen_concept = (chosen.get("_tag"), chosen.get("_taxonomy"))
        selected.extend(row for row in candidates
                        if (row.get("_tag"), row.get("_taxonomy")) == chosen_concept)
    return selected


def prefer_total_revenue_annual_facts(rows):
    """Resolve competing revenue concepts for each annual period end."""
    return _prefer_revenue_facts(rows, lambda row: row.get("end"))


def prefer_total_revenue_period_facts(rows):
    """Resolve concepts per exact period while keeping quarter and YTD spans."""
    return _prefer_revenue_facts(rows, lambda row: (row.get("start"), row.get("end")))
