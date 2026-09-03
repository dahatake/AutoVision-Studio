# C0-NODE — Phase C Node依存採用記録

| 項目 | 値 |
|---|---|
| 実施日 | 2026-09-03 |
| 対象 | C0-NODE |
| C0-PLAN | commit `6780ca274a149a2cce50e443e7fa91ce6700c137` |
| 実行環境 | Windows 11 build 29648、x64、Node 24.19.0 |
| 判定 | **BLOCKED** — 技術検証はWindowsで合格。未承認transitive licenseとnative macOS実行が残る |

## 1. 採用範囲

| package | 区分 | exact版 | 用途 | 採用理由 |
|---|---|---:|---|---|
| `better-sqlite3` | runtime | 13.0.3 | Main processのSQLite所有 | D-03で選定済み。server/ORMを追加せず同期transactionを使う |
| `konva` | runtime | 10.3.2 | 矩形canvas | D-04のaxis-aligned rectangle操作を限定実装する |
| `react-konva` | runtime | 19.2.5 | ReactとKonvaのbinding | 独自renderer bridgeを作らずReact 19.2系と接続する |
| `electron-builder` | dev | 26.15.3 | Windows NSIS、macOS PKG、resource同梱 | D-05で選定済み。OS別installer frameworkの二重化を避ける |
| `pyright` | dev | 1.1.413 | Python strict type check | Microsoft公式npm packageを使用する。PyPIの非公式wrapper/runtime downloaderは採用しない |

`canvas`と`skia-canvas`はKonvaのoptional peerであり、lock entryは0件である。Node側headless canvasはMVPに不要なため暗黙導入しない。

## 2. 版と一次資料

取得日は全て2026-09-03。

