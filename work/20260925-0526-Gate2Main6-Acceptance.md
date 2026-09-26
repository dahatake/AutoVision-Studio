# Gate 2 main6 の受入

- 実行 ID: e52b01c9-2f58-4024-abf9-8d74f4671c85
- 状態 DB: work\20260925-0526-Gate2Main6-atg-state\main.sqlite3
- 目的: main4（84e8cb29-8aa9-40b6-bcab-411bfae30eff）で failed になった G2Q-03D の検出単位 parity を、所有者の判断 G2Q-03D-T（選択 A。docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03D-parity.md）の判定 A1〜A3 で測り直す（対策案 work/20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md）。graph: work/20260925-0526-atg-graph-main6.json（G2Q-03D だけ）、契約: work/20260925-0526-atg-contract-main6.json（SHA-256 b5d926732e5ca70286f85a64127be057819ce1b44594379a6e457b25550c5426）。生成: work/20260925-0526-make-main6.py
- node の終端: succeeded 1（G2Q-03D、attempt 2）。attempt 1 は、begin の前に作った検査の補助 `work/20260925-0526-check-parity-A.py` を begin の後に直したため `node fail --class implementation` とした（work/20260925-0526-Gate2Main6-G2Q-03D-Review.md §1）。attempt 2 の測定は exit 0（`verdict: PASS`、出力 JSON の SHA-256 `1d45b869…29ed3`）、verify exit 0、書込み検査の違反 0、`node finish` 済み。レビュー: work/20260925-0526-Gate2Main6-G2Q-03D-Review.md（blocking 0）。
- node end の後、レビューの No. 1・No. 2 に従って `check-parity-A.py` に空の検出・`failures` の検査を加え、同じ JSON で exit 0、壊した JSON 3 種（検出が空、最上位の `failures`、比較の `failures`）で exit 1 を確認した。
- 静止の確認: `node next` → `{"runnable": []}`
- acceptance の command（契約の `acceptance_command`。npm 12.0.0 を PATH の先頭に置き、`npm run verify:docs` と `node --test scripts/models/manifest-schema.test.mjs`）: exit 0（`pass 46`、`fail 0`）。
- `python -m atg report` の「総合結果: 成功」は、全ノードが終端し受入が `accepted=1` であることを表す（`tools/atg/vendor/atg/report.py:64-70`）。
