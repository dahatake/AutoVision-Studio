# ATG Skills 利用可否・呼び出し条件・効果分析レポート

- 作成日時: 2026-09-23 09:45 JST
- 対象リポジトリ: `dahatake/AutoVision-Studio`（`C:\GitHub\AutoVision-Studio`）
- 対象 Skill: `atg`（ATG Kit `0.2.2` / engine `0.1.4`、配布元 `dahatake/RoyalytyService2ndGen@8d5316593`）
- 調査範囲: ① Skill と CLI が利用できる状態か ② Skill が呼ばれる条件 ③ このリポジトリの過去チャット履歴 22 セッションから見た、ATG による「1 タスクあたりの総実行時間の短縮」と「Token 消費の最小化」の効果

---

## 0. 結論（要約）

| 観点 | 結論 |
|---|---|
| 利用可否 | **Skill は利用できる（VS Code の agent host が検出済み）。CLI は `python -m atg` なら動くが、同梱のランチャー 2 種はこの環境では動かない。** `atg.ps1` は Windows PowerShell 5.1 の ExecutionPolicy で拒否される。`atg.cmd` は `pwsh`（WindowsApps のエイリアス）を起動できない。どちらも Git 未追跡（`?? .github/`、`?? tools/`） |
| 呼び出し条件 | Skill 一覧の `description`（USE FOR / DO NOT USE FOR / WHEN）とプロンプトが**意味的に一致したとき、モデルの判断で呼ばれる**。強制する仕組みはない。過去 22 セッションでの呼び出しは **0 回**。21 セッションは導入前に始まっている。導入後に Skill 一覧へ載ったセッション `c1e260d9` でも、「タスクを再開してください」のような短い再開指示では**一度も呼ばれなかった** |
| 総実行時間 | **並列 Wave 型の計画を複数セッションで実行する場合に効果が大きい**。過去には次の事故があった: 重複実行 2 件（Wave 2A、Wave 2E）、同一作業ツリーでの相互干渉 3 件、セッション間の調整呼び出し 34 回。ATG の `node start` による重複起動拒否と write set の競合判定で、これらは構造的に防げる。一方、並列化による短縮の理論上限は Gate 2 残タスクのグラフで **2.25 倍**（全ノードの所要時間を同じと仮定した場合）。性能測定の直列化、利用者判断による blocked、敵対的レビューの直列待ちがあるので、実効はそれより小さい |
| Token 消費 | **使い方次第で増えも減りもする**。ノード毎の実行ループ（next → worktree → start → verify → check-writes → handoff → finish）をツール呼び出し 1 回ずつで回すと、実測 62k〜250k input tokens/request のため、27 ノードで **+10M input tokens 級の増加**になりうる。計画フェーズ（分割判定・グラフ検証）と、重複・競合防止用の `node next` / `node start` だけに絞り、1 ノード 1〜2 回のツール呼び出しにまとめれば、増分は小さく抑えられる。削減効果が大きいのは、①巨大な参照文書に対する `SPLIT_REQUIRED` の強制と ②ノード単位の handoff による**レビュー範囲の縮小**（レビュー subagent が全 subagent token の大半を占める）である |
| 総合判定 | **条件付きで有効**。「Wave/Phase 計画 → 並列実行 → 敵対的レビュー」というこのリポジトリの主要ワークフローには、計画・並列可否・重複防止の層として合う。ただし、そのまま入れると (a) Skill が呼ばれない (b) ランチャーが動かない (c) ノード毎の儀式で Token が増える、の 3 点で効果が出ない。§7 の推奨事項を先に実施するべき |

---

## 1. 調査方法とデータソース

| データ | 場所 | 用途 |
|---|---|---|
| Skill 定義 | `.github/skills/atg/`（SKILL.md + references 4 件） | 呼び出し条件・規約の確認 |
| ATG Kit | `tools/atg/`（vendor/atg、ランチャー、docs、examples） | CLI の動作確認、仕様・限界の確認 |
| Copilot agent host のセッション履歴 | `%USERPROFILE%\.copilot\session-state\<id>\events.jsonl` と `workspace.yaml` | `cwd` がこのリポジトリのセッション 22 件（現セッション除く、2026-09-21 12:47〜2026-09-23 09:44 JST）を集計 |
| VS Code Copilot Chat（旧形式）の履歴 | `%APPDATA%\Code\User\workspaceStorage\fb34cc78…\chatSessions\*.jsonl`（2026-09-02〜09-13、17 件、最大 215 MB） | 存在だけ確認した。ATG 導入の 10 日以上前のもので、イベント粒度も異なるため、定量分析からは外した |
| VS Code 設定 | `%APPDATA%\Code\User\settings.json` | `"chat.useAgentSkills": true` を確認 |

集計した指標は次のとおり（イベント種別から機械的に算出）:

