主 run: 静止（失敗あり）
G2A-03: not-done

# Gate 2 終端状態の記録（main2〜main6 の後、2026-09-25）

- 出典: `work/20260925-0620-Gate2-AtgReport.md`（main2 `0b7a6834-…`・main3 `5618d7f3-…`・main4 `84e8cb29-…`・main5 `01ff4f75-…`・main6 `e52b01c9-…` の `python -m atg report` の原文を実行順に連結したもの）。各 run の受入は work/20260924-1815-Gate2Main2-Acceptance.md、work/20260924-2230-Gate2Main3-Acceptance.md、work/20260925-0420-Gate2Main4-Acceptance.md、work/20260925-0420-Gate2Main5-Acceptance.md、work/20260925-0526-Gate2Main6-Acceptance.md。
- 状態の求め方（`work/20260925-0620-Gate2Final3-Plan.md` §1）: main3〜main6 は、前の run で終端しなかった node とその後続だけを実行したため、node の状態は、その node を含む最後の run の状態とする。状態の対応（`work/202609232120-Gate2-NodeInventory.md` §2）: succeeded → done、failed → failed、それ以外 → not-started。
- blocked の node の「失敗した祖先」は、graph の deps を現在の状態（本表）でたどった結果である（main3 の時点では G2Q-03C / 03D も failed だった）。
- 前回の終端化の記録（main2 の時点）は `work/20260924-1815-Gate2-TerminalState.md` に残す。
- 各 report の「総合結果」は、その run の全 node の終端と受入 exit 0 を示すだけで、Gate 2 の成功ではない（44 node の最後の状態: succeeded 32 / failed 2 / blocked 10）。Gate 2 の判定は **BLOCKED**。

| ID | 状態 | 根拠 |
|---|---|---|
| G2D-01 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-01-Review.md（blocking: 0）と handoff |
| G2D-01T | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-01T-Review.md（blocking: 0）と handoff |
| G2D-02 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-02-Review.md（blocking: 0）と handoff |
| G2D-02R | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-02R-Review.md（blocking: 0）と handoff |
| G2D-04 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-04-Review.md（blocking: 0）と handoff |
| G2D-05 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-05-Review.md（blocking: 0）と handoff |
| G2D-06 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-06-Review.md（blocking: 0）と handoff |
| G2D-07C | done | ATG: succeeded（main3 `5618d7f3…`、試行 1）。work/20260924-2230-Gate2Main3-G2D-07C-Review.md（blocking: 0）と handoff |
| G2D-07D | done | ATG: succeeded（main3 `5618d7f3…`、試行 1）。work/20260924-2230-Gate2Main3-G2D-07D-Review.md（blocking: 0）と handoff |
| G2D-08 | not-started | ATG: blocked（main3 `5618d7f3…`、起動していない）。失敗した祖先: G2Q-04C、G2Q-04D（main3 の graph の deps） |
| G2D-10 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-10-Review.md（blocking: 0）と handoff |
| G2D-11 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-11-Review.md（blocking: 0）と handoff |
| G2D-12 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-12-Review.md（blocking: 0）と handoff |
| G2D-12T | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-12T-Review.md（blocking: 0）と handoff |
| EXT-41 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-EXT-41-Review.md（blocking: 0）と handoff |
| EXT-X1 | done | ATG: succeeded（main3 `5618d7f3…`、試行 2）。work/20260924-2230-Gate2Main3-EXT-X1-Review.md（blocking: 0）と handoff |
| G2T-10 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2T-10-Review.md（blocking: 0）と handoff |
| G2T-11 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2T-11-Review.md（blocking: 0）と handoff |
| G2T-40 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2T-40-Review.md（blocking: 0）と handoff |
| G2T-50C | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2T-50C-Review.md（blocking: 0）と handoff |
| G2T-50D | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2T-50D-Review.md（blocking: 0）と handoff |
| G2T-60C | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2T-60C-Review.md（blocking: 0）と handoff |
| G2T-60D | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2T-60D-Review.md（blocking: 0）と handoff |
| G2X-01a | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2X-01a-Review.md（blocking: 0）と handoff |
| G2X-01b | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2X-01b-Review.md（blocking: 0）と handoff |
| G2X-01c | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2X-01c-Review.md（blocking: 0）と handoff |
| G2Q-01C | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2Q-01C-Review.md（blocking: 0）と handoff |
| G2Q-01D | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2Q-01D-Review.md（blocking: 0）と handoff |
| G2Q-01CM | done | ATG: succeeded（main3 `5618d7f3…`、試行 1）。work/20260924-2230-Gate2Main3-G2Q-01CM-Review.md（blocking: 0）と handoff |
| G2Q-01DM | done | ATG: succeeded（main3 `5618d7f3…`、試行 2）。work/20260924-2230-Gate2Main3-G2Q-01DM-Review.md（blocking: 0）と handoff |
| G2Q-02 | done | ATG: succeeded（main3 `5618d7f3…`、試行 1）。work/20260924-2230-Gate2Main3-G2Q-02-Review.md（blocking: 0）と handoff |
| G2Q-03C | done | ATG: succeeded（main5 `01ff4f75…`、試行 1）。work/20260925-0420-Gate2Main4-G2Q-03C-Review.md（blocking: 0）と handoff |
| G2Q-03D | done | ATG: succeeded（main6 `e52b01c9…`、試行 2）。work/20260925-0526-Gate2Main6-G2Q-03D-Review.md（blocking: 0）と handoff |
| G2Q-04C | failed | ATG: failed（main3 `5618d7f3…`）。所有者の指示（利用者の作業 session の除外。`work/20260924-2230-UserRulings3-ExecutionPlan.md` §1 の 3）により `node fail --class contract` |
| G2Q-04D | failed | ATG: failed（main3 `5618d7f3…`）。所有者の指示（利用者の作業 session の除外。`work/20260924-2230-UserRulings3-ExecutionPlan.md` §1 の 3）により `node fail --class contract` |
| G2Q-05C | not-started | ATG: blocked（main3 `5618d7f3…`、起動していない）。失敗した祖先: G2Q-04C（main3 の graph の deps） |
| G2Q-05D | not-started | ATG: blocked（main3 `5618d7f3…`、起動していない）。失敗した祖先: G2Q-04D（main3 の graph の deps） |
| G2Q-06C | not-started | ATG: blocked（main3 `5618d7f3…`、起動していない）。失敗した祖先: G2Q-04C（main3 の graph の deps） |
| G2Q-06D | not-started | ATG: blocked（main3 `5618d7f3…`、起動していない）。失敗した祖先: G2Q-04C、G2Q-04D（main3 の graph の deps） |
| G2A-01 | not-started | ATG: blocked（main3 `5618d7f3…`、起動していない）。失敗した祖先: G2Q-04C（main3 の graph の deps） |
| G2A-02 | not-started | ATG: blocked（main3 `5618d7f3…`、起動していない）。失敗した祖先: G2Q-04C、G2Q-04D（main3 の graph の deps） |
| G2A-03 | not-started | ATG: blocked（main3 `5618d7f3…`、起動していない）。失敗した祖先: G2Q-04C、G2Q-04D（main3 の graph の deps） |
| G2A-04 | not-started | ATG: blocked（main3 `5618d7f3…`、起動していない）。失敗した祖先: G2Q-04C、G2Q-04D（main3 の graph の deps） |
| G2V-01 | not-started | ATG: blocked（main3 `5618d7f3…`、起動していない）。失敗した祖先: G2Q-04C、G2Q-04D（main3 の graph の deps） |
