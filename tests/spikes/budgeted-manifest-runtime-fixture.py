"""Fake-provider checks for the composed evaluation budget and runtime meter."""

import json
import stat
import sys
from dataclasses import replace
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from types import MappingProxyType, SimpleNamespace as Namespace

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [
    str(ROOT / "spikes/schema-generalization-evaluation"),
    str(ROOT / "spikes/report-generation"),
]

import budgeted_manifest_runtime as composed
from bigquery_scope_discovery import DiscoverySnapshot
from execution_budget import BudgetError, BudgetGate, BudgetLimits
from manifest_artifacts import run_measured_manifest_evaluation
from manifest_dry_run import DryRunAttempt
from manifest_execution import ExecutionAttempt
from manifest_planning import PlannedAnalysisAttempt
from manifest_preflight import PlannedPreflightAttempt
from manifest_rendering import RenderingAttempt
from manifest_result_validation import ResultValidationAttempt
from manifest_runtime_meter import PricingSnapshot, RuntimeMeasurementError
from manifest_sql_generation import GeneratedSQLAttempt
from manifest_sql_validation import ValidatedSQLAttempt
from preflight import PreflightResult


DAY = date(2026, 9, 25)
MODEL = "gemini-3.6-flash"
CONFIG = {
    "system_instruction": "analyze safely",
    "response_mime_type": "application/json",
    "response_schema": {"type": "object"},
    "max_output_tokens": 1024,
}
SNAPSHOT = PricingSnapshot(
    captured_at=datetime(2026, 9, 24, tzinfo=timezone.utc),
    source_url="https://cloud.google.com/vertex-ai/generative-ai/pricing",
    currency="JPY",
    model=MODEL,
    region="global",
    vertex_tier="standard-text",
    bigquery_billing="on-demand",
    vertex_input_jpy_per_million="2",
    vertex_output_jpy_per_million="3",
    bigquery_jpy_per_tib="10",
)


def gate(bigquery="11"):
    total = "13" if bigquery == "11" else "7"
    return BudgetGate(BudgetLimits(Decimal("3"), Decimal(bigquery), Decimal(total)))


class Job:
    total_bytes_processed = 2**38
    total_bytes_billed = 2**38

    def result(self, **kwargs):
        assert kwargs["retry"] is None and kwargs["job_retry"] is None
        return ("row",)


class BigQuery:
    default_query_job_config = None

    def __init__(self):
        self.calls = []

    def query(self, sql, *, job_config, retry, job_retry):
        self.calls.append((sql, retry, job_retry))
        assert job_config.maximum_bytes_billed == 2**39
        return Job()


class Models:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


class Vertex:
    def __init__(self, response):
        self.models = Models(response)
        self._api_client = Namespace(
            vertexai=True,
            location="global",
            project="example-project",
            api_key=None,
            custom_base_url=None,
            _http_options=Namespace(extra_body=None),
        )


def response(prompt=10):
    return Namespace(
        usage_metadata=Namespace(
            prompt_token_count=prompt,
            candidates_token_count=5,
            total_token_count=prompt + 5,
        )
    )


def evaluate(bq, vertex, budget, *, runs=2, swallow=False):
    seen = []

    def fake_evaluation(_manifest, wrapped_bq, wrapped_vertex, _model, **options):
        assert wrapped_bq is not bq and wrapped_vertex is not vertex
        for index in range(runs):
            def execute():
                config = Namespace(dry_run=False, maximum_bytes_billed=2**39)
                assert wrapped_bq.query("SELECT 1", job_config=config).result() == ("row",)
                try:
                    wrapped_vertex.models.generate_content(
                        model=MODEL, contents="question", config=CONFIG
                    )
                except BudgetError:
                    if not swallow:
                        raise
                    try:
                        wrapped_bq.query(
                            "SELECT 1", job_config=Namespace(
                                dry_run=True, maximum_bytes_billed=2**39
                            )
                        )
                    except BudgetError:
                        pass
                    else:
                        raise AssertionError("stopped gate permitted a later dry run")
                    try:
                        wrapped_bq.list_tables("dataset")
                    except BudgetError:
                        pass
                    else:
                        raise AssertionError("stopped gate permitted metadata access")
                return object()

            seen.append(options["meter"](("schema", "case", str(index)), execute))
        Path(options["output_directory"]).mkdir()
        return {"recordings": "written"}

    composed.run_measured_manifest_evaluation = fake_evaluation
    with TemporaryDirectory() as temp_root:
        output = Path(temp_root) / "artifacts"
        try:
            result = composed.run_budgeted_manifest_evaluation(
                {}, bq, vertex, MODEL, as_of=DAY, output_directory=output,
                pricing_snapshot=SNAPSHOT, region="global", execution_date=DAY,
                gate=budget,
            )
        except BaseException:
            assert not output.exists()
            raise
        assert output.is_dir()
    return result, seen


