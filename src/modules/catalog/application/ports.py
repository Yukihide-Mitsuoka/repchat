"""Catalog application ports — the interfaces this module depends on.

Defined here (application), implemented in `infrastructure/` (dependency inversion,
ARC-002). Domain and application never import a database driver or HTTP client directly;
they speak to these abstractions, which keeps the core testable and vendor-neutral.
"""

from __future__ import annotations

from typing import Protocol

from ..domain.product import Product, ProductId


class ProductRepository(Protocol):
    def add(self, product: Product) -> None: ...

    def get(self, product_id: ProductId) -> Product | None: ...
