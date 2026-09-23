# Gate 2 残タスク実行記録

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書（実行記録） |
| 作成日時 | 2026-09-23 07:20 |
| 実行計画 | [`20260923-0630-Gate2-TaskExecutionPlan.md`](20260923-0630-Gate2-TaskExecutionPlan.md) |
| 利用者指示 | 「不明点はデフォルトのプランを採用」「全てのタスクを実行」「各タスク完了後に敵対的レビューを行い反映」 |
| 要求基準 | [`docs/requirement-definition.md`](../docs/requirement-definition.md) v0.6 Draft（指示中の `/hve-dev/requirement-definition.md` は本 repository に存在しないため、同名の正本 `docs/requirement-definition.md` を参照した） |

---

## 1. G2R-00 — 開始時点の snapshot

| 項目 | 値 |
|---|---|
| `resources/models/manifest.json` | `ready=false`、`models: []`、SHA-256 `23836de67d93620a24a1a7a96274a0e4463fab4d636895ba89846439dace76bd` |
| 製品版 | `0.1.5`（`node scripts/release/verify-product-version.mjs` exit 0） |
| git HEAD | `b68060b`。作業ツリーは Gate 2 lane の未 commit 変更を含む（`git status --short` で modified 15 件、untracked 8 件） |
| `vendor/models/`（Git 追跡外）の既存 file | `florence-2-base-ft.safetensors`、`groundingdino_swinb_cogcoor.pth`、`groundingdino_swint_ogc.pth`、`siglip-base-patch16-224.safetensors`、`ssdlite320_mobilenet_v3_large_coco-a79551df.pth`、`yolox_nano.pth`、`yolox_nano_storage001.pth` |
| 実行 host | Windows `10.0.29671` / AMD64、NVIDIA GeForce RTX 4060 Laptop GPU（driver `617.14`）、CPython `3.14.7` |
| 既存 ML 環境 | `ml/.venv`: torch `2.11.0+cpu`、torchvision `0.26.0+cpu`、onnx `1.22.0`、onnxruntime(-directml) `1.24.4`、EP `DmlExecutionProvider` / `CPUExecutionProvider` |

### 1.1 計画からの逸脱（sandbox 制約）

計画は「repository 外」の venv と artifact dir を指定しているが、本実行環境の sandbox は working directory 外への書き込みを拒否した（`C:\Users\dahatake\.cache\avs-g2r` の作成が `UnauthorizedAccess`。`%TEMP%` は呼び出しごとに破棄される）。このため、**Git 追跡外である `vendor/models/_spike/`**（`.gitignore` 248 行 `vendor/models/` に一致することを `git check-ignore -v` で確認）を代替として使う。製品 lock（`ml/pyproject.toml`、`ml/uv.lock`、`package-lock.json`）と Git 追跡対象には spike 依存を入れない。

## 2. 並列実行の方針

- download・package install・文書作成は並列に実行した。
- **性能測定（latency / FPS）は直列に実行した。** 同一 host で測定を並列化すると CPU / GPU を奪い合い、p95 が汚染されるためである。

## 3. C6 分類 §11「精度（タスク固有指標）」の採用基準（測定前に固定。2026-09-23 08:45 記録）

Phase 1 敵対的レビューの BLOCKING 指摘（精度が未測定のまま承認）を受け、**測定前に**次を固定する。

