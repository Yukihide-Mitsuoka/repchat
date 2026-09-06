---
id: adr-0024
title: 承認済み接続先のschemaから共通分析契約を作る
status: accepted
updated: 2026-09-06
---

# ADR-0024: 承認済み接続先のschemaから共通分析契約を作る

| Field | Value |
|-------|-------|
| Status | accepted（2026-09-06、オーナー承認） |
| Date | 2026-09-05 |
| Deciders | repository owner |
| Author | Codex |
| Supersedes / Superseded by | —。ADR-0010/0013を維持。ADR-0019全体の採用は含めない |

## Context

PR #643/#644でGA4とBitcoinは同じ計画・SQL生成・実行・描画経路を使うようになった。しかし
`DataSourceProfile`はPython関数を登録し、schema、期間の解析と検査、SQL生成規則をデータソース別に
実装している。新しいテーブルを使うたびにコード変更が必要で、初見データに対する分析品質を測れない。
Bitcoinの2024年月限定や裸のhash識別子補正も個別コードである。

オーナーは、schema理解以外の特別な作り込みを原則追加せず、利用者の要望からAIが分析を考えることを要求した。
schemaから分かる型と、schemaだけでは分からない業務指標・時間の意味を区別する必要がある。

## Options considered

| 案 | 利点 | 不利益 |
|----|------|--------|
| 現状維持：データごとにPython profile追加 | 既存処理の変更が少ない | 個別コードの保守が増え、未知schema評価に専用実装が混入する |
| 全schemaと列名だけをAIへ渡す | 初期実装は小さい | 大規模schemaの入力量、曖昧な期間列、重複集計、権限外参照を制御できない |
| 認可済みschema snapshotと意味定義を共通契約へ変換 | 各データで同じ処理と検証を使い、適用したschema版を追跡できる | snapshot更新・不一致検出と、メタデータ不足の確認が必要 |

## Decision

3案目を採用する。初期範囲は既存BigQuery経路とし、新DB、MCPサーバー、vector検索、顧客環境のviewは追加しない。
PR #646のマージ後、2026-09-06にオーナーが設計を承認した。

### 1. 取得対象はサーバー側で制限する

管理者が認めた接続とテーブル集合から、既存BigQueryクライアントでメタデータを取得する。
利用者の文章、AI応答、HTTP payloadから資格情報や許可datasetを作らない。メタデータ探索にも
既存の接続主体と認可を適用し、失敗時に別datasetや手書きschemaへ自動切替しない。

snapshotは完全修飾table、location、field path、型、NULL可否、REPEATED/STRUCT、説明、partition情報、
取得時刻、fingerprintを持つ。APIメタデータを第一候補とし、不足情報を補う問い合わせも許可範囲内に限定する。
列説明はデータとして渡し、ツール使用や権限変更の指示として扱わない。行のサンプリングは別の費用・対象確認を通す。

### 2. 個別関数ではなく検証可能な契約を渡す

共通契約はschema snapshot参照、定義済み指標、関係・粒度、期間条件、行数・費用上限から構成する。
grain、joinの多重度、指標の意味がメタデータにない場合は未定義として保持する。
AIは利用者の目的から分析・計算・可視化を提案できるが、既存の業務語の意味を無断で確定しない。

期間は業務上の時刻列とpartition絞り込みを別々に宣言する。候補が複数ならAIの確認質問で利用者が確定する。
月、日付範囲、比較期間、timezoneを構造化し、GA4の_TABLE_SUFFIXもBitcoinのpartition列も同じ検査器へ渡す。
2024年など検証用の期間は検証設定に限定し、製品の利用可能期間へ流用しない。

### 3. 計画からbuildまで同じsnapshotを固定する

計画・相談・SQL生成は同じ契約compilerを通す。入力上限に収まらなければ対象を狭める確認を返し、
必須schemaを黙って省略しない。確定仕様へschema fingerprintを含め、build開始時に参照する。
列の削除・型変更・partition変更等で契約が不整合なら、現在案を保持して再確認へ戻す。
schema版が同じでもデータ内容が不変とは扱わず、実行jobと結果revisionは別に記録する。

### 4. SQLと可視化は既存の共通検査を通す

SQL生成、参照範囲検査、dry run、費用上限、結果形状検査、描画をGA4／Bitcoin／未知schemaで共用する。
予約語・識別子の処理はBigQuery方言とschemaを根拠に共通化する。曖昧なSQLを書換えで救済せず、
診断をSQL担当AIへ渡す既存修正回数上限に従う。固定SQL・固定パネル・分析内容のfallbackは加えない。

## Consequences

新しい承認済みテーブルは原則schemaと意味定義の登録で扱える。個別データのコード分岐を減らせる一方、
metadata取得失敗や曖昧な粒度による確認が増える。metadataの正しさだけではSQLの集計正解を保証できない。

移行は共通契約・compiler、metadata reader、GA4／Bitcoin移行、未知schema検証の順に小さいPRへ分ける。
途中の旧profileとの互換は明示した移行経路に限定し、失敗時の自動fallbackにしない。
rollbackは直前のアプリrevisionへ戻す。異なるschema版の確定仕様を無検査で読み替えない。

## Validation

未知のnested/repeated schema最低2種類を用意し、各12設問を3回ずつ同じ契約で測る。
各schemaの設問は回答可能8件、確認が必要2件、安全性または非対応のため拒否すべき2件とし、
UNNEST、多段配列、join、期間比較、window、順序のある行動分析を含める。
参照SQLと期待結果は生成担当以外のレビューを受け、評価用正解を生成promptへ渡さない。

初期合格基準は、回答可能ケースの結果一致率が各schemaで90%以上、無断参照・誤った業務定義の受容・
費用上限超過が0件、確認／拒否ケースの全反復で意図しない実行が0件とする。
整数・集合は完全一致、近似値は指標ごとに実行前に定めた許容差で判定する。
SQL実行成功率、結果一致率、確認率、過剰拒否、描画成功率、費用を別々に記録する。
閾値を結果を見て引き下げず、失敗時は原因と対応可能範囲を記録する。

## References

- [Issue #188](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)
- [ADR-0010](0010-connection-identity-is-never-a-person.md)
- [ADR-0013](0013-metric-definitions-live-in-our-own-layer.md)
- [ADR-0019（提案段階）](0019-separate-datasource-knowledge-from-scoped-analysis-context.md)
