# Wave 3 ／ B-1〜B-3 対策 敵対的レビュー記録

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書（レビュー記録） |
| 作成日時 | 2026-09-22 08:40 |
| レビュー対象 | Wave 3（W3-01〜W3-09）と B-1／B-2／B-3 対策の全成果物 |
| レビュー立場 | 敵対的レビュアー（作成者ではない） |
| 対象 HEAD | worktree 未コミット（`git status` の変更一式） |

> 本書は一時作業文書である。正本は [`docs/implementation-plan.md`](../docs/implementation-plan.md) §15.11／§15.12。

---

## 1. 指摘一覧

| No. | 軸 | 重大度 | 指摘箇所 | 問題の説明 | 修正案 |
|-----|-----|--------|---------|-----------|--------|
| 1 | 内容の妥当性 | **Critical** | `AnnotationWorkspacePage.tsx` `openConfirmDialog()` の `provenance: summary.byCode` | `byCode` は `validateAnnotationWorkspace` が返す**検証エラーコードの度数分布**（`unconfirmed` 等）であり provenance ではない。`ConfirmDatasetDialog` はこれを見出し「provenance 内訳」の下に描画するため、**確定ダイアログが誤情報を表示**する。同 component の既存 test は `provenance: { manual: 2, 'import-unmodified': 1 }` を期待しており、意図された語彙は `annotation_provenance.kind` である | Revision 検証 IPC に provenance kind の実集計を追加し、それを渡す |
| 2 | 目的適合性 | **Critical** | `docs/implementation-plan.md` §15.12 ④「確定ダイアログが件数・provenance 内訳・未処理候補を表示」 | No.1 のとおり provenance は表示されていない。**未達の DoD を合格として記録**している | No.1 修正後に記述を正しくするか、未達なら未達と記録する |
| 3 | 内容の妥当性 | **Critical** | `AnnotationWorkspacePage.tsx` item 詳細取得 `useEffect` | `selectedId` 変更時に `detail` を clear せず fetch する。取得が遅いと **gallery では B を選択済みなのにエディターは A を表示**し、その状態で「確認済みにする」を押すと **A が Ground Truth として確定**される。取り違え確定のリスク | `selectedId` 変更時に即座に `setDetail(null)` |
| 4 | 根拠性・不確実性管理 | **Critical** | `src/main/ipc/reference-handlers.ts` relink の `catch { throw new RequestFailure('MISMATCH') }` | `relinkReferenceSource` は「サイズ／SHA-256 不一致」以外に **`AggregateError`（DB rollback を確認できない不確定状態）** も投げる。それを一律「選んだファイルは元の内容と一致しません」と表示するのは、**不確定な結果を確定的で無害な原因に偽装**する。利用者は「別のファイルを選べばよい」と誤認する | 既知の不一致メッセージのみ MISMATCH、それ以外（特に `AggregateError`）は OPERATION_FAILED |
| 5 | 内容の妥当性 | Major | `AnnotationWorkspacePage.tsx` `全 {items.length}件 ／ 未確認 {openCount} 件` | `items` は `PAGE_LIMIT = 200` の 1 ページ分。総件数 `listed.value.total` を破棄しているため、**201 件以上で「全 N 件」「未確認 N 件」が過小報告**される。「未確認 0 件」と表示されても実際には未確認が残りうる | `total` を保持し、表示分と総数を区別して表示 |
| 6 | 目的適合性 | Major | 同上 | 201 件目以降の item は gallery に出ず、**確認する手段が無い**。ページ送り UI が無い | 総数と表示上限を明示し、上限超過を利用者へ通知（本レビュー範囲では表示是正のみ） |
| 7 | 品質・運用性 | Major | `src/shared/contracts/reference-ipc.ts` / `src/main/ipc/reference-handlers.ts` / `src/preload/reference-api.ts` / `AnnotationWorkspacePage.tsx` | **4 つの新規 module に colocated unit test が 1 件も無い**。本 repository は全 module に `.test.ts(x)` を併置する規約であり、実行計画の各 task の DoD も test file を列挙している | 少なくとも契約・preload 境界（security 上の要）へ unit test を追加し、残る不足を明記 |
| 8 | 品質・運用性 | Major | `src/renderer/layout/AppShell.tsx` `openDeletePreview` / `runDelete` | 削除の失敗表示に **Project 選択用の文言 `selectionErrors` を流用**している。例: 削除失敗時に「Project の最新情報を確認できません。一覧を再取得するか、選び直してください。」と表示され、削除の成否が伝わらない | 削除専用の文言表を用意 |
| 9 | 品質・運用性 | Major | `AnnotationWorkspacePage.tsx` `<select id="detection-active-class">` | DOM id が**ハードコードで非一意**。本 repository の他 component は一貫して `useId()` を使う。複数 mount 時に id 衝突と label 誤結合が起きる | `useId()` を使う |
| 10 | 整合性 | Major | `src/main/ipc/reference-handlers.ts` `register()` | 書き込み（relink）実行**前**に sender を再検証していない。`project-handlers.ts` は「native dialog を閉じた後、capability を consume する前に sender／snapshot を再検証する」を明文の不変条件としており、reference handler だけ逸脱している | handler へ `assertCurrent` を渡し、書き込み直前に再検証 |
| 11 | 内容の妥当性 | Major | `tests/e2e/import-detection.spec.ts` | module スコープの可変 `referenceDataset` を test 3 で代入し test 5 で `referenceDataset!` と非 null 断言。`--grep` で単体実行すると **null 参照で不可解に落ちる**。test 間の暗黙依存 | 明示的な前提アサーションを置き、失敗理由を自己説明にする |
| 12 | 根拠性・不確実性管理 | Major | `AnnotationWorkspacePage.tsx` `instructions = schema?.instructions ?? ''` | Label Schema の取得に失敗した場合も空文字になり、`AnnotationInstructions` が「まだ設定されていません」と**未設定である旨を断定**する。実際は不明 | 取得失敗時は指示表示を断定しない（本レビューでは §1 No.7 の範囲外として記録のみ） |
| 13 | 品質・運用性 | Major | `src/main/ipc/reference-handlers.ts` `REFERENCE_STATUS_CHANNEL` | 全 Reference entry を**無制限に**逐次 `verifyReferenceSource`（実ファイル読取＋SHA-256 全読み）する。件数が多いと main process を長時間占有し、進捗表示も cancel も無い | 不採用（理由は §2） |
| 14 | 整合性 | Major | `src/shared/contracts/app.ts` | `APP_API_CONTRACT_VERSION` は `1` のまま、必須メンバー `references`（および既存の `revisions`）を追加している。**必須メンバーの追加は v1 契約の破壊的変更**。`diagnostics.exportSummary` は optional で追加された前例と不整合 | 不採用（理由は §2） |
| 15 | 整合性 | Minor | `src/renderer/features/annotations/AnnotationPage.tsx` | B-1 の結線後、**どこからも mount されない dead code** になった（参照は自身と自身の test のみ）。それでも 15 件の test が回り続け、保守コストだけが残る | 本レビューでは削除しない（W2-02 の成果物であり別担当の判断領域）。記録のみ |
| 16 | 品質・運用性 | Minor | `AnnotationWorkspacePage.tsx` `className="annotation-workspace"` / `annotation-workspace__actions` | 対応する CSS が 1 件も存在しない（`*.css` 内に 0 件）。未使用 class 名 | 記録のみ（削除すると将来の styling 導線を失うため、害が無い範囲） |
| 17 | 品質・運用性 | Minor | `AnnotationWorkspacePage.tsx` `referenceNotice` | エラーも成功通知も同じ `role="status"` で表示。エラーが支援技術へ**警告として伝わらない** | 重大度を保持して `role` を切替 |
| 18 | 内容の妥当性 | Minor | `AnnotationWorkspacePage.tsx` `reset()` | `referenceState` / `referenceNotice` / `queued` を clear しない。Project 再読込後も**古い参照元エラーや古い Queued 通知が残る** | `reset()` で clear |
| 19 | 品質・運用性 | Minor | `AnnotationWorkspacePage.tsx` `relinkReference` の `finally` | `setBusy(false)` の直後に `checkReferences(true)` が `setBusy(true)` を行うため busy が false→true→false と往復し、ボタンが一瞬有効化される | 記録のみ（実害は軽微） |
| 20 | 品質・運用性 | Minor | `tests/manual/windows-file-picker.md` `### 3.3 relink（L-01）` | 見出しが L-01 のみを示すが、表には L-01／L-02 の 2 項目がある | 見出しを実態に合わせる |
| 21 | 品質・運用性 | Minor | `tests/e2e/harness.ts` `repositoryRoot` | export されているが外部利用が無い（参照は同 file 内のみ）。YAGNI | 記録のみ（診断時に有用な定数） |
| 22 | 品質・運用性 | Minor | `tests/fixtures/classification-images.ts` `encodePng` / `writeCorruptPng` | export されているが外部利用が無く、同 file 内からのみ使用。YAGNI | 記録のみ |
| 23 | 内容の妥当性 | Minor | `src/shared/contracts/reference-ipc.ts` `key = z.string().min(1).max(1024)` | `imageKey` の正本は main 側の `importImageKeySchema`。境界で別定義を持つと**受理範囲がずれ**、preload で通り main で落ちる入力が生まれる | 記録のみ（main が最終判定するため安全側） |
| 24 | 品質・運用性 | Minor | `src/renderer/features/annotations/AnnotationWorkspacePage.tsx` `NoObjectButton onClearNoObject` | 空実装＋コメント。ただし `disabled={locked}` かつ当該 button は `state==='confirmed'` のときだけ描画されるため**常に disabled** で到達不能。誤解を招く死にコード | 記録のみ（実害なし） |
| 25 | 品質・運用性 | Minor | `AnnotationWorkspacePage.tsx` `classes = schema?.classes ?? []` | schema 未取得時に毎 render で新しい配列を生成し、`DetectionItemEditor` の `useLayoutEffect([classes])` が毎 render 実行される（値同一のため再 render は起きない） | 記録のみ |
| 26 | 品質・運用性 | Minor | `AnnotationWorkspacePage.tsx` `confirmItem` | 1 件確認するたびに workspace 全体を `load()` し直す（N 件で N 回の全件取得） | 記録のみ（正確性優先の設計として許容） |
| 27 | 根拠性・不確実性管理 | Minor | `AnnotationWorkspacePage.tsx` `CONFIRMED_BY = 'local-operator'` | 不変の Dataset Revision に記録される `createdBy` が**固定の合成文字列**。実在の操作者を表さない | 記録のみ（利用者識別の仕組みが本 version に無く、追加は範囲外） |
| 28 | 根拠性・不確実性管理 | Minor | `AnnotationWorkspacePage.tsx` `EXCLUSION_REASONS` | 要求定義に根拠の無い 4 つの除外理由を UI 語彙として新設している | 記録のみ |
| 29 | 品質・運用性 | Minor | `src/shared/contracts/project-ipc.ts` `deletedRows: z.record(z.string(), nonNegative)` | 他の DTO が `readonly()` / freeze される中、この record だけ readonly 指定が無い | 記録のみ |
| 30 | 整合性 | Minor | `package.json` `scripts.test` | `npm test` に E2E が含まれない。回帰検出は `npm run test:e2e` の明示実行に依存する | 記録のみ（設計どおり。`e2e-framework.md` §6 に記載済み） |
| 31 | 根拠性・不確実性管理 | Major | `docs/implementation-plan.md` §15.12 | 新規 4 module に unit test が無い事実（No.7）を記載せず Gate 3 合格を記録している | §15.12 へ明記 |

