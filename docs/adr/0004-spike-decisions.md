# ADR-0004: Windows リスクスパイクと Gate 判定

| 項目 | 内容 |
|---|---|
| ADR ID | 0004 |
| タイトル | Windows リスクスパイクと Gate 判定 |
| 作成日 | 2026-09-07 |
| 最終更新日 | 2026-09-23 |
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

Gate 2部は、承認済み分類・検出のCurated Base WeightとAnnotation Assist Model、train/export parity、assist品質、有限AutoML budgetが未確定であるため**BLOCKED / NOT_COMPLETE**とする。`resources/models/manifest.json`は`releaseStatus.ready=false`を維持する（承認済みentryは、2026-09-23のD1裁定前はC6分類1件、D1裁定後はC6分類・C6検出の2件。§5.1.12・§5.1.13）。Gate 1部だけでSPI-18全体を完了扱いにしない。

**Gate 2 lane追補（2026-09-22）:** SPI-11〜17とD-15を2回実行し、各入力の現在状態を確定した（§5.1）。SPI-11〜14は既存監査の充足確認と、利用者指示による**候補の再調査および controlled retrieval**を行った。分類のtrain/export parityは**PASS**、検出は**PASS**（既定60 epoch。6/20 epochでは**FAIL**であり、その実測も保持する）、assist品質は段階3が`SKIPPED_BY_USER`かつ承認済みC7が0件のため**NOT_RUN（実測0件）**、D-15は分類のCPU / CUDAと検出のCPUについて有限budgetを確定した。同日夜、利用者dahatakeの提示（license識別子・NOTICE・承認者氏名）によりC6検出1役を承認しmanifestへ登録したが（§5.1.10）、翌日の推論性能実測が採用基準に不適合であったため**保留へ差し戻し登録を取り消した**（§5.1.11）。**承認済みmodelは0件**であり、Gate 2部の**BLOCKED / NOT_COMPLETE**と`releaseStatus.ready=false`・`models: []`は変更しない。

**Gate 2残タスク追補（2026-09-23）:** FR-LIC-016の新設を受け、C6分類（MobileNetV3 Large V2）を**承認**しmanifestへ登録した。C6検出（SSDLite）は、いったん保留とした後、同日のowner裁定D1（C6にPOC-03の実時間推論基準を適用しない）により**承認**・登録した（§5.1.13）。C7分類（SigLIP、CPU性能不適合）、C7検出（Grounding DINO tiny、parity FAIL）は**保留**、SPI-17は**NOT_RUN**である（§5.1.12）。同日のC7残タスクでは、TinyCLIPを**除外 / HOLD維持**、SigLIPのCPU改善（量子化）を**parity・性能とも不適合で保留維持**、C7検出の新候補OWL-ViT B/32を**保留**（生出力parity PASS、CPU性能不適合）とした（§5.1.14）。Gate 2部は**BLOCKED / NOT_COMPLETE**、`releaseStatus.ready=false`を維持する。

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

空の非release manifestは引き続き有効である。これは未承認modelを許す意味ではなく、承認済みentryを一件も持たない状態（2026-09-23 のC6分類登録前）をfail-closedで表現するためである。2026-09-23 以降は承認済みC6（分類・検出）の2件だけを持つ非release manifestである（§5.1.12、§5.1.13）。`ready=true`では数値3要素の`productVersion`と、C6/C7×分類/検出の4役すべてを要求する。

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
| SPI-17 段階3（2026-09-22追加） | `SKIPPED_BY_USER`。gold setに対する補助あり／手作業のみの**実作業sessionの記録**を実施しない。harnessと入力形式は保持 | assistedとmanual-onlyのcoverage / accept / edit / reject / 所要時間。**NFR-ANN-006の出荷条件が未充足のまま残る** | AST-22。harness自己検証のPASSをassist品質のPASSへ読み替えない。§5.1.4を参照 |

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
- SPI-15/16の権利確認済みfixtureによるtrain→ONNX parityが完了していない（2026-09-22の実測で分類・検出とも技術的にはPASSしたが、**承認済みweightではなくrandom初期化での測定**であるため、SPI-15/16の「承認済みcheckpointに対するparity」は未完である。内訳は§5.1）。
- SPI-17のgold setによるassist品質・manual-only比較が完了していない（段階3は2026-09-22に`SKIPPED_BY_USER`）。
- D-15のWindows実機に基づく有限AutoML trial / 時間budgetが決定していない（2026-09-22に分類のCPU `180`秒 / CUDA `120`秒・最大Trial数`20`を確定。**検出と実データ規模は未決定**。§5.1.3）。
- `resources/models/manifest.json`に承認済みentryがない。

したがってAST-01以降の承認model loader、model固有assist、training、model version、report、camera inferenceをGate 1だけで開始しない。manual annotation/core laneとmodel laneを分離する。

SPI-18全体のstatusはGate 2部が完了するまで**IN_PROGRESS**である。本ADRへGate 1部を記録したことや、空manifestがschemaに適合することをSPI-18全体の完了、Gate 2合格、model同梱許可へ転用しない。

### 5.1 Gate 2 lane実行記録（2026-09-22）

