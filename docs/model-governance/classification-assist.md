# SPI-13 — 分類 Annotation Assist Model C7 監査記録

> **厳格な fail-closed research record / 法的助言ではない**
> 本記録は公開資料を技術的に整理したものであり、利用許諾、法的判断、採用承認ではない。C5 コード、C7 checkpoint、C8 学習データは独立して判定する。`unknown`、`MISSING`、`NOT_RUN`、承認者不在のいずれか一つでも残る限り、checkpoint を同梱、既定選択、SBOM 登録、manifest 登録してはならない。

## 0. 記録メタデータと結論

| 項目 | 値 |
|---|---|
| タスク | SPI-13 — Classification assist checkpoint 監査 |
| 審査対象 | Google SigLIP base patch16-224 / OpenAI CLIP |
| カテゴリー | C7（Annotation Assist Model checkpoint）/ C5（構造コード）/ C8（学習元データ）を独立審査 |
| タスク種別 | 画像分類（top-k annotation assist） |
| 記録ファイル名 | `docs/model-governance/classification-assist.md` |
| 対象製品用途 | 初回 Classification Project で、既存 Label Schema の text label を画像ごとに順位付けし、上位 3 件までを人が確認する候補として表示するローカル・商用・オフライン配布機能 |
| 調査日・URL 参照日 | **2026-09-03** |
| 記録作成者 | GitHub Copilot（技術調査のみ。承認権限なし） |
| 法務または repository license decision authority の署名 | **なし / 承認者未指定** |
| 承認日 | **なし** |
| 法務確認 | **必須 / 未開始** |
| SigLIP 最終判定 | **HOLD（保留）** |
| OpenAI CLIP 最終判定 | **REJECT（本製品の同梱候補から除外）** |
| 承認済み Classification C7 件数 | **0** |
| G-DEP-08 | **BLOCKED** |
| Gate 2 | **BLOCKED** |
| `resources/models/manifest.json` | **未編集**。調査時点の `models` は空配列であり、本記録を根拠に追加してはならない |
| checkpoint binary download | **未実施** |
| モデル実行・変換・品質試験 | **未実施（NOT_RUN）** |

### 0.1 候補別判定

| 候補 | 厳密な対象 | 判定 | 主な停止理由 |
|---|---|---|---|
| Google SigLIP base patch16-224 | `google/siglip-base-patch16-224@7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed` の `model.safetensors` | **HOLD** | Big Vision 原版 NPZ との provenance・tensor equivalence が未証明。WebLI の完全な由来、画像権利、商用利用、派生 checkpoint の再配布、帰属条件が未確定。一次資料保存 hash、NOTICE packet、法務承認、技術・品質・セキュリティ試験も未完 |
| Big Vision SigLIP B/16 224 原版参照 | `gs://big_vision/siglip/webli_en_b16_224_63724782.npz` | **HOLD / 選定 artifact ではない** | byte size と GCS object metadata は確認済み。完全 SHA-256、immutable provenance packet、HF safetensors との等価性が `MISSING` |
| OpenAI CLIP | exact checkpoint は未選定 | **REJECT** | 公式 model card が commercial/non-commercial を問わず deployed use を out-of-scope と明記する。MIT のコードライセンスはこの用途制限を解消しない（FR-LIC-015） |

「HOLD」「REJECT」は AutoVision Studio の現行 C7 gate に対する判断であり、第三者一般の利用について合法・違法を判断するものではない。

## 1. 基本識別情報（FR-LIC-004/014）

### 1.1 SigLIP — 評価対象 HF artifact

| 項目 | 値 |
|---|---|
| 正式名称 | SigLIP base-sized model, patch16, resolution 224 |
| Hugging Face repository | `google/siglip-base-patch16-224` |
| 固定 revision | `7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed` |
| 取得元 URL | `https://huggingface.co/google/siglip-base-patch16-224/resolve/7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed/model.safetensors` |
| 取得日 | **MISSING**。binary は取得していない |
| checkpoint ファイル名 | `model.safetensors` |
| checkpoint ファイルサイズ | `812,672,320` bytes（HF fixed-revision API の LFS metadata） |
| checkpoint SHA-256 | `2c63cb7d1f2e95ba501893cbb8faeb4ea9a3af295498d35097126228659c2af8`（HF fixed-revision API の `lfs.sha256`。本調査で binary から再計算していない） |
| HF Git blob ID | `b5e2d7feb2f7cf3a5f4a2c52b0ba036e828edf3b`。**SHA-256 として使用しない** |
| local artifact path | **MISSING** |

### 1.2 Big Vision 原版参照との分離

| 項目 | 値 |
|---|---|
| 公開 notebook の B/16 224 mapping | `B/16`, resolution `224` はcomment化された選択肢としてfilename mappingに存在する。取得時のactive cell既定は `L/16`, resolution `384` であり、B/16 224をnotebook既定とは扱わない |
| 原版 filename | `webli_en_b16_224_63724782.npz` |
| 原版 location | `gs://big_vision/siglip/webli_en_b16_224_63724782.npz` |
| HTTPS object URL | `https://storage.googleapis.com/big_vision/siglip/webli_en_b16_224_63724782.npz` |
| 原版 byte size | `755,347,453` bytes（2026-09-03 の GCS object HEAD。body は取得していない） |
| 原版完全 SHA-256 | **unknown / MISSING** |
| 原版 object generation/version metadata | generation `1695890666856926`、metageneration `1`、Last-Modified `2023-09-28T08:44:26Z`、storage class `STANDARD` |
| 原版の非 SHA-256 integrity metadata | ETag `"087d251b0c88018b67e4a2608840552e"`、CRC32C `6VYkJg==`、MD5 `CH0lGwyIAYtn5KJgiEBVLg==`。いずれも完全 SHA-256 の代替にしない |
| 原版 NPZ と HF `model.safetensors` の provenance | **unknown / MISSING** |
| tensor 名・shape・dtype・値の equivalence | **NOT_RUN / publisher statement MISSING** |

HF artifact の既知 size/hash を Big Vision NPZ へ流用しない。ファイル名、形式、保存場所が異なり、両 artifact が同一 tensor 内容であるとの一次資料は、review した資料内では確認できなかった。

### 1.3 OpenAI CLIP

