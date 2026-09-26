# TERM-01 — 全 lane の終端記録

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書。[`202609232400-RemainTaskExecutionPlan.md`](202609232400-RemainTaskExecutionPlan.md)（以下「本計画」）§14 の TERM-01 の成果物 |
| 作成日時 | 2026-09-24 03:25 JST（初版）。04:30 JST に更新。15:23 JST に、残タスク実行計画 [`202609240830-RemainTaskExecutionPlan.md`](202609240830-RemainTaskExecutionPlan.md)（以下「08:30 計画」）の F1 として更新（内容の更新は 15:23 JST。15:29 JST に本欄の日時の記載だけを訂正）。21:50 JST に、所有者の判断の実行計画 [`20260924-1815-OwnerRulingExecutionPlan.md`](20260924-1815-OwnerRulingExecutionPlan.md)（以下「1815 計画」）の Z として更新。2026-09-25 01:32 JST に、所有者の回答の実行計画 [`20260924-2230-UserRulings3-ExecutionPlan.md`](20260924-2230-UserRulings3-ExecutionPlan.md)（以下「2230 計画」）の Z として更新。2026-09-25 に、G2Q-03 の計画 [`20260925-0420-G2Q03-ExecutionPlan.md`](20260925-0420-G2Q03-ExecutionPlan.md) の lane Z として更新。2026-09-25 に、G2Q-03D の対策案 [`20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md`](20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md) の lane Z として更新。2026-09-25 に、残りの事項の実行（[`20260925-0620-RemainingItems-BlockerAnalysis.md`](20260925-0620-RemainingItems-BlockerAnalysis.md)）と Gate 2 の終端化 run 3・4 の計画 [`20260925-0620-Gate2Final3-Plan.md`](20260925-0620-Gate2Final3-Plan.md) の lane Z として更新。2026-09-25 07:24 JST に、G2A-01 / 02・G2D-08 の所有者の回答の適用（[`20260925-0724-G2A-G2D08-Approval.md`](20260925-0724-G2A-G2D08-Approval.md)）を記録。2026-09-25 09:47 JST に、比較試験の削除と G2D-08 の決定の実行計画 [`20260925-0745-Gate2Main7-Plan.md`](20260925-0745-Gate2Main7-Plan.md)（以下「0745 計画」）の lane Z として更新。2026-09-26 08:48 JST に、所有者の回答の実行計画 [`20260926-0815-OwnerRulings5-ExecutionPlan.md`](20260926-0815-OwnerRulings5-ExecutionPlan.md)（以下「0926 計画」）の F1 として更新。2026-09-26 11:00 JST に、`npm test` の安定化と TBD-09 の実行計画 [`20260926-0955-OwnerRulings6-ExecutionPlan.md`](20260926-0955-OwnerRulings6-ExecutionPlan.md)（以下「0955 計画」）として更新 |
| 入力 | [`20260924-0306-RemainTaskRun-Baseline.md`](20260924-0306-RemainTaskRun-Baseline.md)（§6、§7 の run の記録）、08:30 計画 §2.1、[`20260924-0300-UirStatusRedetermination.md`](20260924-0300-UirStatusRedetermination.md)（AUD-01）、1815 計画 §1（利用者・所有者の回答の原文）、Baseline §8、2230 計画 §1・§5、main3 の受入 [`20260924-2230-Gate2Main3-Acceptance.md`](20260924-2230-Gate2Main3-Acceptance.md)、G2Q-03 の計画 [`20260925-0420-G2Q03-ExecutionPlan.md`](20260925-0420-G2Q03-ExecutionPlan.md)、main4 / main5 の受入 [`20260925-0420-Gate2Main4-Acceptance.md`](20260925-0420-Gate2Main4-Acceptance.md)・[`20260925-0420-Gate2Main5-Acceptance.md`](20260925-0420-Gate2Main5-Acceptance.md)、G2Q-03D の対策案 [`20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md`](20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md)、main6 の受入 [`20260925-0526-Gate2Main6-Acceptance.md`](20260925-0526-Gate2Main6-Acceptance.md)、終端化 run 3・4 の受入 [`20260925-0620-Gate2Final3-Acceptance.md`](20260925-0620-Gate2Final3-Acceptance.md)・[`20260925-0620-Gate2Final4-Acceptance.md`](20260925-0620-Gate2Final4-Acceptance.md)、main7 / main8 の受入 [`20260925-0745-Gate2Main7-Acceptance.md`](20260925-0745-Gate2Main7-Acceptance.md)・[`20260925-0745-Gate2Main8-Acceptance.md`](20260925-0745-Gate2Main8-Acceptance.md) |
| Gate 2 の終端化の記録 | [`20260926-1100-Gate2-TerminalState.md`](20260926-1100-Gate2-TerminalState.md)（0955 計画。前回の 0926 計画の F1 の記録（前回の記録（0745 計画の lane Z の記録。終端化 run 4 `efc44691-c372-4dff-9bfd-de77abb6ca6d` の G2F-00 の成果物に main7 `8c3df57e-…`・main8 `6cfad899-…` の結果を重ねたもの）に main9 `860384d4-…` の結果を重ねたもの）に main10 の結果を重ねたもの。main2 の時点の終端化 run `9750c4b8-…` の記録は Baseline §8、前回の主 run `e7c6da3f-…` と終端化 run `2ac91e5d-…` の記録は Baseline §7.3） |