| 項目 | 固定内容 |
|---|---|
| 対象用途 | C6 は製品の分類 Fine-Tuning の初期重みである（[`dependency-policy.md`](../docs/dependency-policy.md) §1）。ImageNet 精度は ImageNet val set を持たないため本 repository では測れず、対象用途の指標として「初期重みとして使った Fine-Tuning 結果」を測る |
| 手順 | `resources/samples/beans`（SPI-15 と同じ split: train 45 / eval 15）で、`mobilenet_v3_large` の最終 Linear を 3 クラスへ置換し、(a) 本 checkpoint 初期化 と (b) 乱数初期化 を**同一 recipe**（SPI-15 の `train_model`、8 epoch、batch 8、SGD lr 0.05、momentum 0.9、seed 20260922、CPU、決定論的アルゴリズム）で学習する。前処理は両者とも `IMAGENET1K_V2.transforms()` |
| 指標 | eval 15 枚の top-1 accuracy |
| 採用基準 | **(a) の accuracy ≥ (b) の accuracy**（初期重みが乱数初期化より悪い結果を与えないこと）。結果を見て基準を変えない |
| 限界 | 15 枚の小 fixture であり、統計的な有意性・汎化性能を主張しない |

## 4. C6 検出 SSDLite の再測定条件と §11 精度基準（測定前に固定。2026-09-23 08:55 記録）

### 4.1 G2R-14 の最小再測定で変える設定

未 commit の probe（`vendor/models/_spike/ssd_probe.py`、各 50 サンプルの簡易測定）で、既存 API の設定ごとの寄与を切り分けた。

| 設定 | CPU p95 / FPS | DirectML p95 / FPS |
|---|---|---|
| 既定（torchvision `score_thresh=0.001`、session option 既定） | `100.5` ms / `14.79` | `120.1` ms / `10.66` |
| `intra_op_num_threads=20`（`os.cpu_count()`） | `149.7` ms / `9.82` | — |
| torchvision `score_thresh=0.05` | `16.6` ms / `71.79` | `28.8` ms / `39.70` |

latency の大半は network ではなく **後処理（score 閾値 `0.001` による大量候補の per-class NMS）**である。`0.05` は本 repository の既存 parity が比較に用いてきた `detection.SCORE_FLOOR` と同値であり、torchvision の後処理は score 降順・class 別 NMS のため、score `≥ 0.05` の検出集合は閾値変更で変わらないと予想される。**予想は採用根拠にせず、`score_thresh=0.05` で parity を再実測して確認する。** 正式測定は committed script の `--score-thresh 0.05` で行い、session option は既定のままとする。

### 4.2 §11 精度（対象用途）の採用基準

| 項目 | 固定内容 |
|---|---|
| 手順 | `resources/samples/gwhd-2021` の SPI-16 split（末尾 5 枚を eval）で `ssdlite320_mobilenet_v3_large(num_classes=2)` を、(a) 本 checkpoint 初期化（`head.classification_head` 以外を `strict` に load。classification head はクラス数が異なるため乱数初期化）と (b) 乱数初期化 で、SPI-16 の `detection.train_model` 既定 recipe（60 epoch、batch 3、SGD lr 0.01、momentum 0.9、seed 20260922、CPU）により学習する |
| 指標 | eval 5 枚の VOC AP@0.5（`detection.average_precision`、score `≥ 0.05`、torchvision 既定の後処理） |
| 採用基準 | **(a) の AP ≥ (b) の AP**。結果を見て基準・recipe を変えない |
| 限界 | eval 5 枚の小 fixture。統計的な有意性・汎化性能を主張しない |

## 5. タスク別の結果（DoD 照合）

