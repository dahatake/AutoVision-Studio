# Gate 2 終端化 run 3 回目（有効）の受入コマンドの記録

| 項目 | 値 |
|---|---|
| 実行 ID | `37fd890d-285b-490b-bac4-dd9915187a81` |
| 状態 DB | `work/20260924-0345-Gate2-atg-state/final3.sqlite3`（ATG が自動で git 管理外にする directory） |
| 実行日時 | 2026-09-24 04:29 JST |
| 契約 | `work/20260924-0345-Gate2Final-atg-contract.json` の `acceptance_command` |

evidence: acceptance_command exit=1

run 2 の G2F-00 の成果物は `主 run: 未作成` が冒頭行でなかった（敵対的レビューの指摘）。冒頭行を直し、G2F-00 の検査に冒頭行の確認を加えた graph で本 run を行い、run 2 を置き換えた。G2F-01a1 は npm `12.0.0` がないため `failed`（`--class contract`）、G2F-01a3・G2F-03 は `blocked` で、実行記録がないため受入は非ゼロ。

## run finish 前の ATG report

# ATG 終端レポート

総合結果: 未実施

## 実行情報
- 実行ID: 37fd890d-285b-490b-bac4-dd9915187a81
- 契約ハッシュ: 7d9d0ded46655750e4b78f58e8a5f67deee295f009e3bb1f0e5c6c5df75317f5
- HEAD commit: 7b8e211352684e9960103b25608ad0f55d5ac7b9

## ノード別の最終ステータス
| Node | Status | Attempts | Artifacts |
|---|---|---:|---:|
| G2F-00 | succeeded | 1 | 2 |
| G2F-01a1 | failed | 1 | 0 |
| G2F-01a3 | blocked | 0 | 0 |
| G2F-01r | succeeded | 1 | 1 |
| G2F-03 | blocked | 0 | 0 |

## 機能受入条件
| 指標 | 値 | 判定/注記 |
|---|---|---|
| 実行中の人手介入回数 | 未計測 | ATG §13.1 は実行ログ中のプロンプト数を数えると規定する。ATG CLI は実行ログを保持しないため本レポートでは計測しない |
| 必須ノードの終端被覆 | 100.0% (5/5) | 全ノードが終端。ただし succeeded 2 / failed 1 / blocked 2 であり成功ではない |
| 終端受入 | 未実施 | executions.accepted が NULL |
| 契約外書込み | 未計測 | 本レポートの範囲外。`atg node check-writes` をノードごとに実行して確認する（未実行なら未検証のまま） |
| 出典なし決定 | 未計測 | 本レポートの範囲外。`atg node finish` が handoff の `decisions[].source_refs` を検査済みだが、本表では件数を集計しない |

