# Vitest 失敗診断 G2X-01a

## 対象
- ノード: G2X-01a
- test: `src\main\samples\sample-assets.test.ts`（1021 行。読んだ範囲: `:1-153`、`:340-360`。範囲の追加は `work/20260924-0710-Gate2-SplitRejudgment.md` §1.1 の判定のやり直しによる）
- 実装: `src\main\samples\sample-assets.ts`（443 行）
- 実施日時: 2026-09-24

## 実行した正確なコマンド
```powershell
& { $env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH; if ((npm --version) -ne '12.0.0') { exit 2 }; for ($i=0;$i -lt 5;$i++) { & .\node_modules\.bin\vitest.cmd run src\main\samples\sample-assets.test.ts; "run $i exit=$LASTEXITCODE" } } *>&1 | Tee-Object -FilePath work\20260924-0730-VitestFailure-a.rerun.raw.log
```

## 終了コード（判定のやり直しの後の 5 回）
```text
run 0 exit=0
run 1 exit=0
run 2 exit=0
run 3 exit=0
run 4 exit=0
```

各回の所要時間は 194.65 s、172.31 s、160.04 s、172.09 s、72.11 s（`work\20260924-0730-VitestFailure-a.rerun.raw.log`）。

## 観測の経過
1. 最初の 5 回（`work\20260924-0730-VitestFailure-a.raw.log`）: 5 回とも exit 0、各回 106 passed / 1 skipped。所要時間は 83.56〜123.35 s。
2. 敵対的レビュー（rubber-duck agent `e69861f1`）の単独 1 回の spot-check。**reviewer の報告だけで、raw log は保存されていないため、本記録では検証していない。** 報告の内容: exit 1、4 failed / 102 passed / 1 skipped、失敗した 4 件はいずれも 30 秒の timeout。
3. 判定のやり直しの後の 5 回（上記）: 5 回とも exit 0。

## 失敗した test 名
raw log のある 10 回では失敗した test はない。以下は上記 2 の reviewer の報告にある test 名で、raw log では確かめていない（test 名と timeout の値が source に存在することだけを確かめた）。
- `hashes the full raw license bytes rather than just headers, names or metadata`（`sample-assets.test.ts:343-351` の `it.each`）
- `hashes the full raw attribution bytes rather than just headers, names or metadata`（同上）
- `hashes the full raw coco bytes rather than just headers, names or metadata`（同上）
- `rejects an longer image size without rewriting it`（`sample-assets.test.ts:353-360` の `it.each`）

## 再現率
raw log のある実行では 0/10（最初の 5 回 0/5、やり直し後 0/5）。raw log のない spot-check（未検証の報告）では 1/1。以前の記録（`work/20260923-2003-C7-RemainingTasksExecution.md` §7）では、単独実行でも失敗する test が回ごとに変わっていた。

## 原因候補（推測であり、原因とは断定しない）
- 候補 1: 実行時間が 30 秒の per-test timeout を超える（負荷依存）。根拠: 上記 2 の未検証の報告では、失敗した 4 件はすべて `Test timed out` だった。各 test の timeout は `30_000`（`sample-assets.test.ts:351`、`:360`）。各 test は `getSampleAssets` を呼び、実装は素材の全 byte を chunk ごとに読んで SHA-256 を計算する（`sample-assets.ts:293-314`）。同じ test file の所要時間が回によって 72〜195 s と大きく変わる（raw log）。未確認の点: 失敗した回の所要時間の内訳、その時点の host の負荷。spot-check は、本 session が集約 `npm test` を background で実行していた時間帯と重なっていた可能性があるが、時刻の照合はしていない。
- 候補を確定するための次の手順（未実施）: 失敗した回の各 test の所要時間の記録と、負荷を固定した条件での比較。

## 切り分け
- test 側: 報告された 4 件は timeout 値 `30_000` を持つ（`:351`、`:360`）。報告では assert の失敗ではなく timeout だった（未検証）。test の内容（どの素材を 1 bit 反転するか）で失敗が決まるという根拠はない（同じ `it.each` の `first-image` / `last-image` は失敗していない）。
- 実装側: `SAMPLE_ASSET_INTEGRITY` 以外の誤りの報告はない。全 byte の hash 計算（`sample-assets.ts:293-314`）は所要時間に関係しうるが、誤りを示す観測はない。
- 環境側: 同じコマンドの所要時間が 72〜195 s と変わった（raw log）。失敗の報告は raw log のない spot-check の 1 回だけである。本 session の集約 `npm test`（`work\20260924-0730-EXT-X1-npmtest.raw.log`、852 s、7 file / 21 test 失敗）では本 file は合格した。環境の負荷の影響は候補であり未確認。

## 再判定の要否
実施済み（`work/20260924-0710-Gate2-SplitRejudgment.md` §1.1、範囲 `:340-360` を追加し `PROCEED`）。追加範囲の外は読んでいない。

## full output
`work\20260924-0730-VitestFailure-a.raw.log`（最初の 5 回）、`work\20260924-0730-VitestFailure-a.rerun.raw.log`（やり直し後の 5 回）。
