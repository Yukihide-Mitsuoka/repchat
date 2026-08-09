---
id: adr-0022
title: 版管理パネルから派生ダッシュボードを合成する
status: proposed
updated: 2026-08-09
---

# ADR-0022: 版管理パネルから派生ダッシュボードを合成する

| Field | Value |
|-------|-------|
| Status | proposed |
| Date | 2026-08-09 |
| Deciders | repository owner |
| Author | Codex |
| Supersedes / Superseded by | —。ADR-0014/0015の成果物所有・配送境界を維持し、panelとdashboardのrevision構成を追加する |

## Context

Issue #180は、利用者がAIと分析目的を相談し、分析仕様を確定してから複数panelのdashboardをbuildする。
一方、利用企業が他のBIを持たない場合は、技術者が自作したSQL、またはAI生成SQLを調整した結果も同じ製品で
可視化し、AI生成panelと一元管理したい需要があり得る。

AI生成dashboardを直接編集すると、確定した分析仕様、生成理由、SQL、検証結果の対応が崩れる。AIによる再生成で
利用者の変更が失われる可能性もあり、どの結果を会議報告の根拠にしたかを再現できない。反対に、SQL workspaceを
dashboard生成と無関係な機能にすると、利用者が作成したpanelとAI生成panelを安全に同じ画面へ配置できない。

ADR-0014/0015はページ、SQL、manifestを顧客成果物とし、1つの検証・build・有効化pipelineで顧客Gitへ配送すると
決めている。顧客Gitは所有と監査の境界であり、未検証SQLを直接有効化する経路ではない。Issue #179は閲覧画面と
SQL来歴の確認面を分離し、Issue #180は対話からimmutableな分析仕様revisionを作る。この判断は、その両方から
利用するpanel/dashboard revisionと利用者編集の境界を定義する。

## Options considered

### Option 1: AI生成dashboardだけを提供する

対話生成の目的と実装範囲が最も明確である。一方、AIが表現できない顧客固有SQLや技術者による調整を同じ製品へ
取り込めず、利用企業が別のBIまたは手作業の管理経路を維持する必要がある。

### Option 2: AI生成dashboardとSQLをその場で上書き編集する

利用者には理解しやすく、追加の成果物型も少ない。しかし分析仕様と生成結果の対応を失い、再生成、rollback、監査、
会議報告の根拠固定が不安定になる。AI変更と利用者変更の責任も区別できないため採用しない。

### Option 3: 利用者が完成したgraphをコピーして別dashboardへ貼る

SQL workspaceとdashboard生成を疎結合にできる。一方、SQL、metric revision、検証状態、data revisionとのlineageが
切れ、元panelの更新や権限変更を追跡できない。画像または結果dataの複製も古い値の配信につながるため採用しない。

### Option 4: panelを不変revisionとして管理し、派生dashboardから合成する

AI生成原本を維持しながら、利用者作成、参照追加、fork編集を明示的に区別できる。revision、lineage、認可、費用、
互換性判定の実装は増えるが、元の分析目的を保ったまま段階的に追加・rollbackできるため採用を提案する。

## Decision

Option 4を提案する。repository ownerが本ADRを承認し、Issue #160が`proceed`になるまで製品実装を開始しない。

### D1. panelを独立した不変revisionにする

`PanelRevision`を再利用可能な最小成果物とする。少なくとも次を持つ。

- 安定した`panel_id`と不変の`panel_revision_id`
- `origin`: `ai_generated`、`user_authored`、`user_forked`
- fork元の`parent_panel_revision_id`、作成者、作成時刻
- 分析仕様revisionまたは作成目的への参照
- source SQL、SQL hash、参照table、認可済みscope hash
- chart type、axis、series、format、title、output shape
- metric、schema、datasource、dataの各revisionまたはversion
- dry run、実行、結果形状、参照値等の検証状態

query result自体はpanel定義と同一視せず、`result_revision_id`で関連付ける。panelのtitleまたはlayoutだけを変更する
場合も、既存revisionを上書きせず新しいrevisionを作る。

