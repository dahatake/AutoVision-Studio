"""DAT-04 local CSV fixtures and synthetic DAT-02 metadata, NOT decoder evidence.

No sample downloads, CLI, subprocesses, image decoder or DAT-03 dependency.
Filesystem writes are exclusively pytest temporary fixtures.
"""

from __future__ import annotations

import csv
import hashlib
import os
import socket
from collections.abc import Callable
from pathlib import Path
from unittest.mock import patch

import pytest

from autovision_ml.data.classification_import import (
    ClassificationImport,
    ImportFormatError,
    import_classification,
)
from autovision_ml.data.image_scan import HashedImage
from autovision_ml.data.import_contract import MAX_ANNOTATION_BYTES, ScanSource

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows-native import")


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("Network forbidden")

    monkeypatch.setattr(socket, "create_connection", blocked)
    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket.socket, "connect_ex", blocked)
    monkeypatch.setattr(socket, "getaddrinfo", blocked)


def image(root: Path, name: str, ordinal: int = 0) -> HashedImage:
    # Intentionally no dimensions and no file: importer must not open images.
    raw_header = b"\x89PNG\r\n\x1a\nsynthetic-not-decodable:" + name.encode("utf-8")
    return {
        "key": f"image:{ordinal}",
        "sourcePath": str(root / name),
        "byteSize": len(raw_header),
        "mtimeNs": "1",
        "sha256": hashlib.sha256(raw_header).hexdigest(),
        "format": "png",
        "duplicateOf": None,
    }


def csv_source(root: Path, payload: bytes) -> ScanSource:
    annotation = root / "labels.csv"
    annotation.write_bytes(payload)
    return {"format": "csv", "root": str(root), "annotationPath": str(annotation)}


def codes(result: ClassificationImport) -> list[str]:
    return [issue["code"] for issue in result.issues]


def names(result: ClassificationImport) -> dict[str, str | None]:
    classes = {entry["key"]: entry["name"] for entry in result.classes}
    return {
        key: None if annotation is None else classes[annotation["classKey"]]
        for key, annotation in result.annotations.items()
    }


@pytest.mark.parametrize("selection", ["directory", "files"])
def test_unlabeled_never_reads_source(tmp_path: Path, selection: str) -> None:
    source: ScanSource
    if selection == "directory":
        source = {
            "format": "unlabeled",
            "selection": "directory",
            "root": str(tmp_path),
        }
    else:
        source = {
            "format": "unlabeled",
            "selection": "files",
            "selectionManifestPath": str(tmp_path / "does-not-exist.json"),
        }
    item = image(tmp_path, "a.png")
    with patch.object(Path, "lstat", side_effect=AssertionError("No source I/O")):
        result = import_classification(source, [item])
    assert result == ClassificationImport((), {"image:0": None}, [])
    assert "annotation" not in item


def test_folder_first_segment_nested_unicode_and_deterministic_keys(
    tmp_path: Path,
) -> None:
    items = [
        image(tmp_path, "猫/nested/a.png", 0),
        image(tmp_path, "constructor/b.png", 1),
        image(tmp_path, " 猫/c.png", 2),
        image(tmp_path, "Ａ/d.png", 3),
        image(tmp_path, "A/e.png", 4),
    ]
    before = [dict(item) for item in items]
    source: ScanSource = {"format": "folder", "root": str(tmp_path)}
    with patch.object(Path, "open", side_effect=AssertionError("No image reads")):
        result = import_classification(source, items)
        reordered = import_classification(source, list(reversed(items)))
    assert result.issues == []
    assert names(result) == {
        "image:0": "猫",
        "image:1": "constructor",
        "image:2": " 猫",
        "image:3": "Ａ",
        "image:4": "A",
    }
    assert result.classes == reordered.classes
    expected_keys = [f"class:{i}" for i in range(5)]
    assert [entry["key"] for entry in result.classes] == expected_keys
    assert all(entry["sourceCategoryId"] is None for entry in result.classes)
    assert all(
        value is not None and value["sourceRow"] is None
        for value in result.annotations.values()
    )
    assert items == before


