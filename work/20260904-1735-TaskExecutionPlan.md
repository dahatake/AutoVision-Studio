# AutoVision Studio Windows MVP 残タスク実行・移送計画

| 項目 | 値 | 出典 |
|---|---|---|
| 作成基準 | 2026-09-04 17:35 | ユーザー指定ファイル名、[E-BASE] |
| 対象 | Version 1（Windows 11 24H2 以降 x64）の全残タスク | [S-RD] §1〜§4、[S-IP] §1.4 / §6 |
| 将来 backlog | macOS 固有 task 9件と `DOCS-402`。Version 1 の Gate・完了率から除外 | [S-IP] §7 Phase C / Phase M、[S-WIN] §2〜§3 |
| Git 基準 | `main` / `c6179c6a42f47b4962df5222aec3d93358594166` | [E-BASE] |
| 作業ツリー | 本書作成前に tracked modified 16件、untracked 19件。clean checkout では再現できない | [E-BASE] |
| 要求正本 | `docs/requirement-definition.md` v0.4 Draft | [S-RD] |
| 要求 raw SHA-256 | `38e79907b8b5620fffd50dd73a79322d1d97e606b90e81b0b9b06140958e5ce5` | [E-HASH] |
| 要求 LF-normalized SHA-256 | `8c8dcdffc6049b6fc0503079ffb1edf3c2464d9e24150155530b82fa5df44f6b` | [E-HASH] |
| タスク正本 | `docs/implementation-plan.md`。正本 ID 260件、重複0 | [S-IP] §7、[E-COUNT] |
| 本書の性質 | 実行計画であり、未実行 task・test・Gate の PASS 証拠ではない | [S-CONTRIB] §2 / §5 |

> **捏造禁止境界:** 実際に取得していない model、権利、署名、camera、clean host、reboot、性能、test result、review finding を記録しない。再現できない懸念は問題として追加せず、`不採用`と根拠を記録する。未実施は `NOT_RUN`、一部だけは `PARTIAL`、外部入力不足は `BLOCKED` とする。[S-CONTRIB] §2.1〜§2.2 / §5、[S-WIN] §1

## 1. 正本と出典

### 1.1 優先順位

矛盾時は次の順に従う。本書だけで要求、task ID、Gate、ADR を上書きしない。[S-RD][S-IP][S-CONTRIB]

1. `docs/requirement-definition.md` v0.4 Draft。[S-RD]
2. `docs/implementation-plan.md` の task、依存、Gate、traceability。[S-IP] §5〜§9
3. ADR-0001〜0003 の process、data、packaging 境界。[S-ADR1][S-ADR2][S-ADR3]
4. `docs/dependency-policy.md`、C0 記録、`CONTRIBUTING.md`。[S-C0][S-CONTRIB]
5. Windows 再ベースライン計画と各実行記録。[S-WIN][S-V0][S-DOCREC][S-WINREC]
6. 本書。

### 1.2 出典台帳

| ID | 出典 | 使用範囲 |
|---|---|---|
| S-RD | `docs/requirement-definition.md` v0.4 Draft。raw / LF hash は本書冒頭 | Windows MVP、229 requirement ID、将来 macOS、受入条件 |
| S-IP | `docs/implementation-plan.md`。raw SHA-256 `fbcdc7fcd64e216c527ba3e8b10851d563dac928be731811b60689eee364fb6d`、LF SHA-256 `943d378cda708c857b166d2a64c9353f9da87a56a80e575ed6a1ee13b07770a3` | 260 task、依存、成果物、完了条件、Gate、requirement mapping |
| S-WIN | `work/20260904-WindowsMvpRebaselineExecutionPlan.md` | `WIN-SCOPE-*`、Windows MVPへの移行、外部blocker、完了済み01〜03 |
| S-CONTRIB | `CONTRIBUTING.md` | 小task、検証、敵対的review、PowerShell、lock、証拠規約 |
| S-ADR1 | `docs/adr/0001-process-architecture.md` | Renderer / Preload / Main / worker / IPC 境界 |
| S-ADR2 | `docs/adr/0002-data-lifecycle.md` | Workspace、Ground Truth、Revision、Run、Model、Copy / Reference |
| S-ADR3 | `docs/adr/0003-packaging.md` | Windows NSIS、PyInstaller onedir、署名、servicing、Future macOS |
| S-C0 | `docs/dependency-adoption/c0-review.md` と同directoryの採用記録 | exact dependency、Windows B-GATE、license / vulnerability boundary |
| S-V0 | `work/20260904-ProductVersionExecutionRecord.md` | `VER-00`〜`VER-GATE-01` の完了証拠 |
| S-DOCPLAN | `work/20260904-1140-DocumentationTaskExecutionPlan.md` | `DOCS-*` 37件の元依存。v0.3時点のため残依存は本書でWindows化 |
| S-DOCREC | `work/20260904-DocumentationExecutionRecord.md` | `DOCS-001`〜`DOCS-306` の完了証拠、D0 / D1 |
| S-WINREC | `work/20260904-WindowsTaskExecutionRecord.md` | SPI-08 Windows CPU / DirectML再検証 |
| S-SPI01 | `spikes/sqlite/README.md` | Electron / unpacked package の SQLite PoC境界 |
| S-SPI02 | `spikes/worker/README.md` | Electron→Python JSON / NDJSON / cancel PoC境界 |
| S-SPI03 | `spikes/packaging/windows-result.md` | Windows onedir PARTIAL、clean Windows BLOCKED |
| S-SPI07 | `spikes/inference/pipe-result.md` | RGB pipe Windows再検証、camera 30分非対象 |
| S-SPI08 | `spikes/inference/provider-result.md` | Windows CPU / DirectML PASS、旧macOS NOT_RUN履歴 |
| S-SPI10 | `build/spi10/benchmark-result.json` と `spikes/annotation/result.md` | 最新artifact PASSと、未同期の説明文書 |
| S-SPI19 | `spikes/reference/windows-result.md`, `spikes/reference/macos-result.md` | Windows別process PASS、Windows reboot NOT_RUN、macOS future |
| S-MODEL | `docs/model-governance/classification-base.md`, `detection-base.md`, `classification-assist.md`, `detection-assist.md` | SPI-11〜14のHOLD / BLOCKED根拠 |
| S-MANIFEST | `resources/models/manifest.json`, `manifest.schema.json` | approved model 0、fail-closed loader / package境界 |
| S-NODE | `package.json`, `package-lock.json`, `.npmrc` | Node 24.19.x、npm 12.0.0、scripts、approved npm feed |
| S-PY | `ml/pyproject.toml`, `ml/uv.lock` | uv 0.12.9、Python / OS marker、Python dependency |
| S-KAC | <https://keepachangelog.com/en/1.1.0/>（2026-09-04取得） | `CHANGELOG.md`, `Unreleased`, Added / Changed / Deprecated / Removed / Fixed / Security |
| S-SEMVER | <https://semver.org/spec/v2.0.0.html>（2026-09-04取得） | 後方互換bug fixのPATCH増分 |
| S-SKILLS | 別repository `dahatake/skills`: `README.md` §9、各 `KIT-VERSION.json` / `pyproject.toml` | Markdown Query / Code Query の条件付きversion更新 |
| E-BASE | 2026-09-04 PowerShell 7.6.5実測: branch、HEAD、`git status --porcelain` | handoff基準 |
| E-HASH | 同sessionの `Get-FileHash` と CRLF→LFだけを行う SHA-256計算 | 正本・lock・artifact hash |
| E-COUNT | `docs/implementation-plan.md` §7を許可ID形式で機械抽出 | 260 = completed 33 + active 218 + future 9 |
| E-EXT | `C:\GitHub\skills` HEAD `c559e767354e5a79cda4bb2207be52ded689617f` はclean。4 version fileのhashは§19.2に記録。`hve` source repository / version manifestは現環境にない | 最終package impact判定 |

