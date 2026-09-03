# C0-REVIEW — 統合依存レビュー・ライセンス裁定

| 項目 | 値 |
|---|---|
| 実施日 | 2026-09-03 |
| baseline | `e0cb90af0e3d85eb983c32c82b2530055b1edd6b` |
| 対象 | C0-NODE、C0-PYTHON、B-GATE再実行 |
| 対象要求 | FR-LIC-001〜003、FR-LIC-010〜012、NFR-MNT-001 |
| 決定権者 | Daiyu Hatakeyama（`dahatake`、repository owner / copyright holder） |
| 決定指示 | 2026-09-03、MITを基準にlicense裁定するというowner指示 |
| macOS指示 | native Apple Silicon実機がないため、C0でのnative検証をwaiveするowner指示 |
| レビュー状態 | **CLOSED** — blocking finding 0 |
| 最終判定 | **C0 CLOSED / B-GATE PASS（Windows）**。macOSはWAIVED / NOT_RUN |

> 本記録は、このrepositoryにおける依存採用とrisk acceptanceの書面記録である。外部弁護士による法的意見または暗号学的な署名を表明しない。承認は本書で列挙したexact version、用途、配布形態、条件だけに適用し、一般的なlicense allowlist拡張を意味しない。

## 1. 対象の固定

| 対象 | immutableな基準 |
|---|---|
| project license | `LICENSE`、MIT、SHA-256 `D59AAF0B82E1AB1D4F8D0E5959C54AB868AAE37F55048FF7A61A04DAA92C8730` |
| Node採用記録 | commit `31a912f3e82ccce6acb3cff650298504de5421f4` の `docs/dependency-adoption/node-phase-c.md`、SHA-256 `2018C23382BCBA64E1EA82B1430D40B485F30D9CF9EF24A8B0AC91B3F0C1027E` |
| Python採用記録 | commit `e0cb90af0e3d85eb983c32c82b2530055b1edd6b` の `docs/dependency-adoption/python-phase-c.md`、SHA-256 `BC29CCC68321BAEFD4549A39FF4A28275CAAFA32273C0FC64587C366B44862F1` |
| Node lock | `package-lock.json`、SHA-256 `7F1BD82EFE1E4919DCE6DDFFDB763CEFF4404D29B60E8E946A150345A8DFE1A5` |
| Python lock | `ml/uv.lock` canonical Git blob LF bytes、SHA-256 `D14D188A0D1F92F34A9436ECC0B2C801BB0375B36619199F846924C112C7E5FC` |

上記commitの採用記録に列挙されたNode 47 packageとPython 6 packageを本裁定の完全な対象一覧とする。名称またはversionが1文字でも変わったpackageは対象外であり、再審査する。

## 2. MIT基準

projectのMIT licenseを基準とし、次を全て満たすlicenseまたは利用形態を採用可能とする。

1. 商用を含む利用、複製、改変、配布を許可する。
2. 研究限定、非商用限定、用途・分野制限を持たない。
3. AutoVision Studio全体を同じlicenseへ変更する義務を生じさせない。
4. 著作権表示、license全文、NOTICE、対象sourceの入手手段など、追加義務を配布物で履行できる。
5. `unknown`、空欄、`NOASSERTION`ではない。

MITより義務が少ないlicenseは、保守的にlicense本文と著作権表示を保持する。MITより義務が多いlicenseはMITと同一視せず、§4の個別条件を全て満たす場合だけ承認する。

## 3. 全裁定に共通する条件

1. upstream artifactをlock記載hashのまま使用し、source、license、NOTICEを改変しない。
2. 最終payloadの全componentをLIC-01のSBOMへ記録し、配布対象のlicense全文・著作権表示・NOTICEを`THIRD_PARTY_NOTICES`へ含める。
3. dev/build-only packageは最終payloadから除外し、SPI-03/04およびLIC-01で実payloadを照合する。
4. runtime packageのlicense-like fileはwheel/packageから収集し、top-level licenseだけでなく同梱third-party licenseも伝播する。
5. packageのversion、license expression、用途、runtime/dev区分、改変有無、配布形態のいずれかが変わった場合は、本裁定を自動継承せず再審査する。
6. 後続payload検査で本条件を満たせない場合、そのpackageの承認は失効し、releaseを停止する。

## 4. package別裁定

### 4.1 Node — 47件

`node-phase-c.md` §6.2に列挙された47件は全てC0追加dev treeであり、製品runtimeの直接依存ではない。次のexact license groupを **APPROVED_WITH_CONDITIONS** とする。

