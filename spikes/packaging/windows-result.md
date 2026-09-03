# SPI-03 Windows Python onedir PoC Result

## Scope and verdict

- PyInstaller `onedir` build and current-host Python-isolated execution: **VERIFIED**
- Clean Windows with Python not installed: **NOT_RUN / BLOCKED**
- Windows DirectML execution: **VERIFIED**
- CUDA execution: **NOT_APPLICABLE**（locked `torch` is CPU-only; no CUDA payload）
- C0 license payload conditions: **NOT_SATISFIED**（release blocker remains）
- SPI-03 overall: **PARTIAL**
- Gate 1: **unresolved**

The bundle successfully imports and executes PyTorch, TorchVision, Optuna, ONNX, ONNX Runtime CPU, and ONNX Runtime DirectML without using a host Python path. This does not satisfy the canonical clean-Windows condition: Windows Sandbox launched, but its configured logon command did not run and produced no bootstrap marker or result file in two attempts. No clean-host success is claimed.

## Environment

```text
OS=Microsoft Windows 11 Pro Insider Preview 10.0.29648 build 29648
ARCH=AMD64
CPU=13th Gen Intel(R) Core(TM) i7-13800H
GPU=Intel(R) Iris(R) Xe Graphics DRIVER=32.0.101.6737
GPU=NVIDIA GeForce RTX 4060 Laptop GPU DRIVER=32.0.16.1062
PowerShell=7.6.5 Core
Python=3.14.7
PyInstaller=6.22.2
```

The frozen-process environment retained only normal Windows identity/temp variables, `SystemRoot`/`WINDIR`, and a `PATH` containing the onedir bundle, its `_internal` directory, and Windows `System32`. It did not contain the project virtual environment or a host Python directory. `PYTHONNOUSERSITE=1` was set. The process working directory and user-local directories were temporary directories outside the repository.

## Build

The final clean build used the locked environment and `ml/packaging/worker-windows.spec`.

```text
BUILD_EXIT=0
BUILD_ELAPSED_MS=431298.333
BUNDLE_FILES=2500
BUNDLE_BYTES=529582875
EXE_BYTES=47876808
EXE_SHA256=6AB6EA979E494D0C76874A4FD9C546F4263EE53DFAD534617644DA31EC66361D
SORTED_INVENTORY_SHA256=43834E942483E007FE11D46C9E4EE084C20CCBD73A7172FADB3AD3E1F722C69D
```

`SORTED_INVENTORY_SHA256` is the SHA-256 of the UTF-8, LF-separated, ordinally sorted relative file-name list. Build output under `ml/build/` and `ml/dist/` is ignored and is not committed.

## Frozen runtime results

Times below are process start through process exit on the current host. “Cold” is the first invocation after the clean build; “warm” is a later invocation. They are observations, not release startup guarantees.

| Run | Exit | Elapsed ms | stderr bytes |
|---|---:|---:|---:|
| `health` cold | 0 | 9863.839 | 0 |
| `probe` cold | 0 | 18274.694 | 0 |
| `health` warm | 0 | 1531.560 | 0 |
| `probe` warm | 0 | 11514.928 | 0 |

Health output:

```json
{"version":"0.1.0","os":"Windows"}
```

Probe output:

```json
{"status":"ok","frozen":true,"versions":{"autovision-ml":"0.1.0","onnx":"1.22.0","onnxruntime":"1.24.4","optuna":"4.9.0","torch":"2.11.0+cpu","torchvision":"0.26.0+cpu"},"torchCpuOutput":[4,6],"optunaTrials":1,"onnxChecked":true,"ortCpuOutput":[4.0,6.0],"ortAvailableProviders":["DmlExecutionProvider","CPUExecutionProvider"],"ortDml":{"available":true,"output":[4.0,6.0],"profiledProviders":["DmlExecutionProvider"]},"torchCudaAvailable":false,"torchCudaVersion":null}
```

DirectML availability alone was not treated as execution evidence. The probe enabled ONNX Runtime profiling and required an `Add` node event whose provider was `DmlExecutionProvider`; the recorded `profiledProviders` value proves that the tested node executed through DirectML. CPU execution was separately forced with `CPUExecutionProvider`.

All four runs exited normally, emitted no stderr, and left zero `autovision-worker.exe` processes. Unsupported CLI input failed closed:

```text
NOARG_EXIT=2
NOARG_STDOUT_BYTES=0
NOARG_STDERR=usage: autovision-worker.exe {health|probe}
UNSUPPORTED_EXIT=2
UNSUPPORTED_STDOUT_BYTES=0
UNSUPPORTED_STDERR=unsupported command
REMAINING=0
```

## Clean-host attempt

Windows Sandbox was available at `C:\Windows\System32\WindowsSandbox.exe`. The attempted configuration disabled networking and mapped these inputs read-only:

