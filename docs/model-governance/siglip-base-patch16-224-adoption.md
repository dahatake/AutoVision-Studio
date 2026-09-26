# モデル採用審査記録 — SigLIP base patch16 224（C7 分類）

> 本記録は [`adoption-template.md`](adoption-template.md) に従う **C7 分類の採用記録**である。最終判定は **承認**（2026-09-25）であり、manifest に登録する。§12 の比較試験は[所有者の判断（2026-09-26）](evidence/2026-09-26-owner-rulings.md)により免除（未実施）とした。
> 権利層は repository owner の risk acceptance（[2026-09-22 記録](evidence/2026-09-22-owner-risk-acceptance.md)）により充足扱いであり、publisher の checkpoint license statement ではない（FR-LIC-016）。詳細な一次資料調査は [`classification-assist.md`](classification-assist.md) §1〜§19 を正本とし、本記録で再掲しない。

## メタデータ

| 項目 | 値 |
|---|---|
| 審査対象 | Hugging Face `google/siglip-base-patch16-224`、revision `7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed` |
| カテゴリー / タスク | **C7**（Annotation Assist Model）/ 画像分類（zero-shot） |
| 記録作成日 | 2026-09-23 |
| 実測記録 | [`spikes/models/siglip-assist-result.md`](../../spikes/models/siglip-assist-result.md) |

## 1. 基本識別情報

| 項目 | 値 |
|---|---|
| 取得元 URL | `https://huggingface.co/google/siglip-base-patch16-224/resolve/7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed/model.safetensors` |
| 取得日 | `model.safetensors` 2026-09-22、付属 file 2026-09-23 |
| `model.safetensors` | `812,672,320` byte、SHA-256 `2c63cb7d1f2e95ba501893cbb8faeb4ea9a3af295498d35097126228659c2af8`（本 repository の計算が HF API の LFS metadata と一致） |
| 付属 file（同 revision） | `config.json` `cd85b3d28829722820bcb89a2cfbb4160e55fd359249a3044da724166a8d9688`、`preprocessor_config.json` `d11ccb80f15d358a11bdb070e92e2d889005874b7db15823d5f10d9b2533b14a`、`special_tokens_map.json` `2b6a1ff67a27e0df9ac0c7d93250fc0d87431c7b366b3d5669217104f9088a26`、`spiece.model` `1e5036bed065526c3c212dfbe288752391797c4bb1a284aa18c9a0b23fcaf8ec`、`tokenizer.json` `c6e405cb7c670d56636a9402c81023a55bc6c3c53d89cf02b92f5c5005bfe920`、`tokenizer_config.json` `d6423dae508cc3a129d22ea443841c111832a1a73125b8f25ea8736951698bcb` |

## 2〜4. ライセンス三層（C5 / C7 / C8）

| 層 | 状態 |
|---|---|
| C5 code | 実行に使った実装は transformers `5.17.0` の `SiglipModel`（Apache-2.0）。**transformers は製品 lock に未採用**（[`dependency-policy.md`](../dependency-policy.md) §10 の採用判断は未実施） |
| C7 checkpoint | `LicenseRef-AutoVisionStudio`（risk acceptance、2026-09-22）。model card の `license: apache-2.0` タグは checkpoint 層の許諾表明とみなさない（FR-LIC-005） |
| C8 training data | WebLI (English image-text pairs)（model card L80「SigLIP is pre-trained on the English image-text pairs of the WebLI dataset」）。**terms は非公開**（[`classification-assist.md`](classification-assist.md) §4.1）。ImageNet・COCO 由来の有無は一次資料から断定できない（同 §4.2）。risk acceptance で充足扱い（FR-LIC-016。未確認項目は §5 の NOTICE で開示） |

G2T-50C tokenizer audit（2026-09-24、publisher `google`）:

