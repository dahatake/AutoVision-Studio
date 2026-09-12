"""Offline DATA-02 fixtures; the parent owns execution and independent review.

Synthetic JPEG-magic bytes are NOT decodable image or normal DAT-03/DAT-04 evidence.
"""

import hashlib
import importlib.util
import io
import json
import stat
import sys
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest


def _load(monkeypatch, name, filename):
    spec = importlib.util.spec_from_file_location(
        name, Path(__file__).with_name(filename)
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, name, module)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def beans(tmp_path, monkeypatch):
    helper = _load(monkeypatch, "sample_io", "sample_io.py")
    monkeypatch.setattr(helper, "CACHE_ROOT", tmp_path / "cache")
    monkeypatch.setattr(
        helper, "download", Mock(side_effect=AssertionError("Unexpected download"))
    )
    module = _load(monkeypatch, "_data02_beans", "prepare_beans.py")
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "ASSETS_ROOT", tmp_path / "resources/samples/beans")
    monkeypatch.setattr(
        module.shutil, "disk_usage", Mock(return_value=SimpleNamespace(free=2**40))
    )
    return module


def _entries(beans, count=21):
    return [
        (
            f"train/{label}/{label}_train.{index}.jpg",
            b"\xff\xd8\xffsynthetic-only:" + f"{label}:{index}".encode(),
        )
        for label in beans.LABELS
        for index in range(count)
    ]


def _source(beans, monkeypatch, entries=None):
    buffer = io.BytesIO()
    replacements = []
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, data in reversed(_entries(beans) if entries is None else entries):
            if isinstance(name, str) and "\\" in name:
                # ZipInfo normalizes backslashes on Windows; restore them below.
                placeholder = name.replace("\\", "~")
                replacements.append((placeholder.encode(), name.encode()))
                name = zipfile.ZipInfo(placeholder)
            archive.writestr(name, data)
    raw = buffer.getvalue()
    for encoded_placeholder, encoded_name in replacements:
        assert len(encoded_placeholder) == len(encoded_name)
        assert raw.count(encoded_placeholder) == 2  # Local + central directory.
        raw = raw.replace(encoded_placeholder, encoded_name, 2)
    monkeypatch.setattr(beans, "EXPECTED_SIZE", len(raw))
    monkeypatch.setattr(beans, "EXPECTED_SHA256", hashlib.sha256(raw).hexdigest())

    def download(url, destination, **kwargs):
        assert url == beans.SOURCE_URL and destination == beans.CACHE / "train.zip"
        assert kwargs == {
            "expected_size": beans.EXPECTED_SIZE,
            "max_bytes": beans.EXPECTED_SIZE,
            "sha256": beans.EXPECTED_SHA256,
        }
        beans.sample_io.write_new(destination, raw)
        return beans.sample_io.file_metadata(destination)

    monkeypatch.setattr(beans.sample_io, "download", Mock(side_effect=download))
    return raw


@pytest.fixture
def selected(beans, monkeypatch):
    _source(beans, monkeypatch)
    selection = beans.prepare_selection()
    beans.sample_io.download.side_effect = AssertionError("Unexpected download")
    for name in ("LICENSE.txt", "ATTRIBUTION.txt"):
        beans.sample_io.write_new(beans.ASSETS_ROOT / name, b"Synthetic notice\r\n")
    return beans, selection


def _stage_all(beans):
    for label in beans.LABELS:
        beans.stage_class(label)


def test_import_is_inert(beans, monkeypatch):
    for name in ("download", "write_new", "file_metadata"):
        monkeypatch.setattr(
            beans.sample_io, name, Mock(side_effect=AssertionError("Import action"))
        )
    _load(monkeypatch, "_data02_import_check", "prepare_beans.py")
    assert not beans.CACHE.exists() and not beans.ASSETS_ROOT.exists()
    beans.shutil.disk_usage.assert_not_called()


