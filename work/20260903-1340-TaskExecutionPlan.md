# AutoVision Studio 残230タスク実行・移送計画

| 項目 | 値 |
|---|---|
| 作成日 | 2026-09-03 |
| 対象 | Version 1（MVP）の未完了正本タスク |
| 対象branch | `main` |
| 本書作成直前のcode baseline | `fff9df2a79e144ac8fea57d4269edccd6045b8c4` [E-GIT] |
| 本書を含むhandoff commit | 本書自身へSHAを埋めると自己参照になるため、移送時に`git log -1 --format=%H -- work/20260903-1340-TaskExecutionPlan.md`で取得する [E-GIT] |
| 作成時remote | `origin/main = e8b03f12a0fe3a06677a1bc78fc8f179009cb210`、baselineは7 commit先行 [E-GIT] |
| 要求正本 | `docs/requirement-definition.md` v0.3 Draft、SHA-256 `2F1C57DA192710FFB2FD764C7E342CF2E9106FA7387BE7393133873CC815052F` [S-RD] |
| タスク正本 | `docs/implementation-plan.md` v0.2 Draft、SHA-256 `80FF81B3550BBB935CB7BEDD59B5A20A832E340409F7D0762C14F58FD859BFE8` [S-IP] |
| 正本タスク | 253件、ID重複0 [E-COUNT] |
| 完了済み | 23件（A-01〜A-10、B-01〜B-13）[E-A][E-B] |
| 残タスク | **230件（Phase C〜N）** [E-COUNT] |
| 管理checkpoint | C0-PLAN / C0-NODE / C0-PYTHON / C0-REVIEWは正本253件に含めない。全てCLOSED [S-C0] |
| 現在の開始点 | Windows B-GATE PASS。Phase CのWindows/OS非依存taskのみ開始可能 [S-C0] |

> **捏造禁止境界:** 実行していないtest、macOS動作、model承認、署名、性能値、所要時間、成果物をPASSまたは実装済みと記載しない。`PASS`は保存済み実行証拠がある場合だけ、未実施は`NOT_RUN`、外部条件不足は`BLOCKED`、片OSだけは`PARTIAL`とする。[S-CONTRIB §§2,5,7,10][S-RD §§15〜16]

## 1. 正本・引用・変更管理

### 1.1 優先順位

矛盾時は次の順で解決する。[S-IP §§1,4][S-CONTRIB §§3〜5]

1. `docs/requirement-definition.md` [S-RD]
2. `docs/implementation-plan.md` [S-IP]
3. ADR-0001〜0003 [S-ADR1][S-ADR2][S-ADR3]
4. `docs/dependency-policy.md`、C0採用記録、`CONTRIBUTING.md` [S-DEP][S-C0][S-CONTRIB]
5. 本書

上位正本を変更する必要がある場合は、理由、影響requirement、task/DAG、test、敵対レビューを記録した計画変更commitを先に作る。本書だけで上位要求を上書きしない。[S-IP §4.4][S-CONTRIB §§3,5]

### 1.2 引用規則

- 各task行の名称、成果物、依存、完了条件は`docs/implementation-plan.md` §7を直接出典とする。[S-IP]
- requirement割当は`docs/implementation-plan.md` §9、要求本文は`docs/requirement-definition.md` §§7〜12を使用する。[S-IP][S-RD]
- process境界はADR-0001、不変性・削除境界はADR-0002、packaging/OS境界はADR-0003を使用する。[S-ADR1][S-ADR2][S-ADR3]
- license/model/datasetは`docs/dependency-policy.md`と`docs/model-governance/adoption-template.md`を使用する。[S-DEP][S-MODEL]
- 外部URLは[S-RD §19]と[S-IP §12]の索引を起点とする。各採用taskで最新一次資料を再取得し、取得日、版、URL、必要な保存copy/hashを残す。本書作成時にURL内容を再取得したとは扱わない。[S-CONTRIB §5][S-DEP §§6,10]
- 旧計画`work/20260903-0605-TaskExecutionPlan.md`は履歴資料だけに使い、現在状態の正本にはしない。[H-OLD]

## 2. 現在地の実測

### 2.1 Git・環境

2026-09-03に作成環境でread-only実測した。[E-GIT][E-ENV]

| 項目 | 実測 |
|---|---|
| OS | Microsoft Windows 11 Pro Insider Preview build 29648、64-bit |
| CPU | 13th Gen Intel(R) Core(TM) i7-13800H |
| PowerShell | Core 7.6.5 |
| HEAD / branch | `fff9df2a79e144ac8fea57d4269edccd6045b8c4` / `main` |
| working tree | clean、変更0 |
| worktree / local branch | `C:/GitHub/AutoVision-Studio` 1件 / `main` 1本 |
| remote差分 | `origin/main...HEAD = 0 behind / 7 ahead` |
| Node | `C:\Program Files\nodejs\node.exe`、24.19.0 |
| default npm | `C:\Program Files\nodejs\npm.ps1`、11.17.0。project要件外 |
| 検証済みnpm | 12.0.0。作成環境の一時tool cacheに存在するが、その絶対pathを別環境へ移植しない |
| uv | `C:\Users\dahatake\.local\bin\uv.exe`、0.12.9。PATH外 |
| default Python | CPython 3.12.10。project実行環境ではない |
| target plan file | 作成前は不存在 |

### 2.2 完了数と残数

| Phase | 正本件数 | VERIFIED | 残 | 現在状態 | 出典 |
|---|---:|---:|---:|---|---|
| A | 10 | 10 | 0 | 完了 | [S-IP §7 Phase A][E-A] |
| B | 13 | 13 | 0 | 完了、Windows B-GATE PASS | [S-IP §7 Phase B][E-B][S-C0] |
| C | 19 | 0 | 19 | 一部READY | [S-IP §7 Phase C] |
| D | 15 | 0 | 15 | Gate 1待ち | [S-IP §7 Phase D] |
| E | 8 | 0 | 8 | D依存待ち | [S-IP §7 Phase E] |
| F | 16 | 0 | 16 | D/E依存待ち | [S-IP §7 Phase F] |
| G | 29 | 0 | 29 | F依存待ち | [S-IP §7 Phase G] |
| H | 22 | 0 | 22 | Gate 2/3待ち | [S-IP §7 Phase H] |
| I | 32 | 0 | 32 | Gate 2/3待ち | [S-IP §7 Phase I] |
| I.1 | 3 | 0 | 3 | TRN-21待ち | [S-IP §7 Phase I.1] |
| J | 12 | 0 | 12 | Training/assist待ち | [S-IP §7 Phase J] |
| K | 20 | 0 | 20 | Training/model待ち | [S-IP §7 Phase K] |
| L | 24 | 0 | 24 | Gate 4待ち | [S-IP §7 Phase L] |
| M | 23 | 0 | 23 | Gate 4・署名identity待ち | [S-IP §7 Phase M] |
| N | 7 | 0 | 7 | 全feature/packaging待ち | [S-IP §7 Phase N] |
| **合計** | **253** | **23** | **230** |  | [E-COUNT] |

`AST-17`、`TRN-23`、`TRN-24`は正本に存在しない欠番であり、補完しない。[S-IP §7][E-COUNT]

### 2.3 C0・lock・baseline Gate

- C0-NODE/PYTHON licenseは53件をexact version・用途限定でownerが`APPROVED_WITH_CONDITIONS`と裁定した。一般allowlist化ではない。[S-C0 §§1〜5]
- Node lockは非root/non-link 509件、`resolved`/`integrity`欠落0。Python lockは70 block、220 artifact、SHA-256欠落0。[S-C0 §7]
- Windows B-GATEはnpm clean install、Node test suite 4 files / 19 tests、typecheck、3 entry build、Electron window、uv lock/sync、pytest 4 tests、Ruff、Pyrightに合格し、両lock hashは不変だった。[S-C0 §8]
- Python既知advisoryは3 record / 2 package（`setuptools` Moderate、`torch` Low）。現policyのCritical/High停止閾値には達しないが、脆弱性0とは扱わずSEC-08で再監査する。[S-C0 §§7,9][S-DEP §11]
- C0のmacOS実機検証だけはowner指示で`WAIVED / NOT_RUN`。Windows結果をmacOS PASSへ転用せず、macOS必須GateもPASSにはしない。[S-C0 §6]

## 3. 別環境への移送

### 3.1 取得すべきGit基準

remoteはcode baselineより7 commit遅れているため、`origin/main`だけをcloneしても現在基準を再現できない。次のどちらかで、本書を含むcommitを移送する。[E-GIT]

1. `main`をremoteへpushし、別環境で本書を含むcommitをcheckoutする。
2. pushしない場合は`main`を含むGit bundleを作り、bundle SHA-256を別経路で伝える。

秘密、model binary、ユーザー画像、Project、署名鍵、tokenをGit/bundleへ含めない。[S-CONTRIB §§9〜11][S-DEP §9]

### 3.2 別環境の開始確認

PowerShell 7+で次を確認し、1件でも不一致なら実装を開始しない。[S-CONTRIB §§6,10]

```text
git fetch --all --prune
git checkout main
git status --short --branch
git worktree list --porcelain
git log -1 --format=%H -- work/20260903-1340-TaskExecutionPlan.md
git merge-base --is-ancestor fff9df2a79e144ac8fea57d4269edccd6045b8c4 HEAD
```

合格条件:

- 本書を含むhandoff commitをcheckoutしている。
- `fff9df2...`がHEADのancestorである。
- working treeがcleanである。
- 意図しないworktree/branch、未追跡model、秘密情報がない。

### 3.3 tool bootstrap

| tool | 必須条件 | 確認方法 | 出典 |
|---|---|---|---|
| PowerShell | 最新の7+ / Core。Windows PowerShell 5.1へfallback禁止 | `$PSVersionTable` | [S-CONTRIB §6] |
| Node | `24.19.x` | `node --version` | `package.json` [S-NODE] |
| npm | **12.0.0**。nested `npm run`も同じnpmを使うようbinをPATH先頭へ置く | `npm --version`と`Get-Command npm` | `package.json`, `.npmrc`, [S-C0 §8] |
| uv | **0.12.9** | `uv --version`。PATH外なら実体pathを明示 | `ml/pyproject.toml` [S-PY] |
| Python | Windows CPython 3.14（uv管理）。PATH上の3.12等を採用版とみなさない | `uv run python --version` | [S-PY][S-C0] |
| Git | handoff commitとclean treeを再現可能 | §3.2 | [E-GIT] |

npm 11.17.0では`devEngines.packageManager`により停止する。未固定の`latest`を使用しない。別環境固有のtool cache pathは計画へ固定せず、そこで検証した実pathとversionをGate記録に保存する。[S-C0 §§7〜8][S-DEP §5]

## 4. 別環境ENV-GATE

本書を受け取った環境では、Phase C開始前にlockを変更せず次を再実行する。作成環境のPASSを別PCへ転用しない。[S-CONTRIB §§2,5,8,12][S-C0 §8]

```text
npm --version
npm ci
npm approve-scripts --allow-scripts-pending
npm test
npm run typecheck
npm run build
cd ml
uv lock --check --system-certs
uv sync --locked --system-certs
uv run --locked --system-certs pytest -q
uv run --locked --system-certs ruff check
..\node_modules\.bin\pyright.cmd
```

