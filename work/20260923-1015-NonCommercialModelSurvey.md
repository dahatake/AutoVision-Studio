# 非商用の研究・教育目的を前提とした利用可能モデルの再調査

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書（調査記録）。**採用決定ではない** |
| 作成日時 | 2026-09-23 10:15 |
| 調査日 | **2026-09-23**（本書の一次資料はすべてこの日に取得） |
| 契機 | 利用者指示「要件定義のモデルの利用条件を『非商用の研究・教育目的』に訂正。利用できるモデルを再度調査」 |
| 適用基準 | [`requirement-definition.md`](../docs/requirement-definition.md) v0.7 Draft（本日訂正）の FR-LIC-002 / 003 / 006 / 012 / 014 / 015 / 016、TBD-09 |
| 先行記録 | [`20260923-0546-RelaxedLicenseModelSurvey.md`](20260923-0546-RelaxedLicenseModelSurvey.md)、[`20260923-0720-Gate2-TaskExecution.md`](20260923-0720-Gate2-TaskExecution.md) |
| 取得物の保管 | Git 追跡外の `vendor/models/_spike/survey/`（sandbox が repository 外への書き込みを拒否するため）。各 file の SHA-256 は §6 |

---

## 1. 要件定義の訂正内容（本調査の前提）

| 項目 | 訂正前 | 訂正後（v0.7 Draft） |
|---|---|---|
| 製品価値 §1-4 | ソフトウェアおよびモデルは「商用製品へ組み込めるライセンス条件」 | **ソフトウェアは従来どおり商用可能な条件**。**学習済みモデルは「非商用の研究・教育目的」での利用と同梱・再配布が許されるもの**。モデルを同梱する配布物は非商用の研究・教育目的に限って提供する |
| FR-LIC-002 | 許可 license はソフトウェア前提 | モデルは、非商用の研究・教育目的での利用と同梱・再配布を明示的に許す license / terms も許可。C6 は Fine-Tuning に必要な改変・派生物の作成も必要 |
| FR-LIC-003 | 研究限定・非商用限定は書面承認なしに同梱不可 | モデルが非商用限定・研究目的限定であることだけでは除外しない。**製品の条件より狭い制限**（研究のみで教育を許さない、再配布禁止、特定組織限定など）は書面承認とアプリ内表示を要する |
| FR-LIC-006 | ImageNet 由来重みを商用可と自動判定しない | ImageNet terms（非商用の研究・教育目的）は製品条件の範囲内。ただし派生重みの利用・再配布は terms に記載がないため記録し、書面承認（FR-LIC-016 を含む）を要する |
| FR-LIC-012 | 第三者 license・由来・attribution を表示 | 加えて、同梱モデルの利用条件（非商用の研究・教育目的に限る旨）を表示 |
| FR-LIC-014 / 016 | 研究限定・非商用なら同梱しない／商用利用を明示禁止する checkpoint には risk acceptance を適用しない | 製品条件に不適合なら同梱しない／**製品条件での利用**または deployed use を明示禁止・out-of-scope とする checkpoint には適用しない |
| FR-LIC-015 | OpenAI CLIP を除外 | **維持**（model card が deployed use を commercial / non-commercial を問わず out-of-scope とするため） |
| TBD-09（新設） | — | manifest schema の `commercialUseConfirmed` / `commercialDerivativesPermitted` は、改訂までは製品のモデル利用条件での許可を表すものとして扱う |

要求 ID の総数（246）は変えていない。README の基準版宣言と SHA-256 を更新し、`docs/dependency-policy.md` §3・§4・§6.2 と `docs/model-governance/adoption-template.md` §3・§4・§16・§17 の文言を合わせた。

## 2. 判定基準

| 基準 | 判定方法 |
|---|---|
| 利用条件 | checkpoint の license / terms が**非商用の研究・教育目的での利用と、アプリへの同梱・再配布**を許すか。研究のみ・教育のみ等の**狭い制限**は FR-LIC-003 の書面承認対象として区別する |
| C6 の追加条件 | 製品内 Fine-Tuning に必要な改変・派生物の作成が許されるか |
| intended use / out-of-scope | 一次資料が製品の用途（非商用の研究・教育のための端末内 annotation 補助・学習初期化）を明示的に除外していないか（FR-LIC-015） |
| 技術（**本調査では未実施**） | SHA-256 の独立計算、安全形式、ONNX parity、CPU / DirectML 性能はすべて採用時に実測する。FR-LIC-016(5) により緩和しない |
| 依存 | 新規依存の有無（[`dependency-policy.md`](../docs/dependency-policy.md) §10） |