def test_root_image_outside_root_and_ambiguous_case_do_not_get_labels(
    tmp_path: Path,
) -> None:
    items = [
        image(tmp_path, "a.png", 0),
        image(tmp_path, "cat/A.png", 1),
        image(tmp_path, "cat/a.png", 2),
        image(tmp_path.parent, "outside.png", 3),
    ]
    result = import_classification({"format": "folder", "root": str(tmp_path)}, items)
    assert set(result.annotations) == {item["key"] for item in items}
    assert all(value is None for value in result.annotations.values())
    assert codes(result).count("IMAGE_PATH_AMBIGUOUS") == 2
    assert "CLASSIFICATION_FOLDER_REQUIRED" in codes(result)
    assert "IMAGE_OUTSIDE_ROOT" in codes(result)


def test_non_ascii_sibling_is_outside_root(tmp_path: Path) -> None:
    root = tmp_path / "straße"
    root.mkdir()
    sibling = tmp_path / "strasse"
    sibling.mkdir()
    item = image(sibling, "cat/a.png")
    before = dict(item)
    with patch.object(Path, "open", side_effect=AssertionError("No image reads")):
        result = import_classification({"format": "folder", "root": str(root)}, [item])
    assert result.classes == ()
    assert result.annotations == {item["key"]: None}
    assert result.issues == [
        {
            "severity": "error",
            "code": "IMAGE_OUTSIDE_ROOT",
            "target": {
                "imageKey": item["key"],
                "sourcePath": item["sourcePath"],
                "row": None,
                "itemId": None,
            },
        }
    ]
    assert item == before


def test_csv_exact_header_bom_unicode_multiline_and_readonly(tmp_path: Path) -> None:
    raw = (
        '\ufeffpath,label\r\na.png," 猫,\r\n犬 "\r\nsub\\b.png,constructor\r\n'
    ).encode("utf-8")
    source = csv_source(tmp_path, raw)
    annotation = tmp_path / "labels.csv"
    before = annotation.stat()
    items = [image(tmp_path, "a.png"), image(tmp_path, "sub/b.png", 1)]
    result = import_classification(source, items)
    assert result.issues == []
    assert names(result) == {"image:0": " 猫,\r\n犬 ", "image:1": "constructor"}
    first, second = result.annotations["image:0"], result.annotations["image:1"]
    assert first is not None and first["sourceRow"] == 2
    assert second is not None and second["sourceRow"] == 4
    assert annotation.read_bytes() == raw
    assert annotation.stat().st_mtime_ns == before.st_mtime_ns
    assert sorted(path.name for path in tmp_path.iterdir()) == ["labels.csv"]


@pytest.mark.parametrize(
    ("payload", "code", "row"),
    [
        (b"filename,label\na.png,cat\n", "CSV_INVALID_HEADER", 1),
        (b"image_path,label\n", "CSV_INVALID_HEADER", 1),
        (b"path,label,extra\n", "CSV_INVALID_HEADER", 1),
        (b"\xef\xbb\xbf\xef\xbb\xbfpath,label\n", "CSV_INVALID_HEADER", 1),
        (b"path,label\na.png,\xff\n", "CSV_INVALID_ENCODING", None),
        (b'path,label\na.png,cat\nb.png,"unterminated', "CSV_MALFORMED", 3),
        (b'path,label\na.png,"cat"extra\n', "CSV_MALFORMED", 2),
        (b"", "EMPTY_FILE", None),
    ],
)
def test_whole_file_failure_is_not_partial_success(
    tmp_path: Path, payload: bytes, code: str, row: int | None
) -> None:
    source = csv_source(tmp_path, payload)
    with pytest.raises(ImportFormatError) as caught:
        import_classification(source, [image(tmp_path, "a.png")])
    assert caught.value.code == code
    assert caught.value.row == row
    assert caught.value.source_path == str(tmp_path / "labels.csv")
    assert str(caught.value) == "Classification import rejected"


