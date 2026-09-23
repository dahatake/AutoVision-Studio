# 緩和後ライセンス要件（FR-LIC-016）で採用可能なモデルの調査

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書（調査記録）。**採用決定ではない** |
| 作成日時 | 2026-09-23 05:46 |
| 調査日 | **2026-09-23**（本書の URL はすべてこの日に取得） |
| 適用基準 | [`requirement-definition.md`](../docs/requirement-definition.md) FR-LIC-016（v0.6 Draft で新設）、FR-LIC-014 / 015、[`adoption-template.md`](../docs/model-governance/adoption-template.md) §8・§10・§11 |
| 先行記録 | [`20260923-0025-Gate2LaneFinalization.md`](20260923-0025-Gate2LaneFinalization.md) §7（緩和の内容） |

---

## 1. 本調査の判定基準

FR-LIC-016 が緩和するのは **checkpoint 層ライセンスと学習データ terms の「確認できない」状態**だけである。次は**緩和されていない**ため、候補選定でも維持する。

| 維持される gate | 出所 | 本調査での扱い |
|---|---|---|
| 一次資料が商用利用・deployed use を**明示的に禁止または out-of-scope としている** | FR-LIC-015、FR-LIC-016 の除外条項 | **除外**（適用不可） |
| 製品用途が model card の **intended use に含まれない／判断不能** | [`adoption-template.md`](../docs/model-governance/adoption-template.md) §8「含まれない → **同梱不可** / 判断不能 → **同梱不可**」 | **除外** |
| SHA-256・安全形式・ONNX parity・CPU/DirectML 互換・性能 | FR-LIC-016(5) | 候補段階では**未検証**として明記（実測は採用時） |
| remote code 実行（`trust_remote_code` 相当） | FR-SEC-007、[`detection-assist.md`](../docs/model-governance/detection-assist.md) DA-B05 | **減点要因**として明記 |
| 新規依存の追加 | [`dependency-policy.md`](../docs/dependency-policy.md) §10 | **コスト**として明記 |

## 2. 結論（役ごとの第一候補）

| 役 | 第一候補 | FR-LIC-016 適用可否 | 新規依存 | 残る技術作業 |
|---|---|---|---|---|
| **C6 分類** | torchvision `MobileNet_V3_Small_Weights.IMAGENET1K_V1` / `MobileNet_V3_Large_Weights.IMAGENET1K_V2` | **可** | **不要**（torchvision は既存依存） | 取得・hash・安全 load・ONNX parity・性能 |
| C6 検出 | SSDLite320-MobileNetV3（既取得） | 可（権利は決定済み） | 不要 | **性能が採用基準に不適合**（本緩和では解消しない） |
| **C7 分類** | `google/siglip2-base-patch16-224`（または既取得の `siglip-base-patch16-224`） | **可** | **`transformers` が必要** | ONNX 化・parity・性能・`inferenceConfig` の値 |
| **C7 検出** | `IDEA-Research/grounding-dino-tiny`（transformers 版） | **可** | **`transformers` が必要** | ONNX 化・parity・性能・`inferenceConfig` の値 |

**除外された主な候補:** OWL-ViT / OWLv2（intended use が研究用途）、OpenAI CLIP（deployed use が out-of-scope）。詳細は §4。

---

## 3. 候補ごとの一次資料（取得日 2026-09-23）

### 3.1 C6 分類 — torchvision MobileNetV3（ImageNet-1k）

出典: `https://raw.githubusercontent.com/pytorch/vision/v0.26.0/torchvision/models/mobilenetv3.py`

| 候補 | 取得 URL（publisher） | `_file_size`（publisher 記載） | ImageNet-1K acc@1 | params |
|---|---|---:|---:|---:|
| `MobileNet_V3_Small_Weights.IMAGENET1K_V1` | `https://download.pytorch.org/models/mobilenet_v3_small-047dcff4.pth` | `9.829` MB | `67.668` | `2,542,856` |
| `MobileNet_V3_Large_Weights.IMAGENET1K_V1` | `https://download.pytorch.org/models/mobilenet_v3_large-8738ca79.pth` | `21.114` MB | `74.042` | `5,483,032` |
| `MobileNet_V3_Large_Weights.IMAGENET1K_V2` | `https://download.pytorch.org/models/mobilenet_v3_large-5c1a4163.pth` | `21.107` MB | `75.274` | `5,483,032` |

