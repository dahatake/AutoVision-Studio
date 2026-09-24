# D4（GAL-V1 と GAL の run の終了）の敵対的レビュー

- 対象: `work/20260924-1415-GAL-Acceptance.md`、`work/20260924-1410-RunFinish-check.ps1`（A4・B7・D4 で共用）、GAL の run（`bbb01912-859a-49b4-8819-4d928913c9da`、`work\20260924-1308-GAL-atg-state\gal.sqlite3`）
- 完了条件: 残タスク計画 D4（`work/202609240830-RemainTaskExecutionPlan.md:318`〜`:323`）と §5「試行の終端の検査」（同 :151）
- reviewer: rubber-duck agent（1 回）

## 実施の記録

- `node next` → `{"runnable": ["GAL-V1"]}`、`node start GAL-V1` → `{"started": true, "attempt": 1}`、`node fail GAL-V1 --class contract` → `{"retry": false, "reason": "contract_violation"}`。
- acceptance（契約の `acceptance_command`）→ exit 0。`run finish --acceptance-exit 0` → `{"accepted": true}`。
- `RunFinish-check.ps1` → `ok accepted=1`、exit 0。否定の確認: `accepted: false` の行 → exit 1、`accepted` の行なし → exit 1。

## 指摘

- Blocking: なし。
- Non-Blocking: なし。
- 確認された点: `ATG report` の「総合結果: 成功」は全 node が終端かつ `accepted=1` の場合の表示で、failed の node を含みうる（`tools/atg/vendor/atg/report.py:64`〜`:70`）。GAL-V1 が failed であることと理由は Acceptance file の 5 行目に書いてあるため、追加の注記は要らない。

blocking: 0
