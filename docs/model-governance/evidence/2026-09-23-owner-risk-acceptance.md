# Owner risk acceptance record — 2026-09-23

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner による書面決定の記録。FR-LIC-016(2)） |
| 決定者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-23** |
| 記録者 | 実装担当（本 repository の作業者） |
| 決定の経緯 | 決定者が 2026-09-23 に「不明点はデフォルトのプランを採用」と指示し、実行計画 [`work/20260923-0630-Gate2-TaskExecutionPlan.md`](../../../work/20260923-0630-Gate2-TaskExecutionPlan.md) §2 の既定値 DQ-02（C6 分類）と DQ-05（C7 検出）を採用した。本書はその指示を artifact 単位で書面化したものである |
| 先行記録（変更しない） | [`2026-09-22-owner-risk-acceptance.md`](2026-09-22-owner-risk-acceptance.md) |
| 適用要求 | [`requirement-definition.md`](../../requirement-definition.md) FR-LIC-006 / FR-LIC-014 / FR-LIC-016 |

---

## 1. 決定の対象（artifact 単位）

本決定は次の 2 artifact **だけ**を対象とする。名称が似ている別 artifact（別 revision、別形式、別 publisher の同名 model）には及ばない。

| # | 区分 | publisher / 識別子 | exact artifact | byte size | SHA-256（本 repository の独立再計算。publisher 値との関係は右欄） |
|---|---|---|---|---:|---|
| A | C6 分類（Curated Base Weight） | torchvision `MobileNet_V3_Large_Weights.IMAGENET1K_V2`（torchvision `0.26.0`） | `https://download.pytorch.org/models/mobilenet_v3_large-5c1a4163.pth` | `22,132,113` | `5c1a416349c4cf298f2a6a5e2600ed0ee55e604713578f5e74e6bc8bcaef7997`（先頭 8 桁が filename suffix `5c1a4163` と一致。publisher は完全値を公開していない） |
| B | C7 検出（Annotation Assist Model） | Hugging Face `IDEA-Research/grounding-dino-tiny`、revision `a2bb814dd30d776dcf7e30523b00659f4f141c71` | `model.safetensors`（同 revision） | `689,359,096` | `1a2412ef99bd74bcd3c2a246fa1e48581f8889a1300c9051974741314fc042f3`（HF API の LFS metadata が公開する SHA-256 と一致） |

artifact B の実行に必要な同 revision の非 LFS file（`config.json`、`preprocessor_config.json`、`tokenizer.json`、`tokenizer_config.json`、`special_tokens_map.json`、`added_tokens.json`、`vocab.txt`）は、権利上 artifact B の付属物として同じ決定に含める。各 file の SHA-256 は採用記録に記録する。

### 1.1 対象外であることを明示するもの

| 対象外 | 理由 |
|---|---|
| Grounding DINO GitHub release の `groundingdino_swint_ogc.pth` / `groundingdino_swinb_cogcoor.pth` | 2026-09-22 決定の対象であり、本決定とは**別 artifact**。artifact B との重みの等価性は確認していない |
| `IDEA-Research/grounding-dino-tiny` の `pytorch_model.bin` | pickle 形式。安全形式でないため選択しない |
| `google/siglip-base-patch16-224` | 2026-09-22 決定の対象（`model.safetensors`、SHA-256 `2c63cb7d1f2e95ba501893cbb8faeb4ea9a3af295498d35097126228659c2af8`）。本書で再決定しない |
| `google/siglip2-base-patch16-224`、`MobileNet_V3_Small` / `Large_V1`、timm 版 | 採用候補として選んでいないため決定しない |
| OpenAI CLIP、OWL-ViT、OWLv2 | FR-LIC-015 / intended use 不適合のため FR-LIC-016 の対象外 |

## 2. 一次資料から確認できた事実と、確認できなかった項目（FR-LIC-016(1)）

### 2.1 artifact A（MobileNetV3 Large V2）

| 区分 | 内容 |
|---|---|
| 確認できた | C5 code は BSD-3-Clause（torchvision `v0.26.0` LICENSE）。weights metadata の学習データは ImageNet-1K。ImageNet の access terms は Database を "non-commercial research and educational purposes" に限定する（`https://www.image-net.org/download.php`、取得 2026-09-23、保存 copy SHA-256 `275647ff587098083f5c53ccf5aa07a4732ca08b81822964c88e5ab40ad07ad4`。2026-09-22 取得の copy と同一 bytes） |
| 確認できなかった | (1) checkpoint 固有 license（存在しない）、(2) ImageNet terms が派生重みの商用利用・再配布に及ぶか否か（terms は Database の利用条件であり、派生重みについて記載しない）、(3) 画像ごとの権利、(4) publisher による完全 SHA-256 |
| 除外条項の該当 | **該当しない**。torchvision の一次資料は重みの商用利用・deployed use を明示的に禁止しておらず、out-of-scope use の節も存在しない。ImageNet terms の制限は Database 利用者に対するもので、FR-LIC-006 は ImageNet 由来重みを本経路で扱えることを明記している |

### 2.2 artifact B（Grounding DINO tiny、HF safetensors）

| 区分 | 内容 |
|---|---|
| 確認できた | model card front matter `license: apache-2.0`、intended use "You can use the raw model for zero-shot object detection"。out-of-scope use の節は存在しない。実装は transformers 本体の `GroundingDinoForObjectDetection`（`config.json` の `architectures`）で、remote code を要しない |
| 確認できなかった | (1) card の `apache-2.0` タグが checkpoint 層の許諾表明であるか（FR-LIC-005 によりタグだけを根拠にしない）、(2) **学習データ**。card は学習データを一切記載しない。GitHub 版 Swin-T の学習データ（O365、GoldG、Cap4M。[`detection-assist.md`](../detection-assist.md) §4.4）と同一かは未確認、(3) 各学習データの terms と派生物条件、(4) GitHub 版 `.pth` との重みの等価性・変換経緯 |
| 除外条項の該当 | **該当しない**。商用利用・deployed use の明示的禁止も out-of-scope の記載もない |

## 3. 決定の内容

決定者 **dahatake** は、artifact A・B について、上記の未確認項目を**未確認のまま開示して**、本 repository の責任で採用する。

| 項目 | 決定 |
|---|---|
| checkpoint license 識別子 | **`LicenseRef-AutoVisionStudio`**（SPDX `LicenseRef-` 構文による repository ローカル参照。publisher が発行した識別子ではない） |
| `commercialUseConfirmed` / `redistributionPermitted` / `commercialDerivativesPermitted` | 本決定に基づき `true` とする。**publisher の確認ではない**ことを `noticeText` に明記する（FR-LIC-016(3)） |
| NOTICE | 各採用記録 §5 の文面を正とし、risk acceptance である事実と未確認項目を含める（FR-LIC-016(4)） |

## 4. 本決定が意味しないこと

1. publisher が checkpoint 固有 license statement を発行した事実はない。
2. ImageNet・O365・GoldG・Cap4M 等の画像ごとの権利が確認された事実はない。
3. 外部法務の書面判断は存在しない。
4. **技術 gate を緩和しない**（FR-LIC-016(5)）。SHA-256、安全形式、ONNX parity、CPU / DirectML 互換、性能、補助品質 baseline（NFR-ANN-006）は各採用記録の実測に従い、未達の artifact は manifest に登録しない。
5. 配布主体が変わる場合は再審査する。

## 5. 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
