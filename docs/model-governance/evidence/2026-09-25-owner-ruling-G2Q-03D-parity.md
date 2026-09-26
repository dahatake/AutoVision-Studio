# Owner ruling G2Q-03D-T — 2026-09-25

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-25**（回答は 05 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | G2Q-03D（OWL-ViT base patch32 の gold set での検出単位 parity）の判定の組み直し |
| 対策案 | [`20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md`](../../../work/20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md)（SHA-256 `2f32c409c115cbf865cb414d5c57aa83fce888b9e2f7b15bba9498ccaaec7bba`） |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft の POC-08（許容範囲はモデル採用記録に固定する）。数値は FR-TRN-018 から |

## 経緯と回答の原文

1. G2Q-03D の検出単位 parity は、box の px 差（最大 `7.4707e-02` px）が [`detection.py`](../../../spikes/models/detection.py) の `BOX_TOLERANCE`（`1.0e-03` px）を超え `FAIL` だった（[`owlvit-assist-result.md`](../../../spikes/models/owlvit-assist-result.md) §7.3、ATG 実行 `84e8cb29-8aa9-40b6-bcab-411bfae30eff`）。
2. 実装担当がこの判定を所有者に確認したところ、権限者の回答（該当行をそのまま転記）:

   > 許容できません。対策案を立案してください。

3. 実装担当が上の対策案（A〜D、A を推奨）を提示した後の、権限者の回答（該当行をそのまま転記）:

   > 「A」を選択して、タスクを実行して完了させてください。

## 判断

OWL-ViT の goldset mode（G2Q-03D）の検出単位 parity を、次の A1〜A3 で判定する。px の box 差は記録するが判定に使わない。

| ID | 判定 | 数値の出典 |
|---|---|---|
| A1 | 生出力 `logits` と `pred_boxes`（入力に対する相対座標）の両方を、3 比較それぞれで `np.allclose(rtol=1e-3, atol=1e-4)` | FR-TRN-018 の生 tensor の既定値 |
| A2 | 検出集合の一致。画像ごとの件数、IoU `≥ 0.99` での 1 対 1 の対応（対応のない検出 0）、label 不一致 0、score 差 `≤ 1e-4` | SPI-16 以来の既存の定数（[`detection.py`](../../../spikes/models/detection.py) の `MATCH_IOU`・`SCORE_TOLERANCE`） |
| A3 | backend ごとに、その backend 自身の box と score から gold set の F1（IoU 0.5 以上、IoU の大きい順に 1 対 1）を計算し、ONNX Runtime の 2 backend それぞれで `abs(F1_backend − F1_torch) ≤ 0.005` | **新しい基準**。0.005 は FR-TRN-018 の検出の値（mAP@[0.50:0.95] の絶対低下）と、G2D-07D の F1 の非劣化幅（assisted と manual の比較の値）を類推で借りた |

所有者の選択 A は、対策案 §3・§4 の A の全体（上の A1〜A3、式、F1 を指標とすること）を対象とする。

## 注記（fail-closed の記録）

1. **後付けの基準変更である。** 本判断は、§7.3 の `FAIL` を見た後に判定を組み直すものである。§7.3 の記録と、main4 の G2Q-03D の `failed` は変更しない。
2. 変えるのは OWL-ViT の goldset mode の判定だけである。共有の [`detection_checkpoint_parity.compare`](../../../spikes/models/detection_checkpoint_parity.py) と `BOX_TOLERANCE` を使う他の経路（SSDlite、Grounding DINO、基盤重み、OWL-ViT の parity mode）の判定は変えない。
3. 再測定で A1〜A3 のいずれかを満たさない場合は `FAIL` として記録し、判定はそれ以上変えない。

## 本判断が意味しないこと

1. C7 を採用・承認し、manifest に登録する判断ではない。
2. session の記録（G2Q-04 / 05）を行う判断ではない（所有者の指示で除外中）。
3. 閾値の方針（[`2026-09-25-owner-ruling-G2Q-03.md`](2026-09-25-owner-ruling-G2Q-03.md)）を変える判断ではない。

選択: A

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。