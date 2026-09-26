# モデル採用審査記録 — OWL-ViT base patch32（C7 検出）

> 本記録は [`adoption-template.md`](adoption-template.md) に従う **C7 検出の採用記録**である。最終判定は **承認**（2026-09-26）であり、manifest に登録する。
> 権利層は repository owner の条件付き書面決定（[2026-09-23 C7 検出 risk acceptance](evidence/2026-09-23-owner-risk-acceptance-c7-detection.md) の artifact D）に基づく。この決定は同記録 §3.2 の採用時の確認・署名で確定する条件付きのものであり、publisher の checkpoint license statement ではない（FR-LIC-016）。§3.2 の確認・署名は所有者の判断 [G2D-06](evidence/2026-09-24-owner-ruling-G2D-06.md) により行われ、§15 に記録した。

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

`THIRD_PARTY_NOTICES` へ追記し、アプリ内ライセンス画面に表示する内容（C5 / C7 / C8 を分けて記載する。[`siglip-base-patch16-224-adoption.md`](siglip-base-patch16-224-adoption.md) §5 と同じ形）。FR-LIC-016(4) の開示（publisher grant でない旨、risk acceptance §2.2 の未確認項目）と、FR-LIC-003 / owner rulings D2 / risk acceptance §3 の **研究目的に限る**旨を含める:

```text
AutoVision Studio bundles the object detection assist model
"OWL-ViT base patch32" (google/owlvit-base-patch32).
OWL-ViT assist suggestions are provided for research purposes only.

[C5] Model implementation code
    Hugging Face Transformers v5.17.0 (https://github.com/huggingface/transformers),
    Apache License 2.0. Copyright 2018- The Hugging Face team.
    The full Apache License 2.0 text is reproduced in THIRD_PARTY_NOTICES.

[C7] Checkpoint weights
    File: model.safetensors (revision cbc355fb364588351c5d51c7f74465e8e7ec6f72)
    SHA-256: 4dbe0399f0b7d7c8dddf1535a98769cc30743bebc877aea681998c8d984ce52b
    Source: https://huggingface.co/google/owlvit-base-patch32/resolve/cbc355fb364588351c5d51c7f74465e8e7ec6f72/model.safetensors
    No checkpoint-specific license statement by the publisher has been
    confirmed.
    These weights are bundled under LicenseRef-AutoVisionStudio, a
    repository-local license reference recorded under the risk acceptance of
    the AutoVision Studio repository owner (dahatake, 2026-09-23). This
    reference does not assert any grant by the publisher.
    The manifest fields productUsePermitted, redistributionPermitted and
    productDerivativesPermitted are set from that owner decision, not from
    a publisher confirmation (FR-LIC-016).
    Unconfirmed at the time of the decision: whether the apache-2.0 tag of the
    model card is a checkpoint-level license statement, the terms of the
    training data (the crawled image-caption data, YFCC100M, COCO and
    OpenImages) and the conditions for use and redistribution of weights
    derived from them, the complete list of training data, and whether these
    weights are identical to the weights of the training procedure described
    in the model card.
    The model card states that the model is intended as a research output for
    research communities. OWL-ViT assist suggestions are therefore provided
    for research purposes only, which is narrower than the AutoVision Studio
    model use condition (non-commercial research and educational purposes,
    requirement definition v0.7). In this manifest, productUsePermitted and
    productDerivativesPermitted denote permission for that use condition,
    not for commercial use (TBD-09).

[C8] Training data
    According to the model card, the CLIP backbone was trained on publicly
    available image-caption data, crawled from a handful of websites and taken
    from pre-existing datasets such as YFCC100M, and the prediction heads and
    the backbone were fine-tuned on object detection datasets such as COCO and
    OpenImages. The model card gives these datasets as examples and does not
    give a complete list; the complete list remains unconfirmed. The
    training data is not redistributed with AutoVision Studio.
```