注意:

- npm pending script確認はnpm 12の`npm approve-scripts --allow-scripts-pending`を使う。未対応の`npm query ':pending'`を使わない。[S-C0 §8]
- Pyrightへ`pyproject.toml`をsource引数として渡さず、`ml`から引数なしでconfigを自動検出させる。[S-C0 §8]
- 実行前後に`package-lock.json`と`ml/uv.lock`のSHA-256を取り、§26の値と一致させる。
- Electronを実起動し、local Renderer、`dist/preload/index.cjs`、応答window、終了後残process 0を確認する。sandbox/contextIsolationはtestとbuild artifact双方で確認する。[S-IP B-05〜07][S-C0 §8]
- baseline期待値はNode 4 files / 19 tests、Python 4 testsである。別環境で件数が異なる場合は成功と推測せずdiffを調べる。[S-C0 §8]
- ENV-GATE結果は環境、tool exact version、command、exit code、test件数、lock hash、未実施事項とともに新しいGate記録または最初のtask commit本文へ保存する。[S-CONTRIB §§2,5,10]

## 5. 外部条件と停止規則

| ID | 条件 | 必要時点 | 未充足時 | 出典 |
|---|---|---|---|---|
| ENV-WIN | Windows 11 x64、PowerShell 7+ | Windows/common lane | 対象taskをBLOCKED | [S-RD §4][S-CONTRIB §6] |
| ENV-MAC | native Apple Silicon / macOS 13+ | macOS task、Gate 1/3/4/5 | `NOT_RUN`。Windows結果で代替禁止 | [S-RD §§2.2,4,15〜16][S-C0 §6][S-CONTRIB §7] |
| MODEL-C6 | 分類/検出base weightのlicense、由来、hash、品質承認 | SPI-15/16、Gate 2 | model固有trainingを開始しない | [S-RD FR-LIC-004〜008][S-DEP §6.1] |
| MODEL-C7 | 分類/検出assist checkpointの同承認 | SPI-17、Gate 2 | assist実装/同梱を開始しない | [S-RD FR-LIC-014〜015][S-DEP §6.2] |
| FIXTURE | 権利確認済みclassification/detection/gold fixture | SPI-15〜17 | 品質・parity値を測定しない | [S-RD §§6,15][S-DEP §6] |
| BUDGET | CPU/GPU別AutoML有限budgetの実測 | Gate 2 / TRN-09 | trial/time値を固定しない | [S-IP D-15][S-RD TBD-03] |
| PRODUCT-ID | 暫定`io.github.dahatake.autovisionstudio`の正式決定 | Gate 3以前・署名前 | upgrade/signing identityを固定しない | [S-IP D-10][S-ADR3 §6] |
| SIGN-WIN | 正式Windows署名identity | PKG-07 / Gate 5 | Windows release不可 | [S-IP D-16][S-ADR3 §§6〜7] |
| SIGN-MAC | Developer ID Application/Installerとnotary資格 | PKG-08 / Gate 5 | macOS release不可 | [S-IP D-16][S-ADR3 §§6〜7] |
| LICENSE-PAYLOAD | C0条件のNOTICE/SBOM/MPL source案内とbuild-only分離 | SPI-03/04、LIC-01、Gate 5 | 当該承認失効・release停止 | [S-C0 §§3〜5][S-DEP §§7,12] |

**macOS scopeの事実:** owner waiverはC0だけを閉じた。要求正本はWindows/macOS双方を必須のまま保持するため、native MacなしにGate 1以降をPASSにできない。Windows-only MVPへ変更する場合は、Phase C実装中に黙って進めず、`docs/requirement-definition.md`、`docs/implementation-plan.md`、ADR-0003、traceabilityへの正式なscope変更を先行させる。[S-RD §§1,4,15〜16][S-C0 §6][S-CONTRIB §§3,5]

## 6. 全task共通サイクル

各taskを個別に次の順で閉じる。[S-IP §4][S-CONTRIB §§1〜5,10]

1. **Context Pack:** task行、対応requirement、依存ADR節、編集対象全文、直接import元/先、隣接testだけを読む。
2. **依存確認:** 全依存taskがVERIFIED、必要GateがPASSであることをcommit/Gate記録で確認する。
3. **scope固定:** task行に列挙された成果物だけを変更する。成果物不足なら計画変更を先に行う。
4. **実装:** 1つの観測可能挙動。未使用flag、将来抽象化、無関係refactor、runtime downloadを入れない。
5. **対象test:** 正常、境界、失敗、adversarial caseを実行し、type/lint/editor diagnosticsを確認する。
6. **敵対レビュー:** 別contextが要求漏れ、scope逸脱、状態遷移、IPC/path/network、不変性、license断定を確認する。
7. **裁定:** 再現した指摘だけを修正し、future taskの責務は根拠付きでdeferする。
8. **再検証:** 対象test、指摘再現test、必要な統合testを再実行する。
9. **task commit:** task ID、requirements、baseline、環境、変更file、command/exit/test数、review、blockerを本文に記録する。
10. **wave統合:** 出力が重ならないtaskだけを並列化し、依存順にmainへ統合する。

状態は`TODO → IN_PROGRESS → TESTED → ADVERSARIAL_REVIEW → FIXING（必要時）→ REVALIDATED → VERIFIED`。外部条件不足は`BLOCKED`、OS片側だけは`PARTIAL`。[S-CONTRIB §§2〜3]

## 7. Gate順序

| Gate | 合格条件 | 現在 | 停止条件 | 出典 |
|---|---|---|---|---|
| ENV-GATE | §4のclean再構築・lock不変 | 別環境では未実施 | tool/lock/test不一致 | [S-CONTRIB §8][S-C0 §8] |
| C0 | exact lock、license裁定、Windows B-GATE | CLOSED | C0条件違反 | [S-C0] |
| Gate 1 | 両OSのSQLite、onedir、installer resource、Reference、pipe、ORT、Konva PoC | NOT_RUN | native Macなし、PoC不合格 | [S-IP §6][S-RD §15] |
| Gate 2 | C6/C7、hash、quality、finite budget | NOT_RUN | unknown/不承認model、fixture/budget不足 | [S-IP §6][S-DEP §6] |
| Gate 3 | Project→Import→Annotation→immutable Revision→Queued Runを両OSで実証 | NOT_RUN | 片OS、未確認item混入 | [S-IP §6][S-ADR2 §§3.3〜3.6] |
| Gate 4 | Assist→Train→ONNX→Version→Report→Cameraを分類/検出で実証 | NOT_RUN | model/OS/性能未達 | [S-IP §6][S-RD §15] |
| Gate 5 | 署名installer、offline/servicing、SBOM、全必須要求 | NOT_RUN | 必須1件でも未達 | [S-IP §6][S-RD §16][S-ADR3 §6] |

## 8. Phase C — 高リスクPoC（19件）

開始条件はC0 CLOSEDと当該環境のENV-GATE PASS。現在、Windows/OS非依存9件に着手可能である。macOS部分はNOT_RUNのままにする。[S-IP §7 Phase C][S-C0 §6]

**wave:** C1=`SPI-01,02,08,10,11,12,13,14,19` → C2=`SPI-03,04,07,15,16,17` → C3=`SPI-05,06,09` → C4=`SPI-18`。[S-IP §7 Phase C]

| ID | 現在 | 成果物・実装 | 依存 | 検証・完了条件 | 出典 |
|---|---|---|---|---|---|
| SPI-01 | READY | `spikes/sqlite/main.ts`, `smoke.test.ts`, `README.md`。better-sqlite3 CRUDをdev/packageで実装 | B-05 | Node/Electron ABI、native hash、CRUD、package可否を実測しD-03を判定 | [S-IP §7 Phase C][P10] |
| SPI-02 | READY | `spikes/worker/main.ts`, `worker.py`, `README.md`。JSON/NDJSON child process | B-12 | started/progress/stderr/exit/cancelを実processで検証。HTTP/RPCなし | [S-IP §7 Phase C][S-ADR1 §2.5] |
| SPI-03 | WAIT_DEP | Windows PyInstaller specと`windows-result.md` | SPI-02, A-10 | clean Windows/no Pythonでimport、health、CPU、size、cold start、PE一覧。C0 license payload条件も照合 | [S-IP §7 Phase C][P05][S-C0 §4.2] |
| SPI-04 | MAC_NOT_RUN | macOS PyInstaller specと`macos-result.md` | SPI-02, A-10 | native Apple Silicon/no PythonでCPU/MPS/CoreML、size、cold start、nested code。Windows代替禁止 | [S-IP §7 Phase C][P05][S-C0 §6] |
| SPI-05 | WAIT_DEP | Windows electron-builder spike configとinstaller結果 | SPI-03 | NSIS EXEへonedirを同梱・起動。production configは作らない | [S-IP §7 Phase C][P02][P03] |
| SPI-06 | MAC_NOT_RUN | macOS PKG spike config、entitlements、結果 | SPI-04 | native MacでPKG同梱とnested code構造を実測 | [S-IP §7 Phase C][P04] |
| SPI-07 | WAIT_DEP | TS/Python 4-byte framed RGB pipeと結果 | SPI-02 | 320/640 RGBを10Hz送受信しlatency/CPU/memoryを実測 | [S-IP §7 Phase C][S-ADR1 §2.5] |
| SPI-08 | READY_WIN / MAC_NOT_RUN | `provider_probe.py`, provider結果 | B-11 | Windows DML/CPUを実測。CoreML/CPUはnative MacまでNOT_RUN | [S-IP §7 Phase C][P07][P08] |
| SPI-09 | WAIT_DEP / MAC_NOT_RUN | camera→pipe→dummy result spike | SPI-07, SPI-08 | queue=1/drop、30分基礎測定。OS/hardware別の実値だけ記録 | [S-IP §7 Phase C][S-RD FR-INF-007〜011] |
| SPI-10 | READY | React-Konva rectangle canvas/test/result | B-07 | 4K+100 boxのcreate/select/move/resize/zoomとp95を実測 | [S-IP §7 Phase C][P06][S-RD NFR-ANN-002] |
| SPI-11 | READY_RESEARCH | classification base採用記録 | A-06 | code/checkpoint/data/terms/intended use/redistribution/hashを一次資料で全known化 | [S-IP §7 Phase C][S-DEP §6.1] |
| SPI-12 | READY_RESEARCH | detection base採用記録 | A-06 | SPI-11と同じfail-closed監査 | [S-IP §7 Phase C][S-DEP §6.1] |
| SPI-13 | READY_RESEARCH | classification assist採用記録 | A-06 | C7候補を一次資料、hash、qualityで判定。承認ありき禁止 | [S-IP §7 Phase C][S-DEP §6.2] |
| SPI-14 | READY_RESEARCH | detection assist採用記録 | A-06 | SPI-13と同じfail-closed監査 | [S-IP §7 Phase C][S-DEP §6.2] |
| SPI-15 | WAIT_DEP_MODEL | classification train/export parity spike | SPI-11, SPI-08 | 権利確認済みfixtureでtrain→ONNX→CPU parityとbudget候補を実測 | [S-IP §7 Phase C][S-RD FR-TRN-003/018] |
| SPI-16 | WAIT_DEP_MODEL | detection train/export parity spike | SPI-12, SPI-08 | box/score/label、mAP差、runtimeを実測 | [S-IP §7 Phase C][S-RD FR-TRN-003/018] |
| SPI-17 | WAIT_DEP_MODEL | assist benchmarkと結果 | SPI-13, SPI-14 | gold setでcoverage/accept/edit/reject/timeをmanual-only比較。accuracy捏造禁止 | [S-IP §7 Phase C][S-RD NFR-ANN-006] |
| SPI-18 | WAIT_ALL / BLOCKED_MAC | ADR-0004とapproved model manifest | A-07, SPI-01〜17, SPI-19 | 全結果の採否、hardware、未解決を記録しGate 1/2判定。未承認modelをmanifestへ入れない | [S-IP §7 Phase C][S-DEP §§6,12] |
| SPI-19 | READY_WIN / MAC_NOT_RUN | Reference access spikeとOS別結果 | B-05, D-19 | Windowsのrestart/read/hash/change/loss/relink/write-delete 0を実測。macOS側はNOT_RUN | [S-IP §7 Phase C][S-ADR2 §3.2] |

