"""LIC-03 filename-only unit/integration tests; never CPU fallback evidence."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import pytest

SCRIPT = Path(__file__).with_name("verify-cuda-payload.py")
SPEC = importlib.util.spec_from_file_location("verify_cuda_payload", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
scanner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scanner)
pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="Windows LIC-03")

BANNED = [
    "cublas64_12.dll", "cublasLt64_12.dll", "cudart64_12.dll", "cudadevrt.lib",
    "cudnn_engines_runtime_compiled64_9.dll", "cufft64_11.dll", "cufftw.lib",
    "curand64_10.dll", "cusolverMg64_11.dll", "cusparse64_12.dll", "nppc64_12.dll",
    "nppial64_12.dll", "npps64_12.dll", "nvblas.dll", "nvrtc-builtins64_130.dll",
    "nvvm64_40_0.dll", "nvJitLink_130_0.dll", "libnvJitLink.dll", "nvjpeg.dll",
    "nvToolsExt64_1.dll", "cupti64_2025.dll", "nvcuda.dll", "nvidia-smi.exe",
    "torch_cuda.dll", "torch_cuda_linalg.dll", "c10_cuda.dll",
    "onnxruntime_providers_cuda.dll", "onnxruntime_providers_tensorrt.dll",
    "nvinfer_plugin_10.dll", "nvonnxparser_10.dll", "libcudnn.so.9.1",
    "libcublas.dylib", "libcudart_static.a", "nvrtc.pyd", "cudnn.node",
    "libnvptxcompiler_static.a", "libdevice.10.bc", "libculibos.a",
    "libnvtx3interop.so", "libcufile_rdma.so", "libcuobjclient.so",
    "nvcc.exe", "nvcc", "nvcc.cmd", "ptxas.exe", "fatbinary.exe", "nvlink.exe",
    "cudafe++.exe", "cicc.exe", "cuobjdump.exe", "nvdisasm.exe",
    "cuda-gdb", "cuda-memcheck.exe", "compute-sanitizer.exe", "nvprof.exe",
    "kernel.ptx", "application.cubin", "compiled.fatbin", "nvidia.sys",
    "cudart.obj", "cudart.o", "cudart.pdb",
]


@pytest.mark.parametrize("name", BANNED)
@pytest.mark.parametrize("uppercase", [False, True], ids=["original", "uppercase"])
def test_banned_native_names_in_real_directory(
    tmp_path: Path, name: str, uppercase: bool
) -> None:
    name = name.upper() if uppercase else name
    (tmp_path / name).write_bytes(b"fixture, not an executable")
    report = scanner.scan_payload(str(tmp_path))
    assert report["status"] == "FAIL"
    assert report["violations"] == [name]
    assert report["scanComplete"] is True
    assert report["nativeComponentAuditComplete"] is False


def run_cli(*arguments: str) -> tuple[int, dict[str, Any]]:
    result = subprocess.run(
        [sys.executable, "-B", str(SCRIPT), *arguments],
        cwd=SCRIPT.parents[2] / "ml", shell=False, capture_output=True,
        text=True, encoding="utf-8", timeout=20, check=False,
    )
    assert result.stderr == ""
    return result.returncode, json.loads(result.stdout)


def test_cli_legitimate_cpu_facades_and_inventory_are_read_only(tmp_path: Path) -> None:
    payload = tmp_path / "CPU payload 日本語"
    files = {
        "torch/cuda/__init__.py": b"# CUDA facade\r\n",
        "torch/cuda/__pycache__/__init__.cpython-314.pyc": b"cached facade",
        "include/cuda.h": b"header",
        "include/cudnn.hpp": b"header",
        "LICENSE-NVIDIA.txt": b"CUDA is mentioned here",
        "nvcc.py": b"source facade",
        "nvcc.h": b"header",
        "torch_cpu.dll": b"fixture DLL",
        "c10.dll": b"fixture DLL",
        "DirectML.dll": b"fixture DLL",
        "onnxruntime.dll": b"fixture DLL",
        "onnxruntime_providers_shared.dll": b"fixture DLL",
        "libordinary.a": b"!<arch>\n",  # Native archive, not a compressed container.
        "__init__.py": b"",
    }
    for relative, data in files.items():
        file = payload / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
    before = {p.relative_to(payload).as_posix(): p.stat().st_mtime_ns for p in payload.rglob("*")}
    exit_code, report = run_cli(str(payload))
    assert exit_code == 0
    assert report["status"] == report["assurance"] == "LIMITED"
    assert report["scope"] == "cuda-nonbundling-filenames"
    assert report["scanComplete"] is True
    assert report["nativeComponentAuditComplete"] is False
    assert report["cpuWorkflowProof"] == report["finalPayloadVerification"] == "NOT_RUN"
    assert report["nvidiaAllowlist"] == report["violations"] == []
    assert report["fileCount"] == len(files)
    assert report["totalBytes"] == sum(map(len, files.values()))
    assert {r["path"]: r["sha256"] for r in report["files"]} == {
        path: hashlib.sha256(data).hexdigest() for path, data in files.items()
    }
    manifest = json.dumps(report["files"], ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    assert report["manifestSha256"] == hashlib.sha256(manifest.encode("utf-8")).hexdigest()
    assert {p.relative_to(payload).as_posix(): p.stat().st_mtime_ns for p in payload.rglob("*")} == before
    assert {path: (payload / path).read_bytes() for path in files} == files
    assert run_cli(str(payload))[1] == report


@pytest.mark.parametrize("arguments", [[], ["--allow-nvidia"], ["x", "y"]])
def test_cli_unknown_input_never_succeeds(arguments: list[str]) -> None:
    exit_code, report = run_cli(*arguments)
    assert exit_code == 2
    assert report["status"] == "BLOCKED"
    assert report["scanComplete"] is False


def test_cli_banned_returns_one(tmp_path: Path) -> None:
    (tmp_path / "CuDNN64_9.DlL").write_bytes(b"fixture")
    exit_code, report = run_cli(str(tmp_path))
    assert exit_code == 1
    assert report["status"] == "FAIL"


@pytest.mark.parametrize("kind", ["missing", "file", "empty", "dirs-only", "zero-only", "zero-native"])
def test_incomplete_payload_is_blocked(tmp_path: Path, kind: str) -> None:
    root = tmp_path / "payload"
    if kind == "file":
        root.write_bytes(b"not a directory")
    elif kind != "missing":
        root.mkdir()
        if kind == "dirs-only":
            (root / "nested").mkdir()
        if kind in ("zero-only", "zero-native"):
            (root / "empty.py").touch()
        if kind == "zero-native":
            (root / "ordinary.dll").touch()
            (root / "NOTICE").write_bytes(b"notice")
    exit_code, report = run_cli(str(root))
    assert exit_code == 2
    assert report["status"] == "BLOCKED"


@pytest.mark.parametrize(
    "text",
    [
        "", ".", "relative", "C:relative", "C:\\", "/root", "\\root",
        "\\\\server\\share\\payload", "\\\\?\\C:\\payload",
        "\\\\.\\C:\\payload", "C:\\payload\\..\\other", "C:\\payload\\.\\other",
        "C:\\payload\\x:stream", "C:\\payload\\NUL.txt", "C:\\payload\\COM1",
        "C:\\payload\\bad.", "C:\\payload\\bad ", "C:\\payload\\*",
        "C:\\payload\\bad\x00", "C:\\payload\\bad\n", "C:\\payload\\bad\ud800",
    ],
)
def test_unsafe_root_is_rejected_before_io(text: str, monkeypatch: pytest.MonkeyPatch) -> None:
    drive = Mock(side_effect=AssertionError("must reject before I/O"))
    monkeypatch.setattr(scanner, "drive_type", drive)
    assert scanner.scan_payload(text)["status"] == "BLOCKED"
    drive.assert_not_called()


@pytest.mark.parametrize("kind", [0, 1, 4])
def test_unknown_or_network_drive_stops_before_walk(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, kind: int
) -> None:
    monkeypatch.setattr(scanner, "drive_type", lambda _: kind)
    walk = Mock(side_effect=AssertionError("must not walk remote drive"))
    monkeypatch.setattr(scanner, "collect", walk)
    assert scanner.scan_payload(str(tmp_path))["error"]["code"] == "nonlocal-or-unknown-drive"
    walk.assert_not_called()


@pytest.mark.parametrize("suffix", scanner.ARCHIVE_SUFFIXES)
def test_unexpanded_archives_fail_even_without_cuda_name(tmp_path: Path, suffix: str) -> None:
    (tmp_path / ("payload" + suffix.upper())).write_bytes(b"opaque")
    report = scanner.scan_payload(str(tmp_path))
    assert report["status"] == "BLOCKED"
    assert report["error"]["code"] == "unexpanded-archive"


@pytest.mark.parametrize("header", [*scanner.ARCHIVE_MAGIC, b"\0" * 257 + b"ustar"], ids=lambda b: hashlib.sha256(b).hexdigest()[:8])
def test_known_archive_headers_are_not_hidden_by_dat_extension(tmp_path: Path, header: bytes) -> None:
    (tmp_path / "payload.dat").write_bytes(header + b"opaque")
    assert scanner.scan_payload(str(tmp_path))["error"]["code"] == "unexpanded-archive"


def test_hardlinks_are_allowed_but_each_name_is_checked(tmp_path: Path) -> None:
    (tmp_path / "ordinary.dll").write_bytes(b"fixture")
    os.link(tmp_path / "ordinary.dll", tmp_path / "other.dll")
    report = scanner.scan_payload(str(tmp_path))
    assert report["status"] == "LIMITED"
    assert report["fileCount"] == 2
    assert all(r["hardlinkCount"] == 2 for r in report["files"])
    os.link(tmp_path / "ordinary.dll", tmp_path / "cudart64_12.dll")
    report = scanner.scan_payload(str(tmp_path))
    assert report["status"] == "FAIL"
    assert report["violations"] == ["cudart64_12.dll"]


@pytest.mark.parametrize("placement", ["root", "ancestor", "child", "file", "dangling", "loop"])
def test_real_symlinks_are_rejected(tmp_path: Path, placement: str) -> None:
    target = tmp_path / "target"
    target.mkdir()
    (target / "ordinary.dll").write_bytes(b"fixture")
    (target / "nested").mkdir()
    (target / "nested/data").write_bytes(b"fixture")
    link = tmp_path / "link" if placement in ("root", "ancestor") else target / "link"
    destination = target / "ordinary.dll" if placement == "file" else target
    if placement == "dangling":
        destination = tmp_path / "missing"
    try:
        link.symlink_to(destination, target_is_directory=placement != "file")
    except OSError as error:
        if error.winerror == 1314:
            pytest.skip("Windows symlink privilege unavailable; not a passed link test")
        raise
    root = link / "nested" if placement == "ancestor" else link if placement == "root" else target
    try:
        report = scanner.scan_payload(str(root))
        assert report["status"] == "BLOCKED"
        assert report["error"]["code"] == "reparse-or-symlink"
    finally:
        link.unlink()


@pytest.mark.parametrize("placement", ["root", "ancestor", "child", "loop"])
def test_real_junctions_are_rejected(tmp_path: Path, placement: str) -> None:
    target = tmp_path / "target"
    target.mkdir()
    (target / "nested").mkdir()
    (target / "nested/data").write_bytes(b"fixture")
    link = tmp_path / "junction" if placement in ("root", "ancestor") else target / "junction"
    # Native junction fixture only, never a shell or command from the payload.
    import _winapi

    _winapi.CreateJunction(str(target), str(link))
    root = link / "nested" if placement == "ancestor" else link if placement == "root" else target
    try:
        exit_code, report = run_cli(str(root))
        assert exit_code == 2
        assert report["error"]["code"] == "reparse-or-symlink"
    finally:
        link.rmdir()


@pytest.mark.parametrize("mode,attributes", [(stat.S_IFIFO, 0), (stat.S_IFSOCK, 0), (stat.S_IFREG, stat.FILE_ATTRIBUTE_REPARSE_POINT)])
def test_special_files_and_other_reparse_tags_are_rejected_before_open(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, mode: int, attributes: int
) -> None:
    path = tmp_path / "ordinary.dll"
    path.write_bytes(b"fixture")
    real_stat = Path.lstat

    def fake_stat(self: Path) -> Any:
        if self == path:
            return Mock(st_mode=mode, st_file_attributes=attributes)
        return real_stat(self)

    monkeypatch.setattr(Path, "lstat", fake_stat)
    opened = Mock(side_effect=AssertionError("must not open special file"))
    monkeypatch.setattr(Path, "open", opened)
    report = scanner.scan_payload(str(tmp_path))
    assert report["status"] == "BLOCKED"
    opened.assert_not_called()


@pytest.mark.parametrize("operation", ["open", "scandir", "lstat"])
def test_io_failures_do_not_become_success(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, operation: str
) -> None:
    (tmp_path / "file").write_bytes(b"fixture")
    failure = Mock(side_effect=PermissionError("private OS message"))
    monkeypatch.setattr(os if operation == "scandir" else Path, operation, failure)
    report = scanner.scan_payload(str(tmp_path))
    assert report["status"] == "BLOCKED"
    assert "private OS message" not in json.dumps(report)


@pytest.mark.parametrize("limit", ["MAX_ENTRIES", "MAX_DEPTH", "MAX_FILE_BYTES", "MAX_TOTAL_BYTES", "MAX_SECONDS"])
def test_finite_limits_fail_closed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, limit: str) -> None:
    (tmp_path / "file").write_bytes(b"fixture")
    monkeypatch.setattr(scanner, limit, 0)
    assert scanner.scan_payload(str(tmp_path))["status"] == "BLOCKED"


def test_mutation_during_read_is_blocked(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "file"
    path.write_bytes(b"fixture")
    real_read = scanner.read_record

    def mutate(*arguments: Any) -> Any:
        result = real_read(*arguments)
        path.write_bytes(b"changed fixture")
        return result

    monkeypatch.setattr(scanner, "read_record", mutate)
    report = scanner.scan_payload(str(tmp_path))
    assert report["status"] == "BLOCKED"
    assert report["error"]["code"] == "payload-changed"


def test_renamed_native_content_is_explicitly_not_proof(tmp_path: Path) -> None:
    (tmp_path / "ordinary.dll").write_bytes(b"renamed or statically linked CUDA")
    report = scanner.scan_payload(str(tmp_path))
    assert report["status"] == "LIMITED"
    assert report["nativeComponentAuditComplete"] is False
    assert report["cpuWorkflowProof"] == "NOT_RUN"