---
id: measurement-implementation-assistant-requirements
title: GA4・GTM計測実装アシスタント要件
status: draft
updated: 2026-08-11
---

# GA4・GTM計測実装アシスタント要件

この文書は、分析目的からGA4・Google Tag Manager（GTM）の計測設計、実装例、設定成果物、検証手順を
作る将来要件を定義する。顧客固有の既存運用をAIが無条件に変更する機能ではない。初期はRepChat内の
設計支援とし、顧客環境を変更する自動化は権限・責任・製品境界を分けて判断する。
追跡Issueは[#343](https://github.com/Yukihide-Mitsuoka/repchat/issues/343)である。

## 1. 用語

| 用語 | 定義 |
|------|------|
| 計測仕様 | business objective、event、parameter、identity、trigger、consent、検証条件を固定したversion付き契約 |
| dataLayer契約 | website・appからGTMへ渡すevent名、field、型、必須性、発火条件、PII禁止、重複排除を定義した契約 |
| Design Mode | 顧客環境を変更せず、設計、code、GTM構成、import成果物、検証手順を生成する段階 |
| Apply Mode | 承認済み計測仕様を、隔離したGTM workspaceへAPIで適用し、quick previewまで行う後続段階。publishを含まない |
| verification bundle | test case、期待event・parameter、Tag Assistantまたはnetwork確認手順、結果、失敗理由を束ねた成果物 |
| publish authority | container versionを本番公開できる独立権限。編集権限と同一視しない |
| preview handoff | APIのquick preview結果、確認項目、手動のTag Assistant・network確認手順を利用者へ渡す成果物 |

## 2. 前提と制約

| ID | 種別 | 内容 | 誤っていた場合の影響 |
|----|------|------|----------------------|
| A-1 | 仮説 | 上流のevent・parameter・identity定義を整えると、下流のSQL、cohort、報告の品質と再利用性が上がる | design partnerで改善が見られなければ分析機能へ集中する |
| A-2 | 仮説 | 顧客固有の自動変更より、一般的best practiceに沿うreview可能な設計と差分の方が初期価値を出しやすい | 設定代行需要だけなら別serviceまたは別製品を再評価する |
| C-1 | 制約 | Issue #160が`proceed`になるまで製品実装しない | 今回は要件と実装順序だけを記録する |
| C-2 | 制約 | Design ModeはGTM、site、GA4 propertyを変更またはpublishしない | 顧客が成果物をreviewし、新規workspaceでpreviewする |
| C-3 | 制約 | RepChatはbrowserを操作せず、Apply Modeは公式GTM APIのquick previewまでに限定する | UI変更、MFA、session、実site操作を製品責務にしない |
| C-4 | 制約 | `tagmanager.publish`権限を初期OAuth scopeへ含めない | 編集と本番公開を分離する |
| C-5 | 制約 | consent設定は法的助言または法令準拠の保証ではない | privacy・legal ownerの確認を必須にする |
| C-6 | 制約 | credential、cookie、生のuser識別子、利用者が取得したTag Assistant記録をprompt、log、顧客Gitへ無制限に保存しない | debug成果物にはPIIが含まれ得る |
| C-7 | 制約 | 既存custom tag、server-side tagging、CMP、SPA状態管理を未知のまま自動変換しない | unsupported要素を列挙し、人のreviewへ戻す |
| C-8 | 制約 | 計測、分析、会議、施策は同じworkspaceから移動できるが、permission、credential、API、auditを共有しない | UIの連続性を権限統合と誤解しない |

## 3. 目的と範囲

- **目的:** 分析目的を、実装者がreview・適用・検証できるGA4/GTM計測仕様へ変換し、計測定義から
  RepChatの指標・SQL・dashboardまでを同じrevision chainで追跡できるようにする。
- **成功指標:**

  | 指標 | 初期目標 | 測定方法 |
  |------|----------|----------|
  | 仕様の必須項目充足 | 対象eventの100% | schema validation |
  | 未承認の顧客環境変更・publish | 0件 | audit log・negative E2E |
  | reference fixtureの期待event・parameter一致 | test caseの100% | static・API preview contract test |
  | unsupported要素の無警告変換 | 0件 | legacy container fixture |
  | 設計からpreview可能な成果物までの時間 | 手作業baseline比30%削減をpilotで検証 | design partner task test |
  | 生成物から目的・仕様・code・testへの追跡 | 100% | provenance reconciliation |

- **対象:** Web GA4、client-side GTM、recommended event、ecommerce、dataLayer、built-in tag、permission付き
  custom template、container export/import、API quick preview、手動検証手順、version、rollback計画。
- **初期対象外:** mobile app、server-side GTM、advertising activation、CMP製品の自動設定、Custom HTMLの
  自由生成、production publish、法的助言、任意のlegacy container完全移行。
- **関係者:**

  | role | 関心 | 決定権限 |
  |------|------|----------|
  | marketing・分析担当 | 何を測り、どの判断に使うか | business objective・KPI確認 |
  | 顧客technical owner | site、dataLayer、GTM、GA4の実装品質 | 計測仕様・適用差分承認 |
  | privacy・legal owner | consent、data収集、PII | consent設計承認 |
  | publisher | 本番影響とrollback | version publish・rollback |
  | AI | 設計、code、差分、testのdraft | 承認・publish権限なし |

## 4. 機能要件

| ID | 要件 | 優先度 | 理由 |
|----|------|--------|------|
| FR-001 | business objective、KPI、site framework、GA4 property、GTM export、現行dataLayer、CMP、対象environmentを入力またはread-only収集する | Must | 既存運用を無視しない |
| FR-002 | 秘密、PII、認証情報を取込前に検出・除外し、unsupported・不明な構成を明示する | Must | 顧客data保護 |
| FR-003 | business objectiveをGA4 recommended eventへ対応付け、該当しない場合だけdocumented custom eventを提案する | Must | 標準schemaを優先する |
| FR-004 | event名、parameter、型、必須性、発火条件、identity、重複排除、PII禁止をdataLayer契約として生成する | Must | 実装と分析の意味を固定する |
| FR-005 | ecommerceでは`items`、`currency`、`value`等の必要parameterとevent順序を明示する | Must | 売上・商品分析の整合性 |
| FR-006 | consent defaultをupdateより先に設定し、地域、CMP連携、`ad_user_data`、`ad_personalization`を確認事項として扱う | Must | 発火順と利用目的を暗黙化しない |
| FR-007 | website側のJavaScriptまたはTypeScript例、GTM tag・trigger・variable構成、命名規則、設定手順を生成する | Must | 実装可能な成果物にする |
| FR-008 | built-in tagを第一選択、permission付きcustom templateを第二選択とし、Custom HTML・Custom JavaScriptは理由とrisk承認なしに生成しない | Must | performance・security riskを抑える |
| FR-009 | Design Modeはhuman-readable specification、machine-readable manifest、import可能なcontainer JSON、差分、migration、rollback、QA手順をversion付きbundleとして出力する | Must | review・Git管理・再現性 |
| FR-010 | 既存exportへ直接上書きせず、新規workspaceへのmerge/importを前提に、追加・変更・削除を分離表示する | Must | 既存運用を保護する |
| FR-011 | static validationでschema、template permission、未定義variable、trigger不整合、命名、重複eventを検査する | Must | preview前の欠陥を減らす |
| FR-012 | verification bundleに手動操作、期待dataLayer、期待GA4 request、consent状態、tag発火・非発火、pass条件を含める | Must | 利用者のpreview確認を再現可能にする |
| FR-013 | API quick previewの結果と、利用者がTag Assistantまたはbrowser開発者toolで確認する手順を渡し、RepChat自身はbrowserを操作しない | Must | 本番site操作を責務にしない |
| FR-014 | 利用者がTag Assistant等の記録を添付する将来optionでは、PII警告、明示同意、短期保持、削除、prompt非送信の選択を必須にする | Could | debug dataが機微になり得る |
| FR-015 | 計測仕様revisionをADR-0013のevent・metric・identity定義へ接続し、生成SQLが参照したrevisionを表示する | Should | 上流と下流の追跡 |
| FR-016 | Apply Modeは最小OAuth scopeで隔離workspaceを作り、変更適用、sync、conflict、status、quick previewまでを行う | Should | APIによる統制変更 |
| FR-017 | conflict、validation失敗、test失敗、scope不足を区別し、自動publishまたは無断retryをしない | Must | 復旧と費用・影響統制 |
| FR-018 | publish用scope、credential、API操作、browser操作を製品に実装せず、利用者がGTM側でreview・publishする | Must | production責任を顧客へ残す |
| FR-019 | APIで取得できない実site状態は推測せず、利用者によるpreview確認事項として残す | Must | 見えていない状態を成功扱いしない |
| FR-020 | 同じ計測仕様をRepChatのdashboard、cohort、会議報告が参照し、source contract変更時は下流成果物をstaleにする | Should | 誤った過去結果の再利用を防ぐ |

### 4.1 Design Modeの成果物

1. 目的、KPI、利用判断、ownerを持つmeasurement plan
2. event・parameter catalogとdataLayer JSON Schema
3. site実装code例とGTM tag・trigger・variable manifest
4. import用container JSONと既存構成との差分
5. consent・privacy確認事項と承認者
6. API quick preview結果と、手動のTag Assistant・network確認用test case
7. unsupported項目、手動作業、migration、rollback手順
8. 計測仕様、実装、検証、下流metricを結ぶprovenance manifest

### 4.2 状態遷移

`draft → needs-context → proposed → technical-review → privacy-review → approved-design → exported`

Apply Modeを有効にした場合だけ、次を追加する。

`exported → workspace-created → applied → synced → quick-previewed → handed-off`

- `approved-design`より前に顧客環境へwriteしない。
- RepChatは`handed-off`より先のpublish操作を持たない。
- sync conflict、scope不足、検証不一致は`blocked`とし、人が修正または再承認する。
- 顧客がpublishしたversion IDを後から参照登録できるが、RepChatはpublishを代行しない。

## 5. 非機能要件

| ID | 特性 | 要件 | 目標 | 検証方法 | 優先度 |
|----|------|------|------|----------|--------|
| NFR-001 | security | OAuth scopeをread、edit、version、publishで分離し、tenantを越えるtoken・container参照を拒否する | 越境・過剰scope 0件 | authorization負のE2E | Must |
| NFR-002 | safety | Design Modeから外部writeを行わず、Apply Modeは隔離workspaceとquick preview以外を拒否する | 無承認変更0件 | API mock・audit test | Must |
| NFR-003 | correctness | reference fixtureの期待event、parameter、consent、tag構成と一致する | test case 100% | static・API preview fixture | Must |
| NFR-004 | reproducibility | 同じinput revisionから同じmanifest shapeとtest contractを作る | 差分0件 | repeated contract test | Must |
| NFR-005 | privacy | PII候補とcredentialを生成AI入力・Git成果物から除く | 漏えい0件 | DLP fixture・redaction test | Must |
| NFR-006 | usability | 実装者が差分、手動作業、risk、test、rollbackを一画面から確認できる | pilot成功率80%以上 | task test | Should |
| NFR-007 | observability | input、AI提案、人の承認、API write、test、version、publishを同じtraceへ結ぶ | audit欠損0件 | reconciliation | Must |
| NFR-008 | maintainability | GA4 event schema、GTM template、consent contractをversion付きruleとして更新できる | prompt直書き0件 | rule inventory test | Must |

## 6. データ要件

| 観点 | 仕様 |
|------|------|
| data model | `measurement_spec_revisions`、`container_inventory_snapshots`、`implementation_bundles`、`verification_runs`、`external_change_audits` |
| source of truth | 顧客承認済み計測仕様とGTM versionを正本とし、AI回答そのものを正本にしない |
| artifact | 顧客Gitへ保存できるcode、JSON Schema、manifest、container JSON、test、provenance。secretと生PIIは含めない |
| retention | inventoryと承認・変更auditは契約に従う。利用者添付のTag Assistant記録は短期・用途限定とする |
| deletion | source debug dataを削除しても、redacted specification・audit・test判定は保持方針に従って説明可能にする |
| recovery | 適用前snapshotとpublished versionをrollback先として保持し、再適用は再承認を要求する |

## 7. 外部interfaceと依存関係

| system・機能 | 方向 | 契約 | 障害時 |
|-------------|------|------|--------|
| GTM API v2 | 読取・将来write | account、container、workspace、tag、trigger、variable、version、environment | scope不足、quota、conflictを区別して停止 |
| GA4推奨event仕様 | 読取 | recommended event、ecommerce event・parameter | version不明ならcustom化せずreviewへ戻す |
| 顧客site・dataLayer | 入力・将来検証 | event、field、consent、request | PIIまたはunsupportedならredact・停止 |
| Git artifact pipeline | 出力 | version付きcode、manifest、test、差分 | credentialを保存せずlast-known-good維持 |
| ADR-0013 指標定義層 | 出力 | event、parameter、identity、metric、source contract revision | 不一致なら下流buildをstale・blockedにする |
| manual preview handoff | 出力 | quick preview結果、操作fixture、expected request、利用者確認欄 | 未確認項目を成功扱いしない |

## 8. インフラと費用

- Design Modeは既存のAI、artifact pipeline、Gitを利用し、この機能だけを理由にin-memory DBやvector DBを追加しない。
- GTM APIはquota、OAuth、token custodyの運用費がある。Apply Modeの単価はpilot実測後に決める。
- AI生成とAPI writeを別の承認・費用単位にする。browser操作とpublishの費用単位は製品に設けない。

## 9. 運用要件

| 観点 | 要件 |
|------|------|
| monitoring | schema不一致、unsupported、PII redaction、scope拒否、sync conflict、test失敗、publish拒否を計測する |
| incident | 誤計測を検知したらpublish version、影響event・metric・dashboard、対象期間を特定し、rollbackとstale化を行う |
| credential | tenant別service identity、短期token、暗号化、rotation、revokeを使い、browser credentialを取得しない |
| change management | 変更差分、technical・privacy・publish承認者、test結果、rollback先をversionへ記録する |
| support | 顧客固有custom tagを自動修復せず、unsupported reportと一般的な移行案を渡す |

## 10. 受入条件

| ID | 条件 | 対応要件 | 検証方法 |
|----|------|----------|----------|
| AC-1 | EC購入目的からGA4推奨event、parameter、dataLayer契約、code、GTM構成、QA手順が生成される | FR-001〜012 | fixed specification fixture |
| AC-2 | Design ModeではGTM API writeとpublishが0件で、import成果物だけを取得できる | C-2、NFR-002 | API spy・audit test |
| AC-3 | legacy exportの既知tagを上書きせず、追加・変更・削除・unsupportedを差分表示する | FR-009〜011 | container fixture |
| AC-4 | reference fixtureの購入、二重発火、consent、必須parameter欠損について、APIで確認できる項目と手動確認項目を分離する | FR-012〜014 | static・API preview contract test |
| AC-5 | Apply Modeは隔離workspaceとquick preview以外へ進まず、conflictまたはvalidation失敗時に停止する | FR-016、017 | API integration fixture |
| AC-6 | publish scopeを要求せず、publish APIとbrowser操作が製品経路から呼ばれない | FR-018、NFR-001 | authorization・call inventory test |
| AC-7 | Tag Assistant記録のPII候補がprompt、log、Git成果物に残らない | FR-014、NFR-005 | seeded PII fixture |
| AC-8 | 計測仕様変更で参照metric、SQL、cohort、dashboardをstaleにし、影響範囲を列挙する | FR-015、020 | dependency E2E |

## 11. リスク

| ID | リスク | 確率 | 影響 | 緩和 |
|----|--------|------|------|------|
| R-1 | 一般的best practiceが顧客固有の制約と衝突する | 高 | 高 | inventory、unsupported表示、差分review、手動override |
| R-2 | 誤tagが売上・広告・同意dataを壊す | 中 | 最高 | no-publish固定、隔離workspace、preview、顧客review、rollback手順 |
| R-3 | API previewだけでは実siteの発火結果を完全検証できない | 高 | 高 | 限界を表示し、手動preview手順と確認欄を引き渡す |
| R-4 | debug記録にPIIやcredentialが入る | 中 | 最高 | local redaction、短期保持、用途同意、prompt・Git禁止 |
| R-5 | consent案を法的保証と誤認される | 中 | 高 | legal disclaimerではなくprivacy owner承認を状態遷移へ組み込む |
| R-6 | scopeが分析からproduction site運用へ広がりRepChatの焦点がぼける | 高 | 高 | Apply ModeもAPI previewまでとし、browser・publishを明示的対象外にする |
| R-7 | custom HTML・JavaScriptがsecurity・performance負債になる | 中 | 高 | built-in・permission template優先、明示例外review |

## 12. 実装時期と製品境界

| 段階 | 範囲 | 開始条件 |
|------|------|----------|
| Phase 0 — 要件 | 本文書、reference plan、security・product境界 | 今回。製品実装なし |
| Phase 1 — Design Mode | GA4推奨event、dataLayer、code、manifest、import JSON、QA・rollback手順 | #160=`proceed`、3社の現行設計例、reference site |
| Phase 2 — read-only audit | container export/API inventory、best-practice差分、影響する下流metricの列挙 | Phase 1で設計時間または欠陥率が改善 |
| Phase 3 — Apply Mode（API previewまで） | isolated workspace、sync/conflict、apply、quick preview、manual test handoff | auth・token custody・incident要件をADRで承認 |

Phase 1・2は分析品質を上流から改善するRepChatのonboarding機能とする。Phase 3も隔離workspaceの
API quick previewまでに限定する。browser操作とproduction publishは製品境界外とし、別製品候補としても
現時点では追わない。同一workspaceと内部境界の判断は[ADR-0023](../adr/0023-unify-workflow-while-isolating-external-action.md)、
外部施策のdeveloper contractは[施策パッケージAPI要件](action-package-api.md)を正本とする。

## 13. 未決事項

| ID | 問い | 決定時期 | owner |
|----|------|----------|-------|
| Q-1 | 最初に支援するsite framework、CMP、ecommerce platformは何か | Phase 1前 | product owner・design partner |
| Q-2 | 顧客Gitへcontainer JSONを保存できない場合のmanaged artifact保持は何日か | Phase 1 | security owner |
| Q-3 | read-only inventoryをfile uploadとOAuth APIのどちらから始めるか | Phase 1 | product owner |
| Q-4 | Apply ModeをRepChat標準機能とadd-onのどちらにするか | Phase 2評価後 | repository owner |
| Q-5 | 利用者添付のTag Assistant記録を受け付けるか、受け付ける場合の保持日数は何か | Phase 3前 | security owner |

## 14. 公式参照資料

- [Google Tag Manager API v2](https://developers.google.com/tag-platform/tag-manager/api/v2)
- [GTM API authorization scopes](https://developers.google.com/tag-platform/tag-manager/api/v2/authorization)
- [GTM workspace sync](https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces/sync)
- [GTM container export and import](https://support.google.com/tagmanager/answer/6106997?hl=en)
- [GTM preview and Tag Assistant](https://support.google.com/tagmanager/answer/6107056?hl=en)
- [Tag Assistant session recording](https://support.google.com/tagmanager/answer/17165450?hl=en)
- [GA4 recommended events](https://developers.google.com/analytics/devguides/collection/ga4/reference/recommended-events)
- [GA4 ecommerce measurement](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce)
- [Consent mode](https://developers.google.com/tag-platform/security/guides/consent)
- [GTM custom template permissions](https://developers.google.com/tag-platform/tag-manager/templates/permissions)
