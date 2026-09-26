# Owner rulings — 2026-09-26（OWL-ViT の保留の解除、比較試験を実施対象から削除して完了扱い、正本の修正の許可ほか）

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-26**（回答は 07 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | 前回の報告の「未解決事項」5 件（OWL-ViT の保留、比較試験、集約 `npm test` の失敗、Gate 2 計画の食い違い、正本の記述） |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft |
| 適用の記録 | [`20260926-0815-OwnerRulings5-ExecutionPlan.md`](../../../work/20260926-0815-OwnerRulings5-ExecutionPlan.md) |

## 回答の原文

実装担当が未解決事項を示した後の、権限者の回答（該当行をそのまま転記）:

> 「**OWL-ViT（物体検出の補助モデル）は保留のまま**」/はい。
> 「**比較試験（NFR-ANN-006）はまだ行われていません**」/実施対象から削除して、完了扱いにしてください。
> 「**一括の `npm test` の失敗の原因が分かっていません**」/失敗の原因を調査してください。
> 「**Gate 2 計画の食い違い**」/要求定義と照合して、合理的に正しい方を採用して、適切な修正をしてください。
> 「**正本の記述**」/正本の修正を許可します。

1 行目の「はい」は、前回の報告の問い「2026-09-25 の判断が、2026-09-23 のリスク受容の §4 の 1・2 を変更するかどうか、はい／いいえで回答してください。「はい」なら G2A-02 と G2A-04 を進められます。」への回答である。

## 判断

1. **OWL-ViT:** [2026-09-25 の判断](2026-09-25-owner-ruling-assist-trial-deferral.md)（比較試験を Gate 2 のタスクから外す）は、[2026-09-23 C7 検出 risk acceptance](2026-09-23-owner-risk-acceptance-c7-detection.md) §4 の 1・2 のうち比較試験の後に承認・登録するという部分を変更する。OWL-ViT の採用記録は、ほかの条件を満たせば比較試験の前に承認し、manifest に登録できる。§4 のほかの内容（技術 gate を緩和しない、publisher の grant ではない）と、§3 の条件（研究目的に限る表示、NOTICE）は変えない。
2. **比較試験:** manual-only と assisted の比較試験（NFR-ANN-006、POC-16 の品質・所要時間の部分。Gate 2 計画の G2Q-04C / 04D / 05C / 05D / 06C / 06D）を Version 1 の実施対象から削除し、**未実施のまま完了扱い**にする。試験は行っておらず、品質の非悪化と所要時間の短縮は検証されていない。関連の文書では、この扱いを「免除（未実施）」と略記する。要件の内容を満たしたこと（合格）を意味しない。
3. **集約 `npm test`:** 失敗の原因を調べる（実装担当の作業）。
4. **Gate 2 計画の食い違い:** 実装担当が要求定義と照合して正しい方を選び、修正する。
5. **正本:** 要求定義書・`docs/dependency-policy.md` など正本の文書の修正を許可する。

## 本判断が意味しないこと

1. 比較試験に合格したことを意味しない。`releaseStatus.assistQuality[]` に合格の記録を作らない。
2. 比較試験以外の技術 gate（hash、安全形式、parity、`inferenceConfig`、advisory 照会）と、POC-16 の品質・所要時間以外の条項（[G2D-10](2026-09-24-owner-ruling-G2D-10.md) により製品機能の受入で検証）を免除しない。
3. [2026-09-23 C7 検出 risk acceptance](2026-09-23-owner-risk-acceptance-c7-detection.md) §3.1 の失効条件と、[2026-09-22 risk acceptance](2026-09-22-owner-risk-acceptance.md) §3 の登録の条件を変えない。
4. ほかの所有者判断（TBD-09 の時期 A など）を変えない。

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
