# G2R-12 — C6 分類 checkpoint の backend parity と推論性能

| 項目 | 値 |
|---|---|
| タスク | Gate 2 残タスク `G2R-12`（C6 分類 Curated Base Weight の技術 gate） |
| 実行日 | 2026-09-23 |
| 実行 host | Windows `10.0.29671` / `AMD64` / CPython `3.14.7`、NVIDIA GeForce RTX 4060 Laptop GPU |
| 対象 script | [`classification_checkpoint_parity.py`](classification_checkpoint_parity.py) |
| 実行環境 | `ml/.venv`（torch `2.11.0+cpu`、torchvision `0.26.0+cpu`、onnx `1.22.0`、onnxruntime-directml `1.24.4`） |
| parity 判定 | **PASS**（3 比較すべて、反復実行も bit 一致。exit code `0`） |
| 性能判定 | 採用基準（`≤ 100` ms / `≥ 10` FPS、[`adoption-template.md`](../../docs/model-governance/adoption-template.md) §11）を CPU・DirectML とも**満たす**（§5） |
| 対象用途の精度 | 測定前に固定した基準（初期重みが乱数初期化以上）を**満たす**。ただし両者とも偶然水準であり有益性は示していない（§7） |

---

## 1. 本結果が主張しないこと

1. **承認ではない。** 承認は採用記録 [`mobilenet-v3-large-imagenet1k-v2-adoption.md`](../../docs/model-governance/mobilenet-v3-large-imagenet1k-v2-adoption.md) §15 が行う。
2. **精度の主張ではない。** fixture は [`resources/samples/beans`](../../resources/samples/beans)（MIT）であり、ImageNet-1k の 1000 クラスを出力する本 checkpoint には **out-of-domain** である。本書は backend 間の出力一致だけを測る。
3. **POC-03 の完全条件は測っていない。** capture-to-display、30 分連続、10Hz 全フレーム、drop 率は INF phase の実装が無いため測定できない。

## 2. 対象

| 項目 | 値 |
|---|---|
| checkpoint | `vendor/models/mobilenet_v3_large-5c1a4163.pth`（Git 追跡外） |
| 取得元 | `https://download.pytorch.org/models/mobilenet_v3_large-5c1a4163.pth`（2026-09-23 取得） |
| byte size / SHA-256 | `22,132,113` / `5c1a416349c4cf298f2a6a5e2600ed0ee55e604713578f5e74e6bc8bcaef7997`（本 repository の独立計算。byte size は [`classification-base.md`](../../docs/model-governance/classification-base.md) §3.1 の HEAD 値と一致） |
| 読み込み | `torch.load(weights_only=True)` → `mobilenet_v3_large(num_classes=1000).load_state_dict(strict=True)`。state_dict `312` 件 |
| 前処理 | `MobileNet_V3_Large_Weights.IMAGENET1K_V2.transforms()`（resize 232、center crop 224、ImageNet mean/std。enum の metadata のみで download しない） |
| 入力 | SPI-15 と同じ eval split（各クラス末尾 5 枚、計 15 枚）、`1x3x224x224` |
| export | `torch.onnx.export(dynamo=False)`、opset `17`、固定 shape、`onnx.checker` 通過。ONNX `21,922,137` byte、SHA-256 `a27f23b2eba4869f05252234d501b63fb341772eee763ee2abef43cc26d43590`（parity・性能 3 回の実行で同一） |

## 3. 実行方法

```powershell
cd spikes\models
..\..\ml\.venv\Scripts\python.exe classification_checkpoint_parity.py --mode parity --artifact-dir ..\..\vendor\models\_spike\onnx
..\..\ml\.venv\Scripts\python.exe classification_checkpoint_parity.py --mode performance --artifact-dir ..\..\vendor\models\_spike\onnx
..\..\ml\.venv\Scripts\python.exe classification_checkpoint_parity.py --mode transfer
```

artifact dir は Git 追跡外の `vendor/models/_spike/` を使う（sandbox が repository 外への書き込みを拒否したため。[実行記録](../../work/20260923-0720-Gate2-TaskExecution.md) §1.1）。

## 4. Parity（実行前に固定した許容差: SPI-15 と同値）

