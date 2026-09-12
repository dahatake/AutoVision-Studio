"""SP-06 inventory fixtures and SP-07/08 real Beans/GWHD pipeline tests.

Only tmp_path fixtures are mutated. Repository assets are read-only inputs.
Fault injection changes normal helper returns, never original assets.
ML imports are lazy and require the existing ml environment / pytest pythonpath.
SP-08 negatives reuse only the real baseline's SP-07 result, not fake images.
The parent owns execution and independent review; no DATA-07 closure is claimed.
"""

from __future__ import annotations

import builtins
import copy
import hashlib
import importlib.util
import io
import json
import os
import shutil
import socket
import stat
import sys
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

_SCRIPT = Path(__file__).with_name("verify_samples.py")
_ASSETS = Path(__file__).absolute().parents[2] / "resources" / "samples"
_CLASSIFICATION_RESULT = {
    "scope": "classification-import",
    "inventory": "PASS",
    "normalDecodeImport": "PASS",
    "manifestTrust": "reviewed-pins",
    "sampleId": "beans",
    "fileCount": 87,
    "totalBytes": 44942112,
    "imageCount": 60,
    "decodedImageCount": 60,
    "annotationCount": 60,
    "classCount": 3,
    "classCounts": {"angular_leaf_spot": 20, "bean_rust": 20, "healthy": 20},
    "issues": [],
    "detectionDecodeImport": "NOT_RUN",
}


def _load(monkeypatch):
    monkeypatch.setattr(sys, "dont_write_bytecode", True)
    spec = importlib.util.spec_from_file_location("_sp06_inventory", _SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _encode(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False) + "\n").encode()


