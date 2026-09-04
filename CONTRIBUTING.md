# AutoVision Studio — 開発・検証方針

> このファイルは `docs/requirement-definition.md` v0.4、`docs/implementation-plan.md` §1.3、§4〜§6 と ADR-0001、ADR-0003 を根拠とする。Version 1 の開発・検証・リリース対象は Windows 11 24H2 以降 x64 のみであり、macOS は将来 backlog である。
> 2026-09-02 の作成時点では実装コードはまだ存在しなかった。この記述は履歴として残し、現在の開発手順と実装状態は [`docs/developer-guide.md`](docs/developer-guide.md) と [`docs/architecture.md`](docs/architecture.md) を参照する。

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

migration とそれを使う repository、backend と UI、分類と検出は原則として別タスクにする。将来 macOS 対応へ着手する場合も、Version 1 の Windows タスクへ混在させず別タスクにする。

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
- Version 1 は `docs/implementation-plan.md` §5.1 の **UI / Core / ML-Class / ML-Detect / Release-Windows / Docs / Version** lane に従う。
- **Future Release-macOS** lane は Version 1 の DAG、依存完了率、Gate 1〜5、release 判定へ接続しない。macOS 向け task ID や共有 task 内の macOS 項目は将来 backlog として保持する。

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

## 7. OS 別検証境界

### Version 1 — Windows

- Gate 1〜5 と release 判定には、Windows 11 24H2 以降 x64 の実機、package、署名、offline、servicing、性能、権限の証拠だけを使用する。
- Windows の完了証拠を macOS の合格証拠へ転用しない。同時に、macOS の未実行・未判定・失敗を Version 1 の Windows Gate の blocker にしない。
- OS 別 manual test や結果ファイルに両 OS の欄がある場合、Version 1 では Windows 欄だけを完了条件とし、macOS 欄は `FUTURE` または履歴上の `NOT_RUN` として分離する。

### Future — macOS

- macOS の Python wheel/依存 lock 再評価、Python onedir、MPS/CoreML、カメラ権限、PKG、Developer ID 署名、Hardened Runtime、notarization、stapling、Gatekeeper、servicing、payload parity は将来 backlog である。
- 将来着手時は native Apple Silicon Mac 上で新しい要求、依存監査、PoC、Gate、署名 identity、実機証拠を再決定する。Windows 上の結果だけで合格扱いにしない（ADR-0003 §2.4）。
- SPI-04、SPI-06、PKG-03、PKG-06、PKG-08、PKG-12、PKG-18、PKG-20、PKG-21、および共有 task の macOS 部分は Version 1 の依存・完了率・Gate から除外する。
- C0 当時の両 OS 依存調査、macOS 用 marker、保存済み `NOT_RUN`、macOS 結果文書は当時の履歴事実として変更・削除しない。それらを現在の macOS 対応または合格の主張には使わない。
- macOS 固有の将来結果は `spikes/packaging/macos-result.md` 等の OS 別ファイルに記録し、Windows 結果と混在させない。

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
- Version 1 の開発・Gate は Windows 11 x64 の Python 3.14 環境だけを対象とする。`ml/uv.lock` に残る C0 当時の macOS marker や Python 3.13 解決結果は履歴・将来互換の入力であり、Version 1 で macOS 環境を同期・検証する義務を生じさせない。
- 将来 macOS 対応では、既存 lock の再利用を前提にせず、native Apple Silicon Mac で Python minor、wheel、license、脆弱性、freeze を再監査して exact lock を更新する。

### 現行 scaffold のローカル検証

