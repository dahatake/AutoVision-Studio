# ATG 終端レポート

総合結果: 成功

## 実行情報
- 実行ID: efc44691-c372-4dff-9bfd-de77abb6ca6d
- 契約ハッシュ: 8a2912fe15e8c4acccc1b83c9563e70f4dbc5207b9eb190262dc40927ed8c778
- HEAD commit: 5cf14447b2cdbacf49d1ab15b17bee5333d02562

## ノード別の最終ステータス
| Node | Status | Attempts | Artifacts |
|---|---|---:|---:|
| G2F-00 | succeeded | 1 | 3 |
| G2F-01a1 | succeeded | 1 | 2 |
| G2F-01a3 | succeeded | 1 | 2 |
| G2F-01r | succeeded | 1 | 2 |
| G2F-03 | succeeded | 1 | 2 |

## 機能受入条件
| 指標 | 値 | 判定/注記 |
|---|---|---|
| 実行中の人手介入回数 | 未計測 | ATG §13.1 は実行ログ中のプロンプト数を数えると規定する。ATG CLI は実行ログを保持しないため本レポートでは計測しない |
| 必須ノードの終端被覆 | 100.0% (5/5) | 全ノードが succeeded（succeeded 5 / failed 0 / blocked 0） |
| 終端受入 | accepted=1 | 合格 |
| 契約外書込み | 未計測 | 本レポートの範囲外。`atg node check-writes` をノードごとに実行して確認する（未実行なら未検証のまま） |
| 出典なし決定 | 未計測 | 本レポートの範囲外。`atg node finish` が handoff の `decisions[].source_refs` を検査済みだが、本表では件数を集計しない |
