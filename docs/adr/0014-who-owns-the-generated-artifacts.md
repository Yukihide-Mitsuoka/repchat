# ADR-0014: 生成物と定義の所有 — 3種類に分けて決める

| Field | Value |
|-------|-------|
| Status | accepted |
| Date | 2026-07-28 |
| Deciders | repository owner |
| Author | Claude (AI agent) |
| Supersedes / Superseded by | — |

<!--
  Note (repo governance): ADR-0002 requires English for docs/adr content. Kept in
  Japanese under the LOG-0020 owner-approved exception (as ADR-0005 / ADR-0006 /
  ADR-0010 / ADR-0011 / ADR-0012 / ADR-0013), because the deciding audience is the
  Japanese-speaking owner.

  G1/G4 はオーナーが著者の推奨どおり承認。**G2 はオーナーの判断で覆った**（2026-07-28）。
  経緯は §「オーナーの決定」に残してある。

  Revision (2026-07-29): 顧客所有の方針は維持し、ADR-0015で配送方式を具体化した。
  「顧客repositoryだけでEvidenceが動く」という不正確な記述、接続情報の境界、
  GitHub接続・build・有効化・fallbackの未決を訂正した。

  Revision (2026-07-29): G2のEvidenceページSQL例を、生成結果の必要列を明示する形へ訂正した。
  生成物の所有・配置に関する決定は変更していない。
-->

## Context（強制する問題）

[ADR-0013](0013-metric-definitions-live-in-our-own-layer.md) C7 が意図的に先送りした唯一の論点。
[positioning.md](../positioning.md) §2.9 が提起した衝突がそのまま残っている。

> **「解約しても資産が顧客に残る」**は売り文句になる。しかし顧客のGitに置くなら
> **顧客側にリポジトリとPRを理解する人が要り**、「非エンジニアでも使える」と正面から衝突する。

### 強制する力

- **観測された痛み**（LOG-0064）: Looker Studio で**接続した人・作成した人が辞めると資産が失われる**。
  これが構想の出発点であり、**この痛みを解けなければ売り文句が成立しない**。
- **対象顧客**（positioning §0）: 「DWHにデータがあり、技術者が1人いて、データ専任者はいない会社」。
  **Git を日常的に使う前提を置けない。**
- **LOG-0073**: 生成物は**2種類**に分かれることが実測で判明した
  （`sources/<name>/*.sql` ＝ウェアハウスSQL、`pages/*.md` ＝ページ）。
- **LOG-0071**: 指標定義と別名は**GA4の語彙であり、顧客数に比例しない** ——
  標準化されたデータソースでは**顧客間で使い回せる**。
- **ADR-0010 D3**: 保守が顧客数に比例してはならない。

## Decision

### G1. これは「1つの置き場所を選ぶ」問題ではない

生成物と定義は**3種類あり、性質が違う**。同じ場所に置く必然性がない。

| | 中身 | 誰のものか |
|---|---|---|
| **ページ** | レポートの markdown | **顧客の成果物**。解約後も価値が残るのはここ |
| **ソース定義** | ウェアハウスSQL | 顧客のスキーマに依存する。接続構成に近い |
| **指標定義** | 指標・別名・出力形状 | **代理店が書き、顧客間で使い回す** |

**この3分割はオーナーが承認した**（2026-07-28）。G2〜G4 は分割を前提にした個別の決定。

### G2. ページとソース定義は、既定で**顧客のリポジトリ**に置く。ただし**顧客はGitを操作しない**

**所有と操作を分ける** —— リポジトリは顧客のもの、書き込むのはこちら。この点だけが
LookMLのGit連携と共通する。RepChatは生成済みのページとSQLを配送するため、LookMLの
モデル開発・branch運用と同一の仕組みではない。

LOG-0073の分離により、`sources/*.sql`には具体的なウェアハウスSQLが入り、ページは
`select <必要列> from ga4.<id>`でそれを読む。列指向処理で不要列を読まず、生成結果の列契約を
明示するため、ウェアハウスSQLとページSQLの双方で`SELECT *`を使わない。指標定義は生成時の入力であり、
生成後の実行時依存ではない。
ただし、**ページとSQLだけではEvidenceアプリとして単独実行できない。** 固定されたrendererと
依存関係が別途必要である。顧客repositoryに置くのは
[ADR-0015](0015-publish-artifacts-through-customer-git.md)のArtifactBundleであり、
**固定rendererと組み合わせて再構築できる顧客成果物**と表現する。

repositoryを持たない顧客にはmanaged fallbackを用意する。fallbackは別の生成・build・配信実装ではなく、
同じArtifactBundleとpipelineの保存先adapterだけを変える。

> **著者は当初「既定はこちらでホスト」を推奨したが、オーナーの判断で覆った。** 著者の反対理由は
> 「顧客側にリポジトリと **PR を理解する人**が要る」だったが、**それは操作を顧客にやらせる場合の話**で、
> 所有と操作を分ければ消える。**残る前提条件は「リポジトリとアプリ権限の付与」＝IT承認1回**であって、
> **技能の要求ではない**。著者は前提条件の中身を取り違えていた。

