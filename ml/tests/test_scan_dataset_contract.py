from __future__ import annotations

import json
from collections.abc import Callable

import pytest

from autovision_ml.data.import_contract import (
    MAX_ANNOTATION_BYTES,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_PIXELS,
    MAX_INPUT_ITEMS,
    MAX_SCAN_RESULT_BYTES,
    ScanContext,
    decode_scan_result,
    decode_selection_manifest,
    parse_scan_payload,
    parse_scan_result,
    parse_selection_manifest,
)
from autovision_ml.protocol import (
    MAX_WORKER_MESSAGE_BYTES,
    encode_worker_request,
    parse_worker_request,
)

# Mirrored values/case IDs in src/shared/contracts/import.test.ts. Synthetic
# boundary data, not evidence of image decoding, hashing, I/O or a working CLI.
JOB_ID = "ae45cf74-c9f9-4c49-88b9-0523b1ac7383"
PROJECT_ID = "01234567-89ab-4cde-8f01-23456789abcd"
EXPECTED: ScanContext = {
    "jobId": JOB_ID,
    "projectId": PROJECT_ID,
    "taskType": "classification",
    "mode": "copy",
}
ROOT = "C:\\画像"
FILE = ROOT + "\\a.png"
INVALID = "^Invalid import contract$"
MANIFEST_JSON = (
    '{"formatVersion":1,"files":["C:\\\\画像\\\\a.png",'
    '"C:\\\\画像\\\\A.png","C:\\\\画像\\\\a.png"]}'
)
UNLABELED: dict[str, object] = {
    "format": "unlabeled",
    "selection": "directory",
    "root": ROOT,
}


def image(**changes: object) -> dict[str, object]:
    return {
        "key": "image:0",
        "sourcePath": FILE,
        "byteSize": 1234,
        "mtimeNs": "1750000000123456789",
        "sha256": "a" * 64,
        "format": "png",
        "width": 640,
        "height": 480,
        "orientation": 1,
        "duplicateOf": None,
        "annotation": None,
        **changes,
    }


def result(**changes: object) -> dict[str, object]:
    return {
        "formatVersion": 1,
        **EXPECTED,
        "classes": [],
        "images": [image()],
        "issues": [],
        **changes,
    }


def box(**changes: object) -> dict[str, object]:
    return {
        "classKey": "crop",
        "bbox": [0.25, 2.5, 100.125, 40.5],
        "sourceAnnotationId": "19",
        **changes,
    }


def detection(**changes: object) -> dict[str, object]:
    return result(
        **{
            "taskType": "detection",
            "classes": [{"key": "crop", "name": "健康🌱", "sourceCategoryId": "7"}],
            "images": [
                image(
                    annotation={
                        "type": "detection",
                        "sourceImageId": "11",
                        "boxes": [box()],
                    }
                )
            ],
            **changes,
        }
    )