## 9. Phase D — App core / Project / 診断（15件）

全件Gate 1 PASS待ち。waveは`CORE-01,11 → CORE-02,12 → CORE-03,14 → CORE-04 → CORE-05 → CORE-06 → CORE-07,10 → CORE-08,09 → CORE-13 → DOC-01`。[S-IP §7 Phase D]

| ID | 現在 | 成果物・実装 | 依存 | 検証・完了条件 | 出典 |
|---|---|---|---|---|---|
| CORE-01 | BLOCKED_GATE1 | `paths.ts`/test。OS user-data配下のproject/cache/log path | Gate 1 | absolute、作成責務、境界をtest | [S-IP §7 Phase D][S-RD FR-SEC-001] |
| CORE-02 | BLOCKED_GATE1 | SQLite open/close module/test | SPI-01, CORE-01 | foreign key、WAL、Main single writer | [S-IP §7 Phase D][S-ADR1 §2.7] |
| CORE-03 | BLOCKED_GATE1 | migration runner/test | CORE-02 | version順、transaction、rollback、再実行 | [S-IP §7 Phase D][S-ADR2 §3.6] |
| CORE-04 | BLOCKED_GATE1 | `001_core.sql`/schema test | CORE-03 | projects/settings最小schemaとconstraint | [S-IP §7 Phase D][S-RD §9] |
| CORE-05 | BLOCKED_GATE1 | Project runtime contract/test | CORE-04 | UUID/name/taskTypeの正常・境界・失敗 | [S-IP §7 Phase D][S-RD FR-PRJ-001〜003] |
| CORE-06 | BLOCKED_GATE1 | Project repository/service/test | CORE-05 | CRUD、重複/不存在、初回Run後taskType lock | [S-IP §7 Phase D][S-RD FR-PRJ-001〜006] |
| CORE-07 | BLOCKED_GATE1 | Project IPC/preload/contracts/test | CORE-06 | sender+schema、任意path/raw IPC拒否 | [S-IP §7 Phase D][S-RD FR-SEC-006] |
| CORE-08 | BLOCKED_GATE1 | Project list UI/test | CORE-07 | UI-02 list/search/statusとkeyboard | [S-IP §7 Phase D][S-RD UI-02] |
| CORE-09 | BLOCKED_GATE1 | Project form UI/test | CORE-07 | create/edit、日本語validation、taskType lock表示 | [S-IP §7 Phase D][S-RD UI-03] |
| CORE-10 | BLOCKED_GATE1 | delete preview/dialog/backend test | CORE-06 | owned/reference件数・容量を区別し参照元を除外 | [S-IP §7 Phase D][S-ADR2 §3.8] |
| CORE-11 | BLOCKED_GATE1 | Python hardware probe、CLI、test | B-12, SPI-08 | allowlist commandで実測OS/CPU/RAM/disk/provider。cameraを開かない | [S-IP §7 Phase D][S-RD FR-SYS-001〜004] |
| CORE-12 | BLOCKED_GATE1 | diagnostics service/IPC/UI/test | CORE-11, SPI-02 | 非対応/CPU可/推奨と実理由、worker failure | [S-IP §7 Phase D][S-RD UI-01] |
| CORE-13 | BLOCKED_GATE1 | Project CRUD Electron E2E | CORE-08〜10 | restart persistence、他Project非干渉 | [S-IP §7 Phase D][S-RD FR-PRJ-001〜010] |
| CORE-14 | BLOCKED_GATE1 | battery/thermal backend/UI/test | CORE-12 | OS取得値だけ表示し、取得不能を捏造しない | [S-IP §7 Phase D][S-RD §12.3] |
| DOC-01 | BLOCKED_GATE1 | Project/診断guide更新 | CORE-12〜14, A-08 | 実装・実測済み画面だけをUI文言と照合 | [S-IP §7 Phase D][S-CONTRIB §2] |

## 10. Phase E — Job runtime（8件）

waveは`JOB-01,03 → JOB-02 → JOB-04 → JOB-05 → JOB-06,07,08`。現在はPhase D依存待ち。[S-IP §7 Phase E]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| JOB-01 | BLOCKED_DEP | `002_jobs.sql`、job contract、schema test | CORE-03 | 要求済み状態とconstraintだけを定義 | [S-IP §7 Phase E][S-RD §10] |
| JOB-02 | BLOCKED_DEP | job repository/state machine/test | JOB-01 | 全合法遷移、未定義遷移、終端再開拒否 | [S-IP §7 Phase E][S-ADR2 §3.5] |
| JOB-03 | BLOCKED_DEP | TS/Python worker envelope/test | SPI-02 | schemaVersionとstarted/progress/warning/completed/failed整合 | [S-IP §7 Phase E][S-ADR1 §2.5] |
| JOB-04 | BLOCKED_DEP | child-process supervisor/test | JOB-02, JOB-03 | spawn、stdout/stderr、exit、artifact path境界 | [S-IP §7 Phase E][S-RD FR-TRN-002] |
| JOB-05 | BLOCKED_DEP | job service/IPC/preload/test | JOB-04 | progress subscribe/unsubscribe、cancel、猶予後kill | [S-IP §7 Phase E][S-RD FR-TRN-012〜014] |
| JOB-06 | BLOCKED_DEP | restart recovery/test | JOB-05 | Running→Interrupted、Exporting/Evaluating→Failed、Cancelled非再開 | [S-IP §7 Phase E][S-ADR1 §2.6] |
| JOB-07 | BLOCKED_DEP | training FIFO queue/test | JOB-05 | 同時1件、FIFO、汎用schedulerなし | [S-IP §7 Phase E][S-RD FR-TRN-010] |
| JOB-08 | BLOCKED_DEP | status bar/page/test | JOB-05 | queue/progress/current/cancel可否を日本語・keyboard表示 | [S-IP §7 Phase E][S-RD UI-05] |

## 11. Phase F — Data import（16件）

waveは`DAT-01,06,12,13 → DAT-02,07 → DAT-03,04,05,11,14 → DAT-08 → DAT-09,15 → DAT-10 → DOC-02`。[S-IP §7 Phase F]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| DAT-01 | BLOCKED_DEP | import contract、`scan_dataset.py`、CLI、test | JOB-03, CORE-11 | versioned I/Oと`scan-dataset` allowlist | [S-IP §7 Phase F][S-RD FR-DAT-001〜008] |
| DAT-02 | BLOCKED_DEP | image enumerate/magic/hash module/test | DAT-01 | extension+magic、SHA-256、duplicate、unsupported | [S-IP §7 Phase F][S-RD FR-DAT-003/007] |
| DAT-03 | BLOCKED_DEP | decode/EXIF/security limits/test | DAT-02 | orientation、broken、animated、pixel/byte上限 | [S-IP §7 Phase F][S-RD FR-DAT-003〜004] |
| DAT-04 | BLOCKED_DEP | classification importer/test | DAT-02 | unlabeled/folder/UTF-8 CSV、invalid row | [S-IP §7 Phase F][S-RD FR-DAT-005] |
| DAT-05 | BLOCKED_DEP | COCO importer/test | DAT-02 | image/category/bbox、unknown参照、invalid item | [S-IP §7 Phase F][S-RD FR-DAT-006] |
| DAT-06 | BLOCKED_DEP | atomic copy source/test | CORE-01 | temp copy→hash→rename、元file非変更 | [S-IP §7 Phase F][S-ADR2 §§3.2,3.6] |
| DAT-07 | BLOCKED_DEP | `003_import.sql`、repository/test | DAT-01, CORE-03 | source manifest、scan、rights/modeを永続化 | [S-IP §7 Phase F][S-RD FR-DAT-011〜015] |
| DAT-08 | BLOCKED_DEP | import service/IPC/preload/test | DAT-04〜07, DAT-11〜13, JOB-04 | picker→scan→rights→capacity→mode→workspaceを失敗atomicに統合 | [S-IP §7 Phase F][S-RD UI-04] |
| DAT-09 | BLOCKED_DEP | ImportPage/Summary/test | DAT-08 | Error/Warning、mode、rights、修正導線 | [S-IP §7 Phase F][S-RD UI-04] |
| DAT-10 | BLOCKED_DEP | classification/detection import E2E | DAT-09 | folder/CSV/COCO/unlabeled/broken/capacity/rights/Reference | [S-IP §7 Phase F][S-RD FR-DAT-001〜016] |
| DAT-11 | BLOCKED_DEP | capacity preflight/test | DAT-02, CORE-01 | source+derived+temp+20%、不足時write前停止 | [S-IP §7 Phase F][S-RD NFR-STO-001] |
| DAT-12 | BLOCKED_DEP / MAC_NOT_RUN | Reference source/test | SPI-19, CORE-01 | identity/size/mtime/hash/restart/relink、参照元非変更 | [S-IP §7 Phase F][S-ADR2 §3.2] |
| DAT-13 | BLOCKED_DEP | rights backend/UI/test | CORE-06 | 初回確認日時を保存し法的権利を保証しない | [S-IP §7 Phase F][S-RD FR-LIC-009] |
| DAT-14 | BLOCKED_DEP | image protocol/safe-path/test | DAT-06, DAT-12 | allowlist内read-only、traversal/symlink/junction越境拒否 | [S-IP §7 Phase F][S-RD FR-SEC-006/008] |
| DAT-15 | BLOCKED_DEP / MAC_NOT_RUN | OS別manual picker記録 | DAT-08, SPI-19 | multi/folder/cancel/restart/relinkを署名前packageでOS別実測 | [S-IP §7 Phase F][S-RD FR-DAT-001/012] |
| DOC-02 | BLOCKED_DEP | data import guide | DAT-10, DAT-15, DOC-01 | Copy/Reference、capacity、rights、format、relinkを実画面どおり記録 | [S-IP §7 Phase F][S-CONTRIB §2] |

## 12. Phase G — Annotation / Dataset Revision（29件）