def _metadata(raw):
    return {"byteSize": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def _stat_copy(info, **changes):
    fields = {
        name: getattr(info, name)
        for name in (
            "st_dev",
            "st_ino",
            "st_mode",
            "st_nlink",
            "st_size",
            "st_mtime_ns",
            "st_ctime_ns",
            "st_birthtime_ns",
            "st_file_attributes",
        )
        if hasattr(info, name)
    }
    fields.update(changes)
    return SimpleNamespace(**fields)


def _snapshot(root):
    return {
        path.relative_to(root).as_posix(): (
            _metadata(path.read_bytes()),
            path.stat().st_mtime_ns,
            path.stat().st_nlink,
        )
        if path.is_file()
        else None
        for path in root.rglob("*")
    }


def _save_manifest(env, sample_id, *, repin=False):
    raw = _encode(env.manifests[sample_id])
    (env.root / sample_id / "manifest.json").write_bytes(raw)
    if repin:  # Explicit fixture trust ONLY; never used on repository originals.
        env.pins[sample_id] = _metadata(raw)["sha256"]


@pytest.fixture
def verifier(monkeypatch):
    blocker = Mock(side_effect=AssertionError("SP-06 must remain offline"))
    monkeypatch.setattr(socket, "create_connection", blocker)
    monkeypatch.setattr(socket, "getaddrinfo", blocker)
    monkeypatch.setattr(socket.socket, "connect", blocker)
    module = _load(monkeypatch)
    yield module
    blocker.assert_not_called()


@pytest.fixture
def env(tmp_path, verifier):
    root = tmp_path / "samples"
    manifests, pins = {}, {}
    for sample_id in ("beans", "gwhd-2021"):
        # Keep real fixed provenance, but use isolated tiny non-image byte fixtures.
        manifest = json.loads((_ASSETS / sample_id / "manifest.json").read_bytes())
        manifest["images"], manifest["files"] = [], []
        labels = ("angular_leaf_spot", "bean_rust", "healthy")
        for index in range(60 if sample_id == "beans" else 20):
            raw = f"NOT AN IMAGE: {sample_id}:{index:02d}\r\n".encode()
            if sample_id == "beans":
                label = labels[index // 20]
                basename = f"fixture.{index:02d}.jpg"
                image = {
                    "path": f"images/{label}/{basename}",
                    "sourceId": f"train/{label}/{basename}",
                    "label": label,
                }
            else:
                source_id = f"{index + 1:064x}"
                image = {
                    "path": f"images/{source_id}.{'jpg' if index < 2 else 'png'}",
                    "sourceId": source_id,
                    "sourceFilename": source_id + ".png",
                    "detectedFormat": "jpeg" if index < 2 else "png",
                    "domain": "ULiège-GxABT_1",
                }
            image.update(_metadata(raw))
            target = root / sample_id / image["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            manifest["images"].append(image)
        payloads = {
            "LICENSE.txt": f"{sample_id} license fixture\r\n".encode(),
            "ATTRIBUTION.txt": f"{sample_id} 帰属 fixture\n".encode(),
        }
        if sample_id == "gwhd-2021":
            coco = {
                "info": {"version": "1.0", "description": "Inventory fixture only"},
                "images": [
                    {
                        "id": index,
                        "file_name": image["path"][7:],
                        "width": 1024,
                        "height": 1024,
                    }
                    for index, image in enumerate(manifest["images"], 1)
                ],
                "categories": [{"id": 1, "name": "wheat_head"}],
                "annotations": [
                    {
                        "id": index + 1,
                        "image_id": index % 20 + 1,
                        "category_id": 1,
                        "bbox": [0, 0, 1, 1],
                        "area": 1,
                        "iscrowd": 0,
                    }
                    for index in range(1079)
                ],
            }
            payloads["annotations.coco.json"] = _encode(coco)
        for name, raw in payloads.items():
            (root / sample_id / name).write_bytes(raw)
            manifest["files"].append({"path": name, **_metadata(raw)})
        raw = _encode(manifest)
        (root / sample_id / "manifest.json").write_bytes(raw)
        manifests[sample_id], pins[sample_id] = manifest, _metadata(raw)["sha256"]
    return SimpleNamespace(v=verifier, root=root, manifests=manifests, pins=pins)


def _verify(env):
    return env.v.verify_inventory(env.root, expected_manifest_hashes=env.pins)


@pytest.fixture
def read_probe(tmp_path, verifier, monkeypatch):
    path = tmp_path / "inventory.bin"
    raw = b"stable inventory payload\n"
    path.write_bytes(raw)
    # Preserve real identity and bytes; emulate the observed Windows ctime split.
    before = _stat_copy(path.lstat(), st_ctime_ns=1789095598801623900)
    with path.open("rb") as source:
        opened = _stat_copy(os.fstat(source.fileno()), st_ctime_ns=1788713383238698200)
    path_stat = Mock(return_value=before)
    handle_stat = Mock(return_value=opened)
    reads = Mock()
    original_lstat, original_open, original_fstat = Path.lstat, Path.open, os.fstat

    def lstat(self, *args, **kwargs):
        if self == path:
            return path_stat()
        return original_lstat(self, *args, **kwargs)

    def fstat(fd):
        info = original_fstat(fd)
        if os.path.samestat(before, info):
            return handle_stat(fd)
        return info

    @contextmanager
    def read_only_open(self, *args, **kwargs):
        with original_open(self, *args, **kwargs) as source:
            if self == path:
                reads.side_effect = source.read
                yield SimpleNamespace(fileno=source.fileno, read=reads)
            else:
                yield source

    monkeypatch.setattr(Path, "lstat", lstat)
    monkeypatch.setattr(Path, "open", read_only_open)
    monkeypatch.setattr(verifier.os, "fstat", fstat)
    return SimpleNamespace(
        v=verifier,
        path=path,
        raw=raw,
        before=before,
        opened=opened,
        path_stat=path_stat,
        handle_stat=handle_stat,
        reads=reads,
    )


def test_import_has_no_asset_io_writes_or_prepare_imports(monkeypatch):
    original_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        assert name.split(".")[0] not in {
            "sample_io",
            "prepare_beans",
            "prepare_gwhd",
            "PIL",
            "torch",
            "urllib",
            "requests",
            "autovision_ml",
        }
        return original_import(name, *args, **kwargs)

    blocked = Mock(side_effect=AssertionError("Import must not access assets"))
    monkeypatch.setattr(builtins, "__import__", guarded_import)
    for name in ("open", "read_bytes", "write_bytes", "mkdir", "resolve", "lstat"):
        monkeypatch.setattr(Path, name, blocked)
    module = _load(monkeypatch)
    assert callable(module.verify_inventory)
    blocked.assert_not_called()


def test_fixture_success_is_read_only_inventory_not_decode(env, monkeypatch):
    before = _snapshot(env.root)
    original_open = io.open

    def read_only(file, mode="r", *args, **kwargs):
        assert mode in ("r", "rb")
        return original_open(file, mode, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(io, "open", read_only)
        patch.setattr(builtins, "open", read_only)
        for name in (
            "mkdir",
            "unlink",
            "rename",
            "replace",
            "write_bytes",
            "write_text",
        ):
            patch.setattr(Path, name, Mock(side_effect=AssertionError("No writes")))
        result = _verify(env)
    assert result == {
        "scope": "inventory-only",
        "inventory": "PASS",
        "normalDecodeImport": "NOT_RUN",
        "manifestTrust": "caller-supplied-pins",
        "imageCounts": {"beans": 60, "gwhd-2021": 20},
        "fileCount": 87,
        "totalBytes": sum(
            record[0]["byteSize"] for record in before.values() if record is not None
        ),
    }
    assert _snapshot(env.root) == before


def test_original_assets_match_reviewed_pins_and_remain_immutable(verifier):
    before = _snapshot(_ASSETS)
    result = verifier.verify_inventory(_ASSETS)
    assert verifier.INVENTORY_LIMIT == 96 * 1024 * 1024
    assert result["manifestTrust"] == "reviewed-pins"
    assert result["fileCount"] == 87 and result["totalBytes"] == 44942112
    assert result["normalDecodeImport"] == "NOT_RUN"
    assert _snapshot(_ASSETS) == before


@pytest.mark.parametrize("capture", [False, True])
def test_read_accepts_stable_cross_api_ctime_difference(read_probe, capture):
    assert read_probe.before.st_ctime_ns != read_probe.opened.st_ctime_ns
    observed, captured = read_probe.v._read(
        read_probe.path, len(read_probe.raw), capture=capture
    )
    assert observed == _metadata(read_probe.raw)
    assert captured == (read_probe.raw if capture else b"")
    assert read_probe.handle_stat.call_count == 2
    assert read_probe.path_stat.call_count == 3


@pytest.mark.parametrize("phase", ["before", "during", "after"])
def test_read_rejects_same_api_ctime_changes(read_probe, phase):
    before, opened = read_probe.before, read_probe.opened
    if phase == "before":
        read_probe.path_stat.side_effect = [
            before,
            _stat_copy(before, st_ctime_ns=before.st_ctime_ns + 1),
        ]
    elif phase == "during":
        read_probe.handle_stat.side_effect = [
            opened,
            _stat_copy(opened, st_ctime_ns=opened.st_ctime_ns + 1),
        ]
    else:
        read_probe.path_stat.side_effect = [
            before,
            before,
            _stat_copy(before, st_ctime_ns=before.st_ctime_ns + 1),
        ]
    with pytest.raises(ValueError, match=f"^Sample changed {phase} reading$"):
        read_probe.v._read(read_probe.path, len(read_probe.raw), capture=True)
    if phase == "before":
        read_probe.reads.assert_not_called()
    else:
        assert read_probe.reads.call_count == 2


@pytest.mark.parametrize(
    "field", ["st_dev", "st_ino", "st_mode", "st_nlink", "st_size", "st_mtime_ns"]
)
def test_read_rejects_cross_api_identity_changes_before_read(read_probe, field):
    opened = read_probe.opened
    value = stat.S_IFDIR if field == "st_mode" else getattr(opened, field) + 1
    read_probe.handle_stat.return_value = _stat_copy(opened, **{field: value})
    with pytest.raises(ValueError, match="^Sample changed before reading$"):
        read_probe.v._read(read_probe.path, len(read_probe.raw), capture=True)
    read_probe.reads.assert_not_called()


@pytest.mark.parametrize(
    "relative",
    [
        "beans/manifest.json",
        "beans/LICENSE.txt",
        "beans/ATTRIBUTION.txt",
        "beans/images/angular_leaf_spot/fixture.00.jpg",
        "gwhd-2021/manifest.json",
        "gwhd-2021/LICENSE.txt",
        "gwhd-2021/ATTRIBUTION.txt",
        "gwhd-2021/annotations.coco.json",
    ],
    ids=[
        "beans-manifest",
        "beans-license",
        "beans-attribution",
        "image",
        "gwhd-manifest",
        "gwhd-license",
        "gwhd-attribution",
        "coco",
    ],
)
@pytest.mark.parametrize(
    "damage",
    ["missing", "empty", "same-size", "larger"],
    ids=["missing", "zero", "changed-bytes", "size-mismatch"],
)
def test_missing_empty_or_changed_files_fail_without_repair(env, relative, damage):
    path = env.root / relative
    raw = path.read_bytes()
    if damage == "missing":
        path.unlink()
    else:
        path.write_bytes(
            {
                "empty": b"",
                "same-size": bytes([raw[0] ^ 1]) + raw[1:],
                "larger": raw + b"x",
            }[damage]
        )
    before = _snapshot(env.root)
    with pytest.raises((ValueError, OSError)):
        _verify(env)
    assert _snapshot(env.root) == before


@pytest.mark.parametrize(
    "kind",
    [
        "extra-file",
        "extra-directory",
        "missing-directory",
        "file-as-directory",
        "directory-as-file",
        "empty-root",
    ],
)
def test_exact_tree_includes_empty_extra_directories(env, kind):
    if kind == "extra-file":
        (env.root / "unexpected.bin").write_bytes(b"extra")
    elif kind == "extra-directory":
        (env.root / "beans/images/unexpected").mkdir()
    elif kind == "empty-root":
        shutil.rmtree(env.root)
        env.root.mkdir()
    elif kind == "file-as-directory":
        path = env.root / "beans/LICENSE.txt"
        path.unlink()
        path.mkdir()
    else:
        path = env.root / "beans/images/healthy"
        shutil.rmtree(path)
        if kind == "directory-as-file":
            path.write_bytes(b"not a directory")
    before = _snapshot(env.root)
    with pytest.raises((ValueError, OSError)):
        _verify(env)
    assert _snapshot(env.root) == before


@pytest.mark.parametrize("sample_id", ["beans", "gwhd-2021"])
@pytest.mark.parametrize("notice", ["LICENSE.txt", "ATTRIBUTION.txt"])
def test_rehashing_changed_notice_does_not_approve_it(env, sample_id, notice):
    path = env.root / sample_id / notice
    raw = b"Rewritten rights or attribution are not automatically approved\n"
    path.write_bytes(raw)
    entry = next(
        file for file in env.manifests[sample_id]["files"] if file["path"] == notice
    )
    entry.update(_metadata(raw))
    _save_manifest(env, sample_id)  # Deliberately retain independently frozen trust.
    with pytest.raises(ValueError, match="trusted SHA-256"):
        _verify(env)
    with pytest.raises(ValueError, match="trusted SHA-256"):
        env.v.verify_inventory(env.root)  # Production never trusts fixture manifests.


@pytest.mark.parametrize(
    "sample_id,path,value",
    [
        pytest.param("beans", ("id",), "unknown", id="unknown-id"),
        pytest.param("beans", ("schemaVersion",), True, id="bool-schema"),
        pytest.param("beans", ("sampleVersion",), 1.0, id="float-version"),
        pytest.param("beans", ("sourceSplit",), "test", id="wrong-split"),
        pytest.param("beans", ("taskType",), "detection", id="wrong-task"),
        pytest.param("beans", ("source", "byteSize"), 143812152.0, id="source-float"),
        pytest.param(
            "beans", ("source", "url"), "https://other.invalid", id="source-url"
        ),
        pytest.param("gwhd-2021", ("source", "sha256"), "0" * 64, id="source-hash"),
        pytest.param("beans", ("licenses", "images"), "unknown", id="license"),
        pytest.param("beans", ("images", 0, "label"), [], id="label-type"),
        pytest.param("beans", ("images", 0, "path"), None, id="path-type"),
        pytest.param("beans", ("images", 0, "byteSize"), True, id="bool-size"),
        pytest.param("beans", ("images", 0, "byteSize"), 0, id="zero-size"),
        pytest.param("beans", ("images", 0, "byteSize"), -1, id="negative-size"),
        pytest.param("beans", ("images", 0, "byteSize"), 1.5, id="float-size"),
        pytest.param("beans", ("images", 0, "sha256"), "A" * 64, id="uppercase-hash"),
        pytest.param("beans", ("files", 0, "path"), "../LICENSE.txt", id="notice-path"),
        pytest.param(
            "beans", ("files", 0, "path"), "ATTRIBUTION.txt", id="duplicate-file"
        ),
        pytest.param("gwhd-2021", ("images", 0, "detectedFormat"), "gif", id="format"),
        pytest.param(
            "gwhd-2021", ("images", 0, "sourceFilename"), "../a.png", id="source-name"
        ),
        pytest.param(
            "gwhd-2021", ("images", 0, "domain"), "\ufeff ", id="blank-domain"
        ),
        pytest.param(
            "gwhd-2021", ("images", 0, "domain"), "x\x7f", id="control-domain"
        ),
        pytest.param(
            "gwhd-2021", ("images", 0, "domain"), "🌾" * 65, id="utf16-domain"
        ),
        pytest.param(
            "gwhd-2021", ("images", 0, "domain"), "\ud800", id="surrogate-domain"
        ),
    ],
    ids=None,
)
def test_strict_manifest_metadata(env, sample_id, path, value):
    manifest = copy.deepcopy(env.manifests[sample_id])
    target = manifest
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(ValueError):
        env.v.validate_manifest(manifest, sample_id)


@pytest.mark.parametrize(
    "name",
    [
        "../escape.jpg",
        "/absolute.jpg",
        "C:/escape.jpg",
        "C:escape.jpg",
        "images\\healthy\\x.jpg",
        "images/healthy/../x.jpg",
        "images//healthy/x.jpg",
        "images/healthy/./x.jpg",
        "images/healthy/CON.jpg",
        "images/healthy/NUL.x.jpg",
        "images/healthy/x.jpg:stream",
        "images/healthy/x.jpg\n",
        "images/healthy/x.jpg ",
        "images/healthy/x.jpg.",
        "images/healthy/x%2f.jpg",
        "images/healthy/x.JPG",
        "images/healthy/名前.jpg",
    ],
    ids=[
        "traversal",
        "absolute",
        "drive",
        "drive-relative",
        "backslash",
        "parent",
        "empty-component",
        "dot",
        "device",
        "device-extension",
        "ads",
        "newline",
        "space",
        "trailing-dot",
        "encoded",
        "extension-case",
        "unicode-filename",
    ],
)
def test_unsafe_names_fail_lexically_before_asset_access(env, name):
    manifest = env.manifests["beans"]
    manifest["images"][40]["path"] = name
    with pytest.raises(ValueError):
        env.v.validate_manifest(manifest, "beans")


@pytest.mark.parametrize(
    "kind",
    [
        "few",
        "many",
        "wrong-distribution",
        "duplicate-image",
        "duplicate-hash",
        "case-alias",
        "extra-key",
        "missing-key",
    ],
)
def test_counts_duplicates_and_exact_fields(env, kind):
    manifest = env.manifests["beans"]
    images = manifest["images"]
    if kind == "few":
        images.pop()
    elif kind == "many":
        images.append(copy.deepcopy(images[0]))
    elif kind == "wrong-distribution":
        image = images[0]
        image["label"] = "healthy"
        for key in ("path", "sourceId"):
            image[key] = image[key].replace("angular_leaf_spot", "healthy")
    elif kind == "duplicate-image":
        images[1] = copy.deepcopy(images[0])
    elif kind == "duplicate-hash":
        images[1]["sha256"] = images[0]["sha256"]
    elif kind == "case-alias":
        for key in ("path", "sourceId"):
            images[1][key] = images[0][key].replace("fixture", "FIXTURE")
    elif kind == "extra-key":
        images[0]["approved"] = True
    else:
        manifest.pop("files")
    with pytest.raises(ValueError):
        env.v.validate_manifest(manifest, "beans")


@pytest.mark.parametrize(
    "raw",
    [
        b"",
        b" ",
        b"\xff",
        b"[]",
        b"{",
        b'{"id":1,"id":2}',
        b'{"source":{"a":1,"a":2}}',
        b'{"x":NaN}',
        b'{"x":Infinity}',
        b'{"x":-Infinity}',
        b'{"x":1e999}',
        b"{} {}",
        b"[" * 1100 + b"]" * 1100,
    ],
    ids=[
        "empty",
        "space",
        "utf8",
        "array",
        "syntax",
        "duplicate",
        "nested-duplicate",
        "nan",
        "infinity",
        "negative-infinity",
        "overflow",
        "trailing",
        "deep",
    ],
)
def test_malformed_json_is_rejected_even_with_explicit_fixture_pin(env, raw):
    (env.root / "beans/manifest.json").write_bytes(raw)
    env.pins["beans"] = _metadata(raw)["sha256"]
    with pytest.raises(ValueError):
        _verify(env)


@pytest.mark.parametrize(
    "kind",
    [
        "image-count",
        "annotation-count",
        "category",
        "bool-id",
        "filename",
        "extra-field",
        "duplicate-key",
        "nonfinite",
    ],
)
def test_coco_metadata_rejects_rehashed_malformed_fixture(env, kind):
    path = env.root / "gwhd-2021/annotations.coco.json"
    coco = json.loads(path.read_bytes())
    if kind == "image-count":
        coco["images"].pop()
    elif kind == "annotation-count":
        coco["annotations"].pop()
    elif kind == "category":
        coco["categories"][0]["name"] = "other"
    elif kind == "bool-id":
        coco["annotations"][0]["id"] = True
    elif kind == "filename":
        coco["images"][0]["file_name"] = "../outside.jpg"
    elif kind == "extra-field":
        coco["annotations"][0]["prediction"] = True
    raw = _encode(coco)
    if kind == "duplicate-key":
        raw = raw.replace(b'{"info":', b'{"info":null,"info":', 1)
    elif kind == "nonfinite":
        raw = raw.replace(b'"area": 1', b'"area": 1e999', 1)
    path.write_bytes(raw)
    env.manifests["gwhd-2021"]["files"][2].update(_metadata(raw))
    _save_manifest(env, "gwhd-2021", repin=True)
    with pytest.raises(ValueError):
        _verify(env)


@pytest.mark.parametrize("delta", [-1, 0, 1], ids=["one-over", "exact", "one-under"])
def test_combined_boundary_counts_both_manifests_and_all_notices(
    env, monkeypatch, delta
):
    total = sum(path.stat().st_size for path in env.root.rglob("*") if path.is_file())
    monkeypatch.setattr(env.v, "INVENTORY_LIMIT", total + delta)
    if delta < 0:
        with pytest.raises(ValueError, match="including manifests"):
            _verify(env)
    else:
        assert _verify(env)["totalBytes"] == total


def test_combined_declared_overflow_stops_before_image_reads(env):
    for sample_id in env.v.SAMPLE_IDS:
        env.manifests[sample_id]["images"][0]["byteSize"] = 50 * 1024 * 1024
        _save_manifest(env, sample_id, repin=True)
    with pytest.raises(ValueError, match="Combined"):
        _verify(env)


@pytest.mark.parametrize("target", ["beans/manifest.json", "beans/LICENSE.txt"])
def test_hardlinks_to_external_fixture_are_rejected(env, tmp_path, target):
    path = env.root / target
    outside = tmp_path / "outside.bin"
    path.rename(outside)
    os.link(outside, path)
    before = outside.read_bytes()
    with pytest.raises(ValueError, match="single-link"):
        _verify(env)
    assert outside.read_bytes() == before and path.stat().st_nlink == 2


@pytest.mark.parametrize(
    "target",
    ["beans/LICENSE.txt", "beans/images", "."],
    ids=["file", "directory", "root"],
)
def test_symlinks_never_follow_outside_fixture(env, tmp_path, target):
    path = env.root if target == "." else env.root / target
    outside = tmp_path / "outside"
    is_directory = path.is_dir()
    path.rename(outside)
    try:
        path.symlink_to(outside, target_is_directory=is_directory)
    except (OSError, NotImplementedError):
        pytest.skip("Native symlinks unavailable; reparse rejection tested separately")
    before = _snapshot(outside) if is_directory else outside.read_bytes()
    with pytest.raises(ValueError, match="links|reparse"):
        _verify(env)
    assert (_snapshot(outside) if is_directory else outside.read_bytes()) == before


@pytest.mark.parametrize("target", ["root", "ancestor", "file", "directory"])
def test_reparse_attribute_rejected_without_traversing(env, monkeypatch, target):
    path = {
        "root": env.root,
        "ancestor": env.root.parent,
        "file": env.root / "beans/LICENSE.txt",
        "directory": env.root / "beans/images",
    }[target]
    original = Path.lstat

    def reparse(self, *args, **kwargs):
        info = original(self, *args, **kwargs)
        return (
            SimpleNamespace(st_mode=info.st_mode, st_file_attributes=0x400)
            if self == path
            else info
        )

    monkeypatch.setattr(Path, "lstat", reparse)
    with pytest.raises(ValueError, match="reparse"):
        _verify(env)


def test_native_windows_junction_rejected(env, tmp_path):
    if os.name != "nt":
        pytest.skip("Windows junction test")
    winapi = pytest.importorskip("_winapi")
    create_junction = getattr(winapi, "CreateJunction", None)
    if create_junction is None:
        pytest.skip("Native junction creation unavailable")
    path, outside = env.root / "beans/images", tmp_path / "outside-images"
    path.rename(outside)
    create_junction(str(outside), str(path))
    before = _snapshot(outside)
    try:
        with pytest.raises(ValueError, match="reparse"):
            _verify(env)
        assert _snapshot(outside) == before
    finally:
        path.rmdir()  # Remove the junction only, not its destination.


@pytest.mark.parametrize(
    "mode",
    [stat.S_IFIFO, stat.S_IFSOCK, stat.S_IFCHR],
    ids=["fifo", "socket", "device"],
)
def test_nonregular_nodes_are_rejected_before_open(env, monkeypatch, mode):
    original = Path.lstat
    target = env.root / "beans/LICENSE.txt"

    def nonregular(self, *args, **kwargs):
        if self == target:
            return SimpleNamespace(st_mode=mode, st_nlink=1, st_file_attributes=0)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Path, "lstat", nonregular)
    with pytest.raises(ValueError, match="regular"):
        _verify(env)


def test_unknown_id_invalid_pins_and_root_traversal(env):
    for sample_id in ("../beans", "Beans", "unknown", None, []):
        with pytest.raises(ValueError, match="Unknown"):
            env.v.validate_manifest({}, sample_id)
    for pins in ({}, {**env.pins, "unknown": "a" * 64}, {**env.pins, "beans": None}):
        with pytest.raises(ValueError):
            env.v.verify_inventory(env.root, expected_manifest_hashes=pins)
    with pytest.raises(ValueError, match="safe absolute local"):
        env.v.verify_inventory(env.root / ".." / "samples")


@pytest.mark.parametrize(
    "argv",
    [["--root", "private"], ["--hash", "a" * 64], ["--sample-id", "beans"], ["decode"]],
    ids=["root", "hash", "id", "future-command"],
)
def test_cli_has_no_override_or_fake_future_commands(verifier, capsys, argv):
    assert verifier.main(argv) == 1
    result = json.loads(capsys.readouterr().out)
    assert result["inventory"] == "FAIL" and result["scope"] == "inventory-only"
    assert result["normalDecodeImport"] == "NOT_RUN" and "private" not in str(result)


def test_cli_real_inventory_scope_and_sanitized_io_failure(
    verifier, monkeypatch, capsys
):
    assert verifier.main([]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["inventory"] == "PASS" and result["normalDecodeImport"] == "NOT_RUN"
    monkeypatch.setattr(
        verifier, "verify_inventory", Mock(side_effect=OSError("private"))
    )
    assert verifier.main([]) == 1
    output = capsys.readouterr().out
    assert (
        "private" not in output
        and json.loads(output)["normalDecodeImport"] == "NOT_RUN"
    )


@pytest.fixture
def no_ml_imports(monkeypatch):
    original = builtins.__import__
    blocked = Mock(side_effect=AssertionError("Inventory must not import ML"))

    def guarded(name, *args, **kwargs):
        if name.split(".")[0] in {"autovision_ml", "PIL"}:
            blocked(name)
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded)
    yield blocked
    blocked.assert_not_called()


@pytest.fixture
def normal_modules(verifier):
    if os.name != "nt":
        pytest.skip("SP-07 uses the Windows-native DAT-02/03/04 pipeline")
    from autovision_ml.data import (
        classification_import,
        image_decode,
        image_scan,
    )

    before = _snapshot(_ASSETS)
    yield SimpleNamespace(
        scanner=image_scan,
        decoder=image_decode,
        classifier=classification_import,
        before=before,
    )
    assert _snapshot(_ASSETS) == before


def _classification_issue(candidate):
    return {
        "severity": "error",
        "code": "INVALID_IMAGE",
        "target": {
            "imageKey": candidate["key"],
            "sourcePath": candidate["sourcePath"],
            "row": None,
            "itemId": None,
        },
    }


def test_inventory_cli_remains_lazy_and_rejects_classification_flag(
    verifier, no_ml_imports, monkeypatch, capsys
):
    classification = Mock(side_effect=AssertionError("Explicit function only"))
    monkeypatch.setattr(verifier, "verify_classification", classification)
    assert verifier.main([]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["scope"] == "inventory-only"
    assert result["normalDecodeImport"] == "NOT_RUN"
    assert verifier.main(["--classification"]) == 1
    assert json.loads(capsys.readouterr().out)["normalDecodeImport"] == "NOT_RUN"
    classification.assert_not_called()


def test_classification_missing_root_fails_before_ml_import(
    verifier, no_ml_imports, tmp_path
):
    missing = tmp_path / "missing-samples"
    with pytest.raises(OSError):
        verifier.verify_classification(missing)
    assert not missing.exists()


def test_classification_does_not_promote_fixture_pins(env, no_ml_imports):
    before = _snapshot(env.root)
    with pytest.raises(ValueError, match="trusted SHA-256"):
        env.v.verify_classification(env.root)
    assert _snapshot(env.root) == before


@pytest.mark.parametrize("missing", ["autovision_ml", "PIL"])
def test_classification_missing_dependencies_are_explicit_not_run(
    verifier, monkeypatch, capsys, missing
):
    original = builtins.__import__
    inventory = Mock(wraps=verifier.verify_inventory)
    attempts = []
    before = _snapshot(_ASSETS)

    def unavailable(name, *args, **kwargs):
        if name.startswith("autovision_ml."):
            assert inventory.call_count == 1  # Reviewed inventory precedes imports.
            attempts.append(name)
            raise ModuleNotFoundError("private dependency details", name=missing)
        return original(name, *args, **kwargs)

    monkeypatch.setattr(verifier, "verify_inventory", inventory)
    monkeypatch.setattr(builtins, "__import__", unavailable)
    with pytest.raises(ValueError, match="normalDecodeImport NOT_RUN") as caught:
        verifier.verify_classification(_ASSETS)
    assert len(attempts) == 1 and inventory.call_count == 2
    assert "existing ML environment" in str(caught.value)
    assert "private" not in str(caught.value)
    assert _snapshot(_ASSETS) == before
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


@pytest.mark.parametrize("target", ["manifest", "image", "notice"])
def test_classification_checks_gwhd_before_any_ml_import(
    verifier, no_ml_imports, monkeypatch, target
):
    manifest = json.loads((_ASSETS / "gwhd-2021/manifest.json").read_bytes())
    relative = {
        "manifest": "manifest.json",
        "image": manifest["images"][0]["path"],
        "notice": "LICENSE.txt",
    }[target]
    path = _ASSETS / "gwhd-2021" / relative
    original = verifier._read
    reached = []
    before = _snapshot(_ASSETS)

    def changed_observation(candidate, *args, **kwargs):
        metadata, raw = original(candidate, *args, **kwargs)
        if candidate == path:
            reached.append(candidate)
            metadata = {**metadata, "sha256": "0" * 64}
        return metadata, raw

    monkeypatch.setattr(verifier, "_read", changed_observation)
    with pytest.raises(ValueError, match="SHA-256"):
        verifier.verify_classification(_ASSETS)
    assert reached == [path]
    assert _snapshot(_ASSETS) == before


def test_real_beans_all_images_use_normal_decode_and_import_once(
    verifier, normal_modules, monkeypatch, capsys
):
    modules = normal_modules
    scans, decoded, imported, pixels, order = [], [], [], [], []
    original_scan = modules.scanner.enumerate_and_hash
    original_decode = modules.decoder.decode_image
    original_import = modules.classifier.import_classification
    original_pixels = modules.decoder.open_decoded_image
    original_inventory = verifier.verify_inventory

    def record_inventory(root):
        order.append("inventory")
        return original_inventory(root)

    def record_scan(source):
        order.append("scan")
        result = original_scan(source)
        scans.append(result)
        return result

    def record_decode(candidate):
        order.append("decode")
        result = original_decode(candidate)
        decoded.append(copy.deepcopy(result))
        return result

    def record_import(source, images):
        order.append("import")
        result = original_import(source, images)
        imported.append(result)
        return result

    @contextmanager
    def observe_pixels(candidate, *args, **kwargs):
        with original_pixels(candidate, *args, **kwargs) as result:
            width, height = result.metadata["width"], result.metadata["height"]
            orientation = result.metadata["orientation"]
            expected_size = (height, width) if orientation >= 5 else (width, height)
            assert result.image.size == expected_size
            assert result.image.getpixel((0, 0)) is not None
            last_position = (expected_size[0] - 1, expected_size[1] - 1)
            assert result.image.getpixel(last_position) is not None
            pixels.append(candidate["key"])
            yield result

    scan_call = Mock(side_effect=record_scan)
    decode_call = Mock(side_effect=record_decode)
    import_call = Mock(side_effect=record_import)
    inventory_call = Mock(side_effect=record_inventory)
    monkeypatch.setattr(modules.scanner, "enumerate_and_hash", scan_call)
    monkeypatch.setattr(modules.decoder, "decode_image", decode_call)
    monkeypatch.setattr(modules.decoder, "open_decoded_image", observe_pixels)
    monkeypatch.setattr(modules.classifier, "import_classification", import_call)
    monkeypatch.setattr(verifier, "verify_inventory", inventory_call)
    original_open = io.open

    def read_only(file, mode="r", *args, **kwargs):
        assert mode in ("r", "rb")
        return original_open(file, mode, *args, **kwargs)

    blocked = Mock(side_effect=AssertionError("SP-07 must not write or resize"))
    assert modules.decoder.ImageFile.LOAD_TRUNCATED_IMAGES is False
    with monkeypatch.context() as guard:
        guard.setattr(io, "open", read_only)
        guard.setattr(builtins, "open", read_only)
        for name in (
            "mkdir",
            "unlink",
            "rename",
            "replace",
            "write_bytes",
            "write_text",
        ):
            guard.setattr(Path, name, blocked)
        guard.setattr(modules.decoder.Image.Image, "resize", blocked)
        guard.setattr(modules.decoder.Image.Image, "thumbnail", blocked)
        result = verifier.verify_classification(_ASSETS)
    blocked.assert_not_called()
    assert modules.decoder.ImageFile.LOAD_TRUNCATED_IMAGES is False
    assert order == ["inventory", "scan", *(["decode"] * 60), "import", "inventory"]
    assert inventory_call.call_count == 2
    source = {"format": "folder", "root": str(_ASSETS / "beans" / "images")}
    scan_call.assert_called_once_with(source)
    scan = scans[0]
    import_call.assert_called_once_with(source, scan.images)
    assert decode_call.call_count == len(decoded) == len(pixels) == 60
    assert [call.args[0] for call in decode_call.call_args_list] == list(scan.images)
    assert pixels == [image["key"] for image in scan.images]
    assert scan.issues == imported[0].issues == []

    manifest = json.loads((_ASSETS / "beans/manifest.json").read_bytes())
    expected = {entry["path"]: entry for entry in manifest["images"]}
    classes = {entry["key"]: entry["name"] for entry in imported[0].classes}
    counts = dict.fromkeys(verifier.LABELS, 0)
    seen = set()
    for candidate, image in zip(scan.images, decoded, strict=True):
        relative = Path(candidate["sourcePath"]).relative_to(_ASSETS / "beans")
        entry = expected[relative.as_posix()]
        source_id = "train/" + relative.as_posix().removeprefix("images/")
        assert entry["sourceId"] == source_id
        assert (candidate["byteSize"], candidate["sha256"]) == (
            entry["byteSize"],
            entry["sha256"],
        )
        assert image == {
            **candidate,
            "width": image["width"],
            "height": image["height"],
            "orientation": image["orientation"],
            "annotation": None,
        }
        annotation = imported[0].annotations[image["key"]]
        assert annotation is not None
        assert annotation == {
            "type": "classification",
            "classKey": annotation["classKey"],
            "sourceRow": None,
        }
        name = classes[annotation["classKey"]]
        assert name == entry["label"]
        counts[name] += 1
        seen.add(entry["sourceId"])
    assert seen == {entry["sourceId"] for entry in manifest["images"]}
    assert counts == result["classCounts"] == _CLASSIFICATION_RESULT["classCounts"]
    assert all(entry["sourceCategoryId"] is None for entry in imported[0].classes)
    assert _snapshot(_ASSETS) == modules.before
    # Capture the actual explicit function's JSON output, not a fake CLI result.
    silent = capsys.readouterr()
    assert silent.out == silent.err == ""
    print(json.dumps(result, sort_keys=True))
    captured = capsys.readouterr()
    assert captured.err == "" and json.loads(captured.out) == _CLASSIFICATION_RESULT


@pytest.mark.parametrize(
    "damage", ["count", "key", "hash", "size", "path", "mtime", "format", "issue"]
)
def test_classification_rejects_normal_scan_faults_before_decode(
    verifier, normal_modules, monkeypatch, damage
):
    modules = normal_modules
    original = modules.scanner.enumerate_and_hash
    reached = []

    def faulty_scan(source):
        result = original(source)
        assert len(result.images) == 60 and result.issues == []
        reached.append(result)
        images = copy.deepcopy(list(result.images))
        if damage == "count":
            images.pop()
        elif damage == "key":
            images[1]["key"] = images[0]["key"]
        elif damage == "issue":
            return replace(result, issues=[_classification_issue(images[0])])
        else:
            field, value = {
                "hash": ("sha256", "0" * 64),
                "size": ("byteSize", images[0]["byteSize"] + 1),
                "path": ("sourcePath", images[1]["sourcePath"]),
                "mtime": ("mtimeNs", str(int(images[0]["mtimeNs"]) + 1)),
                "format": ("format", "png"),
            }[damage]
            images[0][field] = value
        return replace(result, images=tuple(images))

    scan = Mock(side_effect=faulty_scan)
    decode = Mock(side_effect=AssertionError("Invalid scan must not be decoded"))
    classifier = Mock(side_effect=AssertionError("Invalid scan must not be imported"))
    monkeypatch.setattr(modules.scanner, "enumerate_and_hash", scan)
    monkeypatch.setattr(modules.decoder, "decode_image", decode)
    monkeypatch.setattr(modules.classifier, "import_classification", classifier)
    with pytest.raises(ValueError):
        verifier.verify_classification(_ASSETS)
    assert len(reached) == scan.call_count == 1
    decode.assert_not_called()
    classifier.assert_not_called()


@pytest.mark.parametrize(
    "damage",
    [
        "width",
        "orientation",
        "hash",
        "key",
        "annotation",
        "confirmed",
        "missing",
        "raise",
    ],
)
def test_classification_rejects_actual_decoder_result_faults(
    verifier, normal_modules, monkeypatch, damage
):
    modules = normal_modules
    original = modules.decoder.decode_image
    reached = []

    def faulty_decode(candidate):
        result = original(candidate)
        reached.append(copy.deepcopy(result))
        result = dict(result)
        if damage == "raise":
            raise modules.decoder.DecodeError("INVALID_IMAGE")
        if damage == "missing":
            result.pop("height")
        else:
            field, value = {
                "width": ("width", 0),
                "orientation": ("orientation", 9),
                "hash": ("sha256", "0" * 64),
                "key": ("key", "image:unexpected"),
                "annotation": (
                    "annotation",
                    {
                        "type": "classification",
                        "classKey": "class:0",
                        "sourceRow": None,
                    },
                ),
                "confirmed": ("confirmed", True),
            }[damage]
            result[field] = value
        return result

    decode = Mock(side_effect=faulty_decode)
    classifier = Mock(side_effect=AssertionError("Invalid decode must not be imported"))
    monkeypatch.setattr(modules.decoder, "decode_image", decode)
    monkeypatch.setattr(modules.classifier, "import_classification", classifier)
    with pytest.raises(ValueError):
        verifier.verify_classification(_ASSETS)
    assert len(reached) == decode.call_count == 1
    assert reached[0]["width"] > 0 and reached[0]["annotation"] is None
    classifier.assert_not_called()


def test_classification_pixel_load_failure_is_not_header_only_success(
    verifier, normal_modules, monkeypatch
):
    modules = normal_modules
    header = Mock(wraps=modules.decoder._header)
    load = Mock(side_effect=OSError("private pixel-load failure"))
    classifier = Mock(side_effect=AssertionError("No import after failed pixel load"))
    monkeypatch.setattr(modules.decoder, "_header", header)
    monkeypatch.setattr(modules.decoder.ImageFile.ImageFile, "load", load)
    monkeypatch.setattr(modules.classifier, "import_classification", classifier)
    with pytest.raises(modules.decoder.DecodeError) as caught:
        verifier.verify_classification(_ASSETS)
    assert header.call_count >= 1 and load.call_count >= 1
    assert caught.value.code == "INVALID_IMAGE"
    classifier.assert_not_called()


@pytest.mark.parametrize(
    "damage",
    [
        "swap-labels",
        "missing-annotation",
        "extra-annotation",
        "source-row",
        "confirmed",
        "class-name",
        "class-count",
        "issues",
        "raise",
    ],
)
def test_classification_rejects_actual_importer_result_faults(
    verifier, normal_modules, monkeypatch, damage
):
    modules = normal_modules
    original = modules.classifier.import_classification
    reached = []

    def faulty_import(source, images):
        result = original(source, images)
        assert result.issues == [] and len(result.annotations) == 60
        reached.append(result)
        result = copy.deepcopy(result)
        annotations = dict(result.annotations)
        first = annotations[images[0]["key"]]
        assert first is not None
        if damage == "swap-labels":
            other = next(
                entry
                for entry in annotations.values()
                if entry["classKey"] != first["classKey"]
            )
            first["classKey"], other["classKey"] = other["classKey"], first["classKey"]
            # Every aggregate is still 20: only per-image parity catches this.
            labels = [entry["classKey"] for entry in annotations.values()]
            assert all(labels.count(cls["key"]) == 20 for cls in result.classes)
        elif damage == "missing-annotation":
            annotations.pop(images[-1]["key"])
        elif damage == "extra-annotation":
            annotations["image:unexpected"] = dict(first)
        elif damage == "source-row":
            first["sourceRow"] = 1
        elif damage == "confirmed":
            first["confirmed"] = True
        elif damage == "class-name":
            result.classes[0]["name"] = "renamed"
        elif damage == "class-count":
            return replace(result, classes=result.classes[:-1])
        elif damage == "issues":
            return replace(result, issues=[_classification_issue(images[0])])
        elif damage == "raise":
            raise modules.classifier.ImportFormatError("ANNOTATION_READ_FAILED")
        return replace(result, annotations=annotations)

    classifier = Mock(side_effect=faulty_import)
    decode = Mock(wraps=modules.decoder.decode_image)
    monkeypatch.setattr(modules.classifier, "import_classification", classifier)
    monkeypatch.setattr(modules.decoder, "decode_image", decode)
    with pytest.raises(ValueError):
        verifier.verify_classification(_ASSETS)
    assert len(reached) == classifier.call_count == 1
    assert decode.call_count == 60


def test_classification_class_keys_are_scan_local_independent_namespaces(
    verifier, normal_modules, monkeypatch
):
    modules = normal_modules
    original = modules.classifier.import_classification

    def rekey(source, images):
        result = original(source, images)
        keys = {
            entry["key"]: images[index]["key"]
            for index, entry in enumerate(result.classes)
        }
        # Valid opaque class keys may equal image keys; order is not a label ID.
        return replace(
            result,
            classes=tuple(
                {**entry, "key": keys[entry["key"]]}
                for entry in reversed(result.classes)
            ),
            annotations={
                key: {**entry, "classKey": keys[entry["classKey"]]}
                for key, entry in result.annotations.items()
            },
        )

    classifier = Mock(side_effect=rekey)
    monkeypatch.setattr(modules.classifier, "import_classification", classifier)
    assert verifier.verify_classification(_ASSETS) == _CLASSIFICATION_RESULT
    assert classifier.call_count == 1


def test_classification_rechecks_gwhd_inventory_after_normal_import(
    verifier, normal_modules, monkeypatch
):
    modules = normal_modules
    original_import = modules.classifier.import_classification
    original_read = verifier._read
    completed = []
    changed_reads = []
    target = _ASSETS / "gwhd-2021/LICENSE.txt"

    def imported(source, images):
        result = original_import(source, images)
        completed.append(result)
        return result

    def changed_observation(path, *args, **kwargs):
        metadata, raw = original_read(path, *args, **kwargs)
        if completed and path == target:
            changed_reads.append(path)
            metadata = {**metadata, "sha256": "0" * 64}
        return metadata, raw

    classifier = Mock(side_effect=imported)
    decode = Mock(wraps=modules.decoder.decode_image)
    monkeypatch.setattr(modules.classifier, "import_classification", classifier)
    monkeypatch.setattr(modules.decoder, "decode_image", decode)
    monkeypatch.setattr(verifier, "_read", changed_observation)
    with pytest.raises(ValueError, match="Inventory size or SHA-256 mismatch"):
        verifier.verify_classification(_ASSETS)
    assert len(completed) == classifier.call_count == 1
    assert decode.call_count == 60 and changed_reads == [target]


def _file_stats(root):
    return {
        path.relative_to(root).as_posix(): _stat_copy(path.lstat())
        for path in root.rglob("*")
        if path.is_file()
    }


@pytest.fixture(scope="module")
def detection_baseline():
    """Run both real pipelines once, even when only a negative test is selected."""
    if os.name != "nt":
        pytest.skip("SP-08 uses the Windows-native DAT-02/03/04/05 pipeline")
    with pytest.MonkeyPatch.context() as patch:
        offline = Mock(side_effect=AssertionError("SP-08 must remain offline"))
        patch.setattr(socket, "create_connection", offline)
        patch.setattr(socket, "getaddrinfo", offline)
        patch.setattr(socket.socket, "connect", offline)
        module = _load(patch)
        from autovision_ml.data import (
            classification_import,
            coco_import,
            image_decode,
            image_scan,
        )

        before, stats = _snapshot(_ASSETS), _file_stats(_ASSETS)
        assert len(stats) == 87
        order, results, pixels = [], {}, []

        def observe(owner, name):
            original = getattr(owner, name)
            results[name] = []

            def call(*args):
                order.append(name)
                result = original(*args)
                results[name].append(copy.deepcopy(result))
                return result

            observer = Mock(side_effect=call)
            patch.setattr(owner, name, observer)
            return observer

        calls = {
            name: observe(owner, name)
            for owner, name in (
                (module, "verify_inventory"),
                (module, "verify_classification"),
                (image_scan, "enumerate_and_hash"),
                (image_decode, "decode_image"),
                (classification_import, "import_classification"),
                (coco_import, "import_coco"),
            )
        }
        original_pixels = image_decode.open_decoded_image

        @contextmanager
        def observe_pixels(candidate, *args, **kwargs):
            with original_pixels(candidate, *args, **kwargs) as item:
                width, height = item.metadata["width"], item.metadata["height"]
                size = (
                    (height, width)
                    if item.metadata["orientation"] >= 5
                    else (width, height)
                )
                assert item.image.size == size
                assert item.image.getpixel((0, 0)) is not None
                assert item.image.getpixel((size[0] - 1, size[1] - 1)) is not None
                pixels.append((candidate["sourcePath"], candidate["key"]))
                yield item

        patch.setattr(image_decode, "open_decoded_image", observe_pixels)
        original_open = io.open

        def read_only(file, mode="r", *args, **kwargs):
            assert mode in ("r", "rb")
            return original_open(file, mode, *args, **kwargs)

        blocked = Mock(side_effect=AssertionError("SP-08 must not write or resize"))
        patch.setattr(io, "open", read_only)
        patch.setattr(builtins, "open", read_only)
        for name in (
            "mkdir",
            "unlink",
            "rename",
            "replace",
            "write_bytes",
            "write_text",
        ):
            patch.setattr(Path, name, blocked)
        for name in ("resize", "thumbnail", "save"):
            patch.setattr(image_decode.Image.Image, name, blocked)
        assert image_decode.ImageFile.LOAD_TRUNCATED_IMAGES is False
        try:
            result = module.verify_detection(_ASSETS)
        finally:
            assert _snapshot(_ASSETS) == before
            assert _file_stats(_ASSETS) == stats
        blocked.assert_not_called()
        offline.assert_not_called()
        assert image_decode.ImageFile.LOAD_TRUNCATED_IMAGES is False
        assert results["verify_classification"] == [_CLASSIFICATION_RESULT]
        assert result["normalDecodeImport"] == "PASS"
        assert result["classificationDecodeImport"] == "PASS"
        assert result["detectionDecodeImport"] == "PASS"
        assert result["imageCount"] == result["decodedImageCount"] == 20
        assert result["annotationCount"] == 1079 and result["issues"] == []
        baseline = SimpleNamespace(
            result=result,
            classification=results["verify_classification"][0],
            calls=calls,
            results=results,
            order=order,
            pixels=pixels,
            before=before,
            stats=stats,
        )
    # All spies/guards are restored before function-scoped fault injection.
    return baseline


@pytest.fixture
def detection_modules(verifier, normal_modules, detection_baseline, monkeypatch):
    from autovision_ml.data import coco_import

    # Never hard-code a successful prerequisite or cache a fake decoded image.
    classification = Mock(return_value=copy.deepcopy(detection_baseline.classification))
    monkeypatch.setattr(verifier, "verify_classification", classification)
    stats = _file_stats(_ASSETS)
    yield SimpleNamespace(
        scanner=normal_modules.scanner,
        decoder=normal_modules.decoder,
        importer=coco_import,
        classification=classification,
    )
    classification.assert_called_once_with(_ASSETS)
    assert _file_stats(_ASSETS) == stats
    # normal_modules separately compares every raw SHA-256 and file inventory.


def test_real_gwhd_all_images_and_boxes_use_normal_pipeline_once(
    detection_baseline, capsys
):
    baseline = detection_baseline
    calls, results = baseline.calls, baseline.results
    assert baseline.order == [
        "verify_inventory",
        "verify_classification",
        "verify_inventory",
        "enumerate_and_hash",
        *(["decode_image"] * 60),
        "import_classification",
        "verify_inventory",
        "enumerate_and_hash",
        *(["decode_image"] * 20),
        "import_coco",
        "verify_inventory",
    ]
    calls["verify_classification"].assert_called_once_with(_ASSETS)
    assert calls["verify_inventory"].call_count == 4
    assert calls["import_classification"].call_count == 1
    assert calls["enumerate_and_hash"].call_count == 2
    assert calls["decode_image"].call_count == len(baseline.pixels) == 80
    source = {
        "format": "coco",
        "root": str(_ASSETS / "gwhd-2021/images"),
        "annotationPath": str(_ASSETS / "gwhd-2021/annotations.coco.json"),
    }
    assert calls["enumerate_and_hash"].call_args_list[1].args == (source,)
    scan = results["enumerate_and_hash"][1]
    decoded = results["decode_image"][60:]
    calls["import_coco"].assert_called_once_with(source, decoded)
    assert (
        calls["import_coco"].call_args.args[0]
        is calls["enumerate_and_hash"].call_args_list[1].args[0]
    )
    assert len(scan.images) == len(decoded) == 20
    assert [call.args[0] for call in calls["decode_image"].call_args_list[60:]] == list(
        scan.images
    )
    assert baseline.pixels[60:] == [
        (image["sourcePath"], image["key"]) for image in scan.images
    ]
    imported = results["import_coco"][0]
    assert scan.issues == imported.issues == []
    assert len(imported.classes) == 1 and len(imported.annotations) == 20
    class_key = imported.classes[0]["key"]
    assert imported.classes == (
        {"key": class_key, "name": "wheat_head", "sourceCategoryId": "1"},
    )

    manifest = json.loads((_ASSETS / "gwhd-2021/manifest.json").read_bytes())
    raw = (_ASSETS / "gwhd-2021/annotations.coco.json").read_bytes()
    entry = next(
        item for item in manifest["files"] if item["path"] == "annotations.coco.json"
    )
    assert _metadata(raw) == {key: entry[key] for key in ("byteSize", "sha256")}
    coco = json.loads(raw)
    expected = {
        item["path"].removeprefix("images/"): item for item in manifest["images"]
    }
    originals = {item["file_name"]: item for item in coco["images"]}
    grouped = {item["id"]: [] for item in coco["images"]}
    for annotation in coco["annotations"]:
        grouped[annotation["image_id"]].append(annotation)
    formats, source_ids, annotation_ids = {}, set(), []
    for candidate, image in zip(scan.images, decoded, strict=True):
        path = Path(candidate["sourcePath"])
        relative = path.relative_to(Path(source["root"])).as_posix()
        item, original = expected[relative], originals[relative]
        assert item["sourceFilename"] == item["sourceId"] + ".png"
        assert Path(relative).stem == item["sourceId"]
        assert candidate["sha256"] == item["sha256"]
        assert candidate["byteSize"] == item["byteSize"]
        assert candidate["format"] == item["detectedFormat"]
        assert (original["width"], original["height"]) == (1024, 1024)
        assert image == {
            **candidate,
            "width": original["width"],
            "height": original["height"],
            "orientation": 1,
            "annotation": None,
        }
        annotation = imported.annotations[image["key"]]
        assert annotation == {
            "type": "detection",
            "sourceImageId": str(original["id"]),
            "boxes": [
                {
                    "classKey": class_key,
                    "bbox": box["bbox"],
                    "sourceAnnotationId": str(box["id"]),
                }
                for box in grouped[original["id"]]
            ],
        }
        assert all(
            type(value) is int for box in annotation["boxes"] for value in box["bbox"]
        )
        annotation_ids.extend(box["sourceAnnotationId"] for box in annotation["boxes"])
        source_ids.add(annotation["sourceImageId"])
        kind = image["format"]
        formats[kind] = formats.get(kind, 0) + 1
    assert source_ids == {str(item["id"]) for item in coco["images"]}
    assert source_ids == {str(number) for number in range(1, 21)}
    assert len(annotation_ids) == len(set(annotation_ids)) == 1079
    assert set(annotation_ids) == {str(item["id"]) for item in coco["annotations"]}
    declared = {
        kind: sum(item["detectedFormat"] == kind for item in manifest["images"])
        for kind in formats
    }
    assert formats == declared == {"jpeg": 2, "png": 18}
    inventories = results["verify_inventory"]
    assert all(result == inventories[0] for result in inventories)
    assert _snapshot(_ASSETS) == baseline.before
    assert _file_stats(_ASSETS) == baseline.stats
    assert baseline.result == {
        "scope": "detection-import",
        "inventory": "PASS",
        "normalDecodeImport": "PASS",
        "manifestTrust": "reviewed-pins",
        "sampleId": "gwhd-2021",
        "fileCount": 87,
        "totalBytes": 44942112,
        "imageCount": 20,
        "decodedImageCount": 20,
        "formatCounts": declared,
        "annotatedImageCount": 20,
        "annotationCount": 1079,
        "classCount": 1,
        "classCounts": {"wheat_head": 1079},
        "classificationDecodeImport": "PASS",
        "detectionDecodeImport": "PASS",
        "issues": baseline.classification["issues"] + scan.issues + imported.issues,
    }
    silent = capsys.readouterr()
    assert silent.out == silent.err == ""
    print(json.dumps(baseline.result, sort_keys=True))
    captured = capsys.readouterr()
    assert captured.err == "" and json.loads(captured.out) == baseline.result


def test_inventory_cli_remains_lazy_and_rejects_detection_flags(
    verifier, no_ml_imports, monkeypatch, capsys
):
    blocked = Mock(side_effect=AssertionError("Normal imports require explicit calls"))
    monkeypatch.setattr(verifier, "verify_classification", blocked)
    monkeypatch.setattr(verifier, "verify_detection", blocked)
    assert verifier.main([]) == 0
    assert json.loads(capsys.readouterr().out)["normalDecodeImport"] == "NOT_RUN"
    for argv in (["--detection"], ["detection"]):
        assert verifier.main(argv) == 1
        result = json.loads(capsys.readouterr().out)
        assert result["scope"] == "inventory-only"
        assert result["normalDecodeImport"] == "NOT_RUN"
    blocked.assert_not_called()


def test_detection_missing_root_fails_before_ml_import(
    verifier, no_ml_imports, tmp_path
):
    missing = tmp_path / "missing-samples"
    with pytest.raises(OSError):
        verifier.verify_detection(missing)
    assert not missing.exists()


def test_detection_checks_reviewed_pins_before_sp07(env, no_ml_imports, monkeypatch):
    blocked = Mock(side_effect=AssertionError("Untrusted inventory must stop first"))
    monkeypatch.setattr(env.v, "verify_classification", blocked)
    before = _snapshot(env.root)
    with pytest.raises(ValueError, match="trusted SHA-256"):
        env.v.verify_detection(env.root)
    blocked.assert_not_called()
    assert _snapshot(env.root) == before


@pytest.mark.parametrize("damage", ["not-run", "issues", "raise"])
def test_detection_requires_actual_sp07_success(
    verifier, detection_modules, monkeypatch, damage
):
    modules = detection_modules
    if damage == "raise":
        modules.classification.side_effect = ValueError("SP-07 failed")
    elif damage == "not-run":
        modules.classification.return_value["normalDecodeImport"] = "NOT_RUN"
    else:
        modules.classification.return_value["issues"] = [{"severity": "warning"}]
    blocked = Mock(side_effect=AssertionError("Detection must wait for SP-07"))
    monkeypatch.setattr(modules.scanner, "enumerate_and_hash", blocked)
    monkeypatch.setattr(modules.decoder, "decode_image", blocked)
    monkeypatch.setattr(modules.importer, "import_coco", blocked)
    with pytest.raises(ValueError, match="SP-07"):
        verifier.verify_detection(_ASSETS)
    blocked.assert_not_called()


def test_detection_missing_coco_dependency_is_explicit_not_run(
    verifier, detection_modules, monkeypatch, capsys
):
    original = builtins.__import__
    inventory = Mock(wraps=verifier.verify_inventory)
    attempts = []

    def unavailable(name, *args, **kwargs):
        if name == "autovision_ml.data.coco_import":
            assert inventory.call_count == 1
            detection_modules.classification.assert_called_once_with(_ASSETS)
            attempts.append(name)
            raise ModuleNotFoundError("private dependency details", name=name)
        return original(name, *args, **kwargs)

    monkeypatch.setattr(verifier, "verify_inventory", inventory)
    monkeypatch.setattr(builtins, "__import__", unavailable)
    with pytest.raises(
        ValueError, match="Detection normalDecodeImport NOT_RUN"
    ) as caught:
        verifier.verify_detection(_ASSETS)
    assert len(attempts) == 1 and inventory.call_count == 2
    assert "existing ML environment" in str(caught.value)
    assert "private" not in str(caught.value)
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


@pytest.mark.parametrize("damage", ["format", "issue"])
def test_detection_rejects_normal_scan_faults_before_decode(
    verifier, detection_modules, monkeypatch, damage
):
    modules = detection_modules
    original = modules.scanner.enumerate_and_hash

    def faulty_scan(source):
        result = original(source)
        assert len(result.images) == 20 and result.issues == []
        images = copy.deepcopy(list(result.images))
        if damage == "issue":
            issue = _classification_issue(images[0])
            issue["severity"] = "warning"
            return replace(result, issues=[issue])
        images[0]["format"] = "png" if images[0]["format"] == "jpeg" else "jpeg"
        return replace(result, images=tuple(images))

    scan = Mock(side_effect=faulty_scan)
    blocked = Mock(side_effect=AssertionError("Invalid scan must not be processed"))
    monkeypatch.setattr(modules.scanner, "enumerate_and_hash", scan)
    monkeypatch.setattr(modules.decoder, "decode_image", blocked)
    monkeypatch.setattr(modules.importer, "import_coco", blocked)
    with pytest.raises(ValueError, match="Normal detection scan"):
        verifier.verify_detection(_ASSETS)
    assert scan.call_count == 1
    blocked.assert_not_called()


@pytest.mark.parametrize("damage", ["dimensions", "orientation"])
def test_detection_checks_actual_decoded_geometry_against_frozen_baseline(
    verifier, detection_modules, monkeypatch, damage
):
    modules = detection_modules
    original = modules.decoder.decode_image

    def faulty_decode(candidate):
        result = original(candidate)
        assert (result["width"], result["height"]) == (1024, 1024)
        assert result["orientation"] == 1
        field = "width" if damage == "dimensions" else "orientation"
        return {**result, field: result[field] + 1}

    decode = Mock(side_effect=faulty_decode)
    blocked = Mock(side_effect=AssertionError("Geometry mismatch must stop import"))
    monkeypatch.setattr(modules.decoder, "decode_image", decode)
    monkeypatch.setattr(modules.importer, "import_coco", blocked)
    with pytest.raises(ValueError, match="geometry differs from frozen baseline"):
        verifier.verify_detection(_ASSETS)
    assert decode.call_count == 1
    blocked.assert_not_called()


def test_detection_rejects_decoder_byte_size_float(
    verifier, detection_modules, detection_baseline, monkeypatch
):
    modules = detection_modules
    original = modules.decoder.decode_image

    def faulty_decode(candidate):
        result = dict(original(candidate))
        size = result["byteSize"]
        assert type(size) is int
        result["byteSize"] = float(size)
        assert result["byteSize"] == size  # Value-only equality misses this fault.
        return result

    decode = Mock(side_effect=faulty_decode)
    blocked = Mock(side_effect=AssertionError("Invalid decode must stop import"))
    monkeypatch.setattr(modules.decoder, "decode_image", decode)
    monkeypatch.setattr(modules.importer, "import_coco", blocked)
    with pytest.raises(ValueError, match="^Normal decoder changed raw image metadata$"):
        verifier.verify_detection(_ASSETS)
    assert decode.call_count == 1
    blocked.assert_not_called()
    assert _snapshot(_ASSETS) == detection_baseline.before
    assert _file_stats(_ASSETS) == detection_baseline.stats


def test_detection_rejects_importer_orientation_bool(
    verifier, detection_modules, detection_baseline, monkeypatch
):
    modules = detection_modules
    original = modules.importer.import_coco

    def faulty_import(source, images):
        result = original(source, images)
        assert result.issues == [] and len(result.annotations) == 20
        assert sum(len(item["boxes"]) for item in result.annotations.values()) == 1079
        assert type(images[0]["orientation"]) is int
        assert images[0]["orientation"] == 1
        images[0]["orientation"] = True  # Mutate only AFTER the real import.
        return result

    importer = Mock(side_effect=faulty_import)
    decode = Mock(wraps=modules.decoder.decode_image)
    monkeypatch.setattr(modules.importer, "import_coco", importer)
    monkeypatch.setattr(modules.decoder, "decode_image", decode)
    with pytest.raises(
        ValueError, match="^Normal detection pipeline changed input metadata$"
    ):
        verifier.verify_detection(_ASSETS)
    assert importer.call_count == 1 and decode.call_count == 20
    assert _snapshot(_ASSETS) == detection_baseline.before
    assert _file_stats(_ASSETS) == detection_baseline.stats


@pytest.mark.parametrize(
    "damage",
    [
        "bbox",
        "drop-box",
        "source-id",
        "image-id",
        "class-key",
        "category-id",
        "class-name",
        "order",
        "issues",
        "confirmed",
        "mutated-input",
        "raise",
    ],
)
def test_detection_rejects_actual_coco_importer_result_faults(
    verifier, detection_modules, monkeypatch, damage
):
    modules = detection_modules
    original = modules.importer.import_coco
    reached = []

    def faulty_import(source, images):
        result = original(source, images)
        assert result.issues == [] and len(result.annotations) == 20
        assert sum(len(item["boxes"]) for item in result.annotations.values()) == 1079
        reached.append(result)
        result = copy.deepcopy(result)
        first = result.annotations[images[0]["key"]]
        box = first["boxes"][0]
        if damage == "bbox":
            box["bbox"][0] += 0.5
        elif damage == "drop-box":
            first["boxes"].pop(0)
        elif damage == "source-id":
            box["sourceAnnotationId"] = first["boxes"][1]["sourceAnnotationId"]
        elif damage == "image-id":
            other = result.annotations[images[1]["key"]]
            first["sourceImageId"] = other["sourceImageId"]
        elif damage == "class-key":
            box["classKey"] = "class:unexpected"
        elif damage == "category-id":
            result.classes[0]["sourceCategoryId"] = "2"
        elif damage == "class-name":
            result.classes[0]["name"] = "renamed"
        elif damage == "order":
            first["boxes"].reverse()
        elif damage == "issues":
            issue = _classification_issue(images[0])
            issue["severity"] = "warning"
            return replace(result, issues=[issue])
        elif damage == "confirmed":
            box["confirmed"] = True
        elif damage == "mutated-input":
            images[0]["annotation"] = first
        else:
            raise modules.importer.CocoFormatError("COCO_INVALID_BBOX")
        return result

    importer = Mock(side_effect=faulty_import)
    decode = Mock(wraps=modules.decoder.decode_image)
    monkeypatch.setattr(modules.importer, "import_coco", importer)
    monkeypatch.setattr(modules.decoder, "decode_image", decode)
    with pytest.raises(ValueError):
        verifier.verify_detection(_ASSETS)
    assert len(reached) == importer.call_count == 1
    assert decode.call_count == 20


def test_detection_allows_opaque_class_keys_and_image_mapping_order(
    verifier, detection_modules, detection_baseline, monkeypatch
):
    modules = detection_modules
    original = modules.importer.import_coco

    def rekey(source, images):
        result = original(source, images)
        key = images[0]["key"]  # Class and image keys are separate namespaces.
        return replace(
            result,
            classes=({**result.classes[0], "key": key},),
            annotations={
                image_key: {
                    **annotation,
                    "boxes": [{**box, "classKey": key} for box in annotation["boxes"]],
                }
                for image_key, annotation in reversed(tuple(result.annotations.items()))
            },
        )

    importer = Mock(side_effect=rekey)
    monkeypatch.setattr(modules.importer, "import_coco", importer)
    assert verifier.verify_detection(_ASSETS) == detection_baseline.result
    assert importer.call_count == 1


@pytest.mark.parametrize("damage", ["hash", "stat"])
def test_detection_rechecks_all_inventory_after_normal_import(
    verifier, detection_modules, monkeypatch, damage
):
    modules = detection_modules
    original_import = modules.importer.import_coco
    original_inventory = verifier.verify_inventory
    original_read, original_node = verifier._read, verifier._node
    completed, rechecked, observed = [], [], []
    target = _ASSETS / "beans/LICENSE.txt"  # Include the OTHER dataset's notices.

    def imported(source, images):
        result = original_import(source, images)
        completed.append(result)
        return result

    def inventory(root):
        result = original_inventory(root)
        if completed:
            rechecked.append(result)
        return result

    def changed_read(path, *args, **kwargs):
        metadata, raw = original_read(path, *args, **kwargs)
        if damage == "hash" and completed and path == target:
            observed.append(path)
            metadata = {**metadata, "sha256": "0" * 64}
        return metadata, raw

    def changed_stat(path, directory):
        info = original_node(path, directory)
        if damage == "stat" and rechecked and path == target and not directory:
            observed.append(path)
            return _stat_copy(info, st_mtime_ns=info.st_mtime_ns + 1)
        return info

    importer = Mock(side_effect=imported)
    decode = Mock(wraps=modules.decoder.decode_image)
    monkeypatch.setattr(modules.importer, "import_coco", importer)
    monkeypatch.setattr(modules.decoder, "decode_image", decode)
    monkeypatch.setattr(verifier, "verify_inventory", inventory)
    monkeypatch.setattr(verifier, "_read", changed_read)
    monkeypatch.setattr(verifier, "_node", changed_stat)
    message = (
        "Inventory size or SHA-256 mismatch"
        if damage == "hash"
        else "Sample inventory changed during detection verification"
    )
    with pytest.raises(ValueError, match=message):
        verifier.verify_detection(_ASSETS)
    assert len(completed) == importer.call_count == 1
    assert decode.call_count == 20 and observed == [target]
    assert len(rechecked) == (0 if damage == "hash" else 1)