| 項目 | 内容 |
|---|---|
| アプリ内ライセンス画面への表示文字列 | 上記 NOTICE 全文。設定画面の「ライセンス・情報」に、研究目的に限る旨と NOTICE 全文（`resources/licenses/owlvit-base-patch32.NOTICE.txt`）を表示する（G2A-04、FR-LIC-012） |
| NOTICE ファイルの伝播要否 | transformers v5.17.0 の repository root に NOTICE file は無い（[`siglip-base-patch16-224-adoption.md`](siglip-base-patch16-224-adoption.md) §5）。本 NOTICE を installer payload とアプリ内表示の双方へ同一文面で伝播する |
| Apache-2.0 の特許条項確認 | C5 の transformers は Apache-2.0（§7 の LICENSE 保存 copy）。checkpoint 層には適用しない（FR-LIC-005） |

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
| 権利判断の根拠書面 | `https://github.com/dahatake/AutoVision-Studio/blob/main/docs/model-governance/evidence/2026-09-23-owner-risk-acceptance-c7-detection.md` | `docs/model-governance/evidence/2026-09-23-owner-risk-acceptance-c7-detection.md` | `1250a46655578654e9024f052c9a1d83728da3ef4b374647841bc43192511b75` |
| 狭い制限の扱い（D2） | `https://github.com/dahatake/AutoVision-Studio/blob/main/docs/model-governance/evidence/2026-09-23-owner-rulings.md` | `docs/model-governance/evidence/2026-09-23-owner-rulings.md` | `bcd4c8a55113b88af33c48946b19a486c04e958ad002606d3da1df07edf1eb84` |
| C5 code license（transformers v5.17.0、2026-09-25 取得） | `https://raw.githubusercontent.com/huggingface/transformers/v5.17.0/LICENSE` | `docs/model-governance/evidence/transformers-v5.17.0-LICENSE.txt` | `77fd4710def9ec3c0f6225800e0235f15a425abd4a8b03559127fcd782612049` |
| COCO terms of use（2026-09-22 取得） | `https://cocodataset.org/#termsofuse` | `docs/model-governance/evidence/coco-terms-of-use-20260922.html` | `bd019f88ee44c29b2f19c5b99888cf5bc2e7c16f57b6e52af8ed3a60462e8bdd` |
| YFCC100M の配布頁（2026-09-25 取得。License は Webscope License Agreement に従うと記載） | `https://multimediacommons.wordpress.com/yfcc100m-core-dataset/` | `docs/model-governance/evidence/yfcc100m-core-dataset-20260925.html` | `b7c046b5e57d15358bda5ae771dba66bdccc0689d6e827bd94f100a56da891f0` |
| Open Images V7 の説明頁（2026-09-25 取得。annotation は CC BY 4.0、画像は CC BY 2.0 と記載、個々の画像の license は保証しない） | `https://storage.googleapis.com/openimages/web/factsfigures_v7.html` | `docs/model-governance/evidence/openimages-v7-factsfigures-20260925.html` | `03f731edf0a6524ae0403253fb3d805b51a42bbaf45a436bfc4491a650fa4fb0` |
| risk acceptance §3.2 の署名（G2D-06） | `https://github.com/dahatake/AutoVision-Studio/blob/main/docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-06.md` | `docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-06.md` | `625b5a1cf2c9a816efab48be99b24d1c55e8156a0ab4785bbc6bf634f3a6a307` |
| 所有者の承認の回答（2026-09-25） | `https://github.com/dahatake/AutoVision-Studio/blob/main/docs/model-governance/evidence/2026-09-25-owner-ruling-G2A-01-02-G2D-08.md` | `docs/model-governance/evidence/2026-09-25-owner-ruling-G2A-01-02-G2D-08.md` | `1262ebb21e2f142a8f348627fba66a5c08cf918de4a66bb6ccbd0ed4addd7a76` |
| 比較試験を Gate 2 のタスクから外す判断（2026-09-25） | `https://github.com/dahatake/AutoVision-Studio/blob/main/docs/model-governance/evidence/2026-09-25-owner-ruling-assist-trial-deferral.md` | `docs/model-governance/evidence/2026-09-25-owner-ruling-assist-trial-deferral.md` | `6655690e061d027a8048a60f5a7a044b6a8eabefadaf18ab099b6730df469849` |
| risk acceptance §4 の変更と比較試験の免除（2026-09-26） | `https://github.com/dahatake/AutoVision-Studio/blob/main/docs/model-governance/evidence/2026-09-26-owner-rulings.md` | `docs/model-governance/evidence/2026-09-26-owner-rulings.md` | `4922a03a7e8dc71b6fc74f299e7a936c1b650a1f64ab87ed44bc4b015455e42b` |

