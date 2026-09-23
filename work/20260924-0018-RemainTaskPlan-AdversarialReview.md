# 敵対的レビュー — `202609232400-RemainTaskExecutionPlan.md`（初版）

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書（レビュー記録） |
| 実施日時 | 2026-09-24 00:18〜 JST |
| 対象 | [`202609232400-RemainTaskExecutionPlan.md`](202609232400-RemainTaskExecutionPlan.md) 初版（400 行） |
| 本来の目的 | `/work/` の実行プランを分析し、未完了タスクを**すべて**実行する詳細プランを作ること。捏造は禁止 |
| 裏取り方法 | 各指摘は実 file の読取り、`git status` / `git diff --stat`、file の行数、`Test-Path`、ATG CLI の実行、ATG の source（`tools/atg/vendor/atg/cli.py`）で確認した。確認できなかった候補は採用していない |

## 1. レビュー中に確認した前提の変化

- レビュー中に [`202609232120-Gate2-NodeInventory.md`](202609232120-Gate2-NodeInventory.md) が新しく作られ、さらに 44 件から 46 件（`G2D-12`・`G2D-12T` の追加）へ更新された。
- [`202609232120-RemainTaskExecutionPlan.md`](202609232120-RemainTaskExecutionPlan.md) も更新が続いている（レビュー中に SHA-256 が `609CCE…` から `1EF7E9…` へ変わり、行数は 602 行から 614 行へ増えた）。
- 同じ workspace で、別の session `e7dfa34f`（「タスク実行と監視ルール」、状態 `inProgress`）が作業している。本 session は `79200681`。

## 2. 指摘一覧

