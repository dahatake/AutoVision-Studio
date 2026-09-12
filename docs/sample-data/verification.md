# 固定サンプル追加 — 実行・レビュー記録

基準: 2026-09-06、変更開始HEAD `6523995637fb3085f2ef4642abe424652ab59cac`。要求v0.5、実行正本は `docs/implementation-plan.md` §14。これはREVIEW-01の途中記録であり、全タスク完了・アプリ試用可能・配布可能を意味しない。

## 実行環境

- PowerShell 7.6.5 Core、Node.js 24.19.0、uv 0.12.9。
- system npm 11.17.0は製品検証に使わない。既存の一時cacheのnpm 12.0.0をversion照合し、`node_modules/.bin` shimを子processのPATH先頭に設定する。最初の`npm/bin`指定はprefix解決エラーとなり、正しいshimで解消した。repository dependency/lockは変更していない。
- Python runtimeは `ml/.venv/Scripts/python.exe`（3.14.7）。Pylanceの選択変更は成功応答だったが、snippetの出力はsystem interpreterを示したため、標準ライブラリ検査以外の環境証拠に転用しない。後続のPython試験はvenv実体を明示する。

## 文書・許諾タスク

| Task | 検証・独立敵対的レビュー・反映 | 状態 |
|---|---|---|
| PLAN-01a | scopeに固定2サンプルを1行追加。差分1追加/0削除、diagnostics 0、`git diff --check`、文書unit19件PASS。別担当レビュー必須修正0 | 完了 |
| PLAN-01b | §3.3限定の公開サンプル取得・配布例外。既存229要求保持の静的検査、diagnostics/diff検査。別担当レビュー必須修正0 | 完了 |
| PLAN-01c | FR-SMP-001〜005追加。旧229要求行不変、234 ID一意、正しい節への配置を実行検査。別担当レビュー必須修正0 | 完了 |
| PLAN-01d | v0.5、日付、受入点21、trace追加。旧要求不変と受入1〜21を実行検査。別担当レビュー必須修正0 | 完了 |
| PLAN-02 | 既存260 IDを保持し追加59 leafを登録。静的検査、文書check、diagnostics。レビューのEND-02製品版同期不足を、既存`productVersion`がある場合だけ同期する条件で修正・再レビューCLOSED。親の照合でBeans画像パスとGWHD個別URL取得に限定。DATA-01の原bytes保持を追加 | 完了（後続の進捗追記は継続） |
| PLAN-03a | C9に同梱画像/annotationを追加しC8/C6/C7から分離。静的検査・diagnostics後、別担当レビュー必須修正0 | 完了 |
| PLAN-03b | 固定2datasetに限ったowner条件付き判断。未取得実体/出荷/モデル承認とは分離。別担当レビュー必須修正0 | 完了 |
| PLAN-03c | 明示dev取得、通常build/testへ非接続、合算容量停止、ユーザー編集・生成物非送信。文書check・diagnostics後、別担当レビュー必須修正0 | 完了 |
| PLAN-04 | 回帰3件でRED: 2 fail/1 passを確認。履歴hashと現行READMEの検査を分離し全22件PASS。別担当レビュー必須修正0。片方だけのhash負例は任意補強と裁定し、両hash検査・宣言欠落検出を維持 | 完了 |
| SYNC-01a | READMEの現行要求版/raw/LF hashを同期。再計算一致、別担当レビュー必須修正0 | 完了 |
| SYNC-01b1 | developer-guideの要求基準1行のみ同期。文書checkと別担当レビュー必須修正0 | 完了 |
| SYNC-01b2 | architectureの現行要求参照2か所だけ同期。文書checkと別担当レビュー必須修正0 | 完了 |
| SYNC-01b3 | users-guideのheader1行のみ同期。文書check・diagnostics・別担当レビュー必須修正0 | 完了 |
| SYNC-01b4 | CONTRIBUTINGのheader1行のみ同期。文書check・diagnostics・別担当レビュー必須修正0 | 完了 |
| LIC-S01 | Beans原典/LICENSE原bytes保存、4原典hash合算検査・文書リンク検査。別担当が画像/ラベルMIT適用とhashを照合し必須修正0。ZIP/60枚実体は別タスク | 完了（データ実体未検証） |
| LIC-S02 | GWHD原record/CC BY 4.0本文保存、版・ライセンス・raw hashを検証。参照リンク2か所を修正し文書check PASS。別担当レビュー必須修正0。PNG/CSV/20枚は別タスク | 完了（データ実体未検証） |
| CONTRACT-01 | 固定2IDのasset manifest契約。Vitest31件PASS、typecheck PASS、diagnostics 0。実CSVのUnicode domain名を原文保持する修正も31件/型検査/別担当再レビューPASS。96 MiBは単一manifestのinventory検査であり、合算と実体は後続検査 | 完了 |
| DATA-01 | cache除外・原bytes保持。`git check-attr`で2対象がtext unset、READMEは未指定。cacheのみignored、最終LICENSEは追跡可能。別担当レビュー必須修正0 | 完了 |
| DATA-00 | 具体的な両prepare script向け3関数を採用。初回テスト68 PASS/3 FAIL/2 ERRORから、巨大bytesのpytest IDとmock reset順を修正し72 PASS。独立レビューの不正Location例外漏れを5 FAILで再現し、30x解析前制御へ修正、77 PASS・再レビューCLOSED。PNGのHEADがサイズを返さない実測に基づき、公式一覧1URLだけ上限付きサイズ不明取得を追加。80 PASS、lint/format PASS、追加独立レビューPASS | 完了 |
| DATA-02 | Beans準備56ケースを定義。WindowsでZipInfoがbackslashを正規化するfixtureをraw ZIP書換で修正し、拒否理由も検査。取得3ファイル群全303ケースPASS、6ファイル明示lint/format PASS、別担当レビュー必須修正0 | 完了 |
| DATA-03a | angular_leaf_spot20枚、2800645 bytes。配置後の別担当がZIP原本とのbytes/hash完全一致を確認 | 完了 |
| DATA-03b | bean_rust20枚、2587196 bytes。配置後の別担当がZIP原本・選定との一致と先行クラス非変更を確認 | 完了 |
| DATA-03c | healthy20枚、2872342 bytes。別担当が全60枚の原bytes/選定/hash一致を確認 | 完了 |
| DATA-03d | 60枚/3class/8260183画像bytesと通知をmanifest化。別担当が29項目を独立検査し必須修正0。通常decoder/importは未実施 | 完了 |
| DATA-04 | 最初の167ケース後、独立レビューで同時改変時の取得台帳照合不足を検出。修正後179件PASS・再レビューCLOSED。実CSVの拡張子付きimage_name対応186件PASS・再レビューCLOSED。Unicode domain原文保持へ修正し243件PASS、lint/format/再レビューCLOSED。2026-09-07に選定20件へ限定した検証を承認し、固定CSV hash、全行妥当性、選定内一意性、既知2組の選定外ID・行番号だけを警告化。full PNG chunk/CRC/zlib/scanline decodeを追加。初回251件PASS後、独立レビュー6件を修正し266件PASS、lint/format、再レビューCLOSED。上流`.png`名でJPEG実体が返る事実に対応して原bytes・由来名・検出形式・配布拡張子を分離し、JPEG寸法負例を含む269件、manifest契約32件、型検査、独立レビューを合格 | スクリプトと実データ選定を完了。画像取得と配布はDATA-05/06で完了 |
| DATA-04選定 | 実`select`が成功。3657行／3655一意ID、固定20件、選定外警告2件、宣言画像合計36419586 bytes。`selection.json`は90498 bytes、SHA-256 `f8f0be3a286451a47bf8899a265b72f22f3ecc9b63ac2ad8a0038501c7a3c13e`。別担当がraw CSV/indexからcanonical bytesを再生成し、台帳を含め一致を確認 | 完了。PNG取得0件を維持 |
| DATA-05 | 固定先頭1件だけを取得。上流`.png`名を由来として保持し、実体JPEGをPillow 12.3.0でverify・再open・全画素loadして1024×1024・単一フレームを確認。原bytes 453251、SHA-256 `f5bc6c56843bd2b10f08f60d7926bd647964d9d8a6e31cada62d9ccf9349fd92`、47 box、CSV/index/selection/台帳との対応を独立再計算 | 完了。`pilot.json` 942 bytes、SHA-256 `43a5c1c998514cfd1088ed31b4fec833a0356a5907e7659d3027b42ab08b3189`。配布画像・COCO・manifestは未生成 |
| DATA-06 | pilotレビュー後に残り19件を固定URLから取得し、20件の原bytes計36419586 bytes（JPEG 2、PNG 18）と全1079 boxを配布。`manifest.json` 10156 bytes／SHA-256 `b4e5ba7653a4ca8b23e913e0864e39d422b0e9470bf7cc6ef527560f1a91a94b`、COCO 207425 bytes／SHA-256 `04b9b815695559e9198464d200056fb387e21e1d34d8169e192e8511c99feffb`。別担当が全cache／配布bytes、形式、hash、COCO逆変換、通知、台帳を独立再計算 | 完了。blocking finding 0。通常decoder/importer・アプリ試用は別タスク |