- **人手プロンプト数**: `user.message` のうち `source` が `agent-*` でないもの（他セッションから `send_message` で届いた調整メッセージを含む）
- **busy 分**: メインエージェントの `assistant.turn_start`〜`turn_end` 区間をマージした実稼働時間。利用者の待ち時間は含まない
- **ツール呼び出し数**: メインエージェントの `tool.execution_start`（`agentId` 付き＝subagent のものは別集計）
- **subagent token**: `subagent.completed.totalTokens`
- **AIU**: `session.usage_checkpoint.totalNanoAiu` の最大値 ÷ 10^9（課金単位の相対比較用）。**Premium**: `totalPremiumRequests` の最大値
- **token 内訳**（input / cache read / output）: `session.shutdown.modelMetrics`。取れたのは 5 セッションだけ

---

## 2. ATG Skill の導入状態（利用できるか）

### 2.1 確認結果

| 項目 | 状態 | 根拠 |
|---|---|---|
| Skill 配置 | ✅ `.github/skills/atg/SKILL.md` + `references/*.md` 4 件 | ファイル実在。`tools/atg/skill/SKILL.md` と SHA-256 一致 |
| キット整合性 | ✅ 34 files / 欠落 0 / 改変 0 | `python tools\atg\install.py --kit-dir tools\atg --verify` → exit 0 |
| 導入日時 | 2026-09-23 08:06 JST（`KIT-VERSION.json.copied_at` = `2026-09-22T23:06:25Z`） | 別リポジトリ（`RoyalytyService2ndGen`）のセッション `c8ab5b67` から導入された |
| VS Code（Copilot SDK agent host）での検出 | ✅ 検出される | `c1e260d9` の resume 後 system message（2026-09-23 08:28 JST 以降）の `<available_skills>` に `<name>atg</name>`（`location: project`）がある。本セッションでも `skill.invoked name=atg` を確認。キット README は VS Code を「未検証」としているが、**この環境では実機で確認できた** |
| VS Code 設定 | ✅ `chat.useAgentSkills: true` | ユーザー設定 |
| Git 追跡 | ⚠️ **未追跡**（`?? .github/`、`?? tools/`） | `git status --short`。他のクローン、クラウドエージェント、他の PC では Skill が存在しない |
| リポジトリ内の常時指示 | ⚠️ なし | `.github/copilot-instructions.md` / `AGENTS.md` / `.github/instructions/` が存在しない。ATG の利用を促す常時ルールがない |
| CLI: `python -m atg`（`PYTHONPATH=tools\atg\vendor`） | ✅ 動作 | `--help`、`init`、`contract check`、`graph check`、`run begin`、`node next/start/fail` を実行して確認。応答は約 200 ms |
| CLI: `tools\atg\atg.ps1` | ❌ **直接実行できない** | Windows PowerShell 5.1 で「スクリプトの実行が無効」（ExecutionPolicy がすべて Undefined、つまり既定の Restricted） |
| CLI: `powershell -ExecutionPolicy Bypass -File tools\atg\atg.ps1 …` | ✅ 動作 | `graph check` exit 0 |
| CLI: `tools\atg\atg.cmd` | ❌ **動かない** | 中身は `pwsh -ExecutionPolicy Bypass -File atg.ps1`。`pwsh` は `…\WindowsApps\pwsh.exe`（ストアアプリの実行エイリアス）で、この sandbox では「The system cannot execute the specified program」になる |
| Python | ✅ 3.12.10（要件 3.11 以上） | `python --version` |
| worktree 隔離 | ⚠️ 作成は可能。ただし作業ツリー内に限る | sandbox は cwd の外への書込みを拒否する（`work/20260923-0720-Gate2-TaskExecution.md` §1.1 にも同じ記録がある）。worktree には `node_modules`（324 パッケージ）が無いので、TS/Vitest の検証には毎回 `npm ci` 相当が必要 |
| 作業ツリーの状態 | ⚠️ 未コミット 32 件（modified 18 / untracked 14） | `run begin` は HEAD を記録し、worktree は HEAD から作られる。未コミット変更は worktree へ引き継がれない |

### 2.2 結論

- Skill としては「使える状態」にある（VS Code agent host が一覧に載せ、呼べば本文が注入される）。
- CLI は、ドキュメントどおりの `tools\atg\atg.ps1 <cmd>` / `atg.cmd` がこの環境で失敗する。エージェントが SKILL.md の手順どおりに呼ぶと、最初の 1 回で失敗し、回避策を探すターンが発生する。**動く呼び方は `python -m atg`（`PYTHONPATH` 設定込み）か `powershell -ExecutionPolicy Bypass -File …` だけ**である。

---

## 3. ATG Skill が呼ばれる条件

### 3.1 仕組み