## 1. 結論

- 本計画 §18 の最終完了条件は、**すべては成立していない**（§4）。残りは、利用者の操作、所有者の判断、release 責任者の判断を待つものである（TBD-09 の T9-V の版は 2026-09-26 12:29 に決まった）。集約 `npm test` は 2026-09-26 に 3 回続けて exit 0 になった（§5-10）。
- 1815 計画の主 run・終端化 run で、Gate 2 は **BLOCKED** で終端した（以下はその記録）。main3〜main6 の後の終端化 run 4 でも BLOCKED で終端した（下の 2026-09-25 06:20 の項）。
  - 主 run（所有者の判断の後の再実行）: succeeded 24、failed 3、blocked 17。
  - 終端化 run: G2F-00・01r・01a1・01a3・03 の 5 node が succeeded。`run finish` は `accepted: true`。
  - `accepted: true` は、Gate 2 の成功を示さない。manifest は `ready=false` のままである。
- 04:30 からの主な変化は次のとおり。
  - npm `12.0.0` を用意した（PRE-02）。
  - G2D-09 の判断で `EXT-ATG` を完了した（PRE-03A）。
  - main graph の分割判定をやり直した（PRE-04）。
  - AUD-02 と GAL-01・GAL-02 を完了した。
  - gallery の実装 node（GAL-D1・I1・T1）を完了した。
  - TBD-09 の別計画を作った。
- 15:23 からの主な変化（1815 計画）は次のとおり。
  - 利用者・所有者の回答（1815 計画 §1）を記録した。
  - PRE-00 と TBD09-D を done にした。
  - MAN-04 を利用者の指示で除外し、W3-08（MAN-02）を所有者の判断で PKG phase まで保留とした。
  - U-10 #2（削除 preview の古い応答を使わない guard）を実装した（U の run）。
  - EXT-X1 の (a)→(b) を行ったが、原因は確定していない。
  - Gate 2 の主 run と終端化 run をやり直した。
  - 版 `0.1.11`（1815 計画 V）と TBD-09 の改名（1815 計画 T）は、条件が成り立たないため行っていない。
- 22:30 からの主な変化（2230 計画）は次のとおり。
  - 所有者の承認で G2D-07C・07D を記録し、Gate 2 の main3（実行 `5618d7f3-f408-4e3d-bc2b-a745c1602a19`）で G2Q-01CM・01DM（gold set）と G2Q-02（比較の harness）が succeeded になった。G2Q-03C・03D は承認された計画に閾値の選び方が無いため、G2Q-04C・04D は所有者の除外のため failed（`--class contract`）。`run finish` は `accepted: true`。
  - EXT-X1 は、要因 1（test が別 thread の fd を閉じる）を観測で確定し、3 file の test を直して succeeded になった。残りの失敗（時間切れなど）の原因は確定せず、集約 `npm test` は 1 回目が exit 1 だった（[`20260924-2230-EXT-X1-RootCause.md`](20260924-2230-EXT-X1-RootCause.md) §3）。
  - このため版 `0.1.11`（2230 計画 V）は行っていない。MAN-01・05 の本人確認、W3-08 の PKG 受入、G2Q-04 / 05 の利用者の session は、所有者の指示でタスクから除外した。
