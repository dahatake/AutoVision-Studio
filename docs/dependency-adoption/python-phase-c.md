# C0-PYTHON — Phase C Python依存採用記録

| 項目 | 値 |
|---|---|
| 実施日 | 2026-09-03 |
| 対象 | C0-PYTHON |
| C0-PLAN | commit `6780ca274a149a2cce50e443e7fa91ce6700c137` |
| 実行環境 | Windows 11 build 29648、x64、CPython 3.14.7、uv 0.12.9 |
| 対象環境 | Windows x64 / CPython 3.14、macOS arm64 / CPython 3.13 |
| 判定 | **CLOSED（Windows lane）** — Windows実行と両targetのwheel/hash検証は合格。license 6件はC0-REVIEWでowner条件付き承認、native macOS実行はowner指示によりWAIVED / NOT_RUN |

## 1. 採用範囲

| package | 区分 | exact版 | 用途と代替不能理由 |
|---|---|---:|---|
| `onnx` | runtime | 1.22.0 | ONNX modelの構築、検査、保存。TRN-16〜19のexport/parityに必要で、独自serializerを作らない |
| `onnxruntime` | runtime・macOS限定 | 1.23.2 | macOSのCoreML/CPU推論。macOS 13 arm64 wheelを持つ最後の確認済み系列を使用する |
| `onnxruntime-directml` | runtime・Windows限定 | 1.24.4 | WindowsのDirectML/CPU推論。CUDA packageやvendor別runtimeを暗黙導入しない |
| `optuna` | runtime | 4.9.0 | 有限budgetのTPE/pruning。独自hyperparameter schedulerを作らない |
| `torch` | runtime | 2.11.0 | 分類・検出の学習とexport。公式CPU indexだけを選びCUDA/cuDNNを同梱しない |
| `torchvision` | runtime | 0.26.0 | `torch==2.11.0`と公式互換の画像処理・vision機能。別vision frameworkを併用しない |
| `pyinstaller` | dev | 6.22.2 | D-06のOS別onedir worker生成。target OS上でfreezeするためcross-buildはしない |
| `ruff` | dev | 0.16.4 | B-13で設定済みのPython lint。shared code targetをPython 3.13に固定する |
| `pip-audit` | dev | 2.10.1 | `docs/dependency-policy.md` §11のPython lock脆弱性監査を再現可能にする |
| `pytest` | dev | 9.1.1 | B-11から継続するworker unit test runner。版は変更していない |

`uv_build==0.12.9`は既存のbuild backend、uv 0.12.9はlock/sync toolである。C0追加依存と同様にexact指定しているが、build-system requirementはproject runtime dependencyとして`uv.lock`のpackage blockには入らない。release buildではuv自体を0.12.9へ固定し、暗黙の`latest`を使用しない。

## 2. 版選定と一次資料

取得日は全て2026-09-03。release page、固定tag、対象wheel metadata、公式package indexを相互確認した。

