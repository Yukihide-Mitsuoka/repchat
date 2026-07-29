---
id: development-handoff
title: 開発引き継ぎ
status: active
updated: 2026-07-30
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

**現在の作業**は[Issue #190](https://github.com/Yukihide-Mitsuoka/repchat/issues/190) /
[PR #191](https://github.com/Yukihide-Mitsuoka/repchat/pull/191)。
デモのSQL表示を構文階層ごとの0、4、8、12...スペースへ正規化する。完了後は
[Issue #160](https://github.com/Yukihide-Mitsuoka/repchat/issues/160)へ戻り、デザインパートナーへ
[5分デモ](demo.md)を見せて価値仮説と価格感を検証する。

デモ画面の情報配置は[Issue #184](https://github.com/Yukihide-Mitsuoka/repchat/issues/184) /
[PR #185](https://github.com/Yukihide-Mitsuoka/repchat/pull/185)で、2026-07-30にmerge済み。6設問それぞれの
実クエリ結果を、分析結果／生成プロセス・SQLと同じタブ群の3つ目「集計データ」へ配置した。

将来のSlack分析UIは[Issue #187](https://github.com/Yukihide-Mitsuoka/repchat/issues/187) /
[PR #189](https://github.com/Yukihide-Mitsuoka/repchat/pull/189)と
[ADR-0017](adr/0017-use-slack-as-an-authorized-analysis-interface.md)で設計中。Slackは既存pipelineへの
認可付きadapterとし、Webを正本UIにする。公開GA4での成功は未知の独自nested schemaへの一般化を
証明しないため、自由質問の実装前に[Issue #188](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)を
合格させる。検証済みrevisionのlink通知pilotは分離して先行できる。

**直前の作業**は[Issue #178](https://github.com/Yukihide-Mitsuoka/repchat/issues/178) /
[PR #182](https://github.com/Yukihide-Mitsuoka/repchat/pull/182)で、2026-07-30にmerge済み。
生成SQLの実行原文を変えずに表示だけを整形し、対面デモを
分析単位の結果／生成プロセス・SQLタブへ再構成する。購入KPI、リピート率、平均エンゲージメント、
購入ファネル、日次＋7日移動平均、入口から3ページ目までの主要回遊Sankeyを扱い、SQLはSELECT列・
主要句単位で整形する。Sankeyを含む6問版は実Vertex AI・BigQueryで6/6、推定¥1.285、
R17の12 edge materialize、production build・ブラウザ描画、横スクロール、error/warning 0まで確認した。
後続調査でSQLに`sqlparse`の予約語幅による1〜3文字等の位置合わせが残ると判明し、Issue #190で是正中。
ただし公開GA4 schema固有の実測であり、未知nested schemaは未検証。
製品版の閲覧／SQL面分離、
目的を分解してKPI・複数グラフ・1画面前後の読順を設計する対話build、AI会議所見はIssue #179〜#181。

その前の[Issue #173](https://github.com/Yukihide-Mitsuoka/repchat/issues/173) /
[PR #175](https://github.com/Yukihide-Mitsuoka/repchat/pull/175)で、2026-07-29にmerge済み。
日本語1問からVertex AI生成SQL、BigQuery実行、Evidence描画までを画面内で追跡できる。
BigQuery SQLとEvidenceローカルSQLは必要列を明示し、生成BigQuery SQLの`SELECT *`は実行前に
拒否する。実Vertex AI・BigQueryで1/1、参照値118,380との一致、Vertex AI推定¥0.154、
Evidence materialize/build、ブラウザ表示、browser error/warning 0を確認し、CIも12/12成功した。

進行中の作業、ブロッカー、次のアクション、検証済みの基準点が変わった場合は
`docs/status.md`を更新します。この文書は正本の場所または再開順序が変わった場合だけ更新します。