| file | byte size | 独立計算 hash | publisher 値 |
|---|---:|---|---|
| `spiece.model` | 798,330 | SHA-256 `1e5036bed065526c3c212dfbe288752391797c4bb1a284aa18c9a0b23fcaf8ec` | size `798330` / lfs.sha256 `1e5036bed065526c3c212dfbe288752391797c4bb1a284aa18c9a0b23fcaf8ec` |
| `tokenizer.json` | 2,399,357 | Git blob `6d6fd0bd6cc263099dc98e4fa383f90c9baa3521` | size `2399357` / blobId `6d6fd0bd6cc263099dc98e4fa383f90c9baa3521` |
| `tokenizer_config.json` | 711 | Git blob `70741c5c1f6d21423ebf51ee77ef2fce868c33f2` | size `711` / blobId `70741c5c1f6d21423ebf51ee77ef2fce868c33f2` |
| `special_tokens_map.json` | 409 | Git blob `6555f2261d409dea394d6b6973129a53b8725803` | size `409` / blobId `6555f2261d409dea394d6b6973129a53b8725803` |

spike の import 行で確認した C5 code package は `numpy==2.5.2`、`onnx==1.22.0`、`onnxruntime-directml==1.24.4`、`torch==2.11.0`、`transformers==5.17.0`、`pillow==12.3.0`。製品依存としては選定しない。

tokenizer-audit exit=0

## 5. NOTICE

`THIRD_PARTY_NOTICES` へ追記し、アプリ内ライセンス画面に表示する内容（C5 / C7 / C8 を分けて記載する。[`mobilenet-v3-large-imagenet1k-v2-adoption.md`](mobilenet-v3-large-imagenet1k-v2-adoption.md) §5 と同じ形）:

```text
AutoVision Studio bundles the image classification assist model
"SigLIP base patch16-224" (google/siglip-base-patch16-224).

[C5] Model implementation code
    Hugging Face Transformers v5.17.0 (https://github.com/huggingface/transformers),
    Apache License 2.0. Copyright 2018- The Hugging Face team.
    The full Apache License 2.0 text is reproduced in THIRD_PARTY_NOTICES.

[C7] Checkpoint weights
    File: model.safetensors (revision 7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed)
    SHA-256: 2c63cb7d1f2e95ba501893cbb8faeb4ea9a3af295498d35097126228659c2af8
    Source: https://huggingface.co/google/siglip-base-patch16-224/resolve/7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed/model.safetensors
    The publisher has not issued a checkpoint-specific license statement.
    These weights are bundled under LicenseRef-AutoVisionStudio, a
    repository-local license reference recorded under the risk acceptance of
    the AutoVision Studio repository owner (dahatake, 2026-09-22). This
    reference does not assert any grant by the publisher.
    The manifest fields productUsePermitted, redistributionPermitted and
    productDerivativesPermitted are set from that owner decision, not from
    a publisher confirmation (FR-LIC-016).
    Unconfirmed at the time of the decision: the checkpoint-specific license,
    the terms of the WebLI training data and the rights of its images and
    texts, whether ImageNet or COCO data were used, and whether these weights
    are equivalent to the original Big Vision release.
    Under the AutoVision Studio model use condition (requirement definition
    v0.7), these weights are bundled for non-commercial research and
    educational purposes only. In this manifest, productUsePermitted and
    productDerivativesPermitted denote permission for that use condition,
    not for commercial use (TBD-09).

[C8] Training data
    WebLI (English image-text pairs), as stated in the model card. The WebLI
    terms are not public. The training data is not redistributed with
    AutoVision Studio.
```

| 項目 | 内容 |
|---|---|
| アプリ内ライセンス画面への表示文字列 | 上記 NOTICE 全文（表示の実装は C6 と同じく未実装。§14） |
| NOTICE ファイルの伝播要否 | transformers v5.17.0 の repository root に NOTICE file は無い（2026-09-25 に `https://raw.githubusercontent.com/huggingface/transformers/v5.17.0/NOTICE` が HTTP 404）。本 NOTICE を installer payload とアプリ内表示の双方へ同一文面で伝播する |
| Apache-2.0 の特許条項確認 | C5 の transformers は Apache-2.0（§7 の LICENSE 保存 copy）。checkpoint 層には適用しない（FR-LIC-005） |

## 6. 安全形式・リモートコード

| 項目 | 値 |
|---|---|
| 形式 | **safetensors** |
| remote code | **不要**。`from_pretrained(local_files_only=True, use_safetensors=True)` で transformers 本体の実装を使う |

## 7. 一次資料・証拠ハッシュ

