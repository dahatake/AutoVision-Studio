# Gate 2 の実行記録（2026-09-26、main9・main10 と終端化）

承認件数: 4
ready: true

- 計画: [`20260926-0815-OwnerRulings5-ExecutionPlan.md`](20260926-0815-OwnerRulings5-ExecutionPlan.md)（main9）、[`20260926-0955-OwnerRulings6-ExecutionPlan.md`](20260926-0955-OwnerRulings6-ExecutionPlan.md)（安定化・版・main10・TBD-09）。Gate 2 計画は [`202609232120-RemainTaskExecutionPlan.md`](202609232120-RemainTaskExecutionPlan.md)。
- 終端状態: [`20260926-1100-Gate2-TerminalState.md`](20260926-1100-Gate2-TerminalState.md)（主 run: 全成功、done 44）。ATG の report の合成は [`20260926-1100-Gate2-AtgReport.md`](20260926-1100-Gate2-AtgReport.md)。

## 1. node 別の結果（2026-09-26 に変わったもの）

| node | 結果 | 根拠 |
|---|---|---|
| G2Q-04C / 04D / 05C / 05D / 06C / 06D | done（免除の記録。比較試験は未実施で、合格ではない） | main9 `860384d4-…`、[`20260926-0815-Gate2Main9-Acceptance.md`](20260926-0815-Gate2Main9-Acceptance.md) |
| G2A-02 | done（OWL-ViT の採用記録の承認） | 同上 |
| G2A-03 | done（OWL-ViT の C7 検出 entry。承認済み 4 件） | 同上 |
| G2A-04 | done（設定画面の研究目的に限る表示） | 同上 |
| G2V-01 | done（製品版 `0.1.12`） | main10、[`20260926-1100-Gate2Main10-Acceptance.md`](20260926-1100-Gate2Main10-Acceptance.md) |

## 2. 検証の結果

- manifest の test（`node --test scripts/models/manifest-schema.test.mjs`）: 45 件成功（schema `3.0.0`、`ready=true`、4 役、`productVersion` と root の版の一致、`assistQuality` なし）。
- `verify:docs`・`test:docs`（22 件）・`verify:version`・`test:version`（25 件）・`typecheck`・`build`: exit 0。
- 集約 `npm test`: 安定化の後、3 回続けて exit 0（10:24〜10:39）。版の更新の検証では、GAL-V1 と G2V-01 の各 1 回目が失敗し（JOB04 の test の内部の期限、`sample-assets.test.ts` の ctime の変化による fail-closed）、再実行で exit 0（[`20260926-1045-GALV1-Record.md`](20260926-1045-GALV1-Record.md)、`work/20260926-1055-G2V01-*.raw.log`）。既知の失敗と区別するため、失敗した回の raw log を残している。
- 失敗の種類と対策の詳細: [`20260926-0810-EXT-X1-ThreadpoolCompare.md`](20260926-0810-EXT-X1-ThreadpoolCompare.md) §7。

## 3. 残るもの

- PKG-01（release verifier）は未実装。`ready=true` の manifest を PKG-01 の照合の前に出荷物へ使わない。
- 補助品質の比較試験は未実施（免除）で、補助の有用性は検証されていない。
- 負荷の高い host では、本物の子 process と実時間の上限を使う test がまれに失敗しうる（安定化の後の 7 回中 2 回）。