## 3. 結論

| 役 | 現状（本日の実測まで） | 訂正後の第一候補 | 次の技術作業 |
|---|---|---|---|
| **C6 分類** | MobileNetV3 Large V2 を**承認済み**（manifest 登録済み） | **変更なし**。ImageNet terms は訂正後の製品条件の範囲内になった。派生重みの再配布は引き続き terms に記載がなく、2026-09-23 の risk acceptance で扱う | なし |
| **C6 検出** | SSDLite320 は調査時点で**保留**（後処理閾値 `0.05` の条件付きでのみ性能合格。閾値が製品契約として未確定） | **SSDLite320**。調査後の owner 裁定 D1（§8）により**承認**・manifest 登録済み | なし（POC-03 は INF phase で Model Version に対して検証）。代替の Faster R-CNN MobileNetV3-Large 320 FPN（§4.2）は不要になった |
| **C7 分類** | SigLIP は**保留**（CPU p95 545〜831 ms） | **全要件を満たす第一候補はない**。SigLIP は利用条件・intended use は満たすが CPU 性能が不適合。TinyCLIP ViT-8M/16（MIT、93.8 MB）は小型だが、**intended use の記載がなく**（adoption-template §8「判断不能 → 同梱不可」）現時点では **HOLD** | (1) TinyCLIP の intended use を示す一次資料の探索。見つからなければ候補から外す。(2) SigLIP の CPU 経路の改善（量子化等） |
| **C7 検出** | Grounding DINO tiny は**保留**（ONNX parity FAIL） | **§9 の追加調査で OWL-ViT base patch32 に変更**（OmDet-Turbo は text encoder が OpenAI CLIP 由来と判明し HOLD）。以下は調査時点の記載: **OmDet-Turbo swin-tiny（`omlab/omdet-turbo-swin-tiny-hf`）**。Apache-2.0、intended use は zero-shot object detection と明記、out-of-scope 節は存在しない（SSDLite の採用記録 §8 と同じく「記載なし」として扱う）、transformers 本体に実装がある。学習データは card に記載がない（GitHub README は `O365,GoldG` と記載）。text encoder は `clip_text_model` で、OpenAI CLIP 由来かは未確認（§9）。次点は **OWL-ViT base patch32**（本訂正で新たに対象となった） | 学習データの一次資料探索 → 取得・parity・CPU / DirectML 性能 |

**訂正によって新たに対象になった候補:** OWL-ViT / OWLv2（従来は intended use「research output for research communities」との不適合で除外していた）。**訂正後も対象外:** OpenAI CLIP（FR-LIC-015）。**狭い制限のため書面承認が必要:** MobileCLIP-S0（研究目的に限定し、製品開発への利用を除外する license）。

---

## 4. 候補ごとの一次資料（取得日 2026-09-23）

### 4.1 C6 分類 — 既承認の MobileNetV3 Large V2

- 出典: `https://www.image-net.org/download.php`（保存 copy `docs/model-governance/evidence/imagenet-terms-of-access-20260923.html`、SHA-256 `275647ff…d4`）。原文: "Researcher shall use the Database only for non-commercial research and educational purposes."
- 訂正後の評価: terms の目的の制限は製品のモデル利用条件と一致する。**ただし terms は Database 利用者（Researcher）への条件であり、派生重みの利用・再配布を記載しない**（FR-LIC-006 の記録対象として残る）。
- 敵対的レビューの指摘により、採用記録 §3・§4・§5 と manifest の `noticeText` / `redistributionConditions` に、同梱は非商用の研究・教育目的に限ること、および `commercialUseConfirmed` / `commercialDerivativesPermitted` がその利用条件での許可を表すこと（TBD-09）を追記した。2026-09-23 の risk acceptance は商用利用を含む範囲で決定されており、非商用の研究・教育目的での利用はその範囲に含まれるため、新たな書面決定は作成していない。