外部技術資料は[S-RD] §19と[S-IP] §12の索引を起点とし、dependency、model、Windows API、packagingを採用するtaskで最新版を再取得する。URLを見ただけで採用・互換・権利をPASSにしない。[S-CONTRIB] §5、[S-IP] §4.4

## 2. 現在地と残件算術

### 2.1 正本260 task

保存済み証拠から完了扱いにできる正本taskは次の33件だけである。[S-V0][S-WINREC][S-SPI01][S-SPI02][S-SPI07][E-COUNT]

- `A-01`〜`A-10`（10件）
- `B-01`〜`B-13`（13件）
- `VER-00`, `VER-01`, `VER-02`, `VER-03`, `VER-04`, `VER-GATE-01`（6件）
- `SPI-01`, `SPI-02`, `SPI-07`, `SPI-08`（4件）

`SPI-10` は最新artifactが `status=ok`, `verdict=PASS` だが、最新数値の説明文書同期、raw evidence再計算、独立敵対的review、review反映確認が未完了なので残件に置く。[S-SPI10][S-IP] SPI-10

| 集合 | 件数 | 算式 | 出典 |
|---|---:|---|---|
| 正本task | 260 | §7 table rows / unique IDs | [S-IP] §7、[E-COUNT] |
| 完了済み | 33 | 10 + 13 + 6 + 4 | 上記証拠 |
| Version 1残task | **218** | 260 - 33 - 9 future | [E-COUNT] |
| Future macOS task | **9** | 2 SPI + 7 PKG | [S-IP] Future macOS backlog |

### 2.2 正本外の残実行単位

| namespace | 残件 | 扱い | 出典 |
|---|---:|---|---|
| Windows再ベースライン | 5 | `WIN-SCOPE-04`, `05`, `06`, `07`, `WIN-SCOPE-GATE` | [S-WIN] §2 / §10 |
| 現行Windows向けDOCS | 11 | `DOCS-401`, `403`〜`407`, `501`〜`505` | [S-DOCPLAN] §8.5〜§8.6。本書で`402`をfuture化 |
| Future macOS DOCS | 1 | `DOCS-402` | [S-DOCPLAN] DOCS-402、[S-RD] §3.2 / §4 |
| 移送operation | 3 | `HND-01`〜`HND-03` | dirty worktree [E-BASE] |
| 最終処理 | 2 | `FINAL-CHANGELOG`, `FINAL-PACKAGE-IMPACT` | ユーザー指示、[S-KAC][S-SEMVER] |
| 条件付きpackage更新 | 最大3 | `FINAL-HVE-PATCH`, `FINAL-MDQ-PATCH`, `FINAL-CQ-PATCH` | ユーザー指示、[S-SKILLS][E-EXT] |

namespaceを跨いだ件数は製品taskの完了率へ合算しない。package更新は実際に当該packageを変更した場合だけ発生し、未変更packageを版だけ更新しない。[S-SEMVER][E-EXT]

## 3. 全残task ID台帳

### 3.1 Version 1 正本残218件

| Phase | 件数 | 残task ID | 出典 |
|---|---:|---|---|
| C | 13 | `SPI-03`, `SPI-05`, `SPI-09`, `SPI-10`, `SPI-11`, `SPI-12`, `SPI-13`, `SPI-14`, `SPI-15`, `SPI-16`, `SPI-17`, `SPI-18`, `SPI-19` | [S-IP] §7 Phase C |
| D | 15 | `CORE-01`, `CORE-02`, `CORE-03`, `CORE-04`, `CORE-05`, `CORE-06`, `CORE-07`, `CORE-08`, `CORE-09`, `CORE-10`, `CORE-11`, `CORE-12`, `CORE-13`, `CORE-14`, `DOC-01` | [S-IP] §7 Phase D |
| E | 8 | `JOB-01`, `JOB-02`, `JOB-03`, `JOB-04`, `JOB-05`, `JOB-06`, `JOB-07`, `JOB-08` | [S-IP] §7 Phase E |
| F | 16 | `DAT-01`, `DAT-02`, `DAT-03`, `DAT-04`, `DAT-05`, `DAT-06`, `DAT-07`, `DAT-08`, `DAT-09`, `DAT-10`, `DAT-11`, `DAT-12`, `DAT-13`, `DAT-14`, `DAT-15`, `DOC-02` | [S-IP] §7 Phase F |
| G | 29 | `ANN-01`, `ANN-02`, `ANN-03`, `ANN-04`, `ANN-05`, `ANN-06`, `ANN-07`, `ANN-08`, `ANN-09`, `ANN-10`, `ANN-11`, `ANN-12`, `ANN-13`, `ANN-14`, `ANN-15`, `ANN-16`, `ANN-17`, `ANN-18`, `ANN-19`, `ANN-20`, `ANN-21`, `ANN-22`, `ANN-23`, `ANN-24`, `ANN-25`, `ANN-26`, `ANN-27`, `ANN-28`, `DOC-03` | [S-IP] §7 Phase G |
| H | 22 | `AST-01`, `AST-02`, `AST-03`, `AST-04`, `AST-05`, `AST-06`, `AST-07`, `AST-08`, `AST-09`, `AST-10`, `AST-11`, `AST-12`, `AST-13`, `AST-14`, `AST-15`, `AST-16`, `AST-18`, `AST-19`, `AST-20`, `AST-21`, `AST-22`, `DOC-04` | [S-IP] §7 Phase H |
| I | 32 | `TRN-01`, `TRN-02`, `TRN-03`, `TRN-04`, `TRN-05`, `TRN-06`, `TRN-07`, `TRN-08`, `TRN-09`, `TRN-10`, `TRN-11`, `TRN-12`, `TRN-13`, `TRN-14`, `TRN-15`, `TRN-16`, `TRN-17`, `TRN-18`, `TRN-19`, `TRN-20`, `TRN-21`, `TRN-22`, `TRN-25`, `TRN-26`, `TRN-27`, `TRN-28`, `TRN-29`, `TRN-30`, `TRN-31`, `TRN-32`, `TRN-33`, `DOC-05` | [S-IP] §7 Phase I |
| I.1 | 3 | `AST-23`, `AST-24`, `DOC-10` | [S-IP] §7 Phase I.1 |
| J | 12 | `REP-11`, `REP-01`, `REP-02`, `REP-03`, `REP-04`, `REP-05`, `REP-06`, `REP-07`, `REP-08`, `REP-09`, `REP-10`, `DOC-06` | [S-IP] §7 Phase J |
| K | 20 | `INF-01`, `INF-02`, `INF-16`, `INF-17`, `INF-03`, `INF-04`, `INF-05`, `INF-06`, `INF-19`, `INF-07`, `INF-08`, `INF-09`, `INF-10`, `INF-11`, `INF-12`, `INF-18`, `INF-13`, `INF-14`, `INF-15`, `DOC-07` | [S-IP] §7 Phase K |
| L | 24 | `SEC-01`, `SEC-02`, `SEC-03`, `SEC-04`, `SEC-05`, `SEC-06`, `SEC-07`, `SEC-08`, `REL-01`, `REL-02`, `REL-03`, `REL-04`, `LIC-01`, `LIC-02`, `LIC-03`, `STO-01`, `STO-02`, `STO-03`, `ACC-01`, `UX-01`, `PERF-01`, `PERF-02`, `PERF-03`, `DOC-08` | [S-IP] §7 Phase L |
| M | 17 | `PKG-01`, `PKG-02`, `PKG-04`, `PKG-05`, `PKG-07`, `PKG-09A`, `PKG-09B`, `PKG-10`, `PKG-16`, `PKG-17`, `PKG-19`, `PKG-11`, `PKG-13`, `PKG-22`, `PKG-14`, `PKG-15`, `DOC-09` | [S-IP] §7 Phase M |
| N | 7 | `FIN-01`, `FIN-02`, `FIN-03`, `FIN-04`, `FIN-05`, `FIN-06`, `FIN-07` | [S-IP] §7 Phase N |

