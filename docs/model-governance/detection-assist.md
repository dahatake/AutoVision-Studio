# SPI-14 — 検出 Annotation Assist Model 監査記録

> **厳格な fail-closed research record / 法的助言ではない**
> 本記録は公開された一次資料を技術的に整理したものであり、法的助言、利用許諾、採用承認ではない。C5（コード）、C7（checkpoint）、C8（学習元データ）を独立して扱い、コードの permissive license を checkpoint または学習データへ拡張しない。`unknown`、`NOT_RUN`、保存証拠不在、または承認者不在が一つでも残る候補は、同梱、既定選択、manifest 登録、製品実装に使用してはならない。

## メタデータ

| 項目 | 値 |
|---|---|
| タスク | SPI-14 — Detection assist 監査 |
| カテゴリー | C7（Annotation Assist Model checkpoint）/ C5（構造コード）/ C8（学習元データ）を独立審査 |
| 対象用途 | 成功済み Model Version がない Project に対し、矩形・class 候補をローカルで提示する検出支援 |
| 調査日・本記録の URL 取得日 | **2026-09-03** |
| 記録作成者 | GitHub Copilot（技術調査のみ。承認権限なし） |
| 法務確認 | **未開始 / 書面判断なし** |
| 承認者 | **なし** |
| 承認日 | **なし** |
| 再審査期限 | **設定なし**。§15.3 の解除証拠が揃った場合、または artifact・license・dataset terms・用途が変わった場合に再審査する |
| checkpoint binary download | **未実施**。公開 metadata の値を使用し、local binary hash、load、推論は実施していない |
| 一次資料の保存 copy / hash | **なし / `unknown`**。§7 の URL は取得したが、repository 内に保存 copy を作成していない |
| 最終判定 | **HOLD — C7 検出候補の承認 0 件** |
| G-DEP-08 / Gate 2 | **BLOCKED** |
| release manifest | **未編集**。本記録を根拠に候補を追加してはならない |

### 候補別結論

| 候補 | 厳密な対象 | 判定 | 主な停止理由 |
|---|---|---|---|
| Microsoft Florence-2-base-ft | `microsoft/Florence-2-base-ft@f6c1a25888ffc1d945ee8a1a77ac833c7303d46e` / `model.safetensors` | **HOLD / 未承認** | checkpoint への MIT 適用範囲・再配布条件、全 dataset terms、明示的 intended/out-of-scope、保存証拠、custom code の offline 固定、品質・互換性・法務承認が未完 |
| Grounding DINO Swin-T | release `v0.1.0-alpha` / `groundingdino_swint_ogc.pth` | **HOLD / 未承認** | checkpoint 固有ライセンス、SHA-256、全 dataset terms、安全な `.pth` load、品質・互換性・法務承認が未完 |
| Grounding DINO Swin-B | release `v0.1.0-alpha2` / `groundingdino_swinb_cogcoor.pth` | **HOLD / 未承認** | Swin-B の資料間 provenance 不一致、checkpoint 固有ライセンス、SHA-256、ODinW-35 を含む全 dataset terms、安全な `.pth` load、品質・互換性・法務承認が未完 |

## 1. 基本識別情報（FR-LIC-014）

### 1.1 Exact checkpoint artifacts

| 候補 | Publisher / repository | 固定識別子 | exact file / 固定取得 URL | 公開 size | SHA-256 |
|---|---|---|---|---:|---|
| Florence-2-base-ft | Microsoft / Hugging Face `microsoft/Florence-2-base-ft` | HF revision `f6c1a25888ffc1d945ee8a1a77ac833c7303d46e` | `model.safetensors` / `https://huggingface.co/microsoft/Florence-2-base-ft/resolve/f6c1a25888ffc1d945ee8a1a77ac833c7303d46e/model.safetensors` | `463,221,266` bytes | `58757d657ff44051314c8030b68e04cb1bb618ca9a4885418f111f6fb708185a`（HF tree API の LFS `oid`。local 再計算は `NOT_RUN`） |
| Grounding DINO Swin-T | IDEA Research / GitHub Releases | release ID `96292847`、asset ID `100240415`、tag `v0.1.0-alpha` → commit `ddedf74b250249e0ae81f3781cbf98b3b4d3cb88` | `groundingdino_swint_ogc.pth` / `https://github.com/IDEA-Research/GroundingDINO/releases/download/v0.1.0-alpha/groundingdino_swint_ogc.pth` | `693,997,677` bytes | **`unknown`**。GitHub asset metadata は `digest: null` |
| Grounding DINO Swin-B | IDEA Research / GitHub Releases | release ID `98531025`、asset ID `102685727`、tag `v0.1.0-alpha2` → commit `22292c4b7836b801de2bb8b91cf65c4a24cc6f50` | `groundingdino_swinb_cogcoor.pth` / `https://github.com/IDEA-Research/GroundingDINO/releases/download/v0.1.0-alpha2/groundingdino_swinb_cogcoor.pth` | `938,057,991` bytes | **`unknown`**。GitHub asset metadata は `digest: null` |

Git commit、Git blob ID、ETag、asset size、`digest: null` は SHA-256 ではない。Grounding DINO の 2 asset について 64 桁 SHA-256 を推測または代用しない。tag commit は source tree identity であり、asset の build provenance ではない。両 release の `target_commitish: main` も、各 binary が tag commit または後述の調査用 revision から生成されたことを証明しない。

### 1.2 Artifact 選択境界

- Florence-2 repository には `pytorch_model.bin` もあるが、pickle 系形式を避けるため、本記録の候補 artifact は `model.safetensors` のみに固定する。
- Grounding DINO の公式 release は `.pth` のみを提示する。本記録は Hugging Face 上の第三者 mirror を公式 release asset と同一とみなさない。
- いずれの binary も `resources/models/`、installer payload、Git、または manifest へ追加していない。

## 2. コード層審査（C5）— アーキテクチャ定義コードのライセンス

### 2.1 Florence-2-base-ft code

| 項目 | 調査結果 |
|---|---|
| repository license signal | 固定 HF revision の root `LICENSE` と model card metadata は MIT を表示する |
| custom file headers | `configuration_florence2.py`、`modeling_florence2.py`、`processing_florence2.py` は Apache-2.0 header を持つ |
| exact code mapping | `config.json` の `auto_map` は repository 内の custom Python class を指す。README の例は `trust_remote_code=True` を指定する |
| NOTICE | 固定 HF tree API の file 一覧に `NOTICE` / `NOTICE.*` はない。ただし「NOTICE file がない」を attribution 不要とは解釈しない |
| source copy / hash | repository に保存 copy なし。取得 response の SHA-256 も本記録にはなく **`unknown`** |
| dependency review | `transformers`、`torch`、`timm`、`einops` 等を含む exact transitive payload と license/SBOM は未審査 |
| C5 判定 | **HOLD**。MIT/Apache-2.0 の code signal は C7 checkpoint または C8 data の承認ではない |

