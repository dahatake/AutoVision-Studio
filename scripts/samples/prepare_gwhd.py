"""Explicit, developer-only DATA-04 preparation of 20 GWHD 2021 train images.

select acquires only the bounded index and hash-pinned CSV; pilot records one
fully decoded source image's raw bytes in the cache; stage requires that proof
before acquiring the rest. Upstream ``.png`` names are provenance and do not
override detected JPEG/PNG content. Finalize LICENSE.txt/ATTRIBUTION.txt before
stage. Existing outputs are never replaced. All acquisition/accounting belongs
to sample_io.

The bounded decoder validates every chunk CRC, the complete zlib stream and all
filtered scanlines. It is NOT the normal DAT-03/DAT-05 importer, DATA-05 review,
or a Gate 1 pass. The parent must run tests/review before explicitly invoking
pilot and must review the pilot before explicitly invoking stage. No eval or
training, archive access, resizing, metadata rewriting, or import-time I/O.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import shutil
import struct
import warnings
import zlib
from pathlib import Path

import sample_io
from PIL import Image, UnidentifiedImageError

ROOT = Path(__file__).resolve().parents[2]
CACHEDIR = sample_io.CACHE_ROOT / "gwhd-2021"
ASSETSROOT = ROOT / "resources" / "samples" / "gwhd-2021"
METAURL = "https://zenodo.org/api/records/5092309/files/gwhd_2021.zip/container"
CSVURL = METAURL + "/gwhd_2021/competition_train.csv"
CSV_SIZE = 2841482
CSV_SHA256 = "1af1d8e386643afe8cd1b41d89ca2634d3212908bdbe58a9d7cd5b32e4048176"
KNOWN_SOURCE_CONFLICT_LINES = {
    "1961bcf453d5b2206c428c1c14fe55d1f26f3c655db0a2b6a83094476e8edb5b": (
        2001,
        2081,
    ),
    "d88963636d49127bda0597ef73f1703e92d6f111caefc44902d5932b8cd3fa94": (
        1988,
        2072,
    ),
}
INDEX_LIMIT = 2 * 1024 * 1024
ASSET_LIMIT = 96 * 1024 * 1024
SELECTION_LIMIT = 16 * 1024 * 1024
PILOT_LIMIT = 4096
IMAGE_COUNT = 20
IMAGE_CHECK = (
    "Pillow 12.3.0 verify plus full pixel load at 1024x1024; "
    "PNG also checks every chunk/CRC/zlib/scanline; normal DAT-03/DAT-05 import not run"
)
FORMAT_EXTENSION = {"jpeg": "jpg", "png": "png"}


def _encode(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
        + "\n"
    ).encode("utf-8")


def _byte_metadata(raw: bytes) -> dict:
    return {"byteSize": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def _unique(pairs: list[tuple[str, object]]) -> dict:
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ValueError("Duplicate JSON key")
    return result


def _nonfinite(_: str) -> None:
    raise ValueError("Nonfinite JSON number")


def _json(raw: bytes, limit: int) -> dict:
    if not 0 < len(raw) <= limit:
        raise ValueError("JSON byte limit exceeded or empty JSON")
    try:
        value = json.loads(
            raw.decode("utf-8"), object_pairs_hook=_unique, parse_constant=_nonfinite
        )
    except (ValueError, RecursionError):
        raise ValueError("Invalid or duplicate-key JSON") from None
    if not isinstance(value, dict):
        raise ValueError(  # noqa: TRY004 -- Invalid external JSON value.
            "Expected a JSON object"
        )
    return value


def _read(path: Path, limit: int, pin: dict | None = None) -> tuple[bytes, dict]:
    metadata = sample_io.file_metadata(path)
    size = metadata["byteSize"]
    if type(size) is not int or not 0 < size <= limit:
        raise ValueError("Cached file is empty or exceeds its byte limit")
    if pin is not None and metadata != pin:
        raise ValueError("Cached file size/hash differs from frozen evidence")
    with path.open("rb") as source:
        raw = source.read(limit + 1)
    if _byte_metadata(raw) != metadata:
        raise ValueError("Cached file changed while reading")
    return raw, metadata


def _optional_metadata(path: Path) -> dict | None:
    try:
        return sample_io.file_metadata(path)
    except FileNotFoundError:
        return None


def _hex_id(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def _uint(text: str) -> int:
    if not text or not text.isascii() or not text.isdecimal():
        raise ValueError("CSV requires unsigned decimal integers")
    try:
        return int(text)
    except ValueError:
        raise ValueError("CSV integer is too large") from None


def _boxes(text: str) -> list[list[int]]:
    if text == "no_box":
        return []
    boxes = []
    for part in text.split(";"):
        tokens = part.split()
        if len(tokens) != 4:
            raise ValueError("BoxesString requires four integers per box or no_box")
        xmin, ymin, xmax, ymax = [_uint(token) for token in tokens]
        if not (0 <= xmin < xmax <= 1024 and 0 <= ymin < ymax <= 1024):
            raise ValueError("CSV box must have positive size within 1024x1024")
        boxes.append([xmin, ymin, xmax, ymax])
    return boxes


def _parse_csv_rows(raw: bytes) -> list[tuple[dict, int]]:
    """Validate every train row and preserve its one-based source line."""
    if not 0 < len(raw) <= CSV_SIZE:
        raise ValueError("Train CSV is empty or exceeds its byte limit")
    rows = []
    try:
        reader = csv.reader(io.StringIO(raw.decode("utf-8"), newline=""), strict=True)
        if next(reader, None) != ["image_name", "BoxesString", "domain"]:
            raise ValueError("Unexpected train CSV header")
        for row in reader:
            if len(row) != 3:
                raise ValueError("Invalid train CSV row or image ID")
            raw_label = row[0]
            if not raw_label.endswith(".png") or not _hex_id(raw_label[:-4]):
                raise ValueError("Invalid train CSV row or image ID")
            source_id = raw_label[:-4]
            domain = row[2]
            # Match the manifest's JS length/trim, keeping the original name.
            if (
                not 1 <= len(domain.encode("utf-16-le")) // 2 <= 128
                or not domain.strip(
                    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004"
                    "\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f"
                    "\u3000\ufeff"
                )
                or any(
                    ord(character) < 32 or ord(character) == 127 for character in domain
                )
            ):
                raise ValueError("Invalid CSV domain provenance name")
            rows.append(
                (
                    {
                        "sourceId": source_id,
                        "domain": domain,
                        "boxes": _boxes(row[1]),
                    },
                    reader.line_num,
                )
            )
    except (UnicodeError, csv.Error):
        raise ValueError("Invalid UTF-8 train CSV syntax") from None
    return rows


def parse_csv(raw: bytes) -> list[dict]:
    """Strict public parser: duplicate IDs are invalid without selection scope."""
    parsed = _parse_csv_rows(raw)
    source_ids = [row["sourceId"] for row, _ in parsed]
    if len(source_ids) != len(set(source_ids)):
        raise ValueError("Duplicate train CSV image ID")
    return [row for row, _ in parsed]


def _selection_rows(raw: bytes) -> tuple[list[dict], int, int, list[dict]]:
    """Apply the fixed-source, selected-subset duplicate policy."""
    if hashlib.sha256(raw).hexdigest() != CSV_SHA256:
        raise ValueError("Train CSV SHA-256 differs from the fixed source evidence")
    parsed = _parse_csv_rows(raw)
    grouped: dict[str, list[tuple[dict, int]]] = {}
    for row, line_number in parsed:
        grouped.setdefault(row["sourceId"], []).append((row, line_number))
    if len(grouped) < IMAGE_COUNT:
        raise ValueError("Train CSV has fewer than 20 unique images")

    # Freeze candidates from all unique IDs before applying the conflict policy.
    selected_ids = sorted(grouped)[:IMAGE_COUNT]
    if any(len(grouped[source_id]) != 1 for source_id in selected_ids):
        raise ValueError("Selected train CSV image ID is duplicated")
    conflicts = {
        source_id: tuple(line for _, line in occurrences)
        for source_id, occurrences in grouped.items()
        if len(occurrences) > 1
    }
    if conflicts != KNOWN_SOURCE_CONFLICT_LINES:
        raise ValueError("Train CSV duplicate set differs from fixed source evidence")
    warnings = [
        {
            "code": "KNOWN_SOURCE_CONFLICT_OUTSIDE_SELECTION",
            "sourceId": source_id,
            "lineNumbers": list(conflicts[source_id]),
        }
        for source_id in sorted(conflicts)
    ]
    return (
        [grouped[source_id][0][0] for source_id in selected_ids],
        len(parsed),
        len(grouped),
        warnings,
    )


def _image_url(image: dict) -> str:
    return METAURL + "/gwhd_2021/images/" + image["sourceId"] + ".png"


def _image_cache(image: dict) -> Path:
    return CACHEDIR / "images" / (image["sourceId"] + ".png")


def _derive_selection() -> dict:
    csv_raw, csv_metadata = _read(CACHEDIR / "competition_train.csv", CSV_SIZE)
    if csv_metadata["byteSize"] != CSV_SIZE:
        raise ValueError("Train CSV differs from its declared byte size")
    index_raw, index_metadata = _read(CACHEDIR / "index.json", INDEX_LIMIT)
    rows, train_row_count, unique_image_count, warnings = _selection_rows(csv_raw)
    index = _json(index_raw, INDEX_LIMIT)
    entries = index.get("entries")
    if not isinstance(entries, list):
        raise ValueError(  # noqa: TRY004 -- Invalid external JSON value.
            "File index requires an entries array"
        )
    by_key, seen = {}, set()
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("key"), str):
            raise ValueError(  # noqa: TRY004 -- Invalid external JSON value.
                "Invalid file index entry"
            )
        key = entry["key"]
        if not key or key.casefold() in seen:
            raise ValueError("Duplicate or empty file index key")
        seen.add(key.casefold())
        by_key[key] = entry
    images = []
    # Never use preview order, total, or truncated as the train population.
    for row in rows:
        key = "gwhd_2021/images/" + row["sourceId"] + ".png"
        entry = by_key.get(key)
        if entry is None:
            raise ValueError("Selected train ID is absent from the bounded index; stop")
        size, links = entry.get("size"), entry.get("links")
        if type(size) is not int or not 0 < size <= ASSET_LIMIT:
            raise ValueError("Selected PNG requires a positive bounded integer size")
        if not isinstance(links, dict) or links.get("content") != _image_url(row):
            raise ValueError("Selected PNG content URL differs from the fixed source")
        images.append({**row, "byteSize": size})
    if sum(image["byteSize"] for image in images) > ASSET_LIMIT:
        raise ValueError("Selected PNG sizes exceed the combined asset limit")
    return {
        "schemaVersion": 1,
        "sourceSplit": "train",
        "sources": {
            "csv": {"url": CSVURL, **csv_metadata},
            "index": {"url": METAURL, **index_metadata},
        },
        "trainRowCount": train_row_count,
        "uniqueImageCount": unique_image_count,
        "sourceWarnings": warnings,
        "images": images,
    }


def _cached_sources() -> None:
    """Verify existing sources against their original acquisition observations."""
    csv_path = CACHEDIR / "competition_train.csv"
    index_path = CACHEDIR / "index.json"
    # Read BOTH regular files before either helper call could GET a missing file.
    # Roots are trusted; hostile concurrent directory mutation is out of scope.
    _, csv_metadata = _read(csv_path, CSV_SIZE)
    _, index_metadata = _read(index_path, INDEX_LIMIT)
    for url, path, size, limit, observed in (
        (CSVURL, csv_path, CSV_SIZE, CSV_SIZE, csv_metadata),
        (METAURL, index_path, None, INDEX_LIMIT, index_metadata),
    ):
        verified = sample_io.download(
            url,
            path,
            expected_size=size,
            max_bytes=limit,
            sha256=None,
        )
        if verified != observed:
            raise ValueError("Cached source changed during ledger verification")


def _load_selection() -> dict:
    raw, _ = _read(CACHEDIR / "selection.json", SELECTION_LIMIT)
    _json(raw, SELECTION_LIMIT)
    _cached_sources()
    expected = _derive_selection()  # Offline, after source-to-ledger verification.
    if raw != _encode(expected):
        raise ValueError("Frozen selection does not match the cached CSV/index")
    return expected


def _paeth(left: int, above: int, upper_left: int) -> int:
    estimate = left + above - upper_left
    left_distance = abs(estimate - left)
    above_distance = abs(estimate - above)
    upper_left_distance = abs(estimate - upper_left)
    if left_distance <= above_distance and left_distance <= upper_left_distance:
        return left
    return above if above_distance <= upper_left_distance else upper_left


def _pass_sizes(width: int, height: int, bits_per_pixel: int, interlace: int):
    if interlace == 0:
        yield width, height, (width * bits_per_pixel + 7) // 8
        return
    for start_x, start_y, step_x, step_y in (
        (0, 0, 8, 8),
        (4, 0, 8, 8),
        (0, 4, 4, 8),
        (2, 0, 4, 4),
        (0, 2, 2, 4),
        (1, 0, 2, 2),
        (0, 1, 1, 2),
    ):
        pass_width = max(0, (width - start_x + step_x - 1) // step_x)
        pass_height = max(0, (height - start_y + step_y - 1) // step_y)
        if pass_width and pass_height:
            yield pass_width, pass_height, (pass_width * bits_per_pixel + 7) // 8


def _validate_palette_indexes(
    row: bytearray, width: int, depth: int, palette_entries: int
) -> None:
    mask = (1 << depth) - 1
    for pixel in range(width):
        bit_offset = pixel * depth
        shift = 8 - depth - (bit_offset % 8)
        if ((row[bit_offset // 8] >> shift) & mask) >= palette_entries:
            raise ValueError("PNG palette index is outside PLTE")


def _decode_png(raw: bytes) -> None:
    """Bounded full PNG chunk/zlib/filter decode without pixel conversion."""
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Invalid PNG signature")
    offset, chunk_types, idat, idat_ended = 8, [], [], False
    ihdr = None
    palette_entries = None
    while offset < len(raw):
        if offset + 12 > len(raw):
            raise ValueError("Truncated PNG chunk")
        length = struct.unpack(">I", raw[offset : offset + 4])[0]
        chunk_type = raw[offset + 4 : offset + 8]
        end = offset + 12 + length
        if length > ASSET_LIMIT or end > len(raw):
            raise ValueError("PNG chunk exceeds the bounded file")
        data = raw[offset + 8 : offset + 8 + length]
        expected_crc = struct.unpack(">I", raw[offset + 8 + length : end])[0]
        if zlib.crc32(chunk_type + data) != expected_crc:
            raise ValueError("PNG chunk CRC mismatch")
        if len(chunk_type) != 4 or not all(
            65 <= value <= 90 or 97 <= value <= 122 for value in chunk_type
        ):
            raise ValueError("Invalid PNG chunk type")
        if chunk_type[2] & 32:
            raise ValueError("Invalid PNG chunk reserved bit")
        if not chunk_types and chunk_type != b"IHDR":
            raise ValueError("PNG IHDR must be first")
        if chunk_type == b"IHDR":
            if ihdr is not None or length != 13:
                raise ValueError("PNG requires one 13-byte IHDR")
            ihdr = data
        elif chunk_type == b"PLTE":
            if palette_entries is not None or idat or length == 0 or length % 3:
                raise ValueError("Invalid PNG palette")
            palette_entries = length // 3
            if palette_entries > 256:
                raise ValueError("PNG palette is too large")
        elif chunk_type == b"IDAT":
            if idat_ended:
                raise ValueError("PNG IDAT chunks must be contiguous")
            idat.append(data)
        elif chunk_type == b"IEND":
            if length != 0 or not idat:
                raise ValueError("Invalid PNG IEND")
            chunk_types.append(chunk_type)
            offset = end
            if offset != len(raw):
                raise ValueError("PNG contains bytes after IEND")
            break
        else:
            if idat:
                idat_ended = True
            if chunk_type[0] & 32 == 0:
                raise ValueError("Unsupported critical PNG chunk")
        chunk_types.append(chunk_type)
        offset = end
    if ihdr is None or not chunk_types or chunk_types[-1] != b"IEND":
        raise ValueError("PNG is missing IHDR or IEND")

    width, height, depth, color, compression, filtering, interlace = struct.unpack(
        ">IIBBBBB", ihdr
    )
    depths = {
        0: {1, 2, 4, 8, 16},
        2: {8, 16},
        3: {1, 2, 4, 8},
        4: {8, 16},
        6: {8, 16},
    }
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
    if (
        (width, height) != (1024, 1024)
        or depth not in depths.get(color, set())
        or compression != 0
        or filtering != 0
        or interlace not in (0, 1)
        or (color == 3 and (palette_entries is None or palette_entries > 2**depth))
        or (color in (0, 4) and palette_entries is not None)
    ):
        raise ValueError("Invalid PNG IHDR dimensions or fields")

    bits_per_pixel = channels[color] * depth
    passes = list(_pass_sizes(width, height, bits_per_pixel, interlace))
    expected_size = sum((row_bytes + 1) * rows for _, rows, row_bytes in passes)
    decoder = zlib.decompressobj()
    try:
        decoded = decoder.decompress(b"".join(idat), expected_size + 1)
    except zlib.error:
        raise ValueError("Invalid PNG zlib stream") from None
    if (
        len(decoded) != expected_size
        or not decoder.eof
        or decoder.unconsumed_tail
        or decoder.unused_data
    ):
        raise ValueError("PNG decompressed scanline size differs")

    cursor = 0
    bytes_per_pixel = max(1, (bits_per_pixel + 7) // 8)
    for pass_width, rows, row_bytes in passes:
        previous = bytearray(row_bytes)
        for _ in range(rows):
            filter_type = decoded[cursor]
            cursor += 1
            source = decoded[cursor : cursor + row_bytes]
            cursor += row_bytes
            if filter_type > 4:
                raise ValueError("Invalid PNG scanline filter")
            reconstructed = bytearray(row_bytes)
            for index, value in enumerate(source):
                left = (
                    reconstructed[index - bytes_per_pixel]
                    if index >= bytes_per_pixel
                    else 0
                )
                above = previous[index]
                upper_left = (
                    previous[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
                )
                if filter_type == 0:
                    predictor = 0
                elif filter_type == 1:
                    predictor = left
                elif filter_type == 2:
                    predictor = above
                elif filter_type == 3:
                    predictor = (left + above) // 2
                else:
                    predictor = _paeth(left, above, upper_left)
                reconstructed[index] = (value + predictor) & 0xFF
            if color == 3:
                _validate_palette_indexes(
                    reconstructed, pass_width, depth, palette_entries
                )
            previous = reconstructed
    if cursor != len(decoded):
        raise ValueError("PNG scanline decoder did not consume all bytes")


def _image(path: Path, expected_size: int) -> dict:
    """Verify raw bytes and fully decode one bounded JPEG or PNG image."""
    metadata = sample_io.file_metadata(path)
    if not 33 <= expected_size <= ASSET_LIMIT or metadata["byteSize"] != expected_size:
        raise ValueError("Image byte size differs from the selected index entry")
    raw, observed = _read(path, expected_size, metadata)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                detected_format = image.format
                dimensions = image.size
                frames = getattr(image, "n_frames", 1)
                image.verify()
            with Image.open(io.BytesIO(raw)) as image:
                if (
                    image.format != detected_format
                    or image.size != dimensions
                    or getattr(image, "n_frames", 1) != frames
                ):
                    raise ValueError(
                        "Image identity changed between verification passes"
                    )
                image.load()
    except (
        OSError,
        SyntaxError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise ValueError("Invalid or unsupported image payload") from None
    if dimensions != (1024, 1024) or frames != 1:
        raise ValueError("Image must be one 1024x1024 frame")
    if detected_format not in {"JPEG", "PNG"}:
        raise ValueError("Image format must be JPEG or PNG")
    detected = detected_format.lower()
    if detected == "png":
        _decode_png(raw)
    if observed != metadata:
        raise ValueError("Image changed while decoding")
    return {**metadata, "detectedFormat": detected}


def _published_filename(image: dict, metadata: dict) -> str:
    detected = metadata.get("detectedFormat")
    if detected not in FORMAT_EXTENSION:
        raise ValueError("Image detected format is missing or unsupported")
    return image["sourceId"] + "." + FORMAT_EXTENSION[detected]


def _pilot_document(selection: dict, metadata: dict) -> dict:
    first = selection["images"][0]
    return {
        "schemaVersion": 1,
        "sourceId": first["sourceId"],
        "sourceFilename": first["sourceId"] + ".png",
        "publishedFilename": _published_filename(first, metadata),
        **metadata,
        "csvSha256": selection["sources"]["csv"]["sha256"],
        "indexSha256": selection["sources"]["index"]["sha256"],
        "selectionSha256": _byte_metadata(_encode(selection))["sha256"],
        "boxCount": len(first["boxes"]),
        "boxesSha256": _byte_metadata(_encode(first["boxes"]))["sha256"],
        "imageCheck": IMAGE_CHECK,
    }


def _load_pilot(selection: dict) -> dict:
    raw, _ = _read(CACHEDIR / "pilot.json", PILOT_LIMIT)
    _json(raw, PILOT_LIMIT)
    first = selection["images"][0]
    expected = _pilot_document(
        selection, _image(_image_cache(first), first["byteSize"])
    )
    if raw != _encode(expected):
        raise ValueError("Pilot proof does not match the selection and observed image")
    return expected


def build_coco(selection: dict, image_metadata: list[dict] | None = None) -> dict:
    """Keep all source boxes, with continuous xyxy -> xywh (never +1)."""
    if image_metadata is None:
        image_metadata = [{"detectedFormat": "png"}] * len(selection["images"])
    if len(image_metadata) != len(selection["images"]):
        raise ValueError("COCO requires one format observation per selected image")
    images, annotations = [], []
    for image_id, (image, metadata) in enumerate(
        zip(selection["images"], image_metadata, strict=True), 1
    ):
        images.append(
            {
                "id": image_id,
                "file_name": _published_filename(image, metadata),
                "width": 1024,
                "height": 1024,
            }
        )
        for xmin, ymin, xmax, ymax in image["boxes"]:
            width, height = xmax - xmin, ymax - ymin
            annotations.append(
                {
                    "id": len(annotations) + 1,
                    "image_id": image_id,
                    "category_id": 1,
                    "bbox": [xmin, ymin, width, height],
                    "area": width * height,
                    "iscrowd": 0,
                }
            )
    return {
        "info": {
            "version": "1.0",
            "description": (
                "Global Wheat Head Dataset 2021 v1.0, fixed 20-image train subset; "
                "original image bytes and every source box; source .png names are "
                "preserved in the manifest while published extensions match detected "
                "JPEG/PNG content; CSV xyxy to COCO xywh without +1, filtering, "
                "resizing, or re-encoding. " + IMAGE_CHECK
            ),
        },
        "images": images,
        "annotations": annotations,
        "categories": [{"id": 1, "name": "wheat_head"}],
    }


def _notice_files(coco: bytes) -> list[dict]:
    files = []
    for name in ("LICENSE.txt", "ATTRIBUTION.txt"):
        metadata = sample_io.file_metadata(ASSETSROOT / name)
        if not 0 < metadata["byteSize"] <= ASSET_LIMIT:
            raise ValueError("Required notice is empty or exceeds the asset limit")
        files.append({"path": name, **metadata})
    files.append({"path": "annotations.coco.json", **_byte_metadata(coco)})
    return files


def _manifest_document(
    selection: dict, metadata: list[dict], files: list[dict]
) -> dict:
    return {
        "schemaVersion": 1,
        "sampleVersion": 1,
        "sourceSplit": "train",
        "id": "gwhd-2021",
        "taskType": "detection",
        "source": {
            "dataset": "Global Wheat Head Dataset 2021",
            "version": "1.0",
            "url": CSVURL,
            "byteSize": CSV_SIZE,
            "sha256": selection["sources"]["csv"]["sha256"],
        },
        "licenses": {"images": "CC-BY-4.0", "annotations": "CC-BY-4.0"},
        "images": [
            {
                "path": "images/" + _published_filename(image, observed),
                "sourceId": image["sourceId"],
                "sourceFilename": image["sourceId"] + ".png",
                "detectedFormat": observed["detectedFormat"],
                "domain": image["domain"],
                "byteSize": observed["byteSize"],
                "sha256": observed["sha256"],
            }
            for image, observed in zip(selection["images"], metadata, strict=True)
        ],
        "files": files,
    }


def build_manifest(selection: dict, image_metadata: list[dict]) -> dict:
    """Build the exact sample.ts shape from observed hashes and current notices.

    Does not write anything. Call after notice finalization, with file_metadata
    results for the 20 validated cache images in frozen selection order.
    """
    if _encode(selection) != _encode(_load_selection()):
        raise ValueError("Manifest selection differs from the frozen source")
    if len(image_metadata) != IMAGE_COUNT:
        raise ValueError("Manifest requires 20 observed images")
    seen = set()
    for image, metadata in zip(selection["images"], image_metadata, strict=True):
        if (
            set(metadata) != {"byteSize", "sha256", "detectedFormat"}
            or type(metadata["byteSize"]) is not int
            or metadata["byteSize"] != image["byteSize"]
            or not _hex_id(metadata["sha256"])
            or metadata["detectedFormat"] not in FORMAT_EXTENSION
        ):
            raise ValueError("Manifest image metadata differs from the selection")
        if metadata["sha256"] in seen:
            raise ValueError("Duplicate observed image SHA-256")
        seen.add(metadata["sha256"])
        if metadata != _image(_image_cache(image), image["byteSize"]):
            raise ValueError("Manifest metadata must come from the actual cached image")
    return _manifest_document(
        selection,
        image_metadata,
        _notice_files(_encode(build_coco(selection, image_metadata))),
    )


def _require_free(location: Path, new_bytes: int) -> None:
    if new_bytes == 0:
        return
    ancestor = location
    while not ancestor.exists():
        ancestor = ancestor.parent
    required = (new_bytes * 6 + 4) // 5  # Ceiling, including 20% temporary margin.
    if shutil.disk_usage(ancestor).free < required:
        raise ValueError("Insufficient free space including the 20% temporary margin")


def _resource_files() -> dict[Path, dict]:
    root = ASSETSROOT.parent  # Count BOTH datasets, notices, JSON, and any other files.
    if not root.exists():
        return {}
    pending, files = [root], {}
    while pending:
        directory = pending.pop()
        if directory.is_symlink() or directory.is_junction():
            raise ValueError("Linked sample asset directories are forbidden")
        for child in directory.iterdir():
            if child.is_symlink() or child.is_junction():
                raise ValueError("Linked sample assets are forbidden")
            if child.is_dir():
                pending.append(child)
            else:
                metadata = sample_io.file_metadata(child)
                if not 0 < metadata["byteSize"] <= ASSET_LIMIT:
                    raise ValueError("Existing sample asset is empty or too large")
                files[child] = metadata
    return files


def _preflight(
    selection: dict,
    image_metadata: list[dict] | None = None,
    extra_cache_bytes: int = 0,
) -> None:
    if image_metadata is None:
        image_metadata = [{"detectedFormat": "png"}] * IMAGE_COUNT
    coco = _encode(build_coco(selection, image_metadata))
    # Size calculation ONLY: empty hash strings are never published as evidence.
    # Every eventual lowercase SHA-256 occupies exactly 64 additional UTF-8 bytes.
    sizes_only = [
        {
            "byteSize": image["byteSize"],
            "sha256": "",
            "detectedFormat": metadata["detectedFormat"],
        }
        for image, metadata in zip(selection["images"], image_metadata, strict=True)
    ]
    manifest_size = len(
        _encode(_manifest_document(selection, sizes_only, _notice_files(coco)))
    )
    manifest_size += 64 * IMAGE_COUNT
    planned = {
        ASSETSROOT / "images" / _published_filename(image, metadata): image["byteSize"]
        for image, metadata in zip(selection["images"], image_metadata, strict=True)
    }
    planned[ASSETSROOT / "annotations.coco.json"] = len(coco)
    planned[ASSETSROOT / "manifest.json"] = manifest_size
    allowed = set(planned) | {
        ASSETSROOT / "LICENSE.txt",
        ASSETSROOT / "ATTRIBUTION.txt",
    }
    existing = _resource_files()
    for path, metadata in existing.items():
        if path.is_relative_to(ASSETSROOT) and path not in allowed:
            raise ValueError("Unexpected file in GWHD assets; nothing will be removed")
        if path in planned and metadata["byteSize"] != planned[path]:
            raise FileExistsError("Existing GWHD asset has a different byte size")
    old_coco = existing.get(ASSETSROOT / "annotations.coco.json")
    if old_coco is not None and old_coco != _byte_metadata(coco):
        raise FileExistsError("Existing COCO annotations differ")
    missing_assets = sum(size for path, size in planned.items() if path not in existing)
    if (
        sum(metadata["byteSize"] for metadata in existing.values()) + missing_assets
        > ASSET_LIMIT
    ):
        raise ValueError(
            "Combined sample assets, including JSON/notices, exceed 96 MiB"
        )
    missing_cache = 0
    for image in selection["images"]:
        cached = _optional_metadata(_image_cache(image))
        if cached is None:
            missing_cache += image["byteSize"]
        elif cached["byteSize"] != image["byteSize"]:
            raise ValueError("Cached image size differs from the frozen index")
    required = missing_cache + missing_assets + extra_cache_bytes
    _require_free(CACHEDIR, required)
    _require_free(ASSETSROOT, required)


def _acquire_image(image: dict, sha256: str | None = None) -> dict:
    path = _image_cache(image)
    acquired = sample_io.download(
        _image_url(image),
        path,
        expected_size=image["byteSize"],
        max_bytes=image["byteSize"],
        sha256=sha256,
    )
    observed = _image(path, image["byteSize"])
    if acquired != observed and acquired != {
        "byteSize": observed["byteSize"],
        "sha256": observed["sha256"],
    }:
        raise ValueError("Image changed after acquisition")
    return observed


def select() -> dict:
    """Acquire index then train CSV through the shared ledger; never GET a PNG."""
    _require_free(CACHEDIR, INDEX_LIMIT + CSV_SIZE + SELECTION_LIMIT)
    index_metadata = sample_io.download(
        METAURL,
        CACHEDIR / "index.json",
        expected_size=None,
        max_bytes=INDEX_LIMIT,
        sha256=None,
    )
    csv_metadata = sample_io.download(
        CSVURL,
        CACHEDIR / "competition_train.csv",
        expected_size=CSV_SIZE,
        max_bytes=CSV_SIZE,
        sha256=None,
    )
    selection = _derive_selection()
    if selection["sources"]["csv"] != {"url": CSVURL, **csv_metadata} or selection[
        "sources"
    ]["index"] != {"url": METAURL, **index_metadata}:
        raise ValueError("Sources changed after acquisition")
    payload = _encode(selection)
    if len(payload) > SELECTION_LIMIT:
        raise ValueError("Selection JSON exceeds its byte limit")
    sample_io.write_new(CACHEDIR / "selection.json", payload)
    return selection


def pilot() -> dict:
    """Acquire and fully decode only the first frozen source image outside resources."""
    selection = _load_selection()
    previous = None
    if _optional_metadata(CACHEDIR / "pilot.json") is not None:
        previous = _load_pilot(selection)
    _preflight(
        selection,
        extra_cache_bytes=PILOT_LIMIT if previous is None else 0,
    )
    first = selection["images"][0]
    metadata = _acquire_image(first, None if previous is None else previous["sha256"])
    if _encode(_load_selection()) != _encode(selection):
        raise ValueError("Selection changed during pilot acquisition")
    proof = _pilot_document(selection, metadata)
    sample_io.write_new(CACHEDIR / "pilot.json", _encode(proof))
    return proof


def stage() -> dict:
    """Require reviewed pilot; acquire remaining images, then publish without replacement."""
    selection = _load_selection()
    proof = _load_pilot(selection)
    pilot_metadata = {
        "byteSize": proof["byteSize"],
        "sha256": proof["sha256"],
        "detectedFormat": proof["detectedFormat"],
    }
    projected_metadata = [
        pilot_metadata
        if image["sourceId"] == proof["sourceId"]
        else {"detectedFormat": "png"}
        for image in selection["images"]
    ]
    _preflight(selection, projected_metadata)
    cached, missing = [], []
    for image in selection["images"]:
        (missing if _optional_metadata(_image_cache(image)) is None else cached).append(
            image
        )
    observed, hashes = {}, set()
    # Validate every already-present cache through the helper BEFORE any new GET.
    # The pilot is present and pinned, so its helper call performs offline reuse.
    for image in cached + missing:
        pin = proof["sha256"] if image["sourceId"] == proof["sourceId"] else None
        metadata = _acquire_image(image, pin)
        if metadata["sha256"] in hashes:
            raise ValueError("Duplicate observed image SHA-256")
        hashes.add(metadata["sha256"])
        observed[image["sourceId"]] = metadata
    if (
        _encode(_load_selection()) != _encode(selection)
        or _load_pilot(selection) != proof
    ):
        raise ValueError("Source or pilot proof changed during staging")
    image_metadata = [observed[image["sourceId"]] for image in selection["images"]]
    manifest = build_manifest(selection, image_metadata)
    coco_raw = _encode(build_coco(selection, image_metadata))
    manifest_raw = _encode(manifest)
    _preflight(
        selection, image_metadata
    )  # Recount current notices/other dataset before publication.
    expected = {
        ASSETSROOT
        / "images"
        / _published_filename(image, observed[image["sourceId"]]): {
            "byteSize": observed[image["sourceId"]]["byteSize"],
            "sha256": observed[image["sourceId"]]["sha256"],
        }
        for image in selection["images"]
    }
    expected[ASSETSROOT / "annotations.coco.json"] = _byte_metadata(coco_raw)
    expected[ASSETSROOT / "manifest.json"] = _byte_metadata(manifest_raw)
    for path, metadata in expected.items():
        existing = _optional_metadata(path)
        if existing is not None and existing != metadata:
            raise FileExistsError("Existing GWHD asset bytes differ")
    for image in selection["images"]:
        metadata = observed[image["sourceId"]]
        raw, _ = _read(
            _image_cache(image),
            image["byteSize"],
            {"byteSize": metadata["byteSize"], "sha256": metadata["sha256"]},
        )
        sample_io.write_new(
            ASSETSROOT / "images" / _published_filename(image, metadata), raw
        )
    sample_io.write_new(ASSETSROOT / "annotations.coco.json", coco_raw)
    sample_io.write_new(ASSETSROOT / "manifest.json", manifest_raw)
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("select", "pilot", "stage"))
    args = parser.parse_args(argv)
    try:
        if args.command == "select":
            selection = select()
            print(
                f"select: 20 train IDs frozen from {selection['trainRowCount']} CSV rows; "
                f"source warnings={len(selection['sourceWarnings'])}; no PNG GET"
            )
        elif args.command == "pilot":
            proof = pilot()
            print(
                f"pilot: {proof['sourceId']}, boxes={proof['boxCount']}; {IMAGE_CHECK}"
            )
        else:
            stage()
            print(
                "stage: 20 original image byte streams, COCO and manifest; "
                + IMAGE_CHECK
            )
    except ValueError as error:
        parser.exit(1, "GWHD preparation stopped: " + str(error) + "\n")
    except OSError:
        parser.exit(
            1, "GWHD preparation stopped: missing/conflicting files or I/O failure\n"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
