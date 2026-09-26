# Owner ruling TBD-09（時期と field 名）— 2026-09-24

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-24**（回答は 18 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | [`2026-09-24-owner-ruling-TBD-09.md`](2026-09-24-owner-ruling-TBD-09.md) で未選択とした改訂の時期（A / B）と、別計画 [`20260924-1341-TBD09-SchemaFieldRenamePlan.md`](../../../work/20260924-1341-TBD09-SchemaFieldRenamePlan.md) §3 の field 名の案の承認（同計画 §6 の 1） |
| 選択肢（時期） | A. 次の独立した schema 変更として改訂する（別計画）。B. Gate 2 の終端まで改訂しない（同じ選択肢を [`2026-09-24-owner-ruling-TBD-09.md`](2026-09-24-owner-ruling-TBD-09.md) の表に記録済み） |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft の TBD-09（906 行）と FR-LIC-016(3)（430 行） |

## 回答の原文

> TBD-09: 時期 A、名前は案のとおり

## 判断

- **時期: A**（次の独立した schema 変更として、別計画で改訂する）。
- **field 名: 別計画 §3 の案のとおり**。`commercialUseConfirmed` → `productUsePermitted`、`commercialDerivativesPermitted` → `productDerivativesPermitted`。
- 別計画 §5・§6.2 の実行の順序（Gate 2 の終端化 run の後、`lock:model-manifest` で直列）は変えない。

## 本判断が意味しないこと

1. schema の版（別計画 §4 の案 `3.0.0`）と product version の値を所有者が決めたことを意味しない。product version は release 責任者が決める（CONTRIBUTING「製品バージョンの更新順」）。T9-V は専用の決定記録ができるまで起動しない（別計画 §5）。
2. field の意味（FR-LIC-016(3)。非商用の研究・教育目的での利用・派生の許可であり、publisher の確認ではない）と値を変えない。
3. 既存の evidence（旧 field 名を含む記録）を変更しない。
4. ほかの所有者判断を含まない。

選択: A

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
