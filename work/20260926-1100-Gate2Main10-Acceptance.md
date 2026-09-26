# Gate 2 main10 の受入

- 実行 ID: c3b7cffc-c545-4215-90c4-eb935a242aab
- 状態 DB: work\20260926-1100-Gate2Main10-atg-state\main.sqlite3
- graph: work/20260926-1100-atg-graph-main10.json、契約: work/20260926-1100-atg-contract-main10.json（SHA-256 3168492ff3a361956d6ddd27632db98808e90d034592a37201d2fd3c30f7f154）。生成: work/20260926-1100-make-main10.py。計画: work/20260926-0955-OwnerRulings6-ExecutionPlan.md。
- node の終端: succeeded 7（G2V-01、G2F-00、G2F-01m、G2F-01a1、G2F-01a2、G2F-01a3、G2F-03。report: work/20260926-1100-Gate2Main10-Report.md）。各 node の verify（work/20260926-1100-Gate2Main10-verify.ps1）は exit 0、書込み検査は `{"changed": []}`（各 node の編集は node の begin の前に行い、敵対的レビュー work/20260926-1100-Gate2Final-Review.md（blocking: 0）を経ている）。
- G2F-00 の verify は、ATG の report の合成（work/20260926-1100-Gate2-AtgReport.md。main10 の G2V-01 は `succeeded`）を作り直したうえで、ノード一覧 §2 の検査を exit 0 で通した。
- acceptance の command（契約の `acceptance_command`）: exit 0（`verify:docs`、`verify:version`（0.1.12）、manifest の test 45 件成功。出力: work/20260926-1100-Gate2Main10-acceptance.raw.log）。`run finish` → `{"accepted": true}`、report の終端受入は `accepted=1`。
- 本実行の受入は、Gate 2 の主 run の全成功の記録であり、製品の release の判定（GO）ではない。PKG-01 が未実装のため、`ready=true` の manifest を PKG-01 の照合の前に出荷物へ使わない。
