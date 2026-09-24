"""Discover a bounded analysis catalog from server-authorized BigQuery scope."""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal

from bigquery_schema_snapshot import (
    MAX_FIELDS,
    MAX_METADATA_BYTES,
    MAX_SHARDS,
    MAX_TABLES,
    SchemaInspectionError,
    SchemaInspectionInfrastructureError,
    SchemaSnapshot,
    inspect_date_shards,
    inspect_schema,
)


MAX_AUTHORIZED_DATASETS = 10
MAX_LISTED_TABLES = 1000
MAX_VALUE_FIELDS_PER_TABLE = 64
MAX_SAMPLE_ROWS = 10_000
SAMPLE_PERCENT = 1
MAX_SAMPLE_VALUES = 6
MAX_CATEGORICAL_DISTINCT = 32
MAX_SAMPLE_CHARACTERS = 64
MAX_BYTES_BILLED_PER_QUERY = 1024**3
MAX_BYTES_BILLED_TOTAL = 2 * 1024**3
MAX_DISCOVERY_BYTES = 500_000
QUERY_TIMEOUT_SECONDS = 60
DATASET_ID = re.compile(r"[a-zA-Z0-9_-]+\.[a-zA-Z0-9_]+")
TABLE_ID = re.compile(r"[a-zA-Z0-9_-]+\.[a-zA-Z0-9_]+\.[a-zA-Z0-9_-]+")
DATE_SUFFIX = re.compile(r"(?P<prefix>.+?)(?P<suffix>\d{8})")
NUMERIC_TYPES = frozenset({
    "INTEGER",
    "INT64",
    "FLOAT",
    "FLOAT64",
    "NUMERIC",
    "BIGNUMERIC",
})
TEMPORAL_TYPES = frozenset({"DATE", "TIME", "DATETIME", "TIMESTAMP"})
DISTINCT_TYPES = NUMERIC_TYPES | TEMPORAL_TYPES | {"STRING", "BOOLEAN", "BOOL"}
ORDERED_TYPES = NUMERIC_TYPES | TEMPORAL_TYPES


class ScopeDiscoveryError(ValueError):
    """Authorized scope cannot be converted into a safe bounded catalog."""


class ScopeDiscoveryInfrastructureError(ScopeDiscoveryError):
    """A discovery dependency failed before a bounded catalog was available."""


@dataclass(frozen=True)
class AuthorizedScope:
    """Server-owned BigQuery grants; never populate this from model text."""

    datasets: frozenset[str] = frozenset()
    tables: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        if (
            not isinstance(self.datasets, frozenset)
            or not isinstance(self.tables, frozenset)
            or not self.datasets
            and not self.tables
        ):
            raise ScopeDiscoveryError("authorized scope must contain datasets or tables")
        if len(self.datasets) > MAX_AUTHORIZED_DATASETS or len(self.tables) > MAX_TABLES:
            raise ScopeDiscoveryError("authorized scope exceeds discovery limits")
        if any(not isinstance(value, str) or not DATASET_ID.fullmatch(value) for value in self.datasets):
            raise ScopeDiscoveryError("authorized datasets must be fully qualified")
        if any(not isinstance(value, str) or not TABLE_ID.fullmatch(value) for value in self.tables):
            raise ScopeDiscoveryError("authorized tables must be fully qualified")


@dataclass(frozen=True)
class DiscoverySnapshot:
    """Canonical schema and bounded value summaries for one authorized scope."""

    content_json: str
    fingerprint: str
    retrieved_at: str

    def content(self) -> dict:
        return json.loads(self.content_json)


def _listed_table_name(item, dataset: str) -> str | None:
    kind = getattr(item, "table_type", None)
    if kind not in (None, "TABLE"):
        return None
    table_id = getattr(item, "table_id", None)
    if not isinstance(table_id, str) or not table_id:
        raise ScopeDiscoveryError("table listing returned an invalid identifier")
    name = f"{dataset}.{table_id}"
    if not TABLE_ID.fullmatch(name):
        raise ScopeDiscoveryError("table listing returned an invalid identifier")
    return name


