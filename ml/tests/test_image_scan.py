"""DAT-02 native local fixtures; headers are NOT evidence of successful decoding.

No sample preparation imports, downloads, source assets, CLI or subprocesses.
All filesystem mutation below is limited to pytest's temporary fixtures.
"""

from __future__ import annotations

import hashlib
import json
import os
import socket
from collections.abc import Callable, Iterator
from io import FileIO
from pathlib import Path
from typing import Literal, Self
from unittest.mock import patch

import pytest

from autovision_ml.data.image_scan import Cancelled, enumerate_and_hash
from autovision_ml.data.import_contract import (
    MAX_ANNOTATION_BYTES,
    MAX_IMAGE_BYTES,
    ScanSource,
    parse_scan_payload,
)

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows-native scan")

PNG = b"\x89PNG\r\n\x1a\nsynthetic encoded payload"
FORMATS: list[tuple[str, bytes, str]] = [
    ("a.JPG", b"\xff\xd8\xffsynthetic", "jpeg"),
    ("b.jpeg", b"\xff\xd8\xffother", "jpeg"),
    ("c.PNG", PNG, "png"),
    ("d.WeBp", b"RIFF\x14\0\0\0WEBPVP8 synthetic", "webp"),
    ("e.bmp", b"BMsynthetic", "bmp"),
    ("f.tif", b"II*\0synthetic", "tiff"),
    ("g.TIFF", b"MM\0*synthetic", "tiff"),
    ("h.tif", b"II+\0\x08\0\0\0synthetic", "tiff"),
    ("i.tiff", b"MM\0+\0\x08\0\0synthetic", "tiff"),
]


class _ReadStream:
    """Wrap a real read-only file without replacing its bytes or descriptor."""

    def __init__(self, stream: FileIO) -> None:
        self.stream = stream

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_args: object) -> None:
        self.stream.close()

    def fileno(self) -> int:
        return self.stream.fileno()

    def read(self, size: int) -> bytes:
        block = self.stream.read(size)
        assert block is not None
        return block


def _with_ctime(info: os.stat_result, ctime_ns: int) -> os.stat_result:
    # Preserve real identity, content and platform fields; vary only ctime.
    fields: dict[str, int | float] = {
        "st_atime": info.st_atime,
        "st_mtime": info.st_mtime,
        "st_ctime": ctime_ns / 1_000_000_000,
        "st_atime_ns": info.st_atime_ns,
        "st_mtime_ns": info.st_mtime_ns,
        "st_ctime_ns": ctime_ns,
    }
    for name in (
        "st_file_attributes",
        "st_reparse_tag",
        "st_birthtime",
        "st_birthtime_ns",
    ):
        value: object = getattr(info, name, None)
        if isinstance(value, (int, float)):
            fields[name] = value
    return os.stat_result(info, fields)


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("Network access forbidden in image scan tests")

    monkeypatch.setattr(socket, "create_connection", blocked)
    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket.socket, "connect_ex", blocked)
    monkeypatch.setattr(socket, "getaddrinfo", blocked)


def directory_source(root: Path) -> ScanSource:
    return {"format": "unlabeled", "selection": "directory", "root": str(root)}


def selection_source(manifest: Path, paths: list[Path]) -> ScanSource:
    manifest.write_text(
        json.dumps({"formatVersion": 1, "files": [str(path) for path in paths]}),
        encoding="utf-8",
    )
    return {
        "format": "unlabeled",
        "selection": "files",
        "selectionManifestPath": str(manifest),
    }