def test_selection_is_stable_pinned_and_unpublished(beans, monkeypatch):
    entries = _entries(beans) + [("README.txt", b"Ignored metadata"), ("train/", b"")]
    _source(beans, monkeypatch, entries)
    first = beans.prepare_selection()
    saved = (beans.CACHE / "selection.json").read_bytes()
    assert beans.prepare_selection() == first
    assert saved == beans._json(first) == (beans.CACHE / "selection.json").read_bytes()
    assert first["sourceCounts"] == dict.fromkeys(beans.LABELS, 21)
    assert len(first["images"]) == 60 and not beans.ASSETS_ROOT.exists()
    assert all(
        set(image) == {"path", "sourceId", "label", "byteSize", "sha256"}
        for image in first["images"]
    )
    for label in beans.LABELS:
        expected = sorted(
            name for name, _ in entries if name.startswith(f"train/{label}/")
        )[:20]
        assert [
            image["sourceId"] for image in first["images"] if image["label"] == label
        ] == expected
    assert beans.sample_io.download.call_count == 2
    (beans.CACHE / "selection.json").write_bytes(saved + b" ")
    with pytest.raises(FileExistsError):
        beans.prepare_selection()
    assert (beans.CACHE / "selection.json").read_bytes() == saved + b" "


@pytest.mark.parametrize("label", ["angular_leaf_spot", "bean_rust", "healthy"])
def test_stage_one_class_idempotently_without_network(selected, label):
    beans, selection = selected
    result = beans.stage_class(label)
    before = {
        path: path.stat().st_mtime_ns for path in beans.ASSETS_ROOT.rglob("*.jpg")
    }
    assert len(before) == 20 and len(result["images"]) == 20
    assert beans.stage_class(label) == result
    assert before == {path: path.stat().st_mtime_ns for path in before}
    originals = dict(_entries(beans))
    for image in result["images"]:
        assert image in selection["images"] and image["label"] == label
        assert (beans.ASSETS_ROOT / image["path"]).read_bytes() == originals[
            image["sourceId"]
        ]
    assert not (beans.ASSETS_ROOT / "manifest.json").exists()
    assert beans.sample_io.download.call_count == 1


@pytest.mark.parametrize("problem", ["changed", "directory", "extra"])
def test_stage_preflights_all_targets_before_any_write(selected, problem):
    beans, selection = selected
    images = selection["images"][:20]
    target = beans.ASSETS_ROOT / images[-1]["path"]
    target.parent.mkdir(parents=True)
    if problem == "directory":
        target.mkdir()
    else:
        if problem == "extra":
            target = target.with_name("extra.bin")
        target.write_bytes(b"keep")
    archive_before = (beans.CACHE / "train.zip").read_bytes()
    with pytest.raises((ValueError, FileExistsError)):
        beans.stage_class(beans.LABELS[0])
    assert not (beans.ASSETS_ROOT / images[0]["path"]).exists()
    assert (beans.CACHE / "train.zip").read_bytes() == archive_before
    if problem == "directory":
        assert target.is_dir()
    else:
        assert target.read_bytes() == b"keep"


@pytest.mark.parametrize("pin", ["EXPECTED_SIZE", "EXPECTED_SHA256"])
def test_wrong_archive_pin_is_not_repaired(beans, monkeypatch, pin):
    raw = _source(beans, monkeypatch)
    beans.sample_io.write_new(beans.CACHE / "train.zip", raw)
    invalid = len(raw) + 1 if pin == "EXPECTED_SIZE" else "0" * 64
    monkeypatch.setattr(beans, pin, invalid)
    with pytest.raises(ValueError, match="size/SHA-256"):
        beans.prepare_selection()
    assert (beans.CACHE / "train.zip").read_bytes() == raw
    assert not (beans.CACHE / "selection.json").exists()


