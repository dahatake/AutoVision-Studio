# GAL run の受入（D4）

- 実行 ID: bbb01912-859a-49b4-8819-4d928913c9da
- 状態 DB: work\20260924-1308-GAL-atg-state\gal.sqlite3
- GAL-V1: `node start` → `node fail --class contract`（出力 `{"retry": false, "reason": "contract_violation"}`）。root version の値は release 責任者が決める（残タスク計画 D4、work/202609240830-RemainTaskExecutionPlan.md:318）ため作業しない。
- acceptance の command（work/20260924-1308-GAL-atg-contract.json の acceptance_command）:

```text
pwsh -NoLogo -NoProfile -Command "$env:PATH = $env:LOCALAPPDATA + '\npm-12.0.0;' + $env:PATH; if ((npm --version) -ne '12.0.0') { exit 2 }; npm run typecheck; if ($LASTEXITCODE) { exit $LASTEXITCODE }; .\node_modules\.bin\vitest.cmd run src/renderer/features/annotations; exit $LASTEXITCODE"
```

## 試行 1

### acceptance の全出力（exit 0）

```text
npm notice run autovision-studio@0.1.10 typecheck
npm notice run tsc -b tsconfig.main.json tsconfig.renderer.json tsconfig.e2e.json

 RUN  v4.1.11 C:/GitHub/AutoVision-Studio


 Test Files  20 passed (20)
      Tests  173 passed (173)
   Start at  14:01:22
   Duration  18.84s (transform 2.14s, setup 48.56s, import 12.76s, tests 18.70s, environment 193.60s)



```

### run finish の出力（exit 0）

```text
{"accepted": true}
```

acceptance_exit: 0
accepted: true