2026-09-22に実行計画の`Gate 2 lane`（`G2-01`〜`G2-09`）を実施し、同日の利用者指示により**2回目の実行**（候補再調査、採用指示に基づくcontrolled retrieval、検出parityの再測定、CUDA budgetの実測、段階3のスキップ）を行った。上記の未充足は**解消していない**。本節は各入力の現在状態を確定した記録であり、Gate 2部の判定を**BLOCKED / NOT_COMPLETE**から変更しない。

| 入力 | 実施内容 | 現在状態 |
|---|---|---|
| SPI-11 / `G2-01` | 既存監査の充足確認に加え、利用者指示により**DINOv2を候補から除外**し、「Apache-2.0等かつ学習データも公開」の条件で候補8件を一次資料付きで再調査（`classification-base.md` §12） | **HOLD**。checkpoint固有licenseの明示と学習データの商用許諾が**同時に揃う候補は0件**。承認済み分類C6 **0件** |
| SPI-12 / `G2-02` | controlled retrieval（`detection-base.md` §14）、利用者決定による**権利gate充足**（同 §15）、backend parity実測（§5.1.9）、採用記録作成と登録（§5.1.10）、**性能実測による保留への差し戻し**（§5.1.11） | **権利gate充足／parityは通過／性能は採用基準に不適合**。採用記録の最終判定は**保留**、**manifest entryなし**。承認済み検出C6 **0件** |
| SPI-13 / `G2-03` | 利用者の採用指示を受けてSigLIPのcontrolled retrievalを実行（`classification-assist.md` §18）。同日、利用者dahatakeの決定により**権利gateを充足**として設定（同 §19） | **権利gate充足（risk acceptance）／技術gate未了**。parity（cpu / directml）未実測、採用記録未作成のため**manifest entryは未作成**。承認済み分類C7 **0件** |
| SPI-14 / `G2-04` | 利用者の採用指示を受けてFlorence-2 / Grounding DINO 2件のcontrolled retrievalを実行（`detection-assist.md` §18）。同日、利用者dahatakeの決定により**権利gateを充足**として設定（同 §19） | **権利gate充足（risk acceptance）／技術gate未了**。Florence-2はcustom code実行がDA-B05未通過、Grounding DINOは構造定義コード不在でparity未実測。**manifest entryは未作成**。承認済み検出C7 **0件** |
| SPI-15 / `G2-05` | beans fixture（MIT）でtrain→ONNX→CPU推論の出力差を実測 | **PASS**。ただし承認済みC6が無いため**random初期化**での測定である |
| SPI-16 / `G2-06` | gwhd-2021 fixture（CC BY 4.0）でbox / score / labelとAP@0.5差を実測。利用者指示により学習epochを変えた3条件で再測定 | **PASS**（既定60 epoch）。6 epoch / 20 epochでは**FAIL**。同じくrandom初期化での測定である |
| SPI-17 / `G2-07` | assist品質baselineのharnessを実装し、manifest gateを実行。段階3は利用者指示でスキップ | **NOT_RUN（実測0件）**。段階3は`SKIPPED_BY_USER`、承認済みC7も0件 |
| D-15 / `G2-08` | Windows実機でOptuna mini-runを実測。分類はCPU 4回・CUDA 3回、検出はCPU 2回・**CUDA 2回**（§5.1.10、§5.1.11） | **分類・検出とも CPU / CUDA を確定**（分類: 20 trial、CPU 180秒 / CUDA 120秒。検出: 20 trial、CPU 420秒 / CUDA 120秒）。**実データ規模は未決定**。CUDA学習は本条件で**非決定的** |
| `G2-09` | 本節の記録とmanifest採否判断 | **BLOCKED**。2026-09-22に一度C6検出1役を登録したが、2026-09-23の性能実測により取り消した（§5.1.11）。同日のGate 2残タスク実行でC6分類1役を承認・登録し（§5.1.12）、owner裁定D1後にC6検出も承認・登録した（§5.1.13）。C7分類・C7検出は保留。`ready=false` |

#### 5.1.1 SPI-15の実測値

Windows `10.0.29671` / `AMD64`、CPython `3.14.7`、torch `2.11.0+cpu`、torchvision `0.26.0+cpu`、onnx `1.22.0`、onnxruntime `1.24.4`、`CPUExecutionProvider`、torch thread `1`。

| 指標 | 事前宣言の許容差 | 実測値 |
|---|---:|---:|
| logit最大絶対差 | `1.0e-04` | `1.5497e-06` |
| softmax確率最大絶対差 | `1.0e-05` | `5.9605e-07` |
| top-1一致 | 15/15 | 15/15 |

2回実行でepoch平均loss 8値と生成ONNXのSHA-256 `d6d657660c2f8b9fd2ca22d4d4f2f382b7b63aaa1a7bca7f957df17c7b596522`が一致した。**この結果は承認済みweightでのparityではない。**

#### 5.1.2 SPI-16の実測値と、FAIL→PASSの原因特定

同一環境。評価5枚、score `>= 0.05`の検出を比較した。利用者指示（選択肢2）により、**学習epochだけを変えて3条件で実測**した。fixture・seed・許容差・比較方法はすべて同一である。

