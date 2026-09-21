---
id: status
title: 実装状況サマリー
updated: 2026-09-21
---

# 実装状況サマリー

**何が出来ていて、何が未着手か**を一枚で示します。優先順位は[ロードマップ](roadmap.md)、
決定の経緯は[decision-log](../.ai/decision-log.md)と[discovery-log](discovery-log.md)、
設計の中身は[ADR-0005](adr/0005-cache-and-authorization-architecture.md)、
[ADR-0015](adr/0015-publish-artifacts-through-customer-git.md)、
[ADR-0018](adr/0018-govern-adaptive-analysis-memory.md)と
[system-design](system-design.md)が正本です。この文書はそれらへの索引を兼ねた現在地です。

更新契機：モジュール完成、実環境検証の完了、フェーズ移行。

---

## 0. 再開手順（新しいAIセッション向け）

規約は [AGENTS.md](../AGENTS.md) → [CLAUDE.md](../CLAUDE.md) → [.ai/README.md](../.ai/README.md)
の順。**この節は「規約」ではなく「今どこにいるか」**で、LOG番号が0086まであり全部読むのは非効率なため置く。

**この順で読めば同期できる:**

1. **本節と §1**（現在地）
2. [positioning.md](positioning.md) — **何で戦い、何で戦わないか**。実装の優先順位はここから逆算する
3. [.ai/decision-log.md](../.ai/decision-log.md) の**新しい順に LOG-0059 以降**。
   それ以前は設計フェーズの記録で、再開には不要
4. 進行中の仕事に触れるなら、該当する ADR と `spikes/*/README.md`

