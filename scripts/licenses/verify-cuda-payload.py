"""LIC-03: bounded, read-only filename check of a quiescent Windows payload.

This is NOT a native component/license audit or CPU workflow proof. No payload
is extracted, executed, imported, downloaded, or modified. See the LIC-03 record.
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import ntpath
import os
import re
import stat
import sys
import time
from pathlib import Path
from typing import TypedDict, cast

MAX_ENTRIES = 100_000  # Files and directories, including root.
MAX_DEPTH = 64  # Components below root, including the filename.
MAX_FILE_BYTES = 8 * 1024**3
MAX_TOTAL_BYTES = 64 * 1024**3
MAX_SECONDS = 300
CHUNK_BYTES = 1024**2
NVIDIA_ALLOWLIST: tuple[str, ...] = ()  # No configuration/approval bypass.
NVIDIA_PREFIXES = (
    "cuda",
    "cublas",
    "cudnn",
    "cufft",
    "curand",
    "cusolver",
    "cusparse",
    "nppc",
    "nppi",
    "npps",
    "nvblas",
    "nvrtc",
    "nvvm",
    "nvjitlink",
    "nvjpeg",
    "nvtoolsext",
    "cupti",
    "nvcuda",
    "nvidia",
    "torch_cuda",
    "c10_cuda",
    "onnxruntime_providers_cuda",
    "onnxruntime_providers_tensorrt",
    "nvinfer",
    "nvonnxparser",
    "nvptxcompiler",
    "nvfatbin",
    "nvtx3interop",
    "culibos",
    "cufile",
    "cuobjclient",
    "cuobjserver",
    "device.",  # libdevice.10.bc after removing the optional lib prefix.
)
CUDA_TOOLS = (
    "nvcc",
    "ptxas",
    "fatbinary",
    "nvlink",
    "cudafe",
    "cicc",
    "cuobjdump",
    "nvdisasm",
    "cuda-gdb",
    "cuda-memcheck",
    "compute-sanitizer",
    "nvprof",
    "nsight",
    "nsys",
    "ncu",
)
NATIVE_SUFFIX = re.compile(
    r"\.(?:dll|exe|pyd|node|lib|a|so(?:\.[0-9]+)*|dylib|ptx|cubin|fatbin|"
    r"bc|obj|o|sys|pdb)$",
    re.IGNORECASE,
)
ARCHIVE_SUFFIXES = (
    ".zip", ".whl", ".egg", ".pyz", ".tar", ".gz", ".tgz", ".bz2",
    ".tbz", ".tbz2", ".xz", ".txz", ".lz", ".lzma", ".lz4", ".zst",
    ".zstd", ".7z", ".rar", ".cab", ".msi", ".msix", ".msixbundle",
    ".appx", ".appxbundle", ".asar", ".pak", ".jar", ".wim", ".esd",
    ".iso", ".img", ".vhd", ".vhdx", ".dmg", ".cpio", ".deb", ".rpm",
)
ARCHIVE_MAGIC = (
    b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08", b"7z\xbc\xaf\x27\x1c",
    b"Rar!\x1a\x07", b"\x1f\x8b", b"BZh", b"\xfd7zXZ\x00", b"MSCF",
    b"\x28\xb5\x2f\xfd", b"\x04\x22\x4d\x18", b"MSWIM\x00\x00\x00",
    b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",  # Compound storage (e.g. MSI).
)


class FileRecord(TypedDict):
    path: str
    sizeBytes: int
    sha256: str
    hardlinkCount: int


class ScanError(ValueError):
    """Known failure without exposing raw OS exception messages."""

    def __init__(self, code: str, path: str = ".") -> None:
        super().__init__(code)
        self.code = code
        self.path = path


def check_name(name: str) -> None:
    if (
        not name
        or name in (".", "..")
        or ntpath.isreserved(name)
        or any(c in '/\\<>:"|?*' or ord(c) < 32 for c in name)
        or any(0xD800 <= ord(c) <= 0xDFFF for c in name)
    ):
        raise ScanError("unsafe-path")


def root_path(text: str) -> Path:
    # Validate raw components BEFORE pathlib can collapse dot components.
    if len(text) > 32767 or not re.match(r"^[A-Za-z]:[\\/]", text):
        raise ScanError("absolute-local-directory-required")
    parts = text[3:].replace("/", "\\").split("\\")
    if parts[-1] == "":
        parts.pop()
    if not parts or len(parts) > MAX_DEPTH:
        raise ScanError("invalid-root-depth")
    for part in parts:
        check_name(part)
    return Path(text)


def drive_type(anchor: str) -> int:
    # System32 only; never load a DLL from the input payload/current directory.
    query = ctypes.WinDLL("kernel32", winmode=0x800).GetDriveTypeW
    query.argtypes = [ctypes.c_wchar_p]
    query.restype = ctypes.c_uint
    return int(query(anchor))


def check_time(deadline: float) -> None:
    # Cooperative deadline, not a timeout capable of preempting an OS I/O call.
    if time.monotonic() >= deadline:
        raise ScanError("scan-time-limit")


def safe_stat(path: Path) -> os.stat_result:
    info = path.lstat()
    attributes = cast(int, getattr(info, "st_file_attributes", 0))
    if stat.S_ISLNK(info.st_mode) or attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
        raise ScanError("reparse-or-symlink", str(path))
    if attributes & stat.FILE_ATTRIBUTE_OFFLINE:
        raise ScanError("offline-file", str(path))
    if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
        raise ScanError("special-file", str(path))
    return info


def directory_chain(path: Path) -> None:
    # Root first. Do not resolve() away evidence of a junction in an ancestor.
    for ancestor in (*reversed(path.parents), path):
        if not stat.S_ISDIR(safe_stat(ancestor).st_mode):
            raise ScanError("directory-required", str(ancestor))


def stamp(info: os.stat_result) -> tuple[int, ...]:
    # Windows lstat/fstat ctime can differ legitimately; do not compare them.
    return (
        info.st_dev, info.st_ino, info.st_mode, info.st_size,
        info.st_mtime_ns, info.st_nlink,
        cast(int, getattr(info, "st_file_attributes", 0)),
    )


def collect(root: Path, deadline: float) -> dict[Path, os.stat_result]:
    inventory = {root: safe_stat(root)}
    pending = [root]
    total = 0
    seen: set[str] = set()
    while pending:
        check_time(deadline)
        directory = pending.pop()
        directory_chain(directory)
        with os.scandir(directory) as entries:
            for entry in entries:
                check_time(deadline)
                if len(inventory) >= MAX_ENTRIES:
                    raise ScanError("entry-limit")
                check_name(entry.name)
                path = directory / entry.name
                relative = path.relative_to(root)
                if len(relative.parts) > MAX_DEPTH:
                    raise ScanError("depth-limit", relative.as_posix())
                folded = relative.as_posix().casefold()
                if folded in seen:
                    raise ScanError("case-collision", relative.as_posix())
                seen.add(folded)
                info = safe_stat(path)
                inventory[path] = info
                if stat.S_ISDIR(info.st_mode):
                    pending.append(path)
                else:
                    if info.st_nlink < 1 or not 0 <= info.st_size <= MAX_FILE_BYTES:
                        raise ScanError("invalid-file-size-or-links", relative.as_posix())
                    total += info.st_size
                    if total > MAX_TOTAL_BYTES:
                        raise ScanError("total-byte-limit")
    if total == 0:
        raise ScanError("empty-payload")
    return inventory


def banned_filename(name: str) -> bool:
    lowered = name.casefold()
    base = lowered.removeprefix("lib")
    # Device-code artifacts are CUDA payload even with an application basename.
    if lowered.endswith((".ptx", ".cubin", ".fatbin")):
        return True
    tool = base.startswith(CUDA_TOOLS)
    if NATIVE_SUFFIX.search(lowered):
        return tool or base.startswith(NVIDIA_PREFIXES)
    return tool and ("." not in base or lowered.endswith((".bat", ".cmd", ".com")))


def read_record(
    path: Path, root: Path, expected: os.stat_result, deadline: float
) -> FileRecord:
    relative = path.relative_to(root).as_posix()
    if path.name.casefold().endswith(ARCHIVE_SUFFIXES):
        raise ScanError("unexpanded-archive", relative)
    if expected.st_size == 0 and NATIVE_SUFFIX.search(path.name):
        raise ScanError("empty-native-file", relative)
    directory_chain(path.parent)
    if stamp(safe_stat(path)) != stamp(expected):
        raise ScanError("payload-changed", relative)
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        handle_before = os.fstat(stream.fileno())
        if stamp(handle_before) != stamp(expected):
            raise ScanError("payload-changed", relative)
        header = stream.read(min(512, expected.st_size))
        if header.startswith(ARCHIVE_MAGIC) or header[257:262] == b"ustar":
            raise ScanError("unexpanded-archive", relative)
        digest.update(header)
        remaining = expected.st_size - len(header)
        while remaining:
            check_time(deadline)
            chunk = stream.read(min(CHUNK_BYTES, remaining))
            if not chunk:
                raise ScanError("payload-changed", relative)
            digest.update(chunk)
            remaining -= len(chunk)
        if stream.read(1) or stamp(os.fstat(stream.fileno())) != stamp(handle_before):
            raise ScanError("payload-changed", relative)
    directory_chain(path.parent)
    if stamp(safe_stat(path)) != stamp(expected):
        raise ScanError("payload-changed", relative)
    return FileRecord(
        path=relative, sizeBytes=expected.st_size, sha256=digest.hexdigest(),
        hardlinkCount=expected.st_nlink,
    )


def base_report() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "decision": "LIC03-NONBUNDLE",
        "scope": "cuda-nonbundling-filenames",
        "assurance": "LIMITED",
        "status": "BLOCKED",
        "scanComplete": False,
        "nativeComponentAuditComplete": False,
        "cpuWorkflowProof": "NOT_RUN",
        "finalPayloadVerification": "NOT_RUN",
        "nvidiaAllowlist": list(NVIDIA_ALLOWLIST),
    }


def scan_payload(text: str) -> dict[str, object]:
    report = base_report()
    try:
        if sys.platform != "win32":
            raise ScanError("windows-required")
        root = root_path(text)
        if drive_type(root.anchor) not in (2, 3, 5, 6):
            raise ScanError("nonlocal-or-unknown-drive")
        deadline = time.monotonic() + MAX_SECONDS
        directory_chain(root)
        inventory = collect(root, deadline)
        records: list[FileRecord] = []
        violations: list[str] = []
        for path, info in sorted(inventory.items(), key=lambda item: str(item[0])):
            check_time(deadline)
            if stat.S_ISREG(info.st_mode):
                records.append(read_record(path, root, info, deadline))
                if banned_filename(path.name):
                    violations.append(path.relative_to(root).as_posix())
        for path, info in inventory.items():
            check_time(deadline)
            directory_chain(path.parent)
            if stamp(safe_stat(path)) != stamp(info):
                raise ScanError("payload-changed", path.relative_to(root).as_posix())
        manifest = json.dumps(records, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        report.update(
            status="FAIL" if violations else "LIMITED",
            scanComplete=True,
            root=str(root),
            fileCount=len(records),
            directoryCount=len(inventory) - len(records),
            totalBytes=sum(record["sizeBytes"] for record in records),
            files=records,
            manifestSha256=hashlib.sha256(manifest.encode("utf-8")).hexdigest(),
            violations=violations,
        )
    except ScanError as error:
        report["error"] = {"code": error.code, "path": error.path}
    except (OSError, ValueError) as error:
        report["error"] = {"code": "unreadable-or-invalid-input", "cause": type(error).__name__}
    return report


def main(arguments: list[str] | None = None) -> int:
    arguments = sys.argv[1:] if arguments is None else arguments
    if len(arguments) != 1:
        report = base_report()
        report["error"] = {"code": "usage: verify-cuda-payload.py ABSOLUTE_DIRECTORY"}
    else:
        report = scan_payload(arguments[0])
    print(json.dumps(report, ensure_ascii=True, sort_keys=True))
    return {"LIMITED": 0, "FAIL": 1, "BLOCKED": 2}[str(report["status"])]


if __name__ == "__main__":
    raise SystemExit(main())