waveは`ANN-01 → 02 → 03,05 → 04,06 → 07,08 → 09,11 → 10,12,23,25 → 13 → 14,24 → 15,26 → 16,17 → 18 → 19 → 20,21 → 22 → 27,28 → DOC-03`。[S-IP §7 Phase G]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| ANN-01 | BLOCKED_DEP | `004_annotations.sql`/schema test | DAT-07 | schema/workspace/item/revision/provenance constraint | [S-IP §7 Phase G][S-ADR2 §3.1] |
| ANN-02 | BLOCKED_DEP | annotation runtime contracts/test | ANN-01 | state/provenance/classification/rectangle union | [S-IP §7 Phase G][S-RD FR-ANN-001〜014] |
| ANN-03 | BLOCKED_DEP | label repository/service/test | ANN-02 | UUID、Unicode正規化、alias、初回学習後lock | [S-IP §7 Phase G][S-RD FR-ANN-003/004/012] |
| ANN-04 | BLOCKED_DEP | label IPC/preload/UI/test | ANN-03 | UI-09 CRUD、説明/例、validation、keyboard | [S-IP §7 Phase G][S-RD UI-09] |
| ANN-05 | BLOCKED_DEP | workspace repository/service/test | ANN-02 | mutable workspaceとpast revision不変性 | [S-IP §7 Phase G][S-ADR2 §§3.1,3.4] |
| ANN-06 | BLOCKED_DEP | annotation IPC contracts/handlers/test | ANN-05 | paging/query/save schemaとsender | [S-IP §7 Phase G][S-RD FR-SEC-006] |
| ANN-07 | BLOCKED_DEP | page/gallery/test | ANN-06, DAT-14 | safe thumbnails、state filter、前後移動 | [S-IP §7 Phase G][S-RD FR-ANN-001/005/008] |
| ANN-08 | BLOCKED_DEP | draft hook、save backend、test | ANN-06 | 1秒内保存開始、undo/redo、failure状態 | [S-IP §7 Phase G][S-RD NFR-ANN-001] |
| ANN-09 | BLOCKED_DEP | ClassificationEditor/test | ANN-04, ANN-08 | exactly one class、replace/clear/exclude | [S-IP §7 Phase G][S-RD FR-ANN-101〜103] |
| ANN-10 | BLOCKED_DEP | bulk bar/distribution/test | ANN-09 | multi-apply、count、少数/偏りwarning | [S-IP §7 Phase G][S-RD FR-ANN-102/104] |
| ANN-11 | BLOCKED_DEP | DetectionCanvas/coordinate test | SPI-10, ANN-08 | pixel↔view round-trip、zoom/pan | [S-IP §7 Phase G][S-RD FR-ANN-201〜204] |
| ANN-12 | BLOCKED_DEP | RectangleLayer/test | ANN-11 | create/select/delete、pointer/keyboard境界 | [S-IP §7 Phase G][S-RD FR-ANN-201/202] |
| ANN-13 | BLOCKED_DEP | transformer/test | ANN-12 | move/resize、finite、min size、clamp、pixel保存 | [S-IP §7 Phase G][S-RD FR-ANN-202/204/205] |
| ANN-14 | BLOCKED_DEP | RegionList/NoObject/test | ANN-13, ANN-04 | class変更、対象物なし、未着手の分離 | [S-IP §7 Phase G][S-RD FR-ANN-203/206] |
| ANN-15 | BLOCKED_DEP | annotation validator/test | ANN-09, ANN-14 | schema外、分類0/複数、nonfinite/zero/outside拒否 | [S-IP §7 Phase G][S-RD FR-ANN-011] |
| ANN-16 | BLOCKED_DEP | provenance/test | ANN-15 | manual/import/modelの5区分とsource ID | [S-IP §7 Phase G][S-ADR2 §3.3] |
| ANN-17 | BLOCKED_DEP | split worker/test | ANN-15 | fixed seed、stratification、hash leakage防止 | [S-IP §7 Phase G][S-RD FR-DAT-009/010] |
| ANN-18 | BLOCKED_DEP | revision manifest writer/test | ANN-15〜17 | confirmedのみ、temp/hash/atomic rename、pending 0 | [S-IP §7 Phase G][S-ADR2 §§3.4,3.6] |
| ANN-19 | BLOCKED_DEP | revision repository/service/test | ANN-18 | immutable revision、lineage、lastVerifiedAt例外だけ | [S-IP §7 Phase G][S-ADR2 §3.4] |
| ANN-20 | BLOCKED_DEP | clone workspace/test | ANN-19 | revision clone、hash dedupe、元非変更 | [S-IP §7 Phase G][S-RD FR-ANN-013] |
| ANN-21 | BLOCKED_DEP | ConfirmDatasetDialog/test | ANN-15, ANN-19 | Error block、件数/provenance/pending表示 | [S-IP §7 Phase G][S-RD FR-ANN-011] |
| ANN-22 | BLOCKED_DEP | confirm-and-queue/test | ANN-21, JOB-07 | revision commit後5秒以内にQueued、transaction整合 | [S-IP §7 Phase G][S-RD FR-ANN-014/NFR-PERF-002] |
| ANN-23 | BLOCKED_DEP | LabelPicker/recent/test | ANN-09 | search/recent/数字shortcutをmouse/keyboardで実行 | [S-IP §7 Phase G][S-RD FR-ANN-105] |
| ANN-24 | BLOCKED_DEP | rectangle commands/duplicate warning/test | ANN-13 | duplicate/select-all/keyboard/high-IoU warning | [S-IP §7 Phase G][S-RD FR-ANN-202/205/208] |
| ANN-25 | BLOCKED_DEP | instructions UI/test | ANN-04, ANN-11 | Project固有方針をeditorで常時参照 | [S-IP §7 Phase G][S-RD FR-ANN-207] |
| ANN-26 | BLOCKED_DEP | item actions/save status/test | ANN-07〜09, ANN-14 | exclude reasonとsaving/saved/failed、keyboard | [S-IP §7 Phase G][S-RD FR-ANN-006/009] |
| ANN-27 | BLOCKED_DEP / MAC_NOT_RUN | classification E2E/fixture | ANN-10,22,23,26 | POC-14、manifest/queue照合をOS別に実証 | [S-IP §7 Phase G][S-RD POC-14] |
| ANN-28 | BLOCKED_DEP / MAC_NOT_RUN | detection E2E/fixture | ANN-14,22,24〜26 | POC-15、negative/rectangle/validation | [S-IP §7 Phase G][S-RD POC-15] |
| DOC-03 | BLOCKED_DEP | annotation guide | DOC-02, ANN-27/28 | 実画面のSchema、rectangle、shortcut、confirmを記載 | [S-IP §7 Phase G][S-CONTRIB §2] |

## 13. Phase H — Initial Annotation Assist（22件）

Gate 2/3 PASSまで開始しない。AST-08はTRN-21後へdeferする。waveは`AST-01,02 → 03,04 → 05,06,07 → 09,11,18,19 → 10,12,15,20 → 13,16,21 → 14 → 22 → DOC-04`。[S-IP §7 Phase H]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| AST-01 | BLOCKED_GATE2 | approved manifest loader/test | SPI-18 | schema/path/hash/approval/task/supportをfail-closed | [S-IP §7 Phase H][S-DEP §6] |
| AST-02 | BLOCKED_GATE3 | `005_suggestions.sql`、contract/test | ANN-01 | set/version/decision/rawScore/provenanceをGTと分離 | [S-IP §7 Phase H][S-ADR2 §3.7] |
| AST-03 | BLOCKED_DEP | suggestion repository/service/test | AST-02 | output不変、decisionのみ可変、set比較 | [S-IP §7 Phase H][S-ADR2 §3.7] |
| AST-04 | BLOCKED_DEP | worker contract、assist command、CLI、test | JOB-03, AST-02, DAT-01 | task別schema、allowlist、DB writeなし | [S-IP §7 Phase H][S-ADR1 §2.2] |
| AST-05 | BLOCKED_MODEL | classification assist/test | AST-01, AST-04, Gate 2 | approved modelで既存Schema top-3、score意味非捏造 | [S-IP §7 Phase H][S-RD FR-AST-005] |
| AST-06 | BLOCKED_MODEL | label-name candidates/test | AST-01, AST-04, Gate 2 | 新規名を別候補にし自動Schema追加なし | [S-IP §7 Phase H][S-RD FR-AST-006] |
| AST-07 | BLOCKED_MODEL | detection assist/test | AST-01, AST-04, Gate 2 | approved modelでbox/class/raw score | [S-IP §7 Phase H][S-RD FR-AST-007/008] |
| AST-08 | DEFER_TRN21 | Project model worker/test | AST-04, TRN-21 | Succeeded版だけ、task/schema一致、version/hash出力 | [S-IP §7 Phase H][S-RD FR-AST-016] |
| AST-09 | BLOCKED_DEP | assist service/IPC/preload/test | AST-03〜07, JOB-05 | queue/disable/cancel/hash、OOM縮小/CPU fallback | [S-IP §7 Phase H][S-RD FR-AST-001/018] |
| AST-10 | BLOCKED_DEP | AssistJobPage/test | AST-09 | progress/device/ETA/failureを実値表示 | [S-IP §7 Phase H][S-RD UI-11] |
| AST-11 | BLOCKED_DEP | panel/overlay/test | AST-03, ANN-11 | Ground Truthと色/線/badge/dataを分離 | [S-IP §7 Phase H][S-RD FR-AST-009] |
| AST-12 | BLOCKED_DEP | decision hook/apply backend/test | AST-11 | 個別accept/edit/rejectだけ、auto/bulk approveなし | [S-IP §7 Phase H][S-RD FR-AST-010/011] |
| AST-13 | BLOCKED_DEP | confirmation gate/test | AST-12, ANN-21 | 全候補処理+画像確認までRevision禁止 | [S-IP §7 Phase H][S-RD NFR-ANN-005] |
| AST-14 | BLOCKED_DEP | regeneration/test | AST-09, AST-13 | confirmed非上書き、新旧set version比較 | [S-IP §7 Phase H][S-RD FR-AST-015] |
| AST-15 | BLOCKED_DEP | high-risk label filter/test | AST-06 | 指定属性だけblock/warn、汎用safetyなし | [S-IP §7 Phase H][S-RD FR-AST-019] |
| AST-16 | BLOCKED_DEP | assist report aggregation/test | AST-03, AST-12 | coverage/accept/edit/reject、accuracy非捏造 | [S-IP §7 Phase H][S-RD FR-REP-012] |
| AST-18 | BLOCKED_MODEL | determinism/test | AST-05, AST-07 | hash/prompt/preprocess/threshold/seed同一で再現 | [S-IP §7 Phase H][S-RD NFR-ANN-004] |
| AST-19 | BLOCKED_MODEL | threshold policy/test | AST-01, AST-05, AST-07 | PoC固定policyだけ、scoreなしにconfidence生成なし | [S-IP §7 Phase H][S-RD FR-AST-012/013] |
| AST-20 | BLOCKED_MODEL | classification similarity/test | AST-05, AST-18 | confirmed embeddingで順序index、GT/元順非変更 | [S-IP §7 Phase H][S-RD FR-AST-017] |
| AST-21 | BLOCKED_DEP | SimilaritySort/test | AST-20, ANN-07 | 類似/元順切替、件数/偏りを隠さない | [S-IP §7 Phase H][S-RD FR-AST-017] |
| AST-22 | BLOCKED_GATE2_3 / MAC_NOT_RUN | assist E2E | AST-10〜15,18〜21 | POC-16、pending 0、offline、hash/provenance、quality比較 | [S-IP §7 Phase H][S-RD POC-16] |
| DOC-04 | BLOCKED_DEP | initial assist guide | DOC-03, AST-22 | 候補限界、score、確認、類似順を実装どおり記載 | [S-IP §7 Phase H][S-CONTRIB §2] |

