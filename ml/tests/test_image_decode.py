"""DAT-03 local generated fixtures; no assets, network, CLI, or subprocesses."""

from __future__ import annotations

import errno
import hashlib
import os
import socket
import struct
import zlib
from io import FileIO
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image, ImageFile, PngImagePlugin

from autovision_ml.data.image_decode import (
    DecodedImage,
    DecodeError,
    decode_image,
    open_decoded_image,
)
from autovision_ml.data.image_scan import Cancelled, HashedImage, enumerate_and_hash
from autovision_ml.data.import_contract import (
    MAX_IMAGE_BYTES,
    MAX_IMAGE_PIXELS,
    ImageFormat,
)

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows-native DAT-02 input")

FORMATS: tuple[ImageFormat, ...] = ("jpeg", "png", "webp", "bmp", "tiff")
# Flattened RAW 3x2 pixel indices after each EXIF transform: independent oracle.
ORIENTED = {
    1: (0, 1, 2, 3, 4, 5),
    2: (2, 1, 0, 5, 4, 3),
    3: (5, 4, 3, 2, 1, 0),
    4: (3, 4, 5, 0, 1, 2),
    5: (0, 3, 1, 4, 2, 5),
    6: (3, 0, 4, 1, 5, 2),
    7: (5, 2, 4, 1, 3, 0),
    8: (2, 5, 1, 4, 0, 3),
}


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("Network forbidden")

    monkeypatch.setattr(socket, "create_connection", blocked)
    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket.socket, "connect_ex", blocked)
    monkeypatch.setattr(socket, "getaddrinfo", blocked)


def _fixture(
    path: Path, kind: ImageFormat = "png", orientation: int | None = None
) -> None:
    with Image.new("RGB", (3, 2)) as image:
        image.putdata(
            [
                (231, 12, 31),
                (21, 222, 41),
                (42, 13, 214),
                (191, 178, 14),
                (27, 168, 181),
                (184, 27, 176),
            ]
        )
        exif = Image.Exif()
        if orientation is not None:
            exif[274] = orientation
        if kind == "bmp":
            image.save(path, format="BMP")
        else:
            image.save(path, format=kind.upper(), exif=exif)


def _candidate(path: Path, kind: ImageFormat = "png") -> HashedImage:
    # For adversarial bytes DAT-02 cannot accept, construct its exact public
    # intermediate shape from the actual temporary file, not a ScanImage.
    info = path.stat()
    return {
        "key": "image:0",
        "sourcePath": str(path),
        "byteSize": info.st_size,
        "mtimeNs": str(info.st_mtime_ns),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "format": kind,
        "duplicateOf": None,
    }