**現在の作業**: [Issue #188](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)の対象非依存runtime評価。
対象別profile・固定schema・固定SQLを持つ旧runtimeは削除済みで、再混入をarchitecture testで拒否する。
[PR #757](https://github.com/Yukihide-Mitsuoka/repchat/pull/757)までに、実際のscope discoveryと分析契約生成を
評価preflightへ接続し、失敗attemptも固定stage／codeで分母へ残す境界を実装した。
[PR #759](https://github.com/Yukihide-Mitsuoka/repchat/pull/759)では、独立review用fixtureから参照SQL・期待結果・
capabilityを除外し、認可scope・質問・計画runだけをruntimeへ渡すexecution manifestを実装し、merge済みである。
続く[PR #761](https://github.com/Yukihide-Mitsuoka/repchat/pull/761)で、manifestを完全検証してから
全計画attemptを共通preflightへ渡し、失敗時はmanifest内のpipeline fingerprintへ固定したrun記録を作る境界を
実装し、merge済みである。[PR #763](https://github.com/Yukihide-Mitsuoka/repchat/pull/763)では、
共通分析契約が十分な場合にplannerが不要な初回確認を要求しないよう契約を修正し、merge済みである。
[PR #765](https://github.com/Yukihide-Mitsuoka/repchat/pull/765)では、成功したpreflightだけを共通plannerへ接続し、
計画失敗を固定stage／codeでattemptへ残す境界を実装し、merge済みである。
[PR #767](https://github.com/Yukihide-Mitsuoka/repchat/pull/767)では、評価caseの単一SQL・単一結果契約とplanner出力を
一意に対応させるため、評価呼出しだけを1パネルに限定し、確認質問、0件、複数パネルを自動選択せず
planning失敗へ閉じる境界を実装し、merge済みである。
[PR #768](https://github.com/Yukihide-Mitsuoka/repchat/pull/768)では、成功した単一パネルを共通section変換とSQL generatorへ渡し、
生成拒否、矛盾、不正形式、例外を固定`sql_generation`／`sql_generation_failed`へ閉じる評価stageを実装し、merge済みである。
続く[PR #769](https://github.com/Yukihide-Mitsuoka/repchat/pull/769)で、生成SQLを共通の
SELECT・scope・field・period・partition・可視化出力契約validatorへ渡し、失敗を固定
`sql_validation`／`sql_validation_failed`と安全性booleanへ変換するstageを実装し、merge済みである。
続く[PR #770](https://github.com/Yukihide-Mitsuoka/repchat/pull/770)では、検証済みSQLだけを共通BigQuery dry runへ渡し、parsed statement type、参照table、
出力schema、推定処理bytesと契約上限を照合するstageを実装し、merge済みである。
[PR #772](https://github.com/Yukihide-Mitsuoka/repchat/pull/772)では、dry run成功attemptだけを
共通BigQuery実行へ渡し、契約のbytes上限と行上限を維持して、行・列・実`total_bytes_processed`を保持する。
失敗は固定`execution`／`execution_failed`へ閉じ、merge済みである。
[PR #774](https://github.com/Yukihide-Mitsuoka/repchat/pull/774)では、製品側と評価側を
同じ共通結果検証へ接続し、列、行数、可視化shapeを照合して、成功結果だけをJSON-safe化する。
検証失敗は実行済みとして処理bytesを保持する一方、生の未検証行をrun記録へ残さず、固定
`result_validation`／`result_validation_failed`と`semantic_error`へ閉じる。
通常のdashboardの設定件数は変更しない。
PR #776で共通rendererをES module化し、PR #778でstdinの検証済みJSON結果だけを受け取る無出力probeから
vendored EChartsのSVG SSRまたは共通DOM rendererを実行できるようにした。PR #780では、結果検証成功attemptだけを
probeへ渡し、描画成否、検証済み行、実処理bytes、計測費用を最終run記録へ接続する。描画失敗でも検証済み行を保持して
結果一致と描画を独立評価し、前段失敗ではprobeを呼ばない。対象別profile、設定、fallbackは追加しない。
PR #781では、全計画runと外部計測値を一対一に照合し、run記録、scope snapshot、analysis contractを
既存assembler用の非上書きprivate artifactへまとめる境界を実装する。不一致や同一schema／case内のartifact変化は拒否する。
公式fixture、独立review、実値照合、
全runtime段階を含む同一binary・prompt・設定での反復評価は未完了。
今回の更新ではローカルのvendored EChartsとDOM stubだけを実行し、実Vertex AI・BigQueryを呼び出していない。現在の作業順と詳細は
[development-handoff](development-handoff.md)を参照する。

**直近のデモ修正**: [Issue #230](https://github.com/Yukihide-Mitsuoka/repchat/issues/230) /
[PR #231](https://github.com/Yukihide-Mitsuoka/repchat/pull/231)（2026-08-02 merge済み）で、ライブ画面の
Sankey描画欠落、問い合わせ月を無視する固定期間、PR #197で離れたEvidence基調の視覚言語を修正した。
[Issue #232](https://github.com/Yukihide-Mitsuoka/repchat/issues/232)では、同じページ種別を各段階で同色にし、
Sankey linkを遷移元色から遷移先色へのgradientにした。固定応答のブラウザ確認ではカテゴリ色6色、
gradient 7本、console error/warning 0。費用を伴うVertex AI・BigQueryは再実行していない。

**直前の実装修正**: [Issue #217](https://github.com/Yukihide-Mitsuoka/repchat/issues/217) /
[PR #218](https://github.com/Yukihide-Mitsuoka/repchat/pull/218)（2026-08-02 merge済み）。旧デモ入口の起動時に
pin済み依存を確認して必要時だけvenvへ再起動する形へ修正し、unit testとPR CIは成功した。修正後の実Vertex AI・
BigQuery問い合わせと実ブラウザ確認は未実施で、検証費用は発生していない。

その前の[Issue #190](https://github.com/Yukihide-Mitsuoka/repchat/issues/190) /
[PR #191](https://github.com/Yukihide-Mitsuoka/repchat/pull/191)（2026-07-30 merge済み）。
`sqlparse==0.5.5`のaligned modeが`indent_width`を使わず予約語幅で字下げするため、表示時に
構文階層ごとの0、4、8、12...スペースへ正規化した。保守対象14クエリ179行と保存済みデモ6クエリ99行で、
4の倍数でない字下げ、SELECT直下の列ずれ、タブがすべて0件であることを確認した。BigQueryは実行していない。

その前の[Issue #178](https://github.com/Yukihide-Mitsuoka/repchat/issues/178) /
[PR #182](https://github.com/Yukihide-Mitsuoka/repchat/pull/182)は、2026-07-30にmerge済み。
SQLをSELECT列・主要句単位で整形し、各分析内の結果／生成プロセス・SQLタブ、購入KPI、
リピート率、平均エンゲージメント、購入ファネル、日次＋7日移動平均へ改修した。さらに、入口から
3ページ目までの上位12回遊を段階付きで集計するR17とEvidence標準`SankeyDiagram`を追加した。
R17を含む6問版は実Vertex AI・BigQueryで**6/6**、推定**¥1.285**、R17は12 edgeをmaterializeし、
production build・ブラウザ描画・横スクロール・error/warning 0まで確認した。後続調査で、SQLは
タブ文字を含まない一方、`sqlparse`の予約語幅による位置合わせが残ると判明し、PR #191で是正した。
これは公開GA4 schema上の実測であり、未知の独自nested/repeated schemaへの一般化は未検証
（[Issue #188](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)）。
製品UX、目的からKPI・複数グラフ・読順を設計する対話型ダッシュボードbuild、AI所見は
Issue #179〜#181へ分離した。

その前の[Issue #173](https://github.com/Yukihide-Mitsuoka/repchat/issues/173) /
[PR #175](https://github.com/Yukihide-Mitsuoka/repchat/pull/175)（2026-07-29 merge済み）。
既存デモは日本語からSQLを生成・実行していたが、画面にはEvidence側のローカルSQLしか出ず、
手書きSQLの描画に見える欠陥があった。日本語1問、Vertex AIが生成したBigQuery SQL、生成理由、
実行・参照値照合の状態、描画結果を同じページへ出す変更を実装した。2026-07-29に実Vertex AI・
BigQueryで1/1、参照値118,380との一致、Vertex AI推定¥0.154、Evidence materialize/build、
ブラウザ表示、browser error/warning 0を確認した。PRのCIも12/12成功した。

「デモを見せられる形」の基礎は**完了**（LOG-0081）。
顧客Gitへの配送方式は[ADR-0015](adr/0015-publish-artifacts-through-customer-git.md)として
オーナー承認済み（LOG-0082）。GitHub Appとartifact pipelineの実装は未着手。
[ADR-0013](adr/0013-metric-definitions-live-in-our-own-layer.md) はオーナー承認済みで、
**日本語の記述 → SQL生成 → 検証 → Evidenceで実データ描画 → テナント別配信**まで実測済み。

**前回立てた3手の現在地:**

| | 手 | 状態 |
|---|---|---|
| 1 | **C7 の決定**（定義と生成物の置き場所） | **完了**（LOG-0077/0082）。ページ・SQL・manifestは顧客Git、指標定義はこちら側。Gitはbuild時だけ使い、閲覧経路には入れない（ADR-0014/0015） |
| 2 | **シェル/データ分離との結線** | **完了**（LOG-0076）。1度だけビルドしたシェルを2テナントに配り、**シェルHTMLは byte 同一・差し替えた2件だけが別の数値**を実測 |
| 3 | **`src/` への移植** | **未着手**。生成もEvidence統合も、まだスパイクにしか無い |

**配置と閲覧は独立した境界。** 顧客Gitは所有・build入力であり、シェル/データ分離の閲覧経路には
入らない。`src/`移植では、同じArtifactBundle・検証・build・有効化pipelineに
GitHub publisherとmanaged publisherを接続する。build成功後だけcommit SHAと`report_version`を有効化し、
失敗時は直前の成功版を配信する。詳細はADR-0015。

### 0.1 過去記録 — 「デモを見せられる形にする」（2026-07-29）

**3（`src/` 移植）より先にこれをやる**、というのがオーナーの判断。理由は、移植は大きく後戻りしにくい
一方で、positioning §5 が残した唯一の未検証仮説「**BIを入れたが使われていない**」は
**実装では潰せない**から。今あるものは既に**実データで動くデモ**なので、**人に見せられる状態が先**。

**やること2つは完了。**

| | 結果 | 確認状況 |
|---|---|---|
| **旧デモ入口** | **削除済み**。対象別profile、固定期間・語彙・例を含むため、現行能力として提供しない | 過去の実行結果は対象非依存性の証拠にしない。代替入口は共通runtime完成後に設計する |
| **説明資料** | [Looker Studio利用者向け5分説明](demo.md) | 日本語→SQL→照合→ページ、Looker Studioとの差、実測範囲と未統合のgate・認証・executorを5分の順番で分離した。実際の利用者が5分で理解できるかは次の対面検証で測る |
| **生成経路の画面内表示** | ライブ画面で質問、AI分析仕様、生成BigQuery SQL、理由、検査状態、結果を表示する | 単一グラフとダッシュボードの両方で、AI仕様とSQL・結果形状の一致を確認してから描画する |
| **高度な分析** | 利用者の目的からAIが複数パネルとlayoutを作成し、再提案で追加・変更・削除する | 固定6分析のショーケースは廃止。初回件数だけを既定6件とし、内容は固定しない |

**やらないこと**: 製品機能。Issue #173は既存経路を画面から検証可能にする変更で、
`src/`を触らず`spikes/`内で完結する。

**現在のボトルネック**: 対象固有のcode・profile・設定・固定prompt・SQL・期間parser・識別子補正・
指標定義をすべて削除し、未知schemaを同じ共通pipelineで反復評価できる状態にすること。

### 0.2 手を動かす前に知っておくこと

**実環境は生きていて、課金される。**

| | |
|---|---|
| デプロイ | Cloud Run（asia-southeast1）＋ Cloudflare Workers（`gate.aeworks.workers.dev`）で**稼働中**。維持費はほぼゼロ（ゼロスケール＋$5/月） |
| 破棄 | `make destroy` は `ALLOW_DESTROY` が要る（ADR-0012 T7）。**破棄系のコマンドを出すときは、確認コマンドを破棄コマンドより先に提示すること**（オーナー指示） |
| スパイクの費用 | 旧公開サンプル検証ではレポート生成1回で**実Vertex 約¥2＋実BigQuery**、scanは`_TABLE_SUFFIX`で1か月・`maximum_bytes_billed` 20GiBだった。現在のSQL実行境界は分析契約のtable範囲・bytes上限を必須とし、旧入口は削除済み |
| 認証 | `gcloud auth application-default login` が要る（Evidence も `authenticator: gcloud-cli` でADCを使う。**鍵ファイルは不要**） |
| Python | 旧ライブデモ入口は削除済み。対象非依存runtime用の実行入口は未実装 |

**踏みやすい落とし穴（全部、実際に踏んだもの）。**

- **PRタイトルの type に `spike:` は無い。** スパイクでも `test:` を使う。`pr-quality` が数秒で落ちる（2回やった）
- **「動いた」と「検証した」を混同しない。** 破棄→再構築後の 10/10 は**キャッシュ配信**で、
  実行系は動いていなかった（LOG-0060）。**監査行やジョブ履歴など、経路を通った証跡で確かめる**
- **BigQuery のプラン成功は実行成功ではない**（LOG-0067 で訂正）。dry-run が通っても実行は別
- **画面のSQLを2層に分けて読む。** Vertex生成SQLはBigQueryへ送り、EvidenceのページSQLは
  materialize済み結果をDuckDBで読む。どちらも必要列を明示し、`SELECT *`は実行前に拒否する
- **測っていないことは「測っていない」と書く**（GR-042）。README とPRに限界を明記するのがこのリポジトリの作法
- **主要顧客は確定済み**（LOG-0079）。複数顧客へ分析・定期レポートを提供する日本の小規模代理店・
  ソフトウェアベンダーが初期の主経路で、直販はフォールバック。mission.md との不整合は
  **課金区分と認証方式の2点だけ**残る（[Issue #194](https://github.com/Yukihide-Mitsuoka/repchat/issues/194)）。
  この2点はオーナー決定前に推測しない

**オーナーとのやりとりは日本語。** 断定と、**限界の明示**の両方を求められる。
推奨があるなら「選択肢の羅列」ではなく**推奨を先に**述べること。

**この文書の更新契機**: モジュール完成、実環境検証の完了、フェーズ移行、**作業スレッドの切替**。

---

## 1. 一行でいうと

**技術検証は一区切りした。** 認可ゲート・実行エンジン・コントロールプレーンは
**本番構成でデプロイ済み・ライブ検証済み**（LOG-0058/0059/0060）。
`make destroy` からの復旧まで実走で確認している。

**現在は対象非依存runtimeの反復評価が最優先。** 旧デモは対象別profileと固定知識を含むため削除済みで、
過去の成功を任意schema対応の証拠にはしない。共通preflightと評価harnessは実装済みだが、公式fixtureを使う
全runtime段階の反復評価は未完了である。

**事業方針は2026-07-27に大きく動いた。** 競合調査（LOG-0062）で構想の技術要素が
ほぼ既存製品にあると判明し、差別化を**日本語・国内対応・代理店経由の流通**に置き直した。
実観測された痛み（LOG-0064）を根拠にしている。詳細は [positioning.md](positioning.md)。

---

## 2. 完成しているもの

### 2.1 モジュール（`src/modules/`）

| モジュール | 役割 | 状態 |
|---|---|---|
| `gate` | エッジ認可ゲート。JWT検証、認可コンテキスト解決、①②③キャッシュ、剥奪 | 完成（Issue #23） |
| `executor` | SQLへのテナント境界注入（AST）、BigQuery実行、監査 | 完成（Issue #55, #65） |

両モジュールともランタイム非依存のコア＋薄いアダプタ構成（ADR-0006）。テスト計115本。

### 2.2 「意見」ではなく「実測された事実」

重要な主張を推測のまま残さない方針で進めました。以下は実際に走らせて得た測定値です（検証方法の欄に、
実環境かインプロセスかを明記しています）。

| 主張 | 検証方法 | 結果 |
|---|---|---|
| NL→SQLは安いモデルで実用精度が出る | 合成データ＋実スキーマ(thelook) | **12/12・12/12**、約¥0.1/問（LOG-0022/0023） |
| Evidenceを動的データに載せられる | ビルド出力を分解し2チャネル制御を実証 | 解決（LOG-0025） |
| 認可を壊さずキャッシュできる | インプロセス測定（実環境ではない） | **12/12**、ヒット率99.89%、p95 0.51ms（LOG-0031） |
| RLSが最後の砦になる | 実Postgres 16 | **7/7**。WHERE句を書き忘れても越境しない（LOG-0032） |
| テナント越境は構造的に不可能 | 実BigQuery | **7/7**。同一SQLで各テナントが自分のデータのみ（LOG-0033） |
| 縦串が実データで通る | JWT→認可→境界注入→BigQuery→KV | **8/8**（LOG-0035） |
| 縦串が**デプロイ済み構成**で通る | 実HTTP・実JWT（Workers→Cloud Run→Neon→BigQuery、スタブ無し） | **10/10**。越境ゼロを含む。ここで初めて出た3欠陥はいずれもローカルでは原理的に検出不能だった（LOG-0059） |
| 日本語の記述からレポートを生成できる | 実GA4エクスポート（公開サンプル）＋実Vertex。手書き参照SQLと値を照合 | **15/15 を2回連続**、1レポート約¥2。未定義指標の拒否を含む（LOG-0072）。未知の独自nested schemaは未検証（Issue #188） |
| 生成ページを1シェルで複数テナントに配れる | 1度だけビルドし、テナント別 `.arrow` を被せて2ポートで配信 | **シェルHTMLは byte 同一**（sha256一致）で、desktop **68,649**セッション / mobile **47,088** と別々に描画。差し替えていない項目は両テナントで同一。ただし**テナント境界は `device.category` の代用**で、gate も認証も経路に無い（LOG-0076） |
| 指標定義を固定すると数値が安定する | 同上、定義あり/なしで3回ずつ実行 | 定義なしでは購入件数が**1204↔895で揺れ**、定義ありで**12/12が実行間一致**。ただし**SQLの文面は12中7で毎回変わる**＝固定されるのは意味であって構文ではない（LOG-0066） |

### 2.3 多層防御（ADR-0005 原則C）の到達状況

| 層 | 実装 | 検証 |
|---|---|---|
| ①エッジ認可ゲート | `gate` | テスト済み |
| ②アプリ層のtenant_id強制注入 | `executor`（AST書き換え） | 実BigQueryで実証。書き換え後の再検証つき（LOG-0042） |
| ③データソース層の隔離（管理データ＝Postgres） | `app_runtime` ロール＋RLS | 実Neonで実証（7/7・13/13、LOG-0032/0039） |
| ③データソース層の隔離（分析データ＝BigQuery） | テナント別サービスアカウントのなりすまし（ADR-0010 D1） | **実BigQueryで実証（5/5、LOG-0052）** |
| ④ペイロード自己検証 | キャッシュ読出時のtenant_id assert | テスト済み |

**正直な現在地**：この多層防御は、**管理データ（Postgres）・分析データ（BigQuery）の双方で①③が本物のバックストップとして成立**しました。前者はRLS（実Neon 7/7・13/13、LOG-0032/0039）、後者はテナント別SAのなりすまし（実BigQuery 5/5、LOG-0052）で、いずれもアプリ層が全崩壊してもデータ層が越境を止めることを実測済みです。

- LOG-0033 の「実BigQuery 7/7」は**②バインダの出力**の証明であり、②アプリ層の話。LOG-0052 はその**独立した③データ層**の証明：バインダを完全にバイパスして越境SQLを直接投げても、なりすましSAには相手データセットへのIAM権限が無く BigQuery が `Access Denied` を返す。
- 実行時のD1接続主体は `datasources.connection_ref`（なりすまし対象SAメール）から解決される（実Neonで確認、LOG-0047）。`ImpersonatingTokenProvider` が IAM の短命トークンを都度発行（鍵不保存）。
- したがって「Lookerより安全」は**管理データ・分析データの双方で裏付けられた**状態。合成ルートは
  LOG-0050で実装し、デプロイ済み構成の結線はLOG-0059で10/10を確認済み。

同一テナント内の**②行スコープ**（店舗フィルタ）には、書き換え後の構造検証が入った（LOG-0042）が、これは同一プロセス・同一パーサの自己点検であって独立層ではない — ADR-0010 D4／LOG-0040/0041。

### 2.4 確定した主要な設計判断

- **データ層の2分割**（分析＝BigQuery／管理＝Postgres+RLS）— 原則D、LOG-0026/0027
- **アクセス制御の2軸分離**（①テナント分離＝硬い境界／②ロール認可＝製品機能）— 原則E、LOG-0028
- **エッジランタイム＝Cloudflare Workers**（本番$5/月固定）— ADR-0006
- **接続型ウェアハウスの認証＝顧客ごとに1サービスアカウント**（OAuth不採用）— ADR-0005 §9.2、LOG-0034
- **接続主体は決して人間にしない**（接続主体＝テナント単位の機械ID／認可主体＝エンドユーザー本人。セキュリティ実装をコネクタ数に比例させない。プッシュダウンは最適化であって制御ではない）— ADR-0010、LOG-0040
- **製品名は表示専用**、識別子に入れない — COD-005、LOG-0030

---

## 3. まだ無いもの（正直な一覧）

| 項目 | 状態 | 何が要るか |
|---|---|---|
| **コントロールプレーン**（tenants/users/roles/reports の実装） | **コード完成・デプロイ済み**。スキーマ・RLS・アダプタは実Neonで実証（LOG-0039）、Workers対応transportとNode合成ルートを実装（PR #99〜#101）、デプロイ済み経路を10/10で確認（LOG-0059） | — |
| **テナント別の接続資格情報**（ADR-0010 D1） | **デプロイ済み・本番構成で実証**。シーム＋`ImpersonatingTokenProvider`＋control-planeがD1 identityを返す（PR #93/#95/#97）、executor合成ルートで実結線（PR #101）、バックストップを実BigQueryで実証（5/5、LOG-0052）、**デプロイ済み構成で各テナントが自分のSAとしてクエリしていることをBigQueryジョブ履歴で確認（LOG-0059）** | — |
| **②行スコープの構造検証**（ADR-0010 / LOG-0040・0041） | **実装済み**（PR #89、LOG-0042）。`scopeColumn` を必須化し、書き換え後の再パースで行スコープ対象表が主体のフィルタ内にあることを検証（`assertRowScopeBound`） | — |
| **②行スコープの独立層** | **無い**。構造検証は同一プロセス・同一パーサの自己点検であって独立層ではない | 候補は成果物ベースのみ（他はD6で却下）。**採否は鮮度SLA次第＝パートナー待ち** |
| **列レベル制御** | 未実装（`DataScope` は `all` / `stores` のみ）。**AI分析機能のマスキングと同一物**（[ai-governance-requirements.md](ai-governance-requirements.md)、LOG-0061） | ADR-0005 §6 の設計をパートナーのスコープ実態に合わせて確定。着手条件は**AI分析レポート機能に着手すると決めたとき** |
| **NL→SQLの製品組込み** | **スパイクで一本通った**（LOG-0065〜0072）。日本語の記述→SQL→照合→Evidenceページを **15/15 で2回連続**、未定義指標の拒否を含む。**`src/` には未着手** | 定義層の実装（`QUERY_POLICY` の発展形）、executorへの接続 |
| **未知の独自nested schemaでのNL→SQL品質** | **評価基盤を実装中・品質は未検証**。対象別runtimeは削除済み。共通preflightから結果検証・描画までの接続、最終run記録、assembler入力artifactの安全な出力境界は実装済み | 外部計測器と実行入口を接続し、公式fixtureを独立reviewしたうえで、認可済みscopeだけを入力に複数の未知schemaを同一binary・prompt・設定で反復実行して、実値・安全性・費用・描画を照合する（ADR-0025、Issue #188） |
| **適応型分析メモリー** | **未実装・方針承認済み**。要件とADR-0018をIssue #220で文書化。生の会話ではなくscope・権限・revision・期限を持つ方針をPostgresで管理し、AIは候補を作るが自動昇格しない | #188の対象非依存品質境界、#179、#180のanalysis specification revision契約後にPhase 1実装Issueを作る |
| **Evidenceの本番統合** | **生成物が実データで描画され**（LOG-0073。セッション118,380等、検証済みの値と一致）、**1シェルを2テナントに配れることまで実測**（LOG-0076）。認証は `gcloud-cli` で**鍵不要**。**ただし全てローカルビルド・`spikes/` 内**で、gate も executor の境界注入も経路に無い | `src/` への移植（ビルド起動と成果物配信の主体を決める）、executorが注入する述語での配信 |
| **生成物と定義の所有**（顧客のGitか、こちらか） | **決定済み**（[ADR-0014](adr/0014-who-owns-the-generated-artifacts.md) / [ADR-0015](adr/0015-publish-artifacts-through-customer-git.md)、LOG-0077/0082）。**ページ・SQL・manifest＝顧客Git／指標定義＝こちら側**。Gitはbuild時だけ使う | 実装は未着手。同じpipelineへGitHub/managed publisherを接続する。初期はApp管理branchへの直接commit、PR modeは実需まで延期 |
| **デプロイ（GCP側）** | **完了・ライブ稼働中**（LOG-0058）。control-plane / executor が Cloud Run（asia-southeast1）で動作。`/health` 200、トークン無し・誤トークンとも401をライブ実測（5/5）。`make destroy` は**13破棄→13再作成→ライブE2E 10/10 まで実走して確認**（LOG-0060。URL同一・bootstrap所有物は保持） | — ※T4は**組織ポリシーの明示的除外**の上に成立（ADR-0012の前提条件） |
| **デプロイ（Cloudflare側）** | **完了・ライブ稼働中**（LOG-0059）。KV4本・両URL・共有シークレットを設定し `gate.aeworks.workers.dev` で稼働。**Workers → Cloud Run → Neon → BigQuery を実HTTP・実JWTで貫通するライブE2Eが10/10**（越境ゼロを含む） | — |
| **顧客向け要素** | 未着手 | オンボーディング手順、セキュリティ説明資料、撤退時データ削除 |

### 未確定事項（パートナー待ち）

ADR-0005 §10の残り2件は、**実顧客のデータ形態が分からないと決められない**ため意図的に保留しています。

- §10-6 BigQueryのテナント分離方式 — ホスト型はテナント別データセットで実証済み（LOG-0033）
- §10-7 分析データの供給元（RepChatがホストするか、顧客のBQに接続するか）— **認証方式のみ決定済み**（LOG-0034）

---

## 4. 現在地の評価

認可・tenant分離・配信基盤の大きな技術的不確実性は解消した。一方、**未知の独自nested schemaへ
NL→SQLを一般化できるかは未検証**で、Issue #188を製品化gateとして残す。事業上の最大リスクは引き続き
「この製品を必要とする顧客が実在するか」である（[requirements §1.5](requirements.md)の
「小さく黒字」方針、LOG-0021）。

未知schema benchmarkでは対象別コード、設定、手動意味定義を追加せず、同じruntimeによる自動理解を検証する。
次の最大レバレッジは、公式fixtureの独立reviewと、参照情報をruntimeから隔離した反復実行を完了して、
対象非依存品質の実測値を得ることである。

---

## 5. 索引

| 知りたいこと | 見る場所 |
|---|---|
| 何を作るのか・事業モデル | [requirements.md](requirements.md) |
| どう作るのか（図・スキーマ） | [system-design.md](system-design.md) |
| なぜそう決めたのか | [.ai/decision-log.md](../.ai/decision-log.md)（新しい順） |
| 検討の経緯・スパイク結果 | [discovery-log.md](discovery-log.md) |
| 次に何をやるか | [roadmap.md](roadmap.md) |
| どうデプロイするか | [deploy.md](deploy.md) |
| 実験の再現手順 | `spikes/*/README.md` |
