# Owner ruling G2D-06 — 2026-09-24

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-24**（回答は 18 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | Gate 2 実行計画 [`202609232120-RemainTaskExecutionPlan.md`](../../../work/202609232120-RemainTaskExecutionPlan.md) §5 の G2D-06「OWL-ViT の risk acceptance §3.2 の確認・署名」 |
| 対象 | [`2026-09-23-owner-risk-acceptance-c7-detection.md`](2026-09-23-owner-risk-acceptance-c7-detection.md) §3.2「採用時の確認」 |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft |

## 回答の原文

実装担当が Gate 2 の未完了の判断事項と選択肢を提示した後の、権限者の回答（該当行をそのまま転記）:

> G2D-06: 署名する（§1〜§3 を確認済み）

## 判断

**署名する**。決定者は、risk acceptance の文書 §1〜§3 の artifact・未確認項目・条件を確認済みである（回答の括弧内）。同文書 §3.2 の定めにより、署名は artifact D（OWL-ViT）の採用記録を「承認」とする時点に、採用記録に対して行う。

## 本判断が意味しないこと

1. 採用記録（[`owlvit-base-patch32-adoption.md`](../owlvit-base-patch32-adoption.md)）を承認したことを意味しない。採用記録の承認は、技術 gate と補助品質の比較試験（NFR-ANN-006 / POC-16）の結果の後に行う（同文書 §4 の 1・2）。
2. risk acceptance の文書の内容（失効条件、狭い制限、NOTICE）を変えない。
3. ほかの所有者判断を含まない。

選択: 署名する

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
