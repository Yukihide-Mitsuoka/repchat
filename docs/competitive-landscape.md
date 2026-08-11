---
id: competitive-landscape
title: 競合比較 — 構想と既存製品の重なり
updated: 2026-08-11
---

# 競合比較

## この文書の役割と限界

各社比較の基礎は2026-07-27の公開情報です。Evidence Cloudだけは2026-08-11に公式製品ページと
Evidence Studio公式文書で再確認しました。価格と機能は変わるため、導入判断時には同じ項目を
公式製品ページ、公式文書、見積で再確認します。

比較対象は「[discovery-log](discovery-log.md) の構想 ＝ Git管理・安全な権限管理・複数DWH接続・
自然言語SQL生成・自動ダッシュボード生成・チャットUI」と重なる製品に限定しています。

## 比較表

| | Evidence Cloud | Omni | Holistics | Zenlytic | Lightdash | Metabase |
|---|---|---|---|---|---|---|
| **コード管理・Git** | ✅ SQL＋markdown、バージョン管理 | ✅ Git連携＋dbt | ✅ **AML で定義、PRでレビュー・ロールバック** | ✅ **セマンティック層がGit、PRでレビュー** | ✅ dbtネイティブ、CI/CD | ❌ アプリDB |
| **セマンティック層** | △ | ✅ | ✅ AML / AQL | ✅ | ✅ dbt由来 | △ |
| **自然言語・AI** | ✅ page／filterを理解するAnalytics Agent、Insight保存、Slack／MCP | ✅ チャット | ✅ 平易な言葉で質問、要約、**曖昧なら聞き返す** | ✅ **NL第一。回答に出典** | ✅ AIエージェント＋MCP | ✅ 全プランでAI質問 |
| **BigQuery** | ✅ | ✅ | ✅ | ✅ | 記載なし（要確認） | ✅ |
| **行レベル権限** | ✅ **Enterprise**。Team／Proは非対応 | ✅ アクセスフィルタ | ✅ **行・列** | ✅ ロールベース | 記載なし（要確認） | ✅ **Proのみ** |
| **埋め込み・マルチテナント** | ✅ Enterprise。公開済みpageをAPI＋iframeで配信 | ✅ ホワイトラベル＋SSO | ✅ **同じ層でテナント別セキュリティ** | — | ✅ 従量課金の別枠 | ✅ Proのみ |
| **価格** | Team **$15/人・月**、Pro **$25/人・月**、Enterpriseは個別見積 | 非公開 | 非公開 | 非公開 | **$3,000/月 定額・席数無制限**<br>OSS版は無料 | $100/月＋$6/人<br>**Pro $575/月＋$12/人** |
| **対象** | — | スタートアップ〜大企業 | データチーム全般 | **大企業**（Verizon等） | データチーム | 全般 |
| **「何を見ればいいか分からない人」への対応** | △ custom skillsで確認質問・分析手順を定義可能 | ❌ | ❌ | △ AIアナリストを標榜 | ❌ | ❌ |
| **日本語・国内対応** | 埋め込みはlanguage指定可。日本語の導入支援・契約実務は未確認 | ❌ | ❌ | ❌ | ❌ | ❌ |
| **請求書払い** | 未確認 | 不明 | 不明 | 不明 | 不明 | ❌ 自己申込（カード） |
| **実質的な競合か**（日本のSMB視点） | **◎ 本命** | ✕ 土俵が違う | ✕ 土俵が違う | ✕ 土俵が違う | △ 定額が重い／OSSは要運用 | **◎** |

## 実際に置き換える相手 — 上の表には載っていません

上の6社は**構想と機能が重なる製品**です。しかし**顧客が実際に今使っているもの**は別で、
そちらが本当の比較対象です（2026-07-27、実観測に基づく追記）。

