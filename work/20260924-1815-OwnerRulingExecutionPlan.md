# 所有者・利用者の回答（2026-09-24 18 時）の実行計画

- 作成日: 2026-09-24 18:15 JST
- 入力: 利用者の回答（本 file §1 に原文）。前回の Next Steps の回答（A-1〜A-8、B-1〜B-7、C）への回答である。
- 正本: 要求定義 `docs/requirement-definition.md`（利用者の指示の `/hve-dev/requirement-definition.md` は repository に無いため、同名の `docs/` の file を使う）。Gate 2 計画 `work/202609232120-RemainTaskExecutionPlan.md`、前回の残タスク計画 `work/202609240830-RemainTaskExecutionPlan.md`（§11 U-01〜U-10）。
- 起点: `5cf1444`（作業ツリーは clean。`git status --porcelain -uall` が 0 行、18:14 JST）。

## 1. 回答の原文

> G2D-01: A / G2D-02: A / G2D-04: 候補1 / G2D-05: A / G2D-06: 署名する（§1〜§3 を確認済み） / G2D-10: A / G2D-12: A / G2D-11: A（取得元 feed は組織承認済み）※または B / G2T-10: A（allclose の形で解釈する） / TBD-09: 時期 A、名前は案のとおり / GAL-V1: 0.1.11（EXT-X1 の解消後に更新） / EXT-X1: (a)→(b) を実行してよい / U-10: #2 だけを範囲に入れる / W3-08: A（PKG phase まで保留）
> B-2: 無い。あっても無視をしてよい。 / B-3: 確認済み / B-5: タスクから除外する / B-6: 確認済み。

（改行を ` / ` に置き換えた。B-2 は PRE-00、B-3 は MAN-01、B-5 は MAN-04、B-6 は MAN-05 の問い。）

「不明点はデフォルトのプランを採用」の指示に従い、次の 2 点は既定の案で進める。

1. G2D-11 は「A」を採る（「※または B」は代替の許可であり、A の条件「取得元 feed は組織承認済み」が回答に含まれるため A にする）。
2. G2D-04 の「候補1」は、Gate 2 計画の選択肢の「実装する」（`work/20260924-0730-Gate2Main-verify.ps1` の `G2D-04` の `選択: 実装する`）に、候補 1 の方式（`work/20260924-0730-AssistSessionRecording.md` 「候補 1」、製品 code の変更なし）を付けたものとして記録する。

既定の案で埋めないもの（回答から導けないため、推測せずに block する。敵対的レビュー `work/20260924-1815-P0-Review.md` の 3 と 5）:

- T9-V の版と G2D-08（Gate 2 の製品版）: 回答の `0.1.11` は GAL-V1 に対するものである。T9-V は TBD-09 計画 §5（`work/20260924-1341-TBD09-SchemaFieldRenamePlan.md:74`）のとおり、専用の決定記録ができるまで起動しない。
- MAN-01・MAN-05 の状態: 回答「確認済み」は原文のまま記録するが、2400 計画の MAN-01 の完了条件（現在対象・表示状態・次の結果・戻り先の実回答と期待 ID の照合。`work/202609232400-RemainTaskExecutionPlan.md:200`）を満たす操作ごとの回答ではないため、状態（`NOT_RUN`・`BLOCKED`）は変えない。操作ごとの回答は ask_user で求める。
- PRE-00・MAN-04・W3-08・U-10・EXT-X1 の扱いは §1 の原文を出典として Z で TERM-01 に記録する（別の記録 file は作らない）。

## 2. 並列化と直列化

- ATG の helper（`work/20260924-0620-atg-node.py`）は、ノードの `begin` から `end` までの repository の変更を、そのノードの write set と照合する。このため repository に書く作業は `lock:shared-tree` で 1 つずつ行う（前回の計画 §4.2 と同じ）。
- 並列にするもの: 各 task の敵対的レビュー（読み取りだけ）と、次の task の下書き（repository の外の session folder に書く）。EXT-X1 の (a) の実行中は、ほかの process を起動しない（§4 X の条件）。repository への書込みは tool による file の編集だけにする。
- `lock:model-manifest`: G2F-01r（終端化 run の manifest の reason）と TBD-09 の T9-S/T9-M/T9-T は直列。TBD-09 は TBD-09 計画 §6 の 2 のとおり、Gate 2 の終端化 run の `run finish` の後に行う。
- `lock:root-version`: V（GAL-V1）だけが root の版を変える。T9-V は block（§1）。T（TBD-09 の改名）は V の後に行い、T9-V の版の明示の決定がある場合だけ起動する（TBD-09 計画 §5）。

