"""DAT-05: read-only COCO mapping onto DAT-03's decoded RAW ScanImage metadata.

FR-DAT-006/007, FR-ANN-204/209: retain original numeric xywh values, source IDs,
Unicode category names and per-image annotation order. Never orient, clamp,
round, merge classes, suppress boxes, decode images or mark them confirmed.
An invalid box produces an error, not a repaired import-unmodified baseline.
An explicit COCO image without boxes differs from an image without a COCO entry.

Accept standard COCO metadata/extras without copying them into diagnostics or
following their paths/URLs. JSON is bounded by MAX_ANNOTATION_BYTES, rejects
duplicate decoded members and nonfinite numbers at every depth, and accepts
one leading UTF-8 BOM (as DAT-04 does for external CSV, not the internal codec).
Duplicate IDs/COCO paths fail the whole import; other invalid items retain
repair context while valid items survive. Exact duplicate category names are
reported without merging. Schema normalization/UUIDs belong to Main, not here.

Main owns authorization of root and annotationPath, which may be outside root,
source retention and final result/correlation validation. Original files remain
untouched; unused metadata stays in the original JSON. Read-time snapshots are
not permission grants or locks against future changes. No private data-module
helpers, manifests, CLI, network, source writes or new dependencies are used.
"""

from __future__ import annotations

import json
import math
import os
import re
import stat
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from typing import Never, TypeGuard

from autovision_ml.data.import_contract import (
    MAX_ANNOTATION_BYTES,
    MAX_IMAGE_PIXELS,
    MAX_INPUT_ITEMS,
    DetectionAnnotation,
    ScanBox,
    ScanClass,
    ScanImage,
    ScanIssue,
    ScanSource,
    parse_scan_payload,
    parse_selection_manifest,
)
from autovision_ml.data.local_path import require_local_path

_MAX_SAFE_INTEGER = 9_007_199_254_740_991
_BLANK = re.compile(
    r"[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a"
    r"\u2028\u2029\u202f\u205f\u3000\ufeff]*"
)
_DEVICE = re.compile(
    r"(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)",
    re.IGNORECASE | re.ASCII,
)
_ASCII_LOWER = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")
type _Chain = tuple[tuple[Path, os.stat_result], ...]
type _PathKey = tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CocoImport:
    classes: tuple[ScanClass, ...]
    annotations: Mapping[str, DetectionAnnotation | None]
    issues: list[ScanIssue]


class CocoFormatError(ValueError):
    """Fixed message, with safe locators separate from JSON/OS error text."""

    def __init__(
        self,
        code: str,
        source_path: str | None = None,
        item_id: str | None = None,
    ) -> None:
        self.code = code
        self.source_path = source_path
        self.item_id = item_id
        super().__init__("COCO import rejected")


def _object(value: object) -> TypeGuard[dict[str, object]]:
    # Used only on json.loads results: JSON object keys are always strings.
    return type(value) is dict


def _array(value: object) -> TypeGuard[list[object]]:
    return type(value) is list


def _id(value: object) -> TypeGuard[int]:
    # JSON integer tokens only: bool, 1.0, exponent notation and strings are not IDs.
    return type(value) is int and 0 <= value <= _MAX_SAFE_INTEGER


def _text(value: object) -> TypeGuard[str]:
    return (
        type(value) is str
        and "\0" not in value
        and not any(0xD800 <= ord(char) <= 0xDFFF for char in value)
        and _BLANK.fullmatch(value) is None
    )


def _item_id(value: object, kind: str, index: int) -> str:
    supplied = value.get("id") if _object(value) else None
    return str(supplied) if _id(supplied) else f"{kind}:{index}"


def _issue(
    code: str, path: str, item_id: str | None, image: ScanImage | None = None
) -> ScanIssue:
    location = path if image is None else image["sourcePath"]
    return {
        "severity": "error",
        "code": code,
        "target": {
            "imageKey": None if image is None else image["key"],
            "sourcePath": location if _text(location) else None,
            "row": None,
            "itemId": item_id,
        },
    }


def _identity(left: os.stat_result, right: os.stat_result) -> bool:
    return (
        left.st_dev == right.st_dev
        and left.st_ino == right.st_ino
        and stat.S_IFMT(left.st_mode) == stat.S_IFMT(right.st_mode)
        and left.st_nlink == right.st_nlink
    )