| | Looker Studio | Looker Studio Pro | Amplitude |
|---|---|---|---|
| 価格 | **無料** | **$9/人・月** | 高額（解約理由になる水準） |
| 作りやすさ | ドラッグ&ドロップ、**非エンジニアが作れる** | 同左 | **分析レポートを簡単に作れる** |
| 所有権 | **個人アカウントに紐づく** | 組織管理は改善するが | — |
| 権限管理 | 弱い | **$9払っても設計が必要** | — |
| 上流の作り込み | 不要 | 不要 | **イベント設計・タキソノミーが必須** |
| 観測されている問題 | **共有アカウント廃止で移行コスト／作成者・接続者の退職で消える** | 権限設計が容易でない | **使いこなせず、高いので解約** |

**ここから読み取るべきこと。**

**価格の基準は $9 です。** 想定していた月3,000〜6,000円はその2〜4倍で、**正当化する説明が要ります**。

**「作りやすさ」では勝負が既についています。** Amplitude は分析レポートを簡単に作れます。
それでも使いこなせずに解約される。**つまり「作るのが難しい」は主因ではありません。**
Amplitude は**変数を切り分ける自然実験**になっており、残る説明は
**「何を分析すべきか分からない」**です。比較表で唯一空いている列を、実観測が裏付けています。

したがって**答えは「もっと簡単なツール」ではありません**。Amplitude より簡単にしても
同じ理由で解約されます。**最初から入っている**か**生成される**か、どちらかです。

**逆に、Amplitude の上流の作り込みを飛ばすと、意味も一緒に飛びます。** ファネル・リテンション・
コホートという語の定義は、その作り込みが与えていたものです。DWHに直接SQLを投げる形にすると
定義が無くなり、**そこは自然言語SQLが最も苦手とする領域**です（生イベントからのセッション化、
ウィンドウ関数、`UNNEST` の重ね合わせ）。**セマンティック層は選択肢ではなく必須**、という結論に
なります。

## 読み取れること

### 0. 実質的な競合は2社しかいません

**価格非公開は「日本のSMBを相手にしていない」という意味です。** Omni・Holistics・Zenlytic は
いずれも価格を公開しておらず、Zenlytic の顧客は Verizon・Workday・Stanley Black & Decker。
**月10万円規模の顧客に営業をかけません。**

したがって**6社と戦う話ではありません**。価格を公開している **Evidence Cloud と Metabase**、
そして無料で使える OSS（Metabase OSS / Lightdash OSS）が実際の比較対象です。

**この切り分けを最初にしないと、必要のない絶望をします。** 以下の各節は、比較対象を
この2社＋OSSに絞って読んでください。

### 1. 構想はほぼ既存製品で埋まっています

**Holistics** は「コードで定義」「PRでレビューしロールバック」「平易な言葉で質問」「行・列権限」
「テナント別セキュリティ」を**すべて備えています**。構想との重なりが最も大きい。

**Omni** は「GUIで作った操作がコードに落ちる」という、非エンジニアの自走とコード正本の両立に
正面から取り組んでいます。

**Zenlytic** は自然言語を第一の入口に置き、その精度をGit管理のセマンティック層で担保しています。
**「AIの出力をPRでレビューする」という構想の中核は、既に実装されています。**

### 2. Evidence Cloudは機能の直接競合です

2026-08-11時点の公式情報では、EvidenceはRepChatが検討している主要な機構を既に製品化しています。

| 領域 | Evidenceの公式仕様 | RepChatへの含意 |
|------|--------------------|-----------------|
| 分析agent | 現在のpageとfilterを文脈にし、chart、query、source付き回答を作り、Insightとして保存する | 自然言語質問と根拠表示だけでは差別化にならない |
| channel | SlackとMCP client（Claude Desktop、ChatGPTを含む）から利用できる | SlackをUIにすること自体は差別化にならない |
| context | custom context、skills、evals、observabilityを提供する | 顧客固有contextや分析手順の保存だけでは差別化にならない |
| authoring | Evidence Studioのeditor、AI差分提案、live preview、Git branch、review、publishを提供する | SQL／Markdown、Git、AI編集、branch previewだけでは差別化にならない |
| embedded delivery | Enterprise Planで、公開済みpageをbackend APIから取得したsingle-use URLでiframe表示し、JWE、RLS、theme、language、session TTLを適用する | 埋め込み、white-label、RLSだけでは差別化にならない |

#### Embedded Analyticsは編集機能ではない