@pytest.mark.parametrize(
    "name",
    [
        "../escape.jpg",
        "/absolute.jpg",
        "train/healthy/x:ads.jpg",
        "train\\healthy\\x.jpg",
        "train/healthy//x.jpg",
        "train/healthy/../x.jpg",
        "train/healthy/con.jpg",
        "train/other/x.jpg",
        "train/healthy/x..jpg",
        "train/healthy/X.JPG",
        "train/healthy/x\n.jpg",
    ],
    ids=[
        "traversal",
        "absolute",
        "ads",
        "backslash",
        "empty-part",
        "dotdot",
        "device",
        "unknown-label",
        "bad-basename",
        "extension-case",
        "newline",
    ],
)
def test_unsafe_archive_names(beans, monkeypatch, name):
    entries = _entries(beans) + [(name, b"\xff\xd8\xffextra")]
    raw = _source(beans, monkeypatch, entries)
    assert raw.count(name.encode()) == 2
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        assert [entry.orig_filename for entry in archive.infolist()] == [
            original for original, _ in reversed(entries)
        ]
    message = "Unsafe ZIP member path" if "\\" in name else None
    with pytest.raises(ValueError, match=message):
        beans.prepare_selection()
    assert not (beans.CACHE / "selection.json").exists()


@pytest.mark.parametrize("mode", [stat.S_IFLNK, stat.S_IFIFO, stat.S_IFDIR])
def test_nonregular_archive_members(beans, monkeypatch, mode):
    entry = zipfile.ZipInfo("metadata.bin")
    entry.create_system, entry.external_attr = 3, (mode | 0o600) << 16
    _source(beans, monkeypatch, _entries(beans) + [(entry, b"not extracted")])
    with pytest.raises(ValueError, match="nonregular"):
        beans.prepare_selection()


def test_casefold_duplicate_names(beans, monkeypatch):
    name, data = _entries(beans)[0]
    alias = name.replace("/angular_leaf_spot_train", "/Angular_leaf_spot_train")
    _source(beans, monkeypatch, _entries(beans) + [(alias, data)])
    with pytest.raises(ValueError, match="Duplicate"):
        beans.prepare_selection()


@pytest.mark.parametrize("problem", ["too-few", "duplicate-bytes", "not-jpeg"])
def test_selection_never_substitutes_images(beans, monkeypatch, problem):
    entries = _entries(beans, 19 if problem == "too-few" else 21)
    if problem != "too-few":
        payload = entries[0][1] if problem == "duplicate-bytes" else b"not a JPEG"
        entries[1] = (entries[1][0], payload)
    _source(beans, monkeypatch, entries)
    with pytest.raises(ValueError):
        beans.prepare_selection()
    assert not (beans.CACHE / "selection.json").exists()


@pytest.mark.parametrize("problem", ["crc", "nul"])
def test_raw_zip_integrity_before_staging(selected, monkeypatch, problem):
    beans, selection = selected
    path = beans.CACHE / "train.zip"
    raw, payload = path.read_bytes(), _entries(beans)[0][1]
    if problem == "crc":
        damaged = raw.replace(payload, payload[:-1] + b"!", 1)
        error, message = zipfile.BadZipFile, "CRC"
    else:
        name = selection["images"][0]["sourceId"].encode()
        damaged = raw.replace(name, name.replace(b"_train", b"\x00train"), 2)
        error, message = ValueError, "Unsafe ZIP member path"
    assert damaged != raw
    path.write_bytes(damaged)
    monkeypatch.setattr(beans, "EXPECTED_SHA256", hashlib.sha256(damaged).hexdigest())
    with pytest.raises(error, match=message):
        beans.stage_class(beans.LABELS[0])
    assert not (beans.ASSETS_ROOT / "images").exists()


