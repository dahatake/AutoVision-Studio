# Owner ruling G2D-10 — 2026-09-24

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-24**（回答は 18 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | Gate 2 実行計画 [`202609232120-RemainTaskExecutionPlan.md`](../../../work/202609232120-RemainTaskExecutionPlan.md) §5 の G2D-10「POC-16 の品質・時間以外の条項の検証時期（AC-3）」 |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft |

## 回答の原文

実装担当が Gate 2 の未完了の判断事項と選択肢を提示した後の、権限者の回答（該当行をそのまま転記）:

> G2D-10: A

## 判断

選択肢 **A** を採用する。POC-16 の条項のうち、完全オフライン、CPU / CUDA、installer 同梱、license manifest、候補表示、accept / edit / reject、未確認候補の学習除外は、それぞれの製品機能の受入（AST-01〜07、PKG phase）で検証し、Gate 2 では品質・時間の条項を検証する（Gate 2 計画 §5 の G2D-10 の選択肢 A の文言）。

## 本判断が意味しないこと

1. POC-16 のどの条項も削除・緩和しない。検証の時期を製品機能の受入に置くだけである。
2. Gate 2 で POC-16 のすべての条項を満たしたと記録しない。
3. ほかの所有者判断を含まない。

選択: A

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