### 4.2 C6 検出

| 候補 | 一次資料 | 事実 | 訂正後の評価 |
|---|---|---|---|
| SSDLite320 MobileNetV3 Large `COCO_V1` | 既存の採用記録 | COCO annotations は CC BY 4.0、画像は Flickr Terms に従う | 権利面は訂正後の条件に適合しやすくなった（NC 条件付きの画像 license も製品条件の範囲内になる）。**保留理由（性能が後処理閾値の条件付きで、閾値が未確定）は変わらない** |
| Faster R-CNN MobileNetV3-Large 320 FPN `COCO_V1` | `https://raw.githubusercontent.com/pytorch/vision/v0.26.0/torchvision/models/detection/faster_rcnn.py` | URL `fasterrcnn_mobilenet_v3_large_320_fpn-907ea3f9.pth`、`num_params 19,386,354`、COCO-val2017 `box_map 22.8`、`_ops 0.719`（GFLOPS）、`_file_size 74.239` MB | torchvision 既存依存で新規依存なし。SSDLite の `0.58` GFLOPS（既存保存 copy の model doc）より演算量が多く、**性能は未測定**。SSDLite で閾値が決まらない場合の代替 |
| YOLOX-Nano | 既存の [`detection-base.md`](../docs/model-governance/detection-base.md) | release asset の provenance の矛盾（DB-T1）が未解消 | 訂正で解消しない |

### 4.3 C7 分類

| 候補 | license / terms（原文） | intended use / out-of-scope | 学習データ | 形式・依存 | 訂正後の評価 |
|---|---|---|---|---|---|
| **TinyCLIP ViT-8M/16 Text-3M（YFCC-15M）** `wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M`、revision `a2a8c6eaa2549ad66eb7c31b85022bf58273a26c` | card `license: mit`。card の License 節は `https://github.com/microsoft/Cream/blob/main/TinyCLIP/LICENSE`（取得した本文は MIT License、Copyright (c) Microsoft Corporation） | card に intended use / out-of-scope の節は**ない** | card の表: Pretrain `YFCC-15M`、IN-1K Acc@1 `41.1`%、MACs `2.0` G、Throughput `4,150` pairs/s | `model.safetensors` `93,812,468` byte（publisher LFS SHA-256 `9339ee3d7363…`）。`architectures: CLIPModel`（transformers 本体）で新規依存は transformers のみ | **HOLD**。card・README・abstract のいずれにも intended use / out-of-scope の記載がなく、[`adoption-template.md`](../docs/model-governance/adoption-template.md) §8 の「判断不能 → 同梱不可」に当たる。加えて**未確認**: (1) 継承元（teacher）の重み。arXiv 2309.12314 の abstract（2026-09-23 取得、SHA-256 `bd9c77e7…4a89`）は "Weight inheritance transmits the pre-trained weights from the teacher models to their student counterparts" と記載し、student が teacher の重みを受け継ぐことを明記するが、ViT-8M/16 の teacher が OpenAI CLIP かは abstract・card・README から確認できない（microsoft/Cream の GitHub API は SAML 保護で取得できなかった）。OpenAI CLIP であれば、CLIP card の out-of-scope 条項（FR-LIC-015）が派生物へ及ぶかが論点になる。(2) YFCC-15M の各画像 license（CC 系で NC を含む）。(3) IN-1K 41.1% は SigLIP より低く、補助品質（NFR-ANN-006）は未知 |
| SigLIP base / SigLIP 2 base | card `license: apache-2.0` | intended use は zero-shot image classification。out-of-scope 節なし（「記載なし」） | WebLI（terms 非公開） | 812 MB / 1.50 GB safetensors | 学習データ terms は非公開のため FR-LIC-016 で扱う（SigLIP base は 2026-09-22 決定済み、SigLIP 2 は未決定）。**CPU 性能が不適合**（本日の実測）。SigLIP 2 は同じ base 構成のため同様と予想されるが未測定 |
| MobileCLIP-S0 `apple/MobileCLIP-S0`、revision `71aa3e13dda93115871afbd017336535ba29886c` | card `license: apple-amlr`。本文: license は "exclusively for Research Purposes"、"'Research Purposes' means non-commercial scientific research and academic development activities … 'Research Purposes' does not include any commercial exploitation, product development or use in any commercial product or service." | card に節なし | GitHub README: DataCompDR。`LICENSE_DATA` は CC BY-NC-ND 4.0 | `mobileclip_s0.pt`（`215,934,653` byte、pickle 系 `.pt`）。`ml-mobileclip` の requirements は `open-clip-torch`、`timm`、`datasets` 等（新規依存が多い） | **製品条件より狭い**（研究目的のみ、教育目的の明記なし、product development を除外）。FR-LIC-003 の書面承認なしに同梱できない。安全形式の確認と新規依存も必要なため**劣後** |
| OpenAI CLIP ViT-B/32 `openai/clip-vit-base-patch32` | card metadata に license なし | "**Any** deployed use case of the model - whether commercial or not - is currently out of scope." | 公開 image-caption data | `pytorch_model.bin` のみ（pickle） | **訂正後も対象外**（FR-LIC-015） |

