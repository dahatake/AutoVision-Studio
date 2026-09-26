# 所有者の回答（2026-09-26 09:53）の実行計画 — `npm test` の安定化と TBD-09

- 作成日時: 2026-09-26 09:55
- 基準: [`requirement-definition.md`](../docs/requirement-definition.md) v0.8 Draft、前回の計画 [`20260926-0815-OwnerRulings5-ExecutionPlan.md`](20260926-0815-OwnerRulings5-ExecutionPlan.md)、調査 [`20260926-0810-EXT-X1-ThreadpoolCompare.md`](20260926-0810-EXT-X1-ThreadpoolCompare.md)、TBD-09 の計画 [`20260924-1341-TBD09-SchemaFieldRenamePlan.md`](20260924-1341-TBD09-SchemaFieldRenamePlan.md)。

## 1. 所有者の回答（原文）

> 「**一括の `npm test` の安定化**」/実施してください。
> **TBD-09（項目名の改名）**/実施してください。

前回の報告は、安定化の進め方として「一番多く失敗するテスト（`copy-source.test.ts:162`）の書き込みサイズを大きくして、処理量を減らす。テストの条件が変わるため、承認が必要です。」と「負荷の少ないPCで3回続けて実行する。」を挙げた。

## 2. 判断の適用

| ID | 適用 | 根拠 |
|---|---|---|
| S-1 | `copy-source.test.ts:162` の短い書込みの上限を 4,093 byte から 32,749 byte（32 KiB 未満の素数）に変える。64 KiB の read chunk ごとに短い書込みが残る（1 chunk を 3 回で書く）ため、test の意図（上限付きの read と短い書込みの完了）と assert は変えない。書込みの回数は約 545 回（64 KiB の chunk 32 個 × 17 回と最後の 17 byte の 1 回）から約 97 回に減る | 回答 1（前回の報告の案 1 の承認） |
| S-2 | S-1 の後、集約 `npm test` を 3 回続けて実行する（GAL-V1 の条件: 2230 計画 §2 の V、lane X の完了の条件 (3)）。失敗が残る場合は、失敗した test の種類ごとに原因を観測し、test の assert・timeout を緩めない変更で直せるものだけを直す。直せない失敗は報告する | 回答 1。EXT-X1 計画 §3（test を弱めない） |
| S-3 | 3 回続けて exit 0 になった場合だけ、所有者の判断で決まっている版を順に適用する: GAL-V1 `0.1.11` → G2V-01 `0.1.12`（`package.json` / `package-lock.json`）→ G2F-01m（`ready=true`、manifest の `productVersion`） | CONTRIBUTING「製品バージョンの更新順」、Gate 2 計画 §8.19・§8.21、G2D-08 の記録 |
| T-1 | TBD-09 の計画 §5 の T9-S / M / T / G / R を行う（schema `2.0.1` → `3.0.0`、`commercialUseConfirmed` → `productUsePermitted`、`commercialDerivativesPermitted` → `productDerivativesPermitted`）。計画 §6 の 2（Gate 2 の終端化の後）に従い、S-3 の後に行う。S-3 に届かない場合も、schema の改名は版の適用と独立に行う（計画 §5 の T9-S〜R は版に依存しない） | 回答 2、所有者の判断「TBD-09: 時期 A、名前は案のとおり」 |
| T-2 | T9-V（製品版）: 値は所有者の判断に無い。S-3 で `0.1.12` まで適用できた場合は、G2D-08 と同じ規則（割り当て済みの最新の版の PATCH + 1）で `0.1.13` とし、決定記録 `work/20260924-1341-TBD09-VersionDecision.md` を作る。S-3 に届かない場合は T9-V を行わない（版の更新には集約 `npm test` の成功が要る） | TBD-09 の計画 §5、CONTRIBUTING「製品バージョンの更新順」4 |

## 3. 完了条件

| ID | 完了条件 |
|---|---|
| S-1 | `vitest run src/main/data/copy-source.test.ts` が exit 0。書込みの上限の変更だけで、assert は変わらない |
| S-2 | 集約 `npm test` の 3 回続けての exit 0、または失敗の観測と、直せない理由の記録 |
| S-3 | Gate 2 計画 §8.19 の完了条件（`verify:version`・`test:version`・`npm test`・`typecheck`・`build` が exit 0、tag が増えない）と G2F-01m の test |
| T-1 | TBD-09 の計画 §5 の各 node の完了条件（旧名が `work/` と evidence 以外に無い、`MANIFEST`・`DOCS`・`test:docs` が exit 0） |
| T-2 | TBD-09 の計画 §5 の T9-V の完了条件（S-3 の後の場合だけ） |

各タスクの後に敵対的レビューを行い、blocking 0 にしてから次へ進む。

## 4. 実行の後の注記（2026-09-26）

- T-1 の順序: 計画は TBD-09 の改名を S-3 の後に行うとしたが、実際には S-2 の途中（10:21〜10:23）に T9-S〜T9-R の改名を行い、その後の 3 回続けての集約 `npm test`（10:24〜10:39）と、版の更新の検証は改名の後の code で行った。改名は版に依存しない（TBD-09 の計画 §5）ため、最終の code での検証を優先した。
- T-2: 所有者の回答は T9-V の版の値を含まず、候補が 2 つ（`0.1.12` と `0.1.13`）ある。TBD-09 の計画 §5 は release 責任者の決定を求めるため、T9-V は所有者の決定まで止める（`work/20260924-1341-TBD09-VersionDecision.md` は提案であり決定記録ではない）。上の T-2 の「`0.1.13` とし、決定記録を作る」は行わない。
