# Gate 2 main5 の受入

- 実行 ID: 01ff4f75-d29a-453b-bb71-8e9bbb492a89
- 状態 DB: work\20260925-0420-Gate2Main5-atg-state\main.sqlite3
- 目的: main4（84e8cb29-8aa9-40b6-bcab-411bfae30eff）で補助 script の誤判定により failed になった G2Q-03C を記録し直す（work/20260925-0420-Gate2Main4-Acceptance.md）。graph: work/20260925-0420-atg-graph-main5.json（G2Q-03C だけ。node の定義は main4 と同一）、契約: work/20260925-0420-atg-contract-main5.json（SHA-256 5b0f47d3defe1e4432e94ca166bee45f5d26426aac2c08eb318d9d40e9466f37）。生成: work/20260925-0420-make-main5.py
- node の終端（`python -m atg report`）: succeeded 1（G2Q-03C）。node の開始後に計画の command で測定をやり直し（exit 0、出力 JSON の SHA-256 は main4 の測定と同じ `2b62e184…b329`）、verify exit 0、書込み検査の違反 0、`node finish` 済み。レビュー: work/20260925-0420-Gate2Main4-G2Q-03C-Review.md（追記を含め blocking 0）。
- 静止の確認: `node next` → `{"runnable": []}`
- acceptance の command（契約の `acceptance_command`。npm 12.0.0 を PATH の先頭に置き、`npm run verify:docs` と `node --test scripts/models/manifest-schema.test.mjs`）: exit 0（`pass 46`、`fail 0`）。
- G2Q-03D は main4 で failed のまま（測定の `FAIL`）。Gate 2 は BLOCKED のままである。
- `python -m atg report` の「総合結果: 成功」は、全ノードが終端し受入が `accepted=1` であることを表す（`tools/atg/vendor/atg/report.py:64-70`）。G2Q-03D は failed で、Gate 2 は BLOCKED のままである。