### 3.2 Future macOS正本9件

`SPI-04`, `SPI-06`, `PKG-03`, `PKG-06`, `PKG-08`, `PKG-12`, `PKG-18`, `PKG-20`, `PKG-21`。[S-IP] Future macOS backlog

共有taskに残るmacOS部分（`SPI-08`, `SPI-09`, `SPI-19`, `CORE-11`, `DAT-15`, `TRN-02`, `INF-01`, `INF-06`, `INF-14`, `PKG-22`, `DOC-*`, `DOCS-*`）もVersion 1の完了条件に含めない。履歴の`NOT_RUN`を削除せず、Windows PASSへ変換しない。[S-IP] Future macOS backlog、[S-RD] §3.2 / §4

正本に存在しない連番上の空きは新規taskとして補完しない。正本260件の追加・削除・改番が必要なら、先に要求・DAG変更として独立reviewする。[S-IP] §4.4 / §7、[E-COUNT]

### 3.3 DOCS残件

- Version 1: `DOCS-401`, `DOCS-403`, `DOCS-404`, `DOCS-405`, `DOCS-406`, `DOCS-407`, `DOCS-501`, `DOCS-502`, `DOCS-503`, `DOCS-504`, `DOCS-505`。[S-DOCPLAN] §8.5〜§8.6
- Future macOS: `DOCS-402`。旧D3依存から除外し、将来macOS要求・実機・署名が再設定された時だけ再開する。[S-RD] §3.2 / §4、[S-WIN] §3

## 4. 別環境への移送

### HND-01 — handoff manifestを作る

**入力:** 現worktreeと本書。**出力:** repository外の`handoff-manifest.json`、tracked patch、untracked list、SHA-256一覧。**状態:** TODO。[E-BASE]

1. `git rev-parse HEAD`, branch, remote、`git status --porcelain=v1 --untracked-files=all`を保存する。
2. tracked差分は`git diff --binary HEAD`で保存する。
3. untracked 19件と本書を明示列挙し、内容をarchiveへ格納する。
4. `node_modules/`, `ml/.venv/`, `build/spi10/dist/`, cache、credential、model binary、user image、Project dataを除外する。[S-CONTRIB] §9 / §11
5. patch、archive、正本、lock、SPI-10 final artifactのSHA-256をmanifestへ記録する。
6. 独立reviewで欠落file、秘密、絶対temp path、stale resultがないことを確認し、実在する指摘だけ修正してmanifestを再生成する。[S-CONTRIB] §2.2

### HND-02 — transportを固定する

**推奨:** task単位reviewが閉じた変更をcommitし、remote branchまたは`git bundle`で移送する。未完了taskを一つの完了commitへ混在させない。[S-CONTRIB] §1〜§3 / §10

commitできない現在差分は、HND-01のbase HEAD + binary patch + untracked archiveの三点で移送する。archiveだけ、patchだけ、`origin/main`だけでは現在状態を再現できない。[E-BASE]

### HND-03 — destination preflight

別環境は次を満たすまで実装を開始しない。[S-RD] §4、[S-CONTRIB] §6 / §8、[S-NODE][S-PY]

| 項目 | 必須値 / 条件 | 不一致時 |
|---|---|---|
| OS | Windows 11 24H2以降、x64 | `BLOCKED_UNSUPPORTED_OS` |
| PowerShell | `pwsh.exe`, PSEdition Core, major 7以上 | Windows PowerShellへfallbackせず停止 |
| Git baseline | HND-01のbase HEADと一致 | 正しいbundle/commitを再取得 |
| Node | `24.19.x` | package操作停止 |
| npm | exact `12.0.0` | system npmを使わず承認済み方法で導入 |
| npm feed | `.npmrc`の`https://packagefeedproxy.microsoft.io/npm/` | public fallbackを無断使用しない |
| uv | exact `0.12.9` | Python操作停止 |
| Python | Version 1 Windows x64 Python 3.14。`3.14.1`は除外 | `WIN-SCOPE-06`後のmanifestと一致させる |
| lock | `package-lock.json` SHA-256 `7f1bd82e...dfe1a5`。`ml/uv.lock`はscope06前 `d14d188a...c7e5fc` | 意図しないlock更新として停止 |
| requirement | raw / LF hashが本書冒頭と一致 | `WIN-SCOPE-07`前提を再調査 |

移送後、HND-01 manifest全hash、`git diff --check`、editor diagnosticsを確認する。test件数は今後増えるため固定値だけで判定せず、exit code、failure 0、無断skip 0、実行対象一覧を記録する。[S-CONTRIB] §2 / §5

## 5. 全task共通の完了・敵対的review手順

各taskは次の状態遷移だけを用いる。[S-CONTRIB] §2

`TODO → IN_PROGRESS → TESTED → ADVERSARIAL_REVIEW → FIXING（実在findingがある場合）→ REVALIDATED → VERIFIED`

`PARTIAL`, `BLOCKED`, `NOT_RUN`, `FUTURE`は`VERIFIED`へ自動変換しない。

1. **Source lock:** [S-RD]の対象FR/NFR、[S-IP]のtask行、該当ADR節、直接import、隣接testをtask recordへ引用する。
2. **Dependency gate:** 全依存taskの`VERIFIED`証拠と必要Gateの`PASS`証拠を確認する。file存在だけを完了証拠にしない。
3. **File ownership:** [S-IP]の出力fileだけを編集する。shared migration、contract、`ml/src/autovision_ml/cli.py`、model manifest、`electron-builder.yml`、`docs/users-guide.md`はownerを一人にして直列化する。
4. **Implementation:** 一つの観測可能な挙動だけを実装し、将来macOS、plugin、Cloud、汎用frameworkを先行実装しない。[S-IP] §1.3 / §10
5. **Target validation:** 正常、境界、失敗、敵対入力をtestする。Nodeはlock済みbinary、Pythonは`ml/`からlock済み環境を使う。
6. **Diagnostics:** 対象fileのeditor diagnostics、lint / type check、`git diff --check`を確認する。
7. **Independent adversarial review:** 実装者と別contextで、scope creep、境界、失敗経路、path / IPC / state、非対象機能、証拠の過大主張を調べる。
8. **Reproduction:** findingごとに一次sourceまたは実行で再現する。再現できないfindingは修正せず、理由と証拠を`不採用`として記録する。存在しない問題を追加しない。
9. **Fix and revalidate:** 再現したfindingだけ同task内で修正し、対象test、diagnostics、finding再現手順を最初から再実行する。
10. **Close:** command、version、OS、commit、exit code、test件数、artifact hash、review採否をtask recordへ保存してから依存taskを開始する。

