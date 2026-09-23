"""Measure every provider response and query job within one manifest run."""

from __future__ import annotations

import math
import json
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from manifest_artifacts import RunMeasurement, run_measured_manifest_evaluation
from manifest_rendering import RenderingAttempt


TIB = 2**40


class RuntimeMeasurementError(ValueError):
    """A run cannot produce complete, trustworthy provider accounting."""


@dataclass(frozen=True)
class PricingSnapshot:
    """Reviewed rate provenance and supported billing scope for one evaluation."""

    captured_at: datetime
    source_url: str
    currency: str
    model: str
    region: str
    vertex_tier: str
    bigquery_billing: str
    vertex_input_jpy_per_million: str
    vertex_output_jpy_per_million: str
    bigquery_jpy_per_tib: str

    @classmethod
    def from_file(cls, path: str | Path) -> PricingSnapshot:
        """Read a bounded, exact-schema JSON snapshot without accepting duplicate keys."""
        try:
            with Path(path).open("rb") as snapshot_file:
                content = snapshot_file.read(16_385)
        except OSError as error:
            raise RuntimeMeasurementError("pricing snapshot file is unreadable") from error
        return cls.from_bytes(content)

    @classmethod
    def from_bytes(cls, content: bytes) -> PricingSnapshot:
        """Parse the same bytes that an execution intent fingerprints."""
        if not isinstance(content, bytes) or len(content) > 16_384:
            raise RuntimeMeasurementError("pricing snapshot file is too large or invalid")

        def unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
            result: dict[str, Any] = {}
            for name, value in pairs:
                if name in result:
                    raise RuntimeMeasurementError("pricing snapshot has duplicate fields")
                result[name] = value
            return result

        try:
            data = json.loads(content.decode("utf-8"), object_pairs_hook=unique_pairs)
        except (UnicodeError, json.JSONDecodeError) as error:
            raise RuntimeMeasurementError("pricing snapshot file is unreadable") from error
        if not isinstance(data, dict):
            raise RuntimeMeasurementError("pricing snapshot must be an object")
        expected = set(cls.__dataclass_fields__)
        if set(data) != expected:
            raise RuntimeMeasurementError("pricing snapshot fields are incomplete or unknown")
        captured = data["captured_at"]
        if not isinstance(captured, str):
            raise RuntimeMeasurementError("pricing snapshot capture time is invalid")
        try:
            data["captured_at"] = datetime.fromisoformat(captured)
        except ValueError as error:
            raise RuntimeMeasurementError("pricing snapshot capture time is invalid") from error
        return cls(**data)

    def pricing_for(self, model: str, region: str, execution_date: date) -> RuntimePricing:
        """Reject unsupported rates and mismatched execution inputs before I/O."""
        if (
            type(self.captured_at) is not datetime
            or self.captured_at.tzinfo is None
            or self.captured_at.utcoffset() is None
            or type(execution_date) is not date
            or self.captured_at.date() > execution_date
        ):
            raise RuntimeMeasurementError("pricing snapshot capture date is invalid")
        try:
            source = urlsplit(self.source_url) if isinstance(self.source_url, str) else None
        except ValueError as error:
            raise RuntimeMeasurementError("pricing snapshot source URL is invalid") from error
        if (
            source is None
            or source.scheme != "https"
            or not source.hostname
            or source.geturl() != self.source_url
            or source.username is not None
            or source.password is not None
        ):
            raise RuntimeMeasurementError("pricing snapshot source URL is invalid")
        if (
            self.currency != "JPY"
            or self.vertex_tier != "standard-text"
            or self.bigquery_billing != "on-demand"
        ):
            raise RuntimeMeasurementError("pricing snapshot billing scope is unsupported")
        if (
            not isinstance(model, str)
            or not model.strip()
            or not isinstance(region, str)
            or not region.strip()
            or self.model != model
            or self.region != region
        ):
            raise RuntimeMeasurementError("pricing snapshot model or region does not match")
        rates = []
        for field_name in (
            "vertex_input_jpy_per_million",
            "vertex_output_jpy_per_million",
            "bigquery_jpy_per_tib",
        ):
            raw = getattr(self, field_name)
            if not isinstance(raw, str):
                raise RuntimeMeasurementError("pricing snapshot rate is invalid")
            try:
                value = Decimal(raw)
            except InvalidOperation as error:
                raise RuntimeMeasurementError("pricing snapshot rate is invalid") from error
            converted = float(value)
            if (
                not value.is_finite()
                or value <= 0
                or not math.isfinite(converted)
                or converted <= 0
            ):
                raise RuntimeMeasurementError("pricing snapshot rate is invalid")
            rates.append(converted)
        return RuntimePricing(*rates)


