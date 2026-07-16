"""Catalog interface — inbound edge (illustrative, framework-free).

Validates raw external input at the boundary (COD-011) and maps domain/application errors
to transport responses. Deliberately not tied to FastAPI/Flask/etc.: wire those in
following this shape (parse -> call use case -> translate errors).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..application.add_product import AddProduct, AddProductCommand, AlreadyExists
from ..domain.product import CatalogError


@dataclass(frozen=True)
class Response:
    status: int
    body: dict[str, Any]


def add_product_handler(use_case: AddProduct, payload: dict[str, Any]) -> Response:
    # Boundary validation: outside is hostile; coerce and reject bad shapes here so the
    # application/domain only ever see well-typed input.
    try:
        command = AddProductCommand(
            product_id=str(payload["id"]),
            name=str(payload["name"]),
            price_minor=int(payload["price_minor"]),
            currency=str(payload["currency"]),
        )
    except (KeyError, TypeError, ValueError):
        return Response(400, {"error": "invalid request body"})

    try:
        product_id = use_case.handle(command)
    except AlreadyExists as exc:
        return Response(409, {"error": str(exc)})
    except CatalogError as exc:
        return Response(422, {"error": str(exc)})

    return Response(201, {"id": product_id.value})
