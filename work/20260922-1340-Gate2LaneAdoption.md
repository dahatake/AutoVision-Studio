# Gate 2 lane — 利用者指示による採用処理と再測定（作業記録）

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書（実行記録） |
| 作成日時 | 2026-09-22 13:40 |
| 対象指示 | 利用者の G2-01〜G2-08 への個別指示（2026-09-22 13:40 JST） |
| 正本 | [`docs/implementation-plan.md`](../docs/implementation-plan.md)、[`docs/adr/0004-spike-decisions.md`](../docs/adr/0004-spike-decisions.md)、`docs/model-governance/*.md` |
| 先行記録との関係 | [`20260921-1330-TaskExecutionPlan.md`](20260921-1330-TaskExecutionPlan.md) の「Gate 2 lane 実行記録」（1 回目）を、**`G2-01` / `G2-02` / `G2-03` / `G2-04` / `G2-06` / `G2-07` / `G2-08` について本記録が更新する**。1 回目の記録は当時の事実として保持し、書き換えない。`G2-05` と `G2-09` の判定は変わらない |
| 実行 host | Windows `10.0.29671` / `AMD64` / CPython `3.14.7` / `NVIDIA GeForce RTX 4060 Laptop GPU`（driver `616.92`、CUDA UMD `13.4`） |

---

## 0. 指示と実在物の差異

| 指示された参照先 | 調査結果 | 本作業での扱い |
|---|---|---|
| `/hve-dev/requirement-definition.md` | `hve-dev/` は存在しない。実在する要求定義は [`docs/requirement-definition.md`](../docs/requirement-definition.md)（v0.5 Draft、245 要求）のみ | 実在する `docs/requirement-definition.md` を参照した。これは既存の D-01 / Q-01 の決定と一致する |
| `hve` / `Markdown query Skill` / `Code Query skill` / `Autonomous Task Graph` の各パッケージ | いずれも本 repository に存在しない。`package.json` は root の 1 件のみ（`node_modules` を除く） | 版更新は本 repository の既存規約（[実行計画 §6.2](20260921-1330-TaskExecutionPlan.md)）に従い root `package.json` / `package-lock.json` の PATCH を対象とした |

---

## 1. 利用者の指示と実行結果

| ID | 指示 | 実行結果 |
|---|---|---|
| G2-01 | DINOv2 を諦め、別候補（Apache-2.0 で学習データも公開されている重み）を再調査 | 再調査を実施（§6） |
| G2-02 | SSDLite320-MobileNetV3 と YOLOX-Nano を採用 | controlled retrieval と技術検証を実行。**権利 gate は 2026-09-22 の利用者決定により充足**（§3.4）。manifest 登録は DP-03 / DP-04 待ち |
| G2-03 | SigLIP を採用 | 同上（§3） |
| G2-04 | 全て採用（Florence-2-base-ft、Grounding DINO Swin-T / Swin-B） | 同上（§3） |
| G2-06 | 選択肢 2（学習を延長して再測定） | **FAIL → PASS**（§2） |
| G2-07 | 段階 3（実作業 session）はスキップ | `SKIPPED_BY_USER` として記録。PASS へ読み替えない（§5） |
| G2-08 | G-1 新規依存採用 / G-2 このPCで測定 / 3 実データ規模はスキップ | CPU・CUDA 両方を実測し D-15 を更新（§4） |

---

## 2. G2-06 — 検出 parity（選択肢 2）

学習 epoch だけを変えて同一手順を 3 条件で実測した。fixture・seed・許容差・比較方法はすべて同一である。

| epochs | 最終 epoch 平均 loss | 検出 score の全体幅 | 未対応検出（torch / ONNX） | IoU 対応付け | AP@0.5 の絶対差 | 判定 |
|---:|---:|---:|---:|---:|---:|---|
| 6 | `6.268291` | `0.013195` | 27 / 32 | 595 | `9.350e-05` | FAIL |
| 20 | `2.487874` | `0.058056` | 2 / 1 | 441 | `2.405e-07` | FAIL |
| **60** | `0.145245` | `0.944691` | **0 / 0** | 236 | `0.0` | **PASS** |

- IoU 対応付け済みの box 最大差は 3 条件とも `3.0518e-05` px で変わらない。**演算の移植精度は最初から一貫して高く、FAIL は検出の順位が定まらないことだけが原因**だったと本 fixture 上で確定した。
- 既定 epoch を 60 へ変更した。`--epochs 6` で旧条件を再現できる。
- 60 epoch 条件で 2 回実行し、ONNX SHA-256 `190a38ab672d54849b51161f60b66bde1d23cd7cbe956aa7bf548da4e8d17975` を含む全指標が一致した。
- **一般化しない。** 承認済み weight・他データ・他の後処理設定で同じになるとは測定していない。

