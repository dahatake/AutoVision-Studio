#!/usr/bin/env python3
"""SPI-08 fail-closed ONNX Runtime CPU and DirectML execution probe."""

from __future__ import annotations

import hashlib
import json
import platform
import sys
import tempfile
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path
from typing import TextIO

SCHEMA_VERSION = 1
TASK_ID = "SPI-08"
CPU_PROVIDER = "CPUExecutionProvider"
DML_PROVIDER = "DmlExecutionProvider"
MODEL_NODE_NAME = "spi08_add"
MODEL_SHAPE = (1, 4)
MODEL_OPSET = 17
MODEL_IR_VERSION = 10
PROFILE_KERNEL_SUFFIX = "_kernel_time"
DML_FUSED_NODE_PREFIX = "DmlFusedNode_"
MIN_WINDOWS_11_24H2_BUILD = 26100
WINDOWS_WORKSTATION_PRODUCT_TYPE = 1


class ProbeFailure(RuntimeError):
    """A failure represented only by path-safe, stable identifiers."""

    def __init__(self, stage: str, code: str, cause_type: str | None = None) -> None:
        super().__init__(f"{stage}:{code}")
        self.stage = stage
        self.code = code
        self.cause_type = cause_type


@dataclass(frozen=True)
class SessionResult:
    requested_providers: tuple[str, ...]
    registered_providers: tuple[str, ...]
    output: tuple[float, ...]
    profiled_providers: tuple[str, ...]
    profiled_node_events: int
    profiled_kernel_name: str
    profiled_kernel_operation: str

    def to_json(self) -> dict[str, object]:
        return {
            "requestedProviders": list(self.requested_providers),
            "registeredProviders": list(self.registered_providers),
            "fallbackDisabled": True,
            "output": list(self.output),
            "profile": {
                "logicalNode": MODEL_NODE_NAME,
                "logicalOperation": "Add",
                "kernelEvents": self.profiled_node_events,
                "kernelName": self.profiled_kernel_name,
                "kernelOperation": self.profiled_kernel_operation,
                "providers": list(self.profiled_providers),
            },
        }


def require(condition: bool, stage: str, code: str) -> None:
    if not condition:
        raise ProbeFailure(stage, code)


def validate_windows_environment(
    *,
    system: str,
    architecture: str,
    python_implementation: str,
    python_version: tuple[int, int],
    windows_version: tuple[int, int, int],
    product_type: int,
) -> None:
    stage = "environment-validation"
    require(system == "Windows", stage, "windows-required")
    require(architecture.upper() == "AMD64", stage, "amd64-required")
    require(python_implementation == "CPython", stage, "cpython-required")
    require(python_version == (3, 14), stage, "python-3.14-required")
    major, minor, build = windows_version
    require(
        major == 10 and minor == 0 and build >= MIN_WINDOWS_11_24H2_BUILD,
        stage,
        "windows-11-24h2-required",
    )
    require(
        product_type == WINDOWS_WORKSTATION_PRODUCT_TYPE,
        stage,
        "windows-client-required",
    )


def optional_distribution_version(distribution: str) -> str | None:
    try:
        return metadata.version(distribution)
    except metadata.PackageNotFoundError:
        return None


def make_add_model() -> bytes:
    import onnx
    from onnx import TensorProto, helper

    left = helper.make_tensor_value_info("left", TensorProto.FLOAT, list(MODEL_SHAPE))
    right = helper.make_tensor_value_info("right", TensorProto.FLOAT, list(MODEL_SHAPE))
    output = helper.make_tensor_value_info(
        "output", TensorProto.FLOAT, list(MODEL_SHAPE)
    )
    graph = helper.make_graph(
        [helper.make_node("Add", ["left", "right"], ["output"], name=MODEL_NODE_NAME)],
        "spi08-provider-probe",
        [left, right],
        [output],
    )
    model = helper.make_model(
        graph,
        producer_name="autovision-spi08",
        opset_imports=[helper.make_operatorsetid("", MODEL_OPSET)],
    )
    model.ir_version = MODEL_IR_VERSION
    onnx.checker.check_model(model)
    return model.SerializeToString()


