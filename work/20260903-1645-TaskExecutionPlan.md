# AutoVision Studio 残227タスク実行・移送計画

| 項目 | 値 | 出典 |
|---|---|---|
| 作成日 | 2026-09-03 16:45基準 | [E-GIT][E-ENV] |
| 対象 | Version 1（MVP）の未完了正本タスク | [S-RD §§1,3][S-IP §7] |
| 対象branch | `main` | [E-GIT] |
| 本書作成直前のcode baseline | `30bc02d70175cb22f0bbb52bd7e888e0a8f6ac28` | [E-GIT] |
| 本書を含むhandoff commit | 本書自身へSHAを埋めると自己参照になるため、移送時に `git log -1 --format=%H -- work/20260903-1645-TaskExecutionPlan.md` で取得する | [S-CONTRIB §10][E-GIT] |
| 作成時remote | `origin/main = e8b03f12a0fe3a06677a1bc78fc8f179009cb210`、code baselineは12 commit先行 | [E-GIT] |
| 要求正本 | `docs/requirement-definition.md` v0.3 Draft、SHA-256 `2F1C57DA192710FFB2FD764C7E342CF2E9106FA7387BE7393133873CC815052F` | [S-RD][E-HASH] |
| タスク正本 | `docs/implementation-plan.md` v0.2 Draft、SHA-256 `80FF81B3550BBB935CB7BEDD59B5A20A832E340409F7D0762C14F58FD859BFE8` | [S-IP][E-HASH] |
| 正本タスク | 253件、ID重複0 | [S-IP §7][E-COUNT] |
| VERIFIED | 26件（A-01〜10、B-01〜13、SPI-01、SPI-02、SPI-07） | [E-A][E-B][E-SPI01][E-SPI02][E-SPI07] |
| 残タスク | **227件**（SPI-03〜Phase N。SPI-03はPARTIAL、SPI-10は未commitのIN_PROGRESSを含む） | [E-COUNT][E-SPI03][E-SPI10] |
| 管理checkpoint | C0-PLAN / C0-NODE / C0-PYTHON / C0-REVIEWは正本253件に含めない。全てCLOSED | [S-C0] |

> **捏造禁止境界:** 実行していないtest、clean host、macOS動作、model承認、署名、性能値、所要時間、成果物をPASSまたは実装済みと記載しない。保存済み実行証拠がある場合だけ`VERIFIED`、一部だけは`PARTIAL`、未実施は`NOT_RUN`、外部条件不足は`BLOCKED`とする。[S-CONTRIB §§2,5,7,10][S-RD §§15〜16]

## 1. 正本・出典・変更管理

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
- 外部URLは[S-RD §19]と[S-IP §12]の索引を起点とする。本書作成時にURL内容を再取得したとは扱わない。各採用taskで最新一次資料を再取得し、取得日、版、URL、保存copy/hashを残す。[S-CONTRIB §5][S-DEP §§6,10]
- 旧計画`work/20260903-1340-TaskExecutionPlan.md`は履歴資料であり、本書作成後の現在状態には使わない。[H-OLD]

## 2. 現在地の実測

### 2.1 Git・環境

2026-09-03にPowerShell 7.6.5 Coreからread-only実測した。[E-GIT][E-ENV]

| 項目 | 実測 | 出典 |
|---|---|---|
| OS | Microsoft Windows 11 Pro Insider Preview 10.0.29648 build 29648、x64 | [E-ENV] |
| CPU | 13th Gen Intel(R) Core(TM) i7-13800H | [E-ENV] |
| PowerShell | Core 7.6.5 | [E-ENV] |
| HEAD / branch | `30bc02d70175cb22f0bbb52bd7e888e0a8f6ac28` / `main` | [E-GIT] |
| remote差分 | `origin/main...HEAD = 0 behind / 12 ahead` | [E-GIT] |
| worktree / local branch | `C:/GitHub/AutoVision-Studio` 1件 / `main` 1本 | [E-GIT] |
| Node | `C:\Program Files\nodejs\node.exe`、24.19.0 | [E-ENV][S-NODE] |
| system npm | `C:\Program Files\nodejs\npm.ps1`、11.17.0。project要件外 | [E-ENV][S-NODE] |
| project npm要件 | 12.0.x、`packageManager=npm@12.0.0` | [S-NODE] |
| uv | `C:\Users\dahatake\.local\bin\uv.exe`、0.12.9 | [E-ENV][S-PY] |
| project Python | CPython 3.14.7（Windows locked environment） | [E-ENV][S-PY] |
| approved model | `resources/models/manifest.json` の `models=[]`、0件 | [S-MANIFEST][E-ENV] |

### 2.2 完了数と残数

| Phase | 正本件数 | VERIFIED | 残 | 現在状態 | 出典 |
|---|---:|---:|---:|---|---|
| A | 10 | 10 | 0 | 完了 | [S-IP §7 Phase A][E-A] |
| B | 13 | 13 | 0 | 完了、Windows B-GATE PASS | [S-IP §7 Phase B][E-B][S-C0] |
| C | 19 | 3 | 16 | SPI-01/02/07完了、SPI-03 PARTIAL、SPI-10 IN_PROGRESS | [S-IP §7 Phase C][E-SPI01][E-SPI02][E-SPI07][E-SPI03][E-SPI10] |
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
| **合計** | **253** | **26** | **227** |  | [E-COUNT] |

`AST-17`、`TRN-23`、`TRN-24`は正本に存在しない欠番であり、補完しない。[S-IP §7][E-COUNT]

ここで「残227件」は`253 - VERIFIED 26`で得た**未完了集合**であり、227件すべてを現在のWindows環境で直ちに実行できるという意味ではない。`PARTIAL`、`BLOCKED`、`MAC_NOT_RUN`、依存Gate待ちも残数に含む。実行可否は各task行の`現在`欄、§4、§6、§17で判定する。[E-COUNT][S-CONTRIB §§2〜3][S-IP §6]

### 2.3 Phase Cの保存済み証拠

| Task | 状態 | commit / 証拠 | 実測境界 | 出典 |
|---|---|---|---|---|
| SPI-01 | VERIFIED | `464af17d37f24daab9a6fd2a9ffd81223d6176be` | Windowsでhost Node、Electron Node、unpacked packageのSQLite CRUD/rollback/close。macOS/installer/署名は非対象 | [E-SPI01] |
| SPI-02 | VERIFIED | `5a02275641932fab33837a873f3b9389330154a5` | WindowsでElectron→Python JSON/NDJSON、stderr、exit、cancel、負例、残process 0 | [E-SPI02] |
| SPI-07 | VERIFIED | `3ca121e9849a4e85b59e8c601b8a8cb0845bac37` | Windowsで320/640 RGB各100 frame、10Hz pipe、負例3件。証拠artifactはOS/PowerShell/Node/Pythonを記録するがCPU型番を記録していないため、hardware間性能baselineへ転用しない。30分camera性能は非対象 | [E-SPI07] |
| SPI-03 | PARTIAL | `30bc02d70175cb22f0bbb52bd7e888e0a8f6ac28` | build、現hostのPython隔離health/CPU/DML、size/cold start/PEは実測。clean Windows/no PythonはSandbox harness未起動でNOT_RUN。license payload条件も未充足 | [E-SPI03][S-C0 §§3〜4] |

SPI-03はcommit済みでも正本完了条件を満たしていないため、残227件に含める。[S-IP SPI-03][E-SPI03]

### 2.4 未commit SPI-10 WIP

作成時working treeには次の7 untracked fileがある。Git handoffでは自動移送されない。[E-SPI10][E-GIT]

- 正本成果物候補: `spikes/annotation/CanvasSpike.tsx`、`spikes/annotation/CanvasSpike.test.tsx`
- 一時harness: `build/spi10/benchmark-entry.ts`、`index.html`、`main.mjs`、`vite.config.ts`、`vitest.config.ts`

保存済み事実は、reducer testがfork poolで5/5合格、Vite一時buildが89 moduleで成功したことだけである。Electron benchmarkは結果JSONを生成せず約898.2秒残留し、強制終了後exit `-1`、対象残process 0だった。p95値、実Canvas合格、`spikes/annotation/result.md`は存在しないためSPI-10は`IN_PROGRESS / NOT_VERIFIED`とする。[E-SPI10][S-RD NFR-ANN-002][S-IP SPI-10]

別環境へWIPを持ち込まない場合は正本から再実装する。持ち込む場合は、SPI-10専用patchまたはbundleを別途作成しSHA-256を照合する。本計画commitへWIPを混在させない。[S-CONTRIB §§3,10]

旧1340計画との差分は、SPI-01/02/07の3件が保存済み証拠付きでVERIFIEDとなり、残数が230から227へ減ったことである。SPI-03はcommitされたがPARTIALのため残数から除かず、SPI-10も未commit/未計測のため残数から除かない。[H-OLD][E-SPI01][E-SPI02][E-SPI07][E-SPI03][E-SPI10]

## 3. 別環境への移送

### 3.1 Git基準

`origin/main`はcode baselineより12 commit遅れているため、remoteだけをcloneしても現在基準を再現できない。[E-GIT]

1. 推奨: 本書を含む`main`をremoteへpushし、別環境でhandoff commitをcheckoutする。
2. pushしない場合: 本書を含む`main`のGit bundleを作り、bundle SHA-256を別経路で伝える。
3. untracked SPI-10 WIPはどちらにも含まれない。必要なら別のhash付きpatchとして管理する。[E-SPI10][S-CONTRIB §§9〜11]

秘密、model binary、ユーザー画像、Project、署名鍵、tokenをGit/bundleへ含めない。[S-CONTRIB §§9〜11][S-DEP §9]

### 3.2 開始確認

PowerShell 7+で次を確認し、1件でも不一致なら実装を開始しない。[S-CONTRIB §§6,10]

```text
git fetch --all --prune
git checkout main
git status --short --branch
git worktree list --porcelain
git log -1 --format=%H -- work/20260903-1645-TaskExecutionPlan.md
git merge-base --is-ancestor 30bc02d70175cb22f0bbb52bd7e888e0a8f6ac28 HEAD
```

合格条件:

- 本書を含むhandoff commitをcheckoutしている。
- `30bc02d...`がHEADのancestorである。
- 意図しない変更、秘密、model binary、Project dataがない。
- WIPを移送した場合は別途記録したpatch hashと一致する。[E-GIT][E-SPI10]

### 3.3 Tool bootstrap

| Tool | 必須条件 | 確認 | 出典 |
|---|---|---|---|
| PowerShell | 最新の7+ / Core。Windows PowerShell 5.1へfallback禁止 | `$PSVersionTable` | [S-CONTRIB §6] |
| Node | `24.19.x` | `node --version` | [S-NODE] |
| npm | **12.0.0**。nested `npm run`も同じnpmを参照するPATH | `npm --version`、`Get-Command npm` | [S-NODE][S-C0 §8] |
| uv | **0.12.9** | `uv --version` | [S-PY] |
| Python | Windows CPython 3.14、macOS CPython 3.13（uv管理） | `uv run --locked python --version` | [S-PY][S-C0] |
| Git | handoff commitを再現可能 | §3.2 | [E-GIT] |

作成環境のsystem npm 11.17.0は不合格である。別環境では組織承認済み手段でexact npm 12.0.0を用意し、その実pathを記録する。未固定`latest`や作成環境固有のtemp pathを計画へ固定しない。[E-ENV][S-NODE][S-DEP §5]

