# EXT-X1 の確認（main3、実行 ID 5618d7f3-f408-4e3d-bc2b-a745c1602a19）

- 原因の記録: [`20260924-2230-EXT-X1-RootCause.md`](20260924-2230-EXT-X1-RootCause.md)（要因 1: 観測 (a) で確定。残りの失敗（時間切れ・`WORKER_*TIMEOUT`・volume の probe の `unsafe` など）は原因未確定）。
- 修正したノード: EXT-X1-F1（`src/main/data/import-files.test.ts`）、EXT-X1-F2（`src/main/data/reference-source.test.ts`）、EXT-X1-F3（`src/main/ipc/import-handlers.test.ts`）。製品の code は変えていない。
- 残りの失敗は原因が確定していないため、修正ノードを作らない（EXT-X1 の計画 §3）。要因 1 の修正の後の集約 `npm test` は exit 1（RootCause §3）で、`closed but not opened` の警告は 0 件だった。

## 証跡（修正した file の vitest。各行を `pwsh` で実行し exit 0 を確かめる）

evidence: & .\node_modules\.bin\vitest.cmd run src/main/data/import-files.test.ts src/main/data/reference-source.test.ts src/main/ipc/import-handlers.test.ts exit=0
evidence: $env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH; npm.cmd run typecheck exit=0
