# AutoVision Studio — 開発・検証方針

> このファイルは `docs/implementation-plan.md` §1.3、§4、§5 と ADR-0001、ADR-0003 を根拠とする。
> 実装コードはまだ存在しない（2026-09-02 時点）。

---

## 1. 小タスク規約

### 1.1 1 タスクの上限

| 上限 | 通常値 | 超える場合 |
|---|---|---|
| production ファイル | 1〜3 | 開始前にタスクを分割する |
| test ファイル | 1〜2 | 同上 |
| documentation section | 1 | 同上 |
| 要求グループ | 1 つ | 同上 |
| 完了条件 | 観測可能な **1 挙動** | 同上 |

migration とそれを使う repository、backend と UI、Windows と macOS、分類と検出は原則として別タスクにする。

### 1.2 Context Pack（各タスク開始時に読むものだけ）

1. 対象 requirement ID
2. 依存 ADR の該当節
3. 編集対象ファイル全文
4. 直接 import 先・元
5. 隣接 test

リポジトリ全体の再読み込みは phase gate のときだけ行う。

---

## 2. 各タスクの完了手順

1. **対象要求と非対象を再確認する。**
2. **1 挙動だけ実装する。**
3. **その挙動の unit/integration test を追加する。**
4. Type/lint/editor diagnostics を確認する。
5. 対象 test だけを実行し、合格を確認する。
6. user-visible 挙動なら `docs/users-guide.md` の該当節を更新する別 DOC タスクを続ける。
7. phase gate で初めて広い suite を実行する。

### 2.1 必須: 対象 test の合格前に依存タスクを開始しない

- あるタスクの test が合格していない状態で、そのタスクを依存とする後続タスクを開始してはならない。
- 合格の証拠は実行コマンド・環境・終了コード・出力要約として記録する。CI が存在する場合は CI ログも残す。実行していない検証を「合格済み」と扱わない。

### 2.2 必須: 敵対的レビューと振り返り

各タスクの test が通過した後、**合格前の依存タスクの開始に先立って**次を行う。

1. 実装が対象要求のみを満たし、非対象要求・将来拡張を含んでいないか確認する。
2. 境界条件・失敗経路・敵対的入力（未定義の状態遷移、空ペイロード、不正 path 等）で実装が壊れないか確認する。
3. 確認結果を PR の description または review comment として記録する。
4. 問題が見つかった場合は同タスク内で修正する。
5. 修正後に対象 test・diagnostics・指摘項目を再確認し、レビュー所見が閉じたことを記録してから依存タスクを開始する。

---

## 3. 依存順序と並列安全

- `docs/implementation-plan.md` §7 のタスク表の `依存` 欄に記載されたタスクまたは Gate が完全に合格してから後続タスクを開始する。
- **出力ファイルが重ならないタスクだけを並列実行できる。** 同じ migration ファイル、shared contract、model manifest を同時に編集しない。
- 分類と検出の並列化は shared contract が固定された後のみ許可する。
- `docs/implementation-plan.md` §5.1 の lane 設計（UI / Core / ML-Class / ML-Detect / Release-Windows / Release-macOS / Docs）に従う。

---

## 4. 禁止事項（YAGNI・無関係リファクタリング禁止）

- 対象タスクに記載されていない無関係なリファクタリングをタスク内で行わない。
- 将来の拡張を見越した抽象層・Strategy/Factory/DI container/汎用スケジューラを先行して作らない。
- Redux 等の全体状態管理、localhost API、常駐 server、汎用 RPC を導入しない。
- 要求に明記された失敗経路、または実際に再現した失敗経路以外の予防的エラー処理を追加しない。
- 使用されていないフラグ・設定・コードパスを追加しない。

---

## 5. 事実・根拠ポリシー

- 実測していない数値、存在しないファイルパス、動作確認していないコマンドを実装済みとして記録しない。
- 一次資料（公式ドキュメント URL・取得日・hash または pull request 番号）を確認できない場合は、その判断を成功扱いにしない。該当 Gate を停止する。
- 文書タスク（ADR、policy、guide）の証拠欄は、一次資料 URL・取得日・hash または判断記録で埋める。空欄は不合格とする。
- モデルの hash/quality/license/intended-use が確認できない場合、manifest への登録とモデル固有実装を開始しない（`docs/dependency-policy.md` §4/§6、`docs/implementation-plan.md` D-08/D-09）。
- text file の SHA-256 は、**Git blob bytes（通常 LF）**と**作業ツリー bytes（`core.autocrlf` により CRLF になり得る）**のどちらかを明記する。byte 基準を記載していない異なる hash を不整合判定に使わない。

---

## 6. Windows 上のコマンド実行規約

