---
id: troubleshooting-live-demo
title: ライブデモのトラブルシューティング
status: active
updated: 2026-09-10
---

# ライブデモのトラブルシューティング

この文書は、`make demo-live`が結果の描画を停止した場合の確認方法を示します。実Vertex AIまたは
BigQueryを再実行する前に、画面のエラーと生成済みSQLを確認してください。

## Vertex AIのリクエストが拒否される

ダッシュボード計画、分析相談、SQL生成、会議報告の生成時にVertex AIがリクエストを拒否した場合、画面には
応答本文ではなく、検証済みのHTTPコードとステータスだけを表示します。`400 INVALID_ARGUMENT`なら入力または
生成設定、`401 UNAUTHENTICATED`なら認証、`403 PERMISSION_DENIED`ならAPIとIAM権限、`404 NOT_FOUND`なら
モデルとリージョン、`429 RESOURCE_EXHAUSTED`なら割り当てと利用状況を確認してください。5xxは一時的な
サービスエラーとして表示します。

失敗した生成を自動再実行しません。既存の分析案がある場合は保持するため、原因を解消した後に利用者が費用を
再確認して明示的に実行してください。SDKの例外本文、リクエスト内容、生成途中の応答は画面や診断へ転載しません。

## 未定義語の確認質問に回答して再生成する

「登録関連ページ」「対象URL」「イベント名」のように、データソースの契約だけでは対象を確定できない語が
含まれる場合、SQL生成AIは推測せず、未定義語と具体的な確認質問を返します。画面の「回答して再生成」から
URL、ページ一覧、イベント名、または計算定義を入力すると、その回答だけを追加条件として同じ分析仕様を
Vertex AIへ再送します。回答にない条件の補完、固定SQLへの置換、自動再試行はありません。BigQueryは再生成された
SQLの安全検査・dry run・結果形状検査を通過した場合だけ実行されます。

## 費用承認後の実サービス検証

固定応答テストだけでは実Vertex AIの構造化応答、BigQueryのdry run・実行、会議報告の根拠検証を確認できません。
費用を承認した担当者が、次のランナーを一度だけ実行してdashboard・insight・会議報告を各1経路確認できます。

```bash
gcloud auth application-default login
python3 spikes/report-generation/verify_live_services.py \
  --project <project> \
  --profile <ga4またはbitcoin> \
  --dashboard-question '<対象期間と分析目的を含む依頼文>' \
  --insight-question '<対象期間と単一分析の依頼文>' \
  --output /private/tmp/repchat-live-verification.json \
  --accept-cost
```

`--accept-cost`がない場合はGoogleクライアントを作成せず終了します。ランナーはAIが作った計画・相談候補を
そのまま使い、固定パネル・固定SQL・数値の代用はしません。出力JSONには実行ステージ、件数、列名、可視化種別、
SQLハッシュ、行数、検証状態、推定費用だけを保存し、SQL本文・取得行・会議報告本文は保存しません。未定義語や
検証エラーで止まった場合も、その理由を品質記録へ残して自動再実行しません。

選択したprofileはdashboard計画・build・insight相談・SQL実行に共通で渡します。依頼文は両方とも必須で、
未指定・空欄なら認証確認前に終了します。特定データソース向けの既定質問はありません。

## `make doctor`の時間とHTTP round-tripの切り分け

`make doctor`の長時間化は、`setup-github.sh`の5秒ラッパーtimeoutではなく、`test_template_inheritance_plan.py`が
テストごとに一時Gitリポジトリを作り、Git subprocessを多数起動することが主因です。2026-08-27のローカル計測では
wrapper moduleが約2.3秒、inheritance plan moduleが約51.6秒でした。

通常の`make doctor`はfast foundation suiteだけを実行します。一時Gitリポジトリを使う回帰テストは
`make doctor-slow`で実行し、CIでも独立した`doctor-slow` jobとして必ず確認します。slow suiteをskipせず、timeout延長と
retryも行いません。

