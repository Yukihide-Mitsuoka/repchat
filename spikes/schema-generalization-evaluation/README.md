---
id: schema-generalization-evaluation
title: 未知schema反復評価の証拠harness
status: active
updated: 2026-09-19
---

# 未知schema反復評価の証拠harness

`evaluate.py`は、対象非依存runtimeの実行後に得たJSON evidence bundleを検証し、schema別の品質指標と
合否を決定論的に返すpost-run scorerです。外部APIや製品runtimeは呼びません。

## 評価契約

- 2種類以上のschemaを同じ評価に含め、各caseをbundle指定回数以上反復する。
- 全runでruntime、prompt、設定のSHA-256 fingerprintを一致させる。
- 同じscope snapshotと質問から同じanalysis contract fingerprintを再現する。
- runtime inputはscope snapshot fingerprint、analysis contract fingerprint、質問だけに限定する。
- 参照SQLと期待結果はpost-run scorerだけが読み、生成runtimeへ渡さない。
- 参照結果は作成者と異なるreviewerが承認する。
- schema別の結果一致率と安全違反をschemaごとに集計する。

bundleには`version`、`thresholds`、2件以上の`schemas`を記録します。schemaごとのcaseは質問、参照SQL、
期待行、行順序、review記録、反復runを持ちます。runには同一pipelineのfingerprint、実際の
runtime input、生成SQL、実行結果、描画成否、安全違反、処理bytes、費用を記録します。

## 実行

```console
python3 spikes/schema-generalization-evaluation/evaluate.py /path/to/evidence.json
```

exit code `0`は合格、`1`は検証可能な未合格、`2`はbundle契約違反です。未合格reportも標準出力へ残します。

## 現在の制限

公式の未知schema fixtureと実サービス結果はまだありません。テスト値はscorerの回帰確認用であり、製品能力の
証拠ではありません。固定の3回・90%下限と入力型の厳密化、独立review済みfixture、実値照合は未完了です。
有料評価は対象と費用についてオーナー承認を得た後だけ実行します。
