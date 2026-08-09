---
id: development-handoff
title: 開発引き継ぎ
status: active
updated: 2026-08-09
---

# 開発引き継ぎ

この文書は、人またはAIが前回の対話なしでRepChatの開発を再開するための入口です。
実装状態の正本は[実装状況サマリー](status.md)、優先順位の正本は[ロードマップ](roadmap.md)、
各タスクの受入条件はGitHub Issueです。この文書には再開に必要な参照順と分岐だけを置きます。

## 現在の作業と停止条件

| 項目 | 現在地 |
|------|--------|
| 作業 | [Issue #292](https://github.com/Yukihide-Mitsuoka/repchat/issues/292) — 会議報告の項目数・文字数を制限し、出力上限または不完全JSONを安定した日本語エラーとして判定する修正 |
| デモ実行状態 | #292の作業開始時に旧プロセスを停止した。修正PR作成前に現在ブランチから`http://127.0.0.1:8765/`を再起動する。今回の実会議報告生成は再実行していない |
| 直近完了 | [PR #290](https://github.com/Yukihide-Mitsuoka/repchat/pull/290)はmerge済み。#292では実際と同じ不完全JSONをfailing-first testで再現し、生成schemaと受理時検証の上限、`MAX_TOKENS`判定、不完全JSONの日本語エラーを実装した |
| オーナー作業 | 日本の小規模代理店またはソフトウェアベンダーから参加者を1名以上選定し、日程を決める |
| AIができること | Issue #292の固定応答テストを無料で検証しPR化する。実Vertex AI相談、BigQuery build、会議報告生成はそれぞれ費用を提示し、オーナー承認後だけ実行する |
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

## 直近の生成エラー

2026-08-09に、確定済みダッシュボードから会議報告案を生成すると、Vertex AI呼出し後に
`Unterminated string starting at: line 1 column 30 (char 29)`で停止した。`/api/report`はHTTP 200で、
BigQueryは再実行していない。原因と受入条件の正本は
[Issue #292](https://github.com/Yukihide-Mitsuoka/repchat/issues/292)。報告schemaに配列件数・文字数の
上限がなく、4,096 output tokensで完了しない応答をfinish reason確認なしで`json.loads`へ渡していた。
修正後も自動再実行はせず、今回の実生成が成功するかは費用を再承認した後だけ確認する。

## 次タスクの分岐

| 条件 | 次の作業 | 先に読む正本 |
|------|----------|--------------|
| 現在のデモ改善 | [#292 会議報告JSONの出力制限と診断](https://github.com/Yukihide-Mitsuoka/repchat/issues/292)。会議用の件数・文字数へ制限し、出力上限と不完全JSONを区別してfail closedにする | #292、`meeting_report.py`、meeting-report/live-demo tests |
| #292 merge後 | 最新mainから`make demo-live PROJECT=<project>`で再起動する。まずHTTP 200と固定応答テストを無料で確認する | [デモ手順](demo.md)、[トラブルシューティング](troubleshooting/live-demo.md) |
| 固定応答確認後 | 実Vertex AI相談の費用を提示して承認を得てから同じ依頼を1回実行する。相談成功後のBigQuery buildは別の費用確認とし、同時に承認された扱いにしない | #273、#180 |
| デモ阻害解消後 | [#160 デザインパートナー検証](https://github.com/Yukihide-Mitsuoka/repchat/issues/160)。参加者選定・日程調整はオーナー作業。5分デモ後に結果を`proceed` / `revise` / `reject`へ分類する | [demo](demo.md)、[roadmap](roadmap.md) |
| #160が`proceed` | [#188 未知nested schema品質検証](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)と[#179 閲覧／SQL来歴UX設計](https://github.com/Yukihide-Mitsuoka/repchat/issues/179)を独立した作業として開始できる | ADR-0013、ADR-0015、各Issueの受入条件 |
| #179と#188が完了 | [#180 対話による分析仕様確定とbuild](https://github.com/Yukihide-Mitsuoka/repchat/issues/180) | #179の設計成果、ADR-0013/0015 |
| #180でanalysis specification revision契約を確定 | Issue #160が`proceed`なら、適応型分析メモリーPhase 1の実装Issueを作る | [適応型分析メモリー要件](requirements/adaptive-analysis-memory.md)、ADR-0018。初期は手動方針・承認・表示・取消だけ |
| 統制された生成・公開経路が安定 | [#181 根拠付き経営報告](https://github.com/Yukihide-Mitsuoka/repchat/issues/181) | #180のrevision契約、SQL来歴・検証結果 |
| 課金または本番オンボーディングへ着手 | [#194 課金区分と認証方式のオーナー決定](https://github.com/Yukihide-Mitsuoka/repchat/issues/194)を専用grill-meで先に完了する。現在のデモはblockしない | [mission](../.ai/mission.md)、[positioning §6](positioning.md#6-missionmd-との残る不一致未解消) |
| Slack利用が実顧客で確認された | オーナーがADR-0017を承認した後、検証済みrevisionのlink通知pilot用Issueを作る | ADR-0017。自由質問は#180と#188の完了後 |
| HTTPテストの同時失敗が再発、または保守作業が明示的に優先された | [#169 serve round-trip flake調査](https://github.com/Yukihide-Mitsuoka/repchat/issues/169) | 失敗時の未省略ログ。再試行やassertion緩和は禁止 |

`#160`が`revise`または`reject`の場合は、上表の製品タスクへ進まず、観測結果に基づいて
positioningとroadmapを再評価します。

## 次にやる順序（2026-08-09）

1. **現在:** [Issue #292](https://github.com/Yukihide-Mitsuoka/repchat/issues/292)の無料テストを完了し、PRを作成する。
2. **次:** #292 merge後に最新mainからデモを再起動する。会議報告の実再生成はVertex AI費用（画面上限目安約¥5）を再提示し、承認後に1回だけ確認する。
3. **オーナー承認後:** 実Vertex AI相談を1回確認する。成功後、別の費用確認を経てダッシュボードbuildを実行し、連続同一ページ統合後のR17参照値、色、リンク値、2ページ目終了注記、取得データを確認する。
4. **並行するオーナー作業:** [#160](https://github.com/Yukihide-Mitsuoka/repchat/issues/160)の参加者を選定して日程を決める。デモ阻害を解消後に5分デモを行い、`proceed` / `revise` / `reject`へ分類する。
5. **未完の検証:** [#188](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)はBitcoin 1種類の縦切りと予約語修正まで完了したが、実値照合、独立レビュー、未知・非公開相当2種類の評価が残る。
6. **製品化前提が整った後:** [#179](https://github.com/Yukihide-Mitsuoka/repchat/issues/179)の閲覧／SQL来歴UX、[#180](https://github.com/Yukihide-Mitsuoka/repchat/issues/180)の非同期・再開可能なbuild、[#181](https://github.com/Yukihide-Mitsuoka/repchat/issues/181)の承認・監査付き報告、[#251](https://github.com/Yukihide-Mitsuoka/repchat/issues/251)の配布artifact定義を各Issueの受入条件で進める。現在mainにある#180/#181はローカル未検証プロトタイプであり、Issue完了ではない。

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
