# Playwright — E2E 試験基盤の C1 採用記録（W3-01）

| 項目 | 内容 |
|---|---|
| 調査・記録日 | 2026-09-22（JST） |
| 対象タスク | W3-01（[タスク実行プラン](../../work/20260921-1330-TaskExecutionPlan.md) Wave 3） |
| 方針判断 | 実行プラン Q-03 = A（Playwright を採用）のデフォルト適用。外部法務意見・出荷承認ではない |
| 区分 | **C1（TypeScript/Node パッケージ）・devDependency のみ**。最終 payload へ同梱しない |
| ライセンス | Apache-2.0（直接・推移ともに全件）。[依存ポリシー](../dependency-policy.md) §2 の原則許可に一致するため、package 固有の書面裁定（§2.1）は不要 |
| 完了判定 | **W3-01 完了**。exact lock 固定・推移依存全件の license 確認・脆弱性 0 件・`npm ci` exit 0 を実測で確認した |

> **免責**: 本文書は技術・運用記録であり法的助言ではない。Apache-2.0 の NOTICE 伝播確認は §4 に記録する。

---

## 1. 採用の必要性（なぜ新規依存が必要か）

- Wave 3 の W3-02〜W3-07 は、**packaging 前の Electron アプリを実際に起動し、Main / Preload / Renderer / SQLite を通した縦スライス**（Project → Import → Annotation → Revision → Queued）を検証する。JSDOM 単体試験は Renderer のみを対象とし、実 IPC・実 DB・実 window を通らないため Gate 3 の証拠にならない。
- 既存資産だけでは不足する。[`tests/manual/ui-shell-probe.mjs`](../../tests/manual/ui-shell-probe.mjs) は Electron main process 内で `webContents.sendInputEvent` を直接呼ぶ**一回限りの目視補助 probe** であり、test runner・retry 隔離・失敗時の trace／screenshot・profile 隔離の再利用機構を持たない。これらを自作すると実行プラン Q-03 の選択肢 B（独自 harness）に相当し、過剰実装となる。
- Playwright は `_electron.launch()` により **packaging 前の Electron 実行ファイル＋ビルド済み `dist/main/index.js`** を直接起動でき、`app.evaluate()` で main process、`firstWindow()` で Renderer をそれぞれ操作できる。これは本 repository の「製品コードに test 専用の分岐を追加しない」制約（W3-02 DoD）を満たす唯一の既製手段である。
- **採用範囲は devDependency 1 件（`@playwright/test`）だけ**。browser（Chromium / Firefox / WebKit）の download・利用・同梱はしない（§3）。

## 2. 版と取得元の固定

| package | 区分 | version | resolved（lock 記録どおり） | integrity（lock 記録どおり） |
|---|---|---|---|---|
| `@playwright/test` | 直接・dev | `1.63.0` | `https://ms-feed-25.pkgs.visualstudio.com/1es-public/_packaging/npm-public/npm/registry/@playwright/test/-/test-1.63.0.tgz` | `sha1-gIAgxG6La5H51ijNDry7Mr39i2w=` |
| `playwright` | 推移・dev | `1.63.0` | `.../playwright/-/playwright-1.63.0.tgz` | `sha1-mbVvn2mxtwxE8Av4Sy/lI0iuJRE=` |
| `playwright-core` | 推移・dev | `1.63.0` | `.../playwright-core/-/playwright-core-1.63.0.tgz` | `sha1-5XZlvDKEbCE6w5oeTVvGIo52s3Y=` |

- `package.json` の `devDependencies` に **`"@playwright/test": "1.63.0"`** を範囲指定子なし（exact）で記録した。`^` `~` `latest` `next` を使わない。
- `integrity` の hash 種別は **registry proxy（`.npmrc` の `registry=https://packagefeedproxy.microsoft.io/npm/`）が返した値をそのまま記録**したものであり、本記録で別 hash へ書き換えていない。これは既存 lock 内の全 entry と同じ形式である。
- 版の選定理由: 記録日時点の `npm view @playwright/test version` が `1.63.0`（最新安定版）であり、pre-release tag（`-alpha` / `-beta` / `-next`）ではない。
- **推移依存はこの 2 件だけ**である。実測: `npm ls @playwright/test playwright playwright-core` の出力は単線 `@playwright/test@1.63.0 → playwright@1.63.0 → playwright-core@1.63.0`。`fsevents` 等の optional dependency は lock に現れない（Windows x64 対象の本 repository で追加取得は発生しない）。

## 3. install script と browser download の扱い

