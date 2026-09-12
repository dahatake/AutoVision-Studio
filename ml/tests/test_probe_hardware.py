from __future__ import annotations

import builtins
import ctypes
import json
import os
import stat
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Protocol, cast
from unittest.mock import MagicMock, Mock

import pytest

from autovision_ml import __version__, cli
from autovision_ml.commands import probe_hardware as hardware


class _Memory(Protocol):
    dwLength: int
    dwMemoryLoad: int
    ullTotalPhys: int
    ullAvailPhys: int


class _Device(Protocol):
    cb: int
    DeviceName: str
    DeviceString: str
    StateFlags: int
    DeviceID: str
    DeviceKey: str


def _module(name: str, **attributes: object) -> ModuleType:
    module = ModuleType(name)
    for key, value in attributes.items():
        setattr(module, key, value)
    return module


@pytest.fixture
def environment(monkeypatch: pytest.MonkeyPatch) -> dict[str, Mock]:
    def memory(pointer: object) -> int:
        info = cast(_Memory, getattr(pointer, "_obj", None))
        assert info.dwLength == 64
        info.dwMemoryLoad, info.ullTotalPhys, info.ullAvailPhys = 25, 8000, 6000
        return 1

    def display(parent: object, index: int, pointer: object, flags: int) -> int:
        assert parent is None and flags == 0
        if index:
            return 0
        device = cast(_Device, getattr(pointer, "_obj", None))
        device.DeviceName, device.DeviceString, device.StateFlags = (
            "DISPLAY1",
            "Example GPU",
            1,
        )
        device.DeviceID, device.DeviceKey = "PRIVATE-DEVICE", "PRIVATE-REGISTRY"
        return 1

    telemetry = Mock()

    def providers() -> list[str]:
        telemetry.assert_called_once_with()
        return ["DmlExecutionProvider", "CPUExecutionProvider"]

    mocks = {
        "memory": Mock(side_effect=memory),
        "display": Mock(side_effect=display),
        "drive": Mock(return_value=3),
        "telemetry": telemetry,
        "providers": Mock(side_effect=providers),
        "available": Mock(return_value=False),
        "lstat": Mock(
            return_value=SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=0)
        ),
        "usage": Mock(return_value=SimpleNamespace(total=100, used=40, free=60)),
        "registry": Mock(return_value=("Example CPU", 1)),
        "forbidden": Mock(side_effect=AssertionError("execution/camera must not run")),
    }
    kernel = SimpleNamespace(
        GlobalMemoryStatusEx=mocks["memory"], GetDriveTypeW=mocks["drive"]
    )
    user = SimpleNamespace(EnumDisplayDevicesW=mocks["display"])

    def load_dll(name: str, *, winmode: int, use_last_error: bool) -> SimpleNamespace:
        assert winmode == 0x800 and use_last_error is True
        assert name in ("kernel32", "user32")
        return kernel if name == "kernel32" else user

    def lstat(path: Path) -> os.stat_result:
        return cast(os.stat_result, mocks["lstat"](path))

    mocks["dll"] = Mock(side_effect=load_dll)
    monkeypatch.setattr(ctypes, "WinDLL", mocks["dll"], raising=False)
    mocks["last_error"] = Mock(return_value=5)
    monkeypatch.setattr(ctypes, "get_last_error", mocks["last_error"], raising=False)
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(
        sys,
        "getwindowsversion",
        Mock(
            return_value=SimpleNamespace(
                major=10,
                minor=0,
                build=26100,
                product_type=1,
            ),
        ),
        raising=False,
    )
    monkeypatch.setattr(hardware.platform, "machine", Mock(return_value="AMD64"))
    monkeypatch.setattr(os, "cpu_count", Mock(return_value=8))
    monkeypatch.setattr(Path, "lstat", lstat)
    monkeypatch.setattr(hardware.shutil, "disk_usage", mocks["usage"])
    monkeypatch.setitem(
        sys.modules,
        "winreg",
        _module(
            "winreg",
            HKEY_LOCAL_MACHINE=1,
            OpenKey=MagicMock(),
            QueryValueEx=mocks["registry"],
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "onnxruntime",
        _module(
            "onnxruntime",
            __version__="1.24.4",
            disable_telemetry_events=telemetry,
            get_available_providers=mocks["providers"],
            InferenceSession=mocks["forbidden"],
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "torch",
        _module(
            "torch",
            __version__="2.11.0+cpu",
            version=SimpleNamespace(cuda=None),
            cuda=SimpleNamespace(
                is_available=mocks["available"], device_count=mocks["forbidden"]
            ),
        ),
    )
    monkeypatch.setitem(
        sys.modules, "cv2", _module("cv2", VideoCapture=mocks["forbidden"])
    )
    return mocks


def _group(report: dict[str, object], name: str) -> dict[str, object]:
    return cast(dict[str, object], report[name])


def _data(report: dict[str, object], name: str) -> dict[str, object]:
    return cast(dict[str, object], _group(report, name)["data"])


def test_fixed_report_is_observations_not_support_classification(
    environment: dict[str, Mock],
) -> None:
    report = hardware.probe_hardware(disk_path=Path("C:/safe"))
    expected_data: dict[str, dict[str, object]] = {
        "os": {
            "name": "Windows",
            "major": 10,
            "minor": 0,
            "build": 26100,
            "productType": 1,
            "architecture": "AMD64",
        },
        "cpu": {"logicalCount": 8, "name": "Example CPU"},
        "memory": {"totalBytes": 8000, "availableBytes": 6000, "loadPercent": 25},
        "disk": {"totalBytes": 100, "usedBytes": 40, "freeBytes": 60},
        "gpu": {
            "adapters": [
                {
                    "DeviceName": "DISPLAY1",
                    "DeviceString": "Example GPU",
                    "StateFlags": 1,
                }
            ],
            "scope": "current-session-display-adapters",
            "computeStatus": "not_checked",
        },
        "onnxRuntime": {
            "version": "1.24.4",
            "providers": ["DmlExecutionProvider", "CPUExecutionProvider"],
            "executionStatus": "not_checked",
        },
        "cuda": {
            "torchVersion": "2.11.0+cpu",
            "runtimeVersion": None,
            "available": False,
            "scope": "torch-runtime-only",
            "executionStatus": "not_checked",
            "physicalGpuPresence": None,
        },
    }
    assert report == {
        "schemaVersion": 1,
        "command": "probe-hardware",
        "status": "ok",
        **{
            name: {"status": "ok", "data": data, "error": None}
            for name, data in expected_data.items()
        },
        "camera": {
            "status": "deferred",
            "streamOpened": False,
            "reasonCode": "check-on-inference-start",
        },
    }
    environment["forbidden"].assert_not_called()
    assert "PRIVATE" not in json.dumps(report)
    assert "DeviceID" not in json.dumps(report) and "DeviceKey" not in json.dumps(
        report
    )


@pytest.mark.parametrize("count", [None, 0])
def test_unknown_cpu_count_is_never_replaced_with_one(
    environment: dict[str, Mock],
    monkeypatch: pytest.MonkeyPatch,
    count: int | None,
) -> None:
    monkeypatch.setattr(os, "cpu_count", Mock(return_value=count))
    report = hardware.probe_hardware(disk_path=Path("C:/safe"))
    assert _data(report, "cpu")["logicalCount"] == count
    assert _group(report, "cpu")["error"] == {
        "code": "cpu-data-unavailable",
        "causeType": None,
    }
    assert report["status"] == "partial"


@pytest.mark.parametrize(
    "text",
    [
        "relative",
        "C:relative",
        "C:/safe/../other",
        "//server/share",
        "//?/C:/safe",
        "//./C:/safe",
        "C:/bad\0name",
        "C:/safe/.. /private",
    ],
)
def test_invalid_lexical_path_is_rejected_before_io(
    environment: dict[str, Mock], text: str
) -> None:
    report = hardware.probe_hardware(disk_path=Path(text))
    assert report["status"] == "error"
    assert _group(report, "disk") == {
        "status": "error",
        "data": None,
        "error": {"code": "invalid-disk-path", "causeType": "ValueError"},
    }
    for name in ("dll", "lstat", "usage", "registry", "providers", "available"):
        environment[name].assert_not_called()


@pytest.mark.parametrize("drive_type", [0, 1, 4])
def test_unknown_invalid_and_mapped_network_drives_stop_before_filesystem(
    environment: dict[str, Mock],
    drive_type: int,
) -> None:
    environment["drive"].return_value = drive_type
    report = hardware.probe_hardware(disk_path=Path("C:/safe"))
    assert report["status"] == "error"
    environment["drive"].assert_called_once_with("C:\\")
    environment["lstat"].assert_not_called()
    environment["usage"].assert_not_called()


@pytest.mark.parametrize("drive_type", [2, 3, 5, 6])
def test_only_known_local_drive_types_are_accepted(
    environment: dict[str, Mock], drive_type: int
) -> None:
    environment["drive"].return_value = drive_type
    assert hardware.probe_hardware(disk_path=Path("C:/safe"))["status"] == "ok"


def test_ancestors_are_checked_root_first_and_reparse_points_are_not_followed(
    environment: dict[str, Mock],
) -> None:
    path = Path("C:/safe/data")
    ancestors = [*reversed(path.parents), path]
    environment["lstat"].side_effect = [
        SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=0),
        SimpleNamespace(
            st_mode=stat.S_IFDIR, st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT
        ),
    ]
    assert hardware.probe_hardware(disk_path=path)["status"] == "error"
    assert [call.args[0] for call in environment["lstat"].call_args_list] == ancestors[
        :2
    ]
    environment["usage"].assert_not_called()


def test_missing_directory_is_sanitized(environment: dict[str, Mock]) -> None:
    environment["lstat"].side_effect = FileNotFoundError("C:/PRIVATE/user")
    report = hardware.probe_hardware(disk_path=Path("C:/safe"))
    assert _group(report, "disk")["error"] == {
        "code": "invalid-disk-path",
        "causeType": "OSError",
    }
    assert "PRIVATE" not in json.dumps(report)
    environment["usage"].assert_not_called()


@pytest.mark.parametrize("failure", [PermissionError, OSError])
def test_disk_validation_io_failure_preserves_other_observations(
    environment: dict[str, Mock],
    capsys: pytest.CaptureFixture[str],
    failure: type[OSError],
) -> None:
    environment["lstat"].side_effect = failure("C:/PRIVATE/user")
    assert cli.main(["probe-hardware", "--disk-path", "C:/safe"]) == 1
    output = capsys.readouterr()
    assert output.err == "" and len(output.out.splitlines()) == 1
    assert "PRIVATE" not in output.out and "Traceback" not in output.out
    report = cast(dict[str, object], json.loads(output.out))
    assert report["status"] == "partial"
    assert _group(report, "disk") == {
        "status": "error",
        "data": None,
        "error": {"code": "disk-probe-failed", "causeType": "OSError"},
    }
    for name in ("os", "cpu", "memory", "gpu", "onnxRuntime", "cuda"):
        assert _group(report, name)["status"] == "ok"
        assert _group(report, name)["data"] is not None
    environment["usage"].assert_not_called()
    environment["forbidden"].assert_not_called()


def test_regular_file_is_not_an_existing_directory(
    environment: dict[str, Mock],
) -> None:
    environment["lstat"].return_value = SimpleNamespace(
        st_mode=stat.S_IFREG, st_file_attributes=0
    )
    assert hardware.probe_hardware(disk_path=Path("C:/file"))["status"] == "error"
    environment["usage"].assert_not_called()


@pytest.mark.parametrize("system", ["darwin", "linux"])
def test_unsupported_os_short_circuits_without_imports(
    environment: dict[str, Mock],
    monkeypatch: pytest.MonkeyPatch,
    system: str,
) -> None:
    path = Path("C:/safe")
    blocked = Mock(side_effect=AssertionError("no imports permitted"))
    with monkeypatch.context() as context:
        context.setattr(sys, "platform", system)
        context.setattr(builtins, "__import__", blocked)
        report = hardware.probe_hardware(disk_path=path)
    assert report["status"] == "error"
    assert _group(report, "os")["error"] == {
        "code": "unsupported-os",
        "causeType": None,
    }
    for name in ("cpu", "memory", "disk", "gpu", "onnxRuntime", "cuda"):
        assert _group(report, name) == {
            "status": "not_checked",
            "data": None,
            "error": None,
        }
    blocked.assert_not_called()
    environment["dll"].assert_not_called()


def test_memory_api_false_is_an_error_not_zero_memory(
    environment: dict[str, Mock],
) -> None:
    environment["memory"].side_effect = None
    environment["memory"].return_value = 0
    report = hardware.probe_hardware(disk_path=Path("C:/safe"))
    assert report["status"] == "partial"
    assert _group(report, "memory") == {
        "status": "error",
        "data": None,
        "error": {"code": "memory-probe-failed", "causeType": "OSError"},
    }
    environment["last_error"].assert_called_once_with()


def test_adapter_overflow_is_bounded_error_not_truncated_success(
    environment: dict[str, Mock],
) -> None:
    environment["display"].side_effect = None
    environment["display"].return_value = 1
    report = hardware.probe_hardware(disk_path=Path("C:/safe"))
    assert report["status"] == "partial"
    assert _group(report, "gpu") == {
        "status": "error",
        "data": None,
        "error": {"code": "display-adapter-limit-exceeded", "causeType": None},
    }
    assert [call.args[1] for call in environment["display"].call_args_list] == list(
        range(256)
    )


def test_no_session_display_adapters_does_not_claim_physical_gpu_absence(
    environment: dict[str, Mock],
) -> None:
    environment["display"].side_effect = None
    environment["display"].return_value = 0
    report = hardware.probe_hardware(disk_path=Path("C:/safe"))
    assert _data(report, "gpu") == {
        "adapters": [],
        "scope": "current-session-display-adapters",
        "computeStatus": "not_checked",
    }
    assert _data(report, "cuda")["physicalGpuPresence"] is None


def test_cpu_torch_false_is_independent_of_display_adapter_presence(
    environment: dict[str, Mock],
) -> None:
    report = hardware.probe_hardware(disk_path=Path("C:/safe"))
    assert _data(report, "cuda")["available"] is False
    assert _data(report, "cuda")["runtimeVersion"] is None
    assert _data(report, "gpu")["adapters"]
    assert report["status"] == "ok"


def test_provider_listing_disables_telemetry_but_never_executes_or_opens_camera(
    environment: dict[str, Mock],
) -> None:
    report = hardware.probe_hardware(disk_path=Path("C:/safe"))
    environment["telemetry"].assert_called_once_with()
    environment["providers"].assert_called_once_with()
    environment["forbidden"].assert_not_called()
    assert _data(report, "onnxRuntime")["executionStatus"] == "not_checked"
    assert report["camera"] == {
        "status": "deferred",
        "streamOpened": False,
        "reasonCode": "check-on-inference-start",
    }


def test_telemetry_failure_prevents_provider_query(
    environment: dict[str, Mock],
) -> None:
    environment["telemetry"].side_effect = RuntimeError("PRIVATE")
    report = hardware.probe_hardware(disk_path=Path("C:/safe"))
    assert report["status"] == "partial"
    assert _group(report, "onnxRuntime")["data"] is None
    environment["providers"].assert_not_called()


@pytest.mark.parametrize(
    "group,function",
    [
        ("os", "_os"),
        ("cpu", "_cpu"),
        ("memory", "_memory"),
        ("disk", "_disk"),
        ("gpu", "_gpu"),
        ("onnxRuntime", "_onnx_runtime"),
        ("cuda", "_cuda"),
    ],
)
def test_each_collector_failure_is_isolated(
    environment: dict[str, Mock],
    monkeypatch: pytest.MonkeyPatch,
    group: str,
    function: str,
) -> None:
    monkeypatch.setattr(
        hardware, function, Mock(side_effect=ImportError("PRIVATE/path"))
    )
    report = hardware.probe_hardware(disk_path=Path("C:/safe"))
    assert report["status"] == "partial"
    assert _group(report, group) == {
        "status": "error",
        "data": None,
        "error": {"code": f"{group}-probe-failed", "causeType": "ImportError"},
    }
    assert "PRIVATE" not in json.dumps(report)


def test_all_observations_failed_is_error(
    environment: dict[str, Mock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ("_os", "_cpu", "_memory", "_disk", "_gpu", "_onnx_runtime", "_cuda"):
        monkeypatch.setattr(hardware, name, Mock(side_effect=RuntimeError("PRIVATE")))
    assert hardware.probe_hardware(disk_path=Path("C:/safe"))["status"] == "error"


def test_cli_sanitizes_prints_exceptions_and_unknown_cause_names(
    environment: dict[str, Mock],
    capsys: pytest.CaptureFixture[str],
) -> None:
    def noisy_failure() -> list[str]:
        print("C:/PRIVATE/日本語")
        print("PRIVATE stderr", file=sys.stderr)
        raise type("PRIVATE-cause-name", (Exception,), {})("PRIVATE exception")

    environment["providers"].side_effect = noisy_failure
    assert cli.main(["probe-hardware", "--disk-path", "C:/safe"]) == 1
    output = capsys.readouterr()
    assert output.err == "" and output.out.isascii()
    assert len(output.out.splitlines()) == 1 and output.out.endswith("\n")
    assert "PRIVATE" not in output.out and "Traceback" not in output.out
    report = cast(dict[str, object], json.loads(output.out))
    assert _group(report, "onnxRuntime")["error"] == {
        "code": "onnxRuntime-probe-failed",
        "causeType": "Exception",
    }


def test_cli_success_is_one_ascii_json_line(
    environment: dict[str, Mock], capsys: pytest.CaptureFixture[str]
) -> None:
    environment["registry"].return_value = ("日本語 CPU", 1)
    assert cli.main(["probe-hardware", "--disk-path", "C:/safe"]) == 0
    output = capsys.readouterr()
    assert output.err == "" and output.out.isascii()
    assert len(output.out.splitlines()) == 1
    assert "C:/safe" not in output.out
    assert (
        _data(cast(dict[str, object], json.loads(output.out)), "cpu")["name"]
        == "日本語 CPU"
    )


def test_cli_invalid_disk_path_returns_two(
    environment: dict[str, Mock], capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["probe-hardware", "--disk-path", "relative"]) == 2
    output = capsys.readouterr()
    assert output.err == ""
    assert cast(dict[str, object], json.loads(output.out))["status"] == "error"
    environment["dll"].assert_not_called()


@pytest.mark.parametrize(
    "arguments",
    [
        ["probe-hardware"],
        ["probe-hardware", "--disk-path"],
        ["unknown"],
        ["probe-hardware", "--camera"],
    ],
)
def test_cli_allowlist_and_required_disk_path(
    arguments: list[str], capsys: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(SystemExit) as raised:
        cli.main(arguments)
    assert raised.value.code == 2
    assert capsys.readouterr().out == ""


def test_health_remains_lightweight_and_payload_unchanged(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    guard = Mock(wraps=builtins.__import__)
    monkeypatch.setattr(cli.platform, "system", Mock(return_value="Windows"))
    with monkeypatch.context() as context:
        context.setattr(builtins, "__import__", guard)
        assert cli.main(["health"]) == 0
    output = capsys.readouterr()
    assert (
        output.out
        == json.dumps({"version": __version__, "os": "Windows"}, separators=(",", ":"))
        + "\n"
    )
    assert output.err == ""
    assert not any(
        call.args[0] in ("torch", "onnxruntime", "winreg")
        or "probe_hardware" in call.args[0]
        for call in guard.call_args_list
    )


@pytest.mark.skipif(os.name != "nt", reason="Windows WCHAR ABI only")
def test_windows_ffi_layouts_and_signatures(environment: dict[str, Mock]) -> None:
    hardware.probe_hardware(disk_path=Path("C:/safe"))
    memory_type = cast(type[ctypes.Structure], vars(hardware)["_MemoryStatus"])
    display_type = cast(type[ctypes.Structure], vars(hardware)["_DisplayDevice"])
    assert ctypes.sizeof(memory_type) == 64
    assert ctypes.sizeof(display_type) == 840
    assert environment["memory"].argtypes == [ctypes.POINTER(memory_type)]
    assert environment["display"].argtypes == [
        ctypes.c_wchar_p,
        ctypes.c_uint32,
        ctypes.POINTER(display_type),
        ctypes.c_uint32,
    ]
    assert environment["drive"].argtypes == [ctypes.c_wchar_p]
    assert environment["memory"].restype is ctypes.c_int32
    assert environment["display"].restype is ctypes.c_int32
    assert environment["drive"].restype is ctypes.c_uint32