Root MIT と個別 Python file の Apache-2.0 header が併存する。製品同梱時に適用する license text、copyright、変更表示、NOTICE packet の統合判断は `unknown` であり、法務判断を代行しない。

### 2.2 Grounding DINO code

| 項目 | 調査結果 |
|---|---|
| repository | `IDEA-Research/GroundingDINO` |
| release tag source revisions | Swin-T: `ddedf74b250249e0ae81f3781cbf98b3b4d3cb88`、Swin-B: `22292c4b7836b801de2bb8b91cf65c4a24cc6f50` |
| 後発の調査用固定 revision | `856dde20aee659246248e20734ef9ba5214f5e44`。checkpoint table、両 config、後発 loader の技術調査用であり、release asset の build commit とみなさない |
| root code license | Apache License 2.0 |
| license text の技術的読取り | 条件付きの使用・複製・派生物・再配布 grant を含む。ただし exact checkpoint へ適用したとは判断しない |
| source build | `setup.py` は PyTorch C++/CUDA extension の build 経路と、PyTorch 不在時の install 呼出しを含む。製品の locked/offline build には未適合 |
| NOTICE / attribution inventory | 後発の調査用 revision の recursive tree API は `truncated: false` で、basename が `NOTICE` または `NOTICE.*` の path は 0 件。これは attribution 不要の証明ではなく、release tag source と最終配布 packet の確認は未完 |
| source copy / hash | repository に保存 copy なし。取得 response の SHA-256 は **`unknown`** |
| transitive dependency review | `torch`、`torchvision`、`transformers`、native extension 等の exact lock/SBOM は未完 |
| C5 判定 | **コード license の一次資料を確認しただけ / C7 は HOLD** |

## 3. Checkpoint 層審査（C7）— 重みファイル自体のライセンス

| 項目 | Florence-2-base-ft | Grounding DINO Swin-T | Grounding DINO Swin-B |
|---|---|---|---|
| checkpoint 固有 license | HF metadata/root LICENSE は MIT を表示するが、`Software` が exact weight binary を含むという publisher の明示的な checkpoint-scope statement は確認できず **`unknown`** | release asset 固有 license statement を確認できず **`unknown`** | release asset 固有 license statement を確認できず **`unknown`** |
| code license からの推定 | **しない** | Apache-2.0 root code license を weight へ拡張しない | Apache-2.0 root code license を weight へ拡張しない |
| commercial product use | **`unknown` / 未承認** | **`unknown` / 未承認** | **`unknown` / 未承認** |
| installer 再配布 | **`unknown` / 未承認** | **`unknown` / 未承認** | **`unknown` / 未承認** |
| Fine-Tuning / ONNX 変換 | 技術的可能性と法的許諾を分離。派生 artifact の条件は **`unknown`** | **`unknown`** | **`unknown`** |
| checkpoint attribution / NOTICE | **`unknown`** | **`unknown`** | **`unknown`** |
| exact binary SHA-256 | known via publisher LFS metadata。local 再計算は `NOT_RUN` | **`unknown`** | **`unknown`** |
| legal decision authority の署名 | なし | なし | なし |
| C7 判定 | **HOLD** | **HOLD** | **HOLD** |

MIT/Apache-2.0 が一般に permissive と分類されることは、権利主体、checkpoint への適用範囲、学習元データ、商用製品への再配布を本件で承認する証拠ではない。

## 4. 学習データ由来審査（C8）— 全公開データセットと terms

### 4.1 記録原則

- 以下は公開一次資料が**名称として開示した dataset** を列挙したものであり、各 dataset の利用許諾を表さない。
- dataset 名、論文引用、benchmark score、公開 download の存在を、商用利用・derived checkpoint 再配布の許諾へ読み替えない。
- exact snapshot、split、画像単位 provenance、annotation license、terms URL、取得時 terms copy/hash のいずれかが不明なら C8 は不合格とする。
- Florence-2 の論文 Appendix B は generalist fine-tuning collection を示すが、そこから HF の exact `base-ft` binary までの publisher-signed bill of materials は確認できていない。
- Grounding DINO の paper が記述する Swin-L の data を、Swin-B release asset へ転用しない。

### 4.2 Florence-2-base-ft — 公開された pre-training data

| 公開名 | 公開資料上の役割 | exact snapshot / split | dataset terms URL・取得日・保存 hash | 判定 |
|---|---|---|---|---|
| FLD-5B | 126M images、5.4B annotations の pre-training corpus | exact artifact と image/annotation manifest は未公開または未確認 | **`unknown`** | BLOCKED |
| ImageNet-22K | FLD-5B の画像 source | `unknown` | **`unknown`** | BLOCKED |
| Objects365 | FLD-5B の画像 source。既存 annotation と synthetic label を統合 | version/split `unknown` | **`unknown`** | BLOCKED |
| Open Images | FLD-5B の画像 source | version/split `unknown` | **`unknown`** | BLOCKED |
| Conceptual Captions | FLD-5B の画像 source | version/split `unknown` | **`unknown`** | BLOCKED |
| LAION（paper reference は LAION-400M） | BLIP-filtered source と記載 | filter、snapshot、残存画像一覧 `unknown` | **`unknown`** | BLOCKED |
| Specialist-model / cloud-service generated annotations | caption、box、OCR、grounding、mask 等の synthetic annotation | 使用 model/service の完全な版・terms・output rights `unknown` | **`unknown`** | BLOCKED |

FLD-5B paper は Azure AI Services OCR、DINO、Florence-1、Grounding DINO、SAM、LLM/LMM 等による annotation 生成も説明する。しかし使用した exact service/model versions、各 output の権利条件、全 source image の rights manifest は揃っていない。

### 4.3 Florence-2-base-ft — 公開された fine-tuning data

重複使用は一行に統合し、paper Appendix B が名称を開示した distinct dataset を列挙する。

