---
id: public-join-reference-case-plan
title: 公開2tableの主体文字列別JOIN参照ケース案
status: proposed
updated: 2026-10-06
---

# 公開2tableの主体文字列別JOIN参照ケース案

左右の記録を主体候補の文字列ごとに先に集約し、共通・左だけ・右だけを各2件、最大6行で照合する参照準備案です。
対象は`bigquery-public-data.samples.github_nested`（左）と`bigquery-public-data.samples.github_timeline`（右）です。
[主体候補の全table集計](public-join-candidate-review.md#2026-10-06の認証更新後の主体候補集計結果)は値の重なりを確認しましたが、
同じ実主体であることを証明していません。本案も実主体・同一活動・同一期間を仮定せず、文字列単位の記録件数を比較します。
正式scope・fixture採用・独立review・追加取得・実AI評価の承認ではありません。

## 質問案と出力契約

参照内容のreview用質問案は次のとおりです。runtimeへ登録済みの質問や対象別promptではありません。

> 2つの活動tableの主体候補文字列について、共通・左だけ・右だけに分け、各区分で文字列順の先頭2件の左右記録件数を比較してください。
> NULLと空文字は除外し、大小文字・空白は変えません。片側に記録がない場合は0件とします。
> 主体の生文字列は出力せず、区分・区分内順位・左右記録件数を示してください。

参照SQLでは取得済み標準schemaの`actor` STRINGを使います。この対応は参照作成側だけに保持し、
製品・評価runtimeへ専用field選択、固定SQL、手動contractを追加しません。
正式質問の意味的明瞭さと、同じ認可scopeから共通runtimeが主体候補を選べるかは未検証です。

| 条件 | 参照案 |
|---|---|
| 入力・粒度 | 各tableの非欠落`actor`文字列ごとに活動行を`COUNT(*)`。同じ文字列の複数活動を1件へ減らさない |
| 結合 | 左右で集約後、補正しない文字列の完全一致でFULL OUTER JOIN。活動行同士を直接結合しない |
| 欠落 | NULL・空文字を各側で結合前に除外。空白だけの文字列は残し、NULL同士を対応させない |
| 区分 | 両側に存在する`shared`、左だけの`left_only`、右だけの`right_only`。欠落側の記録件数は整数0 |
| 行選択 | 区分ごとに主体文字列の昇順で一意な順位を付け、1・2位だけを選ぶ。共通、左だけ、右だけの順に並べ、各区分内は順位順 |
| 出力 | `match_class` STRING、`subject_rank` INTEGER、`left_record_count` INTEGER、`right_record_count` INTEGERの4列・最大6行。生IDなし |
| 不足時 | 2件に満たない区分は存在する行だけ。空の区分や両側空から架空行を補わない |

既存全table集計では3区分すべてに2種類以上の文字列が存在しましたが、本案の実値は未取得です。
6行は決定論的な先頭選択であり、無作為標本・母集団の代表・AI品質の統計的証明ではありません。
主体値を返さないため、同じ件数になる誤った主体選択を出力だけで区別できない場合があります。
人工例の検出力を実データでも保証せず、独立reviewではSQLのfield・結合・選択条件も確認します。
順位付けを使うことだけで独立したwindow分析ケースへ重複計上しません。

## 参照準備とoffline検算

2026-10-06に参照SQLをrepository外の新規`0700` directory内の`0600` fileへ準備しました。
SQL bytesのSHA-256は`ae158f85ecca7f0a6fbb7e67e0d86afd1413d3f7650835bdcba2e3b0f4eac5d7`です。
実table IDだけをローカルtable名へ置換したSQLiteと、別手法のPython Counter・集合計算で期待各行を照合しました。
人工入力は左右20・23行で、大小文字違い・空白・NULL・空文字・同一文字列の重複と、各区分の3番目の除外を含みます。

主人工例・欠落だけ・共通だけ・左右の不一致・左空の5入力条件で両手法が一致しました。
INNER JOIN、LEFT JOIN、distinctの誤集計、大小文字補正、空白補正、全体だけの2行制限、主体選択の逆順、
区分ごと1件への縮退、欠落側の件数をNULLにする誤り、欠落値の誤結合という10種類の誤ったSQLの出力不一致を確認しました。
別の直接JOIN検算では左2・右3件が6組へ増幅する誤りを確認し、期待行の逆順も不一致として確認しました。
これは参照案の局所検算であり、共通runtime・BigQuery構文・実AIの評価ではありません。
新しい製品code・評価runtime・scorer・閾値・fixture登録は変更せず、この準備のprovider呼出しは0回です。

## 事前確認の範囲と停止点

事前確認の提案は、このSQL bytesの無料dry runだけを`repchat-dev`／`US`で1回行う範囲でした。
単一SELECT、指定2tableだけ、4列の型、推定処理bytesを確認します。結果行・query本実行・AI・IAM変更・
正式scope追加・再試行は含みません。オーナーの直接承認前には実行しません。

dry run成功後に、最大6行・1回・課金bytes上限・適用価格・最大JPY・予約の直前確認を提示し、実値取得を別承認にします。
前の全table集計の実行承認・90,429,641 bytesという結果を、新しいSQLの承認や推定処理量へ流用しません。
取得後に出力契約と各行を照合し、SQL全文・期待値をprivate資料へまとめてオーナーの独立reviewを求めます。
その後も[schema別不足計画](schema-coverage-gap-plan.md)の全capability・正式scope・fixture・予定run固定は別作業です。
参照知識をruntimeへ渡さず、無関係なtableのJOINで網羅済みとしません。GA4側の別table不足も解消しません。

## 2026-10-06の参照SQL dry run結果と本実行案

PR #940のマージ確認後、無料dry runだけの具体的な1回案へオーナーが「続きのタスク進めて」と回答しました。
この直接指示を同案の再開に限定し、本実行の承認とはみなしません。SQL bytesを上記SHA-256へ照合し、
応答検査の正常・拒否6通りをofflineで確認後、`repchat-dev`／`US`へ`dryRun=true`を1回送信しました。
BigQueryは単一SELECT、指定2tableだけ、予定4列（STRING 1列・INTEGER 3列）、
推定処理量90,429,641 bytes（約86.24 MiB）を返し、すべて照合しました。

本実行・行取得・AI・IAM変更・正式scope追加・再試行は0件です。推定bytesを実処理・課金bytes・実測費用へ混ぜません。
参照SQL、直接承認・送信・応答・完了記録はrepository外の新規`0700` directory内の`0600` fileへ保存しました。
実際の6行、区分内順位、左右の記録件数は未取得で、参照の独立reviewと共通runtimeの実AI評価も未完了です。

次の本実行案は同じSQL bytes・`repchat-dev`／`US`・1回・最大6行4列・128 MiB（134,217,728 bytes）・
分析料金0.2 JPY上限です。[同日確認済みのUS Analysis単価](public-join-candidate-review.md#2026-10-06の価格確認と実行上限案)
982.468749971 JPY/TiBから、無料枠・割引なしの上界は小数第6位切上げで0.119931 JPYです。
税・別SKU・他process・請求書総額は対象外で、実際の請求額の保証ではありません。

費用承認後に予約割当を同じproject・USで1回だけ直前確認し、継承元を含む全job種別で空結果・追加pageなしの場合だけ
queryを1回送信します。今回のdry runでは予約APIを再取得しておらず、以前の空結果を現在も不変と仮定しません。
同じjobの結果を1回（`maxResults=6`・完了待機20秒）、完了metadataを1回読み取り、型・行数・区分・順位・
実処理・課金bytes・上限内の計算額を照合します。追加page・未完了・失敗・usage不明・価格不一致では再送せず停止します。
別日の実行では価格を再確認します。AI・IAM変更・正式scope追加・期限延長は含みません。
この具体的な本実行案は未承認です。無料dry runや文書マージを有料実値取得の承認へ読み替えません。
