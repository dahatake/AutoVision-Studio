"""DAT-01a pure contracts; implementation-plan §15.1 / requirements §8.3.

Mirrors src/shared/contracts/import.ts. No I/O, image decoding, command dispatch
or generated identities/state. Worker envelopes remain in the public protocol.
"""

from __future__ import annotations

import json
import math
import re
from typing import Literal, Never, TypedDict, cast

from autovision_ml.protocol import WorkerCorrelation

MAX_IMAGE_BYTES = 134_217_728
MAX_IMAGE_PIXELS = 40_000_000
MAX_INPUT_ITEMS = 100_000
MAX_ANNOTATION_BYTES = 67_108_864
MAX_SCAN_RESULT_BYTES = 268_435_456
_MAX_SAFE_INTEGER = 9_007_199_254_740_991
_INVALID = "Invalid import contract"
_UUID = re.compile(
    r"(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-"
    r"[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|"
    r"ffffffff-ffff-ffff-ffff-ffffffffffff)",
    re.IGNORECASE | re.ASCII,
)
_BLANK = re.compile(
    r"[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a"
    r"\u2028\u2029\u202f\u205f\u3000\ufeff]*"
)
_DEVICE = re.compile(
    r"(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)",
    re.IGNORECASE | re.ASCII,
)
type TaskType = Literal["classification", "detection"]
type ImportMode = Literal["copy", "reference"]
type ImageFormat = Literal["jpeg", "png", "webp", "bmp", "tiff"]
type Orientation = Literal[1, 2, 3, 4, 5, 6, 7, 8]


class UnlabeledDirectorySource(TypedDict):
    format: Literal["unlabeled"]
    selection: Literal["directory"]
    root: str


class UnlabeledFilesSource(TypedDict):
    format: Literal["unlabeled"]
    selection: Literal["files"]
    selectionManifestPath: str


class FolderSource(TypedDict):
    format: Literal["folder"]
    root: str


class CsvSource(TypedDict):
    format: Literal["csv"]
    root: str
    annotationPath: str


class CocoSource(TypedDict):
    format: Literal["coco"]
    root: str
    annotationPath: str


type ScanSource = (
    UnlabeledDirectorySource
    | UnlabeledFilesSource
    | FolderSource
    | CsvSource
    | CocoSource
)


class ScanPayload(TypedDict):
    taskType: TaskType
    mode: ImportMode
    source: ScanSource


class SelectionManifest(TypedDict):
    formatVersion: Literal[1]
    files: list[str]


class ScanContext(WorkerCorrelation):
    taskType: TaskType
    mode: ImportMode


class ScanClass(TypedDict):
    key: str
    name: str
    sourceCategoryId: str | None


class ClassificationAnnotation(TypedDict):
    type: Literal["classification"]
    classKey: str
    sourceRow: int | None


class ScanBox(TypedDict):
    classKey: str
    bbox: list[int | float]  # Exactly four original, unrounded pixel xywh values.
    sourceAnnotationId: str


class DetectionAnnotation(TypedDict):
    type: Literal["detection"]
    sourceImageId: str
    boxes: list[ScanBox]


type ScanAnnotation = ClassificationAnnotation | DetectionAnnotation


class ScanImage(TypedDict):
    key: str
    sourcePath: str
    byteSize: int
    mtimeNs: str
    sha256: str
    format: ImageFormat
    width: int
    height: int
    orientation: Orientation
    duplicateOf: str | None
    annotation: ScanAnnotation | None


class IssueTarget(TypedDict):
    imageKey: str | None
    sourcePath: str | None
    row: int | None
    itemId: str | None


class ScanIssue(TypedDict):
    severity: Literal["error", "warning"]
    code: str
    target: IssueTarget


class ScanResult(ScanContext):
    formatVersion: Literal[1]
    classes: list[ScanClass]
    images: list[ScanImage]
    issues: list[ScanIssue]


def _invalid() -> Never:
    # Never echo raw fields, paths, CSV rows, metadata or supplied diagnostics.
    raise ValueError(_INVALID)


def _object(value: object, fields: set[str] | None = None) -> dict[str, object]:
    if type(value) is not dict:
        _invalid()
    mapping = cast(dict[object, object], value)
    if any(type(key) is not str for key in mapping):
        _invalid()
    if fields is not None and set(mapping) != fields:
        _invalid()
    return cast(dict[str, object], mapping)


def _array(value: object) -> list[object]:
    if type(value) is not list:
        _invalid()
    return cast(list[object], value)


