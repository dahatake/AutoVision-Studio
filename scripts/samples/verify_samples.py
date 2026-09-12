"""SP-06/07/08: offline, developer-only, read-only fixed sample verification.

The CLI remains inventory-only and accepts no overrides. Explicitly calling
verify_classification exercises the normal DAT-02/03/04 pipeline for Beans;
verify_detection requires that success before DAT-02/03/05 for all GWHD images
and original COCO boxes. No acquisition, project registration or training.
verify_inventory callers may inject a local fixture root and independently
supplied manifest pins; those pins are NOT license approval.
Never derive trusted pins from the tree being checked. Production pins below
come from the reviewed DATA-03d/06 records and the 2026-09-11 baseline.

Use a quiescent local tree: links/reparse points and changed reads are rejected,
but this developer utility is not a sandbox against hostile concurrent renames.
Importing this module performs no filesystem reads or writes.
"""

from __future__ import annotations

import hashlib
import json
import math
import ntpath
import os
import re
import stat
import sys
from copy import deepcopy
from pathlib import Path, PurePosixPath

INVENTORY_LIMIT = 96 * 1024 * 1024
JSON_LIMIT = 1024 * 1024
SAMPLE_IDS = ("beans", "gwhd-2021")
LABELS = ("angular_leaf_spot", "bean_rust", "healthy")
APPROVED_MANIFEST_SHA256 = {
    "beans": "29f0c7225ed4bcb7e79cfcb135088fd65662ac244654caec78dd2a4a5024c47d",
    "gwhd-2021": "b4e5ba7653a4ca8b23e913e0864e39d422b0e9470bf7cc6ef527560f1a91a94b",
}
_SOURCES = {
    "beans": {
        "dataset": "Beans",
        "version": "27aa014ce09b193e1a6f58112d4a66e0eddb69c5",
        "url": (
            "https://huggingface.co/datasets/AI-Lab-Makerere/beans/resolve/"
            "27aa014ce09b193e1a6f58112d4a66e0eddb69c5/data/train.zip"
        ),
        "byteSize": 143812152,
        "sha256": "284fe8456ce20687f4367ae7ad94a64577e7f9fde2c2c6b1c74340ab5dc82715",
    },
    "gwhd-2021": {
        "dataset": "Global Wheat Head Dataset 2021",
        "version": "1.0",
        "url": (
            "https://zenodo.org/api/records/5092309/files/gwhd_2021.zip/"
            "container/gwhd_2021/competition_train.csv"
        ),
        "byteSize": 2841482,
        # sample.ts permits any valid SHA; this fixed inventory pins the observed CSV.
        "sha256": "1af1d8e386643afe8cd1b41d89ca2634d3212908bdbe58a9d7cd5b32e4048176",
    },
}
_JS_WHITESPACE = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005"
    "\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)
_HASHED_FIELDS = {
    "key",
    "sourcePath",
    "byteSize",
    "mtimeNs",
    "sha256",
    "format",
    "duplicateOf",
}


def _object(value: object, keys: set[str]) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError("Unexpected metadata object fields")
    return value


def _unique(pairs: list[tuple[str, object]]) -> dict:
    value = dict(pairs)
    if len(value) != len(pairs):
        raise ValueError("Duplicate JSON key")
    return value


def _nonfinite(_: str) -> None:
    raise ValueError("Nonfinite JSON number")


def _finite_float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Nonfinite JSON number")
    return number


def _json(raw: bytes) -> dict:
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_unique,
            parse_constant=_nonfinite,
            parse_float=_finite_float,
        )
    except (ValueError, RecursionError):
        raise ValueError("Invalid UTF-8, duplicate-key or nonfinite JSON") from None
    if not isinstance(value, dict):
        raise ValueError(  # noqa: TRY004 -- Invalid external JSON value.
            "Expected a JSON metadata object"
        )
    return value


def _sha256(value: object) -> None:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise ValueError("Invalid SHA-256")


def _metadata(entry: dict) -> dict:
    size = entry["byteSize"]
    if type(size) is not int or not 0 < size <= INVENTORY_LIMIT:
        raise ValueError("Invalid declared byte size")
    _sha256(entry["sha256"])
    return {"byteSize": size, "sha256": entry["sha256"]}