### 3.4 ENV-GATE

新環境ではlockを変更せず次を実行する。作成環境のPASSを別PCへ転用しない。[S-CONTRIB §§2,5,8,12][S-C0 §8]

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

- npm期待値は12.0.0。baseline期待値はNode 4 files / 19 tests、Python 4 testsである。件数差は推測せず調査する。[S-C0 §8]
- 実行前後に`package-lock.json`と`ml/uv.lock`のSHA-256を取り、§15の値と一致させる。[E-HASH]
- Electronを実起動し、local Renderer、`dist/preload/index.cjs`、応答window、正常終了、残process 0を確認する。[S-C0 §8][S-IP B-05〜07]
- macOSではnative Apple Silicon上で独立実行し、Windows結果を転用しない。[S-C0 §6][S-CONTRIB §7]
- 結果は環境、tool exact版、command、exit、test件数、lock hash、未実施事項とともに最初のtask commitまたはGate記録へ保存する。[S-CONTRIB §§2,5,10]

## 4. 外部条件と停止規則

| ID | 条件 | 必要時点 | 未充足時 | 出典 |
|---|---|---|---|---|
| ENV-WIN-CLEAN | Python/Node/CUDA未導入のclean Windows 11 x64 | SPI-03、PKG-11 | SPI-03/05とGate 1をPASSにしない | [S-RD §§2.2,11.7,15][S-IP SPI-03] |
| ENV-MAC | native Apple Silicon / macOS 13+ | macOS task、Gate 1/3/4/5 | `NOT_RUN`。Windows結果で代替禁止 | [S-RD §§2.2,4,15〜16][S-C0 §6][S-CONTRIB §7] |
| MODEL-C6 | 分類/検出base weightのlicense、由来、hash、品質承認 | SPI-15/16、Gate 2 | model固有trainingを開始しない | [S-RD FR-LIC-004〜008][S-DEP §6.1][S-MODEL] |
| MODEL-C7 | 分類/検出assist checkpointの同承認 | SPI-17、Gate 2 | assist実装/同梱を開始しない | [S-RD FR-LIC-014〜015][S-DEP §6.2][S-MODEL] |
| FIXTURE | 権利確認済みclassification/detection/gold fixture | SPI-15〜17 | 品質・parity値を測定しない | [S-RD §§6,15][S-DEP §6] |
| BUDGET | CPU/GPU別AutoML有限budgetの実測 | Gate 2 / TRN-09 | trial/time値を固定しない | [S-IP D-15][S-RD TBD-03] |
| PRODUCT-ID | 暫定`io.github.dahatake.autovisionstudio`の正式決定 | Gate 3以前・署名前 | upgrade/signing identityを固定しない | [S-IP D-10][S-ADR3 §6] |
| SIGN-WIN | 正式Windows署名identity | PKG-07 / Gate 5 | Windows release不可 | [S-IP D-16][S-ADR3 §§6〜7] |
| SIGN-MAC | Developer ID Application/Installerとnotary資格 | PKG-08 / Gate 5 | macOS release不可 | [S-IP D-16][S-ADR3 §§6〜7] |
| LICENSE-PAYLOAD | C0条件のNOTICE/SBOM/MPL source案内とbuild-only分離 | SPI-03/04、LIC-01、Gate 5 | 当該承認失効・release停止 | [S-C0 §§3〜5][S-DEP §§7,12][E-SPI03] |
| PERF-HW | 要求が指定する基準/推奨hardware | SPI-09/10/15〜17、PERF、INF-15 | 実測値を合格値として固定しない | [S-RD §§11〜12,15] |

C0のmacOS waiverはC0 dependency adoptionだけを閉じた。要求正本はWindows/macOS双方を必須のまま保持する。Windows-onlyへ変更する場合は`docs/requirement-definition.md`、`docs/implementation-plan.md`、ADR-0003、traceabilityを先に正式変更する。[S-RD §§1,4,15〜16][S-C0 §6][S-CONTRIB §§3,5]

## 5. 全task共通の実行サイクル

各taskを1 task / 1 commitで次の順に閉じる。[S-IP §4][S-CONTRIB §§1〜5,10]

1. **Context Pack:** task行、対応requirement、依存ADR節、編集対象全文、直接import元/先、隣接testだけを読む。
2. **依存確認:** 全依存taskがVERIFIED、必要GateがPASSであることをcommit/Gate証拠で確認する。
3. **scope固定:** task行に列挙された成果物だけを変更する。不足なら計画変更commitを先に作る。
4. **実装:** 1つの観測可能挙動だけ。未使用flag、将来抽象化、runtime download、無関係refactorを入れない。
5. **対象test:** 正常、境界、失敗、adversarial case、type/lint/editor diagnosticsを確認する。
6. **敵対レビュー:** 別contextで要求漏れ、scope逸脱、状態遷移、IPC/path/network、不変性、license断定を攻撃的に確認する。
7. **裁定:** 再現した指摘だけを同task内で修正し、future task責務は根拠付きdeferする。
8. **再検証:** 対象test、指摘再現test、必要なintegration smokeを再実行する。
9. **task commit:** task ID、requirements、parent SHA、環境、変更file、command/exit/test数、review、blockerを本文へ記録する。
10. **wave統合:** 出力が重ならないtaskだけを並列化し、依存順にmainへ統合する。

状態は`TODO → IN_PROGRESS → TESTED → ADVERSARIAL_REVIEW → FIXING（必要時）→ REVALIDATED → VERIFIED`。一部だけは`PARTIAL`、外部条件不足は`BLOCKED`、未実施は`NOT_RUN`。[S-CONTRIB §§2〜3]

## 6. Gate順序

| Gate | 合格条件 | 現在 | 停止条件 | 出典 |
|---|---|---|---|---|
| ENV-GATE | §3.4のclean再構築・lock不変 | 新環境ごとにNOT_RUN | tool/lock/test不一致 | [S-CONTRIB §8][S-C0 §8] |
| C0 | exact lock、license裁定、Windows B-GATE | CLOSED | C0条件違反 | [S-C0] |
| Gate 1 | 両OSのSQLite、onedir、installer resource、Reference、pipe、ORT、Konva PoC | BLOCKED | SPI-03 clean host、native Mac、SPI-04〜06/08〜10/19等未完 | [S-IP §6][S-RD §15][E-SPI03][E-SPI10] |
| Gate 2 | C6/C7、hash、quality、finite budget | BLOCKED | approved model/fixture/budget 0 | [S-IP §6][S-DEP §6][S-MANIFEST] |
| Gate 3 | Project→Import→Annotation→immutable Revision→Queued Runを両OSで実証 | NOT_RUN | Gate 1、片OS、未確認item混入 | [S-IP §6][S-ADR2 §§3.3〜3.6] |
| Gate 4 | Assist→Train→ONNX→Version→Report→Cameraを分類/検出・両OSで実証 | NOT_RUN | Gate 2/3、model/OS/性能未達 | [S-IP §6][S-RD §15] |
| Gate 5 | 署名installer、offline/servicing、SBOM、全必須要求 | NOT_RUN | 必須1件でも未達 | [S-IP §6][S-RD §16][S-ADR3 §6] |

## 7. Phase C — 高リスクPoC（残16件）

完了済みSPI-01/02/07は再実装しない。結果を依存taskの入力として使うが、各文書に明記された非対象を拡張解釈しない。[E-SPI01][E-SPI02][E-SPI07]

**残wave:** C1=`SPI-08,10,11,12,13,14,19`、C2=`SPI-03,04,15,16,17`、C3=`SPI-05,06,09`、C4=`SPI-18`。依存とOS laneが成立した項目だけを開始する。[S-IP §7 Phase C]

| ID | 現在 | 成果物・実装 | 依存 | 検証・完了条件 | 出典 |
|---|---|---|---|---|---|
| SPI-03 | PARTIAL / BLOCKED_CLEAN_WIN | 既存`ml/packaging/worker-windows.spec`と`spikes/packaging/windows-result.md`をclean-host証拠で更新 | SPI-02, A-10 | Python未導入clean Windowsでimport/health/CPU、size/cold start/PEを再測定。現host/DML証拠は保持し、C0 payload条件をfail-closed照合 | [S-IP SPI-03][P05][S-C0 §4.2][E-SPI03] |
| SPI-04 | MAC_NOT_RUN | `ml/packaging/worker-macos.spec`, `spikes/packaging/macos-result.md` | SPI-02, A-10 | native clean Apple Silicon/no PythonでCPU/MPS/CoreML、size/cold start/nested code。Windows代替禁止 | [S-IP SPI-04][P05][S-C0 §6] |
| SPI-05 | BLOCKED_SPI03 | `spikes/packaging/electron-builder.windows.yml`, `spikes/packaging/windows-installer-result.md` | SPI-03 | NSIS EXEへonedirを同梱・起動。production configは作らない | [S-IP SPI-05][P02][P03] |
| SPI-06 | MAC_NOT_RUN | `spikes/packaging/electron-builder.macos.yml`, `entitlements.mac.plist`, `macos-pkg-result.md` | SPI-04 | native MacでPKG同梱とnested code構造を実測。production configは作らない | [S-IP SPI-06][P04] |
| SPI-08 | TODO_WIN / MAC_NOT_RUN | `spikes/inference/provider_probe.py`, `spikes/inference/provider-result.md` | B-11 | Windows DML/CPU、macOS CoreML/CPUを専用artifactで実測。SPI-03 DML証拠は再利用可否を明記し、CoreMLを推測しない | [S-IP SPI-08][P07][P08][E-SPI03] |
| SPI-09 | BLOCKED_SPI08 / MAC_NOT_RUN | `spikes/inference/camera.tsx`, `spikes/inference/camera-result.md` | SPI-07, SPI-08 | queue=1/drop、30分基礎測定。OS/hardware別の実値だけ記録 | [S-IP SPI-09][S-RD FR-INF-007〜011][E-SPI07] |
| SPI-10 | IN_PROGRESS_UNCOMMITTED | `spikes/annotation/CanvasSpike.tsx`, `CanvasSpike.test.tsx`, `result.md` | B-07 | 4K/100 boxでcreate/select/move/resize/zoomを実操作し、NFRのpanも追加。実Chromium p95を取得し全対象100ms以内。hang原因をmarker/timeoutで特定 | [S-IP SPI-10][P06][S-RD NFR-ANN-002][E-SPI10] |
| SPI-11 | TODO_RESEARCH | `docs/model-governance/classification-base.md` | A-06 | code/checkpoint/data/terms/intended use/redistribution/hashを一次資料で全known化。unknownは保留/却下 | [S-IP SPI-11][S-DEP §6.1][S-MODEL] |
| SPI-12 | TODO_RESEARCH | `docs/model-governance/detection-base.md` | A-06 | SPI-11と同じfail-closed監査 | [S-IP SPI-12][S-DEP §6.1][S-MODEL] |
| SPI-13 | TODO_RESEARCH | `docs/model-governance/classification-assist.md` | A-06 | C7候補を一次資料、binary hash、intended use、qualityで判定。承認ありき禁止 | [S-IP SPI-13][S-DEP §6.2][S-MODEL] |
| SPI-14 | TODO_RESEARCH | `docs/model-governance/detection-assist.md` | A-06 | SPI-13と同じfail-closed監査 | [S-IP SPI-14][S-DEP §6.2][S-MODEL] |
| SPI-15 | BLOCKED_MODEL_FIXTURE | `spikes/models/classification.py`, `classification-result.md` | SPI-11, SPI-08 | 権利確認済みfixtureと承認候補でtrain→ONNX→CPU parity、budget候補を実測 | [S-IP SPI-15][S-RD FR-TRN-003/018][S-MANIFEST] |
| SPI-16 | BLOCKED_MODEL_FIXTURE | `spikes/models/detection.py`, `detection-result.md` | SPI-12, SPI-08 | box/score/label、mAP差、runtimeを権利確認済みfixtureで実測 | [S-IP SPI-16][S-RD FR-TRN-003/018][S-MANIFEST] |
| SPI-17 | BLOCKED_MODEL_GOLDSET | `spikes/models/assist_benchmark.py`, `assist-result.md` | SPI-13, SPI-14 | gold setでcoverage/accept/edit/reject/timeをmanual-only比較。accuracy捏造禁止 | [S-IP SPI-17][S-RD NFR-ANN-006][S-MANIFEST] |
| SPI-18 | WAIT_ALL / BLOCKED_MAC_MODEL | `docs/adr/0004-spike-decisions.md`, `resources/models/manifest.json` | A-07, SPI-01〜17, SPI-19 | 全結果の採否、hardware、未解決を記録しGate 1/2判定。未承認modelをmanifestへ入れない | [S-IP SPI-18][S-DEP §§6,12] |
| SPI-19 | TODO_WIN / MAC_NOT_RUN | `spikes/reference/reference-access.ts`, `windows-result.md`, `macos-result.md` | B-05, D-19 | 両OSのrestart/read/hash/change/loss/relink/write-delete 0を実測 | [S-IP SPI-19][S-ADR2 §3.2] |