def _text(value: object) -> str:
    if type(value) is not str:
        _invalid()
    if (
        "\0" in value
        or any(0xD800 <= ord(char) <= 0xDFFF for char in value)
        or _BLANK.fullmatch(value) is not None
    ):
        _invalid()
    return value


def _path(value: object) -> str:
    supplied = _text(value)
    # Structural drive/UNC syntax only. UNC acceptance is NOT a network grant:
    # Main's chooser/offline policy and worker read-time identity, containment,
    # link and replacement checks still apply. Do not normalize the returned path.
    path = supplied.replace("/", "\\")
    device_start = 0
    if re.match(r"[A-Za-z]:\\", path):
        parts = path[3:].split("\\")
    elif path.startswith("\\\\"):
        parts = path[2:].split("\\")
        if len(parts) < 2 or not parts[0] or not parts[1]:
            _invalid()
        device_start = 2
    else:
        _invalid()
    if parts[-1] == "":
        parts.pop()
    for index, part in enumerate(parts):
        if (
            not part
            or re.search(r'[\u0000-\u001f<>:"|?*]', part)
            or part.endswith((".", " "))
            or (index >= device_start and _DEVICE.match(part))
        ):
            _invalid()
    return supplied


def _number(value: object) -> int | float:
    if type(value) not in (int, float):
        _invalid()
    number = cast(int | float, value)
    if abs(number) > _MAX_SAFE_INTEGER or not math.isfinite(number):
        _invalid()
    return number


def _integer(value: object, minimum: int = 0, maximum: int = _MAX_SAFE_INTEGER) -> int:
    number = _number(value)
    if number < minimum or number > maximum or int(number) != number:
        _invalid()
    return int(number)


def _id(value: object) -> str:
    supplied = _text(value)
    if _UUID.fullmatch(supplied) is None:
        _invalid()
    return supplied.lower()


def _source_id(value: object) -> str:
    supplied = _text(value)
    if re.fullmatch(r"0|[1-9][0-9]*", supplied) is None:
        _invalid()
    return supplied


def _task(value: object) -> TaskType:
    supplied = _text(value)
    if supplied == "classification":
        return "classification"
    if supplied == "detection":
        return "detection"
    _invalid()


def _mode(value: object) -> ImportMode:
    supplied = _text(value)
    if supplied == "copy":
        return "copy"
    if supplied == "reference":
        return "reference"
    _invalid()


def _source(value: object) -> ScanSource:
    data = _object(value)
    kind = _text(data.get("format"))
    if kind == "unlabeled":
        selection = _text(data.get("selection"))
        if selection == "directory":
            data = _object(value, {"format", "selection", "root"})
            return {
                "format": "unlabeled",
                "selection": "directory",
                "root": _path(data["root"]),
            }
        if selection == "files":
            data = _object(value, {"format", "selection", "selectionManifestPath"})
            return {
                "format": "unlabeled",
                "selection": "files",
                "selectionManifestPath": _path(data["selectionManifestPath"]),
            }
        _invalid()
    if kind == "folder":
        data = _object(value, {"format", "root"})
        return {"format": "folder", "root": _path(data["root"])}
    data = _object(value, {"format", "root", "annotationPath"})
    if kind == "csv":
        return {
            "format": "csv",
            "root": _path(data["root"]),
            "annotationPath": _path(data["annotationPath"]),
        }
    if kind == "coco":
        return {
            "format": "coco",
            "root": _path(data["root"]),
            "annotationPath": _path(data["annotationPath"]),
        }
    _invalid()


def parse_scan_payload(value: object) -> ScanPayload:
    """Validate parse_worker_request(...)[\"payload\"]; do not replace its codec."""
    data = _object(value, {"taskType", "mode", "source"})
    task = _task(data["taskType"])
    source = _source(data["source"])
    if source["format"] == "coco" and task != "detection":
        _invalid()
    if source["format"] in ("folder", "csv") and task != "classification":
        _invalid()
    return {"taskType": task, "mode": _mode(data["mode"]), "source": source}


def parse_selection_manifest(value: object) -> SelectionManifest:
    """Keep selection order/duplicates; identity/hash warnings belong to DAT-02."""
    data = _object(value, {"formatVersion", "files"})
    files = _array(data["files"])
    if _integer(data["formatVersion"]) != 1 or not 1 <= len(files) <= MAX_INPUT_ITEMS:
        _invalid()
    return {"formatVersion": 1, "files": [_path(item) for item in files]}


def _class(value: object) -> ScanClass:
    data = _object(value, {"key", "name", "sourceCategoryId"})
    category = data["sourceCategoryId"]
    return {
        "key": _text(data["key"]),
        "name": _text(data["name"]),
        "sourceCategoryId": None if category is None else _source_id(category),
    }


