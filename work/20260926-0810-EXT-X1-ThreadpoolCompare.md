# EXT-X1 追加調査 — libuv threadpool の共有（事前に固定した比較）

- 作成日時: 2026-09-26 07:57（file の作成時刻 07:57:06。§4 の 1 回目の開始 07:57:17 の前に §1〜§3 を書き、判定の条件を固定した。file 名の `0810` は誤って付けた時刻で、作成時刻ではない。§4 以降は実行の後に追記した）
- 位置づけ: 所有者の指示（2026-09-26 07:48「一括の `npm test` の失敗の原因を調査してください」）。確定の定義は [`20260924-0730-EXT-X1-Plan.md`](20260924-0730-EXT-X1-Plan.md) §3（(b) 固定した条件で 1 つの要因だけを変えた比較）。test を弱めない。
- 先行の調査: [`20260924-2230-EXT-X1-RootCause.md`](20260924-2230-EXT-X1-RootCause.md)（要因 1 は確定・修正済み。残りの時間切れは未確定。CPU の数・worker 数の比較は判定の条件を満たさなかった）。

## 1. 仮説

vitest は `pool: 'threads'`（`vitest.config.ts` L13）で、すべての test file を 1 つの node process の worker thread で動かす。libuv の threadpool は「global and shared across all event loops」で、既定の大きさは 4（libuv 公式文書「Thread pool work scheduling」 https://docs.libuv.org/en/v1.x/threadpool.html 、2026-09-26 参照）。Node の `fs.promises` の操作はこの threadpool で動く（同文書: "This thread pool is internally used to run all file system operations"）。このため、19 個の worker thread の file 操作が 4 本の thread の待ち行列を共有し、実時間の上限を持つ test が上限を超える。

仮説と合う観測（2026-09-26 07:49〜07:55 の集約 `npm test`、`work/20260926-0750-npmtest-run1.raw.log`、exit 1、Tests 2 failed）:

- `copy-source.test.ts:162`（2 MiB を 4,093 byte ずつ書く。数百回の `FileHandle.write` / `read`）が `Test timed out in 30000ms`。
- `worker-supervisor.test.ts:367` の `refuses manifest locator 'result.json.'` が、期待の `WORKER_MANIFEST` ではなく `WORKER_CLOSE_TIMEOUT`。製品の close の期限（`worker-supervisor.ts:214-218`、test の `closeTimeoutMs: 1_000`: test L28）は、子 process の終了の待ちと検証の間を数える。ただしこの locator は `verifyManifest` の入力検査（`worker-supervisor.ts:132-134`）で file system の操作の前に拒否されるため、この 1 件を threadpool の待ちと結び付ける根拠は無い（仮説との関係は未観測）。

## 2. 比較（1 要因）

- 固定する条件: 集約 `npm test`（`package.json` の `test` script のまま。vitest の worker 数は既定）、npm 12.0.0、Node 24.19.0（libuv 1.52.1）、同じ code、同じ時間帯。host の CPU 使用率を 5 秒ごとに記録する（止めない。共有の環境のため）。
- 変える 1 要因: 環境変数 `UV_THREADPOOL_SIZE`。A は設定しない（既定 4）。B は `64`。
- 順序と回数: A・B・A・B の 4 回（増やさない）。
- raw log: `work/20260926-0810-EXT-X1-threadpool-<n><A|B>.raw.log`、CPU は `work/20260926-0810-EXT-X1-threadpool-cpu.raw.log`。

## 3. 判定（事前に固定）

- **確定**: A の 2 回がともに exit 非 0、かつ B の 2 回がともに exit 0。このとき「既定 4 本の libuv threadpool を 19 個の worker thread が共有することは、集約 `npm test` の時間切れの原因である（取り除くと失敗が消える）」とする。
- **未確定**: それ以外。失敗の test の数と種類は記録するが、後から条件を変えない。

## 4. 結果