def _non_negative_number(value: Any, name: str) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
    ):
        raise RuntimeMeasurementError(f"{name} must be finite and non-negative")
    return float(value)


@dataclass(frozen=True)
class RuntimePricing:
    """Explicit usage rates; request and job counts are never pricing inputs."""

    vertex_input_jpy_per_million: int | float
    vertex_output_jpy_per_million: int | float
    bigquery_jpy_per_tib: int | float

    def __post_init__(self) -> None:
        for name in (
            "vertex_input_jpy_per_million",
            "vertex_output_jpy_per_million",
            "bigquery_jpy_per_tib",
        ):
            _non_negative_number(getattr(self, name), name)

    def cost_jpy(self, usage: RuntimeUsage) -> float:
        return (
            usage.vertex_input_tokens * self.vertex_input_jpy_per_million / 1e6
            + usage.vertex_output_tokens * self.vertex_output_jpy_per_million / 1e6
            + usage.bigquery_bytes_billed * self.bigquery_jpy_per_tib / TIB
        )


@dataclass(frozen=True)
class RuntimeUsage:
    """Complete response and job accounting for one run."""

    vertex_input_tokens: int
    vertex_output_tokens: int
    bigquery_bytes_processed: int
    bigquery_bytes_billed: int
    bigquery_dry_run_estimated_bytes: int


@dataclass
class _RunLedger:
    vertex_input_tokens: int = 0
    vertex_output_tokens: int = 0
    bigquery_bytes_processed: int = 0
    bigquery_bytes_billed: int = 0
    bigquery_dry_run_estimated_bytes: int = 0
    pending_query_jobs: int = 0
    errors: list[str] = field(default_factory=list)

    def fail(self, message: str) -> None:
        self.errors.append(message)
        raise RuntimeMeasurementError(message)

    def count(self, value: Any, message: str) -> int:
        if type(value) is not int or value < 0:
            self.fail(message)
        return value

    def optional_count(self, value: Any, message: str) -> int:
        return 0 if value is None else self.count(value, message)

    def record_vertex(self, response: Any) -> None:
        metadata = getattr(response, "usage_metadata", None)
        if metadata is None or not all(
            hasattr(metadata, name)
            for name in ("prompt_token_count", "candidates_token_count")
        ):
            self.fail("Vertex response usage metadata is incomplete")
        prompt = self.count(
            metadata.prompt_token_count, "Vertex response usage metadata is invalid"
        )
        candidates = self.count(
            metadata.candidates_token_count,
            "Vertex response usage metadata is invalid",
        )
        thoughts = self.optional_count(
            getattr(metadata, "thoughts_token_count", 0),
            "Vertex response usage metadata is invalid",
        )
        tool_prompt = self.optional_count(
            getattr(metadata, "tool_use_prompt_token_count", 0),
            "Vertex response usage metadata is invalid",
        )
        total = getattr(metadata, "total_token_count", None)
        if total is not None and self.count(
            total, "Vertex response usage metadata is invalid"
        ) != prompt + candidates + thoughts + tool_prompt:
            self.fail("Vertex response token totals are inconsistent")
        self.vertex_input_tokens += prompt + tool_prompt
        self.vertex_output_tokens += candidates + thoughts

    def record_dry_run(self, job: Any) -> None:
        estimate = self.count(
            getattr(job, "total_bytes_processed", None),
            "BigQuery dry run byte estimate is incomplete",
        )
        self.bigquery_dry_run_estimated_bytes += estimate

    def record_query(self, job: Any) -> None:
        processed = getattr(job, "total_bytes_processed", None)
        billed = getattr(job, "total_bytes_billed", None)
        if processed is None or billed is None:
            self.fail("BigQuery completed job metadata is incomplete")
        self.bigquery_bytes_processed += self.count(
            processed, "BigQuery completed job metadata is invalid"
        )
        self.bigquery_bytes_billed += self.count(
            billed, "BigQuery completed job metadata is invalid"
        )
        self.pending_query_jobs -= 1

    def start_query(self) -> None:
        self.pending_query_jobs += 1

    def usage(self) -> RuntimeUsage:
        if self.errors:
            raise RuntimeMeasurementError(self.errors[0])
        if self.pending_query_jobs:
            raise RuntimeMeasurementError("BigQuery query job did not complete")
        return RuntimeUsage(
            self.vertex_input_tokens,
            self.vertex_output_tokens,
            self.bigquery_bytes_processed,
            self.bigquery_bytes_billed,
            self.bigquery_dry_run_estimated_bytes,
        )


