# -*- mode: python ; coding: utf-8 -*-
"""SPI-03 Windows onedir probe; PKG-02 will replace the generated probe entry."""

from pathlib import Path


project_root = Path(SPECPATH).parent
source_root = project_root / "src"
generated_root = project_root / "build" / "spi03-generated"
generated_root.mkdir(parents=True, exist_ok=True)
probe_entry = generated_root / "worker_probe.py"
probe_entry.write_text(
    r'''from __future__ import annotations

import json
import sys
import tempfile
from importlib import metadata
from pathlib import Path

from autovision_ml.cli import main as worker_main


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def make_add_model() -> bytes:
    import onnx
    from onnx import TensorProto, helper

    left = helper.make_tensor_value_info("left", TensorProto.FLOAT, [2])
    right = helper.make_tensor_value_info("right", TensorProto.FLOAT, [2])
    output = helper.make_tensor_value_info("output", TensorProto.FLOAT, [2])
    graph = helper.make_graph(
        [helper.make_node("Add", ["left", "right"], ["output"])],
        "spi03-add",
        [left, right],
        [output],
    )
    model = helper.make_model(
        graph,
        producer_name="autovision-spi03",
        opset_imports=[helper.make_operatorsetid("", 17)],
    )
    model.ir_version = 10
    onnx.checker.check_model(model)
    return model.SerializeToString()


def run_session(model: bytes, providers: list[str], *, profile: bool = False) -> tuple[list[float], list[str]]:
    import numpy as np
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.enable_mem_pattern = False
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    profile_directory: tempfile.TemporaryDirectory[str] | None = None
    if profile:
        profile_directory = tempfile.TemporaryDirectory(prefix="autovision-spi03-")
        options.enable_profiling = True
        options.profile_file_prefix = str(Path(profile_directory.name) / "ort-profile")

    try:
        session = ort.InferenceSession(model, sess_options=options, providers=providers)
        values = {
            "left": np.asarray([1.0, 2.0], dtype=np.float32),
            "right": np.asarray([3.0, 4.0], dtype=np.float32),
        }
        output = session.run(["output"], values)[0]
        require(output.tolist() == [4.0, 6.0], "ONNX Runtime Add output mismatch")

        profiled_providers: list[str] = []
        if profile:
            profile_path = Path(session.end_profiling())
            events = json.loads(profile_path.read_text(encoding="utf-8"))
            profiled_providers = sorted(
                {
                    provider
                    for event in events
                    if isinstance(event, dict)
                    for provider in [event.get("args", {}).get("provider")]
                    if isinstance(provider, str)
                }
            )
        return output.tolist(), profiled_providers
    finally:
        if profile_directory is not None:
            profile_directory.cleanup()


def run_probe() -> int:
    import onnx
    import onnxruntime as ort
    import optuna
    import torch
    import torchvision

    torch_output = (torch.tensor([1, 2], device="cpu") + torch.tensor([3, 4], device="cpu")).tolist()
    require(torch_output == [4, 6], "Torch CPU output mismatch")

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(direction="minimize", sampler=optuna.samplers.RandomSampler(seed=7))
    study.optimize(lambda trial: float(trial.suggest_int("fixed", 1, 1) - 1), n_trials=1)
    require(len(study.trials) == 1 and study.best_value == 0.0, "Optuna memory study failed")

    model = make_add_model()
    cpu_output, _ = run_session(model, ["CPUExecutionProvider"])
    available_providers = ort.get_available_providers()

    dml_result: dict[str, object] = {"available": "DmlExecutionProvider" in available_providers}
    if dml_result["available"]:
        dml_output, profiled_providers = run_session(
            model,
            ["DmlExecutionProvider", "CPUExecutionProvider"],
            profile=True,
        )
        require("DmlExecutionProvider" in profiled_providers, "DML did not execute the Add node")
        dml_result.update(
            {
                "output": dml_output,
                "profiledProviders": profiled_providers,
            }
        )

    result = {
        "status": "ok",
        "frozen": bool(getattr(sys, "frozen", False)),
        "versions": {
            "autovision-ml": metadata.version("autovision-ml"),
            "onnx": onnx.__version__,
            "onnxruntime": ort.__version__,
            "optuna": optuna.__version__,
            "torch": torch.__version__,
            "torchvision": torchvision.__version__,
        },
        "torchCpuOutput": torch_output,
        "optunaTrials": len(study.trials),
        "onnxChecked": True,
        "ortCpuOutput": cpu_output,
        "ortAvailableProviders": available_providers,
        "ortDml": dml_result,
        "torchCudaAvailable": torch.cuda.is_available(),
        "torchCudaVersion": torch.version.cuda,
    }
    print(json.dumps(result, separators=(",", ":")), flush=True)
    return 0


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: autovision-worker.exe {health|probe}", file=sys.stderr)
        return 2
    if sys.argv[1] == "health":
        return worker_main(["health"])
    if sys.argv[1] == "probe":
        return run_probe()
    print("unsupported command", file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ImportError, OSError, RuntimeError, ValueError) as error:
        print(f"SPI-03 runtime probe failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1) from error
''',
    encoding="utf-8",
)

analysis = Analysis(
    [str(probe_entry)],
    pathex=[str(source_root)],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(analysis.pure)

executable = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="autovision-worker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

bundle = COLLECT(
    executable,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="autovision-worker",
)