def _content(left: os.stat_result, right: os.stat_result) -> bool:
    return (
        _identity(left, right)
        and left.st_size == right.st_size
        and left.st_mtime_ns == right.st_mtime_ns
    )


def _snapshot(left: os.stat_result, right: os.stat_result) -> bool:
    # Never compare lstat ctime to fstat ctime on Windows. Same-API baselines only.
    return _content(left, right) and left.st_ctime_ns == right.st_ctime_ns


def _chain(path: Path) -> _Chain:
    try:
        require_local_path(path)
    except ValueError:
        raise CocoFormatError("UNSAFE_PATH", str(path)) from None
    entries: list[tuple[Path, os.stat_result]] = []
    for node in (*reversed(path.parents), path):
        info = node.lstat()
        if stat.S_ISLNK(info.st_mode) or (
            getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
        ):
            raise CocoFormatError("UNSAFE_PATH", str(path))
        if node != path and not stat.S_ISDIR(info.st_mode):
            raise CocoFormatError("UNSAFE_PATH", str(path))
        entries.append((node, info))
    return tuple(entries)


def _ancestry(before: _Chain, after: _Chain) -> bool:
    return len(before) == len(after) and all(
        a == b and _identity(x, y) for (a, x), (b, y) in zip(before, after)
    )


def _check_root(before: _Chain) -> None:
    root = before[-1][0]
    if not _ancestry(before, _chain(root)):
        raise CocoFormatError("SOURCE_CHANGED", str(root))


def _regular(info: os.stat_result, path: Path) -> None:
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise CocoFormatError("UNSAFE_FILE", str(path))
    if getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
        raise CocoFormatError("UNSAFE_PATH", str(path))


def _read_json(path: Path, root_chain: _Chain) -> bytearray:
    # Narrow checked read; do not import another module's private I/O helpers.
    before_chain = _chain(path)
    before = before_chain[-1][1]
    _regular(before, path)
    if before.st_size <= 0:
        raise CocoFormatError("EMPTY_FILE", str(path))
    if before.st_size > MAX_ANNOTATION_BYTES:
        raise CocoFormatError("ANNOTATION_TOO_LARGE", str(path))
    retained = bytearray()
    _check_root(root_chain)
    with path.open("rb", buffering=0) as stream:
        opened = os.fstat(stream.fileno())
        _regular(opened, path)
        opened_chain = _chain(path)
        baseline = opened_chain[-1][1]
        if (
            not _ancestry(before_chain, opened_chain)
            or not _content(before, opened)
            or not _content(opened, baseline)
        ):
            raise CocoFormatError("SOURCE_CHANGED", str(path))
        _check_root(root_chain)
        while True:
            block = stream.read(min(65536, MAX_ANNOTATION_BYTES - len(retained) + 1))
            if block is None:
                raise CocoFormatError("ANNOTATION_READ_FAILED", str(path))
            if not block:
                break
            if len(retained) + len(block) > MAX_ANNOTATION_BYTES:
                raise CocoFormatError("ANNOTATION_TOO_LARGE", str(path))
            retained.extend(block)
        after = os.fstat(stream.fileno())
        _regular(after, path)
        after_chain = _chain(path)
        if (
            len(retained) != opened.st_size
            or not _snapshot(opened, after)
            or not _snapshot(baseline, after_chain[-1][1])
            or not _ancestry(opened_chain, after_chain)
            or not _content(after, after_chain[-1][1])
        ):
            raise CocoFormatError("SOURCE_CHANGED", str(path))
    closed_chain = _chain(path)
    if not _ancestry(opened_chain, closed_chain) or not _snapshot(
        baseline, closed_chain[-1][1]
    ):
        raise CocoFormatError("SOURCE_CHANGED", str(path))
    _check_root(root_chain)
    return retained


def _pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise CocoFormatError("COCO_DUPLICATE_MEMBER")
        result[key] = value
    return result


def _constant(_value: str) -> Never:
    raise CocoFormatError("COCO_NONFINITE_NUMBER")


def _float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise CocoFormatError("COCO_NONFINITE_NUMBER")
    return number


