"""Offline DATA-04 tests, for explicit execution by the parent only.

The bounded fixtures are complete, fully decodable PNGs. They exercise chunks,
CRC, zlib and scanline filters, but not the normal DAT-03/DAT-05 importer,
DATA-05 review, or Gate 1. Downloads are replaced with copies of requested
temporary fixtures; real urllib entry points fail.
"""

from __future__ import annotations

import csv
import hashlib
import importlib.util
import io
import json
import struct
import sys
import zlib
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image

_HEADER = ["image_name", "BoxesString", "domain"]
_BOXES = "0 1 2 3;1023 1023 1024 1024"


def _id(number: int) -> str:
    return f"{number:064x}"


def _json_bytes(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    ).encode("utf-8")


def _csv_bytes(rows: list[list[str]], header: list[str] | None = None) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(_HEADER if header is None else header)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def _row(number: int, boxes: str = _BOXES, domain: str | None = None) -> list[str]:
    return [
        _id(number) + ".png",
        boxes,
        f"Arvalis_{number % 4 + 1}" if domain is None else domain,
    ]


def _chunk(chunk_type: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + chunk_type
        + data
        + struct.pack(">I", zlib.crc32(chunk_type + data))
    )


def _pass_dimensions(width: int, height: int, interlace: int):
    if interlace == 0:
        yield width, height
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
            yield pass_width, pass_height


def _ihdr(
    *,
    width: int = 1024,
    height: int = 1024,
    depth: int = 1,
    color: int = 0,
    compression: int = 0,
    filtering: int = 0,
    interlace: int = 0,
) -> bytes:
    return struct.pack(
        ">IIBBBBB", width, height, depth, color, compression, filtering, interlace
    )


def _scanlines(
    *,
    width: int = 1024,
    height: int = 1024,
    depth: int = 1,
    color: int = 0,
    interlace: int = 0,
    row_filter: int = 0,
    pixel_byte: int = 0,
) -> bytes:
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color, 1)
    raw = bytearray()
    for pass_width, pass_height in _pass_dimensions(width, height, interlace):
        row_bytes = (pass_width * channels * max(depth, 1) + 7) // 8
        for _ in range(pass_height):
            raw.extend(bytes([row_filter]) + bytes([pixel_byte]) * row_bytes)
    return bytes(raw)


def _png_bytes(*chunks: bytes) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"".join(chunks)


def _header_fixture(
    number: int,
    *,
    width: int = 1024,
    height: int = 1024,
    depth: int = 1,
    color: int = 0,
    compression: int = 0,
    filtering: int = 0,
    interlace: int = 0,
    row_filter: int = 0,
    pixel_byte: int = 0,
    palette_entries: int = 1,
) -> bytes:
    """Complete 1024x1024 PNG with a unique ancillary source marker."""
    ihdr = _ihdr(
        width=width,
        height=height,
        depth=depth,
        color=color,
        compression=compression,
        filtering=filtering,
        interlace=interlace,
    )
    scanlines = _scanlines(
        width=width,
        height=height,
        depth=depth,
        color=color,
        interlace=interlace,
        row_filter=row_filter,
        pixel_byte=pixel_byte,
    )
    palette = (
        _chunk(b"PLTE", bytes([0, 0, 0]) * palette_entries)
        if color == 3 and palette_entries > 0
        else b""
    )
    return _png_bytes(
        _chunk(b"IHDR", ihdr),
        palette,
        _chunk(b"tEXt", b"source-id\x00" + _id(number).encode("ascii")),
        _chunk(b"IDAT", zlib.compress(scanlines, level=9)),
        _chunk(b"IEND", b""),
    )


def _jpeg_fixture(number: int, *, width: int = 1024, height: int = 1024) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (width, height), (number % 256, 40, 80)).save(
        output, format="JPEG", quality=90
    )
    return output.getvalue()


def _load(name: str, path: Path, monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, name, module)
    spec.loader.exec_module(module)
    return module