| 資料 | URL | 保存コピー | SHA-256 |
|---|---|---|---|
| model card（revision 固定） | `https://huggingface.co/google/siglip-base-patch16-224/resolve/7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed/README.md` | `docs/model-governance/evidence/siglip-base-patch16-224-model-card-7fd15f06-20260923.md` | `86c231c4a7bf0ee2435295413ad5c7cf567c9426f00b79711ce8eda884b7a8d3` |
| HF API metadata（LFS SHA-256） | `https://huggingface.co/api/models/google/siglip-base-patch16-224?blobs=true` | `docs/model-governance/evidence/siglip-base-patch16-224-hf-api-20260923.json` | `f99762444fd3000cc7e8a9c69c005cced3c89373436d34bb05fb948c349e1cc3` |
| 権利判断の根拠書面（2026-09-22） | `https://github.com/dahatake/AutoVision-Studio/blob/main/docs/model-governance/evidence/2026-09-22-owner-risk-acceptance.md` | `docs/model-governance/evidence/2026-09-22-owner-risk-acceptance.md` | `baa0b97f48d3fa996cec57a6024f23f0147e04dee99f7ed01c616e723316c402` |
| C5 code license（transformers v5.17.0、2026-09-25 取得） | `https://raw.githubusercontent.com/huggingface/transformers/v5.17.0/LICENSE` | `docs/model-governance/evidence/transformers-v5.17.0-LICENSE.txt` | `77fd4710def9ec3c0f6225800e0235f15a425abd4a8b03559127fcd782612049` |
| 所有者の承認の回答（2026-09-25） | `https://github.com/dahatake/AutoVision-Studio/blob/main/docs/model-governance/evidence/2026-09-25-owner-ruling-G2A-01-02-G2D-08.md` | `docs/model-governance/evidence/2026-09-25-owner-ruling-G2A-01-02-G2D-08.md` | `1262ebb21e2f142a8f348627fba66a5c08cf918de4a66bb6ccbd0ed4addd7a76` |
| 比較試験の削除の判断（2026-09-25） | `https://github.com/dahatake/AutoVision-Studio/blob/main/docs/model-governance/evidence/2026-09-25-owner-ruling-assist-trial-deferral.md` | `docs/model-governance/evidence/2026-09-25-owner-ruling-assist-trial-deferral.md` | `6655690e061d027a8048a60f5a7a044b6a8eabefadaf18ab099b6730df469849` |
| 比較試験の免除（2026-09-26） | `https://github.com/dahatake/AutoVision-Studio/blob/main/docs/model-governance/evidence/2026-09-26-owner-rulings.md` | `docs/model-governance/evidence/2026-09-26-owner-rulings.md` | `4922a03a7e8dc71b6fc74f299e7a936c1b650a1f64ab87ed44bc4b015455e42b` |

WebLI の dataset terms は公開されていない（[`classification-assist.md`](classification-assist.md) §4.1、CA-C8）。manifest の `trainingData[].termsUrl` には、WebLI を学習データとして記載する model card の URL（上表 1 行目）を置き、terms が非公開である旨を `redistributionConditions` に書く。

## 8. Intended Use / Out-of-Scope Use

| 項目 | 内容 |
|---|---|
| Intended use（原文、保存 copy） | "You can use the raw model for tasks like zero-shot image classification and image-text retrieval." |
| Out-of-scope use | **記載なし** |
| 製品用途（分類候補の提示）が intended use に含まれるか | **含まれる** |

## 9. 推論定義（NFR-ANN-004）— 実測値のみ記録

| 項目 | 値 |
|---|---|
| 入力 | RGB、processor 出力 `1x3x224x224`。label prompt は `padding="max_length"`、長さ 64 |
| score の意味 | label ごとに独立な `sigmoid(exp(logit_scale)·cos + logit_bias)`。**正解確率ではなく、label 間で合計 1 にならない**。理論範囲 `(0, 1)`、観測範囲 `0.0617`〜`0.9987` |
| 決定論的推論 | 反復推論が CPU・DirectML とも bit 一致（実測記録 §4） |
| seed | `torch.manual_seed(20260922)` |
| 前処理（画像） | `AutoProcessor.from_pretrained(vendor/models/_spike/siglip, local_files_only=True)`（[`siglip_assist_parity.py`](../../spikes/models/siglip_assist_parity.py) L358）が読む `preprocessor_config.json`（SHA-256 `d11ccb80f15d358a11bdb070e92e2d889005874b7db15823d5f10d9b2533b14a`、§1）の値: `SiglipImageProcessor`、RGB へ変換、resize `224x224`（`resample: 3` = PIL の BICUBIC）、rescale `0.00392156862745098`（1/255）、normalize mean `[0.5, 0.5, 0.5]` / std `[0.5, 0.5, 0.5]` |
| 入力画像の照合 | gold set の各画像を `image_sha256` と照合した（[`siglip-assist-result.md`](../../spikes/models/siglip-assist-result.md) §8.1） |

