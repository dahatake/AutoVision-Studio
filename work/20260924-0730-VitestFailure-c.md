# Vitest 失敗診断 G2X-01c

## 対象
- ノード: G2X-01c
- test: `src\main\data\copy-source.test.ts`
- 実装: `src\main\data\copy-source.ts`
- 補助実装: `src\main\projects\project-directory.ts`
- 実施日時: 2026-09-24

## 実行した正確なコマンド
```powershell
& { $env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH; if ((npm --version) -ne '12.0.0') { exit 2 }; for ($i=0;$i -lt 5;$i++) { & .\node_modules\.bin\vitest.cmd run src\main\data\copy-source.test.ts; "run $i exit=$LASTEXITCODE" } } *>&1 | Tee-Object -FilePath work\20260924-0730-VitestFailure-c.raw.log
```

## 終了コード
```text
run 0 exit=0
run 1 exit=0
run 2 exit=0
run 3 exit=0
run 4 exit=0
```

## 失敗した test 名
失敗なし。

## 再現率
0/5。

## 原因候補
単独の 5 回では失敗が再現しなかったため、単独実行についての原因候補は作らない。

参考（診断の 5 回の外の観測）: 本 session の集約 `npm test`（`work\20260924-0730-EXT-X1-npmtest.raw.log`、所要 852 s、7 file / 21 test 失敗）では、許可範囲内の test「uses bounded reads and completes short writes instead of buffering the source」（`src\main\data\copy-source.test.ts:162`）が `Error: Test timed out in 30000ms.` で失敗した。以前の記録（`work/20260923-2003-C7-RemainingTasksExecution.md` §7）で集約実行で失敗し単独で合格した test file（`copy-source.test.ts`）と同じ file の test。以前の記録は test 名を記録していないため、同じ test かは確認できない（同記録 87 行）。集約実行時の負荷による timeout は候補であり、原因とは断定しない（未確認）。

## 切り分け
- test 側: 失敗なし。許可範囲 `src\main\data\copy-source.test.ts:1-114` と `src\main\data\copy-source.test.ts:162-197` の外を読む必要は発生していない。
- 実装側: 失敗なし。許可範囲 `src\main\data\copy-source.ts:1-64`, `:205-220`, `:377-396`, `:495-706` と、238 行の `src\main\projects\project-directory.ts` 全体を確認対象とした。
- 環境側: 失敗なし。重い並行処理があっても本対象では失敗要因としては未確認。

## 再判定の要否
不要。範囲外の test 本文を読む必要は発生していない。

## full output
`work\20260924-0730-VitestFailure-c.raw.log` に保存。