def validate_manifest(value: object, sample_id: str) -> dict[str, dict]:
    """Validate the fixed sample.ts shape; return relative file metadata only."""
    if not isinstance(sample_id, str) or sample_id not in SAMPLE_IDS:
        raise ValueError("Unknown sample ID")
    manifest = _object(
        value,
        {
            "schemaVersion",
            "sampleVersion",
            "id",
            "taskType",
            "sourceSplit",
            "source",
            "licenses",
            "images",
            "files",
        },
    )
    classification = sample_id == "beans"
    license_id = "MIT" if classification else "CC-BY-4.0"
    if (
        any(
            type(manifest[key]) is not int or manifest[key] != 1
            for key in ("schemaVersion", "sampleVersion")
        )
        or manifest["id"] != sample_id
        or manifest["taskType"] != ("classification" if classification else "detection")
        or manifest["sourceSplit"] != "train"
        or manifest["licenses"] != {"images": license_id, "annotations": license_id}
    ):
        raise ValueError("Unexpected sample schema, task or licenses")
    source = _object(manifest["source"], set(_SOURCES[sample_id]))
    if type(source["byteSize"]) is not int or source != _SOURCES[sample_id]:
        raise ValueError("Unexpected fixed source")
    images = manifest["images"]
    if not isinstance(images, list) or len(images) != (60 if classification else 20):
        raise ValueError("Unexpected image count")
    inventory, counts = {}, dict.fromkeys(LABELS, 0)
    seen: dict[str, set[str]] = {key: set() for key in ("path", "sourceId", "sha256")}
    for image in images:
        keys = {"path", "sourceId", "byteSize", "sha256"}
        keys |= (
            {"label"}
            if classification
            else {
                "sourceFilename",
                "detectedFormat",
                "domain",
            }
        )
        image = _object(image, keys)
        metadata = _metadata(image)
        path = image["path"]
        if not isinstance(path, str):
            raise ValueError(  # noqa: TRY004 -- Invalid external JSON value.
                "Invalid image path"
            )
        if classification:
            label = image["label"]
            if not isinstance(label, str) or label not in LABELS:
                raise ValueError("Unexpected Beans label")
            pattern = "images/" + label + r"/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.jpg"
            if re.fullmatch(pattern, path) is None or ntpath.isreserved(path):
                raise ValueError("Unsafe Beans image path")
            if image["sourceId"] != "train/" + path.removeprefix("images/"):
                raise ValueError("Beans source ID and label/path differ")
            counts[label] += 1
        else:
            _sha256(image["sourceId"])
            detected = image["detectedFormat"]
            if detected not in ("jpeg", "png"):
                raise ValueError("Unexpected declared image format")
            extension = "jpg" if detected == "jpeg" else "png"
            if (
                path != f"images/{image['sourceId']}.{extension}"
                or image["sourceFilename"] != image["sourceId"] + ".png"
            ):
                raise ValueError("GWHD path/source filename mismatch")
            domain = image["domain"]
            try:
                valid_domain = (
                    isinstance(domain, str)
                    and 1 <= len(domain.encode("utf-16-le")) // 2 <= 128
                    and bool(domain.strip(_JS_WHITESPACE))
                    and not any(ord(c) < 32 or ord(c) == 127 for c in domain)
                )
            except UnicodeError:
                valid_domain = False
            if not valid_domain:
                raise ValueError("Invalid domain provenance")
        for key, seen_values in seen.items():
            normalized = image[key].casefold()
            if normalized in seen_values:
                raise ValueError("Duplicate image path, source ID or hash")
            seen_values.add(normalized)
        inventory[path] = metadata
    if classification and any(count != 20 for count in counts.values()):
        raise ValueError("Beans requires exactly 20 images per label")
    required = {"LICENSE.txt", "ATTRIBUTION.txt"}
    if not classification:
        required.add("annotations.coco.json")
    files = manifest["files"]
    if not isinstance(files, list) or len(files) != len(required):
        raise ValueError("Unexpected notice/COCO inventory")
    seen_files = set()
    for entry in files:
        entry = _object(entry, {"path", "byteSize", "sha256"})
        path = entry["path"]
        if not isinstance(path, str) or path not in required or path in seen_files:
            raise ValueError("Missing, duplicate or unexpected notice/COCO path")
        seen_files.add(path)
        inventory[path] = _metadata(entry)
    if sum(entry["byteSize"] for entry in inventory.values()) > INVENTORY_LIMIT:
        raise ValueError("Declared sample inventory exceeds 96 MiB")
    return inventory