@pytest.mark.parametrize(
    "supplied",
    [
        "",
        ".",
        "..",
        "../a.png",
        "cat/../a.png",
        "./a.png",
        "/a.png",
        "\\a.png",
        "C:a.png",
        "C:/a.png",
        "//server/share/a.png",
        "https://example.invalid/a.png",
        "a.png:stream",
        "NUL.png",
        "COM¹.png",
        "a.png.",
        "a.png ",
        "cat//a.png",
        "a\0.png",
    ],
)
def test_unsafe_csv_references_are_lexical_not_file_reads(
    tmp_path: Path, supplied: str
) -> None:
    source = csv_source(tmp_path, f"path,label\n{supplied},cat\n".encode())
    result = import_classification(source, [image(tmp_path, "a.png")])
    assert result.annotations == {"image:0": None}
    assert result.issues[0]["code"] == "CSV_UNSAFE_PATH"
    assert result.issues[0]["target"]["row"] == 2
    assert result.issues[0]["target"]["sourcePath"] == str(tmp_path / "labels.csv")


@pytest.mark.parametrize("label", ["", " \t", "\u3000\ufeff", "bad\0label"])
def test_invalid_label_does_not_echo_label(tmp_path: Path, label: str) -> None:
    source = csv_source(tmp_path, f"path,label\na.png,{label}\n".encode())
    result = import_classification(source, [image(tmp_path, "a.png")])
    assert result.annotations["image:0"] is None
    issue = result.issues[0]
    assert issue["code"] == "CLASSIFICATION_LABEL_INVALID"
    assert issue["target"] == {
        "imageKey": "image:0",
        "sourcePath": str(tmp_path / "a.png"),
        "row": 2,
        "itemId": None,
    }


def test_header_only_missing_references_bad_column_count_partial_rows(
    tmp_path: Path,
) -> None:
    item = image(tmp_path, "a.png")
    result = import_classification(csv_source(tmp_path, b"path,label\n"), [item])
    assert codes(result) == ["CLASSIFICATION_LABEL_MISSING"]
    result = import_classification(
        csv_source(
            tmp_path,
            b"path,label\nmissing.png,cat\na.png\n"
            b"a.png,cat,private-extra\n\na.png,dog\n",
        ),
        [item],
    )
    assert names(result) == {"image:0": "dog"}
    assert codes(result) == [
        "CSV_IMAGE_NOT_FOUND",
        "CSV_COLUMN_COUNT",
        "CSV_COLUMN_COUNT",
        "CSV_COLUMN_COUNT",
    ]
    assert [issue["target"]["row"] for issue in result.issues] == [2, 3, 4, 5]
    assert "private-extra" not in repr(result)


@pytest.mark.parametrize("second", ["cat", "dog"])
def test_duplicate_rows_case_separator_identity_never_last_wins(
    tmp_path: Path, second: str
) -> None:
    source = csv_source(
        tmp_path,
        f"path,label\nsub/A.png,cat\nSUB\\a.PNG,{second}\nsub/a.png,cat\n".encode(),
    )
    result = import_classification(source, [image(tmp_path, "sub/a.png")])
    assert result.annotations == {"image:0": None}
    assert result.classes == ()
    assert "CSV_DUPLICATE_PATH" in codes(result)
    assert {issue["target"]["row"] for issue in result.issues} >= {2, 3, 4}
    if second != "cat":
        assert "DUPLICATE_LABEL_CONFLICT" in codes(result)


def test_csv_casefold_collision_refuses_even_exact_match(tmp_path: Path) -> None:
    items = [image(tmp_path, "A.png"), image(tmp_path, "a.png", 1)]
    source = csv_source(tmp_path, b"path,label\nA.png,cat\n")
    result = import_classification(source, items)
    assert all(value is None for value in result.annotations.values())
    assert "IMAGE_PATH_AMBIGUOUS" in codes(result)


@pytest.mark.parametrize(
    ("scanned", "supplied"),
    [
        ("ß.png", "ss.png"),
        ("ss.png", "ß.png"),
        ("ı.png", "i.png"),
        ("i.png", "ı.png"),
    ],
)
def test_csv_non_ascii_mismatch_is_not_guessed(
    tmp_path: Path, scanned: str, supplied: str
) -> None:
    root = tmp_path / "images"
    root.mkdir()
    item = image(root, scanned)
    before = dict(item)
    source = csv_source(root, f"path,label\n{supplied},cat\n".encode())
    result = import_classification(source, [item])
    assert result.classes == ()
    assert result.annotations == {item["key"]: None}
    assert codes(result) == ["CSV_IMAGE_NOT_FOUND", "CLASSIFICATION_LABEL_MISSING"]
    assert result.issues[0]["target"] == {
        "imageKey": None,
        "sourcePath": supplied,
        "row": 2,
        "itemId": None,
    }
    assert result.issues[1]["target"] == {
        "imageKey": item["key"],
        "sourcePath": item["sourcePath"],
        "row": None,
        "itemId": None,
    }
    assert item == before


