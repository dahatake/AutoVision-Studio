"""DAT-01b: real read-only scan, invoked with Main's explicit request-file path.

The path is a Main/process boundary, not authorization of Renderer input. No DB,
source copies (DAT-06), confirmations, models or background process service.
Snapshots are not an OS-user sandbox; Main revalidates the result before use.
The command-local daemon reads raw stdin to avoid buffered-reader shutdown locks.
It exits on EOF or observes closed after its next read; a blocked OS read/native
decoder is not interrupted. Process exit/timeout belongs to JOB-04, not a claimed
thread-lifetime cleanup guarantee. Only controls accepted before terminal choice
under the lock are acknowledged. Serialized limits are not peak-memory limits.
An interrupted publication may retain an unaccepted final file; never adopt it
without completed/exit success and Main's validation, or delete unknown entries.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import stat
import sys
import threading
import warnings
from contextlib import suppress
from pathlib import Path
from typing import BinaryIO, cast
from uuid import uuid4

from autovision_ml.data.classification_import import (
    ImportFormatError,
    import_classification,
)
from autovision_ml.data.coco_import import CocoFormatError, import_coco
from autovision_ml.data.image_decode import DecodeError, decode_image
from autovision_ml.data.image_scan import (
    CancelCheck,
    Cancelled,
    HashedImage,
    enumerate_and_hash,
)
from autovision_ml.data.import_contract import (
    MAX_SCAN_RESULT_BYTES,
    ScanContext,
    ScanImage,
    ScanIssue,
    ScanPayload,
    ScanResult,
    parse_scan_payload,
    parse_scan_result,
    parse_selection_manifest,
)
from autovision_ml.data.local_path import require_local_path
from autovision_ml.protocol import (
    MAX_WORKER_MESSAGE_BYTES,
    WorkerCorrelation,
    encode_worker_event,
    parse_worker_cancel_line,
    parse_worker_request,
)

type _Chain = tuple[tuple[Path, int, int], ...]


def _require(condition: bool) -> None:
    if not condition:
        raise ValueError("Invalid scan boundary")


def _directories(path: Path) -> _Chain:
    require_local_path(path)
    entries: list[tuple[Path, int, int]] = []
    for node in (*reversed(path.parents), path):
        info = node.lstat()
        _require(stat.S_ISDIR(info.st_mode))
        attributes = getattr(info, "st_file_attributes", 0)
        _require(not attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT)
        entries.append((node, info.st_dev, info.st_ino))
    return tuple(entries)


def _stamp(info: os.stat_result, links: int = 1) -> tuple[int, ...]:
    _require(stat.S_ISREG(info.st_mode) and info.st_nlink == links)
    _require(
        not getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
    )
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


def _read(
    path: Path,
    limit: int,
    directories: _Chain,
    *,
    retain: bool = False,
    check_cancel: CancelCheck | None = None,
) -> tuple[bytes, str, tuple[int, ...]]:
    _require(_directories(path.parent) == directories)
    before = _stamp(path.lstat())
    _require(0 < before[2] <= limit)
    digest, contents, size = hashlib.sha256(), bytearray(), 0
    with path.open("rb", buffering=0) as stream:
        opened, baseline = os.fstat(stream.fileno()), path.lstat()
        _require(before == _stamp(opened) == _stamp(baseline))
        _require(_directories(path.parent) == directories)
        while True:
            if check_cancel is not None and check_cancel():
                raise Cancelled()
            block = stream.read(min(65536, limit - size + 1))
            if not block:
                break
            size += len(block)
            _require(size <= limit)
            digest.update(block)
            if retain:
                contents.extend(block)
        after = os.fstat(stream.fileno())
        _require(size == opened.st_size and before == _stamp(after))
        _require(opened.st_ctime_ns == after.st_ctime_ns)
    closed = path.lstat()
    # Windows lstat/fstat ctime may differ: compare only same-API baselines.
    _require(before == _stamp(closed) and baseline.st_ctime_ns == closed.st_ctime_ns)
    _require(_directories(path.parent) == directories)
    return bytes(contents), digest.hexdigest(), before


def _request(path: Path) -> tuple[ScanContext, ScanPayload, _Chain]:
    _require(os.name == "nt" and path.is_absolute() and path.name == "request.json")
    _require(not path.drive.startswith("\\\\"))  # JOB-04 owns a local job directory.
    parse_selection_manifest({"formatVersion": 1, "files": [str(path)]})
    directories = _directories(path.parent)
    contents, digest, stamp = _read(
        path, MAX_WORKER_MESSAGE_BYTES, directories, retain=True
    )
    _, second_digest, second_stamp = _read(path, MAX_WORKER_MESSAGE_BYTES, directories)
    _require((digest, stamp) == (second_digest, second_stamp))
    request = parse_worker_request(contents)
    payload = parse_scan_payload(request["payload"])
    _require(request["kind"] == "scan-dataset" and path.parent.name == request["jobId"])
    context: ScanContext = {
        "jobId": request["jobId"],
        "projectId": request["projectId"],
        "taskType": payload["taskType"],
        "mode": payload["mode"],
    }
    return context, payload, directories


def _emit(expected: WorkerCorrelation, **fields: object) -> None:
    sys.stdout.write(encode_worker_event({"schemaVersion": 1, **expected, **fields}))
    sys.stdout.flush()


class _Control:
    def __init__(self, expected: WorkerCorrelation) -> None:
        self.expected = expected.copy()
        self.closed = threading.Event()
        self.done = threading.Event()
        self.cancelled = threading.Event()
        self.lock = threading.Lock()
        self.failed = False
        supplied = getattr(sys.stdin, "buffer", sys.stdin)
        self.stream = cast(BinaryIO, getattr(supplied, "raw", supplied))
        self.thread = threading.Thread(
            target=self._read, name="scan-dataset-control", daemon=True
        )
        self.thread.start()

    def _read(self) -> None:
        discard = False
        try:
            while not self.closed.is_set():
                line = self.stream.readline(MAX_WORKER_MESSAGE_BYTES + 1)
                if not line:
                    break
                if discard or len(line) > MAX_WORKER_MESSAGE_BYTES:
                    discard = not line.endswith(b"\n")
                    continue  # Never parse an oversized line's suffix as control.
                try:
                    parse_worker_cancel_line(line, self.expected)
                except ValueError:
                    continue  # Malformed/foreign controls are not cancellation.
                with self.lock:
                    if not self.closed.is_set():
                        self.cancelled.set()
        except (OSError, ValueError, TypeError, RuntimeError, MemoryError):
            with self.lock:
                if not self.closed.is_set():
                    self.failed = True  # No threading traceback or input echo.
        finally:
            self.done.set()

    def check(self) -> bool:
        if self.cancelled.is_set():
            raise Cancelled()
        _require(not self.failed)
        return False

    def close(self) -> None:
        with self.lock:
            self.closed.set()
        if self.done.is_set():
            self.thread.join(timeout=0)


def _issue(image: HashedImage, code: str, primary: str | None = None) -> ScanIssue:
    return {
        "severity": "error" if primary is None else "warning",
        "code": code,
        "target": {
            "imageKey": image["key"],
            "sourcePath": image["sourcePath"],
            "row": None,
            "itemId": primary,
        },
    }


def _scan(payload: ScanPayload, context: ScanContext, control: _Control) -> ScanResult:
    scanned = enumerate_and_hash(payload["source"], check_cancel=control.check)
    issues = [item for item in scanned.issues if item["code"] != "DUPLICATE_IMAGE"]
    for issue in issues:
        if issue["code"] == "INPUT_LIMIT_EXCEEDED" or issue["code"].startswith(
            "SELECTION_MANIFEST_"
        ):
            raise ImportFormatError(issue["code"])
    # This single progress series counts completed DECODE attempts, including
    # failures. Enumeration/hash has no progress callback and cannot reset it.
    total = len(scanned.images)
    _emit(control.expected, type="progress", source="actual", processed=0, total=total)
    images: list[ScanImage] = []
    primaries: dict[str, str] = {}
    for processed, candidate in enumerate(scanned.images, 1):
        control.check()
        try:
            image = decode_image(candidate, check_cancel=control.check)
        except DecodeError as error:
            issues.append(_issue(candidate, error.code))
        except Warning:
            issues.append(_issue(candidate, "INVALID_IMAGE"))
        else:
            primary = primaries.get(image["sha256"])
            image["duplicateOf"] = primary
            if primary is None:
                primaries[image["sha256"]] = image["key"]
            else:
                issues.append(_issue(candidate, "DUPLICATE_IMAGE", primary))
            images.append(image)
        _emit(
            control.expected,
            type="progress",
            source="actual",
            processed=processed,
            total=total,
        )
    if not images:
        raise ImportFormatError("NO_VALID_IMAGES")
    control.check()
    labels = (
        import_classification(payload["source"], scanned.images)
        if context["taskType"] == "classification"
        else import_coco(payload["source"], images)
    )
    issues.extend(labels.issues)  # Errors for failed raw keys retain source context.
    for image in images:
        image["annotation"] = labels.annotations[image["key"]]
    control.check()
    return parse_scan_result(
        {
            "formatVersion": 1,
            **context,
            "classes": list(labels.classes),
            "images": images,
            "issues": issues,
        },
        context,
    )


def _publish(
    directory: Path,
    directories: _Chain,
    result: ScanResult,
    control: _Control,
) -> None:
    temporary = directory / f".scan-result-{uuid4().hex}.tmp"
    final = directory / "scan-result.json"
    owned: tuple[int, ...] | None = None
    try:
        control.check()
        _require(_directories(directory) == directories)
        with temporary.open("xb") as stream:
            owned = _stamp(os.fstat(stream.fileno()))
            _require(_directories(directory) == directories)
            digest, size = hashlib.sha256(), 0
            encoder = json.JSONEncoder(
                ensure_ascii=False, allow_nan=False, separators=(",", ":")
            )
            for text in encoder.iterencode(result):
                control.check()
                block = text.encode("utf-8")
                size += len(block)
                if size > MAX_SCAN_RESULT_BYTES:
                    raise ImportFormatError("SCAN_RESULT_TOO_LARGE")
                _require(stream.write(block) == len(block))
                digest.update(block)
            stream.flush()
            os.fsync(stream.fileno())
            written = _stamp(os.fstat(stream.fileno()))
            _require(written[2] == size)
        for path in (temporary, final):
            _, actual_digest, actual_stamp = _read(
                path, MAX_SCAN_RESULT_BYTES, directories, check_cancel=control.check
            )
            _require(actual_stamp == written and actual_digest == digest.hexdigest())
            control.check()
            _require(_directories(directory) == directories)
            if path == temporary:
                _require(_stamp(temporary.lstat()) == written)
                os.link(temporary, final, follow_symlinks=False)  # Atomic no-clobber.
                _require(_directories(directory) == directories)
                _require(
                    _stamp(temporary.lstat(), 2) == _stamp(final.lstat(), 2) == written
                )
                temporary.unlink()  # Only the verified temporary entry we own.
    finally:
        if owned is not None:
            # Unknown/replaced entries and unconfirmed directories survive.
            with suppress(OSError, ValueError):
                _require(_directories(directory) == directories)
                _require(_stamp(temporary.lstat())[:2] == owned[:2])
                temporary.unlink()


def run_scan_dataset(request_path: Path) -> int:
    """Execute Main's request; stdout is protocol only, including controlled errors."""
    try:
        context, payload, directories = _request(request_path)
    except (
        OSError,
        ValueError,
        TypeError,
        RecursionError,
        KeyError,
        IndexError,
        OverflowError,
        MemoryError,
        KeyboardInterrupt,
    ):
        print("INVALID_REQUEST", file=sys.stderr)
        return 2
    expected: WorkerCorrelation = {
        "jobId": context["jobId"],
        "projectId": context["projectId"],
    }
    terminal: dict[str, object] = {"type": "failed", "code": "SCAN_FAILED"}
    control: _Control | None = None
    previous_logging = logging.root.manager.disable
    try:
        logging.disable(logging.CRITICAL)
        try:
            _emit(expected, type="started")
            control = _Control(expected)
            with warnings.catch_warnings():
                warnings.simplefilter("error")
                result = _scan(payload, context, control)
                _publish(request_path.parent, directories, result, control)
            terminal = {"type": "completed", "resultManifest": "scan-result.json"}
        except Cancelled:
            terminal = {"type": "warning", "code": "CANCELLED"}
        except (ImportFormatError, CocoFormatError) as error:
            terminal["code"] = error.code
        except FileExistsError:
            terminal["code"] = "SCAN_RESULT_EXISTS"
        except (
            OSError,
            ValueError,
            TypeError,
            RuntimeError,
            KeyError,
            IndexError,
            OverflowError,
            MemoryError,
            KeyboardInterrupt,
        ):
            # Fixed fallback; never print exception text, stack, paths or pixels.
            terminal = {"type": "failed", "code": "SCAN_FAILED"}
        try:
            if control is not None:
                with control.lock:
                    control.closed.set()
                    if control.cancelled.is_set():
                        terminal = {"type": "warning", "code": "CANCELLED"}
                    elif control.failed:
                        terminal = {"type": "failed", "code": "SCAN_FAILED"}
            _emit(expected, **terminal)
            return 0 if terminal["type"] == "completed" else 1
        except (
            OSError,
            ValueError,
            TypeError,
            RuntimeError,
            KeyError,
            OverflowError,
            MemoryError,
            KeyboardInterrupt,
        ):
            return 1
    finally:
        try:
            if control is not None:
                control.close()
        finally:
            logging.disable(previous_logging)