EvidenceのEmbedded Analyticsは、**作成済み・公開済みのpageを顧客の製品内へ安全に配信する機能**です。
顧客側backendが認証済み利用者のembed URLを発行し、frontendがiframeで表示します。URLは一回限りで
2分以内に使用し、開いた後のsessionは指定TTLに従います。利用者属性はJWEで暗号化され、RLSへ渡されます。

レポートを作成・修正する場所はEvidence StudioまたはGit／CLIです。閲覧者はfilterやinputを操作できますが、
Embedded Analytics自体がSQL editor、自由layout editor、またはGit branch操作を顧客製品へ埋め込むわけでは
ありません。したがって、RepChatで検討しているWeb SQL workspaceとversioned panel compositionは
**authoring**、顧客製品内表示は**delivery**であり、補完関係にあります。

#### SQL Consoleとcustom reportは別の面です

SQL Consoleは、接続済みdataを任意SQLで探索するself-service面です。RepChatで提案済みの
Web SQL workspaceに最も近い機能ですが、SQL Console単体をcustom report editorとは扱いません。
2026-08-11に確認した公式文書からは、Consoleのqueryを一操作でreportへ昇格する契約までは確認できません。

custom reportの作成面はEvidence StudioのReport Editorです。pageはMarkdown、SQL、componentで構成され、
Evidence Agentが生成または編集する場合もdiffを利用者がaccept／rejectします。accept後のreport sourceは
Developer／AdminがeditorまたはGit／CLIで編集できます。Viewer／Org Viewerはeditorへアクセスできません。

ただし「全graphに編集可能な生成SQLが一つずつ存在する」とは限りません。Evidence Studioのcomponentは
data sourceと集計式を直接参照でき、page内inline SQLやstandalone SQL fileを使う構成もあります。
編集可能なのはreport source全体であり、必ずしも各graph専用の明示SQL fileではありません。

公式料金ページの2026-08-11表示では、Teamは$15/人・月、Proは$25/人・月、Enterpriseは個別見積です。
Embedded、white labeling、RLS、multi-regionはEnterpriseです。価格と機能表は契約時に再確認します。

