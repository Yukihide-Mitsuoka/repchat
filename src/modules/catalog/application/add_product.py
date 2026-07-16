"""Catalog application — the AddProduct use case.

Orchestrates the domain; holds no business rules of its own (those live in the domain).
Depends on the ProductRepository *port*, never a concrete adapter.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..domain.product import Money, Product, ProductId
from .ports import ProductRepository


class AlreadyExists(Exception):
    """Application-level conflict (not a domain-rule violation): the command clashes with
    existing state. Distinct from CatalogError so the interface can map it to 409."""


@dataclass(frozen=True)
class AddProductCommand:
    """Input DTO — plain data crossing into the application. Field types are already
    parsed; shape/format validation happens at the interface boundary (COD-011)."""

    product_id: str
    name: str
    price_minor: int
    currency: str


class AddProduct:
    def __init__(self, repository: ProductRepository) -> None:
        self._repository = repository

    def handle(self, command: AddProductCommand) -> ProductId:
        product_id = ProductId(command.product_id)
        if self._repository.get(product_id) is not None:
            raise AlreadyExists(f"product {command.product_id!r} already exists")

        product = Product(
            id=product_id,
            name=command.name,
            price=Money(command.price_minor, command.currency),
        )
        product.list_for_sale()
        self._repository.add(product)
        return product_id
