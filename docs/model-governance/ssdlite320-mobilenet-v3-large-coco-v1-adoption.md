# モデル採用審査記録 — SSDLite320 MobileNetV3 Large（COCO_V1）

> 本記録は [`adoption-template.md`](adoption-template.md) に従う **C6 検出の採用記録**である。
> 権利層の判定根拠は **repository owner の risk acceptance**（[2026-09-22 記録](evidence/2026-09-22-owner-risk-acceptance.md)）であり、publisher による checkpoint 固有 license statement ではない。この区別は本記録の全節で維持する。

## メタデータ

| 項目 | 値 |
|---|---|
| 審査対象（名称・版） | `SSDLite320 MobileNetV3 Large` / torchvision weights `COCO_V1` |
| カテゴリー | **C6**（Curated Base Weight） |
| タスク種別 | 物体検出 |
| 記録ファイル名 | `docs/model-governance/ssdlite320-mobilenet-v3-large-coco-v1-adoption.md` |
| 記録作成日 | 2026-09-22 |
| 記録作成者 | 実装担当（本 repository の作業者） |
| 調査記録（正本） | [`detection-base.md`](detection-base.md) §14・§15 |

---

## 1. 基本識別情報（FR-LIC-004/014）

| 項目 | 値 |
|---|---|
| 正式名称 | SSDLite320 MobileNetV3 Large（torchvision `ssdlite320_mobilenet_v3_large`） |
| バージョン / タグ | weights enum `SSDLite320_MobileNet_V3_Large_Weights.COCO_V1`（torchvision `0.26.0`） |
| 取得元 URL | `https://download.pytorch.org/models/ssdlite320_mobilenet_v3_large_coco-a79551df.pth` |
| 取得日 | 2026-09-22 |
| checkpoint ファイル名 | `ssdlite320_mobilenet_v3_large_coco-a79551df.pth` |
| build machine 上の検証元パス | `vendor/models/ssdlite320_mobilenet_v3_large_coco-a79551df.pth` |
| checkpoint ファイルサイズ | **`14,069,355` byte** |
| checkpoint SHA-256 | **`a79551df90c79834bcd3bb3845ef9d966b5449a3a9b2833ae8404778ca5d65d2`** |

SHA-256 は本 repository で独立に再計算した値である。先頭 8 桁が publisher の filename suffix `a79551df` と一致する。publisher が完全値を公開している一次資料は確認できていない（[`detection-base.md`](detection-base.md) §14.2）。

---

## 2. コード層審査（C5）

| 項目 | 値 |
|---|---|
| コードリポジトリ URL | `https://github.com/pytorch/vision`（tag `v0.26.0`） |
| コードライセンス（SPDX） | **`BSD-3-Clause`** |
| 商用利用の明示確認 | 確認済み（BSD-3-Clause は商用利用を制限しない） |
| NOTICE ファイルの有無 | あり（`LICENSE`。保存 copy は §7） |
| copyleft / 研究限定 / 非商用条項 | なし |
| 判定（コード層） | **適合** |

> コード層の適合は checkpoint 層の承認を意味しない（FR-LIC-005/015）。本記録の checkpoint 層判定は §3 の risk acceptance に基づく。

---

## 3. Checkpoint 層審査（C6）

| 項目 | 値 |
|---|---|
| checkpoint ライセンス（識別子） | **`LicenseRef-AutoVisionStudio`** |
| 識別子の意味 | SPDX の `LicenseRef-[idstring]` 構文による **repository ローカルの license 参照**。製品名 AutoVision Studio を idstring に用いた。**publisher が発行した license 識別子ではない** |
| ライセンス根拠 | [repository owner の risk acceptance 記録（2026-09-22）](evidence/2026-09-22-owner-risk-acceptance.md)。決定者 **dahatake** |
| 商用利用の明示確認 | **確認済みとして扱う（risk acceptance）**。publisher の明示記載は存在しない |
| 再配布の可否 | **可として扱う（risk acceptance）** |
| 変更・派生物の条件 | 追加条件を設定しない（本 repository の決定範囲） |
| NOTICE 内容 | §5 に全文を記載 |
| copyleft / 研究限定 / 非商用条項 | publisher 由来の条項は確認されていない |
| 判定（checkpoint 層） | **適合（risk acceptance による）** |

