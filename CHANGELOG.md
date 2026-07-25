# Changelog

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