### D2. AI生成dashboardを不変の原本にする

確定した分析仕様からbuildした`DashboardRevision`は`origin=ai_generated`として変更しない。画面上で
「このdashboardをカスタマイズ」を提供しても、内部では元revisionを親に持つ`user_composed`の派生draftを作る。
元のAI生成dashboard、分析仕様、生成理由、検証結果は残す。

`DashboardRevision`は少なくとも、親dashboard revision、固定した`panel_revision_id`の一覧、layout、読者、
対象期間、timezone、data freshness方針をmanifestとして持つ。公開済みrevisionは上書きせず、編集と公開のたびに
新しいrevisionを作る。

### D3. panelの参照追加とfork編集を区別する

利用者は次の操作を選べる。

1. **参照追加:** 既存の`panel_revision_id`を変更せず、別dashboardへ配置する。
2. **fork編集:** 元revisionを親に持つ新しいpanelを作り、SQLまたは表示設定を編集する。
3. **新規作成:** SQL workspaceで利用者作成panelを作り、空または派生dashboardへ配置する。

参照追加したpanelは元revisionの新しい版へ自動追随しない。新revisionはupgrade候補として差分、検証状態、想定費用を
表示し、利用者が明示的に採用したときだけ新しいdashboard revisionへ反映する。

### D4. AI conversation、SQL workspace、dashboard editorの責務を分離する

| Surface | 所有する責務 | 所有しない責務 |
|---------|--------------|----------------|
| AI conversation | 目的の分解、KPI・panel候補、分析仕様revision、AI生成dashboard | 利用者SQLの逐次編集、自由layout |
| SQL workspace | SQL作成・fork編集、dry run、費用確認、preview、panel revision作成 | dashboard全体の分析目的、公開layout |
| Dashboard editor | panel参照、fork開始、追加・削除・並べ替え、制約付きlayout、公開revision | SQL検証の迂回、AI生成原本の上書き |

この分離により、対話によるdashboard生成をAIの分析提案として維持しながら、利用者が調整したコードとAI生成panelを
派生dashboardで共存させる。

### D5. 利用者SQLをuntrusted inputとして検証する

利用者作成またはforkしたSQLも、AI生成SQLと同じ認可・実行境界を通す。初期は検証済みread-only SQLだけを許可し、
AST、参照table allowlist、tenant、scope、data location、statement数、scan上限、`SELECT *`禁止、DDL/DML禁止を
server側で強制する。previewと公開buildは別の有料実行になり得るため、それぞれの推定費用と上限を実行前に表示する。

権限は「panelを作成する」「dashboardを編集する」「revisionを公開する」を別permissionとして定義する。既存の
管理者／編集者／閲覧者へどう割り当てるかはIssue #194の認証・role設計で決め、個人の接続credentialを実行主体に
しない。

### D6. governed panelとcustom panelを区別する

ADR-0013の共有指標定義に解決でき、参照値検証を通ったpanelを`governed`とする。利用者固有SQLまたは未検証指標を
含むpanelは`custom`として、作成者、検証範囲、未検証事項を閲覧・来歴画面に表示する。custom panelを暗黙に
共有指標定義または分析メモリーへ昇格させない。

custom panelも顧客成果物として保存できるが、認可・検証済みrevisionだけを公開対象にする。会議報告は参照した
panel revisionとresult revisionを固定し、検証状態を根拠とともに保持する。

### D7. dashboard合成時に互換性を検査する

同じdashboardへ配置するpanelは、少なくともtenant、scope、datasource、対象期間、timezone、schema revision、
metric revision、data version、freshnessが互換でなければならない。不一致を自動で無視しない。

比較可能な期間差等は明示的な分析意図としてmanifestへ記録する。それ以外の不一致は、同一buildで再実行してdata
versionを揃える、警告付きdraftに留める、または公開を拒否する。異なるtenantまたは認可scopeの結果を同じpanelや
dashboardへ合成しない。

