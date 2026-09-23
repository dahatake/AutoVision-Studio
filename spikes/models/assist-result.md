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

gold set の item 数が両 session で異なる場合は中止する（件数の異なる集合を比較しない）。

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
