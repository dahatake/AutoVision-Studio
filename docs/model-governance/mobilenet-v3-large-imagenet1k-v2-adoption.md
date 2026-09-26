# モデル採用審査記録 — MobileNetV3 Large（IMAGENET1K_V2）

> 本記録は [`adoption-template.md`](adoption-template.md) に従う **C6 分類の採用記録**である。
> 権利層の判定根拠は **repository owner の risk acceptance**（[2026-09-23 記録](evidence/2026-09-23-owner-risk-acceptance.md) の artifact A）であり、publisher による checkpoint 固有 license statement ではない（FR-LIC-016）。この区別は本記録の全節で維持する。

## メタデータ

| 項目 | 値 |
|---|---|
| 審査対象（名称・版） | `MobileNetV3 Large` / torchvision weights `IMAGENET1K_V2` |
| カテゴリー | **C6**（Curated Base Weight） |
| タスク種別 | 画像分類 |
| 記録ファイル名 | `docs/model-governance/mobilenet-v3-large-imagenet1k-v2-adoption.md` |
| 記録作成日 | 2026-09-23 |
| 記録作成者 | 実装担当（本 repository の作業者） |
| 調査記録 | [`classification-base.md`](classification-base.md) §3・§12、[`work/20260923-0546-RelaxedLicenseModelSurvey.md`](../../work/20260923-0546-RelaxedLicenseModelSurvey.md) §3.1 |
| 実測記録 | [`spikes/models/classification-checkpoint-result.md`](../../spikes/models/classification-checkpoint-result.md) |

---

## 1. 基本識別情報（FR-LIC-004/014）

| 項目 | 値 |
|---|---|
| 正式名称 | MobileNetV3 Large（torchvision `mobilenet_v3_large`） |
| バージョン / タグ | weights enum `MobileNet_V3_Large_Weights.IMAGENET1K_V2`（torchvision `0.26.0`、`DEFAULT` alias ではなく enum 名で固定） |
| 取得元 URL | `https://download.pytorch.org/models/mobilenet_v3_large-5c1a4163.pth` |
| 取得日 | 2026-09-23 |
| checkpoint ファイル名 | `mobilenet_v3_large-5c1a4163.pth` |
| build machine 上の検証元パス | `vendor/models/mobilenet_v3_large-5c1a4163.pth` |
| checkpoint ファイルサイズ | **`22,132,113` byte**（2026-09-22 の HEAD 記録 [`classification-base.md`](classification-base.md) §3.1 と一致） |
| checkpoint SHA-256 | **`5c1a416349c4cf298f2a6a5e2600ed0ee55e604713578f5e74e6bc8bcaef7997`** |

SHA-256 は本 repository で独立に計算した値である。先頭 8 桁が publisher の filename suffix `5c1a4163` と一致する。publisher は 64 桁の完全値を公開していない（[`classification-base.md`](classification-base.md) §3.1）。

---

## 2. コード層審査（C5）

| 項目 | 値 |
|---|---|
| コードリポジトリ URL | `https://github.com/pytorch/vision`（tag `v0.26.0`） |
| コードライセンス（SPDX） | **`BSD-3-Clause`** |
| 商用利用の明示確認 | 確認済み（BSD-3-Clause は商用利用を制限しない） |
| NOTICE ファイルの有無 | `NOTICE` file なし。BSD license 本文の伝播義務あり（保存 copy は §7） |
| copyleft / 研究限定 / 非商用条項 | なし |
| 判定（コード層） | **適合** |

> コード層の適合は checkpoint 層の承認を意味しない（FR-LIC-005/015）。

---

## 3. Checkpoint 層審査（C6）

