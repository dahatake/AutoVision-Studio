# Gate 2 の実行記録（G2F-01a3、2026-09-24）

承認件数: 2
ready: false

- 判定: Gate 2 は **BLOCKED / NOT_COMPLETE**。
- 主 run: `e7c6da3f-8f62-4785-b40e-fab254437a4b`。graph は `work/202609232120-atg-graph-main.json`、状態 DB は `work/20260924-0730-Gate2Main-atg-state/main.sqlite3`。
- 終端化 run: `2ac91e5d-b355-4080-b88c-a040b7514b86`。graph は `work/202609232120-atg-graph-final.json`、状態 DB は `work/20260924-1425-Gate2Final-atg-state/final.sqlite3`。
- 上の 2 行は `resources/models/manifest.json` と一致する（`models` 2 件、C6 分類と C6 検出。`releaseStatus.ready=false`）。Gate 2 計画の該当行は `work/202609232120-RemainTaskExecutionPlan.md` §8.21 の完了条件。

## 1. node ごとの結果（主 run、44 node）

状態と node ごとの根拠は `work/20260924-1425-Gate2-TerminalState.md` の表に記録した。ATG の出力の原文は `work/20260924-1425-Gate2-AtgReport.md`。

| ATG の状態 | 件数 | node |
|---|---:|---|
| succeeded | 9 | G2T-11、G2T-40、G2T-50C、G2T-50D、G2T-60C、G2T-60D、G2X-01a、G2X-01b、G2X-01c |
| failed | 9 | G2D-01、G2D-02、G2D-04、G2D-06、G2D-10、G2D-12（所有者の回答なし）、G2D-11（導入方法の組織承認が未確認）、G2T-10（分類 checkpoint の parity が FAIL）、EXT-X1（集約 `npm test` の失敗の原因が未確定） |
| blocked | 26 | G2D-01T、G2D-02R、G2D-05、G2D-07C、G2D-07D、G2D-08、G2D-12T、EXT-41、G2Q-01C、G2Q-01D、G2Q-01CM、G2Q-01DM、G2Q-02、G2Q-03C、G2Q-03D、G2Q-04C、G2Q-04D、G2Q-05C、G2Q-05D、G2Q-06C、G2Q-06D、G2A-01、G2A-02、G2A-03、G2A-04、G2V-01 |

failed の 9 node は、どれも `node fail --class contract` で記録し、再試行はしていない。blocked の 26 node は起動していない。それぞれの失敗した祖先は TerminalState の表に記載した。

## 2. node ごとの結果（終端化 run）

| node | 結果 | 成果物 |
|---|---|---|
| G2F-00 | succeeded | `work/20260924-1425-Gate2-TerminalState.md`、`work/20260924-1425-Gate2-AtgReport.md` |
| G2F-01r | succeeded | `resources/models/manifest.json` の `releaseStatus.reason` だけを変更。`ready` と entry は不変 |
| G2F-01a1 | succeeded | `docs/adr/0004-spike-decisions.md` の §1（Gate 2 終端化追補）と §5 |
| G2F-01a3 | 本記録 | 本 file |
| G2F-03 | 本記録の後に実行 | `CHANGELOG.md` の `[Unreleased]` |

G2F-01m と G2F-01a2 は、主 run が全成功ではなく、G2A-03 も done ではないため実行しない（Gate 2 計画 §8.21 の規則）。

## 3. 検証の結果

- 主 run の succeeded 9 node: どれも `node finish` で受理された。ATG は、verify の exit が 0 でない引継ぎを拒否する。各 node の Review file は `blocking: 0`（`work/20260924-0730-Gate2Main-<ID>-Review.md`）。
- 主 run の受入: acceptance command の exit は 0。`run finish` の結果は `{"accepted": true}`（`work/20260924-1430-Gate2Main-Acceptance.md`）。`accepted` が示すのは、全 node の終端（failed と blocked を含む）と受入 exit 0 だけで、Gate 2 の成功ではない。
- 終端化 run の G2F-00、G2F-01r、G2F-01a1: helper の `end` で verify の exit が 0 になり、`node finish` で受理された。各 node の Review file は `blocking: 0`（`work/20260924-1425-Gate2Final-<ID>-Review.md`）。
- 本 node（G2F-01a3）の検証（2026-09-24、本記録の確定後に実行）:
  - manifest との照合（上の 2 行、Gate 2 計画 §8.21 の検査）: 2 行とも一致した。
  - npm は `12.0.0`。
  - `npm run verify:docs`、`npm run test:docs`、`npm run verify:version`、`npm run test:version`、`git diff --check` は、すべて exit 0。
  - 敵対的レビューの結果は `work/20260924-1425-Gate2Final-G2F-01a3-Review.md` に記録した。helper の `end` は、同じ検査を verify として再実行する。

## 4. 集約 `npm test` の結果と既知の失敗の区別

- 出典: `work/20260924-0730-EXT-X1-npmtest.raw.log`（npm 12.0.0、1 回）。exit は 1。
  - 439 行: `Test Files  7 failed | 114 passed (121)`
  - 440 行: `Tests  21 failed | 4628 passed | 8 skipped (4657)`
- 失敗した 7 file:
  - `src/main/data/copy-source.test.ts`
  - `src/main/data/import-files.test.ts`
  - `src/main/data/import-python.test.ts`
  - `src/main/data/import-repository.test.ts`
  - `src/main/data/import-service.test.ts`
  - `src/main/jobs/job-service.test.ts`
  - `src/main/jobs/worker-supervisor.test.ts`
- 既知の失敗は、以前の記録 `work/20260923-2003-C7-RemainingTasksExecution.md` 87 行にある 3 file・3 件（`sample-assets.test.ts`、`reference-source.test.ts`、`copy-source.test.ts`）。
  - 今回の 7 file と重なるのは `copy-source.test.ts` だけ。
  - 残り 6 file は既知の失敗に含まれない。
  - 以前の記録で失敗した `sample-assets.test.ts` と `reference-source.test.ts` は、今回は失敗していない。
- 失敗した 7 file だけをまとめて 3 回実行した結果は、3 回とも exit 0 で、失敗は再現しなかった（`work/20260924-0730-EXT-X1-ExecutionRecord.md` 21〜34 行）。
- 原因は確定していない。このため EXT-X1 は failed とし、修正の node は作っていない（`work/20260924-0730-EXT-X1-Status.md` §2）。
- 集約 `npm test` の成功は、CONTRIBUTING が版を更新するときに要求する。この条件は満たされていない（Gate 2 計画 S9）。