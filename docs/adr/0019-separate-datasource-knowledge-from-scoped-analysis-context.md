---
id: adr-0019
title: データソース知識と分析文脈を分離し、用途別にコンパイルする
status: proposed
updated: 2026-08-09
---

# ADR-0019: データソース知識と分析文脈を分離し、用途別にコンパイルする

| Field | Value |
|-------|-------|
| Status | proposed |
| Date | 2026-08-09 |
| Deciders | repository owner |
| Author | Codex |
| Supersedes / Superseded by | — |

## Context

ADR-0018は、顧客固有の修正を生の会話やmodel weightへ暗黙学習させず、scope付きの不変policy revisionとして
統制すると決めた。しかし「顧客固有の情報」には、custom dimensionやnested pathのようにSQLの正しさを左右する
物理schema知識と、事業目標、KPIの選び方、会議報告の順序、個人の表示嗜好が含まれる。これらを一つのメモリーと
して継承すると、個人の修正が組織の指標またはschema契約を上書きし、誤ったSQLを次回も再利用するおそれがある。

販売主経路には代理店とsoftware vendorを含むため、RepChatのtenantと分析対象企業が同一とは限らない。企業と
利用者の二階層だけでは代理店配下の顧客を区別できず、すべての顧客へ部門階層を要求すると初期運用が重くなる。

全履歴、全schema、全方針を毎回modelへ渡す方式はtoken費用と応答遅延を増やす。一方、利用者が「文脈を読み取る」
ボタンを押した時だけ適用する方式は、押し忘れによってSQLの正しさやsecurity制約が変わる。初期3〜5社で新しい
in-memory DBまたはvector serviceを正本にする費用と運用上の便益も、まだ実測されていない。

## Options considered

### Option 1: ADR-0018の汎用policyだけを使い、区分を増やさない

保存先とworkflowは単純だが、schema知識、指標、事業前提、個人嗜好のowner、検証、失敗時の動作が異なる問題を
一つの継承規則で扱うことになる。誤適用時の影響範囲が大きいため不採用とする。

### Option 2: 生の会話と生成SQLをvector DBへ保存し、類似検索する

入力例を素早く増やせるが、古いSQL、schema版、tenant境界、有効版、取消、根拠を一意に扱えない。類似度は
認可または正しさの証明にならず、追加serviceの費用と削除整合も発生するため不採用とする。

### Option 3: 企業と利用者の二階層で全文脈をpromptへ入れる

小規模な直販顧客には分かりやすいが、代理店配下の分析対象と部門固有方針を表現できない。文脈量が増えるほど
tokenとlatencyが比例し、用途に不要な物理schemaを会議報告へ渡すため不採用とする。

### Option 4: 正本を情報種別に分け、任意の組織単位と用途別compilerを使う

PostgresとRLSを正本として維持し、schema依存知識、指標定義、組織コンテキスト、分析・報告recipe、個人嗜好を
分離する。認証済みscopeで決定的に絞った後、用途別のhard budget内へ必要なrevisionだけを構造化する。
情報種別ごとに継承規則を持つため初期設計は増えるが、安全性、説明可能性、token効率を同時に満たせる。

## Decision

Option 4を提案する。これはrepository ownerが本ADRを承認するまで実装判断ではない。

### D1. 正本を五つの情報種別へ分離する

1. **データソース契約:** field path、custom dimension key、型、grain、join、partition、null semantics、
   安全な抽出template、schema fingerprint、検証証拠。
2. **指標定義:** 指標の意味と出力形状。ADR-0013を正本とする。
3. **組織コンテキスト:** 事業モデル、目標、会計年度、意思決定周期、固有用語、禁止解釈。
4. **分析・報告recipe:** KPI、比較軸、layout、読順、報告対象、action表現。
5. **user preference:** 表示単位、説明量、任意のchart表現など低リスクな個人嗜好。

生成SQL、query result、生の会話本文はどの正本にも保存しない。AIはデータソース契約候補を作れるが、schema・型検査、
dry runまたは参照値検証、権限者承認を通るまでSQL生成へ適用してはならない。

### D2. scopeはanalysis subjectを必須にし、org unitを任意にする

永続scopeは`tenant → analysis subject → optional org unit → user`、一時scopeは`session`とする。tenantはsecurity境界、
analysis subjectは実際に分析される企業または組織であり、省略しない。org unitは部門固有方針のownerが存在する顧客だけが
有効化するPhase 1では一階層の任意scopeとし、未使用時のUIは実質的に分析対象企業と利用者の二階層とする。

