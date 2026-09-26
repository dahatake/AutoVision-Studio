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


## 7. G2Q-03D — gold set からの `confidenceThreshold` の選択と検出単位 parity（2026-09-25）

所有者の判断 [`2026-09-25-owner-ruling-G2Q-03.md`](../../docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03.md)（方針 A）と、測定の前に固定した定義 [`20260925-0420-G2Q03-ExecutionPlan.md`](../../work/20260925-0420-G2Q03-ExecutionPlan.md) §1 に従い、`--mode goldset` で測った。ATG 実行 `84e8cb29-8aa9-40b6-bcab-411bfae30eff`（main4）の node G2Q-03D。

### 7.1 実行方法

```powershell
cmd /d /c "cd /d spikes\models && ..\..\vendor\models\_spike\venv\Scripts\python.exe owlvit_assist_parity.py --mode goldset --goldset ..\..\vendor\models\_spike\assist\goldset-detection.json --artifact-dir ..\..\vendor\models\_spike\owlvit-onnx --output ..\..\vendor\models\_spike\owlvit-goldset.json"
```

- 出力: `vendor/models/_spike/owlvit-goldset.json`（git 管理外）。exit code `1`（`verdict: FAIL`）。
- gold set: `vendor/models/_spike/assist/goldset-detection.json`（20 item、gold box 1,079 個、class `wheat_head` だけ。SHA-256 `338435c6af565378b83d6535106efe68cf6d050d040ff853108a15846628151d`）。画像ごとに gold set の `image_sha256` と照合した。
- ONNX: text query 1 件で export した `owlvit-base-patch32-goldset.onnx`（SHA-256 `5dae37956aa5cae6f55af59c263171c313802c6dd7f20173554b18e20d82a402`）。
- prompt: `a photo of a {label}`（`{label}` は class 名の `_` を空白に置き換えたもの）。text query は `a photo of a wheat head` の 1 件。
- 境界: `score >= 閾値`（schema）。transformers の `post_process_object_detection` は `score > 閾値` で、製品の後処理は `>=` で実装する。記録した閾値は候補の score の中点のため、この測定では両者の検出が一致した（script が torch の全 20 item で照合）。
- seed: `{"torch": 20260922}`。

### 7.2 閾値の選択

| 項目 | 値 |
|---|---|
| 候補（torch の全 patch の box の score、重複なし） | 11,499 個。coverage 0.5 以上は 11,490 個 |
| 選んだ候補の score | `0.0002534171799197793` |
| `confidenceThreshold`（次に小さい候補との中点） | **`0.0002533551160013303`** |
| coverage | `20/20` = `1.0` |
| 提案の box / gold box / 一致（IoU 0.5 以上、1 対 1） | 2,820 / 1,079 / 483 |
| F1（precision `0.1713`、recall `0.4476`） | **`0.2478`** |

選び方は `work/20260925-0420-check-selection.py` と同じ規則で、閾値の選択そのものは再計算と一致する（同 script の exit code は `1` で、原因は下の parity の `FAIL`）。

### 7.3 検出単位 parity（記録した閾値、許容差は実行前に固定）

| 比較 | 検出数（全 20 item） | 対応のない検出 | box 最大差（原寸 px、許容差 `1.0e-03`） | score 最大差（許容差 `1.0e-04`） | 生出力 rtol/atol | 判定 |
|---|---:|---:|---:|---:|---|---|
| torch ↔ onnxruntime-cpu | 2,820 / 2,820 | 0 | **`7.4707e-02`** | `1.4346e-06` | 範囲内 | **FAIL** |
| torch ↔ onnxruntime-directml | 2,820 / 2,820 | 0 | **`4.9835e-02`** | `2.3167e-07` | 範囲内 | **FAIL** |
| onnxruntime-cpu ↔ onnxruntime-directml | 2,820 / 2,820 | 0 | **`4.8096e-02`** | `1.5395e-06` | 範囲内 | **FAIL** |

- `verdict: FAIL`。3 つの比較とも、検出数・対応付け・label・score は一致し、box の差だけが [`detection_checkpoint_parity.compare`](detection_checkpoint_parity.py) の box 許容差 `1.0e-03`（[`detection.py`](detection.py) の `BOX_TOLERANCE`）を上回る。§4 で「実運用の score 帯で `compare` の box 許容差を満たすかは未確認」とした点が、検出 1 件以上の状態で不合格と確認された。
- 生出力（`pred_boxes` は入力に対する相対座標）は `rtol 1e-3` / `atol 1e-4` の範囲内で、box の差は原寸（全 20 item とも 1,024 × 1,024 px）への拡大で `atol` 相当の差が px 単位で表れたものである。許容差は測定の前に固定したもので、測定の後に変えていない。