@pytest.mark.parametrize("kind", FORMATS)
def test_actual_dat02_to_decode_preserves_original_and_exact_shape(
    tmp_path: Path, kind: ImageFormat, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / f"original.{kind}"
    _fixture(path, kind)
    original = path.read_bytes()
    before = path.stat()
    scan = enumerate_and_hash(
        {"format": "unlabeled", "selection": "directory", "root": str(tmp_path)}
    )
    assert scan.issues == []
    assert len(scan.images) == 1
    candidate = scan.images[0]
    result = decode_image(candidate)
    assert result == {
        **candidate,
        "width": 3,
        "height": 2,
        "orientation": 1,
        "annotation": None,
    }
    assert set(candidate) == {
        "key",
        "sourcePath",
        "byteSize",
        "mtimeNs",
        "sha256",
        "format",
        "duplicateOf",
    }
    assert path.read_bytes() == original
    after = path.stat()
    assert (after.st_ino, after.st_size, after.st_mtime_ns) == (
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
    )
    assert list(tmp_path.iterdir()) == [path]
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


@pytest.mark.parametrize("kind", ["jpeg", "png", "tiff"])
@pytest.mark.parametrize("orientation", range(1, 9))
def test_all_exif_orientations_have_actual_pixels_and_raw_coordinates(
    tmp_path: Path, kind: ImageFormat, orientation: int
) -> None:
    base = tmp_path / f"base.{kind}"
    path = tmp_path / f"oriented.{kind}"
    _fixture(base, kind, 1)
    _fixture(path, kind, orientation)
    with Image.open(base) as image:
        image.load()
        # Compare to independently decoded base bytes, not JPEG source colors.
        pixels = [image.getpixel((x, y)) for y in range(2) for x in range(3)]
    candidate = _candidate(path, kind)
    candidate["duplicateOf"] = "image:prior"
    with open_decoded_image(candidate) as decoded:
        assert (decoded.metadata["width"], decoded.metadata["height"]) == (3, 2)
        assert decoded.metadata["orientation"] == orientation
        assert decoded.metadata["duplicateOf"] == "image:prior"
        assert decoded.metadata["annotation"] is None
        expected_size = (2, 3) if orientation >= 5 else (3, 2)
        assert decoded.image.size == expected_size
        actual = [
            decoded.image.getpixel((x, y))
            for y in range(expected_size[1])
            for x in range(expected_size[0])
        ]
        assert actual == [pixels[index] for index in ORIENTED[orientation]]
        assert decoded.image.getexif().get(274, 1) == 1
    with pytest.raises(ValueError):
        decoded.image.getpixel((0, 0))
    assert _candidate(path, kind)["sha256"] == candidate["sha256"]


@pytest.mark.parametrize(
    ("kind", "mode"), [("jpeg", "CMYK"), ("png", "L"), ("tiff", "L")]
)
def test_native_modes_are_not_implicitly_converted(
    tmp_path: Path, kind: ImageFormat, mode: str
) -> None:
    path = tmp_path / f"mode.{kind}"
    with Image.new(mode, (3, 2)) as image:
        image.save(path, format=kind.upper())
    with open_decoded_image(_candidate(path, kind)) as decoded:
        assert decoded.image.mode == mode


@pytest.mark.parametrize("kind", ["png", "webp", "tiff"])
def test_multiframe_is_not_implicitly_frame_zero(
    tmp_path: Path, kind: ImageFormat
) -> None:
    path = tmp_path / f"animation.{kind}"
    with (
        Image.new("RGB", (3, 2), "red") as first,
        Image.new("RGB", (3, 2), "blue") as second,
    ):
        first.save(path, format=kind.upper(), save_all=True, append_images=[second])
    with pytest.raises(DecodeError) as caught:
        decode_image(_candidate(path, kind))
    assert caught.value.code == "ANIMATED_IMAGE_UNSUPPORTED"


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload))
    )


def test_single_frame_apng_indicator_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "one.png"
    _fixture(path)
    raw = path.read_bytes()
    # Insert valid APNG acTL/fcTL before IDAT. n_frames is only one.
    animation = _png_chunk(b"acTL", struct.pack(">II", 1, 0))
    animation += _png_chunk(
        b"fcTL", struct.pack(">IIIIIHHBB", 0, 3, 2, 0, 0, 1, 10, 0, 0)
    )
    path.write_bytes(raw[:33] + animation + raw[33:])
    with Image.open(path) as image:
        assert isinstance(image, PngImagePlugin.PngImageFile)
        assert image.n_frames == 1
    with pytest.raises(DecodeError) as caught:
        decode_image(_candidate(path))
    assert caught.value.code == "ANIMATED_IMAGE_UNSUPPORTED"