class _MeasuredQueryJob:
    def __init__(self, job: Any, ledger: _RunLedger):
        self._job = job
        self._ledger = ledger
        self._recorded = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._job, name)

    def result(self, *args, **kwargs):
        try:
            return self._job.result(*args, **kwargs)
        finally:
            if not self._recorded:
                self._recorded = True
                self._ledger.record_query(self._job)


class _MeasuredBigQuery:
    def __init__(self, client: Any, meter: RuntimeMeter):
        self._client = client
        self._meter = meter

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)

    def query(self, *args, **kwargs):
        ledger = self._meter.active_ledger()
        try:
            job = self._client.query(*args, **kwargs)
        except Exception:
            ledger.fail("BigQuery query outcome cannot be measured")
        config = kwargs.get("job_config")
        if getattr(config, "dry_run", None) is True:
            ledger.record_dry_run(job)
            return job
        ledger.start_query()
        return _MeasuredQueryJob(job, ledger)


class _MeasuredModels:
    def __init__(self, models: Any, meter: RuntimeMeter):
        self._models = models
        self._meter = meter

    def __getattr__(self, name: str) -> Any:
        return getattr(self._models, name)

    def generate_content(self, *args, **kwargs):
        ledger = self._meter.active_ledger()
        try:
            response = self._models.generate_content(*args, **kwargs)
        except Exception:
            ledger.fail("Vertex response usage cannot be measured")
        ledger.record_vertex(response)
        return response


class _MeasuredVertex:
    def __init__(self, client: Any, meter: RuntimeMeter):
        self._client = client
        self.models = _MeasuredModels(client.models, meter)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)


class RuntimeMeter:
    """Own one active run ledger and turn measured usage into a run measurement."""

    def __init__(self, pricing: RuntimePricing):
        if not isinstance(pricing, RuntimePricing):
            raise RuntimeMeasurementError("runtime pricing is required")
        self._pricing = pricing
        self._active: _RunLedger | None = None

    def instrument(self, bq: Any, vertex: Any) -> tuple[Any, Any]:
        return _MeasuredBigQuery(bq, self), _MeasuredVertex(vertex, self)

    def active_ledger(self) -> _RunLedger:
        if self._active is None:
            raise RuntimeMeasurementError("provider call occurred outside a measured run")
        return self._active

    def __call__(
        self,
        _identity: tuple[str, str, str],
        execute: Callable[[], RenderingAttempt],
    ) -> RunMeasurement:
        if self._active is not None or not callable(execute):
            raise RuntimeMeasurementError("runtime meter cannot overlap runs")
        ledger = _RunLedger()
        self._active = ledger
        try:
            execute()
        finally:
            self._active = None
        usage = ledger.usage()
        cost = _non_negative_number(self._pricing.cost_jpy(usage), "runtime cost")
        return RunMeasurement(usage.bigquery_bytes_processed, cost)


def run_runtime_metered_manifest_evaluation(
    manifest: Any,
    bq: Any,
    vertex: Any,
    model: str,
    *,
    as_of: date,
    output_directory: str | Path,
    pricing_snapshot: PricingSnapshot,
    region: str,
    execution_date: date,
    rendering_runner: Callable[..., tuple[RenderingAttempt, ...]] | None = None,
) -> dict[str, Path]:
    """Instrument the exact clients used by the measured manifest entry."""
    if not isinstance(pricing_snapshot, PricingSnapshot):
        raise RuntimeMeasurementError("pricing snapshot is required")
    pricing = pricing_snapshot.pricing_for(model, region, execution_date)
    meter = RuntimeMeter(pricing)
    measured_bq, measured_vertex = meter.instrument(bq, vertex)
    options: dict[str, Any] = {}
    if rendering_runner is not None:
        options["rendering_runner"] = rendering_runner
    return run_measured_manifest_evaluation(
        manifest,
        measured_bq,
        measured_vertex,
        model,
        as_of=as_of,
        output_directory=output_directory,
        meter=meter,
        **options,
    )
