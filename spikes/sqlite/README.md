# SPI-01 — Electron SQLite package smoke

| 項目 | 値 |
|---|---|
| 実施日 | 2026-09-03 |
| task | SPI-01 |
| baseline | `5828cfe52cc37cd0638280433ca16213228d41b2` |
| 対象 | D-03: Electron Main が `better-sqlite3` を所有できるかの開発時・package時 PoC |
| 非対象 | production DB、migration、永続file、WAL/foreign key、installer、署名、macOS実行 |
| 状態 | REVALIDATED — Windows x64 VERIFIED、macOS NOT_RUN、Gate 1は未判定 |

## 環境

- OS: Microsoft Windows 11 Pro Insider Preview 10.0.29648 build 29648、64-bit
- CPU: 13th Gen Intel(R) Core(TM) i7-13800H
- PowerShell: Core 7.6.5
- host Node: 24.19.0、module ABI 137、Node-API 10
- Electron: 44.0.0、同梱Node 24.18.1、module ABI 149、Node-API 10
- npm: 12.0.0（`C:\Users\dahatake\AppData\Local\Temp\autovision-npm12\node_modules\.bin`を当該実行時だけPATH先頭へ設定）
- `better-sqlite3`: 13.0.3、SQLite 3.53.4

作成環境固有のnpm pathは再現条件に固定しない。別環境ではnpm 12.0.0の実体を確認し、そのbinをnested `npm run`も参照するPATH先頭へ置く。

## 実装境界

`main.ts`はメモリDBを毎回新規作成し、CREATE、INSERT、SELECT、UPDATE、DELETE、例外時transaction rollback、closeを同期実行する。Renderer、Preload、production code、filesystem、networkには接続しない。`smoke.test.ts`はNode組み込みtest runnerを用い、CRUD/rollbackと毎回新規DBであることを検証する。

package smokeはproduction設定を作らず、`electron-builder@26.15.3 --dir`のCLI overrideだけで一時生成した。`npmRebuild=false`、ローカルの`node_modules/electron/dist`、`asarUnpack=node_modules/better-sqlite3/**`を指定した。生成物はignore済みの`dist/spikes/sqlite-package/`に置き、Gitへ含めない。

## 実行証拠

### ENV-GATE

SPI-01開始前に別環境向けENV-GATEを再実行した。

| 検証 | 結果 |
|---|---|
| `npm ci` / pending script確認 | exit 0 / 未審査0 |
| Node test | 4 files / 19 tests、exit 0 |
| TypeScript typecheck | exit 0 |
| Main / Preload / Renderer build | exit 0 |
| `uv lock --check` / `uv sync --locked` | exit 0 / exit 0 |
| pytest | 4 passed、exit 0 |
| Ruff | exit 0 |
| Pyright | 0 errors、exit 0 |
| lock不変性 | 下記正本hashから不変 |

- `package-lock.json`: `7F1BD82EFE1E4919DCE6DDFFDB763CEFF4404D29B60E8E946A150345A8DFE1A5`
- `ml/uv.lock` canonical Git blob LF bytes: `D14D188A0D1F92F34A9436ECC0B2C801BB0375B36619199F846924C112C7E5FC`

### 対象testとruntime smoke

TypeScript 7で対象2 fileだけを一時emitするため、project configを変更せず`tsc --ignoreConfig`を使用した。

| 検証 | 実測結果 |
|---|---|
| 対象TypeScript emit | exit 0 |
| Node test runner | 2 tests / 2 passed / skipped 0、exit 0 |
| host Node standalone | runtime `node`、Node 24.19.0、ABI 137、SQLite 3.53.4、exit 0 |
| Electron同梱Node smoke | runtime `electron`、Electron 44.0.0、Node 24.18.1、ABI 149、SQLite 3.53.4、stderr 0 byte、残process 0、exit 0 |

両runtimeで最終rowは`[{"id":1,"name":"alpha","value":42}]`、`rollbackVerified=true`、`closed=true`だった。

再現に使用した主要コマンドは次のとおり。`dist/`はignore済みの一時出力である。

```text
node_modules\.bin\tsc.cmd --ignoreConfig --pretty false --target ES2024 --module NodeNext --moduleResolution NodeNext --types node --strict --skipLibCheck --outDir dist\spikes\sqlite spikes\sqlite\main.ts spikes\sqlite\smoke.test.ts
node --test dist\spikes\sqlite\smoke.test.js
node dist\spikes\sqlite\main.js
```

Electron同梱Nodeの検証では`ELECTRON_RUN_AS_NODE=1`を当該processだけへ設定し、次を`Start-Process -Wait`とstdout/stderr redirect付きで実行した。

```text
node_modules\electron\dist\electron.exe dist\spikes\sqlite\main.js --autovision-sqlite-smoke
```

初回emitはTypeScript 7のTS5112によりexit 1となり、`--ignoreConfig`を明示して再実行した。次のemitでは`process.versions.modules`のoptional型に対するTS2322が再現したため、ABI/Node-API値の実行時検査を実装して解消した。いずれも成功証拠へ置き換えず、再実行結果を上記へ記録した。

### unpacked package

ローカルElectron配布だけを入力としてWindows x64 unpacked packageを生成した。最初のCLI呼出しはdot notationのprefix不足でexit 1、次の呼出しは外部SIGINTで中断したため棄却した。`--config.*`形式へ修正し、競合しない単独実行で再構築した結果だけを採用した。