def _box(value: object) -> ScanBox:
    data = _object(value, {"classKey", "bbox", "sourceAnnotationId"})
    bbox = _array(data["bbox"])
    if len(bbox) != 4:
        _invalid()
    x, y, width, height = [_number(item) for item in bbox]
    if x < 0 or y < 0 or width <= 0 or height <= 0:
        _invalid()
    return {
        "classKey": _text(data["classKey"]),
        "bbox": [x, y, width, height],
        "sourceAnnotationId": _source_id(data["sourceAnnotationId"]),
    }


def _annotation(value: object) -> ScanAnnotation | None:
    if value is None:
        return None
    data = _object(value)
    kind = _text(data.get("type"))
    if kind == "classification":
        data = _object(value, {"type", "classKey", "sourceRow"})
        row = data["sourceRow"]
        return {
            "type": "classification",
            "classKey": _text(data["classKey"]),
            "sourceRow": None if row is None else _integer(row, 1),
        }
    if kind == "detection":
        data = _object(value, {"type", "sourceImageId", "boxes"})
        return {
            "type": "detection",
            "sourceImageId": _source_id(data["sourceImageId"]),
            "boxes": [_box(item) for item in _array(data["boxes"])],
        }
    _invalid()


def _format(value: object) -> ImageFormat:
    supplied = _text(value)
    if supplied == "jpeg":
        return "jpeg"
    if supplied == "png":
        return "png"
    if supplied == "webp":
        return "webp"
    if supplied == "bmp":
        return "bmp"
    if supplied == "tiff":
        return "tiff"
    _invalid()


def _orientation(value: object) -> Orientation:
    number = _integer(value, 1, 8)
    orientations: tuple[Orientation, ...] = (1, 2, 3, 4, 5, 6, 7, 8)
    for orientation in orientations:
        if number == orientation:
            return orientation
    _invalid()


def _image(value: object) -> ScanImage:
    data = _object(
        value,
        {
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
        },
    )
    width = _integer(data["width"], 1, MAX_IMAGE_PIXELS)
    height = _integer(data["height"], 1, MAX_IMAGE_PIXELS)
    mtime = _text(data["mtimeNs"])
    digest = _text(data["sha256"])
    if (
        width * height > MAX_IMAGE_PIXELS
        or re.fullmatch(r"0|-?[1-9][0-9]*", mtime) is None
        or re.fullmatch(r"[a-f0-9]{64}", digest) is None
    ):
        _invalid()
    duplicate = data["duplicateOf"]
    return {
        "key": _text(data["key"]),
        "sourcePath": _path(data["sourcePath"]),
        "byteSize": _integer(data["byteSize"], 1, MAX_IMAGE_BYTES),
        "mtimeNs": mtime,
        "sha256": digest,
        "format": _format(data["format"]),
        "width": width,
        "height": height,
        "orientation": _orientation(data["orientation"]),
        "duplicateOf": None if duplicate is None else _text(duplicate),
        "annotation": _annotation(data["annotation"]),
    }


def _issue(value: object) -> ScanIssue:
    data = _object(value, {"severity", "code", "target"})
    supplied = _text(data["severity"])
    severity: Literal["error", "warning"]
    if supplied == "error":
        severity = "error"
    elif supplied == "warning":
        severity = "warning"
    else:
        _invalid()
    code = _text(data["code"])
    if re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", code) is None:
        _invalid()
    target = _object(data["target"], {"imageKey", "sourcePath", "row", "itemId"})
    key, path, row, item_id = (
        target["imageKey"],
        target["sourcePath"],
        target["row"],
        target["itemId"],
    )
    if all(item is None for item in (key, path, row, item_id)):
        _invalid()
    return {
        "severity": severity,
        "code": code,
        "target": {
            "imageKey": None if key is None else _text(key),
            # Diagnostic-only locator; a rejected relative path is useful here.
            "sourcePath": None if path is None else _text(path),
            "row": None if row is None else _integer(row, 1),
            "itemId": None if item_id is None else _text(item_id),
        },
    }


def _context(value: object) -> ScanContext:
    data = _object(value, {"jobId", "projectId", "taskType", "mode"})
    return {
        "jobId": _id(data["jobId"]),
        "projectId": _id(data["projectId"]),
        "taskType": _task(data["taskType"]),
        "mode": _mode(data["mode"]),
    }