| 比較 | logit 最大差 | softmax 最大差 | top-1 一致 | top-5 集合一致 | 判定 |
|---|---:|---:|---:|---:|---|
| torch ↔ onnxruntime-cpu | `1.1444e-05` | `1.2219e-06` | 15/15 | 15/15 | **PASS** |
| torch ↔ onnxruntime-directml | `1.3113e-05` | `1.6391e-06` | 15/15 | 15/15 | **PASS** |
| onnxruntime-cpu ↔ onnxruntime-directml | `9.2983e-06` | `7.3016e-07` | 15/15 | 15/15 | **PASS** |
| 許容差 | `1.0e-04` | `1.0e-05` | 全件 | 全件 | — |

- 同一 session 設定で 2 回実行した出力は CPU・DirectML とも **bit 単位で同一**。
- DirectML session の providers は `['DmlExecutionProvider', 'CPUExecutionProvider']`。CPU fallback node の有無は測定範囲外であり、全 node が GPU で実行されたことを主張しない。

## 5. 推論性能

測定条件は SSDLite の性能測定（[`detection-checkpoint-parity-result.md`](detection-checkpoint-parity-result.md) §10.1）と同じ関数 `measure_latency` を再利用した。warm-up 5 巡の後、15 枚 × 20 巡 = **300 サンプル**を 1 枚ずつ逐次実行し、nearest-rank 法で集計。session option は既定値。

| EP | 実行 | min | median | p95 | max | mean | throughput | 累積 peak working set |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CPU | 1 回目 | `4.079` ms | `8.008` ms | **`22.588` ms** | `59.077` ms | `10.152` ms | **`98.50` FPS** | `502.2` MB |
| CPU | 2 回目 | `3.979` ms | `12.062` ms | **`34.779` ms** | `173.024` ms | `15.347` ms | **`65.16` FPS** | `504.0` MB |
| CPU | 3 回目 | `2.835` ms | `4.358` ms | **`12.870` ms** | `31.820` ms | `5.713` ms | **`175.04` FPS** | `505.7` MB |
| DirectML | 1 回目 | `1.189` ms | `1.502` ms | **`2.356` ms** | `3.915` ms | `1.624` ms | **`615.88` FPS** | `725.6` MB |
| DirectML | 2 回目 | `1.169` ms | `1.529` ms | **`2.220` ms** | `2.541` ms | `1.600` ms | **`625.08` FPS** | `724.5` MB |
| DirectML | 3 回目 | `1.225` ms | `1.390` ms | **`2.091` ms** | `2.485` ms | `1.481` ms | **`675.38` FPS** | `735.4` MB |

| 採用基準 | 実測 | 判定 |
|---|---|---|
| 推論 p95 ≤ `100` ms | CPU `12.9`〜`34.8` ms、DirectML `2.1`〜`2.4` ms | **合格（本測定条件）** |
| スループット ≥ `10` FPS | CPU `65.2`〜`175.0`、DirectML `615.9`〜`675.4` | **合格（本測定条件）** |

- 3 回目はレビュー反映後の script で実行し、script 自身が上記基準で `verdict=PASS`、exit code `0` を返した（1〜2 回目は基準判定を持たない版で、`MEASURED` を返した）。
- CPU の max（`173` ms）と run 間の差は host 負荷による変動と考えられるが、原因は調査していない。p95 はいずれの回も基準の 1/2 以下である。
- メモリは process 全体の**累積**最大値で、常駐する PyTorch eager model を含む（SSDLite と同じ制約）。

## 6. 再現性

| 対象 | 結果 |
|---|---|
| ONNX SHA-256 | parity 1 回・性能 3 回で同一（`a27f23b2…43590`） |
| 反復推論 | CPU・DirectML とも bit 一致 |

## 7. 対象用途での精度（Fine-Tuning 初期重みとしての比較、`--mode transfer`）

採用基準は**測定前に**[実行記録](../../work/20260923-0720-Gate2-TaskExecution.md) §3 へ固定した: 本 checkpoint で初期化した Fine-Tuning の eval top-1 accuracy が、同一 recipe の乱数初期化以上であること。

```powershell
cd spikes\models
..\..\ml\.venv\Scripts\python.exe classification_checkpoint_parity.py --mode transfer
```

| 項目 | 値 |
|---|---|
| fixture / split | beans、train 45 / eval 15（SPI-15 と同じ split）、3 クラス |
| recipe | SPI-15 の `classification.train_model` 既定値（8 epoch、batch 8、SGD lr `0.05`、momentum `0.9`、seed `20260922`、CPU、`torch.use_deterministic_algorithms(True)`）。`classifier[-1]` を 3 クラスの Linear へ置換 |
| 前処理 | 両者とも `IMAGENET1K_V2.transforms()`（224x224） |

