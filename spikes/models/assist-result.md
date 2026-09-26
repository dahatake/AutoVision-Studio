# SPI-17 / G2-07 — 補助品質 baseline 実測結果

| 項目 | 値 |
|---|---|
| タスク | SPI-17 / Gate 2 lane `G2-07`（gold set での coverage / accept / edit / reject / 所要時間を手作業のみと比較） |
| 実行日 | 2026-09-22 |
| 実行 host | Windows `10.0.29671` / `AMD64` / CPython `3.14.7` |
| 対象 script | [`spikes/models/assist_benchmark.py`](assist_benchmark.py) |
| baseline 判定 | **NOT_RUN — 実測値 0 件**。段階 3 は利用者指示により `SKIPPED_BY_USER`（§7） |
| harness 自己検証 | **PASS**（指標計算のみ。品質 baseline ではない） |
| Gate 2 | **BLOCKED を維持** |
| manifest | **本 spike は manifest を変更しない**（assist harness は読み取りのみ）。[`manifest.json`](../../resources/models/manifest.json) は `ready=false` で、2026-09-23 の Gate 2 残タスク実行後も C7 entry は 0 件である（C6 分類・C6 検出の 2 件のみ。[ADR-0004](../../docs/adr/0004-spike-decisions.md) §5.1.12・§5.1.13） |

---

## 1. なぜ baseline を測れないか

`G2-07` の DoD は「gold set で coverage / accept / edit / reject / 所要時間を**手作業のみと比較し実測記録**」である。補助ありの session を記録するには、承認済みの Annotation Assist Model（C7）が必要である。

| 依存タスク | 記録 | 結論 |
|---|---|---|
| `G2-03` / SPI-13 | [`classification-assist.md`](../../docs/model-governance/classification-assist.md) | SigLIP `HOLD`、OpenAI CLIP `REJECT`、承認済み分類 C7 **0 件** |
| `G2-04` / SPI-14 | [`detection-assist.md`](../../docs/model-governance/detection-assist.md) | Florence-2-base-ft / Grounding DINO Swin-T / Swin-B すべて `HOLD`、承認済み検出 C7 **0 件** |

承認済み C7 が 0 件である以上、補助ありの session は存在し得ない。**存在しない session から coverage や所要時間を生成・推定・模擬しない。** したがって baseline は `NOT_RUN` とし、数値欄を空のままにする。

---

## 2. 実行方法と exit code

### 2.1 baseline（fail-closed gate）

```powershell
ml\.venv\Scripts\python.exe spikes\models\assist_benchmark.py
```

- exit code: `2`
- 出力:

| 項目 | 値 |
|---|---|
| `verdict` | `BLOCKED` |
| `measured` | `null` |
| `manifest_path` | `resources/models/manifest.json` |
| `release_ready` | `false` |
| `model_entry_count` | `0` |
| 承認済み C7（分類 / 検出） | `0` / `0` |

- blocker（script が manifest から実読みした事実）:
  1. `resources/models/manifest.json has releaseStatus.ready=false`
  2. `no approved C7 classification assist entry in the manifest`
  3. `no approved C7 detection assist entry in the manifest`

### 2.2 harness 自己検証

```powershell
ml\.venv\Scripts\python.exe spikes\models\assist_benchmark.py --self-test
```

- exit code: `0`、`verdict=PASS`、`failures=[]`
- 検証した内容:
  - coverage = 提案のあった item 数 / gold set item 数（3/4 = 0.75）
  - accept / edit / reject 率を提案のあった item だけで割る（各 1/3）
  - 合計所要時間 20.0 秒、item あたり 5.0 秒
  - coverage 0 の session で各率を `null` にし、0 除算しない
  - 不正 record（`proposed=true` と `outcome=manual` の矛盾、未知の `outcome`、`seconds` 欠落）を拒否する
- **この PASS は指標計算の正しさだけを示す。補助の品質・時間短縮を示さない。**

### 2.3 証拠を結び付ける SHA-256