def profiled_node_providers(
    profile: object,
    expected_provider: str,
) -> tuple[tuple[str, ...], int, str, str]:
    stage = "profile-validation"
    if not isinstance(profile, list):
        raise ProbeFailure(stage, "profile-root-not-array")

    kernel_events: list[tuple[str, str, str]] = []
    for event in profile:
        if not isinstance(event, dict) or event.get("cat") != "Node":
            continue
        name = event.get("name")
        arguments = event.get("args")
        if not isinstance(name, str) or not isinstance(arguments, dict):
            continue
        if not name.endswith(PROFILE_KERNEL_SUFFIX):
            continue
        operation = arguments.get("op_name")
        provider = arguments.get("provider")
        if not isinstance(operation, str):
            raise ProbeFailure(stage, "kernel-operation-missing")
        if not isinstance(provider, str):
            raise ProbeFailure(stage, "kernel-provider-missing")
        kernel_events.append((name, operation, provider))

    require(len(kernel_events) == 1, stage, "kernel-event-count-mismatch")
    kernel_name, operation, provider = kernel_events[0]

    if expected_provider == CPU_PROVIDER:
        require(
            kernel_name == f"{MODEL_NODE_NAME}{PROFILE_KERNEL_SUFFIX}",
            stage,
            "cpu-kernel-name-mismatch",
        )
        require(operation == "Add", stage, "cpu-operation-mismatch")
    elif expected_provider == DML_PROVIDER:
        fused_name = kernel_name.removesuffix(PROFILE_KERNEL_SUFFIX)
        require(
            fused_name.startswith(DML_FUSED_NODE_PREFIX),
            stage,
            "directml-kernel-name-mismatch",
        )
        require(operation == fused_name, stage, "directml-operation-mismatch")
    else:
        raise ProbeFailure(stage, "unsupported-expected-provider")

    require(
        provider == expected_provider,
        stage,
        "target-node-provider-mismatch",
    )
    return (provider,), len(kernel_events), kernel_name, operation


def run_session(
    model: bytes,
    requested_providers: tuple[str, ...],
    expected_registered_providers: tuple[str, ...],
    expected_profile_provider: str,
    profile_directory: Path,
) -> SessionResult:
    import numpy as np
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.enable_mem_pattern = False
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    options.enable_profiling = True
    options.profile_file_prefix = str(profile_directory / "ort-profile")
    options.log_severity_level = 3

    profile_directory.mkdir(parents=False, exist_ok=False)
    session = None
    profiling_ended = False
    try:
        session = ort.InferenceSession(
            model,
            sess_options=options,
            providers=list(requested_providers),
            enable_fallback=0,
        )
        session.disable_fallback()
        registered_providers = tuple(session.get_providers())
        require(
            registered_providers == expected_registered_providers,
            "session-configuration",
            "registered-provider-order-mismatch",
        )

        left = np.asarray([[1.25, -2.0, 3.5, 0.0]], dtype=np.float32)
        right = np.asarray([[2.75, 5.0, -1.5, -4.0]], dtype=np.float32)
        expected = np.asarray([[4.0, 3.0, 2.0, -4.0]], dtype=np.float32)
        outputs = session.run(["output"], {"left": left, "right": right})
        require(len(outputs) == 1, "output-validation", "output-count-mismatch")
        output = outputs[0]
        if not isinstance(output, np.ndarray):
            raise ProbeFailure("output-validation", "output-not-array")
        require(
            output.shape == MODEL_SHAPE, "output-validation", "output-shape-mismatch"
        )
        require(
            output.dtype == np.float32, "output-validation", "output-dtype-mismatch"
        )
        require(
            np.array_equal(output, expected),
            "output-validation",
            "output-value-mismatch",
        )

        profile_path = Path(session.end_profiling())
        profiling_ended = True
        require(
            profile_path.parent.resolve() == profile_directory.resolve(),
            "profile-validation",
            "profile-path-outside-temporary-directory",
        )
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        providers, node_event_count, kernel_name, kernel_operation = (
            profiled_node_providers(
                profile,
                expected_profile_provider,
            )
        )
        return SessionResult(
            requested_providers=requested_providers,
            registered_providers=registered_providers,
            output=tuple(float(value) for value in output.reshape(-1)),
            profiled_providers=providers,
            profiled_node_events=node_event_count,
            profiled_kernel_name=kernel_name,
            profiled_kernel_operation=kernel_operation,
        )
    finally:
        if session is not None and not profiling_ended:
            with suppress(Exception):
                session.end_profiling()


