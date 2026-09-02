# AutoVision Studio 残タスク詳細実行計画

| 項目 | 値 |
|---|---|
| 作成日 | 2026-09-03 |
| 対象ブランチ | `main` |
| コード基準 HEAD（本書作成前） | `4cec3a9c8244a95d4a3bfc5eb73ac5e7b82e8850` |
| remote 基準（本書作成時） | `origin/main = a80219fced422ab0abd35f0d4a9bb13065fe171a` |
| 本書のGit状態 | 新規・未追跡。本書をcommitした後のSHAを`<HANDOFF_COMMIT>`として別途記録する [E-PLAN-STATE] |
| 要求正本 | `docs/requirement-definition.md` v0.3、SHA-256 `2f1c57da192710ffb2fd764c7e342cf2e9106fa7387be7393133873cc815052f` [S-RD] |
| タスク正本 | `docs/implementation-plan.md` v0.1 Draft、SHA-256 `d9d4f5f22753c6784d6b69def319bf9ff4df16d27f79f1219a971f40152bec46` [S-IP] |
| 正本タスク総数 | 253件 [S-IP §7][E-COUNT] |
| VERIFIED済み正本タスク | 23件（A-01〜A-10、B-01〜B-13）[E-GIT][E-COUNT] |
| 残正本タスク | **230件（Phase C〜N）** [S-IP §7][E-COUNT] |
| 追加の管理チェックポイント | H0（移送）、B-GATE（Phase B再現）、C0（依存lock所有権是正）の3件。本来の253タスクには数えない |
| 現在の判定 | Phase Bのtask commitは完了。Phase C開始前チェックポイントは未完 |

> **事実境界:** 本書作成時に新しい実装・PoC・macOS試験・model承認・署名・Gate合格は行っていない。`PASS`は保存済み実行証拠がある場合だけ記録し、未実施は`NOT_RUN`、外部条件不足は`BLOCKED`、一部OSだけの結果は`PARTIAL`とする。[S-CONTRIB §§2,5,7,10]

## 1. 優先順位と出典規則

### 1.1 正本の優先順位

矛盾時は次の順で解決する。

1. `docs/requirement-definition.md`（要求）[S-RD]
2. `docs/implementation-plan.md`（task、依存、成果物、Gate）[S-IP]
3. ADR-0001〜0003（process、data lifecycle、packaging）[S-ADR1][S-ADR2][S-ADR3]
4. `docs/dependency-policy.md`と`CONTRIBUTING.md`（依存、license、実行・証拠規約）[S-DEP][S-CONTRIB]
5. 本書（現在地と実行順）。上位文書を変更せずに上書きしない。

要求またはtask正本を変える必要が出た場合は、実装内で黙って解釈せず、変更理由、影響requirement、依存DAG、test、reviewを伴う計画変更commitを先に作る。[S-IP §§1.3,4.4][S-CONTRIB §§4,5]

### 1.2 引用方法

- 各phaseのtask表は`[S-IP §7 <phase>]`を直接の出典とする。
- requirement割当は`[S-IP §9]`、要求本文は`[S-RD §§7〜12]`を参照する。
- process境界は`[S-ADR1]`、不変性・削除境界は`[S-ADR2]`、installer/OS境界は`[S-ADR3]`を参照する。
- 外部資料URLは本書末尾の`[P01]`〜`[P16]`に示す。これは`[S-IP §12]`に記録されたURLであり、**本書作成時に内容を再取得したとは扱わない**。各採用taskで最新一次資料を再取得し、取得日、版、URL、必要なら保存copy/hashを証拠化する。[S-CONTRIB §5][S-DEP §§6,10]
- C6/C7、license、dataset termsは`[S-RD §19]`の一次資料索引と`[S-MODEL-TEMPLATE]`を使う。二次記事だけで承認しない。[S-DEP §§4,6]

## 2. 現在地の監査結果

### 2.1 Git・成果物

本書作成直前の2026-09-03 read-only監査結果は次のとおり。[E-GIT]

- `HEAD`は`4cec3a9c8244a95d4a3bfc5eb73ac5e7b82e8850`。
- 本書作成前のworking treeはclean（`git status --porcelain` 0件）。
- local branch/worktreeは`main` 1件だけ。
- `main`は`origin/main`より17 commit先行。別環境は本書作成時点のremote cloneだけではコード基準HEADを取得できない。
- Phase A基盤文書はcommit `98aba1f`、A-07は`e92ad59`。
- B task/integrationは`c01be93`〜`4cec3a9`のcommit列に実在する。
- `package-lock.json`と`ml/uv.lock`は追跡済み。
- 最新B6 commit本文にはNode test 19/19、TypeScript、3 entry build、Windows x64 Electron smokeの記録がある。macOS結果はない。[E-B6]
- 本書作成後は本ファイルだけが新規未追跡となった。したがってH0では本書を含む新しいhandoff commitを作るか、本書をGit外で別送する必要がある。[E-PLAN-STATE]

### 2.2 完了と残数

| Phase | 正本件数 | 完了 | 残 | 根拠 |
|---|---:|---:|---:|---|
| A | 10 | 10 | 0 | [S-IP §7 Phase A][E-GIT] |
| B | 13 | 13 | 0 | [S-IP §7 Phase B][E-GIT] |
| C | 19 | 0 | 19 | [S-IP §7 Phase C] |
| D | 15 | 0 | 15 | [S-IP §7 Phase D] |
| E | 8 | 0 | 8 | [S-IP §7 Phase E] |
| F | 16 | 0 | 16 | [S-IP §7 Phase F] |
| G | 29 | 0 | 29 | [S-IP §7 Phase G] |
| H | 22 | 0 | 22 | [S-IP §7 Phase H] |
| I | 32 | 0 | 32 | [S-IP §7 Phase I] |
| I.1 | 3 | 0 | 3 | [S-IP §7 Phase I.1] |
| J | 12 | 0 | 12 | [S-IP §7 Phase J] |
| K | 20 | 0 | 20 | [S-IP §7 Phase K] |
| L | 24 | 0 | 24 | [S-IP §7 Phase L] |
| M | 23 | 0 | 23 | [S-IP §7 Phase M] |
| N | 7 | 0 | 7 | [S-IP §7 Phase N] |
| **合計** | **253** | **23** | **230** | [E-COUNT] |

`AST-17`、`TRN-23`、`TRN-24`は正本に存在しない欠番であり、taskとして補完しない。[S-IP §7]

### 2.3 固定済みtool/lock事実

| 項目 | 現在の固定または実測 | 出典 |
|---|---|---|
| Node engine | `24.19.x` | `package.json` [S-NODE] |
| npm | `11.17.x`、package manager `npm@11.17.0` | `package.json` [S-NODE] |
| Electron | `44.0.0` | `package.json`/lock [S-NODE][S-NPMLOCK] |
| React | `19.2.8` | `package.json`/lock [S-NODE][S-NPMLOCK] |
| TypeScript | `7.0.2` | `package.json`/lock [S-NODE][S-NPMLOCK] |
| Python project | `>=3.14,<3.15`、lockは`==3.14.*` | `ml/pyproject.toml`、`ml/uv.lock` [S-PY][S-UVLOCK] |
| uv | `==0.12.9` | `ml/pyproject.toml` [S-PY] |
| pytest | `9.1.1` | `ml/pyproject.toml`/lock [S-PY][S-UVLOCK] |
| 作成PCのPATH上Python | `3.12.10`（project要件外）。B-13 commitの過去証拠はCPython 3.14.7 | [E-ENV][E-B13] |
| Ruff/Pyright | 設定はあるが、現npm/uv lockには実行packageがない | [S-PY][S-NPMLOCK][S-UVLOCK][E-LOCK-AUDIT] |

別環境ではPATH上の任意Pythonを採用版とみなさず、`uv sync --locked`が解決する3.14環境を使う。Ruff/Pyrightを「入っているはず」と扱わない。

## 3. 別環境へ移す前の必須チェックポイント

### H0 — 基準commitと本書の移送

**状態: TODO。** コード基準`main`はremoteより17 commit先行し、本書は新規未追跡である。[E-GIT][E-PLAN-STATE]

推奨手順:

1. 秘密、model binary、ユーザーデータがstagingされていないことを確認する。[S-CONTRIB §§9〜11]
2. 本書をreviewし、運用規則が許す場合は本書だけをcommitする。commit直前のparentが`4cec3a9...`であることを確認する。
3. commit後の実SHAを`<HANDOFF_COMMIT>`として移送記録に保存する。**`<HANDOFF_COMMIT>`は`4cec3a9...`と同じではない。**
4. remoteへpushするか、`<HANDOFF_COMMIT>`を含むGit bundleとbundle SHA-256を安全に移送する。
5. 本書をcommitしない場合は、コード`4cec3a9...`のbundleと本書ファイルを別送し、本書自体のSHA-256も別経路で伝える。

別環境では次を確認する。

```text
git fetch --all --prune
git checkout main
git rev-parse HEAD
git status --short --branch
git worktree list --porcelain
git merge-base --is-ancestor 4cec3a9c8244a95d4a3bfc5eb73ac5e7b82e8850 HEAD
```