bq, vertex, budget = BigQuery(), Vertex(response()), gate()
result, seen = evaluate(bq, vertex, budget)
assert result == {"recordings": "written"}
assert [(item.bytes_processed, item.cost_jpy) for item in seen] == [
    (2**38, 2.500035), (2**38, 2.500035)
]
assert budget.settled_jpy == {
    "vertex": Decimal("0.000070"), "bigquery": Decimal("5.000000")
}
assert len(bq.calls) == len(vertex.models.calls) == 2
assert all(call[1:] == (None, None) for call in bq.calls)
assert all(call["config"]["http_options"]["retry_options"] == {"attempts": 1}
           for call in vertex.models.calls)

for bad_snapshot, bad_budget, bad_location, expected in (
    (replace(SNAPSHOT, currency="USD"), gate(), "global", RuntimeMeasurementError),
    (SNAPSHOT, gate(), "wrong-region", BudgetError),
    (SNAPSHOT, gate("4"), "global", BudgetError),
):
    bq, vertex = BigQuery(), Vertex(response())
    vertex._api_client.location = bad_location
    try:
        composed.run_budgeted_manifest_evaluation(
            {}, bq, vertex, MODEL, as_of=DAY, output_directory="unused",
            pricing_snapshot=bad_snapshot, region="global", execution_date=DAY,
            gate=bad_budget,
        )
    except expected:
        pass
    else:
        raise AssertionError("invalid preflight was accepted")
    assert bq.calls == vertex.models.calls == []

spent = gate()
spent.reserve("vertex", Decimal("1")).settle(Decimal("0.1"))
bq, vertex = BigQuery(), Vertex(response())
try:
    evaluate(bq, vertex, spent)
except BudgetError:
    pass
else:
    raise AssertionError("previously used budget gate was accepted")
assert bq.calls == vertex.models.calls == []

bq, vertex, budget = BigQuery(), Vertex(Namespace(usage_metadata=None)), gate()
try:
    evaluate(bq, vertex, budget)
except RuntimeMeasurementError:
    pass
else:
    raise AssertionError("missing usage was accepted")
assert len(bq.calls) == len(vertex.models.calls) == 1
assert budget.unresolved_reservation_jpy["vertex"] == Decimal("2.293760")


PIPELINE = {"runtime": "1" * 64, "prompt": "2" * 64, "configuration": "3" * 64}
MANIFEST = {
    "version": 1,
    "evaluation_plan_sha256": "4" * 64,
    "pipeline": PIPELINE,
    "schemas": [{
        "schema_id": "schema-a",
        "authorized_scope": {"datasets": [], "tables": ["alpha.dataset.records"]},
        "cases": [{"case_id": "case-a", "question": "値を集計して", "run_ids": ["run-1", "run-2"]}],
    }],
}


def completed_attempt(run_id):
    snapshot = DiscoverySnapshot('{"version":1}', "a" * 64, "2026-09-25T00:00:00+00:00")
    contract = Namespace(content_json='{"version":1}', fingerprint="b" * 64)
    preflight = PreflightResult("値を集計して", snapshot, contract, {"input_tokens": 1, "output_tokens": 1})
    identity = PlannedPreflightAttempt(
        "schema-a", "case-a", run_id, MappingProxyType(PIPELINE), preflight
    )
    planned = PlannedAnalysisAttempt(identity, {"panels": [{"id": "P1"}]}, 0.25)
    generated = GeneratedSQLAttempt(planned, {"id": "P1"}, "SELECT 1", 0.5)
    validated = ValidatedSQLAttempt(generated, "SELECT 1")
    dry = DryRunAttempt(validated, (("metric_value", "INT64", "NULLABLE"),), 42)
    executed = ExecutionAttempt(dry, ((1,),), ("metric_value",), 84)
    result = ResultValidationAttempt(executed, ((1,),), ("metric_value",), "scalar", 84)
    return RenderingAttempt(result, True, None, None)


