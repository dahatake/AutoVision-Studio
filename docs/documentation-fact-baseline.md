# DOCS-001 ドキュメント事実ベースライン

| 項目 | 値 |
|---|---|
| Task | DOCS-001 |
| 基準日 | 2026-09-21 |
| Repository | `dahatake/AutoVision-Studio` |
| Branch | `main` |
| HEAD | `25dc1b7dc06d690d570197f0fb2501318c959899` |
| 要求基準 | `docs/requirement-definition.md` v0.5 Draft |
| 要求定義 raw Windows 作業ツリー SHA-256 | `cd060e8740e986271ca32cf1e22f0cad275e7c26f9ead573c9fb667f26f984fa` |
| 要求定義 LF-normalized SHA-256 | `962f5d7209de1f607ee6cb4d31e68b084409f7b3105612e6e4042d8b893e037f` |
| 実測 PowerShell | 7.6.5 Core |
| 実測 Node.js | 24.19.0 |
| 実測 system npm | 11.17.0（製品要件外。bootstrap にのみ使用し、製品検証には使用しない） |
| 実測 uv | 0.12.9 |
| 検証用 npm | 12.0.0 — 承認済み Microsoft proxy metadata が示す `ms-feed-25.pkgs.visualstudio.com` artifact を metadata SHA-1 と照合して一時展開 |
| 現在の再検証 | **PASS** — W0-04 の文書検証・型検査・editor diagnostics・独立レビューが合格。未実行の aggregate test / build / Python 検証は PASS と扱わない |

> 本書は 2026-09-21 時点の文書化用事実を固定する。source や test が存在することと、このセッションで test が合格したことを区別する。実行していない検証を PASS と記録しない。

## 1. 証拠の扱い

| 証拠区分 | 本書での扱い |
|---|---|
| 現行 source / test | ファイルの存在と実装内容を確認できる。現セッションで未実行なら最新 PASS とは扱わない |
| 保存済み result 文書 | 記録された OS、版、hash、非対象、判定の範囲内だけ引用する |
| 要求定義 / ADR | 設計または受入条件の根拠。実装済み証拠にはしない |
| `docs/implementation-plan.md` | task、依存、Gate の正本。成果物の存在だけで task 完了とは扱わない |
| 調査報告 | 一次ファイルと一致する部分だけ採用し、推測や未保存の PASS は採用しない |

## 2. 現行実装と文書化可能な主張