| ID | 結果 | DoD の充足根拠 |
|---|---|---|
| G2R-00 | 完了 | §1 |
| G2R-01 / G2R-30 | 完了 | [`2026-09-23-owner-risk-acceptance.md`](../docs/model-governance/evidence/2026-09-23-owner-risk-acceptance.md)。artifact 単位（A: MobileNetV3 Large V2、B: grounding-dino-tiny HF safetensors revision `a2bb814d…`）、未確認項目、`LicenseRef-AutoVisionStudio`、publisher grant でない旨、決定者・決定日。2026-09-22 決定の対象と対象外を §1.1 で分離 |
| G2R-10 | 完了 | `22,132,113` byte / SHA-256 `5c1a4163…7997` を独立計算。一次資料 5 件を保存 |
| G2R-11 | 完了（**承認**） | [`mobilenet-v3-large-imagenet1k-v2-adoption.md`](../docs/model-governance/mobilenet-v3-large-imagenet1k-v2-adoption.md) |
| G2R-12 | 完了（PASS） | [`classification-checkpoint-result.md`](../spikes/models/classification-checkpoint-result.md) |
| G2R-13 | 完了 | manifest entry `mobilenet-v3-large-imagenet1k-v2`。test が evidence hash と採用記録の値を照合 |
| G2R-14 | 完了（条件付き PASS） | `score_thresh=0.05` で parity 再確認と性能再測定（[`detection-checkpoint-parity-result.md`](../spikes/models/detection-checkpoint-parity-result.md) §11）。既定後処理は不適合のまま |
| G2R-15 | 完了（**保留維持**） | DoD の (a)〜(b) のいずれも成立しない: (a) の性能合格は製品契約として未確定の後処理閾値に依存し、manifest で強制できない（Phase 1B–3 敵対的レビュー BLOCKING #1）。(b) の owner 裁定は利用者判断事項で、本実行では代行しない。採用記録 §15 |
| G2R-16 | **登録しない** | DoD「Approved の場合のみ」。一度再登録した entry はレビュー反映で取り消した |
| G2R-17 | **実行しない** | DoD の実行条件「SSDLite が性能・裁定とも不可の場合のみ」は未確定（閾値の owner 判断待ち）であり、不可と判定されていない |
| G2R-20 | 完了 | §6（49 distribution の版・直接/推移・wheel byte・license、lock 差分 15 件、CVE 照会） |
| G2R-21 | 完了 | `model.safetensors` を再 hash（publisher LFS SHA-256 と一致）、付属 file 6 件を revision 固定で取得・hash |
| G2R-22 | 完了（parity PASS、CPU 性能 FAIL） | [`siglip-assist-result.md`](../spikes/models/siglip-assist-result.md)。`confidenceThreshold` は DQ-07 により未決定 |
| G2R-23 | 完了（**保留**） | [`siglip-base-patch16-224-adoption.md`](../docs/model-governance/siglip-base-patch16-224-adoption.md) |
| G2R-24 | **登録しない** | DoD「Approved の場合のみ」。DQ-08 |
| G2R-31 | 完了 | `model.safetensors` の独立計算が publisher LFS SHA-256 と一致。`config.json` の `architectures` が transformers 本体 class で remote code 不要 |
| G2R-32 | 完了（parity FAIL） | [`grounding-dino-assist-result.md`](../spikes/models/grounding-dino-assist-result.md)。計画 §6 停止条件 3 に該当 |
| G2R-33 | 完了（**保留**） | [`grounding-dino-tiny-adoption.md`](../docs/model-governance/grounding-dino-tiny-adoption.md) |
| G2R-34 | **登録しない** | DoD「Approved の場合のみ」。DQ-08 |
| G2R-40〜43 | **blocked** | 依存（G2R-24 / G2R-34 の承認済み C7）が未充足。G2R-41 / 42 は利用者の実作業 session を要し、AI が生成してはならない（計画 Phase 4 注意） |
| G2R-50 | 完了 | `ready=false`、承認 1 件（C6 分類）、未達理由を `reason` に明記 |
| G2R-51 | 完了 | ADR-0004 §5.1.12、CHANGELOG、版（§10） |
| G2R-52 | §8 | — |

## 6. G2R-20 — transformers 隔離 spike 環境と依存採用の判定材料

