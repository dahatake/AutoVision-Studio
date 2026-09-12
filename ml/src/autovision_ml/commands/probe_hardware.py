"""Windows observations only; support classification belongs to CORE-12."""

from __future__ import annotations

import ctypes
import os
import platform
import shutil
import stat
import sys
from collections.abc import Callable
from contextlib import redirect_stderr, redirect_stdout
from importlib import import_module
from io import StringIO
from pathlib import Path, PureWindowsPath
from typing import Protocol, cast


class _WindowsVersion(Protocol):
    major: int
    minor: int
    build: int
    product_type: int


class _Ort(Protocol):
    __version__: str

    def disable_telemetry_events(self) -> None: ...
    def get_available_providers(self) -> list[str]: ...


class _MemoryStatus(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_uint32),
        ("dwMemoryLoad", ctypes.c_uint32),
        ("ullTotalPhys", ctypes.c_uint64),
        ("ullAvailPhys", ctypes.c_uint64),
        ("ullTotalPageFile", ctypes.c_uint64),
        ("ullAvailPageFile", ctypes.c_uint64),
        ("ullTotalVirtual", ctypes.c_uint64),
        ("ullAvailVirtual", ctypes.c_uint64),
        ("ullAvailExtendedVirtual", ctypes.c_uint64),
    ]


class _DisplayDevice(ctypes.Structure):
    _fields_ = [
        ("cb", ctypes.c_uint32),
        ("DeviceName", ctypes.c_wchar * 32),
        ("DeviceString", ctypes.c_wchar * 128),
        ("StateFlags", ctypes.c_uint32),
        ("DeviceID", ctypes.c_wchar * 128),
        ("DeviceKey", ctypes.c_wchar * 128),
    ]


def _group(
    data: dict[str, object] | None,
    code: str | None = None,
    cause: Exception | None = None,
) -> dict[str, object]:
    cause_type = (
        None
        if cause is None
        else next(
            (
                kind.__name__
                for kind in (ImportError, OSError, ValueError, TypeError, RuntimeError)
                if isinstance(cause, kind)
            ),
            "Exception",
        )
    )
    return {
        "status": "ok" if code is None else "error",
        "data": data,
        "error": None if code is None else {"code": code, "causeType": cause_type},
    }


def _observe(
    collector: Callable[[], dict[str, object]], code: str
) -> dict[str, object]:
    try:
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            return collector()
    # Third-party/native failures must not expose raw messages or discard the
    # other observations. Interrupts and process termination still propagate.
    except Exception as cause:  # noqa: BLE001
        return _group(None, code, cause)


def _validate_disk_path(path: Path) -> None:
    text = str(path)
    parsed = PureWindowsPath(text)
    if (
        "\0" in text
        or not parsed.is_absolute()
        or len(parsed.drive) != 2
        or parsed.drive[0].lower() not in "abcdefghijklmnopqrstuvwxyz"
        or parsed.drive[1] != ":"
        or ".." in parsed.parts
        or any(
            part.endswith((" ", ".")) or any(c in part for c in '<>:"|?*')
            for part in parsed.parts[1:]
        )
    ):
        raise ValueError("invalid-disk-path")
    kernel = ctypes.WinDLL("kernel32", winmode=0x800, use_last_error=True)
    drive_type = kernel.GetDriveTypeW
    drive_type.argtypes = [ctypes.c_wchar_p]
    drive_type.restype = ctypes.c_uint32
    if drive_type(parsed.anchor) not in (2, 3, 5, 6):
        raise ValueError("nonlocal-or-invalid-drive")
    # Root first: never follow a junction/symlink to inspect a later ancestor.
    # This is not a handle-based TOCTOU guarantee; Main must validate its owned path.
    for ancestor in (*reversed(path.parents), path):
        info = ancestor.lstat()
        attributes = cast(int, getattr(info, "st_file_attributes", 0))
        if (
            not stat.S_ISDIR(info.st_mode)
            or attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT
        ):
            raise ValueError("directory-or-reparse-check-failed")


def _os() -> dict[str, object]:
    getter = cast(
        Callable[[], _WindowsVersion] | None,
        getattr(sys, "getwindowsversion", None),
    )
    if getter is None:
        raise RuntimeError("windows-version-unavailable")
    version = getter()
    return _group(
        {
            "name": "Windows",
            "major": version.major,
            "minor": version.minor,
            "build": version.build,
            "productType": version.product_type,
            "architecture": platform.machine(),
        }
    )


def _cpu() -> dict[str, object]:
    import winreg

    count = os.cpu_count()
    with winreg.OpenKey(
        winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0"
    ) as key:
        value, _ = winreg.QueryValueEx(key, "ProcessorNameString")
    name = value.strip() if isinstance(value, str) else None
    return _group(
        {"logicalCount": count, "name": name or None},
        "cpu-data-unavailable" if count is None or count <= 0 or not name else None,
    )


