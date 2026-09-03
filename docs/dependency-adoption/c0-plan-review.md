# C0-PLAN 敵対的レビュー記録

| 項目 | 値 |
|---|---|
| 実施日 | 2026-09-03 |
| 対象 | `docs/implementation-plan.md` v0.2 Draft の C0 変更 |
| baseline | `e8b03f12a0fe3a06677a1bc78fc8f179009cb210` |
| 対象要求 | FR-LIC-001〜003、FR-LIC-010、NFR-MNT-001 |
| 非対象 | package採用、lock更新、Phase C実装、Gate 1/2判定 |

## B-GATE 初回実行

C0-PLANの入力となる初回B-GATEは次の結果で **BLOCKED** と判定した。未実施項目をPASSとして扱わない。

- Windows 11 Pro Insider Preview build 29648、x64、PowerShell 7.6.5、Node 24.19.0、npm 11.17.0。
- `npm ci`: exit 0、167 packages、監査結果0 vulnerabilities。
- `npm test`: 初回は4 workerの起動timeoutでtest 0件、exit 1。同じ未変更コードで再実行すると4 files・19 testsが合格、exit 0。初回失敗は競合を含む一過性の可能性があるが、C0-REVIEW後の連続Gate再実行で再確認する。
- `npm run typecheck`: exit 0。
- `npm run build`: exit 0。Main/Preload/Rendererの3 entryを生成。
- `uv lock --check`: uv 0.12.9でexit 0。
- `uv sync --locked`: `files.pythonhosted.org`とのTLS handshake失敗によりexit 1。CPython 3.14.7は選択されたがpytestは未実施。
- Ruff/Pyrightは現lockに実行packageがないため未実施。
- `ml/uv.lock`のworking treeはCRLF、HEAD blobはLFだが、LF正規化後はbyte一致しGit差分は0。正本hashはHEAD blobのSHA-256 `d54253bd1bde94622bc0bcc5bfad589bc5e45924d5c2f61bf227206c73fad68a`。

## 敵対的レビュー

独立したread-onlyレビューで、成果物所有権、循環依存、並列安全性、正本task数、Phase C必須package、証拠要件を確認した。

| ID | 指摘 | 再現 | 裁定・反映 |
|---|---|---|---|
| AR-01 | C0-REVIEW成果物にB-GATE再実行のPASS/BLOCKED証拠が明記されていない | 再現 | `c0-review.md`へ環境、実コマンド、exit code、test件数、lock不変性、判定を必須化した。 |
| AR-02 | C0-PLAN自身のreview記録fileがない | 証拠保存の不足として再現 | 本fileをC0-PLAN成果物へ追加した。レビュー後に再検証する通常手順であり、自己参照による無限ループという指摘部分はNot-a-defect。 |
| AR-03 | B-13の設定責務とRuff/Pyrightのlock責務が曖昧 | 再現 | 初回裁定ではB-13を対象設定、実行packageのexact lockをC0-PYTHONとした。その後の公式配布元調査に基づき、Pyrightのlock所有権だけをAR-08でC0-NODEへ再補正した。 |
| AR-04 | Node/Python採用記録の必須欄が不足 | 再現 | 用途、区分、exact版、一次資料、license/NOTICE、transitive、脆弱性、artifact/hash、smoke、review裁定を必須化した。 |
| AR-05 | C0追加で正本253 taskが変化する | 再現せず | C0は管理項目として別表に置き、正本taskには数えない。 |
| AR-06 | C0-NODEとC0-PYTHONに循環または出力重複がある | 再現せず | 両者はC0-PLANだけに依存し、package系とPython系で成果物が分離されている。 |
| AR-07 | Phase C必須packageがC0範囲から欠落する | 再現せず | better-sqlite3、electron-builder、Konva/react-konva、PyInstaller、PyTorch/TorchVision、Optuna、ONNX/ONNX Runtime、Ruff、Pyrightを列挙済み。後続調査で判明した監査toolの欠落はAR-09で`pip-audit`を追加し、Pyrightの所有先はAR-08で補正した。 |

### 採用調査開始後の追補レビュー

C0-NODE/C0-PYTHONの採用調査で公式所有者と監査手段を一次資料まで遡った結果、初回レビュー時には顕在化していなかった次の実在不備を確認した。

| ID | 指摘 | 再現 | 裁定・反映 |
|---|---|---|---|
| AR-08 | Pyrightの実行packageをC0-PYTHONへ割り当てていたが、Microsoft公式配布はnpm `pyright`であり、PyPI `pyright`はMicrosoft非公式wrapperである | 再現。Microsoft公式repositoryとnpm packageは`microsoft/pyright`を指し、PyPI wrapper自身がMicrosoft非提携と明記し、環境によってNode/npmをruntime取得する | 公式npm `pyright`のexact lockをC0-NODEへ移した。C0-PYTHONからPyrightを外し、PyPI wrapperとruntime downloaderを明示的に不採用とした。既存の`[tool.pyright]`設定は公式CLIから使用する。 |
| AR-09 | `docs/dependency-policy.md`が`uv run pip-audit`を必須化している一方、`pip-audit`実行packageのlock所有者がC0に存在しない | 再現。現行`ml/pyproject.toml`/`ml/uv.lock`はpytestだけをdev依存として持ち、B-GATEでもPython脆弱性監査を実行できない | `pip-audit`をC0-PYTHONのdev dependencyとしてexact lockし、lock済みPython依存の監査対象自身にも含めることを完了条件へ追加した。 |

## 修正後の確認

- `git diff --check`: exit 0。
- 正本task行: 253件、unique 253件、重複0件。
- C0管理項目: 4件（正本task数の対象外）。
- 依存順: B-GATE初回 → C0-PLAN → C0-NODE/C0-PYTHON（並列可）→ C0-REVIEW → B-GATE PASS → Phase C。
- C0-PLANでpackage、lock、production codeは変更していない。
- 最終独立再レビューでは、AR-02/03/05/06/07が反映済みで、文書内の実行証拠との矛盾がないことを確認した。
- AR-01のB-GATE PASS記録とAR-04のpackage別採用証拠は、依存先であるC0-NODE/C0-PYTHON/C0-REVIEWの未実施を示す正当なDeferred項目である。C0-PLANで実証を先取りすると依存順に違反するため、C0-PLANの欠陥ではないと裁定した。

### 追補修正後の確認

- AR-08/09の修正対象はC0のpackage所有権だけであり、C0管理項目数、正本task ID、依存DAG、Phase C開始条件を変更していない。
- C0-NODEとC0-PYTHONの出力fileは引き続き重複せず、公式npm PyrightをNode側へ移しても循環依存は生じない。
- Pyrightの設定責務はB-13、実行packageとlock責務はC0-NODEに分離され、Ruffと`pip-audit`の実行packageはC0-PYTHONが所有する。
- `pip-audit`を監査対象から除外する例外は設けず、C0-REVIEWでPython lock全体のCritical/Highをfail-closed確認する。

## 判定

C0-PLANは **VERIFIED**。C0全体およびB-GATEは未完であり、Phase Cは開始しない。
