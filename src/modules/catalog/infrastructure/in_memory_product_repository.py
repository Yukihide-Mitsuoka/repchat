"""Catalog infrastructure — an in-memory adapter implementing the ProductRepository port.

Suitable for unit/integration tests and local runs. A real adapter (SQL, document store,
external API) lives alongside this one and implements the *same* port, so swapping storage
never touches the domain or application (ARC-002).
"""

from __future__ import annotations

from ..application.ports import ProductRepository
from ..domain.product import Product, ProductId


class InMemoryProductRepository(ProductRepository):
    def __init__(self) -> None:
        self._by_id: dict[str, Product] = {}

    def add(self, product: Product) -> None:
        self._by_id[product.id.value] = product

    def get(self, product_id: ProductId) -> Product | None:
        return self._by_id.get(product_id.value)