- Windows で PowerShell を使う場合は **`pwsh.exe`（PowerShell 7+ / Core）の最新インストール済み版を使う。**
- `powershell` / `powershell.exe` / Windows PowerShell 5.1 を直接実行しない。
- `pwsh` が見つからない場合は 5.1 へフォールバックせず、PowerShell 7+ が必要であることを報告して停止する。
- 自動化・ビルド・テスト・一回限りのコマンドは `pwsh.exe -NoLogo -NoProfile` を使用する。
- `.ps1` ファイルは `pwsh.exe -NoLogo -NoProfile -File <path>` で実行する。

---

## 7. macOS 検証境界

- macOS の build（Python onedir・PKG）、MPS/CoreML、カメラ権限、Developer ID 署名、Notarization、Gatekeeper 試験は **native Apple Silicon Mac 上でのみ** 実施する。
- Windows 上でこれらの検証を合格扱いにしない（ADR-0003 §2.4）。
- SPI-04/06/08/09/SPI-19（macOS 側）、Gate 1/4/5 の macOS 条件は、native Mac を用意できるまで「未判定」とする。
- macOS 固有の結果は `spikes/packaging/macos-result.md` 等の OS 別ファイルに記録し、Windows 結果と混在させない。

---

## 8. 依存ロック方針

### npm（TypeScript/Electron）

- `package-lock.json` を Git で追跡する。
- `npm ci` を使い、`npm install` による暗黙更新をビルドスクリプトに含めない。
- 依存を追加・更新するときは `docs/dependency-policy.md` の審査手順を先に完了する。

### uv（Python）

- `ml/uv.lock` を Git で追跡する。
- `uv lock --check` で整合を確認し、`uv sync --locked` を使って lock ファイルを暗黙更新しない。
- Python 依存を追加・更新するときは `docs/dependency-policy.md` の審査手順を先に完了する。

### 現行 scaffold のローカル検証

- Node.js は `24.19.x`、npm は exact `12.0.0`、uv は exact `0.12.9` を使う。system npm が別版なら実行を継続しない。
- npm 12.0.0 は組織承認済みの方法で用意し、その `bin` directory を PATH の先頭へ置く。これにより `build` 内の nested `npm run` も同じ npm を使う。環境固有の cache path はリポジトリへ固定しない。
- `npx` / `npm exec` による lock 外 package の自動取得を検証手順に使わない。導入済み package script または `node_modules/.bin` の実体だけを使う。
- Node 側は repository root で `npm test`、`npm run typecheck`、`npm run build` を実行する。
- Python 側は **`ml/` を作業 directory** とし、`uv lock --check --system-certs`、`uv sync --locked --system-certs`、`uv run --locked --system-certs pytest -q`、Ruff check / format check、`..\node_modules\.bin\pyright.cmd` を実行する。repository root から設定 file を推測させない。
- VS Code / Pylance の interpreter は `ml/.venv` を選択する。system Python の import 診断を project dependency の欠落証拠へ転用しない。

---

## 9. 秘密情報・署名鍵

- API キー、署名証明書、パスフレーズ、個人アクセストークン等を Git にコミットしない。
- `vendor/models/`（承認済み重み）、Electron/Python build 出力、local project キャッシュは `.gitignore` で除外する（タスク A-10 で設定）。
- `.gitignore` に追加する例外（追跡対象）: `package-lock.json`、`ml/uv.lock`、`ml/packaging/*.spec`。

---

## 10. コミット・PR の証拠要件

- コミットメッセージには対象タスク ID（例: `feat(B-04): Electron lifecycle`）を含める。
- PR の description に「対象要求 ID」「完了条件の達成根拠」「対象 test の実行結果（コマンドと出力抜粋）」を記載する。
- phase gate では「Gate 合格条件」と「実測値または判断記録」を PR または Gate 記録ドキュメントに記録する。

---

## 11. 生成物の取り扱い

- PyInstaller onedir、Electron distributable、ONNX export などのビルド生成物は Git にコミットしない。
- spikes のコードは `spikes/` に隔離し、Gate 記録後に不要な spike は削除する。採用部分のみ production ファイルへ移す（ADR-0003 §3）。
- `resources/models/manifest.json` には法務・hash・実機品質の gate を通過したモデルだけを登録する。未承認モデルを placeholder として記載しない（`docs/dependency-policy.md` §6、`docs/implementation-plan.md` D-08/D-09）。

---

## 12. 未実行コマンドの扱い

> B フェーズ完了前はアプリケーションコード・Python 環境・Node package が存在しない。

- 以下のコマンドは **B フェーズのタスク完了後に追加する**。それ以前に記述しない。

| コマンド | 追加タイミング |
|---|---|
| `npm ci` / `npm run build` | B-01 完了後 |
| `uv lock --check` / `uv sync --locked` | B-11 完了後 |
| `uv run pytest` | B-13 完了後 |
| `npm test`（lock 済み Vitest） | B-10 完了後 |
| lock 済み Playwright を呼ぶ project script | C 〜 D フェーズ以降、依存採用 task 完了後 |
| PyInstaller freeze | SPI-03/04 完了後 |
| electron-builder package | SPI-05/06 完了後 |

- 現時点では上記コマンドを「動作確認済み」として案内しない。
