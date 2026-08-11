---
id: governed-cohort-analysis-requirements
title: 統制されたコホート分析要件
status: draft
updated: 2026-08-11
---

# 統制されたコホート分析要件

この文書は、日本語の分析目的からコホートの意味を確認し、再現可能な定義、費用承認、SQL、検証済み結果、
解釈までを作る将来要件を定義する。最初はAmplitude代替ではなく、代理店がすぐ使える日本語の定型分析として
小さな競争力を検証する。Amplitudeの主要なコホート・リテンション分析へ段階的に近づけるが、
Evidence Cloudとの差は描画componentではなく、意味を確定してから実行する統制workflowで検証する。
追跡Issueは[#341](https://github.com/Yukihide-Mitsuoka/repchat/issues/341)である。

## 1. 用語

| 用語 | 定義 |
|------|------|
| 分析主体 | コホートへ所属する最小単位。利用者、account、契約、端末などから一つを選ぶ |
| コホート定義 | 分析主体を集合へ含めるevent、property、回数、順序、期間、除外条件を持つversion付き規則 |
| 起点event | 各分析主体を時間bucketへ割り当てる基準event。初回登録、初回購入、施策接触など |
| 復帰event | 起点後の継続、再訪、再購入などを判定するevent |
| exact-period retention | 起点から数えて指定した一つの期間内に復帰eventを行った割合 |
| on-or-after retention | 指定期間以降のいずれかの期間に復帰eventを行った割合 |
| 成熟期間 | 対象cohortの全分析主体が該当intervalまで観測されるだけの時間が経過した期間 |
| cohort specification | 分析主体、起点・復帰event、期間、粒度、timezone、retention方式、filter、比較軸を固定した不変revision |
| cohort result | specification revision、query revision、result revision、検証結果へ追跡できるmatrix、curve、集計表 |
| 最小コホートレポート | acquisition cohort、exact-period retention、未成熟期間の区別、heatmap・table、SQL・集計data・根拠に限定したPhase 1成果物 |

## 2. 前提と制約

| ID | 種別 | 内容 | 誤っていた場合の影響 |
|----|------|------|----------------------|
| A-1 | 検証対象の仮説 | 日本語で目的を伝え、曖昧な意味だけを確認できれば、Amplitude型の分析を専門家なしで再現できる | design partnerが定義作業を負担と判断した場合は代理店template中心へ変更する |
| A-2 | 競合事実 | Amplitudeはbehavioral cohort、retention、cohort比較、再利用を製品化している | 同等の意味契約を持たない簡易heatmapでは対抗にならない |
| A-3 | 競合事実 | Evidence CloudはSQL、custom component、agent skillsでcohort reportを構成でき、Evidence Labsにも実験的componentがある | 「cohort chartがある」だけではEvidence Cloudとの差にならない |
| A-4 | 検証対象の仮説 | 最小コホートレポートだけでも、汎用BIより準備が少ない日本語の定型分析として採用理由になる | 利用意向が上がらなければ差別化と表現せず、Phase 2以降を再評価する |
| C-1 | 制約 | Issue #160が`proceed`になるまで製品実装しない | 今回は要件、競合境界、実装順序だけを記録する |
| C-2 | 制約 | cohort specificationをfreezeする前にSQLを生成・実行しない | AIの暗黙解釈を分析定義にしない |
| C-3 | 制約 | 未成熟期間を0として表示せず、空欄または未確定として扱う | 観測不足を離脱と誤認させない |
| C-4 | 制約 | 指標、event、identity、timezone、source contractが未定義または不整合なら確認または拒否する | 自然言語だけで意味を補わない |
| C-5 | 制約 | query実行前にVertex AIとBigQueryの費用見積・上限を分離して承認する | cohort queryのscan量を無断で発生させない |
| C-6 | 制約 | 保存済みcohort定義、membership、resultはtenant・analysis subject・roleの一致後だけ参照する | 顧客間の行動条件と対象者を混ぜない |

## 3. 目的と範囲

- **目的:** 日本語の分析目的を、意味が固定されたコホート分析へ変換し、誰が再実行しても同じ定義と
  結果形状でリテンション、行動差、施策優先度を判断できるようにする。
- **成功指標:**

  | 指標 | 目標 | 測定方法 |
  |------|------|----------|
  | 未確定の意味を使ったquery実行 | 0件 | state transition・audit test |
  | 基準fixtureとのcohort size・retained count・rate一致 | 全cell 100% | reference SQLとのcontract test |
  | 未成熟期間の0表示 | 0件 | 境界日fixture・visual test |
  | 同じspecificationとsource snapshotによる結果差 | 0件 | 3回の決定性試験 |
  | 数値からspecification・SQL・集計dataへの追跡 | 100% | provenance reconciliation |
  | 日本語の目的から初回matrix確認まで | pilot参加者が10分以内、確認3往復以内 | design partner task test |
  | Amplitudeとの差の説明 | pilot参加者の80%が「定義確認・費用・根拠」の差を説明できる | デモ後質問 |

- **対象:** acquisition／activation cohort、behavioral cohort、exact-period／on-or-after retention、
  cohort比較、heatmap・table・curve、定義revision、費用承認、SQL・集計data・根拠、再利用、監査。
- **対象外:** predictive cohort、propensity model、experiment配信、push通知、広告activation、session replay、
  Amplitude互換API、自由な任意code実行、Issue #160判定前の製品実装。

### 3.1 最小コホートレポートの位置づけ

Phase 1はAmplitudeのbehavioral cohort、saved cohort、used-by、predictive／activationを再現しない。
それでも、定義済みのGA4 acquisition cohortを日本語で依頼し、未成熟期間を0と誤表示せず、母数、SQL、
集計data、根拠まで同時に確認できるなら、一般的なdashboard生成だけより一段深い定型分析になる。
この「多少の強み」は要件上の仮説であり、Amplitude対抗またはEvidence Cloud優位とは販売上表現しない。
同じ課題を汎用BI、Amplitude、Evidence Cloud、RepChatで行い、準備時間、定義誤り、根拠追跡、利用意向を測る。
- **関係者:**

  | role | 関心 | 決定権限 |
  |------|------|----------|
  | 分析依頼者 | 日本語で目的を伝え、結果から施策を判断する | specification確認、query費用承認 |
  | 代理店report作成者 | 顧客別に正しいevent・metric・比較を再利用する | cohort template提案、結果review |
  | 顧客technical owner | identity、event、timezone、source contractを保証する | data contract承認 |
  | 閲覧者 | 承認済み結果を誤解なく読む | 編集権限なし |
  | AI | specification、SQL、解釈のdraftを作る | 承認権限なし |

## 4. 機能要件

| ID | 要件 | 目的 | 優先度 | 根拠 |
|----|------|------|--------|------|
| FR-001 | 日本語の目的から分析主体、起点event、復帰event、期間、粒度、timezone、retention方式、filter、比較軸を提案する | 定義確定 | Must | cohortは同じ語でも分母・期間で値が変わる |
| FR-002 | C-4の必須項目が一意でない場合は、推奨値と理由を示して確認し、暗黙補完しない | 誤実行0件 | Must | AIの推測を定義にしない |
| FR-003 | 利用者が確認した内容を不変なcohort specification revisionとしてfreezeし、差分を表示する | 再現性 | Must | #180のanalysis specification契約を利用する |
| FR-004 | freeze後に生成予定query、scan上限、Vertex AI費用、BigQuery費用を表示し、承認後だけ実行する | 費用統制 | Must | C-5 |
| FR-005 | version付きmetric、event、identity、source contractからSQLを生成し、未定義の語は拒否する | 正確性 | Must | ADR-0013 |
| FR-006 | cohort size、retained count、retention rateを同じquery resultで返し、分母・分子を表示できるようにする | 検証可能性 | Must | percentageだけでは誤りを検出できない |
| FR-007 | exact-periodとon-or-afterを別のretention方式として扱い、画面とartifactで明示する | 意味の安定 | Must | Amplitudeでも方式により値が変わる |
| FR-008 | 成熟期間だけをrate計算へ含め、未成熟cellを空欄と理由付き状態で表示する | 誤読防止 | Must | Evidence Labsの実験componentにも未完期間の課題が明記されている |
| FR-009 | heatmap、数値table、cohort size、interval見出しを同じpanelで切り替え、色だけに依存しない | 判断・accessibility | Must | 値と母数を同時に確認する |
| FR-010 | 複数cohortのretention curveと主要interval差を比較し、sample sizeを併記する | Amplitude対抗 | Should | cohort間の行動差を判断する |
| FR-011 | event・property・回数・順序・期間によるbehavioral cohortを保存し、名前ではなくdefinition revision IDで再利用する | 再利用 | Should | 自然言語の再入力による意味driftを防ぐ |
| FR-012 | 保存済みcohortの利用中dashboard、panel、comparisonを列挙し、変更時の影響範囲を表示する | 変更安全性 | Should | Amplitudeのused-by相当が必要 |
| FR-013 | matrix cellまたはcurve pointから、集計data、SQL、metric・event定義、source snapshot、検証結果へ移動できる | 根拠100% | Must | #179のprovenance UXを利用する |
| FR-014 | 観測、解釈、仮説、推奨する次の比較を分離し、数値主張をcohort resultへ結び付ける | 会議利用 | Should | 根拠外数値を生成しない |
| FR-015 | source contract、identity rule、timezone、metric definitionが変わった場合は既存resultをstaleにし、無断再実行しない | 変更安全性 | Must | 過去と現在の意味を混ぜない |
| FR-016 | cohort definition、membership、result、SQLの閲覧・編集権限を分離し、membership一覧を既定で表示しない | data protection | Must | cohort条件と対象者は機微情報になり得る |
| FR-017 | query失敗、費用超過、検証不一致、結果形状不一致を区別し、自動再実行しない | 費用・復旧 | Must | 現行demoの費用契約を維持する |
| FR-018 | 承認済みcohort resultをdashboard panel、Insight、会議報告へrevision参照で追加する | workflow統合 | Should | chart単体で終わらせない |

### 4.1 利用例

> 2020年11月から2021年1月に初回訪問した利用者を初回訪問週で分け、8週目までの再訪率を表示して。
> 購入者と未購入者を比較し、未成熟の週は0にしないで。

AIはquery前に、分析主体、初回訪問の定義、再訪event、timezone、週の開始曜日、exact-periodか
on-or-afterか、購入者の判定期間を提案する。利用者が確認してfreezeした後だけ費用を見積もる。

### 4.2 業務規則

- cohortの割当は既定で分析主体ごとの最初の起点eventを使う。分析期間内の最初か全履歴の最初かは必須項目とする。
- 同じ分析主体を同じcohort内で重複計上しない。identity merge規則が変われば別revisionとする。
- 週の開始曜日、timezone、境界を固定する。表示timezoneとwarehouse timezoneを暗黙変換しない。
- 0は「成熟済み期間に復帰者が0」の場合だけ表示する。未成熟、欠損、query失敗は別状態とする。
- 遅延到着dataを取り込んだ再計算は新しいresult revisionとし、公開済み値を上書きしない。
- dynamic behavioral cohortは再計算時点を保存し、過去のmembershipを現在値で書き換えない。

### 4.3 状態遷移

`draft → needs-confirmation → frozen → estimated → approved → running → validated → review → published`

- `needs-confirmation`ではqueryを実行できない。
- 費用上限超過、検証不一致、source contract変更は`blocked`とし、利用者の修正または再承認を要求する。
- 新しいspecificationまたはresultは過去revisionを上書きせず、`superseded`参照を追加する。

## 5. 非機能要件

| ID | 特性 | 要件 | 目標 | 検証方法 | 優先度 |
|----|------|------|------|----------|--------|
| NFR-001 | 正確性 | reference SQLと全cellの分母・分子・率が一致する | 100% | fixture contract test | Must |
| NFR-002 | 決定性 | 同じspecificationとsource snapshotで同じresultを返す | 3回中差分0件 | repeated test | Must |
| NFR-003 | security | tenant、analysis subject、roleを越えたdefinition・membership・result参照を拒否する | 越境0件 | RLS・authorization負のE2E | Must |
| NFR-004 | usability | 非専門家が定義、母数、未成熟cell、主要差を識別できる | 10分以内、確認3往復以内 | pilot task test | Must |
| NFR-005 | accessibility | heatmapと同じ情報をtable・textで取得でき、keyboardでcellを移動できる | 主要操作100% | accessibility test | Must |
| NFR-006 | performance | warehouse完了後のmatrix整形・描画を追加2秒以内にする | p95 2秒以下 | 12×13 cell fixture | Should |
| NFR-007 | observability | specification、費用承認、query、検証、publish、拒否を同じtraceへ結ぶ | event欠損0件 | audit reconciliation | Must |
| NFR-008 | maintainability | cohort SQLの意味をprompt文字列でなくversion付きcontractとfixtureで固定する | 全方式にfixture | contract inventory test | Must |

## 6. データ要件

| 観点 | 仕様 |
|------|------|
| data model | `cohort_definition_revisions`、`cohort_specification_revisions`、`cohort_result_revisions`、`cohort_dependencies`、`evidence_refs` |
| source of truth | 定義revisionとsource contractを正本とし、materialized membershipは再生成可能な派生dataとして扱う |
| result shape | `cohort_key`、`cohort_start`、`interval_index`、`cohort_size`、`retained_count`、`retention_rate`、`maturity_status` |
| expected volume | 初期demoは最大13 cohort×13 interval。製品上限はpilotのscan量と描画計測後に決める |
| retention | definition、承認、監査はtenant契約に従う。個人membershipの永続化は必要な場合だけ別承認する |
| PII | 生のuser IDまたはaccount IDを顧客Git、prompt、公開artifactへ保存しない |
| recovery | resultをdefinition、query、source snapshotから再生成できる。last-known-goodの公開結果を維持する |

## 7. 外部interfaceと依存関係

| system・機能 | 方向 | 契約 | 障害時 |
|-------------|------|------|--------|
| Issue #180 分析仕様・build | 双方向 | cohort specification、費用承認、build revision | freezeまたは承認が無ければ停止 |
| ADR-0013 指標定義層 | 読取 | event、identity、metric、retention mode、result shape | 未定義なら確認または拒否 |
| Issue #188 schema理解 | 読取 | nested/repeated path、identity field、event property | schema未検証なら実行しない |
| Issue #179 UI・provenance | 出力 | heatmap、table、curve、SQL、data、definitionへの移動 | provenanceが欠ければpublishしない |
| BigQuery | 出力・入力 | dry run、費用上限、実query、result schema | 上限超過、timeout、shape不一致を区別して停止 |
| 会議報告・Insight | 出力 | validated result revision reference | raw SQLや非承認draftを直接配布しない |

## 8. インフラと費用

- 初期実装は既存のVertex AI、BigQuery、Postgres control plane、artifact pipelineを使い、この機能だけを理由に
  in-memory DB、vector DB、独立OLAP storeを追加しない。
- BigQuery dry runでspecification単位のscan量を見積もる。複数表示が同じ母集団をscanする場合も、
  [ADR-0021](../adr/0021-gate-shared-intermediates-on-measured-build-cost.md)の条件を満たすまで中間tableを既定にしない。
- 月額費用はsource volume、cohort数、interval数、再計算頻度をpilotで測るまで確定しない。

| 構成要素 | 固定費 | 従量basis | 初期方針 |
|-----------|--------|-----------|----------|
| Vertex AI | 新規固定費なし | specification・SQL・解釈のtoken | 各段階を分離表示し、自動再実行しない |
| BigQuery | 新規固定費なし | dry runで見積もった処理bytes | 利用者承認済み上限内だけ実行 |
| Postgres・artifact | 既存基盤内 | definition・result revision数 | pilotで保存量を測定 |

## 9. 運用要件

| 観点 | 要件 |
|------|------|
| monitoring | ambiguity停止、費用拒否、query失敗、未成熟cell、検証不一致、stale result、越境拒否を計測する |
| incident | 誤ったdefinitionまたはresultをrevokeし、参照dashboard・Insight・reportをdependencyから特定する |
| rollback | 直前のvalidated・published result revisionへ参照を戻す |
| migration | 現在の折れ線・表を自動的にcohort resultへ変換しない。definition確認を要求する |

## 10. 受入条件

| ID | 条件 | 対応要件 | 検証方法 |
|----|------|----------|----------|
| AC-1 | 必須意味が欠けた日本語依頼はqueryを実行せず、推奨値付き確認へ進む | FR-001〜005 | fixed AI response・state test |
| AC-2 | reference fixtureのcohort size、retained count、rateが全cell一致する | FR-006〜008、NFR-001 | reference SQL contract test |
| AC-3 | 未成熟、欠損、0、失敗を別状態で返し、未成熟cellを0表示しない | FR-008、009 | boundary fixture・visual test |
| AC-4 | exact-periodとon-or-afterを切り替えると期待する異なる値になり、方式名がartifactへ残る | FR-007 | two-mode fixture |
| AC-5 | heatmapの任意cellからdefinition、SQL、aggregate data、source snapshot、validationへ移動できる | FR-013、NFR-007 | provenance E2E |
| AC-6 | source contractまたはtimezone変更後に既存resultをstale表示し、費用再承認なしに再実行しない | FR-015、017 | revision・billing E2E |
| AC-7 | tenantまたはroleを越えるdefinition、membership、result、SQL参照を拒否する | FR-016、NFR-003 | authorization負のE2E |
| AC-8 | 日本語依頼から10分・3往復以内にmatrixを確認し、定義・母数・未成熟期間・主要差を説明できる | NFR-004 | design partner usability test |
| AC-9 | 同一課題をAmplitude、Evidence Cloud、RepChatで実施し、操作時間、確認回数、定義誤り、根拠追跡、費用理解を記録する | A-1〜A-3 | benchmark protocol |

## 11. リスク

| ID | リスク | 確率 | 影響 | 緩和 |
|----|------|------|------|------|
| R-1 | heatmapだけ実装し、Amplitudeより分析の意味が弱くなる | 高 | 高 | specification、fixture、比較、再利用をMustにする |
| R-2 | Evidence Cloudも同じreportを生成し、差別化が消える | 高 | 中 | chartではなく日本語の定義確認、費用、根拠、会議workflowを比較する |
| R-3 | 初回eventを取得できる履歴が不足し、新規cohortを誤判定する | 高 | 高 | history coverageをcontract化し、不足時は警告または拒否する |
| R-4 | identity stitching変更で過去cohortが変わる | 中 | 高 | identity revision、source snapshot、stale判定 |
| R-5 | 大規模membershipでBigQuery費用と時間が増える | 中 | 高 | dry run、費用上限、期間上限、実測後の中間結果gate |
| R-6 | 小さいcohortの率を過大解釈する | 高 | 中 | cohort size併記、最小母数警告、推測的因果を禁止 |
| R-7 | dynamic cohortの現在membershipで過去判断を上書きする | 中 | 高 | 計算時点とresult revisionを固定する |

## 12. 実装時期

| 段階 | 範囲 | 開始条件 |
|------|------|----------|
| Phase 0 — 要件とbenchmark設計 | 本文書、競合境界、reference fixture、同一課題benchmark | 今回。製品実装なし |
| Phase 1 — 最小コホートレポート | 公開GA4のacquisition cohort、exact-period、未成熟blank、heatmap・table、SQL・data・根拠 | #160=`proceed`、費用承認、reference SQL review |
| Phase 2 — 製品analysis | versioned specification、on-or-after、費用gate、provenance、認可、publish | #179/#180のrevision・build契約と#188の品質境界が安定 |
| Phase 3 — reusable behavioral cohort | event・property定義、used-by、cohort比較、dashboard・Insight・会議report参照 | Phase 2の正確性・越境・費用試験が成功 |
| Phase 4 — activation拡張 | predictive cohort、experiment・施策連携 | design partnerの反復需要と別要件・ADRが承認済み |

## 13. 未決事項

| ID | 問い | block対象 | owner | 必要時期 |
|----|------|-----------|-------|----------|
| Q-1 | 最初のpilotで分析主体をuserだけに限定するか、accountも同時に扱うか | Phase 1 | repository owner、design partner | demo実装前 |
| Q-2 | GA4 demoの起点・復帰event、週開始曜日、比較cohortを何にするか | Phase 1 | repository owner | reference SQL作成前 |
| Q-3 | customer固有cohort definitionの保存先をRepChat policy層と顧客Gitへどう分けるか | Phase 2 | repository owner | ADR review時 |
| Q-4 | membership一覧を表示できるroleと保持期間をどうするか | Phase 2 | repository owner、security owner | Issue #194と本番role決定時 |
| Q-5 | AmplitudeとEvidence Cloudの比較環境、評価者、許容操作時間差をどう確保するか | benchmark | repository owner | design partner test計画時 |

## 参考資料

- [Amplitude: Cohort Analysis](https://www.amplitude.com/explore/analytics/cohort-analysis)
- [Amplitude: Behavioral Cohorts API](https://www.amplitude.com/docs/apis/analytics/behavioral-cohorts)
- [Amplitude: Retention calculation](https://amplitude.com/docs/analytics/charts/retention-analysis/retention-analysis-calculation)
- [Evidence Cloud](https://evidence.dev/)
- [Evidence Labs: Cohort Analysis](https://labs.evidence.dev/cohort-analysis)