def _authorized_table_ids(bq, scope: AuthorizedScope) -> list[str]:
    names = set(scope.tables)
    for dataset in sorted(scope.datasets):
        try:
            listed = list(
                bq.list_tables(
                    dataset,
                    max_results=MAX_LISTED_TABLES + 1,
                    timeout=30,
                    retry=None,
                )
            )
        except Exception:
            raise ScopeDiscoveryInfrastructureError(
                "authorized table listing failed"
            ) from None
        if len(listed) > MAX_LISTED_TABLES:
            raise ScopeDiscoveryError("authorized table listing exceeds discovery limit")
        for item in listed:
            name = _listed_table_name(item, dataset)
            if name is not None:
                names.add(name)
    if not names:
        raise ScopeDiscoveryError("authorized scope contains no physical tables")
    if len(names) > MAX_TABLES:
        raise ScopeDiscoveryError("authorized scope contains too many physical tables")
    return sorted(names)


def _flatten_fields(
    fields: list[dict], prefix: tuple[str, ...] = (), repeated: bool = False
) -> list[dict]:
    result = []
    for field in fields:
        segments = (*prefix, field["name"])
        inherited_repeated = repeated or field["mode"] == "REPEATED"
        item = {
            "path": ".".join(segments),
            "segments": list(segments),
            "type": field["type"],
            "mode": field["mode"],
            "valueClass": _value_class(field, inherited_repeated),
        }
        if "policyTags" in field:
            item["policyTags"] = field["policyTags"]
        result.append(item)
        if field["type"] in ("RECORD", "STRUCT"):
            result.extend(_flatten_fields(field["fields"], segments, inherited_repeated))
    return result


def _value_class(field: dict, repeated: bool) -> str:
    if "policyTags" in field:
        return "restricted"
    if repeated:
        return "repeated"
    kind = field["type"]
    if kind in ("RECORD", "STRUCT"):
        return "structured"
    if kind in NUMERIC_TYPES:
        return "numeric"
    if kind in TEMPORAL_TYPES:
        return "temporal"
    if kind in ("BOOLEAN", "BOOL"):
        return "boolean"
    if kind == "STRING":
        return "categorical_candidate"
    return "opaque"


def _date_shard(table: str) -> dict | None:
    base, table_id = table.rsplit(".", 1)
    match = DATE_SUFFIX.fullmatch(table_id)
    if match is None:
        return None
    try:
        datetime.strptime(match["suffix"], "%Y%m%d")
    except ValueError:
        return None
    return {
        "pattern": f"{base}.{match['prefix']}*",
        "suffixFormat": "YYYYMMDD",
        "suffix": match["suffix"],
    }


def _quote_identifier(value: str) -> str:
    if not value or any(ord(character) < 32 for character in value):
        raise ScopeDiscoveryError("schema contains an unsafe field identifier")
    return "`" + value.replace("\\", "\\\\").replace("`", "\\`") + "`"


def _field_expression(segments: list[str]) -> str:
    return ".".join(["source", *(_quote_identifier(part) for part in segments)])


def _partition_predicate(table: dict) -> str | None:
    if not table.get("requirePartitionFilter"):
        return None
    partition = table.get("timePartitioning") or table.get("rangePartitioning")
    field = partition.get("field") if isinstance(partition, dict) else None
    if isinstance(field, str) and field:
        return f"{_field_expression([field])} IS NOT NULL"
    if "timePartitioning" in table:
        return "source._PARTITIONTIME IS NOT NULL"
    raise ScopeDiscoveryError("required partition filter has no usable partition field")


