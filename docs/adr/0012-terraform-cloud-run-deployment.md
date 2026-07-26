# ADR-0012: NodeサービスをTerraform＋Cloud Runで一括デプロイし、秘密はstateに入れない

| Field | Value |
|-------|-------|
| Status | proposed |
| Date | 2026-07-25 |
| Deciders | repository owner |
| Author | Claude (AI agent) |
| Supersedes / Superseded by | — |

<!--
  Note (repo governance): ADR-0002 requires English for docs/adr content. Kept in
  Japanese under the LOG-0020 owner-approved exception (as ADR-0005 / ADR-0006 /
  ADR-0010 / ADR-0011), because the deciding audience is the Japanese-speaking owner.
  Translate when this ADR gains a formal AI-agent-facing consumer beyond the owner.
-->

## Context（強制する問題）

コードは完成し、①テナント分離は管理データ（RLS）・分析データ（D1なりすまし）の双方で
ライブ実証済み（LOG-0032/0039/0052）。残るのは実デプロイのみ（[status.md](../status.md)）。
[deploy.md](../deploy.md) は手順を文章化したが、**手作業のgcloudコマンド列**であり、
オーナーからの要求は明確:

> Cloud Runのデプロイなどは **terraformまたはMakeコマンドで一発**でできるように。
> **環境を消すのも一発**で。可能な限り**準備作業もコマンドに含める**。

### 強制する力

- **オーナー1名・「小さく黒字」**（LOG-0021）。手順書の手作業は、再現性とコストの両面で負債。
  特に**消せること**は費用管理そのもの。
- **D1のライブ検証で判明した実運用の壁**（LOG-0052）: `bq add-iam-policy-binding` は
  allowlist必須で失敗し、データセット標準ACL（`access`配列）なら通った。IaCでも同じ選択が要る。
- **GR-001**: 秘密はリポジトリに置かない。Terraform state は**リポジトリではない**が、
  秘密値を平文で保持する第2の在り処になる。
- **GR-031 / profiles rule 3**: 破壊的ターゲットは明示的オプトイン＋人の承認が要る。
- **ゲートはCloudflare Workers**（ADR-0006）。GCPのIAM資格情報を提示できない。

## Decision

### T1. IaCはTerraform、対象はGCPリソースのみ

2つのNodeサービス（control-plane / executor）を**Cloud Run**へ、Terraformで宣言的に構築する。
基盤に [terraform-gcp プロファイル](../../profiles/terraform-gcp/) が既にあり、語彙が揃う。

**Terraformの管理外**とするもの:
- **Cloudflare（gate）**: 別プロバイダ・別アカウント境界。`wrangler` が既に宣言的に扱う（ADR-0006）。
- **Neonのスキーマ**: DDLは `migrations/` が管理（LOG-0039）。**インフラ構築とデータ変更は
  失敗ドメインが違う**ので混ぜない。`npm run migrate` のまま。

### T2. 1イメージ・2サービス

`Dockerfile` は1つ。Cloud Run側で**起動コマンドを差し替える**ことで control-plane /
executor の2サービスにする（`src/main/*-server.ts`）。ビルドは **Cloud Build**
（`gcloud builds submit`）で行い、**ローカルにDockerを要求しない**。

### T3. 秘密はTerraform stateに入れない

**決定**: Secret Manager の**シークレット本体とバージョンは、冪等なbootstrapスクリプトが
ローカル `.env` から `gcloud` で作成**する。Terraformは**参照（data source）とアクセス権付与
だけ**を行い、秘密値を変数として受け取らない。

- 理由: `google_secret_manager_secret_version` に値を渡すと、**平文がstateに残る**。
  GR-001の精神（秘密の在り処を増やさない）に反する。参照だけならstateに入るのはリソース名のみ。
- 代償: 「1コマンド」の中に2フェーズ（bootstrap → apply）が入る。`make deploy` が
  順序ごと引き受けるので、**利用者から見た手数は1**のまま。

### T4. Cloud Runは公開＋共有シークレット認証（姿勢の明示）

2サービスは `allUsers` に invoker を与える＝**ネットワーク的に公開**し、**アプリ層の共有
シークレット**（`CONTROL_PLANE_TOKEN` / `EXECUTOR_TOKEN`、定数時間比較）で認証する。

**理由（2026-07-26 訂正）**: 初版は「IAM認証にするにはSA鍵をWorkersに置く必要がある」と書いた。
これは**誤り**である（WIFはまさに鍵を避けるための仕組み）。オーナーの指摘を受けて調べ直した
結果（LOG-0053）、正しい理由は次のとおり:

