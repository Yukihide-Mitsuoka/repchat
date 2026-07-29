#!/usr/bin/env python3
"""Generate one monthly report page from a Japanese description + a real GA4 export.

The gate this spike exists to test (docs/positioning.md §5) is whether a report
can be produced without anyone writing SQL. So each section is described the way
a person would ask for it, the model writes the SQL, and the result is compared
against a hand-written reference — the spike's stand-in for the "known number"
the customer supplies in production (§2.7).

The dataset is the public GA4 export sample, chosen because it is the exact
schema a GA4 reseller's customers already have, nested event_params and all.
That nesting is where §2.8 predicts natural-language SQL will fail; this
measures whether it does.

Output is an Evidence markdown page built from the MODEL's SQL, because that is
what the product would ship. Sections whose numbers disagreed with the reference
are marked in the page rather than hidden.

    python3 spikes/report-generation/run_report.py --project <gcp-project>
"""
import argparse
import html
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
DATASET = "bigquery-public-data.ga4_obfuscated_sample_ecommerce"
MAX_BYTES_BILLED = 20 * 1024**3  # 20 GiB — the sample month is far under this
DEFAULT_MODEL = "gemini-3.5-flash"
USD_JPY = 155.0
PRICING = {"gemini-3.5-flash": (0.30, 2.50)}  # USD per 1M tokens (in, out)
MAX_QUESTION_CHARS = 500
SHOWCASE_IDS = ("R4", "R11", "R12", "R9", "R16", "R17")

# Hand-transcribed from the public sample. Deliberately the raw export shape:
# no semantic layer, no pre-aggregation. That is the point of the measurement.
SCHEMA_DDL = """
-- dataset: bigquery-public-data.ga4_obfuscated_sample_ecommerce (BigQuery, US)
-- 日次シャード。テーブルは events_YYYYMMDD、ワイルドカードは `events_*` で
-- _TABLE_SUFFIX に 'YYYYMMDD' 文字列が入る。
CREATE TABLE events_* (
  event_date STRING,          -- 'YYYYMMDD' 形式の文字列。DATE型ではない
  event_timestamp INT64,      -- マイクロ秒
  event_name STRING,          -- 'page_view' | 'session_start' | 'purchase' | 'add_to_cart' | 'view_item' 等
  event_params ARRAY<STRUCT<
    key STRING,
    value STRUCT<string_value STRING, int_value INT64,
                 float_value FLOAT64, double_value FLOAT64>
  >>,                         -- key に 'ga_session_id'(int_value), 'page_location'(string_value),
                              -- 'page_title'(string_value), 'engagement_time_msec'(int_value) 等
  user_pseudo_id STRING,      -- ブラウザ単位の識別子。ユーザー数はこれを数える
  user_id STRING,             -- ログインID。このデータセットではほぼNULL
  device STRUCT<category STRING, mobile_brand_name STRING, operating_system STRING,
                web_info STRUCT<browser STRING>>,
  geo STRUCT<continent STRING, country STRING, region STRING, city STRING>,
  traffic_source STRUCT<name STRING, medium STRING, source STRING>,
  ecommerce STRUCT<total_item_quantity INT64, purchase_revenue_in_usd FLOAT64,
                   purchase_revenue FLOAT64, transaction_id STRING>,
                              -- purchase_revenue は event_name='purchase' の行にのみ入る
  items ARRAY<STRUCT<item_id STRING, item_name STRING, price FLOAT64,
                     quantity INT64, item_revenue FLOAT64>>
);
"""

def metrics_block(path: Path) -> str:
    """Render the metric definitions for the prompt, or '' when running without.

    LOG-0065 measured the model writing correct SQL but choosing a different
    reading of 「購入件数」 between runs at temperature 0. This block is the
    intervention being tested: does declaring the definition make the answer
    reproducible? In production the agency maintains these definitions in our
    shared definition layer; generated pages and source definitions go to the
    customer's Git (ADR-0014).
    """
    if not path.exists():
        return ""
    m = json.loads(path.read_text(encoding="utf-8"))
    lines = ["", "指標定義（この定義に従うこと。ここに定義がある語は、自分で解釈し直さない）:"]
    for name, g in m["grain"].items():
        lines.append(f"- 粒度 {{{name}}} = {g['expr']}")
    # LOG-0070: without aliases the model refused 「新規訪問」 because the
    # definition is named 「新規セッション」 — it matched strings, not meaning.
    def alias(spec):
        a = spec.get("aliases")
        return f"  [同義: {'、'.join(a)}]" if a else ""

    for name, spec in m["metrics"].items():
        extra = f"  ※{spec['note']}" if spec.get("note") else ""
        flt = f"  [対象行: {spec['filter']}]" if spec.get("filter") else ""
        lines.append(f"- 指標「{name}」 = {spec['expr']}{flt}{alias(spec)}{extra}")
    for name, spec in m["dimensions"].items():
        lines.append(f"- 軸「{name}」 = {spec['expr']}{alias(spec)}")
    return "\n".join(lines).replace("\t", "    ")