| 対象 | SHA-256 |
|---|---|
| `spikes/models/assist_benchmark.py` | `9d116dd3650de2a086e0e5adec3a2000abffe5659fc69e187360db17f71eb382` |
| `resources/models/manifest.json`（実行前後で不変） | `7fe41f5bc497d48ffcbbaebaeb5cb02e91dfba0e1a6fe9b66d8cf8928c437a61` |

---

## 3. baseline を実施する際の入力形式

承認済み C7 が出た後に実施するための形式を固定した。**実作業から記録した JSON Lines だけを入力に取る。**

```json
{"item_id": "...", "proposed": true, "outcome": "accept", "seconds": 4.5}
```

| field | 内容 |
|---|---|
| `item_id` | gold set の item 識別子。補助あり / 手作業のみで同一集合であること |
| `proposed` | 補助モデルが提案を出したか |
| `outcome` | `accept` / `edit` / `reject`（提案あり）、`manual`（提案なし） |
| `seconds` | その item に実際に要した秒数 |

実行:

```powershell
ml\.venv\Scripts\python.exe spikes\models\assist_benchmark.py --assisted-session <assisted.jsonl> --manual-session <manual.jsonl>
```

gold set の item id の集合が両 session で異なる場合、または 1 つの session に同じ item id が 2 回以上ある場合は中止する（§9）。

---

## 4. 実測欄（未取得）

| 指標 | 補助あり | 手作業のみ | 差 |
|---|---|---|---|
| coverage | **未取得** | — | **未取得** |
| accept 率 | **未取得** | — | **未取得** |
| edit 率 | **未取得** | **未取得** | **未取得** |
| reject 率 | **未取得** | — | **未取得** |
| item あたり所要時間 | **未取得** | **未取得** | **未取得** |

**未取得の欄に推定値・目標値・他タスクの数値を書かない。**

---

## 5. 解除に必要な条件

1. 分類・検出の双方について、Annotation Assist Model（C7）が `docs/dependency-policy.md` §6.1 / FR-LIC-014 の必須証拠と承認者署名を満たし、`resources/models/manifest.json` へ登録されること。
2. gold set を確定し、補助あり / 手作業のみの両 session を**実作業から**記録すること（`docs/ui-ux-execution.md` の方針どおり、自己点検や実装担当の代行で置き換えない）。
3. 上記 2 件の session を §3 の形式で本 harness に通し、`verdict=MEASURED` の出力を本書へ転記すること。
4. NFR-ANN-006 の「品質を下げずに時間を短縮する」判定は、上記実測が揃った後にのみ行う。

---

## 6. Gate 2 への影響

- 本結果は **`G2-07` の DoD を満たさない**。満たせない理由（承認済み C7 が 0 件、および段階 3 の `SKIPPED_BY_USER`）を fail-closed に記録した。
- したがって **Gate 2 は BLOCKED のまま**である。
- `resources/models/manifest.json` は変更していない。harness は manifest を**読むだけ**であり、書き込まない。
- `AST`（Annotation Assist）の実装は、本 baseline が `MEASURED` になるまで開始しない。

---

## 7. 2026-09-22 — 利用者指示による段階 3 の `SKIPPED_BY_USER`

### 7.1 指示の内容と適用範囲

2026-09-22、利用者が §5 の解除条件のうち **段階 3（gold set に対する補助あり／手作業のみの実作業 session の記録）を「スキップ」** と指示した。

| §5 の条件 | 状態 |
|---|---|
| 1. 分類・検出の C7 を manifest へ登録 | **未充足**。[SPI-13 §18](../../docs/model-governance/classification-assist.md) / [SPI-14 §18](../../docs/model-governance/detection-assist.md) のとおり、利用者の採用指示は受領したが checkpoint 固有 license が未取得で manifest schema の必須欄を満たせない |
| 2. gold set の確定と両 session の実作業記録 | **`SKIPPED_BY_USER`**（本指示） |
| 3. harness へ通して `verdict=MEASURED` を得る | **成立しない**（条件 1・2 が未充足のため） |
| 4. NFR-ANN-006 の判定 | **未実施** |

