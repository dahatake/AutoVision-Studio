# G2Q-03D 対策案の敵対的レビューの記録

対象: `work/20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md`（rubber-duck、3 回）

| 回 | blocking | 指摘と反映 |
|---|---:|---|
| 1 | 3 | (1) A3 の F1 と 0.005 を FR-TRN-018 の規定のように書いていた → 新しい提案とし、FR-TRN-018（mAP）と G2D-07D（assisted と manual の F1）の値を類推で借りたと明記。式を `abs(F1_backend − F1_torch) ≤ 0.005` に固定し、backend ごとに box を計算し直すことを必須にした。(2) 共有の `compare` に `box_tolerance=None` を加える案は fail-open の経路になる → 共有の関数は変えず、goldset mode の中だけに閉じた比較にした。(3) ATG run の仕様が不足 → §5.2 に main6 の成果物・手順を追加。非 blocking の 3 件も反映（A1 に logits を含める、残る blocker の列挙、IoU 0.5 の境界をまたぐ合成入力の確認） |
| 2 | 1 | node の write set が main4 の形（出力 JSON、Review md、lock）と合っていない → main4 と同じ形にし、`contract.inputs` と実行順を明記。非 blocking の 2 件も反映（CPU 性能は G2D-01 により blocker ではない。採用記録 L140 を lane Z に追加。`check-parity-A.py` は集計値の検査であると明記） |
| 3 | 0 | 非 blocking 1 件（root の `acceptance_command` の曖昧さ）→ main5 の command を明記 |

blocking: 0