- 本書をcommitした場合: `git rev-parse HEAD`が記録済み`<HANDOFF_COMMIT>`と一致し、最後のancestor確認がexit 0であること。
- 本書を別送した場合: code HEADが`4cec3a9...`と一致し、本書SHA-256が移送記録と一致すること。
- 一致しない場合は実装を開始しない。

### B-GATE — Phase Bの別環境再現

**状態: TODO。正本taskではなくphase closure。** B task個別証拠はあるが、統合コード基準をclean環境で再構築した証拠は本書作成時にない。[E-GIT][E-B6]

Windows x64または対応するclean環境で、lockを変更せず次を順に実行する。[S-CONTRIB §§6,8,12][S-DEP §5]

```text
npm ci
npm test
npm run typecheck
npm run build
cd ml
uv lock --check
uv sync --locked
uv run --locked pytest -q
```

合格条件:

1. `package-lock.json`、`ml/uv.lock`にdiffがない。
2. Node test、TypeScript、Main/Preload/Renderer buildがexit 0。
3. Python 3.14環境で全pytestがexit 0。
4. built Electronがlocal Rendererと`dist/preload/index.cjs`を読み、sandbox/contextIsolationを維持する。
5. Windowsで実施した結果をmacOS結果として転用しない。
6. 実行コマンド、OS/build、CPU/architecture、tool version、exit code、test件数をGate記録またはcommit本文へ保存する。

**Ruff/Pyright再現性gap:** 現lockにはRuff/Pyrightがないため、別環境で両toolが利用不能ならB-GATEをPASSにしない。未固定の`latest`をglobal installせず、C0でtool所有権とexact lockを正本へ追加してからB-GATEを再実行する。[E-B13][E-LOCK-AUDIT][S-DEP §§5,10]

### C0 — Phase C依存の所有権とexact lock是正

**状態: TODO（C0完了までPhase CをBLOCKED）。正本task230件には含めない。** 現lockには`better-sqlite3`、`electron-builder`、`konva`/`react-konva`、PyInstaller、PyTorch、Optuna、ONNX Runtime、Ruff、Pyrightがない。一方、SPI-01/03/04/05/06/08/10/15/16およびB-GATEはそれらを必要とする。[S-IP §§3.2,4.4,7 Phase C][S-NODE][S-PY][E-LOCK-AUDIT]

正本は「task表に列挙したfile以外を編集しない」と定めるが、該当SPI行は`package.json`/`package-lock.json`または`ml/pyproject.toml`/`ml/uv.lock`を成果物に含めていない。[S-IP §4.4, §7 Phase C] よって次を先に行う。

1. `docs/implementation-plan.md`へ依存採用taskを追加するか、該当SPIの成果物/依存欄を明示的に改訂する。完了済みB-01/B-11を履歴上書きしない。
2. packageごとに必要性、採用候補版の公式対応matrix、license/NOTICE、transitive依存、脆弱性、OS/architecture wheelまたはnative binary可用性を調査する。[S-DEP §§2〜5,10,11]
3. 版番号は調査時点の一次資料と実installで確定し、`^`/`~`や未指定`latest`を使わずexact lockする。**本書では未調査の版番号を置かない。**
4. PyInstallerはlicense exceptionを含む実際の採用版条件を法務/依存reviewで確認し、単純に「GPLだから可/不可」と断定しない。[S-DEP §§2〜4]
5. Node/Python lockのdiff、integrity/hash、両対象OS marker、clean install、最小import/build smokeをreviewする。
6. 独立敵対レビュー後にB-GATEを再実行する。

C0がCLOSEDでなければC1を開始しない。

## 4. 実行環境・外部ブロッカー

| ID | 必要条件 | 必要時点 | 未充足時 | 出典 |
|---|---|---|---|---|
| ENV-WIN | Windows x64、PowerShell 7+ | Windows/common lane | Windows固有taskを`BLOCKED` | [S-CONTRIB §6][S-ADR3 §§2.2,10] |
| ENV-MAC | native Apple Silicon arm64 Mac | SPI-04/06/08/09/19、INF/PKG macOS、Gate 1/4/5 | 該当結果を`NOT_RUN`、Gateを未判定 | [S-IP §§1.4,6][S-CONTRIB §7][S-ADR3 §10] |
| MODEL-C6 | 分類/検出base weightのlicense・由来・hash・品質承認 | Gate 2 | model固有trainingを開始しない | [S-RD FR-LIC-004〜008][S-DEP §6.1] |
| MODEL-C7 | 分類/検出assist checkpointの同承認 | Gate 2 | assist model実装/同梱を開始しない | [S-RD FR-LIC-014〜015][S-DEP §6.2] |
| BUDGET | AutoML有限budgetの実測確定 | Gate 2/TRN-09 | trial/time数値を固定しない | [S-IP D-15, SPI-15〜18, TRN-09] |
| PRODUCT-ID | 暫定`io.github.dahatake.autovisionstudio`の正式決定 | Gate 3以前、遅くとも署名前 | 正式署名/upgrade identityを固定しない | [S-IP D-10][S-ADR3 §6] |
| SIGN-WIN | 組織の正式Windows署名identity | PKG-07/Gate 5 | Windows release不可 | [S-IP D-16, PKG-07][S-ADR3 §§6,7] |
| SIGN-MAC | Developer ID Application/Installerとnotarization資格 | PKG-08/Gate 5 | macOS release不可 | [S-IP D-16, PKG-08][S-ADR3 §§6,7] |

署名鍵、passphrase、token、未承認model binary、ユーザー画像/ProjectはGit・本書・レビュー本文・ログへ入れない。[S-CONTRIB §9][S-DEP §9]

## 5. 全task共通の実装サイクル

各taskを必ず個別に次の順で閉じる。[S-IP §4][S-CONTRIB §§1〜3,10]

1. **Context Pack:** 対象requirement ID、task行、依存ADR節、編集対象全文、直接import元/先、隣接testだけを読む。
2. **依存確認:** 依存taskが`VERIFIED`、必要Gateが`PASS`であることを証拠から確認する。
3. **scope固定:** task表の成果物だけを変更し、1つの観測可能挙動を実装する。成果物不足はC0と同様に先に計画変更する。
4. **実装:** 最小実装。汎用framework、将来flag、無関係refactor、未承認model、runtime downloadを入れない。
5. **対象検証:** 正常/境界/失敗case、type/lint/editor diagnostics、対象testを実行する。媒体metadata値など機微情報をログへ出さない。
6. **独立敵対レビュー:** 別context/reviewerが、要求漏れ、要求外実装、偽陽性、状態遷移、IPC/path/network、不変性、license断定を確認する。指摘はfile/箇所/再現/期待/根拠を必須とする。
7. **裁定・修正:** 再現した指摘だけを直す。future taskの責務や証拠のない懸念は根拠付きでNot-a-defect/Deferredとする。
8. **再検証:** 対象testと指摘再現testを再実行する。
9. **task commit:** task ID、要求ID、実行環境、コマンド、test件数、review所見、未解決blockerを本文へ記録する。
10. **wave統合:** 出力が重ならないtaskだけworktreeで並列化し、mainへ依存順に統合。統合test後、cleanな一時worktree/branchだけ削除する。

状態遷移は`TODO → IN_PROGRESS → TESTED → ADVERSARIAL_REVIEW → FIXING（必要時）→ REVALIDATED → VERIFIED`。外部条件不足は`BLOCKED`のままにする。

## 6. Gate順序

| Gate | 実行時点 | 合格条件 | 停止条件 | 出典 |
|---|---|---|---|---|
| Phase B closure | H0→B-GATE初回→必要ならC0→B-GATE再実行 | clean lock install、Node/Python test、3 entry build、local window、review証拠 | lock/tool再現不可 | [S-CONTRIB §8][S-IP §4] |
| Gate 1 | SPI-18 | Windows/macOS双方のSQLite、onedir、installer resource、Reference、pipe、ORT、Konva実測 | native Mac未実施またはPoC不合格 | [S-IP §6, Phase C] |
| Gate 2 | SPI-18 | 分類/検出C6/C7の法務・hash・品質・実機承認、AutoML budget実測 | unknown/不承認model、budget未実測 | [S-IP §6][S-DEP §§3,6,12] |
| Gate 3 | ANN-27/28、ANN-22後 | Project→Import→Annotation→immutable Revision→Queued Runを両OSで実証 | 片OSのみ、未確認item混入 | [S-IP §6][S-ADR2 §§3.3〜3.6] |
| Gate 4 | H/I/I.1/J/K完了後 | Initial/Project assist、train→ONNX parity→Model Version→report→cameraが分類/検出双方で成立 | model/OS/性能条件未達 | [S-IP §6] |
| Gate 5 | FIN-07 | 署名installer、offline clean install、servicing、SBOM、全必須要求、guideが合格 | 必須1件でも未達 | [S-IP §6, FIN-07][S-ADR3 §6] |

## 7. Phase C — 高リスクPoC（19件）

