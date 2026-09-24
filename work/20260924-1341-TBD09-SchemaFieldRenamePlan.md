# TBD-09 manifest schema の許諾 field 名の改訂 — 別計画

| 項目 | 値 |
|---|---|
| 位置付け | 残タスク統合実行計画 [`202609240830-RemainTaskExecutionPlan.md`](202609240830-RemainTaskExecutionPlan.md) §9 C1 の成果物 |
| 状態 | **計画のみ。所有者の承認前。** 本計画では schema・manifest・test・要求定義・文書を変更しない |
| 根拠 | [`requirement-definition.md`](../docs/requirement-definition.md) TBD-09（906 行）と FR-LIC-016(3)（430 行）、所有者の判断記録 [`2026-09-24-owner-ruling-TBD-09.md`](../docs/model-governance/evidence/2026-09-24-owner-ruling-TBD-09.md) |
| graph | [`20260924-1341-TBD09-atg-graph.json`](20260924-1341-TBD09-atg-graph.json) |

## 1. 影響する file の一覧

2 つの field 名（`commercialUseConfirmed` / `commercialDerivativesPermitted`）を含む file。`git grep -c -E 'commercialUseConfirmed|commercialDerivativesPermitted' -- . ':!work'` と、未追跡の file の `Select-String` で数えた（括弧内は行数）。計 13 件で、残タスク計画 C1 の記載（08:33 の grep の 13 件）と一致する。`src/` にはない。

| # | file | 行数 | 担当ノード |
|---|---|---|---|
| 1 | `resources/models/manifest.schema.json` | 4 | T9-S |
| 2 | `resources/models/manifest.json` | 8 | T9-M |
| 3 | `scripts/models/manifest-schema.test.mjs` | 5 | T9-T |
| 4 | `docs/requirement-definition.md` | 2 | T9-R |
| 5 | `docs/adr/0004-spike-decisions.md` | 1 | T9-G |
| 6 | `docs/model-governance/classification-assist.md` | 1 | T9-G |
| 7 | `docs/model-governance/detection-assist.md` | 1 | T9-G |
| 8 | `docs/model-governance/detection-base.md` | 3 | T9-G |
| 9 | `docs/model-governance/mobilenet-v3-large-imagenet1k-v2-adoption.md` | 5 | T9-G |
| 10 | `docs/model-governance/ssdlite320-mobilenet-v3-large-coco-v1-adoption.md` | 4 | T9-G |
| 11 | `docs/model-governance/evidence/2026-09-23-owner-risk-acceptance.md` | 1 | 変えない（§2） |
| 12 | `docs/model-governance/evidence/2026-09-23-owner-risk-acceptance-c7-detection.md` | 1 | 変えない（§2） |
| 13 | `docs/model-governance/evidence/2026-09-24-owner-ruling-TBD-09.md`（未追跡） | 1 | 変えない（§2） |

field 名は含まないが、schema の版 `2.0.0` を参照するため同時に更新する file:

- `docs/model-governance/adoption-template.md:254` と `docs/dependency-policy.md:176`（どちらも「manifest schema `2.0.0`」）: T9-G。
- `resources/models/manifest.schema.json:16`、`:17`（`schemaVersion` の `const` と説明）: T9-S。`resources/models/manifest.json:3`: T9-M。`scripts/models/manifest-schema.test.mjs:164`: T9-T。
- `docs/adr/0004-spike-decisions.md:462` は 2.0.0 への改訂の履歴であり、変えない。

## 2. 変えないもの

- `docs/model-governance/evidence/` の file は証拠として変更しない（各 file の「版管理」節。例: `2026-09-24-owner-ruling-TBD-09.md` の末尾）。旧 field 名は当時の記録として残る。
- field の意味と値（`"const": true`）は変えない。変えるのは名前だけである。
- `redistributionPermitted` は TBD-09 の対象ではない（要求定義 906 行）ため変えない。
- 互換の alias、旧名と新名の併記、移行用の設定、変換 script は作らない（要求にない）。旧 manifest は 3.0.0 の schema では検証に通らない。これは §4 の MODEL の変更として扱う。

## 3. field 名の案（所有者の承認前）

**案であり、所有者の承認前である。** FR-LIC-016(3) の意味、つまり「製品のモデル利用条件（非商用の研究・教育目的）での利用・派生の許可」（要求定義 430 行）を表す名前にする。

| 現在 | 案 | 意味（FR-LIC-016(3)） |
|---|---|---|
| `commercialUseConfirmed` | `productUsePermitted` | 製品のモデル利用条件での利用の許可 |
| `commercialDerivativesPermitted` | `productDerivativesPermitted` | 製品のモデル利用条件での派生の許可 |