### 7.4 観測値と残る判断

- 選ばれた閾値は低く（coverage 0.5 の境界の候補 `0.00618` では F1 `0.0`）、F1 が最大になる点では全 item に提案がある。本 prompt の OWL-ViT は、gold set 上で提案の 8 割以上が gold box と一致しない。承認された gold set 計画に精度の下限は無いため判定には使わない。
- G2Q-03D を `PASS` にするには、検出の box 許容差（px 単位の `1.0e-03` を、原寸へ拡大した OWL-ViT の box に適用するか）について、新しい所有者の判断が要る。本 node は失敗として記録し、許容差は変えない。

evidence: 4b2f43be44851be9be455714b3524639633aa7c776a280113d6bc878a89257c7 exit=1

### 7.5 検出単位 parity の再判定（所有者の判断 G2Q-03D-T の方針 A、2026-09-25）

§7.3 の測定の**後に**、所有者は §7.4 の判断として方針 A を選んだ（[`2026-09-25-owner-ruling-G2Q-03D-parity.md`](../../docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03D-parity.md)、対策案 [`20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md`](../../work/20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md)）。適用範囲は本 script の `--mode goldset` だけで、共有の [`detection_checkpoint_parity.compare`](detection_checkpoint_parity.py) と [`detection.py`](detection.py) の `BOX_TOLERANCE` は変えていない。§7.1 と同じ command で測り直した。ATG 実行 `e52b01c9-2f58-4024-abf9-8d74f4671c85`（main6）の node G2Q-03D（attempt 2）。exit code `0`（`verdict: PASS`）。閾値は §7.2 と同じ `0.0002533551160013303`。

判定の基準（JSON の `parity_policy`）:

- A1: 生出力 `logits` / `pred_boxes` が `rtol 1e-3` / `atol 1e-4` の範囲内。
- A2: 画像ごとの検出数が等しく、全検出が IoU `0.99` 以上で 1 対 1 に対応し、label の不一致 0、score の差 `1e-4` 以下。原寸 px の box の差は記録だけにする。
- A3: backend ごとに、その backend 自身の box と score で gold set の F1 を計算し（IoU 0.5 以上、1 対 1）、`abs(F1_backend - F1_torch)` が `0.005` 以下。

| 比較 | A1 生出力（logits / pred_boxes の最大差） | A2 検出数 / IoU 0.99 で対応 / 対応のない検出 / label 不一致 | A2 score 最大差 | box 最大差（原寸 px、記録だけ） | 判定 |
|---|---|---|---:|---:|---|
| torch ↔ onnxruntime-cpu | 範囲内（`1.2765e-03` / `1.4734e-04`） | 2,820 / 2,820 / 0 / 0 | `1.4346e-06` | `7.4707e-02` | PASS |
| torch ↔ onnxruntime-directml | 範囲内（`7.3433e-04` / `2.2542e-04`） | 2,820 / 2,820 / 0 / 0 | `2.3167e-07` | `4.9835e-02` | PASS |
| onnxruntime-cpu ↔ onnxruntime-directml | 範囲内（`1.3700e-03` / `1.7321e-04`） | 2,820 / 2,820 / 0 / 0 | `1.5395e-06` | `4.8096e-02` | PASS |

| backend（A3） | 一致（IoU 0.5 以上） | 提案の box | gold box | F1 | torch との差 |
|---|---:|---:|---:|---:|---:|
| torch | 483 | 2,820 | 1,079 | `0.247756` | — |
| onnxruntime-cpu | 484 | 2,820 | 1,079 | `0.248269` | `5.13e-04` |
| onnxruntime-directml | 483 | 2,820 | 1,079 | `0.247756` | `0` |

- onnxruntime-cpu は torch より一致が 1 件多い。gold box との IoU が 0.5 の境界の近くにある box が 1 件、box の差で境界をまたいだものと考えられる（どの box かは JSON に記録していないため未確認）。F1 の差は許容差 `0.005` の範囲内である。
- A3 が backend 自身の box を使うことは、合成入力（件数は同じで 1 box だけが IoU 0.5 の境界をまたぐ）で F1 が変わり、A2 が失敗になることで確かめた（`work/20260925-0526-check-f1-synthetic.py`、exit code `0`）。
- JSON の集計値の整合（3 比較の A1 / A2、F1 = 2TP / (提案 + gold)、torch の一致・提案数と `at_threshold` の一致、F1 の差）は `work/20260925-0526-check-parity-A.py` で検査した（exit code `0`）。
- §7.3 の `FAIL` の記録は残す。`FAIL` の判定は当時の基準（px の `1.0e-03`）では変わらない。

evidence: 1d45b86946fc0e8bd7503b626c68574c99afe2a3c23eb04aae99bbc44a529ed3 exit=0