- the frozen onedir bundle;
- PowerShell 7.6.5;
- a harness whose only fixed-host bootstrap action was starting `pwsh.exe -NoLogo -NoProfile`.

Only the result directory was writable. Host Python, the repository, and the virtual environment were not mapped. The harness would have recorded `Get-Command python, python3, py`, environment details, four run results, and remaining processes before shutting down.

Attempt 1 returned launcher exit code 0 but produced no result. Attempt 2 also produced neither the result nor the first `bootstrap-entered` marker within five minutes. Therefore there is no evidence that the Sandbox logon command executed, and no inference is made about worker behavior inside Sandbox. A separate clean Windows VM or repaired Sandbox automation is required to change this item from `NOT_RUN / BLOCKED`.

## PE inventory

The onedir bundle contains 93 PE/native-extension files totaling 481,376,678 bytes: 2 `.exe`, 30 `.dll`, and 61 `.pyd` files.

```text
_internal/_asyncio.pyd
_internal/_bz2.pyd
_internal/_ctypes.pyd
_internal/_decimal.pyd
_internal/_elementtree.pyd
_internal/_hashlib.pyd
_internal/_lzma.pyd
_internal/_multiprocessing.pyd
_internal/_overlapped.pyd
_internal/_queue.pyd
_internal/_socket.pyd
_internal/_sqlite3.pyd
_internal/_ssl.pyd
_internal/_uuid.pyd
_internal/_wmi.pyd
_internal/_zoneinfo.pyd
_internal/_zstd.pyd
_internal/charset_normalizer/cd.cp314-win_amd64.pyd
_internal/charset_normalizer/md.cp314-win_amd64.pyd
_internal/google/_upb/_message.pyd
_internal/greenlet/_greenlet.cp314-win_amd64.pyd
_internal/libcrypto-3.dll
_internal/libffi-8.dll
_internal/libssl-3.dll
_internal/markupsafe/_speedups.cp314-win_amd64.pyd
_internal/ml_dtypes/_ml_dtypes_ext.cp314-win_amd64.pyd
_internal/MSVCP140_1.dll
_internal/msvcp140.dll
_internal/numpy.libs/libscipy_openblas64_-327b2e0bcffce2882e0dc04cdeb4eaa6.dll
_internal/numpy.libs/msvcp140-a4c2229bdc2a2a630acdc095b4d86008.dll
_internal/numpy/_core/_multiarray_tests.cp314-win_amd64.pyd
_internal/numpy/_core/_multiarray_umath.cp314-win_amd64.pyd
_internal/numpy/fft/_pocketfft_umath.cp314-win_amd64.pyd
_internal/numpy/linalg/_umath_linalg.cp314-win_amd64.pyd
_internal/numpy/random/_bounded_integers.cp314-win_amd64.pyd
_internal/numpy/random/_common.cp314-win_amd64.pyd
_internal/numpy/random/_generator.cp314-win_amd64.pyd
_internal/numpy/random/_mt19937.cp314-win_amd64.pyd
_internal/numpy/random/_pcg64.cp314-win_amd64.pyd
_internal/numpy/random/_philox.cp314-win_amd64.pyd
_internal/numpy/random/_sfc64.cp314-win_amd64.pyd
_internal/numpy/random/bit_generator.cp314-win_amd64.pyd
_internal/numpy/random/mtrand.cp314-win_amd64.pyd
_internal/onnx/onnx_cpp2py_export.pyd
_internal/onnxruntime/capi/DirectML.dll
_internal/onnxruntime/capi/onnxruntime_providers_shared.dll
_internal/onnxruntime/capi/onnxruntime_pybind11_state.pyd
_internal/onnxruntime/capi/onnxruntime.dll
_internal/PIL/_avif.cp314-win_amd64.pyd
_internal/PIL/_imaging.cp314-win_amd64.pyd
_internal/PIL/_imagingcms.cp314-win_amd64.pyd
_internal/PIL/_imagingft.cp314-win_amd64.pyd
_internal/PIL/_imagingmath.cp314-win_amd64.pyd
_internal/PIL/_imagingtk.cp314-win_amd64.pyd
_internal/PIL/_webp.cp314-win_amd64.pyd
_internal/pyexpat.pyd
_internal/python3.dll
_internal/python314.dll
_internal/select.pyd
_internal/sqlalchemy/cyextension/collections.cp314-win_amd64.pyd
_internal/sqlalchemy/cyextension/immutabledict.cp314-win_amd64.pyd
_internal/sqlalchemy/cyextension/processors.cp314-win_amd64.pyd
_internal/sqlalchemy/cyextension/resultproxy.cp314-win_amd64.pyd
_internal/sqlalchemy/cyextension/util.cp314-win_amd64.pyd
_internal/sqlite3.dll
_internal/tomli/__init__.cp314-win_amd64.pyd
_internal/tomli/_parser.cp314-win_amd64.pyd
_internal/tomli/_re.cp314-win_amd64.pyd
_internal/tomli/_types.cp314-win_amd64.pyd
_internal/torch/_C.cp314-win_amd64.pyd
_internal/torch/bin/protoc.exe
_internal/torch/lib/c10.dll
_internal/torch/lib/libiomp5md.dll
_internal/torch/lib/libiompstubs5md.dll
_internal/torch/lib/shm.dll
_internal/torch/lib/torch_cpu.dll
_internal/torch/lib/torch_global_deps.dll
_internal/torch/lib/torch_python.dll
_internal/torch/lib/torch.dll
_internal/torch/lib/uv.dll
_internal/torchvision/_C.pyd
_internal/torchvision/image.pyd
_internal/torchvision/jpeg8.dll
_internal/torchvision/libpng16.dll
_internal/torchvision/libsharpyuv.dll
_internal/torchvision/libwebp.dll
_internal/torchvision/python314.dll
_internal/torchvision/zlib.dll
_internal/unicodedata.pyd
_internal/vcruntime140_1.dll
_internal/vcruntime140.dll
_internal/yaml/_yaml.cp314-win_amd64.pyd
autovision-worker.exe
```