manifest の `inferenceConfig`（[`manifest.schema.json`](../../resources/models/manifest.schema.json)）に登録する値（採用の審査 G2A-01 で確定。2026-09-25）:

| field | 値 | 根拠 |
|---|---|---|
| `scoreMeaning` | 「label ごとに独立な sigmoid(exp(logit_scale)·cos + logit_bias)。正解確率ではなく、較正されておらず、label 間で合計 1 にならない」 | 実装（上表） |
| `scoreRange` | `{"minimum": 0, "maximum": 1}` | sigmoid の値域。float32 では両端に丸まり得るため閉区間で表す |
| `confidenceThreshold` | `0.9241492748260498` | gold set の実測から選んだ値（DQ-07。所有者の判断 [G2Q-03](evidence/2026-09-25-owner-ruling-G2Q-03.md) の方針 A、[`siglip-assist-result.md`](../../spikes/models/siglip-assist-result.md) §8.2）。境界は schema の `score >= threshold` |
| `thresholdPolicy` | 「G2Q-03 方針 A: 分類 gold set 上で coverage 0.5 以上の候補のうち、提案した item の一致率が最大のもの。記録する値は選んだ score と次に小さい候補の中点。label prompt は `This is a photo of {label}.`（`{label}` は label 名の `_` を空白に置き換えたもの）。証拠: `spikes/models/siglip-assist-result.md` §8」 | 同上 §8.1・§8.2 |
| `deterministicInference` | `true` | 実測（CPU・DirectML の反復推論 bit 一致） |
| `nonDeterministicOperations` | 省略 | 決定論的のため |
| `seeds` | `{"torch": 20260922}` | gold set の測定の seed（同 §8.1） |

製品の label prompt は、閾値を選んだ測定と同じ規則 `This is a photo of {label}.` とする。閾値はこの規則の score で選んだため、規則を変える場合は閾値を選び直す。

## 10. OS・Execution Provider 互換性

| 項目 | 測定値 | 許容基準 | 判定 |
|---|---|---|---|
| ONNX 変換（vision / text の 2 graph） | 成功（opset 17） | 成功必須 | **合格** |
| score 最大差（3 比較の最大） | `4.1127e-06` | ≤ `1.0e-04` | **合格** |
| top-1 一致 | 15/15（3 比較とも） | 全件 | **合格** |

## 11. 性能

| 指標（画像ごとの vision 経路） | 測定値（2 回） | 採用基準（C7 の推論性能は、所有者の判断 [G2D-01](evidence/2026-09-24-owner-ruling-G2D-01.md) により POC-03 の値と比べて記録し、合否に使わない） | 判定 |
|---|---|---|---|
| p95（CPU EP） | `544.887` / `831.491` ms | POC-03 の値 ≤ 100 ms（参考） | 記録のみ（POC-03 の値を上回る） |
| p95（DirectML EP） | `16.534` / `17.114` ms | POC-03 の値 ≤ 100 ms（参考） | 記録のみ（POC-03 の値以内） |
| throughput（CPU EP） | `3.29` / `2.19` FPS | POC-03 の値 ≥ 10 FPS（参考） | 記録のみ（POC-03 の値を下回る） |
| throughput（DirectML EP） | `66.19` / `65.89` FPS | POC-03 の値 ≥ 10 FPS（参考） | 記録のみ（POC-03 の値以上） |
| 精度（対象用途） | gold set 60 item（3 label）で、閾値 `0.9241492748260498` の coverage `32/60`、提案した item の一致率 `18/32` = `0.5625`。閾値を置かない top-1 の正解率は `0.35`（21/60）で、3 label の一様な当て推量（1/3）と同程度（[`siglip-assist-result.md`](../../spikes/models/siglip-assist-result.md) §8.2・§8.3） | 承認された gold set 計画に精度の下限は無い。§12 の比較試験は免除（未実施）で、有用性は検証されていない | 記録のみ |
| checkpoint サイズ | `812,672,320` byte | 数値基準なし | — |