### 7.2 この扱いの根拠と境界

本 repository は `SPI-03` / `SPI-09` / `SPI-19` について「利用者指示によるスキップを `SKIPPED_BY_USER` として保持し、**PASS へ変更しない**」という既存規約を持つ（[ADR-0004 §3](../../docs/adr/0004-spike-decisions.md)）。段階 3 にも同じ扱いを適用する。

- **`SKIPPED_BY_USER` を `PASS` と読み替えない。** coverage / accept / edit / reject / 所要時間の実測値は §4 のとおり**未取得のまま**である。
- **推定値・目標値で補わない。** 補助ありの session が存在しない以上、時間短縮も品質非低下も測定できない。
- **NFR-ANN-006 は出荷条件**（「manual-only と assisted の比較試験を行い、品質を悪化させず所要時間を短縮すること」）である。本スキップにより、この出荷条件は**未充足のまま残る**。
- harness（[`assist_benchmark.py`](assist_benchmark.py)）と入力形式（§3）は保持する。条件 1 と段階 3 が揃った時点で、そのまま実施できる。

### 7.3 現在の実行結果（再掲）

利用者の採用指示を受けた後も、manifest は未編集であるため fail-closed gate の出力は変わらない。

```powershell
ml\.venv\Scripts\python.exe spikes\models\assist_benchmark.py     # exit 2, verdict=BLOCKED
ml\.venv\Scripts\python.exe spikes\models\assist_benchmark.py --self-test   # exit 0, verdict=PASS
```

`G2-07` の総合判定は **NOT_RUN**（段階 3 は `SKIPPED_BY_USER`、条件 1 は未充足）である。

---

## 8. 2026-09-22 追記 — C7 risk acceptance 後も gate が開かない理由

利用者 **dahatake** が同日、**C7 にも risk acceptance を出す**と決定した（[`evidence/2026-09-22-owner-risk-acceptance.md`](../../docs/model-governance/evidence/2026-09-22-owner-risk-acceptance.md)）。これにより §5 の条件 1 のうち**権利層は充足**したが、**gate は依然として `BLOCKED`** である。

### 8.1 gate の実出力（manifest 更新後の再実行）

```powershell
ml\.venv\Scripts\python.exe spikes\models\assist_benchmark.py            # exit 2, verdict=BLOCKED
ml\.venv\Scripts\python.exe spikes\models\assist_benchmark.py --self-test  # exit 0, verdict=PASS
```

| 項目 | 値 |
|---|---|
| `release_ready` | `false` |
| `model_entry_count` | **`1`**（C6 検出の SSDLite320 MobileNetV3 Large。2026-09-22 に登録） |
| 承認済み C7（分類 / 検出） | **`0` / `0`** |
| blocker | `releaseStatus.ready=false`、`no approved C7 classification assist entry`、`no approved C7 detection assist entry` |

### 8.2 残る未充足（権利ではない）

| 対象 | 残件 |
|---|---|
| SigLIP（C7 分類） | `windows-x64/cpu` と `windows-x64/directml` の parity が**未実測**。ONNX 化に新規依存（`transformers` 相当）が必要で、本測定環境に導入していない。採用記録ファイルも未作成 |
| Florence-2（C7 検出） | ONNX 化に publisher の custom code 実行が必要で、**DA-B05 の security gate を通過していない** |
| Grounding DINO（C7 検出） | 構造定義コードが本測定環境に存在せず parity 未実測 |

`support[]` の `verified` は schema 上 `const: true` であるため、未実測のまま entry を書くことは**実行していない試験を合格として記録する行為**にあたる。よって entry を作成しない。

### 8.3 段階 3 の扱いは変わらない