@pytest.mark.parametrize(
    ("first_name", "second_name"), [("ß.png", "ss.png"), ("ı.png", "i.png")]
)
def test_csv_exact_non_ascii_paths_are_distinct(
    tmp_path: Path, first_name: str, second_name: str
) -> None:
    root = tmp_path / "straße"
    root.mkdir()
    items = [image(root, first_name), image(root, second_name, 1)]
    before = [dict(item) for item in items]
    raw = f"path,label\n{first_name},Cat\n{second_name},cat\n".encode()
    result = import_classification(csv_source(root, raw), items)
    assert result.issues == []
    assert names(result) == {"image:0": "Cat", "image:1": "cat"}
    first, second = result.annotations["image:0"], result.annotations["image:1"]
    assert first is not None and first["sourceRow"] == 2
    assert second is not None and second["sourceRow"] == 3
    assert items == before


def test_ascii_root_and_csv_aliases_preserve_original_source_paths(
    tmp_path: Path,
) -> None:
    root = tmp_path / "images"
    root.mkdir()
    items = [
        image(tmp_path / "IMAGES", "Sub/A.PNG"),
        image(tmp_path / "IMAGES", "Sub/B.PNG", 1),
    ]
    before = [dict(item) for item in items]
    source = csv_source(root, b"path,label\nSUB\\a.png,Cat\n")
    result = import_classification(source, items)
    assert names(result) == {"image:0": "Cat", "image:1": None}
    first = result.annotations["image:0"]
    assert first is not None and first["sourceRow"] == 2
    assert codes(result) == ["CLASSIFICATION_LABEL_MISSING"]
    assert result.issues[0]["target"] == {
        "imageKey": items[1]["key"],
        "sourcePath": items[1]["sourcePath"],
        "row": None,
        "itemId": None,
    }
    assert items == before


@pytest.mark.parametrize("same_label", [False, True])
def test_duplicate_hash_preserves_images_and_labels(
    tmp_path: Path, same_label: bool
) -> None:
    label = "cat" if same_label else "dog"
    items = [image(tmp_path, "a.png"), image(tmp_path, "b.png", 1)]
    items[1]["sha256"] = items[0]["sha256"]
    items[1]["duplicateOf"] = items[0]["key"]
    before = [dict(item) for item in items]
    result = import_classification(
        csv_source(tmp_path, f"path,label\na.png,cat\nb.png,{label}\n".encode()),
        items,
    )
    assert names(result) == {"image:0": "cat", "image:1": label}
    assert codes(result) == ([] if same_label else ["DUPLICATE_LABEL_CONFLICT"] * 2)
    if not same_label:
        assert [issue["target"]["row"] for issue in result.issues] == [2, 3]
    assert items == before


def test_csv_field_limit_unchanged_and_explicit_failure(tmp_path: Path) -> None:
    limit = csv.field_size_limit()
    source = csv_source(tmp_path, b"path,label\na.png," + b"x" * (limit + 1))
    with pytest.raises(ImportFormatError) as caught:
        import_classification(source, [image(tmp_path, "a.png")])
    assert caught.value.code == "CSV_FIELD_TOO_LARGE"
    assert caught.value.row == 2
    assert csv.field_size_limit() == limit


def test_oversize_sparse_csv_rejected_before_open(tmp_path: Path) -> None:
    annotation = tmp_path / "labels.csv"
    with annotation.open("wb") as stream:
        stream.truncate(MAX_ANNOTATION_BYTES + 1)
    source: ScanSource = {
        "format": "csv",
        "root": str(tmp_path),
        "annotationPath": str(annotation),
    }
    with (
        patch.object(
            Path, "open", side_effect=AssertionError("Must reject before allocation")
        ),
        pytest.raises(ImportFormatError) as caught,
    ):
        import_classification(source, [image(tmp_path, "a.png")])
    assert caught.value.code == "ANNOTATION_TOO_LARGE"


