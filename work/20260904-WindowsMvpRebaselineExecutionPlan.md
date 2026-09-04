# Windows MVP 再ベースライン実行計画

| 項目 | 値 |
|---|---|
| 変更指示日 | 2026-09-04 |
| 変更内容 | Version 1（MVP）を Windows 11 24H2以降 x64専用とし、macOS対応を将来版へ延期 |
| 要求正本 | `docs/requirement-definition.md` |
| 実装正本 | `docs/implementation-plan.md` |
| 原則 | 過去のmacOS `NOT_RUN`証拠をPASSへ変更しない。将来対応を現行MVPの完了条件へ混在させない |

変更前の要求正本はv0.3 Draftで、Windows 11 x64とmacOS Apple Silicon arm64の両方をVersion 1必須としている。本計画はその現行記述を入力とし、ユーザーの2026-09-04指示に基づいてv0.4 Draftへ変更する。変更前のraw/LF-normalized SHA-256は既存fact baselineに保持し、変更後hashで上書きして過去値を現在値と偽らない。

## 1. 完了規則

各タスクは次を満たすまで依存タスクを開始しない。

1. 対象fileだけを編集する。
2. 対象のtest、diagnostics、必要なbuildを実行する。
3. 独立した敵対的レビューを行う。
4. 指摘を一次資料または実行で再現する。
5. 再現した指摘だけを反映し、再現しない指摘は理由を記録して不採用とする。
6. 修正後に対象検証と指摘箇所を再確認する。
7. 実行していないOS、model、fixture、署名、clean host、rebootをPASSと記録しない。

出力fileが重ならず、依存が完了しているタスクだけを並列化する。

## 2. 再ベースラインタスク

| ID | 作業 | 出力 | 依存 | 完了条件 |
|---|---|---|---|---|
| WIN-SCOPE-00 | 本計画を固定 | 本書 | ユーザー指示 | Windows MVP、macOS将来化、レビュー順、最終処理が明記される |
| WIN-SCOPE-01 | 要求定義をWindows MVPへ変更 | `docs/requirement-definition.md` | WIN-SCOPE-00 | Windows 11 x64だけがVersion 1必須。macOS固有要求・PoC・受入は同じ正本内で`将来対応`と明記する。変更前後で既存229 requirement IDとS1〜S55を全数照合し、削除・重複・孤立0、Windows MVPと将来macOSの混在0、変更後raw/LF hash算出を確認する |
| WIN-SCOPE-02 | 実装計画のGate・task依存を再構成 | `docs/implementation-plan.md` | WIN-SCOPE-01 | Gate 1〜5はWindows証拠で判定。macOS task IDは削除せず同じ正本の将来backlogとして`FUTURE`表示し、Version 1 Gate依存から外す。正本260 taskを維持し、ID重複0、未定義依存0、cycle 0を機械確認する |
| WIN-SCOPE-03 | Process/Data/Packaging ADRを再整合 | `docs/adr/0001-process-architecture.md`, `docs/adr/0002-data-lifecycle.md`, `docs/adr/0003-packaging.md` | WIN-SCOPE-02 | Windows current decisionとmacOS future decisionを分離し、過去の検証事実を改変しない |
| WIN-SCOPE-04 | 開発・利用者向け文書を再整合 | `README.md`, `CONTRIBUTING.md`, `docs/users-guide.md`, `docs/developer-guide.md`, `docs/architecture.md` | WIN-SCOPE-03 | Version 1をWindows専用と明記し、macOS手順を利用可能に見せない |
| WIN-SCOPE-05 | 図をWindows MVPへ再整合 | `images/system-architecture.svg`, `images/component-diagram.svg`, 必要な他SVG | WIN-SCOPE-04 | current/future状態、EP、packagingが本文と一致し、SVG accessibility規約を維持 |
| WIN-SCOPE-06 | Python dependency targetを再審査 | `ml/pyproject.toml`, `ml/uv.lock`, dependency adoption記録 | WIN-SCOPE-02 | Version 1のrequired environmentをWindows x64/Python 3.14に限定し、lock変更を監査。将来macOS packageを現行payload扱いしない |
| WIN-SCOPE-07 | 要求hash・文書verifier・traceabilityを更新 | `README.md`, `docs/implementation-plan.md`, fact baseline追補、`scripts/docs/*` | WIN-SCOPE-01〜06 | raw/LF hash、link、status、要求ID、SVG検査が合格し、旧hashは履歴値として識別される |
| WIN-SCOPE-GATE | Windows MVP再ベースラインGate | review記録 | WIN-SCOPE-01〜07 | Node/Python検証、文書検証、typecheck/build、全敵対レビューが合格 |

WIN-SCOPE-03の各ADRと、WIN-SCOPE-04の競合しないfileは個別レビュー単位に分けて実施する。

### WIN-SCOPE-01検証