## 12. 補助 / 手動比較試験（NFR-ANN-006）

**免除（所有者の判断。未実施）。** [所有者の判断（2026-09-25）](evidence/2026-09-25-owner-ruling-assist-trial-deferral.md)により Gate 2 のタスクから外し、[所有者の判断（2026-09-26）](evidence/2026-09-26-owner-rulings.md)により Version 1 の実施対象から削除して未実施のまま完了扱いとした。試験は行っておらず、最終 Ground Truth の品質を悪化させないことと annotation 所要時間の短縮は検証されていない（[`adoption-template.md`](adoption-template.md) §12 の例外）。`releaseStatus.assistQuality[]` には記録しない（manifest schema `2.0.1` 以降）。harness は [`assist-result.md`](../../spikes/models/assist-result.md)。

## 13. セキュリティ

2026-09-24 に GitHub Global Security Advisories を照会した。対象は spike venv の `$PY` が報告した `transformers==5.17.0`、`tokenizers==0.23.2`、`safetensors==0.8.0`、`huggingface-hub==1.31.0`、`sentencepiece==0.2.2`、`torch==2.11.0`、`onnx==1.22.0`、`onnxruntime-directml==1.24.4`、`numpy==2.5.2`、`pillow==12.3.0`。照会 command は exit 0、`vendor\models\_spike\advisories-C.txt` の SHA-256 は `54641414d6ca279087f58a4669b57848f03a6fd4c295a94068dc0abffb45ca03`。High / Critical advisory: 0 件。invalid advisory: 0 件。Low は `torch==2.11.0` の `GHSA-rrmf-rvhw-rf47`（reviewed / valid）のみ。

evidence: 54641414d6ca279087f58a4669b57848f03a6fd4c295a94068dc0abffb45ca03 exit=0

## 14. リリースマニフェスト対応付け

| 項目 | 値 |
|---|---|
| manifest 内の識別子 | `siglip-base-patch16-224` |
| SBOM への記録状況 | **未記録**（SBOM の生成と照合は PKG phase。[owner ruling G2D-12](evidence/2026-09-24-owner-ruling-G2D-12.md)） |
| `THIRD_PARTY_NOTICES` への追記 | **未追記**（ファイル自体が未作成。§5 の文面を正とする） |
| build machine 上の検証元パス | `vendor/models/_spike/siglip/model.safetensors` |
| installer payload 内のパス | `resources/models/siglip-base-patch16-224/model.safetensors`（packaging 時の配置先。現時点では未作成で、PKG-01 が検証元から同一 hash / size で配置・検証する） |
| 署名・hash 検証の対象 | **はい**（PKG-01 が `sourcePath` の SHA-256 と byteSize を検証する） |
| lock ファイルへの関連付け | 関連なし（transformers は製品 lock に未採用。依存の採用判断は AST phase。§2〜4） |
| アプリ内ライセンス画面 | **未実装**（C6 の entry と同じ。§5 の文面を正とする） |

## 15. 判定

