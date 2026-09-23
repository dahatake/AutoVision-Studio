# TERM-01 — 全 lane の終端記録

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書。[`202609232400-RemainTaskExecutionPlan.md`](202609232400-RemainTaskExecutionPlan.md)（以下「本計画」）§14 の TERM-01 の成果物 |
| 作成日時 | 2026-09-24 03:25 JST |
| 実行 session | `c1997536-bb53-4fae-8696-6838c192fa9a` |
| 入力 | [`20260924-0306-RemainTaskRun-Baseline.md`](20260924-0306-RemainTaskRun-Baseline.md)（PRE-00〜03）、[`20260924-0300-UirStatusRedetermination.md`](20260924-0300-UirStatusRedetermination.md)（AUD-01） |
| Gate 2 の終端化の記録 | **なし**。PRE-00・PRE-02・PRE-03 が DoD 未達のため、Gate 2 の準備 run・主 run・終端化 run（G2F-00 以降）を起動していない。Gate 2 lane の停止の記録は [`20260924-0306-RemainTaskRun-Baseline.md`](20260924-0306-RemainTaskRun-Baseline.md) §5 |

## 1. 結論

- 本計画 §18 の最終完了条件は**成立していない**。残タスクの大半は、利用者の操作、所有者の判断、または `EXT-ATG`・Gate 2 の完了を待っている。
- 本 session で完了した node は PRE-01 と AUD-01 の 2 件。PRE-00・PRE-02・PRE-03 は実行したが DoD 未達。ほかの node は起動していない。
- manifest、ADR-0004、`docs/ui-ux-execution.md`、product code、Gate 2 の正本・inventory は変更していない。
- 本記録の完了条件のうち、「Gate 2 の終端化の記録 file への参照」は、その file がないため満たせない（§4）。

## 2. node の終端状態

状態は `done / failed / not-started` のどれか。`failed` は実行したが DoD を満たさなかった node。

| ID | 状態 | 理由（区分: 利用者・所有者・外部前提・Gate 待ち・なし） |
|---|---|---|
| PRE-00 | failed | 利用者。session 一覧で `inProgress` は本 session だけ、10 分 16 秒間隔の SHA-256 は 3 file とも一致したが、DoD が求める利用者の確認がない（Baseline §1） |
| PRE-01 | done | なし。5 file の SHA-256 を固定し、再計算が一致（exit 0）。抜粋の原本 hash も一致（Baseline §2） |
| PRE-02 | failed | 外部前提（正本 G2D-11）。① `pwsh` exit 0、③ ATG exit 0、② npm が `11.17.0` で exact `12.0.0` でない（Baseline §3） |
| PRE-03 | failed | 外部前提（正本の修正）。① ID 集合は一致（主 run 44 件）、② 「根拠の列に ATG の生の状態」の規則が正本・inventory にない（検査 exit 1）。停止規則により修正を依頼して停止（Baseline §4・§4.1） |
| PRE-03A | not-started | 外部前提。PRE-00・PRE-03 が未達。所有者判断 G2D-09 の記録もない（`docs/model-governance/evidence/` の既存の所有者証拠を `owner-ruling` で検索したが、G2D-09 / `EXT-ATG` の方式 A・B を記録した file はない） |
| PRE-04 | not-started | 外部前提。PRE-03A と `EXT-ATG` が未完了。npm 12.0.0 もない |
| MAN-01 | not-started | 利用者。UIR-017 の本人確認は利用者本人の操作で、本 session に利用者の回答はない。`NOT_RUN` を保持 |
| MAN-02 | not-started | 利用者。署名前 package での W3-08 実機受入と OS 再起動は利用者だけが行う。`SKIPPED_BY_USER` / 「未実施（NOT RUN）」を保持 |
| MAN-03 | not-started | 外部前提。`EXT-ATG`（`docs/users-guide.md` は 500 行超）と MAN-02 が未完了 |
| MAN-04 | not-started | 利用者。容量不足の保存先は利用者が用意する（実行主体はディスクを操作しない）。未実測のまま |
| MAN-05 | not-started | 利用者。AUD-01 で UIR-041Q の前提は「完了」、UIR-084 の前提は「未完了」。084 は起動条件が不成立、041Q は利用者の本人確認がない |
| AUD-01 | done | なし。11 項目（UIR-025 の残条件 9 件、041Q・084 の前提）を判定: 完了 4 / 未完了 7 / 未確認 0。敵対的レビューで #7 を「未完了」へ訂正済み |
| AUD-02 | not-started | 外部前提。`EXT-ATG`（1330 計画は 744 行） |
| GAL-01 | not-started | 外部前提。`EXT-ATG`（`AnnotationWorkspacePage.tsx` は 544 行） |
| GAL-02 | not-started | 外部前提。GAL-01 が未完了 |
| TBD09-D | not-started | 所有者。TBD-09 の改訂の要否・時期の判断記録がない。推奨を判断として記録しない |
| POST-01 | not-started | Gate 待ち。Gate 2 GO でない（`EXT-ATG` も未完了） |
| POST-02 | not-started | Gate 待ち。Gate 2 GO でない |
| POST-03 | not-started | Gate 待ち。Gate 2 GO でない。D-16・REP-11 も未決 |
| POST-04 | not-started | Gate 待ち。Gate 2 GO でない |

## 3. 本計画 §5 の未完了事項（15 件）の状態

