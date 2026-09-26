# Owner ruling G2D-12 — 2026-09-24

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-24**（回答は 18 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | Gate 2 実行計画 [`202609232120-RemainTaskExecutionPlan.md`](../../../work/202609232120-RemainTaskExecutionPlan.md) §5 の G2D-12「採用記録テンプレートのチェック項目のうち、採用時点では満たせない項目の扱い」 |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft |

## 回答の原文

実装担当が Gate 2 の未完了の判断事項と選択肢を提示した後の、権限者の回答（該当行をそのまま転記）:

> G2D-12: A

## 判断

選択肢 **A** を採用する。承認済み C6 採用記録（[`mobilenet-v3-large-imagenet1k-v2-adoption.md`](../mobilenet-v3-large-imagenet1k-v2-adoption.md) §10・§14）の先例に合わせ、テンプレートを次のように改める（Gate 2 計画 §5 の G2D-12 の選択肢 A の文言）。

1. §16.7 の項目 24 は Version 1 では Windows DirectML / CPU だけを対象とし、macOS は `N/A（A-07）` とする。
2. §16.10 の項目 32・33 は、採用時に SBOM 登録予定と `THIRD_PARTY_NOTICES` の文面（§5）を確定し、生成と照合は PKG phase で行う。
3. §16.11 の項目 34 は、これらを完了とみなす範囲を明記する。

## 本判断が意味しないこと

1. SBOM と `THIRD_PARTY_NOTICES` の生成・照合を免除しない。PKG phase で行う。
2. C7 を採用・承認する判断ではない。
3. ほかの所有者判断を含まない。

選択: A

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