def _node(path: Path, directory: bool) -> os.stat_result:
    info = path.lstat()  # Never resolve links before checking them.
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
        raise ValueError("Sample links, junctions and reparse points are forbidden")
    if directory:
        if not stat.S_ISDIR(info.st_mode):
            raise ValueError("Expected a sample directory")
    elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError("Expected a single-link regular sample file")
    return info


def _directory(path: Path) -> None:
    if (
        not path.is_absolute()
        or ".." in path.parts
        or str(path).startswith(("\\\\", "//"))
        or ntpath.isreserved(str(path))
    ):
        raise ValueError("Expected a safe absolute local root")
    for ancestor in (*reversed(path.parents), path):
        _node(ancestor, True)


def _same_file(
    before: os.stat_result, after: os.stat_result, *, compare_ctime: bool = True
) -> bool:
    return (
        os.path.samestat(before, after)
        and stat.S_ISREG(after.st_mode)
        and after.st_nlink == 1
        and before.st_size == after.st_size
        and before.st_mtime_ns == after.st_mtime_ns
        and (not compare_ctime or before.st_ctime_ns == after.st_ctime_ns)
    )


def _read(path: Path, limit: int, *, capture: bool = False) -> tuple[dict, bytes]:
    _directory(path.parent)
    before = _node(path, False)
    if not 0 < before.st_size <= limit:
        raise ValueError("Empty or oversized inventory file")
    digest, size, chunks = hashlib.sha256(), 0, []
    with path.open("rb") as source:
        opened = os.fstat(source.fileno())
        # Windows lstat/fstat ctime semantics can differ for an unchanged file.
        # Compare the path's ctime only against another lstat snapshot.
        if not _same_file(before, opened, compare_ctime=False) or not _same_file(
            before, _node(path, False)
        ):
            raise ValueError("Sample changed before reading")
        while block := source.read(min(64 * 1024, limit - size + 1)):
            size += len(block)
            if size > limit:
                raise ValueError("Inventory read exceeds declared size")
            digest.update(block)
            if capture:
                chunks.append(block)
        if size != opened.st_size or not _same_file(opened, os.fstat(source.fileno())):
            raise ValueError("Sample changed during reading")
    _directory(path.parent)
    if not _same_file(before, _node(path, False)):
        raise ValueError("Sample changed after reading")
    return {"byteSize": size, "sha256": digest.hexdigest()}, b"".join(chunks)


def _tree(root: Path, expected: dict[str, dict]) -> None:
    directories = {
        parent.as_posix()
        for name in expected
        for parent in PurePosixPath(name).parents
        if parent != PurePosixPath(".")
    }
    pending, files, found_directories, total = [root], set(), set(), 0
    while pending:
        directory = pending.pop()
        _directory(directory)
        for child in directory.iterdir():
            name = child.relative_to(root).as_posix()
            if name in directories:
                _node(child, True)
                found_directories.add(name)
                pending.append(child)
            elif name in expected:
                info = _node(child, False)
                files.add(name)
                total += info.st_size
                if total > INVENTORY_LIMIT:
                    raise ValueError("Combined inventory exceeds 96 MiB")
            else:
                raise ValueError("Extra inventory file or directory")
    if files != set(expected) or found_directories != directories:
        raise ValueError("Missing inventory file or directory")