### 7.1 SPI-10再開手順

1. `CanvasSpike.tsx`とtestのWIPを使う場合はhash付きpatchとして復元し、5 reducer testsを再実行する。[E-SPI10]
2. 一時Electron harnessへ`app-ready`、`loadFile-start/end`、`executeJavaScript-start/end`、`GPU-info-start/end`のmarkerと各timeoutを入れ、hang箇所を記録する。[S-CONTRIB §5][E-SPI10]
3. `window.runSpi10Benchmark`がbundleへ公開されたことをload後に検査し、error JSONをprocess終了前にflushする。[P06]
4. `create/select/move/resize/zoom`に加えNFR-ANN-002の`pan`を測定する。warm-upとsample数、画面/GPU/Chromium/Electron版を記録する。[S-IP SPI-10][S-RD NFR-ANN-002]
5. `performance.now()`で同期drawを測る場合、操作完了の定義が実paintを含むかを明記する。必要なら`requestAnimationFrame`境界を採用し、測定方法を`result.md`へ固定する。[S-CONTRIB §5]
6. p95未取得または100ms超過ならPASSにせず、Konva公式のlayer/listening/caching指針を必要最小限で試し、再測定する。[P06]

## 8. Phase D — App core / Project / 診断（15件）

全件Gate 1 PASS待ち。waveは`CORE-01,11 → CORE-02,12 → CORE-03,14 → CORE-04 → CORE-05 → CORE-06 → CORE-07,10 → CORE-08,09 → CORE-13 → DOC-01`。[S-IP §7 Phase D]

| ID | 現在 | 実装・成果物 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| CORE-01 | BLOCKED_GATE1 | `src/main/paths.ts`, test。OS user-data配下のproject/cache/log path | Gate 1 | absolute、作成責務、境界 | [S-IP CORE-01][S-RD FR-SEC-001] |
| CORE-02 | BLOCKED_GATE1 | SQLite open/close module/test | SPI-01, CORE-01 | foreign key、WAL、Main single writer | [S-IP CORE-02][S-ADR1 §2.7] |
| CORE-03 | BLOCKED_GATE1 | migration runner/test | CORE-02 | version順、transaction、rollback、再実行 | [S-IP CORE-03][S-ADR2 §3.6] |
| CORE-04 | BLOCKED_GATE1 | `001_core.sql`/schema test | CORE-03 | projects/settings最小schemaとconstraint | [S-IP CORE-04][S-RD §9] |
| CORE-05 | BLOCKED_GATE1 | Project runtime contract/test | CORE-04 | UUID/name/taskTypeの正常・境界・失敗 | [S-IP CORE-05][S-RD FR-PRJ-001〜003] |
| CORE-06 | BLOCKED_GATE1 | Project repository/service/test | CORE-05 | CRUD、重複/不存在、初回Run後taskType lock | [S-IP CORE-06][S-RD FR-PRJ-001〜006] |
| CORE-07 | BLOCKED_GATE1 | Project IPC/preload/contracts/test | CORE-06 | sender+schema、任意path/raw IPC拒否 | [S-IP CORE-07][S-RD FR-SEC-006] |
| CORE-08 | BLOCKED_GATE1 | Project list UI/test | CORE-07 | UI-02 list/search/statusとkeyboard | [S-IP CORE-08][S-RD UI-02] |
| CORE-09 | BLOCKED_GATE1 | Project form UI/test | CORE-07 | create/edit、日本語validation、taskType lock表示 | [S-IP CORE-09][S-RD UI-03] |
| CORE-10 | BLOCKED_GATE1 | delete preview/dialog/backend test | CORE-06 | owned/reference件数・容量を区別、参照元除外 | [S-IP CORE-10][S-ADR2 §3.8] |
| CORE-11 | BLOCKED_GATE1 | Python hardware probe、CLI、test | B-12, SPI-08 | allowlist commandでOS/CPU/RAM/disk/provider実測。cameraを開かない | [S-IP CORE-11][S-RD FR-SYS-001〜004] |
| CORE-12 | BLOCKED_GATE1 | diagnostics service/IPC/UI/test | CORE-11, SPI-02 | 非対応/CPU可/推奨と実理由、worker failure | [S-IP CORE-12][S-RD UI-01] |
| CORE-13 | BLOCKED_GATE1 | Project CRUD Electron E2E | CORE-08〜10 | restart persistence、他Project非干渉 | [S-IP CORE-13][S-RD FR-PRJ-001〜010] |
| CORE-14 | BLOCKED_GATE1 | battery/thermal backend/UI/test | CORE-12 | OS取得値だけ表示、取得不能を捏造しない | [S-IP CORE-14][S-RD §12.3] |
| DOC-01 | BLOCKED_GATE1 | `docs/users-guide.md` Project/診断節 | CORE-12〜14, A-08 | 実装・実測済み画面だけをUI文言と照合 | [S-IP DOC-01][S-CONTRIB §2] |

## 9. Phase E — Job runtime（8件）

waveは`JOB-01,03 → JOB-02 → JOB-04 → JOB-05 → JOB-06,07,08`。[S-IP §7 Phase E]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| JOB-01 | BLOCKED_DEP | `002_jobs.sql`、job contract、schema test | CORE-03 | 要求済み状態とconstraintだけ | [S-IP JOB-01][S-RD §10] |
| JOB-02 | BLOCKED_DEP | job repository/state machine/test | JOB-01 | 全合法遷移、未定義遷移、終端再開拒否 | [S-IP JOB-02][S-ADR2 §3.5] |
| JOB-03 | BLOCKED_DEP | TS/Python worker envelope/test | SPI-02 | schemaVersionとstarted/progress/warning/completed/failed整合 | [S-IP JOB-03][S-ADR1 §2.5] |
| JOB-04 | BLOCKED_DEP | child-process supervisor/test | JOB-02, JOB-03 | spawn、stdout/stderr、exit、artifact path境界 | [S-IP JOB-04][S-RD FR-TRN-002] |
| JOB-05 | BLOCKED_DEP | job service/IPC/preload/test | JOB-04 | progress subscribe/unsubscribe、cancel、猶予後kill | [S-IP JOB-05][S-RD FR-TRN-012〜014] |
| JOB-06 | BLOCKED_DEP | restart recovery/test | JOB-05 | Running→Interrupted、Exporting/Evaluating→Failed、Cancelled非再開 | [S-IP JOB-06][S-ADR1 §2.6] |
| JOB-07 | BLOCKED_DEP | training FIFO queue/test | JOB-05 | 同時1件、FIFO、汎用schedulerなし | [S-IP JOB-07][S-RD FR-TRN-010] |
| JOB-08 | BLOCKED_DEP | status bar/page/test | JOB-05 | queue/progress/current/cancel可否を日本語・keyboard表示 | [S-IP JOB-08][S-RD UI-05] |

## 10. Phase F — Data import（16件）

waveは`DAT-01,06,12,13 → DAT-02,07 → DAT-03,04,05,11,14 → DAT-08 → DAT-09,15 → DAT-10 → DOC-02`。[S-IP §7 Phase F]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| DAT-01 | BLOCKED_DEP | import contract、`scan_dataset.py`、CLI、test | JOB-03, CORE-11 | versioned I/Oとallowlist | [S-IP DAT-01][S-RD FR-DAT-001〜008] |
| DAT-02 | BLOCKED_DEP | image enumerate/magic/hash module/test | DAT-01 | extension+magic、SHA-256、duplicate、unsupported | [S-IP DAT-02][S-RD FR-DAT-003/007] |
| DAT-03 | BLOCKED_DEP | decode/EXIF/security limits/test | DAT-02 | orientation、broken、animated、pixel/byte上限 | [S-IP DAT-03][S-RD FR-DAT-003〜004] |
| DAT-04 | BLOCKED_DEP | classification importer/test | DAT-02 | unlabeled/folder/UTF-8 CSV、invalid row | [S-IP DAT-04][S-RD FR-DAT-005] |
| DAT-05 | BLOCKED_DEP | COCO importer/test | DAT-02 | image/category/bbox、unknown参照、invalid item | [S-IP DAT-05][S-RD FR-DAT-006] |
| DAT-06 | BLOCKED_DEP | atomic copy source/test | CORE-01 | temp copy→hash→rename、元file非変更 | [S-IP DAT-06][S-ADR2 §§3.2,3.6] |
| DAT-07 | BLOCKED_DEP | `003_import.sql`、repository/test | DAT-01, CORE-03 | source manifest、scan、rights/mode永続化 | [S-IP DAT-07][S-RD FR-DAT-011〜015] |
| DAT-08 | BLOCKED_DEP | import service/IPC/preload/test | DAT-04〜07, DAT-11〜13, JOB-04 | picker→scan→rights→capacity→mode→workspaceを失敗atomicに統合 | [S-IP DAT-08][S-RD UI-04] |
| DAT-09 | BLOCKED_DEP | ImportPage/Summary/test | DAT-08 | Error/Warning、mode、rights、修正導線 | [S-IP DAT-09][S-RD UI-04] |
| DAT-10 | BLOCKED_DEP | classification/detection import E2E | DAT-09 | folder/CSV/COCO/unlabeled/broken/capacity/rights/Reference | [S-IP DAT-10][S-RD FR-DAT-001〜016] |
| DAT-11 | BLOCKED_DEP | capacity preflight/test | DAT-02, CORE-01 | source+derived+temp+20%、不足時write前停止 | [S-IP DAT-11][S-RD NFR-STO-001] |
| DAT-12 | BLOCKED_DEP / MAC_NOT_RUN | Reference source/test | SPI-19, CORE-01 | identity/size/mtime/hash/restart/relink、参照元非変更 | [S-IP DAT-12][S-ADR2 §3.2] |
| DAT-13 | BLOCKED_DEP | rights backend/UI/test | CORE-06 | 初回確認日時を保存、法的権利を保証しない | [S-IP DAT-13][S-RD FR-LIC-009] |
| DAT-14 | BLOCKED_DEP | image protocol/safe-path/test | DAT-06, DAT-12 | allowlist内read-only、traversal/symlink/junction越境拒否 | [S-IP DAT-14][S-RD FR-SEC-006/008] |
| DAT-15 | BLOCKED_DEP / MAC_NOT_RUN | OS別manual picker記録 | DAT-08, SPI-19 | multi/folder/cancel/restart/relinkを署名前packageでOS別実測 | [S-IP DAT-15][S-RD FR-DAT-001/012] |
| DOC-02 | BLOCKED_DEP | data import guide | DAT-10, DAT-15, DOC-01 | Copy/Reference、capacity、rights、format、relinkを実画面どおり記載 | [S-IP DOC-02][S-CONTRIB §2] |

