# SPI-15 / G2-05 — 分類 学習→ONNX 一致検証 実測結果

| 項目 | 値 |
|---|---|
| タスク | SPI-15 / Gate 2 lane `G2-05`（分類 train → ONNX → CPU 推論の出力差） |
| 実行日 | 2026-09-22 |
| 実行 host | Windows `10.0.29671` / `AMD64` / CPython `3.14.7` |
| 対象 script | [`spikes/models/classification.py`](classification.py) |
| 判定 | **PASS**（宣言した許容差を超えた測定値はない） |
| Gate 2 | **解除しない**。本結果は parity の技術検証であり、model 承認ではない |
| manifest | **本 spike は manifest を変更しない**。[`manifest.json`](../../resources/models/manifest.json) は `ready=false` で、2026-09-23 の Gate 2 残タスク実行後は C6 分類（`mobilenet-v3-large-imagenet1k-v2`）と C6 検出の 2 件のみを持つ（[ADR-0004](../../docs/adr/0004-spike-decisions.md) §5.1.12・§5.1.13） |

---

## 1. 本結果が主張しないこと

1. **承認済み Base Weight を使っていない。** [SPI-11](../../docs/model-governance/classification-base.md) は分類 C6 候補をすべて `HOLD` としている。したがって本 probe は事前学習 checkpoint を **download / load / 同梱していない**。torchvision の構造コード（C5）を random 初期化したまま学習した。
2. **精度・品質の合格ではない。** 60 枚の fixture を 8 epoch 学習しただけであり、accuracy を受入値として扱わない。
3. **DirectML を測っていない。** 実行 provider は `CPUExecutionProvider` のみである。
4. **承認済み weight での parity を代用しない。** C6 が承認された後、同じ手順を承認済み weight で再実行する必要がある。

---

## 2. 実行方法と exit code

```powershell
ml\.venv\Scripts\python.exe spikes\models\classification.py --mode parity --artifact-dir <repository 外の作業 dir>
```

- exit code: `0`
- 出力 ONNX は repository 外の作業 directory にだけ書き出し、repository へ commit していない。

補助検証（同じ script、別 mode）:

- `--mode automl-mini-run` は D-15 用の trial 所要時間測定であり、本 parity 判定には含めない。実測値は §11、決定は [`docs/implementation-plan.md`](../../docs/implementation-plan.md) の D-15 行に記録した。

### 2.1 証拠を結び付ける SHA-256

Windows working-tree bytes（text file は `core.autocrlf=true` による CRLF）。

| 対象 | SHA-256 |
|---|---|
| `spikes/models/classification.py` | `029423be25df35b4fc90a0a5fef42ef1063a285cab07c6e83513e834b71c7d0d` |
| 生成 ONNX（`classification.onnx`、6,093,347 bytes） | `d6d657660c2f8b9fd2ca22d4d4f2f382b7b63aaa1a7bca7f957df17c7b596522` |

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
| 出典 | [`resources/samples/beans`](../../resources/samples/beans) |
| ライセンス | MIT（[`ATTRIBUTION.txt`](../../resources/samples/beans/ATTRIBUTION.txt)、[`LICENSE.txt`](../../resources/samples/beans/LICENSE.txt)） |
| クラス | `angular_leaf_spot` / `bean_rust` / `healthy` |
| 画像枚数 | 60（学習 45 / 評価 15） |
| 入力サイズ | 128 × 128、`(x/255 - 0.5) / 0.5` 正規化のみ |
| 分割方法 | クラスごとに末尾 5 枚を評価へ固定（乱数分割ではない） |

---

## 5. 学習条件と実測

| 項目 | 値 |
|---|---|
| 構造 | torchvision `mobilenet_v3_small`（`weights=None`、`num_classes=3`） |
| 重み初期化 | random（torchvision 既定初期化） |
| seed | `20260922`、`torch.use_deterministic_algorithms(True)` |
| optimiser | SGD、lr `0.05`、momentum `0.9` |
| epoch / batch | 8 / 8 |
| epoch 平均 loss | `1.114250`, `1.074384`, `1.050249`, `1.066663`, `1.036776`, `0.910994`, `0.994875`, `0.876815` |
| 学習時間 | 7.587 秒（1 回目）／ 10.076 秒（再現確認時） |

loss は 8 epoch で単調減少していない（epoch 4 と epoch 7 で上振れ）。これは 45 枚・random 初期化の条件による観測事実としてそのまま記録する。**収束の主張はしない。**

---

## 6. export 条件