def _selectable_fields(fields: list[dict]) -> list[dict]:
    classes = ("temporal", "numeric", "boolean", "categorical_candidate", "opaque")
    buckets = {
        value_class: sorted(
            (field for field in fields if field["valueClass"] == value_class),
            key=lambda field: tuple(field["segments"]),
        )
        for value_class in classes
    }
    selected = []
    while len(selected) < MAX_VALUE_FIELDS_PER_TABLE and any(buckets.values()):
        for value_class in classes:
            if buckets[value_class]:
                selected.append(buckets[value_class].pop(0))
                if len(selected) == MAX_VALUE_FIELDS_PER_TABLE:
                    break
    return selected


def _summary_expressions(field: dict, alias: str) -> list[str]:
    kind = field["type"]
    expressions = [f"COUNTIF({alias} IS NULL) AS {alias}_nulls"]
    if kind in DISTINCT_TYPES:
        expressions.append(
            f"APPROX_COUNT_DISTINCT({alias}) AS {alias}_distinct"
        )
    if kind in ORDERED_TYPES:
        expressions.extend([
            f"MIN({alias}) AS {alias}_minimum",
            f"MAX({alias}) AS {alias}_maximum",
        ])
    if kind == "STRING":
        expressions.extend([
            f"MAX(LENGTH({alias})) AS {alias}_max_length",
            f"ARRAY_AGG(DISTINCT {alias} IGNORE NULLS LIMIT {MAX_SAMPLE_VALUES}) AS {alias}_samples",
        ])
    elif kind in ("BOOLEAN", "BOOL"):
        expressions.append(
            f"ARRAY_AGG(DISTINCT {alias} IGNORE NULLS LIMIT {MAX_SAMPLE_VALUES}) AS {alias}_samples"
        )
    return expressions


def _summary_query(table: dict, fields: list[dict]) -> str:
    aliases = [(field, f"f{index}") for index, field in enumerate(fields)]
    aggregates = ["COUNT(1) AS sampled_rows"]
    for field, alias in aliases:
        aggregates.extend(_summary_expressions(field, alias))
    selected = [
        f"{_field_expression(field['segments'])} AS {alias}" for field, alias in aliases
    ]
    lines = [
        "SELECT",
        "  " + ",\n  ".join(aggregates),
        "FROM (",
        "  SELECT",
        "    " + ",\n    ".join(selected),
        f"  FROM `{table['table']}` AS source TABLESAMPLE SYSTEM ({SAMPLE_PERCENT} PERCENT)",
    ]
    predicates = []
    shards = table.get("dateShards")
    if shards:
        predicates.append(
            "_TABLE_SUFFIX BETWEEN "
            f"'{shards['startSuffix']}' AND '{shards['endSuffix']}'"
        )
    partition = _partition_predicate(table)
    if partition:
        predicates.append(partition)
    if predicates:
        lines.append("  WHERE " + " AND ".join(predicates))
    lines.extend([
        f"  LIMIT {MAX_SAMPLE_ROWS}",
        ") AS bounded_sample",
    ])
    return "\n".join(lines)


def _job_scope_error(job, expected: dict) -> str | None:
    if getattr(job, "statement_type", None) != "SELECT":
        return "value summary query was not a SELECT"
    references = getattr(job, "referenced_tables", None)
    if not references:
        return "value summary query did not report referenced tables"
    observed = set()
    for reference in references:
        project = getattr(reference, "project", None)
        dataset = getattr(reference, "dataset_id", None)
        table = getattr(reference, "table_id", None)
        if not all(isinstance(value, str) and value for value in (project, dataset, table)):
            return "value summary query reported an invalid table reference"
        observed.add(f"{project}.{dataset}.{table}")
    allowed = {expected["table"]}
    if expected.get("dateShards"):
        allowed = set(expected["dateShards"]["members"])
    if observed not in ({expected["table"]}, allowed):
        return "value summary query escaped the authorized table"
    return None


