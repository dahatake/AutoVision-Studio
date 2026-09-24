# C1（TBD-09 の別計画）の敵対的レビュー

- 対象: `work/20260924-1341-TBD09-SchemaFieldRenamePlan.md`、`work/20260924-1341-TBD09-atg-graph.json`
- 完了条件: 残タスク計画 C1（`work/202609240830-RemainTaskExecutionPlan.md:326`〜`:341`）。`ATG graph check` → `{"valid": true, ...}` exit 0。影響 file の表 13 行 = `git grep -l` の追跡 12 件 + 未追跡 1 件（`docs/model-governance/evidence/2026-09-24-owner-ruling-TBD-09.md`）。
- reviewer: rubber-duck agent（2 回）

## 1 回目の指摘（blocking 4）と反映

| # | 指摘（根拠） | 反映 |
|---|---|---|
| B1 | `docs/dependency-policy.md:176` が「manifest schema `2.0.0`」を現行版として書くのに影響範囲にない | 計画 §1 に追加。T9-G の write set・outputs に追加し、verify で `adoption-template.md` と `dependency-policy.md` に「manifest schema `2.0.0`」が残れば失敗にした |
| B2 | schema の description が「Commercial use」と説明している（`manifest.schema.json:338`、`:354`、`:385`）。名前だけ変えると FR-LIC-016(3)（`docs/requirement-definition.md:430`）と逆の説明が残る | 計画 §3 に 3 箇所の description の書き換えを明記。T9-S の verify で「Commercial use」が残れば失敗にした |
| B3 | T9-V が version を変えずに成功できる。release 責任者の決定が入力にない（`CONTRIBUTING.md:178`〜`:183`） | 入力 `work/20260924-1341-TBD09-VersionDecision.md`（`version: x.y.z` の行）を追加。verify で `package.json` の version との一致、`npm run verify:version`、`npm run test:version`（`package.json:39`、`:43`。lock の 2 箇所も検査: `scripts/release/verify-product-version.mjs:51`〜`:60`）。計画に `npm version <値> --no-git-tag-version` と、記録ができるまで起動しないことを明記 |
| B4 | `manifest-schema.test.mjs` を変える T9-T に `lock:model-manifest` がない（判断記録 `2026-09-24-owner-ruling-TBD-09.md:35`） | T9-T の write set に追加 |
| N5 | Review file が outputs にない | 6 node すべての outputs に追加 |
| N6 | `if (git grep ...)` は grep の失敗を「一致なし」と区別しない | `$o = git grep ...; if ($LASTEXITCODE -ne 1) { exit 1 }` に変更（exit 1 だけを通す）。確認: 一致あり exit 0、一致なし exit 1 |

## 2 回目（再確認）

- blocking 0。Non-Blocking 1: T9-V の verify が CHANGELOG に `productUsePermitted` だけを要求していた → `productDerivativesPermitted` も要求するよう反映した。
- 反映後: `ATG graph check` valid、exit 0。6 つの verify command は PowerShell の parser で error 0。T9-S の verify は現在の repository で exit 1（旧名が残るため。期待どおり）。

blocking: 0

## 追補（自己検出, 2026-09-24 14:35）
- 欠陥: TBD09 グラフの verify_command が素の PowerShell で、実行ヘルパは shell=True（cmd.exe）で実行する（work/20260924-0620-atg-node.py:94）。他グラフは pwsh -NoLogo -NoProfile -Command ラップ（work/20260924-1308-GAL-atg-graph.json GAL-D1）。
- 反映: 全 13 ノードを pwsh ラップ + 内側 " を \" へエスケープ。cmd 経由で T9-S / T9-M を実行し exit 1（旧名残存のため期待通り、ParserError なし）。graph check valid exit 0。
blocking: 0
