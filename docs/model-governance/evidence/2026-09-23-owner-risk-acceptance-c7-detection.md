# Owner risk acceptance record — 2026-09-23（C7 検出の新候補）

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner による書面決定の記録。FR-LIC-016(2)、FR-LIC-003） |
| 決定者 | **dahatake** |
| 役割 | **Product Manager**（決定者の申告による）。license decision authority としての権限の根拠は、repository owner であること（[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-23** |
| 記録者 | 実装担当（本 repository の作業者） |
| 版 | 同日の作成直後に敵対的レビューを受け、確定前に §1〜§3 を訂正した版。確定後は変更しない |
| 状態 | **条件付き**。決定者の意思表示（§0）に基づく書面決定であり、artifact 単位の範囲・条件は §3.2 の確認と署名をもって確定する。確定するまで本書を根拠に採用記録を「承認」にしない |

## 0. 決定の経緯と、決定者の意思表示の範囲

記録者は 2026-09-23 に、「次に必要な判断」の 3 として次を提示した（要旨）。

> 新しい C7 候補を採用する場合: 既存のリスク受容とは別のモデルなので、新たな書面決定が必要です。（候補の表: OmDet-Turbo swin-tiny、OWL-ViT base patch32、TinyCLIP（保留）。OWL-ViT は D2 により書面承認に加えて「研究目的に限る」旨の表示も必要）

決定者の回答（2026-09-23 11:47、原文）:

```text
3
氏名: dahatake
役割: Product Manager
決定日: 2026/9/23
```

回答は artifact の revision・hash を個別に列挙していない。**§1 の artifact 範囲、§2 の未確認項目、§3 の条件は、上記の提示内容に基づき記録者が特定したもの**である。このため、§1 の artifact を採用記録で「承認」とする時点で、決定者が本書の artifact・未確認項目・条件を確認し、採用記録に署名する（§3.2）。

---

## 1. 決定の対象（artifact 単位）

| # | 区分 | publisher / 識別子 | exact artifact | byte size | SHA-256（本 repository の独立計算。publisher の LFS metadata と一致） | 本書での扱い |
|---|---|---|---|---:|---|---|
| D | C7 検出（Annotation Assist Model） | Hugging Face `google/owlvit-base-patch32`、revision `cbc355fb364588351c5d51c7f74465e8e7ec6f72` | `model.safetensors` | `612,983,940` | `4dbe0399f0b7d7c8dddf1535a98769cc30743bebc877aea681998c8d984ce52b` | **決定の対象** |
| C | C7 検出（Annotation Assist Model） | Hugging Face `omlab/omdet-turbo-swin-tiny-hf`、revision `7fe93cecfb770c4d76cf71163956221249cab566` | `model.safetensors` | `461,822,656` | `439d1575d7e237ad565ed6969ea2a2dfcedf2086155e9ca3ac96cd6180a48cfd` | **決定の対象外（HOLD）**。§2.1 のとおり text encoder が OpenAI CLIP に由来する一次資料があり、FR-LIC-016 の除外条項（FR-LIC-015）の審査を要するため |

artifact D の実行に必要な同 revision の付属 file は、D の付属物として同じ決定に含める。

| file | byte | SHA-256 |
|---|---:|---|
| `config.json` | 4,418 | `b5934e0d2933194b8a85f93674e577feaa1a1ba2dc1d143b2d5e5305ff7a9d7c` |
| `preprocessor_config.json` | 392 | `2010d320cd2c68a8bb1de69aaa8f89daf173ef17cc22a30e4baf44b2f0e9bb6e` |
| `tokenizer_config.json` | 775 | `da35aceebeda2adf44094a5867940b09379323b9390fa9197b57044e106bfb6e` |
| `special_tokens_map.json` | 460 | `f118ab3a983206e4f32583448de6bd6aae4ee21869135cef1f5848a753cdaab6` |
| `vocab.json` | 1,059,962 | `e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349` |
| `merges.txt` | 524,619 | `9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a` |

### 1.1 対象外であることを明示するもの

| 対象外 | 理由 |
|---|---|
| artifact C（OmDet-Turbo swin-tiny） | §2.1 |
| `google/owlvit-base-patch32` の `pytorch_model.bin` | pickle 形式。安全形式でないため選択しない |
| `google/owlv2-base-patch16-ensemble` | 別 artifact |
| C7 分類の候補（TinyCLIP、MobileCLIP-S0、SigLIP 2） | 対象としていない。TinyCLIP は intended use の記載がなく、risk acceptance では解消できない（adoption-template §8） |
| OpenAI CLIP | FR-LIC-015 により対象外 |

## 2. 一次資料から確認できた事実と、確認できなかった項目（FR-LIC-016(1)）

保存 copy は `docs/model-governance/evidence/` にある（§5）。

### 2.1 artifact C（OmDet-Turbo swin-tiny）— 対象外とした理由

| 区分 | 内容 |
|---|---|
| 確認できた | (1) HF 版 `config.json` の `text_config.model_type` は `clip_text_model`。(2) GitHub `om-ai-lab/OmDet`（commit `956e2f36a13c32bd1e30b14a790233268c2305fb`）の `omdet/modeling/language_backbone/backbone.py` は `clip.load("resources/ViT-B-16.pt", …)` で text encoder を構築し、vision 部を削除する。(3) 同 repository に同梱された `clip.py` は `ViT-B-16` を `https://openaipublic.azureedge.net/clip/models/5806e77cd80f8b59890b7e101eabd078d9fb84e6937f9e85e4ecb61988df416f/ViT-B-16.pt`（OpenAI の配布 URL）へ対応付ける。(4) README が案内する `omlab/OmDet-Turbo_tiny_SWIN_T` の `ViT-B-16.pt` の LFS SHA-256 は `5806e77cd80f8b59890b7e101eabd078d9fb84e6937f9e85e4ecb61988df416f` で、上記 OpenAI URL に含まれる SHA-256 と一致する |
| 解釈 | OmDet-Turbo の text encoder は OpenAI CLIP ViT-B/16 の重みから構築されている。HF 版 `model.safetensors` の text encoder が学習中に更新されたかは確認していないが、いずれにせよ OpenAI CLIP の重みに**由来する** |
| 帰結 | OpenAI CLIP の model card は "**Any** deployed use case of the model - whether commercial or not - is currently out of scope." と記載する（保存 copy §5）。FR-LIC-016 は、一次資料が deployed use を out-of-scope とする checkpoint に本経路を適用しない（FR-LIC-015）。この条項が CLIP 由来の text encoder を含む OmDet-Turbo に及ぶかは本書で判断せず、**artifact C を決定の対象から外し、HOLD とする** |

### 2.2 artifact D（OWL-ViT base patch32）

| 区分 | 内容 |
|---|---|
| 確認できた | model card front matter `license: apache-2.0`。intended use "The model is intended as a research output for research communities." / "The primary intended users of these models are AI researchers."。out-of-scope use の節は存在しない。Model Type 節 "The CLIP backbone is trained from scratch and fine-tuned together with the box and class prediction heads with an object detection objective."、概要 "The authors first train CLIP from scratch …"（**OpenAI CLIP の重みを初期値にしていない**と publisher が記載）。Data 節: CLIP backbone は公開 image-caption data（YFCC100M 等）で学習し、予測 head と backbone を COCO と OpenImages で fine-tune した。`architectures` は `OwlViTForObjectDetection`（transformers 本体の実装、remote code 不要） |
| 確認できなかった | (1) card の `apache-2.0` タグが checkpoint 層の許諾表明であるか（FR-LIC-005）。(2) 学習データ（crawl した image-caption data、YFCC100M、COCO、OpenImages）の各 terms と、派生重みの利用・再配布の条件。(3) HF 版 checkpoint が card の記載する学習手順の重みと同一であるか（変換元 checkpoint の hash は公開されていない）。(4) 教育目的の利用は intended use に記載がない（[owner rulings](2026-09-23-owner-rulings.md) D2 により、製品の条件より狭い制限として扱う） |
| 除外条項の該当 | 一次資料に、製品のモデル利用条件（非商用の研究・教育目的）での利用または deployed use を明示的に禁止・除外する記載はない |

## 3. 決定の内容

決定者 **dahatake** は、§0 の意思表示により、artifact D について、§2.2 の未確認項目を**未確認のまま開示して**、本 repository の責任で採用候補とすることを決定する（**§3.2 の確認と署名を条件とする**）。

| 項目 | 決定 |
|---|---|
| checkpoint license 識別子 | **`LicenseRef-AutoVisionStudio`**（repository ローカル参照。publisher が発行した識別子ではない） |
| 利用条件 | 非商用の研究・教育目的（要求定義 v0.7）。manifest の `commercialUseConfirmed` / `redistributionPermitted` / `commercialDerivativesPermitted` は、本決定に基づくこの利用条件での許可を表し、**publisher の確認ではない**（FR-LIC-016(3)、TBD-09） |
| 狭い制限（FR-LIC-003） | **承認する**。OWL-ViT による補助候補は**研究目的に限って**提供し、その旨をアプリ内表示（FR-LIC-012）と `THIRD_PARTY_NOTICES` に明示する |
| NOTICE | 採用記録 §5 の文面を正とし、risk acceptance である事実と §2.2 の未確認項目を含める（FR-LIC-016(4)） |

### 3.1 失効条件

次のいずれかが判明した場合、本決定は効力を失い、再審査する。

1. 一次資料が、OWL-ViT の重みが OpenAI CLIP に由来する、または製品のモデル利用条件での利用・deployed use を明示的に禁止・除外していると示した場合。
2. 配布主体が変わる場合。

### 3.2 採用時の確認

artifact D の採用記録を「承認」とする時点で、決定者は本書 §1〜§3 の artifact・未確認項目・条件を確認し、採用記録に署名する（§0 のとおり、本書の範囲は記録者が特定したため）。

## 4. 本決定が意味しないこと

1. **採用の決定ではない。** 採用記録の承認と manifest 登録は、技術 gate の実測と §3.2 の確認を経た後に行う。
2. **技術 gate を緩和しない**（FR-LIC-016(5)）。安全形式、ONNX parity（CPU / DirectML）、性能、補助品質の比較試験（NFR-ANN-006 / POC-16）は採用記録の実測に従い、未達なら登録しない。
3. publisher が checkpoint 固有の license statement を発行した事実はない。学習データの各画像・各 annotation の権利が確認された事実もない。外部法務の書面判断は存在しない。
4. artifact C を不適合と確定するものではない。FR-LIC-015 の適用範囲の判断を要するため、決定の対象から外しただけである。

## 5. 保存した一次資料（2026-09-23 取得）

| 資料 | 取得元 URL | 保存 copy | SHA-256 |
|---|---|---|---|
| D: model card | `https://huggingface.co/google/owlvit-base-patch32/resolve/cbc355fb364588351c5d51c7f74465e8e7ec6f72/README.md`（revision 固定の `README.md` と同一 bytes） | `docs/model-governance/evidence/owlvit-base-patch32-model-card-cbc355fb-20260923.md` | `a16c707494da894773e85c1be976ae605a7b3a3ce92cf9ed277623dd25f236bf` |
| D: HF API metadata | `https://huggingface.co/api/models/google/owlvit-base-patch32?blobs=true` | `docs/model-governance/evidence/owlvit-base-patch32-hf-api-20260923.json` | `da65ba7b0e5baffa5366d5dc3d885c0e0a0b4722761d2e84790e43736e82d459` |
| C: model card | `https://huggingface.co/omlab/omdet-turbo-swin-tiny-hf/resolve/7fe93cecfb770c4d76cf71163956221249cab566/README.md`（revision 固定の `README.md` と同一 bytes） | `docs/model-governance/evidence/omdet-turbo-swin-tiny-hf-model-card-7fe93cec-20260923.md` | `81b5b3ad13360e919cffbd80c24421c038e97c334d67636e7cb148d586591c90` |
| C: HF API metadata | `https://huggingface.co/api/models/omlab/omdet-turbo-swin-tiny-hf?blobs=true` | `docs/model-governance/evidence/omdet-turbo-swin-tiny-hf-hf-api-20260923.json` | `ce265298f235cd5387580f26462464275ba5a04e999e23ad91a1886cb2f9ab8f` |
| C: config | `https://huggingface.co/omlab/omdet-turbo-swin-tiny-hf/resolve/7fe93cecfb770c4d76cf71163956221249cab566/config.json` | `docs/model-governance/evidence/omdet-turbo-swin-tiny-hf-config-7fe93cec-20260923.json` | `c0d6546428c6dd7e72d9c8e2123cdd7ff24925dfbff9b535b66cd2f19ca65c46` |
| C: GitHub README | `https://raw.githubusercontent.com/om-ai-lab/OmDet/956e2f36a13c32bd1e30b14a790233268c2305fb/README.md` | `docs/model-governance/evidence/om-ai-lab-OmDet-README-956e2f36-20260923.txt`（bytes は README.md のまま。文書検査が相対 link を辿らないよう拡張子を `.txt` にした） | `c86e562a1ab1a97e61c114b83a6155af01cac523f66eed16783c83e845616e2c` |
| C: GitHub LICENSE | `https://raw.githubusercontent.com/om-ai-lab/OmDet/956e2f36a13c32bd1e30b14a790233268c2305fb/LICENSE` | `docs/model-governance/evidence/om-ai-lab-OmDet-LICENSE-956e2f36-20260923.txt` | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| C: language backbone | `https://raw.githubusercontent.com/om-ai-lab/OmDet/956e2f36a13c32bd1e30b14a790233268c2305fb/omdet/modeling/language_backbone/backbone.py` | `docs/model-governance/evidence/om-ai-lab-OmDet-language_backbone-backbone-956e2f36-20260923.txt` | `af6a41d37ee202c32b0ecd189ca75006bb5aa163a9d5c6044407a6450b48e5a6` |
| C: 同梱 CLIP loader | `https://raw.githubusercontent.com/om-ai-lab/OmDet/956e2f36a13c32bd1e30b14a790233268c2305fb/omdet/modeling/language_backbone/clip/models/clip.py` | `docs/model-governance/evidence/om-ai-lab-OmDet-language_backbone-clip-956e2f36-20260923.txt` | `1e98e7aa37f1dca2b3b765cddd53bc578f3aef4f344edb9c0ebc7c47b01d67c1` |
| C: `ViT-B-16.pt` の配布 metadata | `https://huggingface.co/api/models/omlab/OmDet-Turbo_tiny_SWIN_T?blobs=true`（取得時 revision `8f243ecde6aa047dabd28f435420392d1503236f`） | `docs/model-governance/evidence/omlab-OmDet-Turbo_tiny_SWIN_T-hf-api-20260923.json` | `7a7063b68e6e072849a9ceb1f17035984a6ec1191b66adaad80c737cd41e1d39` |
| OpenAI CLIP model card | `https://huggingface.co/openai/clip-vit-base-patch32/resolve/3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268/README.md`（取得時の main。要求定義 [S47] と同趣旨の out-of-scope 記載） | `docs/model-governance/evidence/openai-clip-vit-base-patch32-model-card-20260923.md` | `8f0e8c678e0afe5f384f3bf8a6694c1cb53c41e52f86277967b6c5354cb0f9f4` |

## 6. 版管理

本文書は証拠として参照されるため、確定後に内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