| 主張 | 掲載先 | 根拠 path・節 | Evidence | 機能状態 | 文書成熟度 | 再確認条件 |
|---|---|---|---|---|---|---|
| Electron Main は single-instance lock、ready 後の window 作成、second-instance focus、OS 別の全 window close を処理する | `docs/architecture.md`, `docs/developer-guide.md` | `src/main/app-lifecycle.ts`, ADR-0001 §2.2 | source と対象 test が存在する。W0-04 では対象 test を未実行 | **実装済み** | **要求反映済み** | lifecycle 変更時に対象 test と aggregate test を再実行 |
| BrowserWindow は context isolation、sandbox、Node integration 無効、navigation / new window deny を設定する | `README.md`, `docs/architecture.md` | `src/main/security.ts`, `src/main/window.ts`, ADR-0001 §2.3 | source と対象 test が存在する。W0-04 では対象 test を未実行 | **実装済み** | **要求反映済み** | security / window 変更時に対象 test を再実行 |
| Preload は `autoVision` に contract version と `projects` / `labelSchemas` / `annotations` / `diagnostics` / `jobs` / `imports` の6 APIを公開し、raw IPC / Node capability を公開しない | `docs/architecture.md`, `docs/developer-guide.md` | `src/preload/index.ts`, `src/shared/contracts/app.ts`, ADR-0001 §2.2〜2.4 | `src/preload/index.ts` と6 API factory、対象 test が存在する。W0-04 では対象 test を未実行 | **実装済み** | **要求反映済み** | Preload contract または公開 API 変更時に対象 test を再実行 |
| Renderer の UI-01 / 02 / 03 / 04 / 09 は実 component に接続され、診断、Project 一覧・作成・設定、データ取り込み、Label Schema を提供する | `README.md`, `docs/architecture.md` | `src/renderer/layout/AppShell.tsx`, `src/renderer/layout/ProjectWorkspace.tsx`, `src/renderer/features/` | 各 component と対象 test が存在する。W0-04 では対象 test を未実行 | **実装済み** | **要求反映済み** | 各 feature 変更時に対象 test と実アプリ受入を再実行 |
| Renderer の UI-05 / 06 / 07 / 08 / 10 / 11 は到達可能な placeholder または限定情報表示であり、学習・レポート・カメラ推論・ストレージ管理・注釈編集・補助ジョブを提供しない | `README.md`, `docs/architecture.md`, `docs/users-guide.md` | `src/renderer/layout/ProjectWorkspace.tsx`, `src/renderer/features/settings/SettingsPage.tsx`, `src/renderer/routes.tsx` | `EmptyRoute` は export されているが production では描画されない。UI-08 は製品版と同梱 icon の LICENSE / NOTICE だけを表示する | **設計確定・未実装** | **要求反映済み** | 対応する ANN / AST / TRN / REP / INF / PKG task 完了時 |
| Renderer header の製品版は root `package.json` から取得する | `README.md`, `docs/developer-guide.md` | `src/renderer/product-version.ts`, `src/renderer/layout/AppShell.tsx`, `tsconfig.renderer.json` | source と対象 test が存在する。W0-04 では対象 test を未実行 | **実装済み** | **要求反映済み** | version 表示変更時に対象 test、typecheck、build を再実行 |
| root product version の形式と package lock / model manifest の整合を検査する | `docs/developer-guide.md` | `scripts/release/verify-product-version.mjs`, `package.json`, CONTRIBUTING §8.1 | verifier と正常・異常系 test が存在する。W0-04 では未実行 | **実装済み** | **要求反映済み** | release metadata 変更時に version verifier と対象 test を再実行 |
| Python worker CLI は `health` / `probe-hardware` / `scan-dataset` の3 command を提供し、Main は診断と取り込みで短命 worker を起動する | `docs/architecture.md`, `docs/developer-guide.md` | `ml/src/autovision_ml/cli.py`, `src/main/diagnostics/diagnostics-service.ts`, `src/main/data/import-service.ts` | source と対象 test が存在する。W0-04 では Python / worker test を未実行 | **実装済み** | **要求反映済み** | CLI、worker protocol、lock file 変更時に対象 test / lint / type check を再実行 |
| Node / Electron / Python の build 設定と lock file は存在する | `docs/developer-guide.md` | `package.json`, `package-lock.json`, `ml/pyproject.toml`, `ml/uv.lock`, Vite / TypeScript config | 現行ファイルを確認。W0-04 では build と lock 検証を未実行 | **実装済み** | **要求反映済み** | exact toolchain で lock check、test、typecheck、build |

## 3. 保存済み PoC 証拠

| 主張 | 掲載先 | 根拠 path・節 | Evidence | 機能状態 | 文書成熟度 | 再確認条件 |
|---|---|---|---|---|---|---|
| SPI-10 は記録された Windows 環境で 4K image / 100 rectangles の create / select / move / resize / zoom / pan の判定対象 capture p95 が 100 ms 以内 | `docs/architecture.md` | `spikes/annotation/result.md`, NFR-ANN-002 | result は Windows `10.0.29648`、Electron 44.0.0、6操作各100 sample、PASS を記録。production editor と macOS は非対象 | **検証待ち** | **実測済み** | source / raw evidence hash 変更時、production editor 実装時、macOS 性能確認時 |
| SPI-08 は保存済み Windows x64 実測で CPUExecutionProvider と DmlExecutionProvider の kernel attribution と exact output を確認 | `docs/architecture.md` | `spikes/inference/provider-result.md`, ADR-0001 §2.5 | Windows CPU / DirectML は PASS、macOS CPU / CoreML は NOT_RUN。SPI-08 全体は PARTIAL | **検証待ち** | **実測済み** | native Apple Silicon Mac で CPU / CoreML を実行し、Gate 1 で採否を確定 |
| SPI-03 は current-host の PyInstaller onedir build / isolated execution / DirectML を確認したが clean Windows と license payload 条件は未完了 | `docs/architecture.md` | `spikes/packaging/windows-result.md`, ADR-0003 §2.4〜§5 | result の overall verdict は PARTIAL、Gate 1 unresolved | **検証待ち** | **実測済み** | Python 未導入 clean Windows と license payload gate を完了 |
| SPI-19 の Windows primitive は別 process 検証、変更・消失、relink、read-only 境界を確認したが Windows reboot と macOS は未実施 | `docs/architecture.md`, `docs/users-guide.md` | `spikes/reference/windows-result.md`, `spikes/reference/macos-result.md`, ADR-0002 §3.2 | Windows lane PARTIAL、macOS NOT_RUN、SPI-19 全体 PARTIAL | **検証待ち** | **実測済み** | Windows 実機 reboot 後と native Apple Silicon Mac で再検証 |