model card は crawl した website を特定しておらず、その image-caption data の terms は確認できない。manifest の `trainingData[].termsUrl` には、その data を学習データとして記載する model card の URL（上表 1 行目）を置き、terms を確認できない旨を `redistributionConditions` に書く。model card は COCO と OpenImages の version を記載しない（"such as"）。上表の COCO・Open Images の頁は、各 dataset の現行の terms を記録したものである。

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
| `confidenceThreshold` | `0.0002533551160013303` | gold set の実測から選んだ値（DQ-07。所有者の判断 [G2Q-03](evidence/2026-09-25-owner-ruling-G2Q-03.md) の方針 A、[`owlvit-assist-result.md`](../../spikes/models/owlvit-assist-result.md) §7.2）。採用の審査（G2A-02、2026-09-26）で確定した。境界は schema の `score >= threshold` で、transformers の後処理（`score > threshold`）と異なるため、製品の後処理は `>=` で実装する（同 §7.1）。この閾値での検出単位の parity は §10 のとおり合格 |
| `thresholdPolicy` | 「G2Q-03 方針 A: gold set 上で coverage 0.5 以上の閾値のうち F1（IoU 0.5 以上、1 対 1）が最大のもの。記録する値は選んだ score と次に小さい候補の中点。証拠: `spikes/models/owlvit-assist-result.md` §7.2」 | 所有者の判断 [G2Q-03](evidence/2026-09-25-owner-ruling-G2Q-03.md) と実行計画 [`20260925-0420-G2Q03-ExecutionPlan.md`](../../work/20260925-0420-G2Q03-ExecutionPlan.md) §1。採用の審査（G2A-02、2026-09-26）で確定した |
| `deterministicInference` | `true` | 実測（CPU・DirectML の反復推論 bit 一致） |
| `nonDeterministicOperations` | 省略 | 決定論的のため |
| `seeds` | `{"torch": 20260922}` | gold set の測定の seed（[`owlvit-assist-result.md`](../../spikes/models/owlvit-assist-result.md) §7.1） |

`inferenceConfig` の外で決める必要がある項目: text query の prompt 形式（spike の生出力の測定は `a photo of a wheat head` / `a photo of a leaf`、上の閾値を選んだ gold set の測定は `a photo of a {label}` で `{label}` は class 名の `_` を空白に置き換えたもの（例: `a photo of a wheat head`。[`owlvit-assist-result.md`](../../spikes/models/owlvit-assist-result.md) L28・§7.1））。製品の text query は、閾値を選んだ測定と同じ規則 `a photo of a {label}` とする。閾値はこの規則の score で選んだため、規則を変える場合は閾値を選び直す。

## 10. OS・Execution Provider 互換性