def prompt_rules(metrics: str) -> str:
    return f"""あなたは BigQuery 標準SQLでレポート用のクエリを書く。

{SCHEMA_DDL}
{metrics}

規則:
- テーブル参照は必ず `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*` と完全修飾する。
- 期間の絞り込みは必ず `_TABLE_SUFFIX BETWEEN '<from>' AND '<to>'` で行う（スキャン量を抑えるため）。
- GA4 の生エクスポートには「セッション」という行は存在しない。
- **列の別名は ASCII の snake_case にする**（`sessions`, `repeat_user_pct` など）。
  BigQuery のフィールド名には日本語や記号（全角括弧など）を使えない。
- **指定された列名は「表示名」であって、SQLの識別子ではない。** 表示名はレポートを組み立てる
  側が付けるので、SQLには**指定された順序**だけを守ればよい。
- **`SELECT *` は使わず、レポートに必要な列だけを明示する。** BigQueryは列指向なので、
  不要な列の読み取りを避け、生成結果の契約を列名で固定する。
- SELECT 文のみ。DDL/DML は書かない。
- **指標定義に無い語を求められたら、推測でSQLを書かない。** `sql` を空文字にし、
  `undefined_terms` にその語を入れて返す（ADR-0013 C5）。**別の指標の式を流用して代用しない。**
  読み手には、定義済みの数字と推測された数字の区別がつかないため。
- ただし判定は**字面ではなく意味**で行う。**同義として挙げられた語は、その指標を指している。**
- **定義済みの指標を、上のテーブルの列で絞り込む・分割するのは「代用」ではない**（例:
  「商品を見たセッション数」は、セッション数を `event_name = 'view_item'` で絞ったもの）。
  指標の定義式そのものを変えなければ、合成してよい。
- 定義がある語だけで答えられる場合は `undefined_terms` を空配列にする。
- 結果は JSON で {{"sql": "...", "reason": "...", "undefined_terms": [...]}} の形で返す。
  reason は日本語1文。
"""

_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "sql": {"type": "string"},
        "reason": {"type": "string"},
        # ADR-0013 C5. The model must be able to say "this term is not defined"
        # instead of guessing, so refusal needs somewhere to go in the response.
        "undefined_terms": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["sql", "reason", "undefined_terms"],
}


# In production the customer's existing hand-made report fixes the shape of
# each section; here the spec stands in for it. Without this the model answers
# correctly but with extra context columns, which is not wrong — just not the
# shape the report has.
SHAPE_HINT = {
    "scalar": "値ひとつだけを、1行1列で返すこと。内訳の列は付けない。",
    "rows_unordered": "区分の列と値の列で返すこと。",
    "rows_ordered": "レポートの表にそのまま出せる列構成で返すこと。",
    "execution": (
        "問い合わせに答える最小限の列を返すこと。時系列なら1列目を日付、2列目を値にすること。"
    ),
}


def generation_request(section: dict, period: dict) -> str:
    """Build the user-level analysis contract independently of the model client."""
    # ADR-0013 C4. A declared shape beats a generic hint: LOG-0071 measured the
    # funnel coming back long on one run and wide on the next, with identical
    # numbers both times. Both are legitimate reports, so nothing decided it.
    if section.get("shape"):
        sp = section["shape"]
        cols = "、".join(f"「{c}」" for c in sp["columns"])
        shape = (
            f"列は {cols} の順に、この数だけ返すこと。"
            "これらは表示名なので、SQLの別名は ASCII の snake_case にする。"
            f"行は {sp['rows']}。"
        )
    else:
        shape = SHAPE_HINT[section["compare"]]
        if section["component"] == "line":
            shape = "1列目に日付、2列目に値の、2列で返すこと。"
    request = (
        f"{section['text']}\n"
        f"（対象期間: _TABLE_SUFFIX は '{period['from']}' から '{period['to']}'）\n"
        f"（出力形式: {shape}）"
    )
    requirements = section.get("generation_requirements") or []
    if requirements:
        request += "\n（実装要件:\n" + "\n".join(
            f"- {requirement}" for requirement in requirements
        )
        request += "\n）"
    return request


def generate(client, model: str, section: dict, period: dict, rules: str):
    from google.genai import types

    resp = client.models.generate_content(
        model=model,
        contents=generation_request(section, period),
        config=types.GenerateContentConfig(
            system_instruction=rules,
            response_mime_type="application/json",
            response_schema={**_JSON_SCHEMA, "propertyOrdering": ["sql", "reason", "undefined_terms"]},
            temperature=0,
        ),
    )
    um = resp.usage_metadata
    return json.loads(resp.text), {
        "input_tokens": um.prompt_token_count or 0,
        "output_tokens": um.candidates_token_count or 0,
    }


