# 残タスク実行 — 前提（PRE-00〜03）の記録と hash の固定

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書。[`202609232400-RemainTaskExecutionPlan.md`](202609232400-RemainTaskExecutionPlan.md)（以下「本計画」）§6 の PRE-00〜03 の実行記録 |
| 実行日時 | 2026-09-24 02:56〜03:08 JST |
| 実行 session | `c1997536-bb53-4fae-8696-6838c192fa9a`（本 session） |
| HEAD | `e6b8ce7726a911fccf9f9962971aced9c1db2297` |
| shell | PowerShell 7.6.6（`pwsh.exe`） |

## 1. PRE-00 — Gate 2 正本の凍結

**利用者による確認の代わりの証拠（逸脱の明記）:** 本計画は「編集している session がないことを利用者が確認し」と定める。本 session では利用者へ確認していない（autopilot 実行。利用者の指示は「不明点はデフォルトのプランを採用」）。代わりに、2026-09-24 02:53 JST に session 一覧（`list_sessions`、workspace `c:\GitHub\AutoVision-Studio`）を取得し、`inProgress` の session が本 session だけであること、正本を編集していた session `e7dfa34f-00fc-47d7-be1c-0ece2c199916` が `idle`（最終更新 2026-09-23T16:12:17Z = 2026-09-24 01:12 JST）であることを確認した。

| 対象 | 1 回目（02:56:07 JST） | 2 回目（03:06:23 JST） | 一致 |
|---|---|---|---|
| `work/202609232120-RemainTaskExecutionPlan.md` | `7bd8ea1ad7efee01944af8483de1ec2d918daea28ccb4eb89b8e2e3edd58eb73` | 同左 | 一致 |
| `work/202609232120-Gate2-NodeInventory.md` | `e2695fdf71b37e193888fd98c9c7d1e80004df327bff50f9f41422d640ab6e1e` | 同左 | 一致 |
| `work/202609232120-Gate2-RequirementExtract.md` | `78f2c954ec3afef770c43b6bf250829f40af85ae52e19b76296ff6e803807e02` | 同左 | 一致 |

2 回の間隔は 10 分 16 秒。判定: **DoD 未達**（利用者の確認がない。機械的な部分 ― session 一覧と 10 分間隔の hash 一致 ― は成立）。利用者が「正本 2 file と抜粋を編集している session はない」と確認するまで、Gate 2 の node を起動しない。

## 2. PRE-01 — hash の固定（以降の Gate 2 node はこの版だけを使う）

| file | SHA-256 | 行数 |
|---|---|---:|
| `work/202609232120-RemainTaskExecutionPlan.md`（正本） | `7bd8ea1ad7efee01944af8483de1ec2d918daea28ccb4eb89b8e2e3edd58eb73` | 625 |
| `work/202609232120-Gate2-NodeInventory.md`（inventory） | `e2695fdf71b37e193888fd98c9c7d1e80004df327bff50f9f41422d640ab6e1e` | 105 |
| `work/202609232120-Gate2-RequirementExtract.md`（抜粋） | `78f2c954ec3afef770c43b6bf250829f40af85ae52e19b76296ff6e803807e02` | 206 |
| `docs/requirement-definition.md`（原本 1） | `6e0c0bda2396b5e716d2c7b8b252dc5fe4758dadf3bcdbd936ca5857c236dcf5` | — |
| `docs/implementation-plan.md`（原本 2） | `ba446dd8c08390dfb29c757de5f438ab90dcac51f4bc74bc6a775c6acf019b16` | — |

原本 1・2 の値は、抜粋 7・8 行の記載値と一致する。正本の行数は本計画作成時（00:30）の 614 行から 625 行に変わっている（本計画 §3 の注記のとおり編集中だった）。

再計算の検査（exit 0 で一致）:

```powershell
$want = @{
  'work/202609232120-RemainTaskExecutionPlan.md' = '7bd8ea1ad7efee01944af8483de1ec2d918daea28ccb4eb89b8e2e3edd58eb73'
  'work/202609232120-Gate2-NodeInventory.md' = 'e2695fdf71b37e193888fd98c9c7d1e80004df327bff50f9f41422d640ab6e1e'
  'work/202609232120-Gate2-RequirementExtract.md' = '78f2c954ec3afef770c43b6bf250829f40af85ae52e19b76296ff6e803807e02'
  'docs/requirement-definition.md' = '6e0c0bda2396b5e716d2c7b8b252dc5fe4758dadf3bcdbd936ca5857c236dcf5'
  'docs/implementation-plan.md' = 'ba446dd8c08390dfb29c757de5f438ab90dcac51f4bc74bc6a775c6acf019b16'
}
foreach ($k in $want.Keys) { if ((Get-FileHash $k -Algorithm SHA256).Hash.ToLower() -cne $want[$k]) { exit 1 } }
exit 0
```

## 3. PRE-02 — 実行環境

