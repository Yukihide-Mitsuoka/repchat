---
id: schema-generalization-evaluation
title: 未知schema反復評価の証拠harness
status: active
updated: 2026-09-21
---

# 未知schema反復評価の証拠harness

`evaluate.py`は、対象非依存runtimeの実行後に得たJSON evidence bundleを検証し、schema別の品質指標と
合否を決定論的に返すpost-run scorerです。外部APIや製品runtimeは呼びません。

## 評価契約

- IDとscope snapshot fingerprintが異なる2件以上のschema evidenceを同じ評価に含め、各caseを3回以上反復する。
- 全runでruntime、prompt、設定のSHA-256 fingerprintを一致させる。
- runtime inputはscope snapshot fingerprint、analysis contract fingerprint、質問だけに限定する。scope discovery停止時は両fingerprint、analysis contract生成停止時はcontract fingerprintだけを`null`とし、未取得値を捏造しない。
- contract生成後へ進んだ同じcaseの反復runは、同一のanalysis contract fingerprintを再現する。
- 計画済みrunが途中停止しても記録から除外せず、固定failure stageと安全なmachine codeで成功率・一致率の分母へ残す。
- 参照SQLと期待結果はpost-run scorerだけが読み、生成runtimeへ渡さない。
- 参照結果は作成者と異なるreviewerが承認する。
- schemaごとに90%以上の結果一致を要求し、意味上の誤り、未認可参照、危険なSQL、scan上限超過を1件でも検出したら不合格にする。
- evidence version、参照記録、runのfieldと型を厳密に検証し、曖昧な行順序や未知fieldを推測で受理しない。

bundleには`version`、`thresholds`、2件以上の`schemas`を記録します。schemaごとのcaseは質問、参照SQL、
期待行、行順序、review記録、反復runを持ちます。runには同一pipelineのfingerprint、実際の
runtime input、生成SQL、実行結果、描画成否、安全違反、処理bytes、費用、失敗stageを記録します。
evidence bundleはversion 3です。

## 参照fixtureとrun記録の分離

`assemble.py`は、version 2の独立review済み参照fixture、version 1の実行前評価計画、version 5のruntime実行後の
run記録、version 1のscope snapshot artifact、version 1のanalysis contract artifact、実行に使用した
runtime・prompt・configurationの3つの不透明なartifact fileを検証し、schema ID・case IDだけで結合します。
fixture caseにはID、質問、参照記録、評価capabilityだけを許可し、runを含めません。各schemaは`nested_unnest`、
`multi_level_nesting`、`join`、`period_comparison`、`window_function`、`ordered_behavior`をcase全体で網羅する必要があります。
capabilityは評価範囲のreview用であり、runtime inputと結合後のevidenceには渡しません。run記録にはschema ID、case ID、
既存の厳密なrun契約だけを許可し、参照SQLや期待結果の混入、未知のschema／case、記録のないfixture caseを拒否します。

実行前評価計画は、fixture fileのSHA-256、3つのpipeline artifact fingerprint、実行予定のschema ID・case ID・run IDを
固定します。run記録は評価計画fileの正確なbytesのSHA-256を持ちます。assemblerはfixture、pipeline artifact、計画、記録を
相互照合し、全fixture caseに計画runがあること、計画と記録のrun IDが重複なく完全一致することを要求します。これにより、
結果確認後の参照内容変更、pipeline差し替え、成功runだけの選別、未記録runを検出します。計画とfingerprintはruntime inputへ
渡しません。fileだけでは作成時刻や作成者を証明しないため、独立review記録と実行前の保全手続きは引き続き別途必要です。

`execution_manifest.py`はreview済みfixture、評価計画、認可scopeを照合し、runtime専用manifestを`0600`で新規作成します。
manifestはschema／case ID、質問、run ID、pipeline fingerprint、dataset／tableの認可scopeだけを持ち、参照SQL、期待結果、
capability、対象別profileや設定を拒否します。runtimeはreview fixtureではなく、このmanifestを入力にします。

`manifest_preflight.py`はmanifest全体のversion、field、fingerprint、scope、schema／case／run identityを
runtime呼出し前に検証し、記載順どおり全計画attemptを共通`run_preflight`へ渡します。各attemptはmanifestの
pipeline fingerprintに固定され、preflight失敗時だけ呼出し側が実測したbytes・費用を渡してrun記録を作れます。
成功attemptはplanning以降へ渡すため保持し、この境界で成功runを捏造しません。

`manifest_planning.py`は全preflightの順序とidentityを維持し、成功attemptだけを既存の共通
`analysis_workflows.plan_dashboard`へ渡します。plannerへ渡すruntime入力はmanifestの質問とpreflightが生成した
共通分析契約で、初回回答・現在案・revision指示は空です。成功時は正確な契約fingerprintへbindされた計画とplanner費用を
保持します。preflight失敗時はplannerを呼ばず、planningの例外、plan event欠落、契約不一致、費用形式不正はraw detailを
保存せず固定`planning`／`planning_failed`へ変換します。評価artifactはcaseごとに参照SQLと期待結果を1件ずつ持つため、
評価呼出しだけ共通plannerへ1パネルを要求します。通常のdashboardの設定件数は変更しません。確認質問、0件または
複数パネルが返った場合は自動回答や恣意的なパネル選択を行わずplanning失敗へ閉じます。planning失敗はBigQuery処理bytesを
0に限定してrun記録へ残します。

