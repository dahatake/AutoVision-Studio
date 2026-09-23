# AutoVision Studio タスク実行プラン

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書（実行計画案・**未承認**） |
| 作成日時 | 2026-09-21 13:30 |
| 作成時 HEAD | `25dc1b7`（`Add UI shell probe test for M1 window verification`） |
| 作成時 worktree | クリーン（`git status --short` 出力なし） |
| 対象 | Version 1（MVP）／Windows 11 24H2 以降 x64 |
| 要求基準 | [`docs/requirement-definition.md`](../docs/requirement-definition.md) v0.5 Draft（245要求） |
| 計画正本 | [`docs/implementation-plan.md`](../docs/implementation-plan.md)（task ID・Gate の正本） |
| 状態 | **利用者承認待ち。本書の承認前にタスクを実行しない。** |

> 本書は 2026-09-21 の調査結果に基づく実行順の提案である。既存の task ID、Gate、承認履歴、完了記録を書き換えず、参照する。新しい Gate や新しい要求は追加しない。

---

## 0. 実行前の確認事項（承認が必要）

### 0.1 指示と実在物の差異

利用者の指示にあった参照先のうち、次は**実在を確認できなかった**。捏造を避けるため、実在物へ読み替えた前提で計画している。

| 指示された参照先 | 調査結果 | 本計画での扱い |
|---|---|---|
| `/hve-dev/requirement-definition.md` | `hve-dev/` は存在しない（`Test-Path` = False）。実在する要求定義は [`docs/requirement-definition.md`](../docs/requirement-definition.md) のみ | 実在する `docs/requirement-definition.md` を要求基準とする。これは既存計画の **D-01 で決定済み**の扱いと一致する（[implementation-plan.md §2](../docs/implementation-plan.md)） |
| `copilot-instructions.md` の `## §0 最優先ルール` | `copilot-instructions.md` と `.github/copilot-instructions.md` はいずれも存在しない | 無視対象そのものが存在しない。追加の作用なし |
| `/work/` | 作業ツリーに `work/` は存在しなかった（コミット `632beb9` で旧 `work/` 配下が削除済み） | リポジトリ root 直下に `work/` を新規作成し、本書を配置した |

### 0.2 不明点・選択肢・デフォルト

以下は実行前に確定が必要である。**利用者が変更しない限り、デフォルトの選択肢で実行する。**

| ID | 不明点 | 選択肢 | デフォルト | デフォルトを選んだ理由 |
|---|---|---|---|---|
| Q-01 | 要求定義の参照先 | A. `docs/requirement-definition.md` / B. `hve-dev/` を新設して移動 | **A** | A は実在し、v0.5 Draft・245要求を持つ唯一の要求文書である。B は実在しない文書を要求基準と称することになり、既存 D-01 の決定にも反する。移動は全文書のリンクと hash baseline を破壊する |
| Q-02 | 本計画文書の保存先 | A. リポジトリ内 `work/`（Git 追跡対象） / B. リポジトリ外の一時領域 | **A** | 指示の `/work/` をリポジトリ root 相対と解釈した。`.gitignore` に `work/` 除外は存在しないため追跡対象になる。追跡させたくない場合は Q-02 で B を指示すること |
| Q-03 | E2E 試験基盤の採用 | A. Playwright（Electron 対応） / B. 独自 harness / C. E2E を当面作らず単体試験のみ | **A** | 既存計画が `tests/e2e/*.spec.ts` を前提とし、出典 [P09] で Playwright の Electron 制約に言及済み。B は harness 自作となり過剰。C は Gate 3 の「縦スライス成立」を証明できない。**A は新規依存追加のため、C0 と同じ依存採用記録（必要性・license・脆弱性・lock）を W3-01 で必須とする** |
| Q-04 | 分類 lane と検出 lane の並列実行 | A. 直列（単一担当） / B. 並列（2担当以上） | **A** | 本計画は担当者数を確認できていない。並列は出力 file が重ならない設計にしてあるため、担当者を確保できる場合は B へ切替可能。切替時も共有 file（`AppShell.tsx` 等）の編集排他は維持する |
| Q-05 | UIR-017 等の「本人確認」の実施主体 | A. 利用者本人が実施し結果を記録 / B. 実装担当が代行 | **A** | 既存記録が「自己点検・JSDOM 結果を本人の実回答に代用しない」と明記している（[ui-ux-execution.md](../docs/ui-ux-execution.md)）。B は代行・捏造に該当する |
| Q-06 | Gate 2（モデル承認）の着手時期 | A. Wave 2〜3 と並行して監査を進める / B. Wave 3 完了後に着手 / C. 当面着手しない | **A** | 監査は法務・一次資料調査が主で、実装 lane と出力 file が重ならない。並行しても実装を阻害しない。ただし**承認が出るまで AST/TRN/REP/INF の実装は開始しない**境界は維持する |
| Q-07 | Dataset Revision 用の新規 migration | A. 追加しない（既存 `006_annotations.sql` を使う） / B. `008_revisions.sql` を追加 | **A** | `006_annotations.sql` に `dataset_revisions`(113行)、`dataset_items`(133行)、`workspace_revision_sources`(161行) が**既に存在する**ことを確認済み。B は重複テーブルの新設であり過剰実装かつ schema 破壊リスクがある |
| Q-08 | `src/main/annotations/provenance.ts`（ANN-16）の新規作成 | A. 新規作成しない / B. 新規モジュールとして切り出す | **A** | `annotation_provenance` テーブル（`006_annotations.sql:90`）と、`workspace-repository.ts`・`annotation-handlers.ts` の provenance 記録・返却経路が既に存在する。B は既存実装を別名で再実装する重複であり、YAGNI 違反 |
| Q-09 | `CHANGELOG.md` の新規作成時期 | A. 全対象タスク完了後（既存規約を維持） / B. Wave ごとに追記 | **A** | 既存 UI 実行記録が「全UIタスクと必要な既存依存・レビューが完了した後だけ CHANGELOG の Unreleased へ記載し、その後 root package/lock の PATCH を1増やす」と規定している。B はこの承認済み規約の変更にあたる |
| Q-10 | 本計画で扱う範囲 | A. Gate 3 到達までを詳細化し、Gate 2/4/5 は既存計画を参照 / B. Gate 5 までの全タスクを本書で再定義 | **A** | B は既存 [`implementation-plan.md`](../docs/implementation-plan.md) §7 の task 表（Phase H〜N）をほぼ全面複製することになり、正本の二重化を招く。Gate 2 未解消の段階で Gate 4/5 の詳細設計を確定するのは、未実測値に基づく先回り設計で過剰である |

---

## 1. 調査で確定した事実（計画の前提）

### 1.1 文書の記述と実装が一致していない箇所

次は**新規実装ではなく、状態記録の更新**が必要な項目である。既存実装を「未実装」として再実装しない。

| 文書の記述 | 実際の実装 | 根拠 |
|---|---|---|
| 「Preload は `contractVersion` だけを公開」 | `projects` / `labelSchemas` / `annotations` / `diagnostics` / `jobs` / `imports` の6 API を公開済み | [`src/preload/index.ts:15-37`](../src/preload/index.ts)、[`src/shared/contracts/app.ts:11-24`](../src/shared/contracts/app.ts) |
| 「Renderer は 11 route の見出しだけ」 | UI-01/02/03/04/09 は実 component が存在。UI-05/06/07/08/10/11 が `EmptyRoute` | `src/renderer/features/` 配下に `DiagnosticsPage` `ProjectListPage` `ProjectForm` `ImportPage` `LabelSchemaPage` `SettingsPage` が実在 |
| 「ANN-04 の Label Schema IPC が残件」 | 実装・Main 登録済み | [`src/main/ipc/label-schema-handlers.ts`](../src/main/ipc/label-schema-handlers.ts)、[`src/main/index.ts:232`](../src/main/index.ts) |
| 「ANN-06 の Workspace IPC が残件」 | 実装・Main 登録済み | [`src/main/ipc/annotation-handlers.ts`](../src/main/ipc/annotation-handlers.ts)、[`src/main/index.ts:234`](../src/main/index.ts) |
| 実装計画の予定名 `004_annotations.sql` 等 | 実際の適用済み migration は 001〜007 | `src/main/db/migrations/` に 001_core〜007_annotation_target_history が実在 |

### 1.2 実装済みで再作成しないもの

| 領域 | 実在する production file |
|---|---|
| App 基盤 | `app-lifecycle.ts`, `window.ts`, `security.ts`, `paths.ts`, `index.ts` |
| DB | `database.ts`, `migrate.ts`, `backup.ts`, migrations 001〜007 |
| Project | `project-repository.ts`, `project-service.ts`, `project-directory.ts`, `project-move.ts`, `project-move-receipt.ts`, `project-operation-lock.ts` |
| Job | `job-repository.ts`, `job-state.ts`, `job-service.ts`, `worker-supervisor.ts`, `recover-jobs.ts` |
| Import | `import-service.ts`, `import-repository.ts`, `import-files.ts`, `import-capacity.ts`, `copy-source.ts`, `reference-source.ts`, `reference-access.ts`, `rights-acknowledgement.ts`, `image-protocol.ts`, `safe-path.ts` |
| Annotation | `label-schema-repository.ts`, `label-schema-service.ts`, `workspace-repository.ts`, `workspace-service.ts`, `save-draft.ts`, `target-history.ts`, `validate-annotation.ts`（**item 単位のみ**） |
| Python | `cli.py`（health / probe-hardware / scan-dataset）, `image_scan.py`, `image_decode.py`, `classification_import.py`, `coco_import.py` |
| 版・診断・ログ | `product-version.ts`, `version-compatibility.ts`, `diagnostics-service.ts`, `redact.ts`, `diagnostic-export.ts`, `atomic-write.ts` |
| UI | `AppShell.tsx`, `WorkflowTabs.tsx`, `ProjectWorkspace.tsx`, `SystemIcon.tsx`, `tokens.css`, UI-01/02/03/04/09 の各 page |

### 1.3 未実装と確認した production file（本計画の主対象）

| 領域 | 不在を確認した file |
|---|---|
| Revision | `src/main/data/revision-manifest.ts`, `revision-repository.ts`, `revision-service.ts` |
| Workspace 派生 | `src/main/annotations/clone-workspace.ts`, `confirm-and-queue.ts` |
| Workspace 全体検証 | `validate-annotation.ts` 内に未実装（同 file のコメントに *"Whole-workspace totals/validation are deliberately NOT implemented by this leaf"* と明記） |
| 学習 Queue | `src/main/jobs/training-queue.ts` |
| Project 削除 | `src/main/projects/delete-preview.ts`, `delete-project.ts` |
| 電源・温度 | `src/main/diagnostics/power-thermal.ts` |
| Python split | `ml/src/autovision_ml/data/split_dataset.py` |
| Annotation UI 一式 | `src/renderer/features/annotations/` に `LabelSchemaPage` 以外の全 component |
| Job UI | `src/renderer/features/jobs/` ディレクトリ自体が不在 |
| E2E | `tests/e2e/` ディレクトリ自体が不在 |