### 5.1 Windows追加観点

filesystem taskはdrive letter、Unicode、long path、case-insensitive衝突、junction / symlink、traversal、read-only、同一volume / cross-volume renameを、対象要求の範囲でtestする。process taskはtimeout、cancel、異常exit、stdout破損、残process 0を確認する。これらを実行していない場合はPASSと書かない。[S-RD] FR-SEC / NFR-REL、[S-ADR1][S-ADR2]

### 5.2 並列実行規則

- 依存が全て閉じ、出力fileが重ならないtaskだけを別worktree / branchで並列化する。[S-IP] §4.4 / §5.1
- 同じfileへ複数agentを割り当てない。
- 各parallel taskは自身のreviewとrevalidationを閉じてからintegrationする。
- integration後に共有suiteを再実行し、個別PASSをaggregate PASSへ読み替えない。

## 6. Wave 0 — 現在の未完了差分を閉じる

| 実行単位 | 依存 | 実装 / 検証 | 並列性 | 出典 |
|---|---|---|---|---|
| `WIN-SCOPE-04A`〜`04E` | scope03完了 | `README`, `CONTRIBUTING`, users/developer/architectureの既存Windows化差分をfile別review。finding反映後に各file再検証 | 5 fileはreview並列可。修正はfile owner別 | [S-WIN] §2 / §10 |
| `WIN-SCOPE-06` | scope02完了 | `ml/pyproject.toml`のrequired environmentをWindows x64/Python 3.14へ限定し、`uv.lock`とC0記録を再監査。将来macOSartifactを現payloadにしない | 04 reviewと並列可 | [S-WIN] §2、[S-PY][S-C0] |
| `SPI-10`正式close | 最新artifact PASS | `spikes/annotation/result.md`をrun `2fde19d7-3e53-4f14-a145-a9fd24d9ece5`へ同期。600 raw samples、capture proof、source/build hash、8 command receipt、process cleanupを独立再計算しreview | 04 / 06と並列可。`build/spi10` ownerは単独 | [S-SPI10][S-IP] SPI-10 |
| `WIN-SCOPE-05` | scope04全file閉鎖 | 5 SVGのmacOS current表示をFutureへ変更し、Windows EP / packageと本文を一致。XML、ARIA、title/desc、外部resource禁止、200%表示を検証 | SVGごとに並列可。共通style変更は直列 | [S-WIN] scope05、[S-DOCPLAN] §7.1 |
| `WIN-SCOPE-07` | scope01〜06 | 新requirement hashをREADME、実装計画、fact baseline、verifier / testsへ反映。旧v0.3 hashは履歴として区別。`DOCS-402`と旧D2/D3をfuture化 | shared docsのため直列 | [S-WIN] scope07、[S-DOCREC] |
| `WIN-SCOPE-GATE` | scope04〜07、SPI-10 close | exact Node / Python suite、文書verifier、typecheck、3 build、lock不変、全review closureを確認 | 最終直列 | [S-WIN] scope gate、[S-CONTRIB] §8 |

`WIN-SCOPE-07`では[S-IP] §6のGate 1とSPI-18の複合記録を明確化する。Gate 1のWindows architecture判定とGate 2のmodel判定を別subsectionで記録し、SPI-18全体を両方完了前に`VERIFIED`としない。これによりmodel承認待ちをGate 1 PASSへ誤転用せず、Gate 2 BLOCKEDも隠さない。[S-IP] §6 / SPI-18

## 7. Wave 1 — Phase CとGate 1 / 2

| Task | 現在 | 実装・完了条件 | 外部入力 / 次依存 | 出典 |
|---|---|---|---|---|
| `SPI-03` | PARTIAL | Python未導入clean Windowsでonedirのimport、health、CPU、size、cold start、PE一覧を再実測。現host証拠をcleanと呼ばない | clean Windows → SPI-05 / LIC-03 | [S-IP] SPI-03、[S-SPI03] |
| `SPI-05` | NOT_RUN | SPI-03のworker directoryをNSIS EXEへ同梱し、offline起動。production configは作らない | SPI-03 VERIFIED | [S-IP] SPI-05、[S-ADR3] |
| `SPI-09` | NOT_RUN | Windows camera→queue depth 1→RGB pipe→dummy outputを30分測定し、drop / CPU / memory / latencyを保存 | Windows camera、SPI-07/08 | [S-IP] SPI-09、[S-SPI07][S-SPI08] |
| `SPI-11` | HOLD | classification base候補のexact checkpoint、code、C8 data terms、再配布、NOTICE、hash、intended use、承認をknownにする | 権限者とartifact | [S-IP] SPI-11、[S-MODEL] classification-base |
| `SPI-12` | HOLD | detection base候補を同じfail-closed基準で確定 | 権限者とartifact | [S-IP] SPI-12、[S-MODEL] detection-base |
| `SPI-13` | HOLD /一部REJECT | classification assist候補をexact artifact単位で判定。OpenAI CLIPの既存REJECTを無断変更しない | 権限者とartifact | [S-IP] SPI-13、[S-MODEL] classification-assist |
| `SPI-14` | HOLD | detection assist候補のcheckpoint/data/custom code/hash/qualityを確定 | 権限者とartifact | [S-IP] SPI-14、[S-MODEL] detection-assist |
| `SPI-15` | BLOCKED | 承認済みclassification modelと権利確認済みfixtureでtrain→ONNX→CPU parity | SPI-11、fixture | [S-IP] SPI-15 |
| `SPI-16` | BLOCKED | 承認済みdetection modelでbox / score / label / mAP parity | SPI-12、fixture | [S-IP] SPI-16 |
| `SPI-17` | BLOCKED | representative gold setでassist coverage / accept / edit / reject / timeをmanual-onlyと比較 | SPI-13/14、gold set | [S-IP] SPI-17、[S-RD] NFR-ANN-006 |
| `SPI-18` | WAIT_ALL | `docs/adr/0004-spike-decisions.md`でWindows Gate 1とGate 2を別判定。未承認modelはmanifestへ追加しない | active SPI完了 | [S-IP] SPI-18、[S-MANIFEST] |
| `SPI-19` | PARTIAL | manifest作成後にWindows実機をrebootし、新processでidentity / size / mtime / SHA-256、変更、消失、relink、非破壊を再検証 | reboot可能なWindows | [S-IP] SPI-19、[S-SPI19] |

並列開始可能: `SPI-03`, `SPI-09`, `SPI-11`〜`SPI-14`, `SPI-19`。`SPI-05`は03後、`SPI-15/16/17`はmodel/fixture後、`SPI-18`は最後に直列実行する。[S-IP] Phase C依存