@pytest.mark.parametrize("kind", FORMATS)
def test_truncated_pixel_payload_is_rejected(tmp_path: Path, kind: ImageFormat) -> None:
    path = tmp_path / f"broken.{kind}"
    _fixture(path, kind)
    raw = path.read_bytes()
    # Remove actual pixel bytes, not merely optional terminal metadata.
    path.write_bytes(raw[: len(raw) // 2])
    with pytest.raises(DecodeError):
        decode_image(_candidate(path, kind))


def test_verify_checks_png_crc_and_load_is_not_skipped(tmp_path: Path) -> None:
    path = tmp_path / "bad-crc.png"
    _fixture(path)
    raw = bytearray(path.read_bytes())
    position = raw.index(b"IDAT")
    size = int.from_bytes(raw[position - 4 : position], "big")
    raw[position + 4 + size] ^= 1
    path.write_bytes(raw)
    with (
        patch.object(Image, "open", side_effect=AssertionError("decode bad PNG CRC")),
        pytest.raises(DecodeError) as caught,
    ):
        decode_image(_candidate(path))
    assert caught.value.code == "INVALID_IMAGE"
    _fixture(path)
    candidate = _candidate(path)
    with (
        patch.object(PngImagePlugin.PngImageFile, "verify", autospec=True) as verified,
        patch.object(
            PngImagePlugin.PngImageFile, "load", side_effect=OSError("private")
        ),
        pytest.raises(DecodeError) as caught,
    ):
        decode_image(candidate)
    verified.assert_called_once()
    assert caught.value.code == "INVALID_IMAGE"


def test_oversized_header_rejected_before_pixel_allocation(tmp_path: Path) -> None:
    path = tmp_path / "huge.png"
    _fixture(path)
    raw = path.read_bytes()
    header = struct.pack(">IIBBBBB", MAX_IMAGE_PIXELS + 1, 1, 8, 2, 0, 0, 0)
    path.write_bytes(raw[:8] + _png_chunk(b"IHDR", header) + raw[33:])
    candidate = _candidate(path)
    with (
        patch.object(
            PngImagePlugin.PngImageFile, "load", side_effect=AssertionError("allocated")
        ),
        pytest.raises(DecodeError) as caught,
    ):
        decode_image(candidate)
    assert caught.value.code == "IMAGE_PIXEL_LIMIT_EXCEEDED"


def test_file_size_limit_before_read_without_large_write(tmp_path: Path) -> None:
    path = tmp_path / "sparse.png"
    _fixture(path)
    candidate = _candidate(path)
    with path.open("r+b") as stream:
        stream.truncate(MAX_IMAGE_BYTES + 1)
    with (
        patch.object(Path, "open", side_effect=AssertionError("read attempted")),
        pytest.raises(DecodeError) as caught,
    ):
        decode_image(candidate)
    assert caught.value.code == "IMAGE_TOO_LARGE"


def test_same_size_hash_change_with_restored_mtime(tmp_path: Path) -> None:
    path = tmp_path / "changed.bmp"
    _fixture(path, "bmp")
    candidate = _candidate(path, "bmp")
    info = path.stat()
    contents = bytearray(path.read_bytes())
    contents[-1] ^= 1
    path.write_bytes(contents)
    os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns))
    with (
        patch.object(Image, "open", side_effect=AssertionError("decoded stale image")),
        pytest.raises(DecodeError) as caught,
    ):
        decode_image(candidate)
    assert caught.value.code == "SOURCE_CHANGED"


def test_source_mutation_during_safe_read_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "changed-during-read.png"
    _fixture(path)
    original = path.read_bytes()
    candidate = _candidate(path)
    mutated = False

    def mutate_after_read(stream: FileIO) -> bool:
        nonlocal mutated
        if not mutated and stream.tell() > 0:
            with FileIO(path, "ab") as writer:
                assert writer.write(b"\0") == 1
            mutated = True
        return False

    with FileIO(path, "rb") as stream:
        with (
            patch.object(Path, "open", return_value=stream) as opened,
            patch.object(
                Image, "open", side_effect=AssertionError("decoded stale file")
            ),
            pytest.raises(DecodeError) as caught,
        ):
            decode_image(candidate, check_cancel=lambda: mutate_after_read(stream))
        opened.assert_called_once_with("rb", buffering=0)
        assert mutated
        assert caught.value.code == "SOURCE_CHANGED"
        # Check before our outer cleanup could hide a decoder handle leak.
        assert stream.closed
    assert path.read_bytes() == original + b"\0"
    path.rename(tmp_path / "released.png")


def test_source_mutation_during_pillow_load_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "changed-during-load.png"
    _fixture(path)
    original = path.read_bytes()
    candidate = _candidate(path)
    original_load = PngImagePlugin.PngImageFile.load
    loaded: list[Image.Image] = []

    def mutate_after_load(image: PngImagePlugin.PngImageFile) -> object:
        pixels = original_load(image)
        assert pixels is not None
        assert pixels[0, 0] == (231, 12, 31)
        if not loaded:
            loaded.append(image)
            with FileIO(path, "ab") as writer:
                assert writer.write(b"\0") == 1
        return pixels

    with FileIO(path, "rb") as stream:
        with (
            patch.object(Path, "open", return_value=stream) as opened,
            patch.object(PngImagePlugin.PngImageFile, "load", mutate_after_load),
            pytest.raises(DecodeError) as caught,
        ):
            decode_image(candidate)
        opened.assert_called_once_with("rb", buffering=0)
        assert caught.value.code == "SOURCE_CHANGED"
        assert stream.closed
    assert len(loaded) == 1
    with pytest.raises(ValueError):
        loaded[0].getpixel((0, 0))
    assert path.read_bytes() == original + b"\0"
    path.rename(tmp_path / "released.png")