参照: [Evidence](https://evidence.dev/)、
[Analytics Agent](https://evidence.dev/product/analytics-agent)、
[Pricing](https://evidence.dev/pricing)、
[Evidence Studio editing](https://docs.evidence.studio/editing)、
[Markdown](https://docs.evidence.studio/core-concepts/markdown)、
[Publishing and roles](https://docs.evidence.studio/publishing)、
[Studio migration guide](https://docs.evidence.studio/migration-guide)、
[Version control](https://docs.evidence.studio/features/version-control)、
[Embedded Analytics](https://docs.evidence.studio/features/embedded)、
[Slack分析インターフェース要件](requirements/slack-analysis-interface.md)

### 3. 席数課金そのものへの逆風

**Lightdash は $3,000/月の定額で席数無制限**、OSS版は無料。**Metabaseも定額＋従量の混合**です。
「席数を増やすと高くなる」ことへの顧客の抵抗が、業界として価格設計に現れています。

ユーザー単位課金は、**ある規模を超えると必ず定額製品と比較されます**。

### 4. 「何を見ればいいか」の支援も機能名だけでは差になりません

Evidenceはcustom skillsで確認質問や分析手順を定義でき、公式ページはhealth check、churn調査、board prep
などを利用例に挙げています。したがって「何を見ればよいか分からない人への対応が競合にない」という
旧仮説は、2026-08-11時点では事実として使えません。

残る検証対象は、**日本語の代理店業務で、利用者が目的だけを伝えた後に、KPI、比較軸、期間、panel構成、
根拠、会議で決めるべきactionまでを少ない確認回数で合意できるか**です。機能の有無ではなく、対象業務での
完了率、正確性、所要時間で比較します。

| | 利用者に要求されるもの | 使える人 |
|---|---|---|
| チャット | **何を聞くべきか分かっていること** | 分析ができる少数 |
| ダッシュボード | 見るだけ | **全員** |

「自動でダッシュボード生成」は、質問を一つのchartへ変える機能ではありません。RepChatで検証する対象は、
分析目的を複数の判断可能なKPIとpanelへ分解し、利用者の確認を経て固定成果物へ変える一連の操作です。
チャットは作成時の入口、ダッシュボードは継続利用の入口として役割を分けます。

Evidenceも回答をInsightへ保存し、管理対象pageへ昇格できます。永続する成果物、Insight保存、
dashboardへの追加もRepChat固有ではありません。比較すべき対象は、成果物の有無ではなく、分析計画の
合意、費用確認、根拠検証、顧客別の認可、会議actionまでのworkflowです。

#### この仮説に対する反証材料

**「誰も見ないダッシュボード」はBIの古典的な失敗そのものです。** 固定物にすれば解決するわけではなく、
効くかどうかは**そのダッシュボードが正しいか**にかかります。業務理解を要するため、
**AIが自動生成したものが正しい保証はまだありません。仮説のままです。**

スキーマだけから生成したダッシュボードは、一般に**汎用的で価値が薄くなります**。正しさを左右するのは
業務文脈であり、それは業種ごとに異なります。**横断的に薄く当てるより、業種を絞る方が成立しやすい**
可能性がありますが、これも未検証です。

EvidenceとZenlyticはいずれも近い位置にいます。定期配信、会議用要約、確認質問、分析playbookは
競合が追加できるため、個別機能を恒久的な優位として扱いません。

## それでも残りうる差別化

候補は個別技術ではなく、対象顧客とworkflowの組合せです。

| 差別化候補 | 現在の根拠 | 現在の判定 |
|------------|------------|------------|
| 日本の小規模代理店が複数顧客を安全に扱う運用 | 主要顧客は確定。製品統合は未完了 | 検証対象 |
| 日本語で目的を分解し、KPI・panel・費用を確認してから実行 | ローカルデモにprototypeあり | 実顧客比較が必要 |
| 根拠外数値を拒否する会議報告と、決定・owner・次回検証のloop | strict validatorはprototype、意思決定loopは将来要件 | 現在の製品優位とは主張しない |
| 接続主体を人から分離し、担当者退職で壊れない | ADR-0010で設計確定 | 運用価値をデザインパートナーで確認 |
| 日本語の導入支援、請求、説明責任 | 提供方針。競合の国内契約実務は未確認 | 営業比較が必要 |

自然言語SQL、セマンティック層、Git管理、Insight保存、Slack／MCP、custom context／skills、RLS、
埋め込みはEvidenceを含む競合が提供しているため、単独の差別化として使いません。

## この文書が示唆する行動

**機能を追加して追いつく方向は、単独では成立しません。** 相手は資金を得た企業で、
同じ機能を先に持っています。

したがって次の問いは「何を作るか」ではなく、**「なぜ日本の小さな会社が Evidence Cloud や
Metabase を使っていないのか」**です。これは机上では答えが出ません。

ヒアリングの問いも変わります。**売り込む必要がありません。** そして上記4の仮説は、
**最も聞きやすい問いで検証できます**:

> **「BIツールを入れたことはありますか。使われていますか。使われていないなら、なぜですか。」**

**導入済みで使われていない事例が複数出れば、仮説は裏付けられます。** 全員が「使いこなせている」なら、
**この構想は成立しません**。実績も製品も要らない問いで、かつ**机上では絶対に答えが出ない**ものです。

補助として「何を使っていますか」「なぜそれを選びましたか」。**説明ではなく質問だけで済みます。**

Evidenceとの機能比較は公開ページの読解で終えません。同じ日本語の分析目的、同じschema、同じ既知値を使い、
分析計画の確認回数、正答率、dashboard完成時間、根拠追跡、会議actionの採用率を測定します。RepChatが
Evidenceを上回ったと主張できるのは、この比較で差が再現された後です。

## 関連

- [.ai/decision-log.md](../.ai/decision-log.md) — LOG-0062
- [ai-governance-requirements.md](ai-governance-requirements.md) — 上位層の前提条件
- [analysis-workspace-ui.md](requirements/analysis-workspace-ui.md) — authoring、publish、embedのUI境界
- [status.md](status.md) — 実装状況