1. agent host はセッション開始時と resume 時に、ワークスペースルートの `.github/skills/*/SKILL.md` を走査する。frontmatter の `name` / `description` を system prompt の `<available_skills>` に列挙する（`location: project`）。
2. システム指示では「タスクの前に available_skills を確認し、**一致する Skill があれば最初の行動として呼ぶことが必須**」とされている。ただし一致するかどうかは**モデルが description とプロンプトを意味的に照合して判断する**。キーワードで確定的に発火する仕組みはない。
3. 呼ばれると `skill.invoked` が記録され、SKILL.md 本文（約 6,300 文字）が `<skill-context>` として注入される。references 4 件（計約 21,000 文字）は、必要になった時点でモデルが `view` で読む。
4. Skill 一覧は**セッション開始・resume 時点のスナップショット**である。導入前に開いたセッションは、resume するまで ATG を知らない。

### 3.2 description の発火条件（原文要約）

| 区分 | 内容 |
|---|---|
| USE FOR | 依存グラフへのタスク分解、`PROCEED` / `SPLIT_REQUIRED` の分割判定、見積、DoD 規約、起動可能ノードの選択、write set の競合判定、ブロック規則、有界リトライ判定、実行ループの指針、deny-by-default の実行封筒 |
| DO NOT USE FOR | LLM 呼び出し・エージェント実行、git merge・テスト実行、write set の推定、**リポジトリ固有のワークフロー・オーケストレーション** |
| WHEN | 作業の計画・分割、並列実行可否・ブロック・推測なしの進め方について ATG Kit の指針が必要なとき |

### 3.3 過去履歴での実績

| 事実 | 根拠 |
|---|---|
| 過去 22 セッションでの `skill` ツール呼び出しは 0 件 | `tool.execution_start.toolName == "skill"` が 0 件 |
| 21 セッションは導入（08:06 JST）より前に開始し、一覧に ATG が無かった | system message に `<name>atg</name>` が無い |
| `c1e260d9`（Gate 2 残タスク実行、07:18 JST 開始）は、resume 後の 08:28 / 08:49 / 09:08 JST の system message に ATG が載っていた。**それでも 1 度も呼ばれなかった** | 期間中の人手プロンプトは「タスクを再開してください。」だけ。最終検証の途中（09:45 JST）で `tools/atg` を「由来不明の未追跡ファイル」として調べただけで、09:54 JST に完了した |
| ATG が呼ばれたのは本セッションだけ | 本セッションのプロンプトが「ATG skills」を明示していた |

### 3.4 このリポジトリのプロンプト型ごとの発火見込み

| 過去の典型プロンプト | 件数（概数） | 発火見込み | 理由 |
|---|---|---|---|
| 「詳細な実装プランを作成… 各タスクの粒度… 直列実行、並列実行などを設計」（`2e34dfdc`） | 1 | **高** | USE FOR の「task decomposition / split decisions / DoD rules」にほぼ一致する |
| 「全てのタスクを実行… DoD を必ず参照… **並列で実行ができるものは、必ず並列実行**」（`20d9d219` / `3062c689` / `c1e260d9`） | 3 | **中〜高** | 「decide what may run in parallel」に一致する。ただし「実行」が主目的なので、DO NOT USE FOR の「agent executions / repository-specific workflow orchestration」と解釈されて見送られる余地がある |
| 「Wave 2C のタスクを実行してください。DoD を必ず確認…90 分超過時は…停止」 | 16 | **低〜中** | 単一 Wave の実行指示で、分割や並列の判断を求めていない。計画ファイル中の Wave 定義に従うだけなので、「リポジトリ固有ワークフロー」に見えやすい |
| 「タスクを再開してください」「作業を再開してください」 | 6 | **低** | 文面に計画・並列・分割の語が無い。`c1e260d9` で実際に呼ばれなかった |
| 敵対的レビュー依頼、調査依頼、状態確認 | 多数 | **無（正しい）** | ATG の対象外 |

**結論:** 現状の description のままだと、主要ワークフローのうち「Wave 実行」と「再開」（件数の大半）では ATG が**呼ばれない可能性が高い**。確実に使わせるには、プロンプトで明示するか、常時指示（§7 R2）が必要である。

---

### 3.5 付記: 本セッションで CLI の強制動作を実機確認した結果

| 操作 | 結果 |
|---|---|
| `node next`（Gate 2 残タスク相当のグラフ、初期状態） | `{"runnable": ["G2R-01","G2R-20","G2R-14","G2R-00"]}` |
| 同じノードへの 2 回目の `node start` | `{"started": false, "attempt": 1}` / exit 1（**重複起動拒否**） |
| 依存が未充足のノード（G2R-30）への `node start` | `{"error": "node is not runnable: G2R-30"}` / exit 1 |
| `node fail --class implementation` | `{"retry": true, "attempt": 1}` |