## 4. 設計確定・未実装

| 主張 | 掲載先 | 根拠 path・節 | Evidence | 機能状態 | 文書成熟度 | 再確認条件 |
|---|---|---|---|---|---|---|
| Main が SQLite の唯一の writer となり、Python worker は DB を直接更新しない | `docs/architecture.md` | ADR-0001 §2.2〜2.7、実装計画 §3 | 設計文書のみ。production DB module は未実装 | **設計確定・未実装** | **要求反映済み** | CORE-02〜07 と対象 test 完了後 |
| Project CRUD、診断、削除 preview を UI / Main / IPC で提供する | `docs/users-guide.md`, `docs/architecture.md` | `src/main/projects/`, `src/main/diagnostics/`, `src/main/ipc/project-handlers.ts`, `src/renderer/features/projects/`, `src/renderer/features/settings/` | production source と対象 test が存在する。W0-04 では対象 test を未実行 | **実装済み** | **要求反映済み** | Project / diagnostics 変更時に対象 test と実アプリ受入を再実行 |
| Copy / Reference をユーザーが選択し、Reference 元を変更・削除しない production import 経路を提供する | `README.md`, `docs/users-guide.md`, `docs/architecture.md` | `src/main/data/import-service.ts`, `src/main/data/import-files.ts`, `src/renderer/features/import/ImportPage.tsx`, ADR-0002 §3.2 | production source と対象 test が存在する。Windows reboot 後と macOS の Reference 実機受入は未実施 | **実装済み** | **要求反映済み** | import 変更時の対象 test、および対応 OS の実機受入 |
| Annotation Workspace の保存・確認用 schema / repository / IPC と、Dataset Revision 用テーブルは存在する | `README.md`, `docs/users-guide.md`, `docs/architecture.md` | `src/main/db/migrations/006_annotations.sql`, `src/main/annotations/workspace-repository.ts`, `src/main/ipc/annotation-handlers.ts` | ANN-04 / 06 IPC はMain登録・Preload公開済み。migration 006 に Revision 系3テーブルが存在するが、Revision確定serviceとAnnotation editorは未実装 | **実装済み** | **要求反映済み** | ANN-* のUI・Revision確定・Queue引渡し完了時 |
| Dataset Revision と Model Version は確定後不変とし、確定済み Revision を上位処理へ渡す | `README.md`, `docs/users-guide.md`, `docs/architecture.md` | ADR-0002 §3.1〜3.6、FR-ANN、FR-MOD | Revision table は既存だが、manifest生成・確定service・学習Queue引渡しは未実装 | **設計確定・未実装** | **要求反映済み** | ANN-11〜18 / TRN-20〜21 完了後 |
| Model Suggestion は Ground Truth と分離し、全候補を人が確認するまで Dataset Revision に含めない | `README.md`, `docs/users-guide.md`, `docs/architecture.md` | FR-AST-009〜015、ADR-0002 §3.3 / §3.7 | production assist と承認済み C7 model は存在しない | **設計確定・未実装** | **要求反映済み** | Gate 2、AST-01〜24、NFR-ANN-005 evidence 完了後 |
| 自動学習、HPO、追加学習、Model Version、レポートをローカル worker で提供する | `README.md`, `docs/users-guide.md`, `docs/architecture.md` | FR-TRN、FR-MOD、FR-REP、実装計画 Phase I / J | `health` 以外の production worker command は未実装 | **設計確定・未実装** | **構成のみ** | Gate 2 / 3、TRN-* / REP-* 完了後 |
| カメラ権限は推論開始時だけ要求し、frame / result を既定で保存せず、queue depth 1 で推論する | `README.md`, `docs/users-guide.md`, `docs/architecture.md` | FR-INF-003〜017、ADR-0001 §2.5 / §2.7 | production camera / inference は未実装。SPI-08 は provider smoke のみ | **設計確定・未実装** | **要求反映済み** | INF-* と両 OS permission / performance evidence 完了後 |
| Windows x64 は NSIS EXE、macOS arm64 は flat PKG の自己完結 installer とする | `README.md`, `docs/users-guide.md`, `docs/architecture.md` | FR-INS、ADR-0003 §2 | production installer、正式署名、notarization は未完了 | **設計確定・未実装** | **要求反映済み** | Gate 4、D-16、PKG-* と DOCS-401 / 402 完了後 |
| 同梱 model は C6 classification / detection と C7 classification / detection の承認済み entry だけを許可する | `README.md`, `docs/users-guide.md`, `docs/architecture.md` | FR-LIC-004 / 014、dependency policy、manifest schema | `resources/models/manifest.json` は `ready=false`, `models=[]` | **設計確定・未実装** | **要求反映済み** | SPI-11〜18、法務 / release approver、Gate 2 完了後 |

