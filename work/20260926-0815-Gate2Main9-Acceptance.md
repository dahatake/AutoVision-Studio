# Gate 2 main9 の受入

- 実行 ID: 860384d4-4af8-4b3a-baef-f64adacb3b98
- 状態 DB: work\20260926-0815-Gate2Main9-atg-state\main.sqlite3
- graph: work/20260926-0815-atg-graph-main9.json、契約: work/20260926-0815-atg-contract-main9.json（SHA-256 4eee90dfb10bc3a42d17fd57c1a31cd840f1eb6c8eefc91b28cb3727a93651ed）。生成: work/20260926-0815-make-main9.py。計画: work/20260926-0815-OwnerRulings5-ExecutionPlan.md。
- node の終端: succeeded 9（report: work/20260926-0815-Gate2Main9-Report.md）。各 node は `work/20260926-0815-Gate2Main9-verify.ps1` の verify が exit 0、書込み検査は `{"changed": []}`（各 node の編集は node の begin の前に行い、敵対的レビューを経ている）。
  - G2Q-04C / 04D / 05C / 05D / 06C / 06D: 比較試験を実施せず、免除（未実施のまま完了扱い）の記録で閉じた（所有者の判断 docs/model-governance/evidence/2026-09-26-owner-rulings.md、Gate 2 計画 §8.14 の注記 2026-09-26）。`done` は免除の記録を表し、session の記録・比較試験の合格を表さない。レビュー: work/20260926-0815-Q1-Review.md（blocking: 0）。
  - G2A-02: OWL-ViT の採用記録の承認。Gate 2 計画 §8.16 の判定（承認の行と artifact の SHA-256）が合格。レビュー: work/20260926-0815-A2-Review.md（blocking: 0）。
  - G2A-03: manifest の OWL-ViT の C7 検出 entry と `EXPECTED_APPROVED_ENTRIES = 4`。レビュー: work/20260926-0815-A3-Review.md（blocking: 0）。
  - G2A-04: 設定画面の研究目的に限る利用条件と NOTICE の表示。レビュー: work/20260926-0815-A4-Review.md（blocking: 0）。
- 実行中の事象:
  - G2A-02 の終了の直後の G2A-03 の `begin` で `node start` が `{"error": "node is not runnable: G2A-03"}` を返した。補助 script の続く `node fail` は `node is not running` で拒否され、G2A-03 の状態は `pending`（試行 0）のままだった。原因は調べていない。G2A-04 の完了の後の `node next` は `{"runnable": ["G2A-03"]}` を返し、G2A-03 は試行 1 で succeeded になった（G2A-03 と G2A-04 はどちらも G2A-02 だけに依存し、順序の制約は無い）。
  - 1 回目の `run finish` は、受入の command の呼び出し方の誤り（外側の shell が `-Command` の文字列の中の `$env:PATH` を展開したため、`npm --version` の確認が exit 2）で `--acceptance-exit 2` を渡し、`{"accepted": false}` が記録された。command の中身を file にして `pwsh -File` で実行し直し、exit 0（`verify:docs`、manifest の test 44 件成功、SettingsPage の test 31 件成功。出力: work/20260926-0815-Gate2Main9-acceptance.raw.log）で 2 回目の `run finish` が `{"accepted": true}` を返した。report の終端受入は `accepted=1`。
- 静止の確認: `node next` → `{"runnable": []}`。
- 本実行の受入は、Gate 2 の完了や `releaseStatus.ready=true` を意味しない。G2V-01（製品版の適用）は main9 に含めていない（集約 `npm test` の exit 0 が成り立たず、GAL-V1 の `0.1.11` も未適用のため。計画 R-7）。
