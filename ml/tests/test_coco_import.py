"""DAT-05 local fixtures; no downloads, subprocesses, CLI or sample-asset coupling.

The eight orientation cases use real generated PNGs through DAT-02 and DAT-03.
Other cases deliberately use tiny synthetic ScanImage metadata to isolate the
mapper, not to claim decoder or GWHD acceptance. All writes are pytest fixtures.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import socket
from collections.abc import Callable, Sequence
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image

from autovision_ml.data.coco_import import CocoFormatError, CocoImport, import_coco
from autovision_ml.data.image_decode import decode_image
from autovision_ml.data.image_scan import HashedImage, enumerate_and_hash
from autovision_ml.data.import_contract import (
    MAX_ANNOTATION_BYTES,
    MAX_INPUT_ITEMS,
    CocoSource,
    Orientation,
    ScanContext,
    ScanImage,
    ScanSource,
    parse_scan_result,
)

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows-native COCO import")
SAFE_ID = 9_007_199_254_740_991
ORIENTATIONS: tuple[Orientation, ...] = (1, 2, 3, 4, 5, 6, 7, 8)


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("Network forbidden")

    monkeypatch.setattr(socket, "create_connection", blocked)
    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket.socket, "connect_ex", blocked)
    monkeypatch.setattr(socket, "getaddrinfo", blocked)


def image(root: Path, name: str = "a.png", ordinal: int = 0) -> ScanImage:
    # No corresponding image file: isolated mapper tests must never open it.
    return {
        "key": f"image:{ordinal}",
        "sourcePath": str(root / name),
        "byteSize": 1,
        "mtimeNs": "1",
        "sha256": hashlib.sha256(name.encode("utf-8")).hexdigest(),
        "format": "png",
        "width": 13,
        "height": 9,
        "orientation": 1,
        "duplicateOf": None,
        "annotation": None,
    }


def coco_image(**changes: object) -> dict[str, object]:
    return {"id": 1, "file_name": "a.png", "width": 13, "height": 9, **changes}


def category(**changes: object) -> dict[str, object]:
    return {"id": 7, "name": "穂", **changes}


def annotation(**changes: object) -> dict[str, object]:
    return {
        "id": 11,
        "image_id": 1,
        "category_id": 7,
        "bbox": [0, 0, 1, 1],
        **changes,
    }


def document(**changes: object) -> dict[str, object]:
    return {
        "images": [coco_image()],
        "categories": [category()],
        "annotations": [annotation()],
        **changes,
    }


def source(root: Path, payload: object, path: Path | None = None) -> CocoSource:
    path = root / "annotations.json" if path is None else path
    contents = (
        payload
        if isinstance(payload, bytes)
        else json.dumps(payload, allow_nan=False).encode("utf-8")
    )
    path.write_bytes(contents)
    return {"format": "coco", "root": str(root), "annotationPath": str(path)}


def codes(result: CocoImport) -> list[str]:
    return [issue["code"] for issue in result.issues]


def assert_contract(result: CocoImport, images: Sequence[ScanImage]) -> None:
    context: ScanContext = {
        "jobId": "ae45cf74-c9f9-4c49-88b9-0523b1ac7383",
        "projectId": "01234567-89ab-4cde-8f01-23456789abcd",
        "taskType": "detection",
        "mode": "reference",
    }
    merged: list[ScanImage] = [
        {**item, "annotation": result.annotations[item["key"]]} for item in images
    ]
    value: dict[str, object] = {
        "formatVersion": 1,
        **context,
        "classes": list(result.classes),
        "images": merged,
        "issues": result.issues,
    }
    assert parse_scan_result(value, context) == value


@pytest.mark.parametrize("orientation", ORIENTATIONS)
def test_real_png_decode_to_coco_keeps_raw_coordinates_ids_order_and_originals(
    tmp_path: Path, orientation: Orientation, capsys: pytest.CaptureFixture[str]
) -> None:
    root = tmp_path / "images"
    root.mkdir()
    first_path, second_path = root / "a.png", root / "b.png"
    for path, size, direction in (
        (first_path, (13, 9), orientation),
        (second_path, (7, 5), 1),
    ):
        with Image.new("RGB", size, "seagreen") as pixels:
            exif = Image.Exif()
            exif[274] = direction
            pixels.save(path, format="PNG", exif=exif)
    bbox = [10.125, 6.5, 2.5, 2.0]
    payload = document(
        info={"description": "private-extra", "url": "https://example.invalid"},
        licenses=[{"id": 1, "url": "file:///private-extra"}],
        images=[
            coco_image(id=2, file_name="b.png", width=7, height=5),
            coco_image(id=SAFE_ID, license=1, coco_url="private-extra"),
        ],
        categories=[
            category(name=" 麦🌾 ", supercategory="private-extra"),
            category(id=0, name="Ａ"),
            category(id=3, name="A"),
        ],
        annotations=[
            annotation(
                id=9,
                image_id=SAFE_ID,
                bbox=bbox,
                iscrowd=1,
                area=0,
                score=0.00001,
                segmentation={"counts": "private-extra"},
            ),
            annotation(id=0, image_id=2, category_id=0, bbox=[0, 0, 7, 5]),
            annotation(id=4, image_id=SAFE_ID, bbox=bbox),
            annotation(
                id=SAFE_ID, image_id=SAFE_ID, category_id=0, bbox=[0.0, 0, 13, 9.0]
            ),
        ],
    )
    annotation_path = tmp_path / "annotations.json"  # Authorized outside image root.
    selected = source(root, payload, annotation_path)
    originals = {
        path: (path.read_bytes(), path.stat().st_mtime_ns)
        for path in (first_path, second_path, annotation_path)
    }
    scan = enumerate_and_hash(selected)
    assert scan.issues == []
    assert len(scan.images) == 2
    items = [decode_image(candidate) for candidate in scan.images]
    assert [(item["width"], item["height"]) for item in items] == [(13, 9), (7, 5)]
    assert items[0]["orientation"] == orientation
    before = deepcopy(items)
    with (
        patch.object(Image, "open", side_effect=AssertionError("No mapper decoding")),
        patch.object(Path, "open", autospec=True, side_effect=Path.open) as opened,
    ):
        result = import_coco(selected, items)
    opened.assert_called_once_with(annotation_path, "rb", buffering=0)
    assert result.issues == []
    assert result.classes == (
        {"key": "category:0", "name": "Ａ", "sourceCategoryId": "0"},
        {"key": "category:3", "name": "A", "sourceCategoryId": "3"},
        {"key": "category:7", "name": " 麦🌾 ", "sourceCategoryId": "7"},
    )
    first, second = result.annotations["image:0"], result.annotations["image:1"]
    assert first is not None and second is not None
    assert first["type"] == second["type"] == "detection"
    assert first["sourceImageId"] == str(SAFE_ID)
    assert second["sourceImageId"] == "2"
    assert first["boxes"] == [
        {"classKey": "category:7", "bbox": bbox, "sourceAnnotationId": "9"},
        {"classKey": "category:7", "bbox": bbox, "sourceAnnotationId": "4"},
        {
            "classKey": "category:0",
            "bbox": [0.0, 0, 13, 9.0],
            "sourceAnnotationId": str(SAFE_ID),
        },
    ]
    assert second["boxes"] == [
        {"classKey": "category:0", "bbox": [0, 0, 7, 5], "sourceAnnotationId": "0"}
    ]
    assert [type(value) for value in first["boxes"][2]["bbox"]] == [
        float,
        int,
        int,
        float,
    ]
    assert len(first["boxes"]) + len(second["boxes"]) == 4  # No NMS or score filter.
    assert set(first) == {"type", "sourceImageId", "boxes"}
    assert "private-extra" not in repr(result)
    assert items == before
    assert all(item["annotation"] is None for item in items)
    assert_contract(result, items)
    for path, (contents, mtime_ns) in originals.items():
        assert path.read_bytes() == contents
        assert path.stat().st_mtime_ns == mtime_ns
    assert set(tmp_path.rglob("*")) == {root, *originals}
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


@pytest.mark.parametrize("selection", ["directory", "files"])
def test_unlabeled_all_null_without_any_source_io(
    tmp_path: Path, selection: str
) -> None:
    selected: ScanSource
    if selection == "directory":
        selected = {
            "format": "unlabeled",
            "selection": "directory",
            "root": str(tmp_path),
        }
    else:
        selected = {
            "format": "unlabeled",
            "selection": "files",
            "selectionManifestPath": str(tmp_path / "missing.json"),
        }
    items = [image(tmp_path), image(tmp_path, "b.png", 1)]
    before = deepcopy(items)
    with (
        patch.object(Path, "lstat", side_effect=AssertionError("No source I/O")),
        patch.object(Path, "open", side_effect=AssertionError("No source I/O")),
    ):
        result = import_coco(selected, items)
    assert result == CocoImport((), {"image:0": None, "image:1": None}, [])
    assert items == before
    assert_contract(result, items)


def test_explicit_zero_boxes_is_not_missing_or_human_confirmed(tmp_path: Path) -> None:
    items = [image(tmp_path), image(tmp_path, "b.png", 1)]
    selected = source(tmp_path, document(annotations=[]))
    result = import_coco(selected, items)
    assert result.annotations == {
        "image:0": {"type": "detection", "sourceImageId": "1", "boxes": []},
        "image:1": None,
    }
    assert result.issues == [
        {
            "severity": "error",
            "code": "COCO_IMAGE_NOT_FOUND",
            "target": {
                "imageKey": "image:1",
                "sourcePath": items[1]["sourcePath"],
                "row": None,
                "itemId": None,
            },
        }
    ]
    assert all(item["annotation"] is None for item in items)
    assert_contract(result, items)


def test_zero_ids_and_safe_max_category_id_are_decimal_not_ordinals(
    tmp_path: Path,
) -> None:
    selected = source(
        tmp_path,
        document(
            images=[coco_image(id=0)],
            categories=[category(id=SAFE_ID)],
            annotations=[annotation(id=0, image_id=0, category_id=SAFE_ID)],
        ),
    )
    result = import_coco(selected, [image(tmp_path)])
    imported = result.annotations["image:0"]
    assert imported is not None
    assert imported["sourceImageId"] == "0"
    assert imported["boxes"][0]["sourceAnnotationId"] == "0"
    assert result.classes[0]["sourceCategoryId"] == str(SAFE_ID)
    assert result.classes[0]["key"] == f"category:{SAFE_ID}"
    assert result.issues == []
    assert_contract(result, [image(tmp_path)])


@pytest.mark.parametrize("bom", [b"", b"\xef\xbb\xbf"], ids=["utf8", "utf8-bom"])
def test_utf8_unicode_and_single_bom_policy(tmp_path: Path, bom: bytes) -> None:
    name = ' 日本語🌱 {"x":[],"x":{}} '
    payload = document(categories=[category(name=name)])
    raw = bom + json.dumps(payload, ensure_ascii=False).encode("utf-8")
    selected = source(tmp_path, raw)
    result = import_coco(selected, [image(tmp_path)])
    assert result.classes[0]["name"] == name
    assert result.issues == []
    assert (tmp_path / "annotations.json").read_bytes() == raw


@pytest.mark.parametrize(
    ("raw", "code"),
    [
        (b"", "EMPTY_FILE"),
        (b"\xff", "COCO_INVALID_ENCODING"),
        (b"\xc0\xaf", "COCO_INVALID_ENCODING"),
        (b"\xff\xfe{\x00}\x00", "COCO_INVALID_ENCODING"),
        (b"\xff\xfe\x00\x00", "COCO_INVALID_ENCODING"),
        (b"\xef\xbb\xbf\xef\xbb\xbf{}", "COCO_MALFORMED"),
        (b"{", "COCO_MALFORMED"),
        (b"{}{}", "COCO_MALFORMED"),
        (b"{'images':[]}", "COCO_MALFORMED"),
        (b"__import__('os').getcwd()", "COCO_MALFORMED"),
        (b"[]", "COCO_INVALID_ROOT"),
        (b"null", "COCO_INVALID_ROOT"),
        (b"{}", "COCO_INVALID_ROOT"),
        (b'{"images":{},"annotations":[],"categories":[]}', "COCO_INVALID_ROOT"),
        (b'{"images":[],"annotations":null,"categories":[]}', "COCO_INVALID_ROOT"),
        (b'{"images":[],"annotations":[],"categories":"[]"}', "COCO_INVALID_ROOT"),
    ],
)
def test_whole_file_errors_are_fixed_and_never_partial_success(
    tmp_path: Path, raw: bytes, code: str, capsys: pytest.CaptureFixture[str]
) -> None:
    selected = source(tmp_path, raw)
    with pytest.raises(CocoFormatError) as caught:
        import_coco(selected, [image(tmp_path)])
    assert caught.value.code == code
    assert caught.value.source_path == str(tmp_path / "annotations.json")
    assert caught.value.item_id is None
    assert str(caught.value) == "COCO import rejected"
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


@pytest.mark.parametrize(
    "raw",
    [
        b'{"images":[],"\\u0069mages":[],"annotations":[],"categories":[]}',
        b'{"images":[{"id":1,"id":2}],"annotations":[],"categories":[]}',
        b'{"images":[],"annotations":[],"categories":[],"info":{"a":0,"a":0}}',
        b'{"images":[],"annotations":[],"categories":[],"licenses":[{"x":0,"x":1}]}',
    ],
)
def test_duplicate_members_rejected_even_in_unused_metadata(
    tmp_path: Path, raw: bytes
) -> None:
    with pytest.raises(CocoFormatError) as caught:
        import_coco(source(tmp_path, raw), [image(tmp_path)])
    assert caught.value.code == "COCO_DUPLICATE_MEMBER"
    assert caught.value.source_path == str(tmp_path / "annotations.json")


@pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity", "1e400", "-1e400"])
@pytest.mark.parametrize("in_bbox", [False, True], ids=["metadata", "bbox"])
def test_nonfinite_numbers_rejected_everywhere(
    tmp_path: Path, token: str, in_bbox: bool
) -> None:
    text = json.dumps(document())
    if in_bbox:
        assert '"bbox": [0, 0, 1, 1]' in text
        text = text.replace('"bbox": [0, 0, 1, 1]', f'"bbox": [0, 0, {token}, 1]')
    else:
        text = text[:-1] + ', "info": {"private-extra": [' + token + "]}}"
    with pytest.raises(CocoFormatError) as caught:
        import_coco(source(tmp_path, text.encode()), [image(tmp_path)])
    assert caught.value.code == "COCO_NONFINITE_NUMBER"
    assert str(caught.value) == "COCO import rejected"


def test_excessive_nesting_and_truncation_are_controlled_errors(tmp_path: Path) -> None:
    deeply_nested = b'{"info":' + b"[" * 10000 + b"0" + b"]" * 10000 + b"}"
    truncated = json.dumps(document()).encode()[:-2]
    # Some Python builds parse this valid nesting; the incomplete root then
    # fails schema validation. Neither path may become successful COCO input.
    for raw, errors in (
        (deeply_nested, ("COCO_MALFORMED", "COCO_INVALID_ROOT")),
        (truncated, ("COCO_MALFORMED",)),
    ):
        with pytest.raises(CocoFormatError) as caught:
            import_coco(source(tmp_path, raw), [image(tmp_path)])
        assert caught.value.code in errors
        assert str(caught.value) == "COCO import rejected"


@pytest.mark.parametrize(
    ("kind", "code"),
    [
        ("images", "COCO_DUPLICATE_IMAGE_ID"),
        ("categories", "COCO_DUPLICATE_CATEGORY_ID"),
        ("annotations", "COCO_DUPLICATE_ANNOTATION_ID"),
    ],
)
def test_duplicate_ids_are_fatal_even_if_one_item_is_invalid(
    tmp_path: Path, kind: str, code: str
) -> None:
    first: dict[str, object]
    second: dict[str, object]
    if kind == "images":
        first, second = coco_image(), coco_image(file_name="../outside.png")
    elif kind == "categories":
        first, second = category(), category(name="")
    else:
        first, second = annotation(), annotation(image_id=2, bbox=None)
    selected = source(tmp_path, document(**{kind: [first, second]}))
    with pytest.raises(CocoFormatError) as caught:
        import_coco(selected, [image(tmp_path), image(tmp_path, "b.png", 1)])
    assert caught.value.code == code
    assert caught.value.item_id == str(first["id"])
    assert caught.value.source_path == str(tmp_path / "annotations.json")


@pytest.mark.parametrize("second", ["sub/a.png", "SUB\\A.PNG"])
def test_duplicate_coco_paths_never_last_wins(tmp_path: Path, second: str) -> None:
    selected = source(
        tmp_path,
        document(
            images=[
                coco_image(file_name="sub/a.png"),
                coco_image(id=2, file_name=second, width=False),
            ]
        ),
    )
    with pytest.raises(CocoFormatError) as caught:
        import_coco(selected, [image(tmp_path, "sub/a.png")])
    assert caught.value.code == "COCO_DUPLICATE_IMAGE_PATH"
    assert caught.value.item_id == "2"


@pytest.mark.parametrize("kind", ["images", "categories", "annotations"])
@pytest.mark.parametrize("bad", [True, False, -1, 1.0, "1", SAFE_ID + 1, None, [], {}])
def test_source_ids_are_exact_nonnegative_safe_integers(
    tmp_path: Path, kind: str, bad: object
) -> None:
    factory = {"images": coco_image, "categories": category, "annotations": annotation}
    invalid = factory[kind](id=bad)
    result = import_coco(
        source(tmp_path, document(**{kind: [invalid]})), [image(tmp_path)]
    )
    expected = {
        "images": "COCO_INVALID_IMAGE_ID",
        "categories": "COCO_INVALID_CATEGORY_ID",
        "annotations": "COCO_INVALID_ANNOTATION_ID",
    }[kind]
    issue = next(issue for issue in result.issues if issue["code"] == expected)
    assert issue["target"]["itemId"] == f"{kind}:0"
    assert issue["target"]["row"] is None
    assert issue["severity"] == "error"
    if kind != "categories":
        assert issue["target"]["imageKey"] == "image:0"
        assert issue["target"]["sourcePath"] == str(tmp_path / "a.png")
    assert_contract(result, [image(tmp_path)])


def test_exponent_id_is_not_coerced_to_integer(tmp_path: Path) -> None:
    raw = json.dumps(document()).replace('"id": 11', '"id": 11e0').encode()
    result = import_coco(source(tmp_path, raw), [image(tmp_path)])
    assert codes(result) == ["COCO_INVALID_ANNOTATION_ID"]
    assert result.issues[0]["target"]["itemId"] == "annotations:0"


@pytest.mark.parametrize("kind", ["images", "categories", "annotations"])
def test_nonobject_items_report_array_position_without_echoing_payload(
    tmp_path: Path, kind: str
) -> None:
    selected = source(tmp_path, document(**{kind: [None, ["private-extra"]]}))
    result = import_coco(selected, [image(tmp_path)])
    positions = {issue["target"]["itemId"] for issue in result.issues}
    assert {f"{kind}:0", f"{kind}:1"} <= positions
    assert "private-extra" not in repr(result)
    assert_contract(result, [image(tmp_path)])


@pytest.mark.parametrize(
    "name", [None, 7, "", " \t\u3000\ufeff", "bad\0name", "\ud800"]
)
def test_invalid_category_name_keeps_safe_context(tmp_path: Path, name: object) -> None:
    result = import_coco(
        source(tmp_path, document(categories=[category(name=name)])), [image(tmp_path)]
    )
    assert result.classes == ()
    assert codes(result) == ["COCO_INVALID_CATEGORY_NAME", "COCO_UNKNOWN_CATEGORY_ID"]
    assert result.issues[0]["target"] == {
        "imageKey": None,
        "sourcePath": str(tmp_path / "annotations.json"),
        "row": None,
        "itemId": "7",
    }
    assert_contract(result, [image(tmp_path)])


def test_names_are_preserved_duplicates_reported_and_sorted_by_actual_id(
    tmp_path: Path,
) -> None:
    rows = [
        category(id=50, name="同名"),
        category(id=2, name="同名"),
        category(id=12, name="Ａ"),
        category(id=10, name="A"),
        category(id=3, name="constructor"),
    ]
    boxes = [annotation(id=99, category_id=50), annotation(id=98, category_id=2)]
    items = [image(tmp_path)]
    selected = source(tmp_path, document(categories=rows, annotations=boxes))
    first = import_coco(selected, items)
    selected = source(
        tmp_path, document(categories=list(reversed(rows)), annotations=boxes)
    )
    second = import_coco(selected, items)
    assert first.classes == second.classes
    assert [entry["sourceCategoryId"] for entry in first.classes] == [
        "2",
        "3",
        "10",
        "12",
        "50",
    ]
    assert [entry["name"] for entry in first.classes] == [
        "同名",
        "constructor",
        "A",
        "Ａ",
        "同名",
    ]
    assert codes(first) == ["COCO_DUPLICATE_CATEGORY_NAME"] * 2
    assert {issue["target"]["itemId"] for issue in first.issues} == {"2", "50"}
    imported = first.annotations["image:0"]
    assert imported is not None
    assert [box["classKey"] for box in imported["boxes"]] == [
        "category:50",
        "category:2",
    ]
    assert_contract(first, items)


@pytest.mark.parametrize("field", ["width", "height"])
@pytest.mark.parametrize("bad", [True, False, 0, -1, 13.0, "13", None, SAFE_ID + 1])
def test_coco_dimensions_must_be_positive_integer_raw_dimensions(
    tmp_path: Path, field: str, bad: object
) -> None:
    result = import_coco(
        source(tmp_path, document(images=[coco_image(**{field: bad})])),
        [image(tmp_path)],
    )
    assert result.annotations["image:0"] is None
    assert codes(result) == ["COCO_INVALID_IMAGE_DIMENSIONS", "COCO_IMAGE_UNAVAILABLE"]
    assert result.issues[0]["target"]["imageKey"] == "image:0"
    assert result.issues[0]["target"]["itemId"] == "1"
    assert_contract(result, [image(tmp_path)])


def test_exif_six_post_rotation_dimensions_do_not_override_raw(tmp_path: Path) -> None:
    item = image(tmp_path)
    item["orientation"] = 6
    before = deepcopy(item)
    selected = source(tmp_path, document(images=[coco_image(width=9, height=13)]))
    result = import_coco(selected, [item])
    assert result.annotations["image:0"] is None
    assert codes(result) == ["COCO_IMAGE_DIMENSION_MISMATCH", "COCO_IMAGE_UNAVAILABLE"]
    assert item == before


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"image_id": 999}, "COCO_UNKNOWN_IMAGE_ID"),
        ({"category_id": 999}, "COCO_UNKNOWN_CATEGORY_ID"),
        ({"image_id": True}, "COCO_INVALID_IMAGE_ID"),
        ({"image_id": "1"}, "COCO_INVALID_IMAGE_ID"),
        ({"image_id": SAFE_ID + 1}, "COCO_INVALID_IMAGE_ID"),
        ({"category_id": True}, "COCO_INVALID_CATEGORY_ID"),
        ({"category_id": "7"}, "COCO_INVALID_CATEGORY_ID"),
        ({"category_id": SAFE_ID + 1}, "COCO_INVALID_CATEGORY_ID"),
    ],
)
def test_unknown_and_invalid_references_keep_annotation_id_context(
    tmp_path: Path, changes: dict[str, object], code: str
) -> None:
    rows = [annotation(id=91, **changes), annotation(id=92)]
    result = import_coco(
        source(tmp_path, document(annotations=rows)), [image(tmp_path)]
    )
    assert codes(result) == [code]
    assert result.issues[0]["target"]["itemId"] == "91"
    imported = result.annotations["image:0"]
    assert imported is not None
    assert [box["sourceAnnotationId"] for box in imported["boxes"]] == ["92"]
    assert_contract(result, [image(tmp_path)])


@pytest.mark.parametrize("bad", [True, False, 2, -1, 0.0, "0", None])
def test_invalid_crowd_flag_is_not_silently_interpreted(
    tmp_path: Path, bad: object
) -> None:
    selected = source(tmp_path, document(annotations=[annotation(iscrowd=bad)]))
    result = import_coco(selected, [image(tmp_path)])
    assert codes(result) == ["COCO_INVALID_ISCROWD"]
    assert result.annotations["image:0"] == {
        "type": "detection",
        "sourceImageId": "1",
        "boxes": [],
    }


@pytest.mark.parametrize(
    "bbox",
    [
        None,
        "[0,0,1,1]",
        {"x": 0, "y": 0, "width": 1, "height": 1},
        [],
        [0, 0, 1],
        [0, 0, 1, 1, 1],
        [0, 0, 0, 1],
        [0, 0, 1, 0],
        [0, 0, -1, 1],
        [0, 0, 1, -1],
        [0, 0, SAFE_ID + 1, 1],
        [0, 0, [1], 1],
    ],
)
def test_invalid_bbox_reports_error_and_valid_items_survive(
    tmp_path: Path, bbox: object
) -> None:
    rows = [annotation(id=90), annotation(id=91, bbox=bbox), annotation(id=89)]
    selected = source(tmp_path, document(annotations=rows))
    before = (tmp_path / "annotations.json").read_bytes()
    result = import_coco(selected, [image(tmp_path)])
    assert codes(result) == ["COCO_INVALID_BBOX"]
    assert result.issues[0]["target"] == {
        "imageKey": "image:0",
        "sourcePath": str(tmp_path / "a.png"),
        "row": None,
        "itemId": "91",
    }
    imported = result.annotations["image:0"]
    assert imported is not None
    assert [box["sourceAnnotationId"] for box in imported["boxes"]] == ["90", "89"]
    assert (tmp_path / "annotations.json").read_bytes() == before
    assert_contract(result, [image(tmp_path)])


@pytest.mark.parametrize("position", range(4))
@pytest.mark.parametrize("value", [True, False, "1", None])
def test_each_bbox_coordinate_rejects_boolean_or_coercion(
    tmp_path: Path, position: int, value: object
) -> None:
    bbox: list[object] = [0, 0, 1, 1]
    bbox[position] = value
    selected = source(tmp_path, document(annotations=[annotation(bbox=bbox)]))
    result = import_coco(selected, [image(tmp_path)])
    assert codes(result) == ["COCO_INVALID_BBOX"]


@pytest.mark.parametrize(
    "bbox",
    [
        [-1, 0, 2, 2],
        [0, -1, 2, 2],
        [12, 0, 2, 2],
        [0, 8, 2, 2],
        [13, 0, 1e-20, 1],
        [0, 9, 1, 1e-20],
        [1e-20, 0, 13, 1],
        [0, 1e-20, 1, 9],
        [14, 0, 1, 1],
        [0, 10, 1, 1],
    ],
)
def test_outside_boxes_are_diagnosed_not_clamped_or_silently_lost(
    tmp_path: Path, bbox: list[int | float]
) -> None:
    selected = source(tmp_path, document(annotations=[annotation(bbox=bbox)]))
    path = tmp_path / "annotations.json"
    before, mtime_ns = path.read_bytes(), path.stat().st_mtime_ns
    result = import_coco(selected, [image(tmp_path)])
    assert codes(result) == ["BBOX_OUT_OF_BOUNDS"]
    assert result.issues[0]["target"]["itemId"] == "11"
    assert result.annotations["image:0"] == {
        "type": "detection",
        "sourceImageId": "1",
        "boxes": [],
    }
    assert path.read_bytes() == before
    assert path.stat().st_mtime_ns == mtime_ns
    assert_contract(result, [image(tmp_path)])


@pytest.mark.parametrize(
    "bbox",
    [[0, 0, 13, 9], [12, 0, 1e-20, 1], [0, 8, 1, 1e-20], [-0.0, 0, 13.0, 9]],
)
def test_valid_boundaries_tiny_widths_and_numeric_types_are_unchanged(
    tmp_path: Path, bbox: list[int | float]
) -> None:
    result = import_coco(
        source(tmp_path, document(annotations=[annotation(bbox=bbox)])),
        [image(tmp_path)],
    )
    assert result.issues == []
    imported = result.annotations["image:0"]
    assert imported is not None
    actual = imported["boxes"][0]["bbox"]
    assert actual == bbox
    assert [type(number) for number in actual] == [type(number) for number in bbox]
    assert math.copysign(1, actual[0]) == math.copysign(1, bbox[0])
    assert_contract(result, [image(tmp_path)])


@pytest.mark.parametrize(
    "supplied",
    [
        "",
        ".",
        "..",
        "../a.png",
        "sub/../a.png",
        "./a.png",
        "/a.png",
        "\\a.png",
        "C:a.png",
        "C:/a.png",
        "//server/share/a.png",
        "\\\\?\\C:\\a.png",
        "file:///C:/a.png",
        "https://example.invalid/a.png",
        "a.png:stream",
        "NUL.png",
        "COM¹.png",
        "a.png.",
        "a.png ",
        "sub//a.png",
        "a\0.png",
        "a\n.png",
        "\ud800.png",
    ],
)
def test_unsafe_references_checked_lexically_before_matching_or_opening(
    tmp_path: Path, supplied: str
) -> None:
    selected = source(tmp_path, document(images=[coco_image(file_name=supplied)]))
    with patch.object(Path, "open", autospec=True, side_effect=Path.open) as opened:
        result = import_coco(selected, [image(tmp_path)])
    opened.assert_called_once_with(tmp_path / "annotations.json", "rb", buffering=0)
    assert result.annotations["image:0"] is None
    assert result.issues[0]["code"] == "COCO_UNSAFE_PATH"
    assert result.issues[0]["target"] == {
        "imageKey": None,
        "sourcePath": str(tmp_path / "annotations.json"),
        "row": None,
        "itemId": "1",
    }
    assert_contract(result, [image(tmp_path)])


@pytest.mark.parametrize(
    "supplied", ["missing.png", "sub/a.png", "a.png,cat", "%2e%2e/a.png"]
)
def test_missing_files_are_not_basename_csv_or_url_decoded_matches(
    tmp_path: Path, supplied: str
) -> None:
    selected = source(tmp_path, document(images=[coco_image(file_name=supplied)]))
    result = import_coco(selected, [image(tmp_path)])
    assert result.annotations == {"image:0": None}
    assert result.issues[0] == {
        "severity": "error",
        "code": "COCO_IMAGE_FILE_NOT_FOUND",
        "target": {
            "imageKey": None,
            "sourcePath": supplied,
            "row": None,
            "itemId": "1",
        },
    }
    assert "COCO_IMAGE_NOT_FOUND" in codes(result)
    assert_contract(result, [image(tmp_path)])


def test_ambiguous_scanned_case_paths_refuse_even_exact_match(tmp_path: Path) -> None:
    items = [image(tmp_path, "A.png"), image(tmp_path, "a.png", 1)]
    result = import_coco(source(tmp_path, document()), items)
    assert result.annotations == {"image:0": None, "image:1": None}
    ambiguous = [
        issue for issue in result.issues if issue["code"] == "IMAGE_PATH_AMBIGUOUS"
    ]
    assert {issue["target"]["imageKey"] for issue in ambiguous} == {
        "image:0",
        "image:1",
        None,
    }
    assert_contract(result, items)


@pytest.mark.parametrize(("first", "second"), [("ß.png", "ss.png"), ("ı.png", "i.png")])
def test_non_ascii_names_are_distinct_and_never_guessed(
    tmp_path: Path, first: str, second: str
) -> None:
    items = [image(tmp_path, first), image(tmp_path, second, 1)]
    payload = document(
        images=[coco_image(file_name=first), coco_image(id=2, file_name=second)],
        annotations=[],
    )
    result = import_coco(source(tmp_path, payload), items)
    assert result.issues == []
    assert all(value is not None for value in result.annotations.values())
    assert_contract(result, items)
    mismatch = import_coco(
        source(
            tmp_path, document(images=[coco_image(file_name=second)], annotations=[])
        ),
        [items[0]],
    )
    assert mismatch.annotations == {"image:0": None}
    assert codes(mismatch) == ["COCO_IMAGE_FILE_NOT_FOUND", "COCO_IMAGE_NOT_FOUND"]


def test_ascii_aliases_keep_original_paths_and_nonascii_sibling_is_outside(
    tmp_path: Path,
) -> None:
    root = tmp_path / "straße"
    root.mkdir()
    items = [image(root, "Sub/A.PNG"), image(tmp_path / "strasse", "b.png", 1)]
    selected = source(root, document(images=[coco_image(file_name="SUB\\a.png")]))
    before = deepcopy(items)
    result = import_coco(selected, items)
    assert result.annotations["image:0"] is not None
    assert result.annotations["image:1"] is None
    assert codes(result) == ["IMAGE_OUTSIDE_ROOT"]
    assert result.issues[0]["target"]["sourcePath"] == items[1]["sourcePath"]
    assert items == before
    assert_contract(result, items)


def test_duplicate_hashes_keep_both_images_and_all_annotations(tmp_path: Path) -> None:
    items = [image(tmp_path), image(tmp_path, "b.png", 1)]
    items[1]["sha256"] = items[0]["sha256"]
    items[1]["duplicateOf"] = items[0]["key"]
    before = deepcopy(items)
    payload = document(
        images=[coco_image(), coco_image(id=2, file_name="b.png")],
        annotations=[annotation(), annotation(id=12, image_id=2)],
    )
    result = import_coco(source(tmp_path, payload), items)
    assert result.issues == []
    assert all(
        value is not None and len(value["boxes"]) == 1
        for value in result.annotations.values()
    )
    assert items == before
    assert_contract(result, items)


def test_source_and_input_preconditions_precede_any_io(tmp_path: Path) -> None:
    unchecked: list[Callable[..., object]] = [import_coco]
    invalid_sources: list[object] = [
        {"format": "folder", "root": str(tmp_path)},
        {"format": "csv", "root": str(tmp_path), "annotationPath": "C:\\labels.csv"},
        {"format": "coco", "imageRoot": str(tmp_path), "annotationPath": "C:\\x.json"},
        {
            "format": "coco",
            "root": str(tmp_path),
            "annotationPath": "C:\\x\\..\\x.json",
        },
        {
            "format": "coco",
            "root": str(tmp_path),
            "annotationPath": "C:\\x.json",
            "extra": 1,
        },
    ]
    valid: ScanSource = {
        "format": "coco",
        "root": str(tmp_path),
        "annotationPath": "C:\\missing.json",
    }
    with patch.object(Path, "lstat", side_effect=AssertionError("No I/O")):
        for selected in invalid_sources:
            with pytest.raises(ValueError, match="^Invalid import contract$"):
                unchecked[0](selected, [image(tmp_path)])
        for items, code in (
            ([], "NO_VALID_IMAGES"),
            ([image(tmp_path)] * (MAX_INPUT_ITEMS + 1), "INPUT_LIMIT_EXCEEDED"),
            ([image(tmp_path), image(tmp_path)], "INVALID_IMAGE_KEYS"),
        ):
            with pytest.raises(CocoFormatError) as caught:
                import_coco(valid, items)
            assert caught.value.code == code


def test_hashed_image_is_not_a_decoded_image(tmp_path: Path) -> None:
    item = image(tmp_path)
    candidate: HashedImage = {
        "key": item["key"],
        "sourcePath": item["sourcePath"],
        "byteSize": item["byteSize"],
        "mtimeNs": item["mtimeNs"],
        "sha256": item["sha256"],
        "format": item["format"],
        "duplicateOf": item["duplicateOf"],
    }
    selected: ScanSource = {
        "format": "unlabeled",
        "selection": "directory",
        "root": str(tmp_path),
    }
    unchecked: list[Callable[..., object]] = [import_coco]
    with (
        patch.object(Path, "lstat", side_effect=AssertionError("No I/O")),
        pytest.raises(CocoFormatError) as caught,
    ):
        unchecked[0](selected, [candidate])
    assert caught.value.code == "INVALID_IMAGE_METADATA"


def test_sparse_size_limit_rejected_before_open_or_allocation(tmp_path: Path) -> None:
    path = tmp_path / "annotations.json"
    with path.open("wb") as stream:
        stream.truncate(MAX_ANNOTATION_BYTES + 1)
    selected: ScanSource = {
        "format": "coco",
        "root": str(tmp_path),
        "annotationPath": str(path),
    }
    with (
        patch.object(Path, "open", side_effect=AssertionError("No oversized read")),
        pytest.raises(CocoFormatError) as caught,
    ):
        import_coco(selected, [image(tmp_path)])
    assert caught.value.code == "ANNOTATION_TOO_LARGE"


@pytest.mark.parametrize("none_read", [False, True], ids=["short", "none"])
def test_short_and_none_reads_are_not_accepted(tmp_path: Path, none_read: bool) -> None:
    raw = json.dumps(document()).encode() + b"\n"
    selected = source(tmp_path, raw)
    path = tmp_path / "annotations.json"
    before = path.stat().st_mtime_ns
    with (
        path.open("rb", buffering=0) as stream,
        patch.object(Path, "open", autospec=True) as opened,
    ):
        reader = opened.return_value.__enter__.return_value
        reader.fileno.return_value = stream.fileno()
        reader.read.side_effect = [None] if none_read else [raw[:-1], b""]
        with pytest.raises(CocoFormatError) as caught:
            import_coco(selected, [image(tmp_path)])
        assert caught.value.code == (
            "ANNOTATION_READ_FAILED" if none_read else "SOURCE_CHANGED"
        )
        opened.assert_called_once_with(path, "rb", buffering=0)
    assert path.read_bytes() == raw
    assert path.stat().st_mtime_ns == before


def test_growth_after_stat_is_bounded_by_read_budget(tmp_path: Path) -> None:
    raw = json.dumps(document()).encode()
    selected = source(tmp_path, raw)
    path = tmp_path / "annotations.json"
    with (
        path.open("rb", buffering=0) as stream,
        patch.object(Path, "open", autospec=True) as opened,
        patch("autovision_ml.data.coco_import.MAX_ANNOTATION_BYTES", len(raw) + 3),
    ):
        reader = opened.return_value.__enter__.return_value
        reader.fileno.return_value = stream.fileno()
        reader.read.side_effect = [raw, b"    "]
        with pytest.raises(CocoFormatError) as caught:
            import_coco(selected, [image(tmp_path)])
        assert caught.value.code == "ANNOTATION_TOO_LARGE"
        assert reader.read.call_count == 2
        reader.read.assert_called_with(4)
    assert path.read_bytes() == raw


def test_hardlinked_annotation_never_opened(tmp_path: Path) -> None:
    selected = source(tmp_path, document())
    os.link(tmp_path / "annotations.json", tmp_path / "alias.json")
    with (
        patch.object(Path, "open", side_effect=AssertionError("No hardlink read")),
        pytest.raises(CocoFormatError) as caught,
    ):
        import_coco(selected, [image(tmp_path)])
    assert caught.value.code == "UNSAFE_FILE"


def test_junction_root_and_annotation_ancestor_never_followed(tmp_path: Path) -> None:
    import _winapi

    target = tmp_path / "target"
    target.mkdir()
    selected = source(target, document())
    junction = tmp_path / "junction"
    _winapi.CreateJunction(str(target), str(junction))
    try:
        variants: list[CocoSource] = [
            {**selected, "root": str(junction)},
            {**selected, "annotationPath": str(junction / "annotations.json")},
        ]
        with patch.object(Path, "open", side_effect=AssertionError("No junction read")):
            for variant in variants:
                with pytest.raises(CocoFormatError) as caught:
                    import_coco(variant, [image(Path(variant["root"]))])
                assert caught.value.code == "UNSAFE_PATH"
    finally:
        junction.rmdir()
    assert import_coco(selected, [image(target)]).issues == []


def test_symlink_annotation_rejected_when_privilege_available(tmp_path: Path) -> None:
    target = tmp_path / "target.json"
    selected = source(tmp_path, document(), target)
    link = tmp_path / "annotations.json"
    try:
        link.symlink_to(target)
    except OSError as error:
        if error.winerror == 1314:
            pytest.skip("Symlink privilege unavailable; junction test is separate")
        raise
    selected["annotationPath"] = str(link)
    with (
        patch.object(Path, "open", side_effect=AssertionError("No symlink read")),
        pytest.raises(CocoFormatError) as caught,
    ):
        import_coco(selected, [image(tmp_path)])
    assert caught.value.code == "UNSAFE_PATH"


def test_read_failures_are_sanitized_without_logging(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    selected = source(tmp_path, document())
    with (
        patch.object(Path, "open", side_effect=PermissionError("private-extra")),
        pytest.raises(CocoFormatError) as caught,
    ):
        import_coco(selected, [image(tmp_path)])
    assert caught.value.code == "ANNOTATION_READ_FAILED"
    assert caught.value.source_path == selected["annotationPath"]
    assert str(caught.value) == "COCO import rejected"
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


def test_same_size_mutation_during_read_is_detected(tmp_path: Path) -> None:
    selected = source(tmp_path, document())
    path = tmp_path / "annotations.json"
    raw = path.read_bytes()
    original_fstat = os.fstat
    calls = 0

    def changed(fd: int) -> os.stat_result:
        nonlocal calls
        calls += 1
        if calls == 2:
            replacement = raw.replace(b'"id": 11', b'"id": 12')
            assert len(replacement) == len(raw) and replacement != raw
            path.write_bytes(replacement)
            info = path.stat()
            os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000_000))
        return original_fstat(fd)

    with patch("os.fstat", changed), pytest.raises(CocoFormatError) as caught:
        import_coco(selected, [image(tmp_path)])
    assert calls == 2
    assert caught.value.code == "SOURCE_CHANGED"


def test_replacement_between_stat_and_open_is_rejected(tmp_path: Path) -> None:
    selected = source(tmp_path, document())
    path = tmp_path / "annotations.json"
    before = path.stat()
    replacement = tmp_path / "replacement.json"
    replacement.write_bytes(path.read_bytes())
    os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
    original_open = Path.open

    def replaced(open_path: Path, mode: str, buffering: int) -> object:
        assert open_path == path and mode == "rb" and buffering == 0
        replacement.replace(path)
        return original_open(path, "rb", buffering=0)

    with patch.object(Path, "open", autospec=True) as opened:
        opened.side_effect = replaced
        with pytest.raises(CocoFormatError) as caught:
            import_coco(selected, [image(tmp_path)])
    assert caught.value.code == "SOURCE_CHANGED"


def test_replacement_on_close_is_rejected(tmp_path: Path) -> None:
    selected = source(tmp_path, document())
    path = tmp_path / "annotations.json"
    before = path.stat()
    replacement = tmp_path / "replacement.json"
    replacement.write_bytes(path.read_bytes())
    os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
    with (
        path.open("rb", buffering=0) as stream,
        patch.object(Path, "open", autospec=True) as opened,
    ):
        opened.return_value.__enter__.return_value = stream

        def replace_on_close(*_args: object) -> None:
            stream.close()
            replacement.replace(path)

        opened.return_value.__exit__.side_effect = replace_on_close
        with pytest.raises(CocoFormatError) as caught:
            import_coco(selected, [image(tmp_path)])
        assert stream.closed
        opened.return_value.__exit__.assert_called_once_with(None, None, None)
        assert caught.value.code == "SOURCE_CHANGED"
        assert caught.value.source_path == str(path)


def test_external_annotation_does_not_hide_root_replacement(tmp_path: Path) -> None:
    root = tmp_path / "images"
    root.mkdir()
    selected = source(root, document(), tmp_path / "annotations.json")
    original_fstat = os.fstat
    calls = 0

    def replaced_root(fd: int) -> os.stat_result:
        nonlocal calls
        calls += 1
        if calls == 2:
            root.rename(tmp_path / "old-images")
            root.mkdir()
        return original_fstat(fd)

    with patch("os.fstat", replaced_root), pytest.raises(CocoFormatError) as caught:
        import_coco(selected, [image(root)])
    assert caught.value.code == "SOURCE_CHANGED"
    assert caught.value.source_path == str(root)


def test_stable_cross_api_ctime_difference_is_not_a_source_change(
    tmp_path: Path,
) -> None:
    selected = source(tmp_path, document())
    path = tmp_path / "annotations.json"
    raw, before = path.read_bytes(), path.lstat()
    handle_ctime_ns = before.st_ctime_ns + 1_000_000_000
    original_fstat = os.fstat

    def different_ctime(fd: int) -> os.stat_result:
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

    with patch("os.fstat", different_ctime):
        result = import_coco(selected, [image(tmp_path)])
    assert result.issues == []
    assert result.annotations["image:0"] is not None
    assert path.lstat().st_ctime_ns != handle_ctime_ns
    assert path.read_bytes() == raw
    assert path.stat().st_mtime_ns == before.st_mtime_ns
    assert_contract(result, [image(tmp_path)])
