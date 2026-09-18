---
id: development-handoff
title: 開発引き継ぎ
status: active
updated: 2026-09-18
---

# 開発引き継ぎ

この文書は、人またはAIが前回の対話なしでRepChatの開発を再開するための入口です。
実装状態の正本は[実装状況サマリー](status.md)、通常の優先順位の正本は[ロードマップ](roadmap.md)、
各タスクの受入条件はGitHub Issueです。ただし、下記のオーナー拘束指示と「固有処理を削除する実装計画」は
過去の優先順位、開始条件、要件、ADRより常に優先します。この文書には再開に必要な参照順と分岐だけを置きます。

## オーナーからの拘束指示

> 任意の分析対象へ設定なしで適用できる状態でないと製品として成立しない。
> 固有の処理を書くのは絶対にやめてほしい。

新しい分析対象を追加するための専用code、profile、設定、固定prompt、固定SQL、期間parser、識別子補正、
手動の指標・意味定義は実装しません。認可済みscopeのschema・metadata・bounded value profileから、
同じ共通pipelineが分析契約を自動生成しなければなりません。利用者確認や手動定義を代替策として検討するのは、
対象非依存の共通処理をこれ以上改善できない限界を反復評価の証拠で示した後だけです。現時点では検討しません。

Issue #160は、リポジトリオーナー本人から明示的な指示がない限り、言及、調査、更新、優先順位付け、
作業提案、または他タスクの開始条件としての利用を禁止します。過去のIssue、要件、roadmap、handoffの記述を
オーナー指示とみなしてはいけません。

## 現在の作業