---

## 3. G2-02 / G2-03 / G2-04 — 採用指示と controlled retrieval

### 3.1 取得した artifact（`vendor/models/`、Git 追跡外）

| artifact | byte size | 実測 SHA-256 | publisher metadata |
|---|---:|---|---|
| `ssdlite320_mobilenet_v3_large_coco-a79551df.pth` | `14,069,355` | `a79551df90c79834bcd3bb3845ef9d966b5449a3a9b2833ae8404778ca5d65d2` | 完全値なし（prefix のみ） |
| `yolox_nano.pth`（release `0.1.1rc0`） | `7,694,953` | `cd28f55fbbc1829f99d9ac9b38a16d259a22889739c8728ea877610201feff7b` | `digest: null` |
| `yolox_nano.pth`（`storage` `0.0.1`、比較用） | `7,653,737` | `12dcd5009b7e5ae78e3d6035a5b186af503711407e2ddf0f86abdf78b253b77d` | 同上 |
| `siglip-base-patch16-224` `model.safetensors` | `812,672,320` | `2c63cb7d1f2e95ba501893cbb8faeb4ea9a3af295498d35097126228659c2af8` | **一致** |
| `Florence-2-base-ft` `model.safetensors` | `463,221,266` | `58757d657ff44051314c8030b68e04cb1bb618ca9a4885418f111f6fb708185a` | **一致** |
| `groundingdino_swint_ogc.pth` | `693,997,677` | `3b3ca2563c77c69f651d7bd133e97139c186df06231157a64c507099c52bc799` | `digest: null` |
| `groundingdino_swinb_cogcoor.pth` | `938,057,991` | `46270f7a822e6906b655b729c90613e48929d0f2bb8b9b76fd10a856f3ac6ab7` | 同上 |

byte size は 7 件すべて既存監査の記録と一致した。

### 3.2 解消した blocker

| 内容 | 結果 |
|---|---|
| SSDLite の完全 SHA-256 が `UNKNOWN` | **確定**。再計算値の先頭 8 桁が filename の `a79551df` と一致した |
| YOLOX / Grounding DINO の SHA-256 が `unknown` | **本調査の取得 bytes について確定**。publisher 署名値ではないため、再取得の照合基準として位置づけた |
| YOLOX の 2 つの同名 asset の関係が `UNKNOWN` | **別 checkpoint と確定**。`start_epoch` が `291` と `294`、model tensor 642 件中 **538 件の値が相違**（例 `backbone.C3_n3.conv1.bn.bias` の最大絶対差 `0.6569799184799194`）。形式変換ではなく別の学習 snapshot |
| `.pth` の safe load が `NOT_RUN`（FR-SEC-007 blocked） | **restricted load 成功**。5 件すべて `weights_only=True` で load でき、`torch.Tensor` と基本型のみで構成されることを確認 |
| safetensors の payload 未検査 | **header 解析完了**。SigLIP は tensor 408 件 / `F32`、Florence-2 は 666 件 / `F16`。`__metadata__` は `{"format": "pt"}` のみ |

### 3.3 manifest を更新できない構造的理由

[`resources/models/manifest.schema.json`](../resources/models/manifest.schema.json) の `$defs.spdxLicense` は次を強制する。

- `spdx`: `unknown` / `NOASSERTION` / `NONE` / `TBD` / `PENDING` / `MISSING` / `NOT_RUN` / `UNCONFIRMED` / `HOLD` / `BLOCKED` / `REJECTED` / `N/A` を pattern で**拒否**
- `commercialUseConfirmed`: `"const": true`
- `redistributionPermitted`: `"const": true`
- `$defs.licenseSet` は `code` / `checkpoint` / `trainingData` の 3 層すべて必須

6 候補はいずれも **checkpoint 固有 license が publisher から発行されていない**。entry を作るには C5 コードの license（TorchVision `BSD-3-Clause`、YOLOX / Big Vision `Apache-2.0`）を checkpoint 層へ書き、`commercialUseConfirmed` を `true` にする以外にない。それは各監査の self-adversarial review が**最大のリスクとして特定した「code license = checkpoint license」の混同そのもの**であり、schema（A-07、回帰 35 件 PASS）が構造的に防いでいる。

**よって `resources/models/manifest.json` は未編集とした。** 利用者の採用指示は各監査文書へ記録し、checkpoint 固有 license が得られた時点で entry を作成できる状態にした。

### 3.4 G2-02 の権利 gate — 利用者決定による充足設定（2026-09-22 15:33 JST）

利用者（repository license decision authority）が **「`G2-02` の権利 gate は後で自分が対応する。ここでは充足したと設定せよ」** と指示した。これを **risk acceptance** として [`detection-base.md`](../docs/model-governance/detection-base.md) §15 に記録し、SPI-12 の権利 gate を**充足扱い**とした。

