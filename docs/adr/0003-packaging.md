# ADR 0003 — パッケージング方針

| 項目 | 内容 |
|---|---|
| 文書バージョン | 1.1 |
| 作成日 | 2026-09-02 |
| 最終更新日 | 2026-09-04 |
| ステータス | 採用済み（Version 1 Windows MVP） |
| 依存 ADR | なし（A-01 完了後の第一 ADR） |
| 対応タスク | A-04 / WIN-SCOPE-03C |
| 要求基準 | `docs/requirement-definition.md` v0.4 Draft（FR-INS-001〜020、FR-SEC-011、NFR-INS-001〜008） |

---

## 1. コンテキスト

AutoVision Studio Version 1（MVP）は、**Windows 11 24H2 以降の x64 のみ**を対象とする。アプリ本体、Electron/Node runtime、組み込み Python runtime、固定済み依存ライブラリ、ONNX Runtime と CPU EP、Windows accelerator integration、承認済み基盤重み、Annotation Assist Model、SBOM、ライセンス通知を、利用者が起動する **1 ファイルのオフライン自己完結インストーラー**にまとめる必要がある（FR-INS-001〜006）。

Version 1 の配布では、追加 runtime の手動導入、driver の導入・更新、実行時 download、更新確認、テレメトリ、CDN を禁止する。Windows installer と全 PE は Authenticode 署名し、clean install、repair、upgrade、rollback、uninstall を Windows で毎リリース検証する。

macOS arm64、MPS/CoreML、flat PKG、Developer ID 署名、Hardened Runtime、notarization、stapling、Gatekeeper、macOS servicing は将来対応である。既存の調査資料は保持するが、Version 1 の実装、依存関係、PoC、Gate、受入条件、リリース前提には含めない。

---

## 2. Version 1 の決定事項

### 2.1 現行決定

| 項目 | Version 1 の決定 | 根拠 |
|---|---|---|
| 対象 OS / architecture | **Windows 11 24H2 以降 x64 のみ** | RD §1、§4、FR-INS-001 |
| build tool / format | **electron-builder / NSIS 1 ファイル EXE** | D-05、[P02] |
| Python bundle | **PyInstaller onedir** | D-06、[P05] |
| sidecar 組み込み | electron-builder `extraResources` | D-05、[P03] |
| 署名 | **Windows Authenticode**。最終 EXE と全 PE に信頼 CA chain と secure timestamp を適用 | FR-SEC-011、FR-INS-008、[S33]、[W01] |
| install scope | per-user を既定とし、選択時だけ per-machine + UAC | FR-INS-009 |
| 成果物名 | `AutoVision-Studio-<version>-windows-x64.exe` | FR-INS-002 |
| 更新 | 新しい署名済み EXE の手動実行による in-place upgrade | D-12、FR-INS-015 |
| release host | local / self-hosted Windows | D-11 |

NSIS の「1 ファイル」は利用者が起動する配布物を指す。Python worker は PyInstaller `onedir` で生成し、そのディレクトリ全体を EXE payload として同梱する。worker を PyInstaller `onefile` にする決定ではない。

### 2.2 Python sidecar とオフライン境界

- Windows x64 上で native build した PyInstaller `onedir` を使用する。
- worker、固定済み Python dependencies、PyTorch、Optuna、ONNX Runtime CPU EP を含める。
- Windows accelerator integration と CUDA/cuDNN runtime は、承認、再配布検査、Windows 実機 PoC を通過した場合だけ含める。
- pip install、model download、EP download を実行時に行わない。
- GPU/NPU driver は同梱せず、利用不能時は CPU fallback を使う（FR-INS-006）。

---

## 3. 採用理由

- electron-builder は NSIS target と `extraResources` を提供する [P02][P03]。
- PyInstaller `onedir` は worker 起動ごとの一時展開を避けられる。`onefile` は起動時展開を行う [P05]。
- PyInstaller は OS 間クロスコンパイルをサポートしないため、Version 1 bundle は Windows 上でのみ生成する [P05]。
- 更新確認通信を実装せず、新しい署名済み EXE の手動実行で Project を保持したまま更新する。

---

## 4. Version 1 ビルド・検証マトリクス

| Lane | Build host | 成果物 | Python | 署名 | 必須検証 | Version 1 Gate |
|---|---|---|---|---|---|---|
| Windows x64 | Windows 11 24H2+ x64 local / self-hosted | NSIS 1 ファイル EXE | PyInstaller onedir | Authenticode + secure timestamp | offline clean install、初回起動、repair、upgrade、rollback、uninstall、payload/SBOM、署名 | **必須** |
| Future macOS | 将来選定する native Apple Silicon Mac | flat PKG 候補 | PyInstaller onedir 候補 | Developer ID / notarization 候補 | 将来の要求・PoC・Gate で再定義 | **対象外** |

