---
id: evidence-cloud-visualization-coverage
title: Evidence Cloud可視化カバレッジ
status: draft
updated: 2026-08-15
---

# Evidence Cloud可視化カバレッジ

## 1. 目的と調査範囲

利用者の目的からAIがダッシュボードを設計するには、分析内容だけでなく、その判断に適した可視化を
選べる必要がある。この文書は、Evidence Cloudで利用できるEvidenceの可視化を基準に、RepChatの
現在のend-to-end対応を整理する。

一次資料は2026-08-11時点の[Evidence All Components](https://docs.evidence.dev/components/all-components)と
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

### 2.1 現在AI plannerが選べる18種類

| RepChatの指定値 | Evidence上の対応 | 判定 | 制約 |
|---|---|---|---|
| `scorecard` / `kpi_group` | Big Value | 対応 | 1〜4件の定義済みKPIを1行で返す |
| `bar` / `grouped_bar` / `stacked_bar` | Bar Chart | 部分対応 | 横棒、grouped、stackedのwide形式。100% stackedは未対応 |
| `line` / `multi_line` | Line Chart | 部分対応 | 1〜4系列。複数系列は色付き独立縦軸で値を表示する |
| `area` / `stacked_area` | Area Chart | 部分対応 | 基本areaとwide形式のstacked area。100% stackedは未対応 |
| `histogram` | Histogram | 対応 | numericの階級下限と度数を返す |
| `calendar_heatmap` | Calendar Heatmap | 対応 | 日付と1指標を最大366日まで返す |
| `scatter` / `bubble` | Scatter / Bubble Chart | 部分対応 | category、x、y、任意のsizeを返す。複数seriesは未対応 |
| `funnel` | Funnel Chart | 部分対応 | 順序付きstageと非負値を返す |
| `heatmap` | Heatmap | 対応 | 2区分軸と1指標を返す |
| `table` | Data Table | 対応 | 1〜4区分軸、1〜4指標。Evidence固有の高度な表機能は対象外 |
| `sankey` | Sankey Diagram | 部分対応 | 上位10経路、最大4ページの段階付きサイト回遊に限定する |
| `donut` | Custom ECharts Donut例 | 部分対応 | 12区分までの非負値。安全な宣言的rendererだけを使う |

plannerの許可値は
[`analysis_planner.py`](../../spikes/report-generation/analysis_planner.py)の`DASHBOARD_CHARTS`、
実描画は[`live_demo.py`](../../spikes/report-generation/live_demo.py)の`graph`、Evidence成果物への変換は
[`run_report.py`](../../spikes/report-generation/run_report.py)の`evidence_component`を根拠とする。

## 3. 標準chart component

| Evidence component | 公式に掲載される主なvariant | RepChat | 現在の根拠・不足 |
|---|---|---|---|
| Area Chart | basic、stacked、100% stacked | 部分対応 | basicとstackedに対応。100% stackedは未対応 |
| Bar Chart | basic、stacked、100% stacked、grouped、horizontal各種、long | 部分対応 | basic、stacked、groupedに対応。100%、任意orientation、longは未対応 |
| Box Plot | basic、horizontal | 未対応 | quartile／whiskerの結果契約とrendererがない |
| Bubble Chart | single／multiple series | 部分対応 | single seriesのx、y、sizeに対応。複数seriesは未対応 |
| Histogram | default | 対応 | numericの階級下限と度数を検査して描画する |
| Line Chart | single、multiple series、multiple Y columns | 部分対応 | 1〜4系列と独立縦軸に対応。series別chart typeは未対応 |
| Scatter Plot | single／multiple series | 部分対応 | single seriesのx、yに対応。複数seriesは未対応 |
| Calendar Heatmap | single year、multi-year | 部分対応 | date、valueの最大366日へ対応。multi-year区切りは未対応 |
| Heatmap | basic、customized | 対応 | x category、y category、valueの基本形に対応 |
| Funnel Chart | default、side aligned | 部分対応 | 任意の順序付きstageに対応。orientationは未対応 |
| Sankey Diagram | horizontal、vertical | 部分対応 | 上位10経路・最大4ページの段階付き回遊に対応。verticalと一般flowは未対応 |

標準chart componentはこの11種類に、§4のAnnotations、Sparkline、Mixed-Type Chartsと、§6のCustom
EChartsを加えた15種類である。

## 4. chart補助表現とdata component

| Evidence component | RepChat | 現在の根拠・不足 |
|---|---|---|
| Annotations | 未対応 | x/y reference line、reference area、根拠revisionとの対応がない |
| Sparkline | 未対応 | scorecard内の小型時系列rendererがない |
| Mixed-Type Charts | 未対応 | bar＋line等のseries別type契約がない |
| Big Value | 対応 | 1行1列のscalarと、既知のKPI pairを描画できる |
| Value | 部分対応 | 数値formatはあるが、Evidenceのinline Value componentとしては生成しない |
| Data Table | 対応 | 取得データをtable表示できる。Evidenceの全機能は未対応 |
| Delta | 未対応 | 比較値、方向、良否色の意味契約がない |

## 5. map component

| Evidence component | RepChat | 現在の不足 |
|---|---|---|
| Area Map | 未対応 | region key、shape、value、地理境界の契約がない |
| Bubble Map | 未対応 | latitude、longitude、sizeの契約がない |
| Point Map | 未対応 | latitude、longitude、categoryの契約がない |
| Base Map | 未対応 | layerとtile／shape sourceの契約がない |
| US Map | 未対応 | US地域codeとvalueの契約がない |

## 6. Custom ECharts

Evidenceの公式ページには、Custom ECharts例として次が掲載されている。

| 公式例・拡張枠 | RepChat | 現在の不足 |
|---|---|---|
| Treemap | 未対応 | hierarchy、name、value契約がない |
| Pie Chart | 未対応 | Donutとは独立した表示契約をまだ持たない |
| Donut Chart | 部分対応 | name、非負value、最大12区分、割合tooltip、中心合計を描画する |
| Custom Funnel | 部分対応 | 固定購入funnelだけで、ECharts configは生成しない |
| Advanced／任意ECharts | 未対応 | 任意JavaScript configは安全性、再現性、accessibilityを保証できない |

Pie ChartとDonut ChartはEvidenceの独立した標準componentではなく、Custom EChartsの公式例である。
RepChatでは利用者から見たchart typeとして提供できるが、実装上は安全な宣言的schemaからEvidenceの
Custom ECharts設定へ変換する必要がある。

任意ECharts configを生成AIへ直接書かせることは、script注入、過剰なoption、再現不能なdata埋め込み、
accessibility欠落につながるため、初期方針にはしない。RepChat側でchart typeごとの宣言的schema、許可option、
結果形状validator、accessible fallback tableを定義したものから順にplannerへ解放する。

## 7. 現在の要約

RepChatのlocal demoでは、18個の指定値を日本語要件からSQL、dry-run schema、結果形状、描画まで同一契約で
扱える。Evidenceのvariantをすべて再現したことは意味せず、map、Box Plot、Calendar Heatmapのmulti-year表示、
Sparkline、Mixed-Type Charts、任意Custom EChartsは未対応である。

したがって、AIが利用者の要望を考察しても、現時点のplannerへEvidence全種類を選ばせてはならない。
先に各chartの結果形状とrendererを実装し、end-to-end契約を試験したものだけをAIの許可enumへ加える。
許可enumと指標定義は依頼ごとに中立な順序へ変換し、列挙順を提案順位として使わせない。
初回提案数と上限は管理者ポリシーとして設定でき、デモ既定値はそれぞれ6件と20件である。例えば上限を15件へ
変更できる。この件数境界は費用と画面密度を制御するものであり、AIが何を分析するかは固定しない。
panel数ポリシーとchart coverageは別の軸として管理する。

## 8. 将来の可視化選定skill

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