| 項目 | 値 |
|---|---|
| checkpoint ライセンス（識別子） | **`LicenseRef-AutoVisionStudio`** |
| 識別子の意味 | SPDX `LicenseRef-[idstring]` 構文による **repository ローカルの license 参照**。**publisher が発行した license 識別子ではない** |
| ライセンス根拠 | [repository owner の risk acceptance 記録（2026-09-23）](evidence/2026-09-23-owner-risk-acceptance.md) artifact A。決定者 **dahatake** |
| 商用利用の明示確認 | **確認済みとして扱う（risk acceptance）**。publisher の明示記載は存在しない |
| 製品のモデル利用条件（非商用の研究・教育目的、要求定義 v0.7）での利用 | **適合として扱う**。2026-09-23 の risk acceptance は商用利用を含む範囲で決定されており、非商用の研究・教育目的での利用はその範囲に含まれる。v0.7 以降、本重みを同梱する配布物は非商用の研究・教育目的に限って提供し、manifest の `productUsePermitted` / `productDerivativesPermitted` はこの利用条件での許可を表す（TBD-09） |
| 再配布の可否 | **可として扱う（risk acceptance）** |
| 変更・派生物の条件 | 追加条件を設定しない（本 repository の決定範囲） |
| NOTICE 内容 | §5 に全文を記載 |
| copyleft / 研究限定 / 非商用条項 | checkpoint に適用される publisher 由来の条項は確認されていない（学習データ ImageNet の terms は §4） |
| 判定（checkpoint 層） | **適合（risk acceptance による）** |

---

## 4. 学習データ由来審査（C8）

| # | データセット名 | dataset terms URL | terms 取得日 | 商用利用 | 再配布条件 | 帰属表示義務 | 判定 |
|---|---|---|---|---|---|---|---|
| 1 | ImageNet-1K（ILSVRC-2012） | `https://www.image-net.org/download.php` | 2026-09-23 | **可として扱う（risk acceptance）**。v0.7 の製品のモデル利用条件（非商用の研究・教育目的）は terms の目的の範囲に収まる | ImageNet の terms は Database の利用者に対する条件であり、派生重みの再配布条件を記載しない。本 repository は派生重みに追加条件を設定しない | §5 の ImageNet 記載 | **適合（risk acceptance による）** |

terms 原文（保存 copy、§7）の該当箇所:

> "Researcher shall use the Database only for non-commercial research and educational purposes."

**ImageNet 由来の確認（FR-LIC-006）**

| 項目 | 値 |
|---|---|
| ImageNet 由来の有無 | **あり**（weights metadata `_metrics` の `ImageNet-1K`、`categories = _IMAGENET_CATEGORIES`） |
| 法務書面承認状況 | **なし**。FR-LIC-006 が許容する repository license decision authority の書面承認（FR-LIC-016 の risk acceptance）で代替した |

**COCO 由来の確認（FR-LIC-007）**

| 項目 | 値 |
|---|---|
| COCO 由来の有無 | **公開 recipe・metadata に記載なし**（metadata は ImageNet-1K のみ。独立 provenance audit は行っていない） |
| 法務書面承認状況 | 不要（記載なしのため） |

---

## 5. NOTICE・帰属表示（FR-LIC-002/012）

`THIRD_PARTY_NOTICES` へ追記する内容（C5 / C6 / C8 を分離して記載する）:

```text
AutoVision Studio bundles the image classification base weights
"MobileNetV3 Large (IMAGENET1K_V2)".

[C5] Architecture definition code
    TorchVision (https://github.com/pytorch/vision), BSD 3-Clause License.
    Copyright (c) Soumith Chintala 2016, All rights reserved.
    The full BSD 3-Clause License text is reproduced in this document.

[C6] Checkpoint weights
    File: mobilenet_v3_large-5c1a4163.pth
    SHA-256: 5c1a416349c4cf298f2a6a5e2600ed0ee55e604713578f5e74e6bc8bcaef7997
    Source: https://download.pytorch.org/models/mobilenet_v3_large-5c1a4163.pth
    The publisher has not issued a checkpoint-specific license statement.
    These weights are bundled under LicenseRef-AutoVisionStudio, a
    repository-local license reference recorded under the risk acceptance of
    the AutoVision Studio repository owner (2026-09-23). This reference does
    not assert any grant by the publisher.
    The manifest fields productUsePermitted, redistributionPermitted and
    productDerivativesPermitted are set from that owner decision, not from
    a publisher confirmation (FR-LIC-016).
    Unconfirmed at the time of the decision: the checkpoint-specific license,
    whether the ImageNet terms of access extend to weights trained on
    ImageNet, and the image-by-image rights of the ImageNet training images.
    Under the AutoVision Studio model use condition (requirement definition
    v0.7), these weights are bundled for non-commercial research and
    educational purposes only. In this manifest, productUsePermitted and
    productDerivativesPermitted denote permission for that use condition,
    not for commercial use (TBD-09).

[C8] Training data
    ImageNet-1K (ILSVRC-2012). The ImageNet terms of access limit use of the
    Database to non-commercial research and educational purposes
    (https://www.image-net.org/download.php). The training images are not
    redistributed with AutoVision Studio.
```