@pytest.mark.parametrize(
    "bad_path", ["relative.png", "C:\\x\\..\\a.png", "C:\\NUL.png"]
)
def test_lexical_path_validation_precedes_io(tmp_path: Path, bad_path: str) -> None:
    path = tmp_path / "image.png"
    _fixture(path)
    candidate = _candidate(path)
    candidate["sourcePath"] = bad_path
    with (
        patch.object(Path, "lstat", side_effect=AssertionError("unsafe I/O")),
        pytest.raises(DecodeError) as caught,
    ):
        decode_image(candidate)
    assert caught.value.code == "UNSAFE_PATH"


def test_hardlink_created_after_scan_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "image.png"
    _fixture(path)
    candidate = _candidate(path)
    os.link(path, tmp_path / "alias.png")
    with pytest.raises(DecodeError) as caught:
        decode_image(candidate)
    assert caught.value.code == "UNSAFE_FILE"


def test_symlink_is_rejected_before_file_open(tmp_path: Path) -> None:
    path = tmp_path / "image.png"
    _fixture(path)
    candidate = _candidate(path)
    target = tmp_path / "target.png"
    path.rename(target)
    try:
        path.symlink_to(target)
    except NotImplementedError:
        pytest.skip("Symbolic link creation is not implemented on this platform")
    except OSError as error:
        if error.errno not in (
            errno.EACCES,
            errno.EPERM,
            errno.ENOSYS,
            errno.ENOTSUP,
        ) and getattr(error, "winerror", None) not in (1, 50, 1314):
            raise
        pytest.skip("Symbolic links require filesystem support and Windows privileges")
    with (
        patch.object(
            Path, "open", side_effect=AssertionError("symlink read attempted")
        ),
        pytest.raises(DecodeError) as caught,
    ):
        decode_image(candidate)
    assert caught.value.code == "UNSAFE_PATH"
    assert _candidate(target)["sha256"] == candidate["sha256"]


def test_junction_ancestor_revalidated_after_scan(tmp_path: Path) -> None:
    import _winapi

    root = tmp_path / "source"
    root.mkdir()
    path = root / "image.png"
    _fixture(path)
    candidate = _candidate(path)
    moved = tmp_path / "moved"
    root.rename(moved)
    _winapi.CreateJunction(str(moved), str(root))
    try:
        with pytest.raises(DecodeError) as caught:
            decode_image(candidate)
        assert caught.value.code == "UNSAFE_PATH"
    finally:
        root.rmdir()