**開始条件:** H0、B-GATE、C0がCLOSED。PoC codeは`spikes/`へ隔離し、実測前の採用断定をしない。[S-IP §§4.4,7 Phase C]

**wave:** C1=`SPI-01,02,08,10,11,12,13,14,19`、C2=`SPI-03,04,07,15,16,17`（各依存成立後）、C3=`SPI-05,06,09`、C4=`SPI-18`単独。

| ID | 実装成果物 | 正本依存 | 実装・検証完了条件 |
|---|---|---|---|
| SPI-01 | `spikes/sqlite/main.ts`, `smoke.test.ts`, `README.md` | B-05 | C0で承認・lockした`better-sqlite3`をElectron dev/package双方でCRUDし、native binary/hash/packaging可否を記録してD-03を判定。[P10] |
| SPI-02 | `spikes/worker/main.ts`, `worker.py`, `README.md` | B-12 | versioned JSON入力、NDJSON progress、stderr診断、exit/cancelを実processで検証。HTTP/RPCを作らない。[S-ADR1 §2.5] |
| SPI-03 | `ml/packaging/worker-windows.spec`, `spikes/packaging/windows-result.md` | SPI-02, A-10 | clean Windows/no PythonでPyTorch・Optuna・ORT import、health、CPU実行。利用可能時だけCUDA/DirectMLも測り、size/cold start/PE一覧を実値記録。[P05] |
| SPI-04 | `ml/packaging/worker-macos.spec`, `spikes/packaging/macos-result.md` | SPI-02, A-10 | native clean Apple Silicon/no Pythonでimport、health、CPU/MPS/CoreML、size/cold start/nested codeを実測。Windows代替禁止。[P05] |
| SPI-05 | `spikes/packaging/electron-builder.windows.yml`, `windows-installer-result.md` | SPI-03 | NSIS EXEへworker directoryを同梱し起動。production configは作らない。[P02][P03] |
| SPI-06 | `spikes/packaging/electron-builder.macos.yml`, `entitlements.mac.plist`, `macos-pkg-result.md` | SPI-04 | native MacでPKG同梱とnested code構造を確認。production configは作らない。[P04] |
| SPI-07 | `spikes/inference/pipe.ts`, `pipe.py`, `pipe-result.md` | SPI-02 | 320/640固定RGBを10Hz送受信しlatency/CPU/memoryを実測。4-byte length、queue条件を証拠化。[S-ADR1 §2.5] |
| SPI-08 | `spikes/inference/provider_probe.py`, `provider-result.md` | B-11 | Windows DirectML/CPU、native macOS CoreML/CPUを別々に実測。未利用providerを利用可と推測しない。[P07][P08] |
| SPI-09 | `spikes/inference/camera.tsx`, `camera-result.md` | SPI-07, SPI-08 | queue=1/dropと30分基礎測定。OS/hardware別に実値だけ記録。[S-RD FR-INF-007〜011] |
| SPI-10 | `spikes/annotation/CanvasSpike.tsx`, `.test.tsx`, `result.md` | B-07 | C0で承認・lockしたcanvas依存で4K+100 boxのcreate/select/move/resize/zoomを操作・性能実測。[P06] |
| SPI-11 | `docs/model-governance/classification-base.md` | A-06 | classification C6のcode/checkpoint/data/terms/intended use/redistribution/hashを一次資料で全knownにする。unknownは却下/保留。[S-DEP §6.1] |
| SPI-12 | `docs/model-governance/detection-base.md` | A-06 | detection C6をSPI-11と同じfail-closed基準で監査。[S-DEP §6.1] |
| SPI-13 | `docs/model-governance/classification-assist.md` | A-06 | classification C7候補を一次資料、取得日、保存hash、品質で判定。承認ありきにしない。[S-DEP §6.2] |
| SPI-14 | `docs/model-governance/detection-assist.md` | A-06 | detection C7候補を同基準で判定。[S-DEP §6.2] |
| SPI-15 | `spikes/models/classification.py`, `classification-result.md` | SPI-11, SPI-08 | 権利確認済み小fixtureでtrain→ONNX→CPU parity、候補budgetを実測。fixture権利証拠を残す。 |
| SPI-16 | `spikes/models/detection.py`, `detection-result.md` | SPI-12, SPI-08 | 同条件でbox/score/label、mAP差、runtimeを実測。 |
| SPI-17 | `spikes/models/assist_benchmark.py`, `assist-result.md` | SPI-13, SPI-14 | gold setでcoverage/accept/edit/reject/timeをmanual-onlyと比較。accuracyを推測しない。 |
| SPI-18 | `docs/adr/0004-spike-decisions.md`, `resources/models/manifest.json` | A-07, SPI-01〜17, SPI-19 | 全結果の採否、hardware、実測、未解決を記録。承認済みmodelだけmanifestへ追加し、Gate 1/2をPASSまたは停止判定。 |
| SPI-19 | `spikes/reference/reference-access.ts`, `windows-result.md`, `macos-result.md` | B-05, D-19 | 両OSで選択→再起動→read/hash、変更/消失/relinkを実測し、参照元へのwrite/delete 0を確認。片OSだけなら未完。[S-ADR2 §3.2] |

## 8. Phase D — App core / Project / 診断（15件）

**開始条件:** Gate 1 PASS。[S-IP §6, §7 Phase D]

**wave:** D1=`CORE-01,11` → D2=`CORE-02,12` → D3=`CORE-03,14` → D4=`CORE-04` → D5=`CORE-05` → D6=`CORE-06` → D7=`CORE-07,10` → D8=`CORE-08,09` → D9=`CORE-13` → D10=`DOC-01`。

| ID | 実装成果物 | 依存 | 実装・検証完了条件 |
|---|---|---|---|
| CORE-01 | `src/main/paths.ts`, `.test.ts` | Gate 1 | OS user-data配下のproject/cache/log pathだけを定義し、absolute/境界/作成責務をtest。 |
| CORE-02 | `src/main/db/database.ts`, `.test.ts` | SPI-01, CORE-01 | SQLite open/close、foreign key、WAL、Main single-writer lifecycleを実DBで検証。[S-ADR1 §2.7] |
| CORE-03 | `src/main/db/migrate.ts`, `.test.ts` | CORE-02 | version順・transaction・失敗rollback・再実行を検証。 |
| CORE-04 | `src/main/db/migrations/001_core.sql`, `schema.test.ts` | CORE-03 | projects/settingsの最小schema、constraint、migrationを実DBで確認。 |
| CORE-05 | `src/shared/contracts/project.ts`, `.test.ts` | CORE-04 | UUID/name/taskType runtime validationと境界caseを固定。 |
| CORE-06 | `project-repository.ts`, `project-service.ts`, `.test.ts` | CORE-05 | CRUD、重複/不存在、初回Run後taskType lockを検証。 |
| CORE-07 | `project-handlers.ts`, `project-api.ts`, `project-ipc.ts`, handler test | CORE-06 | narrow IPC、sender+schema validation、任意path/raw IPC非公開を検証。 |
| CORE-08 | `ProjectListPage.tsx`, `.test.tsx` | CORE-07 | UI-02のlist/search/statusを実DTOのみで表示し、keyboard操作をtest。 |
| CORE-09 | `ProjectForm.tsx`, `.test.tsx` | CORE-07 | create/edit、日本語validation、taskType lock表示をtest。 |
| CORE-10 | `delete-preview.ts`, `DeleteProjectDialog.tsx`, backend test | CORE-06 | owned/referenceを区別した件数・容量preview。参照元を削除対象にしない。[S-ADR2 §3.8] |
| CORE-11 | `probe_hardware.py`, `cli.py`, Python test | B-12, SPI-08 | allowlist commandでOS/CPU/RAM/disk/CUDA/MPS/ORT providerをJSON。cameraを開かず、取得不能を推測しない。 |
| CORE-12 | diagnostics service/IPC/UI、service test | CORE-11, SPI-02 | UI-01に非対応/CPU可/推奨と理由を実値表示。worker/IPC failureをtest。 |
| CORE-13 | `tests/e2e/project-crud.spec.ts`, fixture | CORE-08〜10 | create/edit/delete/restart persistenceとProject非干渉を実Electron E2E。 |
| CORE-14 | `power-thermal.ts`, `PowerWarning.tsx`, backend test | CORE-12 | OSで取得できたbattery/thermalだけ表示。取得不能時に状態を捏造しない。 |
| DOC-01 | `docs/users-guide.md` | A-08, CORE-12〜14 | 実装・実測済みProject/診断画面だけを追記し、UI文言と照合。 |

## 9. Phase E — Job runtime（8件）

**wave:** E1=`JOB-01,03` → E2=`JOB-02` → E3=`JOB-04` → E4=`JOB-05` → E5=`JOB-06,07,08`。[S-IP §7 Phase E][S-ADR1 §2.5][S-ADR2 §3.5]