| 回 | 条件 | 開始〜終了 | exit | 失敗した test | host の CPU 使用率（5 秒ごとの平均 / 最大） |
|---|---|---|---:|---|---|
| 1 | A（既定 4） | 07:57:17〜08:03:58 | 0 | なし（Test Files 121 passed） | 64.9% / 99.7% |
| 2 | B（64） | 08:03:58〜08:08:47 | 1 | `copy-source.test.ts:162`（`Test timed out in 30000ms`）、`import-repository.test.ts`「rejects rehashed reference path projection not in the saved manifest」（`ReferenceAccessFailure`、`reference-access.ts:198` の `assertVolumeCurrent`） | 65.4% / 99.5% |
| 3 | A（既定 4） | 08:08:47〜08:15:14 | 1 | `worker-supervisor.test.ts`「handles 'missing manifest'」（期待 `WORKER_MANIFEST`、実際 `WORKER_CLOSE_TIMEOUT`） | 63.2% / 99.6% |
| 4 | B（64） | 08:15:14〜08:20:30 | 1 | `copy-source.test.ts:162`（`Test timed out in 30000ms`） | 74.7% / 99.7% |

判定: **未確定**（A の 1 回目が exit 0、B の 2 回がともに exit 1 のため、§3 の条件を満たさない）。threadpool を 64 にしても、`copy-source.test.ts:162` の時間切れは 2 回とも起きた。したがって、この test の時間切れは threadpool の大きさだけでは説明できない。JOB04 の `WORKER_CLOSE_TIMEOUT` は A の回（本比較の 3 回目と、事前の 07:49 の回）だけに出たが、回数が少なく、判定には使わない。

## 5. 追加の観測（比較の後。判定の条件は変えない）

### 5.1 `copy-source.test.ts:162` の処理量（単独の実行）

- 単独の実行（`vitest.cmd run src/main/data/copy-source.test.ts -t "uses bounded reads"`、3 回、08:25 頃、直前の host の CPU 使用率 38〜55%）: 3 回とも exit 0（出力の転記: `work/20260926-0835-EXT-X1-isolated.transcript.md`）。test の時間は `7.31` / `7.42` / `6.71` 秒で、上限 30 秒の約 4 分の 1 を負荷の低い状態で使う。
- 比べるための素の書込み（repository の外の一時 script。同じ 2 MiB + 17 byte を 4,093 byte ずつ `FileHandle.write` で 513 回）: 513 回で 40〜51 ms（1 回 約 0.1 ms）。この script は製品の guard の処理を含まない。
- 同期の fs 呼び出しの計数（repository の外の preload で `node:fs` の同期関数を包み、thread ごとに回数と所要時間を記録。raw: `work/20260926-0835-EXT-X1-syncfs.1.json`）: test を動かした worker thread（threadId 1）で **41,090 回**、呼び出しの中の時間の合計 **2,252 ms**（`lstatSync` 33,961 回 1,027 ms、`openSync` 719 回 723 ms、`readdirSync` 1,670 回 96 ms、`fstatSync` 1,676 回、`readSync` 1,282 回、`realpathSync` 680 回、`closeSync` 719 回、`readFileSync` 383 回）。書込み 1 回あたり約 62 回の `lstatSync` になる（書込みは約 545 回: 64 KiB の read chunk 32 個 × 17 回と最後の 17 byte の 1 回。短い書込みの loop は chunk ごとに始まる: `copy-source.ts:606-614`）。
- 由来: 製品の copy の loop は、書込みの前に毎回 `checkWriterNow()` を呼ぶ（`src/main/data/copy-source.ts:614-615`）。`checkWriterNow()` は `assertProject`（`verifyProjectDirectory`）、宛先の各 directory の `readdirSync` と `lstatSync`、一時 file の `readdirSync`・`fstatSync`・`lstatSync` を同期で行う（同 `:587-594`・`:244-253`・`:261-265`）。test は書込みを 4,093 byte に限る mock（`copy-source.test.ts:182-186`）で、書込みを約 545 回に増やす。
- 帰結（観測から言えること）: 1 回の計測で、この test は worker thread 上で約 4 万回の同期の file system 呼び出しを行い、その中の時間は計 2,252 ms（worker thread の計測の期間 7,028 ms の約 3 分の 1。vitest が報告した test の時間は 6.01 秒）だった。同期の呼び出しは libuv の threadpool を使わないため、§4 で threadpool を 64 にしても時間切れが残ったことと整合する。呼び出しの数を変えた比較はしておらず、時間が呼び出しの数に比例するとは確かめていない。集約の実行で 1 回あたりの呼び出しがどれだけ遅くなったかは測っていない（集約の実行に preload を入れると、全 test の条件が変わるため）。