状態 DB は検証用の `ATG_STATE_DIR`（`test-results\_atg_analysis\state`）に作成し、調査後に削除した。

---

## 4. 過去チャット履歴の分析

### 4.1 セッション一覧（2026-09-21〜09-23、現セッション除く）

| 開始 (JST) | session | 主タスク | 人手 prompt | busy 分 | main tool | subagent（うちレビュー） | subagent token (M) | AIU | Premium |
|---|---|---|---:|---:|---:|---|---:|---:|---:|
| 09-21 12:47 | 2e34dfdc | 未完タスク棚卸し → 実装プラン作成 | 3 | 19.9 | 77 | 2 (0) | 0.44 | 922 | 16 |
| 09-21 13:41 | e3e76832 | W0-02 | 1 | 19.2 | 48 | 1 (1) | 0.43 | 457 | 1 |
| 09-21 13:42 | 5bf70fdf | W0-03（**同一タスクを 2 回実行**） | 2 | 29.1 | 55 | 2 (2) | 0.74 | 413 | 30 |
| 09-21 13:43 | d1dc1f55 | W0-01 | 1 | 20.7 | 58 | 1 (1) | 0.55 | 470 | 15 |
| 09-21 14:20 | 6ecd2428 | W0-04 | 1 | 21.0 | 50 | 2 (2) | 0.65 | 195 | 1 |
| 09-21 14:21 | f286558d | Wave 1（中断 → 再開） | 2 | 37.1 | 50 | 3 (3) | 2.72 | 882 | 30 |
| 09-21 15:37 | 6377d24c | Wave 2A | 1 | 71.6 | 232 | 1 (1) | 1.30 | 1,063 | 1 |
| 09-21 15:37 | f37d7dd5 | Wave 2A（**同時に重複起動。BLOCKED で終了**） | 1 | 19.8 | 75 | 1 (1) | 0.83 | 313 | 1 |
| 09-21 18:13 | 74e84b03 | Wave 2B（+ 返信 truncate の再依頼） | 6 | 14.6 | 49 | 1 (1) | 0.86 | 531 | 37.5 |
| 09-21 19:15 | ecf5f1dd | Wave 2D（2C と同一ツリーで並行） | 3 | 76.2 | 126 | 1 (1) | 2.63 | 1,652 | 45 |
| 09-21 19:16 | de8d3a9a | Wave 2C（2D と同一ツリーで並行） | 1 | 46.0 | 107 | 3 (3) | 1.55 | 1,073 | 1 |
| 09-21 21:04 | 71644840 | Wave 2E（W2-15） | 1 | 25.8 | 54 | 1 (1) | 0.68 | 181 | 1 |
| 09-21 21:32 | cd4a379c | Wave 2E（**同じ W2-15 を再実行し、scope を拡張**） | 3 | 76.6 | 101 | 2 (2) | 0.48 | 520 | 16 |
| 09-21 23:00 | c1f9aec1 | Wave 2F | 3 | 63.5 | 126 | 1 (1) | 6.81 | 1,683 | 15 |
| 09-21 23:49 | b7b4fe4f | Wave 2G（2H と並行） | 4 | 62.6 | 102 | 0 | 0 | 1,103 | 45 |
| 09-21 23:50 | 829ae4c5 | Wave 2H（2F/2G と並行） | 1 | 70.6 | 137 | 3 (3) | 1.90 | 1,515 | 1 |
| 09-22 04:44 | 67976270 | Wave 3 → 不合格対策 → 残タスク | 8 | **330.3** | **594** | 0 | 0 | **14,909** | 90 |
| 09-22 11:04 | bf62c1e8 | Wave 4 | 1 | 35.7 | 99 | 0 | 0 | 720 | 15 |
| 09-22 11:42 | 20d9d219 | Gate 2 lane（1〜2 回目） | 5 | 209.0 | 305 | 4 (3) | 9.59 | 6,168 | 60 |
| 09-22 23:01 | 3062c689 | Gate 2 lane（3 回目、調査、計画） | 11 | 201.8 | 364 | 4 (4) | 13.36 | 10,293 | 120 |
| 09-23 06:27 | 971f5998 | Gate 2 計画レビュー | 6 | 5.1 | 29 | 0 | 0 | 61 | 3 |
| 09-23 07:18 | c1e260d9 | Gate 2 残タスク実行（実行中） | 5 | 121.5 | 325 | 4 (4) | 2.17 | 3,010 | 5 |
| **合計** | 22 | | **70** | **1,578** | **3,163** | **37 (34)** | **47.7** | **48,133** | **549.5** |

補足指標:

- ツール実行の壁時計時間（マージ後）: 1,093 分。busy の約 69% はツール待ちで、そのうち sync subagent（レビュー）待ちが 165 分
- 同時に稼働したセッションは最大 **4**。2 セッション以上が同時に稼働していた時間は約 **780 分**。利用者はすでに手動でセッション並列を運用している
- token 内訳が取れた 5 セッションでは **62k〜250k input tokens/request、cache read 91〜95%、output 約 0.8k〜1.2k/request**。入力コンテキストが支配的で、コンテキストが長いセッションほど 1 リクエストのコストが大きい（`f286558d` 62k → `c1e260d9` 250k）
- subagent 37 件の token: 中央値 0.68M、平均 1.29M、p90 3.73M。**上位 6 件（2.6M〜6.8M、いずれも広範囲の敵対的レビュー）で 24.9M、全体の 52%**。狭い範囲の再レビューは 0.08M〜0.12M

### 4.2 観測された非効率と ATG 機能の対応

| # | 観測事実（根拠） | 影響 | 対応する ATG 機能 | 防止可能性 |
|---|---|---|---|---|
| 1 | **Wave 2A の重複起動**: `6377d24c` と `f37d7dd5` が 15:37 に同時開始し、同じ `image-protocol.ts` を編集。`f37d7dd5` は「完了 ID なし / BLOCKED」で終了 | busy 19.8 分、313 AIU、subagent 0.83M token を浪費。競合する変更が発生 | `node start` の重複起動拒否（exit 1）。runnable でないノードの起動拒否 | **高**（全セッションが同じ実行 ID の状態 DB を使うことが条件） |
| 2 | **Wave 2E の再実行**: `71644840` が W2-15 を完了した 2 分後に、`cd4a379c` が同じ指示で再実行し、scope を拡張 | 76.6 分、520 AIU（一部は正当な scope 拡張） | 状態 DB で `succeeded` のノードは `node next` に出ない | 中（scope 拡張は新ノードとしてグラフに追加すべき） |
| 3 | **W0-03 の二重実行**（`5bf70fdf` 14:14、「既に追記済み」と再検証だけ行った） | 2.2 分 | 同上 | 高 |
| 4 | **同一作業ツリーでの相互干渉**: 「Wave2C を同 workspace で実行中… あなたの RectangleLayer.test.tsx の TS2322 が 3 件」「Wave 2H 実行中… AppShell.test.tsx の編集は避けるか連絡を」など 3 件 | 全体 `tsc` の結果が他 lane の変更で汚染される。ファイル所有権を手動で交渉 | write set の競合判定（R2）、1 ノード = 1 worktree、`node check-writes` | **高**（worktree 隔離が条件） |
| 5 | **セッション間の調整呼び出し**: `send_message` / `get_session_context` / `list_sessions` / `create_session` が計 34 回（`6377d24c` 8、`de8d3a9a` 9、`829ae4c5` 5、`3062c689` 12） | 1 回あたり 1 リクエスト（≒62k〜250k input tokens）。返信が 1000 文字で truncate され、再依頼が 3 回発生（`74e84b03` ×2、`971f5998`） | ファイル化された `handoff.json`（成果物 SHA-256、検証コマンド、exit code、`decisions[].source_refs`）で受け渡しする | 中〜高 |
| 6 | **中断と再開**: abort 6 回、resume 12 回、「再開してください」プロンプト 6 回（`c1e260d9` だけで 4 回） | 再開時に計画と記録を読み直して状態を再構築する | 耐久状態 + `node next` の再実行だけで再開できる（execution-loop §10） | 中 |
| 7 | **長大セッション**: Wave 3（`67976270`）は 1 セッションで busy 330 分、594 ツール呼び出し、14,909 AIU（全体の 31%）。途中で「不合格」→ 対策 → 再実行 | 長いコンテキストで 1 リクエストのコストが増える。90 分ルールを超過 | `SPLIT_REQUIRED` の機械判定。`max_attempts` による有界リトライ | 中〜高 |
| 8 | **巨大な参照文書**: 各 Wave タスクが `TaskExecutionPlan.md`（744 行）、`implementation-plan.md`（1,869 行）、`requirement-definition.md`（984 行）を参照 | 1 タスクのコンテキストが肥大化する | planning §1: **単一ファイルが 500 行超なら `context_size=large` → `SPLIT_REQUIRED`**。コンテキストパックで必要部分だけ渡す | 高（ただし文書を分割するか抜粋を渡す運用が必要） |
| 9 | **レビューの直列待ちと広範囲レビュー**: sync レビュー待ち 165 分。上位 6 レビューで 24.9M token | 時間・Token の最大要因 | ノード単位の handoff、直接依存だけのコンテキストパック、レビューをグラフのノードにして別ノードと並列化 | 中（ATG はレビューそのものを定義しない） |
| 10 | **性能測定の直列化**が必要（`work/20260923-0720-Gate2-TaskExecution.md` §2: CPU/GPU を奪い合うと p95 が汚染される） | 並列化の上限が下がる | write set に擬似資源（例 `lock:perf-host`）を宣言すれば R2 で直列化できる | 高（運用で対応） |
| 11 | **利用者判断待ち**（owner 裁定、権利 gate、実作業 session）で Gate 2 が複数回停止 | 実行しても進まない | 決定表: 候補が複数ならブロックして推測しない。資格・判断の不足もブロック | 中（停止を早めに確定できる。待ち時間自体は減らない） |