def _query_configs():
    try:
        from google.cloud import bigquery
    except Exception:
        raise ScopeDiscoveryInfrastructureError(
            "BigQuery query support is unavailable"
        ) from None
    return (
        bigquery.QueryJobConfig(
            dry_run=True,
            maximum_bytes_billed=MAX_BYTES_BILLED_PER_QUERY,
            use_query_cache=False,
        ),
        bigquery.QueryJobConfig(
            dry_run=False,
            maximum_bytes_billed=MAX_BYTES_BILLED_PER_QUERY,
            use_query_cache=False,
        ),
    )


def _dry_run_queries(bq, queries: list[tuple[dict, list[dict], str]]) -> None:
    total = 0
    for table, _fields, sql in queries:
        dry_config, _run_config = _query_configs()
        try:
            job = bq.query(sql, job_config=dry_config)
        except Exception:
            raise ScopeDiscoveryInfrastructureError(
                "value summary dry run failed"
            ) from None
        error = _job_scope_error(job, table)
        if error:
            raise ScopeDiscoveryError(error)
        processed = getattr(job, "total_bytes_processed", None)
        if isinstance(processed, bool) or not isinstance(processed, int) or processed < 0:
            raise ScopeDiscoveryError("value summary dry run omitted byte estimate")
        total += processed
        if processed > MAX_BYTES_BILLED_PER_QUERY or total > MAX_BYTES_BILLED_TOTAL:
            raise ScopeDiscoveryError("value summary exceeds byte budget")


def _row_mapping(row) -> dict:
    if isinstance(row, dict):
        return dict(row)
    items = getattr(row, "items", None)
    if callable(items):
        return dict(items())
    raise ScopeDiscoveryError("value summary returned an invalid row")


def _json_value(value):
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ScopeDiscoveryError("value summary returned a non-finite number")
        return value
    if isinstance(value, (Decimal, date, datetime, time)):
        return value.isoformat() if hasattr(value, "isoformat") else str(value)
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    raise ScopeDiscoveryError("value summary returned an unsupported value")


def _count(row: dict, key: str) -> int:
    value = row.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ScopeDiscoveryError("value summary returned an invalid count")
    return value


def _apply_row(table: dict, selected: list[dict], row: dict) -> None:
    sampled_rows = _count(row, "sampled_rows")
    table["sampledRows"] = sampled_rows
    selected_paths = {tuple(field["segments"]) for field in selected}
    for field in table["fields"]:
        value_class = field["valueClass"]
        segments = tuple(field["segments"])
        if segments not in selected_paths:
            reason = value_class if value_class in ("restricted", "repeated", "structured") else "field_budget"
            field["valueSummary"] = {
                "status": "metadata_only",
                "reason": reason,
            }
            continue
        index = next(
            i
            for i, candidate in enumerate(selected)
            if tuple(candidate["segments"]) == segments
        )
        alias = f"f{index}"
        nulls = _count(row, f"{alias}_nulls")
        if nulls > sampled_rows:
            raise ScopeDiscoveryError("value summary null count exceeds sampled rows")
        summary = {
            "status": "aggregates",
            "nullFraction": None if sampled_rows == 0 else round(nulls / sampled_rows, 6),
        }
        if field["type"] in DISTINCT_TYPES:
            summary["approxDistinct"] = _count(row, f"{alias}_distinct")
        if field["type"] in ORDERED_TYPES:
            summary["minimum"] = _json_value(row.get(f"{alias}_minimum"))
            summary["maximum"] = _json_value(row.get(f"{alias}_maximum"))
        samples = row.get(f"{alias}_samples")
        if field["type"] == "STRING":
            maximum_length = row.get(f"{alias}_max_length")
            if (
                maximum_length is not None
                and (
                    isinstance(maximum_length, bool)
                    or not isinstance(maximum_length, int)
                    or maximum_length < 0
                )
            ):
                raise ScopeDiscoveryError("value summary returned an invalid string length")
            summary["maximumLength"] = maximum_length
            if (
                summary["approxDistinct"] <= MAX_CATEGORICAL_DISTINCT
                and maximum_length is not None
                and maximum_length <= MAX_SAMPLE_CHARACTERS
            ):
                values = [] if samples is None else _json_value(samples)
                if (
                    not isinstance(values, list)
                    or len(values) > MAX_SAMPLE_VALUES
                    or any(
                        not isinstance(value, str)
                        or len(value) > MAX_SAMPLE_CHARACTERS
                        for value in values
                    )
                ):
                    raise ScopeDiscoveryError("value summary returned invalid samples")
                summary["status"] = "bounded_values"
                summary["samples"] = values
        elif field["type"] in ("BOOLEAN", "BOOL"):
            values = [] if samples is None else _json_value(samples)
            if not isinstance(values, list) or len(values) > 2 or any(not isinstance(value, bool) for value in values):
                raise ScopeDiscoveryError("value summary returned invalid boolean samples")
            summary["status"] = "bounded_values"
            summary["samples"] = values
        field["valueSummary"] = summary


