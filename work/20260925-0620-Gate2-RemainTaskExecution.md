# Gate 2 の実行記録（G2F-01a3、2026-09-25、main3〜main6 の後）

承認件数: 2
ready: false

- 判定: Gate 2 は **BLOCKED / NOT_COMPLETE**。
- 主 run: main2 `0b7a6834-a226-4f48-b87c-5bc31dc2f2cd` の後、前の run で成功しなかった node とその後続だけを実行する run を 4 回行った。main3 `5618d7f3-f408-4e3d-bc2b-a745c1602a19`（`work/20260924-2230-UserRulings3-ExecutionPlan.md`）、main4 `84e8cb29-8aa9-40b6-bcab-411bfae30eff`、main5 `01ff4f75-d29a-453b-bb71-8e9bbb492a89`、main6 `e52b01c9-2f58-4024-abf9-8d74f4671c85`。受入の記録は `work/20260924-2230-Gate2Main3-Acceptance.md`、`work/20260925-0420-Gate2Main4-Acceptance.md`、`work/20260925-0420-Gate2Main5-Acceptance.md`、`work/20260925-0526-Gate2Main6-Acceptance.md`。
- 終端化 run: Final4 `efc44691-c372-4dff-9bfd-de77abb6ca6d`。graph は `work/20260925-0620-atg-graph-final4.json`、状態 DB は `work/20260925-0620-Gate2Final4-atg-state/main.sqlite3`。計画は `work/20260925-0620-Gate2Final3-Plan.md`。
- その前の終端化 run 3（Final3 `1b0c0c99-cb55-4e3f-9140-b5fd1a355a14`）は、G2F-00 の試行 1 を敵対的レビューの blocking 2 件で失敗にしたところ `max_attempts` が 1 で再試行できず、不合格で終えた（`work/20260925-0620-Gate2Final3-Acceptance.md`、`work/20260925-0620-Gate2Final3-Report.md`、同計画 §4）。
- main2 の時点の記録は `work/20260924-1815-Gate2-RemainTaskExecution.md` に残す。
- 冒頭の 2 行は `resources/models/manifest.json` と一致する（`models` 2 件、C6 分類と C6 検出。`releaseStatus.ready=false`）。Gate 2 計画の該当行は `work/202609232120-RemainTaskExecutionPlan.md` §8.21 の完了条件。

## 1. node ごとの結果（44 node の最後の状態）

状態と node ごとの根拠（run・試行・Review file）は `work/20260925-0620-Gate2-TerminalState.md` の表に記録した。各 node の状態は、その node を含む最後の run の状態である。ATG の出力の原文は `work/20260925-0620-Gate2-AtgReport.md`。

| ATG の状態 | 件数 | node |
|---|---:|---|
| succeeded | 32 | main2 の 24 node（G2D-01、G2D-01T、G2D-02、G2D-02R、G2D-04、G2D-05、G2D-06、G2D-10、G2D-11、G2D-12、G2D-12T、EXT-41、G2T-10、G2T-11、G2T-40、G2T-50C、G2T-50D、G2T-60C、G2T-60D、G2X-01a、G2X-01b、G2X-01c、G2Q-01C、G2Q-01D）と、G2D-07C、G2D-07D、EXT-X1、G2Q-01CM、G2Q-01DM、G2Q-02（main3）、G2Q-03C（main5）、G2Q-03D（main6） |
| failed | 2 | G2Q-04C、G2Q-04D（利用者の作業 session を所有者の指示で除外。`work/20260924-2230-UserRulings3-ExecutionPlan.md` §1 の 3） |
| blocked | 10 | G2D-08、G2Q-05C、G2Q-05D、G2Q-06C、G2Q-06D、G2A-01、G2A-02、G2A-03、G2A-04、G2V-01 |

failed の 2 node は `node fail --class contract` で記録し、再試行はしていない。blocked の 10 node は起動していない。利用者の作業 session の値と所有者の承認は作っていない。