| ID | 成果物 | 依存 | 実装・検証完了条件 |
|---|---|---|---|
| JOB-01 | `002_jobs.sql`, `job.ts`, schema test | CORE-03 | RDで許可した状態だけをschema/typeに定義。 |
| JOB-02 | job repository/state、state test | JOB-01 | 全合法遷移を通し、未定義遷移と終端再開を拒否。 |
| JOB-03 | TS/Python worker contract、Python test | SPI-02 | `schemaVersion`とstarted/progress/warning/completed/failed envelopeを両言語で固定。 |
| JOB-04 | worker supervisor、test | JOB-02, JOB-03 | spawn、JSON入力、NDJSON stdout、stderr、exit、artifact path境界を実child processで確認。 |
| JOB-05 | job service/IPC/preload、test | JOB-04 | progress購読、unsubscribe、明示cancel、猶予後強制終了を検証。 |
| JOB-06 | recovery、test | JOB-05 | Running→Interrupted、Exporting/Evaluating→Failed、Cancelled非再開を検証。 |
| JOB-07 | training queue、test | JOB-05 | 同時1件FIFO。汎用schedulerを作らない。 |
| JOB-08 | status bar/page、UI test | JOB-05 | queue/progress/current/cancel可否を日本語・keyboardで表示。 |

## 10. Phase F — Data import（16件）

**wave:** F1=`DAT-01,06,12,13` → F2=`DAT-02,07` → F3=`DAT-03,04,05,11,14` → F4=`DAT-08` → F5=`DAT-09,15` → F6=`DAT-10` → F7=`DOC-02`。[S-IP §7 Phase F][S-RD FR-DAT][S-ADR2 §3.2]

| ID | 成果物 | 依存 | 実装・検証完了条件 |
|---|---|---|---|
| DAT-01 | import contract、`scan_dataset.py`, `cli.py`, Python test | JOB-03, CORE-11 | versioned input/output schemaと`scan-dataset` allowlistを固定。 |
| DAT-02 | `image_scan.py`, test | DAT-01 | extension+magic、SHA-256、duplicate、unsupportedをfixtureで分類。 |
| DAT-03 | `image_decode.py`, test | DAT-02 | EXIF orientation、broken/animated、pixel/byte上限を検証。metadata値はログへ出さない。 |
| DAT-04 | classification importer、test | DAT-02 | unlabeled/folder/UTF-8 CSVをlosslessにparseしinvalid rowを報告。 |
| DAT-05 | COCO importer、test | DAT-02 | image/category/bbox、unknown参照、invalid itemを報告。 |
| DAT-06 | `copy-source.ts`, test | CORE-01 | temp copy→hash→atomic commit。元fileを変更しない。 |
| DAT-07 | `003_import.sql`, repository、test | DAT-01, CORE-03 | source manifest、scan result、rights/mode参照を永続化。 |
| DAT-08 | service/IPC/preload、test | DAT-04〜07, DAT-11〜13, JOB-04 | picker→scan→rights→capacity→copy/reference→workspaceを失敗atomicに統合。 |
| DAT-09 | ImportPage/Summary、UI test | DAT-08 | UI-04、Error/Warning、mode/rights確認を表示。 |
| DAT-10 | classification/detection E2E | DAT-09 | folder/CSV/COCO/unlabeled、broken、容量不足、rights未確認、Reference restart/relink。 |
| DAT-11 | capacity preflight、test | DAT-02, CORE-01 | source+derived+temp+20%を計算し、不足時は書込前停止。[S-RD NFR-STO-001] |
| DAT-12 | reference source、test | SPI-19, CORE-01 | absolute path、file identity、size、mtime、SHA-256、restart validation/relink。参照元非変更。 |
| DAT-13 | rights backend/UI、backend test | CORE-06 | Project初回取込で確認日時保存。法的権利を保証する文言にしない。 |
| DAT-14 | image protocol/safe-path、test | DAT-06, DAT-12 | Project allowlist内の検証済み画像だけread-only配信。encoded traversal、symlink/junction、任意pathを拒否。 |
| DAT-15 | Windows/macOS manual picker記録 | DAT-08, SPI-19 | 署名前packageでnative picker、multi/folder/cancel、restart Reference/relinkを両OS別記録。 |
| DOC-02 | `docs/users-guide.md` | DOC-01, DAT-10, DAT-15 | Copy/Reference、capacity、rights、format、修正/relinkを実画面に合わせて追記。 |

## 11. Phase G — Label Schema / Annotation / Dataset Revision（29件）

**wave:** G1=`ANN-01` → G2=`ANN-02` → G3=`ANN-03,05` → G4=`ANN-04,06` → G5=`ANN-07,08` → G6=`ANN-09,11` → G7=`ANN-10,12,23,25` → G8=`ANN-13` → G9=`ANN-14,24` → G10=`ANN-15,26` → G11=`ANN-16,17` → G12=`ANN-18` → G13=`ANN-19` → G14=`ANN-20,21` → G15=`ANN-22` → G16=`ANN-27,28` → G17=`DOC-03`。[S-IP §7 Phase G][S-ADR2 §§3.3〜3.7]

| ID | 成果物 | 依存 | 実装・検証完了条件 |
|---|---|---|---|
| ANN-01 | `004_annotations.sql`, schema test | DAT-07 | schema/workspace/item/revision/provenance tableとconstraint。 |
| ANN-02 | annotation contract/test | ANN-01 | state、provenance、classification/rectangle discriminated union。 |
| ANN-03 | label repository/service/test | ANN-02 | UUID、Unicode name/normalization、alias、初回学習後lock。 |
| ANN-04 | label IPC/preload/UI/test | ANN-03 | UI-09 CRUD、例/説明、validation、keyboard。 |
| ANN-05 | workspace repository/service/test | ANN-02 | mutable workspaceとpast revision不変性を分離。 |
| ANN-06 | annotation IPC contract/handlers/test | ANN-05 | paging/query/save schemaとsenderを検証。 |
| ANN-07 | AnnotationPage/Gallery/UI test | ANN-06, DAT-14 | safe protocol lazy thumbnail、state filter、前後移動。 |
| ANN-08 | draft hook/test、save backend | ANN-06 | 1秒以内保存開始、current image undo/redo、failure状態。 |
| ANN-09 | ClassificationEditor/test | ANN-04, ANN-08 | exactly one class、replace/clear/exclude。 |
| ANN-10 | bulk/distribution/test | ANN-09 | multi-select apply、count、少数/偏りwarning。 |
| ANN-11 | DetectionCanvas、coordinates、test | SPI-10, ANN-08 | image pixel↔view transform、zoom/panをround-trip検証。 |
| ANN-12 | RectangleLayer/test | ANN-11 | create/select/delete、pointer/keyboard境界。 |
| ANN-13 | Transformer/test | ANN-12 | move/resize、finite、min size、clamp、元pixel座標保存。 |
| ANN-14 | RegionList/NoObject/test | ANN-13, ANN-04 | class変更、対象物なし、未着手を別状態にする。 |
| ANN-15 | validator/test | ANN-09, ANN-14 | schema外、分類0/複数、nonfinite/zero/outside boxをblock。 |
| ANN-16 | provenance/test | ANN-15 | manual/import-unmodified/import-edited/model-accepted/model-editedを正しく記録。 |
| ANN-17 | split worker/test | ANN-15 | fixed seed、stratification、同一hashのsplit leakage防止。 |
| ANN-18 | revision manifest writer/test | ANN-15〜17 | confirmedのみをtemp→hash→atomic rename。unconfirmed/pending suggestion 0。 |
| ANN-19 | revision repository/service/test | ANN-18 | immutable revision、lineage、許可された`lastVerifiedAt`だけ更新。 |
| ANN-20 | clone workspace/test | ANN-19 | revision clone、hash dedupe、元revision非変更。 |
| ANN-21 | ConfirmDatasetDialog/test | ANN-15, ANN-19 | Error時block、件数/provenance/未処理候補を表示。 |
| ANN-22 | confirm-and-queue/test | ANN-21, JOB-07 | revision commit後5秒以内にQueued。worker未実装でも状態atomic。 |
| ANN-23 | LabelPicker/recent hook/test | ANN-09 | 検索、最近使用、数字shortcutをmouse/keyboardで実行。 |
| ANN-24 | RectangleCommands、duplicate warning、test | ANN-13 | 複製、全選択、keyboard、高重複warning。 |
| ANN-25 | instructions UI/test | ANN-04, ANN-11 | Project固有occlusion/端切れ/極小/曖昧境界方針を常時参照。 |
| ANN-26 | item actions/save status/test | ANN-07〜09, ANN-14 | 除外理由とsaving/saved/failedを表示しkeyboard操作。 |
| ANN-27 | classification E2E/fixture | ANN-10, ANN-22, ANN-23, ANN-26 | POC-14を通し、revision manifestとqueueを照合。 |
| ANN-28 | detection E2E/fixture | ANN-14, ANN-22, ANN-24〜26 | POC-15を通し、negative/rectangle/validationを照合。 |
| DOC-03 | `docs/users-guide.md` | DOC-02, ANN-27, ANN-28 | Label Schema、分類、rectangle、shortcut、instruction、対象物なし、確定を追記。 |