def _references(result: ScanResult) -> None:
    classes = {item["key"]: item for item in result["classes"]}
    images = {item["key"]: item for item in result["images"]}
    if len(classes) != len(result["classes"]) or len(images) != len(result["images"]):
        _invalid()
    categories: set[str] = set()
    for entry in result["classes"]:
        category = entry["sourceCategoryId"]
        if (result["taskType"] == "classification") != (category is None):
            _invalid()
        if category is not None:
            if category in categories:
                _invalid()
            categories.add(category)
    source_images: set[str] = set()
    source_annotations: set[str] = set()
    for image in result["images"]:
        if image["duplicateOf"] is not None:
            original = images.get(image["duplicateOf"])
            if (
                original is None
                or original["key"] == image["key"]
                or original["sha256"] != image["sha256"]
                or original["duplicateOf"] is not None
            ):
                _invalid()
        imported = image["annotation"]
        if imported is None:
            continue
        if imported["type"] != result["taskType"]:
            _invalid()
        if imported["type"] == "classification":
            if imported["classKey"] not in classes:
                _invalid()
        else:
            if imported["sourceImageId"] in source_images:
                _invalid()
            source_images.add(imported["sourceImageId"])
            for box in imported["boxes"]:
                x, y, width, height = box["bbox"]
                if (
                    box["classKey"] not in classes
                    or width > image["width"] - x
                    or height > image["height"] - y
                    or x > image["width"] - width
                    or y > image["height"] - height
                    or box["sourceAnnotationId"] in source_annotations
                ):
                    _invalid()
                source_annotations.add(box["sourceAnnotationId"])
    for issue in result["issues"]:
        target = issue["target"]
        if target["imageKey"] is None:
            continue
        found = images.get(target["imageKey"])
        if found is None:
            if issue["severity"] != "error" or target["sourcePath"] is None:
                _invalid()
        elif (
            target["sourcePath"] is not None
            and target["sourcePath"] != found["sourcePath"]
        ):
            _invalid()


def parse_scan_result(value: object, expected: ScanContext | None = None) -> ScanResult:
    """Validate scan data, optionally against the active job/Project/task/mode.

    images holds successfully hashed/decoded metadata, never fake placeholders.
    Failed candidates belong in issues with repair context. Zero valid images is
    a command failure, unlike detection boxes: []. Annotations remain the original
    import-unmodified baseline: raw/pre-EXIF xywh and dimensions, source COCO IDs
    as decimal strings, CSV row (folder: null). The retained request locates the
    source annotation file. No clamp, human confirmation or UUID creation occurs.
    """
    data = _object(
        value,
        {
            "formatVersion",
            "jobId",
            "projectId",
            "taskType",
            "mode",
            "classes",
            "images",
            "issues",
        },
    )
    images = _array(data["images"])
    if _integer(data["formatVersion"]) != 1 or not 1 <= len(images) <= MAX_INPUT_ITEMS:
        _invalid()
    context = _context(
        {key: data[key] for key in ("jobId", "projectId", "taskType", "mode")}
    )
    result: ScanResult = {
        "formatVersion": 1,
        **context,
        "classes": [_class(item) for item in _array(data["classes"])],
        "images": [_image(item) for item in images],
        "issues": [_issue(item) for item in _array(data["issues"])],
    }
    _references(result)
    if expected is not None and context != _context(expected):
        _invalid()
    return result


def _pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            _invalid()
        result[key] = value
    return result


def _constant(_value: str) -> Never:
    _invalid()


def _decode(source: object, limit: int) -> object:
    try:
        if not isinstance(source, (str, bytes)) or len(source) > limit:
            _invalid()
        text = (
            source.decode("utf-8", errors="strict")
            if isinstance(source, bytes)
            else source
        )
        if len(text.encode("utf-8", errors="strict")) > limit:
            _invalid()
        # No new depth limit: the DTO shapes are finite. Duplicate decoded keys
        # must be rejected BEFORE the native JSON parser can discard evidence.
        value: object = json.loads(
            text, object_pairs_hook=_pairs, parse_constant=_constant
        )
        return value
    except (ValueError, TypeError, RecursionError):
        raise ValueError(_INVALID) from None


def decode_selection_manifest(source: str | bytes) -> SelectionManifest:
    """Bound supplied UTF-8 contents by the shared metadata budget, without I/O."""
    return parse_selection_manifest(_decode(source, MAX_ANNOTATION_BYTES))


def decode_scan_result(source: str | bytes, expected: ScanContext) -> ScanResult:
    """Decode a separate result artifact and check all four correlation fields."""
    context = _context(expected)
    return parse_scan_result(_decode(source, MAX_SCAN_RESULT_BYTES), context)


# Object parsers do not measure serialized bytes. DAT-01b/08 must bound actual
# reads/writes too, keep every failed candidate's context, and fail rather than
# turn source JSON/CSV parse errors or zero valid images into empty success.
