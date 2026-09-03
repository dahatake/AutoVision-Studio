# SPI-10 Rectangle canvas 実測結果

| 項目 | 値 |
|---|---|
| Task | SPI-10 |
| 対象要求 | NFR-ANN-002（4K画像・100 rectangles・zoom/pan/select/move/resizeのUI応答p95 100 ms以内） |
| 検証計画HEAD | `769cc5b5136951ed4ce028c249a2b0db58213e3b` |
| raw evidence | `build/spi10/benchmark-result.json` |
| raw evidence SHA-256 | `3822D0303192F556DE6933D7DB166E697EA54D515990C7D9BEDE4FD3BDEC05FD`（707,791 bytes） |
| process evidence | `build/spi10/dist/benchmark-process-result-136b4ca6-7497-4ff2-95f5-ef0cb9ca8a52.json`（SHA-256 `A231846C98E1B1FA09DB0B3EEA4CBBB0F1CAF08CF51A34409115DA1CD9553DD8`） |
| run ID | `136b4ca6-7497-4ff2-95f5-ef0cb9ca8a52` |
| 検証期間 | 2026-09-03T16:15:33.424Z〜2026-09-03T16:18:34.949Z |
| Electron測定完了 | 2026-09-03T16:18:33.573Z |
| 判定 | **PASS**（このWindows実測条件におけるSPI-10 PoC） |
| 非対象 | macOS性能保証、production annotation editor、keyboard/screen reader、永続化、実カメラ、モデル推論 |

## 実行環境

- OS: Windows `10.0.29648`、x64
- CPU: 13th Gen Intel(R) Core(TM) i7-13800H、20 logical CPUs
- RAM: 68,535,443,456 bytes
- Display: 1920×1280、60 Hz、scale factor 1.25
- capture: 960×540 DIPを物理1200×675、3,240,000-byte BGRA bitmapとして取得
- Electron: 44.0.0
- Chromium: 152.0.7977.54
- Electron内蔵Node.js: 24.18.1
- launcher/build Node.js: 24.19.0（`node.exe` SHA-256 `3602F2BB1A10F2CBAB4C36886218A33C1AB3DB87290E73B033C46C77147D0237`）
- npm: exact 12.0.0、lifecycle `verify:spi10` / `node build/spi10/run.mjs`
- PowerShell: 7.6.5 Core
- Konva / React / react-konva: 10.3.2 / 19.2.8 / 19.2.5
- 測定時状態: BrowserWindow、webContents、Renderer documentがfocused、documentは`visible`
- Renderer diagnostics: 0件
- Electron runtime profile: run専用のignored一時directoryへ分離
- 同一Electron実体の起動前process: 0、exit後process: 0、強制cleanup: 0

## 測定対象と方法

- 表示中のElectron `BrowserWindow`内に960×540のKonva Stageを配置した。
- 3840×2160のin-memory RGBA bitmapを背景layerへ実描画し、annotation layerへ100 rectanglesを配置した。
- Electron Mainから`webContents.sendInputEvent`でmouse/wheel入力を送り、`CanvasSpike`の実handlerを通した。
- 操作ごとにwarm-up 10回の後、100サンプルを測定した。各サンプル前に100 rectanglesへresetし、select/move/resizeは100個を1回ずつ対象にした。
- 入力欠落を避けるためdragのstart/middle入力後にRendererを2 animation framesずつsettleした。判定timerとbaseline captureは、判定対象となる最後の有効入力の直前に設定した。
- createは最終`mouseUp`、selectは`mouseUp`、move/resize/panは最終座標`mouseMove`、zoomは`mouseWheel`を応答起点とした。
- paint境界は応答入力またはReact/Konva commit後の2回目の`requestAnimationFrame`、presentation境界はその後の`webContents.capturePage`完了とした。
- drag系はpresentation capture後に`mouseUp`を送り、最終stateのbox/viewport変化と全boxのfinite・4K画像内境界を別途検証した。
- 応答入力直前のbaselineは同一bitmapを2回連続取得して安定を確認した。応答後はbaselineと異なる同一bitmapを2回連続取得し、最初のchanged capture完了を判定値、2回目を安定確認の補助値とした。
- 全600サンプルでbitmap SHA-256とKonva visual-state SHA-256の両方が変化し、最終stateと表示nodeの対象geometry/viewportが一致した。中間入力による既存変化を最終入力の変化として誤認しない。
- 判定metricは`responsiveInputToCapturedPresentation.p95Ms`、閾値は100 msである。
- p95は100値を昇順にし、`ceil(100 × 0.95) - 1`の要素を採用した。空、負値、NaN、Infinityは集計を失敗させる。
- `npm@12.0.0 run verify:spi10`からunit、strict typecheck、構文、Vite build、diff check、Electron benchmark、process cleanup、source/bundle再hash、atomic renameを直列実行した。run UUIDとexclusive lockで別runのartifact混入を拒否する。

60 Hz表示で測定したanimation-frame間隔はmean 16.383 ms、p95 16.800 ms、max 16.900 msだった。

## 実測結果