| epochs | 最終epoch平均loss | 検出scoreの全体幅 | 未対応検出（torch / ONNX） | 画像ごとの検出件数一致 | AP@0.5の絶対差 | 判定 |
|---:|---:|---:|---:|---|---:|---|
| 6 | `6.268291` | `0.013195` | 27 / 32 | 1/5 | `9.350e-05` | **FAIL** |
| 20 | `2.487874` | `0.058056` | 2 / 1 | 4/5 | `2.405e-07` | **FAIL** |
| **60**（既定） | `0.145245` | `0.944691` | **0 / 0** | **5/5** | **`0.0`** | **PASS** |

既定60 epochでの各指標は次のとおりで、宣言した許容差をすべて満たす。

| 指標 | 事前宣言の許容差 | 実測値 | 判定 |
|---|---:|---:|---|
| IoU >= 0.99で対応付けたboxの最大絶対差 | `1.0e-03` | `3.0518e-05` | PASS |
| 同scoreの最大絶対差 | `1.0e-04` | `1.1325e-06` | PASS |
| AP@0.5の絶対差 | `1.0e-04` | `0.0`（torch / onnxとも`0.01036998`） | PASS |
| label不一致 | 0 | 0 | PASS |
| 対応相手のない検出 | 0 | 0 | PASS |

**観測された関係:** lossの低下 → scoreの分離幅の拡大 → 未対応検出の減少、が単調に対応している。IoU対応付け済みのbox最大差は3条件とも`3.0518e-05` pxで変わらない。すなわち**演算の移植精度は最初から一貫して高く、6 epochのFAILは検出の順位が定まらないことだけが原因だった**と本fixture上で確定した。60 epoch条件は2回実行でONNX SHA-256 `190a38ab672d54849b51161f60b66bde1d23cd7cbe956aa7bf548da4e8d17975`を含む全指標が一致した。

**一般化しない。** 承認済みweight・他データ・他の後処理設定で同じになるとは測定していない。AP `0.0104`も品質の主張ではない。

#### 5.1.3 D-15の実測根拠

beans fixture 45枚・4 epoch・128px・TPESampler・seed `20260922`・8 trial。

| device | 実行回数 | 1 trial最小 | 1 trial中央値 | 1 trial最大 | study合計 |
|---|---:|---:|---:|---:|---:|
| CPU（`torch 2.11.0+cpu`、thread `1`） | 4 | `2.016`〜`3.889`秒 | `2.462`〜`5.133`秒 | **`7.768`秒** | `24.326`〜`42.699`秒 |
| CUDA（`torch 2.11.0+cu130`、`NVIDIA GeForce RTX 4060 Laptop GPU`） | 3 | `0.562`〜`0.601`秒 | `1.053`〜`2.128`秒 | **`4.353`秒** | `14.077`〜`16.380`秒 |

studyの管理overheadはCPU `0.041`秒 / CUDA `0.035`秒で無視できる。確定した有限budgetは**分類・上記fixture条件で「最大Trial数20」「最大時間 CPU 180秒 / CUDA 120秒」**であり、実測最大trial × 20（CPU `155.4`秒 / CUDA `87.1`秒）を上回る60秒単位の切り上げである。**実データ規模への外挿を根拠にしていない。**

CUDA測定は`torch 2.11.0+cu130`をrepository外の隔離環境へ導入して実施した。**製品lock（`ml/pyproject.toml`・`ml/uv.lock`）は変更していない。** A-07が製品の推論providerを`windows-x64/cpu`と`windows-x64/directml`の2件に固定しておりCUDAを含まないため、製品同梱の可否はTRN phaseで別途判断する。

検出のbudgetと実データ規模のbudgetは未決定である（後者は利用者指示によりスキップ）。全trialのeval accuracyは`0.3333`（3クラスの偶然水準）であり、探索空間の品質根拠には使わない。

#### 5.1.4 `SKIPPED_BY_USER`の追加（G2-07 段階3）

2026-09-22、利用者が SPI-17 の解除条件のうち**段階3（gold setに対する補助あり／手作業のみの実作業sessionの記録）**をスキップすると指示した。§3の`SPI-03` / `SPI-09` / `SPI-19`と同じ扱いとし、**`SKIPPED_BY_USER`を`PASS`へ変更しない**。

- coverage / accept / edit / reject / 所要時間は**未取得のまま**であり、推定値で補わない。
- **NFR-ANN-006（manual-onlyとassistedの比較で品質を悪化させず所要時間を短縮すること）は出荷条件であり、本スキップにより未充足のまま残る。**
- harnessと入力形式は保持し、承認済みC7が得られた時点でそのまま実施できる。

#### 5.1.5 利用者の採用指示とmanifestの扱い

2026-09-22、利用者がSSDLite320-MobileNetV3、YOLOX-Nano、SigLIP、Florence-2-base-ft、Grounding DINO Swin-T / Swin-Bの採用を指示した。指示を受けて**controlled retrieval**（binary取得、SHA-256再計算、`weights_only=True`による安全load、safetensors header解析）を実行し、次を解消した。

