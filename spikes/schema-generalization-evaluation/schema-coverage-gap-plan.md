---
id: schema-coverage-gap-plan
title: 正式評価のschema別不足とscope準備計画
status: proposed
updated: 2026-10-07
---

# 正式評価のschema別不足とscope準備計画

既存の公開2schemaを同じ汎用runtimeで評価する方針を維持し、人工JOIN補助1件は別の補助検査として保持します。
現時点では正式fixtureへ統合できません。この文書は不足する参照・評価範囲と、追加取得前に提示するscope案を
整理します。対象選定の変更、追加tableの認可、クラウド操作、製品実装の承認ではありません。
参照内容・個別承認・人工ケースの検出力は[補強計画](reference-coverage-plan.md)を正本とします。

## 出所と維持する評価条件

[要件定義書§9](../../docs/requirements.md#9-最優先の技術検証コードより先にやるスパイク)と
[ADR-0025](../../docs/adr/0025-discover-analysis-contracts-without-source-specific-code.md)は、対象別code・設定・固定SQLを
追加しない同じpipelineでの未知schema評価を要求します。GA4にも例外・専用設定を設けず、過去の専用実装の成功率を
今回の汎用runtimeの評価結果へ流用しません。

[`execution_manifest.py`](execution_manifest.py)は異なるschema ID・scope fingerprintを最低2件、
各schemaの全6必須capability、各case最低3 run、結果一致率90%以上の下限を要求します。
[`evaluation_capabilities.py`](evaluation_capabilities.py)のlabel検査は参照SQLの意味や網羅性を証明しません。
合成ケースの行数や誤答数を、独立case数・AI反復数へ加算しません。
既存の選定、取得・承認範囲は[評価README](README.md#評価対象の選定)を正本とします。

## 対象別の不足

下表は参照準備の状態です。実AIの成功・失敗判定ではありません。case固有の参照知識は評価側だけに保持します。

| 必須capability | `github_nested`の参照準備 | 公開GA4の正式評価準備 | 承認済み人工JOINの位置付け |
|---|---|---|---|
| `nested_unnest` | 配列長の基本参照は限定採用済み。要素値・条件・親粒度を含む参照の補強とreviewが必要 | 今回のharness用の質問・全期待行・独立reviewを固定する必要がある | nested/repeated構造なし。網羅へ数えない |
| `multi_level_nesting` | 深いfieldの非NULL件数は限定採用済み。欠落・同名field・区分別の補強が必要 | 同上。過去の結果を現在のfixtureへそのまま流用しない | 複数階層なし。網羅へ数えない |
| `join` | 同一tableからの集約集合間JOINは補助採用のみ。異なる物理tableの関係・key・粒度のcaseとscopeが未確定 | 異なる物理tableの対応を参照で説明できるcaseとscopeが未確定 | 1件の参照内容は承認済み。自動table/key発見・正式schemaの網羅とは別 |
| `period_comparison` | 最古・最新日の件数差は基本採用のみ。同じ観測幅・各期間の個別値・境界の補強が必要 | 質問・期間・timezone・期待各行を現在の参照として固定する必要がある | 時間列なし。網羅へ数えない |
| `window_function` | 日別累積値の単一合計は補助採用のみ。各日・区分・欠落日を照合する補強が必要 | window分析の粒度・各行・順序と参照結果の固定が必要 | JOIN集計だけ。window能力の参照とはしない |
| `ordered_behavior` | 異なる時刻群の間隔合計は補助採用のみ。各間隔・欠落・同時刻条件の補強が必要。活動の完全順序は仮定しない | 主体・時間・同時刻・欠落の規則と各行の参照を固定する必要がある | 時間・順序の参照なし。網羅へ数えない |

`github_nested`の参照SQLに使った日時文字列の変換は、製品の固定parserではありません。その変換を
共通runtimeが同じ入力だけから生成・検証できるかは未測定です。参照準備の成功をruntime対応済みとしません。
[`analysis_contract_response.py`](../report-generation/analysis_contract_response.py)は同一table token同士の
relationship生成を拒否します。ただし、これだけでSQL全経路の自己JOIN可否を断定しません。
既存の集約集合JOINをlabelだけで別物理tableの関係発見へ読み替えたり、未測定の制約をこの段階で修正したりしません。

## 不足を解消する案と採用しない案

推奨は、公開2schemaの正式参照を別々に整え、物理JOINの不足だけを必要なscope案として明示する順序です。
追加対象を認可するまで、現在の公開scopeと人工JOIN scopeは変更しません。

- 公開schemaごとに、関連する別物理tableの候補・関連根拠・質問・出力粒度を調査する。
  table名や似たIDだけで関係を確定せず、標準metadata・description・bounded実値で確かめる条件を列挙する。
  公開資料の候補が見つかっても、それだけで認可済み・参照成立とはしない。
- 参照を決められる追加候補がなければ、その不足を報告する。別の評価対象や評価専用の関連tableを提案する場合は、
  対象変更・配置・scope・期待値を新たな案としてreviewする。無関係なtableをJOINして網羅件数だけを増やさない。
- 現在の人工JOIN2tableへ時間・nested列を黙って追加しない。承認済みの入力・SQL・期待行を維持する。
  全capability用の別合成schemaを作る案は今回の採用案ではなく、実顧客schema品質の代替にもならない。
- 同じ人工JOINケースを公開2schemaへ重複登録して独立した2件のJOIN検証としない。
  自己JOINを許すようruntimeを変更する、capabilityを未検証のまま付与する、scorerを緩めることも行わない。

## 次の実施順序と停止点

1. 公開資料と既存の参照記録から、公開schemaごとの別物理table候補・関連根拠・未確認条件を整理する。
   この段階では認証付きmetadata・行取得・query・AIを呼ばず、具体的なtable IDを認可scopeへ追加しない。
2. 必要最小限のtable集合とcase質問・粒度・欠落／重複／順序条件を1件ずつ提示する。
   現在のscopeでは成立しない条件を明記し、オーナーが追加scopeや対象変更を決めるまで実取得へ進まない。
3. scope決定後、metadata取得・bounded profile・参照queryの回数、出力上限、保持期限と最大費用を提示する。
   必要な取得・配置・実行をそれぞれ承認後に行い、変更した質問へ既存の期待値を流用しない。
4. 各schemaの参照内容と6能力の意味的網羅をreviewし、実snapshot・全fixture・予定run・pipelineを固定する。
   1件の参照承認や公開tableの存在だけではこの段階を完了としない。
5. 実provider command・無料回帰・価格snapshot・全run予算と具体的な実行承認が揃ってから、
   同じruntime・prompt・設定で反復評価する。観測した原因に対応する対象非依存の改善だけを後続で比較する。

不足整理時点ではローカルの文書・コード照合だけで、候補tableの選定・追加認可・公開資料の新規調査・クラウド操作は行っていません。
後続の[公開JOIN候補調査](public-join-candidate-review.md)では、一次資料で確認した候補・限界と、最初のmetadata確認案を整理しました。
後続のmetadata取得は個別承認後に認証段階で停止しましたが、認証更新・再開指示後に1回成功しました。
取得範囲と未確認事項は候補調査の記録を正本とします。metadataだけでJOIN成立とは判断しません。
正式scopeへの追加は未承認です。
既存tableの期限は[配置結果](reference-coverage-plan.md#2026-10-04の承認と配置結果)のままです。
期限が切れても自動で延長・再配置しません。正式fixture、全schemaの網羅、実AI品質は未完了です。

## 2026-10-07の正解データ充足性監査

正解データ作りはまだ十分とは判定できません。人工6ケースの計算はBigQueryでも一致しましたが、
公開2schemaの各行参照・意味的網羅・全参照の独立review・実snapshotへの固定が残っています。
以下を完了条件として分け、人工ケースの成功やPRマージを不足条件の代替証拠にしません。

| 条件 | 現在の証拠 | 残る確認 |
|---|---|---|
| 人工参照の計算・方言 | Python・SQLiteの局所検算に加え、BigQueryで6ケース・24出力行の全列・順序が一致 | 新しいBigQuery SQL bytesへの独立review。inline入力の確認を物理table metadataの確認へ拡張しない |
| 誤答の検出力 | 各人工ケースでキー・粒度・NULL・欠落・期間・順序の誤答検査を保持 | 公開schemaの補強参照でも、単一合計の相殺や同じ値の別主体を区別できる範囲を確認する |
| 公開GitHubの6能力 | 基本6ケースは限定採用済み。別物理2tableのJOIN参照SQLと6行のreview資料は準備済み | JOIN資料のオーナー判断。配列条件・深いfield・期間別件数・日別累積・各時刻間隔の各行参照を補強する |
| 公開GA4の6能力 | 対象選定はオーナー指示。旧専用経路は今回の証拠にしない | 現行汎用harness用の質問・参照・全行・独立review。別entity tableの関係・scopeは未確定 |
| schemaと認可 | 異なるschema ID・scope fingerprint最低2件、各schema全6能力という現行検査を維持 | 正式scopeとruntime読取り主体・権限を確定し、実共通discoveryのcanonical snapshotへ参照をbindする |
| 独立review・不変な参照 | 人工JOIN補助1件の内容承認は記録済み。残りの承認は推測しない | 全SQL・期待各行・列・順序・評価範囲の回答を正確なbytesへbindし、正式fixtureを固定する |
| runtimeからの正解分離 | 今回は製品・評価runtimeを変更せず、参照SQL・期待行はprivate artifactだけ | 正式manifestに正解・capabilityを含めず、同一runtime・prompt・設定と全予定runを実行前に固定する |

人工計算確認の回数・費用・失敗記録・確認範囲は[BigQuery照合結果](reference-coverage-plan.md#2026-10-07の人工6ケースのbigquery照合)、
現在の1回100円以内の直接実行権限は[費用境界](reference-coverage-plan.md#現在の実行権限と費用境界)を正本とします。
独立reviewや正式scopeの判断が必要でも、認可済み対象の参照補強・局所検算は継続します。
過去の「次の費用承認待ち」を現在も一律の停止条件にせず、上界を証明できない呼出しは送信しません。

次はGitHub側の5つの補強参照を、既存取得schema・日時の確認記録・人工対抗例を根拠に準備します。
質問・期間・NULL・粒度・全列・行順序とSQLを先に固定し、各queryのdry run後に有限batch予算内で期待行を取得します。
生の主体IDや活動内容をGit・logへ出さず、必要なprivate内容だけを1ケースずつオーナーへ提示します。
公開GA4側の参照準備と別table・scopeの未決事項も別に解消し、人工JOINの重複登録で網羅件数を増やしません。
参照準備の完了と、その後の実AI反復・品質合格は別の判定です。