def test_hardlinked_annotation_not_read(tmp_path: Path) -> None:
    source = csv_source(tmp_path, b"path,label\na.png,cat\n")
    os.link(tmp_path / "labels.csv", tmp_path / "alias.csv")
    with (
        patch.object(Path, "open", side_effect=AssertionError("No hardlink reads")),
        pytest.raises(ImportFormatError) as caught,
    ):
        import_classification(source, [image(tmp_path, "a.png")])
    assert caught.value.code == "UNSAFE_FILE"


def test_junction_root_and_annotation_ancestor_rejected(tmp_path: Path) -> None:
    import _winapi

    target = tmp_path / "target"
    target.mkdir()
    source = csv_source(target, b"path,label\na.png,cat\n")
    junction = tmp_path / "junction"
    _winapi.CreateJunction(str(target), str(junction))
    try:
        variants: list[ScanSource] = [
            {"format": "folder", "root": str(junction)},
            {
                "format": "csv",
                "root": str(target),
                "annotationPath": str(junction / "labels.csv"),
            },
        ]
        with patch.object(
            Path, "open", side_effect=AssertionError("No junction reads")
        ):
            for variant in variants:
                root = junction if variant["format"] == "folder" else target
                with pytest.raises(ImportFormatError) as caught:
                    import_classification(variant, [image(root, "cat/a.png")])
                assert caught.value.code == "UNSAFE_PATH"
    finally:
        junction.rmdir()
    assert import_classification(source, [image(target, "a.png")]).issues == []


def test_source_validation_before_any_io(tmp_path: Path) -> None:
    unchecked: Callable[..., object] = import_classification
    with (
        patch.object(Path, "lstat", side_effect=AssertionError("No I/O")),
        pytest.raises(ValueError, match="^Invalid import contract$"),
    ):
        unchecked(
            {
                "format": "csv",
                "root": "C:\\safe",
                "annotationPath": "C:\\safe\\..\\bad.csv",
            },
            [image(tmp_path, "a.png")],
        )


def test_same_size_csv_mutation_detected_and_silent(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = csv_source(tmp_path, b"path,label\na.png,cat\n")
    annotation = tmp_path / "labels.csv"
    original_fstat = os.fstat
    calls = 0

    def changed(fd: int) -> os.stat_result:
        nonlocal calls
        calls += 1
        if calls == 2:
            annotation.write_bytes(b"path,label\na.png,dog\n")
            info = annotation.stat()
            os.utime(
                annotation, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000_000)
            )
        return original_fstat(fd)

    with patch("os.fstat", changed), pytest.raises(ImportFormatError) as caught:
        import_classification(source, [image(tmp_path, "a.png")])
    assert caught.value.code == "SOURCE_CHANGED"
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


def test_symlink_annotation_rejected_when_privilege_available(tmp_path: Path) -> None:
    target = tmp_path / "target.csv"
    target.write_bytes(b"path,label\na.png,cat\n")
    link = tmp_path / "labels.csv"
    try:
        link.symlink_to(target)
    except OSError as error:
        if error.winerror == 1314:
            pytest.skip("Symlink privilege unavailable; junction test is separate")
        raise
    source: ScanSource = {
        "format": "csv",
        "root": str(tmp_path),
        "annotationPath": str(link),
    }
    with (
        patch.object(Path, "open", side_effect=AssertionError("No symlink reads")),
        pytest.raises(ImportFormatError) as caught,
    ):
        import_classification(source, [image(tmp_path, "a.png")])
    assert caught.value.code == "UNSAFE_PATH"


def test_image_root_identity_survives_external_annotation_read(tmp_path: Path) -> None:
    root = tmp_path / "images"
    root.mkdir()
    annotation = tmp_path / "labels.csv"
    annotation.write_bytes(b"path,label\na.png,cat\n")
    source: ScanSource = {
        "format": "csv",
        "root": str(root),
        "annotationPath": str(annotation),
    }
    original_fstat = os.fstat
    calls = 0

    def replaced_root(fd: int) -> os.stat_result:
        nonlocal calls
        calls += 1
        if calls == 2:
            root.rename(tmp_path / "old-images")
            root.mkdir()
        return original_fstat(fd)

    with patch("os.fstat", replaced_root), pytest.raises(ImportFormatError) as caught:
        import_classification(source, [image(root, "a.png")])
    assert caught.value.code == "SOURCE_CHANGED"
    assert annotation.read_bytes() == b"path,label\na.png,cat\n"


