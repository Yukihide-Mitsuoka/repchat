"""Read bounded, explicitly approved table metadata without querying rows."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone


MAX_TABLES = 20
MAX_FIELDS = 2000
MAX_DEPTH = 16
MAX_METADATA_BYTES = 200_000
MAX_LISTED_TABLES = 1000
MAX_SHARDS = 100
TABLE_ID = re.compile(r"[a-zA-Z0-9_-]+\.[a-zA-Z0-9_]+\.[a-zA-Z0-9_-]+")
DATE_SHARD_PATTERN = re.compile(
    r"(?P<dataset>[a-zA-Z0-9_-]+\.[a-zA-Z0-9_]+)\."
    r"(?P<prefix>[a-zA-Z0-9_-]+)\*"
)
DATE_SUFFIX = re.compile(r"\d{8}")
FIELD_TYPES = frozenset({
    "STRING", "BYTES", "INTEGER", "INT64", "FLOAT", "FLOAT64", "BOOLEAN", "BOOL",
    "TIMESTAMP", "DATE", "TIME", "DATETIME", "RECORD", "STRUCT", "NUMERIC",
    "BIGNUMERIC", "GEOGRAPHY", "JSON", "RANGE",
})


class SchemaInspectionError(ValueError):
    """Metadata cannot safely represent the requested approved tables."""


@dataclass(frozen=True)
class SchemaSnapshot:
    """Immutable schema content; observation time is not part of its identity."""

    metadata_json: str
    fingerprint: str
    retrieved_at: str

    def metadata(self) -> dict:
        return json.loads(self.metadata_json)


def _fields(raw: list, budget: list[int], depth: int = 0) -> list[dict]:
    if not isinstance(raw, list) or not raw or depth > MAX_DEPTH:
        raise SchemaInspectionError("schema fields are missing or exceed depth limit")
    result = []
    names = set()
    for field in raw:
        budget[0] += 1
        if budget[0] > MAX_FIELDS or not isinstance(field, dict):
            raise SchemaInspectionError("schema fields are invalid or exceed field limit")
        name = field.get("name")
        kind = field.get("type")
        mode = field.get("mode", "NULLABLE")
        if not isinstance(name, str) or not name or name.casefold() in names:
            raise SchemaInspectionError("schema field names are missing or duplicated")
        if not isinstance(kind, str) or kind not in FIELD_TYPES:
            raise SchemaInspectionError("unsupported schema field type")
        if mode not in ("NULLABLE", "REQUIRED", "REPEATED"):
            raise SchemaInspectionError("unsupported schema field mode")
        names.add(name.casefold())
        item = {"name": name, "type": kind, "mode": mode}
        for key in ("description", "precision", "scale", "maxLength", "collation"):
            if key in field:
                if not isinstance(field[key], str):
                    raise SchemaInspectionError("invalid schema field metadata")
                item[key] = field[key]
        if kind in ("RECORD", "STRUCT"):
            item["fields"] = _fields(field.get("fields"), budget, depth + 1)
        elif field.get("fields"):
            raise SchemaInspectionError("non-struct field has children")
        if kind == "RANGE":
            element = field.get("rangeElementType", {})
            if not isinstance(element, dict) or element.get("type") not in ("DATE", "DATETIME", "TIMESTAMP"):
                raise SchemaInspectionError("unsupported range element type")
            item["rangeElementType"] = {"type": element["type"]}
        result.append(item)
    return result


def _table_metadata(
    table, requested: str, budget: list[int], *, wildcard: bool = False,
) -> dict:
    raw = table.to_api_repr()
    ref = raw.get("tableReference", {})
    identity = ".".join(str(ref.get(key, "")) for key in ("projectId", "datasetId", "tableId"))
    if identity != requested:
        raise SchemaInspectionError("returned table differs from approved request")
    if raw.get("type") != "TABLE":
        raise SchemaInspectionError("only physical tables are supported by schema inspection")
    if wildcard and raw.get("encryptionConfiguration"):
        raise SchemaInspectionError("encrypted wildcard tables are unsupported")
    location = raw.get("location")
    if not isinstance(location, str) or not location:
        raise SchemaInspectionError("table location is missing")
    result = {
        "table": requested,
        "location": location,
        "fields": _fields(raw.get("schema", {}).get("fields"), budget),
    }
    # Preserve partition metadata separately from business time semantics.
    for key in ("timePartitioning", "rangePartitioning", "clustering"):
        if key in raw:
            if not isinstance(raw[key], dict) or not raw[key]:
                raise SchemaInspectionError("table metadata is invalid")
            result[key] = raw[key]
    tags = raw.get("resourceTags")
    if tags:
        if not isinstance(tags, dict) or any(
            not isinstance(key, str) or not isinstance(value, str)
            for key, value in tags.items()
        ):
            raise SchemaInspectionError("table metadata is invalid")
        result["resourceTags"] = tags
    elif tags not in (None, {}):
        raise SchemaInspectionError("table metadata is invalid")
    if "timePartitioning" in result and "rangePartitioning" in result:
        raise SchemaInspectionError("conflicting partition metadata")
    required = raw.get("requirePartitionFilter", False)
    if not isinstance(required, bool):
        raise SchemaInspectionError("partition filter requirement is invalid")
    result["requirePartitionFilter"] = required
    return result


def _snapshot(tables: list[dict]) -> SchemaSnapshot:
    metadata = json.dumps(
        {"version": 1, "tables": tables},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )
    if len(metadata.encode("utf-8")) > MAX_METADATA_BYTES:
        raise SchemaInspectionError("schema metadata exceeds input limit; narrow table selection")
    return SchemaSnapshot(
        metadata, hashlib.sha256(metadata.encode("utf-8")).hexdigest(),
        datetime.now(timezone.utc).isoformat(),
    )


def _date_suffix(value: str, label: str) -> date:
    if not isinstance(value, str) or not DATE_SUFFIX.fullmatch(value):
        raise SchemaInspectionError(f"{label} must use YYYYMMDD")
    try:
        return datetime.strptime(value, "%Y%m%d").date()
    except ValueError:
        raise SchemaInspectionError(f"{label} must use YYYYMMDD") from None


def inspect_date_shards(
    bq, table_pattern: str, *, start_suffix: str, end_suffix: str,
    allowed_patterns: frozenset[str],
) -> SchemaSnapshot:
    """Resolve every table matched by one approved YYYYMMDD wildcard."""
    match = DATE_SHARD_PATTERN.fullmatch(table_pattern) if isinstance(table_pattern, str) else None
    if (
        match is None
        or not isinstance(allowed_patterns, frozenset)
        or table_pattern not in allowed_patterns
    ):
        raise SchemaInspectionError("an approved fully qualified date-shard pattern is required")
    start, end = _date_suffix(start_suffix, "start_suffix"), _date_suffix(end_suffix, "end_suffix")
    if start > end:
        raise SchemaInspectionError("start_suffix must not follow end_suffix")
    expected = []
    current = start
    while current <= end:
        expected.append(current.strftime("%Y%m%d"))
        current += timedelta(days=1)
    if len(expected) > MAX_SHARDS:
        raise SchemaInspectionError("date-shard range exceeds inspection limit")

    try:
        listed = list(bq.list_tables(
            match["dataset"], max_results=MAX_LISTED_TABLES + 1,
            timeout=30, retry=None,
        ))
    except Exception:
        raise SchemaInspectionError("table listing failed") from None
    if len(listed) > MAX_LISTED_TABLES:
        raise SchemaInspectionError("dataset table listing exceeds inspection limit")

    members = {}
    prefix = match["prefix"]
    for item in listed:
        table_id = getattr(item, "table_id", None)
        if not isinstance(table_id, str) or not table_id:
            raise SchemaInspectionError("table listing returned an invalid identifier")
        if not table_id.startswith(prefix):
            continue
        suffix = table_id[len(prefix):]
        if not DATE_SUFFIX.fullmatch(suffix) or suffix in members:
            raise SchemaInspectionError("wildcard matches a non-date or duplicate shard")
        members[suffix] = f"{match['dataset']}.{table_id}"
    if not members or len(members) > MAX_SHARDS:
        raise SchemaInspectionError("date-shard set is missing or exceeds inspection limit")
    if any(suffix not in members for suffix in expected):
        raise SchemaInspectionError("requested date-shard range is incomplete")

    observed = []
    for name in sorted(members.values()):
        try:
            observed.append(_table_metadata(
                bq.get_table(name, timeout=30, retry=None), name, [0], wildcard=True,
            ))
        except SchemaInspectionError:
            raise
        except Exception:
            raise SchemaInspectionError("table metadata retrieval failed") from None
    common = {key: value for key, value in observed[0].items() if key != "table"}
    if any(
        {key: value for key, value in table.items() if key != "table"} != common
        for table in observed[1:]
    ):
        raise SchemaInspectionError("date-shard metadata is not identical")
    common["table"] = table_pattern
    common["dateShards"] = {
        "suffixFormat": "YYYYMMDD",
        "startSuffix": start_suffix,
        "endSuffix": end_suffix,
        "members": [members[suffix] for suffix in expected],
    }
    return _snapshot([common])


def inspect_schema(bq, table_ids: list[str], *, allowed_tables: frozenset[str]) -> SchemaSnapshot:
    """Use the caller's authorized client and table set; never discover wider scope.

    Wildcards and views require a separate inspected table-resolution contract.
    Callers must not build allowed_tables from model or user-generated text.
    """
    if not isinstance(table_ids, list) or not 0 < len(table_ids) <= MAX_TABLES:
        raise SchemaInspectionError("select between 1 and 20 approved tables")
    if any(not isinstance(name, str) or not TABLE_ID.fullmatch(name) for name in table_ids):
        raise SchemaInspectionError("fully qualified physical table names are required")
    if len(set(table_ids)) != len(table_ids) or not set(table_ids) <= allowed_tables:
        raise SchemaInspectionError("table selection is duplicated or not approved")
    tables = []
    budget = [0]
    for name in sorted(table_ids):
        try:
            table = bq.get_table(name, timeout=30, retry=None)
            tables.append(_table_metadata(table, name, budget))
        except SchemaInspectionError:
            raise
        except Exception:
            # Provider errors can contain URLs or credentials; retain only a stable category.
            raise SchemaInspectionError("table metadata retrieval failed") from None
    if len({table["location"] for table in tables}) != 1:
        raise SchemaInspectionError("tables must use one data location")
    return _snapshot(tables)
