---
id: schema-generalization-evaluation
title: 未知schema反復評価の証拠harness
status: active
updated: 2026-09-22
---

# 未知schema反復評価の証拠harness

`evaluate.py`は、対象非依存runtimeの実行後に得たJSON evidence bundleを検証し、schema別の品質指標と
合否を決定論的に返すpost-run scorerです。外部APIや製品runtimeは呼びません。

## 現行の評価契約

- IDとscope snapshot fingerprintが異なる2件以上のschema evidenceを同じ評価に含め、各caseを3回以上反復する。
- 全runでruntime、prompt、設定のSHA-256 fingerprintを一致させる。
- runtime inputはscope snapshot fingerprint、analysis contract fingerprint、質問だけに限定する。scope discovery停止時は両fingerprint、analysis contract生成停止時はcontract fingerprintだけを`null`とし、未取得値を捏造しない。
- contract生成後へ進んだ同じcaseの反復runは、同一のanalysis contract fingerprintを再現する。
- 計画済みrunが途中停止しても記録から除外せず、固定failure stageと安全なmachine codeで成功率・一致率の分母へ残す。
- 参照SQLと期待結果はpost-run scorerだけが読み、生成runtimeへ渡さない。
- 参照結果は作成者と異なるreviewerが承認する。
- schemaと各caseで90%以上の結果一致、各caseで描画成功率100%を要求し、意味上の誤り、未認可参照、危険なSQL、scan上限超過を1件でも検出したら不合格にする。
- fixtureの必須capability別にend-to-end成功runを集計し、成功が0件のcapabilityを持つschemaは不合格にする。
- evidence version、参照記録、runのfieldと型を厳密に検証し、曖昧な行順序や未知fieldを推測で受理しない。

