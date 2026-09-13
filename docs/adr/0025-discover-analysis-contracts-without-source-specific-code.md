---
id: adr-0025
title: ADR-0025 — 分析対象固有のコードや設定なしに分析契約を自動生成する
status: accepted
updated: 2026-09-13
---

# ADR-0025: 分析対象固有のコードや設定なしに分析契約を自動生成する

| Field | Value |
|-------|-------|
| Status | accepted（2026-09-12、オーナー指示） |
| Date | 2026-09-12 |
| Deciders | repository owner |
| Author | Codex |
| Supersedes / Superseded by | [ADR-0013](0013-metric-definitions-live-in-our-own-layer.md)、[ADR-0019](0019-separate-datasource-knowledge-from-scoped-analysis-context.md)、[ADR-0024](0024-build-analysis-context-from-inspected-schema.md)を置き換える |

## Context

現在のreport-generation spikeは共通のplanner・SQL実行・描画経路を持つ一方、`DataSourceProfile`へ
データセット名、schema説明、期間parser、partition検査、SQL修復、識別子補正をPython関数として登録する。
`metrics.json`にも特定データの意味定義がある。新しい分析対象ごとに同様のprofileや定義を開発する構造では、
顧客のデータ追加を製品だけで処理できず、汎用分析製品として成立しない。

ADR-0013は指標定義を自前の層で登録し、ADR-0019案はデータソース契約revisionを管理し、ADR-0024は
個別関数を共通契約へ移す方向を定めた。いずれも新しい分析対象に「意味定義またはデータソース契約の登録」を
要求できる余地を残す。この前提は開発者または利用者による対象固有設定を要求するため、今回の製品要件を満たさない。

接続credentialとアクセス可能範囲は認可のために必要だが、分析対象固有の分析設定ではない。認可後の
table選択、schema理解、値の特徴把握、期間・partition理解、分析計画、SQL生成と検査は、対象名や業種を
知らない同一実装で完結しなければならない。

## Options considered

### Option 1: 現状を維持する

データソースごとのprofileと意味定義を追加する。既存デモの維持は容易だが、分析対象が増えるたびに開発が
必要になり、製品要件を満たさないため採用しない。

### Option 2: 共通エンジンと宣言的な対象別設定を組み合わせる

Python分岐をなくし、schema・指標・期間を設定ファイルへ移す。コード追加は減るが、新しい分析対象ごとの
設定作業と待ち時間は残るため採用しない。

### Option 3: 認可済みscopeから分析契約を実行時に自動生成する

接続の認可済みscopeを起点に、schema metadata、partition、汎用的で費用制限された値profileを取得し、
対象非依存のcompilerとAIで分析契約を生成する。分析対象名による分岐や登録を持たず、未知schemaを使った
反復評価で品質を改善する。実装・評価量と推論の難易度は最も大きいが、製品要件を満たす唯一の案である。

## Decision

Option 3を採用する。新しい分析対象を利用可能にするためのPython module、profile registry entry、固定prompt、
固定SQL、期間parser、識別子補正、metrics file、対象別設定を追加してはならない。処理の分岐はBigQueryの
型、mode、partition、clustering、nested/repeated構造など、実行時に取得した標準metadataだけを根拠にする。

分析契約は認可済みscopeから自動でtableを発見し、bounded metadata inspection、bounded value profiling、
schema linking、期間・join・grain・metric候補の推論を同じpipelineで行って生成する。SQLの参照範囲、
dry run、費用上限、結果形状、期間・partition、識別子、nested/repeatedの検査も対象非依存で実装する。

選択したschemaに非repeatedの時間field、検査済みdate shard、またはingestion-time partition疑似fieldが
存在する場合は、分析契約に業務時刻と期間を必須とする。いずれも存在しない場合だけ、canonical contractの
`period`を`null`として期間条件が適用不能であることを明示する。生成時の空文字をcanonical contractへ残さず、
SQL生成は`period=null`から期間、timezone、疑似fieldを推測しない。必須partition filterをこの境界で表現
できないtableは、期間なしとして通過させずfail closedにする。

ADR-0014は生成物の所有・配置だけに適用し、新しい分析対象を使うための指標定義やデータソース契約登録を
正当化しない。自動生成した契約を将来保存する場合も、その保存は利用開始前の手動設定または開発作業にしてはならない。

現段階では、意味定義の手動登録、データ理解のための利用者確認、対象別fallbackを解決策にしない。未知schemaの反復評価で
失敗原因を記録し、metadata・value profile・prompt・共通validatorを改善する。改善可能性を十分に検証した後も
超えられない限界が証拠として残った場合だけ、別の意思決定として確認や手動入力を検討する。

## Consequences

**Positive:**

- 顧客のデータ追加が開発待ちにならず、同じruntime経路で処理される。
- 特定データに対する既知知識やfixture向け補正が品質評価へ混入しない。
- 改善が全分析対象へ適用され、対象別実装の保守負債を増やさない。

**Negative:**

- metadataだけでなく汎用的な実値profileが必要になり、privacy、列レベル送信制御、費用上限を同時に設計する必要がある。
- schema linking、粒度、join、業務指標の自動推論は難しく、未知schema評価が合格するまで製品能力を表明できない。
- 既存デモのprofile、`metrics.json`、対象別SQL検査を共通経路へ移行して削除する作業が必要になる。

**Follow-ups:**

1. PR #675から対象固有の契約factoryを除き、共通contract identityの変更だけを残す。
2. 認可済み接続scopeからtable・schema・値profileを自動取得する共通input contractを実装する。
3. profile IDなしに期間・partition・nested path・join・grain・metric候補を生成する共通compilerを実装する。
4. live engineからprofile registryと`metrics.json`依存を除去する。
5. 対象別コードや設定を一切追加せず、未知のnested/repeated schema最低2種類で反復評価する。
