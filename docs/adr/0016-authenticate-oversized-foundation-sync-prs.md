---
id: adr-0016
title: ADR-0016 — 大規模な基盤同期PRを厳密に認証する
status: proposed
updated: 2026-07-29
---

# ADR-0016: 大規模な基盤同期PRを厳密に認証する

| Field | Value |
|-------|-------|
| Status | proposed |
| Date | 2026-07-29 |
| Deciders | repository owner |
| Author | Codex (AI agent) |
| Supersedes / Superseded by | ADR-0008を補足し、GR-020の基盤同期時の扱いを限定する |

## Context

ADR-0008により、Template Syncは保護対象を上書きせず、直接親の変更をレビュー付き
PRとして作成する定期transportになった。一方、現在の`pr-quality`は、PRの作成主体や
出所に関係なく800行または20ファイルを超える変更を拒否する。

同期PR #163は、次の条件を満たしている。

- 同一リポジトリの`github-actions[bot]`が規定の同期branchへ作成した。
- PR本文に直接親`Yukihide-Mitsuoka/ai-dev-foundation`の完全な40文字SHAがある。
- 変更対象はmanifest上の基盤所有20ファイルだけであり、保護対象を含まない。
- lint、test、build、doctor、link-check、security、CodeQLはすべて成功した。

それでも変更量が2,279行あるため、サイズチェックだけが失敗する。これは21個の親
commitを初めてまとめて受け入れる移行負債であり、再実行や次回の定期同期では解消
しない。

制約は、通常PRのGR-020を弱めないこと、同期PRを自動マージしないこと、親の出所を
完全なSHAで再現できること、workflowの権限を増やさないこと、他の必須CIと人間の
レビューをすべて維持することである。

## Options considered

### Option 1: 何もしない

同期PR #163を閉じ、以後も大規模な同期を拒否する。ポリシー変更はないが、基盤との
差分が残り続け、同じ失敗が定期的に発生する。

### Option 2: 同期差分を手作業で複数PRへ分割する

各PRを現在の上限内にできる。しかし、機械的に生成された一つの親差分を人が再構成
するため、出所と内容の対応が弱くなり、不完全な中間状態と反復作業が増える。大きな
単一ファイルには適用できない。

### Option 3: Template SyncのPRを無条件でサイズ上限から除外する

実装は簡単だが、branch名だけを偽装したPRやforkからのPRまで許可する可能性があり、
fail-closedではないため採用しない。

### Option 4: 認証済みの機械的同期だけを限定除外する

作成主体、head repository、target repository、branch名、base branch、PR本文の直接親
URLと完全なSHAをすべて検証する。全条件が一致した場合だけhard limitをwarningとして
扱い、その他は現在どおり拒否する。他のCIと人間レビューは必須のままにする。

## Decision

Option 4を採用する。

サイズ上限を超えるPRは、次の条件をすべて満たす場合に限り、認証済みの機械的な基盤
同期として許可してよい。

1. authorが`github-actions[bot]`である。
2. head repositoryとtarget repositoryが
   `Yukihide-Mitsuoka/repchat`で一致する。
3. head branchが`chore/template_sync_<7〜40文字の16進SHA>`形式である。
4. base branchが`main`である。
5. PR本文に
   `Direct-parent-source: https://github.com/Yukihide-Mitsuoka/ai-dev-foundation@<40文字SHA>`
   が独立した行として存在する。

判定はworkflow内の複製されたshellではなく、リポジトリ内のテスト可能なpolicy script
で行う。各条件の不一致、短いSHA、別親、fork、不正な数値入力を個別のnegative testで
固定する。

この例外はサイズチェックだけに適用する。同期PRも全必須CI、人間レビュー、通常の
squash mergeを必要とし、自動approve・自動merge・追加credentialを導入してはならない。
manifestの所有権検証と直接親lockの更新手順も変更しない。

## Consequences

**Positive:**

- 完全な出所を持つ機械的同期を、内容を分割せずレビューできる。
- 通常PR、fork、手作成branch、短縮SHA、別親は現在のhard limitを維持する。
- 追加のtoken、権限、自動マージを必要としない。
- 同じpredicateを回帰テストとworkflowで共有できる。

**Negative:**

- 大規模同期PRは人間にとって依然として認知負荷が高い。
- bot identity、branch命名、PR本文の形式がセキュリティ境界の一部になる。
- target-ownedなTemplate Sync workflowが侵害された場合、大きなPRを作成できる。ただし
  必須CIと人間レビューなしにはマージできない。
- ADR-0014の継承レイヤー実装後も、移行期間中はこの例外を保守する必要がある。

移行は、最初にpolicy scriptとnegative testを追加し、次に保護workflowから呼び出す。
そのPRをマージした後、既存の同期PR #163を最新`main`へ更新して全CI成功を確認する。
ロールバックはworkflowを従来の無条件hard limitへ戻す通常PRであり、同期内容、
repository設定、credentialは変更しない。

**Follow-ups:** Issue #167で実装し、同期PR #163の成功を実証する。基盤ADR-0014の
実装後、例外の利用頻度と必要性を再評価する。
