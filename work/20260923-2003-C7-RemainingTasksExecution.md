# C7 残タスク実行記録

| 項目 | 内容 |
|---|---|
| 文書種別 | 一時作業文書（実行記録）。**採用決定ではない** |
| 作成日時 | 2026-09-23 20:03 JST |
| 計画 | [`20260923-1437-C7-RemainingTasksExecutionPlan.md`](20260923-1437-C7-RemainingTasksExecutionPlan.md) |
| 実行方針 | 利用者指示「不明点はデフォルトのプランを採用」。各ノードは完了条件の検証後に敵対的レビューを受け、blocking 指摘を反映して再検証した。C7C-02 は当初 sandbox で blocked だったが、利用者が実行環境を sandbox 外のターミナルへ変えた後に再実行し、完了した（§7） |

## 1. ノード別の結果

| ノード | 成果物 | 結果 | 敵対的レビュー |
|---|---|---|---|
| C7C-01 TinyCLIP 一次資料調査 | [`20260923-1546-TinyCLIP-PrimarySourceSurvey.md`](20260923-1546-TinyCLIP-PrimarySourceSurvey.md)、`docs/model-governance/evidence/tinyclip-*`（6 file）、[`classification-assist.md`](../docs/model-governance/classification-assist.md) §22 | intended / out-of-scope は一次資料で確認できない。直接の teacher は OpenCLIP ViT-B/16 だが、その checkpoint の重みの系譜は未確認（FR-LIC-015 未解決）。**除外 / HOLD 維持**。hash 検証 exit 0 | 1 回目は通信障害で失敗。再実行で blocking 1 件（FR-LIC-015 を「発動しない」とした結論が証拠より強い）を反映し、blocking 0 |
| C7C-02 SigLIP CPU 最小改善 | [`siglip-assist-result.md`](../spikes/models/siglip-assist-result.md) §7 | 1 回目は sandbox で量子化が実行不能だった。sandbox 外のターミナルで再実行し、int8 は **parity 不合格**（score 最大差 `9.0403e-02`、top-1 12/15）、**CPU p95 `215.785` ms・`8.33` FPS で性能も不合格**。**HOLD 維持**（§7） | 1 回目の記録について blocking 0。再実行について blocking 0、non-blocking 1 件（冒頭の parity 判定欄が fp32 のみを表す）を反映 |
| C7D-01 OWL-ViT controlled artifact | [`20260923-1520-OWLViT-ControlledArtifact.md`](20260923-1520-OWLViT-ControlledArtifact.md) | 7 file の byte size・hash が publisher metadata と一致、`auto_map` なし。検証コマンドは正本で exit 0、改変 copy で exit 1 | blocking 0。non-blocking 1 件（保存していない API 応答の比較）を削除 |
| C7D-02 OWL-ViT parity / performance | [`owlvit_assist_parity.py`](../spikes/models/owlvit_assist_parity.py)、[`owlvit-assist-result.md`](../spikes/models/owlvit-assist-result.md) | 生出力 parity PASS（3 比較）。score `> 0.05` の検出は 0 件で検出単位の比較は空。DirectML p95 `42.3`〜`62.5` ms は合格、**CPU p95 `918.1`〜`1,569.9` ms は不合格** | blocking 1 件（performance mode が基準未達でも exit 0）を修正し再測定。non-blocking 2 件（strict 閾値、DirectML の CPU fallback 警告）を反映。最終レビューの blocking 1 件（performance mode が EP の fallback を判定に使わない）を修正し再測定（実行 3）。blocking 0 |
| C7C-03 C7 分類採用判定 | [`siglip-base-patch16-224-adoption.md`](../docs/model-governance/siglip-base-patch16-224-adoption.md) §16、[`classification-assist.md`](../docs/model-governance/classification-assist.md) §23 | SigLIP **保留を維持**。承認 C7 分類 0 件 | blocking 0 |
| C7D-03 C7 検出採用判定 | [`owlvit-base-patch32-adoption.md`](../docs/model-governance/owlvit-base-patch32-adoption.md)、[`detection-assist.md`](../docs/model-governance/detection-assist.md) §22 | OWL-ViT **保留**。承認 C7 検出 0 件 | blocking 計 3 件（C8 の `unknown` の扱い、`inferenceConfig` の schema 対応、再審査条件の不足）を 2 回に分けて反映し、blocking 0 |
| C7Q-01〜04 補助品質 baseline | — | **実行していない**。C7 分類・検出がいずれも保留のため計画 §5 の HOLD branch を取った。利用者の実作業 session もない | — |
| G2F-01 manifest / ADR 統合 | [`manifest.json`](../resources/models/manifest.json) `releaseStatus.reason`、[`0004-spike-decisions.md`](../docs/adr/0004-spike-decisions.md) §1・§5.1.14 | manifest の model entry は変更なし（承認 2 件、C6 のみ）。`ready=false`、Gate 2 BLOCKED。OWL-ViT は未承認のため設定画面・NOTICE は変更しない | blocking 1 件（schema の `ready=true` 条件が補助品質を参照しない）は既存 schema の範囲外の事項としてレビュー側と合意し非 blocking に変更、§5 に記録。blocking 0 |