@pytest.mark.parametrize(
    "limit",
    [
        "ENTRY_LIMIT",
        "UNCOMPRESSED_LIMIT",
        "ENTRY_COUNT_LIMIT",
        "PUBLISHED_LIMIT",
    ],
)
def test_archive_numeric_bounds(beans, monkeypatch, limit):
    _source(beans, monkeypatch)
    monkeypatch.setattr(beans, limit, 1)
    with pytest.raises(ValueError):
        beans.prepare_selection()


@pytest.mark.parametrize("problem", ["changed", "duplicate-key", "oversize"])
def test_cached_selection_is_not_trusted_or_replaced(selected, problem):
    beans, _ = selected
    path = beans.CACHE / "selection.json"
    raw = path.read_bytes()
    damaged = {
        "changed": raw + b" ",
        "duplicate-key": b'{"source":{},' + raw[1:],
        "oversize": b" " * (beans.SELECTION_LIMIT + 1),
    }[problem]
    path.write_bytes(damaged)
    for action in (lambda: beans.stage_class(beans.LABELS[0]), beans.build_manifest):
        with pytest.raises(ValueError):
            action()
    assert path.read_bytes() == damaged
    assert not (beans.ASSETS_ROOT / "images").exists()


@pytest.mark.parametrize("name", ["LICENSE.txt", "ATTRIBUTION.txt"])
@pytest.mark.parametrize("problem", ["missing", "empty"])
def test_notices_required_before_writes(selected, name, problem):
    beans, _ = selected
    path = beans.ASSETS_ROOT / name
    if problem == "missing":
        path.unlink()
    else:
        path.write_bytes(b"")
    for action in (lambda: beans.stage_class(beans.LABELS[0]), beans.build_manifest):
        with pytest.raises((ValueError, FileNotFoundError)):
            action()
    assert not (beans.ASSETS_ROOT / "images").exists()


def test_manifest_exact_schema_raw_notices_and_combined_budget(selected, monkeypatch):
    beans, selection = selected
    _stage_all(beans)
    attribution = beans.ASSETS_ROOT / "ATTRIBUTION.txt"
    attribution.write_bytes(b"Parent-updated synthetic attribution\r\n")
    peer = beans.ASSETS_ROOT.parent / "gwhd-2021/manifest.json"
    beans.sample_io.write_new(peer, b" " * 100_000)
    manifest = beans.build_manifest()
    assert manifest == {
        "schemaVersion": 1,
        "sampleVersion": 1,
        "id": "beans",
        "taskType": "classification",
        "sourceSplit": "train",
        "source": selection["source"],
        "licenses": {"images": "MIT", "annotations": "MIT"},
        "images": selection["images"],
        "files": [
            {"path": name, **beans.sample_io.file_metadata(beans.ASSETS_ROOT / name)}
            for name in ("LICENSE.txt", "ATTRIBUTION.txt")
        ],
    }
    path = beans.ASSETS_ROOT / "manifest.json"
    raw = path.read_bytes()
    total = sum(
        p.stat().st_size for p in beans.ASSETS_ROOT.parent.rglob("*") if p.is_file()
    )
    monkeypatch.setattr(beans, "PUBLISHED_LIMIT", total)
    assert beans.build_manifest() == manifest and path.read_bytes() == raw
    path.unlink()
    monkeypatch.setattr(beans, "PUBLISHED_LIMIT", total - 1)
    with pytest.raises(ValueError, match="Combined"):
        beans.build_manifest()
    assert not path.exists() and peer.read_bytes() == b" " * 100_000


@pytest.mark.parametrize("problem", ["missing", "changed", "extra"])
def test_manifest_rejects_nonexact_image_inventory(selected, problem):
    beans, selection = selected
    _stage_all(beans)
    path = beans.ASSETS_ROOT / selection["images"][-1]["path"]
    if problem == "missing":
        path.unlink()
    else:
        if problem == "extra":
            path = path.parent / "unexpected.bin"
        path.write_bytes(b"bad")
    with pytest.raises(ValueError, match="exactly all 60"):
        beans.build_manifest()
    assert not (beans.ASSETS_ROOT / "manifest.json").exists()


