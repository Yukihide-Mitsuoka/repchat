"""Catalog domain — pure business logic.

Imports nothing outside the standard library (ARC-002): no framework, no I/O, no other
module. Invalid state is unrepresentable — value objects and the aggregate validate on
construction, so the rest of the system never has to re-check (COD-011).
"""

from __future__ import annotations

from dataclasses import dataclass


class CatalogError(Exception):
    """Base for catalog domain-rule violations. The interface layer translates these into
    transport responses (COD-010/011); they never surface as raw infrastructure errors."""


class InvalidMoney(CatalogError):
    pass


class InvalidProduct(CatalogError):
    pass


@dataclass(frozen=True)
class Money:
    """Value object: an amount in minor units (e.g. cents) plus an ISO-4217 currency.
    Immutable and self-validating — an invalid Money cannot be constructed."""

    amount_minor: int
    currency: str

    def __post_init__(self) -> None:
        if self.amount_minor < 0:
            raise InvalidMoney("amount must not be negative")
        if len(self.currency) != 3 or not self.currency.isalpha():
            raise InvalidMoney("currency must be a 3-letter ISO-4217 code")


@dataclass(frozen=True)
class ProductId:
    value: str

    def __post_init__(self) -> None:
        if not self.value.strip():
            raise InvalidProduct("product id must not be empty")


@dataclass
class Product:
    """Aggregate root. Invariants: a product always has a non-empty name; a *listed*
    product always has a non-zero price. State changes go through methods so the
    invariants hold everywhere (never mutate `listed` directly)."""

    id: ProductId
    name: str
    price: Money
    listed: bool = False

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise InvalidProduct("product name must not be empty")

    def list_for_sale(self) -> None:
        # Enforced in the domain, not trusted to the caller.
        if self.price.amount_minor == 0:
            raise InvalidProduct("cannot list a product with a zero price")
        self.listed = True

    def delist(self) -> None:
        self.listed = False