| 対象 | 一次資料・採用判断 |
|---|---|
| uv 0.12.9 | [release](https://github.com/astral-sh/uv/releases/tag/0.12.9)、commit `9f928602938ac5cf1cd6b294a725833c16f5720e`、[environment設定](https://docs.astral.sh/uv/concepts/projects/config/#limited-resolution-environments)。`environments`と`required-environments`は`[tool.uv]`に置く |
| PyInstaller 6.22.2 | [release](https://github.com/pyinstaller/pyinstaller/releases/tag/v6.22.2)、commit `19f42e7f13d56cd880a4ced8bb3594875e5227c6`、[changelog](https://raw.githubusercontent.com/pyinstaller/pyinstaller/v6.22.2/doc/CHANGES.rst)、[license全文](https://raw.githubusercontent.com/pyinstaller/pyinstaller/v6.22.2/COPYING.txt)。6.22.2は2026-08-17 release、Python 3.14 supportは6.15.0で追加 |
| PyTorch 2.11.0 | [release](https://github.com/pytorch/pytorch/releases/tag/v2.11.0)、commit `70d99e998b4955e0049d13a98d77ae1b14db1f45`、[CPU wheel index](https://download.pytorch.org/whl/cpu/torch/)。2.12.0〜2.13.0のarm64 wheelは`macosx_14_0`だが、2.11.0は`macosx_11_0`で製品要件macOS 13を維持できる |
| TorchVision 0.26.0 | [release](https://github.com/pytorch/vision/releases/tag/v0.26.0)、commit `336d36e8db990a905498c73933e35231876e28bc`、[CPU wheel index](https://download.pytorch.org/whl/cpu/torchvision/)。公式releaseがtorch 2.11互換を明記。0.27.0以降のarm64 wheelは`macosx_14_0`、0.26.0は`macosx_12_0` |
| Optuna 4.9.0 | [release](https://github.com/optuna/optuna/releases/tag/v4.9.0)、commit `4db42e31c24b200e52595df9d4c00e2cdeefea2b`。2026-06-01 release。deprecated APIを新規実装で使用しない |
| ONNX 1.22.0 | [release](https://github.com/onnx/onnx/releases/tag/v1.22.0)、commit `2bb50465112feca9003e1ed654d77f01ff1415ca`。対象両OSのCPython 3.12 ABI3 wheelを確認 |
| ONNX Runtime 1.23.2 | [release](https://github.com/microsoft/onnxruntime/releases/tag/v1.23.2)、commit `a83fc4d58cb48eb68890dd689f94f28288cf2278`。1.23.2は`macosx_13_0_arm64`、1.24.1〜1.29.0は`macosx_14_0_arm64`のためmacOSだけ1.23.2へ固定 |
| ONNX Runtime DirectML 1.24.4 | [release](https://github.com/microsoft/onnxruntime/releases/tag/v1.24.4)、commit `2d924974ef147392ced8409d36bd6d2e7fcc8a74`、[install matrix](https://onnxruntime.ai/docs/install/)、[DirectML EP](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)。CPython 3.14 win_amd64 wheelを確認。DirectMLはsupportedだがsustained engineeringで、新規feature開発はWindows MLへ移行済み |
| Ruff 0.16.4 | [release](https://github.com/astral-sh/ruff/releases/tag/0.16.4)、commit `11c76bf48fdac06b2f240cba502eda96da4dce77`。2026-08-20 release、Windows x64/macOS arm64 wheelを確認 |
| pip-audit 2.10.1 | [release](https://github.com/pypa/pip-audit/releases/tag/v2.10.1)、commit `8894eb8cee033531a1fbd9f2fb160892531c14e3`。2026-06-11 release、OSV record欠損時のcrash fixを含む |

PyTorch 2.13.0は既知advisoryを修正するが、対象arm64 wheelがmacOS 14以上であり、macOS 13必須要件を黙って変更できない。したがって2.11.0を採用候補としてlockし、advisoryを§7で開示する。これは脆弱性の不存在または例外承認を意味しない。

## 3. Python・OS markerとsource境界

- `requires-python = ">=3.13,!=3.14.1,<3.15"`。TorchVision 0.26.0のwheel metadataが`>=3.10,!=3.14.1`のため3.14.1を除外する。
- `tool.uv.environments`と`tool.uv.required-environments`は次の2組だけである。
  1. CPython / Windows / AMD64 / Python 3.14
  2. CPython / macOS / arm64 / Python 3.13
- top-level `requires-python`はOS markerを持てないため共有rangeを表し、OS/minorの限定は上記2設定とORT direct dependency markerで行う。PyTorch/TorchVisionは両OSで同じbase exact版を使い、uvがWindowsの`+cpu` local versionとmacOS版を環境別blockへ分ける。
- Pyright `pythonVersion`とRuff `target-version`は共通codeの下限である3.13。Windowsで3.14だけを使えたことを理由に3.14構文を共有codeへ入れない。
- default indexは既存承認済み`https://packagefeedproxy.microsoft.io/pypi/simple/`。直接PyPIは使用しない。PyTorch/TorchVisionだけを`https://download.pytorch.org/whl/cpu`へexplicit mappingする。
- proxyはartifactを4つの`ms-feed-*.pkgs.visualstudio.com` hostから返す。lock済みURLとSHA-256以外の取得を承認したとは扱わない。
- Windowsでは`onnxruntime-directml`だけ、macOSでは`onnxruntime`だけを選び、同一環境に複数ORT distributionを入れない。
- runtime download、model download、CUDA index、`onnxruntime-gpu`、nightly、source build fallbackは採用しない。

## 4. lock完全性とtarget wheel

### 4.1 lock集計

| 検査 | 実測 |
|---|---|
| package block | 70（local editable 1、外部69） |
| unique package名 | 68（local 1、外部67）。`torch`と`torchvision`がOS別version blockを各2つ持つ |
| C0差分 | baseline外部6 blockから63 block追加、削除0、version削除・置換0 |
| artifact | 220（sdistとwheelの合計） |
| artifact hash欠落 | 0。全てSHA-256 |
| source block | Microsoft proxy 65、PyTorch CPU index 4、local editable 1 |
| artifact host | `ms-feed-17` 62、`ms-feed-2` 59、`ms-feed-25` 46、`ms-feed-12` 37、`download-r2.pytorch.org` 16 |
| CUDA/NVIDIA/cuDNN package名 | 0 |
| Windows wheel-only展開 | 63 requirements / 63 dist-info、hash-required、exit 0 |
| macOS 13 wheel-only cross-target展開 | 62 requirements / 62 dist-info、hash-required、exit 0。Windows上で展開しただけで実行していない |
| `ml/pyproject.toml` SHA-256 | `4631204BA6C1F632F92C5273462C92EC1CAF15BA15491FD0C03382AAF288F6FE` |
| `ml/uv.lock` canonical Git blob LF bytes SHA-256 | `D14D188A0D1F92F34A9436ECC0B2C801BB0375B36619199F846924C112C7E5FC` |

### 4.2 direct target wheel

| target | package | wheel | SHA-256 |
|---|---|---|---|
| Windows | `onnx` | `onnx-1.22.0-cp312-abi3-win_amd64.whl` | `72ccebab3bac07215c204ce8848d42e78eaaa666badbf72d25cd359b9f269e3a` |
| Windows | `onnxruntime-directml` | `onnxruntime_directml-1.24.4-cp314-cp314-win_amd64.whl` | `51d86bb949488e572b00422f344990a4a81d982416d73b6c0e4ced2bcd423d19` |
| Windows | `optuna` | `optuna-4.9.0-py3-none-any.whl` | `f52f3be6148654850c92a5860d398fd88ec6b2c84ab68d9c3d07dcff02e7afee` |
| Windows | `torch` | `torch-2.11.0+cpu-cp314-cp314-win_amd64.whl` | `7575af4c9f7f7500ed62b1dafeb069aa0ba35b368a5f09793b3976b3d50f4fe4` |
| Windows | `torchvision` | `torchvision-0.26.0+cpu-cp314-cp314-win_amd64.whl` | `93144d0997c51b27996c8305df4d9104efb0d38c9a9b6b05c8bc20ebdf7193b5` |
| Windows | `pip-audit` | `pip_audit-2.10.1-py3-none-any.whl` | `99ef3f600a317c1945f1e89e227ef26e1c2d618429b8bd3fa6f4f7c440c4611a` |
| Windows | `pyinstaller` | `pyinstaller-6.22.2-py3-none-win_amd64.whl` | `9b990fa6bbe143572f06644a984ad0d7aa2e2ccc6929d4916031343a5888e9a7` |
| Windows | `pytest` | `pytest-9.1.1-py3-none-any.whl` | `37a86b45efb9a47a61a36449063e8e18d0cab3161329fc099eb21783169c4f0c` |
| Windows | `ruff` | `ruff-0.16.4-py3-none-win_amd64.whl` | `05d9d27a18c4bcbefada602480ec9e01e0bc949d432e0ced5df77edac195919c` |
| macOS | `onnx` | `onnx-1.22.0-cp312-abi3-macosx_12_0_universal2.whl` | `596fbf0490947533c1c1045ba860851dc9fb77471023dac9a71ba5b42ceab103` |
| macOS | `onnxruntime` | `onnxruntime-1.23.2-cp313-cp313-macosx_13_0_arm64.whl` | `2ff531ad8496281b4297f32b83b01cdd719617e2351ffe0dba5684fb283afa1f` |
| macOS | `optuna` | `optuna-4.9.0-py3-none-any.whl` | `f52f3be6148654850c92a5860d398fd88ec6b2c84ab68d9c3d07dcff02e7afee` |
| macOS | `torch` | `torch-2.11.0-cp313-cp313-macosx_11_0_arm64.whl` | `442ec9dc78592564fdad69cf0beaa9da2f82ab810ccb4f13903869a90bf3f15d` |
| macOS | `torchvision` | `torchvision-0.26.0-cp313-cp313-macosx_12_0_arm64.whl` | `5d63dd43162691258b1b3529b9041bac7d54caa37eae0925f997108268cbf7c4` |
| macOS | `pip-audit` | `pip_audit-2.10.1-py3-none-any.whl` | `99ef3f600a317c1945f1e89e227ef26e1c2d618429b8bd3fa6f4f7c440c4611a` |
| macOS | `pyinstaller` | `pyinstaller-6.22.2-py3-none-macosx_10_13_universal2.whl` | `ebd1b1ca932d7cf25d7366ce691aaf79a5ff9425811ed7328b5116e4471b6d6d` |
| macOS | `pytest` | `pytest-9.1.1-py3-none-any.whl` | `37a86b45efb9a47a61a36449063e8e18d0cab3161329fc099eb21783169c4f0c` |
| macOS | `ruff` | `ruff-0.16.4-py3-none-macosx_11_0_arm64.whl` | `963f83df8e69e575b64d67dd447ebbc917db41a14bf38d4593a4183e7aaa8255` |

対象別requirements inventory SHA-256はWindows `8409f82ee8a8b0ad040d702c00ccaa3fae3859a7229686b1b403d913021020a6`、macOS `c8f2832813be71d2870d7ce099a0058e80caee76e737013405383046019f9dba`。これらは一時検証用にlockから生成したwheel URL+hash一覧であり、repository成果物ではない。

## 5. provider・native payload境界

- Windows wheelは`DirectML.dll`（18,527,776 bytes、SHA-256 `13AF15778E6E587169E5990CE8C51FD9964CA7ECE8000DF2A8B4F6B3FBD5F34A`）、`onnxruntime.dll`、pybind stateを含む。
- Windows CPython 3.14.7で`ort.get_available_providers()`は`DmlExecutionProvider`と`CPUExecutionProvider`を列挙した。memory上のAdd modelをCPU providerで実行し`[2.0, 3.0]`を得た。
- DirectML公式制約はsequential execution、memory pattern無効、同一sessionへのmulti-threaded `Run`禁止、known shape推奨である。SPI-08では採用modelを用いてこの設定とCPU fallbackを実測する。
- macOS公式Python wheelはCoreML EPを含むと公式文書にある。対象wheelにarm64 dylib/pybind stateが存在することは確認したが、Windows上でCoreML providerをloadまたは実行していない。
- provider列挙、DLL存在、CPU smokeは、採用modelでのDirectML/CoreML性能・operator coverage・数値parityの合格を意味しない。SPI-08まではaccelerator利用可否を未判定とする。

## 6. license・NOTICE監査

両target wheelからmetadataとlicense-like fileを抽出した。Windows 63 package、macOS 62 packageの和集合はlockの外部67 unique packageと一致し、共通packageのlicense metadata差は0件だった。各targetでlicense-like fileを同梱しないものは`flatbuffers`と`packageurl-python`だけである。

- 共通58件。
- Windows限定5件: `colorama`、`greenlet`、`onnxruntime-directml`、`pefile`、`pywin32-ctypes`。
- macOS限定4件: `coloredlogs`、`humanfriendly`、`macholib`、`onnxruntime`。
- §6.2の`target`列を集計するとWindows 63件、macOS 62件となり、上記の$58+5=63$、$58+4=62$、$58+5+4=67$と一致する。

抽出手順は、`uv export --locked`の環境markerを対象環境ごとに評価し、lock内の互換wheel URLとSHA-256だけからrequirements inventoryを生成した後、`uv pip install --target <temp> --python-version <minor> --python-platform <target> --no-deps --only-binary :all: --require-hashes`で展開するものである。各`*.dist-info/METADATA`の`License-Expression`、`License`、license classifierと、`LICENSE`/`LICENCE`/`COPYING`/`NOTICE`を含むfileのbyte SHA-256を比較した。`--no-deps`はlock由来inventoryが全transitiveを列挙するためで、依存を除外していない。

- `flatbuffers@25.12.19`: exact tagの公式`LICENSE`はApache-2.0、SHA-256 `CFC7749B96F63BD31C3C42B5C471BF756814053E847C10F3EB003417BC523D30`。
- `packageurl-python@0.17.6`: exact tagの公式`mit.LICENSE`はMIT、SHA-256 `8E442C79545AC0C0A1A2CF0CF213312A45826ACD6CDC6AF223447DD5F708EE5D`。

### 6.1 direct packageのlicense証拠

| package/target | license | license / NOTICE SHA-256 |
|---|---|---|
| `onnx@1.22.0` Windows | Apache-2.0 | `3DDF9BE5C28FE27DAD143A5DC76EEA25222AD1DD68934A047064E56ED2FA40C5` / `62C2C7BB3BE2833F5E2C8A2576AC10666CF26AA09B7B631B55FED77BC7DC91C7` |
| `onnx@1.22.0` macOS | Apache-2.0 | `CFC7749B96F63BD31C3C42B5C471BF756814053E847C10F3EB003417BC523D30` / `4D680FB1F48F07F134C9F7A8D715303B8F5160B5757BC9EEC4CAC783703EA592` |
| `onnxruntime-directml@1.24.4` | MIT | `C250D6278F0B47A6439FB7592B08B58A55EB9F535AA49A1DB63211C3F982B674` / ThirdPartyNotices `FB0AF774B4D7CFFC5B9D046F2AAEADE2F37DF2F80ABF8033C95DFFFCC77A8866` |
| `onnxruntime@1.23.2` | MIT | `2F07C72751AED99790B8A4869CF2311DF85A860B22DED05FA22803587A48922C` / ThirdPartyNotices `E9E90971A8E75A9A8AC0C6412E29C1202D079998389915AA485F46C816C3B4CC` |
| `optuna@4.9.0` | MIT | `C3DF8E8523CF46BE4B366EE7DD11578454B10EA5EC5159E57DF849513AAFE059` / third-party `DBFF6DF3CB59B7FB11DE7E234630E139318EE8CADA55E2F14A24D184C48954A8` |
| `torch@2.11.0+cpu` Windows | BSD-3-Clause | `CF5EC789EA8E9FCABA4766FCDE2D6804312A1295E55B176A31C7A2982EFC6090` / NOTICE `1C3DEC6C0342C7ED9E12AF59B296C7BB1D394AF5CF881DB74191CC8299EFCE5C` |
| `torch@2.11.0` macOS | BSD-3-Clause | `B24FC699FAF5696EACF1BA3404C09F9A90462F41EF27B5D753E75FA9CB2F83B5` / NOTICE `C2CC7BF0CAEC7652C2B460A8A470BEA1677F241E4AB8E431DF34CF17F5A9FEC0` |
| `torchvision@0.26.0+cpu` Windows | BSD-3-Clause | `C06363F9D33627DC5173B13522444CC85FBB4739F63E16D4587D5C0A165B5B1E` |
| `torchvision@0.26.0` macOS | BSD-3-Clause | `6502F676851CFE25F8AF75531DFB32375B7325B73C37E7B43741FA422893E71D` |
| `pip-audit@2.10.1` | Apache-2.0 | `0D542E0C8804E39AA7F37EB00DA5A762149DC682D7829451287E11B938E94594` |
| `pyinstaller@6.22.2` | GPL-2.0-or-later WITH Bootloader-exception、runtime hooks Apache-2.0、isolated module MIT併許諾 | `DCF75FDB959DB1E3B41C0F8505069D2ECE781B5EC6B3D0A4D30975CFC6580245` |
| `pytest@9.1.1` | MIT | `CA836A5F9ECCA3B2F350230FAA20A48FB8B145653B5568D784862DF864706B9B` |
| `ruff@0.16.4` | MIT | `2597D854122B77DDC71971564CA2350A37608575CE324ADC5650A2B2051C8F18` |

### 6.2 全67 package matrix

`§2一致`は`docs/dependency-policy.md` §2に列挙された識別子だけでlicense expressionを構成することを意味する。NOTICE伝播や最終payload確認を省略してよいという意味ではない。

| package | version | target | 区分 | license | policy |
|---|---:|---|---|---|---|
| `alembic` | 1.19.1 | 両OS | transitive | MIT | §2一致 |
| `altgraph` | 0.17.5 | 両OS | transitive | MIT | §2一致 |
| `boolean-py` | 5.0 | 両OS | transitive | BSD-2-Clause | §2一致 |
| `cachecontrol` | 0.14.4 | 両OS | transitive | Apache-2.0 | §2一致 |
| `certifi` | 2026.7.22 | 両OS | transitive | MPL-2.0 | C0条件付き承認 |
| `charset-normalizer` | 3.5.1 | 両OS | transitive | MIT | §2一致 |
| `colorama` | 0.4.6 | Windows | transitive | BSD-3-Clause | §2一致 |
| `coloredlogs` | 15.0.1 | macOS | transitive | MIT | §2一致 |
| `colorlog` | 6.12.0 | 両OS | transitive | MIT | §2一致 |
| `cyclonedx-python-lib` | 11.12.0 | 両OS | transitive | Apache-2.0 | §2一致 |
| `defusedxml` | 0.7.1 | 両OS | transitive | PSF-2.0 | §2一致 |
| `filelock` | 3.32.4 | 両OS | transitive | MIT | §2一致 |
| `flatbuffers` | 25.12.19 | 両OS | transitive | Apache-2.0 | §2一致 |
| `fsspec` | 2026.7.0 | 両OS | transitive | BSD-3-Clause | §2一致 |
| `greenlet` | 3.5.5 | Windows | transitive | MIT AND PSF-2.0 | §2一致 |
| `humanfriendly` | 10.0 | macOS | transitive | MIT | §2一致 |
| `idna` | 3.19 | 両OS | transitive | BSD-3-Clause | §2一致 |
| `iniconfig` | 2.3.0 | 両OS | transitive | MIT | §2一致 |
| `jinja2` | 3.1.6 | 両OS | transitive | BSD-3-Clause | §2一致 |
| `license-expression` | 30.4.4 | 両OS | transitive | Apache-2.0 | §2一致 |
| `macholib` | 1.16.4 | macOS | transitive | MIT | §2一致 |
| `mako` | 1.4.1 | 両OS | transitive | MIT | §2一致 |
| `markdown-it-py` | 4.2.0 | 両OS | transitive | MIT | §2一致 |
| `markupsafe` | 3.0.3 | 両OS | transitive | BSD-3-Clause | §2一致 |
| `mdurl` | 0.1.2 | 両OS | transitive | MIT | §2一致 |
| `ml-dtypes` | 0.6.0 | 両OS | transitive | Apache-2.0 | §2一致 |
| `mpmath` | 1.3.0 | 両OS | transitive | BSD-3-Clause | §2一致 |
| `msgpack` | 1.2.1 | 両OS | transitive | Apache-2.0 | §2一致 |
| `networkx` | 3.6.1 | 両OS | transitive | BSD-3-Clause | §2一致 |
| `numpy` | 2.5.2 | 両OS | transitive | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | C0条件付き承認 |
| `onnx` | 1.22.0 | 両OS | runtime direct | Apache-2.0 | §2一致 |
| `onnxruntime` | 1.23.2 | macOS | runtime direct | MIT | §2一致 |
| `onnxruntime-directml` | 1.24.4 | Windows | runtime direct | MIT | §2一致 |
| `optuna` | 4.9.0 | 両OS | runtime direct | MIT | §2一致 |
| `packageurl-python` | 0.17.6 | 両OS | transitive | MIT | §2一致 |
| `packaging` | 26.3 | 両OS | transitive | Apache-2.0 OR BSD-2-Clause | §2一致 |
| `pefile` | 2024.8.26 | Windows | transitive | MIT | §2一致 |
| `pillow` | 12.3.0 | 両OS | transitive | MIT-CMU | C0条件付き承認 |
| `pip` | 26.2.1 | 両OS | transitive | MIT | §2一致 |
| `pip-api` | 0.0.34 | 両OS | transitive | Apache-2.0 | §2一致 |
| `pip-audit` | 2.10.1 | 両OS | dev direct | Apache-2.0 | §2一致 |
| `pip-requirements-parser` | 32.0.1 | 両OS | transitive | MIT | §2一致 |
| `platformdirs` | 4.11.4 | 両OS | transitive | MIT | §2一致 |
| `pluggy` | 1.6.0 | 両OS | transitive | MIT | §2一致 |
| `protobuf` | 7.36.0 | 両OS | transitive | BSD-3-Clause | §2一致 |
| `py-serializable` | 2.1.0 | 両OS | transitive | Apache-2.0 | §2一致 |
| `pygments` | 2.21.0 | 両OS | transitive | BSD-2-Clause | §2一致 |
| `pyinstaller` | 6.22.2 | 両OS | dev direct | GPL-2.0-or-later WITH Bootloader-exception / Apache-2.0 / MIT | C0条件付き承認 |
| `pyinstaller-hooks-contrib` | 2026.7 | 両OS | transitive | GPL-2.0-or-later（standard）/ Apache-2.0（runtime） | C0条件付き承認 |
| `pyparsing` | 3.3.2 | 両OS | transitive | MIT | §2一致 |
| `pytest` | 9.1.1 | 両OS | dev direct | MIT | §2一致 |
| `pywin32-ctypes` | 0.2.3 | Windows | transitive | BSD-3-Clause | §2一致 |
| `pyyaml` | 6.0.3 | 両OS | transitive | MIT | §2一致 |
| `requests` | 2.34.2 | 両OS | transitive | Apache-2.0 | §2一致 |
| `rich` | 15.0.0 | 両OS | transitive | MIT | §2一致 |
| `ruff` | 0.16.4 | 両OS | dev direct | MIT | §2一致 |
| `setuptools` | 81.0.0 | 両OS | transitive | MIT | §2一致 |
| `sortedcontainers` | 2.4.0 | 両OS | transitive | Apache-2.0 | §2一致 |
| `sqlalchemy` | 2.0.52 | 両OS | transitive | MIT | §2一致 |
| `sympy` | 1.14.0 | 両OS | transitive | BSD-3-Clause | §2一致 |
| `tomli` | 2.4.1 | 両OS | transitive | MIT | §2一致 |
| `tomli-w` | 1.2.0 | 両OS | transitive | MIT | §2一致 |
| `torch` | 2.11.0 | 両OS | runtime direct | BSD-3-Clause | §2一致 |
| `torchvision` | 0.26.0 | 両OS | runtime direct | BSD-3-Clause | §2一致 |
| `tqdm` | 4.70.0 | 両OS | transitive | MPL-2.0 AND MIT | C0条件付き承認 |
| `typing-extensions` | 4.16.0 | 両OS | transitive | PSF-2.0 | §2一致 |
| `urllib3` | 2.7.0 | 両OS | transitive | MIT | §2一致 |

67件中61件は§2の識別子だけで構成され、unknown/空欄は0件だった。次の6件は明示allowlist外であり、自動承認せず、`docs/dependency-adoption/c0-review.md` §4.2でexact version・用途・配布条件を限定してownerが裁定した。

| package | 経路 | 裁定条件・証拠 |
|---|---|---|
| `certifi@2026.7.22` | dev `pip-audit`→`requests` | MPL-2.0。license SHA-256 `E93716DA6B9C0D5A4A1DF60FE695B370F0695603D21F6F83F053E42CFC10CAF7` |
| `numpy@2.5.2` | runtime ONNX/Optuna/TorchVision/ORT | 複合expressionに0BSD/Zlib/CC0-1.0を含む。top license SHA-256 `A804DFF0EAD9FADC5293456410BCBFC32BF024BE9C4513459663FB7B442D2341` |
| `pillow@12.3.0` | runtime TorchVision | MIT-CMU。license SHA-256 `4F7866A74802C6326F81FAFF59A56546B6AEC2B10B91973E0E9308DE95E79857` |
| `pyinstaller@6.22.2` | dev direct、将来bootloaderを生成 | GPL-2.0-or-later。bootloader exceptionはcompiled bootloaderの商用結合・配布を許すが、その他のGPL適用を消さない。`COPYING.txt` hashは上記。§3により法務の個別書面承認が必要 |
| `pyinstaller-hooks-contrib@2026.7` | dev PyInstaller | standard hooks/filesはGPL-2.0-or-later、`_pyinstaller_hooks_contrib/rthooks`はApache-2.0。license SHA-256 `91D0BAAFF00773038E72C0A1FC9D5D2D38706B7A2B9C04F34296608F931B9CD0`。freeze後payloadの実内容もSPI-03/04で照合する |
| `tqdm@4.70.0` | runtime Optuna | MPL-2.0 AND MIT。license SHA-256 `FCFF87C3A47CE8028A8512AA182D4FCF0AD1C90544EE75CF9B343684CAC194DE` |

6件は`c0-review.md` §4.2で **APPROVED_WITH_CONDITIONS** と裁定した。PyInstallerはbuild-onlyかつupstream未改変、bootloader exceptionの対象fileだけを結合物として配布する条件で承認する。MPL対象fileはlicense noticeと対応するSource Code Formの入手手段を配布時に示す。これは一般allowlistの拡張ではなく、条件不履行、version/license/用途変更時は承認を失効する。

## 7. 脆弱性監査

lockの外部67 unique packageをexact requirementsへ変換し、`pip-audit 2.10.1`自身を含めてresolver/installを無効にした監査を実行した。`--no-deps`はlockから全transitiveを列挙済みだからであり、依存を監査対象から除外する指定ではない。artifact hash検証は§4の別検査で行う。

- command: `.venv\Scripts\pip-audit.exe -r <lock由来67件> --no-deps --disable-pip --aliases --desc`
- result: exit 1、`Found 3 known vulnerabilities in 2 packages`。
- High/Critical（GitHub-reviewed severity）: 0。
- ignore/waiver設定: 0。

| package | pip-audit ID / aliases | records | fix | reviewed severity | 影響と裁定 |
|---|---|---:|---|---|---|
| `setuptools@81.0.0` | `PYSEC-2026-3447` / `GHSA-h35f-9h28-mq5c`, `CVE-2026-59890`, `BIT-setuptools-2026-59890` | 2 | 83.0.0 | Moderate 6.1、CVSS 3.1 `AV:L/AC:L/PR:N/UI:R/S:U/C:H/I:L/A:N` | macOS APFS/HFS+でNFC/NFD差により`MANIFEST.in` exclusionを回避しsdistへ意図しないfileを含め得る。同一advisoryが2source recordで返り、2件の別脆弱性とは数えない。PyTorch 2.11.0が`setuptools<82`を要求するため現lock内で83へ更新不能。製品buildでは自社sdistを公開しないが、既知脆弱性として保持する |
| `torch@2.11.0` | `PYSEC-2025-194` / `GHSA-rrmf-rvhw-rf47`, `CVE-2025-3000`, `BIT-pytorch-2025-3000` | 1 | 2.13.0 | Low 1.9、CVSS 4.0 `AV:L/AC:L/AT:N/PR:L/UI:N/VC:L/VI:L/VA:L/SC:N/SI:N/SA:N/E:P` | `torch.jit.script`のmemory corruption。advisory本文の「classified as critical」をGitHub-reviewed severityへ読み替えない。local attack・Low privilege。未承認code/modelをloadしないSEC-05境界を後続実装する |

GitHub advisory取得時点では[setuptools advisory](https://github.com/advisories/GHSA-h35f-9h28-mq5c)はModerate、[PyTorch advisory](https://github.com/advisories/GHSA-rrmf-rvhw-rf47)はLowである。現行policyの停止閾値High以上には達しないが、「脆弱性0」または「安全」とは記録しない。severity、affected range、修正版、利用経路が更新された場合はC0-REVIEW/SEC-08で再判定する。

## 8. install・smoke実測

| 検証 | 結果 |
|---|---|
| Windows clean `uv sync --locked` | CPython 3.14.7、64 installed distributions（local package込み）、exit 0 |
| direct version | manifestの10 direct packageと対象環境のexact版が一致 |
| test | pytest 4 tests、exit 0 |
| Ruff | `ruff check`、exit 0 |
| Pyright | Microsoft公式npm Pyright 1.1.413、strict 0 errors/0 warnings |
| import/CLI | ONNX、ORT、Optuna、Torch、TorchVision、PyInstaller CLI、pip-audit、Ruffをimport/起動、exit 0 |
| runtime smoke | Torch CPU加算、Optuna memory study 1 trial、ONNX checker、ORT CPU Add modelが全て合格 |
| CUDA | `torch 2.11.0+cpu`、CUDA unavailable、CUDA/NVIDIA/cuDNN package 0 |
| DirectML | provider列挙のみ合格。採用model inferenceはSPI-08まで未判定 |
| macOS target metadata | wheel-only/hash-requiredで62件展開、license metadata取得、exit 0 |
| native macOS sync/import/MPS/CoreML/PyInstaller | **WAIVED / NOT_RUN** — native Apple Silicon Mac未提供。owner指示によりC0 blockerから外すが、cross-target展開を実行証拠またはmacOS PASSにしない |

## 9. 調査中に検出した不備と裁定

| ID | 指摘 | 再現 | 裁定・反映 |
|---|---|---|---|
| PR-01 | `required-environments`が`[[tool.uv.index]]`内にあり、project全体のwheel coverage設定として効いていない | 再現。uv公式schemaは`[tool.uv].required-environments`。移動後の`uv lock --check`はstaleとしてexit 1 | 正しいscopeへ移し、uv 0.12.9でrelock。両required targetをwheel-only/hash-requiredで展開して反映を確認 |
| PR-02 | top-level `requires-python`がOSごとの単一minorでない | 再現せず | PEP 621 fieldはOS markerを持てない共有range。2組だけの`environments`/`required-environments`とORT markerがOS/minorを限定する |
| PR-03 | PyTorch/TorchVision direct requirementにOS markerがない | 再現せず | 両OSで同じbase exact版を意図して使用し、explicit CPU indexとrequired targetが限定する。lockはWindows `+cpu`とmacOS版を別blockへ解決済み |
| PR-04 | transitive license記録がない | 初版作成前の不足として再現 | §6.2へ全67件を列挙。unknown 0、policy外6をBLOCKEDにした |
| PR-05 | PyInstallerをSPDX名だけで判断している | 初版作成前の不足として再現 | `COPYING.txt`全文、bootloader exception、runtime hooks、isolated moduleを分離し、法務承認不足をBLOCKEDにした |
| PR-06 | DirectML package/wheel/providerを確認していない | 再現せず | CPython 3.14 wheel/hash、native payload、Windows provider列挙を実測。ただし実model判定をSPI-08へ残した |
| PR-07 | 両OS clean install証拠がない | Windowsは再現せず、macOSは再現 | Windows clean syncは合格。macOS cross-target展開はnative実行の代替にならないためBLOCKEDを維持 |
| PR-08 | `alembic`の由来がunknown | 再現せず | `uv tree --locked`で`optuna→alembic→mako/sqlalchemy/typing-extensions`を確認 |

### 9.1 最終独立敵対的レビュー

初版を別のread-only reviewerと独立したTOML/Markdown parserへ渡し、lock、matrix、hash、license、Windows/macOS境界を再照合した。機械検査は`git diff --check` exit 0、matrix 67 rows / unique 67 / lock外部名との過不足0、要書面裁定6、70 package blocks、220 artifacts、hash欠落0を確認した。

| ID | 指摘 | 再現 | 裁定・反映 |
|---|---|---|---|
| FR-01 | `ms-feed-2`/`25`/`12`の個別host件数が未検証 | 再現せず | URLをTOML parserで個別parseし、59/46/37件を再確認。`ms-feed-17` 62とPyTorch 16を加えた合計220もartifact総数と一致 |
| FR-02 | 220 artifactの一部にhashがない可能性 | 再現せず | 全`sdist` dictと全`wheels` elementを列挙し、220/220が`sha256:`、欠落0 |
| FR-03 | `certifi` license hashのchain of custodyがない | 再現せず。ただし手順の明示性を改善 | hash-requiredで展開した対象wheel内`certifi-2026.7.22.dist-info/licenses/LICENSE`をbyte hashした値。抽出手順を§6へ追記 |
| FR-04 | Windows 63/macOS 62の元package集合が示されていない | matrixから再現可能だが可視性改善を採用 | 共通58、Windows限定5、macOS限定4を§6へ追記。§6.2全行のtarget列が完全inventoryである |
| FR-05 | PyInstaller bootloader exception全文を文書内へ転載すべき | C0要件として再現せず | 要件は採用版の全文確認であり全文転載ではない。固定tag URL、対象wheel内`COPYING.txt` hash、適用file群とexception効果を記録済み。法的解釈は行わず書面承認不足をBLOCKEDに維持 |
| FR-06 | native macOS実行がない | 再現 | 正当にBLOCKED。cross-target wheel展開をnative smokeへ昇格しない |

FR-03/04の証拠手順追記後、独立機械照合の全数値に追加不一致はない。この初版レビュー時点の判定は、技術証拠は **VERIFIED**、C0-PYTHON全体は外部解除条件により **BLOCKED** だった。後続C0-REVIEWでownerのlicense裁定とmacOS waiverを別途記録しており、初版判断を遡及的にPASSへ書き換えない。

### 9.2 レビュー反映後の最終再検証

- `git diff --check`: exit 0。
- `uv lock --check --system-certs`: 反映前後ともexit 0、70 packages。
- `uv sync --locked --system-certs`: exit 0。
- pytest: 4 passed、exit 0。
- Ruff: all checks passed、exit 0。
- Pyright 1.1.413: 0 errors、exit 0。
- health CLI: `{"version":"0.1.0","os":"Windows"}`、exit 0。
- Torch CPU、Optuna 1 trial、ONNX checker、ORT CPU sessionのmemory smoke: exit 0。ORT sessionは明示的に`CPUExecutionProvider`を使用し、native provider一覧にはDML/CPUが含まれた。
- lock由来外部67 unique requirementsのpip-audit JSON: exit 1、3 records / 2 packages。`setuptools`同一ID 2 recordsと`torch` 1 recordは§7と一致。
- 最終`uv.lock` canonical Git blob LF bytes SHA-256: `D14D188A0D1F92F34A9436ECC0B2C801BB0375B36619199F846924C112C7E5FC`で再lock前後不変。

## 10. 判定と解除条件

C0-PYTHONはexact manifest/lock、正しいrequired environment、全artifact SHA-256、両target wheel coverage、Windows clean install/runtime smoke、全67 license identity、lock全体の脆弱性監査まで実証した。policy明示allowlist外6 packageは`c0-review.md` §4.2でowner条件付き承認済みである。

native Apple Silicon検証は`c0-review.md` §6のowner指示により **WAIVED / NOT_RUN** とし、C0 blockerから外す。macOSの適合性を合格扱いせず、macOS固有taskとGateは正本変更がない限り未実施のままとする。

C0-REVIEWの独立敵対レビューはblocking finding 0で完了した。以上によりC0-PYTHONは **CLOSED（Windows lane）** とする。