- **Workersには鍵無しでGCPのIAM認証を行う手段が現時点で無い。** Cloudflareが発行するOIDC
  トークンはCloudflare Access（人間のSSO）向けで、Worker自身のワークロードIDではない。
  GitHub Actionsの `ACTIONS_ID_TOKEN_REQUEST_URL` やメタデータサーバに相当するものが無い。
- したがってWIFを使うには**自分がOIDC発行者になる**（自己署名JWT＋JWKS公開）しかなく、
  **共有シークレット1つが署名鍵1つに入れ替わるだけで、保存する鍵は消えない**。
- **決定的なのは、現行案はCloudflareにGCP資格情報を「1つも」持たないこと。** 比較は
  「WIFの鍵 vs SAキー」ではなく「**鍵ゼロ（現行） vs 鍵1つ**」である。漏洩時の影響:

| Cloudflareに置くもの | 漏洩時に攻撃者ができること | 失効 |
|---|---|---|
| **共有シークレット（採用）** | **自社Cloud Runを叩けるだけ。GCP権限はゼロ**。①境界はサーバ側解決なのでデータセット指名不可、D1のIAMで他テナントに届かない | トークン差し替え |
| WIF署名鍵 | ゲートとしてトークンを鋳造→STS交換→GCPアクセス（短命・属性条件付き） | プール無効化 |
| SA鍵 | **長期のGoogle資格情報を保持。期限なく、どこからでもそのSAとして動ける。** executorのSAはテナントSAをなりすませるため、**漏洩＝全テナントのデータ露出** | 鍵削除（気づけば） |

- **再検討の引き金**: Cloudflareが**プラットフォーム発行のワークロードID**を提供したら、
  その時点で鍵ゼロのIAM認証が成立するので切り替える。アプリ層の認証は残るので二重化になる。

> **前提条件（2026-07-26 追記、実デプロイで判明）**: T4は**無料で得られる既定ではない**。
> 近年作成されたGCP組織には secure-by-default として
> `constraints/iam.allowedPolicyMemberDomains`（ドメイン制限共有）が自組織に限定した状態で
> **自動適用**され、Cloud Runの「未認証を許可」＝IAMの `allUsers` は**拒否される**。
> したがってT4の実行には**組織ポリシーの明示的な除外という、追加のセキュリティ判断**が要る。
> 初版はこれを無条件に可能と読める書き方だった（LOG-0057/0058）。
>
> 実際の初回デプロイでは、オーナーが対象プロジェクトに対して親ポリシーを置換し（許可＝すべて）
> T4どおりデプロイした。**組織の既定を1プロジェクト分ゆるめた上で成立している構成**である。
>
> あわせて意味が変わる点: この組織既定は、LOG-0053で「WIFの唯一の実質的な利点」と評価した
> **ネットワーク層での拒否**を、組織が既に要求しているということでもある。**WIF案（B）の
> 相対評価はLOG-0053時点より上がっており**、本番運用に向けて再検討する価値がある。
- 補償的制御（既存・テスト済み）: 定数時間比較（LOG-0036）、fail-closedな入力検証、
  不正トークンは401→ゲート側で500に写像（内部事情を利用者に出さない）、
  そして**①テナント境界はサーバ側解決**なので、認証を突破した呼び出し元でもデータセットを
  指定できない（原則E）。さらにD1により、executorが破綻しても他テナントのデータには
  IAMが届かせない（LOG-0052）。
- **GR-030（セキュリティ姿勢を下げない）に照らして適合**と判断する。3案のうち、
  **Cloudflare側に置く秘密が最も少なく（ゼロ個のGCP資格情報）、爆発半径が最も小さい**のが
  この案だからである。姿勢を下げるトレードではなく、**最も安全な選択肢**。
- 将来: 顧客要求があればCloud Run ingressを内部限定＋Cloudflare Tunnel等に切り替えられる。
  アプリ層の認証はそのまま残るので、二重化であって作り直しではない。

### T5. データセット権限は標準ACLで付与する

D1のテナント別SAへのREADER付与は `google_bigquery_dataset_access`（データセットの
`access` 配列）を使う。`google_bigquery_dataset_iam_member`（setIamPolicy経路）は
**LOG-0052で実測したallowlist要件**に当たる可能性がある。実証済みの経路を採る。

### T6. stateはGCSバックエンド、bootstrapが作る

Terraform state は**バージョニング有効のGCSバケット**に置く（bootstrapが冪等に作成）。

- 理由: ローカルstateを失うと `destroy` が効かず、**課金されるリソースが孤児化する**。
  「消せること」が要求の半分なので、stateの永続性は機能要件。

