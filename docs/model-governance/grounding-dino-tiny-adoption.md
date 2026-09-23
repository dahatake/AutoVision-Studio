# モデル採用審査記録 — Grounding DINO tiny（HF transformers 版、C7 検出）

> 本記録は [`adoption-template.md`](adoption-template.md) に従う **C7 検出の採用記録**である。最終判定は **保留**であり、manifest に登録しない。
> 権利層は repository owner の risk acceptance（[2026-09-23 記録](evidence/2026-09-23-owner-risk-acceptance.md) の artifact B）により充足扱いであり、publisher の checkpoint license statement ではない（FR-LIC-016）。GitHub release 版（`groundingdino_swint_ogc.pth`、[`detection-assist.md`](detection-assist.md)）とは**別 artifact** である。

## メタデータ

| 項目 | 値 |
|---|---|
| 審査対象 | Hugging Face `IDEA-Research/grounding-dino-tiny`、revision `a2bb814dd30d776dcf7e30523b00659f4f141c71` |
| カテゴリー / タスク | **C7**（Annotation Assist Model）/ 物体検出（open-vocabulary） |
| 記録作成日 | 2026-09-23 |
| 実測記録 | [`spikes/models/grounding-dino-assist-result.md`](../../spikes/models/grounding-dino-assist-result.md) |

## 1. 基本識別情報

| 項目 | 値 |
|---|---|
| 取得元 URL | `https://huggingface.co/IDEA-Research/grounding-dino-tiny/resolve/a2bb814dd30d776dcf7e30523b00659f4f141c71/model.safetensors` |
| 取得日 | 2026-09-23 |
| `model.safetensors` | `689,359,096` byte、SHA-256 `1a2412ef99bd74bcd3c2a246fa1e48581f8889a1300c9051974741314fc042f3`（本 repository の計算が HF API の LFS metadata と一致） |
| 付属 file（同 revision） | `config.json` `eec82c5ab66e16df12a9a212e68ac011779927c2536cf9078658e35d85f0c67a`、`preprocessor_config.json` `8454179ba95e2ad22947835aad7b45862a601fc0055ab88bf1ee70892d3aea60`、`tokenizer.json` `d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66`、`tokenizer_config.json` `d40ab645b68211910b9170d22433d43186a6ec8ee6fd10ba170524b25bf4fb56`、`special_tokens_map.json` `b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3`、`added_tokens.json` `909e96cb32d92ce728a01bc99850cbba26196d74115c17ebeb019275412588f2`、`vocab.txt` `07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3` |
| 選択しなかった file | `pytorch_model.bin`（pickle 形式） |

## 2〜4. ライセンス三層（C5 / C7 / C8）

| 層 | 状態 |
|---|---|
| C5 code | transformers `5.17.0` の `GroundingDinoForObjectDetection`（Apache-2.0）。**transformers は製品 lock に未採用** |
| C7 checkpoint | `LicenseRef-AutoVisionStudio`（risk acceptance、2026-09-23）。card の `license: apache-2.0` タグは checkpoint 層の許諾表明とみなさない |
| C8 training data | **model card に記載なし**。GitHub 版 Swin-T の学習データ（O365、GoldG、Cap4M）と同一かは未確認。risk acceptance の未確認項目として開示済み |

## 6. 安全形式・リモートコード

| 項目 | 値 |
|---|---|
| 形式 | **safetensors** |
| remote code | **不要**（`config.json` の `architectures` は transformers 本体の `GroundingDinoForObjectDetection`） |

## 7. 一次資料・証拠ハッシュ（2026-09-23 取得）

| 資料 | URL | 保存コピー | SHA-256 |
|---|---|---|---|
| model card（revision 固定） | `https://huggingface.co/IDEA-Research/grounding-dino-tiny/resolve/a2bb814dd30d776dcf7e30523b00659f4f141c71/README.md` | `docs/model-governance/evidence/grounding-dino-tiny-model-card-a2bb814d-20260923.md` | `cf46f74c7b6850f1d5cbe406028324d8798148726016d46a69a365b4a2d3e89f` |
| HF API metadata（LFS SHA-256） | `https://huggingface.co/api/models/IDEA-Research/grounding-dino-tiny?blobs=true` | `docs/model-governance/evidence/grounding-dino-tiny-hf-api-20260923.json` | `390d7c4dbc3d911eadc8eaad907a274a5aab13fc8027e924d42f3a790b2317fb` |
| 権利判断の根拠書面 | — | `docs/model-governance/evidence/2026-09-23-owner-risk-acceptance.md` | `d9e5053be5f53fbc15292b826955382519d33d8163ffb0794f764eb1dce344bf` |

## 8. Intended Use / Out-of-Scope Use

| 項目 | 内容 |
|---|---|
| Intended use（原文、保存 copy） | "You can use the raw model for zero-shot object detection (the task of detecting things in an image out-of-the-box without labeled data)." |
| Out-of-scope use | **記載なし** |
| 製品用途（検出候補の提示）が intended use に含まれるか | **含まれる** |

## 10. OS・Execution Provider 互換性

| 項目 | 測定値 | 許容基準 | 判定 |
|---|---|---|---|
| ONNX 変換 | 成功（opset 17、`dynamo=False`、export 時のみ text mask 関数を等価実装へ差替え、sampling grid 24 箇所へ float32 Cast を挿入） | 成功必須 | 合格 |
| torch ↔ ORT CPU | 対応付け 7、片側のみ 355 / 273、box 差 `5.21` px | box ≤ `1.0e-03`、片側のみ 0 | **不合格** |
| torch ↔ ORT DirectML | 対応付け 9、片側のみ 353 / 272 | 同上 | **不合格** |
| ORT CPU ↔ ORT DirectML | 対応付け 256、片側のみ 24 / 25、box 差 `4.47` px | 同上 | **不合格** |

## 11. 性能

**測定しない。** parity 不合格の graph は eager model と等価でなく、その latency は本 checkpoint の値ではない（実測記録 §6）。

## 12. 補助 / 手動比較試験（NFR-ANN-006）

**未実施。**

## 13. セキュリティ

GitHub Advisory Database（2026-09-23 照会）で `transformers==5.17.0`、`safetensors==0.8.0`、`tokenizers==0.23.2`、`huggingface-hub==1.31.0` の該当 advisory は **0 件**。`torch==2.11.0` は Low 1 件（`GHSA-rrmf-rvhw-rf47`）のみ。

## 15. 判定

| 項目 | 内容 |
|---|---|
| 最終判定 | **保留** |
| 保留の理由 | §10 の parity が 3 比較とも不合格。実行計画 §6 の停止条件 3 に該当する。§11・§12 も未実施、transformers の依存採用判断も未実施 |
| 権利層 | 充足（risk acceptance、2026-09-23、決定者 dahatake）。本保留は権利判断を取り消さない |
| 再審査の条件 | `dynamo=True` exporter 等で eager と一致する graph を得ること。その後に §11・§12 を実施 |