## 3. タスク一覧と完了条件（DoD）

各 task の後に敵対的レビューを行い、`work/20260924-1815-<ID>-Review.md` に `blocking: 0` の行があることを完了条件に含める（`Select-String -Path <Review> -Pattern '^blocking: 0$' -Quiet` が True。ATG のノードは各グラフの Review file の名前に従う）。`NPM12` は `$env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH; if ((npm --version) -ne '12.0.0') { exit 2 }`、`DOCS` は NPM12 の後の `npm run verify:docs`、`MANIFEST` は `node --test scripts/models/manifest-schema.test.mjs`。`EVI` は起点からの evidence の変更の allowlist 検査: `git status --porcelain -uall -- docs/model-governance/evidence` の各行が `?? <許可した新規 file>` だけであること（既存 file の変更 ` M` があれば失敗）。

| ID | 内容 | 依存 | 完了条件（DoD） |
|---|---|---|---|
| P0 | 本計画 | なし | Review |
| R2 | 証拠の記録（Gate 2 の graph の入力になるもの）: G2T-10 の許容差の判断、TBD-09 の時期と名前の判断 | P0 | `docs/model-governance/evidence/2026-09-24-owner-ruling-G2T-10.md` と `2026-09-24-owner-ruling-TBD-09-timing-and-names.md` の各々に `^選択: A$` が 1 行、`判断者`、`^> ` の行がある。`EVI`（許可はこの 2 file）。`DOCS` exit 0。Review |
| R3 | MAN-01・MAN-05 の回答の記録（状態は変えない。§1） | P0 | `tests/manual/ui-shell-review.md` の本人確認の節に `2026-09-24` と `確認済み` がある（`Select-String` が True）。`docs/ui-ux-execution.md` に 2026-09-24 の記録の節があり、§3 の UIR-017 の行が `BLOCKED（本人確認）` のまま（`Select-String -SimpleMatch '| UIR-017 | BLOCKED（本人確認） |'` が True）。W1-02 の表の UIR-041Q と UIR-084 の行が `**未実施**` のまま（2 行とも `Select-String -Pattern '^\| UIR-0(41Q|84) \|.*\*\*未実施\*\*'` で 2 件）。追記する 2026-09-24 の節（見出し `## 8. 本人確認の回答の記録（2026-09-24）`）の中に `完了` の語が無く、UIR-017 は `BLOCKED`、UIR-041Q と UIR-084 は `未実施` と書かれている（節を切り出した `Select-String` で検査）。`DOCS` と `npm run test:docs` exit 0。Review |
| X | EXT-X1 の (a)→(b)（§4 X） | P0 | `pwsh -File work/20260924-1815-X-Check.ps1` が exit 0。検査の内容: raw log `work/20260924-1815-EXT-X1-a.raw.log` の各 `start` の行に `npm_version=12.0.0` がある。実行記録 `work/20260924-0730-EXT-X1-ExecutionRecord.md` の `^\(a\) 完了した回: (\d)/3 再現: (\d)$` が 1 行で、完了した回の数が raw log の `exit=<code> end` の行数と、再現の数がそのうち code が 0 でない行数と一致する。再現が 0 の場合だけ `^\(b\) 不実施: ` を許し、1 以上の場合は raw log `work/20260924-1815-EXT-X1-b.raw.log` に `b-first 1`・`b-first 2`・`b-second 1`・`b-second 2` の各々について `start … npm_version=12.0.0` と `exit=<code> end` の行がちょうど 1 行ずつあり、`^files: first ` と `^files: second ` の行が各 1 行あり、実行記録に `^\(b\) 実施: ` がある。早期終了（停止の再試行も停止）の場合は完了した回が 3 未満になる。Review |
| G | Gate 2 主 run の再実行（§4 G） | R2、X | 起動前に main2 の `python -m atg graph check` と `python -m atg contract check` が exit 0。新しい実行 ID で `run finish` を実行し、`work/20260924-1815-Gate2Main2-Acceptance.md` に `acceptance_exit:`・`accepted:` の各 1 行を書く。`pwsh -File work/20260924-1410-RunFinish-check.ps1 <Acceptance> <実行 ID> <状態 DB>` が exit 0。各ノードの DoD は `work/20260924-1815-Gate2Main2-verify.ps1 <ID>` が exit 0（ATG の `node finish` がこれを強制する）。所有者・利用者が要るノードは `node fail --class contract` か依存による `blocked` で終端にする |
| F | Gate 2 の終端化 run の再実行（前回の B1〜B7 と同じ形） | G | 新しい終端化 run の Acceptance file について `RunFinish-check.ps1` が exit 0。終端記録 `work/20260924-0345-Gate2-TerminalState.md` が新しい主 run の実行 ID を含む（`Select-String -SimpleMatch` が True）。訂正（2026-09-24 F の実行後）: 終端記録は `work/20260924-1815-Gate2-TerminalState.md` とする。`0345` の file は準備 run の段階の記録（1 行目 `主 run: 未作成`）で、`work/20260924-0345-Gate2-TerminalState-check.ps1` がその内容を検査するため、変更しない。前回の終端化 run も、新しい file `work/20260924-1425-Gate2-TerminalState.md` を作った。検査は `Select-String -Path work/20260924-1815-Gate2-TerminalState.md -SimpleMatch 0b7a6834-a226-4f48-b87c-5bc31dc2f2cd -Quiet` が True であること。Review |
| T | TBD-09 の改名（T9-S〜T9-V の全ノード） | F、V、R2 | 起動の条件: T9-V の版の明示の決定（`work/20260924-1341-TBD09-VersionDecision.md` の `^version: \d+\.\d+\.\d+$`。TBD-09 計画 §5）。V の後に ask_user で release 責任者に問い、回答がない場合は T 全体を起動せず、Z で理由を記録する（T9-V を除いた部分実行はしない）。起動する場合: graph `work/20260924-1815-TBD09-atg-graph2.json`（元の graph の複製に、R2 の TBD-09 の判断記録を T9-S と T9-R の inputs として加えたもの）と、新しく作る契約 `work/20260924-1815-TBD09-atg-contract.json`（objective: TBD-09 計画 §5 の改名を行う。non_goals: TBD-09 計画 §2 の 4 項目。deliverables: graph の全 outputs の和集合。acceptance_command: `pwsh -NoLogo -NoProfile -Command "$env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH; if ((npm --version) -ne '12.0.0') { exit 2 }; npm run verify:docs; if ($LASTEXITCODE) { exit $LASTEXITCODE }; npm run test:docs; if ($LASTEXITCODE) { exit $LASTEXITCODE }; node --test scripts/models/manifest-schema.test.mjs; exit $LASTEXITCODE"`。time_budget: `600m`（TBD-09 計画 §5 の 6 ノード）。baseline_policy・execution_envelope・secret_policy は主 run の契約 `work/202609232120-atg-contract-main.json` と同じ値）の `graph check`・`contract check` が exit 0。各ノードの完了条件は TBD-09 計画 §5（ATG の verify）。run の Acceptance file の `RunFinish-check.ps1` が exit 0 |
| U | U-10 #2（削除の preview の古い応答の抑止） | P0 | 別計画（1 ノード 1 成果物）の `python -m atg graph check` が exit 0。各ノードの verify（対象 test の vitest exit 0、`npm run typecheck` exit 0）。U の run の `RunFinish-check.ps1` が exit 0 |
| V | 版 `0.1.11`（GAL-V1） | X、U、F | EXT-X1 が解消した場合だけ行う（§1 の GAL-V1 の条件）。CONTRIBUTING「製品バージョンの更新順」（`CONTRIBUTING.md:178`〜`:183`）の 1〜4: 決定記録 `work/20260924-1815-GAL-V1-VersionDecision.md` に `^version: 0\.1\.11$`、NPM12 の `npm version 0.1.11 --no-git-tag-version` が exit 0、`npm run verify:version`・`npm run test:version` exit 0（3 箇所の版の一致）、`git tag --list` が実行前と同じ、aggregate `npm test`・`npm run typecheck`・aggregate `npm run build` が exit 0。解消しない場合は行わず、Z で理由を記録する |
| Z | 終端の記録: TERM-01・Baseline の更新、`CHANGELOG.md`、ATG の版（ATG の file を変えた場合だけ）、最終検証、最終レビュー | すべて | `pwsh -File work/20260924-0325-TERM01-Check.ps1` が exit 0。`DOCS`・`npm run test:docs`・`MANIFEST`・`git diff --check` が exit 0。最終 Review |