| 項目 | 内容 |
|---|---|
| 場所 | `vendor/models/_spike/venv`（Git 追跡外。§1.1 の sandbox 制約による） |
| 導入経路 | `uv pip install`、index は製品と同じ `packagefeedproxy.microsoft.io/pypi/simple/`（`files.pythonhosted.org` と `download.pytorch.org` への直接接続は TLS handshake 失敗） |
| 直接指定した package | `torch==2.11.0`、`torchvision==0.26.0`、`onnx==1.22.0`、`onnxruntime-directml==1.24.4`、`pillow==12.3.0`、`numpy==2.5.2`（以上は製品 lock と同版）、`transformers`（未固定で resolve → `5.17.0`）、`sentencepiece`（→ `0.2.2`）、`optuna==4.9.0`（`detection.py` の import に必要。製品 lock と同版） |
| 導入された distribution | **49 件**（下表。wheel 合計 `221,040,690` byte） |
| 製品 lock（`ml/uv.lock`）に名前が無い distribution | **15 件、wheel 合計 `22,568,004` byte**: `annotated-doc`、`anyio`、`click`、`h11`、`hf-xet`、`httpcore`、`httpx`、`huggingface-hub`、`regex`、`safetensors`、`sentencepiece`、`shellingham`、`tokenizers`、`transformers`、`typer`。名前単位の比較であり、lock に既にある distribution の版差は比較していない |
| 上記 15 件の Critical/High CVE | GitHub Advisory Database（`gh api /advisories?ecosystem=pip&affects=<name>@<version>`、2026-09-23）で該当 advisory **0 件**（同じ照会で `torch@2.11.0` は Low 1 件を返しており、照会自体は機能している） |
| 製品 lock | **変更していない**。C7 が 2 役とも保留のため、[`dependency-policy.md`](../docs/dependency-policy.md) §10 の採用判断は行わない。採用する場合は lock へ上記 15 件（版は再 resolve で変わりうる）が加わる |

wheel byte 数は、proxy の simple index で installed `WHEEL` tag に一致する wheel を特定し、download URL の `Content-Length`（redirect 後）を取得した値である。license は各 `*.dist-info/METADATA` の `License-Expression`、短い `License`、または `License ::` classifier の記載をそのまま転記した（本 repository による license 審査ではない）。生成 script（`vendor/models/_spike/inventory.py`）は Git 追跡外に置いた。