| # | 条件 | 結果 | 判定 |
|---|---|---|---|
| ① | `pwsh.exe -NoLogo -NoProfile -Command 'exit 0'` | exit 0（`C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.6.0_x64__8wekyb3d8bbwe\pwsh.exe`） | 成立 |
| ② | `pwsh` の中で `npm --version` が exact `12.0.0` | `11.17.0`（`C:\Program Files\nodejs\npm.ps1`。node `v24.19.0`） | **不成立** |
| ③ | `$env:PYTHONPATH="$PWD\tools\atg\vendor"; python -m atg --help` | exit 0 | 成立 |

② が不成立のため、PRE-02 は **DoD 未達**。本計画 §6 のとおり **npm を使う node を起動しない**。npm の取得・更新・`npx` による代用はしない（`CONTRIBUTING.md` §8、正本 §8.0 の `NPM12`）。npm 12.0.0 の用意は正本の所有者判断 G2D-11 に属する。

## 4. PRE-03 — inventory と正本の照合

検査 script: [`20260924-0306-PRE03-InventoryCheck.ps1`](20260924-0306-PRE03-InventoryCheck.ps1)（SHA-256 `08bd635d6b4c9bc5b902109058e741a9af84f508bc731172f0723eb7abf67b83`）。正本 §6.1 の略記を展開表で展開し（行見出しが展開表と完全一致しなければ失敗）、準備 run（G2D-09・EXT-ATG）と終端化 run（G2F-*）を除いた集合を inventory §1 の表と §2 の `$ids` の両方と照合する。§8 とは双方向に照合する（§8 にだけある ID がないこと、§6.1 の ID がすべて §8 に字句または略記 `（G2D-01、02、04〜12）`・`G2D-07C / 07D` で現れること）。② は、状態の対応（正本 §8.20: `succeeded`→`done`、`failed`→`failed`、それ以外→`not-started`）と「根拠の列に ATG の生の状態」の規則の両方が正本か inventory にあることを確かめる。

```text
§6.1 展開: 53 件、主 run: 44 件、inventory §1: 44 件、inventory §2 $ids: 44 件
① OK
NG: ② 根拠の列に ATG の生の状態を書く規則が正本・inventory にない
```

evidence: `pwsh -NoLogo -NoProfile -File work\20260924-0306-PRE03-InventoryCheck.ps1` exit=1

判定: **① 成立、② 不成立 → PRE-03 は DoD 未達**。「根拠の列に ATG の生の状態を書く」は本計画 §9.2 の 2 にしかない。本計画 §6 の停止規則に従い、正本を編集する session か利用者へ修正を依頼して停止する（本 session は正本・inventory を編集しない）。

### 4.1 正本・inventory への修正依頼（本 session では編集しない）

1. **② の規則の追加**: 正本 §8.20 または inventory §2 に「G2F-00 の状態の記録の根拠の列に ATG の生の状態（`succeeded` / `failed` / `blocked` / `pending` / `running`）を書く」旨を置く。
2. **inventory §2 の検査と §7.2「主 run を作らなかった場合」の不整合**: §7.2 は主 run 未作成の場合も G2F-00 と inventory §2 の検査で扱うとするが、§2 の検査は状態の記録に `主 run: 全成功` か `主 run: 静止（失敗あり）` の行を要求し、未作成用の値を持たない（inventory 62 行の `$want`）。主 run 未作成の記録に `主 run: 静止（失敗あり）` と書くと事実と異なる。2026-09-24 03:00 JST ごろに session folder の一時 file（44 ID をすべて `not-started`、report の 1 行目を `主 run: 未作成`）で確かめた結果、状態の記録の見出し行が `主 run: 未作成` では exit 1、`主 run: 静止（失敗あり）` では exit 0 だった。未作成用の値（例: `主 run: 未作成`）を正本 §8.20 と inventory §2 の両方に加える必要がある。

## 5. 次の node

PRE-00・PRE-02・PRE-03 が DoD 未達のため、**PRE-03A・PRE-04 と Gate 2 の準備 run・主 run・終端化 run（G2F-00 以降）は起動しない**。準備のため作った準備 run と終端化 run の graph・契約（`work/20260924-0305-Gate2Prep-atg-*.json`、`work/202609232120-atg-graph-final.json` 等）は、`graph check` / `contract check` が exit 0 であることを確かめたが、使わないため削除した。manifest・ADR-0004 は変更していない。

本計画 §17 の 8（Gate 2 が成立しなくても G2F-00 以降の終端化は必ず行う）と、§6 の停止規則（PRE-03 の ② がなければ停止する）は、この状態では両立しない。本 session は停止規則を優先し、終端化 run を行わない。この優先は計画に定めがなく、所有者の承認のない逸脱である（根拠と扱いは [`20260924-0325-RemainTaskTerminalState.md`](20260924-0325-RemainTaskTerminalState.md) §4）。再開の条件: (1) 利用者による PRE-00 の確認、(2) §4.1 の修正と PRE-00・PRE-01 のやり直し、(3) npm `12.0.0`（G2D-11）、(4) 所有者判断 G2D-09。
