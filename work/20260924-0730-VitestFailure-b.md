# Vitest 失敗診断 G2X-01b

## 対象
- ノード: G2X-01b
- test: `src\main\data\reference-source.test.ts`
- 実装: `src\main\data\reference-source.ts`
- 実施日時: 2026-09-24

## 実行した正確なコマンド
```powershell
& { $env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH; if ((npm --version) -ne '12.0.0') { exit 2 }; for ($i=0;$i -lt 5;$i++) { & .\node_modules\.bin\vitest.cmd run src\main\data\reference-source.test.ts; "run $i exit=$LASTEXITCODE" } } *>&1 | Tee-Object -FilePath work\20260924-0730-VitestFailure-b.raw.log
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
失敗はこの環境の 2026-09-24 実行では再現しなかったため、原因候補は作らない。

## 切り分け
- test 側: 失敗なし。許可範囲 `src\main\data\reference-source.test.ts:1-422` は fixture/setup と `describe` 範囲で、範囲外の失敗本文読取りは不要。
- 実装側: 失敗なし。`src\main\data\reference-source.ts` は 88 行で全体確認対象。
- 環境側: 失敗なし。重い並行処理があっても本対象では失敗要因としては未確認。

## 再判定の要否
不要。範囲外の test 本文を読む必要は発生していない。

## full output
`work\20260924-0730-VitestFailure-b.raw.log` に保存。
