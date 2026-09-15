---
id: evidence-cloud-visualization-coverage
title: Evidence Cloud可視化カバレッジ
status: draft
updated: 2026-09-15
---

# Evidence Cloud可視化カバレッジ

## 1. 目的と調査範囲

利用者の目的からAIがダッシュボードを設計するには、分析内容だけでなく、その判断に適した可視化を
選べる必要がある。この文書は、Evidence Cloudで利用できるEvidenceの可視化を基準に、RepChatの
現在のend-to-end対応を整理する。

一次資料は2026-08-28時点の[Evidence All Components](https://docs.evidence.dev/components/all-components)と
[Custom ECharts](https://docs.evidence.dev/components/charts/custom-echarts)である。Evidence Cloudのeditorは
Evidence projectを扱うが、公式の可視化component一覧はEvidence Docsにあるため、製品名と描画基盤を区別する。

公式一覧には、chart componentが15種類、map componentが5種類、data componentが4種類ある。
`ECharts Options`はchartの設定方法であり、独立したグラフ種類としては数えない。

`Custom ECharts`は設定objectを受け取り、EChartsのfull suiteを利用できる。したがって「Evidence Cloudで
用意されている全グラフ」は有限の標準componentだけではない。本書では次の順に管理する。

1. Evidenceの標準chart component
2. 標準chartのvariantと補助表現
3. map component
4. 公式Custom ECharts例
5. 任意EChartsは個別の安全・データ形状契約を追加する拡張枠

## 2. 判定基準

| 状態 | 意味 |
|---|---|
| 対応 | 日本語要件→SQL→結果形状検査→描画まで再現できる |
| 部分対応 | 一部variantまたは特定の固定用途だけ再現できる |
| 未対応 | renderer、結果形状契約、またはSQL生成契約がない |

AI plannerの選択肢に文字列を追加しただけでは「対応」にしない。実データで結果形状を検査し、描画できることを
必須とする。

分析テーマ、KPI、比較軸、chart type、panel数を業種別の固定候補から決めない。AIは利用者の目的、対話履歴、
利用可能schema・metricと、この文書で`対応`になった可視化能力から都度提案する。コードが持ってよい固定値は、
SQL安全規則、結果形状契約、対応済みchart typeの許可集合、管理者が変更できる費用・件数ポリシーに限る。
旧デモの固定分析は再現fixtureと回帰試験から通常plannerへ逆流させない。

### 2.1 現在AI plannerが選べる42種類

| RepChatの指定値 | Evidence上の対応 | 判定 | 制約 |
|---|---|---|---|
| `scorecard` / `kpi_group` | Big Value | 対応 | 1〜4件の定義済みKPIを1行で返す |
| `bar` / `grouped_bar` / `stacked_bar` / `percent_stacked_bar` | Bar Chart | 部分対応 | 区分数とラベル密度に応じた縦棒／横棒、grouped、stacked、100% stackedのwide形式。利用者指定orientationは未対応 |
| `line` / `multi_line` | Line Chart | 部分対応 | 1〜4系列。複数系列は色付き独立縦軸で値を表示する |
| `area` / `stacked_area` / `percent_stacked_area` | Area Chart | 対応 | 基本area、stacked area、100% stacked areaのwide形式 |
| `histogram` | Histogram | 対応 | numericの階級下限と度数を返す |
| `calendar_heatmap` | Calendar Heatmap | 対応 | 日付と1指標を最大5年まで返し、年ごとにcalendarを分ける |
| `scatter` / `bubble` | Scatter / Bubble Chart | 対応 | category、任意のseries、x、y、任意のsizeを返す |
| `funnel` / `funnel_horizontal` | Funnel Chart | 対応 | 順序付きstageと非負値を返し、縦向き／横向きを選ぶ |
| `heatmap` | Heatmap | 対応 | 2区分軸と1指標を返す |
| `table` | Data Table | 対応 | 1〜4区分軸、1〜4指標。検索、安定ソート、ページ送り、CSV、全画面、固定見出し・先頭列、数値バーに対応 |
| `pivot_table` | Data Table Pivoting | 対応 | 行区分、列区分、1〜4指標のlong形式を検査し、欠損組合せを空欄に保ってwide表示する |
| `comparison_table` | Data Table Comparison / Delta | 対応 | 1〜4区分と比較対象の定義済み指標1件を受け取る。比較条件は実行仕様へ明記し、SQLは同じ指標の現在値、比較値、差分を返す。差分の算術整合性を検査して増減方向を中立色で表示する |
| `sparkline_table` | Data Table Sparkline | 対応 | 区分、日付、値のlong形式を検査し、区分ごとの最新値とECharts sparklineを表示する |
| `sankey` / `sankey_vertical` | Sankey Diagram | 対応 | 上位10経路、最大4ページの段階付きサイト回遊を縦向き／横向きで描く |
| `flow_sankey` / `flow_sankey_vertical` | Sankey Diagram | 対応 | 最大50edgeの非循環flowを縦向き／横向きで描く |
| `donut` | Custom ECharts Donut例 | 部分対応 | 12区分までの非負値。安全な宣言的rendererだけを使う |
| `annotated_line` | Annotations | 部分対応 | 日付、任意の注釈ラベル、1指標を返し、根拠のある時点だけをpin表示する |
| `sparkline` | Sparkline | 対応 | 日付と1指標を返し、最新値と軸を省略した小型時系列を表示する |
| `mixed_bar_line` | Mixed-Type Charts | 対応 | 1区分軸と2〜4指標を返し、第1系列をbar、残りをlineで描く。非負値はゼロ基準の独立軸、目盛は系列色と万・億・兆の短縮表示を使い、正確な値をtooltipと表に保持する |
| `delta` | Delta | 対応 | 現在値と比較値を1行で返し、良否を推測せず符号付き差分を中立色で示す |
| `box_plot` / `box_plot_horizontal` | Box Plot | 対応 | 区分、最小、第1四分位、中央値、第3四分位、最大を昇順で返す |
| `treemap` | Custom ECharts Treemap例 | 対応 | 1〜4階層と非負値を返し、末端までの階層を宣言的に描く |
| `pie` | Custom ECharts Pie例 | 対応 | 12区分までの非負値を全円で描く |
| `area_map` / `us_map` | Area Map / US Map | 対応 | 地域ID、Polygon/MultiPolygon GeoJSON、非負値をwarehouseから返す |
| `point_map` / `bubble_map` | Point Map / Bubble Map | 対応 | query提供の地理境界、地点名、緯度経度、値と任意のsizeを返す |
| `base_map` | Base Map | 対応 | area／point／bubbleの複数layerを同じquery結果で返す |
| `reference_line` / `reference_area` | Annotations | 対応 | 実績と基準値、または実績と下限・上限を区分ごとに返す |

相談・単一分析・計画・会議報告のAIワークフローは
[`analysis_workflows.py`](../../spikes/report-generation/analysis_workflows.py)、plannerとSQL生成担当に共通するstructured response診断は
[`structured_response.py`](../../spikes/report-generation/structured_response.py)、会議報告の応答schemaと制限値は
[`meeting_report_contracts.py`](../../spikes/report-generation/meeting_report_contracts.py)、plannerの応答schemaとschema builderは
[`analysis_planner_contracts.py`](../../spikes/report-generation/analysis_planner_contracts.py)、plannerの応答件数ポリシーも同contractsで管理し、plannerがAIへ渡す依頼文は
[`analysis_planner_prompts.py`](../../spikes/report-generation/analysis_planner_prompts.py)、単一インサイト相談のschema・検証・AI呼び出しは
[`analysis_consultation.py`](../../spikes/report-generation/analysis_consultation.py)、SQL担当AIの生成・修正依頼は
[`sql_generation.py`](../../spikes/report-generation/sql_generation.py)、SQL担当AIへ渡すデータソースschema・指標定義・規則文は
[`sql_prompt_context.py`](../../spikes/report-generation/sql_prompt_context.py)、planner出力の目的・期間・確認事項・revisionと文字列・軸・指標・可視化形状の検証は
[`analysis_planner_validation.py`](../../spikes/report-generation/analysis_planner_validation.py)、plannerの許可値と形状・行数上限は
[`visualization_contracts.py`](../../spikes/report-generation/visualization_contracts.py)、SQL出力契約は
[`visualization_sections.py`](../../spikes/report-generation/visualization_sections.py)、パネル形状固有の実行前SQL・dry-run検証は
[`sql_contract_validation.py`](../../spikes/report-generation/sql_contract_validation.py)、データセット境界のSQL検証・dry-run schema検査・BigQuery実行は
[`bigquery_execution.py`](../../spikes/report-generation/bigquery_execution.py)、結果形状検証は
[`visualization_results.py`](../../spikes/report-generation/visualization_results.py)、各モジュールの失敗をライブデモの公開エラー・期間・検証契約へ変換する境界は
[`live_contracts.py`](../../spikes/report-generation/live_contracts.py)、1パネルの生成から実行までの順序は
[`section_execution.py`](../../spikes/report-generation/section_execution.py)、確定パネルから根拠bundleを組み立てる順序は
[`dashboard_build.py`](../../spikes/report-generation/dashboard_build.py)、実描画は
[`chart_renderer_dispatch.js`](../../spikes/report-generation/chart_renderer_dispatch.js)、Evidenceのpage組み立ては
[`evidence_page.py`](../../spikes/report-generation/evidence_page.py)、成果物の安全なファイル出力は
[`evidence_output.py`](../../spikes/report-generation/evidence_output.py)、componentへの変換は
[`evidence_components.py`](../../spikes/report-generation/evidence_components.py)を根拠とする。
旧ライブデモ入口はPR #709で削除済みであり、残る`live_engine.py`、`live_http*.py`、
`live_ui_shell.py`、`live_ui_theme.py`は実行入口から未参照の旧補助moduleとして削除対象です。

## 3. 標準chart component

| Evidence component | 公式に掲載される主なvariant | RepChat | 現在の根拠・不足 |
|---|---|---|---|
| Area Chart | basic、stacked、100% stacked | 対応 | basic、stacked、100% stackedへ対応 |
| Bar Chart | basic、stacked、100% stacked、grouped、horizontal各種、long | 部分対応 | basic、stacked、100% stacked、groupedと、区分数・ラベル密度から選ぶ縦棒／横棒に対応。利用者が任意に固定するorientation、longは未対応 |
| Box Plot | basic、horizontal | 対応 | 五数要約の順序を検査し、縦向き／横向きを描画する |
| Bubble Chart | single／multiple series | 対応 | 1区分軸のsingle seriesと、2区分軸のmultiple seriesへ対応 |
| Histogram | default | 対応 | numericの階級下限と度数を検査して描画する |
| Line Chart | single、multiple series、multiple Y columns | 対応 | 1〜4系列と独立縦軸、bar＋lineのseries別typeへ対応 |
| Scatter Plot | single／multiple series | 対応 | 1区分軸のsingle seriesと、2区分軸のmultiple seriesへ対応 |
| Calendar Heatmap | single year、multi-year | 対応 | date、valueを最大5年まで受け取り、年ごとのcalendarへ分離する |
| Heatmap | basic、customized | 対応 | x category、y category、valueの基本形に対応 |
| Funnel Chart | default、side aligned | 対応 | 任意の順序付きstageを縦向き／横向きで描画する |
| Sankey Diagram | horizontal、vertical | 対応 | 段階付き回遊と一般的な非循環flowを縦向き／横向きで描画する |

標準chart componentはこの11種類に、§4のAnnotations、Sparkline、Mixed-Type Chartsと、§6のCustom
EChartsを加えた15種類である。

## 4. chart補助表現とdata component

| Evidence component | RepChat | 現在の根拠・不足 |
|---|---|---|
| Annotations | 対応 | 実データpoint、reference line、上下限reference areaを検証済み列契約から描画する |
| Sparkline | 対応 | 最新値を伴う小型時系列を独立した検証済みcomponentとして描画する |
| Mixed-Type Charts | 対応 | 第1系列bar＋残りlineの宣言的な列契約を持つ |
| Big Value | 対応 | 1行1列のscalarと、既知のKPI pairを描画できる |
| Value | 部分対応 | 数値formatはあるが、Evidenceのinline Value componentとしては生成しない |
| Data Table | 対応 | 検索、安定ソート、ページ送り、CSV、全画面、固定見出し・先頭列、交互行、数値バー、pivot、算術検証済みcomparison/delta、ECharts sparklineを備える。計算指標とgroupingは通常の自然言語SQL生成で扱い、rendererが集計値を推測しない |
| Delta | 対応 | 現在値、比較値、符号付き差分を表示し、指標定義なしに良否を推測しない |

## 5. map component

| Evidence component | RepChat | 現在の不足 |
|---|---|---|
| Area Map | 対応 | region key、GeoJSON Polygon/MultiPolygon、非負valueを検査して描画する |
| Bubble Map | 対応 | query提供GeoJSON、地点名、緯度経度、非負size／valueを検査して描画する |
| Point Map | 対応 | query提供GeoJSON、地点名、緯度経度、非負valueを検査して描画する |
| Base Map | 対応 | query提供GeoJSON上にarea、point、bubbleの検証済みlayerを重ねる |
| US Map | 対応 | 2文字の州・地域code、GeoJSON境界、非負valueを検査して描画する |

## 6. Custom ECharts

Evidenceの公式ページには、Custom ECharts例として次が掲載されている。

| 公式例・拡張枠 | RepChat | 現在の不足 |
|---|---|---|
| Treemap | 対応 | 1〜4階層の空でない項目名と非負値を検査して描画する |
| Pie Chart | 対応 | Donutと独立した全円表示契約を持つ |
| Donut Chart | 部分対応 | name、非負value、最大12区分、割合tooltip、中心合計を描画する |
| Custom Funnel | 対応 | 順序接頭辞を持つ任意の段階と非負値を検査し、縦向き／横向きを描画する |
| Advanced／任意ECharts | 未対応 | 任意JavaScript configは安全性、再現性、accessibilityを保証できない |

Pie ChartとDonut ChartはEvidenceの独立した標準componentではなく、Custom EChartsの公式例である。
RepChatでは利用者から見たchart typeとして提供できるが、実装上は安全な宣言的schemaからEvidenceの
Custom ECharts設定へ変換する必要がある。

任意ECharts configを生成AIへ直接書かせることは、script注入、過剰なoption、再現不能なdata埋め込み、
accessibility欠落につながるため、初期方針にはしない。RepChat側でchart typeごとの宣言的schema、許可option、
結果形状validator、accessible fallback tableを定義したものから順にplannerへ解放する。

## 7. 現在の要約

RepChatのlocal demoは42個の指定値にrendererと結果形状契約を持つ。2026-08-28に同じECharts assetとrendererへ
42種類の代表fixtureを渡してブラウザ確認し、描画エラーと横方向overflowが0件であることを確認した。これは
全chartについて、plannerの定義済み元指標とSQLの派生出力役割が実サービスで一致したことを意味しない。
2026-09-11に見つかった`comparison_table`の不一致はIssue #658で修正し、同じ構造を持つchartの監査は
[Issue #659](https://github.com/Yukihide-Mitsuoka/repchat/issues/659)で追跡する。縦向きSankey 2種類はカード上限と
同じ440pxへ揃えた。任意Custom EChartsだけは、AI生成JavaScriptを実行する安全性・再現性・accessibilityを
保証できないため、意図的に許可していない。

AIには、各chartの結果形状とrendererを実装しend-to-end契約を試験した42種類だけを許可enumとして渡す。
許可enumと指標定義は依頼ごとに中立な順序へ変換し、列挙順を提案順位として使わせない。
初回提案数と上限は管理者ポリシーとして設定でき、デモ既定値はそれぞれ6件と20件である。例えば上限を15件へ
変更できる。この件数境界は費用と画面密度を制御するものであり、AIが何を分析するかは固定しない。
panel数ポリシーとchart coverageは別の軸として管理する。

## 8. 将来の可視化選定skill

### 8.0 現行plannerとの差分

現行のdashboard plannerは、利用者の目的・仮説の考察と、対応済みグラフ種類からの選択を1回のVertex AI呼出しで同時に行う。`DASHBOARD_CHARTS`と結果形状schemaは選択可能な範囲を制限するが、グラフ候補の適合度を別工程で評価したり、目的に対する候補を順位付けしたりはしない。対応外グラフや結果形状不一致を、別のグラフへ自動置換するfallbackも持たない。

この状態を現在のbaselineとして記録し、将来機能では次の二段階を分離する。

1. 利用者の意思決定、仮説、指標、データ形状から分析仕様を考察する。
2. その分析仕様と実装済みのchart capabilityを照合し、実行可能な候補を比較して選ぶ。

二段階化後も、分析テーマやpanelを固定候補から選ぶ仕組みにはしない。実行不能な候補の除外は決定的な契約で行い、複数候補の優先順位と選定理由はAIが返す。候補がすべて不適合な場合は、近似グラフへ黙って置換せず、除外理由と利用者向けの修正案を返す。

### 8.1 目的と境界

AIがchart typeを選べるだけでは、適切な可視化を選べることを意味しない。将来は、分析目的、実データの形状、
読者と表示領域から候補を比較する`可視化選定skill`を、AI plannerへ適用する。

このskillは製品共通のversioned knowledgeであり、分析結果を固定するtemplateではない。例えば「時系列なら常に
Line」「構成比なら常にDonut」のような一対一規則を最終判断として持たない。実行不能な組み合わせを除外する
決定的な契約と、複数候補を理由付きで順位付けするAI判断を分離する。

顧客固有の表示嗜好、用語、意思決定周期は
[適応型分析メモリー](adaptive-analysis-memory.md)で管理する。顧客の修正を製品共通skillへ自動反映せず、
匿名化・opt-in・人間レビューを満たす別の製品改善手続きがない限りtenant間で共有しない。

### 8.2 入出力契約

| 入力 | 例 |
|------|----|
| 意思決定・分析目的 | 時系列変化、順位、分布、関係、構成、flow、地理、目標差、異常検知 |
| データ意味 | metric定義、dimension、単位、増減の良否、母数、集計grain |
| 実データ形状 | 列のsemantic type、行数、cardinality、期間点数、series数、null、負値、外れ値 |
| 表示文脈 | 読者、dashboard上の幅・高さ、desktop／mobile、他panelとの読順 |
| 実装能力 | `対応`済みchart、variant、必要な結果形状、accessibility fallback |
| 適用文脈 | 承認済み組織コンテキスト、分析recipe、user表示嗜好と各revision |

| 出力 | 必須内容 |
|------|----------|
| 推奨候補 | chart typeとvariantを順位付きで最大3件 |
| 選定理由 | どの目的・データ特性・読者判断を支えるか |
| 必要な変換 | bin、top-N、期間grain、正規化、累積、stack等。SQL生成前に確認できる宣言形式 |
| 不適合理由 | 除外した主要候補と、cardinality過多、点数不足、誤解リスク等の理由 |
| 表示契約 | axis、format、legend、annotation、色の意味、fallback table |
| confidence | 根拠となるskill revision、適用規則、未確認事項 |

### 8.3 選定手順

1. rendererと結果形状契約に基づき、実行不能なchartを決定的に除外する。
2. 目的と想定データ形状に関係するskill項目だけを、token budget内でplannerへ渡す。
3. AIが複数候補を理由付きで順位付けし、分析計画へ保存する。skillは分析テーマを決めない。
4. SQL実行後に実際の行数、cardinality、null、series数を再検査する。
5. 想定と実データが違う場合は描画を強行せず、代替chartまたはtableを提案して利用者へ差分を示す。
6. 利用者の変更はsessionへ反映し、次回も必要ならscope付きメモリー候補にする。共通skillは自動更新しない。

### 8.4 versionと評価

skill revisionは`skill_id`、version、status、適用可能なchart capability version、根拠、反例、作成者、
reviewer、公開日を持つ。AI呼出しとartifact manifestには、適用したskill revisionと選定理由を記録する。

| 品質指標 | 目標・検証 |
|----------|------------|
| 未対応chartの選択 | 0件。capability contract testで拒否する |
| 結果形状不一致の正常描画 | 0件。query-result fixtureでfail closedを確認する |
| 不適切chart率 | intent・shape別benchmarkを人間がblind評価し、導入前baselineより低下させる |
| 実行後のchart変更率 | 想定形状と実形状の差を計測し、skill revisionごとに追跡する |
| 利用者の採用・変更率 | scope、目的、chart type別に集計し、顧客横断の本文や値を保存しない |
| 説明可能性 | 100%の提案でskill revision、候補、理由、除外理由を再現できる |

### 8.5 実装順序

1. 本書のchartごとに結果形状契約、renderer、fallback tableを実装し、対応済み能力を機械可読catalogにする。
2. 製品共通の静的skill revisionとintent・shape benchmarkを人間レビュー付きで作る。初期retrievalはenumと
   semantic typeによる決定的な選択とし、vector DBを前提にしない。
3. AI plannerへ候補・理由・変換・confidenceのschemaを追加し、実行後の形状再検査まで接続する。
4. design partnerの明示的な修正を分析メモリー候補として扱い、採用率と再修正率を測る。
5. 十分な評価dataが得られた後だけ、共通skillの更新候補をoffline評価する。自動公開・自動昇格はしない。
