主 run: 静止（失敗あり）
G2A-03: not-done

# Gate 2 終端状態の記録（主 run 0b7a6834-a226-4f48-b87c-5bc31dc2f2cd）

- 出典: `python -m atg report --execution-id 0b7a6834-a226-4f48-b87c-5bc31dc2f2cd --state work/20260924-1815-Gate2Main2-atg-state/main.sqlite3`（run finish の後、work/20260924-1815-Gate2-AtgReport.md に原文）。受入は work/20260924-1815-Gate2Main2-Acceptance.md。
- 前回の主 run（e7c6da3f-8f62-4785-b40e-fab254437a4b）の記録は work/20260924-1425-Gate2-TerminalState.md に残す。本 run は所有者の判断（work/20260924-1815-OwnerRulingExecutionPlan.md §1）を受けた再実行である。
- 状態の対応（work/202609232120-Gate2-NodeInventory.md §2）: succeeded → done、failed → failed、それ以外 → not-started。
- report の「総合結果」は全 node の終端と受入 exit 0 を示すだけで、Gate 2 の成功ではない（succeeded 24 / failed 3 / blocked 17）。Gate 2 の判定は BLOCKED。

| ID | 状態 | 根拠 |
|---|---|---|
| G2D-01 | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2D-01-Review.md（blocking: 0）と handoff |
| G2D-01T | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2D-01T-Review.md（blocking: 0）と handoff |
| G2D-02 | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2D-02-Review.md（blocking: 0）と handoff |
| G2D-02R | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2D-02R-Review.md（blocking: 0）と handoff |
| G2D-04 | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2D-04-Review.md（blocking: 0）と handoff |
| G2D-05 | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2D-05-Review.md（blocking: 0）と handoff |
| G2D-06 | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2D-06-Review.md（blocking: 0）と handoff |
| G2D-07C | failed | ATG: failed（node fail --class contract）。G2Q-01C の数値案の所有者の承認が得られていない（2026-09-24 に ask_user で問い、利用者は不在で回答なし。承認を作らない） |
| G2D-07D | failed | ATG: failed（node fail --class contract）。G2Q-01D の数値案の所有者の承認が得られていない（2026-09-24 に ask_user で問い、利用者は不在で回答なし。承認を作らない） |
| G2D-08 | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07C、G2D-07D（work/20260924-1815-atg-graph-main2.json の deps） |
| G2D-10 | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2D-10-Review.md（blocking: 0）と handoff |
| G2D-11 | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2D-11-Review.md（blocking: 0）と handoff |
| G2D-12 | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2D-12-Review.md（blocking: 0）と handoff |
| G2D-12T | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2D-12T-Review.md（blocking: 0）と handoff |
| EXT-41 | done | ATG: succeeded。work/20260924-1815-EXT-41-Review.md（blocking: 0）と handoff |
| EXT-X1 | failed | ATG: failed（node fail --class contract）。(a) の集約 npm test で 3/3 再現し、(b) の探索を行ったが原因は確定しない（確定の条件は E1 の計画 §3）。修正 node を作らない。work/20260924-0730-EXT-X1-ExecutionRecord.md |
| G2T-10 | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2T-10-Review.md（blocking: 0）と handoff |
| G2T-11 | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2T-11-Review.md（blocking: 0）と handoff |
| G2T-40 | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2T-40-Review.md（blocking: 0）と handoff |
| G2T-50C | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2T-50C-Review.md（blocking: 0）と handoff |
| G2T-50D | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2T-50D-Review.md（blocking: 0）と handoff |
| G2T-60C | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2T-60C-Review.md（blocking: 0）と handoff |
| G2T-60D | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2T-60D-Review.md（blocking: 0）と handoff |
| G2X-01a | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2X-01a-Review.md（blocking: 0）と handoff |
| G2X-01b | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2X-01b-Review.md（blocking: 0）と handoff |
| G2X-01c | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2X-01c-Review.md（blocking: 0）と handoff |
| G2Q-01C | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2Q-01C-Review.md（blocking: 0）と handoff |
| G2Q-01D | done | ATG: succeeded。work/20260924-1815-Gate2Main2-G2Q-01D-Review.md（blocking: 0）と handoff |
| G2Q-01CM | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07C（work/20260924-1815-atg-graph-main2.json の deps） |
| G2Q-01DM | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07D（work/20260924-1815-atg-graph-main2.json の deps） |
| G2Q-02 | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07C、G2D-07D（work/20260924-1815-atg-graph-main2.json の deps） |
| G2Q-03C | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07C（work/20260924-1815-atg-graph-main2.json の deps） |
| G2Q-03D | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07D（work/20260924-1815-atg-graph-main2.json の deps） |
| G2Q-04C | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07C（work/20260924-1815-atg-graph-main2.json の deps） |
| G2Q-04D | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07D（work/20260924-1815-atg-graph-main2.json の deps） |
| G2Q-05C | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07C（work/20260924-1815-atg-graph-main2.json の deps） |
| G2Q-05D | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07D（work/20260924-1815-atg-graph-main2.json の deps） |
| G2Q-06C | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07C、G2D-07D（work/20260924-1815-atg-graph-main2.json の deps） |
| G2Q-06D | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07C、G2D-07D（work/20260924-1815-atg-graph-main2.json の deps） |
| G2A-01 | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07C、G2D-07D（work/20260924-1815-atg-graph-main2.json の deps） |
| G2A-02 | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07C、G2D-07D（work/20260924-1815-atg-graph-main2.json の deps） |
| G2A-03 | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07C、G2D-07D（work/20260924-1815-atg-graph-main2.json の deps） |
| G2A-04 | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-07C、G2D-07D（work/20260924-1815-atg-graph-main2.json の deps） |
| G2V-01 | not-started | ATG: blocked（起動していない）。失敗した祖先: EXT-X1、G2D-07C、G2D-07D（work/20260924-1815-atg-graph-main2.json の deps） |
