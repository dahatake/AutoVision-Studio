# Owner ruling G2D-01 — 2026-09-24

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-24**（回答は 18 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | Gate 2 実行計画 [`202609232120-RemainTaskExecutionPlan.md`](../../../work/202609232120-RemainTaskExecutionPlan.md) §5 の G2D-01「C7 の性能の採用基準（S1）」 |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft |

## 回答の原文

実装担当が Gate 2 の未完了の判断事項と選択肢を提示した後の、権限者の回答（該当行をそのまま転記）:

> G2D-01: A

## 判断

選択肢 **A** を採用する（Gate 2 計画 §5 の G2D-01 の選択肢 A の文言）。C7 の採用判定に POC-03 の 100 ms / 10 FPS を適用せず、POC-16（AC-3 の中央所要時間の短縮）で判定する。CPU / DirectML の p95・FPS は測定値として記録する。NFR-ANN-003 は製品の assist 実装の要件として AST phase で検証し、緩和しない。

## 本判断が意味しないこと

1. NFR-ANN-003 と POC-03 の要件を変更・緩和しない。POC-03 はカメラ推論の基準として従来どおり適用する。
2. C7 を採用・承認する判断ではない。採用は採用記録の技術 gate と POC-16 の比較試験の結果による。
3. ほかの所有者判断を含まない。

選択: A

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