def _run_queries(bq, queries: list[tuple[dict, list[dict], str]]) -> None:
    for table, fields, sql in queries:
        _dry_config, run_config = _query_configs()
        try:
            job = bq.query(sql, job_config=run_config)
            rows = list(job.result(timeout=QUERY_TIMEOUT_SECONDS, max_results=2))
        except Exception:
            raise ScopeDiscoveryInfrastructureError(
                "value summary query failed"
            ) from None
        error = _job_scope_error(job, table)
        if error:
            raise ScopeDiscoveryError(error)
        if len(rows) != 1:
            raise ScopeDiscoveryError("value summary query must return exactly one row")
        _apply_row(table, fields, _row_mapping(rows[0]))


def _catalog(snapshot: SchemaSnapshot) -> tuple[list[dict], list[tuple[dict, list[dict], str]]]:
    tables = []
    queries = []
    for metadata in snapshot.metadata()["tables"]:
        table = {
            "table": metadata["table"],
            "location": metadata["location"],
            "fields": _flatten_fields(metadata["fields"]),
        }
        for key in (
            "timePartitioning",
            "rangePartitioning",
            "clustering",
            "requirePartitionFilter",
            "dateShards",
        ):
            if key in metadata:
                table[key] = metadata[key]
        shard = _date_shard(metadata["table"])
        if shard:
            table["dateShardCandidate"] = shard
        selected = _selectable_fields(table["fields"])
        if shard:
            for field in table["fields"]:
                reason = (
                    field["valueClass"]
                    if field["valueClass"] in ("restricted", "repeated", "structured")
                    else "date_shard_candidate"
                )
                field["valueSummary"] = {
                    "status": "metadata_only",
                    "reason": reason,
                }
        elif selected:
            queries.append((table, selected, _summary_query(metadata, selected)))
        else:
            for field in table["fields"]:
                field["valueSummary"] = {
                    "status": "metadata_only",
                    "reason": field["valueClass"],
                }
        tables.append(table)
    return tables, queries