| 解消した項目 | 結果 |
|---|---|
| SSDLiteの完全SHA-256が`UNKNOWN` | **確定**。再計算値`a79551df90c7…d65d2`の先頭8桁がfilenameの`a79551df`と一致 |
| YOLOX / Grounding DINOのSHA-256が`unknown`（`digest: null`） | **本調査の取得bytesについて確定**。publisher署名値ではなく再取得の照合基準 |
| YOLOXの2つの同名assetの関係が`UNKNOWN` | **別checkpointと確定**。`start_epoch`が`291`と`294`、model tensor 642件中**538件の値が相違** |
| `.pth`のsafe loadが`NOT_RUN`（FR-SEC-007 blocked） | **restricted load成功**。5件すべてtensor-only |
| SigLIP / Florence-2のlocal hash再計算が`NOT_RUN` | **再計算済み。publisher metadataと完全一致** |

一方で**checkpoint固有のlicense statementは6候補すべてで未取得**である。`resources/models/manifest.schema.json`の`$defs.spdxLicense`は`commercialUseConfirmed`と`redistributionPermitted`を`"const": true`とし、`spdx`に`unknown`等の文字列をpatternで拒否する。`$defs.licenseSet`は`code` / `checkpoint` / `trainingData`の3層すべてを必須とする。したがってentryを作るにはC5コードのlicenseをcheckpoint層へ書く以外になく、それは各監査が最大のリスクとして特定した混同そのものである。

**よってmanifestは未編集とした。** 利用者の指示は各監査文書へ記録し、checkpoint固有licenseが得られた時点でentryを作成できる状態にした。

> **SPI-12については、同日の利用者決定により本項の前提が置き換わった。§5.1.6を参照すること。** SPI-11 / SPI-13 / SPI-14については本項のとおりである。

#### 5.1.6 利用者決定によるSPI-12権利gateの充足設定（2026-09-22）

同日、利用者（repository license decision authority）が「**`G2-02`の権利gateは後で自分が対応する。ここでは充足したと設定せよ**」と指示した。これを**risk acceptance**として記録し、SPI-12の権利gate（DB-L1 checkpoint固有license / DB-L2 商用・再配布 / DB-C8 COCO画像権利 / DB-N1 NOTICE packet）を**充足扱い**とした。詳細は`detection-base.md` §15。

**本決定が意味しないこと:** publisherがcheckpoint固有license statementを発行した事実はなく、COCOのimage-by-image権利も未確認、法務の書面判断も存在しない。一次資料の引用・hash・取得日は一切書き換えていない。DB-T1（YOLOXのexact source commit・preprocess）は**権利gateではなく技術provenance**の項目であり、未解消のままである。

**それでもmanifest entryを作成しない理由**は、権利ではなく次の技術・記録要因である。

| 要因 | 現状 |
|---|---|
| `support[]`のparity検証（A-07はcpu / directmlの2件を必須、`verified`は`const: true`） | **SSDLiteについては解消（§5.1.9）**。torch ↔ ORT CPU（DP-01）とORT DirectML（DP-04）を実測し3比較とも`PASS`。**YOLOX-Nanoは両EPとも未実施**であり、製品後処理を固定したparity（DP-03）と性能実測（POC-16）も未実施 |
| `approval.recordPath`と`evidence`、`dependency-policy.md` §6.1の採用記録 | **SSDLite / YOLOXの採用記録ファイルが未作成**。NOTICE文案も未作成。承認者**氏名**も未記載（「利用者（license decision authority）」は役割の記述） |
| `licenses.checkpoint.spdx`と`noticeText`に書く値 | risk acceptanceが供給するのは判断であり、**license識別子とNOTICE本文そのものは利用者から未提示** |

なお`inferenceConfig`は`$defs.modelEntry`の`required`に含まれず、末尾の`if: {category: const "C7"}`により**C7のときだけ必須**である。`G2-02`はC6検出であるため、製品の検出後処理の未確定（DP-03）は**schema上のentry作成阻害要因ではない**。

加えて本決定は**C6検出の1役のみ**を対象とする。`ready=true`は4役すべてを要求するため、他3役が未充足である限り`ready=false`は変わらない。**Gate 2部の判定は BLOCKED / NOT_COMPLETE のままである。**

#### 5.1.7 独立敵対的レビュー

2回の実行それぞれについて別担当がレビューし、報告された測定を同一環境で**再実行して再現性を確認**した。1回目は blocking 1件・non-blocking 5件、2回目は blocking 3件・non-blocking 3件、3回目（SPI-12権利gateの充足設定）は blocking 3件・non-blocking 4件を受領し、いずれも全件反映済みである。

