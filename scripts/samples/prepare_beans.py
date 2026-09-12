"""DATA-02 developer-only, pinned Beans raw-byte preparation.

This does not run normal DAT-03/DAT-04, decode images, or satisfy Gate 1.
Run stage separately for DATA03a/b/c; the parent must review all three before
invoking manifest. No resizing, recompression, predictions or label confirmation.
Only select may acquire bytes, through sample_io's shared 256 MiB ledger.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

import sample_io

ROOT = Path(__file__).resolve().parents[2]
CACHE = sample_io.CACHE_ROOT / "beans"
ASSETS_ROOT = ROOT / "resources" / "samples" / "beans"
VERSION = "27aa014ce09b193e1a6f58112d4a66e0eddb69c5"
SOURCE_URL = (
    "https://huggingface.co/datasets/AI-Lab-Makerere/beans/resolve/"
    "27aa014ce09b193e1a6f58112d4a66e0eddb69c5/data/train.zip"
)
EXPECTED_SIZE = 143812152
EXPECTED_SHA256 = "284fe8456ce20687f4367ae7ad94a64577e7f9fde2c2c6b1c74340ab5dc82715"
LABELS = ("angular_leaf_spot", "bean_rust", "healthy")
PUBLISHED_LIMIT = 96 * 1024 * 1024
ENTRY_LIMIT = 96 * 1024 * 1024
UNCOMPRESSED_LIMIT = 512 * 1024 * 1024
ENTRY_COUNT_LIMIT = 10_000
SELECTION_LIMIT = 1024 * 1024
_NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
_DEVICES = {"con", "prn", "aux", "nul"} | {
    f"{prefix}{number}" for prefix in ("com", "lpt") for number in range(1, 10)
}


def _json(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, indent=2).encode("utf-8") + b"\n"


def _metadata(data: bytes) -> dict:
    return {"byteSize": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _directory(root: Path) -> None:
    for node in (root, *root.parents):
        if (
            node.is_symlink()
            or node.is_junction()
            or (node.exists() and not node.is_dir())
        ):
            raise ValueError("Unsafe sample directory")


def _space(root: Path, write_bytes: int) -> None:
    _directory(root)
    while not root.exists():
        root = root.parent
    required = (write_bytes * 6 + 4) // 5  # Round up a 20% free-space margin.
    if shutil.disk_usage(root).free < required:
        raise ValueError(f"Insufficient disk space: {required} bytes required")


def _inventory(root: Path) -> dict:
    _directory(root)
    files = {}
    for path in root.rglob("*"):
        if path.is_dir() and not path.is_symlink() and not path.is_junction():
            continue
        files[path.relative_to(root).as_posix()] = sample_io.file_metadata(path)
    return files


def _budget(additional: int) -> None:
    files = _inventory(ROOT / "resources" / "samples")
    if additional + sum(item["byteSize"] for item in files.values()) > PUBLISHED_LIMIT:
        raise ValueError("Combined published samples exceed 96 MiB")


def _preflight(path: Path, expected: dict) -> int:
    try:
        actual = sample_io.file_metadata(path)
    except FileNotFoundError:
        return expected["byteSize"]
    if actual != expected:
        raise FileExistsError("Existing sample bytes differ")
    return 0


def _notices() -> list[dict]:
    files = []
    for name in ("LICENSE.txt", "ATTRIBUTION.txt"):
        metadata = sample_io.file_metadata(ASSETS_ROOT / name)
        if not 0 < int(metadata["byteSize"]) <= PUBLISHED_LIMIT:
            raise ValueError("Notice must be nonempty and within the published limit")
        files.append({"path": name, **metadata})
    return files


def _members(archive: zipfile.ZipFile) -> dict:
    entries = archive.infolist()
    if len(entries) > ENTRY_COUNT_LIMIT or (
        sum(entry.file_size for entry in entries) > UNCOMPRESSED_LIMIT
    ):
        raise ValueError("ZIP directory exceeds entry or uncompressed limits")
    groups = {label: [] for label in LABELS}
    seen = set()
    for entry in entries:
        name = entry.orig_filename  # ZipInfo.filename silently truncates at NUL.
        parts = name.removesuffix("/").split("/")
        if any(character in name for character in "\\:\x00") or any(
            part in ("", ".", "..")
            or part.endswith((".", " "))
            or part.split(".")[0].casefold() in _DEVICES
            for part in parts
        ):
            raise ValueError("Unsafe ZIP member path")
        key = name.removesuffix("/").casefold()
        kind = (entry.external_attr >> 16) & 0o170000
        if key in seen or kind not in (0, 0o040000 if entry.is_dir() else 0o100000):
            raise ValueError("Duplicate or nonregular ZIP member")
        if (
            entry.flag_bits & 1
            or entry.external_attr & 0x440  # DOS device/reparse-point attributes.
            or (entry.external_attr & 0x10 and not entry.is_dir())
            or not 0 <= entry.file_size <= ENTRY_LIMIT
            or (entry.is_dir() and entry.file_size != 0)
        ):
            raise ValueError("Unsupported ZIP member or declared size")
        seen.add(key)
        if entry.is_dir() or not name.casefold().endswith((".jpg", ".jpeg", ".png")):
            continue  # Validate unknown metadata entries, but never extract them.
        if (
            len(parts) != 3
            or parts[0] != "train"
            or parts[1] not in LABELS
            or not parts[2].endswith(".jpg")
            or not all(
                part and all(character in _NAME_CHARS for character in part)
                for part in parts[2][:-4].split(".")
            )
        ):
            raise ValueError("Image must match train/class/original-basename.jpg")
        groups[parts[1]].append(entry)
    return groups


def _expected() -> tuple[dict, dict[str, bytes]]:
    metadata = sample_io.file_metadata(CACHE / "train.zip")
    if metadata != {"byteSize": EXPECTED_SIZE, "sha256": EXPECTED_SHA256}:
        raise ValueError("Archive size/SHA-256 mismatch")
    images, payloads, hashes = [], {}, set()
    with zipfile.ZipFile(CACHE / "train.zip") as archive:
        groups = _members(archive)
        if any(len(groups[label]) < 20 for label in LABELS):
            raise ValueError("Each original training class requires at least 20 images")
        selected = [
            entry
            for label in LABELS
            for entry in sorted(groups[label], key=lambda item: item.filename)[:20]
        ]
        if sum(entry.file_size for entry in selected) > PUBLISHED_LIMIT:
            raise ValueError("Selected raw bytes exceed the published limit")
        for entry in selected:
            with archive.open(entry) as source:
                data = source.read(entry.file_size + 1)  # EOF also verifies ZIP CRC.
            if len(data) != entry.file_size or not data.startswith(b"\xff\xd8\xff"):
                raise ValueError("Invalid selected size or JPEG magic; no decoder used")
            item = _metadata(data)
            if item["sha256"] in hashes:
                raise ValueError("Duplicate selected image bytes; no replacement")
            hashes.add(item["sha256"])
            path = "images/" + entry.filename.removeprefix("train/")
            images.append(
                {
                    "path": path,
                    "sourceId": entry.filename,
                    "label": entry.filename.split("/")[1],
                    **item,
                }
            )
            payloads[path] = data
    return {
        "source": {
            "dataset": "Beans",
            "version": VERSION,
            "url": SOURCE_URL,
            **metadata,
        },
        "images": images,
        "sourceCounts": {label: len(groups[label]) for label in LABELS},
    }, payloads


def _verified_selection() -> tuple[dict, dict[str, bytes]]:
    expected, payloads = _expected()  # No download, even if the cache is missing.
    path = CACHE / "selection.json"
    if int(sample_io.file_metadata(path)["byteSize"]) > SELECTION_LIMIT:
        raise ValueError("Selection exceeds 1 MiB")
    with path.open("rb") as source:
        if source.read(SELECTION_LIMIT + 1) != _json(expected):
            raise ValueError("Selection differs from canonical pinned ZIP evidence")
    return expected, payloads


def prepare_selection() -> dict:
    """Acquire/verify ZIP and cache canonical selection; publish no images."""
    if not (CACHE / "train.zip").exists():
        _space(CACHE, 2 * EXPECTED_SIZE + PUBLISHED_LIMIT)  # Source + .part + assets.
    sample_io.download(
        SOURCE_URL,
        CACHE / "train.zip",
        expected_size=EXPECTED_SIZE,
        max_bytes=EXPECTED_SIZE,
        sha256=EXPECTED_SHA256,
    )
    selection, _ = _expected()
    data = _json(selection)
    if len(data) > SELECTION_LIMIT:
        raise ValueError("Selection exceeds 1 MiB")
    _space(CACHE, _preflight(CACHE / "selection.json", _metadata(data)))
    sample_io.write_new(CACHE / "selection.json", data)
    return selection


def stage_class(label: str) -> dict:
    """Stage exactly one class's 20 raw originals, never a manifest."""
    if label not in LABELS:
        raise ValueError("Unknown class")
    _notices()
    selection, payloads = _verified_selection()
    images = [image for image in selection["images"] if image["label"] == label]
    expected = {
        Path(image["path"]).name: _metadata(payloads[image["path"]]) for image in images
    }
    root = ASSETS_ROOT / "images" / label
    current = _inventory(root)
    if any(expected.get(path) != metadata for path, metadata in current.items()):
        raise ValueError("Unexpected or modified class inventory")
    additional = sum(
        _preflight(ASSETS_ROOT / image["path"], expected[Path(image["path"]).name])
        for image in images
    )  # Check ALL existing targets before writing even the first missing file.
    _budget(additional)
    _space(root, additional)
    for image in images:
        sample_io.write_new(ASSETS_ROOT / image["path"], payloads[image["path"]])
    if _inventory(root) != expected:
        raise ValueError("Incomplete class inventory; no manifest created")
    return {**selection, "images": images}