> 重大度の内訳: Critical = No.1〜4、Major = No.5〜14 と No.31、Minor = No.15〜30。

---

## 2. 修正しない Major・主要 Minor とその理由

| No. | 重大度 | 指摘 | 不採用の理由 |
|---|---|---|---|
| 6 | Major | 200 件超のページ送り UI | 新規 UI 機能の追加であり Wave 3／B-1 の範囲外。**表示の過小報告（No.5）だけを是正**し、上限の存在と未取得分を利用者に明示することで「測っていない数を報告しない」原則は満たす。ページ送りは別 leaf の担当 |
| 12 | Major | Label Schema 取得失敗時の指示表示 | `AnnotationInstructions` は W2-15 の成果物で、空文字の扱いは同 component の契約。呼び出し側で回避すると W2-15 の DoD と二重定義になる。§1 に記録して担当へ引き継ぐ |
| 13 | Major | Reference status の無制限走査 | 件数を打ち切ると「全件確認した」と言えなくなり、**打ち切りを全件確認と誤表示する危険**の方が大きい。現行は正確さを優先した実装であり、上限導入は契約面（打ち切りフラグ）の拡張を伴うため過剰。既知の制約として記録する |
| 14 | Major | `APP_API_CONTRACT_VERSION` の据え置き | `revisions` が先行 task で同じ方式（v1 のまま必須追加）で導入済み。ここだけ optional 化／version 昇格を行うと bridge 検証の前提が二重化する。**既存方針との整合を優先**し、記録のみとする |
| 15 | Minor | `AnnotationPage.tsx` の dead code | W2-02 の正式成果物であり、削除は当該 task の完了記録に影響する。本レビューの権限外 |