| 項目 | 内容 |
|---|---|
| アプリ内ライセンス画面への表示文字列 | 上記 NOTICE 全文 |
| NOTICE ファイルの伝播要否 | **要**。installer payload とアプリ内表示の双方へ同一文面を伝播する |
| Apache-2.0 の特許条項確認 | **非該当**（C5 は BSD-3-Clause） |

---

## 6. 安全形式・リモートコード（FR-SEC-007/004/LIC-011）

| 項目 | 値 |
|---|---|
| checkpoint ファイル形式 | **weights-only PT**（`state_dict` のみ、`312` entry） |
| pickle 全体モデルを含まないことの確認 | **確認済み**。`torch.load(weights_only=True)` で load し、`load_state_dict(strict=True)` が missing / unexpected なしで成功（実測記録 §2） |
| ONNX 外部データ参照 | **非該当**（配布形式は `.pth`） |
| リモートコード実行の要否 | **不要**。構造定義は torchvision の同梱コードのみ。runtime download は行わず、`weights=None` で構築してから local file を load する |
| `trust_remote_code=True` 相当の使用 | **使用しない** |

---

## 7. 一次資料・証拠ハッシュ（FR-LIC-004/014）

| 資料種別 | URL | 取得日 | 保存コピー場所 | 保存コピー SHA-256 |
|---|---|---|---|---|
| model card 相当（torchvision model documentation） | `https://pytorch.org/vision/0.26/models/generated/torchvision.models.mobilenet_v3_large.html` | 2026-09-23 | `docs/model-governance/evidence/torchvision-mobilenet-v3-large-model-doc-20260923.html` | `1bbb88943fcb6b184b80f49a516ebad942b8d51337fa943c7e54dc545872e909` |
| weights metadata（source） | `https://raw.githubusercontent.com/pytorch/vision/v0.26.0/torchvision/models/mobilenetv3.py` | 2026-09-23 | `docs/model-governance/evidence/torchvision-v0.26.0-mobilenetv3-source-20260923.txt` | `5444909362734ab54f07ba64cd2d54e90854965d4d1ce6b2b337e055d0fcbb3e` |
| コードライセンス（C5） | `https://raw.githubusercontent.com/pytorch/vision/v0.26.0/LICENSE` | 2026-09-22 | `docs/model-governance/evidence/torchvision-v0.26.0-LICENSE.txt` | `6502f676851cfe25f8af75531dfb32375b7325b73c37e7b43741fa422893e71d` |
| dataset terms（C8） | `https://www.image-net.org/download.php` | 2026-09-23 | `docs/model-governance/evidence/imagenet-terms-of-access-20260923.html` | `275647ff587098083f5c53ccf5aa07a4732ca08b81822964c88e5ab40ad07ad4` |
| 権利判断の根拠書面 | `https://github.com/dahatake/AutoVision-Studio/blob/main/docs/model-governance/evidence/2026-09-23-owner-risk-acceptance.md` | 2026-09-23 | `docs/model-governance/evidence/2026-09-23-owner-risk-acceptance.md` | `d9e5053be5f53fbc15292b826955382519d33d8163ffb0794f764eb1dce344bf` |
| training recipe（weights metadata の `recipe` が指す issue 本文。見出し `new-recipe-with-reg-tuning` と MobileNetV3 Large `Acc@1 75.274` を含む） | `https://api.github.com/repos/pytorch/vision/issues/3995`（HTML: `https://github.com/pytorch/vision/issues/3995#new-recipe-with-reg-tuning`） | 2026-09-23 | `docs/model-governance/evidence/torchvision-issue-3995-recipe-20260923.json` | `353d7f7887e552c879aa6d7d00b402ac0c37aa1591a0a75b5a4f7268d6e81436` |
| checkpoint ライセンスファイル | — | — | **存在しない** | — |

---

## 8. Intended Use / Out-of-Scope Use

