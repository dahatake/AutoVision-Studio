# EXT-X1 原因調査の実行記録（E2）

- 計画: `work/20260924-0730-EXT-X1-Plan.md` §2（E1 の手順）。残タスク計画 E2（`work/202609240830-RemainTaskExecutionPlan.md:193`〜`:198`）。
- 全出力: `work/20260924-0730-EXT-X1-ExecutionRecord.raw.log`（39 行）。

## 条件

- `lock:perf-host`: 各回の前に、ほかの lane のコマンド（C1・D4 の review agent を含む）と書込みが終わったことを確かめてから始め、3 回の間、ほかのコマンドと書込みを始めなかった。
- 各回の前の `Get-Process node` の件数: 12（raw log 1・14・27 行）。この 12 件は本作業の lane の process ではない（editor の拡張機能などの常駐 process。lock の代わりではない記録として残す）。
- vitest: `--maxWorkers=19`（論理 CPU 20 から 1 を引いた値。`Get-CimInstance Win32_Processor` の NumberOfLogicalProcessors の合計 20）。npm 12.0.0 を PATH の先頭に置いた。
- 各回は別の shell で、E1 の手順の block をそのまま実行した。

## コマンド

```powershell
& .\node_modules\.bin\vitest.cmd run --maxWorkers=19 src/main/data/copy-source.test.ts src/main/data/import-files.test.ts src/main/data/import-python.test.ts src/main/data/import-repository.test.ts src/main/data/import-service.test.ts src/main/jobs/job-service.test.ts src/main/jobs/worker-supervisor.test.ts
```

## 結果

| 回 | 開始 | 実行前の node process | Test Files | Tests | Duration | 失敗した test |
|---|---|---|---|---|---|---|
| 1 | 2026-09-24T14:08:10 | 12 | 7 passed (7) | 363 passed \| 3 skipped (366) | 46.91s | なし |
| 2 | 2026-09-24T14:09:08 | 12 | 7 passed (7) | 363 passed \| 3 skipped (366) | 48.13s | なし |
| 3 | 2026-09-24T14:10:07 | 12 | 7 passed (7) | 363 passed \| 3 skipped (366) | 57.75s | なし |

raw log の `run <n> exit=` の行（13・26・39 行）:

run 1 exit=0 end 2026-09-24T14:08:58.7328309+09:00
run 2 exit=0 end 2026-09-24T14:09:57.5842580+09:00
run 3 exit=0 end 2026-09-24T14:11:06.5051194+09:00

- 停止（10 分以上進まない回）: なし。再試行: なし。
- `FAIL` の行: 0 件（raw log に ` FAIL ` の行がない）。
- 各回に `Warning: File descriptor <n> closed but not opened in unmanaged mode` が出た（例: raw log 5・18 行）。exit と test の結果には影響していない。

## 判断

- 再現率: 7 file をまとめた実行で 0/3。集約 `npm test`（121 file、`work/20260924-0730-EXT-X1-npmtest.raw.log` 439〜442 行）の 21 件の失敗は再現しなかった。
- 原因: **未確定**。E1 の計画 §3 の「確定」（失敗が再現し、かつ成立した分岐の観測か 1 要因の比較があること）を満たさない。
- このため、修正ノードは作らない（E1 の計画 §3 の最後の項）。`EXT-X1` は残タスク計画 A3 の「原因が確定しなかった場合」（`node start` → `node fail --class contract`）で記録する。
- 回数は測定の前に固定した 3 回のまま増やさない（E1 の計画 §2「結果によって回数を増やさない」）。
