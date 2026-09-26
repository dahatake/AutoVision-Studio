# Owner ruling G2D-07D — 2026-09-24

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-24**（回答は 22 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | Gate 2 実行計画 [`202609232120-RemainTaskExecutionPlan.md`](../../../work/202609232120-RemainTaskExecutionPlan.md) §5 の G2D-07D「検出の gold set と判定基準の承認」 |
| 対象 | [`assist-goldset-plan-detection.md`](../../../spikes/models/assist-goldset-plan-detection.md) SHA-256 `ceea761034b3a6cdab648e40e0bf83267549138e32cf5268bf9a9f9dd12a3ce5` |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft |

## 回答の原文

実装担当が「引き続き必要な判断・作業」の 1 として G2D-07C / G2D-07D（分類 / 検出の gold set と判定基準の案の承認）を提示した後の、権限者の回答（該当行をそのまま転記）:

> 1: 承認します。

## 判断

G2Q-01D の数値案（上の SHA-256 の版）を、修正なしで承認する。同書のすべての案（item 数、被覆の下限、判定式、非劣化の閾値、測定の順序など）と、同書で「所有者の判断事項」とした値（C7 の提案の coverage の下限 0.5、最終品質の指標を IoU 0.5 の F1 とすること、δ = F1 の絶対低下 0.005、scene ごとの閾値を置かないこと、20 item で統計的な検出力を主張しないこと、2 つの session の間隔 24 時間以上）を含む。

## 本判断が意味しないこと

1. G2Q-03D の `confidenceThreshold` / `thresholdPolicy` を選ぶ方針、および閾値の境界（`score >= threshold` と `score > threshold`）の扱いの決定ではない。承認した計画は、model 単体の評価から閾値を選ぶ規則を定めていない。
2. session の記録（G2Q-04D / 05D）を行う判断ではない。
3. C7 を採用・承認し、manifest に登録する判断ではない。

選択: 承認

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。対象の計画を変更する場合は、新しい所有者の判断の記録を作る（同計画 §11）。