def _snapshot(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    monkeypatch.setattr(sys, "dont_write_bytecode", True)
    helper = _load("sample_io", Path(__file__).with_name("sample_io.py"), monkeypatch)
    monkeypatch.setattr(helper, "CACHE_ROOT", tmp_path / "cache")
    blocker = Mock(side_effect=AssertionError("Offline DATA-04 fixture: no network"))
    monkeypatch.setattr(helper.urllib.request, "build_opener", blocker)
    monkeypatch.setattr(helper.urllib.request, "urlopen", blocker)
    monkeypatch.setattr(helper, "download", blocker)
    prep = _load(
        "_data04_prepare_gwhd", Path(__file__).with_name("prepare_gwhd.py"), monkeypatch
    )
    production = {
        "ROOT": prep.ROOT,
        "CSV_SIZE": prep.CSV_SIZE,
        "CSV_SHA256": prep.CSV_SHA256,
        "KNOWN_SOURCE_CONFLICT_LINES": dict(prep.KNOWN_SOURCE_CONFLICT_LINES),
        "ASSET_LIMIT": prep.ASSET_LIMIT,
    }
    monkeypatch.setattr(prep, "ROOT", tmp_path)
    monkeypatch.setattr(prep, "CACHEDIR", helper.CACHE_ROOT / "gwhd-2021")
    monkeypatch.setattr(prep, "ASSETSROOT", tmp_path / "resources/samples/gwhd-2021")
    fixtures_dir = tmp_path / "fixtures"
    fixtures_dir.mkdir()
    fixtures, entries = {}, []
    for number in range(22, 0, -1):
        path = fixtures_dir / f"header-{number}.png"
        path.write_bytes(_header_fixture(number))
        url = prep.METAURL + "/gwhd_2021/images/" + _id(number) + ".png"
        fixtures[url] = path
        entries.append(
            {
                "key": "gwhd_2021/images/" + _id(number) + ".png",
                "size": path.stat().st_size,
                "links": {"content": url},
                "upstream_extra": {"not_a_sha256_pin": "ignored"},
            }
        )
    csv_path = fixtures_dir / "train.csv"
    fixtures[prep.CSVURL] = csv_path

    def set_csv(raw: bytes) -> None:
        csv_path.write_bytes(raw)
        # The production literal remains 2841482; only this isolated module changes.
        monkeypatch.setattr(prep, "CSV_SIZE", len(raw))
        monkeypatch.setattr(prep, "CSV_SHA256", hashlib.sha256(raw).hexdigest())
        monkeypatch.setattr(prep, "KNOWN_SOURCE_CONFLICT_LINES", {})

    set_csv(_csv_bytes([_row(number) for number in range(21, 0, -1)]))
    entries.append(
        {
            "key": "gwhd_2021/competition_train.csv",
            "size": csv_path.stat().st_size,
            "links": {"content": prep.CSVURL},
        }
    )
    index = {
        "entries": entries,
        "total": 998,
        "truncated": True,
        "enabled": True,
        "upstream_properties": {"version": "unrelated metadata"},
    }
    index_path = fixtures_dir / "index.json"
    index_path.write_bytes(_json_bytes(index))
    fixtures[prep.METAURL] = index_path
    prep.ASSETSROOT.mkdir(parents=True)
    (prep.ASSETSROOT / "LICENSE.txt").write_bytes(b"CC-BY-4.0 notice fixture\r\n")
    (prep.ASSETSROOT / "ATTRIBUTION.txt").write_bytes("帰属 fixture\r\n".encode())
    beans = prep.ASSETSROOT.parent / "beans"
    beans.mkdir()
    (beans / "LICENSE.txt").write_bytes(b"Existing Beans notice\n")
    requests, gets, publications, observations = [], [], [], {}
    original_write = helper.write_new

    def write_new(path: Path, raw: bytes) -> None:
        publications.append(path)
        original_write(path, raw)

    def download(
        url: str,
        destination: Path,
        *,
        expected_size: int | None,
        max_bytes: int,
        sha256: str | None = None,
    ) -> dict:
        assert url in fixtures, (
            "Only explicitly requested, fixed fixture URLs are allowed"
        )
        assert destination.is_relative_to(helper.CACHE_ROOT)
        assert type(max_bytes) is int and max_bytes > 0
        assert expected_size is not None or url == prep.METAURL
        requests.append(
            {
                "url": url,
                "destination": destination,
                "expected_size": expected_size,
                "max_bytes": max_bytes,
                "sha256": sha256,
            }
        )
        previous = observations.get(destination)
        if destination.exists():
            metadata = helper.file_metadata(destination)
            if previous != (url, metadata):
                raise ValueError("Fixture cache has no matching observation")
        else:
            gets.append(url)
            raw = fixtures[url].read_bytes()
            metadata = {"byteSize": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
            if previous is not None and previous != (url, metadata):
                raise ValueError("Fixture reacquisition differs from its observation")
            if not 0 < len(raw) <= max_bytes or (
                expected_size is not None and len(raw) != expected_size
            ):
                raise ValueError("Fixture size mismatch")
            if sha256 is not None and sha256 != metadata["sha256"]:
                raise ValueError("Fixture SHA-256 mismatch")
            # Actual sample_io publication/metadata, but NEVER its HTTP/ledger machinery.
            original_write(destination, raw)
            observations[destination] = (url, metadata)
        if (
            metadata["byteSize"] > max_bytes
            or (expected_size is not None and metadata["byteSize"] != expected_size)
            or (sha256 is not None and metadata["sha256"] != sha256)
        ):
            raise ValueError("Fixture cache pin differs")
        return dict(metadata)

    disk = SimpleNamespace(free=10**12, calls=[])

    def disk_usage(path: Path) -> SimpleNamespace:
        assert path.exists()
        disk.calls.append(path)
        return SimpleNamespace(total=10**12, used=10**12 - disk.free, free=disk.free)

    monkeypatch.setattr(helper, "write_new", write_new)
    monkeypatch.setattr(helper, "download", download)
    monkeypatch.setattr(prep.shutil, "disk_usage", disk_usage)
    return SimpleNamespace(
        p=prep,
        helper=helper,
        fixtures=fixtures,
        index=index,
        set_csv=set_csv,
        requests=requests,
        gets=gets,
        publications=publications,
        disk=disk,
        observations=observations,
        blocker=blocker,
        production=production,
    )


def _entry(env: SimpleNamespace, number: int = 1) -> dict:
    key = "gwhd_2021/images/" + _id(number) + ".png"
    return next(entry for entry in env.index["entries"] if entry["key"] == key)


def _save_index(env: SimpleNamespace) -> None:
    env.fixtures[env.p.METAURL].write_bytes(_json_bytes(env.index))


def _png_gets(env: SimpleNamespace) -> list[str]:
    return [url for url in env.gets if url.endswith(".png")]


def _png_requests(env: SimpleNamespace) -> list[dict]:
    return [request for request in env.requests if request["url"].endswith(".png")]


def _assert_no_asset_publication(env: SimpleNamespace) -> None:
    assert not any(
        path.is_relative_to(env.p.ASSETSROOT.parent) for path in env.publications
    )


def test_import_has_no_acquisition_publication_or_cache_reads(
    env: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before = _snapshot(env.p.ROOT)
    guards = [Mock(side_effect=AssertionError("No import-time I/O")) for _ in range(4)]
    with monkeypatch.context() as patch:
        for name, guard in zip(
            ("download", "write_new", "file_metadata"), guards[:3], strict=True
        ):
            patch.setattr(env.helper, name, guard)
        patch.setattr(env.p.shutil, "disk_usage", guards[3])
        loaded = _load(
            "_data04_import_only", Path(__file__).with_name("prepare_gwhd.py"), patch
        )
        assert (
            callable(loaded.select)
            and callable(loaded.pilot)
            and callable(loaded.stage)
        )
    for guard in guards:
        guard.assert_not_called()
    assert _snapshot(env.p.ROOT) == before
    assert env.requests == []
    env.blocker.assert_not_called()


def test_fixed_production_constants(env: SimpleNamespace) -> None:
    assert env.production["ROOT"] == Path(__file__).resolve().parents[2]
    assert env.production["CSV_SIZE"] == 2841482
    assert (
        env.production["CSV_SHA256"]
        == "1af1d8e386643afe8cd1b41d89ca2634d3212908bdbe58a9d7cd5b32e4048176"
    )
    assert env.production["KNOWN_SOURCE_CONFLICT_LINES"] == {
        "1961bcf453d5b2206c428c1c14fe55d1f26f3c655db0a2b6a83094476e8edb5b": (
            2001,
            2081,
        ),
        "d88963636d49127bda0597ef73f1703e92d6f111caefc44902d5932b8cd3fa94": (
            1988,
            2072,
        ),
    }
    assert env.production["ASSET_LIMIT"] == 96 * 1024 * 1024
    assert env.p.INDEX_LIMIT == 2 * 1024 * 1024
    assert env.p.IMAGE_COUNT == 20
    assert (
        env.p.METAURL
        == "https://zenodo.org/api/records/5092309/files/gwhd_2021.zip/container"
    )
    assert env.p.CSVURL == env.p.METAURL + "/gwhd_2021/competition_train.csv"


def test_select_freezes_sorted_train_ids_not_preview_and_raw_source_hashes(
    env: SimpleNamespace,
) -> None:
    before = _snapshot(env.p.ASSETSROOT.parent)
    selection = env.p.select()
    assert selection["trainRowCount"] == 21  # Not the index's total:998.
    assert selection["uniqueImageCount"] == 21
    assert selection["sourceWarnings"] == []
    assert [image["sourceId"] for image in selection["images"]] == [
        _id(i) for i in range(1, 21)
    ]
    assert selection["sourceSplit"] == "train"
    assert env.gets == [env.p.METAURL, env.p.CSVURL]
    assert env.requests[0]["expected_size"] is None
    assert env.requests[0]["max_bytes"] == 2 * 1024 * 1024
    assert (
        env.requests[1]["expected_size"]
        == env.requests[1]["max_bytes"]
        == env.p.CSV_SIZE
    )
    assert all(request["sha256"] is None for request in env.requests)
    for kind, url in (("csv", env.p.CSVURL), ("index", env.p.METAURL)):
        assert selection["sources"][kind] == {
            "url": url,
            **env.helper.file_metadata(env.fixtures[url]),
        }
    raw_csv = env.fixtures[env.p.CSVURL].read_bytes()
    assert (env.p.CACHEDIR / "competition_train.csv").read_bytes() == raw_csv
    assert b"\r\n" in raw_csv
    assert (
        selection["sources"]["csv"]["sha256"]
        != hashlib.sha256(raw_csv.replace(b"\r\n", b"\n")).hexdigest()
    )
    for image in selection["images"]:
        assert set(image) == {"sourceId", "domain", "boxes", "byteSize"}
        assert image["boxes"] == [[0, 1, 2, 3], [1023, 1023, 1024, 1024]]
    path = env.p.CACHEDIR / "selection.json"
    raw, modified = path.read_bytes(), path.stat().st_mtime_ns
    assert raw == _json_bytes(selection) and raw.endswith(b"\n") and b"\r" not in raw
    assert env.p.select() == selection
    assert env.gets == [env.p.METAURL, env.p.CSVURL]
    assert path.read_bytes() == raw and path.stat().st_mtime_ns == modified
    assert _snapshot(env.p.ASSETSROOT.parent) == before
    _assert_no_asset_publication(env)


def test_select_has_no_notice_or_png_prerequisite_and_accepts_exactly_20_rows(
    env: SimpleNamespace,
) -> None:
    (env.p.ASSETSROOT / "LICENSE.txt").unlink()
    (env.p.ASSETSROOT / "ATTRIBUTION.txt").unlink()
    env.set_csv(_csv_bytes([_row(i) for i in range(20, 0, -1)]))
    assert env.p.select()["trainRowCount"] == 20
    assert _png_gets(env) == []


@pytest.mark.parametrize("command", ["pilot", "stage"])
def test_later_commands_require_selection_without_any_get(
    env: SimpleNamespace, command: str
) -> None:
    with pytest.raises(FileNotFoundError):
        getattr(env.p, command)()
    assert env.requests == [] and env.publications == []


def test_stage_requires_pilot_before_any_png_request(env: SimpleNamespace) -> None:
    env.p.select()
    before = list(env.gets)
    with pytest.raises(FileNotFoundError):
        env.p.stage()
    assert env.gets == before and _png_requests(env) == []
    _assert_no_asset_publication(env)


@pytest.mark.parametrize("command", ["pilot", "stage"])
@pytest.mark.parametrize("source", ["competition_train.csv", "index.json"])
@pytest.mark.parametrize("kind", ["missing", "directory"])
def test_missing_or_nonregular_cached_sources_stop_before_any_helper_call(
    env: SimpleNamespace, command: str, source: str, kind: str
) -> None:
    env.p.select()
    if command == "stage":
        env.p.pilot()
    path = env.p.CACHEDIR / source
    path.unlink()
    if kind == "directory":
        path.mkdir()
    requests, gets, writes, observations, before = (
        list(env.requests),
        list(env.gets),
        list(env.publications),
        dict(env.observations),
        _snapshot(env.p.ROOT),
    )
    error = FileNotFoundError if kind == "missing" else ValueError
    with pytest.raises(error):
        getattr(env.p, command)()
    assert env.requests == requests and env.gets == gets
    assert env.publications == writes and env.observations == observations
    assert _snapshot(env.p.ROOT) == before
    env.blocker.assert_not_called()


@pytest.mark.parametrize("source", ["csv", "index"])
def test_cached_source_verification_checks_observed_hash_before_deriving(
    env: SimpleNamespace, monkeypatch: pytest.MonkeyPatch, source: str
) -> None:
    env.p.select()
    original = env.helper.download
    source_url = env.p.CSVURL if source == "csv" else env.p.METAURL

    def changed_metadata(url: str, destination: Path, **kwargs: object) -> dict:
        metadata = original(url, destination, **kwargs)
        return {**metadata, "sha256": "f" * 64} if url == source_url else metadata

    derive = Mock(side_effect=AssertionError("Sources must be verified first"))
    monkeypatch.setattr(env.helper, "download", changed_metadata)
    monkeypatch.setattr(env.p, "_derive_selection", derive)
    gets, writes, before = (
        list(env.gets),
        list(env.publications),
        _snapshot(env.p.ROOT),
    )
    with pytest.raises(ValueError, match="changed during ledger verification"):
        env.p.pilot()
    derive.assert_not_called()
    assert env.requests[-1]["url"] == source_url
    assert env.requests[-1]["sha256"] is None
    assert env.gets == gets and _png_requests(env) == []
    assert env.publications == writes and _snapshot(env.p.ROOT) == before
    env.blocker.assert_not_called()


def test_pilot_only_one_header_fixture_and_proof_is_bound_and_idempotent(
    env: SimpleNamespace,
) -> None:
    selection = env.p.select()
    before = _snapshot(env.p.ASSETSROOT.parent)
    proof = env.p.pilot()
    image = selection["images"][0]
    url, path = env.p._image_url(image), env.p._image_cache(image)
    assert _png_gets(env) == [url]
    request = _png_requests(env)[-1]
    assert request["expected_size"] == request["max_bytes"] == image["byteSize"]
    assert request["sha256"] is None
    assert proof["sourceId"] == _id(1)
    assert {
        key: proof[key] for key in ("byteSize", "sha256")
    } == env.helper.file_metadata(path)
    assert proof["sha256"] != proof["sourceId"]
    assert proof["csvSha256"] == selection["sources"]["csv"]["sha256"]
    assert proof["indexSha256"] == selection["sources"]["index"]["sha256"]
    assert (
        proof["selectionSha256"] == hashlib.sha256(_json_bytes(selection)).hexdigest()
    )
    assert proof["boxCount"] == 2
    assert (
        proof["boxesSha256"] == hashlib.sha256(_json_bytes(image["boxes"])).hexdigest()
    )
    assert proof["sourceFilename"] == _id(1) + ".png"
    assert proof["publishedFilename"] == _id(1) + ".png"
    assert proof["detectedFormat"] == "png"
    assert proof["imageCheck"] == env.p.IMAGE_CHECK
    assert b"IDAT" in path.read_bytes() and path.read_bytes().endswith(
        _chunk(b"IEND", b"")
    )
    saved = env.p.CACHEDIR / "pilot.json"
    assert saved.read_bytes() == _json_bytes(proof)
    modified = saved.stat().st_mtime_ns
    assert env.p.pilot() == proof and _png_gets(env) == [url]
    assert _png_requests(env)[-1]["sha256"] == proof["sha256"]
    assert saved.stat().st_mtime_ns == modified
    assert len(list((env.p.CACHEDIR / "images").glob("*.png"))) == 1
    assert _snapshot(env.p.ASSETSROOT.parent) == before
    _assert_no_asset_publication(env)


def test_stage_preserves_all_originals_boxes_and_exact_manifest_shape(
    env: SimpleNamespace,
) -> None:
    selection = env.p.select()
    proof = env.p.pilot()
    notices = {
        name: (env.p.ASSETSROOT / name).read_bytes()
        for name in ("LICENSE.txt", "ATTRIBUTION.txt")
    }
    request_start = len(_png_requests(env))
    manifest = env.p.stage()
    requests = _png_requests(env)[request_start:]
    expected_urls = [env.p._image_url(image) for image in selection["images"]]
    assert _png_gets(env) == expected_urls  # One pilot + exactly 19 new bodies.
    assert [request["url"] for request in requests] == expected_urls
    assert requests[0]["sha256"] == proof["sha256"]  # Offline pilot recheck.
    assert env.gets.count(env.p.CSVURL) == 1
    assert env.gets.count(env.p.METAURL) == 1
    assert set(manifest) == {
        "schemaVersion",
        "sampleVersion",
        "sourceSplit",
        "id",
        "taskType",
        "source",
        "licenses",
        "images",
        "files",
    }
    assert manifest["schemaVersion"] == manifest["sampleVersion"] == 1
    assert manifest["sourceSplit"] == "train" and manifest["id"] == "gwhd-2021"
    assert manifest["taskType"] == "detection"
    assert manifest["source"] == {
        "dataset": "Global Wheat Head Dataset 2021",
        "version": "1.0",
        "url": env.p.CSVURL,
        **env.helper.file_metadata(env.fixtures[env.p.CSVURL]),
    }
    assert manifest["licenses"] == {"images": "CC-BY-4.0", "annotations": "CC-BY-4.0"}
    assert len(manifest["images"]) == 20
    assert len({image["sha256"] for image in manifest["images"]}) == 20
    for number, image in enumerate(manifest["images"], 1):
        assert set(image) == {
            "path",
            "sourceId",
            "sourceFilename",
            "detectedFormat",
            "domain",
            "byteSize",
            "sha256",
        }
        assert (
            image["sourceId"] == _id(number)
            and image["path"] == "images/" + _id(number) + ".png"
            and image["sourceFilename"] == _id(number) + ".png"
            and image["detectedFormat"] == "png"
        )
        assert type(image["domain"]) is str
        assert image["domain"] == f"Arvalis_{number % 4 + 1}"
        target = env.p.ASSETSROOT / image["path"]
        assert (
            target.read_bytes() == env.fixtures[expected_urls[number - 1]].read_bytes()
        )
        assert {
            key: image[key] for key in ("byteSize", "sha256")
        } == env.helper.file_metadata(target)
        assert image["sha256"] != image["sourceId"]
    assert [file["path"] for file in manifest["files"]] == [
        "LICENSE.txt",
        "ATTRIBUTION.txt",
        "annotations.coco.json",
    ]
    for file in manifest["files"]:
        assert file == {
            "path": file["path"],
            **env.helper.file_metadata(env.p.ASSETSROOT / file["path"]),
        }
    coco = json.loads((env.p.ASSETSROOT / "annotations.coco.json").read_bytes())
    assert coco["categories"] == [{"id": 1, "name": "wheat_head"}]
    assert coco["info"]["version"] == "1.0"
    assert len(coco["images"]) == 20 and len(coco["annotations"]) == 40
    for number, image in enumerate(coco["images"], 1):
        assert image == {
            "id": number,
            "file_name": _id(number) + ".png",
            "width": 1024,
            "height": 1024,
        }
    for index, annotation in enumerate(coco["annotations"]):
        image_id, box_index = index // 2 + 1, index % 2
        bbox = [0, 1, 2, 2] if box_index == 0 else [1023, 1023, 1, 1]
        assert annotation == {
            "id": index + 1,
            "image_id": image_id,
            "category_id": 1,
            "bbox": bbox,
            "area": bbox[2] * bbox[3],
            "iscrowd": 0,
        }
        x, y, width, height = annotation["bbox"]
        assert [x, y, x + width, y + height] == selection["images"][image_id - 1][
            "boxes"
        ][box_index]
    for name, original in notices.items():
        assert (env.p.ASSETSROOT / name).read_bytes() == original
    assert len(list((env.p.ASSETSROOT / "images").iterdir())) == 20
    for name in ("annotations.coco.json", "manifest.json"):
        raw = (env.p.ASSETSROOT / name).read_bytes()
        assert raw == _json_bytes(json.loads(raw)) and b"\r" not in raw
    snapshot, gets = _snapshot(env.p.ASSETSROOT.parent), list(env.gets)
    times = {
        path: path.stat().st_mtime_ns
        for path in env.p.ASSETSROOT.rglob("*")
        if path.is_file()
    }
    assert env.p.stage() == manifest
    assert _snapshot(env.p.ASSETSROOT.parent) == snapshot and env.gets == gets
    assert all(path.stat().st_mtime_ns == time for path, time in times.items())


def test_unicode_domains_reach_manifest_without_class_mapping(
    env: SimpleNamespace,
) -> None:
    domains = [
        "Arvalis_1",
        "ETHZ_1",
        "Inrae_1",
        "NMBU_1",
        "NMBU_2",
        "Rres_1",
        "ULiège-GxABT_1",
        " Ü ",
        "U\u0308",
    ]
    rows = [
        _row(number, domain=domains[(number - 1) % len(domains)])
        for number in range(21, 0, -1)
    ]
    env.set_csv(_csv_bytes(rows))
    expected = [row[2] for row in sorted(rows)[:20]]
    selection = env.p.select()
    saved = json.loads((env.p.CACHEDIR / "selection.json").read_bytes())
    assert [image["domain"] for image in selection["images"]] == expected
    assert [image["domain"] for image in saved["images"]] == expected
    env.p.pilot()
    manifest = env.p.stage()
    raw = (env.p.ASSETSROOT / "manifest.json").read_bytes()
    assert [image["domain"] for image in manifest["images"]] == expected
    assert [image["domain"] for image in json.loads(raw)["images"]] == expected
    assert "ULiège-GxABT_1".encode() in raw
    coco = json.loads((env.p.ASSETSROOT / "annotations.coco.json").read_bytes())
    assert coco["categories"] == [{"id": 1, "name": "wheat_head"}]
    assert {annotation["category_id"] for annotation in coco["annotations"]} == {1}


def test_no_box_keeps_the_image_and_duplicate_boxes_are_not_filtered(
    env: SimpleNamespace,
) -> None:
    rows = [_row(i) for i in range(1, 22)]
    rows[0][1] = "no_box"
    rows[1][1] = "0 0 1 1;0 0 1 1"
    env.set_csv(_csv_bytes(rows))
    selection = env.p.select()
    assert selection["images"][0]["boxes"] == []
    coco = env.p.build_coco(selection)
    assert len(coco["images"]) == 20 and len(coco["annotations"]) == 38
    assert not any(annotation["image_id"] == 1 for annotation in coco["annotations"])
    assert [annotation["bbox"] for annotation in coco["annotations"][:2]] == [
        [0, 0, 1, 1]
    ] * 2


@pytest.mark.parametrize(
    "boxes",
    [
        pytest.param("", id="blank"),
        pytest.param(" ", id="whitespace"),
        pytest.param("nan", id="nan"),
        pytest.param("nonsense", id="text"),
        pytest.param("[]", id="array"),
        pytest.param("no_box ", id="spaced-no-box"),
        pytest.param("no_box;0 0 1 1", id="mixed-no-box"),
        pytest.param("0 0 1", id="three-values"),
        pytest.param("0 0 1 1 2", id="five-values"),
        pytest.param("0 0 1 1;", id="trailing-semicolon"),
        pytest.param(";0 0 1 1", id="leading-semicolon"),
        pytest.param("0 0 1 1;;0 0 2 2", id="empty-box"),
        pytest.param("-1 0 1 1", id="negative-xmin"),
        pytest.param("0 -1 1 1", id="negative-ymin"),
        pytest.param("0 0 -1 1", id="negative-xmax"),
        pytest.param("0 0 1 -1", id="negative-ymax"),
        pytest.param("0 0 1025 1", id="outside-x"),
        pytest.param("0 0 1 1025", id="outside-y"),
        pytest.param("1 0 1 1", id="zero-width"),
        pytest.param("0 1 1 1", id="zero-height"),
        pytest.param("2 0 1 1", id="reversed-x"),
        pytest.param("0 2 1 1", id="reversed-y"),
        pytest.param("0.0 0 1 1", id="float-min"),
        pytest.param("0 0 1.5 1", id="float-max"),
        pytest.param("nan 0 1 1", id="nan-coordinate"),
        pytest.param("0 0 inf 1", id="infinity"),
        pytest.param("+0 0 1 1", id="plus-min"),
        pytest.param("0 0 +1 1", id="plus-max"),
        pytest.param("０ 0 1 1", id="unicode-digit"),
    ],
)
def test_malformed_or_invalid_boxes_are_never_empty(
    env: SimpleNamespace, boxes: str
) -> None:
    with pytest.raises(ValueError):
        env.p.parse_csv(_csv_bytes([_row(1, boxes)]))


@pytest.mark.parametrize(
    "domain",
    [
        pytest.param("", id="empty"),
        pytest.param("   ", id="space-only"),
        pytest.param("\u00a0\u3000\ufeff\u2028\u2029", id="unicode-blank"),
        pytest.param("Ü" * 129, id="overlong"),
        pytest.param("\U0001f33e" * 65, id="overlong-utf16"),
        *[
            pytest.param("private-fixture" + chr(code), id=f"ascii-control-{code:02x}")
            for code in (*range(32), 127)
        ],
    ],
)
def test_domain_rejects_blank_control_or_overlong_names_without_echo(
    env: SimpleNamespace, domain: str
) -> None:
    with pytest.raises(ValueError) as error:
        env.p.parse_csv(_csv_bytes([_row(1, domain=domain)]))
    assert str(error.value) == "Invalid CSV domain provenance name"
    assert env.requests == [] and env.publications == []


@pytest.mark.parametrize(
    "domain",
    [
        "Arvalis_1",
        "ETHZ_1",
        "Inrae_1",
        "NMBU_1",
        "NMBU_2",
        "Rres_1",
        "ULiège-GxABT_1",
        "0",
        "0001",
        "-1",
        "+1",
        "-0",
        "1.0",
        "1e0",
        "nan",
        "True",
        " 1",
        "1 ",
        "١",
        str(2**53),
        _id(1),
        "../Ü.png",
        pytest.param(" \u00a0ULiège-GxABT_1\ufeff ", id="untrimmed-name"),
        pytest.param("ULie\u0300ge-GxABT_1", id="decomposed-name"),
        pytest.param("Ü", id="single-unicode-character"),
        pytest.param("Ü" * 128, id="max-length"),
        pytest.param("\U0001f33e" * 64, id="max-utf16-length"),
        pytest.param("\u0085", id="non-ascii-not-js-trim-whitespace"),
        pytest.param("\u200b", id="zero-width-space"),
    ],
)
def test_domain_names_are_preserved_as_provenance_not_paths(
    env: SimpleNamespace, domain: str
) -> None:
    rows = env.p.parse_csv(_csv_bytes([_row(1, domain=domain)]))
    assert type(rows[0]["domain"]) is str and rows[0]["domain"] == domain
    assert env.p._image_url(rows[0]) == (
        env.p.METAURL + "/gwhd_2021/images/" + _id(1) + ".png"
    )
    assert env.p._image_cache(rows[0]) == (
        env.p.CACHEDIR / "images" / (_id(1) + ".png")
    )
    assert env.requests == [] and env.publications == []


def test_coordinate_edges_and_unicode_domain(env: SimpleNamespace) -> None:
    rows = env.p.parse_csv(
        _csv_bytes([_row(1, "0 0 1024 1024;0 0 1 1", "ULiège-GxABT_1")])
    )
    assert rows == [
        {
            "sourceId": _id(1),
            "domain": "ULiège-GxABT_1",
            "boxes": [[0, 0, 1024, 1024], [0, 0, 1, 1]],
        }
    ]


def test_png_source_filename_normalizes_to_bare_source_id(
    env: SimpleNamespace,
) -> None:
    source_id = "4563856cc6d75c670eafd86d5eb7245fbe8f273c28f9e36f7c6aaf097c7ce423"
    source_filename = source_id + ".png"
    rows = env.p.parse_csv(_csv_bytes([[source_filename, _BOXES, "Arvalis_1"]]))
    assert rows == [
        {
            "sourceId": source_id,
            "domain": "Arvalis_1",
            "boxes": [[0, 1, 2, 3], [1023, 1023, 1024, 1024]],
        }
    ]
    assert env.p._image_url(rows[0]) == (
        env.p.METAURL + "/gwhd_2021/images/" + source_filename
    )
    assert env.p._image_cache(rows[0]).name == source_filename
    assert env.requests == [] and env.publications == []


@pytest.mark.parametrize(
    "source_filename",
    [
        pytest.param("A" * 64 + ".png", id="uppercase"),
        pytest.param("g" * 64 + ".png", id="nonhex"),
        pytest.param("a" * 63 + ".png", id="short"),
        pytest.param("a" * 65 + ".png", id="long"),
        pytest.param(_id(1), id="bare-id"),
        pytest.param(_id(1) + ".PNG", id="uppercase-extension"),
        pytest.param(_id(1) + ".png.png", id="double-extension"),
        pytest.param(_id(1) + ".jpg", id="other-extension"),
        pytest.param(_id(1) + ".png\n", id="newline"),
        pytest.param(" " + _id(1) + ".png", id="leading-whitespace"),
        pytest.param(_id(1) + ".png ", id="trailing-whitespace"),
        pytest.param("../" + "a" * 61 + ".png", id="traversal"),
        pytest.param("..\\" + "a" * 61 + ".png", id="windows-traversal"),
        pytest.param("", id="empty"),
    ],
)
def test_only_lowercase_64_hex_png_source_filenames(
    env: SimpleNamespace, source_filename: str
) -> None:
    with pytest.raises(ValueError, match="Invalid train CSV row or image ID"):
        env.p.parse_csv(_csv_bytes([[source_filename, _BOXES, "0"]]))


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param(_csv_bytes([_row(1)], _HEADER + ["extra"]), id="extra-header"),
        pytest.param(
            _csv_bytes([_row(1)], ["domain", "BoxesString", "image_name"]),
            id="reordered-header",
        ),
        pytest.param(b"\xef\xbb\xbf" + _csv_bytes([_row(1)]), id="bom-header"),
        pytest.param(_csv_bytes([_row(1) + ["extra"]]), id="extra-cell"),
        pytest.param(_csv_bytes([_row(1)[:2]]), id="missing-cell"),
        pytest.param(_csv_bytes([[]]), id="empty-row"),
        pytest.param(_csv_bytes([]) + b'"unterminated', id="broken-quote"),
        pytest.param(_csv_bytes([]) + b"\xff", id="invalid-utf8"),
        pytest.param(b"", id="empty-source"),
    ],
)
def test_exact_csv_header_and_row_schema(env: SimpleNamespace, raw: bytes) -> None:
    with pytest.raises(ValueError):
        env.p.parse_csv(raw)


@pytest.mark.parametrize(
    "kind", ["duplicate-last", "invalid-unselected", "fewer-than-20"]
)
def test_entire_train_csv_is_checked_before_selection(
    env: SimpleNamespace, kind: str
) -> None:
    rows = [_row(i) for i in range(1, 22)]
    if kind == "duplicate-last":
        rows.append(_row(1))
    elif kind == "invalid-unselected":
        rows[-1][1] = "nan"
    else:
        rows = rows[:19]
    env.set_csv(_csv_bytes(rows))
    with pytest.raises(ValueError):
        env.p.select()
    assert not (env.p.CACHEDIR / "selection.json").exists() and _png_gets(env) == []


def test_missing_selected_entry_in_truncated_index_never_replaces_id(
    env: SimpleNamespace,
) -> None:
    env.index["entries"].remove(_entry(env, 1))
    _save_index(env)
    with pytest.raises(ValueError, match="absent"):
        env.p.select()
    assert env.gets == [env.p.METAURL, env.p.CSVURL]
    assert not (env.p.CACHEDIR / "selection.json").exists()


@pytest.mark.parametrize("casefold", [False, True])
def test_duplicate_index_keys_fail(env: SimpleNamespace, casefold: bool) -> None:
    duplicate = dict(_entry(env))
    if casefold:
        duplicate["key"] = duplicate["key"].upper()
    env.index["entries"].append(duplicate)
    _save_index(env)
    with pytest.raises(ValueError, match="Duplicate"):
        env.p.select()
    assert _png_gets(env) == []


@pytest.mark.parametrize(
    "size", [0, -1, True, False, 1.0, "97", None, 96 * 1024 * 1024 + 1]
)
def test_selected_image_size_pin_schema(env: SimpleNamespace, size: object) -> None:
    _entry(env)["size"] = size
    _save_index(env)
    with pytest.raises(ValueError, match="size"):
        env.p.select()
    assert _png_gets(env) == []


def test_selected_declared_sizes_are_summed_before_any_png_get(
    env: SimpleNamespace,
) -> None:
    for number in range(1, 21):
        _entry(env, number)["size"] = env.p.ASSET_LIMIT // 20 + 1
    _save_index(env)
    with pytest.raises(ValueError, match="sizes exceed"):
        env.p.select()
    assert _png_gets(env) == []


@pytest.mark.parametrize(
    "change",
    ["query", "fragment", "other-id", "archive", "mirror", "case", "missing-links"],
)
def test_selected_content_url_must_match_exactly_without_leaking_it(
    env: SimpleNamespace, change: str
) -> None:
    entry = _entry(env)
    original = entry["links"]["content"]
    changes = {
        "query": original + "?token=private-fixture",
        "fragment": original + "#private-fixture",
        "other-id": _entry(env, 22)["links"]["content"],
        "archive": env.p.METAURL.removesuffix("/container"),
        "mirror": original.replace("zenodo.org", "unknown.example"),
        "case": original.replace("zenodo.org", "ZENODO.ORG"),
    }
    if change == "missing-links":
        entry.pop("links")
    else:
        entry["links"]["content"] = changes[change]
    _save_index(env)
    with pytest.raises(ValueError) as error:
        env.p.select()
    assert "private-fixture" not in str(error.value) and "https://" not in str(
        error.value
    )
    assert env.gets == [env.p.METAURL, env.p.CSVURL]


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param(b"[]", id="array-root"),
        pytest.param(b"{}", id="no-entries"),
        pytest.param(b'{"entries":{}}', id="entries-object"),
        pytest.param(b'{"entries":[null]}', id="entry-null"),
        pytest.param(b'{"entries":[{"key":1}]}', id="key-number"),
        pytest.param(b'{"entries":[{"key":""}]}', id="key-empty"),
        pytest.param(b'{"entries":[],"entries":[]}', id="duplicate-root"),
        pytest.param(
            b'{"entries":[],"extra":{"content":1,"content":2}}', id="duplicate-nested"
        ),
        pytest.param(b'{"entries":[],"extra":NaN}', id="nonfinite-extra"),
        pytest.param(b" " * (2 * 1024 * 1024 + 1), id="index-overflow"),
    ],
)
def test_index_json_shape_duplicate_keys_and_bound(
    env: SimpleNamespace, raw: bytes
) -> None:
    env.fixtures[env.p.METAURL].write_bytes(raw)
    with pytest.raises(ValueError):
        env.p.select()
    assert not (env.p.CACHEDIR / "selection.json").exists() and _png_gets(env) == []


