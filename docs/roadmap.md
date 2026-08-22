---
id: project-roadmap
title: プロジェクトロードマップ
updated: 2026-08-22
last_reviewed: 2026-08-22
---

# プロジェクトロードマップ

RepChatの開発方向と実施順序を示します。詳細なスコープと受入条件は
[要件定義書](requirements.md)、個々の作業はGitHub issueを正本とします。
この文書は作業一覧ではなく、先行実装や過剰設計を防ぐための優先順位です。
**現時点で何が出来ているか**は[実装状況サマリー](status.md)を参照してください。

更新契機は、フェーズ完了、優先順位変更、スコープ追加・削除です（DOC-040）。

## 次の依頼を選ぶ優先順位

2026-08-22時点では、未解消の不具合と検証阻害を先に解消し、その後に以下の順で依頼を選びます。
各Issueが受入条件の正本であり、この表は開始順序と依存関係だけを管理します。

| 優先 | 段階 | 依頼候補 | 目的 | 開始・完了条件 |
|---:|---|---|---|---|
| 1 | 検証ゲート | [#160 デザインパートナー検証](https://github.com/Yukihide-Mitsuoka/repchat/issues/160) | 現在のAI提案・SQL・dashboardが実利用者の意思決定に使えるか判定する | 現在。オーナーが参加者を選定し、5分デモ後に`proceed` / `revise` / `reject`を確定する |
| 2 | 基盤品質 | [#188 未知のnested schema検証](https://github.com/Yukihide-Mitsuoka/repchat/issues/188) | GA4・Bitcoinの固定例や固定SQLに依存せず、未知schemaから分析・SQL・描画できる境界を測る | 評価設計は並行可能。独立レビュー、実値照合、未知・非公開相当2種類の反復評価に合格するまで製品能力として扱わない |
| 2 | 製品UX | [#179 ダッシュボード閲覧とSQL来歴の分離](https://github.com/Yukihide-Mitsuoka/repchat/issues/179) | 一般閲覧面と、SQL・定義・検証・data lineageを確認する監査面を分離する | #160=`proceed`。#188とは独立に開始し、interaction・deep link・認可境界を先に確定する |
| 3 | 分析契約 | [#180 対話による分析仕様確定](https://github.com/Yukihide-Mitsuoka/repchat/issues/180) | 対話、immutable specification revision、承認、非同期build、再開、公開を製品契約にする | #179のinteractionと#188のschema品質境界が確定した後 |
| 4 | 保存・共有 | [#371 レイアウトrevisionの保存と共有](https://github.com/Yukihide-Mitsuoka/repchat/issues/371) | AI配置と利用者の幅調整を構造化revisionとして保存・公開し、共有相手に再現する | #179/#180のdashboard・panel・layout revision契約が確定し、共有需要をdesign partnerで確認した後 |
| 5 | 意思決定支援 | [#181 根拠付き経営報告とアクション](https://github.com/Yukihide-Mitsuoka/repchat/issues/181) | 根拠へ追跡できる判断、施策、担当、成功指標、検証方法を生成し、人間の承認後だけ配布する | #180の統制された生成・公開経路と、SQL・結果・根拠のrevision追跡が安定した後 |
| 6 | 外部連携 | [#345 Action Package API](https://github.com/Yukihide-Mitsuoka/repchat/issues/345) | 承認済み施策をprovider非依存のJSON packageとして外部systemへ渡し、権限・credential・監査を分析処理から分離する | #181の承認済みaction revisionが安定し、最初の外部consumerを確認した後 |
| 条件付き | 品質向上 | [#380 AI考察後の根拠付きパネル補強](https://github.com/Yukihide-Mitsuoka/repchat/issues/380) | AI-only計画の後に根拠付き補強候補を任意提示し、固定パネル置換や自動fallbackを行わず品質差を測る | AI-only plannerのbaselineが代表シナリオで安定し、同一評価セットで改善と失敗例を比較できる場合だけ |
| 着手直前 | 本番化 | [#194 課金・認証方式](https://github.com/Yukihide-Mitsuoka/repchat/issues/194) | 閲覧者・作成者・管理者の課金区分、初期認証方式、利用者管理主体をオーナー判断で確定する | 課金または本番オンボーディングへ着手する直前。オーナー判断なしにAIが方式を選ばない |
| リリース前 | リリース | [#251 検証可能なrelease artifact](https://github.com/Yukihide-Mitsuoka/repchat/issues/251) | 実行コード、設定、依存関係、検査結果を同じ不変artifactとprovenanceへ結び付ける | 配布対象とconsumerを確定し、`make build`またはpublish jobがattestation対象を生成できる時点 |

同順位の#179と#188は独立した依頼として並行できます。#160が`revise`または`reject`の場合は、
優先3以降へ進まず、観測結果からpositioningと本ロードマップを再評価します。

## 残課題

将来機能と重複しない、現行経路の品質・検証課題は次のとおりです。

| 優先 | 課題 | 次の完了条件 |
|---:|---|---|
| 保守時 | [#315 `make doctor` wrapper timeout](https://github.com/Yukihide-Mitsuoka/repchat/issues/315) | 外部I/Oまたは待機条件を特定し、timeout延長や再試行ではなく無外部I/Oの再現テストと原因修正を行う |
| 再発時 | [#169 serve round-trip flake](https://github.com/Yukihide-Mitsuoka/repchat/issues/169) | 4件同時失敗時の未省略例外を取得し、listener割当・cleanup・並列実行の原因を確定して再現テストを追加する |
| 費用承認後 | #374/#410で拡張したAI分析計画の実サービス確認 | 固定応答テスト後にVertex AIだけを1回確認し、SQL生成・BigQuery buildは別の費用確認後に1件だけ実行する |

Issue [#410](https://github.com/Yukihide-Mitsuoka/repchat/issues/410)の可視化拡張は
[PR #411](https://github.com/Yukihide-Mitsuoka/repchat/pull/411)で完了し、その後のprovider schema回帰は
[PR #412](https://github.com/Yukihide-Mitsuoka/repchat/pull/412)で修正済みです。Security workflowが検出した
`sqlparse`のHIGH脆弱性3件も[PR #415](https://github.com/Yukihide-Mitsuoka/repchat/pull/415)で0件になりました。

## 完了：Phase 1の技術基盤と実環境検証

2026-07-20時点で以下は達成済みです（証拠は[status.md](status.md) §2）。

- ✅ 認可ゲートをCloudflare Workers向けに実装し、[ADR-0005の受入条件](adr/0005-cache-and-authorization-architecture.md)を移植した受入スイートで満たす。
- ✅ BigQueryを分析データソースとする経路を接続し、テナントID強制注入・データソース側隔離・
  認可付きキャッシュを**実データで一体検証**（縦串8/8、越境7/7、RLS 7/7）。
- ✅ ADR-0005/0006の未決事項のうち、実測で解ける分を解消（残り2件はパートナーのデータ形態待ち）。

## 現在：Phase 1を顧客に見せられる形にする

- ✅ **コントロールプレーン**（tenants/users/roles/reports）をPostgres+RLSで実装する。
- ✅ デプロイ（Workers、KV名前空間、executorサービス）を実施し、動く環境を1つ持つ。
  → **ライブ稼働中。実HTTP・実JWTの縦串10/10**（LOG-0058/0059）、`make destroy` からの復旧も実走（LOG-0060）。
- ✅ **対面デモの前に、日本語問い合わせ、生成SQL、実行、照合状態、描画結果を同じ画面で
  追跡できるようにする。** 既存の生成経路を検証可能にする範囲に限定し、製品機能は増やさない。
- ✅ **対面デモを、分析単位の結果／SQLタブと高度な可視化へ改善する（Issue #178、PR #182）。**
  購入KPI、リピート率、平均エンゲージメント、購入ファネル、日次セッション＋7日移動平均を
  日本語設問から生成する。SQLは列・句単位で表示整形し、実行原文は変更しない。Sankeyと
  0、4、8、12...スペースのSQL表示をPR #182/#191で確認済み。
- ✅ **1つの具体的な日本語依頼から、複数パネルのダッシュボードを生成するローカルデモを追加する
  （Issue #236）。** 実測済み6分析を成果KPI、ファネル、2系列時系列、回遊へ配置し、各パネル内で
  生成理由・SQL・検証状態・集計データを対応付ける。目的からKPI候補を相談する製品機能（Issue #180）と
  根拠付き会議報告（Issue #181）は先行実装しない。
- ⏸️ NL→SQLとEvidenceを、スパイクから製品の経路に接続する。
  → **スパイクでは一本通った**（日本語→SQL→検証→描画→テナント別配信、LOG-0065〜0076）。**`src/` は未着手**。
- ⏸️ デザインパートナー候補1社との本番検証に必要なセキュリティ説明、監査ログ、
  撤退時データ削除の要件を具体化する。
- **現在の最優先：[Issue #160](https://github.com/Yukihide-Mitsuoka/repchat/issues/160)の
  デザインパートナー候補の選定・日程調整・5分デモ**（人間側の実行）。
  基盤の技術的不確実性は縮小したが、実顧客schemaでの生成品質と需要は未検証であり、ここが律速になる。
  #160の結果を`proceed` / `revise` / `reject`に分類するまで、上の製品実装2件を開始しない。
- **2026-08-02のオーナー優先順位：** 人間側の#160準備と並行し、AI側はSQL表示改善、組織コンテキストを
  含む分析メモリー要件、非GA4公開nested/repeated dataset 1種類のデモ、#180と#181のローカル
  プロトタイプを小さいPRに分けて進める。#188の2種類評価と設計パートナー検証は省略せず、#160が
  `proceed`になるまで製品実装または検証済み能力とは扱わない。
- 🧪 **Issue #188の最初の非GA4縦切り:** Bitcoin公開取引の`outputs`と内側の`addresses`を
  二段階で展開する単一グラフ経路を追加した。基準SQLのdry runは約2.91GiB。実値照合、独立レビュー、
  未知・非公開相当2種類の反復評価は未完了であり、任意schema対応とは表明しない。
- 🧪 **Issue #180のローカル対話プロトタイプ:** 目的から最大3件の確認、仮説、KPI、比較軸、可視化、
  実行用日本語仕様をAIが新規に設計する。初回提案数とrevision上限は変更可能な管理者ポリシーで、
  デモ既定値は6件／20件とする。同じ対話で既存案を維持しながら追加、変更、削除したpanel仕様を
  revisionとしてfreezeした後だけ別費用確認とbuildへ進む。件数ポリシーは分析内容を選ばない。
  固定候補は旧fixture互換に限定し、plannerへ渡さない。組織コンテキストはfixture、履歴はbrowser
  session内、buildは同期であり、Issueの製品受入条件を完了した扱いにはしない。可視化の対応範囲は
  [Evidence Cloud可視化カバレッジ](requirements/evidence-cloud-visualization-coverage.md)で管理する。

## 次：デザインパートナー1社でのPhase 1本番運用

- マルチテナント認証、固定2〜3段ロール、監査ログを含む最小構成を完成させる。
- 実顧客dataをinternet公開環境で扱う直前に、Cloudflare WAFを利用者向け入口、External Application Load
  Balancer＋Cloud ArmorをCloud Run originの迂回防止境界として構築する（Issue #302、ADR-0020 proposed）。
  local・owner-only・顧客dataなしdemoには追加せず、ADR承認と費用確認前にinfraを作らない。
- NL→SQL、検証、描画、問い返しを実データで接続し、精度と運用原価を測定する。
- 公開GA4での成功を一般化せず、未知の独自nested/repeated schemaでNL→SQL品質と確認・拒否境界を
  検証する（Issue #188）。合格までは任意schema対応を製品能力として扱わない。
- 閲覧用ダッシュボードとSQL・定義・来歴の確認面を、選択したグラフの文脈を保つ形で分離する
  （Issue #179）。1つの分析目的を課題・仮説・KPI・複数グラフへ分解し、左上から右下の読順と
  1画面前後の情報密度を設計したうえで、分析仕様を確認して非同期build・公開する（Issue #180）。
- Issue #180のrevision契約確定後、顧客固有の修正をscope付き不変policyとして手動管理・承認・取消できる
  Phase 1を実装し、AIによる候補抽出はpilot安定後に追加する（Issue #220、ADR-0018 accepted）。
- 手動オンボーディングと月額固定の請求で1社を支え、事例化できる状態にする。
- 本番実測から性能、可用性、セキュリティの基準値を更新する。

## 将来：実測で必要になった場合のみ

- 3〜5社の手動運用が限界に達した時点で、テナント作成やデータソース接続を自動化する。
- 顧客要件が固定ロールを超えた場合に、カスタムロールを導入する。
- データ量がボトルネックになった場合に、部分再生成とキャッシュ失効を最適化する。
- dashboard buildのBigQuery費用が実測上のbottleneckになった場合だけ、direct実行との絶対削減額・削減率を
  比較し、条件を満たすbuildへ共有中間結果を提案する（Issue #306、ADR-0021 proposed）。customer
  datasetの書き込み権限は既定で増やさず、Issue #160の`proceed`とADR承認前に実装しない。
- Issue #179/#180のrevision契約と非同期buildが確定した後、版管理されたpanelをSQL workspaceで新規作成・
  forkし、AI生成原本を変更せず派生dashboardへ合成する（Issue #308、ADR-0022 proposed）。利用者SQLは
  untrusted inputとして検証する。構造化された行と相対幅は共有layout revisionとして保存・公開できるように
  する（[Issue #371](https://github.com/Yukihide-Mitsuoka/repchat/issues/371)）。design partnerの調整頻度が
  確認できるまで任意code、自由配置、個人layoutの永続化へ広げない。
- Issue #160が`proceed`となり、#179/#180のrevision・build契約と#188のschema品質境界が安定した後、
  日本語で分析主体、起点・復帰event、retention方式、期間、timezoneを確定し、未成熟期間を0にしない
  統制されたコホート分析を公開GA4からpilotする（[#341](https://github.com/Yukihide-Mitsuoka/repchat/issues/341)、
  [要件](requirements/governed-cohort-analysis.md)）。最初はAmplitude代替ではなく、acquisition cohort、
  exact-period、未成熟期間、heatmap・table、SQL・data・根拠に限定した日本語の定型分析として、汎用BIより
  準備が少ないかを測る。predictive cohort、実験配信、session replayは初期範囲に含めない。
- 同じく#160が`proceed`となり、design partnerから現行のGA4/GTM設計例を3社分得られた後、分析目的から
  GA4 recommended event、dataLayer、code、GTM構成、import成果物、QA・rollback手順を作るDesign Modeを
  pilotする（[#343](https://github.com/Yukihide-Mitsuoka/repchat/issues/343)、
  [要件](requirements/measurement-implementation-assistant.md)）。後続Apply Modeも公式GTM APIによる隔離workspace、
  sync・conflict、quick previewまでとし、browser操作と本番publishを製品範囲に含めない。
- Issue #181のaction revisionが安定し、最初の外部consumerが確認できた場合だけ、承認済み施策を
  provider非依存のAction Package JSONとして出力するdeveloper APIを検討する（[#345](https://github.com/Yukihide-Mitsuoka/repchat/issues/345)、
  [要件](requirements/action-package-api.md)、ADR-0023 proposed）。CSV・webhook・媒体別formatはadapterとし、
  広告公開、予算変更、振込、決済endpointとpayment dataはRepChat Coreへ含めない。
- 事例と売上が成立した後に、pentest、SOC 2準備、SLA商品化を検討する。
- 基本の生成・統制・配信が安定した後、根拠付き報告を最大3件の意思決定、担当付きアクション、次回の
  効果検証へ接続する（Issue #181、[会議意思決定ループ要件](requirements/meeting-decision-loop.md)）。
  最初は会議パック、決定・アクション永続化は適応型分析メモリーPhase 1と本番role・認証の後に行う。
- AI plannerの分析考察とグラフ選定を分離する必要が実測で確認された場合、[可視化選定skill](requirements/evidence-cloud-visualization-coverage.md#8-将来の可視化選定skill)を実装する。
  分析目的・データ形状・表示文脈から対応済みchart capabilityを比較し、最大3候補、選定理由、除外理由、必要な変換、confidenceを返す。未対応グラフへの自動置換は行わず、実行後の形状再検査で不適合を停止する。開始条件は#160の`proceed`、#179/#180のrevision・build契約確定、代表シナリオでの現行AI-only planner baselineの取得とする。
- 実顧客で同種修正の反復が観測された場合に、適応型分析メモリーの候補抽出、scope確認、再確認・昇格提案を
  段階導入する。自動昇格は行わず、類似検索や外部Memory Bankはpolicy量またはlookup遅延が測定上の
  bottleneckになった場合だけ派生indexとして評価する（[要件](requirements/adaptive-analysis-memory.md)）。
- design partnerがSlackを日常UIに使う場合、Webを正本のまま、許可channelから同じ分析pipelineを
  起動して要約・graph・認証付きlinkを返すadapterをpilotする（ADR-0017、proposed）。オーナー承認前は
  実装せず、自由質問はIssue #180と#188の完了後とする。検証済みrevisionのlink通知pilotは、承認後に
  実装Issueを新しく作る。

## 明示的に計画しないもの

- Stripeメーター課金とリアルタイム無料枠計算。少数社の月額固定・請求書払いを優先する。
- 手動運用で足りる期間のセルフサーブ機能。作る前に運用上の限界を確認する。
- 初期段階での全BYODB対応、リアルタイムストリーミング、モバイルアプリ、
  完全なホワイトラベル対応。
- 「将来必要かもしれない」ことだけを理由にした先行実装（COD-051）。
