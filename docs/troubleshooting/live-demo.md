---
id: troubleshooting-live-demo
title: ライブデモのトラブルシューティング
status: active
updated: 2026-08-10
---

# ライブデモのトラブルシューティング

この文書は、`make demo-live`が結果の描画を停止した場合の確認方法を示します。実Vertex AIまたは
BigQueryを再実行する前に、画面のエラーと生成済みSQLを確認してください。

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

**Affects:** Issue #279修正前のライブデモ。

**Cause:** 確定した分析計画は目的、仮説、確認回答、4〜6件のパネル理由を含む一方、
`/api/dashboard`が単純問い合わせと同じ4,096 bytesの本文上限を使用していました。AIが正常に提案した
計画でも上限を超えると、Vertex AI・BigQuery buildを始める前にHTTP 400で停止していました。

**Fix:** Issue #279の修正では、確定計画だけを有限の16,384 bytes上限とし、他のPOST endpointは従来の
4,096 bytesを維持します。ブラウザから返すパネル情報も、選択した`id`と編集可能な`reason`だけに
限定します。16,384 bytesを超える計画は引き続き400で拒否します。

**Prevention:** HTTP回帰テストで、4,096 bytes超かつ16,384 bytes以下の正常な計画を受理し、
16,384 bytes超を拒否する両境界を検証します。

**Refs:** [Issue #279](https://github.com/Yukihide-Mitsuoka/repchat/issues/279),
[PR #280](https://github.com/Yukihide-Mitsuoka/repchat/pull/280)

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
- 登録済み参照SQLと一致しない結果

停止した場合は、表示済みの「BigQueryへ送ったSQL」で、連続する同一ページを除外してから
`ROW_NUMBER`を付けているか確認します。同じ有料問い合わせを再実行しても、生成SQLが同じなら結果は
変わりません。修正後に再実行する場合は、画面の費用確認を改めて承認してください。

## 回遊の「3ページ目」を「4ページ目」へ変えると理由なく停止する

**Affects:** Issue #323修正前の単一グラフ生成。

**Cause:** 登録済みの3ページ設問と完全一致する場合だけ回遊専用の生成要件を使い、深さを変更した設問は
汎用問い合わせへ降格していました。この経路では連続同一ページ統合、段階接頭辞、上位12経路、隣接edgeの
契約を失うため、AIが拒否するか3ページSQLを返す可能性がありました。また、動的な停止理由が段階一覧の下に
あり、上部の固定説明だけを見ると理由のない停止に見えました。

**Fix:** 「入口からNページ目まで」を含む回遊Sankeyは、Nが3〜6の範囲ならdepth付き回遊契約として扱います。
指定した全ページを経路集計と同数時tie-breakへ含め、隣接する段階だけをedgeとして許可します。3ページの
登録済み設問は参照SQLを照合し、4〜6ページまたは文言を変えた設問は「実行済み・既知値未照合」と表示します。
2ページ目以降で終わった経路は段階別に注記し、架空の離脱ノードは作りません。3未満または7以上は
Vertex AI・BigQueryを呼ぶ前に拒否します。

停止・拒否・エラーの動的理由は進行欄の見出し直下へ表示します。同じ問い合わせを修正版で再実行する場合も、
新しいVertex AI・BigQuery費用が発生し得るため、画面の費用確認を改めて承認してください。

**Prevention:** 固定テストでdepth付き契約、全path列の安定順序、4段階edgeの接続、段階別終了数、停止理由の
配置を検証します。

**Refs:** [Issue #323](https://github.com/Yukihide-Mitsuoka/repchat/issues/323)

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