| 項目 | 内容 |
|---|---|
| 最終判定 | **承認** |
| 却下・保留の理由 | なし（§12 の比較試験は[所有者の判断（2026-09-26）](evidence/2026-09-26-owner-rulings.md)により免除（未実施）） |
| 権利層の状態 | **充足（risk acceptance、2026-09-22、決定者 dahatake）**。publisher の checkpoint license statement は存在しない。未確認項目は §5 の NOTICE で開示する（FR-LIC-016(1)〜(4)） |
| 技術層の状態 | hash（§1）、安全形式（§6）、CPU / DirectML の parity（§10、gold set の score 最大差 `6.0201e-06`）、tokenizer 監査（G2T-50C、§2〜4）、advisory 照会（G2T-60C、§13）が合格。性能（§11）は所有者の判断 G2D-01 により記録のみ。`inferenceConfig`（§9）は G2Q-03C の測定から確定した |
| 承認者氏名 | dahatake |
| 承認者の役割 | repository owner / license decision authority |
| 承認日 | 2026-09-25 |
| 承認対象 artifact | `model.safetensors` SHA-256 `2c63cb7d1f2e95ba501893cbb8faeb4ea9a3af295498d35097126228659c2af8` |
| 承認対象 revision | `7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed` |
| 承認の経緯 | 2026-09-25 07 時台に所有者が G2A-01 / 02 に「承認します」と回答した（[owner ruling G2A-01 / G2A-02 / G2D-08](evidence/2026-09-25-owner-ruling-G2A-01-02-G2D-08.md)）。その時点では §12 の比較試験が未実施のため保留とした。続く回答で所有者が比較試験を Gate 2 のタスクから外したため（[所有者の判断（2026-09-25）](evidence/2026-09-25-owner-ruling-assist-trial-deferral.md)）、§5・§9・§14・§17 を確認したうえで、その承認の回答を本記録の承認として記録した |
| 既知の限界 | §11 のとおり、gold set の top-1 の正解率は当て推量と同程度である。§12 の比較試験は免除され、補助の有用性は検証されていない |
| 再審査期限 | 設定なし。配布主体の変更、transformers の版変更、checkpoint bytes の変更時に再審査する |
| 法務確認の要否・状況 | **未実施**。FR-LIC-016 の risk acceptance で代替した（外部法務の書面判断は存在しない） |
| manifest 登録 | 登録する |

## 16. 2026-09-23 追補 — C7C-02（CPU 経路の最小改善）の結果

| 項目 | 内容 |
|---|---|
| 試行 | ONNX Runtime の動的量子化（`quantize_dynamic`、既定設定）を vision ONNX に 1 案だけ適用する（[`work/20260923-1437-C7-RemainingTasksExecutionPlan.md`](../../work/20260923-1437-C7-RemainingTasksExecutionPlan.md) §6 C7C-02） |
| 結果 | 1 回目は実行環境（agent の OS sandbox）で量子化が失敗した。sandbox 外のターミナルで再実行し、int8 vision（SHA-256 `2664434a…c9b1`）を測定した（[実測記録](../../spikes/models/siglip-assist-result.md) §7）。parity は torch ↔ ORT CPU int8 の score 最大差 **`9.0403e-02`**（許容差 `1.0e-04`）、top-1 一致 **12/15** で**不合格**。CPU 性能は p95 **`215.785` ms**、**`8.33` FPS** で**不合格** |
| 他の C7 分類候補 | TinyCLIP は intended / out-of-scope を一次資料で確認できず**除外 / HOLD 維持**（[`classification-assist.md`](classification-assist.md) §22）。SigLIP を置き換える承認候補はない |
| 判定（2026-09-23 時点。現在の判定は §15） | **保留を維持**。計画の最小改善 1 案は parity と性能の両方で不適合であり、当時（2026-09-23）の §15 の保留理由 (1)〜(4)（git 履歴の本記録）はいずれも解消していない。manifest に登録しない。この判定は 2026-09-25 の所有者の判断により現在の §15 の承認で置き換えた |

## 17. 記入完了チェックリスト（[`adoption-template.md`](adoption-template.md) §16）

本記録の §16 は 2026-09-23 の追補で使用済みのため、template §16 のチェックリストを本節に置く。

### 17.1 ライセンス審査

- [x] 1. コード層ライセンス（`Apache-2.0`、transformers v5.17.0）を確認した（§2〜4、§7 の LICENSE 保存 copy）
- [x] 2. checkpoint ライセンス識別子（`LicenseRef-AutoVisionStudio`）と根拠（2026-09-22 risk acceptance）を記入した（§2〜4）
- [x] 3. 非商用の研究・教育目的での利用・再配布は、publisher の明示ではなく risk acceptance により充足扱いとした（FR-LIC-016。§5 で開示）
- [x] 4. copyleft と製品のモデル利用条件より狭い用途制限の記載が一次資料（model card）に無いことを確認した。checkpoint 固有 license は存在せず、risk acceptance で代替した
- [x] 5. コードライセンス（Apache-2.0）と model card の `license: apache-2.0` タグを根拠に checkpoint を承認していない（FR-LIC-005）