- 変更前に既存requirement ID集合、出典ID集合、raw/LF hashを保存する。
- 変更後に同じ集合を再抽出し、229件のrequirement IDとS1〜S55が一致することを確認する。
- `FR-INF-006`、`FR-INS-010`、`FR-INS-011`、macOS部分の`FR-SEC-011`、`NFR-INS-006`、`NFR-INS-008`、`POC-12`、受入条件14を削除せず`将来対応`へ変更する。
- Windowsと共通の要求からmacOS文言を除き、Windows MVPの受入条件を単独で検証可能にする。
- 変更行と採否を本書の実行記録節へ追記し、独立レビュー後に次タスクへ進む。

### WIN-SCOPE-02検証

- macOS専用taskは`SPI-04`、`SPI-06`、`PKG-03`、`PKG-06`、`PKG-08`、`PKG-12`、`PKG-18`、`PKG-20`と、macOS専用manual outputを含むtaskの該当laneである。一次task表を再読してこの列挙を確定する。
- taskを削除・改番せず`FUTURE`へ移すため、正本task総数は260件を維持する。
- Gate 1〜5と各range依存が`FUTURE` taskをVersion 1必須として参照しないことを検査する。
- Mermaid DAGとtask表から依存graphを抽出し、未定義ID、自己依存、cycleを検査する。

## 3. Phase C残作業

| ID | Windows MVPでの扱い |
|---|---|
| SPI-10 | 最新PASS artifactを`spikes/annotation/result.md`へ同期し、raw evidence再計算・敵対的レビュー・再確認後に正式close |
| SPI-03 | clean WindowsでPython未導入状態のonedir検証を完了 |
| SPI-05 | SPI-03後、Windows NSIS resource同梱PoCを実行 |
| SPI-09 | Windows camera→pipe→dummy outputを実測。実cameraが利用できなければBLOCKED |
| SPI-11〜14 | 現在のHOLD/BLOCKEDを維持し、checkpoint/data terms/hash/再配布/承認の外部証拠が揃った候補だけ再審査 |
| SPI-15〜17 | 承認済みmodelと権利確認済みfixture/gold set後に実行 |
| SPI-18 | Windows対象のGate 1/2決定を記録。未承認modelはmanifestへ追加しない |
| SPI-19 | Windows実機OS reboot後のReference検証を完了 |

SPI-04、SPI-06、SPI-08のmacOS lane、SPI-09のmacOS lane、SPI-19のmacOS laneはVersion 1 Gateから外し、将来macOS backlogとして履歴を保持する。

## 4. 製品実装

再構成後の`docs/implementation-plan.md`の依存順で、Phase D〜Nを実行する。分類と検出、UIとCore、Windows packagingはshared contract固定後に並列化する。Gate未達のtaskは開始せず、外部証拠不足を実装で迂回しない。

- Phase D: CORE / Project / diagnostics
- Phase E: Job runtime
- Phase F: Data import
- Phase G: Annotation / Dataset Revision
- Phase H: Approved-model assist
- Phase I / I.1: Training / Model Version / Project-model assist
- Phase J: Reports
- Phase K: Windows camera inference
- Phase L: Security / reliability / performance
- Phase M: Windows self-contained installer / servicing
- Phase N: Windows final acceptance
- Feature completion後: `DOC-01`〜`DOC-10`と`DOCS-401`〜`DOCS-407`、最終レビュー`DOCS-501`〜`DOCS-505`

## 5. 外部blocker

次は証拠が提供・生成されるまで成功扱いにしない。

- clean Windows試験機
- Windows実機再起動
- Windows cameraと30分試験時間
- 分類・検出の承認済みbase/assist checkpoint
- checkpoint/data terms/再配布条件/法務またはrelease責任者承認
- 権利確認済みtraining fixtureとassist gold set
- Windows Authenticode正式証明書とsecure timestamp

## 6. 全タスク完了後だけ実行する処理

1. repository rootの`CHANGELOG.md`をKeep a Changelog形式で作成または更新し、`Unreleased`へ今回の概要と分類済みentryを追加する。
2. `hve`、`Markdown query Skill`、`Code Query skill`のうち、今回実際に変更したpackageだけPATCH versionを1増やす。
3. 現在の探索では3packageはAutoVision Studioの依存ではなく別repositoryにあり、現時点の変更対象ではない。将来そのpackage自体を変更した場合だけ、各正本manifest・shared changelog・testを確認してversionを更新する。
4. feature/GateがBLOCKEDの間は「全タスク完了」とせず、CHANGELOGと外部package versionを先行更新しない。

## 7. WIN-SCOPE-00 敵対的レビュー記録

