# 所有者の回答（2026-09-26 07:48）の実行計画

- 作成日時: 2026-09-26 08:00（file の作成時刻 07:59:43。file 名の `0815` は誤って付けた時刻）
- 基準: [`requirement-definition.md`](../docs/requirement-definition.md) v0.7 Draft（本計画で v0.8 Draft へ改訂する）、Gate 2 計画 [`202609232120-RemainTaskExecutionPlan.md`](202609232120-RemainTaskExecutionPlan.md)、前回の計画 [`20260925-0745-Gate2Main7-Plan.md`](20260925-0745-Gate2Main7-Plan.md)、終端状態 [`20260925-0947-Gate2-TerminalState.md`](20260925-0947-Gate2-TerminalState.md)。

## 1. 所有者の回答（原文）

> 「**OWL-ViT（物体検出の補助モデル）は保留のまま**」/はい。
> 「**比較試験（NFR-ANN-006）はまだ行われていません**」/実施対象から削除して、完了扱いにしてください。
> 「**一括の `npm test` の失敗の原因が分かっていません**」/失敗の原因を調査してください。
> 「**Gate 2 計画の食い違い**」/要求定義と照合して、合理的に正しい方を採用して、適切な修正をしてください。
> 「**正本の記述**」/正本の修正を許可します。

1 行目の「はい」は、前回の報告の問い「2026-09-25 の判断が、2026-09-23 のリスク受容の §4 の 1・2 を変更するかどうか、はい／いいえ」への回答である。

## 2. 判断の適用

| ID | 適用 | 根拠 |
|---|---|---|
| R-1 | 2026-09-25 07:44 の判断（比較試験を Gate 2 のタスクから外す）は、2026-09-23 C7 検出 risk acceptance §4 の 1・2（比較試験の後に承認・登録する条件）を変更する。OWL-ViT の採用記録の保留の理由 (1) は解消する。G2A-02（承認）・OWL-ViT の manifest entry（G2A-03 の検出分）・G2A-04（研究目的に限る表示）を行う | 回答 1。risk acceptance §3.2 の署名は所有者の判断 G2D-06「署名する（§1〜§3 を確認済み）」で与えられており、承認の時点で採用記録に記録する（同判断「判断」） |
| R-2 | 比較試験（G2Q-04C / 04D / 05C / 05D / 06C / 06D）を Version 1 の実施対象から外し、**免除（所有者の判断）**として完了扱いにする。試験は行わず、測定値・合格の記録は作らない（`releaseStatus.assistQuality[]` に値を入れない）。要求定義 NFR-ANN-006・POC-16 の該当部分・L764 に、Version 1 では所有者の判断で免除したことを記す（正本の修正の許可）。manifest schema の「`ready=true` には `assistQuality[]`（C7 の 2 task）が要る」制約を外す（既存の有効なデータをすべて有効のまま保つ緩和のため、SchemaVer の ADDITION で `2.0.0` → `2.0.1`）。`assistQuality` の property は残す（将来、試験を行った場合の記録先） | 回答 2・5。捏造の禁止（合格の値を作らない） |
| R-3 | 集約 `npm test` の失敗の原因を調べる。事前に固定した比較 [`20260926-0810-EXT-X1-ThreadpoolCompare.md`](20260926-0810-EXT-X1-ThreadpoolCompare.md) を行い、確定した場合だけ修正する | 回答 3。EXT-X1 計画 §3 |
| R-4 | 食い違い: Gate 2 計画 §8.19 は G2V-01 で `ready=false` の manifest に `productVersion` を書く。CONTRIBUTING.md L182（「未承認の `ready=false` manifest へ release 対象版を先行記入しない」）、`docs/implementation-plan.md` L394（`ready=false` かつ `productVersion` 省略を有効とし、未決定の版を書かない）、schema（`ready=true` のときだけ `productVersion` を必須にする: `manifest.schema.json` L60-72）はそろって CONTRIBUTING の側である。要求定義 L177 は製品版の正本を root `package.json` とし、manifest への先行記入を求めない。よって CONTRIBUTING を正とし、§8.19 を「`package.json` / `package-lock.json` だけを更新し、manifest の `productVersion` は G2F-01m で `ready=true` と同時に書く」に直す | 回答 4 |
| R-5 | 正本の「承認済みの補助モデルはない」旨の記述（要求定義 L754・L759、`docs/dependency-policy.md` L190・L312・L327）を現状（SigLIP・OWL-ViT を承認）に合わせる。要求定義の改訂に合わせて文書版を v0.8 Draft とし、README の基準版と SHA-256 を同期する | 回答 5 |
| R-6 | TBD-09（field 名の改訂）は、所有者の判断「時期 A」（次の**独立した** schema 変更として別計画で行う）により、R-2 の schema 変更には含めない。別計画 [`20260924-1341-TBD09-SchemaFieldRenamePlan.md`](20260924-1341-TBD09-SchemaFieldRenamePlan.md) のまま残す | `2026-09-24-owner-ruling-TBD-09-timing-and-names.md`「判断」 |
| R-7 | 製品版: R-3 で集約 `npm test` が通る状態になった場合に限り、所有者の判断「GAL-V1: 0.1.11（EXT-X1 の解消後に更新）」で `0.1.11` を適用し、その後 G2V-01 で G2D-08 の `0.1.12` を適用する（G2D-08 の記録「適用の時期と方法」3 の条件を満たす順序）。通らない場合はどちらも行わず、Gate 2 は G2V-01 で止まる | CONTRIBUTING「製品バージョンの更新順」4、Gate 2 計画 §8.19 |

