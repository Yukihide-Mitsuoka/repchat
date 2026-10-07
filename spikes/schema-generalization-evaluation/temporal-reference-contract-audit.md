---
id: temporal-reference-contract-audit
title: 時刻参照と汎用分析契約の適合監査
status: active
updated: 2026-10-07
---

# 時刻参照と汎用分析契約の適合監査

INTEGERで保存された時刻を期間基準・時系列軸に結び付ける契約は、現在の自動生成経路では表現できません。
ただし、整数field自体や日次shardの利用を全面的に拒否するわけではありません。この文書は参照準備の
局所成功と、同じ条件を汎用runtimeで分析できる証明の違いを記録します。専用変換や手動設定は追加しません。

## 2026-10-07のoffline確認

[取得済みGA4 metadata](ga4-reference-preparation.md#metadataと参照案の確認)の4応答を元hashへ照合し、
既存metadata readerの公開入口へローカル再生しました。元schemaの型・modeを変更せず、物理4tableの432field tokenと、
検査用に統合した1shard系列の109tokenをcompilerへ渡しました。実table一覧の再取得・value profile取得は行っていません。
このローカル再生とmetadata-onlyの組立入力を、実共通discoveryが取得した正式snapshotとは扱いません。

| 確認対象 | 公開入口での実測結果 | 判断の範囲 |
|---|---|---|
| `event_timestamp`（INTEGER） | 通常dimension・measure・MAX指標の候補は正規化・execution policy導出に成功 | 数値として参照可能。単位や時刻の意味を自動推論した証拠ではない |
| 同fieldを期間基準にする候補 | normalizerが拒否し、生成requestの時間候補enumにも含まれない | INTEGERから日時への変換を時間契約に結び付ける表現がない |
| `event_date`（STRING） | 通常dimensionは受理、時間候補・lineの時間軸は拒否 | STRINGをDATEとみなす専用解釈はしていない |
| 検査済みshardの`_TABLE_SUFFIX` | 唯一の時間tokenとして期間・DATE dimensionを受理し、lineの時間軸検査に成功 | 標準metadata由来の日付は利用可能。ただしイベント時刻と同じ意味とは証明していない |
| 変換式の手動追加 | 生成候補への追加式と、契約内の偽造式の両方を拒否 | 検算のためにも製品契約を手動変換で迂回しない |

実生成の公開入口にもローカルfake clientを1回通し、時間候補のenumと同じ正規化結果を確認しました。
これは応答schema・境界の検査で、実AI生成やAIの成功率ではありません。拒否候補は4件です。

## scan範囲とイベント時刻は別の確認

同じshard契約から導出した期間制約は、`_TABLE_SUFFIX`のscan範囲1件だけでした。
[`contract_period_diagnostic`](../report-generation/contract_period_validation.py)では、scan範囲だけのSQLと、
それに整数時刻の条件を追加したSQLがどちらも通過しました。整数時刻条件の欠落をこの期間gateは検出しません。
人工2記録でscan内だが時刻区間外の1記録を含めると、scanだけの件数は2、時刻条件付きの件数は1になります。
これは一般的な非同値の反例であり、公開GA4の実値でshard日付とイベント時刻が不一致だと示したものではありません。

この監査だけで整数条件付きSQL全体が実行不能と断定しません。通常のtable出力や数値順序の計算が使える範囲と、
時刻の意味・単位・変換・期間への結び付けを自動生成して検査できる範囲を分けます。
根拠は[compiler](../report-generation/analysis_contract_compiler.py)、[生成](../report-generation/analysis_contract_generation.py)、
[normalizer](../report-generation/analysis_contract_response.py)、[実行policy](../report-generation/analysis_contract_context.py)です。

## 次の確認と証拠の境界

整数時刻を使う期間比較・累積・間隔の参照は保持し、shard日付へ変更して元の評価目的を縮小しません。
native参照の検算・内容reviewとは別に、同一汎用pipelineが単位・変換・期間・順序をどの証拠から生成し、
どの検査で誤った代用を拒否するかを確認します。局所の不足だけから対象別修正や手動意味定義を導入しません。
完了条件は[充足性監査](schema-coverage-gap-plan.md#2026-10-07の正解データ充足性監査)を維持します。

検算script・元応答hash・拒否理由・完了記録は`/private/tmp/reference-clock-contract-Wiyo7JXI/`のprivate artifactです。
provider・実AI呼出しは0回、製品・評価runtime・scorer・正式scope・IAM・資源・期限は変更していません。
元schemaの4応答確認を、全schema網羅、単位推論、実値同値、独立review、正式fixture成立、実AI品質へ拡張しません。
