# DOCS-001 ドキュメント事実ベースライン

| 項目 | 値 |
|---|---|
| Task | DOCS-001 |
| 作成日 | 2026-09-04 |
| Repository | `dahatake/AutoVision-Studio` |
| Branch | `main` |
| HEAD | `c6179c6a42f47b4962df5222aec3d93358594166` |
| 要求基準 | `docs/requirement-definition.md` v0.3 Draft |
| 要求定義 raw Windows 作業ツリー SHA-256 | `2f1c57da192710ffb2fd764c7e342cf2e9106fa7387be7393133873cc815052f` |
| 要求定義 LF-normalized SHA-256 | `7a6e08e7e046a3ced59644a73bde44c4d7b279f55ba809bd78af60fdaa5b175c` |
| 実測 PowerShell | 7.6.5 Core |
| 実測 Node.js | 24.19.0 |
| 実測 system npm | 11.17.0（製品要件外。bootstrap にのみ使用し、製品検証には使用しない） |
| 実測 uv | 0.12.9 |
| 検証用 npm | 12.0.0 — 承認済み Microsoft proxy metadata が示す `ms-feed-25.pkgs.visualstudio.com` artifact を metadata SHA-1 と照合して一時展開 |
| 現在の再検証 | **PASS** — Python test / lint / type check、Node aggregate test / typecheck / build が合格 |

> 本書は 2026-09-04 時点の文書化用事実を固定する。source や test が存在することと、このセッションで test が合格したことを区別する。実行していない検証を PASS と記録しない。

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
| Electron Main は single-instance lock、ready 後の window 作成、second-instance focus、OS 別の全 window close を処理する | `docs/architecture.md`, `docs/developer-guide.md` | `src/main/app-lifecycle.ts`, ADR-0001 §2.2 | `src/main/app-lifecycle.test.ts` は 7 ケースを定義。現セッションでは npm 不一致により未実行 | **実装済み** | **要求反映済み** | exact npm 12.0.0 で対象 test と aggregate test を再実行 |
| BrowserWindow は context isolation、sandbox、Node integration 無効、navigation / new window deny を設定する | `README.md`, `docs/architecture.md` | `src/main/security.ts`, `src/main/window.ts`, ADR-0001 §2.3 | `src/main/security.test.ts` は 6 ケースを定義。現セッションでは未実行 | **実装済み** | **要求反映済み** | exact npm 12.0.0 で対象 test を再実行 |
| Preload は `autoVision` に contract version だけを公開し、raw IPC / Node capability を公開しない | `docs/architecture.md`, `docs/developer-guide.md` | `src/preload/index.ts`, `src/shared/contracts/app.ts`, ADR-0001 §2.2〜2.4 | `src/preload/index.test.ts` は 2 ケースを定義。現セッションでは未実行 | **実装済み** | **要求反映済み** | exact npm 12.0.0 で対象 test を再実行 |
| Renderer shell は UI-01〜UI-11 の 11 route を持つが、各 route は見出しだけで feature は未実装 | `README.md`, `docs/users-guide.md`, `docs/architecture.md` | `src/renderer/routes.tsx`, `src/renderer/layout/AppShell.tsx` | `src/renderer/layout/AppShell.test.tsx` は route、navigation、keyboard activation を定義。現セッションでは未実行 | **実装済み** | **要求反映済み** | exact npm 12.0.0 で対象 test。各 feature task 完了時に状態を更新 |
| Renderer header の製品版は root `package.json` から取得する実装が未コミット差分に存在する | `README.md`, `docs/developer-guide.md` | `src/renderer/product-version.ts`, `src/renderer/layout/AppShell.tsx`, `tsconfig.renderer.json` | `src/renderer/product-version.test.ts` と更新済み `AppShell.test.tsx` が存在するが現セッション未実行 | **実装済み** | **構成のみ** | VER-04 の対象 test、typecheck、build、敵対レビュー完了後 |
| root product version の形式と package lock / model manifest の整合を検査する未コミット実装が存在する | `docs/developer-guide.md` | `scripts/release/verify-product-version.mjs`, `package.json`, CONTRIBUTING §8.1 | `scripts/release/verify-product-version.test.mjs` が正常・異常系を定義するが現セッション未実行 | **実装済み** | **構成のみ** | VER-02 / VER-03 の Node test と aggregate test 完了後 |
| Python worker CLI は `health` command だけを提供し、component version と OS 名を JSON で返す | `docs/architecture.md`, `docs/developer-guide.md` | `ml/src/autovision_ml/cli.py`, `ml/src/autovision_ml/__init__.py` | exact uv の frozen / offline 環境で `ml/tests/test_cli_health.py` の 4 test、Ruff、Pyright が合格 | **実装済み** | **実測済み** | CLI または lock file 変更時に同じ検証を再実行 |
| Node / Electron / Python の build 設定と lock file は存在する | `docs/developer-guide.md` | `package.json`, `package-lock.json`, `ml/pyproject.toml`, `ml/uv.lock`, Vite / TypeScript config | 現セッションでファイルを確認。build は npm 不一致により未実行 | **検証待ち** | **要求反映済み** | exact toolchain で lock check、test、typecheck、build |

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
| Project CRUD、診断、削除 preview を UI / Main / IPC で提供する | `docs/users-guide.md`, `docs/architecture.md` | FR-SYS-001〜005、FR-PRJ-001〜010、CORE-01〜14 | route 見出しだけ存在。feature は未実装 | **設計確定・未実装** | **構成のみ** | CORE-12〜14 / CORE-13 完了後に DOCS-403 |
| Copy / Reference をユーザーが選択し、Reference 元を変更・削除しない | `README.md`, `docs/users-guide.md`, `docs/architecture.md` | FR-DAT-002、FR-DAT-011〜013、ADR-0002 §3.2 | SPI-19 は PARTIAL。production import は未実装 | **設計確定・未実装** | **要求反映済み** | SPI-19 と DAT-08〜15 完了後 |
| Annotation Workspace は可変、Dataset Revision と Model Version は確定後不変 | `README.md`, `docs/users-guide.md`, `docs/architecture.md` | ADR-0002 §3.1〜3.6、FR-ANN、FR-MOD | 設計文書と SPI-10 PoC のみ | **設計確定・未実装** | **要求反映済み** | ANN-* / TRN-20〜21 完了後 |
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