## 14. Phase I — Training / AutoML / Model Version（32件）

Gate 2/3 PASSまでmodel trainingを開始しない。waveは`TRN-01,02,09 → 03,06,28 → 04,05,07,08 → 16,17,25,26 → 10,11,18,19 → 12,13,27 → 14 → 15,20 → 21,30 → 22,31 → 29 → 32,33 → DOC-05`。[S-IP §7 Phase I]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| TRN-01 | BLOCKED_GATE3 | revision materializer/test | ANN-19, DAT-12 | confirmedのみ、開始前/epoch/trialでReference hash再検証 | [S-IP §7 Phase I][S-RD FR-DAT-013] |
| TRN-02 | BLOCKED_GATE1 | runtime/device/test | CORE-11 | 実CPU/CUDA/MPS選択、seed/version、fallback | [S-IP §7 Phase I][S-RD FR-SYS-003/004] |
| TRN-03 | BLOCKED_DEP | classification dataset/test | TRN-01 | preprocess/augmentation、single class invariant | [S-IP §7 Phase I][S-RD FR-ANN-101] |
| TRN-04 | BLOCKED_MODEL | classification single trial/test | TRN-02, TRN-03, Gate 2 | approved selected modelだけで1 trial | [S-IP §7 Phase I][S-RD FR-TRN-003] |
| TRN-05 | BLOCKED_DEP | classification metrics/test | TRN-03 | accuracy/balanced/macro/micro/class/confusionをfixture検算 | [S-IP §7 Phase I][S-RD FR-REP-002] |
| TRN-06 | BLOCKED_DEP | detection dataset/test | TRN-01 | box/class/negative/coordinate境界 | [S-IP §7 Phase I][S-RD FR-ANN-201〜206] |
| TRN-07 | BLOCKED_MODEL | detection single trial/test | TRN-02, TRN-06, Gate 2 | approved selected modelだけで1 trial | [S-IP §7 Phase I][S-RD FR-TRN-003] |
| TRN-08 | BLOCKED_DEP | detection metrics/test | TRN-06 | mAP50:95/AP50/AP75/class/PRをfixture検算 | [S-IP §7 Phase I][S-RD FR-REP-003] |
| TRN-09 | BLOCKED_GATE2 | versioned policies/test | SPI-15〜18, D-15 | 実測有限budget/search space、unused optionなし | [S-IP §7 Phase I][S-RD FR-TRN-006〜009] |
| TRN-10 | BLOCKED_DEP | classification Optuna/test | TRN-04,05,09 | TPE+pruning、全parameter/中間値report | [S-IP §7 Phase I][S-RD FR-TRN-008] |
| TRN-11 | BLOCKED_DEP | detection Optuna/test | TRN-07〜09 | 検出固有search、全値report | [S-IP §7 Phase I][S-RD FR-TRN-008] |
| TRN-12 | BLOCKED_DEP | budget/test | TRN-10,11 | wall-clock、mini-run estimate、prune reason | [S-IP §7 Phase I][S-RD NFR-PERF-007] |
| TRN-13 | BLOCKED_DEP | checkpoint/test | TRN-10,11 | compatible Interruptedだけresume、Cancelled不可 | [S-IP §7 Phase I][S-ADR2 §3.5] |
| TRN-14 | BLOCKED_DEP | train command、CLI、test | AST-04, TRN-10〜13,25〜28 | allowlist dispatch、baseline/selection/failureを返す | [S-IP §7 Phase I][S-RD FR-TRN-001〜021] |
| TRN-15 | BLOCKED_DEP | training service/IPC/preload/test | TRN-14, JOB-07 | queue/cancel/resume/progress | [S-IP §7 Phase I][S-RD UI-05] |
| TRN-16 | BLOCKED_MODEL | classification ONNX/test | TRN-04 | fixed FP32 shape、pre/post metadata | [S-IP §7 Phase I][S-RD FR-TRN-018] |
| TRN-17 | BLOCKED_MODEL | detection ONNX/test | TRN-07 | fixed shape/output/coordinate意味 | [S-IP §7 Phase I][S-RD FR-TRN-018] |
| TRN-18 | BLOCKED_DEP | classification parity/test | TRN-05,16 | RD threshold実測、超過Run Failed | [S-IP §7 Phase I][S-RD FR-TRN-018] |
| TRN-19 | BLOCKED_DEP | detection parity/test | TRN-08,17 | mAP差実測、超過Run Failed | [S-IP §7 Phase I][S-RD FR-TRN-018] |
| TRN-20 | BLOCKED_DEP | `006_training.sql`、model repository/test | TRN-18,19 | version/parent/revision/hash/license不変、Succeededだけ | [S-IP §7 Phase I][S-RD FR-MOD-001/002] |
| TRN-21 | BLOCKED_DEP | atomic model commit/test | TRN-20 | hash→rename→1 transaction、Succeededだけ | [S-IP §7 Phase I][S-ADR2 §3.6] |
| TRN-22 | BLOCKED_DEP | additional training/test | ANN-20, TRN-21 | base明示、class一致、親非変更 | [S-IP §7 Phase I][S-RD FR-TRN-004/005/021] |
| TRN-25 | BLOCKED_MODEL | classification scratch baseline/test | TRN-04 | scratch/Fine-Tuningを同split/budget比較 | [S-IP §7 Phase I][S-RD FR-TRN-003] |
| TRN-26 | BLOCKED_MODEL | detection scratch baseline/test | TRN-07 | 同条件比較と採否理由 | [S-IP §7 Phase I][S-RD FR-TRN-003] |
| TRN-27 | BLOCKED_DEP | best selection/test | TRN-10,11 | validation→latency→size→stability、test split不使用 | [S-IP §7 Phase I][S-RD FR-TRN-016] |
| TRN-28 | BLOCKED_DEP | failure classification/test | TRN-02 | unsupported/OOM/disk/read、縮小1回、CPU候補 | [S-IP §7 Phase I][S-RD FR-TRN-020] |
| TRN-29 | BLOCKED_DEP | AdditionalTraining UI/test | TRN-22 | 成功版選択、schema不一致block | [S-IP §7 Phase I][S-RD FR-TRN-004/021] |
| TRN-30 | BLOCKED_DEP | delete model service/IPC/test | TRN-20 | 使用中/親依存preview、子lineage非破壊 | [S-IP §7 Phase I][S-RD FR-MOD-004] |
| TRN-31 | BLOCKED_DEP | model preload/delete dialog/test | TRN-30 | narrow IPC、依存表示、明示確認 | [S-IP §7 Phase I][S-RD FR-MOD-004] |
| TRN-32 | BLOCKED_GATE2_3 / MAC_NOT_RUN | classification training E2E | TRN-15,18,21,25,27〜29 | revision→v1→追加v2、baseline/failureをOS別実証 | [S-IP §7 Phase I][S-RD POC-01] |
| TRN-33 | BLOCKED_GATE2_3 / MAC_NOT_RUN | detection training E2E | TRN-15,19,21,26〜29 | revision→ONNX→version、baseline/failure | [S-IP §7 Phase I][S-RD POC-02] |
| DOC-05 | BLOCKED_DEP | training/version guide | DOC-04, TRN-31〜33 | auto start、budget、cancel/resume、追加、削除を実画面で記載 | [S-IP §7 Phase I][S-CONTRIB §2] |

## 15. Phase I.1 — Project Model Assist（3件）

直列は`AST-08 → AST-23 → AST-24 → DOC-10`。[S-IP §7 Phase I.1]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| AST-23 | BLOCKED_TRN21 | service/selector UI/backend test | AST-08,09,19, TRN-21 | 最新Succeeded既定、別版選択、threshold、task/schema一致 | [S-IP §7 Phase I.1][S-RD FR-AST-002/016] |
| AST-24 | BLOCKED_DEP / MAC_NOT_RUN | classification/detection E2E | AST-14, AST-23 | POC-17、version/hash/provenance、confirmed非上書き | [S-IP §7 Phase I.1][S-RD POC-17] |
| DOC-10 | BLOCKED_DEP | Project model assist guide | DOC-05, AST-24 | 既定版、版選択、再生成対象、threshold由来 | [S-IP §7 Phase I.1][S-CONTRIB §2] |

## 16. Phase J — Report（12件）

waveは`REP-11,01,02,03 → REP-04〜09 → REP-10 → DOC-06`。[S-IP §7 Phase J]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| REP-11 | BLOCKED_DEP | chart dependency採否、lock/policy | A-05, B-01, D-13 | current一次資料/license/bundle/a11y比較。native SVGで足りれば追加なし | [S-IP §7 Phase J][S-DEP §10] |
| REP-01 | BLOCKED_DEP | TrainingRunPage/test | TRN-15 | state/trial/epoch/metric/time/ETA/device実値 | [S-IP §7 Phase J][S-RD UI-05] |
| REP-02 | BLOCKED_DEP | versions list/compare/test | TRN-20 | metric/size/latency/revision/parent、欠測非推測 | [S-IP §7 Phase J][S-RD FR-MOD-005] |
| REP-03 | BLOCKED_DEP | report service/IPC/preload/test | TRN-20 | read-only DTO、sender/schema、Project分離 | [S-IP §7 Phase J][S-RD FR-REP-001] |
| REP-04 | BLOCKED_DEP | classification report/test | REP-03, REP-11 | 全分類指標、loss、confusion | [S-IP §7 Phase J][S-RD FR-REP-002] |
| REP-05 | BLOCKED_DEP | detection report/test | REP-03, REP-11 | mAP/AP/class/PR/loss | [S-IP §7 Phase J][S-RD FR-REP-003] |
| REP-06 | BLOCKED_DEP | result gallery/overlay/test | REP-03, ANN-11, DAT-12 | candidate/IoU/FP/FN/GT/Prediction/Reference relink | [S-IP §7 Phase J][S-RD FR-REP-005〜008] |
| REP-07 | BLOCKED_DEP | TrialTable/test | REP-03 | 全hyperparameter、中間値、prune reason | [S-IP §7 Phase J][S-RD FR-REP-004] |
| REP-08 | BLOCKED_DEP | environment/license/assist tabs/test | REP-03, AST-16 | OS/device/library/seed/time/memory/hash/license/provenance実値 | [S-IP §7 Phase J][S-RD FR-REP-009/011/012] |
| REP-09 | BLOCKED_DEP | local export backend/test/button | REP-03 | JSON/CSV、画像は明示選択だけ | [S-IP §7 Phase J][S-RD FR-REP-010] |
| REP-10 | BLOCKED_DEP / MAC_NOT_RUN | classification/detection report E2E | REP-04〜09 | UI-06とFR-REPをtask別fixtureでOS別実証 | [S-IP §7 Phase J][S-RD UI-06] |
| DOC-06 | BLOCKED_DEP | report guide | DOC-10, REP-10 | metricの読み方、score≠正解確率 | [S-IP §7 Phase J][S-CONTRIB §2] |