| 項目 | 内容 |
|---|---|
| Intended use（一次資料原文） | weights metadata `IMAGENET1K_V2._docs`: "These weights improve marginally upon the results of the original paper by using a modified version of TorchVision's new training recipe."、`categories = _IMAGENET_CATEGORIES`、`_metrics` `ImageNet-1K` `acc@1 75.274` |
| Intended use 日本語要約 | ImageNet-1K の 1000 クラス画像分類器。構造と重みは torchvision の分類 model として提供される |
| Out-of-scope use（一次資料原文） | **記載なし**（torchvision の model documentation と weights metadata に out-of-scope use の節が存在しないことを確認した） |
| 本製品用途が intended use に含まれるか | **含まれる**。本製品での用途は端末内の画像分類モデルを学習する際の初期重みであり、資料が示す画像分類の範囲内である |
| 本製品用途が out-of-scope use に該当するか | **該当しない**（記載が存在しない） |
| "deployed use" / "production use" の out-of-scope 記載 | **記載なし** |

---

## 9. タスク仕様・推論定義（NFR-ANN-004）

| 項目 | 値 |
|---|---|
| 対象タスク | 画像分類（logits → softmax / top-k） |
| 入力形式 | RGB、`1x3x224x224`、`float32` |
| 前処理 | `IMAGENET1K_V2.transforms()`: bilinear resize 232、center crop 224、`[0,1]` 変換、ImageNet mean `(0.485,0.456,0.406)` / std `(0.229,0.224,0.225)` |
| 出力形式 | 1000 ImageNet category logits（製品 Fine-Tuning 時は分類 head を project class 数へ置換する。置換手順は TRN phase で確定） |
| スコアの意味・範囲 | `N/A（C6）`。C6 は学習初期化用であり、利用者へ score を表示しない |
| 信頼度しきい値の既定値 | `N/A（C6）` |
| 決定論的推論の保証 | **保証あり（実測範囲）**。CPU / DirectML とも同一入力の反復推論が bit 一致（実測記録 §4） |
| 非決定的演算 | 確認されていない。`inferenceConfig` は C6 のため省略する（schema 上 C7 のみ必須） |
| seed 設定対象 | `torch.manual_seed(20260922)`（推論は `torch.no_grad()`、学習を伴わない） |

---

## 10. OS・Execution Provider 互換性（POC-03/08）

| OS | Execution Provider | 動作確認 | 備考 |
|---|---|---|---|
| Windows 11 x64 | DirectML | **合格** | onnxruntime-directml `1.24.4`、`DmlExecutionProvider`。CPU fallback を含みうる |
| Windows 11 x64 | CPU | **合格** | onnxruntime `1.24.4` |
| macOS arm64 | CoreML / CPU | **未試験** | Version 1 は Windows x64 のみ（A-07） |

**ONNX 変換・パリティ（POC-08）** — 実測記録: [`classification-checkpoint-result.md`](../../spikes/models/classification-checkpoint-result.md) §4

| 項目 | 測定値 | 許容基準 | 判定 |
|---|---|---|---|
| ONNX 変換 | **成功**（opset 17、固定 shape、`onnx.checker` 通過） | 成功必須 | **合格** |
| logit 最大絶対差（3 比較の最大） | `1.3113e-05` | ≤ `1.0e-04` | **合格** |
| softmax 最大絶対差（3 比較の最大） | `1.6391e-06` | ≤ `1.0e-05` | **合格** |
| top-1 / top-5 集合の一致 | 15/15 / 15/15（3 比較とも） | 全件一致 | **合格** |
| 分類精度低下 | **未測定**（fixture は ImageNet ではない） | — | **未測定** |

---

## 11. 精度・パフォーマンス・サイズ

実測記録: [`classification-checkpoint-result.md`](../../spikes/models/classification-checkpoint-result.md) §5・§7（2026-09-23、性能 3 回実測、各 300 サンプル）

