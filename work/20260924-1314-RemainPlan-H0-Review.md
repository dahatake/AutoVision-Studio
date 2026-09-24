# H0 敵対的レビュー（補助 `work/20260924-0620-atg-node.py`）

- 対象: `work/20260924-0620-atg-node.py`（begin / end 形式への書き換え）
- 計画: `work/202609240830-RemainTaskExecutionPlan.md` §5（152 行: 失敗時も running を解消）、H0
- review agent: rubber-duck（2 回）

## 1 回目の指摘と反映

| # | 区分 | 指摘 | 反映 |
|---|---|---|---|
| 1 | blocking | 保存した handoff を `<handoff_out>` に移すと、ATG は handoff の親 dir を基準に path を解決する（`tools/atg/vendor/atg/cli.py` の `cmd_node_finish`、`tools/atg/vendor/atg/artifacts.py`）ため、そのまま再検証できない | outputs に repository root 基準の `src/…` と `work/…` を含むため方式は変えず、docstring に「handoff の path は repository root 基準。再び node finish に渡すときは repository root へ copy してから渡す」と明記 |
| 2 | non-blocking | contract check の return code を見ていない | 失敗時は node fail --class contract、exit 3 |
| 3 | non-blocking | fail() が node fail 自体の失敗を隠す | node fail が非 0 なら `node fail exit=<n>` で終了 |
| 4 | non-blocking | snapshot を node start の後に取る | node start の前に取る |

## 2 回目の指摘と反映

| # | 区分 | 指摘 | 反映 |
|---|---|---|---|
| 5 | non-blocking | node start 成功後の応答解析・pre 保存、end の pre 読込み・snapshot の例外で running が残る | その範囲だけ例外を捕捉し node fail --class implementation（exit 4） |
| 6 | non-blocking | node finish 成功後の move が失敗すると `<handoff_out>` が無い | node finish の前に `<handoff_out>` へ copy し、finish 後に root の file を消す |

inputs / outputs の欠落も handoff 作成前に検出し node fail --class contract（exit 3）とした。

## 反映後の再実測（hello-atg の一時 repository、update-parser max_attempts=2、update-formatter max_attempts=1）

| case | 結果 |
|---|---|
| a 成功 | end exit=0、succeeded、changed [parser.py] |
| b write set 外（既存の未 commit file の内容変更） | end exit=3、failed、violations [dirty.txt] |
| c 再試行 | 1 回目 end exit=4 → pending、再 begin exit=0 → end exit=0、succeeded attempt 2、handoff attempt=2 |
| d 上限到達 | end exit=4、failed |

H0 の完了条件（4 case）を満たす。

blocking: 0