def test_combined_source_csv_and_selection_rebuild_keeps_acquisition_pin(
    env: SimpleNamespace,
) -> None:
    env.p.select()
    path = env.p.CACHEDIR / "competition_train.csv"
    raw = path.read_bytes()
    prefix = (_id(1) + ".png").encode("ascii")
    changed = raw.replace(prefix + b",0 1 2 3", prefix + b",1 1 2 3", 1)
    assert changed != raw and len(changed) == len(raw)
    path.write_bytes(changed)
    gets, writes, observations, before = (
        list(env.gets),
        list(env.publications),
        dict(env.observations),
        _snapshot(env.p.ROOT),
    )
    with pytest.raises(ValueError, match="SHA-256"):
        env.p._derive_selection()
    with pytest.raises(ValueError, match="observation"):
        env.p.pilot()
    assert env.gets == gets and _png_gets(env) == []
    assert env.publications == writes and env.observations == observations
    assert _snapshot(env.p.ROOT) == before
    env.blocker.assert_not_called()


def test_combined_source_index_and_selection_rebuild_keeps_acquisition_pin(
    env: SimpleNamespace,
) -> None:
    selection = env.p.select()
    path = env.p.CACHEDIR / "index.json"
    raw = path.read_bytes()
    index = json.loads(raw)
    key = "gwhd_2021/images/" + selection["images"][0]["sourceId"] + ".png"
    record = next(entry for entry in index["entries"] if entry["key"] == key)
    record["upstream_extra"]["not_a_sha256_pin"] = "changed"
    changed = _json_bytes(index)
    assert changed != raw and len(changed) == len(raw)
    path.write_bytes(changed)
    rebuilt = env.p._derive_selection()
    assert rebuilt["images"] == selection["images"]
    assert rebuilt["sources"]["index"] != selection["sources"]["index"]
    (env.p.CACHEDIR / "selection.json").write_bytes(_json_bytes(rebuilt))
    gets, writes, observations, before = (
        list(env.gets),
        list(env.publications),
        dict(env.observations),
        _snapshot(env.p.ROOT),
    )
    with pytest.raises(ValueError, match="observation"):
        env.p.pilot()
    assert env.gets == gets and _png_gets(env) == []
    assert env.publications == writes and env.observations == observations
    assert _snapshot(env.p.ROOT) == before
    env.blocker.assert_not_called()