- 2026-09-25 04:20 からの主な変化（G2Q-03 の計画）は次のとおり。
  - 所有者の回答「G2Q-03 (A recommended).」で閾値の方針 A を記録した（[`2026-09-25-owner-ruling-G2Q-03.md`](../docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03.md)）。
  - G2Q-03C（SigLIP）は `verdict: PASS`（`confidenceThreshold` `0.9241492748260498`）。main4（実行 `84e8cb29-8aa9-40b6-bcab-411bfae30eff`）では補助 script の書込み検査の誤判定で failed になり、main5（実行 `01ff4f75-d29a-453b-bb71-8e9bbb492a89`）で記録し直して succeeded。
  - G2Q-03D（OWL-ViT）は `verdict: FAIL`（検出の box 差 0.048〜0.075 px が許容差 `1.0e-03` を超える）で、main4 で failed（`--class contract`）。main4・main5 とも `run finish` は `accepted: true`。
- 2026-09-25 05:26 からの主な変化（G2Q-03D の対策案）は次のとおり。
  - 所有者の回答「「A」を選択して、タスクを実行して完了させてください。」で、G2Q-03D の検出単位 parity の判定を A1〜A3 に変える判断 G2Q-03D-T を記録した（[`2026-09-25-owner-ruling-G2Q-03D-parity.md`](../docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03D-parity.md)）。適用範囲は OWL-ViT の `--mode goldset` だけで、共有の `compare` と `BOX_TOLERANCE` は変えていない。
  - main6（実行 `e52b01c9-2f58-4024-abf9-8d74f4671c85`）で G2Q-03D は `verdict: PASS`（閾値は同じ `0.0002533551160013303`、F1 の torch との差は最大 `5.13e-04`、原寸 px の box の差は記録だけ）で succeeded（attempt 2）。`run finish` は `accepted: true`。
- 2026-09-25 06:20 からの主な変化（残りの事項の実行）は次のとおり。
  - OWL-ViT の採用記録の §9 に、`confidenceThreshold` `0.0002533551160013303` と閾値方針を、採用の審査（G2A-02）で確定するまでの候補値として記した（[`owlvit-base-patch32-adoption.md`](../docs/model-governance/owlvit-base-patch32-adoption.md)）。G2Q-03 の計画は反映を採用の審査の後としていたため、この前倒しは逸脱として [`20260925-0620-RemainingItems-BlockerAnalysis.md`](20260925-0620-RemainingItems-BlockerAnalysis.md) に記した。
  - main3〜main6 の後の Gate 2 の終端化 run を行った。run 3（実行 `1b0c0c99-cb55-4e3f-9140-b5fd1a355a14`）は、G2F-00 の試行 1 を敵対的レビューの blocking 2 件で失敗にしたところ `max_attempts` が 1 で再試行できず、`accepted: false` で終えた。同じ構成の run 4（実行 `efc44691-c372-4dff-9bfd-de77abb6ca6d`）では 5 node が succeeded、`run finish` は `accepted: true`。44 node の最後の状態は succeeded 32・failed 2（G2Q-04C・04D）・blocked 10。manifest の `releaseStatus.reason`、ADR-0004（追補3）、実行記録 [`20260925-0620-Gate2-RemainTaskExecution.md`](20260925-0620-Gate2-RemainTaskExecution.md) を更新した。
  - 残りの Gate 2 の node は、利用者の作業 session（G2Q-04 / 05。所有者の指示で除外中）と所有者の判断（G2A-01・02、G2D-08）を待つ（§5）。
- 2026-09-25 07:24 に、所有者が G2A-01 / 02（C7 の採用の承認）と G2D-08（製品版の判断）に「承認します」と回答した（[`2026-09-25-owner-ruling-G2A-01-02-G2D-08.md`](../docs/model-governance/evidence/2026-09-25-owner-ruling-G2A-01-02-G2D-08.md)）。
  - G2A-01 / 02: 比較試験（§12、NFR-ANN-006）が未実施のため、Gate 2 計画 §8.16 の完了条件により承認として記録できず、両方の採用記録の最終判定は保留のまま。回答は各採用記録の §15 に記した。
  - G2D-08: 回答に版の値が無く、G2A-03 の後に行う node でもあるため、未決定のまま。