def exec_bq(bq, sql: str):
    """Read-only execution, guarded the same way the executor guards tenant SQL."""
    from google.cloud import bigquery

    s, validation_error = validate_sql(sql)
    if validation_error:
        return None, validation_error
    assert s is not None
    try:
        job = bq.query(
            s,
            job_config=bigquery.QueryJobConfig(
                maximum_bytes_billed=MAX_BYTES_BILLED, use_query_cache=True
            ),
        )
        it = job.result(timeout=180)
        # Column names come off this same job. Re-querying just to read the
        # schema would triple the scan cost of every section.
        return ([tuple(r.values()) for r in it], [f.name for f in it.schema]), None
    except Exception as e:  # noqa: BLE001 — the message is the diagnostic
        # Take the reason out of the exception rather than truncating its front:
        # a BadRequest stringifies as a long API URL first, so a head-clipped
        # message shows the endpoint and hides the syntax error. Fourth time this
        # session that a discarded diagnostic cost a debugging round.
        why = ""
        errs = getattr(e, "errors", None)
        if errs and isinstance(errs, list) and isinstance(errs[0], dict):
            why = errs[0].get("message", "")
        if not why:
            why = getattr(e, "message", "") or str(e)
        return None, f"bq error: {type(e).__name__}: {why[:220]}"


def validate_sql(sql: str) -> tuple[str | None, str | None]:
    """Return a normalized dataset-bounded SELECT or a refusal reason."""
    s = sql.strip()
    if s.endswith(";"):
        s = s[:-1].rstrip()
    if not re.match(r"^(select|with)\b", s, re.I):
        return None, "rejected: not a SELECT"
    if ";" in s:
        return None, "rejected: multiple statements"
    without_comments = re.sub(r"/\*.*?\*/|--[^\n]*", " ", s, flags=re.S)
    without_literals = re.sub(r"'(?:''|[^'])*'", "''", without_comments)
    if re.search(
        r"\b(insert|update|delete|drop|create|merge|alter|call|export|grant)\b",
        without_literals,
        re.I,
    ):
        return None, "rejected: forbidden keyword"
    if re.search(
        r"\bselect\s+(?:distinct\s+)?(?:[a-zA-Z_][a-zA-Z0-9_]*\.)?\*",
        without_literals,
        re.I,
    ):
        return None, "rejected: SELECT * anti-pattern"
    found_dataset = False
    for m in re.finditer(
        r"`?([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]+)\.[a-zA-Z0-9_*]+`?",
        without_literals,
    ):
        if f"{m.group(1)}.{m.group(2)}" != DATASET:
            return None, f"rejected: foreign table ref {m.group(0)}"
        found_dataset = True
    if not found_dataset:
        return None, f"rejected: query must reference dataset {DATASET}"
    return s, None


def _norm(c):
    return round(c, 2) if isinstance(c, float) else c


def compare(kind: str, got, want):
    g = [tuple(_norm(c) for c in r) for r in got]
    w = [tuple(_norm(c) for c in r) for r in want]
    if kind == "scalar":
        if len(g) == 1 and len(g[0]) == 1 and len(w) == 1:
            a, b = g[0][0], w[0][0]
            ok = (
                abs(float(a) - float(b)) <= 0.02
                if isinstance(a, float) or isinstance(b, float)
                else a == b
            )
            return ok, f"got={a} want={b}"
        return False, f"expected 1x1, got {g[:2]} want {w[:2]}"
    if kind == "rows_ordered":
        # Column names are the model's choice, so only the values are compared.
        return g == w, f"got={g[:3]}... want={w[:3]}..."
    if kind == "rows_unordered":
        # For a plain breakdown, both the row order and the label wording are
        # the model's choice — 「新規」 vs 「新規セッション」 is not an error.
        # Only the numbers, sorted, are load-bearing.
        def nums(rows):
            return sorted(tuple(c for c in r if isinstance(c, (int, float))) for r in rows)

        return nums(g) == nums(w), f"got={nums(g)} want={nums(w)}"
    raise ValueError(kind)


def select_sections(
    spec: dict, question: str | None, showcase: bool = False
) -> list[dict]:
    """Select the full regression report or one operator-supplied question."""
    if showcase and question is not None:
        raise ValueError("showcase and question modes are mutually exclusive")
    if showcase:
        by_id = {section["id"]: section for section in spec["sections"]}
        components = {
            "R4": "kpi_pair",
            "R11": "big_value",
            "R12": "big_value",
            "R9": "funnel",
            "R16": "trend",
            "R17": "sankey",
        }
        return [
            {
                **by_id[section_id],
                "component": components[section_id],
                "verification": "reference",
            }
            for section_id in SHOWCASE_IDS
        ]
    if question is None:
        return [{**section, "verification": "reference"} for section in spec["sections"]]

    normalized = question.strip()
    if not normalized:
        raise ValueError("question must not be empty")
    if len(normalized) > MAX_QUESTION_CHARS:
        raise ValueError(f"question must be at most {MAX_QUESTION_CHARS} characters")
    if any(ord(char) < 32 for char in normalized):
        raise ValueError("question must be a single line without control characters")

    for section in spec["sections"]:
        if section["text"].strip() == normalized:
            return [{**section, "verification": "reference"}]

    return [
        {
            "id": "Q1",
            "title": "日本語問い合わせの結果",
            "text": normalized,
            "compare": "execution",
            "component": "table",
            "verification": "execution",
        }
    ]


