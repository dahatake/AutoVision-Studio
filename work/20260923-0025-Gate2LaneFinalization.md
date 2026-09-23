# Gate 2 lane — 採用処理の完了と敵対的レビュー（作業記録）

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書（実行記録） |
| 作成日時 | 2026-09-23 00:25 |
| 対象指示 | 2026-09-22 23:33 の採用指示（C7 risk acceptance / 検出 budget 測定許可 / license 識別子・NOTICE・承認者氏名の提示）と、2026-09-23 00:25 の「デフォルト採用・全タスク実行・各タスク完了後に敵対的レビューと反映」 |
| 要求基準 | [`docs/requirement-definition.md`](../docs/requirement-definition.md)（v0.5 Draft、245 要求）。指示にある `/hve-dev/requirement-definition.md` は**実在しない**ため、既存の D-01 / Q-01 の決定どおり実在文書を参照した |
| 正本 | [`docs/implementation-plan.md`](../docs/implementation-plan.md)、[`docs/adr/0004-spike-decisions.md`](../docs/adr/0004-spike-decisions.md)、`docs/model-governance/*.md`、[`resources/models/manifest.json`](../resources/models/manifest.json) |
| 先行記録 | [`20260921-1330-TaskExecutionPlan.md`](20260921-1330-TaskExecutionPlan.md)（Gate 2 lane 実行記録・再検証記録・追加作業 1/2）、[`20260922-1340-Gate2LaneAdoption.md`](20260922-1340-Gate2LaneAdoption.md) |
| 実行 host | Windows `10.0.29671` / `AMD64` / CPython `3.14.7` / Node `24.19.0` |

---

## 1. 指示と実在物の差異

| 指示された参照先 | 調査結果 | 本作業での扱い |
|---|---|---|
| `/hve-dev/requirement-definition.md` | `hve-dev/` は存在しない | 実在する [`docs/requirement-definition.md`](../docs/requirement-definition.md) を参照した（D-01 / Q-01 の既存決定と一致） |
| `hve` / `Markdown query Skill` / `Code Query skill` / `Autonomous Task Graph` の各パッケージ | 本 repository に存在しない。`package.json` は root の 1 件のみ | 版更新は既存規約どおり root `package.json` / `package-lock.json` の PATCH を対象とした |

## 2. 実行したタスクと完了条件（DoD）の判定

DoD は [`20260921-1330-TaskExecutionPlan.md`](20260921-1330-TaskExecutionPlan.md) の `### Gate 2 lane` 表を正本とする。

| ID | DoD の要点 | 本作業での結果 | 判定 |
|---|---|---|---|
| G2-01 | 候補を一次資料 URL・取得日付きで判定し、不明が残れば `HOLD` | 候補 8 件を再調査済み。両立する候補 0 件で `HOLD` 保持 | **PASS** |
| G2-02 | 同上 | 権利 gate は利用者の risk acceptance で充足。DP-01 / DP-04 の parity を実測し、採用記録・NOTICE・承認者氏名を得て **manifest へ 1 件登録** | **PASS** |
| G2-03 / G2-04 | 同上 | 権利 gate を risk acceptance で充足として記録。parity 未実測のため manifest 未登録 | **PASS（判定の記録として）** |
| G2-05 / G2-06 | train → ONNX → 推論差の実測記録 | 既実測。本作業で再実行・再現確認済み | **PASS** |
| G2-07 | gold set の coverage / accept / edit / reject / 所要時間を手作業のみと比較し実測 | manifest 更新後も gate は `BLOCKED`（承認済み C7 0 件）。段階 3 は `SKIPPED_BY_USER` | **未達（NOT_RUN）** |
| G2-08 | Windows 実機 mini-run に基づく有限の最大 Trial 数・最大時間。測定前の数値を置かない | 分類 CPU/CUDA に加え **検出 CPU を実測**し D-15 へ記録 | **PASS（検出 CUDA・実データ規模は未決定）** |
| G2-09 | 4 役すべて承認時のみ `ready=true`。1 役でも未承認なら `BLOCKED` を保持 | C6 検出 1 役のみ登録し `ready=false` を保持 | **PASS** |

## 3. デフォルト採用した不明点

