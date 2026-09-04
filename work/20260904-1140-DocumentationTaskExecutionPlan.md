# AutoVision Studio ドキュメント整備 詳細実装プラン

| 項目 | 内容 |
|---|---|
| 文書バージョン | 1.0 Draft |
| 作成日 | 2026-09-04 |
| 対象リリース | Version 1（MVP） |
| 対象読者 | 一般利用者、AutoVision Studio をカスタマイズするソフトウェアエンジニア |
| 対象 branch | `main` |
| 状態 | 実行前・レビュー可能 |
| 要求基準 | `docs/requirement-definition.md` v0.3 Draft。作業ツリー CRLF SHA-256 `2f1c57da192710ffb2fd764c7e342cf2e9106fa7387be7393133873cc815052f` / Git blob LF SHA-256 `7a6e08e7e046a3ced59644a73bde44c4d7b279f55ba809bd78af60fdaa5b175c` |
| 実装基準 | `docs/implementation-plan.md` v0.3 Draft、ADR-0001〜0003、現行 source tree |

> 本書はドキュメント整備作業の実行計画であり、アプリケーション機能、インストーラー、macOS 動作、モデル承認、性能達成を宣言するものではない。実装・実機検証が完了していない操作は、利用可能な手順として記載しない。

## 1. 目的

本計画は、AutoVision Studio の情報を次の二つの読者層へ、矛盾なく段階的に提供できる文書体系を構築する。

1. **一般利用者**
   - アプリケーションの用途、対応環境、制約を理解できる。
   - Windows / macOS でインストール、初回設定、主要操作を完了できる。
   - 画像分類と物体検出のチュートリアルを最後まで実施できる。
   - データ、プライバシー、ライセンス、トラブル時の扱いを確認できる。
2. **ソフトウェアエンジニア**
   - source tree、実行時プロセス、信頼境界、コンポーネント、データライフサイクルを理解できる。
   - 要求定義、実装計画、ADR、テストへ変更を追跡できる。
   - 要求定義に沿って、安全にカスタマイズし、検証と利用者向け文書更新まで完了できる。

## 2. 完了条件

次をすべて満たしたとき、本ドキュメント整備を完了とする。

- `/README.md` に、両読者が共通して理解すべき項目が簡潔に列挙されている。
- `/README.md` から、独立したインストール・設定・チュートリアル文書 `docs/users-guide.md` へ明示的にリンクされている。
- `docs/users-guide.md` に Windows / macOS の検証済みインストール手順、初回設定、画像分類チュートリアル、物体検出チュートリアル、運用・トラブルシューティングがある。
- `docs/developer-guide.md` に開発環境、リポジトリ構造、カスタマイズ手順、検証、要求定義に沿う変更管理がある。
- `docs/architecture.md` にアーキテクチャ、コンポーネント、構造、データフロー、信頼境界の詳細説明がある。
- 必要な図が SVG で作成され、すべて `/images` に保存されている。
- 各説明が「実装済み」「設計確定・未実装」「検証待ち」「対象外」のいずれかを判別できる。
- ローカルリンク、見出しリンク、SVG 構造、要求 ID の参照を自動検証できる。
- 未検証の手順、架空の画面名、存在しないコマンド、未実測値を利用可能な事実として記載していない。

## 3. 解釈と採用方針

### 3.1 パス表記

依頼文の `/REAMDE.md` は、既存ファイルと一般的な命名に基づき **`/README.md` の誤記**として扱う。`REAMDE.md` は新規作成しない。

README には、次のリンクを必須で配置する。

- `[インストール・設定・チュートリアル](docs/users-guide.md)`
- `[開発・カスタマイズガイド](docs/developer-guide.md)`
- `[アーキテクチャ](docs/architecture.md)`
- `[要求定義](docs/requirement-definition.md)`

### 3.2 既存文書の再利用

- 一般利用者向けの独立文書は、既存の `docs/users-guide.md` を拡充する。類似する `getting-started.md` を新設して内容を二重管理しない。
- 開発者向け入口は `docs/developer-guide.md` を新設する。
- アーキテクチャの現行実装対応表と図解は `docs/architecture.md` を新設する。
- 詳細な設計理由は既存 ADR を正本とし、`docs/architecture.md` からリンクする。ADR の内容を複製しない。
- 既存の `docs/implementation-plan.md` にある `DOC-01`〜`DOC-10` は、機能完成後にユーザーガイドを更新する製品実装タスクとして維持する。本書では衝突を避けるため、横断的な文書整備タスクを `DOCS-*` とする。

### 3.3 記述言語と用語

- 本文、操作手順、図中ラベル、代替テキストは日本語を基本とする。
- `Project`、`Dataset Revision`、`Training Run`、`Model Version`、`Ground Truth` など要求定義で定義済みの語は表記を統一する。
- 初出時だけ日本語の補足を加え、同一概念に別名を作らない。
- パス、コマンド、シンボル、要求 ID は原文表記を維持する。

### 3.4 事実の状態表示

機能状態には、次の状態語だけを使用する。

| 状態 | 意味 | 記載可能な内容 |
|---|---|---|
| **実装済み** | source と対象テストが存在する | 実際のファイル、検証済み挙動 |
| **設計確定・未実装** | 要求定義または承認済み ADR に定義済み | 目標構成、制約、将来の責務 |
| **検証待ち** | 実装または PoC はあるが必要な OS・実機・Gate が未完了 | 未完了条件、ブロッカー、検証方法 |
| **対象外** | MVP の非スコープ | 実装しない理由、代替案内 |

「予定」を「利用できる」と読める文体で書かない。ボタン名、メニュー名、保存先、所要時間、画面キャプチャは実装と実測の後に確定する。

機能状態とは別に、章の成熟度を次の三段階で表示する。

| 文書成熟度 | 意味 |
|---|---|
| **構成のみ** | 見出し、前提、検証項目だけがあり、操作手順としては利用できない |
| **要求反映済み** | 要求定義と設計を説明しているが、UI 文言や手順は未検証 |
| **実測済み** | 製品版、OS、実行証拠を記録し、操作手順として再現済み |

`docs/users-guide.md` の各主要章は、冒頭に次の四項目を持つ。

- `> **機能状態:** <§3.4 の状態語>`
- `> **文書成熟度:** <構成のみ / 要求反映済み / 実測済み>`
- `> **根拠:** <対応要求 ID、ADR、実装タスク>`
- `> **最終化条件:** <必要な E2E / package / OS evidence と本書の DOCS-* タスク>`

たとえば installer 未実装時は「機能状態: 設計確定・未実装」「文書成熟度: 要求反映済み」とし、「インストールできます」とは記載しない。

状態の置換単位は `docs/users-guide.md` の level-2 heading 一つとする。章内に未検証の subsection が残る場合、その章全体を「実測済み」にしない。実測済み subsection と未検証 subsection が混在する期間は subsection にも同じ四項目を置き、章の状態は最も低い成熟度へ合わせる。DOCS-303 はこの固定書式と許可値を検査する。

## 4. 現状とギャップ