| No. | 軸 | 重大度 | 指摘箇所 | 問題の説明 | 修正案 |
|-----|-----|--------|---------|-----------|--------|
| 1 | 目的適合性 | Critical | §6 BOOT-01 | 「NodeInventory が存在しない」と書いたが、現在は存在する（46 件、終端状態の検査と graph 一致の検査を含む）。このまま実行すると、別 session が管理する file を作り直して上書きする | BOOT-01 の作成作業を削除する。既存の inventory と計画を照合するだけにする（PRE-03） |
| 2 | 整合性 | Critical | 冒頭表、§12、§15 | 正本である Gate 2 計画と inventory は別 session が並行して編集中。初版はノード一覧・起動順・見積を書き写しており、すでに古い（`G2D-12`・`G2D-12T` がない）。古い内容で実行すると、判断ノードを飛ばす | 可変の内容は書き写さない。実行開始時に正本を凍結して hash を固定し、その版だけを参照する（PRE-00・PRE-01） |
| 3 | 目的適合性 | Major | §12.1〜12.5 | `G2D-12`（採用チェック項目の扱い）と `G2D-12T`（template の更新）がない。最新計画では C7 承認（G2A-01 / 02）の前提 | No.2 の修正で正本を参照する形にする |
| 4 | 内容の妥当性 | Major | §15 | Gate 2 の見積 3,460 分は古い。最新計画 §9 は 585 + 920 + 1,155 + 410 + 470 = 3,540 分 | 数値を書き写さず、PRE-01 で固定した版の §9 を使う |
| 5 | 目的適合性 | Major | §5.1 | UIR-041Q と UIR-084 は `docs/ui-ux-execution.md` の W1-02 で「未実施」と確定されており、利用者本人の確認も要する（同 file 438 行）。初版にない | 前提の再判定（AUD-01）と本人確認（MAN-05）を追加する |
| 6 | 目的適合性 | Major | §5.1 | 親 UIR-025 は W1-03 で「未完」。残条件の #1・#2・#5 は当時「未着手（file 不在）」だったが、現在は `delete-preview.ts`・`delete-project.ts`・`DeleteProjectDialog.tsx`・`tests/e2e` が存在する。状態を確かめ直すノードがない | AUD-01 で残条件 9 件の現状を再判定する。file の存在だけで完了にしない |
| 7 | 目的適合性 | Major | §3 の `NonCommercialModelSurvey` の行 | 「独立残タスクはなし」は誤り。同 file §7 の 6 番「manifest schema の field 名の改訂（TBD-09）— 次の schema 変更時」が未完了。schema は 2.0.0 へ変わった（CHANGELOG 47 行）が、`commercialUseConfirmed` / `commercialDerivativesPermitted` は schema に残っている（4 箇所） | TBD-09 の lane（所有者判断→別計画）を追加する |
| 8 | 目的適合性 | Major | §5.1 / §9 | W4-02 の「容量不足表示は未実測」（`docs/users-guide.md` 320・423 行）を測るノードがない | MAN-04（測定の記録）を追加する |
| 9 | 内容の妥当性 | Major | §8 DAG | `EXT-41`・`EXT-ATG`・`EXT-X1` を「Gate 2 main run」全体の前提として描いた。一方、その前提になる G2T-40・G2D-04・G2D-09・G2X-01 は main run の中にある。依存が循環する | EXT は main run の中の node として扱い（inventory と同じ）、個別の辺だけを描く |
| 10 | 整合性 | Major | §11 | `EXT41-01`〜`03`、`EXTATG-01`、`EXTX1-01` は G2T-40・G2D-04・G2D-09・G2X-01 と同じ作業に別の ID を付けている。inventory は `EXT-41` などを 1 node として持つ | 独自の ID をやめ、inventory の ID を使う。EXT の中の作業 ID は、それぞれの別計画で決める |
| 11 | 内容の妥当性 | Major | §13 G2F-00 | ATG の `node fail` は子孫の node をすべて `blocked` にする（`cli.py` の `cmd_node_fail` → `_descendants`）。ATG の状態は `pending` / `running` / `succeeded` / `failed` / `blocked` だが、inventory の検査は `done` / `failed` / `not-started` だけを許す。対応づけが定義されておらず、記録する人が推測で決めることになる | `succeeded→done`、`failed→failed`、`blocked`・`pending→not-started` の対応を固定し、根拠の列に ATG の生の状態を書く |
| 12 | 内容の妥当性 | Major | §13 終端受入 5 | `python -m atg run finish` の exit 0 を求めたが、main run と終端化 run のどちらかも、受入コマンドの中身も決めていない（planning §6: exit code で判定できない完了条件のまま実行へ進まない） | PRE-04 で run ごとの `acceptance_command` を確定する。確定できなければ実行を始めない |
| 13 | 品質・運用性 | Major | §11 ENV-01 | `pwsh` の確認がない。この環境の `pwsh.exe`（WindowsApps の alias）は「The file cannot be accessed by the system」で起動しない。CONTRIBUTING 95 行は `pwsh` がなければ 5.1 へ戻らず停止するよう求める | PRE-02 に `pwsh` の起動確認を加え、失敗なら停止する |
| 14 | 品質・運用性 | Major | §11 ENV-01 | Windows PowerShell 5.1 では実行 policy により `npm.ps1` が読めない。`npm.cmd --version` は `11.17.0` で、CONTRIBUTING 137 行の exact `12.0.0` と異なる | 確認コマンドに `npm.cmd` を使い、版の不一致で止まることを明記する |
| 15 | 品質・運用性 | Major | §6 BOOT-02 | ATG CLI の呼び方が書かれていない。`$env:PYTHONPATH="$PWD\tools\atg\vendor"; python -m atg` で動くことをこの環境で確認した | PRE-02 に呼び方を書く |
| 16 | 整合性 | Major | §9 MAN-03 | `docs/users-guide.md` は 1,079 行で、ATG planning 規約では `context_size=large`（`SPLIT_REQUIRED`）。初版は分割判定をしていない | `EXT-ATG` を前提にして `SPLIT_REQUIRED` と記録する |
| 17 | 整合性 | Major | §10 GAL | 上限 200 は `AnnotationWorkspacePage.tsx`（544 行、30 行 `PAGE_LIMIT = 200`）にもある。初版の候補一覧にこの file がなく、500 行超であることも扱っていない | 入口に加え、`EXT-ATG` を前提にする |
| 18 | 根拠性 | Minor | §10 GAL-01 | 調査の入口は確認済みの根拠で書ける: `AnnotationPage.tsx:83`（`offset: 0, limit: 200`）、`AnnotationWorkspacePage.tsx:30` | 入口として記載する。実装の方式はまだ決めない |
| 19 | 目的適合性 | Major | §7 | MAN / GAL / POST の lane に、node ごとの分割判定（planning §3 の 4 項目）がない | node ごとの分割判定の表を追加する |
| 20 | 整合性 | Major | §18.1 | 「最新 terminal report」は Gate 2 の G2F-00 のことだが、それは Gate 2 の 46 件しか扱わない。MAN / GAL / AUD / TBD-09 / POST の終端記録がない | 全 lane を対象にする終端記録 TERM-01 を追加する |
| 21 | 品質・運用性 | Major | §16 実行封筒 | MAN-02 は `electron-builder` での package 作成と OS 再起動を要する（`windows-file-picker.md` 33・61 行）。封筒に OS 再起動の扱いがない | OS 再起動は利用者だけが行い、実行主体は行わないと明記する |
| 22 | 整合性 | Major | §10 GAL-03、全体 | `src/` を変更する GAL の実装は、root version と CHANGELOG の更新を伴う（CONTRIBUTING「製品バージョンの更新順」、exact npm 12.0.0 の `npm version`）。G2V-01（G2D-08 で決めた版）とぶつかるが、初版は触れていない | root version を変える node は `lock:root-version` で直列にし、版の値は release 責任者が決めると明記する |
| 23 | 根拠性 | Major | §4「Wave 2 の production 実装: 完了」 | この分析で ID 単位の完了を確認できたのは W2-31 / W2-32 だけ。W1-03 の時点で Wave 2G の項目は「未着手」と記録されていた。完了と言い切る根拠が足りない | 表現を「Gate 3 PASS の記録があるため再実行しない。ID 単位の照合は未実施」に改め、照合ノード AUD-02 を追加する |
| 24 | 根拠性 | Major | §5.2 | 2026-09-22 の 5 件の失敗と、2026-09-23 の 3 file の失敗を同じものと書いたが、対応は確認していない | 別々の観測として残し、関係は EXT-X1 の診断で決めると書く |
| 25 | 整合性 | Minor | §3 の最終行 | 「§5 の先行是正」とあるが、先行是正は §6 | 参照を直す |
| 26 | 整合性 | Minor | §5.1 | `POST-D16`・`POST-REP11` という ID を置いたが、ノードとして定義していない | POST-03 の中の blocked 条件として書く |
| 27 | 整合性 | Minor | §12.1 | 開始時から起動できる node の一覧に、入力辺のない `G2D-06`・`G2D-12` がない | No.2 の修正（正本を参照）で解消する |
| 28 | 整合性 | Minor | §12.4 | G2Q-02 / G2Q-04 の前提である `G2D-02R` がない | No.2 の修正で解消する |
| 29 | 目的適合性 | Minor | §4 旧 G2R | 「残件は最新計画で新しい ID を付けた」とあるが、G2R-17 は新しい ID になっていない。G2R-17 の実行条件（SSDLite が性能・裁定とも不可）は、owner ruling D1 で SSDLite を承認したため成立しなかった | G2R-17 は条件不成立で閉じると明記する |
| 30 | 目的適合性 | Major | §14 POST-03 | Phase I.1（Project Model による補助、実装計画 599 行）が Phase の一覧にない | 追加する |
| 31 | 根拠性 | Minor | §14 | POST の記述が少ない。確認できる事実: Phase H〜N の見出しは実装計画の 527〜715 行、527〜883 行の表の行は 150 件（この数え方には Phase N の後の表が含まれる可能性があり、POST-01 で確定する） | 事実と留保を併せて書く |
| 32 | 品質・運用性 | Minor | §8 | `lock:user-session` はどの規則も求めておらず、使い道が決まっていない（YAGNI） | 削除する。利用者が操作する node は、利用者がいるときだけ起動する |
| 33 | 品質・運用性 | Minor | 冒頭表 / §1 | 「15 file」は初版の作成時点の数。現在は inventory と初版を含めて 17 file | 数えた時点を明記し、本計画と本レビューを数に含めない |
| 34 | 品質・運用性 | Minor | §11 | ENV-01 と EXT に見積がない（planning §5 は正の見積を求める） | ENV の確認は見積を付ける。EXT の中身は別計画で見積もると明記する |
| 35 | 品質・運用性 | Minor | §10 GAL-03 | 見積がなく、graph に変換できない | GAL-03 を graph に入れず、GAL-02 の出力 graph に置き換える |
| 36 | 根拠性 | Minor | §3 の ATG Analytics の行 | 推奨 R1〜R10 の状態を書いていない。R3（ATG の commit）は、追跡されている file が 40 件あり、実施済みとみられる。ほかは確認していない | 推奨事項はタスク計画ではないため対象外と明記し、確認した事実だけを書く |
| 37 | 目的適合性 | Minor | §2 | `docs/ui-ux-execution.md` 67 行は UIR 133 件のうち 114 件を未着手としている（当時）。これは `/work/` の計画ではないが、対象外かどうかが書かれていない | `/work/` の計画が扱う UIR（017・041Q・084・025）だけを対象にし、ほかは対象外と明記する |
| 38 | 内容の妥当性 | Minor | §13 | 「ATG report と不一致があれば修正する」の対象がはっきりしない（ATG の状態を書き換えると読める） | 直すのは記録の側だけで、ATG の durable state は変えないと明記する |
| 39 | 根拠性 | Minor | 冒頭表 | 正本を「working tree 版」とだけ書き、hash がない | No.2 と同じ（PRE-01 で固定） |
| 40 | 目的適合性 | Major | §9 MAN-01 | UIR-041Q / 084 も本人確認の対象（docs 438 行）なのに、MAN-01 は UIR-017 だけ | No.5 と同じ（MAN-05） |
| 41 | 内容の妥当性 | Critical | 最終版の作成中に検出: PRE-04 | 最終版の最初の案は、graph 化（PRE-04）を `EXT-ATG` 待ちにした。しかし `EXT-ATG` は main run の node であり、main run は PRE-04 の後に始まるため、互いを待って進まない（初版の正本も同じ構造を持つ: G2D-09 と `EXT-ATG` は main run の中、graph 化は 500 行を超える正本を読む） | G2D-09 → `EXT-ATG` を graph 化の前（PRE-03A）に行い、main graph には成果物の hash を handoff にして done として登録する |

## 3. サマリー

- Critical: 3 件（No.1、No.2、No.41）
- Major: 23 件
- Minor: 15 件
- 合格判定（初版）: **FAIL**（Critical > 0）
- 最終版での再判定: Critical 3 件をすべて修正 → Critical 0 → **PASS**

## 4. 修正の方針

- Critical はすべて直す。Major もすべて直す（直さない Major はない）。Minor は 15 件をすべて直す。
- 過剰な設計は加えない: 新しく作るのは、実在を確認した未完了事項のためのノード（AUD-01 / 02、MAN-04 / 05、TBD-09、TERM-01、PRE-00〜04）だけ。`lock:user-session` は削除する。
- 別 session が編集中の正本（Gate 2 計画・inventory）は、本 session では変更しない。そちらで必要な修正（No.11 の状態の対応づけ）は、PRE-03 の停止条件として扱う。