| group | 件数 | 裁定 | MIT基準との差分・条件 |
|---|---:|---|---|
| ISC | 33 | 承認 | MITと同様の許諾・免責を持つpermissive licenseとして、license本文と著作権表示を保持する |
| BlueOak-1.0.0 | 8 | 承認 | commercial use、改変、配布を制限しないpermissive license。exact版の本文を保持する |
| Python-2.0 | 1 | 条件付き承認 | `argparse@2.0.1`だけに適用し、license全文、著作権表示、変更時の変更概要を保持する |
| WTFPL OR ISC | 1 | 条件付き承認 | `sanitize-filename@1.6.4`はISC選択肢を採用する |
| WTFPL | 1 | 条件付き承認 | `truncate-utf8-bytes@1.0.2`のdev-only利用だけを例外承認し、license本文を保持する。runtime移行時は再審査する |
| 0BSD | 1 | 承認 | `tslib@2.8.1`だけに適用し、義務が少ない場合も本文と著作権表示を保持する |
| MIT OR CC0-1.0 | 1 | 承認 | `type-fest@0.13.1`はMIT選択肢を採用する |
| WTFPL OR MIT | 1 | 承認 | `utf8-byte-length@1.0.5`はMIT選択肢を採用する |

この裁定は47件を一般の許可識別子へ昇格させない。47件のいずれかがproduction dependencyまたは最終payloadへ移った場合は、同じlicenseでも再審査する。

### 4.2 Python — 6件

| package | 利用形態 | 裁定 | 必須条件 |
|---|---|---|---|
| `certifi@2026.7.22` | `pip-audit`のdev transitive | 条件付き承認 | 最終payloadから除外する。将来配布する場合はMPL-2.0本文、notice、対応するSource Code Formの入手手段を提供して再審査する |
| `numpy@2.5.2` | runtime | 条件付き承認 | BSD-3-Clause、0BSD、MIT、Zlib、CC0-1.0の全license-like fileと帰属表示を伝播する。全成分は用途制限・whole-product copyleftを持たない |
| `pillow@12.3.0` | runtime | 条件付き承認 | MIT-CMU本文とCarnegie Mellonを含む著作権・帰属表示を伝播する |
| `pyinstaller@6.22.2` | build-only direct | 条件付き承認 | upstreamを未改変でbuild時だけ使用する。`bootloader/`と`PyInstaller/loader`のcompiled filesはBootloader Exceptionにより他programとの組込み・その結合物の配布が許可される。PyInstaller sourceまたは未結合fileを配布する場合はGPL-2.0-or-later条件を別途満たす。runtime hooksはApache-2.0、`PyInstaller.isolated`はMIT併許諾として各本文を保持する |
| `pyinstaller-hooks-contrib@2026.7` | build-only transitive | 条件付き承認 | standard hooks/filesはGPL-2.0-or-laterのbuild toolとして最終payloadへ含めない。`_pyinstaller_hooks_contrib/rthooks`がpayloadへ組み込まれる場合はApache-2.0としてNOTICE/SBOMへ記録する。SPI-03/04で実payloadを照合する |
| `tqdm@4.70.0` | runtime transitive | 条件付き承認 | lock済みwheelを未改変で使用する。MPL-2.0対象fileとMIT対象fileを区別してlicense noticeを保持し、Executable Formを配布する場合はMPL-2.0 §3.2に従い対応するSource Code Formを合理的かつ適時に取得できる手段を受領者へ示す |

PyInstallerを実行するCIの所有形態だけでlicense義務が変わるとは扱わない。GPL本文が定める対象は利用、改変、複製、配布の実態で判断し、GitHub Actionsまたはself-hostedという名称だけを許可・禁止条件にしない。

## 5. 承認記録

| 項目 | 決定 |
|---|---|
| Node 47件 | **APPROVED_WITH_CONDITIONS** |
| Python 6件 | **APPROVED_WITH_CONDITIONS** |
| unknown / NOASSERTION | 0。承認による上書きなし |
| 適用範囲 | §1のexact commit・lock・version・用途だけ |
| 決定者 | Daiyu Hatakeyama（`dahatake`、repository owner / copyright holder） |
| 決定日 | 2026-09-03 |
| 記録方法 | owner管理下のrepositoryへ本書をcommitすることで書面化する。外部法務意見またはcryptographic signatureは表明しない |

このowner裁定により、C0-NODEの47件およびC0-PYTHONの6件について「未承認license」はC0 blockerではなくなる。§3〜4のpayload条件はSPI-03/04、LIC-01、Gate 5で再検証し、失敗時はrelease blockerとする。

## 6. macOS実機waiverの境界

owner指示により、native Apple Silicon実機がないことを理由とするC0-NODE/C0-PYTHONのnative macOS検証は **WAIVED / NOT_RUN** とし、C0 dependency adoptionを閉じる際のblockerから外す。

- Windows結果をmacOS PASSへ転用しない。
- cross-target artifact展開とhash確認は保持するが、native実行証拠とは呼ばない。
- このwaiverはmacOS互換性、CoreML/MPS、PKG、署名、notarization、Gatekeeperの合格を意味しない。
- Phase CではWindowsまたはOS非依存taskだけを開始できる。macOS固有taskと、macOSを必須とするGateは正本変更がない限り`NOT_RUN`のままとする。
- macOS対応または配布を将来主張する場合は、native Apple Siliconで該当検証を再実行する。

