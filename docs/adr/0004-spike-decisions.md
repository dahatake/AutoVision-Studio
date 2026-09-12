# ADR-0004: Windows リスクスパイクと Gate 判定

| 項目 | 内容 |
|---|---|
| ADR ID | 0004 |
| タイトル | Windows リスクスパイクと Gate 判定 |
| 作成日 | 2026-09-07 |
| 最終更新日 | 2026-09-07 |
| 対応タスク | SPI-18（二部判定） |
| 依存 ADR | ADR-0001、ADR-0002、ADR-0003 |
| 要求基準 | `docs/requirement-definition.md` v0.5 Draft（2026-09-07 UI改善追補、245要求） |
| Gate 1部 | **CONDITIONAL_GO** |
| Gate 2部 | **BLOCKED / NOT_COMPLETE** |
| SPI-18全体 | **IN_PROGRESS**（Gate 2部未完了） |

---

## 1. 決定

**現行SPI-05追補:** run `d3e23532-dbfe-4341-bbd1-94667ec47fdd`で再検証した。41 tests、UUID固有exe/GUID、PowerShell 7専用検査、uninstaller本体終了、Registry64双キー/専用cache回収、7入力hash前後一致、全2,500 file同梱とhealth/CPU/DirectMLがPASSし、独立レビュー指摘なし。raw結果SHA-256は`1dda848218bdc853f7c568ac3bb629cdcfd945c9a8b09490b5a272c386e6dcd7`。以下のb6cba50c runと24 testsは従前判定時の履歴として保持する。Gate境界・モデル未承認は変更しない。

AutoVision Studio Version 1のWindows 11 24H2以降x64を対象に、A-07およびSPI-01、SPI-02、SPI-05、SPI-07、SPI-08、SPI-10のWindows証拠を合格と判定する。SPI-03、SPI-09、SPI-19は2026-09-07のユーザー指示どおり`SKIPPED_BY_USER`として保持し、PASSへ変更しない。

したがってGate 1部は**CONDITIONAL_GO**とする。これは実装計画でGate 1に依存するcore、Project、data import、manual annotationの開発を、個別DAG・対象test・独立レビューに従って開始できるという限定判断である。全PoC成立、製品機能完成、正式出荷可、Gate 2〜5合格を意味しない。

Gate 2部は、承認済み分類・検出のCurated Base WeightとAnnotation Assist Model、train/export parity、assist品質、有限AutoML budgetが未確定であるため**BLOCKED / NOT_COMPLETE**とする。`resources/models/manifest.json`は`releaseStatus.ready=false`、`models=[]`のまま変更しない。Gate 1部だけでSPI-18全体を完了扱いにしない。

---

## 2. Gate 1入力の判定

| 入力 | Windows証拠 | 判定 | この判定に含めないもの |
|---|---|---|---|
| A-07 | release model schemaをWindows x64のCPU/DirectML各1件へ再基準化。`ready=true`時のC6/C7×分類/検出4役、承認、許諾、由来、hash、安全形式、path、C7設定のfail-closed条件を維持。schema回帰35件PASS、独立レビューblocking 0 | **PASS** | model実体、model承認、Gate 2、release readiness |
| SPI-01 | `better-sqlite3@13.0.3`をhost Node、Electron同梱Node、Windows unpacked packageで実行。CRUD、transaction rollback、close、native addonのsource/package hash一致、対象process 0。独立レビューCLOSED | **PASS** | production DB/schema、installer、最終payload最適化、署名 |
| SPI-02 | Electron Mainからlocked Python workerをjob単位spawn。versioned JSON、NDJSON progress、分離stderr、協調cancel、正常/不正入力、exitをWindowsで実行。独立レビューblocking 0 | **PASS** | production supervisor、DB commit、強制終了policy、job state |
| SPI-05 | 開発用NSIS EXEへPyInstaller `onedir` 2,500 file / 529,582,875 bytesを同梱。source、staging、unpacked、installedの全path/size/SHA-256一致。install後のhealth、Torch CPU、Optuna、ONNX、ORT CPU、profiling済みDirectML実行とuninstall後残留0を確認。対象24 testsと二段階独立レビューCLOSED | **PASS** | clean host、production config、正式署名、SBOM/license、servicing、offline build |
| SPI-07 | 320×320と640×640 RGBを各100 frame、合計200 frame送受信。4-byte length付きbinary protocolを10 Hz目標で実行し、3 malformed probeをfail-closed、child回収を確認。独立レビュー反映後PASS | **PASS** | camera、実model、queue depth 1、warm-up、30分受入、FR-INF-010 |
| SPI-08 | Windows 11 build 29648でFP32 Add modelをCPUExecutionProviderとDmlExecutionProviderへ実行。exact outputとprofile kernel provider attributionを確認し、保存self-test 16件、Ruff、Pyright、lock不変を確認 | **PASS** | 採用modelのoperator coverage、parity、性能、複数node fallback、macOS CoreML |
| SPI-10 | Electron/Konva上で4K bitmapと100 rectangleを描画し、create/select/move/resize/zoom/panを各100回実入力から画面captureまで測定。判定対象capture p95は全6操作100 ms以下。raw evidence、process終了、source/bundle hashを独立再計算しレビューCLOSED | **PASS** | production annotation editor、永続化、keyboard/Narrator、macOS性能 |

