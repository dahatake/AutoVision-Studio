# SPI-10 Rectangle canvas 実測結果

| 項目 | 値 |
|---|---|
| Task | SPI-10 |
| 対象要求 | NFR-ANN-002（4K画像・100 rectangles・zoom/pan/select/move/resizeのUI応答p95 100 ms以内） |
| 計画baseline | `cd4c1ab733db90d5aeee3342c8b608f5a76370f8` |
| raw evidence | `build/spi10/benchmark-result.json` |
| run ID | `be1631da-4ec6-437f-844d-85bf3671214f` |
| 実測期間 | 2026-09-03T14:50:16.430Z〜2026-09-03T14:52:14.749Z |
| 判定 | **PASS**（このWindows実測条件におけるSPI-10 PoC） |
| 非対象 | macOS性能保証、production annotation editor、keyboard/screen reader、永続化、実カメラ、モデル推論 |

## 実行環境

- OS: Windows `10.0.29648`、x64
- CPU: 13th Gen Intel(R) Core(TM) i7-13800H、20 logical CPUs
- RAM: 68,535,443,456 bytes
- Display: 1920×1280、60 Hz、scale factor 1.25
- Electron: 44.0.0
- Chromium: 152.0.7977.54
- Electron内蔵Node.js: 24.18.1
- build実行Node.js: 24.19.0
- Konva / React / react-konva: 10.3.2 / 19.2.8 / 19.2.5
- 測定時状態: BrowserWindow、webContents、Renderer documentがfocused、documentは`visible`
- Renderer diagnostics: 0件
- Electron runtime profile: run専用のignored一時directoryへ分離

## 測定対象と方法

- 表示中のElectron `BrowserWindow`内に960×540のKonva Stageを配置した。
- 3840×2160のin-memory RGBA bitmapを背景layerへ実描画し、annotation layerへ100 rectanglesを配置した。
- Electron Mainから`webContents.sendInputEvent`でmouse/wheel入力を送り、`CanvasSpike`の実handlerを通した。
- 操作ごとにwarm-up 10回の後、100サンプルを測定した。各サンプル前に100 rectanglesへresetし、select/move/resizeは100個を1回ずつ対象にした。
- 入力欠落を避けるためdragのstart/middle入力後にRendererを2 animation framesずつsettleした。判定timerとbaseline captureは、判定対象となる最後の有効入力の直前に設定した。
- createは最終`mouseUp`、selectは`mouseUp`、move/resize/panは最終座標`mouseMove`、zoomは`mouseWheel`を応答起点とした。
- paint境界は応答入力またはReact/Konva commit後の2回目の`requestAnimationFrame`、presentation境界はその後の`webContents.capturePage`完了とした。
- drag系はpresentation capture後に`mouseUp`を送り、最終stateのbox/viewport変化と全boxのfinite・4K画像内境界を別途検証した。
- captureは応答入力の直前と直後で比較し、全100サンプルでbitmap SHA-256が変化した。中間入力による既存変化を最終入力の変化として誤認しない。
- 判定metricは`responsiveInputToCapturedPresentation.p95Ms`、閾値は100 msである。
- p95は100値を昇順にし、`ceil(100 × 0.95) - 1`の要素を採用した。空、負値、NaN、Infinityは集計を失敗させる。

60 Hz表示で測定したanimation-frame間隔はmean 16.640 ms、p95 17.000 ms、max 50.000 msだった。50 ms frameを削除していない。

## 実測結果

| 操作 | 応答起点 | mean (ms) | p95 (ms) | max (ms) | capture pixel changes | p95 ≤ 100 ms |
|---|---|---:|---:|---:|---:|---|
| create | `mouseUp` | 47.097 | 51.248 | 54.944 | 100/100 | PASS |
| select | `mouseUp` | 49.861 | 54.953 | 57.107 | 100/100 | PASS |
| move | final-coordinate `mouseMove` | 48.994 | 52.542 | 55.463 | 100/100 | PASS |
| resize | final-coordinate `mouseMove` | 49.729 | 53.785 | 63.848 | 100/100 | PASS |
| zoom | `mouseWheel` | 60.414 | 68.881 | 103.186 | 100/100 | PASS |
| pan | final-coordinate `mouseMove` | 38.046 | 50.588 | 55.706 | 100/100 | PASS |

全6操作の判定p95は100 ms以内だった。zoomには103.186 msの単発maxがあるが、要求判定値はp95であり68.881 msだった。raw配列のmean/p95/maxを独立再計算し、保存summaryと一致した。

### Gesture全体の補助値

| 操作 | gesture開始→capture p95 (ms) |
|---|---:|
| create | 171.316 |
| select | 105.292 |
| move | 138.599 |
| resize | 138.759 |
| zoom | 104.206 |
| pan | 138.738 |

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
- benchmark interactionは1件5秒、Renderer call/captureは10秒、frame測定は30秒、入力benchmarkは600秒、app/load/GPU情報は各30秒でtimeoutする。全processを覆う単一600秒timeoutとは主張しない。
- 成功・失敗経路とも`app.quit()`し、失敗診断はignored `build/spi10/dist/benchmark-error.json`へ保存する。

## 検証結果

| 検証 | 実行内容と実結果 |
|---|---|
| SPI-10 unit tests | lock済みVitest 4.1.11、1 file / 9 tests PASS |
| SPI-10専用TypeScript strict check | TypeScript 7.0.2、`--ignoreConfig --strict --moduleResolution Bundler`、PASS |
| Main syntax | Node.js 24.19.0 `--check`、PASS |
| Vite production build | Vite 7.3.6、99 modules、523,790-byte JS bundle、PASS |
| Electron benchmark | exit 0、6 operations × 100 samples、全capture変化、全敵対probe PASS、Renderer diagnostics 0 |
| Raw evidence独立再計算 | 4 metrics × 6 operationsの件数、finite値、mean/p95/maxが一致 |
| Source integrity | `package.json`、lock、SPI-10 source/config 7件の計9 SHA-256が実ファイルと一致 |
| Bundle integrity | SHA-256 `7C5F9AA6A1A6FE1565D0DAEA029A015CA46BE79C468D6D2AC2E7A861880FDAD6`が一致 |
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

修正後に9 unit tests、専用strict typecheck、Node構文、Vite build、実Electron benchmark、4敵対probe、raw統計/hash再計算を実行した。独立したコードレビューと証拠監査はいずれもブロッキング所見0で、既知指摘の反映と再検証を確認した。敵対的レビューは **CLOSED**、SPI-10は **VERIFIED** とする。