| 公開名 | 公開資料上の task | exact snapshot / split | dataset terms URL・取得日・保存 hash | 判定 |
|---|---|---|---|---|
| COCO / COCO Captions | caption、detection、region-to-category、region-to-polygon | split・annotation revision の完全対応 `unknown` | **`unknown`** | BLOCKED |
| TextCaps | text caption | `unknown` | **`unknown`** | BLOCKED |
| Stanford Image-Paragraph Captions | paragraph caption | `unknown` | **`unknown`** | BLOCKED |
| Localized Narratives | detailed caption | dataset/version `unknown` | **`unknown`** | BLOCKED |
| Objects365 | detection、phrase grounding、region-to-category。FLD-5B annotation と統合と記載 | version/split `unknown` | **`unknown`** | BLOCKED |
| Open Images | detection、phrase grounding、region-to-category。FLD-5B annotation と統合と記載 | version/split `unknown` | **`unknown`** | BLOCKED |
| Flickr30k / Flickr30k Entities | phrase grounding | exact artifact mapping `unknown` | **`unknown`** | BLOCKED |
| RefCOCO | referring expression / segmentation | split `unknown` | **`unknown`** | BLOCKED |
| RefCOCO+ | referring expression / segmentation | split `unknown` | **`unknown`** | BLOCKED |
| RefCOCOg | referring expression / segmentation | split `unknown` | **`unknown`** | BLOCKED |
| VQAv2 | VQA | `unknown` | **`unknown`** | BLOCKED |
| OK-VQA | VQA | `unknown` | **`unknown`** | BLOCKED |
| A-OKVQA | VQA | `unknown` | **`unknown`** | BLOCKED |
| TextVQA | VQA | `unknown` | **`unknown`** | BLOCKED |
| VizWiz VQA | VQA | `unknown` | **`unknown`** | BLOCKED |
| FLD-5B OCR subset | OCR、2M samples と記載 | sample manifest `unknown` | **`unknown`** | BLOCKED |

### 4.4 Grounding DINO Swin-T — 公開された training data

| 公開名 | Publisher disclosure | exact snapshot / recursively disclosed components | dataset terms URL・取得日・保存 hash | 判定 |
|---|---|---|---|---|
| Objects365 / O365v1 | 後発の調査用 revision の README checkpoint table は `O365`、paper Appendix は Tiny に O365v1（約600K images）を記載 | exact revision/split `unknown` | **`unknown`** | BLOCKED |
| GoldG | 後発の調査用 revision の README checkpoint table と paper が記載 | MDETR preprocessing。Flickr30k Entities と Visual Genome を含むと paper が記載するが exact manifest は `unknown` | **`unknown`** | BLOCKED |
| Flickr30k Entities | GoldG component | exact version/split `unknown` | **`unknown`** | BLOCKED |
| Visual Genome | GoldG component | exact version/split `unknown` | **`unknown`** | BLOCKED |
| Cap4M | README checkpoint table と paper が記載 | GLIP-T annotated caption data と記載。元画像 dataset、exact pseudo-labeler、snapshot、4M item manifest は `unknown` | **`unknown`** | BLOCKED |

### 4.5 Grounding DINO Swin-B — 公開された training data と不一致

| Source | 公開された data 表記 |
|---|---|
| 後発の調査用 revision の README checkpoint table | `COCO,O365,GoldG,Cap4M,OpenImage,ODinW-35,RefCOCO` |
| GitHub release `v0.1.0-alpha2` body | `O365, VG, RefCOCO, COCO, OpenImage, Cap4M, ODinW-35` |
| Grounding DINO paper v5 | 主な model variants は Swin-T / Swin-L。Swin-B release asset の exact recipe を同定する記述としては使用できない |

README の `GoldG` と release body の `VG`、`RefCOCO` の範囲、Objects365 の version、各 split が一致するかは **`unknown`**。`GoldG` が Visual Genome を含むという paper の一般説明だけで両表記を同一と確定しない。

| 公開名 | exact snapshot / recursively disclosed components | dataset terms URL・取得日・保存 hash | 判定 |
|---|---|---|---|
| COCO | split・annotation revision `unknown` | **`unknown`** | BLOCKED |
| Objects365 | v1/v2、split `unknown` | **`unknown`** | BLOCKED |
| GoldG | README にのみこの名称。exact composition `unknown` | **`unknown`** | BLOCKED |
| Visual Genome / `VG` | release body に記載。GoldG との関係を checkpoint 単位で証明できない | **`unknown`** | BLOCKED |
| Cap4M | 元画像 source、snapshot、pseudo-label provenance `unknown` | **`unknown`** | BLOCKED |
| Open Images / `OpenImage` | version/split `unknown` | **`unknown`** | BLOCKED |
| ODinW-35 | 35 dataset の exact version、split、training inclusion manifest が `unknown`。各 constituent terms も未列挙 | **`unknown`** | BLOCKED |
| RefCOCO | RefCOCO 単体か RefCOCO/+/g 集合か、split が `unknown` | **`unknown`** | BLOCKED |

### 4.6 C8 結論

3 checkpoint とも、全公開 dataset の exact snapshot、全 terms、取得日付き保存 copy/hash、商用製品での利用・derived checkpoint 再配布に関する権限者判断が揃っていない。したがって **C8 は不合格状態であり、C7 を同梱できない**。

## 5. NOTICE・帰属表示（FR-LIC-002/012）

| 対象 | 確認できたこと | 未解決事項 |
|---|---|---|
| Florence HF root | MIT text が存在する | exact checkpoint を含む適用範囲、copyright/attribution、配布時 license packet |
| Florence custom Python files | Apache-2.0 header が存在する | root MIT との整理、変更表示、transitive notices、最終 `THIRD_PARTY_NOTICES` |
| Florence fixed tree | `NOTICE` / `NOTICE.*` file は一覧にない | absence を表示義務なしへ読み替えない。checkpoint/data attribution は `unknown` |
| Grounding DINO code | Apache-2.0 root LICENSE が存在する。後発の調査用 revision の完全 recursive tree では `NOTICE` / `NOTICE.*` basename 0 件 | release tag source の NOTICE inventory、native/transitive notices、変更表示、最終 packet |
| Grounding DINO checkpoints | release asset を確認 | weight 固有 copyright、license、attribution、NOTICE は **`unknown`** |
| Training datasets | 名称のみを抽出 | dataset ごとの attribution、citation、display、derived-output 条件は **`unknown`** |
| AutoVision Studio UI / installer | 未作成 | アプリ内 license 画面、installer 添付、SBOM と一致する最終文面 |

NOTICE 内容を推測して作成せず、採用候補確定後に権限者が承認した exact packet を生成する。

## 6. 安全形式・リモートコード（FR-SEC-007/004/LIC-011）