| 対象 | 一次資料・確認内容 |
|---|---|
| `better-sqlite3@13.0.3` | [v13.0.3 release](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3)、[v13.0.0 N-API移行](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0)、同梱`package.json`。v13からN-APIとplatform別prebuild同梱へ移行し、Node `>=22` |
| `konva@10.3.2` | [tag一覧](https://api.github.com/repos/konvajs/konva/tags?per_page=100)のtag `10.3.2`、commit `005356e261367c2485c70149ffc0570e16ee64f4`、[固定manifest](https://raw.githubusercontent.com/konvajs/konva/10.3.2/package.json) |
| `react-konva@19.2.5` | [v19.2.5 release](https://github.com/konvajs/react-konva/releases/tag/v19.2.5)、commit `08ee116db0f18f26e28e07433c618978a79f4b00`。peerはKonva 10、React/React DOM `^19.2.0`で、採用済み10.3.2/19.2.8と一致 |
| `electron-builder@26.15.3` | [npm公式version page](https://www.npmjs.com/package/electron-builder/v/26.15.3)のGitHub Actions provenance、source commit `512a57ec9bcda593d3e0970bd2b9a33a63beeb57`、transparency log。GitHub release tagはないがnpm provenanceで公式repository buildを確認。26.16.0は承認済みproxyでE404だったため採用しない |
| `pyright@1.1.413` | [公式tag](https://github.com/microsoft/pyright/releases/tag/1.1.413)、commit `789d8275fef25f347ffef7b847305fefd8a3e363`、同梱manifestのpublisher/author `Microsoft Corporation` |
| npm 12.0.0 | [npm 12 changelog](https://github.com/npm/cli/blob/v12.0.0/CHANGELOG.md)。dependency lifecycle default-deny、`allowScripts`、`allow-remote`を使用。Node要件 `^22.22.2 || ^24.15.0 || >=26.0.0`をNode 24.19.0が満たす |

## 3. lifecycle scriptとsource境界

- `packageManager`と`devEngines`をnpm 12.0.0へ固定した。旧npm 11.17.0の`npm ci --ignore-scripts`は依存展開前に`EBADDEVENGINES`、exit 1となることを確認した。
- `.npmrc`は承認済み`https://packagefeedproxy.microsoft.io/npm/`、`strict-allow-scripts=true`、`allow-remote=all`を固定する。
- proxyはlock内で4つの`ms-feed-*.pkgs.visualstudio.com` tarball hostを返す。npm 12の`allow-remote`は`all/none/root`だけでhost prefix指定を持たないため`all`が必要である。これは任意URLの採用承認ではない。`npm ci`のfrozen lock、全entryの`resolved`/`integrity`、host差分reviewを不可分の境界とする。
- `allowScripts`は`better-sqlite3@13.0.3=false`、`electron-winstaller@5.4.0=true`、`esbuild@0.28.2=true`。npm 12のpending未審査scriptは0件。
- `better-sqlite3@13.0.3`はprebuildを同梱するが、npm 11で生成されたlock metadataの`hasInstallScript`によりplain `npm ci`が不要な`node-gyp rebuild`を開始した。npm 12で明示denyし、同梱N-API binaryを使う。
- Electron 44 npm packageはpostinstallを持たず`install-electron` binを公開する。root所有の`postinstall`だけで実行し、dependencyの未審査scriptとして許可しない。
- npm 12 clean installで実行されたdependency scriptは上記2件だけで、root scriptは`install-electron`だけだった。

## 4. lock完全性

| 検査 | 実測 |
|---|---|
| lock形式 | lockfileVersion 3 |
| entry | root込み510、非root/non-link 509 |
| `resolved`欠落 | 0 |
| `integrity`欠落 | 0 |
| integrity algorithm | SHA-1 509件。承認済みproxyが返すSRIであり、欠落はないがSHA-256相当とは記録しない |
| resolved host | `ms-feed-12` 124、`ms-feed-2` 117、`ms-feed-17` 133、`ms-feed-25` 135 |
| C0差分 | 273 entry追加、削除0、version変更0 |
| 既存entry metadata差分 | `@types/react`と`csstype`の`dev`、`ansi-regex`の`peer`がnpm 12再解決で外れた。3件ともversion/resolved/integrityは不変、licenseはMIT |
| optional canvas | `canvas` 0、`skia-canvas` 0 |
| `.npmrc` SHA-256 | `F01C084E49842DE0569C9F0C88C3715AEDE373159FB47838735BFF2544F19288` |
| `package.json` SHA-256 | `FF453837A63E1CBEC14D8630F5EC477D562A7DAEF85A384B18A9CAB840781F55` |
| `package-lock.json` SHA-256 | `7F1BD82EFE1E4919DCE6DDFFDB763CEFF4404D29B60E8E946A150345A8DFE1A5` |

## 5. native binary実測

| artifact | 対象 | size | SHA-256 | 実行結果 |
|---|---|---:|---|---|
| `better-sqlite3/prebuilds/win32-x64.node` | Windows x64 | 1,989,632 | `E21E5EFD71FBA66578E95B62554D9028064A80DAFD7221BF8A8EF155DE8D240A` | Node ABI 137とElectron ABI 149でSQLite 3.53.4のmemory CRUD合格 |
| `better-sqlite3/prebuilds/darwin-arm64.node` | macOS arm64 | 1,980,736 | `98E0E8ACD01C632FE5615243E1296AF0372826F8783B18FC31C506F73C47459C` | hash存在のみ。Windowsでは実行していない |
| `electron/dist/electron.exe` | Windows x64 | 244,440,576 | `1DC2D12E5C60341782E68C4B65A8E49CBD86217F81568F90575547CEC13B5610` | Electron 44.0.0、Node 24.18.1、modules 149、Chrome 152.0.7977.54。Authenticodeは`NotSigned` |

Electron配布binaryの未署名は、最終製品署名を合格扱いにしない。正式署名はD-16/PKG-07で別途必要である。

## 6. license監査

### 6.1 direct package

| package | license | 同梱file SHA-256 |
|---|---|---|
| `better-sqlite3@13.0.3` | MIT | `09856B52897C91AB67E7456EF43067019F31DFD3B87FDA72E655736B1EBDEE55` |
| `konva@10.3.2` | MIT | `7190132C82DF30243DC2BA512C9509EA3B629329B4266E9F2C3B5DBD04029613` |
| `react-konva@19.2.5` | MIT | `0874C25D40DCF71FF12256D30E15E59FD3E21A163C53448EA8BCBE6C03B663E4` |
| `electron-builder@26.15.3` | MIT | `BED8D0AB3E6031817F775A641FF37313B0F5591BC8BA0ED79B978DAFBD4231CE` |
| `pyright@1.1.413` | MIT | `F7C936BC43F132B08497AC952E9376CBC102E5EEDB4BF6EC902EA8442BD9C68D` |

### 6.2 transitive package

全509 entryのlicense fieldは欠落/unknown/NOASSERTION 0件、GPL/AGPL/LGPL/研究限定/非商用0件だった。ただし「禁止categoryがない」ことは「明示許可済み」を意味しない。

C0追加273件の内訳はMIT 207、ISC 33、BSD-2-Clause 5、Apache-2.0 5、Python-2.0 1、BSD-3-Clause 9、BlueOak-1.0.0 8、`WTFPL OR ISC` 1、WTFPL 1、0BSD 1、`MIT OR CC0-1.0` 1、`WTFPL OR MIT` 1。`docs/dependency-policy.md` §2の明示許可識別子に一致しない47件は全てdev treeである。

未裁定packageは次のとおり。

- ISC: `@electron/asar/minimatch@3.1.5`、`@electron/universal/minimatch@9.0.9`、`@isaacs/fs-minipass@4.0.1`、`abbrev@4.0.0`、`app-builder-lib/@electron/get/semver@6.3.1`、`app-builder-lib/semver@7.7.4`、`at-least-node@1.0.0`、`cliui@8.0.1`、`cross-spawn/isexe@2.0.0`、`cross-spawn/which@2.0.2`、`dir-compare/minimatch@3.1.5`、`filelist/minimatch@5.1.9`、`fs.realpath@1.0.0`、`get-caller-file@2.0.5`、`glob@7.2.3`、`glob/minimatch@3.1.5`、`hosted-git-info@4.1.0`、`hosted-git-info/lru-cache@6.0.0`、`hosted-git-info/yallist@4.0.0`、`inflight@1.0.6`、`inherits@2.0.4`、`json-stringify-safe@5.0.1`、`node-gyp/which@6.0.1`、`nopt@9.0.0`、`once@1.4.0`、`proc-log@6.1.0`、`rimraf@2.6.3`、`signal-exit@3.0.7`、`tiny-async-pool/semver@5.7.2`、`which@5.0.0`、`wrappy@1.0.2`、`y18n@5.0.8`、`yargs-parser@21.1.1`。
- BlueOak-1.0.0: `chownr@3.0.0`、`isexe@3.1.5`、`minimatch@10.2.6`、`minipass@7.1.3`、`node-gyp/isexe@4.0.0`、`sax@1.6.1`、`tar@7.5.22`、`tar/yallist@5.0.0`。
- その他: `argparse@2.0.1`（Python-2.0）、`sanitize-filename@1.6.4`（WTFPL OR ISC）、`truncate-utf8-bytes@1.0.2`（WTFPL）、`tslib@2.8.1`（0BSD）、`type-fest@0.13.1`（MIT OR CC0-1.0）、`utf8-byte-length@1.0.5`（WTFPL OR MIT）。

OR式にMIT選択肢があっても、この記録だけで他の識別子をpolicyへ追加または法務承認したとは扱わない。47件のpolicy/法務裁定、または依存置換が終わるまでC0-NODEはCLOSEDにしない。

## 7. 脆弱性とdeprecated警告

- npm 12.0.0で`npm audit --audit-level=high --package-lock-only`: exit 0、0 vulnerabilities。
- clean installでは`inflight@1.0.6`、`rimraf@2.6.3`、`glob@7.2.3`、`boolean@3.2.0`のdeprecated警告を確認した。いずれもC0追加dev treeであり、警告を脆弱性0の根拠にはしない。
- `npm audit`の0件は当該registry advisory結果であり、将来のadvisory不存在を保証しない。C0-REVIEWとSEC-08で再実行する。

## 8. install・smoke実測

| 検証 | 結果 |
|---|---|
| npm 12 strict clean install | exit 0、440 packages、0 vulnerabilities。実行dependency script 2件、root script 1件 |
| npm toolchain PATH | npm 12 CLIだけを絶対pathで呼んだ初回再検証では、`build`内のnested `npm run`がPATH上の11.17.0へ戻り`EBADDEVENGINES`。npm 12のbinをPATH先頭に固定後、同じ`npm run build`がexit 0 |
| direct tree | exact 5 packageを含む全direct version一致 |
| Node test | 4 files、19 tests、exit 0 |
| TypeScript typecheck | exit 0 |
| Main/Preload/Renderer build | exit 0、5 artifact生成 |
| Pyright | 1.1.413、strictで0 errors/0 warnings |
| package import | `electron-builder`、`konva`、`react-konva`全てexit 0 |
| Electron native smoke | Electron ABI 149内で`better-sqlite3` memory CRUD、exit 0 |
| macOS arm64 install/smoke | **BLOCKED** — native Apple Silicon Mac未提供。Windows結果で代替しない |

## 9. 敵対的レビュー

初版に対して独立read-onlyレビューと別の機械検査を行った。相反する結果はlockを単一parserで再計測して裁定した。

| ID | 指摘 | 再現 | 裁定・反映 |
|---|---|---|---|
| NR-01 | 273追加以外の既存entry metadata差分が採用記録から欠落 | 再現。`@types/react`/`csstype`の`dev`と`ansi-regex`の`peer`だけが変化 | §4へ追記した。version/resolved/integrityは不変で、3件ともMITのため新たなlicense blockerではない |
| NR-02 | 509件中8件にintegrityがない | 再現せず。非root/non-link 509件を再parseし、`resolved`/`integrity`欠落はいずれも0、SHA-1 509件 | 初版の0件を維持。optional entryを除外して成功扱いにはしていない |
| NR-03 | policy明示許可外のC0追加licenseは12件だけ | 再現せず。検査側がISC 33件とPython-2.0 1件を明示許可扱いしていたが、policy §2の表にはない | exact allowlistで47件を再確認し、BLOCKEDを維持 |
| NR-04 | exact lockを保持したままBLOCKEDとするのは不整合 | 再現せず | lockと実測証拠を保持し、C0/Phase Cを停止する方がfail-closed。未承認をCLOSEDとは記録していない |
| NR-05 | macOS未実施をWindows hashで代替している | 再現せず | darwin artifactは存在/hashだけを記録し、実行はBLOCKEDのまま |
| NR-06 | npm 12 CLIを絶対pathで直接起動すればnested project scriptも同じnpmを使う | 再現せず。`build`内の`npm run`はPATH上の11.17.0を選び停止した | npm 12のbinをPATH先頭に置くことを実行前提として§8へ追記。再実行したbuild/test/typecheck/Pyright/auditは全て合格 |
| NR-07 | C0追加273件に対して§6.2のlicense内訳合計が274件 | 再現せず。lock再集計は内訳合計273、policy外47。レビュー側の加算誤り | 数値を変更しない。機械集計結果を正とする |

NR-01反映後も判定は **BLOCKED**。独立レビューが確認したnpm script境界、direct版、native Windows smoke、macOS停止条件には追加の実在不備がない。

## 10. 判定と解除条件

C0-NODEはexact manifest/lock、Windows clean install、Node/Electron native smoke、integrity、脆弱性、direct licenseまで実証した。一方、次が未完のため判定は **BLOCKED** である。

1. C0追加dev treeのpolicy明示許可外47 packageについて、license本文・NOTICE・利用形態を確認した書面裁定、または依存置換。
2. native Apple Silicon Macでのnpm 12 strict clean install、Konva import、Electron 44内のdarwin-arm64 N-API CRUD、electron-builder CLI smoke。

C0-NODEをCLOSEDにせず、C0-REVIEWおよびPhase C開始条件を満たしたとは扱わない。
