# Owner ruling G2D-04 — 2026-09-24

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-24**（回答は 18 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | Gate 2 実行計画 [`202609232120-RemainTaskExecutionPlan.md`](../../../work/202609232120-RemainTaskExecutionPlan.md) §5 の G2D-04「session の記録手段（S4）」 |
| 選択肢の出典 | G2T-40 の調査結果 [`20260924-0730-AssistSessionRecording.md`](../../../work/20260924-0730-AssistSessionRecording.md) の候補 1〜4 と「実装しない」 |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft |

## 回答の原文

実装担当が Gate 2 の未完了の判断事項と選択肢を提示した後の、権限者の回答（該当行をそのまま転記）:

> G2D-04: 候補1

## 判断

**実装する**。方式は G2T-40 の調査結果の**候補 1**（外部ストップウォッチ + 作業中の per-item outcome 入力 + sidecar 証跡）とする。同調査結果のとおり、候補 1 は Gate 2 の前に製品 code を変更しない。記録の手段は別計画 `EXT-41` に作業者の手順として定める。

Gate 2 計画の選択肢の表記（「実装する」 / 「実装しない」）との対応: 回答の「候補1」は、候補 1 の方式で記録の手段を用意すること、すなわち「実装する」にあたる。

## 本判断が意味しないこと

1. 製品 code（editor、IPC、DB schema）を変更しない。
2. `seconds` と `outcome` を生成・推定・補完する手段を作らない。測り忘れた item と、C7 の sidecar と照合できない assisted item は未取得として扱う（同調査結果の候補 1 の注意）。
3. session の記録が行われたことを意味しない。
4. ほかの所有者判断を含まない。

選択: 実装する

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
