# TERM-01 — 全 lane の終端記録

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書。[`202609232400-RemainTaskExecutionPlan.md`](202609232400-RemainTaskExecutionPlan.md)（以下「本計画」）§14 の TERM-01 の成果物 |
| 作成日時 | 2026-09-24 03:25 JST（初版）。04:30 JST に更新。15:23 JST に、残タスク実行計画 [`202609240830-RemainTaskExecutionPlan.md`](202609240830-RemainTaskExecutionPlan.md)（以下「08:30 計画」）の F1 として更新（内容の更新は 15:23 JST。15:29 JST に本欄の日時の記載だけを訂正） |
| 入力 | [`20260924-0306-RemainTaskRun-Baseline.md`](20260924-0306-RemainTaskRun-Baseline.md)（§6、§7 の run の記録）、08:30 計画 §2.1、[`20260924-0300-UirStatusRedetermination.md`](20260924-0300-UirStatusRedetermination.md)（AUD-01） |
| Gate 2 の終端化の記録 | [`20260924-1425-Gate2-TerminalState.md`](20260924-1425-Gate2-TerminalState.md)（G2F-00。終端化 run `2ac91e5d-b355-4080-b88c-a040b7514b86`、主 run `e7c6da3f-8f62-4785-b40e-fab254437a4b`） |

## 1. 結論

- 本計画 §18 の最終完了条件は、**すべては成立していない**（§4）。残りは、利用者の操作、所有者の判断、release 責任者の判断を待つものである。
- Gate 2 は **BLOCKED** で終端した。
  - 主 run: succeeded 9、failed 9、blocked 26。
  - 終端化 run: G2F-00・01r・01a1・01a3・03 の 5 node が succeeded。`run finish` は `accepted: true`。
  - `accepted: true` は、Gate 2 の成功を示さない。manifest は `ready=false` のままである。
- 04:30 からの主な変化は次のとおり。
  - npm `12.0.0` を用意した（PRE-02）。
  - G2D-09 の判断で `EXT-ATG` を完了した（PRE-03A）。
  - main graph の分割判定をやり直した（PRE-04）。
  - AUD-02 と GAL-01・GAL-02 を完了した。
  - gallery の実装 node（GAL-D1・I1・T1）を完了した。
  - TBD-09 の別計画を作った。

## 2. node の終端状態

状態は `done / failed / not-started` のどれかである。`failed` は、実行したが DoD を満たさなかった node を表す。

