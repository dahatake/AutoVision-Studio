# SPI-05 — Windows EXE resource smoke

| 項目 | 値 |
|---|---|
| 実施日 | 2026-09-07 |
| task | SPI-05 |
| 対象 | 既存 Windows x64 PyInstaller `onedir` の完全性確認、開発用 NSIS EXE への全ディレクトリ同梱、インストール後の実 worker `health` / `probe`、アンインストールと残留確認 |
| 非対象 | production package 設定、正式 Authenticode 署名、clean host 認定、SPI-03 の代替 PASS、SBOM / license 完備、model payload、正式 offline clean-install / servicing |
| 状態 | **VERIFIED — Windows x64 PASS（SPI-05 の限定範囲）** |
| 採用証拠 | 現行run `d3e23532-dbfe-4341-bbd1-94667ec47fdd`。初回run `b6cba50c-92fa-4da9-af08-5815a585c4b3`は履歴として保持。双方の限定resource smokeはPASS |

## 判定

**現行harness追補（2026-09-07）:** 現在のsourceはrun `d3e23532-dbfe-4341-bbd1-94667ec47fdd`で追加検証した。全2,500 files / 529,582,875 bytesのsource/staging/unpacked/installed一致、health/CPU/DirectML、install/uninstaller本体exit 0、Registry64双キー・専用cache・processの残留0を確認。41 tests PASS、独立レビュー指摘なし。exe/GUIDのUUID分離、CIM照会error拒否、コピーしたuninstaller本体への非引用末尾`_?=`、PowerShell 7専用NSISフックを使用した。開発hostにpwsh 7を必要とするPoCであり、製品runtime不要条件や正式署名・clean hostの合格ではない。

現行installerは237,044,086 bytes / SHA-256 `9a4b64e77a4595f84234b6744b55fb9e632bdd6ca63d2da76c9680c585dbe85e`。raw `run-result.json`は`1dda848218bdc853f7c568ac3bb629cdcfd945c9a8b09490b5a272c386e6dcd7`、`installed-result.json`は`19a9a33d19e89e1850553427f81ab7208ad03100ba59e641a217cbd4c26b613b`。初回toolset EPERMは保存し固定hash検査後の再buildで成功した。7入力のrun前後と現行raw hashは一致（package/lock/mainは下記旧表と同じ、harness=`22f4f62f464c60225cded86f61007afff4b683a490c91bf7dcb510a1edc4a559`、run=`5d7273ded70e50f08ad571aae7868983e9dbe7c43e388d8ef23534655eace24d`、YAML=`251dd5aad96213d187ebe202863b9c7df2a502c628872a9296648ec83b3d0823`、installer.nsh=`ba287b127d46e5fece151bb54f46a655de947f1fe9a7d5e627036578375f5e92`）。原本はrun UUID付きの専用一時directoryの`evidence/`へ保持。以下のb6cba50c runは旧履歴で、現在のsource/終了方式/件数と混同しない。

`electron-builder@26.15.3` の `extraResources` で既存 Windows x64 PyInstaller `onedir` 2,500 file を開発用 NSIS EXE に同梱し、明示した per-user install directory へインストールした。インストール済み Electron entry から `process.resourcesPath` 配下の worker 全 file を source manifest と照合した後、実 `autovision-worker.exe` の `health`、PyTorch CPU、Optuna、ONNX check、ONNX Runtime CPU、profiling で provider を確認した DirectML 演算を実行した。すべて成功し、Electron、worker、installer、uninstaller は正常終了した。

同梱前 source、staging、unpacked package、installed package の worker manifest は、file path、byte size、SHA-256 が 2,500 file 全件で一致した。install directory、専用 updater cache、registry entry、既定 profile、shortcut は uninstall 後に残らず、対象 process も 0 件だった。SPI-05 の Windows EXE resource smoke は PASS とする。

これは Gate 1 の SPI-05 入力だけを満たす。clean Windows、正式署名、production package、license / SBOM、offline network audit、repair / upgrade / rollback、model payload は検証しておらず、Gate 5 または SPI-03 の合格へ読み替えない。

## 環境

| 項目 | 実測値 |
|---|---|
| OS | Microsoft Windows NT 10.0.29648.0、AMD64 |
| PowerShell | 7.6.5 Core |
| host Node | 24.19.0 |
| electron-builder | 26.15.3 |
| packaged Electron | 44.0.0 |
| packaged Node | 24.18.1 |
| packaged Chromium | 152.0.7977.54 |

現在の対象は Windows 11 24H2 以降 x64 だけである。macOS package、MPS / CoreML、Developer ID、notarization は実行しておらず、Version 1 の SPI-05 判定に含めない。

## 入力 `onedir` の由来と完全性