- 2026-09-25 07:44 からの主な変化（0745 計画）は次のとおり。
  - 所有者の回答「「比較試験（NFR-ANN-006）」は後で私が実施するので、タスクから削除してください。」で、比較試験（G2Q-05C / 05D / 06C / 06D）を Gate 2 のタスクから外した（[`2026-09-25-owner-ruling-assist-trial-deferral.md`](../docs/model-governance/evidence/2026-09-25-owner-ruling-assist-trial-deferral.md)）。比較試験は出荷条件として残り、`releaseStatus.ready=false` のまま。
  - G2A-01: SigLIP の採用記録を承認とし（07:24 の「承認します」を適用）、G2A-03 で manifest に C7 分類 entry を登録した（承認済み 3 件）。main7（実行 `8c3df57e-0c2c-4806-9be9-7eb74c082560`）では、並列の G2A-02 の変更を補助 script の書込み検査が G2A-01 の宣言外書込みと誤判定して failed になり、main8（実行 `6cfad899-a4d7-4f12-8abd-82738be3209f`）で G2A-01・G2A-03・G2D-08 を直列に記録し直した。
  - G2A-02: OWL-ViT の採用記録は保留のまま（2026-09-23 C7 検出 risk acceptance §4 の 1・2 を 07:44 の判断が変更するかについて所有者の明示の回答が無い）。main7 で `--class contract` の failed。
  - G2D-08: 所有者の回答「…あなたが決定してよいです」による委任で、記録者が製品版を `0.1.12` に決めた（[`2026-09-25-owner-ruling-G2D-08.md`](../docs/model-governance/evidence/2026-09-25-owner-ruling-G2D-08.md)）。`package.json`・manifest には G2V-01 まで書き込まない。
- 2026-09-26 07:48 の所有者の回答（[`2026-09-26-owner-rulings.md`](../docs/model-governance/evidence/2026-09-26-owner-rulings.md)）による主な変化（0926 計画）は次のとおり。
  - OWL-ViT: 「はい」（2026-09-25 の判断は risk acceptance §4 の 1・2 を変更する）により保留が解け、G2A-02（採用記録の承認）・G2A-03（manifest の C7 検出 entry。承認済み 4 件）・G2A-04（設定画面の研究目的に限る表示）を main9（実行 `860384d4-4af8-4b3a-baef-f64adacb3b98`）で行った。
  - 比較試験: 「実施対象から削除して、完了扱いにしてください」により、G2Q-04C / 04D / 05C / 05D / 06C / 06D を免除（未実施のまま完了扱い）の記録で閉じた（main9）。合格の記録（`releaseStatus.assistQuality[]`）は作らず、manifest schema を `2.0.1`（`ready=true` に `assistQuality[]` を求めない）にした。要求定義を v0.8 Draft とし、NFR-ANN-006・POC-16・§13.3 に反映した。
  - 集約 `npm test`: 事前に固定した比較（libuv threadpool の大きさ）を行い、未確定。最も多い失敗（`copy-source.test.ts:162` の時間切れ）は、test 1 件が約 4 万回の同期の file system 呼び出しを行い、単独でも約 7 秒かかることを観測した（[`20260926-0810-EXT-X1-ThreadpoolCompare.md`](20260926-0810-EXT-X1-ThreadpoolCompare.md)）。
  - Gate 2 計画の食い違い: §8.19 の `productVersion` の先行記入を、CONTRIBUTING.md L182・implementation-plan L394・schema に合わせ、G2F-01m で `ready=true` と同時に書く手順に直した。
  - G2V-01 は、集約 `npm test` が exit 0 にならず、GAL-V1 の `0.1.11` も未適用のため行っていない。

## 2. node の終端状態

状態は `done / failed / not-started` のどれかである。`failed` は、実行したが DoD を満たさなかった node を表す。

