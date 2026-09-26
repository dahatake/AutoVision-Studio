# Gate 2 の最終の敵対的レビュー（版の適用・終端化・TBD-09 の T9-V、2026-09-26）

対象: GAL-V1 `0.1.11` と G2V-01 `0.1.12`（`package.json`・`package-lock.json`、`work/20260926-1045-GALV1-*`・`work/20260926-1055-G2V01-*`）、G2F-00（`work/20260926-1100-Gate2-TerminalState.md`・`work/20260926-1100-merge-atg-report.py`）、G2F-01m（`resources/models/manifest.json`・`scripts/models/manifest-schema.test.mjs`）、G2F-01a1（ADR-0004 追補 6・§5.1.17）、G2F-01a2（`docs/implementation-plan.md` L1262）、G2F-01a3（`work/20260926-1100-Gate2-RemainTaskExecution.md`）、G2F-03（`CHANGELOG.md`）、現状の文書、TERM-01、TBD-09 の T9-V、main10 の verify script と graph の生成。レビュー担当: rubber-duck agent（読み取りのみ。結果は記録者が転記）。

## 1 回目

失敗した 1 回目の集約 `npm test` の後の再実行の成功は、各版の「`npm test` exit 0」を正直に満たすと判断された（1 回目の成功や版の後の連続の成功を求める条件は無い。GAL-V1: fail `work/20260926-1045-GALV1-checks.raw.log:106`・pass `work/20260926-1045-GALV1-npmtest-retry.raw.log:89`、G2V-01: fail `work/20260926-1055-G2V01-checks.raw.log:108`・pass `work/20260926-1055-G2V01-npmtest-retry.raw.log:89`）。7 回中 2 回の失敗、3 回続けての成功、比較試験を合格と書かないこと、PKG-01 の留保も確認された。

| No | severity | location | problem | 対応 |
|---:|---|---|---|---|
| 1 | blocking | main10 の verify（G2F-00）、merge script | 実行 ID を記録の無い環境変数から読み、無い場合は main10 を黙って除く | merge script は引数 2 つを必須にし、verify は main10 の状態 directory の context file から実行 ID を読んで UUID を検査する形にした |
| 2 | blocking | T9-V の版 | 実装担当の `0.1.12` の決定は、release 責任者の決定を求める TBD-09 の計画を満たさない | 候補（`0.1.12`・`0.1.13`）を並べた提案に改め、T9-V は所有者の決定まで止める（`--class contract` で失敗として記録）。TERM-01 §5-11 を failed、§5 の 5 を未解消に戻し、ADR・CHANGELOG・実行計画 §4 を合わせた |
| 3 | blocking | TERM-01 L12・L94、`docs/architecture.md` L69・L206、CHANGELOG の 2.0.1 の項目 | 現状と矛盾する古い記述 | 各所を現在の状態に直し、CHANGELOG の 2.0.1 の項目は当時の状態である旨を加えた |
| 4 | non-blocking | 実 manifest の test | `ready=true` を無条件に確かめていない | `ready === true` と 4 役・版の一致を無条件に確かめ、注記を schema `3.0.0` に合わせた |
| 5 | non-blocking | 実行計画 T-1 | 改名を S-3 の前に行った順序の逸脱が未記載 | 実行計画 §4 に理由とともに記した |

## 2 回目

| No | severity | location | problem | 対応 |
|---:|---|---|---|---|
| 1 | blocking | TERM-01 の POST-01〜04・§5-12・§5-13・§5 の 3・§6 の 1 | Gate 2 待ち・TBD-09 の全部を行った・Gate 2 の通過を主張しない、の各記述が新しい状態と矛盾 | Gate 2 の前提は満たされ Gate 2 の後の作業として未着手、3 は T9-S〜T9-R に限る、§6 の 1 は Gate 2 の完了を release の GO と扱わない、に直した |
| 2 | blocking | `docs/architecture.md` L7・L24、`docs/developer-guide.md` L7 | 要求基準 v0.5 の宣言と、v0.8 の現状の記述が混在 | 本文の設計は v0.5 に基づき、model manifest と Gate 2 の現状の記述だけを v0.8 に合わせて更新した（本文の全体を v0.8 に照らしていない）と明記した |

## 3 回目

指摘なし。

blocking: 0