def component_for_result(rows: list[tuple], columns: list[str]) -> str:
    """Choose the smallest Evidence component supported by the actual result."""
    if len(rows) == 1 and len(columns) == 1:
        return "big_value"
    if (
        rows
        and len(columns) == 2
        and all(row and isinstance(row[0], (date, datetime)) for row in rows)
    ):
        return "line"
    return "table"


EVIDENCE_COMPONENT = {
    "big_value": '<BigValue data={{{q}}} value={col} title="{title}"/>',
    "table": "<DataTable data={{{q}}}/>",
    "bar": '<BarChart data={{{q}}} x={x} y={y} title="{title}"/>',
    "line": "<LineChart data={{{q}}} x={x} y={y} title=\"{title}\"/>",
}


SOURCE = "ga4"  # Evidence source name; sources/<SOURCE>/<id>.sql holds warehouse SQL


def break_select_columns(sql: str) -> str:
    """Put each expression in every SELECT list on its own logical line."""
    out: list[str] = []
    select_depths: list[int] = []
    depth = 0
    quote: str | None = None
    index = 0
    while index < len(sql):
        char = sql[index]
        if quote:
            out.append(char)
            if char == quote:
                if index + 1 < len(sql) and sql[index + 1] == quote:
                    out.append(sql[index + 1])
                    index += 1
                else:
                    quote = None
            index += 1
            continue
        if char in {"'", '"', "`"}:
            quote = char
            out.append(char)
            index += 1
            continue
        if char == "(":
            depth += 1
            out.append(char)
            index += 1
            continue
        if char == ")":
            out.append(char)
            depth = max(0, depth - 1)
            index += 1
            continue
        if char.isalpha() or char == "_":
            end = index + 1
            while end < len(sql) and (sql[end].isalnum() or sql[end] == "_"):
                end += 1
            word = sql[index:end]
            upper = word.upper()
            if upper == "SELECT":
                select_depths.append(depth)
            elif upper == "FROM" and select_depths and select_depths[-1] == depth:
                select_depths.pop()
            out.append(word)
            index = end
            continue
        if char == "," and select_depths and select_depths[-1] == depth:
            out.append(",\n" + " " * (4 * (depth + 1)))
            index += 1
            while index < len(sql) and sql[index].isspace():
                index += 1
            continue
        out.append(char)
        index += 1
    return "".join(out)


def sql_parenthesis_delta(line: str) -> int:
    """Count structural parentheses while ignoring quoted SQL content."""
    delta = 0
    quote: str | None = None
    index = 0
    while index < len(line):
        char = line[index]
        if quote:
            if char == quote:
                if index + 1 < len(line) and line[index + 1] == quote:
                    index += 2
                    continue
                quote = None
            index += 1
            continue
        if char in {"'", '"', "`"}:
            quote = char
        elif char == "-" and index + 1 < len(line) and line[index + 1] == "-":
            break
        elif char == "(":
            delta += 1
        elif char == ")":
            delta -= 1
        index += 1
    return delta


def normalize_sql_indentation(formatted: str, width: int = 4) -> str:
    """Replace visual alignment offsets with structural indentation levels."""
    lines = formatted.replace("\t", " " * width).splitlines()
    normalized: list[str] = []
    depth = 0
    select_contexts: list[dict[str, int | str]] = []
    main_clause = re.compile(
        r"^(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|QUALIFY|LIMIT|"
        r"UNION(?:\s+ALL)?|EXCEPT|INTERSECT)\b",
        flags=re.I,
    )
    join_clause = re.compile(
        r"^(?:(?:LEFT|RIGHT|FULL|INNER|OUTER|CROSS|NATURAL)\s+)?JOIN\b",
        flags=re.I,
    )

    for line in lines:
        stripped = line.strip()
        if not stripped:
            normalized.append("")
            continue

        leading_closes = len(stripped) - len(stripped.lstrip(")"))
        effective_depth = max(0, depth - leading_closes)
        select_contexts = [
            context
            for context in select_contexts
            if int(context["depth"]) <= effective_depth
        ]
        context = select_contexts[-1] if select_contexts else None
        upper = stripped.upper()

        if re.match(r"^SELECT\b", upper):
            select_contexts = [
                existing
                for existing in select_contexts
                if int(existing["depth"]) < effective_depth
            ]
            context = {"depth": effective_depth, "phase": "select"}
            select_contexts.append(context)
            indent_level = effective_depth
        else:
            clause = main_clause.match(stripped)
            if clause and context:
                indent_level = int(context["depth"])
                keyword = clause.group(1).upper()
                if keyword.startswith("GROUP"):
                    context["phase"] = "group"
                elif keyword.startswith("ORDER"):
                    context["phase"] = "order"
                elif keyword.startswith("FROM"):
                    context["phase"] = "from"
                elif keyword.startswith(("WHERE", "HAVING", "QUALIFY")):
                    context["phase"] = "condition"
                else:
                    context["phase"] = "clause"
            elif join_clause.match(stripped) and context:
                indent_level = int(context["depth"])
                context["phase"] = "from"
            elif re.match(r"^(AND|OR|ON|USING)\b", upper) and context:
                indent_level = int(context["depth"]) + 1
            elif stripped.startswith(")"):
                indent_level = effective_depth
            elif context and context["phase"] in {
                "select",
                "from",
                "group",
                "order",
                "condition",
            }:
                indent_level = max(int(context["depth"]) + 1, effective_depth)
            else:
                indent_level = effective_depth

        normalized.append(" " * (width * indent_level) + stripped)
        depth = max(0, depth + sql_parenthesis_delta(stripped))

    return "\n".join(normalized)