### 1.4 外部条件で BLOCKED のもの（実装で解消できない）

| 条件 | 現状 | 根拠 |
|---|---|---|
| Gate 2（モデル承認） | **BLOCKED / NOT_COMPLETE** | [`docs/adr/0004-spike-decisions.md:13`](../docs/adr/0004-spike-decisions.md) |
| 承認済みモデル | 0件（`ready:false` / `models:[]`） | `resources/models/manifest.json` |
| C6 分類・C6 検出・C7 分類・C7 検出 | 全4役とも承認 0 件 | `docs/model-governance/` 配下4文書 |
| AutoML 予算（TBD-03 / D-15） | 未決定 | [`docs/requirement-definition.md:897`](../docs/requirement-definition.md) |
| UIR-017 本人確認 | `NOT_RUN` | [`tests/manual/ui-shell-review.md`](../tests/manual/ui-shell-review.md) |

---

## 2. 実行 Wave と依存関係

```mermaid
flowchart TD
    W0[Wave 0: 文書事実同期<br/>コード変更なし] --> W2
    W1[Wave 1: 本人確認の解消<br/>利用者操作] --> W3H
    W0 --> W2A[Wave 2A: Annotation 表示基盤]
    W2A --> W2B[Wave 2B: 共通編集基盤]
    W2B --> W2C[Wave 2C: 分類 lane]
    W2B --> W2D[Wave 2D: 検出 lane]
    W2C --> W2F[Wave 2F: 確定→Revision→Queue]
    W2D --> W2F
    W2[Wave 2] --> W2G[Wave 2G: Project 残]
    W2 --> W2H[Wave 2H: Job 状態 UI]
    W2F --> W3[Wave 3: E2E・受入]
    W2G --> W3
    W2H --> W3
    W3 --> W3H[Gate 3 判定]
    W3H --> W4[Wave 4: users-guide 更新]
    P2[Gate 2 lane: モデル監査<br/>並行・実装を阻害しない] -.-> GATE2[Gate 2 判定]
    GATE2 -.-> W5[Wave 5 以降:<br/>既存計画 Phase H〜N を参照]
    W4 --> W5
```

**並列規則:** 依存が完了し、かつ `作成・編集 file` が重ならない task だけを並列実行する（既存 §4.4 を継承）。`AppShell.tsx`・`routes.tsx`・`app.ts`・`index.ts` は共有 file であり、同時編集しない。

---

## 3. 詳細タスク

### 3.1 表の読み方

- **出力:** `作成・編集 file` 欄の file だけを変更する。未記載 file のついで編集は禁止。
- **粒度:** 既存 §4.1 を継承し、production 1〜3 file、test 1〜2 file、doc 1 section、観測可能な1挙動を上限とする。
- **DoD（完了条件）:** 各タスクは以下 **5項目すべて**を満たして初めて完了とする。これは既存 §4.3 の手順を DoD として明文化したものである。
  1. `完了条件（DoD）` 欄の観測可能な挙動が、記載の test file で検証されている
  2. 対象 test を実行し、**実コマンド・終了コード・件数**を記録した（件数の合算による水増しをしない）
  3. `npm run typecheck` 相当の型検査と editor diagnostics が 0 である
  4. 実装者とは別担当の独立敵対的レビューで blocking finding 0、または指摘を修正し再検証して閉じた
  5. 上記未達の場合は `REVIEW_PENDING` / `BLOCKED` を保持し、**依存タスクを開始しない**

---

### Wave 0 — 文書事実同期（コード変更なし・相互に並列可）

前提: なし。Wave 2 開始前に完了させる（誤った「未実装」記述に基づく重複実装を防ぐため）。

| ID | タスク | 作成・編集 file | 依存 | 完了条件（DoD） |
|---|---|---|---|---|
| W0-01 | architecture.md の「現行」節を実装実態へ同期 | `docs/architecture.md`（該当1節のみ） | なし | Preload 公開 API が6種である事実と、UI-01/02/03/04/09 が実 component・UI-05/06/07/08/10/11 が `EmptyRoute` である事実を記載。`node scripts/docs/verify-documentation.mjs` が exit 0。未実装機能を利用可能と書かない |
| W0-02 | README「現在の利用可否」を同期 | `README.md`（該当1節のみ） | なし | 現在到達している画面と未到達画面を区別して記載。要求 hash・版番号の既存行を変更しない。`verify-documentation.mjs` と `verify-product-version.mjs` が exit 0 |
| W0-03 | 実装計画へ現状確定を追記 | `docs/implementation-plan.md`（§15.10 を新設、追記のみ） | なし | ①ANN-04/06 の IPC が実装済みであること、②migration 006 に Revision 系テーブルが存在し新規 migration が不要であること、③現在の使用済み migration 番号が 001〜007 であることを記載。既存の表・承認履歴・過去の件数記録を書き換えない。`verify-documentation.mjs` が exit 0 |
| W0-04 | 事実ベースラインの再基準化 | `docs/documentation-fact-baseline.md` | W0-01〜03 | HEAD・日付・「機能状態」欄を現在の実装へ更新。未実行の test を PASS と記録しない。`verify-documentation.mjs` が exit 0 |

> **停止条件:** W0 は文書のみを変更する。source・test・依存・lock・証跡 JSON を変更した時点で範囲逸脱とする。

---

### Wave 1 — 本人確認の解消（利用者操作。実装 lane と並列可）

| ID | タスク | 作成・編集 file | 依存 | 完了条件（DoD） |
|---|---|---|---|---|
| W1-01 | UIR-017 の利用者本人確認を実施・記録 | `tests/manual/ui-shell-review.md`, `docs/ui-ux-execution.md`（該当1行） | なし（利用者の実施が必要） | 利用者本人が実アプリで「現在対象・状態／次の結果／戻り先」を回答し、期待 ID と実回答を照合した記録が残る。未実施なら `NOT_RUN` を保持し、**代行・推測で埋めない**。実施後に UIR-017 の状態を BLOCKED から更新 |
| W1-02 | UIR-041Q / UIR-084 の現況確定 | `docs/ui-ux-execution.md`（該当1節） | なし | 両 ID について「完了／未実施／未確認」のいずれかを証拠付きで確定。証拠が無い場合は **`未確認` と明記して保持**し、完了扱いにしない |
| W1-03 | UIR-025 親タスクの残条件確定 | `docs/ui-ux-execution.md`（該当1節） | W1-01, W1-02 | 親 UIR-025 を閉じるために残る条件（削除 preview、正式 Gate、署名、clean install、本人確認）を列挙し、各々の担当 Wave を対応付ける。leaf の完了を親の完了へ昇格させない |

---

### Wave 2A — Annotation 表示基盤（直列）

前提: Wave 0 完了。Gate 1 `CONDITIONAL_GO` に依存（core / manual annotation は開発可）。

| ID | タスク | 作成・編集 file | 依存 | 完了条件（DoD） |
|---|---|---|---|---|
| W2-01 | thumbnail の read-only 配信 | `src/main/data/image-protocol.ts`, `src/main/data/image-protocol.test.ts` | W0 | 既存 safe path 検証を維持したまま、縮小画像を配信する1経路を追加。Project allowlist 外・traversal・symlink 越境を拒否する既存の負例が引き続き失敗しない。**汎用画像変換 API や cache 層を作らない** |
| W2-02 | AnnotationPage 骨格と一覧表示 | `src/renderer/features/annotations/AnnotationPage.tsx`, `AnnotationPage.test.tsx` | W2-01 | `/annotations` が `EmptyRoute` ではなく、既存 `annotations` IPC 経由で workspace の item 一覧を表示する。件数と取得失敗時のエラー表示を検証 |
| W2-03 | gallery と前後移動・状態 filter | `src/renderer/features/annotations/ImageGallery.tsx`, `ImageGallery.test.tsx` | W2-02 | 未着手／編集中／確認済み／除外の filter と、前後移動が keyboard で操作できる。表示外件数を隠さない |

### Wave 2B — 共通編集基盤（直列）

| ID | タスク | 作成・編集 file | 依存 | 完了条件（DoD） |
|---|---|---|---|---|
| W2-04 | 保存 draft hook（autosave / undo） | `src/renderer/features/annotations/useAnnotationDraft.ts`, `useAnnotationDraft.test.ts` | W2-03 | 編集から **1秒以内に保存を開始**し、現在画像の undo / redo ができる。既存 `save-draft.ts` の契約（内容と確認解除の同時保存、古い更新の拒否）に従う。**汎用 undo framework を作らない** |
| W2-05 | 保存状態と共通 item 操作 | `src/renderer/features/annotations/SaveStatus.tsx`, `ItemActions.tsx`, `ItemActions.test.tsx` | W2-04 | 保存中／保存済み／失敗を色以外の手段でも区別して表示し、除外理由を選択できる。keyboard で全操作に到達できる |

### Wave 2C — 分類 lane（Wave 2D と並列可・Q-04 に従う）

| ID | タスク | 作成・編集 file | 依存 | 完了条件（DoD） |
|---|---|---|---|---|
| W2-06 | 分類エディター | `src/renderer/features/annotations/ClassificationEditor.tsx`, `ClassificationEditor.test.tsx` | W2-05 | 1画像に **ちょうど1クラス**を設定し、置換・解除・除外ができる。0個／複数指定を UI で作れない |
| W2-07 | ラベル選択と最近使用 | `src/renderer/features/annotations/LabelPicker.tsx`, `useRecentLabels.ts`, `LabelPicker.test.tsx` | W2-06 | 検索・最近使用・数字 shortcut が mouse と keyboard の双方で動作する。IME 入力中に shortcut が誤発火しない |
| W2-08 | 一括適用とクラス分布 | `src/renderer/features/annotations/ClassificationBulkBar.tsx`, `ClassDistribution.tsx`, `ClassificationBulkBar.test.tsx` | W2-07 | 複数選択への一括適用と、件数・偏り警告を表示する。**確認済み Ground Truth を上書きしない** |

### Wave 2D — 検出 lane（Wave 2C と並列可）

依存ライブラリ `konva@10.3.2` / `react-konva@19.2.5` は `package.json` に採用済みのため、新規依存追加は発生しない。

