---
id: spike-report-generation
title: 対象非依存の分析契約パイプライン
updated: 2026-09-14
---

# 対象非依存の分析契約パイプライン

このdirectoryは、認可済みのBigQuery接続scopeから分析契約を自動生成し、その一つの契約を分析計画、SQL生成、
実行前検査、実行結果検査へ渡すspikeです。分析対象を識別する名前、登録済みprofile、対象別設定、固定prompt、
固定SQL、期間parser、識別子補正、手書きの指標fileをruntimeに持ちません。

## 製品要件

新しい分析対象を利用するために許される入力は、server側で認可済みのconnection scopeだけです。
repository、prompt、設定、schema定義、metric定義の変更を要求してはいけません。自動発見した情報だけでは安全な
契約を生成できない場合、既知対象の処理へfallbackせずfail closedにします。

利用者確認や手動意味定義は、対象非依存の共通処理をこれ以上改善できない限界が反復評価で示されるまで導入しません。

## 共通経路

1. `bigquery_scope_discovery.py`と`bigquery_schema_snapshot.py`が、認可scope内のmetadataとbounded profileを取得する。
2. `analysis_contract_orchestration.py`、`analysis_contract_generation.py`、`analysis_contract_compiler.py`がcanonical contractを生成する。
3. `analysis_contract_context.py`がcontractからplanner／SQL用の中立な文脈を導出する。
4. `analysis_workflows.py`と`analysis_planner.py`がcontract fingerprintにbindした分析仕様を作る。
5. `sql_generation.py`が確定仕様とcontractだけからSQLを生成する。
6. `contract_sql_validation.py`、`bigquery_execution.py`、`contract_result_validation.py`が同じpolicyと結果形状を検査する。
7. `section_execution.py`と`dashboard_build.py`が、検査を通過した結果だけをbundleへ渡す。

contract fingerprintが欠ける、変更される、または実行policyを導出できない場合は処理を停止します。

## 現在の制約

対象非依存のmodule境界と回帰testはありますが、connection scopeから上記全段をつなぐ実行可能なruntime entryとUIは
まだありません。このため`make demo`や対象別CLIは提供しません。旧デモの互換性も維持しません。

実Vertex AI・BigQueryを使う評価は自動実行しません。費用承認後も、同一binary・prompt・設定で複数の未知schemaを
反復評価し、独立した参照結果と照合できる経路だけを使用します。

## 検証

```bash
make test-unit
```

`source-specific-runtime-ratchet.test.ts`はruntime inventoryが空であることを検査します。対象固有のfixtureや過去の
実験結果は評価資料として残せますが、runtimeからimportしてはいけません。

設計判断は[ADR-0025](../../docs/adr/0025-discover-analysis-contracts-without-source-specific-code.md)、
現在の作業順は[開発引き継ぎ](../../docs/development-handoff.md)を参照してください。