### 6.1 Florence-2-base-ft

| 項目 | 調査結果 |
|---|---|
| weight format | 選択 file は `safetensors`。HF tree API は size/LFS hash と scanner status を提示する |
| local payload inspection | tensor 名、shape、dtype、NaN/Inf、metadata、hash 再計算は **`NOT_RUN`** |
| executable model code | `config.json` の `auto_map` が `configuration_florence2.py` と `modeling_florence2.py` を指す。processor 用 `processing_florence2.py` も repository 内にある |
| publisher example | model と processor の load に `trust_remote_code=True` を指定する |
| source pinning | HF revision は固定したが、3 Python file の保存 copy/SHA-256、code review、allowlist、vendor 化は未実施 |
| network isolation | runtime network 0、`local_files_only`、offline cache、hash-before-load は **`NOT_RUN`** |
| scanner metadata | publisher platform の scanner 表示は参考情報。製品側の binary/source verification、CVE review、法務承認を代替しない |
| 判定 | **HOLD**。安全な weight container だけでは、remote/custom code と依存実行を含む load path は合格しない |

製品 runtime で repository から Python を取得・実行することは許可しない。将来再審査する場合も、権利承認後に exact source を vendor 化して hash/静的審査し、network を遮断した local-only 経路を実証する必要がある。

### 6.2 Grounding DINO Swin-T / Swin-B

| 項目 | 調査結果 |
|---|---|
| weight format | 2 asset とも `.pth` |
| publisher digest | 2 asset とも GitHub API `digest: null`。SHA-256 **`unknown`** |
| source ごとの loader 確認 | Swin-T tag commit には `groundingdino/util/inference.py` が存在しない。Swin-B tag commit と後発の調査用 revision の同 path は `torch.load(model_checkpoint_path, map_location="cpu")` を呼び、`weights_only` を明示しない |
| `weights_only` の実効値 | この callsite では `pickle_module` も省略される。PyTorch 2.5.1 は省略時 `False`、2.6 以降は通常 `True`。ただし `TORCH_FORCE_WEIGHTS_ONLY_LOAD=1` は全 callsite を `True` にし、`TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1` は引数省略 callsite を `False` にする。Grounding DINO の inspected setup/requirements は PyTorch を無版指定とする |
| 製品側 dependency lock との境界 | 現在の `ml/pyproject.toml` / `ml/uv.lock` は `torch==2.11.0` を固定するため、環境 override がなければ当該省略 callsite は `weights_only=True` になる。ただし Grounding DINO は製品 dependency/payload に未採用であり、exact asset の compatibility と実効環境は **`NOT_RUN`** |
| restricted deserialization | loader 自身は restricted mode を明示・保証していない。製品では環境依存の既定値に委ねず `weights_only=True` を明示し、必要な allowlist と payload inventory を審査する必要がある。隔離環境での確認は **`NOT_RUN`** |
| code-to-binary mapping | release asset と各 tag commit、後発の調査用 revision の生成関係は **`unknown`** |
| native code | `setup.py` は C++/CUDA extension 経路を持つ。Windows/macOS の再現 build、operator fallback、payload hash は **`NOT_RUN`** |
| network isolation | official README は事前 download を説明するが、製品の runtime download 拒否・offline local-only load は **`NOT_RUN`** |
| 判定 | **HOLD**。完全 hash、candidate-specific runtime/environment control、payload inventory、source-to-binary provenance がなく、安全な restricted load を実証していないため現状では load しない |

## 7. 一次資料・証拠ハッシュ（FR-LIC-014）

### 7.1 証拠状態

- 下表は 2026-09-03 に取得した publisher repository、official release API、official model repository、paper host の URL である。
- URL 取得は保存 copy の作成ではない。今回の許可範囲は本ファイルのみのため、別の evidence file は作成していない。
- 取得 response bytes、取得時 SHA-256、保存 copy path、保存 copy SHA-256 を本記録には保持しておらず、すべて **`unknown`** である。この不足だけでも FR-LIC-014 は未達である。
- checkpoint hash と source-document hash を混同しない。

### 7.2 Florence-2 sources

| 資料 | 固定 URL | 主な根拠 | 保存 copy / SHA-256 |
|---|---|---|---|
| HF model API | `https://huggingface.co/api/models/microsoft/Florence-2-base-ft/revision/f6c1a25888ffc1d945ee8a1a77ac833c7303d46e` | revision、file inventory、license metadata、custom-code tag | なし / **`unknown`** |
| HF tree API | `https://huggingface.co/api/models/microsoft/Florence-2-base-ft/tree/f6c1a25888ffc1d945ee8a1a77ac833c7303d46e?recursive=true&expand=true` | `model.safetensors` の exact size と LFS oid、custom source inventory | なし / **`unknown`** |
| Model card | `https://huggingface.co/microsoft/Florence-2-base-ft/raw/f6c1a25888ffc1d945ee8a1a77ac833c7303d46e/README.md` | capability、`<OD>` output、`trust_remote_code=True`、upstream metrics | なし / **`unknown`** |
| Root LICENSE | `https://huggingface.co/microsoft/Florence-2-base-ft/raw/f6c1a25888ffc1d945ee8a1a77ac833c7303d46e/LICENSE` | MIT text | なし / **`unknown`** |
| Config | `https://huggingface.co/microsoft/Florence-2-base-ft/raw/f6c1a25888ffc1d945ee8a1a77ac833c7303d46e/config.json` | architecture、`auto_map`、dtype | なし / **`unknown`** |
| Configuration code | `https://huggingface.co/microsoft/Florence-2-base-ft/raw/f6c1a25888ffc1d945ee8a1a77ac833c7303d46e/configuration_florence2.py` | executable custom code / Apache-2.0 header | なし / **`unknown`** |
| Model code | `https://huggingface.co/microsoft/Florence-2-base-ft/raw/f6c1a25888ffc1d945ee8a1a77ac833c7303d46e/modeling_florence2.py` | executable model implementation / dependencies | なし / **`unknown`** |
| Processor code | `https://huggingface.co/microsoft/Florence-2-base-ft/raw/f6c1a25888ffc1d945ee8a1a77ac833c7303d46e/processing_florence2.py` | prompt mapping、post-process、executable custom code | なし / **`unknown`** |
| Florence-2 paper v1 | `https://arxiv.org/html/2311.06242v1` | FLD-5B sources、fine-tuning collection、paper metrics | なし / **`unknown`** |

### 7.3 Grounding DINO sources