def test_csv_stable_lstat_fstat_ctime_difference_is_accepted(tmp_path: Path) -> None:
    raw = b"path,label\na.png,cat\n"
    source = csv_source(tmp_path, raw)
    annotation = tmp_path / "labels.csv"
    before = annotation.lstat()
    handle_ctime_ns = before.st_ctime_ns + 1_000_000_000
    original_fstat = os.fstat

    def different_ctime(fd: int) -> os.stat_result:
        # Only the cross-API ctime differs; each API's own snapshot stays stable.
        info = original_fstat(fd)
        return os.stat_result(
            info,
            {
                "st_atime": info.st_atime,
                "st_mtime": info.st_mtime,
                "st_ctime": handle_ctime_ns / 1_000_000_000,
                "st_atime_ns": info.st_atime_ns,
                "st_mtime_ns": info.st_mtime_ns,
                "st_ctime_ns": handle_ctime_ns,
                "st_file_attributes": getattr(info, "st_file_attributes", 0),
            },
        )

    with patch("os.fstat", side_effect=different_ctime) as mocked_fstat:
        result = import_classification(source, [image(tmp_path, "a.png")])
    assert mocked_fstat.call_count == 2
    assert annotation.lstat().st_ctime_ns != handle_ctime_ns
    assert result.issues == []
    assert names(result) == {"image:0": "cat"}
    assert annotation.read_bytes() == raw
    assert annotation.stat().st_mtime_ns == before.st_mtime_ns


def test_short_csv_read_is_rejected_without_modifying_source(tmp_path: Path) -> None:
    raw = b"path,label\na.png,cat\n"
    source = csv_source(tmp_path, raw)
    annotation = tmp_path / "labels.csv"
    before = annotation.stat()
    with (
        annotation.open("rb", buffering=0) as stream,
        patch.object(Path, "open", autospec=True) as opened,
    ):
        reader = opened.return_value.__enter__.return_value
        reader.fileno.return_value = stream.fileno()
        # Still valid CSV: the byte-count guard must detect the missing newline.
        reader.read.side_effect = [raw[:-1], b""]
        with pytest.raises(ImportFormatError) as caught:
            import_classification(source, [image(tmp_path, "a.png")])
        opened.assert_called_once_with(annotation, "rb", buffering=0)
        assert reader.read.call_count == 2
        assert caught.value.code == "SOURCE_CHANGED"
        assert caught.value.source_path == str(annotation)
    assert annotation.read_bytes() == raw
    assert annotation.stat().st_mtime_ns == before.st_mtime_ns
    assert sorted(path.name for path in tmp_path.iterdir()) == ["labels.csv"]


def test_csv_replacement_on_close_is_rejected(tmp_path: Path) -> None:
    source = csv_source(tmp_path, b"path,label\na.png,cat\n")
    annotation = tmp_path / "labels.csv"
    before = annotation.stat()
    replacement = tmp_path / "replacement.csv"
    replacement.write_bytes(b"path,label\na.png,dog\n")
    os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
    with (
        annotation.open("rb", buffering=0) as stream,
        patch.object(Path, "open", autospec=True) as opened,
    ):
        opened.return_value.__enter__.return_value = stream

        def replace_on_close(*_args: object) -> None:
            stream.close()
            replacement.replace(annotation)

        opened.return_value.__exit__.side_effect = replace_on_close
        with pytest.raises(ImportFormatError) as caught:
            import_classification(source, [image(tmp_path, "a.png")])
        opened.assert_called_once_with(annotation, "rb", buffering=0)
        opened.return_value.__exit__.assert_called_once_with(None, None, None)
        assert stream.closed
        assert caught.value.code == "SOURCE_CHANGED"
        assert caught.value.source_path == str(annotation)
    assert annotation.read_bytes() == b"path,label\na.png,dog\n"
    assert annotation.stat().st_mtime_ns == before.st_mtime_ns
    assert not replacement.exists()
