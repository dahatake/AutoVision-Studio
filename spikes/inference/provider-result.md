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

- 証拠記録時刻: `2026-09-03T16:44:02Z`
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
最終検証では、保存済み`--self-test` 16ケース、Ruff check / format、Windows Python 3.14 targetとDarwin Python 3.13 targetのstrict Pyright、実Windows probe、`git diff --check` がすべてexit code `0`だった。self-testは24H2下限受理、下限未満build拒否、server product type拒否、macOS 13/arm64/Python 3.13のvalidator、CPU/DML/CoreML profile parser、およびwrong-provider・mixed-event・不正profile拒否を実行する。macOS関連self-testは純粋なvalidator/parser試験であり、native CoreML sessionの実行証拠ではない。

独立再検証でも `uv 0.12.9`、CPython `3.14.7` のlocked環境から同じprobeを実行し、CPU/DMLの実kernel attribution、exact output、provider順序、一時artifact 0を再確認した。`uv lock --check --project ml`もexit code `0`で、再検証前後の`ml/uv.lock` SHA-256は一致した。

証拠を結び付ける SHA-256（2026-09-03 Windows working-tree bytes。text fileは`core.autocrlf=true`によるCRLF）:

| 対象 | SHA-256 |
|---|---|
| `spikes/inference/provider_probe.py` | `9d62bb3d9783ea465653d1d45442e107eccaec654a26eceded0b0bafd91e993f` |
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
- constructor fallback: `enable_fallback=False`
- session run fallback: `disable_fallback()`

入力は `[1.25, -2.0, 3.5, 0.0]` と `[2.75, 5.0, -1.5, -4.0]`、期待 output は `[4.0, 3.0, 2.0, -4.0]` とした。shape、dtype、値を exact 比較した。

## Windows 実測値

### 2026-09-04 current-lock 再検証

exact `uv 0.12.9` の `--frozen --offline` 環境で self-test と実 probe を再実行した。

- self-test: 16 cases、exit 0
- 実 probe: `verdict=PASS`、exit 0
- CPU registered / profiled provider: `CPUExecutionProvider`
- DirectML registered providers: `DmlExecutionProvider`, `CPUExecutionProvider`
- DirectML profiled provider: `DmlExecutionProvider`
- exact output: `[4.0, 3.0, 2.0, -4.0]`
- temporary artifacts remaining: `0`
- probe JSON: 1,448 bytes、SHA-256 `4f8b45e8c0ddc6b7eb79e75f389a470e447beecae95548ab9e5ee1f6052c5c73`（repository外の一時証拠）
- Ruff check / format: exit 0。対象fileを明示した `--show-files` で `provider_probe.py` が解析対象であることを確認
- Pyright: `ml/` から対象fileを明示して 0 errors / 0 warnings
- current `provider_probe.py` SHA-256: `9d62bb3d9783ea465653d1d45442e107eccaec654a26eceded0b0bafd91e993f`
- current `ml/pyproject.toml` SHA-256: `4631204ba6c1f632f92c5273462c92ec1caf15ba15491fd0c03382aaf288f6fe`
- current `ml/uv.lock` SHA-256: `d14d188a0d1f92f34a9436ecc0b2c801bb0375b36619199f846924c112c7e5fc`

2026-09-03節に記録した `ml/uv.lock` hash は当時の証拠値であり、current lock の同一性主張には使用しない。current lock を使用した実 probe が改めて合格したため、Windows CPU / DirectML lane の判定は維持する。macOS の `NOT_RUN` と SPI-08 全体の `PARTIAL` は変更しない。

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

保存済みself-testは正常なCPU/DML/CoreML profile parserに加え、次の敵対例が拒否されることを確認した。

- DML fused 名だが provider が CPU
- CoreML kernel event だが provider が CPU
- DML event と CPU event の混在
- DML fused 規約に一致しない event 名
- CoreML operation が空文字

このため provider の列挙だけではなく、実行 kernel の profile attribution を Windows 合格根拠としている。CoreML parserのself-testは合成profileに対する検証であり、macOS合格根拠には使用していない。