Version 1 の task または Gate は Future macOS lane の machine、証明書、PoC、成果物、試験結果に依存してはならない。Windows の結果を macOS の合格証拠へ転用してはならず、過去の macOS `NOT_RUN` は成功を意味しない。

### 4.1 根拠資料と未検証境界

| 調査事項 | 根拠 | Version 1 で必要な実証 |
|---|---|---|
| electron-builder の NSIS target | [P02] | SPI-05、PKG-05、PKG-11 |
| `extraResources` による directory 同梱 | [P03] | SPI-05、PKG-04〜05 |
| PyInstaller `onedir` と `onefile` の動作差、OS 別 build | [P05] | SPI-03、PKG-02 |
| Windows code signing と Authenticode timestamp | [S33]、[W01] | PKG-07、PKG-11 |
| clean install、rollback、repair、upgrade、uninstall の試験観点 | [P12]、[S34] | MSI の保証とは扱わず、NSIS を PKG-11/13 で実証 |

Apple の [P13]、[S35]、[S36] と electron-builder の macOS 資料 [P02]、[P04] は将来 macOS の候補調査として保持する。これらは AutoVision Studio で flat PKG、Developer ID 署名、Hardened Runtime、notarization、stapling、Gatekeeper、macOS servicing を検証済みであるという主張ではない。

---

## 5. Version 1 PoC・package 試験

次の項目は Windows 実機で合格するまで未確定であり、不合格時は対象 component を再評価する。

| 前提 | 対応 PoC / task | リスク |
|---|---|---|
| Python 未導入の clean Windows で onedir worker の import、health、CPU 実行が成功する | SPI-03 | native extension、hidden import、runtime 欠落 |
| NSIS EXE が onedir を `extraResources` として同梱し、install 後に worker を起動できる | SPI-05 | file 数、path 長、圧縮、resource path |
| accelerator を採用する場合、再配布範囲、PE 一覧、cold start、CPU fallback が合格する | SPI-03、LIC-03 | payload 増大、license、provider 初期化 |
| clean Windows 11 x64 標準ユーザー環境で EXE 1 ファイルから offline install し、再起動なしで Project 作成できる | PKG-11 / POC-11 | runtime、署名、権限、容量 |
| repair、upgrade、旧版拒否、rollback、uninstall が Project を既定保持して完結する | PKG-13 / POC-13 | migration、使用中 file、rollback |
| 最終 EXE と全 PE の Authenticode chain、timestamp、payload hash が合格する | PKG-07 | 署名漏れ、証明書、timestamp service |
| payload inventory と SBOM、license、model manifest、hash が一致する | PKG-14 | 欠落、余剰、unknown license、hash 不一致 |

SPI-04、SPI-06、PKG-03、PKG-06、PKG-08、PKG-12、PKG-18、PKG-20、PKG-21 と macOS 固有試験は Future macOS backlog であり、Version 1 の完了条件または依存 DAG に含めない。

---

## 6. Version 1 リリース前提条件

以下は Gate 5 より前に満たす。未達なら Windows リリースを停止する。

| 条件 | 担当タスク |
|---|---|
| 正式 Windows code-signing 証明書を取得し、秘密鍵を安全に管理する | D-16 |
| 最終 installer と全 PE を信頼 CA chain + secure timestamp で Authenticode 署名する | PKG-07 |
| installer と全 payload の署名・hash を build gate で検証する | PKG-07、NFR-INS-006 |
| offline clean install、repair、upgrade、rollback、uninstall を clean Windows で合格させる | PKG-11、PKG-13 |
| SBOM と `THIRD_PARTY_NOTICES` を全 payload と照合し、欠落、余剰、hash 不一致、unknown license を拒否する | LIC-01、PKG-14、NFR-INS-007 |
| model manifest と payload の承認状態、hash、size を照合する | PKG-01 |
| payload size と一時領域 + 10% を算出し、install 前に検査する | PKG-16〜17、NFR-INS-003 |
| Product ID `io.github.dahatake.autovisionstudio`（暫定 D-10）を正式 build 前に確定する | D-10 |

Apple Developer Program、Developer ID 証明書、Apple Silicon Mac、notarization credential、macOS package 試験は Version 1 のリリース前提ではない。

---

## 7. Windows Authenticode の境界

| 対象 | 方法 |
|---|---|
| 最終 NSIS EXE | Authenticode 署名 + secure timestamp |
| Electron app 内の `.exe` / `.dll` | 同上 |
| Python onedir 内の全 PE | 同上 |
| ONNX Runtime、native addon、採用した accelerator runtime の PE | 同上。再配布条件と既存 vendor signature の扱いを個別確認 |
| install 前 | installer signature、payload signature、payload hash を検証し、不合格なら system 変更前に停止 |

