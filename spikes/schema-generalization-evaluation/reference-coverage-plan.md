---
id: reference-coverage-plan
title: 参照ケースの検出力補強計画
status: proposed
updated: 2026-10-07
---

# 参照ケースの検出力補強計画

[Issue #791](https://github.com/Yukihide-Mitsuoka/repchat/issues/791)の実評価前に、参照ケースが誤った分析を
正解扱いしないよう補強します。この文書はオーナーレビューの条件と、次にレビューする合成ケース案を管理します。
実データの参照SQL・期待結果・認可scopeはrepository外に保持し、この文書へ複製しません。

## レビューの現在地

オーナーはこのチャットで、ケース1〜5について各推奨判断へ「その判断で良い」と回答し、
2026-10-03に「6件承認する」と明示しました。これによりケース6を含む既存6ケースの判断を確認しました。
承認したのは基本・補助ケースとしての限定採用と補強の必要性です。必須capabilityの網羅、全fixtureの
固定・独立review完了、製品品質、有料評価の承認ではありません。新しい補強案は別途レビューします。
詳細な回答と実値はrepository外のprivateレビュー記録を正本とします。

2026-10-07時点の現在地は、下記の[人工6ケースのBigQuery照合](#2026-10-07の人工6ケースのbigquery照合)と
[正式評価の不足監査](schema-coverage-gap-plan.md#2026-10-07の正解データ充足性監査)を正本とします。
ローカル補助ケースの採用、参照計算の実値一致、正式fixtureの独立reviewを区別します。

2026-10-03にオーナーは最初の配列内条件付き集計案へ「採用します。次に進めて」と回答しました。
合成入力・期待結果・誤答検出のローカルテスト化を承認したもので、クラウド配置や有料実行の承認ではありません。

2026-10-04にオーナーは深いfieldの補強案へ「その推奨判断で進めて」と回答しました。
指定pathの読み取り・欠落処理を検査する補助テストとして採用し、目的からのfield自動発見や
汎用分析能力の証明にはしない判断です。承認範囲はローカルの評価専用テスト化で、有料実行を含みません。

同日にオーナーは期間比較の補強案へ「評価専用テストへ具体化してよい」と回答しました。
同じ長さのUTC期間、境界、timezone、0件の区分、NULL日時を検査する補助テストとして採用します。
製品変更、クラウド配置、有料実行、実AIの品質承認は含みません。

同日にオーナーは、日別累積値の各行・欠落日・区分別の補強案へ「進めて」と回答しました。
人工データ13件・期待8行を評価専用テストにする承認であり、製品変更や有料実行を含みません。

同日にオーナーは、主体別の各時刻間隔・同時刻・欠落値の補強案へ「その案で進めて」と回答しました。
人工データ11件・期待4行をローカルの評価専用テストへ具体化する承認で、製品変更や有料実行を含みません。

| 順序 | ケース | オーナー判断 | 残す補強条件 |
|---:|---|---|---|
| 1 | 配列要素数 | 基本ケースとして限定採用 | 要素内の値を使う条件付き集計、重複、空・欠落、無関係な配列による増幅を確認する。配列長の合計だけでは要素分析能力を証明しない |
| 2 | 深いfieldの非NULL件数 | 基本ケースとして限定採用 | 別条件・構造、group別集計、欠落構造、別手法照合を追加する。指定されたfieldへのアクセスだけで目的からのfield発見を証明しない |
| 3 | 主体別集約集合のjoin | 補助ケースとして限定採用 | 異なる物理tableの関係・key・集計粒度を確認する。必須joinの網羅は未完了で、追加scopeは別承認とする |
| 4 | 最古日・最新日の件数差 | 基本ケースとして限定採用 | 同じ観測時間幅の期間比較、個別件数、UTC日境界を確認する。件数差を傾向・因果効果と解釈しない |
| 5 | 各日の累積値の合計 | 補助ケースとして限定採用 | 日別累積の各行、最終累積と総数の一致、欠落日、区分別累積を確認する。単一合計による途中誤差の相殺を防ぐ |
| 6 | 主体別の時刻間隔合計 | 補助ケースとして限定採用 | 各間隔、分布、既知順序で補強し、合計で途中誤差が相殺される問題を防ぐ。完全な活動順序・行動遷移を検証済みとは扱わない |

## 補強の実施順序

1. 最初の配列内条件付き集計案は採用済み。以下のローカル検証で、合成入力と期待各行をテスト専用fixtureへ固定する。
2. 異なる計算方法と意図的な誤答を使い、正しい結果は一致し、想定する誤答は必ず不一致になることを
   無料で確認する。warehouse用参照SQLや型・modeの確認は別の後続作業とする。
3. 同じ手順でケース2・4・5・6の境界例を設計し、各補強案をレビューする。ケース3の異なる物理tableは
   認可scopeを別途決定する。新しいSQLや質問に元の期待値を流用しない。
4. 実データの補強案は参照SQL、期間、欠落値、出力粒度・列・順序を固定し、無料dry runの後、
   具体的な対象・回数・最大費用の別承認を得て必要な期待値を取得する。
5. 補強後の各参照と網羅性を独立reviewし、全fixture・計画・pipeline artifactを固定する。
   評価runnerの実行はさらに別の費用承認後だけ行う。

SQLの字面や`UNNEST`・window関数の使用だけを正解条件にせず、分析の意味、粒度、全結果行で照合します。
正しい同値SQLは許容します。合成データでの検査は誤答の検出力を確認するもので、実BigQueryの方言適合や
未知schemaの実runtime品質を証明しません。

## 採用済みの補強ケース：配列内の条件付き集計

これは実顧客・選定datasetとは無関係な合成例です。人工schemaを製品へ登録する設定でもありません。
runtimeには、評価環境の認可済みscopeから共通pipelineが取得したschema・metadata・値profileと質問だけを渡し、
以下の期待知識やfixture本文は渡しません。今回の採用はローカルのテストデータ作成に限り、クラウドへのuploadを含みません。

### 質問案

「区分ごとに、元の記録数、`detail.items`のうち`eligible=true`の要素数と`quantity`の合計を求めてください。
対象要素がない区分も出力し、要素数と合計を0にしてください。同じ値の別要素もそれぞれ数えます。
`eligible`がfalseまたはNULLの要素は対象外です。対象要素の`quantity`がNULLなら、要素数には含め、
数量合計への寄与は0とします。無関係な`audit_items`は集計に使いません。区分の昇順で返してください。」

元の記録数は各区分の親行数で、展開後の行数ではありません。全区分を親行から確定し、
子要素の条件を満たさない区分を削除しないことが必要です。fieldの役割は人工schemaのdescriptionに記録する
評価環境metadataであり、製品の手動指標定義にはしません。

### 合成入力・期待行

`detail=null`は親RECORD欠落の人工表現です。実BigQueryへ配置する場合の型・mode・欠落表現の検証は後続です。

入力と期待行の正本は[テスト専用JSON](../../tests/fixtures/schema-generalization/array-conditional.json)です。
Aは同値の別要素とNULL数量を含み、Bは空配列・欠落RECORD、Cはfalse・NULL条件だけの区分です。

データは親5行・対象配列内7要素・出力3行です。件数の大きさではなく、各誤りを区別できる構成で選びました。
これは採用済みのローカル検査用fixtureであり、warehouse参照SQL・認可scope・全capabilityを固定した正式fixtureではありません。

### 検出する誤答

| 誤り | 正解と区別できる結果 |
|---|---|
| 配列長だけを集計して条件を無視する | Aの要素数5、Cの要素数2となり不一致 |
| false・NULL条件も数量へ含める | Aの数量57、Cの数量16となり不一致 |
| 同じ数量を重複排除する | Aの数量5となり、正解7と不一致 |
| 数量NULLを対象要素数から除く | Aの対象要素数3となり、正解4と不一致 |
| 子要素の条件をWHEREで絞って親を失う | B・Cの期待行が欠ける |
| 展開後の行数を元の記録数と扱う | Aの親行数2を保てない |
| 無関係な配列も内部展開して直積にする | Aで記録102を失い、数量8となって正解7と不一致 |

総数だけでなく3行の全列・順序を照合します。なお、正解結果と一致してもそのSQLの全来歴や
任意schema対応が証明されたとは扱いません。

### ローカル検証の範囲

[回帰テスト](../../tests/spikes/schema-generalization-array-reference.test.ts)は、Pythonの親行ごとの反復集計と
標準ライブラリSQLiteのJSON展開・SQL集計を、固定期待行へ独立に照合します。7種類の誤ったSQLも実行し、
各誤答値と既存post-run不一致検出の両方を確認します。行順序だけの誤りも総数で隠れないことを確認します。
SQLite SQLはローカル検算用であり、BigQuery用参照SQLではありません。テストは不一致検出器のunit入力だけを
使い、正式evidence、reviewer ID、実AI run、認可scope、品質合格を捏造しません。
製品・評価runtime、scorer、閾値、安全gateは変更せず、クラウド配置・provider呼出しも行いません。
ケース2の補強案も採用済みで、以下に検査対象と限界を記録します。

## 採用済みの補強ケース：深いfieldの読み取りと欠落処理

実顧客・選定datasetとは無関係な人工データです。製品runtimeへ人工schema、固定SQL、設定を追加しません。
入力・期待行の正本は[テスト専用JSON](../../tests/fixtures/schema-generalization/nested-field.json)です。
8行・1ケース・出力3行であり、AIの実行回数は0回です。

### 質問と入力条件

「区分ごとに、元の記録数、`detail.context.owner.label`の非NULL件数、NULLでも空文字でもない件数を
求めてください。途中の構造または末端fieldの欠落はNULLと扱います。空文字は非NULL件数だけに含めます。
対象値がない区分も0件として残し、区分の昇順で返してください。
`detail.owner.label`と`audit.context.owner.label`は集計に使いません。」

Aは文字列・空文字・NULL、Bは`detail`・`context`・`owner`の各段階がNULLの3行、
Cは文字列・末端field欠落です。同名の別fieldには対象と異なる値を置き、取り違えを検出します。
非空文字の条件は`label != ""`で、trimや空白の除去を暗黙に加えません。
JSONの欠落表現はローカル検査用であり、実BigQueryの型・mode・欠落表現の確認は後続です。

### 検出する誤答

| 誤り | 正解と区別できる結果 |
|---|---|
| 空文字を非NULL件数から除く | Aの非NULL件数が1となり、正解2と不一致 |
| NULL・欠落を空文字へ補い、非NULLとして数える | Bの非NULL件数が3となり、正解0と不一致 |
| 末端値ではなく親構造の存在を数える | Aの非NULL件数が3、Cが2となり不一致 |
| 同名の浅いfieldを選ぶ | Bの非NULL件数が2、Aの非空文字件数が2となり不一致 |
| 同名の無関係な深いfieldを選ぶ | Bの非NULL件数が2、Cが0となり不一致 |
| 対象がNULLの親行をWHEREで除く | Bが消え、A・Cの元の記録数も減る |
| 非NULL件数を非空文字件数として返す | Aの非空文字件数が2となり、正解1と不一致 |

### ローカル検証と限界

[回帰テスト](../../tests/spikes/schema-generalization-nested-reference.test.ts)は、Pythonで階層を順に読む集計と
SQLiteのJSON抽出・SQL集計を、固定期待行の全列・順序へ独立に照合します。上記7種類の誤ったSQLと
行順序だけの誤りを、既存post-run不一致検出器のunit入力でも照合します。
正式evidence、reviewer ID、認可scope、実AI runを作ったことにはせず、scorerと閾値も変更しません。

この補助テストは指定されたpathへのアクセス、NULLと空文字の区別、元の記録数・区分の保持を検査します。
分析目的から適切なfieldを自動発見する能力、実BigQueryでの適合、未知schemaの実runtime品質は未検証です。
行数を増やすだけでこれらの不足を解消したとは扱いません。
ケース4の補強案も採用済みで、以下に検査対象と限界を記録します。

## 採用済みの補強ケース：同じ長さのUTC期間の比較

入力・期間境界・期待各行の正本は[テスト専用JSON](../../tests/fixtures/schema-generalization/period-comparison.json)です。
実顧客・選定datasetとは無関係な人工データ12行のうち9行を集計し、3行を出力します。
1ケース・AI実行0回です。製品runtimeへ人工schema、固定SQL、期間parser、設定を追加しません。

### 質問と入力条件

「`occurred_at`をUTCの時刻として、2026-01-10と2026-01-11の各24時間の記録数を区分別に比較してください。
開始時刻は含め、終了時刻は含めません。日時NULLは除外し、どちらかの期間に記録がある区分は
もう一方が0件でも残してください。前期間の件数、後期間の件数、後−前の差を区分の昇順で返してください。」

入力には開始前、開始と終了のちょうど境界、UTC日と文字列の暦日が異なる数値offset付き日時、
片側だけに記録がある区分、NULL日時を含めます。期間はともにUTCの24時間であり、差だけでなく個別件数を照合します。
日時文字列はローカル検査用です。warehouse配置時の型・modeと日時表現の適合は後続で確認します。

### 検出する誤答

| 誤り | 正解と区別できる結果 |
|---|---|
| 終了時刻を含める | Aが前4件・後3件になる。差は正解と同じ−1なので個別件数が必要 |
| 開始時刻を除く | Aが前2件・後1件になる。これも差は−1のまま |
| timezoneを無視して文字列の暦日を使う | Aが前2件・後3件、Bが前1件・後1件になり不一致 |
| 両期間に記録がある区分だけ残す | B・Cが消える |
| NULL日時に後期間の日時を補う | Cの後件数が1になり、正解0と不一致 |
| 後期間だけ12時間へ縮める | A・Bの後件数がそれぞれ1になり、正解2と不一致 |
| 前−後で差を計算する | 各区分の差の符号が反転する |

### ローカル検証と限界

[回帰テスト](../../tests/spikes/schema-generalization-period-reference.test.ts)は、Python標準のtimezone付き日時比較と
SQLiteの日時・SQL集計を、固定期待行へ独立に照合します。各期間の24時間幅、全列、区分と行順序も検査し、
上記7種類の誤ったSQLを実行して、既存post-run不一致検出器のunit入力で不一致になることを確認します。
正式evidence、reviewer ID、認可scope、実AI runを作ったことにはしません。scorer・閾値・安全gateも変更しません。

この検査は固定した期間と日時fieldの境界処理を確認します。分析目的からの適切な日時fieldの自動発見、
任意の日時書式、実BigQuery適合、実AIの精度・統計的成功率、傾向・因果関係は証明しません。
同じ期間幅でも、実データの観測漏れや母集団の違いを排除したことにはしません。
ケース5の補強案も採用済みで、以下に検査対象と限界を記録します。

## 採用済みの補強ケース：日別累積値の各行・欠落日・区分別集計

入力・期間・期待各行の正本は[テスト専用JSON](../../tests/fixtures/schema-generalization/daily-cumulative.json)です。
実顧客・選定datasetとは無関係な人工データ13行を、2区分・4日・期待8行へ集計します。
1ケース・AI実行0回です。製品runtimeへ人工schema、固定SQL、期間parser、設定を追加しません。

### 質問と入力条件

「`occurred_at`をUTCへ換算し、2026-01-10から2026-01-13までの日別記録数と累積記録数を
区分別に返してください。各区分について記録のない日も0件として残し、累積には当日分を含めてください。
区分の昇順、その中で日付の昇順に返してください。」

期間は2026-01-10のUTC開始時刻を含み、2026-01-14のUTC開始時刻を含みません。
入力はすべてこの期間内の非NULL日時で、同じ日の複数記録をそれぞれ数えます。
Aの2026-01-11とBの2026-01-12には記録がありません。出力は日別・区分別に1行です。
今回はUTC日時だけを使い、timezone・期間境界・NULL日時の対抗例は前節の期間比較で別に検査します。

### 検出する誤答

| 誤り | 正解と区別できる結果 |
|---|---|
| 累積から当日分を除く | Aの累積がNULL・2・2・5となり不一致 |
| 区分を分けず累積する | Bの最終累積が全区分合計13となり、正解7と不一致 |
| 日付の降順で累積する | Aの累積が6・4・4・1となり不一致 |
| 記録のない日を削除する | 期待8行のうちAの2026-01-11とBの2026-01-12が消える |
| 同じ日の記録を重複排除して日数を数える | 各区分の最終累積が3となり不一致 |
| 各日の累積ではなく全期間合計を返す | Aの全行が6となり不一致 |
| 当日件数を累積件数として返す | Aの累積が2・0・3・1となり不一致 |

さらにAの累積を正解の2・2・5・6から2・3・4・6へ意図的に改変します。累積値の合計15と最終累積6が
同じでも途中2行が不一致になることを確認します。これは誤答行を使う単体検査であり、実SQLやAIで
この誤りを観測した記録ではありません。行順序だけの誤りも全列・順序の照合で検出します。

### ローカル検証と限界

[回帰テスト](../../tests/spikes/schema-generalization-window-reference.test.ts)は、PythonのUTC日別件数と暦日ごとの
逐次累積、SQLiteの日付補完とwindow集計を、固定期待8行へ独立に照合します。
最終累積と区分の記録総数の一致も確認します。上記7種類の誤ったSQLを実行し、途中誤差の相殺と行順序の
誤りも既存post-run不一致検出器のunit入力へ照合します。正式evidence、reviewer ID、認可scope、実AI runを
作ったことにはしません。scorer・閾値・安全gateは変更しません。

この検査は固定した日時fieldと記録件数の累積処理を確認します。適切なfield・指標の自動発見、
実BigQueryの型・方言適合、未知schemaの実runtime品質、実AIの精度・統計的成功率は未検証です。
同値の正しいSQLは許容し、window関数の字面だけを正解根拠にしません。
ケース6の補強案も採用済みで、以下に検査対象と限界を記録します。

## 採用済みの補強ケース：主体別の各時刻間隔・同時刻・欠落値

入力・期待各行の正本は[テスト専用JSON](../../tests/fixtures/schema-generalization/time-intervals.json)です。
実顧客・選定datasetとは無関係な人工データ11件から、主体別の有効な異なる時刻7件と期待間隔4行を得ます。
1ケース・AI実行0回です。製品runtimeへ人工schema、固定SQL、期間parser、設定を追加しません。

### 質問と入力条件

「主体別に異なるUTC時刻を昇順に並べ、隣接する時刻ごとに前時刻・現時刻・経過秒数を返してください。
同じ主体・同時刻の記録は1つの時刻群へまとめ、主体または日時がNULLの記録は除外します。
有効な時刻が1種類だけの主体は間隔を出力せず、0秒の行を補いません。
主体、前時刻、現時刻の昇順で返してください。」

入力は時刻順ではなく、Aの同時刻重複、NULL日時1件、NULL主体2件、有効時刻1件だけのCを含めます。
NULL主体を2件置くことで、欠落主体同士を同じ主体と誤認して作る間隔も検出できます。
すべて2026-01-10のUTC日時です。正解はAが600・1200秒、Bが900・2400秒で、
主体別合計はAが1800秒、Bが3300秒、全体が5100秒です。合計だけでなく前後時刻・各秒数・行数・順序を照合します。

### 検出する誤答

| 誤り | 正解と区別できる結果 |
|---|---|
| 同時刻重複を残す | Aに0秒が増え、5行になる。全体合計は5100秒のまま |
| 主体を分けず前時刻を取る | 6行になり、Cに120秒の間隔が生まれる |
| 時刻の降順で前時刻を取る | 負の秒数になり、前後時刻も逆になる |
| 前−現で差を計算する | 各間隔の符号が反転する |
| 分単位を秒として返す | 10・20・15・40となり不一致 |
| NULL日時に00:15の時刻を補う | Aが600・300・900秒で5行になる。全体合計は5100秒のまま |
| NULL主体を1群として残す | 1020秒の余計な間隔が増え、5行になる |
| 前時刻がない行を自己比較で補う | 各主体の先頭に0秒が増えて7行になり、Cも残る。全体合計は変わらない |

さらにAの各間隔を600・1200秒から900・900秒へ意図的に改変します。前後時刻、行数、主体別合計と全体合計が
同じでも各秒数が不一致になることを確認します。これは誤答行を作る単体検査であり、実SQLやAIでこの誤りを
観測した記録ではありません。行順序だけの誤りも全列・順序の照合で検出します。

### ローカル検証と限界

[回帰テスト](../../tests/spikes/schema-generalization-interval-reference.test.ts)は、Pythonの主体別時刻集合・隣接比較と
SQLiteの重複排除・window処理を固定期待4行へ独立に照合します。上記8種類の誤ったSQLも実行し、
各誤答、合計で隠れる途中誤差と行順序を既存post-run不一致検出器のunit入力へ照合します。
SQLite SQLはローカル検算用で、BigQuery用参照SQLではありません。正式evidence、reviewer ID、認可scope、
実AI runを作ったことにはせず、製品・評価runtime、scorer・閾値・安全gateも変更しません。

この検査は指定された時刻fieldに対する異なる時刻群間の経過秒数を確認します。活動単位の完全順序、
行動遷移、適切な主体・時刻fieldの自動発見、任意日時書式、実BigQuery適合、未知schema品質、
実AIの精度・統計的成功率は未検証です。同時刻の活動を恣意的なID順に並べて順序根拠を補いません。

ケース3の補強案も採用済みで、以下に検査対象と限界を記録します。
warehouse配置時の型・mode・metadataと追加scopeは後続の確認事項で、追加取得・クラウド配置・有料評価へ自動的に進みません。

## 採用済みの補強ケース：異なる2テーブルのJOINと集計粒度

2026-10-04にオーナーは案の説明後、「採用し、ローカルの評価専用テストへ具体化してよいですか」へ
「進めて」と回答しました。承認範囲は1件のローカル検査用fixture・SQL・テストであり、
製品変更、追加scope、クラウド配置、有料実行、正式fixture全体の固定・独立review完了を含みません。

### 目的と出所

[要件定義書](../../docs/requirements.md)§9は、対象別処理を
追加しない同一runtimeによる未知schemaのjoinを含む反復評価を要求します。
[Issue #791](https://github.com/Yukihide-Mitsuoka/repchat/issues/791)は類似ID、nullable key、多対多、
集計粒度の対抗fixtureを要求します。本計画の既存ケース3は同一tableの集約集合間のjoinに限られるため、
この案では2つの独立したtableの関係を使い、キー・行粒度を間違えた結果を正解扱いしない条件を補強します。
[ADR-0025](../../docs/adr/0025-discover-analysis-contracts-without-source-specific-code.md)に従い、
人工table・列・意味・期待結果を製品runtimeのcode、prompt、設定、手動定義へ追加しません。

### 質問と入力条件

「左テーブルの区分ごとに、左の元記録数・左数量合計と、各左記録に対応する右記録数の合計・右数量合計を
返してください。対応は非NULLの`link_key`同士の等値で、`record_id`は各table内の記録IDです。
同じキーを持つ別の左記録も別々に計算し、各左記録に同じ右記録が対応してもその対応ごとに数えます。
同じ値の別の右記録もそれぞれ数えます。右数量NULLは対応件数に含め、数量への寄与は0とします。
対応先がない左記録と区分も残し、対応件数・右数量は0とします。左右のNULLキー同士は対応させず、
左記録がない右記録は出力対象外です。区分の昇順で返してください。」

左の件数・数量は元の左記録単位、右の件数・数量は左右の対応組単位です。この2つの粒度を混同しません。
キー10は左2件・右2件の多対多で4組を作ります。右記録を全体で一度だけ数える質問ではありません。
この対応組単位の重複計上は質問の明示条件であり、業務指標の正当性を推測するものではありません。

### 人工データと期待各行

入力・期待各行の正本は[テスト専用JSON](../../tests/fixtures/schema-generalization/two-table-join.json)です。
左右それぞれ6行で、両tableの`record_id`が一致しても対応根拠ではありません。
出力列は`group_key`、`left_count`、`left_quantity`、`right_match_count`、`right_quantity`です。
Aには多対多の対応、Bには数量NULLの対応とNULLキー、Cには対応のない左記録を置きます。

合計入力12行・2テーブル・対応6組・対応先のない左2行・左がない右2行・出力3行・1ケース・AI実行0回です。
左の元記録数合計6、左数量合計37、右対応件数合計6、右数量合計16を検算に使いますが、全列・順序も照合します。

### 検出する誤答

| 想定する誤り | 正解と区別できる結果 |
|---|---|
| JOIN後の行数を左の元記録数にする | Aの左件数が5になり、正解3と不一致 |
| JOIN後の左数量をそのまま合計する | Aの左数量が28になり、正解18と不一致 |
| 対応する左記録だけ残す | Bの左件数が1、左数量が4になり、Cが消える |
| 各table内のrecord_id同士をJOINする | Aの右件数3・右数量10、Bの右件数2・右数量99、Cの右件数1・右数量100になる |
| キー別の右数量で同じ値を重複排除する | Aの右数量が10になり、正解16と不一致 |
| 右数量NULLの記録を除外する | Bの右件数が0になる。右数量は0のままなので件数の照合も必要 |
| NULLキー同士を同じキーとして対応させる | Bの右件数2・右数量99になり不一致 |
| キー別の右記録を1件扱いする | Aの右件数が3になり、正解5と不一致 |
| 対応する左がない右記録も出力へ含める | 左区分に属さない右2記録・右数量199が余計に含まれる |

### ローカル検証と限界

[回帰テスト](../../tests/spikes/schema-generalization-join-reference.test.ts)は、Pythonの左記録ごとの探索と
SQLiteの独立した2つのin-memory tableでのJOIN・集計を、固定期待3行へ独立に照合します。
上記9種類の誤ったSQLも実行し、各誤答値と既存post-run不一致検出器のunit入力で不一致になることを確認します。
行順序だけの誤りも件数・数量合計で隠れないことを検査します。正式evidence、reviewer ID、認可scope、
実AI runを作ったことにはしません。製品・評価runtime、scorer・閾値・安全gateも変更しません。
SQLite SQLはローカル検算用で、BigQuery用参照SQLではありません。
参照SQLの字面や特定の事前集計方法は正解条件にせず、同値の正しいSQLを許容します。

採用はローカルの計算・誤答検出用に限り、JOIN網羅の完了とは扱いません。
少数行でもキー取り違え・重複増幅・欠落・NULL・多対多を区別できます。一方、指定された対応キーの計算を
検査するものであり、table・key・relationshipの自動発見、型が異なるキー、複合キー、期間付き関係、
曖昧な複数候補の選択、安全gate、実BigQuery適合、実AIの精度・統計的成功率は未検証です。
9誤答は同じ1ケースに対する人工改変で、独立した9ケースや9回のAI評価ではありません。

人工列の意味・対応条件を将来の評価環境metadataに置く場合も、製品の手動分析設定にはしません。
この補助検査だけで元の公開tableの認可scopeは増えず、正式fixtureのjoin必須capabilityを満たしたとも扱いません。
warehouse用のtable・型・mode・description、認可scope、参照SQL・期待値の独立reviewは後続です。
追加データ取得、クラウド配置、有料評価には、それぞれ具体的な範囲と必要な費用の別承認を要求します。

## 承認済みの配置条件：2テーブルJOIN用warehouse fixture

前節のローカル検査を実BigQuery方言でも再現する場合は、公開データの既存scopeへ別tableを混ぜず、
評価専用dataset内の2つのnative tableへ同じ12行を配置します。オーナー承認後の配置結果は下記に記録します。
配置の承認をIAM変更、配置後のmetadata取得、query実行、実AI評価の承認へ読み替えません。

### 物理schema案

完全修飾table IDは下記の配置結果を正本とします。table名は`join_left_records`と`join_right_records`とし、
次のBigQuery標準schemaだけを持たせます。
型・mode・descriptionの仕様は[BigQuery公式schema資料](https://docs.cloud.google.com/bigquery/docs/schemas)を
根拠とします。取得metadataでは[標準同義表記の`INT64`と`INTEGER`](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/data-types#integer_type)を
区別して不一致にせず、実際の表記を記録します。

| table | field | type | mode | descriptionの事実範囲 |
|---|---|---|---|---|
| `join_left_records` | `record_id` | `INT64` | `REQUIRED` | このtable内の1記録を識別する。別tableの`record_id`との対応は表さない |
| `join_left_records` | `link_key` | `INT64` | `NULLABLE` | 別tableとの関連に使用できる。非NULL値は重複しうる |
| `join_left_records` | `group_key` | `STRING` | `REQUIRED` | 左記録を区分する値 |
| `join_left_records` | `quantity` | `INT64` | `REQUIRED` | 左記録に属する整数値。同じ値の別記録を区別する |
| `join_right_records` | `record_id` | `INT64` | `REQUIRED` | このtable内の1記録を識別する。別tableの`record_id`との対応は表さない |
| `join_right_records` | `link_key` | `INT64` | `NULLABLE` | 別tableとの関連に使用できる。非NULL値は重複しうる |
| `join_right_records` | `quantity` | `INT64` | `NULLABLE` | 右記録に属する整数値。値が欠落する場合がある |

partition、clustering、primary／foreign key制約、view、事前集計、policy tagは追加しません。
時間fieldを持たないため、共通契約は標準規則どおり`period=null`でなければなりません。
descriptionはschema metadataとして共通pipelineが読む未信頼入力であり、固定relationship、期待SQL、期待値を
製品runtimeへ登録する設定にはしません。質問が`link_key`とNULL・対応組の規則を明示し、runtimeは
認可scope内のschema、description、bounded value profileからrelationshipとgrainを生成する必要があります。

### 認可scope案

評価manifestのscopeは、承認済みの完全修飾table ID 2件だけを`tables`へ列挙し、dataset列挙用の
`datasets`は空にします。これにより同じdatasetの別tableを自動追加せず、2件以外の参照を共通SQL検査と
BigQuery job metadataの両方で拒否します。配置用の書込み主体と評価runtimeの読取り主体を分離し、
runtimeへdataset作成・table作成・更新・削除権限を渡しません。
具体的な権限は[BigQuery公式IAM資料](https://docs.cloud.google.com/bigquery/docs/access-control)に照らし、
tableのmetadata・data読取りと実行projectのjob作成を分けて提示します。IAM設定はこの文書だけでは変更しません。

このscopeはrelationshipとgrainの評価には使えますが、多数の候補から2tableを選ぶ能力は検査しません。
選択能力を検査するためだけにdecoy tableを黙って追加せず、必要なら別ケースとして質問・期待結果・費用・scopeを
独立reviewします。現在の公開`github_nested`評価scopeも、この配置承認から自動的には変更しません。

### 実施を分ける停止点

1. 本節の採否だけをreviewする。ここまではローカル文書変更で、クラウド操作0件・クラウド利用費用0 JPYとする。
2. 採用後、配置先project、dataset、location、table ID、保持期限、作成・削除主体を提示し、
   2table・12行の作成と保存費用の上限を別途承認する。
3. 配置後、行を取得しないschema metadata確認でtype、mode、description、table type、locationを照合する。
   認可scopeと取得回数を提示して事前承認を得る。この確認の承認はquery実行承認と分ける。
4. 参照SQLと共通scope discoveryの各queryを無料dry runし、参照table、出力schema、推定bytesを確認する。
   結果行を得るqueryは、回数、行数、`maximum_bytes_billed`、価格snapshot、最大JPYを提示して別承認を得る。
5. 実値の期待3行を作成者と異なるオーナーがreviewし、正式fixtureへ固定する。文書のマージやschema一致だけを
   独立review完了としない。
6. 実AIの反復評価は、公式fixture、計画、pipeline artifact、価格、全run予算を固定した後にさらに別承認を得る。

[無料dry runの公式仕様](https://docs.cloud.google.com/bigquery/docs/running-queries#dry-run)は、
結果行を取得するqueryや保存費用を無料とする根拠ではありません。12行でも実行費用を0と推測しません。

この案は質問で対応キーを指定する1件のJOIN補助評価です。配置や実値一致だけでは、適切なtable・keyの
自動発見、実AI品質、各schemaの全必須capability網羅の証明にはしません。正式fixture全体の固定・独立reviewと
実反復評価は未完了です。固定SQL、固定relationship、期待行はpost-runの評価側だけに保持します。

### 2026-10-04の承認と配置結果

オーナーはproject IDを`repchat-dev`と指定し、dataset作成1回、table作成2回、各6行の投入2回、
7日後のtable自動削除、保存予算1 JPYの提示へ「はい、進めて」と回答しました。
同名datasetがないことと、USの予約割当検索で有料`PIPELINE`割当がないことを読み取り確認してから、
5操作を各1回実行しました。作成・uploadの自動再試行は無効にし、既存資源の上書きは行いませんでした。

| 資源 | 配置結果 |
|---|---|
| dataset | `repchat-dev.repchat_eval_join_20261004`、US、`LOGICAL`保存課金、既定table期限7日 |
| 左table | `repchat-dev.repchat_eval_join_20261004.join_left_records`、load job成功、投入6行 |
| 右table | `repchat-dev.repchat_eval_join_20261004.join_right_records`、load job成功、投入6行 |
| 両tableの期限 | `2026-10-11T11:33:05.310Z`（日本時間20:33:05.310）、期限延長なし。空datasetは自動削除しない |

投入はローカルfixtureの左右入力だけをJSONL化し、`CREATE_NEVER`・`WRITE_EMPTY`で実行しました。
`expected_rows`、参照SQL、固定relationshipはuploadしていません。schemaの作成応答は標準同義表記の
`INTEGER`で返り、type・mode・description、native table種別、期限を照合しました。
投入件数は両load jobの完了metadataで確認し、配置後のtable再取得や行取得は行っていません。
実行ID・fixture bytesのSHA-256・作成応答・load job完了記録はrepository外のprivate作業記録に保存しました。

両load jobのreservation IDは`default-pipeline`でした。[共有枠のbatch loadは無料](https://docs.cloud.google.com/bigquery/docs/batch-loading-data#pricing)です。
保存費用は無料枠を使わず、[確認時のUS論理保存単価3.1439 JPY/GiB月](https://cloud.google.com/skus?currency=JPY&filter=947D-3B46-7781)を用い、
実入力282 logical bytesより大きい2 MiBを丸1か月保存する保守的な計算でも`0.0061404296875 JPY`です。
これは計算値であり、実請求の計測値ではありません。1 JPYは今回の保存予算で、project全体の請求停止設定ではありません。

query job、Vertex呼出し、IAM更新は0件です。製品・評価runtime、scorer・閾値・安全gate、
既存公開tableの認可scopeは変更していません。配置用主体へruntime読取り主体を統合しません。
配置完了時点では、停止点3の独立metadata取得前に停止しました。後続の承認・確認結果は次節を参照します。

### 2026-10-05のmetadata確認結果

オーナーは、配置した2tableのmetadataを各1回、計2回取得して照合する提示へ「承認します」と回答しました。
承認範囲は再試行・行取得・SQL実行・AI呼出し・IAM変更なしのmetadata確認です。
[公式`tables.get` API](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/tables/get)の`view=BASIC`を
各1回呼び、両方のHTTP 200と以下の一致を確認しました。HTTP再試行とリダイレクトは無効にしました。

- 取得したtable IDは前節の2件と一致し、左は4列、右は3列で、列順・名前・`INTEGER`／`STRING`・mode・descriptionが物理schema案と一致した。
- 両方ともnative `TABLE`、所在`US`、前節の期限とtable descriptionに一致した。
- 取得応答にpartition、clustering、primary／foreign key制約の設定はなかった。
- `BASIC`応答は行数・bytesの保存統計を含まず、行データも取得していない。各6行の投入確認は前節のload job metadataだけを根拠にする。

取得metadataと操作記録はrepository外の`0600` private fileへ保存しました。既存認証を使って配置用主体から
読み取りましたが、評価runtimeの読取り主体・権限が確定した証拠にはしません。IAM変更とruntimeへの接続は行っていません。
query job、行取得、Vertex呼出し、IAM更新は0件です。製品・評価runtime、scorer・閾値・安全gate、既存scopeは変更していません。

同じ2tableを参照する評価専用の単一SELECTをrepository外へ準備しました。右側を非NULLキー単位に集約してから
左側へLEFT JOINし、左の元記録数・数量と右の対応組数・数量を区分ごとに集計します。期待SQL・期待行を
製品runtimeへ渡しません。物理table IDだけをローカルtable名へ置換したSQLite検算は、固定fixtureの期待3行・5列・順序へ一致しました。
これはローカル計算の照合であり、BigQueryの構文・型・参照table・実値を確認した結果ではありません。

metadata確認完了時点では停止点4の無料dry runの承認前に停止しました。後続の承認・確認結果は次節を参照します。

### 2026-10-05の参照SQL dry run結果

オーナーは、前節で準備した参照SQLの無料dry run 1回の提示へ「承認します」と回答しました。
承認範囲は同じ2tableの事前検査だけで、結果行取得、有料query実行、共通scope discovery、AI呼出し、IAM変更を含みません。
SQL fileの正確なbytesのSHA-256を送信前に照合し、`jobs.insert`へ`dryRun=true`、
`useLegacySql=false`、`useQueryCache=false`を指定したPOSTを1回だけ行いました。HTTP再試行とリダイレクトは無効にしました。

HTTP 200の応答にprovider errorがなく、以下を照合しました。

- `dryRun=true`が応答へ反映され、statement typeは`SELECT`だった。
- 参照tableは配置結果の2件だけだった。
- 出力schemaは質問の5列・列順と一致し、`group_key`は`STRING`、残る4列は`INTEGER`だった。
- `totalBytesProcessed`は282 bytesだった。これはdry runの推定処理量で、実処理量・課金対象量ではない。
- 結果行は取得していない。期待3行の実値一致、正式fixtureの独立review、実AI品質を確認したことにはしない。

応答とSQL hash・1回の操作記録はrepository外の`0600` private fileへ保存しました。
追加のtable取得・job取得・結果取得・予約検索は行っていません。有料query job、Vertex呼出し、IAM更新は0件です。
製品・評価runtime、scorer・閾値・安全gateは変更せず、参照SQL・期待行をruntimeへ渡していません。
構文・型・参照tableの事前検査は完了しましたが、runtime読取り主体・権限、実値照合、table・keyの自動発見、
全fixtureの固定・独立review、実AI反復は未完了です。dry run完了時点では次の実取得承認前に停止しました。

### 2026-10-05の参照結果の実値照合

オーナーは、1回・128 MiB・分析料金0.2 JPY上限の実値取得案へ「実行して良い」と回答しました。
これは評価専用参照値の準備で、評価runnerの実行ではありません。承認対象は次の1計画だけです。

| 項目 | 承認範囲 |
|---|---|
| 対象 | 配置済みの2table、project `repchat-dev`、所在`US`。dry run済みSQLの正確なbytesを維持し、scope・SQLを変更しない |
| 実行回数 | 有料SELECT 1回だけ。自動・手動再試行なし |
| 課金bytes上限 | `maximum_bytes_billed=134217728`（128 MiB） |
| 結果取得 | 集計3行を期待し、余分な行を検出するため最大4行まで取得する。4行・列不一致・値不一致なら停止する |
| 事前確認 | USの継承元を含む予約割当検索1回。割当あり、追加pageあり、取得失敗ならqueryを送らず停止する。予約overrideは指定しない |
| 完了確認 | 同じjobの状態取得は最大6回、完了後の結果取得は1回だけ。未完了・応答不明なら再送せず停止し、費用0を仮定しない |
| 分析料金予算 | 0.2 JPY。次段落の価格と上界を送信前に照合する |
| 明示的な非対象 | 追加dry run、共通scope discovery、実AI、IAM・資源・期限変更、正式fixtureのreview完了扱い |

2026-10-05に[公式JPY SKU一覧](https://cloud.google.com/skus?currency=JPY&filter=1DF5-1F98-1DD1)で、
US Analysis（SKU `1DF5-1F98-1DD1`）のon-demand単価を982.468749971 JPY/TiBと確認しました。
無料枠を引かず、128 MiB ÷ 1 TiB × 同単価を小数第6位へ切り上げた分析料金上界は0.119931 JPYです。
282 bytesのdry run推定量から無料と推測しません。価格の適用日・課金方式が一致しない場合は上界を再確認して停止します。
[課金bytes上限](https://docs.cloud.google.com/bigquery/docs/best-practices-costs#restrict_the_number_of_bytes_billed_per_query)は
このqueryの境界であり、0.2 JPYは税、保存費用、別SKU、他process、請求書総額の停止設定ではありません。
保存費用は既存の配置承認と保持期限に従い、結果はrepository外のprivate artifactへ限定します。
配置用の既存主体で参照値を準備しても、評価runtimeの読取り主体・権限を確定したことにはしません。

送信前のoffline検査はfake HTTPで12通りの成功・停止条件を確認しました。既存操作記録による再送拒否、
予約・追加pageによる送信前停止、job未完了・失敗、usage欠落・上限超過、認可外table、
結果の行数・値・順序不一致、POST失敗での停止を含みます。provider呼出しは0件でした。
実操作はUSの継承元を含む予約検索1回で割当なし・追加pageなしを確認し、予約overrideなしで同じSQLを1回送信しました。
送信応答が既に`DONE`だったため追加job取得は0回で、同じjobの結果を1回だけ取得しました。HTTP再試行とリダイレクトは無効にしました。

| 確認項目 | 実取得結果 |
|---|---|
| query | 単一SELECT、参照tableは配置済みの2件だけ、課金bytes上限は承認値と一致 |
| 集計結果 | 3行・5列。型・全列値・行順序がテスト専用fixtureの期待行と一致。追加pageなし |
| 実処理量 | 282 bytes。dry run推定量とは別の実行metadataから取得 |
| 課金対象量 | 20,971,520 bytes（20 MiB）、128 MiB上限内 |
| 計算した分析料金 | 同じ価格snapshotで小数第6位切上げの0.018740 JPY、0.2 JPY予算内 |

この費用は実測した課金bytesからの計算値で、無料枠・税・請求調整等を反映した実請求額ではありません。
SQL・承認条件・送信と予約応答・結果行はrepository外の`0600` private artifactだけに保持し、結果行をlogへ出していません。
有料queryは1回で再送なし、結果取得は1回、Vertex呼出し・IAM更新は0件です。追加のtable取得、
共通scope discovery、配置・期限変更、製品・評価runtime、scorer・閾値・安全gateの変更は行っていません。

確認したのは1件の人工JOIN参照SQLと固定期待3行のBigQueryでの一致だけです。table・keyの自動発見、
未知schemaの実AI品質、統計的成功率、全必須capabilityの網羅を証明しません。
次はこの参照SQL・期待各行・評価範囲を作成者と異なるオーナーが独立reviewします。実取得の承認や文書のマージは
review完了の証拠にしません。これは実取得完了時点の停止点で、後続の限定採用判断は次節を参照します。
全fixtureの固定・独立review、runtime読取り主体・権限の確認、実AI反復は後続の別作業です。
追加の有料query・AI評価へ自動的に進みません。

### 2026-10-05のJOIN補助ケースの限定採用

PR #926のマージ報告後、オーナーは、このJOINケースを「重複・NULL・対応先なしの集計を検査する補助ケース」
として採用し、自動テーブル／キー発見やAI品質の証明にはしないという個別確認へ「承認します」と回答しました。
この人間による回答を限定採用の根拠とし、PRのマージや実取得承認から推測した判断にはしません。

採用するのは前節までの人工1ケースで、左の元記録粒度と右の対応組粒度を区別し、
同値記録の重複、NULLキー・数量、対応先のない左記録・区分の保持を確認する補助評価です。
実BigQueryでの期待3行の一致と9種類の人工誤答検出は確認済みですが、9独立ケースや実AI反復ではありません。
型が異なるキー、複合キー、期間付き関係、曖昧な候補からの選択も検査していません。

この回答は提示された評価範囲の採用判断です。private参照SQL fileの全内容をオーナーが確認した証跡、
参照SQL・期待各行の正確なartifact bytesへ結び付いた正式review記録、全fixtureの固定・必須capability網羅、
実AI品質や実行費用の追加承認を得たことにはしません。未確認のreviewer IDやreview済みhashを捏造しません。
次は既存private artifactと実際のreview証跡をofflineで照合し、正式fixtureへの組込みに不足する確認を整理します。
今回の承認記録では製品・評価runtime、scorer・閾値・安全gate、認可scopeを変更せず、クラウド操作も行いません。

### 2026-10-05の正式fixture組込み前の確認

オーナーの「はい、進めて」により、既存の参照準備用private directory 2件と現行評価コードをローカルで照合しました。
今回のJOIN補助ケースだけでは正式評価fixtureを構成できません。参照値の一致と限定採用は確認済みですが、
schemaごとの必須capability網羅、全参照の独立review、実行前artifactの固定が残っています。
クラウド取得・有料実行・IAM変更・期限延長は行っていません。

| 条件 | 確認結果と不足 | 根拠 |
|---|---|---|
| JOIN参照の計算 | private参照SQLとテスト用fixtureのSHA-256は既存記録と一致。private検証結果の3行がfixtureの全期待行・順序と一致した。SQLと結果fileは`0600`。これはreview完了ではない | [実値照合](#2026-10-05の参照結果の実値照合)、[テスト用fixture](../../tests/fixtures/schema-generalization/two-table-join.json) |
| 人間によるreview | この調査時点では限定採用だけが完了し、SQL全文・期待各行の確認と対象bytesへの回答の結び付けは未完了だった。後続の1件の内容確認は個別承認節を参照。正式fixture用ID・日時を推測で埋めない | [JOIN参照内容の個別承認](#2026-10-05のjoin参照内容の個別承認)、[`execution_manifest.py`](execution_manifest.py)の参照記録検査 |
| schema別の評価範囲 | 各schemaが6必須capabilityを網羅する必要がある。時間列・nested/repeated構造を持たない今回の2tableの1件はJOIN補助だけで、独立した追加schemaとしてそのまま入れられない。JOINだけの入力を現行validatorが拒否することをofflineで確認した | [`evaluation_capabilities.py`](evaluation_capabilities.py)、[物理schema案](#物理schema案) |
| 正式fixtureと認可scope | 調べた2directoryのJSON 23件には、正式fixture version 2・authorization・評価計画のtop-level field集合に一致するfileはなかった。全ローカル領域を調べた不在証明ではなく、構造の一致がreview済みの証明になるわけでもない。最低2つの異なるschema ID・実scope fingerprintと、schema IDに一対一対応する認可scopeが必要 | [`execution_manifest.py`](execution_manifest.py) |
| scope snapshot | 既存の2table metadata応答や参照SQL hashを、共通discoveryが生成するcanonical snapshot fingerprintの代わりにできない。runtime読取り主体・権限と、実snapshotの取得・固定は未完了 | [評価READMEのsnapshot契約](README.md#参照fixtureとrun記録の分離) |
| 計画・pipeline・実行承認 | 全case最低3回の予定runと、fixture・runtime・prompt・configurationの正確なbytesを固定する。AIを含む価格snapshot・実行意図・具体的な費用承認と実provider commandは未完了。参照取得の承認・BigQuery単価だけをAI評価へ流用しない | [`evaluation_plan.py`](evaluation_plan.py)、[`pipeline_artifacts.py`](pipeline_artifacts.py)、[`execution_intent.py`](execution_intent.py)、[ADR-0027](../../docs/adr/0027-bound-evaluation-spend-before-provider-calls.md) |

各schemaの網羅条件はfixture全体で6種類を合算する条件ではありません。JOINだけのschemaへ未検証の
capability labelを付けず、既存公開tableのscopeへ今回の2tableを黙って混ぜず、scorer・閾値・安全gateも緩めません。
今回の合成補強群をローカルテストとして保持することと、正式評価用schemaを構成することを分けます。

次の作業は以下の順序です。これは評価準備の順序であり、製品への対象別設定追加やクラウド操作の承認ではありません。

1. 既存JOIN参照SQL全文・期待3行・列と行順序・照合hashを、repository外の1件のreview資料へまとめる。
   オーナーには限定採用済みの判断を再要求せず、未確認の正確な参照内容だけを個別確認してもらう。
2. 既存の公開schema評価とJOIN補助評価の位置付けを整理し、各schemaの6必須capabilityを満たす
   質問・参照・scopeの不足案をofflineで提示する。追加table・配置・scope変更が必要なら実施前に別承認を得る。
3. scopeとreview対象が確定した後、runtime読取り主体、共通discoveryの取得範囲・回数・最大費用を提示する。
   承認後に取得する実snapshotへ参照fixtureを結び付け、全fixtureの独立reviewと計画・pipeline固定へ進む。
4. 実provider commandの無料回帰と、AIを含む価格・全run予算・具体的な実行承認が揃うまで実AI評価を開始しない。

保持期限は[配置結果](#2026-10-04の承認と配置結果)のままです。準備が期限を超えた場合も自動で延長・再配置せず、
必要な配置と保持費用を再提示します。SQL・期待行・review証跡はprivate領域だけに保持し、runtime入力へ渡しません。

### 2026-10-05のJOIN参照レビュー資料の準備

PR #928のマージ報告後、既存参照artifactから1件のオーナーreview資料をrepository外へ新規作成しました。
所有者専用の`0700` directory内の`0600` fileで、既存fileは上書きしていません。
SQL・fixtureのSHA-256が既存承認計画と一致し、検証済み結果3行・全5列・順序がテスト用fixtureに一致することを確認しました。
資料には実際に送信したSQL全文、人工入力の左右各6行、質問と粒度、期待各行、区分別の計算過程、
13ローカル検査の範囲、1ケース・実AI0回という件数の区別と未検証事項を収録しました。

これは[限定採用](#2026-10-05のjoin補助ケースの限定採用)の再確認ではなく、未確認の正確な参照内容を確認する資料です。
review待ちであり、SQL全文と期待各行の承認回答、reviewer ID、review完了日時を捏造していません。
回答を得た後に、資料fileの正確なbytesと実際の回答をprivate記録へ結び付けます。
資料やhashだけで本人性・全fixtureの独立review完了・実AI品質を証明したとは扱いません。

資料準備時点ではオーナーによるこの1件の内容review前に停止しました。後続の回答は次節を参照します。
schema別網羅・scope検討は前節の順序に従います。
クラウド取得・有料query・AI呼出し・IAM変更・期限延長は行わず、製品・評価runtimeと評価条件も変更していません。

### 2026-10-05のJOIN参照内容の個別承認

PR #929のマージ報告後、オーナーへprivate資料のSQL全文・期待3行を、JOIN補助1ケースの正しい参照内容として
承認するか個別確認し、オーナーは「承認します」と回答しました。PRのマージからreview完了を推測していません。
この回答により、当該1件の参照SQL・期待3行・全5列・行順序の内容確認を完了とします。
既に承認済みの補助ケース採用判断とは別の、正確な参照内容への承認です。

回答記録の作成前に、review資料・参照SQL・fixtureのSHA-256が準備時の値と一致し、既存の実結果全行・順序が
fixtureに一致することをローカルで再確認しました。資料・SQL・fixture・検証済み結果のhashと今回の質問・回答、
承認範囲・非対象・記録作成時刻をrepository外の新規`0600` fileへ保存しました。既存fileは上書きしていません。
記録作成時刻を回答の正確な発生時刻と偽らず、会話上のオーナー回答から本人性を技術的に認証したとは扱いません。
正式fixture用のreviewer ID・review完了日時を推測で埋めていません。

承認はJOIN補助1件の参照内容だけです。正式fixture全体の独立review、各schemaの6必須capability網羅、
table・keyの自動発見、runtime品質・実AI反復、scope拡張・有料実行・IAM変更・期限延長を含みません。
人工誤答9種類と実AI反復数を混同せず、1ケース・実AI0回という限界は維持します。

後続の[組込み前の確認](#2026-10-05の正式fixture組込み前の確認)の順序2では、既存公開schema評価とJOIN補助評価の
位置付け、schemaごとの質問・参照・scope不足案を[正式評価の準備計画](schema-coverage-gap-plan.md)へ整理しました。
今回の承認だけでJOINを必須capabilityの
網羅済みとせず、scopeを黙って混ぜず、評価条件を緩めません。クラウド取得・query再送・AI呼出し・IAM変更・
期限延長は行っていません。製品・評価runtime、scorer・閾値・安全gateも変更していません。

## 現在の実行権限と費用境界

オーナーの現在の直接指示は、対象固有処理なしでAIの分析を検証するための正解データ作りを十分になるまで検証し、
生成AIまたはqueryの1回の実行費用が100円以内なら追加の費用承認なしで進めてよい、というものです。
この目標内で現在価格による保守的な上界を100 JPY以下と証明できる呼出しは、過去の段階ごとの
費用確認待ちよりこの指示を優先します。安価と推測して送信せず、対象・SQL bytes・回数・行数・課金方式・
価格snapshot・各呼出し上限と有限batch予算を実行前に固定し、実usageを照合します。
[ADR-0027](../../docs/adr/0027-bound-evaluation-spend-before-provider-calls.md)の予算制御、usage不明時の停止、
自動retry禁止は維持します。1回100円はproject全体・請求書総額の停止設定ではありません。

この費用指示を、参照内容の独立review、正式fixture採用、scope拡張、IAM・資源・期限変更、
製品への対象専用実装の承認へ読み替えません。正式AI評価は参照・計画・pipeline固定が揃うまで開始しません。
上界を証明できないAI呼出しにも使いません。既存のtable保持期限は変更しません。

## 2026-10-07の人工6ケースのBigQuery照合

採用済みの人工入力を、repository外で単一SELECT内の型付き`STRUCT`・`ARRAY`・`TIMESTAMP`へ変換しました。
table作成・投入をせず、native BigQuery型・方言による参照計算を固定期待行へ照合する補助確認です。
物理tableのmode・description・discovery・AI生成は検査しません。欠落fieldは型付きNULLとして表現しました。

| ケース | 入力記録数 | 出力行数 | 全列・行順序の照合 | 実処理／課金bytes |
|---|---:|---:|---|---:|
| 配列内条件付き集計 | 5 | 3 | 一致 | 0 / 0 |
| 深いfield・欠落処理 | 8 | 3 | 一致 | 0 / 0 |
| 等長UTC期間比較 | 12（対象9） | 3 | 一致 | 0 / 0 |
| 日別累積・欠落日 | 13 | 8 | 一致 | 0 / 0 |
| 主体別時刻間隔 | 11 | 4 | 一致 | 0 / 0 |
| 2つの入力集合のJOIN・粒度 | 左右各6 | 3 | 一致 | 0 / 0 |

6ケース・計24出力行の各セルと順序を、元の結果応答・検証済み行・現在のテスト専用fixtureの正確なbytesへ
再照合しました。Python・SQLiteの既存の別手法検算にBigQueryの計算確認を追加したもので、
6独立schema・6回のAI評価・統計的精度の証拠ではありません。製品・評価runtime、scorer・閾値・安全gateは変更していません。

最初の計画は10月6日確認の価格で準備し、配列・深いfield・期間比較の3件が成功しました。
次の日別累積のdry runがHTTP 400で停止し、残りは送信しませんでした。private参照SQLに
引用なしのCTE名`groups`があり、[GoogleSQLの予約語](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/lexical#reserved_keywords)
と一致する不備を確認しました。HTTP診断本文は保存しておらず、providerが返した具体的な原因文は未確認です。
失敗記録は保持し、期待値を変えずCTE名だけ`group_values`へ修正しました。

日付変更後に[公式JPY単価](https://cloud.google.com/skus?currency=JPY&filter=1DF5-1F98-1DD1)を再確認し、
US Analysis SKU `1DF5-1F98-1DD1`は982.468749971 JPY/TiBでした。無料枠・割引を差し引かず、
各queryの`maximumBytesBilled=33554432`（32 MiB）の上界は小数第6位切上げで0.029983 JPYです。
残り3件だけの新計画は上界0.089949 JPY・batch予算1 JPYとし、修正SQL1件と未実行SQL2件の各dry run・実行が成功しました。
成功済み3件は再実行せず、停止した旧batchも再起動していません。

実操作は全体で予約検索2回、dry run 7回（うちHTTP 400が1回）、本実行6回、結果取得6回、完了job取得6回です。
各batch開始時の継承元を含む予約結果は空・追加pageなしでした。全成功jobは単一SELECT・物理table参照なし・
cache未使用・明示的な実処理bytes 0／課金bytes 0でした。同単価による分析料金計算は合計0 JPYです。
これは観測usageからの計算で、税・別SKU・他process・請求書総額の保証ではありません。
AI・IAM・scope変更・資源作成・期限変更・自動retryは0件です。

SQL・2計画・価格・応答・照合hashはrepository外の`0700` directory内の`0600` fileに保持しました。
結果行や参照SQLをGit・runtime・promptへ追加していません。新しいBigQuery参照SQLの正確なbytesへの独立review、
公開schemaごとの意味的網羅、実snapshotへのbind、全fixture固定は未完了です。
次は[不足監査](schema-coverage-gap-plan.md#2026-10-07の正解データ充足性監査)に従い、公開データの各行参照を補強します。

## 件数・反復数の解釈

データ行・要素・出力行の数と、異なるcase数・AI反復数を分けて記録します。
現行の最低3反復・一致率90%は変更しません。3/3は固定ケースの初期合格条件であり、成功率90%以上を
統計的に証明したという表現には使いません。反復数、異なるschema・条件の網羅、費用の判断は別途行います。
同じ質問の反復を増やすだけで、別schemaへの汎用性や独立caseの網羅を証明しません。

## 完了・停止条件

- 限定採用を正式fixture全体の承認へ読み替えず、未承認のケース・補強案を勝手に確定しない。
- 参照SQL・期待値・capability・review知識を製品runtime・promptへ渡さない。
- 新しい分析対象のためのcode・設定・固定SQL・期間parser・手動意味定義を製品へ追加しない。
- scorer・安全gate・閾値は変更しない。補強fixtureの範囲は独立reviewで確認する。
- 別手法と誤答での検出力確認、全参照の独立review、実反復評価は、それぞれの完了証拠を別に残す。