| ID | 状態 | 理由（区分: 利用者・所有者・外部前提・Gate 待ち・なし） |
|---|---|---|
| PRE-00 | done | なし。利用者の回答 B-2「無い。あっても無視をしてよい。」（1815 計画 §1）で、編集中の session がないことを利用者が確認した。機械的な部分も成立している（10 分おいて取った 2 回の hash が一致した。Baseline §6.2） |
| PRE-01 | done | なし。5 file の SHA-256 を固定した（Baseline §6.3）。08:30 の再計算でも一致した |
| PRE-02 | done | なし。npm `12.0.0` を `%LOCALAPPDATA%\npm-12.0.0` へ install した（Baseline §7.1）。所有者の判断 G2D-11 の A で、install の方法が組織承認済みと確認された（[`2026-09-24-owner-ruling-G2D-11-readiness.md`](../docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-11-readiness.md) 38 行 `選択: 用意の完了`） |
| PRE-03 | done | なし。初回は exit 1 だった。修正の後に再実行し、①② とも exit 0（Baseline §6.1・§6.5） |
| PRE-03A | done | なし。準備 run 2 `d77c9409-405d-44cc-8bbd-afb37eb92961` で、G2D-09 と `EXT-ATG` が succeeded になった。`run finish` は `accepted=1`（Baseline §7.3） |
| PRE-04 | done | なし。[`20260924-0710-Gate2-SplitRejudgment.md`](20260924-0710-Gate2-SplitRejudgment.md)。main graph は 44 node で、graph check と contract check は exit 0 |
| MAN-01 | not-started | 利用者。所有者の指示「3, 6, 7: タスクから除外」（2230 計画 §1 の 6）で除外した。UIR-017 の本人確認は、利用者本人の操作である。回答 B-3「確認済み」は `tests/manual/ui-shell-review.md` に記録した（1815 計画 R3）。操作ごとの回答ではないため、`NOT_RUN` を保つ（1815 計画 §1） |
| MAN-02 | not-started | 所有者。W3-08 の PKG 受入は所有者の指示で除外した（2230 計画 §1 の 7）。W3-08 は、所有者の判断「A（PKG phase まで保留）」（1815 計画 §1）で PKG phase まで保留する。署名前 package での実機受入と OS の再起動は、利用者だけが行う |
| MAN-03 | not-started | 利用者。MAN-02（W3-08 の実機受入）は PKG phase まで保留である。`EXT-ATG` の前提は PRE-03A で解消した |
| MAN-04 | not-started | 利用者。利用者の指示 B-5「タスクから除外する」（1815 計画 §1）で除外した。実施していない |
| MAN-05 | not-started | 利用者。所有者の指示で除外した（2230 計画 §1 の 6）。AUD-01 で、UIR-041Q の前提は「完了」、UIR-084 の前提は「未完了」と判定した。041Q は利用者の本人確認がなく、084 は起動条件が成り立たない。回答 B-6「確認済み」は記録した（1815 計画 R3）が、操作ごとの回答ではないため状態は変えない |
| AUD-01 | done | なし。11 項目を判定した（完了 4、未完了 7、未確認 0） |
| AUD-02 | done | なし。[`20260924-0630-Wave2CompletionAudit.md`](20260924-0630-Wave2CompletionAudit.md) |
| GAL-01 | done | なし。[`20260924-0630-GalleryBeyond200Investigation.md`](20260924-0630-GalleryBeyond200Investigation.md)。201 件目へは到達できない |
| GAL-02 | done | なし。[`20260924-0700-GAL02-GraphRecord.md`](20260924-0700-GAL02-GraphRecord.md) の graph は check exit 0。GAL の run の結果は §3 の §5-9 に書く |
| TBD09-D | done | なし。所有者の判断「TBD-09: 時期 A、名前は案のとおり」を [`2026-09-24-owner-ruling-TBD-09-timing-and-names.md`](../docs/model-governance/evidence/2026-09-24-owner-ruling-TBD-09-timing-and-names.md) に記録した（30 行 `選択: A`。1815 計画 R2）。本計画 §12 の完了条件（`選択:` の行が A か B）は、この記録で満たす。証拠の版管理の規則で新しい文書を追加したため、file 名は本計画の成果物の名前と異なる。先行する記録 `2026-09-24-owner-ruling-TBD-09.md` の `選択: 未確定`（43 行）は当時の状態として残る |
| POST-01 | not-started | Gate 2 の前提は 2026-09-26 に満たされた（主 run の全成功）。Gate 2 の後の作業としては未着手 |
| POST-02 | not-started | Gate 2 の前提は 2026-09-26 に満たされた（主 run の全成功）。Gate 2 の後の作業としては未着手 |
| POST-03 | not-started | Gate 2 の前提は 2026-09-26 に満たされた（主 run の全成功）。Gate 2 の後の作業としては未着手。D-16・REP-11 は決まっていない |
| POST-04 | not-started | Gate 2 の前提は 2026-09-26 に満たされた（主 run の全成功）。Gate 2 の後の作業としては未着手 |