| 項目 | 値 |
|---|---|
| 正式名称 | CLIP |
| code repository | `https://github.com/openai/CLIP` |
| 調査用固定 code revision | `d05afc436d78f1c48dc0dbf8e5980a9d471f35f6` |
| 製品採用 code revision | **MISSING / 未選定** |
| exact checkpoint/version | **MISSING / 未選定** |
| checkpoint URL・filename・size・SHA-256 | **MISSING** |
| artifact download | **NOT_RUN** |
| 除外根拠 | exact checkpoint の選定前に、公式 model card の deployed-use exclusion が本製品用途と衝突するため |

## 2. コード層審査（C5）— アーキテクチャ定義コードのライセンス

| 候補 | コード根拠 | revision | ライセンス信号 | 商用利用・再配布の確認 | NOTICE | 用途制限 | 判定 |
|---|---|---|---|---|---|---|---|
| SigLIP / Big Vision | `https://github.com/google-research/big_vision` | 調査用固定 commit `0127fb6b337ee2a27bf4e54dea79cff176527356`。製品採用 revision は **MISSING** | 固定 README と LICENSE は、明示例外がない codebase・models・colabs に Apache-2.0 を示す | C5 code の Apache-2.0 条件は確認したが、製品で使う exact code revision・依存・配布 packet は未確定 | final NOTICE inventory **MISSING** | demo は research purposes と説明。契約上の追加制限かは本記録で断定しない | **確認中** |
| SigLIP / Transformers 経路 | HF 固定 config と Transformers の native `siglip` mapping | 調査用 `v4.44.2` / commit `174890280b340b89c5bfa092f6b4fb0e2dc2d7fc`。製品 package/lock は **MISSING** | Apache-2.0。固定 HF config は `model_type: siglip` / `SiglipModel` で `auto_map` を持たず、固定 Transformers source は `SiglipConfig` / `SiglipModel` の native mapping を持つ | model repository の custom remote code を要求しない静的候補経路は確認。製品 local-only load、依存 lock、実行は **NOT_RUN** | final NOTICE inventory **MISSING** | C5 code signal を C7/C8 へ拡張しない | **確認中** |
| OpenAI CLIP | `https://github.com/openai/CLIP` | 調査用固定 commit `d05afc436d78f1c48dc0dbf8e5980a9d471f35f6`。製品採用 revision は **MISSING** | 固定 repository code は MIT | code 層だけの permissive signal | final notice text **MISSING** | code license とは別に model card が deployed use を除外 | **code signal のみ。C7 は REJECT** |

コードの Apache-2.0 / MIT を checkpoint または training data の許可へ拡張しない。製品実装で実際に使う code path と exact revision が未確定のため、C5 も最終適合ではない。

## 3. Checkpoint 層審査（C7）— 重みファイル自体のライセンス

### 3.1 SigLIP

| 項目 | 値 |
|---|---|
| 対象 checkpoint | HF fixed revision の `model.safetensors`（§1.1） |
| checkpoint license signal | HF metadata は `apache-2.0`。Big Vision README は、明示例外がない models を含め Apache-2.0 と説明 |
| license 根拠 URL | §7 の HF model API、HF model card、Big Vision README、Big Vision LICENSE |
| model card の作成主体 | **Hugging Face team**。card 自身が「SigLIP release team はこの card を書いていない」と明記する |
| HF namespace から推定できる権利主体 | **推定しない**。`google` namespace だけでは exact bytes の著作権者・許諾者を確定しない |
| Big Vision 原版との chain of custody | **unknown / MISSING** |
| Apache-2.0 が exact HF bytes に適用される publisher statement | **MISSING** |
| 商用利用の明示確認 | **unknown**。一般的な Apache-2.0 表示だけで exact HF artifact と C8 を含む製品利用を承認しない |
| installer 再配布 | **unknown / 未承認** |
| Fine-Tuning・ONNX 変換等の条件 | Apache-2.0 の変更表示等が候補だが、exact artifact への適用と C8 を含む最終条件は **unknown** |
| NOTICE / attribution | final packet **MISSING** |
| 研究目的の記述 | Big Vision demo は models を research purposes のために学習・公開したと記載。これを自動的に法的制限とも、制限なしとも判定しない |
| 判定（checkpoint 層） | **HOLD / 確認中** |

### 3.2 OpenAI CLIP

| 項目 | 値 |
|---|---|
| exact checkpoint | **MISSING / 未選定** |
| checkpoint 固有 license | **unknown** |
| 商用利用・再配布・変更・NOTICE | **unknown** |
| 独立した停止理由 | 公式 model card が deployed use を out-of-scope とする |
| 判定（checkpoint 層） | **REJECT**。code の MIT は判定を変更しない |

## 4. 学習データ由来審査（C8）— データセットと terms（FR-LIC-004/014）

### 4.1 公開資料で特定できた範囲

| # | 候補 | 公開資料で確認できた学習元 | dataset terms URL | terms 取得日 | 商用利用 | 再配布条件 | 帰属表示 | 完全性 | 判定 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | SigLIP | HF team 作成 card は WebLI の English image-text pairs を記載し、Big Vision の原版 filename は `webli_en` を含む | **MISSING**。§7 の PaLI paper は dataset 概要であり terms ではない | **MISSING** | **unknown** | **unknown** | **unknown** | exact SigLIP snapshot、件数、filter、全 source URL、全画像・text の権利 chain、除外後 inventory が **MISSING** | **確認中 / BLOCKED** |
| 2 | SigLIP | PaLI/WebLI paper が説明する一般 corpus は public web page 由来の約 100 億画像、120 億 alt-text、109 言語。PaLI が使った上位 10%（約 10 億例）を SigLIP B/16 224 の exact corpus として転用しない | **MISSING** | **MISSING** | **unknown** | **unknown** | **unknown** | WebLI を構成する個別 source、SigLIP 用 subset と item manifest は全件列挙不能 | **確認中 / BLOCKED** |
| 3 | CLIP | publicly available image-caption data、internet crawl、既存 dataset の一例として YFCC100M | **MISSING / 全 source inventory なし** | **MISSING** | **unknown** | **unknown** | **unknown** | model card は training dataset を公開しないと記載 | **BLOCKED。別理由でも REJECT** |

WebLI paper が規模や作成法を説明することは、各画像・text の著作権、取得時 terms、commercial training、派生 weight の商用利用・再配布、installer 同梱、必要 attribution の許可を証明しない。公開アクセス可能であることも再配布許可を意味しない。