| ID | 不明点 | 採用したデフォルト |
|---|---|---|
| Q-11 | checkpoint license 識別子 | `LicenseRef-AutoVisionStudio`（SPDX の `LicenseRef-` 構文） |
| Q-12 | C7 の manifest 登録 | 登録しない（parity 未実測・Florence-2 は custom code 実行が security gate 未通過） |
| Q-13 | C6 分類 | 未登録のまま |
| Q-14 | G2-07 段階 3 | `SKIPPED_BY_USER` 維持 |
| Q-15 | 検出 budget の測定条件 | このPC の CPU |
| Q-16 | NOTICE の構成 | C5 / C6 / C8 を分離 |

## 4. 敵対的レビューと反映

独立 agent（`g2-final-review`、read-only）による敵対的レビューを実施した。レビュアーは全新規・変更 file を読み、**parity probe を自機で再実行**し、schema test を再実行し、参照 artifact を再 hash して検証した。**blocking 2 件・non-blocking 4 件**を受領し、**全件反映した**。

| # | 重大度 | 指摘 | 反映内容 |
|---|---|---|---|
| 1 | **blocking** | 登録した model の正本である `detection-base.md` が、同じ変更で追加した節（§15.3 / §15.4 / §15.5 と header 行・§0.2 の HOLD 行）で「manifest 未編集」「採用記録未作成」「承認者氏名未記載」「承認済み検出 C6 は 0 件」と、**現在の状態と反対のこと**を主張していた。manifest の `approval.recordPath` を辿った読者が「entry を作ってはならない」と書かれた文書に到達する | header 4 行と §0.2 の HOLD 行を登録後の状態へ更新し、§15.3 / §15.4 / §15.5 には登録前の記述であることを明示。新規に **§15.6（承認と登録の記録）** と **§15.7（本登録が意味しないこと）** を追加。§14・§15.1〜15.3 の履歴記述は削除していない |
| 2 | **blocking** | `docs/adr/0004-spike-decisions.md:28`（§1 の要約）が「**承認済み model は依然 0 件**」「manifest の未編集は変更しない」のままで、同一文書の §5.1.8 / §5.1.10 と矛盾。ADR は §1 を最初に読まれる | §1 を「C6 検出 1 役を承認・登録した。他 3 役未承認のため BLOCKED と `ready=false` は変更しない」へ訂正 |
| 3 | non-blocking | `detection-checkpoint-parity-result.md` の §8 / §9 が「採用記録・NOTICE・license 識別子は未提示」「本結果を根拠に `verified: true` の entry を追加してはならない」と書いたまま、実際には同日中に登録が行われ header 行だけが更新されていた（半分だけ新しい状態） | §8 の 2 行を「測定時点では未提示。同日中に §15.6 で解消」へ、§9 を「本書は `support[]` の測定根拠のみを供給し、登録は §15.6 の手続きによる」へ訂正。§3.1 の manifest hash は「**測定時点**の値」と明示 |
| 4 | non-blocking | `classification-assist.md`（3 箇所）・`detection-assist.md`・`classification-base.md` が「`manifest.json` は未編集のまま」と **file についての主張**として書かれており、現在は偽 | いずれも「**本記録を根拠とする entry は作成しない**（C6 検出 entry は `detection-base.md` §15.6 由来）」へ書き換え |
| 5 | non-blocking | `detection_checkpoint_parity.py` の `--checkpoint` が **どこからも渡されない未使用フラグ**（YAGNI 違反）であり、かつ渡された場合に `"vendor/models/" + name` という**観測していない path** を証拠 JSON に書く | フラグを削除し、`CHECKPOINT_PATH` を直接使用。記録 path は `relative_to(REPO_ROOT)` で実 path から導出。**修正後に再実行し、3 比較とも `PASS`・ONNX SHA-256 も同一**であることを確認。script の SHA-256 記録値を `38984621…4ae277` へ更新 |
| 6 | non-blocking | 同結果書 §6 の「`1.290`（session 初期化を含む）」が実装と不一致。session 構築（L85）は計測開始（L88）より前で、計測対象外 | 「初回 run の warm-up を含む。session 構築は含まない」へ訂正 |

レビュアーが**明示的に clean と報告した範囲**: parity 測定の再現性（3 回目の独立実行で全数値一致）、比較ロジックに silent-pass 経路が無いこと、checkpoint と evidence の全 hash 一致、COCO terms URL の実在、fixture の box 数 234 と batch 除外 `{2}` の算術、D-15 の `19.479 × 20 = 389.58 → 420` の導出、schema test の coverage が弱まっていないこと、C5 の BSD-3-Clause で checkpoint を正当化していないこと、新規コードに過剰な抽象化・未使用依存・防御的例外処理が無いこと（指摘 5 を除く）。

