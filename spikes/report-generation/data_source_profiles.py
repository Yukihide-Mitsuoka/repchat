"""Resolve approved data-source knowledge for the shared analysis pipeline.

Profiles contain schema and execution constraints only. They deliberately do not
contain panel catalogs, example questions, fixed SQL, or visualization choices.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import bitcoin_profile
import ga4_profile


@dataclass(frozen=True)
class DataSourceProfile:
    """Versionless demo boundary for one inspected BigQuery data source."""

    key: str
    label: str
    allowed_dataset: str
    has_governed_metrics: bool
    _planner_context: Callable[[str], str]
    _sql_rules: Callable[[str], str]
    period_for_question: Callable[[str], dict[str, str]]
    generation_request: Callable[[dict, dict[str, str]], str]
    normalize_sql: Callable[[str], str]
    require_sql_period: Callable[[str, dict[str, str]], None]

    def planner_context(self, metrics: str) -> str:
        """Return schema and semantic facts available to the planning role."""
        return self._planner_context(metrics)

    def sql_rules(self, metrics: str) -> str:
        """Return source-bound rules available to the SQL role."""
        return self._sql_rules(metrics)


_PROFILES = {
    "ga4": DataSourceProfile(
        key="ga4",
        label="GA4 ECサイト",
        allowed_dataset=ga4_profile.DATASET,
        has_governed_metrics=True,
        _planner_context=ga4_profile.planner_context,
        _sql_rules=ga4_profile.sql_rules,
        period_for_question=ga4_profile.period_for_question,
        generation_request=ga4_profile.generation_request,
        normalize_sql=ga4_profile.normalize_sql,
        require_sql_period=ga4_profile.require_sql_period,
    ),
    "bitcoin": DataSourceProfile(
        key="bitcoin",
        label="Bitcoin取引",
        allowed_dataset=bitcoin_profile.DATASET,
        has_governed_metrics=False,
        _planner_context=bitcoin_profile.planner_context,
        _sql_rules=lambda _metrics: bitcoin_profile.prompt_rules(),
        period_for_question=bitcoin_profile.period_for_question,
        generation_request=bitcoin_profile.generation_request,
        normalize_sql=bitcoin_profile.quote_reserved_hash_identifiers,
        require_sql_period=bitcoin_profile.require_sql_period,
    ),
}


def profile_for(key: str) -> DataSourceProfile:
    """Resolve one approved source or reject the unregistered identifier."""
    try:
        return _PROFILES[key]
    except (KeyError, TypeError) as error:
        raise ValueError(
            "profile must be one of: " + ", ".join(_PROFILES)
        ) from error


def profile_keys() -> tuple[str, ...]:
    """Return stable identifiers accepted at the HTTP boundary."""
    return tuple(_PROFILES)


def all_profiles() -> tuple[DataSourceProfile, ...]:
    """Return the approved contracts for contract tests and UI metadata."""
    return tuple(_PROFILES.values())
