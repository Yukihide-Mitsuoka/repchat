---
id: adr-0027
title: ADR-0027 — 実評価の承認と予算境界をprovider呼出し前に固定する
status: proposed
updated: 2026-09-23
---

# ADR-0027: 実評価の承認と予算境界をprovider呼出し前に固定する

| Field | Value |
|-------|-------|
| Status | proposed |
| Date | 2026-09-23 |
| Deciders | repository owner |
| Author | Codex |
| Supersedes / Superseded by | — |

## Context

未知schemaの評価harnessは全Vertex AI応答の入力・出力token、全BigQuery query jobの処理・課金bytesを
run単位で記録する。しかし現行meterはprovider応答後に費用を計算するため、評価全体の費用上限を
provider呼出し前に強制しない。BigQueryの`maximum_bytes_billed`も個別queryの境界であり、
複数runの合計を制限しない。Vertex AIの使用tokenは応答後に確定し、途中の失敗や不明な課金結果を
費用ゼロとして扱えない。

公式評価では最低2件の未知nested／repeated schemaを各caseで反復する。scope discovery、契約生成、
計画、SQL生成、dry run、実行の複数呼出しが発生する。対象と実行回数、送信されるbounded value profile、
model、region、課金方式、価格、承認上限を固定せずに開始すると、オーナーは何を承認したか検証できない。
現在の`RuntimePricing`は円建ての入力・出力token単価とBigQueryのTiB単価だけを表現するため、
異なるSKUや追加課金項目を推測して評価を続けることもできない。

この判断は評価spikeに限定する。製品課金、顧客への請求、クラウド請求書の総額保証は対象外である。

## Options considered

### Option 1: 現行の事後計測だけで実行する

実装は最小だが、上限超過を検出する時点では課金済みである。個別queryの上限も評価合計の上限には
ならないため採用しない。

### Option 2: 各runの実測費用を確認してから次のrunへ進む

run間で停止できるが、1 run中の複数provider呼出しが残額を超え得る。不明な応答の再実行でも
重複課金を避けられないため、これだけでは採用しない。

### Option 3: 承認済み計画へ価格を固定し、呼出しごとに保守的な上限を予約する

実行前の入力照合と各呼出し前の残額検査を追加する。上限を証明できないmodel、料金項目、
provider操作では評価を開始しない。実装と回帰テストは増えるが、承認範囲外の呼出しを拒否できるため
採用を提案する。

## Decision

Option 3を提案する。人間が本ADRを承認するまで実provider評価commandと予算制御を実装しない。

### D1. 承認対象を1つの不変な評価計画に結び付ける

実行前に、独立review済みfixture、認可済みproject・dataset・table scope、予定schema／case／run ID、
runtime・prompt・configuration artifact、model・region・課金方式、`as_of`、出力先、価格snapshotを固定する。
オーナーには、scope discoveryで取得するmetadataとbounded value profileがVertex AIへ送信されること、
各providerの最大予定費用と合計上限を示し、この**特定計画**の実行可否を確認する。承認を他のscope、
model、計画、再実行へ流用しない。file内のIDやhashだけで承認者の本人性を証明したとは扱わず、
実際の承認記録を別途確認する。参照SQL・期待結果はruntime入力へ渡さない。

### D2. 価格snapshotの適用範囲を限定する

価格snapshotには取得日時、出典、請求通貨、model、region、提供tier、BigQuery課金方式と、
入力・出力100万token単価、BigQuery課金対象1 TiB単価を記録する。思考tokenは出力、tool prompt tokenは
入力へ含める。初期commandは円建ての明示単価が得られるtext-only Vertex AIとBigQuery on-demandだけを
扱う。cache割引がある場合も通常入力単価で保守的に予約する。capacity reservation、grounding、
別modalities、未表現の従量項目、適用価格が変わる長文脈などは、最大適用単価と使用量を
保守的に算定できる実装ができるまで拒否する。割引・無料枠は上限を緩める根拠にしない。
価格snapshotは実際の請求額や税額の保証ではない。

### D3. 全従量呼出し前に残予算を検査する

実行は計画runを逐次処理し、Vertex AI生成とBigQuery queryの**各呼出し前**に、承認済みの
provider別・合計残額がその呼出しの保守的な最大費用以上ある場合だけ送信する。BigQueryでは
全query（scope discoveryを含む）にその予約以下の`maximum_bytes_billed`を適用する。
Vertex AIではmodel・requestごとに入力と出力・思考を含む課金tokenの上界を確認する。
`max_output_tokens`や事後usageだけで上界を証明できない場合は送信しない。予約と観測usageを
同じ単位で照合して差額を解放し、次の呼出しへ進む。dry runの推定bytesは実課金bytesに加算しない。

応答・jobのusage欠落、途中失敗、取消、timeout、上界違反、価格不一致では費用ゼロを仮定せず
評価を停止し、残りの計画runを自動実行しない。自動retryもしない。途中停止したrunを成功として
除外せず、計画に対する未完了として保持する。承認済み上限は**このcommandが許す従量操作**の境界であり、
他processの利用、クラウドの別SKU、税、為替、請求書総額を保証しない。

### D4. 承認前に無料の回帰だけを行う

fake clientで、scope・artifact・価格・承認の欠落や不一致、全provider呼出し前の予算不足、
usage不明、出力非上書き、計画runの欠落を検証する。公式fixtureと独立review証跡が揃い、
上界を持つbudget gateと全回帰が通った後に、価格snapshotと最大費用を提示して実行承認を求める。
承認前は実Vertex AI／BigQueryを呼ばない。公式fixtureの参照結果を作るためにも有料queryが必要な場合は、
評価runnerとは別に対象・最大費用を提示して承認を得る。分析対象固有のcode、設定、prompt、SQL、
手動意味定義は追加しない。

## Consequences

**Positive:**

- オーナーが認可scope、送信内容、回数、model、金額の一体として承認できる。
- run間だけでなくprovider呼出し前に不足予算を拒否し、成功runだけの選別も防げる。
- 価格やusageの不明点を安価と推測せずに停止できる。

**Negative:**

- modelごとの出力・思考token上界を証明できなければ、有料評価を開始できない。
- 最悪値の予約は保守的であり、承認額が小さい場合に実際の請求より早く停止し得る。
- この制御でもGoogle Cloudの別作業、請求調整、税などを含む請求書総額は保証できない。

**Follow-ups:**

1. オーナーが本ADRを承認、修正または却下する。
2. 承認後、価格snapshot・承認計画のoffline検証、呼出し前budget gate、fake client回帰を小さいPRへ分割する。
3. 実行条件を満たせるmodel・料金を確認し、公式fixtureと独立review証跡を用意する。
4. 具体的なscopeと最大費用を提示し、その計画に限る実行承認を得てから有料評価する。

## Rollback

実評価commandを無効にし、既存の事後計測・post-run scorerをoffline用途に戻す。承認済み計画の
scopeや予算を暗黙に変更して再利用しない。

## References

- [Issue #834](https://github.com/Yukihide-Mitsuoka/repchat/issues/834)
- [評価harness](../../spikes/schema-generalization-evaluation/README.md)
- [ADR-0025](0025-discover-analysis-contracts-without-source-specific-code.md)
- [Google Cloud Vertex AI料金](https://cloud.google.com/vertex-ai/generative-ai/pricing)
- [BigQuery料金](https://cloud.google.com/bigquery/pricing)と[query費用制御](https://docs.cloud.google.com/bigquery/docs/best-practices-costs)
