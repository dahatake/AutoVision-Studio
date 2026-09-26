# ATG 終端レポート

総合結果: 不合格

## 実行情報
- 実行ID: 1b0c0c99-cb55-4e3f-9140-b5fd1a355a14
- 契約ハッシュ: 1510be926bded499737dbf6808ead334d8e2ed7169fd4384f343ad00318d7863
- HEAD commit: 5cf14447b2cdbacf49d1ab15b17bee5333d02562

## ノード別の最終ステータス
| Node | Status | Attempts | Artifacts |
|---|---|---:|---:|
| G2F-00 | failed | 1 | 0 |
| G2F-01a1 | blocked | 0 | 0 |
| G2F-01a3 | blocked | 0 | 0 |
| G2F-01r | blocked | 0 | 0 |
| G2F-03 | blocked | 0 | 0 |

## 機能受入条件
| 指標 | 値 | 判定/注記 |
|---|---|---|
| 実行中の人手介入回数 | 未計測 | ATG §13.1 は実行ログ中のプロンプト数を数えると規定する。ATG CLI は実行ログを保持しないため本レポートでは計測しない |
| 必須ノードの終端被覆 | 100.0% (5/5) | 全ノードが終端。ただし succeeded 0 / failed 1 / blocked 4 であり成功ではない |
| 終端受入 | accepted=0 | 不合格 |
| 契約外書込み | 未計測 | 本レポートの範囲外。`atg node check-writes` をノードごとに実行して確認する（未実行なら未検証のまま） |
| 出典なし決定 | 未計測 | 本レポートの範囲外。`atg node finish` が handoff の `decisions[].source_refs` を検査済みだが、本表では件数を集計しない |
