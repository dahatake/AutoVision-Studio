# SPI-08 ONNX Runtime provider smoke 実測結果

## 判定

| 対象 | 判定 | 実行証拠 |
|---|---|---|
| Windows x64 / CPUExecutionProvider | **PASS** | 実 session、exact output、profile provider attribution |
| Windows x64 / DmlExecutionProvider | **PASS** | 実 session、exact output、profile provider attribution |
| macOS arm64 / CPUExecutionProvider | **NOT_RUN** | native Apple Silicon Mac が未提供 |
| macOS arm64 / CoreMLExecutionProvider | **NOT_RUN** | native Apple Silicon Mac が未提供 |

**SPI-08 全体: PARTIAL / NOT_FULLY_VERIFIED**。Windows CPU/DirectML の smoke は合格したが、macOS CPU/CoreML は実行していない。Windows の結果を macOS の合格証拠として扱わない。

## Windows 実測環境

- 証拠記録時刻: `2026-09-03T14:41:54Z`
- OS: Windows 11、version `10.0.29648`
- architecture: `AMD64`
- OS build: `29648`（Windows 11 24H2下限build `26100`以上）
- Windows product type: `1`（workstation/client）
- Python: CPython `3.14.7`
- NumPy: `2.5.2`
- ONNX: `1.22.0`
- ONNX Runtime distribution: `onnxruntime-directml==1.24.4`
- available providers（順序を含む）: `DmlExecutionProvider`, `CPUExecutionProvider`

DirectML が使用した GPU adapter 名は、この probe の出力だけでは特定していない。adapter 名や性能値は本結果の主張に含めない。

## 実行方法

依存同期と probe は repository root から lock を変更せずに実行した。

```powershell
uv sync --project ml --locked --system-certs --no-progress
uv run --project ml --locked --system-certs python spikes/inference/provider_probe.py
```

最終 probe の exit code は `0`、構造化結果は `status=ok`、`verdict=PASS` だった。
最終検証では、保存済み`--self-test` 8ケース、Ruff check / format、Pyright、実probe、`git diff --check` がすべてexit code `0`だった。self-testは24H2下限受理、下限未満build拒否、server product type拒否、CPU/DML profile受理、wrong-provider・mixed-event・malformed-DML-profile拒否を実行する。

独立再検証でも `uv 0.12.9`、CPython `3.14.7` のlocked環境から同じprobeを実行し、CPU/DMLの実kernel attribution、exact output、provider順序、一時artifact 0を再確認した。再検証前後の`ml/uv.lock` SHA-256は一致した。

証拠を結び付ける SHA-256:

| 対象 | SHA-256 |
|---|---|
| `spikes/inference/provider_probe.py` | `63e47938fb27447dc2ae7ef96a06f7624b7c336e2f237e6f7cc96587daabcc65` |
| `ml/pyproject.toml` | `4631204ba6c1f632f92c5273462c92ec1caf15ba15491fd0c03382aaf288f6fe` |
| `ml/uv.lock` | `a4b940d02816dbeb7479ef2c885cddec0c6348d5295364e5a9685cc9dbfe9f6f` |

## Probe 条件

- model source: memory 上で生成
- graph: input 2本、`Add` 1 node、output 1本
- logical node name: `spi08_add`
- dtype: FP32
- shape: `[1, 4]`
- opset: `17`
- IR version: `10`
- model SHA-256: `fd0a9f8256f8eda41ee98a84ffd81f9abb54f70cf974515684976961b382a6b8`
- graph optimization: `ORT_DISABLE_ALL`
- execution mode: `ORT_SEQUENTIAL`
- memory pattern: disabled
- constructor fallback: `enable_fallback=0`
- session run fallback: `disable_fallback()`

入力は `[1.25, -2.0, 3.5, 0.0]` と `[2.75, 5.0, -1.5, -4.0]`、期待 output は `[4.0, 3.0, 2.0, -4.0]` とした。shape、dtype、値を exact 比較した。

## Windows 実測値

### CPU session

- requested providers: `CPUExecutionProvider`
- registered providers: `CPUExecutionProvider`
- fallback disabled: `true`
- output: `[4.0, 3.0, 2.0, -4.0]`
- profile kernel events: `1`
- profile provider: `CPUExecutionProvider`

### DirectML session

- requested providers: `DmlExecutionProvider`, `CPUExecutionProvider`
- registered providers（順序を含む）: `DmlExecutionProvider`, `CPUExecutionProvider`
- fallback disabled: `true`
- output: `[4.0, 3.0, 2.0, -4.0]`
- profile kernel events: `1`
- profile provider: `DmlExecutionProvider`

CPU と DirectML の output は一致した。DirectML session の唯一の kernel event は `DmlExecutionProvider` に帰属し、CPU kernel event は存在しなかった。一時 profile directory は終了時に削除され、`temporaryArtifactsRemaining=0` だった。

## Profile 検証と敵対的レビュー

最初の実行は `profile-validation / target-node-event-missing` で fail-closed した。sanitized 診断により、ORT `1.24.4` の実 profile は次の形だった。

