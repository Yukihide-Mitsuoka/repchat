"""Compile inspected schema and explicit semantics into one immutable contract."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from bigquery_schema_snapshot import SchemaSnapshot


MAX_CONTRACT_BYTES = 300_000
MAX_DATE_SHARDS = 100
TIME_TYPES = frozenset({"DATE", "DATETIME", "TIMESTAMP"})
NUMERIC_TYPES = frozenset({
    "INTEGER",
    "INT64",
    "FLOAT",
    "FLOAT64",
    "NUMERIC",
    "BIGNUMERIC",
})
SCALAR_TYPES = frozenset({
    "STRING",
    "BYTES",
    "INTEGER",
    "INT64",
    "FLOAT",
    "FLOAT64",
    "BOOLEAN",
    "BOOL",
    "TIMESTAMP",
    "DATE",
    "TIME",
    "DATETIME",
    "NUMERIC",
    "BIGNUMERIC",
    "GEOGRAPHY",
})
AGGREGATIONS = frozenset({"count", "count_distinct", "sum", "avg", "min", "max"})
DEFINITION_CATEGORIES = ("grain", "identifiers", "dimensions", "measures", "metrics")
MAX_SEMANTIC_CANDIDATES = 200
DATE_SHARD_KEYS = frozenset({
    "suffixFormat", "startSuffix", "endSuffix", "members",
})


class AnalysisContractError(ValueError):
    """Explicit analysis inputs are incomplete or inconsistent with the schema."""


@dataclass(frozen=True)
class AnalysisContract:
    """Canonical analysis input shared by planning and SQL generation."""

    content_json: str
    fingerprint: str

    def content(self) -> dict:
        return json.loads(self.content_json)


def fingerprint_contract_content(content: dict) -> str:
    """Identify contract behavior while retaining schema observation time for audit."""
    identity = json.loads(json.dumps(content, ensure_ascii=False))
    schema = identity.get("schema")
    if isinstance(schema, dict):
        schema.pop("retrieved_at", None)
    canonical = json.dumps(
        identity, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _nonempty(value, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AnalysisContractError(f"{label} must be a non-empty string")
    return value.strip()


def _date(value, label: str) -> str:
    value = _nonempty(value, label)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise AnalysisContractError(f"{label} must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise AnalysisContractError(f"{label} must use YYYY-MM-DD") from None


def _range(raw: dict, label: str) -> dict:
    if not isinstance(raw, dict) or set(raw) != {"start", "end"}:
        raise AnalysisContractError(f"{label} must contain only start and end")
    start, end = _date(raw["start"], f"{label}.start"), _date(raw["end"], f"{label}.end")
    if start > end:
        raise AnalysisContractError(f"{label}.start must not follow end")
    return {"start": start, "end": end}


def _date_shards(table: dict) -> tuple[str, str]:
    raw = table.get("dateShards")
    if not isinstance(raw, dict) or set(raw) != DATE_SHARD_KEYS:
        raise AnalysisContractError("date-shard metadata is invalid")
    if "timePartitioning" in table or "rangePartitioning" in table:
        raise AnalysisContractError("partitioned date shards are unsupported")
    if raw.get("suffixFormat") != "YYYYMMDD":
        raise AnalysisContractError("date-shard suffix format is unsupported")
    try:
        start = datetime.strptime(raw["startSuffix"], "%Y%m%d").date()
        end = datetime.strptime(raw["endSuffix"], "%Y%m%d").date()
    except (TypeError, ValueError):
        raise AnalysisContractError("date-shard suffix range is invalid") from None
    if start > end:
        raise AnalysisContractError("date-shard suffix range is invalid")
    pattern = table.get("table")
    members = raw.get("members")
    if not isinstance(pattern, str) or not pattern.endswith("*") or not isinstance(members, list):
        raise AnalysisContractError("date-shard members are invalid")
    expected = []
    current = start
    while current <= end:
        expected.append(pattern[:-1] + current.strftime("%Y%m%d"))
        current += timedelta(days=1)
    if len(expected) > MAX_DATE_SHARDS or members != expected:
        raise AnalysisContractError("date-shard members are invalid")
    return start.isoformat(), end.isoformat()


def _reference_parts(reference: dict, label: str) -> tuple[str, list[str], dict]:
    if not isinstance(reference, dict):
        raise AnalysisContractError(f"{label} must be a field reference")
    keys = set(reference)
    if keys not in ({"table", "field"}, {"table", "path"}):
        raise AnalysisContractError(f"{label} must contain table and either field or path")
    table = _nonempty(reference["table"], f"{label}.table")
    if keys == {"table", "field"}:
        path = _nonempty(reference["field"], f"{label}.field")
        segments = path.split(".")
        canonical = {"table": table, "field": path}
    elif set(reference) == {"table", "path"}:
        raw = reference["path"]
        if not isinstance(raw, list) or not raw:
            raise AnalysisContractError(f"{label}.path must be a non-empty list")
        segments = [_nonempty(value, f"{label}.path") for value in raw]
        canonical = {"table": table, "path": segments}
    return table, segments, canonical


def _field(
    tables: dict[str, dict], reference: dict, label: str
) -> tuple[str, list[str], dict, dict, bool]:
    table, segments, canonical = _reference_parts(reference, label)
    if table not in tables:
        raise AnalysisContractError(f"{label} references a table outside the schema snapshot")
    fields = tables[table]["fields"]
    current = None
    repeated = False
    for segment in segments:
        current = next((field for field in fields if field["name"] == segment), None)
        if current is None:
            raise AnalysisContractError(f"{label} references a field outside the schema snapshot")
        repeated = repeated or current["mode"] == "REPEATED"
        fields = current.get("fields", [])
    return table, segments, current, canonical, repeated


def expression_for_field(reference: dict, aggregation: str | None = None) -> str:
    """Render one structured field reference without accepting arbitrary SQL."""
    table, segments, _canonical = _reference_parts(reference, "semantic field")
    quoted = "`" + table.replace("\\", "\\\\").replace("`", "\\`") + "`"
    quoted += "." + ".".join(
        "`" + segment.replace("\\", "\\\\").replace("`", "\\`") + "`"
        for segment in segments
    )
    if aggregation is None:
        return quoted
    if not isinstance(aggregation, str) or aggregation not in AGGREGATIONS:
        raise AnalysisContractError("semantic aggregation is unsupported")
    function = "COUNT" if aggregation == "count_distinct" else aggregation.upper()
    distinct = "DISTINCT " if aggregation == "count_distinct" else ""
    return f"{function}({distinct}{quoted})"


def _period(schema: dict, raw: dict) -> dict:
    required = {"business_time", "timezone", "range", "partitions"}
    if not isinstance(raw, dict) or not required <= set(raw) or set(raw) - (required | {"comparison"}):
        raise AnalysisContractError("period has unsupported or missing fields")
    tables = {table["table"]: table for table in schema["tables"]}
    shard_ranges = {
        name: _date_shards(metadata)
        for name, metadata in tables.items()
        if "dateShards" in metadata
    }
    business_time = raw["business_time"]
    table, segments, canonical = _reference_parts(
        business_time, "period.business_time"
    )
    if table not in tables:
        raise AnalysisContractError("period.business_time references a table outside the schema snapshot")
    if canonical.get("field") == "_TABLE_SUFFIX" and table in shard_ranges:
        field = {"type": "DATE", "mode": "REQUIRED"}
        repeated = False
    else:
        _, segments, field, canonical, repeated = _field(
            tables, business_time, "period.business_time"
        )
    if field["type"] not in TIME_TYPES or repeated:
        raise AnalysisContractError(
            "period.business_time must reference one DATE, DATETIME, TIMESTAMP, or date-shard suffix field"
        )
    timezone = _nonempty(raw["timezone"], "period.timezone")
    try:
        ZoneInfo(timezone)
    except ZoneInfoNotFoundError:
        raise AnalysisContractError("period.timezone is not an IANA timezone") from None
    result = {
        "business_time": canonical,
        "timezone": timezone,
        "range": _range(raw["range"], "period.range"),
    }
    if "comparison" in raw:
        result["comparison"] = _range(raw["comparison"], "period.comparison")
    ranges = [result["range"]]
    if "comparison" in result:
        ranges.append(result["comparison"])
    scan_range = (
        min(item["start"] for item in ranges),
        max(item["end"] for item in ranges),
    )
    partitions = raw["partitions"]
    if not isinstance(partitions, list):
        raise AnalysisContractError("period.partitions must be a list")
    result["partitions"] = []
    partitioned_tables = set()
    for reference in partitions:
        ptable, psegments, pcanonical = _reference_parts(
            reference, "period.partitions"
        )
        if ptable not in tables:
            raise AnalysisContractError("period partition references a table outside the schema snapshot")
        if ptable in partitioned_tables:
            raise AnalysisContractError("period has duplicate partition constraints for one table")
        partition = tables[ptable].get("timePartitioning")
        if ptable in shard_ranges:
            matches = pcanonical.get("field") == "_TABLE_SUFFIX" and shard_ranges[ptable] == scan_range
        elif partition and not partition.get("field"):
            matches = pcanonical.get("field") in ("_PARTITIONDATE", "_PARTITIONTIME")
        else:
            _, psegments, pfield, pcanonical, repeated = _field(
                tables, reference, "period.partitions"
            )
            matches = bool(
                partition
                and len(psegments) == 1
                and partition.get("field") == psegments[0]
                and pfield["type"] in TIME_TYPES
                and not repeated
            )
        if not matches:
            raise AnalysisContractError("period partition does not match table time partitioning")
        result["partitions"].append(pcanonical)
        partitioned_tables.add(ptable)
    for name, metadata in tables.items():
        if (
            metadata.get("requirePartitionFilter") or name in shard_ranges
        ) and name not in partitioned_tables:
            raise AnalysisContractError(f"period partition is required for partitioned table {name}")
    return result


def _definition(
    category: str, name: str, definition: dict, tables: dict[str, dict]
) -> dict:
    if not isinstance(definition, dict) or "expr" not in definition:
        raise AnalysisContractError(f"semantics.{category}.{name} requires expr")
    item = {"expr": _nonempty(definition["expr"], f"semantics.{category}.{name}.expr")}
    reference = definition.get("field")
    aggregation = definition.get("aggregation")
    if reference is not None:
        _table, _segments, field, canonical, repeated = _field(
            tables, reference, f"semantics.{category}.{name}.field"
        )
        if repeated or field["type"] not in SCALAR_TYPES:
            raise AnalysisContractError("semantic definitions require a non-repeated scalar field")
        if category in ("grain", "identifiers", "dimensions") and aggregation is not None:
            raise AnalysisContractError(f"semantics.{category} cannot aggregate a field")
        if category == "measures" and field["type"] not in NUMERIC_TYPES:
            raise AnalysisContractError("semantic measures require numeric fields")
        if category == "metrics":
            if not isinstance(aggregation, str) or aggregation not in AGGREGATIONS:
                raise AnalysisContractError("semantic metrics require a supported aggregation")
            if aggregation in ("sum", "avg") and field["type"] not in NUMERIC_TYPES:
                raise AnalysisContractError("sum and avg metrics require numeric fields")
            if aggregation in ("min", "max") and field["type"] not in NUMERIC_TYPES | TIME_TYPES:
                raise AnalysisContractError("min and max metrics require numeric or temporal fields")
        elif aggregation is not None:
            raise AnalysisContractError(f"semantics.{category} cannot aggregate a field")
        if item["expr"] != expression_for_field(canonical, aggregation):
            raise AnalysisContractError("semantic expression differs from its structured field")
        if "filter" in definition:
            raise AnalysisContractError("structured semantic definitions cannot contain SQL filters")
        item["field"] = canonical
        if aggregation is not None:
            item["aggregation"] = aggregation
    elif category in ("identifiers", "measures") or aggregation is not None:
        raise AnalysisContractError(f"semantics.{category}.{name} requires a structured field")
    for key in ("description", "unit", "note", "filter"):
        if key in definition:
            item[key] = _nonempty(definition[key], f"semantics.{category}.{name}.{key}")
    aliases = definition.get("aliases", [])
    if not isinstance(aliases, list) or any(
        not isinstance(alias, str) or not alias.strip() for alias in aliases
    ):
        raise AnalysisContractError(f"semantics.{category}.{name}.aliases must be strings")
    if aliases:
        item["aliases"] = [alias.strip() for alias in aliases]
    allowed = {"expr", "field", "aggregation", "description", "unit", "note", "filter", "aliases"}
    if set(definition) - allowed:
        raise AnalysisContractError(f"semantics.{category}.{name} has unsupported fields")
    return item


def _candidate_fields(raw: dict, key: str, tables: dict[str, dict]) -> list[dict]:
    candidates = raw.get(key, [])
    if not isinstance(candidates, list) or len(candidates) > MAX_SEMANTIC_CANDIDATES:
        raise AnalysisContractError(f"semantics.{key} must be a bounded list")
    result = []
    for candidate in candidates:
        expected = {"field", "confidence"} if key == "time_candidates" else {"field", "repeated"}
        if not isinstance(candidate, dict) or set(candidate) != expected:
            raise AnalysisContractError(f"semantics.{key} contains an invalid candidate")
        _table, segments, field, canonical, repeated = _field(
            tables, candidate["field"], f"semantics.{key}.field"
        )
        if key == "time_candidates":
            if field["type"] not in TIME_TYPES or repeated:
                raise AnalysisContractError("time candidates require non-repeated temporal fields")
            confidence = candidate["confidence"]
            if confidence not in ("high", "medium", "low"):
                raise AnalysisContractError("time candidate confidence is unsupported")
            result.append({"field": canonical, "confidence": confidence})
        else:
            if len(segments) < 2 and not repeated:
                raise AnalysisContractError("nested path candidates must be nested or repeated")
            if candidate["repeated"] is not repeated:
                raise AnalysisContractError("nested path repetition differs from schema metadata")
            result.append({"field": canonical, "repeated": repeated})
    return result


def _relationships(raw: list, tables: dict[str, dict]) -> list[dict]:
    if not isinstance(raw, list) or len(raw) > MAX_SEMANTIC_CANDIDATES:
        raise AnalysisContractError("semantics.relationships must be a bounded list")
    result = []
    cardinalities = {"one_to_one", "one_to_many", "many_to_one", "many_to_many"}
    for relationship in raw:
        if not isinstance(relationship, dict):
            raise AnalysisContractError("each relationship must be an object")
        if set(relationship) == {"left_table", "right_table", "condition", "cardinality"}:
            item = {key: _nonempty(relationship[key], f"relationship.{key}") for key in relationship}
            if {item["left_table"], item["right_table"]} - set(tables):
                raise AnalysisContractError("relationship references a table outside the schema snapshot")
        elif set(relationship) == {"left_field", "right_field", "condition", "cardinality"}:
            left = _field(tables, relationship["left_field"], "relationship.left_field")
            right = _field(tables, relationship["right_field"], "relationship.right_field")
            if left[4] or right[4] or left[2]["type"] not in SCALAR_TYPES or right[2]["type"] not in SCALAR_TYPES:
                raise AnalysisContractError("relationship fields must be non-repeated scalars")
            left_type, right_type = left[2]["type"], right[2]["type"]
            if left_type != right_type and not {left_type, right_type} <= NUMERIC_TYPES:
                raise AnalysisContractError("relationship fields have incompatible types")
            condition = _nonempty(relationship["condition"], "relationship.condition")
            expected = f"{expression_for_field(left[3])} = {expression_for_field(right[3])}"
            if condition != expected:
                raise AnalysisContractError("relationship condition differs from its structured fields")
            item = {
                "left_field": left[3],
                "right_field": right[3],
                "condition": condition,
                "cardinality": _nonempty(
                    relationship["cardinality"], "relationship.cardinality"
                ),
            }
        else:
            raise AnalysisContractError("each relationship has unsupported fields")
        if item["cardinality"] not in cardinalities:
            raise AnalysisContractError("relationship cardinality is unsupported")
        result.append(item)
    return result


def _semantics(raw: dict, schema: dict) -> dict:
    required = {"grain", "metrics", "dimensions", "relationships"}
    optional = {"identifiers", "measures", "time_candidates", "nested_paths"}
    if not isinstance(raw, dict) or not required <= set(raw) or set(raw) - required - optional:
        raise AnalysisContractError("semantics has unsupported or missing categories")
    tables = {table["table"]: table for table in schema["tables"]}
    result = {}
    terms = set()
    for category in DEFINITION_CATEGORIES:
        if category not in raw:
            continue
        definitions = raw.get(category, {})
        if not isinstance(definitions, dict):
            raise AnalysisContractError(f"semantics.{category} must be an object")
        result[category] = {}
        for name, definition in definitions.items():
            clean_name = _nonempty(name, f"semantics.{category} name")
            if clean_name.casefold() in terms:
                raise AnalysisContractError("semantic names and aliases must be unique")
            terms.add(clean_name.casefold())
            item = _definition(category, clean_name, definition, tables)
            aliases = item.get("aliases", [])
            if aliases:
                if any(alias.casefold() in terms for alias in aliases) or len({alias.casefold() for alias in aliases}) != len(aliases):
                    raise AnalysisContractError("semantic names and aliases must be unique")
                terms.update(alias.casefold() for alias in aliases)
            result[category][clean_name] = item
    for key in ("time_candidates", "nested_paths"):
        if key in raw:
            result[key] = _candidate_fields(raw, key, tables)
    result["relationships"] = _relationships(raw["relationships"], tables)
    return result


def _limits(raw: dict) -> dict:
    if not isinstance(raw, dict) or set(raw) != {"maximum_bytes_billed", "maximum_result_rows"}:
        raise AnalysisContractError("limits must contain maximum_bytes_billed and maximum_result_rows")
    if any(isinstance(raw[key], bool) or not isinstance(raw[key], int) or raw[key] <= 0 for key in raw):
        raise AnalysisContractError("execution limits must be positive integers")
    return dict(raw)


def compile_contract(snapshot: SchemaSnapshot, semantics: dict, period: dict, limits: dict) -> AnalysisContract:
    """Validate explicit inputs and freeze their canonical representation."""
    try:
        schema = snapshot.metadata()
        canonical_schema = json.dumps(schema, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (AttributeError, TypeError, ValueError):
        raise AnalysisContractError("schema snapshot is invalid") from None
    expected = hashlib.sha256(canonical_schema.encode("utf-8")).hexdigest()
    if snapshot.fingerprint != expected or schema.get("version") != 1 or not schema.get("tables"):
        raise AnalysisContractError("schema snapshot fingerprint or version is invalid")
    try:
        retrieved_at = datetime.fromisoformat(snapshot.retrieved_at)
    except (TypeError, ValueError):
        raise AnalysisContractError("schema snapshot retrieval time is invalid") from None
    if retrieved_at.tzinfo is None:
        raise AnalysisContractError("schema snapshot retrieval time must include a timezone")
    try:
        content = {
            "version": 1,
            "schema": {"fingerprint": snapshot.fingerprint, "retrieved_at": snapshot.retrieved_at, "metadata": schema},
            "semantics": _semantics(semantics, schema),
            "period": _period(schema, period),
            "limits": _limits(limits),
        }
    except AnalysisContractError:
        raise
    except (KeyError, TypeError):
        raise AnalysisContractError("schema snapshot structure is invalid") from None
    encoded = json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_CONTRACT_BYTES:
        raise AnalysisContractError("analysis contract exceeds input limit")
    return AnalysisContract(encoded, fingerprint_contract_content(content))