## 8. Wave 2 — Phase D / E

Gate 1 PASS後に開始する。task名、正確な出力file、個別完了条件は[S-IP] §7該当行を正本とする。

### 8.1 Phase D

| 順序 | Task | 実装の焦点 | 並列 | 出典 |
|---|---|---|---|---|
| D1 | `CORE-01` | Windows user-data / project / cache / logs pathだけを定義 | `CORE-11`と可 | [S-IP] CORE-01、[S-RD] FR-SEC-001〜003 |
| D2 | `CORE-02` → `CORE-03` → `CORE-04` → `CORE-05` → `CORE-06` | SQLite lifecycle、migration rollback、core schema、Project contract / service | 直列。migration単独owner | [S-IP] CORE-02〜06、[S-ADR1] §2.7 |
| D3 | `CORE-07` | sender / payload validation付きProject IPC | CORE-10と開始条件を確認 | [S-IP] CORE-07 |
| D4 | `CORE-08`, `CORE-09`, `CORE-10` | list、form、delete preview | 08/09は並列。10はCORE-06後 | [S-IP] CORE-08〜10 |
| D5 | `CORE-11` → `CORE-12` → `CORE-14` | Windows hardware probe、diagnostics UI、取得可能なpower / thermalだけ表示 | DB chainと並列 | [S-IP] CORE-11/12/14、[S-SPI08] |
| D6 | `CORE-13` | Project CRUD / restart / isolation E2E | 08〜10後 | [S-IP] CORE-13 |
| D7 | `DOC-01` | 実測済みProject / diagnosticsだけuser guideへ反映 | CORE-12〜14後 | [S-IP] DOC-01 |

### 8.2 Phase E

`JOB-03`はSPI-02後にcontractを固定でき、`JOB-01`はCORE-03後に開始できる。出力が重ならないため並列化できる。[S-IP] JOB-01 / JOB-03

1. `JOB-01` → `JOB-02`。
2. 並列で`JOB-03`。
3. 合流して`JOB-04` → `JOB-05`。
4. `JOB-06`, `JOB-07`, `JOB-08`を並列実行。

不正state遷移、破損NDJSON、wrong schemaVersion、cancel / timeout、artifact path越境、異常exit、残processを敵対testする。[S-IP] JOB-01〜08、[S-ADR1] §2.5

## 9. Wave 3 — Phase F Data Import

| lane | Task順 | 合流条件 | 出典 |
|---|---|---|---|
| Scan共通 | `DAT-01` → `DAT-02` | JOB-03 / CORE-11 | [S-IP] DAT-01〜02 |
| Decode / format | `DAT-03`, `DAT-04`, `DAT-05` | DAT-02後に3件並列 | [S-IP] DAT-03〜05 |
| Main storage | `DAT-06`, `DAT-11`, `DAT-12`, `DAT-13` | 各依存後にfile owner別並列 | [S-IP] DAT-06 / 11〜13、[S-ADR2] |
| Persistence | `DAT-07` | DAT-01 / CORE-03 | [S-IP] DAT-07 |
| Orchestration / UI | `DAT-08` → `DAT-09` | 04〜07 / 11〜13 / JOB-04 | [S-IP] DAT-08〜09 |
| Boundary / E2E | `DAT-14`, `DAT-15`, `DAT-10` | 14は06/12後、15は08/SPI-19後、10は09後 | [S-IP] DAT-10 / 14 / 15 |
| Guide | `DOC-02` | DOC-01 / DAT-10 / DAT-15 | [S-IP] DOC-02 |

magic / extension不一致、broken / animated / oversized image、CSV encoding、COCO category / bbox、duplicate hash、容量不足、権利未確認、junction / symlink / traversal、Reference変更・消失・relinkを要求範囲で検証する。[S-RD] FR-DAT / FR-SEC、[S-IP] §9

## 10. Wave 4 — Phase G Annotation / Gate 3

1. `ANN-01` → `ANN-02`。
2. `ANN-03`と`ANN-05`を並列、続いて`ANN-04`と`ANN-06`をfile競合なしで実行。
3. UI lane `ANN-07` → `ANN-08` → `ANN-09` → `ANN-10` / `ANN-23`、canvas lane `ANN-11` → `ANN-12` → `ANN-13` → `ANN-14` / `ANN-24` / `ANN-25`を並列化する。
4. 合流して`ANN-15` → `ANN-16` / `ANN-17` → `ANN-18` → `ANN-19` → `ANN-20`。
5. `ANN-21`、`ANN-26`を依存に従って実装し、`ANN-22`でimmutable Revision commit後にQueued Runへhandoffする。
6. `ANN-27`と`ANN-28`を並列E2Eし、`DOC-03`を実画面だけで更新する。[S-IP] Phase G

Gate 3ではWindowsでProject→Import→Annotation→Dataset Revision→Queued Runを再現し、未確認item / suggestion 0、不変Revision、Reference非破壊、分類exactly-one、検出invalid box拒否を確認する。[S-IP] §6 Gate 3、[S-RD] FR-ANN / NFR-ANN

## 11. Wave 5 — Phase H / I / I.1

Gate 2がBLOCKEDの間、approved modelを必要とするtaskを実装しない。schema / contractだけ先行する場合も、未承認model名、adapter、download path、thresholdを追加しない。[S-IP] Phase H / I、[S-MODEL]

### 11.1 Phase H

- 基盤: `AST-02` → `AST-03`; `AST-04`はJOB-03 / DAT-01後。
- approved loader: `AST-01`はSPI-18後。
- model lane: `AST-05`, `AST-06`, `AST-07`はGate 2とAST-01/04後に並列。
- orchestration / UI: `AST-09` → `AST-10`; presentation: `AST-11` → `AST-12` → `AST-13`。
- safety / reproducibility: `AST-14`, `AST-15`, `AST-16`, `AST-18`, `AST-19`, `AST-20`, `AST-21`を各依存とfile ownerに従う。
- E2E: `AST-22`、guide: `DOC-04`。
- `AST-08`はTRN-21後まで開始しない。[S-IP] Phase H注記

### 11.2 Phase I

| group | Task | 並列性 | 出典 |
|---|---|---|---|
| common input | `TRN-01`, `TRN-02`, `TRN-09` | 各依存後に並列。09はSPI-15〜18 / D-15待ち | [S-IP] TRN-01/02/09 |
| classification | `TRN-03` → (`TRN-04`, `TRN-05`) → (`TRN-10`, `TRN-16`, `TRN-25`) → `TRN-18` | detection laneと並列 | [S-IP] classification TRN rows |
| detection | `TRN-06` → (`TRN-07`, `TRN-08`) → (`TRN-11`, `TRN-17`, `TRN-26`) → `TRN-19` | classification laneと並列 | [S-IP] detection TRN rows |
| common execution | `TRN-12`, `TRN-13`, `TRN-27`, `TRN-28` → `TRN-14` → `TRN-15` | `ml/.../cli.py` ownerはCORE-11→DAT-01→AST-04→TRN-14の順 | [S-IP] Phase I注記 |
| model lifecycle | `TRN-20` → `TRN-21` → `TRN-22`; `TRN-30` → `TRN-31`; `TRN-29` | dependency順 | [S-IP] TRN-20〜22 / 29〜31 |
| E2E | `TRN-32`, `TRN-33` | classification / detectionを並列 | [S-IP] TRN-32/33 |
| guide | `DOC-05` | TRN-31〜33後 | [S-IP] DOC-05 |