| 項目 | 値 |
|---|---|
| exporter | `torch.onnx.export(dynamo=False)`（TorchScript 系 legacy exporter） |
| opset | `17` |
| 入出力名 | `images` → `logits`、batch 軸のみ dynamic |
| 検証 | `onnx.checker.check_model` を通過 |
| export 時間 | 0.625〜3.313 秒 |

**記録すべき警告:** PyTorch 2.11 は legacy exporter に対して `DeprecationWarning` を出す（2.9 以降は `torch.export` 系が既定）。本 probe は再現性を優先して legacy exporter を明示指定した。**`dynamo=True` 経路は未検証**であり、製品採用前に別途確認が必要である。

---

## 7. 一致検証の実測値

評価 15 枚を PyTorch（`eval()`、`no_grad`）と ONNX Runtime CPU の両方へ通し、同一入力 tensor に対する出力差を測定した。

| 指標 | 許容差（事前宣言） | 実測値 | 判定 |
|---|---:|---:|---|
| logit の最大絶対差 | `1.0e-04` | **`1.5497e-06`** | PASS |
| logit の平均絶対差 | — | `2.1565e-07` | 参考 |
| softmax 確率の最大絶対差 | `1.0e-05` | **`5.9605e-07`** | PASS |
| softmax 確率の平均絶対差 | — | `6.6724e-08` | 参考 |
| top-1 ラベル一致 | 15/15 | **15/15** | PASS |
| ONNX CPU 推論時間（15 枚） | — | 0.009〜0.152 秒 | 参考 |

許容差は測定前に script の定数として宣言した値である（`LOGIT_TOLERANCE` / `PROB_TOLERANCE`）。測定後に緩めていない。

---

## 8. 再現性の確認

同一 script を 2 回実行し、次が一致した。

| 対象 | 1 回目 | 2 回目 |
|---|---|---|
| epoch 平均 loss（8 値すべて） | 一致 | 一致 |
| ONNX SHA-256 | `d6d65766…96522` | `d6d65766…96522` |
| 最大 logit 差 / 最大確率差 / top-1 一致 | `1.5497e-06` / `5.9605e-07` / 15/15 | 同一 |
| 所要時間 | 異なる（host 負荷依存） | 異なる |

所要時間だけが変動し、数値結果と成果物 hash は一致した。

---

## 9. 未解決事項（本結果では閉じない）

| ID | 内容 | 状態 |
|---|---|---|
| CP-01 | 承認済み分類 C6 weight での parity | **実施済み（別書、2026-09-23）**。MobileNetV3 Large V2 checkpoint で torch / ORT CPU / ORT DirectML を実測し `PASS`。[`classification-checkpoint-result.md`](classification-checkpoint-result.md) §4 |
| CP-02 | DirectML EP での parity | **未実施**。本結果は CPU のみ |
| CP-03 | `dynamo=True`（torch.export 系）exporter での parity | **未実施** |
| CP-04 | 実データ規模（数千枚）での parity と所要時間 | **未実施**。60 枚の fixture の結果を外挿しない |
| CP-05 | 量子化・最適化後 ONNX の parity | **未実施** |
| CP-06 | CUDA 学習で生成した weight の ONNX parity | **未実施**。§11 の CUDA 測定は AutoML の所要時間だけを対象とし、export parity は CPU で測定している |

---

## 10. Gate 2 への影響

- 本結果は **`G2-05` の DoD（train → ONNX → CPU 推論の出力差を実測記録）を満たす**。
- 本結果は **Gate 2 を解除しない**。Gate 2 は SPI-11〜17 と D-15 の全条件を要する。分類 C6 は 2026-09-23 に 1 件承認されたが（CP-01）、Gate 2 の他の条件は未充足である。
- `resources/models/manifest.json` は変更していない。本結果を根拠に entry を追加してはならない。

---

## 11. AutoML mini-run（D-15 / `G2-08`）の実測

同じ script の `--mode automl-mini-run` で測定した。**parity 判定には含めない。**

```powershell
# CPU（製品 lock の環境）
ml\.venv\Scripts\python.exe spikes\models\classification.py --mode automl-mini-run --device cpu
# CUDA（測定専用の隔離環境。§11.2）
<gpu-env>\Scripts\python.exe spikes\models\classification.py --mode automl-mini-run --device cuda
```

- exit code: いずれも `0`
- 共通条件: beans fixture 45 枚・4 epoch・128px、Optuna `4.9.0` TPESampler、seed `20260922`、8 trial、探索空間は `learning_rate`（log-uniform `1e-3`〜`1e-1`）と `batch_size`（`4` / `8` / `16`）

### 11.1 実測値

