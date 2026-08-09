---
id: project-adr-index
title: プロジェクトのアーキテクチャ意思決定記録
---

# プロジェクトのArchitecture Decision Records（ADR）

このディレクトリには、RepChatプロジェクト固有の長期的な設計判断を記録します。
基盤から継承する判断は
[基盤ADR](../foundation/adr/README.md) にあり、ここには複製しません。
アーキテクチャ変更では GR-022 と `.skills/architecture.skill.md` に従います。

## 配置と運用

- 新規ADRは連番の `NNNN-kebab-case-title.md` とし、
  [基盤のADRテンプレート](../foundation/templates/adr.md) を使用します。
- 状態は `proposed → accepted | rejected` とし、必要に応じて `deprecated` または
  `superseded by ADR-NNNN` に遷移します。
- 承認済みADRの判断内容は編集せず、新しいADRで上書きします。
- 実装開始前に人がADRのPRを承認します（GR-022）。
- 各ADRを [.ai/decision-log.md](../../.ai/decision-log.md) に記録します。
- 利用先が所有する文書として日本語で記述します。

## 一覧

| # | Title | Status | Date |
|---|-------|--------|------|
| [0005](0005-cache-and-authorization-architecture.md) | Dynamic rendering with layered cache and hybrid claim+revocation authorization | proposed | 2026-07-16 |
| [0006](0006-edge-gate-runtime-cloudflare-workers.md) | Edge authorization gate runtime uses Cloudflare Workers | proposed | 2026-07-18 |
| [0007](0007-use-one-time-protected-legacy-template-sync.md) | 保護された旧Template Syncを一度だけ使用する | accepted | 2026-07-18 |
| [0008](0008-enable-recurring-protected-template-sync.md) | 保護されたTemplate Syncを定期実行する | accepted | 2026-07-18 |
| [0009](0009-adopt-portable-saas-design-constraints.md) | Next.js SaaS基盤から移植可能な設計制約だけを採用する | accepted | 2026-07-22 |
| [0010](0010-connection-identity-is-never-a-person.md) | 接続主体は決して人間にしない — 多接続SaaSのアクセス制御モデル | accepted | 2026-07-24 |
| [0011](0011-datasource-scope-and-tiers.md) | 接続データソースを階層化し、2つ目はアーキテクチャ検証で選ぶ | accepted | 2026-07-24 |
| [0012](0012-terraform-cloud-run-deployment.md) | NodeサービスをTerraform＋Cloud Runで一括デプロイし、秘密はstateに入れない | proposed | 2026-07-25 |
| [0013](0013-metric-definitions-live-in-our-own-layer.md) | 指標定義は自前の層に持ち、平坦化を顧客環境に持ち込まない | accepted | 2026-07-28 |
| [0014](0014-who-owns-the-generated-artifacts.md) | 生成物と定義の所有を3種類に分ける | accepted | 2026-07-28 |
| [0015](0015-publish-artifacts-through-customer-git.md) | 顧客Gitをbuild時の生成物配送境界にする | accepted | 2026-07-29 |
| [0016](0016-authenticate-oversized-foundation-sync-prs.md) | 大規模な基盤同期PRを厳密に認証する | accepted | 2026-07-29 |
| [0017](0017-use-slack-as-an-authorized-analysis-interface.md) | Slackを認可付き分析インターフェースとして使う | proposed | 2026-07-30 |
| [0018](0018-govern-adaptive-analysis-memory.md) | 適応型分析メモリーを版管理された方針として統制する | accepted | 2026-08-02 |
| [0019](0019-separate-datasource-knowledge-from-scoped-analysis-context.md) | データソース知識と分析文脈を分離し、用途別にコンパイルする | proposed | 2026-08-09 |
| [0020](0020-protect-production-edge-and-cloud-run-origins.md) | 本番の公開入口とCloud Run originを二層で保護する | proposed | 2026-08-09 |

<!-- 新しいプロジェクトADRを末尾に追加する。 -->