def _document(contents: bytearray, location: str) -> dict[str, object]:
    try:
        text = contents.decode("utf-8-sig", errors="strict")
    except UnicodeError:
        raise CocoFormatError("COCO_INVALID_ENCODING", location) from None
    try:
        value: object = json.loads(
            text, object_pairs_hook=_pairs, parse_constant=_constant, parse_float=_float
        )
    except CocoFormatError as error:
        raise CocoFormatError(error.code, location) from None
    except (ValueError, RecursionError):
        raise CocoFormatError("COCO_MALFORMED", location) from None
    if not _object(value):
        raise CocoFormatError("COCO_INVALID_ROOT", location)
    return value


def _unique_ids(rows: list[object], kind: str, location: str) -> set[int]:
    seen: set[int] = set()
    for row in rows:
        supplied = row.get("id") if _object(row) else None
        if _id(supplied):
            if supplied in seen:
                raise CocoFormatError(
                    f"COCO_DUPLICATE_{kind}_ID", location, str(supplied)
                )
            seen.add(supplied)
    return seen


def _relative_parts(value: object) -> tuple[str, ...] | None:
    # Inspect raw components before Windows path parsing can collapse dot/slashes.
    if not _text(value):
        return None
    parts = tuple(value.replace("\\", "/").split("/"))
    for part in parts:
        if (
            not part
            or part in (".", "..")
            or re.search(r'[\u0000-\u001f<>:"|?*]', part)
            or part.endswith((".", " "))
            or _DEVICE.match(part)
        ):
            return None
    return parts


def _path_key(parts: tuple[str, ...]) -> _PathKey:
    # Never Unicode casefold: e.g. ß and ss are distinct, not guessed aliases.
    return tuple(part.translate(_ASCII_LOWER) for part in parts)


def _image_index(
    root: PureWindowsPath, images: Sequence[ScanImage], issues: list[ScanIssue]
) -> dict[_PathKey, list[ScanImage]]:
    index: dict[_PathKey, list[ScanImage]] = {}
    for image in images:
        path = image["sourcePath"]
        try:
            parse_selection_manifest({"formatVersion": 1, "files": [path]})
        except ValueError:
            issues.append(_issue("UNSAFE_PATH", path, None, image))
            continue
        parts, prefix = PureWindowsPath(path).parts, root.parts
        if len(parts) <= len(prefix) or _path_key(parts[: len(prefix)]) != _path_key(
            prefix
        ):
            issues.append(_issue("IMAGE_OUTSIDE_ROOT", path, None, image))
            continue
        index.setdefault(_path_key(parts[len(prefix) :]), []).append(image)
    for matches in index.values():
        if len(matches) > 1:
            for image in matches:
                issues.append(
                    _issue("IMAGE_PATH_AMBIGUOUS", image["sourcePath"], None, image)
                )
    return index


def _dimensions(row: Mapping[str, object]) -> tuple[int, int]:
    width, height = row.get("width"), row.get("height")
    if (
        not _id(width)
        or not _id(height)
        or width <= 0
        or height <= 0
        or width * height > MAX_IMAGE_PIXELS
    ):
        raise CocoFormatError("COCO_INVALID_IMAGE_DIMENSIONS")
    return width, height


def _classes(
    rows: list[object], location: str, issues: list[ScanIssue]
) -> dict[int, ScanClass]:
    classes: dict[int, ScanClass] = {}
    names: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        item_id = _item_id(row, "categories", index)
        if not _object(row):
            issues.append(_issue("COCO_INVALID_CATEGORY", location, item_id))
            continue
        category_id, name = row.get("id"), row.get("name")
        if not _id(category_id):
            issues.append(_issue("COCO_INVALID_CATEGORY_ID", location, item_id))
        elif not _text(name):
            issues.append(_issue("COCO_INVALID_CATEGORY_NAME", location, item_id))
        else:
            classes[category_id] = {
                "key": f"category:{category_id}",
                "name": name,
                "sourceCategoryId": str(category_id),
            }
            names.setdefault(name, []).append(category_id)
    for ids in names.values():
        if len(ids) > 1:
            for category_id in ids:
                issues.append(
                    _issue("COCO_DUPLICATE_CATEGORY_NAME", location, str(category_id))
                )
    return classes


