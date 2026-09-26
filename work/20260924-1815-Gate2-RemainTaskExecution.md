# Gate 2 の実行記録（G2F-01a3、2026-09-24、所有者の判断の後の再実行）

承認件数: 2
ready: false

- 判定: Gate 2 は **BLOCKED / NOT_COMPLETE**。
- 主 run: `0b7a6834-a226-4f48-b87c-5bc31dc2f2cd`。graph は `work/20260924-1815-atg-graph-main2.json`、状態 DB は `work/20260924-1815-Gate2Main2-atg-state/main.sqlite3`。計画は `work/20260924-1815-OwnerRulingExecutionPlan.md` §4 G。
- 終端化 run: `9750c4b8-3a47-42b0-9bbe-30f4569c9abd`。graph は `work/20260924-1815-Gate2Final2-atg-graph.json`、状態 DB は `work/20260924-1815-Gate2Final2-atg-state/final.sqlite3`。
- 前回の主 run（`e7c6da3f-8f62-4785-b40e-fab254437a4b`）と終端化 run（`2ac91e5d-b355-4080-b88c-a040b7514b86`）の記録は `work/20260924-1425-Gate2-RemainTaskExecution.md` に残す。
- 冒頭の 2 行は `resources/models/manifest.json` と一致する（`models` 2 件、C6 分類と C6 検出。`releaseStatus.ready=false`）。Gate 2 計画の該当行は `work/202609232120-RemainTaskExecutionPlan.md` §8.21 の完了条件。

## 1. node ごとの結果（主 run、44 node）

状態と node ごとの根拠は `work/20260924-1815-Gate2-TerminalState.md` の表に記録した。ATG の出力の原文は `work/20260924-1815-Gate2-AtgReport.md`。

| ATG の状態 | 件数 | node |
|---|---:|---|
| succeeded | 24 | G2D-01、G2D-01T、G2D-02、G2D-02R、G2D-04、G2D-05、G2D-06、G2D-10、G2D-11、G2D-12、G2D-12T、EXT-41、G2T-10、G2T-11、G2T-40、G2T-50C、G2T-50D、G2T-60C、G2T-60D、G2X-01a、G2X-01b、G2X-01c、G2Q-01C、G2Q-01D |
| failed | 3 | EXT-X1（集約 `npm test` の失敗の原因が未確定）、G2D-07C、G2D-07D（G2Q-01C・01D の数値案の所有者の承認が得られていない） |
| blocked | 17 | G2D-08、G2Q-01CM、G2Q-01DM、G2Q-02、G2Q-03C、G2Q-03D、G2Q-04C、G2Q-04D、G2Q-05C、G2Q-05D、G2Q-06C、G2Q-06D、G2A-01、G2A-02、G2A-03、G2A-04、G2V-01 |

failed の 3 node は、どれも `node fail --class contract` で記録し、再試行はしていない。blocked の 17 node は起動していない。それぞれの失敗した祖先は TerminalState の表に記載した。G2D-07C・07D は 2026-09-24 に ask_user で承認を問うたが、利用者は不在で回答がなかった。承認は作っていない。

## 2. node ごとの結果（終端化 run）

| node | 結果 | 成果物 |
|---|---|---|
| G2F-00 | succeeded | `work/20260924-1815-Gate2-TerminalState.md`、`work/20260924-1815-Gate2-AtgReport.md` |
| G2F-01r | succeeded | `resources/models/manifest.json` の `releaseStatus.reason` の末尾だけを変更。`ready` と entry は不変 |
| G2F-01a1 | succeeded | `docs/adr/0004-spike-decisions.md` の §1（Gate 2 終端化追補 2）と §5 |
| G2F-01a3 | 本記録 | 本 file |
| G2F-03 | 本記録の後に実行 | `CHANGELOG.md` の `[Unreleased]` |

G2F-01m と G2F-01a2 は、主 run が全成功ではなく、G2A-03 も done ではないため実行しない（Gate 2 計画 §8.21 の規則）。

## 3. 検証の結果

- 主 run の succeeded 24 node: どれも `node finish` で受理された。ATG は、verify の exit が 0 でない引継ぎを拒否する。各 node の Review file は `blocking: 0`（`work/20260924-1815-Gate2Main2-<ID>-Review.md`、EXT-41 は `work/20260924-1815-EXT-41-Review.md`）。
- 主 run の受入: acceptance command の exit は 0。`run finish` の結果は `{"accepted": true}`（`work/20260924-1815-Gate2Main2-Acceptance.md`）。`accepted` が示すのは、全 node の終端（failed と blocked を含む）と受入 exit 0 だけで、Gate 2 の成功ではない。
- 終端化 run の G2F-00、G2F-01r、G2F-01a1: helper の `end` で verify の exit が 0 になり、`node finish` で受理された。各 node の Review file は `blocking: 0`（`work/20260924-1815-Gate2Final2-<ID>-Review.md`）。
- 本 node（G2F-01a3）の検証は、helper の `end` が verify として実行する。内容は manifest との照合（冒頭の 2 行）、npm `12.0.0`、`npm run verify:docs`・`test:docs`・`verify:version`・`test:version`、`git diff --check`。敵対的レビューの結果は `work/20260924-1815-Gate2Final2-G2F-01a3-Review.md` に記録する。

## 4. 集約 `npm test` の結果（EXT-X1）

- 出典: `work/20260924-0730-EXT-X1-ExecutionRecord.md` の「所有者の判断 EXT-X1「(a)→(b) を実行してよい」による (a)・(b)」の節。
- (a) 集約 `npm.cmd test -- --maxWorkers=19` を 3 回実行した。3 回とも exit が 0 でなかった。1 回目は exit 134 で、test の集計の前に node が異常終了した。2 回目と 3 回目は exit 1 で、失敗した file はそれぞれ 3 file と 5 file だった。
- (b) 基準群（6 file）と残りの前半・後半を 2 回ずつ実行した。4 回すべて exit 1 で、失敗する file と test は回ごとに変わった。
- 原因は確定していない（E1 の計画 §3 の「確定」を満たさない）。このため EXT-X1 は failed とし、修正の node は作っていない。版 `0.1.11`（GAL-V1）は、EXT-X1 の解消を条件とするため行っていない。
- CONTRIBUTING は、版の更新に集約 `npm test` の成功を要求する。この条件は満たされていない（Gate 2 計画 S9）。