## 3. タスクと完了条件（Definition of Done）

| ID | 内容 | 完了条件 |
|---|---|---|
| X1 | 集約 `npm test` の比較（R-3）と、確定した場合の修正 | 比較の記録の §4 に 4 回の結果と判定がある。確定した場合は修正の後の集約 `npm test` が exit 0 |
| E1 | 所有者の回答の根拠書面 `docs/model-governance/evidence/2026-09-26-owner-rulings.md` | 回答の原文 5 行があり、`verify:docs` が exit 0 |
| Q1 | 比較試験の免除（R-2）: 要求定義・schema・schema の test・adoption-template・両採用記録の §12 / チェックリスト・assist-result | `verify:docs`・`test:docs`・`node --test scripts/models/manifest-schema.test.mjs` が exit 0。schema の test に「`ready=true` で `assistQuality` が無くても有効」の case がある |
| A2 | G2A-02: OWL-ViT の採用記録の承認（§5 NOTICE、§9 の確定、§12、§14、§15、チェックリスト） | Gate 2 計画 §8.16 の判定コマンドが exit 0（OWL-ViT の行の値） |
| A3 | OWL-ViT の manifest entry と `EXPECTED_APPROVED_ENTRIES` = 4 | manifest の test が exit 0 |
| A4 | G2A-04: 設定画面の「ライセンス・情報」に OWL-ViT の NOTICE と研究目的に限る旨を表示。NOTICE file を追加 | `vitest run src/renderer/features/settings/SettingsPage.test.tsx` が exit 0。表示文が manifest の `noticeText` と一致する test がある |
| P1 | Gate 2 計画 §8.19・§8.21 の修正（R-4・R-2） | 本文の手順が CONTRIBUTING L182 と矛盾しない |
| C1 | 正本の記述の更新（R-5）と README の基準版・SHA-256 | `verify:docs` が exit 0 |
| V1 | 製品版の適用（R-7。条件付き） | Gate 2 計画 §8.19 の完了条件（`verify:version`・`test:version`・`npm test`・`typecheck`・`build` が exit 0、tag が増えない） |
| F1 | 終端化: 終端状態の記録、manifest の `ready` / `reason`（全成功なら G2F-01m）、ADR-0004、TERM-01、現状の文書、CHANGELOG | TERM01 の検査が exit 0、`verify:docs`・manifest の test が exit 0 |

各タスクの後に敵対的レビューを行い、blocking 0 にしてから次へ進む。E1・Q1・C1 は正本の文書を、A2・A3 は採用記録と manifest を、A4 は画面の code を変えるため、同じ file を触る組は直列にする。比較（X1）の実行中は、`npm test` が読む `docs/` と `src/` を変えない（比較の条件を固定するため）。