| 資料 | 固定 URL | 主な根拠 | 保存 copy / SHA-256 |
|---|---|---|---|
| Swin-T tag ref API | `https://api.github.com/repos/IDEA-Research/GroundingDINO/git/ref/tags/v0.1.0-alpha` | tag → commit `ddedf74b250249e0ae81f3781cbf98b3b4d3cb88` | なし / **`unknown`** |
| Swin-B tag ref API | `https://api.github.com/repos/IDEA-Research/GroundingDINO/git/ref/tags/v0.1.0-alpha2` | tag → commit `22292c4b7836b801de2bb8b91cf65c4a24cc6f50` | なし / **`unknown`** |
| Later investigation README | `https://raw.githubusercontent.com/IDEA-Research/GroundingDINO/856dde20aee659246248e20734ef9ba5214f5e44/README.md` | checkpoint table、capability、data labels、download links。asset build source の証明ではない | なし / **`unknown`** |
| Later investigation LICENSE | `https://raw.githubusercontent.com/IDEA-Research/GroundingDINO/856dde20aee659246248e20734ef9ba5214f5e44/LICENSE` | Apache-2.0 code license text | なし / **`unknown`** |
| Later investigation recursive tree API | `https://api.github.com/repos/IDEA-Research/GroundingDINO/git/trees/856dde20aee659246248e20734ef9ba5214f5e44?recursive=1` | `truncated: false`、`NOTICE` / `NOTICE.*` basename 0 件 | なし / **`unknown`** |
| Swin-T release API | `https://api.github.com/repos/IDEA-Research/GroundingDINO/releases/tags/v0.1.0-alpha` | asset name、size、`digest: null`、URL | なし / **`unknown`** |
| Swin-B release API | `https://api.github.com/repos/IDEA-Research/GroundingDINO/releases/tags/v0.1.0-alpha2` | asset name、size、`digest: null`、URL、release data statement | なし / **`unknown`** |
| Swin-B tag inference loader | `https://raw.githubusercontent.com/IDEA-Research/GroundingDINO/22292c4b7836b801de2bb8b91cf65c4a24cc6f50/groundingdino/util/inference.py` | `torch.load` は path / `map_location` のみを明示し、`weights_only` を省略 | なし / **`unknown`** |
| Later investigation inference loader | `https://raw.githubusercontent.com/IDEA-Research/GroundingDINO/856dde20aee659246248e20734ef9ba5214f5e44/groundingdino/util/inference.py` | 同じ引数省略、preprocess、threshold example。Swin-T tag commit にはこの path がない | なし / **`unknown`** |
| Later investigation setup | `https://raw.githubusercontent.com/IDEA-Research/GroundingDINO/856dde20aee659246248e20734ef9ba5214f5e44/setup.py` | native extension / install behavior、exact PyTorch version 非固定 | なし / **`unknown`** |
| PyTorch 2.5.1 serialization source | `https://raw.githubusercontent.com/pytorch/pytorch/v2.5.1/torch/serialization.py` | 2.6 より前の `weights_only` 省略時挙動 | なし / **`unknown`** |
| PyTorch 2.11.0 serialization notes | `https://raw.githubusercontent.com/pytorch/pytorch/v2.11.0/docs/source/notes/serialization.rst` | 2.6 以降の既定値変更、環境変数 override、restricted mode の限界 | なし / **`unknown`** |
| Grounding DINO paper v5 | `https://arxiv.org/html/2303.05499v5` | training-data description、limitations、social impacts、paper metrics | なし / **`unknown`** |

Local dependency evidence は `ml/pyproject.toml` と `ml/uv.lock` であり、現在の worker baseline に `torch==2.11.0` を固定している。ただし、これは Grounding DINO asset の製品採用、source-to-binary mapping、payload compatibility、実行時環境変数を証明しない。

Dataset terms の一次資料 URL と保存 hash は §4 の全行で未収集である。paper の reference URL を dataset terms URL とみなさない。

## 8. Model Card — Intended Use / Out-of-Scope Use（C7 必須）

### 8.1 Florence-2-base-ft

| 項目 | 調査結果 |
|---|---|
| capability description | caption、object detection、dense region caption、grounding、OCR 等を prompt で実行できると記載 |
| intended use | 独立した、checkpoint-specific な intended-use 条件の記載を確認できず **`unknown`** |
| out-of-scope use | 独立した out-of-scope / prohibited-use 節を確認できず **`unknown`** |
| limitation / bias | product domain、false positive、class coverage、bias、安全性に対する十分な model-card 記録を確認できず **`unknown`** |
| AutoVision Studio との技術対応 | `<OD>` が labels と bboxes を返すため技術候補にはなるが、製品用途・商用再配布・品質適合を意味しない |
| C7 model-card 判定 | **FAIL / BLOCKED**。capability table を intended/out-of-scope の代用にしない |

### 8.2 Grounding DINO Swin-T / Swin-B

| 項目 | 調査結果 |
|---|---|
| dedicated checkpoint model card | 公式 release asset ごとの model card を確認できず **`unknown`** |
| capability description | image/text pair から open-set object boxes と phrases を出すと README/paper が説明 |
| intended use | release checkpoint 固有の intended-use 条件は **`unknown`** |
| out-of-scope use | release checkpoint 固有の out-of-scope / prohibited-use 条件は **`unknown`** |
| paper limitations | segmentation 非対応、false positive が発生し得る、accuracy/correctness を保証できないと記載 |
| paper social impacts | adversarial attack の脆弱性と unlawful purpose への悪用リスクを記載 |
| C7 model-card 判定 | **FAIL / BLOCKED**。paper の一般的な limitations/social impacts を checkpoint model card の代用にしない |

## 9. タスク仕様・推論定義（NFR-ANN-004）

公開例と製品仕様を区別する。以下の upstream 値は採用済み設定ではない。

