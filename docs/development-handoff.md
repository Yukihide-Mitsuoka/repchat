---
id: development-handoff
title: 開発引き継ぎ
status: active
updated: 2026-08-11
---

# 開発引き継ぎ

この文書は、人またはAIが前回の対話なしでRepChatの開発を再開するための入口です。
実装状態の正本は[実装状況サマリー](status.md)、優先順位の正本は[ロードマップ](roadmap.md)、
各タスクの受入条件はGitHub Issueです。この文書には再開に必要な参照順と分岐だけを置きます。

## 現在の作業と停止条件

| 項目 | 現在地 |
|------|--------|
| 作業 | [Issue #362](https://github.com/Yukihide-Mitsuoka/repchat/issues/362)／[PR #363](https://github.com/Yukihide-Mitsuoka/repchat/pull/363) — dashboardの行幅を100%へ正規化し、単独の折れ線を全幅にし、広い購入成果改善相談では6つの検証済みパネルを既定提案する |
| デモ実行状態 | [PR #360](https://github.com/Yukihide-Mitsuoka/repchat/pull/360)はmerge済み。PR #363の修正ブランチを`http://127.0.0.1:8765/`で起動中。固定応答と全テストは成功し、実Vertex AIとBigQueryは再実行していない |
| 直近完了 | [PR #360](https://github.com/Yukihide-Mitsuoka/repchat/pull/360)のcomposer 768px上限・自動伸長、[PR #358](https://github.com/Yukihide-Mitsuoka/repchat/pull/358)の実行前分析相談、[PR #356](https://github.com/Yukihide-Mitsuoka/repchat/pull/356)のdashboard行resize・左pane調整はmerge済み |
| オーナー作業 | 日本の小規模代理店またはソフトウェアベンダーから参加者を1名以上選定し、日程を決める |
| AIができること | PR #363のCIとreviewを確認し、指摘があれば同じbranchで修正する。固定fixtureで6パネル、単独行100%、欠落行の比率再配分を確認し、有料queryを実行しない |
| 停止条件 | Issue #160の実施結果を`proceed` / `revise` / `reject`に分類するまで製品実装を開始しない。GitHub App、artifact pipeline、#179以降の製品UXを先行実装しない |
| 完了時 | 証拠を`proceed` / `revise` / `reject`に分類し、Issue #160と[status](status.md)を更新する。方向が変わる場合だけpositioning、ADR、decision logを更新する |

## 最初に読む順序

1. [status §0](status.md#0-再開手順新しいaiセッション向け)と
   [§1](status.md#1-一行でいうと)で、実装済み範囲、費用、未検証事項を確認する。
2. [positioning §0](positioning.md#0-前提の確認--勝負の土俵)、
   [§2.7〜2.10](positioning.md#27-入口は既存の手作業レポートにする)、
   [§5](positioning.md#5-未検証の仮説と検証方法)で、対象顧客、差別化、検証対象を確認する。
3. [roadmap](roadmap.md)で実施順序を確認する。
4. 下の設計判断索引から、変更対象に関係するADRを全文読む。
5. デモを扱う場合だけ[デモ手順](demo.md)と
   [report-generation spike](../spikes/report-generation/README.md)を読む。

## 直近の生成エラーと修正状態

2026-08-10に、同じ確定済みダッシュボードから会議報告を生成した複数の有料呼出しが、AI応答ごとに
limitationsの数値、根拠外の`22`、または根拠外の`3000`、`4000`、`6`で停止した。左ナビゲーションは
根拠bundleを変更しておらず、独立した各Vertex AI応答をstrict validatorが拒否していた。追加修正では
strict validatorを維持し、生成経路だけで妥当な項目を保持、不正項目を警告付きで除外し、空の必須区分を
根拠付き定型項目で補う。自動再実行はしない。原因と利用者向け動作は
[トラブルシューティング](troubleshooting/live-demo.md#会議報告のlimitationsには根拠リンクのない数値を書けません)
を正本とする。実生成はPRのCIとmerge後に費用を再承認した場合だけ行う。

## 次タスクの分岐

| 条件 | 次の作業 | 先に読む正本 |
|------|----------|--------------|
| 現在の施策handoff設計 | [#345 action package API boundary](https://github.com/Yukihide-Mitsuoka/repchat/issues/345)。同一workspace内でもpermission、credential、API、auditを分離し、承認済みactionをJSON packageとして外部へ渡す。CSV等はadapter、広告・決済writeは対象外 | [施策パッケージAPI要件](requirements/action-package-api.md)、[ADR-0023](adr/0023-unify-workflow-while-isolating-external-action.md)、[会議意思決定ループ要件](requirements/meeting-decision-loop.md) |
| 現在の計測設計支援 | [#343 GA4/GTM measurement implementation assistant](https://github.com/Yukihide-Mitsuoka/repchat/issues/343)。Design Modeは設計・code・import成果物・QA手順、Apply Modeは公式APIの隔離workspace・sync・conflict・quick previewまでとする。browser操作とpublishはしない | [GA4・GTM計測実装アシスタント要件](requirements/measurement-implementation-assistant.md)、[競合比較](competitive-landscape.md)、[ポジショニング](positioning.md) |
| 現在のcohort分析設計 | [#341 governed cohort analysis](https://github.com/Yukihide-Mitsuoka/repchat/issues/341)。日本語で意味をfreezeし、未成熟期間、費用、根拠を統制する要件と、Amplitude／Evidence Cloudとの同一課題benchmarkを記録する。Issue #160判定前に製品実装しない | [統制されたコホート分析要件](requirements/governed-cohort-analysis.md)、[競合比較](competitive-landscape.md)、[ポジショニング](positioning.md) |
| 現在の競合・配信境界整理 | [#338 Evidence Cloud positioning and embedded delivery](https://github.com/Yukihide-Mitsuoka/repchat/issues/338)。Evidence Cloud公式仕様を事実側へ置き、RepChatの差別化仮説とauthoring／publishing／embedded deliveryのroute・permission分離を記録する | [競合比較](competitive-landscape.md)、[ポジショニング](positioning.md)、[分析ワークスペースUI要件](requirements/analysis-workspace-ui.md) |
| 現在のUI情報設計 | [#179 dashboard／SQL来歴UX](https://github.com/Yukihide-Mitsuoka/repchat/issues/179)。外部UIは情報構造の参考に限定し、RepChat機能mapping、左右pane、responsive、keyboard、可視context、Insight保存／昇格、review／publish、embedded previewを再現可能な要件として固定する。Issue #160判定前に製品実装しない | [分析ワークスペースUI要件](requirements/analysis-workspace-ui.md)、[デモ手順](demo.md)、Issue #179 |
| 完了した会議報告修正 | [#295 evidence validation](https://github.com/Yukihide-Mitsuoka/repchat/issues/295)／[PR #333](https://github.com/Yukihide-Mitsuoka/repchat/pull/333)。strict validatorを維持し、生成経路では根拠外数値を含む項目だけを除外する | [トラブルシューティング](troubleshooting/live-demo.md)、`meeting_report.py` |
| 直近のdashboard修正 | [#362 row completeness](https://github.com/Yukihide-Mitsuoka/repchat/issues/362)。選択パネル集合から行と比率をserverで正規化し、単独行を100%、欠落のある複数カード行も合計100%にする。広い購入成果改善相談はR4／R11／R12／R9／R16／R17を提案時に補完するが、確認画面での明示的な選択解除は維持する | [分析ワークスペースUI要件](requirements/analysis-workspace-ui.md)、[デモ手順](demo.md)、`analysis_planner.py`、`live_demo.py` |
| 直近のデモUX | [#352 unified analysis workspace](https://github.com/Yukihide-Mitsuoka/repchat/issues/352)。4つのpeer modeを成果物treeと分析スレッドへ変え、中央下端の共通composerからdashboard／Insight／reportを明示選択する。単一グラフは右Artifact Preview、dashboard／reportは中央の成果物pageとし、既存の費用gate・SQL検査・根拠検証を維持する。左右toggleはviewport端へ固定して開閉時に座標を変えない。選択titleは左treeと44px headerだけに置き、本文上部の大型重複blockを廃止する。履歴操作はブラウザへ委ね、永続履歴・保存・Git連携は未実装 | [分析ワークスペースUI要件](requirements/analysis-workspace-ui.md)、[デモ手順](demo.md)、`live_demo.py`、`live-demo.test.ts` |
| 完了したデモ調整 | [#355 composer and dashboard row resize](https://github.com/Yukihide-Mitsuoka/repchat/issues/355)／[PR #356](https://github.com/Yukihide-Mitsuoka/repchat/pull/356)。composerは中央列追従、22px角丸、初期960px上限を導入した。現行の768px上限と自動伸長は[#359](https://github.com/Yukihide-Mitsuoka/repchat/issues/359)が上書きする。dashboardは同じ行の全境界を操作可能にし、隣接cardだけを連動させる。左paneは一行title、hover／focus marquee、16px icon列、4px gap／paddingへ圧縮する。順序変更、自由配置、永続化はしない | [分析ワークスペースUI要件](requirements/analysis-workspace-ui.md)、[デモ手順](demo.md)、`live_demo.py`、`live-demo.test.ts` |
| 現在の分析相談UX | [#357 consult before broad analysis](https://github.com/Yukihide-Mitsuoka/repchat/issues/357)。「どんな分析をしたらいい」等はSQLへfallbackせず、GA4の検証済み4候補またはBitcoinの保証済み1候補を、判断目的・可視化・依頼例付きで表示する。選択はcomposer反映だけで、再送信と既存費用gateの承認後に実行する。query APIも相談文を拒否する | [分析ワークスペースUI要件](requirements/analysis-workspace-ui.md)、[デモ手順](demo.md)、`live_demo.py`、`live-demo.test.ts` |
| 直近のデモ阻害解消 | [#325 requested navigation depth](https://github.com/Yukihide-Mitsuoka/repchat/issues/325)／[PR #326](https://github.com/Yukihide-Mitsuoka/repchat/pull/326)。custom depthの最終ページ到達前に上位12経路を選ぶSQLと、指定depth未満の結果を拒否する | [デモ手順](demo.md)、[トラブルシューティング](troubleshooting/live-demo.md)、`live_demo.py` |
| 直近の認証修正 | [#321 ADC再認証エラー](https://github.com/Yukihide-Mitsuoka/repchat/issues/321)／[PR #322](https://github.com/Yukihide-Mitsuoka/repchat/pull/322)。`RefreshError`を安全な復旧手順へ変換し、ADC再認証とデモ再起動を確認済み。実問い合わせは費用再確認後だけ行う | [デモ手順](demo.md)、[トラブルシューティング](troubleshooting/live-demo.md)、`live_demo.py` |
| 直近のデモ修正 | [#319 Sankey SVG ID分離](https://github.com/Yukihide-Mitsuoka/repchat/issues/319)／[PR #320](https://github.com/Yukihide-Mitsuoka/repchat/pull/320)。複数workspaceのSVG ID衝突を修正し、固定データで二つ同時描画を検証済み | [デモ手順](demo.md)、[トラブルシューティング](troubleshooting/live-demo.md)、`live_demo.py` |
| 現在の要件記録 | [#317 会議意思決定ループ](https://github.com/Yukihide-Mitsuoka/repchat/issues/317)／[PR #318](https://github.com/Yukihide-Mitsuoka/repchat/pull/318)。会議報告を最大3件の意思決定、担当付きアクション、次回の効果検証へ接続する将来要件を記録する。Issue #160判定前に実装しない | [会議意思決定ループ要件](requirements/meeting-decision-loop.md)、[適応型分析メモリー要件](requirements/adaptive-analysis-memory.md)、Issue #181 |
| 完了したVertex AI費用表示修正 | [#311 thought token accounting](https://github.com/Yukihide-Mitsuoka/repchat/issues/311)／[PR #335](https://github.com/Yukihide-Mitsuoka/repchat/pull/335)。分析計画とSQL生成のthought tokensを費用へ含める | [demo](demo.md)、`analysis_planner.py`、`run_report.py` |
| doctorの基盤テストtimeout | [#315 setup-github wrapper timeout](https://github.com/Yukihide-Mitsuoka/repchat/issues/315)。`make doctor`の`setup-github.sh` wrapper testが5秒timeoutした。再実行で成功扱いにせず、Gemini切替とは別に原因を調査する | `scripts/setup-github.sh`、`scripts/tests/test_setup_github_wrapper.py` |
| 現在のpanel合成設計 | [#308 versioned panel composition](https://github.com/Yukihide-Mitsuoka/repchat/issues/308)。AI生成原本を上書きせず、参照追加・fork・利用者作成panelを派生dashboard revisionで合成するproposed ADRをreviewする | ADR-0013/0014/0015、ADR-0022、Issue #179/#180 |
| 現在のbuild費用設計 | [#306 cost-gated shared intermediates](https://github.com/Yukihide-Mitsuoka/repchat/issues/306)。direct実行を既定とし、実測thresholdを満たすbuildだけに共有中間結果を提案するproposed ADRをreviewする | ADR-0013/0014/0015、ADR-0021、Issue #180 |
| 現在の本番security設計 | [#302 production edge and origin protection](https://github.com/Yukihide-Mitsuoka/repchat/issues/302)。Cloudflare WAFとCloud Armorの責任境界、Cloud Run direct URL遮断、費用、rolloutをproposed ADRとしてレビューする | ADR-0005/0006/0010/0012、ADR-0020 |
| 現在のPhase 0設計 | [#300 scoped context memory](https://github.com/Yukihide-Mitsuoka/repchat/issues/300)。データソース契約、任意org unit、用途別context compiler、UIの必須／任意文脈をproposed ADRとしてレビューする | [適応型分析メモリー要件](requirements/adaptive-analysis-memory.md)、ADR-0018、ADR-0019 |
| #297 merge後のデモ確認 | 最新mainから`make demo-live PROJECT=<project>`で再起動する。HTTP 200と固定応答テストは無料で確認できる。実会議報告生成は別途費用確認する | [デモ手順](demo.md)、[トラブルシューティング](troubleshooting/live-demo.md) |
| 固定応答確認後 | 実Vertex AI相談の費用を提示して承認を得てから同じ依頼を1回実行する。相談成功後のBigQuery buildは別の費用確認とし、同時に承認された扱いにしない | #273、#180 |
| デモ阻害解消後 | [#160 デザインパートナー検証](https://github.com/Yukihide-Mitsuoka/repchat/issues/160)。参加者選定・日程調整はオーナー作業。5分デモ後に結果を`proceed` / `revise` / `reject`へ分類する | [demo](demo.md)、[roadmap](roadmap.md) |
| #160が`proceed` | [#188 未知nested schema品質検証](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)と[#179 閲覧／SQL来歴UX設計](https://github.com/Yukihide-Mitsuoka/repchat/issues/179)を独立した作業として開始できる | ADR-0013、ADR-0015、各Issueの受入条件 |
| #179と#188が完了 | [#180 対話による分析仕様確定とbuild](https://github.com/Yukihide-Mitsuoka/repchat/issues/180) | #179の設計成果、ADR-0013/0015 |
| #180でanalysis specification revision契約を確定 | Issue #160が`proceed`なら、適応型分析メモリーPhase 1の実装Issueを作る | [適応型分析メモリー要件](requirements/adaptive-analysis-memory.md)、ADR-0018。初期は手動方針・承認・表示・取消だけ |
| 統制された生成・公開経路が安定 | [#181 根拠付き経営報告](https://github.com/Yukihide-Mitsuoka/repchat/issues/181) | #180のrevision契約、SQL来歴・検証結果 |
| 課金または本番オンボーディングへ着手 | [#194 課金区分と認証方式のオーナー決定](https://github.com/Yukihide-Mitsuoka/repchat/issues/194)を専用grill-meで先に完了する。現在のデモはblockしない | [mission](../.ai/mission.md)、[positioning §6](positioning.md#6-missionmd-との残る不一致未解消) |
| Slack利用が実顧客で確認された | オーナーがADR-0017を承認した後、検証済みrevisionのlink通知pilot用Issueを作る | ADR-0017。自由質問は#180と#188の完了後 |
| HTTPテストの同時失敗が再発、または保守作業が明示的に優先された | [#169 serve round-trip flake調査](https://github.com/Yukihide-Mitsuoka/repchat/issues/169) | 失敗時の未省略ログ。再試行やassertion緩和は禁止 |

`#160`が`revise`または`reject`の場合は、上表の製品タスクへ進まず、観測結果に基づいて
positioningとroadmapを再評価します。

## 次にやる順序（2026-08-11）

1. **現在:** [Issue #362](https://github.com/Yukihide-Mitsuoka/repchat/issues/362)で、dashboardの単独行100%、複数カード行の合計100%、購入成果改善の6パネル提案を固定応答とbrowserで検証する。実Vertex AI・BigQueryは実行しない。
2. **UI確認後:** ローカルデモを最新mainから再起動し、オーナーがダッシュボード、作成・編集、会議報告、単一グラフの見た目と操作を確認する。必要ならデザインパートナーへ見せる前の改善をIssueへ分ける。
3. **オーナー承認後:** 実Vertex AI相談を1回確認する。成功後、別の費用確認を経てダッシュボードbuildを実行し、連続同一ページ統合後のR17参照値、色、リンク値、2ページ目終了注記、取得データを確認する。
4. **並行するオーナー作業:** [#160](https://github.com/Yukihide-Mitsuoka/repchat/issues/160)の参加者を選定して日程を決める。デモ阻害を解消後に5分デモを行い、`proceed` / `revise` / `reject`へ分類する。
5. **未完の検証:** [#188](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)はBitcoin 1種類の縦切りと予約語修正まで完了したが、実値照合、独立レビュー、未知・非公開相当2種類の評価が残る。
6. **製品化前提が整った後:** [#179](https://github.com/Yukihide-Mitsuoka/repchat/issues/179)の閲覧／SQL来歴UX、[#180](https://github.com/Yukihide-Mitsuoka/repchat/issues/180)の非同期・再開可能なbuild、[#181](https://github.com/Yukihide-Mitsuoka/repchat/issues/181)の承認・監査付き報告、[#251](https://github.com/Yukihide-Mitsuoka/repchat/issues/251)の配布artifact定義を各Issueの受入条件で進める。会議パック後の決定・アクション永続化は[会議意思決定ループ要件](requirements/meeting-decision-loop.md)の開始条件に従う。現在mainにある#180/#181はローカル未検証プロトタイプであり、Issue完了ではない。

この順序より前に、本番認証・GitHub App・顧客Git配送・Slack自由質問を先行実装しない。[#194](https://github.com/Yukihide-Mitsuoka/repchat/issues/194)の課金区分とエンドユーザー認証は、本番オンボーディングへ進む直前に専用grill-meで確定する。

## 設計判断の索引

| 論点 | 状態 | 正本 |
|------|------|------|
| 主要顧客と販売経路 | 確定。代理店・ソフトウェアベンダーが初期主経路、直販はフォールバック | [mission](../.ai/mission.md)、[positioning §0](positioning.md#0-前提の確認--勝負の土俵) |
| テナント分離と接続主体 | accepted。接続主体はテナント単位の機械IDで、人間の認証主体と分離 | [ADR-0005](adr/0005-cache-and-authorization-architecture.md)、[ADR-0010](adr/0010-connection-identity-is-never-a-person.md) |
| 指標定義 | accepted。意味と出力形状をこちら側で定義し、未定義語は確認または拒否 | [ADR-0013](adr/0013-metric-definitions-live-in-our-own-layer.md) |
| 生成物の所有 | accepted。ページ・SQL・manifestは顧客Git、共有指標定義はこちら側 | [ADR-0014](adr/0014-who-owns-the-generated-artifacts.md) |
| Git配送と閲覧 | accepted。Gitはbuild時だけ使用し、閲覧経路へ入れない。GitHub/managedは同じpipelineの保存先adapter | [ADR-0015](adr/0015-publish-artifacts-through-customer-git.md) |
| Slack | proposed。Webを正本UIとする認可付きadapter案。オーナー承認前は実装禁止 | [ADR-0017](adr/0017-use-slack-as-an-authorized-analysis-interface.md) |
| 適応型分析メモリー | accepted。生の会話ではなくscope・権限・revision・期限を持つ方針をPostgresの正本で管理し、AIは候補を作るが自動昇格しない | [要件](requirements/adaptive-analysis-memory.md)、[ADR-0018](adr/0018-govern-adaptive-analysis-memory.md) |
| データソース知識とscope継承 | proposed。custom dimension等をschema検証済みデータソース契約として分離し、任意org unitと用途別context compilerを使う。オーナー承認前は実装禁止 | [要件](requirements/adaptive-analysis-memory.md)、[ADR-0019](adr/0019-separate-datasource-knowledge-from-scoped-analysis-context.md)、[#300](https://github.com/Yukihide-Mitsuoka/repchat/issues/300) |
| 本番公開入口とorigin防御 | proposed。Cloudflare WAFを利用者入口、External Application Load Balancer＋Cloud ArmorをCloud Run迂回防止境界とする。local demoは対象外で、オーナー承認と費用確認前はinfra作成禁止 | [ADR-0020](adr/0020-protect-production-edge-and-cloud-run-origins.md)、[#302](https://github.com/Yukihide-Mitsuoka/repchat/issues/302) |
| dashboard buildの共有中間結果 | proposed。panel別direct実行を既定とし、個別buildの絶対削減額と削減率が実測thresholdを超える場合だけcost plannerが提案する。customer datasetへの書き込み権限を既定で増やさない | [ADR-0021](adr/0021-gate-shared-intermediates-on-measured-build-cost.md)、[#306](https://github.com/Yukihide-Mitsuoka/repchat/issues/306) |
| panel再利用と利用者編集 | proposed。panelを不変revisionとし、AI生成dashboardは上書きせず、参照追加・fork・利用者作成SQLを派生dashboardへ合成する。利用者SQLは同じ認可・検証・費用確認を通す | [ADR-0022](adr/0022-compose-derived-dashboards-from-versioned-panels.md)、[#308](https://github.com/Yukihide-Mitsuoka/repchat/issues/308) |
| 計測から施策handoffまでの製品境界 | proposed。同じworkspace shellで文脈を接続するが、permission、credential、API、auditを分ける。承認済みactionはprovider非依存Action Packageとして出力し、広告・予算・決済writeはCoreに入れない | [ADR-0023](adr/0023-unify-workflow-while-isolating-external-action.md)、[要件](requirements/action-package-api.md)、[#345](https://github.com/Yukihide-Mitsuoka/repchat/issues/345) |
| 統制されたcohort分析 | draft。日本語で分析主体、起点・復帰event、retention方式、期間、timezoneをfreezeし、未成熟期間を0にせず、費用・SQL・集計data・根拠を同じrevision chainへ結ぶ | [要件](requirements/governed-cohort-analysis.md)、[#341](https://github.com/Yukihide-Mitsuoka/repchat/issues/341) |
| 接続先・テーブル選択 | 将来設計。ユーザーに任意のdataset/tableを列挙させず、管理者が承認したデータソース・分析領域・テーブルカタログからサーバー側で解決する | [ADR-0005](adr/0005-cache-and-authorization-architecture.md)、[ADR-0010](adr/0010-connection-identity-is-never-a-person.md)、#180 |
| 課金区分・エンドユーザー認証 | 未決。AIは推測しない | [Issue #194](https://github.com/Yukihide-Mitsuoka/repchat/issues/194) |

## 誤って前提にしてはいけないこと

- ローカルデモは`spikes/`内にあり、本番の認証、gate、executor、顧客Git配送を通らない。
- 公開GA4の成功は未知の独自nested/repeated schemaへの対応を証明しない。
- 生成SQLの構文は毎回同じでなくてよい。指標の意味、出力形状、既知値照合を固定する。
- 生の会話履歴、生成SQL、query resultは分析方針メモリーの正本ではない。類似度を認可境界に使わない。
- BigQuery SQLとEvidence SQLの双方で必要列を明示し、`SELECT *`を生成しない。
- 顧客Gitをページ表示時に参照せず、失敗したbuildを有効化しない。
- `make demo`は実Vertex AIとBigQueryを使う。実行前に費用を明示し、オーナーの同意を得る。
- 測っていない結果、独自schema品質、更新SLO、製品統合状態を実証済みと書かない。

この文書は、現在のIssue、停止条件、次タスクの分岐、または設計判断の正本が変わったときに更新します。
