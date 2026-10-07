---
id: ga4-reference-preparation
title: 公開GA4の正解データ準備と未完条件
status: active
updated: 2026-10-07
---

# 公開GA4の正解データ準備と未完条件

GA4側の参照準備はmetadata確認と人工入力での局所検算まで完了し、実値queryは認証取得で停止しました。
この文書は再開に必要な証拠と未完条件を記録します。旧専用経路の期待値を流用せず、製品・評価runtimeは変更しません。
全体の完了条件は[充足性監査](schema-coverage-gap-plan.md#2026-10-07の正解データ充足性監査)を正本とします。

## metadataと参照案の確認

選定済み公開datasetの所在取得1回、catalog取得1回、schema取得4回が成功しました。
catalogは92件・追加pageなしで、全件が同一の日次table系列でした。先頭の連続4日分はnative TABLE・US・
同一schemaで、top-level 23列・全108field path・REPEATED 3path・policy tag付きfield 0件でした。
この取得は行・SQL・AIを含まず、metadata hashを共通discoveryのcanonical snapshotとは扱いません。
日次tableを複数発見しただけで、独立entity間のJOINや同じ主体の意味上の対応を証明しません。

配列内の数量条件付き集計と、深い文字列fieldの非NULL・非空文字集計の質問2件・SQL各2件をprivate領域へ固定しました。
各ケースは区分別に親記録数を保ち、空配列・欠落・同値の別要素を明示的に扱います。
親行ごとの相関集計と、親・子を別々に集計して結合する計算で全列・行順序を照合する案です。
出力は共通役割の区分1列・整数指標4列で、SQL・期待知識をruntimeへ渡しません。

## 無料検算と実値取得の停止

人工7親記録・配列9要素・parameter 8要素で、PythonとSQLiteへ置換した4計算が各5行の全列・順序へ一致しました。
意図的な誤答8通りと行順序誤り2通りを区別しました。独立schema数・AI反復数には数えません。
初回のSQLite入力adapterはNULL配列をJSON scalar nullへ変換して1要素を余計に数えました。
SQL NULLへ修正して再検算し、元の期待値とBigQuery SQL bytesは変更していません。失敗記録も保持しました。
これは方言置換した局所検算であり、native BigQueryや実GA4値の照合ではありません。

有限計画は確認集計1件＋2ケース各2計算の計5query、各512 MiB、最大出力は確認1行・ケース各20行です。
2026-10-07確認の[US Analysis単価](https://cloud.google.com/skus?currency=JPY&filter=1DF5-1F98-1DD1)は982.468749971 JPY/TiBで、
各分析料金上界0.479722 JPY・計2.398610 JPY・batch予算3 JPYです。[直接費用権限](reference-coverage-plan.md#現在の実行権限と費用境界)内ですが、実usageは未取得です。
送信前のoffline検査はschema・table scope・上限・usage・粒度・順序の不正13通りを拒否しました。
認証取得で停止したため、この実値計画の予約検索・dry run・本実行・結果取得は各0回です。費用の実測値を捏造しません。
再認証の直接連絡後、新しい操作記録で未送信5件だけを再開し、価格適用日・SQL hash・上界を再照合します。
自動retry、正式scope・IAM・資源・期限変更、AI呼出しは行いません。

## 残る評価条件

実値全行の2計算法照合、区別不能条件の確認、2質問・SQL全文・期待行の独立reviewは未完了です。
今回の質問はfieldを明示する計算補助であり、目的からのfield自動発見を証明しません。
[公式sampleの説明](https://developers.google.com/analytics/bigquery/web-ecommerce-demo-dataset)は難読化による内部整合性の限界を明記しています。
[公式順序例](https://developers.google.com/analytics/bigquery/basic-queries)のbatch順序列はこのsampleに存在せず、取得したschemaにもありません。
日時だけを完全event順序とせず、期間・window・順序・funnel・別entity JOINの参照、正式scopeとsnapshot固定も継続します。
