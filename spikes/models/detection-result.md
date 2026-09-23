# SPI-16 / G2-06 — 検出 学習→ONNX 一致検証 実測結果

| 項目 | 値 |
|---|---|
| タスク | SPI-16 / Gate 2 lane `G2-06`（検出 train → ONNX → CPU 推論の box / score / label と mAP 差） |
| 実行日 | 2026-09-22 |
| 実行 host | Windows `10.0.29671` / `AMD64` / CPython `3.14.7` |
| 対象 script | [`spikes/models/detection.py`](detection.py) |
| 判定 | **PASS**（既定条件 60 epoch）。6 epoch / 20 epoch では **FAIL** であり、その実測も §7.4 に保持する |
| Gate 2 | **解除しない**。本結果は parity の技術検証であり、model 承認ではない |
| manifest | **本 spike は manifest を変更しない**。[`manifest.json`](../../resources/models/manifest.json) は `ready=false`。C6 検出 entry は 2026-09-22 に登録後、2026-09-23 に取り消し、同日の再登録も取り消した。その後、owner 裁定 D1 により承認して登録した。manifest は C6 分類・C6 検出の 2 件を持つ（[`detection-base.md`](../../docs/model-governance/detection-base.md) §15.10） |

---

## 1. 本結果が主張しないこと

1. **承認済み Base Weight を使っていない。** [SPI-12](../../docs/model-governance/detection-base.md) は検出 C6 候補をすべて `HOLD` としている。したがって本 probe は事前学習 checkpoint を **download / load / 同梱していない**。backbone を含め torchvision の構造コード（C5）を random 初期化したまま学習した。
2. **検出精度の合格・不合格ではない。** 既定 60 epoch 条件で測定した AP@0.5 は `0.0104`（6 epoch 条件では約 `0.0013`、§7.4）であり、これは「random 初期化の模型を所定 epoch 学習した出力」という観測事実にすぎない。品質の主張には使わない。
3. **DirectML を測っていない。** 実行 provider は `CPUExecutionProvider` のみである。
4. **6 epoch の FAIL を「解消した」と一般化しない。** §7.4 の epoch 掃引は「score が分離すれば検出集合が一致する」ことを本 fixture で示したが、承認済み weight・他のデータ・他の後処理設定でも同じになるとは測定していない。

---

## 2. 実行方法と exit code

```powershell
ml\.venv\Scripts\python.exe spikes\models\detection.py --artifact-dir <repository 外の作業 dir>
```

- exit code: `0`（既定 60 epoch）。`--epochs 6` / `--epochs 20` では failure があるため exit code `1`
- 出力 ONNX は repository 外の作業 directory にだけ書き出し、repository へ commit していない。

### 2.1 証拠を結び付ける SHA-256

Windows working-tree bytes（text file は `core.autocrlf=true` による CRLF）。

| 対象 | SHA-256 |
|---|---|
| `spikes/models/detection.py` | `0873523a1123bedaa3051b232b2923669af75f8ece28a5447666734978306a0e` |
| 生成 ONNX（`detection.onnx`、8,989,974 bytes、60 epoch） | `190a38ab672d54849b51161f60b66bde1d23cd7cbe956aa7bf548da4e8d17975` |
| 同（6 epoch 条件） | `7f9f84cc6ae179c252f9699de4ff3435a7d59d5704d1e61524df60e4a1213ba5` |
| 同（20 epoch 条件） | `c875c5debaf8` から始まる値（§7.4 の掃引時に生成） |

---

## 3. 実測環境

| 項目 | 値 |
|---|---|
| OS | Windows `10.0.29671` / `AMD64` |
| Python | CPython `3.14.7` |
| PyTorch | `2.11.0+cpu` |
| TorchVision | `0.26.0+cpu` |
| ONNX | `1.22.0` |
| ONNX Runtime | `1.24.4`（`onnxruntime-directml` 配布） |
| NumPy | `2.5.2` |
| session provider | `CPUExecutionProvider` |
| torch thread 数 | `1`（固定） |

---

## 4. Fixture（権利確認済み）