**この判定が意味しないこと:** publisher が checkpoint 固有の license statement を発行した事実はない。本 repository が自らの責任で採用を決定したという事実のみを表す。

---

## 4. 学習データ由来審査（C8）

| # | データセット名 | dataset terms URL | terms 取得日 | 商用利用 | 再配布条件 | 帰属表示義務 | 判定 |
|---|---|---|---|---|---|---|---|
| 1 | COCO 2017（`train2017`） | `https://cocodataset.org/#termsofuse` | 2026-09-22 | **可として扱う（risk acceptance）** | annotation は CC BY 4.0 の帰属表示が必要。画像の著作権は COCO Consortium が保有せず Flickr Terms に従う。checkpoint（派生重み）自体の再配布に publisher 由来の追加条件は設定しない | §5 の COCO 帰属表示 | **適合（risk acceptance による）** |

terms 原文（保存 copy、§7）の該当箇所:

> "The annotations in this dataset along with this website belong to the COCO Consortium and are licensed under a Creative Commons Attribution 4.0 License."
> "The COCO Consortium does not own the copyright of the images. Use of the images must abide by the Flickr Terms of Use."

**ImageNet 由来の確認（FR-LIC-006）**

| 項目 | 値 |
|---|---|
| ImageNet 由来の有無 | **不明**。torchvision の当該 recipe は backbone を COCO 学習の中で扱うが、backbone 初期化に ImageNet 事前学習重みが用いられたか否かを確定できる一次資料は確認できていない。2026-09-23 に保存した recipe（§7）の SSDlite 学習コマンドは `--weights-backbone` を含まない（同文書の SSD300 のコマンドは `--weights-backbone VGG16_Weights.IMAGENET1K_FEATURES` を含む）が、`train.py` の既定値を確認していないため、ImageNet 重みを用いなかったことの証明とはしない |
| 法務書面承認状況 | **なし**。[risk acceptance](evidence/2026-09-22-owner-risk-acceptance.md) により本 repository の責任で採用する |

**COCO 由来の確認（FR-LIC-007）**

| 項目 | 値 |
|---|---|
| COCO 由来の有無 | **あり**（weights enum 名 `COCO_V1`、model doc の `box_map (on COCO-val2017) 21.3`） |
| 法務書面承認状況 | **なし**。同上の risk acceptance による |

---

## 5. NOTICE・帰属表示（FR-LIC-002/012）

`THIRD_PARTY_NOTICES` へ追記する内容（C5 / C6 / C8 を分離して記載する）:

```text
AutoVision Studio bundles the object detection model
"SSDLite320 MobileNetV3 Large (COCO_V1)".

[C5] Architecture definition code
    TorchVision (https://github.com/pytorch/vision), BSD 3-Clause License.
    Copyright (c) Soumith Chintala 2016, All rights reserved.
    The full BSD 3-Clause License text is reproduced in this document.

[C6] Checkpoint weights
    File: ssdlite320_mobilenet_v3_large_coco-a79551df.pth
    SHA-256: a79551df90c79834bcd3bb3845ef9d966b5449a3a9b2833ae8404778ca5d65d2
    Source: https://download.pytorch.org/models/ssdlite320_mobilenet_v3_large_coco-a79551df.pth
    The publisher has not issued a checkpoint-specific license statement.
    These weights are bundled under LicenseRef-AutoVisionStudio, a
    repository-local license reference recorded under the risk acceptance of
    the AutoVision Studio repository owner (2026-09-22). This reference does
    not assert any grant by the publisher.
    The manifest fields commercialUseConfirmed, redistributionPermitted and
    commercialDerivativesPermitted are set from that owner decision, not from
    a publisher confirmation (FR-LIC-016).
    Unconfirmed at the time of the decision: the checkpoint-specific license,
    the image-by-image rights of the COCO training images, and whether the
    backbone was initialised from ImageNet-pretrained weights.
    Under the AutoVision Studio model use condition (requirement definition
    v0.7), these weights are bundled for non-commercial research and
    educational purposes only. In this manifest, commercialUseConfirmed and
    commercialDerivativesPermitted denote permission for that use condition,
    not for commercial use (TBD-09).

[C8] Training data
    COCO 2017 (train2017). Annotations (c) COCO Consortium, licensed under
    Creative Commons Attribution 4.0 International (CC BY 4.0),
    https://creativecommons.org/licenses/by/4.0/ .
    The COCO Consortium does not own the copyright of the images; use of the
    images is subject to the Flickr Terms of Use.
```

| 項目 | 内容 |
|---|---|
| アプリ内ライセンス画面への表示文字列 | 上記 NOTICE 全文 |
| NOTICE ファイルの伝播要否 | **要**。installer payload と アプリ内表示の双方へ同一文面を伝播する |
| Apache-2.0 の特許条項確認 | **非該当**（C5 は BSD-3-Clause） |

---

## 6. 安全形式・リモートコード（FR-SEC-007/004/LIC-011）

| 項目 | 値 |
|---|---|
| checkpoint ファイル形式 | **weights-only PT**（`state_dict` のみ、`476` entry） |
| pickle 全体モデルを含まないことの確認 | **確認済み**。`torch.load(weights_only=True)` で load 成功し、`torch.Tensor` と基本型のみで構成されることを確認（[`detection-base.md`](detection-base.md) §14.3） |
| ONNX 外部データ参照 | **非該当**（配布形式は `.pth`） |
| リモートコード実行の要否 | **不要**。構造定義は torchvision の同梱コードのみを使用する |
| `trust_remote_code=True` 相当の使用 | **使用しない** |

---

## 7. 一次資料・証拠ハッシュ（FR-LIC-004/014）

| 資料種別 | URL | 取得日 | 保存コピー場所 | 保存コピー SHA-256 |
|---|---|---|---|---|
| model card 相当（torchvision model documentation） | `https://pytorch.org/vision/0.26/models/generated/torchvision.models.detection.ssdlite320_mobilenet_v3_large.html` | 2026-09-22 | `docs/model-governance/evidence/torchvision-ssdlite320-model-doc-20260922.html` | `a3f29fb8144e7f2f60df7672c56cf9bf418cf94eb444c6c70b4cb8eb2548545e` |
| コードライセンス（C5） | `https://raw.githubusercontent.com/pytorch/vision/v0.26.0/LICENSE` | 2026-09-22 | `docs/model-governance/evidence/torchvision-v0.26.0-LICENSE.txt` | `6502f676851cfe25f8af75531dfb32375b7325b73c37e7b43741fa422893e71d` |
| dataset terms（C8） | `https://cocodataset.org/dataset/termsofuse.htm` | 2026-09-22 | `docs/model-governance/evidence/coco-terms-of-use-20260922.html` | `bd019f88ee44c29b2f19c5b99888cf5bc2e7c16f57b6e52af8ed3a60462e8bdd` |
| 権利判断の根拠書面 | `https://github.com/dahatake/AutoVision-Studio/blob/main/docs/model-governance/evidence/2026-09-22-owner-risk-acceptance.md` | 2026-09-22 | `docs/model-governance/evidence/2026-09-22-owner-risk-acceptance.md` | `baa0b97f48d3fa996cec57a6024f23f0147e04dee99f7ed01c616e723316c402` |
| 採用基準の判断根拠書面（D1） | `https://github.com/dahatake/AutoVision-Studio/blob/main/docs/model-governance/evidence/2026-09-23-owner-rulings.md` | 2026-09-23 | `docs/model-governance/evidence/2026-09-23-owner-rulings.md` | `bcd4c8a55113b88af33c48946b19a486c04e958ad002606d3da1df07edf1eb84` |
| training recipe / script | `https://raw.githubusercontent.com/pytorch/vision/v0.26.0/references/detection/README.md` | 2026-09-23 | `docs/model-governance/evidence/torchvision-v0.26.0-references-detection-README-20260923.md` | `ea3ecad198b6afe8e61f047d7583b2161d07bea04ccaba79d6d7b24753d5f6b7` |
| checkpoint ライセンスファイル | — | — | **存在しない**（publisher 発行の checkpoint 固有 license は確認できていない） | — |