- 現行v0.3がWindows/macOSをVersion 1必須とし、本計画がそれを変更する入力／出力境界を明記した。
- レビューで、既存229 requirement IDとS1〜S55の全数保持、macOS将来要件の同一正本内保持、task ID不変、未定義依存／cycle検査の明示不足を再現し、§2へ反映した。
- 「変更計画が現行要求と異なること自体が矛盾」という指摘は、WIN-SCOPE-01の目的そのものであり再現可能な欠陥ではないため不採用とした。
- 「正本taskは251件」という指摘は不採用とした。`docs/implementation-plan.md` §7だけを対象に、英字suffixを持つ`PKG-09A/B`と`VER-GATE-01`を含む許可IDで再計数し、260件、unique 260件、重複0件を確認した。C0の4管理checkpointは正本260 taskの外である。
- WIN-SCOPE-01/02が未実行という指摘は、後続taskの状態説明であって本計画の欠陥ではないため不採用とした。
- CHANGELOGは全task完了後、外部3packageは実際に変更したものだけPATCH更新する条件を維持した。

**判定:** WIN-SCOPE-00 完了。次の依存taskはWIN-SCOPE-01のみ。

## 8. WIN-SCOPE-01 実行・敵対的レビュー記録

- `docs/requirement-definition.md`をv0.4 Draftへ更新し、Version 1をWindows 11 24H2以降x64専用、macOSを将来対応とした。
- 変更前後のFR/NFR requirement IDは229件、unique 229件で完全一致し、追加・削除・重複は0件だった。
- 出典IDは変更前後ともS1〜S55の55件で完全一致した。
- macOS固有の`FR-INF-006`、`FR-INS-010/011`、`POC-12`、受入条件14等を削除せず`将来`または`将来対応`へ変更した。
- 非platformの学習、security、license、data不変性要求は維持した。
- 変更後SHA-256は作業ツリーraw bytes `38e79907b8b5620fffd50dd73a79322d1d97e606b90e81b0b9b06140958e5ce5`、LF-normalized bytes `8c8dcdffc6049b6fc0503079ffb1edf3c2464d9e24150155530b82fa5df44f6b`。
- `git diff --check`とeditor diagnosticsは合格した。
- 独立敵対的レビューはWindows MVP限定性、macOS将来化、229 ID、S1〜S55、優先度、数値保証、非platform要求を照合し、再現可能な指摘0件だった。

**判定:** WIN-SCOPE-01 完了。WIN-SCOPE-02を開始できる。

## 9. WIN-SCOPE-02 実行・敵対的レビュー記録

- `docs/implementation-plan.md`を要求定義v0.4 Draftと新hashへ接続し、Gate 1〜5をWindows 11 24H2以降x64の証拠だけで判定する構成へ変更した。
- 正本task IDは変更前後とも260件、unique 260件、重複0件で、削除・改番・追加はない。
- `SPI-04`、`SPI-06`、`PKG-03`、`PKG-06`、`PKG-08`、`PKG-12`、`PKG-18`、`PKG-20`、`PKG-21`を`FUTURE — macOS`とし、Version 1 Gateと完了率から除外した。
- `SPI-08/09/19`、`CORE-11`、`DAT-15`、`TRN-02`、`INF-01/06/14`、`PKG-22`のVersion 1完了条件をWindowsへ限定し、macOS laneは将来として保持した。
- `SPI-18`はWindows/model前提を保持しつつ`SPI-04/06`への依存を除外した。
- Phase MのWindows chainからFUTURE macOS taskへの依存を除外し、`PKG-14`が`PKG-12/21`へ依存しないことを明記した。
- 過去C0の両OS依存調査とmacOS `NOT_RUN`を履歴として保持し、macOS PASSへ変更していない。
- `git diff --check`とeditor diagnosticsは合格した。
- 独立敵対的レビューは260 task、9 FUTURE task、shared task、Gate 1〜5、SPI-18、Phase M、履歴境界を照合し、再現可能な指摘0件だった。

**判定:** WIN-SCOPE-02 完了。WIN-SCOPE-03A〜03Cを並列開始できる。

## 10. WIN-SCOPE-03A〜03C 実行・敵対的レビュー記録

- 03A `ADR-0001`: Version 1 processをWindowsへ限定し、DirectML/CPUを現行EP、CoreML/MPSを将来backlogとした。Renderer/Preload/Main/Job Worker/Inference Worker、single DB writer、validated IPCの境界は維持した。
- 03B `ADR-0002`: data lifecycleと不変性を変更せず、SPI-19のVersion 1条件をWindows process/OS reboot/read/hash/relink/非破壊へ限定した。macOS accessは将来条件、既存`NOT_RUN`は履歴として保持した。
- 03C `ADR-0003`: Version 1配布をWindows NSIS one-file EXE、PyInstaller onedir、Authenticodeへ限定した。Apple PKG/Developer ID/notarization研究は将来節に保持し、Version 1 Gate依存から除外した。
- 3ファイルとも`git diff --check`とeditor diagnosticsは合格した。文書全体verifierは要求hash更新前のため、この時点では合格条件に使用しない。
- 各ADRを別々に独立敵対的レビューし、scope、依存、履歴、禁止境界、未検証証拠を照合した。再現可能な指摘は3件とも0件だった。

**判定:** WIN-SCOPE-03A、03B、03C完了。WIN-SCOPE-04A〜04Eを並列開始できる。
