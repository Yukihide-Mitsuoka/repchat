---
id: schema-inspection
title: BigQuery schema取得境界
updated: 2026-09-13
---

# BigQuery schema取得境界

[ADR-0025](../adr/0025-discover-analysis-contracts-without-source-specific-code.md)へ置き換えられた
[ADR-0024](../adr/0024-build-analysis-context-from-inspected-schema.md)の初期実装は
`spikes/report-generation/bigquery_schema_snapshot.py`です。生成経路にはまだ接続していません。
本番認可や接続主体を置き換える処理ではありません。

## 入出力と責任

`inspect_schema(bq, table_ids, allowed_tables=...)`へ、呼出し側が認可済みクライアントと
完全修飾テーブル集合を渡します。`allowed_tables`を利用者の文章・AI出力から構築してはいけません。
readerは選択集合が許可集合の部分集合であることを取得前に確認し、`get_table`だけを呼びます。
dataset列挙、行query、サンプリング、IAM変更は行いません。

返す`SchemaSnapshot`は不変JSON、SHA-256 fingerprint、UTC取得時刻を持ちます。
`metadata()`は独立したコピーを返します。field pathはネストしたfields配列から復元でき、
同名の子列を別の親列と混同しません。説明は未信頼のデータであり、命令ではありません。
partition情報はAPI表現を保持するだけで、業務上の時刻列・粒度・join条件を推定しません。

fingerprintはテーブル順を正規化したJSONから作り、取得時刻を除外します。
同じfingerprintは同じ取得メタデータを表し、行データの不変性を保証しません。

## 制限と失敗

最大20テーブル、合計2,000 fields、ネスト深さ16、UTF-8 JSON 200,000 bytesです。
各API呼出しはtimeout 30秒、retryなしです。上限超過は切捨てず`SchemaInspectionError`にします。
物理テーブル以外、location混在、返却tableの不一致、欠落・未対応型も拒否します。
取得失敗は機密を含み得るprovider本文を表示せず、安定したエラーへ変換します。
手書きschemaや別datasetへのfallbackはありません。

`inspect_date_shards(...)`は、サーバー側で許可した完全修飾`YYYYMMDD`末尾wildcardだけを扱います。
対象datasetを最大1,000表まで列挙し、wildcardに一致する最大100日分の物理テーブルをすべて`get_table`で
検査します。対象期間は日ごとの欠損を許さず、期間外も含むwildcard一致表に非日付名、view、schema、
partition、clustering、resource tagの相違があれば停止します。CMEKで暗号化されたwildcard表も拒否します。

一致したschemaは1表分へ正規化し、wildcard名と対象期間の実テーブル一覧を`dateShards`へ保持します。
したがって同じschemaを日数分複製せず、fingerprintは実際に選択した日次表集合を含みます。
この処理も行queryを行わず、列挙・metadata取得のprovider失敗内容を外へ出しません。

`discover_scope(...)`は日次suffixを持つ物理表を候補として記録しますが、候補ごとの行queryは行いません。
runtimeで決定した期間を`consolidate_date_shards(...)`へ渡すと、その期間が発見済みscope内に完全に収まることを
API呼出し前に検査し、`inspect_date_shards(...)`を通過した非partitioned集合だけをwildcardへ置換します。
値profileは置換後のwildcardに対して一度だけ取得し、`_TABLE_SUFFIX`の閉区間、dry run、参照表、bytes、row、
field上限を通常表と同じpolicyで検査します。未発見日、schema drift、非日付一致、partition併用はfail closedです。

`analysis_contract_orchestration.py`は日次shard候補がある場合だけ、完全契約の生成前に1回の構造化生成を
追加します。質問と発見済みcatalogからopaqueなshard group token、対象期間、任意の比較期間だけを選ばせ、
決定論的な検査で両期間を包含するscan範囲へ変換して`consolidate_date_shards(...)`へ渡します。統合後の
catalogから完全契約を生成するときは同じ期間をresponse schemaとnormalizerの両方で固定し、生成結果が
期間を変更した場合は拒否します。shard候補がなければ事前生成を行わず、従来どおり完全契約を1回だけ生成します。
対象名、日付文字列、table名を解釈するparserや対象別設定は使いません。

## 共通分析契約

`analysis_contract.py`はsnapshotと自動生成した意味候補・期間条件・実行上限を検証し、計画とSQL生成が
共有する不変JSONへcompileします。業務時刻は実在する非repeatedのDATE／DATETIME／TIMESTAMP列、検査済み
date shardの`_TABLE_SUFFIX`、またはingestion-time partitionの`_PARTITIONDATE`／`_PARTITIONTIME`を
参照します。適用可能な期間はIANA timezone、`YYYY-MM-DD`の閉区間、任意の比較期間を別フィールドで保持します。
選択schemaにこれらの時間境界がない場合だけ`period`を`null`とし、生成・SQL文脈が期間を補いません。
各time partitioned tableの絞り込み列を明示し、必須tableの欠落、API metadataとの不一致、重複を拒否します。
ingestion-time partitionでは`_PARTITIONDATE`または`_PARTITIONTIME`を明示します。
`dateShards`を持つtableは`_TABLE_SUFFIX`を必須制約とし、snapshotの開始・終了日が対象期間と比較期間を
包含する最小のscan範囲に一致する場合だけcompileします。日次memberの欠落・並び替え・追加metadataを拒否し、
timeまたはrange partitionを併用するshardは両方のfilterを表現できる契約を追加するまで受理しません。