@pytest.mark.parametrize(
    "target",
    [
        "selection-box",
        "selection-order",
        "selection-bool",
        "selection-whitespace",
        "csv",
        "index",
    ],
)
@pytest.mark.parametrize("command", ["pilot", "stage"])
def test_tampered_selection_or_sources_stop_before_later_gets_and_writes(
    env: SimpleNamespace, target: str, command: str
) -> None:
    env.p.select()
    env.p.pilot()
    selection_path = env.p.CACHEDIR / "selection.json"
    selection = json.loads(selection_path.read_bytes())
    if target.startswith("selection"):
        if target == "selection-box":
            selection["images"][0]["boxes"][0][0] = 1
        elif target == "selection-order":
            selection["images"].reverse()
        elif target == "selection-bool":
            selection["schemaVersion"] = True
        selection_path.write_bytes(
            _json_bytes(selection) + (b" " if target == "selection-whitespace" else b"")
        )
    elif target == "csv":
        path = env.p.CACHEDIR / "competition_train.csv"
        path.write_bytes(path.read_bytes().replace(b"0 1 2 3", b"1 1 2 3", 1))
    else:
        path = env.p.CACHEDIR / "index.json"
        path.write_bytes(path.read_bytes().replace(b'"total": 998', b'"total": 997'))
    requests, gets, writes, assets = (
        _png_requests(env),
        list(env.gets),
        list(env.publications),
        _snapshot(env.p.ASSETSROOT.parent),
    )
    with pytest.raises(ValueError):
        getattr(env.p, command)()
    assert _png_requests(env) == requests and env.gets == gets
    assert env.publications == writes and _snapshot(env.p.ASSETSROOT.parent) == assets


