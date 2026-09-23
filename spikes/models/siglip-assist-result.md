# G2R-22 — C7 分類 Assist Model（SigLIP）の backend parity と推論性能

| 項目 | 値 |
|---|---|
| タスク | Gate 2 残タスク `G2R-22`（C7 分類 Annotation Assist Model の技術 gate） |
| 実行日 | 2026-09-23 |
| 実行 host | Windows `10.0.29671` / `AMD64` / CPython `3.14.7`、NVIDIA GeForce RTX 4060 Laptop GPU |
| 対象 script | [`siglip_assist_parity.py`](siglip_assist_parity.py) |
| 実行環境 | **隔離 spike venv** `vendor/models/_spike/venv`（Git 追跡外）: torch `2.11.0+cpu`、transformers `5.17.0`、onnx `1.22.0`、onnxruntime-directml `1.24.4`。製品 lock は変更していない |
| parity 判定 | fp32（3 比較）: **PASS**（反復実行も bit 一致）。C7C-02 の int8 候補（torch ↔ ORT CPU int8）: **FAIL**（§7.2。この比較を含む parity mode は exit code `1`） |
| 性能判定 | DirectML は採用基準を満たす。**CPU は fp32・int8 とも満たさない**（§5、§7.3）→ 採用記録の判定は**保留** |

---

## 1. 本結果が主張しないこと

1. **承認ではない。** CPU 性能が採用基準に不適合であり、NFR-ANN-006 の比較試験も未実施である。
2. **精度・品質の主張ではない。** fixture は beans（MIT）で、prompt はそのクラス名を記述しただけである。§4 の「fixture label との top-1 一致」は情報として記録するだけで、品質基準に使わない。
3. **POC-03 の完全条件は測っていない。**

## 2. 対象

| 項目 | 値 |
|---|---|
| model | Hugging Face `google/siglip-base-patch16-224`、revision `7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed` |
| `model.safetensors` | `812,672,320` byte、SHA-256 `2c63cb7d1f2e95ba501893cbb8faeb4ea9a3af295498d35097126228659c2af8`（2026-09-22 取得の `vendor/models/siglip-base-patch16-224.safetensors` を再 hash。HF API の LFS metadata と一致） |
| 付属 file（同 revision、2026-09-23 取得） | `config.json` `cd85b3d2…a9688`、`preprocessor_config.json` `d11ccb80…4b14a`、`special_tokens_map.json` `2b6a1ff6…a9088`、`spiece.model` `1e5036be…af8ec`（LFS metadata と一致）、`tokenizer.json` `c6e405cb…fe920`、`tokenizer_config.json` `d6423dae…8bcb`（完全値は採用記録 §1） |
| 読み込み | `SiglipModel.from_pretrained(local_files_only=True, use_safetensors=True)`。remote code なし |
| 分割 | 製品の実行形に合わせ、**vision tower**（画像ごと）と **text tower**（label prompt 集合ごとに 1 回）を別 ONNX に export。score は `sigmoid(exp(logit_scale) · cos + logit_bias)`（`exp(logit_scale)=117.3308`、`logit_bias=-12.9324`） |
| export | `torch.onnx.export(dynamo=False)`、opset 17、固定 shape（vision `1x3x224x224`、text `3x64`）。vision ONNX `371,679,721` byte / SHA-256 `31e7556a3388908136102996fb0dda2913313f83fdc31940168030d25d04e8e1`、text ONNX `441,214,949` byte / `ccced93223a5aac87e0548bd9064cf4f76dc7ac6ee24944e6bd40e0478f3b691` |
| 入力 | beans eval split 15 枚、prompt 3 件（`a photo of a bean leaf with angular leaf spot.` / `... with bean rust.` / `a photo of a healthy bean leaf.`） |

## 3. 実行方法

