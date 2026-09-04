# ドキュメント実行・レビュー記録

| 項目 | 値 |
|---|---|
| 実行計画 | `work/20260904-1140-DocumentationTaskExecutionPlan.md` |
| 要求基準 | `docs/requirement-definition.md` v0.3 Draft |
| 開始 HEAD | `c6179c6a42f47b4962df5222aec3d93358594166` |

## DOCS-001 — 事実固定

- 出力: `work/20260904-DocumentationFactBaseline.md`
- 検証: Markdown diagnostics 0、Python pytest 4 passed、Ruff passed、Pyright 0 errors / 0 warnings。
- 制約: exact npm 12.0.0 を取得できず、Node test / typecheck / build は NOT_RUN。
- 敵対的レビュー: 状態語 1 件を再現・修正。文書成熟度と test line attribution の 2 件は一次資料と受入条件から不採用。
- 判定: **完了**。

## DOCS-002 — 既存差分の分離

- DOCS-001 作成前の tracked 6 files、untracked 5 filesを baseline §6 に記録した。
- 製品版基盤（VER-00〜04）とドキュメント整備の owner を分離した。
- 既存ファイルを stash、reset、checkout、削除、上書きしていない。
- 敵対的レビュー観点: `git status` と baseline §6 を突合し、既存 10 product-version files が全て残ること、文書作業が別 path だけに追加されることを確認する。
- 判定: **完了**。`package.json` を共有する DOCS-305 は既存差分へ統合するまで保留。

### DOCS-002 敵対的レビュー

- `package.json` と `work/` の状態を terminal で再確認すべきとの指摘を採用。`git status --short` と baseline §6 を再突合し、既存 product-version 10 files が保持され、documentation files が別 path として識別されること、`git diff --check` が合格することを確認した。
- product-version files の分離は PASS とされた。

## DOCS-003 — 表記・リンク・図の共通規約

- 出力: `docs/developer-guide.md`, `docs/architecture.md` の冒頭規約。
- 用語集の正本、7 状態／成熟度許可値、相対リンク、standalone SVG、accessibility、状態の色・線・ラベルを定義した。
- 敵対的レビューで README の必須リンクと users guide の章 status が指摘されたが、それぞれ DOCS-101 と DOCS-103 の明示的な後続受入条件であり、DOCS-003 の欠陥としては不採用。
- users guide の link 表示名は誤リンクではないが、読者の混乱を避ける改善として DOCS-103 で修正する。
- 自主確認で文書先頭の複合機能状態が §3.4 の単一許可値に一致しないことを検出し、`検証待ち` へ修正した。各節では実装済み／未実装を分離する。
- 判定: **完了**。

## DOCS-101 — README 共通入口

- §6.1 の 14 項目、一般利用者／開発者／architecture／要求定義の必須リンク、利用不可状態を追加した。
- 敵対的レビューは 14 項目、4 必須リンク、platform、privacy、権利、Copy / Reference、人による確認、scope、license、hash を確認した。
- 再現した指摘 1 件: `対応予定の環境` は内容上安全だが、要求定義の標準用語と不一致。`対応プラットフォーム` へ修正し、本文の未提供注記は維持した。
- 判定: **完了**。

## DOCS-102 — users guide 現状注記

- コード／test／build 設定が存在しないという旧記述を、実装済み shell と未実装 feature を区別する記述へ更新した。
- 完成アプリケーションと両 OS installer が未提供で、現在操作できない事実を維持した。
- 4 機能状態と 3 文書成熟度の凡例を追加した。
- 敵対的レビュー: 指摘なし。**完了**。

## DOCS-103 — users guide 章構造

- §6.2 の 16 章へ再編し、各 level-2 heading 直下に機能状態、文書成熟度、根拠、最終化条件を配置した。
- 敵対的レビューで、章 7 が Copy / Reference、入力形式、データ権利を題名に表していない点を再現し修正した。
- 章 10 の `詳細` 欠落も計画への厳密な一致として修正した。中黒と読点の差は意味を変えないため維持した。
- 判定: **完了**。

## DOCS-104 — 初回設定と Project 設定