@pytest.mark.parametrize(
    "field,value",
    [
        ("sourceId", _id(2)),
        ("sha256", "f" * 64),
        ("byteSize", 98),
        ("csvSha256", "f" * 64),
        ("indexSha256", "f" * 64),
        ("selectionSha256", "f" * 64),
        ("boxesSha256", "f" * 64),
        ("boxCount", 1),
        ("schemaVersion", True),
        ("headerCheck", "full decode passed"),
    ],
)
def test_tampered_pilot_never_unlocks_stage_or_gets_rewritten(
    env: SimpleNamespace, field: str, value: object
) -> None:
    env.p.select()
    proof = env.p.pilot()
    proof[field] = value
    path = env.p.CACHEDIR / "pilot.json"
    raw = _json_bytes(proof)
    path.write_bytes(raw)
    requests, gets, writes = (
        _png_requests(env),
        list(env.gets),
        list(env.publications),
    )
    for command in (env.p.stage, env.p.pilot):
        with pytest.raises(ValueError):
            command()
    assert (
        path.read_bytes() == raw
        and _png_requests(env) == requests
        and env.gets == gets
        and env.publications == writes
    )


@pytest.mark.parametrize(
    "file,limit", [("selection.json", "SELECTION_LIMIT"), ("pilot.json", "PILOT_LIMIT")]
)
@pytest.mark.parametrize("kind", ["duplicate", "oversize"])
def test_control_json_duplicate_keys_and_bounds(
    env: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
    file: str,
    limit: str,
    kind: str,
) -> None:
    env.p.select()
    env.p.pilot()
    path = env.p.CACHEDIR / file
    if kind == "duplicate":
        path.write_bytes(path.read_bytes().replace(b"{", b'{"schemaVersion":1,', 1))
    else:
        monkeypatch.setattr(env.p, limit, path.stat().st_size - 1)
    requests, gets, writes = (
        _png_requests(env),
        list(env.gets),
        list(env.publications),
    )
    with pytest.raises(ValueError):
        env.p.stage()
    assert _png_requests(env) == requests and env.gets == gets
    assert env.publications == writes


