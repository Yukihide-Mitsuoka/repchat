"""Reserve and settle one text-only Vertex generation against an evaluation budget."""

from __future__ import annotations

from copy import deepcopy
from datetime import date
from decimal import Decimal, ROUND_CEILING, localcontext
from typing import Any

from execution_budget import BudgetError, BudgetGate
from manifest_runtime_meter import PricingSnapshot
from vertex_budget import CONTEXT_TOKENS, MICRO_JPY, OUTPUT_TOKENS, vertex_text_reservation_jpy


def _generation_settings(config: Any) -> dict[str, Any]:
    if type(config) is dict:
        settings = config
    else:
        dump = getattr(config, "model_dump", None)
        if not callable(dump):
            raise BudgetError("generation config must be a dict or SDK model")
        settings = dump(exclude_unset=True)
    if type(settings) is not dict:
        raise BudgetError("generation config snapshot is invalid")
    return deepcopy(settings)


def _count(value: Any) -> int:
    if type(value) is not int or value < 0:
        raise BudgetError("Vertex response usage is invalid")
    return value


def _observed_cost_jpy(response: Any, snapshot: PricingSnapshot) -> Decimal:
    metadata = getattr(response, "usage_metadata", None)
    if metadata is None:
        raise BudgetError("Vertex response usage is missing")
    input_tokens = _count(getattr(metadata, "prompt_token_count", None))
    output_tokens = _count(getattr(metadata, "candidates_token_count", None))
    thoughts = getattr(metadata, "thoughts_token_count", 0)
    tool_prompt = getattr(metadata, "tool_use_prompt_token_count", 0)
    thoughts = _count(0 if thoughts is None else thoughts)
    tool_prompt = _count(0 if tool_prompt is None else tool_prompt)
    total = getattr(metadata, "total_token_count", None)
    if total is not None and _count(total) != input_tokens + output_tokens + thoughts + tool_prompt:
        raise BudgetError("Vertex response token totals are inconsistent")
    if tool_prompt or input_tokens > CONTEXT_TOKENS or output_tokens + thoughts > OUTPUT_TOKENS:
        raise BudgetError("Vertex response usage exceeds supported text bounds")
    with localcontext() as context:
        context.prec = 384
        return (
            (
                Decimal(snapshot.vertex_input_jpy_per_million) * input_tokens
                + Decimal(snapshot.vertex_output_jpy_per_million) * (output_tokens + thoughts)
            )
            / Decimal(1_000_000)
        ).quantize(MICRO_JPY, rounding=ROUND_CEILING)


class _BudgetedModels:
    def __init__(self, owner: BudgetedVertex):
        self._owner = owner

    def generate_content(self, *, model: str, contents: Any, config: Any) -> Any:
        owner = self._owner
        owner._validate_client_scope()
        settings = _generation_settings(config)
        maximum_jpy = vertex_text_reservation_jpy(
            owner._pricing_snapshot,
            model=model,
            region=owner._region,
            execution_date=owner._execution_date,
            contents=contents,
            generation_config=settings,
        )
        reservation = owner._gate.reserve("vertex", maximum_jpy)
        try:
            # google-genai==2.12.1 uses per-request retry options over client defaults.
            request_config = {**settings, "http_options": {"retry_options": {"attempts": 1}}}
            response = owner._client.models.generate_content(
                model=model, contents=contents, config=request_config
            )
            reservation.settle(_observed_cost_jpy(response, owner._pricing_snapshot))
            return response
        except BaseException:
            reservation.fail()
            raise


class BudgetedVertex:
    """Expose only a budgeted synchronous text generation method."""

    def __init__(
        self,
        client: Any,
        gate: BudgetGate,
        pricing_snapshot: PricingSnapshot,
        *,
        region: str,
        execution_date: date,
    ):
        if not isinstance(gate, BudgetGate):
            raise BudgetError("validated budget gate is required")
        if not isinstance(pricing_snapshot, PricingSnapshot):
            raise BudgetError("validated pricing snapshot is required")
        self._client = client
        self._gate = gate
        self._pricing_snapshot = pricing_snapshot
        self._region = region
        self._execution_date = execution_date
        self._validate_client_scope()
        self.models = _BudgetedModels(self)

    def _validate_client_scope(self) -> None:
        api_client = getattr(self._client, "_api_client", None)
        options = getattr(api_client, "_http_options", None)
        project = getattr(api_client, "project", None)
        if (
            getattr(api_client, "vertexai", None) is not True
            or getattr(api_client, "location", None) != self._region
            or type(project) is not str
            or not project.strip()
            or getattr(api_client, "api_key", None) is not None
            or getattr(api_client, "custom_base_url", None) is not None
            or options is None
            or getattr(options, "extra_body", None) is not None
            or getattr(options, "base_url_resource_scope", None) is not None
        ):
            raise BudgetError("Vertex client scope or hidden request settings are unsupported")
