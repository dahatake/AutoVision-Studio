# Gate 2 main4 の受入

- 実行 ID: 84e8cb29-8aa9-40b6-bcab-411bfae30eff
- 状態 DB: work\20260925-0420-Gate2Main4-atg-state\main.sqlite3
- 計画: work/20260925-0420-G2Q03-ExecutionPlan.md の lane G、graph: work/20260925-0420-atg-graph-main4.json、契約: work/20260925-0420-atg-contract-main4.json（SHA-256 8170a95f0dc18ca23600ba6038920fe284f2800e3765f75fd9713c0ed864ab0d）
- node の終端（`python -m atg report`）: failed 2。
  - G2Q-03D: 測定が `verdict: FAIL`（検出の box 差 0.048〜0.075 px が許容差 `1.0e-03` を超える。`spikes/models/owlvit-assist-result.md` §7）。レビュー blocking 0（`work/20260925-0420-Gate2Main4-G2Q-03D-Review.md`）の後、Gate 2 計画の規則で `node fail --class contract`。
  - G2Q-03C: 測定は `verdict: PASS`、verify は exit 0、レビュー blocking 0（`work/20260925-0420-Gate2Main4-G2Q-03C-Review.md`）。しかし `end` の補助 `work/20260924-0620-atg-node.py` の書込み検査が、同じ worktree で並列に進めた G2Q-03D の変更（`spikes/models/owlvit-assist-result.md`、`spikes/models/owlvit_assist_parity.py`）を G2Q-03C の宣言外書込みとして数え、`node fail --class contract` を記録した（補助 script の誤判定。補助 script は begin からの worktree 全体の差分を見るため、並列の node を区別しない）。G2Q-03C は新しい実行 ID（main5）で記録し直す（work/20260925-0420-make-main5.py）。
- 静止の確認: `node next` → `{"runnable": []}`
- acceptance の command（契約の `acceptance_command`。npm 12.0.0 を PATH の先頭に置き、`npm run verify:docs` と `node --test scripts/models/manifest-schema.test.mjs`）: exit 0（`pass 46`、`fail 0`）。
- 1 回目の `run finish` は本 file の作成前に呼んだため `{"accepted": false}`（evidence の file が無い: `tools/atg/vendor/atg/cli.py:466`）。本 file の作成後に再び呼んだ。
- `python -m atg report` の「総合結果: 成功」は、全ノードが終端し受入が `accepted=1` であることを表す（`tools/atg/vendor/atg/report.py:64-70`）。G2Q-03D は failed で、Gate 2 は BLOCKED のままである。
