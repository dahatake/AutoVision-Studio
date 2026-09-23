# SPI-12 / G2-02 — 取得済み checkpoint の backend parity 実測結果（DP-01 / DP-04）

| 項目 | 値 |
|---|---|
| タスク | SPI-12 / Gate 2 lane `G2-02` の残存 blocker `DP-01`（CPU parity）と `DP-04`（DirectML parity） |
| 実行日 | 2026-09-22 |
| 実行 host | Windows `10.0.29671` / `AMD64` / CPython `3.14.7` |
| 対象 script | [`spikes/models/detection_checkpoint_parity.py`](detection_checkpoint_parity.py)（SHA-256 `38984621975e88acef7adbed43d4cbcd0df471ecf5abd75ab9a0dddf634ae277`） |
| 判定 | **PASS**（3 比較すべて。exit code `0`） |
| Gate 2 | **BLOCKED を維持** |
| manifest | **本 spike は manifest を変更しない**。C6 検出 entry は 2026-09-22 に登録後、性能実測（§10）により同 23 日に取り消した。§11 の再測定を経て同 23 日に一度再登録したが、後処理閾値が製品の推論契約として未確定であるため同日再び取り消した（[`detection-base.md`](../../docs/model-governance/detection-base.md) §15.9）。その後 owner 裁定 D1 により承認・登録した（同 §15.10）。`ready=false` は維持 |

---

## 1. 本結果が主張しないこと

1. **承認ではない。** backend 間の一致は証拠であり、[`dependency-policy.md`](../../docs/dependency-policy.md) §6.1 が要求する重みライセンス識別子・NOTICE 内容・**承認者氏名**・承認日を供給しない。したがって manifest entry を作成しない。
2. **精度の主張ではない。** fixture は [`gwhd-2021`](../../resources/samples/gwhd-2021)（CC BY 4.0、麦穂）であり、COCO で学習された本 checkpoint にとって **out-of-domain** である。本書は PyTorch と ONNX Runtime の**出力が一致するか**だけを測り、検出精度を評価しない。
3. **他 3 役を解除しない。** Gate 2 は C6 分類・C6 検出・C7 分類・C7 検出の 4 役すべてを要する。本結果は C6 検出 1 役の技術要件の一部にのみ寄与する。
4. **性能の主張ではない。** §6 の所要時間は 5 枚の 1 回計測であり、latency / memory / 連続負荷の評価ではない。

## 2. 権利上の位置づけ

本 checkpoint の権利 gate は、2026-09-22 に利用者（repository license decision authority）が **risk acceptance** として充足扱いに設定したものである（[`detection-base.md`](../../docs/model-governance/detection-base.md) §15）。publisher が checkpoint 固有 license を発行した事実はない。本測定はその設定の下で、`vendor/models/`（Git 追跡外）にある取得済み binary を**読み取り専用で**使用した。repository と installer payload へ複製していない。

## 3. 実行方法と exit code

```powershell
ml\.venv\Scripts\python.exe spikes\models\detection_checkpoint_parity.py --artifact-dir <repo 外>
```

- exit code: `0`（`verdict=PASS`、`failures=[]`）
- `DmlExecutionProvider` が利用できない環境では、測定せず `SystemExit` で中止する（DP-04 を未測定のまま合格にしない）。
- checkpoint の SHA-256 が記録値と異なる場合も中止する（hash gate）。

### 3.1 証拠を結び付ける SHA-256

| 対象 | SHA-256 |
|---|---|
| checkpoint `ssdlite320_mobilenet_v3_large_coco-a79551df.pth`（`14,069,355` byte） | `a79551df90c79834bcd3bb3845ef9d966b5449a3a9b2833ae8404778ca5d65d2` |
| 生成 ONNX（`14,117,603` byte、repository 外） | `6e62517b65828293c8f5743d3f6fb7b967c2013b2989a3df9bb28d0a593e99d9` |
| `spikes/models/detection_checkpoint_parity.py` | `38984621975e88acef7adbed43d4cbcd0df471ecf5abd75ab9a0dddf634ae277` |
| `resources/models/manifest.json`（**測定時点**。実行前後で不変） | `7fe41f5bc497d48ffcbbaebaeb5cb02e91dfba0e1a6fe9b66d8cf8928c437a61` |