---

## 8. Intended Use / Out-of-Scope Use

| 項目 | 内容 |
|---|---|
| Intended use（一次資料原文） | torchvision model documentation: "SSDlite model architecture with input size 320x320 and a MobileNetV3 Large backbone"、weights `COCO_V1`: "These weights were produced by following a similar training recipe as on the paper."、`box_map (on COCO-val2017) 21.3` |
| Intended use 日本語要約 | 320x320 入力の物体検出。COCO 91 カテゴリ（背景含む）で学習された汎用検出器 |
| Out-of-scope use（一次資料原文） | **記載なし**。torchvision の model documentation には out-of-scope use の節が存在しない（未確認ではなく、資料に節自体が無いことを確認した） |
| Out-of-scope use 日本語要約 | 同上（記載なし） |
| 本製品用途が intended use に含まれるか | **含まれる**。本製品の用途は端末内での物体検出であり、資料が記載する用途の範囲内である |
| 本製品用途が out-of-scope use に該当するか | **該当しない**（記載が存在しない） |
| "deployed use" / "production use" の out-of-scope 記載 | **記載なし** |

---

## 9. タスク仕様・推論定義（NFR-ANN-004）

| 項目 | 値 |
|---|---|
| 対象タスク | 物体検出（box + class + score） |
| 入力形式 | RGB `float32`、値域 `[0,1]`、実測は `320x320` |
| 前処理 | resize（bilinear）後に `[0,1]` 正規化。torchvision の `SSDLite320_MobileNet_V3_Large_Weights.COCO_V1.transforms` 準拠 |
| 出力形式 | `boxes (xyxy)` + `scores` + `labels` |
| スコアの意味・範囲 | クラス確信度、範囲 `0–1`。正解確率ではない |
| 信頼度しきい値の既定値 | 製品の検出後処理は未決定（DP-03）。**§11 の性能合格は torchvision 後処理 `score_thresh=0.05` を前提とする**。`0.05` 未満を採る場合は §11 を再測定する |
| 決定論的推論の保証 | **保証あり**（CPU / DirectML とも 2 回実行で同一出力。§10） |
| 非決定的演算 | 確認されていない。`inferenceConfig` は C6 のため省略する（schema 上 C7 のみ必須） |
| NFR-ANN-004 準拠確認 | **C6 のため補助候補の再現性項目は `N/A（C6）`**。backend 再現性は §10 で実測 |
| seed 設定対象 | `torch.manual_seed`（推論は `torch.no_grad()`、学習を伴わない） |

---

## 10. OS・Execution Provider 互換性（POC-03/08）

| OS | Execution Provider | 動作確認 | 備考 |
|---|---|---|---|
| Windows 11 x64 | DirectML | **合格** | onnxruntime `1.24.4`、`DmlExecutionProvider`。CPU fallback を含みうる |
| Windows 11 x64 | CPU | **合格** | onnxruntime `1.24.4` |
| macOS arm64 | CoreML | **未試験** | Version 1 は Windows x64 のみ（A-07） |
| macOS arm64 | CPU | **未試験** | 同上 |

