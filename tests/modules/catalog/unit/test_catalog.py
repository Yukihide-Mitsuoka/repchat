"""Unit tests for the catalog module.

Mirror src/ layout (TST-001); names read as specifications (TST-010); error paths and
boundaries are covered, not just the happy path (TST-002). No I/O, no shared state — the
in-memory repository is a fresh instance per test.
"""

import pytest

from src.modules.catalog.application.add_product import (
    AddProduct,
    AddProductCommand,
    AlreadyExists,
)
from src.modules.catalog.domain.product import (
    InvalidMoney,
    InvalidProduct,
    Money,
    Product,
    ProductId,
)
from src.modules.catalog.infrastructure.in_memory_product_repository import (
    InMemoryProductRepository,
)
from src.modules.catalog.interface.http_handler import add_product_handler


class TestMoney:
    def test_valid_money_is_created(self):
        assert Money(1000, "USD").amount_minor == 1000

    def test_negative_amount_is_rejected(self):
        with pytest.raises(InvalidMoney):
            Money(-1, "USD")

    def test_malformed_currency_is_rejected(self):
        with pytest.raises(InvalidMoney):
            Money(100, "US")


class TestProduct:
    def test_empty_name_is_rejected(self):
        with pytest.raises(InvalidProduct):
            Product(ProductId("p1"), "   ", Money(500, "USD"))

    def test_listing_sets_the_flag(self):
        product = Product(ProductId("p1"), "Widget", Money(500, "USD"))
        product.list_for_sale()
        assert product.listed is True

    def test_listing_a_zero_priced_product_is_rejected(self):
        product = Product(ProductId("p1"), "Widget", Money(0, "USD"))
        with pytest.raises(InvalidProduct):
            product.list_for_sale()


class TestAddProduct:
    def test_adds_and_lists_a_product(self):
        use_case = AddProduct(InMemoryProductRepository())
        product_id = use_case.handle(AddProductCommand("p1", "Widget", 500, "USD"))
        assert product_id.value == "p1"

    def test_duplicate_id_is_rejected(self):
        repo = InMemoryProductRepository()
        use_case = AddProduct(repo)
        use_case.handle(AddProductCommand("p1", "Widget", 500, "USD"))
        with pytest.raises(AlreadyExists):
            use_case.handle(AddProductCommand("p1", "Other", 700, "USD"))


class TestAddProductHandler:
    def test_valid_request_returns_201(self):
        use_case = AddProduct(InMemoryProductRepository())
        response = add_product_handler(
            use_case, {"id": "p1", "name": "Widget", "price_minor": 500, "currency": "USD"}
        )
        assert response.status == 201
        assert response.body == {"id": "p1"}

    def test_missing_field_returns_400(self):
        use_case = AddProduct(InMemoryProductRepository())
        response = add_product_handler(use_case, {"id": "p1", "name": "Widget"})
        assert response.status == 400

    def test_zero_price_returns_422(self):
        use_case = AddProduct(InMemoryProductRepository())
        response = add_product_handler(
            use_case, {"id": "p1", "name": "Widget", "price_minor": 0, "currency": "USD"}
        )
        assert response.status == 422