| 回 | 指摘 | 反映内容 |
|---|---|---|
| 1 | D-15の`600`秒が未測定の外挿で正当化されていた | budgetを実測条件へ限定し、実測から算出できる値へ訂正 |
| 1 | `average_precision`がVOC補間になっていなかった | `precision[index:].max()`へ訂正し再実測。判定は不変 |
| 1 | AP絶対許容差がAP≒0では相対7.14%を許す | 相対差を併記し、AP PASSをFAILの反証に使わない旨を明記 |
| 1 | 順位整列のlabel不一致が「参考」なのにfailure条件へ加算 | IoU対応付け済みpairのみをfailure条件へ変更。実測0件で判定不変 |
| 1 | §1追補の「実測で確定」がSPI-11〜14・SPI-17に当たらない | 表現を実態へ訂正 |
| 1 | `detection-result.md`のguard説明が実装と1件ずれ | 「2件未満」へ訂正 |
| 2 | **blocking: 本ADRが再測定前の内容のまま残り、正本どうしが矛盾**（G2-06をFAIL、D-15をCPUのみと記載） | §1追補・§5・§5.1表・§5.1.2・§5.1.3を2回目の実測へ同期し、§5.1.4に`SKIPPED_BY_USER`を追加した（本節） |
| 2 | **blocking: `detection-result.md` §1がAP約`0.001`（6 epochの値）を既定条件の測定として記載** | 既定60 epochの`0.0104`と6 epochの`0.0013`を条件付きで併記 |
| 2 | **blocking: `--device cuda`をparity modeが黙って受理し、決定性OFFのparity記録を生成できる**（再実行で異なるONNX hashを確認） | parity modeで既定以外のdeviceを`parser.error`で拒否するよう修正 |
| 2 | `score_spread`が空検出画像で`TypeError`となりJSON出力前に異常終了しうる | `None`を除外して集計し、全画像が空なら`None`を返すよう修正。`score_min_max`の条件も`torch_scores`件数へ是正 |
| 2 | 「実測を包含する最小の切り上げ」が算術的に成立しない（`155.4`→最小は`156`） | 「実測最大trial × 20を上回る**60秒単位の切り上げ**」と丸め規則を明示 |
| 2 | 1回目と2回目のwork記録に相互参照がない | 2回目の記録へsupersede関係を追記（履歴は書き換えない） |
| 3 | **blocking: `inferenceConfig`をC6でもschema必須と誤記**（実際は`if: {category: const "C7"}`によりC7のみ必須） | DP-03をentry作成の阻害要因から外し、C6では省略可と訂正 |
| 3 | **blocking: `support[]`の未検証をDirectML（DP-04）のみに限定**。本checkpointはCPU側のparity（DP-01）も未実施 | CPU・DirectML双方が未実施と訂正 |
| 3 | **blocking: `detection-base.md`の§0.2 / §6 / §10 / §11が旧状態のまま残り矛盾**（とくに§11の「`vendor/models/`へ入れてはならない」と§14.2の実配置） | 各節へsupersede注記を追加。§11には`vendor/models/`配置がD-09と利用者指示に基づく解除であることを明記 |
| 3 | 「解除に必要なのはDP-03とDP-04だけ」が採用記録・NOTICE未作成を含まない過小主張 | 採用記録ファイル・NOTICE文案・license識別子の未提示を追記 |
| 3 | 承認者が氏名でない（`dependency-policy.md` §6.1は氏名必須） | DB-A1を「部分的に供給」へ訂正し氏名未記載を明記 |
| 3 | CHANGELOG概要が「承認0件」を単一原因に帰しており、Changed項目と不一致 | 概要をG2-02と他3役で分けて記述 |

#### 5.1.8 本記録が変更しないもの

- Gate 1部の**CONDITIONAL_GO**、SPI-03/09/19の`SKIPPED_BY_USER`、§2の各PASS。
- `resources/models/manifest.json`は§5.1.9までの各測定では不変（working-tree bytes SHA-256 `7fe41f5bc497d48ffcbbaebaeb5cb02e91dfba0e1a6fe9b66d8cf8928c437a61`）であった。**§5.1.10でC6検出1件を登録したため、現在のbytesはこの値ではない。** `releaseStatus.ready`は`false`のままである。
- Gate 2部の判定。**承認済みmodelはC6検出1役のみ**であり、C6分類・C7分類・C7検出の3役が未承認であるため、**BLOCKED / NOT_COMPLETE**を維持する。SPI-15/16が承認済みweightでのparityでないこと、SPI-17の`NOT_RUN`も変わらない。SPI-18全体も**IN_PROGRESS**のままである。
- 依存・lock・製品版。`ml/pyproject.toml`と`ml/uv.lock`は変更していない。CUDA測定はrepository外の隔離環境で実施した。

#### 5.1.9 取得済みcheckpointのbackend parity実測（DP-01 / DP-04、2026-09-22）

§5.1.6が挙げた3つの阻害要因のうち、**利用者の入力を要しないparity実測のみ**を実施した。新規spike [`spikes/models/detection_checkpoint_parity.py`](../../spikes/models/detection_checkpoint_parity.py)（SHA-256 `38984621975e88acef7adbed43d4cbcd0df471ecf5abd75ab9a0dddf634ae277`）で、`vendor/models/`（Git追跡外）のSSDLite checkpointをhash gate付きで`weights_only=True` loadし、ONNX（opset 17）へexportしたうえで3 backendを比較した。