| ID | 状態 | 理由（区分: 利用者・所有者・外部前提・Gate 待ち・なし） |
|---|---|---|
| PRE-00 | failed | 利用者。利用者本人の確認がない。回答は「C: 私が後で行います」（08:30 計画 §2.1、§11 の U-01）。機械的な部分は成立している。編集中の session はなく、10 分おいて取った 2 回の hash も一致した（Baseline §6.2） |
| PRE-01 | done | なし。5 file の SHA-256 を固定した（Baseline §6.3）。08:30 の再計算でも一致した |
| PRE-02 | done | 留保あり（所有者）。npm `12.0.0` を `%LOCALAPPDATA%\npm-12.0.0` へ install した（Baseline §7.1）。ただし、install の方法が組織承認済みかどうかは確認していない（G2D-11 は `選択: 未確定`） |
| PRE-03 | done | なし。初回は exit 1 だった。修正の後に再実行し、①② とも exit 0（Baseline §6.1・§6.5） |
| PRE-03A | done | なし。準備 run 2 `d77c9409-405d-44cc-8bbd-afb37eb92961` で、G2D-09 と `EXT-ATG` が succeeded になった。`run finish` は `accepted=1`（Baseline §7.3） |
| PRE-04 | done | なし。[`20260924-0710-Gate2-SplitRejudgment.md`](20260924-0710-Gate2-SplitRejudgment.md)。main graph は 44 node で、graph check と contract check は exit 0 |
| MAN-01 | not-started | 利用者。UIR-017 の本人確認は、利用者本人の操作である。利用者の回答はないため、`NOT_RUN` を保つ |
| MAN-02 | not-started | 利用者。署名前 package での W3-08 の実機受入と OS の再起動は、利用者だけが行う |
| MAN-03 | not-started | 利用者。MAN-02（W3-08 の実機受入）が終わっていない。`EXT-ATG` の前提は PRE-03A で解消した |
| MAN-04 | not-started | 利用者。容量不足にした保存先は、利用者が用意する（実行主体はディスクを操作しない） |
| MAN-05 | not-started | 利用者。AUD-01 で、UIR-041Q の前提は「完了」、UIR-084 の前提は「未完了」と判定した。041Q は利用者の本人確認がなく、084 は起動条件が成り立たない |
| AUD-01 | done | なし。11 項目を判定した（完了 4、未完了 7、未確認 0） |
| AUD-02 | done | なし。[`20260924-0630-Wave2CompletionAudit.md`](20260924-0630-Wave2CompletionAudit.md) |
| GAL-01 | done | なし。[`20260924-0630-GalleryBeyond200Investigation.md`](20260924-0630-GalleryBeyond200Investigation.md)。201 件目へは到達できない |
| GAL-02 | done | なし。[`20260924-0700-GAL02-GraphRecord.md`](20260924-0700-GAL02-GraphRecord.md) の graph は check exit 0。GAL の run の結果は §3 の §5-9 に書く |
| TBD09-D | failed | 所有者。[`2026-09-24-owner-ruling-TBD-09.md`](../docs/model-governance/evidence/2026-09-24-owner-ruling-TBD-09.md) は、要否を「改訂する」とし、時期を `選択: 未確定` とした（43 行）。本計画 §12 の完了条件（`選択:` の行が A か B）を満たさない |
| POST-01 | not-started | Gate 待ち。Gate 2 は BLOCKED |
| POST-02 | not-started | Gate 待ち。Gate 2 は BLOCKED |
| POST-03 | not-started | Gate 待ち。Gate 2 は BLOCKED。D-16・REP-11 も決まっていない |
| POST-04 | not-started | Gate 待ち。Gate 2 は BLOCKED |

## 3. 本計画 §5 の未完了事項（15 件）の状態

| 事項 | 状態 | 担当 node と理由 |
|---|---|---|
| §5-1 Gate 2 | failed | 所有者。主 run は succeeded 9、failed 9、blocked 26（G2D-01・02・04・06・10・12 は所有者の回答がない。G2D-11 は方法の承認が未確認。G2T-10 は parity FAIL。`EXT-X1` は原因が確定しない）。終端化 run の 5 node は succeeded で、BLOCKED として終端した（manifest `ready=false`、ADR-0004、実行記録 [`20260924-1425-Gate2-RemainTaskExecution.md`](20260924-1425-Gate2-RemainTaskExecution.md)） |
| §5-2 `EXT-41`・`EXT-ATG`・`EXT-X1` | failed | 所有者・外部前提。`EXT-ATG` は done（準備 run 2）。`EXT-X1` は failed で、原因調査では 3 回中 0 回しか再現しなかったため、原因が確定していない（[`20260924-0730-EXT-X1-Status.md`](20260924-0730-EXT-X1-Status.md)）。`EXT-41` は blocked（G2D-04 は所有者の回答がない） |
| §5-3 UIR-017（W1-01） | not-started | MAN-01。利用者 |
| §5-4 UIR-041Q / UIR-084 | not-started | AUD-01 で前提を判定した（041Q は完了、084 は未完了）。MAN-05 は利用者 |
| §5-5 親 UIR-025 | not-started | AUD-01 で、残条件 9 件のうち #1・#3・#5 を完了、#2・#4・#6〜#9 を未完了と判定した。未完了の条件を閉じる node は本計画にない（08:30 計画 §11 の U-10） |
| §5-6 W3-08 | not-started | MAN-02。利用者 |
| §5-7 W4-02 の最終化 | not-started | MAN-03。利用者（MAN-02 を待つ） |
| §5-8 容量不足時の表示 | not-started | MAN-04。利用者 |
| §5-9 200 件を超える画像 | failed | 所有者（release 責任者）。GAL の run `bbb01912-859a-49b4-8819-4d928913c9da` では、GAL-D1・I1・T1 が succeeded になった。201 件目以降へ到達する実装と、境界の test ができている。GAL-V1 は failed（root version の値は release 責任者が決める）。`run finish` は `accepted: true`（[`20260924-1415-GAL-Acceptance.md`](20260924-1415-GAL-Acceptance.md)） |
| §5-10 全体並列実行時の test 失敗 | failed | 外部前提。G2X-01a〜c（診断）は succeeded。集約 `npm test` では 7 file、21 件が失敗する。`EXT-X1` は原因が確定しないため failed（§5-2） |
| §5-11 TBD-09 | not-started | 所有者。C1 で別計画 [`20260924-1341-TBD09-SchemaFieldRenamePlan.md`](20260924-1341-TBD09-SchemaFieldRenamePlan.md) を作った（graph check exit 0）。その実装 node は、時期（A / B）と field 名の案の承認を待つ（TBD09-D は failed） |
| §5-12 PKG-01 | not-started | POST-02。Gate 待ち |
| §5-13 Phase H〜N、users-guide §11〜15 | not-started | POST-01〜04。Gate 待ち |
| §5-14 D-16 | not-started | POST-03 の blocked 条件。利用者の証明書の提示を待つ |
| §5-15 REP-11 | not-started | POST-03 の blocked 条件。所有者の判断を待つ |