| 検証 | 実測結果 |
|---|---|
| electron-builder | 26.15.3、`--dir --win --x64`、exit 0 |
| Electron取得 | `electronDist=node_modules/electron/dist`。このbuildではdownloadなし |
| package entry | `dist/spikes/sqlite/main.js` |
| package runtime | 通常Electron起動、ABI 149、SQLite 3.53.4、CRUD/rollback/close成功、stderr 0 byte、残process 0、exit 0 |
| packaged executable | SHA-256 `D93258AB0806348D2F44E49C2A0C9C3ED7055CA268D8D1B4C082BA4CDCB94D86` |
| packaged native addon | 1,989,632 bytes、SHA-256 `E21E5EFD71FBA66578E95B62554D9028064A80DAFD7221BF8A8EF155DE8D240A` |
| source native addon | packaged addonとsize/hash一致 |
| native配置 | `resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node` |
| package署名 | `NotSigned`。PKG-07の署名合格を表明しない |
| `app.asar` | 757,136,806 bytes。production sizeではない |
| unpacked prebuild | 8 files。Windows x64以外も含む一時PoC package |
| lock不変性 | Node/Pythonとも正本hashから不変 |

package buildとpackage runtimeの主要コマンドは次のとおり。build時はnpm 12.0.0のbinを当該processのPATH先頭へ設定した。

```text
node node_modules\electron-builder\cli.js --dir --win --x64 --publish never --config.directories.output=dist/spikes/sqlite-package --config.extraMetadata.main=dist/spikes/sqlite/main.js --config.npmRebuild=false --config.electronDist=node_modules/electron/dist --config.asarUnpack=node_modules/better-sqlite3/**
Start-Process -FilePath dist\spikes\sqlite-package\win-unpacked\autovision-studio.exe -ArgumentList --autovision-sqlite-smoke -RedirectStandardOutput <temporary-file> -RedirectStandardError <temporary-file> -Wait -PassThru
```

packageが全platform prebuildと広い既定file集合を含むことは技術可否を妨げないが、production payloadの採用結果ではない。SPI-05/PKG-04以降でOS別file selection、payload、installerを別途検証する。SPI-01はinstaller作成、最終size最適化、署名を先行実装しない。

## Native artifactとlicense

- `node_modules/better-sqlite3/prebuilds/win32-x64.node`: 1,989,632 bytes、SHA-256 `E21E5EFD71FBA66578E95B62554D9028064A80DAFD7221BF8A8EF155DE8D240A`
- `node_modules/better-sqlite3/LICENSE`: SHA-256 `09856B52897C91AB67E7456EF43067019F31DFD3B87FDA72E655736B1EBDEE55`、MIT
- `node_modules/better-sqlite3/package.json`: SHA-256 `6C9EA355190DFCE3646AD4D2A31C9506DE36D884A6461B3655A2A0C4BA3D1695`

C0で承認されたexact version・用途だけを使用した。NOTICE/SBOMと最終payload照合はC0条件としてSPI-03/04、LIC-01、Gate 5に残り、SPI-01の結果で完了扱いにしない。

## 一次資料

2026-09-03に再取得した。

- `better-sqlite3` v13.0.3 release: https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3
- v13.0.0 N-API移行記録: https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0
- API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- native addon / ASAR troubleshooting: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md
- license: https://github.com/WiseLibs/better-sqlite3/blob/master/LICENSE
- electron-builder CLI / native unpack資料: https://github.com/electron-userland/electron-builder/tree/master/website/docs

v13.0.0 releaseは、N-APIへの移行によりprebuilt binaryがNode.js/Electronの異なる版で動くことを意図し、prebuildをpackageへ直接同梱したと説明する。本PoCは理論的互換性を根拠にせず、ABI 137と149で実行して確認した。

## D-03判定

**Windows x64では採用可能。** Electron Main相当のentryから`better-sqlite3@13.0.3`の同一N-API prebuildを読み込み、開発時とunpacked package時の双方でCRUD、transaction rollback、closeに成功した。

macOS arm64のnative実行は`NOT_RUN`であり、Windows結果をmacOS PASSへ転用しない。Gate 1全体はSPI-01以外のPoCとnative Mac条件が未完了のためPASSではない。

## 敵対的レビュー

2026-09-03、対象test合格後にcode/境界と証拠/正本の2観点を独立read-only contextで並列レビューした。

| ID | 指摘 | 再現 | 裁定・反映 |
|---|---|---|---|
| SR-01 | `--autovision-sqlite-smoke`が未使用 | 再現せず。package executableではentry script pathが`process.argv[1]`に存在するとは限らず、実測したpackage起動で専用flagを使用した | flagを維持。使用証拠がREADMEから確認しづらかった点はSR-02の修正で解消 |
| SR-02 | package build/runtimeの再現コマンドが記録されていない | 再現。結果と設定値はあったが、実行形式が不足していた | 本節直前へ実行した主要コマンドを追記 |
| ER-01 | READMEの環境、test件数、ABI/hash、lock、署名、macOS/Gate境界、D-03判定に正本との矛盾がある | 再現せず。C0記録、task行、source/testと照合して一致 | 変更なし |

SR-02反映後、source変更はない。対象TypeScript emit、Node 2 tests、Electron同梱Node、unpacked packageを再実行し、全てexit 0、stderr 0 byte、残process 0、native hash一致、lock不変を確認した。blocking findingは0件としてレビューを閉じる。