## 11. Phase G — Annotation / Dataset Revision（29件）

waveは`ANN-01 → 02 → 03,05 → 04,06 → 07,08 → 09,11 → 10,12,23,25 → 13 → 14,24 → 15,26 → 16,17 → 18 → 19 → 20,21 → 22 → 27,28 → DOC-03`。[S-IP §7 Phase G]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| ANN-01 | BLOCKED_DEP | `004_annotations.sql`/schema test | DAT-07 | schema/workspace/item/revision/provenance constraint | [S-IP ANN-01][S-ADR2 §3.1] |
| ANN-02 | BLOCKED_DEP | annotation runtime contracts/test | ANN-01 | state/provenance/classification/rectangle union | [S-IP ANN-02][S-RD FR-ANN-001〜014] |
| ANN-03 | BLOCKED_DEP | label repository/service/test | ANN-02 | UUID、Unicode正規化、alias、初回学習後lock | [S-IP ANN-03][S-RD FR-ANN-003/004/012] |
| ANN-04 | BLOCKED_DEP | label IPC/preload/UI/test | ANN-03 | UI-09 CRUD、説明/例、validation、keyboard | [S-IP ANN-04][S-RD UI-09] |
| ANN-05 | BLOCKED_DEP | workspace repository/service/test | ANN-02 | mutable workspaceとpast revision不変性 | [S-IP ANN-05][S-ADR2 §§3.1,3.4] |
| ANN-06 | BLOCKED_DEP | annotation IPC contracts/handlers/test | ANN-05 | paging/query/save schemaとsender | [S-IP ANN-06][S-RD FR-SEC-006] |
| ANN-07 | BLOCKED_DEP | page/gallery/test | ANN-06, DAT-14 | safe thumbnails、state filter、前後移動 | [S-IP ANN-07][S-RD FR-ANN-001/005/008] |
| ANN-08 | BLOCKED_DEP | draft hook、save backend、test | ANN-06 | 1秒内保存開始、undo/redo、failure状態 | [S-IP ANN-08][S-RD NFR-ANN-001] |
| ANN-09 | BLOCKED_DEP | ClassificationEditor/test | ANN-04, ANN-08 | exactly one class、replace/clear/exclude | [S-IP ANN-09][S-RD FR-ANN-101〜103] |
| ANN-10 | BLOCKED_DEP | bulk bar/distribution/test | ANN-09 | multi-apply、count、少数/偏りwarning | [S-IP ANN-10][S-RD FR-ANN-102/104] |
| ANN-11 | BLOCKED_DEP | DetectionCanvas/coordinate test | SPI-10, ANN-08 | pixel↔view round-trip、zoom/pan | [S-IP ANN-11][S-RD FR-ANN-201〜204] |
| ANN-12 | BLOCKED_DEP | RectangleLayer/test | ANN-11 | create/select/delete、pointer/keyboard境界 | [S-IP ANN-12][S-RD FR-ANN-201/202] |
| ANN-13 | BLOCKED_DEP | transformer/test | ANN-12 | move/resize、finite、min size、clamp、pixel保存 | [S-IP ANN-13][S-RD FR-ANN-202/204/205] |
| ANN-14 | BLOCKED_DEP | RegionList/NoObject/test | ANN-13, ANN-04 | class変更、対象物なし、未着手分離 | [S-IP ANN-14][S-RD FR-ANN-203/206] |
| ANN-15 | BLOCKED_DEP | annotation validator/test | ANN-09, ANN-14 | schema外、分類0/複数、nonfinite/zero/outside拒否 | [S-IP ANN-15][S-RD FR-ANN-011] |
| ANN-16 | BLOCKED_DEP | provenance/test | ANN-15 | manual/import/modelの5区分とsource ID | [S-IP ANN-16][S-ADR2 §3.3] |
| ANN-17 | BLOCKED_DEP | split worker/test | ANN-15 | fixed seed、stratification、hash leakage防止 | [S-IP ANN-17][S-RD FR-DAT-009/010] |
| ANN-18 | BLOCKED_DEP | revision manifest writer/test | ANN-15〜17 | confirmedのみ、temp/hash/atomic rename、pending 0 | [S-IP ANN-18][S-ADR2 §§3.4,3.6] |
| ANN-19 | BLOCKED_DEP | revision repository/service/test | ANN-18 | immutable revision、lineage、lastVerifiedAt例外だけ | [S-IP ANN-19][S-ADR2 §3.4] |
| ANN-20 | BLOCKED_DEP | clone workspace/test | ANN-19 | revision clone、hash dedupe、元非変更 | [S-IP ANN-20][S-RD FR-ANN-013] |
| ANN-21 | BLOCKED_DEP | ConfirmDatasetDialog/test | ANN-15, ANN-19 | Error block、件数/provenance/pending表示 | [S-IP ANN-21][S-RD FR-ANN-011] |
| ANN-22 | BLOCKED_DEP | confirm-and-queue/test | ANN-21, JOB-07 | revision commit後5秒以内にQueued、transaction整合 | [S-IP ANN-22][S-RD FR-ANN-014/NFR-PERF-002] |
| ANN-23 | BLOCKED_DEP | LabelPicker/recent/test | ANN-09 | search/recent/数字shortcutをmouse/keyboard双方で実行 | [S-IP ANN-23][S-RD FR-ANN-105] |
| ANN-24 | BLOCKED_DEP | rectangle commands/duplicate warning/test | ANN-13 | duplicate/select-all/keyboard/high-IoU warning | [S-IP ANN-24][S-RD FR-ANN-202/205/208] |
| ANN-25 | BLOCKED_DEP | instructions UI/test | ANN-04, ANN-11 | Project固有方針をeditorで常時参照 | [S-IP ANN-25][S-RD FR-ANN-207] |
| ANN-26 | BLOCKED_DEP | item actions/save status/test | ANN-07〜09, ANN-14 | exclude reasonとsaving/saved/failed、keyboard | [S-IP ANN-26][S-RD FR-ANN-006/009] |
| ANN-27 | BLOCKED_DEP / MAC_NOT_RUN | classification E2E/fixture | ANN-10,22,23,26 | POC-14、manifest/queue照合をOS別実証 | [S-IP ANN-27][S-RD POC-14] |
| ANN-28 | BLOCKED_DEP / MAC_NOT_RUN | detection E2E/fixture | ANN-14,22,24〜26 | POC-15、negative/rectangle/validation | [S-IP ANN-28][S-RD POC-15] |
| DOC-03 | BLOCKED_DEP | annotation guide | DOC-02, ANN-27/28 | 実画面のSchema、rectangle、shortcut、confirmを記載 | [S-IP DOC-03][S-CONTRIB §2] |

## 12. Phase H — Initial Annotation Assist（22件）

Gate 2/3 PASSまで開始しない。AST-08はTRN-21後へdeferする。waveは`AST-01,02 → 03,04 → 05,06,07 → 09,11,18,19 → 10,12,15,20 → 13,16,21 → 14 → 22 → DOC-04`。[S-IP §7 Phase H]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| AST-01 | BLOCKED_GATE2 | approved manifest loader/test | SPI-18 | schema/path/hash/approval/task/supportをfail-closed | [S-IP AST-01][S-DEP §6] |
| AST-02 | BLOCKED_GATE3 | `005_suggestions.sql`、contract/test | ANN-01 | set/version/decision/rawScore/provenance分離 | [S-IP AST-02][S-ADR2 §3.7] |
| AST-03 | BLOCKED_DEP | suggestion repository/service/test | AST-02 | output不変、decisionのみ可変、set比較 | [S-IP AST-03][S-ADR2 §3.7] |
| AST-04 | BLOCKED_DEP | worker contract、assist command、CLI、test | JOB-03, AST-02, DAT-01 | task別schema、allowlist、DB writeなし | [S-IP AST-04][S-ADR1 §2.2] |
| AST-05 | BLOCKED_MODEL | classification assist/test | AST-01, AST-04, Gate 2 | approved modelで既存Schema top-3、score非捏造 | [S-IP AST-05][S-RD FR-AST-005] |
| AST-06 | BLOCKED_MODEL | label-name candidates/test | AST-01, AST-04, Gate 2 | 新規名を別候補、自動Schema追加なし | [S-IP AST-06][S-RD FR-AST-006] |
| AST-07 | BLOCKED_MODEL | detection assist/test | AST-01, AST-04, Gate 2 | approved modelでbox/class/raw score | [S-IP AST-07][S-RD FR-AST-007/008] |
| AST-08 | DEFER_TRN21 | Project model worker/test | AST-04, TRN-21 | Succeeded版だけ、task/schema一致、version/hash出力 | [S-IP AST-08][S-RD FR-AST-016] |
| AST-09 | BLOCKED_DEP | assist service/IPC/preload/test | AST-03〜07, JOB-05 | queue/disable/cancel/hash、OOM縮小/CPU fallback | [S-IP AST-09][S-RD FR-AST-001/018] |
| AST-10 | BLOCKED_DEP | AssistJobPage/test | AST-09 | progress/device/ETA/failure実値 | [S-IP AST-10][S-RD UI-11] |
| AST-11 | BLOCKED_DEP | panel/overlay/test | AST-03, ANN-11 | Ground Truthと色/線/badge/data分離 | [S-IP AST-11][S-RD FR-AST-009] |
| AST-12 | BLOCKED_DEP | decision hook/apply backend/test | AST-11 | 個別accept/edit/rejectだけ、auto/bulk approveなし | [S-IP AST-12][S-RD FR-AST-010/011] |
| AST-13 | BLOCKED_DEP | confirmation gate/test | AST-12, ANN-21 | 全候補処理+画像確認までRevision禁止 | [S-IP AST-13][S-RD NFR-ANN-005] |
| AST-14 | BLOCKED_DEP | regeneration/test | AST-09, AST-13 | confirmed非上書き、新旧set比較 | [S-IP AST-14][S-RD FR-AST-015] |
| AST-15 | BLOCKED_DEP | high-risk label filter/test | AST-06 | 指定属性だけblock/warn、汎用safetyなし | [S-IP AST-15][S-RD FR-AST-019] |
| AST-16 | BLOCKED_DEP | assist report aggregation/test | AST-03, AST-12 | coverage/accept/edit/reject、accuracy非捏造 | [S-IP AST-16][S-RD FR-REP-012] |
| AST-18 | BLOCKED_MODEL | determinism/test | AST-05, AST-07 | hash/prompt/preprocess/threshold/seed同一で再現 | [S-IP AST-18][S-RD NFR-ANN-004] |
| AST-19 | BLOCKED_MODEL | threshold policy/test | AST-01, AST-05, AST-07 | PoC固定policyだけ、scoreなしにconfidence生成なし | [S-IP AST-19][S-RD FR-AST-012/013] |
| AST-20 | BLOCKED_MODEL | classification similarity/test | AST-05, AST-18 | confirmed embeddingで順序index、GT/元順非変更 | [S-IP AST-20][S-RD FR-AST-017] |
| AST-21 | BLOCKED_DEP | SimilaritySort/test | AST-20, ANN-07 | 類似/元順切替、件数/偏りを隠さない | [S-IP AST-21][S-RD FR-AST-017] |
| AST-22 | BLOCKED_GATE2_3 / MAC_NOT_RUN | assist E2E | AST-10〜15,18〜21 | POC-16、pending 0、offline、hash/provenance、quality比較 | [S-IP AST-22][S-RD POC-16] |
| DOC-04 | BLOCKED_DEP | initial assist guide | DOC-03, AST-22 | 候補限界、score、確認、類似順を実装どおり記載 | [S-IP DOC-04][S-CONTRIB §2] |

