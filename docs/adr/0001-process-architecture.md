# ADR 0001 — プロセスアーキテクチャ

| 項目 | 内容 |
|---|---|
| ステータス | 承認済み（デフォルト採用） |
| 作成日 | 2026-09-02 |
| 対象タスク | A-02 |
| 要求基準 | `docs/requirement-definition.md` v0.4 Draft §4、§8（FR-SEC-004〜006、FR-INF-003/009、FR-TRN-010/013/014、FR-DAT-013）、§11（NFR-REL-003/004）、§13（参考） |
| 実装計画基準 | `docs/implementation-plan.md` §1.3〜1.4、§3、§6 |

> **注意:** 本 ADR はアーキテクチャ方針を記録した文書であり、実装完了や Gate 合格を宣言するものではない。現在の検証範囲は §2.8 に記録する。

---

## 1. コンテキスト

AutoVision Studio はデスクトップアプリケーションとして、次の制約を同時に満たす必要がある。

- 完全オフライン動作（外部 API・Cloud resource なし）
- 商用ライセンス要件（全部品の監査）
- Version 1 は Windows 11 24H2 以降 x64 の自己完結型インストーラーだけを対象とする
- バックグラウンド学習とリアルタイムカメラ推論の並立
- UI の応答性を学習・推論の負荷から切り離す

macOS arm64 の MPS 学習、CoreML 推論、カメラ権限、署名・notarization・PKG に関する既存調査は、技術的な将来候補を示す履歴として保持する。ただし、Version 1 の実装、Gate 1〜5、受入、完了率には含めず、Windows の証拠を macOS の合格証拠へ転用しない。

これらを満たすために、プロセス境界とデータフローのデフォルトを記録する。

---

## 2. 決定: デフォルトプロセス構成

### 2.1 プロセス境界

```
React Renderer ──(control / camera frame を限定 API へ渡す)──▶ Electron Preload
                           │
                         (validated IPC)
                           ▼
                        Electron Main
                                                                            │
                                                               ┌────────────┼──────────────┐
                                                               ▼            ▼              ▼
                                                            SQLite     Project Files    OS API
                                                               │
                                               ┌───────────────┴───────────────────┐
                                               ▼                                   ▼
                                   Python Job Worker                    Python Inference Worker
                                (spawn / JSON + NDJSON)            (spawn / binary RGB frame + NDJSON)
                                        │                                          │
                                  PyTorch / Optuna                          ONNX Runtime
                                  ONNX Export                          DirectML / CPU EP
```

HTTP サーバー、localhost API、message broker、汎用 RPC framework は一切作らない。

### 2.2 各プロセスの責務

| プロセス | 責務 | 禁止事項 |
|---|---|---|
| **React Renderer** | 画面表示、一時 draft state、ユーザー操作 | filesystem・Node API・Python プロセスへの直接アクセス |
| **Electron Preload** | Renderer に公開する型付き narrow API | raw `ipcRenderer`・`require`・child_process の公開 |
| **Electron Main** | ウィンドウ管理、OS 権限、SQLite 所有、job spawn・lifecycle、atomic commit | ML 計算、UI rendering |
| **Python Job Worker** | 学習・ONNX export・アシスト補助の 1 ジョブ実行 | SQLite への直接書き込み、ネットワーク download |
| **Python Inference Worker** | ONNX Runtime セッション保持、カメラフレームの前処理・推論・後処理 | カメラ権限取得、UI 操作 |

### 2.3 信頼境界

- **Renderer は信頼されない。** Preload が公開する API 以外のパスは存在しない。
- **Preload は narrow gateway。** 画面ごとに必要な IPC チャネルだけを公開し、汎用ハンドラは作らない。
- **Main が唯一の信頼境界守衛。** IPC 受信時は sender origin と payload の両方を検証してから処理する。
- **Python worker は隔離された実行単位。** worker は DB を直接変更しない。成果物を job ディレクトリに出力し、Main が hash 検証後に rename・DB commit する。

### 2.4 IPC 検証

- IPC ハンドラは受信した `event.senderFrame.url` が、開発時・配布時それぞれに設定したローカルアプリ origin の allowlist と完全一致することを確認する \[P01\]。固定の `app://` scheme は、実装で採用するまで前提にしない。
- payload は Zod スキーマで runtime parse し、失敗した場合は即座に拒否する。
- `schemaVersion` フィールドを全 worker 入出力 envelope に含め、バージョン不一致を検出する。
- raw `ipcRenderer` / `ipcMain` を Renderer 側に公開しない。

### 2.5 ワーカーライフサイクル

#### Job Worker（学習・アシスト）

