---
id: schema-generalization-evaluation
title: 未知schema反復評価の証拠harness
status: active
updated: 2026-09-20
---

# 未知schema反復評価の証拠harness

`evaluate.py`は、対象非依存runtimeの実行後に得たJSON evidence bundleを検証し、schema別の品質指標と
合否を決定論的に返すpost-run scorerです。外部APIや製品runtimeは呼びません。

## 評価契約

- IDとscope snapshot fingerprintが異なる2件以上のschema evidenceを同じ評価に含め、各caseを3回以上反復する。
- 全runでruntime、prompt、設定のSHA-256 fingerprintを一致させる。
- runtime inputはscope snapshot fingerprint、analysis contract fingerprint、質問だけに限定する。
- 同じcaseの反復runは、同一のanalysis contract fingerprintを再現する。
- 参照SQLと期待結果はpost-run scorerだけが読み、生成runtimeへ渡さない。
- 参照結果は作成者と異なるreviewerが承認する。
- schemaごとに90%以上の結果一致を要求し、意味上の誤り、未認可参照、危険なSQL、scan上限超過を1件でも検出したら不合格にする。
- evidence version、参照記録、runのfieldと型を厳密に検証し、曖昧な行順序や未知fieldを推測で受理しない。

bundleには`version`、`thresholds`、2件以上の`schemas`を記録します。schemaごとのcaseは質問、参照SQL、
期待行、行順序、review記録、反復runを持ちます。runには同一pipelineのfingerprint、実際の
runtime input、生成SQL、実行結果、描画成否、安全違反、処理bytes、費用を記録します。

## 参照fixtureとrun記録の分離

`assemble.py`は、version 2の独立review済み参照fixture、version 1の実行前評価計画、version 3のruntime実行後の
run記録、version 1のscope snapshot artifact、version 1のanalysis contract artifact、実行に使用した
runtime・prompt・configurationの3つの不透明なartifact fileを検証し、schema ID・case IDだけで結合します。
fixture caseにはID、質問、参照記録、評価capabilityだけを許可し、runを含めません。各schemaは`nested_unnest`、
`multi_level_nesting`、`join`、`period_comparison`、`window_function`、`ordered_behavior`をcase全体で網羅する必要があります。
capabilityは評価範囲のreview用であり、runtime inputと結合後のevidenceには渡しません。run記録にはschema ID、case ID、
既存の厳密なrun契約だけを許可し、参照SQLや期待結果の混入、未知のschema／case、記録のないfixture caseを拒否します。

実行前評価計画は、fixture fileのSHA-256、3つのpipeline artifact fingerprint、実行予定のschema ID・case ID・run IDを
固定します。run記録は評価計画fileの正確なbytesのSHA-256を持ちます。assemblerはfixture、pipeline artifact、計画、記録を
相互照合し、全fixture caseに計画runがあること、計画と記録のrun IDが重複なく完全一致することを要求します。これにより、
結果確認後の参照内容変更、pipeline差し替え、成功runだけの選別、未記録runを検出します。計画とfingerprintはruntime inputへ
渡しません。fileだけでは作成時刻や作成者を証明しないため、独立review記録と実行前の保全手続きは引き続き別途必要です。

scope snapshot artifactは、fixtureに含まれる全schemaと一対一で対応する`schema_id`、対象非依存runtimeが生成した
`DiscoverySnapshot.content_json`、timezone付き`retrieved_at`だけを持ちます。assemblerは`content_json`がruntimeと同じ
canonical JSON表現であること、そのSHA-256がfixtureと全runの`scope_snapshot_fingerprint`に一致することを検証します。
未知・重複・欠落schemaは拒否します。snapshot内容と取得時刻は結合後のevidenceへ複製せず、fingerprintだけを残します。
このartifactはschema metadataとbounded value profileを含む可能性があるため、fixtureやrunと同じ認可済みローカル領域で
管理し、CI logまたはrepositoryへ保存してはいけません。

analysis contract artifactは、fixtureの全schema／caseと一対一で対応する`schema_id`、`case_id`、対象非依存runtimeが
生成したcanonical `AnalysisContract.content_json`だけを持ちます。assemblerはruntimeと同じ規則でfingerprintを再計算し、
全runの`analysis_contract_fingerprint`へ照合します。contract内のschema fingerprintと取得時刻は同じschemaのscope
snapshot observationと一致しなければなりません。未知・重複・欠落case、非canonical JSON、内容改変は拒否します。
contract本文は結合後のevidenceへ複製せず、fingerprintだけを残します。このartifactも認可済みローカル領域だけで管理します。

runtime・prompt・configuration artifactは、最初のrun前に固定した非空の通常fileを渡します。runtimeが複数fileから
成る場合は、file path・mode・内容を決定論的に固定したbundleを1つのartifactにします。assemblerは各fileの正確なbytesから
SHA-256を再計算し、全runの対応するfingerprintへ照合します。artifact本文とpathは結合後のevidenceへ複製しません。
この照合は実行後のartifact差し替えや自己申告fingerprintの不一致を検出しますが、artifactの作成主体、署名、実際にその
artifactを起動したことまでは単独で証明しません。

結合後のevidenceには期待行と実行行が含まれるため、標準出力へは出しません。指定した新規fileを所有者だけが
読書きできる`0600`で作り、既存fileや入力fileの上書きも拒否します。artifactは認可されたローカル領域で管理し、
CI logやrepositoryへ保存しません。

## 実行

```console
python3 spikes/schema-generalization-evaluation/assemble.py \
  /path/to/reviewed-fixture.json /path/to/evaluation-plan.json \
  /path/to/recorded-runs.json \
  /path/to/scope-snapshots.json /path/to/analysis-contracts.json \
  /path/to/runtime.artifact /path/to/prompt.artifact \
  /path/to/configuration.artifact \
  /secure/path/evidence.json
python3 spikes/schema-generalization-evaluation/evaluate.py /path/to/evidence.json
```

run記録は次のtop-level契約を使います。`evaluation_plan_sha256`は実行前評価計画file bytesの小文字SHA-256です。

```json
{"version":3,"evaluation_plan_sha256":"0000000000000000000000000000000000000000000000000000000000000000","runs":[]}
```

assemblerのexit code `0`は結合成功、`2`は入力契約違反です。scorerのexit code `0`は合格、`1`は検証可能な
未合格、`2`はbundle契約違反です。scorerは生の期待行・実行行を含めず、集計reportだけを標準出力へ残します。

## 現在の制限

公式の未知schema fixtureと実サービス結果はまだありません。テスト値はscorerの回帰確認用であり、製品能力の
証拠ではありません。評価計画とartifact照合は作成時刻、実行主体の本人性、署名、process-level attestationを証明しません。
独立review済みfixture、実値照合、同一runtimeでの実反復評価は未完了です。有料評価は対象と費用について
オーナー承認を得た後だけ実行します。
