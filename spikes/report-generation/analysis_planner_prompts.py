"""Prompt builders for analysis planning and consultation."""

from __future__ import annotations

import json

from analysis_planner_contracts import PlannerError


def build_dashboard_planning_request(
    objective: str,
    period: dict[str, str],
    metrics: str,
    answers: dict[str, str],
    *,
    current_plan: dict | None,
    instruction: str | None,
    initial_panel_count: int,
    max_panel_count: int,
    dynamic_panel_fields: tuple[str, ...],
    max_sankey_paths: int,
    max_sankey_pages: int,
) -> str:
    """Build an initial or iterative dashboard planning request."""
    if (current_plan is None) != (instruction is None):
        raise PlannerError("現在案と変更依頼は一緒に指定してください。")
    answered = json.dumps(answers, ensure_ascii=False, sort_keys=True)
    if current_plan is None:
        revision_context = f"""これは初回提案である。
- 最初から大量に列挙せず、今回の目的に適したパネルを{initial_panel_count}件提案する。"""
    else:
        current = {
            "objective_summary": current_plan.get("objective_summary"),
            "audience": current_plan.get("audience"),
            "comparison": current_plan.get("comparison"),
            "hypotheses": current_plan.get("hypotheses"),
            "panels": [
                {field: panel.get(field) for field in dynamic_panel_fields}
                for panel in current_plan.get("panels", [])
            ],
        }
        revision_context = f"""これは現在案への追加・変更・削除相談である。
利用者の変更依頼: {instruction}
現在の分析仕様: {json.dumps(current, ensure_ascii=False, sort_keys=True)}
- 変更依頼の意味を解釈し、変更後の分析仕様をpanelsへすべて返す。
- 利用者が変更または削除を求めていない既存仕様は、意味、順序、文言を維持する。
- 新しい仕様は既存仕様と重複させず、変更後は重複なしの1〜{max_panel_count}件にする。
- 上限{max_panel_count}件へ達した場合は追加せず、その理由を目的要約へ明記する。"""
    return f"""次の依頼から、月次ECサイト分析ダッシュボードを計画する。

依頼: {objective}
対象期間: {period['label']}
読者回答: {answered}
{revision_context}
スキーマ・指標定義:
{metrics}

規則:
- 目的を意思決定へ言い換え、検証可能な仮説を最大3件にする。
- 固定済みの分析候補から選ばず、目的と仮説から分析仕様そのものを新規に考える。
- 各パネルには構造化出力schemaで要求された分析仕様と、SQL生成へ渡す具体的な1行の日本語execution_promptを書く。
- execution_promptにはSQLを書かない。対象期間、比較、必要な出力の意図が分かる自然な仕様にする。
  dimensionsとmeasuresは構造化フィールドを正本とし、execution_promptで表示名を逐語的に繰り返す必要はない。
- 比較や派生指標が意思決定に有用なら候補として提案してよい。ただし、データソースから確認できる
  期間・粒度・指標で実行できるかを判断し、追加の範囲や定義が必要ならclarificationsで確認する。
  確認前のexecution_promptやmeasuresには未確認の実行条件を含めず、確認済みなら必要な期間と出力列を
  仕様へ明示する。
- 各可視化の結果は最大行数以内で判断できる集計粒度にする。高カーディナリティの区分軸は上位件数と並び順をexecution_promptへ明記する。
- ページ回遊のsankeyは上位{max_sankey_paths}経路・最大{max_sankey_pages}ページにする。指定した最終ページへ到達した完全な経路を集計して上位経路を選んだ後、dimensionsを遷移元・遷移先の2件とする隣接edgeへ変換する手順をexecution_promptへ明記する。
- KPI・グラフの選択理由をパネルごとに日本語で説明する。
- 初回は audience / comparison / business_goal から重要な確認を1〜3件だけ質問する。
- 読者回答にあるfieldは再質問しない。十分ならclarificationsを空にする。
- 利用できない指標や因果関係を捏造しない。
- measuresは上の「指標定義」に名前がある指標だけにする。目標値や目標達成度など、定義にない基準を作らない。
"""


def build_consultation_request(
    question: str,
    history: list[dict[str, str]],
    context: str,
    profile: str,
) -> str:
    """Build one bounded, history-aware consultation turn."""
    transcript = "\n".join(
        f"{item['role']}: {item['content']}" for item in history
    ) or "（初回）"
    return f"""日本語で分析テーマを相談する。SQLやデータ取得はまだ行わない。

これまでの対話:
{transcript}

今回の利用者発言: {question}

分析対象profile: {profile}
利用できるスキーマ・指標・期間の文脈:
{context}

規則:
- 今回の発言と対話履歴を踏まえ、分析担当者として自然な日本語で応答する。
- 分析仮説を立て、目的に役立つ新しい分析仕様を1〜4件考える。
- 各仕様には、measures、dimensions、比較軸、可視化、選択理由、SQL生成へ渡せる具体的な日本語依頼を書く。
- 可視化を含む分析内容は今回の目的から考え、選択理由をreasonへ書く。
- 「他にない」など別案を求められた場合、履歴で既に提示した分析をできる限り避ける。
- 最後に、分析目的を具体化する短い確認質問を1件だけ書く。
- 文脈にない指標・列・因果関係・取得済みでない数値を捏造しない。
- SQLは書かない。execution_promptは、別工程のSQL生成AIへ渡す1行の日本語仕様にする。
  dimensionsとmeasuresは構造化フィールドを正本とし、自然な言い換えを許容する。
- 固定例から選択したように見せず、今回の目的に対する考察をassistant_messageとreasonへ明示する。
"""