---

## 5. 効果評価

### 5.1 1 タスクの総実行時間

**(a) 並列化による短縮の上限（実測グラフ）**

`work/20260923-0630-Gate2-TaskExecutionPlan.md` の G2R タスク 27 件を、計画記載の依存と作成・編集ファイルからそのまま ATG グラフに変換し、`graph check` とスケジューラ（`atg.schedule.next_runnable`）で模擬した。**所要時間は全ノード 1 単位と仮定**している（計画に分単位の見積が無いため）。

```text
graph check: {"valid": true, "T1": 27.0, "Tinf": 12.0, "Lmax": 5.0, "speedup_bound": 2.25}
wave1: G2R-01, G2R-20, G2R-14, G2R-00
wave2: G2R-30, G2R-21, G2R-10, G2R-15
wave3: G2R-31, G2R-22, G2R-11, G2R-12, G2R-16, G2R-17
wave4: G2R-32, G2R-23, G2R-13
wave5: G2R-33, G2R-24
wave6: G2R-34
wave7: G2R-40
wave8: G2R-41, G2R-42
wave9..12: G2R-43 → G2R-50 → G2R-51 → G2R-52
```

- `resources/models/manifest.json` を編集する G2R-13 / 16 / 24 / 34 / 50、`detection-base.md` を編集する G2R-15 / 17、risk-acceptance 記録を編集する G2R-01 / 30 は、**別の wave に自動で直列化された**（R2）。計画の「manifest 編集は最後に単独」を、人が判断しなくても守れる。
- グラフ化したことで、**G2R-50 の依存に G2R-16（C6 検出の manifest entry）が無い**という計画の欠落が見えた（DoD は「4 役すべて Approved」を要求している）。形式化による副次効果である。
- 実際の `c1e260d9` は、1 メインエージェントでほぼ直列に進んだ（busy 121.5 分、ツール呼び出し 325 回、レビュー 4 回、再開 4 回）。上限 2.25 倍に対し、次の要因で実効は下がる。
  - 性能測定の直列化（G2R-12/14/22/32 は同じ host 上で並列にできない）
  - 利用者判断・実作業待ち（G2R-15 保留、G2R-40〜43 blocked）
  - ノードごとの worktree 準備（`node_modules` が無い → `npm ci` 相当）
- **見立て:** Gate 2 型（判断待ち・測定中心）では **1.2〜1.5 倍程度**が現実的な上限。Wave 2 型（UI 実装で、ファイルが分離し、検証が `vitest` / `tsc` の exit code）では、すでに手動で 4 並列を運用している。そのため ATG の時間面の効果は、**並列度を上げることより、重複・干渉・再開による損失を取り除くこと**に出る。

**(b) 損失の除去（過去実績ベース）**

| 損失 | 実績 | ATG 適用時 |
|---|---|---|
| 重複実行（#1〜#3） | busy 約 48 分（19.8 + 25.8 + 2.2。`cd4a379c` の正当な拡張分は除く） | 0 分（重複起動拒否） |
| 同一ツリー干渉の調整（#4, #5） | 調整呼び出し 34 回。他 lane の型エラーの切り分け | worktree 隔離 + write set で原則不要 |
| 再開時の状態再構築（#6） | 再開 12 回。1 回あたり数ターン〜数十ターン | `node next` 1 回で可否が確定する |

**(c) ATG 自身の時間コスト**: CLI 1 回あたり約 0.2 秒で無視できる。支配的なのは**ツール呼び出し 1 回ごとのモデルターン**（数秒〜十数秒）と、worktree ごとの依存導入である。

### 5.2 Token 消費

**(a) ATG 導入で増える分（見積）**

| 項目 | 量 | 備考 |
|---|---|---|
| SKILL.md の注入 | 約 6,300 文字（数千 token）× 以後の全リクエスト | cache が効くため AIU への影響は小さい |
| references の読込 | 約 21,000 文字（必要時だけ） | planning / execution-loop / plan-to-graph / contract-authoring |
| ランチャー失敗の回避ターン | 1〜3 リクエスト/セッション | §2 の問題が残っている限り発生する |
| ノード実行ループ（**素朴な実装**） | 約 5〜7 リクエスト/ノード × 62k〜250k input tokens | 27 ノードなら **+8M〜+47M input tokens**（大半は cache read）。`c1e260d9` の既知 47 リクエスト分 11.7M と比べて**同等〜数倍** |
| ノード実行ループ（**1〜2 回のツール呼び出しにまとめた場合**） | 1〜2 リクエスト/ノード | 27 ノードで +1.7M〜+13M |
| handoff.json の作成（SHA-256 計算、decisions 記述） | output が数百 token/ノード | output 単価は高いが、量は小さい |