**Gate 3:** ANN-27/28とANN-22の縦スライスをWindows/macOS双方で通す。片OSなら`PARTIAL`。[S-IP §6]

## 12. Phase H — Initial Annotation Assist（22件）

**開始条件:** Gate 2とGate 3 PASS。AST-08はここでは実行せず、TRN-21後のPhase I.1へ送る。[S-IP §7 Phase H]

**wave:** H1=`AST-01,02` → H2=`AST-03,04` → H3=`AST-05,06,07` → H4=`AST-09,11,18,19` → H5=`AST-10,12,15,20` → H6=`AST-13,16,21` → H7=`AST-14` → H8=`AST-22` → H9=`DOC-04`。AST-08はdeferred。

| ID | 成果物 | 依存 | 実装・検証完了条件 |
|---|---|---|---|
| AST-01 | manifest loader/test | SPI-18 | schema、local path、SHA-256、approval、task/supportをfail-closed検証。 |
| AST-02 | `005_suggestions.sql`, contract/test | ANN-01 | set/version/decision/rawScore/provenanceをGround Truthと別保存。 |
| AST-03 | suggestion repository/service/test | AST-02 | output不変、decisionだけ可変、set比較。 |
| AST-04 | worker contract、`assist.py`, `cli.py`, Python test | JOB-03, AST-02, DAT-01 | task別schemaと`assist` allowlist。DBを書かない。 |
| AST-05 | classification assist/test | AST-01, AST-04, Gate 2 | approved modelだけで既存Schema top-3。score意味を捏造しない。 |
| AST-06 | label-name candidates/test | AST-01, AST-04, Gate 2 | 新規名を別候補にしSchemaへ自動追加しない。 |
| AST-07 | detection assist/test | AST-01, AST-04, Gate 2 | approved modelだけでbox/class/raw score。 |
| AST-08 | project model worker/test | AST-04, TRN-21 | **deferred:** Succeeded Model Versionのみ、task/schema一致、version/hash出力。Phase I.1で実行。 |
| AST-09 | assist service/IPC/preload/test | AST-03〜07, JOB-05 | initial auto queue、disable/cancel、model/hash、OOM batch縮小/CPU fallback。 |
| AST-10 | job page/test | AST-09 | UI-11 progress/device/ETA/failureを実値表示。 |
| AST-11 | panel/overlay/test | AST-03, ANN-11 | Ground Truthと色/線/badge/visibilityをデータ/UI双方で分離。 |
| AST-12 | decision hook/test、apply backend | AST-11 | accept/edit/rejectは個別にdraftへcopy。自動/一括承認なし。 |
| AST-13 | confirmation gate/test | AST-12, ANN-21 | 全候補処理+画像明示確認までRevisionへ入れない。 |
| AST-14 | regeneration/test | AST-09, AST-13 | confirmedを上書きせず新setをversion比較。 |
| AST-15 | high-risk labels/test | AST-06 | 要求された属性だけblock/warn。汎用content safetyを作らない。 |
| AST-16 | assist report aggregation/test | AST-03, AST-12 | coverage/accept/edit/rejectを集計。accuracy捏造禁止。 |
| AST-18 | determinism/test | AST-05, AST-07 | image/checkpoint/prompt/preprocess/threshold/seed同一で同候補。残る非決定性をmanifestへ。 |
| AST-19 | threshold policy/test | AST-01, AST-05, AST-07 | PoCで固定したmodel別policyのみ。scoreなしmodelへconfidenceを生成しない。 |
| AST-20 | classification similarity/test | AST-05, AST-18 | 確認済みembeddingで類似順index。Ground Truth/元順序非変更。 |
| AST-21 | SimilaritySort/test | AST-20, ANN-07 | 類似順/元順切替、件数/偏りを隠さない。未実装ならGate 4 waiver。 |
| AST-22 | classification/detection assist E2E | AST-10〜15, AST-18〜21 | POC-16、unconfirmed 0、offline、version/hash/provenance、決定性。 |
| DOC-04 | `docs/users-guide.md` | DOC-03, AST-22 | 候補限界、score意味、確認、類似順を実装どおり追記。 |

## 13. Phase I — Training / AutoML / Model Version（32件）

**開始条件:** Gate 2/3 PASS。分類・検出はshared contract固定後だけ並列化。[S-IP §7 Phase I][S-ADR2 §§3.4〜3.6]

**wave:** I1=`TRN-01,02,09` → I2=`TRN-03,06,28` → I3=`TRN-04,05,07,08` → I4=`TRN-16,17,25,26` → I5=`TRN-10,11,18,19` → I6=`TRN-12,13,27` → I7=`TRN-14` → I8=`TRN-15,20` → I9=`TRN-21,30` → I10=`TRN-22,31` → I11=`TRN-29` → I12=`TRN-32,33` → I13=`DOC-05`。

| ID | 成果物 | 依存 | 実装・検証完了条件 |
|---|---|---|---|
| TRN-01 | revision materializer/test | ANN-19, DAT-12 | confirmed Ground Truthをmaterializeし、開始前・epoch/trial境界でReference hash再検証。不一致で安全停止。 |
| TRN-02 | runtime/test | CORE-11 | CPU/CUDA/MPS選択、seed/version記録、fallbackを実providerだけで検証。 |
| TRN-03 | classification dataset/test | TRN-01 | preprocess/augmentationとsingle class invariant。 |
| TRN-04 | classification trial/test | TRN-02, TRN-03, Gate 2 | approved selected modelだけで1 trial。 |
| TRN-05 | classification metrics/test | TRN-03 | accuracy/balanced/macro/micro/class-wise/confusionを既知fixtureで検算。 |
| TRN-06 | detection dataset/test | TRN-01 | box/class/negative sample、coordinate境界。 |
| TRN-07 | detection trial/test | TRN-02, TRN-06, Gate 2 | approved selected modelだけで1 trial。 |
| TRN-08 | detection metrics/test | TRN-06 | mAP50:95/AP50/AP75/class-wise/PRを既知fixtureで検算。 |
| TRN-09 | policies/test | SPI-15〜18, D-15 | 実測済み有限budget/search spaceだけをversion化。unused optionなし。 |
| TRN-10 | classification Optuna/test | TRN-04, TRN-05, TRN-09 | TPE+pruning、全parameter/中間値をreport。 |
| TRN-11 | detection Optuna/test | TRN-07〜09 | 同上、検出固有searchだけ。 |
| TRN-12 | budget/test | TRN-10, TRN-11 | wall-clock、mini-run estimate、prune reason。固定SLAを捏造しない。 |
| TRN-13 | checkpoint/test | TRN-10, TRN-11 | epoch/trial境界、code/checkpoint/revision一致のInterruptedだけresume、Cancelled不可。 |
| TRN-14 | `train.py`, `cli.py`, test | AST-04, TRN-10〜13, TRN-25〜28 | `train` allowlist、task dispatch、baseline/選定理由/分類済みfailureを返す。 |
| TRN-15 | training service/IPC/preload/test | TRN-14, JOB-07 | queue/cancel/resume/progressをMainで統合。 |
| TRN-16 | classification ONNX/test | TRN-04 | fixed shape FP32、pre/postprocess metadata。 |
| TRN-17 | detection ONNX/test | TRN-07 | fixed shapeとoutput schema/coordinate意味を固定。 |
| TRN-18 | classification parity/test | TRN-05, TRN-16 | FR-TRN-018 thresholdを実測し、超過RunはFailed。 |
| TRN-19 | detection parity/test | TRN-08, TRN-17 | mAP差を実測し、超過RunはFailed。 |
| TRN-20 | `006_training.sql`, model repository/test | TRN-18, TRN-19 | version/parent/revision/hash/license immutability。Succeeded以外を拒否。 |
| TRN-21 | atomic commit/test | TRN-20 | artifact hash後のrename+1 transaction。SucceededのみModel Version生成。 |
| TRN-22 | additional training/test | ANN-20, TRN-21 | base version明示、class schema一致、親非変更。 |
| TRN-25 | classification scratch baseline/test | TRN-04 | scratchとFine-Tuningを同split/budgetで比較し採否理由記録。 |
| TRN-26 | detection scratch baseline/test | TRN-07 | 同上。 |
| TRN-27 | best selection/test | TRN-10, TRN-11 | validation指標、同等時latency→size→stability。test splitを選定に使わない。 |
| TRN-28 | failure classification/test | TRN-02 | unsupported/OOM/disk/read分類、batch縮小1回、CPU/軽量候補、retry可否。 |
| TRN-29 | AdditionalTraining UI/test | TRN-22 | 同一Project成功版からbaseを明示選択しschema不一致block。 |
| TRN-30 | delete service/IPC/test | TRN-20 | 使用中/親版依存preview、子artifact/lineageを壊さない。 |
| TRN-31 | model preload/Delete dialog/test | TRN-30 | narrow IPCで依存表示・明示確認。 |
| TRN-32 | classification E2E/fixture | TRN-15,18,21,25,27〜29 | revision→v1→追加学習v2、baseline、failure表示。 |
| TRN-33 | detection E2E/fixture | TRN-15,19,21,26〜29 | revision→ONNX→version、baseline、failure表示。 |
| DOC-05 | `docs/users-guide.md` | DOC-04, TRN-31〜33 | auto start、budget、baseline、cancel/resume、追加学習、版削除を追記。 |

