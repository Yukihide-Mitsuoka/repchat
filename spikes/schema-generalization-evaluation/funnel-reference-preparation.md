---
id: funnel-reference-preparation
title: 順序付きファネル参照の人工検算
status: proposed
updated: 2026-10-07
---

# 順序付きファネル参照の人工検算

要件定義書§9のfunnel不足を補う参照案について、人工入力で段階到達人数の計算と誤答の検出力を確認しました。
公開GA4と`github_nested`へ適用する別案も人工検算まで進みましたが、正式採用・公開実値・独立review・実AI品質は未確認です。時刻間隔の計算や
`ordered_behavior`のlabelをfunnel検証の代替にしません。

## 評価専用の参照案

段階A・B・Cの記録について、同一主体に厳密に増加する時刻の組合せが存在する場合だけ、各prefixの到達として数えます。
各段階の人数は主体ごとに最大1人です。段階間に別の記録があっても許容し、連続した3記録を要求しません。
同時刻から順序を推測せず、最初のBがAより前でも、後続に有効なBがあれば到達できます。

- 全段階の記録を同じ半開区間`[0,100)`へ限定する。
- NULL・空文字の主体、NULL時刻を除外する。空白だけの主体はそのまま有効とし、trimやID補正をしない。
- 同じ主体・段階・時刻の重複は人数を増やさない。別主体の記録を組み合わせない。
- 出力は共通funnel役割`stage`・`metric_value`の3行で、A・B・Cの順序を固定する。
  入力が空でも3段階の0人を返す。

これは人工参照の提案であり、特定の業務funnel定義、製品の固定SQLやID補正、利用開始に必要な手動設定ではありません。
実データへ適用するときは主体・段階・時間・観測範囲の根拠を別途確かめ、参照知識を製品runtimeへ渡しません。

## 2026-10-07の無料検算結果

privateな人工64記録には、正常順序、逆順、後から成立する順序、同時刻、重複、段階間の別記録、
段階欠落、NULL、区間内外の境界、誤選択用の別fieldを含めました。
手で固定した期待人数`15 → 11 → 7`へ、Pythonの全組合せ検算とSQLiteの2計算法が全行・列・順序で一致しました。
SQLは「各段階の最早有効時刻を順に求める方式」と「有効な段階の組合せから主体をdistinctで数える方式」です。

| 検査 | 実測結果 | 確認範囲 |
|---|---|---|
| 誤ったSQL | 13種類すべてが期待結果と不一致 | 同時刻許容、逆順、期間無視、NULL主体混入、trim、両端境界、別主体混在、組合せ件数、別field、出力逆順、順序なしの存在判定、各段階の独立した初回時刻 |
| 追加の境界入力 | 27集合、2SQLで54照合が一致 | 空、1記録、Aなし、各主体単独、5つの固定seedによる入力順序変更 |
| 限定した全列挙 | 1,885列、2SQLで3,770照合が一致 | 段階A・B・C・その他、時刻0・1・2、長さ0〜3の全列。到達人数の非増加も確認 |
| provider・実AI | 各0回 | 認証・query・資源・IAM・scope変更なし。分析料金の発生なし |

全列挙はこの有限入力集合だけの確認です。統計的なAI一致率、長い活動列、全てのfunnel方式、
BigQuery方言、公開データの正しさや実主体の同一性を証明しません。
13誤答や1,885列を独立したAI評価case数・run数・schema数へ加算しません。

検算script、2SQL、全人工入力、期待行、各誤答の実際の結果、SHA-256、完了記録は
`/private/tmp/reference-funnel-offline-URa21PXL/`に保持しています。
出力artifactは新規`0600`で作成し、repository・標準出力へ生の公開データや主体IDを出していません。
再開時は既存完了記録を確認し、上書きや同じ操作の自動再実行をしません。
同じ固定人工入力を使うBigQuery SQLも、正しい2計算法と誤った2計算法の計4件をprivate領域へ準備しました。
typed inline入力だけを使用する未実行の案です。認証・request・価格bindingはまだ行わず、native照合完了とは扱いません。

### 共通funnel出力ルールへの適合確認

旧参照の段階名A・B・Cは、[共通SQL生成条件](../report-generation/visualization_sections.py)の番号接頭辞を満たしていませんでした。
段階名を`1 A`・`2 B`・`3 C`に改め、最終出力をstage昇順・LIMIT 12・人数のCOALESCE付きにした別案を準備しました。
母集団・段階到達の計算は変更せず、元の3行・6セルを逆変換で完全に復元できることを確認しました。
改訂した2つのSQLite SQLは期待人数15・11・7へ一致し、共通rendererの1probeも成功しました。
検算・新SQL・旧SQL hash・新出力の記録は`/private/tmp/reference-prepared-output-LAau1cJ7/`に保持します。
旧資料は上書きせず、改訂native SQL2件は未実行です。番号付き表示や描画成功は、
段階の意味、公開schemaの参照、canonical分析契約、独立内容review、実AI品質の証明ではありません。

## 公開GA4へ適用する参照案の無料検算