## 13. Phase I — Training / AutoML / Model Version（32件）

Gate 2/3 PASSまでmodel trainingを開始しない。waveは`TRN-01,02,09 → 03,06,28 → 04,05,07,08 → 16,17,25,26 → 10,11,18,19 → 12,13,27 → 14 → 15,20 → 21,30 → 22,31 → 29 → 32,33 → DOC-05`。[S-IP §7 Phase I]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| TRN-01 | BLOCKED_GATE3 | revision materializer/test | ANN-19, DAT-12 | confirmedのみ、開始前/epoch/trialでReference hash再検証 | [S-IP TRN-01][S-RD FR-DAT-013] |
| TRN-02 | BLOCKED_GATE1 | runtime/device/test | CORE-11 | 実CPU/CUDA/MPS選択、seed/version、fallback | [S-IP TRN-02][S-RD FR-SYS-003/004] |
| TRN-03 | BLOCKED_DEP | classification dataset/test | TRN-01 | preprocess/augmentation、single class invariant | [S-IP TRN-03][S-RD FR-ANN-101] |
| TRN-04 | BLOCKED_MODEL | classification single trial/test | TRN-02, TRN-03, Gate 2 | approved selected modelだけで1 trial | [S-IP TRN-04][S-RD FR-TRN-003] |
| TRN-05 | BLOCKED_DEP | classification metrics/test | TRN-03 | accuracy/balanced/macro/micro/class/confusion fixture検算 | [S-IP TRN-05][S-RD FR-REP-002] |
| TRN-06 | BLOCKED_DEP | detection dataset/test | TRN-01 | box/class/negative/coordinate境界 | [S-IP TRN-06][S-RD FR-ANN-201〜206] |
| TRN-07 | BLOCKED_MODEL | detection single trial/test | TRN-02, TRN-06, Gate 2 | approved selected modelだけで1 trial | [S-IP TRN-07][S-RD FR-TRN-003] |
| TRN-08 | BLOCKED_DEP | detection metrics/test | TRN-06 | mAP50:95/AP50/AP75/class/PR fixture検算 | [S-IP TRN-08][S-RD FR-REP-003] |
| TRN-09 | BLOCKED_GATE2 | versioned policies/test | SPI-15〜18, D-15 | 実測有限budget/search space、unused optionなし | [S-IP TRN-09][S-RD FR-TRN-006〜009] |
| TRN-10 | BLOCKED_DEP | classification Optuna/test | TRN-04,05,09 | TPE+pruning、全parameter/中間値report | [S-IP TRN-10][S-RD FR-TRN-008] |
| TRN-11 | BLOCKED_DEP | detection Optuna/test | TRN-07〜09 | 検出固有search、全値report | [S-IP TRN-11][S-RD FR-TRN-008] |
| TRN-12 | BLOCKED_DEP | budget/test | TRN-10,11 | wall-clock、mini-run estimate、prune reason | [S-IP TRN-12][S-RD NFR-PERF-007] |
| TRN-13 | BLOCKED_DEP | checkpoint/test | TRN-10,11 | compatible Interruptedだけresume、Cancelled不可 | [S-IP TRN-13][S-ADR2 §3.5] |
| TRN-14 | BLOCKED_DEP | train command、CLI、test | AST-04, TRN-10〜13,25〜28 | allowlist dispatch、baseline/selection/failure返却 | [S-IP TRN-14][S-RD FR-TRN-001〜021] |
| TRN-15 | BLOCKED_DEP | training service/IPC/preload/test | TRN-14, JOB-07 | queue/cancel/resume/progress | [S-IP TRN-15][S-RD UI-05] |
| TRN-16 | BLOCKED_MODEL | classification ONNX/test | TRN-04 | fixed FP32 shape、pre/post metadata | [S-IP TRN-16][S-RD FR-TRN-018] |
| TRN-17 | BLOCKED_MODEL | detection ONNX/test | TRN-07 | fixed shape/output/coordinate意味 | [S-IP TRN-17][S-RD FR-TRN-018] |
| TRN-18 | BLOCKED_DEP | classification parity/test | TRN-05,16 | RD threshold実測、超過Run Failed | [S-IP TRN-18][S-RD FR-TRN-018] |
| TRN-19 | BLOCKED_DEP | detection parity/test | TRN-08,17 | mAP差実測、超過Run Failed | [S-IP TRN-19][S-RD FR-TRN-018] |
| TRN-20 | BLOCKED_DEP | `006_training.sql`、model repository/test | TRN-18,19 | version/parent/revision/hash/license不変、Succeededだけ | [S-IP TRN-20][S-RD FR-MOD-001/002] |
| TRN-21 | BLOCKED_DEP | atomic model commit/test | TRN-20 | hash→rename→1 transaction、Succeededだけ | [S-IP TRN-21][S-ADR2 §3.6] |
| TRN-22 | BLOCKED_DEP | additional training/test | ANN-20, TRN-21 | base明示、class一致、親非変更 | [S-IP TRN-22][S-RD FR-TRN-004/005/021] |
| TRN-25 | BLOCKED_MODEL | classification scratch baseline/test | TRN-04 | scratch/Fine-Tuningを同split/budget比較 | [S-IP TRN-25][S-RD FR-TRN-003] |
| TRN-26 | BLOCKED_MODEL | detection scratch baseline/test | TRN-07 | 同条件比較と採否理由 | [S-IP TRN-26][S-RD FR-TRN-003] |
| TRN-27 | BLOCKED_DEP | best selection/test | TRN-10,11 | validation→latency→size→stability、test split不使用 | [S-IP TRN-27][S-RD FR-TRN-016] |
| TRN-28 | BLOCKED_DEP | failure classification/test | TRN-02 | unsupported/OOM/disk/read、縮小1回、CPU候補 | [S-IP TRN-28][S-RD FR-TRN-020] |
| TRN-29 | BLOCKED_DEP | AdditionalTraining UI/test | TRN-22 | 成功版選択、schema不一致block | [S-IP TRN-29][S-RD FR-TRN-004/021] |
| TRN-30 | BLOCKED_DEP | delete model service/IPC/test | TRN-20 | 使用中/親依存preview、子lineage非破壊 | [S-IP TRN-30][S-RD FR-MOD-004] |
| TRN-31 | BLOCKED_DEP | model preload/delete dialog/test | TRN-30 | narrow IPC、依存表示、明示確認 | [S-IP TRN-31][S-RD FR-MOD-004] |
| TRN-32 | BLOCKED_GATE2_3 / MAC_NOT_RUN | classification training E2E | TRN-15,18,21,25,27〜29 | revision→v1→追加v2、baseline/failureをOS別実証 | [S-IP TRN-32][S-RD POC-01] |
| TRN-33 | BLOCKED_GATE2_3 / MAC_NOT_RUN | detection training E2E | TRN-15,19,21,26〜29 | revision→ONNX→version、baseline/failure | [S-IP TRN-33][S-RD POC-02] |
| DOC-05 | BLOCKED_DEP | training/version guide | DOC-04, TRN-31〜33 | auto start、budget、cancel/resume、追加、削除を実画面で記載 | [S-IP DOC-05][S-CONTRIB §2] |

## 14. Phase I.1〜N（残89件）

### 14.1 Phase I.1 — Project Model Assist（3件）

直列は`AST-08 → AST-23 → AST-24 → DOC-10`。[S-IP §7 Phase I.1]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| AST-23 | BLOCKED_TRN21 | service/selector UI/backend test | AST-08,09,19, TRN-21 | 最新Succeeded既定、別版選択、threshold、task/schema一致 | [S-IP AST-23][S-RD FR-AST-002/016] |
| AST-24 | BLOCKED_DEP / MAC_NOT_RUN | classification/detection E2E | AST-14, AST-23 | POC-17、version/hash/provenance、confirmed非上書き | [S-IP AST-24][S-RD POC-17] |
| DOC-10 | BLOCKED_DEP | Project model assist guide | DOC-05, AST-24 | 既定版、版選択、再生成対象、threshold由来 | [S-IP DOC-10][S-CONTRIB §2] |

### 14.2 Phase J — Report（12件）

waveは`REP-11,01,02,03 → REP-04〜09 → REP-10 → DOC-06`。[S-IP §7 Phase J]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| REP-11 | BLOCKED_DEP | chart dependency採否、lock/policy | A-05, B-01, D-13 | current一次資料/license/bundle/a11y比較。native SVGで足りれば追加なし | [S-IP REP-11][S-DEP §10] |
| REP-01 | BLOCKED_DEP | TrainingRunPage/test | TRN-15 | state/trial/epoch/metric/time/ETA/device実値 | [S-IP REP-01][S-RD UI-05] |
| REP-02 | BLOCKED_DEP | versions list/compare/test | TRN-20 | metric/size/latency/revision/parent、欠測非推測 | [S-IP REP-02][S-RD FR-MOD-005] |
| REP-03 | BLOCKED_DEP | report service/IPC/preload/test | TRN-20 | read-only DTO、sender/schema、Project分離 | [S-IP REP-03][S-RD FR-REP-001] |
| REP-04 | BLOCKED_DEP | classification report/test | REP-03, REP-11 | 全分類指標、loss、confusion | [S-IP REP-04][S-RD FR-REP-002] |
| REP-05 | BLOCKED_DEP | detection report/test | REP-03, REP-11 | mAP/AP/class/PR/loss | [S-IP REP-05][S-RD FR-REP-003] |
| REP-06 | BLOCKED_DEP | result gallery/overlay/test | REP-03, ANN-11, DAT-12 | candidate/IoU/FP/FN/GT/Prediction/Reference relink | [S-IP REP-06][S-RD FR-REP-005〜008] |
| REP-07 | BLOCKED_DEP | TrialTable/test | REP-03 | 全hyperparameter、中間値、prune reason | [S-IP REP-07][S-RD FR-REP-004] |
| REP-08 | BLOCKED_DEP | environment/license/assist tabs/test | REP-03, AST-16 | OS/device/library/seed/time/memory/hash/license/provenance実値 | [S-IP REP-08][S-RD FR-REP-009/011/012] |
| REP-09 | BLOCKED_DEP | local export backend/test/button | REP-03 | JSON/CSV、画像は明示選択だけ | [S-IP REP-09][S-RD FR-REP-010] |
| REP-10 | BLOCKED_DEP / MAC_NOT_RUN | classification/detection report E2E | REP-04〜09 | UI-06とFR-REPをtask別fixtureでOS別実証 | [S-IP REP-10][S-RD UI-06] |
| DOC-06 | BLOCKED_DEP | report guide | DOC-10, REP-10 | metricの読み方、score≠正解確率 | [S-IP DOC-06][S-CONTRIB §2] |