| 比較 | ID | 対応付け | 片側のみ検出 | label不一致 | box最大差 | score最大差 | 判定 |
|---|---|---:|---:|---:|---:|---:|---|
| torch ↔ ORT CPU | DP-01 | 294 | 0 / 0 | 0 | `9.9182e-05` | `6.0350e-07` | **PASS** |
| torch ↔ ORT DirectML | DP-04 | 294 | 0 / 0 | 0 | `1.3733e-04` | `6.4075e-07` | **PASS** |
| ORT CPU ↔ ORT DirectML | DP-04 | 294 | 0 / 0 | 0 | `1.4496e-04` | `6.1840e-07` | **PASS** |

許容差（box `1.0e-03` / score `1.0e-04`）はSPI-16と同値を実行前に固定しており、結果に合わせて緩めていない。2回実行でONNX SHA-256 `6e62517b…e99d9`を含む全指標が一致した。詳細は[`detection-checkpoint-parity-result.md`](../../spikes/models/detection-checkpoint-parity-result.md)。

**この実測が意味しないこと:** 承認ではない。fixtureはgwhd-2021でありCOCO checkpointにとってout-of-domainであるから、**精度の主張を含まない**。DirectML sessionはCPU fallbackを含みうるため、全nodeのGPU実行も主張しない。YOLOX-Nanoのparity、製品後処理を固定したparity（DP-03）、性能実測（POC-16）はいずれも未実施である。`resources/models/manifest.json`は変更していない。

#### 5.1.10 利用者指示による採用処理の完了（2026-09-22 夜）

利用者 **dahatake** が次を指示した。(1) **C7にもrisk acceptanceを出す**、(2) **検出budgetの暫定測定を許可する**、(3) `licenses.checkpoint.spdx`の識別子は**アプリケーション名**、`noticeText`は製品用途に相応しい文面を作成、**承認者氏名はdahatake**。決定は[`evidence/2026-09-22-owner-risk-acceptance.md`](../model-governance/evidence/2026-09-22-owner-risk-acceptance.md)（SHA-256 `baa0b97f…16c402`）に一次証拠として記録した。

**実施した内容:**

| 項目 | 結果 |
|---|---|
| C6検出のmanifest登録 | **完了**。`ssdlite320-mobilenet-v3-large-coco-v1`を1件登録。`licenses.checkpoint.spdx`は**`LicenseRef-AutoVisionStudio`**（SPDXの`LicenseRef-`構文によるrepositoryローカル参照。publisherの表明ではない）。採用記録は[`ssdlite320-mobilenet-v3-large-coco-v1-adoption.md`](../model-governance/ssdlite320-mobilenet-v3-large-coco-v1-adoption.md)、承認者`dahatake`、承認日`2026-09-22` |
| 一次資料の保存copy | **3件作成**（TorchVision `v0.26.0` LICENSE、COCO Terms of Use、torchvision SSDLite model doc）。`docs/model-governance/evidence/`配下にSHA-256付きで保存し、manifestの`evidence[]`から参照した |
| C7の権利gate | **充足として設定**（`classification-assist.md` §19、`detection-assist.md` §19）。**manifest entryは作成していない**（parity未実測・採用記録未作成） |
| 検出AutoML budget | **実測完了**。`detection.py --mode automl-mini-run`を2回実行し、D-15へ「最大Trial数20 / CPU 420秒」を記録 |
| `G2-07` | **NOT_RUNのまま**。manifest更新後もgateは`BLOCKED`（`ready=false`、承認済みC7 0件）。段階3は`SKIPPED_BY_USER` |

**`releaseStatus.ready`を`true`にしない理由:** schemaは4役（C6分類・C6検出・C7分類・C7検出）すべてを要求する。C6分類は候補0件（`classification-base.md` §12）、C7 2役はparity未実測である。`support[]`の`verified`は`const: true`であり、未実測のまま書くことは未実行の試験を合格として記録する行為にあたる。

**回帰:** `manifest-schema.test.mjs`を36件へ更新した（旧「空manifestを受理する」testを「部分承認setを受理する」testへ置換し、`evidence[]`のlocalPath実在とSHA-256一致を検証するtestを追加）。全36件PASS。

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
- SPI-11〜14: `docs/model-governance/classification-base.md`、`docs/model-governance/detection-base.md`、`docs/model-governance/classification-assist.md`、`docs/model-governance/detection-assist.md`
- SPI-15: `spikes/models/classification.py`、`spikes/models/classification-result.md`
- SPI-16: `spikes/models/detection.py`、`spikes/models/detection-result.md`
- SPI-17: `spikes/models/assist_benchmark.py`、`spikes/models/assist-result.md`
- D-15: `docs/implementation-plan.md` D-15行、`spikes/models/classification.py --mode automl-mini-run`
- 判定規則: `docs/implementation-plan.md` §6、Phase C、SPI-18二部判定

#### 5.1.11 推論性能とCUDA budgetの実測、および登録の取り消し（2026-09-23）

利用者の入力を必要としない2項目を実測した。

**(1) 検出AutoMLのCUDA budget（D-15の唯一の未達項目）**

Gate 2の合格条件は「Windows **CPU/accelerator**のAutoML budgetを実測決定」である。repository外の隔離venv（`torch 2.11.0+cu130`、CUDA build `13.0`、RTX 4060 Laptop、optunaはCPU実測と同じ`4.9.0`に固定）で、CPU実測と同条件（trial 8・3 epoch・seed `20260922`）の`--device cuda`を2回実測した。

