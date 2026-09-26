# Owner ruling G2D-11（用意の完了） — 2026-09-24

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-24**（回答は 18 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | Gate 2 実行計画 [`202609232120-RemainTaskExecutionPlan.md`](../../../work/202609232120-RemainTaskExecutionPlan.md) §5 の G2D-11「検証に使う npm の用意（S11）」 |
| 先行する記録 | [`2026-09-24-owner-ruling-G2D-11.md`](2026-09-24-owner-ruling-G2D-11.md)（05:56 JST の回答。導入方法が組織承認済みであることは未確認として `選択: 未確定`） |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 Draft |

## 回答の原文

実装担当が Gate 2 の未完了の判断事項と選択肢を提示した後の、権限者の回答（該当行をそのまま転記）:

> G2D-11: A（取得元 feed は組織承認済み）※または B

## 提示した選択肢（回答の前に実装担当が提示した文言）

- 現状として、導入コマンド `npm install --global --prefix "$env:LOCALAPPDATA\npm-12.0.0" npm@12.0.0` と取得元 `https://packagefeedproxy.microsoft.io/npm/` を示した。
- A：この方法を組織承認済みとして承認する
- B：承認しない（組織承認済みの方法で入れ直し、npm を使う検証をやり直す）

## 判断

**用意の完了**。権限者は A（上の導入コマンドと取得元による方法全体を組織承認済みとして承認する）を選び、理由として取得元 feed が組織承認済みであることを添えた。これにより、先行する記録で未確認とした「導入方法が組織承認済みであること」が確認され、CONTRIBUTING §8 の「組織承認済みの方法で用意し、その `bin` directory を PATH の先頭へ置く」が成立する。導入先・導入コマンド・PATH の扱いは先行する記録のとおりで、変えない。

回答の「※または B」は、実装担当の解釈として代替の許可と読み、A を採る（計画 `work/20260924-1815-OwnerRulingExecutionPlan.md` §1 の 1）。B は入れ直しを求める選択肢であり、A と同時には成り立たないため、A が選ばれた記録とする。

## 本判断が意味しないこと

1. 先行する記録を変更しない（同記録の版管理の節）。先行する記録の `選択: 未確定` は当時の状態の記録として残る。
2. system の npm（11.17.0）を置き換えない。PATH の恒久的な変更を行わない。
3. 製品の依存・lock を変更しない。
4. ほかの所有者判断を含まない。

選択: 用意の完了

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