| 対象 | 現状 | ギャップ | 方針 |
|---|---|---|---|
| `/README.md` | 製品概要、Phase C の状態、4 文書へのリンクがある | 読者別入口、対応環境、プライバシー、主要概念、制約、カスタマイズ入口が不足 | 共通事項だけを短く追加し、詳細文書へ誘導 |
| `docs/users-guide.md` | 15 節のスケルトンと要求由来の説明がある | 一連のチュートリアルがなく、実装コードが存在しないという注記が現状と不一致 | 既存の構成を活かし、状態表示と二つの E2E チュートリアルを追加 |
| `CONTRIBUTING.md` | 小タスク、検証、toolchain、依存方針がある | 開発者オンボーディングとアーキテクチャへの入口が不足し、冒頭の実装状態が作成時点のまま | 開発者ガイドを入口にし、CONTRIBUTING は規約の正本として維持 |
| ADR-0001〜0003 | プロセス、データ、パッケージングの決定が詳しい | source tree と現在の実装状態を横断して見る文書がない | `docs/architecture.md` に対応表を作り、ADR へリンク |
| 現行 source | Electron lifecycle / secure window / narrow preload / 11 empty routes / Python `health` CLI がある | 文書の一部が「コード未作成」としている | 実装済み範囲を source と test から更新 |
| `/images` | ディレクトリも SVG も存在しない | 指定されたアーキテクチャ図、コンポーネント図、構造図がない | `/images` を新設し SVG を集約 |
| 文書検証 | product version の検証はある | 文書リンク、SVG、要求 ID の自動検査がない | 既存依存の範囲で `verify:docs` を追加 |

## 5. 情報アーキテクチャ

### 5.1 読者導線

| 読者 | 最初に読む文書 | 次に読む文書 | 目的 |
|---|---|---|---|
| 全読者 | `/README.md` | 各読者向け文書 | 製品、状態、共通制約の把握 |
| 一般利用者 | `docs/users-guide.md` | 必要に応じて要求定義の用語・ライセンス節 | 導入、設定、操作、問題解決 |
| カスタマイズ担当 | `docs/developer-guide.md` | `docs/architecture.md`、要求定義、実装計画、ADR、CONTRIBUTING | 変更設計、実装、検証 |
| リリース担当 | `docs/developer-guide.md` | ADR-0003、dependency policy、将来の release checklist | OS 別検証、署名、配布 |

### 5.2 成果物一覧

| 種別 | パス | 操作 | 役割 |
|---|---|---|---|
| 共通入口 | `/README.md` | 更新 | 両読者に共通する理解事項と文書ナビゲーション |
| 一般利用者 | `/docs/users-guide.md` | 更新 | インストール、設定、チュートリアル、運用 |
| 開発者 | `/docs/developer-guide.md` | 新規 | 開発環境、構造、要求駆動カスタマイズ |
| アーキテクチャ | `/docs/architecture.md` | 新規 | 現行実装と目標設計の対応、図の詳細説明 |
| 内部証拠 | `/work/<実行日時>-DocumentationFactBaseline.md` | 新規 | 文書内の主張と source / test / ADR / requirement の対応を固定する非ユーザー向け記録 |
| 開発規約 | `/CONTRIBUTING.md` | 最小更新 | 新しい開発者文書への導線、古い状態注記の明確化 |
| 実装計画 | `/docs/implementation-plan.md` | 必要最小限の整合更新 | 新文書と既存 `DOC-*` タスクの関係を記録 |
| 図 | `/images/system-architecture.svg` | 新規 | 実行時プロセスと信頼境界 |
| 図 | `/images/component-diagram.svg` | 新規 | 論理コンポーネントと依存方向 |
| 図 | `/images/repository-structure.svg` | 新規 | source / docs / resources の物理構造 |
| 図 | `/images/data-lifecycle.svg` | 新規 | Workspace から Model Version までのデータ遷移 |
| 図 | `/images/requirements-driven-customization-flow.svg` | 新規 | 要求定義に沿う変更フロー |
| 検証 | `/scripts/docs/verify-documentation.mjs` | 新規 | リンク、必須成果物、SVG、要求 ID の検査 |
| 検証 | `/scripts/docs/verify-documentation.test.mjs` | 新規 | 検証スクリプトの正常・異常系テスト |
| 検証入口 | `/package.json` | 更新 | `verify:docs` と文書テストを追加 |

## 6. 文書別の詳細仕様

### 6.1 `/README.md` に置く共通項目

README は詳細手順を持たず、次をこの順に列挙する。

1. **製品概要** — 画像分類と物体検出を端末内で扱うデスクトップアプリケーションであること。
2. **対象読者** — 一般利用者とカスタマイズ担当ソフトウェアエンジニア。
3. **現在の利用可否** — Phase、インストーラーの有無、利用可能な完成版かどうか。
4. **主要機能** — Project、データ取り込み、教師データ作成、ローカル学習、レポート、カメラ推論。
5. **対応プラットフォーム** — Windows 11 x64、macOS Apple Silicon arm64 と対象外環境。
6. **完全ローカル／オフライン境界** — 画像、モデル、結果を Cloud へ送らないことと、配布工程の例外。
7. **データと権利** — 入力データの権利は利用者が確認すること、Copy / Reference の違い。
8. **人による確認** — Model Suggestion は Ground Truth ではなく、自動承認しないこと。
9. **主要用語** — Project、Dataset Revision、Training Run、Model Version の短い定義。
10. **既知の制約／MVP 非対象** — Cloud、共同編集、動画、RTSP、セグメンテーション、未監査モデル。
11. **読者別クイックリンク** — 一般利用者と開発者の入口。
12. **ドキュメントマップ** — users guide、developer guide、architecture、requirements、implementation plan、ADR、dependency policy、CONTRIBUTING。
13. **ライセンスとモデルガバナンス** — MIT ライセンスと、同梱モデルは別審査であること。
14. **サポート／問題報告** — troubleshooting と contribution への導線。

必須リンクの表示名は「インストール・設定・チュートリアル」とし、一般利用者が「ユーザーガイド」という内部的な分類を知らなくても目的を判断できるようにする。

### 6.2 `docs/users-guide.md`

既存の 15 節を基礎に、次の構成へ整理する。既存アンカーを可能な限り維持し、変更する場合は README と他文書のリンクを同一タスクで更新する。

1. 本書の対象、製品の利用可否、状態凡例
2. 対応環境とインストール前の確認
3. Windows のインストール
4. macOS のインストール
5. 初回起動・診断・初期設定
6. Project と保存場所の設定
7. Copy / Reference、入力形式、データ権利
8. **画像分類チュートリアル**
9. **物体検出チュートリアル**
10. Label Schema と教師データ作成の詳細
11. 補助候補の確認・編集・却下
12. 学習、追加学習、モデル版、レポート
13. カメラ推論、権限、プライバシー
14. ストレージ、ライセンス、診断、トラブルシューティング
15. アップグレード、修復、アンインストール
16. 用語集と関連文書

#### 画像分類チュートリアルの完了フロー

以下は要求定義上の**目標シナリオ**であり、現時点の操作手順ではない。DOCS-105 では各項目を「設計確定・未実装」かつ「構成のみ」として配置し、クリック手順、画面文言、成功表示は書かない。DOCS-404 の E2E 実測後にだけ「実測済み」の操作手順へ置き換える。

