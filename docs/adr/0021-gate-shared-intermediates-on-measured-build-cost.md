---
id: adr-0021
title: 共有中間結果を実測費用で限定する
status: proposed
updated: 2026-08-09
---

# ADR-0021: 共有中間結果を実測費用で限定する

| Field | Value |
|-------|-------|
| Status | proposed |
| Date | 2026-08-09 |
| Deciders | repository owner |
| Author | Codex |
| Supersedes / Superseded by | —。ADR-0013の顧客環境へ恒久的な平坦化viewを既定で作らない決定を維持する |

## Context

Issue #180のダッシュボードbuildは、1つの分析目的から4〜6件のpanelを生成する。現在のローカルデモは
panelごとに独立したSQLを作り、同じ期間のBigQuery sourceへ個別に問い合わせる。各queryは参照した
columnの処理量で課金されるため、共通するsession化、parameter抽出、`UNNEST`等を複数回実行すると、
data量が大きいbuildでは費用と待ち時間が増える。

共有中間結果は必ず安くなるわけではない。元sourceから中間結果を作るquery、中間結果を各panelが読む
query、一時storageの費用が発生する。共通部分が小さい、または中間結果が元dataと同程度に広い場合は、
直接実行より高くなる可能性がある。現在のデモで表示する最大240 GiBは生成SQLと独立した参照SQLの
上限合計であり、共有中間結果を1つ作っても単純に6分の1にはならない。

BigQueryの同一query result cacheは、query textが同一であること等を要求する。現在のGA4 sampleは
wildcard tableを使い、生成SQLの構文も固定要件ではないため、この費用問題をcacheだけでは解決できない。
BigQueryのmulti-statement queryは`CREATE TEMP TABLE`でbuild内の中間結果を共有できるが、temporary
tableのstorageと再scanには費用がかかり、実行後は最大24時間残り得る。sessionを使えば複数jobから
temporary tableを参照できる一方、期限付きstate、worker再開、cleanupの管理が増える。

ADR-0013は、顧客環境へ恒久viewを作る既定方式と、そのために書き込み権限を得る方式を却下している。
したがって費用最適化のために顧客datasetへ名前付きstaging tableを無断で作ることはできない。

利用者が生成SQLを再利用できることも制約になる。panel SQLが説明なしにrandomな一時tableだけを参照すると、
元source、抽出条件、指標定義を追えず、ADR-0014/0015が顧客成果物として残すSQLの価値を下げる。

## Options considered

### Option 1: panelごとの直接実行だけを維持する

最も単純で、各panel SQLが単独で元sourceを説明する。temporary data、cleanup、追加権限も不要である。
一方、共通する高費用処理を繰り返す大規模buildで、測定後も改善手段を持てない。

### Option 2: 全ダッシュボードで共有中間結果を必須にする

共通処理が大きく、中間結果が十分小さいbuildでは費用を削減できる。しかし小規模buildでも一時table作成と
scanを追加し、直接実行より高くなる場合がある。保持、cleanup、SQL説明、失敗時再実行も全顧客へ強制するため
不採用とする。

### Option 3: 利用者が常に直接／共有を手動選択する

方式が明示され、利用者の意思を反映できる。しかし利用者は中間結果の想定sizeやquery planを判断できず、
安くする目的で高い方式を選ぶ可能性がある。選択UIだけでは費用統制にならないため不採用とする。

### Option 4: 直接実行を標準とし、実測条件を満たすbuildだけへ共有中間結果を提案する

通常buildの単純さとSQLの再現性を維持し、費用規模と削減幅の両方が十分な場合だけ最適化できる。
cost planner、来歴表示、temporary data管理が必要になるが、対象を限定でき、直接実行へ戻せるため採用を
提案する。

## Decision

Option 4を提案する。repository ownerが本ADRを承認し、Issue #160の製品実装開始条件を満たすまで、
共有中間結果を実装または有効化しない。

### D1. 直接実行を標準とする