### 4.2 ImageNet / COCO 由来

| 項目 | SigLIP | CLIP |
|---|---|---|
| ImageNet 由来の有無 | **不明**。review 済み資料から absence を断定しない | **不明**。完全 inventory がないため absence を断定しない |
| ImageNet 法務書面承認 | **なし / MISSING** | **なし / MISSING** |
| COCO 由来の有無 | **不明**。review 済み資料から absence を断定しない | **不明**。完全 inventory がないため absence を断定しない |
| COCO 法務書面承認 | **なし / MISSING** | **なし / MISSING** |

### 4.3 C8 判定

- SigLIP: **不適合状態（証拠不足）**。WebLI の全公開学習元と各 terms を列挙・確定できないため、C7 同梱不可。
- CLIP: **不適合状態（証拠不足）**。加えて §8 の製品用途除外により REJECT。
- dataset terms が checkpoint へ法的に継承する／しないという結論は、本技術記録では出さない。権限者の書面判断が必要。

## 5. NOTICE・帰属表示（FR-LIC-002/012）

| 項目 | SigLIP | CLIP |
|---|---|---|
| `THIRD_PARTY_NOTICES` への追記内容 | **MISSING**。Apache-2.0 license copy、copyright、変更表示、WebLI/data attribution を含む final text 未確定 | **MISSING**。ただし候補 REJECT のため配布 packet を作成しない |
| アプリ内ライセンス画面の表示文字列 | **MISSING** | **MISSING** |
| NOTICE file の伝播要否 | **unknown**。採用 revision と exact artifact の NOTICE inventory 未完 | **unknown** |
| Apache-2.0 特許条項確認 | root license text は存在するが、exact HF artifact への適用主体・範囲の確認が **MISSING** | 非該当（checkpoint license 自体が unknown） |
| dataset attribution | **unknown** | **unknown** |
| 判定 | **BLOCKED** | **REJECT** |

NOTICE file の有無を未確認のまま「追記不要」としない。license text の存在を、training data attribution の不要性へ拡張しない。

## 6. 安全形式・リモートコード（FR-SEC-007/004/LIC-011）

| 項目 | SigLIP HF artifact | OpenAI CLIP |
|---|---|---|
| checkpoint ファイル形式 | HF metadata 上は `safetensors` | exact artifact **MISSING** |
| binary payload inspection | **NOT_RUN** | **NOT_RUN** |
| pickle 全体モデルを含まないことの確認 | **NOT_RUN**。拡張子だけで payload を合格にしない | **NOT_RUN / unknown** |
| ONNX 外部データ参照 | 非該当（未変換） | 非該当（未変換） |
| リモートコード実行の要否 | HF 固定 config は `auto_map` を持たず、Transformers v4.44.2 固定 source には native SigLIP mapping があるため、model repository の custom remote code を要求しない静的候補経路は確認済み。ただし製品 code path、package lock、local-only load 実装は未固定 | **unknown** |
| `trust_remote_code=True` 相当 | 上記候補経路では不要と静的に確認したが、製品実装・offline 実行試験は **NOT_RUN** | **NOT_RUN** |
| runtime network download | HF card の例は repository ID を使用する。製品用 fixed local-only path は **MISSING** | **NOT_RUN** |
| offline load / outbound 0 | **NOT_RUN** | **NOT_RUN** |
| 判定 | **HOLD** | **REJECT** |

## 7. 一次資料・証拠ハッシュ（FR-LIC-004/014）

すべての URL は 2026-09-03 に参照した。source response の一部は調査中に一時的な SHA-256 を計算したが、source archive と hash manifest を repository に保存していない。したがって、URL が immutable な場合でも「保存コピー場所」と「保存コピー SHA-256」は **MISSING** であり、FR-LIC-014 を満たさない。§1.1 の checkpoint LFS SHA-256 と §1.2 の GCS MD5 / CRC32C / ETag は source-document の保存 hash でも、NPZ の完全 SHA-256 でもない。