| device | 実行 | 1 trial 最小 | 1 trial 中央値 | 1 trial 最大 | study 合計 |
|---|---|---:|---:|---:|---:|
| CPU（`torch 2.11.0+cpu`、thread `1`） | 1 回目 | 3.889 秒 | 5.133 秒 | **7.768 秒** | 42.699 秒 |
| CPU | 2 回目 | 2.586 秒 | 4.353 秒 | 5.120 秒 | 32.781 秒 |
| CPU | 3 回目 | 2.391 秒 | 3.218 秒 | 5.401 秒 | 29.302 秒 |
| CPU | 4 回目 | 2.016 秒 | 2.462 秒 | 4.598 秒 | 24.326 秒 |
| CUDA（`torch 2.11.0+cu130`、RTX 4060 Laptop） | 1 回目 | 0.562 秒 | 1.053 秒 | 4.261 秒 | 14.077 秒 |
| CUDA | 2 回目 | 0.583 秒 | 1.992 秒 | **4.353 秒** | 16.372 秒 |
| CUDA | 3 回目 | 0.601 秒 | 2.128 秒 | 3.955 秒 | 16.380 秒 |

- study の管理 overhead: CPU `0.041` 秒、CUDA `0.035` 秒（study 合計 − trial 所要時間の総和）。trial 費用に対して無視できる。
- trial 番号に対する所要時間の増加傾向はない。費用は trial 数に線形である。
- **eval accuracy は全実行・全 trial で `0.3333`** である。3 クラス分類の偶然水準であり、random 初期化を 4 epoch 学習した条件では探索が精度差を生んでいない。**この mini-run は所要時間の測定であり、探索空間の品質根拠には使わない。**

### 11.2 CUDA 測定用の依存採用（利用者指示 `G-1`）

| 項目 | 内容 |
|---|---|
| 採用したもの | `torch==2.11.0+cu130`、`torchvision==0.26.0+cu130`（index `https://download.pytorch.org/whl/cu130`） |
| 必要性 | 要求定義 TBD-03 が「**CPU/CUDA ごとの**最大 Trial 数と最大時間」を求めている。製品 lock の `torch 2.11.0+cpu` は CPU 専用ビルドで CUDA 学習を実行できない |
| 版の選定理由 | 製品 lock と**同一の torch 版 `2.11.0`** の CUDA ビルドを選び、計算 backend 以外の差を測定から除いた |
| 導入先 | **repository 外の隔離環境**（`%TEMP%` 配下）。測定後に削除する |
| 製品 lock への影響 | **なし**。`ml/pyproject.toml` と `ml/uv.lock` は変更していない |
| 製品同梱を先回りしない理由 | A-07 で製品の推論 provider は `windows-x64/cpu` と `windows-x64/directml` の 2 件に固定されており CUDA を含まない。TRN（学習）phase は Gate 4 で未着手である。使う予定が確定していない段階で CUDA runtime（数 GB）を製品 lock と installer へ入れるのは YAGNI 違反にあたる。同梱の可否は TRN phase で判断する |
| 取得経路 | 既定 index に承認済み proxy `https://packagefeedproxy.microsoft.io/pypi/simple/` を使い、torch/torchvision のみ `--no-deps` で PyTorch 公式 index から取得した。依存は proxy 経由で解決した |

### 11.3 D-15 の決定

この実測に基づく決定（分類・上記 fixture 条件での「最大 Trial 数 20」「最大時間 CPU 180 秒 / CUDA 120 秒」）と、未決定として残した範囲は [`docs/implementation-plan.md`](../../docs/implementation-plan.md) の D-15 行に記録した。

- CPU: 実測最大 trial `7.768` 秒 × 20 = `155.4` 秒 → `180` 秒
- CUDA: 実測最大 trial `4.353` 秒 × 20 = `87.1` 秒 → `120` 秒

丸め規則は「実測最大 trial × 最大 Trial 数を上回る、**60 秒単位の切り上げ**」である。いずれも**実測を上回る安全側**であり、実データ規模への外挿を含まない。

---

## 12. 独立レビューによる訂正（2026-09-22）

別担当のレビューを受け、本書と D-15 行に次を反映した。**parity の PASS 判定と実測値は変わっていない。**

| 指摘 | 反映内容 |
|---|---|
| D-15 の最大時間 `600` 秒が、未測定の実データ規模・CUDA/DirectML への外挿で正当化されていた | budget を実測条件へ限定し、最大時間を実測最大 trial から算出できる値（CPU `180` 秒）へ訂正。その後、利用者指示により CUDA を実測し CUDA `120` 秒を追加した（§11） |