GPU/NPU driver の署名・導入・更新はスコープ外である（FR-INS-006）。実行時の OCSP/CRL は OS の機能であり、本製品が独自実装しない。署名鍵・証明書の保管方法は D-16 で確定する。

### 7.1 Servicing とデータ保持

| 操作 | Version 1 の方針 |
|---|---|
| clean install | per-user を既定とし、offline、再起動なし、Start menu から起動可能にする |
| upgrade | 新しい署名済み EXE を手動実行し、migration 前 backup 後に in-place upgrade する |
| repair | 同一版 EXE の再実行で repair / reinstall を案内する |
| downgrade | 新版導入済み端末への旧版上書きを互換性検査後に既定拒否する |
| rollback | 失敗時に部分 install を除去し、旧版を起動可能な状態へ戻す |
| uninstall | Windows の Apps から到達可能にし、app/runtime を削除する。Project は既定保持する |

Windows Installer 資料 [P12][S34] は試験観点として参照するが、MSI 固有機能を NSIS の実装済み能力として扱わず、PKG-11/13/19 で実証する。log は個人情報、画像、ラベル、Project 内容を含まないローカル log とする。

---

## 8. ペイロード・ライセンス・SBOM 検証

| 検証項目 | 方法 | 担当タスク |
|---|---|---|
| インストーラーへの同梱物を SBOM と照合する | ビルド時に license 生成スクリプトを実行 | LIC-01、PKG-14 |
| 未知・非商用・未承認 copyleft ライセンスがあれば build を失敗させる | 自動 license report、unknown で CI 失敗 | LIC-01 |
| 承認済みモデルバイナリの hash を `resources/models/manifest.json` と照合する | モデル verify スクリプトを実行 | PKG-01 |
| 承認されていないモデルを `vendor/models/` に配置しない | manifest に未登録の binary を通さない | D-08、D-09 |
| CUDA/cuDNN を同梱する場合、NVIDIA SDK Agreement の Attachment A に列挙された redistributable のみを含める | CUDA payload verify スクリプトを実行 | LIC-03 |
| 圧縮 payload・展開後サイズ・一時領域 + 10% 安全余裕を build 時に算出し、preflight manifest に記録する | payload size 計算スクリプトを実行 | PKG-16、NFR-INS-003 |
| 外部フォント・CDN・暗黙 download 参照が存在しないことを URL allowlist で確認する | セキュリティ scan スクリプトを CI で実行 | SEC-06 |

> これらのスクリプトおよび成果物（`docs/release-artifacts.md`・`packaging/payload-size.schema.json` 等）は現時点では存在しない将来の成果物であり、対応タスクの完了後に作成される。

---

## 9. 却下または延期した選択肢

| 選択肢 | Version 1 の判断 |
|---|---|
| Electron Forge | NSIS、`extraResources`、Windows signing を electron-builder の設定系へ集約するため採用しない。 |
| WiX / MSI | Version 1 は electron-builder NSIS を PoC と package 試験で実証する。servicing 要件を満たせない場合だけ再評価する。 |
| Windows + macOS の同時 MVP | **延期。** macOS を Version 1 の依存・Gate に含めない。 |
| flat PKG を Version 1 で作成 | **延期。** Apple 関連調査は §10 に保持するが、現行成果物ではない。 |
| PyInstaller onefile | worker 起動ごとの一時展開と大容量 bundle の起動遅延を避けるため採用しない [P05]。 |
| Python runtime / venv をそのまま同梱 | import/C extension 解決と配布構造を PyInstaller onedir へ集約するため採用しない。 |
| online auto-updater | FR-SEC-002、FR-LIC-011 と両立しない。手動 installer upgrade を使う。 |
| web / stub installer | offline 自己完結要件に反するため採用しない。 |
| GitHub-hosted release CI | model/signing key を外部 runner へ置かない local/self-hosted Windows とする（D-11）。 |
| driver 同梱 | FR-INS-006 に反するため採用しない。 |

---

## 10. Future macOS — 保持する調査と再決定事項

この節は**明示的な将来 backlog**であり、Version 1 の現行決定、実装義務、PoC、Gate、受入条件、ブロッカーではない。