**ONNX 変換・パリティ（POC-08）** — 実測記録: [`detection-checkpoint-parity-result.md`](../../spikes/models/detection-checkpoint-parity-result.md)

| 項目 | 測定値 | 許容基準 | 判定 |
|---|---|---|---|
| ONNX 変換 | **成功**（opset 17、`onnx.checker` 通過） | 成功必須 | **合格** |
| box 最大絶対差（torch ↔ ORT CPU） | `9.9182e-05` px | ≤ `1.0e-03` | **合格** |
| box 最大絶対差（torch ↔ ORT DirectML） | `1.3733e-04` px | ≤ `1.0e-03` | **合格** |
| box 最大絶対差（ORT CPU ↔ ORT DirectML） | `1.4496e-04` px | ≤ `1.0e-03` | **合格** |
| score 最大絶対差（3 比較の最大） | `6.4075e-07` | ≤ `1.0e-04` | **合格** |
| 検出集合の一致 | 294 件対応付け、片側のみ検出 **0**、label 不一致 **0** | 完全一致 | **合格** |
| 検出 mAP 低下 | **未測定**。本 parity の fixture は COCO ではないため mAP を評価しない | ≤ 0.005 | **未測定** |
| 固定 input shape | `3x320x320` で export | — | — |
| 未対応演算が存在する EP | **確認していない**。DirectML session が CPU fallback を用いた node の有無は測定範囲外 | — | — |

---

## 11. 精度・パフォーマンス・サイズ

実測記録: [`detection-checkpoint-parity-result.md`](../../spikes/models/detection-checkpoint-parity-result.md) §10（2026-09-23、既定後処理、2 回実測）と §11（2026-09-23、`score_thresh=0.05`、2 回実測）

| 指標 | 測定環境 | 測定値 | 採用基準 | 判定 |
|---|---|---|---|---|
| 精度（box mAP） | publisher 記載（COCO-val2017） | `21.3` | 本 repository に COCO val の評価環境がないため基準を置かない | **参考値（本 repository による実測なし）** |
| 精度（対象用途: Fine-Tuning 初期重みとしての eval AP@0.5） | Windows x64 / torch CPU / gwhd-2021 train 15・eval 5 / SPI-16 recipe | 本 checkpoint 初期化 `0.0603`、乱数初期化 `0.0104` | 本 checkpoint 初期化 ≥ 乱数初期化（**測定前に固定**、[実行記録](../../work/20260923-0720-Gate2-TaskExecution.md) §4.2） | **合格** |
| 推論 p95 レイテンシ（CPU EP、既定後処理 `score_thresh=0.001`） | Windows x64 / onnxruntime `1.24.4` / fixture 5 枚 × 20 回 | `179.384` / `198.959` ms | ≤ 100 ms（POC-03） | 不合格（§10）。**C6 の採用判定には用いない（§11.2、D1）** |
| 推論 p95 レイテンシ（CPU EP、`score_thresh=0.05`） | 同上 | `14.331` / `19.210` ms | ≤ 100 ms（POC-03） | **合格（本測定条件）** |
| 推論 p95 レイテンシ（DirectML EP、`score_thresh=0.05`） | 同上 / RTX 4060 Laptop | `29.553` / `27.709` ms | ≤ 100 ms（POC-03） | **合格（本測定条件）** |
| 推論スループット（CPU EP、`score_thresh=0.05`） | 同上 | `83.54` / `65.70` FPS | ≥ 10 FPS（POC-03） | **合格（本測定条件）** |
| 推論スループット（DirectML EP、`score_thresh=0.05`） | 同上 | `40.65` / `41.29` FPS | ≥ 10 FPS（POC-03） | **合格（本測定条件）** |
| ピークメモリ使用量（process の**累積** peak working set、`score_thresh=0.05`） | 同上 | CPU 計測後 `601.8` / `602.2` MB → DirectML 計測後 `763.5` / `761.1` MB | 要求定義に数値基準なし | **測定済み（基準なし）** |
| checkpoint ファイルサイズ | — | `14,069,355` byte（約 13.4 MB） | 要求定義に数値基準なし | **測定済み（基準なし）** |
| installer 追加サイズ寄与（圧縮後） | ZIP Deflate（.NET `CompressionLevel.Optimal`）で本 checkpoint 単体を圧縮 | `13,053,753` byte（約 12.4 MiB） | 要求定義に数値基準なし（R-13） | **測定済み（基準なし）**。installer の圧縮方式は未確定のため PKG phase で再測定する |

