主 run: 未作成
G2A-03: not-done

# Gate 2 終端化の記録（G2F-00）

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書。正本 [`202609232120-RemainTaskExecutionPlan.md`](202609232120-RemainTaskExecutionPlan.md)（SHA-256 `b6ee4952…`）§8.20 の G2F-00 の成果物 |
| 作成日時 | 2026-09-24 04:05 JST（04:25 に冒頭行の位置を修正） |
| variant | `未作成`（正本 §7.2「主 run を作らなかった場合」） |
| ATG の report | [`20260924-0345-Gate2-AtgReport.md`](20260924-0345-Gate2-AtgReport.md) |

## 1. 準備 run（主 run の node ではないため、下の表に含めない）

- 実行 ID `94056f52-7b8b-472e-ab50-fdc5bbe33c48`。G2D-09 は `failed`（ATG の生の状態 `failed`、1 回目、`node fail --class contract`）。理由: 所有者判断 G2D-09（500 行を超える file の扱い、`EXT-ATG` の方式 A / B）の書面回答の記録 `docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-09.md` がない。利用者は 2026-09-24 03:43 の問い合わせに回答できなかった。推奨（A）を判断として記録していない。
- `EXT-ATG` は `blocked`（ATG の生の状態）。G2D-09 の失敗による。
- `run finish`: 受入コマンド exit 1、`accepted: false`（[`20260924-0400-Gate2Prep-Acceptance.md`](20260924-0400-Gate2Prep-Acceptance.md)）。

## 2. 主 run の node（inventory §1 の 44 件）

根拠の列の「未登録」は ATG の生の状態がないこと（主 run を ATG に登録していない）を示す。

| ID | 状態 | 根拠 |
|---|---|---|
| G2D-01 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2D-01T | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2D-02 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2D-02R | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2D-04 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2D-05 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2D-06 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2D-07C | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2D-07D | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2D-08 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2D-10 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2D-11 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2D-12 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2D-12T | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| EXT-41 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| EXT-X1 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2T-10 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2T-11 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2T-40 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2T-50C | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2T-50D | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2T-60C | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2T-60D | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2X-01a | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2X-01b | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2X-01c | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2Q-01C | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2Q-01D | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2Q-01CM | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2Q-01DM | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2Q-02 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2Q-03C | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2Q-03D | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2Q-04C | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2Q-04D | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2Q-05C | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2Q-05D | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2Q-06C | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2Q-06D | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2A-01 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2A-02 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2A-03 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2A-04 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |
| G2V-01 | not-started | 未登録（主 run 未作成）。準備 run で G2D-09 が failed のため主 run の graph を作っていない |

## 3. 判定

Gate 2 は **BLOCKED**。準備 run が失敗したため、AC-1〜AC-6 のいずれも本 run では検証していない。そのほか、npm `12.0.0`（G2D-11）がなく、`DOCS` を完了条件に含む node は実行できない（[`20260924-0306-RemainTaskRun-Baseline.md`](20260924-0306-RemainTaskRun-Baseline.md) §6.4）。