def _validated_content(snapshot: DiscoverySnapshot) -> dict:
    if not isinstance(snapshot, DiscoverySnapshot):
        raise ScopeDiscoveryError("a discovery snapshot is required")
    try:
        content = json.loads(snapshot.content_json)
        schema = content["schema"]
        metadata = schema["metadata"]
        retrieved = datetime.fromisoformat(snapshot.retrieved_at)
        canonical_metadata = json.dumps(
            metadata,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    except (KeyError, TypeError, ValueError):
        raise ScopeDiscoveryError("discovery snapshot is invalid") from None
    if (
        not isinstance(content, dict)
        or set(content) != {"version", "schema", "tables", "limits"}
        or content.get("version") != 1
        or snapshot.content_json
        != json.dumps(
            content,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        or snapshot.fingerprint != hashlib.sha256(snapshot.content_json.encode()).hexdigest()
        or schema.get("fingerprint")
        != hashlib.sha256(canonical_metadata.encode()).hexdigest()
        or retrieved.tzinfo is None
    ):
        raise ScopeDiscoveryError("discovery snapshot is invalid")
    return content


def _candidate_groups(content: dict) -> dict[str, set[str]]:
    groups: dict[str, set[str]] = {}
    for table in content["tables"]:
        candidate = table.get("dateShardCandidate") if isinstance(table, dict) else None
        if candidate is None:
            continue
        expected = _date_shard(table.get("table"))
        if candidate != expected:
            raise ScopeDiscoveryError("date-shard candidate differs from its table")
        groups.setdefault(candidate["pattern"], set()).add(table["table"])
    return groups


def date_shard_candidate_groups(
    snapshot: DiscoverySnapshot,
) -> dict[str, tuple[str, ...]]:
    """Return validated candidate members keyed by their discovered wildcard."""
    groups = _candidate_groups(_validated_content(snapshot))
    return {
        pattern: tuple(sorted(members)) for pattern, members in sorted(groups.items())
    }


def _requested_members(pattern: str, start_suffix: str, end_suffix: str) -> list[str]:
    try:
        start = datetime.strptime(start_suffix, "%Y%m%d").date()
        end = datetime.strptime(end_suffix, "%Y%m%d").date()
    except (TypeError, ValueError):
        raise ScopeDiscoveryError("date-shard range must use YYYYMMDD") from None
    if start > end:
        raise ScopeDiscoveryError("date-shard range start must not follow end")
    if (end - start).days + 1 > MAX_SHARDS:
        raise ScopeDiscoveryError("date-shard range exceeds discovery limit")
    prefix = pattern[:-1]
    members = []
    current = start
    while current <= end:
        members.append(prefix + current.strftime("%Y%m%d"))
        current += date.resolution
    return members


def _schema_snapshot(tables: list[dict], retrieved_at: str) -> SchemaSnapshot:
    metadata = json.dumps(
        {"version": 1, "tables": sorted(tables, key=lambda table: table["table"])},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    if len(tables) > MAX_TABLES or len(metadata.encode()) > MAX_METADATA_BYTES:
        raise ScopeDiscoveryError("consolidated schema exceeds discovery limits")
    return SchemaSnapshot(
        metadata,
        hashlib.sha256(metadata.encode()).hexdigest(),
        retrieved_at,
    )


def consolidate_date_shards(
    bq,
    snapshot: DiscoverySnapshot,
    ranges: dict[str, tuple[str, str]],
) -> DiscoverySnapshot:
    """Replace approved physical shard candidates with inspected wildcard tables."""
    content = _validated_content(snapshot)
    groups = _candidate_groups(content)
    if (
        not isinstance(ranges, dict)
        or not ranges
        or len(ranges) > MAX_TABLES
        or not set(ranges) <= set(groups)
    ):
        raise ScopeDiscoveryError("date-shard ranges must select discovered candidates")
    allowed_patterns = frozenset(groups)
    replacements, queries, removed = {}, [], set()
    retrieved_at = snapshot.retrieved_at
    for pattern in sorted(ranges):
        value = ranges[pattern]
        if not isinstance(value, tuple) or len(value) != 2:
            raise ScopeDiscoveryError("date-shard range must contain start and end")
        start_suffix, end_suffix = value
        requested = _requested_members(pattern, start_suffix, end_suffix)
        if not set(requested) <= groups[pattern]:
            raise ScopeDiscoveryError("date-shard range escapes discovered scope")
        try:
            inspected = inspect_date_shards(
                bq,
                pattern,
                start_suffix=start_suffix,
                end_suffix=end_suffix,
                allowed_patterns=allowed_patterns,
            )
        except SchemaInspectionInfrastructureError:
            raise ScopeDiscoveryInfrastructureError(
                "date-shard schema inspection failed"
            ) from None
        except SchemaInspectionError as error:
            raise ScopeDiscoveryError(str(error)) from None
        metadata = inspected.metadata()["tables"][0]
        if datetime.fromisoformat(inspected.retrieved_at) > datetime.fromisoformat(
            retrieved_at
        ):
            retrieved_at = inspected.retrieved_at
        if "timePartitioning" in metadata or "rangePartitioning" in metadata:
            raise ScopeDiscoveryError("partitioned date-shard groups are unsupported")
        catalog, generated_queries = _catalog(inspected)
        replacements[pattern] = (metadata, catalog[0])
        queries.extend(generated_queries)
        removed.update(groups[pattern])
    _dry_run_queries(bq, queries)
    _run_queries(bq, queries)
    schema_tables = [
        table
        for table in content["schema"]["metadata"]["tables"]
        if table["table"] not in removed
    ] + [value[0] for value in replacements.values()]
    catalog_tables = [
        table for table in content["tables"] if table["table"] not in removed
    ] + [value[1] for value in replacements.values()]
    schema_snapshot = _schema_snapshot(schema_tables, retrieved_at)
    result = {
        **content,
        "schema": {
            "fingerprint": schema_snapshot.fingerprint,
            "metadata": schema_snapshot.metadata(),
        },
        "tables": sorted(catalog_tables, key=lambda table: table["table"]),
    }
    encoded = json.dumps(
        result,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    if len(encoded.encode()) > MAX_DISCOVERY_BYTES:
        raise ScopeDiscoveryError("consolidated discovery exceeds output limit")
    return DiscoverySnapshot(
        encoded,
        hashlib.sha256(encoded.encode()).hexdigest(),
        retrieved_at,
    )


def discover_scope(bq, scope: AuthorizedScope) -> DiscoverySnapshot:
    """Inspect and summarize only tables granted by a server-owned scope."""
    if not isinstance(scope, AuthorizedScope):
        raise ScopeDiscoveryError("a validated authorized scope is required")
    table_ids = _authorized_table_ids(bq, scope)
    try:
        schema = inspect_schema(bq, table_ids, allowed_tables=frozenset(table_ids))
    except SchemaInspectionInfrastructureError:
        raise ScopeDiscoveryInfrastructureError("schema discovery failed") from None
    except SchemaInspectionError as error:
        raise ScopeDiscoveryError(str(error)) from None
    tables, queries = _catalog(schema)
    _dry_run_queries(bq, queries)
    _run_queries(bq, queries)
    content = {
        "version": 1,
        "schema": {
            "fingerprint": schema.fingerprint,
            "metadata": schema.metadata(),
        },
        "tables": tables,
        "limits": {
            "maximumTables": MAX_TABLES,
            "maximumFields": MAX_FIELDS,
            "maximumValueFieldsPerTable": MAX_VALUE_FIELDS_PER_TABLE,
            "maximumSampleRows": MAX_SAMPLE_ROWS,
            "samplePercent": SAMPLE_PERCENT,
            "maximumSampleValues": MAX_SAMPLE_VALUES,
            "maximumCategoricalDistinct": MAX_CATEGORICAL_DISTINCT,
            "maximumSampleCharacters": MAX_SAMPLE_CHARACTERS,
            "maximumBytesBilledPerQuery": MAX_BYTES_BILLED_PER_QUERY,
            "maximumBytesBilledTotal": MAX_BYTES_BILLED_TOTAL,
        },
    }
    encoded = json.dumps(
        content,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    if len(encoded.encode("utf-8")) > MAX_DISCOVERY_BYTES:
        raise ScopeDiscoveryError("discovery snapshot exceeds output limit")
    return DiscoverySnapshot(
        content_json=encoded,
        fingerprint=hashlib.sha256(encoded.encode("utf-8")).hexdigest(),
        retrieved_at=schema.retrieved_at,
    )