| 項目 | 内容 |
|---|---|
| 決定者 / 決定日 | 利用者（license decision authority） / 2026-09-22 |
| 対象 | SSDLite320-MobileNetV3 Large、YOLOX-Nano（release `0.1.1rc0`） |
| 充足扱いとした項目 | DB-L1（checkpoint 固有 license）、DB-L2（商用・再配布）、DB-C8（COCO 画像権利）、DB-N1（NOTICE packet） |
| 根拠書面 | **未提出**（利用者が後日対応） |
| 対象外 | DB-T1（YOLOX の exact source commit・preprocess）は**技術 provenance** の項目であり未解消のまま |

**本決定が意味しないこと:** publisher が checkpoint 固有 license statement を発行した事実はなく、COCO の image-by-image 権利も未確認、法務の書面判断も存在しない。一次資料の引用・hash・取得日は一切書き換えていない。

**manifest entry を作成しない理由は権利ではなく技術・記録要因へ移った。**

| 要因 | 現状 |
|---|---|
| `support[]` の parity 検証（A-07 が cpu / directml の 2 件を必須、`verified` は `const: true`） | **本 checkpoint に対する parity は CPU・DirectML とも未実施**（DP-01 / DP-04）。§3.2 で実測したのは hash と安全 load だけで、推論も ONNX export も行っていない |
| `approval.recordPath` と `evidence`、`dependency-policy.md` §6.1 の採用記録 | **SSDLite / YOLOX の採用記録ファイルが未作成**。NOTICE 文案も未作成。承認者**氏名**も未記載 |
| `licenses.checkpoint.spdx` と `noticeText` に書く値 | risk acceptance が供給するのは判断であり、**license 識別子と NOTICE 本文は利用者から未提示** |
| `releaseStatus.ready=true` の 4 役要求 | 本決定は **C6 検出 1 役のみ**が対象。他 3 役は未充足 |

`inferenceConfig` は C7 のときだけ schema 必須であり、C6 の `G2-02` では**省略可**である。したがって DP-03（製品の検出後処理の未確定）は entry 作成の阻害要因ではない。

> §3.3 の「checkpoint 固有 license が得られた時点で entry を作成できる状態にした」は、**G2-02 については本項により置き換わる**。G2-03 / G2-04 については §3.3 のとおりである。

---

## 4. G2-08 — AutoML 予算（CPU / CUDA）

### 4.1 実測値

| device | 実行回数 | 1 trial 最小 | 1 trial 中央値 | 1 trial 最大 | study 合計 |
|---|---:|---:|---:|---:|---:|
| CPU（`torch 2.11.0+cpu`、thread `1`） | 4 | 2.016〜3.889 秒 | 2.462〜5.133 秒 | **7.768 秒** | 24.326〜42.699 秒 |
| CUDA（`torch 2.11.0+cu130`、RTX 4060 Laptop） | 3 | 0.562〜0.601 秒 | 1.053〜2.128 秒 | **4.353 秒** | 14.077〜16.380 秒 |

study の管理 overhead は CPU `0.041` 秒 / CUDA `0.035` 秒。全 trial の eval accuracy は `0.3333`（3 クラスの偶然水準）であり、**探索品質の根拠には使わない**。

### 4.2 決定した budget

| device | 最大 Trial 数 | 最大時間 | 算出根拠 |
|---|---:|---:|---|
| CPU | 20 | **180 秒** | 実測最大 trial `7.768` 秒 × 20 = `155.4` 秒 を上回る 60 秒単位の切り上げ |
| CUDA | 20 | **120 秒** | 実測最大 trial `4.353` 秒 × 20 = `87.1` 秒 を上回る 60 秒単位の切り上げ |

**実データ規模への外挿を根拠にしていない。**

### 4.3 依存採用（G-1）と製品 lock

`torch==2.11.0+cu130` / `torchvision==0.26.0+cu130` を **repository 外の隔離環境**へ導入して測定した。製品 lock（`ml/pyproject.toml`・`ml/uv.lock`）は**変更していない**。

製品の推論 provider は A-07 で `windows-x64/cpu` と `windows-x64/directml` の 2 件に固定されており CUDA を含まない。学習（TRN）phase は Gate 4 で未着手である。使用予定が確定していない段階で数 GB の CUDA runtime を製品 lock と installer へ入れるのは YAGNI 違反にあたるため、製品同梱の可否は TRN phase で判断する。

### 4.4 未決定として残した範囲

- 検出の budget（TRN 実装が未着手で学習 1 回分の費用を確定できない）
- 実データ規模（数千枚）の budget — **利用者指示によりスキップ**
- DirectML 学習（`onnxruntime-directml` は推論専用）