レビューは別の読み取り専用担当へタスクごとに依頼し、実在する差分・原典・検証結果の範囲で裁定した。素案に混在していた未検証の進捗率・架空のサンプル内容・画像の自動確認案は採用していない。過去の作業記録を上書きしていない。

## 最終回帰（実施済み範囲のみ）

- `npm test`: **98 PASS**（version 25、documentation 22、Vitest 51）。npm 12.0.0を使用。
- `npm run typecheck`、`npm run build`: **PASS**（Main/Preload/Renderer）。アプリのProject機能やinstallerの合格ではない。
- DATA-06後、`ml/`からvenv Pythonで既存testsと`../scripts/samples/test_{sample_io,prepare_beans,prepare_gwhd}.py`を明示実行し**409 PASS**（既存4、取得80、Beans56、GWHD269）。Ruff check／format、manifest契約32件、型検査もPASS。ネットワークはfake応答へ置換したオフラインテスト。
- Ruffはディレクトリ指定だと既存include設定外で0件となるため、その結果を合格証拠にせず、準備コード/テスト6ファイルを明示して再検査。check/formatとも**PASS**。
- diagnostics: 0件。文書リンク・要求hash検査と`git diff --check`: PASS。
- DATA-06完了時の取得台帳は**183559223 bytes**で256 MiB上限内。全配布サンプルは**44942112 bytes**で96 MiB上限内（GWHD **36660961 bytes**）。GWHDは固定20件だけを個別取得し、上流名`.png`に対する実体JPEG 2件を含む原bytesを再エンコードしていない。全体GWHD ZIPは取得していない。
- 取得時刻（UTC）: Beans ZIP `2026-09-06T16:26:18Z`、GWHD CSV `2026-09-06T16:33:45Z`。閲覧日・公開日・取得日を混同しない。