## 4. 完了条件の検査

- 検査 script: [`20260924-0325-TERM01-Check.ps1`](20260924-0325-TERM01-Check.ps1)。
- 確かめる内容:
  - §2 の node ID 20 件と §3 の 15 事項が、許可した状態と空でない理由で 1 回ずつ記録されている。
  - `running` がない。
  - Gate 2 の終端化の記録への参照がちょうど 1 件あり、その file がある。

evidence: `pwsh -NoLogo -NoProfile -File work\20260924-0325-TERM01-Check.ps1` exit=0

TERM-01 の完了条件は成立する。本計画 §18 の最終完了条件の状態は次のとおり。

- 成立する:
  - 1: すべての事項が、done か、理由付きで記録されている。
  - 2: 未実施の理由が付いている。
  - 4: GAL-T1 の境界の test が通る。
  - 5: Gate 2 は証拠付きの BLOCKED で終端した。G2F-00・01r・01a1・01a3・03 の各 Review は blocking 0。
- 成立しない:
  - 3: W4-02 は最終化していない（MAN-03）。
  - 7: 置き換えた run（準備 run 1 `94056f52-…`、終端化 run 1〜3）は `accepted: false` のままである。有効な 4 run（Baseline §7.3）は `accepted: true`。
- 対象外:
  - 6: Gate 2 は GO になっていない。

## 5. 再開に必要なもの

| # | 必要なもの | 解除される node |
|---|---|---|
| 1 | npm `12.0.0` の install の方法が、組織承認済みかどうか（G2D-11。08:30 計画 U-03） | G2D-11 と、`DOCS` で検証した node の再検証の要否 |
| 2 | 主 run の所有者判断（G2D-01・02・04〜08・10・12）、G2T-10 の扱い、利用者の session（G2Q-04 / 05） | Gate 2 の新しい主 run（08:30 計画 U-02・U-04） |
| 3 | `EXT-X1` の再現の条件（08:30 計画 U-05） | `EXT-X1`、§5-10 |
| 4 | 利用者本人による PRE-00 の確認 | PRE-00 |
| 5 | 利用者の本人確認、実機受入、容量不足の環境 | MAN-01〜05 |
| 6 | TBD-09 の時期と field 名の案の承認（U-06） | TBD09-D、C1 の計画の実装 node |
| 7 | root version の値（U-07） | GAL-V1、T9-V |

## 6. 本記録が主張しないこと

1. Gate 2 が通過したとは主張しない。ATG の `accepted: true` は、受入コマンドが exit 0 だったことだけを示す。
2. 利用者が本人確認や実機受入を行ったとは記録しない。PRE-00 で利用者の確認を得たとも記録しない。
3. AUD-01 の判定を `docs/ui-ux-execution.md` の状態に反映していない。
4. 所有者の判断を生成していない。G2D-11 と TBD-09 の時期は `選択: 未確定` のままである。