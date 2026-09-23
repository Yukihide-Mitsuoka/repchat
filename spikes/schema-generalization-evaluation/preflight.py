"""Run the source-independent discovery and analysis-contract preflight."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Mapping


REPORT_GENERATION_DIR = Path(__file__).resolve().parents[1] / "report-generation"
if str(REPORT_GENERATION_DIR) not in sys.path:
    sys.path.insert(0, str(REPORT_GENERATION_DIR))

from analysis_contract import AnalysisContract  # noqa: E402 - sibling spike import
from analysis_contract_compiler import (  # noqa: E402 - sibling spike import
    ContractCompilerError,
)
from analysis_contract_orchestration import (  # noqa: E402 - sibling spike import
    generate_discovered_contract_artifacts,
)
from bigquery_scope_discovery import (  # noqa: E402 - sibling spike import
    AuthorizedScope,
    DiscoverySnapshot,
    ScopeDiscoveryError,
    ScopeDiscoveryInfrastructureError,
    discover_scope,
)
from run_outcome import (  # noqa: E402 - path bootstrap precedes local import
    ANALYSIS_CONTRACT_GENERATION_INFRASTRUCTURE_FAILURE_CODE,
    ANALYSIS_CONTRACT_GENERATION_FAILURE,
    SCOPE_DISCOVERY_INFRASTRUCTURE_FAILURE_CODE,
    SCOPE_DISCOVERY_FAILURE,
)


EMPTY_USAGE = {"input_tokens": 0, "output_tokens": 0}
SCOPE_DISCOVERY_FAILURE_CODE = "scope_discovery_failed"
ANALYSIS_CONTRACT_GENERATION_FAILURE_CODE = (
    "analysis_contract_generation_failed"
)


@dataclass(frozen=True)
class PreflightResult:
    """Artifacts and bounded status produced before planning starts."""

    question: str
    discovery: DiscoverySnapshot | None
    contract: AnalysisContract | None
    usage: dict[str, int] | None
    failure_stage: str | None = None
    failure_code: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.failure_stage is None

    def runtime_input(self) -> dict[str, Any]:
        """Return only the runtime input fields allowed by the evidence contract."""
        return {
            "scope_snapshot_fingerprint": (
                self.discovery.fingerprint if self.discovery is not None else None
            ),
            "analysis_contract_fingerprint": (
                self.contract.fingerprint if self.contract is not None else None
            ),
            "question": self.question,
        }

    def scope_snapshot_entry(self, schema_id: str) -> dict[str, str] | None:
        """Return the canonical scope artifact entry when discovery completed."""
        if self.discovery is None:
            return None
        return {
            "schema_id": schema_id,
            "content_json": self.discovery.content_json,
            "retrieved_at": self.discovery.retrieved_at,
        }

    def analysis_contract_entry(
        self, schema_id: str, case_id: str
    ) -> dict[str, str] | None:
        """Return the canonical contract artifact entry when generation completed."""
        if self.contract is None:
            return None
        return {
            "schema_id": schema_id,
            "case_id": case_id,
            "content_json": self.contract.content_json,
        }

    def failure_recording(
        self,
        schema_id: str,
        case_id: str,
        run_id: str,
        pipeline_fingerprints: Mapping[str, str],
        *,
        bytes_processed: int,
        cost_jpy: int | float,
    ) -> dict[str, Any]:
        """Create one complete failed run while keeping accounting caller-owned."""
        if self.succeeded:
            raise ValueError("a successful preflight cannot create a failure recording")
        if set(pipeline_fingerprints) != {"runtime", "prompt", "configuration"}:
            raise ValueError("all pipeline fingerprints are required")
        return {
            "schema_id": schema_id,
            "case_id": case_id,
            "run": {
                "run_id": run_id,
                **dict(pipeline_fingerprints),
                "runtime_input": self.runtime_input(),
                "generated_sql": "",
                "failure_stage": self.failure_stage,
                "failure_code": self.failure_code,
                "sql_execution_succeeded": False,
                "actual_rows": [],
                "unauthorized_reference": False,
                "dangerous_sql": False,
                "scan_limit_exceeded": False,
                "semantic_error": False,
                "render_succeeded": False,
                "bytes_processed": bytes_processed,
                "cost_jpy": cost_jpy,
            },
        }


def run_preflight(
    bq,
    vertex,
    model: str,
    scope: AuthorizedScope,
    question: str,
    *,
    as_of: date,
) -> PreflightResult:
    """Discover authorized metadata and generate a contract from that exact snapshot."""
    try:
        discovery = discover_scope(bq, scope)
    except ScopeDiscoveryInfrastructureError:
        return PreflightResult(
            question=question,
            discovery=None,
            contract=None,
            usage=None,
            failure_stage=SCOPE_DISCOVERY_FAILURE,
            failure_code=SCOPE_DISCOVERY_INFRASTRUCTURE_FAILURE_CODE,
        )
    except ScopeDiscoveryError:
        return PreflightResult(
            question=question,
            discovery=None,
            contract=None,
            usage=EMPTY_USAGE.copy(),
            failure_stage=SCOPE_DISCOVERY_FAILURE,
            failure_code=SCOPE_DISCOVERY_FAILURE_CODE,
        )
    try:
        artifacts = generate_discovered_contract_artifacts(
            bq,
            vertex,
            model,
            discovery,
            question,
            as_of=as_of,
        )
    except ScopeDiscoveryInfrastructureError:
        return PreflightResult(
            question=question,
            discovery=discovery,
            contract=None,
            usage=None,
            failure_stage=ANALYSIS_CONTRACT_GENERATION_FAILURE,
            failure_code=ANALYSIS_CONTRACT_GENERATION_INFRASTRUCTURE_FAILURE_CODE,
        )
    except (ContractCompilerError, ScopeDiscoveryError):
        return PreflightResult(
            question=question,
            discovery=discovery,
            contract=None,
            usage=None,
            failure_stage=ANALYSIS_CONTRACT_GENERATION_FAILURE,
            failure_code=ANALYSIS_CONTRACT_GENERATION_FAILURE_CODE,
        )
    return PreflightResult(
        question=question,
        discovery=artifacts.discovery,
        contract=artifacts.contract,
        usage=artifacts.usage,
    )