## 4. 個別の設計

### X: EXT-X1 の (a)→(b)

- raw log（`work/20260924-1815-EXT-X1-a.raw.log`、`-b.raw.log`）は開始時に存在しないことを確かめてから作る（`Test-Path` が False。前回の出力の混入を防ぐ）。
- (a) 集約 `npm test` を、worker 数を固定して 3 回（回数は測定の前に固定し、結果で増やさない）。各回は別の shell で次を実行する（`$n` は回の番号）。`--maxWorkers=19` は `package.json` の `test` script の末尾の `vitest run` に渡る（E1 の計画 §2 と同じ値）。

```powershell
$env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH
$raw = 'work\20260924-1815-EXT-X1-a.raw.log'
$v = npm.cmd --version
"run $n start $(Get-Date -Format o) npm_version=$v node_processes=$(@(Get-Process node -ErrorAction SilentlyContinue).Count)" | Add-Content $raw
if ($v -ne '12.0.0') { "run $n exit=2 npm-version-mismatch" | Add-Content $raw; exit 2 }
npm.cmd test -- --maxWorkers=19 *>&1 | Add-Content $raw
"run $n exit=$LASTEXITCODE end $(Get-Date -Format o)" | Add-Content $raw
```

- 訂正（2026-09-24 18:54）: 当初の `npm test -- --maxWorkers=19` は、PATH の `npm` が `npm.ps1` に解決され PowerShell が `--` を取り除くため、npm が `EUNKNOWNCONFIG Unknown cli flag: --maxWorkers` で test を始める前に exit 1 で終わった（18:54:12〜18:54:13。log は `work/20260924-1815-EXT-X1-a-cmd-error.raw.log` に改名して残した）。test は実行されておらず再現の判定に使えないため、`npm.cmd`（`--` を渡す。`npm.cmd run typecheck -- --help` で `tsc ... --help` に渡ることを確かめた）に替え、新しい raw log で run 1 からやり直した。

