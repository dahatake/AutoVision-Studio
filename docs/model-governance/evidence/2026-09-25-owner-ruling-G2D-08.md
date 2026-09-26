# Owner ruling G2D-08 — 2026-09-25

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答による委任と、その委任を受けた記録者の決定の記録。版の値を所有者が選んだ記録ではない） |
| 委任者 | **dahatake**（repository owner） |
| 判断者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`。dahatake から委任。CONTRIBUTING「製品バージョンの更新順」1 の明示決定として本文書に記録する） |
| 決定日 | **2026-09-25**（回答は 07 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | Gate 2 実行計画 [`202609232120-RemainTaskExecutionPlan.md`](../../../work/202609232120-RemainTaskExecutionPlan.md) §7.1 の G2D-08（製品版の決定。L80「Gate 2 を `ready=true` で記録する時点の product version」） |
| 基準 | [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)「製品バージョンの更新順」1〜3、[`implementation-plan.md`](../../implementation-plan.md) L394・L1229（END-02） |

## 回答の原文

実装担当が「G2D-08（製品版）」の値を尋ねた後の、権限者の回答（該当行をそのまま転記）:

> 「**G2D-08（製品版）**」は具体的に何を設定すればいいのですか?あなたが決定してよいです

## 決定

選択: 0.1.12

## 理由

1. 現在の製品版は `0.1.10`（root `package.json`）。
2. `0.1.11` は所有者の判断「GAL-V1: 0.1.11（EXT-X1 の解消後に更新）」で GAL-V1 に割り当て済み（[`20260924-1815-OwnerRulingExecutionPlan.md`](../../../work/20260924-1815-OwnerRulingExecutionPlan.md) L10）。G2D-08 はその後の版であり、同じ版を別の変更に使わない。
3. Gate 2 の変更（C7 分類 entry の登録など）は後方互換の変更であり、MAJOR / MINOR を保ち PATCH だけを 1 つ上げる（implementation-plan L1229 の END-02 と同じ規則）。このため `0.1.11` の次の `0.1.12` とする。

## 適用の時期と方法

1. 今は `package.json`・`package-lock.json`・manifest の `productVersion` に書き込まない。manifest は `releaseStatus.ready=false` であり、未承認の `ready=false` manifest へ release 対象版を先行記入しない（CONTRIBUTING「製品バージョンの更新順」3、implementation-plan L394）。
2. 比較試験（NFR-ANN-006）の合格を `releaseStatus.assistQuality[]` に記録し Gate 2 を `ready=true` で記録する時（G2V-01）に、exact npm 12.0.0 の `npm version 0.1.12 --no-git-tag-version` で root `package.json` と `package-lock.json` を更新し、manifest の `productVersion` を同じ値にする（CONTRIBUTING「製品バージョンの更新順」2・3）。
3. その時点で GAL-V1 の `0.1.11` が未適用、または `0.1.12` が別の変更で使われていた場合は、本決定をそのまま適用せず、所有者に版を確認する。

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