| 初期化 | eval top-1 | epoch 平均 loss（1→8） |
|---|---:|---|
| 本 checkpoint | **5/15**（`0.333`） | `1.063`, `0.328`, `0.460`, `0.745`, `2.680`, `2.242`, `2.170`, `1.781` |
| 乱数 | **5/15**（`0.333`） | `1.147`, `1.123`, `1.082`, `1.041`, `1.151`, `1.071`, `0.986`, `0.981` |

**判定: 基準を満たす（`5/15 ≥ 5/15`、script は `verdict=PASS`、exit code `0`）。**

この結果が示す範囲を正確に記録する:

1. **両者とも 3 クラスの偶然水準（1/3）である。** 本測定は「初期重みが乱数初期化より悪い結果を与えない」ことだけを示し、**初期重みの有益性は示していない**。
2. checkpoint 初期化の loss は epoch 2 で `0.328` まで下がった後に `2.680` へ発散している。SPI-15 の学習率 `0.05` は事前学習済み重みの Fine-Tuning には大きすぎる可能性があるが、**測定前に固定した recipe を結果を見て変更しない**。製品の Fine-Tuning recipe は TRN phase で別途決定する。
3. eval は 15 枚であり、統計的な有意性・汎化性能を主張しない。

## 8. Transfer 学習済み model の ONNX parity（G2T-10、2026-09-24）

既存の `--mode transfer` を使い、承認済み MobileNetV3 C6 checkpoint で初期化して SPI-15 と同じ recipe で学習した model を ONNX へ export し、torch / ONNX Runtime CPU / ONNX Runtime DirectML の一致を測った。random 初期化 run は従来どおり比較基準として残すだけで、parity には使っていない。

```powershell
$env:PYTHONUTF8='1'; cmd /d /c "cd /d spikes\models && ..\..\vendor\models\_spike\venv\Scripts\python.exe classification_checkpoint_parity.py --mode transfer > ..\..\vendor\models\_spike\c6-cls-transfer.json"; $code=$LASTEXITCODE
```

| 項目 | 値 |
|---|---|
| 実行日 | 2026-09-24 |
| exit code | `1` |
| 判定 | **FAIL** |
| 環境 | Windows `10.0.29671` / `AMD64` / CPython `3.14.7`、torch `2.11.0+cpu`、torchvision `0.26.0+cpu`、onnx `1.22.0`、onnxruntime `1.24.4`、NumPy `2.5.2` |
| available providers | `DmlExecutionProvider`, `CPUExecutionProvider` |
| checkpoint | `vendor/models/mobilenet_v3_large-5c1a4163.pth`、SHA-256 `5c1a416349c4cf298f2a6a5e2600ed0ee55e604713578f5e74e6bc8bcaef7997`、`torch.load(weights_only=True)` / `strict=True` |
| ONNX | `vendor/models/_spike/onnx/classification-checkpoint-transfer.onnx`、`16,813,500` bytes、SHA-256 `a9392506bcec2874c7712b915ea976e19566b1094a018d08693eec7e3d81f698` |
| 許容差 | logit `1.0e-04`、softmax 確率 `1.0e-05` |
| 許容差の出典 | SPI-15 の `classification.py` 定数 `LOGIT_TOLERANCE` / `PROB_TOLERANCE`。本書 §4 と同じ値で、実行前に固定し、結果を見て変更していない |
| repeat_run_bitwise_identical | `true`（CPU / DirectML とも反復実行は bit 一致） |

| 比較 | logit 最大差 | softmax 最大差 | top-1 一致 | top-5 集合一致 | 判定 |
|---|---:|---:|---:|---:|---|
| torch vs onnxruntime-cpu | `16384.0` | `0.0` | 15/15 | 15/15 | **FAIL** |
| torch vs onnxruntime-directml | `12288.0` | `0.0` | 15/15 | 15/15 | **FAIL** |
| onnxruntime-cpu vs onnxruntime-directml | `8192.0` | `0.0` | 15/15 | 15/15 | **FAIL** |

従来の transfer accuracy 条件（checkpoint 初期化の eval top-1 accuracy が random 初期化以上）は `5/15 ≥ 5/15` で満たしたが、3 比較すべてで logit 最大差が固定許容差を超えたため、総合 verdict は `FAIL` である。softmax 最大差と top-1 は一致しているが、logit 許容差は緩和しない。

evidence: 28ca90753dd42d5cfc56cacc78df26610e827a8d57de86fbdaa6a5bb7bbe1f85 exit=1