```powershell
cd spikes\models
..\..\vendor\models\_spike\venv\Scripts\python.exe siglip_assist_parity.py --mode parity --artifact-dir ..\..\vendor\models\_spike\onnx
..\..\vendor\models\_spike\venv\Scripts\python.exe siglip_assist_parity.py --mode performance --artifact-dir ..\..\vendor\models\_spike\onnx
```

## 4. Parity（許容差は実行前に固定: score `1.0e-04`、top-1 全件一致）

| 比較 | score 最大差 | top-1 一致 | 判定 |
|---|---:|---:|---|
| 分割 tower ↔ `SiglipModel.forward` の `logits_per_image`（torch） | `1.0729e-06` | — | **PASS** |
| torch ↔ onnxruntime-cpu | `2.3246e-06` | 15/15 | **PASS** |
| torch ↔ onnxruntime-directml | `2.9802e-06` | 15/15 | **PASS** |
| onnxruntime-cpu ↔ onnxruntime-directml | `4.1127e-06` | 15/15 | **PASS** |

- 反復推論: CPU・DirectML とも vision 埋め込みが **bit 一致**。
- 観測 score 範囲（torch、45 値）: `0.0617`〜`0.9987`。理論範囲は sigmoid の開区間 `(0, 1)`。
- 情報のみ: torch score の top-1 と fixture label の一致 **10/15**。品質基準ではない。

## 5. 推論性能

`detection_checkpoint_parity.measure_latency` を再利用（warm-up 5 巡、20 巡、nearest-rank、既定 session option）。vision は 15 枚 × 20 = 300 サンプル、text は 1 入力 × 20 = 20 サンプル。

| 経路 | EP | 実行 | median | p95 | max | throughput | 累積 peak working set |
|---|---|---|---:|---:|---:|---:|---:|
| vision（画像ごと） | CPU | 1 | `277.376` ms | **`544.887` ms** | `888.136` ms | **`3.29` FPS** | `2,616.2` MB |
| vision（画像ごと） | CPU | 2 | `402.242` ms | **`831.491` ms** | `1,776.895` ms | **`2.19` FPS** | `2,617.0` MB |
| vision（画像ごと） | DirectML | 1 | `15.032` ms | **`16.534` ms** | `19.146` ms | **`66.19` FPS** | `2,616.2` MB |
| vision（画像ごと） | DirectML | 2 | `14.720` ms | **`17.114` ms** | `101.103` ms | **`65.89` FPS** | `2,617.0` MB |
| text（label 集合ごとに 1 回） | CPU | 1 / 2 | `220.4` / `281.0` ms | `398.9` / `449.9` ms | — | — | 同上 |
| text（label 集合ごとに 1 回） | DirectML | 1 / 2 | `11.7` / `12.8` ms | `12.3` / `13.4` ms | — | — | 同上 |

| 採用基準（[`adoption-template.md`](../../docs/model-governance/adoption-template.md) §11、画像ごとの vision 経路で判定） | CPU | DirectML |
|---|---|---|
| p95 ≤ `100` ms | `545`〜`831` ms → **不合格** | `16.5`〜`17.1` ms → **合格** |
| ≥ `10` FPS | `2.19`〜`3.29` → **不合格** | `65.9`〜`66.2` → **合格** |

- 累積 peak working set は process 全体の値で、eager model（fp32 約 813MB）と 2 つの ONNX session を含む。
- CPU 側の run 間変動は大きいが、いずれの run も基準の 5 倍以上である。session option の調整や量子化は実施していない。

## 6. 帰結

manifest の `support[]` は `windows-x64/cpu` と `windows-x64/directml` の**両方**を `verified: true` で要求し、採用記録の性能基準は EP ごとに判定する（[`ssdlite320-mobilenet-v3-large-coco-v1-adoption.md`](../../docs/model-governance/ssdlite320-mobilenet-v3-large-coco-v1-adoption.md) §11 と同じ扱い）。CPU が不適合であるため、実行計画 DQ-08 に従い **manifest に登録しない**。採用記録 [`siglip-base-patch16-224-adoption.md`](../../docs/model-governance/siglip-base-patch16-224-adoption.md) は **保留**とする。

