---
id: action-package-api-requirements
title: 施策パッケージAPI要件
status: draft
updated: 2026-08-11
---

# 施策パッケージAPI要件

この文書は、承認済みの分析施策をprovider非依存の契約で外部systemへ渡し、実行状態と実績を元の効果検証へ
戻す将来のdeveloper interfaceを定義する。広告操作、予算変更、決済はRepChat Coreの対象外とする。
追跡Issueは[#345](https://github.com/Yukihide-Mitsuoka/repchat/issues/345)である。

## 1. 用語

| 用語 | 定義 |
|------|------|
| Action Proposal | AIまたは人間が作る施策案。根拠、目的、KPI、予算案を持つが、外部利用前のdraft |
| Action Package | 人間が承認したAction Proposalを外部連携用に固定した、不変で取消可能なrevision |
| export profile | Action Package JSONからCSV等を生成するversion付きmapping |
| execution adapter | Action Packageを外部system固有形式へ変換する独立component。RepChat Coreに含めない |
| external outcome | 外部systemが返す実行状態、費用、成果。検証済み分析結果とは別revisionとして扱う |

## 2. 前提と制約

| ID | 種別 | 内容 | 誤っていた場合の影響 |
|----|------|------|----------------------|
| A-1 | 仮説 | 根拠とKPIを持つ施策を機械可読で渡せば、転記と効果検証の欠落を減らせる | design partnerに連携需要がなければ実装しない |
| C-1 | 制約 | Issue #160が`proceed`になるまで実装しない | 今回は契約と境界だけを記録する |
| C-2 | 制約 | Action Packageは人間の承認済みAction Proposalからだけ発行する | AI提案を外部指示にしない |
| C-3 | 制約 | JSONを正本とし、CSV、webhook、provider形式を正本にしない | format追加でdomain contractを分岐させない |
| C-4 | 制約 | Coreは広告公開、予算変更、振込、決済を実行しない | 支出とproduction変更を別責任にする |
| C-5 | 制約 | 銀行口座、card、決済credential、振込指示を保存・出力しない | payment dataを製品scopeへ入れない |
| C-6 | 制約 | tenant、analysis subject、role、package scopeが一致しないread・export・result writeを拒否する | 顧客間の施策と実績を混ぜない |

## 3. 目的と範囲

- **目的:** 承認済み施策を根拠・KPI・revisionから切り離さず外部systemへ渡し、外部結果を次回評価へ戻す。
- **成功指標:**

  | 指標 | 目標 | 測定方法 |
  |------|------|----------|
  | packageの根拠・承認追跡 | 100% | provenance reconciliation |
  | 未承認export・tenant越境 | 0件 | authorization負のE2E |
  | 同一idempotency keyの重複outcome | 0件 | retry integration test |
  | CSVと元JSONの照合 | 100% | export profile contract test |
- **対象:** version付きJSON取得、CSV派生export、webhook通知、revoke・expiry、外部status・実績取込、audit。
- **対象外:** providerへのwrite、媒体credential、決済、支払指示、銀行・card data、広告費の立替、汎用workflow engine。
- **関係者:**

  | role | 関心 | 決定権限 |
  |------|------|----------|
  | 意思決定者 | 施策、予算案、KPI | package発行承認・revoke |
  | developer・外部system | 安定した機械可読契約 | 実行可否は外部system側で決定 |
  | 監査者 | 根拠、承認、export、outcome | audit review |
  | AI・execution adapter | draft・format変換 | 承認権限なし |

## 4. 機能要件

| ID | 要件 | 目的 | 優先度 | 根拠 |
|----|------|------|--------|------|
| FR-001 | 承認済みaction revisionからだけAction Package revisionを発行する | 未承認export 0件 | Must | C-2 |
| FR-002 | packageにschema version、ID、revision、tenant・scope、目的、根拠、KPI、期間、対象、予算案、承認、有効期限を含める | 追跡100% | Must | 外部転記後も判断を再現する |
| FR-003 | evidence、metric、dashboard、decision、actionの各revisionを参照し、本文へquery resultを無制限に複製しない | 根拠100% | Must | stale dataと情報複製を防ぐ |
| FR-004 | `draft → approved-for-export → exported → external-acknowledged → outcome-imported → evaluated`を管理する | 状態再現 | Must | exportと実行を区別する |
| FR-005 | revoke、expiry、supersededを通常状態と分離し、失効packageを新規取得・再exportさせない | 安全性 | Must | 古い施策の実行を防ぐ |
| FR-006 | JSON packageを正本として取得でき、ETagまたはrevision IDでimmutable responseを識別する | 契約安定 | Must | C-3 |
| FR-007 | CSVはversion付きexport profileから生成し、元package revision、profile version、hashをmanifestへ残す | CSV照合100% | Should | format driftを検出する |
| FR-008 | 初期CSV候補を施策計画、予算計画、実績照合に限定し、payment instructionを提供しない | scope統制 | Must | C-4、C-5 |
| FR-009 | 承認またはrevoke時に署名済みwebhook eventを送信でき、event IDで再送を冪等化する | 外部連携 | Should | polling依存を減らす |
| FR-010 | 外部systemはpackage revision、external reference、status、実績、source、取得時刻、idempotency keyを返せる | 効果検証 | Must | 外部結果を元actionへ結ぶ |
| FR-011 | external outcomeを検証済みanalysis resultと別revisionに保存し、採用前にschema・scope・単位を検証する | 正確性 | Must | 外部申告値を正本値と混ぜない |
| FR-012 | 利用者が同じworkspaceから根拠、承認、export、外部status、次回評価へ移動できる | 文脈維持 | Should | ADR-0023 D1 |
| FR-013 | API scopeを`action:read`、`action:export`、`action:outcome:write`へ分離し、分析権限から自動継承しない | 越境0件 | Must | 最小権限 |
| FR-014 | 広告公開、budget mutate、payment、bank transferに相当するCore endpointを提供しない | scope統制 | Must | ADR-0023 D4 |

### 4.1 例

```json
{
  "schema_version": "action-package/v1",
  "action_package_id": "ap_example_001",
  "revision_id": "apr_example_003",
  "state": "approved-for-export",
  "scope": {"tenant_ref": "tenant-example", "analysis_subject_ref": "subject-example"},
  "objective": "購入完了率を改善する",
  "evidence_refs": ["panel-rev-example", "result-rev-example"],
  "proposal": {
    "channel_intent": "paid-search",
    "budget": {"currency": "JPY", "recommended": 300000, "upper_limit": 400000},
    "period": {"start": "2026-09-01", "end": "2026-09-30"},
    "success_metric_ref": "metric-rev-example"
  },
  "approval": {"status": "approved", "approved_at": "2026-08-11T00:00:00Z"},
  "execution_policy": "external-only",
  "expires_at": "2026-08-31T23:59:59Z"
}
```

これは支出命令ではない。外部systemは承認範囲を再確認し、実行責任を持つ。

### 4.2 error

- 未承認、期限切れ、revoke済みは同じpackageを返さず、状態を識別できる拒否応答にする。
- tenant・scope不一致は対象の存在を示さない。
- outcomeのcurrency、単位、期間、external referenceが不正なら保存しない。
- webhook失敗はbounded retry後に停止し、package取得APIとdashboard閲覧を止めない。

### 4.3 roleとpermission

- 意思決定承認と`action:export`を別permissionにする。
- `action:outcome:write`は指定tenant・consumer・package scopeへ束縛し、package本文の変更を許可しない。
- API credentialの発行・失効は管理者だけに許可し、通常利用者のsession tokenをdeveloper tokenに変換しない。

## 5. 非機能要件

| ID | 特性 | 要件 | 目標 | 検証方法 | 優先度 |
|----|------|------|------|----------|--------|
| NFR-001 | security | tenant・scope・API permissionを全endpointでserver解決する | 越境0件 | authorization負のE2E | Must |
| NFR-002 | integrity | JSON、CSV、webhookにrevision、hash、schema versionを持たせる | 改ざん未検出0件 | tamper test | Must |
| NFR-003 | reliability | retryはGET、冪等outcome、同一webhook eventだけに限定する | 重複record 0件 | retry fixture | Must |
| NFR-004 | performance | package metadata取得を通常volumeでp95 500ms以内にする | p95 500ms以下 | load test | Should |
| NFR-005 | auditability | 生成、承認、取得、export、revoke、outcomeを同一traceへ結ぶ | audit欠損0件 | reconciliation | Must |
| NFR-006 | compatibility | additive fieldはminor、削除・意味変更はmajor schema versionにする | consumer無通知破壊0件 | contract test | Must |
| NFR-007 | data protection | payment dataと生の個人target listをpackageへ含めない | 検出0件 | seeded DLP fixture | Must |

## 6. データ要件

| 観点 | 仕様 |
|------|------|
| data model | `action_package_revisions`、`action_package_exports`、`action_webhook_deliveries`、`external_outcome_revisions` |
| source of truth | 承認済みaction revisionとAction Package JSON。CSVとprovider formatは派生data |
| expected volume | pilotでpackage 1,000 revision、1 package当たりexport 10件、outcome 100件までを試験し、実測後に上限を決める |
| retention | package、承認、export、outcome、auditはtenant契約に従う。credentialとpayment dataは保持0日 |
| recovery | revokeまたはadapter停止後も内部actionとdecisionを保持し、last accepted outcomeを識別する |

## 7. 外部interfaceと依存関係

| interface | 方向 | 契約 | SLO | 障害時 |
|-----------|------|------|-----|--------|
| package API | out | version付きJSON、認可、ETag | NFR-004 | last valid revisionを変更せず明示error |
| export API | out | profile指定CSV＋manifest | pilotで計測 | JSON packageは継続利用可能 |
| webhook | out | 署名、event ID、package URL | pilotで計測 | bounded retry後に停止・通知 |
| outcome API | in | idempotency key、external ref、status、actuals | pilotで計測 | invalid inputを保存せず監査 |
| Issue #181 action | in | approved action revision | internal | 未承認ならpackageを発行しない |

## 8. インフラと費用

初期は既存control plane、object storage、auditを利用し、provider connectorまたは決済基盤を追加しない。
API request、export生成、webhook配信、outcome保存の実測量が出るまで月額を確定しない。外部adapterの費用と
media spendはRepChat利用料から分離表示する。

## 9. 運用要件

| 観点 | 要件 |
|------|------|
| monitoring | 未承認拒否、期限切れ、revoke、export失敗、webhook滞留、outcome拒否、越境拒否を計測する |
| incident | packageをrevokeし、取得先、export、外部参照、影響actionをauditから列挙する |
| rollback | adapterを停止してもpackage、decision、dashboard閲覧を維持する |
| migration | provider固有CSVをcore JSONへ逆流させず、新profile versionで移行する |

## 10. 受入条件

| ID | 条件 | 対応要件 | 検証方法 |
|----|------|----------|----------|
| AC-1 | 未承認actionからpackageを発行・exportできない | FR-001、013 | state・authorization E2E |
| AC-2 | packageから根拠、metric、decision、action、承認へ100%追跡できる | FR-002、003 | provenance reconciliation |
| AC-3 | 同じrevisionのJSONとCSVがprofile mappingどおり一致する | FR-006〜008 | contract fixture |
| AC-4 | revoke・expiry後の取得、export、webhook再送を拒否する | FR-005、009 | clock・revoke test |
| AC-5 | 同じidempotency keyのoutcome再送が1 revisionだけを作る | FR-010、011 | retry integration test |
| AC-6 | provider write、budget mutate、payment endpointが公開contractに存在しない | FR-014 | OpenAPI inventory test |
| AC-7 | adapter障害時もdashboard、decision、package JSONの閲覧を継続する | NFR-003 | fault injection |

## 11. リスク

| ID | リスク | 確率 | 影響 | 緩和 |
|----|--------|------|------|------|
| R-1 | packageが支出命令と誤解される | 中 | 高 | `external-only`、承認、期限、非実行表示 |
| R-2 | CSV profileが顧客ごとに増える | 高 | 中 | 反復需要があるprofileだけversion管理する |
| R-3 | 外部statusが虚偽または古い | 中 | 高 | source、取得時刻、external ref、別revision表示 |
| R-4 | 汎用APIを先行実装して利用者がいない | 高 | 中 | #160とIssue #181後、最初のconsumer確定まで実装しない |
| R-5 | developer tokenで顧客間dataを取得する | 低 | 最高 | tenant binding、scope、rotation、負のE2E |

## 12. 実装時期

| phase | 範囲 | 開始条件 |
|------|------|----------|
| Phase 0 | 本要件、ADR-0023、consumer interview | 今回。実装なし |
| Phase 1 | read-only JSON package、revoke、audit | #160=`proceed`、Issue #181 action revision安定、consumer 1件 |
| Phase 2 | CSV profile、webhook | 同一formatの反復需要2件以上 |
| Phase 3 | external outcome取込と効果評価 | Phase 1の越境・冪等・監査試験成功 |

## 13. 未決事項

| ID | 問い | block対象 | owner | 必要時期 |
|----|------|-----------|-------|----------|
| Q-1 | 最初のconsumerとexport profileは何か | Phase 1・2 | repository owner・design partner | 実装Issue前 |
| Q-2 | developer credentialの発行・失効をどの認証方式へ統合するか | Phase 1 | repository owner | Issue #194決定時 |
| Q-3 | packageとoutcomeの既定保持日数は何日か | Phase 1 | security owner・design partner | 本番前 |
