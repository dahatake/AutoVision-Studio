# SPI-02 — Electron→Python spawn smoke

| 項目 | 値 |
|---|---|
| 実施日 | 2026-09-03 |
| task | SPI-02 |
| baseline | `464af17`（SPI-01完了） |
| 対象 | Electron Mainからjob単位Python processをspawnし、JSON入力、NDJSON進捗、stderr、exit、cancelを確認 |
| 非対象 | production worker protocol、DB、artifact commit、checkpoint、FIFO queue、強制終了、PyInstaller、HTTP/RPC |
| 状態 | REVALIDATED — Windows x64 VERIFIED、Gate 1は未判定 |

## 実装境界

- `main.ts`は一時ディレクトリにversioned JSON入力を作成し、`child_process.spawn`で`worker.py`をジョブ単位に起動する。
- `worker.py`は入力fileを読み、stdoutへ改行終端のJSONだけをflushして出力する。通常系は`started → progress → progress → completed`、cancel系は`started → progress → warning(code=CANCELLED)`で終了する。
- cancel controlはstdinへ`{"schemaVersion":1,"type":"cancel","jobId":"..."}`をNDJSONで1行だけ送る。schema version、type、active job IDが一致しないcontrolは拒否する。
- stderr経路は固定文言`SPI-02 diagnostic channel`だけで確認し、入力pathや画像を出力しない。
- HTTP server、localhost listener、message broker、RPC framework、production sourceは作成していない。本PoCのevent詳細はJOB-03のproduction schemaを先取り固定しない。

## 環境

- OS: Microsoft Windows 11 Pro Insider Preview 10.0.29648 build 29648、x64
- PowerShell: Core 7.6.5
- host Node: 24.19.0
- Electron: 44.0.0、同梱Node 24.18.1
- Python: CPython 3.14.7（`ml/.venv`、uv 0.12.9のlocked環境）

## 実行証拠

### 正常・cancel

| 検証 | 実測結果 |
|---|---|
| 対象TypeScript strict check | exit 0 |
| host Node→Python | 通常/cancelの2 processともexit 0 |
| 通常Electron Main→Python | 通常/cancelの2 processともexit 0、top-level stderr 0 byte |
| 通常系NDJSON | `started, progress(1/2), progress(2/2), completed` |
| 通常系worker stderr | 固定診断1行。Windows改行`CRLF` |
| cancel control | 最初のprogress後に送信し、`warning / CANCELLED`を受信 |
| cancel系worker stderr | 0 byte |
| 終了後process | 対象Electron/Pythonとも0 |
| 一時入力 | `finally`で一時ディレクトリごと削除 |

通常Electron Mainは`ELECTRON_RUN_AS_NODE`を設定せず、専用の`--autovision-worker-smoke`引数で起動した。最終stdoutはruntime=`electron`、Python=`3.14.7`を報告し、上表のevent列を含むJSON 1件だった。

主要コマンド:

```text
node_modules\.bin\tsc.cmd --ignoreConfig --noEmit --target ES2024 --module NodeNext --moduleResolution NodeNext --types node --strict --skipLibCheck spikes\worker\main.ts
node spikes\worker\main.ts ml\.venv\Scripts\python.exe
node_modules\electron\dist\electron.exe spikes\worker\main.ts --autovision-worker-smoke ml\.venv\Scripts\python.exe
```

### fail-closed境界

| 入力 | 実測結果 |
|---|---|
| `schemaVersion: 2` | exit 2、stdout 0 byte、`unsupported input schemaVersion`をstderrへ出力 |
| active jobと異なるcancel `jobId` | exit 2、`cancel control does not match the active job`をstderrへ出力 |
| 境界test後の対象process | 0 |

失敗時もDB・Project file・networkには接続せず、一時入力以外のartifactを作成しない。

### 品質・lock

- Ruff 0.16.4: `All checks passed!`
- Pyright 1.1.413 strict: 0 errors / 0 warnings / 0 informations
- editor diagnostics: 0
- `package-lock.json`: `7F1BD82EFE1E4919DCE6DDFFDB763CEFF4404D29B60E8E946A150345A8DFE1A5`から不変
- `ml/uv.lock`: `D14D188A0D1F92F34A9436ECC0B2C801BB0375B36619199F846924C112C7E5FC`から不変

初回正常実行はPythonのWindows stderr改行が`CRLF`であるのに固定`LF`だけを期待したためexit 1となった。診断内容と単一行性を維持したままOS改行を許容し、再実行で合格した。次の実行ではPyrightが`json.loads`後のdict key/valueをUnknownと報告したため、object runtime検査後だけ`dict[str, Any]`へcastし、再実行で0 errorsを確認した。これらの失敗を成功証拠へ置き換えない。

## 敵対的レビュー

2026-09-03、code/protocol境界と証拠整合性を独立read-only contextでレビューした。

| ID | 指摘 | 再現・裁定 |
|---|---|---|
| SR-01 | `child.stdin.end(data)`でEOFがdataより先に届きcancelを失う | 再現せず。Node 24公式`writable.end([chunk])`はoptional final chunkを書いてからstreamを終了すると規定する。実測でもacknowledgement後exit 0。変更なし |
| SR-02 | UTF-8文字がchunk境界をまたぐと`setEncoding('utf8')`で破損する | 再現せず。Node 24公式`readable.setEncoding()`は分割multi-byte文字を処理する。現在のeventはASCIIのみ。変更なし |
| SR-03 | stderrにpathが漏れる | 現PoCでは再現せず。固定診断とallowlist済みエラー理由だけで、入力pathを補間しない。productionの多様な診断sanitizeはSEC-07/JOB-04責務 |
| SR-04 | worker crash時のstdin EPIPE、timeout後の強制終了保証が未実装 | 現在の制御workerでは再現せず。production crash/猶予後killは明示的に非対象でJOB-04/05へdefer |

一次資料はNode.js v24 stream API（2026-09-03取得）: `https://nodejs.org/docs/latest-v24.x/api/stream.html#writableendchunk-encoding-callback`、`https://nodejs.org/docs/latest-v24.x/api/stream.html#readablesetencodingencoding`。PoC scope内のblocking findingは0件。productionへcodeをそのまま移植可能とは判定しない。

## 判定

**Windows x64ではElectron Mainからlocked Python workerをジョブ単位にspawnし、versioned JSON入力、flushされたNDJSON進捗、分離stderr、終了code、協調cancelを扱える。** ADR-0001のHTTP/RPCなし構成をSPI-03/07へ進められる。

本taskはproduction supervisor、強制終了猶予、Run状態遷移、artifact検証を採用済みとは扱わない。これらはJOB-03〜06の責務である。Gate 1は他のPoCとnative macOS条件が未完了のためPASSではない。
