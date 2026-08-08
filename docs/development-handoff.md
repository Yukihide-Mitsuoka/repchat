---
id: development-handoff
title: 開発引き継ぎ
status: active
updated: 2026-08-02
---

# 開発引き継ぎ

この文書は、人またはAIが前回の対話なしでRepChatの開発を再開するための入口です。
実装状態の正本は[実装状況サマリー](status.md)、優先順位の正本は[ロードマップ](roadmap.md)、
各タスクの受入条件はGitHub Issueです。この文書には再開に必要な参照順と分岐だけを置きます。

## 現在の作業と停止条件

| 項目 | 現在地 |
|------|--------|
| 作業 | [Issue #257](https://github.com/Yukihide-Mitsuoka/repchat/issues/257) — 組織コンテキストを分析レシピ・指標定義・個人設定と分離し、#180と#181が同じ承認済みrevisionを参照する要件を明文化する。SQLハイライトはPR #256でレビュー待ち |
| デモ準備 | `make demo-live PROJECT=<project>`は、ダッシュボード生成／単一グラフ生成を切り替える。ダッシュボードは6パネル、単一グラフは「グラフ」と「取得データ」を切り替えられる。起動表示と固定応答を確認済み。質問送信は費用を再提示して承認後だけ行う |
| オーナー作業 | 日本の小規模代理店またはソフトウェアベンダーから参加者を1名以上選定し、日程を決める |
| AIができること | オーナーが2026-08-02に優先したデモ／設計検証として、#255、組織コンテキストのメモリー要件、#188の非GA4公開nested dataset 1種類、#180と#181の明示的な未検証プロトタイプを小さいPRに分けて進める。実データ再実行は費用を再提示してオーナー承認後だけ行う |
| 停止条件 | Issue #160の実施結果を`proceed` / `revise` / `reject`に分類するまで製品実装を開始しない。GitHub App、artifact pipeline、#179以降の製品UXを先行実装しない |
| 完了時 | 証拠を`proceed` / `revise` / `reject`に分類し、Issue #160と[status](status.md)を更新する。方向が変わる場合だけpositioning、ADR、decision logを更新する |

## 最初に読む順序

1. [status §0](status.md#0-再開手順新しいaiセッション向け)と
   [§1](status.md#1-一行でいうと)で、実装済み範囲、費用、未検証事項を確認する。
2. [positioning §0](positioning.md#0-前提の確認--勝負の土俵)、
   [§2.7〜2.9](positioning.md#27-入口は既存の手作業レポートにする)、
   [§5](positioning.md#5-未検証の仮説と検証方法)で、対象顧客、差別化、検証対象を確認する。
3. [roadmap](roadmap.md)で実施順序を確認する。
4. 下の設計判断索引から、変更対象に関係するADRを全文読む。
5. デモを扱う場合だけ[デモ手順](demo.md)と
   [report-generation spike](../spikes/report-generation/README.md)を読む。

## 次タスクの分岐

| 条件 | 次の作業 | 先に読む正本 |
|------|----------|--------------|
| 現在 | [#160 デザインパートナー検証](https://github.com/Yukihide-Mitsuoka/repchat/issues/160)。参加者選定・日程調整はオーナー作業。#253完了後はコード実装を増やさず、この検証結果を`proceed` / `revise` / `reject`に分類する | [demo](demo.md)、[roadmap](roadmap.md) |
| #160が`proceed` | [#188 未知nested schema品質検証](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)と[#179 閲覧／SQL来歴UX設計](https://github.com/Yukihide-Mitsuoka/repchat/issues/179)を独立した作業として開始できる | ADR-0013、ADR-0015、各Issueの受入条件 |
| #179と#188が完了 | [#180 対話による分析仕様確定とbuild](https://github.com/Yukihide-Mitsuoka/repchat/issues/180) | #179の設計成果、ADR-0013/0015 |
| #180でanalysis specification revision契約を確定 | Issue #160が`proceed`なら、適応型分析メモリーPhase 1の実装Issueを作る | [適応型分析メモリー要件](requirements/adaptive-analysis-memory.md)、ADR-0018。初期は手動方針・承認・表示・取消だけ |
| 統制された生成・公開経路が安定 | [#181 根拠付き経営報告](https://github.com/Yukihide-Mitsuoka/repchat/issues/181) | #180のrevision契約、SQL来歴・検証結果 |
| 課金または本番オンボーディングへ着手 | [#194 課金区分と認証方式のオーナー決定](https://github.com/Yukihide-Mitsuoka/repchat/issues/194)を専用grill-meで先に完了する。現在のデモはblockしない | [mission](../.ai/mission.md)、[positioning §6](positioning.md#6-missionmd-との残る不一致未解消) |
| Slack利用が実顧客で確認された | オーナーがADR-0017を承認した後、検証済みrevisionのlink通知pilot用Issueを作る | ADR-0017。自由質問は#180と#188の完了後 |
| HTTPテストの同時失敗が再発、または保守作業が明示的に優先された | [#169 serve round-trip flake調査](https://github.com/Yukihide-Mitsuoka/repchat/issues/169) | 失敗時の未省略ログ。再試行やassertion緩和は禁止 |

`#160`が`revise`または`reject`の場合は、上表の製品タスクへ進まず、観測結果に基づいて
positioningとroadmapを再評価します。

## 次にやる順序（2026-08-02）

1. **現在:** [#255 SQLシンタックスハイライト](https://github.com/Yukihide-Mitsuoka/repchat/issues/255)を完了する。
2. **次:** 適応型分析メモリー要件で、承認済みの組織コンテキストを分析レシピと個人設定から明確に分離し、#180と#181が同じrevisionを参照する契約を明文化する。
3. **レビュー待ち:** [#188 未知nested schema品質検証](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)の最初の縦切りとして、非GA4のBitcoin公開nested/repeated datasetをライブデモへ追加した。基準SQLのdry runは約2.91GiB。実値照合・独立レビュー・2種類評価は未完了なのでIssueは閉じない。
4. **レビュー待ち:** [#180 対話による分析仕様確定とbuild](https://github.com/Yukihide-Mitsuoka/repchat/issues/180)のローカル未検証プロトタイプとして、目的→最大3確認→仮説・KPI・パネル提案→編集→revision freeze→別費用確認→buildを接続した。候補6件、fixture組織コンテキスト、同期buildの限界を維持する。
5. **次:** [適応型分析メモリー要件](requirements/adaptive-analysis-memory.md)のrevisionを引き継いで[#181 根拠付き経営報告](https://github.com/Yukihide-Mitsuoka/repchat/issues/181)のローカル未検証プロトタイプへ進む。
5. **並行するオーナー作業:** 初期主要顧客の定義に合う日本の小規模代理店またはソフトウェアベンダーから参加者を選び、#160の5分デモ日程を決める。#160が`proceed`になるまで、上記プロトタイプを製品実装または検証済み能力とは表明しない。
この順序より前に、本番認証・GitHub App・顧客Git配送・Slack自由質問を先行実装しない。[#194](https://github.com/Yukihide-Mitsuoka/repchat/issues/194)の課金区分とエンドユーザー認証は、本番オンボーディングへ進む直前に専用grill-meで確定する。

## 設計判断の索引

| 論点 | 状態 | 正本 |
|------|------|------|
| 主要顧客と販売経路 | 確定。代理店・ソフトウェアベンダーが初期主経路、直販はフォールバック | [mission](../.ai/mission.md)、[positioning §0](positioning.md#0-前提の確認--勝負の土俵) |
| テナント分離と接続主体 | accepted。接続主体はテナント単位の機械IDで、人間の認証主体と分離 | [ADR-0005](adr/0005-cache-and-authorization-architecture.md)、[ADR-0010](adr/0010-connection-identity-is-never-a-person.md) |
| 指標定義 | accepted。意味と出力形状をこちら側で定義し、未定義語は確認または拒否 | [ADR-0013](adr/0013-metric-definitions-live-in-our-own-layer.md) |
| 生成物の所有 | accepted。ページ・SQL・manifestは顧客Git、共有指標定義はこちら側 | [ADR-0014](adr/0014-who-owns-the-generated-artifacts.md) |
| Git配送と閲覧 | accepted。Gitはbuild時だけ使用し、閲覧経路へ入れない。GitHub/managedは同じpipelineの保存先adapter | [ADR-0015](adr/0015-publish-artifacts-through-customer-git.md) |
| Slack | proposed。Webを正本UIとする認可付きadapter案。オーナー承認前は実装禁止 | [ADR-0017](adr/0017-use-slack-as-an-authorized-analysis-interface.md) |
| 適応型分析メモリー | accepted。生の会話ではなくscope・権限・revision・期限を持つ方針をPostgresの正本で管理し、AIは候補を作るが自動昇格しない | [要件](requirements/adaptive-analysis-memory.md)、[ADR-0018](adr/0018-govern-adaptive-analysis-memory.md) |
| 接続先・テーブル選択 | 将来設計。ユーザーに任意のdataset/tableを列挙させず、管理者が承認したデータソース・分析領域・テーブルカタログからサーバー側で解決する | [ADR-0005](adr/0005-cache-and-authorization-architecture.md)、[ADR-0010](adr/0010-connection-identity-is-never-a-person.md)、#180 |
| 課金区分・エンドユーザー認証 | 未決。AIは推測しない | [Issue #194](https://github.com/Yukihide-Mitsuoka/repchat/issues/194) |

## 誤って前提にしてはいけないこと

- ローカルデモは`spikes/`内にあり、本番の認証、gate、executor、顧客Git配送を通らない。
- 公開GA4の成功は未知の独自nested/repeated schemaへの対応を証明しない。
- 生成SQLの構文は毎回同じでなくてよい。指標の意味、出力形状、既知値照合を固定する。
- 生の会話履歴、生成SQL、query resultは分析方針メモリーの正本ではない。類似度を認可境界に使わない。
- BigQuery SQLとEvidence SQLの双方で必要列を明示し、`SELECT *`を生成しない。
- 顧客Gitをページ表示時に参照せず、失敗したbuildを有効化しない。
- `make demo`は実Vertex AIとBigQueryを使う。実行前に費用を明示し、オーナーの同意を得る。
- 測っていない結果、独自schema品質、更新SLO、製品統合状態を実証済みと書かない。

この文書は、現在のIssue、停止条件、次タスクの分岐、または設計判断の正本が変わったときに更新します。
