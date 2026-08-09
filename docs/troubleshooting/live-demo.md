---
id: troubleshooting-live-demo
title: ライブデモのトラブルシューティング
status: active
updated: 2026-08-09
---

# ライブデモのトラブルシューティング

この文書は、`make demo-live`が結果の描画を停止した場合の確認方法を示します。実Vertex AIまたは
BigQueryを再実行する前に、画面のエラーと生成済みSQLを確認してください。

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

## 同一ページの反復を分析したい

再読み込み、フォームエラー、SPA内の状態変化は通常のページ回遊とは異なる分析契約が必要です。
将来の分析計画では`page_view_occurrence`、`form_attempt`、`spa_state`を遷移単位として選ぶ方針ですが、
このデモでは未実装です。通常の回遊Sankeyから意味検証を外して代用しないでください。