その他の Minor（No.16／21〜30）は実害が無いか、修正が別 task の担当領域に踏み込むため記録のみとした。

---

## 3. サマリー

- Critical: **4 件**（No.1／2／3／4）
- Major: **11 件**（No.5〜14、31）
- Minor: **16 件**（No.15〜30）
- 合計 31 件
- **合格判定（修正前）: FAIL（Critical = 4）** → 全 Critical を修正後に再判定（§5）

---

## 4. 修正後の再検証結果

| 実行 | 結果 |
|---|---|
| `npm run typecheck`（main / renderer / e2e の 3 project） | exit 0 |
| `npm run build` | exit 0 |
| `npm run verify:version` / `npm run verify:docs` | exit 0 |
| `npx vitest run src/shared/contracts/reference-ipc.test.ts src/preload/reference-api.test.ts src/main/annotations/workspace-service.test.ts` | **53 passed / 0 failed** |
| `npx vitest run src/shared/contracts src/preload src/main/ipc src/main/annotations src/renderer/layout` | **1471 passed / 1 failed**。唯一の失敗 `workspace-import.test.ts :: commits genuine native-captured Reference and reopens` は `Error: Reference sourceを安全に再読込できませんでした。` で、**対策前の計測でも同一 file に 1 件の失敗**として記録されていた既存の実環境依存失敗。本レビューの修正が編集した経路ではない |
| `npx playwright test`（全 spec） | **13 passed / 0 failed / 1 skipped** |