[Issue #654](https://github.com/Yukihide-Mitsuoka/repchat/issues/654)の初回dashboard計画
`400 INVALID_ARGUMENT`修正は、[PR #655](https://github.com/Yukihide-Mitsuoka/repchat/pull/655)で
マージ済みです。実Vertex AI・BigQueryを使う公開GA4経路でも6パネルbuildまで完了しました。検証範囲と
未確認事項は[トラブルシューティング](troubleshooting/live-demo.md#初回ダッシュボード計画が400-invalid_argumentになる)
を正本とします。追加の有料呼出しは自動再実行しません。

[Issue #658](https://github.com/Yukihide-Mitsuoka/repchat/issues/658)／
[PR #660](https://github.com/Yukihide-Mitsuoka/repchat/pull/660)では、`comparison_table`が独立した3指標を
現在値・比較値・差分として誤受理し、実行後の算術検証で停止する問題を修正した。比較対象の定義済み元指標は
1件とし、SQL出力の3役割と分離する。同じ構造を持つ他chartは
[Issue #659](https://github.com/Yukihide-Mitsuoka/repchat/issues/659)で別途監査し、今回の修正へ混在させない。

[Issue #662](https://github.com/Yukihide-Mitsuoka/repchat/issues/662)／
[PR #663](https://github.com/Yukihide-Mitsuoka/repchat/pull/663)では、月内比較のSQLがpartition filterを
部分期間へ狭め、1回のSQL修正後も2021年1月の期間契約を満たせない問題を修正した。完全なpartition filterと
条件付き集約の使い分けを修正診断へ明記し、BigQuery実行前のfail-closedと修正1回上限は維持する。

[Issue #665](https://github.com/Yukihide-Mitsuoka/repchat/issues/665)／
[PR #666](https://github.com/Yukihide-Mitsuoka/repchat/pull/666)では、Bitcoinの明示的な月範囲が最初の
1か月へ縮退する期間契約と、大数のMixed-Typeが読めない表示を修正した。月範囲のSQL生成・診断・検査を
同じpartition契約へ統一し、正確な生値を保持したまま軸目盛と月表示を短縮する。固定12か月fixtureの
ブラウザ描画、必須CI、最新mainでのデモ再起動とHTTP 200を確認済み。実サービス再確認は費用承認後だけ行う。

[Issue #651](https://github.com/Yukihide-Mitsuoka/repchat/issues/651)のVertex AIエラー診断は、
[PR #652](https://github.com/Yukihide-Mitsuoka/repchat/pull/652)でマージ済みです。生成APIの共通境界で
安全なcode・statusだけを分類し、dashboard、insight、SQL生成、会議報告へ同じ案内を返します。
全387テストを含むPR CIは成功し、実Vertex AIは追加実行していません。Issueはclose済みです。

[PR #643](https://github.com/Yukihide-Mitsuoka/repchat/pull/643)と
[PR #644](https://github.com/Yukihide-Mitsuoka/repchat/pull/644)はマージ済みです。
GA4／Bitcoinの計画・build・HTTP・UIを共通化しましたが、共通interfaceの背後には対象別profileが残っています。
2026-09-12のオーナー指示とADR-0025により、従来の「profileを増やして共通interfaceへ接続する」順序は失効しました。
以後は下段の「固有処理を削除する実装計画」を小さいPRに分け、その順序を他の過去記録より優先します。

最初の実装は[PR #648](https://github.com/Yukihide-Mitsuoka/repchat/pull/648)の
[metadata reader](architecture/schema-inspection.md)です。`make format`・`make lint`・`make test`は通過済み。
APIの境界はfake clientで検証し、
実BigQuery接続と生成経路への組込みはまだ行っていません。[PR #649](https://github.com/Yukihide-Mitsuoka/repchat/pull/649)で共通契約compilerと期間契約は実装・
unit testまで完了しました。
共通contractの中立なplanner／SQL文脈と仕様fingerprintのbind・一致検査もunit testまで完了しました。
[PR #672](https://github.com/Yukihide-Mitsuoka/repchat/pull/672)でGA4型の日次shard集合を完全解決する
metadata境界、[PR #673](https://github.com/Yukihide-Mitsuoka/repchat/pull/673)でshardの
`_TABLE_SUFFIX`とscan範囲を共通期間契約へ固定する実装はmerge済みです。共通契約付きsourceを
plannerとSQL生成の既存関数へ渡す[PR #674](https://github.com/Yukihide-Mitsuoka/repchat/pull/674)もmerge済みです。
[PR #675](https://github.com/Yukihide-Mitsuoka/repchat/pull/675)は2026-09-12にmerge済みです。当初追加した
GA4固有の契約factoryは、オーナー指示と
[ADR-0025](adr/0025-discover-analysis-contracts-without-source-specific-code.md)に反するため撤去しました。
最終差分には、metadata取得時刻を監査情報として保持しつつ契約identityから除外する共通fingerprint修正だけを
残しました。

[PR #709](https://github.com/Yukihide-Mitsuoka/repchat/pull/709)で旧ライブデモ入口を削除しました。
[PR #710](https://github.com/Yukihide-Mitsuoka/repchat/pull/710)で`live_ui_base.py`と
`live_ui_interactions.py`も削除済みです。[PR #711](https://github.com/Yukihide-Mitsuoka/repchat/pull/711)で
入口から未参照の`live_ui_shell.py`と`live_ui_theme.py`も削除しました。
[PR #712](https://github.com/Yukihide-Mitsuoka/repchat/pull/712)で旧`live_engine.py`も物理削除しました。
[PR #713](https://github.com/Yukihide-Mitsuoka/repchat/pull/713)では旧`live_http.py`、
`live_http_dispatch.py`、`live_http_response.py`を削除しました。実行入口から未参照だった
`live_http_validation.py`は[PR #714](https://github.com/Yukihide-Mitsuoka/repchat/pull/714)で削除しました。
実行時未参照でテストだけが参照していた旧`live_contracts.py` facadeは
[PR #715](https://github.com/Yukihide-Mitsuoka/repchat/pull/715)で削除しました。
`analysis_dashboard_plan.py`に残る旧profileの保存・既定値・照合経路は
[PR #716](https://github.com/Yukihide-Mitsuoka/repchat/pull/716)で削除しました。
`analysis_workflows.py`のprofile registry・既定対象選択は
[PR #717](https://github.com/Yukihide-Mitsuoka/repchat/pull/717)で共通契約必須入力へ置換し、merge済みです。
続く[PR #718](https://github.com/Yukihide-Mitsuoka/repchat/pull/718)では、`section_execution.py`から`DataSourceProfile`、
対象別dataset、期間callback、SQL正規化callbackを削除し、共通契約から実行policy、SQL規則、期間を導出します。
SQL生成requestの期間表現も特定partition形式を前提にせず、契約の期間または時間境界なしだけを伝えます。
[PR #718](https://github.com/Yukihide-Mitsuoka/repchat/pull/718)はmerge済みです。
続く[PR #720](https://github.com/Yukihide-Mitsuoka/repchat/pull/720)では、runtimeから未参照で
対象別profileと手動metric定義を保存する`dashboard_build.py`を共通契約へ移植せず物理削除し、merge済みです。
[PR #721](https://github.com/Yukihide-Mitsuoka/repchat/pull/721)では、testだけが参照していた
`data_source_profiles.py`と旧registry自体のテストを削除し、共通contractがplanner・SQL・実行policyへ
直結する検査を維持し、merge済みです。
[PR #722](https://github.com/Yukihide-Mitsuoka/repchat/pull/722)では、実行経路から未参照の
`ga4_profile.py`と`bitcoin_profile.py`を物理削除し、merge済みです。
[PR #723](https://github.com/Yukihide-Mitsuoka/repchat/pull/723)で、旧export経由でテストだけが呼んでいた固定schema・
指標promptの`sql_prompt_context.py`と、実行経路から未参照の`metrics.json`を削除し、merge済みです。
[PR #725](https://github.com/Yukihide-Mitsuoka/repchat/pull/725)で、未参照の固定Evidence page・component・file出力経路と
対応する`run_report.py`の旧exportを削除し、merge済みです。共通契約から導出するplanner・SQL規則は維持しています。
[PR #727](https://github.com/Yukihide-Mitsuoka/repchat/pull/727)で、`bigquery_execution.py`の固定dataset・20GiB上限へのfallbackを
削除し、SQL検査・dry run・実行に共通分析契約から導出したpolicyを必須にしました。契約欠落時は
BigQuery呼出し前に拒否し、参照tableとbytes上限は契約だけから決めます。CI checksは成功し、merge済みです。
[PR #728](https://github.com/Yukihide-Mitsuoka/repchat/pull/728)はmerge済みです。`sql_generation.py`の
URL関数を名指しした修正指示を削除し、診断文と対象非依存のSQL方言条件だけを残しました。
[PR #730](https://github.com/Yukihide-Mitsuoka/repchat/pull/730)はmerge済みです。未参照の旧配信実験
`tenant_serve.py`を削除し、runtime ratchetと実験記録を更新しました。
[PR #732](https://github.com/Yukihide-Mitsuoka/repchat/pull/732)はmerge済みです。
`visualization_contracts.py`と`visualization_sections.py`の`event_date`出力役割を中立な`time_value`へ
置換しました。[PR #733](https://github.com/Yukihide-Mitsuoka/repchat/pull/733)では、
時系列chartで選んだ区分軸を共通契約の非repeated・非restrictedな
DATE／DATETIME／TIMESTAMP fieldへ照合し、計画提示前とSQL生成前に不一致を拒否します。
PR #733は2026-09-18にmerge済みです。
続く[PR #734](https://github.com/Yukihide-Mitsuoka/repchat/pull/734)では、
段階付きSankeyの計画・SQL生成要件と描画からWebページ回遊・URL正規化の
決め打ちを削除し、契約で経路識別と順序を確認するようAIへ要求する共通表現へ改めています。
この選択条件は機械的には未検査です。結果検査は番号付き隣接段階・数値・重複・上限までであり、
経路の完全性やSQLの意味上の来歴を証明済みとは扱いません。PR #734はローカル検証と
必須CI checksが成功し、mergeは未完了です。
出力`time_value`のSQL式が選択したfieldに由来することの来歴検査、契約に区分軸として宣言されない
date-shard疑似fieldの利用、段階付きSankeyの選択条件・経路完全性・SQL来歴検査は未完了です。

次の最優先作業は、認可済み接続scopeからtable、schema、値profile、期間・partition、join・grain・metric候補を
対象非依存の同一pipelineで自動生成することです。新しい分析対象のためのPython module、profile登録、固定prompt、
固定SQL、期間parser、識別子補正、metrics file、対象別設定を追加してはいけません。現段階では利用者確認や手動の
意味定義登録も解決策にせず、未知schemaの反復評価を根拠に共通処理を改善します。

対象別profile registryとGA4／Bitcoinのschema・期間規則を持つ旧moduleは削除済みです。
Issue #654の公開GA4経路は実Vertex AI／BigQueryで検証済みですが、
未知schemaの実値照合・独立レビュー・反復評価は未完了であり、共通経路化だけで任意schema対応を実証済みとは
しません。

## 固有処理の全リポジトリ監査（2026-09-12）

`src/`、`infra/`、`migrations/`、`scripts/`、`spikes/`、`tests/`、`docs/`を横断検索し、runtimeへの
import経路と実行時分岐を確認しました。製品本体の`src/`には分析対象固有の処理を確認していません。
一方、製品化前の`spikes/report-generation/`には次の固有処理が残っています。

| 分類 | 検出箇所 | 判定・扱い |
|---|---|---|
| 対象registryと既定値 | `data_source_profiles.py` | PR #721で物理削除済み。未参照の`dashboard_build.py`もPR #720で削除済み |
| 手書きschema・意味・期間・SQL補正 | `sql_generation.py`、`sql_contract_validation.py`、`bigquery_execution.py`、`run_report.py` | 対象別profile moduleはPR #722、固定schema・指標promptと手動metric資産はPR #723、固定Evidence出力はPR #725、SQL実行の固定datasetと20GiB fallbackはPR #727、URL関数の特殊補正はPR #728で削除済み |
| UIと補助実行経路 | `tenant_serve.py` | 旧ライブデモ入口とUI補助module、未参照の固定Evidence成果物出力、固定対象選択・SQLを持つ旧配信実験はPR #730までに削除済み |
| 中立化が必要な分析表現 | `visualization_contracts.py`、`visualization_sections.py`、`chart_renderer_composition.js` | `event_date`はPR #732で中立な描画役割へ置換済み。PR #733で時系列chartの選択区分軸の型を共通契約へ照合済み。段階付きSankeyのWeb導線前提はPR #734で中立化中。出力SQL式の来歴と経路完全性の検査は未完了 |
| 評価・履歴fixture | `spikes/nl2sql-accuracy/`、`spikes/nl2sql-thelook/`、`spikes/wrenai-evaluation/`、`spikes/evidence-dynamic/`、`tests/spikes/report-generation/`、過去の`docs/` | 特定datasetを評価するfixture・履歴であり、それ自体は製品runtimeではない。runtimeからimportせず、未知schemaの比較評価に限って保持する |

### 固有処理を削除する実装計画

以下を順番に小さいPRへ分割します。各PRは`make format`、`make lint`、`make test`を通し、前段の共通境界を
後段が利用します。対象別の新経路、設定、fallbackを並行して作ってはいけません。

段階0は[PR #677](https://github.com/Yukihide-Mitsuoka/repchat/pull/677)、段階1は
[PR #678](https://github.com/Yukihide-Mitsuoka/repchat/pull/678)、段階2のvalidatorは
[PR #679](https://github.com/Yukihide-Mitsuoka/repchat/pull/679)、入力境界は
[PR #680](https://github.com/Yukihide-Mitsuoka/repchat/pull/680)、token応答の正規化は
[PR #681](https://github.com/Yukihide-Mitsuoka/repchat/pull/681)でmerge済みです。構造化response schemaと
単一生成I/Oも[PR #682](https://github.com/Yukihide-Mitsuoka/repchat/pull/682)でmerge済みです。
発見済み日次shardを検査済みwildcardへ統合する共通境界は
[PR #683](https://github.com/Yukihide-Mitsuoka/repchat/pull/683)でmerge済みです。
[PR #684](https://github.com/Yukihide-Mitsuoka/repchat/pull/684)では`analysis_contract_orchestration.py`を追加し、
shard候補がある場合だけ質問と発見済みcatalogからopaqueなgroup tokenと期間を構造化生成します。比較期間を
含むscan範囲を決定論的に導出してPR #683の統合境界へ渡し、統合後の完全契約生成では同じ期間を固定します。
対象別の期間parser、table名分岐、設定は追加していません。PR #684はmerge済みです。

PR #685で時間fieldを持たないschemaの共通契約境界を実装し、merge済みです。選択schemaに利用可能な時間境界がない場合だけ
canonical contractの`period`を`null`とし、生成・SQL文脈が期間を補わないようにします。ingestion-time
partitionは標準metadataからBigQueryのpartition疑似fieldを合成し、必要な期間制約を維持します。
restricted／repeatedな時間型は利用可能な時間境界として扱わず、表現不能な必須partition filterは
時間なしへfallbackせず拒否します。

| 段階 | 実装内容 | 主な対象 | 完了条件 |
|---:|---|---|---|
| 0 | 再混入防止ratchet（PR #677、merge済み） | `tests/spikes/report-generation/source-specific-runtime-ratchet.test.ts` | 13分類のarchitecture testで対象名、既知dataset、profile API、固定schema・metric file、埋め込みSQL／DDL、対象別module・設定資産をファイル別件数として固定した。既存負債の削除時はbaselineも縮小し、新規追加、移動、件数増加をCIで拒否する |
| 1 | 認可scopeからの自動catalog・profile取得（PR #678、merge済み） | `bigquery_schema_snapshot.py`、`bigquery_scope_discovery.py` | server-sideの認可済みproject／dataset／table scopeだけを入力に、table、全field path、型、mode、partition、clustering、date-shard候補を自動取得する。null率、概算distinct、min／max、低cardinality文字列・boolean sampleを型・mode・policy tagで分類し、送信制御、dry-run、参照table照合、query・bytes・row・field上限を共通policyで制限する。対象名や業種名を入力に持たない |
| 2 | 共通分析契約の自動生成（PR #679〜#685 merge済み） | `analysis_contract.py`、`analysis_contract_compiler.py`、`analysis_contract_response.py`、`analysis_contract_generation.py`、`analysis_contract_orchestration.py`、`bigquery_scope_discovery.py` | validator、生成入力、token限定normalizer、構造化response schema、対象非依存prompt、単一Vertex生成I/O、日次shardの検査済みwildcard統合と二段階生成はmerge済み。PR #685では利用可能な時間境界がない選択schemaだけ`period=null`でcompileし、ingestion-time partitionには標準疑似fieldを合成した。表現不能な必須partition filterは拒否する。手動意味定義、対象別period parser、識別子補正を使わない |
| 3 | planner・SQL・検査を契約だけへ接続（PR #687、#689、#691、#693、#695〜#698、#716〜#718、#727、#728 merge済み） | `analysis_planner.py`、`analysis_workflows.py`、`sql_generation.py`、`sql_contract_validation.py`、`bigquery_execution.py`、`section_execution.py` | planner、workflow、保存plan、section executorは共通契約からscope・上限・期間・field・SQL規則・結果形状検査を導出する。section executorから対象別dataset、期間callback、SQL正規化callback、SQL検査・実行から契約欠落fallback、URL関数の特殊補正を削除済み |
| 4 | live runtimeをprofileなしへ切替 | `analysis_workflows.py` | 旧実サービス検証runner、ライブデモ・HTTP入口・facade、`live_engine.py`、保存dashboard planの`profile`依存は削除済み。workflowの相談・dashboard計画は共通契約を必須入力とし、契約取得不能時は対象別fallbackへ戻らずfail closedにする。未参照の旧単一Insight profile経路は削除済み |
| 5 | UI・成果物を中立化 | `visualization_contracts.py`、`visualization_sections.py` | 旧ライブデモ入口とUI payload、未参照の固定Evidence成果物出力、`tenant_serve.py`は削除済み。PR #732で`time_value`へ中立化し、PR #733で区分軸の時間型を共通契約へ照合する。SQL式の来歴検査と段階付きSankeyの汎用化は残る |
| 6 | 旧実装を物理削除（進行中） | `run_report.py`の旧export等 | `dashboard_build.py`、registry、対象別profile moduleはPR #720〜#722、固定schema・手動metric資産はPR #723、固定Evidence成果物出力と対応する旧exportはPR #725、固定dataset・20GiB上限のexportはPR #727で削除済み。残る対象別処理を順次除去し、互換目的のadapter、feature flag、隠し設定を残さずruntime inventoryのallowlistを空にする |
| 7 | 同一runtimeの反復評価 | source固有testを隔離したevaluation harness、未知nested/repeated schema最低2種類 | fixtureが持てるのは認可scope、質問、独立review済み期待SQL／期待結果だけとし、期待知識をruntimeへ渡さない。同一binary・prompt・設定で各schemaを反復し、結果一致率、誤推測、生成・検証失敗、scan上限違反を記録する。失敗は共通metadata・profiler・prompt・validatorだけを修正して再評価する |

残すのは、認可scope、tenant分離、table allowlist、read-only SQL、`SELECT *`拒否、dry run、費用・行数上限、
contract fingerprint、provenance、結果形状、一般的なchart capabilityなど、分析対象に依存しない安全性と再現性の
仕組みです。特定datasetのgold SQL・期待値はevaluation fixtureに限って保持し、runtimeからimportしません。

全段階のDefinition of Doneは次のとおりです。

- 新しい分析対象の利用開始に必要な操作が、既存connectionの認可scope付与だけであり、repository、prompt、設定、
  schema定義、metric定義の変更を要求しない。
- runtime sourceに対象名、既知dataset/table、対象別profile・branch・prompt・SQL・期間parser・識別子補正・metric fileがない。
- HTTP、planner、SQL、executor、UI、artifactが同じ自動生成contractを参照し、対象別fallbackを持たない。
- 未知schema最低2種類が、同一binary・prompt・設定のまま独立参照結果と一致し、安全上限違反をfail closedで拒否する。
- 利用者確認や手動意味定義を解決策として導入していない。固有処理が残る間は「任意の分析対象へ設定なしで
  適用可能」と表現しない。

## 次に着手する作業キュー（2026-09-12）

各作業の受入条件と進捗はリンク先のGitHub Issueを正本とします。この表は再開時の実施順序、
着手条件、完了判定だけを保持します。
Issue #188はGitHub上で2026-09-14にCLOSEDですが、下記の未知schema反復評価を完了した証拠は
このhandoffにありません。Issueの状態と製品能力の実証を同一視せず、再openはオーナー指示なしに行いません。

前回キューのchart契約監査は[PR #669](https://github.com/Yukihide-Mitsuoka/repchat/pull/669)で
merge済みです。また、元のcheckoutにあるchart描画関連の未コミット変更は変更内容を保ったまま
`codex/preserve-chart-layout-wip`（`bae485d`）へ退避済みです。この保全branchは古いmainを基点とするため、
そのままmergeせず、再開時に現行mainへ必要な変更だけを移植します。

| 順序 | 作業 | 完了条件・次への移行条件 |
|---:|---|---|
| 1 | [#188](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)の設定不要schema汎用化と評価 | 対象名を受け取らない共通pipelineで、認可済みscopeからtable・schema・bounded value profile・期間・partition・join・grain・metric候補を自動生成する。live engineからprofile registryと`metrics.json`を除去し、対象別コード・設定を追加せず2種類以上の未知schemaで参照結果と反復照合する。利用者確認や手動定義は、共通処理の改善限界が証拠で確定するまで導入しない |
| 2 | [#179](https://github.com/Yukihide-Mitsuoka/repchat/issues/179)の閲覧／来歴UX | #188の品質境界とロードマップの製品化開始条件が確定した後、presentation面とSQL・定義・provenance・検証・revision確認面のinteraction、deep link、認可境界を文書化してから製品実装へ進む |
| 3 | [#180](https://github.com/Yukihide-Mitsuoka/repchat/issues/180)の分析契約 | #179のinteractionと#188のschema品質境界を入力にし、immutable specification revision、明示承認、非同期build、進捗、再開、公開を製品契約として実装する |
| 4 | [#371](https://github.com/Yukihide-Mitsuoka/repchat/issues/371)のlayout保存・共有 | #179／#180のrevision契約確定後、行・panel revision・相対weight・responsive policyを保存し、競合をfail-closedで停止する。layout保存だけではAI生成とBigQueryを実行しない |
| 5 | [#181](https://github.com/Yukihide-Mitsuoka/repchat/issues/181)の根拠付き報告 | 統制された生成・公開経路とrevision追跡が安定した後、数値根拠、人間承認、監査履歴を含む報告を実装する |

条件付き作業は次のとおりです。

- [PR #653](https://github.com/Yukihide-Mitsuoka/repchat/pull/653)はv1.23.1のrelease候補です。公開する場合は
  release branchのcheck状態と内容を確認してからmergeします。
- [#194](https://github.com/Yukihide-Mitsuoka/repchat/issues/194)は課金または本番オンボーディングへ
  着手する直前に、オーナー判断として実施します。
- [#251](https://github.com/Yukihide-Mitsuoka/repchat/issues/251)は配布対象とconsumerを確定し、
  buildまたはpublish jobがattestation対象を生成できる時点で実施します。
- [#380](https://github.com/Yukihide-Mitsuoka/repchat/issues/380)は、代表シナリオでAI-only plannerの
  baselineを取得し、同じ評価セットで改善と失敗例を比較できる場合だけ着手します。
- 実Vertex AIまたはBigQueryの追加確認は、対象と費用を提示してオーナー承認を得た後だけ実行します。

### 過去タスク整理との再照合（2026-09-11）

2026-09-11に添付および会話で提示された旧タスク整理をGitHub Issue、mainの履歴、要件、ADRと再照合しました。
指定除外項目を除くOPEN Issueは#179、#180、#181、#188、#194、#251、#371、#380の
8件で、上の作業キューと条件付き作業にすべて含まれています。

旧整理に含まれ、単独のOPEN Issueがなくても追跡を継続する項目は次のとおりです。受入条件をこの文書へ
複製せず、リンク先を正本とします。

| 項目 | 2026-09-11の判定 | 出所と次の管理方法 |
|---|---|---|
| NL→SQL・Evidenceの製品組込み | `spikes/`では動作し、`src/`の製品経路は未着手 | [実装状況](status.md#3-まだ無いもの正直な一覧)と[#180](https://github.com/Yukihide-Mitsuoka/repchat/issues/180)を正本とする。#180でrevision・build・publish契約を確定後、gate・executor・tenant scopeへの接続を小さい実装Issueへ分割する |
| GitHub App・ArtifactBundle配送 | [ADR-0015](adr/0015-publish-artifacts-through-customer-git.md)はaccepted、実装Issueは未作成 | #180の公開契約確定後、共通pipeline、GitHub publisher、managed publisher、隔離build、有効化を個別Issueにする。閲覧経路からGitHubを呼ばず、失敗版を有効化しない |
| 顧客オンボーディング | セキュリティ説明、監査ログ説明、接続、撤退時削除は未着手 | [ロードマップ](roadmap.md#次デザインパートナー1社でのphase-1本番運用)を正本とする。実顧客dataを扱う前に対象顧客の要件から実装Issueを作る |
| 列レベル制御・LLM送信前マスキング | 未実装の条件付き前提 | [AIガバナンス要件](ai-governance-requirements.md#着手条件トリガー)を正本とし、AI分析報告の製品実装より先に設計する。顧客の列分類を確認せず方式を固定しない |
| 実サービス総合検証 | 過去の固定応答と既知データの結果は対象非依存性の証拠にしない。対象別profileを必須にした旧runnerは削除済み | [ロードマップの残課題](roadmap.md#残課題)を正本とし、対象非依存runtimeと評価harnessの完成後に、Vertex AIとBigQueryの費用を分けて承認を得て実行する |
| 適応型分析メモリー | 要件と[ADR-0018](adr/0018-govern-adaptive-analysis-memory.md)は完成、製品実装は未着手 | [要件](requirements/adaptive-analysis-memory.md#12-milestoneと実装時期)に従い、#179・#188と#180のrevision契約が成立した後にPhase 1実装Issueを作る。生会話、SQL、結果を正本にしない |
| version管理panel・SQL workspace | [ADR-0022](adr/0022-compose-derived-dashboards-from-versioned-panels.md)はproposed、製品実装は未着手 | #179／#180後に、panel revision、派生dashboard、利用者SQLの検証を独立Issueへ分割する。AI生成原本を上書きしない |
| cohort・計測実装支援 | 要件作成Issueは完了、製品実装は未着手 | [cohort要件](requirements/governed-cohort-analysis.md#12-実装時期)と[計測実装要件](requirements/measurement-implementation-assistant.md#12-実装時期と製品境界)の開始条件を満たした時点で、実装Issueを新設する |
| 会議意思決定・Action Package・Slack | 要件または境界設計は完了、製品実装は未着手 | [会議要件](requirements/meeting-decision-loop.md#12-実装時期)、[Action Package要件](requirements/action-package-api.md)、[Slack要件](requirements/slack-analysis-interface.md#8-導入順)を正本とする。既存の生成・認可・revision pipelineを複製しない |
| 可視化選定skill | 要件のみで、現行plannerとは未統合 | [可視化カバレッジ](requirements/evidence-cloud-visualization-coverage.md#8-将来の可視化選定skill)と[ロードマップ](roadmap.md#将来実測で必要になった場合のみ)を正本とする。AI-only plannerのbaselineが安定し、考察とchart選定を分離する必要が実測された場合だけ実装Issueを作る。固定の一対一規則や黙った代替は導入しない |
| 本番edge防御・共有中間結果 | ADR-0020／0021はproposed、設計Issueは完了 | 実顧客dataのinternet公開前、または実測費用がbottleneckになった場合だけADRをreviewし、承認と費用確認後に実装Issueを作る |
| 自動オンボーディング・custom role・pentest・SOC 2・SLA | 現在は実装しない | [ロードマップ](roadmap.md#将来実測で必要になった場合のみ)の実測トリガーが成立した場合だけ要件化する |

旧整理の可視化未対応一覧は、2026-09-11の実装状態には適用しません。
[可視化カバレッジ](requirements/evidence-cloud-visualization-coverage.md#7-現在の要約)ではAI plannerが
42種類を選択でき、代表fixtureのブラウザ描画を確認済みです。残る部分対応はbarの利用者指定orientationと
long形式、Evidenceのinline `Value`、Donutです。任意JavaScriptを含む高度なEChartsは安全性、再現性、
accessibilityの契約がないため意図的に未対応です。42種類の宣言済み対応が実サービス上でも同じ意味を持つかは
#659の監査が完了するまで確定しません。

旧整理で未完了またはclose候補だった#169、#281、#292、#293、#295、#315、#323、#355、#366、
#374、#418、#420はGitHub上でCLOSEDです。#345も要件・境界を作るdocs IssueとしてCLOSEDであり、
将来のAPI実装は開始条件の成立後に別Issueを作ります。これらを現在の作業キューへ戻しません。

以下は製品化の前提と過去の検証記録です。2026-09-11時点でデモprocessのHTTP応答を確認しています。

## 製品化の前提と過去の検証記録

| 項目 | 現在地 |
|------|--------|
| 作業 | Issue #665のBitcoin月範囲・Mixed-Type可読性修正、固定応答確認、ブラウザ描画、必須CI、マージを完了。次の必須作業は上記キュー1の設定不要schema汎用化と固有処理撤去 |
| デモ実行状態 | 2026-09-11にPR #666をマージした最新mainからlocalhost:8765を再起動し、HTTP 200を確認した。Issue #665修正後の追加有料buildは未実施 |
| 直近完了 | [Issue #665](https://github.com/Yukihide-Mitsuoka/repchat/issues/665)／[PR #666](https://github.com/Yukihide-Mitsuoka/repchat/pull/666)でBitcoinの月範囲をpartition範囲として固定し、大数Mixed-Typeの軸・月・表示名を改善した |
| AIができること | Issue #654の承認済み実検証は完了済み。追加の実Vertex AI相談またはSQL生成・BigQuery実行は、対象と費用を提示してオーナー承認を得た場合だけ行う |
| 停止条件 | 固有処理が残る状態を汎用対応と扱わない。未知schemaの反復評価を通すまで、対象非依存性を実証済みとしない |

## 最初に読む順序

1. [status §0](status.md#0-再開手順新しいaiセッション向け)と
   [§1](status.md#1-一行でいうと)で、実装済み範囲、費用、未検証事項を確認する。
2. [positioning §0](positioning.md#0-前提の確認--勝負の土俵)、
   [§2.7〜2.10](positioning.md#27-入口は既存の手作業レポートにする)、
   [§5](positioning.md#5-未検証の仮説と検証方法)で、対象顧客、差別化、検証対象を確認する。
3. [roadmap](roadmap.md)で実施順序を確認する。
4. 下の設計判断索引から、変更対象に関係するADRを全文読む。
5. デモを扱う場合だけ[デモ手順](demo.md)と
   [report-generation spike](../spikes/report-generation/README.md)を読む。

## 直近の生成エラーと修正状態

2026-08-10に、同じ確定済みダッシュボードから会議報告を生成した複数の有料呼出しが、AI応答ごとに
limitationsの数値、根拠外の`22`、または根拠外の`3000`、`4000`、`6`で停止した。左ナビゲーションは
根拠bundleを変更しておらず、独立した各Vertex AI応答をstrict validatorが拒否していた。追加修正では
strict validatorを維持し、生成経路だけで妥当な項目を保持、不正項目を警告付きで除外し、空の必須区分を
根拠付き定型項目で補う。自動再実行はしない。原因と利用者向け動作は
[トラブルシューティング](troubleshooting/live-demo.md#会議報告のlimitationsには根拠リンクのない数値を書けません)
を正本とする。実生成はPRのCIとmerge後に費用を再承認した場合だけ行う。

## 次タスクの分岐

| 条件 | 次の作業 | 先に読む正本 |
|------|----------|--------------|
| 完了した施策handoff設計 | [#345 action package API boundary](https://github.com/Yukihide-Mitsuoka/repchat/issues/345)。同一workspace内でもpermission、credential、API、auditを分離し、承認済みactionをJSON packageとして外部へ渡す。CSV等はadapter、広告・決済writeは対象外 | [施策パッケージAPI要件](requirements/action-package-api.md)、[ADR-0023](adr/0023-unify-workflow-while-isolating-external-action.md)、[会議意思決定ループ要件](requirements/meeting-decision-loop.md) |
| 完了した計測設計支援 | [#343 GA4/GTM measurement implementation assistant](https://github.com/Yukihide-Mitsuoka/repchat/issues/343)。Design Modeは設計・code・import成果物・QA手順、Apply Modeは公式APIの隔離workspace・sync・conflict・quick previewまでとする。browser操作とpublishはしない | [GA4・GTM計測実装アシスタント要件](requirements/measurement-implementation-assistant.md)、[競合比較](competitive-landscape.md)、[ポジショニング](positioning.md) |
| 完了したcohort分析設計 | [#341 governed cohort analysis](https://github.com/Yukihide-Mitsuoka/repchat/issues/341)。日本語で意味をfreezeし、未成熟期間、費用、根拠を統制する要件と、Amplitude／Evidence Cloudとの同一課題benchmarkを記録する | [統制されたコホート分析要件](requirements/governed-cohort-analysis.md)、[競合比較](competitive-landscape.md)、[ポジショニング](positioning.md) |
| 完了した競合・配信境界整理 | [#338 Evidence Cloud positioning and embedded delivery](https://github.com/Yukihide-Mitsuoka/repchat/issues/338)。Evidence Cloud公式仕様を事実側へ置き、RepChatの差別化仮説とauthoring／publishing／embedded deliveryのroute・permission分離を記録する | [競合比較](competitive-landscape.md)、[ポジショニング](positioning.md)、[分析ワークスペースUI要件](requirements/analysis-workspace-ui.md) |
| 現在のUI情報設計 | [#179 dashboard／SQL来歴UX](https://github.com/Yukihide-Mitsuoka/repchat/issues/179)。外部UIは情報構造の参考に限定し、RepChat機能mapping、左右pane、responsive、keyboard、可視context、Insight保存／昇格、review／publish、embedded previewを再現可能な要件として固定する | [分析ワークスペースUI要件](requirements/analysis-workspace-ui.md)、[デモ手順](demo.md)、Issue #179 |
| 完了した会議報告修正 | [#295 evidence validation](https://github.com/Yukihide-Mitsuoka/repchat/issues/295)／[PR #333](https://github.com/Yukihide-Mitsuoka/repchat/pull/333)。strict validatorを維持し、生成経路では根拠外数値を含む項目だけを除外する | [トラブルシューティング](troubleshooting/live-demo.md)、`meeting_report.py` |
| 過去のdashboard行修正 | [#362 row completeness](https://github.com/Yukihide-Mitsuoka/repchat/issues/362)。当時のserver側行補完は[#374 dynamic dashboard planner](https://github.com/Yukihide-Mitsuoka/repchat/issues/374)で廃止。現在はAIが作成した`layout_row`と`layout_weight`を検証して使用し、固定パネルIDを補完しない | [分析ワークスペースUI要件](requirements/analysis-workspace-ui.md)、[デモ履歴](demo.md)、`analysis_planner.py` |
| 過去のdashboard閲覧UX | [#364 dashboard focus mode](https://github.com/Yukihide-Mitsuoka/repchat/issues/364)。build成功時だけ右paneを閉じ、composerを小型ランチャーへ縮小する。hoverでは状態を変えず、click／keyboardで下書きとactionを保持した入力欄へ復帰する。旧デモ実装とfixtureは削除済み | [分析ワークスペースUI要件](requirements/analysis-workspace-ui.md)、[デモ履歴](demo.md) |
| 過去のデモUX | [#352 unified analysis workspace](https://github.com/Yukihide-Mitsuoka/repchat/issues/352)。4つのpeer modeを成果物treeと分析スレッドへ変え、中央下端の共通composerからdashboard／Insight／reportを明示選択した。旧デモ実装とfixtureは削除済みで、現在の製品能力ではない | [分析ワークスペースUI要件](requirements/analysis-workspace-ui.md)、[デモ履歴](demo.md) |
| 完了したデモ調整 | [#355 composer and dashboard row resize](https://github.com/Yukihide-Mitsuoka/repchat/issues/355)／[PR #356](https://github.com/Yukihide-Mitsuoka/repchat/pull/356)。旧デモでcomposerとdashboard配置を調整した。旧デモ実装とfixtureは削除済みで、現在の製品能力ではない | [分析ワークスペースUI要件](requirements/analysis-workspace-ui.md)、[デモ履歴](demo.md) |
| 完了した分析相談UX | [#373 stateful AI consultation](https://github.com/Yukihide-Mitsuoka/repchat/issues/373)。Vertex AIへschema・metric・期間・目的・最大8 turnの履歴を渡す旧デモを実装した。旧入口は削除済みで、plannerの対象非依存化だけを継続する | [分析ワークスペースUI要件](requirements/analysis-workspace-ui.md)、[デモ履歴](demo.md)、`analysis_planner.py` |
| 完了したdashboard planner | [#374 dynamic dashboard planner](https://github.com/Yukihide-Mitsuoka/repchat/issues/374)。AIが作る仕様を固定候補IDへ置換しないplannerを実装した。旧デモ入口は削除済みで、plannerの対象非依存化だけを継続する | [デモ履歴](demo.md)、`analysis_planner.py` |
| 過去のデモ阻害解消 | [#325 requested navigation depth](https://github.com/Yukihide-Mitsuoka/repchat/issues/325)／[PR #326](https://github.com/Yukihide-Mitsuoka/repchat/pull/326)。旧デモのcustom depth検査を修正した。旧入口は削除済み | [デモ履歴](demo.md)、[トラブルシューティング履歴](troubleshooting/live-demo.md) |
| 過去の認証修正 | [#321 ADC再認証エラー](https://github.com/Yukihide-Mitsuoka/repchat/issues/321)／[PR #322](https://github.com/Yukihide-Mitsuoka/repchat/pull/322)。旧デモで`RefreshError`を安全な復旧手順へ変換した。旧入口は削除済み | [デモ履歴](demo.md)、[トラブルシューティング履歴](troubleshooting/live-demo.md) |
| 過去のデモ修正 | [#319 Sankey SVG ID分離](https://github.com/Yukihide-Mitsuoka/repchat/issues/319)／[PR #320](https://github.com/Yukihide-Mitsuoka/repchat/pull/320)。旧デモで複数workspaceのSVG ID衝突を修正した。旧入口は削除済み | [デモ履歴](demo.md)、[トラブルシューティング履歴](troubleshooting/live-demo.md) |
| 現在の要件記録 | [#317 会議意思決定ループ](https://github.com/Yukihide-Mitsuoka/repchat/issues/317)／[PR #318](https://github.com/Yukihide-Mitsuoka/repchat/pull/318)。会議報告を最大3件の意思決定、担当付きアクション、次回の効果検証へ接続する将来要件を記録する | [会議意思決定ループ要件](requirements/meeting-decision-loop.md)、[適応型分析メモリー要件](requirements/adaptive-analysis-memory.md)、Issue #181 |
| 完了したVertex AI費用表示修正 | [#311 thought token accounting](https://github.com/Yukihide-Mitsuoka/repchat/issues/311)／[PR #335](https://github.com/Yukihide-Mitsuoka/repchat/pull/335)。分析計画とSQL生成のthought tokensを費用へ含める | [demo](demo.md)、`analysis_planner.py`、`run_report.py` |
| 完了したdoctorのslow test分離 | [#315 foundation test split](https://github.com/Yukihide-Mitsuoka/repchat/issues/315)。`setup-github.sh` wrapperではなく、一時Gitリポジトリを反復する`test_template_inheritance_plan.py`をslow suiteへ分離した。`make doctor`と`make doctor-slow`をCIの独立jobで実行し、timeout延長・retry・skipは行わない | `scripts/foundation_test_runner.py`、`scripts/template-check.sh`、`Makefile`、`.github/workflows/ci.yml` |
| 完了したcoverage起動診断 | [#481 startup timeout](https://github.com/Yukihide-Mitsuoka/repchat/issues/481)。設定不足をDB・BigQuery等のruntime importより先に拒否し、coverage負荷に依存せずexit 2を返す。回帰テストは早期runtime importを決定的に拒否し、診断・exit・closeの時間とsignalを失敗表示へ残す | `src/main/control-plane-server.ts`、`src/main/executor-server.ts`、`tests/main/servers-startup.test.ts` |
| 現在のpanel合成設計 | [#308 versioned panel composition](https://github.com/Yukihide-Mitsuoka/repchat/issues/308)。AI生成原本を上書きせず、参照追加・fork・利用者作成panelを派生dashboard revisionで合成するproposed ADRをreviewする | ADR-0013/0014/0015、ADR-0022、Issue #179/#180 |
| 現在のbuild費用設計 | [#306 cost-gated shared intermediates](https://github.com/Yukihide-Mitsuoka/repchat/issues/306)。direct実行を既定とし、実測thresholdを満たすbuildだけに共有中間結果を提案するproposed ADRをreviewする | ADR-0013/0014/0015、ADR-0021、Issue #180 |
| 現在の本番security設計 | [#302 production edge and origin protection](https://github.com/Yukihide-Mitsuoka/repchat/issues/302)。Cloudflare WAFとCloud Armorの責任境界、Cloud Run direct URL遮断、費用、rolloutをproposed ADRとしてレビューする | ADR-0005/0006/0010/0012、ADR-0020 |
| 現在のPhase 0設計 | [#300 scoped context memory](https://github.com/Yukihide-Mitsuoka/repchat/issues/300)。データソース契約、任意org unit、用途別context compiler、UIの必須／任意文脈をproposed ADRとしてレビューする | [適応型分析メモリー要件](requirements/adaptive-analysis-memory.md)、ADR-0018、ADR-0019 |
| 過去のデモ確認 | 旧対象別ライブデモ入口と固定応答testは削除済み。過去の確認結果を対象非依存性の証拠にしない | [デモ履歴](demo.md)、[トラブルシューティング履歴](troubleshooting/live-demo.md) |
| 固定応答確認後 | 実Vertex AI相談の費用を提示して承認を得てから同じ依頼を1回実行する。相談成功後のBigQuery buildは別の費用確認とし、同時に承認された扱いにしない | #273、#180 |
| #179と#188が完了 | [#180 対話による分析仕様確定とbuild](https://github.com/Yukihide-Mitsuoka/repchat/issues/180) | #179の設計成果、ADR-0013/0015 |
| #180でanalysis specification revision契約を確定 | 適応型分析メモリーPhase 1の実装Issueを作る | [適応型分析メモリー要件](requirements/adaptive-analysis-memory.md)、ADR-0018。初期は手動方針・承認・表示・取消だけ |
| 統制された生成・公開経路が安定 | [#181 根拠付き経営報告](https://github.com/Yukihide-Mitsuoka/repchat/issues/181) | #180のrevision契約、SQL来歴・検証結果 |
| 課金または本番オンボーディングへ着手 | [#194 課金区分と認証方式のオーナー決定](https://github.com/Yukihide-Mitsuoka/repchat/issues/194)を専用grill-meで先に完了する。現在のデモはblockしない | [mission](../.ai/mission.md)、[positioning §6](positioning.md#6-missionmd-との残る不一致未解消) |
| Slack利用が実顧客で確認された | オーナーがADR-0017を承認した後、検証済みrevisionのlink通知pilot用Issueを作る | ADR-0017。自由質問は#180と#188の完了後 |
| 完了したHTTP round-trip診断 | [#169 serve round-trip flake](https://github.com/Yukihide-Mitsuoka/repchat/issues/169)。テストlistenerを`127.0.0.1`へ隔離し、起動時socket errorを`serve()`のreject理由として保持する。closeは同じPromiseへ集約し、listener解放後の同一port再利用を回帰テストで確認する | `src/main/serve.ts`、`tests/main/serve.test.ts`、[troubleshooting](troubleshooting/live-demo.md) |

## 設計判断の索引

2026-09-12更新：[ADR-0025](adr/0025-discover-analysis-contracts-without-source-specific-code.md)で、
分析対象固有のcode・設定・手動定義なしに、認可済みscopeから共通分析契約を自動生成することが承認されました。
ADR-0013、ADR-0019、ADR-0024はこの判断で置き換えられました。未知schema最低2種類の反復評価を通すまで、
任意schema対応を実証済みとは扱いません。

| 論点 | 状態 | 正本 |
|------|------|------|
| 主要顧客と販売経路 | 確定。代理店・ソフトウェアベンダーが初期主経路、直販はフォールバック | [mission](../.ai/mission.md)、[positioning §0](positioning.md#0-前提の確認--勝負の土俵) |
| テナント分離と接続主体 | accepted。接続主体はテナント単位の機械IDで、人間の認証主体と分離 | [ADR-0005](adr/0005-cache-and-authorization-architecture.md)、[ADR-0010](adr/0010-connection-identity-is-never-a-person.md) |
| 分析契約の発見 | accepted。認可済みscopeのschema・metadata・bounded value profileから対象非依存の共通pipelineで自動生成し、対象別code・設定・手動定義を追加しない | [ADR-0025](adr/0025-discover-analysis-contracts-without-source-specific-code.md) |
| 旧指標定義層 | superseded。対象別の指標定義登録、未定義語の確認・拒否を新しい分析対象の前提にしない | [ADR-0013](adr/0013-metric-definitions-live-in-our-own-layer.md)、[ADR-0025](adr/0025-discover-analysis-contracts-without-source-specific-code.md) |
| 生成物の所有 | accepted。ページ・SQL・manifest等の生成物の所有と配置だけを定め、新しい分析対象の手動登録根拠にはしない | [ADR-0014](adr/0014-who-owns-the-generated-artifacts.md)、[ADR-0025](adr/0025-discover-analysis-contracts-without-source-specific-code.md) |
| Git配送と閲覧 | accepted。Gitはbuild時だけ使用し、閲覧経路へ入れない。GitHub/managedは同じpipelineの保存先adapter | [ADR-0015](adr/0015-publish-artifacts-through-customer-git.md) |
| Slack | proposed。Webを正本UIとする認可付きadapter案。オーナー承認前は実装禁止 | [ADR-0017](adr/0017-use-slack-as-an-authorized-analysis-interface.md) |
| 適応型分析メモリー | accepted。生の会話ではなくscope・権限・revision・期限を持つ方針をPostgresの正本で管理し、AIは候補を作るが自動昇格しない | [要件](requirements/adaptive-analysis-memory.md)、[ADR-0018](adr/0018-govern-adaptive-analysis-memory.md) |
| 旧データソース知識登録案 | superseded。手動のデータソース契約revisionや登録を分析対象追加の前提にしない。組織文脈のgovernanceは別問題としてADR-0018に従う | [ADR-0019](adr/0019-separate-datasource-knowledge-from-scoped-analysis-context.md)、[ADR-0025](adr/0025-discover-analysis-contracts-without-source-specific-code.md) |
| 本番公開入口とorigin防御 | proposed。Cloudflare WAFを利用者入口、External Application Load Balancer＋Cloud ArmorをCloud Run迂回防止境界とする。local demoは対象外で、オーナー承認と費用確認前はinfra作成禁止 | [ADR-0020](adr/0020-protect-production-edge-and-cloud-run-origins.md)、[#302](https://github.com/Yukihide-Mitsuoka/repchat/issues/302) |
| dashboard buildの共有中間結果 | proposed。panel別direct実行を既定とし、個別buildの絶対削減額と削減率が実測thresholdを超える場合だけcost plannerが提案する。customer datasetへの書き込み権限を既定で増やさない | [ADR-0021](adr/0021-gate-shared-intermediates-on-measured-build-cost.md)、[#306](https://github.com/Yukihide-Mitsuoka/repchat/issues/306) |
| panel再利用と利用者編集 | proposed。panelを不変revisionとし、AI生成dashboardは上書きせず、参照追加・fork・利用者作成SQLを派生dashboardへ合成する。利用者SQLは同じ認可・検証・費用確認を通す | [ADR-0022](adr/0022-compose-derived-dashboards-from-versioned-panels.md)、[#308](https://github.com/Yukihide-Mitsuoka/repchat/issues/308) |
| 計測から施策handoffまでの製品境界 | proposed。同じworkspace shellで文脈を接続するが、permission、credential、API、auditを分ける。承認済みactionはprovider非依存Action Packageとして出力し、広告・予算・決済writeはCoreに入れない | [ADR-0023](adr/0023-unify-workflow-while-isolating-external-action.md)、[要件](requirements/action-package-api.md)、[#345](https://github.com/Yukihide-Mitsuoka/repchat/issues/345) |
| 統制されたcohort分析 | draft。日本語で分析主体、起点・復帰event、retention方式、期間、timezoneをfreezeし、未成熟期間を0にせず、費用・SQL・集計data・根拠を同じrevision chainへ結ぶ | [要件](requirements/governed-cohort-analysis.md)、[#341](https://github.com/Yukihide-Mitsuoka/repchat/issues/341) |
| 接続先・テーブル選択 | 将来設計。ユーザーに任意のdataset/tableを列挙させず、管理者が承認したデータソース・分析領域・テーブルカタログからサーバー側で解決する | [ADR-0005](adr/0005-cache-and-authorization-architecture.md)、[ADR-0010](adr/0010-connection-identity-is-never-a-person.md)、#180 |
| 課金区分・エンドユーザー認証 | 未決。AIは推測しない | [Issue #194](https://github.com/Yukihide-Mitsuoka/repchat/issues/194) |

## 誤って前提にしてはいけないこと

- ローカルデモは`spikes/`内にあり、本番の認証、gate、executor、顧客Git配送を通らない。
- 公開GA4の成功は未知の独自nested/repeated schemaへの対応を証明しない。
- 生成SQLの構文は毎回同じでなくてよい。指標の意味、出力形状、既知値照合を固定する。
- 生の会話履歴、生成SQL、query resultは分析方針メモリーの正本ではない。類似度を認可境界に使わない。
- BigQuery SQLとEvidence SQLの双方で必要列を明示し、`SELECT *`を生成しない。
- 顧客Gitをページ表示時に参照せず、失敗したbuildを有効化しない。
- 実Vertex AIまたはBigQueryを使う評価は、対象非依存runtimeと評価harnessの完成後に費用を明示し、オーナーの同意を得る。
- 測っていない結果、独自schema品質、更新SLO、製品統合状態を実証済みと書かない。

この文書は、現在のIssue、停止条件、次タスクの分岐、または設計判断の正本が変わったときに更新します。