- G2Q-03C（SigLIP）の閾値は `0.9241492748260498`（`spikes/models/siglip-assist-result.md`）。
- G2Q-03D（OWL-ViT）の閾値は `0.0002533551160013303`。実行基盤の間の比較は所有者の判断 G2Q-03D-T の判定で合格した（`spikes/models/owlvit-assist-result.md` §7.5）。main4 では、原寸 px の box の許容差で failed だった（`work/20260925-0420-Gate2Main5-Acceptance.md` L9）。
- OWL-ViT の閾値は、採用記録（`docs/model-governance/owlvit-base-patch32-adoption.md` §9）に、採用の審査（G2A-02）で確定するまでの候補値として記した。SigLIP の閾値は測定の記録（`spikes/models/siglip-assist-result.md`）にあり、採用記録（`docs/model-governance/siglip-base-patch16-224-adoption.md`）では未決定のまま。確定は G2A-01 で行う。

## 2. node ごとの結果（終端化 run、Final4）

| node | 結果 | 成果物 |
|---|---|---|
| G2F-00 | succeeded | `work/20260925-0620-Gate2-TerminalState.md`、`work/20260925-0620-Gate2-AtgReport.md` |
| G2F-01r | succeeded | `resources/models/manifest.json` の `releaseStatus.reason`（OWL-ViT の保留の理由と、Gate 2 の終端化の文）だけを変更。`ready` と entry は不変 |
| G2F-01a1 | succeeded | `docs/adr/0004-spike-decisions.md` の §1（Gate 2 終端化追補3）と §5 |
| G2F-01a3 | 本記録 | 本 file |
| G2F-03 | 本記録の後に実行 | `CHANGELOG.md` の `[Unreleased]` |

G2F-01m と G2F-01a2 は、主 run が全成功ではなく、G2A-03 も done ではないため実行しない（Gate 2 計画 §8.21 の規則）。

## 3. 検証の結果

- 主 run の succeeded 32 node: どれも `node finish` で受理された。ATG は、verify の exit が 0 でない引継ぎを拒否する。各 node の Review file は `blocking: 0`（TerminalState の表）。
- main3〜main6 の受入: acceptance command の exit は 0、`run finish` の結果は `{"accepted": true}`（上の受入の記録）。`accepted` が示すのは、その run の全 node の終端（failed と blocked を含む）と受入 exit 0 だけで、Gate 2 の成功ではない。
- 終端化 run の G2F-00、G2F-01r、G2F-01a1: helper の `end` で verify の exit が 0 になり、`node finish` で受理された。各 node の Review file は `blocking: 0`（`work/20260925-0620-Gate2Final4-<ID>-Review.md`）。
- 本 node（G2F-01a3）の検証は、helper の `end` が verify として実行する。内容は manifest との照合（冒頭の 2 行）、npm `12.0.0`、`npm run verify:docs`・`test:docs`・`verify:version`・`test:version`、`git diff --check`。敵対的レビューの結果は `work/20260925-0620-Gate2Final4-G2F-01a3-Review.md` に記録する。

## 4. 集約 `npm test` の結果（EXT-X1）

- 出典: `work/20260924-2230-EXT-X1-RootCause.md` §3。
- EXT-X1 は main3 の試行 2 で succeeded。集約の失敗の原因の 1 つ（test の mock と teardown が、別の thread が再利用した file descriptor を閉じうる）を確定し、3 file の test を直した。製品は変えていない。
- 残りの失敗（時間切れ・`WORKER_*TIMEOUT` など）の原因は確定していない。確定していない原因の修正はしていない。
- 修正の後の集約 `npm test` は 1 回実行して exit 1 だった（Test Files 8 failed、Tests 27 failed。host の CPU 使用率は平均 91.2%）。lane X の完了条件（集約を 3 回続けて exit 0）を満たせないため、2 回目以降は行っていない。本 run でも再実行していない。
- 版 `0.1.11`（GAL-V1）は、EXT-X1 の解消を条件とするため行っていない。CONTRIBUTING は版の更新に集約 `npm test` の成功を要求しており、この条件は満たされていない（Gate 2 計画 S9）。