Critical #1 の是正は E2E で実証した。確定ダイアログの「provenance 内訳」に `import-edited: 4` のような **`annotation_provenance.kind` の実集計**が表示され、`unconfirmed` 等の検証エラーコードも「記録なし」も表示されないことをアサートしている（`tests/e2e/annotation-classification.spec.ts`）。

## 5. 再判定

- Critical: **0 件**（4 件すべて是正）
- **合格判定: PASS**

Major のうち No.6／12／13／14／15 は §2 の理由で不採用とし、[`docs/implementation-plan.md`](../docs/implementation-plan.md) §15.12 ⑦ の「残る既知の不足」へ転記した。

## 6. 残タスクの消化（2026-09-22 09:20〜）

§1 No.7（新規 module の colocated unit test 欠如）のうち、レビュー時点で未着手だった 2 module の試験を追加し、Major #7 を完全に解消した。

| 追加 file | 件数 |
|---|---|
| `src/main/ipc/reference-handlers.test.ts` | 9 passed |
| `src/renderer/features/annotations/AnnotationWorkspacePage.test.tsx` | 5 passed |

**新規 test が発見した実欠陥（Major・修正済み）**: `reference-handlers.ts` / `revision-handlers.ts` の `finally { active = false }` が、**`BUSY` として拒否された要求まで排他フラグを解放**していた。進行中の検証があるのに後続要求が共有 DB 接続上で処理されうる状態だったため、`acquired` フラグで「実際に取得した呼び出しだけが解放する」よう是正した。`revision-handlers.ts` の分はレビュー以前からの欠陥だが、同一 guard を隣で修正しながら残すのは不適切と判断して併せて修正した。

作成時に判明した試験上の注意（記録）:

- handler 試験は `// @vitest-environment node` の pragma が必須（`vitest.config.ts` の既定は jsdom で、`import.meta.url` が file URL にならない）。
- `parseAnnotationGetResponse` は provenance 件数と annotation の対象数の一致を要求するため、fixture の `classId` と provenance を整合させる必要がある。

### 再検証（残タスク消化後）

| 実行 | 結果 |
|---|---|
| `npm run typecheck`（3 project）／`npm run build` | exit 0 |
| `npx vitest run`（新規 4 test file 合計） | **23 passed / 0 failed** |
| `npx playwright test`（全 spec） | **13 passed / 0 failed / 1 skipped** |