def real_runner(single, bq, vertex, model, *, as_of):
    assert model == MODEL and as_of == DAY
    run_id = single["schemas"][0]["cases"][0]["run_ids"][0]
    assert bq.query(
        "SELECT 1", job_config=Namespace(dry_run=False, maximum_bytes_billed=2**39)
    ).result() == ("row",)
    vertex.models.generate_content(model=MODEL, contents="question", config=CONFIG)
    return (completed_attempt(run_id),)


composed.run_measured_manifest_evaluation = run_measured_manifest_evaluation
with TemporaryDirectory() as temp_root:
    output = Path(temp_root) / "artifacts"
    bq, vertex, budget = BigQuery(), Vertex(response()), gate()
    paths = composed.run_budgeted_manifest_evaluation(
        MANIFEST, bq, vertex, MODEL, as_of=DAY, output_directory=output,
        pricing_snapshot=SNAPSHOT, region="global", execution_date=DAY,
        gate=budget, rendering_runner=real_runner,
    )
    assert set(paths) == {"recordings", "scope_snapshots", "analysis_contracts"}
    assert stat.S_IMODE(output.stat().st_mode) == 0o700
    assert all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in paths.values())
    recorded = json.loads(paths["recordings"].read_text())
    assert [item["run"]["run_id"] for item in recorded["runs"]] == ["run-1", "run-2"]
    assert [item["run"]["bytes_processed"] for item in recorded["runs"]] == [2**38] * 2
    assert [item["run"]["cost_jpy"] for item in recorded["runs"]] == [2.500035] * 2
    assert budget.settled_jpy == {
        "vertex": Decimal("0.000070"), "bigquery": Decimal("5.000000")
    }
    assert len(bq.calls) == len(vertex.models.calls) == 2

for failure in ("usage", "partial_usage", "budget", "existing"):
    with TemporaryDirectory() as temp_root:
        output = Path(temp_root) / "artifacts"
        marker = output / "preserved"
        if failure == "existing":
            output.mkdir()
            marker.write_text("keep")
        bq = BigQuery()
        vertex = Vertex(Namespace(usage_metadata=None) if failure == "usage" else response())
        manifest = MANIFEST
        if failure == "partial_usage":
            class SequenceModels(Models):
                def __init__(self):
                    super().__init__(None)
                    self.responses = [response(), Namespace(usage_metadata=None)]

                def generate_content(self, **kwargs):
                    self.calls.append(kwargs)
                    return self.responses.pop(0)

            vertex.models = SequenceModels()
            manifest = json.loads(json.dumps(MANIFEST))
            manifest["schemas"][0]["cases"][0]["run_ids"].append("run-3")
        budget = gate("4") if failure == "budget" else gate()
        expected = {
            "usage": RuntimeMeasurementError,
            "partial_usage": RuntimeMeasurementError,
            "budget": BudgetError,
            "existing": FileExistsError,
        }[failure]
        try:
            composed.run_budgeted_manifest_evaluation(
                manifest, bq, vertex, MODEL, as_of=DAY, output_directory=output,
                pricing_snapshot=SNAPSHOT, region="global", execution_date=DAY,
                gate=budget, rendering_runner=real_runner,
            )
        except expected:
            pass
        else:
            raise AssertionError("failed evaluation wrote artifacts")
        if failure == "existing":
            assert marker.read_text() == "keep" and list(output.iterdir()) == [marker]
        else:
            assert not output.exists()
        expected_calls = {"usage": 1, "partial_usage": 2}.get(failure, 0)
        assert len(bq.calls) == len(vertex.models.calls) == expected_calls

bq, vertex, budget = BigQuery(), Vertex(response(1_048_577)), gate()
try:
    evaluate(bq, vertex, budget, swallow=True)
except BudgetError:
    pass
else:
    raise AssertionError("swallowed budget failure advanced to next run")
assert len(bq.calls) == len(vertex.models.calls) == 1
assert budget.unresolved_reservation_jpy["vertex"] == Decimal("2.293760")