### 2.1 A-07のWindows範囲

各承認済みmodel entryの`support`は次の2件だけを許可する。

- `windows-x64` / `cpu` / `verified:true`
- `windows-x64` / `directml` / `verified:true`

配列は`minItems:2`、`maxItems:2`、`uniqueItems:true`であり、OSは`windows-x64`固定、providerは`cpu`または`directml`、verifiedはtrue固定である。この組合せによりCPUとDirectMLを1件ずつ要求し、順序は要求しない。legacyのWindows/macOS 4件、CoreML、CUDA、未知OS/provider、重複、falseを回帰testで拒否した。

空の非release manifestは引き続き有効である。これは未承認modelを許す意味ではなく、承認済みentryを一件も持たない現在状態をfail-closedで表現するためである。`ready=true`では数値3要素の`productVersion`と、C6/C7×分類/検出の4役すべてを要求する。

### 2.2 実測値

#### SPI-05 package

| 項目 | 値 |
|---|---:|
| worker file count | 2,500 |
| worker total bytes | 529,582,875 |
| worker manifest SHA-256 | `793670322f7f8f9c13e119297e686771b5d7bb59f8c443ba5ab47b55c6f9d3ce` |
| installer bytes | 237,047,204 |
| installer SHA-256 | `1dbf8480fc5ed57e4f519319418a700a7c889b6933f0e20e97e544ae74620b91` |
| accepted run ID | `b6cba50c-92fa-4da9-af08-5815a585c4b3` |
| signature | `NotSigned`（PoC境界。正式出荷不可） |

初回NSIS toolset展開のrenameは`EPERM`で失敗した。isolated cache内の固定releaseだけを対象にarchive SHA-256と展開済み343 fileのmanifestを照合し、同じ展開物をbuild後に再照合した場合だけ1回再実行した。初回失敗を成功へ置換せず、両attemptをraw receiptへ保持した。

#### SPI-07 transport

| shape | interval p95 (ms) | send-to-ack p95 (ms) | Python service p95 (ms) |
|---|---:|---:|---:|
| 320×320 | 113.7468 | 3.1494 | 0.6878 |
| 640×640 | 110.4901 | 7.3513 | 3.5262 |

これは短時間のtransport測定である。interval p95が100 msを超える事実を隠さず、camera込み10 Hz受入または30分性能とは扱わない。

#### SPI-08 provider

- model: memory生成のFP32 Add、shape `[1, 4]`、opset 17
- expected / CPU / DirectML output: `[4.0, 3.0, 2.0, -4.0]`
- CPU profile provider: `CPUExecutionProvider`
- DirectML profile provider: `DmlExecutionProvider`

provider一覧への存在だけを実行証拠にせず、唯一のkernel eventのprovider attributionを要求した。

#### SPI-10 canvas

