# Gate2Main3 G2Q-01CM の敵対的レビュー

- 対象: `vendor/models/_spike/assist/goldset-classification.json`、`images-classification/`、`goldset-classification.json.check.txt`（Git の追跡外）。作成の script は session の作業 file `g2q01-make-goldset.py`（fixture の manifest だけを読み、model の出力を読まない）。
- 方法: 独立の rubber-duck agent（読み取りだけ）が、gold の値の出所、全 item の必須 key・SHA-256（複写した画像・gold set・fixture の manifest の 3 者の一致）・source・license（fixture の `manifest.json` の `licenses` と `LICENSE.txt`）、件数（60 item、class ごとに 20）、除外の有無、`check.txt` の行と検査コマンドの再実行（Gate 2 計画 §8.10 の検査と、承認された計画 §4 の被覆の検査。ともに exit 0）を確認した。

## 結果

- 指摘なし（round 1 で blocking 0）。gold の値は fixture の data だけから作られ、model の出力を使っていない。権利（MIT）は全 item に記録されている。

blocking: 0