### 反映後の再検証

| 検証 | 結果 |
|---|---|
| `detection_checkpoint_parity.py`（修正後） | **exit 0**、3 比較とも `PASS`、ONNX SHA-256 `6e62517b…e99d9` で不変 |
| `ruff check` / `ruff format --check` | **exit 0** / **exit 0** |
| `node --test scripts\models\manifest-schema.test.mjs` | **36 passed / 0 failed** |
| `node --test scripts\release\verify-product-version.test.mjs` | **0 failed** |
| `node --test scripts\docs\verify-documentation.test.mjs` | **0 failed** |
| `node scripts\docs\verify-documentation.mjs` | **exit 0** |
| `node scripts\release\verify-product-version.mjs` | **exit 0**（0.1.2） |
| `git diff --check` | **exit 0** |

## 4.1 CHANGELOG と版

- [`CHANGELOG.md`](../CHANGELOG.md) の `[Unreleased]` に、概要文と `Added` / `Changed` / `Fixed` / `Removed` / `Security` のエントリーを Keep a Changelog 規約に従って記載した。
- root `package.json` / `package-lock.json` の PATCH を **0.1.1 → 0.1.2** へ 1 つ増やした（`version` と `packages[""].version` の 2 箇所）。指示にある `hve` / `Markdown query Skill` / `Code Query skill` / `Autonomous Task Graph` は本 repository に存在しないため、既存規約どおり root package を対象とした。

## 4.2 追加作業（2026-09-23 01:36〜）— 性能実測・CUDA budget・登録の取り消し

利用者の入力を必要としない 2 項目を実行し、その結果として**登録を取り消す**判断に至った。

| 項目 | 結果 |
|---|---|
| 検出 AutoML の CUDA budget（D-15 の唯一の未達） | repository 外の隔離 venv（`torch 2.11.0+cu130` / CUDA `13.0` / RTX 4060 Laptop、optuna は CPU 実測と同じ `4.9.0`）で 2 回実測。1 trial 最大 `3.945` / `3.065` 秒 → **「最大 Trial 数 20 / 最大時間 120 秒」**を D-15 へ記録 |
| CPU と CUDA の決定性 | **CPU は 2 回とも 8 trial の loss が同値。CUDA は一致しない**（本条件の CUDA 学習は非決定的）。budget は所要時間のみで算出 |
| SSDLite の推論性能（採用記録 §11 の空欄） | `--mode performance` を追加し 2 回実測。CPU p95 `198.959` / `179.384` ms・`7.07` / `8.35` FPS、DirectML p95 `308.783` / `254.590` ms・`4.64` / `5.45` FPS |
| 採用基準との照合 | `≤ 100` ms / `≥ 10` FPS（POC-03 由来）に対し**両 EP とも不適合**。3 回目の実行とレビュアーの独立実行でも同じ結論 |
| **fail-closed の帰結** | [`adoption-template.md`](../docs/model-governance/adoption-template.md) §15「必須項目が不適合の場合、判定欄に『承認』と記入できません」に従い、**最終判定を承認 → 保留へ差し戻し、manifest entry を削除**（`models: []` / `ready=false`）。**権利層の決定は取り消していない** |

### 4.3 2 回目の敵対的レビューと反映（blocking 1・non-blocking 5 を全件反映）

| # | 重大度 | 指摘 | 反映 |
|---|---|---|---|
| 1 | **blocking** | 取り消し後も 4 箇所（`classification-base.md` §12.7、`classification-assist.md` の 3 箇所、`detection-assist.md`）が「manifest に C6 検出 entry がある」と現在形で主張 | 全 5 行を「2026-09-23 時点で `models` は空（§15.8 で取り消し）」へ修正 |
| 2 | non-blocking | CHANGELOG が同一節内で矛盾（「検出の CUDA は未決定」と「CUDA 値を追加」）。また「各コピーの SHA-256 をモデル一覧から参照します」は entry 削除で偽 | 2 行とも現状へ修正 |
| 3 | non-blocking | parity 結果書 §9 が「登録された」のまま、§10 の取り消しと矛盾。spike 結果 4 件の header 行も旧状態 | §9 に取り消しを追記し、header 4 行を「2026-09-23 時点で空」へ更新 |
| 4 | non-blocking | `detection.py` の証拠 JSON が `--device cuda` の実行でも `not_covered` に「CUDA training」を出力（自己矛盾する scope 記述） | device に応じて条件付きで出力するよう修正し、再実行で確認 |
| 5 | non-blocking | `PeakWorkingSetSize` は process 開始以降の累積最大値で reset されないため、「CPU 経路 / DirectML 経路」という表記は独立値に見えて誤り | JSON の key を `cumulative_process_peak_working_set_bytes` へ改名し、docstring・`not_measured`・関連 3 文書の表記を「累積値であり EP ごとの独立値ではない」と明示 |
| 6 | non-blocking | manifest test が `models.length` を固定しなくなり、entry 混入を防ぐ自動 guard が消失 | `EXPECTED_APPROVED_ENTRIES = 0` を導入して件数を固定（変更には意図的な test 編集が必要） |