| 指標 | 測定環境 | 測定値 | 採用基準 | 判定 |
|---|---|---|---|---|
| 精度（ImageNet-1K acc@1） | publisher 記載 | `75.274` | 本 repository に ImageNet val set が無いため基準を置かない | **参考値（本 repository による実測なし）** |
| 精度（対象用途: Fine-Tuning 初期重みとしての eval top-1） | Windows x64 / torch CPU / beans train 45・eval 15 / SPI-15 recipe | 本 checkpoint 初期化 `5/15`、乱数初期化 `5/15` | 本 checkpoint 初期化 ≥ 乱数初期化（**測定前に固定**、[実行記録](../../work/20260923-0720-Gate2-TaskExecution.md) §3） | **合格**。ただし両者とも偶然水準（1/3）であり、**初期重みの有益性は示していない**（実測記録 §7） |
| 推論 p95 レイテンシ（CPU EP） | Windows x64 / onnxruntime `1.24.4` / fixture 15 枚 × 20 回 | `22.588` / `34.779` / `12.870` ms | ≤ 100 ms（POC-03） | **合格（本測定条件）** |
| 推論 p95 レイテンシ（DirectML EP） | 同上 / RTX 4060 Laptop | `2.356` / `2.220` / `2.091` ms | ≤ 100 ms（POC-03） | **合格（本測定条件）** |
| 推論スループット（CPU EP） | 同上 | `98.50` / `65.16` / `175.04` FPS | ≥ 10 FPS（POC-03） | **合格（本測定条件）** |
| 推論スループット（DirectML EP） | 同上 | `615.88` / `625.08` / `675.38` FPS | ≥ 10 FPS（POC-03） | **合格（本測定条件）** |
| ピークメモリ使用量（process 累積 peak working set） | 同上 | CPU 後 `502.2`〜`505.7` MB → DirectML 後 `724.5`〜`735.4` MB | 要求定義に数値基準なし | **測定済み（基準なし）** |
| checkpoint ファイルサイズ | — | `22,132,113` byte（約 21.1 MB） | 要求定義に数値基準なし | **測定済み（基準なし）** |
| installer 追加サイズ寄与（圧縮後） | ZIP Deflate（.NET `CompressionLevel.Optimal`）で本 checkpoint 単体を圧縮 | `20,464,302` byte（約 19.5 MiB） | 要求定義に数値基準なし（R-13 は圧縮・事前サイズ表示を求めるのみ） | **測定済み（基準なし）**。installer の圧縮方式は未確定のため、実 installer での寄与は PKG phase で再測定する |

- POC-03 の完全条件（capture-to-display、30 分連続、10Hz 全フレーム、drop 率）は INF phase が無いため未測定である。本記録の合格は [`ssdlite320-mobilenet-v3-large-coco-v1-adoption.md`](ssdlite320-mobilenet-v3-large-coco-v1-adoption.md) §11 と同じ測定条件（1 枚逐次の ONNX Runtime 推論）での判定に限る。
- メモリは process 全体の累積値で、常駐する PyTorch eager model を含む。

---

## 12. 補助 / 手動比較試験（NFR-ANN-006）

**`N/A（C6）`。** 本項目は C7 のみが対象である。

---

## 13. セキュリティ・脆弱性（NFR-SEC-003/G-DEP-04）

照会先: GitHub Advisory Database（`gh api /advisories?ecosystem=pip&affects=<package>@<version>`、2026-09-23 照会）

| 項目 | 内容 |
|---|---|
| checkpoint 自体の既知 CVE | **該当なし**。checkpoint は数値 tensor の `state_dict` であり、CVE の対象となる実行コードを含まない。load 経路の脆弱性は下欄で扱う |
| load 経路 `torch==2.11.0` | Critical/High **0 件**。`GHSA-53q9-r3pm-6pq6` / CVE-2025-32434（`torch.load(weights_only=True)` の RCE、Critical）は影響範囲 `< 2.6.0` であり **2.11.0 は非該当**。Low 1 件 `GHSA-rrmf-rvhw-rf47` / CVE-2025-3000（`torch.jit.script` の memory corruption、影響範囲 `<= 2.12.1`）が該当する。本記録の load・export 経路は `torch.jit.script` を直接呼ばない |
| `torchvision==0.26.0`、`onnx==1.22.0`、`onnxruntime-directml==1.24.4` | 該当 advisory **0 件** |
| Critical/High CVE への対処 | **非該当**（0 件） |
| adversarial robustness | **未実施** |

---

## 14. リリースマニフェスト対応付け（FR-LIC-010/NFR-INS-007）