def test_file_errors_are_sanitized_and_cancel_propagates(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "image.png"
    _fixture(path)
    candidate = _candidate(path)
    with (
        patch.object(
            Path, "open", side_effect=PermissionError("sensitive original path")
        ),
        pytest.raises(DecodeError) as caught,
    ):
        decode_image(candidate)
    assert caught.value.code == "IMAGE_READ_FAILED"
    assert str(caught.value) == "Image decode rejected"
    with (
        patch.object(Path, "lstat", side_effect=AssertionError("I/O after cancel")),
        pytest.raises(Cancelled),
    ):
        decode_image(candidate, check_cancel=lambda: True)
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


def test_cancel_during_read_closes_real_file_before_decoder(tmp_path: Path) -> None:
    path = tmp_path / "cancel-read.png"
    _fixture(path)
    original = path.read_bytes()
    candidate = _candidate(path)
    with FileIO(path, "rb") as stream:
        descriptor = stream.fileno()
        with (
            patch.object(Path, "open", return_value=stream) as opened,
            patch.object(
                Image, "open", side_effect=AssertionError("decode after cancel")
            ),
            pytest.raises(Cancelled),
        ):
            # A real block must be read before cancellation becomes true.
            decode_image(candidate, check_cancel=lambda: stream.tell() > 0)
        opened.assert_called_once_with("rb", buffering=0)
        assert stream.closed
        with pytest.raises(OSError):
            os.fstat(descriptor)
    assert path.read_bytes() == original
    path.rename(tmp_path / "released.png")


def test_cancel_after_decode_closes_real_file_and_pixels(tmp_path: Path) -> None:
    path = tmp_path / "cancel-decoded.png"
    _fixture(path)
    original = path.read_bytes()
    candidate = _candidate(path)
    original_load = PngImagePlugin.PngImageFile.load
    loaded: list[Image.Image] = []

    def track_load(image: PngImagePlugin.PngImageFile) -> object:
        pixels = original_load(image)
        assert pixels is not None
        assert pixels[0, 0] == (231, 12, 31)
        loaded.append(image)
        return pixels

    with FileIO(path, "rb") as stream:
        descriptor = stream.fileno()
        with (
            patch.object(Path, "open", return_value=stream) as opened,
            patch.object(PngImagePlugin.PngImageFile, "load", track_load),
            pytest.raises(Cancelled),
        ):
            decode_image(candidate, check_cancel=lambda: bool(loaded))
        opened.assert_called_once_with("rb", buffering=0)
        assert stream.closed
        with pytest.raises(OSError):
            os.fstat(descriptor)
    assert len(loaded) == 1
    with pytest.raises(ValueError):
        loaded[0].getpixel((0, 0))
    assert path.read_bytes() == original
    path.rename(tmp_path / "released.png")


@pytest.mark.parametrize("orientation", [0, 9, 65535])
def test_invalid_exif_orientation_rejected(tmp_path: Path, orientation: int) -> None:
    path = tmp_path / "orientation.jpg"
    _fixture(path, "jpeg", orientation)
    with pytest.raises(DecodeError) as caught:
        decode_image(_candidate(path, "jpeg"))
    assert caught.value.code == "INVALID_ORIENTATION"


def test_unknown_or_mismatched_format_and_leniency_rejected(tmp_path: Path) -> None:
    path = tmp_path / "image.png"
    with Image.new("RGB", (3, 2)) as image:
        image.save(path, format="GIF")
    with pytest.raises(DecodeError) as caught:
        decode_image(_candidate(path))
    assert caught.value.code == "UNSUPPORTED_IMAGE_FORMAT"
    _fixture(path)
    with pytest.raises(DecodeError) as caught:
        decode_image(_candidate(path, "jpeg"))
    assert caught.value.code == "IMAGE_FORMAT_MISMATCH"
    candidate = _candidate(path)
    with (
        patch.object(ImageFile, "LOAD_TRUNCATED_IMAGES", True),
        pytest.raises(DecodeError) as caught,
    ):
        decode_image(candidate)
    assert caught.value.code == "UNSAFE_DECODER_CONFIGURATION"


def test_caller_exception_not_wrapped_and_pixels_released(tmp_path: Path) -> None:
    path = tmp_path / "image.png"
    _fixture(path)
    marker = OSError("consumer failure")
    holder: list[DecodedImage] = []
    with (
        pytest.raises(OSError) as caught,
        open_decoded_image(_candidate(path)) as decoded,
    ):
        holder.append(decoded)
        raise marker
    assert caught.value is marker
    assert len(holder) == 1
    with pytest.raises(ValueError):
        holder[0].image.getpixel((0, 0))
    path.rename(tmp_path / "released.png")


# RV-DECODE regressions: generated bytes, never lenient Pillow policy.
def test_adversarial_empty_gama_after_idat_is_invalid_image(tmp_path: Path) -> None:
    """A CRC-valid empty gAMA must not leak Pillow's struct.error."""
    assert not ImageFile.LOAD_TRUNCATED_IMAGES
    path = tmp_path / "adversarial-empty-gama.png"
    _fixture(path)
    raw = path.read_bytes()
    iend = _png_chunk(b"IEND", b"")
    assert raw.endswith(iend)
    # Insert a CRC-valid, empty gAMA after all IDAT data and before IEND.
    # Its CRC is correct, so verify() alone cannot catch this late chunk.
    path.write_bytes(raw[: -len(iend)] + _png_chunk(b"gAMA", b"") + iend)
    candidate = _candidate(path)
    with pytest.raises(DecodeError) as caught:
        decode_image(candidate)
    assert caught.value.code == "INVALID_IMAGE"


@pytest.mark.parametrize(
    ("text_key", "text_value"),
    [("loop", "0"), ("default_image", "text"), ("comment", "acTL fcTL fdAT")],
    ids=["loop-text", "default-image-text", "animation-names-in-text"],
)
def test_adversarial_static_text_is_not_apng(
    tmp_path: Path, text_key: str, text_value: str
) -> None:
    """Text keys and values are not animation-container chunk names."""
    assert not ImageFile.LOAD_TRUNCATED_IMAGES
    source = tmp_path / "adversarial-static-base.png"
    path = tmp_path / f"adversarial-static-{text_key}.png"
    _fixture(source)
    png_info = PngImagePlugin.PngInfo()
    png_info.add_text(text_key, text_value)
    with Image.open(source) as image:
        image.save(path, format="PNG", pnginfo=png_info)
    original = path.read_bytes()

    # Parse chunk boundaries, not substring matches inside compressed pixels.
    chunk_kinds: list[bytes] = []
    with path.open("rb") as stream:
        assert stream.read(8) == b"\x89PNG\r\n\x1a\n"
        with PngImagePlugin.ChunkStream(stream) as chunks:
            while True:
                kind, _position, length = chunks.read()
                payload = stream.read(length)
                assert len(payload) == length
                chunks.crc(kind, payload)
                chunk_kinds.append(kind)
                if kind == b"IEND":
                    break
        assert stream.read() == b""
    assert b"tEXt" in chunk_kinds
    assert not {b"acTL", b"fcTL", b"fdAT"}.intersection(chunk_kinds)
    with Image.open(path) as image:
        assert isinstance(image, PngImagePlugin.PngImageFile)
        assert image.size == (3, 2)
        assert image.n_frames == 1
        assert not image.is_animated
        assert image.info[text_key] == text_value
        image.load()
        assert image.getexif().get(274, 1) == 1

    candidate = _candidate(path)
    result = decode_image(candidate)
    assert result == {
        **candidate,
        "width": 3,
        "height": 2,
        "orientation": 1,
        "annotation": None,
    }
    assert path.read_bytes() == original
    assert _candidate(path) == candidate


@pytest.mark.parametrize(
    "missing_crc", [False, True], ids=["changed-crc", "missing-crc"]
)
def test_adversarial_iend_crc_damage_is_invalid_image(
    tmp_path: Path, missing_crc: bool
) -> None:
    """IEND requires its complete, correct CRC even when verify() skips it."""
    assert not ImageFile.LOAD_TRUNCATED_IMAGES
    path = tmp_path / "adversarial-iend.png"
    _fixture(path)
    raw = bytearray(path.read_bytes())
    assert raw.endswith(_png_chunk(b"IEND", b""))
    if missing_crc:
        # Keep the complete zero-length IEND header; remove exactly its CRC.
        del raw[-4:]
    else:
        # Change one CRC bit, leaving IEND length/type and all pixels intact.
        raw[-1] ^= 1
    path.write_bytes(raw)
    candidate = _candidate(path)
    with pytest.raises(DecodeError) as caught:
        decode_image(candidate)
    assert caught.value.code == "INVALID_IMAGE"


@pytest.mark.parametrize(
    "ending",
    [
        b"",
        b"\0\0\0",
        struct.pack(">I", 0xFFFFFFFF) + b"tEXt" + b"\0" * 4,
        _png_chunk(b"IEND", b"\0"),
        _png_chunk(b"IEND", b"")[:-1],
    ],
    ids=[
        "missing-iend",
        "truncated-header",
        "chunk-out-of-bounds",
        "nonempty-iend",
        "partial-iend-crc",
    ],
)
def test_png_envelope_damage_rejected_before_pillow(
    tmp_path: Path, ending: bytes
) -> None:
    path = tmp_path / "invalid-envelope.png"
    _fixture(path)
    raw = path.read_bytes()
    iend = _png_chunk(b"IEND", b"")
    assert raw.endswith(iend)
    path.write_bytes(raw[: -len(iend)] + ending)
    with (
        patch.object(Image, "open", side_effect=AssertionError("decode bad envelope")),
        pytest.raises(DecodeError) as caught,
    ):
        decode_image(_candidate(path))
    assert caught.value.code == "INVALID_IMAGE"


@pytest.mark.parametrize("cancel_after", [1, 2, 3])
def test_cancel_during_png_chunk_walk_precedes_pillow(
    tmp_path: Path, cancel_after: int
) -> None:
    path = tmp_path / "cancel-chunks.png"
    _fixture(path)
    raw = path.read_bytes()
    # Ensure three CRC-checked chunks precede IDAT and IEND.
    text = _png_chunk(b"tEXt", b"note\0acTL")
    path.write_bytes(raw[:33] + text + text + raw[33:])
    original = path.read_bytes()
    candidate = _candidate(path)
    with (
        patch("autovision_ml.data.image_decode.zlib.crc32", wraps=zlib.crc32) as crc,
        patch.object(Image, "open", side_effect=AssertionError("decode after cancel")),
        pytest.raises(Cancelled),
    ):
        decode_image(candidate, check_cancel=lambda: crc.call_count == cancel_after)
    assert crc.call_count == cancel_after
    assert all(isinstance(call.args[0], memoryview) for call in crc.call_args_list)
    assert path.read_bytes() == original
