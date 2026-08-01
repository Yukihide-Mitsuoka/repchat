# RepChat

<!-- repository-readme-owner: Yukihide-Mitsuoka/repchat -->

RepChatは、日本の小規模な代理店・ソフトウェアベンダー向けのマルチテナント分析SaaSです。
顧客ごとの分析データを分離し、自然言語によるレポート作成と継続配信を支援します。

> **AI agents:** 作業前に [AGENTS.md](AGENTS.md) と [CLAUDE.md](CLAUDE.md) を読み、
> 現在の作業は[開発引き継ぎ](docs/development-handoff.md)から確認してください。

## 現在地

認可ゲート、SQLへのテナント境界注入、PostgreSQL RLS、BigQuery実行、
テナント別キャッシュ、自然言語からのレポート生成は検証済みです。現在は
[デザインパートナー検証](docs/status.md#0-再開手順新しいaiセッション向け)が次の作業で、
GitHub Appとartifact pipelineの製品実装はその結果を待ちます。

## ドキュメント

| 目的 | 正本 |
|---|---|
| 開発を再開する | [開発引き継ぎ](docs/development-handoff.md) |
| 現在の実装状況と検証結果を確認する | [実装状況サマリー](docs/status.md) |
| 要件と事業モデルを確認する | [要件定義](docs/requirements.md) |
| アーキテクチャとデータ境界を確認する | [システム設計](docs/system-design.md) |
| 優先順位を確認する | [ロードマップ](docs/roadmap.md) |
| 5分デモを実行・説明する | [デモ手順](docs/demo.md) |
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
make demo-live PROJECT=<gcp-project>
```

`demo-live`は起動時に費用確認を行い、同意後にデモ用venvのpin済みPython依存を
確認・導入します。実Vertex AIとBigQueryは、日本語の問い合わせを送信したときに使用します。

基盤規約は[ai-dev-foundation](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation)
からレビューPRで同期します。RepChat固有のREADME、規約、ワークフロー、アプリケーション、
実験、要件、ADRは同期から保護されています。

## License

[LICENSE](LICENSE)を参照してください。