| 操作 | 応答起点 | paint p95 (ms) | capture mean (ms) | capture p95 (ms) | capture max (ms) | stable-confirm p95 (ms) | pixel / visual proof | 判定 |
|---|---|---:|---:|---:|---:|---:|---:|---|
| create | `mouseUp` | 23.442 | 50.774 | 61.039 | 82.526 | 109.192 | 100 / 100 | PASS |
| select | `mouseUp` | 28.969 | 48.107 | 53.454 | 63.640 | 104.003 | 100 / 100 | PASS |
| move | final-coordinate `mouseMove` | 27.227 | 48.054 | 59.246 | 84.772 | 108.682 | 100 / 100 | PASS |
| resize | final-coordinate `mouseMove` | 23.171 | 47.821 | 59.539 | 61.955 | 108.222 | 100 / 100 | PASS |
| zoom | `mouseWheel` | 49.682 | 59.491 | 71.756 | 85.058 | 120.840 | 100 / 100 | PASS |
| pan | final-coordinate `mouseMove` | 22.775 | 51.599 | 61.463 | 62.681 | 108.723 | 100 / 100 | PASS |

全6操作の判定対象capture p95は100 ms以内だった。stable-confirm p95は2回目の同一changed captureまでを含む補助値で、全操作が100 msを超えた事実も表へ明記した。5 metric×6操作のraw件数、finite/non-negative、mean/p95/maxを独立再計算し、保存summaryと一致した。

### Gesture全体の補助値

| 操作 | gesture開始→capture p95 (ms) |
|---|---:|
| create | 225.453 |
| select | 154.374 |
| move | 189.754 |
| resize | 172.069 |
| zoom | 139.274 |
| pan | 173.293 |

この補助値には、drag startから判定入力までの入力配送保証用2-frame settleを複数回含む。NFR-ANN-002の応答判定には使わないが、100 msを超える事実を隠していない。

## 敵対probe

同じ実Electron run内で通常測定前に次を実行し、raw evidenceへ保存した。

| Probe | 結果 |
|---|---|
| 右ボタンによる無効create | 明示reject後にreset成功。pending interaction残留なし |
| create/panのmouseUp endpoint | 両操作で最終pointer位置をmouseUp時に反映 |
| rectangle上からmiddle-button pan | viewport変化、box geometry不変 |
| Transformer handle上からmiddle-button pan | viewport変化、box geometry不変 |

## 実装した境界

- createは画像との交差部分だけを採用し、画像と交差しないdrag、4 image px未満、重複ID、非finite座標を拒否する。
- move/resizeはzoom/pan後もKonva absolute座標を画像座標へ変換してclampする。
- Transformerはstrokeを境界計算から除外し、最小サイズ未満のtransformはnodeをstate値へ復元する。
- Shift+dragまたは中ボタンdrag、およびShift+wheelでpanする。pan開始時はRect drag/Transformerを停止してstate geometryへ復元し、終了・leave・touch cancelで操作状態を解除する。
- benchmark interactionは1件5秒、Renderer call/captureは10秒、frame測定は30秒、入力benchmarkは600秒、app/load/GPU情報は各30秒、Electron subprocessは15分でtimeoutする。全processを覆う単一600秒timeoutとは主張しない。
- 成功時は`app.quit()`の`quit` event内でprocess evidenceを確定する。失敗時はrun固有error JSONを書いて非zero exitし、launcherがprocess tree終了を外部確認する。launcher失敗時は追跡対象のfinal resultを削除してstale PASSを残さない。
- launcherはNode/npm/PowerShell/Git/Electron実体をbyte lengthとSHA-256で記録し、package-lockの前後hash、bundle/sourceの再hash、lock ownershipを確認後、一時JSONをflushしてatomic renameする。

## 検証結果

| 検証 | 実行内容と実結果 |
|---|---|
| npm lifecycle | npm 12.0.0の`verify:spi10`から起動し、`npm_execpath`、event、script、Node実体を相互検証、PASS |
| SPI-10 unit tests | lock済みVitest 4.1.11、1 file / 9 tests PASS |
| SPI-10専用TypeScript strict check | TypeScript 7.0.2、`--ignoreConfig --strict --moduleResolution Bundler`、PASS |
| Main / launcher syntax | Node.js 24.19.0 `--check`、双方PASS |
| Vite production build | Vite 7.3.6、99 modules、524,397-byte JS bundle、PASS |
| Electron benchmark | 170,092 ms、exit 0、6 operations × 100 samples、全pixel/visual proof変化、全敵対probe PASS、Renderer diagnostics 0 |
| Lifecycle / cleanup | `quit-event-0`後にprocess evidence確定、同一Electron実体の起動前/終了後process 0、強制cleanup 0 |
| Raw evidence独立再計算 | 359 checks PASS。5 metrics × 6 operations、600 capture proofs、attempt範囲、adversarial result、DPI-aware bitmap寸法を再検証 |
| Source integrity | 実測時Windows working-tree bytesの12 source SHA-256が現行fileと一致し、Renderer埋込7 build-source SHA-256も一致。`core.autocrlf=true`によるCRLF→LF正規化後は12/12がstage済みGit blobと一致し、意味差分0 |
| Bundle integrity | JS SHA-256 `5A461DF05F662ED2A1B0B16238AEF37F3D3ACA7D9DF29274A987C2E7060E072B`、index SHA-256 `77668921EB45E9E206D013A2DABA2B11409C98EB3487A252B6ABC612E1B55519`が一致 |
| Lock integrity | package-lock SHA-256 `7F1BD82EFE1E4919DCE6DDFFDB763CEFF4404D29B60E8E946A150345A8DFE1A5`がlauncher前後・source evidenceで一致 |
| Final evidence | run ID一致、707,791 bytes、SHA-256 `3822D0303192F556DE6933D7DB166E697EA54D515990C7D9BEDE4FD3BDEC05FD`、一時file/lockなし |
| Editor diagnostics | 0件 |
| `git diff --check` | PASS |

