# Gate 2 終端化 run 4（Final4）の受入記録

- 実行ID: efc44691-c372-4dff-9bfd-de77abb6ca6d
- 契約: work/20260925-0620-atg-contract-final4.json（sha256 8a2912fe15e8c4acccc1b83c9563e70f4dbc5207b9eb190262dc40927ed8c778）
- 受入コマンド（契約の acceptance_command）の exit: 0。内容は、検査 script（work/20260925-0620-Gate2-TerminalState-check.ps1）、`node --test scripts/models/manifest-schema.test.mjs`、work/20260925-0620-Gate2-RemainTaskExecution.md の存在、npm `12.0.0` の `npm run verify:docs`。

## 結果

- G2F-00、G2F-01r、G2F-01a1、G2F-01a3、G2F-03 はすべて試行 1 で succeeded。各 node の敵対的レビューは work/20260925-0620-Gate2Final4-<ID>-Review.md（すべて `blocking: 0`）。
- `accepted` が示すのは、本 run の全 node の終端と受入 exit 0 だけである。記録した Gate 2 の状態は **BLOCKED / NOT_COMPLETE**（44 node: succeeded 32 / failed 2 / blocked 10。work/20260925-0620-Gate2-TerminalState.md）で、manifest は承認 2 件・`ready=false` のまま。
- 前の終端化 run 3（1b0c0c99-cb55-4e3f-9140-b5fd1a355a14）は不合格（work/20260925-0620-Gate2Final3-Acceptance.md）。