def build_manifest() -> dict:
    """After three separate parent reviews, verify all bytes and publish manifest."""
    files = _notices()
    selection, _ = _verified_selection()
    expected = {
        image["path"].removeprefix("images/"): {
            key: image[key] for key in ("byteSize", "sha256")
        }
        for image in selection["images"]
    }
    if _inventory(ASSETS_ROOT / "images") != expected:
        raise ValueError("Manifest requires exactly all 60 unmodified images")
    manifest = {
        "schemaVersion": 1,
        "sampleVersion": 1,
        "id": "beans",
        "taskType": "classification",
        "sourceSplit": "train",
        "source": selection["source"],
        "licenses": {"images": "MIT", "annotations": "MIT"},
        "images": selection["images"],
        "files": files,
    }
    data, path = _json(manifest), ASSETS_ROOT / "manifest.json"
    additional = _preflight(path, _metadata(data))
    _budget(additional)  # Includes both datasets, all files and this manifest once.
    _space(ASSETS_ROOT, additional)
    sample_io.write_new(path, data)
    return manifest


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise ValueError("Invalid command or class")


def main(argv: list[str] | None = None) -> int:
    try:
        parser = _Parser(add_help=False, allow_abbrev=False)
        commands = parser.add_subparsers(dest="command", required=True)
        commands.add_parser("select", add_help=False)
        stage = commands.add_parser("stage", add_help=False)
        stage.add_argument("label", choices=LABELS)
        commands.add_parser("manifest", add_help=False)
        arguments = parser.parse_args(argv)
        if arguments.command == "select":
            result = prepare_selection()
        elif arguments.command == "stage":
            result = stage_class(arguments.label)
        else:
            result = build_manifest()
        summary = {
            "command": arguments.command,
            "imageCount": len(result["images"]),
            "imageBytes": sum(image["byteSize"] for image in result["images"]),
            "archiveBytes": result["source"]["byteSize"],
            "archiveSha256": result["source"]["sha256"],
        }
        if "sourceCounts" in result:
            summary["sourceCounts"] = result["sourceCounts"]
        print(json.dumps(summary, sort_keys=True))
        return 0
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError) as error:
        print(json.dumps({"error": type(error).__name__}))  # Never echo paths/URLs.
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