使用した既存 bundle は `ml/dist/spi03-current/autovision-worker` である。これは追跡対象外の生成物であり、SPI-05 は次の build 入力と bundle 実体を run 証拠へ固定した。

| 入力 | byte size | SHA-256 |
|---|---:|---|
| `ml/packaging/worker-windows.spec` | 6,932 | `5fbbc284810843677d37062215574b69a781904f73b34da7bcb6b102a57771fb` |
| `ml/uv.lock`（実 file bytes） | 81,544 | `94e3f36d8d5dc47beecdb5d86ffeb628d1fd11d6c52214c79c2e7889e7950d7f` |
| `ml/build/spi03-generated/worker_probe.py` | 5,637 | `11d3c1ea7a140417c82289a70f591f180bf96c4cee28d84a5732227047f87267` |
| `autovision-worker.exe` | 47,876,808 | `d0ffd48d01b263b197b2306541abf707dd045eb0e4f84c92124ce9bcbbb71ed2` |

| manifest 項目 | 実測値 |
|---|---:|
| file count | 2,500 |
| total bytes | 529,582,875 |
| manifest bytes | 467,050 |
| manifest SHA-256 | `793670322f7f8f9c13e119297e686771b5d7bb59f8c443ba5ab47b55c6f9d3ce` |

manifest は ordinal な相対 path 順で全 regular file の byte size と SHA-256 を記録する。junction / symbolic link、hard link、unsafe Windows path、case-insensitive collision、hash 中の変更を拒否する。source inventory は staging 前後および run 終了時にも照合し、`sourceWorkerDirectoryUnmodified: true` を確認した。

source manifest と、staged `app/worker`、`output/win-unpacked/resources/worker`、インストール済み `resources/worker`、run 後の source worker は全件一致した。独立再計算でも current source と unpacked package の manifest SHA-256 はともに上記値だった。

この確認は「今回使用した既存 bundle」の内容完全性と実行可能性を示すが、Python 未導入の clean Windows で生成・実行した証拠ではない。SPI-03 は引き続き `SKIPPED_BY_USER` / 既存 `PARTIAL` の履歴を保持する。

## preflight とインストール済み runtime

package 作成前と、インストール済み Electron からの 2 回、同じ worker suite を実行した。両方で次を確認した。

- `health`: version `0.1.0`、OS `Windows`
- frozen process: `true`
- PyTorch `2.11.0+cpu`: CPU演算結果 `[4, 6]`
- TorchVision `0.26.0+cpu`
- Optuna `4.9.0`: 1 trial 実行
- ONNX `1.22.0`: model check 成功
- ONNX Runtime `1.24.4`: CPU演算結果 `[4, 6]`
- ORT available providers: `DmlExecutionProvider`, `CPUExecutionProvider`
- DirectML: 演算結果 `[4, 6]`、profiled provider が厳密に `DmlExecutionProvider`
- CUDA: unavailable、CUDA version `null`

DirectML は provider 一覧への存在だけで成功にせず、ONNX Runtime profiling の node provider attribution を要求した。worker へ渡した環境変数名は `PATH`、`PATHEXT`、`PYTHONNOUSERSITE`、`SystemRoot`、`TEMP`、`TMP`、`WINDIR` だけである。

インストール済み Electron smoke は 2026-09-07T08:17:03.393Z から 08:17:18.986Z までの 15.593 秒で終了した。exit 0、timeout なし、stderr 0 byte、stdout は CRLF 2 byte だけで、結果 JSON は `packaged: true` / `verdict: PASS` だった。結果 JSON は 2,072 bytes、SHA-256 `9dd98ca0b94d132ff37dffb774d242bd1566c863a98247f8b824cf0d62a70f2f` である。Electron log は 0 byte だった。

## package と NSIS build

| 成果物 | byte size | SHA-256 |
|---|---:|---|
| `autovision-spi05-0.1.0-windows-x64.exe` | 237,047,204 | `1dbf8480fc5ed57e4f519319418a700a7c889b6933f0e20e97e544ae74620b91` |

開発用設定は `electron-builder.windows.yml` SHA-256 `e825937b494d795c8e3359996b8cb0c1719543e718c850e51847a5dce9361bba` を使用した。`asar: true`、worker directory と source manifest を `extraResources` へ指定し、per-user NSIS、変更可能な install directory、shortcut なし、run-after-finish なしとした。

`app.asar` の独立監査では entry は `main.mjs`、`harness.mjs`、`package.json` の3つだけだった。ASAR 内 `main.mjs` は 3,465 bytes / SHA-256 `5e08bc17e98558a30b1d6c1ea2b16bf1fb475ad61fb9fdae19350bd3a91f2e1c`、`harness.mjs` は 20,420 bytes / SHA-256 `b442f0b00f1fc6ac47108f1bd52e3b4713cb6c18914096a6c0107ae36b28e9ce` で、いずれも現 source と byte 単位で一致した。builder log は ASAR integrity executable resource の更新を記録している。