gold set に対する補助あり／手作業のみの実作業 session は、C7 entry が無い限り記録できない。段階 3 は引き続き **`SKIPPED_BY_USER`** であり、**`PASS` へ読み替えない**。`G2-07` の総合判定は **NOT_RUN** のままである。NFR-ANN-006 は出荷条件として未充足である。

## 9. 2026-09-23 — harness の前提条件の修正（manifest schema 2.0.0）

manifest schema 2.0.0 で、`releaseStatus.ready=true` に C7 分類・検出の比較試験の合格記録（`releaseStatus.assistQuality[]`）を必須とした。このため `ready=true` を harness の前提条件にすると、試験を実行できないまま `ready=true` にもできず、状態が進まない。harness を次のとおり直した。

| 変更 | 内容 |
|---|---|
| 前提条件 | `releaseStatus.ready=false` を blocker から外した。blocker は承認済み C7 entry（分類・検出）の欠如だけになる。`release_ready` は情報として出力する |
| 同一 gold set | item 数の一致ではなく、item id の集合の一致を要求する。1 session 内の item id の重複も拒否する（`--self-test` に重複の否定 test を追加） |
| 所要時間 | POC-16 の判定に使う item あたり秒数の中央値（`median_seconds_per_item`、`median_seconds_delta_per_item`）を出力に加えた。平均（`seconds_per_item`）は参考値として残す |
| 記録の型 | `item_id` は空でない文字列、`proposed` は JSON の boolean、`seconds` は有限で負でない数値だけを受け付ける（文字列の `"false"`、負の秒数、`NaN` 等を拒否。`--self-test` に否定 test 5 件を追加） |

実行結果（2026-09-23）: `--self-test` は `verdict: PASS`（exit 0）。baseline mode は `verdict: BLOCKED`（exit 2）、blocker は `no approved C7 classification assist entry in the manifest` と `no approved C7 detection assist entry in the manifest` の 2 件。§8 までの記録は当時の実行結果として変更しない。品質非劣化の判定方法は C7Q-01（gold set と基準の事前固定）で決める事項であり、本修正では追加していない。

## 10. 2026-09-24 — 所有者の判断 G2D-02 による段階 3 の `SKIPPED_BY_USER` の解除

repository owner の判断（[`2026-09-24-owner-ruling-G2D-02.md`](../../docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-02.md)、選択: A）により、§7 の段階 3 の `SKIPPED_BY_USER` を解除した。段階 3（gold set に対する補助あり／手作業のみの実作業 session の記録）は、利用者が実作業 session を記録する対象に戻る。

- §7・§8 は当時の記録として変更しない。
- 解除は session が記録されたことを意味しない。session（Gate 2 計画 §8.14 の G2Q-04C / 04D / 05C / 05D）は利用者の実作業からだけ作り、実装担当は値を生成・推定・補完しない（同判断記録の「本判断が意味しないこと」1）。
- 実測値は §4 のとおり未取得であり、§5 の条件 1（承認済み C7 の manifest への登録）も未充足である（§9 の実行結果）。`G2-07` の総合判定は **NOT_RUN** のままである。

## 11. 2026-09-24 — G2Q-02: 承認済みの gold set と判定基準による判定（harness の変更）

Gate 2 計画（`work/202609232120-RemainTaskExecutionPlan.md` §8.11）に従い、harness を変えた。判定基準は所有者が承認した gold set 計画（[`assist-goldset-plan-classification.md`](assist-goldset-plan-classification.md)・[`assist-goldset-plan-detection.md`](assist-goldset-plan-detection.md)。承認の記録は [`G2D-07C`](../../docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-07C.md)・[`G2D-07D`](../../docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-07D.md)）の値である。§10 までの記録は当時の実行結果として変更しない。