def _images(
    rows: list[object],
    location: str,
    index: Mapping[_PathKey, list[ScanImage]],
    annotations: dict[str, DetectionAnnotation | None],
    issues: list[ScanIssue],
) -> dict[int, ScanImage]:
    mapped: dict[int, ScanImage] = {}
    seen: set[_PathKey] = set()
    referenced: set[str] = set()
    for ordinal, row in enumerate(rows):
        item_id = _item_id(row, "images", ordinal)
        if not _object(row):
            issues.append(_issue("COCO_INVALID_IMAGE", location, item_id))
            continue
        parts = _relative_parts(row.get("file_name"))
        if parts is None:
            issues.append(_issue("COCO_UNSAFE_PATH", location, item_id))
            continue
        identity = _path_key(parts)
        if identity in seen:
            raise CocoFormatError("COCO_DUPLICATE_IMAGE_PATH", location, item_id)
        seen.add(identity)
        matches = index.get(identity, [])
        referenced.update(image["key"] for image in matches)
        image = matches[0] if len(matches) == 1 else None
        image_id = row.get("id")
        if not _id(image_id):
            issues.append(_issue("COCO_INVALID_IMAGE_ID", location, item_id, image))
            continue
        try:
            dimensions = _dimensions(row)
        except CocoFormatError as error:
            issues.append(_issue(error.code, location, item_id, image))
            continue
        if not matches:
            issues.append(_issue("COCO_IMAGE_FILE_NOT_FOUND", "/".join(parts), item_id))
        elif image is None:
            issues.append(_issue("IMAGE_PATH_AMBIGUOUS", location, item_id))
        elif dimensions != (image["width"], image["height"]):
            issues.append(
                _issue("COCO_IMAGE_DIMENSION_MISMATCH", location, item_id, image)
            )
        else:
            mapped[image_id] = image
            imported: DetectionAnnotation = {
                "type": "detection",
                "sourceImageId": str(image_id),
                "boxes": [],
            }
            annotations[image["key"]] = imported
    for matches in index.values():
        for image in matches:
            if image["key"] not in referenced:
                issues.append(_issue("COCO_IMAGE_NOT_FOUND", location, None, image))
    return mapped


def _bbox(value: object, image: ScanImage) -> list[int | float]:
    if not _array(value) or len(value) != 4:
        raise CocoFormatError("COCO_INVALID_BBOX")
    coordinates: list[int | float] = []
    for number in value:
        if type(number) is not int and type(number) is not float:
            raise CocoFormatError("COCO_INVALID_BBOX")
        if abs(number) > _MAX_SAFE_INTEGER or not math.isfinite(number):
            raise CocoFormatError("COCO_INVALID_BBOX")
        coordinates.append(number)
    x, y, width, height = coordinates
    if width <= 0 or height <= 0:
        raise CocoFormatError("COCO_INVALID_BBOX")
    # Subtraction catches positive tiny widths at the right/bottom boundary,
    # where x + width can round back to x. No clamping, rounding or reordering.
    if (
        x < 0
        or y < 0
        or width > image["width"] - x
        or height > image["height"] - y
        or x > image["width"] - width
        or y > image["height"] - height
    ):
        raise CocoFormatError("BBOX_OUT_OF_BOUNDS")
    return coordinates