この契約は現在の実装を説明するものです。実サービス評価を開始する前に、後述の
[実評価前の強化計画](#実評価前の強化計画)で失敗分類を追加します。

bundleには`version`、`thresholds`、2件以上の`schemas`を記録します。schemaごとのcaseは質問、capability、参照SQL、
期待行、行順序、review記録、反復runを持ちます。runには同一pipelineのfingerprint、実際の
runtime input、生成SQL、実行結果、描画成否、安全違反、処理bytes、費用、失敗stageを記録します。
evidence bundleはversion 5です。

## 参照fixtureとrun記録の分離

`assemble.py`は、version 2の独立review済み参照fixture、version 1の実行前評価計画、version 6のruntime実行後の
run記録、version 1のscope snapshot artifact、version 1のanalysis contract artifact、実行に使用した
runtime・prompt・configurationの3つの不透明なartifact fileを検証し、schema ID・case IDだけで結合します。
fixture caseにはID、質問、参照記録、評価capabilityだけを許可し、runを含めません。各schemaは`nested_unnest`、
`multi_level_nesting`、`join`、`period_comparison`、`window_function`、`ordered_behavior`をcase全体で網羅する必要があります。
capabilityは評価範囲のreviewとpost-run集計にだけ使用し、runtime manifestへ渡しません。assemblerはreview済みの
capabilityをevidenceへ結合します。run記録にはschema ID、case ID、
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
複数パネルが返った場合は自動回答や恣意的なパネル選択を行わずplanning失敗へ閉じます。planning失敗でも、
先行するscope discoveryで実行したqueryの処理bytesをrun記録へ残します。

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
`sql_validation`／`sql_validation_failed`へ変換します。生成SQLはreview用に保持し、先行するscope discoveryの
実処理bytesもrun記録へ残します。
このstageはdry runまたはBigQuery実行を行いません。

`manifest_dry_run.py`はlocal SQL検証までの順序とidentityを維持し、成功attemptだけを既存の共通
`inspect_bq_dry_run`へ渡します。BigQueryが解析したstatement type、参照table、出力schema、推定処理bytesを取得し、
分析契約のtable allowlist、`maximum_bytes_billed`、結果列、可視化shapeと照合します。失敗はraw provider診断を保存せず、
固定`dry_run`／`dry_run_failed`と安全性booleanへ変換します。推定bytesは観測値としてattemptへ保持しますが、
dry run自体の推定bytesは実処理bytesへ加えず、先行するscope discoveryの実処理bytesだけをrun記録へ残します。
このstageは最終SQLのBigQuery query execution、
結果検証、描画を行いません。

`manifest_execution.py`はdry runまでの順序とidentityを維持し、成功attemptだけを既存の共通
`execute_bq`へ渡します。契約の`maximum_bytes_billed`とsection／契約の小さい方の行上限＋1件を使い、
成功時は行、列、実`total_bytes_processed`を保持します。前段失敗ではBigQueryへ接触せず、実行失敗はraw provider診断を
保存しない固定`execution`／`execution_failed`へ変換します。結果行数・列・値の意味検証とJSON変換、描画は後続stageです。

`manifest_result_validation.py`は実行までの順序とidentityを維持し、成功attemptだけを製品側と同じ共通
`validate_dashboard_result`へ渡します。sectionと契約の小さい方の行上限、契約上の列、可視化shapeを照合し、
日付と`Decimal`を含む成功行をJSON-safe化します。検証失敗はSQL実行成功と実処理bytesを保持する一方、
生の未検証行と例外診断を保存せず、固定`result_validation`／`result_validation_failed`と
`semantic_error=true`へ変換します。

`manifest_rendering.py`は結果検証までの順序とidentityを維持し、成功attemptのJSON-safeな
`visualization`、`columns`、`rows`だけを別processの共通renderer probeへ渡します。probeは
vendored EChartsのSVG SSRまたは共通DOM rendererを実行し、終了code 0だけを描画成功とします。
描画拒否、timeout、起動失敗、例外はraw detailを保存しない固定`rendering`／`rendering_failed`へ閉じます。
描画失敗でも検証済み行は保持し、結果一致と描画成否を独立評価できます。前段失敗ではprobeを呼びません。
最終run記録は最終queryの実行metadata以上のrun全体の実処理bytesだけを受理し、費用は推測せず計測側から明示的に受け取ります。

`manifest_artifacts.py`は全計画runと完了attempt、外部計測した処理bytes・費用を一対一に照合し、
`recorded-runs.json`、`scope-snapshots.json`、`analysis-contracts.json`を既存assemblerへ渡せる形にします。
同じschema／case内でsnapshotまたはcontractが変化した場合は、どれかを選ばず停止します。出力は新規`0700`
directory内の`0600` fileに限定し、既存pathを上書きしません。前段失敗時は、その時点で実在するartifactだけを残します。
計測付き実行入口は各計画runを参照情報のない単独manifestへ分け、外部meterへ渡した実行callbackがちょうど1回
呼ばれた場合だけattemptと計測値を採用します。出力先とmanifest全体は最初のruntime callより前に検証します。
`manifest_runtime_meter.py`は実行に渡すBigQuery／Vertex clientを共通proxyで包み、1 run内の全Vertex responseの
token usage、全BigQuery query jobの実処理bytesと課金bytes、dry runの推定bytesを区別して集計します。
完了していないjob、欠落・矛盾したprovider metadata、応答を得られないprovider例外は計測不能として拒否します。
費用は明示的なtoken／TiB単価と実測usageだけから計算し、呼出し回数や成功stageから推測しません。
`run_runtime_metered_manifest_evaluation`はこのproxyを計測付きmanifest実行入口へ渡し、実行に使うclientと
計測するclientを同一にします。価格は呼出し側の明示入力が必須で、ここではprovider接続や有料実行を開始しません。

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
scope discoveryの既知検証拒否とcontract compilerの既知拒否で停止した場合だけ、raw例外文を保持せず、
固定stageと安全なmachine code、その時点までに実在するartifactだけを返します。schema inspectionとscope
discoveryのprovider／dependency障害は安全な専用派生型へ正規化し、Vertex provider障害、基盤障害、未知例外と
ともにpreflightから伝播させます。失敗runへ記録する処理bytesと費用はこの境界で推測せず、
実行を計測する呼出し側が`failure_recording`へ明示的に渡します。contract生成失敗時のtoken usageも
取得済みと証明できないため`null`とし、ゼロを捏造しません。

この境界はartifactをrepositoryへ保存せず、manifest駆動で単一panelのBigQuery query execution、
共通結果検証、共通renderer probeまで反復し、最終run記録を組み立てます。
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

## 実評価前の強化計画

[Issue #788](https://github.com/Yukihide-Mitsuoka/repchat/issues/788)で、実Vertex AI／BigQueryを使う前に
評価結果の安全性と再現性を強化します。ここを実装計画の正本とし、handoff、status、roadmapには現在地と
完了条件だけを同期します。

### 変更後の合否契約

実評価の合格には、現行契約に加えて次をすべて要求します。

- schema全体の結果一致率が90%以上であり、かつ各caseの結果一致率も90%以上である。各case最低3回という
  現行反復数で90%を要求すると3/3成功が必要になる。1回の揺らぎを許容する判断をする場合は、閾値を下げず
  反復数を10回以上へ増やす。
- 各caseで未認可参照、危険SQL、scan上限超過、意味上の誤り、provider／infrastructure failureが0件である。
- 各caseで結果検証後の描画成功率が100%である。結果一致と描画成否は別指標のまま保持するが、end-to-endの
  合格には両方を要求する。
- capability別の成功件数をpost-run reportへ集計し、必須capabilityに成功runがない場合は不合格にする。
  capabilityは参照fixtureのreviewとpost-run集計だけに使い、runtime manifestへ渡さない。
- 未知の診断code／category、codeとcategoryの不整合、分類不能な例外、欠落した失敗種別は評価bundle契約違反
  としてfail closedにし、品質失敗や成功へ推測変換しない。
- provider／infrastructure failureを含む評価は合格不能とし、予期しないprogramming errorまたはinvariant違反は
  評価全体を無効にする。いずれもモデル品質の分母へ混ぜて結果一致率を計算しない。

### 実装順序

各段階は小さいPRに分け、前段の契約と回帰testを後段が利用します。すべての段階で対象名、既知dataset、
対象別prompt／SQL／設定、利用者による意味定義をruntimeへ追加しません。

| 順序 | 実装 | 主な対象 | 完了条件 |
|---:|---|---|---|
| 1 | SQL診断を型付きcodeへ変更 | 共通SQL validator、`manifest_sql_validation.py`、`manifest_dry_run.py`、`manifest_execution.py` | closed enumのdiagnostic codeとcategory、安全な固定messageを返す。評価側の診断文部分一致を削除し、local validation、dry run、executionを同じ分類契約へ接続する。未知code／categoryと不整合をbundle契約違反として拒否する |
| 2 | case・capability・描画の合格gateを追加 | `evaluate.py`、evidence schema、scorer回帰test | schema別90%に加えcase別90%、case別安全違反0件、case別描画100%、必須capabilityの成功を独立集計する。常に失敗するcaseまたは描画を他caseの成功で隠せないことをtestで固定する |
| 3 | 予期済み失敗と評価無効を分離 | provider adapter、各`manifest_*` stage、run／bundle schema | モデル出力・契約不一致は品質失敗、provider／infrastructureは合格不能な型付き失敗、programming error／invariant違反は評価全体の無効として記録する。広い`except Exception`はprovider adapter境界で安全な型へ正規化する場合だけ許し、stage内部の未知例外を通常失敗へ変換しない |
| 4 | 公式fixtureと実行commandを確定 | review済みfixture、評価計画、実provider command | 異なる未知nested／repeated schema最低2件を別reviewerが承認する。commandは価格snapshot、認可scope、予算上限、model、`as_of`、出力先、実行承認を必須入力とし、不足・不整合を最初のprovider call前に拒否する |
| 5 | 無料回帰後に実反復評価 | fake client suite、実Vertex AI／BigQuery評価 | fake clientで成功・全失敗分類・予算超過・未知診断・出力非上書きを確認する。対象と最大費用を提示して明示承認を得た後だけ、固定binary・prompt・設定で全計画runを実行し、private artifactと集計reportを保存する |
| 6 | 合格後に製品runtime境界をADR化 | 新規ADR、`src/`移植計画 | 実評価が全gateを満たした後だけ、Python worker維持かTypeScript移植か、`AnalysisContract`／manifestのversioned API、認可scope受渡し、永続job、再開・取消・idempotency、artifact互換性、費用承認、監査を決定する。ADR accepted前に製品移植やservice分割を始めない |

順序1〜3を公式fixtureの確定と実行commandより先に完了させます。診断と失敗分類の契約が未確定のまま
実データを集めると、同じrunが実装版によって安全違反、品質失敗、評価無効のどれにもなり得るためです。
順序4以降では、最初のrun前に固定したfixture、計画、pipeline artifact、価格snapshotを最後まで変更しません。

順序1の最初のsliceとして、共通SQL validatorは閉じたcode、category、安全な固定messageを返す
`validate_sql_diagnostic`を持ちます。評価側のlocal SQL validationはcategoryを直接参照し、診断文の
部分一致を行いません。既存の`validate_sql`は画面表示用messageだけを返す薄いadapterです。
BigQuery dry runも閉じたcode／categoryへ正規化し、評価側はprovider診断文を解析しません。既存の
`inspect_bq_dry_run`は表示・SQL修正用messageを返すadapterとして維持します。BigQuery executionも同じ境界へ接続し、
処理bytes欠落、scan上限、取消、timeout、provider失敗を閉じたcode／categoryへ変換します。既存の`execute_bq`は
表示用messageを返すadapterです。recordings version 6とevidence bundle version 5では、attempt間で保持した
型付き診断のcode／categoryだけを`diagnostic`へ保存します。成功runと型付き診断を持たない失敗は`null`です。
ただしSQL境界の失敗で`diagnostic`が`null`の場合、semantic errorが明示されない限りbundleを拒否します。
生のprovider messageは保存せず、未知code／category、stage・安全性flagとの不整合をfail closedで拒否します。

順序3の最初のsliceでは、結果検証と描画の予期済み品質失敗を未知例外から分離します。共通result validatorの
`ResultValidationError`とrendererの明示的な`false`だけを、それぞれ`result_validation_failed`、
`rendering_failed`へ変換します。成功attemptの必須field欠落、policy生成失敗、validatorまたはrendererの
未知例外は通常の失敗runへ変換せず伝播させ、評価処理を停止します。renderer processの起動失敗とtimeoutは
raw detailを除いた`RendererInfrastructureError`へ正規化して伝播させます。raw例外文はrecordingへ保存しません。
順序3の次のsliceでは、local SQL validation、BigQuery dry run、BigQuery executionの型付き診断と明示的な
SQL／schema契約不一致だけを既知失敗として保持します。成功attemptの必須field欠落、policy生成失敗、各共通境界の
未知例外は通常の失敗runへ変換せず伝播させます。続くplanning／SQL生成sliceでは、plannerの明示的な出力拒否、
plan eventと契約の不一致、`SQLGenerationError`、SQL生成の不正応答だけを品質失敗へ変換します。runner例外、
成功状態の必須field欠落、section生成・費用計算・複製処理の不変条件違反は伝播させます。
preflightの分類はIssue #817で実装し、既知の検証拒否だけを品質失敗へ変換します。
provider／infrastructure failureを合格不能として保持する専用run／bundle契約は後続sliceです。

### 明示的な非対象

- `AttemptContext`／`AttemptState`への全面的な状態機械再設計は行わない。identity、費用、failure記録の重複が
  個別変更を妨げる場合に限り、その変更に必要な小さい共通型またはhelperを同じPRで導入する。
- 合格前にPython／TypeScriptの製品境界を固定せず、`spikes/`を製品runtimeとして公開しない。
- 評価case固有の分岐、対象別profile、固定prompt、固定SQL、手動metric定義を追加しない。
- 費用承認前に実Vertex AI／BigQueryを呼び出さず、実結果や認可scopeをrepository、CI log、PRへ保存しない。

## 評価契約強化後の精度改善計画

[Issue #791](https://github.com/Yukihide-Mitsuoka/repchat/issues/791)では、Issue #788の順序1〜3を完了した後、
未知schemaの結果不一致を工程別に測定し、観測した原因に対応する対象非依存の改善だけを実装します。
モデル変更や複数候補生成を先に採用せず、同じ評価セットに対する改善量、安全性、追加費用を比較します。

### 原因を特定する評価

- post-run scorerまたは独立reviewerが、結果不一致を`schema_linking`、`value_linking`、`time_field`、
  `join_path`、`output_grain`、`filter`、`aggregation`、`sql_dialect`、`result_shape`、`indeterminate`の
  closed enumへ分類する。この分類と根拠は参照結果を読める評価側だけに置き、runtime manifestへ渡さない。
- 自動生成contractを使う通常runとは別の診断用bundleで、独立review済みcontractを固定入力にしたablationを行う。
  reviewed contractで解消する不一致はcontract生成以前、解消しない不一致はplanner／SQL生成以降の候補として切り分ける。
  reviewed contract、参照SQL、期待結果は製品runtimeへ渡さず、通常runの合格率にも混ぜない。
- 公式fixtureには、複数時間列、類似ID、surrogate keyとbusiness key、nullable join key、多対多join、
  nested／repeated field、同型のdecoy列を含む対抗caseを置く。各caseはdescriptionまたはbounded value evidenceから
  正答を決定できなければならず、根拠のない命名変更だけで本質的に解けない問題を作らない。
- 同じroot causeが独立した2 case以上で再現するか、1 caseの全反復で再現した場合だけruntime改善へ進む。
  一度だけの失敗、`indeterminate`、provider／infrastructure failureから実装方針を決めない。

### 観測結果から選ぶ改善

| 観測した主因 | 実装候補 | 実装境界と完了条件 |
|---|---|---|
| `join_path`または`output_grain` | 決定論的なJOIN候補graphとpanel単位の論理query plan | 型、NULL率、一意性、名前・descriptionを常時根拠にし、値集合の重複とJOIN増幅率は候補を絞った後だけ予算内で調べる。`selected_tables`、`selected_fields`、`join_path`、`output_grain`、`filters`、`temporal_field`、`aggregations`、`group_by`、`expected_output_schema`をcontract fingerprintへbindしてSQL生成前に検証する。複数根拠が揃わないedgeまたは同点のpathは選ばず失敗へ閉じる |
| `value_linking` | 質問駆動のbounded value lookup | 質問中の値候補からmetadataで列を絞り、認可scope内の非restricted fieldだけをparameterized queryで調べる。field数、match方式、処理bytes、結果件数、文字数を固定上限へ閉じ、質問語とfield tokenの対応だけを契約根拠にする。無関係な生値をprompt、artifact、logへ追加しない |
| `filter`、`aggregation`または結果値の意味違反 | contract由来のsemantic invariant | 宣言済みscaleの値域、grain列の一意性、対象期間、relationship cardinalityに対するJOIN増幅を検査する。funnel単調性など業務意味が必要な規則は、contractがstage順序と母集団を明示した場合だけ適用し、chart種別や列名から推測しない |
| 決定論的な根拠が複数残る低確信case | 条件付き2〜3候補生成 | JOIN path、時間field、同義fieldの競合を機械的に検出したcaseだけを実行前計画へ候補数と総予算ごと固定する。local検証、dry run、参照table、出力schema、JOIN増幅、semantic invariantで比較する。実行結果の多数決または一致だけを正解根拠にせず、同点なら自動選択しない |
| 上記改善後も複数caseで残るSQL生成誤り | model／prompt比較 | 同じcontract、論理query plan、fixture、予算でmodelまたはpromptだけを変えた別bundleを作り、結果一致率と追加token費用を比較する。fine-tuningまたは大型modelは、この比較で生成器自体が支配的な原因と確認した後だけ検討する |

### 段階的推論・オーケストレーション候補

複数のモデル呼出しを使う場合も、自律agent間の自由会話やagentごとのservice分割は採用しません。
RepChatが所有する型付きartifactと決定論的な制御で、役割を限定したモデル呼出しを接続します。
この節の候補はいずれも採用済み設計ではなく、前節のroot-cause開始条件を満たした場合に同じ固定評価セットで
比較するvariantです。

候補graphは次の依存順序にします。schema shortlistが未確定のままvalue lookupを全fieldへ実行せず、
value evidenceを必要とするJOIN判定を先に確定しません。

```text
schema shortlist
      |
      +--> bounded value lookup --+
      |                            |
      +--> join evidence ----------+--> query plan compile
                                           |
                                           +--> primary SQL candidate
                                           |
                                           +--> conditional additional candidate
                                                        |
                                                        v
                               deterministic validation and selection
```

各roleのartifactは、closed enumの判定code、table／field token、evidence ID、入力artifact fingerprint、
使用したmodel／prompt／設定のfingerprint、token usage、実測したNULL率・一意性・値重複率・JOIN増幅率などを
必要な範囲で持ちます。モデルが自己申告するconfidenceと自由文の`evidence`だけを選択根拠にしません。
schema description、サンプル値、先行roleの出力はすべて未信頼入力として検証し、認可scope外のfieldまたは
生値を後続prompt、artifact、logへ伝播させません。

| 候補 | 開始条件 | 比較内容 | 採用しない条件 |
|---|---|---|---|
| schema／value／join roleの分離 | 対応するroot causeが改善開始条件を満たし、単一contract生成呼出しでは工程別の修正を独立評価できない | 同じmodelと予算上限で、単一路線と型付きrole分離を結果一致率、p50／p95時間、token、BigQuery bytes、費用、stage別失敗率、再現性で比較する | 一致率が改善しない、別caseが後退する、または追加費用・失敗点に対する効果がない |
| roleの限定並列実行 | shortlist後のvalue lookupとjoin evidenceなど、入力依存のない外部呼出しが複数ある | 直列variantとのwall-clock時間、総処理量、timeout率、quota failure率を比較する | 依存する処理を推測で並列化する、総費用だけ増える、またはp95時間が改善しない |
| 条件付き追加SQL候補 | 前節の決定論的な曖昧性signalが発生する | 候補数と総予算を実行前に固定し、単一候補variantとの一致率、選択失敗率、追加費用を比較する | 常時生成が必要、候補間の相関した誤りを多数決で正解扱いする、または同点を自動選択する |
| semantic judge | local validation、dry run、出力schema、JOIN増幅、semantic invariantでも複数候補を選べないcaseが複数残る | judgeなしの拒否率と、助言的rankingの正選択率・誤選択率・費用を比較する | contract、安全判定、認可scopeを上書きする、参照情報をruntimeへ渡す、または誤選択を安全に検出できない |

semantic judgeは初期variantに含めません。導入する場合もrankingだけを返し、contract、SQL validator、
認可gate、予算gateを上書きできません。決定論的な選択基準が同点なら、judgeの結論だけで実行せず拒否または
利用者確認へ閉じます。同じmodel、prompt系統、schema evidenceから作る複数候補は独立した投票ではないため、
候補数や多数決を精度の根拠にしません。

オーケストレーションは、まず現在の直接Vertex AI呼出しと明示的な関数で固定graphを実装します。
汎用DAG executorは、独立した2種類以上のworkflowで同じ制御、再試行、再開契約が必要になった場合だけ
別設計として検討します。Google ADKは型付きrole artifactが安定した後の交換可能なrunner variantとし、
[ADKのworkflow機能](https://adk.dev/agents/workflow-agents/)へ製品契約を依存させません。

外部基盤も評価結果または運用要件が開始条件を満たした場合だけ追加します。

- dbtの[`manifest.json`](https://docs.getdbt.com/reference/artifacts/manifest-json)または
  [`catalog.json`](https://docs.getdbt.com/reference/artifacts/catalog-json)は、description、依存関係、列型、
  統計の不足が支配的な原因と確認された場合の任意metadata adapterに限定する。利用できないschemaを
  評価対象外にせず、内容を共通snapshotへ検証付きで変換する。
- Google Cloud Workflowsなどの永続orchestratorは、長時間化、processをまたぐ再開、取消、部分retryが
  実測上必要になった後の製品runtime ADRで検討する。単価だけを採用理由にせず、retryの重複課金、
  idempotency、状態の正本、artifact保全を同時に決める。
- Airflowとroleごとのservice分割は評価harnessへ導入しない。単一processで表現できないscheduler要件または
  独立した運用境界が確認されるまで候補外とする。

role分離を比較する各bundleでは、partial failure後のretryで有料呼出しを重複させないidentity、全roleの
failureを分母へ残す型付き記録、role別fingerprintを必須にします。採用したrole数そのものを改善指標にせず、
固定caseに対する結果一致、安全性、時間、費用、失敗率、再現性だけで判断します。

実装候補はこの表の上から無条件に追加しません。root-cause集計で対応する行の開始条件を満たしたものだけを
小さいPRとして実装し、変更前後を別々の完全なevidence bundleで評価します。各bundle内ではbinary、prompt、設定を
固定し、安全gate、case別合格基準、private artifact境界を弱めません。

### 精度改善の完了条件

- baselineと各variantについて、schema／case別結果一致率、root-cause件数、Vertex token、BigQuery処理bytes、
  費用を同じ形式で比較できる。
- 採用する変更は、開始条件になったroot causeを固定評価セットで減らし、別caseの一致率、安全性、描画成否を
  後退させない。改善しないvariantは採用せず、その結果をIssue #791へ残す。
- 新しい分析対象のためのcode、profile、prompt、SQL、設定、手動metric定義を追加しない。
- 全caseが強化後の合格条件を満たした後だけ、製品runtime境界のADRへ進む。

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
{"version":6,"evaluation_plan_sha256":"0000000000000000000000000000000000000000000000000000000000000000","runs":[]}
```

assemblerのexit code `0`は結合成功、`2`は入力契約違反です。scorerのexit code `0`は合格、`1`は検証可能な
未合格、`2`はbundle契約違反です。scorerは生の期待行・実行行を含めず、集計reportだけを標準出力へ残します。

## 現在の制限

公式の未知schema fixtureと実サービス結果はまだありません。テスト値はscorerの回帰確認用であり、製品能力の
証拠ではありません。評価計画とartifact照合は作成時刻、実行主体の本人性、署名、process-level attestationを証明しません。
独立review済みfixture、実値照合、同一runtimeでの実反復評価は未完了です。有料評価は対象と費用について
オーナー承認を得た後だけ実行します。
