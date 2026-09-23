# モデル採用審査記録 — SigLIP base patch16 224（C7 分類）

> 本記録は [`adoption-template.md`](adoption-template.md) に従う **C7 分類の採用記録**である。最終判定は **保留**であり、manifest に登録しない。
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
| C8 training data | WebLI。**terms は非公開**（[`classification-assist.md`](classification-assist.md) §4.1）。risk acceptance で充足扱い |

## 5. NOTICE

**未作成**（保留のため）。登録時は [`mobilenet-v3-large-imagenet1k-v2-adoption.md`](mobilenet-v3-large-imagenet1k-v2-adoption.md) §5 と同じ FR-LIC-016 の開示文（publisher grant でない旨、未確認項目）を含める。

## 6. 安全形式・リモートコード

| 項目 | 値 |
|---|---|
| 形式 | **safetensors** |
| remote code | **不要**。`from_pretrained(local_files_only=True, use_safetensors=True)` で transformers 本体の実装を使う |

## 7. 一次資料・証拠ハッシュ（2026-09-23 取得分）

| 資料 | URL | 保存コピー | SHA-256 |
|---|---|---|---|
| model card（revision 固定） | `https://huggingface.co/google/siglip-base-patch16-224/resolve/7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed/README.md` | `docs/model-governance/evidence/siglip-base-patch16-224-model-card-7fd15f06-20260923.md` | `86c231c4a7bf0ee2435295413ad5c7cf567c9426f00b79711ce8eda884b7a8d3` |
| HF API metadata（LFS SHA-256） | `https://huggingface.co/api/models/google/siglip-base-patch16-224?blobs=true` | `docs/model-governance/evidence/siglip-base-patch16-224-hf-api-20260923.json` | `f99762444fd3000cc7e8a9c69c005cced3c89373436d34bb05fb948c349e1cc3` |
| 権利判断の根拠書面 | — | `docs/model-governance/evidence/2026-09-22-owner-risk-acceptance.md` | `baa0b97f48d3fa996cec57a6024f23f0147e04dee99f7ed01c616e723316c402` |

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
| `confidenceThreshold` | **未決定**（DQ-07: gold set の実測から決める。gold set 未実施） |
| 決定論的推論 | 反復推論が CPU・DirectML とも bit 一致（実測記録 §4） |
| seed | `torch.manual_seed(20260922)` |

## 10. OS・Execution Provider 互換性

| 項目 | 測定値 | 許容基準 | 判定 |
|---|---|---|---|
| ONNX 変換（vision / text の 2 graph） | 成功（opset 17） | 成功必須 | **合格** |
| score 最大差（3 比較の最大） | `4.1127e-06` | ≤ `1.0e-04` | **合格** |
| top-1 一致 | 15/15（3 比較とも） | 全件 | **合格** |

## 11. 性能

| 指標（画像ごとの vision 経路） | 測定値（2 回） | 採用基準 | 判定 |
|---|---|---|---|
| p95（CPU EP） | `544.887` / `831.491` ms | ≤ 100 ms | **不合格** |
| p95（DirectML EP） | `16.534` / `17.114` ms | ≤ 100 ms | **合格** |
| throughput（CPU EP） | `3.29` / `2.19` FPS | ≥ 10 FPS | **不合格** |
| throughput（DirectML EP） | `66.19` / `65.89` FPS | ≥ 10 FPS | **合格** |
| 精度（対象用途） | **未測定**（gold set 未実施） | — | **未測定** |
| checkpoint サイズ | `812,672,320` byte | 数値基準なし | — |

## 12. 補助 / 手動比較試験（NFR-ANN-006）

**未実施。** 利用者の実作業 session が必要である（[`assist-result.md`](../../spikes/models/assist-result.md)、実行計画 G2R-41 / G2R-42）。

## 13. セキュリティ

GitHub Advisory Database（2026-09-23 照会）で `transformers==5.17.0`、`safetensors==0.8.0`、`tokenizers==0.23.2`、`huggingface-hub==1.31.0`、`sentencepiece==0.2.2` の該当 advisory は **0 件**。`torch==2.11.0` は Low 1 件（`GHSA-rrmf-rvhw-rf47`）のみ。

## 14. リリースマニフェスト対応付け

**未登録**（§15 が保留のため）。

## 15. 判定

| 項目 | 内容 |
|---|---|
| 最終判定 | **保留** |
| 保留の理由 | (1) §11 の CPU EP の p95 / throughput が採用基準に不適合。manifest の `support[]` は CPU と DirectML の両方を要求する。(2) §12 の比較試験が未実施。(3) `confidenceThreshold` が未決定。(4) transformers の依存採用判断が未実施 |
| 権利層 | 充足（risk acceptance、2026-09-22、決定者 dahatake）。本保留は権利判断を取り消さない |
| 再審査の条件 | CPU 経路で採用基準を満たす実測（量子化等は別途の技術作業）と、§12 の比較試験 |

## 16. 2026-09-23 追補 — C7C-02（CPU 経路の最小改善）の結果

| 項目 | 内容 |
|---|---|
| 試行 | ONNX Runtime の動的量子化（`quantize_dynamic`、既定設定）を vision ONNX に 1 案だけ適用する（[`work/20260923-1437-C7-RemainingTasksExecutionPlan.md`](../../work/20260923-1437-C7-RemainingTasksExecutionPlan.md) §6 C7C-02） |
| 結果 | 1 回目は実行環境（agent の OS sandbox）で量子化が失敗した。sandbox 外のターミナルで再実行し、int8 vision（SHA-256 `2664434a…c9b1`）を測定した（[実測記録](../../spikes/models/siglip-assist-result.md) §7）。parity は torch ↔ ORT CPU int8 の score 最大差 **`9.0403e-02`**（許容差 `1.0e-04`）、top-1 一致 **12/15** で**不合格**。CPU 性能は p95 **`215.785` ms**、**`8.33` FPS** で**不合格** |
| 他の C7 分類候補 | TinyCLIP は intended / out-of-scope を一次資料で確認できず**除外 / HOLD 維持**（[`classification-assist.md`](classification-assist.md) §22）。SigLIP を置き換える承認候補はない |
| 判定 | **保留を維持**。計画の最小改善 1 案は parity と性能の両方で不適合であり、§15 の保留理由 (1)〜(4) はいずれも解消していない。manifest に登録しない |