- `.npmrc` に `strict-allow-scripts=true` があり、`package.json` の `allowScripts` に列挙した package だけが install script を実行できる。
- 3 package とも **install script を宣言していない**。実測: 各 `node_modules/<pkg>/package.json` の `scripts` は `playwright` / `playwright-core` が `none`、`@playwright/test` が空。lock の各 entry にも `hasInstallScript` は無い。
- したがって **`allowScripts` への追記は不要**であり、本採用では行っていない。browser binary の download は発生しない。
- **`npx playwright install` は実行しない**。Electron 試験は `_electron.launch()` が repository 内の `node_modules/electron`（既存採用済み `electron@44.0.0`）を使うため、Playwright 同梱 browser を必要としない。将来 browser が必要になった場合は、本記録とは別の C3（ネイティブバイナリ）審査を要する。

## 4. ライセンス確認

| package | SPDX | LICENSE file | SHA-256（原 bytes） | byteSize |
|---|---|---|---|---|
| `@playwright/test@1.63.0` | Apache-2.0 | `LICENSE` | `45873d00a0dd243596deb4aa23b2493b3d1f0671921bf2538ea431d7380220eb` | 11601 |
| `playwright@1.63.0` | Apache-2.0 | `LICENSE` | 同上（同一本文） | 11601 |
| `playwright-core@1.63.0` | Apache-2.0 | `LICENSE` | 同上（同一本文） | 11601 |

- 3 件とも [依存ポリシー](../dependency-policy.md) §2 の原則許可ライセンス（Apache-2.0）であり、`unknown` / 空欄 / `NOASSERTION` は 1 件も無い。lock の `license` field も全件 `"Apache-2.0"` である。
- Apache-2.0 の特許条項・改変条件は確認した。**本 3 package は devDependency であり最終 payload へ同梱しない**ため、`THIRD_PARTY_NOTICES` への収載義務は発生しない。同梱有無が変われば本記録は失効し、再審査を要する。
- 3 package の LICENSE 本文は byte 単位で同一であった（同一 upstream repository 由来）。NOTICE ファイルは 3 package いずれにも存在しない。

## 5. 脆弱性

- 実測: `npm audit --omit=optional` → **`found 0 vulnerabilities`**（記録日、上記 lock 状態）。
- これは記録日時点の advisory database に基づく結果であり、将来の脆弱性が無いことの保証ではない。[脆弱性ポリシー](../security-vulnerability-policy.md) の定期再評価対象に含める。

## 6. lock と再現性の検証

- 実測コマンドと結果は [Gate 3 判定記録](../implementation-plan.md)（§15.11）に転記する。本節は採用時点の確認である。
  - `npm install --save-exact --save-dev @playwright/test@1.63.0` → `added 3 packages, and audited 444 packages` / `found 0 vulnerabilities`
  - `npm ci` → exit 0（W3-01 DoD）
- **採用に伴う設定追加（source の振る舞いは変えない）**
  - `playwright.config.ts`: `testDir` を `tests/e2e`、`workers: 1`、`retries: 0`、`forbidOnly: true`。retry を許すと再現しない合格が Gate 3 の証拠になるため 0 に固定する。
  - `package.json` の `scripts.test:e2e`: `playwright test`。既存の `test` script（`vitest run` 等）は変更しない。`vitest.config.ts` の `include` は `src/**/*.test.{ts,tsx}` のままであり、E2E が単体試験実行へ混入しない。
  - `tsconfig.e2e.json` と `tsconfig.json` の references、`scripts.typecheck` への追加: E2E の TypeScript を型検査対象に含める。Playwright は実行時に transpile するだけで型検査しないため、これが無いと E2E 側の型崩れを検知できない。実測: `npm run typecheck` exit 0。
- **実行環境に関する記録（重要）**: 本 repository の `package.json` は `devEngines.packageManager` に `npm@12.0.x`（`onFail: error`）を指定している。記録日の作業端末の既定 npm は `11.17.0` であり、そのままでは `npm` を用いる全 script が `EBADDEVENGINES` で失敗する。本作業では **`package.json` の engines 宣言を変更せず**、`npm@12.0.0` を作業用の一時領域へ導入して PATH 優先で使用した。engines 宣言の緩和・削除は行っていない。

## 7. 本記録が扱わないこと

- 製品 payload への同梱、SBOM への収載、出荷判断。
- browser binary（Chromium / Firefox / WebKit）の採用。§3 のとおり取得しない。
- `@playwright/test` の version 更新方針。更新時は §2 の表と §4 / §5 を再実測して本記録を改訂する。