HTTP round-tripの断続的な失敗は、テストが`0.0.0.0`へlistenerを開こうとして、サンドボックスや並列実行環境の
loopback制約に触れることが原因でした。`serve`は本番の既定bindを維持しつつ、テストは`127.0.0.1`を明示して
cleanupまで確認します。listener割当に失敗した場合は`serve()`が元のsocket errorをreject理由として返すため、
`EADDRINUSE`等をテスト出力で識別できます。closeは最初のPromiseを再利用し、完了後に同じportへ再bindできることを
検証します。これにより本番のCloud Run向けbindを変えず、listener割当とcleanupを個別に診断できます。

## データソースが変わった場合の扱い

ライブデモは、選択したデータソースが提供するスキーマ、指標定義、期間の表現、SQL方言をAIへ渡して分析仕様を作ります。
分析テーマやSQLを現在のサンプル値に合わせた固定候補・固定SQLへ置き換える処理はありません。データソース契約にない列・指標・期間は、
利用者への確認または実行前エラーとして扱い、別の数字を代用しません。

GA4とBitcoinは単一グラフ、相談、ダッシュボード計画、仕様確定、SQL生成、検査、実行、描画の同じ経路を使います。
ソースごとの差分は登録済みプロファイルのスキーマ、期間、許可dataset、SQL規則、意味を変えない正規化に限定します。
確定した分析計画はprofileを保持し、異なるソースとしてbuildする要求はBigQueryへ送る前に停止します。

したがって「どんなデータでも」は、任意のテーブルを無条件に推測して実行する意味ではありません。新しいデータソースを接続する場合は、
そのソースのスキーマ、意味定義、期間フィルタ、SQL方言、利用可能なチャート結果形状を登録したソースプロファイルが必要です。プロファイルが
未登録のデータは、良い結果に見せるために実行せず、未対応理由を表示します。

## ダッシュボード相談で「生成または実行に失敗しました。端末ログを確認してください。」と表示される

**Affects:** PR #411の可視化拡張後からPR #412の修正前までに、定義済み指標を含むdashboard plannerを
実Vertex AIへ送る場合。

**Cause:** 18種類の可視化を表す`anyOf`の各分岐へ、同じ定義済み指標enumを複製していました。
指標7件のGA4契約ではstructured-output schemaが6,898 bytesから9,319 bytesへ増え、providerが
複雑すぎるschemaとして分析計画の生成前に拒否しました。BigQueryは実行されていません。

**Fix:** 可視化ごとのschemaはchartと結果形状だけを制約し、定義済み指標はschema内に1回だけ説明します。
AI応答の`measures`はserver側で定義済み指標と照合し、未定義指標があれば現在案を保持して再提案文を
表示します。追加のVertex AI呼出しは自動実行しません。

**Prevention:** 固定応答回帰テストで、可視化分岐へ指標enumを複製しないことと、provider応答に未定義指標が
含まれた場合にserver側が拒否することを確認します。修正版での実Vertex AI確認は、画面の費用を改めて
承認した場合だけ1回実行してください。