DOCS-001 作成前に次の差分が存在した。DOCS-002 でこれらを「製品版基盤」として識別し、文書タスクの変更と混在させない。

| 区分 | Path | DOCS task での扱い |
|---|---|---|
| tracked modified | `CONTRIBUTING.md` | VER-01 差分。DOCS-302 までは追記しない |
| tracked modified | `docs/implementation-plan.md` | VER-00 差分。DOCS-302 までは追記しない |
| tracked modified | `package.json` | VER-03 差分。DOCS-305 は version 差分の検証完了後に直列実行 |
| tracked modified | `src/renderer/layout/AppShell.tsx` | VER-04 差分。文書タスクでは変更しない |
| tracked modified | `src/renderer/layout/AppShell.test.tsx` | VER-04 差分。文書タスクでは変更しない |
| tracked modified | `tsconfig.renderer.json` | VER-04 差分。文書タスクでは変更しない |
| untracked | `scripts/release/verify-product-version.mjs` | VER-02 差分。`scripts/docs/` とは別 owner |
| untracked | `scripts/release/verify-product-version.test.mjs` | VER-02 差分。`scripts/docs/` とは別 owner |
| untracked | `src/renderer/product-version.ts` | VER-04 差分。文書タスクでは変更しない |
| untracked | `src/renderer/product-version.test.ts` | VER-04 差分。文書タスクでは変更しない |
| untracked | `work/20260904-1140-DocumentationTaskExecutionPlan.md` | ドキュメント整備計画 |

## 7. 現セッションの検証結果

| 検証 | 結果 |
|---|---|
| PowerShell | 7.6.5 Core — PASS |
| Node.js | 24.19.0 — PASS |
| uv | 0.12.9 — PASS |
| system npm | 11.17.0 — project exact requirement 12.0.0 に不一致 |
| Corepack npm 12 解決 | 公開 npm registry への TLS handshake failure。検証には使用しなかった |
| 承認済み Microsoft package feed から一時 npm 12 bootstrap | **PASS** — metadata version `12.0.0`、artifact SHA-1 `867836fd333dbd272da3705a7c2b32908cbd90c6` 一致、CLI `12.0.0` |
| `npm test` | **PASS** — product-version 25、documentation 19、Vitest 20、合計 64 tests |
| `npm run typecheck` | **PASS** — TypeScript project references |
| `npm run build` | **PASS** — Main、Preload、Renderer。`package.json` と `package-lock.json` の hash 不変 |
| `uv sync --frozen --offline` | **PASS** — 64 packages を同期 |
| `uv run --frozen --offline pytest` | **PASS** — 4 passed |
| `uv run --frozen --offline ruff check src tests` | **PASS** — all checks passed |
| `node ..\node_modules\pyright\index.js`（`ml` から実行） | **PASS** — 0 errors, 0 warnings。npm は起動していない |

## 8. DOCS-001 敵対的レビュー

独立レビューの指摘は、一次資料で再現できたものだけを採用した。

| 指摘 | 再現結果 | 採否・反映 |
|---|---|---|
| source と対象 test が存在する行を `検証待ち` としたのは計画 §3.4 の定義と不一致 | 再現。計画はこの条件を `実装済み` と定義している | **採用**。該当する 7 行を `実装済み` へ修正し、test 未実行の事実は Evidence と再確認条件に維持 |
| product version 実装の文書成熟度 `構成のみ` は不適切 | 再現せず。文書成熟度は source の完成度ではなく、利用可能な文書・手順の成熟度を表す。対象文書は未作成 | **不採用**。理由を記録し、値は維持 |
| test case count の path / line attribution が不足 | 数値は一次 test で一致し、DOCS-001 受入条件は line attribution を要求しない | **不採用**。Python test のみ他行と表記を揃えて 4 ケースと明記 |

## 9. DOCS-001 完了判定

- 要求定義の版と raw / LF-normalized hash を実測した。
- 主張、掲載先、根拠、evidence、機能状態、文書成熟度、再確認条件を分離した。
- 実装済み source と現セッションの test PASS を混同していない。
- 保存済み PoC の OS / scope / PARTIAL 境界を維持した。
- installer、macOS、model、Reference、camera、training を実装済みにしていない。
- DOCS-001 作成前の dirty file を所有権別に記録した。

**判定:** DOCS-001 の fact baseline 作成と敵対的レビュー反映は完了。Python と Node の現セッション検証は合格した。