| ID | タスク | 作成・編集 file | 依存 | 完了条件（DoD） |
|---|---|---|---|---|
| W2-09 | 座標変換（純関数） | `src/renderer/features/annotations/canvas-coordinates.ts`, `canvas-coordinates.test.ts` | W2-05 | 画像 pixel ↔ 表示座標の相互変換が zoom / pan 適用下で往復一致する。境界値と非有限値を拒否 |
| W2-10 | 検出 canvas 基盤 | `src/renderer/features/annotations/DetectionCanvas.tsx`, `DetectionCanvas.test.tsx` | W2-09 | 画像表示と zoom / pan が動作する。矩形操作は本タスクに含めない |
| W2-11 | 矩形の作成・選択・削除 | `src/renderer/features/annotations/RectangleLayer.tsx`, `RectangleLayer.test.tsx` | W2-10 | 矩形の作成・選択・削除ができ、選択中 ID を表示する |
| W2-12 | 矩形の移動・リサイズ | `src/renderer/features/annotations/RectangleTransformer.tsx`, `RectangleTransformer.test.tsx` | W2-11 | 画像境界で clamp され、最小サイズ未満を作れず、**画像 pixel 座標**で保存される |
| W2-13 | 領域一覧・クラス変更・対象物なし | `src/renderer/features/annotations/RegionList.tsx`, `NoObjectButton.tsx`, `RegionList.test.tsx` | W2-12 | 矩形ごとのクラス変更ができ、「対象物なし」と「未着手」が区別して表示・保存される |
| W2-14 | 矩形コマンドと重複警告 | `src/renderer/features/annotations/RectangleCommands.tsx`, `src/main/annotations/duplicate-warning.ts`, `RectangleCommands.test.tsx` | W2-13 | 複製・全選択・keyboard 操作が動作し、同一クラスの高重複を警告する。**自動削除・自動統合はしない** |

### Wave 2E — 作業指示の常時表示

| ID | タスク | 作成・編集 file | 依存 | 完了条件（DoD） |
|---|---|---|---|---|
| W2-15 | Annotation 指示表示 | `src/renderer/features/annotations/AnnotationInstructions.tsx`, `AnnotationInstructions.test.tsx`, `ClassificationEditor.tsx`, `ClassificationEditor.test.tsx`, `DetectionCanvas.tsx`, `DetectionCanvas.test.tsx`（2026-09-21 利用者承認によりエディター2 file・対応 test 2 file を範囲へ追加） | W2-06, W2-10 | Project 固有の遮蔽・端切れ・極小・曖昧境界の方針をエディター内で常時参照できる。**指示の編集 UI は本タスクに含めない** |

### Wave 2F — 確定 → Revision → Queue（Main 側・直列）

前提: Q-07 のとおり **新規 migration を追加しない**。`006_annotations.sql` の既存テーブルを使用する。

| ID | タスク | 作成・編集 file | 依存 | 完了条件（DoD） |
|---|---|---|---|---|
| W2-16 | workspace 全体の検証 | `src/main/annotations/validate-annotation.ts`, `workspace-validation.test.ts` | W2-08, W2-14 | workspace 全 item を走査し、未確認・除外・Schema 外・不正矩形の件数と内訳を返す。既存の **item 単位 API の契約を変更しない**。書き込みを行わない |
| W2-17 | データ分割 | `ml/src/autovision_ml/data/split_dataset.py`, `ml/tests/test_split_dataset.py` | W2-16 | 固定 seed で再現し、分類では層化を行い、同一 hash 画像が train/val/test に跨らない |
| W2-18 | Revision manifest writer | `src/main/data/revision-manifest.ts`, `revision-manifest.test.ts` | W2-16 | temp 書き込み → hash → atomic rename で manifest を生成する。**確認済み item だけ**を含め、未確認・候補が 0 件であることを検査する |
| W2-19 | Revision repository | `src/main/data/revision-repository.ts`, `revision-repository.test.ts` | W2-18 | `dataset_revisions` / `dataset_items` への読み書きを提供し、確定済み revision の更新を拒否する |
| W2-20 | Revision service | `src/main/data/revision-service.ts`, `revision-service.test.ts` | W2-19 | manifest 生成と DB 登録を 1 transaction で確定し、失敗時に部分状態を残さない。lineage（親 revision）を保持する |
| W2-21 | Revision IPC / Preload | `src/shared/contracts/revision-ipc.ts`, `src/main/ipc/revision-handlers.ts`, `src/preload/revision-api.ts` | W2-20 | sender origin・payload schema・Project ID を検証する。**channel 名や任意 path を Renderer から指定できる汎用 API を作らない** |
| W2-22 | 確定ダイアログ | `src/renderer/features/annotations/ConfirmDatasetDialog.tsx`, `ConfirmDatasetDialog.test.tsx` | W2-21 | 件数・provenance 内訳・未処理候補を表示し、**Error がある間は確定を block** する |
| W2-23 | 学習 Queue | `src/main/jobs/training-queue.ts`, `training-queue.test.ts` | W2-20 | training は同時 1 件で FIFO。**汎用 scheduler・優先度・再試行ポリシーを作らない** |
| W2-24 | 確定と Queue 引渡し | `src/main/annotations/confirm-and-queue.ts`, `confirm-and-queue.test.ts` | W2-22, W2-23 | commit 後 **5秒以内**に Training Run が `Queued` になる。学習 worker 未実装でも状態が整合する |
| W2-25 | 追加学習用 workspace 複製 | `src/main/annotations/clone-workspace.ts`, `clone-workspace.test.ts` | W2-20 | revision から編集可能 workspace を複製し、hash 重複を排除し、**元 revision を変更しない** |

### Wave 2G — Project 残機能（Wave 2A〜2F と並列可）

| ID | タスク | 作成・編集 file | 依存 | 完了条件（DoD） |
|---|---|---|---|---|
| W2-26 | 削除 preview（Main） | `src/main/projects/delete-preview.ts`, `delete-preview.test.ts` | W0 | 所有データと Reference 参照データを区別して件数・容量を返す。**この時点で削除を実行しない** |
| W2-27 | 削除確認ダイアログ | `src/renderer/features/projects/DeleteProjectDialog.tsx`, `DeleteProjectDialog.test.tsx` | W2-26 | preview 内容を表示し、明示確認なしに削除を実行しない |
| W2-28 | Project 削除の実行 | `src/main/projects/delete-project.ts`, `delete-project.test.ts` | W2-27, W2-20 | 所有 workspace / artifact を削除し、**Reference 元ファイルを削除・変更しない**。失敗時に部分削除状態を残さない |
| W2-29 | 電源・温度取得 | `src/main/diagnostics/power-thermal.ts`, `power-thermal.test.ts` | W0 | OS から取得できる値だけを返し、**取得不能時に状態を推測しない**（`unknown` を返す） |
| W2-30 | 長時間処理前の警告表示 | `src/renderer/features/diagnostics/PowerWarning.tsx`, `PowerWarning.test.tsx` | W2-29 | 取得できた場合のみ警告を表示し、`unknown` を「正常」と表示しない |

### Wave 2H — Job 状態 UI（Wave 2F と並列可）

| ID | タスク | 作成・編集 file | 依存 | 完了条件（DoD） |
|---|---|---|---|---|
| W2-31 | Job 状態バー | `src/renderer/features/jobs/JobStatusBar.tsx`, `JobStatusBar.test.tsx` | W0 | 既存 `jobs` IPC の progress 購読で現在処理・進捗・cancel を常時表示する |
| W2-32 | Job 一覧ページ | `src/renderer/features/jobs/JobPage.tsx`, `JobPage.test.tsx` | W2-31 | queue 内の job 一覧と状態を表示し、明示 cancel ができる。**自動再開・自動再試行を実装しない** |

---

### Wave 3 — E2E 基盤と Gate 3 受入

| ID | タスク | 作成・編集 file | 依存 | 完了条件（DoD） |
|---|---|---|---|---|
| W3-01 | E2E 基盤の依存採用 | `package.json`, `package-lock.json`, `docs/dependency-adoption/e2e-framework.md` | Q-03 承認 | Playwright の必要性・安定版・Windows x64 / Electron 対応・直接および transitive license・脆弱性を C0 と同じ様式で記録し、exact lock する。`npm ci` が exit 0 |
| W3-02 | E2E harness と fixture | `tests/e2e/harness.ts`, `tests/fixtures/project.ts` | W3-01 | packaging 前アプリを起動し、終了時に残 process が 0 であることを確認できる。**製品コードに test 専用の分岐を追加しない** |
| W3-03 | Project CRUD E2E | `tests/e2e/project-crud.spec.ts` | W3-02, W2-28 | 作成・編集・削除と、**再起動後の保持**、他 Project への非干渉を検証 |
| W3-04 | 取り込み E2E（分類） | `tests/e2e/import-classification.spec.ts` | W3-02 | folder / CSV / unlabeled、壊れた file、容量不足、権利未確認の各経路を検証 |
| W3-05 | 取り込み E2E（検出） | `tests/e2e/import-detection.spec.ts` | W3-02 | COCO 取り込みと不正 item の報告、Reference の再起動後アクセスと relink を検証 |
| W3-06 | Annotation E2E（分類） | `tests/e2e/annotation-classification.spec.ts`, `tests/fixtures/classification-images.ts` | W3-02, W2-24 | 取り込み → ラベル付け → 確認 → Revision 確定 → Queued までが成立し、未確認 0 件を検証 |
| W3-07 | Annotation E2E（検出） | `tests/e2e/annotation-detection.spec.ts`, `tests/fixtures/coco.ts` | W3-02, W2-24 | 同上を矩形作成・対象物なしを含めて検証 |
| W3-08 | Reference 実機受入 | `tests/manual/windows-file-picker.md` | W3-05 | 署名前 package で OS 標準 picker・複数選択・folder・cancel、アプリ再起動と **OS 再起動後**の Reference アクセス／relink を確認。結果を SPI-19 の PASS へ読み替えない |
| W3-09 | Gate 3 判定 | `docs/implementation-plan.md`（§15.11 を新設） | W3-03〜W3-08 | Project→Import→Annotation→Revision→Queued の縦スライス成立を実証拠付きで記録する。未実施項目を合格に数えない。不合格なら **Training / assist の実装を開始しない** |

---

### Wave 4 — users-guide 更新（機能完了後に実施）

**調査結果:** [`docs/users-guide.md`](../docs/users-guide.md) は全16章が存在するが、§6・§8・§9・§10 等に「主な操作（実装完了後に手順を記載予定）」の空欄が残る。したがって **users-guide の更新は必要**である。

