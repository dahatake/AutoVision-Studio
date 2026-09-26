# UI/UX改善 実行記録

## 1. 承認・範囲・記録規約

- 2026-09-07のユーザー指示により、UI/UX改善プランのDU-01〜23を全て推奨Aで採用し、133 UIRタスクを実行対象とする。計画作成時の「利用者確認待ち」は履歴であり、現在の承認待ちではない。
- 実装→対象test/diagnostics→別担当の独立敵対的レビュー→指摘修正・再検証→次の依存タスクの順を守る。親担当が本記録と端末実行を直列管理する。
- 全UIタスクと必要な既存依存・レビューが完了した後だけ、`CHANGELOG.md`のUnreleasedへ概要とAdded/Fixed等の該当エントリーを記載し、その後root package/lockのPATCHだけを1増やす。worker版・未記入model版は変更しない。commit/tag/releaseは行わない。
- 現在の製品版は0.1.0。未完タスクを除外して完了扱いにせず、CHANGELOG/PATCH処理を先行しない。無関係な旧タスクやsample ENDを自動的に今回の終了条件へ追加しない。
- M1はshellのみ。Gate 1前にProject/core DB/APIを実装せず、model承認や本人による理解確認を代行・捏造しない。

## 2. 実行開始時の基準

HEAD `6523995637fb3085f2ef4642abe424652ab59cac`。既存の未コミットsample/doc変更を保持し、stashや巻戻しは行わない。下記は開始時のraw bytes SHA-256であり、以後の成果物hashへ書き換えない。

| 対象 | SHA-256 |
|---|---|
| UI/UXプラン v2 | `80c76acc48a33c5b7866a0d265373190d1e4371a4c6a4f4f6437ca2d9ed2526d` |
| 要求定義 | `19fd00cdc3db0029649477a644ffe876bc22fabb8b4a12d5d31c47b1b7ccc634` |
| 関連実装計画 | `025243c131c88c7d70fa31a32b888d8c70d708afc6a27159323d0adfc13f1fba` |
| package.json | `9eb7a83ad0d4e7e018a4115abfa7af97f1ad8b476f9857d4ad3b073a5e0d18bc` |
| package-lock.json | `7f1bd82efe1e4919dce6ddffdb763ceff4404d29b60e8e946a150345a8dfe1a5` |

PowerShell 7.6.5 Core、Node 24.19.0。既存の `%TEMP%/autovision-npm-12.0.0/node_modules/npm/bin/npm-cli.js` を実行しnpm 12.0.0を確認した。system npm 11.17.0は製品検証に使わない。実際の起動用shimは同じ一時環境の`node_modules/.bin/npm.cmd`であり、nested npmを含む実行ではこの`.bin`をPATH先頭へ置く。package内`npm/bin/npm.cmd`の直接実行は配置前提が異なり失敗したため使用しない。以下の文書静的検査はNode標準APIと既存文書checkerを直接利用する。

## 3. タスク実施・独立レビュー

| タスク | 状態 | 変更・検証とレビュー結果 |
|---|---|---|
| UIR-001 | 完了 | 要求§7にFR-UI-001〜011を追加。Node静的検査を初回・修正後に実行しexit 0。245定義一意、既存234要求行不変、§7外不変、自己参照・Markdownリンク0問題。diagnostics 0。独立レビューの比較条件差、model選択保持、10Hz読み上げ抑制の3件を全反映し、別担当の再レビューで3件閉鎖・追加指摘なし。 |
| UIR-002 | 完了 | 要求§16に受入22〜28を追加。初回検査で省略IDをcheckerが追跡しないことを検出し、完全表記へ修正。再実行exit 0で受入1〜28連続・11追加要求網羅・既存234行不変・リンク/参照0問題。diagnostics 0。別担当の独立レビューは指摘なし。 |
| UIR-003 | 完了 | 要求§17へ追加11要求の実装・受入・文書割当を登録。冒頭の更新日だけを同一baseline整合の明示例外として更新し、Draft版番号と過去の日付付き承認を保持。独立レビューの曖昧なDOC範囲1件を明示列挙へ修正。Node再検査exit 0：11行/245定義、既存234行不変、要求/タスク参照・リンク0問題、diagnostics 0、diff check通過。 |
| UIR-004 | 完了 | READMEの現在baselineだけをUI改善追補245要求と実計算raw/LF hashへ同期。`node scripts/docs/verify-documentation.mjs`、`node --test scripts/docs/verify-documentation.test.mjs`（22/22）、diff check全てexit 0。diagnostics 0、独立レビュー指摘なし。 |
| UIR-008 | 完了 | 関連実装計画冒頭の現在版・日付・245要求・raw/LF hashを同期。Node原本照合/全文書検証/diff check全てexit 0、diagnostics 0。独立レビュー指摘なし。 |
| UIR-009 | 完了 | V-D07を履歴保持して表示先を設定「ライセンス・情報」へ変更する承認追補を登録。全完了後だけのCHANGELOG/PATCH条件を同時記録。全文書・version検証と履歴行保持/版0.1.0/CHANGELOG不在確認exit 0、diagnostics 0。独立レビュー指摘なし。 |
| UIR-005 | 完了 | 関連計画§7.1へv2の133 UIR・23 DOC leafを明示参照登録。旧UI親の移管、backend/境界/起動/試験、PERF-03の単一所有を定義。旧260 ID一意保持・v2原本hash不変・全要求参照・全文書・diff検査exit 0、diagnostics 0。独立レビューで依存・移管の指摘なし。 |
| UIR-088 | 完了 | 別担当がCONTRIBUTING§8.1の表示先と新決定の注記だけ更新。製品版正本・worker版分離を維持。文書/表示先静的検査exit 0、diagnostics 0。独立レビュー指摘なし。 |
| UIR-089 | 完了 | サンプル§14 UI-03行の版表示条件だけを新決定へ同期。全文書検証・条件行照合・diff check全てexit 0、diagnostics 0。副作用禁止を保持し独立レビュー指摘なし。 |
| UIR-007 | 完了 | §5へUI実行順と編集排他を登録。全文書/version/diff検査exit 0、diagnostics 0。独立レビューで並列出力・Gate・本人確認・終了順の指摘なし。 |
| UIR-010 | 完了 | Clawpilot tokenとcontrast test。実失敗（asset URL変換、Node型境界、VitestのCSS空文字化、CSSOMのrgba空白差）を修正。出力に既存`vitest.config.ts`を明示追加（2 production＋1 test）し、raw import＋2対象CSSだけ処理。19テーマ/4shell回帰・型検査・diff check exit 0、diagnostics 0。独立レビュー指摘なし。 |
| UIR-011 | 完了 | 必要8 SVG部品と2通知を同梱。19テスト・型検査exit 0、全8geometryの全文が固定原本と一致。LICENSEはCRLFだけ、NOTICEはCRLFと終端改行1つの追加だけが原本との差で、本文は不変。diagnostics 0、独立レビュー指摘なし。 |
| UIR-012 | 完了 | workArea内に最大1360×800 DIPの外枠を中央配置。既存API・セキュリティ・resizeを維持。window8/security6テスト通過、型検査・diagnostics 0。独立レビュー指摘なし。実viewportはUIR-017で別検証。 |
| UIR-013 | 完了 | 5作業タブ・5設定カテゴリ・11画面の一次到達先metadataを追加。既存path/label/EmptyRouteを保持。routes5/shell4テスト通過、型検査・diagnostics 0。独立レビュー指摘なし。 |
| UIR-014 | 完了 | 5作業タブの手動選択とroving focus。初回16テスト通過後の独立レビューで外部選択変更後の余分なTab停止を検出・修正。前後Tab離脱/再入場と全5パネル参照を追加し18テスト・型検査exit 0、diagnostics 0。再レビューで指摘閉鎖。 |
| UIR-015 | 完了 | 5設定カテゴリ・戻る・実製品版・同梱icon通知全文を表示。未選択/未実装と仮の正常値を区別。16テスト・型検査exit 0、diagnostics 0。独立レビュー指摘なし。 |
| UIR-016 | 完了 | レビュー済み部品をshellへ統合。23shell/18tabs/16settings/19tokenの76テスト、型検査、Main/Preload/Renderer buildをnpm12で実行しexit 0。主headerのテスト特定を修正。diagnostics 0、独立レビュー指摘なし。Project/coreは未実装のまま、画面枠の到達性だけを改善。 |
| UIR-017 | BLOCKED（本人確認） | 一時profileの実Electronで技術確認PASS。28ケース/PNGの全hash、200%の37keyboard観測、100%/200%の通知末尾到達4件、source/build前後不変、exit 0/残process 0。独立レビューMajor 3件（画像上書き、200%keyboard検証不足、古い合成画像）を全修正し、新runと再レビューでClosed。本人確認NOT_RUNのため親taskとM1全体は未完。追加出力はtask限定の`tests/manual/ui-shell-probe.mjs`、証拠と限界は[実ウィンドウ確認記録](../tests/manual/ui-shell-review.md)。 |
| UIR-006 | 完了 | UIR-001後、別担当で8個の必要System Iconsの固定版・許諾を調査。親が10原bodyをメモリ取得しSHA-256/size/Git blobと台帳の10/10一致、8SVGの要素/属性を確認。取得・台帳照合exit 0、diagnostics 0、独立レビュー指摘なし。原本と未実施の加工・UI・配布検証を分離。 |

UIR-001のNode検査は `node --input-type=module -e` で既存checkerの `extractRequirementDefinitions`、`validateRequirementReferences`、`validateMarkdownLinks` と `assert` を使用した。既存234行をLF連結したSHA-256は `92b776812cf85d0ca7aaec0b9efbc9ad2592217873d4a1e08c16b26572a70ebd`、§7を除くLF本文は `b1c476fe60869296e3dbd8bf03a22f0e98e030c7cc5a7b7b90909d8fbccebeba` と照合した。現在hashはその後のUIR-004/008で同期し、全文書検証も通過した。

### M1技術検証時の全体回帰

2026-09-07、npm 12.0.0／Node 24.19.0／PowerShell 7.6.5 Coreで次を実行した。全対象完了後のUIR-086ではなく、今回の画面枠に対する回帰証拠である。

| 実コマンド | 結果 |
|---|---|
| `npm test` | exit 0。版検証25、文書22、Vitest 12 files/155 testsが全件PASS（合計202 tests）。Python/将来E2Eを実行したという意味ではない |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0。Main/Preload/Rendererと製品版0.1.0の検証 |
| `node_modules/electron/dist/electron.exe tests/manual/ui-shell-probe.mjs` | 最終run exit 0、`TECHNICAL_PASS_USER_NOT_RUN`。raw結果hash `d0ec93252331ee5f55cf821c0a21d07cf6fc2b87d97c8ae8d918bdfbfa0c0613` |
| `git diff --check` | exit 0 |

## 4. 未完了・停止条件

UIR-011の通知作業ツリーraw hashはLICENSE（1099 bytes）`9be360c19bf5502c7927a6ca365a7504b620b408cdf6e3e2413fa63a325bd381`、NOTICE（3963 bytes）`46fc95a58b4185fd2eaa8a8ab5399c1272bcaf8ee0ce13b186cbed499485c507`。原body hashは[採用記録](dependency-adoption/ui-icons.md)に保持し、同一bytesとは主張しない。