| 実行 | 1 trial 最小 | 中央値 | 最大 | study合計 |
|---|---:|---:|---:|---:|
| 1回目 | `1.303`秒 | `1.832`秒 | **`3.945`秒** | `16.090`秒 |
| 2回目 | `1.157`秒 | `1.729`秒 | `3.065`秒 | `14.755`秒 |

D-15へ**検出・CUDA「最大Trial数20 / 最大時間120秒」**を記録した（`3.945 × 20 = 78.9`秒を上回る60秒単位の切り上げ）。**CPUは2回とも8 trialのlossが同値だったのに対し、CUDAは2回でlossが一致しない**。本条件のCUDA学習は非決定的であり、budgetの算出には所要時間のみを用いた。製品lock（`ml/pyproject.toml`・`ml/uv.lock`）は変更していない。

**(2) SSDLiteの推論性能（採用記録§11の空欄）と、その帰結**

`detection_checkpoint_parity.py`へ`--mode performance`を追加し、同一ONNXについてwarm-up 5巡の後に5枚×20巡＝100サンプルを計測した（nearest-rank percentile、既定session option、1枚ずつ逐次実行）。

| EP | p95レイテンシ（2回） | throughput（2回） | peak working set |
|---|---|---|---|
| CPU | `198.959` / `179.384` ms | `7.07` / `8.35` FPS | `598.6` / `597.9` MB |
| DirectML | `308.783` / `254.590` ms | `4.64` / `5.45` FPS | `754.5` / `756.9` MB |

採用基準（`adoption-template.md` §11の`≤ 100 ms` / `≥ 10 FPS`、POC-03由来）に対し**両EPとも不適合**である。同§15は「いずれかの必須項目が…不適合の場合、判定欄に『承認』と記入できません」と規定するため、**fail-closedに従い次を実施した**。

1. 採用記録の最終判定を**承認→保留**へ差し戻した。
2. `resources/models/manifest.json`のentryを削除し`models: []`へ戻した。`ready`は`false`のまま。
3. `manifest-schema.test.mjs`の期待値を現在の内容へ合わせた（36件PASS）。
4. **権利層の決定は取り消していない。** 保留の理由は技術（性能）である。

**この結果が主張しないこと:** 製品条件で`100`msを満たせないことを確定しない（固定shape化・graph optimization・batch化・EP構成変更は未実施）。POC-03の完全条件（capture-to-display、30分連続、drop率）はカメラと製品推論の実装が無いため未測定である。本機がPOC-03の「Windows推奨構成」に該当するかは、正本に推奨構成の定義が見当たらないため確定できない。

**再登録に必要なもの（いずれか）:** 最適化した推論経路での基準充足の実測、C6に実時間推論閾値を適用しないというrepository ownerの裁定、または性能未達のrisk acceptance。

#### 5.1.12 FR-LIC-016に基づく残タスクの実行（2026-09-23）

実行計画`work/20260923-0630-Gate2-TaskExecutionPlan.md`を利用者指示「不明点はデフォルトのプランを採用」で実行した。実行記録は`work/20260923-0720-Gate2-TaskExecution.md`。

| 役 | 対象 | 権利層 | 技術層の実測 | 採用記録の判定 | manifest |
|---|---|---|---|---|---|
| C6 分類 | torchvision `MobileNet_V3_Large_Weights.IMAGENET1K_V2` | 2026-09-23 risk acceptance（artifact A） | parity PASS、CPU p95 `12.9`〜`34.8` ms・DirectML p95 `2.1`〜`2.4` ms、対象用途の精度は測定前固定の基準（乱数初期化以上）を満たすが両者とも偶然水準、CVE Critical/High 0 | **承認** | 登録 |
| C6 検出 | SSDLite320 MobileNetV3 Large `COCO_V1` | 2026-09-22 risk acceptance | torchvision後処理`score_thresh=0.05`（既存parityの`SCORE_FLOOR`と同値）で再exportしたgraphはparity PASS（既定閾値と全桁一致）、CPU p95 `14.3`/`19.2` ms・DirectML p95 `29.6`/`27.7` ms。Fine-Tuning後AP@0.5 `0.0603`（乱数初期化 `0.0104`）、CVE Critical/High 0。既定後処理は不適合のまま | **保留**（いったん承認・再登録したが、閾値が製品の推論契約として未確定（DP-03）でmanifestが強制できないとの敵対的レビュー指摘により同日保留へ戻した） | 未登録 |
| C7 分類 | `google/siglip-base-patch16-224` | 2026-09-22 risk acceptance | parity PASS。DirectML p95 `16.5`〜`17.1` ms は基準内、**CPU p95 `545`〜`831` ms は不適合** | **保留** | 未登録 |
| C7 検出 | `IDEA-Research/grounding-dino-tiny`（HF safetensors、GitHub版`.pth`とは別artifact） | 2026-09-23 risk acceptance（artifact B） | 最小限のexport時置換でONNX化したが**parity FAIL** | **保留** | 未登録 |

