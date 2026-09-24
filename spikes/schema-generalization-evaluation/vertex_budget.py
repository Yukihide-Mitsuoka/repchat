"""Calculate a conservative text-generation reservation without provider I/O."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_CEILING, localcontext
from typing import Any

from execution_budget import BudgetError
from manifest_runtime_meter import PricingSnapshot, RuntimeMeasurementError


MODEL = "gemini-3.6-flash"
CONTEXT_TOKENS = 1_048_576
OUTPUT_TOKENS = 65_536
MICRO_JPY = Decimal("0.000001")
ALLOWED_CONFIG = frozenset(
    {
        "system_instruction",
        "response_mime_type",
        "response_schema",
        "max_output_tokens",
        "candidate_count",
    }
)


def vertex_text_reservation_jpy(
    pricing_snapshot: PricingSnapshot,
    *,
    model: str,
    region: str,
    execution_date: date,
    contents: Any,
    generation_config: Any,
) -> Decimal:
    """Reserve the model's full context and output ceilings for one text request.

    This offline amount deliberately ignores countTokens estimates and a smaller
    configured output cap. It does not authorize or submit a provider request.
    """
    if not isinstance(pricing_snapshot, PricingSnapshot):
        raise BudgetError("validated pricing snapshot is required")
    try:
        pricing_snapshot.pricing_for(model, region, execution_date)
    except RuntimeMeasurementError as error:
        raise BudgetError("pricing snapshot is not applicable") from error
    if model != MODEL or region != "global":
        raise BudgetError("model or region has no supported token ceiling")
    if type(contents) is not str or not contents.strip():
        raise BudgetError("only nonempty text contents are supported")
    if type(generation_config) is not dict or set(generation_config) - ALLOWED_CONFIG:
        raise BudgetError("generation config has unsupported billing paths")
    maximum = generation_config.get("max_output_tokens")
    if type(maximum) is not int or not 1 <= maximum <= OUTPUT_TOKENS:
        raise BudgetError("output token cap is missing or invalid")
    candidates = generation_config.get("candidate_count", 1)
    if type(candidates) is not int or candidates != 1:
        raise BudgetError("multiple candidates are unsupported")
    if (
        type(generation_config.get("system_instruction")) is not str
        or not generation_config["system_instruction"].strip()
        or generation_config.get("response_mime_type") != "application/json"
        or type(generation_config.get("response_schema")) is not dict
        or not generation_config["response_schema"]
    ):
        raise BudgetError("text-only structured generation config is required")

    try:
        with localcontext() as context:
            context.prec = 384
            maximum_jpy = (
                Decimal(pricing_snapshot.vertex_input_jpy_per_million)
                * CONTEXT_TOKENS
                + Decimal(pricing_snapshot.vertex_output_jpy_per_million)
                * OUTPUT_TOKENS
            ) / Decimal(1_000_000)
            maximum_jpy = maximum_jpy.quantize(MICRO_JPY, rounding=ROUND_CEILING)
    except (InvalidOperation, TypeError) as error:
        raise BudgetError("generation cost ceiling cannot be represented") from error
    if not maximum_jpy.is_finite() or maximum_jpy <= 0 or maximum_jpy.adjusted() > 31:
        raise BudgetError("generation cost ceiling cannot be represented")
    return maximum_jpy