- 133 UIRタスク中、18件完了、UIR-017は技術PASS・本人確認BLOCKED。残り114件は未着手。後続を依存未完のまま開始せず、本人確認と外部Gateが必要なものを完了扱いにしない。
- UIR-D01A/D14AはUIR-017の本人確認後、実測した画面枠だけをguide/現行表へ反映する。UIR-019以後の機能実装は下記Gate 1に加え、既存domain/APIの完成が必要。
- Gate 1：SPI-03のclean Windows、SPI-05のNSIS同梱・起動、SPI-09のcamera→pipe実測、SPI-19のOS reboot後Referenceは不足したまま。今回もSPI-05/09の結果file不在を確認した。現hostや別processをclean Windows/OS rebootの代替としない。
- Gate 2：承認modelなし、実機品質・AutoML budget未確定。条件なしのmodel取得・承認をしない。
- GWHD素材のCSV競合停止は別sample laneの記録を保持する。標準UIの前提には追加しない。
- 本人確認・Windows実機/配布試験は対応する実測が必要。全実行対象完了までCHANGELOGとPATCHは保留する。

### 後日確認への引継ぎ

本人確認用の隔離プレビューを起動して依頼したが、利用者は現在対応できず後日レビューするとの応答だった。実操作・理解の結果ではないため、UIR-017を完了へ変更しない。プレビューは今回のMain processだけを限定して正常終了させ、残process 0件を確認済み。自律継続の指示を、本人確認・clean Windows・OS reboot・モデル承認の免除には読み替えない。