1. Image Classification Project を作成する。
2. 作業フォルダーとデータモードを選択する。
3. 入力データの権利を確認する。
4. 画像または分類データを取り込む。
5. Label Schema を確認・作成する。
6. gallery / single view で各画像へ一つの class を設定する。
7. 承認済みモデルを用いる補助機能が Gate 2 後に実装された場合だけ、Model Suggestion を個別に確認する。
8. エラーと警告を確認し Dataset Revision を確定する。
9. Training Run の Queue 登録、進捗、終了状態を確認する。
10. 分類指標、混同行列、画像別結果を確認する。
11. 成功した Model Version を選択する。
12. カメラ権限の説明に同意し、分類推論を開始・停止する。

#### 物体検出チュートリアルの完了フロー

以下も要求定義上の**目標シナリオ**であり、現時点の操作手順ではない。DOCS-106 では検証欄を持つ構成だけを作り、DOCS-405 の E2E 実測前に矩形 UI や補助候補の具体的な操作を断定しない。

1. Object Detection Project を作成する。
2. 未 annotation 画像または COCO JSON と画像ルートを取り込む。
3. Label Schema と annotation instruction を確認する。
4. 矩形の作成、移動、resize、class 変更、削除を行う。
5. 対象物がない画像を negative sample として明示確認する。
6. 承認済みモデルを用いる補助機能が Gate 2 後に実装された場合だけ、Model Suggestion を矩形ごとに確認する。
7. エラーと警告を確認し Dataset Revision を確定する。
8. Training Run と Model Version を確認する。
9. mAP、PR 曲線、ground truth / prediction、FP / FN を確認する。
10. カメラ推論の box、class、score、実 FPS を確認して停止する。

各チュートリアルは次を含む。

- 開始前提、使用する入力形式、必要な権利
- 操作ごとの開始状態、操作、期待される画面状態
- Error / Warning が出た場合の分岐
- 作成されるデータと、元データが変更されるかどうか
- 中断、キャンセル、やり直しの方法
- 完了確認と次の操作
- 対応要求 ID と、手順を確認した製品バージョン／OS

Copy / Reference の規範的説明は「Project とデータ取り込み」の一節だけに置く。storage、troubleshooting、tutorial ではその節へリンクし、定義を複製しない。入力データの権利確認はファイル保持方式とは別の小節に分ける。

### 6.3 `docs/developer-guide.md`

次を順に記載する。

1. 文書の目的、対象者、現在の実装段階
2. 要求定義、実装計画、ADR、CONTRIBUTING の優先順位
3. 開発環境
   - Windows は PowerShell 7+ を使用
   - Node.js `24.19.x`、npm `12.0.0`
   - uv `0.12.9`
   - Windows Python 3.14、macOS Python 3.13
   - `ml/.venv` を VS Code / Pylance の interpreter に選択
4. リポジトリ取得後の依存復元と最小検証
5. source tree と主要 entry point
6. アーキテクチャと信頼境界へのリンク
7. 要求駆動のカスタマイズ手順
8. 変更種別ごとの影響範囲
   - Renderer の画面／操作
   - Preload API と shared contract
   - Main service、SQLite migration、ファイル操作
   - Python worker command
   - model / dependency / license
   - Windows / macOS packaging
9. テスト、type check、build、敵対的レビュー
10. user-visible 変更時の users guide 更新
11. ADR を追加・変更する条件
12. Definition of Done と PR 証拠

#### 要求駆動のカスタマイズ手順

1. `docs/requirement-definition.md` から対象 FR / NFR / UI / POC ID を特定する。
2. 対象要求と非対象要求を一行ずつ記録する。
3. `docs/implementation-plan.md` の対応タスクと依存 Gate を確認する。
4. ADR-0001〜0003 と `docs/architecture.md` で責務を置くプロセス／コンポーネントを決める。
5. 要求に該当項目がない場合、機能実装より先に要求変更を別レビューとして提案する。実装タスクのついでに要求を追加しない。
6. `CONTRIBUTING.md` の上限に従い、一つの観測可能な挙動へ分割する。
7. contract → backend / worker → preload → renderer の必要な層だけを変更する。
8. 正常、境界、失敗、敵対入力のテストを追加する。
9. 対象テスト、diagnostics、type check、必要な build を実行する。
10. user-visible な変更なら、同じ機能の実測後に `docs/users-guide.md` を更新する。
11. requirement → task → code → test → docs のリンクを更新する。
12. 敵対的レビューを閉じてから後続タスクへ進む。

### 6.4 `docs/architecture.md`

次を含める。

1. アーキテクチャの目的と状態凡例
2. システム全体と実行時プロセス
3. 信頼境界と IPC validation
4. コンポーネント、責務、依存方向、禁止事項
5. source tree と物理配置
6. データライフサイクルと不変性
7. Python Job Worker / Inference Worker の境界
8. Copy / Reference のデータ所有権
9. packaging と OS 別境界
10. 現行実装対応表
11. 拡張点ではなく、要求に沿って変更できる既存境界
12. 関連 ADR、要求、実装計画へのリンク

`docs/architecture.md` は ADR の要約版ではない。各境界について、図、現在の source 対応、許可される依存、禁止される依存を一〜二段落で説明し、設計理由、却下案、詳細な障害動作は該当 ADR の節へリンクする。

現行実装対応表には、最低限次を記載する。

| 領域 | 現行 source | 現在状態 |
|---|---|---|
| Electron entry / lifecycle | `src/main/index.ts`, `src/main/app-lifecycle.ts` | 実装済み |
| secure window | `src/main/window.ts`, `src/main/security.ts` | 実装済み |
| Preload bridge | `src/preload/index.ts`, `src/shared/contracts/app.ts` | contract version のみ実装済み |
| Renderer shell | `src/renderer/App.tsx`, `src/renderer/layout/AppShell.tsx` | navigation shell 実装済み |
| Feature pages | `src/renderer/routes.tsx` | 11 route は見出しのみ、機能未実装 |
| Python worker | `ml/src/autovision_ml/cli.py` | `health` command のみ実装済み |
| SQLite / Project / jobs | 将来の `src/main/db`, `projects`, `jobs` | 設計確定・未実装 |
| 学習 / assist / inference | 将来の `ml/src/autovision_ml/*` | Gate 待ち・未実装 |
| Installer | ADR-0003 と Phase M | 検証待ち・利用不可 |

## 7. SVG 図の仕様

### 7.1 共通制作規約

すべての図に次を適用する。

- 保存先はリポジトリ直下の `/images` に限定する。
- XML 宣言を持つ単体 SVG とし、外部画像、外部 CSS、Web font、JavaScript、`foreignObject` を使用しない。
- `viewBox` を必須とし、固定ピクセルだけに依存せず縮小・拡大できるようにする。
- ルート要素に `role="img"` と `aria-labelledby` を設定する。
- 各 SVG に一意な `<title>` と `<desc>` を含める。
- 図を参照する Markdown 側にも、図の要点を説明する代替テキストと本文説明を置く。
- 色だけで状態や線種を区別せず、ラベル、枠線、破線、凡例を併用する。
- 背景と文字は WCAG AA 相当のコントラストを確保する。
- 100% と 200% 表示で文字切れ、重なり、矢印の欠落がないことを確認する。
- status 色を全図で統一する。
  - 実装済み: 青・実線
  - 設計確定・未実装: 紫・破線
  - 検証待ち／Gate 待ち: 灰・点線
  - 外部入力または OS 資源: 緑・二重枠
- 図だけを見ても現在状態と目標状態を混同しない凡例を置く。

### 7.2 `/images/system-architecture.svg`

**目的:** 実行時プロセス、信頼境界、データ／制御の流れを示す。

