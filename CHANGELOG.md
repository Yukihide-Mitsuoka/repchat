# Changelog

## [4.0.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v3.0.0...v4.0.0) (2026-09-23)


### ⚠ BREAKING CHANGES

* **evaluation:** 基盤障害を品質分母から分離する ([#821](https://github.com/Yukihide-Mitsuoka/repchat/issues/821))

### Features

* **evaluation:** preflightの型付き基盤障害をrunへ記録する ([#825](https://github.com/Yukihide-Mitsuoka/repchat/issues/825)) ([9133d2f](https://github.com/Yukihide-Mitsuoka/repchat/commit/9133d2f1bcbb94e03d6e005c2617141811d9df83))
* **evaluation:** renderer基盤障害をrunへ記録する ([#823](https://github.com/Yukihide-Mitsuoka/repchat/issues/823)) ([5c7e03f](https://github.com/Yukihide-Mitsuoka/repchat/commit/5c7e03fbb2b826f8c9fe2d27d747b380bee79f9e))
* **evaluation:** 基盤障害を品質分母から分離する ([#821](https://github.com/Yukihide-Mitsuoka/repchat/issues/821)) ([6e61fef](https://github.com/Yukihide-Mitsuoka/repchat/commit/6e61fefcfb14822304f3b3c0dc1cb4fc26d11141))
* **evaluation:** 実行manifest作成前に参照記録を検証する ([#828](https://github.com/Yukihide-Mitsuoka/repchat/issues/828)) ([1187794](https://github.com/Yukihide-Mitsuoka/repchat/commit/118779427b9f94d2655d714cc326ad56c4729e86))


### Bug Fixes

* **evaluation:** preflightの基盤例外を分離する ([#818](https://github.com/Yukihide-Mitsuoka/repchat/issues/818)) ([ff29083](https://github.com/Yukihide-Mitsuoka/repchat/commit/ff290838c6fec98d5cc15e8255f2177cf01b2b47))

## [3.0.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v2.1.0...v3.0.0) (2026-09-22)


### ⚠ BREAKING CHANGES

* **evaluation:** case単位の合格gateを追加する ([#808](https://github.com/Yukihide-Mitsuoka/repchat/issues/808))
* **evaluation:** 型付き診断をevidenceへ保存する ([#806](https://github.com/Yukihide-Mitsuoka/repchat/issues/806))

### Features

* **evaluation:** BigQuery実行を評価経路へ接続する ([#772](https://github.com/Yukihide-Mitsuoka/repchat/issues/772)) ([dbfee1d](https://github.com/Yukihide-Mitsuoka/repchat/commit/dbfee1de9213e20bcd62bce0f3acfa6159438bb5))
* **evaluation:** case単位の合格gateを追加する ([#808](https://github.com/Yukihide-Mitsuoka/repchat/issues/808)) ([0f78ff9](https://github.com/Yukihide-Mitsuoka/repchat/commit/0f78ff92934c14893c63d30dee54d2aadfccd061))
* **evaluation:** provider usageをrun単位で計測する ([#785](https://github.com/Yukihide-Mitsuoka/repchat/issues/785)) ([d6f07d4](https://github.com/Yukihide-Mitsuoka/repchat/commit/d6f07d43c43f3d6c5d3a97fb4e9b802ddcadcb3b))
* **evaluation:** 型付き診断をattempt間で保持する ([#805](https://github.com/Yukihide-Mitsuoka/repchat/issues/805)) ([ca467d7](https://github.com/Yukihide-Mitsuoka/repchat/commit/ca467d7a4cb1077580bfdaac5c7144477995e59b))
* **evaluation:** 型付き診断をevidenceへ保存する ([#806](https://github.com/Yukihide-Mitsuoka/repchat/issues/806)) ([59e5c44](https://github.com/Yukihide-Mitsuoka/repchat/commit/59e5c44842b1c767c264cf09950c4f05e91be59b))
* **evaluation:** 実行artifactを安全に記録する ([#781](https://github.com/Yukihide-Mitsuoka/repchat/issues/781)) ([d45e72e](https://github.com/Yukihide-Mitsuoka/repchat/commit/d45e72edbd9ad12285f140a2a57fe30123984aff))
* **evaluation:** 実行結果を共通契約で検証する ([#774](https://github.com/Yukihide-Mitsuoka/repchat/issues/774)) ([7ebbe92](https://github.com/Yukihide-Mitsuoka/repchat/commit/7ebbe921fb9e02cc09f3be82e2c52b4bc0b3b518))
* **evaluation:** 描画結果をrun記録へ接続する ([#780](https://github.com/Yukihide-Mitsuoka/repchat/issues/780)) ([c959ba0](https://github.com/Yukihide-Mitsuoka/repchat/commit/c959ba0d59bbb0d75694e8b582d5b7057692c732))
* **evaluation:** 計測付きrun実行をartifactへ接続する ([#782](https://github.com/Yukihide-Mitsuoka/repchat/issues/782)) ([79fc577](https://github.com/Yukihide-Mitsuoka/repchat/commit/79fc5773a1df7f39b615d97ae531f0eea6ea3777))
* **renderer:** 共通rendererをmodule化する ([#776](https://github.com/Yukihide-Mitsuoka/repchat/issues/776)) ([cf4ca0c](https://github.com/Yukihide-Mitsuoka/repchat/commit/cf4ca0c2b4ba543f13f992279eb56b17b91ebfb3))
* **renderer:** 実描画probeを追加する ([#778](https://github.com/Yukihide-Mitsuoka/repchat/issues/778)) ([812f345](https://github.com/Yukihide-Mitsuoka/repchat/commit/812f3450056dedd505d1ae6df444508249b22ec8))
* 評価入口に共通provider計測を接続する ([#786](https://github.com/Yukihide-Mitsuoka/repchat/issues/786)) ([4e01224](https://github.com/Yukihide-Mitsuoka/repchat/commit/4e0122434d731a400229c63165cc9c98d6419efd))


### Bug Fixes

* **evaluation:** BigQuery dry run診断を型付けする ([#800](https://github.com/Yukihide-Mitsuoka/repchat/issues/800)) ([59b9482](https://github.com/Yukihide-Mitsuoka/repchat/commit/59b9482ea0c1d56d091fcb785b4bdf91eaecabae))
* **evaluation:** BigQuery実行診断を型付けする ([#803](https://github.com/Yukihide-Mitsuoka/repchat/issues/803)) ([6fb53ea](https://github.com/Yukihide-Mitsuoka/repchat/commit/6fb53eae996de708edfa7a178d5e114d979b9523))
* **evaluation:** SQL後半stageの未知例外を伝播する ([#813](https://github.com/Yukihide-Mitsuoka/repchat/issues/813)) ([3fc24ba](https://github.com/Yukihide-Mitsuoka/repchat/commit/3fc24ba290c9f293e408105b153c60ccf8745331))
* **evaluation:** SQL診断判定を型付き分類へ移行する ([#797](https://github.com/Yukihide-Mitsuoka/repchat/issues/797)) ([d0b0338](https://github.com/Yukihide-Mitsuoka/repchat/commit/d0b0338e2f20bd2acf5cadac39a26dfdbfa0cba4))
* **evaluation:** 前段queryの処理bytesを失敗runへ記録する ([#783](https://github.com/Yukihide-Mitsuoka/repchat/issues/783)) ([acd0033](https://github.com/Yukihide-Mitsuoka/repchat/commit/acd003328330295f8850d1980ec57fa01ef9ef38))
* **evaluation:** 成功queryを含むrun全体の処理bytesを記録する ([#784](https://github.com/Yukihide-Mitsuoka/repchat/issues/784)) ([1c06831](https://github.com/Yukihide-Mitsuoka/repchat/commit/1c06831d9a4db12f6461fa5c8c22fc16777a0679))
* **evaluation:** 生成stageの未知例外を伝播する ([#815](https://github.com/Yukihide-Mitsuoka/repchat/issues/815)) ([579f632](https://github.com/Yukihide-Mitsuoka/repchat/commit/579f6323dad27f3859bf1e278235532218f5c925))
* **evaluation:** 結果・描画の未知例外を伝播する ([#810](https://github.com/Yukihide-Mitsuoka/repchat/issues/810)) ([3a4d161](https://github.com/Yukihide-Mitsuoka/repchat/commit/3a4d161202cfd55d6bc221a6d8f9308f78bcd6d0))

## [2.1.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v2.0.0...v2.1.0) (2026-09-20)


### Features

* **analysis:** manifestから評価preflightを反復する ([#761](https://github.com/Yukihide-Mitsuoka/repchat/issues/761)) ([d4e5845](https://github.com/Yukihide-Mitsuoka/repchat/commit/d4e584506565b730ca62bc4f15a64b9fd1e0296e))
* **analysis:** 不要な初回確認をなくす ([#763](https://github.com/Yukihide-Mitsuoka/repchat/issues/763)) ([202688a](https://github.com/Yukihide-Mitsuoka/repchat/commit/202688aaba2f19109cb600acdaa91388508dfa4d))
* **analysis:** 評価preflightを共通plannerへ接続する ([#765](https://github.com/Yukihide-Mitsuoka/repchat/issues/765)) ([885889f](https://github.com/Yukihide-Mitsuoka/repchat/commit/885889f30065aa3f2c6a5e395199bc9e4fe35b5c))
* **analysis:** 評価runtime入力を参照fixtureから分離する ([#759](https://github.com/Yukihide-Mitsuoka/repchat/issues/759)) ([b356d88](https://github.com/Yukihide-Mitsuoka/repchat/commit/b356d886b8e24d400f4d201878f5deb2b88064b8))
* BigQuery dry runを評価経路へ接続 ([#770](https://github.com/Yukihide-Mitsuoka/repchat/issues/770)) ([6c4dc67](https://github.com/Yukihide-Mitsuoka/repchat/commit/6c4dc6757851fcbbea5e1512a7fef61a29d2efda))
* **evaluation:** 単一パネルを共通SQL生成へ接続する ([#768](https://github.com/Yukihide-Mitsuoka/repchat/issues/768)) ([cdafc93](https://github.com/Yukihide-Mitsuoka/repchat/commit/cdafc93fe1066d0ca1ddf47491e58bc143538549))
* **evaluation:** 生成SQLを共通安全検証へ接続する ([#769](https://github.com/Yukihide-Mitsuoka/repchat/issues/769)) ([a3750f2](https://github.com/Yukihide-Mitsuoka/repchat/commit/a3750f20b248ba284786d2f5a13d14e3a4cb6337))
* **evaluation:** 評価計画を単一パネルに固定する ([#767](https://github.com/Yukihide-Mitsuoka/repchat/issues/767)) ([4d363b7](https://github.com/Yukihide-Mitsuoka/repchat/commit/4d363b73bdd86f4fa2f205af53ce18af09460bf9))

## [2.0.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.24.0...v2.0.0) (2026-09-20)


### ⚠ BREAKING CHANGES

* **analysis:** preflight失敗を評価証拠へ残す ([#756](https://github.com/Yukihide-Mitsuoka/repchat/issues/756))
* **analysis:** run失敗stageを評価証拠へ残す ([#755](https://github.com/Yukihide-Mitsuoka/repchat/issues/755))
* **analysis:** 評価run計画を実行前に固定する ([#754](https://github.com/Yukihide-Mitsuoka/repchat/issues/754))
* **analysis:** pipeline artifactを評価runへ固定する ([#752](https://github.com/Yukihide-Mitsuoka/repchat/issues/752))
* **analysis:** contract artifactを評価runへ固定する ([#751](https://github.com/Yukihide-Mitsuoka/repchat/issues/751))
* **analysis:** scope snapshotを評価証拠へ固定する ([#750](https://github.com/Yukihide-Mitsuoka/repchat/issues/750))
* **analysis:** run記録をreview済みfixtureへ固定する ([#749](https://github.com/Yukihide-Mitsuoka/repchat/issues/749))
* **analysis:** 評価fixtureの必須範囲を固定する ([#747](https://github.com/Yukihide-Mitsuoka/repchat/issues/747))

### Features

* **analysis:** contract artifactを評価runへ固定する ([#751](https://github.com/Yukihide-Mitsuoka/repchat/issues/751)) ([1910e2b](https://github.com/Yukihide-Mitsuoka/repchat/commit/1910e2be43f77bb7d37cfb3188ac655c361d8b43))
* **analysis:** pipeline artifactを評価runへ固定する ([#752](https://github.com/Yukihide-Mitsuoka/repchat/issues/752)) ([cc9cddc](https://github.com/Yukihide-Mitsuoka/repchat/commit/cc9cddcb876a61e0951b3ed3cebc02740622f9b1))
* **analysis:** preflight失敗を評価証拠へ残す ([#756](https://github.com/Yukihide-Mitsuoka/repchat/issues/756)) ([323d4c5](https://github.com/Yukihide-Mitsuoka/repchat/commit/323d4c54550daae5273a6fba1b36747f982a7adb))
* **analysis:** run失敗stageを評価証拠へ残す ([#755](https://github.com/Yukihide-Mitsuoka/repchat/issues/755)) ([b9b2a1f](https://github.com/Yukihide-Mitsuoka/repchat/commit/b9b2a1fb53915fc860ade53d1f8992bfeee7c7d8))
* **analysis:** run記録をreview済みfixtureへ固定する ([#749](https://github.com/Yukihide-Mitsuoka/repchat/issues/749)) ([f5b2d85](https://github.com/Yukihide-Mitsuoka/repchat/commit/f5b2d8525b5cb740edef4ee110d96f588ad04a7e))
* **analysis:** scope snapshotを評価証拠へ固定する ([#750](https://github.com/Yukihide-Mitsuoka/repchat/issues/750)) ([3d5ca59](https://github.com/Yukihide-Mitsuoka/repchat/commit/3d5ca592c975139e520fa872814e71267a948865))
* **analysis:** section executionを共通契約に限定 ([#718](https://github.com/Yukihide-Mitsuoka/repchat/issues/718)) ([1f6257b](https://github.com/Yukihide-Mitsuoka/repchat/commit/1f6257b62d8696b374dfd5cfef98c5e14feaf7c7))
* **analysis:** 未知schema評価の証拠境界を追加する ([#743](https://github.com/Yukihide-Mitsuoka/repchat/issues/743)) ([a8bd106](https://github.com/Yukihide-Mitsuoka/repchat/commit/a8bd1067caf8136f36407e7b09f9e014c1b54b9d))
* **analysis:** 評価fixtureとrun記録を分離する ([#746](https://github.com/Yukihide-Mitsuoka/repchat/issues/746)) ([45a9301](https://github.com/Yukihide-Mitsuoka/repchat/commit/45a93019caee3d35dffbb1083522a662e4dffa24))
* **analysis:** 評価fixtureの必須範囲を固定する ([#747](https://github.com/Yukihide-Mitsuoka/repchat/issues/747)) ([0b97023](https://github.com/Yukihide-Mitsuoka/repchat/commit/0b970234dae4f510e9e9de4c1f45505366cbaf2a))
* **analysis:** 評価preflightを共通runtimeへ接続する ([#757](https://github.com/Yukihide-Mitsuoka/repchat/issues/757)) ([e7ed40a](https://github.com/Yukihide-Mitsuoka/repchat/commit/e7ed40a24ad896ccb15c831a800ff926203a2457))
* **analysis:** 評価run計画を実行前に固定する ([#754](https://github.com/Yukihide-Mitsuoka/repchat/issues/754)) ([5bbf86f](https://github.com/Yukihide-Mitsuoka/repchat/commit/5bbf86f073ec86aad49b112f70d03ba9e9c51282))
* **analysis:** 評価受入ポリシーを強制する ([#744](https://github.com/Yukihide-Mitsuoka/repchat/issues/744)) ([af76cb7](https://github.com/Yukihide-Mitsuoka/repchat/commit/af76cb746143a51ef3d1b6ac78ac4071a2faaa45))


### Bug Fixes

* **analysis:** runtime固有処理ratchetのallowlistを空にする ([#739](https://github.com/Yukihide-Mitsuoka/repchat/issues/739)) ([f6f9922](https://github.com/Yukihide-Mitsuoka/repchat/commit/f6f9922cb3d43762b3077baab9db12d536f0a3d0))
* **analysis:** SQL修正から固定URL関数の指示を除く ([#728](https://github.com/Yukihide-Mitsuoka/repchat/issues/728)) ([16b571a](https://github.com/Yukihide-Mitsuoka/repchat/commit/16b571adb94e158ef8025b892ab79097fdb55f74))
* **analysis:** SQL実行に共通契約を必須化する ([#727](https://github.com/Yukihide-Mitsuoka/repchat/issues/727)) ([351a673](https://github.com/Yukihide-Mitsuoka/repchat/commit/351a67396c9a33241006d65df5423350c6ae469c))
* **analysis:** 対象固有の旧テナント配信実験を削除 ([#730](https://github.com/Yukihide-Mitsuoka/repchat/issues/730)) ([6102211](https://github.com/Yukihide-Mitsuoka/repchat/commit/610221128c3a1232ddc84c52c1f7d1d67f1ff6be))
* **analysis:** 時系列chartの出力役割を中立化する ([#732](https://github.com/Yukihide-Mitsuoka/repchat/issues/732)) ([0fbdf34](https://github.com/Yukihide-Mitsuoka/repchat/commit/0fbdf346c89f47345896622e4e13aee8bd306f2b))
* **analysis:** 時間軸SQLを選択fieldへ照合する ([#736](https://github.com/Yukihide-Mitsuoka/repchat/issues/736)) ([cd8bf1d](https://github.com/Yukihide-Mitsuoka/repchat/commit/cd8bf1da0de21a336e8589b70f4c6fdc15d0d5f6))
* **analysis:** 未検証の段階付きSankeyを閉じる ([#738](https://github.com/Yukihide-Mitsuoka/repchat/issues/738)) ([2a724c3](https://github.com/Yukihide-Mitsuoka/repchat/commit/2a724c336000d7fbfd985a4a99a27c978b58697c))
* **contract:** 疑似日時を時間dimensionへ接続 ([#735](https://github.com/Yukihide-Mitsuoka/repchat/issues/735)) ([4bd4beb](https://github.com/Yukihide-Mitsuoka/repchat/commit/4bd4beb35f639412e09fe5bedf02b772808e0143))
* **visualization:** 共通契約で時系列chartの時間軸を検査する ([#733](https://github.com/Yukihide-Mitsuoka/repchat/issues/733)) ([791f026](https://github.com/Yukihide-Mitsuoka/repchat/commit/791f0265f0f2d9e5aeed2646404847fd07381f25))
* **visualization:** 段階付きSankeyのページ固有処理を削除 ([#734](https://github.com/Yukihide-Mitsuoka/repchat/issues/734)) ([c017f73](https://github.com/Yukihide-Mitsuoka/repchat/commit/c017f73c3c94ff848720a4cf54323bf19ff915bb))

## [1.24.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.23.0...v1.24.0) (2026-09-14)


### Features

* **planner:** 契約付きplanからprofileを除去 ([#698](https://github.com/Yukihide-Mitsuoka/repchat/issues/698)) ([056a927](https://github.com/Yukihide-Mitsuoka/repchat/commit/056a927a8e2407d5e27b343c6e6259ef515e2a7a))
* **planner:** 生成入力からprofile IDを除去 ([#697](https://github.com/Yukihide-Mitsuoka/repchat/issues/697)) ([9f8a430](https://github.com/Yukihide-Mitsuoka/repchat/commit/9f8a430b6d879a3cb644b145d7eeb382eeb953c8))
* **schema:** shard期間を共通契約へ固定 ([#673](https://github.com/Yukihide-Mitsuoka/repchat/issues/673)) ([90079f6](https://github.com/Yukihide-Mitsuoka/repchat/commit/90079f6b79019cda832c1018b9f81ef584022e8a))
* **schema:** shard期間生成を汎用契約へ接続 ([#684](https://github.com/Yukihide-Mitsuoka/repchat/issues/684)) ([4dcf5c8](https://github.com/Yukihide-Mitsuoka/repchat/commit/4dcf5c8244f61f12d1156b3d4a6ef664aaca3e50)), closes [#188](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)
* **schema:** 共通契約のidentityを安定化 ([#675](https://github.com/Yukihide-Mitsuoka/repchat/issues/675)) ([57d8946](https://github.com/Yukihide-Mitsuoka/repchat/commit/57d8946da1840f520f89970daec70dcd3c58af70))
* **schema:** 共通契約を生成sourceへ束縛 ([#674](https://github.com/Yukihide-Mitsuoka/repchat/issues/674)) ([ac73eaa](https://github.com/Yukihide-Mitsuoka/repchat/commit/ac73eaa106522cca4c25c5874c4b999323156d2c))
* **schema:** 契約からfield policyを導出 ([#693](https://github.com/Yukihide-Mitsuoka/repchat/issues/693)) ([faefedb](https://github.com/Yukihide-Mitsuoka/repchat/commit/faefedbaff7ad39e0906ba0ac2ab0cf8bc456cf3))
* **schema:** 契約からSQL実行scopeを導出 ([#687](https://github.com/Yukihide-Mitsuoka/repchat/issues/687)) ([2a2b606](https://github.com/Yukihide-Mitsuoka/repchat/commit/2a2b606134629d1c2b499607542dfdc79aa5826e)), closes [#188](https://github.com/Yukihide-Mitsuoka/repchat/issues/188)
* **schema:** 契約から期間検査policyを導出 ([#689](https://github.com/Yukihide-Mitsuoka/repchat/issues/689)) ([75dbb02](https://github.com/Yukihide-Mitsuoka/repchat/commit/75dbb02c060163f3784fdc9f3d0bfc0d96bb7431))
* **schema:** 契約から期間検査policyを導出 ([#689](https://github.com/Yukihide-Mitsuoka/repchat/issues/689)) ([763b20f](https://github.com/Yukihide-Mitsuoka/repchat/commit/763b20fa2ab4588689b3ca6ece8d8c45c0553a48))
* **schema:** 契約でSQL field参照を検査 ([#695](https://github.com/Yukihide-Mitsuoka/repchat/issues/695)) ([1e72947](https://github.com/Yukihide-Mitsuoka/repchat/commit/1e72947dcec4b781b917d0d7b4296fdf368548b6))
* **schema:** 契約で結果形状を検査 ([#696](https://github.com/Yukihide-Mitsuoka/repchat/issues/696)) ([065bfc9](https://github.com/Yukihide-Mitsuoka/repchat/commit/065bfc93609a7a0c0b0ee02b1dd398e2ae6d9906))
* **schema:** 契約期間をSQL検査へ接続 ([#691](https://github.com/Yukihide-Mitsuoka/repchat/issues/691)) ([a5fa29b](https://github.com/Yukihide-Mitsuoka/repchat/commit/a5fa29bef222d918837c936636bd5a885bdcd1ed))
* **schema:** 日次shardを汎用契約へ統合 ([#683](https://github.com/Yukihide-Mitsuoka/repchat/issues/683)) ([4c38e46](https://github.com/Yukihide-Mitsuoka/repchat/commit/4c38e4693b4eb4b055fdc40a8d3a6ffa39a17ea7))
* **schema:** 日次shard集合を完全解決 ([#672](https://github.com/Yukihide-Mitsuoka/repchat/issues/672)) ([f045f00](https://github.com/Yukihide-Mitsuoka/repchat/commit/f045f0071f34b24652831ff5151969461be4741f))
* **schema:** 時間なしschemaを汎用契約で表現 ([#685](https://github.com/Yukihide-Mitsuoka/repchat/issues/685)) ([97aaf56](https://github.com/Yukihide-Mitsuoka/repchat/commit/97aaf5609cf9a555778f96e27ac9a277aea95f8c))
* **schema:** 汎用契約生成の入力を固定する ([#680](https://github.com/Yukihide-Mitsuoka/repchat/issues/680)) ([067776b](https://github.com/Yukihide-Mitsuoka/repchat/commit/067776bcc84305461afc9fa997d7ce7a4a328b38))
* **schema:** 汎用契約生成をVertex I/Oへ接続 ([#682](https://github.com/Yukihide-Mitsuoka/repchat/issues/682)) ([c5f6d56](https://github.com/Yukihide-Mitsuoka/repchat/commit/c5f6d5625ac8d396e322933ee5d8af7f1ca25603))
* **schema:** 生成候補を汎用契約へ正規化する ([#681](https://github.com/Yukihide-Mitsuoka/repchat/issues/681)) ([e0bf835](https://github.com/Yukihide-Mitsuoka/repchat/commit/e0bf835aa7d3a3a069c483d14404d3efb41309e7))
* **schema:** 発見済み意味roleを構造検証 ([#679](https://github.com/Yukihide-Mitsuoka/repchat/issues/679)) ([bcd0b92](https://github.com/Yukihide-Mitsuoka/repchat/commit/bcd0b921c8b45a11fa5ad97d961d7dfae83366fa))
* **schema:** 認可scopeから汎用catalogを自動発見 ([#678](https://github.com/Yukihide-Mitsuoka/repchat/issues/678)) ([18767e9](https://github.com/Yukihide-Mitsuoka/repchat/commit/18767e956702e221b036321d1774ed306f2431ad))


### Bug Fixes

* Bitcoin月範囲と混合グラフの可読性を直す ([#666](https://github.com/Yukihide-Mitsuoka/repchat/issues/666)) ([b041fce](https://github.com/Yukihide-Mitsuoka/repchat/commit/b041fce8539d5bb7093afa7885937b7238043d62)), closes [#665](https://github.com/Yukihide-Mitsuoka/repchat/issues/665)
* **demo:** [#658](https://github.com/Yukihide-Mitsuoka/repchat/issues/658) comparison tableの指標契約を修正 ([#660](https://github.com/Yukihide-Mitsuoka/repchat/issues/660)) ([a94ce93](https://github.com/Yukihide-Mitsuoka/repchat/commit/a94ce93e90e7bafaa04e31209255ce2c586bd592))
* **demo:** [#662](https://github.com/Yukihide-Mitsuoka/repchat/issues/662) 期間修正診断を具体化 ([#663](https://github.com/Yukihide-Mitsuoka/repchat/issues/663)) ([d582c5c](https://github.com/Yukihide-Mitsuoka/repchat/commit/d582c5c66d86c6bee51b59ea2efc53c12c14a089))
* **demo:** role-based chart契約を整合 ([#669](https://github.com/Yukihide-Mitsuoka/repchat/issues/669)) ([d9dbcab](https://github.com/Yukihide-Mitsuoka/repchat/commit/d9dbcab86faffcfda03207b500a112bbdfacd177)), closes [#659](https://github.com/Yukihide-Mitsuoka/repchat/issues/659)
* **demo:** Vertex APIエラーを安全に分類する ([#652](https://github.com/Yukihide-Mitsuoka/repchat/issues/652)) ([090b191](https://github.com/Yukihide-Mitsuoka/repchat/commit/090b1917e92b9b40c67cefd9adfee45aba9d0224))
* **demo:** ダッシュボード計画schemaを平坦化する ([#655](https://github.com/Yukihide-Mitsuoka/repchat/issues/655)) ([1ff0760](https://github.com/Yukihide-Mitsuoka/repchat/commit/1ff07606fb0b47273987e5d84cdad2282c764fc4))

## [1.23.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.22.3...v1.23.0) (2026-09-07)


### Features

* BitcoinダッシュボードをライブUIへ公開 ([#644](https://github.com/Yukihide-Mitsuoka/repchat/issues/644)) ([3b8de8d](https://github.com/Yukihide-Mitsuoka/repchat/commit/3b8de8d450d4ea67af782dc645c92c78caa79e9f))
* GA4とBitcoinの分析パイプラインを共通化 ([#643](https://github.com/Yukihide-Mitsuoka/repchat/issues/643)) ([c94c90a](https://github.com/Yukihide-Mitsuoka/repchat/commit/c94c90a1784bf227305818926e690b63e5612199))
* **schema:** 共通分析契約と期間制約を追加 ([#649](https://github.com/Yukihide-Mitsuoka/repchat/issues/649)) ([e712c61](https://github.com/Yukihide-Mitsuoka/repchat/commit/e712c616e0361db91c217dde0d017fc22cb24895))
* **schema:** 共通契約を生成文脈と確定仕様へ固定 ([#650](https://github.com/Yukihide-Mitsuoka/repchat/issues/650)) ([2be46f8](https://github.com/Yukihide-Mitsuoka/repchat/commit/2be46f867791fa7c9c61f7a0efaba0642ad554df))
* **schema:** 承認済みテーブルのメタデータ取得境界を追加 ([#648](https://github.com/Yukihide-Mitsuoka/repchat/issues/648)) ([a3c3b37](https://github.com/Yukihide-Mitsuoka/repchat/commit/a3c3b37dd70c6d61f5b3b5e7e37da7e220d02043))


### Bug Fixes

* **ci:** 利用先PRの日本語規則を強制する ([#642](https://github.com/Yukihide-Mitsuoka/repchat/issues/642)) ([7f8682e](https://github.com/Yukihide-Mitsuoka/repchat/commit/7f8682e5a22e459c48de0cb37fbb414bd8e0e502))
* **demo:** 実サービス検証全体へ選択データソースを渡す ([#645](https://github.com/Yukihide-Mitsuoka/repchat/issues/645)) ([891c35e](https://github.com/Yukihide-Mitsuoka/repchat/commit/891c35e660e35ec111a345a8a674e2d98642c854))
* **main:** 設定検証をruntime importより先に行う ([#638](https://github.com/Yukihide-Mitsuoka/repchat/issues/638)) ([575d2da](https://github.com/Yukihide-Mitsuoka/repchat/commit/575d2da6d2c5303250ed47f0888504af0583ba0c)), closes [#481](https://github.com/Yukihide-Mitsuoka/repchat/issues/481)
* **sync:** PR言語判定ツールの継承境界を準備する ([#641](https://github.com/Yukihide-Mitsuoka/repchat/issues/641)) ([0212cfd](https://github.com/Yukihide-Mitsuoka/repchat/commit/0212cfd2c9bc7c598a5201b663a52bc498ba806b))

## [1.22.3](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.22.2...v1.22.3) (2026-09-04)


### Bug Fixes

* **demo:** 上限超過requestの接続resetを防ぐ ([#636](https://github.com/Yukihide-Mitsuoka/repchat/issues/636)) ([2e7bfb1](https://github.com/Yukihide-Mitsuoka/repchat/commit/2e7bfb11ff26a8d0bf1d28c70566667ec0224456))

## [1.22.2](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.22.1...v1.22.2) (2026-09-02)


### Bug Fixes

* **ci:** preserve contents access in workflow jobs ([#628](https://github.com/Yukihide-Mitsuoka/repchat/issues/628)) ([b96d64b](https://github.com/Yukihide-Mitsuoka/repchat/commit/b96d64b2712760f21f7e1bf6dccc07faceec3c68))
* **demo:** validate BigQuery dry-run metadata ([#631](https://github.com/Yukihide-Mitsuoka/repchat/issues/631)) ([6c4a15a](https://github.com/Yukihide-Mitsuoka/repchat/commit/6c4a15a0f8a75d0847af0f64c573cdee80fbc8ff))

## [1.22.1](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.22.0...v1.22.1) (2026-08-29)


### Bug Fixes

* **ci:** skip public-only security jobs in private repos ([#485](https://github.com/Yukihide-Mitsuoka/repchat/issues/485)) ([7ef02e7](https://github.com/Yukihide-Mitsuoka/repchat/commit/7ef02e740e330389ea98fe33d8b92062fe945b39))

## [1.22.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.21.0...v1.22.0) (2026-08-28)


### Features

* **demo:** add advanced table interactions ([#450](https://github.com/Yukihide-Mitsuoka/repchat/issues/450)) ([58eeff4](https://github.com/Yukihide-Mitsuoka/repchat/commit/58eeff41cd27041460ce5f0a35c4cf272e252218))
* **demo:** add analytical chart components ([#445](https://github.com/Yukihide-Mitsuoka/repchat/issues/445)) ([f99c078](https://github.com/Yukihide-Mitsuoka/repchat/commit/f99c07841e4e911148aaf94fb91f9b99be7b631d))
* **demo:** add data-driven area maps ([#447](https://github.com/Yukihide-Mitsuoka/repchat/issues/447)) ([dfc0868](https://github.com/Yukihide-Mitsuoka/repchat/commit/dfc0868eca294c94026720703afd9cc81938c729))
* **demo:** add distribution and hierarchy charts ([#446](https://github.com/Yukihide-Mitsuoka/repchat/issues/446)) ([65101f9](https://github.com/Yukihide-Mitsuoka/repchat/commit/65101f9e91b2e067881079d22a61de2d4cfb0fc1))
* **demo:** add ECharts sparkline tables ([#453](https://github.com/Yukihide-Mitsuoka/repchat/issues/453)) ([89300a6](https://github.com/Yukihide-Mitsuoka/repchat/commit/89300a61212cd809e488e73d66c197f28acb2710))
* **demo:** add point and layered maps ([#448](https://github.com/Yukihide-Mitsuoka/repchat/issues/448)) ([1890255](https://github.com/Yukihide-Mitsuoka/repchat/commit/18902556287019f833049cf5398354c1373d1614))
* **demo:** add reference annotations ([#449](https://github.com/Yukihide-Mitsuoka/repchat/issues/449)) ([527455f](https://github.com/Yukihide-Mitsuoka/repchat/commit/527455fa1b8c06127bdc42f403f1a4269d4cb29c))
* **demo:** add validated pivot tables ([#451](https://github.com/Yukihide-Mitsuoka/repchat/issues/451)) ([8cdb876](https://github.com/Yukihide-Mitsuoka/repchat/commit/8cdb876ce5a1e84676d502e73d3016cfa8f1d3ca))
* **demo:** add verified comparison tables ([#452](https://github.com/Yukihide-Mitsuoka/repchat/issues/452)) ([1323390](https://github.com/Yukihide-Mitsuoka/repchat/commit/1323390054a3cf83a42dd2114d97fd5f7cf7b93c))
* **demo:** support chart orientation and general flows ([#444](https://github.com/Yukihide-Mitsuoka/repchat/issues/444)) ([738d021](https://github.com/Yukihide-Mitsuoka/repchat/commit/738d02184fac1dd0b2314edae9b62b890ca06f30)), closes [#442](https://github.com/Yukihide-Mitsuoka/repchat/issues/442)
* **demo:** support Evidence series chart variants ([#443](https://github.com/Yukihide-Mitsuoka/repchat/issues/443)) ([4147ea9](https://github.com/Yukihide-Mitsuoka/repchat/commit/4147ea910fa4f9016fb5de802c6f45aa9343b56f)), closes [#442](https://github.com/Yukihide-Mitsuoka/repchat/issues/442)


### Bug Fixes

* diagnose HTTP listener allocation and cleanup ([#439](https://github.com/Yukihide-Mitsuoka/repchat/issues/439)) ([ce94963](https://github.com/Yukihide-Mitsuoka/repchat/commit/ce94963a219ca805e1a9a2a64978424a16c5992a)), closes [#169](https://github.com/Yukihide-Mitsuoka/repchat/issues/169)
* standardize structured response diagnostics ([#440](https://github.com/Yukihide-Mitsuoka/repchat/issues/440)) ([a0dbdcf](https://github.com/Yukihide-Mitsuoka/repchat/commit/a0dbdcf0692cd4517ca33d0ae951697de4812285)), closes [#293](https://github.com/Yukihide-Mitsuoka/repchat/issues/293)

## [1.21.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.20.3...v1.21.0) (2026-08-23)


### Features

* **demo:** add clarification flow and live verification ([#436](https://github.com/Yukihide-Mitsuoka/repchat/issues/436)) ([4dbe9fe](https://github.com/Yukihide-Mitsuoka/repchat/commit/4dbe9feaec426a73522476467a9d2e555fc99948))

## [1.20.3](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.20.2...v1.20.3) (2026-08-23)


### Bug Fixes

* **demo:** adapt chart layout and preserve dashboard errors ([#433](https://github.com/Yukihide-Mitsuoka/repchat/issues/433)) ([260db2f](https://github.com/Yukihide-Mitsuoka/repchat/commit/260db2fdccd4231da632080a9c5104380b3a774c))
* **demo:** harden insight SQL and dense heatmaps ([#435](https://github.com/Yukihide-Mitsuoka/repchat/issues/435)) ([debed30](https://github.com/Yukihide-Mitsuoka/repchat/commit/debed30f8c2cc718fe496c2877e3de2dd69f83ef))

## [1.20.2](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.20.1...v1.20.2) (2026-08-23)


### Bug Fixes

* **demo:** use chart space and reduce bar noise ([#431](https://github.com/Yukihide-Mitsuoka/repchat/issues/431)) ([222666e](https://github.com/Yukihide-Mitsuoka/repchat/commit/222666e87eda6ec49a913c21aaf2b6f015a51d11))
* **planner:** trust structured chart dimensions ([#430](https://github.com/Yukihide-Mitsuoka/repchat/issues/430)) ([c98a383](https://github.com/Yukihide-Mitsuoka/repchat/commit/c98a38387caf1183d80863d12b6000fb9485a1c0))

## [1.20.1](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.20.0...v1.20.1) (2026-08-22)


### Bug Fixes

* **demo:** balance chart layout and ground report numbers ([#426](https://github.com/Yukihide-Mitsuoka/repchat/issues/426)) ([9e28ccc](https://github.com/Yukihide-Mitsuoka/repchat/commit/9e28ccca098e9d3f90ab35615f0d03466bf726d6))

## [1.20.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.19.0...v1.20.0) (2026-08-22)


### Features

* **demo:** render validated charts with ECharts ([#423](https://github.com/Yukihide-Mitsuoka/repchat/issues/423)) ([e1a6e8c](https://github.com/Yukihide-Mitsuoka/repchat/commit/e1a6e8c62023fa4aac57d9301d7690b1d1710665))

## [1.19.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.18.0...v1.19.0) (2026-08-22)


### Features

* **demo:** derive chart execution contracts ([#401](https://github.com/Yukihide-Mitsuoka/repchat/issues/401)) ([3db7866](https://github.com/Yukihide-Mitsuoka/repchat/commit/3db7866d600e015c3fdec91092bef67c75d7e493))
* **demo:** improve visualization evidence ([#411](https://github.com/Yukihide-Mitsuoka/repchat/issues/411)) ([aac5d6d](https://github.com/Yukihide-Mitsuoka/repchat/commit/aac5d6da94f050babf99a48e2a2258a4c07a3332))
* **demo:** preflight AI dashboard SQL ([#403](https://github.com/Yukihide-Mitsuoka/repchat/issues/403)) ([e205192](https://github.com/Yukihide-Mitsuoka/repchat/commit/e2051924fd2eeacda7f73a9a75825ec08efd73b0))
* **demo:** render all AI chart types ([#404](https://github.com/Yukihide-Mitsuoka/repchat/issues/404)) ([b74b9ef](https://github.com/Yukihide-Mitsuoka/repchat/commit/b74b9ef6eb64b98c1d64ad7611dfc70831b24285))


### Bug Fixes

* **demo:** bound dashboard provider schema ([#412](https://github.com/Yukihide-Mitsuoka/repchat/issues/412)) ([85a34a0](https://github.com/Yukihide-Mitsuoka/repchat/commit/85a34a016aded5ea8786d294aefed577861cad47))
* **demo:** improve chart readability ([#409](https://github.com/Yukihide-Mitsuoka/repchat/issues/409)) ([9dcecbd](https://github.com/Yukihide-Mitsuoka/repchat/commit/9dcecbde52761bd95483422d33ae1c713dc3ddcc))
* **demo:** preserve generated analysis integrity ([#419](https://github.com/Yukihide-Mitsuoka/repchat/issues/419)) ([e8a0f3e](https://github.com/Yukihide-Mitsuoka/repchat/commit/e8a0f3e64cd95008c5b823a7a0eaf38783b39fc8))
* **demo:** update sqlparse to 0.6.0 ([#415](https://github.com/Yukihide-Mitsuoka/repchat/issues/415)) ([cfea08d](https://github.com/Yukihide-Mitsuoka/repchat/commit/cfea08d08ef99bee59c8cb5419bd47283cf30a2e)), closes [#414](https://github.com/Yukihide-Mitsuoka/repchat/issues/414)

## [1.18.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.17.0...v1.18.0) (2026-08-14)


### Features

* **demo:** add dashboard focus mode ([#365](https://github.com/Yukihide-Mitsuoka/repchat/issues/365)) ([f18f487](https://github.com/Yukihide-Mitsuoka/repchat/commit/f18f4874a884347c5fc51f7ab4cb79fe780a5daf))
* **demo:** add stateful analysis consultation planner ([#375](https://github.com/Yukihide-Mitsuoka/repchat/issues/375)) ([d888cee](https://github.com/Yukihide-Mitsuoka/repchat/commit/d888cee2b1d72d681c84873c18a23c5b084af33c))
* **demo:** build AI-authored dashboard specifications ([#378](https://github.com/Yukihide-Mitsuoka/repchat/issues/378)) ([2ec2b63](https://github.com/Yukihide-Mitsuoka/repchat/commit/2ec2b6350a30b4c4ae0203dcc0da6fd80922aec7))
* **demo:** define AI-authored dashboard plans ([#377](https://github.com/Yukihide-Mitsuoka/repchat/issues/377)) ([bfef658](https://github.com/Yukihide-Mitsuoka/repchat/commit/bfef658c79e6ac41afc0ce477c609a3048c06feb))
* **demo:** define renderer chart contracts ([#392](https://github.com/Yukihide-Mitsuoka/repchat/issues/392)) ([6620cdf](https://github.com/Yukihide-Mitsuoka/repchat/commit/6620cdf5c91d8889264bbc9d43413356a218554a))
* **demo:** prevent overlapping analysis requests ([#391](https://github.com/Yukihide-Mitsuoka/repchat/issues/391)) ([428e76d](https://github.com/Yukihide-Mitsuoka/repchat/commit/428e76d3d7f8e5fd2659b46affcbad6d9e8d758b))
* **demo:** revise AI-authored dashboard plans ([#379](https://github.com/Yukihide-Mitsuoka/repchat/issues/379)) ([91e7bc7](https://github.com/Yukihide-Mitsuoka/repchat/commit/91e7bc71806960a8b3312329d438d93d2e2a4533))
* **demo:** validate AI consultation specifications ([#396](https://github.com/Yukihide-Mitsuoka/repchat/issues/396)) ([3c74608](https://github.com/Yukihide-Mitsuoka/repchat/commit/3c746081bf593cc6b82c9fe0d61b2c20130e8b05))
* **demo:** validate and repair generated SQL ([#387](https://github.com/Yukihide-Mitsuoka/repchat/issues/387)) ([96c9edd](https://github.com/Yukihide-Mitsuoka/repchat/commit/96c9edd1b8211ea91782e687679ce61ce0c39fe0))


### Bug Fixes

* **demo:** align dashboard card heights ([#395](https://github.com/Yukihide-Mitsuoka/repchat/issues/395)) ([ec12b0a](https://github.com/Yukihide-Mitsuoka/repchat/commit/ec12b0a998a2d967365568625ca3a06b700b063c))
* **demo:** constrain and auto-grow analysis composer ([#360](https://github.com/Yukihide-Mitsuoka/repchat/issues/360)) ([31680ae](https://github.com/Yukihide-Mitsuoka/repchat/commit/31680ae57a6fca0f138501b3517ebd78eb2f97ff))
* **demo:** expand artifact pane safely ([#368](https://github.com/Yukihide-Mitsuoka/repchat/issues/368)) ([566eb0f](https://github.com/Yukihide-Mitsuoka/repchat/commit/566eb0f6b1b602c5ef112a9b3d8e36f38361a37a)), closes [#367](https://github.com/Yukihide-Mitsuoka/repchat/issues/367)
* **demo:** keep dashboard rows complete and full-width ([#363](https://github.com/Yukihide-Mitsuoka/repchat/issues/363)) ([9b14f4b](https://github.com/Yukihide-Mitsuoka/repchat/commit/9b14f4b084170953a22648a979e660fed5400a0b))
* **demo:** make analysis consultation stateful ([#376](https://github.com/Yukihide-Mitsuoka/repchat/issues/376)) ([bb6c5cd](https://github.com/Yukihide-Mitsuoka/repchat/commit/bb6c5cde726b0645f1126efcf38f007df1c21a85))
* own inherited expand compatibility test ([#383](https://github.com/Yukihide-Mitsuoka/repchat/issues/383)) ([e8b07a4](https://github.com/Yukihide-Mitsuoka/repchat/commit/e8b07a4d814d58947d79f3940f4e5403e68da288))
* upgrade protected workflow actions ([#390](https://github.com/Yukihide-Mitsuoka/repchat/issues/390)) ([751a533](https://github.com/Yukihide-Mitsuoka/repchat/commit/751a5331a1d409c8b8dd575919874711f7456bcd)), closes [#384](https://github.com/Yukihide-Mitsuoka/repchat/issues/384)

## [1.17.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.16.1...v1.17.0) (2026-08-11)


### Features

* **demo:** consult before broad analysis execution ([#358](https://github.com/Yukihide-Mitsuoka/repchat/issues/358)) ([f53cf07](https://github.com/Yukihide-Mitsuoka/repchat/commit/f53cf07beb889a93dd8110235b60bf8908730744)), closes [#357](https://github.com/Yukihide-Mitsuoka/repchat/issues/357)
* **demo:** polish the analysis workspace ([#348](https://github.com/Yukihide-Mitsuoka/repchat/issues/348)) ([0c0002c](https://github.com/Yukihide-Mitsuoka/repchat/commit/0c0002cf1e12bc24f11fb43d43465ece05a3539d)), closes [#347](https://github.com/Yukihide-Mitsuoka/repchat/issues/347)
* **demo:** refine workspace layout controls ([#356](https://github.com/Yukihide-Mitsuoka/repchat/issues/356)) ([3f6f74c](https://github.com/Yukihide-Mitsuoka/repchat/commit/3f6f74c6eb9e3611547906aee4fc7955a1cfcfe9))
* **demo:** unify analysis chat and artifact workspace ([#353](https://github.com/Yukihide-Mitsuoka/repchat/issues/353)) ([8e7edfb](https://github.com/Yukihide-Mitsuoka/repchat/commit/8e7edfb801b9ffdaeb30640bf29acdc547247f75)), closes [#352](https://github.com/Yukihide-Mitsuoka/repchat/issues/352)


### Bug Fixes

* **demo:** align workspace shell and live errors ([#351](https://github.com/Yukihide-Mitsuoka/repchat/issues/351)) ([ad2013e](https://github.com/Yukihide-Mitsuoka/repchat/commit/ad2013e1b7be0efca9811b8b949cdfa39b86b912))
* **demo:** keep workspace titles compact ([#354](https://github.com/Yukihide-Mitsuoka/repchat/issues/354)) ([5d64c5c](https://github.com/Yukihide-Mitsuoka/repchat/commit/5d64c5cc2da69149d407eca32085aa57c21aecb5)), closes [#352](https://github.com/Yukihide-Mitsuoka/repchat/issues/352)

## [1.16.1](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.16.0...v1.16.1) (2026-08-11)


### Bug Fixes

* **demo:** include thought tokens in generation usage ([#335](https://github.com/Yukihide-Mitsuoka/repchat/issues/335)) ([8e7c521](https://github.com/Yukihide-Mitsuoka/repchat/commit/8e7c521f301b58525e15ff17b937e9f120b24ff1))

## [1.16.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.15.6...v1.16.0) (2026-08-10)


### Features

* **demo:** add analysis workspace shell ([#330](https://github.com/Yukihide-Mitsuoka/repchat/issues/330)) ([4c6c2b8](https://github.com/Yukihide-Mitsuoka/repchat/commit/4c6c2b81a6045f77594be98271bf8e04afa873b5)), closes [#328](https://github.com/Yukihide-Mitsuoka/repchat/issues/328)


### Bug Fixes

* **demo:** preserve grid when panes collapse ([#332](https://github.com/Yukihide-Mitsuoka/repchat/issues/332)) ([053e1af](https://github.com/Yukihide-Mitsuoka/repchat/commit/053e1afe807ebdcf30e9d89a013e8bd470655487)), closes [#331](https://github.com/Yukihide-Mitsuoka/repchat/issues/331)
* **demo:** preserve safe meeting report claims ([#333](https://github.com/Yukihide-Mitsuoka/repchat/issues/333)) ([a14745c](https://github.com/Yukihide-Mitsuoka/repchat/commit/a14745c89c1c2eade4b598137c599f87377c4601))
* **demo:** require requested navigation depth ([#326](https://github.com/Yukihide-Mitsuoka/repchat/issues/326)) ([db0e369](https://github.com/Yukihide-Mitsuoka/repchat/commit/db0e369c7f2f68251f325873128f269954fa065a))

## [1.15.6](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.15.5...v1.15.6) (2026-08-10)


### Bug Fixes

* **demo:** complete bounded meeting reports ([#312](https://github.com/Yukihide-Mitsuoka/repchat/issues/312)) ([ce2397f](https://github.com/Yukihide-Mitsuoka/repchat/commit/ce2397f3f3aa97daba40bdfbc497935f04912830))
* **demo:** explain expired application-default credentials ([#322](https://github.com/Yukihide-Mitsuoka/repchat/issues/322)) ([37d647d](https://github.com/Yukihide-Mitsuoka/repchat/commit/37d647d2f74e5862c2dac20c54a2ea42c237c83b))
* **demo:** isolate Sankey SVG paint-server IDs ([#320](https://github.com/Yukihide-Mitsuoka/repchat/issues/320)) ([67a7694](https://github.com/Yukihide-Mitsuoka/repchat/commit/67a7694e194882fd364e4748311f1700a74ef362))
* **demo:** preserve custom navigation depth ([#324](https://github.com/Yukihide-Mitsuoka/repchat/issues/324)) ([fd97479](https://github.com/Yukihide-Mitsuoka/repchat/commit/fd97479c3aeba94d47b1bc5aa73a7b93e2cd758c))

## [1.15.5](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.15.4...v1.15.5) (2026-08-09)


### Bug Fixes

* **demo:** validate report-derived evidence ([#297](https://github.com/Yukihide-Mitsuoka/repchat/issues/297)) ([b43eae2](https://github.com/Yukihide-Mitsuoka/repchat/commit/b43eae278c094c8b0674c6220a2a46159a782dda))
* **sync:** prevent duplicate template reviews ([#299](https://github.com/Yukihide-Mitsuoka/repchat/issues/299)) ([1a9e082](https://github.com/Yukihide-Mitsuoka/repchat/commit/1a9e08222c5b0a62d48a688cae5c681b77ecebdd))

## [1.15.4](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.15.3...v1.15.4) (2026-08-09)


### Bug Fixes

* **demo:** bound meeting report JSON output ([#294](https://github.com/Yukihide-Mitsuoka/repchat/issues/294)) ([c32ebe6](https://github.com/Yukihide-Mitsuoka/repchat/commit/c32ebe60aad9922a817bc2a70e929e430716b917))
* **demo:** link report summaries to evidence ([#290](https://github.com/Yukihide-Mitsuoka/repchat/issues/290)) ([00768f5](https://github.com/Yukihide-Mitsuoka/repchat/commit/00768f5a7edda65483805e878645289b1d6f595e)), closes [#289](https://github.com/Yukihide-Mitsuoka/repchat/issues/289)

## [1.15.3](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.15.2...v1.15.3) (2026-08-09)


### Bug Fixes

* **ci:** upgrade CodeQL Action to v4 ([#284](https://github.com/Yukihide-Mitsuoka/repchat/issues/284)) ([0a0dbe9](https://github.com/Yukihide-Mitsuoka/repchat/commit/0a0dbe928a0ab32b3de71b266a7de0d7782de415))
* **demo:** make Sankey paths auditable ([#285](https://github.com/Yukihide-Mitsuoka/repchat/issues/285)) ([e64129c](https://github.com/Yukihide-Mitsuoka/repchat/commit/e64129c93714736a93265cbbc3c0116b541c7b73)), closes [#283](https://github.com/Yukihide-Mitsuoka/repchat/issues/283)
* **inheritance:** classify RepChat sync contracts ([#288](https://github.com/Yukihide-Mitsuoka/repchat/issues/288)) ([03d5081](https://github.com/Yukihide-Mitsuoka/repchat/commit/03d50811d6188b1f61be52c4a55db95b7546e2f9))

## [1.15.2](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.15.1...v1.15.2) (2026-08-08)


### Bug Fixes

* **demo:** accept bounded dashboard plan bodies ([#280](https://github.com/Yukihide-Mitsuoka/repchat/issues/280)) ([f052eef](https://github.com/Yukihide-Mitsuoka/repchat/commit/f052eef3022d6652511d5b31e0d2347d16135137))
* **demo:** accept recommended analysis plan ([#278](https://github.com/Yukihide-Mitsuoka/repchat/issues/278)) ([4bd2a41](https://github.com/Yukihide-Mitsuoka/repchat/commit/4bd2a41ea696099b9e0ccda082ba8e1b70ca0278))
* **demo:** constrain planner clarification fields ([#275](https://github.com/Yukihide-Mitsuoka/repchat/issues/275)) ([2ab8643](https://github.com/Yukihide-Mitsuoka/repchat/commit/2ab8643f3b1d8fb45e10aa212501fdf2bdc317c7))
* **demo:** restore result interaction feedback ([#282](https://github.com/Yukihide-Mitsuoka/repchat/issues/282)) ([1a9e09c](https://github.com/Yukihide-Mitsuoka/repchat/commit/1a9e09cd38ce36f3054514b33623a1805ce36f02))

## [1.15.1](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.15.0...v1.15.1) (2026-08-08)


### Bug Fixes

* **demo:** quote reserved Bitcoin hash identifiers ([#269](https://github.com/Yukihide-Mitsuoka/repchat/issues/269)) ([a0487f2](https://github.com/Yukihide-Mitsuoka/repchat/commit/a0487f21e48fd923b218041e8453af504d6c1a33))
* **demo:** validate collapsed Sankey transitions ([#272](https://github.com/Yukihide-Mitsuoka/repchat/issues/272)) ([4e3f621](https://github.com/Yukihide-Mitsuoka/repchat/commit/4e3f6214e14a8990eef65a4585e10de8f2c36b56))

## [1.15.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.14.0...v1.15.0) (2026-08-08)


### Features

* **demo:** show evidence-backed meeting report drafts ([#268](https://github.com/Yukihide-Mitsuoka/repchat/issues/268)) ([08c8050](https://github.com/Yukihide-Mitsuoka/repchat/commit/08c8050de98dfaa05b72c9cc9d5393a71cdc1d11))
* **demo:** validate evidence-backed meeting commentary ([#266](https://github.com/Yukihide-Mitsuoka/repchat/issues/266)) ([ad3daf9](https://github.com/Yukihide-Mitsuoka/repchat/commit/ad3daf9b399801c91c23ac5c7900811f70a00c8e))

## [1.14.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.13.1...v1.14.0) (2026-08-08)


### Features

* **demo:** add bounded Bitcoin nested schema profile ([#259](https://github.com/Yukihide-Mitsuoka/repchat/issues/259)) ([efe1f33](https://github.com/Yukihide-Mitsuoka/repchat/commit/efe1f3338eeb2e3b3f36140f368d91e71c21849c))
* **demo:** confirm AI analysis plan before dashboard build ([#263](https://github.com/Yukihide-Mitsuoka/repchat/issues/263)) ([76332c6](https://github.com/Yukihide-Mitsuoka/repchat/commit/76332c630f21081e19e128fb5e3e237c723f9b0f))
* **demo:** define reviewable analysis plan revisions ([#261](https://github.com/Yukihide-Mitsuoka/repchat/issues/261)) ([9976692](https://github.com/Yukihide-Mitsuoka/repchat/commit/9976692c6cadb3a618e29c595bbc45656d68114c))
* **demo:** highlight SQL and record organization context ([#256](https://github.com/Yukihide-Mitsuoka/repchat/issues/256)) ([e1c1990](https://github.com/Yukihide-Mitsuoka/repchat/commit/e1c1990cc6f876970c6ad2c068d8bf57e21255ba))

## [1.13.1](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.13.0...v1.13.1) (2026-08-02)


### Bug Fixes

* **release:** attach generated SBOM to GitHub Release ([#249](https://github.com/Yukihide-Mitsuoka/repchat/issues/249)) ([eac6134](https://github.com/Yukihide-Mitsuoka/repchat/commit/eac6134ba32274843de80e2a5abaa5a50c910e59)), closes [#248](https://github.com/Yukihide-Mitsuoka/repchat/issues/248)

## [1.13.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.12.2...v1.13.0) (2026-08-02)


### Features

* **demo:** orchestrate dashboard analyses ([#239](https://github.com/Yukihide-Mitsuoka/repchat/issues/239)) ([1096b98](https://github.com/Yukihide-Mitsuoka/repchat/commit/1096b982211df25b6283935661dbc2907433ad87))
* **demo:** render generated dashboards ([#240](https://github.com/Yukihide-Mitsuoka/repchat/issues/240)) ([7e65881](https://github.com/Yukihide-Mitsuoka/repchat/commit/7e6588121e559b649e114f03d654844fa650f271))


### Bug Fixes

* **ci:** call Scorecard directly ([#244](https://github.com/Yukihide-Mitsuoka/repchat/issues/244)) ([1eb0c65](https://github.com/Yukihide-Mitsuoka/repchat/commit/1eb0c65022d26c314ea10122f1e162bf0bd9e05d)), closes [#242](https://github.com/Yukihide-Mitsuoka/repchat/issues/242)
* **demo:** prepare live dependencies before startup ([#218](https://github.com/Yukihide-Mitsuoka/repchat/issues/218)) ([eb003c0](https://github.com/Yukihide-Mitsuoka/repchat/commit/eb003c0b83d86c365e65fa966b3a5db5391b07e8))
* **demo:** render bar chart labels safely ([#229](https://github.com/Yukihide-Mitsuoka/repchat/issues/229)) ([dd1d4e6](https://github.com/Yukihide-Mitsuoka/repchat/commit/dd1d4e65192d74f775a385ce27ad919bcfe5f4e6))
* **demo:** restore live page interactions ([#227](https://github.com/Yukihide-Mitsuoka/repchat/issues/227)) ([e50d1eb](https://github.com/Yukihide-Mitsuoka/repchat/commit/e50d1eb69926eaab165d0fbff19ed4be38b19d45))
* **demo:** Sankeyをページ種別ごとに色分けする ([#233](https://github.com/Yukihide-Mitsuoka/repchat/issues/233)) ([22c637e](https://github.com/Yukihide-Mitsuoka/repchat/commit/22c637e3ca0c1c39c67d71cb270d8077a0539168)), closes [#232](https://github.com/Yukihide-Mitsuoka/repchat/issues/232)
* **demo:** Sankey描画と月指定を修正する ([#231](https://github.com/Yukihide-Mitsuoka/repchat/issues/231)) ([311bf06](https://github.com/Yukihide-Mitsuoka/repchat/commit/311bf066373b4c2a447eda279f8167d5154dafd6)), closes [#230](https://github.com/Yukihide-Mitsuoka/repchat/issues/230)
* **demo:** show query result data ([#245](https://github.com/Yukihide-Mitsuoka/repchat/issues/245)) ([d9df59c](https://github.com/Yukihide-Mitsuoka/repchat/commit/d9df59ccecb7aabee34ff3f3ca5fbfa0e371b9fb))
* **governance:** accept foundation retired-identity guards ([#238](https://github.com/Yukihide-Mitsuoka/repchat/issues/238)) ([8363eb9](https://github.com/Yukihide-Mitsuoka/repchat/commit/8363eb9732a42877f93ac1faca05436a4b147c48))
* live demoのvenv判定と質問ごとの費用確認を修正 ([#225](https://github.com/Yukihide-Mitsuoka/repchat/issues/225)) ([b8c0d96](https://github.com/Yukihide-Mitsuoka/repchat/commit/b8c0d965818759981bd15c20fd264fe8ac974d80)), closes [#224](https://github.com/Yukihide-Mitsuoka/repchat/issues/224)

## [1.12.2](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.12.1...v1.12.2) (2026-08-01)


### Bug Fixes

* **inheritance:** inherit foundation bugfix skill ([#209](https://github.com/Yukihide-Mitsuoka/repchat/issues/209)) ([bf09690](https://github.com/Yukihide-Mitsuoka/repchat/commit/bf09690848e01bf4276c1cfa15e8dbbe49cbc1a8))

## [1.12.1](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.12.0...v1.12.1) (2026-08-01)


### Bug Fixes

* **identity:** complete active RepChat rename ([#205](https://github.com/Yukihide-Mitsuoka/repchat/issues/205)) ([5885d3d](https://github.com/Yukihide-Mitsuoka/repchat/commit/5885d3d6fab436df90630b4ebb48fc999dc4f7ec))
* **inheritance:** restore RepChat agent profile ([#203](https://github.com/Yukihide-Mitsuoka/repchat/issues/203)) ([f50e3b1](https://github.com/Yukihide-Mitsuoka/repchat/commit/f50e3b1a7a3c59fa55d8b7bf79c37821f03a89fd))

## [1.12.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.11.2...v1.12.0) (2026-07-30)


### Features

* **demo:** add live Japanese prompt flow ([#197](https://github.com/Yukihide-Mitsuoka/repchat/issues/197)) ([9509f72](https://github.com/Yukihide-Mitsuoka/repchat/commit/9509f720e3af25c452dcb981b3e8bbbc5b2fdbe9))

## [1.11.2](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.11.1...v1.11.2) (2026-07-30)


### Bug Fixes

* **demo:** normalize SQL indentation levels ([#191](https://github.com/Yukihide-Mitsuoka/repchat/issues/191)) ([a45ae5f](https://github.com/Yukihide-Mitsuoka/repchat/commit/a45ae5fe9fd34e63b668ca6bff2891e36a67c555))

## [1.11.1](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.11.0...v1.11.1) (2026-07-29)


### Bug Fixes

* **demo:** group aggregate data with each analysis ([#185](https://github.com/Yukihide-Mitsuoka/repchat/issues/185)) ([fc1b383](https://github.com/Yukihide-Mitsuoka/repchat/commit/fc1b3831758006f21bfc6506b01d049cc6d7da3a))

## [1.11.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.10.1...v1.11.0) (2026-07-29)


### Features

* **demo:** expose Japanese question generation trace ([#175](https://github.com/Yukihide-Mitsuoka/repchat/issues/175)) ([97fb3c4](https://github.com/Yukihide-Mitsuoka/repchat/commit/97fb3c46cc042bec3841a569d0ee19626c75a593)), closes [#173](https://github.com/Yukihide-Mitsuoka/repchat/issues/173) [#160](https://github.com/Yukihide-Mitsuoka/repchat/issues/160)

## [1.10.1](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.10.0...v1.10.1) (2026-07-29)


### Bug Fixes

* **ci:** authenticate foundation sync size exception ([#170](https://github.com/Yukihide-Mitsuoka/repchat/issues/170)) ([812f685](https://github.com/Yukihide-Mitsuoka/repchat/commit/812f685ba6b1c4076afc0dc27c3f94c383e370e5))
* **demo:** align Evidence plugins with dependencies ([#166](https://github.com/Yukihide-Mitsuoka/repchat/issues/166)) ([1376318](https://github.com/Yukihide-Mitsuoka/repchat/commit/137631804fc507c56eaedafb9609720af9a2032d))

## [1.10.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.9.1...v1.10.0) (2026-07-28)


### Features

* make the report demo one-command ([#156](https://github.com/Yukihide-Mitsuoka/repchat/issues/156)) ([8cf926d](https://github.com/Yukihide-Mitsuoka/repchat/commit/8cf926d3a10e637b7995d55a96168a43f5a99c8a))

## [1.9.1](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.9.0...v1.9.1) (2026-07-27)


### Bug Fixes

* **executor:** give the impersonation source cloud-platform scope ([#119](https://github.com/Yukihide-Mitsuoka/repchat/issues/119)) ([d041c1c](https://github.com/Yukihide-Mitsuoka/repchat/commit/d041c1cbef2b4a330ee318b45a38ee68e007b787))
* **gate:** log the cause when a request fails closed ([#118](https://github.com/Yukihide-Mitsuoka/repchat/issues/118)) ([6cc35bf](https://github.com/Yukihide-Mitsuoka/repchat/commit/6cc35bfebfd8cb187da1b9affd1c1179fd29eb96))
* **infra:** fail fast when Application Default Credentials are stale ([#113](https://github.com/Yukihide-Mitsuoka/repchat/issues/113)) ([db45a32](https://github.com/Yukihide-Mitsuoka/repchat/commit/db45a3225a8b56c2b5371d59d0041e7a80c0971f))
* **infra:** grant Cloud Build's service account the role it needs ([#111](https://github.com/Yukihide-Mitsuoka/repchat/issues/111)) ([685a3a7](https://github.com/Yukihide-Mitsuoka/repchat/commit/685a3a7c9fa0a03c39141aa020f346aaeb2b0c88))
* **spike:** make the live-e2e harness start from a cold result cache ([#121](https://github.com/Yukihide-Mitsuoka/repchat/issues/121)) ([74753e0](https://github.com/Yukihide-Mitsuoka/repchat/commit/74753e0e0185776da910124683ebb2a5c9127ad9))
* **spike:** valid uuids and no seeding on import in the live-e2e harness ([#117](https://github.com/Yukihide-Mitsuoka/repchat/issues/117)) ([7284d5e](https://github.com/Yukihide-Mitsuoka/repchat/commit/7284d5e92b25d85a6670849fbaba59f40f09bf50))

## [1.9.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.8.0...v1.9.0) (2026-07-26)


### Features

* **build:** container image for the two Node services (ADR-0012 T2) ([#108](https://github.com/Yukihide-Mitsuoka/repchat/issues/108)) ([abff444](https://github.com/Yukihide-Mitsuoka/repchat/commit/abff44413de40514b59df124f3c47f30c8e01293))
* **infra:** Terraform + make targets for one-command deploy and destroy (ADR-0012) ([#109](https://github.com/Yukihide-Mitsuoka/repchat/issues/109)) ([31731eb](https://github.com/Yukihide-Mitsuoka/repchat/commit/31731ebb221f0e7cecea366e353a35a5c1e613df))

## [1.8.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.7.0...v1.8.0) (2026-07-25)


### Features

* **main:** Node composition roots for the control-plane and executor services ([#101](https://github.com/Yukihide-Mitsuoka/repchat/issues/101)) ([536a66f](https://github.com/Yukihide-Mitsuoka/repchat/commit/536a66f4caf3b5268dec45409e3774f31cf155c6))

## [1.7.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.6.0...v1.7.0) (2026-07-25)


### Features

* **control-plane:** wire the D1 connection identity from the datasource row (ADR-0010 D1, PR-3) ([#97](https://github.com/Yukihide-Mitsuoka/repchat/issues/97)) ([2fa7542](https://github.com/Yukihide-Mitsuoka/repchat/commit/2fa7542e6fb83cc10b9c8f5b55916d49462b7f8a))
* **gate:** wire the control-plane SEAM in worker.ts (PR-B) ([#100](https://github.com/Yukihide-Mitsuoka/repchat/issues/100)) ([add46c8](https://github.com/Yukihide-Mitsuoka/repchat/commit/add46c88d0581667c5d8f09632c1a90181c8d879))
* **gate:** Workers-compatible control-plane transport (mirrors [#65](https://github.com/Yukihide-Mitsuoka/repchat/issues/65)) ([#99](https://github.com/Yukihide-Mitsuoka/repchat/issues/99)) ([01a563f](https://github.com/Yukihide-Mitsuoka/repchat/commit/01a563f9303d3e318c47860875c66600b2b5f483))

## [1.6.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.5.0...v1.6.0) (2026-07-24)


### Features

* **executor:** impersonating token provider + live D1 backstop proof (ADR-0010 D1, PR-2) ([#95](https://github.com/Yukihide-Mitsuoka/repchat/issues/95)) ([cdbca02](https://github.com/Yukihide-Mitsuoka/repchat/commit/cdbca02221bbd7e0b0a4074e141bde865e4b16b6))
* **executor:** thread a per-tenant connection identity to the runner (ADR-0010 D1, seam) ([#93](https://github.com/Yukihide-Mitsuoka/repchat/issues/93)) ([88ee98e](https://github.com/Yukihide-Mitsuoka/repchat/commit/88ee98efea17c2986d8036cefac66f8eb2f00c5c))

## [1.5.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.4.0...v1.5.0) (2026-07-24)


### Features

* **executor:** verify the row scope binds at every use, and refuse an undeclared policy ([#89](https://github.com/Yukihide-Mitsuoka/repchat/issues/89)) ([91345d6](https://github.com/Yukihide-Mitsuoka/repchat/commit/91345d6625fa2b6abbb576b301c8e7fd7aea8204))

## [1.4.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.3.2...v1.4.0) (2026-07-23)


### Features

* **control-plane:** Postgres adapters for the gate and executor ports ([#85](https://github.com/Yukihide-Mitsuoka/repchat/issues/85)) ([681b331](https://github.com/Yukihide-Mitsuoka/repchat/commit/681b331c1ea01570496de634b55f7868943bd824))

## [1.3.2](https://github.com/Yukihide-Mitsuoka/chat-chart/compare/v1.3.1...v1.3.2) (2026-07-23)


### Bug Fixes

* **security:** configure CodeQL language matrix ([#78](https://github.com/Yukihide-Mitsuoka/chat-chart/issues/78)) ([caf389c](https://github.com/Yukihide-Mitsuoka/chat-chart/commit/caf389cc1cb06a4d41bc84579a22ca6e69ec2227))
* **sync:** keep PR body inside workflow script ([#76](https://github.com/Yukihide-Mitsuoka/chat-chart/issues/76)) ([20aa8c0](https://github.com/Yukihide-Mitsuoka/chat-chart/commit/20aa8c02bbb1644d8d088545926f7cf63de1fbc1))

## [1.3.1](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.3.0...v1.3.1) (2026-07-22)


### Bug Fixes

* **governance:** adopt ruleset-only discovery ([#71](https://github.com/Yukihide-Mitsuoka/repchat/issues/71)) ([48d147a](https://github.com/Yukihide-Mitsuoka/repchat/commit/48d147a81d8210cf025e896c8787c3f5603195a9))
* **sync:** adopt safe parent propagation ([#69](https://github.com/Yukihide-Mitsuoka/repchat/issues/69)) ([697bd66](https://github.com/Yukihide-Mitsuoka/repchat/commit/697bd662c21964488fc99f0f39e50586d1701a89))

## [1.3.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.2.0...v1.3.0) (2026-07-20)


### Features

* **executor:** HTTP transport between gate and executor ([#65](https://github.com/Yukihide-Mitsuoka/repchat/issues/65)) ([#66](https://github.com/Yukihide-Mitsuoka/repchat/issues/66)) ([3a145b0](https://github.com/Yukihide-Mitsuoka/repchat/commit/3a145b049349123983dc36453582fe3a461e1e41))
* **gate:** wire the executor SEAM to the real executor ([#55](https://github.com/Yukihide-Mitsuoka/repchat/issues/55) A-3) ([#63](https://github.com/Yukihide-Mitsuoka/repchat/issues/63)) ([55bbda4](https://github.com/Yukihide-Mitsuoka/repchat/commit/55bbda4f3f76fac1e7171a4a135e634285196959))

## [1.2.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.1.0...v1.2.0) (2026-07-20)


### Features

* **executor:** BigQuery query runner over the REST jobs.query endpoint ([#59](https://github.com/Yukihide-Mitsuoka/repchat/issues/59)) ([01f50b5](https://github.com/Yukihide-Mitsuoka/repchat/commit/01f50b564ee36ed868ecb89f5e0426fabaf66cbc)), closes [#55](https://github.com/Yukihide-Mitsuoka/repchat/issues/55)

## [1.1.0](https://github.com/Yukihide-Mitsuoka/repchat/compare/v1.0.0...v1.1.0) (2026-07-19)


### Features

* **executor:** AST-level tenant-boundary binding for SQL queries ([#56](https://github.com/Yukihide-Mitsuoka/repchat/issues/56)) ([6ad2547](https://github.com/Yukihide-Mitsuoka/repchat/commit/6ad25471525af449083948bd627fee66026ae554)), closes [#55](https://github.com/Yukihide-Mitsuoka/repchat/issues/55)
* **executor:** execute use case with binding resolution and audit ([#58](https://github.com/Yukihide-Mitsuoka/repchat/issues/58)) ([a0435b7](https://github.com/Yukihide-Mitsuoka/repchat/commit/a0435b78433c11812fad3b40573a0e4d52ef4a2f)), closes [#55](https://github.com/Yukihide-Mitsuoka/repchat/issues/55)

## 1.0.0 (2026-07-19)


### Features

* **gate:** Cloudflare Workers interface — KV adapter, fetch handler, entry ([01848c8](https://github.com/Yukihide-Mitsuoka/repchat/commit/01848c800a9103cad9cbc997045cd01bc7b6409c))
* **gate:** Cloudflare Workers interface — KV adapter, fetch handler, entry ([8a2daf5](https://github.com/Yukihide-Mitsuoka/repchat/commit/8a2daf5acdb07b2c74f0ddbd331fdff7f16218d3)), closes [#23](https://github.com/Yukihide-Mitsuoka/repchat/issues/23)
* **gate:** in-memory + WebCrypto adapters and the ported acceptance suite ([39af2f6](https://github.com/Yukihide-Mitsuoka/repchat/commit/39af2f6969bc64eab6eed42abdc810025eeca5cc))
* **gate:** in-memory + WebCrypto adapters and the ported acceptance suite ([04a0550](https://github.com/Yukihide-Mitsuoka/repchat/commit/04a05500e70a63bee798fbcebbc891faf8ea8029)), closes [#23](https://github.com/Yukihide-Mitsuoka/repchat/issues/23)
* **gate:** runtime-agnostic gate core — domain + application layers ([28669c6](https://github.com/Yukihide-Mitsuoka/repchat/commit/28669c65cbbaa4416827c351277bbf579ba32bcc))
* **gate:** runtime-agnostic gate core — domain + application layers ([e6b34cd](https://github.com/Yukihide-Mitsuoka/repchat/commit/e6b34cdc74382339c5776693c75f9f8e4dfc834a)), closes [#23](https://github.com/Yukihide-Mitsuoka/repchat/issues/23)


### Bug Fixes

* satisfy CI — untrack package-lock.json, fix broken settings link ([70675fd](https://github.com/Yukihide-Mitsuoka/repchat/commit/70675fd5a42799d9505b2c03d9d428703548ceb8))
* **sync:** authenticate foundation documentation propagation ([#38](https://github.com/Yukihide-Mitsuoka/repchat/issues/38)) ([3eba6c7](https://github.com/Yukihide-Mitsuoka/repchat/commit/3eba6c70d59857ece4d79d5a5c493aab7e335140))
* **template-sync:** protect downstream workflow ownership ([#31](https://github.com/Yukihide-Mitsuoka/repchat/issues/31)) ([f14e1ab](https://github.com/Yukihide-Mitsuoka/repchat/commit/f14e1aba739cb9660ec5bbd364d8611884f1d29a))