意味候補はgrain、metrics、dimensions、relationshipsを区別します。定義式と任意のunit・aliases等を保持し、
同じ名前・aliasの重複を拒否します。relationshipは両table、結合条件、多重度を明示し、snapshot外を参照できません。
費用上限と結果行数上限は呼出し側が正の整数で指定し、compilerは既定値を補いません。

この意味候補は、認可済みscopeのmetadataとbounded value profileから対象非依存の共通pipelineが実行時に生成します。
分析対象ごとの設定、手動登録、固定prompt・SQLを入力にしてはなりません。

契約fingerprintはschema、意味候補、期間、実行上限から作り、metadata取得時刻を除外します。
取得時刻は契約JSONへ監査情報として残るため、再取得時刻だけが異なる同一契約を同じidentityとして比較できます。
同じfingerprintは行データの不変性を保証しません。

`analysis_contract_context.py`は同じcanonical contract JSONをplannerとSQL担当へ渡します。前者には
分析候補を含めず、後者にはBigQuery、参照範囲、期間、自動生成された意味候補の共通制約だけを付与します。
確定仕様のrevisionへcontract fingerprintを含め、build時に現在契約との一致を要求できます。

`DataSourceProfile.with_contract(...)`は既存profileを変更せず、検証済みcontractを束縛したsourceを返します。
contract内の全tableがprofileの許可datasetと完全一致しない場合は束縛しません。束縛後は既存の
`analysis_workflows.plan_dashboard`と`section_execution.run_section`が、手書きschema文字列ではなく
同じcanonical contractをplannerとSQL担当へ渡します。

`analysis_contract_context.execution_policy(...)`はcanonical contractから、SQLで参照できる完全修飾table、
date shardをdry runで照合する物理table、query bytes上限、結果行上限を導出します。契約付きsourceの
`section_execution.run_section`は描画仕様の有無にかかわらずBigQuery dry runを必須とし、SQL本文と
dry-run job metadataの両方をexact table scopeへ照合した後だけ、同じbytes上限で実行します。
同一dataset内でも契約にないtableは許可しません。legacy profileの固定上限は契約付き経路へ混入しません。

`analysis_schema_policy.py`は同じcontract metadataから各tableの完全field path、標準型、mode、親から継承した
repeated・policy tag状態を決定論的に導出します。date shardとingestion-time partitionの疑似fieldも同じ
policyへ含めます。不正型、case-insensitiveな同名field、重複path、空のstructured fieldはfail closedです。
期間SQL検査は各期間fieldの完全path・型がこのpolicyと一致し、repeated・policy tag継承下でないことも要求します。

`contract_sql_validation.py`は契約付きSQLのphysical table aliasをquery scopeごとに解決し、aliasから参照した
完全nested pathをfield policyへ照合します。restricted field、UNNESTせず参照したrepeated親配下のscalar、
scalar fieldへのUNNESTを拒否します。schema fieldを指す単純なUNNEST operandは、そのfield自身のmodeが
REPEATEDであり、各階層のaliasが一意な場合だけ受理します。parenthesisとUNION分岐のalias scopeは分離します。
計算式で作る配列とCTE出力のlineageはこの検査で推測せず、BigQuery dry runの型検査を維持します。
`bigquery_execution.validate_sql(...)`は契約付きdry run・実行の前にこの検査を必須とします。

実行policyはcanonical contractの`period`から、業務時刻と各partitionのtable・field path・標準型、
比較期間を含むscan開始日・終了日、timezoneも導出します。`period=null`は選択schemaに利用可能な
時間field・partition・date shardがない場合だけ許可し、対象別の期間parserやcallbackをpolicyへ含めません。
`contract_period_validation.py`はこのpolicyだけを使い、単一参照tableの実際の`WHERE`句に全制約の型別scan範囲があるか検査します。複数tableはidentifier scopeとの安全な関連付けが未実装のためfail closedです。
SELECT式、コメント、無関係な文字列は制約を満たさず、契約付き実行は旧profileの期間検査・修正callbackを呼びません。

## 次の接続点

[ADR-0025](../adr/0025-discover-analysis-contracts-without-source-specific-code.md)に従い、次は結果形状の検査を
canonical contractから導出します。その後、planner・SQL生成の
legacy profile入力を除去します。対象固有のfactory、profile、metrics fileは追加しません。
生成経路への供給とbuild時のschema再検証も同じ共通契約へ接続します。

現在のテストはfake BigQuery clientを用いた取得境界の検証で、実API・分析品質の実証ではありません。