## 2. 承認数と Gate 状態の整合

| 文書 | C6 承認 | C7 承認 | `ready` / Gate 2 |
|---|---:|---:|---|
| `resources/models/manifest.json` | 2 | 0 | `false` |
| ADR-0004 §5.1.14 | 2 | 0 | BLOCKED / NOT_COMPLETE |
| `classification-assist.md` §23 / `detection-assist.md` §22 | — | 分類 0 / 検出 0 | — |
| 本書 | 2 | 0 | BLOCKED |

## 3. 検証（2026-09-23、G2F-01 時点の記録。§7 の追補前で、最新の結果は §7）

| コマンド | 結果 |
|---|---|
| `node --test scripts/models/manifest-schema.test.mjs` | exit 0（38 pass） |
| `node scripts/docs/verify-documentation.mjs` | exit 0 |
| `node --test scripts/docs/verify-documentation.test.mjs` | exit 0 |
| `node scripts/release/verify-product-version.mjs` | exit 0 |
| `node --test scripts/release/verify-product-version.test.mjs` | exit 0 |
| `ruff check spikes\models` / `ruff format --check spikes\models`（VS Code 拡張同梱の ruff `0.16.7`） | exit 0 / exit 0（16 files） |
| `git diff --check` | exit 0（追跡 file）。未追跡 file を含めると、取得した bytes のまま保存した evidence 2 file（`tinyclip-cream-license-…txt`、`tinyclip-cream-pretraining-…txt`）の行末空白だけが検出される。hash を保つため変更しない（既存の evidence にも同様の行末空白がある） |

`npm run` は PowerShell の実行 policy で `npm.ps1` が読めないため、`package.json` の各 script と同じコマンドを `node` で直接実行した。

## 4. 実行環境による制約（§7 の追補前の記録。量子化の制約は §7 の再実行で解消した）

| 事象 | 影響 | 扱い |
|---|---|---|
| onnx の external data 保存時の path 正規化が sandbox で拒否される | SigLIP の量子化（C7C-02）が実行不能 | `NOT_RUN` と記録。sandbox policy の見直しが必要 |
| Python 3.12 以降の一時 directory が sandbox で操作できない、PyPI への TLS 接続失敗 | spike venv へ ruff を導入できない | VS Code 拡張同梱の ruff を使用 |
| OWL-ViT parity の 1 回が export 途中で 10 分以上進まなかった | — | process を停止し、新しい出力 directory で 1 回だけ再実行して完了した |

## 5. 範囲外として記録した観察（§7 で manifest schema 2.0.0 により対応した）

- 現行の `resources/models/manifest.schema.json` の `ready=true` 条件は 4 役の model entry を要求するが、NFR-ANN-006 の補助品質の証拠を構造的には参照しない（schema 25〜109 行、`scripts/models/manifest-schema.test.mjs` の合成 fixture 151〜164 行）。要求定義は NFR-ANN-006 の未達での出荷判定 `Go` を禁じており（release governance）、schema による強制は要求していない。schema 側の強制は将来の強化項目であり、本計画の G2F-01 の write set 外のため変更していない（G2F-01 敵対的レビューの指摘。レビュー側も非 blocking と合意）。

## 6. 本書が主張しないこと

1. 採用決定ではない。C7 は 2 役とも承認していない。
2. 補助品質（NFR-ANN-006 / POC-16）は測定していない。
3. SigLIP の量子化は計画の 1 案だけを測った。他の最適化は試していない。

## 7. 追補（2026-09-23 20:36 以降、実行環境の変更後）

利用者指示「ターミナルを sandbox ではなく実ターミナルに変更した。terminal 関連は再度試す。schema はインターネットで公開されているベストプラクティスなどから作成する。その他の残タスクもすべて実行する」に基づき、次を実行した。

