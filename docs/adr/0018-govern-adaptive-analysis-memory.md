---
id: adr-0018
title: 適応型分析メモリーを版管理された方針として統制する
status: accepted
updated: 2026-08-02
---

# ADR-0018: 適応型分析メモリーを版管理された方針として統制する

| 項目 | 値 |
|------|----|
| 状態 | accepted |
| 日付 | 2026-08-02 |
| 決定者 | repository owner |
| 作成者 | Codex |
| 置換対象／置換後 | — |

## 背景

対話型の分析仕様確定（Issue #180）と根拠付き所見（Issue #181）は、顧客の期待に毎回一致するとは限らない。
修正を再利用すれば質問を減らせるが、利用者や会話が似ているだけでは別顧客・別指標・変更後schemaへ誤適用する。

着想は、repository ownerが見たLookMLを含むLooker系デモから、一度の対話には限界があると推測したことである。
競合の客観的評価ではなくdesign partnerで検証する仮説であり、元の案の維持ではなく安全に解くことを目的とする。

生の会話履歴では有効な方針、承認者、失効を表現しにくく、AIの直接上書きは原因と取消対象を説明できない。
指標の意味はADR-0013、生成物とSQLはADR-0015の正本を持ち、個人メモリーへ複製してはならない。

初期3〜5社では外部serviceのscaleよりtenant境界、承認、監査、削除、rollbackを優先する。Issue #160が`proceed`になるまで製品実装も停止する。

## 検討した選択肢

### 選択肢1: session内だけで扱い、永続メモリーを持たない

最も単純で誤適用の影響を限定できるが、同じ修正と確認を繰り返し、利用者が期待する自己改善を実現できない。

### 選択肢2: 生の会話履歴を保存し、RAGで類似会話を検索する

実装しやすいが、類似度と権限を混同しやすく、履歴肥大、削除、有効版、互換性、rollbackが未解決なため不採用。

### 選択肢3: Vertex AI Memory Bankを正本にする

scope内検索等を使えるが、階層scope、role承認、指標統制、tenant削除、artifact再現性は製品側に残る。
初期規模で保存・削除・障害面を二重化する便益が未実証なため、Phase 1の正本にはしない。

### 選択肢4: Postgresで構造化・版管理した分析方針を正本にする

既存control planeとRLSでscope、authority、revision、由来、期限、状態を管理する。初期工数は増えるが、誤適用防止、監査、rollback、vendor非依存を同じ境界で満たせるため採用する。

## 決定

選択肢4を採用する。メモリーは生の会話履歴やmodel weightではなく、Postgresを正本とする**scope付きの不変policy revision**とする。AIは候補を提案できるが、有効revisionを黙って上書きしてはならない。

### D1. メモリーを方針の種類に分ける

少なくともsystem・security、tenant・組織、分析対象・顧客、分析レシピ、user表示嗜好、session-only overrideを
区別する。組織方針、指標、business goal、security制約は権限者の承認を必要とする。低リスクな個人表示嗜好
だけは、本人が「次回も」と明示した後に有効化できるが、通知と取消を必須とする。

### D2. 「初回」ではなく文脈の互換性を判定する

`tenant + analysis subject/workspace + datasource/schema version + analysis purpose/family + audience +
metric definition version + recipe version`を正規化したfingerprintを使い、exact、compatible、newを判定する。
期間、キャンペーン、店舗、地域は実行時パラメータとして除外する。

### D3. 認可scopeと類似検索を分離する

tenant、workspace、userは認証済みserver contextから取得し、完全一致する認可scopeで候補集合を限定する。
embedding類似度をidentityやauthorizationに使わず、顧客横断学習は既定で禁止する。

### D4. 候補、承認、有効化、取消を分離する

修正時に「今回だけ／自分の次回以降／この分析目的／この顧客組織／tenant標準として提案」を確認する。
変更はcandidateから承認を経て新しいactive revisionとなり、旧版を破壊しない。差分、理由、由来、作成者、承認者、期限を記録し、rollbackも新しいrevisionとして監査する。

### D5. 既存の正本を上書きしない

指標の意味はADR-0013の定義層で変更候補として扱う。SQL、query result、dashboard pageはADR-0015のartifact
revisionとして保持する。manifestはpolicy revision IDまたはhashだけを参照し、rawな個人メモリーを顧客Gitへ書かない。

### D6. UIは自然な日本語を主経路にする

「この分析で覚えていることを表示」「なぜ適用したか」「今回だけ」「忘れて」「取り消して」を提供する。
`show memory`はaliasに留め、管理面では適用中、組織・顧客方針、自分の設定、承認待ち候補、変更履歴を分離する。

### D7. 段階導入し、外部memory serviceを先行導入しない

Phase 0は要件とADRだけとする。Phase 1はIssue #160の`proceed`、#179/#188、#180のanalysis specification
revision契約を開始条件とし、手動作成・承認・表示・取消を実装する。
Phase 2でAIによる候補抽出、Phase 3で反復修正から昇格や再確認を**提案**する。自動昇格は行わない。
Phase 4で量または遅延が実測上の問題になった場合だけ、pgvectorまたはMemory Bankを派生indexとして評価する。

## 影響

**良い影響:**

- 「自己学習」を、説明・承認・取消できる変更として利用者へ見せられる。
- 顧客、分析目的、個人嗜好を混ぜず、同じ分析だけ質問を減らせる。
- 指標定義、分析仕様、artifact、AI所見をpolicy revisionで再現可能に結び付けられる。
- 外部memory vendorを変更しても、認可と正本を維持できる。

**悪い影響:**

- 候補と有効版、scopeとauthority、期限と互換性を実装するため、単純なchat history RAGより初期工数が増える。
- 管理者の承認待ちが利用体験を遅くする可能性がある。
- 保持期間と本番role mappingは、design partnerとIssue #194の決定が必要になる。
- 自動的に何でも覚える印象は避けられるが、利用者へscopeを説明するUX設計が必要になる。

**後続作業:**

- Issue #160が`proceed`になった後、Phase 1実装Issueを新しく作る。
- Issue #179の来歴UIとIssue #180のanalysis specification revisionへpolicy revision表示を接続する。
- Issue #181は同じpolicyを参照し、別の顧客メモリーを作らない。
- 保持期間はdesign partner、role mappingはIssue #194の結果を使って確定する。

## 参考

- [適応型分析メモリー要件](../requirements/adaptive-analysis-memory.md)
- [ADR-0013](0013-metric-definitions-live-in-our-own-layer.md)
- [ADR-0015](0015-publish-artifacts-through-customer-git.md)
- Vertex AI: [memoriesの取得](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/fetch-memories)、[設定](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/set-up)、[RPC reference](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rpc/google.cloud.aiplatform.v1)