- 診断、作業フォルダー、Copy / Reference、Label Schema、Inference Profile の確定時期と参照先を分離した。
- 画面名、既定値、既存データ移動を未確定として、一つの Settings 画面を仮定しないことを明記した。
- 敵対的レビュー: 要求対応、anchor、未確定事項を確認し、指摘なし。**完了**。

## DOCS-105 — 画像分類チュートリアル構成

- 12 段階の目標状態、開始前提、Error / Warning、要求 ID、未検証 evidence、data boundary、中断、完了確認を追加した。
- Gate 2 前の assist、具体的 UI、sample path、所要時間を操作手順として記載していない。
- 敵対的レビューは全受入条件を PASS とした。軽微な観察のうち未処理候補の確定禁止は既に同じ行に明記済みで、他は DOCS-404 の実測事項または許容される重複だったため編集不要と判定した。
- 判定: **完了**。

## DOCS-106 — 物体検出チュートリアル構成

- 10 段階の目標状態、矩形制約、negative sample、COCO、assist、学習、report、camera の検証テンプレートを追加した。
- 敵対的レビューは受入条件を PASS とし、軽微な意味上の曖昧さを報告した。
- 再現した import と確定前 validation の段階差、non-negative 画像での schema 前提、open-vocabulary の新 class 候補、COCO の意味論的 lossless と byte round-trip の区別を本文へ反映した。
- UI 詳細や recovery は DOCS-405 まで未検証のまま維持した。判定: **完了**。

## DOCS-107 — privacy / storage / license / troubleshooting / servicing

- カメラ privacy、Copy / Reference、Project 保存場所、servicing の規範的な説明先を明示し、運用章から相互リンクした。
- README の旧 chapter-14 anchor を実在する `#トラブルシューティング` へ修正した。
- Reference 再リンクを実在ダイアログとして断定せず、要求上の設計と未検証 UI を区別した。
- 既存の権限、容量、入力権利、model governance、Project 保持、rollback の注意を削除していない。
- 敵対的レビューは anchor、正本への参照、安全情報の保持を PASS とした。軽微な指摘として camera と training failure の未来形が利用可能と読める余地を再現し、Reference hash mismatch と cache 削除も含めて `設計` / `未検証` の表現へ統一した。
- 判定: **完了**。

## DOCS-201 — 開発環境と最小検証

- exact Node / npm / uv、OS 別 Python、`ml/` working directory、Pylance interpreter、実在する scripts、entry points を記載した。
- 現セッションの Python PASS と Node NOT_RUN を分離した。
- 敵対的レビューの Pyright / Ruff 3.13 指摘は設定として再現したが、両 OS 共通の下限互換性検査であり、Windows 3.14 runtime は uv marker と pytest が担う。手動設定変更の提案は再現性を壊すため不採用とし、境界を本文へ追記した。
- 判定: **完了**。

## DOCS-202 — 要求駆動カスタマイズ

- 12 段階の要求駆動フロー、6 変更カテゴリ、検証、ADR 条件、DoD、PR evidence を追加した。
- 敵対的レビュー: 指摘なし。**完了**。

## DOCS-203 — 現行実装と目標 architecture

- process、trust / IPC、component、source tree、data、worker、ownership、packaging、15 行の現行対応表、変更境界を追加した。
- 初回レビューは誤った正本を検索したため無効化し、正しい `work/...DocumentationTaskExecutionPlan.md` §6.4 で再レビューした。
- 再レビューから目標 process の許可／禁止依存と、変更境界の状態列を採用した。
- ADR-0002 重複の指摘は、現本文が状態遷移表や provenance 表を複製せず3段落の概要と ADR link に限定されているため再現せず不採用。component の prose 不足も既に表直後の2段落があるため不採用。
- SVG link は DOCS-204 の出力へ接続し、DOCS-209 で統合確認する。判定: **完了**。

## DOCS-204〜208 — SVG 図

