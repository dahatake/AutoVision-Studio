# Gate 2 終端化 run（再実行、Final2）の受入

- 実行 ID: 9750c4b8-3a47-42b0-9bbe-30f4569c9abd
- 状態 DB: work\20260924-1815-Gate2Final2-atg-state\final.sqlite3
- 計画: work/20260924-1815-OwnerRulingExecutionPlan.md §4 F、graph: work/20260924-1815-Gate2Final2-atg-graph.json、契約: work/20260924-1815-Gate2Final2-atg-contract.json（SHA-256 8926dde1d1d5d42f4b7bcaddceeabb90f0babe8b71fc2dcb3d5ebbe5bc5aadbd）
- node の終端: succeeded 5（G2F-00、G2F-01r、G2F-01a1、G2F-01a3、G2F-03）。
- 静止の確認: `node next` → `{"runnable": []}`
- acceptance の command は、契約の `acceptance_command` を一時 `.cmd` に書き、npm 12.0.0 を PATH の先頭に置いて `cmd /d /c` で実行した。

### acceptance の出力（exit 0）

```text
✔ compiles the current manifest schema as JSON Schema draft 2020-12 (2.2119ms)
✔ accepts the actual non-ready manifest with its current approved set (7.5932ms)
✔ the actual manifest references evidence and approval files that exist with the recorded SHA-256 (19.5036ms)
✔ each actual manifest entry matches the values written in its adoption record (20.724ms)
✔ each actual LicenseRef checkpoint notice discloses the FR-LIC-016 risk acceptance (8.1929ms)
✔ accepts a partial synthetic approved set when not ready and unversioned (1.4532ms)
✔ rejects ready=true with an empty models array even with productVersion (0.7681ms)
✔ requires productVersion when ready=true (0.4697ms)
✔ requires a passing assist-quality comparison record when ready=true (0.511ms)
✔ requires the classification assist-quality comparison when ready=true (0.5386ms)
✔ requires the detection assist-quality comparison when ready=true (0.3351ms)
✔ rejects an assist-quality result whose finalQualityNotWorse is false (0.3392ms)
✔ rejects an assist-quality result whose medianAnnotationTimeReduced is false (0.2231ms)
✔ rejects an assist-quality result with a status field outside the passing record (0.2606ms)
✔ rejects an assist-quality result that points at the adoption template (0.2407ms)
✔ does not require assist-quality results while ready=false (0.2895ms)
✔ accepts all four synthetic roles with verified Windows CPU and DirectML (0.2164ms)
✔ accepts reversed model-role and Windows-provider order (0.2489ms)
✔ requires at least four model entries when ready=true (0.2306ms)
✔ requires ready role C6/classification even when four entries remain (0.4915ms)
✔ requires ready role C6/detection even when four entries remain (0.7309ms)
✔ requires ready role C7/classification even when four entries remain (0.3093ms)
✔ requires ready role C7/detection even when four entries remain (0.3971ms)
✔ rejects either missing Windows provider or a missing support array (1.2046ms)
✔ rejects duplicate CPU or duplicate DirectML support entries (1.5567ms)
✔ rejects verified=false for either Windows provider (0.7777ms)
✔ rejects unsupported OS values and the legacy four-entry Windows/macOS matrix (1.3759ms)
✔ rejects CoreML and unrecognized Windows execution providers (1.0093ms)
✔ rejects every tested approval status other than exact Approved (5.7833ms)
✔ rejects unconfirmed commercial use or redistribution in the code license layer (0.6107ms)
✔ rejects unconfirmed commercial use or redistribution in the checkpoint license layer (0.3786ms)
✔ rejects unconfirmed commercial derivative permission for training data (0.3486ms)
✔ rejects either intended-use flag that excludes product production use (0.4371ms)
✔ rejects unresolved or blank license assertions without claiming SPDX validation (3.2709ms)
✔ requires inferenceConfig for both C7 task roles (0.5328ms)
✔ enforces conditional nondeterministic-operation declarations for C7 (1.9132ms)
✔ rejects traversal in source, payload, evidence and adoption paths (2.5743ms)
✔ rejects the adoption template as either an approval record or evidence (1.0303ms)
✔ rejects empty and malformed hashes for model payloads and evidence (1.6551ms)
✔ accepts exact calendar dates including leap days and years 0000 through 0099 (4.4802ms)
✔ rejects impossible calendar dates at every date-formatted property (11.2907ms)
✔ rejects empty, noncanonical and timestamp values at every date property (5.7051ms)
✔ accepts syntactically valid HTTPS URLs at every URI-formatted property (2.1639ms)
✔ rejects malformed HTTPS URLs even when the schema prefix pattern matches (4.5564ms)
✔ rejects non-HTTPS schemes and relative URLs at every URI property (2.186ms)
✔ rejects unsafe or unrecognized serialization formats (1.8148ms)
ℹ tests 46
ℹ suites 0
ℹ pass 46
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 487.6078
npm notice run autovision-studio@0.1.10 verify:docs
npm notice run node scripts/docs/verify-documentation.mjs
Documentation verified (8 required Markdown files, 5 SVG files).
```

### run finish の出力（exit 0）

```text
{"accepted": true}
```

- 注: `accepted: true` は、全 node が終端で acceptance の command が exit 0 だったことを示す。Gate 2 の完了は示さない（Gate 2 は BLOCKED / NOT_COMPLETE）。

acceptance_exit: 0
accepted: true