## 14. Phase I.1 — Project Model Assist（3件）

**直列:** `AST-08 → AST-23 → AST-24 → DOC-10`。AST-08はPhase Hでは未実行。[S-IP §7 Phase I.1]

| ID | 成果物 | 依存 | 実装・検証完了条件 |
|---|---|---|---|
| AST-23 | project-model service、selector UI、backend test | AST-08, AST-09, AST-19, TRN-21 | 最新Succeeded版既定、別成功版選択、validation threshold、task/schema一致、未確認画像のみ再生成。 |
| AST-24 | classification/detection E2E | AST-14, AST-23 | POC-17、version/hash/provenance、confirmed Ground Truth非上書き。 |
| DOC-10 | `docs/users-guide.md` | DOC-05, AST-24 | 既定版、版選択、再生成対象、threshold由来を追記。 |

## 15. Phase J — Training status / Report（12件）

**wave:** J1=`REP-11,01,02,03` → J2=`REP-04,05,06,07,08,09` → J3=`REP-10` → J4=`DOC-06`。[S-IP §7 Phase J]

| ID | 成果物 | 依存 | 実装・検証完了条件 |
|---|---|---|---|
| REP-11 | Node lock、dependency policy | A-05, B-01, D-13 | current一次資料/license/bundle/accessibilityを比較しchart依存を1つだけ採用。native SVGで足りれば追加なし。 |
| REP-01 | TrainingRunPage/test | TRN-15 | state/trial/epoch/metric/elapsed/ETA/deviceを実値表示。 |
| REP-02 | versions page/compare/test | TRN-20 | metric/size/latency/revision/parent比較。欠測を推測しない。 |
| REP-03 | report service/IPC/preload/test | TRN-20 | read-only DTO、sender/schema、Project isolation。 |
| REP-04 | classification report/test | REP-03, REP-11 | accuracy/balanced/macro/micro/class-wise、loss、confusion。 |
| REP-05 | detection report/test | REP-03, REP-11 | mAP/AP/class AP/precision/recall、PR/loss。 |
| REP-06 | result gallery/overlay/test | REP-03, ANN-11, DAT-12 | top候補、IoU/FP/FN、GT/Prediction、Reference切れ/relink。 |
| REP-07 | TrialTable/test | REP-03 | 全hyperparameterとprune reason。 |
| REP-08 | environment/license/assist tabs/test | REP-03, AST-16 | OS/device/library/seed/time/memory/hash/license/provenanceを実値のみ表示。 |
| REP-09 | export backend/test/button | REP-03 | local JSON/CSV。画像は明示選択時のみ。 |
| REP-10 | classification/detection E2E | REP-04〜09 | UI-06とFR-REPをtask別fixtureで通す。 |
| DOC-06 | `docs/users-guide.md` | DOC-10, REP-10 | metricの読み方とscore≠正解確率を追記。 |

## 16. Phase K — Camera inference（20件）

**wave:** K1=`INF-01,16` → K2=`INF-02` → K3=`INF-17` → K4=`INF-03,18` → K5=`INF-04` → K6=`INF-05` → K7=`INF-06,19` → K8=`INF-07,08,09` → K9=`INF-10` → K10=`INF-11` → K11=`INF-12` → K12=`INF-13` → K13=`INF-14,15` → K14=`DOC-07`。[S-IP §7 Phase K][S-ADR1 §2.5]

| ID | 成果物 | 依存 | 実装・検証完了条件 |
|---|---|---|---|
| INF-01 | permissions/IPC/test | B-05 | app originのvideoだけuser gesture後に許可。その他/audio拒否、OS状態/設定導線/retry。 |
| INF-02 | CameraSelector/test | INF-01 | device list、permission前は不明と正直に表示。 |
| INF-03 | camera stream hook/test | INF-17 | `audio:false`、start/stop/disconnect、2秒以内release。frame/result非保存。 |
| INF-04 | sampler hook/test | INF-03 | monotonic 10Hz、fixed input RGB。偽10Hz禁止。 |
| INF-05 | TS/Python frame protocol/test | SPI-07, INF-04 | length/shape/size/session validation、no base64。 |
| INF-06 | Python stream/test | INF-05, AST-01 | one ORT session、provider→CPU fallback、warm-up、CoreML cacheをmodel hash分離。 |
| INF-07 | Main supervisor/test | INF-06, INF-19 | spawn/write/read/kill、model hash、failure cleanup。 |
| INF-08 | classification postprocess/test | INF-06, TRN-16 | top-3/class/score、metadata一致。 |
| INF-09 | detection postprocess/test | INF-06, TRN-17 | model固有box/class/threshold/逆座標変換。 |
| INF-10 | latest queue/test | INF-07 | in-flight+pending1、古いpending置換、drop count。 |
| INF-11 | page/overlay/test | INF-08〜10 | classification/detection表示、GTとの混同なし。 |
| INF-12 | metrics/error UI/test | INF-11 | actual FPS/p95/drop/provider、fallback/errorを実値表示。 |
| INF-13 | Electron E2E/fake camera | INF-12, INF-16〜19 | model/camera/profile、同意、lifecycle、bridge、queue、overlay、競合選択。[P09] |
| INF-14 | Windows/macOS manual permission | INF-13 | notDetermined/granted/denied/restricted/disconnectを署名packageでOS別記録。 |
| INF-15 | 30分performance記録/template | INF-13 | recommended hardwareでFR-INF-010を30分実測しGate 4入力化。 |
| INF-16 | `007_inference.sql`, profile/test | CORE-03, TRN-21 | Project別成功model/camera/threshold/display設定をvalidateして保存。 |
| INF-17 | InferenceSetup/test | INF-02, INF-16 | 成功版選択、OS prompt前に用途・非保存・停止を説明し明示同意。 |
| INF-18 | contention backend/dialog/test | INF-17, JOB-05 | 同accelerator学習中は開始前warning、学習中断またはCPU推論を明示選択。 |
| INF-19 | IPC/preload/contract/test | INF-04〜05 | app origin、active session、shapeを検証したframeだけMainへ。result/metricsのみ返しraw process非公開。 |
| DOC-07 | `docs/users-guide.md` | DOC-06, INF-14, INF-15, INF-18 | permission、非保存、profile、競合、実測性能warning、停止を追記。 |

**Gate 4:** Phase H、I、I.1、J、Kの分類/検出フローとOS別証拠を判定。未承認modelまたはnative Mac未実施ならPASSにしない。[S-IP §6]

## 17. Phase L — Security / Reliability / Performance（24件）

**開始条件:** Gate 4 PASS。全IPC/全主要UIを対象とするtaskは対象が揃う前に完了させない。[S-IP §7 Phase L]

**wave:** L1=`SEC-01〜08, REL-01〜04, LIC-01, LIC-03, STO-01, ACC-01, UX-01, PERF-01, PERF-02`（個別依存・出力非重複時のみ）→ L2=`LIC-02,STO-02` → L3=`STO-03` → L4=`PERF-03` → L5=`DOC-08`。

| ID | 成果物 | 依存 | 実装・検証完了条件 |
|---|---|---|---|
| SEC-01 | `security.ts`, Renderer HTML、security test | B-05, B-07, Gate 4 | remote/new window/openExternal deny、CSP、spellchecker等暗黙download停止。[P01] |
| SEC-02 | sender validator/test、IPC contract audit | 全IPC | 全channelでsender+schema、raw APIなしを列挙検証。 |
| SEC-03 | path adversarial test | DAT-14 | encoded traversal、junction/symlink、race、Project越境、Reference write/delete拒否。 |
| SEC-04 | decoder/security test | DAT-03 | 実pixel/bytes/decompression-bomb上限policy。 |
| SEC-05 | safe model loader/test | AST-01 | approved ONNX/safetensors/weights-onlyだけ許可しremote code/pickle拒否。 |
| SEC-06 | offline E2E/URL scan | Gate 4 | app outbound 0、source/build URL allowlist。OS機能通信との境界を記録。 |
| SEC-07 | redaction/export/test | JOB-04 | imageなし、username path mask、明示export、事前項目表示。 |
| SEC-08 | TS/Python audit scripts/tests、policy | B-01, B-11 | lock済みTS/Python/native advisory監査。未承認Critical/Highでfail、例外は期限/根拠/責任者。 |
| REL-01 | atomic-write/test | CORE-01 | temp/hash/rename/cleanupとfailure injection。 |
| REL-02 | DB backup/test | CORE-03 | upgrade前backup、migration failure rollback。 |
| REL-03 | crash E2E/fixture | JOB-06, TRN-13 | Interruptedだけresume、metadata非破損。 |
| REL-04 | delete project/test | CORE-10, ANN-19, AST-03 | owned workspace/suggestion/artifact削除、Reference元保持、失敗報告。 |
| LIC-01 | SBOM/license scripts/tests、notice template | A-05 | TS/Python/native/model照合、unknown/禁止licenseでfail。 |
| LIC-02 | LicensesPage/IPC/UI test | LIC-01 | UI-08でSBOM/notices/model provenanceを表示。 |
| LIC-03 | CUDA decision/verify scripts/tests | SPI-03, A-05 | 採用版だけEULA/allowlist照合。不採用なら事実とCPU fallbackを記録。 |
| STO-01 | usage service/test | CORE-01, TRN-20 | Project/Revision/Run/Model/cache実使用量。symlink先Referenceを加算しない。 |
| STO-02 | generated-data delete/test | STO-01, JOB-02 | 再生成cacheとFailed Run一時checkpointだけ依存確認後削除。 |
| STO-03 | StoragePage/test | STO-01, STO-02, LIC-02 | UI-08内訳、delete preview/result、notices導線。 |
| ACC-01 | accessibility E2E/manual | 全主要UI | keyboard、focus、label、screen reader、200%を主要flowでOS別確認。 |
| UX-01 | Japanese UI E2E/manual | 全主要UI | 必須画面/error/permission/reportを日本語化し、色だけに依存しない。 |
| PERF-01 | annotation benchmark/template | ANN-28 | 4K/100 box p95を基準hardwareで実測保存。 |
| PERF-02 | contention benchmark/template | TRN-33, INF-15, INF-18 | warning、training stop/CPU fallback、OOMなしを実測。 |
| PERF-03 | UI benchmark/template | REP-10, STO-03 | metadata操作/画面遷移p95 500msを基準環境で実測。 |
| DOC-08 | `docs/users-guide.md` | DOC-07, SEC-01〜08, REL-03, REL-04, STO-03 | permission、Reference、disk/OOM、cache、diagnosticを実装どおり追記。 |