**ノード:** 利用者、React Renderer、Electron Preload、Electron Main、SQLite、Project Files、OS APIs、Python Job Worker、Python Inference Worker、PyTorch / Optuna / ONNX、ONNX Runtime / EP。

**主要エッジ:** Renderer → Preload の限定 API、Preload → Main の validated IPC、Main ↔ SQLite、Main ↔ Project Files、Main → Worker の spawn、Job Worker → 一時成果物、Main → Inference Worker の binary RGB、Inference Worker → Main の NDJSON result。

**必須注記:** Renderer は非信頼、Main が唯一の DB writer、Python は DB を直接更新しない、Inference Worker は一時的、カメラフレームは既定で保存しない。

**根拠:** ADR-0001、`src/main/*`、`src/preload/index.ts`、`src/shared/contracts/app.ts`。

### 7.3 `/images/component-diagram.svg`

**目的:** 論理コンポーネント、責務、依存方向を示す。

**グループ:** Renderer UI、Preload APIs、Shared Contracts、Main Services、Local Persistence、Python Commands、ML Domain、Packaging / Resources。

**主要コンポーネント:** AppShell / routes、将来の features、app / project / annotation / job contracts、IPC handlers、Project / Data / Job / Model services、SQLite repositories、worker protocol、scan / assist / train / inference commands、model manifest、installer resources。

**ルール:** Renderer から Main service / filesystem / Python への直接線を描かない。Shared Contracts は境界であり、business logic を持たないことを示す。将来コンポーネントは破線で描く。

**根拠:** `src/`、`ml/`、`resources/`、`docs/implementation-plan.md` §7〜§8。

### 7.4 `/images/repository-structure.svg`

**目的:** カスタマイズ担当が物理的な配置と責務を把握できるようにする。

**第一階層:** `src/`, `ml/`, `resources/`, `docs/`, `images/`, `scripts/`, `spikes/`, `tests/`, `work/`, build / config files。

**第二階層:** `src/main`, `src/preload`, `src/renderer`, `src/shared/contracts`, `ml/src/autovision_ml`, `ml/tests`, `resources/models`, `docs/adr`, `docs/model-governance`。

**必須注記:** `spikes/` は PoC、`build/` は検証 harness / 生成物、`work/` は時点計画、`resources/models/manifest.json` は承認済みモデルの fail-closed 正本であること。

**根拠:** 現行 repository tree、`.gitignore`、CONTRIBUTING §11。

### 7.5 `/images/data-lifecycle.svg`

**目的:** データの可変／不変境界と Copy / Reference の分岐を示す。

**フロー:** Source Images → Copy / Reference 選択 → Annotation Workspace → Ground Truth 確認 → immutable Dataset Revision → Training Run / Trial → immutable Model Version → Report / Inference。

**補助フロー:** Approved Assist Model または Project Model → Model Suggestion → accept / edit / reject → draft annotation。Suggestion から Ground Truth へ自動遷移する線は描かない。

**必須注記:** Reference 元は変更・削除しない、未確認候補は Revision に入らない、成功 Run のみ Model Version を生成する。

**根拠:** ADR-0002、FR-DAT、FR-ANN、FR-AST、FR-TRN、FR-MOD。

### 7.6 `/images/requirements-driven-customization-flow.svg`

**目的:** ソフトウェアエンジニアが要求定義に沿って変更する手順を示す。

**フロー:** Change Request → Requirement ID 特定 → Scope / Non-scope → Task / Gate → ADR / Architecture 境界 → Code + Test → Adversarial Review → User Guide / Architecture 更新 → Traceability → Gate / PR evidence。

**分岐:** 対応要求がない場合は Requirement Change Review へ戻す。アーキテクチャ決定を変える場合は ADR 更新を先行する。user-visible でない場合も architecture / traceability への影響を判定する。

**根拠:** `docs/requirement-definition.md`、`docs/implementation-plan.md` §4 / §9、CONTRIBUTING §1〜§5。

## 8. タスク分解

### 8.1 Wave 0 — 事実固定と編集準備

| ID | 作業 | 主な出力 | 依存 | 完了条件 | 規模 |
|---|---|---|---|---|---|
| DOCS-001 | 文書・source・test・Gate の現状を再確認し、主張ごとの状態を固定 | `work/<実行日時>-DocumentationFactBaseline.md` | 本書承認 | `主張 / 掲載先 / 根拠 path・節 / evidence / 機能状態 / 文書成熟度 / 再確認条件` の表があり、未確認事項を実装済みにしない | M |
| DOCS-002 | 未コミットの製品版対応作業を文書整備と分離 | clean baseline または明示された別差分 | DOCS-001 | `CONTRIBUTING.md`、`docs/implementation-plan.md`、`package.json`、AppShell 関連の既存変更を失わず、文書整備コミットへ混在させない | S |
| DOCS-003 | 用語、状態語、相対リンク、図のスタイルを固定 | `docs/developer-guide.md` と `docs/architecture.md` の冒頭規約 | DOCS-001 | §3.3〜3.4 と §7.1 の規約が全成果物で再利用でき、用語集は `docs/users-guide.md` を正本として他文書からリンクする | S |

### 8.2 Wave 1 — 共通入口と一般利用者向け骨格

| ID | 作業 | 主な出力 | 依存 | 完了条件 | 規模 |
|---|---|---|---|---|---|
| DOCS-101 | README の共通事項と読者別ナビゲーションを追加 | `README.md` | DOCS-003 | §6.1 の 14 項目が簡潔にあり、`docs/users-guide.md` への必須リンクと開発者向けリンクがある。完成アプリがあるように読めない | M |
| DOCS-102 | users guide の古い状態注記を現状へ更新し、状態凡例を追加 | `docs/users-guide.md` | DOCS-003 | source / test / build config が存在しないという誤記を除去し、完成版と installer が未提供である事実は保持する | S |
| DOCS-103 | users guide の目次と章構造をインストール・設定・二つのチュートリアル中心に再編 | `docs/users-guide.md` | DOCS-102 | §6.2 の全章があり、既存内容を失わず、各 level-2 heading 直下に §3.4 の固定書式と許可値で状態が明示される | M |
| DOCS-104 | 初回設定と Project / データモード設定の説明を整理 | `docs/users-guide.md` | DOCS-103 | 診断、作業フォルダー、Copy / Reference、Label Schema、Inference Profile を「一つの Settings 画面」があるように捏造せず説明する | M |
| DOCS-105 | 画像分類チュートリアルの検証テンプレートを作る | `docs/users-guide.md` | DOCS-103 | §6.2 の目標フロー、前提、期待状態、Error 分岐、要求 ID、検証欄が「構成のみ」である。Model Suggestion、学習、レポート、推論の具体的な操作は DOCS-404 まで書かない | M |
| DOCS-106 | 物体検出チュートリアルの検証テンプレートを作る | `docs/users-guide.md` | DOCS-105 | §6.2 の目標フロー、矩形、negative sample、COCO、要求 ID、検証欄が「構成のみ」である。矩形 UI、assist、学習、推論の具体的な操作は DOCS-405 まで書かない | M |
| DOCS-107 | privacy / storage / license / troubleshooting / servicing を整理 | `docs/users-guide.md` | DOCS-106 | 既存の安全上重要な注意を維持し、同じ説明の重複を相互リンクへ置き換える | M |

