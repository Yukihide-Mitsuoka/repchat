---
id: adr-0023
title: 同一workspaceで業務を接続し、外部実行を施策パッケージ境界へ隔離する
status: proposed
updated: 2026-08-11
---

# ADR-0023: 同一workspaceで業務を接続し、外部実行を施策パッケージ境界へ隔離する

| Field | Value |
|-------|-------|
| Status | proposed |
| Date | 2026-08-11 |
| Deciders | repository owner |
| Author | Codex |
| Supersedes / Superseded by | — |

## Context

RepChatは、計測設計、分析、dashboard、会議報告、意思決定、施策提案を接続すると、目的、根拠、KPI、
次回評価の文脈を維持できる。一方、GTM変更、広告入稿、予算変更、決済は、利用者、credential、外部API、
監査、事故責任が異なる。同じ画面で利用できることを理由に、同じ権限または実行経路へ統合すると、
分析権限を持つ利用者が本番変更または支出を起こせる設計になり得る。

広告発注、予算管理、決済をRepChatの基本機能にしないまま、顧客または第三者のsystemが承認済み施策を
受け取り、実行結果を返せる余地を残す必要がある。Issue #160が未判定のため、現時点では将来契約だけを決め、
API、CSV、connectorを実装しない。

## Options considered

### Option 1: 外部連携の余地を設けない

実装範囲は最小になるが、承認済み施策を手作業で転記し、元の根拠と実行結果の対応が失われる。将来のAPI追加で
action domainを作り直す可能性があるため採用しない。

### Option 2: 計測、分析、施策実行を別製品にする

credentialと障害範囲を分離しやすい。一方、少数顧客向けの現段階では、認証、tenant、UI、契約、監査を
複製し、計測定義から効果検証までの文脈も利用者が手動で接続する必要があるため採用しない。

### Option 3: 一つのUIと一つの実行境界へ統合する

操作は単純だが、分析、GTM編集、広告費、決済の権限とcredentialが同じapplication serviceへ集まり、
最小権限、fail closed、監査分離を満たしにくいため採用しない。

### Option 4: 同一workspace UIを保ち、内部境界と外部実行を分離する

共通app shellと文脈付きnavigationを使いながら、measurement、analysis、decision、action exportを別の
permission、API、credential、audit streamで扱う。承認済み施策はprovider非依存の`Action Package`として
固定し、広告・予算・CSV等はadapterが変換する。文脈とsecurityを両立できるため、この案を採用する。

## Decision

Option 4を提案する。repository ownerが本ADRを承認し、Issue #160が`proceed`になるまで実装しない。

### D1. 同一workspaceは同一pageを意味しない

計測、分析、dashboard、会議報告、施策を共通app shell、workspace breadcrumb、revision linkで接続する。
各責務は専用routeまたはsurfaceに置き、全工程を一つの縦長pageへ並べない。権限が無いsurfaceは隠すか、
理由付きdisabledにする。

### D2. 権限、外部API、credential、監査をbounded contextごとに分離する

measurement、analysis、decision、action exportは別permissionを持つ。GTM、広告媒体、会計system等のcredentialを
analysis contextへ渡さない。外部adapterの停止または撤去で、dashboard閲覧と意思決定履歴が停止してはならない。

### D3. `Action Package`を外部連携の唯一の正本にする

人間が承認した`Action Proposal`から、不変revisionの`Action Package`を作る。目的、根拠、KPI、期間、予算案、
承認、有効期限、tenant・scope、schema versionを固定する。JSON契約を正本とし、CSV、webhook、媒体別formatは
同じrevisionから生成するadapterとする。provider固有fieldをcore domainへ持ち込まない。

### D4. RepChat Coreは外部実行を命令しない

Core APIはpackageの取得、export、外部status・実績の受領を提供できるが、広告公開、予算変更、振込、決済を
実行するendpointを持たない。銀行口座、card、決済credential、振込指示をAction Packageへ含めない。
将来write adapterを検討する場合は、別ADR、別credential、明示承認、事故対応、価格を先に決める。

### D5. 外部結果を元の判断へ戻す

外部systemから受け取るstatus・実績は、package revision、外部参照ID、idempotency key、source、取得時刻を持つ。
外部値を検証済み分析結果と同一視せず、新しいresult revisionとして取込み、元の成功指標と次回効果検証へ接続する。

## Consequences

**Positive:**

- 利用者は一つのworkspaceで計測から効果検証まで移動できる。
- 外部systemは広告専用でない安定した契約を利用できる。
- 広告・CSV adapterを削除しても、分析、dashboard、決定記録を維持できる。
- 決済情報を保持せず、初期のsecurity・support範囲を限定できる。

**Negative:**

- 同じ製品内に複数permission、状態、audit streamが必要になる。
- JSONとCSV profileのversion互換性、期限切れ、revoke、再exportを管理する必要がある。
- APIを提供しても外部system側の実装が必要であり、end-to-endの自動実行を保証しない。
- API previewまたはexport成功は、広告配信、決済、施策成果の成功を意味しない。

**Follow-ups:**

- [施策パッケージAPI要件](../requirements/action-package-api.md)を正本としてreviewする。
- Issue #160が`proceed`となり、Issue #181のaction revisionが安定した後だけ実装Issueを作る。
- 最初の実需要が確認できるまでOpenAPI、CSV profile、provider adapterを実装しない。

## Rollback

action export routeとadapterを無効化し、RepChatを計測、分析、dashboard、会議報告、内部action管理までに戻す。
既存のAction Proposalと意思決定履歴は残し、外部packageを新規発行しない。

## References

- [Issue #345](https://github.com/Yukihide-Mitsuoka/repchat/issues/345)
- [ADR-0015](0015-publish-artifacts-through-customer-git.md)
- [ADR-0017](0017-use-slack-as-an-authorized-analysis-interface.md)
- [ADR-0022](0022-compose-derived-dashboards-from-versioned-panels.md)
- [会議意思決定ループ要件](../requirements/meeting-decision-loop.md)
- [GA4・GTM計測実装アシスタント要件](../requirements/measurement-implementation-assistant.md)
