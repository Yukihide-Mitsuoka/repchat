"""Normalize token-only generated candidates into one validated analysis contract."""

from __future__ import annotations

import hashlib
import json
from datetime import date

from analysis_contract import (
    AGGREGATIONS,
    NUMERIC_TYPES,
    AnalysisContract,
    AnalysisContractError,
    compile_contract,
    expression_for_field,
)
from analysis_contract_compiler import CompilerInput, ContractCompilerError
from bigquery_schema_snapshot import MAX_TABLES, SchemaSnapshot


MAX_ROLE_ITEMS = 50
MAX_RELATIONSHIPS = 100
MAX_EXECUTION_BYTES = 20 * 1024**3
MAX_RESULT_ROWS = 1000
CONTRACT_TIMEZONE = "UTC"
ROLE_KEYS = ("grain", "identifiers", "dimensions", "measures")
MODEL_KEYS = {
    "tables",
    "business_time",
    "time_candidates",
    *ROLE_KEYS,
    "metrics",
    "relationships",
    "period",
}
CARDINALITIES = {"one_to_one", "one_to_many", "many_to_one", "many_to_many"}


def _token(value, values: dict, label: str) -> str:
    if not isinstance(value, str) or value not in values:
        raise ContractCompilerError(f"generated {label} token is invalid")
    return value


def _text(value, label: str, maximum: int, *, empty: bool = False) -> str:
    if (
        not isinstance(value, str)
        or (not empty and not value.strip())
        or len(value) > maximum
        or any(ord(character) < 32 for character in value)
    ):
        raise ContractCompilerError(f"generated {label} is invalid")
    return value.strip()


def _aliases(value, label: str) -> list[str]:
    if not isinstance(value, list) or len(value) > 10:
        raise ContractCompilerError(f"generated {label} aliases are invalid")
    aliases = [_text(alias, f"{label} alias", 80) for alias in value]
    return sorted(aliases, key=str.casefold)


def _role_definitions(
    raw: dict, key: str, prepared: CompilerInput, selected: set[str]
) -> dict:
    values = raw.get(key)
    if not isinstance(values, list) or len(values) > MAX_ROLE_ITEMS:
        raise ContractCompilerError(f"generated {key} candidates are invalid")
    result = {}
    for value in values:
        if not isinstance(value, dict) or set(value) != {"name", "field", "aliases"}:
            raise ContractCompilerError(f"generated {key} candidate is invalid")
        name = _text(value["name"], key, 80)
        field_token = _token(value["field"], prepared.fields, key)
        field = prepared.fields[field_token]
        if not field["role_selectable"] or field["table_token"] not in selected:
            raise ContractCompilerError(f"generated {key} field is not selectable")
        reference = field["reference"]
        definition = {"field": reference, "expr": expression_for_field(reference)}
        aliases = _aliases(value["aliases"], key)
        if aliases:
            definition["aliases"] = aliases
        if name in result:
            raise ContractCompilerError(f"generated {key} names are duplicated")
        result[name] = definition
    return result


def _metric_definitions(
    raw: dict, prepared: CompilerInput, selected: set[str]
) -> dict:
    values = raw.get("metrics")
    if not isinstance(values, list) or not 1 <= len(values) <= MAX_ROLE_ITEMS:
        raise ContractCompilerError("generated metrics are invalid")
    result = {}
    for value in values:
        required = {"name", "field", "aliases", "aggregation", "unit"}
        if not isinstance(value, dict) or set(value) != required:
            raise ContractCompilerError("generated metric candidate is invalid")
        name = _text(value["name"], "metric", 80)
        field_token = _token(value["field"], prepared.fields, "metric")
        field = prepared.fields[field_token]
        aggregation = value["aggregation"]
        if (
            not field["role_selectable"]
            or field["table_token"] not in selected
            or not isinstance(aggregation, str)
            or aggregation not in AGGREGATIONS
            or aggregation in ("sum", "avg")
            and field["type"] not in NUMERIC_TYPES
        ):
            raise ContractCompilerError("generated metric field or aggregation is invalid")
        reference = field["reference"]
        definition = {
            "field": reference,
            "aggregation": aggregation,
            "expr": expression_for_field(reference, aggregation),
        }
        aliases = _aliases(value["aliases"], "metric")
        if aliases:
            definition["aliases"] = aliases
        unit = _text(value["unit"], "metric unit", 40, empty=True)
        if unit:
            definition["unit"] = unit
        if name in result:
            raise ContractCompilerError("generated metric names are duplicated")
        result[name] = definition
    return result