**残る代償（消えたわけではない）**:

- **buildが顧客リポジトリの到達性に依存する。** App削除・権限失効・repository削除で新規生成が止まる。
  閲覧経路はGitを参照せず、直前の成功版を配信し続ける
- **GitHub App連携が実装として要る。** 選択repository、短期installation token、commit API、
  外部変更を扱う場合のwebhookが必要
- 顧客Gitとmanaged fallbackの2保存先を持つ。ただし生成から有効化までのpipelineは1本にする
- 初期既定はApp管理branchへの直接commitとする。PR modeは実需が出た時点で、
  追加権限と運用負荷を再評価して導入する

### G3. ソース定義はページと同じ場所に置く

顧客のスキーマに依存し、ページと1対1で対応する（LOG-0073 の分離）。
**別々の場所に置くと、片方だけ古くなる**。

### G4. 指標定義はこちら側に置く

**顧客のGitに置いてはならない。** 置くと、指標を1つ足すたびに**代理店が全顧客分を更新して回る**ことになり、
**LOG-0071 で「顧客数に比例しない」と実測した利点を自分で捨てる**。これは
[ADR-0010](0010-connection-identity-is-never-a-person.md) D3 が禁じた形。

**顧客固有の指標**（その会社にしかない業務指標）だけは顧客側に置ける。
ただし**その分だけ保守が顧客数に比例する**ので、**例外であって既定ではない**。

### G5. 「取り戻せる」は、実装で担保する

**既定の経路では、ページ、SQL、manifestが最初から顧客側にある。** これらは固定rendererと
組み合わせて再構築できるが、repository単独で動作するとは保証しない。renderer versionをmanifestへ
記録し、再構築手順を提供する。**担保が要るのはmanaged fallbackだけ**で、そちらは同じArtifactBundleを
いつでも書き出せることを機能として持つ。契約終了時の扱いは
[status.md](../status.md) の「顧客向け要素（撤退時データ削除）」と同じ論点で、**そちらと一緒に設計する**。

### G6. 秘密は生成物に入れない

ページ、SQL、manifestへcredential、token、service account keyを含めない。SQLに含まれる顧客の
project・dataset・table名は顧客成果物の一部であり、credentialではない。接続主体と実行projectは
control planeの`datasources`から一時build workspaceまたはexecutorへ注入する。
スパイクが生成する`connection.yaml`はローカルデモ用であり、顧客repositoryへpublishする
ArtifactBundleには含めない。詳細はADR-0015 D2。

## Consequences

**得るもの。** **「生成したページとSQLはあなたのリポジトリにあります」と言える。**
指標定義の保守は顧客数に比例しない。ページと対応するSQLが同じcommitにあり、片方だけ古くならない。
managed fallbackがあるため、repositoryを持たない顧客も受け入れられる。

**失うもの。** GitHub App、repository接続状態、build queue、last-known-goodの運用が増える。
オンボーディングにIT承認が1回入り、Contents権限は選択repository全体に及ぶ。

**倒れる方向（D6）。** 顧客repositoryが到達不能になると新規生成を止める。閲覧経路はGitを
参照せず、直前に成功したシェルとquery catalogを配信し続ける。managed fallbackでは
ArtifactBundleの書き出しが動くことを定期確認する。

## オーナーの決定（2026-07-28）

| | 決定 | 備考 |
|---|---|---|
| **G1（3分割）** | **承認** | 著者の推奨どおり |
| **G2（置き場所）** | **顧客のリポジトリを既定にする。ただし顧客はGitを操作しない** | 著者の推奨を覆した。Git接続・build・有効化は2026-07-29承認のADR-0015で具体化 |
| **G4（顧客固有指標の例外）** | **認める** | 著者の推奨どおり。**例外であって既定ではない** |

## 検討した代替案

**全部（指標定義も含めて）を顧客のGitに置く。** 訴求は最強だが、**指標定義まで顧客側に行くと D3 に反する**
（G4）。**ページとソース定義だけを顧客側に置く**という形で、訴求はほぼ保ったまま比例問題を避けられる。

**全部をこちらに置き、書き出しも提供しない。** 最も安く作れるが、
**LOG-0064 の痛みを解かない**ので、そもそもの売り文句が消える。

**3分割せず「生成物」として一括で扱う。** 単純だが、**指標定義とページを同列に置くことになり**、
G4 の比例問題を避けられない。

## 参照

- [ADR-0013](0013-metric-definitions-live-in-our-own-layer.md) C7（本ADRが引き取った論点）
- [ADR-0015](0015-publish-artifacts-through-customer-git.md)（GitHub接続・build・有効化）
- [ADR-0010](0010-connection-identity-is-never-a-person.md) D1 / D3 / D6
- [positioning.md](../positioning.md) §0 / §2.9
- LOG-0064（観測された痛み）、LOG-0071（定義は顧客数に比例しない）、LOG-0073（生成物は2種類）