def format_sql_for_display(sql: str) -> str:
    """Format SQL for the page without changing the executable source text."""
    try:
        import sqlparse
    except ModuleNotFoundError:
        # Unit tests run without the paid demo venv. Keep this dependency-free
        # fallback deterministic; the demo venv pins sqlparse for full nesting.
        clauses = r"\s+(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT)\s+"
        formatted = re.sub(
            clauses,
            lambda match: f"\n{match.group(1).upper()} ",
            break_select_columns(sql.strip()),
            flags=re.I,
        )
    else:
        # AlignedIndentFilter uses keyword-width offsets and does not receive
        # indent_width in sqlparse 0.5.5. It provides useful line breaks here;
        # normalize_sql_indentation applies the four-space hierarchy below.
        formatted = sqlparse.format(
            sql.strip(),
            keyword_case="upper",
            reindent_aligned=True,
            use_space_around_operators=True,
            wrap_after=100,
        ).strip()

    # sqlparse's aligned mode keeps each expression readable, but leaves the
    # first one beside SELECT and can put SELECT beside UNION or the final CTE
    # close. Keep those structural keywords on their own lines as requested.
    formatted = re.sub(
        r"(?im)^([ \t]*)UNION\s+ALL\s+SELECT\s+",
        lambda match: f"{match.group(1)}UNION ALL\n{match.group(1)}SELECT ",
        formatted,
    )
    formatted = re.sub(
        r"(?i)\bUNION[ \t]+ALL[ \t]+SELECT[ \t]+",
        "UNION ALL\nSELECT ",
        formatted,
    )
    formatted = re.sub(r"(?i)\)[ \t]+SELECT[ \t]+", ")\nSELECT ", formatted)
    formatted = re.sub(
        r"(?im)^(\s*)SELECT\s+",
        lambda match: f"{match.group(1)}SELECT\n{match.group(1)}    ",
        formatted,
    )

    # The dependency-free unit-test fallback receives the compact source, so
    # expose CTE SELECTs before applying the same line-start rule a second time.
    formatted = re.sub(
        r"(?i)\bAS[ \t]*\([ \t]*SELECT[ \t]+",
        "AS (\n    SELECT ",
        formatted,
    )
    formatted = re.sub(
        r"(?im)^(\s*)SELECT\s+",
        lambda match: f"{match.group(1)}SELECT\n{match.group(1)}    ",
        formatted,
    )

    # Aligned mode reserves space based on keyword width, which otherwise
    # leaves the first SELECT expression at a different column from the rest.
    # Keep every projected expression at one consistent four-space offset.
    lines = formatted.splitlines()
    select_column_indent: int | None = None
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.upper() == "SELECT":
            select_column_indent = len(line) - len(line.lstrip()) + 4
            continue
        if select_column_indent is not None and re.match(
            r"^(FROM|INTO)\b", stripped, flags=re.I
        ):
            select_column_indent = None
            continue
        if select_column_indent is not None and stripped:
            lines[index] = " " * select_column_indent + stripped
    return normalize_sql_indentation("\n".join(lines))


def evidence_query(result: dict) -> list[str]:
    columns = result["columns"] or []
    selected_columns = ", ".join(evidence_identifier(column) for column in columns)
    query_name = result["id"].lower()
    return [
        f"```sql {query_name}",
        f"select {selected_columns} from {SOURCE}.{query_name}",
        "```",
        "",
    ]


def showcase_chart_query(result: dict) -> list[str]:
    """Create only the local reshaping needed by an Evidence visualization."""
    columns = [evidence_identifier(column) for column in result["columns"] or []]
    query_name = result["id"].lower()
    if result["component"] == "funnel":
        labels = ("商品閲覧", "カート追加", "購入")
        lines = [f"```sql {query_name}_chart"]
        for index, (label, column) in enumerate(zip(labels, columns), start=1):
            prefix = "select" if index == 1 else "union all\nselect"
            lines.append(
                f"{prefix} '{label}' as stage, {column} as sessions, "
                f"{index} as stage_order from {SOURCE}.{query_name}"
            )
        return [*lines, "order by stage_order", "```", ""]
    if result["component"] == "trend":
        day, sessions, rolling = columns
        return [
            f"```sql {query_name}_chart",
            f"select {day} as date, '日次セッション' as metric, "
            f"{sessions} as value from {SOURCE}.{query_name}",
            "union all",
            f"select {day} as date, '7日移動平均' as metric, "
            f"{rolling} as value from {SOURCE}.{query_name}",
            "```",
            "",
        ]
    return []


