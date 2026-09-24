主 run: 静止（失敗あり）
G2A-03: not-done

# Gate 2 終端状態の記録（主 run e7c6da3f-8f62-4785-b40e-fab254437a4b）

- 出典: `python -m atg report --execution-id e7c6da3f-8f62-4785-b40e-fab254437a4b --state work/20260924-0730-Gate2Main-atg-state/main.sqlite3`（A4 の後、work/20260924-1425-Gate2-AtgReport.md に原文）。
- 状態の対応（work/202609232120-Gate2-NodeInventory.md §2）: succeeded → done、failed → failed、それ以外 → not-started。
- report の「総合結果: 成功」は全 node の終端と受入 exit 0 を示すだけで、Gate 2 の成功ではない（failed 9 / blocked 26）。Gate 2 の判定は BLOCKED。

| ID | 状態 | 根拠 |
|---|---|---|
| G2D-01 | failed | ATG: failed（node fail --class contract）。所有者の回答なし（未判断）。work/20260924-0740-Gate2Main-UndecidedRulings.md:19 |
| G2D-01T | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01（work/202609232120-atg-graph-main.json の deps） |
| G2D-02 | failed | ATG: failed（node fail --class contract）。所有者の回答なし（未判断）。work/20260924-0740-Gate2Main-UndecidedRulings.md:20 |
| G2D-02R | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-02（work/202609232120-atg-graph-main.json の deps） |
| G2D-04 | failed | ATG: failed（node fail --class contract）。所有者の回答なし（未判断、G2T-40 の後に起動）。work/20260924-0740-Gate2Main-UndecidedRulings.md:21 |
| G2D-05 | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01（work/202609232120-atg-graph-main.json の deps） |
| G2D-06 | failed | ATG: failed（node fail --class contract）。所有者の回答なし（未判断）。work/20260924-0740-Gate2Main-UndecidedRulings.md:23 |
| G2D-07C | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01（work/202609232120-atg-graph-main.json の deps） |
| G2D-07D | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01（work/202609232120-atg-graph-main.json の deps） |
| G2D-08 | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01、G2D-02、G2D-04、G2D-06、G2D-12（work/202609232120-atg-graph-main.json の deps） |
| G2D-10 | failed | ATG: failed（node fail --class contract）。所有者の回答なし（未判断）。work/20260924-0740-Gate2Main-UndecidedRulings.md:24、:30 |
| G2D-11 | failed | ATG: failed（node fail --class contract）。導入の指示はあるが、導入方法の組織承認が未確認で「用意の完了」が成立しない。docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-11.md:20 |
| G2D-12 | failed | ATG: failed（node fail --class contract）。所有者の回答なし（未判断）。work/20260924-0740-Gate2Main-UndecidedRulings.md:26 |
| G2D-12T | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01、G2D-12（work/202609232120-atg-graph-main.json の deps） |
| EXT-41 | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-04（work/202609232120-atg-graph-main.json の deps） |
| EXT-X1 | failed | ATG: failed（node fail --class contract）。原因調査で再現 0/3、原因未確定のため修正 node を作らず failed。work/20260924-0730-EXT-X1-ExecutionRecord.md、work/20260924-0730-EXT-X1-Status.md |
| G2T-10 | failed | ATG: failed（node fail --class contract）。parity の実測が FAIL（logit 最大差が許容差を超過）。spikes/models/classification-checkpoint-result.md:126、:141、work/20260924-0730-Gate2Main-G2T-10-Review.md |
| G2T-11 | done | ATG: succeeded。work/20260924-0730-Gate2Main-G2T-11-Review.md（blocking: 0）と handoff |
| G2T-40 | done | ATG: succeeded。work/20260924-0730-Gate2Main-G2T-40-Review.md（blocking: 0）と handoff |
| G2T-50C | done | ATG: succeeded。work/20260924-0730-Gate2Main-G2T-50C-Review.md（blocking: 0）と handoff |
| G2T-50D | done | ATG: succeeded。work/20260924-0730-Gate2Main-G2T-50D-Review.md（blocking: 0）と handoff |
| G2T-60C | done | ATG: succeeded。work/20260924-0730-Gate2Main-G2T-60C-Review.md（blocking: 0）と handoff |
| G2T-60D | done | ATG: succeeded。work/20260924-0730-Gate2Main-G2T-60D-Review.md（blocking: 0）と handoff |
| G2X-01a | done | ATG: succeeded。work/20260924-0730-Gate2Main-G2X-01a-Review.md（blocking: 0）と handoff |
| G2X-01b | done | ATG: succeeded。work/20260924-0730-Gate2Main-G2X-01b-Review.md（blocking: 0）と handoff |
| G2X-01c | done | ATG: succeeded。work/20260924-0730-Gate2Main-G2X-01c-Review.md（blocking: 0）と handoff |
| G2Q-01C | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01（work/202609232120-atg-graph-main.json の deps） |
| G2Q-01D | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01（work/202609232120-atg-graph-main.json の deps） |
| G2Q-01CM | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01（work/202609232120-atg-graph-main.json の deps） |
| G2Q-01DM | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01（work/202609232120-atg-graph-main.json の deps） |
| G2Q-02 | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01、G2D-02（work/202609232120-atg-graph-main.json の deps） |
| G2Q-03C | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01（work/202609232120-atg-graph-main.json の deps） |
| G2Q-03D | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01（work/202609232120-atg-graph-main.json の deps） |
| G2Q-04C | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01、G2D-02、G2D-04（work/202609232120-atg-graph-main.json の deps） |
| G2Q-04D | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01、G2D-02、G2D-04（work/202609232120-atg-graph-main.json の deps） |
| G2Q-05C | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01、G2D-02、G2D-04（work/202609232120-atg-graph-main.json の deps） |
| G2Q-05D | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01、G2D-02、G2D-04（work/202609232120-atg-graph-main.json の deps） |
| G2Q-06C | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01、G2D-02、G2D-04（work/202609232120-atg-graph-main.json の deps） |
| G2Q-06D | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01、G2D-02、G2D-04（work/202609232120-atg-graph-main.json の deps） |
| G2A-01 | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01、G2D-02、G2D-04、G2D-12（work/202609232120-atg-graph-main.json の deps） |
| G2A-02 | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01、G2D-02、G2D-04、G2D-06、G2D-12（work/202609232120-atg-graph-main.json の deps） |
| G2A-03 | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01、G2D-02、G2D-04、G2D-06、G2D-12（work/202609232120-atg-graph-main.json の deps） |
| G2A-04 | not-started | ATG: blocked（起動していない）。失敗した祖先: G2D-01、G2D-02、G2D-04、G2D-06、G2D-12（work/202609232120-atg-graph-main.json の deps） |
| G2V-01 | not-started | ATG: blocked（起動していない）。失敗した祖先: EXT-X1、G2D-01、G2D-02、G2D-04、G2D-06、G2D-10、G2D-11、G2D-12（work/202609232120-atg-graph-main.json の deps） |