checkpoint の SHA-256 は [`detection-base.md`](../../docs/model-governance/detection-base.md) §14 の記録値と一致した。本 parity の実行では manifest を読み書きしていない。**上記 manifest hash は測定時点（登録前）の値であり、同日中の登録（`detection-base.md` §15.6）により現在の bytes はこの値ではない。**

## 4. 実測環境

| 項目 | 値 |
|---|---|
| OS / machine | Windows `10.0.29671` / `AMD64` |
| Python | `3.14.7` |
| torch / torchvision | `2.11.0+cpu` / `0.26.0+cpu` |
| onnx / onnxruntime | `1.22.0` / `1.24.4` |
| 利用可能 EP | `DmlExecutionProvider`、`CPUExecutionProvider` |
| torch thread | `1`、seed `20260922`、`torch.no_grad()` |

DirectML session の `get_providers()` は `['DmlExecutionProvider', 'CPUExecutionProvider']` を返す。ONNX Runtime は DirectML が実行できない node を CPU へ fallback させるため、**全 node が GPU で実行されたことを本書は主張しない**。測定したのは session 全体の出力である。

## 5. 対象と条件

| 項目 | 値 |
|---|---|
| 構造 | torchvision `ssdlite320_mobilenet_v3_large`（`num_classes=91`） |
| 重み読み込み | `torch.load(weights_only=True)` → `load_state_dict(strict=True)`。state_dict `476` 件、missing `0` / unexpected `0` |
| 入力 | fixture 末尾 5 枚、`320x320`、RGB `float32` `[0,1]`、ground truth box `234` 件（比較には使用しない） |
| export | `torch.onnx.export(dynamo=False)`、opset `17`、`onnx.checker` 通過 |
| 検出 filter | score `>= 0.05`、score 降順 stable sort |
| 対応付け | IoU `>= 0.99` の貪欲照合 |
| 許容差（実行前に固定。SPI-16 と同値） | box `1.0e-03`、score `1.0e-04` |

## 6. 実測値

| 比較 | ID | 対応付け件数 | 片側のみ検出 | label 不一致 | box 最大差 | score 最大差 | 判定 |
|---|---|---:|---:|---:|---:|---:|---|
| torch ↔ onnxruntime-cpu | `DP-01` | 294 | 0 / 0 | 0 | `9.9182e-05` | `6.0350e-07` | **PASS** |
| torch ↔ onnxruntime-directml | `DP-04` | 294 | 0 / 0 | 0 | `1.3733e-04` | `6.4075e-07` | **PASS** |
| onnxruntime-cpu ↔ onnxruntime-directml | `DP-04` | 294 | 0 / 0 | 0 | `1.4496e-04` | `6.1840e-07` | **PASS** |

- 5 枚すべてで検出件数が 3 backend とも一致し、**対応相手のない検出は 1 件も無い**。
- box 最大差は許容 `1.0e-03` の約 1/7、score 最大差は許容 `1.0e-04` の約 1/150 である。
- DirectML 経路の差（`1.4496e-04` px）は CPU 経路の差（`9.9182e-05` px）より大きいが、いずれも許容内である。**許容差は実行前に固定しており、結果に合わせて緩めていない。**

所要時間（5 枚 1 回の計測。性能評価ではない）:

| backend | 秒 |
|---|---:|
| torch eager | `0.310` |
| onnxruntime CPU | `0.380` |
| onnxruntime DirectML | `1.290`（初回 run の warm-up を含む。session 構築は含まない） |

## 7. 再現性の確認

同一 script で 2 回実行し、次が一致した。

| 対象 | 1 回目 | 2 回目 |
|---|---|---|
| ONNX SHA-256 | `6e62517b…e99d9` | `6e62517b…e99d9` |
| 3 比較の box / score 最大差 | 全値一致 | 全値一致 |
| 対応付け件数・片側検出・label 不一致 | `294` / `0` / `0` | `294` / `0` / `0` |
| verdict / exit code | `PASS` / `0` | `PASS` / `0` |

