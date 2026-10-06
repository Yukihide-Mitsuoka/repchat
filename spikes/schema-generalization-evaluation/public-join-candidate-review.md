---
id: public-join-candidate-review
title: 公開schemaのJOIN候補調査と最初の確認案
status: proposed
updated: 2026-10-06
---

# 公開schemaのJOIN候補調査と最初の確認案

公開資料だけでは、選定済み2schemaの別物理table間JOINの参照を確定できません。
最初の提案は`github_timeline`のmetadataだけを1回確認し、関連するfieldがあるか調べることです。
取得案は2026-10-05に個別承認され、認証停止後のオーナーによる認証更新・再開指示を受け、metadata取得1回が成功しました。
正式評価scopeへの追加やJOIN成立の判断ではありません。
[schema別不足計画](schema-coverage-gap-plan.md)の順序1の調査結果と、順序2で提示する最小確認案を記録します。

## 公開資料から確認した候補と限界

以下は2026-10-05に確認した一次資料に基づきます。後続のmetadata・事前確認・本実行の停止結果は末尾に記録し、値・対応件数は未取得です。

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

候補調査時点では公開資料の閲覧とローカル文書更新だけで、認証付きAPI・query・AI・scope変更・クラウド操作は0件でした。
正式fixture、意味的網羅、独立review、実AI品質は未完了です。既存人工tableの保持期限も変更していません。

## 2026-10-05の承認と認証段階での停止

オーナーはPR #932のマージ報告後、上記1tableの列・型・説明だけをAPIで1回取得する個別確認へ
「承認します」と回答しました。文書のマージを取得承認としたものではありません。
repository外でmetadata検査の正常・拒否6通りをofflineで確認してから、既存認証でtoken取得を試みました。
token取得は失敗し、HTTP送信前に停止しました。credential、token、認証の生の診断はlogへ出していません。

metadata API送信0回、query job・結果行・Vertex呼出し・IAM更新0件です。metadata取得は成功しておらず、
schema・所在・関係を確認済みとしません。送信前の操作記録と停止記録をrepository外の`0700` directory内の
新規`0600` fileへ保存しました。既存fileの上書き、再試行、認証設定変更は行っていません。
ローカル認証の取得失敗であり、tableの不存在・permission拒否・実関係の不成立とは判断しません。

次はオーナーによる既存Google Cloud認証の更新と、同じ1回のmetadata取得を再開する指示を待ちます。
停止した操作記録は保持し、再開を元の試行の成功と扱いません。取得対象・回数・非対象は上記のままで、
正式scope追加、実値query、AI評価、IAM変更、期限延長へ自動的に進みません。

## 2026-10-05の認証更新後の取得結果

オーナーの「認証した、再開して」という直接指示後、新しいprivate記録を作成し、同じ対象の
`tables.get view=BASIC`を1回実行しました。table identity、`TABLE`種別、所在`US`、schemaを検査しました。
最上位199列で、子field・repeated fieldは0件です。型はSTRING 151列、INTEGER 41列、BOOLEAN 7列で、
列descriptionは0件です。metadata本文・承認との対応・完了記録はrepository外の新規`0700` directory内の
`0600` fileへ保存しました。前回の停止記録は上書きしていません。

metadata API送信1回、行取得・query・dry run・Vertex呼出し・IAM変更0件です。
再送・redirect・正式scope追加・期限延長は行っていません。列説明だけから共有entityや日時の意味を
確定できる状態ではなく、文字列の内容、欠落・一意性、実値の重なり、期間、JOIN成立は未確認です。
次は既存`github_nested`のschema記録とのoffline比較です。値の確認は具体的な範囲・上限を提示して
別途承認を得るまで行いません。対象固有runtime・固定SQL・設定は追加していません。

## 2026-10-05の既存記録との部分比較

