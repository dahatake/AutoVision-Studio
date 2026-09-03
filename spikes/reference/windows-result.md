# SPI-19 Windows — Reference 永続アクセス実測

## 判定

| 対象 | 状態 | 根拠 |
|---|---|---|
| Windows 別process lifecycle | **PASS** | manifest作成process終了後、新しいNode processでidentity/size/mtime/SHA-256を再検証 |
| Windows read-only / relink primitive | **PASS** | strict compile後の28ケースself-testと独立smoke |
| Windows実機OS reboot後アクセス | **NOT_RUN** | 別process結果をOS reboot結果へ転用しない |
| Windows lane | **PARTIAL** | OS reboot未実施 |
| SPI-19全体 | **PARTIAL** | Windows rebootとnative Apple Silicon macOS laneが未実施 |

実測日: 2026-09-03

## 対象と非対象

対象はD-19、SPI-19、ADR-0002 §3.2に基づく単一Reference sourceの選択、別process検証、変更・消失検出、明示relink、参照元非変更primitiveである。

- FR-DAT-012: absolute path、OS file identity、size、mtime、SHA-256の保存と再検証。
- FR-DAT-013: 変更・消失をfail-closedで検出するための単一file primitiveまで。Training Run開始前・epoch/trial境界の全file連携、安全停止、UI案内はTRN-01等の後続taskであり、本結果はその完了証拠ではない。
- FR-PRJ-008: source非変更原則の補助証拠まで。Project削除経路はREL-04等の後続taskであり、本結果は削除要件の合格証拠ではない。
- native picker UIはDAT-08/DAT-15、atomic manifest replacement/crash recoveryはREL-01、junction/symlink/raceのproduction adversarial testはSEC-03の対象である。

## 実装契約

`reference-access.ts`の通常command:

- `select <absolute-source> <absolute-manifest>`: sourceをread-onlyで取得し、manifest v1を新規作成する。
- `verify <absolute-manifest>`: 保存sourceを別processから再検証する。
- `relink <absolute-manifest> <absolute-candidate>`: candidate SHA-256が保存値と一致する場合だけmanifestを更新する。
- `self-test`: repository外の一時fixtureだけを作成・変更・移動・削除し、通常commandを別processで検証する。製品経路ではない。

通常の`select`/`verify`/`relink`でsourceを開くflagは`r`だけである。write/truncate/sync/remove/rename/link/utimesはmanifest処理または`self-test`の一時fixture操作に限定し、通常sourceへのwrite/delete/rename/chmod APIはない。

manifest v1はschema/revision、`reference-read-only` mode、explicit selection、platform、fully-qualified path、`FileHandle.stat({ bigint: true })`の`dev`/`ino` identity、size、mtimeNs、SHA-256を保持する。Windowsではdrive/UNC/extended drive pathを受理し、root-relative path、device namespace、NTFS ADSを拒否する。

## 実測環境

| 項目 | 実値 |
|---|---|
| OS | Microsoft Windows 11 Enterprise Insider Preview 10.0.29648、build 29648、x64 |
| 一時fixture volume | NTFS、Healthy |
| PowerShell | 7.6.5 Core |
| Node.js | 24.19.0 (`win32/x64`) |
| TypeScript | 7.0.2 |
| npm | self-test/compileには不使用 |
| source SHA-256 | `AAD3C41F9C0BD9D9248AA9E0BEE08D8C113E2F1DD55178BD6591AF66C7552D07` |

## 再現コマンドと結果

repository外の空build directoryへ次の条件でcompileした。

```text
node node_modules/typescript/bin/tsc --ignoreConfig --pretty false --target ES2024 --module node16 --moduleResolution node16 --strict --types node --skipLibCheck --outDir <temp-build> spikes/reference/reference-access.ts
node <temp-build>/reference-access.js self-test
```

- clean strict compile: exit 0
- emitted JavaScript: 44,123 bytes、non-empty
- self-test: `SELF_TESTED / 28_CASES_PASS`、exit 0
- editor diagnostics: 0件
- `git diff --check`: PASS

## 永続self-test 28ケース

