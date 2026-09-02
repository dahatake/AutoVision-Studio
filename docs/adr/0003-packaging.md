# ADR 0003 — パッケージング方針

| 項目 | 内容 |
|---|---|
| 文書バージョン | 1.0 |
| 作成日 | 2026-09-02 |
| ステータス | 採用済み（デフォルト決定） |
| 依存 ADR | なし（A-01 完了後の第一 ADR） |
| 対応タスク | A-04 |
| 要求基準 | `docs/requirement-definition.md` v0.3（FR-INS-001〜020、FR-SEC-011、NFR-INS-001〜008） |

---

## 1. コンテキスト

AutoVision Studio は Windows x64 と macOS arm64 の 2 OS 向けに、アプリ本体・Python runtime・機械学習依存ライブラリ・承認済み基盤重み・Annotation Assist Model・ONNX Runtime・SBOM・ライセンス通知を **1 ファイルのオフライン自己完結インストーラー** にまとめて配布しなければならない（FR-INS-001〜006）。

配布に際して次の制約が定まっている。

- インストール後に Python・Node.js・CUDA Toolkit・開発者ツールの手動導入を利用者に要求しない（FR-INS-005）。
- GPU/NPU ドライバーをインストーラーから導入・更新しない（FR-INS-006）。
- 実行時にモデル・コード・Execution Provider をネットワーク経由で取得しない（FR-LIC-011、FR-INS-003）。
- 更新確認・テレメトリ・CDN を既定で使用しない（FR-SEC-002）。
- Windows 配布物はコード署名し、macOS 配布物は Developer ID 署名・Hardened Runtime・Notarization を行う（FR-SEC-011、FR-INS-008、FR-INS-010）。

これらを満たす配布ツール・Python バンドル形式・アップグレード方式を確定する必要がある。

---

## 2. 決定事項

### 2.1 共通

| 項目 | 決定 | 根拠 |
|---|---|---|
| インストーラービルドツール | **electron-builder** | D-05 \[P02\]\[P03\]\[P04\] |
| Python バンドル形式 | **PyInstaller onedir** | D-06 \[P05\] |
| sidecar の組み込み方法 | electron-builder `extraResources` | D-05 \[P03\] |
| アップグレード方式 | **手動（新しい署名済みインストーラーの実行）** | D-12 |
| CI/リリース実行場所 | **ローカル／セルフホスト Windows + Mac** | D-11 |

### 2.2 Windows 向け

| 項目 | 決定 |
|---|---|
| フォーマット | NSIS **1 ファイル EXE** |
| インストール先 | 既定は **per-user**（管理者権限不要） |
| per-machine オプション | 管理者または組織の選択時のみ標準 UAC を許可（FR-INS-009） |
| ファイル名 | `AutoVision-Studio-<version>-windows-x64.exe` |
| 署名 | Authenticode 署名（信頼された CA へ連鎖）＋ secure timestamp（FR-INS-008） |
| 対象アーキテクチャ | x64 のみ（Windows on ARM は MVP 対象外） |

### 2.3 macOS 向け

| 項目 | 決定 |
|---|---|
| フォーマット | **flat PKG** |
| インストール先 | `/Applications/AutoVision Studio.app` |
| ファイル名 | `AutoVision-Studio-<version>-macos-arm64.pkg` |
| アプリ署名 | Developer ID Application（app 本体・全 nested executable/framework/helper）（FR-INS-010） |
| PKG 署名 | Developer ID Installer（FR-INS-010） |
| Hardened Runtime | 有効・最小限の entitlement（カメラ用途のみ追加）（FR-INS-010） |
| Notarization | Apple notary service への提出と ticket の staple（FR-INS-010） |
| 対象アーキテクチャ | arm64（Apple Silicon）のみ（Intel Mac は MVP 対象外） |

### 2.4 Python sidecar