## 未完了の依存・終了処理

- Gate 1: A-07、SPI-01/02/05/07/08/10を実測・レビューし、2026-09-07に[ADR-0004](../adr/0004-spike-decisions.md)でcore / Project / data import / manual annotation向け`CONDITIONAL_GO`と判定した。SPI-03、SPI-09、SPI-19は`SKIPPED_BY_USER`のままPASSへ変更せず、正式製品のclean install、camera、Reference、署名等の受入条件も別に残す。
- Gate 2: `resources/models/manifest.json`の`ready=false`・`models=[]`を保持。サンプルの許諾はモデル承認ではない。
- DATA-06までの固定素材準備は完了。Gate 1の限定判定だけでアプリ基盤が完成したとは扱わず、サンプルUI・製品E2E・通常decoder/importer・学習/推論・Windows配布は各CORE / JOB / DAT / ANN、Gate 2以降、製品受入の個別依存が未充足のため未完了。
- `CHANGELOG.md`のUnreleasedと製品PATCH更新は、ユーザー指定どおり全タスク完了後だけ実施する。現時点で作成/更新しておらず、製品版は0.1.0のまま。commit/tag/releaseは行わない。

## 2026-09-11 再開：SP-01 baseline

ユーザーは再開プランのQ1〜Q8をすべてデフォルトAで承認し、全44 SPタスクと必要な既存依存の実行を指示した。各leafは対象検証→別担当の敵対的レビュー→指摘反映・再検証後に依存先へ進む。出力が重ならない実装だけを並列化し、端末・共有記録の更新は親が直列所有する。全体完了までCHANGELOG/PATCHを保留し、既存のモデル・本人確認・正式配布Gateを免除しない。作成時点を固定した計画本文は書き換えない。