### 5.2 ほかの失敗

- JOB04（`worker-supervisor.test.ts`）の `WORKER_CLOSE_TIMEOUT`: 製品の close の期限（test の `closeTimeoutMs: 1_000`、`worker-supervisor.test.ts:28`）は、子 process の終了の待ちと、`verifyManifest` の `fs.promises` の処理（threadpool）の間も数える（`worker-supervisor.ts:214-218`・`:79-123`）。どちらが 1 秒を超えたかは観測していない。
- `import-repository.test.ts` の `ReferenceAccessFailure`: `assertVolumeCurrent`（`reference-access.ts:186-199`）の `mountvol.exe` の同期の probe（上限 5 秒）が `unsafe` になる条件のどれが成り立ったかは観測していない（先行の観測 2 では 942 件の probe で成り立たなかった）。

## 6. 結論（2026-09-26 時点）

- 本日の 5 回（07:49 の回と §4 の 4 回）の集約 `npm test` の失敗は 4 回・計 6 件だった。種類は、test の上限 30 秒の時間切れ（`copy-source.test.ts:162`、3 件）、JOB04 の `WORKER_CLOSE_TIMEOUT`（期限 1 秒。2 件）、volume の probe の `ReferenceAccessFailure`（1 件）。前の 5 件は実時間の上限を超えたことを示す。volume の probe の 1 件は、`unsafe` の分岐（`reference-access.ts:196-198`: status・error・signal・stderr・GUID の形のどれか）のどれが成り立ったかを観測しておらず、上限の超過とは断定しない。host の CPU 使用率は各回の平均 63〜75%、最大 99.5〜99.7% だった。
- 最も多い `copy-source.test.ts:162`（5 回中 3 回）は、test 1 件が約 4 万回の同期の file system 呼び出しを行い、負荷の低い単独の実行でも約 7 秒かかることを観測した（§5.1）。threadpool を 64 にしても B の 2 回とも時間切れが起きたため、threadpool の大きさだけではこの失敗を説明できない。threadpool の待ちの寄与は未確定である。
- EXT-X1 計画 §3 の「確定」（固定した条件の 1 要因比較、または成立した分岐の観測）は、JOB04 と volume の probe の失敗について満たしていない。共有の host の外の負荷（`searchindexer`・`mssense`・`msmpeng` など。08:17 の process 別の CPU の標本）は固定できない。
- 計画 §3 により、test の上限の延長・skip・assert の緩和はしない。`copy-source.test.ts:162` の書込みの大きさを変えると test の負荷を減らせるが、test の条件を変えるため、本調査では行わない（所有者の判断が要る）。

## 7. 安定化（所有者の判断 2026-09-26 09:53。計画 `20260926-0955-OwnerRulings6-ExecutionPlan.md`）

### 7.1 `copy-source.test.ts:162`（S-1）

- 変更: 短い書込みの上限を 4,093 byte から 32,749 byte にした（`copy-source.test.ts:183`）。64 KiB の read chunk ごとに短い書込みが残り、assert は変えていない。
- 結果: 単独の実行で test の時間は `3.90` / `3.98` 秒（変更前 `6.71`〜`7.42` 秒。§5.1）。file 全体（78 tests）は exit 0（出力の転記: `work/20260926-0835-EXT-X1-isolated.transcript.md` §4）。変更後の集約 `npm test` 4 回（開始 09:56・10:04・10:09・10:15。raw: `work/20260926-1000-S2-npmtest-1.raw.log`、`work/20260926-1010-S2b-npmtest-1.raw.log`、`work/20260926-1015-S2-probe-npmtest-{1,2}.raw.log`）で、この test は 1 回も失敗しなかった。

### 7.2 JOB04 の `WORKER_CLOSE_TIMEOUT`（S-2）

