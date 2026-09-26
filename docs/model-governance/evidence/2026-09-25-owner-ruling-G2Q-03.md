# Owner ruling G2Q-03 — 2026-09-25

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-25**（回答は 04 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | Gate 2 実行計画 [`202609232120-RemainTaskExecutionPlan.md`](../../../work/202609232120-RemainTaskExecutionPlan.md) §8.12・§8.13 の G2Q-03C / 03D で、gold set 上の model 単体の評価から `confidenceThreshold` / `thresholdPolicy` を選ぶ方針 |
| 方針の定義 | [`20260925-0420-G2Q03-ExecutionPlan.md`](../../../work/20260925-0420-G2Q03-ExecutionPlan.md) §1（SHA-256 `b8c50674dbe7000ab4abebb5fbfdfac9cadabc860d135cd1f8b81e21c7b9905a`） |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft の FR-AST-013 |

## 回答の原文

実装担当が G2Q-03 の閾値の方針の選択肢（A: 分類・検出それぞれ、gold set 上で coverage ≥ 0.5 を満たす閾値のうち、モデル単独の一致率（分類）/ F1（検出、IoU 0.5）が最大のもの。B: 固定値。C: 保留）を提示し、A を推奨した後の、権限者の回答（該当行をそのまま転記）:

> G2Q-03 (A recommended).

## 判断

方針 A を採る（所有者が選んだのは上の A の一文）。

A を一意に計算するため、実装担当が測定の前に次の規約を固定した（定義は上の実行計画 §1。回答の原文はこれらの規約を含まず、所有者の承認の対象でもない。規約を変える場合は新しい所有者の判断を得る）:

1. 境界は `score >= 閾値`（manifest schema の `confidenceThreshold`）。候補は torch の判定用の score（分類は各 item の top-1、検出は全 patch の box）。coverage 0.5 以上の候補のうち指標が最大のものを選び、同じ値なら coverage の大きい方、それも同じなら閾値の小さい方を選ぶ。記録する閾値は、選んだ score と次に小さい候補の score の中点。
2. 分類の「一致率」は、提案（top-1 の score が閾値以上）があった item のうち、提案の label が gold label と一致した割合と解釈する。提案が無い item を不一致に数えると、常に最小の閾値が選ばれ coverage の制約が意味を持たないためである。
3. 検出の F1 は gold set 計画 §5 と同じ形（IoU 0.5 以上、IoU の大きい順に 1 対 1）。
4. 精度の下限は置かない（承認された gold set 計画に無い）。

## 本判断が意味しないこと

1. C7 を採用・承認し、manifest に登録する判断ではない。
2. session の記録（G2Q-04 / 05）を行う判断ではない（所有者の指示で除外中）。
3. 高い score の提案で人の確認を省略する判断ではない（FR-AST-013）。

選択: A

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