def evidence_component(result: dict) -> str:
    columns = result["columns"] or []
    query_name = result["id"].lower()
    component = result["component"]
    if component == "kpi_pair":
        first = columns[0] if columns else "value"
        second = columns[1] if len(columns) > 1 else "value_2"
        return (
            '<Grid cols=2>\n'
            f'<BigValue data={{{query_name}}} value={first} title="購入件数" fmt=num0/>\n'
            f'<BigValue data={{{query_name}}} value={second} '
            'title="購入金額（USD）" fmt=usd0/>\n'
            "</Grid>"
        )
    if component == "funnel":
        return (
            f'<FunnelChart data={{{query_name}_chart}} nameCol=stage '
            'valueCol=sessions title="購入までのファネル"/>'
        )
    if component == "trend":
        return (
            f'<LineChart data={{{query_name}_chart}} x=date y=value series=metric '
            'title="日別セッションと7日移動平均" legend=true/>'
        )
    if component == "sankey":
        return (
            f'<SankeyDiagram data={{{query_name}}} sourceCol=source targetCol=target '
            'valueCol=sessions valueFmt=num0 nodeLabels=name linkLabels=value '
            'linkColor=gradient chartAreaHeight=420 '
            'title="入口から3ページ目までの主要回遊"/>'
        )
    if result["id"] == "R11":
        value_column = columns[0] if columns else "repeat_user_pct"
        return (
            f'<BigValue data={{{query_name}}} value={value_column} '
            'title="リピートユーザー率（%）" fmt=num2/>'
        )
    if result["id"] == "R12":
        value_column = columns[0] if columns else "avg_engagement_time_seconds"
        return (
            f'<BigValue data={{{query_name}}} value={value_column} '
            'title="平均エンゲージメント時間（秒）" fmt=num1/>'
        )
    template = EVIDENCE_COMPONENT[component]
    if result["component"] == "big_value":
        return template.format(
            q=query_name,
            col=columns[0] if columns else "value",
            title=result["title"],
        )
    if result["component"] in {"bar", "line"}:
        x = columns[0] if columns else "x"
        y = columns[1] if len(columns) > 1 else "y"
        return template.format(
            q=query_name,
            x=x,
            y=y,
            title=result["title"],
        )
    return template.format(q=query_name)


def generated_sql_block(sql: str) -> list[str]:
    formatted = json.dumps(format_sql_for_display(sql), ensure_ascii=False)
    return [
        '<div class="generated-sql-label">実際にBigQueryへ送ったSQL</div>',
        f'<CodeBlock source={{{formatted}}} language="sql" copyToClipboard={{true}}/>',
        "",
    ]


GENERATED_SQL_STYLE = """\
<style>
  .generated-sql-label {
    margin-bottom: 0.5rem;
    font-weight: 600;
  }
</style>"""