## 17. Phase K — Camera inference（20件）

waveは`INF-01,16 → 02 → 17 → 03,18 → 04 → 05 → 06,19 → 07,08,09 → 10 → 11 → 12 → 13 → 14,15 → DOC-07`。[S-IP §7 Phase K]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| INF-01 | BLOCKED_GATE1 | permission backend/IPC/test | B-05 | app origin video+user gestureだけ許可、audio/他拒否 | [S-IP §7 Phase K][S-RD FR-INF-003〜007] |
| INF-02 | BLOCKED_DEP | CameraSelector/test | INF-01 | device list、permission前は不明と表示 | [S-IP §7 Phase K][S-RD FR-INF-002] |
| INF-03 | BLOCKED_DEP | camera stream hook/test | INF-17 | audio:false、start/stop/disconnect、2秒内release、非保存 | [S-IP §7 Phase K][S-RD FR-INF-007/016/017] |
| INF-04 | BLOCKED_DEP | 10Hz sampler hook/test | INF-03 | monotonic 100ms、fixed RGB、偽10Hz禁止 | [S-IP §7 Phase K][S-RD FR-INF-008] |
| INF-05 | BLOCKED_DEP | TS/Python frame protocol/test | SPI-07, INF-04 | length/shape/size/session、no base64 | [S-IP §7 Phase K][S-ADR1 §2.5] |
| INF-06 | BLOCKED_MODEL | Python inference session/test | INF-05, AST-01 | one ORT session、EP→CPU、warm-up、CoreML cache分離 | [S-IP §7 Phase K][S-RD FR-INF-015/016/018] |
| INF-07 | BLOCKED_DEP | Main supervisor/test | INF-06, INF-19 | spawn/write/read/kill/hash/failure cleanup | [S-IP §7 Phase K][S-ADR1 §2.5] |
| INF-08 | BLOCKED_DEP | classification postprocess/test | INF-06, TRN-16 | top-3/class/score/metadata一致 | [S-IP §7 Phase K][S-RD FR-INF-012] |
| INF-09 | BLOCKED_DEP | detection postprocess/test | INF-06, TRN-17 | model box/class/threshold/reverse coordinate | [S-IP §7 Phase K][S-RD FR-INF-013/015] |
| INF-10 | BLOCKED_DEP | latest-frame queue/test | INF-07 | in-flight+pending1、replace、drop count | [S-IP §7 Phase K][S-RD FR-INF-009] |
| INF-11 | BLOCKED_DEP | page/overlay/test | INF-08〜10 | classification/detection、GTと分離 | [S-IP §7 Phase K][S-RD UI-07] |
| INF-12 | BLOCKED_DEP | metrics/error UI/test | INF-11 | actual FPS/p95/drop/provider/fallback/error実値 | [S-IP §7 Phase K][S-RD FR-INF-010/011/018] |
| INF-13 | BLOCKED_DEP | Electron fake-camera E2E | INF-12,16〜19 | model/camera/profile/consent/lifecycle/queue/overlay/contention | [S-IP §7 Phase K][P09] |
| INF-14 | BLOCKED_DEP / MAC_NOT_RUN | packaged OS permission manual | INF-13 | notDetermined/granted/denied/restricted/disconnectをOS別 | [S-IP §7 Phase K][S-RD POC-07] |
| INF-15 | BLOCKED_HARDWARE | 30-minute benchmark/template | INF-13 | recommended hardwareでservice<100ms、p95、dropを実測 | [S-IP §7 Phase K][S-RD FR-INF-010/NFR-PERF-004] |
| INF-16 | BLOCKED_DEP | `007_inference.sql`、profile/test | CORE-03, TRN-21 | Project別成功model/camera/threshold/display validate | [S-IP §7 Phase K][S-RD FR-INF-014] |
| INF-17 | BLOCKED_DEP | setup/consent UI/test | INF-02, INF-16 | 成功版選択、OS prompt前説明と明示同意 | [S-IP §7 Phase K][S-RD FR-INF-001/004] |
| INF-18 | BLOCKED_DEP | contention backend/dialog/test | INF-17, JOB-05 | accelerator競合時に学習停止/CPUを明示選択 | [S-IP §7 Phase K][S-RD FR-INF-019] |
| INF-19 | BLOCKED_DEP | IPC/preload/contracts/test | INF-04〜05 | origin/session/shape検証、result/metricsだけ返す | [S-IP §7 Phase K][S-RD FR-SEC-006] |
| DOC-07 | BLOCKED_DEP | camera guide | DOC-06, INF-14,15,18 | permission、非保存、profile、競合、実測warning | [S-IP §7 Phase K][S-CONTRIB §2] |

## 18. Phase L — Security / Reliability / Performance（24件）

Gate 4 PASSまで全体hardening完了を宣言しない。waveは個別依存成立後のL1並列、`LIC-02/STO-02 → STO-03 → PERF-03 → DOC-08`。[S-IP §7 Phase L]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| SEC-01 | BLOCKED_GATE4 | CSP/navigation/window hardening/test | B-05, B-07, Gate 4 | remote/openExternal/new window deny、CSP、implicit download停止 | [S-IP §7 Phase L][P01] |
| SEC-02 | BLOCKED_ALL_IPC | sender validator/test、IPC audit | 全IPC | 全channel sender+schema、raw API 0 | [S-IP §7 Phase L][S-RD FR-SEC-006] |
| SEC-03 | BLOCKED_DEP | path adversarial test | DAT-14 | encoded traversal、junction/symlink、race、Project越境拒否 | [S-IP §7 Phase L][S-RD FR-SEC-008] |
| SEC-04 | BLOCKED_DEP | decoder security test | DAT-03 | 実pixel/byte/decompression上限 | [S-IP §7 Phase L][S-RD FR-SEC-008] |
| SEC-05 | BLOCKED_MODEL | safe model loader/test | AST-01 | approved ONNX/safetensors/weights-only、pickle/remote拒否 | [S-IP §7 Phase L][S-RD FR-SEC-007] |
| SEC-06 | BLOCKED_GATE4 | offline E2E/URL scan | Gate 4 | app outbound 0、source/build URL allowlist | [S-IP §7 Phase L][S-RD FR-SEC-002/003/013] |
| SEC-07 | BLOCKED_DEP | redaction/diagnostic export/test | JOB-04 | imageなし、username mask、explicit export、項目preview | [S-IP §7 Phase L][S-RD FR-SEC-010] |
| SEC-08 | BLOCKED_DEP | Node/Python audit scripts/tests/policy | B-01, B-11 | lock/native監査、未承認Critical/Highでfail、例外期限 | [S-IP §7 Phase L][S-DEP §11] |
| REL-01 | BLOCKED_DEP | atomic write helper/test | CORE-01 | temp/hash/rename/cleanup/failure injection | [S-IP §7 Phase L][S-ADR2 §3.6] |
| REL-02 | BLOCKED_DEP | DB backup/test | CORE-03 | upgrade前backup、migration rollback | [S-IP §7 Phase L][S-RD NFR-REL-002] |
| REL-03 | BLOCKED_DEP | crash recovery E2E | JOB-06, TRN-13 | Interruptedだけresume、metadata非破損 | [S-IP §7 Phase L][S-RD POC-05] |
| REL-04 | BLOCKED_DEP | delete project/test | CORE-10, ANN-19, AST-03 | owned削除、Reference保持、失敗報告 | [S-IP §7 Phase L][S-ADR2 §3.8] |
| LIC-01 | BLOCKED_PAYLOAD | SBOM/license scripts/tests/notice template | A-05 | TS/Python/native/model、unknown/禁止fail、C0条件を実装 | [S-IP §7 Phase L][S-DEP §§7,12][S-C0 §§3〜5] |
| LIC-02 | BLOCKED_DEP | LicensesPage/IPC/test | LIC-01 | UI-08でSBOM/notices/model provenance | [S-IP §7 Phase L][S-RD FR-LIC-012] |
| LIC-03 | BLOCKED_DEP | CUDA decision/verify/tests | SPI-03, A-05 | 採用版EULA/allowlist。不採用ならCPU fallbackを記録 | [S-IP §7 Phase L][S-DEP §8] |
| STO-01 | BLOCKED_DEP | storage usage/test | CORE-01, TRN-20 | entity別実使用量、Reference symlink先非計上 | [S-IP §7 Phase L][S-RD NFR-STO-002] |
| STO-02 | BLOCKED_DEP | generated-data deletion/test | STO-01, JOB-02 | cache/Failed一時checkpointだけ安全削除 | [S-IP §7 Phase L][S-RD NFR-STO-003] |
| STO-03 | BLOCKED_DEP | StoragePage/test | STO-01,02, LIC-02 | UI-08内訳、preview/result、notice導線 | [S-IP §7 Phase L][S-RD UI-08] |
| ACC-01 | BLOCKED_ALL_UI / MAC_NOT_RUN | accessibility E2E/manual | 全主要UI | keyboard/focus/label/screen reader/200%をOS別 | [S-IP §7 Phase L][S-RD NFR-UX-003] |
| UX-01 | BLOCKED_ALL_UI | Japanese/visual semantics audit | 全主要UI | 必須画面/error/permission/report日本語、色だけ禁止 | [S-IP §7 Phase L][S-RD NFR-UX-001/002] |
| PERF-01 | BLOCKED_DEP | annotation benchmark/template | ANN-28 | 4K/100 box p95を基準hardwareで実測 | [S-IP §7 Phase L][S-RD NFR-ANN-002] |
| PERF-02 | BLOCKED_DEP | contention benchmark/template | TRN-33, INF-15,18 | warning、training stop/CPU、OOMなしを実測 | [S-IP §7 Phase L][S-RD FR-INF-019] |
| PERF-03 | BLOCKED_DEP | UI benchmark/template | REP-10, STO-03 | metadata/画面遷移p95 500msを実測 | [S-IP §7 Phase L][S-RD NFR-PERF-001] |
| DOC-08 | BLOCKED_DEP | troubleshooting/security/storage guide | DOC-07, SEC-01〜08, REL-03/04, STO-03 | 実装済みpermission/reference/disk/OOM/cache/diagnosticだけ | [S-IP §7 Phase L][S-CONTRIB §2] |

## 19. Phase M — Installer / Servicing（23件）