`manifest_sql_generation.py`はplanningまでの順序とidentityを維持し、成功した単一panelだけを既存の
`build_planned_analysis_section`と共通`sql_generation.generate`へ渡します。期間とSQL system instructionは同じ
共通分析契約から導出し、対象名やfixture参照情報を追加しません。成功時はtrim済み生成SQL、共通section、SQL生成費用を
保持します。前段失敗時はSQL generatorを呼ばず、生成例外、空SQL、未定義語による拒否、SQLと未定義語の同時返却、
不正形式、費用形式不正をraw detailなしの固定`sql_generation`／`sql_generation_failed`へ変換します。
このstageはSQL検証、dry run、BigQuery実行を行いません。

`manifest_sql_validation.py`はSQL生成までの順序とidentityを維持し、成功attemptだけを既存の共通
`validate_sql`、`contract_period_diagnostic`、`validate_generated_dashboard_sql`へ順に渡します。
SELECT-only、単一statement、認可table・field、nested／repeated path、期間・partition、出力alias・行上限・集計形状を
対象非依存の同じpolicyで検証します。契約外table・fieldを`unauthorized_reference`、非SELECT・複文・禁止操作等を
`dangerous_sql`、期間・可視化出力契約の不一致を`semantic_error`として記録します。診断文は保存せず、失敗を固定
`sql_validation`／`sql_validation_failed`へ変換します。生成SQLはreview用に保持し、失敗時の処理bytesは0に限定します。
このstageはdry runまたはBigQuery実行を行いません。

`manifest_dry_run.py`はlocal SQL検証までの順序とidentityを維持し、成功attemptだけを既存の共通
`inspect_bq_dry_run`へ渡します。BigQueryが解析したstatement type、参照table、出力schema、推定処理bytesを取得し、
分析契約のtable allowlist、`maximum_bytes_billed`、結果列、可視化shapeと照合します。失敗はraw provider診断を保存せず、
固定`dry_run`／`dry_run_failed`と安全性booleanへ変換します。推定bytesは観測値としてattemptへ保持しますが、
dry runは結果行を取得しないため、run記録の`bytes_processed`は0です。このstageはBigQuery query execution、
結果検証、描画を行いません。

`manifest_execution.py`はdry runまでの順序とidentityを維持し、成功attemptだけを既存の共通
`execute_bq`へ渡します。契約の`maximum_bytes_billed`とsection／契約の小さい方の行上限＋1件を使い、
成功時は行、列、実`total_bytes_processed`を保持します。前段失敗ではBigQueryへ接触せず、実行失敗はraw provider診断を
保存しない固定`execution`／`execution_failed`へ変換します。結果行数・列・値の意味検証とJSON変換、描画は後続stageです。

`manifest_result_validation.py`は実行までの順序とidentityを維持し、成功attemptだけを製品側と同じ共通
`validate_dashboard_result`へ渡します。sectionと契約の小さい方の行上限、契約上の列、可視化shapeを照合し、
日付と`Decimal`を含む成功行をJSON-safe化します。検証失敗はSQL実行成功と実処理bytesを保持する一方、
生の未検証行と例外診断を保存せず、固定`result_validation`／`result_validation_failed`と
`semantic_error=true`へ変換します。描画は後続stageです。

scope snapshot artifactは、scope discoveryを完了した計画runがあるschemaと一対一で対応する`schema_id`、対象非依存runtimeが生成した
`DiscoverySnapshot.content_json`、timezone付き`retrieved_at`だけを持ちます。assemblerは`content_json`がruntimeと同じ
canonical JSON表現であること、そのSHA-256がfixtureとscope discovery完了runのfingerprintに一致することを検証します。
不要・重複・必要なschemaの欠落は拒否します。全runがscope discoveryで停止したschemaにはsnapshotを要求せず、
各runの未取得fingerprintを`null`のまま保持します。snapshot内容と取得時刻は結合後のevidenceへ複製せず、fingerprintだけを残します。
このartifactはschema metadataとbounded value profileを含む可能性があるため、fixtureやrunと同じ認可済みローカル領域で
管理し、CI logまたはrepositoryへ保存してはいけません。

analysis contract artifactは、contract生成後へ進んだ計画runがあるschema／caseと一対一で対応する`schema_id`、`case_id`、対象非依存runtimeが
生成したcanonical `AnalysisContract.content_json`だけを持ちます。assemblerはruntimeと同じ規則でfingerprintを再計算し、
contract生成後へ進んだrunのfingerprintへ照合します。contract内のschema fingerprintと取得時刻は同じschemaのscope
snapshot observationと一致しなければなりません。不要・重複・必要なcaseの欠落、非canonical JSON、内容改変は拒否します。
全runがscope discoveryまたはcontract生成で停止したcaseにはcontract artifactを要求せず、未取得fingerprintを`null`のまま保持します。
contract本文は結合後のevidenceへ複製せず、fingerprintだけを残します。このartifactも認可済みローカル領域だけで管理します。