| 項目 | 測定値 | 許容基準 | 判定 |
|---|---|---|---|
| ONNX 変換（検出器全体 1 graph） | 成功（opset 17、`dynamo=False`、置換なし） | 成功必須 | **合格** |
| 生出力 `logits` / `pred_boxes`（3 比較） | すべて許容差内（最大絶対差 `1.6255e-03` / `1.4734e-04`） | `rtol ≤ 1e-3` かつ `atol ≤ 1e-4` | **合格** |
| 閾値前の全 patch（2,880） | score 最大差 `6.3838e-06`、box 最大差 `0.1239` px、label 2,880 / 2,880 一致 | 判定に使わない（記録のみ） | — |
| 検出単位（gold set 20 item、`confidenceThreshold` `0.0002533551160013303`、各 backend 2,820 件） | A1: 生出力は 3 比較とも範囲内。A2: 画像ごとの検出数が一致し、全検出が IoU 0.99 以上で 1 対 1 に対応（label 不一致 0、score 最大差 `1.5395e-06`）。A3: F1 の torch との差は最大 `5.13e-04`（torch / DirectML `0.247756`、CPU `0.248269`）。原寸 px の box 最大差 `7.4707e-02`（記録のみ） | 所有者の判断 G2Q-03D-T の A1〜A3（[`2026-09-25-owner-ruling-G2Q-03D-parity.md`](evidence/2026-09-25-owner-ruling-G2Q-03D-parity.md)）。px 単位の [`compare`](../../spikes/models/detection_checkpoint_parity.py) の box 許容差 `1.0e-03` では不合格（[`owlvit-assist-result.md`](../../spikes/models/owlvit-assist-result.md) §7.3） | **合格**（[`owlvit-assist-result.md`](../../spikes/models/owlvit-assist-result.md) §7.5） |
| DirectML の node 割当 | ORT が一部 node の CPU 割当を警告（範囲は未測定） | — | 記録のみ |

## 11. 性能

| 指標（検出器 graph 全体、画像ごと） | 測定値（3 回） | 採用基準（C7 の推論性能は、所有者の判断 [G2D-01](evidence/2026-09-24-owner-ruling-G2D-01.md) により POC-03 の値と比べて記録し、合否に使わない） | 判定 |
|---|---|---|---|
| p95（CPU EP） | `1,569.854` / `1,514.585` / `918.067` ms | POC-03 の値 ≤ 100 ms（参考） | 記録のみ（POC-03 の値を上回る） |
| p95（DirectML EP） | `42.338` / `51.783` / `62.500` ms | POC-03 の値 ≤ 100 ms（参考） | 記録のみ（POC-03 の値以内） |
| throughput（CPU EP） | `1.25` / `0.92` / `1.51` FPS | POC-03 の値 ≥ 10 FPS（参考） | 記録のみ（POC-03 の値を下回る） |
| throughput（DirectML EP） | `27.25` / `21.81` / `18.07` FPS | POC-03 の値 ≥ 10 FPS（参考） | 記録のみ（POC-03 の値以上） |
| 精度（対象用途） | gold set 20 item で F1 `0.2478`（torch、閾値 `0.0002533551160013303`。[`owlvit-assist-result.md`](../../spikes/models/owlvit-assist-result.md) §7.2） | 承認された gold set 計画に精度の下限は無い | 記録のみ |
| checkpoint サイズ | `612,983,940` byte | 数値基準なし | — |

## 12. 補助 / 手動比較試験（NFR-ANN-006）

**免除（所有者の判断。未実施）。** [所有者の判断（2026-09-26）](evidence/2026-09-26-owner-rulings.md)により、比較試験を Version 1 の実施対象から外し、完了扱いとした。試験は行っておらず、最終 Ground Truth の品質を悪化させないことと annotation 所要時間の短縮は検証されていない。同判断により、[2026-09-23 risk acceptance](evidence/2026-09-23-owner-risk-acceptance-c7-detection.md) §4 の 1・2 のうち比較試験の後に承認・登録する部分は変更された（[`adoption-template.md`](adoption-template.md) §12 の例外）。harness は [`assist-result.md`](../../spikes/models/assist-result.md)。