@pytest.mark.parametrize(("name", "contents", "expected"), FORMATS)
def test_formats_hash_metadata_only_and_original_bytes(
    tmp_path: Path,
    name: str,
    contents: bytes,
    expected: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    path = tmp_path / name
    path.write_bytes(contents)
    before = path.stat()
    scanned = enumerate_and_hash(directory_source(tmp_path))
    assert scanned.issues == []
    assert len(scanned.images) == 1
    image = scanned.images[0]
    assert image == {
        "key": "image:0",
        "sourcePath": str(path),
        "byteSize": len(contents),
        "mtimeNs": str(before.st_mtime_ns),
        "sha256": hashlib.sha256(contents).hexdigest(),
        "format": expected,
        "duplicateOf": None,
    }
    assert not {"width", "height", "orientation", "annotation"}.intersection(image)
    assert path.read_bytes() == contents
    assert path.stat().st_mtime_ns == before.st_mtime_ns
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


@pytest.mark.parametrize(
    ("name", "contents", "expected"),
    FORMATS,
    ids=[name for name, _, _ in FORMATS],
)
def test_short_reads_accumulate_header_and_complete_hash(
    tmp_path: Path, name: str, contents: bytes, expected: str
) -> None:
    path = tmp_path / name
    path.write_bytes(contents)
    requested: list[int] = []
    blocks: list[bytes] = []

    class ShortReads(_ReadStream):
        def read(self, size: int) -> bytes:
            requested.append(size)
            block = super().read(min(size, 2))
            blocks.append(block)
            return block

    with (
        path.open("rb", buffering=0) as stream,
        patch.object(Path, "open", return_value=ShortReads(stream)) as opened,
    ):
        scanned = enumerate_and_hash(directory_source(tmp_path))
        assert stream.closed
        opened.assert_called_once_with("rb", buffering=0)
    assert scanned.issues == []
    assert len(scanned.images) == 1
    assert scanned.images[0]["format"] == expected
    assert scanned.images[0]["byteSize"] == len(contents)
    assert scanned.images[0]["sha256"] == hashlib.sha256(contents).hexdigest()
    assert requested[0] > 2
    assert blocks[-1] == b""
    assert all(0 < len(block) <= 2 for block in blocks[:-1])
    assert b"".join(blocks) == contents
    assert path.read_bytes() == contents


def test_sorted_dfs_hidden_names_and_duplicate_primary(tmp_path: Path) -> None:
    nested = tmp_path / "A-class"
    nested.mkdir()
    (tmp_path / "z.png").write_bytes(PNG)
    (nested / "b.png").write_bytes(PNG)
    (nested / "a.png").write_bytes(PNG + b"different")
    (tmp_path / ".hidden.png").write_bytes(PNG)
    source: ScanSource = {"format": "folder", "root": str(tmp_path)}
    scanned = enumerate_and_hash(source)
    assert [Path(image["sourcePath"]).name for image in scanned.images] == [
        ".hidden.png",
        "a.png",
        "b.png",
        "z.png",
    ]
    assert [image["duplicateOf"] for image in scanned.images] == [
        None,
        None,
        "image:0",
        "image:0",
    ]
    assert all(issue["code"] == "DUPLICATE_IMAGE" for issue in scanned.issues)
    assert all(issue["severity"] == "warning" for issue in scanned.issues)
    assert all(issue["target"]["itemId"] == "image:0" for issue in scanned.issues)
    assert enumerate_and_hash(source) == scanned


def test_selection_order_repeats_failures_real_progress_and_manifest_unchanged(
    tmp_path: Path,
) -> None:
    root = tmp_path / "images"
    root.mkdir()
    a, b, missing = root / "a.png", root / "b.png", root / "missing.png"
    a.write_bytes(PNG)
    b.write_bytes(PNG)
    manifest = tmp_path / "selection.json"
    source = selection_source(manifest, [b, missing, a, b])
    before = manifest.read_bytes()
    progress: list[tuple[int, int]] = []
    scanned = enumerate_and_hash(
        source, lambda done, total: progress.append((done, total))
    )
    assert [item["sourcePath"] for item in scanned.images] == [str(b), str(a), str(b)]
    assert [item["key"] for item in scanned.images] == ["image:0", "image:2", "image:3"]
    assert [item["duplicateOf"] for item in scanned.images] == [
        None,
        "image:0",
        "image:0",
    ]
    assert progress == [(0, 4), (1, 4), (2, 4), (3, 4), (4, 4)]
    assert scanned.issues[0]["target"]["imageKey"] == "image:1"
    assert scanned.issues[0]["target"]["sourcePath"] == str(missing)
    assert manifest.read_bytes() == before
    assert sorted(path.name for path in tmp_path.iterdir()) == [
        "images",
        "selection.json",
    ]


@pytest.mark.parametrize("kind", ["csv", "coco"])
def test_only_explicit_annotation_is_excluded(tmp_path: Path, kind: str) -> None:
    image = tmp_path / "原画像.png"
    image.write_bytes(PNG)
    annotation = tmp_path / "annotation.txt"
    annotation.write_bytes(b"annotation bytes must not be parsed or echoed")
    (tmp_path / "LICENSE.txt").write_bytes(b"not an image")
    source = parse_scan_payload(
        {
            "taskType": "detection" if kind == "coco" else "classification",
            "mode": "reference",
            "source": {
                "format": kind,
                "root": str(tmp_path),
                "annotationPath": str(annotation),
            },
        }
    )["source"]
    scanned = enumerate_and_hash(source)
    assert len(scanned.images) == 1
    assert [issue["code"] for issue in scanned.issues] == ["UNSUPPORTED_EXTENSION"]
    assert scanned.issues[0]["target"]["sourcePath"] == str(tmp_path / "LICENSE.txt")


@pytest.mark.parametrize(
    ("name", "contents", "code"),
    [
        ("a.txt", PNG, "UNSUPPORTED_EXTENSION"),
        ("a.gif", b"GIF89a", "UNSUPPORTED_EXTENSION"),
        ("a.jpe", b"\xff\xd8\xff", "UNSUPPORTED_EXTENSION"),
        ("a.jpg", PNG, "IMAGE_FORMAT_MISMATCH"),
        ("a.png", b"private metadata", "UNSUPPORTED_IMAGE_FORMAT"),
        ("a.webp", b"RIFF\0\0\0\0WAVE", "UNSUPPORTED_IMAGE_FORMAT"),
        ("a.tif", b"II+\0\x08\0\0", "UNSUPPORTED_IMAGE_FORMAT"),
        ("a.png", b"", "EMPTY_FILE"),
    ],
)
def test_bad_files_have_repair_context_not_fake_images(
    tmp_path: Path, name: str, contents: bytes, code: str
) -> None:
    path = tmp_path / name
    path.write_bytes(contents)
    scanned = enumerate_and_hash(directory_source(tmp_path))
    assert scanned.images == ()
    assert scanned.issues[0]["code"] == code
    assert scanned.issues[0]["target"]["sourcePath"] == str(path)
    assert scanned.issues[0]["target"]["imageKey"] == "image:0"
    assert scanned.issues[-1]["code"] == "NO_VALID_IMAGES"
    assert path.read_bytes() == contents


@pytest.mark.parametrize(
    "root",
    ["relative", "C:a.png", "C:\\x\\..\\y", "C:\\NUL.png", "C:\\x\0.png"],
)
def test_runtime_source_validation_precedes_io(root: str) -> None:
    unchecked: list[Callable[..., object]] = [enumerate_and_hash]
    with patch.object(Path, "lstat", side_effect=AssertionError("unexpected I/O")):
        with pytest.raises(ValueError, match="^Invalid import contract$"):
            unchecked[0]({"format": "folder", "root": root})
        with pytest.raises(ValueError, match="^Invalid import contract$"):
            unchecked[0]({"format": "folder", "root": "C:\\images", "extra": True})
        with pytest.raises(ValueError, match="^Invalid import contract$"):
            unchecked[0](None)


@pytest.mark.parametrize("payload", [b"{}", b"\xff", b'{"formatVersion":1,"files":[]}'])
def test_invalid_selection_manifest_is_not_empty_success(
    tmp_path: Path, payload: bytes
) -> None:
    path = tmp_path / "selection.json"
    path.write_bytes(payload)
    source: ScanSource = {
        "format": "unlabeled",
        "selection": "files",
        "selectionManifestPath": str(path),
    }
    scanned = enumerate_and_hash(source)
    assert scanned.images == ()
    assert scanned.issues[0]["code"] == "SELECTION_MANIFEST_INVALID"
    assert scanned.issues[0]["target"]["sourcePath"] == str(path)
    assert path.read_bytes() == payload


def test_size_limits_before_read_without_large_allocation(tmp_path: Path) -> None:
    image = tmp_path / "huge.png"
    with image.open("wb") as stream:
        stream.truncate(MAX_IMAGE_BYTES + 1)
    scanned = enumerate_and_hash(directory_source(tmp_path))
    assert scanned.issues[0]["code"] == "IMAGE_TOO_LARGE"
    manifest = tmp_path / "selection.json"
    with manifest.open("wb") as stream:
        stream.truncate(MAX_ANNOTATION_BYTES + 1)
    source: ScanSource = {
        "format": "unlabeled",
        "selection": "files",
        "selectionManifestPath": str(manifest),
    }
    scanned = enumerate_and_hash(source)
    assert scanned.issues[0]["code"] == "SELECTION_MANIFEST_TOO_LARGE"


def test_bounded_entries_include_empty_directories_and_unknown_files(
    tmp_path: Path,
) -> None:
    for index in range(4):
        (tmp_path / str(index)).mkdir()
    with patch("autovision_ml.data.image_scan.MAX_INPUT_ITEMS", 3):
        scanned = enumerate_and_hash(directory_source(tmp_path))
    assert scanned.images == ()
    assert any(issue["code"] == "INPUT_LIMIT_EXCEEDED" for issue in scanned.issues)


def test_selection_budget_before_duplicate_removal(tmp_path: Path) -> None:
    image = tmp_path / "a.png"
    image.write_bytes(PNG)
    source = selection_source(tmp_path / "selected.json", [image] * 4)
    with patch("autovision_ml.data.image_scan.MAX_INPUT_ITEMS", 3):
        scanned = enumerate_and_hash(source)
    assert scanned.images == ()
    assert any(issue["code"] == "INPUT_LIMIT_EXCEEDED" for issue in scanned.issues)


def test_permission_failure_is_contextual_and_silent(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    with patch("os.scandir", side_effect=PermissionError("sensitive raw path")):
        scanned = enumerate_and_hash(directory_source(tmp_path))
    assert scanned.issues[0]["code"] == "PATH_READ_FAILED"
    assert scanned.issues[0]["target"]["imageKey"] is None
    assert scanned.issues[0]["target"]["sourcePath"] == str(tmp_path)
    assert "sensitive raw path" not in repr(scanned)
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


def test_read_failure_releases_handle_and_reports_only_context(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "a.png"
    path.write_bytes(PNG)
    calls = 0

    class FailingRead(_ReadStream):
        def read(self, size: int) -> bytes:
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("sensitive read failure")
            return super().read(min(size, 2))

    with (
        path.open("rb", buffering=0) as stream,
        patch.object(Path, "open", return_value=FailingRead(stream)) as opened,
    ):
        scanned = enumerate_and_hash(directory_source(tmp_path))
        assert stream.closed
        opened.assert_called_once_with("rb", buffering=0)
    assert calls == 2
    assert scanned.images == ()
    assert [issue["code"] for issue in scanned.issues] == [
        "IMAGE_READ_FAILED",
        "NO_VALID_IMAGES",
    ]
    assert scanned.issues[0]["target"]["sourcePath"] == str(path)
    assert scanned.issues[0]["target"]["imageKey"] == "image:0"
    assert "sensitive read failure" not in repr(scanned)
    renamed = path.with_name("released.png")
    path.rename(renamed)
    assert renamed.read_bytes() == PNG
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


def test_cancel_before_io_and_during_stream_releases_handle(tmp_path: Path) -> None:
    with pytest.raises(Cancelled, match="^Image scan cancelled$") as caught:
        enumerate_and_hash(directory_source(tmp_path), check_cancel=lambda: True)
    assert caught.value.code == "CANCELLED"
    image = tmp_path / "a.png"
    image.write_bytes(PNG * 10000)
    opened = False
    checks = 0
    original_fstat = os.fstat

    def observed_fstat(fd: int) -> os.stat_result:
        nonlocal opened
        opened = True
        return original_fstat(fd)

    def cancel_after_open() -> bool:
        nonlocal checks
        if opened:
            checks += 1
        return checks > len(image.parents) + 2

    with patch("os.fstat", observed_fstat), pytest.raises(Cancelled):
        enumerate_and_hash(directory_source(tmp_path), check_cancel=cancel_after_open)
    renamed = image.with_name("released.png")
    image.rename(renamed)
    assert renamed.read_bytes() == PNG * 10000


@pytest.mark.parametrize("selection", ["directory", "files"])
def test_adversarial_root_replacement_at_initial_progress_is_rejected(
    tmp_path: Path, selection: Literal["directory", "files"]
) -> None:
    root = tmp_path / "root"
    root.mkdir()
    image = root / "a.png"
    image.write_bytes(PNG)
    before = root.lstat()
    image_before = image.lstat()
    retained = tmp_path / "retained"
    replacement = tmp_path / "replacement"
    replacement.mkdir()
    replacement_bytes = PNG[:-1] + b"X"
    replacement_image = replacement / "a.png"
    replacement_image.write_bytes(replacement_bytes)
    os.utime(replacement_image, ns=(image_before.st_atime_ns, image_before.st_mtime_ns))
    manifest = tmp_path / "selection.json"
    source = (
        selection_source(manifest, [image])
        if selection == "files"
        else directory_source(root)
    )
    swap_count = 0

    def replace_root(done: int, total: int) -> None:
        nonlocal swap_count
        if done == 0 and total > 0:
            assert total == 1
            swap_count += 1
            root.rename(retained)
            replacement.rename(root)

    with patch.object(Path, "open", autospec=True, side_effect=Path.open) as opened:
        result = enumerate_and_hash(source, on_progress=replace_root)

    # Check the real swap and byte preservation before the rejection assertions.
    assert swap_count == 1
    retained_info = retained.lstat()
    current = root.lstat()
    assert (retained_info.st_dev, retained_info.st_ino) == (
        before.st_dev,
        before.st_ino,
    )
    assert (current.st_dev, current.st_ino) != (before.st_dev, before.st_ino)
    assert (retained / "a.png").read_bytes() == PNG
    assert (root / "a.png").read_bytes() == replacement_bytes
    retained_image = (retained / "a.png").lstat()
    current_image = image.lstat()
    assert (retained_image.st_dev, retained_image.st_ino) == (
        image_before.st_dev,
        image_before.st_ino,
    )
    assert retained_image.st_mtime_ns == image_before.st_mtime_ns
    assert (current_image.st_size, current_image.st_mtime_ns) == (
        image_before.st_size,
        image_before.st_mtime_ns,
    )
    assert [call.args[0] for call in opened.call_args_list] == (
        [manifest] if selection == "files" else []
    )
    assert result.images == ()
    assert [issue["code"] for issue in result.issues] == [
        "SOURCE_CHANGED",
        "NO_VALID_IMAGES",
    ]
    assert result.issues[0]["severity"] == "error"
    assert result.issues[0]["target"]["imageKey"] == "image:0"
    assert result.issues[0]["target"]["sourcePath"] == str(image)


@pytest.mark.parametrize("selection", ["directory", "files"])
def test_adversarial_ancestor_replacement_preserving_root_inode_is_rejected(
    tmp_path: Path, selection: Literal["directory", "files"]
) -> None:
    ancestor = tmp_path / "ancestor"
    root = ancestor / "root"
    root.mkdir(parents=True)
    (root / "a.png").write_bytes(PNG)
    ancestor_before = ancestor.lstat()
    root_before = root.lstat()
    image_before = (root / "a.png").lstat()
    retained = tmp_path / "retained-ancestor"
    replacement = tmp_path / "replacement-ancestor"
    replacement.mkdir()
    replacement_bytes = PNG[:-1] + b"X"
    # This different payload remains outside the scan root after the ancestor swap.
    (replacement / "replacement.png").write_bytes(replacement_bytes)
    manifest = tmp_path / "selection.json"
    source = (
        selection_source(manifest, [root / "a.png"])
        if selection == "files"
        else directory_source(root)
    )
    swap_count = 0

    def replace_ancestor(done: int, total: int) -> None:
        nonlocal swap_count
        if done == 0 and total > 0:
            assert total == 1
            swap_count += 1
            ancestor.rename(retained)
            replacement.rename(ancestor)
            (retained / "root").rename(root)

    with patch.object(Path, "open", autospec=True, side_effect=Path.open) as opened:
        result = enumerate_and_hash(source, on_progress=replace_ancestor)

    assert swap_count == 1
    ancestor_after = ancestor.lstat()
    retained_info = retained.lstat()
    assert (retained_info.st_dev, retained_info.st_ino) == (
        ancestor_before.st_dev,
        ancestor_before.st_ino,
    )
    assert (ancestor_after.st_dev, ancestor_after.st_ino) != (
        ancestor_before.st_dev,
        ancestor_before.st_ino,
    )
    # Root and leaf identities stay intact: checking either alone is insufficient.
    root_after = root.lstat()
    image_after = (root / "a.png").lstat()
    assert (root_after.st_dev, root_after.st_ino) == (
        root_before.st_dev,
        root_before.st_ino,
    )
    assert (image_after.st_dev, image_after.st_ino) == (
        image_before.st_dev,
        image_before.st_ino,
    )
    assert (image_after.st_size, image_after.st_mtime_ns) == (
        image_before.st_size,
        image_before.st_mtime_ns,
    )
    assert (root / "a.png").read_bytes() == PNG
    assert (ancestor / "replacement.png").read_bytes() == replacement_bytes
    assert [call.args[0] for call in opened.call_args_list] == (
        [manifest] if selection == "files" else []
    )
    assert result.images == ()
    assert [issue["code"] for issue in result.issues] == [
        "SOURCE_CHANGED",
        "NO_VALID_IMAGES",
    ]
    assert result.issues[0]["severity"] == "error"
    assert result.issues[0]["target"]["imageKey"] == "image:0"
    assert result.issues[0]["target"]["sourcePath"] == str(root / "a.png")


@pytest.mark.parametrize("selection", ["directory", "files"])
@pytest.mark.parametrize("replaced", ["directory", "file"])
def test_nested_candidate_replacement_before_its_read_is_rejected(
    tmp_path: Path,
    selection: Literal["directory", "files"],
    replaced: Literal["directory", "file"],
) -> None:
    root = tmp_path / "root"
    child = root / "nested"
    child.mkdir(parents=True)
    first = root / "a.png"
    first.write_bytes(PNG + b"first")
    image = child / "b.png"
    image.write_bytes(PNG)
    root_before = root.lstat()
    child_before = child.lstat()
    image_before = image.lstat()
    target = child if replaced == "directory" else image
    retained = tmp_path / "retained"
    replacement = tmp_path / "replacement"
    if replaced == "directory":
        replacement.mkdir()
    replacement_image = (
        replacement / image.name if replaced == "directory" else replacement
    )
    replacement_bytes = PNG[:-1] + b"X"
    replacement_image.write_bytes(replacement_bytes)
    os.utime(replacement_image, ns=(image_before.st_atime_ns, image_before.st_mtime_ns))
    manifest = tmp_path / "selection.json"
    source = (
        selection_source(manifest, [first, image, image])
        if selection == "files"
        else directory_source(root)
    )
    total = 3 if selection == "files" else 2
    progress: list[tuple[int, int]] = []

    def replace_candidate(done: int, count: int) -> None:
        progress.append((done, count))
        if done == 1:
            target.rename(retained)
            replacement.rename(target)

    with patch.object(Path, "open", autospec=True, side_effect=Path.open) as opened:
        result = enumerate_and_hash(source, on_progress=replace_candidate)

    assert progress == [(done, total) for done in range(total + 1)]
    root_after = root.lstat()
    assert (root_after.st_dev, root_after.st_ino) == (
        root_before.st_dev,
        root_before.st_ino,
    )
    if replaced == "file":
        child_after = child.lstat()
        assert (child_after.st_dev, child_after.st_ino) == (
            child_before.st_dev,
            child_before.st_ino,
        )
    retained_image = retained / image.name if replaced == "directory" else retained
    retained_info = retained_image.lstat()
    image_after = image.lstat()
    assert (retained_info.st_dev, retained_info.st_ino) == (
        image_before.st_dev,
        image_before.st_ino,
    )
    assert (image_after.st_dev, image_after.st_ino) != (
        image_before.st_dev,
        image_before.st_ino,
    )
    assert (image_after.st_size, image_after.st_mtime_ns) == (
        image_before.st_size,
        image_before.st_mtime_ns,
    )
    assert retained_image.read_bytes() == PNG
    assert image.read_bytes() == replacement_bytes
    assert [call.args[0] for call in opened.call_args_list] == (
        [manifest, first] if selection == "files" else [first]
    )
    assert [item["sourcePath"] for item in result.images] == [str(first)]
    assert result.images[0]["key"] == "image:0"
    assert result.images[0]["sha256"] == hashlib.sha256(PNG + b"first").hexdigest()
    expected_codes = ["SOURCE_CHANGED"] * (total - 1)
    assert [issue["code"] for issue in result.issues] == expected_codes
    assert [issue["target"]["imageKey"] for issue in result.issues] == [
        f"image:{index}" for index in range(1, total)
    ]
    assert all(issue["target"]["sourcePath"] == str(image) for issue in result.issues)


def test_selection_capture_failures_are_not_rebased_at_initial_progress(
    tmp_path: Path,
) -> None:
    good = tmp_path / "good.png"
    good.write_bytes(PNG)
    missing = tmp_path / "missing.png"
    denied = tmp_path / "denied.png"
    denied.write_bytes(PNG + b"denied")
    manifest = tmp_path / "selection.json"
    source = selection_source(manifest, [good, missing, denied, missing, good])
    manifest_before = manifest.read_bytes()
    progress: list[tuple[int, int]] = []
    capture_finished = False
    original_lstat = Path.lstat

    def deny_during_capture(path: Path) -> os.stat_result:
        if path == denied and not capture_finished:
            raise PermissionError("selection capture denied")
        return original_lstat(path)

    def make_readable(done: int, total: int) -> None:
        nonlocal capture_finished
        progress.append((done, total))
        if done == 0:
            capture_finished = True
            missing.write_bytes(PNG + b"arrived after capture")

    with (
        patch.object(Path, "lstat", deny_during_capture),
        patch.object(Path, "open", autospec=True, side_effect=Path.open) as opened,
    ):
        result = enumerate_and_hash(source, on_progress=make_readable)

    assert progress == [(done, 5) for done in range(6)]
    assert [item["sourcePath"] for item in result.images] == [str(good), str(good)]
    assert [item["key"] for item in result.images] == ["image:0", "image:4"]
    assert [item["duplicateOf"] for item in result.images] == [None, "image:0"]
    assert [issue["code"] for issue in result.issues] == [
        "IMAGE_READ_FAILED",
        "IMAGE_READ_FAILED",
        "IMAGE_READ_FAILED",
        "DUPLICATE_IMAGE",
    ]
    assert [issue["target"]["imageKey"] for issue in result.issues[:3]] == [
        "image:1",
        "image:2",
        "image:3",
    ]
    assert [issue["target"]["sourcePath"] for issue in result.issues[:3]] == [
        str(missing),
        str(denied),
        str(missing),
    ]
    assert [
        call.args[0] for call in opened.call_args_list if call.args[1:] == ("rb",)
    ] == [manifest, good, good]
    assert manifest.read_bytes() == manifest_before
    assert good.read_bytes() == PNG
    assert missing.read_bytes() == PNG + b"arrived after capture"
    assert denied.read_bytes() == PNG + b"denied"


def test_same_size_mutation_during_read_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "a.png"
    path.write_bytes(PNG)
    original_fstat = os.fstat
    calls = 0

    def changed(fd: int) -> os.stat_result:
        nonlocal calls
        calls += 1
        if calls == 2:
            path.write_bytes(PNG[:-1] + b"X")
            info = path.stat()
            os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000_000))
        return original_fstat(fd)

    with patch("os.fstat", changed):
        scanned = enumerate_and_hash(directory_source(tmp_path))
    assert scanned.images == ()
    assert scanned.issues[0]["code"] == "SOURCE_CHANGED"


@pytest.mark.parametrize(
    "changed_api", [None, "lstat", "fstat"], ids=["stable", "path", "handle"]
)
def test_ctime_is_compared_only_within_the_same_api(
    tmp_path: Path, changed_api: str | None
) -> None:
    path = tmp_path / "a.png"
    path.write_bytes(PNG)
    path_ctime = path.lstat().st_ctime_ns
    handle_ctime = path_ctime + 1_000_000_000
    original_lstat = Path.lstat
    original_fstat = os.fstat
    handle_reads = 0

    def observed_lstat(node: Path) -> os.stat_result:
        info = original_lstat(node)
        if node != path:
            return info
        delta = 1_000_000_000 if changed_api == "lstat" and handle_reads == 2 else 0
        return _with_ctime(info, path_ctime + delta)

    def observed_fstat(fd: int) -> os.stat_result:
        nonlocal handle_reads
        handle_reads += 1
        info = original_fstat(fd)
        delta = 1_000_000_000 if changed_api == "fstat" and handle_reads == 2 else 0
        return _with_ctime(info, handle_ctime + delta)

    with patch.object(Path, "lstat", observed_lstat), patch("os.fstat", observed_fstat):
        scanned = enumerate_and_hash(directory_source(tmp_path))
    assert handle_reads == 2
    if changed_api is None:
        assert scanned.issues == []
        assert len(scanned.images) == 1
        assert scanned.images[0]["sha256"] == hashlib.sha256(PNG).hexdigest()
    else:
        assert scanned.images == ()
        assert [issue["code"] for issue in scanned.issues] == [
            "SOURCE_CHANGED",
            "NO_VALID_IMAGES",
        ]
    assert path.read_bytes() == PNG


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ("mtime", "SOURCE_CHANGED"),
        ("replacement", "SOURCE_CHANGED"),
        ("junction", "UNSAFE_PATH"),
    ],
    ids=["mtime", "replacement", "junction"],
)
def test_close_boundary_is_rechecked(tmp_path: Path, change: str, code: str) -> None:
    import _winapi

    root = tmp_path / "images"
    root.mkdir()
    path = root / "a.png"
    path.write_bytes(PNG)
    before = path.stat()
    replacement = tmp_path / "replacement.png"
    replacement.write_bytes(PNG[:-1] + b"X")
    os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
    moved = tmp_path / "moved-images"
    junction_created = False

    class ChangedOnClose(_ReadStream):
        def __exit__(self, *_args: object) -> None:
            nonlocal junction_created
            super().__exit__(*_args)
            assert self.stream.closed
            if change == "mtime":
                os.utime(
                    path,
                    ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000_000),
                )
            elif change == "replacement":
                replacement.replace(path)
            else:
                root.rename(moved)
                _winapi.CreateJunction(str(moved), str(root))
                junction_created = True

    try:
        with (
            path.open("rb", buffering=0) as stream,
            patch.object(Path, "open", return_value=ChangedOnClose(stream)) as opened,
        ):
            scanned = enumerate_and_hash(directory_source(root))
            assert stream.closed
            opened.assert_called_once_with("rb", buffering=0)
        assert scanned.images == ()
        assert [issue["code"] for issue in scanned.issues] == [code, "NO_VALID_IMAGES"]
        assert scanned.issues[0]["target"]["sourcePath"] == str(path)
        assert scanned.issues[0]["target"]["imageKey"] == "image:0"
        current = moved / path.name if junction_created else path
        expected = PNG[:-1] + b"X" if change == "replacement" else PNG
        assert current.read_bytes() == expected
    finally:
        if junction_created:
            root.rmdir()