### 積み残し（本レビューの範囲外・別担当）

| 項目 | 状態 |
|---|---|
| W3-08 の実機受入（OS 標準 picker／OS 再起動／署名前 package） | **実施不能**。人手と署名前 package が必要。手順書のみ整備済み |
| `MISMATCH` / `OPERATION_FAILED` 振り分けの単体試験 | Reference import を持つ DB fixture が未整備。E2E で `MISMATCH` のみ検証済み、`AggregateError` 経路は未到達 |
| 既存 unit の 167 件失敗（負荷 flaky＋実環境依存） | Wave 3 範囲外。別 leaf を要する |
| `revision-handlers.ts` / `ClassDistribution` / `NoObjectButton` / `SaveStatus` の test 欠如 | 本作業以前からの欠如。別担当 |
| Wave 4（users-guide §6〜§10） | 未着手。W4-02 は W3-08 に依存するため現状 blocked |

## 7. 残タスクの全消化（2026-09-22 09:48〜、W3-08 を利用者判断でスキップ）

§6 の積み残しのうち、W3-08 を除くすべてを実行した。詳細は [`docs/implementation-plan.md`](../docs/implementation-plan.md) §15.12 ⑨。

### 7.1 追加した unit test

| file | 件数 |
|---|---|
| `src/main/ipc/revision-handlers.test.ts` | 6 |
| `src/main/ipc/reference-relink.test.ts` | 8 |
| `src/renderer/features/annotations/SaveStatus.test.tsx` | 3 |
| `src/renderer/features/annotations/NoObjectButton.test.tsx` | 7 |
| `src/renderer/features/annotations/ClassDistribution.test.tsx` | 7 |

`reference-relink.test.ts` により、§4 で「E2E でのみ検証」としていた `MISMATCH` / `OPERATION_FAILED` の振り分け（`AggregateError` 経路を含む）を単体で固定した。

### 7.2 既存 167 件失敗の根本原因（2件）と是正

| # | 原因 | 重大度 | 是正 |
|---|---|---|---|
| 1 | `src/main/data/reference-access.ts` が `process.env.SystemRoot` を case-sensitive に読んでいた。worker thread の `process.env` は OS の生キー（`SYSTEMROOT`）だけを持つ plain object なので解決できず、`mountvolExecutable()` が `access('unsafe')` で**機能を誤って拒否**していた | **製品コードの欠陥** | case-insensitive 解決を追加（既存の検証は不変）。同じ読み方の既存 test 2 file も是正 |
| 2 | vitest 既定の `testTimeout`（5 秒）が、実ファイルシステム／実 SQLite／実子プロセスを使う Main suite に短すぎた。失敗は全て所要 5.0〜5.3 秒 | 試験設定の不備 | `vitest.config.ts` に `testTimeout` / `hookTimeout` = 30 秒 |

**効果**: 167 → 71 → **5**。skip も 150 → 8。残 5 件は単独実行で 239/239 PASS する並列負荷依存であり、アサーションを緩めずに記録する。

### 7.3 Wave 4

`docs/users-guide.md` §6〜§9 を E2E 実測手順へ置換、§10 に接続状況、冒頭に章ごとの状態一覧を追加。未実測の操作は手順化せず、未実測である旨を明示した。

### 7.4 再検証

| 実行 | 結果 |
|---|---|
| `npm run typecheck`（3 project）／`npm run build`／`npm run verify:docs`／`npm run verify:version` | exit 0 |
| `npx vitest run`（全体） | **4490 passed ／ 5 failed ／ 8 skipped** |
| `npx playwright test`（全 spec） | **13 passed ／ 0 failed ／ 1 skipped** |

### 7.5 これ以降の積み残し

| 項目 | 状態 |
|---|---|
| W3-08 実機受入 | **利用者判断でスキップ**。手順書 `tests/manual/windows-file-picker.md` は整備済み、結果欄は空欄 |
| 全体並列実行時の 5 件 | 単独実行では PASS。実行環境の負荷依存 |
| 200 件超の画像へ到達する導線 | 未実装。画面には総件数と未取得分を明示済み |
| Gate 2／Gate 4／Gate 5 配下の機能（補助候補・学習実行・レポート・カメラ推論） | 別 Gate 依存。users-guide §11〜§15 も据え置き |