| 項目 | 値 |
|---|---|
| 出典 | [`resources/samples/gwhd-2021`](../../resources/samples/gwhd-2021) |
| ライセンス | CC BY 4.0（[`ATTRIBUTION.txt`](../../resources/samples/gwhd-2021/ATTRIBUTION.txt)、[`LICENSE.txt`](../../resources/samples/gwhd-2021/LICENSE.txt)） |
| カテゴリー | `wheat_head`（1 クラス） |
| 画像枚数 / box 数 | 20 枚 / 1,079 box（学習 15 枚 / 評価 5 枚） |
| 入力サイズ | 1024 × 1024 を 320 × 320 へ縮小し、box 座標も同じ倍率で変換 |
| 分割方法 | COCO `image_id` 昇順の末尾 5 枚を評価へ固定 |

---

## 5. 学習条件と実測

| 項目 | 値 |
|---|---|
| 構造 | torchvision `ssdlite320_mobilenet_v3_large`（`weights=None`、`weights_backbone=None`、`num_classes=2`） |
| 重み初期化 | random（backbone も含めて事前学習なし） |
| seed | `20260922` |
| optimiser | SGD、lr `0.01`、momentum `0.9` |
| epoch / batch | **60**（既定） / 3 |
| epoch 平均 loss | 1 epoch 目 `13.994815` → 60 epoch 目 `0.145245`（6 epoch 目は `6.268291`、20 epoch 目は `2.487874`） |
| 学習時間 | 267.064〜274.514 秒（60 epoch） |

**既定 epoch を 6 から 60 へ変更した理由:** 6 epoch では全検出の score が幅 `0.0132` に密集し、parity の測定が「同順位の検出を比べられない」状態になっていた（§7.4）。60 epoch は score が分離して検出集合が一意に定まる、実測で確認できた最小の既定条件である。`--epochs 6` で旧条件を再現できる。

**batch size を 2 から 3 へ変更した理由（失敗の記録）:** batch 2 では学習 15 枚が 7 batch + 端数 1 batch に分かれ、backbone 末端の 1×1 特徴マップに対する BatchNorm が `Expected more than 1 value per channel when training, got input size torch.Size([1, 64, 1, 1])` で失敗した。学習枚数を割り切れる batch 3 へ変更し、**2 件未満の batch** が出た場合は無言で捨てずに中止する guard（`if len(selection) < 2: raise SystemExit`）を入れた。**この初回失敗を成功へ置換していない。**

---

## 6. export 条件

| 項目 | 値 |
|---|---|
| exporter | `torch.onnx.export(dynamo=False)`（TorchScript 系 legacy exporter） |
| opset | `17` |
| 出力名 | `boxes` / `scores` / `labels` |
| 検証 | `onnx.checker.check_model` を通過 |
| export 時間 | 1.519〜3.606 秒 |

**記録すべき警告:** legacy exporter の `DeprecationWarning` に加えて、torchvision の `boxes.py` と `transform.py` が `torch.tensor(sourceTensor)` に対する `UserWarning` を出す。いずれも torchvision 側の実装由来であり、本 probe が抑止していない。

---

## 7. 一致検証の実測値

評価 5 枚を PyTorch（`eval()`、`no_grad`）と ONNX Runtime CPU の両方へ通し、score `>= 0.05` の検出を score 降順に整列して比較した。順位整列だけでは「検出集合の差」と「座標の差」を区別できないため、**IoU >= 0.99 の貪欲対応付け**による比較も併記する。

### 7.1 全体（既定 60 epoch）

| 指標 | 許容差（事前宣言） | 実測値 | 判定 |
|---|---:|---:|---|
| IoU 対応付け済み box の最大絶対差 | `1.0e-03` | **`3.0518e-05`** | PASS |
| IoU 対応付け済み score の最大絶対差 | `1.0e-04` | **`1.1325e-06`** | PASS |
| IoU 対応付け済み label 不一致 | 0 | **0** | PASS |
| AP@0.5 の絶対差 | `1.0e-04` | **`0.0`**（torch `0.01036998` / onnx `0.01036998`、相対 `0.0`） | PASS |
| 対応相手のない検出 | 0 | **torch 側 0 件 / ONNX 側 0 件** | PASS |
| 画像ごとの検出件数一致 | 5/5 | **5/5** | PASS |
| 順位整列での box 最大絶対差 | 参考 | `3.0518e-05` px | 参考 |
| 順位整列での score 最大絶対差 | 参考 | `1.1325e-06` | 参考 |
| 順位整列での label 不一致 | 参考 | `0` | 参考 |
| 検出 score の全体幅 | 参考 | `0.944691` | 参考（§7.4） |
| ONNX CPU 推論時間（5 枚） | — | 0.121 秒 | 参考 |