- 観測: 09:56 開始の回（`work/20260926-1000-S2-npmtest-1.raw.log`）で「does not notify for malformed started: 'wrong correlation'」が、期待の `WORKER_PROTOCOL` ではなく `WORKER_CLOSE_TIMEOUT`（`terminationConfirmed: false`）になった。`WORKER_CLOSE_TIMEOUT` を作るのは close の期限（`worker-supervisor.ts:218`）だけで、期限は test の共通の policy の `closeTimeoutMs: 1_000`（変更前の `worker-supervisor.test.ts:28`）だった。製品の値は `closeTimeoutMs: 10_000`（`src/main/index.ts:49`）。close の期限そのものを確かめる test は、それぞれ `closeTimeoutMs: 50` を渡す（`worker-supervisor.test.ts` の 461・583・688・855 行付近）。
- 変更: 共通の policy の `closeTimeoutMs` を 2,000 ms にした（製品の値より小さく、`timeoutMs` 3,000 + `cancelGraceMs` 250 + 2,000 = 5,250 ms が 1 test の上限 6,000 ms（`within(check(...), 6_000)`）に収まる）。assert は変えていない。file 全体（109 tests）は exit 0（出力の転記: 同 §5）。変更後の集約 `npm test` 3 回（開始 10:04・10:09・10:15）で JOB04 の失敗は起きていない。

### 7.3 volume の probe の `unsafe`（S-2）

- 観測（成立した分岐）: 10:09 からの集約 `npm test` に、repository の外の preload（`mountvol.exe` の `spawnSync` / `execFile` を包み、所要時間・status・error・stderr・stdout の長さと先頭を記録）を入れて 2 回実行した（raw: `work/20260926-1015-S2-volprobe.raw.log`）。1 回目は exit 0、2 回目は exit 1（`import-service.test.ts`「repeat observes filesystem only after COMMIT…」の `ReferenceAccessFailure`、`reason: 'unsafe'`）。2 回目の実行中の 10:17:02（JST）に、`spawnSync` の 1 件が **5,008.6 ms** で `error: ETIMEDOUT`（status 0、stdout は volume GUID の 55 文字、stderr 空）だった。これは `assertVolumeCurrent` の `result.error !== undefined` の分岐（`reference-access.ts:196-198`、上限 `timeout: 5_000`: `:192`）である。記録した probe は 1,586 件（`spawnSync` 952 件・p99 約 446 ms、`execFile` 634 件・最大 1,724 ms）で、2 秒を超えたものは 2 件だった。
- 判断: 製品の上限（5 秒）を延ばすと、同期の probe が main の処理を止める時間が延びるため変えない。集約の実行で同時に作られる子 process の数を減らすため、vitest の `maxWorkers` を `'50%'`（論理 CPU 20 の半分）にした（`vitest.config.ts`）。test の assert・上限は変えていない。
- 検証: 変更後の集約 `npm test` を 3 回続けて実行する（§7.4）。

### 7.4 3 回続けての集約 `npm test`（S-1・S-2 の変更と TBD-09 の改名の後）

| 回 | 開始〜終了 | exit | 結果 | host の CPU 使用率（5 秒ごとの平均 / 最大） |
|---|---|---:|---|---|
| 1 | 10:24:16〜10:29:29 | 0 | Test Files 121 passed、Tests 4,663 passed / 8 skipped | 73.7% / 99.3% |
| 2 | 10:29:29〜10:34:19 | 0 | 同上 | 72.1% / 98.9% |
| 3 | 10:34:19〜10:38:59 | 0 | 同上 | 68.7% / 97.4% |

raw: `work/20260926-1030-S3-npmtest-{1,2,3}.raw.log`、`work/20260926-1030-S3-cpu.raw.log`。3 回続けて exit 0 となり、2230 計画 §2 の V の条件（lane X の完了の条件 (3)）が成り立った。2 回目の実行中に `vitest.config.ts` の注記（comment）だけを直した（設定の値は変えていない）。

3 回の成功は、この host・この時間帯の負荷での結果であり、負荷がさらに高い環境での失敗が無いことを保証しない（§7.3 の probe の上限 5 秒は製品の値のまま）。
