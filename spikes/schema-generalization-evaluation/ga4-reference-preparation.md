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

期間・windowの補助参照案も、同じ選定4tableの`device.category`と`event_timestamp`を使うprivate SQLとして準備しました。
期間はUTCの`[2020-11-01,2020-11-03)`と`[2020-11-03,2020-11-05)`の同じ2日間を比較し、
現在値・比較値・差を別々に照合します。windowは4日×全区分の格子を作り、欠落日・0件の区分を残して
日別件数と当日を含む区分別累積を全行で照合する案です。期間外・NULL時刻は件数へ含めません。
区分は選定した全元記録から取るため、区間内の活動が0件でも残します。NULL区分の表示labelとの衝突は実値監査で拒否します。

人工12記録を独立したPython日時計算と2計算法ずつのSQLiteで検算し、期間各6行・window各24行が一致しました。
期間の条件付き集計と別期間集計の結合、windowの累積関数と時刻上限までの直接件数を照合しました。
期間境界、重複日時、0件区分、符号、相殺する個別件数、区分混在、欠落日、当日の除外、逆順など、
14種類の誤SQLをすべて区別しました。資料・4つの未実行BigQuery SQLは
`/private/tmp/reference-ga4-temporal-offline-U5YK82QM/`に保持し、provider・実AIは各0回です。
この追加4SQLは認証停止した既存5件の有限計画へ混在させません。
実行する場合は別の計画で価格・hash・上界・回数・出力上限を固定し、実値とBigQuery方言を検証します。
正式採用・独立review・field自動発見の証明は未完了です。

順序分析の補助案は、同じ4tableの`user_pseudo_id`・`event_timestamp`を使い、同じ4日のUTC区間へ限定します。
NULL・空主体とNULL時刻を除外し、主体・同時刻を一群にします。異なる時刻群が2件以上ある主体の文字列順で
先頭3件、各先頭4間隔までの前後microseconds・差を全行で照合する案です。
出力には生の主体IDを含めず、選択順位・間隔順位の2区分と3指標の共通table役割を使います。
人工23記録の期待7行へ、Pythonの主体別隣接時刻計算とSQLiteのLAG／直前時刻のMAXの2SQLが一致しました。
12種類の誤SQL、合計が同じ個別間隔の誤答、追加12入力集合の24照合を確認しました。
資料・未実行BigQuery SQL2件は`/private/tmp/reference-ga4-order-offline-u4lyiUvz/`に保持し、provider・実AI各0回です。
この案も既存5件の停止計画へ追加せず、native方言・実値・内容reviewは未完了とします。
主体文字列の一致を実在人物の同一性、日時群の順序を完全event順序とせず、funnelの参照にも数えません。

### 共通出力ルールへの適合確認

期間・window・時刻間隔の旧案は区分順で出力し、[共通tableのSQL生成条件](../report-generation/visualization_sections.py)
「最後の指標降順・LIMIT 100」に一致しませんでした。製品ルールを変更せず、参照案の最終ORDER BYとLIMITだけを改訂しました。
同値時は区分列の昇順とし、集計、母集団、主体選択、期間、累積の計算順序は維持します。
人工入力の37行・155セルを行の並べ替え以外は変えず、2計算法ずつのSQLite全6照合が一致しました。
windowの整数日offsetは、既存のnative案どおりISO日付文字列で描画し、共通rendererの3probeも成功しました。
旧案・旧質問bytesは上書きせず、新案は`/private/tmp/reference-prepared-output-LAau1cJ7/`へ保持しました。

実データで期間区分が100件、windowが25区分×4日を超える場合は、この全行参照案は成立しません。
取得前の有限計画で件数を監査し、LIMITによる切り捨てを全値照合と記録しません。時刻間隔は選択3主体×4間隔の最大12行です。
改訂したnative SQL6件は未実行です。SQL生成条件・人工結果・描画の局所確認を、canonical分析契約、
SQL来歴、field自動発見、正式fixture成立、内容review、実AI品質の証明へ拡張しません。

実値全行の2計算法照合、区別不能条件の確認、全質問・SQL全文・期待行の独立reviewは未完了です。
整数時刻の参照と現在の汎用時間契約の違いは[時刻契約の適合監査](temporal-reference-contract-audit.md)で確認しました。
数値として使えること、shardのscan範囲を満たすこと、イベント時刻の意味を自動生成できることを分けて検証します。
配列内指標の選択制約と深い列参照のSQL誤認は[配列・多階層契約の適合監査](nested-reference-contract-audit.md)で確認しました。
参照の親子粒度・条件付き集計は維持し、契約制約を避けるために親件数だけの評価へ縮小しません。
今回の質問はfieldを明示する計算補助であり、目的からのfield自動発見を証明しません。
[公式sampleの説明](https://developers.google.com/analytics/bigquery/web-ecommerce-demo-dataset)は難読化による内部整合性の限界を明記しています。
[公式順序例](https://developers.google.com/analytics/bigquery/basic-queries)のbatch順序列はこのsampleに存在せず、取得したschemaにもありません。
日時だけを完全event順序とせず、期間・window・順序・funnel・別entity JOINの参照、正式scopeとsnapshot固定も継続します。
公開GA4へ適用する[funnel参照の別案](funnel-reference-preparation.md#公開ga4へ適用する参照案の無料検算)も人工検算まで完了しました。
公開実値の段階成立・検出力・業務上の意味・独立reviewは未確認で、時刻間隔の参照とは別に保持します。
