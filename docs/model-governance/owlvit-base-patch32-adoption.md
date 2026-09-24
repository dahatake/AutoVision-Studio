# モデル採用審査記録 — OWL-ViT base patch32（C7 検出）

> 本記録は [`adoption-template.md`](adoption-template.md) に従う **C7 検出の採用記録**である。最終判定は **保留**であり、manifest に登録しない。
> 権利層は repository owner の条件付き書面決定（[2026-09-23 C7 検出 risk acceptance](evidence/2026-09-23-owner-risk-acceptance-c7-detection.md) の artifact D）に基づく。この決定は同記録 §3.2 の採用時の確認・署名で確定する条件付きのものであり、publisher の checkpoint license statement ではない（FR-LIC-016）。本記録は保留のため、§3.2 の署名を求めていない。

## メタデータ

| 項目 | 値 |
|---|---|
| 審査対象 | Hugging Face `google/owlvit-base-patch32`、revision `cbc355fb364588351c5d51c7f74465e8e7ec6f72` |
| カテゴリー / タスク | **C7**（Annotation Assist Model）/ 物体検出（open-vocabulary、text query） |
| 記録作成日 | 2026-09-23 |
| 実測記録 | [`spikes/models/owlvit-assist-result.md`](../../spikes/models/owlvit-assist-result.md)、artifact 照合 [`work/20260923-1520-OWLViT-ControlledArtifact.md`](../../work/20260923-1520-OWLViT-ControlledArtifact.md) |

## 1. 基本識別情報

| 項目 | 値 |
|---|---|
| 取得元 URL | `https://huggingface.co/google/owlvit-base-patch32/resolve/cbc355fb364588351c5d51c7f74465e8e7ec6f72/model.safetensors` |
| 取得日 | 2026-09-23 |
| `model.safetensors` | `612,983,940` byte、SHA-256 `4dbe0399f0b7d7c8dddf1535a98769cc30743bebc877aea681998c8d984ce52b`（本 repository の計算が HF API の LFS metadata と一致） |
| 付属 file（同 revision） | `config.json` `b5934e0d2933194b8a85f93674e577feaa1a1ba2dc1d143b2d5e5305ff7a9d7c`、`preprocessor_config.json` `2010d320cd2c68a8bb1de69aaa8f89daf173ef17cc22a30e4baf44b2f0e9bb6e`、`tokenizer_config.json` `da35aceebeda2adf44094a5867940b09379323b9390fa9197b57044e106bfb6e`、`special_tokens_map.json` `f118ab3a983206e4f32583448de6bd6aae4ee21869135cef1f5848a753cdaab6`、`vocab.json` `e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349`、`merges.txt` `9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a`（Git blob SHA-1 が publisher の `blobId` と一致） |
| 選択しなかった file | `pytorch_model.bin`（pickle 形式） |

## 2〜4. ライセンス三層（C5 / C7 / C8）

| 層 | 状態 |
|---|---|
| C5 code | transformers `5.17.0` の `OwlViTForObjectDetection` / `OwlViTProcessor`（Apache-2.0）。**transformers は製品 lock に未採用**（[`dependency-policy.md`](../dependency-policy.md) §10 の採用判断は未実施） |
| C7 checkpoint | `LicenseRef-AutoVisionStudio`（条件付き書面決定、2026-09-23）。model card の `license: apache-2.0` タグは checkpoint 層の許諾表明とみなさない（FR-LIC-005） |
| C8 training data | model card: CLIP backbone は公開 image-caption data（"a handful of websites" の crawl と、"such as" YFCC100M の既存 dataset）、予測 head と backbone は "such as" COCO と OpenImages の検出 dataset で fine-tune。**`unknown`**: 学習データの完全な一覧、crawl した website の特定、各 dataset の version / snapshot / split、各 terms と派生重みの利用・再配布条件（risk acceptance §2.2 の未確認項目として開示済み） |

G2T-50D tokenizer audit（2026-09-24、publisher `google`）:

| file | byte size | 独立計算 hash | publisher 値 |
|---|---:|---|---|
| `vocab.json` | 1,059,962 | Git blob `469be27c5c010538f845f518c4f5e8574c78f7c8` | size `1059962` / blobId `469be27c5c010538f845f518c4f5e8574c78f7c8` |
| `merges.txt` | 524,619 | Git blob `76e821f1b6f0a9709293c3b6b51ed90980b3166b` | size `524619` / blobId `76e821f1b6f0a9709293c3b6b51ed90980b3166b` |
| `tokenizer_config.json` | 775 | Git blob `2460b9a4e2f76172145e9eef9e26cc3419c53727` | size `775` / blobId `2460b9a4e2f76172145e9eef9e26cc3419c53727` |
| `special_tokens_map.json` | 460 | Git blob `ae0c5be6f35217e51c4c000fd325d8de0294e99c` | size `460` / blobId `ae0c5be6f35217e51c4c000fd325d8de0294e99c` |

spike の import 行で確認した C5 code package は `numpy==2.5.2`、`onnx==1.22.0`、`onnxruntime-directml==1.24.4`、`torch==2.11.0`、`transformers==5.17.0`、`pillow==12.3.0`。製品依存としては選定しない。

