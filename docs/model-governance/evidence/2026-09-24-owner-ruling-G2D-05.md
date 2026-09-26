# Owner ruling G2D-05 — 2026-09-24

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-24**（回答は 18 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | Gate 2 実行計画 [`202609232120-RemainTaskExecutionPlan.md`](../../../work/202609232120-RemainTaskExecutionPlan.md) §5 の G2D-05「C7 の組み合わせ」 |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft |

## 回答の原文

実装担当が Gate 2 の未完了の判断事項と選択肢を提示した後の、権限者の回答（該当行をそのまま転記）:

> G2D-05: A

## 判断

選択肢 **A** を採用する。C7 の組み合わせは、分類 SigLIP base、検出 OWL-ViT B/32 とする（Gate 2 計画 §5 の G2D-05 の選択肢 A の文言。いずれも取得・parity 測定済み）。

## 本判断が意味しないこと

1. C7 を採用・承認し、manifest に登録する判断ではない。採用は各採用記録の技術 gate、OWL-ViT の risk acceptance の確認（G2D-06）、補助品質の比較試験（POC-16）の結果による。
2. ほかの候補（TinyCLIP、Grounding DINO、OmDet-Turbo、MobileCLIP-S0）の評価を変えない。
3. ほかの所有者判断を含まない。

選択: A

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
