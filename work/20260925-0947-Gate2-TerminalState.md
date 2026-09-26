# Gate 2 終端状態の記録（main7・main8 の後、2026-09-25）

- 出典: 前回の記録（main2〜main6 の後。終端化 run 4 `efc44691-c372-4dff-9bfd-de77abb6ca6d` の G2F-00 の成果物。work/20260925-0620-Gate2-AtgReport.md）の各 node の状態に、main7（実行 `8c3df57e-0c2c-4806-9be9-7eb74c082560`、受入 work/20260925-0745-Gate2Main7-Acceptance.md）と main8（実行 `6cfad899-a4d7-4f12-8abd-82738be3209f`、受入 work/20260925-0745-Gate2Main8-Acceptance.md）の `python -m atg report` の結果を重ねた。計画は work/20260925-0745-Gate2Main7-Plan.md。
- 状態の求め方は前回と同じ（node の状態は、その node を含む最後の run の状態。succeeded → done、failed → failed、それ以外 → not-started）。main7 / main8 の graph に含めなかった node は、その理由を根拠の欄に書く。
- 各 report の「総合結果」は、その run の全 node の終端と受入 exit 0 を示すだけで、Gate 2 の成功ではない（44 node の最後の状態: succeeded 35 / failed 3 / not-started 6）。Gate 2 の判定は **NOT_COMPLETE**（OWL-ViT の採用 G2A-02 が保留、G2A-04・G2V-01 が未起動）。比較試験（NFR-ANN-006）は所有者の判断（docs/model-governance/evidence/2026-09-25-owner-ruling-assist-trial-deferral.md「判断」1）で Gate 2 のタスクから外しており、Gate 2 の node ではない。ただし、この判断は Gate 2 計画 §8.21 の「全成功」（`ready=true`。比較試験の `PASS` を含む）の定義を変えていないため、Gate 2 の全成功は所有者が比較試験の合格を記録した後になる（同計画 §8.21 の注記）。
- Gate 2 の再開に要るもの: (1) 2026-09-25 07:44 の判断が 2026-09-23 C7 検出 risk acceptance §4 の 1・2 を変更するかについての所有者の明示の回答（G2A-02・G2A-04）。(2) G2V-01 を行える状態: `releaseStatus.ready=true` を記録できること。これは、release 対象の版を `ready=false` の manifest に先に書かない規則（CONTRIBUTING.md L182、docs/implementation-plan.md L394）と、`ready=true` に比較試験の合格の記録（`releaseStatus.assistQuality[]`）を求める manifest schema による。比較試験そのものは Gate 2 の外で所有者が行い、G2V-01 はその記録を待つだけである。依存の EXT-X1 は done（main3）だが、G2V-01 の完了条件の集約 `npm test` の exit 0 は、失敗の原因が未確定のため成り立っていない（TERM-01 §5-10）。これは G2V-01 を行う時の危険として残る。(3) G2V-01 で版 `0.1.12` を適用する時点の確認（GAL-V1 の `0.1.11` が未適用、または `0.1.12` が別の変更で使われていれば、所有者に版を確認する。docs/model-governance/evidence/2026-09-25-owner-ruling-G2D-08.md の「適用の時期と方法」3）。

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
| G2Q-04C | failed | ATG: failed（main3 `5618d7f3…`）。所有者の指示（利用者の作業 session の除外。`work/20260924-2230-UserRulings3-ExecutionPlan.md` §1 の 3）により `node fail --class contract` |
| G2Q-04D | failed | ATG: failed（main3 `5618d7f3…`）。所有者の指示（利用者の作業 session の除外。`work/20260924-2230-UserRulings3-ExecutionPlan.md` §1 の 3）により `node fail --class contract` |
| G2Q-05C | not-started | 所有者の判断（2026-09-25 07:44。[`2026-09-25-owner-ruling-assist-trial-deferral.md`](../docs/model-governance/evidence/2026-09-25-owner-ruling-assist-trial-deferral.md)）で Gate 2 のタスクから外した（比較試験。所有者が後で行う出荷条件）。main7 / main8 の graph に含めない |
| G2Q-05D | not-started | 所有者の判断（2026-09-25 07:44。[`2026-09-25-owner-ruling-assist-trial-deferral.md`](../docs/model-governance/evidence/2026-09-25-owner-ruling-assist-trial-deferral.md)）で Gate 2 のタスクから外した（比較試験。所有者が後で行う出荷条件）。main7 / main8 の graph に含めない |
| G2Q-06C | not-started | 所有者の判断（2026-09-25 07:44。[`2026-09-25-owner-ruling-assist-trial-deferral.md`](../docs/model-governance/evidence/2026-09-25-owner-ruling-assist-trial-deferral.md)）で Gate 2 のタスクから外した（比較試験。所有者が後で行う出荷条件）。main7 / main8 の graph に含めない |
| G2Q-06D | not-started | 所有者の判断（2026-09-25 07:44。[`2026-09-25-owner-ruling-assist-trial-deferral.md`](../docs/model-governance/evidence/2026-09-25-owner-ruling-assist-trial-deferral.md)）で Gate 2 のタスクから外した（比較試験。所有者が後で行う出荷条件）。main7 / main8 の graph に含めない |
| G2A-01 | done | ATG: succeeded（main8 `6cfad899…`、試行 1）。main7 `8c3df57e…` では補助 script の書込み検査の誤判定で failed（work/20260925-0745-Gate2Main7-Acceptance.md）。work/20260925-0745-Gate2Main7-G2A-01-Review.md（blocking: 0）と handoff |
| G2A-02 | failed | ATG: failed（main7 `8c3df57e…`、試行 1）。OWL-ViT は保留（2026-09-23 C7 検出 risk acceptance §4 の 1・2 を 07:44 の判断が変更するかについて所有者の明示の回答が無い）。計画 work/20260925-0745-Gate2Main7-Plan.md §5 により `node fail --class contract`。work/20260925-0745-Gate2Main7-G2A-02-Review.md（blocking: 0） |
| G2A-03 | done | ATG: succeeded（main8 `6cfad899…`、試行 1）。work/20260925-0745-Gate2Main7-G2A-03-Review.md（blocking: 0）と handoff |
| G2A-04 | not-started | main7 / main8 の graph に含めない（OWL-ViT を承認した場合だけの node。Gate 2 計画 §8.18）。G2A-02 の保留が解けるまで起動しない |
| G2V-01 | not-started | main7 / main8 の graph に含めない（work/20260925-0745-Gate2Main7-Plan.md の D-d。比較試験の後に `ready=true` を記録する時に行う。完了条件の集約 `npm test` の exit 0 は、失敗の原因が未確定のため未達（依存の EXT-X1 は done）） |