`docs/users-guide.md` は同一ファイルを編集するため DOCS-102〜107 を直列で実行する。

### 8.3 Wave 2 — 開発者向け文書と図

| ID | 作業 | 主な出力 | 依存 | 完了条件 | 規模 |
|---|---|---|---|---|---|
| DOCS-201 | 開発環境、toolchain、最小検証を記載 | `docs/developer-guide.md` | DOCS-003 | exact version、OS 別 Python、`ml/` 作業 directory、Pylance interpreter、実在する package scripts が一致する。存在しない dev/start script を案内しない | M |
| DOCS-202 | 要求駆動カスタマイズ、変更種別、DoD を記載 | `docs/developer-guide.md` | DOCS-201 | §6.3 の 12 段階と、UI / IPC / Main / worker / model / package の影響範囲が要求 ID へ接続される | L |
| DOCS-203 | 現行実装と目標設計の対応を記載 | `docs/architecture.md` | DOCS-003 | §6.4 の全項目と現行実装対応表があり、ADR の複製ではなくリンクになっている | L |
| DOCS-204 | 実行時アーキテクチャ SVG を作成 | `images/system-architecture.svg` | DOCS-203 | §7.2 と共通 SVG 規約を満たし、architecture 本文の説明と一致する | M |
| DOCS-205 | コンポーネント SVG を作成 | `images/component-diagram.svg` | DOCS-203 | §7.3 を満たし、禁止された直接依存を描かず、実装済みと将来を区別する | M |
| DOCS-206 | リポジトリ構造 SVG を作成 | `images/repository-structure.svg` | DOCS-203 | §7.4 を満たし、実在しない directory は `planned` と表示するか描かない | M |
| DOCS-207 | データライフサイクル SVG を作成 | `images/data-lifecycle.svg` | DOCS-203 | §7.5 を満たし、Suggestion の自動 Ground Truth 化を示す経路がない | M |
| DOCS-208 | 要求駆動カスタマイズ SVG を作成 | `images/requirements-driven-customization-flow.svg` | DOCS-202 | §7.6 を満たし、要求がない変更と ADR 変更の戻り経路がある | M |
| DOCS-209 | 5 図を本文へ組み込み、図ごとの詳細説明と統一レビューを追加 | `docs/architecture.md`, `docs/developer-guide.md` | DOCS-204〜208 | 各図の目的、読み方、状態、主要ノード、禁止依存、根拠へのリンクがあり、5 図の色、線種、余白、文字、凡例、状態表現が §7.1 と一致する | M |

DOCS-204〜208 は、それぞれ別ファイルを出力するため、DOCS-202 / DOCS-203 の該当構成が固定された後に並列実行できる。

### 8.4 Wave 3 — 横断整合と自動検証

| ID | 作業 | 主な出力 | 依存 | 完了条件 | 規模 |
|---|---|---|---|---|---|
| DOCS-301 | 要求ベースラインを再確認し、README の文書マップを最終成果物へ接続 | `README.md`, DOCS-001 の fact baseline | DOCS-107, DOCS-209 | v0.3 Draft の版と二種類の hash を再確認し、変更があれば DOCS-001〜209 の影響箇所を再レビューする。未変更なら全リンクが有効 | S |
| DOCS-302 | CONTRIBUTING と実装計画の状態・導線を最小修正 | `CONTRIBUTING.md`, `docs/implementation-plan.md` | DOCS-202, DOCS-203 | 作成時点の履歴を消さず、現在の入口を示す。既存 `DOC-01`〜`DOC-10` と本書 `DOCS-*` の役割が衝突しない | S |
| DOCS-303 | 文書検証スクリプトを実装 | `scripts/docs/verify-documentation.mjs` | DOCS-301 | Node `fs/path/url/crypto` と lock 済み `jsdom` だけで必須ファイル、相対リンク、fragment、README 必須リンク、要求定義の raw / LF-normalized SHA-256、章 status、SVG 属性／禁止要素、要求 ID、`REAMDE.md` 不在を fail-closed 検査し、file / line / reason を含むエラーを返す | M |
| DOCS-304 | 文書検証スクリプトのテストを追加 | `scripts/docs/verify-documentation.test.mjs` | DOCS-303 | test ごとに一時 directory を生成し、checked-in fixture を増やさず、正常系と broken link / fragment、missing SVG title、external resource、不明要求 ID の負例を検証する | M |
| DOCS-305 | package scripts へ文書検証を接続 | `package.json` | DOCS-304 | `verify:docs` と文書テストの入口を追加し、aggregate `npm test` から実行する。既存 version test、Vitest、build の意味と順序を明示し、失敗時は後続を実行しない | S |
| DOCS-306 | 全文書のリンク、用語、status、要求参照を横断レビュー | 全文書、必要な修正 | DOCS-302, DOCS-305 | 自動検査が合格し、同一概念の表記揺れと相互矛盾が 0 件 | M |

`package.json` には既存の未コミット変更があるため、DOCS-305 はその作業が保存・統合された後に実施する。

### 8.5 Wave 4 — 機能完成後の実測手順化

この Wave は**現在実施不可**である。文書の骨格完成後も、対応する製品タスクが合格するまで開始しない。表中の `CORE-*`、`DAT-*`、`ANN-*`、`AST-*`、`TRN-*`、`REP-*`、`INF-*`、`SEC-*`、`REL-*`、`STO-*`、`PKG-*` はすべて `docs/implementation-plan.md` §7 の正本タスク ID である。

| ID | 作業 | 主な出力 | 必須依存 | 完了条件 | 状態 |
|---|---|---|---|---|---|
| DOCS-401 | Windows install / upgrade / repair / uninstall を実測して本文化 | `docs/users-guide.md` | Gate 4, D-16, PKG-02, PKG-05, PKG-07, PKG-11, PKG-13, PKG-15, PKG-17, PKG-19, PKG-22 の Windows evidence | clean Windows 11 x64 で利用者視点の全手順を再現し、署名確認、起動場所、ログ、Project 保持を記載 | BLOCKED |
| DOCS-402 | macOS install / upgrade / repair / uninstall を実測して本文化 | `docs/users-guide.md` | Gate 4, D-16, PKG-03, PKG-06, PKG-08, PKG-12, PKG-13, PKG-15, PKG-18, PKG-20, PKG-22 の macOS evidence | 正式な Developer ID Application / Installer identity と native Apple Silicon Mac を用い、freeze、署名、notarization、staple 後の PKG で全手順を再現する | BLOCKED |
| DOCS-403 | 初回診断と Project / import 設定を実画面で本文化 | `docs/users-guide.md` | CORE-12〜14, CORE-13, DAT-09〜10, DAT-15 | UI 文言、分岐、Error / Warning、Copy / Reference を両 OS で確認 | BLOCKED |
| DOCS-404 | 分類チュートリアルを E2E 証拠で完成 | `docs/users-guide.md` | ANN-27, AST-22, TRN-32, REP-10, INF-13〜15 | 分類フローを開始から終了まで再現し、未確認候補 0、実際の結果画面、低速時の表示を確認 | BLOCKED |
| DOCS-405 | 検出チュートリアルを E2E 証拠で完成 | `docs/users-guide.md` | ANN-28, AST-22, TRN-33, REP-10, INF-13〜15 | 検出フローを開始から終了まで再現し、矩形、negative sample、結果 overlay を確認 | BLOCKED |
| DOCS-406 | troubleshooting を実際の失敗証拠で完成 | `docs/users-guide.md` | SEC-01〜08, REL-03〜04, STO-03, PKG-11〜14 | 権限拒否、Reference 切れ、OOM、容量不足、worker failure、rollback の再現済み対処だけを記載 | BLOCKED |
| DOCS-407 | current architecture 対応表を本実装へ更新 | `docs/architecture.md`, `images/*.svg` | Gate 4 | planned component を実在 source へ置換し、不要になった予定ノードを削除。実装と図の差分 0 | BLOCKED |

