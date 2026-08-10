---
id: analysis-workspace-ui-requirements
title: 要件定義 — 分析ワークスペースUI
status: draft
updated: 2026-08-11
---

# 要件定義 — 分析ワークスペースUI

この文書は、ChatGPT系デスクトップUIを参考にしながら、RepChatの分析相談、ダッシュボード閲覧、
SQL来歴確認、会議報告を一つの再現可能なワークスペースへ配置する製品要件を定義します。
[Issue #179](https://github.com/Yukihide-Mitsuoka/repchat/issues/179)の情報設計成果を所有し、
ローカルデモの現状説明は[デモ手順](../demo.md)を正本とします。

## 1. 用語

| 用語 | 定義 |
|------|------|
| 分析ワークスペース | 一つの利用企業・認可scope内で、分析対話、ダッシュボード、会議報告、来歴を扱うUI上の作業単位 |
| 左ナビゲーション | ワークスペース、成果物、分析履歴、アカウント導線を持つ主選択領域 |
| メインサーフェス | 現在選択したダッシュボード、分析対話、会議報告、単一グラフを表示する主作業領域 |
| インスペクター | 選択中のパネルに従属する理由、定義・検証、SQL、取得データ、来歴を表示する右側の二次領域 |
| パネル | KPI、グラフ、表の一つと、そのSQL・定義・検証・revisionを結び付けた成果物 |
| 分析スレッド | 一つの分析目的について、質問、回答、分析仕様revision、buildを結ぶ対話単位 |
| 分析コレクション | 関連するダッシュボードと分析スレッドを整理する利用者向けディレクトリ。GCP projectやtenantではない |
| push | 左右領域がメインサーフェスの幅を縮めて同じgrid内へ表示される配置 |
| overlay | 左右領域がメインサーフェスの上へ重なり、背後の操作を一時的に制限する配置 |
| 出典区分 | `Official`、`Observed`、`Owner intent`、`RepChat decision`のいずれか。外部製品の事実と本製品の判断を分離する |

## 2. 前提と制約

| ID | 種別 | 内容 | 誤っていた場合の影響 |
|----|------|------|----------------------|
| A-1 | 前提 | 初期利用者は、複数顧客へ分析を提供する日本の小規模代理店・ソフトウェアベンダーの担当者である | 左ナビゲーションの顧客・分析整理単位を再設計する |
| A-2 | 前提 | 利用者はダッシュボード閲覧を最頻操作とし、SQL編集より先に結論と根拠を確認する | メインサーフェスの既定画面を再評価する |
| A-3 | 前提 | デスクトップまたは横長Webが編集者の主端末で、モバイルは閲覧・確認が中心である | モバイル編集要件を別途追加する |
| C-1 | 制約 | ChatGPTの商標、文章、アイコン、非公開design token、DOM/CSSを複製しない。公開情報から得た情報構造だけを参考にする | ブランド混同と継続的な追随負債を避ける |
| C-2 | 制約 | テナント、分析コレクション、GCP project、顧客Git repositoryを同一概念として扱わない | 認可境界と保存先の混同を防ぐ |
| C-3 | 制約 | SQL、取得データ、来歴は権限を持つ利用者だけへ表示する | Issue #179の認可要件を守る |
| C-4 | 制約 | Issue #160が`proceed`になるまで、この文書を根拠に製品UIを先行実装しない | デモ検証前の過剰実装を防ぐ |
| C-5 | 制約 | 永続履歴、Git branch操作、アカウント設定をローカルデモで実装済みと表示しない | デモ能力と製品要件を区別する |

## 3. 目的と範囲

- **目的:** 利用者が分析の整理、相談、成果閲覧、根拠確認、会議報告を、選択文脈を失わずに行える
  一貫したデスクトップワークスペースを定義する。
- **成功指標:**

  | 指標 | 目標 | 測定方法 |
  |------|------|----------|
  | グラフから対応SQLへ到達 | 初見利用者の80%以上が10秒以内、2操作以内 | 5名以上のタスクテスト |
  | 主要操作の発見 | 初見利用者の80%以上が、新しい分析、既存ダッシュボード、会議報告を各20秒以内に発見 | 5名以上のタスクテスト |
  | 文脈保持 | インスペクターを開閉しても選択パネル、スクロール位置、表示revisionが100%維持される | 自動E2Eとvisual regression |
  | レイアウト安定性 | 対象viewportと左右状態の全組合せで、主見出しが縦書き化せず、横方向の意図しないoverflowが0件 | §8の状態行列を自動撮影 |
  | キーボード操作 | 開閉、移動、リサイズ、タブ切替、復帰をマウスなしで完了 | アクセシビリティE2E |

- **対象:** app shell、左ナビゲーション、メインサーフェス、右インスペクター、overlay、状態、responsive、
  keyboard、deep link、RepChat機能との対応。
- **対象外:** 本番認証方式、課金区分、永続対話DB、GitHub App実装、自由SQL editor、AI生成品質、
  ChatGPTのpixel-perfect複製。
- **関係者:**

  | 役割 | 関心 | 決定権 |
  |------|------|--------|
  | リポジトリオーナー | 製品方針、優先順位、UI受入 | 最終承認 |
  | 分析編集者 | 相談、build、SQL・来歴確認 | 操作性の評価 |
  | 閲覧者 | ダッシュボードと承認済み報告の閲覧 | 閲覧性の評価 |
  | 管理者 | 利用者、データソース、Git接続 | 設定・権限境界の評価 |

## 4. 調査根拠

### 4.1 出典台帳

| ID | 区分 | 2026-08-10時点で確認した内容 | URL |
|----|------|------------------------------|-----|
| SRC-01 | Official | デスクトップshellは永続sidebar、安定したdetail、二次情報用inspector、toolbar、shortcut、独立Settingsに責務分離する | [Build a Mac app shell](https://learn.chatgpt.com/use-cases/macos-sidebar-detail-inspector) |
| SRC-02 | Official | dashboardはchartからではなく意思決定、KPI階層、定義、品質検査、owner、監視、公開riskから設計する | [Plan a dashboard and monitoring workflow](https://learn.chatgpt.com/use-cases/dashboard-builder-monitor) |
| SRC-03 | Official | 曖昧な分析依頼は、business question、定義、source、join、期間、読者を確認した分析契約へ変換する | [Scope an analytics request](https://learn.chatgpt.com/use-cases/analytics-request-agent) |
| SRC-04 | Official | KPI変動の説明では確定driver、仮説、反証、品質制約、source link、次の確認を分離する | [Analyze KPI root causes](https://learn.chatgpt.com/use-cases/kpi-root-cause-analysis) |
| SRC-05 | Official | business reviewはKPI、定義、過去報告、owner noteを使い、重要数値をsourceへ結び付けて未支持主張を除外する | [Prepare a business review](https://learn.chatgpt.com/use-cases/monthly-business-review-narrative) |
| SRC-06 | Observed | 公開・未ログインのChatGPT日本語画面に、sidebar開閉、新しいチャット、チャット検索、画像、Plugins、Deep Research、設定、Help、composerが存在する | [ChatGPT公開画面](https://chatgpt.com/) |
| SRC-07 | Owner intent | 左右paneの開閉・drag、左上の検索・menu、中段のproject・履歴、左下のaccount・settings、中央との重なりを要件化する | この依頼 |
| SRC-08 | RepChat decision | 現行デモは左右pane、4 workspace、panel inspector、費用確認を実装済み。製品要件は現行コードから独立して理想を定義する | [Issue #328](https://github.com/Yukihide-Mitsuoka/repchat/issues/328)、[PR #330](https://github.com/Yukihide-Mitsuoka/repchat/pull/330) |

### 4.2 証拠の扱い

- `Official`はOpenAI公式資料が説明する責務やworkflowだけを根拠にする。ChatGPT固有の寸法とは扱わない。
- `Observed`はURL、locale、認証状態、観測日を固定する。SRC-06は日本語、未ログイン、2026-08-10のDOM観測である。
- `Owner intent`は製品要望であり、外部製品の事実として引用しない。
- 寸法、breakpoint、motion、menu順はすべて`RepChat decision`として以下に固定する。

## 5. 機能マッピング

| 参照UI／workflow | RepChatの責務 | 現在のデモ | 製品要件 |
|------------------|---------------|------------|----------|
| New chat | 新しい分析スレッドを作る | 既定設問の再入力 | NAV-002、MAIN-002 |
| Search chats | 認可scope内のダッシュボード・分析スレッドを検索 | 未実装 | NAV-003 |
| Projects | 顧客別または目的別の分析コレクション | 将来機能の文言だけ | NAV-005。tenantとは分離 |
| Chat history | 分析スレッドと分析仕様revisionの履歴 | 起動中の固定表示だけ | NAV-006 |
| Center conversation | AIと目的、KPI、比較、読者、panel候補を相談 | 作成・編集view | MAIN-002、Issue #180 |
| Artifact/detail | 完成ダッシュボードまたは会議報告を主表示 | dashboard/report view | MAIN-001、MAIN-003 |
| Inspector | 選択panelの理由、定義、SQL、data、lineage | 理由、SQL、data、来歴の4タブ | INS-001〜INS-007 |
| Settings | account、表示、data source、members、Git接続 | 未実装 | NAV-008、OVR-003 |
| Dashboard planning | 意思決定からKPI階層とpanel構成を決める | 最大6panelの対話prototype | MAIN-002、SRC-02 |
| Analytics request scoping | 曖昧さを確認してanalysis specificationをfreezeする | 確認事項とrevisionを表示 | MAIN-002、SRC-03 |
| KPI root-cause brief | 観測、解釈、仮説、反証、次の検証を分ける | 会議報告prototypeの一部 | MAIN-003、SRC-04 |
| Business review | 根拠付き会議報告とowner action | 未承認案を生成 | MAIN-003、SRC-05、Issue #181 |

## 6. UIインベントリと機能要件

機能要件IDはUI領域ごとのnamespace（`APP-*`、`NAV-*`、`MAIN-*`、`INS-*`、`OVR-*`）を使い、
この文書内で変更せずに維持します。非機能要件は`NFR-*`、受入条件は`AC-*`で識別します。

### 6.1 App shell

| ID | 要件 | 目的 | 優先度 | 根拠 |
|----|------|------|--------|------|
| APP-001 | app shellは`AppHeader`、`PrimaryNavigationPane`、`MainSurface`、`InspectorPane`、`OverlayHost`の5領域を持つ | 文脈保持 | Must | SRC-01 |
| APP-002 | headerは高さ52pxでstickyとし、左にsidebar toggleと製品名、中央に組織／分析コレクション／成果物breadcrumb、右に状態・共有／公開・inspector toggleを置く | 発見性 | Must | RepChat decision |
| APP-003 | 左右paneがpush状態でも`MainSurface`をDOM上の明示的な中央grid列に保ち、閉じたpaneは0pxにする | レイアウト安定性 | Must | PR #332 |
| APP-004 | route、選択panel、表示revisionをURLで表現し、再読込、back、forward、共有linkで復元する | 文脈保持 | Must | Issue #179 |
| APP-005 | viewer、editor、adminで利用不能な機能は、存在を隠すか理由付きdisabledにする。クリック後に権限エラーを初めて出さない | 安全性 | Must | C-3 |

推奨component treeを実装契約とします。

```text
AppShell
├── AppHeader
│   ├── PrimaryNavigationToggle
│   ├── WorkspaceBreadcrumb
│   ├── ArtifactStatus
│   └── InspectorToggle
├── PrimaryNavigationPane
│   ├── NavigationHeader
│   ├── PrimaryActions
│   ├── Collections
│   ├── RecentAnalysisThreads
│   └── AccountControl
├── MainSurface
│   └── Dashboard | BuildConversation | MeetingReport | SingleChart
├── InspectorPane
│   └── Reason | Definition | SQL | Data | Provenance
└── OverlayHost
    └── Search | AccountMenu | Settings | CostConfirm | ConfirmDialog | Tooltip
```

### 6.2 左ナビゲーション

| ID | 要件 | 優先度 |
|----|------|--------|
| NAV-001 | 左paneはdesktopで既定220px、最小180px、最大360pxとし、開閉とdrag resizeを提供する | Must |
| NAV-002 | 固定上部に「新しい分析」を置き、選択中の利用企業・認可scopeを引き継いだ空の分析スレッドを作る | Must |
| NAV-003 | 固定上部に検索を置き、許可されたダッシュボード、会議報告、分析スレッドのtitleとmetadataだけを検索する。SQL本文、結果値、他tenantは既定検索対象外とする | Must |
| NAV-004 | 主ナビゲーションの順序を「ダッシュボード」「作成・編集」「会議報告」「単一グラフ」とする | Must |
| NAV-005 | 中央scroll領域に分析コレクションを表示し、展開時に配下のダッシュボードと分析スレッドを表示する | Should |
| NAV-006 | 分析履歴は更新日時の降順で「固定」「今日」「過去7日」「それ以前」に分け、空状態と読込中を表示する | Should |
| NAV-007 | 中央領域だけをscrollし、「新しい分析／検索」と最下部account controlは常時表示する | Must |
| NAV-008 | 最下部account controlはavatar、表示名、利用企業を1行で示し、menuを「プロフィール」「設定」「Help」「ログアウト」の順に開く | Should |
| NAV-009 | dashboard／threadのoverflow menuは「開く」「名前変更」「固定／固定解除」「複製またはfork」「linkをコピー」「archive」を順に示す。削除を追加する場合はseparator後の最後に置き確認dialogを必須にする | Should |
| NAV-010 | sidebarを閉じたdesktop状態ではpaneを0pxにし、headerのtoggleだけを残す。icon railは作らない | Must |

### 6.3 メインサーフェス

| ID | 要件 | 優先度 |
|----|------|--------|
| MAIN-001 | 既定routeは完成または直近成功revisionのダッシュボードとし、未生成時は作成・編集への単一primary actionを示す | Must |
| MAIN-002 | 作成・編集は、分析目的、AI対話、推奨回答、KPI・panel候補、仕様revision、費用確認、build progressを一つの分析スレッドとして表示する | Must |
| MAIN-003 | 会議報告は、要約、観測、解釈、仮説、反証または不足情報、owner付きaction、根拠link、承認状態を表示する | Must |
| MAIN-004 | 単一グラフは、任意設問の検証経路としてダッシュボード生成から独立して残すが、通常利用のprimary navigationには昇格させない | Should |
| MAIN-005 | ダッシュボードはgraphと必要なtableを主表示し、SQLを常時展開しない。panel選択でINS-001を開く | Must |
| MAIN-006 | build中に別routeへ移動してもjob状態を失わず、左navとheaderに実行中表示を残す | Must |
| MAIN-007 | AI対話composerは作成・編集の下端へsticky配置し、送信、停止、添付、費用が発生する操作の区別を明示する | Should |
| MAIN-008 | 空、読込、streaming、確認待ち、費用確認待ち、build中、部分成功、成功、停止、error、要承認、公開済みを別状態として表示する | Must |

### 6.4 右インスペクター

| ID | 要件 | 優先度 |
|----|------|--------|
| INS-001 | panelの「詳細を確認」または選択操作で開き、panel title、purpose、revisionをheaderに固定する | Must |
| INS-002 | desktopで既定330px、最小280px、最大560pxとし、開閉とdrag resizeを提供する | Must |
| INS-003 | タブ順を「理由」「定義・検証」「SQL」「データ」「来歴」とする | Must |
| INS-004 | 初回は「理由」を開き、同一panelへ戻った場合はsession中の最後のタブを復元する | Should |
| INS-005 | SQLタブは権限がある利用者だけに表示し、整形済みSQL、copy、query hash、実行／単独再現用の区別を示す | Must |
| INS-006 | データタブは描画へ渡した列と行、件数、truncate状態、result revisionを示す。raw source全体を暗黙に表示しない | Must |
| INS-007 | 来歴タブはanalysis specification、panel、result、dashboard、build、publishのrevision chainと検証状態を表示する | Must |
| INS-008 | panelを切り替えてもメインのscroll位置を変えず、選択中panelへ明示的なfocus／borderを付ける | Must |
| INS-009 | inspectorを閉じても選択panelを維持し、再度開いたときに同じpanelとタブへ戻す | Must |

### 6.5 Overlayと設定

| ID | 要件 | 優先度 |
|----|------|--------|
| OVR-001 | search、account menu、context menu、tooltip、費用確認、破壊操作確認を`OverlayHost`で管理し、pane gridの幅計算へ含めない | Must |
| OVR-002 | 費用が発生する操作は、対象処理、Vertex AI見積、BigQuery上限、合計、cancel、実行をmodal dialogに表示する | Must |
| OVR-003 | Settingsは主作業stack内の擬似pageにせず独立dialogまたは専用routeとし、「一般」「表示」「データソース」「メンバーと権限」「Git連携」をpermissionに応じて表示する | Should |
| OVR-004 | tooltipはpointer hoverまたはkeyboard focusの500ms後に表示し、Escape、blur、pointer leaveで閉じる | Could |
| OVR-005 | modal／drawerはfocus trap、初期focus、Escape、閉じた後のfocus復帰を実装する | Must |

## 7. レイアウトとvisual contract

以下はChatGPTの測定値ではなくRepChat固有の実装値です。

### 7.1 寸法

| token | 値 | 適用 |
|-------|----|------|
| `header-height` | 52px | 全desktop／tablet |
| `nav-width-default` | 220px | 1181px以上 |
| `nav-width-min` / `max` | 180px / 360px | drag範囲 |
| `inspector-width-default` | 330px | 1181px以上 |
| `inspector-width-min` / `max` | 280px / 560px | drag範囲 |
| `splitter-track` | 6px | pointer hit領域とfocus領域 |
| `resize-key-step` | 20px | 左右矢印1回 |
| `main-padding` | 上下24px、左右28px、下72px | desktop |
| `mobile-main-padding` | 上下20px、左右16px、下48px | 760px以下 |
| `panel-gap` | 16px | dashboard grid |
| `control-height` | 最小34px | headerのpane toggle |
| `focus-ring` | 3px、primary 10% opacity | input、button、separator |

### 7.2 色と文字

| token | 値 |
|-------|----|
| primary | `#1f4e79` |
| primary hover | `#173d61` |
| border | `#d9dee7` |
| text | `#101828` |
| muted | `#667085` |
| surface | `#ffffff` |
| background | `#f5f6f8` |
| subtle | `#f7f8fa` |
| body font | `Inter`, `Noto Sans JP`, system sans-serif |
| code font | `ui-monospace`, `SFMono-Regular`, monospace |

グラフを主役にするため、navigationとinspectorは白・灰・primaryの低彩度配色を使い、error、warning、successだけに
意味色を使います。OpenAIのicon、ロゴ、文言は使用しません。

### 7.3 Motion

- paneのbutton開閉は160ms `ease-out`、overlayのfadeは120msとする。
- drag中はtransitionを無効化し、pointer位置へ次のanimation frameで追従する。
- `prefers-reduced-motion: reduce`では開閉とfadeを即時反映する。
- streaming内容にlayout animationを適用しない。

## 8. responsiveとpane状態行列

| viewport | 左pane | 右pane | resize | 同時open | メイン保護 |
|----------|--------|--------|--------|----------|------------|
| 1181px以上 | push、既定open | push、既定open | 両方 | 可 | 中央を明示grid列に維持 |
| 960〜1180px | push、既定180px | overlay、既定closed | 左のみ。右は最大50vwで固定 | 可 | 右paneは中央幅を縮めない |
| 761〜959px | overlay、既定closed | overlay、既定closed | 不可 | 不可。後から開いた方を優先 | backdropとfocus trap |
| 760px以下 | modal drawer、既定closed | 全幅detail sheet、既定closed | 不可 | 不可 | dashboardを単列化 |

desktop wideでは次の4状態をすべて自動試験します。

| 状態 | 左 | 右 | 中央の期待動作 |
|------|----|----|----------------|
| L1-R0 | open | closed | 左幅だけを除いた全幅へ拡張 |
| L1-R1 | open | open | 両paneの間で縮小するがmin-width 0で文字を縦書き化しない |
| L0-R0 | closed | closed | viewport全幅を使用 |
| L0-R1 | closed | open | 右幅だけを除いた全幅へ拡張 |

## 9. 操作、状態、権限

### 9.1 keyboardとpointer

| 操作 | keyboard | pointer |
|------|----------|---------|
| 新しい分析 | `Ctrl/Cmd+N` | 左上primary action |
| 検索 | `Ctrl/Cmd+K` | 左上検索 |
| 左pane開閉 | `Ctrl/Cmd+B` | header toggle |
| 右pane開閉 | `Ctrl/Cmd+Option+I` | header toggle／panel詳細 |
| pane resize | separator focus後、左右矢印で20px | 6px splitterをdrag |
| inspector tab | Tabでtablistへ移動、左右矢印で選択 | tab click |
| overlayを閉じる | `Escape` | closeまたはbackdrop |

separatorは`role="separator"`、`aria-orientation="vertical"`、`aria-valuemin`、`aria-valuemax`、
`aria-valuenow`を持ちます。toggleは状態に応じた`aria-expanded`と動的labelを持ちます。

### 9.2 状態モデル

```json
{
  "layout": {
    "left": {"open": true, "width": 220},
    "right": {"open": true, "width": 330, "mode": "push"}
  },
  "context": {
    "tenant_id": "authorized-server-context",
    "collection_id": "collection-1",
    "route": "dashboard"
  },
  "selection": {
    "dashboard_revision_id": "dashboard-rev-1",
    "panel_revision_id": "panel-rev-1",
    "inspector_tab": "reason"
  },
  "job": {"id": null, "state": "idle"}
}
```

- `tenant_id`とpermissionはserverが解決し、URL、local storage、AI出力を信用しません。
- pane幅、開閉、最後のinspector tabは利用者端末の表示設定です。分析メモリーへ保存しません。
- route、artifact revision、panel selectionはURLへ保存します。
- build／report jobはserverのjob IDから復元し、画面移動で失いません。

推奨route形を次に固定します。実装frameworkは問いません。

```text
/w/:workspaceId/dashboards/:dashboardId/revisions/:revisionId?panel=:panelRevisionId&inspect=sql
/w/:workspaceId/analyses/:threadId
/w/:workspaceId/reports/:reportRevisionId
/w/:workspaceId/single-chart/:threadId
```

### 9.3 role別表示

| 機能 | 閲覧者 | 編集者 | 管理者 |
|------|--------|--------|--------|
| dashboard閲覧 | 可 | 可 | 可 |
| 承認済み会議報告 | 可 | 可 | 可 |
| 分析相談／build | 不可 | 可 | 可 |
| inspector理由・定義・来歴 | 可。ただし認可scope内 | 可 | 可 |
| SQL／取得データ | 個別permission | 個別permission | 可 |
| publish／fork | 不可 | permission次第 | 可 |
| data source／member／Git設定 | 不可 | 不可 | 可 |

本番role・認証方式の最終決定はIssue #194を正本とし、この表はUIのfail-closed既定です。

### 9.4 errorと例外

- URLのartifactまたはpanelが存在しない場合は、同じworkspace内の安全な一覧へ戻し、別tenantの存在を示しません。
- SQL権限がない場合はSQL tab自体を隠し、URL直打ちは403相当の汎用表示にします。
- inspector dataの取得失敗はメインのdashboardを消さず、右pane内だけにretry可能なerrorを表示します。
- build失敗は直近成功dashboardを維持し、分析スレッドに失敗stage、費用、再実行条件を表示します。
- local storageが壊れている場合は既定pane値へ戻し、業務成果物の状態には影響させません。

## 10. 非機能要件

| ID | 特性 | 要件 | 目標 | 測定方法 | 優先度 |
|----|------|------|------|----------|--------|
| NFR-001 | 性能効率 | pane開閉とtab切替はnetwork待ちなしで反映する | 入力からvisual feedbackまでp95 100ms未満 | browser performance test | Must |
| NFR-002 | 性能効率 | drag中にlayoutを連続更新する | 60Hz端末で95%以上のframeが16.7ms以内 | performance trace | Should |
| NFR-003 | 信頼性 | back、forward、reloadでrouteとrevision選択を復元する | E2E全case成功 | route E2E | Must |
| NFR-004 | セキュリティ | navigation、search、deep link、inspectorすべてで同じserver認可を通す | 越境case 0件 | authorization suite | Must |
| NFR-005 | アクセシビリティ | WCAG 2.2 AA相当のkeyboard、focus、name、role、stateを持つ | axe重大違反0、手動keyboard完走 | axe＋手動試験 | Must |
| NFR-006 | 保守性 | pane状態、business entity、job状態を別store／modelで管理する | pane変更でquery/build testが変更不要 | unit test境界 | Must |
| NFR-007 | 互換性 | 最新2世代のChrome、Edge、Safariで閲覧・開閉・resizeが動作する | 対象matrix全成功 | cross-browser E2E | Should |
| NFR-008 | 観測性 | route変更、pane開閉、inspector tab、検索、新規分析、errorを値なしeventで測定する | tenant data・SQL・query resultをeventへ含めない | telemetry schema review | Should |

## 11. データ要件

| 項目 | 仕様 |
|------|------|
| 業務entity | workspace、collection、analysis thread、analysis specification revision、dashboard revision、panel revision、result revision、report revision |
| UI設定 | left/right open、幅、直近inspector tab、theme。端末localで保持し、reset可能にする |
| URL状態 | workspace、artifact、revision、panel、inspector tab。秘密情報、SQL、result値を入れない |
| 検索index | 認可済みtitle、種別、更新日時、owner、statusだけを初期対象にする |
| 履歴保持 | 製品の保持期間が決まるまで未決。ローカルデモの起動中履歴を製品履歴とみなさない |
| PII | account表示名、email、利用企業。SQL・resultと同じclient telemetryへ送らない |
| backup／recovery | 業務revisionは管理DBのRPOへ従う。端末localのpane設定はbackup対象外 |

## 12. 外部interfaceと依存

| interface | 方向 | 契約 | 障害時 |
|-----------|------|------|--------|
| 認証・認可 | server → UI | 利用者、tenant、role、permission | fail closed。利用不能なnavを出さない |
| artifact API | server → UI | dashboard／panel／reportの固定revision | 直近成功revisionを維持 |
| job stream | server → UI | plan、review、build、reportのstageとjob ID | reconnectしjob状態を再取得 |
| search API | UI ↔ server | 認可済みmetadataだけ | 空結果とerrorを区別 |
| Git adapter | server内部 | publish statusとrevision linkだけをUIへ返す | dashboard閲覧をGit障害から分離 |

app shell自体に新しい有料infraや外部UI libraryを必須としません。永続検索と履歴の費用は、その実装Issueで
件数、retention、index方式を見積もります。

## 13. 運用要件

- visual regressionは1440×900、1180×820、1024×768、768×1024、390×844で取得します。
- 各viewportで左右の許可された状態、空、loading、error、長い日本語title、長いSQLをfixture化します。
- design tokenとbreakpointを一か所で管理し、文書値と実装値の一致をtestします。
- UI計測eventはSQL、自然言語問い合わせ、結果値、顧客名を含めません。
- rollbackは旧shell routeへfeature flagで戻し、artifact revisionやjobを変更しません。

## 14. 受入条件

| ID | 条件 | 検証対象 | 検証方法 |
|----|------|----------|----------|
| AC-01 | component treeの5領域が存在し、dashboardが既定main surfaceである | APP-001、MAIN-001 | DOM／component test |
| AC-02 | desktop wideのL1-R0、L1-R1、L0-R0、L0-R1で中央列が崩れない | APP-003、NAV-001、INS-002 | 1440px visual regression |
| AC-03 | 左右resizeがmin／maxでclampされ、keyboardは20px刻みでaria値を更新する | NAV-001、INS-002、NFR-005 | unit＋E2E |
| AC-04 | medium、tablet、mobileが§8のpush／overlay／drawer契約に一致する | §8 | viewport E2E |
| AC-05 | 左navの上部・中央scroll・下部accountが独立し、中央だけがscrollする | NAV-002〜NAV-008 | DOM＋visual test |
| AC-06 | panel選択から2操作以内に正しいSQLとresult revisionを開ける | INS-001〜INS-007 | user task＋E2E |
| AC-07 | SQL permissionなしではnav、tab、deep linkの全経路でSQLが取得・表示されない | APP-005、INS-005、NFR-004 | authorization E2E |
| AC-08 | inspectorの開閉、panel切替、back／forwardでmain scrollと選択revisionを維持する | APP-004、INS-008、INS-009 | E2E |
| AC-09 | build中に別routeへ移動して戻っても同じjob IDと進捗を表示する | MAIN-006 | reconnect E2E |
| AC-10 | dialog、drawer、menuがfocus trap、Escape、focus復帰を満たす | OVR-005、NFR-005 | keyboard E2E |
| AC-11 | 長い日本語title、SQL、空、loading、errorで縦書き化や意図しない横overflowがない | 成功指標 | fixture visual test |
| AC-12 | OpenAI固有brand asset、文言、非公開tokenを成果物に含めない | C-1 | asset／copy review |

## 15. リスク

| ID | リスク | 可能性 | 影響 | 対策 |
|----|--------|--------|------|------|
| R-1 | 外部製品のUI変更を追い続け、RepChatの情報設計が不安定になる | 中 | 高 | 出典区分を維持し、RepChat decisionだけを実装契約にする |
| R-2 | 左navのcollectionがtenant selectorと誤認され、越境につながる | 中 | 高 | C-2、server認可、明示breadcrumbを適用する |
| R-3 | 左右paneが中央dashboardを狭め、デモより見づらくなる | 中 | 高 | §8、全状態visual regression、中央幅の保護 |
| R-4 | 機能を左navへ詰め込み、初見利用者が迷う | 中 | 中 | primary 4項目、secondary collection、user testで検証 |
| R-5 | SQL／dataを便利さのため閲覧者へ漏らす | 低 | 高 | permissionでtabとAPIを同時に遮断する |
| R-6 | 永続履歴やGit状態を先に作り、Issue #160前に製品範囲が拡大する | 中 | 高 | C-4、C-5、milestone順序を守る |

## 16. milestone

| milestone | 範囲 | 開始条件 |
|-----------|------|----------|
| M0 文書・fixture | 全要件、状態行列、fixture定義 | この文書のreview |
| M1 shell prototype | APP、NAV、INS、responsive、a11y | Issue #160が`proceed`、Issue #179のprototype承認 |
| M2 product routing | deep link、permission、artifact API、job復元 | 本番role・認証とrevision contract確定 |
| M3 history／search／settings | NAV-003、NAV-005〜NAV-009、OVR-003 | retention、search scope、Git UIの別Issue承認 |

## 17. 未決事項

以下はM0／M1の再現を妨げません。

| ID | 未決事項 | 影響 | owner | 決定時期 |
|----|----------|------|-------|----------|
| Q-1 | 本番のrole・認証方式 | §9.3の最終permission | リポジトリオーナー | Issue #194 grill-me |
| Q-2 | 分析履歴とarchiveの保持期間 | NAV-006、§11 | デザインパートナー＋オーナー | 永続履歴実装前 |
| Q-3 | Git branchを左navに直接表示するか、publish来歴だけに限定するか | NAV-005、NAV-009 | オーナー | Git adapter UI設計時 |
| Q-4 | brand tokenとdark mode | §7 | オーナー | M1 visual review |