**(b) ATG 導入で減る分（過去実績ベース）**

| 項目 | 実績 | 見立て |
|---|---|---|
| 重複実行 | 494 AIU（`f37d7dd5` 313 + `71644840` 181）、subagent 1.5M token | ほぼ全量を削減できる（全 AIU 48,133 の約 1%） |
| セッション間調整と truncate 再依頼 | 37 リクエスト ≒ 2〜9M input tokens | handoff ファイル化で大半を削減できる |
| 長大セッションの分割（#7, #8） | Wave 3 の 1 セッションが 14,909 AIU（31%） | `SPLIT_REQUIRED` で短いセッション/コンテキストに分けると、1 リクエストあたりの input が縮む（62k/req 級と 250k/req 級で約 4 倍の差を実測）。**最大の削減余地** |
| 広範囲レビュー（#9） | 上位 6 レビューで 24.9M token | ノード単位の handoff を入力にしたレビューへ置き換えれば、狭い範囲のレビュー（0.1〜0.7M）に近づけられる。**第 2 の削減余地**。ただし ATG はレビュー自体を定義しないので、運用ルール化が必要 |

**(c) 結論**: 素朴に ATG の全手順を 1 ステップずつ実行すると、Token は**増える**。次の 3 点に絞れば、Token は**減る方向**になる。

1. 計画フェーズの分割判定を機械的に適用する（500 行超の文書 → `SPLIT_REQUIRED`）
2. 実行ループを 1 ノード 1〜2 回のツール呼び出しにまとめる
3. レビューをノード単位にする

### 5.3 機能別の効果マトリクス

| ATG 機能 | 時間短縮 | Token 削減 | 品質・安全 | このリポジトリでの適合度 |
|---|---|---|---|---|
| 計画: `task_scope` / `context_size` → `SPLIT_REQUIRED` | 中 | **高** | 中 | **高**（利用者はすでに「小さなタスク・Context Window 最小化」を要求している） |
| 計画: DoD を exit code 判定にする | 中（判定の往復が減る） | 中 | **高** | 高（DoD の多くが自然言語なので、`verify_command` の追加が必要） |
| `graph check`（T1 / T∞ / 加速上界） | 低 | 低 | 中（依存の欠落を発見） | 高 |
| `node next` / `node start`（重複起動拒否、依存充足） | **高**（重複の除去） | 中 | 高 | **高**（手動の複数セッション並列で事故の実績あり） |
| write set 競合判定 + worktree + `check-writes` | 中〜高 | 中 | **高** | 中（`node_modules` と未コミット変更への対処が前提） |
| `handoff.json` + `node finish`（ハッシュ・出典の検証） | 中 | 中〜高 | **高**（捏造禁止の要求に合う） | 中（ノードごとの記述コストがある） |
| `node fail`（有界リトライ） | 中 | 中 | 中 | 中 |
| `run finish` / `report`（終端受入） | 低 | 低 | 高 | 中 |
| `parallel advise` / `merge plan` / `merge classify` | 低 | 低 | 低〜中 | 低（現状は git merge を使っていない） |

---

## 6. 適用上の制約・リスク

1. **ランチャーの不具合**（§2）: SKILL.md と execution-loop が案内する `tools\atg\atg.ps1` は、この環境では動かない。
2. **Git 未追跡**: `.github/skills/atg` と `tools/atg` が未コミットなので、他の環境では Skill も CLI も存在しない。
3. **未コミット変更が多い**: `run begin` は HEAD に束縛され、worktree は HEAD から作られる。Gate 2 lane のように未コミット変更を積み上げる運用とは相性が悪い。
4. **worktree の依存導入コスト**: Electron/TS の検証（`tsc -b`、`vitest`）には worktree ごとに `node_modules` が要る。`ml/.venv` も同様。sandbox のため、worktree は作業ツリー内（ignore 済みの場所）に置く必要がある。
5. **write set の照合は文字列の完全一致**（`schedule.is_conflict_free` は集合の素判定）: 一方が `docs/model-governance/evidence`（ディレクトリ）、他方がその配下のファイルだと競合を検出しない。`check-writes` は前方一致なので、両者で粒度がずれる。宣言の粒度を揃える必要がある。
6. **DoD が自然言語**: 既存計画の DoD の多くは exit code で判定できない。planning §6 に従うと、`verify_command` を確定するまでフェーズ 2 に進めない。
7. **状態ディレクトリの併走制約**（LIMITS §7）: 1 つの状態ディレクトリで複数の `run begin` を併走させてはならない。複数セッションで 1 実行を共有する（同じ `execution-id` で `node start` する）運用に統一する。
8. **ATG は実行主体ではない**: 並列起動、レビュー、merge、backoff は、エージェントか人が行う。ATG が「安全」を保証するのは §SKILL の「強制するもの」の範囲に限られる。
9. **利用者判断が多いタスク**（Gate 2）では、ATG の効果は「早く・正しく止まる」ことに限られる。待ち時間は減らない。