tokenizer-audit exit=0

## 5. NOTICE

**未作成**（保留のため）。承認する場合は、FR-LIC-016(4) の開示文（publisher grant でない旨、risk acceptance §2.2 の未確認項目）に加え、FR-LIC-003 / owner rulings D2 により **「OWL-ViT による補助候補は研究目的に限って提供する」旨**を `noticeText` / `redistributionConditions` と設定画面の「ライセンス・情報」に表示する（risk acceptance §3）。

## 6. 安全形式・リモートコード

| 項目 | 値 |
|---|---|
| 形式 | **safetensors** |
| remote code | **不要**。`config.json` に `auto_map` がなく、`architectures` は transformers 本体の `OwlViTForObjectDetection`。`from_pretrained(local_files_only=True, use_safetensors=True)` で load した |

## 7. 一次資料・証拠ハッシュ（2026-09-23 取得）

| 資料 | URL | 保存コピー | SHA-256 |
|---|---|---|---|
| model card（revision 固定） | `https://huggingface.co/google/owlvit-base-patch32/resolve/cbc355fb364588351c5d51c7f74465e8e7ec6f72/README.md` | `docs/model-governance/evidence/owlvit-base-patch32-model-card-cbc355fb-20260923.md` | `a16c707494da894773e85c1be976ae605a7b3a3ce92cf9ed277623dd25f236bf` |
| HF API metadata（LFS SHA-256、blobId） | `https://huggingface.co/api/models/google/owlvit-base-patch32?blobs=true` | `docs/model-governance/evidence/owlvit-base-patch32-hf-api-20260923.json` | `da65ba7b0e5baffa5366d5dc3d885c0e0a0b4722761d2e84790e43736e82d459` |
| 権利判断の根拠書面 | — | `docs/model-governance/evidence/2026-09-23-owner-risk-acceptance-c7-detection.md` | `1250a46655578654e9024f052c9a1d83728da3ef4b374647841bc43192511b75` |
| 狭い制限の扱い（D2） | — | `docs/model-governance/evidence/2026-09-23-owner-rulings.md` | `bcd4c8a55113b88af33c48946b19a486c04e958ad002606d3da1df07edf1eb84` |

## 8. Intended Use / Out-of-Scope Use

| 項目 | 内容 |
|---|---|
| Intended use（原文、保存 copy） | "The model is intended as a research output for research communities." / "The primary intended users of these models are AI researchers." |
| Out-of-scope use | **記載なし** |
| 製品用途（非商用の研究・教育目的の検出候補の提示）が intended use に含まれるか | **研究目的は含まれる。教育目的は記載がない**（owner rulings D2 により FR-LIC-003 の狭い制限として扱い、risk acceptance §3 で書面承認済み。採用時は「研究目的に限る」表示が必要） |
| OpenAI CLIP との関係（FR-LIC-015） | card は "The CLIP backbone is trained from scratch" と記載し、OpenAI CLIP の重みを初期値にしていない |

## 9. 推論定義（NFR-ANN-004）— 実測値のみ記録

| 項目 | 値 |
|---|---|
| 対象タスク | 物体検出（text query、box + query index + score） |
| 入力 | RGB、processor 出力 `1x3x768x768`（padding なしの resize、`resample: 3`、CLIP の mean / std で normalize）。text query は `padding="max_length"`、長さ 16 |
| 出力 | patch ごと（576）の query 別 logit と `cxcywh` box（resize 後入力に対する相対値） |
| score の意味 | patch ごとに query 方向の最大 logit の sigmoid。**正解確率ではない**。理論範囲 `(0, 1)`。本 fixture（gwhd-2021、query 2 件）の観測最大値 `0.0272` |
| 決定論的推論 | 反復推論が CPU・DirectML とも bit 一致（実測記録 §4） |
| seed | `torch.manual_seed(20260922)` |

manifest の `inferenceConfig`（[`manifest.schema.json`](../../resources/models/manifest.schema.json)、`additionalProperties: false`）に対応する値:

| field | 値（schema の形） | 状態 |
|---|---|---|
| `scoreMeaning` | 「patch ごとに text query 方向の最大 logit の sigmoid。正解確率ではなく、較正されていない」 | 実装から確定 |
| `scoreRange` | `{"minimum": 0, "maximum": 1}` | 実装から確定（sigmoid の値域。float32 では両端に丸まり得るため閉区間で表す） |
| `confidenceThreshold` | — | **`unknown`**（DQ-07: gold set の実測から決める。gold set 未実施）。spike の比較用 floor `0.05` を超える検出は本 fixture で 0 件で、閾値の根拠にならない。schema は `score >= threshold`、transformers の後処理は `score > threshold` であり、製品の境界の扱いも未決定 |
| `thresholdPolicy` | — | **`unknown`**（`confidenceThreshold` と同時に決める） |
| `deterministicInference` | `true` | 実測（CPU・DirectML の反復推論 bit 一致） |
| `nonDeterministicOperations` | 省略 | 決定論的のため |
| `seeds` | spike は `{"torch": 20260922}` | 製品の推論経路の seed は**未設定** |