## 18. Phase M — Self-contained installer / servicing（23件）

**開始条件:** Gate 4 PASS、LIC-03完了、OS lane環境/identityを準備。`electron-builder.yml`はPKG-04→05→06の直列。[S-IP §7 Phase M][S-ADR3]

**wave:** M1=`PKG-01,02,03,09` → M2=`PKG-04` → M3=`PKG-05,16` → M4=`PKG-06` → M5=`PKG-10,17,18` → M6=`PKG-19,20` → M7=`PKG-07,08` → M8=`PKG-11,12` → M9=`PKG-13,21,22` → M10=`PKG-14` → M11=`PKG-15` → M12=`DOC-09`。

| ID | 成果物 | 依存 | 実装・検証完了条件 |
|---|---|---|---|
| PKG-01 | model verifier/test、manifest | AST-01, Gate 2 | `vendor/models/`のapproved hashだけ通しdownloadしない。余剰/欠落拒否。 |
| PKG-02 | Windows spec/build script | SPI-03, LIC-03, Gate 4 | production commands/torch/ORT onedir。承認時だけallowlist CUDA/cuDNN。 |
| PKG-03 | macOS spec/build script | SPI-04, Gate 4 | native arm64 onedir、nested Mach-O列挙。 |
| PKG-04 | common builder config、resource verifier/test | PKG-01 | app/worker/model/noticesを`extraResources`へ。OS固有設定なし。[P03] |
| PKG-05 | shared config Windows節、任意NSIS include | PKG-02, PKG-04 | per-user one-file offline EXE、restartなし。stockで足りれば`.nsh`なし。[P02] |
| PKG-06 | shared config macOS節、entitlements | PKG-03, PKG-05 | `/Applications`、arm64、最小entitlement。共有config固定。[P02][P04] |
| PKG-07 | Windows sign/verify scripts | PKG-09, PKG-10, PKG-19, D-16 | 最終installerと全PEをCA chain+SHA-256/RFC3161 timestamp検証。 |
| PKG-08 | macOS sign/notarize/verify scripts | PKG-09, PKG-10, PKG-20, D-16 | 全nested code、Hardened Runtime、PKG sign、notarize、staple、Gatekeeper。 |
| PKG-09 | version compatibility/test | REL-02 | same version repair、newer拒否、backup migration、failure rollback判定。 |
| PKG-10 | project retention/test | PKG-05, PKG-06, REL-04 | uninstallでapp/runtime削除、Project既定保持。 |
| PKG-11 | Windows clean install script/result | PKG-07, PKG-19 | offline標準user、no Python/Node/CUDA、restartなし、15秒基準、Project作成を実測。 |
| PKG-12 | macOS clean install script/result | PKG-08, PKG-20 | offline/no Rosetta/Homebrew/Xcode、Gatekeeper、15秒基準、Project作成を実測。 |
| PKG-13 | OS servicing scripts | PKG-09〜12 | upgrade/repair/forced rollback/uninstallを両OS実機。 |
| PKG-14 | offline install記録/payload inventory | PKG-11〜13, PKG-21, PKG-22 | stub/download 0、全payload=SBOM/hash、余剰0。 |
| PKG-15 | checksum script/test、release docs | PKG-14 | EXE/PKG命名とSHA-256を生成・再検証。 |
| PKG-16 | size generator/schema/test | PKG-04 | OS別圧縮/展開/temp+10%を実測しpreflight manifest生成。 |
| PKG-17 | NSIS preflight/test | PKG-06, PKG-16 | OS/arch/disk/write/same-old-new versionを変更前検査し日本語停止。 |
| PKG-18 | macOS preinstall/test | PKG-06, PKG-16 | OS/arm64/disk/write/versionをinstall前検査し日本語停止。 |
| PKG-19 | Windows messages/UX test | PKG-09, PKG-17 | 日本語progress/error/completion、Start menu、任意起動、privacy-safe log、servicing導線。 |
| PKG-20 | macOS postinstall/UX test | PKG-09, PKG-18 | Installer.app日本語説明、Applications起動、privacy-safe log、servicing、Terminal操作不要。 |
| PKG-21 | payload compare/result | PKG-11, PKG-12 | version/schema/model/feature/notices一致、OS binary差だけ許可。 |
| PKG-22 | installer accessibility manual | PKG-19, PKG-20 | keyboard/screen readerでpreflight/error/progress/completion/uninstall案内。 |
| DOC-09 | `docs/users-guide.md` | DOC-08, PKG-11〜22 | OS別に実測済みinstall/repair/upgrade/rollback/uninstallだけ追記。 |

## 19. Phase N — Final acceptance（7件）

**wave:** N1=`FIN-01,03,04` → N2=`FIN-02,05,06`（各依存成立後）→ N3=`FIN-07`。[S-IP §7 Phase N]

| ID | 成果物 | 依存 | 実装・検証完了条件 |
|---|---|---|---|
| FIN-01 | `docs/traceability.md` | 全feature test | 229 requirement→task→test→OS/statusを1件ずつ照合。根拠なし対応済み禁止。 |
| FIN-02 | `docs/test-matrix.md` | FIN-01 | Windows/macOS、CPU/accelerator、manual/automatedと未実施を整理。 |
| FIN-03 | `docs/acceptance-report.md` | POC-01〜17相当test | hardware、実測、失敗、waiver、raw evidence参照を記録。 |
| FIN-04 | `docs/users-guide.md` | DOC-01〜10 | UI文言/導線/リンク一致。screenshotは実画面のみ。 |
| FIN-05 | `README.md` | FIN-03, FIN-04 | 概要、対応OS、docs、license/model caveatを実態へ更新。 |
| FIN-06 | `docs/release-checklist.md` | LIC-01〜03, SEC-08, PKG-15, FIN-03 | signing、SBOM、vulnerability、model/CUDA approval、offline、rollbackを証拠リンク付き確認。 |
| FIN-07 | acceptance report/checklist | FIN-01〜06 | Gate 5を判定。必須未達が1件でもあればRelease停止を明記。 |

## 20. 同時編集禁止と並列lane

次は直列化する。[S-IP §§5.1,7]

- `ml/src/autovision_ml/cli.py`: B-12（完了）→ CORE-11 → DAT-01 → AST-04 → TRN-14。
- `docs/users-guide.md`: A-08（完了）→ DOC-01 → DOC-02 → DOC-03 → DOC-04 → DOC-05 → DOC-10 → DOC-06 → DOC-07 → DOC-08 → DOC-09 → FIN-04。
- `resources/models/manifest.json`: A-07（完了）→ SPI-18 → AST-01（read/loader）→ PKG-01。
- `electron-builder.yml`: PKG-04 → PKG-05 → PKG-06。
- migration: `001_core` → `002_jobs` → `003_import` → `004_annotations` → `005_suggestions` → `006_training` → `007_inference`のversion順に統合。
- shared contractを変更するtaskと、そのcontractを読む分類/検出laneを同時実行しない。

安全な並列単位は、依存完了かつ出力file非重複のときだけ、UI / Core / ML-Class / ML-Detect / Release-Windows / Release-macOS / Docs laneに分ける。Docsは実装より先行しない。

## 21. Phase/waveの証拠テンプレート

各task commitまたはPRに次を記録する。[S-CONTRIB §§2.2,5,10]