検出集合が完全に一致したため、順位整列と IoU 対応付けの値が同一になった。AP は VOC 方式の補間 precision（`p_interp(r) = max_{r' >= r} p(r')`）で計算しており、両者の差は**厳密に 0.0**である。

### 7.2 画像ごとの実測（60 epoch）

| 評価画像 | GT box | torch 検出 | ONNX 検出 | IoU 対応付け | torch のみ | ONNX のみ | 対応済み box 最大差 | 対応済み score 最大差 | torch score の範囲 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 0 | 43 | 60 | 60 | 60 | 0 | 0 | `3.0518e-05` | `1.13e-06` | 0.050975〜0.937914 |
| 1 | 34 | 46 | 46 | 46 | 0 | 0 | `3.0518e-05` | `1.13e-06` | 0.050810〜0.692243 |
| 2 | 56 | 44 | 44 | 44 | 0 | 0 | `1.5259e-05` | `2.98e-07` | 0.052905〜0.777769 |
| 3 | 52 | 34 | 34 | 34 | 0 | 0 | `1.5259e-05` | `2.98e-07` | 0.051709〜0.995501 |
| 4 | 49 | 52 | 52 | 52 | 0 | 0 | `3.0518e-05` | `5.96e-07` | 0.052140〜0.859684 |

### 7.3 観測された事実

1. **対応が付いた 236 件すべてが数値的に一致している。** box は最大 `3.05e-05` px、score は最大 `1.13e-06` しか違わない。演算そのものの移植差は極めて小さい。
2. **検出集合も完全に一致した。** 5 枚すべてで検出件数が一致し、対応相手のない検出は torch 側・ONNX 側とも 0 件である。AP@0.5 の差は厳密に `0.0` である。
3. **score が `0.050810`〜`0.995501` の幅 `0.944691` に分離している。** 60 epoch 学習で loss が `0.145245` まで下がり、検出の順位が一意に定まる状態になった。

### 7.4 epoch 掃引による原因の特定（選択肢 2 の実測）

初版（6 epoch）の FAIL 原因を切り分けるため、学習 epoch だけを変えて同一手順を 3 条件で実測した。**fixture・seed・許容差・比較方法はすべて同一**である。

| epochs | 最終 epoch 平均 loss | 検出 score の全体幅 | 対応相手のない検出（torch / ONNX） | 画像ごとの検出件数 | IoU 対応付け | AP@0.5 の絶対差 | 判定 |
|---:|---:|---:|---:|---|---:|---:|---|
| 6 | `6.268291` | `0.013195` | 27 / 32 | `(126,124) (126,129) (122,125) (125,125) (123,124)` | 595 | `9.350e-05` | **FAIL** |
| 20 | `2.487874` | `0.058056` | 2 / 1 | `(91,90) (88,88) (87,87) (91,91) (86,86)` | 441 | `2.405e-07` | **FAIL** |
| **60** | `0.145245` | `0.944691` | **0 / 0** | `(60,60) (46,46) (44,44) (34,34) (52,52)` | 236 | `0.0` | **PASS** |

**観測された関係:** loss の低下 → score の分離幅の拡大 → 対応相手のない検出の減少、が単調に対応している。IoU 対応付け済みの box 最大差は 3 条件とも `3.0518e-05` px で変わらない。すなわち**演算の移植精度は最初から一貫して高く、FAIL は検出の順位が定まらないことだけが原因だった**と本 fixture 上で確定できる。

6 epoch 条件の記録（順位整列 box 差 `282.4947` px、AP 相対差 `7.14%`）は、比較対象がずれたときに何が起きるかの実測として §7.4 の表に保持する。この値を同一検出どうしの座標差として読まない。

---

## 8. 再現性の確認

既定 60 epoch の最終版 script で 2 回実行し、次が一致した。

| 対象 | 1 回目 | 2 回目 |
|---|---|---|
| epoch 平均 loss（60 値すべて） | 一致 | 一致 |
| ONNX SHA-256 | `190a38ab…17975` | `190a38ab…17975` |
| 検出件数 / 対応付け件数 / 各差分 / AP / failures | 一致 | 一致 |
| verdict | `PASS` | `PASS` |
| 所要時間 | 267.064 秒 | 274.514 秒（host 負荷依存） |

6 epoch 条件の FAIL も 2 回実行で再現しており、いずれの結論も偶発ではない。