通常のbuildはpanelごとに元sourceを読む。共有中間結果は顧客規模やpanel数だけで有効にしない。
判定単位は個別のbuild workloadとし、直接実行に対する絶対削減額と削減率の両方が、実測後に定める
thresholdを超える場合だけ候補にする。

thresholdは本ADRで推測しない。Issue #160が`proceed`となった後、代表的なdesign partner workloadで、
direct planの実処理量、shared planの実処理量、一時storage、実行時間、失敗時再実行費用を測って決める。
threshold未設定、推定不能、差が小さい場合は直接実行へ倒す。

### D2. 共有可能性をbuild planで判定する

「同じtableを読む」だけでは共有しない。少なくとも次の属性が一致または安全に統合できるpanelだけを、
同じshared stageの候補にする。

- `tenant_id`、接続identity、billing project、data location
- 認可済み`scope_hash`
- datasource、物理source集合、schema revision、`data_version`
- 対象期間とtimezone
- 共通化するrow grain、必要column、指標定義revision

tenantまたは`scope_hash`が異なる中間結果を共有しない。認可scopeは中間結果を作る前にexecutorが強制し、
下流panelのfilterだけへ委ねない。

### D3. 最初の検証候補は1つのmulti-statement jobに限定する

最初のspikeでは、1つのBigQuery multi-statement job内でbuild-scopedな`CREATE TEMP TABLE`を作り、
各panel結果を生成する方式だけを評価する。顧客datasetへ恒久viewまたは名前付きtableを作らず、接続identityへ
customer datasetの書き込み権限を追加しない。

`CREATE TEMP TABLE`をAI生成SQLまたは利用者入力として許可しない。既存のread-only検証を通過した
source queryを、信頼済みbuild orchestratorがserver側の固定templateでtemporary DDLへ包む。panel SQLは
従来どおりread-only検証を通し、LLMが任意のmulti-statement SQL、DDL、table名を指定できないようにする。

build完了時はtemporary tableを明示的にdropする。異常終了時の最大24時間保持も前提に、保持期間、region、
想定sizeを費用確認に含める。job失敗までに完了したstatementは課金され得るため、shared job全体を再実行する
上限も表示する。

BigQuery sessionは、複数job間のtemporary stateとresumeが不可欠だと実測された場合だけ再評価する。
顧客datasetまたはRepChat管理datasetの名前付き期限付きtableは、書き込みIAM、data residency、削除保証、
障害時orphan cleanupを扱う別ADRなしに導入しない。

### D4. 費用比較の不確実性を表示する

有料実行前に、direct planとshared planについて次を同じ単位で表示する。

- 元sourceの推定処理量
- 中間結果作成の推定処理量
- 各panelによる中間結果scanと一時storageの推定
- 最大課金上限、予想削減額、予想削減率
- temporary tableを用いることと保持上限
- dry runではtemporary table作成後のsizeを正確に推定できない場合があること

shared planの費用承認はdirect planの承認と区別する。`maximum_bytes_billed`だけに依存せず、build
orchestratorがstatement別とbuild合計の上限を持つ。実行後はstatement別処理量、temporary storage、job ID、
cache hit、実行時間を記録し、事前予測との差を次の判定へ使う。

### D5. 中間結果の利用とSQL来歴を分離して表示する

共有中間結果を使うbuildには、画面とArtifactBundleで「共有中間結果を使用」を明示する。panelごとに
次を関連付ける。

1. **中間結果生成SQL:** 元source、期間、scope、抽出・平坦化を示す。
2. **実行panel SQL:** 論理的なstage IDからpanel結果を作る実SQLを示す。
3. **単独再現用SQL:** stage定義を展開して元sourceからpanelだけを再現するSQLを、実行SQLではないと
   明記して提供する。
4. **lineage manifest:** source revision、stage revision、panel SQL hash、result revisionを結ぶ。