### 4.4 C7 検出

| 候補 | license / terms | intended use / out-of-scope（原文） | 学習データ | 形式・依存 | 訂正後の評価 |
|---|---|---|---|---|---|
| **OmDet-Turbo swin-tiny** `omlab/omdet-turbo-swin-tiny-hf`、revision `7fe93cecfb770c4d76cf71163956221249cab566` | card `license: apache-2.0` | "This model is intended for zero-shot (also called open-vocabulary) object detection." out-of-scope 節なし | **card に記載なし**（未確認） | `model.safetensors` `461,822,656` byte（LFS SHA-256 `439d1575d7e2…`）。`OmDetTurboForObjectDetection`（transformers 本体） | **HOLD（§9 で変更）**。text encoder が OpenAI CLIP ViT-B/16 の重みから構築されていることを一次資料で確認したため。以下は調査時点の記載: 第一候補。論文題名 "Real-time Transformer-based Open-Vocabulary Detection with Efficient Fusion Head" は実時間用途を意図した設計を示すが、**本 repository では性能未測定**。学習データは FR-LIC-016 の未確認項目になる |
| **OWL-ViT base patch32** `google/owlvit-base-patch32`、revision `cbc355fb364588351c5d51c7f74465e8e7ec6f72` | card `license: apache-2.0` | "The model is intended as a research output for research communities." / "The primary intended users of these models are AI researchers." out-of-scope 節なし | card: CLIP backbone は公開 image-caption data（YFCC100M 等）、予測 head は COCO と OpenImages で fine-tune | `model.safetensors` `612,983,940` byte（LFS SHA-256 `4dbe0399f0b7…`）、入力 `768x768`。transformers 本体 | **訂正で新たに対象**（研究目的の利用は intended use に含まれる）。(1) 教育目的の利用は intended use に記載がなく、owner 裁定 D2（§8）により **FR-LIC-003 の狭い制限として扱う**（採用時は書面承認と「研究目的に限る」旨の表示が必要）。**未確認**:(2) ~~CLIP backbone が OpenAI CLIP の重みから初期化されたか~~ → **訂正**: card は "The CLIP backbone is trained from scratch" と記載しており、OpenAI CLIP の重みを初期値にしていない（§9） |
| OWLv2 base patch16 ensemble `google/owlv2-base-patch16-ensemble`、revision `cfd3195ba4ea9592eec887ded089f4c08eff231d` | card `license: apache-2.0` | OWL-ViT と同文 | 同上 | `model.safetensors` `619,918,824` byte、入力 `960x960` | OWL-ViT と同じ評価。入力が大きく CPU 性能は OWL-ViT より不利と予想されるが未測定 |
| Florence-2 base-ft（transformers 変換版） `florence-community/Florence-2-base-ft`、revision `0b03b6f15a4a211370fb204aee4e7dd48887ea37` | card `license: mit` | card の summary 文は "continued pretrained version of Florence-2-large … 4k context" と記載しており、base-ft の説明と一致しない（**card の記載の不整合**。解釈しない） | FLD-5B（terms 未確認。[`detection-assist.md`](../docs/model-governance/detection-assist.md) §4.2） | `model.safetensors` `463,178,864` byte（LFS SHA-256 `ab06dea66b16…`）。`auto_map` なし（**remote code 不要**）。transformers 5.17.0 の `florence2` 実装が docstring で `florence-community/Florence-2-base` を参照 | Microsoft 版の `trust_remote_code` 問題（DA-B05）を回避できる可能性がある。**未確認**: `florence-community` organization と Microsoft の関係、変換の同等性 |
| Grounding DINO tiny | 既存 | 既存 | 既存 | 既存 | 利用条件は適合。**ONNX parity FAIL**（本日の実測）で技術的に保留 |