### 再開時の読取り確認

2026-09-11 13:42（端末ローカル時刻）、PowerShell 7.6.6 Core、Node 24.19.0、Python `ml/.venv/Scripts/python.exe` 3.14.7。HEADは`6523995637fb3085f2ef4642abe424652ab59cac`、既存変更・未追跡は67行。`GIT_OPTIONAL_LOCKS=0`でGit状態を確認し、Node標準APIでmanifestに列挙された全画像・通知のsize/raw SHA-256、配下file数、cache台帳を読み取った。終了code 0、`BASELINE_READ=PASS`。画像decode、通常import、アプリ起動、学習は実施していない。

| 対象 | 実測結果 |
|---|---|
| Beans | 60画像、各class20件、通知/manifestを含む63 files、8,281,151 bytes。列挙size/hash不一致0 |
| GWHD | 20画像、通知/COCO/manifestを含む24 files、36,660,961 bytes。列挙size/hash不一致0。COCO20画像・1,079 annotation |
| 同梱資産合計 | 44,942,112 bytes、96 MiB以内 |
| 取得cache台帳 | completed23件の実体size/hash一致、183,527,479 bytes。原典予約31,744 bytesを含むreservedBytes183,559,223で256 MiB以内。今回の画像/ZIP取得0 |
| 承認済み計画のraw SHA-256 | `b6cec9a9ff141e3d4a36d37340996e69218cfa819b01776ce94a83b9400e1eb1` |
| Beans manifest raw SHA-256 | `29f0c7225ed4bcb7e79cfcb135088fd65662ac244654caec78dd2a4a5024c47d` |
| GWHD manifest raw SHA-256 | `b4e5ba7653a4ca8b23e913e0864e39d422b0e9470bf7cc6ef527560f1a91a94b` |
| package.json / package-lock.json raw SHA-256 | `03513434b927e7ea6756ad7aedc5cf21437c86fdc6b6ddd9018af9c772c5d431` / `7f1bd82efe1e4919dce6ddffdb763ceff4404d29b60e8e946a150345a8dfe1a5` |
| Gate/model | 現行記録のGate 1はCONDITIONAL_GO、model manifestのready=falseを保持。CORE-06は所有root/移動未完の部分実装であり、通常import/UIは未接続 |

SP-01は**完了**。`node scripts/docs/verify-documentation.mjs`、`node --test scripts/docs/verify-documentation.test.mjs`（22 passed / 0 failed）、対象diff checkはexit 0、diagnostics 0。別担当の読取り専用敵対的レビューで必須修正0件、提示した実測範囲と未実施範囲の分離を確認した。正常な資産を再利用し、既存の変更をstash・削除・巻戻ししない。

