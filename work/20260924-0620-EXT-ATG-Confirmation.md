# EXT-ATG 確認記録（Gate 2 準備 run 2）

| 項目 | 内容 |
|---|---|
| 作成日時 | 2026-09-24 06:20 JST |
| 別計画 | [`20260924-0605-EXT-ATG-Plan.md`](20260924-0605-EXT-ATG-Plan.md)（G2D-09 = A） |
| 完了日 | 2026-09-24 |
| 変更した file | `tools/atg/skill/references/planning.md`・`.github/skills/atg/references/planning.md`（§1 の表・§2 の項目に例外を加え、§1.1「500 行を超えるファイルの行範囲読み」を追加）、`tools/atg/skill/SKILL.md`・`.github/skills/atg/SKILL.md`（`metadata.version` 0.2.2 → 0.2.3）、`tools/atg/KIT-VERSION.json`（`version` 0.2.3、2 file の SHA-256） |
| 敵対的レビュー | rubber-duck agent `1f0308af-3c2f-4d34-9f19-e05c8fa7da1b`。1 回目の blocking 2 件（SHA-256 の再照合時点が未定義 → 要件を削除、範囲の合計の数え方が未定義 → 1 始まり・両端含む・重ねない・`終了行 - 開始行 + 1` の合計と明記）と non-blocking 1 件（DoD に `KIT-VERSION.json` の version の検査を追加）を反映し、2 回目は「none」 |

## Gate 2 計画 §8.5 の完了条件（A: 改訂した規約が repository にあり、ATG の既存 test が exit 0）

repository に ATG の unit test file はない（`tools/atg`・`.github/skills/atg` 配下の `test_*.py` / `*_test.py` は 0 件。レビューでも追跡中の Python test 18 件に ATG の test がないことを確認）。代わりに kit の検査を使う。

evidence: python tools/atg/install.py --verify exit=0
evidence: python -m atg graph check tools/atg/examples/hello-atg/atg-graph.json exit=0
evidence: python -m atg contract check tools/atg/examples/hello-atg/atg-contract.json exit=0
evidence: Select-String -Path tools/atg/skill/references/planning.md -Pattern '^### 1\.1 ' -Quiet → True exit=0