### 11.3 Phase I.1

TRN-21後に`AST-08`を閉じ、`AST-23` → `AST-24` → `DOC-10`を実行する。最新成功版の既定選択は許可するが、確認済みGround Truthを上書きせず、task / schema / version / hashを完全一致させる。[S-IP] Phase I.1、[S-RD] FR-AST-016

## 12. Wave 6 — Phase J Reports

`REP-11`でchart dependencyを一次資料、license、bundle size、keyboard / screen readerで判定し、native SVGで足りる場合はdependencyを追加しない。[S-IP] REP-11

1. `REP-01`, `REP-02`, `REP-03`, `REP-11`を各依存後に並列。
2. `REP-03/11`後に`REP-04`, `REP-05`; `REP-03`後に`REP-06`, `REP-07`, `REP-09`; AST-16後に`REP-08`。
3. 合流して`REP-10`、次に`DOC-06`。[S-IP] Phase J

表示値は保存済み実値だけを使い、scoreを正解確率と呼ばず、test splitをmodel選定へ使わない。Reference切れでもreport metadataを開ける境界を検証する。[S-RD] FR-REP、[S-ADR2]

## 13. Wave 7 — Phase K Windows Camera

1. `INF-01` → `INF-02`。`INF-16`はCORE-03 / TRN-21後。
2. 合流して`INF-17` → `INF-03` → `INF-04`。
3. `INF-05`と`INF-19`を依存順に実装し、`INF-06` → `INF-07`。
4. `INF-08`, `INF-09`, `INF-10`を並列、合流して`INF-11` → `INF-12`。
5. `INF-18`はINF-17 / JOB-05後に並列。
6. `INF-13` fake camera E2E後、実packageで`INF-14` Windows permission、実推奨hardwareで`INF-15` 30分試験。
7. `DOC-07`は実測済みWindows手順だけを記載。[S-IP] Phase K

cameraがない、署名packageがない、30分試験を完走していない場合、該当taskをBLOCKEDのままにする。起動時permission、audio、frame / resultの既定保存、偽の10 FPS表示を禁止する。[S-RD] FR-INF、[S-IP] INF rows

## 14. Wave 8 — Gate 4 / Phase L

Gate 4はWindowsでclassification / detectionのassist、train→ONNX parity→Model Version→report→cameraをE2E再現して判定する。[S-IP] §6 Gate 4

Gate 4後、次を依存ごとに並列化する。[S-IP] Phase L

| lane | Task | 焦点 | 出典 |
|---|---|---|---|
| Security | `SEC-01`〜`SEC-08` | CSP / navigation、IPC全channel、path / image / model、offline、redaction、vulnerability | [S-RD] FR-SEC / NFR-SEC |
| Reliability | `REL-01`〜`REL-04` | atomic write、backup / rollback、crash recovery、owned deletion / Reference保持 | [S-RD] NFR-REL、[S-ADR2] |
| License | `LIC-01`〜`LIC-03` | SBOM / notices、in-app表示、CUDA/cuDNN採否と再配布 | [S-RD] FR-LIC、[S-MODEL] |
| Storage | `STO-01`〜`STO-03` | 実容量、再生成可能dataだけ削除、UI preview | [S-RD] NFR-STO |
| UX | `ACC-01`, `UX-01` | keyboard、focus、label、200%、日本語、色以外の意味 | [S-RD] NFR-UX |
| Performance | `PERF-01`, `PERF-02`, `PERF-03` | annotation、contention、metadata/UI p95を実機保存 | [S-RD] NFR-PERF / NFR-ANN-002 |
| Guide | `DOC-08` | 再現済みtroubleshooting / security / storageだけ記載 | [S-IP] DOC-08 |

SEC-02の「全IPC」は全IPC実装後、ACC-01 / UX-01の「全主要UI」は主要UI実装後にだけ完了判定する。部分scanを全件PASSとしない。[S-IP] SEC-02 / ACC-01 / UX-01

## 15. Wave 9 — Phase M Windows installer

Future macOS taskを共有configへ先行混入しない。[S-IP] Phase M / Future macOS backlog、[S-ADR3]

1. Gate 2後`PKG-01`。Gate 4 / SPI-03 / LIC-03後`PKG-02`。
2. `PKG-04` → `PKG-05`でcommon / Windows `electron-builder.yml`を直列固定。
3. `REL-02`後`PKG-09A` → `PKG-09B`。
4. `PKG-16` → `PKG-17`; `PKG-09B/17`後`PKG-19`。
5. `PKG-05`後`PKG-10`。
6. 正式D-16証明書、09B / 10 / 19後`PKG-07`。
7. `PKG-07/19`後、Python / Node / CUDA未導入のclean Windows標準userで`PKG-11`。
8. `PKG-09B/10/11`後`PKG-13`; `PKG-19`後`PKG-22`。
9. 合流して`PKG-14` → `PKG-15` → `DOC-09`。[S-IP] Phase M

秘密鍵、certificate password、timestamp credentialをrepository、log、review promptへ渡さない。署名操作がsecret入力待ちなら利用者がterminalへ直接入力する。[S-CONTRIB] §9

## 16. Wave 10 — DOCS実測化と最終review

| Task | 現在状態 | 依存 / 実施内容 | 出典 |
|---|---|---|---|
| `DOCS-403` | BLOCKED_DEP | CORE-12〜14、DAT-09/10/15後。診断、Project、Copy / ReferenceをWindows実画面で記載 | [S-DOCPLAN] DOCS-403、本書Windows scope |
| `DOCS-404` | BLOCKED_DEP | ANN-27、AST-22、TRN-32、REP-10、INF-13〜15後。classification E2Eを実測 | [S-DOCPLAN] DOCS-404 |
| `DOCS-405` | BLOCKED_DEP | ANN-28、AST-22、TRN-33、REP-10、INF-13〜15後。detection E2Eを実測 | [S-DOCPLAN] DOCS-405 |
| `DOCS-406` | BLOCKED_DEP | SEC / REL / STO / PKG failure evidence後。実際に再現した対処だけ記載 | [S-DOCPLAN] DOCS-406 |
| `DOCS-407` | BLOCKED_DEP | Gate 4後、planned componentを実在sourceへ置換 | [S-DOCPLAN] DOCS-407 |
| `DOCS-401` | BLOCKED_DEP | PKG-11 / 13 / 15 / 22後。Windows install / repair / upgrade / rollback / uninstallを実測 | [S-DOCPLAN] DOCS-401、本書Windows scope |
| `DOCS-501` | BLOCKED_DEP | Windows一般利用者review。旧DOCS-402依存を除外 | [S-DOCPLAN] DOCS-501、[S-RD] §3.2 |
| `DOCS-502` | BLOCKED_DEP | 新規developerがrequirement→task→code→test→docsを追跡 | [S-DOCPLAN] DOCS-502 |
| `DOCS-503` | BLOCKED_DEP | security / privacy / license / model / input rights review | [S-DOCPLAN] DOCS-503 |
| `DOCS-504` | BLOCKED_DEP | Windowsでkeyboard、200%、high contrast、screen reader、SVG / print review | [S-DOCPLAN] DOCS-504、本書Windows scope |
| `DOCS-505` | BLOCKED_DEP | Windows Documentation Gate。未達があれば完成扱いにしない | [S-DOCPLAN] DOCS-505、本書Windows scope |
| `DOCS-402` | **FUTURE — macOS** | Version 1では実行しない | [S-RD] §3.2 / §4、[S-WIN] §3 |