## 8. 未解決事項（本結果では閉じない）

| ID | 内容 | 状態 |
|---|---|---|
| DP-03 | 製品の score 閾値・NMS 設定を決めた上での parity | **未実施**。製品側の検出後処理が未確定 |
| DP-05 | `dynamo=True`（torch.export 系）exporter での parity | **未実施** |
| DP-06 | COCO 公式 mAP での精度比較 | **未実施**。本書は精度を評価しない |
| DP-08 | latency / memory / 連続負荷の実測（POC-16） | **未実施** |
| — | 採用記録ファイルと NOTICE 文案 | **測定時点では未作成**。同日中に利用者 dahatake の提示を受けて作成済み（[`detection-base.md`](../../docs/model-governance/detection-base.md) §15.6） |
| — | `licenses.checkpoint.spdx` に記載する license 識別子と `noticeText` | **測定時点では未提示**。同日中に `LicenseRef-AutoVisionStudio` と NOTICE 本文が確定（同 §15.6） |

## 9. Gate 2 への影響

- [`detection-base.md`](../../docs/model-governance/detection-base.md) §15.4 が挙げた manifest entry 作成の阻害要因のうち、**`support[]` の parity 検証（`windows-x64/cpu` と `windows-x64/directml` の 2 件）に必要な実測を本書が供給する**。
- **測定時点**では、残る阻害要因は **採用記録ファイル + 承認者氏名**と **license 識別子 + NOTICE 本文**の 2 点であり、いずれも利用者からの提示を要した。これらは同日中に提示され SSDLite は一度 manifest へ登録されたが、**翌 2026-09-23 の性能実測（§10）により保留へ差し戻され、登録は取り消された**（`detection-base.md` §15.8、ADR-0004 §5.1.11）。
- **Gate 2 は BLOCKED のまま**である。C6 分類・C7 分類・C7 検出の 3 役は未承認であり、`releaseStatus.ready=true` は 4 役すべてを要求する。
- 本 parity の実行は `resources/models/manifest.json` を変更しない。**本結果だけを根拠に `verified: true` の entry を追加してはならない**。本書は `support[]` の測定根拠のみを供給する。**C6 検出 entry は owner 裁定 D1 後に登録された**（[`detection-base.md`](../../docs/model-governance/detection-base.md) §15.10）。

---

## 10. 推論性能の実測（採用記録 §11、2026-09-23 追加）

採用記録 [`ssdlite320-mobilenet-v3-large-coco-v1-adoption.md`](../../docs/model-governance/ssdlite320-mobilenet-v3-large-coco-v1-adoption.md) §11 の空欄を埋めるため、同一 checkpoint・同一 export の ONNX について推論性能を実測した。

```powershell
ml\.venv\Scripts\python.exe spikes\models\detection_checkpoint_parity.py --mode performance --artifact-dir <repo 外>
```

### 10.1 測定条件

| 項目 | 値 |
|---|---|
| 対象 | 同 §3.1 の ONNX（SHA-256 `6e62517b…e99d9`、opset 17、preprocess 込み） |
| 入力 | fixture 末尾 5 枚、`320x320` |
| 手順 | warm-up **5 巡**（5 枚 × 5）の後、**20 巡**（5 枚 × 20 = **100 サンプル**）を 1 枚ずつ逐次実行して計測 |
| percentile | nearest-rank 法 |
| session option | **既定値**（固定 shape 化・graph optimization・batch 化などの最適化は未実施） |
| メモリ | process の `PeakWorkingSetSize`（`GetProcessMemoryInfo`）。**process 開始以降の累積最大値で reset されない**ため、同一 process 内で CPU → DirectML の順に計測した本測定では、DirectML 行が CPU 計測分と常駐する PyTorch eager model・state_dict を含む。**model 単独でも EP ごとの独立値でもない** |

### 10.2 実測値（2 回）