def _annotations(
    rows: list[object],
    location: str,
    images: Mapping[int, ScanImage],
    declared_ids: set[int],
    classes: Mapping[int, ScanClass],
    annotations: dict[str, DetectionAnnotation | None],
    issues: list[ScanIssue],
) -> None:
    for ordinal, row in enumerate(rows):
        item_id = _item_id(row, "annotations", ordinal)
        if not _object(row):
            issues.append(_issue("COCO_INVALID_ANNOTATION", location, item_id))
            continue
        annotation_id, image_id = row.get("id"), row.get("image_id")
        image = images.get(image_id) if _id(image_id) else None
        category_id = row.get("category_id")
        try:
            if not _id(annotation_id):
                raise CocoFormatError("COCO_INVALID_ANNOTATION_ID")
            if not _id(image_id):
                raise CocoFormatError("COCO_INVALID_IMAGE_ID")
            if image is None:
                code = (
                    "COCO_IMAGE_UNAVAILABLE"
                    if image_id in declared_ids
                    else "COCO_UNKNOWN_IMAGE_ID"
                )
                raise CocoFormatError(code)
            if not _id(category_id):
                raise CocoFormatError("COCO_INVALID_CATEGORY_ID")
            category = classes.get(category_id)
            if category is None:
                raise CocoFormatError("COCO_UNKNOWN_CATEGORY_ID")
            crowd = row.get("iscrowd", 0)
            if type(crowd) is not int or crowd not in (0, 1):
                raise CocoFormatError("COCO_INVALID_ISCROWD")
            coordinates = _bbox(row.get("bbox"), image)
        except CocoFormatError as error:
            issues.append(_issue(error.code, location, item_id, image))
            continue
        imported = annotations[image["key"]]
        assert imported is not None  # Only mapped, dimension-validated COCO images.
        box: ScanBox = {
            "classKey": category["key"],
            "bbox": coordinates,
            "sourceAnnotationId": str(annotation_id),
        }
        imported["boxes"].append(box)


def import_coco(source: ScanSource, images: Sequence[ScanImage]) -> CocoImport:
    """Return scan-local classes, keyed annotations and explicit item errors.

    Requires DAT-03 metadata, not DAT-02 HashedImage headers. Preserves every
    input image key. boxes: [] is an unconfirmed imported negative; None means
    no usable imported annotation. Error-bearing results are never training-ready.
    Source integer IDs are bounded to JS-safe integers before decimal encoding;
    this does not replace Main's Dataset schema or complete correlation checks.
    """
    validated = parse_scan_payload(
        {"taskType": "detection", "mode": "reference", "source": source}
    )["source"]
    if not images:
        raise CocoFormatError("NO_VALID_IMAGES")
    if len(images) > MAX_INPUT_ITEMS:
        raise CocoFormatError("INPUT_LIMIT_EXCEEDED")
    annotations: dict[str, DetectionAnnotation | None] = {}
    for image in images:
        key = image.get("key")
        if not _text(key) or key in annotations:
            raise CocoFormatError("INVALID_IMAGE_KEYS")
        try:
            _dimensions(image)
        except CocoFormatError:
            raise CocoFormatError("INVALID_IMAGE_METADATA") from None
        orientation: object = image.get("orientation")
        if type(orientation) is not int or not 1 <= orientation <= 8:
            raise CocoFormatError("INVALID_IMAGE_METADATA")
        annotations[key] = None
    if validated["format"] == "unlabeled":
        return CocoImport((), annotations, [])
    if validated["format"] != "coco":
        raise CocoFormatError("UNSUPPORTED_DETECTION_FORMAT")
    if os.name != "nt":
        raise CocoFormatError("WINDOWS_REQUIRED")
    issues: list[ScanIssue] = []
    index = _image_index(PureWindowsPath(validated["root"]), images, issues)
    location = validated["root"]
    try:
        root_chain = _chain(Path(location))
        if not stat.S_ISDIR(root_chain[-1][1].st_mode):
            raise CocoFormatError("DIRECTORY_REQUIRED", location)
        location = validated["annotationPath"]
        document = _document(_read_json(Path(location), root_chain), location)
        image_rows = document.get("images")
        category_rows = document.get("categories")
        annotation_rows = document.get("annotations")
        if (
            not _array(image_rows)
            or not _array(category_rows)
            or not _array(annotation_rows)
        ):
            raise CocoFormatError("COCO_INVALID_ROOT", location)
        declared_ids = _unique_ids(image_rows, "IMAGE", location)
        _unique_ids(category_rows, "CATEGORY", location)
        _unique_ids(annotation_rows, "ANNOTATION", location)
        classes = _classes(category_rows, location, issues)
        mapped = _images(image_rows, location, index, annotations, issues)
        _annotations(
            annotation_rows,
            location,
            mapped,
            declared_ids,
            classes,
            annotations,
            issues,
        )
        _check_root(root_chain)
    except OSError:
        raise CocoFormatError("ANNOTATION_READ_FAILED", location) from None
    ordered = tuple(classes[category_id] for category_id in sorted(classes))
    return CocoImport(ordered, annotations, issues)
