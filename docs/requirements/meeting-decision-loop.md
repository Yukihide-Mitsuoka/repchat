---
id: meeting-decision-loop-requirements
title: 会議意思決定ループ要件
status: draft
updated: 2026-08-10
---

# 会議意思決定ループ要件

この文書は、根拠付き会議報告を、会議前の論点整理、会議中の意思決定、会議後の施策管理、次回の
効果検証まで接続する将来要件として定義する。現在のローカル会議報告プロトタイプを製品実装済みと
扱わず、Issue [#181](https://github.com/Yukihide-Mitsuoka/repchat/issues/181)以降の実装判断に使う。

## 1. 用語

| 用語 | 定義 |
|------|------|
| 意思決定カード | 会議で承認、修正、保留、却下する一つの論点。根拠、期待効果、確信度、必要な判断を持つ |
| 会議パック | 1分報告、意思決定カード、改善シナリオ、想定問答、根拠を同じreport revisionに固定した表示単位 |
| 改善シナリオ | 検証済みの式と明示した仮定を使い、指標変更時の結果を計算する比較案 |
| 決定記録 | 人間が会議で承認、修正、保留、却下した結果と、その理由を保存した不変revision |
| アクション | 決定から作成する、担当、期限、期待効果、次の一歩、成功指標、停止条件を持つ施策 |
| 効果検証 | 次回以降の検証済み結果を用いて、アクションの実施状況と指標変化を評価すること |

## 2. 前提と制約

| ID | 種別 | 内容 | 誤っていた場合の影響 |
|----|------|------|----------------------|
| A-1 | 検証対象の仮説 | 一般的な要約より、会議で決める論点と次回検証まで管理できる方が、反復する月次報告の利用価値が高い | design partnerが望まなければ意思決定管理を実装しない |
| A-2 | 前提 | 同じ顧客・分析対象について会議と施策が反復される | 単発分析が中心なら会議パックだけを残し、履歴機能を後回しにする |
| C-1 | 制約 | Issue #160が`proceed`になるまで製品実装しない | 今回は要件記録だけを行う |
| C-2 | 制約 | 数値主張は検証済みpanel、query、result revisionへ追跡できなければ表示しない | AI文章を根拠の代替にしない |
| C-3 | 制約 | AIは目標値、因果、予算、担当、期限、施策履歴を推測しない | 不足情報は確認、未設定、または仮説として表示する |
| C-4 | 制約 | 改善シナリオはversion付きのserver-side式だけで計算し、AIの自由計算を採用しない | 数式、入力値、丸め、仮定を再現可能にする |
| C-5 | 制約 | AIは決定者または承認者にならず、外部配布とアクション確定には人間の承認を必要とする | 誤った提案を組織の決定として扱わない |
| C-6 | 制約 | 前回の決定、アクション、組織コンテキストは認証済みtenant・analysis subjectのscope一致後だけ参照する | 顧客間または分析対象間の誤適用を防ぐ |

## 3. 目的と範囲

- **目的:** 検証済みダッシュボードを、会議で必要な意思決定と担当付きアクションへ変換し、次回の結果で
  その判断を検証できるようにする。
- **成功指標:**

  | 指標 | 目標 | 測定方法 |
  |------|------|----------|
  | 根拠のない数値主張 | 0件 | report・scenario・Q&Aのprovenance検査 |
  | 未承認の外部配布または決定確定 | 0件 | 状態遷移テスト、監査照合 |
  | アクションの必須項目充足 | 100% | schema検査 |
  | 会議で決める最優先論点の識別 | pilot参加者が60秒以内に補助なしで識別 | usability test |
  | 反復利用 | 同じ分析対象の定例会議で3回連続利用 | design partner pilot |
  | 前回アクションの追跡可能性 | 保存済みアクションの100% | decision・action・result revision照合 |

- **対象:** 会議パック、意思決定カード、検証可能な改善シナリオ、根拠限定Q&A、人間の決定記録、
  担当付きアクション、次回の効果検証、承認・監査。
- **対象外:** 会議録音、音声からの自動決定、AIによる自動承認、任意式の実行、根拠のない予測、
  外部タスク管理サービスとの同期、Issue #160判定前の製品実装。
- **関係者:** 編集者は会議パックを作成し、意思決定者は決定とアクションを承認する。アクション担当者は
  実施状況を更新する。閲覧者は承認済み内容を閲覧する。AIは案を生成するが承認しない。

## 4. 機能要件

| ID | 要件 | 目的 | 優先度 | 根拠 |
|----|------|------|--------|------|
| FR-001 | 会議パックの先頭に、最大3件の「今日決めること」を優先順で表示する | 意思決定 | Must | 要約だけでは利用者の次の行動が決まらない |
| FR-002 | 1分報告、今日決めること、改善シナリオ、想定問答、根拠を同じrevision内で切り替える | 理解 | Must | 業務説明と技術来歴を分離する |
| FR-003 | 観測、解釈、未検証の仮説、推奨アクションを分離し、各数値主張をevidence referenceへ結び付ける | 根拠0件 | Must | Issue #181の境界を維持する |
| FR-004 | 意思決定カードは必要な判断、根拠、期待効果、確信度、不確実性、代替案を表示する | 意思決定 | Must | 承認対象と判断材料を明確にする |
| FR-005 | 改善シナリオは式revision、入力値、仮定、出力、丸め、参照panelを保存し、仮定変更時だけ再計算する | 再現性 | Must | AIの自由計算を避ける |
| FR-006 | 根拠bundleにない質問には数値を生成せず、不足する分析または確認事項を返す | 根拠0件 | Must | 会議中Q&Aの幻覚防止 |
| FR-007 | 人間は意思決定カードを承認、修正、保留、却下でき、その理由を決定記録として保存できる | 人間統制 | Must | AIを承認者にしない |
| FR-008 | 承認した決定から、担当、期限、期待効果、次の一歩、成功指標、停止条件を持つアクションを作成する | 実行 | Must | 推奨を実施可能な単位へ変換する |
| FR-009 | 次回の会議パックは前回アクションの実施状況、指標変化、継続・修正・中止の候補を表示する | 効果検証 | Must | 反復会議で学習を閉じる |
| FR-010 | 目標、比較期間、施策履歴、担当、期限が無い場合は推測せず、必要性に応じて確認または未設定表示にする | 誤推測防止 | Must | C-3 |
| FR-011 | 1分報告は読み上げ可能な日本語とし、結論、根拠、不確実性、必要な判断を含める | 会議準備 | Should | 会議冒頭の説明時間を短縮する |
| FR-012 | 想定問答は凍結したevidence bundleと承認済み組織コンテキストだけを参照し、回答ごとに根拠または回答不能理由を示す | 会議支援 | Should | ライブQ&Aでも検証境界を維持する |
| FR-013 | 外部配布前に承認状態を確認し、draftを共有しようとした場合は停止する | 人間統制 | Must | Issue #181 |
| FR-014 | 生成、修正、承認、保留、却下、アクション変更、効果評価を監査イベントとして記録する | 監査 | Must | 再現性と責任分界 |
| FR-015 | 承認済みaction revisionを、別permissionでAction Packageへ発行し、外部status・実績を次回評価へ戻せる | 外部handoff | Should | 外部実行をCoreへ持ち込まず転記を減らす |

### 4.1 状態と遷移

`evidence frozen → draft generated → review pending → approved/rejected/superseded`

`decision approved → action proposed → owner accepted → in progress → completed/cancelled → evaluated`

- 新しいreport revisionは過去の承認済みreportを上書きしない。
- アクション変更は新revisionとして保存し、元の決定との対応を維持する。
- evidence、組織コンテキスト、指標定義の互換性が失われた場合は再生成または再承認を要求する。

### 4.2 表示順

1. 1分報告
2. 今日決めること
3. 改善シナリオ
4. 想定問答
5. 根拠・SQL・集計データ

技術的なrevisionとSQL hashは根拠画面へ置き、会議本文へ常時表示しない。

## 5. 非機能要件

| ID | 特性 | 要件 | 目標 | 検証方法 | 優先度 |
|----|------|------|------|----------|--------|
| NFR-001 | セキュリティ | tenant、analysis subject、roleを越えたreport・decision・action参照を拒否する | 越境0件 | RLS・authorization・負のE2E | Must |
| NFR-002 | 正確性 | 数値とscenario出力をevidenceまたはversion付き式へ追跡できる | 100% | provenance validator | Must |
| NFR-003 | 利用性 | 最優先の判断、根拠、次のアクションを非エンジニアが識別できる | 60秒以内 | pilot task test | Must |
| NFR-004 | 説明可能性 | AI出力、式、仮定、適用context、修正、承認を再現できる | 100% | audit reconciliation | Must |
| NFR-005 | 可用性 | 報告生成またはQ&A障害時も承認済みdashboardとreportを閲覧できる | last-known-good継続 | 障害注入試験 | Must |
| NFR-006 | data protection | 生の会議音声と自由会話本文を既定で永続保存しない | 正本tableへの保存0件 | schema・log review | Must |
| NFR-007 | アクセシビリティ | タブ、意思決定、承認、根拠移動をキーボードと読み上げで操作できる | 主要操作100% | accessibility test | Should |

## 6. データ要件

| 観点 | 仕様 |
|------|------|
| データモデル | `meeting_report_revisions`、`decision_proposals`、`decision_records`、`action_items`、`action_revisions`、`action_evaluations`、`scenario_calculations`、`evidence_refs` |
| revision | report、decision、action、scenarioを不変revisionで保存し、元のanalysis specification、build、result、organization contextへ結び付ける |
| 保持・削除 | [適応型分析メモリー要件](adaptive-analysis-memory.md)のtenant契約、監査、解約時削除に従う。生の会話または会議音声を既定で保持しない |
| 機密性 | 会議の決定、担当、施策、結果は顧客データとしてtenant境界内で扱う |
| Git境界 | 顧客Gitへ個人の担当・承認履歴を保存しない。公開artifactには許可されたreportと参照revisionだけを含める |

## 7. 外部インターフェースと依存関係

| system・機能 | 方向 | 契約 | 開始条件・障害時 |
|-------------|------|------|-----------------|
| Issue #180 分析仕様・build | 読取 | analysis specification、build revision、evidence bundle | revision不一致なら生成停止 |
| Issue #179 閲覧・来歴UX | 双方向 | panel、根拠、SQLへの文脈付き移動 | 根拠画面が無ければ外部配布しない |
| 適応型分析メモリー | 読取 | 組織コンテキスト、報告方針、前回の決定・アクションを選ぶscope付きmanifest | 期限切れまたはscope不明なら適用停止 |
| 指標定義層 | 読取 | metric definition ID・version、許可されたderived metric | 未定義なら確認または拒否 |
| 認証・role | 読取 | server-side tenant、analysis subject、user、role | Issue #194に依存しfail closed |
| 外部配布 | 出力 | 承認済みreport revisionと認可付きlink | draftまたは監査失敗時は配布停止 |
| 施策パッケージAPI | 出力・入力 | 承認済みaction revision、外部status・実績 | [専用要件](action-package-api.md)とADR-0023に従い、広告・決済を実行しない |

## 8. インフラと費用

- 既存のAI生成、Postgres control plane、artifact、監査基盤を使い、この要件だけを理由に新しい
  vector DBまたはin-memory DBを追加しない。
- 会議パック生成、想定問答、scenario計算を別費用単位として計測する。自動再生成は行わない。
- scenario計算はserver-sideの決定的処理とし、計算自体のLLM tokenを不要にする。
- 永続化量、Q&A回数、生成時間、利用頻度をpilotで測り、SLAと月額原価を実装Issueで確定する。

## 9. 運用要件

| 観点 | 要件 |
|------|------|
| monitoring | 根拠拒否、scope拒否、承認待ち、配布拒否、アクション期限、効果評価未完了を計測する |
| incident | 誤ったreportまたはdecisionはrevokeし、影響を受けた閲覧者とartifactを監査から特定する |
| rollback | 直前の承認済みreportとaction revisionへ参照を戻せるようにする |
| migration | 現在のローカル報告案を承認済み決定または履歴へ自動変換しない |

## 10. 受入条件

| ID | 条件 | 対応要件 | 検証方法 |
|----|------|----------|----------|
| AC-1 | 会議パックから最優先の意思決定、根拠、次のアクションを60秒以内に識別できる | FR-001、002、011、NFR-003 | design partner usability test |
| AC-2 | 数値、scenario、Q&A回答が参照evidenceまたは式revisionに無ければ表示前に拒否される | FR-003、005、006、NFR-002 | contract・改ざんテスト |
| AC-3 | AIが生成した意思決定またはアクションは人間の承認なしに確定・外部配布されない | FR-007、008、013 | 状態遷移・E2E |
| AC-4 | 承認済み決定から必須項目を持つアクションを作成し、次回の検証済み結果で評価できる | FR-008、009 | 2期間scenario test |
| AC-5 | 前回未実施、結果不明、指標悪化を成功として扱わず、それぞれ区別して表示する | FR-009、010 | fixture test |
| AC-6 | tenant、analysis subject、roleを越えるreport、decision、action、Q&A参照が拒否される | C-6、NFR-001 | RLS・負のE2E |
| AC-7 | reportから利用したanalysis specification、build、result、context、formula、decision revisionを再現できる | FR-014、NFR-004 | audit reconciliation |
| AC-8 | 同じ分析対象の定例会議で3回連続利用し、継続・修正・中止の判断を記録できる | A-1、A-2、FR-009 | design partner pilot |

## 11. リスク

| ID | リスク | 確率 | 影響 | 緩和 |
|----|--------|------|------|------|
| R-1 | AI提案が人間の決定として受け取られる | 中 | 高 | draft表示、承認分離、確信度、不確実性、監査 |
| R-2 | scenarioが予測値として誤解される | 高 | 高 | 仮定と式を常時表示し、実績予測と呼ばない |
| R-3 | 古い目標または施策履歴を適用する | 中 | 高 | scope、revision、見直し日、期限切れ時停止 |
| R-4 | 入力・承認作業が増えて会議準備を短縮できない | 中 | 中 | 最大3論点、既定値、pilotで操作時間を測定 |
| R-5 | 会議内容に個人情報または機密な施策が含まれる | 中 | 高 | tenant境界、role、最小保持、Git非保存、削除 |
| R-6 | Q&Aがevidence外の質問へもっともらしく回答する | 高 | 高 | frozen bundle、根拠必須、回答不能fallback |

## 12. 実装時期

| phase | 範囲 | 開始条件 |
|------|------|----------|
| Phase 0 — 要件記録 | 本文書、Issue #181との境界、将来の評価指標 | 今回。実装なし |
| Phase 1 — 意思決定中心の会議パック | FR-001〜006、010〜012。1分報告、最大3論点、検証可能scenario、根拠Q&A | Issue #160=`proceed`、#179/#180のrevision・閲覧契約が安定、Issue #181の根拠付き報告が製品経路へ接続 |
| Phase 2 — 決定・アクション管理 | FR-007〜009、013、014。承認、決定記録、アクション、監査、次回評価 | 適応型分析メモリーPhase 1と本番role・認証が完成 |
| Phase 3 — 定例会議pilot | 3回連続利用、操作時間、継続判断、原価測定 | Phase 2の境界・監査テストが成功 |
| Phase 4 — 外部連携 | Action Package、タスク管理連携、Slack通知、会議中の追加interface | pilotで反復需要が確認され、[専用要件](action-package-api.md)とADR-0023を承認 |

## 13. 未決事項

| ID | 問い | block対象 | owner | 必要時期 |
|----|------|-----------|-------|----------|
| Q-1 | 意思決定とアクションの承認権限を既存3段roleへどう割り当てるか | Phase 2 | repository owner | Issue #194の認証・role決定時 |
| Q-2 | 最初に許可するscenario式をどのKPIへ限定するか | Phase 1 | product owner、design partner | Issue #181製品実装前 |
| Q-3 | 3回連続pilotで比較する現行の会議準備時間と品質指標をどう測るか | Phase 3 | design partner、repository owner | pilot計画時 |