| # | distribution | version | direct / transitive | wheel file | wheel bytes | license (METADATA) |
|---:|---|---|---|---|---:|---|
| 1 | `alembic` | `1.20.0` | transitive | `alembic-1.20.0-py3-none-any.whl` | 268,719 | MIT |
| 2 | `annotated-doc` | `0.0.5` | transitive | `annotated_doc-0.0.5-py3-none-any.whl` | 5,302 | MIT |
| 3 | `anyio` | `4.15.1` | transitive | `anyio-4.15.1-py3-none-any.whl` | 132,079 | MIT |
| 4 | `certifi` | `2026.7.22` | transitive | `certifi-2026.7.22-py3-none-any.whl` | 136,983 | MPL-2.0 |
| 5 | `click` | `8.5.0` | transitive | `click-8.5.0-py3-none-any.whl` | 125,251 | BSD-3-Clause |
| 6 | `colorama` | `0.4.6` | transitive | `colorama-0.4.6-py2.py3-none-any.whl` | 25,335 | BSD License |
| 7 | `colorlog` | `6.12.0` | transitive | `colorlog-6.12.0-py3-none-any.whl` | 12,239 | MIT License |
| 8 | `filelock` | `3.32.6` | transitive | `filelock-3.32.6-py3-none-any.whl` | 100,189 | MIT |
| 9 | `flatbuffers` | `25.12.19` | transitive | `flatbuffers-25.12.19-py2.py3-none-any.whl` | 26,661 | Apache 2.0 |
| 10 | `fsspec` | `2026.7.0` | transitive | `fsspec-2026.7.0-py3-none-any.whl` | 206,583 | BSD-3-Clause |
| 11 | `greenlet` | `3.5.6` | transitive | `greenlet-3.5.6-cp314-cp314-win_amd64.whl` | 327,473 | MIT AND PSF-2.0 |
| 12 | `h11` | `0.16.0` | transitive | `h11-0.16.0-py3-none-any.whl` | 37,515 | MIT |
| 13 | `hf-xet` | `1.6.0` | transitive | `hf_xet-1.6.0-cp38-abi3-win_amd64.whl` | 4,033,128 | Apache-2.0 |
| 14 | `httpcore` | `1.0.9` | transitive | `httpcore-1.0.9-py3-none-any.whl` | 78,784 | BSD-3-Clause |
| 15 | `httpx` | `0.28.1` | transitive | `httpx-0.28.1-py3-none-any.whl` | 73,517 | BSD-3-Clause |
| 16 | `huggingface_hub` | `1.31.0` | transitive | `huggingface_hub-1.31.0-py3-none-any.whl` | 798,313 | Apache-2.0 |
| 17 | `idna` | `3.19` | transitive | `idna-3.19-py3-none-any.whl` | 68,550 | BSD-3-Clause |
| 18 | `Jinja2` | `3.1.6` | transitive | `jinja2-3.1.6-py3-none-any.whl` | 134,899 | BSD License |
| 19 | `Mako` | `1.4.1` | transitive | `mako-1.4.1-py3-none-any.whl` | 80,010 | MIT |
| 20 | `markdown-it-py` | `4.2.0` | transitive | `markdown_it_py-4.2.0-py3-none-any.whl` | 91,687 | MIT License |
| 21 | `MarkupSafe` | `3.0.3` | transitive | `markupsafe-3.0.3-cp314-cp314-win_amd64.whl` | 15,341 | BSD-3-Clause |
| 22 | `mdurl` | `0.1.2` | transitive | `mdurl-0.1.2-py3-none-any.whl` | 9,979 | MIT License |
| 23 | `ml_dtypes` | `0.6.0` | transitive | `ml_dtypes-0.6.0-cp314-cp314-win_amd64.whl` | 457,224 | Apache-2.0 |
| 24 | `mpmath` | `1.3.0` | transitive | `mpmath-1.3.0-py3-none-any.whl` | 536,198 | BSD |
| 25 | `networkx` | `3.6.1` | transitive | `networkx-3.6.1-py3-none-any.whl` | 2,068,504 | BSD-3-Clause |
| 26 | `numpy` | `2.5.2` | direct | `numpy-2.5.2-cp314-cp314-win_amd64.whl` | 12,597,627 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| 27 | `onnx` | `1.22.0` | direct | `onnx-1.22.0-cp312-abi3-win_amd64.whl` | 17,213,290 | Apache-2.0 |
| 28 | `onnxruntime-directml` | `1.24.4` | direct | `onnxruntime_directml-1.24.4-cp314-cp314-win_amd64.whl` | 25,571,098 | MIT License |
| 29 | `optuna` | `4.9.0` | direct | `optuna-4.9.0-py3-none-any.whl` | 425,553 | MIT License |
| 30 | `packaging` | `26.3` | transitive | `packaging-26.3-py3-none-any.whl` | 129,956 | Apache-2.0 OR BSD-2-Clause |
| 31 | `pillow` | `12.3.0` | direct | `pillow-12.3.0-cp314-cp314-win_amd64.whl` | 7,237,707 | MIT-CMU |
| 32 | `protobuf` | `7.36.1` | transitive | `protobuf-7.36.1-cp310-abi3-win_amd64.whl` | 456,518 | 3-Clause BSD License |
| 33 | `Pygments` | `2.21.0` | transitive | `pygments-2.21.0-py3-none-any.whl` | 1,250,147 | BSD-2-Clause |
| 34 | `PyYAML` | `6.0.3` | transitive | `pyyaml-6.0.3-cp314-cp314-win_amd64.whl` | 156,429 | MIT |
| 35 | `regex` | `2026.9.10` | transitive | `regex-2026.9.10-cp314-cp314-win_amd64.whl` | 281,170 | Apache-2.0 AND CNRI-Python |
| 36 | `rich` | `15.0.0` | transitive | `rich-15.0.0-py3-none-any.whl` | 310,654 | MIT |
| 37 | `safetensors` | `0.8.0` | transitive | `safetensors-0.8.0-cp310-abi3-win_amd64.whl` | 355,540 | Apache Software License |
| 38 | `sentencepiece` | `0.2.2` | direct | `sentencepiece-0.2.2-cp314-cp314-win_amd64.whl` | 1,356,144 | Apache-2.0 |
| 39 | `setuptools` | `81.0.0` | transitive | `setuptools-81.0.0-py3-none-any.whl` | 1,062,021 | MIT |
| 40 | `shellingham` | `1.5.4` | transitive | `shellingham-1.5.4-py2.py3-none-any.whl` | 9,755 | ISC License |
| 41 | `SQLAlchemy` | `2.0.54` | transitive | `sqlalchemy-2.0.54-cp314-cp314-win_amd64.whl` | 2,169,220 | MIT |
| 42 | `sympy` | `1.14.0` | transitive | `sympy-1.14.0-py3-none-any.whl` | 6,299,353 | BSD |
| 43 | `tokenizers` | `0.23.2` | transitive | `tokenizers-0.23.2-cp310-abi3-win_amd64.whl` | 2,863,236 | Apache Software License |
| 44 | `torch` | `2.11.0` | direct | `torch-2.11.0-cp314-cp314-win_amd64.whl` | 114,552,300 | BSD-3-Clause |
| 45 | `torchvision` | `0.26.0` | direct | `torchvision-0.26.0-cp314-cp314-win_amd64.whl` | 4,348,469 | BSD |
| 46 | `tqdm` | `4.70.1` | transitive | `tqdm-4.70.1-py3-none-any.whl` | 80,199 | MPL-2.0 AND MIT |
| 47 | `transformers` | `5.17.0` | direct | `transformers-5.17.0-py3-none-any.whl` | 12,295,140 | Apache 2.0 License |
| 48 | `typer` | `0.27.2` | transitive | `typer-0.27.2-py3-none-any.whl` | 123,130 | MIT |
| 49 | `typing_extensions` | `4.16.0` | transitive | `typing_extensions-4.16.0-py3-none-any.whl` | 45,571 | PSF-2.0 |

