# Owner ruling G2D-09 — 2026-09-24

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-24**（回答は 05:56 JST） |
| 記録者 | 実装担当（session `c1997536-bb53-4fae-8696-6838c192fa9a`） |
| 判断事項 | Gate 2 実行計画 [`202609232120-RemainTaskExecutionPlan.md`](../../../work/202609232120-RemainTaskExecutionPlan.md) §5 の G2D-09「500 行を超える file の扱い（S10）」。本計画の中で ATG 規則を免除する判断ではなく、別計画 `EXT-ATG` の方式を選ぶ判断 |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft |

## 回答の原文

実装担当が、未完了の原因を A（npm 12.0.0 の不在）、B（所有者判断 G2D-09 の不在。方式 A: ATG の規約を改訂する、方式 B: 500 行を超える file を分割する）、C（利用者本人の操作）、D（Gate 2 未通過）に分けて提示した後の、権限者の回答（該当行をそのまま転記）:

> B: A

## 判断

選択肢 **A** を採用する。ATG package の planning 規約を改訂し、「編集箇所を含む行範囲だけを読み、範囲を計画に記載する」場合の扱いを定める。改訂は ATG package の変更として別途レビューし、ATG の PATCH を上げる（Gate 2 計画 §5 の G2D-09 の選択肢 A の文言どおり）。

## 根拠

| 根拠 | 内容 |
|---|---|
| Gate 2 計画 §5 G2D-09 の推奨 | 選択肢 B は test 3 件・schema・spike・UI test・実装計画を含む 8 file 以上の構造変更になり、Gate 2 と無関係な差分が大きい |
| 要求定義 | 500 行規則は ATG package の planning 規約（改訂前の `.github/skills/atg/references/planning.md` §1・§2 の `context_size=large` の定義と、それを使う §3 の分割判定。Gate 2 計画 §4 の S10）であり、要求定義には file の行数の要件はない。したがって要求定義の要件を変更・緩和する判断ではない |

## 本判断が意味しないこと

1. Gate 2 計画の中で ATG の規則を免除しない。改訂した規約に従い、各ノードの分割判定をやり直す（Gate 2 計画 §6.1）。
2. `SPLIT_REQUIRED` の判定そのもの（`task_scope=multi` または `context_size=large`）を廃止しない。
3. 選択肢 B（Gate 2 の前提として該当 file を先に分割する方式）を採用することではない。将来の通常のリファクタリングとしての分割を禁止しない。
4. ほかの所有者判断（G2D-01、02、04〜08、10〜12）を含まない。

選択: A

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