---

## 7. 推奨事項（優先順）

| # | 推奨 | 期待効果 | 工数 |
|---|---|---|---|
| R1 | **CLI の呼び方を固定する**: エージェントには `$env:PYTHONPATH="$PWD\tools\atg\vendor"; python -m atg …`（または `powershell -NoProfile -ExecutionPolicy Bypass -File tools\atg\atg.ps1 …`）を使わせる。配布元へは `atg.cmd` を `pwsh` 不在時に `powershell` へフォールバックさせる修正をフィードバックする | ランチャー失敗の回避ターン（1〜3 リクエスト/セッション）を削減 | 小 |
| R2 | **呼び出しを確実にする**: `.github/copilot-instructions.md`（または `.github/instructions/*.instructions.md`）に「`work/*TaskExecutionPlan*.md` の作成・実行、Wave/Phase の実行、並列実行の指示、再開の指示では、最初に `atg` Skill を呼ぶ」と明記する。プロンプトテンプレートにも「ATG で分割判定と runnable 判定をしてから実行」を入れる | 呼び出し 0 回の状態を解消する | 小 |
| R3 | **`.github/skills/atg` と `tools/atg` をコミットする**（`tools/atg/.gitignore` が `.atg/` と `__pycache__/` を除外済み） | 環境間の再現性 | 小 |
| R4 | **軽量運用から始める**: ①計画作成時に planning §3 の分割判定を記録する ②`graph check` を通す ③複数セッションで並列実行するときは**1 つの `run begin` を共有**し、各セッションは `node next` → `node start` だけ必ず通す（重複・依存違反の防止）。handoff / worktree / `check-writes` は、競合が起きやすい lane（Wave 2 型の UI 実装）から段階的に導入する | 重複・干渉を最小コストで防ぐ。Token の増加を抑える | 小〜中 |
| R5 | **1 ノード 1 スクリプト化**: `node start` → `verify_command` → `check-writes` → handoff 生成（SHA-256 計算）→ `node finish` を 1 回の PowerShell 呼び出しにまとめるラッパーを `tools/` 外（例 `scripts/atg/`）に用意する | ノードループの Token 増を 1/3〜1/5 に抑える | 中 |
| R6 | **DoD に `verify_command` を併記する**: 例 `npx vitest run <files>`、`node --test scripts/models/manifest-schema.test.mjs`、`node scripts/docs/verify-documentation.mjs` | 判定の往復とレビューでの争点を減らす | 中 |
| R7 | **巨大な参照文書への対応**: `TaskExecutionPlan.md`（744 行）など 500 行超の文書は、Wave / Phase 単位に分割するか、コンテキストパックとして抜粋だけを渡す | `context_size=large` の解消。1 リクエストあたりの input を縮小（最大の Token 削減余地） | 中 |
| R8 | **擬似資源による直列化**: 性能測定ノードの `write_set` に `lock:perf-host` を追加し、同じ host 上での並列測定を R2 で防ぐ | 手動判断を不要にする | 小 |
| R9 | **レビューをノード単位にする**: レビュー対象を「当該ノードの handoff + diff」に限定し、レビューもグラフのノードとして他ノードと並列化する（sync 待ち 165 分の削減） | 上位 6 レビュー（24.9M token）級の広範囲レビューを減らす | 中 |
| R10 | **導入後の計測**: 本レポートと同じ指標（busy 分、ツール呼び出し数、subagent token、AIU/Premium、重複・干渉・再開の件数）で、次の 1〜2 計画を比較する | 効果の実証 | 小 |

---

## 8. データの限界

- token 内訳（input / cache / output）が取れたのは 5 セッションだけ。それ以外は AIU と Premium で相対比較した。AIU は課金単位の相対値として扱い、金額換算はしていない。
- 「人手 prompt」には、他セッションから `send_message` で届いた調整メッセージ（`source` 無し）を含む。
- busy 分はメインエージェントのターン区間の和で、background subagent の並行時間を含まない。subagent の所要時間は別に 407 分（sync 165 分 / background 243 分）。
- 並列化の加速上界 2.25 倍は、全ノードの所要時間を等しいと仮定した構造上の値で、予測値ではない。
- `c1e260d9` は調査時点でも稼働中で、値は途中経過である。
- VS Code Copilot Chat の旧形式履歴（2026-09-02〜09-13）は ATG 導入の 10 日以上前で、指標の粒度も異なるため、定量分析に含めていない。