| 資料種別 | URL | 取得日 | 保存コピー場所 | 保存コピー SHA-256 | 用途・限界 |
|---|---|---|---|---|---|
| SigLIP HF model card | `https://huggingface.co/google/siglip-base-patch16-224/raw/7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed/README.md` | 2026-09-03 | **MISSING** | **MISSING** | intended use、WebLI、HF team 作成 disclaimer。release team 作成 card ではない |
| SigLIP HF artifact API | `https://huggingface.co/api/models/google/siglip-base-patch16-224/revision/7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed?blobs=true` | 2026-09-03 | **MISSING** | **MISSING** | revision、file size、LFS SHA-256、license metadata |
| SigLIP HF config | `https://huggingface.co/google/siglip-base-patch16-224/raw/7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed/config.json` | 2026-09-03 | **MISSING** | **MISSING** | `model_type: siglip`、`SiglipModel`、`auto_map` 不在 |
| Big Vision commit API | `https://api.github.com/repos/google-research/big_vision/commits/0127fb6b337ee2a27bf4e54dea79cff176527356` | 2026-09-03 | **MISSING** | **MISSING** | 調査用 source identity。製品採用 revision ではない |
| Big Vision README | `https://raw.githubusercontent.com/google-research/big_vision/0127fb6b337ee2a27bf4e54dea79cff176527356/README.md` | 2026-09-03 | **MISSING** | **MISSING** | SigLIP resource と Apache-2.0 signal |
| Big Vision LICENSE | `https://raw.githubusercontent.com/google-research/big_vision/0127fb6b337ee2a27bf4e54dea79cff176527356/LICENSE` | 2026-09-03 | **MISSING** | **MISSING** | Apache-2.0 本文 |
| Big Vision SigLIP demo / model list | `https://raw.githubusercontent.com/google-research/big_vision/0127fb6b337ee2a27bf4e54dea79cff176527356/big_vision/configs/proj/image_text/SigLIP_demo.ipynb` | 2026-09-03 | **MISSING** | **MISSING** | NPZ filename/location と research-purpose statement。完全 training recipe・provenance packet ではない |
| Big Vision NPZ object HEAD | `https://storage.googleapis.com/big_vision/siglip/webli_en_b16_224_63724782.npz` | 2026-09-03 | **MISSING** | **MISSING** | body 非取得。size、generation、metageneration、Last-Modified、ETag、CRC32C、MD5 の metadata のみ |
| Big Vision NPZ metadata API | `https://storage.googleapis.com/storage/v1/b/big_vision/o/siglip%2Fwebli_en_b16_224_63724782.npz` | 2026-09-03 | **MISSING** | **MISSING** | object metadata JSON。NPZ bodyまたは完全SHA-256ではない |
| Transformers v4.44.2 native config mapping | `https://raw.githubusercontent.com/huggingface/transformers/174890280b340b89c5bfa092f6b4fb0e2dc2d7fc/src/transformers/models/auto/configuration_auto.py` | 2026-09-03 | **MISSING** | **MISSING** | native `siglip` → `SiglipConfig` mapping |
| Transformers v4.44.2 native model mapping | `https://raw.githubusercontent.com/huggingface/transformers/174890280b340b89c5bfa092f6b4fb0e2dc2d7fc/src/transformers/models/auto/modeling_auto.py` | 2026-09-03 | **MISSING** | **MISSING** | native `siglip` → `SiglipModel` mapping |
| Transformers v4.44.2 LICENSE | `https://raw.githubusercontent.com/huggingface/transformers/174890280b340b89c5bfa092f6b4fb0e2dc2d7fc/LICENSE` | 2026-09-03 | **MISSING** | **MISSING** | candidate C5 path の Apache-2.0 text |
| SigLIP training recipe / script | **MISSING** | **MISSING** | **MISSING** | **MISSING** | review 済み demo notebook を完全な学習 recipe として扱わない |
| SigLIP paper v4 | `https://arxiv.org/abs/2303.15343v4` | 2026-09-03 | **MISSING** | **MISSING** | model/paper identity。checkpoint license、WebLI terms、HF equivalence の証明ではない |
| PaLI / WebLI paper v4 | `https://arxiv.org/abs/2209.06794v4` | 2026-09-03 | **MISSING** | **MISSING** | WebLI の研究上の説明。dataset terms ではない |
| OpenAI CLIP model card | `https://raw.githubusercontent.com/openai/CLIP/d05afc436d78f1c48dc0dbf8e5980a9d471f35f6/model-card.md` | 2026-09-03 | **MISSING** | **MISSING** | intended use、deployed-use exclusion、data limitations |
| OpenAI CLIP code LICENSE | `https://raw.githubusercontent.com/openai/CLIP/d05afc436d78f1c48dc0dbf8e5980a9d471f35f6/LICENSE` | 2026-09-03 | **MISSING** | **MISSING** | code の MIT signal。checkpoint/use scope を上書きしない |
| SigLIP checkpoint 固有 license file | **MISSING** | **MISSING** | **MISSING** | **MISSING** | HF repository metadata と Big Vision root statement だけでは exact chain を閉じられない |
| WebLI dataset card / terms | **MISSING** | **MISSING** | **MISSING** | **MISSING** | blocker |
| 法務承認書 | **MISSING** | **MISSING** | **MISSING** | **MISSING** | blocker |

### 7.1 取得時response hash台帳（保存copyではない）

次は2026-09-03に取得したHTTP response bytesのSHA-256である。repository内の保存copyとhash manifestは作成していないため、adoption templateが要求する保存copy欄は引き続き`MISSING`である。可変API/HTMLは同じURLでも将来変わり得る。

| 資料 | bytes | 取得時response SHA-256 |
|---|---:|---|
| SigLIP HF model card | 4,116 | `86C231C4A7BF0EE2435295413AD5C7CF567C9426F00B79711CE8EDA884B7A8D3` |
| SigLIP HF artifact API | 5,520 | `69A554A9A81145D1522CA33F27F29AA4A281F5687CCE0CEA0A81BB654DEC9283` |
| SigLIP HF config | 432 | `CD85B3D28829722820BCB89A2CFBB4160E55FD359249A3044DA724166A8D9688` |
| Big Vision README (fixed commit) | 27,891 | `6772EEBA75C265ADE38FCA5693D495862F881B21110B5547BD01EE735AE20DA4` |
| Big Vision LICENSE (fixed commit) | 11,356 | `43070E2D4E532684DE521B885F385D0841030EFA2B1A20BAFB76133A5E1379C1` |
| Big Vision SigLIP demo (fixed commit) | 683,055 | `CC1FCE849549E6AE8D19876B008070F43958EB6415147FE3973F45BC20DE61A1` |
| Big Vision NPZ metadata API | 897 | `B47E0ED5F3487DAE6693F8E872823942AF05E78F0229C7DFDB525F4C385B3FC4` |
| Transformers configuration mapping (fixed commit) | 39,695 | `629BB1AE6636FA8134214F0B8208D87438BFA2C02F92D3B7F0F34211AEDDA2C4` |
| Transformers model mapping (fixed commit) | 70,828 | `8F0FB327584E6572C5081E344D58F30BA49B2F2D7B40D986BB78AB0C8BC7B21F` |
| Transformers LICENSE (fixed commit) | 11,418 | `77FD4710DEF9EC3C0F6225800E0235F15A425ABD4A8B03559127FCD782612049` |
| SigLIP paper v4 landing page | 41,555 | `298CB4B93400284FA3DB3BA5547E8208DFAFF1008A71564D2DB6AFE4608004BE` |
| PaLI/WebLI paper v4 landing page | 46,288 | `E9825DAE8F38F5E801968AA0F70A006588D7C8DFAC833C61676D68A28B9F4C4E` |
| OpenAI CLIP model card (fixed commit) | 7,733 | `7BAF04F60C6234B301EC2C9CA39E67A3CA54B47C05E9509BDDF732CBCBEC8B7F` |
| OpenAI CLIP LICENSE (fixed commit) | 1,064 | `987E63B32F6C89FF5160E429458A872FF048E6860B590A3912E938F9DA8F14DB` |

Big Vision commit APIは取得時にGitHub rate limit 403となったため、response hashを捏造せず`MISSING`のままとした。上記hashの一致は取得時の技術的同一性だけを示し、checkpoint license、WebLI権利、商用利用、再配布、保存copy、法務承認を充足しない。

## 8. Model Card — Intended Use / Out-of-Scope Use（C7 必須）

### 8.1 SigLIP