def _time_candidates(
    raw: dict, prepared: CompilerInput, selected: set[str]
) -> tuple[str, list[dict]]:
    business = _token(raw.get("business_time"), prepared.fields, "business time")
    values = raw.get("time_candidates")
    if not isinstance(values, list) or not 1 <= len(values) <= MAX_ROLE_ITEMS:
        raise ContractCompilerError("generated time candidates are invalid")
    result, tokens = [], set()
    for value in values:
        if not isinstance(value, dict) or set(value) != {"field", "confidence"}:
            raise ContractCompilerError("generated time candidate is invalid")
        token = _token(value["field"], prepared.fields, "time")
        field = prepared.fields[token]
        if (
            token in tokens
            or field["value_class"] != "temporal"
            or field["table_token"] not in selected
            or not isinstance(value["confidence"], str)
            or value["confidence"] not in ("high", "medium", "low")
        ):
            raise ContractCompilerError("generated time candidate conflicts with discovery")
        tokens.add(token)
        result.append({"field": field["reference"], "confidence": value["confidence"]})
    if business not in tokens:
        raise ContractCompilerError("business time must be one generated time candidate")
    result.sort(
        key=lambda item: (
            item["field"]["table"],
            item["field"].get("path", [item["field"].get("field", "")]),
        )
    )
    return business, result


def _relationships(
    raw: dict, prepared: CompilerInput, selected: set[str]
) -> list[dict]:
    values = raw.get("relationships")
    if not isinstance(values, list) or len(values) > MAX_RELATIONSHIPS:
        raise ContractCompilerError("generated relationships are invalid")
    result = []
    for value in values:
        if not isinstance(value, dict) or set(value) != {
            "left_field",
            "right_field",
            "cardinality",
        }:
            raise ContractCompilerError("generated relationship is invalid")
        left_token = _token(value["left_field"], prepared.fields, "relationship")
        right_token = _token(value["right_field"], prepared.fields, "relationship")
        left, right = prepared.fields[left_token], prepared.fields[right_token]
        if (
            not left["role_selectable"]
            or not right["role_selectable"]
            or left["table_token"] == right["table_token"]
            or {left["table_token"], right["table_token"]} - selected
            or not isinstance(value["cardinality"], str)
            or value["cardinality"] not in CARDINALITIES
        ):
            raise ContractCompilerError("generated relationship fields are invalid")
        condition = (
            f"{expression_for_field(left['reference'])} = "
            f"{expression_for_field(right['reference'])}"
        )
        result.append(
            {
                "left_field": left["reference"],
                "right_field": right["reference"],
                "condition": condition,
                "cardinality": value["cardinality"],
            }
        )
    return sorted(
        result,
        key=lambda item: (
            item["left_field"]["table"],
            item["left_field"]["path"],
            item["right_field"]["table"],
            item["right_field"]["path"],
        ),
    )


