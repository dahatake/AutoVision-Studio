"""DAT-03: bounded, read-only decoding of DAT-02 candidates.

FR-DAT-003/004, FR-SEC-008, FR-ANN-204: metadata dimensions and orientation
describe the RAW original; consumer pixels are oriented once, never resized.
FR-SEC-003: runtime filesystem sources are local Windows drives only;
structural UNC acceptance grants no filesystem access.
No manifest, source, annotation, ID, model, or CLI writes occur here.
"""

from __future__ import annotations

import hashlib
import os
import stat
import struct
import warnings
import zlib
from collections.abc import Generator
from contextlib import closing, contextmanager
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageFile, ImageOps, TiffImagePlugin, UnidentifiedImageError

from autovision_ml.data.image_scan import CancelCheck, Cancelled, HashedImage
from autovision_ml.data.import_contract import (
    MAX_IMAGE_BYTES,
    MAX_IMAGE_PIXELS,
    ImageFormat,
    Orientation,
    ScanImage,
    parse_selection_manifest,
)
from autovision_ml.data.local_path import require_local_path

_FORMATS = ("JPEG", "PNG", "WEBP", "BMP", "TIFF")
type _Chain = tuple[tuple[Path, os.stat_result], ...]


class DecodeError(ValueError):
    """Fixed code only; the command owns per-image ScanIssue construction."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__("Image decode rejected")


@dataclass(frozen=True, slots=True)
class DecodedImage:
    """Borrowed from open_decoded_image; image is closed on context exit."""

    metadata: ScanImage
    image: Image.Image

    def close(self) -> None:
        self.image.close()


def _cancel(check: CancelCheck | None) -> None:
    if check is not None and check():
        raise Cancelled()


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
    # As in DAT-02: Windows lstat/fstat ctime can differ on the same file.
    # Compare ctime within each API, using a post-open path baseline.
    return _content(left, right) and left.st_ctime_ns == right.st_ctime_ns


def _chain(path: Path, check: CancelCheck | None) -> _Chain:
    try:
        require_local_path(path)
    except ValueError:
        raise DecodeError("UNSAFE_PATH") from None
    entries: list[tuple[Path, os.stat_result]] = []
    for node in (*reversed(path.parents), path):
        _cancel(check)
        info = node.lstat()
        if stat.S_ISLNK(info.st_mode) or (
            getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
        ):
            raise DecodeError("UNSAFE_PATH")
        if node != path and not stat.S_ISDIR(info.st_mode):
            raise DecodeError("UNSAFE_PATH")
        entries.append((node, info))
    return tuple(entries)


def _ancestry(left: _Chain, right: _Chain) -> bool:
    return len(left) == len(right) and all(
        a == b and _identity(x, y) for (a, x), (b, y) in zip(left, right)
    )


def _regular(info: os.stat_result) -> None:
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise DecodeError("UNSAFE_FILE")
    if getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
        raise DecodeError("UNSAFE_PATH")


def _read_source(
    candidate: HashedImage, check: CancelCheck | None
) -> tuple[bytes, _Chain]:
    # Narrow adaptation of image_scan's checked read, not a private import or
    # another enumeration/manifest. The byte snapshot is the decoder's only I/O.
    _cancel(check)
    try:
        parse_selection_manifest(
            {"formatVersion": 1, "files": [candidate["sourcePath"]]}
        )
    except ValueError:
        raise DecodeError("UNSAFE_PATH") from None
    path = Path(candidate["sourcePath"])
    if os.name != "nt" or not path.is_absolute():
        raise DecodeError("UNSAFE_PATH")
    try:
        before_chain = _chain(path, check)
        before = before_chain[-1][1]
        _regular(before)
        if before.st_size <= 0:
            raise DecodeError("EMPTY_FILE")
        if before.st_size > MAX_IMAGE_BYTES:
            raise DecodeError("IMAGE_TOO_LARGE")
        if (
            type(candidate["byteSize"]) is not int
            or before.st_size != candidate["byteSize"]
            or str(before.st_mtime_ns) != candidate["mtimeNs"]
        ):
            raise DecodeError("SOURCE_CHANGED")
        digest = hashlib.sha256()
        with BytesIO() as retained:
            with path.open("rb", buffering=0) as stream:
                opened = os.fstat(stream.fileno())
                _regular(opened)
                opened_chain = _chain(path, check)
                baseline = opened_chain[-1][1]
                if (
                    not _ancestry(before_chain, opened_chain)
                    or not _content(before, opened)
                    or not _content(opened, baseline)
                ):
                    raise DecodeError("SOURCE_CHANGED")
                while True:
                    _cancel(check)
                    block = stream.read(
                        min(65536, MAX_IMAGE_BYTES - retained.tell() + 1)
                    )
                    if not block:
                        break
                    if retained.tell() + len(block) > MAX_IMAGE_BYTES:
                        raise DecodeError("IMAGE_TOO_LARGE")
                    digest.update(block)
                    retained.write(block)
                after = os.fstat(stream.fileno())
                _regular(after)
                after_chain = _chain(path, check)
                if (
                    retained.tell() != opened.st_size
                    or not _snapshot(opened, after)
                    or not _snapshot(baseline, after_chain[-1][1])
                    or not _ancestry(opened_chain, after_chain)
                    or not _content(after, after_chain[-1][1])
                    or digest.hexdigest() != candidate["sha256"]
                ):
                    raise DecodeError("SOURCE_CHANGED")
            closed_chain = _chain(path, check)
            if not _ancestry(opened_chain, closed_chain) or not _snapshot(
                baseline, closed_chain[-1][1]
            ):
                raise DecodeError("SOURCE_CHANGED")
            return retained.getvalue(), closed_chain
    except OSError:
        raise DecodeError("IMAGE_READ_FAILED") from None


def _orientation(value: object) -> Orientation:
    if type(value) is int:
        values: tuple[Orientation, ...] = (1, 2, 3, 4, 5, 6, 7, 8)
        for allowed in values:
            if value == allowed:
                return allowed
    raise DecodeError("INVALID_ORIENTATION")


def _header(image: Image.Image, expected: ImageFormat) -> tuple[int, int]:
    if image.format not in _FORMATS:
        raise DecodeError("UNSUPPORTED_IMAGE_FORMAT")
    if image.format != expected.upper():
        raise DecodeError("IMAGE_FORMAT_MISMATCH")
    width: object = image.width
    height: object = image.height
    if isinstance(image, TiffImagePlugin.TiffImageFile):
        # Pillow 12.3 _setup already swaps image.size for orientations 5..8;
        # load_end transposes pixels and removes 274 in raw AND libtiff paths.
        width, height = image.tag_v2.get(256), image.tag_v2.get(257)
    if type(width) is not int or type(height) is not int or width <= 0 or height <= 0:
        raise DecodeError("INVALID_IMAGE_DIMENSIONS")
    if width * height > MAX_IMAGE_PIXELS:
        raise DecodeError("IMAGE_PIXEL_LIMIT_EXCEEDED")
    # Check the animation indicator first: TIFF n_frames may walk many IFDs.
    if getattr(image, "is_animated", False):
        raise DecodeError("ANIMATED_IMAGE_UNSUPPORTED")
    frames: object = getattr(image, "n_frames", 1)
    if type(frames) is not int or frames != 1:
        raise DecodeError("ANIMATED_IMAGE_UNSUPPORTED")
    return width, height


def _validate_png(contents: bytes, check: CancelCheck | None) -> bool:
    if not contents.startswith(b"\x89PNG\r\n\x1a\n"):
        return False
    # _read_source bounds bytes; Pillow owns decoding and chunk semantics.
    # Its verify() stops at IEND without checking that chunk's CRC.
    position = 8
    animated = False
    with memoryview(contents) as data:
        while position < len(data):
            _cancel(check)
            if len(data) - position < 12:
                raise DecodeError("INVALID_IMAGE")
            size = int.from_bytes(data[position : position + 4], "big")
            kind = bytes(data[position + 4 : position + 8])
            payload_end = position + 8 + size
            chunk_end = payload_end + 4
            if chunk_end > len(data):
                raise DecodeError("INVALID_IMAGE")
            if zlib.crc32(data[position + 4 : payload_end]) != int.from_bytes(
                data[payload_end:chunk_end], "big"
            ):
                raise DecodeError("INVALID_IMAGE")
            if kind == b"IEND":
                if size != 0:
                    raise DecodeError("INVALID_IMAGE")
                return animated
            if kind in (b"acTL", b"fcTL", b"fdAT"):
                animated = True
            position = chunk_end
    raise DecodeError("INVALID_IMAGE")


def _webp_animation(contents: bytes) -> bool:
    if contents[:4] != b"RIFF" or contents[8:12] != b"WEBP":
        return False
    position = 12
    while position + 8 <= len(contents):
        kind = contents[position : position + 4]
        size = int.from_bytes(contents[position + 4 : position + 8], "little")
        if kind in (b"ANIM", b"ANMF"):
            return True
        if (
            kind == b"VP8X"
            and size
            and position + 8 < len(contents)
            and contents[position + 8] & 2
        ):
            return True
        position += 8 + size + (size & 1)
    return False


def _decode(candidate: HashedImage, check: CancelCheck | None) -> DecodedImage:
    candidate = candidate.copy()
    contents, baseline = _read_source(candidate, check)
    image: Image.Image | None = None
    try:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                warnings.simplefilter("error", UserWarning)
                # Never enable lenient PNG CRC/truncation handling, nor mutate
                # process-wide Pillow policy shared with other consumers.
                if ImageFile.LOAD_TRUNCATED_IMAGES:
                    raise DecodeError("UNSAFE_DECODER_CONFIGURATION")
                if _validate_png(contents, check) or _webp_animation(contents):
                    raise DecodeError("ANIMATED_IMAGE_UNSUPPORTED")
                with (
                    BytesIO(contents) as encoded,
                    closing(Image.open(encoded, formats=_FORMATS)) as probe,
                ):
                    _header(probe, candidate["format"])
                    _cancel(check)
                    # Must precede getexif: PNG getexif can load pixels.
                    probe.verify()
                _cancel(check)
                with BytesIO(contents) as encoded:
                    image = Image.open(encoded, formats=_FORMATS)
                    width, height = _header(image, candidate["format"])
                    orientation = _orientation(image.getexif().get(274, 1))
                    _cancel(check)
                    image.load()
                    _cancel(check)
                    # TIFF's load_end has removed its applied orientation;
                    # exif_transpose then does nothing, rather than applying
                    # the captured RAW orientation a second time.
                    ImageOps.exif_transpose(image, in_place=True)
                    expected_size = (
                        (height, width) if orientation >= 5 else (width, height)
                    )
                    if image.size != expected_size:
                        raise DecodeError("ORIENTATION_FAILED")
        except (Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise DecodeError("IMAGE_PIXEL_LIMIT_EXCEEDED") from None
        except UnidentifiedImageError:
            raise DecodeError("UNSUPPORTED_IMAGE_FORMAT") from None
        except DecodeError:
            raise
        except (
            OSError,
            ValueError,
            SyntaxError,
            EOFError,
            TypeError,
            struct.error,
            Warning,
        ):
            raise DecodeError("INVALID_IMAGE") from None
        _cancel(check)
        try:
            after = _chain(baseline[-1][0], check)
            if not _ancestry(baseline, after) or not _snapshot(
                baseline[-1][1], after[-1][1]
            ):
                raise DecodeError("SOURCE_CHANGED")
        except OSError:
            raise DecodeError("IMAGE_READ_FAILED") from None
        metadata: ScanImage = {
            **candidate,
            "width": width,
            "height": height,
            "orientation": orientation,
            "annotation": None,
        }
        return DecodedImage(metadata, image)
    except BaseException:
        if image is not None:
            image.close()
        raise


@contextmanager
def open_decoded_image(
    candidate: HashedImage, check_cancel: CancelCheck | None = None
) -> Generator[DecodedImage]:
    """Own one fully decoded image until context exit, including caller errors.

    metadata keeps RAW dimensions/orientation for DAT-05 annotation coordinates;
    image contains oriented pixels for display/training, in its native mode.
    No RGB conversion, resize, pixel serialization, or persistent writes.
    Cooperative checks cannot interrupt native decoder/OS calls: the worker
    must enforce its own process timeout and memory ceiling. Source validation
    is a snapshot, not an authorization grant or a lock on future source edits.
    """
    decoded = _decode(candidate, check_cancel)
    try:
        yield decoded
    finally:
        decoded.close()


def decode_image(
    candidate: HashedImage, check_cancel: CancelCheck | None = None
) -> ScanImage:
    """DAT-05/command API: fully validate/decode, close pixels, return metadata.

    Raises DecodeError with a fixed .code; Cancelled propagates unchanged.
    Failed candidates never return fabricated dimensions or annotations.
    """
    with open_decoded_image(candidate, check_cancel) as decoded:
        return decoded.metadata
