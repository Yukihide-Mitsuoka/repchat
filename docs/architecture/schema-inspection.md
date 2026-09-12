---
id: schema-inspection
title: BigQuery schema取得境界
updated: 2026-09-12
---

# BigQuery schema取得境界

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

## 共通分析契約

`analysis_contract.py`はsnapshotと明示した意味定義・期間条件・実行上限を検証し、計画とSQL生成が
共有する不変JSONへcompileします。業務時刻は実在するDATE／DATETIME／TIMESTAMP列、または検査済み
date shardの`_TABLE_SUFFIX`を参照し、IANA timezone、対象期間、任意の比較期間を別フィールドで保持します。
期間は`YYYY-MM-DD`の閉区間です。
各time partitioned tableの絞り込み列を明示し、必須tableの欠落、API metadataとの不一致、重複を拒否します。
ingestion-time partitionでは`_PARTITIONDATE`または`_PARTITIONTIME`を明示します。
`dateShards`を持つtableは`_TABLE_SUFFIX`を必須制約とし、snapshotの開始・終了日が対象期間と比較期間を
包含する最小のscan範囲に一致する場合だけcompileします。日次memberの欠落・並び替え・追加metadataを拒否し、
timeまたはrange partitionを併用するshardは両方のfilterを表現できる契約を追加するまで受理しません。

意味定義はgrain、metrics、dimensions、relationshipsを区別します。定義式と任意のunit・aliases等を保持し、
同じ名前・aliasの重複を拒否します。relationshipは両table、結合条件、多重度を明示し、snapshot外を参照できません。
費用上限と結果行数上限は呼出し側が正の整数で指定し、compilerは既定値を補いません。

契約fingerprintはschema、意味定義、期間、実行上限から作り、metadata取得時刻を除外します。
取得時刻は契約JSONへ監査情報として残るため、再取得時刻だけが異なる同一契約を同じidentityとして比較できます。
同じfingerprintは行データの不変性を保証しません。

`analysis_contract_context.py`は同じcanonical contract JSONをplannerとSQL担当へ渡します。前者には
分析候補を含めず、後者にはBigQuery、参照範囲、期間、意味定義の共通制約だけを付与します。
確定仕様のrevisionへcontract fingerprintを含め、build時に現在契約との一致を要求できます。

`DataSourceProfile.with_contract(...)`は既存profileを変更せず、検証済みcontractを束縛したsourceを返します。
contract内の全tableがprofileの許可datasetと完全一致しない場合は束縛しません。束縛後は既存の
`analysis_workflows.plan_dashboard`と`section_execution.run_section`が、手書きschema文字列ではなく
同じcanonical contractをplannerとSQL担当へ渡します。

## 次の接続点

[ADR-0025](../adr/0025-discover-analysis-contracts-without-source-specific-code.md)に従い、次は認可済みscopeから
table、schema、値profileを共通処理で取得して分析契約を自動生成します。対象固有のfactory、profile、
metrics fileは追加しません。生成経路への供給とbuild時のschema再検証も同じ共通契約へ接続します。

現在のテストはfake BigQuery clientを用いた取得境界の検証で、実API・分析品質の実証ではありません。