Viteは500 kB超のPoC bundle warningを出した。SPI-10のproduction bundle size採否は対象外であり、warningを隠す設定変更は行っていない。

## 一次資料（2026-09-03取得）

| 公式資料 | 取得時raw MDX SHA-256 | 適用 |
|---|---|---|
| https://konvajs.org/docs/select_and_transform/Basic_demo.html | `4CD007480CB2667ADF19EF6C3AFAFA84345CC32E83E588A2A30B109715B9B73E` | Transformer scaleのwidth/height反映 |
| https://konvajs.org/docs/sandbox/Limited_Drag_And_Resize.html | `22AA5D4B2FBC77B6A4D3CDD7707D743092999F47C74F5FEA8B6C72D5E1D25040` | drag/resize境界制約 |
| https://konvajs.org/docs/performance/All_Performance_Tips.html | `E5F8082AD300CDB7134FF8D558E250CE3820A569C0E5CEB635E93A298C2FC6AA` | 描画量、layer、listening、drag cost |
| https://konvajs.org/docs/sandbox/Canvas_Scrolling.html | `0FDA0D63FF7187A35368993B95524ED904BB2F042DFBB85B8DF581CF7F639EEE` | 小さいStageの位置変更による大画像pan |
| https://konvajs.org/docs/performance/Batch_Draw.html | `DA0462FF95B48942F0E34285C9B46AC0D60654502086893B23BC887B6657DC55` | auto drawとanimation-frame境界 |

hashはGitHubのKonva公式repository `master` raw MDXを同日に取得したバイト列からSHA-256で算出した。mutable branchのため、再取得時にhashが異なれば差分を再審査する。

## 敵対的レビューと反映

次の実在する問題をレビューまたは実行で再現し、同task内で修正した。

1. `result.md`と実Chromium p95が存在しなかった。
2. panが未実装・未計測だった。
3. 旧benchmarkが実component/input handler/presentationを測っていなかった。
4. Windows `loadFile` path、段階別timeout、異常時cleanupが不正・不足した。
5. panとRect drag/Transformerが競合した。
6. paint待機promiseが再render/unmountで誤決着し得た。
7. create warm-upが100 rectangles条件を維持しなかった。
8. classic JSXで`React is not defined`を実測した。
9. DOMRectがElectron境界越しに`{}`となりready検証に失敗した。
10. input event同期連投でmoveが欠落した。
11. zoom後のabsolute drag/Transformer boxを画像座標として扱った。
12. 画像外createと負/過小resizeを有効boxへ変換した。
13. 無効create/cancel時にpending interactionが残った。
14. 判定timerをfinal drag描画後に開始し、応答を過小計上した。
15. baseline captureがgesture開始前で、最終入力の画面変化を因果的に証明しなかった。
16. Transformer strokeがresize境界をずらし、拒否時node/stateが乖離した。
17. pan入口ごとのgeometry排他・復元が不統一だった。
18. harnessが正本の成果物範囲外だったため、計画変更`cd4c1ab`でB-10依存、test-only harness、raw evidence、pan/input-to-capture条件を先に明記した。
19. unit/type/build/benchmark/終了確認を単一launcherへ束ねる計画変更`769cc5b`を先行commitし、run UUID、exclusive lock、toolchain/process evidence、atomic finalizationを追加した。
20. `npm exec -- node`がNode.js実体ではなくregistryの`node` package導入を要求した。promptで拒否し、package script `npm run verify:spi10`へ変更してexact npm lifecycleを検証した。
21. viewport一致検証が同値の`{scale,x,y}`と`{x,y,scale}`を`JSON.stringify`で比較し、キー順序だけで偽FAILになった。保存した実値で同値を確認し、`x/y/scale`のフィールド比較へ修正した。
22. 独立監査の初回だけ、960×540 DIPを物理解像度と誤認した。保存済みdisplay scale 1.25とcapture値から1200×675・3,240,000 bytesが正しいと確認し、DPI-aware検証へ修正した。raw evidence本体は変更していない。

修正後にexact npm 12 launcherから9 unit tests、専用strict typecheck、両Node構文、Vite build、実Electron benchmark、4敵対probe、quit後process確認を完走した。さらに359項目の独立統計/hash/proof監査を行い、ブロッキング所見0を確認した。敵対的レビューは **CLOSED**、SPI-10は **VERIFIED** とする。
