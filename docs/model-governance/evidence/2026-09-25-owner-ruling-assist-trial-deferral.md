# Owner ruling — 補助品質の比較試験を Gate 2 のタスクから外す（2026-09-25）

| 項目 | 値 |
|---|---|
| 文書種別 | 一次証拠（repository owner の書面回答の記録） |
| 判断者 | **dahatake**（repository owner / license decision authority。[`dependency-policy.md`](../../dependency-policy.md) §2.1） |
| 決定日 | **2026-09-25**（回答は 07 時台 JST） |
| 記録者 | 実装担当（session `2d919d5c-92d6-4d55-a312-5f7b48ef3ff9`） |
| 判断事項 | Gate 2 実行計画 [`202609232120-RemainTaskExecutionPlan.md`](../../../work/202609232120-RemainTaskExecutionPlan.md) の比較試験の node（G2Q-04C / 04D / 05C / 05D / 06C / 06D、§8.14・§8.15）と、§8.16 の完了条件の「比較試験」 |
| 基準 | [`requirement-definition.md`](../../requirement-definition.md) v0.7 の NFR-ANN-006・POC-16 |
| 適用の記録 | [`20260925-0745-Gate2Main7-Plan.md`](../../../work/20260925-0745-Gate2Main7-Plan.md) |

## 回答の原文

実装担当が前回の報告で、C7 の採用の承認には比較試験が必要と示した後の、権限者の回答（該当行をそのまま転記）:

> 「比較試験（NFR-ANN-006）」は後で私が実施するので、タスクから削除してください。

## 判断

1. 比較試験（manual-only と assisted の session と、その判定）を Gate 2 のタスクから外す。所有者が後で行う。
2. Gate 2 計画 §8.16 の完了条件（G2A-01 / 02）の技術 gate から「比較試験」を外す。SigLIP・OWL-ViT の採用記録の §12 は「延期（出荷条件）」と記録する。OWL-ViT の採用の承認と manifest 登録への適用は、下記「既存の書面決定との関係」のとおり保留する。採用記録の §16 のチェックリストでは、比較試験の項目 27〜29 だけを「延期（出荷条件）」と記録する。ほかの技術 gate（hash、安全形式、parity、G2D-01 の性能基準、`inferenceConfig`、G2T-50 / 60）と §16 のほかの項目は変えない。
3. 比較試験は出荷条件として残る。NFR-ANN-006 は比較試験を「出荷条件」とし、要求定義 L764 は NFR-ANN-006 と POC-16 の通過まで、モデル支援を含む MVP のリリース判定を `Go` にしないと定める。manifest schema は `releaseStatus.ready=true` に C7 分類・検出の `assistQuality[]` を求めるため、比較試験の合格を記録するまで `ready=false` のままとなる。

選択: 比較試験を Gate 2 のタスクから外す

## 本判断が意味しないこと

1. NFR-ANN-006・POC-16 を免除・緩和しない。比較試験の合格の前に `releaseStatus.ready=true` にしない。
2. 比較試験の harness（`spikes/models/assist_benchmark.py`）、gold set、判定基準（G2D-07C / 07D）を変えない。
3. SigLIP・OWL-ViT 以外の C7 の採用記録に、§12 を承認の前提としない扱いを広げない。
4. 比較試験の結果が不合格の場合に、C7 の承認を維持する判断を含まない。その場合は採用記録を再審査する。

## 既存の書面決定との関係（記録者による適用）

次は所有者の回答の文言ではなく、記録者が回答を既存の書面決定へ当てはめたものである。

| 書面決定 | 該当箇所 | 本判断の適用 |
|---|---|---|
| [2026-09-25 G2A-01 / 02 / G2D-08](2026-09-25-owner-ruling-G2A-01-02-G2D-08.md) | 「判断の適用」1: 比較試験が未実施のため保留とし、条件がそろった後の承認は改めて所有者の確認を得る | 同じ回答で所有者は G2A-01 / 02 を「承認します」と答えており、その回答は比較試験の結果を見る前のものである。本判断で比較試験を Gate 2 の条件から外したため、SigLIP は、ほかの条件（§5・§9・§14・§16）を確認できた時点で、その承認の回答を採用記録の承認として記録する。OWL-ViT は次の行による |
| [2026-09-23 C7 検出 risk acceptance](2026-09-23-owner-risk-acceptance-c7-detection.md) | §4 の 1「採用記録の承認と manifest 登録は、技術 gate の実測と §3.2 の確認を経た後に行う」、2「補助品質の比較試験（NFR-ANN-006 / POC-16）は採用記録の実測に従い、未達なら登録しない」 | 本判断が §4 の 1・2 に優先するかを 2026-09-25 に所有者へ尋ねたが、回答を得られなかった。回答の原文は §4 の 1・2 に触れていないため、記録者は優先するとは扱わない。OWL-ViT の採用記録は、所有者が §4 の 1・2 の扱いを明示するまで保留とし、manifest に登録しない |
| [2026-09-22 risk acceptance](2026-09-22-owner-risk-acceptance.md) | §3 の登録の条件（比較試験を含まない） | 変更なし。SigLIP は比較試験の前に `releaseStatus.ready=false` の manifest に登録し、比較試験が不合格の場合は entry を manifest から外して採用記録を再審査する |

## 版管理

本文書は証拠として参照されるため、内容を変更する場合は新しい日付の文書を追加し、本文書は変更しない。