### 11.1 測定条件と、この判定が主張しないこと

- 測定は本 repository の spike が export した ONNX（opset 17、preprocess を含む `GeneralizedRCNNTransform` 込み）を、**既定の session option で 1 枚ずつ逐次実行**したものである。warm-up 5 巡の後に 5 枚 × 20 巡 = 100 サンプルを nearest-rank 法で集計した。§11 の合格行は torchvision 後処理の構築引数 `score_thresh=0.05` だけを変えた graph の測定であり、重み bytes と session option は変えていない。score `≥ 0.05` の検出集合が既定閾値と同一であることは parity で確認した（実測記録 §11.2）。
- **ピークメモリは process 全体の累積値である。** 同一 process で CPU → DirectML の順に計測し、`PeakWorkingSetSize` は process 開始以降の最大値で reset されない。したがって DirectML 行は CPU 計測分と、常駐している PyTorch eager model・state_dict を含む。**EP ごとの独立した消費量ではない。**
- **POC-03 の完全条件は未測定である。** capture-to-display レイテンシ、30 分連続実行、10Hz 全フレーム処理、drop 率は、カメラと製品推論の実装（INF phase）が存在しないため測定できない（[requirement-definition.md](../requirement-definition.md) POC-03）。本記録の合格は 1 枚逐次の ONNX Runtime 推論という測定条件での判定に限る。
- 既定後処理（`score_thresh=0.001`）での不合格は取り消さない。製品の検出後処理が `0.05` 未満の閾値を採る場合は再測定する。

### 11.2 C6 に POC-03 の閾値が適用されるかについて

正本には明文の裁定がない。次の 2 通りの読みがあり、本記録は**どちらかを断定しない**。

| 読み | 根拠 | 帰結 |
|---|---|---|
| (i) 適用される | [`adoption-template.md`](adoption-template.md) §11 が C6/C7 とも「最終承認前に対象用途の実測値と採用基準を記録」と定め、表の採用基準欄に `≤ 100 ms（POC-03）` / `≥ 10 FPS（POC-03）` を置いている | 既定後処理（`score_thresh=0.001`）の本 checkpoint は**不適合**。`score_thresh=0.05` では基準を満たすが、その閾値が製品の推論契約として固定されるまでは条件付きの結果にとどまる（§15） |
| (ii) 適用されない | C6 は [`dependency-policy.md`](../dependency-policy.md) §1 で「基盤モデルの学習済み checkpoint」と定義され、製品のリアルタイム推論に使うのは学習後の Model Version（INF）と補助モデル（C7）である | 本 checkpoint の採用基準は学習初期化としての費用（D-15 で実測済み）となり、推論値は参考値 |

**2026-09-23 に読み (ii) を裁定した**（[owner rulings 記録](evidence/2026-09-23-owner-rulings.md) D1。権限者 dahatake の委任を受けた実装担当の判断）。根拠は、要求定義 §5 の定義（Curated Base Weight は初回学習に用いる基盤重み、Model Version は Training Run から生成される学習済みモデル）と FR-INF-001（カメラ推論の対象は成功済み Model Version）である。本表の推論性能の行は参考値として残し、POC-03 / NFR-PERF-004 は INF phase で Model Version の推論経路に対して検証する（緩和しない）。C6 の技術基準は、hash・安全 load・parity（§6・§10）、対象用途の精度（本表）、AutoML budget（D-15）、CVE（§13）である。

