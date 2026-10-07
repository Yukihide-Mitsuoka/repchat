---
id: nested-reference-contract-audit
title: 配列・多階層参照と汎用分析契約の適合監査
status: active
updated: 2026-10-07
---

# 配列・多階層参照と汎用分析契約の適合監査

配列内fieldを指標へ選ぶ契約表現と、深い列参照のSQL検査に不足があります。
参照計算が一致しても、同じ条件を現在の汎用runtimeで分析できる証拠にはしません。
この監査は製品修正・専用処理・手動意味定義・正式fixture採用を含みません。

## 取得済みmetadataによるoffline確認

[GA4参照案](ga4-reference-preparation.md#metadataと参照案の確認)が使用する元metadata応答4件をhashへ照合し、
型・modeを変更せず公開metadata readerへローカル再生しました。432field tokenのmetadata-only入力をcompilerへ渡し、
正規化・execution policy・生成requestの応答schemaを確認しました。正式discoveryや実AIではありません。

| 確認対象 | 観測結果 | 証明しないこと |
|---|---|---|
| 配列内の`items.quantity`、`event_params.value.string_value` | 末端modeはNULLABLEでも祖先のREPEATEDを継承し、grain・identifier・dimension・measure・metricの全5選択enumから除外 | 配列に関する全SQLが実行不能とはしない |
| 同fieldのSUM／COUNT、measure／dimension候補 | normalizerが4候補を拒否。追加のfilter・exprを含む指標2候補も拒否 | 手動式や専用定義で迂回しない |
| 非配列の`device.category` | dimension・COUNT指標の診断候補を正規化でき、配列path情報も契約へ保持 | 全親記録数や配列内指標の正しい分析契約ではない |
| `SUM(i.quantity)`＋`UNNEST(r.items) AS i` | scalar control契約のschema policyからSQL検査へ通過 | 契約の指標とSQLの意味的一致、BigQuery実値、AI自動生成は未検証 |
| `COUNT(p.value.string_value)`＋`UNNEST(r.event_params) AS p`、`COUNT(r.device.category)` | schema field検査は通るが、上位SQL検査が`table_outside_scope`として拒否 | 対象固有のtable allowlist追加で解消しない |

深い列参照の拒否は[`validate_sql_diagnostic`](../report-generation/bigquery_execution.py)が
3要素のドット区切りをSQL全体からテーブル名として検査するためです。列alias・nested pathも同じ形になり、
認可済み物理tableの列参照と区別していません。後段のschema検査だけが通る結果と分けて保持します。
[`compiler`](../report-generation/analysis_contract_compiler.py)・[normalizer](../report-generation/analysis_contract_response.py)・
[生成入口](../report-generation/analysis_contract_generation.py)の選択制約は、SQL検査の誤認とは別の問題です。

## 記録と次の確認

最初の検算は深いUNNEST列の通過assertionで失敗しました。元script・停止記録を保持し、別の診断で拒否codeを確認後、
新しい操作記録へ現状の不足を保存しました。検算終了を製品の正確性・不足解消・AI品質の合格とは扱いません。
private artifactは`/private/tmp/reference-repeated-contract-OeiTXCI1/`と
`/private/tmp/reference-repeated-contract-final-u2CCnnOG/`です。後者は元応答・参照質問・runtime・元scriptのhashへbindしています。

配列条件・親子粒度・欠落値を保つ元参照案を維持し、親の件数だけへ縮小しません。
次はnative参照と内容reviewを継続し、同じ共通pipelineが必要な配列内指標を生成・検査できるかを別に評価します。
完了条件は[充足性監査](schema-coverage-gap-plan.md#2026-10-07の正解データ充足性監査)のままです。
provider・実AI呼出しは0回で、製品・評価runtime・scorer・scope・IAM・資源・期限は変更していません。