BigQuery内部のrandomな物理temporary-table名を、顧客Gitに残る唯一のSQLまたは依存関係にしない。
分析担当者はpanelからstage定義と実行planへ移動できる。閲覧者向け画面は従来どおりgraphと必要なtableを
中心にし、SQL表示の認可を維持する。

### D6. 参照値検証の独立性を維持する

現在のデモでAI生成SQLと比較する手書き参照SQLは、AI生成のshared stageをそのまま入力にしない。
同じ誤ったstageから両方の値を作ると一致が検証にならないためである。

参照SQLの費用はshared planの削減見積りへ別項目として残す。将来、検証済みcanonical stageを参照基盤に
する場合は、stage自体の独立検証とtrust boundaryを別に決める。

### D7. Issue #180へは任意のbuild最適化として接続する

Issue #180のanalysis specification revisionに、shared stageを利用者が直接設計するfieldは追加しない。
仕様freeze後、cost plannerが実行planを作り、条件を満たした場合だけ共有方式と理由を提案する。
利用者は費用確認時にshared planを受け入れるか、直接実行へ戻せる。

非同期buildではshared multi-statement jobを1つの再開単位として扱う。panel単位resumeが必要な場合や、
shared jobの再実行費用が許容できない場合は直接実行を使う。進捗は「中間結果作成」と各panel生成を区別し、
中間結果作成だけでdashboard完成と表示しない。

## Consequences

**Positive:**

- 小規模buildへ追加処理を強制せず、高費用workloadだけを対象にできる。
- 認可scope適用後のbuild-local stateに限定し、customer datasetのread-only方針を維持できる。
- 実行SQLがtemporary tableを参照しても、stage定義、単独再現SQL、lineageから意味を追える。
- 実測thresholdを満たさなくなれば、direct planへ戻せる。

**Negative:**

- cost planner、shared-stage生成、statement別監査、cleanup、SQL展開の実装とtestが増える。
- multi-statement dry runでは一時table作成後の処理量を正確に予測できず、費用表示に幅が残る。
- shared jobの途中失敗では、完了済みstatementの費用を払ったうえで全体を再実行する可能性がある。
- 共有できるgrainを広く取りすぎると、中間結果が肥大化して直接実行より遅く高くなる。
- 参照SQLを独立実行する間は、デモの検証費用全体を大幅には削減できない場合がある。

**Follow-ups:**

- repository ownerが本ADRを承認、修正または却下する。
- Issue #160が`proceed`となり、Issue #180のproduction build設計へ着手する時点で、Issue #306の
  measurement spikeを独立PRとして計画する。
- 公開またはsynthetic dataでdirect/sharedの実処理量と結果一致を測る。費用承認なしに実BigQueryを
  実行しない。
- thresholdは測定結果とdesign partnerの費用規模から別revisionで確定し、本ADRへ推測値を追記しない。

## Rollback

shared planをfeature flagまたはtenant capabilityで無効化し、既存のpanel別direct planへ戻す。
ArtifactBundleは単独再現用SQLを持つため、shared executionを廃止してもpanel定義を失わない。
temporary dataが残った場合はjob/sessionを終了し、保持上限後に存在しないことを監査する。

## References

- [Issue #306](https://github.com/Yukihide-Mitsuoka/repchat/issues/306)
- [Issue #180](https://github.com/Yukihide-Mitsuoka/repchat/issues/180)
- [Issue #160](https://github.com/Yukihide-Mitsuoka/repchat/issues/160)
- [ADR-0013](0013-metric-definitions-live-in-our-own-layer.md)
- [ADR-0014](0014-who-owns-the-generated-artifacts.md)
- [ADR-0015](0015-publish-artifacts-through-customer-git.md)
- Google Cloud: [BigQuery query pricing](https://cloud.google.com/bigquery/pricing)、
  [cached query results](https://docs.cloud.google.com/bigquery/docs/cached-results)、
  [multi-statement queries and temporary tables](https://docs.cloud.google.com/bigquery/docs/multi-statement-queries)、
  [queries in sessions](https://cloud.google.com/bigquery/docs/sessions-write-queries)