| 項目 | Florence-2-base-ft | Grounding DINO Swin-T | Grounding DINO Swin-B |
|---|---|---|---|
| 技術上の役割 | generic object detection / label と bbox の候補生成 | text/class-guided open-set detection | text/class-guided open-set detection |
| upstream input | image + task prompt `<OD>` | image + category names / referring expression | image + category names / referring expression |
| upstream preprocess | pinned `AutoProcessor` / repository processor。exact product preprocess は未固定 | pinned example は RGB、resize 800/max 1333、tensor、ImageNet mean/std normalize | Swin-B config と product preprocess の exact 固定は未実施 |
| upstream output | `bboxes`, `labels`。documented `<OD>` result に calibrated model score はない | boxes、phrases、max text-similarity value | boxes、phrases、max text-similarity value |
| upstream prompt guidance | `<OD>` | category names を `.` で分離する案内 | 同系統だが exact product prompt は未固定 |
| example threshold | dedicated detection threshold の採用値なし | README/inference API の例は box `0.35`、text `0.25` | exact adopted threshold **`unknown`** |
| product class mapping | **`unknown`** | Project Label Schema からの prompt/mapping は **`unknown`** | **`unknown`** |
| score semantics / calibration | **`unknown`** | raw similarity の意味・calibration・UI 表示は **`unknown`** | **`unknown`** |
| deterministic settings / seed | **`NOT_RUN`** | **`NOT_RUN`** | **`NOT_RUN`** |
| product post-process / NMS | **`unknown`** | **`unknown`** | **`unknown`** |
| NFR-ANN-004 判定 | **未適合** | **未適合** | **未適合** |

Upstream README の例示 threshold、beam 数、公開 score を製品の採用基準として固定しない。SPI-17 の representative gold set とユーザー確認 workflow を先に定義する必要がある。

## 10. OS・Execution Provider 互換性（POC-03/08/16）

| 試験 | Florence-2-base-ft | Grounding DINO Swin-T | Grounding DINO Swin-B | 承認への影響 |
|---|---|---|---|---|
| Windows 11 x64 / CPU local load + inference | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` | Windows fallback 未証明 |
| Windows 11 x64 / CUDA | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` | GPU operator・driver・memory 未証明 |
| Windows 11 x64 / ONNX Runtime DirectML | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` | export/operator coverage 未証明 |
| macOS arm64 / CPU | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` | native Mac 証拠なし |
| macOS arm64 / MPS | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` | operator fallback・memory 未証明 |
| macOS arm64 / ONNX Runtime CoreML | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` | export/operator coverage 未証明 |
| 固定 input ONNX export | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` | POC-08 未達 |
| PyTorch/ONNX tensor parity | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` | tolerance 未評価 |
| 完全 offline / runtime network 0 | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` | FR-LIC-011 / POC-16 未達 |
| installer 同梱・署名・起動 | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` | payload gate 未達 |

公開 repository が CPU mode を説明すること、または upstream library が特定 device を一般に支援することは、AutoVision Studio の exact artifact/lock/installer での合格証拠ではない。

## 11. 精度・パフォーマンス・サイズ

| 項目 | Florence-2-base-ft | Grounding DINO Swin-T | Grounding DINO Swin-B |
|---|---:|---:|---:|
| exact candidate file size | `463,221,266` bytes | `693,997,677` bytes | `938,057,991` bytes |
| local detection quality | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| local class coverage | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| p50 / p95 latency | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| sustained FPS | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| peak RAM / VRAM | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| derived ONNX size | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| installed payload delta | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |

Model card、README、paper の COCO 等の benchmark 値は upstream 条件の参考であり、AutoVision Studio の実測ではない。本記録は upstream 値を local accuracy、製品 quality、または採用 threshold として転記しない。

## 12. 補助 / 手動比較試験（NFR-ANN-006）— C7 必須

SPI-17 の representative gold set、測定手順、採用基準はまだ実行されていない。

| 必須項目 | Florence-2-base-ft | Grounding DINO Swin-T | Grounding DINO Swin-B |
|---|---|---|---|
| dataset / class / split / sample count | `unknown` | `unknown` | `unknown` |
| annotator count / experience / randomization | `unknown` | `unknown` | `unknown` |
| manual-only baseline | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| candidate coverage | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| accept rate | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| edit rate | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| reject rate | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| final Ground Truth quality | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| annotation median time | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| 未確認候補の学習除外 | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| 結論 | **不合格 / 未測定** | **不合格 / 未測定** | **不合格 / 未測定** |

Accuracy、時間短縮、受諾率を推測しない。NFR-ANN-006 は「最終品質を悪化させず、annotation 所要時間を短縮する」実測が両方必要であり、どちらか一方または upstream benchmark では代替できない。

## 13. セキュリティ・脆弱性（NFR-SEC-003/G-DEP-04）

| 項目 | 状態 | 停止理由 |
|---|---|---|
| exact weight の local malware/object scan | `NOT_RUN` | binary 未取得 |
| exact weight の hash-before-load | Florence: `NOT_RUN`; Grounding DINO: 実施不能 | Florence は metadata hash のみ。Grounding DINO は期待 SHA-256 が `unknown` |
| Florence custom source の静的 review | `NOT_RUN` | 保存 copy/hash/allowlist なし |
| Grounding DINO `.pth` の restricted load | `NOT_RUN` | inspected loader は `weights_only` を明示しない。現行製品 lock なら通常 `True` だが、環境 override、exact payload compatibility、allowlist を未確認 |
| C5/C7 runtime dependency の Critical/High CVE review | `NOT_RUN` | exact lock/SBOM 未確定 |
| native extension supply-chain review | `NOT_RUN` | Grounding DINO build/payload 未固定 |
| malformed image / oversized input / resource exhaustion | `NOT_RUN` | input limit、timeout、memory cap 未固定 |
| adversarial image / prompt / false-positive evaluation | `NOT_RUN` | Grounding DINO paper 自身が adversarial risk と false positive を記載 |
| bias / domain coverage | `NOT_RUN` | 製品 representative set 未定義 |
| runtime egress denial | `NOT_RUN` | offline integration 未実装 |

HF platform の scanner status は単一時点の外部 metadata であり、AutoVision Studio の G-DEP-04、hash verification、source review、runtime isolation を合格にしない。

## 14. リリースマニフェスト対応付け（FR-LIC-010/NFR-INS-007）

| 項目 | 状態 |
|---|---|
| `resources/models/manifest.json` への C7 detection entry | **なし / 追加禁止** |
| approved model ID | **なし** |
| approved local relative path | **なし** |
| approved SHA-256 | Florence は candidate metadata hash のみ。Grounding DINO は **`unknown`**。承認済み値は **なし** |
| approved license / NOTICE record | **なし** |
| approved source evidence copy/hash | **なし** |
| approver / approval date | **なし** |
| installer payload | **なし** |
| release-ready status | **false のまま** |

Candidate registry と release manifest を混同しない。manifest は fully approved artifact の allowlist であり、本記録の HOLD 候補を記録する場所ではない。

## 15. 判定・承認（FR-LIC-014/G-DEP-08）

### 15.1 Candidate decision matrix

