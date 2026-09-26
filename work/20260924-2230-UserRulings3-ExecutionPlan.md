# 所有者の回答（2026-09-24 22 時）の実行計画

- 作成日: 2026-09-24
- 入力: 所有者の回答「1: 承認します。/ 2: 失敗原因を調査して、タスクを完了させてください。/ 3, 6, 7: タスクから除外 / 4, 5: 詳細を説明してください。」（前回の報告の「引き続き必要な判断・作業」の番号）
- 前提の計画: [`20260924-1815-OwnerRulingExecutionPlan.md`](20260924-1815-OwnerRulingExecutionPlan.md)、Gate 2 計画 [`202609232120-RemainTaskExecutionPlan.md`](202609232120-RemainTaskExecutionPlan.md)
- 要求の基準: [`docs/requirement-definition.md`](../docs/requirement-definition.md)

## 1. 回答の対応

| 番号 | 前回の項目 | 回答 | 本計画での扱い |
|---|---|---|---|
| 1 | G2D-07C / 07D（gold set と判定基準の案の承認） | 承認 | lane R で判断記録を作り、lane G で G2Q-01CM / 01DM / 02 を実行する |
| 2 | EXT-X1（集約 `npm test` の失敗） | 原因を調査して完了 | lane X |
| 3 | G2Q-04 / 05（利用者の session） | 除外 | lane G で「所有者の除外」として記録する。後続の G2Q-06、G2A-01〜04、G2D-08、G2V-01 は起動できない |
| 4 | G2D-08（Gate 2 の製品版） | 説明の要求 | 最後の報告で説明する（判断は作らない） |
| 5 | T9-V（TBD-09 の schema 版） | 説明の要求 | 最後の報告で説明する（判断は作らない） |
| 6 | MAN-01 / 05 の操作ごとの本人確認 | 除外 | lane Z で TERM-01 に記録する |
| 7 | W3-08 の PKG 受入 | 除外 | lane Z で TERM-01 に記録する |

## 2. lane と完了条件

| lane | 内容 | 完了条件（DoD） |
|---|---|---|
| X | EXT-X1 の原因の確定と修正。確定の定義と修正の規則は [`20260924-0730-EXT-X1-Plan.md`](20260924-0730-EXT-X1-Plan.md) §3（観測 (a) または 1 要因比較 (b)、test を弱めない）。記録は [`20260924-2230-EXT-X1-RootCause.md`](20260924-2230-EXT-X1-RootCause.md) | (1) 修正した test file の vitest が exit 0。(2) `npm run typecheck` が exit 0。(3) 集約 `npm test` を 3 回続けて exit 0（`--trace-warnings` 付きで、`closed but not opened` の警告が 0 件）。(4) `work/20260924-0730-EXT-X1-Confirmation.md` の `evidence:` 行のコマンドが exit 0。(5) 敵対的レビュー blocking 0 |
| R | G2D-07C / 07D の判断記録（`docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-07C.md` / `-07D.md`） | `選択: 承認`、判断者、回答の原文の `> ` 行があり、`npm run verify:docs` が exit 0。敵対的レビュー blocking 0 |
| G | Gate 2 の残りのノードを新しい実行 ID で実行する（main3）。ノードは main2 で終端しなかった EXT-X1、G2D-07C / 07D と、その後続だけ。main2 で成功したノードへの依存は、main2 の受入（`work/20260924-1815-Gate2Final2-Acceptance.md`）を出典として外す | 各ノードは Gate 2 計画 §8 の完了条件（verify は main2 の複製 `work/20260924-2230-Gate2Main3-verify.ps1`、Review の path だけ変更）。G2Q-03C / 03D は、承認された計画に閾値の選び方が無いため `node fail --class contract` で記録する（推測しない）。G2Q-04C / 04D / 05C / 05D は所有者の除外として `node fail --class contract` で記録する。`run finish` の受入コマンドが exit 0 |
| V | GAL-V1: 製品版 0.1.11（所有者の回答「GAL-V1: 0.1.11（EXT-X1 の解消後に更新）」）。手順は `CONTRIBUTING.md` の「製品バージョンの更新順」 | lane X の完了の後に限り実行する。`npm run verify:version`、`npm run test:version`、`npm test`、`npm run typecheck`、`npm run build` が exit 0。git の tag は変えない |
| Z | TERM-01 と Baseline の更新、`CHANGELOG.md` の [Unreleased]、package の PATCH の確認、最終確認 | TERM-01 の検査 script が exit 0、`npm run verify:docs` が exit 0、`git diff --check` が exit 0。敵対的レビュー blocking 0 |