`preflight.py`は、実際の共通`discover_scope`と`generate_discovered_contract_artifacts`を順に呼び、
planning前のruntime境界を評価artifactへ接続します。成功時は、日次shard統合があれば統合後の
`DiscoverySnapshot`と、その正確なsnapshotから生成した`AnalysisContract`を同じ結果として返します。
scope discoveryまたはcontract生成で停止した場合は、raw例外文を保持せず、固定stageと安全なmachine code、
その時点までに実在するartifactだけを返します。失敗runへ記録する処理bytesと費用はこの境界で推測せず、
実行を計測する呼出し側が`failure_recording`へ明示的に渡します。contract生成失敗時のtoken usageも
取得済みと証明できないため`null`とし、ゼロを捏造しません。

この境界はartifactをrepositoryへ保存せず、manifest駆動で単一panelのBigQuery query executionと
共通結果検証まで反復します。描画はまだ実行しません。
共通planner自体は、共通分析契約が十分なら初回clarificationを0件にでき、確認が不可欠な場合だけ未回答fieldを最大3件返します。
評価runnerは対話を持たないため、clarificationが1件でもあればそのattemptを成功扱いしません。
利用者確認をschema理解や対象固有の意味定義の代替にはしません。
したがって、単独では反復評価runnerの完成や未知schema品質の実証を意味しません。

runtime・prompt・configuration artifactは、最初のrun前に固定した非空の通常fileを渡します。runtimeが複数fileから
成る場合は、file path・mode・内容を決定論的に固定したbundleを1つのartifactにします。assemblerは各fileの正確なbytesから
SHA-256を再計算し、全runの対応するfingerprintへ照合します。artifact本文とpathは結合後のevidenceへ複製しません。
この照合は実行後のartifact差し替えや自己申告fingerprintの不一致を検出しますが、artifactの作成主体、署名、実際にその
artifactを起動したことまでは単独で証明しません。

各runの`failure_stage`は`none`、`scope_discovery`、`analysis_contract_generation`、`planning`、`sql_generation`、`sql_validation`、`dry_run`、`execution`、
`result_validation`、`rendering`のいずれかです。正常終了は`none`と空の`failure_code`、途中停止は対応stageと
小文字英数字・underscoreだけの64文字以下のmachine codeを記録します。providerの例外文、SQL、table名、値を
`failure_code`へ保存してはいけません。stageごとに生成SQLの有無、実行成否、結果行、描画成否、処理bytesの整合を検証し、
矛盾するrunを拒否します。失敗runも削除せず、schema別の`failure_count`と`failure_stage_counts`へ集計します。

結合後のevidenceには期待行と実行行が含まれるため、標準出力へは出しません。指定した新規fileを所有者だけが
読書きできる`0600`で作り、既存fileや入力fileの上書きも拒否します。artifactは認可されたローカル領域で管理し、
CI logやrepositoryへ保存しません。

## 実行

```console
python3 spikes/schema-generalization-evaluation/execution_manifest.py \
  /path/to/reviewed-fixture.json /path/to/evaluation-plan.json \
  /path/to/authorization.json /secure/path/execution-manifest.json
python3 spikes/schema-generalization-evaluation/assemble.py \
  /path/to/reviewed-fixture.json /path/to/evaluation-plan.json \
  /path/to/recorded-runs.json \
  /path/to/scope-snapshots.json /path/to/analysis-contracts.json \
  /path/to/runtime.artifact /path/to/prompt.artifact \
  /path/to/configuration.artifact \
  /secure/path/evidence.json
python3 spikes/schema-generalization-evaluation/evaluate.py /path/to/evidence.json
```

run記録は次のtop-level契約を使います。`evaluation_plan_sha256`は実行前評価計画file bytesの小文字SHA-256です。

```json
{"version":5,"evaluation_plan_sha256":"0000000000000000000000000000000000000000000000000000000000000000","runs":[]}
```

assemblerのexit code `0`は結合成功、`2`は入力契約違反です。scorerのexit code `0`は合格、`1`は検証可能な
未合格、`2`はbundle契約違反です。scorerは生の期待行・実行行を含めず、集計reportだけを標準出力へ残します。

## 現在の制限

公式の未知schema fixtureと実サービス結果はまだありません。テスト値はscorerの回帰確認用であり、製品能力の
証拠ではありません。評価計画とartifact照合は作成時刻、実行主体の本人性、署名、process-level attestationを証明しません。
独立review済みfixture、実値照合、同一runtimeでの実反復評価は未完了です。有料評価は対象と費用について
オーナー承認を得た後だけ実行します。