## 17. Wave 11 — Phase N / Gate 5

1. `FIN-01`: 229 requirementをtask / test / statusへ対応。根拠なしの対応済みを禁止。
2. `FIN-02`: Windows CPU / accelerator、manual / automated matrix。macOSはFuture /履歴NOT_RUNとして分離。
3. `FIN-03`: POC-01〜17相当の実測、hardware、failure、waiver。
4. `FIN-04`: `DOC-01`〜`DOC-10`後、実UIとusers guideを照合。
5. `FIN-05`: FIN-03/04後、READMEの状態・Windows OS・license caveatを最終化。
6. `FIN-06`: product version、tag、artifact、署名、SBOM、vulnerability、model / CUDA、offline、rollback。
7. `FIN-07`: FIN-01〜06後、全必須PASSまたはrelease停止を明記。[S-IP] Phase N

Gate 5はWindows署名済みEXE、offline clean install、servicing、受入、SBOM、users guideで判定し、Future macOSを要求しない。[S-IP] §6 Gate 5

## 18. 外部blocker台帳

| Blocker | 現在確認できる事実 | 影響task | 解除証拠 | 出典 |
|---|---|---|---|---|
| clean Windows | SPI-03 Sandbox試行はresultを生成せず、clean条件NOT_RUN | SPI-03→05、PKG-11/13 | Python / Node / CUDA未導入clean Windowsの構造化result | [S-SPI03] |
| Windows reboot | 別process lifecycleはPASS、OS rebootはNOT_RUN | SPI-19→DAT-12/15 | reboot前manifestとreboot後new process verify | [S-SPI19] |
| Windows camera | 利用可能性を本sessionで確認していない | SPI-09、INF-14/15 | camera identity、30分result、permission state | [S-IP] SPI-09 / INF-14/15 |
| approved models | manifestはapproved model 0、4 auditはHOLD/BLOCKED | SPI-11〜18、AST、TRN、PKG-01 | exact artifact、hash、terms、NOTICE、quality、権限者承認 | [S-MANIFEST][S-MODEL] |
| training / gold fixtures | 権利確認済みfixture / gold setは未提示 | SPI-15〜17、E2E | rights record、immutable fixture hash、測定protocol | [S-RD] §2.2 / NFR-ANN-006 |
| Windows certificate | 正式Authenticode identity / secretは未提示 | PKG-07以降 | CA chain、timestamp、署名検証result | [S-IP] D-16 / PKG-07 |
| `hve` source | **BLOCKED_EXTERNAL_INPUT**。現環境の`C:\GitHub\_hve-wt\port-main`はCHANGELOGだけでGit repo / version manifestなし | FINAL-HVE-PATCH | 実repository root、baseline commit、clean status、version正本、test手順 | [E-EXT] |

blockerをmock、placeholder、未監査model、ad-hoc署名、developer machineでのclean扱いにより迂回しない。[S-RD] §2.2、[S-IP] §1.3 / §10

## 19. 最終処理

### 19.1 FINAL-CHANGELOG

**開始条件:** Version 1正本218件、Windows向けDOCS 11件、WIN-SCOPE-GATE、FIN-07、DOCS-505が全て閉じていること。Future macOS 10件は対象外であることを明記する。BLOCKED中は実行しない。[S-RD] Windows scope、[S-KAC]

repository rootに`CHANGELOG.md`が存在しないため、条件成立時に新規作成する。[E-BASE]

- 冒頭に人向けchangelogであること、Keep a Changelog 1.1.0、Semantic Versioning 2.0.0を記載する。[S-KAC][S-SEMVER]
- 最新の`## [Unreleased]`を先頭に置き、今回の変更全体を一段落で要約する。
- 実在する変更だけを`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`へ分類し、空categoryは作らない。[S-KAC]
- commit logの羅列にせず、利用者へ意味のある変更を書く。未実装、Future macOS、失敗した候補、未承認modelを提供済みと書かない。[S-KAC][S-RD]
- task / requirement / evidenceへ追跡できる表現にし、最終diffとFIN-01を照合する。
- 独立敵対的review後、false availability、抜けたbreaking change、重複、内部実装だけのnoiseを修正し再検証する。

### 19.2 FINAL-PACKAGE-IMPACT

実行開始時に対象外部repositoryごとのbaseline HEADとdirty statusを保存し、最終時にそのbaselineとの差分を調べる。AutoVision Studioの変更だけを理由に別packageを版上げしない。[S-SEMVER][E-EXT]

| package | 現環境の確認値 | PATCH条件 | 更新対象 / 検証 | 出典 |
|---|---|---|---|---|
| hve | source / version正本不在 | 実repositoryが提供され、この計画実行でpackage fileが実際に変更された場合だけ | version正本を一次資料から特定後にPATCH。現時点で新旧版を推測しない | [E-EXT] |
| Markdown Query Skill | kit version `1.2.0`; GUI project `0.2.0`。baseline hash: KIT `c36ea01e9814086031c0a0571dd999ab6af0a622258ebc509b0511b6eac6e210`, GUI manifest `df2afe2a96294ee8ca0dedaeb3878a61a1c59a7278696376d95565b2b610fa03` | `markdown-query/` shipped files変更時はkit `1.2.1`。GUI package変更時だけGUI `0.2.1`も対象 | `KIT-VERSION.json` version/local_patchesを更新し、`refresh-kit-manifest.py`でhash再生成、`--check`とinstall `--verify` | [S-SKILLS] README §9、`markdown-query/KIT-VERSION.json`, `pyproject.toml`、[E-EXT] |
| Code Query Skill | kit version `1.2.0`; GUI project `0.2.0`。baseline hash: KIT `f811557ead2cf6a9eadf185503659c796501889136e17ccfc31b3956d76b7c36`, GUI manifest `4f3db90b0bfc55b8b14ffaf22e48eb42039b2135bc7ab934e1d22e1492e6f6aa` | `code-query/` shipped files変更時はkit `1.2.1`。GUI package変更時だけGUI `0.2.1`も対象 | 同上。skill mirror変更時は`sync-plugin-assets.py`も実行 | [S-SKILLS] README §9、`code-query/KIT-VERSION.json`, `pyproject.toml`、[E-EXT] |

PATCHは後方互換bug fixの場合の増分である。[S-SEMVER] §6。実際の変更が互換機能追加または破壊変更なら、ユーザーのPATCH指示との矛盾を隠さず停止して判断を求める。版だけ更新して内容を変更しないこと、manifest hashを手修正すること、GUI版とkit版を混同することは禁止する。[S-SKILLS]

### 19.3 最終package review

各適用packageでdiff、version正本、複製version、manifest hash、generated mirror、package固有test、clean statusを独立reviewする。findingを再現し、実在するものだけ修正して全検証を再実行する。未変更packageは`NOT_APPLICABLE`と記録し、PATCHしない。[S-CONTRIB] §2.2、[S-SKILLS]