Gate 4 PASS、LIC-03、OS別環境/identityが必要。`electron-builder.yml`はPKG-04→05→06の直列。[S-IP §7 Phase M][S-ADR3]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| PKG-01 | BLOCKED_MODEL_GATE2 | model verifier/test/manifest | AST-01, Gate 2 | approved local hashだけ、download/余剰/欠落拒否 | [S-IP §7 Phase M][S-DEP §6] |
| PKG-02 | BLOCKED_GATE4 | Windows worker spec/build script | SPI-03, LIC-03, Gate 4 | production commands/torch/ORT onedir、承認CUDAのみ | [S-IP §7 Phase M][S-ADR3 §2.4] |
| PKG-03 | MAC_NOT_RUN | macOS worker spec/build script | SPI-04, Gate 4 | native arm64 onedir、nested Mach-O一覧 | [S-IP §7 Phase M][S-ADR3 §10] |
| PKG-04 | BLOCKED_DEP | common builder config/resource verifier/test | PKG-01 | app/worker/model/noticesをextraResources、OS設定なし | [S-IP §7 Phase M][P03] |
| PKG-05 | BLOCKED_DEP | Windows NSIS config | PKG-02,04 | per-user one-file offline EXE、restartなし | [S-IP §7 Phase M][P02] |
| PKG-06 | MAC_NOT_RUN / BLOCKED_DEP | macOS PKG/entitlements、shared config固定 | PKG-03,05 | `/Applications`、arm64、最小entitlement | [S-IP §7 Phase M][P02][P04] |
| PKG-07 | BLOCKED_SIGN_WIN | Windows sign/verify scripts | PKG-09,10,19, D-16 | installer/全PEをCA chain+SHA-256/RFC3161検証 | [S-IP §7 Phase M][S-RD FR-INS-008] |
| PKG-08 | MAC_NOT_RUN / BLOCKED_SIGN_MAC | macOS sign/notarize/verify | PKG-09,10,20, D-16 | nested code、HR、PKG sign、notary、staple、Gatekeeper | [S-IP §7 Phase M][S-RD FR-INS-010] |
| PKG-09 | BLOCKED_DEP | version compatibility/test | REL-02 | same repair、newer拒否、backup migration、rollback | [S-IP §7 Phase M][S-RD FR-INS-015/016] |
| PKG-10 | BLOCKED_DEP | project retention/test | PKG-05,06, REL-04 | uninstallでapp/runtime削除、Project既定保持 | [S-IP §7 Phase M][S-RD FR-INS-020] |
| PKG-11 | BLOCKED_SIGN_WIN | Windows clean install script/result | PKG-07,19 | offline標準user/no runtimes/restartなし/15秒/Project | [S-IP §7 Phase M][S-RD POC-11] |
| PKG-12 | MAC_NOT_RUN / BLOCKED_SIGN_MAC | macOS clean install script/result | PKG-08,20 | offline/no Rosetta/Homebrew/Xcode/Gatekeeper/15秒 | [S-IP §7 Phase M][S-RD POC-12] |
| PKG-13 | BLOCKED_DEP / MAC_NOT_RUN | OS servicing scripts | PKG-09〜12 | upgrade/repair/forced rollback/uninstallをOS別実機 | [S-IP §7 Phase M][S-RD POC-13] |
| PKG-14 | BLOCKED_DEP | offline install evidence/payload inventory | PKG-11〜13,21,22 | stub/download 0、payload=SBOM/hash、余剰0 | [S-IP §7 Phase M][S-RD NFR-INS-007] |
| PKG-15 | BLOCKED_DEP | checksum script/test/release docs | PKG-14 | EXE/PKG命名とSHA-256生成・再検証 | [S-IP §7 Phase M][S-RD FR-INS-001/002] |
| PKG-16 | BLOCKED_DEP | size generator/schema/test | PKG-04 | OS別圧縮/展開/temp+10%を実測manifest化 | [S-IP §7 Phase M][S-RD NFR-INS-003] |
| PKG-17 | BLOCKED_DEP | NSIS preflight/test | PKG-06,16 | OS/arch/disk/write/versionを変更前検査、日本語停止 | [S-IP §7 Phase M][S-RD FR-INS-007] |
| PKG-18 | MAC_NOT_RUN | macOS preinstall/test | PKG-06,16 | OS/arm64/disk/write/versionをinstall前検査 | [S-IP §7 Phase M][S-RD FR-INS-007] |
| PKG-19 | BLOCKED_DEP | Windows installer messages/UX/test | PKG-09,17 | 日本語progress/error/complete、Start、log、servicing | [S-IP §7 Phase M][S-RD FR-INS-012/017〜020] |
| PKG-20 | MAC_NOT_RUN | macOS postinstall/UX/test | PKG-09,18 | Installer UI、Applications、log、servicing、no Terminal | [S-IP §7 Phase M][S-RD FR-INS-011/012/017] |
| PKG-21 | BLOCKED_MAC | payload parity compare/result | PKG-11,12 | schema/model/feature/notices一致、OS binary差だけ | [S-IP §7 Phase M][S-RD NFR-INS-008] |
| PKG-22 | BLOCKED_DEP / MAC_NOT_RUN | installer accessibility manual | PKG-19,20 | keyboard/screen readerで全stateをOS別確認 | [S-IP §7 Phase M][S-RD NFR-INS-004] |
| DOC-09 | BLOCKED_DEP | install/upgrade/uninstall guide | DOC-08, PKG-11〜22 | OS別の実測済み手順だけ記載 | [S-IP §7 Phase M][S-CONTRIB §2] |

## 20. Phase N — Final acceptance（7件）

waveは`FIN-01,03,04 → FIN-02,05,06 → FIN-07`。[S-IP §7 Phase N]

| ID | 現在 | 成果物 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| FIN-01 | BLOCKED_ALL_FEATURES | `docs/traceability.md` | 全feature test | 229 requirement→task→test→OS/statusを1件ずつ照合 | [S-IP §7 Phase N][S-RD §17] |
| FIN-02 | BLOCKED_DEP / MAC_NOT_RUN | `docs/test-matrix.md` | FIN-01 | Windows/macOS、CPU/accelerator、manual/automated/NOT_RUN | [S-IP §7 Phase N][S-RD NFR-MNT-003] |
| FIN-03 | BLOCKED_ALL_POC | `docs/acceptance-report.md` | POC-01〜17相当test | hardware、実値、failure、waiver、raw evidence | [S-IP §7 Phase N][S-RD §15] |
| FIN-04 | BLOCKED_ALL_DOC | `docs/users-guide.md`最終review | DOC-01〜10 | UI文言/導線/link、screenshotは実画面のみ | [S-IP §7 Phase N][S-CONTRIB §5] |
| FIN-05 | BLOCKED_DEP | `README.md` | FIN-03/04 | 実態の概要、対応OS、docs、license/model caveat | [S-IP §7 Phase N][S-RD §16] |
| FIN-06 | BLOCKED_DEP | `docs/release-checklist.md` | LIC-01〜03, SEC-08, PKG-15, FIN-03 | signing/SBOM/vulnerability/model/offline/rollback evidence | [S-IP §7 Phase N][S-DEP §12] |
| FIN-07 | BLOCKED_DEP | acceptance/checklist Gate 5判定 | FIN-01〜06 | 必須未達1件でもrelease停止を明記 | [S-IP §7 Phase N][S-RD §16] |

## 21. 直列化・並列lane

次は同時編集しない。[S-IP §§5.1,7][S-CONTRIB §3]

- `ml/src/autovision_ml/cli.py`: CORE-11 → DAT-01 → AST-04 → TRN-14。
- `docs/users-guide.md`: DOC-01 → DOC-02 → DOC-03 → DOC-04 → DOC-05 → DOC-10 → DOC-06 → DOC-07 → DOC-08 → DOC-09 → FIN-04。
- `resources/models/manifest.json`: SPI-18 → AST-01（reader）→ PKG-01。
- `electron-builder.yml`: PKG-04 → PKG-05 → PKG-06。
- migration: `001_core → 002_jobs → 003_import → 004_annotations → 005_suggestions → 006_training → 007_inference`。
- shared contract変更taskと、それを読むclassification/detection lane。
- package/lock変更taskと、同じlockを前提にするbuild/audit task。

安全な並列単位は、依存済みかつ出力fileが重ならないUI / Core / ML-Class / ML-Detect / Release-Windows / Release-macOS / Docs laneだけ。Docsは実装より先行しない。[S-IP §5.1]

## 22. Wave後の統合Gate

各wave終了時に次を実行し、実行した範囲と件数を記録する。[S-CONTRIB §§2,5,8]

1. 対象Node/Python tests。
2. `npm run typecheck`、Ruff、Pyright。
3. 影響するMain/Preload/Renderer build。
4. lock変更taskではclean install、pending scripts、integrity/hash、license、vulnerability。
5. Electron/worker integration変更では実process smoke。
6. `git diff --check`、editor diagnostics。
7. 独立敵対レビューと指摘再現。
8. macOS未実施をWindows PASSへ混在させない。

全suiteはphase gateで実行し、個別task中に無関係failureを隠すためのskip/ignoreを追加しない。[S-CONTRIB §§2,12]

## 23. Task commit証拠テンプレート

| 欄 | 必須内容 | 出典 |
|---|---|---|
| Task / requirements | task ID、対象FR/NFR、非対象 | [S-IP §4][S-IP §9] |
| Baseline | parent SHA、依存task/Gate evidence | [S-CONTRIB §10] |
| Environment | OS/build/arch/CPU/GPU、tool exact version | [S-CONTRIB §§5〜7] |
| Changes | 正本に列挙されたfileだけ | [S-IP §4.4] |
| Verification | command、exit、test数、artifact hash、実値 | [S-CONTRIB §§2,5] |
| Adversarial review | finding、再現、裁定、修正、再検証 | [S-CONTRIB §2.2] |
| External evidence | URL、取得日、document/release版、copy/hash | [S-CONTRIB §5][S-DEP §6] |
| Remaining blockers | OS/model/license/identity/hardware | [S-IP §6] |
| Status | VERIFIED / PARTIAL / BLOCKED / NOT_RUN | [S-CONTRIB §§2,7] |

## 24. 期間・性能・費用の扱い

- 230件の所要日数は、task velocity、CI時間、model取得可否、fixture、GPU、署名identityが未確定なので見積もらない。[S-RD §§2.2,12,18]
- 学習時間、trial数、accuracy、10Hz達成、installer sizeは実測前に数値を置かない。[S-RD FR-TRN-009/018, FR-INF-010, TBD-03][S-IP D-15]
- 既存の要求値（5秒、100ms、15秒、20%/10%余裕）は正本の受入閾値であり、現在の達成実績ではない。[S-RD §§8,11]
- 外部service費用は通常runtimeで0を前提とするが、証明書、Apple Developer Program、build hardwareの費用は本書で未調査のため金額を記載しない。[S-RD §3.3][S-ADR3 §6]

## 25. 全残task完了条件

次を全て満たしたときだけ「全230件完了」とする。[S-IP §§6〜7][S-RD §§15〜16]

1. 230 taskが個別VERIFIED、敵対レビューCLOSED、main統合済み。
2. Gate 1〜5が正本どおりPASS。macOS要求を維持する限りnative Apple Silicon証拠が必要。
3. 229 requirementがtest/manual evidenceへ欠落なくtraceされる。
4. classification/detectionのannotation、initial/project assist、training、ONNX parity、report、cameraが成立。
5. runtime outbound 0、unconfirmed suggestion 0、unknown license 0、未承認Critical/High 0。
6. C0条件のSBOM/NOTICE/MPL source案内/build-only分離がfinal payloadで成立。
7. Windows EXEとmacOS PKGが正本scopeどおり正式署名、自己完結、offline clean install/servicing済み。
8. SBOM、NOTICE、model manifest、payload inventory、checksumが一致。
9. guide/READMEが実装・実測と一致し、未実装手順や推測値がない。
10. 不要worktree/branchなし、working tree clean、handoff commitから再現可能。

条件未達でもFIN-07は実行できるが、Gate 5をPASSにせずrelease停止を記録する。[S-IP FIN-07]

## 26. 出典・hash台帳

### 26.1 正本とrepository資料