### NSIS toolset の限定回復

初回 builder attempt は、isolated cache 内 `nsis-3.0.4.1` 展開済み一時 directory の rename が `EPERM` となり exit 1 だった。この失敗を成功として扱わず、次の条件を全て確認した場合だけ既存一時 directory を2回目へ渡した。

- error が同じ isolated cache 内の toolset `.tmp` rename だけであること
- archive SHA-256 が electron-builder 26.15.3 の固定値 `9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa` と一致すること
- 展開物 343 file / 7,280,179 bytes / manifest SHA-256 `a02e4fedc657ad55b3ee5d2ce1a23ed230dd32dd9accbf1a6ee42db5a7fc3ff8` が固定値と一致すること
- 2回目の build 後も展開物 manifest が不変であること

2回目は `ELECTRON_BUILDER_NSIS_DIR` へその検証済み一時 directory を限定指定して exit 0 となった。通常失敗、別 release、hash 不一致、同じ toolset の再失敗は retry しない。builder の両 attempt と回復理由は raw log / run receipt に残した。

build 中に isolated cache へ 7zip / NSIS toolset を取得しており、offline build は主張しない。Electron 本体は repository の `node_modules/electron/dist` を使用した。

## install / uninstall / 残留確認

- generated NSIS installer を `/S /currentuser` と run 固有 install directory で実行し、exit 0、stderr 0 byte。
- installed app、worker、uninstaller の存在を確認。
- updater cache は installer と同じ 1 file / 237,047,204 bytes / SHA-256 を持つことを確認。
- packaged Electron と worker 実行後、対象 Electron process と worker process は 0 件。
- uninstaller を `/S /currentuser` で実行し、exit 0、stderr 0 byte。
- install directory、run 固有 uninstall registry entry、既定 profile、desktop / Start Menu shortcut は不在。
- 検証済み updater cache の `installer.exe` と cache directory を削除し、不在を確認。

成功後の独立監査でも installer size / SHA-256、`NotSigned` 状態、source hash、install directory 不在、updater cache 不在、registry entry 不在、対象 process 0、failure receipt 不在を再確認した。

## source 不変性

run 開始前後で次の6入力を SHA-256 比較し、すべて一致した。

| path | SHA-256 |
|---|---|
| `package.json` | `03513434b927e7ea6756ad7aedc5cf21437c86fdc6b6ddd9018af9c772c5d431` |
| `package-lock.json` | `7f1bd82efe1e4919dce6ddffdb763ceff4404d29b60e8e946a150345a8dfe1a5` |
| `spikes/packaging/main.mjs` | `5e08bc17e98558a30b1d6c1ea2b16bf1fb475ad61fb9fdae19350bd3a91f2e1c` |
| `spikes/packaging/harness.mjs` | `b442f0b00f1fc6ac47108f1bd52e3b4713cb6c18914096a6c0107ae36b28e9ce` |
| `spikes/packaging/run.mjs` | `f59a750924f0bc3d4f4bfebfa9d12bb375247f8667f83a51452d6c6179505358` |
| `spikes/packaging/electron-builder.windows.yml` | `e825937b494d795c8e3359996b8cb0c1719543e718c850e51847a5dce9361bba` |

root `package.json` は製品 metadata のまま保持され、task 専用 package metadata は run 固有 staging directory にだけ作成した。repository root に一時 `main.mjs` は残していない。

## 自動テスト

`node --test spikes/packaging/spi05.test.mjs` は **24 tests / 24 passed / skipped 0 / exit 0**。主な負例は次のとおり。

- unsafe / case-colliding path、junction / symbolic link、hard link、hash 中変更
- 同一 size 改変、file 欠落、余剰 file
- malformed manifest、件数 / byte size / SHA-256 / total 不一致
- health / probe の extra output、version / field / status 不一致、duplicate decoded JSON key
- provider availability だけで DirectML 実行とみなす偽陽性
- stdout / stderr flood、timeout、Windows child / grandchild process tree、`taskkill` launch failure
- NSIS retry の cache / release / error / hash 境界
- Electron ESM entry の top-level `app.whenReady()` deadlock 回帰と、ready 前の profile path 分離

`harness.mjs`、`main.mjs`、`run.mjs`、`spi05.test.mjs` の `node --check` と `git diff --check -- spikes/packaging` も exit 0 だった。

## 過程で検出・修正した失敗