| 操作 | input-to-captured-presentation p95 (ms) |
|---|---:|
| create | 38.509 |
| select | 39.092 |
| move | 45.802 |
| resize | 43.050 |
| zoom | 58.412 |
| pan | 56.893 |

panの2回目同一captureまでを含む補助的stable-confirm p95は105.534 msであり、100 msを超えた事実も保持する。Gate 1判定値は実装計画で固定した最初のchanged screen capture完了までである。

---

## 3. `SKIPPED_BY_USER`と残存リスク

| task | 保存する状態 | 未検証リスク | 後続の正規受入 |
|---|---|---|---|
| SPI-03 | `SKIPPED_BY_USER`。既存current-host bundleは`PARTIAL`、clean Windowsは`NOT_RUN / BLOCKED` | Python未導入clean hostでのonedir単体成立。license payloadも未完 | PKG-02でproduction workerを全file検証し、PKG-11で署名済み製品のclean offline installを検証。SPI-05の現host結果をSPI-03 PASSへ転用しない |
| SPI-09 | `SKIPPED_BY_USER`。`camera.tsx`と`camera-result.md`は未作成 | camera→capture→pipe→result、permission、disconnect、30分性能 | INF-13、INF-14、INF-15。SPI-07/08をcamera実測へ読み替えない |
| SPI-19 | `SKIPPED_BY_USER`。process再起動/read-only/relinkの既存部分結果とOS reboot `NOT_RUN`を保持 | Windows OS再起動後のReference継続アクセス | DAT-12でprocess再起動、hash、変更/消失、安全停止、relink、参照元非破壊を実装検証し、DAT-15でOS再起動を正式受入。PoC PASSへ戻さない |

スキップは成功でも免責でもない。ユーザーが同じPoCを開発開始条件から外した決定を尊重しつつ、対応する製品要求と後続受入を削除しない。

---

## 4. 採用する技術判断

| 決定 | Gate 1後の扱い | 再評価条件 |
|---|---|---|
| D-03 `better-sqlite3` | Windows Electron Mainの単一DB writer候補としてCORE-02以降へ進める | production package/native payloadまたはtransaction要件を満たさない場合 |
| D-04 React-Konva限定editor | axis-aligned rectangle editorをANN-11以降でtask-specificに実装する | production E2E / accessibility / PERF-01不合格時。CVAT/Label Studio全体は先行導入しない |
| D-05 electron-builder NSIS | Windows package方式としてPKG-04/05まで維持する | production signing、preflight、servicing、clean install不合格時 |
| D-06 PyInstaller onedir | worker directory全体を`extraResources`へ同梱する方式を維持する | PKG-02/11でproduction bundleまたはclean hostが不成立の場合 |
| D-07 binary pipe + ORT | HTTP listenerを作らず、INF-05以降で固定shape binary framing、DirectML→CPU fallbackを実装する | production model互換性、queue、camera、30分性能不合格時 |

PoC codeをそのままproductionへ移植する決定ではない。各production taskでruntime schema、sender/path validation、failure classification、test、独立レビューを新たに要求する。

---

## 5. Gate 2部とSPI-18全体

Gate 2部は次が未充足である。

- SPI-11〜14の法務・checkpoint・training-data・再配布・intended-use承認が、分類/検出のC6/C7全4役で完了していない。
- SPI-15/16の権利確認済みfixtureによるtrain→ONNX parityが完了していない。
- SPI-17のgold setによるassist品質・manual-only比較が完了していない。
- D-15のWindows実機に基づく有限AutoML trial / 時間budgetが決定していない。
- `resources/models/manifest.json`に承認済みentryがない。

したがってAST-01以降の承認model loader、model固有assist、training、model version、report、camera inferenceをGate 1だけで開始しない。manual annotation/core laneとmodel laneを分離する。

SPI-18全体のstatusはGate 2部が完了するまで**IN_PROGRESS**である。本ADRへGate 1部を記録したことや、空manifestがschemaに適合することをSPI-18全体の完了、Gate 2合格、model同梱許可へ転用しない。

---

## 6. 横断回帰

2026-09-07、Windows x64、PowerShell 7.6.5 Coreで次を実行した。

