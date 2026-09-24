# Owner ruling TBD-09 — 2026-09-24

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-24**（回答は 05:56 JST） |
| 記録者 | 実装担当（session `c1997536-bb53-4fae-8696-6838c192fa9a`） |
| 判断事項 | 残タスク統合実行計画 [`202609232400-RemainTaskExecutionPlan.md`](../../../work/202609232400-RemainTaskExecutionPlan.md) §12 の TBD09-D「TBD-09（manifest schema の許諾 field 名）の改訂の要否と時期」 |
| 選択肢（時期） | A. 次の独立した schema 変更として改訂する（別計画）。B. Gate 2 の終端まで改訂しない |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft の TBD-09（「次に schema を変更する時」）と FR-LIC-016(3) |

## 回答の原文

実装担当が未完了タスクの一覧で TBD09-D（所有者判断の記録がない）を提示した後の、権限者の回答（該当行をそのまま転記）:

> TBD09-D: 改定してください。

同日、実装担当が時期（A / B）を `ask_user` で確認したが、回答は「利用者は回答できない。文脈に最も合う実用的な選択をせよ」であった。

## 判断

- **要否: 改訂する**（原文「改定してください」）。
- **時期: 所有者は選択していない。** 選択肢 B は「改訂しない」ではなく「Gate 2 の終端まで延期する」であり、原文は A・B のどちらとも両立する。記録者は A・B のどちらも所有者の判断として記録しない。

## 実行の順序（記録者の運用であり、所有者の判断ではない）

改訂は、A・B のどちらとも両立する順序、すなわち **Gate 2 の終端化 run が終わった後に、独立した schema 変更として別計画で**行う。これは A（独立した schema 変更、`lock:model-manifest` で Gate 2 と直列）と B（Gate 2 の終端まで改訂しない）の両方を満たす。

## 根拠

| 根拠 | 内容 |
|---|---|
| 要求定義 TBD-09 | 「`commercialUseConfirmed` / `commercialDerivativesPermitted` は、改訂までは製品のモデル利用条件（非商用の研究・教育目的）での利用・派生の許可を表すものとして扱う（FR-LIC-016(3)）」。期限は「次に schema を変更する時」 |
| 残タスク計画 §12 | 改訂は別計画で行い、`manifest.schema.json` と `manifest-schema.test.mjs` を変えるため `EXT-ATG` を前提にし、`lock:model-manifest` と `lock:root-version` で Gate 2 と直列にする |

## 本判断が意味しないこと

1. 時期の選択肢 A・B のどちらかを所有者が選んだことを意味しない。
2. 新しい field 名、schema の版、product version を決めない。field 名の案は別計画で示し、schema 変更として別途レビューする。product version の値は release 責任者が決める（CONTRIBUTING「製品バージョンの更新順」）。
3. 要求定義の FR-LIC-016(3) の意味（非商用の研究・教育目的での利用・派生の許可であり、publisher の確認ではない）を変えない。

選択: 未確定（要否は「改訂する」、時期の A / B は未選択）

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
