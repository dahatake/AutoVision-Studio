# Gate 2 主 run の受入（A4）

- 実行 ID: e7c6da3f-8f62-4785-b40e-fab254437a4b
- 状態 DB: work\20260924-0730-Gate2Main-atg-state\main.sqlite3
- 静止の確認: `node next --limit 50` → `{"runnable": []}`。`ATG report` に `running` / `pending` の行なし。
- acceptance の command（work/202609232120-atg-contract-main.json の acceptance_command）:

```text
pwsh -NoLogo -NoProfile -Command "$env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH; if ((npm --version) -ne '12.0.0') { exit 2 }; npm run verify:docs; if ($LASTEXITCODE) { exit $LASTEXITCODE }; node --test scripts/models/manifest-schema.test.mjs; exit $LASTEXITCODE"
```

## 試行 1

### acceptance の全出力（exit 0）

```text
npm notice run autovision-studio@0.1.10 verify:docs
npm notice run node scripts/docs/verify-documentation.mjs
Documentation verified (8 required Markdown files, 5 SVG files).
✔ compiles the current manifest schema as JSON Schema draft 2020-12 (3.8637ms)
✔ accepts the actual non-ready manifest with its current approved set (8.3998ms)
✔ the actual manifest references evidence and approval files that exist with the recorded SHA-256 (26.5633ms)
✔ each actual manifest entry matches the values written in its adoption record (32.1813ms)
✔ each actual LicenseRef checkpoint notice discloses the FR-LIC-016 risk acceptance (6.2103ms)
✔ accepts a partial synthetic approved set when not ready and unversioned (1.8954ms)
✔ rejects ready=true with an empty models array even with productVersion (1.2492ms)
✔ requires productVersion when ready=true (0.9947ms)
✔ requires a passing assist-quality comparison record when ready=true (0.8814ms)
✔ requires the classification assist-quality comparison when ready=true (0.9687ms)
✔ requires the detection assist-quality comparison when ready=true (2.1411ms)
✔ rejects an assist-quality result whose finalQualityNotWorse is false (0.6367ms)
✔ rejects an assist-quality result whose medianAnnotationTimeReduced is false (0.5396ms)
✔ rejects an assist-quality result with a status field outside the passing record (0.6108ms)
✔ rejects an assist-quality result that points at the adoption template (0.6102ms)
✔ does not require assist-quality results while ready=false (0.6462ms)
✔ accepts all four synthetic roles with verified Windows CPU and DirectML (0.5244ms)
✔ accepts reversed model-role and Windows-provider order (0.6009ms)
✔ requires at least four model entries when ready=true (0.5698ms)
✔ requires ready role C6/classification even when four entries remain (0.9454ms)
✔ requires ready role C6/detection even when four entries remain (1.0384ms)
✔ requires ready role C7/classification even when four entries remain (0.6397ms)
✔ requires ready role C7/detection even when four entries remain (0.9322ms)
✔ rejects either missing Windows provider or a missing support array (1.6417ms)
✔ rejects duplicate CPU or duplicate DirectML support entries (0.9515ms)
✔ rejects verified=false for either Windows provider (1.0211ms)
✔ rejects unsupported OS values and the legacy four-entry Windows/macOS matrix (2.2494ms)
✔ rejects CoreML and unrecognized Windows execution providers (1.6975ms)
✔ rejects every tested approval status other than exact Approved (1.9625ms)
✔ rejects unconfirmed commercial use or redistribution in the code license layer (0.53ms)
✔ rejects unconfirmed commercial use or redistribution in the checkpoint license layer (0.3817ms)
✔ rejects unconfirmed commercial derivative permission for training data (0.2779ms)
✔ rejects either intended-use flag that excludes product production use (0.3766ms)
✔ rejects unresolved or blank license assertions without claiming SPDX validation (3.9456ms)
✔ requires inferenceConfig for both C7 task roles (0.4081ms)
✔ enforces conditional nondeterministic-operation declarations for C7 (0.7584ms)
✔ rejects traversal in source, payload, evidence and adoption paths (0.9418ms)
✔ rejects the adoption template as either an approval record or evidence (0.2907ms)
✔ rejects empty and malformed hashes for model payloads and evidence (1.0525ms)
✔ accepts exact calendar dates including leap days and years 0000 through 0099 (3.776ms)
✔ rejects impossible calendar dates at every date-formatted property (7.7542ms)
✔ rejects empty, noncanonical and timestamp values at every date property (3.6613ms)
✔ accepts syntactically valid HTTPS URLs at every URI-formatted property (0.9692ms)
✔ rejects malformed HTTPS URLs even when the schema prefix pattern matches (3.7506ms)
✔ rejects non-HTTPS schemes and relative URLs at every URI property (1.8797ms)
✔ rejects unsafe or unrecognized serialization formats (0.6106ms)
ℹ tests 46
ℹ suites 0
ℹ pass 46
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6862.1115


```

### run finish の出力（exit 0）

```text
{"accepted": true}
```

- 注: `accepted` は受入 command の exit、evidence file の存在、全 node の終端（failed・blocked を含む）で決まる（tools/atg/vendor/atg/cli.py:466-474、tools/atg/vendor/atg/state.py の is_terminal）。主 run には failed と blocked の node があり、Gate 2 の判定は BLOCKED である（B2 以降で記録する）。

acceptance_exit: 0
accepted: true