def _period(raw: dict, prepared: CompilerInput, schema: dict, business: dict) -> dict:
    keys = {
        "start",
        "end",
        "comparison_enabled",
        "comparison_start",
        "comparison_end",
    }
    if not isinstance(raw, dict) or set(raw) != keys:
        raise ContractCompilerError("generated period is invalid")
    for key in keys - {"comparison_enabled"}:
        _text(raw[key], f"period {key}", 10, empty=True)
    period = {
        "business_time": business,
        "timezone": CONTRACT_TIMEZONE,
        "range": {"start": raw["start"], "end": raw["end"]},
        "partitions": [],
    }
    if raw["comparison_enabled"] is True:
        period["comparison"] = {
            "start": raw["comparison_start"],
            "end": raw["comparison_end"],
        }
    elif (
        raw["comparison_enabled"] is not False
        or raw["comparison_start"] != ""
        or raw["comparison_end"] != ""
    ):
        raise ContractCompilerError("disabled comparison period must be empty")
    try:
        ranges = [period["range"]]
        if "comparison" in period:
            ranges.append(period["comparison"])
        if any(
            date.fromisoformat(value[key]) > prepared.as_of
            for value in ranges
            for key in ("start", "end")
        ):
            raise ContractCompilerError("generated period extends beyond as_of")
    except ValueError:
        raise ContractCompilerError("generated period must use ISO dates") from None
    for table in schema["tables"]:
        partition = table.get("timePartitioning")
        if partition is not None and not isinstance(partition, dict):
            raise ContractCompilerError("selected table partition metadata is invalid")
        if table.get("dateShards"):
            period["partitions"].append(
                {"table": table["table"], "field": "_TABLE_SUFFIX"}
            )
        elif partition:
            field = partition.get("field")
            period["partitions"].append(
                {"table": table["table"], "path": [field]}
                if field
                else {"table": table["table"], "field": "_PARTITIONDATE"}
            )
        elif table.get("requirePartitionFilter"):
            raise ContractCompilerError(
                "selected table requires an unsupported non-time partition filter"
            )
    return period


def _date_shard_tokens(prepared: CompilerInput) -> set[str]:
    try:
        catalog = json.loads(prepared.catalog_json)
        return {
            table["token"]
            for table in catalog["tables"]
            if "dateShardCandidate" in table
        }
    except (KeyError, TypeError, ValueError):
        raise ContractCompilerError("compiler catalog is invalid") from None


def normalize_contract_response(raw: dict, prepared: CompilerInput) -> AnalysisContract:
    """Resolve model tokens and compile them through deterministic validation."""
    if (
        not isinstance(prepared, CompilerInput)
        or not isinstance(raw, dict)
        or set(raw) != MODEL_KEYS
    ):
        raise ContractCompilerError("generated contract response has unsupported fields")
    raw_tables = raw.get("tables")
    if not isinstance(raw_tables, list) or not 1 <= len(raw_tables) <= MAX_TABLES:
        raise ContractCompilerError("generated table selection is invalid")
    selected_list = [_token(value, prepared.tables, "table") for value in raw_tables]
    if len(set(selected_list)) != len(selected_list):
        raise ContractCompilerError("generated table selection is duplicated")
    selected = set(selected_list)
    if selected & _date_shard_tokens(prepared):
        raise ContractCompilerError("date-shard candidates require consolidated metadata")
    business_token, time_candidates = _time_candidates(raw, prepared, selected)
    business = prepared.fields[business_token]["reference"]
    semantics = {
        key: _role_definitions(raw, key, prepared, selected) for key in ROLE_KEYS
    }
    semantics["metrics"] = _metric_definitions(raw, prepared, selected)
    semantics["time_candidates"] = time_candidates
    semantics["nested_paths"] = [
        {"field": field["reference"], "repeated": field["value_class"] == "repeated"}
        for field in prepared.fields.values()
        if field["table_token"] in selected
        and (
            len(field["reference"].get("path", [])) > 1
            or field["value_class"] == "repeated"
        )
    ]
    semantics["relationships"] = _relationships(raw, prepared, selected)
    selected_names = {prepared.tables[token] for token in selected}
    schema = {
        "version": 1,
        "tables": [
            table
            for table in prepared.schema_metadata["tables"]
            if table["table"] in selected_names
        ],
    }
    encoded = json.dumps(schema, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    snapshot = SchemaSnapshot(
        encoded,
        hashlib.sha256(encoded.encode()).hexdigest(),
        prepared.retrieved_at,
    )
    period = _period(raw["period"], prepared, schema, business)
    try:
        return compile_contract(
            snapshot,
            semantics,
            period,
            {
                "maximum_bytes_billed": MAX_EXECUTION_BYTES,
                "maximum_result_rows": MAX_RESULT_ROWS,
            },
        )
    except AnalysisContractError as error:
        raise ContractCompilerError(str(error)) from None