1. Main が `child_process.spawn` で Python CLI を起動し、versioned JSON ファイルをパスとして渡す。
2. Worker は起動後すぐに `{"type":"started","jobId":"..."}` を stdout に書く。
3. Worker は処理の進行に応じて NDJSON progress 行 (`started` / `progress` / `warning` / `completed` / `failed`) を stdout へ逐次書く。
4. 診断情報は stderr へ書く。画像本体や機密パスは出力しない。
5. 成果物を job ディレクトリへ一時書き出し、正常終了後に Main が hash 検証・rename・DB transaction を行う。
6. 学習 Run は同時 1 件 FIFO とし、汎用スケジューラは作らない。

#### Inference Worker（カメラ推論）

1. Main が推論画面表示時に spawn し、推論画面を離れたときに kill する。
2. ONNX Runtime セッションは 1 worker に 1 セッションとし、warm-up 完了後にフレーム受信を開始する。
3. Node.js 側から 4 バイト length prefix + compact header + 固定形状 RGB バイト列を stdin へ書く。
4. Worker は推論結果を NDJSON で stdout へ返す。
5. フレームキューの最大深度は 1 とし、古い pending フレームは新しいフレームで置換する（最新フレーム優先）。

> **Gate 1 PoC 境界:** Version 1 では Windows の binary pipe (SPI-07) と DirectML / CPU Execution Provider (SPI-08) を Gate 1 の証拠とする。保存済み PoC の到達範囲と未完了条件は §2.8 のとおりであり、Gate 1 全体は未解決である。CoreML/MPS の実機検証は将来 macOS backlog であり、Gate 1/4 の証拠には含めない。

### 2.6 障害・キャンセル動作

| 状況 | 動作 |
|---|---|
| Job Worker が異常終了 | Main が exit code を検知し、Run を `Failed` 状態へ遷移。部分成果物は削除する。 |
| ユーザーが学習をキャンセル | Main が Job Worker の stdin へ versioned NDJSON の cancel control message を送り、安全終了を要求する。新規 checkpoint は作らず、epoch/trial 境界で既に保存済みの checkpoint とログを保持する。猶予後も終了しない場合だけ強制終了し、Run は再開不可の `Cancelled` とする（FR-TRN-013/014）。 |
| アプリ再起動時に `Running` 状態の Run が残存 | `Interrupted` 状態へ遷移し、resume 可否をユーザーに提示する。`Cancelled` 状態の Run は再開しない。 |
| アプリ再起動時に `Exporting` / `Evaluating` 状態の Run が残存 | 要求定義 §10 に `Interrupted` への遷移がないため `Failed` へ遷移する。正規パスへ移動済みだが DB から参照されない成果物は孤立成果物として検出・削除対象にする。 |
| Inference Worker が落ちた | Main が検知して推論画面にエラーを表示。カメラストリームは Main の指示で停止する。 |
| Reference ファイルが変更・消失 | 学習開始前または epoch/trial 境界で hash 検証し、不一致が 1 件でもあれば Run を安全停止する。再現性が失われた状態では継続しない。 |
| カメラ推論中に Execution Provider が失敗 | CPU EP へフォールバックし、フォールバックした事実と性能低下見込みを UI に表示する。 |

### 2.7 データ所有権

- **SQLite は Electron Main だけが書き込む。** Python worker は DB ファイルを開かない。
- **Project ファイルへの書き込みは Main が調整する。** Worker は job ディレクトリへの書き出しだけを行う。
- **Dataset Revision は不変。** 確定後は上書きしない。追加学習は新しい Revision を作成する。
- **Reference モードの参照元ファイルは削除も変更もしない。** アプリが書き込むのは Project 作業領域だけである。
- **カメラフレームと推論結果はメモリ上のみで処理する。** ディスクやログへ保存しない。

### 2.8 現在の検証状態

| 対象 | 保存済み証拠 | 本 ADR で主張しないこと |
|---|---|---|
| SPI-07 binary pipe | Windows 11 24H2+ x64 で 320/640 固定 RGB、各 100 frame の transport PoC と不正入力 3 件の fail-closed を確認済み \[E07\] | カメラ統合、queue=1、実モデル、warm-up、30 分連続性能、FR-INF-010 / Gate 4 合格 |
| SPI-08 ORT provider | Windows 11 24H2+ x64 で単一 FP32 `Add` model の CPUExecutionProvider / DmlExecutionProvider session、exact output、profile attribution を確認済み \[E08\] | 採用モデルの演算網羅性、部分 fallback、GPU adapter、latency、throughput、10 FPS、production 採用確定 |
| SPI-03 Windows onedir | 現在の Windows host で Python path から隔離した onedir worker の CPU/DirectML 実行を確認済み。ただし clean Windows 実行は `NOT_RUN / BLOCKED` \[E03\] | 自己完結 installer、clean-host、license payload、Gate 1 合格 |
| macOS CoreML/MPS | 公式資料、lock/package 調査、validator/parser および過去の設計研究を保持 | native Apple Silicon 実行、CoreML/MPS 合格、Version 1 Gate 1/4 の証拠 |