| 事項 | 状態 | 担当 node と理由 |
|---|---|---|
| §5-1 Gate 2 | not-started | Gate 2 lane は PRE-03 で停止。BLOCKED の終端化記録も未作成（§4） |
| §5-2 `EXT-41`・`EXT-ATG`・`EXT-X1` | not-started | 所有者（G2D-04・G2D-09）と Gate 2 の G2X 診断が前提 |
| §5-3 UIR-017（W1-01） | not-started | MAN-01。利用者 |
| §5-4 UIR-041Q / UIR-084 | not-started | AUD-01 で前提を判定済み（041Q 完了、084 未完了）。MAN-05 は利用者 |
| §5-5 親 UIR-025 | not-started | AUD-01 で残条件 9 件中 #1・#3・#5 が完了、#2・#4・#6〜#9 が未完了と判定。未完了の条件を閉じる node は本 session では起動していない |
| §5-6 W3-08 | not-started | MAN-02。利用者 |
| §5-7 W4-02 の最終化 | not-started | MAN-03。`EXT-ATG`・MAN-02 |
| §5-8 容量不足時の表示 | not-started | MAN-04。利用者 |
| §5-9 200 件を超える画像 | not-started | GAL-01〜02。`EXT-ATG` |
| §5-10 全体並列実行時の test 失敗 | not-started | Gate 2 の G2X-01a〜c / `EXT-X1`。Gate 2 lane の停止による |
| §5-11 TBD-09 | not-started | TBD09-D。所有者 |
| §5-12 PKG-01 | not-started | POST-02。Gate 待ち |
| §5-13 Phase H〜N、users-guide §11〜15 | not-started | POST-01〜04。Gate 待ち |
| §5-14 D-16 | not-started | POST-03 の blocked 条件。利用者の証明書提示 |
| §5-15 REP-11 | not-started | POST-03 の blocked 条件。所有者の判断 |

## 4. 完了条件の検査

検査 script: [`20260924-0325-TERM01-Check.ps1`](20260924-0325-TERM01-Check.ps1)。§2 の node ID（PRE-00〜03、PRE-03A、PRE-04、MAN-01〜05、AUD-01〜02、GAL-01〜02、TBD09-D、POST-01〜04 の 20 件）と §3 の 15 事項が、許可した状態と空でない理由で 1 回ずつ記録され、`running` がないこと、さらに Gate 2 の終端化の記録（`work/<日時>-Gate2-TerminalState.md`）への参照がちょうど 1 件あり、その file が存在することを確かめる。

```text
OK: 35 件（node ID・事項）
NG: Gate 2 の終端化の記録（*-Gate2-TerminalState.md）への参照が 0 件
```

evidence: `pwsh -NoLogo -NoProfile -File work\20260924-0325-TERM01-Check.ps1` exit=1

**未達の条件:** 本計画 §14 の完了条件は「Gate 2 の終端化の記録 file への参照」も求める。G2F-00 の記録 file は存在しないため、この条件は満たせない。したがって **TERM-01 は DoD 未達**である。

**G2F（終端化 run）を行わなかったことは、計画にない逸脱である。** 本計画 §17 の 8 は「Gate 2 が成立しなくても G2F-00 以降の終端化は必ず行う」とし、正本 §7.2 は「主 run を作らなかった場合」の固定経路を持つ。一方、本計画 §6 の PRE-03 は ② がない場合「修正を依頼して停止する」とする。両者の優先関係は計画に書かれておらず、本 session は所有者の承認なしに停止規則を優先した。その判断の根拠は次の 2 点である。

1. G2F-00 の完了条件（inventory §2 の検査）は、主 run 未作成の場合でも状態の記録に `主 run: 静止（失敗あり）` の行を要求する（inventory 62 行）。主 run を作っていないのにこの行を書くのは事実と異なる記録になり、書かなければ検査は exit 1 になる（Baseline §4.1 の 2 で確認）。このため G2F-00 は正直な記録では成功できず、G2F-01r 以降は起動条件を満たさない。
2. G2F-00 以降は PRE-01 で固定した正本の手順に従うが、その固定の前提である PRE-00 が DoD 未達である。

この逸脱は所有者の確認を要する事項として §5 の 2 に残す。

## 5. 再開に必要なもの

| # | 必要なもの | 解除される node |
|---|---|---|
| 1 | 利用者が「Gate 2 の正本 2 file と抜粋を編集している session はない」と確認する | PRE-00 |
| 2 | 正本 §8.20 または inventory §2 への ② の規則の追加と、inventory §2 の検査への「主 run 未作成」の値の追加（Baseline §4.1）。あわせて、本計画 §6 の PRE-03 停止規則と §17 の 8 の優先関係（§4 の逸脱）の確認。その後に PRE-00・PRE-01 をやり直す | PRE-03、G2F-00 |
| 3 | 組織承認済みの方法で用意した npm `12.0.0`（正本 G2D-11） | PRE-02、npm を使う全 node |
| 4 | 所有者判断 G2D-09（`EXT-ATG` の方式 A / B）と、その別計画の完了 | PRE-03A、PRE-04、MAN-03、AUD-02、GAL-01、POST-01 |
| 5 | 利用者の本人確認・実機受入・容量不足の環境 | MAN-01・02・04・05 |
| 6 | 所有者判断 TBD09-D | TBD-09 lane |

## 6. 本記録が主張しないこと

1. Gate 2 が BLOCKED で終端したとは記録しない（終端化 run を行っていない）。manifest の `reason` と ADR-0004 は変えていない。
2. 利用者が本人確認・実機受入を行ったとは記録しない。
3. AUD-01 の判定を `docs/ui-ux-execution.md` の状態に反映していない（反映は利用者の確認後の別 node）。