| 項目 | 内容 |
|---|---|
| model card 作成主体 | Hugging Face team。SigLIP release team が書いた card ではない |
| Intended use（短い原文） | “You can use the raw model for tasks like zero-shot image classification and image-text retrieval.” |
| Intended use 日本語要約 | raw model の技術用途として zero-shot 画像分類と image-text retrieval を挙げる |
| Out-of-scope use（原文） | **MISSING**。review 済み HF card に独立した out-of-scope 一覧または製品配備条件を確認できない |
| Out-of-scope use 日本語要約 | **判断不能** |
| 本製品用途が intended use に含まれるか | 技術タスクには重なるが、商用 offline installer への同梱・顧客端末での deployed use まで含むかは **判断不能 → 同梱不可** |
| 本製品用途が out-of-scope に該当するか | **判断不能 → 同梱不可** |
| `deployed use` / `production use` の明示除外 | review 済み card では明示文を確認しなかった。ただし out-of-scope coverage 自体が MISSING のため、これを合格証拠にしない |
| 判定 | **HOLD** |

### 8.2 OpenAI CLIP

| 項目 | 内容 |
|---|---|
| Intended use（model card 原文） | “The model is intended as a research output for research communities.” |
| Intended use 日本語要約 | AI 研究者が robustness、generalization、capability、bias、constraint を研究するための research output |
| Out-of-scope use（短い原文） | “Any deployed use case of the model - whether commercial or not - is currently out of scope.” |
| 本製品用途が intended use に含まれるか | **含まれない**。本製品は顧客端末へ同梱する deployed product use |
| 本製品用途が out-of-scope に該当するか | **該当する** |
| `deployed use` の明示除外 | **記載あり** |
| 追加制約 | constrained image search も fixed taxonomy の thorough in-domain testing なしでは非推奨。英語以外、surveillance、facial recognition 等にも制限を記載 |
| 判定 | **REJECT（FR-LIC-015）** |

CLIP code の MIT は C5 の条件であり、model card の用途範囲を上書きしない。SigLIP の技術用途記述も、commercial use または installer redistribution の許諾ではない。

## 9. タスク仕様・推論定義（NFR-ANN-004）

製品仕様は未固定である。以下の upstream card 記述を、製品 pipeline の採用済み仕様または実測結果として扱わない。

| 項目 | SigLIP | OpenAI CLIP |
|---|---|---|
| 対象タスク | upstream: zero-shot image classification / image-text retrieval。製品候補: 既存 Label Schema の順位付け | **NOT_DEFINED**。候補 REJECT |
| 入力形式 | upstream card は 224×224 image と text を扱う。製品の source pixel format・shape policy は **unknown** | **NOT_DEFINED** |
| 前処理 | upstream card: 224×224 へ resize/rescale、RGB mean `(0.5, 0.5, 0.5)`、std `(0.5, 0.5, 0.5)`、text length 64 へ pad。resize algorithm、製品 local pipeline、tokenizer artifact hash は **MISSING** | **NOT_DEFINED** |
| prompt / text template | **unknown / MISSING** | **NOT_DEFINED** |
| 出力形式 | upstream example は `logits_per_image` に sigmoid を適用。製品 top-3 schema、tie-break、raw result 保存形式は **unknown** | **NOT_DEFINED** |
| スコアの意味と単位 | upstream example は sigmoid 値 0–1。calibrated correctness probability とは確認しておらず、製品では「モデルスコア」とする必要がある | **NOT_DEFINED** |
| 信頼度しきい値の既定値 | **unknown / MISSING** | **NOT_DEFINED** |
| 決定論的推論の保証 | **NOT_RUN / 保証なし** | **NOT_RUN** |
| 非決定的演算の明記 | **MISSING** | **MISSING** |
| seed 設定対象 | **unknown / MISSING** | **MISSING** |
| image hash | scheme **MISSING** | **MISSING** |
| checkpoint hash | HF metadata hash は known。local verified hash と derived ONNX hash は **MISSING** | **MISSING** |
| NFR-ANN-004 | **未適合**。image/checkpoint/prompt/preprocess/threshold/seed の全一致再現を実証していない | **未適合 / REJECT** |

## 10. OS・Execution Provider 互換性（POC-03/08）

### 10.1 OS / EP

| 候補 | OS | Execution Provider | 動作確認 | 備考 |
|---|---|---|---|---|
| SigLIP | Windows 11 x64 | DirectML | **NOT_RUN** | ONNX 未作成 |
| SigLIP | Windows 11 x64 | CPU | **NOT_RUN** | model 未実行 |
| SigLIP | macOS arm64 | CoreML | **NOT_RUN** | native Mac evidence なし |
| SigLIP | macOS arm64 | CPU | **NOT_RUN** | native Mac evidence なし |
| CLIP | 全対象 | 全 EP | **NOT_RUN** | policy-level REJECT。試験値を SigLIP へ転用しない |

### 10.2 ONNX 変換・パリティ

| 項目 | 測定値 | 許容基準 | 判定 |
|---|---|---|---|
| ONNX 変換 | **NOT_RUN** | 成功必須 | 未合格 |
| tensor parity rtol | **NOT_RUN** | ≤ 1e-3 | 未合格 |
| tensor parity atol | **NOT_RUN** | ≤ 1e-4 | 未合格 |
| 分類 top-1 一致率 | **NOT_RUN** | ≥ 99.5% | 未合格 |
| 検出 mAP 低下 | `N/A（対象タスク外）` | ≤ 0.005 | `N/A（分類）` |
| 固定 input shape | **MISSING** | — | — |
| 未対応演算が存在する EP | **unknown / NOT_RUN** | — | — |

公開 benchmark、別 variant、別 checkpoint、別 OS の値を本製品の実測へ代用しない。

## 11. 精度・パフォーマンス・サイズ

| 指標 | 測定環境 | 測定値 | 採用基準 | 判定 |
|---|---|---|---|---|
| 製品用途の分類品質 | **MISSING** | **NOT_RUN** | **MISSING** | 未測定 |
| 推論 p95 レイテンシ | **MISSING** | **NOT_RUN** | ≤ 100 ms | 未測定 |
| 推論スループット | **MISSING** | **NOT_RUN** | ≥ 10 FPS | 未測定 |
| ピークメモリ | **MISSING** | **NOT_RUN** | **MISSING** | 未測定 |
| SigLIP checkpoint file size | HF API metadata | `812.67232` MB（10^6 bytes）/ 約 `775.0247` MiB | **MISSING** | 採否未判定 |
| インストーラー追加サイズ寄与 | — | **NOT_RUN** | **MISSING** | 未測定 |
| CLIP exact checkpoint size | — | **MISSING** | — | REJECT |

