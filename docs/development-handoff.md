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

**直前の作業**は[Issue #173](https://github.com/Yukihide-Mitsuoka/repchat/issues/173) /
[PR #175](https://github.com/Yukihide-Mitsuoka/repchat/pull/175)で、2026-07-29にmerge済み。
日本語1問からVertex AI生成SQL、BigQuery実行、Evidence描画までを画面内で追跡できる。
BigQuery SQLとEvidenceローカルSQLは必要列を明示し、生成BigQuery SQLの`SELECT *`は実行前に
拒否する。実Vertex AI・BigQueryで1/1、参照値118,380との一致、Vertex AI推定¥0.154、
Evidence materialize/build、ブラウザ表示、browser error/warning 0を確認し、CIも12/12成功した。
次は[Issue #160](https://github.com/Yukihide-Mitsuoka/repchat/issues/160)に戻り、
デザインパートナーへ[5分デモ](demo.md)を見せる。

進行中の作業、ブロッカー、次のアクション、検証済みの基準点が変わった場合は
`docs/status.md`を更新します。この文書は正本の場所または再開順序が変わった場合だけ更新します。