[取得済みmetadata](ga4-reference-preparation.md#metadataと参照案の確認)の4tableには、STRINGの主体候補・種類とINTEGERの時刻が存在します。
[公式schema説明](https://support.google.com/analytics/answer/7029846?hl=en)は時刻をUTCのmicrosecondsによる受信時刻と説明します。
端末での発生順序や同時刻内の順序、主体文字列と実在人物の同一性は証明しません。外部説明は参照側の根拠で、製品runtimeへ専用知識を追加しません。

参照質問の別案は選定済み4tableのUTC`[2020-11-01,2020-11-05)`へ限定し、NULL・空の主体と種類、NULL時刻を除外します。
この有効母集団に存在する種類を文字列昇順で3種類選び、その順に同一主体の厳密な時刻増加によるprefix到達を数えます。
業務上の閲覧・購入等の段階は決め打ちせず、任意の観測値に対する計算検証案とします。業務funnelの意味や目的からの自動発見を証明する案ではありません。
重複、空白、段階間の別記録は人工案と同じ規則を保ち、出力は番号付き`stage`と`metric_value`、stage昇順・最大3行です。

人工71記録の期待人数15・11・7へ、Pythonの全組合せとSQLiteの最早有効時刻／組合せ計算が一致しました。
母集団外の種類による段階選択の汚染、逆順、同時刻許容、境界、trim、別主体混在、組合せ数の過大集計、別field、出力逆順等の12誤SQLを区別しました。
追加1,918入力集合の2SQL・3,836照合も一致しました。この有限集合・人工件数を独立schema数や実AI反復数へ加算しません。

元metadata・旧人工fixture・旧停止計画のhash、質問、2つの未実行BigQuery SQL、全人工入力・誤答結果は
`/private/tmp/reference-public-funnel-TyR5Qyt9/`の新規private artifactへ保持します。既存資料は上書きしていません。
その後の[GoogleSQL予約語確認](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/lexical#reserved_keywords)で、
新案のprimary SQLに未引用のalias `at`があると判明しました。SQLite成功をnative実行可能性の証拠にせず、元SQLは実行候補から除外します。
新しい`/private/tmp/reference-public-funnel-revised-YKD2QIuH/`へaliasだけを`first_time`へ変更した別案を保存し、
人工71記録の期待各行と追加1,918集合・3,836照合の一致を再確認しました。alternate SQLは不変で、元資料・hashを保持します。
予約語違反は公式仕様による静的確認であり、実BigQueryのエラー応答ではありません。修正版を使う場合もnative解析・実値・reviewを別途確認します。
BigQuery方言・公開実値・内容reviewは未確認で、provider・実AI呼出しは0回です。
3種類未満、0人のprefix、人数が減らず誤答を区別しにくい場合は、参照成立・検出力の不足として停止します。黙って種類や母集団を変更しません。
実取得には別の有限計画・価格・SQL hash・費用上界を固定し、認証停止した5件へ混在させません。
現在の[時間契約の不足](temporal-reference-contract-audit.md)も残っており、参照SQLを作れたことを汎用AI対応の証明にしません。

## 公開GitHubへ適用する参照案の無料検算

取得済みの全metadataと日時coverageを既存実行計画のhashへ照合し、top-levelの`actor`・`type`・`created_at`が
NULLABLEのSTRINGであることを確認しました。同名のnested fieldとは分けます。観測範囲は確認済み最古UTC日の開始から4暦日の半開区間です。
主体文字列・種類・日時の指定は評価専用の参照質問であり、canonical discoveryや製品の専用設定ではありません。

段階選択とprefix計算は公開GA4案と同じ規則を使います。参照SQLだけで既存の確認済み日時書式を変換し、
変換不能な日時を除外します。人工71記録の数値時刻を3種類のUTC offset付き文字列へ変換し、不正日時1記録を追加しました。
数値時刻のPython全組合せ検算と、文字列を変換する2つのSQLite SQLが期待人数15・11・7へ一致しました。
同時刻許容、逆順、別主体field、別種類field、出力逆順、組合せ過大集計、timezone offset無視の7誤答を区別しました。
追加1,918入力集合・3,836照合も一致しました。既存人工入力と同じ計算を再利用しており、独立したschema評価・AI反復の件数にはしません。

質問・元資料のhash・2つの未実行BigQuery SQL・全人工入力・誤答結果・完了記録は
`/private/tmp/reference-nested-funnel-tFn0HXrp/`の新規`0600` artifactへ保持します。元資料は上書きしていません。
ローカルの日時変換はBigQueryの解析成功を証明せず、公開の種類値・到達人数・業務funnelの意味・内容reviewも未確認です。
provider・実AI呼出しは0回で、製品parser・runtime・正式scopeは変更していません。
種類不足・検出力不足の停止条件と、別の有限計画・価格・SQL hash・費用上界を固定する条件は公開GA4案と同じです。
認証停止した既存5件へ追加せず、参照作成の成功を対象非依存の自動分析の証明にしません。

## 次の確認と停止点

1. 現在の未回答の個別内容reviewを先に完了する。今回の案を承認済みとは記録しない。
2. この人工参照の意味と期待各行を1件としてreviewする。BigQuery方言の検算は別の有限計画で進め、
   費用権限や計算成功を内容reviewの回答として記録しない。
3. 公開schemaに存在する主体・段階・時刻の根拠、同時刻の不確実性、観測範囲を確認して参照を準備する。
   人工計算の成功を公開schemaへの適用証明にせず、同時刻の完全順序を架空のtie-breakで補わない。
4. 全schemaの網羅、独立review、正式scope・canonical snapshot・fixture固定を揃えてから実AI反復へ進む。
   製品・評価runtime、scorer・閾値・安全gateは今回変更していません。