@pytest.mark.parametrize("kind", ["hash", "missing", "empty"])
def test_pilot_cache_corruption_is_not_reacquired_by_stage(
    env: SimpleNamespace, kind: str
) -> None:
    selection = env.p.select()
    env.p.pilot()
    path = env.p._image_cache(selection["images"][0])
    if kind == "missing":
        path.unlink()
    elif kind == "empty":
        path.write_bytes(b"")
    else:
        path.write_bytes(path.read_bytes()[:-1] + b"x")  # Still a valid IHDR header.
    requests, gets = _png_requests(env), list(env.gets)
    with pytest.raises((ValueError, FileNotFoundError)):
        env.p.stage()
    assert _png_requests(env) == requests and env.gets == gets
    _assert_no_asset_publication(env)


def test_other_cached_png_tampering_is_checked_before_new_gets(
    env: SimpleNamespace,
) -> None:
    selection = env.p.select()
    env.p.pilot()
    second = selection["images"][1]
    path = env.p._image_cache(second)
    env.helper.download(
        env.p._image_url(second),
        path,
        expected_size=second["byteSize"],
        max_bytes=second["byteSize"],
    )
    path.write_bytes(path.read_bytes()[:-1] + b"x")
    gets = list(env.gets)
    with pytest.raises(ValueError, match="observation"):
        env.p.stage()
    assert env.gets == gets
    _assert_no_asset_publication(env)


@pytest.mark.parametrize(
    "kind",
    [
        "signature",
        "length",
        "first-chunk",
        "crc",
        "truncated",
        "width",
        "height",
        "depth",
        "color",
        "compression",
        "filter",
        "interlace",
    ],
)
def test_invalid_png_header_fixture_does_not_create_pilot(
    env: SimpleNamespace, kind: str
) -> None:
    raw = _header_fixture(1)
    if kind == "signature":
        raw = b"not-PNG!" + raw[8:]
    elif kind == "length":
        raw = _png_bytes(
            _chunk(b"IHDR", _ihdr()[:-1]),
            _chunk(b"IDAT", zlib.compress(_scanlines())),
            _chunk(b"IEND", b""),
        )
    elif kind == "first-chunk":
        raw = _png_bytes(
            _chunk(b"tEXt", b"before-ihdr\x00invalid"),
            _chunk(b"IHDR", _ihdr()),
            _chunk(b"IDAT", zlib.compress(_scanlines())),
            _chunk(b"IEND", b""),
        )
    elif kind == "crc":
        raw = raw[:29] + bytes([raw[29] ^ 1]) + raw[30:]
    elif kind == "truncated":
        raw = raw[:32]
    else:
        options = {
            "width": {"width": 512},
            "height": {"height": 0},
            "depth": {"depth": 3},
            "color": {"color": 1},
            "compression": {"compression": 1},
            "filter": {"filtering": 1},
            "interlace": {"interlace": 2},
        }
        raw = _header_fixture(1, **options[kind])
    entry = _entry(env)
    env.fixtures[entry["links"]["content"]].write_bytes(raw)
    entry["size"] = len(raw)
    _save_index(env)
    env.p.select()
    with pytest.raises(ValueError, match="image|Image|PNG|IHDR"):
        env.p.pilot()
    assert len(_png_gets(env)) == 1
    assert not (env.p.CACHEDIR / "pilot.json").exists()
    _assert_no_asset_publication(env)


def test_fixed_csv_allows_only_known_conflicts_outside_selected_ids(
    env: SimpleNamespace,
) -> None:
    rows = [_row(number) for number in range(1, 22)]
    rows.extend(
        [
            _row(21, boxes="1 1 3 3", domain="Other_1"),
            _row(22, boxes="2 2 4 4", domain="Other_2"),
            _row(22, boxes="3 3 5 5", domain="Other_3"),
        ]
    )
    raw = _csv_bytes(rows)
    env.set_csv(raw)
    env.p.KNOWN_SOURCE_CONFLICT_LINES = {
        _id(21): (22, 23),
        _id(22): (24, 25),
    }
    selection = env.p.select()
    assert selection["trainRowCount"] == 24
    assert selection["uniqueImageCount"] == 22
    assert [image["sourceId"] for image in selection["images"]] == [
        _id(number) for number in range(1, 21)
    ]
    assert selection["sourceWarnings"] == [
        {
            "code": "KNOWN_SOURCE_CONFLICT_OUTSIDE_SELECTION",
            "sourceId": _id(21),
            "lineNumbers": [22, 23],
        },
        {
            "code": "KNOWN_SOURCE_CONFLICT_OUTSIDE_SELECTION",
            "sourceId": _id(22),
            "lineNumbers": [24, 25],
        },
    ]
    assert _png_gets(env) == []


@pytest.mark.parametrize("kind", ["unknown-outside", "known-lines-changed", "selected"])
def test_duplicate_policy_rejects_any_unapproved_or_selected_conflict(
    env: SimpleNamespace, kind: str
) -> None:
    rows = [_row(number) for number in range(1, 23)]
    if kind == "selected":
        rows.append(_row(1, boxes="1 1 3 3", domain="Other"))
        known = {_id(1): (2, 24)}
    else:
        rows.append(_row(22, boxes="1 1 3 3", domain="Other"))
        known = {_id(22): (23, 24)}
        if kind == "unknown-outside":
            known = {}
        else:
            known = {_id(22): (23, 25)}
    env.set_csv(_csv_bytes(rows))
    env.p.KNOWN_SOURCE_CONFLICT_LINES = known
    with pytest.raises(ValueError, match="duplicated|duplicate set"):
        env.p.select()
    assert not (env.p.CACHEDIR / "selection.json").exists()
    assert _png_gets(env) == []


@pytest.mark.parametrize("kind", ["zlib", "filter", "trailing", "missing-iend"])
def test_full_png_decode_rejects_body_corruption(
    env: SimpleNamespace, kind: str
) -> None:
    raw = _header_fixture(1)
    if kind == "zlib":
        offset = raw.index(b"IDAT")
        data_start = offset + 4
        raw = raw[:data_start] + bytes([raw[data_start] ^ 1]) + raw[data_start + 1 :]
        chunk_start = offset - 4
        length = struct.unpack(">I", raw[chunk_start:offset])[0]
        data = raw[data_start : data_start + length]
        crc_start = data_start + length
        raw = (
            raw[:crc_start]
            + struct.pack(">I", zlib.crc32(b"IDAT" + data))
            + raw[crc_start + 4 :]
        )
    elif kind == "filter":
        scanlines = b"\x05" + bytes(128) + (b"\x00" + bytes(128)) * 1023
        ihdr_end = 8 + len(
            _chunk(b"IHDR", struct.pack(">IIBBBBB", 1024, 1024, 1, 0, 0, 0, 0))
        )
        raw = (
            raw[:ihdr_end]
            + _chunk(b"IDAT", zlib.compress(scanlines))
            + _chunk(b"IEND", b"")
        )
    elif kind == "trailing":
        raw += b"x"
    else:
        raw = raw[: -len(_chunk(b"IEND", b""))]
    entry = _entry(env)
    env.fixtures[entry["links"]["content"]].write_bytes(raw)
    entry["size"] = len(raw)
    _save_index(env)
    env.p.select()
    with pytest.raises(ValueError, match="image|PNG|zlib"):
        env.p.pilot()
    assert not (env.p.CACHEDIR / "pilot.json").exists()
    _assert_no_asset_publication(env)