[既存schema要約](README.md#github_nestedの評価成立条件)に明記された`created_at`は、取得済み候補にもSTRINGで存在します。
候補に子field・repeated fieldはなく、元tableの`payload.pages`・`payload.shas`というnested構造と異なります。
これは文書の要約との部分比較であり、全field対応や同一entity・期間・JOIN関係の証明ではありません。

確認したrepositoryとprivate一時領域では、元tableの全schema取得fileを特定できませんでした。
検索の一部にはOSの読取り拒否があり、fileが存在しないと断定しません。既存要約から欠けた列定義を復元・推測せず、
次は既存fileの所在確認、またはオーナーの別承認による元tableのmetadataだけの1回取得が必要です。
この比較ではAPI・query・行取得・AI・scope変更は0件です。候補の同名列だけをJOIN keyへ採用しません。

## 2026-10-05の再取得と全schema構造比較

前節の停止点についてオーナーが「取得して」と指示した後、`github_nested`の`tables.get view=BASIC`を
1回実行しました。identity、`TABLE`種別、所在`US`、schemaを確認し、前回取得した候補metadataとの
構造比較をofflineで行いました。前の取得fileが見つかった、または過去とschemaが不変だったという意味ではありません。

元tableは最上位8列、RECORDを含む全field pathが222件、repeatedの祖先または自身を持つpathが12件です。
この12件は配列数ではありません。両tableとも列descriptionは0件でした。
完全pathの一致、または元pathの`.`を`_`へ置いた表記一致だけで187組を列挙し、175組は型も一致しました。
残る12組は型不一致です。表記一致はentityや値の対応を証明せず、この変換規則をruntimeへ追加しません。

| 候補・確認範囲 | 構造の事実 | 未確認条件と扱い |
|---|---|---|
| 主体候補 | 両tableに`actor` STRING、元の`actor_attributes.login`と候補の`actor_attributes_login`もSTRING | どちらが安定した主体keyか、両tableで同じ意味か、NULL・空文字・値重なりは未確認。自動採用しない |
| repository候補 | 元の`repository.owner`・`repository.name`と候補の対応表記はSTRING | name単独の一意性、ownerとの組、改名・欠落・対応粒度は未確認。列名から複合keyを確定しない |
| 時間候補 | 両方の`created_at`はSTRING | 候補側の書式・timezone・変換成功率・収録期間は未確認。元tableの参照用変換を候補へ流用しない |
| 型不一致 | BOOLEAN対STRINGが11組、RECORD対STRINGが1組 | 値の表現・情報欠落は未確認。黙ってcastや対象専用補正を加えない |

構造だけではJOIN参照caseを確定できません。次の推奨は、主体候補を最初の1件として、各側の
欠落・異なる値の件数・重なりを生IDなしの集計で確認する案を作ることです。実値確認が成功しても、
両側の活動を直接結合して多対多の件数増幅を起こさないよう、出力grainと各側の集約条件を別にreviewします。
repository候補や時間の確認を同時に承認されたものとしません。

取得metadataと比較記録は新規`0700` directory内の`0600` fileへ保存し、比較入力の正確なbytesのSHA-256へ
結び付けました。今回のmetadata API送信は1回、行取得・query・dry run・Vertex・IAM変更は0件です。
正式scope追加・再送・期限延長は行っていません。次のqueryはSQL・取得集計・回数・上限・最大費用を提示し、
事前検査と実値取得をそれぞれ別承認後に行います。runtime・scorer・閾値・対象固有処理は変更していません。

## 2026-10-06の主体候補集計の準備

参照確認専用SQLをrepository外の新規`0700` directory内の`0600` fileへ準備しました。
各tableの`actor`だけを集約し、行数・NULL行数・空文字行数・非欠落distinct数を各4列、
両側の共通・左のみ・右のみdistinct数を3列、計11整数列・1行を予定します。生IDは返しません。
値の大小文字・空白は補正せず、活動行同士の多対多JOINもしません。
人工入力4ケースをローカルSQLiteで検算しました。準備段階ではBigQuery構文・推定処理量・実値は未確認でした。

準備時の承認対象案は`repchat-dev`／`US`で同じSQLのdry runだけを1回行い、単一SELECT、指定2tableだけ、
出力11列の型、推定処理bytesを確認する範囲です。行取得・SQL本実行・AI・IAM変更・再試行は含みません。
query料金の事前検査は[公式手順](https://docs.cloud.google.com/bigquery/docs/best-practices-costs#estimate_query_costs)に従います。
実値取得は結果を受けて回数・行数・課金bytes上限・確認済み単価・最大JPYを別途提示してから承認を得ます。
今回の準備への承認を、未提示の有料実行上限への承認とみなしません。準備段階の認証付きクラウド操作は0件でした。

## 2026-10-06の主体候補SQL dry run結果

上記の1回だけの事前確認へオーナーが「はい」と回答した後、同じSQL bytesをSHA-256で照合し、
`repchat-dev`／`US`で`dryRun=true`の送信を1回行いました。BigQueryは単一SELECT、指定した2tableだけ、
出力11列の整数型、推定処理量90,429,641 bytes（約86.24 MiB）を返し、すべて照合しました。
SQL・送信記録・応答・完了記録はrepository外の新規`0700` directory内の`0600` fileへ保存しました。

query本実行・結果行取得・AI・IAM変更・scope追加・再試行は0件です。推定bytesを実処理量・課金bytes・
実測費用へ加算しません。NULL数・distinct数・値重なり・JOIN成立はまだ未確認です。
次は本実行1回・集計1行・128 MiB上限の案について、適用価格と最大JPY、必要な課金方式確認を提示します。
公式JPY SKU一覧は今回の公開web取得で読めず、以前の単価を現在も有効と推測して実行しません。
実値取得と追加の認証付き確認は、その具体的な範囲を別途承認後に行います。

## 2026-10-06の価格確認と実行上限案

公開web取得で読めなかったJPY SKU一覧は、公式ページの描画UIから確認できました。
[US Analysis SKU `1DF5-1F98-1DD1`](https://cloud.google.com/skus?currency=JPY&filter=1DF5-1F98-1DD1)の
JPY選択とon-demandの説明、982.468749971 JPY/TiBの通常単価を2026-10-06に確認しました。
無料枠・割引を差し引かず、128 MiB（134,217,728 bytes）上限の分析料金上界は
`134217728 / 1099511627776 × 982.468749971`を小数第6位へ切り上げた0.119931 JPYです。
この計算は税・別SKU・他process・請求書総額を保証しません。

本実行案は同じSQL・`repchat-dev`／`US`・1回・集計1行11整数列・128 MiB・分析料金0.2 JPY上限です。
再試行・AI・IAM変更・scope追加・期限延長は含みません。価格確認時点では本実行は未承認でした。
価格確認時点の予約割当は未確認だったため、このon-demand単価が実行へ適用できるとは断定していませんでした。
価格確認時の個別承認案は、`repchat-dev`／`US`の[searchAllAssignments](https://docs.cloud.google.com/bigquery/docs/reference/reservations/rest/v1/projects.locations/searchAllAssignments)を
`assignee=projects/repchat-dev`で1回読み取り、継承元を含む予約割当の有無を確認する範囲です。
このAPIは複数job種別を返します。今回は保守的に全種別で空結果かつ追加pageなしの場合だけ先へ進める条件とし、
割当・追加page・不明な応答があれば再送や変更をせず停止します。queryやIAM更新は行いません。
確認成功後でも、本実行1回は別の費用承認後だけ行います。価格確認段階ではBigQuery・Vertex・予約APIを呼んでいません。

## 2026-10-06の予約割当確認結果と本実行の停止点

前節の読み取り1回案へオーナーが「進めて」と回答した後、既存認証で`searchAllAssignments`を1回実行しました。
`repchat-dev`／`US`の継承元を含む全job種別の割当結果は空で、追加pageもありませんでした。
応答の正常・拒否6通りは送信前にofflineで確認しました。承認・送信・応答・完了記録は
repository外の新規`0700` directory内の`0600` fileに保存し、credential・token・生の診断をlogへ出していません。
本実行・行取得・AI・IAM変更・再試行は0件です。割当を削除・変更した結果ではなく、この取得時点の観測です。

次の個別承認対象案は、前節の同じSQL・1回・集計1行11整数列・128 MiB・分析料金0.2 JPY上限です。
実行直前に予約割当を同条件で1回だけ再確認し、空結果・追加pageなしの場合だけqueryを1回送信します。
割当の発見・読取り失敗・価格条件の不一致では本実行せず停止し、上限拡大や自動再試行は行いません。
結果は生IDを含まない集計だけをprivate領域へ保存し、実処理・課金bytesと計算額を別々に検査します。
この具体案への承認と試行結果は次節を正本とします。

## 2026-10-06の本実行承認と認証停止

PR #937のマージ確認後、前節の直前確認1回・本実行1回・集計1行・128 MiB・分析料金0.2 JPY上限へ
オーナーが「実行して良い」と回答しました。同じSQL bytesと当日確認済みの単価をofflineで照合し、
結果検査7通り・usage検査7通り・費用上界の検算後、既存認証からtoken取得を試みました。
token取得で停止し、予約割当APIの送信前に終了しました。認証設定変更・自動再試行はしていません。

予約確認・query送信・結果取得・job metadata取得・AI・IAM更新は各0回です。
今回のcommandによる分析queryは送信しておらず、実処理・課金bytesや実測費用を取得したという結果ではありません。
承認記録・停止段階と送信0回の根拠はrepository外の新規`0700` directory内の`0600` fileへ保存しました。
credential・token・生の認証診断をlogへ出していません。過去の成功記録も上書きしていません。

次はオーナーによる既存Google Cloud認証の更新と、同じ範囲を再開する直接指示を待ちます。
再開時は新しいprivate記録で予約割当を直前に1回確認し、条件一致後だけ同じSQLを1回送信します。
同じjobの結果取得1回（`maxResults=1`・完了待機20秒）とjob metadata取得1回で検査し、
未完了・取得失敗・usage不明ではSQL再送や追加読取りをせず停止します。
別日に再開する場合は適用単価を再確認し、予算との不一致では実行しません。
主体の欠落・distinct数・値重なり・意味上の共有entity・JOIN成立は引き続き未確認です。
製品・評価runtime、scorer、閾値、正式scope、人工tableの期限は変更していません。