## 13. セキュリティ

2026-09-24 に GitHub Global Security Advisories を照会した。対象は spike venv の `$PY` が報告した `transformers==5.17.0`、`tokenizers==0.23.2`、`safetensors==0.8.0`、`huggingface-hub==1.31.0`、`torch==2.11.0`、`onnx==1.22.0`、`onnxruntime-directml==1.24.4`、`numpy==2.5.2`、`pillow==12.3.0`。照会 command は exit 0、`vendor\models\_spike\advisories-D.txt` の SHA-256 は `54641414d6ca279087f58a4669b57848f03a6fd4c295a94068dc0abffb45ca03`。High / Critical advisory: 0 件。invalid advisory: 0 件。Low は `torch==2.11.0` の `GHSA-rrmf-rvhw-rf47`（reviewed / valid）のみ。

evidence: 54641414d6ca279087f58a4669b57848f03a6fd4c295a94068dc0abffb45ca03 exit=0

## 14. リリースマニフェスト対応付け

| 項目 | 値 |
|---|---|
| manifest 内の識別子 | `owlvit-base-patch32` |
| SBOM への記録状況 | **未記録**（SBOM の生成と照合は PKG phase。[owner ruling G2D-12](evidence/2026-09-24-owner-ruling-G2D-12.md)） |
| `THIRD_PARTY_NOTICES` への追記 | **未追記**（ファイル自体が未作成。§5 の文面を正とする） |
| build machine 上の検証元パス | `vendor/models/_spike/owlvit-b32/model.safetensors` |
| installer payload 内のパス | `resources/models/owlvit-base-patch32/model.safetensors`（packaging 時の配置先。現時点では未作成で、PKG-01 が検証元から同一 hash / size で配置・検証する） |
| 署名・hash 検証の対象 | **はい**（PKG-01 が `sourcePath` の SHA-256 と byteSize を検証する） |
| lock ファイルへの関連付け | 関連なし（transformers は製品 lock に未採用。依存の採用判断は AST phase。§2〜4） |
| アプリ内ライセンス画面 | 研究目的に限る旨と §5 の NOTICE 全文を表示する（G2A-04） |

## 15. 判定

