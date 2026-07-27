# Changelog

## 1.0.0 (2026-07-26)


### ⚠ BREAKING CHANGES

* **requirements:** downstream references to `docs/requirements/README.md` or `docs/templates/` must use the new `docs/foundation/` paths. Existing downstream repositories must append the documented `.templatesyncignore` exception once before running Template Sync.
* **governance:** `scripts/setup-github.sh` requires an explicit repository target; apply also requires the same value after `--confirm-repo`.

### Features

* **catalog:** add worked example module (Clean Architecture + DDD) ([#3](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/3)) ([ae20e80](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/ae20e80459075fa0dbe6ccd461663f27f2d4bc79))
* **claude:** add read-only code-reviewer subagent ([#12](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/12)) ([d5236aa](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/d5236aaaacfc7d210616263da5215510f5a88df3))
* **governance:** add deterministic state comparison ([#23](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/23)) ([2be91ac](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/2be91acb0c51ba77c7140e3167282e4b4eb2bf4a))
* **governance:** add inherited policy validation ([#21](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/21)) ([8035bbb](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/8035bbbf28c2ea1f84e7e5bfe90fb858c5370daf))
* **governance:** add read-only GitHub discovery ([#22](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/22)) ([dd04113](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/dd04113cc244e4714156e8c95658eb7204d610e8))
* **governance:** add template profile chain ([#37](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/37)) ([9ab0600](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/9ab06004ed129d0d27e4a1876aa03b04d067cc71))
* **governance:** add verified apply execution boundary ([#27](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/27)) ([67d1596](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/67d159630daa70d71c5ebb01b4200a394e4b11c4))
* **governance:** adopt solo-friendly defaults ([#34](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/34)) ([5632f8d](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/5632f8d81e3c6e2697d129e38c4113cdbd94874c))
* **governance:** enforce vulnerability intake controls ([#29](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/29)) ([d4c284c](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/d4c284c263b7a5b27034288b46558850c79913ae))
* **governance:** expose confirmed apply command ([#28](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/28)) ([70ea07a](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/70ea07add78ea3a80e75d790cb08e6dd43977111))
* **governance:** expose plan and audit commands ([#24](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/24)) ([86b3f4b](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/86b3f4bb0ef55fe658f1294de38bca85118d7b6c))
* **governance:** migrate setup to policy wrapper ([#31](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/31)) ([91276b9](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/91276b970805c550ee3d3fc929f0f0980af15681))
* **governance:** model repository collaboration settings ([#30](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/30)) ([cce70e4](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/cce70e4d4f8ad7695dbbc70e2f162200d83bc2e0))
* **governance:** plan deterministic apply actions ([#25](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/25)) ([9411ad6](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/9411ad67e2e5254c18cc1480da2db64d812c9ab0))
* **governance:** preserve stricter ruleset constraints ([#26](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/26)) ([64f6fc8](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/64f6fc82de3f7269a96ac534dde8c7ef9093b124))
* **inheritance:** plan next parent commit ([#36](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/36)) ([1e99d39](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/1e99d395ff949a40d45d888f59a6da41fc86e502)), closes [#32](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/32)
* **inheritance:** validate child-owned contract ([#35](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/35)) ([4035dbd](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/4035dbd0e3e7cca1300f1c2f8e49967e60940022))
* **skills:** interrogation phase in requirements + native skill wrappers ([#9](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/9)) ([d4df453](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/d4df4534107070f98dd581d4063ceeff60df9802))


### Bug Fixes

* **docs:** make foundation checks portable ([#52](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/52)) ([a177d1f](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/a177d1f694d6e754588c0753fb6ddf188753a8ea)), closes [#51](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/51)
* **governance:** recognize ruleset-only protection ([#57](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/57)) ([01eb97c](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/01eb97c6a7fd8106bada2be835803b49f56dce10))
* **hooks:** exempt explicit floating-tag moves from GR-011 force-push block ([#16](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/16)) ([7012f04](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/7012f04f57aa62ae678e28aceffbf19b3bd63848))
* **profiles:** restore terraform-gcp clean/doctor targets ([#5](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/5)) ([4af937c](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/4af937c84e1f17996207eca3bc16ba4d19cf8b43))
* resolve audit findings in guardrails, Makefiles, and CI config ([53d7910](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/53d7910dc4f696a76c45256e41d1c98d91bec7bc))
* **security:** configure CodeQL language matrix ([#64](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/64)) ([0c6d140](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/0c6d140a5247d4a8cfc348da4a56074291346ead))
* **sync:** enforce reviewed parent propagation ([#54](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/54)) ([ebd069d](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/ebd069de322ae6dd36d72ffd561fda249363dfd2))
* **sync:** keep PR body inside workflow script ([#62](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/62)) ([937baa4](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/937baa4e04d0bbe451c8bf04f5619db8bd3f5db0))
* **sync:** validate child contract in doctor ([#55](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/55)) ([86eb924](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/86eb9243a5ea1d1696588bceb1573afdfe182ce9))
* **template-sync:** use pathspec docs exclusions ([#50](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/50)) ([d9419c8](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/d9419c87133eb8d97d930aea98889224c2253a68))


### Documentation

* **requirements:** separate foundation-owned artifacts ([#40](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/issues/40)) ([2c80552](https://github.com/Yukihide-Mitsuoka/ai-dev-foundation/commit/2c8055200e39d8eb3c77ee12261700b67ba546f1))
