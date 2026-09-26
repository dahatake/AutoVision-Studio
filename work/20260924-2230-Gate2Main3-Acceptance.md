# Gate 2 main3 の受入

- 実行 ID: 5618d7f3-f408-4e3d-bc2b-a745c1602a19
- 状態 DB: work\20260924-2230-Gate2Main3-atg-state\main.sqlite3
- 計画: work/20260924-2230-UserRulings3-ExecutionPlan.md の lane G、graph: work/20260924-2230-atg-graph-main3.json、契約: work/20260924-2230-atg-contract-main3.json（SHA-256 5617a496a6ae4d3a3d7813146dffd6367aed303402ae35921441eb640793a77b）
- node の終端（`python -m atg report`）: succeeded 9（EXT-X1、EXT-X1-F1〜F3、G2D-07C、G2D-07D、G2Q-01CM、G2Q-01DM、G2Q-02）、failed 4（G2Q-03C / 03D: 承認された計画に閾値の選び方が無い、G2Q-04C / 04D: 所有者の除外。いずれも `--class contract`）、blocked 10（失敗したノードの後続: G2Q-05C / 05D、G2Q-06C / 06D、G2V-01、G2A-01〜04、G2D-08）。
- 静止の確認: `node next` → `{"runnable": []}`
- acceptance の command（契約の `acceptance_command` と同じ内容。npm 12.0.0 を PATH の先頭に置き、`npm run verify:docs` と `node --test scripts/models/manifest-schema.test.mjs`）: exit 0（`pass 46`、`fail 0`）。
- EXT-X1 は ATG のノードとしては完了（計画 §4 の Vitest3 と Confirmation）。集約 `npm test` の 3 回続けての exit 0（UserRulings3 の lane X の完了条件 (3)）は満たしていない（`work/20260924-2230-EXT-X1-RootCause.md` §3）。
- `work/20260924-2230-Gate2Main3-Report.md` の「総合結果: 成功」は `python -m atg report` の出力で、全ノードが終端し受入が `accepted=1` であることを表す（`tools/atg/vendor/atg/report.py:64-70`）。failed 4・blocked 10 があり、Gate 2 は BLOCKED のままである。