| 項目 | 決定 |
|---|---|
| バンドル形式 | **PyInstaller onedir**（ディレクトリ形式） |
| ビルド環境 | **OS ネイティブビルド必須**（Windows 上で Windows、macOS 上で macOS） |
| 含む内容 | PyTorch / Optuna / ONNX Runtime（CPU EP 必須）、OS 別 accelerator integration（CUDA/DirectML は Windows 実機、CoreML は macOS 実機でそれぞれ PoC で確認） |
| electron-builder との連携 | onedir ディレクトリ全体を `extraResources` に配置 |
| 実行時インストール | しない（ビルド時に全依存を freeze） |

### 2.5 ランタイムオフライン要件

- **インストール完了後、追加ダウンロードをしない。**
- モデル・Execution Provider・ライブラリはすべてインストーラーに同梱する（FR-INS-004）。
- Windows ML の実行プロバイダー自動取得機能には依存しない（FR-LIC-011）。

### 2.6 ドライバー非同梱

- GPU/NPU ドライバーはインストーラーから導入・更新しない（FR-INS-006）。
- ドライバー不在の場合も CPU fallback により全機能を利用可能とし、初回診断でアクセラレーション不可の理由のみを表示する。

---

## 3. 根拠

**electron-builder を採用した理由。**

1. NSIS EXE と flat PKG を同一設定ファイル（`electron-builder.yml`）で管理でき、ツールチェーンを 1 つに収められる \[P02\]。
2. `extraResources` 機能により、PyInstaller onedir ディレクトリや承認済みモデルバイナリをインストーラーへ組み込める \[P03\]。
3. macOS の Hardened Runtime・entitlements・notarization を設定レベルで扱える \[P04\]。ただし Apple の要件（S35・S36）を優先し、electron-builder の設定はその補助として使う。

**PyInstaller onedir を採用した理由。**

1. `onefile` はアプリ起動ごとに一時ディレクトリへ展開するため、大容量バンドル（PyTorch 等）では起動遅延が生じる \[P05\]。
2. `onedir` は展開済みディレクトリとして存在し、Electron からのプロセス起動が高速で `extraResources` からの相対パス参照が自然に扱える。
3. PyInstaller 公式文書が `onedir` を既定形式として扱っている \[P05\]。

**手動アップグレードを採用した理由。**

- MVP では更新確認や実行時ネットワーク通信を禁止する（FR-SEC-002、FR-LIC-011）。
- in-place upgrade は新しい署名済みインストーラーを実行することで満たす（D-12）。
- 既存 Project データは upgrade 後も保持する（FR-INS-015）。

---

## 4. 検証済み文書事実

以下は 2026-09-02 時点の公式文書から確認できた事実である。**実装・実機試験・成果物の存在を意味しない。**