## 7. 実行計画 §6 の停止報告

G2R-32 で停止条件 3（ONNX export / DirectML parity が最小修正でも解決しない）に該当した。G2R-41 / G2R-42 は停止条件 5（利用者の実作業 session が必要）に該当する。

```text
完了済み ID: G2R-00, G2R-01, G2R-10, G2R-11, G2R-12, G2R-13, G2R-14, G2R-15(保留維持), G2R-20, G2R-21, G2R-22, G2R-23(保留), G2R-30, G2R-31, G2R-32(FAIL), G2R-33(保留), G2R-50, G2R-51, G2R-52
未着手 ID: G2R-17（実行条件未成立）, G2R-40, G2R-41, G2R-42, G2R-43
blocked ID: G2R-16, G2R-24, G2R-34（採用記録が保留のため登録不可）, G2R-40〜43（承認済み C7 が 0 件）
停止理由: C7 検出 Grounding DINO tiny の parity FAIL（停止条件 3）。C7 分類 SigLIP の CPU 性能不適合（DQ-08）。C6 検出 SSDLite は後処理閾値の owner 判断待ち。SPI-17 は利用者の実作業 session が必要（停止条件 5）
最後に成功した検証: §8
次に必要な利用者判断:
  1. C6 検出: 製品の検出後処理閾値を score_thresh >= 0.05 として推論契約に固定するか、C6 に POC-03 の実時間推論閾値を適用しないと裁定するか（G2R-15 (b)）
  2. C7 分類: SigLIP の CPU 経路改善（量子化等）へ進むか、より軽量な別候補を調査するか
  3. C7 検出: dynamo=True exporter 等の追加技術作業へ進むか、別候補を調査するか
  4. SPI-17: 承認済み C7 が得られた後の manual-only / assisted 実作業 session の実施
```