---

## 5. G2-07 — 段階 3 の `SKIPPED_BY_USER`

利用者指示により、gold set に対する補助あり／手作業のみの実作業 session の記録をスキップした。

- 既存規約（`SPI-03` / `SPI-09` / `SPI-19` の前例）に従い **`SKIPPED_BY_USER` を `PASS` へ読み替えない**。
- coverage / accept / edit / reject / 所要時間は**未取得のまま**とし、推定値で補わない。
- NFR-ANN-006（manual-only と assisted の比較で品質を悪化させず時間を短縮すること）は**出荷条件のまま未充足**である。
- harness と入力形式は保持し、条件が揃えばそのまま実施できる状態にした。

---

## 6. G2-01 — 分類 Base Weight の再調査

利用者指示により DINOv2 を候補から除外し、**Apache-2.0 等の permissive license かつ学習データも公開**という条件で候補 8 件を一次資料付きで再調査した（調査日・全 URL 取得日 **2026-09-22**）。全文は [`docs/model-governance/classification-base.md`](../docs/model-governance/classification-base.md) §12 に記録した。

### 6.1 結論

**「checkpoint 固有 license の明示」と「学習データが公開かつ商用許諾」の両方が同時に揃う候補は 0 件だった。**

| 区分 | 該当 | 状態 |
|---|---|---|
| A. データが明確かつ**商用許諾あり** | PASS 事前学習（CC BY 4.0、Zenodo `6615455`、1,439,589 枚） | データ側は明確。**checkpoint license 未確認**、完全 SHA-256 も未提供 |
| B. データが明確だが**非商用研究限定** | timm 3 件 / `microsoft/resnet-50` / `google/vit-base-patch16-224` / `facebook/convnext-tiny-224` / ONNX Model Zoo MobileNetV2 | ImageNet terms が商用不可の方向に明確 |
| C. データが非公開 | SigLIP（WebLI） | 本指示の要件を満たさない |
| D. card が deployed use を除外 | LAION / DataComp 版 CLIP | 既存の OpenAI CLIP 除外と同一根拠 |

### 6.2 決定的な一次資料

- **ImageNet access terms**（`https://www.image-net.org/download.php`、取得 2026-09-22）: "Researcher shall use the Database only for **non-commercial research and educational purposes**." 派生 weight に関する条項は**存在しない**（許諾とも禁止とも書かれていない）。
- **timm publisher 自身の警告**（`https://raw.githubusercontent.com/huggingface/pytorch-image-models/v1.0.20/README.md`、取得 2026-09-22）: Apache-2.0 を "The code here" に限定した上で「**元データセットの license が重みに適用されると想定すべき**。商用製品に使うなら法的助言を求めよ」と明記。HF repository の `license: apache-2.0` タグと**反対方向の記載**であり、両者を解決する publisher 文書は確認できなかった。
- 調査対象の HF repository には **独立した `LICENSE` ファイルが 1 件も存在しなかった**。

### 6.3 判定

本再調査で承認できた分類 C6 は **0 件**。`G2-01` の DoD は 8 候補すべてについて満たした上で **`HOLD` を保持**する結果となった。

---

## 7. 実行した検証

| 検証 | 結果 |
|---|---|
| `ruff check` / `ruff format --check`（`spikes\models`） | exit 0 / exit 0 |
| `node scripts\docs\verify-documentation.mjs` | exit 0 |
| `node scripts\release\verify-product-version.mjs` | exit 0 |
| `node --test scripts\models\manifest-schema.test.mjs` | 35 passed / 0 failed |
| `git diff --check` | exit 0 |
| `resources/models/manifest.json` の SHA-256 | `7fe41f5bc497d48ffcbbaebaeb5cb02e91dfba0e1a6fe9b66d8cf8928c437a61`（不変） |

途中で発生した失敗も記録する。

- PyPI（`files.pythonhosted.org`）への直接アクセスが TLS handshake で失敗した。承認済み proxy `https://packagefeedproxy.microsoft.io/pypi/simple/` を既定 index にし、torch/torchvision のみ `--no-deps` で PyTorch 公式 index から取得して解決した。
- 検出学習は batch 2 のとき端数 batch 1 件で BatchNorm が失敗していた（前回実行時に batch 3 へ変更済み）。

---

## 8. 本作業で変更していないもの

- `resources/models/manifest.json`（未編集）
- `ml/pyproject.toml`、`ml/uv.lock`、`package-lock.json` の依存内容
- Gate 1 部の `CONDITIONAL_GO`、`SPI-03` / `SPI-09` / `SPI-19` の `SKIPPED_BY_USER`、Gate 3 の判定、UIR-017 の本人確認
- `AST` / `TRN` / `REP` / `INF` の実装（Gate 2 未解除のため未着手）