**Refs:** [Issue #410](https://github.com/Yukihide-Mitsuoka/repchat/issues/410)、
[PR #412](https://github.com/Yukihide-Mitsuoka/repchat/pull/412)

## ダッシュボードbuildで「生成SQLの対象期間が問い合わせの2021年1月と一致しません」と表示される

**Cause:** 生成AIがSQLの`_TABLE_SUFFIX`範囲を問い合わせの対象月と異なる値で返すと、従来のbuild経路は
SQL担当AIによる実行前修正へ進まず、期間検証の時点で停止していました。そのため、問い合わせが2021年1月でも
SQLが別月を参照する可能性がありました。期間が一致しないSQLはBigQueryへ送信してはいけません。

**Fix:** ダッシュボードbuildに限り、期間不一致を実行前診断としてSQL担当AIへ渡し、対象期間・分析内容・出力形状を
変えずに1回だけ修正します。修正後も期間が一致しない場合は、`SQL担当AIで1回修正しましたが、実行前診断を
解消できなかったため実行しません`としてBigQueryへ送信せず停止します。単一グラフ経路は従来どおり即時停止します。

**Prevention:** 期間不一致の初回SQLが1回だけ修正され、正しい期間のSQLだけがBigQueryへ渡ることを固定回帰テストで
確認します。修正後も失敗した場合は自動再実行せず、表示されたSQLと対象月を確認してから、画面の費用確認を経て
利用者が明示的にbuildを再実行してください。

## SQL方言の未対応関数・構文で停止する

**Cause:** SQL生成AIが、選択されたデータソースのSQL方言・実行環境に存在しない関数や構文を返しました。これは
グラフの種類やデータ量の問題ではなく、実行前のdry runで検出される生成SQLとデータソース契約の不一致です。

**Fix:** ダッシュボードbuildでは、dry runから返された診断をSQL担当AIへ1回渡し、分析仕様・対象期間・出力形状を
変えずに、選択されたデータソースで利用可能な表現へ修正します。BigQuery Standard SQLのURLパス抽出では
`NET.PARSE_URL`を使わず、`REGEXP_EXTRACT`など実行可能な標準関数を使う方言ルールもSQL生成AIへ渡します。
修正後もdry runを通らない場合はBigQueryへ送信せず停止します。特定データセット向けの固定SQLや、特定関数名に
依存した自動置換・フォールバックは行いません。

**Prevention:** SQL方言の検査、データソース契約との照合、dry runを同じ実行前ゲートで行います。自動再実行は行わず、
追加のVertex AI・BigQuery利用には画面の費用確認が必要です。

## `bq dry-run rejected`でSQL生成を停止する

**Cause:** ローカルのSQL文字列検査を通過した後、BigQueryのdry runが返した解析済みjob metadataで、
statement種別が`SELECT`ではない、参照テーブルが取得できない、または許可dataset外の参照が見つかりました。

**Fix:** エラーに表示されたstatement種別または参照datasetを確認し、分析内容を変えずにSQLを修正します。
参照テーブル情報が欠けている場合は安全性を確認できないため、実クエリを送信しません。ローカル文字列検査と
BigQuery側の検査は役割が異なるため、どちらか一方へのフォールバックは行いません。

**Prevention:** dry runにも実行時と同じ課金上限を設定し、`statement_type`と`referenced_tables`を実行前に
検証します。MCPサーバー、追加依存関係、外部実装のコードは導入していません。

**Refs:** [Issue #630](https://github.com/Yukihide-Mitsuoka/repchat/issues/630)

## KPIパネルが未確認の比較・派生指標で停止する

**Cause:** AIプランナーが、現在のデータソース契約で確認できない期間・粒度・指標を比較や派生指標として判断目的へ含め、
SQL生成AIが実行条件を確定できず停止しました。確認できない値を現在のデータから推測して補うのは正しくありません。

**Fix:** プランナーは意思決定に有用な比較や派生指標を候補として提案できます。ただし、データソースから確認できる期間・粒度・指標で
実行できるかを確認し、追加の範囲や定義が必要ならclarificationsで利用者へ確認します。SQL生成AIは確認済みのdimensions・measuresだけを
出力し、未確認の条件は列へ黙って追加しません。

**Prevention:** 比較を実行する場合は対象期間と出力列を分析仕様へ明示し、SQL生成前の契約検査で確認します。未確認の条件を含む場合は
BigQueryへ送信せず、確認が必要な項目を表示します。

## 「Google Cloudの認証期限が切れています」で停止する

**Affects:** Issue #321修正前は、ADCのrefresh tokenが再認証を要求すると「生成または実行に失敗しました。
端末ログを確認してください。」という汎用エラーだけを表示していました。

**Cause:** Vertex AIまたはBigQueryへの接続時に`google.auth.exceptions.RefreshError`が発生しましたが、
認証期限切れを安全な利用者向けエラーへ分類していませんでした。SQL生成やSankey描画の不具合ではありません。

**Fix:** 次を実行してブラウザでADCを再認証し、古いcredential objectを破棄するためデモを再起動します。

```bash
gcloud auth application-default login
make demo-live PROJECT=<project>
```

修正版は認証期限切れを画面へ明示し、認証情報やGoogle SDKの例外本文は表示しません。失敗した問い合わせを
自動再実行しないため、再認証後も画面の費用確認を経て利用者が明示的に実行します。

**Prevention:** 固定例外を使うHTTP回帰テストで復旧手順と機密な例外本文の非表示を検証します。

**Refs:** [Issue #321](https://github.com/Yukihide-Mitsuoka/repchat/issues/321)

## 会議報告が出力上限までに完了しない

**Affects:** Issue #310修正前の会議報告アシスト。

**Cause:** 会議報告は出力を4,096 tokensに制限していましたが、Gemini 3.5 Flashのthinking levelを
指定せず、既定の`MEDIUM`を使用していました。件数・文字数を制限したJSON本文に加えて思考tokensも
生成されるため、正常なJSONを閉じる前に`MAX_TOKENS`へ到達しました。成功時の費用計算もcandidate
tokensだけを数え、課金対象のthought tokensを含めていませんでした。

**Fix:** 会議報告だけthinking levelを`LOW`へ固定し、出力上限を8,192 tokensへ増やします。費用計算は
candidate tokensとthought tokensを合算します。bounded schema、受理時検証、`MAX_TOKENS`と不完全JSONの
fail-closed、自動再実行禁止は維持します。

**Prevention:** 固定応答回帰テストでthinking level、出力上限、thought token課金、`MAX_TOKENS`の日本語
エラーを検証します。修正版をマージしてデモを再起動した後も、実Vertex AI再確認は画面の費用を改めて
承認した場合だけ行います。BigQueryの再実行は不要です。

**Refs:** [Issue #310](https://github.com/Yukihide-Mitsuoka/repchat/issues/310)、
[Google Cloud thinking](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking)、
[GenerateContentResponse](https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/GenerateContentResponse)

## 分析計画とSQL生成のVertex AI推定費用がthought tokensを含まない

**Affects:** Issue #311修正前の分析計画相談、単一グラフSQL生成、ダッシュボードSQL生成。

**Cause:** 各経路は`candidates_token_count`だけを出力tokenとして返していました。Geminiが
`thoughts_token_count`を返す応答では、画面と実行結果のVertex AI推定費用が課金対象になり得る出力tokenを
過少計上していました。生成結果、SQL、BigQuery実行結果には影響しません。

**Fix:** 分析計画とSQL生成は共通のusage計算を使い、candidate tokensとthought tokensを出力tokenとして
合算します。SDK応答にthought token属性が無い場合は0として扱います。モデル、thinking level、生成回数、
自動再実行禁止は変更しません。

**Prevention:** 両経路の固定応答テストでthought tokensの加算と、属性が無い旧SDK形式の後方互換を確認します。
実Vertex AI・BigQueryを費用確認なしで再実行しません。

**Refs:** [Issue #311](https://github.com/Yukihide-Mitsuoka/repchat/issues/311)、
[GenerateContentResponse](https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/GenerateContentResponse)

## 会議報告に根拠パネルへ存在しない数値があります: 14.56、19.6、49.51

**Affects:** Issue #295修正前の会議報告アシスト。

**Cause:** 根拠検証器がBigQueryから返った生の浮動小数との文字列一致だけを許可していました。
そのため、生値を報告用に小数2桁へ丸めた`14.56`、`49.51`と、ファネルの`4,537 ÷ 23,105 × 100`を
小数1桁にした`19.6`を、根拠から再現できる値でも拒否しました。

**Fix:** パネルの生値に加えて、最大小数2桁へ丸めた報告値を同じパネルの根拠値として扱います。
ファネル転換率は、サーバーが分子列、分母列、演算、精度、値を`derived_metrics`へ記録し、根拠行から
再計算した内容と一致する場合だけ扱います。未記録値、別パネルの値、改変された派生値は拒否します。

**Prevention:** 固定応答テストで報告用の丸め値と記録済みファネル転換率を受理し、未記録値、別パネル参照、
派生値の改変を拒否します。修正版をマージしてデモを再起動するまで、有料の会議報告生成を再試行しないで
ください。

**Refs:** [Issue #295](https://github.com/Yukihide-Mitsuoka/repchat/issues/295)

## 会議報告のlimitationsには根拠リンクのない数値を書けません

**Affects:** Issue #295の追加修正前は、同じ根拠bundleから会議報告を再生成すると、AI応答に応じて
このエラー、`会議報告に根拠パネルへ存在しない数値があります: 22`、または
`会議報告に根拠パネルへ存在しない数値があります: 3000、4000、6`で報告全体が停止しました。

**Cause:** limitationsの生成schemaは数字を禁止しておらず、他の区分も一つの項目に根拠外数値があると
厳格検証が応答全体を拒否していました。各再生成は同じ根拠bundleに対する独立したVertex AI呼出しであり、
左ナビゲーションが根拠またはエラーを変更したわけではありません。報告エラーを作成・編集画面だけに表示し、
報告画面の状態をナビゲーション時に上書きしていたため、画面移動で結果が変わったようにも見えました。

**Fix:** limitationsの生成schemaで半角・全角数字を禁止します。受理時の厳格な数値検証は維持し、生成経路では
一回の応答内で検証を通った項目だけを保持します。除外により必須区分が空になる場合は、根拠パネルへリンクした
数字なしの定型項目で補い、画面に除外警告を表示します。追加のVertex AI呼出しとBigQuery実行は行いません。
会議報告の処理中・警告・エラー・完了状態は会議報告画面が保持します。

**Prevention:** 固定応答テストで、strict validatorが根拠外数値を拒否し続けること、生成経路が妥当な項目を
保持すること、呼出しが一回だけであること、ナビゲーション後も報告状態を維持することを検証します。修正版を
マージしてデモを再起動するまで、有料の会議報告生成を再試行しないでください。

**Refs:** [Issue #295](https://github.com/Yukihide-Mitsuoka/repchat/issues/295)、
[Issue #181](https://github.com/Yukihide-Mitsuoka/repchat/issues/181)

## 進行カードの色が変わらない、または会議報告ボタンが無反応に見える

**Affects:** Issue #281修正前のライブデモ。

**Cause:** 単一グラフの4段階には状態連動がありましたが、後から追加したダッシュボードの3カードは
静的な説明だけで、相談・仕様確認・buildの状態を反映していませんでした。会議報告ボタンは費用確認dialogを
直接開くだけで、直近build revisionの欠落やdialog表示失敗を画面へ通知しませんでした。

**Fix:** ダッシュボードも現在段階を黄、完了段階を緑で表示します。会議報告ボタンは最初に
「費用確認待ち」を表示し、直近build revisionが無い場合とdialog表示失敗を明示します。費用確認を
承認するまではVertex AIを呼ばず、会議報告ではBigQueryを再実行しません。

**Prevention:** 固定DOM・JavaScript回帰テストで、両モードの状態class、会議報告の即時表示と
失敗メッセージを検証します。

**Refs:** [Issue #281](https://github.com/Yukihide-Mitsuoka/repchat/issues/281)

## 会議報告を生成すると「Cannot set properties of null (setting 'className')」になる

**Affects:** `report-warning`要素を追加する前のライブデモ。

**Cause:** 会議報告の描画処理は、AI応答の`generation_warnings`を表示する`report-warning`要素のclassと本文を更新しますが、報告出力HTMLにその要素がありませんでした。AI応答の検証やBigQueryの根拠bundleの問題ではなく、ブラウザ側のDOM契約不一致です。

**Fix:** 報告出力へ非表示の警告要素を常に配置し、警告がある場合だけ表示します。警告がない場合も同じ要素をhidden状態へ戻すため、会議報告の成功・警告の両方で描画処理が停止しません。

**Prevention:** HTMLに`report-warning`要素が存在することを固定回帰テストで検証します。会議報告生成は保存済み根拠bundleを使用するため、この修正によるBigQuery再実行はありません。

## 「会議報告の要約には根拠リンクのない数値を書けません」で停止する

**Affects:** Issue #289修正前の会議報告アシスト。

**Cause:** `executive_summary`だけが根拠panelを指定できない文字列で、数字を1文字でも含むと拒否する
契約でした。生成AIが対象期間の「2021年1月」や実測値を要約へ再掲すると、値が正しくても報告全体が
停止しました。文章プロンプトだけでは数字を必ず除外できません。

**Fix:** 要約も`text`と`panel_ids`を持つ根拠付き項目にし、観測と同じ実値照合を行います。引用panelに
存在する期間・数値だけを許可し、未登録panelや根拠に無い数値は引き続き拒否します。画面には要約の
result revisionとSQL hashも表示します。

**Prevention:** 固定応答テストで、根拠付きの対象月・実測値、未登録panel、根拠に無い数値、旧形式の
数字なし要約を検証します。同じ有料生成を再試行する前に、Issue #289以降の版へ更新してください。

**Refs:** [Issue #289](https://github.com/Yukihide-Mitsuoka/repchat/issues/289)

## 「会議報告の要約は160文字以内にしてください」で停止する

**Affects:** Vertex AIがJSON Schemaの`maxLength`を超える要約を返した場合。

**Cause:** `maxLength`は受理時の契約であり、生成モデルが常にその長さを守ることを保証しませんでした。生成経路が超過した要約をstrict validatorへそのまま渡していたため、要約だけが不正として報告全体を停止していました。

**Fix:** 生成経路では再試行せず、160文字を超えた要約を160文字以内の最後の完全文まで整形してからstrict validatorへ渡します。整形した場合は会議報告画面に警告を表示し、根拠panel、数値検証、引用revisionは変更しません。完全文を安全に切り出せない場合や、整形後に根拠検証へ失敗した場合は、従来どおりエラーとして停止します。

**Prevention:** 生成時の指示は安全余白を取って120文字以内とし、固定応答テストで超過要約が1回のVertex AI応答のまま160文字以内へ整形されること、再試行しないこと、警告が付くことを検証します。BigQueryは再実行しません。

## `Unterminated string starting at`で会議報告が停止する

**Affects:** Issue #292修正前の会議報告アシスト。

**Cause:** 会議報告の配列件数と文章量が生成schemaで制限されず、不完全なJSONもfinish reasonを確認せず
`json.loads`へ渡していました。そのためJSON decoderの英語例外がそのまま画面に表示されました。
実応答のfinish reasonは保存されていないため、4,096 output tokens到達だったか、別要因だったかは未特定です。
呼出し済みのVertex AIは課金対象ですが、BigQueryは再実行していません。

**Fix:** 観測3件、解釈2件、仮説2件、推奨アクション2件、限界3件を上限とし、本文・詳細にも文字数上限を
設けます。生成schemaと受理時検証の両方で制限し、`MAX_TOKENS`または不完全JSONは安定した日本語の
`ReportError`として停止します。

**Prevention:** 不完全JSONと`MAX_TOKENS`の固定応答回帰テストを実行します。再試行は追加費用を伴うため
自動化せず、修正版で画面の費用を改めて承認した場合だけ実行します。

**Refs:** [Issue #292](https://github.com/Yukihide-Mitsuoka/repchat/issues/292)

## AIの推奨回答を変更していないのに「この仕様を確定してbuild」を押せない

**Affects:** PR #278より前のライブデモ。

**Cause:** 確認欄へAIの推奨回答を表示していましたが、内部の回答状態へコピーせず、確認事項が1件でも
存在することだけでbuildを無効にしていました。

**Fix:** PR #278以降では、非空の推奨回答を表示時点で採用済みにし、編集内容も入力時に反映します。
すべての確認欄が非空で、4件以上のパネルが選択されていれば、そのまま「この仕様を確定してbuild」を
押せます。「回答を反映してAIに再提案（任意）」は候補を見直したい場合だけ使用します。

**Prevention:** 固定応答テストで、推奨回答の初期採用、編集同期、build直前の回答収集、サーバー側の
空回答拒否を検証します。

**Refs:** [Issue #277](https://github.com/Yukihide-Mitsuoka/repchat/issues/277)

## request body is empty or too large

**Affects:** Issue #279修正前のライブデモ、およびIssue #599修正前の上限超過応答。

**Cause:** 確定した分析計画は目的、仮説、確認回答、4〜6件のパネル理由を含む一方、
`/api/dashboard`が単純問い合わせと同じ4,096 bytesの本文上限を使用していました。AIが正常に提案した
計画でも上限を超えると、Vertex AI・BigQuery buildを始める前にHTTP 400で停止していました。

**Fix:** 確定計画は有限の98,304 bytes上限、他のPOST endpointは4,096 bytes上限を維持します。
上限超過時はJSONとして解析せず、Content-Lengthが有限のtransport drain上限内の場合だけbodyを破棄してから
HTTP 400を返します。これにより、clientの送信中にserverが未読bodyを残して接続を閉じる競合を防ぎます。
transport drain上限を超えるbodyは読み進めず、接続を閉じます。

**Prevention:** HTTP回帰テストで、4,096 bytes超かつ98,304 bytes以下の正常な計画を受理し、
上限を1 byte超えるbodyを送信し終えたclientへHTTP 400が届くことを検証します。

**Refs:** [Issue #279](https://github.com/Yukihide-Mitsuoka/repchat/issues/279),
[PR #280](https://github.com/Yukihide-Mitsuoka/repchat/pull/280),
および[Issue #599](https://github.com/Yukihide-Mitsuoka/repchat/issues/599)。

## 分析計画の確認fieldが拒否される

plannerの確認fieldは`audience`、`comparison`、`business_goal`だけです。response schemaは回答済みfieldを
候補から除外し、後段検証もschema制約に反する応答を拒否します。エラーに表示されたfieldが許可外または
回答済みの場合、同じ有料相談を自動再試行しません。

このエラーが固定応答テスト以外で発生した場合は、表示されたfieldと回答済みfieldを記録してIssueへ
添付してください。モデル応答の全文、認証情報、環境変数は記録しないでください。再実行は、修正後に
Vertex AI費用を改めて確認してから行います。分析計画中はBigQueryを実行しません。

## 回遊Sankeyが意味検証で停止する

通常の回遊は`page_navigation`モードです。セッション内で連続する同一`page_path`を1回の滞在へ
統合した後、入口・2ページ目・3ページ目を決めます。次の結果は正常なグラフとして描画しません。

- sourceとtargetが同じページである連続遷移
- `1. 入口: `→`2. `または`2. `→`3. `以外の段階
- 集約されていない重複edge
- 1段目のtargetに存在しないページから始まる2段目
- AI分析仕様の列・段階・流量契約と一致しない結果

停止した場合は、表示済みの「BigQueryへ送ったSQL」で、連続する同一ページを除外してから
`ROW_NUMBER`を付けているか確認します。同じ有料問い合わせを再実行しても、生成SQLが同じなら結果は
変わりません。修正後に再実行する場合は、画面の費用確認を改めて承認してください。

## 回遊の「3ページ目」を「4ページ目」へ変えると理由なく停止する

**Affects:** Issue #323修正前の単一グラフ生成。

**Cause:** 過去実装では特定文言だけ回遊専用の生成要件を使い、深さを変更した設問は汎用問い合わせへ
降格していました。この経路では連続同一ページ統合、段階接頭辞、上位経路、隣接edgeの契約を失うため、
AIが拒否するか3ページSQLを返す可能性がありました。また、動的な停止理由が段階一覧の下にあり、
上部の説明だけを見ると理由のない停止に見えました。

**Fix:** AI分析仕様でSankeyを選び、3〜4ページのdepthをSQL生成前の契約として扱います。
指定した全ページを経路集計と同数時tie-breakへ含め、隣接する段階だけをedgeとして許可します。
2ページ目以降で終わった経路は段階別に注記し、架空の離脱ノードは作りません。範囲外は
Vertex AI・BigQueryを呼ぶ前に拒否します。

停止・拒否・エラーの動的理由は進行欄の見出し直下へ表示します。同じ問い合わせを修正版で再実行する場合も、
新しいVertex AI・BigQuery費用が発生し得るため、画面の費用確認を改めて承認してください。

**Prevention:** 固定テストでdepth付き契約、全path列の安定順序、4段階edgeの接続、段階別終了数、停止理由の
配置を検証します。

**Refs:** [Issue #323](https://github.com/Yukihide-Mitsuoka/repchat/issues/323)

## 5ページ目まで指定しても3ページ目までしか描画されない

**Affects:** Issue #325修正前のcustom depth回遊Sankey。

**Cause:** Geminiは`p1`〜`p5`と1→2〜4→5を持つ5ページSQLを生成していましたが、上位12経路を
`p2 IS NOT NULL`だけで抽出していました。短いセッションが上位を占めた結果、実行結果には1→2と2→3しか
残りませんでした。結果検査も、後続段階が空なら途中終了として許可していました。生成AIが3ページSQLへ
固定された問題ではありません。

**Fix:** custom depthでは、指定した最終ページの`pN IS NOT NULL`を上位経路抽出より前に要求します。この条件が
無い生成SQLはBigQuery前に拒否します。結果には1→2から`N-1`→Nまでの全段階と、中間段階で一致する流量を
要求し、欠落時は描画しません。

**Prevention:** 固定テストで5ページ生成契約、抽出後にだけ最終ページを絞るSQLの拒否、全4 hopと流量保存を
検証します。実Vertex AI・BigQueryの再実行は費用を再承認した場合だけ行います。

**Refs:** [Issue #325](https://github.com/Yukihide-Mitsuoka/repchat/issues/325)

## 回遊Sankeyのノードだけが表示され、遷移線が見えない

**Affects:** Issue #319修正前のライブデモで、ダッシュボードと単一グラフのSankeyを同じページ内に
描画した場合。

**Cause:** 複数のSankey SVGが同一のpaint-server IDを使用していました。非表示のworkspaceもDOMには
残るため、リンクの`url(#...)`が別SVGのgradientへ解決されると、ノードと取得データは表示されても
遷移線だけが描画されません。SQLやBigQuery応答の不具合ではありません。

**Fix:** Sankeyインスタンスごとの名前空間をgradient IDへ付け、各リンクが同じSVG内のgradientだけを
参照するようにします。既存のページ種別色、リンク幅、ツールチップ、2ページ目終了数は変更しません。

**Prevention:** 固定データで二つのSankeyを同じdocumentへ描画し、全paint-server IDの一意性と
same-SVG参照を回帰テストします。実Vertex AI・BigQueryの再実行は不要です。

**Refs:** [Issue #319](https://github.com/Yukihide-Mitsuoka/repchat/issues/319)

## 同一ページの反復を分析したい

再読み込み、フォームエラー、SPA内の状態変化は通常のページ回遊とは異なる分析契約が必要です。
将来の分析計画では`page_view_occurrence`、`form_attempt`、`spa_state`を遷移単位として選ぶ方針ですが、
このデモでは未実装です。通常の回遊Sankeyから意味検証を外して代用しないでください。
