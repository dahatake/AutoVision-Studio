"""DAT-01b: real Windows CLI/fixtures; no models, assets, network or Main UI.

Native tests use the selected executable, a fixed module, bounded waits and pipe
cleanup. Fault injection is confined to direct command tests, never CLI flags.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
import sys
import threading
import warnings
import zlib
from collections.abc import Callable, Sequence
from contextlib import ExitStack
from dataclasses import dataclass
from io import BytesIO, FileIO
from pathlib import Path
from queue import Queue
from typing import Protocol, cast
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest
from PIL import Image

from autovision_ml.commands import scan_dataset as command
from autovision_ml.data.image_scan import (
    CancelCheck,
    HashedImage,
    ImageScan,
    ProgressCallback,
)
from autovision_ml.data.import_contract import (
    MAX_INPUT_ITEMS,
    ImageFormat,
    ImportMode,
    ScanContext,
    ScanImage,
    ScanIssue,
    ScanResult,
    ScanSource,
    TaskType,
    decode_scan_result,
    parse_scan_result,
)
from autovision_ml.protocol import (
    MAX_WORKER_MESSAGE_BYTES,
    WorkerCorrelation,
    WorkerEvent,
    encode_worker_cancel,
    encode_worker_request,
    parse_worker_event_line,
)

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows-native scan command")
_PYTHON = str(Path(sys.executable).resolve(strict=True))
_ML = Path(__file__).resolve().parents[1]
_TIMEOUT = 30


@dataclass(frozen=True, slots=True)
class _Job:
    request: Path
    context: ScanContext

    @property
    def correlation(self) -> WorkerCorrelation:
        return {"jobId": self.context["jobId"], "projectId": self.context["projectId"]}


def _job(
    tmp_path: Path,
    source: ScanSource,
    task: TaskType = "classification",
    mode: ImportMode = "reference",
) -> _Job:
    context: ScanContext = {
        "jobId": str(uuid4()),
        "projectId": str(uuid4()),
        "taskType": task,
        "mode": mode,
    }
    directory = tmp_path / "jobs" / context["jobId"]
    directory.mkdir(parents=True)
    request = directory / "request.json"
    request.write_bytes(
        encode_worker_request(
            {
                "schemaVersion": 1,
                "jobId": context["jobId"],
                "projectId": context["projectId"],
                "kind": "scan-dataset",
                "payload": {"taskType": task, "mode": mode, "source": source},
            }
        ).encode("utf-8")
    )
    return _Job(request, context)


def _fixture(
    path: Path,
    kind: ImageFormat = "png",
    color: str = "red",
    orientation: int = 1,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with Image.new("RGB", (7, 5), color) as image:
        if kind == "bmp":
            image.save(path, format="BMP")
        else:
            exif = Image.Exif()
            exif[274] = orientation
            image.save(path, format=kind.upper(), exif=exif)
    return path


def _unlabeled(root: Path) -> ScanSource:
    return {"format": "unlabeled", "selection": "directory", "root": str(root)}


def _environment() -> dict[str, str]:
    environment = dict(os.environ)
    environment.update(
        PYTHONPATH=str(_ML / "src"),
        PYTHONIOENCODING="utf-8",
        PYTHONUNBUFFERED="1",
        PYTHONDONTWRITEBYTECODE="1",
        PYTHONNOUSERSITE="1",
    )
    environment.pop("PYTHONINSPECT", None)
    environment.pop("PYTHONSTARTUP", None)
    return environment


def _argv(arguments: Sequence[str]) -> list[str]:
    return [_PYTHON, "-m", "autovision_ml.cli", *arguments]


def _cli(
    arguments: Sequence[str], cwd: Path, controls: bytes = b""
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        _argv(arguments),
        cwd=cwd,
        env=_environment(),
        input=controls,  # Normal EOF, not inherited interactive stdin.
        capture_output=True,
        check=False,
        shell=False,
        timeout=_TIMEOUT,
    )


def _native(job: _Job, controls: bytes = b"") -> subprocess.CompletedProcess[bytes]:
    return _cli(
        ["scan-dataset", "--request", str(job.request)], job.request.parent, controls
    )


def _events(output: bytes, job: _Job) -> list[WorkerEvent]:
    assert output.endswith(b"\n")
    return [
        parse_worker_event_line(line, job.correlation)
        for line in output.splitlines(keepends=True)
    ]


def _success(
    process: subprocess.CompletedProcess[bytes], job: _Job, total: int
) -> ScanResult:
    assert process.returncode == 0
    assert process.stderr == b""
    events = _events(process.stdout, job)
    manifest = job.request.parent / "scan-result.json"
    result = decode_scan_result(manifest.read_bytes(), job.context)

    def diagnostics() -> dict[str, object]:
        # Assertion messages are lazy; expose only protocol counters and safe keys.
        return {
            "events": [
                (
                    event["type"],
                    event["processed"] if event["type"] == "progress" else None,
                    event["total"] if event["type"] == "progress" else None,
                )
                for event in events
            ],
            "issues": [
                {"code": issue["code"], "imageKey": issue["target"]["imageKey"]}
                for issue in result["issues"]
            ],
            "imageKeys": [image["key"] for image in result["images"]],
        }

    assert [event["type"] for event in events] == [
        "started",
        *(["progress"] * (total + 1)),
        "completed",
    ], diagnostics()
    for processed, event in enumerate(events[1:-1]):
        assert event == {
            "schemaVersion": 1,
            **job.correlation,
            "type": "progress",
            "source": "actual",
            "processed": processed,
            "total": total,
        }, diagnostics()
    assert events[-1] == {
        "schemaVersion": 1,
        **job.correlation,
        "type": "completed",
        "resultManifest": "scan-result.json",
    }, diagnostics()
    assert parse_scan_result(result, job.context) == result
    assert manifest.stat().st_nlink == 1
    assert not list(job.request.parent.glob(".scan-result-*.tmp"))
    assert set(result) == {
        "formatVersion",
        "jobId",
        "projectId",
        "taskType",
        "mode",
        "classes",
        "images",
        "issues",
    }
    for image in result["images"]:
        path = Path(image["sourcePath"])
        info = path.stat()
        assert image["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
        assert image["byteSize"] == info.st_size
        assert image["mtimeNs"] == str(info.st_mtime_ns)
        assert (image["width"], image["height"]) == (7, 5)
        assert str(path).encode("utf-8") not in process.stdout
        assert set(image) == {
            "key",
            "sourcePath",
            "byteSize",
            "mtimeNs",
            "sha256",
            "format",
            "width",
            "height",
            "orientation",
            "duplicateOf",
            "annotation",
        }
    return result


def _failed(process: subprocess.CompletedProcess[bytes], job: _Job, code: str) -> None:
    assert process.returncode == 1
    assert process.stderr == b""
    events = _events(process.stdout, job)
    assert events[0]["type"] == "started"
    assert events[-1] == {
        "schemaVersion": 1,
        **job.correlation,
        "type": "failed",
        "code": code,
    }
    assert all(event["type"] != "completed" for event in events)


def _invalid(process: subprocess.CompletedProcess[bytes]) -> None:
    assert process.returncode == 2 and process.stdout == b""
    assert process.stderr in (b"INVALID_REQUEST\n", b"INVALID_REQUEST\r\n")


def _snapshot(paths: Sequence[Path]) -> dict[Path, tuple[bytes, int, int]]:
    return {
        path: (path.read_bytes(), path.stat().st_ino, path.stat().st_mtime_ns)
        for path in paths
    }


def _cancel(job: _Job) -> bytes:
    return encode_worker_cancel(
        {"schemaVersion": 1, **job.correlation, "type": "cancel"}
    ).encode("utf-8")


def _direct(
    job: _Job, capsys: pytest.CaptureFixture[str], controls: bytes = b""
) -> subprocess.CompletedProcess[bytes]:
    # Test-only EOF synchronization: no thread-bypass path in production. Keep
    # using the real pipeline after the bounded input reader has actually exited.
    finished = threading.Event()
    threads: list[threading.Thread] = []
    bounds: list[int] = []
    original_thread = threading.Thread
    original_scan = command.enumerate_and_hash

    class Input(BytesIO):
        def readline(self, size: int | None = -1) -> bytes:
            assert size is not None
            bounds.append(size)
            return super().readline(size)

    def thread_factory(
        *, target: Callable[[], None], name: str, daemon: bool
    ) -> threading.Thread:
        assert name == "scan-dataset-control" and daemon

        def run() -> None:
            try:
                target()
            finally:
                finished.set()

        thread = original_thread(target=run, name=name, daemon=daemon)
        threads.append(thread)
        return thread

    def after_eof(
        source: ScanSource,
        on_progress: ProgressCallback | None = None,
        check_cancel: CancelCheck | None = None,
    ) -> ImageScan:
        assert finished.wait(timeout=5)
        return original_scan(source, on_progress, check_cancel)

    with (
        Input(controls) as stream,
        patch.object(command.sys, "stdin", stream),
        patch.object(command.threading, "Thread", side_effect=thread_factory),
        patch.object(command, "enumerate_and_hash", side_effect=after_eof),
    ):
        code = command.run_scan_dataset(job.request)
        for thread in threads:
            assert finished.wait(timeout=5)
            thread.join(timeout=1)  # Only after target completion, never unbounded.
            assert not thread.is_alive()
        assert len(threads) == (0 if code == 2 else 1)
        assert all(bound == MAX_WORKER_MESSAGE_BYTES + 1 for bound in bounds)
        assert not stream.closed  # Borrowed input is not closed by the command.
    captured = capsys.readouterr()
    return subprocess.CompletedProcess(
        [], code, captured.out.encode("utf-8"), captured.err.encode("utf-8")
    )


@pytest.mark.parametrize("mode", ["copy", "reference"])
def test_native_folder_hash_decode_labels_duplicates_and_no_source_writes(
    tmp_path: Path, mode: ImportMode
) -> None:
    root = tmp_path / "画像"
    first = _fixture(root / "健康" / "a.png")
    duplicate = first.with_name("c.png")
    duplicate.write_bytes(first.read_bytes())
    second = _fixture(root / "病気" / "b.png", color="blue")
    job = _job(tmp_path, {"format": "folder", "root": str(root)}, mode=mode)
    unknown = job.request.parent / "keep.txt"
    unknown.write_bytes(b"unknown owner")
    before = _snapshot([first, second, duplicate, job.request, unknown])
    result = _success(_native(job), job, 3)
    assert _snapshot(list(before)) == before
    assert [entry["name"] for entry in result["classes"]] == ["健康", "病気"]
    images = {image["sourcePath"]: image for image in result["images"]}
    assert images[str(duplicate)]["duplicateOf"] == images[str(first)]["key"]
    assert [issue["code"] for issue in result["issues"]] == ["DUPLICATE_IMAGE"]
    classes = {entry["key"]: entry["name"] for entry in result["classes"]}
    for image in images.values():
        annotation = image["annotation"]
        assert annotation is not None and annotation["type"] == "classification"
        assert classes[annotation["classKey"]] == Path(image["sourcePath"]).parent.name
        assert annotation["sourceRow"] is None
    assert {path.name for path in job.request.parent.iterdir()} == {
        "request.json",
        "scan-result.json",
        "keep.txt",
    }


def test_native_csv_path_label_bom_and_actual_output_correlation(
    tmp_path: Path,
) -> None:
    root = tmp_path / "csv-images"
    images = [_fixture(root / "a.png"), _fixture(root / "b.png", color="blue")]
    annotation = root / "labels.csv"  # Scanner must exclude this metadata file.
    annotation.write_bytes(
        "\ufeffpath,label\r\na.png,健康🌱\r\nb.png,病気\r\n".encode()
    )
    job = _job(
        tmp_path,
        {"format": "csv", "root": str(root), "annotationPath": str(annotation)},
    )
    before = _snapshot([*images, annotation, job.request])
    result = _success(_native(job), job, 2)
    assert result["issues"] == []
    assert _snapshot(list(before)) == before
    assert [image["annotation"] for image in result["images"]] == [
        {"type": "classification", "classKey": "class:0", "sourceRow": 2},
        {"type": "classification", "classKey": "class:1", "sourceRow": 3},
    ]
    raw = (job.request.parent / "scan-result.json").read_bytes()
    mismatches: list[ScanContext] = [
        {**job.context, "jobId": str(uuid4())},
        {**job.context, "projectId": str(uuid4())},
        {**job.context, "taskType": "detection"},
        {**job.context, "mode": "copy"},
    ]
    for context in mismatches:
        with pytest.raises(ValueError):
            decode_scan_result(raw, context)


def test_native_coco_raw_boxes_negative_image_and_all_item_defects(
    tmp_path: Path,
) -> None:
    root = tmp_path / "coco-images"
    paths = [
        _fixture(root / "a.png", orientation=6),
        _fixture(root / "b.png", color="blue"),
        _fixture(root / "c.png", color="green"),
    ]
    boxes = [[0.25, 1, 6.5, 3], [1, 0.5, 2.25, 4.5]]
    document = {
        "images": [
            {"id": 10, "file_name": "a.png", "width": 7, "height": 5},
            {"id": 11, "file_name": "b.png", "width": 7, "height": 5},
            {"id": 12, "file_name": "c.png", "width": 8, "height": 5},
        ],
        "categories": [{"id": 7, "name": "穂🌾"}],
        "annotations": [
            {"id": 2, "image_id": 10, "category_id": 7, "bbox": boxes[0]},
            {"id": 1, "image_id": 10, "category_id": 7, "bbox": boxes[1]},
            {"id": 3, "image_id": 10, "category_id": 7, "bbox": [-1, 0, 1, 1]},
            {"id": 4, "image_id": 12, "category_id": 7, "bbox": [0, 0, 1, 1]},
            {"id": 5, "image_id": 10, "category_id": 99, "bbox": [0, 0, 1, 1]},
        ],
        "info": {"description": "PRIVATE_METADATA", "url": "not-followed"},
    }
    annotation = tmp_path / "annotations.json"
    annotation.write_bytes(json.dumps(document, ensure_ascii=False).encode("utf-8"))
    job = _job(
        tmp_path,
        {"format": "coco", "root": str(root), "annotationPath": str(annotation)},
        task="detection",
    )
    before = _snapshot([*paths, annotation])
    process = _native(job)
    result = _success(process, job, 3)
    assert _snapshot(list(before)) == before
    first, negative, unavailable = result["images"]
    assert first["orientation"] == 6
    assert first["annotation"] == {
        "type": "detection",
        "sourceImageId": "10",
        "boxes": [
            {"classKey": "category:7", "bbox": boxes[0], "sourceAnnotationId": "2"},
            {"classKey": "category:7", "bbox": boxes[1], "sourceAnnotationId": "1"},
        ],
    }
    assert negative["annotation"] == {
        "type": "detection",
        "sourceImageId": "11",
        "boxes": [],
    }
    assert unavailable["annotation"] is None
    defects = {(issue["code"], issue["target"]["itemId"]) for issue in result["issues"]}
    assert defects == {
        ("COCO_IMAGE_DIMENSION_MISMATCH", "12"),
        ("BBOX_OUT_OF_BOUNDS", "3"),
        ("COCO_IMAGE_UNAVAILABLE", "4"),
        ("COCO_UNKNOWN_CATEGORY_ID", "5"),
    }
    assert all(issue["severity"] == "error" for issue in result["issues"])
    manifest_bytes = (job.request.parent / "scan-result.json").read_bytes()
    assert b"PRIVATE_METADATA" not in manifest_bytes
    assert b"PRIVATE_METADATA" not in process.stdout + process.stderr


@pytest.mark.parametrize("task", ["classification", "detection"])
@pytest.mark.parametrize("kind", ["jpeg", "png", "webp", "bmp", "tiff"])
def test_native_unlabeled_real_supported_formats(
    tmp_path: Path, task: TaskType, kind: ImageFormat
) -> None:
    root = tmp_path / "images"
    path = _fixture(root / f"a.{kind}", kind)
    before = _snapshot([path])
    job = _job(tmp_path, _unlabeled(root), task)
    result = _success(_native(job), job, 1)
    assert result["images"][0]["format"] == kind
    assert result["images"][0]["annotation"] is None
    assert result["classes"] == result["issues"] == []
    assert _snapshot([path]) == before


@pytest.mark.parametrize("mode", ["copy", "reference"])
def test_native_selection_manifest_outside_job_preserves_order(
    tmp_path: Path, mode: ImportMode
) -> None:
    first = _fixture(tmp_path / "source-a" / "a.png")
    second = _fixture(tmp_path / "source-b" / "b.png", color="blue")
    selection = tmp_path / "selection.json"
    files = [str(second), str(first), str(second)]
    selection.write_text(
        json.dumps({"formatVersion": 1, "files": files}),
        encoding="utf-8",
    )
    job = _job(
        tmp_path,
        {
            "format": "unlabeled",
            "selection": "files",
            "selectionManifestPath": str(selection),
        },
        mode=mode,
    )
    before = _snapshot([first, second, selection])
    result = _success(_native(job), job, 3)
    assert [image["sourcePath"] for image in result["images"]] == [
        str(second),
        str(first),
        str(second),
    ]
    assert result["images"][2]["duplicateOf"] == result["images"][0]["key"]
    assert _snapshot(list(before)) == before


@pytest.mark.parametrize("kind", ["jpeg", "png", "webp", "bmp", "tiff"])
@pytest.mark.parametrize("with_valid", [True, False])
def test_native_bad_decodes_keep_context_or_fail_when_all_bad(
    tmp_path: Path, kind: ImageFormat, with_valid: bool
) -> None:
    root = tmp_path / "images"
    broken = _fixture(root / f"a.{kind}", kind)
    raw = broken.read_bytes()
    broken.write_bytes(raw[: len(raw) // 2])
    paths = [broken]
    if with_valid:
        paths.append(_fixture(root / "b.png", color="blue"))
    before = _snapshot(paths)
    job = _job(tmp_path, _unlabeled(root))
    process = _native(job)
    if with_valid:
        result = _success(process, job, 2)
        assert len(result["images"]) == 1
        assert result["issues"] and result["issues"][0]["severity"] == "error"
        assert result["issues"][0]["target"] == {
            "imageKey": "image:0",
            "sourcePath": str(broken),
            "row": None,
            "itemId": None,
        }
    else:
        _failed(process, job, "NO_VALID_IMAGES")
        assert not (job.request.parent / "scan-result.json").exists()
    assert _snapshot(paths) == before


def test_native_malformed_png_gama_keeps_valid_image_and_completes(
    tmp_path: Path,
) -> None:
    root = tmp_path / "images"
    good = _fixture(root / "b.png")
    raw = good.read_bytes()
    iend = b"\x00\x00\x00\x00IEND\xaeB`\x82"
    assert raw.endswith(iend)
    # CRC-valid but empty gAMA after IDAT exercises Pillow's struct.error path.
    gama = b"\x00\x00\x00\x00gAMA" + zlib.crc32(b"gAMA").to_bytes(4, "big")
    bad = root / "a.png"
    bad.write_bytes(raw[: -len(iend)] + gama + iend)
    before = _snapshot([good, bad])
    job = _job(tmp_path, _unlabeled(root))

    result = _success(_native(job), job, 2)

    assert [image["sourcePath"] for image in result["images"]] == [str(good)]
    assert result["issues"] == [
        {
            "severity": "error",
            "code": "INVALID_IMAGE",
            "target": {
                "imageKey": "image:0",
                "sourcePath": str(bad),
                "row": None,
                "itemId": None,
            },
        }
    ]
    assert _snapshot([good, bad]) == before


@pytest.mark.parametrize("case", ["empty", "magic", "format", "animated"])
def test_native_hash_rejections_and_animation_are_not_fake_images(
    tmp_path: Path, case: str
) -> None:
    root = tmp_path / "images"
    good = _fixture(root / "b.png")
    bad = root / ("a.jpg" if case == "format" else "a.png")
    if case == "animated":
        with (
            Image.new("RGB", (7, 5), "red") as first,
            Image.new("RGB", (7, 5), "blue") as second,
        ):
            first.save(bad, format="PNG", save_all=True, append_images=[second])
    else:
        bad.write_bytes(
            {
                "empty": b"",
                "magic": b"PRIVATE_INVALID_IMAGE",
                "format": good.read_bytes(),
            }[case]
        )
    job = _job(tmp_path, _unlabeled(root))
    result = _success(_native(job), job, 2 if case == "animated" else 1)
    assert len(result["images"]) == 1
    assert result["issues"][0]["target"]["sourcePath"] == str(bad)
    assert (
        result["issues"][0]["code"]
        == {
            "empty": "EMPTY_FILE",
            "magic": "UNSUPPORTED_IMAGE_FORMAT",
            "format": "IMAGE_FORMAT_MISMATCH",
            "animated": "ANIMATED_IMAGE_UNSUPPORTED",
        }[case]
    )


@pytest.mark.parametrize(
    "case",
    [
        "empty-root",
        "csv-header",
        "csv-parse",
        "csv-encoding",
        "coco-parse",
        "coco-duplicate",
        "coco-nonfinite",
        "selection-parse",
        "selection-empty",
    ],
)
def test_native_source_failures_never_publish_partial_success(
    tmp_path: Path, case: str
) -> None:
    root = tmp_path / "images"
    root.mkdir()
    source: ScanSource = _unlabeled(root)
    task: TaskType = "classification"
    if case != "empty-root":
        _fixture(root / "a.png")
    if case.startswith("csv"):
        annotation = tmp_path / "labels.csv"
        annotation.write_bytes(
            {
                "csv-header": b"filename,label\na.png,x\n",
                "csv-parse": b'path,label\na.png,"unterminated',
                "csv-encoding": b"path,label\na.png,\xff\n",
            }[case]
        )
        source = {"format": "csv", "root": str(root), "annotationPath": str(annotation)}
    elif case.startswith("coco"):
        task = "detection"
        annotation = tmp_path / "labels.json"
        annotation.write_bytes(
            {
                "coco-parse": b'{"images":[',
                "coco-duplicate": (
                    b'{"images":[],"images":[],"categories":[],"annotations":[]}'
                ),
                "coco-nonfinite": (
                    b'{"images":[],"categories":[],"annotations":[],"x":NaN}'
                ),
            }[case]
        )
        source = {
            "format": "coco",
            "root": str(root),
            "annotationPath": str(annotation),
        }
    elif case.startswith("selection"):
        selection = tmp_path / "selection.json"
        selection.write_bytes(
            b"{" if case == "selection-parse" else b'{"formatVersion":1,"files":[]}'
        )
        source = {
            "format": "unlabeled",
            "selection": "files",
            "selectionManifestPath": str(selection),
        }
    job = _job(tmp_path, source, task)
    codes = {
        "empty-root": "NO_VALID_IMAGES",
        "csv-header": "CSV_INVALID_HEADER",
        "csv-parse": "CSV_MALFORMED",
        "csv-encoding": "CSV_INVALID_ENCODING",
        "coco-parse": "COCO_MALFORMED",
        "coco-duplicate": "COCO_DUPLICATE_MEMBER",
        "coco-nonfinite": "COCO_NONFINITE_NUMBER",
        "selection-parse": "SELECTION_MANIFEST_INVALID",
        "selection-empty": "SELECTION_MANIFEST_INVALID",
    }
    _failed(_native(job), job, codes[case])
    assert list(job.request.parent.iterdir()) == [job.request]


@pytest.mark.parametrize(
    "case",
    [
        "version",
        "extra",
        "duplicate",
        "duplicate-payload",
        "job-id",
        "project-id",
        "kind",
        "mode-missing",
        "mode-invalid",
        "task-invalid",
        "format-invalid",
        "extra-payload",
        "parse",
        "encoding",
        "bom",
        "oversized",
    ],
)
def test_native_invalid_request_is_uncorrelated_and_constant_only(
    tmp_path: Path, case: str
) -> None:
    path = _fixture(tmp_path / "images" / "a.png")
    job = _job(tmp_path, _unlabeled(path.parent))
    raw = job.request.read_bytes()
    replacements = {
        "version": (b'"schemaVersion":1', b'"schemaVersion":2'),
        "extra": (b'{"schemaVersion":1', b'{"private":"PRIVATE","schemaVersion":1'),
        "duplicate": (b'"schemaVersion":1', b'"schemaVersion":1,"schemaVersion":1'),
        "duplicate-payload": (
            b'"mode":"reference"',
            b'"mode":"copy","mode":"reference"',
        ),
        "job-id": (job.context["jobId"].encode(), b"invalid-job"),
        "project-id": (job.context["projectId"].encode(), b"invalid-project"),
        "kind": (b'"kind":"scan-dataset"', b'"kind":"train"'),
        "mode-missing": (b'"mode":"reference",', b""),
        "mode-invalid": (b'"mode":"reference"', b'"mode":"auto"'),
        "task-invalid": (b'"taskType":"classification"', b'"taskType":"bad"'),
        "format-invalid": (b'"format":"unlabeled"', b'"format":"zip"'),
        "extra-payload": (b'"payload":{', b'"payload":{"files":[],'),
    }
    if case in replacements:
        old, new = replacements[case]
        assert old in raw
        raw = raw.replace(old, new)
    else:
        raw = {
            "parse": b"{",
            "encoding": b"\xff",
            "bom": b"\xef\xbb\xbf" + raw,
            "oversized": raw + b" " * (MAX_WORKER_MESSAGE_BYTES + 1 - len(raw)),
        }[case]
    job.request.write_bytes(raw)
    process = _native(job)
    _invalid(process)
    assert job.request.read_bytes() == raw
    assert list(job.request.parent.iterdir()) == [job.request]


def test_native_exact_request_byte_limit_and_uppercase_payload_ids(
    tmp_path: Path,
) -> None:
    path = _fixture(tmp_path / "images" / "a.png")
    job = _job(tmp_path, _unlabeled(path.parent))
    raw = job.request.read_bytes()
    for value in (job.context["jobId"], job.context["projectId"]):
        raw = raw.replace(value.encode(), value.upper().encode())
    job.request.write_bytes(raw + b" " * (MAX_WORKER_MESSAGE_BYTES - len(raw)))
    assert job.request.stat().st_size == MAX_WORKER_MESSAGE_BYTES
    _success(_native(job), job, 1)


@pytest.mark.parametrize(
    "case", ["relative", "name", "job", "uppercase-job", "hardlink"]
)
def test_native_wrong_request_location_or_nonexclusive_file(
    tmp_path: Path, case: str
) -> None:
    path = _fixture(tmp_path / "images" / "a.png")
    job = _job(tmp_path, _unlabeled(path.parent))
    requested = str(job.request)
    if case == "relative":
        requested = "request.json"
    elif case == "name":
        renamed = job.request.with_name("other.json")
        job.request.rename(renamed)
        requested = str(renamed)
    elif case == "job":
        directory = job.request.parent.with_name(str(uuid4()))
        job.request.parent.rename(directory)
        requested = str(directory / "request.json")
    elif case == "uppercase-job":
        requested = requested.replace(
            job.context["jobId"], job.context["jobId"].upper()
        )
    else:
        os.link(job.request, tmp_path / "alias.json")
    process = _cli(["scan-dataset", "--request", requested], tmp_path)
    _invalid(process)
    assert not list(tmp_path.rglob("scan-result.json"))


@pytest.mark.parametrize(
    "arguments",
    [
        [],
        ["--request"],
        ["--request=PRIVATE"],
        ["--help"],
        ["--request", "--PRIVATE"],
        ["--request", "PRIVATE", "--extra", "PRIVATE"],
    ],
    ids=["missing", "missing-value", "equals", "help", "option-value", "extra"],
)
def test_native_scan_cli_syntax_never_echoes_arbitrary_input(
    tmp_path: Path, arguments: list[str]
) -> None:
    process = _cli(["scan-dataset", *arguments], tmp_path)
    _invalid(process)


def test_native_request_junction_ancestor_is_rejected(tmp_path: Path) -> None:
    import _winapi

    path = _fixture(tmp_path / "images" / "a.png")
    job = _job(tmp_path, _unlabeled(path.parent))
    parent = job.request.parent.parent
    moved = tmp_path / "retained-jobs"
    parent.rename(moved)
    _winapi.CreateJunction(str(moved), str(parent))
    try:
        process = _native(job)
        _invalid(process)
        assert not list(moved.rglob("scan-result.json"))
    finally:
        parent.rmdir()  # Remove only the test-owned junction, not its target.


def test_native_existing_result_and_unknown_files_are_never_overwritten(
    tmp_path: Path,
) -> None:
    path = _fixture(tmp_path / "images" / "a.png")
    job = _job(tmp_path, _unlabeled(path.parent))
    final = job.request.parent / "scan-result.json"
    final.write_bytes(b"UNOWNED_RESULT")
    other = job.request.parent / "unrelated.tmp"
    other.write_bytes(b"UNOWNED_OTHER")
    before = _snapshot([job.request, final, other, path])
    _failed(_native(job), job, "SCAN_RESULT_EXISTS")
    assert _snapshot(list(before)) == before
    assert {file.name for file in job.request.parent.iterdir()} == {
        "request.json",
        "scan-result.json",
        "unrelated.tmp",
    }


def _large_selection(tmp_path: Path) -> _Job:
    path = _fixture(tmp_path / "images" / "a.png")
    selection = tmp_path / "selection.json"
    selection.write_text(
        json.dumps({"formatVersion": 1, "files": [str(path)] * MAX_INPUT_ITEMS}),
        encoding="utf-8",
    )
    return _job(
        tmp_path,
        {
            "format": "unlabeled",
            "selection": "files",
            "selectionManifestPath": str(selection),
        },
    )


def _cancelled(process: subprocess.CompletedProcess[bytes], job: _Job) -> None:
    assert process.returncode == 1 and process.stderr == b""
    events = _events(process.stdout, job)
    assert events[0]["type"] == "started"
    assert events[-1] == {
        "schemaVersion": 1,
        **job.correlation,
        "type": "warning",
        "code": "CANCELLED",
    }
    assert all(event["type"] not in ("completed", "failed") for event in events)
    assert not (job.request.parent / "scan-result.json").exists()


def test_native_preloaded_cancel_with_eof(tmp_path: Path) -> None:
    job = _large_selection(tmp_path)
    _cancelled(_native(job, _cancel(job)), job)


def test_native_cancel_after_started_without_delay_or_mock_pipeline(
    tmp_path: Path,
) -> None:
    job = _large_selection(tmp_path)
    lines: Queue[bytes] = Queue()
    finished = threading.Event()
    with subprocess.Popen(
        _argv(["scan-dataset", "--request", str(job.request)]),
        cwd=job.request.parent,
        env=_environment(),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        shell=False,
    ) as process:
        assert process.stdin is not None and process.stdout is not None
        output = process.stdout

        def first_line() -> None:
            try:
                lines.put(output.readline(MAX_WORKER_MESSAGE_BYTES + 1))
            finally:
                finished.set()

        reader = threading.Thread(target=first_line, daemon=True)
        reader.start()
        try:
            started = lines.get(timeout=_TIMEOUT)
            event = parse_worker_event_line(started, job.correlation)
            assert event["type"] == "started"
            process.stdin.write(_cancel(job))
            process.stdin.flush()
            remaining, error = process.communicate(timeout=_TIMEOUT)
            _cancelled(
                subprocess.CompletedProcess(
                    [], process.returncode, started + remaining, error
                ),
                job,
            )
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=_TIMEOUT)
            assert finished.wait(timeout=5)
            reader.join(timeout=1)
            assert not reader.is_alive()


@pytest.mark.parametrize(
    "case",
    [
        "eof",
        "junk",
        "foreign-job",
        "foreign-project",
        "version",
        "extra",
        "duplicate",
        "unterminated",
        "utf8",
        "oversized",
        "oversized-suffix",
        "exact-limit",
        "valid",
        "oversized-then-valid",
    ],
)
def test_direct_control_framing_correlation_and_eof_scoped_thread(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], case: str
) -> None:
    path = _fixture(tmp_path / "images" / "a.png")
    job = _job(tmp_path, _unlabeled(path.parent))
    valid = _cancel(job)
    controls = {
        "eof": b"",
        "junk": b"PRIVATE_CONTROL\n",
        "foreign-job": valid.replace(
            job.context["jobId"].encode(), str(uuid4()).encode()
        ),
        "foreign-project": valid.replace(
            job.context["projectId"].encode(), str(uuid4()).encode()
        ),
        "version": valid.replace(b'"schemaVersion":1', b'"schemaVersion":2'),
        "extra": valid[:-2] + b',"payload":{}}\n',
        "duplicate": valid[:-2] + b',"type":"cancel"}\n',
        "unterminated": valid[:-1],
        "utf8": b"\xff\n",
        "oversized": b" " * MAX_WORKER_MESSAGE_BYTES + valid,
        "oversized-suffix": b"x" * (MAX_WORKER_MESSAGE_BYTES + 1) + valid,
        "exact-limit": b" " * (MAX_WORKER_MESSAGE_BYTES - len(valid)) + valid,
        "valid": valid,
        "oversized-then-valid": b"x" * (MAX_WORKER_MESSAGE_BYTES + 1) + b"\n" + valid,
    }[case]
    with patch.object(
        command, "parse_worker_cancel_line", wraps=command.parse_worker_cancel_line
    ) as parsed:
        process = _direct(job, capsys, controls)
        for call in parsed.call_args_list:
            assert call.args[1] == job.correlation  # Never the whole WorkerRequest.
    if case in ("valid", "exact-limit", "oversized-then-valid"):
        _cancelled(process, job)
    else:
        _success(process, job, 1)


@pytest.mark.parametrize("failed_count", [1, 2])
def test_direct_failed_primary_promotes_first_decoded_hash_without_orphan_issues(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], failed_count: int
) -> None:
    root = tmp_path / "images"
    paths = [_fixture(root / "A" / "a.png")]
    for name in ("b", "c"):
        paths.append(_fixture(root / "B" / f"{name}.png"))
        paths[-1].write_bytes(paths[0].read_bytes())
    job = _job(tmp_path, {"format": "folder", "root": str(root)})
    actual_decode = command.decode_image

    def changed(
        candidate: HashedImage, check_cancel: CancelCheck | None = None
    ) -> ScanImage:
        if int(candidate["key"].split(":")[1]) < failed_count:
            Path(candidate["sourcePath"]).write_bytes(b"changed after actual hash")
        return actual_decode(candidate, check_cancel)

    with (
        patch.object(command, "decode_image", side_effect=changed),
        patch.object(
            command, "import_classification", wraps=command.import_classification
        ) as imported,
    ):
        result = _success(_direct(job, capsys), job, 3)
        assert imported.call_args is not None
        candidates = cast(Sequence[HashedImage], imported.call_args.args[1])
        assert len(candidates) == 3
    assert len(result["images"]) == 3 - failed_count
    primary = result["images"][0]
    assert primary["duplicateOf"] is None and primary["key"] == f"image:{failed_count}"
    for image in result["images"][1:]:
        assert image["duplicateOf"] == primary["key"]
    successful = {image["key"] for image in result["images"]}
    for issue in result["issues"]:
        target = issue["target"]
        if target["imageKey"] not in successful:
            assert issue["severity"] == "error" and target["sourcePath"] is not None
        if issue["code"] == "DUPLICATE_IMAGE":
            assert target["itemId"] == primary["key"]
    failures = [
        issue for issue in result["issues"] if issue["code"] == "SOURCE_CHANGED"
    ]
    assert len(failures) == failed_count
    assert any(
        issue["code"] == "DUPLICATE_LABEL_CONFLICT" for issue in result["issues"]
    )


@pytest.mark.parametrize("code", ["INPUT_LIMIT_EXCEEDED", "SELECTION_MANIFEST_INVALID"])
def test_direct_fatal_source_issue_even_with_real_successful_candidates(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], code: str
) -> None:
    path = _fixture(tmp_path / "images" / "a.png")
    job = _job(tmp_path, _unlabeled(path.parent))
    actual_scan = command.enumerate_and_hash

    def failed_source(
        source: ScanSource,
        on_progress: ProgressCallback | None = None,
        check_cancel: CancelCheck | None = None,
    ) -> ImageScan:
        result = actual_scan(source, on_progress, check_cancel)
        issue: ScanIssue = {
            "severity": "error",
            "code": code,
            "target": {
                "imageKey": None,
                "sourcePath": str(path.parent),
                "row": None,
                "itemId": None,
            },
        }
        return ImageScan(result.images, [*result.issues, issue])

    with patch.object(command, "enumerate_and_hash", side_effect=failed_source):
        _failed(_direct(job, capsys), job, code)
    assert list(job.request.parent.iterdir()) == [job.request]


def test_direct_mapped_job_drive_is_rejected_before_lstat(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = _fixture(tmp_path / "images" / "a.png")
    job = _job(tmp_path, _unlabeled(path.parent))
    query = Mock(return_value=4)  # DRIVE_REMOTE; no actual remote drive mapping.
    with (
        patch(
            "autovision_ml.data.local_path.ctypes.WinDLL",
            return_value=Mock(GetDriveTypeW=query),
        ),
        patch.object(
            Path, "lstat", side_effect=AssertionError("Unexpected filesystem access")
        ) as observed_lstat,
    ):
        process = _direct(job, capsys)
    _invalid(process)
    query.assert_called_once_with(job.request.anchor)
    observed_lstat.assert_not_called()


@pytest.mark.parametrize("case", ["replace", "rewrite", "grow"])
def test_direct_request_changed_during_bounded_read_closes_handles(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], case: str
) -> None:
    path = _fixture(tmp_path / "images" / "a.png")
    job = _job(tmp_path, _unlabeled(path.parent))
    raw = job.request.read_bytes()
    initial = job.request.stat()
    changed = False
    streams: list[FileIO] = []
    reads: list[int] = []
    actual_lstat = Path.lstat

    class Reader(FileIO):
        def read(self, size: int | None = -1) -> bytes:
            nonlocal changed
            assert size is not None
            reads.append(size)
            block = super().read(size)
            assert block is not None
            if block and not changed and case != "replace":
                changed = True
                if case == "rewrite":
                    rewritten = raw.replace(
                        job.context["projectId"].encode(),
                        b"00000000-0000-0000-0000-000000000000",
                    )
                    with FileIO(job.request, "wb") as writer:
                        assert writer.write(rewritten) == len(raw)
                    os.utime(job.request, ns=(initial.st_atime_ns, initial.st_mtime_ns))
                else:
                    with FileIO(job.request, "ab") as writer:
                        writer.write(b" " * (MAX_WORKER_MESSAGE_BYTES + 1))
            return block

    def observed(file: Path) -> os.stat_result:
        nonlocal changed
        # Windows may prohibit renaming an open FileIO: inject at close boundary.
        if (
            case == "replace"
            and file == job.request
            and streams
            and streams[-1].closed
            and not changed
        ):
            changed = True
            job.request.rename(job.request.with_name("retained.json"))
            with FileIO(job.request, "wb") as writer:
                assert writer.write(raw) == len(raw)
        return actual_lstat(file)

    def opened(file: Path, mode: str = "r", buffering: int = -1) -> FileIO:
        assert file == job.request and mode == "rb" and buffering == 0
        stream = Reader(file, "rb")
        streams.append(stream)
        return stream

    with (
        patch.object(Path, "open", autospec=True, side_effect=opened),
        patch.object(Path, "lstat", autospec=True, side_effect=observed),
    ):
        process = _direct(job, capsys)
    _invalid(process)
    assert changed and streams and all(stream.closed for stream in streams)
    assert all(0 < size <= MAX_WORKER_MESSAGE_BYTES for size in reads)
    assert not (job.request.parent / "scan-result.json").exists()
    if case == "replace":
        assert job.request.stat().st_ino != initial.st_ino
        assert job.request.read_bytes() == raw
    elif case == "rewrite":
        assert job.request.read_bytes() != raw
        assert job.request.stat().st_mtime_ns == initial.st_mtime_ns
    else:
        assert job.request.stat().st_size > MAX_WORKER_MESSAGE_BYTES


def test_direct_job_directory_replacement_cannot_receive_result(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = _fixture(tmp_path / "images" / "a.png")
    job = _job(tmp_path, _unlabeled(path.parent))
    actual_scan = command.enumerate_and_hash
    retained = tmp_path / "retained-job"
    foreign = job.request.parent / "foreign.txt"

    def replace_directory(
        source: ScanSource,
        on_progress: ProgressCallback | None = None,
        check_cancel: CancelCheck | None = None,
    ) -> ImageScan:
        result = actual_scan(source, on_progress, check_cancel)
        job.request.parent.rename(retained)
        job.request.parent.mkdir()
        foreign.write_bytes(b"UNKNOWN")
        return result

    with patch.object(command, "enumerate_and_hash", side_effect=replace_directory):
        _failed(_direct(job, capsys), job, "SCAN_FAILED")
    assert list(job.request.parent.iterdir()) == [foreign]
    assert foreign.read_bytes() == b"UNKNOWN"
    assert not (retained / "scan-result.json").exists()


@pytest.mark.parametrize("case", ["sync", "link", "checksum", "temporary-replacement"])
def test_direct_publication_failures_are_controlled_and_never_claim_completion(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], case: str
) -> None:
    path = _fixture(tmp_path / "images" / "a.png")
    job = _job(tmp_path, _unlabeled(path.parent))
    actual_link = os.link
    final = job.request.parent / "scan-result.json"
    replaced: list[Path] = []

    def link(source: Path, target: Path, *, follow_symlinks: bool = True) -> None:
        assert source.parent == target.parent == job.request.parent
        assert target == final and not follow_symlinks
        if case == "link":
            raise OSError("PRIVATE_LINK_FAILURE")
        if case == "temporary-replacement":
            source.rename(source.with_suffix(".retained"))
            source.write_bytes(b"UNKNOWN_TEMPORARY_OWNER")
            replaced.append(source)
        actual_link(source, target, follow_symlinks=follow_symlinks)
        if case == "checksum":
            info = target.stat()
            raw = target.read_bytes()
            target.write_bytes(b" " + raw[1:])
            os.utime(target, ns=(info.st_atime_ns, info.st_mtime_ns))

    with patch.object(command.os, "link", side_effect=link):
        if case == "sync":
            with patch.object(
                command.os, "fsync", side_effect=OSError("PRIVATE_SYNC_FAILURE")
            ):
                process = _direct(job, capsys)
        else:
            process = _direct(job, capsys)
    _failed(process, job, "SCAN_FAILED")
    if replaced:
        assert replaced[0].read_bytes() == b"UNKNOWN_TEMPORARY_OWNER"
        assert final.read_bytes() == b"UNKNOWN_TEMPORARY_OWNER"
    elif case == "checksum":
        assert final.read_bytes().startswith(b" ")
    else:
        assert list(job.request.parent.iterdir()) == [job.request]


@pytest.mark.parametrize("adjustment", [-1, 0])
def test_direct_result_budget_counts_actual_utf8_and_releases_partial_output(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], adjustment: int
) -> None:
    root = tmp_path / "画像"
    _fixture(root / "健康🌱" / "a.png")
    source: ScanSource = {"format": "folder", "root": str(root)}
    baseline = _job(tmp_path, source)
    _success(_direct(baseline, capsys), baseline, 1)
    raw = (baseline.request.parent / "scan-result.json").read_bytes()
    assert len(raw) > len(raw.decode("utf-8"))
    job = _job(tmp_path, source)
    with patch.object(command, "MAX_SCAN_RESULT_BYTES", len(raw) + adjustment):
        process = _direct(job, capsys)
    if adjustment == 0:
        _success(process, job, 1)
    else:
        _failed(process, job, "SCAN_RESULT_TOO_LARGE")
        assert list(job.request.parent.iterdir()) == [job.request]


def test_direct_pillow_warning_logs_and_unexpected_exception_never_escape(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = tmp_path / "images"
    _fixture(root / "a.png")
    _fixture(root / "b.png", color="blue")
    job = _job(tmp_path, _unlabeled(root))
    actual_decode = command.decode_image
    previous = logging.root.manager.disable

    def warning(
        candidate: HashedImage, check_cancel: CancelCheck | None = None
    ) -> ScanImage:
        logging.getLogger("PIL").error("PRIVATE_IMAGE_METADATA")
        if candidate["key"] == "image:0":
            warnings.warn("PRIVATE_IMAGE_METADATA", UserWarning, stacklevel=1)
        return actual_decode(candidate, check_cancel)

    with patch.object(command, "decode_image", side_effect=warning):
        result = _success(_direct(job, capsys), job, 2)
    assert logging.root.manager.disable == previous
    assert len(result["images"]) == 1
    assert result["issues"][0]["code"] == "INVALID_IMAGE"
    other = _job(tmp_path, _unlabeled(root))
    with patch.object(
        command, "import_classification", side_effect=RuntimeError("PRIVATE_PATH")
    ):
        _failed(_direct(other, capsys), other, "SCAN_FAILED")
    assert not (other.request.parent / "scan-result.json").exists()


def test_direct_unexpected_classification_error_propagates_after_cleanup(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = _fixture(tmp_path / "images" / "a.png")
    job = _job(tmp_path, _unlabeled(path.parent))
    failure = AssertionError("PRIVATE_CLASSIFICATION_FAILURE")
    previous = logging.root.manager.disable

    class _ObservedControl(Protocol):
        closed: threading.Event
        done: threading.Event
        thread: threading.Thread

        def close(self) -> None: ...

    actual_control = cast(
        Callable[[WorkerCorrelation], _ObservedControl], vars(command)["_Control"]
    )
    controls: list[_ObservedControl] = []
    close_calls: list[Mock] = []

    def capture_control(expected: WorkerCorrelation) -> _ObservedControl:
        control = actual_control(expected)
        controls.append(control)
        close_calls.append(
            control_patches.enter_context(
                patch.object(control, "close", wraps=control.close)
            )
        )
        return control

    # _direct assumes a return code; own EOF and cleanup here even on propagation.
    with (
        ExitStack() as control_patches,
        BytesIO() as stream,
        patch.object(command.sys, "stdin", stream),
        patch.object(command, "_Control", side_effect=capture_control),
        patch.object(command, "import_classification", side_effect=failure) as imported,
    ):
        try:
            logging.disable(logging.WARNING)
            with pytest.raises(AssertionError) as caught:
                command.run_scan_dataset(job.request)
            assert caught.value is failure
            imported.assert_called_once()
            assert logging.root.manager.disable == logging.WARNING
            assert len(controls) == len(close_calls) == 1
            close_calls[0].assert_called_once_with()
            assert controls[0].closed.is_set()
            assert not stream.closed
        finally:
            logging.disable(previous)
            for control in controls:
                assert control.done.wait(timeout=5)
                control.thread.join(timeout=1)
                assert not control.thread.is_alive()

    captured = capsys.readouterr()
    assert captured.err == ""
    events = _events(captured.out.encode("utf-8"), job)
    assert [event["type"] for event in events] == ["started", "progress", "progress"]
    assert events[-1] == {
        "schemaVersion": 1,
        **job.correlation,
        "type": "progress",
        "source": "actual",
        "processed": 1,
        "total": 1,
    }
    assert list(job.request.parent.iterdir()) == [job.request]


def test_native_completion_does_not_wait_for_open_stdin(tmp_path: Path) -> None:
    path = _fixture(tmp_path / "images" / "a.png")
    job = _job(tmp_path, _unlabeled(path.parent))
    with subprocess.Popen(
        _argv(["scan-dataset", "--request", str(job.request)]),
        cwd=job.request.parent,
        env=_environment(),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        shell=False,
    ) as process:
        try:
            # One image produces only four short protocol lines; no pipe fill.
            code = process.wait(timeout=_TIMEOUT)
            assert process.stdin is not None and not process.stdin.closed
            output, error = process.communicate(timeout=_TIMEOUT)
            _success(subprocess.CompletedProcess([], code, output, error), job, 1)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=_TIMEOUT)


@pytest.mark.parametrize("phase", ["progress", "completed"])
def test_direct_cancel_acceptance_ends_at_terminal_choice(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], phase: str
) -> None:
    path = _fixture(tmp_path / "images" / "a.png")
    job = _job(tmp_path, _unlabeled(path.parent))
    release, entered, finished = threading.Event(), threading.Event(), threading.Event()
    original_thread = threading.Thread
    original_encode = command.encode_worker_event
    threads: list[threading.Thread] = []

    class Input(BytesIO):
        def readline(self, size: int | None = -1) -> bytes:
            assert size == MAX_WORKER_MESSAGE_BYTES + 1
            entered.set()
            assert release.wait(timeout=5)
            return super().readline(size)

    def thread_factory(
        *, target: Callable[[], None], name: str, daemon: bool
    ) -> threading.Thread:
        def run() -> None:
            try:
                target()
            finally:
                finished.set()

        thread = original_thread(target=run, name=name, daemon=daemon)
        threads.append(thread)
        return thread

    def encode(value: object) -> str:
        fields = cast(dict[str, object], value)
        if fields.get("type") == phase and fields.get("processed", 1) == 1:
            assert entered.wait(timeout=5)
            release.set()
            assert finished.wait(timeout=5)
        return original_encode(value)

    with (
        Input(_cancel(job)) as stream,
        patch.object(command.sys, "stdin", stream),
        patch.object(command.threading, "Thread", side_effect=thread_factory),
        patch.object(command, "encode_worker_event", side_effect=encode),
    ):
        try:
            code = command.run_scan_dataset(job.request)
        finally:
            release.set()
            assert finished.wait(timeout=5)
            for thread in threads:
                thread.join(timeout=1)
                assert not thread.is_alive()
    captured = capsys.readouterr()
    process = subprocess.CompletedProcess(
        [], code, captured.out.encode(), captured.err.encode()
    )
    if phase == "progress":
        _cancelled(process, job)
    else:
        _success(process, job, 1)
