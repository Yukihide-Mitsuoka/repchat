"""Derive source-independent SQL field policy from inspected schema metadata."""

from __future__ import annotations

import re
from dataclasses import dataclass

from bigquery_schema_snapshot import FIELD_TYPES, MAX_DEPTH, MAX_FIELDS


class SchemaPolicyError(ValueError):
    """Raised when canonical schema metadata cannot form a safe field policy."""


@dataclass(frozen=True)
class AnalysisFieldPolicy:
    """One exact field path and the controls inherited from its ancestors."""

    table: str
    path: tuple[str, ...]
    field_type: str
    mode: str
    repeated: bool
    restricted: bool


def _policy_tags(value: object) -> bool:
    if value is None:
        return False
    names = value.get("names") if isinstance(value, dict) else None
    if (
        not isinstance(value, dict)
        or set(value) != {"names"}
        or not isinstance(names, list)
        or not names
        or any(not isinstance(name, str) or not name for name in names)
        or len(set(names)) != len(names)
    ):
        raise SchemaPolicyError("analysis contract field policy tags are invalid")
    return True


def _fields(
    table: str,
    raw: object,
    result: list[AnalysisFieldPolicy],
    budget: list[int],
    *,
    prefix: tuple[str, ...] = (),
    repeated: bool = False,
    restricted: bool = False,
    depth: int = 0,
) -> None:
    if not isinstance(raw, list) or not raw or depth > MAX_DEPTH:
        raise SchemaPolicyError("analysis contract fields are invalid")
    names = set()
    for field in raw:
        budget[0] += 1
        if budget[0] > MAX_FIELDS or not isinstance(field, dict):
            raise SchemaPolicyError("analysis contract fields exceed policy limits")
        name, field_type, mode = field.get("name"), field.get("type"), field.get("mode")
        if not isinstance(name, str) or not name or name.casefold() in names:
            raise SchemaPolicyError("analysis contract field names are invalid")
        if (
            not isinstance(field_type, str)
            or field_type not in FIELD_TYPES
            or not isinstance(mode, str)
            or mode not in {"NULLABLE", "REQUIRED", "REPEATED"}
        ):
            raise SchemaPolicyError("analysis contract field type or mode is invalid")
        names.add(name.casefold())
        path = (*prefix, name)
        inherited_repeated = repeated or mode == "REPEATED"
        inherited_restricted = restricted or _policy_tags(field.get("policyTags"))
        result.append(
            AnalysisFieldPolicy(
                table, path, field_type, mode, inherited_repeated, inherited_restricted
            )
        )
        children = field.get("fields")
        if field_type in {"RECORD", "STRUCT"}:
            if not isinstance(children, list) or not children:
                raise SchemaPolicyError("analysis contract structured field is empty")
            _fields(
                table,
                children,
                result,
                budget,
                prefix=path,
                repeated=inherited_repeated,
                restricted=inherited_restricted,
                depth=depth + 1,
            )
        elif "fields" in field:
            raise SchemaPolicyError("analysis contract scalar field has children")


def derive_schema_policy(tables: object) -> tuple[AnalysisFieldPolicy, ...]:
    """Flatten exact contract field paths without target-specific knowledge."""
    if not isinstance(tables, list) or not tables:
        raise SchemaPolicyError("analysis contract tables are invalid")
    result: list[AnalysisFieldPolicy] = []
    budget = [0]
    identities = set()
    for table in tables:
        identity = table.get("table") if isinstance(table, dict) else None
        if not isinstance(identity, str) or not re.fullmatch(
            r"[A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_*]+", identity
        ) or identity.count("*") > 1 or ("*" in identity and not identity.endswith("*")):
            raise SchemaPolicyError("analysis contract table is invalid")
        if identity in identities:
            raise SchemaPolicyError("analysis contract tables are duplicated")
        identities.add(identity)
        _fields(identity, table.get("fields"), result, budget)
        shards = table.get("dateShards")
        if shards is not None:
            if not isinstance(shards, dict):
                raise SchemaPolicyError("analysis contract date shards are invalid")
            result.append(
                AnalysisFieldPolicy(
                    identity, ("_TABLE_SUFFIX",), "STRING", "REQUIRED", False, False
                )
            )
        partition = table.get("timePartitioning")
        if partition is not None and not isinstance(partition, dict):
            raise SchemaPolicyError("analysis contract time partition is invalid")
        if isinstance(partition, dict) and not partition.get("field"):
            pseudo = "_PARTITIONDATE" if partition.get("type") == "DAY" else "_PARTITIONTIME"
            field_type = "DATE" if pseudo == "_PARTITIONDATE" else "TIMESTAMP"
            result.append(
                AnalysisFieldPolicy(identity, (pseudo,), field_type, "REQUIRED", False, False)
            )
    keys = [(item.table, item.path) for item in result]
    if len(keys) != len(set(keys)):
        raise SchemaPolicyError("analysis contract field paths are duplicated")
    return tuple(sorted(result, key=lambda item: (item.table, item.path)))