## 7. 統合機械監査

### 7.1 Node lock

- lockfileVersion 3。
- baseline 236からcurrent 509 non-root/non-link entryへ273件追加、削除0。
- `resolved`欠落0、`integrity`欠落0、SRIはSHA-1 509件。
- resolved hostは`ms-feed-12` 124、`ms-feed-2` 117、`ms-feed-17` 133、`ms-feed-25` 135。
- npm 12.0.0の正式なread-only確認`npm approve-scripts --allow-scripts-pending`は未審査install script 0件、exit 0。

### 7.2 Python lock

- 70 package block、外部67 unique package、220 artifact。
- artifact hash欠落0、全artifactがSHA-256。
- Windows x64 / CPython 3.14とmacOS arm64 / CPython 3.13の2 required environmentだけを定義。
- CUDA/NVIDIA/cuDNN package 0。
- `pip-audit`は3 record / 2 packageを報告した。GitHub-reviewed severityは`setuptools` Moderate、`torch` Lowで、現policyのCritical/High停止閾値には達しない。脆弱性0とは扱わない。

## 8. B-GATE再実行

| 検証 | Windows結果 |
|---|---|
| PowerShell | 7.6.5 Core |
| Node / npm | Node 24.19.0 / npm 12.0.0 |
| `npm ci` | 440 packages、exit 0、registry監査0 vulnerabilities |
| dependency script review | 未審査0、exit 0 |
| `npm test` | 4 files / 19 tests、exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run build` | Main / Preload / Renderer、exit 0 |
| Electron window | commit `4cec3a9c8244a95d4a3bfc5eb73ac5e7b82e8850`でWindows x64のwindow生成、preload、normal close、残process 0を実測。C0後の現行lockでも`AutoVision Studio`の応答window 1件を実起動し、harness終了後の残process 0を再確認。C0ではapplication sourceを変更していない |
| `uv lock --check --system-certs` | 70 packages、exit 0 |
| `uv sync --locked --system-certs` | 64 installed distributions、exit 0 |
| pytest | 4 passed、exit 0 |
| Ruff | all checks passed、exit 0 |
| Pyright | 1.1.413、0 errors / 0 warnings、exit 0 |
| lock不変性 | `package-lock.json`と`ml/uv.lock` canonical Git blob LF bytesは実行前後で§1のSHA-256から不変 |

監査途中の`npm query ':pending'`はnpm 12で未対応のpseudo selectorとしてexit 1になったため、公式の`npm approve-scripts --allow-scripts-pending`へ置換した。Pyrightへ`pyproject.toml`をsource fileとして渡した初回呼出しもoperator errorとして棄却し、引数なしのconfig自動検出で再実行して合格した。失敗出力を製品codeの不合格とは数えず、同時に成功証拠から隠さない。

## 9. 残条件と判定

- Node deprecated警告4件は全てdev treeで、脆弱性0の根拠にしない。SEC-08で再監査する。
- Python既知advisory 3 record / 2 packageはModerate/Lowとして保持し、severityまたは利用経路が変われば再判定する。
- §3〜4のSBOM、NOTICE、Source Code Form案内、final payload分離は後続taskの必須条件であり、未実装のままreleaseを許可しない。
- macOS固有結果は§6のとおり`NOT_RUN`である。

### 9.1 最終敵対レビュー

更新後の5文書とexact license本文を独立read-only reviewerへ渡し、owner authority、47+6件の完全性、OR/AND、PyInstaller exception、MPL-2.0 §3.2、numpy/Pillow notice、macOS waiver、B-GATE、履歴表現、task/DAGを再照合した。10観点は全て合格し、blocking findingは0件だった。

reviewerはoptional findingとして、Node追加273件のlicense内訳を274件とする算術指摘を返したが再現しない。正しい合計は$207+33+5+5+1+9+8+1+1+1+1+1=273$であり、Node parserのlock差分273件とも一致するため数値を維持する。Pyright実行packageをNode lock、設定をPython projectが所有する分離もC0-PLAN AR-08およびB-13に明記済みで、変更しない。

### 9.2 最終判定

C0-NODEの47件とC0-PYTHONの6件は、§1のexact version・用途・配布形態に限定してownerが **APPROVED_WITH_CONDITIONS** と裁定した。Windowsのclean install、lock、test、type/lint、build、Electron window、runtime smoke、脆弱性監査、lock不変性は合格した。

native macOS検証は§6のとおり **WAIVED / NOT_RUN** で、macOS PASSまたはmacOS対応表明ではない。以上により **C0はCLOSED、Windows B-GATEはPASS** とする。Phase CではWindowsまたはOS非依存taskを開始できる。§3〜4の条件に違反した場合は当該承認を失効し、releaseを停止する。
