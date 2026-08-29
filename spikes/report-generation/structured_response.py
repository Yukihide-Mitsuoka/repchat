"""Bounded diagnostics for structured Vertex AI responses."""

from __future__ import annotations

import json
import re


class StructuredResponseError(ValueError):
    """A bounded classification that never retains generated response text."""

    def __init__(self, kind: str, *, finish_reason: str | None = None):
        super().__init__(kind)
        self.kind = kind
        self.finish_reason = finish_reason


def load_structured_json(response):
    """Return one structured response without retaining unsafe model text."""
    candidates = getattr(response, "candidates", None) or []
    reason = getattr(candidates[0], "finish_reason", None) if candidates else None
    value = getattr(reason, "value", None)
    name = getattr(reason, "name", None)
    raw_reason = (
        value
        if isinstance(value, str)
        else name
        if isinstance(name, str)
        else reason
    )
    finish_reason = None
    if raw_reason is not None:
        normalized = str(raw_reason).upper().removeprefix("FINISHREASON.")
        finish_reason = (
            normalized if re.fullmatch(r"[A-Z][A-Z0-9_]*", normalized) else "OTHER"
        )
    if finish_reason == "MAX_TOKENS":
        raise StructuredResponseError("max_tokens", finish_reason=finish_reason)
    if finish_reason not in {None, "STOP"}:
        raise StructuredResponseError("finish_reason", finish_reason=finish_reason)
    try:
        response_text = response.text
    except (AttributeError, TypeError, ValueError) as error:
        raise StructuredResponseError("missing_text") from error
    if not isinstance(response_text, str) or not response_text.strip():
        raise StructuredResponseError("missing_text")
    try:
        return json.loads(response_text)
    except (json.JSONDecodeError, TypeError) as error:
        raise StructuredResponseError("malformed_json") from error