---

## 12. 補助 / 手動比較試験（NFR-ANN-006）

**`N/A（C6）`。** 本項目は C7（Annotation Assist Model）のみが対象である。

---

## 13. セキュリティ・脆弱性（NFR-SEC-003/G-DEP-04）

照会先: GitHub Advisory Database（`gh api /advisories?ecosystem=pip&affects=<package>@<version>`、2026-09-23 照会）

| 項目 | 内容 |
|---|---|
| checkpoint 自体の既知 CVE | **該当なし**。checkpoint は数値 tensor の `state_dict` であり、CVE の対象となる実行コードを含まない。load 経路の脆弱性は下欄で扱う |
| load 経路 `torch==2.11.0` | Critical/High **0 件**。`GHSA-53q9-r3pm-6pq6` / CVE-2025-32434（`torch.load(weights_only=True)` の RCE、Critical）は影響範囲 `< 2.6.0` であり **2.11.0 は非該当**。Low 1 件 `GHSA-rrmf-rvhw-rf47` / CVE-2025-3000（`torch.jit.script`、影響範囲 `<= 2.12.1`）が該当する。本記録の load・export 経路は `torch.jit.script` を直接呼ばない |
| `torchvision==0.26.0`、`onnx==1.22.0`、`onnxruntime-directml==1.24.4` | 該当 advisory **0 件** |
| Critical/High CVE への対処 | **非該当**（0 件） |
| 安全 load の実証 | **実施済み**。`weights_only=True` の restricted load に成功（§6） |
| adversarial robustness | **未実施** |

---

## 14. リリースマニフェスト対応付け（FR-LIC-010/NFR-INS-007）

| 項目 | 値 |
|---|---|
| manifest 内の識別子 | `ssdlite320-mobilenet-v3-large-coco-v1`（2026-09-23 登録） |
| SBOM への記録状況 | **未記録**（SBOM 生成は Gate 5 の PKG task） |
| `THIRD_PARTY_NOTICES` への追記 | **未追記**（ファイル自体が未作成。§5 の文面を正とする） |
| build machine 上の検証元パス | `vendor/models/ssdlite320_mobilenet_v3_large_coco-a79551df.pth` |
| installer payload 内のパス | `resources/models/ssdlite320_mobilenet_v3_large_coco-a79551df.pth`（packaging 時の配置先。現時点では未作成で、PKG-01 が検証元から同一 hash / size で配置・検証する） |
| 署名・hash 検証の対象 | **はい**（PKG-01 が `sourcePath` の SHA-256 と byteSize を検証する） |
| lock ファイルへの関連付け | 関連なし |

`releaseStatus.ready` は **`false`** である。本記録は C6 検出 1 役のみを扱い、`ready=true` は 4 役すべての承認と SPI-17 の測定を要する。

---

## 15. 判定・承認（FR-LIC-004/014/G-DEP-07）