---

## 5. 本調査が主張しないこと

1. **採用決定ではない。** 新規候補のいずれについても、権限者の決定、採用記録、manifest entry を作成していない。
2. **技術検証を一切行っていない。** 表中の byte size と SHA-256 は publisher の metadata の転記であり、binary を取得して計算した値ではない（本日の Gate 2 作業で取得済みの SigLIP / Grounding DINO / MobileNetV3 / SSDLite を除く）。
3. **法的助言ではない。** 「非商用の研究・教育目的」への適合は、一次資料の文言と製品の用途の照合であり、外部法務の判断を代替しない。
4. card の `license` タグは checkpoint 層の許諾表明とは限らない（FR-LIC-005）。
5. 本訂正は**ソフトウェアの license 条件を変えていない**。AGPL の Ultralytics YOLO 等は、モデルの利用条件ではなくソフトウェアの copyleft 条件（FR-LIC-003）で従来どおり扱う。

## 6. 取得物の SHA-256（`vendor/models/_spike/survey/`）

| file | byte | SHA-256 |
|---|---:|---|
| `wkcn__TinyCLIP-ViT-8M-16-Text-3M-YFCC15M.README.md` | 5,961 | `f0358aa986c559a7d80a147b65c1c40892f14ba02920fa2a01903a2347b36f7f` |
| `wkcn__TinyCLIP-ViT-8M-16-Text-3M-YFCC15M.api.json` | 2,223 | `ff193e44ab85420bfc42d738bb3bdfb708a8cc86e1568f4b6cc7ab5feaf13ab5` |
| `wkcn__TinyCLIP-ViT-8M-16-Text-3M-YFCC15M.config.json` | 4,602 | `c586d856dbd5589b67525db9e791ee0917402405672c7773aead373efb7d7bca` |
| `TinyCLIP.LICENSE.txt`（microsoft/Cream main） | 1,769 | `583acc0d9c74def18ec24e56964421bf1fac1fa2d60451e75e6681d5ae58a3f6` |
| `TinyCLIP.README.md`（microsoft/Cream main） | 5,839 | `8b1980088f3d5ff914926721cb9a4240446052cdf7d74468d33984b98ee03d86` |
| `omlab__omdet-turbo-swin-tiny-hf.README.md` | 5,141 | `81b5b3ad13360e919cffbd80c24421c038e97c334d67636e7cb148d586591c90` |
| `omlab__omdet-turbo-swin-tiny-hf.api.json` | 2,170 | `ce265298f235cd5387580f26462464275ba5a04e999e23ad91a1886cb2f9ab8f` |
| `omlab__omdet-turbo-swin-tiny-hf.config.json` | 1,959 | `c0d6546428c6dd7e72d9c8e2123cdd7ff24925dfbff9b535b66cd2f19ca65c46` |
| `google__owlvit-base-patch32.README.md` | 5,146 | `a16c707494da894773e85c1be976ae605a7b3a3ce92cf9ed277623dd25f236bf` |
| `google__owlvit-base-patch32.api.json` | 5,205 | `da65ba7b0e5baffa5366d5dc3d885c0e0a0b4722761d2e84790e43736e82d459` |
| `google__owlvit-base-patch32.config.json` | 4,418 | `b5934e0d2933194b8a85f93674e577feaa1a1ba2dc1d143b2d5e5305ff7a9d7c` |
| `google__owlv2-base-patch16-ensemble.README.md` | 4,838 | `7c7426bc5ec939a42d1f96fb093031b6263400cceac4129ebb941a0c8c11b9b9` |
| `google__owlv2-base-patch16-ensemble.api.json` | 4,616 | `6874fa459c161253f245fa477da77119db62d5f5d4257f0c1ca28fc5c998477c` |
| `google__owlv2-base-patch16-ensemble.config.json` | 414 | `ba9df8c25a4b8461887dd0a93d9252c9cd84697fe8d49a9d8794ce409af9acb2` |
| `florence-community__Florence-2-base-ft.README.md` | 13,429 | `0bbb80e54b04136cd08282a1ce008bf2fe3216f6797a18d8faa7a352a311c2a9` |
| `florence-community__Florence-2-base-ft.api.json` | 3,068 | `3599f1ca7c7172ad7b64be0846f0d3993e1dafd92e57a0c04512c0d55582ebb9` |
| `microsoft__Florence-2-base-ft.api.json` | 5,606 | `a43af725a17074ad6f5da7a2dff7729b1228b6a8b6276b1368e566de1a4dcbbe` |
| `apple__MobileCLIP-S0.README.md` | 4,168 | `ad49da3e4e2b8ff8d48c1747f8f7384e0bc8fe94a6889e4747c23f24d789e940` |
| `apple__MobileCLIP-S0.LICENSE.txt` | 5,820 | `d8f5d9dfbdb60dc81b8f1720421699e7811070f0b46f6668f90253d5ac8c0b20` |
| `apple__MobileCLIP-S0.api.json` | 1,328 | `20bd24d3f31d81f5434090bac06a3538af70059a4bc14a3e0e11f1e944fb7d8f` |
| `ml-mobileclip.LICENSE_DATA.txt`（apple/ml-mobileclip `48faa0fe`） | 19,126 | `f7f28b8c7a1af76b9874ca6d040e8b1eb6768fd1043106c9d315090ea96754e7` |
| `ml-mobileclip.requirements.txt`（同） | 108 | `509aa2e00f8a4fb265e9f20c6be7e664b475b9457e1797f3c81942789571e012` |
| `openai__clip-vit-base-patch32.README.md` | 7,942 | `8f0e8c678e0afe5f384f3bf8a6694c1cb53c41e52f86277967b6c5354cb0f9f4` |
| `google__siglip2-base-patch16-224.README.md` | 3,375 | `39ac3705d62af9ffa1a14675b8ccb220a75f2d81acd530e564a3b1e3dfe418d8` |
| `torchvision-v0.26.0-faster_rcnn.py` | 36,966 | `4ba7930ab1e4588083a462208c00232dcc206ac12e6fc59852fa48c668f2b26b` |
| `arxiv-2309.12314.atom.xml`（`https://export.arxiv.org/api/query?id_list=2309.12314`） | 3,987 | `bd9c77e7ebf3960f181d64e97eb5d956a34c85fc5c2887d469b02c2f8bc94a89` |

