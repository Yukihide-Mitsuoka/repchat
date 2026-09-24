"""Hold an evaluation query reservation until its BigQuery job completes."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_CEILING, localcontext
from typing import Any

from bigquery_budget import bigquery_query_reservation_jpy
from execution_budget import BudgetError, BudgetGate, BudgetReservation
from manifest_runtime_meter import PricingSnapshot, TIB


MICRO_JPY = Decimal("0.000001")


class _BudgetedQueryJob:
    def __init__(
        self,
        job: Any,
        reservation: BudgetReservation,
        maximum_bytes_billed: int,
        rate_jpy_per_tib: str,
    ):
        self._job = job
        self._reservation = reservation
        self._maximum_bytes_billed = maximum_bytes_billed
        self._rate_jpy_per_tib = rate_jpy_per_tib
        self._closed = False
        self._settled = False

    def done(self) -> bool:
        if self._closed:
            raise BudgetError("query job reservation is already closed")
        try:
            return self._job.done()
        except BaseException:
            self._closed = True
            self._reservation.fail()
            raise

    @property
    def total_bytes_processed(self) -> Any:
        if not self._settled:
            raise BudgetError("query result is not settled")
        return self._job.total_bytes_processed

    def cancel(self) -> Any:
        if self._closed:
            raise BudgetError("query job reservation is already closed")
        self._closed = True
        try:
            return self._job.cancel()
        finally:
            self._reservation.fail()

    def result(self, **kwargs: Any) -> Any:
        if self._closed:
            raise BudgetError("query job reservation is already closed")
        self._closed = True
        if set(kwargs) - {"timeout", "max_results", "retry", "job_retry"} or any(
            kwargs.get(name) is not None for name in ("retry", "job_retry")
        ):
            self._reservation.fail()
            raise BudgetError("query result retry or options are unsupported")
        try:
            result = self._job.result(**{**kwargs, "retry": None, "job_retry": None})
            billed = getattr(self._job, "total_bytes_billed", None)
            if type(billed) is not int or not 0 <= billed <= self._maximum_bytes_billed:
                raise BudgetError("query billed bytes are missing or exceed reservation")
            with localcontext() as context:
                context.prec = 384
                actual_jpy = (
                    Decimal(self._rate_jpy_per_tib) * billed / TIB
                ).quantize(MICRO_JPY, rounding=ROUND_CEILING)
            self._reservation.settle(actual_jpy)
            self._settled = True
            return result
        except BaseException:
            self._reservation.fail()
            raise


class BudgetedBigQuery:
    """Expose only required BigQuery reads and one budgeted query method."""

    def __init__(
        self,
        client: Any,
        gate: BudgetGate,
        pricing_snapshot: PricingSnapshot,
        *,
        model: str,
        region: str,
        execution_date: date,
    ):
        if getattr(client, "default_query_job_config", None) is not None:
            raise BudgetError("client default query configuration is unsupported")
        if not isinstance(gate, BudgetGate):
            raise BudgetError("validated budget gate is required")
        self._client = client
        self._gate = gate
        self._pricing_snapshot = pricing_snapshot
        self._model = model
        self._region = region
        self._execution_date = execution_date

    def list_tables(self, *args: Any, **kwargs: Any) -> Any:
        return self._client.list_tables(*args, **kwargs)

    def get_table(self, *args: Any, **kwargs: Any) -> Any:
        return self._client.get_table(*args, **kwargs)

    def query(self, sql: str, *, job_config: Any) -> Any:
        if getattr(self._client, "default_query_job_config", None) is not None:
            raise BudgetError("client default query configuration is unsupported")
        if getattr(job_config, "dry_run", None) is True:
            return self._client.query(
                sql, job_config=job_config, retry=None, job_retry=None
            )
        maximum_jpy = bigquery_query_reservation_jpy(
            self._pricing_snapshot,
            model=self._model,
            region=self._region,
            execution_date=self._execution_date,
            job_config=job_config,
        )
        reservation = self._gate.reserve("bigquery", maximum_jpy)
        try:
            job = self._client.query(
                sql, job_config=job_config, retry=None, job_retry=None
            )
            return _BudgetedQueryJob(
                job,
                reservation,
                job_config.maximum_bytes_billed,
                self._pricing_snapshot.bigquery_jpy_per_tib,
            )
        except BaseException:
            reservation.fail()
            raise