def test_mixed_jpeg_and_png_preserve_source_bytes_and_publish_true_extensions(
    env: SimpleNamespace,
) -> None:
    first = _entry(env, 1)
    source = env.fixtures[first["links"]["content"]]
    jpeg = _jpeg_fixture(1)
    source.write_bytes(jpeg)
    first["size"] = len(jpeg)
    _save_index(env)

    selection = env.p.select()
    proof = env.p.pilot()
    assert proof["sourceFilename"] == _id(1) + ".png"
    assert proof["publishedFilename"] == _id(1) + ".jpg"
    assert proof["detectedFormat"] == "jpeg"
    assert env.p._image_cache(selection["images"][0]).read_bytes() == jpeg
    manifest = env.p.stage()

    first_manifest = manifest["images"][0]
    assert first_manifest == {
        "path": "images/" + _id(1) + ".jpg",
        "sourceId": _id(1),
        "sourceFilename": _id(1) + ".png",
        "detectedFormat": "jpeg",
        "domain": "Arvalis_2",
        **env.helper.file_metadata(source),
    }
    published = env.p.ASSETSROOT / first_manifest["path"]
    assert published.read_bytes() == jpeg
    assert not (env.p.ASSETSROOT / "images" / (_id(1) + ".png")).exists()
    assert all(
        image["detectedFormat"] == "png" and image["path"].endswith(".png")
        for image in manifest["images"][1:]
    )
    coco = json.loads((env.p.ASSETSROOT / "annotations.coco.json").read_bytes())
    assert coco["images"][0]["file_name"] == _id(1) + ".jpg"
    assert all(image["file_name"].endswith(".png") for image in coco["images"][1:])
    assert env.p.stage() == manifest
    assert published.read_bytes() == jpeg


@pytest.mark.parametrize(
    "width,height",
    [
        pytest.param(1023, 1024, id="wrong-width"),
        pytest.param(1024, 1023, id="wrong-height"),
    ],
)
def test_jpeg_pilot_requires_exact_dimensions_without_publication(
    env: SimpleNamespace, width: int, height: int
) -> None:
    first = _entry(env, 1)
    raw = _jpeg_fixture(1, width=width, height=height)
    env.fixtures[first["links"]["content"]].write_bytes(raw)
    first["size"] = len(raw)
    _save_index(env)

    env.p.select()
    with pytest.raises(ValueError, match="one 1024x1024 frame"):
        env.p.pilot()

    assert not (env.p.CACHEDIR / "pilot.json").exists()
    _assert_no_asset_publication(env)


@pytest.mark.parametrize(
    "depth,color,interlace",
    [
        pytest.param(1, 0, 1, id="adam7-packed-grayscale"),
        pytest.param(8, 2, 1, id="adam7-rgb"),
        pytest.param(16, 6, 1, id="adam7-rgba16"),
    ],
)
def test_full_png_decode_accepts_valid_adam7_passes(
    env: SimpleNamespace, depth: int, color: int, interlace: int
) -> None:
    raw = _header_fixture(1, depth=depth, color=color, interlace=interlace)
    env.p._decode_png(raw)


def test_indexed_png_rejects_sample_outside_palette(env: SimpleNamespace) -> None:
    valid = _header_fixture(1, depth=1, color=3, palette_entries=1, pixel_byte=0)
    env.p._decode_png(valid)
    invalid = _header_fixture(1, depth=1, color=3, palette_entries=1, pixel_byte=0x80)
    with pytest.raises(ValueError, match="palette index"):
        env.p._decode_png(invalid)