- Node.js は `24.19.x`、npm は exact `12.0.0`、uv は exact `0.12.9` を使う。system npm が別版なら実行を継続しない。
- npm 12.0.0 は組織承認済みの方法で用意し、その `bin` directory を PATH の先頭へ置く。これにより `build` 内の nested `npm run` も同じ npm を使う。環境固有の cache path はリポジトリへ固定しない。
- `npx` / `npm exec` による lock 外 package の自動取得を検証手順に使わない。導入済み package script または `node_modules/.bin` の実体だけを使う。
- Version 1 の Node 検証は Windows 上の repository root で `npm test`、`npm run typecheck`、`npm run build` を実行する。
- Version 1 の Python 検証は Windows 上で **`ml/` を作業 directory** とし、Python 3.14 を使う `ml/.venv` に対して `uv lock --check --system-certs`、`uv sync --locked --system-certs`、`uv run --locked --system-certs pytest -q`、Ruff check / format check、`..\node_modules\.bin\pyright.cmd` を実行する。repository root から設定 file を推測させず、macOS 用環境の作成や native package 検証を Version 1 の前提にしない。
- VS Code / Pylance の interpreter は `ml/.venv` を選択する。system Python の import 診断を project dependency の欠落証拠へ転用しない。

---

## 8.1 製品バージョン管理

### 製品バージョンの正本と形式

- AutoVision Studio の製品バージョンは、root `package.json` の `version` だけを正本とする。
- 許可する形式は、先頭ゼロを持たない非負整数3要素の `MAJOR.MINOR.PATCH` とする。ただし各要素の値が `0` の場合は単独の `0` を許可する。
- `v` prefix、prerelease suffix、build metadata、空白を製品バージョンへ含めない。現行model manifest schemaで表現できず、release channel要件もないためである。
- major/minor/patchの値からデータ互換性を推測しない。同一版、新版、旧版の数値順だけを判定し、実際のデータ互換性はmigrationとservicing testで確認する。
- 同一製品バージョンで異なるsourceまたはpayloadを再発行しない。同一版installerの再実行は、既に発行した同一releaseのrepairだけに使用する。

### 独立して管理するバージョン

次は製品バージョンと同じ値であることを要求せず、それぞれの互換性境界で管理する。

| 対象 | 正本 | 整合性の境界 |
|---|---|---|
| ML worker package | `ml/pyproject.toml` | `ml/src/autovision_ml/__init__.py`との既存test。health診断ではcomponent版として返すが、利用者向けheaderには製品版だけを表示する |
| Preload API contract | `src/shared/contracts/app.ts` | Main/Preload/Renderer間のcontract test |
| Release model manifest schema | `resources/models/manifest.schema.json` | JSON Schemaとrelease verifier |
| Project Model Version | Project metadataとmodel artifact | parent、Dataset Revision、artifact hash |
| DB schema | 順序付きmigration | migration runnerとrollback test |

`resources/models/manifest.json`の製品版は次の3状態だけを許可する。

1. `releaseStatus.ready=false`かつ`productVersion`なし: release前の空または部分承認manifestとして許可する。
2. `releaseStatus.ready=false`かつ`productVersion`あり: schema上は許可するが、値はroot product versionと一致しなければならない。release対象が未決定の段階では先行記入しない。
3. `releaseStatus.ready=true`: `productVersion`を必須とし、root product versionと一致しなければならない。

VER-02/03の検査範囲は、root `package.json`、root packageを表す`package-lock.json`の2箇所、release model manifestの`productVersion`の関係だけとする。worker/API/schema/model/DB migration版やinstaller payload hashをこの検査へ混在させず、新規dependencyも追加しない。Packaged Electronの`app.getVersion()`との一致はPKG-04、artifact hashはPKG-15が検証する。

### 製品バージョンの更新順