| ID | タスク | 作成・編集 file | 依存 | 完了条件（DoD） |
|---|---|---|---|---|
| W4-01 | §6 Project の操作手順 | `docs/users-guide.md` §6 | W3-03 | 実画面の文言と一致する手順に置換。未実装機能を手順として書かない。`verify-documentation.mjs` が exit 0 |
| W4-02 | §7 取り込みの操作手順 | `docs/users-guide.md` §7 | W3-04, W3-05, W3-08 | Copy / Reference、容量、権利確認、形式、relink 手順を実測に基づいて記載 |
| W4-03 | §8 分類チュートリアル | `docs/users-guide.md` §8 | W3-06 | 実画面の操作手順へ置換 |
| W4-04 | §9 検出チュートリアル | `docs/users-guide.md` §9 | W3-07 | 同上 |
| W4-05 | §10 Label Schema 詳細 | `docs/users-guide.md` §10 | W3-06, W3-07 | 同上 |
| W4-06 | 状態凡例・目次の整合 | `docs/users-guide.md` 冒頭 | W4-01〜05 | 更新した章の「機能状態」「文書成熟度」を実態へ同期。未更新章の表示を変更しない |

> §11（補助）・§12（学習）・§13（カメラ）・§14（ストレージ／ライセンス）・§15（インストール）は、対応機能が Gate 2 / Gate 4 / Gate 5 に依存するため **本計画の対象外**とし、既存 `DOC-04`〜`DOC-09` の担当を維持する。

---

### Gate 2 lane — モデル承認（Wave 2〜3 と並行・実装 lane を阻害しない）

出力 file が実装 lane と重ならないため並行実行できる。**承認が出るまで AST/TRN/REP/INF の実装を開始しない**境界は維持する。

| ID | タスク | 作成・編集 file | 依存 | 完了条件（DoD） |
|---|---|---|---|---|
| G2-01 | 分類 Base Weight 監査 | `docs/model-governance/classification-base.md` | なし | 候補1件について license・学習データ由来・再配布可否・intended use・checkpoint hash を一次資料 URL と取得日付きで判定。不明が1つでも残れば `HOLD` を保持 |
| G2-02 | 検出 Base Weight 監査 | `docs/model-governance/detection-base.md` | なし | 同上 |
| G2-03 | 分類 Assist Model 監査 | `docs/model-governance/classification-assist.md` | なし | 同上 |
| G2-04 | 検出 Assist Model 監査 | `docs/model-governance/detection-assist.md` | なし | 同上 |
| G2-05 | 学習→ONNX 一致検証（分類） | `spikes/models/classification.py`, `classification-result.md` | G2-01 | 権利確認済み fixture で train → ONNX → CPU 推論の出力差を実測記録。閾値超過は失敗として記録 |
| G2-06 | 学習→ONNX 一致検証（検出） | `spikes/models/detection.py`, `detection-result.md` | G2-02 | box / score / label と mAP 差を実測記録 |
| G2-07 | 補助品質 baseline | `spikes/models/assist_benchmark.py`, `assist-result.md` | G2-03, G2-04 | gold set で coverage / accept / edit / reject / 所要時間を手作業のみと比較し実測記録 |
| G2-08 | AutoML 予算の決定 | `docs/implementation-plan.md`（D-15 の決定行） | G2-05, G2-06 | Windows 実機 mini-run に基づく有限の最大 Trial 数・最大時間を記録。**測定前の数値を置かない** |
| G2-09 | Gate 2 判定と manifest 更新 | `docs/adr/0004-spike-decisions.md`, `resources/models/manifest.json` | G2-01〜G2-08 | 4役すべてが承認された場合のみ `ready=true` と entry を追加。1役でも未承認なら `BLOCKED` を保持し、**空 manifest のまま**とする |

---

### Wave 5 以降 — Gate 4 / Gate 5（本計画では再定義しない）

Gate 2 判定後に着手する Phase H（Annotation Assist）・Phase I（Training）・Phase J（Report）・Phase K（Camera inference）・Phase L（hardening）・Phase M（installer）・Phase N（final acceptance）は、既存 [`docs/implementation-plan.md` §7](../docs/implementation-plan.md) の task 表を正本として使用する。

**本計画で再定義しない理由:** これらは未承認モデルの実測値・未決定の AutoML 予算・未取得の署名証明書に依存する。実測前に詳細設計を確定することは、未検証の前提に基づく先回り設計であり、過剰実装にあたる（Q-10）。

着手前に再確認が必要な既存の決定事項:

| ID | 内容 | 現状 |
|---|---|---|
| D-10 | Product identity | 暫定 `io.github.dahatake.autovisionstudio`。Gate 3 までに確定が必要 |
| D-16 | Windows コード署名証明書 | **利用者からの提示が必要**。未提示 |
| REP-11 | グラフ描画の依存採用 | 未決。Phase J 着手前に1つだけ採用、または追加依存なしと決定 |

---

## 4. 実行順のまとめ

| 順 | Wave | 並列性 | 主な成果 |
|---|---|---|---|
| 1 | Wave 0 | 4 task 並列可 | 文書と実装の不一致を解消（誤った重複実装を防ぐ） |
| 2 | Wave 1 | Wave 0 と並列可 | 本人確認の状態確定 |
| 3 | Wave 2A → 2B | 直列 | Annotation の表示・保存基盤 |
| 4 | Wave 2C ／ 2D ／ 2G ／ 2H | 4 lane 並列可（Q-04） | 分類・検出の編集 UI、Project 残、Job UI |
| 5 | Wave 2E → 2F | 直列 | 確定 → Revision → Queue |
| 6 | Wave 3 | W3-03〜W3-07 は並列可 | E2E と Gate 3 判定 |
| 7 | Wave 4 | 章ごとに並列可 | users-guide の実手順化 |
| — | Gate 2 lane | Wave 2〜3 と並行 | モデル承認（Gate 4 以降の前提） |

---

## 5. オーバーエンジニアリング禁止事項（本計画の全タスクに適用）

既存 [`implementation-plan.md` §1.3](../docs/implementation-plan.md) と §10 を継承し、本計画では特に次を禁止する。

1. **Q-07 / Q-08 の重複実装をしない。** Revision 用 migration を新設せず、`provenance.ts` を新規に切り出さない。
2. **汎用化の先回りをしない。** annotation editor は「単一クラス分類」と「軸平行矩形」だけを扱う。回転矩形・polygon・mask の拡張点を設けない。
3. **状態管理ライブラリを導入しない。** React state と画面単位 hooks で実装する。
4. **抽象レイヤーを作らない。** Strategy / Factory / DI container / 汎用 repository framework / plugin API を導入しない。
5. **未使用の設定・フラグを追加しない。** 要求に無い閾値・オプション・環境変数を作らない。
6. **予防的なエラー処理・ログを追加しない。** 要求された失敗経路と、実際に再現した失敗だけを扱う。
7. **test のために製品コードを変更しない。** E2E 用の分岐・hook を production file に入れない。
8. **範囲外 file を編集しない。** 各タスクの `作成・編集 file` 欄以外は変更しない。
9. **scheduler / 再試行 / 自動復旧を作らない。** training は 1件 FIFO、job は明示 cancel のみ、復旧は状態遷移のみとする。

---

## 6. 停止条件・終了条件

### 6.1 停止条件（該当したら進めない）

- Gate 2 が未解消の間、**AST / TRN / REP / INF の実装を開始しない**。
- Gate 3 が不合格の間、**Training / assist の機能実装を開始しない**。
- 本人確認が未実施の項目を、自己点検・JSDOM 結果・実装担当の代行で**合格に置き換えない**。
- `SPI-03` / `SPI-09` / `SPI-19` は `SKIPPED_BY_USER` を保持し、**別名で開発前提へ戻さない**。対応する製品受入（`DAT-15` / `INF-14` / `INF-15`）は個別に実施する。
- 未実行の test を PASS と記録しない。異なる対象集合の件数を合算しない。

### 6.2 最終化の条件（既存規約を維持）

1. 本計画の全対象タスクと、必要な既存依存・独立レビューが完了する
2. その後にのみ `CHANGELOG.md` の Unreleased へ概要と該当エントリーを記載する
3. その後に root `package.json` / `package-lock.json` の PATCH を **1 だけ**増やす（worker 版・model 版は変更しない）
4. commit / tag / release は本計画の範囲外とする

現在の製品版は `0.1.0` である（`verify-product-version.mjs` で確認、exit 0）。本計画の作成時点では CHANGELOG 追加・PATCH 更新を行っていない。

---

## 7. 本計画作成時の検証記録

| 検証 | コマンド | 結果 |
|---|---|---|
| 文書整合 | `node scripts/docs/verify-documentation.mjs` | exit 0（必須 Markdown 8件、SVG 5件） |
| 製品版整合 | `node scripts/release/verify-product-version.mjs` | exit 0（`0.1.0`） |
| 作業ツリー | `git status --short` | 出力なし（本書作成前） |

本計画の作成では source、test、依存、lock、証跡 JSON を変更していない。アプリ全体の test suite・build は再実行していないため、既存の PASS 記録を本日の合格として読み替えない。

---

## Wave 2H 実行記録