@pytest.mark.parametrize(
    "kind",
    [
        "duplicate-ihdr",
        "duplicate-plte",
        "plte-after-idat",
        "noncontiguous-idat",
        "unknown-critical",
        "reserved-bit",
        "idat-crc",
        "iend-crc",
    ],
)
def test_png_chunk_order_type_and_crc_rules(env: SimpleNamespace, kind: str) -> None:
    ihdr = _chunk(b"IHDR", _ihdr(depth=1, color=3))
    palette = _chunk(b"PLTE", b"\x00\x00\x00")
    compressed = zlib.compress(_scanlines(depth=1, color=3))
    first, second = (
        compressed[: len(compressed) // 2],
        compressed[len(compressed) // 2 :],
    )
    chunks = [ihdr, palette, _chunk(b"IDAT", compressed), _chunk(b"IEND", b"")]
    if kind == "duplicate-ihdr":
        chunks.insert(1, ihdr)
    elif kind == "duplicate-plte":
        chunks.insert(2, palette)
    elif kind == "plte-after-idat":
        chunks = [ihdr, _chunk(b"IDAT", compressed), palette, _chunk(b"IEND", b"")]
    elif kind == "noncontiguous-idat":
        chunks = [
            ihdr,
            palette,
            _chunk(b"IDAT", first),
            _chunk(b"tEXt", b"gap\x00invalid"),
            _chunk(b"IDAT", second),
            _chunk(b"IEND", b""),
        ]
    elif kind == "unknown-critical":
        chunks.insert(2, _chunk(b"ABCD", b"unknown"))
    elif kind == "reserved-bit":
        chunks.insert(2, _chunk(b"ABcD", b"invalid"))
    elif kind == "idat-crc":
        chunks[2] = chunks[2][:-1] + bytes([chunks[2][-1] ^ 1])
    else:
        chunks[-1] = chunks[-1][:-1] + bytes([chunks[-1][-1] ^ 1])
    with pytest.raises(ValueError, match="PNG|critical|reserved|CRC"):
        env.p._decode_png(_png_bytes(*chunks))


@pytest.mark.parametrize(
    "kind", ["compressed-trailing", "incomplete", "expanded-overflow"]
)
def test_png_zlib_stream_must_end_exactly_at_bounded_scanline_size(
    env: SimpleNamespace, kind: str
) -> None:
    scanlines = _scanlines()
    if kind == "compressed-trailing":
        compressed = zlib.compress(scanlines) + zlib.compress(b"trailing")
    elif kind == "incomplete":
        compressed = zlib.compress(scanlines)[:-1]
    else:
        compressed = zlib.compress(scanlines + b"x")
    raw = _png_bytes(
        _chunk(b"IHDR", _ihdr()),
        _chunk(b"IDAT", compressed),
        _chunk(b"IEND", b""),
    )
    with pytest.raises(ValueError, match="zlib|scanline"):
        env.p._decode_png(raw)


def test_zero_byte_png_body_stops_without_proof(env: SimpleNamespace) -> None:
    env.fixtures[_entry(env)["links"]["content"]].write_bytes(b"")
    env.p.select()
    with pytest.raises(ValueError, match="size"):
        env.p.pilot()
    assert not (env.p.CACHEDIR / "pilot.json").exists()
    _assert_no_asset_publication(env)


def test_duplicate_actual_image_hash_fails_before_any_asset_write(
    env: SimpleNamespace,
) -> None:
    first, second = _entry(env, 1), _entry(env, 2)
    env.fixtures[second["links"]["content"]].write_bytes(
        env.fixtures[first["links"]["content"]].read_bytes()
    )
    env.p.select()
    env.p.pilot()
    with pytest.raises(ValueError, match="Duplicate observed"):
        env.p.stage()
    assert len(_png_gets(env)) == 2
    _assert_no_asset_publication(env)
    assert not (env.p.ASSETSROOT / "images").exists()


@pytest.mark.parametrize("kind", ["extra", "zero-existing-image"])
def test_unexpected_or_empty_existing_image_never_gets_removed(
    env: SimpleNamespace, kind: str
) -> None:
    env.p.select()
    env.p.pilot()
    path = env.p.ASSETSROOT / "images" / (_id(22 if kind == "extra" else 1) + ".png")
    path.parent.mkdir()
    raw = _header_fixture(22) if kind == "extra" else b""
    path.write_bytes(raw)
    requests, gets = _png_requests(env), list(env.gets)
    with pytest.raises(ValueError):
        env.p.stage()
    assert path.read_bytes() == raw and _png_requests(env) == requests
    assert env.gets == gets
    _assert_no_asset_publication(env)


@pytest.mark.parametrize(
    "target", ["selection", "pilot", "image", "annotations", "manifest"]
)
def test_existing_different_outputs_are_never_overwritten(
    env: SimpleNamespace, target: str
) -> None:
    if target == "selection":
        env.p.CACHEDIR.mkdir(parents=True)
        path = env.p.CACHEDIR / "selection.json"
        path.write_bytes(b"foreign selection\n")
        action = env.p.select
    elif target == "pilot":
        env.p.select()
        path = env.p.CACHEDIR / "pilot.json"
        path.write_bytes(b"foreign pilot\n")
        action = env.p.pilot
    else:
        env.p.select()
        env.p.pilot()
        env.p.stage()
        paths = {
            "image": "images/" + _id(1) + ".png",
            "annotations": "annotations.coco.json",
            "manifest": "manifest.json",
        }
        path = env.p.ASSETSROOT / paths[target]
        path.write_bytes(path.read_bytes()[:-1] + b"x")
        action = env.p.stage
    raw, assets, writes = (
        path.read_bytes(),
        _snapshot(env.p.ASSETSROOT.parent),
        list(env.publications),
    )
    with pytest.raises((ValueError, FileExistsError)):
        action()
    assert path.read_bytes() == raw and _snapshot(env.p.ASSETSROOT.parent) == assets
    if target != "selection":
        assert env.publications == writes


def _projected_total(env: SimpleNamespace, selection: dict) -> tuple[int, int]:
    """Predict from genuine fixture hashes, including both datasets and both JSONs."""
    metadata = [
        {
            **env.helper.file_metadata(env.fixtures[env.p._image_url(image)]),
            "detectedFormat": "png",
        }
        for image in selection["images"]
    ]
    coco = _json_bytes(env.p.build_coco(selection, metadata))
    manifest = _json_bytes(
        env.p._manifest_document(selection, metadata, env.p._notice_files(coco))
    )
    planned = {
        env.p.ASSETSROOT / "images" / env.p._published_filename(image, observed): image[
            "byteSize"
        ]
        for image, observed in zip(selection["images"], metadata, strict=True)
    }
    planned[env.p.ASSETSROOT / "annotations.coco.json"] = len(coco)
    planned[env.p.ASSETSROOT / "manifest.json"] = len(manifest)
    existing = sum(
        path.stat().st_size
        for path in env.p.ASSETSROOT.parent.rglob("*")
        if path.is_file()
    )
    missing = sum(size for path, size in planned.items() if not path.exists())
    return existing + missing, missing


@pytest.mark.parametrize("delta", [-1, 0], ids=["one-byte-over", "exact-boundary"])
def test_combined_projected_limit_includes_other_dataset_json_and_notices(
    env: SimpleNamespace, monkeypatch: pytest.MonkeyPatch, delta: int
) -> None:
    selection = env.p.select()
    env.p.pilot()
    first = selection["images"][0]
    target = env.p.ASSETSROOT / "images" / (first["sourceId"] + ".png")
    target.parent.mkdir()
    target.write_bytes(env.p._image_cache(first).read_bytes())
    modified = target.stat().st_mtime_ns
    total, _ = _projected_total(env, selection)
    monkeypatch.setattr(env.p, "ASSET_LIMIT", total + delta)
    gets = list(env.gets)
    if delta < 0:
        with pytest.raises(ValueError, match="Combined"):
            env.p.stage()
        assert env.gets == gets
        _assert_no_asset_publication(env)
    else:
        env.p.stage()
        actual = sum(
            path.stat().st_size
            for path in env.p.ASSETSROOT.parent.rglob("*")
            if path.is_file()
        )
        assert actual == total
    assert target.stat().st_mtime_ns == modified


@pytest.mark.parametrize("command", ["select", "pilot", "stage"])
def test_disk_preflight_happens_before_phase_writes_or_gets(
    env: SimpleNamespace, command: str
) -> None:
    if command != "select":
        env.p.select()
    if command == "stage":
        env.p.pilot()
    gets, writes = list(env.gets), list(env.publications)
    env.disk.free = 0
    with pytest.raises(ValueError, match="free space"):
        getattr(env.p, command)()
    assert env.gets == gets and env.publications == writes
    assert env.disk.calls


def test_twenty_percent_margin_includes_download_and_missing_publication_bytes(
    env: SimpleNamespace,
) -> None:
    selection = env.p.select()
    env.p.pilot()
    _, missing_assets = _projected_total(env, selection)
    missing_cache = sum(image["byteSize"] for image in selection["images"][1:])
    required = ((missing_assets + missing_cache) * 6 + 4) // 5
    gets = list(env.gets)
    env.disk.free = required - 1
    with pytest.raises(ValueError, match="20%"):
        env.p.stage()
    assert env.gets == gets
    env.disk.free = required
    env.p.stage()
    assert len(_png_gets(env)) == 20


def test_select_shared_helper_refuses_unobserved_existing_cache(
    env: SimpleNamespace,
) -> None:
    env.p.CACHEDIR.mkdir(parents=True)
    path = env.p.CACHEDIR / "index.json"
    raw = env.fixtures[env.p.METAURL].read_bytes()
    path.write_bytes(raw)
    with pytest.raises(ValueError, match="observation"):
        env.p.select()
    assert path.read_bytes() == raw and env.gets == []


def test_source_change_during_download_is_caught_before_asset_publication(
    env: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    env.p.select()
    env.p.pilot()
    original = env.helper.download

    def changed_source(url: str, destination: Path, **kwargs: object) -> dict:
        metadata = original(url, destination, **kwargs)
        if url.endswith(_id(20) + ".png"):
            path = env.p.CACHEDIR / "competition_train.csv"
            path.write_bytes(path.read_bytes().replace(b"0 1 2 3", b"1 1 2 3", 1))
        return metadata

    monkeypatch.setattr(env.helper, "download", changed_source)
    with pytest.raises(ValueError, match="observation"):
        env.p.stage()
    _assert_no_asset_publication(env)


def test_build_manifest_reads_final_notices_and_rejects_unobserved_hashes(
    env: SimpleNamespace,
) -> None:
    selection = env.p.select()
    env.p.pilot()
    env.p.stage()
    metadata = [
        {
            **env.helper.file_metadata(env.p._image_cache(image)),
            "detectedFormat": "png",
        }
        for image in selection["images"]
    ]
    notice = env.p.ASSETSROOT / "ATTRIBUTION.txt"
    notice.write_bytes("親担当が確定した通知\r\n".encode())
    gets, writes = list(env.gets), list(env.publications)
    manifest = env.p.build_manifest(selection, metadata)
    assert manifest["files"][1] == {
        "path": "ATTRIBUTION.txt",
        **env.helper.file_metadata(notice),
    }
    assert env.gets == gets and env.publications == writes
    metadata[0] = {**metadata[0], "sha256": selection["images"][0]["sourceId"]}
    with pytest.raises(ValueError, match="actual cached"):
        env.p.build_manifest(selection, metadata)


@pytest.mark.parametrize(
    "argv",
    [
        ["select", "--count", "1"],
        ["pilot", "--url", "https://unknown.example"],
        ["all"],
        [],
    ],
)
def test_cli_does_not_accept_source_or_count_overrides(
    env: SimpleNamespace, argv: list[str]
) -> None:
    with pytest.raises(SystemExit) as error:
        env.p.main(argv)
    assert error.value.code == 2 and env.requests == []


def test_cli_prints_only_pilot_id_count_and_header_scope(
    env: SimpleNamespace, capsys: pytest.CaptureFixture[str]
) -> None:
    assert env.p.main(["select"]) == 0
    selected = capsys.readouterr()
    assert "21 CSV rows" in selected.out and "998" not in selected.out
    assert env.p.main(["pilot"]) == 0
    output = capsys.readouterr()
    assert output.out == f"pilot: {_id(1)}, boxes=2; {env.p.IMAGE_CHECK}\n"
    assert (
        output.err == "" and "https://" not in output.out and "[0, 1" not in output.out
    )


def test_invalid_unselected_domain_stops_with_fixed_cli_error(
    env: SimpleNamespace, capsys: pytest.CaptureFixture[str]
) -> None:
    rows = [_row(number) for number in range(1, 22)]
    rows[-1][2] = "private-fixture\x1b"
    env.set_csv(_csv_bytes(rows))
    with pytest.raises(SystemExit) as error:
        env.p.main(["select"])
    assert error.value.code == 1
    output = capsys.readouterr()
    assert output.out == ""
    assert output.err == (
        "GWHD preparation stopped: Invalid CSV domain provenance name\n"
    )
    assert not (env.p.CACHEDIR / "selection.json").exists()
    assert not (env.p.CACHEDIR / "pilot.json").exists()
    assert _png_requests(env) == []
    _assert_no_asset_publication(env)


def test_cli_io_errors_never_echo_upstream_private_details(
    env: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        env.helper,
        "download",
        Mock(side_effect=OSError("https://host/?token=private-fixture")),
    )
    with pytest.raises(SystemExit) as error:
        env.p.main(["select"])
    assert error.value.code == 1
    output = capsys.readouterr()
    assert "private-fixture" not in output.err and "https://" not in output.err
    assert "stopped" in output.err and output.out == ""