以下は2026-09-03にbyte sizeとSHA-256を実測した。[E-HASH]

| ID | file | bytes | SHA-256 | 用途 |
|---|---|---:|---|---|
| S-RD | `docs/requirement-definition.md` | 113,025 | `2F1C57DA192710FFB2FD764C7E342CF2E9106FA7387BE7393133873CC815052F` | 229 requirements、PoC、受入、S1〜S55 |
| S-IP | `docs/implementation-plan.md` | 101,081 | `80FF81B3550BBB935CB7BEDD59B5A20A832E340409F7D0762C14F58FD859BFE8` | 253 tasks、DAG、Gate、P01〜P16 |
| S-CONTRIB | `CONTRIBUTING.md` | 9,051 | `872FC2CD8E17F67DC3EED0CA6C2154D8C75822D986EB2D96FB356A1D7B2E4CDD` | task/test/review/OS/Git規約 |
| S-ADR1 | `docs/adr/0001-process-architecture.md` | 12,776 | `EA12C4F2B9C23FF425FCB7ACC0EF18987A2621904A1AEB19E48F995475293A87` | process/IPC/worker境界 |
| S-ADR2 | `docs/adr/0002-data-lifecycle.md` | 27,284 | `61E3EBF93437AFE2890DD74200A26EB7C12B6A1A2583B181DBD2A1CB12B896A1` | 不変性、Reference、削除 |
| S-ADR3 | `docs/adr/0003-packaging.md` | 23,820 | `0058C3DE7E448A325189B3B8695B9E605D664F381C267FE91C9F205734A33721` | installer、signing、OS native build |
| S-DEP | `docs/dependency-policy.md` | 21,555 | `0AD8DF476A5B15DB309D7F1374B69A80042614F31C35C07869C7E438DA9C5028` | license、lock、SBOM、vulnerability |
| S-C0 | `docs/dependency-adoption/c0-review.md` | 13,603 | `992F847C0970B72F6B449F5BD48310EEF415EA9C979DEEB95C148B54D524EA76` | C0 closure、license裁定、B-GATE |
| S-MODEL | `docs/model-governance/adoption-template.md` | 23,132 | `F9C25B60FD2E70DD6D3450E0940E8B236EAB7109EAA2EC390EF224F128878085` | C5/C6/C7/C8採用証拠 |
| S-NODE | `package.json` | 1,851 | `FF453837A63E1CBEC14D8630F5EC477D562A7DAEF85A384B18A9CAB840781F55` | Node/npm engine、exact direct依存 |
| S-NPMLOCK | `package-lock.json` | 250,434 | `7F1BD82EFE1E4919DCE6DDFFDB763CEFF4404D29B60E8E946A150345A8DFE1A5` | Node exact transitive lock |
| S-PY | `ml/pyproject.toml` | 2,164 | `4631204BA6C1F632F92C5273462C92EC1CAF15BA15491FD0C03382AAF288F6FE` | Python target、direct依存、tool config |
| S-UVLOCK | `ml/uv.lock` | 80,531 | `D14D188A0D1F92F34A9436ECC0B2C801BB0375B36619199F846924C112C7E5FC` | Python exact universal lock |
| S-USERS | `docs/users-guide.md` | 32,647 | `2646765891F9F50F050E62EA23CFBDE723F6920AA914C1A81F68E9F5505F6EC8` | 段階更新するguide |
| S-MANIFEST-SCHEMA | `resources/models/manifest.schema.json` | 22,472 | `AEA75BAFE864B36E268F075A6F87B850AF585B099F0FD73B9BA2631D25E75AE0` | fail-closed model schema |
| S-MANIFEST | `resources/models/manifest.json` | 648 | `7FE41F5BC497D48FFCBBAEBAEB5CB02E91DFBA0E1A6FE9B66D8CF8928C437A61` | 現在models=[]、未承認modelなし |
| H-OLD | `work/20260903-0605-TaskExecutionPlan.md` | 61,727 | `405CCC752318A2A856EDF6A30B91E73D251EE2C38A46F78260152CD36DFA2E25` | C0前の履歴計画。現在状態の根拠にはしない |

### 26.2 Git・実測証拠

- **[E-GIT]** 2026-09-03、`git rev-parse HEAD`、`git branch --show-current`、`git status --porcelain`、`git rev-parse origin/main`、`git rev-list --left-right --count origin/main...HEAD`、`git worktree list`、`git for-each-ref`。結果は§2.1。[本書作成session]
- **[E-ENV]** 2026-09-03、PowerShell、Win32_OperatingSystem、Win32_Processor、`Get-Command`、各`--version`を実行。結果は§2.1。[本書作成session]
- **[E-HASH]** 2026-09-03、PowerShell 7.6.5 `Get-FileHash -Algorithm SHA256`と`Get-Item.Length`。結果は§26.1。[本書作成session]
- **[E-COUNT]** Node parserで`docs/implementation-plan.md`の行頭task tableだけを解析。253 rows / 253 unique / duplicate 0。prefix内訳: A10、B13、SPI19、CORE14、DOC10、JOB8、DAT15、ANN28、AST23、TRN31、REP11、INF19、SEC8、REL4、LIC3、STO3、ACC1、UX1、PERF3、PKG22、FIN7。C0管理IDは別に4件。[本書作成session]
- **[E-A]** commit `98aba1fdd609b546641e9be80b600651e0476fc6`がA-01〜06、A-08〜10の成果物群を追加し、commit `e92ad5989c88b0c4d148096eab69ae13422bc625`がA-07 manifest/schemaの2,192 negative/positive variantsと敵対レビューを記録。現存成果物は[S-IP Phase A]と一致する。[Git history]
- **[E-B]** B-01〜13のtask commit列は`c01be9354d0b77153e571510f2c1c294cbc5da00`〜`4cec3a9c8244a95d4a3bfc5eb73ac5e7b82e8850`。最新Windows統合証拠は[S-C0 §8]の19 Node tests、4 Python tests、type/lint/build/window smoke。[Git history][S-C0]
- **[E-C0]** `fff9df2a79e144ac8fea57d4269edccd6045b8c4`。MIT基準license裁定、C0 CLOSED、Windows B-GATE PASS、working tree clean。[Git history][S-C0]
- **[E-REVIEW]** 2026-09-03、独立read-only reviewerが正本、Git history、C0、全230 task行、status/DAG、引用、handoff、tool bootstrap、macOS waiver、外部blocker、hashを照合。blocking finding 0。[本書作成session]

### 26.3 外部一次資料索引

本書が利用する外部資料の完全なURL・取得時点・用途は次の正本索引にある。各taskで再取得する。[S-RD §19][S-IP §12]

- **[P01]** Electron Security — `https://www.electronjs.org/docs/latest/tutorial/security`
- **[P02]** electron-builder NSIS / PKG — `https://www.electron.build/nsis.html`, `https://www.electron.build/pkg.html`
- **[P03]** electron-builder Application Contents — `https://www.electron.build/contents.html`
- **[P04]** electron-builder macOS signing/notarization — `https://www.electron.build/code-signing-mac.html`
- **[P05]** PyInstaller operating mode / OS support — `https://pyinstaller.org/en/stable/operating-mode.html`, `https://pyinstaller.org/en/stable/usage.html#supporting-multiple-operating-systems`
- **[P06]** Konva selection/bounds — `https://konvajs.org/docs/select_and_transform/Basic_demo.html`, `https://konvajs.org/docs/sandbox/Limited_Drag_And_Resize.html`
- **[P07]** ONNX Runtime DirectML EP — `https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html`
- **[P08]** ONNX Runtime CoreML / Node — `https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html`, `https://onnxruntime.ai/docs/get-started/with-javascript/node.html`
- **[P09]** Playwright Electron — `https://playwright.dev/docs/api/class-electron`
- **[P10]** better-sqlite3 repository/license — `https://github.com/WiseLibs/better-sqlite3`, `https://github.com/WiseLibs/better-sqlite3/blob/master/LICENSE`
- **[P11]** uv layout/sync — `https://docs.astral.sh/uv/concepts/projects/layout/`, `https://docs.astral.sh/uv/concepts/projects/sync/`
- **[P12]** Microsoft Windows Installer Best Practices — `https://learn.microsoft.com/windows/win32/msi/windows-installer-best-practices`
- **[P13]** Apple packaging — `https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution`
- **[P14]** Zod docs/license — `https://zod.dev/`, `https://github.com/colinhacks/zod/blob/main/LICENSE`
- **[P15]** Vitest docs/license — `https://vitest.dev/`, `https://github.com/vitest-dev/vitest/blob/main/LICENSE`
- **[P16]** React Testing Library docs/license — `https://testing-library.com/docs/react-testing-library/intro/`, `https://github.com/testing-library/react-testing-library/blob/main/LICENSE`
- **[S1〜S55]** Microsoft/Apple/Electron/ONNX Runtime/PyTorch/Optuna/CV論文/dataset/license/model cardの完全なbibliographyは`docs/requirement-definition.md` §19。番号とURLを改変せず使用する。[S-RD §19]

## 27. 別環境での最初の実行単位

1. §3でhandoff commitを照合する。
2. §4 ENV-GATEを実行し、結果を保存する。
3. Phase C C1のうち出力が重ならない`SPI-01`、`SPI-02`、`SPI-10`、`SPI-11〜14`を個別branch/worktreeへ割り当てる。`SPI-08`と`SPI-19`はWindows部分だけを実行し、task全体はPARTIALにする。[S-IP §5.1, §7 Phase C][S-C0 §6]
4. 最初の統合は依存が少なく検証範囲が明確な`SPI-01`または`SPI-02`を1件だけ完了させ、task commitと敵対レビューを確認してから並列幅を増やす。[S-CONTRIB §§1〜3]
5. model採用taskはbinaryをGitへ入れず、一次資料、取得日、hash、権利とquality evidenceが揃うまで候補をapproved manifestへ追加しない。[S-DEP §6][S-MODEL]

---

**本書の状態:** 作成時点の実測と正本から構成した実行計画であり、未実装taskの完了、macOS PASS、model承認、署名、性能達成を宣言しない。

## 28. 敵対レビューと裁定

独立read-only reviewは次を再計算し、blocking finding 0、handoff可能と判定した。[E-REVIEW]

- 正本253、完了23、残230、欠落/余剰/重複0。
- C0の47 Node + 6 Python裁定、Windows B-GATE PASS、macOS waiverのC0限定境界。
- 全taskの成果物、依存、検証、status、Gate/model/signing blocker。
- handoff ancestry、remote遅延、tool bootstrap、lock不変性、秘密情報境界。
- duration/performance/model/license/signing/macOS結果の非捏造。

reviewerのoptional findingは次のように裁定した。

| ID | 指摘 | 再現 | 裁定 |
|---|---|---|---|
| PR-01 | §2.3の`Node 19 tests`をNode versionと誤読し得る | 文脈上はtest件数だが可読性改善を採用 | `Node test suite 4 files / 19 tests`へ明確化 |
| PR-02 | §4が参照する§26は存在しない | 再現せず。本書に`## 26. 出典・hash台帳`が実在 | 変更なし |

修正後もtask集合、DAG、実測値、引用元は変わらない。最終状態は **VERIFIED — 別Windows環境へhandoff可能** とする。[E-REVIEW]