def test_stage_budget_includes_other_dataset_files(selected, monkeypatch):
    beans, selection = selected
    beans.sample_io.write_new(
        beans.ASSETS_ROOT.parent / "gwhd-2021/extra.bin", b"x" * 100_000
    )
    current = sum(
        p.stat().st_size for p in beans.ASSETS_ROOT.parent.rglob("*") if p.is_file()
    )
    additional = sum(image["byteSize"] for image in selection["images"][:20])
    monkeypatch.setattr(beans, "PUBLISHED_LIMIT", current + additional - 1)
    with pytest.raises(ValueError, match="Combined"):
        beans.stage_class(beans.LABELS[0])
    assert not (beans.ASSETS_ROOT / "images").exists()


@pytest.mark.parametrize("step", ["source", "selection", "stage", "manifest"])
def test_disk_margin_uses_nearest_existing_parent(beans, monkeypatch, step):
    raw = _source(beans, monkeypatch)
    action, root = beans.prepare_selection, beans.ROOT
    needed = 2 * len(raw) + beans.PUBLISHED_LIMIT
    if step == "selection":
        beans.sample_io.write_new(beans.CACHE / "train.zip", raw)
        needed, root = len(beans._json(beans._expected()[0])), beans.CACHE
    elif step in ("stage", "manifest"):
        selection = beans.prepare_selection()
        for name in ("LICENSE.txt", "ATTRIBUTION.txt"):
            beans.sample_io.write_new(beans.ASSETS_ROOT / name, b"notice")
        root = beans.ASSETS_ROOT

        def action():
            return beans.stage_class(beans.LABELS[0])

        needed = sum(image["byteSize"] for image in selection["images"][:20])
        if step == "manifest":
            _stage_all(beans)
            beans.build_manifest()
            path = beans.ASSETS_ROOT / "manifest.json"
            needed, action = path.stat().st_size, beans.build_manifest
            path.unlink()
    required = (needed * 6 + 4) // 5
    usage = Mock(return_value=SimpleNamespace(free=required - 1))
    monkeypatch.setattr(beans.shutil, "disk_usage", usage)
    with pytest.raises(ValueError, match="disk space"):
        action()
    usage.assert_called_once_with(root)
    if step == "source":
        beans.sample_io.download.assert_not_called()
        assert not beans.CACHE.exists()


def test_linked_directory_overlay_is_refused(selected, monkeypatch):
    beans, _ = selected
    original = Path.is_junction
    monkeypatch.setattr(
        Path, "is_junction", lambda path: path == beans.ASSETS_ROOT or original(path)
    )
    with pytest.raises(ValueError, match="Unsafe sample directory"):
        beans.stage_class(beans.LABELS[0])
    assert not (beans.ASSETS_ROOT / "images").exists()


@pytest.mark.parametrize(
    "arguments", [[], ["stage"], ["stage", "other"], ["select", "--num-images", "1"]]
)
def test_cli_errors_are_json_only(beans, capsys, arguments):
    assert beans.main(arguments) == 1
    captured = capsys.readouterr()
    assert json.loads(captured.out) == {"error": "ValueError"}
    assert captured.err == ""
    beans.sample_io.download.assert_not_called()


def test_cli_summary_has_only_computed_counts_and_archive_metadata(
    beans, monkeypatch, capsys
):
    _source(beans, monkeypatch)
    assert beans.main(["select"]) == 0
    result = json.loads(capsys.readouterr().out)
    selection = json.loads((beans.CACHE / "selection.json").read_bytes())
    assert result == {
        "command": "select",
        "imageCount": 60,
        "imageBytes": sum(image["byteSize"] for image in selection["images"]),
        "archiveBytes": beans.EXPECTED_SIZE,
        "archiveSha256": beans.EXPECTED_SHA256,
        "sourceCounts": dict.fromkeys(beans.LABELS, 21),
    }