レビュアーが**再実行して clean と確認した範囲**: `build_model_and_onnx()` 抽出後も parity が bit 一致で再現（ONNX SHA-256 `6e62517b…e99d9`、3 比較 PASS）、性能測定の手法（warm-up・サンプル数・nearest-rank・session 再利用）、CPU 決定性（3 回目の実行で loss が完全一致）、`3.945 × 20 = 78.9 → 120` と `19.479 × 20 = 389.58 → 420` の算術、全文書の数値一致、`--device` の配線（parity は cuda を拒否、CPU venv での cuda 指定は silent fallback せず exit 1）、manifest の `reason` 文の各節が実在物と一致すること。

## 5. 本作業で変更していないもの

- **Gate 2 は BLOCKED のまま。** 4 役すべてが未承認で `releaseStatus.ready=false`、`models: []`。`AST` / `TRN` / `REP` / `INF` の実装は開始していない。
- **権利層の決定（利用者 dahatake の risk acceptance）は取り消していない。** SSDLite の保留理由は技術（性能）である。
- Gate 1 部の `CONDITIONAL_GO`、`SPI-03` / `SPI-09` / `SPI-19` の `SKIPPED_BY_USER`、Gate 3 の判定、UIR-017 の本人確認。
- `ml/pyproject.toml`・`ml/uv.lock` の依存内容。CUDA 依存は repository 外の隔離 venv へ導入した。生成した ONNX は repository 外へ出力し commit していない。

## 6. Gate 2 完了に不足しているもの（本作業終了時点）

| 役 | 不足 | 誰が解消できるか |
|---|---|---|
| C6 分類 | 候補 0 件（「checkpoint license 明示」と「学習データ商用可」が両立する候補が存在しない） | **利用者**（risk acceptance / 候補指定 / 設計変更） |
| C6 検出 | 推論性能が採用基準に不適合。CVE 調査未実施 | 最適化実測・owner の裁定・owner の受容のいずれか |
| C7 分類 | parity 未実測（新規依存が必要）、採用記録未作成、WebLI の terms が非公開 | **利用者**の判断 + 実装 |
| C7 検出 | parity 未実測、Florence-2 は custom code 実行が security gate 未通過 | **利用者**の判断 + 実装 |
| SPI-17 / G2-07 | 承認済み C7 が 0 件、gold set と実作業 session が未取得 | **利用者**（実作業の記録） |
| D-15 | **充足**（分類・検出とも CPU / CUDA を実測確定。実データ規模のみ未決定） | — |

---

## 7. ライセンス要件の緩和（2026-09-23 05:16 の指示）

利用者から「model は必須なので、要求定義で設定しているライセンスの要件を緩和したい」との指示を受けた。

### 7.1 緩和の設計

**FR-LIC-016（新設）** — checkpoint 層ライセンスまたは学習データ terms を publisher の一次資料から確認できない場合に限り、repository license decision authority の risk acceptance で採用できる経路。条件は 5 つすべてを満たすこと:

1. 一次資料調査を行い、**確認できなかった項目を列挙**する（推測で補わない）
2. 権限者が氏名・役割・決定日付きで書面決定する
3. `LicenseRef-<製品名>` を用い、publisher の許諾表明ではないこと、および `commercialUseConfirmed` / `redistributionPermitted` / `commercialDerivativesPermitted` が**権限者の決定に基づく値**であることを `noticeText` に宣言する。manifest に `unknown` 等の未確定語彙は書かない
4. アプリ内ライセンス表示（FR-LIC-012）と `THIRD_PARTY_NOTICES` に risk acceptance の事実と未確認項目を開示する
5. **技術要件（SHA-256・安全形式・ONNX parity・実行基盤互換・性能）は緩和しない**