| # | ケース | 検証 |
|---:|---|---|
| 1 | `absolute-select-read-only` | select前後のsource raw content/identity/hash/size/mtime/birthtime/nlink/mode不変 |
| 2 | `separate-process-verify-read-only` | 新process verify、source/manifest不変 |
| 3 | `hash-mismatch-relink-rejected-read-only` | exit 5、candidateとmanifest不変 |
| 4 | `missing-source-detected` | exit 3、移動先source不変 |
| 5 | `same-file-relink-read-only` | 明示relink成功、candidate source不変 |
| 6 | `post-relink-separate-process-verify` | 新processで再検証成功 |
| 7 | `replacement-identity-detected` | 同内容・metadataでも別identityを検出 |
| 8 | `replacement-identity-relink-read-only` | hash一致replacementへの明示relink成功、source不変 |
| 9 | `mtime-change-detected-read-only` | mtime変更をexit 4で検出、sourceは検査中不変 |
| 10 | `hash-change-detected-read-only` | hash変更をexit 4で検出、sourceは検査中不変 |
| 11 | `same-path-source-protected` | sourceとmanifest同一pathをwrite前拒否 |
| 12 | `hardlink-manifest-output-protected` | source hardlinkをmanifest出力先にした場合、`wx`で上書き拒否 |
| 13 | `manifest-as-relink-target-protected` | manifest自身をcandidateにする経路を拒否 |
| 14 | `manifest-hardlink-relink-target-protected` | Reference manifest hardlinkのsource利用を拒否 |
| 15 | `relative-source-rejected` | relative pathを拒否 |
| 16 | `windows-root-relative-source-rejected` | current-drive依存pathを拒否 |
| 17 | `windows-ads-manifest-rejected` | NTFS ADS manifest pathを拒否しsource不変 |
| 18 | `windows-extended-drive-path-round-trip` | `\\?\C:\...`形式でselect/verify成功、source不変 |
| 19 | `invalid-schema-rejected-read-only` | strict schema拒否、manifest不変 |
| 20 | `oversized-manifest-rejected-read-only` | 64 KiB上限超過を拒否、manifest不変 |
| 21 | `platform-mismatch-rejected-read-only` | platform不一致を拒否、source不変 |
| 22 | `epoch-mtime-round-trip-read-only` | mtimeNs=`0`を保存・parse・verify可能、source不変 |
| 23 | `reference-manifest-cannot-be-source` | valid Reference manifestをsourceとして登録拒否 |
| 24 | `select-failure-removes-created-manifest` | post-write faultで自分が作成したmanifestだけcleanup |
| 25 | `select-path-rebinding-detected-and-cleaned` | path rebindを検出しstale manifestをcleanup |
| 26 | `verify-manifest-path-rebinding-detected` | verify中のmanifest path rebindをfail-closed検出 |
| 27 | `relink-postwrite-failure-rolls-back-manifest` | post-write source faultでmanifest semantic contentを復元 |
| 28 | `relink-path-rebinding-rolls-back-manifest` | candidate path rebindを検出しmanifest semantic contentを復元 |

self-testのsource proofはraw content（内部Base64比較）、identity、SHA-256、size、mtime、birthtime、hardlink count、modeを比較する。read accessでWindows上変化し得たctimeは非変更判定に使用しない。値はstdoutや本記録へ出さない。

child結果は1行canonical JSON、exact key集合、status/reason/exit codeを検証する。duplicate keyや余剰keyを含む非canonical出力は拒否する。

fault hookはtest-onlyで、select cleanup、select/verify/relink path rebinding、relink rollbackの各防御を決定論的に実行する。通常CLIからhookを指定できない。

## 独立smoke

self-testとは別に、repository外fixtureで次を再実行した。

| 操作 | 実結果 |
|---|---|
| select | exit 0、`SELECTED` |
| 新process verify | exit 0、`VERIFIED` |
| 異内容relink | exit 5、manifest不変 |
| source移動後verify | exit 3、`SOURCE_MISSING` |
| 正しいrelink | exit 0、`RELINKED` |
| post-relink新process verify | exit 0、`VERIFIED` |
| source proof | bytes/hash/mtime不変 |

## 敵対的レビューと反映

再現した問題を同task内で修正した。

1. 保存済みself-testがなく、旧18ケースの大半を独立再現できなかった。
2. NTFS ADSへmanifestを書けてsource metadataを変更した。
3. valid Reference manifest/hardlinkを別Reference sourceとして登録できた。
4. select/verify/relinkで開いたhandleは検証してもpath binding変更を見逃した。
5. select失敗時にstale manifestが残った。
6. relink postcheck失敗でmanifestがrollbackされなかった。
7. Windows root-relative pathをfully-qualifiedとして扱った。
8. epoch mtime `0`をwriterが生成できる一方parserが拒否した。
9. self-testがselect前proof、raw content、identity/nlink等を比較せずfalse-greenだった。
10. child JSONのduplicate/余剰keyを受理した。
11. fault防御を外したmutantでもself-testが通った。
12. 旧結果文書がself-testと外部smokeを混在させ、FR-DAT-013/FR-PRJ-008全体を過大に対象化した。

修正後、Windows 28ケース、strict compile、独立smokeを再実行した。最終独立コードレビューは再現可能な残存欠陥0。manifestのin-place writeをcrash-atomicにすること、並行writerのapplication lock、symlink/junction production監査は正本どおりREL-01/SEC-03等へ委譲する。

relink rollbackはmanifestのschema/revision/path/identity/size/mtimeNs/hashを含むsemantic bytesを復元する。filesystem上のmanifest mtimeはrollback writeで変わり得るため、不変とは主張しない。Reference sourceのmtimeは不変性検査対象である。

## 公式一次資料

| 資料 | 取得日 | 取得時HTML SHA-256 | 適用 |
|---|---|---|---|
| https://nodejs.org/docs/latest-v24.x/api/fs.html | 2026-09-03 | `90EB62FE1766EAE9A7BDDA6A292F07CAB505397FCEBCAFA1D1E476BCB170AED1` | `fsPromises.open` flag、`FileHandle.stat({bigint:true})`、明示close |

## 未完了・blocker

1. Windows実機OS reboot: **NOT_RUN**。manifest保持→reboot→新session verifyが必要。
2. native Apple Silicon macOS 13+: **NOT_RUN**。`macos-result.md`参照。
3. identity実測はlocal NTFSのみ。ReFS/exFAT/SMBを推測しない。
4. Windows extended UNC pathはvalidation上受理するが、remote share実体を用いたround-tripはNOT_RUN。

したがってD-19、SPI-19、Gate 1は未完了であり、後続Reference本実装の開始条件を満たさない。