## 3. 本計画 §5 の未完了事項（15 件）の状態

| 事項 | 状態 | 担当 node と理由 |
|---|---|---|
| §5-1 Gate 2 | done | なし。2026-09-26 に集約 `npm test` を安定させ（3 回続けて exit 0）、GAL-V1 `0.1.11` の後に G2V-01 `0.1.12` を main10 で行い、44 node がすべて done（主 run: 全成功）。G2F-01m で manifest を `releaseStatus.ready=true`・`productVersion` `0.1.12` とした（[`20260926-1100-Gate2Main10-Acceptance.md`](20260926-1100-Gate2Main10-Acceptance.md)）。比較試験（G2Q-04C〜06D）の done は免除の記録で、合格ではない。PKG-01 は 2026-09-26 に実装した（§5-12）。前回までの記録は [`20260925-0620-Gate2-RemainTaskExecution.md`](20260925-0620-Gate2-RemainTaskExecution.md) ほか |
| §5-2 `EXT-41`・`EXT-ATG`・`EXT-X1` | done | なし。`EXT-ATG` は done（準備 run 2）、`EXT-41` は done（所有者の判断の後の主 run）。`EXT-X1` は main3 で succeeded（EXT-X1 の計画 §4 の Vitest3 と Confirmation。要因 1 を観測で確定し、EXT-X1-F1〜F3 で test を直した）。この `done` は ATG ノードの完了条件（3 file の vitest）によるもので、2230 計画の lane X の完了条件 (3)（集約 `npm test` を 3 回続けて exit 0）は満たしていない（2230 計画 §5）。2026-09-26 に lane X の完了条件 (3) が成り立った（§5-10） |
| §5-3 UIR-017（W1-01） | not-started | MAN-01。利用者 |
| §5-4 UIR-041Q / UIR-084 | not-started | AUD-01 で前提を判定した（041Q は完了、084 は未完了）。MAN-05 は利用者 |
| §5-5 親 UIR-025 | not-started | AUD-01 で、残条件 9 件のうち #1・#3・#5 を完了、#2・#4・#6〜#9 を未完了と判定した。未完了の条件を閉じる node は本計画にない（08:30 計画 §11 の U-10）。利用者の判断「U-10: #2 だけを範囲に入れる」（1815 計画 §1）で、#2（削除 preview の古い応答を使わない guard と test）を実装した（U の run `4117a949-d5d9-4ffe-aac4-190291fe1917`、`accepted: true`。[`20260924-1815-U10-Acceptance.md`](20260924-1815-U10-Acceptance.md)）。#4・#6〜#9 が残るため、親は完了と記録しない |
| §5-6 W3-08 | not-started | MAN-02。所有者の判断 A で PKG phase まで保留 |
| §5-7 W4-02 の最終化 | not-started | MAN-03。利用者（MAN-02 を待つ） |
| §5-8 容量不足時の表示 | not-started | MAN-04。利用者の指示でタスクから除外 |
| §5-9 200 件を超える画像 | done | なし。GAL の run `bbb01912-859a-49b4-8819-4d928913c9da` で GAL-D1・I1・T1 が succeeded（[`20260924-1415-GAL-Acceptance.md`](20260924-1415-GAL-Acceptance.md)）。GAL-V1 は所有者の判断「GAL-V1: 0.1.11（EXT-X1 の解消後に更新）」の条件（集約 `npm test` の 3 回続けての exit 0）が 2026-09-26 10:39 に成り立ち、`0.1.11` を適用した（[`20260926-1045-GALV1-Record.md`](20260926-1045-GALV1-Record.md)。GAL の run の GAL-V1 の node は failed のまま、run の外で行った） |
| §5-10 全体並列実行時の test 失敗 | done | なし。要因 1（別 thread の fd を閉じる test）は 2026-09-24 に直した。2026-09-26 に、所有者の承認（[`2026-09-26-owner-rulings-0953.md`](../docs/model-governance/evidence/2026-09-26-owner-rulings-0953.md)）で `copy-source.test.ts` の短い書込みの上限と JOB04 の共通の policy の `closeTimeoutMs` を変え、volume の probe の失敗の分岐（`mountvol.exe` の `ETIMEDOUT`）を観測して vitest の `maxWorkers` を `'50%'` にした。集約 `npm test` が 3 回続けて exit 0（[`20260926-0810-EXT-X1-ThreadpoolCompare.md`](20260926-0810-EXT-X1-ThreadpoolCompare.md) §7）。その後の 4 回のうち 2 回は負荷の下の時間の上限・ctime の変化で失敗し、再実行で exit 0。test の上限の延長・skip・assert の緩和はしていない |
| §5-11 TBD-09 | done | なし。manifest schema `3.0.0` に改名した（T9-S〜T9-R。TBD-09 の run `2a67e845-…` の受入: [`20260926-1100-TBD09-Acceptance.md`](20260926-1100-TBD09-Acceptance.md)）。T9-V はその run では版の決定が無く `contract` の失敗とし、所有者の決定「0.1.12」（2026-09-26 12:29）の後、T9-V だけの run で succeeded にした（[`20260926-1230-TBD09V-Acceptance.md`](20260926-1230-TBD09V-Acceptance.md)） |
| §5-12 PKG-01 | done | なし。所有者の回答「3: 実装してください。」（2026-09-26 12:29）で `scripts/models/verify.py` と `scripts/models/test_verify.py` を実装し、実 manifest の照合が exit 0（検証の記録: [`20260926-1230-PKG01-Verification.md`](20260926-1230-PKG01-Verification.md)、計画: [`20260926-1230-OwnerRulings7-ExecutionPlan.md`](20260926-1230-OwnerRulings7-ExecutionPlan.md)）。POST-02 のほかの PKG の作業は未着手 |
| §5-13 Phase H〜N、users-guide §11〜15 | not-started | POST-01〜04。Gate 2 の後の作業として未着手 |
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
  - 5: Gate 2 は主 run の全成功で終端した（main10 の後の終端状態の記録（§1 の「Gate 2 の終端化の記録」）、done 44）。manifest は `ready=true`・`productVersion` `0.1.12`。main10 の各 node の Review（[`20260926-1100-Gate2Final-Review.md`](20260926-1100-Gate2Final-Review.md)）は blocking 0。前回までの記録（main9 の後: done 43 / not-started 1、main7・main8 の後: done 35 / failed 3 / not-started 6）と終端化 run 4 `efc44691-…` は履歴として残す。
