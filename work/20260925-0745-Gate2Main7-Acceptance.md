# Gate 2 main7 の受入

- 実行 ID: 8c3df57e-0c2c-4806-9be9-7eb74c082560
- 状態 DB: work\20260925-0745-Gate2Main7-atg-state\main.sqlite3
- 計画: work/20260925-0745-Gate2Main7-Plan.md、graph: work/20260925-0745-atg-graph-main7.json、契約: work/20260925-0745-atg-contract-main7.json（SHA-256 ad0191819b00f46cf7b113713a060606a5faf975b9623a75e91131da871b3fdb）
- node の終端（`python -m atg report`）: failed 2、blocked 2。
  - G2A-02: OWL-ViT の記録は保留（risk acceptance 2026-09-23 §4 の 1・2 を 2026-09-25 の判断が変更するかについて所有者の明示の回答が無い。docs/model-governance/evidence/2026-09-25-owner-ruling-assist-trial-deferral.md「既存の書面決定との関係」）。レビュー blocking 0（work/20260925-0745-Gate2Main7-G2A-02-Review.md の Round 2）、verify:docs exit 0、node の verify（承認の行）exit 1 の後、計画 §5 の規則で `node fail --class contract`。
  - G2A-01: SigLIP の記録の verify は exit 0、レビュー blocking 0（work/20260925-0745-Gate2Main7-G2A-01-Review.md の Round 2）。しかし `end` の補助 work/20260924-0620-atg-node.py の書込み検査が、同じ worktree で並列に進めた G2A-02 の変更（docs/model-governance/owlvit-base-patch32-adoption.md、work/20260925-0745-Gate2Main7-G2A-02-Review.md）を G2A-01 の宣言外書込みとして数え、`node fail --class contract` を記録した（補助 script の誤判定。main4 の G2Q-03C と同じ原因: work/20260925-0420-Gate2Main4-Acceptance.md）。G2A-01 は新しい実行 ID（main8）で記録し直し、G2A-03・G2D-08 は main8 で直列に行う（work/20260925-0745-make-main8.py）。
  - G2A-03・G2D-08: 依存の G2A-01 が failed のため blocked。
- acceptance の command（契約の `acceptance_command`）: exit 0（`pass 46`、`fail 0`）。
- `python -m atg report` の「総合結果: 成功」は、全ノードが終端し受入が `accepted=1` であることを表す（tools/atg/vendor/atg/report.py:64-70）。main7 の node は 1 つも succeeded ではない。