### SP-02 / SP-03 許諾差分確認

Beans採用記録§5とGWHD採用記録§7を別担当が並列で追記した。固定一次本文を確認し、対象版・画像/annotation許諾・必要通知について変更を要する差分は見つからなかった。元asset、原典copy、LICENSE/ATTRIBUTION、manifestは更新していない。親が両全文を読み戻し、文書checkerと対象diff checkを実行してexit 0、diagnostics 0を確認した。その後、作成者と別の2担当へ各leafの敵対的レビューを並列依頼し、どちらも必須修正0件だった。SP-02/03は**完了**。各採用記録の「親担当待ち」は追記時点の引継ぎであり、現行の完了判定は本項とする。通常import・UI・モデル/出荷Gateの完了には転用しない。

### SP-04 再開割当・敵対的レビュー

2026-09-11、再開後に実装計画§15を再確認した。独立レビューは、旧metadataのpathを所有証明と誤認しない条件と、copy後に元fileが変更された場合の回収前再照合の2件を必須修正とした。CORE-06A〜Fの受入へ、排他作成したUUID rootの最小Project marker、旧行の所有未確認時拒否、DB切替・回収・中断復旧時の実体/inventory/receipt照合、変更時の非削除停止を反映した。既存repository再利用と必要時の出力事前登録も明記し、新DB列や汎用journalは追加しない。

修正後に`node scripts/docs/verify-documentation.mjs`、`node --test scripts/docs/verify-documentation.test.mjs`（22 passed / 0 failed）、`git diff --check -- docs/implementation-plan.md`が成功し、diagnostics 0。別担当の再レビューは2件ともCLOSED、新規blockerなし。SP-04は**完了**。承認済み44行の計画snapshotと製品版0.1.0は変更していない。

再開時の環境確認は不要なdependency再帰走査で30秒timeoutとなったため、その確認terminalを終了し、既知pathだけの確認へ分割した。製品test/buildのハングではなく、同じ全体走査は再投入していない。現在はPowerShell 7.6.6 Core・Node 24.19.0。外部ライブラリ文書サービスはquota制限だったため再試行せず、必要なfilesystem APIは公式Node.js v24文書を参照した。これらの確認を製品機能の動作証拠にしない。

### SP-05 / SP-06：現状説明と固定inventory

SP-05はREADMEの「現在の利用可否」内のサンプル説明1段落だけを補正した。GWHD20枚・全1079 boxのCOCOと通知等の準備済み、通常import/アプリ作成・編集・学習・一般向け導入の未完を区別した。文書22 tests・checker・diagnostics、別担当の敵対的レビュー（必須指摘0）を確認し**完了**。旧DOCS-09全体は未完のままである。

SP-06は` scripts/samples/verify_samples.py `と` test_verify_samples.py `を追加した。固定2manifestの承認済みraw hashを既定の信頼根拠とし、CLIにはoverrideを提供しない。全87file・80画像・通知/COCO/manifest・余剰/欠損・不正JSON・path/reparse/hardlink・容量を読取り専用で検査する。画像decodeや通常importは実行しない。

最初の実行委譲の成功要約は、親が取得した原出力と一致しなかったため採用しなかった。親の実runは18 failed / 116 passed / 3 skippedで、正常ファイルのlstat/fstat間ctimeの差が共通失敗原因だった。同一実ファイルのdev/ino/nlink/size/mtime/birthtimeが一致し、ctimeだけがAPI間で異なることをPython3.14.7で観測した。API間の識別/size/mtimeと、同じAPIの前後ctimeを分離して修正し、失敗を成功へ書換えず保持した。lint3件と書式も修正した。