## 7. C7C-02 — CPU 経路の最小改善（2026-09-23）

[`20260923-1437-C7-RemainingTasksExecutionPlan.md`](../../work/20260923-1437-C7-RemainingTasksExecutionPlan.md) §6 C7C-02 の既定案（ONNX Runtime の量子化を 1 案だけ試す）を実行した。

### 7.1 試した 1 案

本 script が export した fp32 `siglip-vision.onnx` に `onnxruntime.quantization.quantize_dynamic(input, output)`（既定設定、int8 weight）を適用した `siglip-vision-int8.onnx`（`93,574,317` byte、SHA-256 `2664434a0a79c4dc473bcef0f6c591c550e7f91fd20178a1669d98f899d1c9b1`）を、fp32 と同じ score 許容差（`1.0e-04`）・top-1 全件一致で parity を、CPU EP で性能を測った。text tower は fp32 のまま。許容差と性能基準は実行前から変えていない。

1 回目の試行は、実行環境（agent の OS sandbox）で `quantize_dynamic` 内部の external data 保存（`onnx.save_model` → `save_external_data`）が `external data path could not be canonicalized: Access is denied.` で失敗し、測定できなかった。実行環境を sandbox の外のターミナルへ変えた後、同じ 1 案を再実行した（以下はその結果）。

### 7.2 Parity（`--mode parity`、exit code `1`）

| 比較 | score 最大差 | top-1 一致 | 判定 |
|---|---:|---:|---|
| torch ↔ onnxruntime-cpu（fp32） | `2.3246e-06` | 15/15 | PASS |
| torch ↔ onnxruntime-directml（fp32） | `2.9802e-06` | 15/15 | PASS |
| onnxruntime-cpu ↔ onnxruntime-directml（fp32） | `4.1127e-06` | 15/15 | PASS |
| torch ↔ onnxruntime-cpu-**int8** | **`9.0403e-02`** | **12/15** | **FAIL** |

- fp32 の 3 比較と、fp32 ONNX の SHA-256（`31e7556a…e8e1` / `ccced932…b691`）は §2・§4 の記録値と一致する。
- int8 は score 許容差を約 900 倍上回り、15 枚中 3 枚で top-1 が変わる。反復推論は int8 も bit 一致（決定論的だが不一致）。

### 7.3 性能（`--mode performance`、同一 process の 1 回）

| 経路 | EP | median | p95 | max | throughput |
|---|---|---:|---:|---:|---:|
| vision fp32 | CPU | `141.950` ms | `302.390` ms | `580.036` ms | `5.88` FPS |
| vision fp32 | DirectML | `17.372` ms | `18.178` ms | `19.212` ms | `57.55` FPS |
| vision **int8** | CPU | `100.894` ms | **`215.785` ms** | `697.014` ms | **`8.33` FPS** |

- 累積 peak working set は `2,760.8` MB（process 全体）。
- 本 run の fp32 CPU（p95 `302` ms）は §5 の 2 回（`545`〜`831` ms）より速い。run 間変動は大きいが、いずれも基準外である。

### 7.4 判定

| 採用基準（CPU、画像ごとの vision 経路） | int8 の実測 | 判定 |
|---|---|---|
| parity（score ≤ `1.0e-04`、top-1 全件一致） | `9.04e-02`、12/15 | **不合格** |
| p95 ≤ `100` ms | `215.8` ms | **不合格** |
| ≥ `10` FPS | `8.33` FPS | **不合格** |

**HOLD 維持。** 最小改善の 1 案は parity と性能の両方で不適合であり、計画 §8 の 4 に従い追加の最適化は試さない。量子化経路は本 script に残し、同じ手順で再測定できるようにした。