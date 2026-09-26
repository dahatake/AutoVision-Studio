# 「残っていること」の実行と阻害要因（2026-09-25 06:20）

依頼（2026-09-25 06:20）: 「「### 残っていること」が成功するまで、タスクを実行してください。」。対象は前回の報告の「残っていること」の 2 項目。

## 1. 項目ごとの結果

| # | 項目 | 結果 | 根拠 |
|---|---|---|---|
| 1 | 採用記録 §9 への閾値の反映 | **実行した**。`docs/model-governance/owlvit-base-patch32-adoption.md` §9 の `confidenceThreshold` / `thresholdPolicy` に gold set から選んだ値を「採用の審査（G2A-02）で確定するまでは候補値」として記録し、§15 の保留の理由（当時の (3)。その後、外した (1) を削って番号を振り直し、現在は (2)）と再審査の条件を合わせた | G2Q-03 の実行計画 `work/20260925-0420-G2Q03-ExecutionPlan.md` L52 は「採用記録（§9 の `confidenceThreshold` など）と manifest は変えない（採用の審査は G2A-01 / 02）」としていたが、今回の依頼で反映した。値の確定（採用）は行っていない。製品の prompt 形式と seed は決定が無いため `unknown` / 未設定のまま |
| 2 | Gate 2 の BLOCKED の解消と OWL-ViT の採用 | **実行できない（人の作業と所有者の判断が必要）** | §2 |

## 2. Gate 2 を進めるために必要なもの（依存の順）

依存は graph `work/20260924-2230-atg-graph-main3.json` の `deps` による。

| node | 内容 | 実行できない理由 | 出典 |
|---|---|---|---|
| G2Q-04C / 04D | manual-only の作業 session の記録（分類 60 item・検出 20 item） | 作業者が製品の editor で作業し、外部のストップウォッチで item ごとの `seconds` を測る。`seconds` と `outcome` は生成・推定・補完しない。所有者の指示（「3, 6, 7: タスクから除外」）で除外中 | `work/20260924-0730-EXT-41-Plan.md` L11〜L25 |
| G2Q-05C / 05D | assisted session の記録（C7 の提案あり）と sidecar | 同上。sidecar は作業と同時に残す | 同 L13〜L14 |
| G2Q-06C / 06D | harness による比較（POC-16） | G2Q-04・05 の session が入力 | graph の `deps` |
| G2A-01 / 02 | 採用記録の承認 | 最終判定「承認」・承認者氏名・役割・承認日・artifact SHA-256・revision の記入が verify の条件で、所有者が行う。OWL-ViT は C8 の `unknown` 項目の扱い、transformers の依存採用判断、risk acceptance §3.2 の署名も残る | `work/20260924-2230-Gate2Main3-verify.ps1` の `Approval`、採用記録 §15 |
| G2A-03 / 04, G2D-08 | manifest への登録、製品の版の判断 | G2A-01 / 02 の後。G2D-08 は所有者の判断 | graph の `deps` |
| G2V-01 | 最終検証 | graph の `deps` は G2D-08 と EXT-X1。EXT-X1 は succeeded、G2D-08 は未起動。これとは別に、版 `0.1.11` の更新には集約 `npm test` の 3 回続けての exit 0 が要り、未達（lane X の完了条件 (3)） | graph の `deps`、`work/20260924-2230-UserRulings3-ExecutionPlan.md` L24・L47、`work/20260924-0325-RemainTaskTerminalState.md` §5 の 3 |

## 3. 利用者の作業手順（G2Q-04 / 05 の除外を解除する場合）

1. 所有者として、G2Q-04 / 05 の除外を解除することを書面で指示する（この session で「G2Q-04/05 の除外を解除する」と回答する）。
2. 手順書 `work/20260924-0730-EXT-41-Plan.md` §2 に従い、分類（60 item）と検出（20 item）それぞれで manual-only session → assisted session の順に記録する。item の一覧は `spikes/models/assist-goldset-plan-classification.md` / `-detection.md`。
3. 保存先は `vendor/models/_spike/assist/` の `manual-<task>.jsonl`・`assisted-<task>.jsonl`、各 `.meta.txt`（`recorded_at:`・`recorder:`・`settings:`、assisted は `sidecar_sha256:`）、assisted の `<stem>.sidecar.jsonl`。
4. 受け渡しの前に、同手順書 L26〜L33 の 2 つの検査（gold set との照合、sidecar との照合）を実行し、どちらも exit 0 であることを確かめる。
5. 記録を渡した後、実装担当が G2Q-04〜06 を ATG で実行し、採用記録の承認（G2A-01 / 02）に必要な情報を所有者へ提示する。

## 4. Gate 2 の終端化 run（敵対的レビューの blocking 1 件への対応）

本 file の最初の版のレビューで、main3〜main6 の後の Gate 2 の終端化 run（G2F-00〜03）は人の作業なしで実行できるのに行っていないと指摘された。計画 `work/20260925-0620-Gate2Final3-Plan.md` で実行した。

- run 3（`1b0c0c99-cb55-4e3f-9140-b5fd1a355a14`）: G2F-00 の試行 1 を blocking 2 件で失敗にしたところ、`max_attempts` が 1 で再試行できず不合格（`work/20260925-0620-Gate2Final3-Acceptance.md`）。
- run 4（`efc44691-c372-4dff-9bfd-de77abb6ca6d`）: 5 node が succeeded、受入 exit 0、`accepted: true`（`work/20260925-0620-Gate2Final4-Acceptance.md`）。記録した Gate 2 の状態は BLOCKED（`work/20260925-0620-Gate2-TerminalState.md`）。