再開時はUIR-017の本人確認結果を[確認項目](../tests/manual/ui-shell-review.md#本人確認)へ記録し、問題があれば該当UIタスクへ戻して修正・再検証する。本人確認が済めばUIR-D01A/D14Aを続ける。業務機能は、Gate 1の実証不足を解消して既存CORE等の依存を閉じてからUIR-019へ進む。未完タスクを除外した完了率や架空の成果は記録しない。

## 5. 残タスク実行の再開（2026-09-07）

ユーザーの全残タスク実行指示後に現在の正本を再読したところ、実装計画§6/Phase CはSPI-03/09/19を`SKIPPED_BY_USER`とし、A-07・SPI-01/02/05/07/08/10成立後の`CONDITIONAL_GO`をcore/manual annotationの開発条件にしている。上記§4の旧停止理由は前回時点の記録として保持し、スキップしたPoCを再度開発前提へ戻さない。スキップはPASSではなく、モデル承認・正式package・camera・Referenceの製品受入は残る。本人確認も別の未完事項である。

SPI-05の予定2ファイルだけではインストール後の実worker起動・全file照合の再現手順が不足するため、旧IDを親にして次のleafと出力を実装前に固定する。全leafはtest→独立レビュー→修正再test後に後続へ進む。ルートpackage/lock・製品identityを変更せず、入力コピー・build・installer結果は専用一時領域へ分離する。

| 実行leaf | 出力 | 前提・確認 |
|---|---|---|
| SPI-05a | `spikes/packaging/harness.mjs`, `spikes/packaging/spi05.test.mjs` | 全file内容hash/size/path比較、実health/probeの意味検証、欠落・同サイズ改変・追加・junction・偽probeの負例。汎用package frameworkは作らない |
| SPI-05b | `spikes/packaging/main.mjs`, `spikes/packaging/run.mjs`, `spikes/packaging/electron-builder.windows.yml`、同taskの`spi05.test.mjs`へ追加 | SPI-05a後、既存onedirを現hostで実検証→snapshot→専用per-user NSIS→隔離install→installed Electronから実worker起動→同梱前後照合→専用uninstall。未知の所有物を削除せず、正式署名/clean Windowsを主張しない |
| SPI-05c | `spikes/packaging/windows-installer-result.md` | SPI-05bの実結果・失敗・残存物・原本/配布hash・独立レビューを照合し、親SPI-05を判定 |
| SPI-10再検証 | 既存の`build/spi10/` harness/resultと`spikes/annotation/result.md` | **完了**。create sample 6の描画安定失敗と、別試行のVitest worker起動timeoutをPASSへ読み替えず履歴化。現行sourceを変更せず再実行したrun `710f0ba5-40f1-4744-89fd-27a61714554c`は9 unit、strict typecheck、構文、build、6操作×100実測、4敵対probe、終了確認をPASS。独立監査でraw evidenceは有効、文書の旧run値だけを修正対象と判定して反映し、再レビュー指摘0件。SPI-10は`CLOSED / VERIFIED` |

SPI-05のホスト変更はUUID付きの専用PoC identity、専用install先、専用updater cache、対応するレジストリキーだけに限定する。NSISが作るユーザープロファイル内の専用cacheは存在確認と限定cleanupを記録し、「ホストprofileへ一切書かない」とは表現しない。管理者昇格や既存製品のinstall/uninstallは行わない。builderが必要なNSIS toolsetを取得する場合は開発時取得として出典・版・hashを記録し、runtime取得へ接続しない。

### SPI-05a 入力検証の完了

2026-09-07、`node --test spikes/packaging/spi05.test.mjs`は23/23 PASS、skip 0、exit 0、対象diagnostics 0。別担当の敵対的レビューで発見した重複JSONキーによる成功偽装、停止要求の反復と終了待ち無期限化、junction負例不足を修正し、再レビューで3件をClosedとした。Pythonの`4.0`表記は許容しつつデコード後の同一キーを拒否する。実Nodeの正常/異常終了・出力超過・timeout・子孫終了・taskkill不在、実Windows junction（root/配下）を検証した。親先行終了ではWindowsのpipe継承の実挙動に従って正常な親receiptか有限のcleanup未確認エラーを検査し、孤児回収の一般保証はしない。

前回SPI-05b（run `959366eb-3465-4a99-87a3-6b22f34f9d55`）はbuilder成功後、installed Electronが成功終了せずFAIL。成功へ読み替えない。調査でESM最上位`await main()`→`app.whenReady()`の循環待ちを確認したため、最上位で待たない起動とready前のprofile directory作成を修正する。後続の実package再実行までSPI-05b/親SPI-05は未完了。

### CORE実装の開始

Gate 1の`CONDITIONAL_GO`後、CORE-01の`src/main/paths.ts`／`paths.test.ts`を実装した。Electronの信頼済みuserDataから既定projects/cache/logsを純粋に計算し、I/Oや任意Project保存場所の強制は行わない。17テスト・型検査・diagnosticsが通過し、独立レビュー指摘なし。CORE-01完了としてCORE-02へ進む。

2026-09-08再開時、CORE-02のファイルは未作成だったため、`src/main/db/database.ts`／`database.test.ts`を新規実装した。絶対パスの実SQLite接続、foreign_keys/WALの実効値確認、失敗時close、既存file保持、再open、WAL読取り/書込み排他を検証した。16 tests PASS、CORE-01との合計33 tests PASS。spy instanceの型注釈を修正後、型検査と差分検査exit 0、diagnostics 0。独立レビュー指摘なしでCORE-02完了。Mainの単一接続を起動・終了へ配線するUIR-019はまだ未実施である。

CORE-03は`src/main/db/migrate.ts`／`migrate.test.ts`で実行中。同梱SQLの全履歴を連番で扱い、未適用分の一括transactionとschema版更新・失敗rollbackを実装する。外部SQL実行API、ORM、可変migration registryを追加しない。実DBのrelease前backupはREL-02、実際の業務schemaはCORE-04以降に分離する。

**CORE-03完了（2026-09-08）:** 実DB16 testsとCORE-02との合計32 tests、型検査exit 0、diagnostics 0。独立レビューが指摘したロック順序のテスト不足を修正し、ロック失敗時はschema版を読んでいないことをspyで確認した。修正後16 tests・型検査を再実行し、再レビューで指摘Closed。CORE-04は`001_core.sql`と`schema.test.ts`の2ファイルで実行中。UUID・Unicode詳細検証はCORE-05/06に残し、DBにはprojects/settingsだけを作り、業務データや未使用の設定をseedしない。

**CORE-04完了（2026-09-08）:** schema8 tests、接続/migrationを含め40 tests PASS、型検査exit 0、diagnostics 0、独立レビュー指摘なし。同名ProjectのUUID分離、属性保持、SQL制約、設定seedなしを実DBで確認した。CORE-05は共有Project契約と対象testだけを追加する。共有契約のpath検査は非空/NUL拒否までとし、実ディレクトリのアクセス・権限・所属はMainの責務とする。

**CORE-05完了（2026-09-08）:** Project契約25 tests、core関連計82 tests PASS、型検査exit 0、diagnostics 0、独立レビュー指摘なし。CORE-06はProject repository/serviceと対象testに加え、未配布の初期migration `001_core.sql`へtask種別のlockフラグを追加する（3 production＋1 test）。Run自体の表はまだ作らず、初回Runのtransactionからlockを設定する接続はJOB/ANN-22へ残す。既存Projectデータ移動・参照元削除・自動学習は行わない。

**CORE-06の独立レビュー（部分実装）:** 作成/取得/一覧/名前・説明・未lock時のタスク種別更新と永続lock基盤を実装。初回15 tests・型検査はPASS。レビューでWindows禁止文字/予約名/末尾dot・spaceのmetadata保存を指摘され、Mainで拒否する負例を追加した。保存場所変更は安全な移動未実装のため明示拒否し、成功へ偽装しない。

CORE-06全体は未完了であり、CORE-07の着手条件へ転用しない。削除はCORE-10/REL-04、実Run作成との同一transaction lockはJOB/ANN-22で検証する。保存場所移動はUIR-023へ接続する前のCORE-06残部として担当し、失敗時の旧path・既存データ保持を必要とする。現時点はfile I/Oがないため同じ選択pathのmetadataを許容しているが、最初のfile I/O前に「選択pathが所有rootか親folderか」を固定し、所有rootの同一/親子包含・実体別名による他Projectへの影響を拒否する。UUIDが異なるだけでファイル所有の独立性を検証済みとはしない。

**2026-09-08の再開結果:** CORE-02（接続16 tests）、CORE-03（migration16 tests）、CORE-04（schema8 tests）、CORE-05（契約25 tests）はそれぞれ対象検証・独立レビュー・指摘反映を完了した。CORE-06は保存/update/lock基盤の25 testsが通過し、Windows path要素検証の指摘は再レビューでClosed。上記の所有root・移動等を残す部分実装である。

最初の並列回帰はProject契約用Vitest workerの起動timeoutにより失敗し、65 testsの部分成功を全体合格にしなかった。その後、実行時だけworker数を1へ限定した`npm test -- --maxWorkers=1`で18 files/263 Vitest tests、版検証25、文書22が全件PASS（合計310 tests）。`npm run typecheck`、`npm run build`の3 entry、`git diff --check`もexit 0。実行環境はNode 24.19.0／npm 12.0.0／PowerShell 7.6.5 Core。製品版0.1.0、package/lockとCHANGELOGは今回変更していない。coreはまだMain entryやUIへ配線していないため、build成功をProjectのアプリ操作可能という証拠にはしない。

### A-07 Windows範囲の同期（実装前登録）

Gate 1入力の点検で、`resources/models/manifest.schema.json`のsupportがWindows/macOSの4組を必須にしたままというWindows MVP同期漏れを確認した。A-07の補修leafとして、このschemaと` scripts/models/manifest-schema.test.mjs `の2ファイルだけを所有する。Windows CPU/DirectMLの検証済み2組を必須とし、将来macOSをVersion 1の配布entryへ混在させない。C6/C7×分類/検出の4区分、許諾・商用利用・証拠・承認・安全形式・パスのfail-closed条件は保持し、`manifest.json`の空models/ready=falseを変更しない。

テストは既存lock内のAjv（8.20.0、electron-builderのdev依存）でdraft-2020-12 schemaを検証する。追加runtime依存・lock変更・新しい汎用validatorを作らず、正負fixtureを1ファイルに保存する。schema変更だけでmodel承認やGate 2合格にはしない。対象テスト・独立レビュー・再検証後にGate 1の入力へ戻す。

**A-07同期完了:** `node --test scripts/models/manifest-schema.test.mjs`は35/35 PASS、skip 0、exit 0。独立レビューが指摘したWHATWG URLによる不正な生空白・制御文字・逆斜線の補正受理をテスト用format判定で拒否し、全URI欄の負例を追加・再検証。再レビューで指摘Closed。実manifestの空models/ready=false、4役割、許諾・承認条件は保持した。

### SPI-05b 独立レビューの追補

独立監査により、UUID固有exe/GUID、CIMエラーのfail-closed検査、コピーしたuninstaller本体の終了待ち、HKCU Registry64の双キー照合を追加した。40テストは全件PASS、skip 0。NSIS 26.15.3の既定app-running検査はWindows PowerShell 5.1を直接起動するため、専用の`customCheckAppRunning`置換が必要である。

この設定をSPI-05b内の小leafとして、追加出力`spikes/packaging/installer.nsh`＋既存YAML、対象`spi05.test.mjs`へ限定する。新規pluginや依存は導入せず、既存の最新PowerShell 7の実体をbuild時に固定して直接呼ぶ。UUID固有exeの実行中検出や照会失敗では停止し、他runを強制終了しない。`run.mjs`へのinclude/source-hash配線は同leafの登録処理として行う。これは開発host専用PoCの前提であり、製品installerのruntime不要条件を満たすという主張には使わない。

### Gate 1入力と判定の完了

**現行SPI-05追補:** run `d3e23532-dbfe-4341-bbd1-94667ec47fdd`で41 tests・7 source hash前後一致・全2,500 file同梱・実installed health/CPU/DirectML・uninstaller本体終了・Registry64双キー/専用cache回収がPASS、独立レビュー指摘なし。raw結果SHA-256は`1dda848218bdc853f7c568ac3bb629cdcfd945c9a8b09490b5a272c386e6dcd7`、installerは237,044,086 bytes / `9a4b64e77a4595f84234b6744b55fb9e632bdd6ca63d2da76c9680c585dbe85e`。以下の別run・回帰件数は従前の実行履歴であり、現在のharness結果へ転用しない。

- **A-07:** Windows x64のCPU / DirectML各1件だけを必須にするschema同期を完了した。C6 / C7×分類 / 検出4役、許諾、由来、hash、安全形式、path等のfail-closed条件と空の非release manifestを保持し、Node test 35件PASS、独立レビューblocking 0でCLOSEDとした。`resources/models/manifest.json`は`ready=false`、`models=[]`のままである。
- **SPI-05b / 05c:** accepted run `b6cba50c-92fa-4da9-af08-5815a585c4b3`で、開発用unsigned NSIS EXEへのonedir 2,500 file / 529,582,875 bytesの同梱、source / staging / unpacked / installedの全path・size・SHA-256一致、install後の実health / probe、uninstall後の専用process・directory・registry・updater cache残留0を確認した。対象Node test 24件、構文・差分検査をPASSし、二段階独立レビューをCLOSEDとした。production config、正式署名、SBOM、clean host、servicingは対象外のままである。
- **Gate判定:** A-07とSPI-01/02/05/07/08/10の合格、SPI-03/09/19の`SKIPPED_BY_USER`と残存リスクを[ADR-0004](adr/0004-spike-decisions.md)へ記録し、Gate 1部を`CONDITIONAL_GO`とした。これはcore / Project / data import / manual annotationの開発開始だけを解放する。Gate 2は`BLOCKED / NOT_COMPLETE`、SPI-18全体は`IN_PROGRESS`で、UIR-017本人確認、model、camera、Reference、production package、Gate 3〜5を完了扱いにしない。
- **横断回帰:** exact npm 12.0.0でproduct version 25件、documentation 22件、Vitest 12 files / 156件、typecheck、Main / Preload / Renderer buildをPASSした。uv 0.12.9でlock check / sync、pytest 4件、Ruff check / format、Pyright 0 errorsをPASSし、Node / Python両lockのbytesは不変だった。

## 6. 2026-09-11 CORE-06残部の再開

サンプル再開プランのデフォルト承認と[実装計画§15](implementation-plan.md#15-2026-09-11-サンプルprojectの再開割当sp-04)に従い、CORE-06A〜Fへ分割して実行する。既存`workspace_path`を正本にし、親folder配下のUUID別rootと最小所有markerを使う。旧metadataだけのpathやUUID名を所有の証拠にせず、所有未確認の行を自動移動・回収しない。SP-04の敵対的レビュー2件の反映と文書22tests・再レビューCLOSEDを先行条件として確認した。

### CORE-06A 所有root検証

`src/main/projects/project-directory.ts`と`project-directory.test.ts`を追加。既存親folderの実体/ancestor、Windows名・alias・包含・junction/symlinkを検査し、UUID子rootを排他作成する。最小markerとrootのidentityを照合し、createの同process receiptだけが新規marker-only root回収を許す。未知file・差替えを削除せず、再帰削除は製品helperに使わない。通常serviceへの接続はCORE-06Bであり、このleafでProjectの画面操作が可能になったとは扱わない。

最初の親実runは17 failed / 49 passed。ESM namespaceへのspyとctime比較を修正した第1回再検証は13 failed / 59 passed / 1 skipped。Node単独では同じ既存fileの値が一致する一方、テスト環境の作成直後のmarkerでは、openの間にpathのctimeだけが更新される実値を1ケースで観測した。identity/size/mtime/原bytesは不変だった。第2回修正でopen直後のpath snapshotを比較基準にし、読取り中は各APIのctimeも含めて検査する。実体・size・mtime・canonical bytes・nlinkの拒否は維持し、安定したAPI差/metadata更新の正例と読取り中変更の負例を追加した。一時観測コードは除去済み。

最終実runはNode24.19.0/Vitest4.1.11/PowerShell7.6.6、`node node_modules/vitest/vitest.mjs run src/main/projects/project-directory.test.ts src/main/projects/project-service.test.ts --maxWorkers=1 --reporter=dot`で**2 files、73 passed / 1 skipped（directory49＋service25の74ケース）**。skipはOSが拒否したfile symlink作成1件、native junctionは実行済み。exact npm12.0.0で`npm run typecheck`成功、diagnostics0。別担当の独立敵対的レビューで必須修正0。CORE-06Aは**完了**とし、Bへ進む。CORE-06全体、CORE-07、UI/モデル/配布Gateはまだ未完で、CHANGELOG/PATCHは保留。

### CORE-06B / CORE-06C：作成接続と移動前検査

CORE-06Bは`project-service.ts`/testと共有Project契約コメントを更新し、createの入力親→UUID子root/marker、DB/応答の実root、既存transaction内のI/O前拒否、作成失敗時の限定回収を実装した。旧metadataは自動移動せず、未知file・root/marker差替え・DB rollback失敗時は保持する。実SQLiteのAFTER INSERT RAISE(ABORT/FAIL/ROLLBACK)等を含む**44 cases全件成功**、Aとの回帰とJOB-01を合わせ175 cases中174 passed/1 skipped、exact npm12型検査成功、独立レビュー必須修正0。Bを完了とするが、明示移動の接続はFまで未完。

CORE-06Cは`project-move.ts`/testへasync読取り専用inventory・全再検証・移動先容量preflightを実装。markerで所有確認したrootの相対path/実bytes/hash/identityを取得し、Reference JSONの外部pathを解釈せず、リンク/hardlink/原本・他Project越境を拒否する。最初の37 casesはテストのパラメーター引数とTestContextの混同で3 failed/34 passed。fixture定義だけ修正後は**36 passed/1 skipped**、JOB-02と合わせ337 cases中336 passed/1 skipped。型検査・diagnostics0、独立レビュー必須修正0でC完了。skipはfile symlink権限、junction/hardlinkは実行済み。実copy/DB切替/元回収の合格ではない。

### JOB-01 / JOB-02：共有担当の確定と検証

JOB側はサンプル/Core担当へ集約し、UI v3担当の同file再編集は停止している。以下はサンプル/Core担当が実原出力を確認した完了証拠であり、並行担当の未確認実行を成功へ転用していない。

- **JOB-01完了:** `002_jobs.sql`・`src/shared/contracts/job.ts`・`job-schema.test.ts`の3file。id/Project/kind/status/作成更新時刻の6列、9状態、scan-dataset/assist/trainのみ、seedなし。実SQLiteのschema/migration/FK/再open/transaction・strict DTOの**82 cases全成功**。型検査成功、独立レビュー必須修正0。SQLのIDE診断は一時的に本文にない旧RESTRICTを指したが、現本文NO ACTIONのDDLを実SQLiteが実行して成功しており、方言に合わせてSQLを弱めていない。
- **JOB-02完了:** `src/main/jobs/job-repository.ts`・`job-state.ts`・`job-state.test.ts`の3file。種類別合法遷移、終端状態、Queued限定作成、Project/job帰属、全snapshot CAS、実DB rollback/reopenを**300 cases全成功**。型検査・diagnostics0、独立レビュー必須修正0。Interruptedのresumeは後続のcheckpoint互換性検査なしには許可しない。Worker起動・実Queue・request・progress保存はまだ未実装であり、本2taskで全runtimeを完了にしない。

共有CLI/probeはUI v3側のCORE-11が担当し、こちらはそのfileを編集しない。CORE-06DとJOB-03の後続結果は次項に記録する。

### CORE-06D：非破壊移動の完了

`project-move.ts`/testに、実DBの選択Project→全所有fileのasync排他copy→hash検証→短いtransactionでのroot切替を実装。sourceは保持し、元回収・永続receiptはE、通常serviceの更新guard/移動接続はFへ残す。全DB登録rootと指定原本を保護し、copy/SQL失敗時は新規targetの帰属/内容を照合して限定回収する。未知file・差替え・DB commit応答不確定時はtargetを保持する。同一volumeの実fixtureで検証し、別volume実測の成功は主張しない。

初回54cases中、開いたwriterがある状態でrootをrenameするfixtureをWindowsがEPERMで拒否した。fixtureをhandle解放後に変更して53 passed/1 skipped。独立敵対的レビューは、(1) hash handleのclose後に置換されたfileをunlinkできるawait区間、(2) source全検証後のtarget検証中にsourceを変更できる区間の2件を指摘した。最終await後の同期snapshot/ancestor/marker/DB guard→同期unlink、両inventoryの同期全metadata/listing guardからCOMMITまでawaitなしへ修正。2回帰を追加し、closeの二重呼出しでfixtureを二重置換していた点も一度限りの注入に修正した。

最終runは`node node_modules/vitest/vitest.mjs run src/main/projects/project-move.test.ts src/shared/contracts/worker.test.ts --maxWorkers=1`、**110cases中109 passed/1 skipped**（move56cases中55成功、Worker54成功）。exact npm12の型検査成功、対象TS diagnostics0。独立再レビューは2件ともCLOSED、新規必須指摘なし。**CORE-06D完了**。不可避な敵対的OS操作への原子性保証や、E/F・実アプリ接続の完了へ拡大しない。

### JOB-03：契約実装・テスト成功、エディター診断で停止

`src/shared/contracts/worker.ts`、`worker.test.ts`、`ml/src/autovision_ml/protocol.py`、`ml/tests/test_protocol.py`を実装した。既存JOB-03出力へTS側の生産者/消費者契約テスト1fileを追加した最小範囲で、他のCLI/probe・依存lock・モデルは変更していない。schemaVersion1、job/Project相関、固定3commandのrequest、started/progress/warning/completed/failed、cancel入力、64KiB/深さ64、UTF-8・重複key・非有限値等を検証する。command固有payloadと成果物権限/hash・Worker起動/順序は後続に残す。

初回TSのTextEncoder由来cross-realm Uint8Array拒否を修正。Python37tests成功後のstrict型6件を修正し、独立レビューが見つけた大文字MAX UUIDの両言語差はworker契約内で検証前に小文字化して解消した。正常payloadでの深さ64/65、数値1.0/1e0、BOM bytes、surrogate pair等の共通回帰を追加。最後のLiteral絞り込み修正後は**TS54tests成功、Python53tests成功、Ruff check/format2files成功、対象Pyright0 errors/0 warnings/0 informations、TypeScript型検査成功**。独立再レビューでUUID指摘CLOSED、新規必須指摘なし。

ただし17:03のProblems再取得では、`protocol.py:203`に`kind`がobjectとする別型検査のTypedDict診断、`tests/test_protocol.py:7`にimport先のstub/py.typed不足診断が残っていた。選択Pythonは`ml/.venv/Scripts/python.exe`と確認済みであり、環境違いと決めつけない。Pyright成功をこの診断解消へ転用せず、**JOB-03はDIAGNOSTICS_BLOCKED・未完了**。修正を3回行ったため規約に従い後続実装を停止し、診断元/設定・型絞り込み・packageの型情報認識の調査を次の独立作業単位にする。`002_jobs.sql`の本文にない旧RESTRICT診断も保持して報告し、実SQLite成功と区別する。

再開メモを保存。サンプルのSP-01〜06と依存CORE-06A〜D・JOB-01/02を完了し、SP-07〜44・CORE-06E/F・JOB-03以降は未完。全件の完了は宣言せず、CHANGELOG/PATCH・commit/tag/releaseは実施しない。文書checker・対象diff check・製品版0.1.0の整合検査は停止前に成功した。

### JOB-03D：再指示後の診断解消・JOB-03完了

ユーザーの「全ての残作業を実行」指示後、残診断を別leafとして修正した。`protocol.py`のkindを許可3文字列の明示Literalへ代入し、外部JSONのcastや検査抑制を使わず両checkerで型を確定した。補助mypy拡張のcwd/interpreter/extraPathsだけを新しい`.vscode/settings.json`で`ml`/`ml/.venv`/`ml/src`へ合わせた。実venvからpytestと自packageの実体解決を確認し、Problemsのkind・import診断が0件となった。SQLの旧RESTRICT診断も再取得時には消えていた。global設定、依存追加、severity/ignoreによる隠蔽はしていない。

親の実runは文書22tests、Worker TS54tests、Python53testsがすべて成功、Ruff check/format2files成功、対象strict Pyright0errors/0warnings、対象editor診断0。開発ガイドのVS Code節へ設定の根拠を追記し、別担当の敵対的レビューは必須修正0。**JOB-03DおよびJOB-03を完了**とする。先行の停止記録は当時の事実として保持し、実Worker/Queueは後続JOB-04以降のまま。E1/E2の分割追補も独立レビュー必須修正0で、E1とJOB-04を別fileで進める。

### JOB-04：有限Worker supervisorの完了

`worker-supervisor.ts`/testにMain専用設定からのshellなしspawn、固定request保存、UTF-8分割/64KiB行/合計出力上限、相関・順序・進捗、stderr秘匿、closeとexit確認、所有manifest locatorの安定hash検証を実装した。Main policyのtimeout/grace/close上限を必須とし、cancelは対象の直接childだけへ送信・停止する。子孫tree終了やtask固有manifest/モデルの内容検証・DBcommitの完成は主張しない。

初回の正常系はstrict相関schemaへrequest全体を渡して失敗し、2 IDだけへ修正。Windowsのpipe終了を仮定した2fixtureとテストのイベント型を修正後61tests成功。独立レビューで準備I/O完了前のcancel確定を指摘され、待機・期限超過未確認を実装して80tests成功。再レビューでmanifest read/close完了前のtimeout確定も指摘され、検証I/O・close拒否の扱いを追加した。最終**94tests全成功、型検査・diagnostics0**、独立再レビューで両指摘CLOSED・新規必須指摘なし。終了未確認は`WORKER_CLOSE_TIMEOUT`/`terminationConfirmed:false`で領域保持とし、後から成功へ変換しない。JOB-04を完了。実Python scanコマンドとJOB-05/Queueは後続のままである。

### CORE-06E1a/E1b/E2：永続記録・回収と再開の完了

E1は専用`project-move-receipt.ts`/testと既存mover/testの接続へ分割し、正本§15・文書22tests・独立レビューを先行した。**E1a**は厳密な固定schema、16MiB上限、BigInt十進文字列、payload checksum、深い不変snapshot、Main管理app-data/project-movesの排他的intent、実fingerprint付き更新/読込を実装。テストmockの型2件修正後**149 passed/1 skipped、型検査成功、独立レビュー必須0**。

**E1b**はmoveの第5引数を必須Main専用receiptDirectoryとし、intent→copy→prepared→両側再検証→同期COMMITを接続した。失敗したreceiptを消さず、DB再open後にdisk記録だけから状態を復元する。mover69＋receipt150の**219cases中217 passed/2 skipped**、型検査成功、独立レビュー必須0。元回収はこの段階で未実施だった。

**E2**は`recoverProjectMove`とreceiptの最終同期確認・回収を実装。現DBがtargetを指し、元の残存inventory・先の全inventoryが合致した場合だけ、通常file→子directory→marker→rootの固定順で回収する。各削除の前にpendingを永続化し、成功後cursorを保存。説明できない欠損・変更・余剰・他Project重複・不正receiptは停止・保持し、DBを部分削除した元へ戻さない。copying/DBが元の場合はsource-retainedとして自動回収しない。

初回は再開テストの観測mock再帰1件で失敗。旧mockを解除してから再観測するfixture修正後、mover148＋receipt160の**308cases中306 passed/2 skipped**、型検査成功、対象diagnostics0。独立敵対的レビューで必須指摘0。skip2件はnative file symlink権限不足、junction/hardlinkは実行済み。**E1a/E1b/E2を完了**。この結果は同一volumeの一時DB/root試験であり、電源断耐久性・敵対的OS原子性・実UI/インストーラーの合格ではない。CORE-06全体は通常service接続のFとレビューまで未完。

### CORE-06F：通常service接続・CORE-06完了

`project-service.ts`/testにMain専用`moveProject`/`recoverProject`を接続し、moveから回収までの全await区間と通常metadata更新を同Projectのbusy検査で保護した。回収失敗は現在のDB保存先＋回収未確認の固定警告として返し、切替済みのmoveをやり直す失敗表示にしない。元rootが完全に残るという保証でもなく、明示復旧を案内する。別Projectの編集、旧metadataの非採用、createの既存境界は維持する。

既存moverの競合テスト3箇所は通常updateの拒否を確認した後、外部DB変更を直接注入して後段CAS検出を維持した。service66＋mover148＋取込契約TS62の**276cases中275 passed/1 skipped**、exact npm12型検査・対象diagnostics0。独立敵対的レビューは必須修正0。**CORE-06FおよびCORE-06を完了**とし、CORE-07C/H/Pを開始可能とする。UI操作、他domainの書込排他接続、実job中の移動禁止、正式配布は各後続taskで検証する。

### CORE-07・DAT・UIR-019：親担当の検証追補（2026-09-12）

以下はCORE-06Fの記録後に親担当エージェントが確認した実行結果・独立レビューの引継ぎ記録である。本追記で再テストした結果や、利用者による実操作・本人確認の記録ではない。件数は各runの対象範囲に限定し、異なるrunや除外ケースを合算して全体PASSとしない。

**CORE-07：契約・handler・Preload factory**

| 対象 | 検証・修正・判定 |
|---|---|
| CORE-07C | 契約**69 tests PASS**、独立レビュー必須指摘0。完了。 |
| CORE-07H 初回 | handler50＋契約69＝**119 tests PASS**。ただし独立レビューで、非同期処理をまたぐ選択親folderのidentity喪失と、createのCOMMIT成立後の応答例外でrootを削除する問題の2件を指摘された。テスト成功だけでは完了としなかった。 |
| create補修 | COMMIT後の応答例外でrootを回収しない修正を行い、**service68 tests PASS**、独立再レビューCLOSED。 |
| CORE-07H-R1 | 選択親identityの保持・検証を補修し、**対象83 tests PASS**。getter fixtureの失敗は`Object.is`による比較で修正し、テストには20秒の有限timeoutを設定した。filterで除外された148件はこのrunで再テストしていない。 |
| CORE-07H-R2 | 実handlerから選択親identityを渡す接続を検証し、handler52＋契約69＝**121 tests PASS**、型検査0 errors。独立再レビューで初回の2指摘ともCLOSED。Hを完了とする。 |
| CORE-07P | factoryの**86 tests PASS**。実Node probeでZodが入力の`__proto__`を除去する挙動を確認し、入力のown keysを明示検査して、不正入力ではinvokeしないguardと回帰を追加した。独立レビュー必須指摘0。完了。 |

**CORE-07親タスクは完了**。ただしMain/UI entryへの接続や、実アプリでProject操作が可能になったことの証拠ではない。

**DAT：共有契約・取込検証**

| 対象 | 状態 | 検証・レビューと範囲 |
|---|---|---|
| DAT-01a | 完了 | 微小bboxの右端判定の修正に続き、対称な減算比較への修正をTS/Python両共有契約へ反映。最新版で**TS62 tests／Python62 tests PASS**、対象strict型検査・Ruff成功、独立再レビューCLOSED。 |
| DAT-02 | 完了 | **54 passed / 1 skipped**（symlink）。対象品質検査成功、独立レビュー必須指摘0。skipを成功件数へ含めない。 |
| DAT-03 | 完了 | decode後画像検証は**61 cases中60 passed / 1 skipped**。対象品質検査成功、独立レビュー必須指摘0。 |
| DAT-04 | 完了 | 分類取込は**61 cases中60 passed / 1 skipped**、対象品質検査成功。レビューで検出したUnicode `casefold`による`ß`/`ss`の衝突を、比較キーのASCII限定処理へ修正。8件の回帰を追加し、独立再レビューCLOSED。 |
| DAT-05 | **未完了・修正後の再検証待ち** | 直近の**206 passed / 1 skipped**は第2回レビューのbbox対称性修正前の結果。P2指摘1件はpatch適用済みだが、修正後のテスト・独立再レビューを待っている。この件数を最新patchのPASSや指摘CLOSEDへ転用しない。 |

**UIR-019：Renderer／Preloadの検証とMainの残部**

- **UIR-019R完了:** AppShell **23 tests PASS**、型検査成功、文書 **22 tests PASS**、独立再レビューCLOSED。これは対象fixtureの検証であり、実アプリ起動の受入ではない。
- **UIR-019P完了:** Preload **101 tests PASS**、Renderer **23 testsはforksでPASS**。型検査成功、PreloadのVite build **67.06KB**で成功、独立レビュー必須指摘0。最初のcombined runはRendererのthreads worker起動で失敗しており、他の163 testsが成功していても全体PASSではない。その失敗履歴を保持し、後続のforksによる23 tests成功とは分けて記録する。
- **UIR-019Mは実装中・未完了:** Main entryの実装・接続に対する検証と独立レビューが残る。R/Pの成功をMain接続やUI entryの準備完了へ拡大しない。

全残作業の実行指示は継続中であり、本追記を終了宣言やGate免除としない。親担当はDAT-05の修正後テスト→独立再レビュー、UIR-019Mの実装→対象検証→独立レビュー→指摘修正・再検証を続け、依存成立後のSP-08と残りSP作業へ進む。SP-07の`verification.md`更新は親担当の別作業とし、本追記では変更しない。

**DAT-05・UIR-019M・SP-08および残りSP作業を含む全体は未完了**。アプリ全体・モデル・camera・Hugging Face（HF）・clean installの準備／受入完了は未達であり、本人確認・モデル承認・実機／配布Gateを代行しない。モデルは引き続き`ready=false`、製品版は**0.1.0**のまま。全対象完了前のCHANGELOG/PATCHは保留し、版変更・commit/tag/releaseは行っていない。

### DAT-05・UIR-019：最新完了状況の追補（2026-09-12）

本節は親担当エージェントの実行結果・独立レビューに基づく現在判定であり、ユーザー自身の試験報告でも、この文書追記で再テストしたものでもない。直前節のDAT-05「修正後の再検証待ち」とUIR-019M「実装中」は当時の履歴として保持し、現在判定を以下へ更新する。共有契約・R/Pの再掲件数を追加成果として二重計上せず、各runの成否を分ける。

**DAT-05完了：浮動小数bboxの対称比較**

- 既存の減算比較へ`x > W - w`と`y > H - h`を追加する必須修正後、実runは**209 cases中208 passed / 1 skipped**（file symlink）。Ruff check / format成功、Pyright **0 errors**、独立再レビューCLOSED。この検証にDB書込み／commitは含まれない。
- 同じ対称比較を反映した共有契約は**TS62 tests／Python62 tests PASS**。DAT-05とは別の独立再レビューでCLOSEDとした既記録の結果であり、今回新たに加算する件数ではない。

**UIR-019R/P/Mおよび親UIR-019完了**

- **UIR-019R:** AppShell **23 tests PASS**、独立再レビューCLOSED。APIにアクセスしていないことを確認するgetterをthrowさせるテスト補修で、型付け方針・実UI機能は変更していない。
- **UIR-019P:** **101 tests PASS（factory86＋index15）**。`AppApi`のversion **1**を維持して`projects`を公開。型検査とPreloadのVite build（dist **67.06KB**）成功、独立レビュー必須指摘0。combined runは**163 testsが成功していても、Rendererのthreads worker起動失敗によるunhandled errorを記録しており、run全体はPASSではない**。別runのforksによるRenderer **23 tests PASS**と区別する。
- **UIR-019M:** 新規Main indexテストは**27 tests**。実SQLiteのbackup・`001`/`002` migration、source recovery、shutdown時のIPC drainを検証した。初回27 tests PASSでも型検査は**29 errors**で失敗しており、循環した`TestHarness`型とVite型importを含む問題を明示interface／triple-slash参照へ修正した。最終**27 tests PASS**、exact npm **12.0.0**での型検査とaggregate build（Main／Preload／Rendererの3 entry）は全てPASS。Main **190.03KB**／Preload **67.06KB**、独立レビュー必須指摘0。

ready callbackへの接続と`projects` API公開が揃い、**domain実装開始のためのentry基盤としてUIR-019R/P/Mと親UIR-019を完了**とする。Rendererはまだ**M1 placeholder**であり、今回UIの業務機能は追加していない。MainテストのElectron境界はmockで、本件の実Electron起動・操作や実パッケージの同梱・インストール検証は未実施。build/testの成功を実アプリ・実配布のPASSへ拡大しない。

SP-08は独立レビューの確定を親担当へ残し、**本節では完了としない**。`verification.md`は親担当の所有で、本追記では編集しない。SP-07の実検証は既存の主記録を参照し、件数を二重記録しない。次は親担当の隔離環境での実Electron smoke／PRE-01〜03の確認、およびSP-09 resolver／通常取込DAT-01bへ引き継ぐ。これらを本節で実施・完了とはしない。

ユーザーの全残作業実行承認は継続しているが、未完タスク・本人確認・モデル承認・実機／配布Gateの免除ではない。製品版は**0.1.0**、モデルは**`ready=false`**を維持し、CHANGELOG/PATCHは引き続き保留、commit/tag/releaseは行っていない。上記のPASSはrelease準備完了を意味しない。

### DAT-01bの完了とサンプル/Core担当の停止（2026-09-12 03:36）

`commands/scan_dataset.py`、`cli.py`、`test_scan_dataset_command.py`を接続した。通常の列挙・decode・分類/COCO取込、相関付きNDJSON、実decode件数、明示cancel、上限付き・非上書きの結果manifest公開を実装。Copy/Referenceの選択は保持するが、本scanだけでは画像copy・DB保存・確認・Workspace・Queueを行わない。

初回はcommand/health/probeの155 cases中154成功・1失敗。複数選択のCopy試験で進捗が1件少なかったため、code/key/countだけの失敗診断を追加した。期待件数3やscannerのctime検査を弱めず、対象Copy/Reference2件、その後の全155件が成功した。初回原因は未確定として保持する。有限の例外捕捉・テスト型・書式を修正し、対象3fileのRuff check/format成功、Pyright0、エディター診断0、独立レビュー必須指摘0を確認した。**DAT-01bと親DAT-01を完了**とするが、通常import全体の完了ではない。

DAT-11の容量preflightは実装候補59 cases中58 passed/1 skipped。型検査・独立レビューが未実施のため未完了。SP-09は最終runでfile snapshot比較の3失敗が残り、修正3回上限で本担当の追加実装を停止した。全体は未完、SP8/44完了、PRE-01の依存審査も途中で導入・lock更新は行っていない。詳細は当時の停止時再開メモ。並行UI担当の作業・完了記録を巻き戻さず、当該担当の停止を意味するものでもない。

### Core／Worker／取込の敵対的監査・修正追補（2026-09-12）

新しい監査・修正指示により04:00に別作業を開始した。監査報告は5軸22件（初回Critical8／Major12／Minor2）。Critical8件を全修正・再検証し、修正後はCritical0／Major4／Minor0、ユーザー指定基準の**PASS**。未修正のreceipt性能・preparedサイズ事前判定・失敗intent終了・他Project旧rootによる復旧停止は、各安全条件を踏まえ個別理由付きで保留した。既知制限の再現test成功を修正完了とはしない。

修正はProject作成への保護root伝播、公開IPCの借用transaction拒否、固定素材ctime確認の有限化、PNG例外／静止画像／IEND検査、列挙→hashの祖先identity保持、通常取込のUNC／remote drive I/O前拒否、CLI finally、固定DTO own-keyの両言語整合、job履歴の時刻順、検証器型と案内に限定した。新依存・汎用framework・設定追加、原本asset変更、モデル承認、並行UIコードの上書きはしていない。

最終runは**TS9file 823 passed／2 skipped（07:31〜07:34）、Python9file 660 passed／4 skipped（07:38〜07:39）、サンプル検証器212 passed／3 skipped（07:26〜07:28）**、すべてexit0。各runのsource前後hash不一致0、skipはnative symlink権限不足。strict Pyright・Ruff・文書22tests・全体TypeScript型検査・3entry buildも成功し、独立再レビューの必須指摘0。実argv・cwd・raw結果hash・初回失敗は監査報告に保持した。全Renderer／aggregate npm testや実機製品受入を再実行した結果ではない。

SP-09は固定resolverとして完了し、[サンプル記録](sample-data/verification.md)の現行進捗は**9/44**。DAT-11も**容量preflight単体として完了**（58 passed／1 skipped、型検査・独立レビュー完了）。後続DAT-08が所有・選択・入力と容量不足時の書込停止を接続する条件は残る。PRE-01、取込永続化／Queue／Workspace、SP-10以降、モデル・本人確認・正式Windows受入は未完で、元の全体完了条件を免除しない。製品版0.1.0とCHANGELOG/PATCH保留を維持する。

## UI/UX v3の実行（2026-09-11）

ユーザーがv3の全デフォルトと全タスク実行を承認した。Q1〜5/Q7〜9=A、Q6=B（正本§15と同じ親配下UUID子root）。承認原本のraw SHA-256は`db639a9e8a3e53c1610e38c9b4ae12569be05b39a3417c7a1c02a75acdd1546c`、81,898 bytes。原本の計画時statusとv2の過去証拠は変更しない。§7.1のv3登録に従い、各leafのtest→別担当レビュー→指摘反映/再test後だけ後続へ進む。

一時作業メモを作成。共有Coreの既存変更とIDE用Pythonプロセスを保持し、モデル承認・M1本人確認・実機Gateを自動承認しない。全対象完了前のCHANGELOG/PATCHは行わず、製品版0.1.0を維持する。

| タスク | 状態 | 検証・レビュー・次の条件 |
|---|---|---|
| UIN-01 | 完了 | 正本§7.1へ差分21定義を参照登録。6つのCore leafは§15を再利用。文書checker exit 0、文書22/22 tests、版0.1.0検査exit 0、diagnostics 0。追加blockを除いたraw bytesは旧正本hash `c1b174d996dff94b904bcda84c61141c01da0ebc97535c97d5f5f010056d93ef`へ復元され、v2/v3/RDの3原本も不変。別担当の敵対的レビューはblocking 0・修正不要でClosed |
| UIN-02 | 完了 | 正本§5.2へ直列/並列経路と編集排他を追記。追加2block以外の旧正本raw hashと承認v3不変、直接依存の静的検査、文書checker、文書22/22 tests、diagnostics 0。独立敵対的レビューはblocking 0・修正不要でClosed |
| REL-01 | 完了 | 入力snapshot→exclusive temp→write/sync/close→checksum→rename。初回26tests/型検査PASS後、敵対的レビューの自己衝突1件をI/O前拒否へ修正。3回帰を加え29/29tests、型検査、diagnostics0、再レビューClosed。txt全経路や電源断耐久性の合格ではない |
| REL-02 | 完了 | native SQLite backup→版/quick_check/hash確認→既存migration。rollback失敗で元例外を失うP2をAggregateError＋回帰2件で解消。backup73/migrate17/database16の106tests、型検査・再レビューClosed。旧アプリ復元・配布受入は別 |
| JOB-01 | 既存担当の完了成果を再利用 | 競合を検出して本セッションの実装を停止し、重複末尾除去後は先行版を保持。上の共有担当記録の82cases・型検査・独立レビュー完了を参照し、二重計上しない |
| CORE-11 | 完了 | Python probe/CLI/testの3file。新48＋既存health4＝52tests、対象strict Pyright0、Ruff check/format成功、Pylance構文エラーなし。現Windowsの読み取り診断exit0。敵対的レビューのディスクI/O失敗分離1件を修正・再test・再レビューClosed |
| CORE-12-C | 完了 | 実probeの固定11キー・7観測＋cameraを検証。40/40契約tests、型検査/diagnostics0、Python実JSONとの無補完・無削除一致。独立敵対的レビューblocking0・修正不要でClosed。対応判定や実配線の完了ではない |
| CORE-12(B) | 完了 | 指定5fileの診断CLI実行/IPC/Preload。82tests後の型2件を修正。敵対的レビューの停止失敗・UTF-8・native timeout検証不足を10casesで補強し、92/92testsと型検査成功。30秒native timeoutはSIGTERM/closeまで実測、再レビューClosed。disposeは停止要求で終了保証ではない。ENTRY登録・対応レベルの未検証判定は別 |
| UIR-066 | 表示部品・fixture実寸検証完了／製品結合は未完 | DiagnosticsPage.tsx/test/CSSと専用probe。40unit tests/型検査、実Electron fixture48cases・全文236pages成功。未知architecture、tab再進入、GPU日本語label、通常長文検査不足、短い空白値の指摘を反映し再レビューClosed。CPU可/推奨の未判定、066Cの実API結合・本人確認・Narratorは未完 |

### UIN-01の実行環境と停止の記録

- PowerShell 7.6.6 Core、Node 24.19.0。旧記録の固定npm一時pathは不在で初回確認がmodule not found。別名の既存環境`%TEMP%/autovision-npm-12.0.0-f055d642-cf48-4915-95bc-2e67c3cab4c7/tool/node_modules/npm/bin/npm-cli.js`で**12.0.0の実行を確認**した。system npm11.17.0は製品検証へ使用しない。新たなdownload/install・package/lock変更なし。
- 最初の文書検査は端末側で30秒timeoutとなり、終了コードを確認できなかった。後続を停止し、出力確認後に当該端末だけを終了した。この試行は未確認のまま保持し、検査そのものの不具合とは断定しない。
- 新しい端末からNode `spawnSync`で検査子プロセスへ20秒上限を設けた1回の切分けは、`Documentation verified (8 required Markdown files, 5 SVG files)`、status 0、signal/errorなし。後続の`node --test --test-reporter=spec scripts/docs/verify-documentation.test.mjs`は22 passed/0 failed/0 skipped、版検査もexit 0だった。これを後続開始の証拠とし、旧試行を成功へ転記しない。

### REL-01 検証と責務境界

Node24.19.0 / Vitest4.1.11 / npm12.0.0 / PowerShell7.6.6。`node node_modules/vitest/vitest.mjs run src/main/storage/atomic-write.test.ts --maxWorkers=1 --reporter=verbose`は29 passed/0 failed/0 skipped、`npm run typecheck`はexit 0。確認後の敵対的再レビューでP2自己衝突をClosedとし、新たなblocking指摘なし。

最終source/testのraw SHA-256は`87e251eafc94bbae9fe2b8ebd433562663eae9372689224458ae6f3936769b2e`／`7f6fe820cf99721d480d1bb5b24e4a4f47e07baec0523c3929f63989514c320a`で検査前後一致。Unicode/空/binary、入力変化、実EEXIST、同サイズ破損、write/sync/read/hash/close/rename/cleanup失敗を隔離一時領域で検証した。close失敗注入は実close後の例外であり、OSが解放できない状態の実測ではない。

Mainの所有path検証、Project排他、上書き同意と再検証はCORE/UIR-073等の担当へ残す。独自lock・backup・retry・watch設定は追加していない。API根拠は[Node.js v24 fs](https://nodejs.org/docs/latest-v24.x/api/fs.html)と[Buffer](https://nodejs.org/docs/latest-v24.x/api/buffer.html#static-method-bufferfrombuffer)の公式本文。資料照会サービスのquotaでは反復せず公式へ切替え、24.20以降の新APIは採用していない。

### CORE-11 検証と次の境界

`ml/.venv/Scripts/python.exe`（Pylance選択も同じ）を使用し、`ml/`から対象pytest、strict Pyright（pyproject＋明示3file）、Ruff check / format --checkを直列実行した。初回50testsはPASS、型検査の当該3件とRuff8件を修正。テスト内の非公開ポインター型参照2件も解消した。別作業の`protocol.py`等の6件を当該変更へ混ぜず、全workspace型検査成功とは表現しない。補助mypy拡張の「stub/py.typedなし」警告はPylanceのエラーではなく、指定のstrict型検査は通過している。診断設定や依存を変更して隠していない。

独立レビューは、正しいlocal pathのアクセス拒否を入力不正として全観測中止する点を指摘した。字句・非local・再解析点・不存在の拒否を保持し、PermissionError/OSErrorはdiskだけ失敗、他6観測を継続するよう修正。CLIのpartial/exit1・未検証pathの容量照会なし・生例外非出力の2回帰を追加し、**52/52 PASS、strict0、Ruff check/format成功**。再レビューでClosed。エディターのfixture未使用ヒントはpytest注入のためである。

修正後の実readonly CLI `python -m autovision_ml.cli probe-hardware --disk-path C:/GitHub/AutoVision-Studio`は1行JSON/exit0/stderrなし。Windows build29661/AMD64/productType1、論理CPU20、OS認識物理RAM68,535,443,456 bytes、表示adapter4、ORT1.24.4のDml/CPU一覧、Torch2.11.0+cpuのCUDA unavailableを観測。cameraはdeferred/streamOpened=false、モデル実行はnot_checked。容量/空きRAMは瞬間値であり、推奨構成・モデル性能・カメラ権限・実配布の合格ではない。実stdoutのraw hashは`08d75ef576ce02838c27ee8e1955613c1e807db46b0c83c39cb4d1d1fd25d613`。

検証時の3source raw SHA-256（検査前後一致）：probe `eb9319a4179b33fac04cbd79d13269ddf47de74b0ab3f73bb1b85d44787ac0c5`、CLI `1fb7fd567f8e4a342cc6116183bb2b163b1874c701460c4724ef0413600b4e8a`、test `0a00c8f813803a2c8138c0956d6a2fc1f6bd443674c691930cb135094c76afff`。検査wrapperの引数/演算子変換失敗は製品失敗や成功件数へ転用せず、修正した単発実行だけを証拠とする。

根拠：[MEMORYSTATUSEX](https://learn.microsoft.com/windows/win32/api/sysinfoapi/ns-sysinfoapi-memorystatusex)、[GlobalMemoryStatusEx](https://learn.microsoft.com/windows/win32/api/sysinfoapi/nf-sysinfoapi-globalmemorystatusex)、[EnumDisplayDevicesW](https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-enumdisplaydevicesw)、[DISPLAY_DEVICEW](https://learn.microsoft.com/windows/win32/api/wingdi/ns-wingdi-display_devicew)、[GetDriveTypeW](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-getdrivetypew)の2026-09-11公式確認。外部pwsh/wmic/COM依存・モデル取得・カメラ起動なし。対応レベル、実workerの起動/同梱、Main/Preload登録、UIは後続CORE-12/W08/PKGへ残す。

CORE-12-Cの検査対象raw hash：`diagnostics.ts`は`091fd62f850d9ff8dc603a96463e192d91ce885ce061ff7e31d7b5b73389d78a`、testは`35516f2b4cf14615b445648fb1e53bef02b88a47cfc2be68069dea8b5d425411`。正常/部分/早期失敗、error時CPU部分data、未知key、数値・状態矛盾、camera偽装を検証。観測成功をCPU動作可・推奨構成へ変換しない。

CORE-12(B)は`diagnostics-service.ts`が信頼済みMain設定をsnapshotし、30秒/256KiB上限のexecFile、同時取得の集約、JSON/runtime契約とexit0/1/2一致、エラー秘匿を担当。handlerは同じWebContents/main frame/固定local URL・引数なしを処理前後に検証し、Preloadはcollectだけ公開する。初期82casesに停止false/throw/既停止/遅延callback、UTF-8と256KiB境界、実Nodeのexit0/1・30秒timeoutを追加し**92cases全成功・型検査成功**。real childはclose後だけ一時領域を回収した。IPCレビュー必須修正0、processレビュー2項目は補強後Closed。文書世代や実Electron配線・Python同梱workerの終了確認まで証明したものではない。

### 17:46以降のUI側再開

UIR-066の初回端末timeoutは該当端末を停止し、保存された最終出力で同runの22tests/型検査exit0と3sourceの前後hash一致を確認した。環境初期化50.38秒・test2.55秒を含む65.79秒の有限runで、検査停止を製品不具合と断定していない。独立レビュー3件を反映後、28tests成功・再レビューClosed。通常viewportの実寸やNarratorをJSDOM成功で代替しない。

Python選択先がroot `.venv`だったため規約の`ml/.venv`へ復帰し、protocol/probe/sampleの対象5fileでdiagnostics0を確認。Worker TS54/Python53、対象strict型/Ruffを再検証して独立レビューClosed。共有側のJOB-03D完了を再利用し、環境変更やコード修正の帰属を混同しない。

JOB-04の新規作成では、別担当の先行`startWorkerJob`と今回の`superviseWorker`が連結する競合を検出した。後続を停止し、今回の後半だけを除去して先行実装を保持。二重宣言による型検査失敗は除去後のexact npm12による型検査で解消した。以後、Core/JOBへの重複編集を停止し、こちらはUIとREL-02を担当する。作業メモを保存。全対象が未完のため製品版0.1.0、CHANGELOG/PATCH保留を維持する。

### 診断の全文表示とREL-02の完了証拠（2026-09-12追記）

UIR-066の通常値は最大51pxの縦overflowを測定し、状態・対応レベルの同行化と余白調整で解消した。長文の100%検査不足をレビューで指摘され、44casesへ拡張した実runは34PASS/10FAIL。80書記素超、または改行/タブ/保持が必要な空白を含む値をnative dialogへ分離し、最大120書記素/6改行のページで全文を保持した。短い空白値のP2も反映。改行の幅0矩形は原文字のRangeと座標・高さが一致する場合だけ正しく扱い、位置/clip/hit/全文一致の検査は維持した。

最終fixture runは`test-results/ui-diagnostics-c38467ac-c081-4579-b53c-b229a8e57c6d/result.json`、raw SHA-256 `f9773bd25c6e4daa9f6548bf8e7cd1583a617d32de8f6850d7093c2b9f7356b1`。**48/48 cases、72全文参照（48実訪問＋24明示再利用）、236実測ページ、47.419秒**。build/Electronともexit0、timeoutなし、renderer error/blocked request/permission request0、source前後hash一致。1280×640・100%の長文/空白一覧・全文全ページも縦横scrollなし。200%/小画面のreflow、native Tab/Escape/閉じる/元trigger復帰を確認した。実端末の観測値・実AppShell結合・Narrator・本人確認・モデル性能の証拠ではない。

単体検証はthreadsのworker起動60秒timeout・0testを履歴として保持し、今回の実行だけforksへ切り替えた。最終40tests成功、exact npm12型検査成功、独立再レビューClosed。globalのpoolや診断severityを変更して通していない。最終source hashはDiagnosticsPage `4576db95e4d5eb47c2b995e5c3c1f8a9d4680b8dda8915301f80dcaf31c50ba1`、CSS `3b91a2df37dcae78cdb15a83e03eb506c2c7e9aa3bdf33518c0d373fd5814747`、test `c8d3c1285e9b6fd0b0cc27eff76e5818e552b7c4afd097fbbb1179f1b83d9283`、probe `14ed7f8dd5e3f7e860851ee26f02ac58078b073b6f1c1029e3f3a2570d108797`。

REL-02は`backup.ts`/test、Main内DatabaseConnectionのbackup型面、`migrate.ts`/testの計production3＋test2。Mainの保守中・全writer停止を前提とし、検証済みコピーの完成前にSQLを進めない。WALの確定データ・暗黙rowid・Unicode、既存file保護、native失敗、source変更、途中SQL失敗、rollback二重失敗とbackup保持を106testsで確認。二重失敗のP2は再レビューClosed。最後のDB106＋UI28の134tests/型検査も成功した。backupのraw SHA-256は `84e711d68751155af0bdc2798b4e9dc0d8f8e523d1cf25bf8b43c40ea170a75e`、testは `09dc516071a7dcc11614f97fb66276254e37d9f9eb118a38250e01d3ab518923`。live DB/WALの逆置換・未知fileの削除や、電源断/旧アプリ復元/servicing成功は主張しない。

今回の再開でUIR-019完了を確認したため、UIR-020の2fileとUIR-W08のENTRY5fileを別担当で進める。共有Core/JOB/サンプルは既存担当を維持。作業メモを保存。次の依存は各test・独立レビュー・再検証完了後のみ開始する。

### UIR-W08：診断API登録の完了（2026-09-12）

UIR-019の実起動基盤へ既存diagnostics service/handler/factoryを登録した。公開面はversion1の`diagnostics.collect()`だけで、Project7操作を維持。Mainが開発ml/.venvのPythonまたは同梱worker/autovision-worker.exe、引数/cwd/userDataの容量対象を固定し、Rendererから受け取らない。登録だけではprobe・カメラを起動せず、実呼出しは066Cへ残す。

既存factory testのAppApi全体固定assertionをProject部分の互換検査へ変更し、全公開キーは入口testが検査する。test数上限を維持するためW08M（Main index/test）とW08P（Preload index/test、AppApi、Project factory test）へ分割した。Main40/index24/factory86の**150tests成功、型検査成功**。独立敵対的レビューはM/Pそれぞれ必須指摘0。aggregate buildも3entry成功（Main198.08KB、Preload75.91KB）。両leafと親W08を完了とする。

window閉鎖/破棄/部分登録失敗で所有channelと診断serviceを一度だけdisposeし、Project IPCのdrain→DB closeを維持。missing workerや取得失敗後もProject作成が可能な境界testを含む。service.disposeは停止要求であってchild終了確認ではなく、実Electron・packaged probe-hardware同梱・初回UI診断の合格ではない。版0.1.0とCHANGELOG/PATCH保留を維持する。

### UIR-020：Project単位の閲覧状態の完了

`ProjectWorkspace.tsx`/testの2fileで、実Project IDに対応した作業tabと設定往復のfocusを保持する。metadataはpropsを正とし、一覧/設定中はsmall stateだけ残して作業DOMを外す。未接続の業務画面は未実装と表示し、API・camera・job開始や将来draft storeを追加しない。

初回のWorkspace16＋既存tabs18＝34tests成功後、未成立の設定遷移が後続の非表示/再表示へ残るP2を修正。callbackが明示trueの時だけ復帰権を保持し、同期再入で受付前にhide/showした場合も復帰せず失効させる。最終Workspace28＋tabs18の**46tests、型検査、文書checker/22tests成功**。独立再レビューで指摘Closed。親UIR-025は同componentを1つだけ維持し、実際に設定遷移を受理した場合だけtrueを返す。実AppShell結合、画像draftのflush/保存、再起動後のtab保持は本leafの完了に含めない。

### UIR-021/022/023と設定接続口の部品検証

- **UIR-021:** 実ProjectSnapshotの取得・失敗・古い応答・検索・可変件数ページ・全文名を実装。45tests成功、Renderer型検査成功。「最後」へ移動後の行計測で末尾から外れるP2を、最終Project IDの固定と未訪問23行の回帰で修正し、再レビューClosed。Run/model/容量はまだ未取得でFR-PRJ-004全体の完了にはしない。
- **UIR-022:** 作成だけのフォーム、任意説明draft、native選択tokenの一度限り利用、結果不明時の再送禁止・一覧確認を実装。初回combined runは一覧44tests成功後にForm worker起動が失敗し、Form0件を成功としなかった。単独実行で56tests成功。無効なByRole exactオプションを除去し、修正後も56testsとRenderer型検査成功。独立レビュー必須0。
- **UIR-023:** metadata保存・Project別draft・実task lock・明示move/recover・不確定結果のget確認を実装。source-retainedを移動済みと断定するP2を中立文言へ修正し、旧rootの復旧結果2ケースを追加。52testsとRenderer型検査成功、独立再レビューClosed。実DB保存先は応答から表示し、Schema/Profileの未実装保存やjob停止を追加しない。
- **UIR-025A-S:** 設定外枠へ固定Project slot、選択有無・可視性のoptional propsを追加。27tests/Renderer型検査/文書checker成功、独立レビュー必須0。テスト用slotの戻るcallbackにEventが入る1件だけを修正し、期待値を維持した。既存カテゴリと通知全文、単一panelのstateを保持し、非表示入力DOMはpanel自身が外す。

上記は部品と境界の検証であり、native picker・実AppShellでの操作・通常viewport・Narrator・再起動の合格ではない。UIR-025A-Wで実APIへの通常導線を接続し、UIR-025Bの削除preview、CORE-13Aの元の受入とPRE-03、正式製品Gateは別に残す。型検査のsystem npm11誤実行は環境不一致の失敗として保持し、指定npm12または既存Renderer strict configの実検証と区別した。並行sample sourceの型エラーは担当外を上書きせず、本部品の検証へ混載していない。

### UIR-025A：通常Project接続と実起動の完了

実Project APIをAppShellへ接続し、一覧から最新ID照合、作成、metadata保存、移動・復旧、設定往復を実装した。独立レビューの検索/page位置消失と、設定中の作成完了による編集対象切替の2P2を修正。安定した一覧とProject別下書きを保持し、作成結果の選択は設定から戻るまで保留する。修正後の一覧/AppShell合計100tests、Renderer型検査、3entry build成功、独立再レビューで両指摘Closed。

単発技術検証`tests/manual/ui-projects-probe.mjs`は既存distの実UI→Preload→Main→SQLiteを起動した。フォルダーピッカーの返却先だけを専用一時親へ固定し、実token・UUID/marker・DBの生成と移動は製品コードを使用。最終run `test-results/ui-projects-9beb8cd0-933d-4e83-a785-700339e1854e/result.json` は**TECHNICAL_SMOKE_PASS、10.640秒、全3child exit0**。preflight1/操作5/再起動2ケースを確認し、両終了後のreadonly/immutable DBでschema2・2件の保存値とbytes不変を照合した。5PNGの保存hashとsource/bundle/nativeの前後hashも一致。raw結果SHA-256は `b007144e4592c04030b06ccdd8c25faf5f0c716d4d4bc7d5b5a18fc380dafbd6`、独立レビュー必須指摘0。

初回の移動待機timeoutと、次の拒否済み権限照会をrequestと同一視したguard失敗は保持する。照会の意味を公式仕様と独立監査で確認し、全checkの拒否を維持してrequestと分離した。最終各UI phaseはcheck4件で、permission request/media playback/外向きrequest/想定外file/renderer errorは0。これはカメラ取得ゼロ・通信キャプチャ・製品権限評価の包括的証明ではない。

**025A-S/Wと追加技術検証を完了**とする。スクロールを許した技術smokeであり、通常密度、Narrator、OS picker実操作、本人確認、削除previewを含むCORE-13A/PRE-03、署名・clean install・正式製品Gateは未完。**親UIR-025はB待ちのまま**で、CHANGELOG/PATCHは引き続き保留する。

### UIR-066C：初回診断・設定詳細の実接続完了（2026-09-12）

起動時の実`diagnostics.collect`をProject一覧と独立して一度だけ開始し、一覧要約/明示再取得/設定詳細/footerへ接続した。進行中Promiseだけを共有し、完了キャッシュを新しい取得結果にしない。partialの欠損は未取得、失敗後の旧値は前回と明記。OSの明確な非対応だけ既存判定を共有し、CPU可/推奨を捏造しない。容量対象はMainのuserDataボリュームでありProject使用量ではない。Project別下書き・検索/page・設定往復のfocusを維持する。

初回の実寸検査では設定外枠と共通CSSの競合でdocument高742/822pxとなった。診断表示中だけ設定外枠と診断header/toolbar/tabsを配置し直し、限定selectorで余白を保持した。共通global.css、固定高、文字切捨て、全体縮小は使わない。066C本体と別登録の実寸修正/test補修/smokeの出力・失敗履歴は担当記録に分離した。

- 修正後の個別単体試験：**Settings30＋AppShell70＋Diagnostics46＝146件成功**。Renderer strict型検査・エディター診断0、固定npm12の3entry build成功、製品版0.1.0とpackage/lock不変。worker起動60秒/0testsの失敗は履歴保持し、jsdom単独import58.8秒を確認後に再検証した。timeoutや診断設定は緩和していない。
- 実アプリの限定技術検証：`test-results/ui-diagnostics-integration-8cbac475-e595-4e4d-b40c-81d18eff0949/result.json`、**5step/10画面成功、14.228秒**。実Main/Preload/PythonへUI入力で到達し、3workerとElectronのclose/exit0、正常quitを確認。raw SHA-256 `5e1d38dbc51e3bb408baca9ce93626b9777b423e436e358c14baec5733cc0c63`。通常1280×640 light/darkの縦横overflowなし、200%/小画面のreflow到達。権限照会4件は拒否、要求/外向きrequest guard/renderer error/media playback/dialog0。全process通信/カメラ監査ではない。
- CSS変更後の部品実表示：`test-results/ui-diagnostics-699771ba-aabf-43f9-bf17-f70f3c69ec3b/result.json`、**48cases/236全文ページ成功、54.510秒**、build/Electron exit0。raw SHA-256 `8e45332c429623bac384ce0aa14afa967d6cd9ec7c4a16d26717602840b41849`。画像・列挙source/distのhash前後一致を再照合。fixtureを実端末観測に読み替えない。

独立再レビューは必須指摘0。直接参照したhiddenラベルの名前計算と独立nested Gridの2候補は公式仕様・実測で誤検出と裁定し、別担当も確認した。**UIR-066Cを実API接続の範囲で完了**とする。本人確認・Narrator・CPU可/推奨の性能判定、UIN-04全体、PRE-03/CORE-13A、削除preview、正式Windows出荷Gateは完了させない。全残対象の完了ではなく、CHANGELOG/PATCH・commit/tag/releaseは引き続き行わない。

### SEC-07：診断要約の明示保存・限定接続（2026-09-12）

ログ文字列の限定マスクA、固定項目の診断要約exporter B、取消信号・結果契約・Main IPC・Preload・起動登録・診断画面・AppShell・実接続試験C0〜C7を小leafとして実装した。各対象test・型検査・独立レビューを完了し、NT pathマスク漏れと同一document query変更時の保存失効漏れの2指摘は負例で再現して修正・再レビューClosed。詳細・出力割当・不成功runは担当記録へ保持する。

公開操作はversion1の追加能力`diagnostics.exportSummary()`だけで、0引数。Main自身が取得した診断の数値・固定状態/code・既知provider有無から短い要約を作り、所有windowの確認ダイアログへ本文・保存先を提示する。取消を既定とし、承認後だけ既存`userData/logs`へ排他作成・内容照合・非上書き公開する。画像・機器名・自由な版文字列・Project情報・生ログ・絶対パスは要約本文に含めない。Rendererへ任意のファイルアクセス・本文入力・同意フラグのAPIは追加していない。

- **限定回帰509件成功（2run、skip0）**：14:21:13のAppShell81件/29.75秒、14:21:44のMain/Preload/契約/診断画面等8file428件/58.00秒。両exit0、25対象のsource/test/lock hash不変。全`npm test`または単一runの成功ではない。途中のMain7FAILと別runのworker起動失敗は成功へ読み替えない。
- **最新型/build成功**：Node24.19.0／npm12.0.0／PowerShell7.6.6 Core。Main220.59KB／Preload77.11KB／Renderer344.02KB／CSS19.74KB、製品版0.1.0。対象エディター診断0。
- **実distの限定技術試験成功**：`test-results/ui-diagnostics-integration-2a57a44d-7bfd-4139-b3c8-b7575e29f0cf/result.json`。9step/21画面/全文2ページ、27.642秒、実Python5子とElectronのclose/exit0・正常quit。raw SHA-256 `39ef0c04b94de82a08899bf1765ceae0241b30774b67e74cc98e61a2ea1490a9`。取消時0file、保存時916 bytesの要約1fileと事前表示一致。21画像・保存内容・39対象source/lock/distのhashを再計算して照合した。
- **失敗の引継ぎ**：共有Coreの移動再検証で1回観測したfile snapshot不一致は原因未確定。観測コードは除去して元test hashへ復元し、その後Main47件と最終分割回帰は成功した。根治済みとはせず、再現結果・Core hash・次に取得する属性を上記担当記録の「Core担当への引継ぎ」に記載した。共有Coreの安全検査を緩めていない。

**A/BとC0〜C7はそれぞれの部品・限定技術接続の範囲で完了。親SEC-07は未完**。自動smokeのOS確認ダイアログ応答はtest doubleであり、実描画・本人による承認・Narratorは未検証。SPA内の詳細離脱は古い応答表示を抑制するだけで、送信済みの保存を取り消したとは扱わない。全loggerのマスク接続、正式Windows受入、全process通信/カメラ監査、本人確認、モデル性能、ほかの未完タスクを免除せず、CHANGELOG/PATCH・commit/tag/releaseも保留する。

## 7. Wave 1「本人確認の解消」の実行記録（2026-09-21）

対象はタスク実行プラン `work/20260921-1330-TaskExecutionPlan.md` のWave 1（W1-01〜W1-03）。本節は**状態の確定だけ**を行い、source・test・依存・lock・証跡JSONを変更していない。未実施を実施済みへ読み替えず、leafの完了を親の完了へ昇格させない。既存の§3表・承認履歴・過去の件数記録も書き換えていない。

### W1-01：UIR-017本人確認 — NOT_RUN保持（UIR-017はBLOCKEDのまま）

実施可否を利用者へ照会したが応答が得られず（利用者不在）、実操作・理解についての回答は取得できなかった。今回はプレビューを起動しておらず、2026-09-07の起動記録を今回の実施として再利用しない。代行・推測で埋めない既存規約に従い、[確認項目](../tests/manual/ui-shell-review.md#本人確認)へ照会日と未取得の事実だけを追記した。§3表のUIR-017行は`BLOCKED（本人確認）`のまま変更していない。照会したこと自体を実施・合格として扱わず、Wave 1の他タスクの完了をもってUIR-017・M1を完了扱いにしない。**W1-01はBLOCKEDを保持する。**

### W1-02：UIR-041Q／UIR-084の現況確定 — 両者とも「未実施」

| ID | 位置づけ | 判定 | 根拠 |
|---|---|---|---|
| UIR-041Q | v2 §7.4「手動編集・確定」の確認task（関連実装計画§7.1「参照登録する全タスク」）。FR-UI-001/004/008の受入参照（同§9.1）。実行順は同§5.2のM2行`…→041→ANN-27/28→041Q` | **未実施** | ①本記録§3以降にUIR-041Qの実施記録が無い ②前提のUIR-041が未着手で、`src/renderer/features/annotations/`は`LabelSchemaPage`の3fileだけ。確定経路の`src/main/annotations/confirm-and-queue.ts`も不在 ③UIR-041Qを対象とする結果fileが0件 |
| UIR-084 | v2 §7.11「回帰・判定」のtask（同§7.1）。FR-UI-001/002の受入参照（同§9.1）。実行順は同§5.2「v3承認後の実行順」の`082→083/084/085→086` | **未実施** | ①本記録に実施記録が無い ②前提のUIR-082が対象とする設定書出し・削除・運用のdomainが未実装で、`tests/e2e/`ディレクトリ自体が不在のため回帰判定の実行基盤が無い ③UIR-084を対象とする結果fileが0件 |

証拠の取得方法：`UIR-041` / `041Q` / `084` をrepository全体（`docs/`・`src/`・`tests/`・`test-results/`・`spikes/`・`build/`）へ検索し、一致したのは関連実装計画・要求定義の参照表とタスク実行プランだけだった。実施記録・結果fileの一致は0件である。判定は「記録が無い」と「前提が存在しない」の両方に基づくため`未確認`ではなく`未実施`とする。**どちらも`完了`にしない。**

関連実装計画§7.1「停止条件と重要な依存」は「UIR-041Q/084も同様」として、UIR-017と同じく担当者の技術測定と**利用者本人の確認**を分けることを求めている。したがって両IDは前提実装が揃った後も、自己点検・DU承認・JSDOM結果を本人の実回答へ代用できない。今回の「未実施」確定は、将来の本人確認を免除するものではない。

### W1-03：親UIR-025を閉じるための残条件と担当Wave

親UIR-025は`UIR-025A`と`UIR-025B`の双方が完了して初めて完了する（関連実装計画§7.1「2026-09-11 UI/UX v3の差分登録」）。`UIR-025A-S`／`UIR-025A-W`と追加技術検証は本記録「UI/UX v3の実行（2026-09-11）」内の[UIR-025A：通常Project接続と実起動の完了](#uir-025a通常project接続と実起動の完了)で完了済みだが、これはleafの完了であり、以下が閉じるまで**親UIR-025は未完**とする。

| # | 残条件 | 内容と出典 | 担当Wave（実行プラン） | 現状 |
|---|---|---|---|---|
| 1 | 削除previewのMain実装 | 所有データとReference参照データを区別した件数・容量の取得。CORE-10／UIN-05→06（関連実装計画§7.1） | Wave 2G の `delete-preview.ts` task | 未着手。`src/main/projects/delete-preview.ts`は不在 |
| 2 | UIR-025B 削除preview接続 | 実previewの全対象件数・容量・所有/Reference境界をUIへ接続。失敗・Project切替後の古いpreviewを使用しない（同上） | Wave 2G の削除確認ダイアログtask | 未着手。**出力file割当が未統一**：UIR-025BはA と同じ既定5file（`AppShell.tsx`／`ProjectWorkspace.tsx`／`SettingsPage.tsx`と2 test）、実行プランのWave 2Gは`DeleteProjectDialog.tsx`を割当てている。着手前に割当を1つへ確定する必要がある |
| 3 | PRE-03 E2E harness | 実在・build可能なappだけを起動し、一時profile/Projectと確実な終了を検証（関連実装計画§14.3）。CORE-13が消費する | Wave 3 のE2E依存採用・harness task | 未着手。`tests/e2e/`が不在。Playwright採用可否はプランQ-03の承認待ち |
| 4 | CORE-13A Project E2E受入 | 親UIR-025とPRE-03の後に、previewを含む受入を実施（同§7.1、§7 Phase D） | Wave 3 のProject CRUD E2E task | 未着手。#1〜#3が前提 |
| 5 | 実削除の接続 | REL-04・UIR-079後のUIN-07→08→09で実削除を接続しCORE-13Dへ合流。ただしCORE-13DはGate 3の新前提にしない（同§7.1） | Wave 2G の削除実行task ＋ Wave 5以降 | 未着手。`src/main/projects/delete-project.ts`は不在 |
| 6 | 本人確認（通常密度・Narrator・OS picker実操作） | 上記「UIR-025A：通常Project接続と実起動の完了」節が明示的に未完として残した項目 | Wave 1（W1-01と同じ利用者操作lane）／実機到達後に再実施 | **未実施**。W1-01と同じく利用者不在で取得できていない |
| 7 | 正式製品Gate（Gate 3） | 縦スライス成立を実E2Eから判定（関連実装計画§6） | Wave 3 のGate 3判定 | 未判定。#3・#4が前提 |
| 8 | 署名（Windowsコード署名証明書 D-16） | 利用者からの証明書提示が必要 | Wave 5以降（Phase M） | 未提示 |
| 9 | clean install | SPI-03のclean Windows実測。`SKIPPED_BY_USER`を保持し、別名で開発前提へ戻さない | Wave 5以降（Phase M） | 未取得。現hostや別processをclean Windowsの代替としない。SPI-05は上記「Gate 1入力と判定の完了」節のとおり**開発host上のunsigned NSIS PoCとして合格済み**であり、この#9を満たす証拠ではない（同節が production config・正式署名・SBOM・clean host・servicingを対象外と明記） |

#1・#2・#5はWave 2Gで着手できる。#3・#4・#7はWave 3、#8・#9はWave 5以降であり、いずれも本Wave 1では解消しない。#6は利用者操作に依存し、実装では解消できない。

**判定：親UIR-025は`未完（B待ち＋本人確認・出荷Gate未完）`を保持する。** UIR-025A系leafの完了・技術smokeの成功・W1-02の現況確定のいずれも、親UIR-025やM1・Gate 3の完了へ昇格させない。CHANGELOG／PATCH・commit/tag/releaseは引き続き行わない。

### Wave 1の検証記録

| 検証 | 実コマンド | 結果 |
|---|---|---|
| 文書整合（変更前baseline） | `node scripts/docs/verify-documentation.mjs` | exit 0（必須Markdown 8件、SVG 5件） |
| 文書整合（変更後） | `node scripts/docs/verify-documentation.mjs` | exit 0（必須Markdown 8件、SVG 5件） |
| 文書checker自己test | `node --test scripts/docs/verify-documentation.test.mjs` | exit 0、22/22 PASS |
| 製品版整合 | `node scripts/release/verify-product-version.mjs` | exit 0（`0.1.0`） |
| 空白・改行 | `git diff --check` | exit 0 |

本節はMarkdownだけを変更したため、TypeScriptの型検査・Vitest・buildは実行していない。過去runのPASS件数を今回の合格として読み替えない。W1-01が未達のため、Wave 1全体は**未完**として保持する。

## 8. 本人確認の回答の記録（2026-09-24）

本節は、利用者の作業として示したUIR-017とUIR-041Qの本人確認への回答を記録する。source・test・§3表・§7の過去の記録は変更していない。

| ID | 回答（原文のまま） | 状態 | 理由 |
|---|---|---|---|
| UIR-017 | 「B-3: 確認済み」 | `BLOCKED（本人確認）`のまま | 回答に操作ごとの現在対象・表示状態・次の結果・戻り先がなく、[確認項目](../tests/manual/ui-shell-review.md#本人確認)の1〜4と対応付けられない。回答は確認項目の節に記録した |
| UIR-041Q | 「B-6: 確認済み。」 | `未実施`のまま | UIR-017と同じ形式の操作ごとの回答がない。自己点検・JSDOM結果・承認済みDUを本人の回答へ代用しない（§7 W1-02） |
| UIR-084 | なし | `未実施`のまま | 前提の実装が揃っていないため、本人確認を依頼していない（`work/20260924-0300-UirStatusRedetermination.md` 54 行） |

操作ごとの回答が得られた時点で、確認項目と本節へ追記する。今回の回答をもってUIR-017・UIR-041Q・M1を終えたものとして扱わない。