1. release責任者が変更内容に対応する新しい数値3要素版と変更理由をrelease taskまたはPRへ記録してから明示決定する。実装taskの開始だけを理由に版を変更しない。
2. §8で固定したexact npm 12.0.0の`npm version <MAJOR.MINOR.PATCH> --no-git-tag-version`を使用し、root `package.json`と`package-lock.json`を同時に更新する。他のnpm版では実行しない。実行後はVER-02のcheckerで`package.json.version`、`package-lock.json.version`、`package-lock.json.packages[""].version`が新しい版と一致することを自動確認し、Gitで新しいtagが作成されていないことを確認する。いずれかが不一致なら別コマンドでlockを補正せず、変更を破棄して原因を解消してから再実行する。
3. release manifestに`productVersion`が存在する場合は同じ値へ更新する。未承認の`ready=false` manifestへrelease対象版を先行記入しない。
4. VER-02/03で所有するproduct version検査、aggregate `npm test`、typecheck、aggregate `npm run build`を実行し、lockとmanifestの不一致がないことを確認する。`build:main`、`build:preload`、`build:renderer`の単独実行は対象entryのデバッグ用部分検証であり、product version gateまたはrelease buildの代替にしない。
5. Version 1 の Windows installer build、Windows servicing、Windows payload/SBOM 整合、全 PE と最終 EXE の Authenticode 署名、脆弱性、offline、PKG-15 の artifact checksum 記録を完了する。macOS package、payload parity、Developer ID 署名、notarization はこの step の完了条件に含めない。FIN-06では同じ製品版の既存release tagまたはrelease artifact記録がないことを確認し、存在する場合は同じ版で新しいpayloadを公開しない。
6. Windows の Gate 5 を通過した release commit だけに annotated tag `vMAJOR.MINOR.PATCH` を作成する。将来 macOS 成果物の未完了を Version 1 の tag 作成 blocker にせず、失敗した Windows 候補へ tag を作成せず、既存 release tag を移動・再利用しない。

各stepの検証が失敗した場合は後続stepへ進まず、失敗原因と変更中のfileを確認して同じstepから再実行する。失敗状態のままtag作成またはpayload公開を行わない。

製品はonline update、release channel、nightly product versionを持たない。利用者は新しい署名済みinstallerを手動実行し、同形式のin-place upgradeを行う。

---

## 9. 秘密情報・署名鍵

- API キー、署名証明書、パスフレーズ、個人アクセストークン等を Git にコミットしない。
- Version 1 の release では正式な Windows コード署名証明書と secure timestamp を必須とする。Apple signing identity と notarization credential は将来 macOS lane の開始時に別途決定し、未用意であることを Version 1 の blocker にしない。
- `vendor/models/`（承認済み重み）、Electron/Python build 出力、local project キャッシュは `.gitignore` で除外する（タスク A-10 で設定）。
- `.gitignore` に追加する例外（追跡対象）: `package-lock.json`、`ml/uv.lock`、`ml/packaging/*.spec`。

---

## 10. コミット・PR の証拠要件

- コミットメッセージには対象タスク ID（例: `feat(B-04): Electron lifecycle`）を含める。
- PR の description に「対象要求 ID」「完了条件の達成根拠」「対象 test の実行結果（コマンドと出力抜粋）」を記載する。
- Version 1 の phase gate では「Windows の Gate 合格条件」と「Windows での実測値または判断記録」を PR または Gate 記録ドキュメントに記録する。将来 macOS 欄は Version 1 の合否集計から除外する。

---

## 11. 生成物の取り扱い

- PyInstaller onedir、Electron distributable、ONNX export などのビルド生成物は Git にコミットしない。
- spikes のコードは `spikes/` に隔離し、Gate 記録後に不要な spike は削除する。採用部分のみ production ファイルへ移す（ADR-0003 §3）。
- `resources/models/manifest.json` には法務・hash・実機品質の gate を通過したモデルだけを登録する。未承認モデルを placeholder として記載しない（`docs/dependency-policy.md` §6、`docs/implementation-plan.md` D-08/D-09）。

---

## 12. 初期 scaffold 作成前の未実行コマンドの扱い

> この節は、B フェーズ完了前にアプリケーションコード・Python 環境・Node package が存在しなかった時点の追加条件を記録した履歴である。現在実行するコマンドと前提は [`docs/developer-guide.md`](docs/developer-guide.md) を参照する。

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
