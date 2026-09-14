---
id: demo
title: 分析デモの現在地
updated: 2026-09-14
---

# 分析デモの現在地

現在、実行可能な分析デモはありません。旧デモは分析対象ごとのprofile、手書きschema・指標・期間規則、
固定された補正処理に依存しており、「認可済み接続scopeを渡すだけで任意の分析対象へ適用できる」という
製品要件を満たさないため削除しました。互換用の起動コマンドや対象別fallbackも残していません。

再びデモを提供する条件は、次の一つの経路が成立することです。

1. 認可済みのBigQuery scopeからcatalog、schema、partition、bounded value profileを取得する。
2. 対象名や登録済みprofileを使わずcanonical analysis contractを生成する。
3. planner、SQL生成、dry run、実行、結果形状検査が同じcontract fingerprintを参照する。
4. 未知の分析対象を、repository・prompt・設定・指標定義の変更なしで処理する。
5. 契約を生成できない場合は、既知対象の処理へ戻らずfail closedにする。

現在の実装境界は[レポート生成スパイク](../spikes/report-generation/README.md)、禁止事項と再開順は
[開発引き継ぎ](development-handoff.md)、設計判断は
[ADR-0025](adr/0025-discover-analysis-contracts-without-source-specific-code.md)を参照してください。

実Vertex AI・BigQueryを使う再検証は、上記の対象非依存runtime entryが完成し、費用が明示的に承認された後に
行います。それまでは削除済みの旧デモを復元しません。
