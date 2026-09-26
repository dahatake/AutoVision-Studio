# Gate 2 終端状態の記録（main10 の後、2026-09-26）

主 run: 全成功
G2A-03: done

- 出典: 前回の記録 [`20260926-0848-Gate2-TerminalState.md`](20260926-0848-Gate2-TerminalState.md)（main9 の後）の各 node の状態に、main10（G2V-01 と終端化。受入 work/20260926-1100-Gate2Main10-Acceptance.md）の `python -m atg report` の結果を重ねた。計画は work/20260926-0955-OwnerRulings6-ExecutionPlan.md。
- 状態の求め方は前回と同じ（node の状態は、その node を含む最後の run の状態。succeeded → done、failed → failed、それ以外 → not-started）。
- 44 node の最後の状態: done 44 / failed 0 / not-started 0。Gate 2 計画 §8.21 の「全成功」が成り立ち、G2F-01m で `releaseStatus.ready=true`・`productVersion` `0.1.12` を記録した。比較試験（G2Q-04C〜06D）の `done` は免除の記録であり、比較試験の合格ではない（Gate 2 計画 §8.14・§8.21 の注記 2026-09-26）。
- PKG-01（release verifier）は未実装であり、`ready=true` の manifest を PKG-01 の照合の前に出荷物へ使わない（Gate 2 計画 §8.21、ADR-0004）。