- **checkpoint 固有 license: 存在しない**（torchvision の model documentation に license 節はない）。→ FR-LIC-016 の適用前提を満たす。
- **学習データ: ImageNet-1k**。terms は「非商用研究・教育目的に限定」（[`classification-base.md` §12.2](../docs/model-governance/classification-base.md) が `https://www.image-net.org/download.php` から 2026-09-22 に取得して引用）。→ FR-LIC-016 の risk acceptance 対象。
- **intended use は一次資料に記載がある。** 同 source に構造の docstring（"Constructs a small MobileNetV3 architecture from ``Searching for MobileNetV3``"）、`_COMMON_META` の `categories = _IMAGENET_CATEGORIES`（ImageNet-1k の 1000 クラス分類）、weights の `_docs`（"These weights were trained from scratch by using a simple training recipe."）がある。製品用途（端末内の画像分類）はこの記載範囲に含まれると判断できる。
- **out-of-scope の節は存在しない**（記載が無いことを確認した。未確認ではない）。SSDLite の採用記録 §8 も out-of-scope のみ「記載なし」としており、intended use は記載ありとして判定している。→ 除外条項に該当しない。
- **決定的な利点: 新規依存が不要。** torchvision は既に製品の直接依存（`torch==2.11.0` / `torchvision==0.26.0`、[`detection-base.md`](../docs/model-governance/detection-base.md) メタ）であり、既存 spike のコード資産（hash gate → `weights_only=True` load → ONNX export → CPU/DirectML 比較）をそのまま使える。

**同一経路の別候補（参考）:** timm `mobilenetv3_small_100.lamb_in1k`（`https://huggingface.co/timm/mobilenetv3_small_100.lamb_in1k/raw/main/README.md`、card front matter `license: apache-2.0`、`datasets: imagenet-1k`、params 2.5M、224x224）。out-of-scope 記載なし。ただし timm publisher 自身が「元データセットの license が重みに適用されると想定すべき」と警告しており（[`classification-base.md` §12.2](../docs/model-governance/classification-base.md) が 2026-09-22 に取得・引用）、card の `apache-2.0` タグと矛盾する。**新規依存 `timm` が必要**なため、torchvision 版より劣後する。

### 3.2 C7 分類 — SigLIP 2

出典: `https://huggingface.co/google/siglip2-base-patch16-224/raw/main/README.md`（front matter）と `https://huggingface.co/api/models/google/siglip2-base-patch16-224?blobs=true`

| 項目 | 値 |
|---|---|
| card `license` | `apache-2.0` |
| intended use（原文） | "**You can use the raw model for tasks like zero-shot image classification and image-text retrieval, or as a vision encoder for VLMs (and other vision tasks).**" |
| out-of-scope の節 | **存在しない** |
| 研究用途限定の記載 | **なし** |
| 学習データ（原文） | "SigLIP 2 is pre-trained on the **WebLI** dataset" → **terms 非公開**（FR-LIC-016 の対象） |
| `model.safetensors` | `1,500,800,904` byte / publisher 公開 SHA-256 `612923381c76ec5a9bed335d1c48827e3f2e506ac31b044b63b2031fadee6a0b` |
| 実装 | transformers 本体（`AutoModel`、`model_type: siglip`）。**remote code 不要** |

既取得の `google/siglip-base-patch16-224`（`812,672,320` byte、SHA-256 は publisher metadata と一致済み。[`classification-assist.md` §18](../docs/model-governance/classification-assist.md)）も同じ経路で採用可能であり、**installer サイズは SigLIP の方が約 688MB 小さい**（R-13 の配布容量リスク）。

### 3.3 C7 検出 — Grounding DINO（transformers 版）

出典: `https://huggingface.co/IDEA-Research/grounding-dino-base/raw/main/README.md` と `https://huggingface.co/api/models/IDEA-Research/grounding-dino-tiny?blobs=true`

| 項目 | 値 |
|---|---|
| card `license` | `apache-2.0` |
| intended use（原文） | "## Intended uses & limitations — **You can use the raw model for zero-shot object detection** (the task of detecting things in an image out-of-the-box without labeled data)." |
| out-of-scope の節 | **存在しない** |
| 研究用途限定の記載 | **なし** |
| `grounding-dino-tiny` の `model.safetensors` | `689,359,096` byte / **publisher 公開 SHA-256 `1a2412ef99bd74bcd3c2a246fa1e48581f8889a1300c9051974741314fc042f3`** |
| 実装 | transformers 本体（`GroundingDinoForObjectDetection` / `AutoModelForZeroShotObjectDetection`）。**remote code 不要** |
| 形式 | `safetensors`（`pytorch_model.bin` も併存するが safetensors を選択できる） |

**既存監査からの改善点:**