def _coco(raw: bytes, images: list[dict]) -> None:
    """Check frozen metadata structure, NOT decode/import or source-box parity."""
    coco = _object(_json(raw), {"info", "images", "annotations", "categories"})
    info = _object(coco["info"], {"version", "description"})
    if info["version"] != "1.0" or not isinstance(info["description"], str):
        raise ValueError("Unexpected COCO info")
    categories = coco["categories"]
    if categories != [{"id": 1, "name": "wheat_head"}] or (
        type(categories[0]["id"]) is not int
    ):
        raise ValueError("Unexpected COCO category")
    records = coco["images"]
    if not isinstance(records, list) or len(records) != 20:
        raise ValueError("Unexpected COCO image count")
    for number, (record, image) in enumerate(zip(records, images, strict=True), 1):
        record = _object(record, {"id", "file_name", "width", "height"})
        if any(type(record[key]) is not int for key in ("id", "width", "height")) or (
            record
            != {
                "id": number,
                "file_name": image["path"].removeprefix("images/"),
                "width": 1024,
                "height": 1024,
            }
        ):
            raise ValueError("Unexpected COCO image metadata")
    annotations = coco["annotations"]
    if not isinstance(annotations, list) or len(annotations) != 1079:
        raise ValueError("Unexpected fixed COCO annotation count")
    for number, annotation in enumerate(annotations, 1):
        annotation = _object(
            annotation,
            {
                "id",
                "image_id",
                "category_id",
                "bbox",
                "area",
                "iscrowd",
            },
        )
        if (
            any(
                type(annotation[key]) is not int
                for key in ("id", "image_id", "category_id", "area", "iscrowd")
            )
            or annotation["id"] != number
            or not 1 <= annotation["image_id"] <= 20
            or annotation["category_id"] != 1
            or annotation["iscrowd"] != 0
            or not isinstance(annotation["bbox"], list)
            or len(annotation["bbox"]) != 4
            or any(type(value) is not int for value in annotation["bbox"])
        ):
            raise ValueError("Unexpected COCO annotation metadata")


def verify_inventory(
    root: Path, *, expected_manifest_hashes: dict[str, str] | None = None
) -> dict:
    """Read BOTH fixed datasets; supplied pins must be independent trusted evidence.

    The explicit pin argument is for focused developer fixtures, never a runtime
    API or CLI input. The default requires the reviewed production manifests,
    so editing a notice and rehashing its manifest does not grant approval.
    """
    pins = (
        APPROVED_MANIFEST_SHA256
        if expected_manifest_hashes is None
        else expected_manifest_hashes
    )
    _object(pins, set(SAMPLE_IDS))
    for pin in pins.values():
        _sha256(pin)
    root = Path(root)
    _directory(root)
    expected, manifests = {}, {}
    for sample_id in SAMPLE_IDS:
        metadata, raw = _read(
            root / sample_id / "manifest.json", JSON_LIMIT, capture=True
        )
        manifest = _json(raw)
        entries = validate_manifest(manifest, sample_id)
        if metadata["sha256"] != pins[sample_id]:
            raise ValueError("Manifest differs from independently trusted SHA-256")
        manifests[sample_id] = manifest
        expected[f"{sample_id}/manifest.json"] = metadata
        expected.update(
            {f"{sample_id}/{name}": value for name, value in entries.items()}
        )
    total = sum(entry["byteSize"] for entry in expected.values())
    if total > INVENTORY_LIMIT:
        raise ValueError("Combined inventory including manifests exceeds 96 MiB")
    _tree(root, expected)
    for name, metadata in expected.items():
        is_coco = name == "gwhd-2021/annotations.coco.json"
        limit = (
            min(metadata["byteSize"], JSON_LIMIT) if is_coco else metadata["byteSize"]
        )
        observed, raw = _read(root / name, limit, capture=is_coco)
        if observed != metadata:
            raise ValueError("Inventory size or SHA-256 mismatch")
        if is_coco:
            _coco(raw, manifests["gwhd-2021"]["images"])
    _tree(root, expected)
    return {
        "scope": "inventory-only",
        "inventory": "PASS",
        "normalDecodeImport": "NOT_RUN",
        "manifestTrust": "reviewed-pins"
        if expected_manifest_hashes is None
        else "caller-supplied-pins",
        "imageCounts": {"beans": 60, "gwhd-2021": 20},
        "fileCount": len(expected),
        "totalBytes": total,
    }


def _same_metadata(actual: object, expected: object) -> bool:
    """Compare pipeline dict/list/tuple metadata and primitives without coercion."""
    if type(actual) is not type(expected):
        return False
    if isinstance(actual, dict) and isinstance(expected, dict):
        if {(type(key), key) for key in actual} != {
            (type(key), key) for key in expected
        }:
            return False
        return all(
            _same_metadata(value, expected[key]) for key, value in actual.items()
        )
    if isinstance(actual, (list, tuple)) and isinstance(expected, (list, tuple)):
        return len(actual) == len(expected) and all(
            _same_metadata(value, before)
            for value, before in zip(actual, expected, strict=True)
        )
    return actual == expected


