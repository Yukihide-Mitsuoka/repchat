---
id: adaptive-analysis-memory-requirements
title: 適応型分析メモリー要件
status: draft
updated: 2026-08-02
---

# 適応型分析メモリー要件

この文書は、dashboard作成と読解・報告で得た顧客固有の修正を安全に再利用するための要件を定義する。

関連Issue: [#220](https://github.com/Yukihide-Mitsuoka/repchat/issues/220)

## 1. 用語

| 用語 | 定義 |
|------|------|
| 分析方針メモリー | 生の会話履歴ではなく、適用範囲、権限、revision、根拠、期限を持つ構造化された分析方針 |
| メモリー候補 | AIまたは人間が抽出した、まだ有効化されていない変更案 |
| 分析レシピ | 分析目的、読者、KPI、比較軸、レイアウト、グラフ候補と選定理由をまとめた再利用可能な方針 |
| 分析文脈fingerprint | 分析方針を再利用できるか判定するための安定した構造キー |
| 実行時パラメータ | 期間、キャンペーン、店舗、地域など、同じ分析方針の中で都度変わる値 |
| 再利用判定 | `exact`は実行時パラメータだけ確認、`compatible`は差分確認、`new`は分析目的から確認し直す状態 |
| 有効revision | 権限確認と必要な承認を経て、現在の分析に適用できる不変の版 |

## 2. 前提と制約

| ID | 種別 | 内容 | 誤っていた場合の影響 |
|----|------|------|----------------------|
| A-1 | 前提 | 利用者は、同じ分析目的のたびに同じ確認を繰り返すより、過去に合意した方針の再利用を望む | 利用頻度が低い場合、永続メモリーの優先度を下げる |
| A-2 | 前提 | 顧客固有の修正には、個人の表示嗜好と組織の指標・業務方針が混在する | 区分できなければ候補を有効化せず、今回限りにする |
| A-3 | 検証対象の仮説 | 一度の対話だけでは顧客固有の暗黙知を十分に回収できず、一般的なKPI・グラフの提案に留まる場合がある | design partnerで質問回数、修正内容、再発率を測り、仮説が弱ければPhase 2以降を作らない |
| C-1 | 制約 | Issue #160が`proceed`になるまで製品実装を開始しない | Phase 0の文書化だけを行う |
| C-2 | 制約 | 指標の意味と出力形状はADR-0013の定義層を正本とする | 個人メモリーで指標定義を上書きしない |
| C-3 | 制約 | 生成SQL、クエリ結果、ページはartifact revisionとして扱い、分析方針メモリーの正本へ保存しない | 結果の鮮度と成果物の再現性を別々に管理する |
| C-4 | 制約 | tenant、workspace、userの識別子は認証済みserver contextからだけ解決する | client入力をscopeまたは認可根拠に使わない |
| C-5 | 制約 | 生の対話本文とresponse bodyを既定で長期保存しない | 候補抽出に必要な最小イベントだけを保持する |

## 3. 目的と範囲

- **目的:** 顧客の期待に合わなかった分析から得た修正を、誤適用や無断更新なしに次回の分析へ反映する。
- **着想と検証姿勢:** repository ownerが見たLookMLを含むLooker系デモで、一度の対話から高度な顧客固有分析へ
  到達する難しさを感じたことが出発点である。競合の客観的評価ではなく、RepChatで検証する仮説として扱い、
  元の実装案の維持を目的にせず、誤適用防止と実測結果に応じて方式と優先度を更新する。
- **成功指標:**

  | 指標 | 目標 | 測定方法 |
  |------|------|----------|
  | tenant・顧客・ユーザーを越えた誤適用 | 0件 | scope境界テスト、監査ログ、incident集計 |
  | 未承認の有効化 | 0件 | state transitionテスト、監査ログ |
  | 有効revisionの説明可能性 | 100% | 適用理由、scope、根拠、承認者、版をAPI/UIから確認 |
  | 有効revisionの取消可能性 | 100% | rollback受入テスト |
  | exact reuse時の確認質問 | 初回より減少 | 同一fingerprintの初回と再利用時を比較 |
  | 修正の再発率 | pilot基準値から低下 | 同種feedback eventの再発を追跡 |

- **対象:** 分析方針の候補化、scope確認、承認、版管理、検索、適用理由表示、取消、期限切れ、監査。
- **対象外:** fine-tuning、生の全会話RAG、顧客間の暗黙学習、結果値・SQLの記憶、Issue #160判定前の実装。
- **関係者:** 閲覧者は今回限りのoverrideと個人嗜好、編集者は許可された分析対象・レシピ、tenant管理者は
  組織方針・保持・削除を管理する。RepChat運用者は障害対応と監査を担うが、顧客データの意味を変更しない。
  repository ownerは製品方針と実装時期を決定する。

## 4. 機能要件

| ID | 要件 | 目的 | 優先度 | 根拠 |
|----|------|------|--------|------|
| FR-001 | 分析方針メモリーをtenant、分析対象、分析レシピ、user、sessionの区分で保存する | 誤適用0件 | Must | 顧客固有要望と個人嗜好の分離 |
| FR-002 | AIは修正からメモリー候補を作れるが、有効revisionを直接上書きしてはならない | 未承認有効化0件 | Must | 自己改善の暴走防止 |
| FR-003 | 候補化時に「今回だけ／自分の次回以降／この分析目的／この顧客組織／tenant標準として提案」からscopeを確認する | 誤適用0件 | Must | 初回・2回目より明確な境界 |
| FR-004 | 変更を不変revisionとして保存し、差分、理由、由来、作成者、承認者、期限、状態を記録する | 説明・取消100% | Must | 監査とrollback |
| FR-005 | 分析文脈fingerprintと互換性ルールによりexact、compatible、newを決定し、質問量を変える | 質問削減 | Must | 二値の初回判定を避ける |
| FR-006 | schema版または指標定義版が非互換なら既存方針を適用せず、再確認または拒否する | 誤分析防止 | Must | ADR-0013、Issue #188 |
| FR-007 | 「この分析で覚えていることを表示」「なぜ適用したか」「今回だけ」「忘れて」「取り消して」を自然言語とUIで提供する | 説明・取消100% | Must | 利用者による統制 |
| FR-008 | `show memory`を自然言語操作のaliasとして提供できるが、主要導線にはしない | 利用性 | Should | 非エンジニア向け日本語UX |
| FR-009 | 個人の低リスク表示嗜好は、利用者が「次回も」と明示した場合だけ即時有効化し、事後通知と取消を提供する | 質問削減 | Should | 過剰な承認摩擦の回避 |
| FR-010 | 組織方針、顧客方針、指標定義、business goal、security制約は権限者の承認前に有効化しない | 未承認有効化0件 | Must | 影響範囲に応じたauthority |
| FR-011 | 同種修正の再発を集計し、昇格・再確認・失効の候補を提示する | 修正再発率低下 | Could | 観測後の自己改善 |
| FR-012 | dashboardと所見のartifact manifestから適用済みpolicy revision IDまたはhashを参照できる | 再現性 | Must | ADR-0015との接続 |
| FR-013 | tenant管理者はscope別の保持、失効、削除、exportを操作できる | data protection | Must | 顧客統制 |
| FR-014 | dashboard作成とdashboard読解・会議向け報告は同じ有効policy revisionを参照し、別々の顧客メモリーを作らない | 一貫性 | Must | Issue #180と#181の統合 |

### 4.1 ユースケース

1. 初めての分析では、AIが目的、読者、KPI、比較軸、期間、グラフ候補と理由を提案し、確認後に分析仕様revisionを確定する。
2. 利用者が「この顧客では売上を税込で見たい」と修正した場合、今回の表示を直して永続化scopeを質問し、組織方針なら承認待ち候補にする。
3. 同じ分析レシピで期間だけが変わる場合、期間だけを確認し、過去のKPI・読順・表示嗜好を再利用する。
4. 指標定義版またはschema版が変わった場合、AIは互換性を仮定せず、差分と再確認事項を提示する。
5. 利用者は「この分析で覚えていることを表示」で、今回適用中の方針と適用理由を確認し、取消できる。
6. AI所見に対する「この顧客では前年差より計画差を優先して報告して」という修正も同じ候補workflowへ送る。

### 4.2 業務ルール

#### メモリー区分

| 区分 | 例 | 既定の承認者 | 下位scopeからの上書き |
|------|----|--------------|------------------------|
| system・security方針 | 禁止操作、data export制約 | 製品・tenant管理者 | 不可 |
| tenant・組織方針 | 会計年度、禁止する推測、承認workflow | tenant管理者 | 方針が許可した範囲だけ |
| 分析対象・顧客方針 | 顧客固有のbusiness goal、基準期間 | 編集者または管理者 | session override可否を方針で定義 |
| 分析レシピ | 目的、KPI、比較軸、読順、グラフ理由 | 編集者 | compatible差分として確認 |
| user表示嗜好 | 表示単位、説明の詳しさ、既定chart表現 | 本人 | sessionが優先 |
| session-only override | 今回だけ除外、今回だけ別期間 | 本人 | 永続化しない |

指標の意味はADR-0013の定義層で管理する。指標への修正は個人嗜好ではなく、指標定義変更の候補へ送る。
system・security方針と指標定義はuserまたはsessionから上書きできない。表示嗜好だけは
`session > user > analysis recipe > tenant default`の優先順を使う。

#### 分析文脈fingerprint

正規形は次を含む。

`tenant_id + analysis_subject_id/workspace + datasource/schema version + analysis purpose/family + audience + metric_definition_version + recipe_version`

期間、キャンペーン、店舗、地域などはfingerprintから除外する。識別と認可は完全一致する認証済みscopeで行い、
embedding類似度をidentityまたはauthorizationに使わない。

### 4.3 状態と遷移

`session correction → candidate → scope confirmed → approval pending/approved → active revision → superseded/expired/revoked`

- 候補が却下、期限切れ、権限不足になっても、現在の有効revisionは変更しない。
- rollbackは過去のrevisionを再び参照する新しいrevisionとして記録し、履歴を削除しない。
- schema・指標定義の互換性検証に失敗した場合は`incompatible`として適用対象から外す。

### 4.4 役割と権限

- scopeのread/writeはPostgres RLSとapplication authorizationで制御し、request bodyのtenant・分析対象・user IDを信頼しない。
- 候補の作成権限と有効化権限を分離し、AIを承認者にしない。
- 顧客横断学習は既定で禁止する。匿名化集約を製品改善へ使う場合は、別要件と明示的opt-inを必要とする。

### 4.5 エラーと例外

- scopeを一意に決められない場合は今回限り、承認者を特定できない場合は候補を保留する。
- retrieval障害時はメモリーなしで確認質問を増やし、分析を安全側で継続する。
- write障害時は有効revisionを維持して保存成功を装わず、期限切れ・非互換の方針を黙って適用しない。

## 5. 非機能要件

| ID | 特性 | 要件 | 目標 | 測定方法 | 優先度 |
|----|------|------|------|----------|--------|
| NFR-001 | 性能効率 | 適用方針の決定が対話開始を大きく遅らせない | pilot後にp95基準値を定める。Phase 1は単一tenant内のindexed lookup | tracingと負荷試験 | Should |
| NFR-002 | 信頼性 | retrieval障害が既存dashboard閲覧を止めない | last-known-good artifactは継続配信 | 障害注入試験 | Must |
| NFR-003 | セキュリティ | cross-tenant・cross-subject・cross-userの誤読取と誤書込を防ぐ | 0件 | RLS、authorization、負のE2E | Must |
| NFR-004 | 保守性 | 方針区分、scope、状態遷移をvendor非依存のdomain modelに置く | vendor adapterなしでunit test可能 | architecture test | Must |
| NFR-005 | 利用性 | 非エンジニアが日本語で適用内容、理由、取消を操作できる | pilot利用者が補助なしで主要5操作を完了 | usability test | Must |
| NFR-006 | 観測性 | 適用・候補化・承認・失効・rollbackを追跡する | 監査イベント欠落0件 | audit reconciliation | Must |
| NFR-007 | 移植性 | 外部Memoryサービスを正本にしない | PostgresだけでPhase 1を動作 | integration test | Must |
| NFR-008 | data protection | 生の対話本文・結果bodyを既定で保持しない | 正本tableに保存0件 | schema review、log scan | Must |

## 6. データ要件

| 観点 | 仕様 |
|------|------|
| データモデル | `analysis_policies`、`policy_revisions`、`memory_candidates`、`feedback_events`、`analysis_spec_revisions`。有効版は不変revisionへの参照で表す |
| 想定量 | 初期3〜5社ではtenantごとに数百〜数千revisionを想定し、実測後に更新する |
| 保持 | 有効方針は置換・削除まで、未承認候補30日、構造化feedback 90日、旧revision・承認・取消監査365日、解約後30日で完全削除。raw conversation・query-result bodyは既定0日。design partnerの要望を確認しtenant契約単位で変更できる |
| 個人情報 | user ID、修正理由、表示嗜好は顧客データとしてtenant境界内で扱う。秘密情報は保存しない |
| backup・recovery | control planeのRPO/RTOへ従い、rollbackに必要なrevisionと監査イベントを同じ復旧点へ揃える |

顧客Gitにはrawな個人メモリーを置かず、artifact manifestにはpolicy revision IDまたはhashだけを記録する。

## 7. 外部interfaceと依存関係

| system・API | 方向 | 契約 | SLA | 障害時 |
|-------------|------|------|-----|--------|
| Issue #180 分析仕様 | 双方向 | analysis specification revision、fingerprint、実行時パラメータ | 未定 | session-only確認へfallback |
| ADR-0013 指標定義層 | 読取・変更候補 | metric definition ID/versionと承認workflow | 未定 | 非互換なら適用・生成しない |
| ADR-0015 ArtifactBundle | 出力 | policy revision ID/hashをmanifestへ記録 | build SLAに従う | 失敗版を有効化しない |
| Issue #181 AI所見 | 読取 | business contextと許可済み表現方針 | 未定 | 根拠のない所見を生成しない |
| 認証・role | 読取 | server-side tenant/user/role context | Issue #194に依存 | fail closed |

## 8. infrastructureと費用

- **Phase 1:** 既存Postgres control planeとRLSを正本にし、新しいmanaged memoryサービスを追加しない。
- **Phase 2〜3:** 既存の生成AI経路を使い、候補数、token、承認率を測る。費用は実装Issueで前提とともに見積もる。
- **Phase 4:** 実測上のbottleneckが出た場合だけpgvectorまたはMemory Bankを派生indexとして評価する。

Memory BankをPhase 1の正本にしない。必要なscope、承認、削除、監査は製品側に残り、初期規模では二重化の便益が未実証だからである。

## 9. 運用要件

| 観点 | 要件 |
|------|------|
| monitoring・alert | cross-scope拒否、承認待ち滞留、非互換適用拒否、rollback、保存失敗を計測する |
| incident対応 | 誤適用時は対象revisionをrevokeし、影響artifactと閲覧主体を監査から特定する |
| deploy・rollback | schema migrationを後方互換にし、feature flagでretrievalを停止してsession-onlyへ戻せるようにする |
| migration | 既存の生会話を自動で永続方針へ変換しない。必要な方針は利用者確認つきで候補化する |

## 10. 受入条件

| ID | 条件 | 対応要件 | 検証方法 |
|----|------|----------|----------|
| AC-1 | tenant、分析対象、userを越えるread/write/applicationがすべて拒否される | FR-001、NFR-003 | RLS・API・E2E負のテスト |
| AC-2 | AIが作った候補は承認なしに有効revisionにならない | FR-002、FR-010 | 状態遷移テスト |
| AC-3 | 個人表示嗜好の即時有効化は「次回も」の明示後だけ行われ、通知と取消ができる | FR-009 | UI/API受入テスト |
| AC-4 | exact、compatible、newの各文脈で質問量と差分確認が仕様どおり変わる | FR-005 | scenario test |
| AC-5 | schema版または指標定義版が非互換なら方針を適用せず、有料実行前に止まる | FR-006 | compatibility test |
| AC-6 | 適用理由、scope、根拠、承認者、revision、期限、差分を表示できる | FR-004、FR-007 | UI/API test |
| AC-7 | 任意の有効revisionを取消し、直前の安全な版へ戻せる | FR-004 | rollback E2E |
| AC-8 | artifactから利用したpolicy revisionを追跡でき、SQL・結果値・raw personal memoryはpolicy正本にない | FR-012、FR-014、NFR-008 | manifest・schema review |

## 11. リスク

| ID | リスク | 確率 | 影響 | 緩和 |
|----|--------|------|------|------|
| R-1 | 誤った方針が広いscopeへ昇格する | 中 | 高 | scope確認、権限分離、approval、rollback |
| R-2 | 古い方針がschemaや事業変更後も残る | 高 | 高 | version互換性、期限、再確認、利用状況表示 |
| R-3 | 確認が多く、メモリーの便益を失う | 中 | 中 | 低リスク嗜好だけ明示同意後に即時反映、質問数を計測 |
| R-4 | 履歴が肥大化する | 中 | 中 | raw本文を保持せず、revision・event分離、保持期間、集約 |
| R-5 | 類似検索が別顧客の方針を混ぜる | 低 | 高 | 認証済み完全一致scopeで候補集合を限定し、類似度を認可に使わない |
| R-6 | AIの自己改善が説明不能になる | 中 | 高 | model学習ではなく、候補と不変policy revisionとして可視化 |

## 12. milestoneと実装時期

| milestone | scope | 開始条件 |
|-----------|-------|----------|
| Phase 0 — 要件と設計判断 | 本文書、ADR-0018、索引、将来Issueの境界 | 今回。実装なし |
| Phase 1 — 手動で統制された方針 | FR-001、004〜008、010、012、013。scope、revision、表示、手動作成・承認・取消。embeddingと自動昇格なし | Issue #160=`proceed`、#179/#188完了、#180でanalysis specification revision契約を確定、ADR-0018 accepted |
| Phase 2 — 修正から候補を作る | FR-002、003、009。明示修正→候補抽出→scope確認→承認・通知 | Phase 1の境界テストとpilot運用が安定 |
| Phase 3 — 反復から改善を提案 | FR-011。再発検知、期限、再確認、昇格提案。自動昇格はしない | 実顧客で反復修正が観測され、精度・承認率を測れる |
| Phase 4 — 派生retrieval index | pgvectorまたはMemory Bankの比較、同期、再構築、削除整合 | policy量またはlookup遅延が測定上のbottleneck |

Phase 1の実装IssueはIssue #160が`proceed`になった後に作る。Issue #180の最初の縦串はsession-onlyでも
進められるが、永続的な個別化の前にPhase 1を完了する。Issue #181も同じpolicy revisionを参照する。

## 13. 未決事項

| ID | 問い | block対象 | owner | 必要時期 |
|----|------|-----------|-------|----------|
| Q-1 | 編集者・管理者の本番認証方式と、分析対象scopeへのrole mappingをどう確定するか。デモをblockせず、デモ後の専用grill-meで決める | FR-010、NFR-003 | repository owner | Issue #194、Phase 1実装前 |
