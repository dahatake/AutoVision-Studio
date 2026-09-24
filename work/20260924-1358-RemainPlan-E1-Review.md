# E1（EXT-X1 の別計画）敵対的レビュー記録

- 対象: `work/20260924-0730-EXT-X1-Plan.md`
- 完了条件（残タスク計画 E1）: 7 file の一覧の件数が log の失敗 file の数と一致すること、本 file に `blocking: 0`。
- 件数の照合: 計画の表の行 7、`work/20260924-0730-EXT-X1-npmtest.raw.log` の ` FAIL  <file>.test.ts` の一意の file 7（`Select-String`）。一致。
- レビュー担当: rubber-duck agent（作成者とは別の context）

## Round 1（blocking 4）

1. `worker-supervisor.test.ts` の 4 件を全部 `WORKER_TIMEOUT` としていたが、2 件は `WORKER_CLOSE_TIMEOUT`（log 321〜346）、2 件が `WORKER_TIMEOUT`（log 351〜363）。→ 分けて記載した。
2. `lock:perf-host` の範囲を vitest・npm・build に狭めていた（正本は全コマンドと書込み: 残タスク計画 138 行）。→ 正本どおりに直した。
3. 「原因確定」が発生箇所の特定に留まっていた（例: `reference-access.ts:197`〜`:198` は複数の条件を同じ `unsafe` にまとめる）。→ 成立した分岐を示す観測、または単一要因の比較を要求し、発生箇所だけでは確定としないと直した。
4. 3 回の測定と「停止の後の同一条件の再試行は 1 回まで」（2400 計画 333 行）の関係が未定義。→ 通常に終わった測定 3 回、停止後は 1 回だけ再試行、再度停止で E2 を終える、と明記した。
- non-blocking 2 件（各回の手順の欠落、各修正ノードでの 7 file の再実行の重複）も反映した。

## Round 2（blocking 0）

- 事実（件数、分類、`unsafe` の説明、lock、原因確定の条件、停止・再試行、修正ノードの完了条件）は根拠と整合。
- non-blocking 2 件: 手順の `$n` が未初期化、無進捗停止の記録形式が未指定。→ `$n = 1` の行を加え、停止時は当該 shell ごと止めて `run <n> exit=` の行を書かず、`run <n> stopped reason=no-progress pid=<PID>` の行を加えると明記した。

blocking: 0