さらに、予期しないsession例外とcleanup失敗が同時発生した場合、cleanup側の例外が元のsession例外を上書きする経路を敵対的レビューで検出した。primary failureがないcleanup失敗だけを`temporary-cleanup`とし、primary failure発生時は`cpu-session` / `directml-session` / `coreml-session`の元例外を保持するよう修正した。この二重失敗経路は最終self-test 16件には含めず、保存されていない件数を最終合格根拠にしない。

Windows 11 24H2未満でも旧probeがPASSし得る欠陥も敵対的レビューで再現した。AutoVision Studioの製品対象OS要件（`docs/requirement-definition.md`）を満たすため、公式release情報で24H2に対応するOS build `26100`を下限にし、workstation product typeだけを許可する環境gateをsession生成前へ追加した。これはONNX Runtime DirectML自体の技術的な最小OS要件を主張するものではない。build `26100`の受理、`26099`の拒否、server product type `3`の拒否をself-testで確認した。

旧probeはWindows専用で、macOSでは無条件の`sys.getwindowsversion()`、Python 3.14、ONNX Runtime 1.24.4、DirectML distribution検査により実行不能だった。敵対的レビューを反映し、現在のprobeはWindowsとDarwinをfail-closedで分岐し、lock済みのmacOS 13+ / arm64 / CPython 3.13 / `onnxruntime==1.23.2` / CoreML+CPU条件を検査する。CoreML sessionでもkernel eventが1件でproviderが`CoreMLExecutionProvider`でなければ失敗するため、CPU実行をCoreML合格へ読み替えない。

## macOS NOT_RUN

native Apple Silicon Mac を使用できないため、macOS arm64 の CPU/CoreML session、output、profile attribution は取得していない。lock metadata、Windows 上の package 調査、または CoreML provider の公式説明を native 実行証拠へ読み替えない。

probe sourceはmacOS locked laneを実行できるplatform分岐へ修正済みである。CoreML profileの実際のkernel名・operation名は推測で固定せず、provider登録順は要求した`CoreMLExecutionProvider`, `CPUExecutionProvider`とのexact一致を要求する。native実行ではさらに1件のkernel event、非空operation、`CoreMLExecutionProvider` attribution、CPUとのexact output一致を要求し、実profileが条件を満たさなければfail-closedする。したがってコード修正はmacOS `NOT_RUN`を`PASS`へ変更しない。

固定revision `v1.23.2` の公式sourceも照合した。`BinaryOpBuilder`はFP32/FP16の`Add`を対象とし、最小opsetは7で、ML ProgramとNeural Networkの両経路に変換処理を持つ。`CoreMLExecutionProvider::GetCapability`はbuilderが対応と判定したnodeからpartitionを作成する。このため本probeのFP32 `Add` / opset 17は静的にはCoreML変換候補である。ただしsource上の対応可否はnative環境でのcompile・execution・profile attributionを証明しないため、macOS判定は`NOT_RUN`のままとする。

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
| https://github.com/microsoft/onnxruntime/blob/v1.23.2/onnxruntime/core/providers/coreml/builders/impl/binary_op_builder.cc | `C65DEF58679D6A56D3C8E91B5A897040B837A0D8D3C5BB8AE9D193E367F2F1D4` | locked版の`Add`、入力dtype、最小opset、CoreML変換経路 |
| https://github.com/microsoft/onnxruntime/blob/v1.23.2/onnxruntime/core/providers/coreml/coreml_execution_provider.cc | `AC109CDBDF7EFBBE2063411FED12FE32678A8602D52D540FDD7BABE6AED4D34A` | locked版のsupported-node partition作成。native実行証拠ではない |
| https://learn.microsoft.com/windows/release-health/windows11-release-information | `C7D0BC2025B917CE73335974294C6E9F1260A0527F6295919E4F2DEA06B349D3` | Windows 11 24H2がOS build 26100系列であること |

ONNX Runtime 8行のhashは各URLに対応するMicrosoft公式GitHub repositoryのraw bytes、Windows release information行はMicrosoft Learn公開HTML bytesから算出した。`main`/`gh-pages`と公開HTMLはいずれも更新され得るため、再取得時にhashが変われば内容差分を再審査する。公式資料にCoreML対応が記載されていても、native macOS実測の代替にはしない。