DOCS-401〜406 は `docs/users-guide.md` を共有するため、検証自体は OS / 機能別に並列実行できるが、文書への統合は一人の owner が直列で行う。

### 8.6 Wave 5 — 最終レビュー

| ID | 作業 | 出力 | 依存 | 完了条件 | 規模 |
|---|---|---|---|---|---|
| DOCS-501 | 一般利用者レビュー | review record と修正 | DOCS-401〜406 | 開発ツールを知らない reviewer が、README から対象 OS の導入、初回設定、いずれかのチュートリアル、トラブル対処へ到達できる | M |
| DOCS-502 | 新規開発者レビュー | review record と修正 | DOCS-306, DOCS-407 | repository 未経験の engineer が、要求 ID から変更対象、test、文書更新までを追跡できる | M |
| DOCS-503 | セキュリティ／プライバシー／ライセンスレビュー | review record と修正 | DOCS-501, DOCS-502 | Cloud 境界、カメラ、Reference、ログ、モデル承認、入力権利の説明が要求定義と一致する | M |
| DOCS-504 | アクセシビリティと SVG 表示レビュー | review record と修正 | DOCS-503 | keyboard でリンクへ到達でき、200% 表示、high contrast、screen reader 向け title / desc、印刷で図を判別できる | M |
| DOCS-505 | Documentation Gate | final verification record | DOCS-504 | §11 の全検証と §12 の受入チェックが合格し、未達事項があれば完成扱いにせず明記する | S |

## 9. 依存順序と並列実行

### 9.1 推奨実行順

1. DOCS-001〜003 で事実、変更分離、表記規約を固定する。
2. DOCS-101〜107 で README と users guide の骨格を整える。
3. DOCS-201〜203 で developer / architecture 文書の本文構成を固定する。
4. DOCS-204〜208 の SVG を並列作成する。
5. DOCS-209〜306 で組み込み、相互リンク、自動検証を完成する。
6. 対応する製品タスクが合格するたびに DOCS-401〜407 を実行する。
7. Gate 4 と installer Gate 後に DOCS-501〜505 を実行する。

### 9.2 同時編集禁止

- `docs/users-guide.md`: DOCS-102 → 103 → 104 → 105 → 106 → 107 → 401 → 402 → 403 → 404 → 405 → 406。
- `README.md`: DOCS-101 → DOCS-301。
- `docs/developer-guide.md`: DOCS-201 → 202 → 209。
- `docs/architecture.md`: DOCS-203 → 209 → 407。
- `package.json`: 現行の製品版対応差分 → DOCS-305。
- `docs/implementation-plan.md`: 現行の製品版対応差分 → DOCS-302。

SVG 5 ファイルは本文構成の確定後、出力ファイルが重ならないため並列作成できる。

### 9.3 即時実行可能範囲

現在の Windows repository だけで DOCS-001〜306 まで実行できる。ただし次を守る。

- installer や feature の実操作手順を完成扱いにしない。
- macOS 固有手順を Windows で検証済みにしない。
- `docs/users-guide.md` の未実装 section は削除せず、状態と完了条件を明記する。
- 現在の未コミット製品版対応差分を上書きしない。

DOCS-401〜505 は製品機能、OS 実機、署名、Gate の依存に従い停止する。

### 9.4 製品実装タスクとの接続状態

| Prefix / Gate | 対象 | 現在の境界 | 本書で待機するタスク |
|---|---|---|---|
| Gate 1 | 両 OS の architecture / packaging / Reference / inference PoC | native Mac、clean Windows、残 PoC が必要 | DOCS-403、DOCS-407 |
| Gate 2 | C6 / C7 model、quality、AutoML budget | 承認済み model なし | DOCS-404〜405 |
| CORE-* | Project、診断 | Phase D、Gate 1 待ち | DOCS-403 |
| DAT-* | import、Copy / Reference | Phase F、CORE / JOB / SPI-19 待ち | DOCS-403 |
| ANN-* | Label Schema、annotation、Dataset Revision | Phase G、Data import 待ち | DOCS-404〜405 |
| AST-* | initial / Project model assist | Gate 2 と annotation / training 待ち | DOCS-404〜405 |
| TRN-* / REP-* | training、Model Version、report | Gate 2 / 3 と annotation 待ち | DOCS-404〜405 |
| INF-* | camera permission、profile、inference、performance | model / training と OS 実機待ち | DOCS-404〜405 |
| SEC-* / REL-* / STO-* | hardening、復旧、storage | 主要 feature 完了待ち | DOCS-406 |
| PKG-* | freeze、installer、署名、servicing | Gate 4、正式署名 identity、OS 実機待ち | DOCS-401〜402 |
| Gate 4 | assist → train → report → camera の両タスク／両 OS E2E | 未実施 | DOCS-407、Wave 5 |
| Gate 5 | signed installer、offline、SBOM、全受入 | 未実施 | Gate D3 |

上表は実装状態の要約であり、各タスクの正確な依存と完了条件は `docs/implementation-plan.md` を優先する。要求定義が Draft であること自体は Gate D1 の文書骨格作成を妨げない。ただし要求文、版、hash のいずれかが変わった場合は DOCS-301 で影響範囲を再評価し、古いベースラインのまま後続 Gate を通さない。

DOCS-301 を人が起動することだけに依存しない。DOCS-303 は `docs/requirement-definition.md` の作業ツリー bytes と、CRLF を LF へ正規化した bytes の SHA-256 を計算し、README と文書 baseline に宣言した値の両方と照合する。要求定義が変更された PR / commit では `npm test` 内の `verify:docs` が失敗し、DOCS-001 / 301 と traceability の更新を促す。

## 10. 要求トレーサビリティ

### 10.1 文書と要求の対応

| 文書／図 | 主な要求・設計根拠 |
|---|---|
| README の目的・機能・対象範囲 | 要求定義 §1〜§6、§12、§16 |
| README の offline / privacy | §3.3、FR-SEC-001〜013、NFR-SEC-001〜004 |
| README の install / platform | §4、FR-INS-001〜020、NFR-INS-001〜008 |
| users guide の診断 | FR-SYS-001〜005 |
| users guide の Project / import | FR-PRJ-001〜010、FR-DAT-001〜016 |
| users guide の annotation | FR-ANN-001〜014、101〜107、201〜209 |
| users guide の assist | FR-AST-001〜020、NFR-ANN-003〜007 |
| users guide の training / model / report | FR-TRN-001〜021、FR-MOD-001〜005、FR-REP-001〜012 |
| users guide の camera | FR-INF-001〜019、NFR-PERF-003〜006 |
| users guide の install / servicing | FR-INS-001〜020、NFR-INS-001〜008 |
| developer guide の変更手順 | `docs/implementation-plan.md` §4 / §7 / §9、CONTRIBUTING §1〜§5 |
| architecture / component diagram | 要求定義 §9 / §13、ADR-0001 |
| repository structure diagram | 現行 source tree、実装計画 §7〜§8 |
| data lifecycle diagram | ADR-0002、要求定義 §5 / §9 / §10 |
| packaging 説明 | ADR-0003、FR-INS、NFR-INS |
| customization flow diagram | 要求定義、実装計画、CONTRIBUTING |