| 事実 | 根拠 |
|---|---|
| electron-builder は NSIS をターゲットに持ち、Windows EXE を生成できる | \[P02\] https://www.electron.build/nsis.html |
| electron-builder は PKG をターゲットに持ち、macOS 用 flat PKG を生成できる | \[P02\] https://www.electron.build/pkg.html |
| electron-builder の `extraResources` はアプリ外部のファイル・ディレクトリをインストーラーに含める機能である | \[P03\] https://www.electron.build/contents.html |
| electron-builder は macOS signing の `hardenedRuntime`・`entitlements`・`entitlementsInherit` と notarization 設定をサポートする | \[P04\] https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/code-signing/notarization.md および https://github.com/electron-userland/electron-builder/blob/master/website/docs/mac.md |
| PyInstaller `onedir` は依存ライブラリをすべてディレクトリに展開した自己完結バンドルを作る | \[P05\] https://pyinstaller.org/en/stable/operating-mode.html |
| PyInstaller `onefile` はアプリ起動ごとに一時ディレクトリへ展開する | \[P05\] https://pyinstaller.org/en/stable/operating-mode.html |
| PyInstaller は OS 間のクロスコンパイルをサポートしない（Windows バンドルは Windows 上、macOS バンドルは macOS 上でのみ生成できる） | \[P05\] https://pyinstaller.org/en/stable/usage.html#supporting-multiple-operating-systems |
| Windows Installer の文書は clean install・rollback・repair・upgrade・uninstall の試験を列挙する。ただし MSI 固有の文書であり、NSIS の機能保証には使わない。本製品の repair は同一 NSIS EXE の再実行による再インストールとして別途実機検証する | \[P12\] https://learn.microsoft.com/windows/win32/msi/windows-installer-best-practices |
| flat PKG は Developer ID Installer で署名し、notarize して ticket を staple するのが Apple の配布要件である | \[P13\] https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution |
| Notarization には Hardened Runtime と secure timestamp の適用が必要である | \[S36\] https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution |
| Windows 配布物には信頼された CA へ連鎖する署名が必要である | \[S33\] https://learn.microsoft.com/windows/apps/package-and-deploy/choose-distribution-path |
| Authenticode 署名は常に timestamp し、SHA-256 と RFC 3161 timestamp を使うことが推奨される | \[W01\] https://learn.microsoft.com/windows/win32/seccrypto/time-stamping-authenticode-signatures |
| Windows Installer の署名・servicing・uninstall試験に関するベストプラクティス | \[S34\] https://learn.microsoft.com/windows/win32/msi/windows-installer-best-practices |
| per-user インストールは管理者権限なしで導入できる構成である | FR-INS-009 |

---

## 5. PoC で確認が必要な前提

以下は技術的に成立すると判断しているが、**実機での PoC または本番 package テストで合格するまでは確定でない前提**である。PoC が不合格の場合、対象項目について代替案を再評価し、Gate 1 を通過しない。

| 前提 | 対応 PoC | リスク |
|---|---|---|
| PyInstaller onedir に PyTorch・Optuna・ONNX Runtime を含め、Python 未導入のクリーン Windows で import と CPU 実行が成功する | SPI-03 | native extension や hidden import の欠落 |
| PyInstaller onedir に PyTorch・MPS・CoreML EP を含め、Python 未導入のクリーン macOS arm64 で import・CPU/MPS/CoreML probe が成功する | SPI-04 | macOS nested binary signing、dynamic linker の制約 |
| electron-builder NSIS target が onedir ディレクトリを `extraResources` へ同梱し、インストール後に起動できる | SPI-05 | ファイル数・パス長・圧縮形式の制約 |
| electron-builder PKG target が onedir ディレクトリを同梱し、PKG の nested code 構造として署名を通過できる | SPI-06 | macOS Gatekeeper の nested code 署名要件 |
| CUDA/DirectML EP を同梱した場合の PE 一覧と cold-start 時間が許容範囲内に収まる | SPI-03 | サイズ膨張、CUDA 再配布可能ファイルの範囲（LIC-03） |
| CoreML EP の compile cache を model hash ごとに分離し、モデル変更時に古いキャッシュを再利用しない設計が macOS 実機で機能する | SPI-04、INF-06 | CoreML cache 管理 API の実機動作確認が必要 |
| clean Windows 11 x64 で EXE 1 ファイルからオフラインインストールし、再起動なしで Project 作成まで到達できる | PKG-11 | 依存 runtime の欠落、PE 署名エラー |
| clean Apple Silicon Mac で PKG 1 ファイルからオフラインインストールし、Gatekeeper assessment 後に Applications から Project 作成まで到達できる | PKG-12 | notarize 済み ticket の staple、Gatekeeper の挙動 |
| upgrade・repair・rollback・uninstall が両 OS で Project データを保持したまま完結できる | PKG-13 | 旧版との互換 migration、rollback の整合性 |

---

## 6. リリース前提条件

以下は Gate 5（リリース判定）より前に満たさなければならない条件である。いずれかが未達の場合はリリースを停止する。

