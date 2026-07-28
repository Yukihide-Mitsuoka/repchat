---
id: adr-0015
title: ADR-0015 — 顧客Gitをbuild時の生成物配送境界にする
status: accepted
updated: 2026-07-29
---

# ADR-0015: 顧客Gitをbuild時の生成物配送境界にする

| Field | Value |
|-------|-------|
| Status | accepted |
| Date | 2026-07-29 |
| Deciders | repository owner |
| Author | Codex (AI agent) |
| Supersedes / Superseded by | ADR-0014 G2/G5/G6の配送方式を具体化し、不正確な自己完結性の記述を置き換える |

## Context

[ADR-0014](0014-who-owns-the-generated-artifacts.md)は、ページとソース定義を顧客所有の
リポジトリへ置くと決めた。しかし、次の実装上の境界が未決だった。

- 顧客Gitをページ閲覧時にも参照すると、GitHubの応答時間と可用性が表示経路へ入る
- 顧客Git経路とRepChat管理ストレージ経路を別々にbuildすると、保守が2倍になる
- ページとSQLだけではEvidenceアプリとして単独実行できず、rendererと依存関係が別途必要
- GitHubへ書き込む認証方式、対象repository、権限、commitの有効化条件が未定義
- 顧客所有のrepositoryは顧客が変更できるため、build入力としては信頼できない

既存の閲覧要件はp95 1.5秒未満であり、シェルとデータは認可ゲートとキャッシュから配信する。顧客Gitの所有権を維持しながら、この閲覧経路へGit providerを入れてはならない。

## Options considered

### Option 1: 閲覧時に顧客Gitから取得してbuildまたはrenderする

顧客repositoryが常に正本になる。一方、GitHub障害、token失効、clone時間、依存install、Evidence buildが閲覧の遅延または障害になる。閲覧要件とfail-closedな既存配信に反するため採用しない。

### Option 2: 顧客Git経路とmanaged fallbackを別々に実装する

各保存先に最適化できるが、生成物schema、検証、build、失敗処理、version有効化が2系統になる。
顧客数3〜5社の初期段階で同じ意味を2実装へ保つ運用コストは受け入れない。

### Option 3: 1つのartifact pipelineをbuild時だけ2つの保存先へ接続する

生成物、検証、build、有効化は共通にし、顧客Gitとmanaged fallbackは保存先adapterだけを変える。
GitHub Appで選択されたrepositoryへ短期tokenで書き、閲覧は成功済みのimmutable成果物だけを読む。
所有権、表示性能、保守性、最小権限を同時に満たすため、この案を採用する。

## Decision

### D1. Git providerは生成・build経路に限定する

閲覧リクエストからGitHub API、clone、dependency install、Evidence buildを呼んではならない。閲覧経路は従来どおり、認可ゲートから次だけを読む。

- `report_id + report_version`で識別したimmutableなシェル
- 認証済みcontextから導出したkeyの結果キャッシュ
- キャッシュmiss時のexecutor

GitHubが停止またはrepositoryが到達不能でも、直前に有効化した版の閲覧は継続する。
新規生成だけを停止し、自動でmanaged fallbackへ切り替えてはならない。

### D2. 顧客repositoryにはArtifactBundleだけを置く

ArtifactBundleは、次の顧客固有生成物で構成する。

```text
pages/**/*.md
sources/**/*.sql
repchat-artifact.json
```

manifestは少なくともartifact schema version、renderer version、report ID、各ファイルのSHA-256を持つ。
ページとSQLは固定rendererと組み合わせれば再構築できるが、repository単独でEvidenceアプリとして
実行できるとは表現しない。

次を顧客repositoryへ書いてはならない。

- RepChat本体、Evidence scaffold、`package.json`、lockfile、CI workflow
- `node_modules`、build済みHTML/JS、Arrow、Parquet、materialize済み結果
- service account key、token、接続credential、その他の秘密
- 顧客固有でない共有指標定義

SQLに含まれる顧客スキーマ名は顧客成果物の一部である。認証主体、credential参照、
実行projectなどの接続設定はcontrol planeから一時build workspaceまたはexecutorへ注入する。

### D3. 生成から有効化までを1つのpipelineにする

保存先に関係なく、次の順序を変えてはならない。

1. ページ、SQL、manifestを1つのArtifactBundleとして生成
2. path、size、manifest hash、markdown component、SQL ASTと参照tableを検証
3. 選択された保存先へbundleを1 revisionとしてpublish
4. publishされたrevisionを固定rendererと組み合わせ、隔離環境でbuild
5. build済みシェルとquery catalogをimmutable revisionとして配置
6. build成功後にだけ、control planeの`artifact_revision`と`report_version`を同時に更新

失敗したrevisionは顧客Gitに履歴として残り得るが、配信へ有効化しない。旧版をpurgeせず、
直前の成功版をlast-known-goodとして配信する。

### D4. 保存先だけをadapterとして分ける

