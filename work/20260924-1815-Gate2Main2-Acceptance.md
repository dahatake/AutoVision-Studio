# Gate 2 主 run（再実行、main2）の受入

- 実行 ID: 0b7a6834-a226-4f48-b87c-5bc31dc2f2cd
- 状態 DB: work\20260924-1815-Gate2Main2-atg-state\main.sqlite3
- 計画: work/20260924-1815-OwnerRulingExecutionPlan.md §4 G、graph: work/20260924-1815-atg-graph-main2.json、契約: work/20260924-1815-atg-contract-main2.json（SHA-256 1a9658245ec2e0cff9dbae843bf1bec29b2af60d825397648b95c25729782548）
- node の終端:
  - succeeded 24。
  - failed 3（contract）:
    - EXT-X1: 原因が確定していないため。
    - G2D-07C / G2D-07D: 所有者の承認が得られていないため。ask_user に利用者が不在で、承認を作らない。
  - blocked 17: 上の failed と、利用者の作業に依存する下流。
- 静止の確認: `node next --limit 50` → `{"runnable": []}`
- acceptance の command:

```text
pwsh -NoLogo -NoProfile -Command "$env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH; if ((npm --version) -ne '12.0.0') { exit 2 }; npm run verify:docs; if ($LASTEXITCODE) { exit $LASTEXITCODE }; node --test scripts/models/manifest-schema.test.mjs; exit $LASTEXITCODE"
```

### acceptance の全出力（exit 0）

```text
npm notice run autovision-studio@0.1.10 verify:docs
npm notice run node scripts/docs/verify-documentation.mjs
Documentation verified (8 required Markdown files, 5 SVG files).
✔ compiles the current manifest schema as JSON Schema draft 2020-12 (2.1996ms)
✔ accepts the actual non-ready manifest with its current approved set (9.0864ms)
✔ the actual manifest references evidence and approval files that exist with the recorded SHA-256 (34.0251ms)
✔ each actual manifest entry matches the values written in its adoption record (20.503ms)
✔ each actual LicenseRef checkpoint notice discloses the FR-LIC-016 risk acceptance (11.5502ms)
✔ accepts a partial synthetic approved set when not ready and unversioned (1.2683ms)
✔ rejects ready=true with an empty models array even with productVersion (0.6543ms)
✔ requires productVersion when ready=true (0.435ms)
✔ requires a passing assist-quality comparison record when ready=true (0.4348ms)
✔ requires the classification assist-quality comparison when ready=true (0.476ms)
✔ requires the detection assist-quality comparison when ready=true (0.323ms)
✔ rejects an assist-quality result whose finalQualityNotWorse is false (0.3058ms)
✔ rejects an assist-quality result whose medianAnnotationTimeReduced is false (0.2541ms)
✔ rejects an assist-quality result with a status field outside the passing record (0.2642ms)
✔ rejects an assist-quality result that points at the adoption template (0.2339ms)
✔ does not require assist-quality results while ready=false (0.2654ms)
✔ accepts all four synthetic roles with verified Windows CPU and DirectML (0.195ms)
✔ accepts reversed model-role and Windows-provider order (0.2499ms)
✔ requires at least four model entries when ready=true (0.2161ms)
✔ requires ready role C6/classification even when four entries remain (0.4152ms)
✔ requires ready role C6/detection even when four entries remain (0.4764ms)
✔ requires ready role C7/classification even when four entries remain (0.3889ms)
✔ requires ready role C7/detection even when four entries remain (1.1575ms)
✔ rejects either missing Windows provider or a missing support array (1.7954ms)
✔ rejects duplicate CPU or duplicate DirectML support entries (0.5312ms)
✔ rejects verified=false for either Windows provider (0.5623ms)
✔ rejects unsupported OS values and the legacy four-entry Windows/macOS matrix (0.9397ms)
✔ rejects CoreML and unrecognized Windows execution providers (0.7ms)
✔ rejects every tested approval status other than exact Approved (2.7814ms)
✔ rejects unconfirmed commercial use or redistribution in the code license layer (0.4127ms)
✔ rejects unconfirmed commercial use or redistribution in the checkpoint license layer (0.3189ms)
✔ rejects unconfirmed commercial derivative permission for training data (0.278ms)
✔ rejects either intended-use flag that excludes product production use (0.3628ms)
✔ rejects unresolved or blank license assertions without claiming SPDX validation (2.7654ms)
✔ requires inferenceConfig for both C7 task roles (0.4639ms)
✔ enforces conditional nondeterministic-operation declarations for C7 (0.8058ms)
✔ rejects traversal in source, payload, evidence and adoption paths (1.0371ms)
✔ rejects the adoption template as either an approval record or evidence (0.3952ms)
✔ rejects empty and malformed hashes for model payloads and evidence (1.7735ms)
✔ accepts exact calendar dates including leap days and years 0000 through 0099 (4.5837ms)
✔ rejects impossible calendar dates at every date-formatted property (7.6015ms)
✔ rejects empty, noncanonical and timestamp values at every date property (5.0644ms)
✔ accepts syntactically valid HTTPS URLs at every URI-formatted property (2.8791ms)
✔ rejects malformed HTTPS URLs even when the schema prefix pattern matches (3.7162ms)
✔ rejects non-HTTPS schemes and relative URLs at every URI property (1.8127ms)
✔ rejects unsafe or unrecognized serialization formats (0.5748ms)
ℹ tests 46
ℹ suites 0
ℹ pass 46
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2465.154
```

### run finish の出力（exit 0）

```text
{"accepted": true}
```

- 注: `accepted: true` は、全 node が終端で acceptance の command が exit 0 だったことを示す。Gate 2 の完了は示さない（failed 3・blocked 17 が残る）。

acceptance_exit: 0
accepted: true
