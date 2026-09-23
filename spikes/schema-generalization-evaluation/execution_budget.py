"""Reserve a reviewed evaluation budget before each synchronous paid operation."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, localcontext
from threading import Lock
from typing import Any, Callable


class BudgetError(ValueError):
    """A proposed operation cannot continue within the evaluation budget."""


def _amount(value: Any, *, positive: bool) -> Decimal:
    if (
        not isinstance(value, Decimal)
        or not value.is_finite()
        or value < 0
        or (positive and value == 0)
        or value.adjusted() > 31
        or value.as_tuple().exponent < -6
    ):
        raise BudgetError("budget amount must be a bounded Decimal in micro-JPY")
    return value


@dataclass(frozen=True)
class BudgetLimits:
    """JPY ceilings to be supplied by a validated execution intent."""

    vertex_jpy: Decimal
    bigquery_jpy: Decimal
    total_jpy: Decimal

    def __post_init__(self) -> None:
        for amount in (self.vertex_jpy, self.bigquery_jpy, self.total_jpy):
            _amount(amount, positive=True)
        with localcontext() as context:
            context.prec = 48
            if self.total_jpy > self.vertex_jpy + self.bigquery_jpy:
                raise BudgetError("total budget exceeds provider budgets")


class BudgetGate:
    """Run at most one operation at a time; stop on uncertain accounting."""

    def __init__(self, limits: BudgetLimits):
        if not isinstance(limits, BudgetLimits):
            raise BudgetError("validated budget limits are required")
        self._limits = limits
        self._settled = {"vertex": Decimal(0), "bigquery": Decimal(0)}
        self._unresolved = {"vertex": Decimal(0), "bigquery": Decimal(0)}
        self._stopped = False
        self._active = False
        self._lock = Lock()

    @property
    def settled_jpy(self) -> dict[str, Decimal]:
        """Return only costs backed by complete observed usage."""
        with self._lock:
            return dict(self._settled)

    @property
    def unresolved_reservation_jpy(self) -> dict[str, Decimal]:
        """Return reservations whose actual cost cannot be trusted."""
        with self._lock:
            return dict(self._unresolved)

    def run(
        self,
        provider: str,
        maximum_jpy: Decimal,
        operation: Callable[[], tuple[Any, Decimal]],
    ) -> Any:
        """Reserve, call once, then settle measured cost or stop permanently."""
        with self._lock:
            if self._stopped:
                raise BudgetError("evaluation budget gate is stopped")
            if self._active:
                self._stopped = True
                raise BudgetError("overlapping paid operations are prohibited")
            try:
                reserved = _amount(maximum_jpy, positive=True)
                if provider not in self._settled or not callable(operation):
                    raise BudgetError("provider and operation must be supported")
                provider_limit = getattr(self._limits, f"{provider}_jpy")
                with localcontext() as context:
                    context.prec = 48
                    if (
                        self._settled[provider] + reserved > provider_limit
                        or sum(self._settled.values()) + reserved > self._limits.total_jpy
                    ):
                        raise BudgetError("evaluation budget would be exceeded")
            except BudgetError:
                self._stopped = True
                raise
            self._active = True
        try:
            result, actual_jpy = operation()
            actual = _amount(actual_jpy, positive=False)
            with self._lock:
                if self._stopped or actual > reserved:
                    raise BudgetError("measured cost exceeded reservation or gate stopped")
                with localcontext() as context:
                    context.prec = 48
                    self._settled[provider] += actual
            return result
        except BaseException:
            with self._lock:
                with localcontext() as context:
                    context.prec = 48
                    self._unresolved[provider] += reserved
                self._stopped = True
            raise
        finally:
            with self._lock:
                self._active = False