### 17.2 学習データ由来

- [x] 6. model card が記載する学習データ WebLI (English image-text pairs) を記入した。完全な inventory と terms は非公開であり、FR-LIC-016(1) の未確認項目として §5 で開示した
- [x] 7. ImageNet 由来の有無は一次資料から断定できない（[`classification-assist.md`](classification-assist.md) §4.2）。未確認項目として §5 で開示した
- [x] 8. COCO 由来の有無は一次資料から断定できない（同上）。未確認項目として §5 で開示した
- [x] 9. 法務の書面承認は存在せず、repository owner の書面決定（2026-09-22 risk acceptance）で代替した事実を記入した

### 17.3 証拠記録

- [x] 10. checkpoint の SHA-256 を独立計算して記入した（§1）
- [x] 11. 正確なファイルサイズ（`812,672,320` byte）を記入した（§1）
- [x] 12. 取得日を記入した（§1）
- [x] 13. 一次資料の URL・保存 copy・SHA-256 を記入した（§7。WebLI の dataset terms は非公開であり保存できない）

### 17.4 安全形式・リモートコード

- [x] 14. `safetensors` 形式であることを確認した（§6）
- [x] 15. pickle 全体モデルを含まない（safetensors header の解析。[`classification-assist.md`](classification-assist.md) §18.3）
- [x] 16. リモートコード実行が不要であることを確認した（§6）

### 17.5 Intended Use / Model Card

- [x] 17. intended use を model card から転記した（§8）
- [x] 18. out-of-scope use は model card に記載が無いことを記録した（§8）
- [x] 19. 本製品用途（分類候補の提示）が intended use に含まれることを確認した（§8）
- [x] 20. "deployed use" が out-of-scope に記載されていないことを確認した（§8）

### 17.6 NOTICE・帰属表示

- [x] 21. `THIRD_PARTY_NOTICES` への追記内容を記入した（§5）
- [x] 22. Apache-2.0 の NOTICE ファイルの伝播要否を確認した（§5。transformers v5.17.0 に NOTICE file は無い）

### 17.7 技術性能

- [x] 23. ONNX 変換成功と parity（score 最大差、top-1 一致）を確認した（§10、[`siglip-assist-result.md`](../../spikes/models/siglip-assist-result.md) §4・§8.2）
- [x] 24. Windows DirectML / CPU の動作を確認した（§10）。macOS CoreML / CPU は `N/A（A-07）`
- [x] 25. deterministic inference の条件（gold set の image SHA-256、checkpoint hash、prompt 規則、preprocess の値、threshold、seed）を確認した（§1・§9、[`siglip-assist-result.md`](../../spikes/models/siglip-assist-result.md) §8.1）
- [x] 26. 推論 p95 レイテンシ・スループットの測定値を記録した（§11。所有者の判断 G2D-01 により合否に使わない）

### 17.8 品質比較試験

- [ ] 27. 免除（未実施）。[所有者の判断（2026-09-26）](evidence/2026-09-26-owner-rulings.md)（adoption-template §12 の例外）
- [ ] 28. 免除（未実施）。同上
- [ ] 29. 免除（未実施）。同上

### 17.9 セキュリティ

- [x] 30. Critical / High の advisory が 0 件であることを確認した（§13、G2T-60C）

### 17.10 リリースマニフェスト

- [x] 31. manifest 内の識別子を記入した（§14）
- [x] 32. SBOM への登録予定を確定した（§14。生成と照合は PKG phase）
- [x] 33. `THIRD_PARTY_NOTICES` へ追記する文面を §5 で確定した（生成と照合は PKG phase）

### 17.11 最終承認

- [x] 34. チェック 1〜33 を完了した。項目 27〜29 は adoption-template §12 の例外により「免除（未実施）」と記録した
- [x] 35. 承認者（dahatake）が 2026-09-25 に承認を回答し（[owner ruling G2A-01 / G2A-02 / G2D-08](evidence/2026-09-25-owner-ruling-G2A-01-02-G2D-08.md)）、承認日を §15 に記入した。回答は G2A-01 の承認であり、本記録の本文を個別に確認したとの記述は回答に無い
- [x] 36. §15 の判定欄に「承認」を明記した
