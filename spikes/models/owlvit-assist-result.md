# C7D-02 — C7 検出 Assist Model（OWL-ViT base patch32）の backend parity と推論性能

| 項目 | 値 |
|---|---|
| タスク | [`20260923-1437-C7-RemainingTasksExecutionPlan.md`](../../work/20260923-1437-C7-RemainingTasksExecutionPlan.md) §6 `C7D-02`（C7 検出 Annotation Assist Model の技術 gate） |
| 実行日 | 2026-09-23 |
| 実行 host | Windows `10.0.29671` / `AMD64` / CPython `3.14.7`、NVIDIA GeForce RTX 4060 Laptop GPU |
| 対象 script | [`owlvit_assist_parity.py`](owlvit_assist_parity.py) |
| 実行環境 | **隔離 spike venv** `vendor/models/_spike/venv`（Git 追跡外）: torch `2.11.0+cpu`、transformers `5.17.0`、onnx `1.22.0`、onnxruntime-directml `1.24.4`。製品 lock は変更していない |
| parity 判定 | **PASS**（3 比較すべて、exit code `0`。ただし score floor を超える検出は 0 件で、検出単位の比較は空。§4） |
| 性能判定 | DirectML は採用基準を満たす。**CPU は満たさない**（§5。performance mode は `verdict: FAIL`、exit code `1`）→ 採用記録の判定は**保留** |

---

## 1. 本結果が主張しないこと

1. **承認ではない。** CPU 性能が採用基準に不適合であり、NFR-ANN-006 / POC-16 の比較試験も未実施である。
2. **精度・品質の主張ではない。** prompt と gwhd-2021 fixture は backend 比較にのみ使う。本 fixture では最大 score が `0.0272` で、検出能力について何も示さない。
3. **POC-03 の完全条件は測っていない。**

## 2. 対象

| 項目 | 値 |
|---|---|
| model | Hugging Face `google/owlvit-base-patch32`、revision `cbc355fb364588351c5d51c7f74465e8e7ec6f72` |
| `model.safetensors` | `612,983,940` byte、SHA-256 `4dbe0399f0b7d7c8dddf1535a98769cc30743bebc877aea681998c8d984ce52b`（script が起動時に照合。payload 一覧は [`20260923-1520-OWLViT-ControlledArtifact.md`](../../work/20260923-1520-OWLViT-ControlledArtifact.md)） |
| 読み込み | `OwlViTForObjectDetection.from_pretrained(local_files_only=True, use_safetensors=True)`。processor は `OwlViTProcessor` / `OwlViTImageProcessor`（transformers 本体）。remote code を実行していない |
| 入力 | gwhd-2021 末尾 5 枚（原寸 `1024x1024`）、processor 出力 `pixel_values 1x3x768x768`。text query 2 件（`a photo of a wheat head` / `a photo of a leaf`）、`input_ids` / `attention_mask` `2x16` |
| export | 検出器全体（text tower と vision tower）を 1 graph として `torch.onnx.export(dynamo=False)`、opset 17、固定 shape。ONNX `611,685,772` byte、SHA-256 `7ba9784cd8c349807882053de3af81aa3c77739310b06b8b8c3f23fc0727ee59`（parity 実行と performance 実行で同一）。`onnx.checker` 通過 |
| 後処理 | score = query 方向の logit 最大値の sigmoid、label = その argmax、box = `cxcywh`（resize 後入力に対する相対値）を原寸の `xyxy` へ変換し、transformers と同じ **`score > 0.05`（strict）** で残す。transformers の `OwlViTImageProcessor.post_process_object_detection(threshold=0.05, target_sizes=原寸 (h, w))` と、torch 出力の 5 枚すべてで一致することを script 内で検査した（`post_process_matches_transformers: true`。ただし両者とも 0 件で、一致は空集合どうしの一致である）。OWL-ViT v1 の processor は padding せず `768x768` へ resize するため、原寸への scale は幅・高さ別の倍率になる。OWL-ViT v1 には top-k・NMS はない |

## 3. 実行方法

```powershell
cd spikes\models
..\..\vendor\models\_spike\venv\Scripts\python.exe owlvit_assist_parity.py --mode parity --artifact-dir ..\..\vendor\models\_spike\owlvit-onnx
..\..\vendor\models\_spike\venv\Scripts\python.exe owlvit_assist_parity.py --mode performance --artifact-dir ..\..\vendor\models\_spike\owlvit-onnx
```

## 4. Parity（許容差は実行前に計画 §6 C7D-02 で固定: 生出力 `rtol 1e-3` / `atol 1e-4`、検出は [`detection_checkpoint_parity.compare`](detection_checkpoint_parity.py)）

| 比較 | `logits` 最大差 | `pred_boxes` 最大差 | 生出力 rtol/atol | 検出（score `> 0.05`） | 判定 |
|---|---:|---:|---|---|---|
| torch ↔ onnxruntime-cpu | `1.5521e-03` | `1.4734e-04` | 範囲内 | 0 件 / 0 件 | **PASS** |
| torch ↔ onnxruntime-directml | `4.7970e-04` | `5.4598e-05` | 範囲内 | 0 件 / 0 件 | **PASS** |
| onnxruntime-cpu ↔ onnxruntime-directml | `1.6255e-03` | `9.2924e-05` | 範囲内 | 0 件 / 0 件 | **PASS** |