application層はArtifactBundleを1 revisionとしてpublishする契約だけを持つ。初期の実装は次の2 adapterを同じ受入試験へ通す。

| Adapter | 用途 | build・有効化 |
|---------|------|----------------|
| GitHub publisher | 顧客所有repositoryが既定 | 共通pipeline |
| Managed publisher | repositoryを持たない顧客の明示的fallback | 共通pipeline |

fallbackは別rendererまたは別生成器ではない。顧客の設定を無断で切り替えず、オンボーディング時に
保存先を選ぶ。

### D5. GitHub接続はGitHub Appを使う

長期PAT、顧客個人のOAuth token、共有SSH deploy keyを保存してはならない。顧客管理者は
RepChat GitHub Appをinstallし、`Only select repositories`で対象を選ぶ。RepChatは
installation ID、repository ID、owner/name、管理branch、最後に成功したcommit SHAだけを保存する。
対象repositoryはprivateを必須とし、生成物専用repositoryを推奨する。GitHub App private keyと
webhook secretはplatform secret managerで管理・rotateし、repository、DB、ログへ保存しない。

初期権限は次に限定する。

| Permission | 既定 | 理由 |
|------------|------|------|
| Metadata | read | repository同一性と状態の確認 |
| Contents | read/write | bundleのcommitと固定SHAの取得 |
| Pull requests | none | 初期実装ではPR modeを提供しない |
| Actions / Workflows / Administration / Secrets | none | 生成物配送には不要 |

各jobはinstallation access tokenを都度発行し、対象repository IDと必要権限へ狭める。tokenを
永続化またはログ出力してはならない。GitHub AppのContents権限はpath単位に制限できないため、
初期は顧客所有の専用repositoryを推奨する。

### D6. commitと外部変更を安全に扱う

既定はAppだけが書く`repchat-generated` branchへの直接commitとする。expected head SHAと
一致しない場合はforce pushせず停止し、競合として通知する。PR modeは実需が出た時点で、
別AppまたはApp権限変更時の再承認を含む権限設計を再レビューしてから追加する。

RepChat自身のpublishはcommit SHAを直接build queueへ渡すため、webhookへ依存しない。顧客による
外部変更、repository追加・削除、App削除を検知する場合だけwebhookを使い、署名を検証し、
delivery IDとrepository ID + commit SHAで再送を冪等化する。

顧客repositoryの内容は信頼しない。buildは許可pathだけを読み、symlink、実行可能ファイル、
package定義、workflow、未許可component、未検証SQLを拒否する。build環境へ顧客repositoryの
任意コードを実行させてはならない。

### D7. 接続UIは管理者向けとし、初期は手動オンボーディングを許容する

製品としてrepositoryを選択・再接続・切断できる接続境界は必要である。ただし初期3〜5社では、
完全なセルフサービス設定画面を必須にしない。RepChatまたは代理店の管理者が次を案内する。
接続・repository選択・再接続・切断はtenant adminまたは明示的な運用担当者だけに許可し、
tenant境界を越えるinstallation IDの再利用を拒否する。

1. GitHub Appをinstall
2. 対象repositoryだけを選択
3. RepChatでrepositoryと管理branchを選択
4. repository ID、権限、branch、到達性を検査
5. 最初のArtifactBundleをpublishしてbuild結果を確認

通常の閲覧者へGit操作またはGitHubアカウントを要求しない。

### D8. 性能を表示と更新に分けて測る

既存の閲覧p95目標は維持する。Git連携の追加で測るのは別の更新指標である。

- 生成承認からGit commit完了まで
- commit SHAのbuild開始待ち
- build時間
- build成功から新しい`report_version`有効化まで

Git連携が表示速度へ影響しないことは、閲覧時の外部call traceにGitHubが無いことと、
既存の閲覧p95計測で確認する。実測前に更新SLOを断定しない。

## Consequences

顧客は生成ページとSQLの履歴を自分のrepositoryで所有し、解約後も標準的なテキスト成果物を
保持できる。rendererと製品コードを顧客数分forkしないため、security updateとEvidence更新は
RepChat側の1か所で行える。GitHub障害は新規生成を止めるが、閲覧を止めない。

代償は、GitHub Appの登録・webhook検証・token発行・repository接続状態・build queue・
last-known-good管理が増えることである。Contents権限はrepository全体に及ぶため、専用repositoryを
推奨しても権限範囲はゼロにはならない。GitHub以外のprovider対応は、実顧客の要求が出るまで追加しない。

rollbackは、顧客repository内の履歴を変更せず、control planeの有効revisionを直前の成功SHAへ戻す。
保存先をmanaged fallbackへ変える場合は顧客の明示的な設定変更として扱う。

## References

- [ADR-0014](0014-who-owns-the-generated-artifacts.md)
- [ADR-0005](0005-cache-and-authorization-architecture.md) 原則A・キャッシュ設計
- [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [Installing a GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)
- [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [Looker: Setting up and testing a Git connection](https://docs.cloud.google.com/looker/docs/setting-up-git-connection)
