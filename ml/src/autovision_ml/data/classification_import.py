"""DAT-04: import-unmodified labels for DAT-02's enumerated HashedImage values.

FR-DAT-005 explicitly specifies UTF-8 CSV with ``path,label`` (not filename or
image_path). The header is exact; one initial UTF-8 BOM is accepted. Paths are
root-relative, with either slash separator. Labels retain their original Unicode
and whitespace: no NFKC, alias merging, UUIDs, confirmation or decoder dependency.
Folder labels use the first directory below root, including its nested images;
images directly at root remain unlabeled with an error.

CSV bytes are bounded by MAX_ANNOTATION_BYTES. The Python csv reader's existing
process-wide field limit (normally 131072 characters) is NOT changed; exceeding
it raises CSV_FIELD_TOO_LARGE, not truncation or a label-schema length rule.
CSV image references, including invalid/repeated rows, use MAX_INPUT_ITEMS as a
finite row budget. sourceRow is the record's starting physical line, not its end.
Whole-file failures raise ImportFormatError and never return partial success.
Recoverable row errors keep every image key; repeated paths revoke all assignments
for that path. Different labels for identical hashes remain visible with errors.

Main owns authorization of root/annotationPath. Read-time identity checks grant
no access; no resolve(), image reads, source writes, logging or network clients
are used. DAT-03 must independently revalidate/decode images before DAT-01b can
produce a ScanResult. This intermediate result is never training-ready evidence.
"""

from __future__ import annotations

import csv
import os
import re
import stat
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from io import StringIO
from pathlib import Path, PureWindowsPath

from autovision_ml.data.image_scan import HashedImage
from autovision_ml.data.import_contract import (
    MAX_ANNOTATION_BYTES,
    MAX_INPUT_ITEMS,
    ClassificationAnnotation,
    ScanClass,
    ScanIssue,
    ScanSource,
    parse_scan_payload,
    parse_selection_manifest,
)
from autovision_ml.data.local_path import require_local_path

_CHUNK = 64 * 1024
_BLANK = re.compile(
    r"[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a"
    r"\u2028\u2029\u202f\u205f\u3000\ufeff]*"
)
_DEVICE = re.compile(
    r"(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)",
    re.IGNORECASE | re.ASCII,
)
_ASCII_PATH_LOWER = str.maketrans(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"
)
type _Chain = tuple[tuple[Path, os.stat_result], ...]
type _Identity = tuple[str, ...]
type _Label = tuple[str, int | None]


@dataclass(frozen=True, slots=True)
class ClassificationImport:
    classes: tuple[ScanClass, ...]
    annotations: Mapping[str, ClassificationAnnotation | None]
    issues: list[ScanIssue]


class ImportFormatError(ValueError):
    """Fixed message; locators are local-result context, never raw CSV records."""

    def __init__(
        self, code: str, source_path: str | None = None, row: int | None = None
    ) -> None:
        self.code = code
        self.source_path = source_path
        self.row = row
        super().__init__("Classification import rejected")


def _text(value: str) -> bool:
    return (
        "\0" not in value
        and not any(0xD800 <= ord(char) <= 0xDFFF for char in value)
        and _BLANK.fullmatch(value) is None
    )


