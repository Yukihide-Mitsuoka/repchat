---
id: troubleshooting-live-demo
title: 旧ライブデモの廃止
updated: 2026-09-14
---

# 旧ライブデモの廃止

`make demo`、`make demo-live`、`live_demo.py`、`verify_live_services.py`は廃止しました。
旧経路が分析対象ごとのprofile、schema、期間parser、SQL補正、既定値を必要とし、任意の分析対象へ設定なしで
適用できなかったためです。これは一時的な起動障害ではなく、誤った製品境界を残さないための意図的な削除です。

## 復元しないもの

- 対象名で選ぶprofile registry
- 対象ごとのPython module、prompt、SQL、期間parser、識別子補正
- 手書きの指標・意味定義file
- 旧requestや保存planを受理する互換adapter
- 契約取得失敗時に既知対象へ戻るfallback

## 現在確認できること

対象非依存の境界はunit testで検証します。

```bash
make test-unit
```

再混入防止testはruntime sourceを走査し、対象名、既知dataset、profile API、固定schema・metric資産、
埋め込みSQL／DDL、対象別module・設定資産のinventoryが空であることを要求します。

## 次の実行経路

次のruntime entryは、認可済みconnection scopeから自動発見したmetadataをcanonical analysis contractへcompileし、
そのcontractだけをplanner、SQL生成、検証、実行へ渡します。未知のscopeで契約を作れない場合は共通診断で停止し、
旧デモや対象別処理へは戻りません。

進捗と再開順は[開発引き継ぎ](../development-handoff.md)、設計上の拘束は
[ADR-0025](../adr/0025-discover-analysis-contracts-without-source-specific-code.md)を参照してください。