URL は HF の場合 `https://huggingface.co/api/models/<id>?blobs=true`、`https://huggingface.co/<id>/raw/main/README.md`、`https://huggingface.co/<id>/resolve/<revision>/config.json`。採用に進む場合は、これらを `docs/model-governance/evidence/` へ保存 copy として移し、採用記録から参照する。

## 7. 次に必要な作業と判断

| # | 内容 | 担当 |
|---|---|---|
| 1 | ~~C6 検出: SSDLite の後処理閾値を `≥ 0.05` として製品契約に固定するか~~ → **D1 で解決**（§8） | — |
| 2 | C7 分類: TinyCLIP の intended use を示す一次資料の探索（無ければ候補から外す）と継承元重みの確認。並行して SigLIP の CPU 経路の改善 | 実装 |
| 3 | C7 検出: OWL-ViT B/32 の取得済み artifact で ONNX parity（CPU / DirectML）・性能・補助品質を実測（§9 で OmDet-Turbo は HOLD） | 実装 |
| 4 | ~~OWL-ViT / OWLv2 の教育目的の扱い~~ → **D2 で解決**（§8。狭い制限として扱う） | — |
| 5 | 新しい C7 候補の書面決定（FR-LIC-016(2)）→ **2026-09-23 に条件付きで記録**（§9）。artifact 単位の範囲・条件は、採用記録の承認時に決定者が確認・署名して確定する | 利用者（採用時） |
| 6 | manifest schema の field 名の改訂（TBD-09） | 次の schema 変更時 |

## 8. 判断の記録（2026-09-23 11:17 以降）