def _memory() -> dict[str, object]:
    query = ctypes.WinDLL(
        "kernel32", winmode=0x800, use_last_error=True
    ).GlobalMemoryStatusEx
    query.argtypes = [ctypes.POINTER(_MemoryStatus)]
    query.restype = ctypes.c_int32
    info = _MemoryStatus()
    info.dwLength = ctypes.sizeof(info)
    if not query(ctypes.byref(info)):
        raise OSError(ctypes.get_last_error(), "memory-query-failed")
    return _group(
        {
            "totalBytes": info.ullTotalPhys,
            "availableBytes": info.ullAvailPhys,
            "loadPercent": info.dwMemoryLoad,
        }
    )


def _disk(path: Path) -> dict[str, object]:
    usage = shutil.disk_usage(path)
    return _group(
        {"totalBytes": usage.total, "usedBytes": usage.used, "freeBytes": usage.free}
    )


def _gpu() -> dict[str, object]:
    query = ctypes.WinDLL(
        "user32", winmode=0x800, use_last_error=True
    ).EnumDisplayDevicesW
    query.argtypes = [
        ctypes.c_wchar_p,
        ctypes.c_uint32,
        ctypes.POINTER(_DisplayDevice),
        ctypes.c_uint32,
    ]
    query.restype = ctypes.c_int32
    adapters: list[dict[str, object]] = []
    for index in range(256):
        device = _DisplayDevice()
        device.cb = ctypes.sizeof(device)
        if not query(None, index, ctypes.byref(device), 0):
            return _group(
                {
                    "adapters": adapters,
                    "scope": "current-session-display-adapters",
                    "computeStatus": "not_checked",
                }
            )
        adapters.append(
            {
                "DeviceName": device.DeviceName,
                "DeviceString": device.DeviceString,
                "StateFlags": device.StateFlags,
            }
        )
    return _group(None, "display-adapter-limit-exceeded")


def _onnx_runtime() -> dict[str, object]:
    # PKG-02 must explicitly bundle onnxruntime and its native dependencies.
    # No runtime downloads; this import uses only the installed/bundled package.
    runtime = cast(_Ort, import_module("onnxruntime"))
    runtime.disable_telemetry_events()
    return _group(
        {
            "version": runtime.__version__,
            "providers": runtime.get_available_providers(),
            "executionStatus": "not_checked",
        }
    )


def _cuda() -> dict[str, object]:
    import torch

    return _group(
        {
            "torchVersion": str(torch.__version__),
            "runtimeVersion": torch.version.cuda,
            "available": torch.cuda.is_available(),
            "scope": "torch-runtime-only",
            "executionStatus": "not_checked",
            "physicalGpuPresence": None,
        }
    )


def probe_hardware(*, disk_path: Path) -> dict[str, object]:
    """Observe a validated local directory and Windows hardware without inference."""
    report: dict[str, object] = {
        "schemaVersion": 1,
        "command": "probe-hardware",
        "status": "error",
        **{
            name: {"status": "not_checked", "data": None, "error": None}
            for name in ("os", "cpu", "memory", "disk", "gpu", "onnxRuntime", "cuda")
        },
        "camera": {
            "status": "deferred",
            "streamOpened": False,
            "reasonCode": "check-on-inference-start",
        },
    }
    if sys.platform != "win32":
        report["os"] = _group(None, "unsupported-os")
        return report
    disk_error: dict[str, object] | None = None
    try:
        _validate_disk_path(disk_path)
    except (FileNotFoundError, NotADirectoryError, ValueError, TypeError) as cause:
        report["disk"] = _group(None, "invalid-disk-path", cause)
        return report
    except (OSError, AttributeError) as cause:
        # Do not query an unvalidated disk, but retain independent observations.
        disk_error = _group(None, "disk-probe-failed", cause)
    os_group = _observe(_os, "os-probe-failed")
    report["os"] = os_group
    statuses = [os_group["status"]]
    for name, collector in (
        ("cpu", _cpu),
        ("memory", _memory),
        ("disk", lambda: _disk(disk_path)),
        ("gpu", _gpu),
        ("onnxRuntime", _onnx_runtime),
        ("cuda", _cuda),
    ):
        group = (
            disk_error
            if name == "disk" and disk_error is not None
            else _observe(collector, f"{name}-probe-failed")
        )
        report[name] = group
        statuses.append(group["status"])
    report["status"] = (
        "ok"
        if all(value == "ok" for value in statuses)
        else "partial"
        if "ok" in statuses
        else "error"
    )
    return report