### 14.3 Phase K — Camera inference（20件）

waveは`INF-01,16 → 02 → 17 → 03,18 → 04 → 05 → 06,19 → 07,08,09 → 10 → 11 → 12 → 13 → 14,15 → DOC-07`。[S-IP §7 Phase K]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| INF-01 | BLOCKED_GATE1 | permission backend/IPC/test | B-05 | app origin video+user gestureだけ許可、audio/他拒否 | [S-IP INF-01][S-RD FR-INF-003〜007] |
| INF-02 | BLOCKED_DEP | CameraSelector/test | INF-01 | device list、permission前は不明表示 | [S-IP INF-02][S-RD FR-INF-002] |
| INF-03 | BLOCKED_DEP | camera stream hook/test | INF-17 | audio:false、start/stop/disconnect、2秒内release、非保存 | [S-IP INF-03][S-RD FR-INF-007/016/017] |
| INF-04 | BLOCKED_DEP | 10Hz sampler hook/test | INF-03 | monotonic 100ms、fixed RGB、偽10Hz禁止 | [S-IP INF-04][S-RD FR-INF-008] |
| INF-05 | BLOCKED_DEP | TS/Python frame protocol/test | SPI-07, INF-04 | length/shape/size/session、no base64 | [S-IP INF-05][S-ADR1 §2.5] |
| INF-06 | BLOCKED_MODEL | Python inference session/test | INF-05, AST-01 | one ORT session、EP→CPU、warm-up、CoreML cache分離 | [S-IP INF-06][S-RD FR-INF-015/016/018] |
| INF-07 | BLOCKED_DEP | Main supervisor/test | INF-06, INF-19 | spawn/write/read/kill/hash/failure cleanup | [S-IP INF-07][S-ADR1 §2.5] |
| INF-08 | BLOCKED_DEP | classification postprocess/test | INF-06, TRN-16 | top-3/class/score/metadata一致 | [S-IP INF-08][S-RD FR-INF-012] |
| INF-09 | BLOCKED_DEP | detection postprocess/test | INF-06, TRN-17 | model box/class/threshold/reverse coordinate | [S-IP INF-09][S-RD FR-INF-013/015] |
| INF-10 | BLOCKED_DEP | latest-frame queue/test | INF-07 | in-flight+pending1、replace、drop count | [S-IP INF-10][S-RD FR-INF-009] |
| INF-11 | BLOCKED_DEP | page/overlay/test | INF-08〜10 | classification/detection、GT分離 | [S-IP INF-11][S-RD UI-07] |
| INF-12 | BLOCKED_DEP | metrics/error UI/test | INF-11 | actual FPS/p95/drop/provider/fallback/error実値 | [S-IP INF-12][S-RD FR-INF-010/011/018] |
| INF-13 | BLOCKED_DEP | Electron fake-camera E2E | INF-12,16〜19 | model/camera/profile/consent/lifecycle/queue/overlay/contention | [S-IP INF-13][P09] |
| INF-14 | BLOCKED_DEP / MAC_NOT_RUN | packaged OS permission manual | INF-13 | notDetermined/granted/denied/restricted/disconnectをOS別 | [S-IP INF-14][S-RD POC-07] |
| INF-15 | BLOCKED_HARDWARE | 30-minute benchmark/template | INF-13 | recommended hardwareでservice<100ms、p95、drop実測 | [S-IP INF-15][S-RD FR-INF-010/NFR-PERF-004] |
| INF-16 | BLOCKED_DEP | `007_inference.sql`、profile/test | CORE-03, TRN-21 | Project別成功model/camera/threshold/display validate | [S-IP INF-16][S-RD FR-INF-014] |
| INF-17 | BLOCKED_DEP | setup/consent UI/test | INF-02, INF-16 | 成功版選択、OS prompt前説明と明示同意 | [S-IP INF-17][S-RD FR-INF-001/004] |
| INF-18 | BLOCKED_DEP | contention backend/dialog/test | INF-17, JOB-05 | accelerator競合時に学習停止/CPUを明示選択 | [S-IP INF-18][S-RD FR-INF-019] |
| INF-19 | BLOCKED_DEP | IPC/preload/contracts/test | INF-04〜05 | origin/session/shape検証、result/metricsだけ返す | [S-IP INF-19][S-RD FR-SEC-006] |
| DOC-07 | BLOCKED_DEP | camera guide | DOC-06, INF-14,15,18 | permission、非保存、profile、競合、実測warning | [S-IP DOC-07][S-CONTRIB §2] |

### 14.4 Phase L — Security / Reliability / Performance（24件）

Gate 4 PASSまで全体hardening完了を宣言しない。`LIC-02/STO-02 → STO-03 → PERF-03 → DOC-08`を含む依存順で進める。[S-IP §7 Phase L]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| SEC-01 | BLOCKED_GATE4 | CSP/navigation/window hardening/test | B-05, B-07, Gate 4 | remote/openExternal/new window deny、CSP、implicit download停止 | [S-IP SEC-01][P01] |
| SEC-02 | BLOCKED_ALL_IPC | sender validator/test、IPC audit | 全IPC | 全channel sender+schema、raw API 0 | [S-IP SEC-02][S-RD FR-SEC-006] |
| SEC-03 | BLOCKED_DEP | path adversarial test | DAT-14 | encoded traversal、junction/symlink、race、Project越境拒否 | [S-IP SEC-03][S-RD FR-SEC-008] |
| SEC-04 | BLOCKED_DEP | decoder security test | DAT-03 | 実pixel/byte/decompression上限 | [S-IP SEC-04][S-RD FR-SEC-008] |
| SEC-05 | BLOCKED_MODEL | safe model loader/test | AST-01 | approved ONNX/safetensors/weights-only、pickle/remote拒否 | [S-IP SEC-05][S-RD FR-SEC-007] |
| SEC-06 | BLOCKED_GATE4 | offline E2E/URL scan | Gate 4 | app outbound 0、source/build URL allowlist | [S-IP SEC-06][S-RD FR-SEC-002/003/013] |
| SEC-07 | BLOCKED_DEP | redaction/diagnostic export/test | JOB-04 | imageなし、username mask、explicit export、preview | [S-IP SEC-07][S-RD FR-SEC-010] |
| SEC-08 | BLOCKED_DEP | Node/Python audit scripts/tests/policy | B-01, B-11 | lock/native監査、未承認Critical/Highでfail、例外期限 | [S-IP SEC-08][S-DEP §11] |
| REL-01 | BLOCKED_DEP | atomic write helper/test | CORE-01 | temp/hash/rename/cleanup/failure injection | [S-IP REL-01][S-ADR2 §3.6] |
| REL-02 | BLOCKED_DEP | DB backup/test | CORE-03 | upgrade前backup、migration rollback | [S-IP REL-02][S-RD NFR-REL-002] |
| REL-03 | BLOCKED_DEP | crash recovery E2E | JOB-06, TRN-13 | Interruptedだけresume、metadata非破損 | [S-IP REL-03][S-RD POC-05] |
| REL-04 | BLOCKED_DEP | delete project/test | CORE-10, ANN-19, AST-03 | owned削除、Reference保持、失敗報告 | [S-IP REL-04][S-ADR2 §3.8] |
| LIC-01 | BLOCKED_PAYLOAD | SBOM/license scripts/tests/notice template | A-05 | TS/Python/native/model、unknown/禁止fail、C0条件 | [S-IP LIC-01][S-DEP §§7,12][S-C0 §§3〜5] |
| LIC-02 | BLOCKED_DEP | LicensesPage/IPC/test | LIC-01 | UI-08でSBOM/notices/model provenance | [S-IP LIC-02][S-RD FR-LIC-012] |
| LIC-03 | BLOCKED_SPI03 | CUDA decision/verify/tests | SPI-03, A-05 | 採用版EULA/allowlist。不採用ならCPU fallback記録 | [S-IP LIC-03][S-DEP §8] |
| STO-01 | BLOCKED_DEP | storage usage/test | CORE-01, TRN-20 | entity別実使用量、Reference symlink先非計上 | [S-IP STO-01][S-RD NFR-STO-002] |
| STO-02 | BLOCKED_DEP | generated-data deletion/test | STO-01, JOB-02 | cache/Failed一時checkpointだけ安全削除 | [S-IP STO-02][S-RD NFR-STO-003] |
| STO-03 | BLOCKED_DEP | StoragePage/test | STO-01,02, LIC-02 | UI-08内訳、preview/result、notice導線 | [S-IP STO-03][S-RD UI-08] |
| ACC-01 | BLOCKED_ALL_UI / MAC_NOT_RUN | accessibility E2E/manual | 全主要UI | keyboard/focus/label/screen reader/200%をOS別 | [S-IP ACC-01][S-RD NFR-UX-003] |
| UX-01 | BLOCKED_ALL_UI | Japanese/visual semantics audit | 全主要UI | 必須画面/error/permission/report日本語、色だけ禁止 | [S-IP UX-01][S-RD NFR-UX-001/002] |
| PERF-01 | BLOCKED_DEP | annotation benchmark/template | ANN-28 | 4K/100 box p95を基準hardwareで実測 | [S-IP PERF-01][S-RD NFR-ANN-002] |
| PERF-02 | BLOCKED_DEP | contention benchmark/template | TRN-33, INF-15,18 | warning、training stop/CPU、OOMなし実測 | [S-IP PERF-02][S-RD FR-INF-019] |
| PERF-03 | BLOCKED_DEP | UI benchmark/template | REP-10, STO-03 | metadata/画面遷移p95 500ms実測 | [S-IP PERF-03][S-RD NFR-PERF-001] |
| DOC-08 | BLOCKED_DEP | troubleshooting/security/storage guide | DOC-07, SEC-01〜08, REL-03/04, STO-03 | 実装済みpermission/reference/disk/OOM/cache/diagnosticだけ | [S-IP DOC-08][S-CONTRIB §2] |

### 14.5 Phase M — Installer / Servicing（23件）

Gate 4 PASS、LIC-03、OS別環境/identityが必要。`electron-builder.yml`はPKG-04→05→06の直列。[S-IP §7 Phase M][S-ADR3]