- 5 SVG を別 file owner で並列作成し、XML、ARIA、title / desc、凡例、状態の線種、禁止 element を適用した。
- DOCS-204 review: Main → OS API が外部資源の緑線になっていた実装状態誤表現を再現し、設計確定・未実装の紫破線へ修正。
- DOCS-205 review: 指摘なし。
- DOCS-206 review: reviewer は誤って `docs/implementation-plan.md` を検索した。DOCS-206 と §7.1 / §7.4 は文書整備計画に実在するため task 不在指摘は不採用。ただし根拠を曖昧にしないよう SVG 内に `work/20260904-1140-DocumentationTaskExecutionPlan.md` を明記。
- DOCS-207 review: 指摘なし。
- DOCS-208 review: requirement 不在 return、ADR-before-code、non-user-visible の architecture / traceability 判定は存在する。ADR 判定は user-visible 判定より前に全変更へ適用されるため追加分岐指摘は不採用。accessibility / security / license の個別 stop box は §7.6 の必須 flow 外で、Task / Gate と Code + Test に包含する。
- 判定: DOCS-204 は修正後再確認待ち。DOCS-205〜208 は **完了**。

DOCS-204 の修正箇所を再レビューし、紫破線、purple marker、XML、隣接要素が PASS。DOCS-204 も **完了**。

## DOCS-209 — 図の本文統合

- 5 図を対応節へ各1回組み込み、目的・読み方、状態、主要 flow、禁止依存／不変条件、根拠、図が実装証拠ではない旨を記載した。
- 敵対的レビュー: 5 link、alt、説明、style、禁止 element、根拠を確認し、指摘なし。**完了**。

## DOCS-301 — 要求 baseline と文書 map

- v0.3 Draft の作業ツリー raw SHA-256 `2f1c57da192710ffb2fd764c7e342cf2e9106fa7387be7393133873cc815052f` と LF-normalized SHA-256 `7a6e08e7e046a3ced59644a73bde44c4d7b279f55ba809bd78af60fdaa5b175c` を再計算し、DOCS-001 / README の値と一致した。
- README の4必須 link target が全て存在することを確認した。要求変更はないため DOCS-001〜209 の再実行は不要。
- 敵対的レビュー: 版、両 hash、4 link を確認し指摘なし。**完了**。

## DOCS-302 — 既存文書の最小整合

- CONTRIBUTING と実装計画の作成時点注記を履歴として保持し、current developer / architecture 文書へ接続した。
- DOC-01〜10 と DOCS-* の責任を分離した。敵対的レビュー: 指摘なし。**完了**。

## DOCS-303 — 文書 verifier

- required files、Markdown link / fragment、README links、raw / LF hash、users guide status、SVG、要求 ID、`REAMDE.md` を fail-closed 検査する ESM CLI を追加した。
- 敵対的レビューから percent-encoded fragment の slug 化と code block 内要求 ID の誤検出を再現し修正した。
- architecture path 検査は DOCS-303 の受入条件外、BOM 除去／末尾 LF 追加は定義された LF-normalized bytes を変更するため不採用。SVG namespaced href は現行検査対象で、data URI は external resource として禁止するため許可しない。
- DOCS-304 の負例 test と再レビュー完了後に確定する。

修正後の敵対的再レビューは mandatory coverage と2欠陥の解消を確認し、指摘なし。DOCS-303 **完了**。

## DOCS-304 — verifier test

- test ごとに独立した一時 repository を生成・削除し、正常系、broken link / encoded fragment、missing SVG title、external href / data URI、unknown requirement ID、code block 除外、missing file、`REAMDE.md` を検証した。
- 敵対的レビューで raw / LF-normalized hash mismatch の負例不足を再現し、両方を検査する test を追加した。
- 直接 Node 実行で 10 passed / 0 failed、実 repository verifier は 8 Markdown / 5 SVG を検証して exit 0。DOCS-304 **完了**。

## DOCS-305 — package scripts 接続

- 既存 `verify:version` → `test:version` → Vitest の意味を保持し、fail-fast の前半へ `verify:docs`、文書 test として `test:docs` を追加した。
- exact npm 12.0.0 不在のため aggregate `npm test` は未実行。直接 Node による文書 test / verifier の PASS は aggregate PASS の代替にしない。
- 敵対的レビュー: script、順序、fail-fast、既存 version work、NOT_RUN 表示を確認し、指摘なし。DOCS-305 **完了**（aggregate 検証待ち）。