## 3. 並列性と順序

- X の集約 `npm test` の実行中は、ほかの process を起動しない（EXT-X1 計画 §2 の条件）。file の作成だけを並行して行う。
- R は X と並列（file の作成だけ）。G は R の後。V は X の後。Z は最後。

## 4. 本計画で行わないこと

- 所有者の判断（G2D-08 の製品版、T9-V の版、G2Q-03 の閾値の方針）を作らない。
- 利用者の session と gold label を作らない。
- ATG package（`tools/atg/`）は変更しない予定。変更しない場合、ATG の PATCH は上げない。


## 5. 実行中の逸脱と訂正（事実の記録）

- main3 の最初の実行 `d07d29aa-033c-4b3d-8eed-aa412183b9f4` は、G2D-07C の実行中に G2D-07D の Review を先に書いたため G2D-07C の書込みの範囲の違反になり、使うのをやめた。同じ state の DB で実行 `5618d7f3-f408-4e3d-bc2b-a745c1602a19` をやり直した。
- G2Q-01DM の 1 回目の試行は、G2Q-01CM と同時に始めたため（01CM の Review が 01DM の範囲外の書込みに見える）、`node fail --class implementation` で終え、2 回目で完了した。
- G2Q-02 のレビューの 2 回目で、Gate 2 計画 §8.15 の command に revision の引数が無い点が見つかり、ノードの後に同計画へ訂正の行を加えた（L469）。
- lane X: 比較 1（worker 数）は 1 要因比較にならず未確定、比較 2（負荷の追加）は負荷の process の不具合で無効、比較 3・4（使える CPU の数）は判定の条件を満たさず未確定（RootCause §2・§3）。残りの失敗の修正ノードは作らない。EXT-X1 の 1 回目の試行は、敵対的レビューの blocking 2 件により `node fail --class implementation` で終えた。2 回目の試行で完了した（Review: `work/20260924-2230-Gate2Main3-EXT-X1-Review.md`）。
- lane X の完了条件 (3)（集約 `npm test` を 3 回続けて exit 0）は、1 回目が exit 1（Tests 27 failed、`closed but not opened` の警告は 0 件）で満たせなかった（RootCause §3）。このため lane X は未完了で、lane V（0.1.11）は行わない（§2 の V の完了条件「lane X の完了の後に限り実行する」）。EXT-X1 の ATG ノード自体の完了条件は EXT-X1 の計画 §4（Vitest3 と Confirmation）で判定する。
- lane G: G2Q-05C / 05D は、§2 の完了条件では `node fail --class contract` で記録するとしたが、依存する G2Q-03C / 03D と G2Q-04C / 04D が failed になったため起動できず、`blocked`（試行 0）で終端した（`work/20260924-2230-Gate2Main3-Report.md` の表）。起動していないノードに `node fail` は記録しない。
- main3 の後の Gate 2 の終端化 run（Gate 2 計画 §8 の G2F-00〜03。1815 では `work/20260924-1815-Gate2Final2-atg-graph.json`）は、本計画 §2 に含めず、行っていない。このため `resources/models/manifest.json` の `releaseStatus.reason` と `work/20260924-1815-Gate2-TerminalState.md` は main2 の時点の内容のままである（TERM-01 §5 の 7）。