- SPI-17（G2-07 / NFR-ANN-006）は承認済みC7が0件で、かつ実作業sessionが必要なため**NOT_RUN**のまま。G2R-40〜43は依存未充足で未着手である。
- transformersは隔離spike venv（Git追跡外の`vendor/models/_spike/venv`）でのみ使用し、製品lockへ追加していない。
- 本節の時点で`resources/models/manifest.json`は承認1件（C6分類）で`releaseStatus.ready=false`であった。C6検出はその後のowner裁定により承認した（§5.1.13）。Gate 2部は**BLOCKED / NOT_COMPLETE**のままである。

#### 5.1.13 owner裁定D1によるC6検出の承認（2026-09-23）

利用者dahatakeが2026-09-23 11:17に、C6検出の閾値判断とOWL-ViTの教育目的の扱いを「要求定義書に照らし合わせて合理的な選択でOK」と委任した。記録は`docs/model-governance/evidence/2026-09-23-owner-rulings.md`。

- **D1:** C6（学習の初期化に用いる基盤重み）の採用判定にPOC-03の実時間推論基準（100 ms / 10 FPS）を適用しない。根拠は要求定義§5の定義とFR-INF-001（カメラ推論の対象は成功済みModel Version）である。POC-03 / NFR-PERF-004はINF phaseでModel Versionの推論経路に対して検証し、緩和しない。
- **帰結:** SSDLite320の採用記録を**承認**とし、manifestへ登録した。C6の技術基準（hash・安全load・CPU / DirectML parity・Fine-Tuning後AP@0.5 `0.0603` ≥ 乱数初期化 `0.0104`・D-15・CVE）はすべて通過済みである。
- **D2:** OWL-ViT / OWLv2のmodel cardが教育目的に言及しないことは、製品のモデル利用条件より狭い用途制限（FR-LIC-003）として扱う。採用する場合は書面承認とアプリ内表示を要する。
- manifestは承認2件（C6分類・C6検出）、`releaseStatus.ready=false`。Gate 2部は**BLOCKED / NOT_COMPLETE**のままである（C7 2役とSPI-17が未充足）。

#### 5.1.14 C7残タスクの実行（2026-09-23）

実行計画`work/20260923-1437-C7-RemainingTasksExecutionPlan.md`を利用者指示「不明点はデフォルトのプランを採用」で実行した。各ノードは完了条件の検証と敵対的レビューを経ている。

| 役 | 対象 | 実測・調査 | 採用記録の判定 | manifest |
|---|---|---|---|---|
| C7 分類 | TinyCLIP ViT-8M/16 Text-3M YFCC-15M | 一次資料（HF model card、microsoft/Cream、arXiv 2309.12314v1）に intended / out-of-scope use の記載がない。teacher は論文上 OpenCLIP ViT-B/16 で、その checkpoint の重みの系譜は未確認（FR-LIC-015 未解決）（`work/20260923-1546-TinyCLIP-PrimarySourceSurvey.md`） | **除外 / HOLD 維持**（adoption-template §8 の「判断不能 → 同梱不可」） | 未登録 |
| C7 分類 | `google/siglip-base-patch16-224` | 計画の既定案（ONNX Runtime 動的量子化を 1 案だけ）は、1 回目が実行環境の sandbox で失敗し、sandbox 外のターミナルで再実行した。int8 は **parity 不合格**（score 最大差 `9.04e-02`、top-1 12/15）、**CPU p95 `215.8` ms・`8.33` FPS で性能も不合格** | **保留を維持** | 未登録 |
| C7 検出 | `google/owlvit-base-patch32`（revision `cbc355fb`） | 7 file の hash が publisher metadata と一致、remote code 不要。生出力 parity PASS（`rtol 1e-3` / `atol 1e-4`、CPU・DirectML、5 枚）。ただし fixture では score `> 0.05` の検出が 0 件で検出単位の parity は未確認。DirectML p95 `42.3`〜`62.5` ms は基準内、**CPU p95 `918.1`〜`1,569.9` ms は不適合** | **保留** | 未登録 |

- C7 分類・検出の両方が保留のため、計画 §5 の HOLD branch に従い補助品質 baseline（C7Q-01〜04 / SPI-17）は**実行していない**。利用者の実作業 session も存在しない。
- manifest schema を `2.0.0` に改訂し、`releaseStatus.ready=true` に C7 分類・検出の比較試験（NFR-ANN-006 / POC-16）の合格記録 `releaseStatus.assistQuality[]` を必須とした。`ready=true` にしていた既存の条件を狭める変更のため、SchemaVer の規則（既存の有効なデータを拒否し得る変更は MODEL を上げる）に従い major を上げた。合わせて `spikes/models/assist_benchmark.py` の前提条件から `ready=true` を外し（schema と循環しないため）、gold set の item id 集合の一致と中央所要時間の出力を加えた。schema と文書間の照合（`modelId`・`recordPath`・SHA-256）の実行は PKG-01 の release verifier の範囲であり、未実装のままである。
- manifestは承認2件（C6分類・C6検出）、`releaseStatus.ready=false`。Gate 2部は**BLOCKED / NOT_COMPLETE**のままである（C7 2役とSPI-17が未充足）。