### D8. ArtifactBundleと顧客Gitは共通pipelineを維持する

ArtifactBundleは、panel revision、dashboard composition manifest、SQL、lineageを同じrevisionで結び付ける。
顧客Gitとmanaged fallbackはADR-0015の共通生成・検証・build・有効化pipelineを使い続ける。Web上の編集は
`validate → preview → publish → customer Git`を通し、Gitの直接編集を認可・検証・費用確認の迂回経路にしない。

初期customizationは、検証済みread-only SQL、対応済みchart、axis/series/format/title、panelの追加・削除・fork・
並べ替え、制約付きgrid layoutに限定する。任意HTML、JavaScript、CSS、repository supplied codeを実行しない。

### D9. 定義の再利用とquery resultの再利用を分ける

同じpanel revisionを複数dashboardで参照しても、query resultを無条件に共有しない。tenant、scope hash、query hash、
data version、freshness条件がすべて一致する場合だけ既存result revisionを再利用できる。異なる場合は再実行費用を
確認する。dashboard build内の共有中間結果はADR-0021の実測gateに従い、本ADRを理由に標準化しない。

### D10. 実装順序を固定する

1. Issue #160を`proceed`に分類する。
2. Issue #179で閲覧・来歴・deep linkのinteractionと認可境界を確定する。
3. Issue #180でanalysis specification、dashboard、panel、resultのrevision関係と非同期buildを確定する。
4. SQL workspaceと派生dashboard compositionを別の実装Issueへ分割する。
5. design partnerの利用頻度と失敗例から、upgrade、review、Git workflowを段階的に追加する。

## Consequences

**Positive:**

- AI生成dashboardを監査可能な原本として残し、利用者調整との責任を区別できる。
- AI生成panelと利用者作成panelを、SQL・metric・検証・resultのlineageを失わず一元管理できる。
- 参照追加、fork、明示的upgradeにより、再生成または他dashboardの変更が既存表示を黙って変えない。
- SQL workspaceを追加しても、対話による分析提案とdashboard生成の責務を維持できる。

**Negative:**

- panel/dashboard/resultのrevision、互換性検査、権限、差分UI、公開workflowが増える。
- 同じpanel定義を参照しても、scopeまたはdata versionが異なれば実行費用は減らない。
- custom panelはgoverned panelより品質保証が弱く、利用者が状態差を理解できる表示とreviewが必要になる。
- pinned revisionは再現性を上げる一方、修正済みpanelへのupgradeを明示的に管理する運用が必要になる。

**Follow-ups:**

- repository ownerが本ADRを承認、修正または却下する。
- Issue #179/#180の設計成果からAPI、data model、ArtifactBundle schemaを具体化する。
- Issue #160が`proceed`になるまで、SQL workspaceまたはdashboard compositionを製品実装しない。
- design partnerへ「参照追加」「fork」「空dashboard」の理解可能性と実際の調整頻度を確認する。

## Rollback

custom composition capabilityを無効化し、AI生成dashboard revisionだけを公開対象へ戻す。AI生成原本は変更されず、
派生dashboardとcustom panelも不変revisionとして残るため、監査履歴を失わず機能を停止できる。

## References

- [Issue #308](https://github.com/Yukihide-Mitsuoka/repchat/issues/308)
- [Issue #179](https://github.com/Yukihide-Mitsuoka/repchat/issues/179)
- [Issue #180](https://github.com/Yukihide-Mitsuoka/repchat/issues/180)
- [Issue #160](https://github.com/Yukihide-Mitsuoka/repchat/issues/160)
- [ADR-0013](0013-metric-definitions-live-in-our-own-layer.md)
- [ADR-0014](0014-who-owns-the-generated-artifacts.md)
- [ADR-0015](0015-publish-artifacts-through-customer-git.md)
- [ADR-0021](0021-gate-shared-intermediates-on-measured-build-cost.md)