| 検証 | 結果 |
|---|---|
| A-07 schema test | Node test 35件PASS、skip 0、exit 0 |
| SPI-05 test | Node test 24件PASS、skip 0、exit 0。対象4 `.mjs` の構文、diagnostics、packaging差分検査もPASS |
| aggregate Node test | exact npm 12.0.0。product version 25件、documentation 22件、Vitest 12 files / 156件が全PASS |
| TypeScript | `npm run typecheck` exit 0 |
| build | Main、Preload、Rendererすべてexit 0 |
| Python | uv 0.12.9。lock check/sync、pytest 4件、Ruff check/format、Pyright 0 errorsがPASS |
| lock不変性 | `package-lock.json` working-tree bytes SHA-256 `7f1bd82efe1e4919dce6ddffdb763ceff4404d29b60e8e946a150345a8dfe1a5`、`ml/uv.lock` working-tree bytes SHA-256 `94e3f36d8d5dc47beecdb5d86ffeb628d1fd11d6c52214c79c2e7889e7950d7f` |

最初のPython横断検査はuvの版だけでなくbuild commit hashまで誤って固定した検査側の条件により、実test開始前に停止した。要求はexact版0.12.9でありcommit hash固定ではないため、条件を`uv 0.12.9`へ修正して全検証を実行した。失敗をworker合格または製品不合格へ読み替えない。

---

## 7. 独立敵対的レビュー

A-07とSPI-05はそれぞれ対象test後に別担当レビューを実施し、blocking finding 0でCLOSEDとした。さらにGate 1の全入力、skip境界、ADR整合、raw evidence、lock、model manifestを別担当が横断レビューした。

横断レビューの次の古い要約値は採用しなかった。

- Vitestを155件、Node合計を202件とした値: 今回の実出力はVitest 156件、内訳25 + 22 + 156である。
- SPI-05の修正後NSISを未再実行とした記述: accepted run `b6cba50c-92fa-4da9-af08-5815a585c4b3`で修正後の開発用NSIS install→worker→uninstallを完走済みである。ただしproduction NSISは未作成である。

これらを補正した上で、必須入力の欠落、skipのPASS化、modelの先行承認、clean-host / camera / Reference / release条件の代用は確認されなかった。横断blocking findingは0件で、Gate 1の**CONDITIONAL_GO**を支持する。

---

## 8. この判定で開始できること・できないこと

### 開始できること

- Gate 1に直接依存するCORE-01等を、実装計画の個別依存順に開始する。
- core、Project、data import、manual classification / rectangle annotationを、各taskのtest・独立レビュー後に順次進める。
- SPI-01/02/05/07/08/10の採用境界をproduction taskの入力に使う。

### 開始・完了扱いにできないこと

- 承認modelを必要とするannotation assist、training、project-model assist、report、camera model inference。
- Gate 3/4/5、正式release、製品受入。
- Windows正式署名、SBOM/THIRD_PARTY_NOTICES、脆弱性、offline clean install、repair/upgrade/rollback、artifact checksum。
- DAT-12/15のReference、INF-13〜15のcamera、PKG-02/11のproduction worker / clean host。
- macOSのいずれの機能・package・provider合格。
- UIR-017の利用者本人確認。これはGate 1とは別の未完条件として保持する。

---

## 9. 参照証拠

- A-07: `resources/models/manifest.schema.json`、`resources/models/manifest.json`、`scripts/models/manifest-schema.test.mjs`
- SPI-01: `spikes/sqlite/README.md`
- SPI-02: `spikes/worker/README.md`
- SPI-03履歴: `spikes/packaging/windows-result.md`
- SPI-05: `spikes/packaging/windows-installer-result.md`
- SPI-07: `spikes/inference/pipe-result.md`
- SPI-08: `spikes/inference/provider-result.md`
- SPI-10: `spikes/annotation/result.md`、`build/spi10/benchmark-result.json`
- SPI-19履歴: `spikes/reference/windows-result.md`、`spikes/reference/macos-result.md`
- 判定規則: `docs/implementation-plan.md` §6、Phase C、SPI-18二部判定