| Gate | Florence-2-base-ft | Grounding DINO Swin-T | Grounding DINO Swin-B |
|---|---|---|---|
| exact identity | PARTIAL PASS | PARTIAL PASS | PARTIAL PASS |
| complete SHA-256 | metadata only / local verification `NOT_RUN` | **FAIL — `unknown`** | **FAIL — `unknown`** |
| C5 code review | HOLD | HOLD | HOLD |
| C7 checkpoint rights | **FAIL — `unknown`** | **FAIL — `unknown`** | **FAIL — `unknown`** |
| C8 all datasets + terms | **FAIL — `unknown`** | **FAIL — `unknown`** | **FAIL — `unknown`** |
| intended / out-of-scope | **FAIL — `unknown`** | **FAIL — `unknown`** | **FAIL — `unknown`** |
| NOTICE / attribution | **FAIL — `unknown`** | **FAIL — `unknown`** | **FAIL — `unknown`** |
| safe offline load | **FAIL — `NOT_RUN` / custom code** | **FAIL — restricted load 未実証 / `NOT_RUN`** | **FAIL — restricted load 未実証 / `NOT_RUN`** |
| OS / ONNX / performance | **FAIL — `NOT_RUN`** | **FAIL — `NOT_RUN`** | **FAIL — `NOT_RUN`** |
| manual-only comparison | **FAIL — `NOT_RUN`** | **FAIL — `NOT_RUN`** | **FAIL — `NOT_RUN`** |
| security / CVE | **FAIL — `NOT_RUN`** | **FAIL — `NOT_RUN`** | **FAIL — `NOT_RUN`** |
| legal approval | **なし** | **なし** | **なし** |
| final | **HOLD / 未承認** | **HOLD / 未承認** | **HOLD / 未承認** |

`PARTIAL PASS` は公開 identity metadata の照合範囲だけを表し、採用条件の合格ではない。

### 15.2 Fail-closed blockers

| ID | Blocker | 影響 |
|---|---|---|
| DA-B01 | exact checkpoint へ適用される license scope、commercial use、installer redistribution が権限者により確定していない | 3 candidate とも同梱不可 |
| DA-B02 | 全公開 training dataset の exact snapshot、全 terms、保存 copy/hash、法務判断がない | 3 candidate とも C8 不合格 |
| DA-B03 | 一次資料の保存 copy と SHA-256 がない | FR-LIC-014 不合格 |
| DA-B04 | checkpoint-specific intended use / out-of-scope が `unknown` | C7 必須 gate 不合格 |
| DA-B05 | Florence custom code の vendor/hash/review/offline path がない。Grounding DINO は loader が `weights_only` を明示せず、candidate-specific runtime/environment control、payload inventory、restricted-load compatibility が未確認 | 安全な load 不合格 |
| DA-B06 | Grounding DINO 2 asset の SHA-256 が `unknown` | 完全性照合不能 |
| DA-B07 | Swin-B の README/release/paper provenance が一致せず、ODinW-35 の再帰 inventory もない | Swin-B data BOM 不確定 |
| DA-B08 | OS/EP、ONNX parity、latency/FPS/memory、quality、manual-only 比較が全て `NOT_RUN` | POC-16 / NFR-ANN-006 不合格 |
| DA-B09 | final NOTICE/SBOM/attribution packet がない | installer/release 不可 |
| DA-B10 | 法務承認者、repository license decision authority、承認日がない | approval 0 件 |

### 15.3 再審査の必要条件

1. Publisher または権利主体による exact checkpoint の license scope、商用利用、再配布、変換/Fine-Tuning 条件を immutable な一次資料で取得する。
2. 各 candidate binary を承認済み隔離環境へ取得し、期待 SHA-256 を独立計算する。Grounding DINO は publisher hash との照合材料も必要とする。
3. 全公開 training dataset を再帰的に展開し、exact version/split、terms URL、取得日、保存 copy/hash、商用製品判断を dataset ごとに記録する。
4. checkpoint-specific intended/out-of-scope、limitations、bias を満たす model card または権限者補足文書を取得する。
5. Florence custom source を固定・保存・hash・review する。Grounding DINO は source/tag/runtime を固定し、非実行静的検査、明示的 restricted load、allowlist、safe-format 変換の経路を確立する。
6. offline local-only load、Windows/macOS、CPU/GPU/EP、ONNX parity、性能、security/CVE の全試験を exact lock で完了する。
7. SPI-17 で representative gold set の manual-only 比較を事前定義し、最終品質非劣化と annotation 時間短縮を実測する。
8. NOTICE、SBOM、アプリ内表示、installer payload を確定し、権限者が氏名・役割・日付付きで書面承認する。

### 15.4 最終結論

**SPI-14 の調査時点で、商用製品へ同梱できる C7 detection checkpoint は 0 件である。Florence-2-base-ft、Grounding DINO Swin-T、Grounding DINO Swin-B はすべて未承認であり、既定選択、download、load、manifest 登録、installer 同梱を行わない。G-DEP-08 および Gate 2 は BLOCKED のまま維持する。**

## 16. 記入完了チェックリスト

チェック済みは調査作業の完了だけを示し、checkpoint の承認ではない。

### 16.1 ライセンス審査

- [x] C5 code と C7 checkpoint を分離した。
- [x] code license だけで checkpoint を承認しなかった。
- [ ] exact checkpoint の license scope、commercial use、redistribution を権限者が承認した。
- [ ] Fine-Tuning / ONNX 変換後の条件を確定した。

### 16.2 学習データ由来

- [x] 公開資料が名称を開示した dataset を候補ごとに抽出した。
- [x] Swin-B の公開資料間不一致を `unknown` のまま記録した。
- [ ] 全 dataset の exact snapshot/split を確定した。
- [ ] 全 dataset terms URL、取得日、保存 copy/hash を記録した。
- [ ] 全 C8 条件を権限者が商用製品用途として承認した。

### 16.3 証拠記録

- [x] publisher の固定 revision/release URL と取得日を記録した。
- [x] artifact hash と source-document hash を区別した。
- [ ] 一次資料の保存 copy と SHA-256 を添付した。
- [ ] 可変 release/API source の再現可能 snapshot を保管した。

### 16.4 安全形式・リモートコード

- [x] Florence の safetensors と custom-code requirement を分離した。
- [x] Grounding DINO の `.pth`、tag ごとの source identity、`weights_only` を明示しない loader と version/environment 依存性を確認した。
- [ ] exact binary を hash-before-load で検証した。
- [ ] remote code/network なしの local-only path を実証した。
- [ ] object/tensor inventory と安全な変換を完了した。