| 欄 | 必須内容 |
|---|---|
| Task/requirements | task ID、対象FR/NFR、非対象 |
| Baseline | parent commit SHA、依存task/Gate証拠 |
| Environment | OS/build、architecture、CPU/GPU、tool exact version |
| Changes | 正本に列挙されたfileだけ |
| Verification | 実コマンド、exit code、test件数、artifact hash。未実施はNOT_RUN |
| Adversarial review | reviewer/context、指摘、再現、裁定、修正、再検証 |
| External evidence | URL、取得日、document/version、保存copy/hash（必要時） |
| Remaining blockers | OS、model、license、identity、performance |
| Status | VERIFIED / PARTIAL / BLOCKED。推測PASS禁止 |

## 22. 完了条件

次をすべて満たしたときだけ「全残task完了」とする。[S-IP §6, §7 Phase N][S-RD §§12,17][S-ADR3 §6]

1. H0、B-GATE、C0がCLOSED。
2. 正本残230taskが個別にVERIFIEDし、独立敵対レビューがCLOSED。
3. Gate 1〜5がWindows/macOSの必要条件を含めPASS。
4. 229 requirementがtest/manual evidenceへ欠落なくtraceされる。
5. classification/detection双方のannotation、initial/project assist、training、ONNX parity、report、cameraが成立。
6. outbound 0、unconfirmed suggestion 0、unknown license 0、未承認Critical/High 0。
7. Windows x64 EXEとmacOS arm64 PKGが正式署名済み、自己完結、offlineでclean install/servicing済み。
8. SBOM、NOTICE、model manifest、payload inventory、checksumが一致。
9. guide/READMEが実装・実測と一致し、未実装手順や推測値がない。
10. mainへ統合済み、不要worktree/branchなし、working tree clean、remoteまたは検証済みbundleから復元可能。

## 23. 出典一覧

### 23.1 リポジトリ正本・hash

- **[S-RD]** `docs/requirement-definition.md`, 113,025 bytes, SHA-256 `2f1c57da192710ffb2fd764c7e342cf2e9106fa7387be7393133873cc815052f`。要求、PoC、受入条件、一次資料S1〜S55。
- **[S-IP]** `docs/implementation-plan.md`, 96,159 bytes, SHA-256 `d9d4f5f22753c6784d6b69def319bf9ff4df16d27f79f1219a971f40152bec46`。253 task、依存、Gate、traceability、P01〜P16。
- **[S-CONTRIB]** `CONTRIBUTING.md`, SHA-256 `872fc2cd8e17f67dc3eed0ca6c2154d8c75822d986eb2d96fb356a1d7b2e4cdd`。
- **[S-ADR1]** `docs/adr/0001-process-architecture.md`, SHA-256 `ea12c4f2b9c23ff425fcb7acc0ef18987a2621904a1aeb19e48f995475293a87`。
- **[S-ADR2]** `docs/adr/0002-data-lifecycle.md`, SHA-256 `61e3ebf93437afe2890dd74200a26eb7c12b6a1a2583b181dbd2a1cb12b896a1`。
- **[S-ADR3]** `docs/adr/0003-packaging.md`, SHA-256 `0058c3de7e448a325189b3b8695b9e605d664f381c267fe91c9f205734a33721`。
- **[S-DEP]** `docs/dependency-policy.md`, SHA-256 `91e1f8b00bb548f878aaf19c355ef434b04861431d45008e4e9a40fdc70d166e`。
- **[S-MODEL-TEMPLATE]** `docs/model-governance/adoption-template.md`, SHA-256 `f9c25b60fd2e70dd6d3450e0940e8b236eab7109eaa2ec390ef224f128878085`。
- **[S-NODE]** `package.json`, SHA-256 `181ea4362f0f9bd62c1c63f85310b53917711609237638fe1f30e2e869ee2576`。
- **[S-NPMLOCK]** `package-lock.json`, SHA-256 `8e895969c4ef52f21f071718f3b4492b07b37d19e5a5bf61edf7102f32ea3a18`。
- **[S-PY]** `ml/pyproject.toml`, SHA-256 `9bd6ce3ace86432490212b847ca0b16fb7e66fb58d75d68be6257da3f1aea457`。
- **[S-UVLOCK]** `ml/uv.lock`, SHA-256 `d54253bd1bde94622bc0bcc5bfad589bc5e45924d5c2f61bf227206c73fad68a`。
- **[S-USERS]** `docs/users-guide.md`, SHA-256 `2646765891f9f50f050e62ea23cfbde723f6920aa914c1a81f68e9f5505f6ec8`。
- **[S-MANIFEST-SCHEMA]** `resources/models/manifest.schema.json`, SHA-256 `aea75bafe864b36e268f075a6f87b850af585b099f0fd73b9ba2631d25e75ae0`。
- **[S-MANIFEST]** `resources/models/manifest.json`, SHA-256 `7fe41f5bc497d48ffcbbaebaeb5cb02e91dfba0e1a6fe9b66d8cf8928c437a61`。

### 23.2 実測・Git証拠

- **[E-GIT]** 2026-09-03、本書作成前に`git rev-parse HEAD`、`git status --short --branch`、`git log`、`git worktree list --porcelain`、`git branch`、`git rev-list --count origin/main..main`を実行。結果: HEAD `4cec3a9...`、clean、mainのみ、ahead 17。
- **[E-PLAN-STATE]** 2026-09-03、本書初版作成後に`git status --short --branch --untracked-files=all`を実行。結果: `?? work/20260903-0605-TaskExecutionPlan.md`のみ、mainはahead 17。
- **[E-COUNT]** 2026-09-03、`docs/implementation-plan.md`のtask行をID regexでunique抽出。結果: 253、A=10、B=13、残=230。
- **[E-B6]** commit `4cec3a9c8244a95d4a3bfc5eb73ac5e7b82e8850`本文。Node 19/19、typecheck、3 build、Windows Electron smoke、macOS未実施を記録。
- **[E-B13]** commit `3d49e8ce4c26603086f0c1828ebe49aad79b20f8`本文。Windows/CPython 3.14.7でpytest、Ruff 0.16.4、Pyright 1.1.413を実行した過去証拠。ただしRuff/Pyrightは現lockに含まれない。
- **[E-ENV]** 2026-09-03作成PCで`node --version=v24.19.0`、`npm --version=11.17.0`、`python --version=3.12.10`、`uv --version=0.12.9`を実行。
- **[E-LOCK-AUDIT]** 2026-09-03、`package-lock.json`と`ml/uv.lock`を検索。Phase C候補依存およびRuff/Pyrightの必要entryなし。lock追加版は未決定。

### 23.3 外部一次資料URL（task実行時に再確認）

- **[P01]** Electron Security: https://www.electronjs.org/docs/latest/tutorial/security
- **[P02]** electron-builder NSIS / PKG: https://www.electron.build/nsis.html , https://www.electron.build/pkg.html
- **[P03]** electron-builder Application Contents: https://www.electron.build/contents.html
- **[P04]** electron-builder macOS signing/notarization: https://www.electron.build/code-signing-mac.html
- **[P05]** PyInstaller operating mode / OS support: https://pyinstaller.org/en/stable/operating-mode.html , https://pyinstaller.org/en/stable/usage.html#supporting-multiple-operating-systems
- **[P06]** Konva selection/bounds: https://konvajs.org/docs/select_and_transform/Basic_demo.html , https://konvajs.org/docs/sandbox/Limited_Drag_And_Resize.html
- **[P07]** ONNX Runtime DirectML EP: https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html
- **[P08]** ONNX Runtime CoreML / Node binding: https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html , https://onnxruntime.ai/docs/get-started/with-javascript/node.html
- **[P09]** Playwright Electron: https://playwright.dev/docs/api/class-electron
- **[P10]** better-sqlite3 repository/license: https://github.com/WiseLibs/better-sqlite3 , https://github.com/WiseLibs/better-sqlite3/blob/master/LICENSE
- **[P11]** uv project/lock/sync: https://docs.astral.sh/uv/concepts/projects/layout/ , https://docs.astral.sh/uv/concepts/projects/sync/
- **[P12]** Microsoft Windows Installer best practices: https://learn.microsoft.com/windows/win32/msi/windows-installer-best-practices
- **[P13]** Apple packaging: https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution
- **[P14]** Zod docs/license: https://zod.dev/ , https://github.com/colinhacks/zod/blob/main/LICENSE
- **[P15]** Vitest docs/license: https://vitest.dev/ , https://github.com/vitest-dev/vitest/blob/main/LICENSE
- **[P16]** React Testing Library docs/license: https://testing-library.com/docs/react-testing-library/intro/ , https://github.com/testing-library/react-testing-library/blob/main/LICENSE

---

**別環境での次の最小作業:** H0で本書を含む`<HANDOFF_COMMIT>`（またはcode bundle + 本書hash）を取得・照合し、B-GATEをclean環境で実行する。Ruff/PyrightまたはPhase C依存のlock不足が再現した場合はPASSにせず、C0の計画変更・一次資料確認・exact lock・独立レビューを先に閉じる。