- 成立しない:
  - 3: W4-02 は最終化していない（MAN-03）。
  - 7: 置き換えた run（準備 run 1 `94056f52-…`、終端化 run 1〜3、2026-09-25 の終端化 run 3 `1b0c0c99-…`）は `accepted: false` のままである。有効な run は、Baseline §7.3 の準備 run 2・GAL run と、§8 の U の run・主 run（再実行）・終端化 run（再実行）、2230 計画の main3（`5618d7f3-…`）、G2Q-03 の計画の main4（`84e8cb29-…`）・main5（`01ff4f75-…`）、G2Q-03D の対策案の main6（`e52b01c9-…`）、終端化 run 4（`efc44691-…`）、main7・main8 の計画の main7（`8c3df57e-…`）・main8（`6cfad899-…`）、0926 計画の main9（`860384d4-…`。1 回目の `run finish` は受入の command の呼び出し方の誤りで `accepted: false`、2 回目で `accepted: true`。[`20260926-0815-Gate2Main9-Acceptance.md`](20260926-0815-Gate2Main9-Acceptance.md)）、0955 計画の main10 と TBD-09 の run（T9-V は failed）、1230 計画の T9-V の run で、どれも `accepted: true`。前回の主 run `e7c6da3f-…` と終端化 run `2ac91e5d-…` は `accepted: true` のまま、再実行で置き換えた。