修正後、`ml/`から`.venv/Scripts/python.exe -B -m pytest -p no:cacheprovider ../scripts/samples/test_verify_samples.py -q --tb=short --maxfail=2 -rs`を実行して**146 passed / 3 skipped**、exit0。skipは権限不足でnative symlink作成不可の3件で、native junction・模擬reparse試験は成功した。Ruff checkは明示2fileで成功、format checkは`2 files already formatted`。独立敵対的レビューは必須修正0、diagnostics0。続いて固定CLIを単独実行し、`inventory=PASS`、`fileCount=87`、`totalBytes=44942112`、`manifestTrust=reviewed-pins`、`normalDecodeImport=NOT_RUN`を確認した。SP-06は**完了**、SP-07/08とDATA-07全体は通常DAT-03/04/05待ちのままである。原本asset・通知・取得台帳・モデル・製品版は変更していない。

### 2026-09-11開始の継続実行：SP-07 / SP-08・DATA-07完了

本項は親担当から引き継いだ確定結果に基づく文書のみの追記であり、この追記のために試験を再実行していない。ユーザーは残作業の実行をすべて承認済み。セッションの日付文脈は2026-09-12であり、見出しの日付は開始日を表す。個々の試験・レビューの日時は推定して補わない。上記のSP-06時点を含む未完了記録は履歴として保持し、SP-07/08・DATA-07の現行判定は本項とする。

- **SP-07（Beans）**: `verify_classification`を明示的に呼び出して通常pipelineを実測し、**60 enumerated / 60 decoded / 60 annotations、3 class・各20件**を確認した。この段階の独立敵対的レビューは指摘0件。
- **SP-08（GWHD）**: Beansの必須60件の通常pipeline検証を先行して満たした上で、`verify_detection`を明示的に呼び出した。実GWHDの**20画像（JPEG 2 / PNG 18、全画像1024×1024）、1079 boxes、1 class `wheat_head`**を確認し、全画像ごとのID・category・bboxについて値・数値型・順序まで照合して一致した。

SP-08の独立レビューでは、metadataの`int → 同値のfloat`およびorientationの`1 → True`が値だけの比較をすり抜けると判明した。`_same_metadata`による再帰的な厳密型比較と`deepcopy`による比較用snapshotでSP-07/08の両方を修正し、2件の改変負例を追加した。証拠は修正前の全体試験と修正後の対象限定試験を分けて扱う。

| 段階 | 実行結果・範囲 |
|---|---|
| SP-07・型比較修正前の全体試験 | **186件中183 passed / 3 skipped**。skipはnative file symlink作成不可の3件 |
| SP-08・初回、型比較修正前の全体試験 | **213件中210 passed / 3 skipped**。その後、書式1件を修正 |
| 共通の型比較修正後・最終対象限定試験 | **215件中30件を実行し、30 passed / 185 deselected**。型修正後に全215件を実行した証拠ではない |

最終のlint／format検査はともにexit 0。独立再レビューは**CLOSED、新規指摘なし**。親担当は修正後の対象限定検証を完了判定の証拠として採用し、**SP-07、SP-08および親タスクDATA-07を通常helperの検証範囲で完了**とする。現行進捗は**SP 8/44完了**、次は**SP-09（固定resolver）**。

検証前後に全同梱資産を読み取り、hash・size・typeを照合した。両サンプル合計は**87 files / 44,942,112 bytes**で、承認済みmanifest pinsも不変。改変負例はテスト専用fixture／wrapperだけに適用し、原本assetは変更していない。

通常CLIの既定動作は引き続き**inventory-only**で、`normalDecodeImport`は`NOT_RUN`のまま。上記は`verify_classification`／`verify_detection`の明示呼出しによる検証であり、CLIのdefaultを変更したものではない。アプリのProject作成・UI接続・学習／推論・packaged配布物・E2Eの合格を意味しない。製品版**0.1.0**とモデルの**`ready=false`**を維持し、モデル承認・本人確認・署名／正式配布Gateは免除しない。本追記ではsource・cache・通知・assetを変更せず、追加downloadも行っていない。

### 2026-09-12 03:36：SP-09の未解消失敗で停止