- どちらも `"const": true` のまま（schema `$defs.spdxLicense`、`manifest.schema.json:335`〜`:339`、`:382`〜`:386`）。値は権限者の決定に基づき、publisher の確認ではない（FR-LIC-016(3) の前半）ことは変わらない。
- schema の description のうち「Commercial use」と説明している 3 箇所（`manifest.schema.json:338`、`:354`、`:385`）も、名前と同時に「製品のモデル利用条件（非商用の研究・教育目的）での利用・派生の許可であり、権限者の決定で、publisher の確認ではない」という意味に書き換える（名前だけを変えて逆の説明を残さない）。
- 名前から「commercial」を外すのは、製品のモデル利用条件が非商用であり（要求定義 430 行）、旧名が意味と逆に読めるためである（TBD-09 の理由）。
- manifest の `noticeText` の「In this manifest, commercialUseConfirmed and commercialDerivativesPermitted denote permission for that use condition」の文（`resources/models/manifest.json` と、同じ文を転記した採用記録: mobilenet の採用記録 118〜128 行、ssdlite の採用記録 119〜128 行）は、新しい名前に合わせて書き換える。

## 4. schema の版

必須 field の名前を変えると、旧 manifest（2.0.0）は検証に通らなくなる（`$defs.spdxLicense` は `additionalProperties: false`: `manifest.schema.json:301`〜`:306`、datasetLicense の `required`: `:356`〜`:362`）。schema の `schemaVersion` の説明「constraint tightening is a MODEL change」（`manifest.schema.json:17`）と、2.0.0 への改訂の前例（ADR-0004 462 行: 既存の有効なデータを拒否し得る変更は MODEL を上げる）に照らして MODEL の変更にあたるため、**`3.0.0` を案とする**。

## 5. 実装ノード（1 ノード 1 成果物）

graph は [`20260924-1341-TBD09-atg-graph.json`](20260924-1341-TBD09-atg-graph.json)。各ノードの Review file は `work/20260924-1341-TBD09-<ID>-Review.md`（`blocking: 0` の行が完了条件）。`MANIFEST` は `node --test scripts/models/manifest-schema.test.mjs`、`DOCS` は `npm run verify:docs`（npm 12.0.0。残タスク計画 §5）。

| ID | 依存 | 成果物（write set） | 完了条件 |
|---|---|---|---|
| T9-S | なし | `manifest.schema.json`（§3 の description を含む）、`lock:model-manifest` | schema に旧名と「Commercial use」が無い、`"const": "3.0.0"`、Review |
| T9-M | T9-S | `manifest.json`（`noticeText` を含む）、`lock:model-manifest` | manifest に旧名が無い、`"schemaVersion": "3.0.0"`、Review |
| T9-T | T9-M | `manifest-schema.test.mjs`（旧名を拒否する否定 case `rejects the pre-3.0.0 license field names` を含める）、`lock:model-manifest` | `MANIFEST` が exit 0、否定 case の名前がある、Review |
| T9-G | T9-S | ADR-0004 と `docs/model-governance/` の 5 file と `adoption-template.md` と `dependency-policy.md` | 各 file に旧名が無い、`adoption-template.md` と `dependency-policy.md` に「manifest schema `2.0.0`」が無い、`DOCS` と `npm run test:docs` が exit 0、Review |
| T9-R | T9-S | `requirement-definition.md`（TBD-09 の行と FR-LIC-016(3)。要求の変更のため所有者の承認が要る） | 旧名が無い、`DOCS` と `npm run test:docs` が exit 0、Review |
| T9-V | T9-T、T9-G、T9-R | `package.json`、`package-lock.json`、`CHANGELOG.md`、`lock:root-version` | `package.json` の version が決定記録の値と一致、`npm run verify:version` と `npm run test:version` が exit 0、`MANIFEST`、`DOCS`、`npm run test:docs` が exit 0、`work/` と evidence を除いて旧名が無い、CHANGELOG に新しい 2 つの名前がある、Review |

- T9-V の版の値は release 責任者が決める（判断記録の「本判断が意味しないこと」2、CONTRIBUTING「製品バージョンの更新順」）。決定は `work/20260924-1341-TBD09-VersionDecision.md` に `version: <x.y.z>` の 1 行と決定者・日付として記録し、T9-V の入力とする。この記録ができるまで T9-V は起動しない（候補が決まらないため推測しない）。版は npm 12.0.0 の `npm version <決定値> --no-git-tag-version` で `package.json` と `package-lock.json` に反映する。
- 各 verify の旧名の検査は、`git grep` の exit が 1（一致なし）の場合だけを通す（exit 0 の一致と、exit 2 以上の grep の失敗はどちらも失敗にする）。
- `lock:model-manifest` と `lock:root-version` で Gate 2 の終端化 run と直列にする（残タスク計画 §4.2 と TBD-09 の判断記録の根拠の表）。
- ADR-0004 234 行は spike の当時の schema の説明である。旧名を新しい名前に置き換え、3.0.0 で改名したことを括弧で添える（履歴の事実は変えない）。

## 6. 実行の条件

1. 所有者が時期（A / B）と §3 の field 名の案を承認すること（判断記録の「判断」節: 時期は未選択、名前は決めていない）。
2. B7（Gate 2 の終端化 run の `run finish`）より後に実行する（判断記録の「実行の順序」: Gate 2 の終端化 run の後に独立した schema 変更として行う）。
3. 条件がそろうまで、本計画の graph で `run begin` をしない。