HF model card や paper の公開評価値は AutoVision Studio の representative dataset、EP、hardware、prompt、class taxonomy に対する実測ではないため転記して合格値にしない。

## 12. 補助 / 手動比較試験（NFR-ANN-006）— C7 必須

| 項目 | 内容 |
|---|---|
| 試験データセット | **MISSING / NOT_RUN** |
| 画像枚数・クラス数 | **MISSING** |
| Gold-set 品質評価方法 | **MISSING** |
| blind audit 手順 | **MISSING** |
| Manual-only の最終 Ground Truth 品質スコア | **NOT_RUN** |
| Assisted の最終 Ground Truth 品質スコア | **NOT_RUN** |
| 品質悪化の有無 | **判断不能 / 未合格** |
| Manual-only の平均 annotation 所要時間 | **NOT_RUN** |
| Assisted の平均 annotation 所要時間 | **NOT_RUN** |
| 時間短縮の達成 | **判断不能 / 未合格** |
| coverage / accept / edit / reject | **NOT_RUN** |
| 試験実施日 | **MISSING** |
| 試験担当者 | **MISSING** |

SPI-17 の実測前に NFR-ANN-006 を合格扱いにしない。CLIP は REJECT のため比較対象へ昇格させず、SigLIP も権利 gate 通過前に大容量 binary を取得・実行しない。

## 13. セキュリティ・脆弱性（NFR-SEC-003/G-DEP-04）

| 項目 | SigLIP | OpenAI CLIP |
|---|---|---|
| exact runtime dependency set | **MISSING** | **MISSING** |
| 既知 CVE の有無 | **unknown / NOT_RUN** | **unknown / NOT_RUN** |
| Critical/High CVE | **unknown / 未合格** | **unknown / 未合格** |
| 例外承認 | **なし** | **なし** |
| checkpoint tensor/payload inspection | **NOT_RUN** | **NOT_RUN** |
| adversarial robustness | **NOT_RUN** | **NOT_RUN** |
| domain bias / class taxonomy 評価 | **NOT_RUN** | model card の bias 記述は存在するが、製品評価は **NOT_RUN** |
| malicious prompt/label、Unicode、極端入力 | **NOT_RUN** | **NOT_RUN** |
| 判定 | **BLOCKED** | **REJECT / BLOCKED** |

## 14. リリースマニフェスト対応付け（FR-LIC-010/NFR-INS-007）

| 項目 | 値 |
|---|---|
| リリースマニフェスト内の識別子 | **MISSING / 登録なし** |
| 承認済み Classification C7 entry | **0 件** |
| SBOM への記録 | **未記録** |
| `THIRD_PARTY_NOTICES` への追記 | **未追記** |
| installer payload path | **MISSING** |
| local artifact / signature | **MISSING** |
| build-time hash verification | **NOT_IMPLEMENTED / NOT_RUN** |
| lock file との関連付け | **MISSING** |
| runtime download prohibition test | **NOT_RUN** |
| manifest の調査時状態 | `releaseStatus.ready: false`、`models: []` |
| manifest 編集 | **していない。本記録の範囲外** |

## 15. 判定・承認（FR-LIC-004/014/G-DEP-07/08）

### 15.1 候補別最終判定

| 項目 | SigLIP | OpenAI CLIP |
|---|---|---|
| 最終判定 | **HOLD（保留）** | **REJECT（却下）** |
| 主理由 | exact HF artifact と原版 NPZ の chain/equivalence、WebLI rights/terms、commercial redistribution、NOTICE、source archive/hash、承認、技術・品質・security evidence が不足 | 公式 model card が any deployed use を commercial/non-commercial を問わず out-of-scope と明記 |
| code license の扱い | Apache-2.0 signal を C7/C8 承認へ使用しない | MIT を model card の制約解除へ使用しない |
| 承認者氏名 | **MISSING / なし** | **MISSING / なし** |
| 承認日 | **MISSING / なし** | **MISSING / なし** |
| 再審査期限 | 設定なし。§17.2 の証拠が揃った場合のみ再審査 | 新しい authoritative model card/version が本製品の deployed use を明示的に許容し、C7 全項目を新規審査する場合のみ再検討 |
| 法務確認 | **必須 / 未開始** | rejection を覆す承認は存在しない |

### 15.2 Gate 判定

| 判定対象 | 結果 |
|---|---|
| SigLIP C7 approval | **0 / HOLD** |
| CLIP C7 approval | **0 / REJECT** |
| 承認済み Classification C7 総数 | **0** |
| G-DEP-08 | **FAIL / BLOCKED** |
| Gate 2 | **BLOCKED** |
| model-assisted MVP release | **不可**。分類・検出それぞれ 1 件の C7 が全 gate を通過するまで解除しない |

空欄、`unknown`、`MISSING`、`NOT_RUN` を承認へ読み替えない。本記録には「承認」を成立させる署名・日付・証拠がない。

## 16. 記入完了チェックリスト

チェック済みは調査手順を実施したことだけを表し、checkpoint の承認を表さない。

### 16.1 ライセンス審査

- [ ] 1. コード層ライセンス（SPDX）を exact revision で確認し、最終判定を記入した — 製品 code path/revision が MISSING
- [ ] 2. Checkpoint ライセンス（SPDX または URL）を exact artifact で確認した — SigLIP chain 不明、CLIP artifact 未選定
- [ ] 3. Checkpoint ライセンスが商用利用・再配布を明示的に許可していることを確認した — 未確認
- [ ] 4. copyleft / 研究限定 / 非商用 / 用途制限がないことを確認した、または法務書面承認を得た — SigLIP 未確定、CLIP deployed use 除外
- [x] 5. コードライセンスを根拠に Checkpoint を承認していないことを確認した — C5/C7/C8 を分離

### 16.2 学習データ由来

