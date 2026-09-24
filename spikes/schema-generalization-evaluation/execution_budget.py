"""Reserve a reviewed evaluation budget until measured usage is available."""

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


class BudgetReservation:
    """One opaque reservation that must reach a terminal state."""

    def __init__(self, gate: BudgetGate, provider: str, maximum_jpy: Decimal):
        self._gate = gate
        self._provider = provider
        self._maximum_jpy = maximum_jpy
        self._state = "open"

    def settle(self, actual_jpy: Decimal) -> None:
        """Record observed cost and release unused exposure."""
        self._gate._settle(self, actual_jpy)

    def fail(self) -> None:
        """Keep the full reservation unresolved after uncertain execution."""
        self._gate._fail(self)


class BudgetGate:
    """Run at most one operation at a time; stop on uncertain accounting."""

    def __init__(self, limits: BudgetLimits):
        if not isinstance(limits, BudgetLimits):
            raise BudgetError("validated budget limits are required")
        self._limits = limits
        self._settled = {"vertex": Decimal(0), "bigquery": Decimal(0)}
        self._unresolved = {"vertex": Decimal(0), "bigquery": Decimal(0)}
        self._stopped = False
        self._active: BudgetReservation | None = None
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

    def _stop_active(self) -> None:
        """Record the active maximum as unresolved; caller holds the lock."""
        active = self._active
        if active is not None:
            with localcontext() as context:
                context.prec = 48
                self._unresolved[active._provider] += active._maximum_jpy
            active._state = "failed"
            self._active = None
        self._stopped = True

    def reserve(self, provider: str, maximum_jpy: Decimal) -> BudgetReservation:
        """Preflight one operation and hold its maximum until settlement."""
        with self._lock:
            if self._stopped:
                raise BudgetError("evaluation budget gate is stopped")
            if self._active is not None:
                self._stop_active()
                raise BudgetError("overlapping paid operations are prohibited")
            try:
                reserved = _amount(maximum_jpy, positive=True)
                if provider not in self._settled:
                    raise BudgetError("provider must be supported")
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
            reservation = BudgetReservation(self, provider, reserved)
            self._active = reservation
            return reservation

    def _settle(self, reservation: BudgetReservation, actual_jpy: Decimal) -> None:
        with self._lock:
            if self._stopped or reservation is not self._active or reservation._state != "open":
                self._stop_active()
                raise BudgetError("reservation is not active")
            try:
                actual = _amount(actual_jpy, positive=False)
                if actual > reservation._maximum_jpy:
                    raise BudgetError("measured cost exceeded reservation")
            except BudgetError:
                self._stop_active()
                raise
            with localcontext() as context:
                context.prec = 48
                self._settled[reservation._provider] += actual
            reservation._state = "settled"
            self._active = None

    def _fail(self, reservation: BudgetReservation) -> None:
        with self._lock:
            if reservation._state == "failed" and self._stopped:
                return
            if reservation is not self._active or reservation._state != "open":
                self._stop_active()
                raise BudgetError("reservation is not active")
            self._stop_active()

    def ensure_idle(self) -> None:
        """Require all reservations to have measured settlement before success."""
        with self._lock:
            if self._active is not None:
                self._stop_active()
            if self._stopped:
                raise BudgetError("evaluation budget gate is stopped or unresolved")

    def run(
        self,
        provider: str,
        maximum_jpy: Decimal,
        operation: Callable[[], tuple[Any, Decimal]],
    ) -> Any:
        """Synchronous compatibility wrapper around staged reservation."""
        if not callable(operation):
            with self._lock:
                self._stop_active()
            raise BudgetError("operation must be callable")
        reservation = self.reserve(provider, maximum_jpy)
        try:
            result, actual_jpy = operation()
            reservation.settle(actual_jpy)
            return result
        except BaseException:
            reservation.fail()
            raise
