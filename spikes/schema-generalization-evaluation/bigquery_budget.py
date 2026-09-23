"""Calculate a billable BigQuery query's reservation without provider I/O."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_CEILING, localcontext
from typing import Any

from execution_budget import BudgetError
from manifest_runtime_meter import PricingSnapshot, RuntimeMeasurementError, TIB


MICRO_JPY = Decimal("0.000001")
MAX_INT64 = 2**63 - 1


def bigquery_query_reservation_jpy(
    pricing_snapshot: PricingSnapshot,
    *,
    model: str,
    region: str,
    execution_date: date,
    job_config: Any,
) -> Decimal:
    """Upper-bound one on-demand query's analysis charge from its explicit byte cap.

    This does not prove SELECT-only SQL or cover storage, external services,
    taxes, or other billing SKUs. A caller must validate SQL and reserve the
    result before submitting the query.
    """
    if not isinstance(pricing_snapshot, PricingSnapshot):
        raise BudgetError("validated pricing snapshot is required")
    try:
        pricing_snapshot.pricing_for(model, region, execution_date)
    except RuntimeMeasurementError as error:
        raise BudgetError("pricing snapshot is not applicable") from error

    maximum_bytes = getattr(job_config, "maximum_bytes_billed", None)
    if (
        getattr(job_config, "dry_run", None) is not False
        or type(maximum_bytes) is not int
        or maximum_bytes <= 0
        or maximum_bytes > MAX_INT64
        or getattr(job_config, "destination", None) is not None
        or getattr(job_config, "connection_properties", None)
    ):
        raise BudgetError("query has no supported billable byte ceiling")

    try:
        with localcontext() as context:
            # A finite binary64 rate can span 309 digits; retain product precision.
            context.prec = 384
            rate = Decimal(pricing_snapshot.bigquery_jpy_per_tib)
            maximum_jpy = (
                rate * maximum_bytes / TIB
            ).quantize(MICRO_JPY, rounding=ROUND_CEILING)
    except (InvalidOperation, TypeError) as error:
        raise BudgetError("query cost ceiling cannot be represented") from error
    if not maximum_jpy.is_finite() or maximum_jpy <= 0 or maximum_jpy.adjusted() > 31:
        raise BudgetError("query cost ceiling cannot be represented")
    return maximum_jpy