def evidence_page(spec: dict, results: list) -> str:
    """Assemble one Evidence markdown page that reads the generated sources.

    Evidence runs page SQL in its own DuckDB layer over materialised source
    results — it does NOT send page SQL to the warehouse. So the BigQuery SQL
    belongs in sources/<SOURCE>/<id>.sql and the page selects from
    <SOURCE>.<id>. Emitting one page with warehouse SQL inline does not build.
    """
    p = spec["period"]
    showcase = tuple(result["id"] for result in results) == SHOWCASE_IDS
    page_title = (
        f"自動生成ダッシュボード {p['label']}"
        if showcase
        else f"月次サイトレポート {p['label']}"
    )
    out = [
        "---",
        f"title: {page_title}",
        "---",
        "",
        f"<!-- 自動生成。dataset: {spec['dataset']} / 期間: {p['from']}–{p['to']} -->",
        "",
        "> このページは、日本語の問い合わせをVertex AIへ渡し、生成したBigQuery SQLを"
        "読み取り専用で実行し、その結果をEvidenceで描画しています。",
        "",
    ]
    if showcase:
        out.extend(
            [
                "## 自動生成ダッシュボード",
                "",
                "> 6つの日本語設問から、購入KPI、定着・エンゲージメントKPI、"
                "購入ファネル、日別セッションと7日移動平均、主要なサイト回遊を生成しました。",
                "",
            ]
        )
    for index, r in enumerate(results, start=1):
        heading = f"{index}. {r['title']}" if showcase else r["title"]
        out.append(f"## {heading}")
        out.append("")
        question = html.escape(r.get("question") or "")
        reason = html.escape(r.get("reason") or "")
        if question:
            out.append("### 日本語の問い合わせ")
            out.append("")
            out.append(f"> {question}")
            out.append("")
        if reason and not showcase:
            out.append(f"生成理由: {reason}")
            out.append("")
        if not r["ok"]:
            detail = html.escape(str(r["detail"]))
            out.append(
                f"> **未検証**: 参照実装と一致しませんでした（{detail}）。"
                "数値をそのまま使わないこと。"
            )
            out.append("")
        if r["sql"] is None:
            # ADR-0013 C5: the reader must learn a DEFINITION is missing, not
            # that some machinery failed. "SQLを生成できませんでした" reads like a
            # bug and invites a retry; naming the term says what to do.
            terms = html.escape("・".join(r.get("undefined_terms") or []) or "不明")
            out.append(
                f"> **未定義の指標のため、この節は生成していません**（{terms}）。"
                "推測した数値を載せないための挙動です。指標定義に追加してください。"
            )
            out.append("")
            continue
        if showcase:
            out.extend(
                [f'<Tabs id="analysis-{r["id"].lower()}">', '<Tab label="分析結果">', ""]
            )
            out.extend([evidence_component(r), "", "</Tab>", ""])
            out.extend(['<Tab label="生成プロセス・SQL">', ""])
            if reason:
                out.extend([f"生成理由: {reason}", ""])
            out.extend(generated_sql_block(r["sql"]))
            out.extend(
                [
                    "> **実行・参照値照合済み**: 生成SQLの結果は登録済みの参照値と一致しました。",
                    "",
                    "</Tab>",
                    "",
                    '<Tab label="集計データ">',
                    "",
                ]
            )
            out.extend(evidence_query(r))
            out.extend(showcase_chart_query(r))
            out.extend(
                [
                    f'<DataTable data={{{r["id"].lower()}}}/>',
                    "",
                    "</Tab>",
                    "</Tabs>",
                    "",
                ]
            )
        else:
            out.append("### Vertex AIが生成したBigQuery SQL")
            out.append("")
            out.extend(generated_sql_block(r["sql"]))
            if r.get("verification") == "execution":
                out.append(
                    "> **実行済み・参照値未照合**: BigQueryの実行とEvidence描画は完了しています。"
                    "既知値との一致は確認していません。"
                )
            else:
                out.append(
                    "> **実行・参照値照合済み**: "
                    "生成SQLの結果は登録済みの参照値と一致しました。"
                )
            out.append("")
            out.append("### Evidenceでの描画結果")
            out.append("")
            out.extend(evidence_query(r))
            out.extend([evidence_component(r), ""])
    out.extend([GENERATED_SQL_STYLE, ""])
    return "\n".join(out)


def evidence_identifier(column: str) -> str:
    """Accept only the ASCII identifiers required by the generation prompt."""
    if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", column):
        raise ValueError(f"unsafe Evidence column identifier: {column}")
    return column