| EP | 実行 | min | median | p95 | max | mean | throughput | 累積 peak working set |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CPU | 1 回目 | `67.599` ms | `134.893` ms | **`198.959` ms** | `851.356` ms | `141.470` ms | **`7.07` FPS** | `598.6` MB |
| CPU | 2 回目 | `60.671` ms | `116.524` ms | **`179.384` ms** | `243.558` ms | `119.725` ms | **`8.35` FPS** | `597.9` MB |
| DirectML | 1 回目 | `123.145` ms | `199.791` ms | **`308.783` ms** | `446.302` ms | `215.478` ms | **`4.64` FPS** | `754.5` MB |
| DirectML | 2 回目 | `115.485` ms | `170.137` ms | **`254.590` ms** | `384.277` ms | `183.569` ms | **`5.45` FPS** | `756.9` MB |

### 10.3 判定

| 採用基準（[`adoption-template.md`](../../docs/model-governance/adoption-template.md) §11） | 実測 | 判定 |
|---|---|---|
| 推論 p95 レイテンシ ≤ `100` ms（POC-03） | CPU `179`〜`199` ms、DirectML `255`〜`309` ms | **不合格（現測定条件）** |
| 推論スループット ≥ `10` FPS（POC-03） | CPU `7.07`〜`8.35`、DirectML `4.64`〜`5.45` | **不合格（現測定条件）** |

**追加実行による再現性:** 本書の 2 回に加えて、レビュー反映後の 3 回目（CPU p95 `186.103` ms / `8.93` FPS、DirectML p95 `214.053` ms / `6.81` FPS）と、独立レビュアーによる別実行（CPU p95 `284.9` ms / `5.67` FPS、DirectML p95 `348.3` ms / `3.91` FPS）でも、**いずれの実行も両基準を満たさなかった**。所要時間は host 負荷で変動するが、結論は変わらない。

**この結果が主張しないこと:**

1. **POC-03 の完全条件は測定していない。** capture-to-display レイテンシ、30 分連続実行、10Hz 全フレーム処理、drop 率は、カメラと製品推論の実装（INF phase）が無いため測定できない。
2. **製品条件で 100 ms を満たせないことを確定しない。** 固定 shape 化、graph optimization、session option 調整、batch 化、EP 構成の変更はいずれも未実施である。
3. DirectML が CPU より遅い理由（CPU fallback の有無、node 配置）は**調査していない**。
4. 本機が POC-03 の「Windows 推奨構成」に該当するかは、正本に推奨構成の定義が見当たらないため**確定できない**。

**本結果の帰結（2026-09-23 時点、§11 の再測定前）:** 採用記録 §15 の最終判定を **保留**とし、`resources/models/manifest.json` への entry を作成しない（`models: []`、`ready=false`）。§11 の再測定後の帰結は §11.3 と [`detection-base.md`](../../docs/model-governance/detection-base.md) §15.9 を参照。

---

## 11. 後処理閾値の最小変更による再測定（G2R-14、2026-09-23）

§10.3 の「主張しないこと 2」（最適化未実施）を受け、既存 API の設定だけを変えて再測定した。変える設定は測定前に [実行記録](../../work/20260923-0720-Gate2-TaskExecution.md) §4.1 に固定した。

### 11.1 原因の切り分け（未 commit の簡易 probe、各 50 サンプル）

| 設定 | CPU p95 / FPS | DirectML p95 / FPS |
|---|---|---|
| 既定（torchvision `score_thresh=0.001`、session option 既定） | `100.5` ms / `14.79` | `120.1` ms / `10.66` |
| `intra_op_num_threads=20`（`os.cpu_count()`） | `149.7` ms / `9.82` | — |
| torchvision `score_thresh=0.05` | `16.6` ms / `71.79` | `28.8` ms / `39.70` |

既定設定の CPU p95（`100.5` ms）は §10.2（`179`〜`199` ms）より小さく、host 負荷で大きく変動する。いずれにせよ latency の大半は後処理（score `≥ 0.001` の大量候補に対する per-class NMS）であり、thread 数の変更では改善しなかった。

### 11.2 正式測定（committed script、`--score-thresh 0.05`）

```powershell
cd spikes\models
..\..\ml\.venv\Scripts\python.exe detection_checkpoint_parity.py --mode parity --score-thresh 0.05 --artifact-dir ..\..\vendor\models\_spike\onnx\ssd
..\..\ml\.venv\Scripts\python.exe detection_checkpoint_parity.py --mode performance --score-thresh 0.05 --artifact-dir ..\..\vendor\models\_spike\onnx\ssd
..\..\ml\.venv\Scripts\python.exe detection_checkpoint_parity.py --mode transfer
```