| ID | 現在 | 実装 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| PKG-01 | BLOCKED_MODEL_GATE2 | model verifier/test/manifest | AST-01, Gate 2 | approved local hashだけ、download/余剰/欠落拒否 | [S-IP PKG-01][S-DEP §6] |
| PKG-02 | BLOCKED_GATE4 | Windows worker spec/build script | SPI-03, LIC-03, Gate 4 | production commands/torch/ORT onedir、承認CUDAのみ | [S-IP PKG-02][S-ADR3 §2.4] |
| PKG-03 | MAC_NOT_RUN | macOS worker spec/build script | SPI-04, Gate 4 | native arm64 onedir、nested Mach-O一覧 | [S-IP PKG-03][S-ADR3 §10] |
| PKG-04 | BLOCKED_DEP | common builder config/resource verifier/test | PKG-01 | app/worker/model/noticesをextraResources、OS設定なし | [S-IP PKG-04][P03] |
| PKG-05 | BLOCKED_DEP | Windows NSIS config | PKG-02,04 | per-user one-file offline EXE、restartなし | [S-IP PKG-05][P02] |
| PKG-06 | MAC_NOT_RUN / BLOCKED_DEP | macOS PKG/entitlements、shared config固定 | PKG-03,05 | `/Applications`、arm64、最小entitlement | [S-IP PKG-06][P02][P04] |
| PKG-07 | BLOCKED_SIGN_WIN | Windows sign/verify scripts | PKG-09,10,19, D-16 | installer/全PEをCA chain+SHA-256/RFC3161検証 | [S-IP PKG-07][S-RD FR-INS-008] |
| PKG-08 | MAC_NOT_RUN / BLOCKED_SIGN_MAC | macOS sign/notarize/verify | PKG-09,10,20, D-16 | nested code、HR、PKG sign、notary、staple | [S-IP PKG-08][S-RD FR-INS-010] |
| PKG-09 | BLOCKED_DEP | version compatibility/test | REL-02 | same repair、newer拒否、backup migration、rollback | [S-IP PKG-09][S-RD FR-INS-015/016] |
| PKG-10 | BLOCKED_DEP | project retention/test | PKG-05,06, REL-04 | uninstallでapp/runtime削除、Project既定保持 | [S-IP PKG-10][S-RD FR-INS-020] |
| PKG-11 | BLOCKED_SIGN_WIN | Windows clean install script/result | PKG-07,19 | offline標準user/no runtimes/restartなし/15秒/Project | [S-IP PKG-11][S-RD POC-11] |
| PKG-12 | MAC_NOT_RUN / BLOCKED_SIGN_MAC | macOS clean install script/result | PKG-08,20 | offline/no Rosetta/Homebrew/Xcode/Gatekeeper/15秒 | [S-IP PKG-12][S-RD POC-12] |
| PKG-13 | BLOCKED_DEP / MAC_NOT_RUN | OS servicing scripts | PKG-09〜12 | upgrade/repair/forced rollback/uninstallをOS別実機 | [S-IP PKG-13][S-RD POC-13] |
| PKG-14 | BLOCKED_DEP | offline install evidence/payload inventory | PKG-11〜13,21,22 | stub/download 0、payload=SBOM/hash、余剰0 | [S-IP PKG-14][S-RD NFR-INS-007] |
| PKG-15 | BLOCKED_DEP | checksum script/test/release docs | PKG-14 | EXE/PKG命名とSHA-256生成・再検証 | [S-IP PKG-15][S-RD FR-INS-001/002] |
| PKG-16 | BLOCKED_DEP | size generator/schema/test | PKG-04 | OS別圧縮/展開/temp+10%実測manifest | [S-IP PKG-16][S-RD NFR-INS-003] |
| PKG-17 | BLOCKED_DEP | NSIS preflight/test | PKG-06,16 | OS/arch/disk/write/versionを変更前検査、日本語停止 | [S-IP PKG-17][S-RD FR-INS-007] |
| PKG-18 | MAC_NOT_RUN | macOS preinstall/test | PKG-06,16 | OS/arm64/disk/write/versionをinstall前検査 | [S-IP PKG-18][S-RD FR-INS-007] |
| PKG-19 | BLOCKED_DEP | Windows installer messages/UX/test | PKG-09,17 | 日本語progress/error/complete、Start、log、servicing | [S-IP PKG-19][S-RD FR-INS-012/017〜020] |
| PKG-20 | MAC_NOT_RUN | macOS postinstall/UX/test | PKG-09,18 | Installer UI、Applications、log、servicing、no Terminal | [S-IP PKG-20][S-RD FR-INS-011/012/017] |
| PKG-21 | BLOCKED_MAC | payload parity compare/result | PKG-11,12 | schema/model/feature/notices一致、OS binary差だけ | [S-IP PKG-21][S-RD NFR-INS-008] |
| PKG-22 | BLOCKED_DEP / MAC_NOT_RUN | installer accessibility manual | PKG-19,20 | keyboard/screen readerで全stateをOS別確認 | [S-IP PKG-22][S-RD NFR-INS-004] |
| DOC-09 | BLOCKED_DEP | install/upgrade/uninstall guide | DOC-08, PKG-11〜22 | OS別の実測済み手順だけ記載 | [S-IP DOC-09][S-CONTRIB §2] |

### 14.6 Phase N — Final acceptance（7件）

waveは`FIN-01,03,04 → FIN-02,05,06 → FIN-07`。[S-IP §7 Phase N]

| ID | 現在 | 成果物 | 依存 | 検証 | 出典 |
|---|---|---|---|---|---|
| FIN-01 | BLOCKED_ALL_FEATURES | `docs/traceability.md` | 全feature test | 229 requirement→task→test→OS/statusを1件ずつ照合 | [S-IP FIN-01][S-RD §17] |
| FIN-02 | BLOCKED_DEP / MAC_NOT_RUN | `docs/test-matrix.md` | FIN-01 | Windows/macOS、CPU/accelerator、manual/automated/NOT_RUN | [S-IP FIN-02][S-RD NFR-MNT-003] |
| FIN-03 | BLOCKED_ALL_POC | `docs/acceptance-report.md` | POC-01〜17相当test | hardware、実値、failure、waiver、raw evidence | [S-IP FIN-03][S-RD §15] |
| FIN-04 | BLOCKED_ALL_DOC | `docs/users-guide.md`最終review | DOC-01〜10 | UI文言/導線/link、screenshotは実画面のみ | [S-IP FIN-04][S-CONTRIB §5] |
| FIN-05 | BLOCKED_DEP | `README.md` | FIN-03/04 | 実態の概要、対応OS、docs、license/model caveat | [S-IP FIN-05][S-RD §16] |
| FIN-06 | BLOCKED_DEP | `docs/release-checklist.md` | LIC-01〜03, SEC-08, PKG-15, FIN-03 | signing/SBOM/vulnerability/model/offline/rollback evidence | [S-IP FIN-06][S-DEP §12] |
| FIN-07 | BLOCKED_DEP | acceptance/checklist Gate 5判定 | FIN-01〜06 | 必須未達1件でもrelease停止を明記 | [S-IP FIN-07][S-RD §16] |

## 15. 直列化・並列lane・統合検証

### 15.1 同時編集禁止

次は同時編集しない。[S-IP §§5.1,7][S-CONTRIB §3]

- `ml/src/autovision_ml/cli.py`: CORE-11 → DAT-01 → AST-04 → TRN-14。
- `docs/users-guide.md`: DOC-01 → DOC-02 → DOC-03 → DOC-04 → DOC-05 → DOC-10 → DOC-06 → DOC-07 → DOC-08 → DOC-09 → FIN-04。
- `resources/models/manifest.json`: SPI-18 → AST-01（reader）→ PKG-01。
- `electron-builder.yml`: PKG-04 → PKG-05 → PKG-06。
- migration: `001_core → 002_jobs → 003_import → 004_annotations → 005_suggestions → 006_training → 007_inference`。
- shared contract変更taskと、それを読むclassification/detection lane。
- package/lock変更taskと、同じlockを前提にするbuild/audit task。

安全な並列単位は、依存済みかつ出力fileが重ならないUI / Core / ML-Class / ML-Detect / Release-Windows / Release-macOS / Docs laneだけ。Docsは実装より先行しない。[S-IP §5.1]

### 15.2 Wave後の統合Gate

各wave終了時に次を実行し、実行範囲と件数を記録する。[S-CONTRIB §§2,5,8]

1. 対象Node/Python tests。
2. `npm run typecheck`、Ruff、Pyright。
3. 影響するMain/Preload/Renderer build。
4. lock変更taskではclean install、pending scripts、integrity/hash、license、vulnerability。
5. Electron/worker変更では実process smokeと残process 0。
6. `git diff --check`、editor diagnostics。
7. 独立敵対レビューと指摘再現。
8. macOS未実施をWindows PASSへ混在させない。

## 16. Task commit証拠テンプレート

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

task commit後は`git show --stat <sha>`と`git merge-base --is-ancestor <sha> HEAD`を保存し、単にfileが存在することを完了根拠にしない。[S-CONTRIB §10]

## 17. 実行順と外部停止地点

### 17.1 現環境または同等Windowsで直ちに可能

依存が成立し、出力が重ならない順序は次である。[S-IP §7][E-GIT]

1. SPI-10のWIPを保全し、hangを切り分け、実Chromium p95と`result.md`を完成、敵対レビュー後に単独commitする。[S-IP SPI-10][E-SPI10]
2. SPI-08のWindows CPU/DML専用probe/resultを完成する。SPI-03証拠の転用範囲を明記し、専用task成果物を作る。[S-IP SPI-08][E-SPI03]
3. SPI-19 Windows部分を実施し、参照元write/delete 0を含める。ただしmacOS未実施のためtask全体はPARTIALの可能性がある。[S-IP SPI-19][S-ADR2 §3.2]
4. SPI-11〜14を各1 task/1 commitで一次資料監査する。必須項目がunknownなら`保留`または`却下`で閉じ、approved manifestへ追加しない。[S-MODEL][S-DEP §6]
5. clean Windows VMを用意できた時点でSPI-03を再開する。Sandbox失敗を隠さず、新しいclean-host結果で更新する。[E-SPI03][S-IP SPI-03]

### 17.2 そこで停止する条件

次のいずれかが不足した時点で依存taskへ進まず停止する。[S-CONTRIB §2.1]

- native Apple Silicon Macがなく、SPI-04/06/08 macOS/19 macOSまたはGate 1を完了できない。[S-C0 §6]
- C6/C7候補のcheckpoint/license/data由来/hash/qualityがunknownまたは不適合で、SPI-15〜17/Gate 2を開始できない。[S-DEP §6][S-MODEL][S-MANIFEST]
- 権利確認済みfixture/gold setがなく、parity/品質数値を測れない。[S-RD §§6,15]
- clean Windows/no Python証拠がなく、SPI-03/05を完了できない。[S-RD NFR-INS-001][E-SPI03]
- 署名identityがなく、PKG-07/08以降を実行できない。[S-ADR3 §6]
- SPI-19が両OSで成立しない場合、Reference modeを成立済みとみなさず、DAT-12/14/15、TRN-01、REP-06、REL-04、STO-01等の直接・間接依存と要求scopeを上位正本から再計画する。[S-IP SPI-19, DAT-12, DAT-14, DAT-15, TRN-01, REP-06, REL-04, STO-01][S-ADR2 §§2.2,3.2]

Gate 1未PASSのままPhase Dへ、Gate 2/3未PASSのままmodel固有Phase H/Iへ、Gate 4未PASSのままrelease packageへ進まない。[S-IP §6]

## 18. 期間・性能・費用

- 227件の所要日数は、task velocity、CI時間、model取得可否、fixture、GPU、署名identityが未確定なので見積もらない。[S-RD §§2.2,12,18]
- 学習時間、trial数、accuracy、10Hz達成、installer sizeは実測前に数値を置かない。[S-RD FR-TRN-009/018, FR-INF-010, TBD-03]
- 既存要求値（5秒、100ms、15秒、20%/10%余裕）は受入閾値であり、現在の達成実績ではない。[S-RD §§8,11]
- 外部service費用は通常runtimeで0を前提とするが、証明書、Apple Developer Program、build hardware費用は未調査のため金額を書かない。[S-RD §3.3][S-ADR3 §6]