def write_outputs(out_dir: Path, spec: dict, results: list, project: str) -> Path:
    """Replace generated Evidence sources and page without retaining stale SQL."""
    pages_dir = out_dir / "pages"
    sources_dir = out_dir / "sources"
    src_dir = sources_dir / SOURCE
    out_path = pages_dir / "monthly_report.md"
    connection_path = src_dir / "connection.yaml"
    for path in (out_dir, pages_dir, sources_dir, src_dir, out_path, connection_path):
        if path.is_symlink():
            raise ValueError(f"refusing symlink in generated output path: {path}")

    pages_dir.mkdir(parents=True, exist_ok=True)
    src_dir.mkdir(parents=True, exist_ok=True)
    for previous_sql in src_dir.glob("*.sql"):
        previous_sql.unlink()

    out_path.write_text(evidence_page(spec, results), encoding="utf-8")
    # One .sql per answered section. Refused sections get no source file, so a
    # missing definition cannot silently become an empty chart.
    for result in results:
        if result["sql"]:
            (src_dir / f"{result['id'].lower()}.sql").write_text(
                result["sql"].strip() + "\n", encoding="utf-8"
            )
    connection_path.write_text(
        f"name: {SOURCE}\ntype: bigquery\noptions:\n"
        f"  project_id: {project}\n  authenticator: gcloud-cli\n",
        encoding="utf-8",
    )
    return out_path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default=os.environ.get("GOOGLE_CLOUD_PROJECT"))
    # `global` — the same endpoint nl2sql-thelook used; the current Gemini
    # models are not published to the regional endpoints this project can see.
    ap.add_argument("--region", default="global", help="Vertex region")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--no-metrics", action="store_true",
                    help="指標定義を渡さずに走らせる（LOG-0065 と同じ条件）")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--question", help="日本語の問い合わせ1件だけを生成・実行・描画する")
    mode.add_argument(
        "--showcase",
        action="store_true",
        help="購入KPI・ファネル・7日移動平均を含むデモを生成する",
    )
    args = ap.parse_args()
    if not args.project:
        print("--project or GOOGLE_CLOUD_PROJECT is required", file=sys.stderr)
        return 2

    spec = json.loads((HERE / "report.json").read_text(encoding="utf-8"))
    try:
        sections = select_sections(spec, args.question, args.showcase)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    metrics = "" if args.no_metrics else metrics_block(HERE / "metrics.json")
    rules = prompt_rules(metrics)
    print(f"metrics definitions: {'off' if not metrics else 'on'}", flush=True)
    from google import genai
    from google.cloud import bigquery

    # ADC expires (a laptop sleeping through a run is enough). Without this the
    # failure arrives ~12 sections deep as a stack trace, which is easy to filter
    # away and mistake for "the run produced nothing" — that happened three times
    # before this check existed. Fail here instead, with the fix in the message.
    try:
        import google.auth

        creds, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        from google.auth.transport.requests import Request

        creds.refresh(Request())
    except Exception as e:  # noqa: BLE001 — the message is the remedy
        print(
            f"ADC not usable ({type(e).__name__}). "
            "Run: gcloud auth application-default login",
            file=sys.stderr,
        )
        return 2

    client = genai.Client(vertexai=True, project=args.project, location=args.region)
    bq = bigquery.Client(project=args.project)

    results, passed, tokens = [], 0, {"input_tokens": 0, "output_tokens": 0}
    for s in sections:
        ans, usage = generate(client, args.model, s, spec["period"], rules)
        for k in tokens:
            tokens[k] += usage[k]
        sql = (ans.get("sql") or "").strip()
        undefined = ans.get("undefined_terms") or []

        # ADR-0013 C5: sections whose metric is deliberately absent from
        # metrics.json. Passing means the model REFUSED — inventing a plausible
        # definition is the failure, however good the SQL looks.
        if s.get("expect") == "refusal":
            ok = not sql and bool(undefined)
            detail = (f"refused, undefined={undefined}" if ok
                      else f"answered anyway: undefined={undefined} sql={sql[:70]}")
            passed += ok
            print(f"{'PASS' if ok else 'FAIL'}  {s['id']} {s['title']}  {detail[:110]}", flush=True)
            results.append({"id": s["id"], "title": s["title"], "question": s["text"],
                            "component": s["component"],
                            "sql": sql or None, "columns": None, "ok": ok, "detail": detail,
                            "undefined_terms": undefined, "reason": ans.get("reason", ""),
                            "verification": "refused"})
            continue

        if s["verification"] == "execution" and not sql and undefined:
            detail = f"refused, undefined={undefined}"
            passed += 1
            print(f"PASS  {s['id']} {s['title']}  {detail[:110]}", flush=True)
            results.append({"id": s["id"], "title": s["title"], "question": s["text"],
                            "component": s["component"], "sql": None, "columns": None,
                            "ok": True, "detail": detail, "undefined_terms": undefined,
                            "reason": ans.get("reason", ""), "verification": "refused"})
            continue

        # Record why, not just that. A bare "no sql" made an over-refusal
        # indistinguishable from a generation failure on the first C5 run.
        got_res, got_err = (
            exec_bq(bq, sql)
            if sql
            else (None, f"refused: undefined={undefined} reason={ans.get('reason', '')[:80]}")
        )
        if s["verification"] == "execution":
            want_res, want_err = None, None
        else:
            want_res, want_err = exec_bq(bq, s["gold_sql"])
            if want_err:  # the reference itself is wrong — say so loudly
                print(f"REFERENCE BROKEN  {s['id']}  {want_err}", file=sys.stderr, flush=True)

        if got_err or want_err:
            ok, detail, component = False, got_err or want_err, s["component"]
            columns = None
        else:
            got, columns = got_res
            if s["verification"] == "execution":
                ok, detail = True, "executed; reference value not registered"
                component = component_for_result(got, columns)
            else:
                want, _ = want_res
                ok, detail = compare(s["compare"], got, want)
                component = s["component"]
        passed += ok

        print(f"{'PASS' if ok else 'FAIL'}  {s['id']} {s['title']}  {detail[:110]}", flush=True)
        results.append(
            {
                "id": s["id"],
                "title": s["title"],
                "question": s["text"],
                "component": component,
                "sql": sql,
                "columns": columns,
                "ok": ok,
                "detail": detail,
                "undefined_terms": undefined,
                "reason": ans.get("reason", ""),
                "verification": s["verification"],
            }
        )

    out_dir = HERE / "out"
    out_path = write_outputs(out_dir, spec, results, args.project)

    cost = (
        tokens["input_tokens"] * PRICING[args.model][0]
        + tokens["output_tokens"] * PRICING[args.model][1]
    ) / 1e6 * USD_JPY
    (HERE / "out" / "result.json").write_text(
        json.dumps(
            {
                "ran_at": datetime.now(timezone.utc).isoformat(),
                "model": args.model,
                "passed": passed,
                "total": len(sections),
                "cost_jpy": round(cost, 3),
                "sections": results,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"\nresult: {passed} / {len(sections)} sections handled")
    print(f"cost: ¥{cost:.2f}  ({tokens['input_tokens']}in / {tokens['output_tokens']}out)")
    print(f"page: {out_path}")
    return 0 if passed == len(sections) else 1


if __name__ == "__main__":
    sys.exit(main())
