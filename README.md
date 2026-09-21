# RepChat

<!-- repository-readme-owner: Yukihide-Mitsuoka/repchat -->

RepChatは、日本の小規模な代理店・ソフトウェアベンダー向けのマルチテナント分析SaaSです。
顧客ごとの分析データを分離し、自然言語によるレポート作成と継続配信を支援します。

> **AI agents:** 作業前に [AGENTS.md](AGENTS.md) と [CLAUDE.md](CLAUDE.md) を読み、
> 現在の作業は[開発引き継ぎ](docs/development-handoff.md)から確認してください。

## 現在地

認可ゲート、SQLへのテナント境界注入、PostgreSQL RLS、BigQuery実行、
テナント別キャッシュは実環境で検証済みです。対象別profileを使った旧レポート生成経路は削除し、
現在は認可済みscopeから同じ共通pipelineで分析契約を生成する対象非依存runtimeを検証しています。
実scope discoveryと契約生成を呼ぶ評価preflightは完成し、参照SQL・期待結果をruntimeへ渡さない
execution manifestも完成しました。現在はmanifestだけから全計画attemptを共通preflightへ渡す境界を
実装済みです。[PR #763](https://github.com/Yukihide-Mitsuoka/repchat/pull/763)では、十分な共通分析契約から
不要な利用者確認なしで初回仕様を生成できるplanner契約を整備し、merge済みです。
[PR #765](https://github.com/Yukihide-Mitsuoka/repchat/pull/765)では、成功したpreflightだけを同じ共通plannerへ接続し、
計画失敗も評価attemptへ残す境界を実装し、merge済みです。
[PR #767](https://github.com/Yukihide-Mitsuoka/repchat/pull/767)では、1件の参照SQL・期待結果を持つ各評価caseに対して
共通plannerへ1パネルを要求し、確認質問または複数パネルを自動解釈せずplanning失敗へ閉じる境界を整備し、merge済みです。
[PR #768](https://github.com/Yukihide-Mitsuoka/repchat/pull/768)では、成功した単一パネルを既存の共通section変換と
SQL generatorへ渡し、生成拒否や不正出力を安全な失敗として残す評価stageを実装し、merge済みです。現在は
[PR #769](https://github.com/Yukihide-Mitsuoka/repchat/pull/769)で、生成SQLを既存の共通local validatorへ渡し、
無断参照、危険SQL、期間・出力契約不一致を分類して実行前に停止するstageを実装し、merge済みです。
続く[PR #770](https://github.com/Yukihide-Mitsuoka/repchat/pull/770)では、検証済みSQLだけを共通BigQuery dry runへ渡し、BigQueryが解析した文種・参照table・
出力schema・推定処理bytesを契約と照合するstageを実装し、merge済みです。
[PR #772](https://github.com/Yukihide-Mitsuoka/repchat/pull/772)では、dry run成功attemptだけを
共通BigQuery実行へ渡し、行・列と実処理bytesを保持する境界を実装し、merge済みです。
[PR #774](https://github.com/Yukihide-Mitsuoka/repchat/pull/774)では、製品側と評価側が同じ
共通結果検証を使い、列、行数、可視化shapeを照合して
成功結果をJSON-safe化します。通常のdashboardは従来の設定件数を維持します。
[PR #776](https://github.com/Yukihide-Mitsuoka/repchat/pull/776)では共通rendererをES module化し、
続く[PR #778](https://github.com/Yukihide-Mitsuoka/repchat/pull/778)では検証済みJSON結果だけを受け取る
無出力probeから実ECharts SVG SSRまたは共通DOM rendererを実行できるようにしました。
[PR #780](https://github.com/Yukihide-Mitsuoka/repchat/pull/780)では
結果検証に成功したattemptだけをprobeへ渡し、描画成否、検証済み行、実処理bytes、計測費用を最終run記録へ
接続します。公式fixtureの独立review、実値照合、
同一runtimeでの反復評価は未完了であり、任意schema対応を
製品能力とはまだ扱いません。詳細は[実装状況サマリー](docs/status.md)を参照してください。

## ドキュメント

| 目的 | 正本 |
|---|---|
| 開発を再開する | [開発引き継ぎ](docs/development-handoff.md) |
| 現在の実装状況と検証結果を確認する | [実装状況サマリー](docs/status.md) |
| 要件と事業モデルを確認する | [要件定義](docs/requirements.md) |
| アーキテクチャとデータ境界を確認する | [システム設計](docs/system-design.md) |
| 優先順位を確認する | [ロードマップ](docs/roadmap.md) |
| 5分デモを実行・説明する | [デモ手順](docs/demo.md) |
| ライブデモの停止理由を確認する | [トラブルシューティング](docs/troubleshooting/live-demo.md) |
| 判断の根拠を確認する | [プロジェクトADR](docs/adr/)・[意思決定ログ](.ai/decision-log.md) |

## システム境界

- Cloudflare WorkersのエッジゲートがJWTと認可コンテキストを検証します。
- 実行エンジンがSQL ASTへ`tenant_id`境界を注入し、BigQueryで分析します。
- PostgreSQL RLSが管理データのテナント境界を強制します。
- Evidenceのシェルとテナント別データを分離し、同じシェルを複数顧客へ配信します。
- 指標定義はRepChat、生成ページ・SQL・manifestは顧客Gitが所有します。

詳細と検証範囲は[実装状況サマリー](docs/status.md)を参照してください。

## 開発

ビルド、テスト、静的解析はリポジトリの正規インターフェースから実行します。

```bash
make setup
make format
make lint
make test
make doctor
```

対象別profileと固定例を使う旧ライブデモ入口は削除済みです。認可済みscopeから分析契約を自動生成する
対象非依存runtimeが完成するまで、代替のデモコマンドは提供しません。現在の作業順は
[開発引き継ぎ](docs/development-handoff.md)を参照してください。

基盤規約は[ai-dev-foundation](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation)
からレビューPRで同期します。RepChat固有のREADME、規約、ワークフロー、アプリケーション、
実験、要件、ADRは同期から保護されています。