- 各回の実行中は、ほかの process（node・python・vitest・npm・git）を起動しない。repository への書込みは tool による file の編集だけにする。停止の規則は E1 の計画 §2 と同じ（10 分以上出力が進まない回は process ID を指定して止め、`run <n> stopped reason=no-progress pid=<PID>` を書き、再試行は 1 回）。
- (b) (a) で失敗が 1 回以上再現した場合だけ行う探索である。失敗した file 群（再現した回の `FAIL` の行）を基準群として固定し、残りの file（(a) の raw log の vitest の file 行に現れた test file から基準群を除いたもの）を名前順（PowerShell の `Sort-Object -Unique`）の前半（切り上げ）と後半に分けた 2 つの集合を、それぞれ基準群と一緒に 2 回ずつ実行する（回数は事前に固定）。訂正（2026-09-24 19:06）: (a) の raw log は非 TTY の既定 reporter のため失敗した file の行しか持たず、全体の file 一覧を得られない。全体は (b) の開始時の `& .\node_modules\.bin\vitest.cmd list --filesOnly` の出力（`\` を `/` に替え、repository root からの相対 path）とし、(b) の raw log の先頭に `files: all <file 一覧>` の 1 行で書く（`X-Check.ps1` もこの行を読むように直した）。コマンドは NPM12 の後の `& .\node_modules\.bin\vitest.cmd run --maxWorkers=19 <file 一覧>`。raw log `work/20260924-1815-EXT-X1-b.raw.log` に、先頭に `files: first <file 一覧>` と `files: second <file 一覧>` の各 1 行を、各回に `b-<first|second> <k> start … npm_version=<版>` と `b-<first|second> <k> exit=<code> end …` の行を書く。(b) の結果だけでは原因を確定とせず、修正ノードを作らない。確定は E1 の計画 §3 の条件（成立した分岐を示す観測、または固定条件で 1 要因だけを変えた比較の再現）による。
- 記録: 実行記録に `(a) 完了した回: <n>/3 再現: <m>` の 1 行（`<n>` は `exit=` で終わった回の数、`<m>` はそのうち exit が 0 でない回の数）と、`(b) 実施: …` か `(b) 不実施: <理由>` の 1 行を書く。
- 判断: 「確定」を満たした場合だけ file ごとの修正ノードを作る。満たさない場合、EXT-X1 は未解消のまま `node fail --class contract` で記録し、V は行わない。

### G: Gate 2 主 run の再実行

- 前回の計画 U-02 の手順: 新しい実行 ID で `run begin` する。所有者の判断で変わる箇所があるため、前回の graph・契約・verify を複製し、次の差分だけを加えた版を使う（状態 `work/20260924-1815-Gate2Main2-atg-state/main.sqlite3`）。前回の file（`work/202609232120-atg-graph-main.json`、`work/202609232120-atg-contract-main.json`、`work/20260924-0730-Gate2Main-verify.ps1`）は変更しない。
  1. graph `work/20260924-1815-atg-graph-main2.json`: G2T-10 の inputs に R2 の G2T-10 の判断記録を加える。G2D-11 の write set を新しい evidence file `docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-11-readiness.md` に替える（既存の G2D-11 の file は変更しない。Gate 2 計画 §8.1、同 file の版管理の節）。Review file と verify script の path を本 run の名前（`work/20260924-1815-Gate2Main2-<ID>-Review.md`、`work/20260924-1815-Gate2Main2-verify.ps1`）に替える。
  2. 契約 `work/20260924-1815-atg-contract-main2.json`: deliverables を main2 の graph の全ノードの outputs の和集合に合わせる（`.github/skills/atg/references/plan-to-graph.md` の変換規則）。non-goal「parity・性能・品質の基準を測定後に変えない」に「所有者の判断記録 `2026-09-24-owner-ruling-G2T-10.md` による G2T-10 の許容差の変更を除く」を加える。この変更は所有者の判断による明示の契約改訂であり、前回の G2T-10 の FAIL（`spikes/models/classification-checkpoint-result.md` §8）は履歴として残す。
  3. verify `work/20260924-1815-Gate2Main2-verify.ps1`: G2D-11 の検査対象を新しい file に替え、Review の path を替える。G2T-10 には、結果 JSON の `tolerances` が `logit_rule=allclose`・`rtol=0.001`・`atol=0.0001`・`min_top1_agreement=0.995` であることと、各比較の `logit_allclose` が true で top-1 一致率が 0.995 以上であることの検査を加える。ほかの検査は変えない。
- 前回の run（`e7c6da3f-8f62-4785-b40e-fab254437a4b`）で succeeded の 9 ノード（G2T-11、G2T-40、G2T-50C、G2T-50D、G2T-60C、G2T-60D、G2X-01a〜c）は、成果物を変えずに verify を再実行して finish する。
- 所有者の判断のノード（G2D-01、02、04、05、06、10、11、12）: 1 判断 1 file（Gate 2 計画 §8.1）。
- G2T-10: R2 の判断（FR-TRN-018 の allclose: rtol 1e-3・atol 1e-4、top-1 一致率 ≥ 99.5%。向きは選ばず両方向で満たすことを要求する実装上の取り決め）を測定の前に `classification_checkpoint_parity.py` の transfer mode に反映してから測る。新しい script と新しい mode は作らない（Gate 2 計画 §8.2）。softmax 確率と top-5 集合は FR-TRN-018 の既定の許容差に含まれないため、transfer mode では判定に使わず観測値として残す（R2 の review の指摘の反映）。結果は測定から書き、PASS を先に書かない。
- EXT-41: 候補 1 は製品 code を変えない。別計画に作業者の手順（外部の stopwatch、作業中の outcome の入力、C7 の sidecar、JSON Lines の作り方）を書き、合成データの session が `load_session` を通るコマンドと、`seconds` の無い record を拒むコマンドの exit code を実行記録に書く。値を補完する手段は作らない。
- G2Q-01C/01D は提案の数値を作り、G2D-07C/07D で所有者に承認を問う（ask_user）。回答がない場合は `node fail --class contract` にする。
- G2D-08 は §1 のとおり明示の回答がないため `node fail --class contract` にする。
- 利用者の実作業（G2Q-04C/04D の session）と、その後のノードは起動できない（依存により `blocked`）。

## 5. 監視

各 task の開始と終了で Current Status / Risk Check / Recommendation を報告する。10 分以上出力が進まない process は停止する（§4 X、前回の計画 §17）。