- [ ] 6. 全公開学習データセットを列挙し、各 terms の商用可否を確認した — WebLI/CLIP とも完全 inventory/terms が MISSING
- [ ] 7. ImageNet 由来の有無を確認した — unknown
- [ ] 8. COCO 由来の有無を確認した — unknown
- [ ] 9. dataset terms が unknown 等の場合の法務書面承認を確認した — 承認なし

### 16.3 証拠記録

- [ ] 10. SHA-256 を binary から計算して記入した — SigLIP は HF LFS metadata 値のみ、local 計算 NOT_RUN。CLIP は MISSING
- [ ] 11. ファイルサイズを取得 artifact で確認した — SigLIP は API metadata のみ、CLIP は MISSING
- [ ] 12. artifact 取得日を記入した — binary 未取得
- [ ] 13. 一次資料 URL・取得日・保存コピー SHA-256 を全件記入した — 保存 copy/hash が MISSING

### 16.4 安全形式・リモートコード

- [ ] 14. checkpoint が承認済み安全形式であることを確認した — SigLIP は safetensors metadata のみ、payload inspection NOT_RUN
- [ ] 15. pickle 全体モデルを含まないことを確認した — NOT_RUN
- [ ] 16. リモートコード実行が不要であることを確認した — native candidate path は静的確認済みだが、製品 code path / lock / offline 実行は未固定・NOT_RUN

### 16.5 Model Card（C7 必須）

- [x] 17. intended use を model card から記録した — SigLIP と CLIP の作成主体も分離
- [ ] 18. out-of-scope use を model card から転記した — SigLIP の dedicated statement が MISSING
- [ ] 19. 本製品用途が intended use に含まれ、out-of-scope に該当しないことを確認した — SigLIP 判断不能、CLIP 該当
- [ ] 20. `deployed use` が out-of-scope に記載されていないことを確認した — CLIP は明示的に記載あり

### 16.6 NOTICE・帰属表示

- [ ] 21. `THIRD_PARTY_NOTICES` への追記内容を確定した — MISSING
- [ ] 22. Apache-2.0 の NOTICE 伝播要否を exact artifact/revision で確認した — MISSING

### 16.7 技術性能

- [ ] 23. ONNX 変換と parity を確認した — NOT_RUN
- [ ] 24. Windows DirectML/CPU・macOS CoreML/CPU を確認した — NOT_RUN
- [ ] 25. deterministic inference 条件を確認した — NOT_RUN
- [ ] 26. p95 ≤ 100 ms・throughput ≥ 10 FPS を確認した — NOT_RUN

### 16.8 品質比較試験（C7 必須）

- [ ] 27. manual-only と assisted の比較試験を実施した — NOT_RUN
- [ ] 28. 最終 Ground Truth 品質が悪化しないことを確認した — NOT_RUN
- [ ] 29. annotation 所要時間が短縮することを確認した — NOT_RUN

### 16.9 セキュリティ

- [ ] 30. Critical/High CVE がないことを確認した、または例外承認を得た — dependency set MISSING、NOT_RUN

### 16.10 リリースマニフェスト

- [ ] 31. リリースマニフェスト識別子を記入した — 登録なし
- [ ] 32. SBOM への記録を確認した — 未記録
- [ ] 33. `THIRD_PARTY_NOTICES` への追記を確認した — 未追記

### 16.11 最終承認

- [ ] 34. チェック 1〜33 が完了した — 未完
- [ ] 35. 承認者が確認し承認日を記入した — 承認者・承認日なし
- [x] 36. 最終判定を明記した — SigLIP `HOLD`、CLIP `REJECT`、承認済み Classification C7 `0`、G-DEP-08 / Gate 2 `BLOCKED`

## 17. 要求トレーサビリティ・再審査条件・敵対的レビュー

### 17.1 要求トレーサビリティ

| 要求 ID | 本記録の対応 | 状態 |
|---|---|---|
| FR-LIC-001 | C5/C7/C8、artifact、再配布、NOTICE を分離記録 | **BLOCKED**。unknown あり |
| FR-LIC-002 | Apache-2.0 / MIT の条件と final notice 不足を記録 | **BLOCKED** |
| FR-LIC-003 | unknown・用途制限を fail-closed とした | **PASS（手順）** |
| FR-LIC-004 | 名称・版・URL・hash・data・NOTICE・approval・source hash 欄 | **BLOCKED**。C7 に包含される必須項目が不足 |
| FR-LIC-005 | code license だけで weight を承認していない | **PASS（手順）** |
| FR-LIC-006 | ImageNet absence を推定せず unknown とした | **NOT_PROVEN / HOLD** |
| FR-LIC-007 | COCO absence を推定せず unknown とした | **NOT_PROVEN / HOLD** |
| FR-LIC-008 | Open Images 等の非使用・帰属不要を推定していない | **NOT_PROVEN / HOLD** |
| FR-LIC-010 | manifest/SBOM/NOTICE は未登録、unknown のまま release 不可 | **BLOCKED** |
| FR-LIC-011 | runtime download を許容せず local-only test を要求 | **NOT_RUN / BLOCKED** |
| FR-LIC-012 | アプリ内表示文字列を MISSING とした | **BLOCKED** |
| FR-LIC-014 | C7 の exact checkpoint、model card、全 data terms、再配布、source hash、approval を審査 | **FAIL / BLOCKED** |
| FR-LIC-015 | CLIP の MIT code と model card scope を分離し候補から除外 | **PASS（除外判断）** |
| FR-SEC-004 | remote code / external content を未実証のまま許可していない | **BLOCKED** |
| FR-SEC-007 | safetensors metadata のみで安全合格にしていない | **NOT_RUN / BLOCKED** |
| NFR-ANN-004 | deterministic key の全項目を列挙 | **NOT_RUN / BLOCKED** |
| NFR-ANN-006 | manual-only / assisted 比較欄 | **NOT_RUN / BLOCKED** |
| NFR-SEC-003 | CVE・dependency review 欄 | **NOT_RUN / BLOCKED** |
| FR-AST-004 | 初回 assist model の同梱条件 | **未充足**。承認済み Classification C7 は 0 |
| POC-08 | ONNX parity | **NOT_RUN** |
| POC-16 | 初期モデル支援の offline・license・品質 PoC | **NOT_RUN / BLOCKED** |
| G-DEP-08 | C7 全証拠完備・unknown なし | **FAIL / BLOCKED** |
| Gate 2 | model / budget approval | **BLOCKED** |