`score_thresh` は torchvision `ssdlite320_mobilenet_v3_large` の構築引数であり、重み bytes と session option は変えていない。生成 ONNX は byte size が同じ `14,117,603` byte だが、score 閾値の定数が異なるため §3.1 とは別の bytes（SHA-256 `6609f32846fa8dc39b50a7a22c7da6c731f79db3b98fb209ed1d29a2a5cbd21f`）であり、parity・性能 2 回で同一である。

**Parity（許容差は §5 と同一）**

| 比較 | 対応付け | 片側のみ | label 不一致 | box 最大差 | score 最大差 | 判定 |
|---|---:|---:|---:|---:|---:|---|
| torch ↔ onnxruntime-cpu | 294 | 0 / 0 | 0 | `9.9182e-05` | `6.0350e-07` | **PASS** |
| torch ↔ onnxruntime-directml | 294 | 0 / 0 | 0 | `1.3733e-04` | `6.4075e-07` | **PASS** |
| onnxruntime-cpu ↔ onnxruntime-directml | 294 | 0 / 0 | 0 | `1.4496e-04` | `6.1840e-07` | **PASS** |

§6（既定閾値）と全桁一致した。score `≥ 0.05` の検出集合は閾値変更で変わっていない。

**性能（§10.1 と同じ手順、各 100 サンプル。script が基準 `≤ 100` ms / `≥ 10` FPS で判定）**

| EP | 実行 | min | median | p95 | max | mean | throughput | 累積 peak working set | script 判定 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| CPU | 1 | `8.516` | `11.847` | **`14.331`** | `15.769` | `11.971` | **`83.54`** | `601.8` MB | PASS |
| DirectML | 1 | `21.328` | `24.049` | **`29.553`** | `35.539` | `24.600` | **`40.65`** | `763.5` MB | PASS |
| CPU | 2 | `11.149` | `14.967` | **`19.210`** | `28.438` | `15.221` | **`65.70`** | `602.2` MB | PASS |
| DirectML | 2 | `20.759` | `24.121` | **`27.709`** | `30.849` | `24.222` | **`41.29`** | `761.1` MB | PASS |

（単位: ms / FPS。DirectML は CPU より遅く、原因は調査していない。）

**対象用途の精度（Fine-Tuning 初期重みとしての比較、基準は [実行記録](../../work/20260923-0720-Gate2-TaskExecution.md) §4.2 に測定前固定）**

| 初期化 | eval AP@0.5（5 枚、GT 234 box） | score `≥ 0.05` の検出数 | epoch 平均 loss（1 → 60） |
|---|---:|---:|---|
| 本 checkpoint（classification head 以外） | **`0.0603`** | 551 | `9.433` → `0.202` |
| 乱数 | **`0.0104`** | 236 | `13.995` → `0.145` |

乱数初期化の AP（`0.01036998`）は SPI-16（[`detection-result.md`](detection-result.md)）の記録値と一致した。基準（checkpoint ≥ 乱数）を満たす（script `verdict=PASS`）。eval は 5 枚であり、統計的な有意性・汎化性能を主張しない。

### 11.3 判定と限界

- 採用基準（`≤ 100` ms / `≥ 10` FPS）を CPU・DirectML とも**満たすのは `score_thresh=0.05` の後処理で再 export した graph に限る**。
- 既定 `score_thresh=0.001` の後処理での不合格（§10）は取り消さない。製品の検出後処理（DP-03）は未決定であり、manifest schema は C6 entry に推論設定を持たないため、本条件を強制できない。このため採用記録はいったん**保留**とした（[`detection-base.md`](../../docs/model-governance/detection-base.md) §15.9）。その後の owner 裁定 D1 により、C6 の採用判定には本性能基準を用いないこととなり、承認した（同 §15.10）。本節の値は INF phase の後処理閾値設計の入力として残す。
- POC-03 の完全条件（capture-to-display、30 分連続、drop 率）は依然として未測定である。