### 10.2 非機能要求の対応

| Requirement | 主な記載先 | 最終検証タスク |
|---|---|---|
| NFR-PERF-001〜002 | architecture の UI / queue 境界、users guide の長時間処理説明 | DOCS-403〜405, DOCS-407 |
| NFR-PERF-003〜007 | users guide の camera / 学習性能、architecture の inference / training 境界 | DOCS-404〜405, DOCS-407 |
| NFR-REL-001〜005 | architecture の不変性／atomic commit、users guide の復旧／camera release | DOCS-406〜407 |
| NFR-SEC-001〜004 | README の local / offline、users guide の privacy / diagnostic、developer guide の security review | DOCS-406, DOCS-503 |
| NFR-UX-001〜004 | 全利用者文書の日本語／進捗説明、全 SVG の非色依存、developer guide の accessibility DoD | DOCS-501〜504 |
| NFR-MNT-001〜004 | developer guide の exact lock / test、architecture の traceability / OS gate | DOCS-502〜503 |
| NFR-STO-001〜003 | users guide の import capacity / storage / safe deletion、data lifecycle 図 | DOCS-403, DOCS-406 |
| NFR-INS-001〜008 | users guide の OS 別 install / servicing、architecture の packaging 境界 | DOCS-401〜402, DOCS-504 |
| NFR-ANN-001〜008 | users guide の annotation / assist、component / data lifecycle 図、accessibility | DOCS-404〜405, DOCS-503〜504 |

### 10.3 変更時の追跡規則

- 文書内で挙動を説明する段落は、最も近い節に対応要求 ID または ADR を記載する。
- 同じ要求 ID を全段落へ繰り返さず、節単位の「対応要求」でまとめる。
- source file の一覧は現行実装対応表だけを正本とし、複数文書で同じ一覧を複製しない。
- 要求定義にない新挙動を説明する必要が生じた場合、先に要求変更レビューを行う。
- 要求定義を変更した場合は文書バージョン、README の基準表記、実装計画の traceability、hash の byte 基準を同時に再確認する。
- 実装完了の主張には test または実機 evidence を結びつけ、設計文書だけを完了証拠にしない。

### 10.4 既存 `DOC-*` タスクとの対応

既存 `DOC-01`〜`DOC-10` が、製品機能の実装・実測後に各節を完成させる正本タスクである。本書の DOCS-10x は構造と検証欄を準備し、DOCS-40x は横断 E2E evidence を反映する補助タスクであり、既存 `DOC-*` を完了扱いにしない。各既存 `DOC-*` の owner が最終本文と requirement / UI 一致に責任を持つ。

| 既存タスク | 本書で準備する内容 | 最終化タスク |
|---|---|---|
| DOC-01 Project / 診断 guide | DOCS-102〜104 | DOCS-403 |
| DOC-02 Data import guide | DOCS-104, DOCS-107 | DOCS-403 |
| DOC-03 Annotation guide | DOCS-105〜106 | DOCS-404〜405 |
| DOC-04 Initial assist guide | DOCS-105〜107 | DOCS-404〜405 |
| DOC-05 Training / version guide | DOCS-105〜107 | DOCS-404〜405 |
| DOC-10 Project model assist guide | users guide の assist / additional training 節 | DOCS-404〜405 |
| DOC-06 Report guide | tutorial の結果確認節 | DOCS-404〜405 |
| DOC-07 Camera guide | tutorial と privacy 節 | DOCS-404〜405 |
| DOC-08 Troubleshooting / security / storage | DOCS-107 | DOCS-406 |
| DOC-09 Install / servicing guide | install 章の検証テンプレート | DOCS-401〜402 |

## 11. 検証計画

### 11.1 自動検証

`scripts/docs/verify-documentation.mjs` は、Node.js 標準の `fs` / `path` / `url` と既存 lock 内の `jsdom` だけを使用し、新規 dependency を追加しない。SVG は `JSDOM` の XML content type で parse する。Markdown は本リポジトリで使用する ATX heading と inline / reference link を対象とし、GitHub 互換 slug の重複 suffix を含めて検査する。現行依存だけで安全に実装できない場合は DOCS-303 を停止し、依存ポリシーに従う別の採用タスクを起票する。暗黙に package を追加しない。次を検査する。

1. 必須文書と 5 SVG が存在する。
2. README に `docs/users-guide.md`、`docs/developer-guide.md`、`docs/architecture.md` へのリンクがある。
3. `README.md` の誤記ファイル `REAMDE.md` が存在しない。
4. Markdown のローカル相対リンク先が存在する。
5. Markdown の fragment が対象文書の見出しへ解決できる。
6. `/images` の参照図が `.svg` であり、他の diagram directory へ分散していない。
7. SVG を XML として parse できる。
8. SVG に `viewBox`、`role="img"`、`aria-labelledby`、`title`、`desc` がある。
9. SVG に `script`、`foreignObject`、外部 `href`、外部 stylesheet / font / image がない。
10. 要求定義の raw bytes と LF-normalized bytes の SHA-256 が宣言値と一致する。
11. 文書中の `FR-*` / `NFR-*` ID と `PREFIX-NNN〜MMM` 範囲を展開した各 ID が `docs/requirement-definition.md` に存在する。
12. `docs/users-guide.md` の各主要章に固定書式の機能状態、文書成熟度、根拠、最終化条件があり、許可値以外を使っていない。
13. architecture の現行 source path が実在するか、明示的に `planned` とされている。
14. status 語が §3.4 の定義外になっていない。

検証スクリプト自体には、正常ケースと最低限次の負例を用意する。

- 存在しない Markdown link
- 存在しない fragment
- `<title>` または `<desc>` のない SVG
- 外部 URL を参照する SVG image / stylesheet
- 要求定義に存在しない requirement ID
- `/images` 外の必須図

負例は `node:test` の一時 directory に作成し、repository に fixture directory を残さない。各失敗は検査名、対象 file、可能なら line、問題値、修正方針を出力する。

### 11.2 文書変更時の実行項目

- 文書検証スクリプトの unit test
- `npm run verify:docs`
- `git diff --check`
- VS Code diagnostics
- 変更した Markdown の見出し／目次確認
- 変更した SVG の 100% / 200% 表示確認
- README から全読者導線を実際にたどる確認

`package.json` または検証スクリプトを変更した場合は、既存の version test、Node test、typecheck、build への影響も確認する。文書だけの変更で、未関係の ML / installer 実機試験を合格条件にしない。

### 11.3 実測レビュー

| レビュー | 環境 | 確認内容 |
|---|---|---|
| 一般利用者 Windows | clean Windows 11 x64、標準ユーザー | download 後の検証、install、起動、設定、tutorial、servicing |
| 一般利用者 macOS | clean Apple Silicon Mac | PKG、署名、Gatekeeper、Applications、設定、tutorial、servicing |
| 開発者 Windows | exact Node / npm / uv / Python | restore、test、typecheck、build、要求から変更箇所の追跡 |
| 開発者 macOS | native Apple Silicon、exact toolchain | OS 固有 restore / test、MPS / CoreML / package 境界の理解 |
| accessibility | 200% zoom、keyboard、screen reader、高コントラスト | 文書ナビゲーション、図の title / desc、色以外の区別 |