一次資料が商用利用・deployed use を**明示的に禁止または out-of-scope としている** checkpoint には適用しない（OpenAI CLIP はこれに該当し、除外のまま）。

### 7.2 変更した文書

| 文書 | 変更 |
|---|---|
| [`requirement-definition.md`](../docs/requirement-definition.md) | FR-LIC-016 新設。FR-LIC-003 / 006 / 007 / 014 を権限者と新経路へ整合。§13.2 の許可条件に 3 つ目を追加。§13.3 の閉じ文を更新。**v0.5 Draft（245 要求）→ v0.6 Draft（246 要求）** |
| [`dependency-policy.md`](../docs/dependency-policy.md) | §3 の fail-closed 表に C6/C7 の層別未確認行を追加。§3 注記・§2.1 に「`unknown` の承認ではなく置き換えと開示」を明記。§6.1 / §6.2 の絶対条項と G-DEP-07 / 08 に新経路の例外を明記。履歴 pin の注記を実際の commit（2026-09-02 `98aba1fd`）へ訂正。根拠要求に 016 を追加 |
| [`implementation-plan.md`](../docs/implementation-plan.md) | 要求対応表に FR-LIC-016 行を追加。LIC-01（SBOM/notices）と LIC-02（アプリ内表示）に開示義務を明記 |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | model 登録の停止条件に新経路の例外を追記（hash・quality・intended-use は緩和しない） |
| [`README.md`](../README.md) | 基準版宣言を v0.6 Draft・246 要求・新 SHA-256 へ同期 |
| SSDLite 採用記録 | NOTICE 文案に FR-LIC-016(3) の宣言と未確認項目の列挙を追加 |

### 7.3 敵対的レビューと反映（blocking 3・non-blocking 2 を全件反映）

| # | 重大度 | 指摘 | 反映 |
|---|---|---|---|
| 1 | **blocking** | FR-LIC-016 の除外条項が「明示的に禁止」のみで、CLIP のような **out-of-scope 記載**の checkpoint を通してしまう（FR-LIC-015 と §13.3 に矛盾） | 「禁止、**または intended use から明示的に除外（out-of-scope）**」へ拡張し、CLIP が該当することを明記 |
| 2 | **blocking** | 緩和したのは §3 の表だけで、実際にリリース可否を決める §6.1 / §6.2 の絶対条項と G-DEP-07 / 08、§3 注記、`CONTRIBUTING.md` が旧規則のまま。**文面上は出荷経路が閉じたまま**で緩和の目的を達していない | 5 箇所すべてに新経路の例外を明記し、注記を manifest 値レベルの表現へ修正 |
| 3 | **blocking** | 条件(3)が `spdx` と `noticeText` しか扱わず、schema が `const: true` を課す `commercialUseConfirmed` / `redistributionPermitted` / `commercialDerivativesPermitted` が「明示的に確認済み」と主張してしまう（条件(1)の「推測で補わない」と衝突） | 条件(3)にこの 3 フィールドが**権限者決定に基づく値**である旨の `noticeText` 宣言を義務化。SSDLite の NOTICE 文案も更新 |
| 4 | non-blocking | 要求対応表に FR-LIC-016 が無く、LIC-01 / LIC-02 に開示義務の記述が無いため後続実装者が飛ばせる | 対応表に行を追加し、LIC-01 / LIC-02 の備考に開示義務を明記 |
| 5 | non-blocking | 履歴 pin の注記の日付（2026-09-04）が実際の blob（2026-09-02、commit `98aba1fd`）と不一致 | 実際の commit と日付へ訂正。pin の**数値自体**は byte 単位で原状復帰済みであることもレビュアーが確認 |

レビュアーが clean と確認した範囲: FR-LIC-010（未確定語彙）・技術 gate・FR-LIC-005（code license で checkpoint を承認しない）のバイパスが**いずれも成立しないこと**、README のハッシュ宣言と実ファイルの一致、要求件数 246、`verify-documentation` の通過、model-governance / ADR に規則レベルの矛盾が無いこと、投機的な新概念の追加が無いこと。

### 7.4 この緩和で変わらないもの

- **技術 gate は一切緩和していない。** SSDLite の保留理由（性能が採用基準に不適合）は本緩和では解消しない。
- **Gate 2 は BLOCKED のまま。** 本緩和は「権利を理由に永久に承認できない」状態を解消するだけであり、承認そのものを与えない。
- OpenAI CLIP の除外、FR-LIC-005 / 010 / 015、manifest schema はいずれも無変更である。