SPI-13 の research outcome は「候補を承認できないことを証拠不足・用途制限とともに記録した」であり、model approval の成立ではない。

### 17.2 再審査に必要な precise evidence

#### SigLIP

1. `google/siglip-base-patch16-224@7fd15f…/model.safetensors` の権利者または配布権限を持つ publisher による、exact bytes へ適用される license、commercial use、modification、installer redistribution、copyright、NOTICE、attribution の immutable statement。
2. Big Vision `webli_en_b16_224_63724782.npz` について、HEAD で確認した byte size / generation を 64 桁 SHA-256 と生成 provenance に結ぶ publisher checksum manifest。
3. NPZ と HF safetensors の変換者、変換手順、tensor 名・shape・dtype・値の equivalence、変換後 artifact への license 適用を示す publisher-verified chain of custody。
4. SigLIP の exact training corpus snapshot と、WebLI を構成する全 source/dataset の inventory。各 source について取得時 terms、画像・text の権利、commercial training、derived checkpoint の利用・再配布、installer 同梱、attribution を対応付ける。
5. 上記を本製品の local commercial deployment、Fine-Tuning、ONNX 変換、顧客端末への offline installer 再配布に適用した、named legal approver または repository license decision authority の署名・役割・日付付き判断。
6. model card、README、LICENSE、training recipe、dataset terms、approval の保存 copy と SHA-256。今回の調査用 source pin を製品採用 pin とみなさず、最終採用 commit と lock を別途固定する。
7. exact code/runtime lock、remote code 不要、runtime network 0、local hash verification、NOTICE packet、SBOM、アプリ内表示を確定する。
8. 権利 gate 通過後にのみ、binary payload inspection、safe load、ONNX export/parity、Windows CPU/DirectML、macOS CPU/CoreML、determinism、p95/FPS/memory/installer size、CVE、domain bias、manual-only/assisted blind comparison を実施する。

#### OpenAI CLIP

現在の official model card の deployed-use exclusion と本製品用途が衝突するため、再審査対象にしない。将来、権限ある発行主体が exact model/version について deployed commercial product use を明示的に許容する新しい authoritative terms/model card を公開した場合でも、旧記録を上書きせず、artifact・license・全 training data・NOTICE・承認・技術品質を新規 C7 記録で最初から審査する。

### 17.3 Self-adversarial review

| 攻撃的確認 | 誤承認リスク | 本記録の最終状態 |
|---|---|---|
| C5 code license = C7 checkpoint license としていないか | Big Vision Apache-2.0 / CLIP MIT だけで weight を承認する | 三層を分離。SigLIP HOLD、CLIP REJECT |
| C7 license signal = C8 data permission としていないか | Apache-2.0 metadata で WebLI rights を解決する | WebLI を独立 blocker とし、全 terms を MISSING とした |
| HF artifact = Big Vision NPZ と仮定していないか | known HF hash を原版 hash として流用する | filename/format/location/size/hash/equivalence を別欄にし、NPZ の完全 SHA-256 と artifact 間 equivalence を unknown とした |
| GCS metadata を完全 SHA-256 としていないか | size、generation、ETag、CRC32C、MD5 が得られるため integrity gate 完了と誤認しやすい | metadata は記録したが、NPZ の完全 SHA-256 は `MISSING` のままとした |
| `google` namespace = Google 作成 card / 権利者と推定していないか | namespace だけで authorship・authority を断定する | HF card 自身の disclaimer に従い、作成主体を Hugging Face team と記録 |
| WebLI の公開論文 = exact SigLIP corpus / rights packet としていないか | 一般 corpus の規模、言語数、PaLI 用上位 10% を SigLIP B/16 224 の exact snapshot・利用許諾へ読み替える | paper は一般構築概要であり、SigLIP の exact item manifest、件数、filter、terms ではないと明記 |
| native Transformers mapping = 製品の安全な offline load としていないか | model-repository custom code が不要な静的候補経路から、製品 lock・実行・network-zero まで合格と誤認しやすい | 調査用 v4.44.2 source と製品採用 package/lockを分離し、製品実行を `NOT_RUN` とした |
| public availability = commercial redistribution permission としていないか | GCS/HF から取得できることを同梱許可と誤認する | commercial use・redistribution を unknown / 未承認とした |
| research-purpose 文を都合よく無視または法的禁止と断定していないか | 相反する結論を無根拠に出す | 追加用途 signal として記録し、権限者判断まで HOLD |
| CLIP MIT で model card を上書きしていないか | code license を deployed-use permission にする | FR-LIC-015 により明示 REJECT |
| 公開 benchmark を製品実測にしていないか | upstream 値で POC-03/08/16 を合格にする | 技術・品質・性能・security をすべて NOT_RUN とした |
| safetensors 拡張子だけで安全合格にしていないか | payload、offline load、dependency を未検査のまま通す | metadata signal のみに限定し、payload inspection を NOT_RUN とした |
| source URL だけで evidence hash 完備としていないか | 消失・改変可能なページを再現証拠にする | 保存 copy/path/hash を MISSING として G-DEP-08 を停止 |
| 承認者・承認日を暗黙補完していないか | research record を approval record に昇格する | 承認者なし、承認日なし、approved count 0 |
| manifest を先行更新していないか | HOLD candidate が release payload に入る | manifest 未編集、`models: []`、Gate 2 BLOCKED |

### 17.4 修正後の独立敵対レビュー

2026-09-03 の read-only 再レビューは、GCS HEAD metadata、Big Vision / Transformers / OpenAI CLIP の調査用固定 commit、native SigLIP mapping、WebLI 一般 corpus と exact SigLIP lineage の境界、一時 hash と保存証拠の境界を公式一次資料で再確認し、**追加の verified factual defect は 0 件**とした。NPZ / checkpoint body の取得、payload inspection、モデル実行、法務判断は実施していない。

再レビュー結果は、**本 research record は HOLD / REJECT の根拠として commit 可能**、一方で **checkpoint の採用・manifest 登録・installer 同梱・G-DEP-08 / Gate 2 解除は不可**である。前者を後者の承認へ昇格させない。

敵対的レビュー後も blocking evidence は解消していない。最終結果は **SigLIP `HOLD`、OpenAI CLIP `REJECT`、承認済み Classification C7 `0`、G-DEP-08 / Gate 2 `BLOCKED`** のままとする。