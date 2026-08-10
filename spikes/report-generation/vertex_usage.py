"""Shared Vertex AI usage accounting for the local report-generation spike."""


def token_counts(usage_metadata) -> dict[str, int]:
    """Return billable input and output tokens across supported SDK versions."""
    return {
        "input_tokens": getattr(usage_metadata, "prompt_token_count", 0) or 0,
        "output_tokens": (
            (getattr(usage_metadata, "candidates_token_count", 0) or 0)
            + (getattr(usage_metadata, "thoughts_token_count", 0) or 0)
        ),
    }