| 既存 blocker | 本調査での状態 |
|---|---|
| DA-B06「Grounding DINO 2 asset の SHA-256 が `unknown`」（[`detection-assist.md` §15.2](../docs/model-governance/detection-assist.md)。**同 §18.3 で GitHub 版は本 repository の再計算値により既に確定済み**） | transformers 版は **publisher 自身が SHA-256 を公開**している（HF API の LFS metadata）ため、再取得時の照合基準を publisher 値に取れる。**blocker の解消ではなく、照合基準が「自己計算値」から「publisher 公開値」へ変わる点が差分**である。**GitHub 版 `.pth` とは別 artifact** であり等価性は未確認 |
| DA-B05「Florence-2 の custom code、Grounding DINO の restricted load 経路」 | transformers 版は**本体実装のため remote code が不要**。Florence-2（`trust_remote_code` 必須）より安全側 |

### 3.4 除外した候補

| 候補 | 除外理由（一次資料原文、取得 2026-09-23） | 該当条項 |
|---|---|---|
| `google/owlv2-base-patch16-ensemble` | "The model is intended as a **research output for research communities**." / "The primary intended users of these models are **AI researchers**."（`https://huggingface.co/google/owlv2-base-patch16-ensemble/raw/main/README.md`） | adoption-template §8（製品用途が intended use に含まれない）。**FR-LIC-016 では解消しない** |
| `google/owlvit-base-patch32` | 同一文言（`https://huggingface.co/google/owlvit-base-patch32/raw/main/README.md`） | 同上 |
| OpenAI CLIP | model card が deployed use を commercial / non-commercial を問わず out-of-scope と明記（[`requirement-definition.md` §13.3](../docs/requirement-definition.md)、FR-LIC-015） | FR-LIC-015、FR-LIC-016 の除外条項 |

> OWL-ViT / OWLv2 の card は `license: apache-2.0` タグを持ち、**明示的な禁止文言はない**。除外の根拠は「禁止」ではなく **intended use の不適合**である。この区別を曖昧にしない。

---

## 4. 採用に進む場合に残る作業（候補別）

| 候補 | 権利 | 技術 | 記録 |
|---|---|---|---|
| torchvision MobileNetV3（C6 分類） | risk acceptance の書面決定（利用者） | 取得・SHA-256 独立再計算・`weights_only=True` load・ONNX export・CPU/DirectML parity・**性能実測** | 採用記録・NOTICE・evidence 保存 copy |
| SigLIP / SigLIP2（C7 分類） | **SigLIP（`google/siglip-base-patch16-224`）は 2026-09-22 に決定済み。SigLIP2 は対象外のため新規の書面決定が必要**（FR-LIC-016(2)） | **`transformers` の依存採用（§10）**・ONNX 化・parity・性能・`inferenceConfig` 6 項目 | 採用記録（C7 は §6.2 の追加項目）・NOTICE |
| Grounding DINO tiny/base（C7 検出） | **未決定**。2026-09-22 の risk acceptance は GitHub 版 `.pth`（`groundingdino_swint_ogc.pth` / `groundingdino_swinb_cogcoor.pth`）を対象としており、**HF safetensors 版には新規の書面決定が必要**（FR-LIC-016(2)） | 同上＋**GitHub 版 `.pth` との関係の記録** | 同上 |

**性能について:** SSDLite（検出、320x320）は CPU p95 `179`〜`199` ms で採用基準 `≤100` ms に不適合だった（[`detection-checkpoint-parity-result.md` §10](../spikes/models/detection-checkpoint-parity-result.md)）。MobileNetV3 分類は publisher 記載の演算量が `_ops 0.217` GFLOPs（Large）で、SSDLite 検出（`0.58` GFLOPS、[torchvision model doc](../docs/model-governance/evidence/torchvision-ssdlite320-model-doc-20260922.html)）より小さいが、**本 repository では未測定であり、基準充足を主張しない**。SigLIP2（params 約 375M 相当の 1.5GB payload）と Grounding DINO（172M params）は**いずれも SSDLite より大幅に大きく、性能基準の充足は未知**である。

## 5. 本調査が主張しないこと

1. **採用決定ではない。** いずれの候補についても権限者の risk acceptance、採用記録、manifest entry は作成していない。
2. **技術検証を一切行っていない。** 取得・hash 再計算・load・ONNX 化・parity・性能はすべて未実施である。表中の byte size と SHA-256 は **publisher が公開している metadata の転記**であり、本 repository で再計算した値ではない。
3. **card の `license` タグは checkpoint 層の許諾表明とは限らない。** FR-LIC-005 のとおり、タグだけを根拠に checkpoint を承認しない。本調査が `apache-2.0` タグを記載しているのは事実の記録であり、承認根拠ではない。
4. WebLI・FLD-5B・O365/GoldG/Cap4M 等の**学習データ terms は依然として未確認**である。FR-LIC-016 はこれを「確認済み」に変えるものではなく、未確認のまま**開示して採用する**手続きである。
