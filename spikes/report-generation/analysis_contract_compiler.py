"""Prepare a bounded, source-independent catalog for contract generation."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime

from analysis_contract import NUMERIC_TYPES, TIME_TYPES
from bigquery_schema_snapshot import MAX_FIELDS, MAX_TABLES
from bigquery_scope_discovery import (
    MAX_BYTES_BILLED_PER_QUERY,
    MAX_BYTES_BILLED_TOTAL,
    MAX_CATEGORICAL_DISTINCT,
    MAX_DISCOVERY_BYTES,
    MAX_SAMPLE_CHARACTERS,
    MAX_SAMPLE_ROWS,
    MAX_SAMPLE_VALUES,
    MAX_VALUE_FIELDS_PER_TABLE,
    DiscoverySnapshot,
)


MAX_QUESTION_CHARACTERS = 4000


class ContractCompilerError(ValueError):
    """Discovered metadata cannot form bounded contract-generation input."""


@dataclass(frozen=True)
class CompilerInput:
    """Canonical catalog and token bindings for one compiler invocation."""

    catalog_json: str
    fields: dict[str, dict]
    tables: dict[str, str]
    schema_metadata: dict
    retrieved_at: str
    as_of: date


def _canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _canonical_discovery(snapshot: DiscoverySnapshot) -> dict:
    if not isinstance(snapshot, DiscoverySnapshot):
        raise ContractCompilerError("discovery snapshot is invalid")
    try:
        content = json.loads(snapshot.content_json)
        retrieved = datetime.fromisoformat(snapshot.retrieved_at)
    except (TypeError, ValueError):
        raise ContractCompilerError("discovery snapshot is invalid") from None
    if (
        not isinstance(content, dict)
        or set(content) != {"version", "schema", "tables", "limits"}
        or content.get("version") != 1
        or snapshot.content_json != _canonical_json(content)
        or snapshot.fingerprint
        != hashlib.sha256(snapshot.content_json.encode()).hexdigest()
        or retrieved.tzinfo is None
    ):
        raise ContractCompilerError("discovery snapshot fingerprint or version is invalid")
    schema = content["schema"]
    metadata = schema.get("metadata") if isinstance(schema, dict) else None
    if (
        not isinstance(schema, dict)
        or set(schema) != {"fingerprint", "metadata"}
        or not isinstance(metadata, dict)
        or set(metadata) != {"version", "tables"}
        or metadata.get("version") != 1
        or not isinstance(metadata.get("tables"), list)
        or schema.get("fingerprint")
        != hashlib.sha256(_canonical_json(metadata).encode()).hexdigest()
    ):
        raise ContractCompilerError("discovery schema is invalid")
    expected_limits = {
        "maximumTables": MAX_TABLES,
        "maximumFields": MAX_FIELDS,
        "maximumValueFieldsPerTable": MAX_VALUE_FIELDS_PER_TABLE,
        "maximumSampleRows": MAX_SAMPLE_ROWS,
        "samplePercent": 1,
        "maximumSampleValues": MAX_SAMPLE_VALUES,
        "maximumCategoricalDistinct": MAX_CATEGORICAL_DISTINCT,
        "maximumSampleCharacters": MAX_SAMPLE_CHARACTERS,
        "maximumBytesBilledPerQuery": MAX_BYTES_BILLED_PER_QUERY,
        "maximumBytesBilledTotal": MAX_BYTES_BILLED_TOTAL,
    }
    if content["limits"] != expected_limits:
        raise ContractCompilerError("discovery policy differs from the compiler policy")
    if len(snapshot.content_json.encode()) > MAX_DISCOVERY_BYTES:
        raise ContractCompilerError("discovery snapshot exceeds compiler input limit")
    return content


def _bounded_question(question: str) -> str:
    if (
        not isinstance(question, str)
        or not question.strip()
        or len(question) > MAX_QUESTION_CHARACTERS
        or any(ord(character) < 32 and character not in "\n\t" for character in question)
    ):
        raise ContractCompilerError("analysis question is invalid or too long")
    return question.strip()


def _metadata_tables(content: dict) -> dict[str, dict]:
    tables = content["schema"]["metadata"]["tables"]
    result = {}
    for table in tables:
        if (
            not isinstance(table, dict)
            or not isinstance(table.get("table"), str)
            or not table["table"]
            or not isinstance(table.get("fields"), list)
            or table["table"] in result
        ):
            raise ContractCompilerError("discovery schema tables are invalid")
        result[table["table"]] = table
    return result


def _schema_field(table: dict, segments: list[str]) -> tuple[dict, bool]:
    fields = table["fields"]
    repeated = False
    current = None
    for segment in segments:
        if not all(isinstance(field, dict) for field in fields):
            raise ContractCompilerError("discovery schema fields are invalid")
        current = next((field for field in fields if field.get("name") == segment), None)
        if (
            current is None
            or not isinstance(current.get("type"), str)
            or current.get("mode") not in ("NULLABLE", "REQUIRED", "REPEATED")
            or not isinstance(current.get("fields", []), list)
        ):
            raise ContractCompilerError("discovery field is outside schema")
        repeated = repeated or current["mode"] == "REPEATED"
        fields = current.get("fields", [])
    return current, repeated


def _schema_paths(fields: list, prefix: tuple = ()) -> set[tuple]:
    result = set()
    for field in fields:
        if (
            not isinstance(field, dict)
            or not isinstance(field.get("name"), str)
            or not field["name"]
            or not isinstance(field.get("fields", []), list)
        ):
            raise ContractCompilerError("discovery schema fields are invalid")
        path = (*prefix, field["name"])
        if path in result:
            raise ContractCompilerError("discovery schema field paths are duplicated")
        result.add(path)
        result.update(_schema_paths(field.get("fields", []), path))
    return result


def _value_class(field: dict, repeated: bool) -> str:
    kind = field["type"]
    if "policyTags" in field:
        return "restricted"
    if repeated:
        return "repeated"
    if kind in ("RECORD", "STRUCT"):
        return "structured"
    if kind in NUMERIC_TYPES:
        return "numeric"
    if kind in TIME_TYPES:
        return "temporal"
    if kind in ("BOOLEAN", "BOOL"):
        return "boolean"
    if kind == "STRING":
        return "categorical_candidate"
    return "opaque"


def _prompt_summary(summary) -> dict | None:
    if not isinstance(summary, dict):
        return None
    samples = summary.get("samples")
    if samples is not None and (
        not isinstance(samples, list)
        or len(samples) > MAX_SAMPLE_VALUES
        or any(
            isinstance(value, str) and len(value) > MAX_SAMPLE_CHARACTERS
            for value in samples
        )
    ):
        raise ContractCompilerError("discovery value samples exceed compiler limits")
    allowed = {
        "status",
        "nullFraction",
        "approxDistinct",
        "minimum",
        "maximum",
        "maximumLength",
        "samples",
    }
    return {key: value for key, value in summary.items() if key in allowed}


def _field_index(content: dict) -> tuple[dict[str, dict], dict[str, str], list[dict]]:
    metadata = _metadata_tables(content)
    catalog = content["tables"]
    if not isinstance(catalog, list) or not catalog or len(catalog) > MAX_TABLES:
        raise ContractCompilerError("discovery table catalog is invalid")
    ordered = sorted(
        catalog,
        key=lambda table: table.get("table", "") if isinstance(table, dict) else "",
    )
    table_tokens, fields, prompt_fields, seen = {}, {}, [], set()
    compared_keys = (
        "location",
        "timePartitioning",
        "rangePartitioning",
        "clustering",
        "requirePartitionFilter",
        "dateShards",
    )
    for table_index, entry in enumerate(ordered):
        name = entry.get("table") if isinstance(entry, dict) else None
        if name not in metadata or name in table_tokens.values():
            raise ContractCompilerError("discovery table catalog differs from schema")
        if any(entry.get(key) != metadata[name].get(key) for key in compared_keys):
            raise ContractCompilerError("discovery table metadata differs from schema")
        table_token = f"t{table_index:03d}"
        table_tokens[table_token] = name
        raw_fields = entry.get("fields")
        if not isinstance(raw_fields, list):
            raise ContractCompilerError("discovery field catalog is invalid")
        for field in raw_fields:
            segments = field.get("segments") if isinstance(field, dict) else None
            if (
                not isinstance(segments, list)
                or not segments
                or any(not isinstance(segment, str) or not segment for segment in segments)
                or field.get("path") != ".".join(segments)
            ):
                raise ContractCompilerError("discovery field metadata is invalid")
            identity = (name, *segments)
            if identity in seen:
                raise ContractCompilerError("discovery field paths are duplicated")
            seen.add(identity)
            schema_field, repeated = _schema_field(metadata[name], segments)
            if (
                field.get("type") != schema_field["type"]
                or field.get("mode") != schema_field["mode"]
                or field["valueClass"] != _value_class(schema_field, repeated)
            ):
                raise ContractCompilerError("discovery field metadata differs from schema")
            token = f"f{len(fields):04d}"
            selectable = field["valueClass"] not in {
                "restricted",
                "repeated",
                "structured",
                "opaque",
            }
            fields[token] = {
                "reference": {"table": name, "path": segments},
                "table_token": table_token,
                "type": field["type"],
                "mode": field["mode"],
                "value_class": field["valueClass"],
                "selectable": selectable,
                "role_selectable": selectable,
            }
            prompt_field = {
                "token": token,
                "table": table_token,
                "path": segments,
                "type": field["type"],
                "mode": field["mode"],
                "selectable": selectable,
            }
            description = schema_field.get("description")
            if description is not None:
                if not isinstance(description, str):
                    raise ContractCompilerError("discovery field description is invalid")
                prompt_field["description"] = description
            summary = _prompt_summary(field.get("valueSummary"))
            if summary is not None:
                prompt_field["value_summary"] = summary
            prompt_fields.append(prompt_field)
        if "dateShards" in metadata[name]:
            token = f"f{len(fields):04d}"
            fields[token] = {
                "reference": {"table": name, "field": "_TABLE_SUFFIX"},
                "table_token": table_token,
                "type": "DATE",
                "mode": "REQUIRED",
                "value_class": "temporal",
                "selectable": True,
                "role_selectable": False,
            }
            prompt_fields.append(
                {
                    "token": token,
                    "table": table_token,
                    "field": "_TABLE_SUFFIX",
                    "type": "DATE",
                    "mode": "REQUIRED",
                    "selectable": True,
                    "role_selectable": False,
                }
            )
    expected = {
        (name, *path)
        for name, table in metadata.items()
        for path in _schema_paths(table["fields"])
    }
    if (
        set(metadata) != set(table_tokens.values())
        or seen != expected
        or not fields
        or len(fields) > MAX_FIELDS
    ):
        raise ContractCompilerError("discovery table catalog is incomplete")
    return fields, table_tokens, prompt_fields


def prepare_compiler_input(
    discovery: DiscoverySnapshot, question: str, *, as_of: date
) -> CompilerInput:
    """Bind one question to a validated discovery snapshot and opaque tokens."""
    if type(as_of) is not date:
        raise ContractCompilerError("compiler as_of must be a date")
    question = _bounded_question(question)
    content = _canonical_discovery(discovery)
    fields, tables, prompt_fields = _field_index(content)
    prompt_input = {
        "as_of": as_of.isoformat(),
        "question": question,
        "tables": [
            {
                "token": token,
                "name": name,
                **{
                    key: value
                    for key, value in next(
                        table for table in content["tables"] if table["table"] == name
                    ).items()
                    if key
                    in {
                        "location",
                        "timePartitioning",
                        "rangePartitioning",
                        "clustering",
                        "requirePartitionFilter",
                        "dateShardCandidate",
                        "dateShards",
                    }
                },
            }
            for token, name in tables.items()
        ],
        "fields": prompt_fields,
    }
    return CompilerInput(
        catalog_json=_canonical_json(prompt_input),
        fields=fields,
        tables=tables,
        schema_metadata=content["schema"]["metadata"],
        retrieved_at=discovery.retrieved_at,
        as_of=as_of,
    )
