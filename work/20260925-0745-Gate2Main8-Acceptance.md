# Gate 2 main8 の受入

- 実行 ID: 6cfad899-a4d7-4f12-8abd-82738be3209f
- 状態 DB: work\20260925-0745-Gate2Main8-atg-state\main.sqlite3
- graph: work/20260925-0745-atg-graph-main8.json、契約: work/20260925-0745-atg-contract-main8.json（SHA-256 86528ef1b083f2354ce4a7dfe14cd43298da073833e03c24ebf44970fdc242f0）。work/20260925-0745-make-main8.py が main7 の node の定義から作った（G2A-02 を除く）
- 理由: main7（8c3df57e-0c2c-4806-9be9-7eb74c082560）で G2A-01 が補助 script の誤判定で failed になったため（work/20260925-0745-Gate2Main7-Acceptance.md）。main8 では node を 1 つずつ直列に進めた。
- node の終端: succeeded 3。
  - G2A-01: SigLIP の採用記録の承認（record の編集は main7 の試行中に行い、main8 の begin〜end の間の変更は無い: `{"changed": []}`）。verify exit 0、レビュー blocking 0（work/20260925-0745-Gate2Main7-G2A-01-Review.md）。
  - G2A-03: manifest に SigLIP の C7 分類 entry を登録（`releaseStatus.ready=false` のまま）、`EXPECTED_APPROVED_ENTRIES` を 3。verify exit 0、レビュー blocking 0（work/20260925-0745-Gate2Main7-G2A-03-Review.md）。
  - G2D-08: 製品版 `0.1.12`（所有者の委任による記録者の決定。docs/model-governance/evidence/2026-09-25-owner-ruling-G2D-08.md）。verify exit 0、レビュー blocking 0（work/20260925-0745-Gate2Main7-G2D-08-Review.md）。
- 静止の確認: `node next` → `{"runnable": []}`
- acceptance の command（契約の `acceptance_command`）: exit 0（`pass 46`、`fail 0`）。
- 本実行の受入は、Gate 2 の `ready=true` を意味しない。OWL-ViT（G2A-02）は main7 で保留として終端し、比較試験（NFR-ANN-006）は出荷条件として残る。