## 20. Gateごとのaggregate検証

| Gate | 必須検証 | 判定境界 | 出典 |
|---|---|---|---|
| WIN-SCOPE | requirement ID 229、task ID 260、future 9、hash、Node/Python/docs/type/build、review closure | rebaselineだけのGate | [S-WIN] |
| Gate 1 | SPI Windows architecture evidence | model Gate 2やFuture macOSを混ぜない | [S-IP] §6 |
| Gate 2 | 4 model role、hash、license/data/NOTICE、quality、budget | approved 0ならBLOCKED | [S-IP] §6、[S-MODEL] |
| Gate 3 | Windows Project→Import→Annotation→Revision→Queue | UI file存在だけでは不可 | [S-IP] §6 |
| Gate 4 | Windows classification / detectionのassist/train/report/camera E2E | fake cameraだけを30分実機へ代用しない | [S-IP] §6 |
| Gate 5 | signed EXE、clean offline、servicing、SBOM、docs、acceptance | ad-hoc/unsignedは不可 | [S-IP] §6、[S-ADR3] |
| Documentation | verifier、link、status、Windows実測手順、reader/security/accessibility review | `DOCS-402`はfuture | [S-DOCPLAN]、[S-RD] |

Node gateはexact npm 12.0.0をPATH先頭にし、nested `npm run`も同じCLIを使う。repository rootで`npm test`, `npm run typecheck`, `npm run build`。Python gateは`ml/`からexact uv 0.12.9 / Windows Python 3.14でlock check、sync、pytest、Ruff check / format、root lock済みPyrightを使う。[S-CONTRIB] §8、[S-NODE][S-PY]

## 21. Handoff時の固定情報

### 21.1 本書作成前のhash

| Path | SHA-256 | 出典 |
|---|---|---|
| `docs/requirement-definition.md` raw | `38e79907b8b5620fffd50dd73a79322d1d97e606b90e81b0b9b06140958e5ce5` | [E-HASH] |
| 同 LF-normalized | `8c8dcdffc6049b6fc0503079ffb1edf3c2464d9e24150155530b82fa5df44f6b` | [E-HASH] |
| `docs/implementation-plan.md` raw | `fbcdc7fcd64e216c527ba3e8b10851d563dac928be731811b60689eee364fb6d` | [E-HASH] |
| `package.json` | `9eb7a83ad0d4e7e018a4115abfa7af97f1ad8b476f9857d4ad3b073a5e0d18bc` | [E-HASH] |
| `package-lock.json` | `7f1bd82efe1e4919dce6ddffdb763ceff4404d29b60e8e946a150345a8dfe1a5` | [E-HASH] |
| `ml/pyproject.toml` | `4631204ba6c1f632f92c5273462c92ec1caf15ba15491fd0c03382aaf288f6fe` | [E-HASH] |
| `ml/uv.lock` | `d14d188a0d1f92f34a9436ecc0b2c801bb0375b36619199f846924c112c7e5fc` | [E-HASH] |
| `build/spi10/benchmark-result.json` | `e8376a1e09621dda1748fff996b27f59774d2d26c33c8140105f9e2554226338` | [E-HASH] |

scope06 / 07またはSPI-10説明同期で意図的に変わるhashは、task recordにbefore / after / reasonを記録する。古いhashを現在値として残さない。[S-CONTRIB] §5

### 21.2 本書作成前のdirty paths

Tracked modified 16件: `CONTRIBUTING.md`, `README.md`, `build/spi10/benchmark-result.json`, `build/spi10/main.mjs`, ADR-0001〜0003, `docs/implementation-plan.md`, `docs/requirement-definition.md`, `docs/users-guide.md`, `package.json`, `spikes/annotation/CanvasSpike.tsx`, `spikes/inference/provider-result.md`, `src/renderer/layout/AppShell.test.tsx`, `AppShell.tsx`, `tsconfig.renderer.json`。[E-BASE]

Untracked 19件: `docs/architecture.md`, `docs/developer-guide.md`, 5 SVG, 2 docs verifier files, 2 version verifier files, 2 product-version renderer files, 6 work records / plans。[E-BASE]

本書自身はこの一覧の採取後に追加されたため、HND-01ではuntrackedに含める。

## 22. 実行開始順

1. HND-01〜03で現在差分を別環境へ再現する。
2. `WIN-SCOPE-04A〜E`, `WIN-SCOPE-06`, `SPI-10 close`を安全なfile owner単位で並列実行する。
3. scope04後にscope05、合流してscope07、最後にWIN-SCOPE-GATE。
4. Phase CのWindows / model lanesを並列実行し、Gate 1 / 2を独立判定する。
5. [S-IP]の依存に従いPhase D〜Nとfeature `DOC-*`を実行する。
6. 実装・実測後にWindows向け`DOCS-401`, `403`〜`407`, `501`〜`505`を閉じる。
7. FIN-07 / DOCS-505後だけ`FINAL-CHANGELOG`と`FINAL-PACKAGE-IMPACT`を実行する。
8. Future macOS 10件はVersion 1完了後の別要求・別計画で再開する。

**開始可能な最初の単位:** `HND-01`。同じworktreeを継続する場合も、未コミット35件をtask別に識別するmanifestを作成してから実装へ進む。[E-BASE][S-CONTRIB]

## 23. 本計画の敵対的レビュー記録

- 機械照合は[S-IP] §7の260 IDから完了33件とFuture 9件を集合差し引きし、§3.1が218件、missing 0、extra 0、duplicate 0であることを確認した。[E-COUNT]
- 「v0.4が存在せずv0.3がcurrent」という指摘は不採用とした。現在の`docs/requirement-definition.md`先頭はv0.4 Draftで、raw / LF hashを本sessionで再計算して§1と一致した。[S-RD][E-HASH]
- 「VER-GATE-01が循環し完了していない」という指摘は不採用とした。`work/20260904-ProductVersionExecutionRecord.md`にVER-00〜04のreview closure、aggregate 64 tests、typecheck、3 build、lock不変、独立Gate reviewのPASSが記録されている。[S-V0]
- Future 9件の確認にmodel manifestが必要という指摘は不採用とした。Future集合の正本は[S-IP]のtask表 / Future macOS backlogであり、model承認状態とは独立である。[S-IP][S-MANIFEST]
- DOCS 11件を`active`と呼ぶと即時実行可能に読める指摘を採用し、§16に`BLOCKED_DEP`列を追加した。
- hve source不足を明示的blockerにし、§18を`BLOCKED_EXTERNAL_INPUT`へ強化した。現存するCHANGELOGのhashだけではpackage版を決定しない。[E-EXT]
- Markdown Query / Code Queryはcurrent repository / HEAD / version fileの実在を再確認し、§19.2へversion file hashを追加した。実行時にはHND相当のbaselineを再取得し、値が違えば新しいcurrent値からPATCHを計算する。[S-SKILLS][E-EXT]
- dirty件数と正本hashは本sessionで実測済みだが、実行開始時に変化し得るためHND-01 / HND-03で再取得する規則を維持した。[E-BASE][E-HASH]

**レビュー判定:** 再現した指摘を反映済み。修正後に全ID集合、必須章、diagnostics、`git diff --check`を再検証してから本計画をhandoff可能とする。