| 変更 | 内容 |
|---|---|
| 前提条件 | manifest の承認済み C7 entry から、採用記録 §12（比較試験）以外の gate を通過した採用候補へ変えた。採用記録を `--candidate-record`、その SHA-256 を `--candidate-sha256` で受け取る。どちらかが無い、file が無い、または SHA-256 が一致しない場合は `verdict: BLOCKED`（exit 2）で、何も測らない。harness は結果をその採用記録に結び付けるだけで、§12 以外の gate の合否は判定しない（採用記録の §15 の判定で扱う） |
| gold set | `--goldset` で gold set manifest（`vendor/models/_spike/assist/goldset-<task>.json`）を受け取る。item id の重複、件数と `expected_item_count` の不一致、または件数が承認された計画 §2 の値（分類 60、検出 20）でない場合に中止する。両 session の item id の集合が gold set と一致しなければ中止する |
| 最終 label | 製品で確定した Dataset Revision の manifest を `--assisted-revision` / `--manual-revision` で受け取る。その SHA-256 が、`<session file>.meta.txt` のただ 1 つの `revision_sha256: <64 桁の小文字 16 進>` の行と一致しなければ中止する。gold の各 item は `items[].imageSha256` がちょうど 1 件一致し、`disposition` が `excluded` でないこと、manifest の `taskType` が gold set の task と同じことを要求する。class は `schema.classes` の `normalizedName` で名前へ解決し、gold の class の名前がすべてその `normalizedName` のどれかであることを要求する（無い名前は両 session の品質を 0 にして合格させうるため）。`outcome` から最終 label を推定しない。中止した場合は verdict を出さずに非零で終わる |
| 判定 | 分類: 最終 label の accuracy で `Qa >= Qm - 1/60`、かつ class ごとに `Qa_c >= Qm_c - 1/20`。検出: item の中で IoU の大きい順に 1 対 1 で対応させ、IoU 0.5 以上を一致とした全 item の F1 で `Qa >= Qm - 0.005`。両 task で、補助ありの session の提案の coverage が 0.5 以上、item ごとの `seconds` の中央値が `median(assisted) < median(manual-only)`。品質は分数で比べ、境界で丸めない。すべてを満たす場合だけ `PASS`（exit 0）、それ以外は `FAIL`（exit 1） |
| 出力 | `verdict`、`checks`、`quality`、`median_seconds`、`environment`、`assisted`・`manual_only` の要約、`session_sha256`（2 件）、`revision_sha256`（2 件）、`goldset_sha256`、`candidate_sha256` |
| `--self-test` | 品質非劣化の境界、中央値の境界、coverage の境界、採用記録の SHA-256 不一致、gold set と session の item id の不一致、revision の item の不正（class の名前の不一致を含む）、承認された件数でない gold set の否定 test を追加した |

実行結果（2026-09-24、`vendor\models\_spike\venv\Scripts\python.exe`）: `--self-test` は `verdict: PASS`（exit 0）。引数なしの実行は `verdict: BLOCKED`（exit 2）、blocker は `--candidate-record and --candidate-sha256 are both required`。`ruff check` と `ruff format --check` は exit 0。

- 本変更は測定ではない。session（G2Q-04C / 04D / 05C / 05D）は所有者の判断で今回の作業から除外されたため記録されておらず、§4 の実測欄は未取得のままである。`G2-07` の総合判定は **NOT_RUN** のままである。
- 採用候補の閾値（`confidenceThreshold` / `thresholdPolicy`、G2Q-03C / 03D）は未確定である。承認された gold set 計画は、model 単体の評価から閾値を選ぶ規則を定めていない。

## 12. 2026-09-26 — 所有者の判断による比較試験の免除

[所有者の判断（2026-09-26）](../../docs/model-governance/evidence/2026-09-26-owner-rulings.md)により、比較試験（SPI-17 段階 3、NFR-ANN-006、POC-16 の品質・中央所要時間の比較）を Version 1 の実施対象から削除し、未実施のまま完了扱いとした。本 harness で session を記録・判定した結果は無く、`PASS` とは記録しない（段階 3 の測定値は §4 のとおり未取得）。manifest schema `2.0.1` 以降は `releaseStatus.ready=true` に `releaseStatus.assistQuality[]` を求めない。本 harness は、今後に試験を行う場合のために残す。