### T7. `make deploy` / `make destroy`、destroyはGR-031ガード

canonical契約の下に project-specific ターゲットとして追加する（profiles契約で明示的に許可）。
`destroy` は **profiles rule 3** に従い、`ALLOW_DESTROY=yes` の明示的オプトインを必須とし、
`help` に **DANGEROUS** と表示し、エージェントが実行する場合は**その都度人の承認**を要する。

## Consequences

- `make deploy` 1コマンドで: API有効化 → Artifact Registry → stateバケット → シークレット
  投入 → イメージビルド（Cloud Build）→ `terraform apply`（SA・IAM・Cloud Run×2・
  D1テナントSA・データセットACL）まで到達する。
- `make destroy ALLOW_DESTROY=yes` で課金リソースを一括撤去できる。
- **新規依存**: `terraform` と `gcloud` がオーナーのマシンに必要（COD-040の意味での
  ランタイム依存ではなく、運用ツール）。`docker` は**不要**（Cloud Buildを使うため）。
- **テナントSAはTerraformが所有する**（2026-07-26 明確化）。初版は「管理外のまま」と読める
  書き方だったが、それは**検体2つに限った話**であり、本番テナントには当てはまらない。
  Terraformがテナントごとに持つのは3点セット:

| リソース | 目的 |
|---|---|
| `google_service_account` | そのテナントのD1接続主体 |
| `google_bigquery_dataset_access`（READER） | **自分のデータセットのみ**＝③バックストップの本体（T5） |
| `google_service_account_iam_member`（tokenCreator） | **executorのCloud Run実行SA**がなりすませるように |

  3点目が要点で、現在tokenCreatorは**オーナー個人のアカウント**に付いている（スパイク用）。
  本番ではCloud Run実行SAに移す必要があり、Terraformが持つべき典型である。
  `tenants` 変数の既定 `[]` は「テナントSAは管理外」ではなく「**まだテナントを宣言していない**」
  の意味。LOG-0052の検体（`t-alpha-reader`/`t-bravo-reader`、合成8行のテストデータに紐づく）は
  一覧に載せず管理外に置く — **テスト検体を本番stateに入れない**分離であり、本番では新規SAを作る。
  これはADR-0010 **D7**（粗く滅多に変わらない境界＝商談・オンボーディングという既に人手が入る
  契機に紐づく）とよく噛み合う。テナントが数十を超えたらオンボーディングAPIに移す。
- Neonのマイグレーションは引き続き別コマンド（T1）。デプロイ手順書にその順序を明記する。

## 検討した代替案

| 案 | 却下理由 |
|---|---|
| gcloudスクリプトのみ（Terraformなし） | 作るのは容易だが**消すのが難しい**（何を作ったかの台帳が無い）。要求の半分「一発で消す」を満たせない |
| 秘密値もTerraformで管理（`TF_VAR_`経由） | 平文がstateに残り、秘密の在り処が増える（T3）。1コマンド化はmakeの順序制御で達成できるので、対価に見合わない |
| Cloud RunをIAM認証必須にする（WIF経由） | Workersに鍵無しでIAM認証する手段が現時点で無く、自前OIDC発行者＝**別の鍵**を持つことになる。秘密の数は減らず、得られるのは露出除去と短命化のみ。薄く保つと決めたゲート（ADR-0006）に暗号と鍵管理を持ち込む対価に見合わない（T4・LOG-0053） |
| Cloud RunをIAM認証必須にする（SA鍵をWorkersに置く） | **3案中で最悪**。長期のGoogle資格情報がCloudflare側に生まれ、executorのSAはテナントSAをなりすませるため**漏洩＝全テナント露出**。ADR-0010 D1・GR-001・GR-030に反し、LOG-0052で実証したバックストップの前提を壊す（T4） |
| ローカルstate | 紛失＝孤児リソース＝課金が止められない（T6） |
| マイグレーションも `make deploy` に含める | インフラ構築とデータDDLは失敗ドメインが違う。片方の失敗でもう片方の状態が読めなくなる（T1） |

## 参照

- [ADR-0006](0006-edge-gate-runtime-cloudflare-workers.md) — ゲートはWorkers（T1の管理境界）
- [ADR-0010](0010-connection-identity-is-never-a-person.md) — D1・鍵を保存しない（T4の根拠）
- [docs/deploy.md](../deploy.md) — 手順書（本ADRの実装で自動化される）
- [profiles/README.md](../../profiles/README.md) — canonical契約とprofiles rule 3（T7）
- [.ai/decision-log.md](../../.ai/decision-log.md) — LOG-0052（allowlist実測、T5の根拠）
