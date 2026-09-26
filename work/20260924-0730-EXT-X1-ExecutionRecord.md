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

## 所有者の判断 EXT-X1「(a)→(b) を実行してよい」による (a)・(b)（2026-09-24）

計画: `work/20260924-1815-OwnerRulingExecutionPlan.md` §4 X。raw log: `work/20260924-1815-EXT-X1-a.raw.log`、`work/20260924-1815-EXT-X1-b.raw.log`（`*.log` のため git の管理外）。

(a) 完了した回: 3/3 再現: 3
(b) 実施: 基準群 6 file（(a) の ` FAIL ` の行の file）と、残り 115 file の名前順の前半 58 file・後半 57 file を、それぞれ 2 回ずつ実行した。4 回すべて exit=1。

### (a) 集約 `npm.cmd test -- --maxWorkers=19`

| 回 | 開始（raw log の行） | 実行前の node process | exit | Test Files | Tests | 失敗した file |
|---|---|---|---|---|---|---|
| 1 | 18:55:30（1） | 20 | 134（109） | — | — | test の集計の前に node が `uv_fs_close` の assertion で異常終了した |
| 2 | 18:58:02（110） | 20 | 1（250） | 3 failed \| 118 passed (121) | 5 failed \| 4654 passed \| 8 skipped | copy-source、reference-source、worker-supervisor（205〜232） |
| 3 | 19:05:40（251） | 24 | 1（453） | 5 failed \| 116 passed (121) | 5 failed \| 4654 passed \| 8 skipped | copy-source、import-service、worker-supervisor、project-service、sample-assets（351〜433） |

### (b) 基準群 + 前半／後半（`vitest.cmd run --maxWorkers=19 <file 一覧>`）

| 回 | 開始（raw log の行） | exit | Test Files | Tests | 失敗した file |
|---|---|---|---|---|---|
| first 1 | 19:14:04（4） | 1（110） | 4 failed \| 60 passed (64) | 6 failed \| 3216 passed \| 8 skipped | index、copy-source、project-move.review、project-move（26〜100） |
| first 2 | 19:22:58（111） | 1（243） | 6 failed \| 58 passed (64) | 9 failed \| 3213 passed \| 8 skipped | import-files、reference-source、import-handlers、job-service、worker-supervisor、sample-assets（138〜223） |
| second 1 | 19:28:21（244） | 1（302） | 3 failed \| 60 passed (63) | 4 failed \| 1941 passed \| 4 skipped | copy-source、reference-source、worker-supervisor（258〜284） |
| second 2 | 19:30:17（303） | 1（332） | 1 failed \| 62 passed (63) | 2 failed \| 1943 passed \| 4 skipped | reference-source（313〜314） |

### 観測

- 失敗は前半・後半のどちらの集合でも再現し、失敗する file と test は回ごとに変わった。失敗の種類は test の timeout（例: b の 27・40 行）、JOB04 の native deadline（b の 285 行）、reference-source の `expected function to throw an error, but it didn't`（b の 315 行）だった。
- 各回に `Warning: File descriptor <n> closed but not opened in unmanaged mode` が出た（a の 89・192・333 行、b の 8 行）。この警告と失敗の関係は観測していない（仮説に留める）。

### 判断

- 原因: **未確定**。(b) は失敗を特定の file の集合に絞れなかった。E1 の計画 §3 の「確定」（成立した分岐を示す観測、または固定条件で 1 要因だけを変えた比較の再現）を満たさない。
- このため修正ノードは作らない。`EXT-X1` は `node fail --class contract` で記録し、V（0.1.11）は行わない（計画 §4 X の判断の項）。

### 規則からの逸脱（事実の記録）

- 最初の起動（18:54:12〜18:54:13）は `npm.ps1` が `--` を落とし、test を始める前に exit 1 で終わった（計画 §4 X の訂正 18:54。log は `work/20260924-1815-EXT-X1-a-cmd-error.raw.log`）。
- 「各回の実行中は、ほかの process を起動しない」に反し、run 1 の実行中に python（graph の確認）を、run 2・run 3 の実行中にそれぞれ短い `pwsh` を 1 回起動した。いずれも repository へは書き込んでいない。結果への影響は判定できないため、(a) の結果はこの条件付きの観測として扱う。

## 所有者の回答「失敗原因を調査して、タスクを完了させてください」（2026-09-24 22 時）による調査

計画は [`20260924-2230-UserRulings3-ExecutionPlan.md`](20260924-2230-UserRulings3-ExecutionPlan.md) の lane X。詳しい記録は [`20260924-2230-EXT-X1-RootCause.md`](20260924-2230-EXT-X1-RootCause.md)。

- 要因 1（確定: 観測 (a)）: 2 つの test（import-files の mock、reference-source の teardown）が、製品が閉じた fd を本物の `closeSync` でもう 1 回閉じ、別の thread が再利用した fd を閉じる危険があった。「閉じた後の `fstat` が失敗する」の確認は fd の再利用で誤って失敗しうる（失敗を観測したのは reference-source。import-handlers は同じ形の確認を予防として直した）。test だけを直した（main3 の EXT-X1-F1〜F3。製品は変えない）。
- 残りの失敗（時間切れ・`WORKER_*TIMEOUT` など）: 原因は未確定。worker 数を減らしてもすべて通る回は無かった（比較 1。1 要因比較ではなく未確定）、負荷の追加の比較は無効（比較 2）、volume の probe の `unsafe` の分岐は出なかった（観測 2）。test の process の使える CPU を 4 個に限ると失敗は増えた（比較 3: A 0 件・B 4 件、比較 4: A 1 件・B 37 件）が、事前に固定した判定の条件を満たさなかった。修正ノードは作らない（計画 §3）。
- test の時間の上限と skip は変えていない。assert は、閉じた後の `fstat` の失敗で解放を確かめる形を、`closeSync` が正常に戻ることの確認に置き換えた（reference-source と import-handlers。assert を消してはいない）。
