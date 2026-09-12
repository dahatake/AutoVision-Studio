"""DAT-02: read-only Windows enumeration and encoded-byte inspection.

No decoding, EXIF, annotation parsing, persistent IDs, CLI or source writes.
HashedImage is an intermediate for DAT-03/04/05, NOT a validated ScanImage.
FR-SEC-003: runtime filesystem access is limited to local Windows drives.
Main owns picker authorization and selection-manifest lifetime; structural UNC
DTO acceptance grants no filesystem access. This module makes no HTTP requests.
"""

from __future__ import annotations

import hashlib
import os
import stat
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, TypedDict

from autovision_ml.data.import_contract import (
    MAX_ANNOTATION_BYTES,
    MAX_IMAGE_BYTES,
    MAX_INPUT_ITEMS,
    ImageFormat,
    ScanIssue,
    ScanSource,
    decode_selection_manifest,
    parse_scan_payload,
    parse_selection_manifest,
)
from autovision_ml.data.local_path import require_local_path

_CHUNK = 64 * 1024
_EXTENSIONS: dict[str, ImageFormat] = {
    ".jpg": "jpeg",
    ".jpeg": "jpeg",
    ".png": "png",
    ".webp": "webp",
    ".bmp": "bmp",
    ".tif": "tiff",
    ".tiff": "tiff",
}
type ProgressCallback = Callable[[int, int], None]
type CancelCheck = Callable[[], bool]
type _Chain = tuple[tuple[Path, os.stat_result], ...]


class HashedImage(TypedDict):
    key: str
    sourcePath: str
    byteSize: int
    mtimeNs: str
    sha256: str
    format: ImageFormat
    duplicateOf: str | None


@dataclass(frozen=True, slots=True)
class ImageScan:
    images: tuple[HashedImage, ...]
    issues: list[ScanIssue]


class Cancelled(RuntimeError):
    """Cooperative cancellation; DAT-01b must not turn this into success."""

    code = "CANCELLED"

    def __init__(self) -> None:
        super().__init__("Image scan cancelled")


