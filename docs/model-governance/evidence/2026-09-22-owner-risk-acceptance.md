# Owner risk acceptance record — 2026-09-22

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner による書面決定の記録） |
| 決定者 | **dahatake**（repository owner / license decision authority） |
| 決定日 | **2026-09-22** |
| 記録者 | 実装担当（本 repository の作業者） |
| 参照 | [`dependency-policy.md`](../../dependency-policy.md) §6.1 / §6.2、[`detection-base.md`](../detection-base.md) §15、[`classification-assist.md`](../classification-assist.md) §19、[`detection-assist.md`](../detection-assist.md) §19 |

---

## 1. 決定の内容

repository owner である **dahatake** は、次の checkpoint について、**publisher による checkpoint 固有 license statement の取得を待たずに、本 repository の責任で採用する**と決定した。

| 区分 | 対象 | 決定日 |
|---|---|---|
| C6 検出（Curated Base Weight） | SSDLite320-MobileNetV3 Large（`ssdlite320_mobilenet_v3_large_coco-a79551df.pth`）、YOLOX-Nano（release `0.1.1rc0`） | 2026-09-22 |
| C7 分類（Annotation Assist Model） | `google/siglip-base-patch16-224` | 2026-09-22 |
| C7 検出（Annotation Assist Model） | `microsoft/Florence-2-base-ft`、Grounding DINO Swin-T（`groundingdino_swint_ogc.pth`）、Grounding DINO Swin-B（`groundingdino_swinb_cogcoor.pth`） | 2026-09-22 |

充足扱いとする gate:

| gate | 内容 |
|---|---|
| checkpoint 固有 license | 商用利用・再配布を確認済みとして扱う |
| 学習データの派生物条件 | 派生モデルの商用利用を確認済みとして扱う |
| NOTICE / 帰属表示 | 本 repository が作成する NOTICE を正とする |

checkpoint 層に記載する license 識別子は **`LicenseRef-AutoVisionStudio`** とする。これは SPDX の `LicenseRef-[idstring]` 構文による **repository ローカルの license 参照**であり、製品名 AutoVision Studio を識別子に用いたものである。

## 2. 本決定が意味しないこと

本決定は gate の**運用状態**を変えるものであり、**一次資料から確認できる事実を変えない**。

1. publisher が対象 checkpoint の **license statement を発行した事実はない**。
2. COCO・WebLI・ODinW 等の **image-by-image / sample-by-sample の権利が確認された事実はない**。
3. **法務（外部弁護士等）の書面判断は存在しない**。本決定は repository owner 自身の risk acceptance である。
4. 各監査記録（`docs/model-governance/*.md`）に記載した一次資料の引用・URL・取得日・SHA-256 は**一切書き換えていない**。
5. 本決定は**権利 gate のみ**を対象とする。技術 gate（完全性照合、安全 load、実行基盤間の一致検証、性能、security）は各記録の実測結果に従う。

## 3. 本決定に基づく登録の条件

権利 gate が充足扱いになっても、次をすべて満たさない checkpoint は [`resources/models/manifest.json`](../../../resources/models/manifest.json) へ登録しない。未実施の試験を合格として記録しないためである。

| 条件 | 出所 |
|---|---|
| `windows-x64/cpu` と `windows-x64/directml` の実行基盤一致検証（実測済みであること） | `manifest.schema.json` `$defs.supportEntry`（`verified` は `const: true`）、ADR-0004 §2.1 |
| 採用記録ファイルの存在（承認者氏名・承認日を含む） | `dependency-policy.md` §6.1 |
| 一次資料の保存 copy と SHA-256 | `dependency-policy.md` §6.1、FR-LIC-004 / FR-LIC-014 |

本決定の時点でこの条件を満たすのは **SSDLite320-MobileNetV3 Large のみ**である。他の checkpoint は一致検証が未実施であり、登録しない。

## 4. 版管理

本文書は証拠として参照されるため、内容を変更する場合は**新しい日付の文書を追加**し、本文書は変更しない。