def _issue(
    code: str,
    path: str,
    row: int | None = None,
    image: HashedImage | None = None,
    first_row: int | None = None,
) -> ScanIssue:
    # A known imageKey must use that image's sourcePath, per the public contract.
    location = path if image is None else image["sourcePath"]
    return {
        "severity": "error",
        "code": code,
        "target": {
            "imageKey": None if image is None else image["key"],
            "sourcePath": location if _text(location) else None,
            "row": row,
            "itemId": None if first_row is None else str(first_row),
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
    # lstat and fstat ctime may differ on Windows even for an unchanged file.
    return _content(left, right) and left.st_ctime_ns == right.st_ctime_ns


def _chain(path: Path) -> _Chain:
    try:
        require_local_path(path)
    except ValueError:
        raise ImportFormatError("UNSAFE_PATH", str(path)) from None
    result: list[tuple[Path, os.stat_result]] = []
    for node in (*reversed(path.parents), path):
        info = node.lstat()
        if stat.S_ISLNK(info.st_mode) or (
            getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
        ):
            raise ImportFormatError("UNSAFE_PATH", str(path))
        if node != path and not stat.S_ISDIR(info.st_mode):
            raise ImportFormatError("UNSAFE_PATH", str(path))
        result.append((node, info))
    return tuple(result)


def _ancestry(before: _Chain, after: _Chain) -> bool:
    return len(before) == len(after) and all(
        left_path == right_path and _identity(left, right)
        for (left_path, left), (right_path, right) in zip(before, after)
    )


def _check_root(before: _Chain) -> None:
    root = before[-1][0]
    if not _ancestry(before, _chain(root)):
        raise ImportFormatError("SOURCE_CHANGED", str(root))


def _regular(info: os.stat_result, path: Path) -> None:
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ImportFormatError("UNSAFE_FILE", str(path))
    if getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
        raise ImportFormatError("UNSAFE_PATH", str(path))


def _read_csv(path: Path, root_chain: _Chain) -> str:
    before_chain = _chain(path)
    before = before_chain[-1][1]
    _regular(before, path)
    if before.st_size <= 0:
        raise ImportFormatError("EMPTY_FILE", str(path))
    if before.st_size > MAX_ANNOTATION_BYTES:
        raise ImportFormatError("ANNOTATION_TOO_LARGE", str(path))
    _check_root(root_chain)
    retained = bytearray()
    with path.open("rb", buffering=0) as stream:
        opened = os.fstat(stream.fileno())
        _regular(opened, path)
        opened_chain = _chain(path)
        path_opened = opened_chain[-1][1]
        if (
            not _ancestry(before_chain, opened_chain)
            or not _content(before, opened)
            or not _content(opened, path_opened)
        ):
            raise ImportFormatError("SOURCE_CHANGED", str(path))
        _check_root(root_chain)
        while True:
            block = stream.read(min(_CHUNK, MAX_ANNOTATION_BYTES - len(retained) + 1))
            if block is None:
                raise ImportFormatError("ANNOTATION_READ_FAILED", str(path))
            if not block:
                break
            if len(retained) + len(block) > MAX_ANNOTATION_BYTES:
                raise ImportFormatError("ANNOTATION_TOO_LARGE", str(path))
            retained.extend(block)
        after = os.fstat(stream.fileno())
        _regular(after, path)
        after_chain = _chain(path)
        if (
            len(retained) != opened.st_size
            or not _snapshot(opened, after)
            or not _snapshot(path_opened, after_chain[-1][1])
            or not _ancestry(opened_chain, after_chain)
            or not _content(after, after_chain[-1][1])
        ):
            raise ImportFormatError("SOURCE_CHANGED", str(path))
    closed_chain = _chain(path)
    if not _ancestry(opened_chain, closed_chain) or not _snapshot(
        path_opened, closed_chain[-1][1]
    ):
        raise ImportFormatError("SOURCE_CHANGED", str(path))
    _check_root(root_chain)
    try:
        return retained.decode("utf-8-sig", errors="strict")
    except UnicodeError:
        raise ImportFormatError("CSV_INVALID_ENCODING", str(path)) from None


def _relative_parts(value: str) -> tuple[str, ...] | None:
    # Inspect raw components BEFORE PureWindowsPath can collapse '.' or slashes.
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


def _path_key(parts: tuple[str, ...]) -> _Identity:
    """Fold ASCII A-Z only; preserve every non-ASCII character exactly.

    This conservative key does not model OS Unicode case tables. Unmatched
    non-ASCII spellings must produce explicit path errors, not guessed matches.
    """
    return tuple(part.translate(_ASCII_PATH_LOWER) for part in parts)


def _image_parts(root: PureWindowsPath, image: HashedImage) -> tuple[str, ...]:
    try:
        parse_selection_manifest({"formatVersion": 1, "files": [image["sourcePath"]]})
    except ValueError:
        raise ImportFormatError("UNSAFE_PATH") from None
    parts = PureWindowsPath(image["sourcePath"]).parts
    prefix = root.parts
    actual_prefix = _path_key(parts[: len(prefix)])
    expected_prefix = _path_key(prefix)
    if len(parts) <= len(prefix) or actual_prefix != expected_prefix:
        raise ImportFormatError("IMAGE_OUTSIDE_ROOT")
    return parts[len(prefix) :]


def _csv_labels(
    text: str,
    location: str,
    index: dict[_Identity, list[HashedImage]],
    issues: list[ScanIssue],
) -> dict[str, _Label]:
    labels: dict[str, _Label] = {}
    seen: dict[_Identity, tuple[int, str]] = {}
    row_start = 1
    with StringIO(text, newline="") as stream:
        reader = csv.reader(stream, strict=True)
        try:
            if next(reader, None) != ["path", "label"]:
                raise ImportFormatError("CSV_INVALID_HEADER", location, 1)
            count = 0
            while True:
                row_start = reader.line_num + 1
                cells = next(reader, None)
                if cells is None:
                    break
                count += 1
                if count > MAX_INPUT_ITEMS:
                    raise ImportFormatError(
                        "CSV_ROW_LIMIT_EXCEEDED", location, row_start
                    )
                if len(cells) != 2:
                    issues.append(_issue("CSV_COLUMN_COUNT", location, row_start))
                    continue
                supplied, label = cells
                parts = _relative_parts(supplied)
                if parts is None:
                    issues.append(_issue("CSV_UNSAFE_PATH", location, row_start))
                    continue
                identity = _path_key(parts)
                matches = index.get(identity, [])
                image = matches[0] if len(matches) == 1 else None
                prior = seen.get(identity)
                if prior is not None:
                    first_row, first_label = prior
                    issues.append(
                        _issue(
                            "CSV_DUPLICATE_PATH", location, row_start, image, first_row
                        )
                    )
                    if image is not None:
                        labels.pop(image["key"], None)
                        issues.append(
                            _issue("CSV_DUPLICATE_PATH", location, first_row, image)
                        )
                        if _text(label) and _text(first_label) and label != first_label:
                            issues.append(
                                _issue(
                                    "DUPLICATE_LABEL_CONFLICT",
                                    location,
                                    row_start,
                                    image,
                                    first_row,
                                )
                            )
                    continue
                seen[identity] = (row_start, label)
                if not _text(label):
                    issues.append(
                        _issue(
                            "CLASSIFICATION_LABEL_INVALID", location, row_start, image
                        )
                    )
                    continue
                if not matches:
                    issues.append(_issue("CSV_IMAGE_NOT_FOUND", supplied, row_start))
                elif image is None:
                    issues.append(_issue("IMAGE_PATH_AMBIGUOUS", location, row_start))
                else:
                    labels[image["key"]] = (label, row_start)
        except csv.Error as error:
            code = (
                "CSV_FIELD_TOO_LARGE"
                if str(error).startswith("field larger than field limit")
                else "CSV_MALFORMED"
            )
            raise ImportFormatError(code, location, row_start) from None
    return labels


def import_classification(
    source: ScanSource, images: Sequence[HashedImage]
) -> ClassificationImport:
    """Map enumerated keys only; never decode or promote import to confirmation."""
    validated = parse_scan_payload(
        {"taskType": "classification", "mode": "reference", "source": source}
    )["source"]
    if not images:
        raise ImportFormatError("NO_VALID_IMAGES")
    if len(images) > MAX_INPUT_ITEMS:
        raise ImportFormatError("INPUT_LIMIT_EXCEEDED")
    annotations: dict[str, ClassificationAnnotation | None] = {
        image["key"]: None for image in images
    }
    if len(annotations) != len(images) or any(not _text(key) for key in annotations):
        raise ImportFormatError("INVALID_IMAGE_KEYS")
    if validated["format"] == "unlabeled":
        return ClassificationImport((), annotations, [])
    if validated["format"] not in ("folder", "csv"):
        raise ImportFormatError("UNSUPPORTED_CLASSIFICATION_FORMAT")
    if os.name != "nt":
        raise ImportFormatError("WINDOWS_REQUIRED")
    root = Path(validated["root"])
    pure_root = PureWindowsPath(validated["root"])
    issues: list[ScanIssue] = []
    index: dict[_Identity, list[HashedImage]] = {}
    relative: dict[str, tuple[str, ...]] = {}
    for image in images:
        try:
            parts = _image_parts(pure_root, image)
        except ImportFormatError as error:
            issues.append(_issue(error.code, image["sourcePath"], image=image))
            continue
        relative[image["key"]] = parts
        index.setdefault(_path_key(parts), []).append(image)
    ambiguous: set[str] = set()
    for matches in index.values():
        if len(matches) > 1:
            for image in matches:
                ambiguous.add(image["key"])
                issues.append(
                    _issue("IMAGE_PATH_AMBIGUOUS", image["sourcePath"], image=image)
                )
    location = str(root)
    labels: dict[str, _Label] = {}
    try:
        root_chain = _chain(root)
        if not stat.S_ISDIR(root_chain[-1][1].st_mode):
            raise ImportFormatError("DIRECTORY_REQUIRED", location)
        if validated["format"] == "csv":
            location = validated["annotationPath"]
            text = _read_csv(Path(location), root_chain)
            labels = _csv_labels(text, location, index, issues)
        else:
            for image in images:
                folder_parts = relative.get(image["key"])
                if folder_parts is None or image["key"] in ambiguous:
                    continue
                if len(folder_parts) == 1:
                    issues.append(
                        _issue("CLASSIFICATION_FOLDER_REQUIRED", location, image=image)
                    )
                elif not _text(folder_parts[0]):
                    issues.append(
                        _issue("CLASSIFICATION_LABEL_INVALID", location, image=image)
                    )
                else:
                    labels[image["key"]] = (folder_parts[0], None)
        _check_root(root_chain)
    except OSError:
        raise ImportFormatError("ANNOTATION_READ_FAILED", location) from None
    names = sorted({label for label, _ in labels.values()})
    classes: tuple[ScanClass, ...] = tuple(
        {"key": f"class:{index}", "name": name, "sourceCategoryId": None}
        for index, name in enumerate(names)
    )
    class_keys = {entry["name"]: entry["key"] for entry in classes}
    hashes: dict[str, list[HashedImage]] = {}
    for image in images:
        imported = labels.get(image["key"])
        if imported is None:
            if validated["format"] == "csv":
                issues.append(
                    _issue("CLASSIFICATION_LABEL_MISSING", location, image=image)
                )
            continue
        label, row = imported
        annotations[image["key"]] = {
            "type": "classification",
            "classKey": class_keys[label],
            "sourceRow": row,
        }
        hashes.setdefault(image["sha256"], []).append(image)
    for matches in hashes.values():
        if len({labels[image["key"]][0] for image in matches}) > 1:
            for image in matches:
                issues.append(
                    _issue(
                        "DUPLICATE_LABEL_CONFLICT",
                        location,
                        labels[image["key"]][1],
                        image,
                    )
                )
    return ClassificationImport(classes, annotations, issues)