| ID | 状態 | 根拠 |
|---|---|---|
| G2D-01 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-01-Review.md（blocking: 0）と handoff |
| G2D-01T | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-01T-Review.md（blocking: 0）と handoff |
| G2D-02 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-02-Review.md（blocking: 0）と handoff |
| G2D-02R | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-02R-Review.md（blocking: 0）と handoff |
| G2D-04 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-04-Review.md（blocking: 0）と handoff |
| G2D-05 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-05-Review.md（blocking: 0）と handoff |
| G2D-06 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-06-Review.md（blocking: 0）と handoff |
| G2D-07C | done | ATG: succeeded（main3 `5618d7f3…`、試行 1）。work/20260924-2230-Gate2Main3-G2D-07C-Review.md（blocking: 0）と handoff |
| G2D-07D | done | ATG: succeeded（main3 `5618d7f3…`、試行 1）。work/20260924-2230-Gate2Main3-G2D-07D-Review.md（blocking: 0）と handoff |
| G2D-08 | done | ATG: succeeded（main8 `6cfad899…`、試行 1）。所有者の委任により `0.1.12`（docs/model-governance/evidence/2026-09-25-owner-ruling-G2D-08.md）。work/20260925-0745-Gate2Main7-G2D-08-Review.md（blocking: 0）と handoff |
| G2D-10 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-10-Review.md（blocking: 0）と handoff |
| G2D-11 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-11-Review.md（blocking: 0）と handoff |
| G2D-12 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-12-Review.md（blocking: 0）と handoff |
| G2D-12T | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2D-12T-Review.md（blocking: 0）と handoff |
| EXT-41 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-EXT-41-Review.md（blocking: 0）と handoff |
| EXT-X1 | done | ATG: succeeded（main3 `5618d7f3…`、試行 2）。work/20260924-2230-Gate2Main3-EXT-X1-Review.md（blocking: 0）と handoff |
| G2T-10 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2T-10-Review.md（blocking: 0）と handoff |
| G2T-11 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2T-11-Review.md（blocking: 0）と handoff |
| G2T-40 | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2T-40-Review.md（blocking: 0）と handoff |
| G2T-50C | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2T-50C-Review.md（blocking: 0）と handoff |
| G2T-50D | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2T-50D-Review.md（blocking: 0）と handoff |
| G2T-60C | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2T-60C-Review.md（blocking: 0）と handoff |
| G2T-60D | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2T-60D-Review.md（blocking: 0）と handoff |
| G2X-01a | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2X-01a-Review.md（blocking: 0）と handoff |
| G2X-01b | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2X-01b-Review.md（blocking: 0）と handoff |
| G2X-01c | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2X-01c-Review.md（blocking: 0）と handoff |
| G2Q-01C | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2Q-01C-Review.md（blocking: 0）と handoff |
| G2Q-01D | done | ATG: succeeded（main2 `0b7a6834…`、試行 1）。work/20260924-1815-Gate2Main2-G2Q-01D-Review.md（blocking: 0）と handoff |
| G2Q-01CM | done | ATG: succeeded（main3 `5618d7f3…`、試行 1）。work/20260924-2230-Gate2Main3-G2Q-01CM-Review.md（blocking: 0）と handoff |
| G2Q-01DM | done | ATG: succeeded（main3 `5618d7f3…`、試行 2）。work/20260924-2230-Gate2Main3-G2Q-01DM-Review.md（blocking: 0）と handoff |
| G2Q-02 | done | ATG: succeeded（main3 `5618d7f3…`、試行 1）。work/20260924-2230-Gate2Main3-G2Q-02-Review.md（blocking: 0）と handoff |
| G2Q-03C | done | ATG: succeeded（main5 `01ff4f75…`、試行 1）。work/20260925-0420-Gate2Main4-G2Q-03C-Review.md（blocking: 0）と handoff |
| G2Q-03D | done | ATG: succeeded（main6 `e52b01c9…`、試行 2）。work/20260925-0526-Gate2Main6-G2Q-03D-Review.md（blocking: 0）と handoff |
| G2Q-04C | done | ATG: succeeded（main9 `860384d4…`、試行 1）。免除（所有者の判断 docs/model-governance/evidence/2026-09-26-owner-rulings.md。比較試験を Version 1 の実施対象から削除し、未実施のまま完了扱い）の記録で閉じた（Gate 2 計画 §8.14 の注記 2026-09-26）。`done` は免除の記録を表し、session・合格の記録ではない。work/20260926-0815-Q1-Review.md（blocking: 0）と handoff |
| G2Q-04D | done | ATG: succeeded（main9 `860384d4…`、試行 1）。免除（所有者の判断 docs/model-governance/evidence/2026-09-26-owner-rulings.md。比較試験を Version 1 の実施対象から削除し、未実施のまま完了扱い）の記録で閉じた（Gate 2 計画 §8.14 の注記 2026-09-26）。`done` は免除の記録を表し、session・合格の記録ではない。work/20260926-0815-Q1-Review.md（blocking: 0）と handoff |
| G2Q-05C | done | ATG: succeeded（main9 `860384d4…`、試行 1）。免除（所有者の判断 docs/model-governance/evidence/2026-09-26-owner-rulings.md。比較試験を Version 1 の実施対象から削除し、未実施のまま完了扱い）の記録で閉じた（Gate 2 計画 §8.14 の注記 2026-09-26）。`done` は免除の記録を表し、session・合格の記録ではない。work/20260926-0815-Q1-Review.md（blocking: 0）と handoff |
| G2Q-05D | done | ATG: succeeded（main9 `860384d4…`、試行 1）。免除（所有者の判断 docs/model-governance/evidence/2026-09-26-owner-rulings.md。比較試験を Version 1 の実施対象から削除し、未実施のまま完了扱い）の記録で閉じた（Gate 2 計画 §8.14 の注記 2026-09-26）。`done` は免除の記録を表し、session・合格の記録ではない。work/20260926-0815-Q1-Review.md（blocking: 0）と handoff |
| G2Q-06C | done | ATG: succeeded（main9 `860384d4…`、試行 1）。免除（所有者の判断 docs/model-governance/evidence/2026-09-26-owner-rulings.md。比較試験を Version 1 の実施対象から削除し、未実施のまま完了扱い）の記録で閉じた（Gate 2 計画 §8.14 の注記 2026-09-26）。`done` は免除の記録を表し、session・合格の記録ではない。work/20260926-0815-Q1-Review.md（blocking: 0）と handoff |
| G2Q-06D | done | ATG: succeeded（main9 `860384d4…`、試行 1）。免除（所有者の判断 docs/model-governance/evidence/2026-09-26-owner-rulings.md。比較試験を Version 1 の実施対象から削除し、未実施のまま完了扱い）の記録で閉じた（Gate 2 計画 §8.14 の注記 2026-09-26）。`done` は免除の記録を表し、session・合格の記録ではない。work/20260926-0815-Q1-Review.md（blocking: 0）と handoff |
| G2A-01 | done | ATG: succeeded（main8 `6cfad899…`、試行 1）。main7 `8c3df57e…` では補助 script の書込み検査の誤判定で failed（work/20260925-0745-Gate2Main7-Acceptance.md）。work/20260925-0745-Gate2Main7-G2A-01-Review.md（blocking: 0）と handoff |
| G2A-02 | done | ATG: succeeded（main9 `860384d4…`、試行 1）。main7 `8c3df57e…` では保留として failed。所有者の判断（2026-09-26）の「はい」で risk acceptance §4 の 1・2 の保留が解け、OWL-ViT の採用記録を承認とした。work/20260926-0815-A2-Review.md（blocking: 0）と handoff |
| G2A-03 | done | ATG: succeeded（main9 `860384d4…`、試行 1。OWL-ViT の C7 検出 entry）。main8 `6cfad899…` で SigLIP の C7 分類 entry を登録済み。work/20260926-0815-A3-Review.md（blocking: 0）と handoff |
| G2A-04 | done | ATG: succeeded（main9 `860384d4…`、試行 1）。設定画面に OWL-ViT の研究目的に限る利用条件と NOTICE を表示。work/20260926-0815-A4-Review.md（blocking: 0）と handoff |
| G2V-01 | done | ATG: succeeded（main10、試行 1）。製品版 `0.1.12`（G2D-08）を `package.json` / `package-lock.json` に適用（`npm version 0.1.12 --no-git-tag-version`）。`verify:version`・`test:version`・`typecheck`・`build` が exit 0、tag は増えていない。集約 `npm test` は 1 回目が exit 1（`sample-assets.test.ts` の ctime の変化による fail-closed）、再実行が exit 0（work/20260926-1055-G2V01-checks.raw.log、work/20260926-1055-G2V01-npmtest-retry.raw.log）。前提の GAL-V1 `0.1.11` は work/20260926-1045-GALV1-Record.md。work/20260926-1100-Gate2Final-Review.md（blocking: 0）と handoff |