## DOCS-306 — 横断整合レビュー

- link、fragment、用語、状態、要求 ID、current / target、SVG / 本文を横断レビューした。
- 用語集は product feature ではないため章の機能状態を `実装済み` から `対象外` へ修正した。
- users guide の `検証待ち` が初回フロー全体、architecture の `実装済み` が `contractVersion` bridge のみを指すことを明記した。
- 自動 verifier 再実行後に完了判定する。

修正後、文書 test 10 passed、実 repository verifier passed、`git diff --check` passed。DOCS-306 **完了**。

## Documentation Gate 状態

| Gate | 判定 | 根拠 |
|---|---|---|
| D0 | **PASS** | DOCS-001〜003、要求版／両 hash、成果物／状態／SVG 規約をレビュー済み |
| D1 | **PASS** | DOCS-101〜306、exact npm 12.0.0 の aggregate `npm test`（64 tests）、typecheck、Main / Preload / Renderer build が合格 |
| D2 | **BLOCKED** | Gate 4、PKG-*、CORE-*、DAT-*、ANN-*、AST-*、TRN-*、REP-*、INF-* の製品／両 OS evidence が未完了 |
| D3 | **BLOCKED** | D2、DOCS-401〜407、native Apple Silicon Mac、DOCS-501〜505、FIN-01〜06 が未完了 |

## 現在実行できない task

- DOCS-401 / 402: production installer、正式署名、notarization、clean Windows / native Apple Silicon Mac evidence がない。
- DOCS-403: Project、診断、import の production UI / E2E が未実装。
- DOCS-404 / 405: annotation、assist、training、report、camera の E2E が未実装で、承認済み model もない。
- DOCS-406: 権限拒否、Reference 切れ、OOM、容量不足、worker failure、rollback の production failure evidence がない。
- DOCS-407: Gate 4 未完了のため planned component を production source へ置換できない。
- DOCS-501〜505: DOCS-401〜407 が必須依存。架空の利用者／実機 evidence で代替しない。

これらは skeleton、要求由来の説明、SVG を作ったことでは unblock しない。対応する製品 task と実測 evidence が揃った時点で再開する。

## 2026-09-04 Gate D1 再検証

- Microsoft package proxy metadata の npm `12.0.0` entry と `ms-feed-25.pkgs.visualstudio.com` artifact の SHA-1 `867836fd333dbd272da3705a7c2b32908cbd90c6` を照合し、一時 CLI `12.0.0` を使用した。
- 初回敵対的レビューの「metadata に 12.0.0 entry がない」は同一 JSON を再解析して反証したため不採用。version、host、shasum、tarball hash、shim version、workspace `package.json` hash を再確認した。
- `npm test`: product-version 25、documentation 19、Vitest 20、合計 64 tests、失敗 0。
- `npm run typecheck`: exit 0。
- `npm run build`: Main、Preload、Renderer が exit 0。
- 実行前後の `package.json` と `package-lock.json` hash は不変。

## DOCS-303 / 304 再開 — 計画 §11.1 #13 / #14

- architecture の current source path 存在確認と、README / users guide / developer guide / architecture の明示 status 許可値検査を verifier へ追加した。
- 初回 test は 13 passed、実 repository verifier は PASS。
- 敵対的レビューで fenced code 内の偽 status と Windows separator path の見逃しを再現し修正した。
- status regex 不一致の指摘は、実形式が `**機能状態:**`（colon は closing `**` の前）で負例 test が実際に合格するため不採用。
- 全4対象文書の不正 status、正確な line、fenced code 除外、Windows path を追加 test で固定した。
- 初回 aggregate 再実行は top-level CLI だけを絶対 path 指定したため、nested `npm run` が system npm 11.17.0 を検出して `EBADDEVENGINES` で停止した。npm 12 shim directory を `PATH` 先頭へ固定し、同じ gate を最初から再実行した。VER-02 review反映前は61 tests、反映後の最終実行は64 testsで、typecheck、3 build、lock / package hash 不変を確認した。
