---
id: evidence-cloud-visualization-coverage
title: Evidence Cloud可視化カバレッジ
status: draft
updated: 2026-09-14
---

# Evidence Cloud可視化カバレッジ

## 1. 目的

利用者の目的からAIが分析仕様を作るとき、選択できる可視化と必要な結果形状を対象非依存の契約として管理する。
Evidenceのcomponentは比較対象であり、EvidenceまたはEChartsを製品runtimeへ固定する根拠にはしない。

一次資料は2026-08-28時点の[Evidence All Components](https://docs.evidence.dev/components/all-components)と
[Custom ECharts](https://docs.evidence.dev/components/charts/custom-echarts)である。

## 2. 判定基準

| 状態 | 意味 |
|---|---|
| 契約あり | plannerの入力形状、SQL出力role、行数上限、結果validatorが対象非依存で定義済み |
| end-to-end対応 | 契約に加え、対象非依存runtime entryとrendererを同じ経路で検証済み |
| 未対応 | 必要な契約または安全なrendererがない |

AIの許可enumへchart名を追加しただけではend-to-end対応にしない。固定fixtureの描画も、未知の分析対象を同じ
runtimeで処理できる証拠には数えない。

## 3. 現在地

`visualization_contracts.py`は42個のchart identifierについて、入力するdimension／measure数、SQL出力role、
最大行数を定義する。`visualization_sections.py`は確定した分析仕様をSQL生成用の結果形状へ変換し、
`visualization_results.py`は取得結果を検査する。

旧HTTP／UI／renderer／Evidence adapterは、対象別profileと一体の経路だったため2026-09-14に削除した。
したがって現在の42種類はすべて「契約あり」であり、「end-to-end対応」ではない。`make demo`も提供しない。

契約の分類は次のとおり。

| 分類 | chart identifier |
|---|---|
| scalar／比較 | `scorecard`、`kpi_group`、`delta`、`comparison_table` |
| category／composition | `bar`、`grouped_bar`、`stacked_bar`、`percent_stacked_bar`、`donut`、`pie` |
| time／series | `line`、`multi_line`、`area`、`stacked_area`、`percent_stacked_area`、`calendar_heatmap`、`annotated_line`、`sparkline`、`mixed_bar_line` |
| distribution／relationship | `histogram`、`scatter`、`bubble`、`heatmap`、`box_plot`、`box_plot_horizontal` |
| table | `table`、`pivot_table`、`sparkline_table` |
| flow／hierarchy | `funnel`、`funnel_horizontal`、`sankey`、`sankey_vertical`、`flow_sankey`、`flow_sankey_vertical`、`treemap` |
| geography／reference | `area_map`、`us_map`、`point_map`、`bubble_map`、`base_map`、`reference_line`、`reference_area` |

段階付きSankeyはWebページを前提にしない。任意の段階遷移を最大4段階・上位10経路へ制限し、source／targetの
隣接edgeとして扱う。URL正規化、ページ回遊、特定eventなどの規則を共通契約へ入れてはいけない。

## 4. 実装の正本

- planner／相談: [`analysis_planner.py`](../../spikes/report-generation/analysis_planner.py)、
  [`analysis_consultation.py`](../../spikes/report-generation/analysis_consultation.py)
- canonical contract文脈: [`analysis_contract_context.py`](../../spikes/report-generation/analysis_contract_context.py)
- chart capability: [`visualization_contracts.py`](../../spikes/report-generation/visualization_contracts.py)
- SQL出力形状: [`visualization_sections.py`](../../spikes/report-generation/visualization_sections.py)
- 実行前・実行後検査: [`contract_sql_validation.py`](../../spikes/report-generation/contract_sql_validation.py)、
  [`contract_result_validation.py`](../../spikes/report-generation/contract_result_validation.py)、
  [`visualization_results.py`](../../spikes/report-generation/visualization_results.py)
- panel実行順: [`section_execution.py`](../../spikes/report-generation/section_execution.py)

## 5. renderer再実装の条件

rendererは、認可済みconnection scopeからcanonical contractを生成する対象非依存runtime entryの完成後に実装する。
次をすべて満たすまでchartをend-to-end対応と表示しない。

1. planner、SQL生成、dry run、実行、結果検査、rendererが同じcontract fingerprintを参照する。
2. rendererは宣言的な結果形状だけを受け取り、任意JavaScriptを生成AIへ書かせない。
3. 表示上のformatやfallback tableがwarehouseの値を変更しない。
4. 同一binary・prompt・設定で未知schemaの結果を描画する。
5. accessibilityと狭いviewportを検証する。

## 6. 将来の可視化選定skill

現行plannerは分析内容とchartを一度に提案する。将来、実測で必要になった場合だけ次の二段階へ分離する。

1. 利用者の意思決定、仮説、canonical contractから分析仕様を考察する。
2. 仕様と実装済みchart capabilityを照合し、実行可能な候補を最大3件まで理由付きで比較する。

固定の一対一規則、業種別template、対象別設定、黙ったchart置換は導入しない。候補がすべて不適合なら、
除外理由を返して停止する。顧客固有の表示嗜好を製品共通skillへ自動反映しない。

このskillの製品実装は、対象非依存runtimeとAI-only plannerの反復評価が安定し、chart選定を別工程にする必要が
実測された場合だけIssue化する。
