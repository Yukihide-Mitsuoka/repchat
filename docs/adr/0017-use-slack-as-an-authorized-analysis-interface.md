---
id: adr-0017
title: Slackを認可付き分析インターフェースとして使う
status: proposed
date: 2026-07-30
deciders: repository owner
---

# ADR-0017: Slackを認可付き分析インターフェースとして使う

## Context

主要顧客である代理店は複数顧客との業務をSlackで進める可能性がある。RepChatのWebを開かず、
Slackで日本語の分析目的を相談し、グラフまたはdashboard linkを受け取れれば導入摩擦を下げられる。

ただしSlackを独立したbotとして実装すると、Webとは別の生成、認可、監査、成果物管理が生まれる。
workspace内に複数顧客のchannelがある場合、workspaceをtenantとみなす設計はデータ漏洩につながる。
また、Slackへ投稿した数値や画像はSlack側の保持・共有範囲へ複製される。

Evidence CloudはすでにSQLとMarkdownからdata productを生成し、AI Chat、RLS、page access、embeddingを
提供している。Slackという入口だけでは持続的な差別化にならない。加えて、現行のNL→SQL実測は公開
GA4スキーマに強く依存し、未知の独自ネストスキーマへの一般化は未検証である（Issue #188）。

## Decision

Slackを、既存の分析pipelineへ接続する**任意の認可付きinterface adapter**として採用する。
Slack固有の分析engine、renderer、成果物storeは作らない。

### D1. Webを正本UIとする

dashboard、SQL、指標定義、data lineage、revision、詳細な認可操作はWebで表示する。Slackは相談、
進捗、短い要約、任意のpreview、認証付きlinkに限定する。

### D2. 既存pipelineを一つだけ持つ

Slack入力もWeb入力も、分析仕様の確認、SQL生成、検証、実行、ArtifactBundle、build、immutable result
revisionという同一pipelineを通す。Slack障害はWebとlast-known-good revisionへ波及させない。

### D3. channelとuserの二段階認可を行う

`team_id + channel_id`をtenantへ明示対応付けし、Slack userもRepChat userへ対応付ける。両方と既存role
認可が通った場合だけjobを開始する。workspace単位の暗黙tenant選択は禁止する。

### D4. 初期pilotを許可channelのmentionに限定する

DM、Slack Connect、全message監視は初期対象外とする。Events API requestを署名・時刻で検証し、3秒
以内にackして非同期queueへ渡す。`event_id`と`job_id`でidempotencyを担保する。

### D5. Slack投稿をdata exportとして扱う

既定は機密値を含まない要約とlinkだけとする。グラフ・数値の投稿はtenant管理者のopt-in、出力先
allowlist、監査、保持方針の説明を必須とする。SQLは投稿しない。protected linkの汎用unfurlは無効にする。

### D6. 未知スキーマを推測実行しない

対応スキーマ契約と指標定義が無い場合は確認質問または拒否を返す。任意の独自ネストスキーマからの
自由質問はIssue #188の事前合格基準を満たすまで有効化しない。既存の検証済みrevisionを通知するpilotは
このgateと分離して先行できる。

### D7. Slackそのものを差別化と表現しない

差別化仮説は、日本語で分析目的を分解すること、代理店の複数顧客境界を守ること、指標定義と検証結果を
revisionへ結び付けること、WebとSlackで同じ監査可能なworkflowを提供することに置く。

## Options considered

### 1. Slack対応をしない

最小だが、design partnerがSlack中心なら日常業務への導入仮説を検証できないため不採用。

### 2. 独立したSlack分析botを作る

短期demoは作りやすいが、認可、生成品質、監査、成果物が二重化し、Webとの結果差異が生まれるため不採用。

### 3. 既存pipelineへの認可付きadapterにする

初期の統合作業は増えるが、一つの検証・認可・revisionモデルを維持できるため採用。

## Consequences

- Slackを止めても分析pipelineとdashboard閲覧を継続できる。
- 認証付きWeb URL、user mapping、channel mapping、queue、idempotency storeが先に必要になる。
- 画像投稿は便利さと情報複製のtrade-offになり、既定link-onlyが安全側となる。
- Slackによる自由質問は、対話仕様（Issue #180）と未知ネストスキーマ検証（Issue #188）の後になる。
- DMとSlack Connectを追加する際はtenant選択と参加者認可を別ADRで決める。

## Approval and implementation gate

このADRは**proposed**である。repository ownerの明示承認前にSlack連携を実装しない。承認後も、まず
design partnerの利用実態を確認し、認証済みrevision linkの通知pilotから始める。

## References

- [Slack分析インターフェース要件](../requirements/slack-analysis-interface.md)
- [Issue #187](https://github.com/Yukihide-Mitsuoka/repchat/issues/187)
- [Issue #188](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)
- [ADR-0005](0005-cache-and-authorization-architecture.md)
- [ADR-0015](0015-publish-artifacts-through-customer-git.md)
- [Evidence](https://evidence.dev/)
- [Evidence documentation](https://docs.evidence.dev/)
- [Slack Events API](https://docs.slack.dev/apis/events-api/)
- [Slack request署名検証](https://docs.slack.dev/authentication/verifying-requests-from-slack/)
- [Slack link unfurl](https://docs.slack.dev/messaging/unfurling-links-in-messages/)