## 19. 全残task完了条件

次を全て満たしたときだけ「残227件完了」とする。[S-IP §§6〜7][S-RD §§15〜16]

1. 227 taskが個別VERIFIED、敵対レビューCLOSED、main統合済み。
2. Gate 1〜5が正本どおりPASS。macOS要求を維持する限りnative Apple Silicon証拠が必要。
3. 229 requirementがtest/manual evidenceへ欠落なくtraceされる。
4. classification/detectionのannotation、initial/project assist、training、ONNX parity、report、cameraが成立。
5. runtime outbound 0、unconfirmed suggestion 0、unknown license 0、未承認Critical/High 0。
6. C0条件のSBOM/NOTICE/MPL source案内/build-only分離がfinal payloadで成立。
7. Windows EXEとmacOS PKGが正式署名、自己完結、offline clean install/servicing済み。
8. SBOM、NOTICE、model manifest、payload inventory、checksumが一致。
9. guide/READMEが実装・実測と一致し、未実装手順や推測値がない。
10. 不要worktree/branch/未追跡WIPなし、working tree clean、handoff commitから再現可能。

条件未達でもFIN-07は実行できるが、Gate 5をPASSにせずrelease停止を記録する。[S-IP FIN-07]

## 20. 出典・hash台帳

### 20.1 Repository正本

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
| S-MODEL | `docs/model-governance/adoption-template.md` | 23,132 | `F9C25B60FD2E70DD6D3450E0940E8B236EAB7109EAA2EC390EF224F128878085` | C5/C6/C7/C8証拠テンプレート |
| S-NODE | `package.json` | 1,851 | `FF453837A63E1CBEC14D8630F5EC477D562A7DAEF85A384B18A9CAB840781F55` | Node/npm engines、exact direct依存 |
| S-NPMLOCK | `package-lock.json` | 250,434 | `7F1BD82EFE1E4919DCE6DDFFDB763CEFF4404D29B60E8E946A150345A8DFE1A5` | Node exact transitive lock |
| S-PY | `ml/pyproject.toml` | 2,164 | `4631204BA6C1F632F92C5273462C92EC1CAF15BA15491FD0C03382AAF288F6FE` | Python target、direct依存、tool config |
| S-UVLOCK | `ml/uv.lock` | 80,531 | `D14D188A0D1F92F34A9436ECC0B2C801BB0375B36619199F846924C112C7E5FC` | Python exact universal lock |
| S-MANIFEST-SCHEMA | `resources/models/manifest.schema.json` | 22,472 | `AEA75BAFE864B36E268F075A6F87B850AF585B099F0FD73B9BA2631D25E75AE0` | fail-closed model schema |
| S-MANIFEST | `resources/models/manifest.json` | 648 | `7FE41F5BC497D48FFCBBAEBAEB5CB02E91DFBA0E1A6FE9B66D8CF8928C437A61` | models=[]、承認済みmodel 0 |
| H-OLD | `work/20260903-1340-TaskExecutionPlan.md` | 71,238 | `89A61A743AB83980AC8E0F36E90D91A6C3090BCD18926B492588157444C11DFA` | commit `5828cfe52cc37cd0638280433ca16213228d41b2`の旧計画 |

### 20.2 実測・Git証拠

- **[E-GIT]** 2026-09-03、`git rev-parse HEAD/origin/main`、`git branch --show-current`、`git rev-list --left-right --count`、`git status --short --branch`、`git worktree list --porcelain`、`git for-each-ref`。結果は§2.1/§3。[本計画作成session]
- **[E-ENV]** 2026-09-03、PowerShell、Win32_OperatingSystem/Processor、`Get-Command`、各`--version`、manifest JSON count。結果は§2.1。[本計画作成session]
- **[E-COUNT]** PowerShell parserで`docs/implementation-plan.md`のtask table行を解析。253 rows / 253 unique / duplicate 0。VERIFIED集合26、残227。残prefix: SPI16、CORE14、DOC10、JOB8、DAT15、ANN28、AST23、TRN31、REP11、INF19、SEC8、REL4、LIC3、STO3、ACC1、UX1、PERF3、PKG22、FIN7。[本計画作成session]
- **[E-HASH]** 2026-09-03、PowerShell 7.6.5 `Get-FileHash -Algorithm SHA256`と`Get-Item.Length`。[本計画作成session]
- **[E-A]** `98aba1fdd609b546641e9be80b600651e0476fc6`がA-01〜06/A-08〜10、`e92ad5989c88b0c4d148096eab69ae13422bc625`がA-07を導入し、両commitは`git merge-base --is-ancestor`で現HEADのancestor。[Git history][H-OLD]
- **[E-B]** B task/fix commit列`c01be9354d0b77153e571510f2c1c294cbc5da00`〜`4cec3a9c8244a95d4a3bfc5eb73ac5e7b82e8850`は現HEADのancestor。最新統合証拠は[S-C0 §8]のNode 4 files/19 tests、Python 4 tests、type/lint/build/window smoke。[Git history][S-C0]
- **[E-SPI01]** commit `464af17d37f24daab9a6fd2a9ffd81223d6176be`、`spikes/sqlite/README.md` SHA-256 `910D8D96100D1885ABE051E2D7945761091967FB162244320279B1B91EDE6788`。[Git history]
- **[E-SPI02]** commit `5a02275641932fab33837a873f3b9389330154a5`、`spikes/worker/README.md` SHA-256 `062EFE1428D698A3DEA24CB8C6F25C41B53405B258C01FDA622835F183700406`。[Git history]
- **[E-SPI07]** commit `3ca121e9849a4e85b59e8c601b8a8cb0845bac37`、`spikes/inference/pipe-result.md` SHA-256 `20A203D64EED4D057B71A474A4451291EB107C0C87F3CB9D599E5E01E59B2031`。[Git history]
- **[E-SPI03]** commit `30bc02d70175cb22f0bbb52bd7e888e0a8f6ac28`、`spikes/packaging/windows-result.md` SHA-256 `C79F18446C519A89FA4D848CC4232633FA3B93BA77821D81FC56FBD6FA8D96A2`。文書自身がPARTIAL/clean host NOT_RUNを記録。[Git history]
- **[E-SPI10]** untracked WIP hash: `CanvasSpike.tsx`=`EF7DE2C02B0510C7234DB61598371CFBD3D00C8DDC08FA33D6D973072358D77A`、test=`C5801A355DE9962796CA14483ADDC74D444EC7568676F95923468534815B3148`。Vitest fork 5/5 PASS、Electron benchmark resultなし、約898.2秒後強制終了exit -1、残process 0。[本計画直前session]
- **[E-REVIEW]** 2026-09-03、PowerShell parserによる残task集合比較、`git diff --check`、editor diagnostics、および独立read-only reviewer 2系統。修正前後の指摘・裁定は§21。[本計画作成session]

### 20.3 外部一次資料索引

本計画は外部ページを再取得していない。完全URLと2026-09-02時点の調査内容は[S-RD §19]のS1〜S55、実装技術索引は[S-IP §12]のP01〜P16にある。各taskで最新公式資料を再取得し、取得日・版・保存hashを追加する。[S-CONTRIB §5]

主要索引:

- **[P01]** Electron Security — `https://www.electronjs.org/docs/latest/tutorial/security`
- **[P02]** electron-builder NSIS / PKG — `https://www.electron.build/nsis.html`, `https://www.electron.build/pkg.html`
- **[P03]** electron-builder Application Contents — `https://www.electron.build/contents.html`
- **[P04]** electron-builder macOS signing/notarization — `https://www.electron.build/code-signing-mac.html`
- **[P05]** PyInstaller operating mode / OS support — `https://pyinstaller.org/en/stable/operating-mode.html`, `https://pyinstaller.org/en/stable/usage.html#supporting-multiple-operating-systems`
- **[P06]** Konva selection/bounds — [S-IP §12]の`https://konvajs.org/docs/select_and_transform/Basic_demo.html`, `https://konvajs.org/docs/sandbox/Limited_Drag_And_Resize.html`。performance補足`https://konvajs.org/docs/performance/All_Performance_Tips.html`はSPI-10作業中の2026-09-03に公式docs queryで参照したが、本計画だけでは採用証拠にせずSPI-10再開時に再取得・保存する [E-SPI10]
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

---

**本書の状態:** 正本、Git history、保存済み実行証拠、現在のworking treeを分離して構成した。未実装task、clean Windows、macOS、model承認、署名、性能達成を宣言しない。本書作成後は独立レビューで253/26/227、全227 ID、DAG、引用、handoff、WIP境界を再照合してからcommitする。[S-CONTRIB §§2.2,5,10]

## 21. 敵対レビューと裁定

2026-09-03、正本task parserと2つの独立read-only reviewで本書を照合した。[E-REVIEW]

### 21.1 機械照合

- 正本253 rows / 253 unique / duplicate 0。
- VERIFIED集合26、残集合227。
- §7〜§14のtask tableは227 rows / 227 unique、残集合に対する欠落0・余剰0・重複0。
- 文書全体に現れる正本外IDは、欠番として明示した`AST-17`、`TRN-23`、`TRN-24`だけ。
- `git diff --check`とeditor diagnosticsは問題0。[E-COUNT][E-REVIEW]

### 21.2 指摘と裁定

| ID | 指摘 | 再現・裁定 | 出典 |
|---|---|---|---|
| AR-01 | PARTIAL/BLOCKED/MAC_NOT_RUNを残227件に含めると、全件が即実行可能と誤読される | 残数は「未VERIFIED集合」なので除外・減算はしない。§2.2に即実行可能数ではないことを明記 | [E-COUNT][S-CONTRIB §§2〜3] |
| AR-02 | SPI-10は`result.md`とp95がなく、handoff可能性を過大表示し得る | 未完了であることは再現。IN_PROGRESSは完了主張ではない。§2.4/§7.1にWIP hash、欠落成果物、hang、再開手順、patch別管理を保持 | [E-SPI10][S-IP SPI-10] |
| AR-03 | SPI-03 commitを完了数へ含める危険 | 再現せず。SPI-03はPARTIALとして残227件に含め、clean Windowsとlicense payloadをblockerとして維持 | [E-SPI03][S-IP SPI-03] |
| AR-04 | A/B 23件の現HEAD ancestryが曖昧 | 可読性指摘を採用。§20.2へA commit 2件、B commit列、`merge-base --is-ancestor`結果を明記 | [E-A][E-B][E-GIT] |
| AR-05 | macOS/model/Reference依存を通常TODOと誤読し得る | §4/§6/各taskで既にBLOCKED。さらに§17.2へSPI-19不成立時の上位正本再計画境界を追加 | [S-C0 §6][S-DEP §6][S-ADR2 §3.2] |
| AR-06 | 外部資料を今回再取得していない | 事実。成功証拠へ使わず、§1.2/§20.3で各task時の再取得日・版・保存hashを必須化 | [S-CONTRIB §5][S-DEP §6] |
| AR-07 | SPI-07数値を別hardware性能へ転用できるように読める | artifactにCPU型番がないことを確認。§2.3へportable hardware baselineではないと追記 | [E-SPI07] |

blocking findingは修正後0。ただしこれはtask実装、clean host、macOS、model、署名、性能のblockerを解除しない。[E-REVIEW][S-CONTRIB §2.2]
