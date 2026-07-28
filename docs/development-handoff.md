---
id: development-handoff
title: 開発引き継ぎ
status: active
updated: 2026-07-29
---

# 開発引き継ぎ

この文書は、人またはAIが前回の対話なしでRepChatの開発を再開するための入口です。
現在状態の正本は、既存の[実装状況サマリー](status.md)です。情報を重複させず、次の順で
正本を確認してください。

1. [再開手順と現在の作業](status.md#0-再開手順新しいaiセッション向け) ——
   **§0が現在地と次の作業**、**§0.2が手を動かす前に知っておくこと**
2. [現在地](status.md#1-一行でいうと)
3. [ロードマップ](roadmap.md)
4. [新しい順の意思決定ログ](../.ai/decision-log.md)
5. 実験を再現するなら `spikes/*/README.md`。レポート生成は
   [spikes/report-generation/](../spikes/report-generation/README.md)

**現在のarchitecture follow-up**は
[Issue #158](https://github.com/Yukihide-Mitsuoka/repchat/issues/158)。
[ADR-0015](adr/0015-publish-artifacts-through-customer-git.md)で、顧客Gitをbuild時だけ使う
GitHub App接続と共通artifact pipelineを確定した。実装より先に、次はデザインパートナーへ
[5分デモ](demo.md)を見せる。

進行中の作業、ブロッカー、次のアクション、検証済みの基準点が変わった場合は
`docs/status.md`を更新します。この文書は正本の場所または再開順序が変わった場合だけ更新します。
