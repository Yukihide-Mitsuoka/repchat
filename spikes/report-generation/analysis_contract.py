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


def _field(tables: dict[str, dict], reference: dict, label: str) -> tuple[str, str, dict]:
    if not isinstance(reference, dict) or set(reference) != {"table", "field"}:
        raise AnalysisContractError(f"{label} must contain only table and field")
    table = _nonempty(reference["table"], f"{label}.table")
    path = _nonempty(reference["field"], f"{label}.field")
    if table not in tables:
        raise AnalysisContractError(f"{label} references a table outside the schema snapshot")
    fields = tables[table]["fields"]
    current = None
    for segment in path.split("."):
        current = next((field for field in fields if field["name"] == segment), None)
        if current is None:
            raise AnalysisContractError(f"{label} references a field outside the schema snapshot")
        fields = current.get("fields", [])
    return table, path, current


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
    if not isinstance(business_time, dict) or set(business_time) != {"table", "field"}:
        raise AnalysisContractError(
            "period.business_time must contain only table and field"
        )
    table = _nonempty(business_time["table"], "period.business_time.table")
    path = _nonempty(business_time["field"], "period.business_time.field")
    if table not in tables:
        raise AnalysisContractError(
            "period.business_time references a table outside the schema snapshot"
        )
    if path == "_TABLE_SUFFIX" and table in shard_ranges:
        field = {"type": "DATE", "mode": "REQUIRED"}
    else:
        _, _, field = _field(tables, business_time, "period.business_time")
    if field["type"] not in TIME_TYPES or field["mode"] == "REPEATED":
        raise AnalysisContractError(
            "period.business_time must reference one DATE, DATETIME, TIMESTAMP, or date-shard suffix field"
        )
    timezone = _nonempty(raw["timezone"], "period.timezone")
    try:
        ZoneInfo(timezone)
    except ZoneInfoNotFoundError:
        raise AnalysisContractError("period.timezone is not an IANA timezone") from None
    result = {
        "business_time": {"table": table, "field": path},
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
        if not isinstance(reference, dict) or set(reference) != {"table", "field"}:
            raise AnalysisContractError("each period partition must contain only table and field")
        ptable = _nonempty(reference["table"], "period.partitions.table")
        ppath = _nonempty(reference["field"], "period.partitions.field")
        if ptable not in tables:
            raise AnalysisContractError("period partition references a table outside the schema snapshot")
        if ptable in partitioned_tables:
            raise AnalysisContractError("period has duplicate partition constraints for one table")
        partition = tables[ptable].get("timePartitioning")
        if ptable in shard_ranges:
            matches = ppath == "_TABLE_SUFFIX" and shard_ranges[ptable] == scan_range
        elif partition and not partition.get("field"):
            matches = ppath in ("_PARTITIONDATE", "_PARTITIONTIME")
        else:
            _, _, pfield = _field(tables, reference, "period.partitions")
            matches = bool(partition and partition.get("field") == ppath and pfield["type"] in TIME_TYPES)
        if not matches:
            raise AnalysisContractError("period partition does not match table time partitioning")
        result["partitions"].append({"table": ptable, "field": ppath})
        partitioned_tables.add(ptable)
    for name, metadata in tables.items():
        if (
            metadata.get("requirePartitionFilter") or name in shard_ranges
        ) and name not in partitioned_tables:
            raise AnalysisContractError(f"period partition is required for partitioned table {name}")
    return result


def _semantics(raw: dict, tables: set[str]) -> dict:
    if not isinstance(raw, dict) or set(raw) != {"grain", "metrics", "dimensions", "relationships"}:
        raise AnalysisContractError("semantics must contain grain, metrics, dimensions, and relationships")
    result = {}
    terms = set()
    for category in ("grain", "metrics", "dimensions"):
        definitions = raw[category]
        if not isinstance(definitions, dict):
            raise AnalysisContractError(f"semantics.{category} must be an object")
        result[category] = {}
        for name, definition in definitions.items():
            clean_name = _nonempty(name, f"semantics.{category} name")
            if clean_name.casefold() in terms:
                raise AnalysisContractError("semantic names and aliases must be unique")
            terms.add(clean_name.casefold())
            if not isinstance(definition, dict) or "expr" not in definition:
                raise AnalysisContractError(f"semantics.{category}.{clean_name} requires expr")
            item = {"expr": _nonempty(definition["expr"], f"semantics.{category}.{clean_name}.expr")}
            for key in ("description", "unit", "note", "filter"):
                if key in definition:
                    item[key] = _nonempty(definition[key], f"semantics.{category}.{clean_name}.{key}")
            aliases = definition.get("aliases", [])
            if not isinstance(aliases, list) or any(not isinstance(alias, str) or not alias.strip() for alias in aliases):
                raise AnalysisContractError(f"semantics.{category}.{clean_name}.aliases must be strings")
            if aliases:
                clean_aliases = [alias.strip() for alias in aliases]
                if any(alias.casefold() in terms for alias in clean_aliases) or len({alias.casefold() for alias in clean_aliases}) != len(clean_aliases):
                    raise AnalysisContractError("semantic names and aliases must be unique")
                terms.update(alias.casefold() for alias in clean_aliases)
                item["aliases"] = clean_aliases
            if set(definition) - {"expr", "description", "unit", "note", "filter", "aliases"}:
                raise AnalysisContractError(f"semantics.{category}.{clean_name} has unsupported fields")
            result[category][clean_name] = item
    relationships = raw["relationships"]
    if not isinstance(relationships, list):
        raise AnalysisContractError("semantics.relationships must be a list")
    result["relationships"] = []
    required = {"left_table", "right_table", "condition", "cardinality"}
    cardinalities = {"one_to_one", "one_to_many", "many_to_one", "many_to_many"}
    for relationship in relationships:
        if not isinstance(relationship, dict) or set(relationship) != required:
            raise AnalysisContractError("each relationship must declare two tables, condition, and cardinality")
        item = {key: _nonempty(relationship[key], f"relationship.{key}") for key in required}
        if {item["left_table"], item["right_table"]} - tables:
            raise AnalysisContractError("relationship references a table outside the schema snapshot")
        if item["cardinality"] not in cardinalities:
            raise AnalysisContractError("relationship cardinality is unsupported")
        result["relationships"].append(item)
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
        table_names = {table["table"] for table in schema["tables"]}
        content = {
            "version": 1,
            "schema": {"fingerprint": snapshot.fingerprint, "retrieved_at": snapshot.retrieved_at, "metadata": schema},
            "semantics": _semantics(semantics, table_names),
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