| 条件 | 担当タスク |
|---|---|
| 組織の正式 Windows コード署名証明書を取得し、秘密鍵を安全に管理する | D-16 |
| Apple Developer Program の Developer ID 証明書（Application / Installer 両方）を取得し、秘密鍵を安全に管理する | D-16 |
| 全 PE 実行ファイル・DLL を信頼 CA 連鎖の証明書と secure timestamp で Authenticode 署名する | PKG-07 |
| app bundle 内の全 nested executable / framework / helper / Python onedir 内の全 Mach-O binary を Developer ID Application で署名する | PKG-08 |
| flat PKG を Developer ID Installer で署名する | PKG-08 |
| Hardened Runtime と最小限の entitlement を適用する | PKG-06、PKG-08 |
| PKG を notarize して ticket を staple する | PKG-08 |
| 署名・notarization・staple を build gate で検証する（`codesign`・notary log・stapled ticket・Gatekeeper assessment を含む） | NFR-INS-006 |
| SBOM と `THIRD_PARTY_NOTICES` を全 payload と照合し、欠落・余剰・hash 不一致・unknown license があればビルドを失敗させる | LIC-01、PKG-14、NFR-INS-007 |
| Windows/macOS 同一製品版で schema version・Curated Base Weight version・Annotation Assist Model version・機能フラグ・ライセンス通知が一致することを検証する | PKG-21 |
| Product ID（`io.github.dahatake.autovisionstudio`、暫定 D-10）を正式な配布前に確定する | D-10 |

---

## 7. 署名・Notarization の境界

### 7.1 Windows 署名

| 対象 | 方法 |
|---|---|
| 最終 EXE インストーラー | Authenticode 署名 + secure timestamp |
| アプリ内の全 PE 実行ファイル（`.exe`/`.dll`） | 同上 |
| Python onedir 内の全 PE | 同上 |
| ONNX Runtime・native addon の PE | 同上（再配布時の署名要件を個別確認） |
| インストール前の署名・payload 検証 | 最終 installer と全 payload hash を検証してからインストール開始（FR-INS-008） |

GPU/NPU ドライバーの署名・インストールはスコープ外とする（FR-INS-006）。

### 7.2 macOS 署名・Notarization

| 対象 | 方法 |
|---|---|
| app bundle 内の全 nested executable / framework / helper | Developer ID Application で署名 |
| Python onedir 内の全 Mach-O binary | Developer ID Application で署名 |
| flat PKG | Developer ID Installer で署名 |
| Hardened Runtime | 有効化し、Electron と同梱workerの動作に必要な最小限の entitlement だけを適用 |
| Notarization | 承認済み製品payloadを含む最終署名済みPKGを Apple notary service へ提出。ユーザー画像・ラベル・Project・ユーザー学習済みモデル・学習結果はPKGに含めず送信しない |
| Ticket の staple | notarize 完了後に PKG へ staple |
| Gatekeeper assessment | build gate で `spctl --assess --type install` を実行して検証（NFR-INS-006） |

Notarization は D-11 の採用済みデフォルトに従う。提出対象は最終PKG全体であり、そこには FR-INS-004 の承認済み Curated Base Weight / Annotation Assist Model が製品payloadとして含まれ得る。一方、ユーザーの画像・ラベル・Project・ユーザー学習済みモデル・学習結果は提出物に含めない。この区別を release inventory で検証する。

### 7.3 境界の外

- 実行時の OCSP・CRL による証明書失効確認は OS 機能であり、本製品の管理外とする。
- 署名鍵・証明書の保管方法は D-16 で別途確定する。現時点では未決である。

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

## 9. 却下した選択肢

