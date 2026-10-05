---
id: public-join-candidate-review
title: 公開schemaのJOIN候補調査と最初の確認案
status: proposed
updated: 2026-10-05
---

# 公開schemaのJOIN候補調査と最初の確認案

公開資料だけでは、選定済み2schemaの別物理table間JOINの参照を確定できません。
最初の提案は`github_timeline`のmetadataだけを1回確認し、関連するfieldがあるか調べることです。
これは未承認の取得案であり、正式評価scopeへの追加やJOIN成立の判断ではありません。
[schema別不足計画](schema-coverage-gap-plan.md)の順序1の調査結果と、順序2で提示する最小確認案を記録します。

## 公開資料から確認した候補と限界

以下は2026-10-05に確認した一次資料に基づきます。現在の実tableのschema・値・対応件数は取得していません。

| 対象・候補 | 公開資料の事実 | 未確認条件と判断 |
|---|---|---|
| `bigquery-public-data.samples.github_nested`と`bigquery-public-data.samples.github_timeline` | [公式サンプル一覧](https://docs.cloud.google.com/bigquery/public-data#sample_tables)は前者をnested、後者をflatなGitHub活動履歴として掲載。作成時期はそれぞれ2012年9月・5月 | 同一eventの別表現、共有key、収録期間の重なり、一意性、対応件数は未確認。作成月を収録期間と同一視しない。まず後者のmetadata確認を提案 |
| 公開GA4の`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*` | [公式dataset説明](https://developers.google.com/analytics/bigquery/web-ecommerce-demo-dataset)は2020-11-01〜2021-01-31の難読化サンプルを説明。[基本query資料](https://developers.google.com/analytics/bigquery/basic-queries)は日別tableを説明 | 別日tableは同じevent系列であり、独立したentity tableとは限らない。共通runtimeの日次shard統合を迂回してJOIN網羅へ数えない。実際の別entity tableと関係は未確認 |
| GA4とGoogle Ads転送table | [公式JOIN説明](https://developers.google.com/analytics/bigquery/basic-queries#joining_with_google_ads)は転送を設定し、クリック識別子で関連付ける方法を示す | 選定した公開サンプルに対応する公開Ads tableの根拠ではない。顧客広告接続・転送設定・IAM追加は提案せず、この案を現在の評価に採用しない |
| `bigquery-public-data.github_repos.sample_repos`と`bigquery-public-data.github_repos.sample_files` | [公式query insights](https://docs.cloud.google.com/bigquery/docs/query-insights#partition_skew)に`repo_name`でのJOIN例と、前者のkeyが一意と期待され後者で反復する説明がある | この2table内の関係例であり、`github_nested`との対応の証拠ではない。選定対象の置換や追加scopeを承認済みとしない。全6能力の成立も未確認 |

GA4の難読化サンプルは内部整合性が制限される場合があり、Demo Accountとは別データです。
これは[公式dataset説明の制限](https://developers.google.com/analytics/bigquery/web-ecommerce-demo-dataset#limitations)に基づきます。
別データの同名ユーザー・商品・取引IDを同一entityと推測して結合しません。
今回読んだ資料で結合相手を確定できなかったという結果であり、公開データ全体に存在しないという証明ではありません。

## 最初に提示する確認案：GitHub候補のmetadataだけ

`github_timeline`は元のtableと同じ公開サンプル一覧にある候補なので、まずschemaから関連候補を絞ります。
実scopeへの追加、参照SQL、期待行の確定は、関連根拠と値の確認後に別判断とします。

| 項目 | 提案する範囲 |
|---|---|
| 対象 | `bigquery-public-data.samples.github_timeline`の1tableだけ |
| 操作 | [公式`tables.get`](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/tables/get)の`view=BASIC`を1回。既存認証を使用し、再認証が必要なら停止 |
| 取得・確認 | table identity、schemaの列・型・mode・description、table種別・location。行数・bytes統計や行データは要求しない |
| 上限 | API 1回、再試行・redirectなし。query job・結果行・Vertex呼出し0件。分析query料金の発生する操作はしない |
| 保存 | repository外の新規`0700` directory内に`0600`で保存し、既存fileを上書きしない。応答やdescriptionをlogへ複製しない |
| 非対象 | dataset列挙、既存tableの再取得、query・dry run・profile・実AI、配置、IAM変更、期限延長、正式manifestへのscope追加 |
| 停止条件 | owner承認前は実行しない。取得失敗・identity不一致・必要metadata欠落なら再送せず停止。metadataだけでJOIN成立としない |

取得後は既存`github_nested`のschema記録と比較し、型・descriptionで説明できるkey候補と、
欠落・重複・実値重なり・期間・粒度の未確認条件を提示します。似た列名だけでedgeを確定しません。
値照合が必要なら、取得する集計・回数・行上限・課金bytes・価格・最大JPYを別に提示し、承認前に実行しません。

## 参照caseを確定する条件と残作業

GitHubのcase案は、両tableに根拠のある共有entityがある場合にだけ、entity別の左右記録数と対応の有無を
各行で照合するものとします。実field・期間・出力列・期待値は未確定です。
keyの欠落を対応させず、各側を明示した粒度で数え、多対多で元の件数を増幅させない条件をreviewします。
値の対応がない場合は無関係なJOINを作らず、候補を不採用として追加案の判断へ戻ります。

GA4側の別entity tableは未確定です。GitHub側の確認や人工JOINの承認でこの不足は解消しません。
補助ケースの重複登録、別日のevent表だけで独立した関係発見を実証する表現、runtime専用知識の追加は行いません。
対象変更・関連tableの配置が必要なら、新たな案としてownerへ提示し、現在の2schemaを黙って置換しません。

今回は公開資料の閲覧とローカル文書更新だけで、認証付きAPI・query・AI・scope変更・クラウド操作は0件です。
正式fixture、意味的網羅、独立review、実AI品質は未完了です。既存人工tableの保持期限も変更していません。