def run_probe() -> dict[str, object]:
    stage = "imports"
    try:
        import numpy as np
        import onnx
        import onnxruntime as ort

        stage = "environment-validation"
        windows_version = sys.getwindowsversion()
        validate_windows_environment(
            system=platform.system(),
            architecture=platform.machine(),
            python_implementation=platform.python_implementation(),
            python_version=sys.version_info[:2],
            windows_version=(
                windows_version.major,
                windows_version.minor,
                windows_version.build,
            ),
            product_type=windows_version.product_type,
        )
        require(onnx.__version__ == "1.22.0", stage, "onnx-version-mismatch")
        require(ort.__version__ == "1.24.4", stage, "onnxruntime-version-mismatch")
        require(
            optional_distribution_version("onnxruntime-directml") == "1.24.4",
            stage,
            "directml-distribution-version-mismatch",
        )
        require(
            optional_distribution_version("onnxruntime") is None,
            stage,
            "competing-cpu-distribution-installed",
        )

        available_providers = tuple(ort.get_available_providers())
        require(
            available_providers == (DML_PROVIDER, CPU_PROVIDER),
            stage,
            "available-provider-order-mismatch",
        )
        ort.disable_telemetry_events()

        stage = "model-generation"
        model = make_add_model()
        model_sha256 = hashlib.sha256(model).hexdigest()

        stage = "temporary-files"
        temporary_directory = tempfile.TemporaryDirectory(prefix="autovision-spi08-")
        temporary_root = Path(temporary_directory.name)
        try:
            stage = "cpu-session"
            cpu_result = run_session(
                model,
                (CPU_PROVIDER,),
                (CPU_PROVIDER,),
                CPU_PROVIDER,
                temporary_root / "cpu",
            )

            stage = "directml-session"
            dml_result = run_session(
                model,
                (DML_PROVIDER, CPU_PROVIDER),
                (DML_PROVIDER, CPU_PROVIDER),
                DML_PROVIDER,
                temporary_root / "directml",
            )
        finally:
            try:
                temporary_directory.cleanup()
            except OSError as error:
                raise ProbeFailure(
                    "temporary-cleanup", "unexpected-exception", type(error).__name__
                ) from None

        stage = "temporary-cleanup"
        require(not temporary_root.exists(), stage, "temporary-artifacts-remain")
        require(
            cpu_result.output == dml_result.output,
            "cross-provider-validation",
            "provider-output-mismatch",
        )

        return {
            "schemaVersion": SCHEMA_VERSION,
            "task": TASK_ID,
            "status": "ok",
            "verdict": "PASS",
            "environment": {
                "os": platform.system(),
                "osRelease": platform.release(),
                "osVersion": platform.version(),
                "osBuild": windows_version.build,
                "windowsProductType": windows_version.product_type,
                "architecture": platform.machine(),
                "pythonImplementation": platform.python_implementation(),
                "pythonVersion": platform.python_version(),
            },
            "runtime": {
                "numpy": np.__version__,
                "onnx": onnx.__version__,
                "onnxRuntimeDistribution": "onnxruntime-directml",
                "onnxRuntime": ort.__version__,
            },
            "model": {
                "source": "generated-in-memory",
                "operator": "Add",
                "opset": MODEL_OPSET,
                "irVersion": MODEL_IR_VERSION,
                "dtype": "float32",
                "shape": list(MODEL_SHAPE),
                "sha256": model_sha256,
            },
            "availableProviders": list(available_providers),
            "sessions": {
                "cpu": cpu_result.to_json(),
                "directml": dml_result.to_json(),
            },
            "crossProviderOutputEqual": True,
            "temporaryArtifactsRemaining": 0,
        }
    except ProbeFailure:
        raise
    # Keep unexpected dependency/runtime failures path-safe at the probe boundary.
    except Exception as error:  # noqa: BLE001
        raise ProbeFailure(
            stage, "unexpected-exception", type(error).__name__
        ) from None


def profile_event(name: str, operation: str, provider: str) -> dict[str, object]:
    return {
        "cat": "Node",
        "name": name,
        "args": {"op_name": operation, "provider": provider},
    }


def expect_probe_failure(
    action: Callable[[], object],
    expected_stage: str,
    expected_code: str,
) -> None:
    try:
        action()
    except ProbeFailure as error:
        if (error.stage, error.code) != (expected_stage, expected_code):
            raise AssertionError(
                f"expected {expected_stage}:{expected_code}, got {error.stage}:{error.code}"
            ) from error
    else:
        raise AssertionError(f"expected {expected_stage}:{expected_code}")