### D3. 継承は情報種別とfieldごとに制限する

security、データソース契約、指標定義はuser/sessionから上書きできない。組織コンテキストの矛盾はnearest-winsで
解決せず、新revisionと承認を要求する。recipeとuser preferenceだけが、方針で`overridable`と宣言されたfieldに限り
`session > user > optional org unit > analysis subject > tenant default`を使える。競合を黙ってmergeしない。

### D4. server-side context compilerが用途別に必要最小限を選ぶ

- SQL生成: 対象schemaのデータソース契約、関連する指標定義、確定済み分析仕様の制約。
- 分析計画: 組織コンテキスト、利用可能な指標catalog、関連する分析recipe。
- 会議報告: 凍結した組織コンテキスト、報告方針、検証済みevidence bundle。

認証済みscopeによる完全一致を最初に行い、policy type、schema版、effective/review date、fingerprintまたはtagで決定的に
選ぶ。context部分は一回のAI呼出しにつき4,000 model tokensを上限とし、必須事実が収まらなければ黙って切らず、
対象を狭めるか停止する。適用revision、理由、除外、token数をcontext manifestに記録する。

### D5. 必須文脈は自動適用し、任意文脈だけ利用者が外せる

「文脈を読み取る」操作を正しさの条件にしない。security、データソース契約、指標定義は自動適用し、無効化できない。
UIは「今回適用するコンテキスト」をscope、revision、理由付きで表示する。分析recipeと個人嗜好だけは、policyが許可した
場合に「今回は使わない」を提供する。ボタンを置く場合は「追加の文脈を読み取る」または「適用中の記憶を確認」とする。

修正を保存する既定は「今回だけ」とし、自分、org unit、analysis subject、tenant標準へ広げる場合は影響範囲を示す。
広いscopeは権限者承認を必要とし、AIが有効版を直接上書きしない。

### D6. Postgresを正本とし、追加cacheは実測後に決める

Phase 1は既存Postgres、RLS、複合indexで実装し、in-memory DB、Memory Bank、pgvectorを追加しない。初期規模では
追加infrastructure costより、context compilerによるprompt token削減を優先する。5,000 active revisions/tenantの
load testでretrieval・compileのp95 200msを目標とする。

目標を外れた場合だけ、scope chain、有効revision set hash、schema版をkeyにした再構築可能なcompiled-context cacheを
追加し、revision epochで無効化する。vector検索を導入しても派生indexに限定し、identity、authorization、必須revisionの
選択へ使わない。

## Consequences

**Positive:**

- custom dimension等の顧客固有SQL知識を再利用しながら、生成SQLや古い会話を正本にしない。
- 企業・部門・個人の要望を表現でき、小規模顧客には不要な部門設定を見せずに済む。
- SQL生成、分析計画、会議報告へ不要な文脈を送らず、token費用とlatencyを制御できる。
- 利用者は何が適用されたか確認でき、任意の嗜好だけを今回外せる。

**Negative:**

- policy typeごとのowner、validation、継承、UIを実装するため、単純なchat RAGより初期工数が増える。
- データソース契約の有効化にはschema検査と承認が必要で、初回接続は即時生成より遅くなる。
- 4,000 tokenとp95 200msはPhase 1の検証目標であり、design partnerのschema量と利用状況から再評価が必要になる。
- 本番role mappingと承認者はIssue #194が決まるまで確定しない。

**Follow-ups:**

- 本ADRをrepository ownerが承認または修正する。
- Issue #160が`proceed`となり、#179、#188、#180の開始条件を満たした後だけPhase 1実装Issueを作る。
- design partnerにorg unitの必要性、初回登録時間、適用文脈の理解、質問削減、p95、token数を確認する。
- cache、pgvector、Memory Bankは実測値が目標を外れた場合だけ独立ADRで評価する。

## References

- [適応型分析メモリー要件](../requirements/adaptive-analysis-memory.md)
- [ADR-0013](0013-metric-definitions-live-in-our-own-layer.md)
- [ADR-0018](0018-govern-adaptive-analysis-memory.md)
- [Issue #188](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)
- [Issue #300](https://github.com/Yukihide-Mitsuoka/repchat/issues/300)