| 項目 | 値 |
|---|---|
| manifest 内の識別子 | `mobilenet-v3-large-imagenet1k-v2` |
| SBOM への記録状況 | **未記録**（SBOM 生成は Gate 5 の PKG task） |
| `THIRD_PARTY_NOTICES` への追記 | **未追記**（ファイル自体が未作成。§5 の文面を正とする） |
| build machine 上の検証元パス | `vendor/models/mobilenet_v3_large-5c1a4163.pth` |
| installer payload 内のパス | `resources/models/mobilenet_v3_large-5c1a4163.pth`（packaging 時の配置先。現時点では未作成で、PKG-01 が検証元から同一 hash / size で配置・検証する） |
| 署名・hash 検証の対象 | **はい**（PKG-01 が `sourcePath` の SHA-256 と byteSize を検証する） |
| lock ファイルへの関連付け | 関連なし（torchvision は既存 lock の直接依存） |

---

## 15. 判定・承認（FR-LIC-004/014/G-DEP-07）

| 項目 | 内容 |
|---|---|
| 最終判定 | **承認** |
| 却下・保留の理由 | なし |
| 権利層の状態 | **充足（risk acceptance）**。publisher の checkpoint license statement は存在しない |
| 技術層の状態 | hash・安全 load・CPU / DirectML の出力一致（§6・§10）、性能と対象用途の精度（§11）、CVE 照会（§13）が**すべて測定前に固定した基準を通過**。§11 の精度は「乱数初期化より悪くない」ことのみを示し、有益性は示していない |
| 承認者氏名 | **dahatake**（repository owner / license decision authority） |
| 承認日 | **2026-09-23** |
| 承認の経緯 | 承認者が 2026-09-23 に「不明点はデフォルトのプランを採用」と指示し、実行計画 DQ-01 / DQ-02 と G2R-11 の DoD（性能・parity 合格時のみ Approved）を採用した。本判定はその DoD の充足を記録するものである |
| 再審査期限 | 設定なし。配布主体の変更、torchvision / torch の版変更、checkpoint bytes の変更時に再審査する |
| 法務確認の要否・状況 | **未実施**。FR-LIC-016 の risk acceptance で代替した（外部法務の書面判断は存在しない） |
| manifest 登録 | 登録する。`releaseStatus.ready` は `false` のまま（Gate 2 は 4 役すべての承認を要する） |

---

## 16. 記入完了チェックリスト

### 16.1 ライセンス審査

- [x] 1. コード層ライセンス（`BSD-3-Clause`）を確認し判定を記入した
- [x] 2. checkpoint ライセンス識別子（`LicenseRef-AutoVisionStudio`）と根拠を記入した
- [x] 3. 商用利用・再配布の扱いを記入した（**risk acceptance による充足であり publisher の明示ではない**）
- [x] 4. copyleft / 研究限定 / 非商用条項の有無を記入した
- [x] 5. コードライセンスを根拠に checkpoint を承認していない

### 16.2 学習データ由来

- [x] 6. 学習データセット（ImageNet-1K）と terms を記入した
- [x] 7. ImageNet 由来の有無を記入した（**あり**）
- [x] 8. COCO 由来の有無を記入した（公開 metadata に記載なし）
- [x] 9. 法務書面承認が存在しないことと、risk acceptance で代替した事実を記入した

### 16.3 証拠記録

- [x] 10. checkpoint の SHA-256 を独立計算して記入した
- [x] 11. 正確なファイルサイズを記入した
- [x] 12. 取得日を記入した
- [x] 13. 一次資料の保存 copy と SHA-256 を記入した（training recipe の issue 本文を含む。checkpoint 固有 license は**存在しない**と記録）

### 16.4 安全形式・リモートコード

- [x] 14. 安全形式（weights-only PT）を確認した
- [x] 15. pickle 全体モデルを含まないことを restricted load で実証した
- [x] 16. リモートコード実行が不要であることを確認した

### 16.5 互換性・性能

- [x] 17. Windows x64 の CPU / DirectML で ONNX 変換と出力一致を実測した
- [x] 18. 対象用途の精度（測定前固定の基準）、p95 レイテンシ ≤ 100 ms・スループット ≥ 10 FPS を CPU / DirectML で確認し、メモリ・サイズを測定した
- [x] 19. 既知 CVE を照会した（Critical/High 0 件）

### 16.6 承認

- [x] 20. 承認者氏名と承認日を記入した
- [x] 21. manifest の識別子・検証元パス・payload パスを記入した