| 項目 | 内容 |
|---|---|
| 最終判定 | **承認** |
| 却下・保留の理由 | なし。以下は 2026-09-23 の D1 裁定前の保留理由であり、D1 により C6 の判定基準から外れた: §11 の性能基準（`≤ 100 ms` / `≥ 10 FPS`）を満たすのは torchvision 後処理 `score_thresh=0.05` で再 export した graph だけであり、既定 `score_thresh=0.001` の後処理は不適合のままである。製品の検出後処理閾値は未決定（DP-03）で、manifest schema は C6 entry に推論設定を持たないため、`0.05` を強制できない。強制できない設定を前提に承認すると、利用側が不合格の既定経路を使える。Phase 1B–3 の敵対的レビューの BLOCKING 指摘を受け、実行計画 DQ-03（保守的既定）に従って保留とする |
| 権利層の状態 | **充足**。repository owner **dahatake** の risk acceptance（2026-09-22）。要求定義 v0.7 の製品のモデル利用条件（非商用の研究・教育目的）は、この決定の範囲に含まれる |
| 技術層の状態 | hash・安全 load・CPU / DirectML の出力一致（§6・§10、`score_thresh=0.05` でも全桁一致）、対象用途の精度（§11、AP@0.5 `0.0603` ≥ `0.0104`）、CVE 照会（§13）は**通過**。推論性能は D1 により C6 の判定に用いない（参考値: 既定後処理で不適合、`score_thresh=0.05` で適合） |
| 承認者氏名 | **dahatake**（repository owner / license decision authority。承認権限者）。技術層の採用基準（D1）は、同氏から委任を受けた実装担当が要求定義書に基づいて選んだものである（[owner rulings 記録](evidence/2026-09-23-owner-rulings.md)） |
| 承認日 | **2026-09-23** |
| 決定日 | **2026-09-22**（権利層）／**2026-09-23**（保留判定、再測定、再度の保留判定、D1 裁定、承認） |
| 再審査期限 | 設定なし。配布主体の変更時、torch / torchvision の版変更時、checkpoint bytes の変更時、および INF phase で Model Version の推論経路が POC-03 を満たせないと判明した場合に再審査する |
| 法務確認の要否・状況 | **未実施**。repository owner の risk acceptance で代替した（外部法務の書面判断は存在しない） |
| manifest 登録 | **あり**（2026-09-23、D1 裁定後）。同日に一度再登録し取り消した経緯は [`detection-base.md`](detection-base.md) §15.9・§15.10 |

---

## 16. 記入完了チェックリスト

チェックは記入の完了を示す。未測定・未調査の項目は §10・§11・§13 に明記したとおりである。

### 16.1 ライセンス審査

- [x] 1. コード層ライセンス（`BSD-3-Clause`）を確認し判定を記入した
- [x] 2. checkpoint ライセンス識別子（`LicenseRef-AutoVisionStudio`）と根拠を記入した
- [x] 3. 商用利用・再配布の扱いを記入した（**risk acceptance による充足であり publisher の明示ではない**）
- [x] 4. copyleft / 研究限定 / 非商用条項の有無を記入した
- [x] 5. コードライセンスを根拠に checkpoint を承認していない（§3 の根拠は risk acceptance）

### 16.2 学習データ由来

- [x] 6. 学習データセット（COCO 2017）を列挙し terms を記入した
- [x] 7. ImageNet 由来の有無を記入した（**不明**と記録）
- [x] 8. COCO 由来の有無を記入した（**あり**）
- [x] 9. 法務書面承認が存在しないことと、risk acceptance で代替した事実を記入した

### 16.3 証拠記録

- [x] 10. checkpoint の SHA-256 を独立再計算して記入した
- [x] 11. 正確なファイルサイズを記入した
- [x] 12. 取得日を記入した
- [x] 13. 一次資料 4 件の保存 copy と SHA-256 を記入した（training recipe を 2026-09-23 に追加。checkpoint 固有 license は**存在しない**と記録）

### 16.4 安全形式・リモートコード

- [x] 14. 安全形式（weights-only PT）を確認した
- [x] 15. pickle 全体モデルを含まないことを restricted load で実証した
- [x] 16. リモートコード実行が不要であることを確認した

### 16.5 互換性・性能

- [x] 17. Windows x64 の CPU / DirectML で ONNX 変換と出力一致を実測した
- [x] 18. 対象用途の精度（測定前固定の基準）を確認し、p95 レイテンシ・スループット・メモリ・サイズを測定した（推論性能は D1 により参考値。§11.2）
- [x] 19. 既知 CVE を照会した（Critical/High 0 件。§13）

### 16.6 承認

- [x] 20. 承認者氏名と承認日を記入した（§15）
- [x] 21. manifest の識別子・検証元パス・payload パスを記入した