def run_self_tests() -> dict[str, object]:
    valid_environment = {
        "system": "Windows",
        "architecture": "AMD64",
        "python_implementation": "CPython",
        "python_version": (3, 14),
        "windows_version": (10, 0, MIN_WINDOWS_11_24H2_BUILD),
        "product_type": WINDOWS_WORKSTATION_PRODUCT_TYPE,
    }
    validate_windows_environment(**valid_environment)
    expect_probe_failure(
        lambda: validate_windows_environment(
            **{
                **valid_environment,
                "windows_version": (10, 0, MIN_WINDOWS_11_24H2_BUILD - 1),
            }
        ),
        "environment-validation",
        "windows-11-24h2-required",
    )
    expect_probe_failure(
        lambda: validate_windows_environment(
            **{**valid_environment, "product_type": 3}
        ),
        "environment-validation",
        "windows-client-required",
    )

    cpu_profile = [
        profile_event(f"{MODEL_NODE_NAME}{PROFILE_KERNEL_SUFFIX}", "Add", CPU_PROVIDER)
    ]
    dml_name = f"{DML_FUSED_NODE_PREFIX}0_0"
    dml_profile = [
        profile_event(f"{dml_name}{PROFILE_KERNEL_SUFFIX}", dml_name, DML_PROVIDER)
    ]
    profiled_node_providers(cpu_profile, CPU_PROVIDER)
    profiled_node_providers(dml_profile, DML_PROVIDER)
    expect_probe_failure(
        lambda: profiled_node_providers(
            [
                profile_event(
                    f"{dml_name}{PROFILE_KERNEL_SUFFIX}", dml_name, CPU_PROVIDER
                )
            ],
            DML_PROVIDER,
        ),
        "profile-validation",
        "target-node-provider-mismatch",
    )
    expect_probe_failure(
        lambda: profiled_node_providers(cpu_profile + dml_profile, DML_PROVIDER),
        "profile-validation",
        "kernel-event-count-mismatch",
    )
    expect_probe_failure(
        lambda: profiled_node_providers(
            [profile_event("unexpected_kernel_time", "unexpected", DML_PROVIDER)],
            DML_PROVIDER,
        ),
        "profile-validation",
        "directml-kernel-name-mismatch",
    )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "task": TASK_ID,
        "status": "ok",
        "selfTests": 8,
        "checks": [
            "windows-11-24h2-minimum-accepted",
            "pre-24h2-build-rejected",
            "server-product-type-rejected",
            "cpu-profile-accepted",
            "directml-profile-accepted",
            "wrong-directml-provider-rejected",
            "mixed-kernel-events-rejected",
            "malformed-directml-kernel-rejected",
        ],
    }


def emit(payload: dict[str, object], stream: TextIO) -> None:
    json.dump(payload, stream, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    stream.write("\n")
    stream.flush()


def main(argv: list[str] | None = None) -> int:
    arguments = sys.argv[1:] if argv is None else argv
    if arguments == ["--self-test"]:
        try:
            emit(run_self_tests(), sys.stdout)
            return 0
        except Exception as error:  # noqa: BLE001
            emit(
                {
                    "schemaVersion": SCHEMA_VERSION,
                    "task": TASK_ID,
                    "status": "error",
                    "stage": "self-test",
                    "code": "unexpected-exception",
                    "causeType": type(error).__name__,
                },
                sys.stderr,
            )
            return 1
    if arguments:
        emit(
            {
                "schemaVersion": SCHEMA_VERSION,
                "task": TASK_ID,
                "status": "error",
                "stage": "arguments",
                "code": "arguments-not-supported",
            },
            sys.stderr,
        )
        return 2

    try:
        emit(run_probe(), sys.stdout)
        return 0
    except ProbeFailure as error:
        failure: dict[str, object] = {
            "schemaVersion": SCHEMA_VERSION,
            "task": TASK_ID,
            "status": "error",
            "stage": error.stage,
            "code": error.code,
        }
        if error.cause_type is not None:
            failure["causeType"] = error.cause_type
        emit(failure, sys.stderr)
        return 1
    # The CLI boundary must emit sanitized JSON even for unforeseen failures.
    except Exception as error:  # noqa: BLE001
        emit(
            {
                "schemaVersion": SCHEMA_VERSION,
                "task": TASK_ID,
                "status": "error",
                "stage": "unhandled",
                "code": "unexpected-exception",
                "causeType": type(error).__name__,
            },
            sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