| 項目 | 内容 | 敵対的レビュー |
|---|---|---|
| C7C-02 の再実行 | §1 のとおり。量子化経路を [`siglip_assist_parity.py`](../spikes/models/siglip_assist_parity.py) に残した | blocking 0 |
| manifest schema `2.0.0` | [`manifest.schema.json`](../resources/models/manifest.schema.json) に `releaseStatus.assistQuality[]`（`$defs.assistQualityResult`）を追加し、`ready=true` で C7 分類・検出それぞれ 1 件以上の合格記録を必須にした（§5 の観察への対応）。未測定・blocked・不合格は entry を書かないことで表す（値は `const: true` だけを許す）。否定 test 8 件を [`manifest-schema.test.mjs`](../scripts/models/manifest-schema.test.mjs) に追加（46 pass）。[`dependency-policy.md`](../docs/dependency-policy.md) §6.1 と [`adoption-template.md`](../docs/model-governance/adoption-template.md) §12・§14 を合わせた | blocking 4 件（harness との循環、平均と中央値の不一致、同一 gold set の未検査、PKG-01 未接続）のうち 3 件を修正。PKG-01 未接続は計画済みの release verifier の範囲としてレビュー側と合意し非 blocking。non-blocking 1 件（件数の記述）を反映。blocking 0 |
| [`assist_benchmark.py`](../spikes/models/assist_benchmark.py) | `ready=true` を前提条件から外し、item id 集合の一致・重複拒否・中央所要時間を加えた。最終レビューの non-blocking 指摘により、記録の型検査（文字列の `item_id`、boolean の `proposed`、有限で負でない `seconds`）と否定 self-test 5 件を加えた（[`assist-result.md`](../spikes/models/assist-result.md) §9） | 同上。最終レビューは blocking 0、non-blocking 3 件（本書 §3〜§5 の旧記述、記録の型検査、PKG-01 未実装）のうち 2 件を反映し、PKG-01 は未実装として記録 |

schema の設計根拠（2026-09-23 参照）:

| 根拠 | 出典 | 使い方 |
|---|---|---|
| 条件付き必須は `if` / `then`、`if` に `required` を入れる | JSON Schema "Conditional schema validation"（`https://json-schema.org/understanding-json-schema/reference/conditionals`） | 既存の `allOf` 内 `if`（`ready: const true`、`required`）の `then` に `releaseStatus.required: ["assistQuality"]` を追加 |
| 配列内の要素の存在は `contains` / `minContains` | JSON Schema "Array" の Contains（`https://json-schema.org/understanding-json-schema/reference/array`） | task ごとに `contains` + `minContains: 1`（既存の 4 役の検査と同じ形） |
| 既存の有効なデータを拒否し得る変更は MODEL を上げる | Snowplow SchemaVer（`snowplow/snowplow-cli` commit `cee19410aa68ed9dec15abc90473e9558f7eed27` の `internal/validation/schema/data-structure.json`: "Increment MODEL (e.g., 1-x-x to 2-0-0) for ANY breaking change that could reject previously valid data (removals, type changes, constraint tightening)"） | `schemaVersion` を `1.0.0` から `2.0.0` へ |

検証（2026-09-23、追補時点）:

| コマンド | 結果 |
|---|---|
| `node --test scripts/models/manifest-schema.test.mjs` | exit 0（46 pass） |
| `npm run verify:docs` / `npm test`（npm `12.0.2`。system の npm `11.17.0` は `devEngines` の `12.0.x` を満たさないため、`npx npm@12.0` で取得した npm を PATH の先頭に置いて実行） | `verify:version`・`verify:docs`・`test:version`・`test:docs` は exit 0。vitest は 121 file 中 3 file・4,657 test 中 3 件が失敗（`sample-assets.test.ts`、`reference-source.test.ts`、`copy-source.test.ts`）。単独で再実行すると `reference-source` と `copy-source` は合格し、`sample-assets` は失敗する test が回ごとに変わる。変更前の `HEAD`（`9566d53`）の worktree でも `sample-assets.test.ts` は 2 件失敗したため、今回の変更による失敗ではない（原因は調べていない） |
| `assist_benchmark.py --self-test` / baseline mode | `PASS`（exit 0）/ `BLOCKED`（exit 2、承認済み C7 がない 2 件だけ） |
| ruff check / format --check（`spikes\models`） | exit 0 |
| `git diff --check` | exit 0 |

§4 の sandbox 制約のうち量子化は解消した。§5 の観察は schema `2.0.0` で対応した。schema と文書間の照合（`modelId` が同じ task の C7 entry を指すこと、`recordPath` の SHA-256）を実行する PKG-01 の release verifier は未実装のままである。