`inferenceConfig` の外で決める必要がある項目: text query の prompt 形式（spike は `a photo of a <label>`、製品では **`unknown`**）。

## 10. OS・Execution Provider 互換性

| 項目 | 測定値 | 許容基準 | 判定 |
|---|---|---|---|
| ONNX 変換（検出器全体 1 graph） | 成功（opset 17、`dynamo=False`、置換なし） | 成功必須 | **合格** |
| 生出力 `logits` / `pred_boxes`（3 比較） | すべて許容差内（最大絶対差 `1.6255e-03` / `1.4734e-04`） | `rtol ≤ 1e-3` かつ `atol ≤ 1e-4` | **合格** |
| 閾値前の全 patch（2,880） | score 最大差 `6.3838e-06`、box 最大差 `0.1239` px、label 2,880 / 2,880 一致 | 判定に使わない（記録のみ） | — |
| 検出単位（score `> 0.05`） | 全 backend 0 件（比較は空） | [`compare`](../../spikes/models/detection_checkpoint_parity.py) | **未確認**（採用する閾値の score 帯で検出が 1 件以上ある比較が必要） |
| DirectML の node 割当 | ORT が一部 node の CPU 割当を警告（範囲は未測定） | — | 記録のみ |

## 11. 性能

| 指標（検出器 graph 全体、画像ごと） | 測定値（3 回） | 採用基準 | 判定 |
|---|---|---|---|
| p95（CPU EP） | `1,569.854` / `1,514.585` / `918.067` ms | ≤ 100 ms | **不合格** |
| p95（DirectML EP） | `42.338` / `51.783` / `62.500` ms | ≤ 100 ms | **合格** |
| throughput（CPU EP） | `1.25` / `0.92` / `1.51` FPS | ≥ 10 FPS | **不合格** |
| throughput（DirectML EP） | `27.25` / `21.81` / `18.07` FPS | ≥ 10 FPS | **合格** |
| 精度（対象用途） | **未測定**（gold set 未実施） | — | **未測定** |
| checkpoint サイズ | `612,983,940` byte | 数値基準なし | — |

## 12. 補助 / 手動比較試験（NFR-ANN-006）

**未実施。** C7 分類・検出の両方が承認された場合だけ実施する（[`assist-result.md`](../../spikes/models/assist-result.md)）。

## 13. セキュリティ

2026-09-24 に GitHub Global Security Advisories を照会した。対象は spike venv の `$PY` が報告した `transformers==5.17.0`、`tokenizers==0.23.2`、`safetensors==0.8.0`、`huggingface-hub==1.31.0`、`torch==2.11.0`、`onnx==1.22.0`、`onnxruntime-directml==1.24.4`、`numpy==2.5.2`、`pillow==12.3.0`。照会 command は exit 0、`vendor\models\_spike\advisories-D.txt` の SHA-256 は `54641414d6ca279087f58a4669b57848f03a6fd4c295a94068dc0abffb45ca03`。High / Critical advisory: 0 件。invalid advisory: 0 件。Low は `torch==2.11.0` の `GHSA-rrmf-rvhw-rf47`（reviewed / valid）のみ。

evidence: 54641414d6ca279087f58a4669b57848f03a6fd4c295a94068dc0abffb45ca03 exit=0

## 14. リリースマニフェスト対応付け

**未登録**（§15 が保留のため）。

## 15. 判定

| 項目 | 内容 |
|---|---|
| 最終判定 | **保留** |
| 保留の理由 | (1) §11 の CPU EP の p95 / throughput が採用基準に不適合。manifest の `support[]` は CPU と DirectML の両方を要求する。(2) §12 の比較試験が未実施。(3) §9 の `confidenceThreshold` / `thresholdPolicy`、製品の seed、prompt 形式が未決定で、その score 帯での検出単位の parity も未確認（本 fixture の比較は 0 件どうし）。(4) §2〜4 の C8 学習データの完全な一覧・website・dataset の version / split・terms が `unknown`。(5) transformers の依存採用判断と、採用時点の advisory 照会（§13）が未実施。(6) risk acceptance §3.2 の決定者の確認・署名が未実施（承認時に行う） |
| 権利層 | 条件付き書面決定（2026-09-23、決定者 dahatake）。本保留は権利判断を取り消さない |
| 再審査の条件 | 次をすべて満たすこと: CPU 経路で採用基準を満たす実測（量子化等は別途の技術作業）、§12 の比較試験、gold set からの閾値・閾値方針・境界の扱い・prompt 形式・製品の seed の決定とその score 帯で検出が 1 件以上ある検出単位の parity、transformers の依存採用判断と Critical / High advisory 0 件の照会。C8 の `unknown` 項目は、一次資料で解消するか、要求定義 FR-LIC-014 が risk acceptance を許す「学習データ terms を確認できない場合」（FR-LIC-016）に当たるかを決定者が判断し、当たる場合は FR-LIC-016(1)(4) の未確認項目として列挙・表示する。当たらない項目が残る場合は承認しない。承認時は §5 の「研究目的に限る」表示と risk acceptance §3.2 の署名 |
