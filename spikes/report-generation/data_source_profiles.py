"""Resolve approved data-source knowledge for the shared analysis pipeline.

Profiles contain schema and execution constraints only. They deliberately do not
contain panel catalogs, example questions, fixed SQL, or visualization choices.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Callable

import analysis_contract_context
import bitcoin_profile
import ga4_profile
from analysis_contract import AnalysisContract


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
    period_repair_guidance: Callable[[dict[str, str]], str]
    _analysis_contract: AnalysisContract | None = None

    def planner_context(self, metrics: str) -> str:
        """Return schema and semantic facts available to the planning role."""
        if self._analysis_contract is not None:
            return analysis_contract_context.planner_context(self._analysis_contract)
        return self._planner_context(metrics)

    def sql_rules(self, metrics: str) -> str:
        """Return source-bound rules available to the SQL role."""
        if self._analysis_contract is not None:
            return analysis_contract_context.sql_rules(self._analysis_contract)
        return self._sql_rules(metrics)

    @property
    def analysis_contract(self) -> AnalysisContract | None:
        """Return the immutable contract bound to this source, when present."""
        return self._analysis_contract

    def with_contract(self, contract: AnalysisContract) -> DataSourceProfile:
        """Bind one verified, same-dataset contract without mutating the profile."""
        try:
            analysis_contract_context.planner_context(contract)
            tables = contract.content()["schema"]["metadata"]["tables"]
        except (KeyError, TypeError, analysis_contract_context.AnalysisContextError):
            raise ValueError("analysis contract cannot be bound to this profile") from None
        if not isinstance(tables, list) or not tables:
            raise ValueError("analysis contract cannot be bound to this profile")
        for table in tables:
            identity = table.get("table") if isinstance(table, dict) else None
            if isinstance(identity, str):
                dataset, separator, _ = identity.rpartition(".")
            else:
                dataset, separator = "", ""
            if separator != "." or dataset != self.allowed_dataset:
                raise ValueError("analysis contract dataset differs from the selected profile")
        return replace(self, _analysis_contract=contract)


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
        period_repair_guidance=ga4_profile.period_repair_guidance,
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
        period_repair_guidance=bitcoin_profile.period_repair_guidance,
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