## 5. MVP 対象外

| 主張 | 掲載先 | 根拠 | 機能状態 | 文書成熟度 | 再確認条件 |
|---|---|---|---|---|---|
| Cloud backend、認証、共同編集、telemetry、runtime download は MVP 対象外 | `README.md`, `docs/users-guide.md`, `docs/developer-guide.md` | 要求定義 §3.2〜3.3、FR-SEC-001〜003 | **対象外** | **要求反映済み** | 要求定義の scope 変更時 |
| 動画、RTSP、segmentation、pose、OCR、生成 AI は MVP 対象外 | `README.md`, `docs/users-guide.md` | 要求定義 §3.2 | **対象外** | **要求反映済み** | Version 2 の要求策定時 |
| Windows on ARM、Windows 10、Intel Mac は MVP 対象外 | `README.md`, `docs/users-guide.md` | 要求定義 §4 | **対象外** | **要求反映済み** | 対応 platform の要求変更時 |
| 未監査 model / plugin の実行時追加は MVP 対象外 | `README.md`, `docs/users-guide.md`, `docs/developer-guide.md` | FR-AST-020、FR-LIC-011、実装計画 §10 | **対象外** | **要求反映済み** | model distribution 要求変更時 |

## 6. 作業ツリー所有権ベースライン

W0-04 開始時点で `README.md`、`docs/architecture.md`、`docs/implementation-plan.md` に W0-01〜03 の差分があり、`work/20260921-1330-TaskExecutionPlan.md` が未追跡だった。W0-04 はこれらを読み取り専用の前提として扱い、本書だけを変更する。source、test、依存、lock、設定、証跡 JSON は変更しない。

## 7. W0-04 の検証結果

| 検証 | 結果 |
|---|---|
| `node scripts/docs/verify-documentation.mjs` | **PASS** — exit code 0、required Markdown 8 files / SVG 5 files |
| `npm run typecheck` | **BLOCKED** — exit code 1、0 test。system npm 11.17.0 が必須 12.0.x と不一致のため、TypeScript 起動前に `EBADDEVENGINES` |
| `node_modules\.bin\tsc.cmd -b tsconfig.main.json tsconfig.renderer.json` | **PASS** — exit code 0、TypeScript errors 0。上記 script と同一の `npm run typecheck` 相当 command |
| editor diagnostics（本書） | **PASS** — errors 0 |
| Node aggregate test / build | **NOT_RUN** — W0-04 の対象外であり PASS と記録しない |
| Python test / lint / type check | **NOT_RUN** — W0-04 の対象外であり PASS と記録しない |

## 8. W0-04 独立敵対的レビュー

実装者とは別担当が、本書の HEAD・基準日・機能状態、未実行 test の扱い、および W0 の変更範囲をレビューした。

| 指摘 | 再現結果 | 採否・反映 |
|---|---|---|
| 要求基準を v0.5 Draft に更新した一方、raw / LF-normalized SHA-256 が旧値のまま | 再現。現行 `docs/requirement-definition.md` と `README.md` の値に不一致 | **採用**。raw を `cd060e8740e986271ca32cf1e22f0cad275e7c26f9ead573c9fb667f26f984fa`、LF-normalized を `962f5d7209de1f607ee6cb4d31e68b084409f7b3105612e6e4042d8b893e037f` へ修正 |
| 修正後の再レビュー | 現行ファイルの実測値および `README.md` と一致 | **閉鎖**。blocking finding 0 |