**独立レビューによる訂正（2026-09-22）:** 初版の `average_precision` は補間 precision を `precision[index:index+1].max()` と書いており、要素 1 個の最大値＝補間なしになっていた。VOC 方式（`precision[index:].max()`）へ訂正し、本書の AP 値は訂正後の実測値である。あわせて、順位整列の label 不一致を failure 条件から外し（§7.1 で「参考」としている比較を判定へ混ぜないため）、IoU 対応付け済み pair の label 不一致だけを failure 条件とした。両者とも実測 0 件であり、判定は変わらない。

---

## 9. 未解決事項（本結果では閉じない）

| ID | 内容 | 状態 |
|---|---|---|
| DP-01 | 承認済み検出 C6 weight での parity | **実施済み（別書）**。SSDLite checkpoint で `PASS`（[`detection-checkpoint-parity-result.md`](detection-checkpoint-parity-result.md) §6・§11）。SSDLite は 2026-09-23 に承認された（[`detection-base.md`](../../docs/model-governance/detection-base.md) §15.10） |
| DP-02 | score が十分に分離した模型で 6 epoch の FAIL が解消するか | **解消を実測（§7.4）**。60 epoch・score 幅 `0.944691` で対応相手のない検出 0 件、AP 差 `0.0`。ただし本 fixture での結果であり、他データ・他設定へ一般化しない |
| DP-03 | 製品の score 閾値・NMS 設定を決めた上での parity | **未実施**。製品側の検出後処理は未確定 |
| DP-04 | DirectML EP での parity | **実施済み（別書）**。取得済み checkpoint で `PASS`。[`detection-checkpoint-parity-result.md`](detection-checkpoint-parity-result.md) §6 |
| DP-05 | `dynamo=True`（torch.export 系）exporter での parity | **未実施** |
| DP-06 | COCO 公式 mAP（全 IoU 平均）での比較 | **未実施**。本結果は単クラス AP@0.5 のみ |
| DP-07 | AP がほぼ 0 でない条件での AP 差の評価 | **60 epoch で AP `0.0104`、差 `0.0`**。ただし AP `0.0104` 自体は品質の主張ではない |

---

## 10. Gate 2 への影響

- 本結果は **`G2-06` の DoD（box / score / label と mAP 差を実測記録）を満たし、既定条件での parity 判定は PASS** である。
- 本結果は **Gate 2 を解除しない**。Gate 2 は SPI-11〜17 と D-15 の全条件を要する。検出 C6 は 2026-09-23 に SSDLite を承認した（[`detection-base.md`](../../docs/model-governance/detection-base.md) §15.10）が、Gate 2 の他の条件は未充足である。
- `resources/models/manifest.json` は変更していない。本結果を根拠に entry を追加してはならない。
- 本 parity は **random 初期化の模型**で測ったものである。承認済み weight での parity（DP-01）は別途必要である。

---

## 11. D-15 / G2-08 — 検出 AutoML mini-run の実測（2026-09-22 追加）

利用者の許可（「このPCで測定」）に基づき、`--mode automl-mini-run` で検出学習 1 trial の実費用を実測した。**製品の学習 pipeline（TRN）は未実装であり、本測定は本 spike の学習ループの費用である。**

### 11.1 条件

| 項目 | 値 |
|---|---|
| 構造 | torchvision `ssdlite320_mobilenet_v3_large`（random 初期化、`num_classes=2`） |
| fixture | gwhd-2021 の学習 15 枚（評価 5 枚は使用しない）、`320x320` |
| trial 数 / epoch | `8` / `3` |
| sampler / seed | `TPESampler` / `20260922` |
| 探索空間 | `learning_rate` log-uniform `1e-3..1e-1`、`batch_size` `{3, 4, 5}` |
| device | CPU（`torch 2.11.0+cpu`、thread `1`） |

`batch_size` は学習枚数を割った端数が 1 になる値を除外して決定する。端数 1 の batch は 1x1 feature map 上の BatchNorm が拒否するためである（§10 の失敗記録と同一原因）。実測時の学習 15 枚では `{2}` が除外され `{3, 4, 5}` が残った。

### 11.2 実測値

| 実行 | 1 trial 最小 | 1 trial 中央値 | 1 trial 最大 | study 合計 |
|---|---:|---:|---:|---:|
| 1 回目 | `9.234` 秒 | `11.887` 秒 | **`14.529` 秒** | `95.884` 秒 |
| 2 回目 | `13.354` 秒 | `15.166` 秒 | **`19.479` 秒** | `125.644` 秒 |