## 8. 最終検証（G2R-52、2026-09-23 レビュー反映後）

| 検証 | 結果 |
|---|---|
| `node scripts/release/verify-product-version.mjs` | **exit 0**（`0.1.6`） |
| `node scripts/docs/verify-documentation.mjs` | **exit 0**（8 Markdown / 5 SVG） |
| `node --test scripts/docs/verify-documentation.test.mjs` | **22 / 22 PASS** |
| `node --test scripts/release/verify-product-version.test.mjs` | **25 / 25 PASS** |
| `node --test scripts/models/manifest-schema.test.mjs` | **38 / 38 PASS**（承認済み 1 件、evidence hash・採用記録の値・FR-LIC-016 開示を照合） |
| `ruff check` / `ruff format --check`（`spikes\models`、repository root から実行） | **All checks passed** / **14 files already formatted** |
| `git diff --check` | **exit 0** |
| `resources/models/manifest.json` SHA-256 | `8918831762cd68decfa62888bd1abd1690090e1fd98779788fdea96989f2d11b`（`ready=false`、`models` 1 件） |

## 9. 敵対的レビューと反映

| レビュー | 指摘 | 反映 |
|---|---|---|
| Phase 0–1（C6 分類） | BLOCKING 2: 精度・installer サイズ未測定のまま承認 / training recipe の保存 copy なし。NON-BLOCKING 2: 性能モードが合否判定しない / 整合 test が浅い | 精度基準を測定前に §3 へ固定して `--mode transfer` で実測、サイズを実測。recipe の issue 本文を保存し evidence に追加。性能モードに合否判定と非ゼロ終了を追加。test に evidence・学習データ・開示文の照合を追加。再レビューで BLOCKING 0、承認の維持は template 違反でないと判定 |
| Phase 1B–3（C6 検出・C7） | BLOCKING 3: SSDLite の性能合格が製品契約でない後処理閾値に依存し manifest で強制できない / detection-base.md 等の現状記述が矛盾 / G2R-20 の依存資料不足。NON-BLOCKING 1: 停止報告なし | SSDLite を保留へ戻し manifest から削除。現状記述を更新。§6 に 49 件の inventory と lock 差分を記録。§7 に停止報告を追加 |
| 反映の再検証 | BLOCKING 3: C6 分類承認後も「承認 0 件」「models 空」とする現状記述が複数残存 / 検出 DP-01 を承認済み weight の parity として完了扱い。NON-BLOCKING 1: §8 が存在しない | 該当 12 箇所（`classification-base.md`、`classification-result.md`、`classification-assist.md`、`assist-result.md`、`detection-result.md`、`detection-checkpoint-parity-result.md`、ADR-0004、`architecture.md`、`documentation-fact-baseline.md`、`implementation-plan.md`）を現状へ更新し、過去時点の記述は時点を明示。DP-01 を未充足へ訂正。本 §8 を追加 |

## 10. 版と CHANGELOG

- 利用者指示に従い、全タスク完了後に `CHANGELOG.md` の `[Unreleased]` へ概要文と Added / Changed の項目を追加した。
- 利用者指示の `hve` / `Markdown query Skill` / `Code Query skill` / `Autonomous Task Graph` のうち、本 repository に package として存在するのは未追跡の `tools/atg`（ATG kit、本作業では変更していない）のみで、他は存在しない。変更対象となった package は root package だけであるため、既存規約（[`20260921-1330-TaskExecutionPlan.md`](20260921-1330-TaskExecutionPlan.md) §6.2）どおり root `package.json` / `package-lock.json` の PATCH を `0.1.5` → `0.1.6` へ 1 つ増やした（`npm version` は `EBADDEVENGINES` で拒否されたため、`version` と `packages[""].version` の 3 箇所を直接更新）。