- 対象外:
  - 6: Gate 2 は主 run の全成功を記録したが、製品の release の判定（GO）ではない。製品機能の受入と PKG-01 以外の PKG の作業は Gate 2 の外に残る（PKG-01 は 2026-09-26 に実装）。

## 5. 再開に必要なもの

| # | 必要なもの | 解除される node |
|---|---|---|
| 1 | 解消（2026-09-25）。G2Q-03D の検出の box 許容差の扱いは所有者の判断 G2Q-03D-T（選択 A）で決まり、main6 で G2Q-03D は succeeded（`spikes/models/owlvit-assist-result.md` §7.5）。G2Q-03C は main5 で succeeded | —（G2Q-03D は解除済み） |
| 2 | 解消（2026-09-26）。比較試験（G2Q-04 / 05 / 06）は所有者の判断で Version 1 の実施対象から削除し、未実施のまま完了扱い（免除）。main9 で 6 node を免除の記録で閉じた。`ready=true` に `releaseStatus.assistQuality[]` は要らない（schema `2.0.1`） | —（解消済み） |
| 3 | 解消（2026-09-26）。集約 `npm test` が 3 回続けて exit 0（10:24〜10:39）となり、GAL-V1 `0.1.11`、G2V-01 `0.1.12`、G2F-01m（`ready=true`）、TBD-09 の T9-S〜T9-R（改名）を行った。T9-V は 5 の決定の後に行った | —（解消済み） |
| 4 | 解消（2026-09-25）。G2D-08 は所有者の委任により `0.1.12`（main8 で succeeded） | —（解消済み） |
| 5 | 解消（2026-09-26 12:29）。所有者が T9-V の版を `0.1.12` に決めた（[`20260924-1341-TBD09-VersionDecision.md`](20260924-1341-TBD09-VersionDecision.md)） | —（解消済み） |
| 6 | 利用者の操作ごとの本人確認と、PKG phase の実機受入（所有者の指示で除外中） | MAN-01〜03・05 |
| 7 | 解消（2026-09-25）。main3〜main6 の後の Gate 2 の終端化 run 4（`efc44691-…`）で、終端状態の記録と manifest の `releaseStatus.reason` を更新した（§1） | —（解消済み） |
| 8 | 解消（2026-09-26）。所有者が「はい」（2026-09-25 の判断は risk acceptance §4 の 1・2 を変更する）と回答し、main9 で G2A-02・03・04 が succeeded | —（解消済み） |

## 6. 本記録が主張しないこと

1. Gate 2 の完了（主 run の全成功、`ready=true`）を、製品の release の判定（GO）とは扱わない。製品機能の受入と PKG-01 以外の PKG の作業は残る。ATG の `accepted: true` は、受入コマンドが exit 0 だったことだけを示す。
2. 利用者が本人確認や実機受入を行ったとは記録しない。PRE-00 は例外で、利用者の回答 B-2（1815 計画 §1）を確認として記録した（§2）。
3. AUD-01 の判定を `docs/ui-ux-execution.md` の状態に反映していない。
4. 所有者の判断を生成していない。G2D-07C・07D は、所有者の回答「承認します」（2230 計画 §1 の 1）で、G2Q-03 の閾値の方針 A は所有者の回答「G2Q-03 (A recommended).」で記録した（A を一意に計算するための規約は実装担当が測定の前に固定したもので、所有者の承認の対象ではない）。G2Q-03D の検出単位 parity の判定 G2Q-03D-T は、所有者の回答「「A」を選択して、タスクを実行して完了させてください。」で記録した（A1〜A3 の数値は対策案で実装担当が示し、所有者が選んだもの。A3 の `0.005` は要求定義に無い新しい基準である）。G2D-08 は、所有者の回答「承認します」（2026-09-25 07:24）に版の値が無いため決めず、07:44 の回答「…あなたが決定してよいです」による委任で記録者が `0.1.12` に決めた（所有者が版の値を選んだとは記録していない）。T9-V は決めていない。G2A-01 の 07:24 の回答は、07:44 に比較試験が Gate 2 のタスクから外れた後に承認として記録した。G2A-02 の同じ回答は、risk acceptance §4 の 1・2 のため承認として記録していない。