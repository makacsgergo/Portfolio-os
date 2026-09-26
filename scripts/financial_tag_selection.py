"""Choose the broadest available standard revenue fact without year drift.

RevenueFromContractWithCustomerExcludingAssessedTax can represent only one
component of total revenue for issuers with lease, interest, insurance, or
other revenue. Use it only when no broader standard revenue concept exists
in the period's original filing. Later amendments update the selected concept.
"""

from datetime import date

REVENUE_TAG_PRIORITY = {
    "Revenues": 0,
    "SalesRevenueNet": 1,
    "Revenue": 2,
    "RevenueFromContractWithCustomerExcludingAssessedTax": 3,
}


def _source_rank(row, quarterly):
    end, filed = row.get("end"), row.get("filed")
    try:
        lag = (date.fromisoformat(filed) - date.fromisoformat(end)).days
    except (TypeError, ValueError):
        return (2, float("inf"), filed or "")
    if lag < 0:
        return (2, float("inf"), filed or "")
    form = row.get("form", "")
    preferred_forms = ("10-Q", "10-Q/A") if quarterly else ("10-K", "10-K/A")
    original_form_rank = 0 if form in preferred_forms else 1
    return (original_form_rank, lag, filed)


def _prefer_revenue_facts(rows, period_key, quarterly):
    groups = {}
    for row in rows:
        key = period_key(row)
        if key is not None:
            groups.setdefault(key, []).append(row)

    selected = []
    taxonomy_priority = {"us-gaap": 0, "ifrs-full": 1}
    for candidates in groups.values():
        first_source = min(_source_rank(row, quarterly) for row in candidates)
        original_facts = [
            row for row in candidates
            if _source_rank(row, quarterly) == first_source
        ]
        chosen = min(original_facts, key=lambda row: (
            REVENUE_TAG_PRIORITY.get(row.get("_tag"), len(REVENUE_TAG_PRIORITY)),
            taxonomy_priority.get(row.get("_taxonomy"), 2),
        ))
        chosen_concept = (chosen.get("_tag"), chosen.get("_taxonomy"))
        selected.extend(
            row for row in candidates
            if (row.get("_tag"), row.get("_taxonomy")) == chosen_concept
        )
    return selected


def prefer_total_revenue_annual_facts(rows):
    """Select a concept from the original annual filing per period end."""
    return _prefer_revenue_facts(rows, lambda row: row.get("end"), quarterly=False)


def prefer_total_revenue_period_facts(rows):
    """Select a concept per exact quarter/YTD span from its original filing."""
    return _prefer_revenue_facts(
        rows, lambda row: (row.get("start"), row.get("end")), quarterly=True
    )


def sanity_filter_net_income_facts(rows):
    """Drop NetIncomeLossAvailableToCommonStockholdersBasic facts that are
    wildly out of scale versus the same period's NetIncomeLoss/ProfitLoss.

    Some issuers mis-tag this concept in early filings (e.g. Corteva's
    FY2019/FY2020 10-Ks report it as a per-share-scale number like -1.28
    instead of -1,280,000,000, while later filings use the correct scale).
    A real preferred-dividend adjustment is never large enough to shrink net
    income by more than ~20x, so treat anything past that as a filer error
    and fall back to the plain net income tag for that period only.
    """
    by_end_tag = {}
    for row in rows:
        by_end_tag.setdefault(row.get("end"), {}).setdefault(row.get("_tag"), []).append(row)
    drop = set()
    for by_tag in by_end_tag.values():
        common = by_tag.get("NetIncomeLossAvailableToCommonStockholdersBasic")
        base = by_tag.get("NetIncomeLoss") or by_tag.get("ProfitLoss")
        if not common or not base:
            continue
        base_val = max((abs(float(row["val"])) for row in base), default=0)
        if base_val == 0:
            continue
        for row in common:
            if abs(float(row["val"])) < base_val * 0.05:
                drop.add(id(row))
    return [row for row in rows if id(row) not in drop]