SP-09の`sample-assets.ts`/testを実装したが、**未完了**。毎回両sampleの87 fileを読取り検証する固定resolverで、初回のReadStream/close由来の未処理例外を64KiBの直接readへ変更した。hash前のctime単独変化は実測後に初期比較を限定調整し、directoryの証拠はidentityと全children照合へ統一した。固定pinによる全bytes検査、読取り開始後と最終file snapshotは保持したが、3回目の修正後も失敗が残った。

03:35:37開始の最終runは、SP-09＋DAT-11の162 cases中**157 passed / 3 failed / 2 skipped**。SP-09は103 cases中**99 passed / 3 failed / 1 skipped**で、packaged読取り、mixed path、設定snapshotの3正例が`finalSnapshot`のfile比較で`SAMPLE_ASSET_CHANGED`になった。最終比較の差分fieldは未採取で、先行のctime観測だけを最終3件の原因確定へ拡張しない。後続の型検査はこの失敗で未実行、独立レビューも未完。診断0件をテスト成功へ転用しない。

修正3回の上限に従い、本担当の追加修正・後続実装を停止した。**SPは8/44完了のまま**で、SP-09〜44の完了や全作業終了は宣言しない。原本asset、モデル、package/lock、CHANGELOG/PATCHを変更せず、残る実アプリ・学習・配布Gateを保持する。再開条件・失敗3件・停止時raw hash・並行担当は当時の再開メモを参照する。

### 2026-09-12 04:00監査後：SP-09修正と最終回帰

新しい敵対的レビュー・Critical修正指示により、03:36停止後の別作業単位として再開した。過去の失敗を成功へ書き換えず、22件の監査報告に修正・検証・保留を集約した。

SP-09は、最終snapshotでctimeだけが変わったfileを元の独立pinとidentity／size／mtime等へ照合し直す**1回限り**の確認へ修正した。全87fileのpin検査と96MiB予算を保持し、2回目のctime変化、byte改変、identity変更は拒否する。無制限retryや改変後のpin採用、原本の書換えではない。不要なresolver別名を除き、公開関数は`getSampleAssets`へ統一した。

- **07:26:09〜07:28:01:** サンプル検証器全215 cases、**212 passed / 3 skipped、exit0**。型比較修正後の全件回帰を取得し、元の30件限定試験の不足を解消した。関連9fileの検証前後raw hashは不変。skipはnative symlink権限不足3件。
- **07:31:27〜07:34:23:** 明示したCore／Worker／取込／サンプル9file、**823 passed / 2 skipped、exit0**。うちSP-09は**106 passed / 1 skipped**。関連49fileのraw hash不変、SP-09の独立再レビューは必須指摘0。
- **07:43:35〜07:44:08:** 標準Ruff、strict Pyright、文書22tests、全体TypeScript型検査、Main／Preload／Renderer buildが成功。検証器の明示Ruff2fileと対象エディター診断も成功。mlのPyright成功を外部script全体のstrict検査へ拡張しない。

最終XML/JSONの実testcase／assertion件数を親が照合した。raw SHA-256は検証器XML `ec51a8da7065e0bf1c083f59a54109e64ba7d420235fa9655bb854ea208a0a8f`、TS結果JSON `c9d934e8e4aac2f789943a65b14a306628c5f8e943668bae02c6dd7d55553503`。実argv／cwd／exit、source hash、残るMajor4件の理由は監査報告を参照。

**SP-09を固定resolverの範囲で完了、現行SP進捗は9/44**とする。素材の通常helper検証は完了しているが、SP-10以降のProject作成・永続取込・Workspace・人手確認・学習／推論・正式配布は未完。監査のPASSは残存Critical0という基準で、receipt関連Major4件は未修正である。モデル`ready=false`、製品版0.1.0、CHANGELOG/PATCH保留を維持し、版変更・commit/tag/releaseはしていない。