**対象指示:** 2026-09-21 23:50 JST の「Wave 2Hを実行、DoD確認、90分超過時停止」。この指示による実行範囲はW2-31／W2-32のみであり、上記の計画作成時の未承認表記・他Waveの承認状態を書き換えない。制限時刻は **2026-09-22 01:20 JST**。W0前提は[事実ベースライン](../docs/documentation-fact-baseline.md)のW0-04 PASSと[実装計画§15.10](../docs/implementation-plan.md#1510-ann-0406-ipcとmigration番号の現状確定2026-09-21)を確認した。

### 対象・配線補完・非対象

- W2-31: [JobStatusBar.tsx](../src/renderer/features/jobs/JobStatusBar.tsx)、[対象test](../src/renderer/features/jobs/JobStatusBar.test.tsx)。
- W2-32: [JobPage.tsx](../src/renderer/features/jobs/JobPage.tsx)、[対象test](../src/renderer/features/jobs/JobPage.test.tsx)。
- **表の4 fileだけでは製品画面に到達せず、DoDの「常時表示」を満たさないため、直接必要な配線を補完した。** [AppShell.tsx](../src/renderer/layout/AppShell.tsx)／[対象test](../src/renderer/layout/AppShell.test.tsx)、[ImportPage.tsx](../src/renderer/features/import/ImportPage.tsx)、[global.css](../src/renderer/styles/global.css)を変更。Preloadが同時に保持する購読は1つのため、shellのProject単位providerで購読し、取り込み・状態バー・一覧が同じsnapshotを参照する。汎用event bus・新規依存・IPC変更は追加していない。
- 関連DOCとして[users-guide §14](../docs/users-guide.md#共通ジョブ状態とジョブ一覧wave-2h)に限定操作と検証範囲を追記。
- Wave 2F／2Gの並行作業があることを確認し、共有fileの編集範囲を担当へ通知した。既存のAppShell testのrevisions fixture等を保持し、他Waveの実装を今回の完了実績に含めない。
- 自動再開・自動再試行・scheduler・学習worker・モデル承認は対象外。Gate 2／3、UIR-017、packaged Electron、実worker、Narratorの受入を合格へ変更しない。版は0.1.0のまま、依存／lock／CHANGELOG／commit／tag／releaseを変更しない。

### DoD判定

| ID | 挙動と検証 | 型／editor | 独立敵対的レビュー | 結果 |
|---|---|---|---|---|
| W2-31 | 既存jobs.subscribeで実測progress・現在処理・明示cancelを表示。unknown／0件／未取得を区別。要求応答がRunningなら終了通知まで確認待ち。多重click、Project A→B→A、古い応答、解除、StrictMode、購読失敗を検証。設定／タブ／一覧への移動中も維持し、Importとの購読競合なし | 全体tsc exit 0、変更8 source/test/style fileのeditor diagnostics 0 | `w2h-review`（別code-review担当）blocking 0 | **PASS** |
| W2-32 | Queuedを含む全9状態・3処理種別・ID・日時・実測進捗を作成順で表示。明示cancelと終端履歴を保持し、状態バーへ同期。新規job通知・空／取得中／失敗・Project切替を検証。再開／再試行commandなし | 同上 | `w2h-list-review` blocking 0。ブラウザーで発見したhidden/CSS修正は別担当 `w2h-visibility-review` で追加確認しblocking 0 | **PASS** |

W2-31は対象3 file **134件PASS**、全体tsc exit 0、renderer build exit 0、独立レビュー完了後にW2-32へ進んだ。以下の最終190件と134件を合算しない。

### 最終検証の実コマンド・結果

すべてWindows上の `pwsh.exe -NoLogo -NoProfile` で実行。開始00:52 JSTの最終対象suiteは次のコマンドで実行した。

```powershell
node node_modules\vitest\vitest.mjs run src\renderer\features\jobs\JobStatusBar.test.tsx src\renderer\features\jobs\JobPage.test.tsx src\renderer\layout\AppShell.test.tsx src\renderer\features\import\ImportPage.test.tsx src\preload\job-api.test.ts src\renderer\styles\tokens.test.ts --maxWorkers=1 --testTimeout=15000 --reporter=default --reporter=json --outputFile.json=C:\Users\dahatake\.copilot\session-state\829ae4c5-d0b4-434f-9203-dbc741f73346\files\wave2h-tests.json
```

| 検証対象 | 結果 |
|---|---|
| JobStatusBar.test.tsx | **19 PASS** |
| JobPage.test.tsx | **8 PASS** |
| AppShell.test.tsx | **93 PASS** |
| ImportPage.test.tsx | **23 PASS** |
| job-api.test.ts | **28 PASS** |
| tokens.test.ts | **19 PASS** |
| 上記の同一実行集合 | **6 file／190 PASS、0 failed、exit 0、123.86秒** |
| `node node_modules\typescript\bin\tsc -b tsconfig.main.json tsconfig.renderer.json` | **exit 0**（`npm run typecheck`と同じcompiler／引数） |
| `node node_modules\vite\bin\vite.js build --config vite.renderer.config.ts` | **exit 0**、145 modules、production renderer bundle生成 |
| editor diagnostics（追加4 file＋配線4 file） | **0 errors** |

**途中の失敗も記録する:** 最初の`npm run typecheck`は環境のnpm 11.17.0と要求12.0.xの不一致でexit 1。manifestを緩和せず、インストール済みの同一TypeScript／Vitest／Viteをnodeで直接実行した。途中の全体tscは並行作業のworkspace-validation.test.ts／DeleteProjectDialog.tsxで失敗し、担当へ通知後、最終全体tscがexit 0になった。旧shell testの「購読なし」「footerにbuttonなし」「statusが2件」は新仕様に合わせて更新。並行実行時に既存shell testの5秒timeoutが発生したため、source設定を変更せず対象suiteを1 worker／15秒timeoutで再実行した。未実行の全suiteやMain/Preload buildをPASSとは数えない。

### ブラウザー表示確認（限定技術検証）

Viteをloopback `127.0.0.1:5177` で起動し、ブラウザーの`addInitScript`だけで8件のjobs API fixtureを設定した。製品コードへのtest専用分岐、実Project／DB／workerの変更はない。

| viewport | 本文scroll後のfooter上端／下端 | 横overflow |
|---|---|---|
| 1280×720 | 468／720 px | なし |
| 800×600 | 390／600 px | なし |
| 390×844 | 548.60／844.00 px（丸め誤差内） | なし |

ブラウザーでは、grid指定がUAの`hidden`表示を上書きし、ジョブ一覧と保持中workspaceが同時表示される問題を発見した。`.app-shell__workflow[hidden]`へ明示的な`display:none`を追加し、実CSSを読み込むtestのcomputed styleとブラウザーの可視h1が「ジョブ一覧」1つだけになることを再確認した。待機jobの明示cancelで一覧が`Cancelled`に変わって履歴を残し、状態バーのactive件数が8→7になることも確認。これは実Electron／実workerのE2Eや本人確認の代替ではない。

### 最終化確認

- 2026-09-22 **00:59 JST**までに実装・対象検証・独立レビュー・証拠記録を完了。開始から約69分であり、90分停止条件には未到達。
- `node scripts\docs\verify-documentation.mjs`: **exit 0**（必須Markdown 8／SVG 5）。
- `node --test scripts\docs\verify-documentation.test.mjs`: **22 PASS、0 failed、exit 0**。190件の製品対象suiteとは別集合。
- `node scripts\release\verify-product-version.mjs`: **exit 0**（0.1.0）。
- `git diff --check`: **exit 0**。
- このセッションで起動したVite検証serverを停止。session内のJSONテスト証拠は保持し、repoに一時fixture／test専用製品分岐を残していない。
- **Wave 2H完了済みID: W2-31、W2-32。未着手ID: なし。** 他Waveの進捗・完了判定はそれぞれの担当範囲であり、本記録では判定しない。

---

## Wave 4 実行記録

**対象指示:** 2026-09-22 11:05 JST の「Wave 4 を実行、DoD を必ず確認、エラー・停止時は完了済みIDと未着手IDを報告して停止」。この指示による実行範囲は **W4-01〜W4-06** のみで、計画作成時の未承認表記や他 Wave の承認状態は書き換えない。

**着手時点の前提:**

- Gate 3 は [実装計画 §15.12](../docs/implementation-plan.md) で **PASS** と記録済み（W3-03〜W3-07 の E2E は 13 passed / 0 failed / 1 skipped）。W4-01〜W4-05 の依存は満たされている。
- **W3-08（実機受入）は利用者判断でスキップされ未実施**（[敵対的レビュー §7.5](20260922-0840-AdversarialReview.md)）。W4-02 はこれに依存するため、OS 標準 picker の実機確認・OS 再起動後の Reference アクセスは**実測済みとして書かない**。
- 着手時、§6〜§9 と冒頭の章状態表は直前セッションで実測手順へ置換済みだった（現在は commit `cbfcacb` に含まれる）。本記録はその上で残っていた W4-05 と、§8／§9 に残っていた矛盾記述を処理した結果である。

### 実施内容と DoD 判定

| ID | 実施内容 | 検証 | 結果 |
|---|---|---|---|
| W4-01 | §6 の手順（作成・一覧・削除）が実画面の文言と一致するかを検証。`Project を作成`／`親フォルダーを選択`／`選択した親の中にUUIDの専用フォルダーを作成します。`／`作成結果を確認できません。一覧で状態を確認してください。`／`削除対象を確認`／`上記の所有データを削除することを確認しました。`／`Reference で取り込んだ元ファイルは削除・変更しません。` 等を source で実在確認。未実装の「最新Run状態／選択モデル／使用容量」は**未取得**として表記済みで、手順化していない | 引用文言の source 実在確認、`verify-documentation.mjs` exit 0 | **PASS**（変更不要） |
| W4-02 | §7 の Copy／Reference・権利確認・形式・relink 手順を検証。`画像を取り込む`／`データ形式（必須）`／`取り込み方法（必須）`／`データを選択して検査`／`検査を破棄してやり直す`／`取り込み結果が不明です。状態を再確認してください。`／`参照元（Reference）の確認`／`参照元を選び直す`／`選んだファイルは元の内容と一致しません` を実在確認 | 同上 | **条件付き PASS**。容量不足の表示は E2E で誘発できず **未実測**であることを §7.4 に明示。W3-08 依存の実機確認は §7 の「最終化条件」に未実施として保持 |
| W4-03 | §8 に残っていた「現在は実行できず…操作手順を示しません」という旧記述と、evidence 欄の全行「未検証」を、追加済みの実測手順と矛盾しない実状態へ是正。§8 の「一括適用とクラス分布」は「実装されているが未実測」→ **「部品は存在するが画面へ未接続で操作できない」** へ訂正（`ClassificationBulkBar` / `ClassDistribution` / `LabelPicker` は test 以外から import されていないことを確認）。除外・undo/redo を実画面の `除外理由`／`元に戻す`／`やり直す` に合わせて補記 | 参照解析（product source からの import 有無）、文言の source 実在確認 | **PASS** |
| W4-04 | §9 も同様に是正。加えて署名前ビルドで検出キャンバスを実測し、`表示倍率 875% ／ 表示位置 X 345, Y 0` 形式の表示、`拡大`／`縮小`／`全体表示`、矢印キーの移動、`＋`／`−` の拡大縮小、ドラッグでの矩形作成、微小ドラッグで作成されないこと、`領域 N（X …, Y …, 幅 …, 高さ …）` と領域ごとのクラス変更を確認。**キャンバス上のハンドル移動・サイズ変更・× 削除は Konva 描画のため未実測**である旨を本文と evidence 欄に明記。矩形の複製・すべて選択・重複警告（`RectangleCommands`）も**未接続**へ訂正 | 署名前ビルドの実起動、文言の source 実在確認 | **PASS** |
| W4-05 | §10 の「主な操作（実装完了後に手順を記載予定）」を、`LabelSchemaPage` の実画面手順へ置換。ラベル定義画面の開き方、Label Schema 作成、クラス追加（名前・モデル別名・色・説明・例）、重複名の拒否、クラス編集、作業指示の保存、クラス統合、クラス削除（確認ダイアログ）、削除されたクラスの下書き保持を記載。未到達の `CLASS_USED`／`HISTORY_REFERENCE`／`LOCKED` 表示は**未実測**として分離 | 署名前ビルドの実起動で全手順を再現 | **PASS** |
| W4-06 | 冒頭「章ごとの状態」の §10 を `検証待ち／要求反映済み` → `実装済み／実測済み` へ同期し、注記を §6〜§10 の実測範囲（署名前ビルド）へ更新。凡例の `実測済み` に、現在の実測が署名前ビルドであることを明記。**§1〜§5・§11〜§16 の表示は変更していない** | `verify-documentation.mjs` exit 0、相対リンク 17 件の実在確認 | **PASS** |

### 実測（署名前ビルド）の方法と結果

`npm run build` 済みの `dist/`（2026-09-22 10:35 生成）に対し、既存 E2E harness（`--user-data-dir` による隔離プロファイル）で Electron を実起動した。**製品コードへの test 専用分岐は追加していない。** 使用した 2 本の probe spec は計測専用の一時 file であり、**実行後に削除し、リポジトリへ残していない**（`tests/e2e/` 配下に残存なし）。

ラベル定義画面（§10）の実測結果:

| 操作 | 実際の表示 |
|---|---|
| 画面を開く | 見出し「ラベル定義」、「Project: 〈名前〉 ／ タスク: 画像分類」、状態「保存内容を確認しました。」 |
| ラベル定義を作成 → クラス追加 | 状態「保存済み」、クラス編集欄が追加される |
| 正規化後に重複する名前を追加 | 「同じ名前のクラスがあります。全角・半角、前後の空白、大文字・小文字を区別しません。」で**追加されない** |
| クラス名の変更 → クラスを保存 | 状態「保存済み」、見出しが新しい名前になる |
| 指示文を保存 | 状態「保存済み」 |
| クラス統合 | 注記「統合元を統合先へまとめます。自動で統合されることはありません。」、統合元が一覧から消える |
| クラス削除 | ダイアログ「クラス削除の確認」／「このクラスを削除しますか？このクラスの未保存の変更も破棄されます。」→ 削除される |
| 未保存入力がある状態 | 状態行に「／ 未保存の変更があります。」が付き、戻るボタンが「未保存の変更を保持して戻る」になる |

検出キャンバス（§9）の実測結果:

| 操作 | 実際の表示・挙動 |
|---|---|
| 初期表示／拡大／縮小／全体表示 | 「表示倍率 875% ／ 表示位置 X 345, Y 0」→ 拡大で 1094%／X 275, Y -52 → 縮小で 875% に復帰 |
| 画像表示領域での矢印キー・＋／− | 表示位置 X 345 → 297、＋で 1094%、−で 875% |
| ドラッグでの矩形作成 | 「領域 2（X 25, Y 19, 幅 21, 高さ 12）」が追加される |
| 微小ドラッグ | 領域が**作成されない**（件数は 2 のまま） |
| 領域ごとのクラス変更 | 「領域 N のクラス」の選択肢に Schema のクラス（`bolt` / `nut`）が並ぶ |
| 作業指示が未設定の場合 | 「この Project の作業指示はまだ設定されていません（Label Schema 画面で設定できます）。」 |

### 検証コマンドと結果

すべて Windows 上の `pwsh.exe -NoLogo -NoProfile` で実行。

| 実行 | 結果 |
|---|---|
| `node node_modules\@playwright\test\cli.js test tests/e2e/zz-label-schema-probe.spec.ts`（一時 probe） | **1 passed**、残存 Electron process 0 |
| `node node_modules\@playwright\test\cli.js test tests/e2e/zz-detection-probe.spec.ts`（一時 probe） | **1 passed**、残存 Electron process 0 |
| `node scripts\docs\verify-documentation.mjs` | **exit 0**（必須 Markdown 8／SVG 5） |
| `node --test scripts\docs\verify-documentation.test.mjs` | **22 passed／0 failed、exit 0** |
| `node scripts\release\verify-product-version.mjs` | **exit 0**（0.1.0） |
| users-guide 内の相対リンク 17 件の実在確認 | **全件 OK** |
| 引用した画面文言（42 件）の product source 実在確認 | **全件 OK** |

### 本記録で合格へ変更していないもの

- **W3-08（実機受入）は未実施のまま。** 署名済み package・OS 標準 picker・OS 再起動後の Reference アクセスを実測済みとして記載していない。SPI-19 の PASS へ読み替えていない。
- 取り込み時の容量不足表示は未実測（§7.4 に明示）。
- Gate 2／Gate 4／Gate 5 配下の機能（補助候補・学習実行・レポート・カメラ推論）は未実装のままで、§11〜§15 は据え置き。
- 版は 0.1.0 のまま。依存／lock／CHANGELOG／commit／tag／release を変更していない（Q-09 の既存規約を維持）。変更 file は [`docs/users-guide.md`](../docs/users-guide.md) と本記録のみ。

- **Wave 4 完了済み ID: W4-01、W4-02（条件付き。容量不足表示は未実測）、W4-03、W4-04、W4-05、W4-06。未着手 ID: なし。** 他 Wave の進捗・完了判定は本記録では行わない。

---

## Gate 2 lane 実行記録

**対象指示:** 2026-09-22 11:42 JST の「`### Gate 2 lane` のタスクを実行、DoD を必ず確認、エラー・停止時は完了済み ID と未着手 ID を報告して停止」。実行範囲は **G2-01〜G2-09** のみで、他 Wave の承認状態・完了判定を書き換えない。

**着手時点の前提:** `G2-01`〜`G2-04` の出力 file（`docs/model-governance/*.md`）は 2026-09-03 の監査で既に存在し、4 役すべてが `HOLD`（CLIP のみ `REJECT`）だった。`G2-05` 以降の `spikes/models/` は存在しなかった。

### 実施内容と DoD 判定

| ID | 実施内容 | DoD 判定 |
|---|---|---|
| G2-01 | [`classification-base.md`](../docs/model-governance/classification-base.md) が license／学習データ由来／再配布／intended use／checkpoint hash を一次資料 URL（取得日 2026-09-03）付きで判定し、`HOLD` を保持していることを確認。新規測定なし | **PASS（HOLD 保持）** |
| G2-02 | [`detection-base.md`](../docs/model-governance/detection-base.md) を同様に確認 | **PASS（HOLD 保持）** |
| G2-03 | [`classification-assist.md`](../docs/model-governance/classification-assist.md) を同様に確認。SigLIP `HOLD`、OpenAI CLIP `REJECT` | **PASS（HOLD／REJECT 保持）** |
| G2-04 | [`detection-assist.md`](../docs/model-governance/detection-assist.md) を同様に確認。3 候補とも `HOLD` | **PASS（HOLD 保持）** |
| G2-05 | [`classification.py`](../spikes/models/classification.py) を新規作成し、beans fixture（MIT）で train → ONNX → CPU 推論差を実測。logit 最大差 `1.5497e-06`（許容 `1.0e-04`）、確率最大差 `5.9605e-07`（許容 `1.0e-05`）、top-1 一致 15/15。結果は [`classification-result.md`](../spikes/models/classification-result.md) | **PASS** |
| G2-06 | [`detection.py`](../spikes/models/detection.py) を新規作成し、gwhd-2021 fixture（CC BY 4.0）で box／score／label と AP@0.5 差を実測。結果は [`detection-result.md`](../spikes/models/detection-result.md) | **FAIL（実測記録は完了）**。IoU 対応付けした 595 件は box 差 `3.0518e-05`・score 差 `5.9605e-08` で一致するが、検出集合が一致しない（torch のみ 27 件／ONNX のみ 32 件、件数一致 1/5）。2 回実行で再現 |
| G2-07 | [`assist_benchmark.py`](../spikes/models/assist_benchmark.py) を新規作成。manifest を実読みする fail-closed gate が `BLOCKED`（exit 2）。harness 自己検証は `PASS`（exit 0）。結果は [`assist-result.md`](../spikes/models/assist-result.md) | **未達（NOT_RUN）**。承認済み C7 が 0 件で補助あり session を記録できない。実測欄は空のまま |
| G2-08 | Windows 実機で Optuna mini-run（8 trial）を実測し、[実装計画](../docs/implementation-plan.md) の D-15 行へ記録 | **条件付き PASS**。分類・CPU・実測 fixture 条件に限り「最大 Trial 数 20」「最大時間 180 秒」を確定。**検出・CUDA/DirectML・実データ規模は未決定（未測定）** |
| G2-09 | [ADR-0004](../docs/adr/0004-spike-decisions.md) §1 追補・§5.1 新設・§9 参照証拠を更新。[`manifest.json`](../resources/models/manifest.json) は **未編集** | **PASS（BLOCKED 判定・空 manifest 保持）**。4 役すべて未承認のため `ready=true` にしない |

### 実測環境と実行コマンド

Windows `10.0.29671` / `AMD64`、CPython `3.14.7`、torch `2.11.0+cpu`、torchvision `0.26.0+cpu`、onnx `1.22.0`、onnxruntime `1.24.4`、optuna `4.9.0`、`CPUExecutionProvider`、torch thread `1`。

```powershell
ml\.venv\Scripts\python.exe spikes\models\classification.py --mode parity --artifact-dir <repo 外>   # exit 0
ml\.venv\Scripts\python.exe spikes\models\detection.py --artifact-dir <repo 外>                      # exit 1（FAIL）
ml\.venv\Scripts\python.exe spikes\models\assist_benchmark.py --self-test                            # exit 0
ml\.venv\Scripts\python.exe spikes\models\assist_benchmark.py                                        # exit 2（BLOCKED）
ml\.venv\Scripts\python.exe spikes\models\classification.py --mode automl-mini-run                   # exit 0
```

| 検証 | 結果 |
|---|---|
| `ruff check` / `ruff format --check`（`spikes\models`） | **exit 0** / **exit 0** |
| `node scripts\docs\verify-documentation.mjs` | **exit 0**（必須 Markdown 8／SVG 5） |
| `node scripts\release\verify-product-version.mjs` | **exit 0**（0.1.0） |
| `node --test scripts\models\manifest-schema.test.mjs` | **35 passed／0 failed、exit 0** |
| `git diff --check` | **exit 0** |
| `resources/models/manifest.json` の SHA-256（実行前後） | `7fe41f5bc497d48ffcbbaebaeb5cb02e91dfba0e1a6fe9b66d8cf8928c437a61` で**不変** |

### 途中の失敗も記録する

- 検出学習は batch 2 のとき端数 batch 1 件で BatchNorm が `Expected more than 1 value per channel when training` により失敗した。学習 15 枚を割り切る batch 3 へ変更し、2 件未満の batch で中止する guard を入れた。初回失敗を成功へ置換していない。
- 独立敵対的レビュー（`g2-review`）で blocking 1 件・non-blocking 5 件を受領し、全件反映した。主なものは、D-15 の最大時間 `600` 秒が未測定の外挿で正当化されていた点（実測で押さえられる `180` 秒へ訂正し、CUDA/DirectML・実データ規模を未決定として明記）と、`average_precision` が VOC 補間になっていなかった点（訂正後 AP を再実測。PASS/FAIL は不変）。詳細は ADR-0004 §5.1.4。

### 本記録で合格へ変更していないもの

- **Gate 2 は BLOCKED のまま。** 承認済み model は 0 件で、`resources/models/manifest.json` は `releaseStatus.ready=false` / `models: []` のまま未編集。`AST` / `TRN` / `REP` / `INF` の実装は開始していない。
- Gate 1 部の `CONDITIONAL_GO`、`SPI-03` / `SPI-09` / `SPI-19` の `SKIPPED_BY_USER`、Gate 3 の判定、UIR-017 の本人確認をいずれも変更していない。
- 事前学習 checkpoint を download／load／同梱していない。parity の実測はすべて random 初期化であり、**承認済み weight での parity ではない**。
- 版は 0.1.0 のまま。依存／lock（`ml/pyproject.toml`、`ml/uv.lock`、`package-lock.json`）／CHANGELOG／commit／tag／release を変更していない。生成した ONNX は repository 外へ出力し、commit していない。
- 変更 file は `docs/adr/0004-spike-decisions.md`、`docs/implementation-plan.md`（D-15 行のみ）、新規 `spikes/models/`（6 file）、および本記録のみ。

- **Gate 2 lane 完了済み ID: G2-01、G2-02、G2-03、G2-04、G2-05、G2-06（実測完了・判定 FAIL）、G2-08（条件付き）、G2-09。DoD 未達 ID: G2-07（承認済み C7 が 0 件のため実測不能。NOT_RUN として記録）。未着手 ID: なし。** 他 Wave の進捗・完了判定は本記録では行わない。

> 本節は 1 回目実行（2026-09-22 11:42）時点の事実として保持する。`G2-01` / `G2-02` / `G2-03` / `G2-04` / `G2-06` / `G2-07` / `G2-08` の判定は、同日の利用者指示による 2 回目実行（[`20260922-1340-Gate2LaneAdoption.md`](20260922-1340-Gate2LaneAdoption.md)）で更新されている。現在の確定状態は下記「Gate 2 lane 再検証記録」を参照すること。

---

## Gate 2 lane 再検証記録（2026-09-22 23:00 JST・3 回目）

**対象指示:** 2026-09-22 23:01 JST の「`### Gate 2 lane` のタスクを実行、DoD を必ず確認、エラー・停止時は完了済み ID と未着手 ID を報告して停止」。実行範囲は **G2-01〜G2-09** のみで、他 Wave の承認状態・完了判定を書き換えない。

**着手時点の前提:** 1 回目（11:42）と 2 回目（13:40）の成果物が未 commit の作業ツリーに存在した。本実行は**新しい判定を作らず**、各 DoD を成果物と再実行で照合した。`resources/models/manifest.json` は未編集のままである。

### DoD 照合結果

| ID | DoD の要点 | 照合に用いた実在物・再実行 | 判定 |
|---|---|---|---|
| G2-01 | 候補の license／学習データ由来／再配布可否／intended use／checkpoint hash を一次資料 URL と取得日付きで判定。不明が残れば `HOLD` 保持 | [`classification-base.md`](../docs/model-governance/classification-base.md) §12（候補 8 件・取得日 2026-09-22）、§12.6 の未確認 9 項目、§12.7 の判定 | **PASS（`HOLD` 保持・承認 0 件）** |
| G2-02 | 同上 | [`detection-base.md`](../docs/model-governance/detection-base.md) §14（controlled retrieval・実測 SHA-256）、§15（利用者の risk acceptance）、§15.5 | **PASS（権利 gate は利用者決定で充足扱い、技術 gate は parity 未実施のため manifest 未登録）** |
| G2-03 | 同上 | [`classification-assist.md`](../docs/model-governance/classification-assist.md) §18（SigLIP の hash 一致・safetensors header 解析） | **PASS（`HOLD` 保持・承認 0 件）** |
| G2-04 | 同上 | [`detection-assist.md`](../docs/model-governance/detection-assist.md) §18（Florence-2／Grounding DINO 2 件） | **PASS（`HOLD` 保持・承認 0 件）** |
| G2-05 | 権利確認済み fixture で train → ONNX → CPU 推論の出力差を実測記録 | `classification.py --mode parity` を**再実行（exit 0）**。logit 最大差 `1.5497e-06`、確率最大差 `5.9605e-07`、top-1 一致 `15/15` が [`classification-result.md`](../spikes/models/classification-result.md) の記録値と一致 | **PASS（再現確認）** |
| G2-06 | box／score／label と mAP 差を実測記録 | `detection.py` を**再実行（exit 0）**。既定 60 epoch で未対応検出 `0 / 0`、IoU 対応付け box 差 `3.0518e-05`、label 不一致 `0` を確認。[`detection-result.md`](../spikes/models/detection-result.md) §7.4 の epoch 掃引記録と一致 | **PASS（再現確認。1 回目の FAIL は原因特定済みで解消）** |
| G2-07 | gold set で coverage／accept／edit／reject／所要時間を手作業のみと比較し実測記録 | `assist_benchmark.py --self-test`（**exit 0 / `PASS`**）と `assist_benchmark.py`（**exit 2 / `BLOCKED`**）を再実行。manifest を実読みする fail-closed gate が承認済み C7 **0 件**で停止することを確認 | **未達。段階 1〜2 は実装・検証済み、段階 3 は `SKIPPED_BY_USER`（利用者指示）。`PASS` へ読み替えない** |
| G2-08 | Windows 実機 mini-run に基づく有限の最大 Trial 数・最大時間を記録。測定前の数値を置かない | `classification.py --mode automl-mini-run` を**再実行（exit 0）**。1 trial 最大 `4.353` 秒（記録の CPU 実測最大 `7.768` 秒以内）。[実装計画](../docs/implementation-plan.md) D-15 に分類 CPU `180` 秒／CUDA `120` 秒・最大 Trial 数 `20` を記録済み | **条件付き PASS（分類のみ。検出・実データ規模は未決定のまま）** |
| G2-09 | 4 役すべて承認時のみ `ready=true`。1 役でも未承認なら `BLOCKED` を保持し空 manifest のまま | [`manifest.json`](../resources/models/manifest.json) の SHA-256 が `7fe41f5b…c437a61` で**不変**、`ready=false` / `models: []`。[ADR-0004](../docs/adr/0004-spike-decisions.md) §5.1 が 2 回目実測へ同期済み | **PASS（`BLOCKED` 保持・空 manifest 維持）** |

### 本実行で行った検証（すべて再実行）

実行環境: Windows `10.0.29671` / `AMD64`、CPython `3.14.7`、torch `2.11.0+cpu`、onnx `1.22.0`、onnxruntime `1.24.4`、optuna `4.9.0`。

| 検証 | 結果 |
|---|---|
| `spikes\models\detection.py --artifact-dir <repo 外>` | **exit 0**（未対応検出 `0 / 0`） |
| `spikes\models\classification.py --mode parity --artifact-dir <repo 外>` | **exit 0** |
| `spikes\models\assist_benchmark.py --self-test` | **exit 0（`PASS`）** |
| `spikes\models\assist_benchmark.py` | **exit 2（`BLOCKED`・想定どおり）** |
| `spikes\models\classification.py --mode automl-mini-run` | **exit 0** |
| `ruff check` / `ruff format --check`（`spikes\models`） | **exit 0** / **exit 0**（6 file） |
| `node scripts\docs\verify-documentation.mjs` | **exit 0**（必須 Markdown 8／SVG 5） |
| `node scripts\release\verify-product-version.mjs` | **exit 0**（0.1.1） |
| `node --test scripts\models\manifest-schema.test.mjs` | **35 passed／0 failed、exit 0** |
| `git diff --check` | **exit 0** |
| `resources/models/manifest.json` の SHA-256 | `7fe41f5bc497d48ffcbbaebaeb5cb02e91dfba0e1a6fe9b66d8cf8928c437a61`（**不変**） |

### 本実行で変更していないもの

- **Gate 2 は BLOCKED のまま。** 承認済み model は 0 件で、`manifest.json` は未編集。`AST` / `TRN` / `REP` / `INF` の実装は開始していない。
- `G2-07` の `SKIPPED_BY_USER` を合格へ読み替えていない。NFR-ANN-006 は出荷条件のまま未充足である。
- Gate 1 部の `CONDITIONAL_GO`、`SPI-03` / `SPI-09` / `SPI-19` の `SKIPPED_BY_USER`、Gate 3 の判定、UIR-017 の本人確認、他 Wave の完了判定。
- 版（0.1.1）・依存・lock・CHANGELOG・commit／tag／release。生成した ONNX は repository 外へ出力し commit していない。
- 本実行で新規に変更した file は**本記録のみ**である。

- **Gate 2 lane 完了済み（DoD 充足）ID: G2-01、G2-02、G2-03、G2-04、G2-05、G2-06、G2-08（条件付き。分類のみ）、G2-09。DoD 未達 ID: G2-07（承認済み C7 が 0 件、かつ段階 3 が利用者指示により `SKIPPED_BY_USER`）。未着手 ID: なし。** 他 Wave の進捗・完了判定は本記録では行わない。

---

## Gate 2 lane 追加作業 — DP-01 / DP-04 の parity 実測（2026-09-22 23:30 JST）

**対象指示:** 「DoD 未達タスクについて、利用者が取るべきアクションと必要な情報を説明し、一緒に完了させる」。説明にあたり残存 blocker を精査した結果、**利用者の入力を一切必要としない項目が 1 つ**あることを確認したため、それを実行した。

### 実行した理由

- 実行環境の onnxruntime `1.24.4` に **`DmlExecutionProvider` が利用可能**であること、`vendor/models/`（Git 追跡外）に SSDLite の実 checkpoint（SHA-256 `a79551df…d65d2`、`14,069,355` byte）が残っていることを確認した。
- [`detection-base.md`](../docs/model-governance/detection-base.md) §15.4 が挙げる manifest 登録の阻害要因 3 点のうち、**`support[]` の parity 実測（DP-01 / DP-04）だけは権利判断も利用者提示も不要**である。残る 2 点（採用記録・NOTICE 文案、license 識別子・承認者氏名）は利用者からの提示を要する。

### 実測結果

新規 spike [`detection_checkpoint_parity.py`](../spikes/models/detection_checkpoint_parity.py) を作成し、hash gate → `weights_only=True` load → ONNX export（opset 17）→ 3 backend 比較を実施した。

| 比較 | ID | 対応付け | 片側のみ検出 | label 不一致 | box 最大差 | score 最大差 | 判定 |
|---|---|---:|---:|---:|---:|---:|---|
| torch ↔ ORT CPU | DP-01 | 294 | 0 / 0 | 0 | `9.9182e-05` | `6.0350e-07` | **PASS** |
| torch ↔ ORT DirectML | DP-04 | 294 | 0 / 0 | 0 | `1.3733e-04` | `6.4075e-07` | **PASS** |
| ORT CPU ↔ ORT DirectML | DP-04 | 294 | 0 / 0 | 0 | `1.4496e-04` | `6.1840e-07` | **PASS** |

許容差（box `1.0e-03` / score `1.0e-04`）は SPI-16 と同値を**実行前に固定**しており、結果に合わせて緩めていない。2 回実行で ONNX SHA-256 `6e62517b…e99d9` を含む全指標が一致した。詳細は [`detection-checkpoint-parity-result.md`](../spikes/models/detection-checkpoint-parity-result.md)。

### この実測が意味しないこと

- **承認ではない。** manifest は未編集（SHA-256 `7fe41f5b…c437a61` で不変）、Gate 2 は **BLOCKED** のままである。
- **精度の主張ではない。** fixture は gwhd-2021 であり COCO checkpoint にとって out-of-domain である。
- DirectML session は CPU fallback を含みうるため、全 node の GPU 実行を主張しない。
- YOLOX-Nano の parity、製品後処理を固定した parity（DP-03）、性能実測（POC-16）は未実施である。

### 利用者からの提示が必要な残件

| 対象 | 必要な提示物 | これが無いとどうなるか |
|---|---|---|
| C6 検出の manifest 登録 | `licenses.checkpoint.spdx` の識別子、`noticeText` 本文、**承認者氏名**、承認日 | schema が `unknown` 等を拒否するため entry を書けない |
| C6 分類（G2-01） | risk acceptance の可否、または候補の指定 | 候補 8 件すべてで「checkpoint license 明示」と「学習データ商用可」が両立しない |
| C7 分類・検出（G2-03 / G2-04） | 同上 | 承認済み C7 が 0 件のままで G2-07 を実施できない |
| G2-07 段階 3 | gold set の定義と、補助あり／手作業のみの実作業 session（JSON Lines 2 本、同一 item 集合） | `SKIPPED_BY_USER` のまま。NFR-ANN-006 は未充足 |
| G2-08 の検出 budget | 検出学習を spike で暫定測定してよいかの許可（Gate 4 の前倒し判断） | 学習 1 回分の費用を測れず未決定のまま |

### 検証

| 検証 | 結果 |
|---|---|
| `detection_checkpoint_parity.py`（2 回） | **exit 0** / **exit 0** |
| `ruff check` / `ruff format --check`（`spikes\models`） | **exit 0** / **exit 0**（7 file） |
| `node scripts\docs\verify-documentation.mjs` | **exit 0** |
| `node scripts\release\verify-product-version.mjs` | **exit 0**（0.1.1） |
| `node --test scripts\models\manifest-schema.test.mjs` | **35 passed／0 failed** |
| `git diff --check` | **exit 0** |
| `resources/models/manifest.json` の SHA-256 | **不変** |

- **本追加作業の完了 ID: なし（新しい G2 task を作っていない）。解消した blocker: SSDLite の DP-01 / DP-04。DoD 未達のまま残る ID: G2-07。条件付きのまま残る ID: G2-08。** Gate 2 の判定は **BLOCKED** から変更していない。

---

## Gate 2 lane 追加作業 2 — 利用者指示による採用処理（2026-09-23 00:30 JST）

**対象指示:** 2026-09-22 23:33 JST の「(1) C7 にも risk acceptance を出す、(2) 検出 budget の暫定測定を許可、(3) `licenses.checkpoint.spdx` の識別子はアプリケーション名 / `noticeText` は用途に相応しいものを作成 / 承認者氏名は **dahatake**。以上で全ての残タスクを実行。不明点は選択肢とデフォルトを提示」。

### 提示した不明点とデフォルト（デフォルトで実行した）

| ID | 不明点 | デフォルト | 理由 |
|---|---|---|---|
| Q-11 | checkpoint license 識別子の具体値 | `LicenseRef-AutoVisionStudio` | SPDX で一覧に無い license を表す正式構文は `LicenseRef-[idstring]`。製品名をそのまま書くと SPDX として解釈できず SBOM 生成が壊れる |
| Q-12 | C7 を manifest 登録できるか | 登録しない（権利 gate 充足のみ記録） | parity 未実測のまま `verified: true` は捏造。Florence-2 は custom code 実行が DA-B05 未通過、Grounding DINO は構造定義コード不在。SigLIP だけ解決しても 4 役に届かない |
| Q-13 | C6 分類（G2-01）の扱い | 未登録のまま | risk acceptance の指示対象に C6 分類が含まれない。候補は checkpoint 未取得で技術 gate も未充足 |
| Q-14 | G2-07 段階 3 | `SKIPPED_BY_USER` 維持 | session の生成は捏造。C7 entry が無い限り harness は fail-closed で停止する |
| Q-15 | 検出 budget の測定条件 | このPC の CPU で mini-run | 許可は「このPCで測定」。CUDA は repository 外の隔離環境の再構築が必要 |
| Q-16 | NOTICE の構成 | C5 / C6 / C8 を分離 | `dependency-policy.md` §6.1 と DB-N1 が 3 層の分離を要求 |

### 実施内容

| 項目 | 結果 |
|---|---|
| 利用者決定の一次証拠 | [`evidence/2026-09-22-owner-risk-acceptance.md`](../docs/model-governance/evidence/2026-09-22-owner-risk-acceptance.md) を新規作成（SHA-256 `baa0b97f…16c402`）。決定者 **dahatake**、決定日 2026-09-22 |
| 一次資料の保存 copy | TorchVision `v0.26.0` LICENSE、COCO Terms of Use、torchvision SSDLite model doc の 3 件を `docs/model-governance/evidence/` へ保存し SHA-256 を記録 |
| 採用記録 | [`ssdlite320-mobilenet-v3-large-coco-v1-adoption.md`](../docs/model-governance/ssdlite320-mobilenet-v3-large-coco-v1-adoption.md) を template に従って新規作成。**承認者 dahatake / 承認日 2026-09-22**。NOTICE 文案は C5（BSD-3-Clause）/ C6（`LicenseRef-AutoVisionStudio`）/ C8（COCO 帰属）を分離 |
| manifest 登録 | `ssdlite320-mobilenet-v3-large-coco-v1`（C6 検出）を **1 件登録**。`releaseStatus.ready` は **`false` 維持**、`reason` を部分承認の内容へ更新 |
| C7 の権利 gate | [`classification-assist.md` §19](../docs/model-governance/classification-assist.md) / [`detection-assist.md` §19](../docs/model-governance/detection-assist.md) へ risk acceptance を記録。**manifest entry は作成しない**（parity 未実測・採用記録未作成・Florence-2 は security gate 未通過） |
| 検出 AutoML budget | `detection.py --mode automl-mini-run` を新設し 2 回実測。1 trial 最大 `14.529` / `19.479` 秒。**D-15 へ「検出・CPU：最大 Trial 数 20 / 最大時間 420 秒」を記録**。loss は 8 trial とも 2 回同値で探索は決定的 |
| G2-07 | manifest 更新後に gate を再実行。**`BLOCKED`（exit 2）のまま**。`model_entry_count=1`、承認済み C7 `0 / 0` |
| 回帰 test | `manifest-schema.test.mjs` を **36 件**へ更新（空 manifest 前提の test を部分承認 set の検証へ置換し、`evidence[]` の実在と SHA-256 一致を検証する test を追加）。全件 PASS |

### 途中の失敗も記録する

- 検出 mini-run の初回は `batch_size=2` が選ばれた際に「学習 15 枚 ÷ 2 = 端数 1」で BatchNorm が失敗し **exit 1** となった。端数 1 を生む batch size を実行時に除外する実装へ修正して再実行した。初回失敗を成功へ置換していない。
- `resources/models/manifest.json` の初版案は JSON の末尾カンマで parse に失敗した。修正後に配置した。

### 本作業で合格へ変更していないもの

- **Gate 2 は BLOCKED のまま。** 4 役のうち承認は C6 検出 1 役のみで、`releaseStatus.ready=false`。`AST` / `TRN` / `REP` / `INF` の実装は開始していない。
- `G2-07` は **NOT_RUN**。段階 3 の `SKIPPED_BY_USER` を `PASS` へ読み替えていない。NFR-ANN-006 は出荷条件として未充足。
- 権利 gate の充足は **利用者の risk acceptance** であり、publisher の license 表明・COCO の image-by-image 権利・外部法務の書面判断はいずれも存在しない。一次資料の引用・hash・取得日は書き換えていない。
- 版は 0.1.1 のまま（未リリースの Unreleased へ追記）。`ml/pyproject.toml`・`ml/uv.lock`・`package-lock.json` の依存内容は変更していない。

### 検証

| 検証 | 結果 |
|---|---|
| `detection.py --mode automl-mini-run`（2 回） | **exit 0** / **exit 0** |
| `assist_benchmark.py --self-test` / `assist_benchmark.py` | **exit 0（PASS）** / **exit 2（BLOCKED）** |
| `ruff check` / `ruff format --check`（`spikes\models`） | **exit 0** / **exit 0** |
| `node --test scripts\models\manifest-schema.test.mjs` | **36 passed／0 failed** |
| `node scripts\docs\verify-documentation.mjs` | **exit 0** |
| `node scripts\release\verify-product-version.mjs` | **exit 0**（0.1.1） |
| `git diff --check` | **exit 0** |

- **Gate 2 lane の現在状態: 完了（DoD 充足）ID: G2-01、G2-02、G2-03、G2-04、G2-05、G2-06、G2-08（分類 CPU/CUDA・検出 CPU を確定。検出 CUDA と実データ規模は未決定）、G2-09（部分承認 1 件を登録し `BLOCKED` を保持）。DoD 未達 ID: G2-07（承認済み C7 が 0 件、段階 3 は `SKIPPED_BY_USER`）。未着手 ID: なし。**

> **2026-09-23 追記:** 本 lane の全作業について独立敵対的レビューを実施し、**blocking 2 件・non-blocking 4 件を全件反映**した。反映内容と再検証結果は [`20260923-0025-Gate2LaneFinalization.md`](20260923-0025-Gate2LaneFinalization.md) §4 に記録する。版は **0.1.2** へ更新した。ID 別の判定は本行から変更していない。