def _check_decoded_image(
    candidate: object, before: object, image: object, max_image_pixels: int
) -> None:
    """Shared SP-07/08 check; never change the decoder's raw metadata."""
    before = _object(before, _HASHED_FIELDS)
    values = _object(
        image, _HASHED_FIELDS | {"width", "height", "orientation", "annotation"}
    )
    if not _same_metadata(candidate, before) or not _same_metadata(
        {field: values[field] for field in _HASHED_FIELDS}, before
    ):
        raise ValueError("Normal decoder changed raw image metadata")
    width, height, orientation = (
        values["width"],
        values["height"],
        values["orientation"],
    )
    if (
        type(width) is not int
        or type(height) is not int
        or width <= 0
        or height <= 0
        or width * height > max_image_pixels
        or type(orientation) is not int
        or not 1 <= orientation <= 8
        or values["annotation"] is not None
    ):
        raise ValueError("Invalid normal decoded image metadata")


def verify_classification(root: Path) -> dict:
    """SP-07 / DATA-07b: verify every Beans image through normal helpers.

    Both datasets must match the reviewed pins before ANY ML import. Run from
    the existing ML environment where autovision_ml is importable; no sys.path
    changes, dependency installation, fake worker context or persistent IDs.
    Missing dependencies raise a NOT_RUN ValueError; decoder/importer failures
    propagate rather than becoming PASS. The returned counts describe Beans
    only; GWHD still receives inventory verification, NOT normal decode/import.
    """
    root = Path(root)
    inventory = verify_inventory(root)
    original_files = {
        path: _node(path, False) for path in root.rglob("*") if path.is_file()
    }
    try:
        try:
            from autovision_ml.data.classification_import import import_classification
            from autovision_ml.data.image_decode import decode_image
            from autovision_ml.data.image_scan import enumerate_and_hash
            from autovision_ml.data.import_contract import (
                MAX_IMAGE_PIXELS,
                ScanImage,
                ScanSource,
            )
        except ImportError:
            raise ValueError(
                "Classification normalDecodeImport NOT_RUN: autovision_ml and "
                "Pillow must be available in the existing ML environment"
            ) from None

        metadata, raw = _read(root / "beans/manifest.json", JSON_LIMIT, capture=True)
        if metadata["sha256"] != APPROVED_MANIFEST_SHA256["beans"]:
            raise ValueError("Manifest differs from independently trusted SHA-256")
        expected = {
            entry["path"].removeprefix("images/"): entry
            for entry in _json(raw)["images"]
        }
        images_root = root / "beans" / "images"
        source: ScanSource = {"format": "folder", "root": str(images_root)}
        original_source = deepcopy(source)
        scan = enumerate_and_hash(source)
        if scan.issues != []:
            raise ValueError("Normal classification scan reported issues")
        if len(scan.images) != len(expected):
            raise ValueError("Normal classification scan image count mismatch")
        by_key, seen = {}, set()
        for candidate in scan.images:
            _object(candidate, _HASHED_FIELDS)
            key = candidate["key"]
            if (
                type(key) is not str
                or not key.strip()
                or key in by_key
                or type(candidate["sourcePath"]) is not str
            ):
                raise ValueError("Normal classification scan image key/path mismatch")
            path = Path(candidate["sourcePath"])
            relative = path.relative_to(images_root).as_posix()
            entry = expected.get(relative)
            if entry is None or relative in seen:
                raise ValueError("Normal classification scan image path mismatch")
            if entry["sourceId"] != "train/" + relative or not _same_metadata(
                candidate,
                {
                    "key": key,
                    "sourcePath": str(images_root / relative),
                    "byteSize": entry["byteSize"],
                    "mtimeNs": str(original_files[images_root / relative].st_mtime_ns),
                    "sha256": entry["sha256"],
                    "format": "jpeg",
                    "duplicateOf": None,
                },
            ):
                raise ValueError("Normal classification scan differs from manifest")
            seen.add(relative)
            by_key[key] = entry
        if seen != set(expected):
            raise ValueError("Normal classification scan omitted manifest images")

        original_candidates = deepcopy(scan.images)
        decoded: list[ScanImage] = []
        for candidate in scan.images:
            before = deepcopy(candidate)
            image = decode_image(candidate)  # Fully loads pixels; not header-only.
            _check_decoded_image(candidate, before, image, MAX_IMAGE_PIXELS)
            decoded.append(image)

        imported = import_classification(source, scan.images)
        if not _same_metadata(source, original_source) or not _same_metadata(
            scan.images, original_candidates
        ):
            raise ValueError("Normal classifier changed raw image metadata")
        if imported.issues != []:
            raise ValueError("Normal classification importer reported issues")
        classes = {}
        for entry in imported.classes:
            _object(entry, {"key", "name", "sourceCategoryId"})
            key = entry["key"]
            if (
                not isinstance(key, str)
                or not key.strip()
                or key in classes
                or entry["name"] not in LABELS
                or entry["sourceCategoryId"] is not None
            ):
                raise ValueError("Normal classification class metadata mismatch")
            classes[key] = entry["name"]
        if len(classes) != len(LABELS) or set(classes.values()) != set(LABELS):
            raise ValueError("Normal classification class count or names mismatch")
        if set(imported.annotations) != set(by_key):
            raise ValueError("Normal classification annotation image keys mismatch")
        counts = dict.fromkeys(LABELS, 0)
        for image in decoded:
            annotation = _object(
                imported.annotations[image["key"]],
                {"type", "classKey", "sourceRow"},
            )
            class_key = annotation["classKey"]
            if (
                annotation["type"] != "classification"
                or not isinstance(class_key, str)
                or class_key not in classes
                or annotation["sourceRow"] is not None
                or classes[class_key] != by_key[image["key"]]["label"]
            ):
                raise ValueError(
                    "Normal classification annotation differs from manifest"
                )
            counts[classes[class_key]] += 1
        if counts != dict.fromkeys(LABELS, 20):
            raise ValueError("Normal classification requires 20 images per label")
    finally:
        # Recheck ALL 87 files, including GWHD, even when normal processing fails.
        if not _same_metadata(verify_inventory(root), inventory) or any(
            not _same_file(before, _node(path, False))
            for path, before in original_files.items()
        ):
            raise ValueError(
                "Sample inventory changed during classification verification"
            )

    return {
        "scope": "classification-import",
        "inventory": inventory["inventory"],
        "normalDecodeImport": "PASS",
        "manifestTrust": inventory["manifestTrust"],
        "sampleId": "beans",
        "fileCount": inventory["fileCount"],
        "totalBytes": inventory["totalBytes"],
        "imageCount": len(scan.images),
        "decodedImageCount": len(decoded),
        "annotationCount": len(imported.annotations),
        "classCount": len(classes),
        "classCounts": counts,
        "issues": scan.issues + imported.issues,
        "detectionDecodeImport": "NOT_RUN",
    }