1. task 専用 `package.json` / `main.mjs` を repository root に一時配置した初期方式は、共有 workspace の製品 metadata を汚染し得た。以後は run 固有 staging directory に限定し、製品 `package.json` の開始前後 hash と root 一時 entry 不在を強制した。
2. 旧 packaged entry は ESM top-level で `await app.whenReady()` を待ち、ready event 前の module evaluation と循環して timeout した。profile directory を同期作成・`app.setPath` 後、top-level evaluation を完了してから非同期 `main()` を進める形へ変更し、source guard test と実 installed run で exit 0 を確認した。
3. 中間 run 中に `run.mjs` が更新されたため、実動作は成功したが source hash 不変条件で FAIL とした。failure receipt に開始前後 hash を含め、入力を固定した新 run だけを最終証拠へ採用した。失敗 run を成功へ昇格していない。
4. `signAndEditExecutable: false` は署名だけでなく executable resource 編集も無効化するため使用しなかった。`signExecutable: false` で PoC 署名だけを止め、builder log の ASAR integrity resource 更新と packaged entry 実行を確認した。

## 境界と残存リスク

| 項目 | 状態 |
|---|---|
| SPI-05 Windows resource smoke | **PASS** |
| 既存 onedir 全 file manifest / install 後実行 | **PASS** |
| SPI-03 clean Windows | `SKIPPED_BY_USER`、既存 `PARTIAL / NOT_RUN` を維持 |
| production package config | **未作成**（PKG-04 / PKG-05） |
| Authenticode / timestamp | **未実施**。installer は `NotSigned`（D-16 / PKG-07） |
| clean-host offline install | **未実施**（PKG-11） |
| repair / upgrade / rollback | **未実施**（PKG-09B / PKG-13 / PKG-19） |
| SBOM / notices / payload license | **未充足**（LIC-01 / PKG-14 / Gate 5） |
| model payload | **未追加**。`resources/models/manifest.json` は `ready:false`, `models:[]` を維持 |
| build network | toolset 取得あり。offline build を主張しない |
| macOS | Version 1 対象外、未実施 |

## 独立敵対的レビュー

2026-09-07、対象 test 合格後に別担当が code、raw evidence、本文書を read-only で敵対的レビューした。manifest の自己申告依存、retry 範囲、ASAR entry/source 対応、DirectML の実演算証拠、process tree、silent install / uninstall 後の残留、source 変更時の fail-closed、署名・clean-host・license・model・offline 境界、Gate 1 への過大転用を確認した。

初回レビューには4件の指摘があったため、別担当が実 file から争点を再判定した。誤った前提のまま却下せず、次のとおり再現可否を記録する。

| ID | 指摘 | 再現・裁定 |
|---|---|---|
| AR-01 | NSIS回復が未検証または古い`.tmp`を再利用できる | 再現せず。run rootはUUIDを含む`mkdtemp`で新規作成され、回復前にarchive hashと一時directoryの全343 regular fileを再読出ししてpath/size/SHA-256 manifestを固定値と照合し、build後にも再計算する。初回レビューが要求した「全fileの明示再hash」は実装済みだった。 |
| AR-02 | inventoryがhash前後のdevice/inodeまたはhard-link状態を比較しない | 再現せず。`hashRegularFile`は`before.dev === after.dev`、`before.ino === after.ino`、size、mtime、read byte数、`after.nlink === 1`を検査し、walk開始時にも`nlink === 1`を要求する。isolated PoC内の残る一般的なfilesystem raceをproduction完全性保証へ拡張しない。 |
| AR-03 | duplicate JSON key検査がescaped quote keyを見落とす | 再現せず。実装は指摘された単純置換ではなくJSON string tokenを抽出し、各keyを`JSON.parse`してdecoded keyを比較する。`"`と`\u0022`で同じになる入れ子keyの保存testも拒否を確認する。 |
| AR-04 | commit対象の本文書に`C:\Users\dahatake`等の絶対user pathがある | 再現せず。全文検索で`C:\Users`、`AppData`、username、run root suffixは0件。本文書は非個人のrun UUIDと証拠file名だけを記録する。repository外raw JSONの絶対pathはcommitしない。 |

独立再計算では、installer hash / size / `NotSigned`、6 source hash、ASAR内source、current / unpacked worker 2,500 file manifest、uninstall後のinstall directory / updater / registry / process不在が一致した。再判定は4件ともblockingでなく、新規blocking findingも0件だった。対象24 tests、構文、diagnostics、diff checkは指摘後も合格している。

敵対的レビューは **CLOSED**。SPI-05は宣言したWindows x64 resource smokeの限定範囲で **VERIFIED / PASS** とする。SPI-03、Gate 2〜5、正式package、clean-host、署名、SBOM / license、model、camera、Referenceの合格は主張しない。
