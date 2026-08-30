"""Evidence page Markdown assembly for generated analysis results."""

from __future__ import annotations

import html
import json

from evidence_components import evidence_component, evidence_query

GENERATED_SQL_STYLE = """\
<style>
  .generated-sql-label {
    margin-bottom: 0.5rem;
    font-weight: 600;
  }
</style>"""


def generated_sql_block(sql: str, *, format_sql) -> list[str]:
    """Render one copyable display-only SQL block."""
    formatted = json.dumps(format_sql(sql), ensure_ascii=False)
    return [
        '<div class="generated-sql-label">実際にBigQueryへ送ったSQL</div>',
        f'<CodeBlock source={{{formatted}}} language="sql" copyToClipboard={{true}}/>',
        "",
    ]


def evidence_page(spec: dict, results: list, *, format_sql) -> str:
    """Assemble one Evidence markdown page that reads generated sources.

    Evidence runs page SQL in its own DuckDB layer over materialised source
    results — it does NOT send page SQL to the warehouse. So the BigQuery SQL
    belongs in sources/<SOURCE>/<id>.sql and the page selects from
    <SOURCE>.<id>. Emitting one page with warehouse SQL inline does not build.
    """
    period = spec["period"]
    page_title = f"月次サイトレポート {period['label']}"
    out = [
        "---",
        f"title: {page_title}",
        "---",
        "",
        (
            f"<!-- 自動生成。dataset: {spec['dataset']} / "
            f"期間: {period['from']}–{period['to']} -->"
        ),
        "",
        "> このページは、日本語の問い合わせをVertex AIへ渡し、生成したBigQuery SQLを"
        "読み取り専用で実行し、その結果をEvidenceで描画しています。",
        "",
    ]
    for result in results:
        out.append(f"## {result['title']}")
        out.append("")
        question = html.escape(result.get("question") or "")
        reason = html.escape(result.get("reason") or "")
        if question:
            out.append("### 日本語の問い合わせ")
            out.append("")
            out.append(f"> {question}")
            out.append("")
        if reason:
            out.append(f"生成理由: {reason}")
            out.append("")
        if not result["ok"]:
            detail = html.escape(str(result["detail"]))
            out.append(
                f"> **未検証**: 参照実装と一致しませんでした（{detail}）。"
                "数値をそのまま使わないこと。"
            )
            out.append("")
        if result["sql"] is None:
            # ADR-0013 C5: the reader must learn a DEFINITION is missing, not
            # that some machinery failed. Naming the term says what to do.
            terms = html.escape("・".join(result.get("undefined_terms") or []) or "不明")
            out.append(
                f"> **未定義の指標のため、この節は生成していません**（{terms}）。"
                "推測した数値を載せないための挙動です。指標定義に追加してください。"
            )
            out.append("")
            continue
        out.append("### Vertex AIが生成したBigQuery SQL")
        out.append("")
        out.extend(generated_sql_block(result["sql"], format_sql=format_sql))
        if result.get("verification") == "execution":
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
        out.extend(evidence_query(result))
        out.extend([evidence_component(result), ""])
    out.extend([GENERATED_SQL_STYLE, ""])
    return "\n".join(out)
