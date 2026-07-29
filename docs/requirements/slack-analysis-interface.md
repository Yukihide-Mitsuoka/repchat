---
id: slack-analysis-interface-requirements
title: Slack分析インターフェース要件
status: draft
updated: 2026-07-30
---

# Slack分析インターフェース要件

## 1. 目的

Slackを、Web版RepChatと同じ分析パイプラインを起動・確認する任意の入口にする。利用者は許可された
チャンネルで日本語の目的を相談し、進捗、要約、グラフまたは認証付きダッシュボードリンクを受け取る。
ダッシュボード、SQL、指標定義、来歴を確認する正本UIはWebに置く。

Slack対応自体は競合が模倣できる配信経路であり、差別化とは扱わない。価値は、日本語で「何を分析
すべきか」を定義し、複数顧客を持つ代理店の認可境界内で、検証済み結果まで一貫して届けることに置く。

関連Issue: [#187](https://github.com/Yukihide-Mitsuoka/repchat/issues/187)

## 2. 前提と境界

- Slackは入出力アダプターであり、SQL実行基盤、renderer、成果物の正本、認証基盤にしない。
- 日本語対話から分析仕様、SQL、検証、実行、ArtifactBundle、build、result revisionへ進む既存pipelineを再利用する。
- Slack OAuthはSlack API利用を許可するだけで、RepChatのテナントデータ参照権を与えない。
- Slackへ投稿したグラフや数値はSlack側の保持・共有対象になる「データexport」である。
- 任意の独自スキーマへの自由質問は、未知ネストスキーマ検証
  [#188](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)の合格後にだけ有効化する。
- 検証済みrevisionの通知pilotは、自由質問の生成pilotから分離して先行できる。

## 3. 初期スコープ

### 対象

- 管理者によるSlack workspace接続、bot install、許可チャンネル設定
- 許可チャンネルでのbot mentionとthread内の確認質問
- 分析仕様の確認後に非同期jobを開始し、同じthreadへ状態を通知
- 単一分析は短い要約と任意のグラフ、複数分析は要約と認証付きdashboard linkを返す
- revision、依頼者、tenant、channel、出力先、job状態を監査する

### 初期対象外

- DM、Slack Connect、全チャンネルの常時監視
- Slack内だけでのSQL編集、dashboard閲覧、認可管理
- 未検証スキーマへのbest-effort SQL実行
- 定期配信や異常検知によるproactive通知（初期pilot後に別要件化）

## 4. 機能要件

| ID | 要件 |
|---|---|
| SL-FR-001 | 管理者だけがOAuthを開始し、workspaceとRepChat organizationを接続できる。OAuth stateを検証する。 |
| SL-FR-002 | `team_id + channel_id`をtenantへ明示対応付けする。workspaceだけをtenant境界にしない。 |
| SL-FR-003 | Slack userをRepChat userへ対応付け、両方の所属・権限が通った場合だけjobを受け付ける。 |
| SL-FR-004 | 初期pilotは許可チャンネルの`app_mention`だけを受け付け、署名と時刻を検証する。 |
| SL-FR-005 | eventを3秒以内にackし、重い処理はqueueへ渡す。`event_id`と`job_id`で重複実行を防ぐ。 |
| SL-FR-006 | 目的、読者、期間、指標、比較対象、未確定事項を既存の分析仕様へ構造化し、確定前は有料queryやbuildを開始しない。 |
| SL-FR-007 | 対応スキーマ契約が無い、または意味が不足する場合は確認質問か拒否を返し、列名から推測して実行しない。 |
| SL-FR-008 | 受付、確認待ち、生成、検証、実行、build、完了、失敗を同じthreadへ更新する。 |
| SL-FR-009 | 完了通知はimmutableなresult revisionを指し、Web側で現在も認可される利用者だけが開ける。 |
| SL-FR-010 | 既定出力は機密値を含まない要約とlinkだけとし、グラフ・数値の投稿はtenant単位のopt-inとする。SQLは投稿しない。 |
| SL-FR-011 | 汎用link unfurlで保護dashboardの内容を展開しない。Slack内表示は専用の認可済み応答だけで行う。 |
| SL-FR-012 | LLM、BigQuery、Evidence、Slackの障害時も既存Webとlast-known-good revisionの閲覧へ影響させない。 |

## 5. 認可とテナント分離

1. Slack署名、request時刻、install状態を検証する。
2. `team_id + channel_id`からサーバー側でtenantを解決する。
3. Slack userとRepChat userを対応付け、organization membershipとroleを検証する。
4. 既存の認可contextを発行し、以降はWebと同じtenant分離、dataset権限、監査を通す。
5. 出力時にも送信先channel、tenant、revisionの組を再検証する。

代理店workspaceに複数顧客のchannelがある前提で、workspace単位の暗黙tenant選択は禁止する。DMと
Slack Connectはchannel参加者とtenantの関係が曖昧になるため、別ADRなしには有効化しない。

## 6. 非機能要件

| ID | 要件 |
|---|---|
| SL-NFR-001 | Events APIへのackはp95 3秒未満。分析完了時間は各pipelineのSLOを表示する。 |
| SL-NFR-002 | signing secret、OAuth tokenをsecret storeに置き、ログ、Git、ArtifactBundleへ出さない。 |
| SL-NFR-003 | retry、重複event、worker再起動でも同一依頼を二重実行・二重課金しない。 |
| SL-NFR-004 | actor、workspace、channel、tenant、job、revision、出力種別、結果を改ざん検知可能な監査ログに残す。 |
| SL-NFR-005 | status文とグラフの代替テキストを平易な日本語で提供する。 |
| SL-NFR-006 | Slack固有処理をadapterへ閉じ込め、分析domainとrendererにSlack SDK型を漏らさない。 |

## 7. 受入条件

- 未許可channel、未対応user、別tenantのrevision、改ざん署名をすべて拒否できる。
- 同一eventを複数回受けても、BigQuery実行、build、Slack投稿がそれぞれ一度だけになる。
- protected dashboardのlinkを貼っても、汎用unfurlで数値やグラフが漏れない。
- Slack停止中もWebとlast-known-good dashboardを閲覧でき、復旧後に安全に再通知できる。
- 投稿した全グラフ・数値をSlack exportとして監査・説明できる。
- 独自ネストスキーマの自由質問は#188未合格時に実行されず、確認または非対応が明示される。
- design partnerが主要4シナリオ中4件以上を支援なしで完了し、誤tenant送信が0件である。

## 8. 導入順

1. ADR-0017承認、design partnerのSlack利用と出力許容範囲を確認する。
2. Web認証とrevision URLを完成させ、既存の検証済みrevisionをlink通知するpilotを行う。
3. Issue #180の対話型分析仕様とIssue #188の未知ネストスキーマgateを満たす。
4. 許可チャンネルのmentionから分析jobを起動するpilotを行う。
5. 実測で必要なら定期配信、異常検知、DM、Slack Connectを別設計する。

## 9. 参照

- [Slack Events API](https://docs.slack.dev/apis/events-api/)
- [Slack request署名検証](https://docs.slack.dev/authentication/verifying-requests-from-slack/)
- [Slack OAuth](https://docs.slack.dev/authentication/installing-with-oauth/)
- [Slack Block Kit](https://docs.slack.dev/block-kit/)
- [Slack link unfurl](https://docs.slack.dev/messaging/unfurling-links-in-messages/)
- [Slack file upload](https://docs.slack.dev/messaging/working-with-files/)
- [ADR-0017](../adr/0017-use-slack-as-an-authorized-analysis-interface.md)
