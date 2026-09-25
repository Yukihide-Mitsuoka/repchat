"""Fake-provider checks for the composed evaluation budget and runtime meter."""

import sys
from dataclasses import replace
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace as Namespace

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [
    str(ROOT / "spikes/schema-generalization-evaluation"),
    str(ROOT / "spikes/report-generation"),
]

import budgeted_manifest_runtime as composed
from execution_budget import BudgetError, BudgetGate, BudgetLimits
from manifest_runtime_meter import PricingSnapshot, RuntimeMeasurementError


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

bq, vertex, budget = BigQuery(), Vertex(response(1_048_577)), gate()
try:
    evaluate(bq, vertex, budget, swallow=True)
except BudgetError:
    pass
else:
    raise AssertionError("swallowed budget failure advanced to next run")
assert len(bq.calls) == len(vertex.models.calls) == 1
assert budget.unresolved_reservation_jpy["vertex"] == Decimal("2.293760")
