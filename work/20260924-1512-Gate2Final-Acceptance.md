# Gate 2 終端化 run の受入（B7）

- 実行 ID: 2ac91e5d-b355-4080-b88c-a040b7514b86
- 状態 DB: work\20260924-1425-Gate2Final-atg-state\final.sqlite3
- 静止の確認: `node next --limit 10` → `{"runnable": []}`。
- acceptance の command（work/20260924-1425-Gate2Final-atg-contract.json の acceptance_command）:

```text
pwsh -NoLogo -NoProfile -Command "pwsh -NoLogo -NoProfile -File work/20260924-1425-Gate2-TerminalState-check.ps1; if ($LASTEXITCODE) { exit $LASTEXITCODE }; node --test scripts/models/manifest-schema.test.mjs; if ($LASTEXITCODE) { exit $LASTEXITCODE }; if (-not (Test-Path work/20260924-1425-Gate2-RemainTaskExecution.md)) { exit 1 }; if ((npm --version) -ne '12.0.0') { exit 2 }; npm run verify:docs; if ($LASTEXITCODE) { exit $LASTEXITCODE }"
```

- 実行環境: command は npm を選ばず、版だけを検査する。このため、実行した shell では `$env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH` を先に設定し、npm `12.0.0` を PATH の先頭に置いた（npm `11.17.0` のままでは `exit 2` になる）。

## 試行 1

### acceptance の全出力（exit 0）

```text
✔ compiles the current manifest schema as JSON Schema draft 2020-12 (3.5598ms)
✔ accepts the actual non-ready manifest with its current approved set (9.7269ms)
✔ the actual manifest references evidence and approval files that exist with the recorded SHA-256 (22.5322ms)
✔ each actual manifest entry matches the values written in its adoption record (30.8201ms)
✔ each actual LicenseRef checkpoint notice discloses the FR-LIC-016 risk acceptance (6.006ms)
✔ accepts a partial synthetic approved set when not ready and unversioned (1.974ms)
✔ rejects ready=true with an empty models array even with productVersion (1.0567ms)
✔ requires productVersion when ready=true (0.7605ms)
✔ requires a passing assist-quality comparison record when ready=true (0.9326ms)
✔ requires the classification assist-quality comparison when ready=true (0.8761ms)
✔ requires the detection assist-quality comparison when ready=true (0.2811ms)
✔ rejects an assist-quality result whose finalQualityNotWorse is false (0.2951ms)
✔ rejects an assist-quality result whose medianAnnotationTimeReduced is false (0.5244ms)
✔ rejects an assist-quality result with a status field outside the passing record (0.5064ms)
✔ rejects an assist-quality result that points at the adoption template (0.4363ms)
✔ does not require assist-quality results while ready=false (0.5178ms)
✔ accepts all four synthetic roles with verified Windows CPU and DirectML (0.374ms)
✔ accepts reversed model-role and Windows-provider order (0.5696ms)
✔ requires at least four model entries when ready=true (0.503ms)
✔ requires ready role C6/classification even when four entries remain (0.8623ms)
✔ requires ready role C6/detection even when four entries remain (1.1261ms)
✔ requires ready role C7/classification even when four entries remain (0.6928ms)
✔ requires ready role C7/detection even when four entries remain (0.9805ms)
✔ rejects either missing Windows provider or a missing support array (1.6083ms)
✔ rejects duplicate CPU or duplicate DirectML support entries (1.2458ms)
✔ rejects verified=false for either Windows provider (1.035ms)
✔ rejects unsupported OS values and the legacy four-entry Windows/macOS matrix (2.447ms)
✔ rejects CoreML and unrecognized Windows execution providers (1.9411ms)
✔ rejects every tested approval status other than exact Approved (6.5657ms)
✔ rejects unconfirmed commercial use or redistribution in the code license layer (1.0781ms)
✔ rejects unconfirmed commercial use or redistribution in the checkpoint license layer (0.9014ms)
✔ rejects unconfirmed commercial derivative permission for training data (0.65ms)
✔ rejects either intended-use flag that excludes product production use (0.7957ms)
✔ rejects unresolved or blank license assertions without claiming SPDX validation (4.2346ms)
✔ requires inferenceConfig for both C7 task roles (1.0531ms)
✔ enforces conditional nondeterministic-operation declarations for C7 (2.397ms)
✔ rejects traversal in source, payload, evidence and adoption paths (2.5255ms)
✔ rejects the adoption template as either an approval record or evidence (0.6707ms)
✔ rejects empty and malformed hashes for model payloads and evidence (3.3619ms)
✔ accepts exact calendar dates including leap days and years 0000 through 0099 (4.3092ms)
✔ rejects impossible calendar dates at every date-formatted property (8.8528ms)
✔ rejects empty, noncanonical and timestamp values at every date property (5.6162ms)
✔ accepts syntactically valid HTTPS URLs at every URI-formatted property (2.6209ms)
✔ rejects malformed HTTPS URLs even when the schema prefix pattern matches (5.4676ms)
✔ rejects non-HTTPS schemes and relative URLs at every URI property (1.9125ms)
✔ rejects unsafe or unrecognized serialization formats (0.6582ms)
ℹ tests 46
ℹ suites 0
ℹ pass 46
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 568.6089
npm notice run autovision-studio@0.1.10 verify:docs
npm notice run node scripts/docs/verify-documentation.mjs
Documentation verified (8 required Markdown files, 5 SVG files).
```

### run finish の出力（exit 0）

```text
{"accepted": true}
```

- 注: `accepted` は受入 command の exit、evidence file の存在、全 node の終端で決まる（tools/atg/vendor/atg/cli.py:466-474）。終端化 run の 5 node（G2F-00、G2F-01r、G2F-01a1、G2F-01a3、G2F-03）はすべて succeeded。これは Gate 2 の成功ではなく、Gate 2 の判定は BLOCKED である（work/20260924-1425-Gate2-TerminalState.md）。

acceptance_exit: 0
accepted: true