- 生出力の判定は `np.allclose(rtol=1e-3, atol=1e-4)`（`|a-b| ≤ atol + rtol·|b|`）。`logits` の絶対差が `1e-4` を超えるのは値の大きい logit で、相対許容差の範囲内である。
- **検出単位の比較は空である。** torch の score 最大値は 5 枚・全 patch で `0.0272` で、score floor `0.05` を超える検出がどの backend にもない。このため box・score・label の parity は、次の閾値前の全 patch 比較（5 枚 × 576 patch = 2,880）で測定した。この表は測定値の記録であり、判定基準は上記のまま変えていない。

| 比較（閾値前の全 patch） | score 最大差 | box 最大差（原寸 px） | label 一致 |
|---|---:|---:|---:|
| torch ↔ onnxruntime-cpu | `6.0955e-06` | `0.1239` | 2,880 / 2,880 |
| torch ↔ onnxruntime-directml | `4.0524e-07` | `0.0498` | 2,880 / 2,880 |
| onnxruntime-cpu ↔ onnxruntime-directml | `6.3838e-06` | `0.0766` | 2,880 / 2,880 |

- box の px 差は `compare` の box 許容差 `1.0e-03` を上回る。`compare` はこれを score floor を超える検出にだけ適用するため本 fixture では適用対象がなく、上表は判定に使っていない。**実運用の score 帯で `compare` の box 許容差を満たすかは未確認**である。
- 反復推論: CPU・DirectML とも同一 session の 2 回目の出力が **bit 一致**。
- session provider: CPU `["CPUExecutionProvider"]`、DirectML `["DmlExecutionProvider", "CPUExecutionProvider"]`（先頭が要求した EP であることを script が検査）。DirectML session の作成時に ONNX Runtime が `VerifyEachNodeIsAssignedToAnEp` の警告（"Some nodes were not assigned to the preferred execution providers …"）を出しており、**一部 node は CPU に割り当てられている**。どの node か、その負荷の割合は測っていない。DirectML の値は DirectML と CPU fallback を合わせた構成の実測である。
- 5 枚のうち export に使ったのは 1 枚目だけで、2〜5 枚目でも生出力が許容差内である（[`grounding-dino-assist-result.md`](grounding-dino-assist-result.md) §5 の trace 焼き込みの兆候はない）。

## 5. 推論性能

[`grounding_dino_assist_parity.measure`](grounding_dino_assist_parity.py) を再利用（warm-up 5 巡、20 巡、nearest-rank、既定 session option）。5 枚 × 20 = 100 サンプル。1 サンプルは検出器 graph 全体（text 2 query を含む）で、text を label 集合ごとに 1 回だけ計算する分割は行っていない（text tower は 16 token × 2 で、768×768 の vision tower に比べ小さい）。

| EP | 実行 | median | p95 | max | throughput | 累積 peak working set | p95 ≤ `100` ms かつ ≥ `10` FPS |
|---|---|---:|---:|---:|---:|---:|---|
| CPU | 1 | `662.037` ms | **`1,569.854` ms** | `2,267.828` ms | **`1.25` FPS** | `3,403.2` MB | **不合格** |
| CPU | 2 | `1,034.206` ms | **`1,514.585` ms** | `2,211.716` ms | **`0.92` FPS** | `3,398.1` MB | **不合格** |
| DirectML | 1 | `35.861` ms | **`42.338` ms** | `66.716` ms | **`27.25` FPS** | `3,403.2` MB | **合格** |
| DirectML | 2 | `44.935` ms | **`51.783` ms** | `62.929` ms | **`21.81` FPS** | `3,398.1` MB | **合格** |
| CPU | 3 | `628.779` ms | **`918.067` ms** | `1,277.547` ms | **`1.51` FPS** | `3,405.7` MB | **不合格** |
| DirectML | 3 | `54.527` ms | **`62.500` ms** | `72.980` ms | **`18.07` FPS** | `3,405.7` MB | **合格** |

- 実行 1 は判定を exit code に反映する修正の前、実行 2 は修正後（`verdict: FAIL`、`failures: ["CPUExecutionProvider p95 1514.585 ms / 0.92 FPS misses p95 <= 100.0 ms and >= 10.0 FPS"]`、exit code `1`）。実行 3 は、session の先頭 provider が要求した EP でなければ FAIL にする検査を performance mode に加えた後の実行（`failures` は CPU の基準未達 1 件だけ、exit code `1`）。graph は同一（ONNX SHA-256 `7ba9784c…ee59`）。
- 累積 peak working set は process 全体の値で、eager model（fp32 約 613MB）と 2 つの ONNX session を含む。
- CPU は基準に対し p95 で 9 倍以上、FPS で約 1/7 以下である。run 間の変動は大きいが、いずれの run も基準を大きく外れる。量子化・session option の調整は行っていない（C7D-02 の範囲外。SigLIP の量子化試行は実行環境で実行不能だった: [`siglip-assist-result.md`](siglip-assist-result.md) §7）。

## 6. 帰結

manifest の `support[]` は `windows-x64/cpu` と `windows-x64/directml` の**両方**を `verified: true` で要求し、採用記録の性能基準は EP ごとに判定する（[`siglip-assist-result.md`](siglip-assist-result.md) §6 と同じ扱い）。CPU が不適合であるため **manifest に登録しない**。採用記録 [`owlvit-base-patch32-adoption.md`](../../docs/model-governance/owlvit-base-patch32-adoption.md) は **保留**とする。
