"""Offline DATA-00 fixtures; run explicitly using the parent's ml venv/config."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import stat
import sys
import traceback
import urllib.error
from email.message import Message
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, Mock

import pytest

_DATA = b"\x00original\r\nbytes\xff"
_HASH = hashlib.sha256(_DATA).hexdigest()
_INITIAL = 31744


@pytest.fixture
def sample(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "_data00_sample_io", Path(__file__).with_name("sample_io.py")
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "CACHE_ROOT", tmp_path / "cache")
    opener = Mock()
    opener.open.side_effect = AssertionError("Offline fixture: unexpected network")
    monkeypatch.setattr(
        module.urllib.request, "build_opener", Mock(return_value=opener)
    )
    return module


def _reply(sample: ModuleType, data: bytes = _DATA) -> MagicMock:
    response = MagicMock()
    response.__enter__.return_value = response
    response.status = 200
    response.headers = Message()
    response.geturl.return_value = sample._BEANS_URL
    response.read.side_effect = io.BytesIO(data).read
    opener = sample.urllib.request.build_opener.return_value
    opener.open.side_effect = None
    opener.open.return_value = response
    return response


def _get(sample: ModuleType, **kwargs: object) -> dict[str, int | str]:
    return sample.download(
        sample._BEANS_URL,
        sample.CACHE_ROOT / "beans/train.zip",
        expected_size=len(_DATA),
        max_bytes=len(_DATA),
        **kwargs,
    )


def _ledger(sample: ModuleType) -> dict[str, Any]:
    return json.loads((sample.CACHE_ROOT / "acquisition.json").read_bytes())


def _clean(sample: ModuleType) -> None:
    assert not (sample.CACHE_ROOT / ".acquisition.lock").exists()
    assert not list(sample.CACHE_ROOT.rglob("*.part"))


def test_raw_metadata_and_idempotent_publication(
    sample: ModuleType,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "assets/image.bin"
    sample.write_new(target, _DATA)
    sample.write_new(target, _DATA)
    with pytest.raises(FileExistsError):
        sample.write_new(target, b"different")
    assert target.read_bytes() == _DATA
    with monkeypatch.context() as patch:
        patch.setattr(
            Path, "read_bytes", Mock(side_effect=AssertionError("not streaming"))
        )
        assert sample.file_metadata(target) == {"byteSize": len(_DATA), "sha256": _HASH}
    empty = tmp_path / "empty.json"
    sample.write_new(empty, b"")
    assert sample.file_metadata(empty)["sha256"] == hashlib.sha256(b"").hexdigest()
    assert sample.__all__ == ["download", "file_metadata", "write_new"]


def test_write_failure_and_race_preserve_other_files(
    sample: ModuleType,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    other = tmp_path / "not-ours.part"
    other.write_bytes(b"keep")
    target = tmp_path / "asset.bin"
    with monkeypatch.context() as patch:
        patch.setattr(sample.os, "fsync", Mock(side_effect=OSError("disk failure")))
        with pytest.raises(OSError):
            sample.write_new(target, _DATA)
    assert not target.exists()
    original = sample.os.rename

    def competing_write(source: Path, destination: Path) -> None:
        destination.write_bytes(b"competing bytes")
        original(source, destination)

    monkeypatch.setattr(sample.os, "rename", competing_write)
    with pytest.raises(FileExistsError):
        sample.write_new(target, _DATA)
    assert target.read_bytes() == b"competing bytes"
    assert other.read_bytes() == b"keep"
    assert list(tmp_path.glob("*.part")) == [other]


@pytest.mark.parametrize("kind", ["directory", "hardlink"])
def test_rejects_nonregular_and_hardlinked_files(
    sample: ModuleType,
    tmp_path: Path,
    kind: str,
) -> None:
    target = tmp_path / "source"
    if kind == "directory":
        target.mkdir()
    else:
        target.write_bytes(_DATA)
        os.link(target, tmp_path / "alias")
    for action in (
        lambda: sample.file_metadata(target),
        lambda: sample.write_new(target, _DATA),
    ):
        with pytest.raises(ValueError):
            action()


@pytest.mark.parametrize(
    "mode,attributes",
    [
        (stat.S_IFLNK, 0),
        (stat.S_IFDIR, stat.FILE_ATTRIBUTE_REPARSE_POINT),
    ],
)
def test_link_and_windows_junction_ancestry(
    sample: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    mode: int,
    attributes: int,
) -> None:
    ancestor = sample.CACHE_ROOT
    original = Path.lstat

    def lstat(path: Path) -> object:
        if path == ancestor:
            return SimpleNamespace(st_mode=mode, st_file_attributes=attributes)
        return original(path)

    monkeypatch.setattr(Path, "lstat", lstat)
    for action in (
        lambda: _get(sample),
        lambda: sample.write_new(ancestor / "asset", _DATA),
        lambda: sample.file_metadata(ancestor / "asset"),
    ):
        with pytest.raises(ValueError):
            action()
    sample.urllib.request.build_opener.assert_not_called()


@pytest.mark.parametrize(
    "tail",
    [
        "../outside",
        "acquisition.json",
        ".acquisition.lock",
        "acquisition.json/child",
        "asset:stream",
    ],
)
def test_cache_boundary(sample: ModuleType, tail: str) -> None:
    with pytest.raises(ValueError):
        sample.download(
            sample._BEANS_URL, sample.CACHE_ROOT / tail, expected_size=1, max_bytes=1
        )
    assert not sample.CACHE_ROOT.exists()


@pytest.mark.parametrize(
    "url",
    [
        "http://huggingface.co/anything",
        "https://huggingface.co/anything",
        "https://user:secret@zenodo.org/anything",
        "https://zenodo.org/records/5092309",
        "https://zenodo.org/api/records/5092309/files/gwhd_2021.zip",
    ],
)
def test_unapproved_sources(sample: ModuleType, url: str) -> None:
    with pytest.raises(ValueError):
        sample.download(url, sample.CACHE_ROOT / "source", expected_size=1, max_bytes=1)
    assert not sample.CACHE_ROOT.exists()


@pytest.mark.parametrize("suffix", ["?token=secret", "#fragment", "\n"])
def test_fixed_source_forbids_query_and_fragment(
    sample: ModuleType,
    suffix: str,
) -> None:
    with pytest.raises(ValueError):
        sample.download(
            sample._BEANS_URL + suffix,
            sample.CACHE_ROOT / "source",
            expected_size=1,
            max_bytes=1,
        )


@pytest.mark.parametrize(
    "size,limit,pin",
    [
        (0, 1, None),
        (-1, 1, None),
        (True, 1, None),
        (1.0, 1, None),
        (1, 0, None),
        (1, True, None),
        (1, 1.0, None),
        (2, 1, None),
        (1, 2**63, None),
        (2**63, 2**63, None),
        (1, 1, ""),
        (1, 1, True),
    ],
)
def test_invalid_numeric_bounds_and_hash(
    sample: ModuleType,
    size: object,
    limit: object,
    pin: object,
) -> None:
    with pytest.raises(ValueError):
        sample.download(
            sample._BEANS_URL,
            sample.CACHE_ROOT / "source",
            expected_size=size,
            max_bytes=limit,
            sha256=pin,
        )
    assert not sample.CACHE_ROOT.exists()


@pytest.mark.parametrize("source", ["beans", "csv", "png"])
def test_reservation_before_network_and_offline_reuse(
    sample: ModuleType,
    source: str,
) -> None:
    url = {
        "beans": sample._BEANS_URL,
        "csv": sample._GWHD_PREFIX + "competition_train.csv",
        "png": sample._GWHD_PREFIX + "images/" + "a" * 64 + ".png",
    }[source]
    response = _reply(sample)
    response.headers["Content-Length"] = str(len(_DATA))
    response.geturl.return_value = url
    opener = sample.urllib.request.build_opener.return_value

    def open_reserved(request: object, *, timeout: int) -> MagicMock:
        assert timeout == 60
        assert _ledger(sample)["reservedBytes"] == _INITIAL + len(_DATA) + 1
        with pytest.raises(FileExistsError):
            _get(sample)  # Another preparer cannot race this reservation.
        return response

    opener.open.side_effect = open_reserved
    target = sample.CACHE_ROOT / "source"
    metadata = sample.download(url, target, expected_size=len(_DATA), max_bytes=100)
    assert metadata == {"byteSize": len(_DATA), "sha256": _HASH}
    assert target.read_bytes() == _DATA
    assert _ledger(sample) == {
        "schemaVersion": 1,
        "reservedBytes": _INITIAL + len(_DATA),
        "completed": [{"url": url, "path": "source", **metadata}],
    }
    assert response.read.call_args_list[-1].args == (1,)
    opener.open.reset_mock(side_effect=True)
    opener.open.side_effect = AssertionError("Cache must work offline")
    cached = sample.download(url, target, expected_size=len(_DATA), max_bytes=100)
    assert cached == metadata
    opener.open.assert_not_called()
    _clean(sample)


def test_stream_read_bound(sample: ModuleType) -> None:
    data = b"x" * (2 * 65536 + 3)
    response = _reply(sample, data)
    target = sample.CACHE_ROOT / "source"
    metadata = sample.download(
        sample._BEANS_URL, target, expected_size=len(data), max_bytes=len(data)
    )
    assert metadata == sample.file_metadata(target)
    sizes = [call.args[0] for call in response.read.call_args_list]
    assert sizes == [65536, 65536, 4, 1]
    _clean(sample)


def test_bounded_file_index_without_content_length(sample: ModuleType) -> None:
    data = b'{"entries":[]}'
    response = _reply(sample, data)
    response.geturl.return_value = sample._GWHD_INDEX
    destination = sample.CACHE_ROOT / "gwhd-2021/index.json"
    metadata = sample.download(
        sample._GWHD_INDEX, destination, expected_size=None, max_bytes=128
    )
    assert metadata == sample.file_metadata(destination)
    assert _ledger(sample)["reservedBytes"] == _INITIAL + len(data)
    response.read.reset_mock()
    assert (
        sample.download(
            sample._GWHD_INDEX, destination, expected_size=None, max_bytes=128
        )
        == metadata
    )
    response.read.assert_not_called()
    with pytest.raises(ValueError):
        sample.download(
            sample._BEANS_URL,
            sample.CACHE_ROOT / "source",
            expected_size=None,
            max_bytes=128,
        )
    _clean(sample)


@pytest.mark.parametrize("payload", [b"", b"x" * 129], ids=["empty", "overflow"])
def test_unknown_index_size_keeps_its_full_reservation_on_failure(
    sample: ModuleType,
    payload: bytes,
) -> None:
    response = _reply(sample, payload)
    response.geturl.return_value = sample._GWHD_INDEX
    with pytest.raises(ValueError):
        sample.download(
            sample._GWHD_INDEX,
            sample.CACHE_ROOT / "index.json",
            expected_size=None,
            max_bytes=128,
        )
    assert _ledger(sample)["reservedBytes"] == _INITIAL + 129
    assert not (sample.CACHE_ROOT / "index.json").exists()
    _clean(sample)


@pytest.mark.parametrize(
    "data,pin",
    [
        (_DATA[:-1], None),
        (_DATA + b"x", None),
        (_DATA, "0" * 64),
        (b"<html>".ljust(len(_DATA), b" "), None),
        (b"<!DOCTYPE html>".ljust(len(_DATA), b" "), None),
    ],
)
def test_bad_download_retains_charge_and_cleans_temp(
    sample: ModuleType,
    data: bytes,
    pin: str | None,
) -> None:
    response = _reply(sample, data)
    with pytest.raises(ValueError):
        _get(sample, sha256=pin)
    assert _ledger(sample)["reservedBytes"] == _INITIAL + len(_DATA) + 1
    assert _ledger(sample)["completed"] == []
    assert not (sample.CACHE_ROOT / "beans/train.zip").exists()
    sizes = [call.args[0] for call in response.read.call_args_list]
    assert all(0 < size <= len(_DATA) + 1 for size in sizes)
    _clean(sample)


@pytest.mark.parametrize(
    "status,content_type,length",
    [
        (206, "application/octet-stream", None),
        (200, "text/html", None),
        (200, "application/xhtml+xml", None),
        (200, "text/csv", "0"),
        (200, "text/csv", "-1"),
        (200, "text/csv", "true"),
        (200, "text/csv", str(len(_DATA) + 1)),
    ],
)
def test_rejects_wrong_response_before_body(
    sample: ModuleType,
    status: int,
    content_type: str,
    length: str | None,
) -> None:
    response = _reply(sample)
    response.status = status
    response.headers["Content-Type"] = content_type
    if length is not None:
        response.headers["Content-Length"] = length
    with pytest.raises(ValueError):
        _get(sample)
    response.read.assert_not_called()
    _clean(sample)


@pytest.mark.parametrize(
    "location",
    [
        "http://huggingface.co/file",
        "https://unknown.example/file",
        "https://user:secret@huggingface.co/file",
        "https://huggingface.co:444/file",
    ],
)
def test_unsafe_redirect_is_never_requested(sample: ModuleType, location: str) -> None:
    _reply(sample)
    headers = Message()
    headers["Location"] = location
    body = io.BytesIO(b"redirect body must not be read")
    opener = sample.urllib.request.build_opener.return_value
    opener.open.side_effect = urllib.error.HTTPError(
        sample._BEANS_URL, 302, "upstream private-fixture", headers, body
    )
    with pytest.raises(ValueError) as error:
        _get(sample)
    assert "private-fixture" not in "".join(traceback.format_exception(error.value))
    assert opener.open.call_count == 1
    assert body.closed
    _clean(sample)


@pytest.mark.parametrize("hops", [5, 6])
def test_redirect_limit_and_signed_url_redaction(sample: ModuleType, hops: int) -> None:
    response = _reply(sample)
    signed = "https://cas-bridge.xethub.hf.co/object?X-Amz-Signature=private-fixture"
    response.geturl.return_value = signed
    headers = Message()
    headers["Location"] = signed
    opener = sample.urllib.request.build_opener.return_value
    opener.open.side_effect = [
        urllib.error.HTTPError(
            sample._BEANS_URL, 302, "redirect", headers, io.BytesIO()
        )
        for _ in range(hops)
    ] + [response]
    if hops == 5:
        _get(sample)
        assert "private-fixture" not in json.dumps(_ledger(sample))
    else:
        with pytest.raises(ValueError):
            _get(sample)
    assert opener.open.call_count == 6
    _clean(sample)


@pytest.mark.parametrize("code", [301, 302, 303, 307, 308])
def test_real_redirect_handler_redacts_invalid_location(
    sample: ModuleType,
    code: int,
) -> None:
    headers = Message()
    headers["Location"] = "https://[private-fixture]/"
    body = MagicMock(wraps=io.BytesIO(b"redirect body"))
    handler = sample._NoRedirect()
    opener = sample.urllib.request.build_opener.return_value
    opener.open.side_effect = lambda request, **kwargs: getattr(
        handler, f"http_error_{code}"
    )(request, body, code, "redirect", headers)

    with pytest.raises(ValueError) as error:
        _get(sample)

    assert "private-fixture" not in "".join(traceback.format_exception(error.value))
    body.read.assert_not_called()
    body.close.assert_called_once()
    assert opener.open.call_count == 1
    _clean(sample)


def test_network_failure_is_redacted_and_retry_is_charged(sample: ModuleType) -> None:
    response = _reply(sample)
    response.read.side_effect = OSError("https://host/?token=private-fixture")
    with pytest.raises(OSError) as error:
        _get(sample)
    assert "private-fixture" not in "".join(traceback.format_exception(error.value))
    _clean(sample)
    _reply(sample)
    _get(sample)
    assert _ledger(sample)["reservedBytes"] == _INITIAL + 2 * len(_DATA) + 1


def test_cache_without_evidence_and_modified_cache_do_not_refetch(
    sample: ModuleType,
) -> None:
    target = sample.CACHE_ROOT / "beans/train.zip"
    target.parent.mkdir(parents=True)
    target.write_bytes(_DATA)
    with pytest.raises(ValueError):
        _get(sample)
    assert _get(sample, sha256=_HASH.upper())["sha256"] == _HASH
    target.write_bytes(b"x" * len(_DATA))
    with pytest.raises(ValueError):
        _get(sample, sha256=_HASH)
    assert target.read_bytes() == b"x" * len(_DATA)
    sample.urllib.request.build_opener.assert_not_called()
    _clean(sample)


def test_missing_cache_keeps_prior_observation_pin(sample: ModuleType) -> None:
    _reply(sample)
    _get(sample)
    target = sample.CACHE_ROOT / "beans/train.zip"
    target.unlink()
    _reply(sample, b"x" * len(_DATA))
    with pytest.raises(ValueError, match="SHA-256"):
        _get(sample)
    assert not target.exists()
    assert _ledger(sample)["completed"][0]["sha256"] == _HASH
    assert _ledger(sample)["reservedBytes"] == _INITIAL + 2 * len(_DATA) + 1
    _clean(sample)


@pytest.mark.parametrize("fail_at", [1, 2])
def test_ledger_persistence_failure_is_fail_closed(
    sample: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    fail_at: int,
) -> None:
    _reply(sample)
    original = sample.os.replace
    calls = 0

    def replace(source: Path, destination: Path) -> None:
        nonlocal calls
        calls += 1
        if calls == fail_at:
            raise OSError("Ledger persistence interrupted")
        original(source, destination)

    monkeypatch.setattr(sample.os, "replace", replace)
    with pytest.raises(OSError):
        _get(sample)
    target = sample.CACHE_ROOT / "beans/train.zip"
    if fail_at == 1:
        sample.urllib.request.build_opener.assert_not_called()
        assert not target.exists()
        assert not (sample.CACHE_ROOT / "acquisition.json").exists()
    else:
        assert target.read_bytes() == _DATA  # Never remove an already published file.
        assert _ledger(sample)["reservedBytes"] == _INITIAL + len(_DATA) + 1
        assert _ledger(sample)["completed"] == []
    _clean(sample)


def test_budget_cap_survives_failure_and_stale_lock_is_not_removed(
    sample: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sample, "ACQUISITION_LIMIT", _INITIAL + len(_DATA) + 1)
    response = _reply(sample)
    response.read.side_effect = OSError("interrupted")
    with pytest.raises(OSError):
        _get(sample)
    before = (sample.CACHE_ROOT / "acquisition.json").read_bytes()
    with pytest.raises(ValueError, match="budget"):
        _get(sample)
    lock = sample.CACHE_ROOT / ".acquisition.lock"
    lock.write_bytes(b"another preparer")
    with pytest.raises(FileExistsError):
        _get(sample)
    assert lock.read_bytes() == b"another preparer"
    assert (sample.CACHE_ROOT / "acquisition.json").read_bytes() == before
    assert sample.urllib.request.build_opener.return_value.open.call_count == 1


@pytest.mark.parametrize(
    "changes",
    [
        {"schemaVersion": True},
        {"schemaVersion": 2},
        {"reservedBytes": -1},
        {"reservedBytes": True},
        {"reservedBytes": 0},
        {"reservedBytes": 2**63},
        {"completed": {}},
        {"completed": [{}]},
        {"extra": 1},
    ],
)
def test_corrupt_ledger_is_never_reset(
    sample: ModuleType,
    changes: dict[str, Any],
) -> None:
    sample.CACHE_ROOT.mkdir()
    path = sample.CACHE_ROOT / "acquisition.json"
    raw = json.dumps(
        {"schemaVersion": 1, "reservedBytes": _INITIAL, "completed": [], **changes}
    ).encode()
    path.write_bytes(raw)
    with pytest.raises(ValueError):
        _get(sample)
    assert path.read_bytes() == raw
    sample.urllib.request.build_opener.assert_not_called()
    _clean(sample)


@pytest.mark.parametrize(
    "raw",
    [
        b"{bad",
        b"[]",
        b" " * 65537,
        b'{"schemaVersion":1,"reservedBytes":31744,"reservedBytes":31744,"completed":[]}',
    ],
    ids=["invalid-json", "not-object", "oversized", "duplicate-key"],
)
def test_bad_json_duplicate_keys_and_oversized_ledger(
    sample: ModuleType,
    raw: bytes,
) -> None:
    sample.CACHE_ROOT.mkdir()
    path = sample.CACHE_ROOT / "acquisition.json"
    path.write_bytes(raw)
    with pytest.raises(ValueError):
        _get(sample)
    assert path.read_bytes() == raw
    _clean(sample)
