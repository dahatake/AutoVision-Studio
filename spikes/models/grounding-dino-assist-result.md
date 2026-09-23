# G2R-32 — C7 検出 Assist Model（Grounding DINO tiny）の backend parity

| 項目 | 値 |
|---|---|
| タスク | Gate 2 残タスク `G2R-32`（C7 検出 Annotation Assist Model の技術 gate） |
| 実行日 | 2026-09-23 |
| 実行 host | Windows `10.0.29671` / `AMD64` / CPython `3.14.7`、NVIDIA GeForce RTX 4060 Laptop GPU |
| 対象 script | [`grounding_dino_assist_parity.py`](grounding_dino_assist_parity.py) |
| 実行環境 | **隔離 spike venv** `vendor/models/_spike/venv`（Git 追跡外）: torch `2.11.0+cpu`、transformers `5.17.0`、onnx `1.22.0`、onnxruntime-directml `1.24.4`。製品 lock は変更していない |
| parity 判定 | **FAIL**（3 比較すべて。exit code `1`） |
| 性能 | **測定しない**（§6） |

---

## 1. 本結果が主張しないこと

1. **本 checkpoint が ONNX 化できないことを確定しない。** 本書は TorchScript 系 exporter（`dynamo=False`）と最小限の export 時置換で得た graph が一致しなかった事実だけを記録する。`dynamo=True` exporter、opset の変更、transformers 以外の実装は試していない。
2. **精度・品質の主張ではない。** prompt `wheat head.` と gwhd-2021 fixture は backend 比較にのみ使う。

## 2. 対象

| 項目 | 値 |
|---|---|
| model | Hugging Face `IDEA-Research/grounding-dino-tiny`、revision `a2bb814dd30d776dcf7e30523b00659f4f141c71`。**GitHub release の `groundingdino_swint_ogc.pth` とは別 artifact** |
| `model.safetensors` | `689,359,096` byte、SHA-256 `1a2412ef99bd74bcd3c2a246fa1e48581f8889a1300c9051974741314fc042f3`（2026-09-23 取得。本 repository の独立計算が HF API の LFS metadata と一致） |
| 読み込み | `GroundingDinoForObjectDetection.from_pretrained(local_files_only=True, use_safetensors=True)`。`config.json` の `architectures` は `GroundingDinoForObjectDetection`（transformers 本体の実装）で、remote code を実行していない |
| 入力 | gwhd-2021 末尾 5 枚、processor 出力 `pixel_values 1x3x800x800`、text `1x5` |
| export | `torch.onnx.export(dynamo=False)`、opset 17、固定 shape。ONNX `693,317,591` byte、SHA-256 `d0ddd9b20d607487bdae34f3c4762c4970895d22f5d6a9f1694c6e51ce9857bf`、`onnx.checker` 通過 |
| 比較 | [`detection_checkpoint_parity.compare`](detection_checkpoint_parity.py) を再利用（score `≥ 0.05`、IoU `≥ 0.99` 対応付け、box `1.0e-03` / score `1.0e-04`）。score は query ごとの text token sigmoid 最大値、box は `cxcywh` を入力画素の `xyxy` へ変換 |

## 3. export を通すまでの経過（最小修正）

| 試行 | 結果 | 対処 |
|---|---|---|
| 1 | exporter が `aten::isin` の opset 17 symbolic を持たず失敗 | — |
| 2 | 同 `aten::cummax` で失敗 | — |
| 3 | export は成功したが、ONNX Runtime が bool 型 `EyeLike` の kernel を持たず session 作成に失敗 | 上記 3 op はすべて transformers の `generate_masks_with_special_tokens_and_transfer_map`（`input_ids` から text attention mask を作る関数）の中にあるため、**export 中だけ**その関数を等価な実装 `exportable_text_masks` に差し替えた。fixture の `input_ids` で原関数と出力が完全一致することを script 内で検査している |
| 4 | ONNX Runtime が `GridSample(16)` の kernel を見つけられず失敗。deformable attention の sampling grid が exporter によって float64 型になっていた（eager の PyTorch は float32） | export 後の graph で float64 の grid 入力 24 箇所に float32 への `Cast` を挿入 |
| 5 | session 作成・推論が成功。**parity FAIL**（§4） | — |

## 4. Parity 実測値

| 比較 | 対応付け | 片側のみ（左 / 右） | label 不一致 | box 最大差 | score 最大差 | 判定 |
|---|---:|---:|---:|---:|---:|---|
| torch ↔ onnxruntime-cpu | 7 | 355 / 273 | 4 | `5.2118` px | `0.7260` | **FAIL** |
| torch ↔ onnxruntime-directml | 9 | 353 / 272 | 5 | `5.2122` px | `0.7260` | **FAIL** |
| onnxruntime-cpu ↔ onnxruntime-directml | 256 | 24 / 25 | 6 | `4.4687` px | `8.2059e-03` | **FAIL** |

- torch の検出件数（score `≥ 0.05`）は 5 枚で計 362 件、score 範囲 `0.0502`〜`0.7858`。
- torch ↔ ONNX の検出件数は **export に使った 1 枚目だけが一致**し、2〜5 枚目は一致しない（例: 2 枚目 torch `93` / CPU `68`）。
- 同一 session の反復推論は CPU・DirectML とも bit 一致した（非決定性ではない）。

## 5. 観測から言えること・言えないこと

| 観測 | 解釈の範囲 |
|---|---|
| export 入力の 1 枚目だけ件数が一致する | TorchScript trace が入力依存の値を定数として焼き込んだ可能性と整合する（trace 時に `TracerWarning: Converting a tensor to a Python boolean` が多数出た）。**どの箇所が原因かは特定していない** |
| 同じ graph の CPU ↔ DirectML でも 24〜25 件が対応しない | trace の問題とは別に、EP 間の数値差が query 選択（two-stage の top-k）で増幅されている可能性がある。**原因は特定していない** |

## 6. 性能を測定しない理由

parity が FAIL の graph は eager model と等価でないため、その latency は本 checkpoint の推論 latency ではない。等価でない graph の測定値を採用記録へ載せると誤読を招くため、測定しない。

## 7. 帰結

実行計画 §6 の停止条件 3（「ONNX export / DirectML parity が未対応 op で失敗し、最小修正でも解決しない」）に該当する。DQ-08 に従い **manifest に登録しない**。採用記録 [`grounding-dino-tiny-adoption.md`](../../docs/model-governance/grounding-dino-tiny-adoption.md) は **保留**とする。再開には、`dynamo=True` exporter の評価など、本書の範囲を超える技術作業が必要である。