一般利用者向けの「clean」は、AutoVision Studio の旧版、Python、Node.js、uv、CUDA Toolkit、Homebrew、Rosetta、Xcode、VS Code などの開発ツールがなく、対象 OS の標準機能と必要な GPU / camera driver だけがある状態を指す。開発者向け環境は別枠とし、exact toolchain を導入した状態で確認する。

## 12. 受入チェックリスト

### 12.1 README

- [ ] 両読者に共通する §6.1 の 14 項目がある。
- [ ] 完成版／インストーラーの有無が最初の画面範囲で分かる。
- [ ] 「インストール・設定・チュートリアル」リンクが `docs/users-guide.md` を指す。
- [ ] 開発者が developer guide と architecture へ直接移動できる。
- [ ] 詳細手順を README に重複掲載していない。

### 12.2 一般利用者向け文書

- [ ] Windows と macOS の要件、入手、署名／checksum、install、起動がある。
- [ ] 開発用 Node.js / Python / package manager を一般利用者へ要求していない。
- [ ] 初回診断とアプリケーション内設定の意味が説明されている。
- [ ] 分類チュートリアルが Project 作成から推論停止まで連続している。
- [ ] 検出チュートリアルが COCO / 矩形 / negative sample を含む。
- [ ] Copy / Reference のデータ所有権と削除境界が明確である。
- [ ] Model Suggestion を自動正解化しないことが明確である。
- [ ] error、cancel、retry、relink、rollback の案内が実装と一致する。
- [ ] 手順ごとに検証製品版と OS が記録されている。

### 12.3 開発者向け文書

- [ ] exact toolchain と実在する検証入口が記載されている。
- [ ] repository の物理構造と各 directory の責務が一致する。
- [ ] Renderer / Preload / Main / Python / persistence の境界が説明されている。
- [ ] 要求 ID の特定から code / test / docs / evidence まで追跡できる。
- [ ] 要求にない変更と ADR 変更の手順がある。
- [ ] dependencies、models、licenses、OS 固有変更の Gate がある。

### 12.4 SVG

- [ ] 5 ファイルが `/images` にある。
- [ ] XML parse、`viewBox`、title、desc、ARIA が合格する。
- [ ] 外部 resource、script、`foreignObject` がない。
- [ ] 文字切れ、重なり、矢印欠落がない。
- [ ] status を色だけで区別していない。
- [ ] 本文の説明と図のノード／エッジが一致する。

### 12.5 整合性

- [ ] broken local link と broken fragment が 0 件である。
- [ ] 不明な requirement ID が 0 件である。
- [ ] 未実装を実装済みとする記述が 0 件である。
- [ ] 一般利用者向け手順と開発者向けセットアップが混在していない。
- [ ] README、users guide、developer guide、architecture、ADR 間に相互矛盾がない。

## 13. リスクと対策

| ID | リスク | 影響 | 対策 |
|---|---|---|---|
| DR-01 | 機能未実装のまま操作手順を具体化する | 利用者が実行できず、文書への信頼を失う | 骨格と要求由来説明だけを先行し、DOCS-401〜407 を実装／実測 Gate 後に実施 |
| DR-02 | ADR の目標設計を現行実装として図示する | 開発者が存在しない API / directory を探す | status 凡例、現行実装対応表、planned の破線を必須化 |
| DR-03 | README が大きくなり詳細文書と重複する | 更新漏れと矛盾 | README は共通事項と導線に限定し、手順をリンク先へ置く |
| DR-04 | users guide と developer guide のセットアップが混在する | 一般利用者へ開発ツール導入を要求してしまう | installer 手順と source build 手順を別文書へ完全分離 |
| DR-05 | Windows の結果で macOS 手順を確定する | 誤った署名、権限、package 案内 | native Apple Silicon の DOCS-402 と reviewer を必須化 |
| DR-06 | SVG が装飾中心で読めない | accessibility と保守性低下 | 共通規約、自動検査、200% / screen reader review |
| DR-07 | source tree の進化で図が陳腐化する | カスタマイズ先を誤る | Gate ごとに DOCS-407、source path 自動検査、PR DoD に architecture 判定を追加 |
| DR-08 | 要求定義とチュートリアルがずれる | 必須手順や安全条件の欠落 | 節単位 requirement mapping と不明 ID の自動検査 |
| DR-09 | 現在の未コミット変更を上書きする | 製品版対応作業の損失または混在 | DOCS-002、same-file 直列化、文書整備前の baseline 固定 |
| DR-10 | 見出し変更で外部／内部リンクが切れる | ナビゲーション不能 | 既存 anchor を維持し、fragment checker を導入 |
| DR-11 | Draft 要求の変更後も旧 mapping を使う | 文書と要求の追跡が無効になる | 版と CRLF / Git blob hash を DOCS-001 / 301 で照合し、変更時は影響 task を再実行 |

## 14. Documentation Gate

### Gate D0 — 構造承認

**入力:** DOCS-001〜003。

**合格条件:** 読者、成果物、既存文書の再利用、状態語、5 SVG、`/README.md` の誤記補正がレビュー済みであり、要求定義 v0.3 Draft の版と二種類の hash が DOCS-001 の baseline に記録されている。

### Gate D1 — 現状文書完成

**入力:** DOCS-101〜306。

**合格条件:** 現時点の実装状態を正確に説明し、一般利用者向け未実装手順を利用可能と誤認させず、developer / architecture 文書と 5 SVG が存在し、自動検査が合格する。

Gate D1 は製品の利用可能性やリリース準備完了を意味せず、DOCS-401 / 402 を unblock しない。OS 別の操作手順へ進む条件は Gate D2 と各 `PKG-*` / `D-16` 依存で判定する。

### Gate D2 — 操作文書実測完了

**入力:** DOCS-401〜407、Gate 4、OS 別 package / E2E evidence。

**合格条件:** Windows / macOS の install、設定、分類、検出、training、report、camera、servicing、troubleshooting が実機で再現され、手順と図が一致する。

### Gate D3 — 最終受入

**入力:** DOCS-501〜505、FIN-01〜06。

**合格条件:** 一般利用者、開発者、security / license、accessibility のレビューが閉じ、§12 が全件合格する。Windows の証拠で macOS を代替せず、native Apple Silicon Mac による DOCS-402 と関連 E2E / accessibility evidence がない場合は Gate D3 を通さない。未達必須項目が一つでもあれば Gate D3 を不合格とし、README と users guide に利用不可状態を維持する。

## 15. 実行開始単位

承認後の最初の実行単位は **DOCS-001 のみ**とする。現在の未コミット差分を保存・識別した後、DOCS-002、DOCS-003 へ進む。

最初の実装 wave では次の順を推奨する。

1. 現在状態の fact matrix を作る。
2. `docs/users-guide.md` の誤った現状注記だけを修正する。
3. `docs/developer-guide.md` と `docs/architecture.md` の見出し・状態凡例を作る。
4. README の読者別導線を追加する。
5. 本文構成がレビューされた後に SVG を作る。

この順序により、見栄えのよい図を先に作って誤った設計を固定することと、未実装機能の操作手順を先行して捏造することを防ぐ。