| 項目 | 内容 |
|---|---|
| 最終判定 | **承認** |
| 却下・保留の理由 | なし（§12 の比較試験は [所有者の判断（2026-09-26）](evidence/2026-09-26-owner-rulings.md)により免除） |
| 権利層の状態 | **充足（risk acceptance、2026-09-23、決定者 dahatake）**。publisher の checkpoint license statement は確認されていない（model card の `apache-2.0` タグが checkpoint 層の許諾表明であるかは未確認。risk acceptance §2.2）。未確認項目は §5 の NOTICE で開示する（FR-LIC-016(1)〜(4)）。C8 の `unknown` 項目（学習データの完全な一覧、crawl した website、dataset の version / split、terms）は、FR-LIC-014 が risk acceptance を許す「学習データ terms を確認できない場合」に当たり、決定者は risk acceptance §2.2 でそれらを未確認のまま開示すると決め、§3.2 の確認（G2D-06）で確認した |
| 狭い制限（FR-LIC-003） | 研究目的に限る。risk acceptance §3 で書面承認済み。§5 の NOTICE と設定画面の「ライセンス・情報」（G2A-04）に表示する |
| 技術層の状態 | hash（§1）、安全形式（§6）、CPU / DirectML の parity（§10。検出単位は所有者の判断 G2Q-03D-T の A1〜A3 で合格）、tokenizer 監査（G2T-50D、§2〜4）、advisory 照会（§13、High / Critical 0 件）が合格。性能（§11）は所有者の判断 G2D-01 により記録のみ。`inferenceConfig`（§9）は G2Q-03D の測定から確定した |
| risk acceptance §3.2 の確認・署名 | 決定者 dahatake が 2026-09-24 に「署名する（§1〜§3 を確認済み）」と回答した（[owner ruling G2D-06](evidence/2026-09-24-owner-ruling-G2D-06.md)）。同判断のとおり、本記録の承認の時点でその署名を本記録に記録する |
| 承認者氏名 | dahatake |
| 承認者の役割 | repository owner / license decision authority |
| 承認日 | 2026-09-26 |
| 承認対象 artifact | `model.safetensors` SHA-256 `4dbe0399f0b7d7c8dddf1535a98769cc30743bebc877aea681998c8d984ce52b` |
| 承認対象 revision | `cbc355fb364588351c5d51c7f74465e8e7ec6f72` |
| 承認の経緯 | 2026-09-25 07 時台に所有者が G2A-01 / 02 に「承認します」と回答した（[owner ruling G2A-01 / G2A-02 / G2D-08](evidence/2026-09-25-owner-ruling-G2A-01-02-G2D-08.md)）。risk acceptance §4 の 1・2（比較試験の後に承認・登録する）との関係が未回答のため保留とした。2026-09-26 に所有者が、2026-09-25 の判断は §4 の 1・2 を変更すると回答し（「はい」）、比較試験を免除した（[所有者の判断（2026-09-26）](evidence/2026-09-26-owner-rulings.md)）。§5・§9・§14・§16 を確認したうえで、2026-09-25 の承認の回答を本記録の承認として、保留が解けた 2026-09-26 の日付で記録した |
| 既知の限界 | §11 のとおり、gold set 20 item の F1 は `0.2478` で、CPU EP の p95 は POC-03 の値を上回る。比較試験は免除され、補助の有用性は検証されていない |
| 再審査期限 | 設定なし。risk acceptance §3.1 の失効条件、配布主体の変更、transformers の版変更、checkpoint bytes の変更時に再審査する |
| 法務確認の要否・状況 | **未実施**。FR-LIC-016 の risk acceptance で代替した（外部法務の書面判断は存在しない） |
| manifest 登録 | 登録する |

## 16. 記入完了チェックリスト（[`adoption-template.md`](adoption-template.md) §16）

### 16.1 ライセンス審査

- [x] 1. コード層ライセンス（`Apache-2.0`、transformers v5.17.0）を確認した（§2〜4、§7 の LICENSE 保存 copy）
- [x] 2. checkpoint ライセンス識別子（`LicenseRef-AutoVisionStudio`）と根拠（2026-09-23 C7 検出 risk acceptance の artifact D）を記入した（§2〜4）
- [x] 3. 非商用の研究・教育目的での利用・再配布は、publisher の明示ではなく risk acceptance により充足扱いとした（FR-LIC-016。§5 で開示）
- [x] 4. copyleft の記載は一次資料（model card）に無い。製品のモデル利用条件より狭い用途制限（intended use が研究目的）は、owner rulings D2 により FR-LIC-003 の狭い制限として扱い、risk acceptance §3 で書面承認した（§8・§15）
- [x] 5. コードライセンス（Apache-2.0）と model card の `license: apache-2.0` タグを根拠に checkpoint を承認していない（FR-LIC-005）

### 16.2 学習データ由来

- [x] 6. model card が記載する学習データ（crawl した image-caption data、YFCC100M、COCO、OpenImages）を記入した（§2〜4）。完全な一覧と各 terms は FR-LIC-016(1) の未確認項目として §5 で開示した
- [x] 7. model card は ImageNet を学習データとして挙げていない。model card は学習データを例（"such as"）として挙げ、完全な一覧を示さないため不使用とは断定できず、§5 の「the complete list of training data」を未確認項目として開示した
- [x] 8. COCO は model card が fine-tune の dataset として挙げる（"such as"）。COCO の terms の保存 copy を §7 に記録し、§5 で開示した
- [x] 9. 法務の書面承認は存在せず、repository owner の書面決定（2026-09-23 C7 検出 risk acceptance）で代替した事実を記入した