No CUDA/cuDNN/NVIDIA runtime PE appears in the inventory. The CPU-only Torch result and `torchCudaVersion: null` agree with the payload.

## PyInstaller warning review

`ml/build/spi03/worker-windows/warn-worker-windows.txt` was reviewed after the final build. It primarily lists platform-conditional modules and optional integrations imported by the broad PyTorch, TorchVision, Optuna, ONNX, and ONNX Runtime graphs (for example POSIX modules, Triton/CUDA tooling, plotting, notebook, database, cloud-storage, and testing integrations).

The required paths were not accepted merely because the build completed: health, Torch CPU, Optuna, ONNX checking, ORT CPU, and profiled ORT DirectML execution were all exercised from the frozen executable. Missing optional paths remain out of this PoC's scope and are not represented as supported production commands.

## License payload audit

No path containing `PyInstaller` or `_pyinstaller_hooks_contrib` exists in the collected payload. This supports build-only separation for the PyInstaller package and standard contrib hooks. The bootloader executable remains subject to the PyInstaller Bootloader Exception already recorded by C0.

The bundle contains license-like files for MarkupSafe, NumPy (including bundled components), ONNX, an importlib-metadata copy under setuptools, and tqdm. It does **not** yet contain a consolidated `THIRD_PARTY_NOTICES`, complete runtime SBOM, all runtime copyright/license notices, or the required MPL-2.0 Source Code Form availability notice for tqdm. Therefore C0 §3–§4 payload conditions are not satisfied by this spike bundle. This is fail-closed: it remains a release blocker for LIC-01/Gate 5 and is not hidden by the successful runtime probe.

## Locks and repository scope

```text
package-lock.json SHA-256=7F1BD82EFE1E4919DCE6DDFFDB763CEFF4404D29B60E8E946A150345A8DFE1A5
ml/uv.lock SHA-256=D14D188A0D1F92F34A9436ECC0B2C801BB0375B36619199F846924C112C7E5FC
```

Both locks remained equal to the C0 baseline. SPI-03 changes are limited to:

- `ml/packaging/worker-windows.spec`
- `spikes/packaging/windows-result.md`

The concurrent uncommitted `spikes/annotation/CanvasSpike.tsx` belongs to SPI-10 and is excluded from the SPI-03 commit.

## Adversarial review

An independent read-only review checked the two SPI-03 deliverables against the canonical task, ADR-0003, the C0 review, and the contribution rules. It challenged clean-host wording, DirectML execution proof, generated-probe cleanup, lazy health imports, PyInstaller warnings, numerical and hash consistency, license fail-closed behavior, CLI rejection, and SPI-10 scope separation.

| Finding | Reproduction and disposition |
|---|---|
| Current-host isolation could be mislabeled as clean Windows | Not reproduced. The result is explicitly `PARTIAL`; the clean-host condition is `NOT_RUN / BLOCKED` and Gate 1 remains unresolved. |
| Provider availability could be substituted for execution | Not reproduced. The probe requires a profiled node event attributed to `DmlExecutionProvider`. |
| Missing optional imports could conceal required functionality | Not reproduced for the tested scope. Every required import and operation was exercised from the frozen executable; untested optional integrations are not claimed. |
| CUDA or license gaps could be hidden by runtime success | Not reproduced. CPU-only Torch and absence of CUDA PE files are explicit; incomplete notices remain a fail-closed release blocker. |
| Measurements, inventory, hashes, locks, or task scope could be inconsistent | Not reproduced. The review found the captured values internally consistent and confirmed that SPI-10 remains outside this task commit. |

Blocking findings: **0 within the documented partial scope**. This does not waive or close the external clean-Windows and license-payload blockers.