def test_hardlink_is_not_read(tmp_path: Path) -> None:
    source = tmp_path / "a.png"
    source.write_bytes(PNG)
    linked = tmp_path / "b.png"
    os.link(source, linked)
    scanned = enumerate_and_hash(directory_source(tmp_path))
    assert scanned.images == ()
    assert [issue["code"] for issue in scanned.issues[:-1]] == ["UNSAFE_FILE"] * 2


def test_junction_ancestor_and_cycle_rejected_without_following(tmp_path: Path) -> None:
    import _winapi

    outside = tmp_path / "outside"
    outside.mkdir()
    image = outside / "a.png"
    image.write_bytes(PNG)
    root = tmp_path / "root"
    root.mkdir()
    junction = root / "junction"
    _winapi.CreateJunction(str(outside), str(junction))
    try:
        scanned = enumerate_and_hash(directory_source(root))
        assert scanned.images == ()
        assert scanned.issues[0]["code"] == "UNSAFE_PATH"
        selected = selection_source(tmp_path / "selected.json", [junction / "a.png"])
        assert enumerate_and_hash(selected).issues[0]["code"] == "UNSAFE_PATH"
        assert image.read_bytes() == PNG
    finally:
        junction.rmdir()
    _winapi.CreateJunction(str(root), str(junction))
    try:
        scanned = enumerate_and_hash(directory_source(root))
        assert scanned.issues[0]["code"] == "UNSAFE_PATH"
    finally:
        junction.rmdir()


def test_symlink_rejected_when_privilege_available(tmp_path: Path) -> None:
    target = tmp_path / "target.png"
    target.write_bytes(PNG)
    link = tmp_path / "link.png"
    try:
        link.symlink_to(target)
    except OSError as error:
        if error.winerror == 1314:
            pytest.skip(
                "Windows symlink privilege unavailable; junction test is separate"
            )
        raise
    source = selection_source(tmp_path / "selected.json", [link])
    scanned = enumerate_and_hash(source)
    assert scanned.images == ()
    assert scanned.issues[0]["code"] == "UNSAFE_PATH"


def test_unbounded_directory_iterator_is_stopped(tmp_path: Path) -> None:
    class Entry:
        name = "repeated"

    class EndlessDirectory:
        def __enter__(self) -> Iterator[Entry]:
            while True:
                yield Entry()

        def __exit__(self, *_args: object) -> None:
            return None

    with (
        patch("os.scandir", return_value=EndlessDirectory()),
        patch("autovision_ml.data.image_scan.MAX_INPUT_ITEMS", 3),
    ):
        scanned = enumerate_and_hash(directory_source(tmp_path))
    assert scanned.images == ()
    assert scanned.issues[0]["code"] == "INPUT_LIMIT_EXCEEDED"