### 16.3 証拠記録

- [x] 10. checkpoint の SHA-256 を独立計算して記入した（§1）
- [x] 11. 正確なファイルサイズ（`612,983,940` byte）を記入した（§1）
- [x] 12. 取得日を記入した（§1）
- [x] 13. 一次資料の URL・保存 copy・SHA-256 を記入した（§7。crawl した image-caption data の terms は確認できず保存できない）

### 16.4 安全形式・リモートコード

- [x] 14. `safetensors` 形式であることを確認した（§6）
- [x] 15. pickle 形式の `pytorch_model.bin` を選択していない（§1）
- [x] 16. リモートコード実行が不要であることを確認した（§6）

### 16.5 Intended Use / Model Card

- [x] 17. intended use を model card から転記した（§8）
- [x] 18. out-of-scope use は model card に記載が無いことを記録した（§8）
- [x] 19. 本製品用途のうち研究目的は intended use に含まれ、教育目的は記載が無いことを記録した。研究目的に限って提供する（§8・§15）
- [x] 20. "deployed use" が out-of-scope に記載されていないことを確認した（§8）

### 16.6 NOTICE・帰属表示

- [x] 21. `THIRD_PARTY_NOTICES` への追記内容を記入した（§5）
- [x] 22. Apache-2.0 の NOTICE ファイルの伝播要否を確認した（§5。transformers v5.17.0 に NOTICE file は無い）

### 16.7 技術性能

- [x] 23. ONNX 変換成功と parity（生出力、検出単位）を確認した（§10、[`owlvit-assist-result.md`](../../spikes/models/owlvit-assist-result.md) §7.5）
- [x] 24. Windows DirectML / CPU の動作を確認した（§10）。macOS CoreML / CPU は `N/A（A-07）`
- [x] 25. deterministic inference の条件（gold set の SHA-256、checkpoint hash、prompt 規則、preprocess の値、threshold、seed）を確認した（§1・§9、[`owlvit-assist-result.md`](../../spikes/models/owlvit-assist-result.md) §7.1）
- [x] 26. 推論 p95 レイテンシ・スループットの測定値を記録した（§11。所有者の判断 G2D-01 により合否に使わない）

### 16.8 品質比較試験

- [ ] 27. 免除（未実施）。[所有者の判断（2026-09-26）](evidence/2026-09-26-owner-rulings.md)（adoption-template §12 の例外）
- [ ] 28. 免除（未実施）。同上
- [ ] 29. 免除（未実施）。同上

### 16.9 セキュリティ

- [x] 30. Critical / High の advisory が 0 件であることを確認した（§13）

### 16.10 リリースマニフェスト

- [x] 31. manifest 内の識別子を記入した（§14）
- [x] 32. SBOM への登録予定を確定した（§14。生成と照合は PKG phase）
- [x] 33. `THIRD_PARTY_NOTICES` へ追記する文面を §5 で確定した（生成と照合は PKG phase）

### 16.11 最終承認

- [x] 34. チェック 1〜33 を完了した。項目 27〜29 は adoption-template §12 の例外により「免除（未実施）」と記録した
- [x] 35. 承認者（dahatake）が 2026-09-25 に G2A-02 の承認を回答し（[owner ruling G2A-01 / G2A-02 / G2D-08](evidence/2026-09-25-owner-ruling-G2A-01-02-G2D-08.md)）、同判断の「判断の適用」1 が求める条件がそろった後の改めての確認として、2026-09-26 に「「はい」なら G2A-02 と G2A-04 を進められます」と示した問いに「はい」と回答した（[所有者の判断（2026-09-26）](evidence/2026-09-26-owner-rulings.md)）。承認日を §15 に記入した。回答は、本記録の本文を個別に確認したとの記述を含まない
- [x] 36. §15 の判定欄に「承認」を明記した