- CPU: event `spi08_add_kernel_time`、operation `Add`、provider `CPUExecutionProvider`
- DirectML: event `DmlFusedNode_0_0_kernel_time`、operation `DmlFusedNode_0_0`、provider `DmlExecutionProvider`

DirectML EP が単一 Add node を fused kernel 名へ変換したため、logical node 名だけによる照合は false negative だった。修正後の parser は次をすべて要求する。

1. `Node` category の `*_kernel_time` event がちょうど1件である。
2. CPU session は logical node 名と `Add` operation に一致する。
3. DirectML session は `DmlFusedNode_` 名で、event 名と `op_name` が一致する。
4. event の provider が期待 provider と完全一致する。

保存済みself-testは正常なCPU/DML profileに加え、次の敵対例が拒否されることを確認した。

- DML fused 名だが provider が CPU
- DML event と CPU event の混在
- DML fused 規約に一致しない event 名

このため provider の列挙だけではなく、実行 kernel の profile attribution を Windows 合格根拠としている。

さらに、予期しないsession例外がcleanupの`finally`によって`temporary-cleanup`と誤記録される欠陥を敵対的レビューで検出した。cleanup失敗だけを`temporary-cleanup`とし、元のsession例外は`cpu-session` / `directml-session`を保持するよう修正した。この履歴上の合成例外確認は最終self-test 8件には含めず、保存されていない件数を最終合格根拠にしない。

Windows 11 24H2未満でも旧probeがPASSし得る欠陥も敵対的レビューで再現した。公式release情報の24H2 OS build `26100`を下限にし、workstation product typeだけを許可する環境gateをsession生成前へ追加した。build `26100`の受理、`26099`の拒否、server product type `3`の拒否をself-testで確認した。

## macOS NOT_RUN

native Apple Silicon Mac を使用できないため、macOS arm64 の CPU/CoreML session、output、profile attribution は取得していない。lock metadata、Windows 上の package 調査、または CoreML provider の公式説明を native 実行証拠へ読み替えない。

## 制限事項

- 本結果は生成した単一 FP32 `Add` model の provider smoke であり、採用候補 model の operator coverage、数値 parity、latency、throughput、memory、10 FPS を証明しない。
- DirectML の合格は上記 Windows 実機・固定 package 版での結果に限定する。
- 公式資料はDirectMLをsustained engineeringとし、新機能開発はWinMLへ移行したと記載する。本taskは現在lock済みのDirectML EPを実測するPoCであり、将来のproduction採用を確定しない。
- CPU を DirectML session に第2 providerとして登録したが、profile 上の唯一の kernel は DirectML に帰属した。複数 node modelでの部分的 CPU fallbackは未検証である。
- macOS CPU/CoreML の判定には native Apple Silicon Mac で同等の fail-closed probe を別途実行する必要がある。

## 公式一次資料（2026-09-03取得）

| 資料 | 取得時raw SHA-256 | 本taskで確認した事項 |
|---|---|---|
| https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html | `367EB36449EEFCE87769CFE89EF1ABB09FBA4E7A47C4C8C3BE6B578C7FBB9138` | DirectML要件、memory pattern無効、`ORT_SEQUENTIAL`、sustained engineering |
| https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html | `7A980837887A310D0C46E2EE7C28B56D62CE00AF88846E63CC8F3E15920D6CA5` | macOS packageと`CoreMLExecutionProvider`確認方法。実機結果ではない |
| https://onnxruntime.ai/docs/get-started/with-python.html | `1947F9D523B057D5129894E8E4BB08C5D2413FC2EFD8B8FF4E168D5CAE7CDC35` | 1環境へORT distributionを1つだけ導入する原則、Python session API |
| https://github.com/microsoft/onnxruntime/blob/main/docs/python/api_summary.rst | `5E1C532827A89E2465086ECD807137C2425895A07FCCD4DF05E5761AC5D7947C` | `SessionOptions.enable_profiling`と`InferenceSession`例 |
| https://github.com/microsoft/onnxruntime/blob/main/onnxruntime/python/onnxruntime_inference_collection.py | `3A2BF878C89F14AF57F73C009F988DD03315B2394122D40B3550AD5D28F052B1` | provider list、初期化失敗時fallback、`disable_fallback()`の挙動 |
| https://github.com/microsoft/onnxruntime/blob/main/onnxruntime/core/session/inference_session.cc | `61B65BAF96F34D9C132D97A04D83E91109BEC5887C5BC2988DCF410A6A574FD0` | DML登録時のsequential実行とmemory pattern無効化 |
| https://learn.microsoft.com/windows/release-health/windows11-release-information | `C7D0BC2025B917CE73335974294C6E9F1260A0527F6295919E4F2DEA06B349D3` | Windows 11 24H2がOS build 26100系列であること |

ONNX Runtime 6行のhashは各URLに対応するMicrosoft公式GitHub repositoryのraw bytes、Windows release information行はMicrosoft Learn公開HTML bytesから算出した。`main`/`gh-pages`と公開HTMLはいずれも更新され得るため、再取得時にhashが変われば内容差分を再審査する。公式資料にCoreML対応が記載されていても、native macOS実測の代替にはしない。