| 調査項目 | 旧案から保持する候補 | 現在の状態 |
|---|---|---|
| package | electron-builder flat PKG | 文書調査のみ。プロジェクトで未検証 |
| install 先 | `/Applications/AutoVision Studio.app` | 将来要件候補 |
| app / package 署名 | Developer ID Application / Installer | 未検証 |
| runtime security | Hardened Runtime + 最小 entitlement | 未検証 |
| notarization | 最終署名済み PKG の提出と ticket staple | 未検証 |
| assessment | Gatekeeper / `spctl` 等 | 未検証 |
| Python | native Apple Silicon Mac 上の PyInstaller onedir | 未検証 |
| ML | MPS、CoreML EP、CPU fallback、model-hash 別 cache | 未検証 |
| servicing | clean install、upgrade、repair、rollback、uninstall | 未検証 |

将来 macOS を再開する場合、TBD-04 に従い architecture、OS 下限、Python/ML wheel、MPS/CoreML、camera permission、配布経路、署名、notarization、servicing を新しい要求、依存監査、PoC、Gate で再決定する。Windows の証拠を macOS の合格へ転用しない。

notarization を採用する場合も、提出対象は製品 package に限定し、ユーザー画像、ラベル、Project、ユーザー学習済み model、学習結果を含めない。これは将来設計の保持条件であり、現時点の実施または検証を意味しない。

---

## 11. Version 1 外部ブロッカー

Windows packaging における外部ブロッカーは、正式な Windows code-signing identity の確保だけである。

| ブロッカー | 影響 | 対応 |
|---|---|---|
| Windows 正式 code-signing 証明書と安全な signing identity | 最終 EXE と全 PE を配布可能な状態にできない | D-16 で取得、保管、更新、失効、timestamp 手順を確定 |

Windows local/self-hosted build/test machine はプロジェクト準備事項として管理する。Apple Developer ID、notary credential、Apple Silicon Mac は Future macOS の将来準備事項であり、Version 1 blocker ではない。

---

## 12. 結果

この決定により、Version 1 には次の制約と義務が生じる。

- `electron-builder` の Windows NSIS 設定を固定し、1 ファイル EXE を生成する（PKG-04〜05）。
- Windows native build の PyInstaller onedir を `extraResources` 経由で組み込む（PKG-02、PKG-04〜05）。
- 最終 EXE と全 PE を Authenticode 署名し、署名漏れと hash 不一致を build gate で拒否する（PKG-07、NFR-INS-006）。
- clean install、repair、upgrade、downgrade rejection、rollback、uninstall、Project 保持を Windows で検証する（PKG-11、PKG-13、PKG-19）。
- 更新確認通信を実装せず、新しい署名済み installer の手動実行で更新する（D-12）。
- driver 非同梱を維持し、CPU fallback で全機能を利用可能にする（FR-INS-006）。
- `vendor/models/` は Git 追跡対象外とし、release build 時の配置、manifest、hash で管理する（D-09）。
- SBOM、license、model、payload size の検証を build pipeline に統合し、不合格時は build を失敗させる（LIC-01、PKG-01、PKG-14、PKG-16）。
- Future macOS は独立 backlog とし、Version 1 task または Gate から参照しない。

---

## 13. 参考文献

すべて 2026-09-02 に参照した。

### 実装計画 内部参照（\[Pxx\]）

- **\[P02\]** electron-builder, NSIS target — https://www.electron.build/nsis.html
  electron-builder, PKG target — https://www.electron.build/pkg.html
- **\[P03\]** electron-builder, Application Contents (`extraResources`) — https://www.electron.build/contents.html
- **\[P04\]** electron-builder, macOS Code Signing and Notarization — https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/code-signing/notarization.md および https://github.com/electron-userland/electron-builder/blob/master/website/docs/mac.md
- **\[P05\]** PyInstaller, Operating Mode — https://pyinstaller.org/en/stable/operating-mode.html
  PyInstaller, Supporting Multiple Operating Systems — https://pyinstaller.org/en/stable/usage.html#supporting-multiple-operating-systems
- **\[P12\]** Microsoft Learn, Windows Installer Best Practices — https://learn.microsoft.com/windows/win32/msi/windows-installer-best-practices
- **\[P13\]** Apple Developer, Packaging Mac software for distribution — https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution

### 要求定義 内部参照（\[Sxx\]）

- **\[S33\]** Microsoft Learn, Choose a distribution path for your Windows app — https://learn.microsoft.com/windows/apps/package-and-deploy/choose-distribution-path
- **\[S34\]** Microsoft Learn, Windows Installer Best Practices — https://learn.microsoft.com/windows/win32/msi/windows-installer-best-practices
- **\[S35\]** Apple Developer, Packaging Mac software for distribution — https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution
- **\[S36\]** Apple Developer, Notarizing macOS software before distribution — https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- **\[W01\]** Microsoft Learn, Time Stamping Authenticode Signatures — https://learn.microsoft.com/windows/win32/seccrypto/time-stamping-authenticode-signatures