したがって、Main / Renderer / Preload / Job Worker / Inference Worker の境界は Version 1 の承認済みデフォルトである一方、binary protocol の production 固定、採用モデルでの DirectML 適合、性能、packaging は各後続 Gate の合格まで未確定事項を残す。

---

## 3. 採用しない選択肢と理由

| 選択肢 | 採用しない理由 |
|---|---|
| **常駐 Python HTTP サーバー（localhost API）** | ネットワークリスナーを持つサーバーの起動・停止・権限・ポート競合管理が不要な複雑さを生む。オフライン要件とも相性が悪い。ジョブ単位の CLI spawn で同等の分離が実現できる \[実装計画 §1.3 ルール 7\]。 |
| **常駐 Python サービス（message broker 付き）** | MVP ではキュー深度の大きい非同期処理を必要としない。学習は 1 件 FIFO、推論は queue=1 で十分であり、broker の依存と運用コストは YAGNI になる。 |
| **onnxruntime-node（Node.js バインディング）による推論** | Version 1 は Windows の DirectML / CPU を公式 Python package と分離 worker で検証し、学習系 Python runtime と推論実装を揃える。過去に調査した Node prebuilt matrix と macOS CoreML の不確実性は、将来 macOS 対応時に再評価する \[P08\]。 |
| **汎用 RPC framework（gRPC / protobuf codegen）** | MVP の IPC は versioned JSON と NDJSON で十分であり、codegen と追加ランタイム依存は不要な抽象層になる。 |
| **汎用プラグイン API / モデルプラグインレジストリ** | 承認済みモデル以外を実行時に追加する経路を作らない。未監査コードのロードを禁止するためのシンプルな許可リストで足りる \[実装計画 §1.3 ルール 7\]。 |
| **Redux / MobX（全体状態管理）** | 画面単位の React hooks で必要な state が賄えると判断している。必要性が実測で生じた場合のみ別タスクを起票する \[実装計画 §1.3 ルール 5\]。 |

---

## 4. 結果

- Renderer に OS リソースへの直接 API を公開しないため、Renderer 内の不正入力が直接 filesystem や child process へ到達する経路を減らせる \[P01\]。
- Main が単一の DB ライターとなり、データ競合と partial write を防止できる。
- Python worker の異常終了を UI プロセスから分離できる。端末全体のメモリ圧迫などの資源競合は別途検出・制御が必要であり、プロセス分離だけで防げるとは扱わない。
- Windows の binary pipe transport と単一 `Add` model による DirectML / CPU smoke は保存済み PoC の範囲で確認済みである。ただし production protocol、採用モデル互換性、30 分性能、packaging を含む Gate 1/4 合格は主張しない \[P07\]\[E07\]\[E08\]\[E03\]。
- macOS CoreML/MPS の調査は将来 backlog として保持するが、Version 1 の実装・Gate・受入証拠には含めない \[P08\]。
- localhost サーバー・RPC framework・プラグイン API を持たないため、実行時ポート競合・プラグイン起因の脆弱性・認証の複雑さが生じない。

---

## 5. 引用・参照

| 記号 | 内容 |
|---|---|
| \[P01\] | Electron, [Security](https://www.electronjs.org/docs/latest/tutorial/security) — context isolation、sandbox、IPC sender 検証、navigation/CSP |
| \[P07\] | ONNX Runtime, [DirectML Execution Provider](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html) — DirectX 12、sequential Run、fixed shape |
| \[P08\] | ONNX Runtime, [CoreML Execution Provider](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html) / [Node.js binding](https://onnxruntime.ai/docs/get-started/with-javascript/node.html) — 将来 macOS 対応のため保持する CoreML Python package と Node prebuilt matrix の調査 |
| \[RD\] | `docs/requirement-definition.md` v0.4 Draft — Windows 11 24H2 以降 x64 の Version 1 要求と将来 macOS 要求の境界 |
| \[IP\] | `docs/implementation-plan.md` §1.3〜1.4、§3、§6 — オーバーエンジニアリング防止、Windows MVP のプロセス境界と Gate 条件 |
| \[E07\] | `spikes/inference/pipe-result.md` — Windows binary transport PoC の保存済み結果と制限 |
| \[E08\] | `spikes/inference/provider-result.md` — Windows CPU/DirectML provider smoke の保存済み結果と制限 |
| \[E03\] | `spikes/packaging/windows-result.md` — Windows onedir PoC の部分合格と未完了条件 |

---

*本 ADR は実装完了または Gate 合格を宣言するものではない。Windows の後続 PoC と Gate 1/4 の結果によって §2.5「Inference Worker」の詳細仕様が更新される可能性がある。macOS CoreML/MPS は将来版で新しい要求・PoC・Gate を設定して再決定する。*