| 選択肢 | 却下理由 |
|---|---|
| **Electron Forge** | 今回必要な NSIS EXE・PKG・`extraResources`・署名設定を electron-builder の1設定系で扱うデフォルトを選んだため、同じ目的の2つ目のパッケージング基盤は導入しない。 |
| **WiX（Windows）＋個別 macOS スクリプト** | ツールチェーンが 2 系統になり保守コストが増大する。electron-builder で両 OS を統一できるため採用しない。 |
| **PyInstaller onefile** | アプリ起動ごとに一時ディレクトリへ展開するため、PyTorch・ONNX Runtime 等の大容量バンドルでは起動遅延が生じる \[P05\]。 |
| **Python runtime をそのまま同梱（zip / venv）** | `site-packages` の完全同梱は動的 import や C extension 解決が複雑で OS ごとの動作保証が難しい。PyInstaller は C extension 依存解析と hidden import 解決に実績がある。 |
| **online auto-updater** | 実行時の外向き通信を禁止する要件（FR-SEC-002、FR-LIC-011）と両立しない。MVP の更新は手動インストーラー実行で満たす（D-12）。 |
| **GitHub-hosted CI** | Cloud 不使用方針（FR-SEC-001〜003）と、署名鍵・モデルバイナリを外部 runner に置かない要件から除外する（D-11）。 |

---

## 10. OS ネイティブビルドの必須要件

**PyInstaller は OS 間のクロスコンパイルをサポートしない。** Windows バンドルは Windows 上でのみ、macOS バンドルは macOS 上でのみ生成できる \[P05\]。

この制約から次が従う。

- Windows release lane と macOS release lane は独立した実機が必要である。
- macOS freeze・sign・package・test（PKG-03〜08・PKG-12〜20）は Apple Silicon Mac のネイティブ環境が必要であり、Windows 上でエミュレーション・代替してはならない。
- SPI-03（Windows onedir PoC）と SPI-04（macOS onedir PoC）は独立して実施し、双方が合格するまで PKG-02・PKG-03（本番 freeze）を開始しない。

---

## 11. 現時点のブロッカー

> **未解決ブロッカー（2026-09-02 時点）**
>
> 1. **macOS ネイティブ実機が存在しない。**
>    SPI-04・SPI-06・PKG-03・PKG-06・PKG-08・PKG-12〜14・PKG-20〜22 は Apple Silicon Mac なしに実行・合格扱いできない。これらのタスクは macOS 実機が用意されるまで **停止（Blocked）** である（実装計画 §1.4）。
>
> 2. **Apple Developer ID 証明書が取得されていない。**
>    Developer ID Application・Developer ID Installer の両証明書と秘密鍵が確保されない限り、macOS 署名・notarization・staple（PKG-08）は実行できない（D-16）。
>
> 3. **Windows コード署名証明書が取得されていない。**
>    組織の正式証明書が確保されない限り、Windows 署名（PKG-07）は実行できない（D-16）。

**これらのブロッカーは Gate 5（リリース判定）より前に解消しなければならない。未解消の状態でリリースを判定してはならない。**

macOS 関連の PoC タスクは、現在の Windows 作業環境においては「未判定（Not Verified）」として扱い、合格扱いにしない。

---

## 12. 結果

この決定により次の制約と義務が生じる。

- `electron-builder.yml` を Windows・macOS で共有するが、OS 固有設定（NSIS・PKG・entitlements）を分けて管理する（PKG-04〜06）。共有設定ファイルは PKG-06 完了後に固定し、それより前に本番設定ファイルは作成しない。
- PyInstaller onedir の各 OS 版を build pipeline の freeze ステップで生成し、`extraResources` 経由で組み込む（PKG-02〜03）。
- macOS の全 nested binary 署名をリストアップし、署名漏れを build gate で検出する（PKG-08、NFR-INS-006）。
- アップグレードは新インストーラーの実行で完結させ、実行時の更新確認通信を実装しない（D-12）。
- ドライバー非同梱を維持し、CPU fallback で全機能を保証する（FR-INS-006）。
- `vendor/models/` は Git 追跡対象外とし、release build 時に手動配置・hash 検証で管理する（D-09）。
- SBOM・ライセンス検証・payload size 計算をビルドパイプラインに統合し、不合格時はビルドを失敗させる（LIC-01、PKG-16）。

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