class _Rejected(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__("Image scan input rejected")


def _cancel(check_cancel: CancelCheck | None) -> None:
    if check_cancel is not None and check_cancel():
        raise Cancelled()


def _source(value: object) -> ScanSource:
    # The public parser checks exact fields, including malicious untyped callers.
    # The adapter's mode is only for source validation, not an import-mode choice.
    for task in ("classification", "detection"):
        try:
            return parse_scan_payload(
                {"taskType": task, "mode": "reference", "source": value}
            )["source"]
        except ValueError:
            pass
    raise ValueError("Invalid import contract") from None


def _path(value: str) -> Path:
    # Enumerated names must satisfy the same lexical rules as picker paths.
    try:
        parse_selection_manifest({"formatVersion": 1, "files": [value]})
    except ValueError:
        raise _Rejected("UNSAFE_PATH") from None
    path = Path(value)
    if not path.is_absolute():
        raise _Rejected("UNSAFE_PATH")
    # No resolve(): it could follow an unchecked junction before inspection.
    return path.absolute()


def _chain(path: Path, check_cancel: CancelCheck | None) -> _Chain:
    try:
        require_local_path(path)
    except ValueError:
        raise _Rejected("UNSAFE_PATH") from None
    result: list[tuple[Path, os.stat_result]] = []
    for node in (*reversed(path.parents), path):
        _cancel(check_cancel)
        info = node.lstat()
        if stat.S_ISLNK(info.st_mode) or (
            getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
        ):
            raise _Rejected("UNSAFE_PATH")
        if node != path and not stat.S_ISDIR(info.st_mode):
            raise _Rejected("UNSAFE_PATH")
        result.append((node, info))
    return tuple(result)


def _identity(before: os.stat_result, after: os.stat_result) -> bool:
    return (
        before.st_dev == after.st_dev
        and before.st_ino == after.st_ino
        and stat.S_IFMT(before.st_mode) == stat.S_IFMT(after.st_mode)
        and before.st_nlink == after.st_nlink
    )


def _content(before: os.stat_result, after: os.stat_result) -> bool:
    return (
        _identity(before, after)
        and before.st_size == after.st_size
        and before.st_mtime_ns == after.st_mtime_ns
    )


def _snapshot(before: os.stat_result, after: os.stat_result) -> bool:
    # Windows CPython lstat/fstat ctime can differ for the SAME file. Compare
    # ctime only within the same API, with the path baseline taken after open.
    return _content(before, after) and before.st_ctime_ns == after.st_ctime_ns


def _ancestry(before: _Chain, after: _Chain) -> bool:
    return len(before) == len(after) and all(
        left_path == right_path and _identity(left, right)
        for (left_path, left), (right_path, right) in zip(before, after)
    )


def _regular(info: os.stat_result) -> None:
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise _Rejected("UNSAFE_FILE")
    if getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
        raise _Rejected("UNSAFE_PATH")


def _read(
    path: Path,
    limit: int,
    limit_code: str,
    check_cancel: CancelCheck | None,
    *,
    retain: bool = False,
    expected_chain: _Chain | None = None,
) -> tuple[os.stat_result, str, bytes]:
    before_chain = _chain(path, check_cancel)
    before = before_chain[-1][1]
    # Pin enumeration, including all ancestors, without comparing ctime across
    # capture and open: newly written files may settle before the read starts.
    if expected_chain is not None and (
        not _ancestry(expected_chain, before_chain)
        or not _content(expected_chain[-1][1], before)
    ):
        raise _Rejected("SOURCE_CHANGED")
    _regular(before)
    if before.st_size <= 0:
        raise _Rejected("EMPTY_FILE")
    if before.st_size > limit:
        raise _Rejected(limit_code)
    digest = hashlib.sha256()
    size = 0
    header = b""
    retained = bytearray()
    with path.open("rb", buffering=0) as stream:
        opened = os.fstat(stream.fileno())
        _regular(opened)
        opened_chain = _chain(path, check_cancel)
        path_opened = opened_chain[-1][1]
        if (
            not _ancestry(before_chain, opened_chain)
            or not _content(before, opened)
            or not _content(opened, path_opened)
        ):
            raise _Rejected("SOURCE_CHANGED")
        while True:
            _cancel(check_cancel)
            block = stream.read(min(_CHUNK, limit - size + 1))
            if not block:
                break
            size += len(block)
            if size > limit:
                raise _Rejected(limit_code)
            digest.update(block)
            if len(header) < 16:
                header = (header + block)[:16]
            if retain:
                retained.extend(block)
        after = os.fstat(stream.fileno())
        _regular(after)
        after_chain = _chain(path, check_cancel)
        path_after = after_chain[-1][1]
        if (
            size != opened.st_size
            or not _snapshot(opened, after)
            or not _snapshot(path_opened, path_after)
            or not _ancestry(opened_chain, after_chain)
            or not _content(after, path_after)
        ):
            raise _Rejected("SOURCE_CHANGED")
    # Closing is another replacement boundary. Keep the post-open lstat
    # baseline, not fstat ctime or metadata from an unread replacement.
    closed_chain = _chain(path, check_cancel)
    if not _ancestry(opened_chain, closed_chain) or not _snapshot(
        path_opened, closed_chain[-1][1]
    ):
        raise _Rejected("SOURCE_CHANGED")
    return opened, digest.hexdigest(), bytes(retained) if retain else header


def _magic(header: bytes) -> ImageFormat | None:
    if header.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "webp"
    if header.startswith(b"BM"):
        return "bmp"
    if header.startswith((b"II*\0", b"MM\0*", b"II+\0\x08\0\0\0", b"MM\0+\0\x08\0\0")):
        return "tiff"
    return None


def _issue(
    code: str,
    path: str,
    key: str | None = None,
    *,
    severity: Literal["error", "warning"] = "error",
    primary: str | None = None,
) -> ScanIssue:
    return {
        "severity": severity,
        "code": code,
        "target": {
            "imageKey": key,
            "sourcePath": path,
            "row": None,
            "itemId": primary,
        },
    }


def _enumerate(
    root: Path,
    excluded: Path | None,
    issues: list[ScanIssue],
    check_cancel: CancelCheck | None,
    candidate_chains: dict[str, _Chain],
) -> list[str]:
    candidates: list[str] = []
    stack: list[tuple[Path, _Chain | None]] = [(root, None)]
    visited: set[tuple[int, int]] = set()
    entries = 0
    while stack:
        _cancel(check_cancel)
        path, expected_parent = stack.pop()
        try:
            path = _path(str(path))
            current = _chain(path, check_cancel)
            if expected_parent is not None and not _ancestry(
                expected_parent, current[:-1]
            ):
                raise _Rejected("SOURCE_CHANGED")
            info = current[-1][1]
            if not stat.S_ISDIR(info.st_mode):
                if path == root:
                    raise _Rejected("DIRECTORY_REQUIRED")
                if path != excluded:
                    supplied = str(path)
                    candidates.append(supplied)
                    candidate_chains[supplied] = current
                continue
            identity = (info.st_dev, info.st_ino)
            if identity in visited:
                raise _Rejected("DIRECTORY_CYCLE")
            visited.add(identity)
            children: list[Path] = []
            with os.scandir(path) as directory:
                for entry in directory:
                    _cancel(check_cancel)
                    entries += 1
                    # Reuse the candidate budget for all visited entries too:
                    # empty directories/unsupported files cannot evade finiteness.
                    if entries > MAX_INPUT_ITEMS:
                        issues.append(_issue("INPUT_LIMIT_EXCEEDED", str(root)))
                        return []
                    children.append(path / entry.name)
            after = _chain(path, check_cancel)
            if not _ancestry(current, after) or not _snapshot(info, after[-1][1]):
                raise _Rejected("SOURCE_CHANGED")
            children.sort(key=lambda child: (child.name.casefold(), child.name))
            stack.extend((child, current) for child in reversed(children))
        except _Rejected as error:
            issues.append(_issue(error.code, str(path)))
        except OSError:
            issues.append(_issue("PATH_READ_FAILED", str(path)))
    return candidates


def enumerate_and_hash(
    source: ScanSource,
    on_progress: ProgressCallback | None = None,
    check_cancel: CancelCheck | None = None,
) -> ImageScan:
    """Scan raw candidates; never remove duplicates or claim decode success.

    Progress is (processed, total) after enumeration, counting failed candidates
    and repeated selections. Cancellation is checked at entries and read chunks;
    synchronous OS I/O itself cannot be interrupted by this callback. Errors are
    metadata-only issues. Empty/invalid scans include errors, not empty success.
    Keys are scan-local ``image:<zero-based candidate ordinal>``; duplicateOf
    always references the first successful candidate with the same raw SHA-256.
    Sources can change after return: DAT-03 must reopen and revalidate the raw
    hash before decoding and supplying dimensions. This result grants no access.
    """
    validated = _source(source)
    if os.name != "nt":
        raise ValueError("Image scan requires Windows")
    _cancel(check_cancel)
    issues: list[ScanIssue] = []
    paths: list[str] = []
    candidate_chains: dict[str, _Chain] = {}
    capture_errors: dict[str, str] = {}
    root_input: str | None = None
    if validated["format"] == "unlabeled":
        if validated["selection"] == "files":
            location = validated["selectionManifestPath"]
            try:
                _, _, contents = _read(
                    _path(location),
                    MAX_ANNOTATION_BYTES,
                    "SELECTION_MANIFEST_TOO_LARGE",
                    check_cancel,
                    retain=True,
                )
                paths = decode_selection_manifest(contents)["files"]
            except _Rejected as error:
                issues.append(_issue(error.code, location))
            except OSError:
                issues.append(_issue("SELECTION_MANIFEST_READ_FAILED", location))
            except ValueError:
                issues.append(_issue("SELECTION_MANIFEST_INVALID", location))
        else:
            location = validated["root"]
            root_input = location
    else:
        location = validated["root"]
        root_input = location
    if root_input is not None:
        excluded: Path | None = None
        if validated["format"] == "csv" or validated["format"] == "coco":
            excluded = _path(validated["annotationPath"])
        paths = _enumerate(
            _path(root_input), excluded, issues, check_cancel, candidate_chains
        )
    # Selection decoder also enforces this, before any deduplication.
    if len(paths) > MAX_INPUT_ITEMS:
        issues.append(_issue("INPUT_LIMIT_EXCEEDED", location))
        paths = []
    if root_input is None:
        # Capture selections before progress can change them. Cache only the
        # capture, not the ordered entries or their individual issue ordinals.
        for supplied in paths:
            _cancel(check_cancel)
            if supplied in candidate_chains or supplied in capture_errors:
                continue
            try:
                candidate_chains[supplied] = _chain(_path(supplied), check_cancel)
            except _Rejected as error:
                capture_errors[supplied] = error.code
            except OSError:
                capture_errors[supplied] = "IMAGE_READ_FAILED"
    total = len(paths)
    if on_progress is not None:
        on_progress(0, total)
    images: list[HashedImage] = []
    primaries: dict[str, str] = {}
    for index, supplied in enumerate(paths):
        _cancel(check_cancel)
        key = f"image:{index}"
        try:
            path = _path(supplied)
            expected = _EXTENSIONS.get(path.suffix.lower())
            if expected is None:
                raise _Rejected("UNSUPPORTED_EXTENSION")
            capture_code = capture_errors.get(supplied)
            if capture_code is not None:
                raise _Rejected(capture_code)
            info, digest, header = _read(
                path,
                MAX_IMAGE_BYTES,
                "IMAGE_TOO_LARGE",
                check_cancel,
                expected_chain=candidate_chains[supplied],
            )
            actual = _magic(header)
            if actual is None:
                raise _Rejected("UNSUPPORTED_IMAGE_FORMAT")
            if actual != expected:
                raise _Rejected("IMAGE_FORMAT_MISMATCH")
            primary = primaries.get(digest)
            image: HashedImage = {
                "key": key,
                "sourcePath": supplied,
                "byteSize": info.st_size,
                "mtimeNs": str(info.st_mtime_ns),
                "sha256": digest,
                "format": actual,
                "duplicateOf": primary,
            }
            images.append(image)
            if primary is None:
                primaries[digest] = key
            else:
                issues.append(
                    _issue(
                        "DUPLICATE_IMAGE",
                        supplied,
                        key,
                        severity="warning",
                        primary=primary,
                    )
                )
        except _Rejected as error:
            issues.append(_issue(error.code, supplied, key))
        except OSError:
            issues.append(_issue("IMAGE_READ_FAILED", supplied, key))
        if on_progress is not None:
            on_progress(index + 1, total)
    _cancel(check_cancel)
    if not images:
        issues.append(_issue("NO_VALID_IMAGES", location))
    return ImageScan(tuple(images), issues)