def wire(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


SOURCES: list[tuple[str, dict[str, object], tuple[str, ...]]] = [
    ("unlabeled-directory", UNLABELED, ("classification", "detection")),
    (
        "unlabeled-files",
        {
            "format": "unlabeled",
            "selection": "files",
            "selectionManifestPath": "C:\\staging\\selection.json",
        },
        ("classification", "detection"),
    ),
    ("folder", {"format": "folder", "root": ROOT}, ("classification",)),
    (
        "csv",
        {"format": "csv", "root": ROOT, "annotationPath": "C:\\labels.csv"},
        ("classification",),
    ),
    (
        "coco",
        {"format": "coco", "root": ROOT, "annotationPath": "C:\\labels.json"},
        ("detection",),
    ),
]
PATHS: list[tuple[str, str, bool]] = [
    ("drive-root", "C:\\", True),
    ("unicode", "C:\\日本語🌱\\a.png", True),
    ("forward-slash", "c:/data/a.png", True),
    ("unc-share", "\\\\server\\share", True),
    ("unc-file", "//server/share/images/a.png", True),
    ("empty", "", False),
    ("blank", " ", False),
    ("relative", "images/a.png", False),
    ("drive-relative", "C:a.png", False),
    ("posix", "/images/a.png", False),
    ("rooted", "\\images\\a.png", False),
    ("file-uri", "file:///C:/a.png", False),
    ("url", "https://example.invalid/a.png", False),
    ("nul", "C:\\a\0.png", False),
    ("extended-device", "\\\\?\\C:\\images", False),
    ("pipe-device", "\\\\.\\pipe\\x", False),
    ("nt-device", "\\??\\C:\\images", False),
    ("unc-no-share", "\\\\server", False),
    ("unc-empty-share", "\\\\server\\", False),
    ("parent", "C:\\a\\..\\b", False),
    ("dot", "C:\\a\\.\\b", False),
    ("empty-segment", "C:\\a\\\\b", False),
    ("dos-device", "C:\\NUL.jpg", False),
    ("ads", "C:\\a.png:stream", False),
    ("trailing-dot", "C:\\a.", False),
    ("trailing-space", "C:\\a ", False),
    ("control", "C:\\a\nb", False),
]
BAD_PAYLOADS: list[tuple[str, object]] = [
    ("null", None),
    ("array", []),
    ("missing-mode", {"taskType": "classification", "source": UNLABELED}),
    (
        "bad-mode",
        {"taskType": "classification", "mode": "auto", "source": UNLABELED},
    ),
    (
        "bad-task",
        {"taskType": "segmentation", "mode": "copy", "source": UNLABELED},
    ),
    (
        "extra",
        {
            "taskType": "classification",
            "mode": "copy",
            "source": UNLABELED,
            "limits": {},
        },
    ),
    (
        "rootPath-alias",
        {
            "taskType": "classification",
            "mode": "copy",
            "source": {"format": "folder", "rootPath": ROOT},
        },
    ),
    (
        "missing-selection",
        {
            "taskType": "classification",
            "mode": "copy",
            "source": {"format": "unlabeled", "root": ROOT},
        },
    ),
    (
        "both-selections",
        {
            "taskType": "classification",
            "mode": "copy",
            "source": {**UNLABELED, "selectionManifestPath": FILE},
        },
    ),
    (
        "inline-files",
        {
            "taskType": "classification",
            "mode": "copy",
            "source": {"format": "unlabeled", "selection": "files", "files": [FILE]},
        },
    ),
    (
        "files-with-root",
        {
            "taskType": "classification",
            "mode": "copy",
            "source": {
                "format": "unlabeled",
                "selection": "files",
                "root": ROOT,
                "selectionManifestPath": FILE,
            },
        },
    ),
    (
        "bad-format",
        {
            "taskType": "classification",
            "mode": "copy",
            "source": {"format": "zip", "root": ROOT},
        },
    ),
]


@pytest.mark.parametrize(
    ("_case", "source", "tasks"), SOURCES, ids=[case[0] for case in SOURCES]
)
def test_source_task_mode_matrix(
    _case: str, source: dict[str, object], tasks: tuple[str, ...]
) -> None:
    for task in ("classification", "detection"):
        for mode in ("copy", "reference"):
            candidate = {"taskType": task, "mode": mode, "source": source}
            if task not in tasks:
                with pytest.raises(ValueError, match=INVALID):
                    parse_scan_payload(candidate)
                continue
            parsed = parse_scan_payload(candidate)
            encoded = encode_worker_request(
                {
                    "schemaVersion": 1,
                    "jobId": JOB_ID,
                    "projectId": PROJECT_ID,
                    "kind": "scan-dataset",
                    "payload": parsed,
                }
            )
            received = parse_worker_request(encoded)
            assert parse_scan_payload(received["payload"]) == candidate
            assert parsed == candidate


@pytest.mark.parametrize(
    ("_case", "candidate"), BAD_PAYLOADS, ids=[case[0] for case in BAD_PAYLOADS]
)
def test_bad_payloads(_case: str, candidate: object) -> None:
    with pytest.raises(ValueError, match=INVALID):
        parse_scan_payload(candidate)


@pytest.mark.parametrize(
    ("_case", "path", "accepted"), PATHS, ids=[case[0] for case in PATHS]
)
def test_structural_absolute_paths(_case: str, path: str, accepted: bool) -> None:
    candidates: list[dict[str, object]] = [
        {
            "taskType": "classification",
            "mode": "copy",
            "source": {**UNLABELED, "root": path},
        },
        {
            "taskType": "classification",
            "mode": "reference",
            "source": {"format": "csv", "root": ROOT, "annotationPath": path},
        },
        {
            "taskType": "detection",
            "mode": "copy",
            "source": {
                "format": "unlabeled",
                "selection": "files",
                "selectionManifestPath": path,
            },
        },
    ]
    for candidate in candidates:
        if accepted:
            assert parse_scan_payload(candidate) == candidate
        else:
            with pytest.raises(ValueError, match=INVALID):
                parse_scan_payload(candidate)
    manifest = {"formatVersion": 1, "files": [path]}
    scanned = result(images=[image(sourcePath=path)])
    if accepted:
        assert parse_selection_manifest(manifest) == manifest
        assert parse_scan_result(scanned) == scanned
    else:
        with pytest.raises(ValueError, match=INVALID):
            parse_selection_manifest(manifest)
        with pytest.raises(ValueError, match=INVALID):
            parse_scan_result(scanned)


def test_selection_spelling_order_and_duplicates_are_preserved() -> None:
    files = [FILE, ROOT + "\\A.png", FILE]
    value = {"formatVersion": 1, "files": files}
    parsed = parse_selection_manifest(value)
    assert parsed == value
    assert parsed["files"] is not files
    assert decode_selection_manifest(MANIFEST_JSON) == parsed
    assert decode_selection_manifest(MANIFEST_JSON.encode()) == parsed


def test_selection_count_precedes_deduplication_without_truncation() -> None:
    parsed = parse_selection_manifest(
        {"formatVersion": 1, "files": [FILE] * MAX_INPUT_ITEMS}
    )
    assert len(parsed["files"]) == MAX_INPUT_ITEMS
    cases: list[object] = [
        {"formatVersion": 1, "files": []},
        {"formatVersion": 1, "files": [FILE] * (MAX_INPUT_ITEMS + 1)},
        {"formatVersion": True, "files": [FILE]},
        {"formatVersion": 2, "files": [FILE]},
        {"files": [FILE]},
        {"formatVersion": 1, "files": [FILE], "root": ROOT},
        {"formatVersion": 1, "files": "not-an-array"},
    ]
    for value in cases:
        with pytest.raises(ValueError, match=INVALID):
            parse_selection_manifest(value)


def test_duplicate_payload_members_use_existing_envelope_codec() -> None:
    encoded = encode_worker_request(
        {
            "schemaVersion": 1,
            "jobId": JOB_ID,
            "projectId": PROJECT_ID,
            "kind": "scan-dataset",
            "payload": {
                "taskType": "classification",
                "mode": "copy",
                "source": UNLABELED,
            },
        }
    )
    ambiguous = encoded.replace(
        '"mode":"copy"', '"mode":"reference","\\u006dode":"copy"'
    )
    with pytest.raises(ValueError):
        parse_worker_request(ambiguous)


def test_unmodified_coco_ids_coordinates_unicode_and_pre_exif_dimensions() -> None:
    value = detection(
        images=[
            image(
                orientation=6,
                annotation={
                    "type": "detection",
                    "sourceImageId": "11",
                    "boxes": [box()],
                },
            )
        ]
    )
    before = wire(value)
    context: ScanContext = {**EXPECTED, "taskType": "detection"}
    parsed = parse_scan_result(value, context)
    assert parsed == value
    assert decode_scan_result(before, context) == value
    assert wire(value) == before
    assert "confirmed" not in parsed["images"][0]


def test_single_classification_unlabeled_and_empty_detection_are_distinct() -> None:
    classified = result(
        classes=[
            {
                "key": "constructor",
                "name": "  健康🌱  ",
                "sourceCategoryId": None,
            }
        ],
        images=[
            image(
                annotation={
                    "type": "classification",
                    "classKey": "constructor",
                    "sourceRow": 2,
                }
            )
        ],
    )
    assert parse_scan_result(classified) == classified
    assert parse_scan_result(result())["classes"] == []
    negative = detection(
        images=[
            image(annotation={"type": "detection", "sourceImageId": "11", "boxes": []})
        ]
    )
    assert parse_scan_result(negative) == negative
    unlabeled = parse_scan_result(result(taskType="detection"))
    assert unlabeled["images"][0]["annotation"] is None


def test_failed_image_context_without_fake_metadata_or_empty_success() -> None:
    failure: dict[str, object] = {
        "severity": "error",
        "code": "IMAGE_READ_FAILED",
        "target": {
            "imageKey": "failed:1",
            "sourcePath": ROOT + "\\broken.png",
            "row": None,
            "itemId": None,
        },
    }
    value = result(issues=[failure])
    assert parse_scan_result(value) == value
    with pytest.raises(ValueError, match=INVALID):
        parse_scan_result(result(images=[], issues=[failure]))
    for field in ("byteSize", "sha256", "width", "height"):
        with pytest.raises(ValueError, match=INVALID):
            parse_scan_result(result(images=[image(**{field: None})], issues=[failure]))
    invalid_annotation: dict[str, object] = {
        "severity": "error",
        "code": "ANNOTATION_PATH_INVALID",
        "target": {
            "imageKey": None,
            "sourcePath": "../outside.png",
            "row": 4,
            "itemId": "bad-id",
        },
    }
    assert parse_scan_result(result(issues=[invalid_annotation]))["issues"] == [
        invalid_annotation
    ]


def test_metadata_boundaries_and_booleans_are_not_numbers() -> None:
    parse_scan_result(
        result(images=[image(byteSize=MAX_IMAGE_BYTES, width=8000, height=5000)])
    )
    bad_numbers: list[object] = [
        True,
        False,
        -1,
        0,
        0.5,
        float("nan"),
        float("inf"),
        -float("inf"),
        9007199254740992,
    ]
    for field in ("byteSize", "width", "height", "orientation"):
        for value in bad_numbers:
            with pytest.raises(ValueError, match=INVALID):
                parse_scan_result(result(images=[image(**{field: value})]))
    for fields in (
        {"byteSize": MAX_IMAGE_BYTES + 1},
        {"width": 8000, "height": 5001},
        {"orientation": 9},
    ):
        with pytest.raises(ValueError, match=INVALID):
            parse_scan_result(result(images=[image(**fields)]))
    for image_format in ("jpeg", "png", "webp", "bmp", "tiff"):
        for orientation in range(1, 9):
            parsed = parse_scan_result(
                result(images=[image(format=image_format, orientation=orientation)])
            )
            assert parsed["images"][0]["format"] == image_format
    with pytest.raises(ValueError, match=INVALID):
        parse_scan_result(result(images=[image()] * (MAX_INPUT_ITEMS + 1)))


def test_canonical_decimal_mtime_is_not_converted_to_a_number() -> None:
    for mtime in ("0", "-1", "1750000000123456789", "999999999999999999999999999999"):
        parsed = parse_scan_result(result(images=[image(mtimeNs=mtime)]))
        assert parsed["images"][0]["mtimeNs"] == mtime
    invalid_times: list[object] = [
        "",
        "01",
        "-0",
        "+1",
        "1e9",
        "1.0",
        " 1",
        "1\n",
        "١",
        1750000000123456789,
    ]
    for invalid_time in invalid_times:
        with pytest.raises(ValueError, match=INVALID):
            parse_scan_result(result(images=[image(mtimeNs=invalid_time)]))


def test_duplicate_and_dangling_local_category_image_annotation_references() -> None:
    malformed = [
        result(images=[image(), image()]),
        result(
            classes=[
                {"key": "crop", "name": "a", "sourceCategoryId": None},
                {"key": "crop", "name": "b", "sourceCategoryId": None},
            ]
        ),
        detection(
            classes=[
                {"key": "crop", "name": "a", "sourceCategoryId": "7"},
                {"key": "other", "name": "b", "sourceCategoryId": "7"},
            ]
        ),
        result(
            images=[
                image(
                    annotation={
                        "type": "classification",
                        "classKey": "missing",
                        "sourceRow": None,
                    }
                )
            ]
        ),
        detection(
            images=[
                image(
                    annotation={
                        "type": "detection",
                        "sourceImageId": "11",
                        "boxes": [box(classKey="missing")],
                    }
                )
            ]
        ),
        result(images=detection()["images"]),
        detection(
            images=[
                image(
                    annotation={
                        "type": "detection",
                        "sourceImageId": "11",
                        "boxes": [box(), box()],
                    }
                )
            ]
        ),
        detection(
            images=[
                image(
                    key=key,
                    annotation={
                        "type": "detection",
                        "sourceImageId": "11",
                        "boxes": [],
                    },
                )
                for key in ("a", "b")
            ]
        ),
        detection(
            images=[
                image(
                    key=key,
                    annotation={
                        "type": "detection",
                        "sourceImageId": source_id,
                        "boxes": [box()],
                    },
                )
                for key, source_id in (("a", "11"), ("b", "12"))
            ]
        ),
        detection(classes=[{"key": "crop", "name": "a", "sourceCategoryId": None}]),
        result(classes=[{"key": "crop", "name": "a", "sourceCategoryId": "7"}]),
    ]
    for candidate in malformed:
        with pytest.raises(ValueError, match=INVALID):
            parse_scan_result(candidate)
    for duplicate_of in ("missing", "image:0"):
        with pytest.raises(ValueError, match=INVALID):
            parse_scan_result(result(images=[image(duplicateOf=duplicate_of)]))
    primary = image()
    duplicate = image(
        key="image:1", sourcePath=ROOT + "\\copy.png", duplicateOf="image:0"
    )
    assert parse_scan_result(result(images=[duplicate, primary]))["images"] == [
        duplicate,
        primary,
    ]
    for images in (
        [primary, {**duplicate, "sha256": "b" * 64}],
        [{**primary, "duplicateOf": "image:1"}, duplicate],
        [primary, duplicate, image(key="image:2", duplicateOf="image:1")],
    ):
        with pytest.raises(ValueError, match=INVALID):
            parse_scan_result(result(images=images))


def test_invalid_boxes_are_not_clamped_or_coerced() -> None:
    boxes: list[object] = [
        [-1, 0, 2, 2],
        [0, 0, 0, 2],
        [0, 0, 2, -1],
        [639, 0, 2, 2],
        [0, 479, 2, 2],
        [640, 0, 1e-20, 1],  # Right boundary: positive tiny width, zero overlap.
        [0, 480, 1, 1e-20],  # Bottom boundary: positive tiny height, zero overlap.
        [1e-20, 0, 640, 1],  # Tiny offset with full width.
        [0, 1e-20, 1, 480],  # Tiny offset with full height.
        [0, 0, 1],
        [0, 0, 1, 1, 1],
    ]
    bad_values: list[object] = [
        True,
        False,
        float("nan"),
        float("inf"),
        -float("inf"),
        "1",
        9007199254740992,
    ]
    for bad in bad_values:
        for index in range(4):
            boxes.append(
                [
                    bad if index == position else value
                    for position, value in enumerate([0, 0, 1, 1])
                ]
            )
    for bbox in boxes:
        with pytest.raises(ValueError, match=INVALID):
            parse_scan_result(
                detection(
                    images=[
                        image(
                            annotation={
                                "type": "detection",
                                "sourceImageId": "11",
                                "boxes": [box(bbox=bbox)],
                            }
                        )
                    ]
                )
            )
    for valid_bbox in ([0, 0, 640, 480], [639, 0, 1e-20, 1], [0, 479, 1, 1e-20]):
        candidate = detection(
            images=[
                image(
                    annotation={
                        "type": "detection",
                        "sourceImageId": "11",
                        "boxes": [box(bbox=valid_bbox)],
                    }
                )
            ]
        )
        before = wire(candidate)
        assert parse_scan_result(candidate) == candidate
        assert wire(candidate) == before


def test_unknown_fields_and_invalid_strings_at_nested_boundaries() -> None:
    classified: dict[str, object] = {
        "type": "classification",
        "classKey": "crop",
        "sourceRow": None,
    }
    cases = [
        result(confirmed=True),
        result(formatVersion=True),
        result(formatVersion=2),
        result(images=[image(confirmed=True)]),
        result(
            classes=[
                {"key": "crop", "name": "ok", "sourceCategoryId": None, "extra": 1}
            ]
        ),
        result(images=[image(annotation={**classified, "classKeys": ["crop"]})]),
        result(images=[image(annotation={**classified, "classKey": ["crop"]})]),
        detection(
            images=[
                image(
                    annotation={
                        "type": "detection",
                        "sourceImageId": "11",
                        "boxes": [box(extra=1)],
                    }
                )
            ]
        ),
        result(images=[image(format="gif")]),
        result(images=[image(sha256="A" * 64)]),
        detection(classes=[{"key": "crop", "name": "ok", "sourceCategoryId": "07"}]),
    ]
    for name in ("", " \t\u0085\ufeff", "\ud800", "a\0b"):
        cases.append(
            result(classes=[{"key": "crop", "name": name, "sourceCategoryId": None}])
        )
    for candidate in cases:
        with pytest.raises(ValueError, match=INVALID):
            parse_scan_result(candidate)


def test_issue_context_safe_codes_and_consistent_targets() -> None:
    target: dict[str, object] = {
        "imageKey": "image:0",
        "sourcePath": FILE,
        "row": None,
        "itemId": None,
    }
    base: dict[str, object] = {
        "severity": "error",
        "code": "INVALID_ANNOTATION",
        "target": target,
    }
    issues: list[dict[str, object]] = [
        {**base, "code": "C:\\private\\raw.png"},
        {**base, "code": "BAD\n"},
        {**base, "code": "A" * 65},
        {**base, "message": "raw data"},
        {**base, "severity": "info"},
        {**base, "target": {**target, "extra": "raw metadata"}},
        {
            **base,
            "target": {
                "imageKey": None,
                "sourcePath": None,
                "row": None,
                "itemId": None,
            },
        },
        {**base, "target": {**target, "imageKey": "missing", "sourcePath": None}},
        {**base, "severity": "warning", "target": {**target, "imageKey": "missing"}},
        {**base, "target": {**target, "sourcePath": ROOT + "\\other.png"}},
    ]
    bad_rows: list[object] = [
        0,
        -1,
        True,
        False,
        0.5,
        float("nan"),
        float("inf"),
        9007199254740992,
    ]
    issues.extend({**base, "target": {**target, "row": row}} for row in bad_rows)
    for entry in issues:
        with pytest.raises(ValueError, match=INVALID):
            parse_scan_result(result(issues=[entry]))
    warnings = parse_scan_result(result(issues=[{**base, "severity": "warning"}]))
    assert len(warnings["issues"]) == 1


def test_uuid_nil_max_case_and_all_correlation_fields() -> None:
    ids = [
        JOB_ID.upper(),
        "00000000-0000-0000-0000-000000000000",
        "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
        "FfFfFfFf-FfFf-FfFf-FfFf-FfFfFfFfFfFf",
    ]
    for supplied_id in ids:
        job_context: ScanContext = {**EXPECTED, "jobId": supplied_id}
        project_context: ScanContext = {**EXPECTED, "projectId": supplied_id}
        parsed_job = decode_scan_result(wire(result(jobId=supplied_id)), job_context)
        parsed_project = decode_scan_result(
            wire(result(projectId=supplied_id)), project_context
        )
        assert parsed_job["jobId"] == supplied_id.lower()
        assert parsed_project["projectId"] == supplied_id.lower()
    invalid_ids = [
        "bad",
        JOB_ID + "\n",
        "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFE",
        "00000000-0000-0000-0000-000000000001",
        "ae45cf74-c9f9-0c49-88b9-0523b1ac7383",
    ]
    for supplied_id in invalid_ids:
        contexts: list[ScanContext] = [
            {**EXPECTED, "jobId": supplied_id},
            {**EXPECTED, "projectId": supplied_id},
        ]
        for context in contexts:
            with pytest.raises(ValueError, match=INVALID):
                parse_scan_result(result(**context))
            with pytest.raises(ValueError, match=INVALID):
                decode_scan_result(wire(result()), context)
    mismatches: list[ScanContext] = [
        {**EXPECTED, "jobId": PROJECT_ID},
        {**EXPECTED, "projectId": JOB_ID},
        {**EXPECTED, "taskType": "detection"},
        {**EXPECTED, "mode": "reference"},
    ]
    for context in mismatches:
        with pytest.raises(ValueError, match=INVALID):
            decode_scan_result(wire(result()), context)
    # Deliberately bypass the call signature to exercise the runtime trust check.
    decoders: list[Callable[..., object]] = [decode_scan_result]
    with pytest.raises(ValueError, match=INVALID):
        decoders[0](wire(result()), None)
    with pytest.raises(TypeError):
        decoders[0](wire(result()))


def test_duplicate_members_malformed_utf8_json_and_nonfinite_tokens() -> None:
    encoded = wire(result())
    manifests = [
        "",
        "[]",
        "{}",
        MANIFEST_JSON + "{}",
        "\ufeff" + MANIFEST_JSON,
        MANIFEST_JSON.replace(
            '"formatVersion":1', '"formatVersion":1,"\\u0066ormatVersion":1'
        ),
        MANIFEST_JSON.replace("a.png", "\\ud800"),
    ]
    results = [
        "",
        "[]",
        "{}",
        encoded + "{}",
        "\ufeff" + encoded,
        encoded.replace('"formatVersion":1', '"formatVersion":1,"formatVersion":1'),
        encoded.replace('"jobId":', '"jobId":"' + JOB_ID + '","\\u006aobId":'),
        encoded.replace('"width":640', '"width":1,"\\u0077idth":640'),
        encoded.replace("a.png", "\\ud800"),
    ]
    for token in ("NaN", "Infinity", "-Infinity", "1e400", "9007199254740992"):
        results.append(encoded.replace('"byteSize":1234', '"byteSize":' + token))
    for supplied in manifests:
        with pytest.raises(ValueError, match=INVALID):
            decode_selection_manifest(supplied)
    for supplied in results:
        with pytest.raises(ValueError, match=INVALID):
            decode_scan_result(supplied, EXPECTED)
    malformed_bytes = [b"\xff", b"\xc0\xaf", ("\ufeff" + MANIFEST_JSON).encode()]
    for supplied_bytes in malformed_bytes:
        with pytest.raises(ValueError, match=INVALID):
            decode_selection_manifest(supplied_bytes)
        with pytest.raises(ValueError, match=INVALID):
            decode_scan_result(supplied_bytes, EXPECTED)


def test_escaped_unicode_integer_spellings_and_delimiters_inside_strings() -> None:
    value = result(
        classes=[
            {
                "key": "crop",
                "name": '日本語🌱 {"x":[],"x":{}}',
                "sourceCategoryId": None,
            }
        ]
    )
    encoded = wire(value).replace("🌱", "\\ud83c\\udf31")
    assert decode_scan_result(encoded.encode(), EXPECTED) == value
    for token in ("1.0", "1e0"):
        supplied = encoded.replace('"formatVersion":1', '"formatVersion":' + token)
        parsed = decode_scan_result(supplied, EXPECTED)
        assert parsed == value
        assert type(parsed["formatVersion"]) is int
        manifest = decode_selection_manifest(
            MANIFEST_JSON.replace('"formatVersion":1', '"formatVersion":' + token)
        )
        assert type(manifest["formatVersion"]) is int
        assert manifest["formatVersion"] == 1


def test_350_images_exceed_control_budget_but_fit_result_budget() -> None:
    value = result(
        images=[
            image(
                key=f"image:{index}",
                sourcePath=f"{ROOT}\\{index}.png",
                sha256=f"{index:064x}",
            )
            for index in range(350)
        ]
    )
    encoded = wire(value).encode()
    assert MAX_WORKER_MESSAGE_BYTES < len(encoded) < MAX_SCAN_RESULT_BYTES
    assert decode_scan_result(encoded, EXPECTED) == value


def test_five_approved_limits_and_actual_utf8_artifact_budgets() -> None:
    assert (
        MAX_IMAGE_BYTES,
        MAX_IMAGE_PIXELS,
        MAX_INPUT_ITEMS,
        MAX_ANNOTATION_BYTES,
        MAX_SCAN_RESULT_BYTES,
    ) == (134217728, 40000000, 100000, 67108864, 268435456)
    # Valid JSON if byte limits were removed. No huge parametrization IDs, files,
    # process launches or network. This verifies bytes, not character count.
    oversized_manifest = wire(
        {"formatVersion": 1, "files": ["C:\\" + "é" * (MAX_ANNOTATION_BYTES // 2)]}
    )
    assert len(oversized_manifest) < MAX_ANNOTATION_BYTES
    with pytest.raises(ValueError, match=INVALID):
        decode_selection_manifest(oversized_manifest)
    encoded = wire(result())
    with pytest.raises(ValueError, match=INVALID):
        decode_scan_result(
            encoded + " " * (MAX_SCAN_RESULT_BYTES - len(encoded) + 1), EXPECTED
        )


def test_non_json_objects_and_silent_rejection(
    capsys: pytest.CaptureFixture[str],
) -> None:
    class NonJsonText(str):
        pass

    with pytest.raises(ValueError, match=INVALID):
        parse_scan_payload(
            {
                "taskType": NonJsonText("classification"),
                "mode": "copy",
                "source": UNLABELED,
            }
        )
    cyclic: list[object] = []
    cyclic.append(cyclic)
    for files in (cyclic, [None], (FILE,)):
        with pytest.raises(ValueError, match=INVALID):
            parse_selection_manifest({"formatVersion": 1, "files": files})
    with pytest.raises(ValueError, match=INVALID):
        parse_scan_payload(object())
    decoders: list[Callable[..., object]] = [decode_selection_manifest]
    for supplied in (bytearray(b"{}"), memoryview(b"{}"), {"length": 2}):
        with pytest.raises(ValueError, match=INVALID):
            decoders[0](supplied)
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""
