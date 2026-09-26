# Gate 2 main3: EXT-X1 の敵対的レビュー

- 対象: `work/20260924-2230-EXT-X1-RootCause.md`、`work/20260924-0730-EXT-X1-Confirmation.md`、`work/20260924-0730-EXT-X1-ExecutionRecord.md` の最後の節、`work/20260924-2230-UserRulings3-ExecutionPlan.md` §5。
- 判定の規則: `work/20260924-0730-EXT-X1-Plan.md` §3・§4。

## 1 回目（試行 1）

- blocking 1: 比較 3 は、事前に固定した種類の列挙（「だけ」）に無い `kill` の assert の失敗があり、判定の条件を満たさない。「要因 2 を確定」は根拠が無い。→ 受け入れた。比較 3 を未確定にし、訂正した比較 4 を事前に固定して実行した。
- blocking 2: 比較は 4 個の CPU に限った場合の効果を示すだけで、集約の失敗が外の負荷によること、修正ノードが要らないことまでは示さない。affinity は起動の後に設定していた。→ 受け入れた。比較 4 では起動の前の `pwsh` に affinity を設定し、結論を「原因は未確定」に改めた。
- non-blocking 1: 実行記録の要約が、要因 1 を「3 つの mock の二重 close」と誤って書いていた。→ 直した。
- 試行 1 は `node fail --class implementation` で終えた。

## 2 回目（試行 2）

- blocking 1: Confirmation の `npm.cmd run typecheck` は npm 12 の PATH が無いと `EBADDEVENGINES` で exit 1 になる（`package.json` の devEngines）。verify の `Confirmed` は `Npm12` の前に動く。→ 受け入れた。evidence の行に npm 12 の PATH の設定を含めた。新しい `pwsh`（npm 12 を PATH に入れていない状態）で 2 行とも exit 0 を確かめた。
- non-blocking 1: 比較 1 は外の負荷が変わる中の比較で、「否定」は言い過ぎ。→ ノードの後に RootCause・実行記録・UserRulings3 §5 で「全部が通る回は観測されなかった（未確定）」に改める（本ノードの書込みの範囲外のため）。
- non-blocking 2: 集約の失敗の説明に、import-service の `reason: 'unsafe'`（aggregate log 173〜215 行）が抜けている。Confirmation の「時間に依存する失敗」は広すぎる。→ Confirmation は直した。RootCause §3 はノードの後に直す。
- non-blocking 3: import-handlers の `fstat` の確認は、失敗が観測されたのではなく、同じ形の危険な確認を予防として直した。→ ノードの後に RootCause §3・実行記録を直す。
- 確認: 修正した 3 file の vitest は exit 0（192 tests）で、計画 §4 の Confirmation の半分を満たす（レビューの再実行による）。

blocking: 0