利用者 dahatake が、提示した「次に必要な判断」のうち 1（C6 検出の後処理閾値。本書 §7 の 1）と 2（OWL-ViT の教育目的の扱い。本書 §7 の 4）について「要求定義書に照らし合わせて合理的な選択で OK」と委任した。委任を受けた実装担当が選んだ判断は [`2026-09-23-owner-rulings.md`](../docs/model-governance/evidence/2026-09-23-owner-rulings.md) に書面化した。

| ID | 判断 | 要求定義書上の根拠 | 反映 |
|---|---|---|---|
| D1 | C6（初回学習に用いる基盤重み）の採用判定に POC-03 の実時間推論基準を適用しない。POC-03 / NFR-PERF-004 は INF phase で Model Version の推論経路に対して検証する（緩和しない） | §5 の用語定義（Curated Base Weight / Model Version）、FR-INF-001（カメラ推論の対象は成功済み Model Version）、FR-INF-014（表示閾値は Inference Profile で設定） | SSDLite320 の採用記録を承認、manifest に登録（承認 2 件）。detection-base.md §15.10、ADR-0004 §5.1.13 |
| D2 | OWL-ViT / OWLv2 の intended use に教育目的の記載がないことを、FR-LIC-003 の狭い用途制限として扱う | FR-LIC-003、adoption-template §8、FR-LIC-016(1)（推測で補わない） | 本書 §4.4。採用時まで効力なし |

**D1 の検討で判明した関連事項（本判断の対象外）:** 要求定義書上、C7 の性能要件は POC-16（完全オフライン・CPU/CUDA での動作、manual-only より annotation 中央所要時間を短縮）と NFR-ANN-003（候補生成中も UI を妨げない）であり、100 ms / 10 FPS（POC-03）は C7 を名指ししていない。SigLIP を CPU p95 545〜831 ms で保留とした判定は、adoption-template §11 の表（C6/C7 共通に POC-03 を置く）に従ったものである。C7 に同じ読み替えを行うかは D1 の委任範囲外であり、変更していない。

## 9. C7 検出の新候補に対する書面決定（2026-09-23 11:47）

決定者 dahatake（役割: Product Manager、決定日 2026-09-23）が、§7 の 5 について書面決定を示した。記録は [`2026-09-23-owner-risk-acceptance-c7-detection.md`](../docs/model-governance/evidence/2026-09-23-owner-risk-acceptance-c7-detection.md)。回答は artifact を個別に列挙していないため、範囲と条件は記録者が特定し、採用記録の承認時に決定者が確認・署名する（同記録 §0・§3.2）。

| 項目 | 内容 |
|---|---|
| 取得と hash | OmDet-Turbo（revision `7fe93cec`）と OWL-ViT B/32（revision `cbc355fb`）の `model.safetensors` を取得し（Git 追跡外の `vendor/models/_spike/`）、本 repository で計算した SHA-256 が publisher の LFS metadata と一致した |
| **OWL-ViT B/32** | **決定の対象**。FR-LIC-003 の書面承認を含む（研究目的に限って提供し、表示する）。model card は CLIP backbone を "trained from scratch" と記載し、OpenAI CLIP の重みを初期値にしていない（§4.4 の当初の「未確認」を訂正） |
| **OmDet-Turbo swin-tiny** | **決定の対象外（HOLD）**。敵対的レビューの指摘を受けて一次資料を追加調査した結果、text encoder は OpenAI CLIP ViT-B/16 の重みから構築されていた（OmDet の `backbone.py` が `clip.load("resources/ViT-B-16.pt")` を呼び、配布元 `omlab/OmDet-Turbo_tiny_SWIN_T` の `ViT-B-16.pt` の SHA-256 `5806e77c…416f` が OpenAI の配布 URL に含まれる値と一致）。OpenAI CLIP の model card は deployed use を out-of-scope とするため、FR-LIC-015 の適用範囲の判断を要する |

**これは採用決定ではない。** C7 検出の第一候補は **OWL-ViT base patch32** に変わった。採用記録の承認と manifest 登録には、ONNX parity（CPU / DirectML）、性能、補助品質の比較試験（NFR-ANN-006 / POC-16）の実測と、決定者の署名が必要である。