def verify_detection(root: Path) -> dict:
    """SP-08 / DATA-07c: require SP-07, then verify all original GWHD boxes.

    Explicit developer API only, with the same reviewed pins and existing ML
    environment as SP-07. Counts below describe GWHD; both normal pipelines
    must succeed. No caller-supplied success, pins, IDs or worker envelopes.
    The DATA-06 baseline has raw orientation 1; dimensions come from the frozen
    COCO, not invented ScanImage placeholders. Any issue or mismatch fails.
    All 87 files are rechecked even on failure; nothing is repaired or saved.
    This result alone does not close DATA-07 or claim application acceptance.
    """
    root = Path(root)
    inventory = verify_inventory(root)
    original_files = {
        path: _node(path, False) for path in root.rglob("*") if path.is_file()
    }
    try:
        classification = verify_classification(root)
        if (
            not isinstance(classification, dict)
            or classification.get("scope") != "classification-import"
            or classification.get("sampleId") != "beans"
            or classification.get("normalDecodeImport") != "PASS"
            or not _same_metadata(classification.get("issues"), [])
            or any(
                not _same_metadata(classification.get(field), inventory[field])
                for field in ("inventory", "manifestTrust", "fileCount", "totalBytes")
            )
        ):
            raise ValueError(
                "SP-07 classification success is required before detection"
            )
        try:
            from autovision_ml.data.coco_import import import_coco
            from autovision_ml.data.image_decode import decode_image
            from autovision_ml.data.image_scan import enumerate_and_hash
            from autovision_ml.data.import_contract import (
                MAX_IMAGE_PIXELS,
                ScanImage,
                ScanSource,
            )
        except ImportError:
            raise ValueError(
                "Detection normalDecodeImport NOT_RUN: autovision_ml and "
                "Pillow must be available in the existing ML environment"
            ) from None

        metadata, raw = _read(
            root / "gwhd-2021/manifest.json", JSON_LIMIT, capture=True
        )
        if metadata["sha256"] != APPROVED_MANIFEST_SHA256["gwhd-2021"]:
            raise ValueError("Manifest differs from independently trusted SHA-256")
        manifest = _json(raw)
        expected = {
            entry["path"].removeprefix("images/"): entry for entry in manifest["images"]
        }
        annotation_path = root / "gwhd-2021/annotations.coco.json"
        annotation_metadata = _metadata(
            next(
                entry
                for entry in manifest["files"]
                if entry["path"] == "annotations.coco.json"
            )
        )
        metadata, raw = _read(
            annotation_path,
            min(annotation_metadata["byteSize"], JSON_LIMIT),
            capture=True,
        )
        if not _same_metadata(metadata, annotation_metadata):
            raise ValueError("COCO size or SHA-256 differs from reviewed manifest")
        coco = _json(raw)
        coco_images = {entry["file_name"]: entry for entry in coco["images"]}
        images_root = root / "gwhd-2021/images"
        source: ScanSource = {
            "format": "coco",
            "root": str(images_root),
            "annotationPath": str(annotation_path),
        }
        original_source = deepcopy(source)
        scan = enumerate_and_hash(source)
        if scan.issues != []:
            raise ValueError("Normal detection scan reported issues")
        if len(scan.images) != len(expected):
            raise ValueError("Normal detection scan image count mismatch")
        by_key, seen = {}, set()
        for candidate in scan.images:
            _object(candidate, _HASHED_FIELDS)
            key = candidate["key"]
            if (
                type(key) is not str
                or not key.strip()
                or key in by_key
                or type(candidate["sourcePath"]) is not str
            ):
                raise ValueError("Normal detection scan image key/path mismatch")
            relative = Path(candidate["sourcePath"]).relative_to(images_root).as_posix()
            # Match the bundled path, not sourceFilename: two upstream .png
            # names contain JPEG bytes and are already bundled unchanged as .jpg.
            entry = expected.get(relative)
            if entry is None or relative in seen:
                raise ValueError("Normal detection scan image path mismatch")
            if not _same_metadata(
                candidate,
                {
                    "key": key,
                    "sourcePath": str(images_root / relative),
                    "byteSize": entry["byteSize"],
                    "mtimeNs": str(original_files[images_root / relative].st_mtime_ns),
                    "sha256": entry["sha256"],
                    "format": entry["detectedFormat"],
                    "duplicateOf": None,
                },
            ):
                raise ValueError("Normal detection scan differs from manifest")
            seen.add(relative)
            by_key[key] = coco_images[relative]
        if seen != set(expected):
            raise ValueError("Normal detection scan omitted manifest images")

        original_candidates = deepcopy(scan.images)
        decoded: list[ScanImage] = []
        format_counts: dict[str, int] = {}
        for candidate in scan.images:
            before = deepcopy(candidate)
            image = decode_image(candidate)
            _check_decoded_image(candidate, before, image, MAX_IMAGE_PIXELS)
            original = by_key[image["key"]]
            if (image["width"], image["height"]) != (
                original["width"],
                original["height"],
            ) or image["orientation"] != 1:
                raise ValueError(
                    "Normal detection geometry differs from frozen baseline"
                )
            decoded.append(image)
            kind = image["format"]
            format_counts[kind] = format_counts.get(kind, 0) + 1

        original_decoded = deepcopy(decoded)
        imported = import_coco(source, decoded)
        if (
            not _same_metadata(source, original_source)
            or not _same_metadata(scan.images, original_candidates)
            or not _same_metadata(decoded, original_decoded)
        ):
            raise ValueError("Normal detection pipeline changed input metadata")
        if imported.issues != []:
            raise ValueError("Normal detection importer reported issues")
        if len(imported.classes) != len(coco["categories"]):
            raise ValueError("Normal detection class count mismatch")
        category = coco["categories"][0]
        imported_class = _object(
            imported.classes[0], {"key", "name", "sourceCategoryId"}
        )
        class_key = imported_class["key"]
        if (
            not isinstance(class_key, str)
            or not class_key.strip()
            or imported_class["name"] != category["name"]
            or imported_class["sourceCategoryId"] != str(category["id"])
        ):
            raise ValueError("Normal detection class differs from frozen COCO")
        if set(imported.annotations) != set(by_key):
            raise ValueError("Normal detection annotation image keys mismatch")

        # Group without sorting: global COCO interleaving is allowed, but each
        # image's original annotation sequence, IDs and numeric types must match.
        expected_boxes: dict[int, list[dict]] = {
            entry["id"]: [] for entry in coco["images"]
        }
        for original in coco["annotations"]:
            expected_boxes[original["image_id"]].append(original)
        annotation_count = 0
        for image in decoded:
            original_image = by_key[image["key"]]
            annotation = _object(
                imported.annotations[image["key"]],
                {"type", "sourceImageId", "boxes"},
            )
            boxes = annotation["boxes"]
            originals = expected_boxes[original_image["id"]]
            if (
                annotation["type"] != "detection"
                or annotation["sourceImageId"] != str(original_image["id"])
                or not isinstance(boxes, list)
                or len(boxes) != len(originals)
            ):
                raise ValueError("Normal detection image annotation differs from COCO")
            for box, original in zip(boxes, originals, strict=True):
                _object(box, {"classKey", "bbox", "sourceAnnotationId"})
                if (
                    box["sourceAnnotationId"] != str(original["id"])
                    or box["classKey"] != class_key
                    or imported_class["sourceCategoryId"]
                    != str(original["category_id"])
                    or not isinstance(box["bbox"], list)
                    or len(box["bbox"]) != len(original["bbox"])
                    or any(
                        type(actual) is not type(expected_value)
                        or actual != expected_value
                        for actual, expected_value in zip(
                            box["bbox"], original["bbox"], strict=True
                        )
                    )
                ):
                    raise ValueError("Normal detection box differs from frozen COCO")
            annotation_count += len(boxes)
        if annotation_count != 1079:
            raise ValueError("Normal detection requires exactly 1079 original boxes")
        issues = classification["issues"] + scan.issues + imported.issues
        if issues != []:
            raise ValueError("Normal detection pipeline reported issues")
    finally:
        if not _same_metadata(verify_inventory(root), inventory) or any(
            not _same_file(before, _node(path, False))
            for path, before in original_files.items()
        ):
            raise ValueError("Sample inventory changed during detection verification")

    return {
        "scope": "detection-import",
        "inventory": inventory["inventory"],
        "normalDecodeImport": "PASS",
        "manifestTrust": inventory["manifestTrust"],
        "sampleId": "gwhd-2021",
        "fileCount": inventory["fileCount"],
        "totalBytes": inventory["totalBytes"],
        "imageCount": len(scan.images),
        "decodedImageCount": len(decoded),
        "formatCounts": format_counts,
        "annotatedImageCount": len(imported.annotations),
        "annotationCount": annotation_count,
        "classCount": len(imported.classes),
        "classCounts": {imported_class["name"]: annotation_count},
        "classificationDecodeImport": classification["normalDecodeImport"],
        "detectionDecodeImport": "PASS",
        "issues": issues,
    }


def main(argv: list[str] | None = None) -> int:
    try:
        if sys.argv[1:] if argv is None else argv:
            raise ValueError("No CLI overrides are supported")
        root = Path(__file__).absolute().parents[2] / "resources" / "samples"
        result = verify_inventory(root)
    except (ValueError, OSError) as error:
        print(
            json.dumps(
                {
                    "scope": "inventory-only",
                    "inventory": "FAIL",
                    "normalDecodeImport": "NOT_RUN",
                    "error": type(error).__name__,
                },
                sort_keys=True,
            )
        )  # No untrusted paths, URLs or OS exception text.
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