### 16.5 Model Card（C7 必須）

- [x] 公開 capability と paper limitations を調査した。
- [ ] checkpoint-specific intended use を確認した。
- [ ] checkpoint-specific out-of-scope use を確認した。
- [ ] 製品 domain の bias/limitations を評価した。

### 16.6 NOTICE・帰属表示

- [ ] checkpoint/data を含む attribution requirement を確定した。
- [ ] `THIRD_PARTY_NOTICES` とアプリ内表示を作成した。
- [ ] SBOM と installer payload の一致を検証した。

### 16.7 技術性能

- [ ] Windows/macOS の CPU/GPU/EP 試験を完了した。
- [ ] ONNX export と parity を完了した。
- [ ] p95 latency、FPS、memory、payload size を実測した。
- [ ] deterministic input/prompt/threshold/post-process を固定した。

### 16.8 品質比較試験（C7 必須）

- [ ] representative gold set と採用基準を事前定義した。
- [ ] manual-only baseline を実行した。
- [ ] coverage/accept/edit/reject/final quality/time を実測した。
- [ ] 最終 Ground Truth の非劣化と時間短縮を両方確認した。

### 16.9 セキュリティ

- [ ] exact source/binary/dependency の Critical/High CVE review を完了した。
- [ ] malformed/adversarial input と resource cap を試験した。
- [ ] runtime egress denial を実証した。

### 16.10 リリースマニフェスト

- [x] 未承認 candidate を manifest へ追加していない。
- [ ] approved C7 detection entry、local path、hash、license evidence を登録した。
- [ ] installer の余剰・欠落・改変拒否を検証した。

### 16.11 最終承認

- [ ] 法務・repository license decision authority の氏名と役割がある。
- [ ] 承認日がある。
- [ ] G-DEP-08 が PASS である。
- [ ] Gate 2 が PASS である。

## 17. 要求トレーサビリティ

| 要求 / Gate | 状態 | 本記録の根拠 |
|---|---|---|
| FR-LIC-014 | **FAIL / BLOCKED** | C5/C7 分離と candidate identity は記録。checkpoint rights、全 dataset terms、保存 copy/hash、intended/out-of-scope、NOTICE、承認者・承認日が不足 |
| FR-LIC-015 | **PASS（調査方法のみ）** | permissive code license だけで checkpoint を承認していない |
| FR-AST-004 | **BLOCKED** | approved classification/detection C7 が各1件揃うまで同梱・出荷しない。SPI-14 の detection approval は 0 |
| FR-AST-007 | **技術候補のみ / 未承認** | Florence は label/bbox、Grounding DINO は text-guided box/phrase を公開資料で説明。製品 score/mapping/quality は未定 |
| FR-LIC-011 | **NOT_RUN / BLOCKED** | runtime download なし、offline local-only load を未実証 |
| FR-SEC-007 | **FAIL / BLOCKED** | Florence は safetensors だが custom code 未審査。Grounding DINO は hash 不明 `.pth`、source-to-binary mapping 不明、明示的 restricted-load compatibility `NOT_RUN` |
| NFR-ANN-004 | **FAIL / BLOCKED** | exact preprocess、prompt、threshold、score semantics、seed、post-process が未固定 |
| NFR-ANN-006 | **NOT_RUN / BLOCKED** | manual-only 比較、最終品質、annotation 時間を未測定 |
| POC-08 | **NOT_RUN** | ONNX export/parity/OS EP 試験なし |
| POC-16 | **NOT_RUN / BLOCKED** | offline、CPU/CUDA/MPS、installer、candidate workflow、quality/time の全証拠なし |
| TBD-06 | **未解決** | 検出 Annotation Assist Model の承認 0 件 |
| G-DEP-04 | **NOT_RUN / BLOCKED** | exact payload の vulnerability/security review 未完 |
| G-DEP-08 | **BLOCKED** | C7 detection 必須項目に `unknown` / `NOT_RUN` / 承認者不在がある |
| Gate 2 | **BLOCKED** | 本記録は Gate 2 を開かない。C6/C7 の分類・検出、品質、実機、budget の独立承認が別途必要 |
| SPI-17 | **未開始 / BLOCKED** | candidate は未承認、gold set と manual-only benchmark は未実行 |

## 18. 修正後の独立敵対レビュー

2026-09-04 に本記録を read-only で再レビューし、公開一次資料と repository の要求・dependency lock に照合した。

| 攻撃的確認 | 再確認結果 |
|---|---|
| release / tag / asset identity を混同していないか | release ID、asset ID、tag commit、size、`digest: null` を照合し、tag commit と binary build provenance は分離されている |
| 後発の調査用 source を release asset の生成 source にしていないか | `856dde20…` は checkpoint table / config / loader の調査用とし、Swin-T / Swin-B tag commit と asset provenance から分離されている |
| `weights_only` 未指定を版非依存の unrestricted load と断定していないか | PyTorch 2.5.1、2.6 以降、環境変数、現行 `torch==2.11.0` lock を分離し、loader 自身は mode を明示しないと記録している |
| 現行 2.11 lock を safe-load 合格にしていないか | Grounding DINO は未採用で、exact payload compatibility、allowlist、環境、隔離実行を `NOT_RUN` のまま維持している |
| later README の dataset labels を exact release recipe としていないか | Swin-B release body との差を残し、Swin-T / Swin-B とも exact snapshot / recipe を `unknown` としている |
| NOTICE path 不在を表示義務なしと解釈していないか | 後発 revision の完全 tree における basename 0 件という観測に限定し、release tag source と最終 packet を未完としている |
| research record を checkpoint approval に昇格していないか | HOLD 3件、approved detection C7 0件、manifest 未編集、G-DEP-08 / Gate 2 BLOCKED を維持している |

モデル・source assertion に関する **verified factual defect は 0 件**だった。レビュー節の初版では資料取得日 `2026-09-03` をレビュー日として転記していたため、現在日時との照合で確認した **recordkeeping defect 1 件**として実施日 `2026-09-04` へ修正した。修正後の追加欠陥は 0 件であり、DA-B01〜DA-B10 は文書欠陥ではなく未解決の正当な blocker と判定した。checkpoint binary の download、payload inspection、model execution、法務判断はレビュー範囲外であり、実施していない。

したがって、**本 research record は HOLD の根拠として commit 可能**である。一方、**checkpoint 採用、manifest 登録、installer 同梱、G-DEP-08 / Gate 2 解除は不可**であり、model-release readiness は **NO** のままとする。