最終 epoch 平均 loss は 8 trial すべてが 2 回とも同値（`8.411811` / `13.476874` / `10.402858` / `8.127028` / `9.128535` / `8.731621` / `7.852205` / `12.706214`）であり、**探索は決定的**である。所要時間の差は host 負荷によるもので、探索結果は変わらない。

### 11.3 決定した budget

| device | 最大 Trial 数 | 最大時間 | 算出根拠 |
|---|---:|---:|---|
| CPU | 20 | **420 秒** | 2 回の実測で観測した最大 trial `19.479` 秒 × 20 = `389.58` 秒 を上回る 60 秒単位の切り上げ |

**主張しないこと:** loss 値は品質の主張ではない（3 epoch の random 初期化である）。実データ規模・製品の学習 pipeline・CUDA / DirectML 学習への外挿を根拠にしていない。検出の CUDA budget は未測定である。

---

## 12. D-15 / G2-08 — 検出 AutoML の CUDA 実測（2026-09-23 追加）

Gate 2 の合格条件が「Windows **CPU/accelerator** の AutoML budget を実測決定」であるため、§11 の CPU 実測に加えて accelerator（CUDA）を実測した。

### 12.1 実行環境

`torch 2.11.0+cu130` / `torchvision 0.26.0+cu130` / CUDA build `13.0` / `NVIDIA GeForce RTX 4060 Laptop GPU`（driver `616.92`）/ optuna `4.9.0`（CPU 実測と同版に固定）/ numpy `2.5.3`。

**依存は repository 外の隔離 venv へ導入した。製品 lock（`ml/pyproject.toml`・`ml/uv.lock`）は変更していない。** 製品の推論 provider は A-07 で `windows-x64/cpu` と `windows-x64/directml` に固定されており CUDA を含まない。

```powershell
<repo 外の venv>\Scripts\python.exe spikes\models\detection.py --mode automl-mini-run --device cuda
```

条件（trial 数 8、3 epoch、`batch_size` `{3,4,5}`、seed `20260922`）は §11 の CPU 実測と同一である。

### 12.2 実測値

| device | 実行 | 1 trial 最小 | 1 trial 中央値 | 1 trial 最大 | study 合計 |
|---|---|---:|---:|---:|---:|
| CPU（§11） | 1 回目 | `9.234` 秒 | `11.887` 秒 | `14.529` 秒 | `95.884` 秒 |
| CPU（§11） | 2 回目 | `13.354` 秒 | `15.166` 秒 | **`19.479` 秒** | `125.644` 秒 |
| CUDA | 1 回目 | `1.303` 秒 | `1.832` 秒 | **`3.945` 秒** | `16.090` 秒 |
| CUDA | 2 回目 | `1.157` 秒 | `1.729` 秒 | `3.065` 秒 | `14.755` 秒 |

### 12.3 CPU と CUDA の決定性の違い（観測した事実）

- **CPU は 2 回とも 8 trial すべての最終 epoch 平均 loss が同値**だった（§11.2）。
- **CUDA は 2 回で loss が一致しない。** 1 回目 `9.963464 / 13.366575 / 10.794086 / 8.131240 / 9.517601 / 8.697785 / 8.029436 / 12.553222`、2 回目 `8.408670 / 13.319569 / 10.531185 / 8.204432 / 8.559206 / 9.321480 / 7.992263 / 12.482486`。
- したがって **CUDA 学習は本条件で非決定的**である。`torch.use_deterministic_algorithms` 等の決定性設定は本 spike では有効化していない。budget の算出には所要時間のみを用い、loss は品質の主張に使わない。

### 12.4 決定した budget

| device | 最大 Trial 数 | 最大時間 | 算出根拠 |
|---|---:|---:|---|
| CPU | 20 | **420 秒** | 実測最大 trial `19.479` 秒 × 20 = `389.58` 秒 を上回る 60 秒単位の切り上げ |
| CUDA | 20 | **120 秒** | 実測最大 trial `3.945` 秒 × 20 = `78.9` 秒 を上回る 60 秒単位の切り上げ |

**実データ規模・製品の学習 pipeline（TRN 未実装）への外挿を根拠にしていない。** DirectML 学習は `onnxruntime-directml` が推論専用のため測定対象外である。
