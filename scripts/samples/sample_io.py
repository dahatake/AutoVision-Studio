"""Developer-only raw-byte I/O for prepare_beans.py and prepare_gwhd.py.

Callers validate formats, rights and the combined 96 MiB published-asset limit.
Paths are developer-controlled; hostile concurrent directory mutation is outside
this helper's scope. No decoder, runtime integration, CLI or automatic acquisition.
An unpinned SHA-256 is a first observation, not publisher verification.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import ntpath
import os
import re
import ssl
import stat
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

__all__ = ["download", "file_metadata", "write_new"]

CACHE_ROOT = Path(__file__).resolve().parents[2] / "vendor" / "samples"
ACQUISITION_LIMIT = 256 * 1024 * 1024
# Already fetched LIC-S01/S02 source bytes, not an estimated allowance:
# resources/samples/beans/LICENSE.txt: 1084;
# docs/sample-data/evidence/beans-readme.txt: 2024;
# resources/samples/gwhd-2021/LICENSE.txt: 18657;
# docs/sample-data/evidence/gwhd-record.json: 9979.
_INITIAL_RESERVED_BYTES = 31744
_CHUNK = 64 * 1024
_BEANS_URL = (
    "https://huggingface.co/datasets/AI-Lab-Makerere/beans/resolve/"
    "27aa014ce09b193e1a6f58112d4a66e0eddb69c5/data/train.zip"
)
_GWHD_PREFIX = (
    "https://zenodo.org/api/records/5092309/files/gwhd_2021.zip/container/gwhd_2021/"
)
_GWHD_INDEX = "https://zenodo.org/api/records/5092309/files/gwhd_2021.zip/container"
_HOSTS = {
    "huggingface.co",
    "cas-bridge.xethub.hf.co",
    "cdn-lfs.huggingface.co",
    "cdn-lfs-us-1.hf.co",
    "us.aws.cdn.hf.co",
    "zenodo.org",
}


def _url(url: str, *, original: bool = False, base: str = "") -> str:
    if not isinstance(url, str) or any(ord(c) <= 32 or ord(c) == 127 for c in url):
        raise ValueError("Unsafe sample URL") from None
    if "\\" in url:
        raise ValueError("Unsafe sample URL") from None
    try:
        target = urllib.parse.urljoin(base, url) if base else url
        parsed = urllib.parse.urlsplit(target)
        valid = (
            parsed.scheme == "https"
            and parsed.hostname in _HOSTS
            and parsed.port in (None, 443)
            and parsed.username is None
            and parsed.password is None
            and not parsed.fragment
        )
    except ValueError:
        raise ValueError("Unsafe sample URL") from None
    if not valid or (
        original
        and target != _BEANS_URL
        and target != _GWHD_INDEX
        and not re.fullmatch(
            re.escape(_GWHD_PREFIX)
            + r"(?:competition_train\.csv|images/[0-9a-f]{64}\.png)",
            target,
        )
    ):
        raise ValueError("Unapproved sample URL") from None
    return target


def _regular(path: Path) -> os.stat_result | None:
    path = path.absolute()  # Do not resolve away links before checking them.
    if ".." in path.parts or ntpath.isreserved(str(path)):
        raise ValueError("Unsafe sample path")
    result = None
    for node in (*reversed(path.parents), path):
        try:
            info = node.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or (
            getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
        ):
            raise ValueError("Sample links and junctions are forbidden")
        if node == path:
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError("Sample must be a single-link regular file")
            result = info
        elif not stat.S_ISDIR(info.st_mode):
            raise ValueError("Sample ancestor must be a directory")
    return result


def _cache_path(path: Path) -> Path:
    path = path.absolute()
    relative = path.relative_to(CACHE_ROOT.absolute())
    if not relative.parts or relative.parts[0].casefold() in {
        "acquisition.json",
        ".acquisition.lock",
    }:
        raise ValueError("Reserved cache path")
    _regular(path)
    return path


def _publish(temporary: Path, destination: Path) -> None:
    _regular(destination)
    os.rename(temporary, destination)  # Windows rename never replaces a file.


def file_metadata(path: Path) -> dict[str, int | str]:
    """Stream the raw bytes; reject nonregular files, hardlinks and linked ancestry."""
    info = _regular(path)
    if info is None:
        raise FileNotFoundError("Sample file is missing")
    digest, size = hashlib.sha256(), 0
    with path.open("rb") as source:
        opened = os.fstat(source.fileno())
        if opened.st_nlink != 1 or not os.path.samestat(info, opened):
            raise ValueError("Sample changed before reading")
        while block := source.read(_CHUNK):
            size += len(block)
            digest.update(block)
    return {"byteSize": size, "sha256": digest.hexdigest()}


def write_new(path: Path, data: bytes) -> None:
    """Publish asset/JSON bytes without replacement; identical regular bytes are OK."""
    if not isinstance(data, bytes):
        raise TypeError("Sample data must be bytes")
    info = _regular(path)
    if info is not None:
        if info.st_size == len(data) and path.read_bytes() == data:
            return
        raise FileExistsError("Existing sample bytes differ")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix=f".{path.name}.", suffix=".part", delete=False
        ) as output:
            temporary = Path(output.name)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        _publish(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _save_ledger(path: Path, ledger: dict[str, Any]) -> None:
    _regular(path)
    payload = json.dumps(ledger, sort_keys=True, indent=2).encode("utf-8") + b"\n"
    if len(payload) > _CHUNK:
        raise ValueError("Acquisition ledger is too large")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix=".acquisition.", suffix=".part", delete=False
        ) as output:
            temporary = Path(output.name)
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        _regular(path)
        os.replace(temporary, path)  # Only the locked ledger may be replaced.
        if os.name != "nt":
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _load_ledger(path: Path) -> dict[str, Any]:
    def unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value = dict(pairs)
        if len(value) != len(pairs):
            raise ValueError("Duplicate acquisition ledger key")
        return value

    info = _regular(path)
    if info is None:
        return {
            "schemaVersion": 1,
            "reservedBytes": _INITIAL_RESERVED_BYTES,
            "completed": [],
        }
    if info.st_size > _CHUNK:
        raise ValueError("Acquisition ledger is too large")
    try:
        ledger = json.loads(path.read_bytes(), object_pairs_hook=unique)
    except (ValueError, RecursionError):
        raise ValueError("Invalid acquisition ledger JSON") from None
    if (
        not isinstance(ledger, dict)
        or set(ledger) != {"schemaVersion", "reservedBytes", "completed"}
        or type(ledger["schemaVersion"]) is not int
        or ledger["schemaVersion"] != 1
        or type(ledger["reservedBytes"]) is not int
        or not 0 <= ledger["reservedBytes"] <= ACQUISITION_LIMIT
        or not isinstance(ledger["completed"], list)
    ):
        raise ValueError("Invalid acquisition ledger schema")
    accounted = _INITIAL_RESERVED_BYTES
    seen: set[str] = set()
    for entry in ledger["completed"]:
        if (
            not isinstance(entry, dict)
            or set(entry) != {"url", "path", "byteSize", "sha256"}
            or not isinstance(entry["url"], str)
            or not isinstance(entry["path"], str)
            or type(entry["byteSize"]) is not int
            or entry["byteSize"] <= 0
            or not isinstance(entry["sha256"], str)
            or not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"])
        ):
            raise ValueError("Invalid completed acquisition")
        _url(entry["url"], original=True)
        relative = (
            _cache_path(CACHE_ROOT / entry["path"])
            .relative_to(CACHE_ROOT.absolute())
            .as_posix()
        )
        if relative != entry["path"] or relative.casefold() in seen:
            raise ValueError("Invalid or duplicate completed path")
        seen.add(relative.casefold())
        accounted += entry["byteSize"]
    if accounted > ledger["reservedBytes"]:
        raise ValueError("Acquisition ledger undercounts source bytes")
    return ledger


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def http_error_302(
        self,
        req: urllib.request.Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
    ) -> None:
        # Bypass urllib's Location parsing too: its ValueError can expose a URL.
        raise urllib.error.HTTPError(req.full_url, code, msg, headers, fp)

    http_error_301 = http_error_302
    http_error_303 = http_error_302
    http_error_307 = http_error_302
    http_error_308 = http_error_302


def download(
    url: str,
    destination: Path,
    *,
    expected_size: int | None,
    max_bytes: int,
    sha256: str | None = None,
) -> dict[str, int | str]:
    """Acquire fixed sources; only the file index permits an unknown size."""
    _url(url, original=True)
    if (
        type(max_bytes) is not int
        or not 0 < max_bytes < ACQUISITION_LIMIT
        or (expected_size is None and url != _GWHD_INDEX)
        or (
            expected_size is not None
            and (type(expected_size) is not int or not 0 < expected_size <= max_bytes)
        )
        or (
            sha256 is not None
            and (
                not isinstance(sha256, str)
                or not re.fullmatch(r"[0-9a-fA-F]{64}", sha256)
            )
        )
    ):
        raise ValueError("Invalid sample size, limit or SHA-256 pin")
    byte_limit = max_bytes if expected_size is None else expected_size
    sha256 = sha256.lower() if sha256 is not None else None
    destination = _cache_path(destination)
    relative = destination.relative_to(CACHE_ROOT.absolute()).as_posix()
    ledger_path = CACHE_ROOT / "acquisition.json"
    lock_path = CACHE_ROOT / ".acquisition.lock"
    _regular(ledger_path)
    _regular(lock_path)
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    lock = lock_path.open("xb")  # An existing/stale lock stops; never clear it.
    temporary = None
    try:
        ledger = _load_ledger(ledger_path)
        record = next(
            (
                item
                for item in ledger["completed"]
                if item["path"].casefold() == relative.casefold()
            ),
            None,
        )
        if record is not None:
            if (
                record["url"] != url
                or record["byteSize"] > max_bytes
                or (expected_size is not None and record["byteSize"] != expected_size)
                or (sha256 is not None and record["sha256"] != sha256)
            ):
                raise ValueError("Cache provenance or pin differs")
            # A previous first observation also pins any explicit reacquisition.
            sha256 = record["sha256"]
        if _regular(destination) is not None:
            metadata = file_metadata(destination)
            if (
                not 0 < metadata["byteSize"] <= max_bytes
                or (expected_size is not None and metadata["byteSize"] != expected_size)
                or metadata["sha256"] != sha256
            ):
                raise ValueError("Existing cache has no matching size/hash evidence")
            if record is None:
                # Explicitly pinned, pre-existing cache: conservatively account for it.
                ledger["reservedBytes"] += metadata["byteSize"]
                if ledger["reservedBytes"] > ACQUISITION_LIMIT:
                    raise ValueError("Acquisition budget exceeded")
                ledger["completed"].append({"url": url, "path": relative, **metadata})
                _save_ledger(ledger_path, ledger)
            return metadata

        reservation = byte_limit + 1  # Includes the one-byte overflow probe.
        if ledger["reservedBytes"] + reservation > ACQUISITION_LIMIT:
            raise ValueError("Acquisition budget exceeded")
        ledger["reservedBytes"] += reservation
        _save_ledger(ledger_path, ledger)  # Durable charge BEFORE opening the network.
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            opener = urllib.request.build_opener(
                urllib.request.HTTPSHandler(context=ssl.create_default_context()),
                _NoRedirect(),
            )
            current, response = url, None
            for hop in range(6):
                try:
                    request = urllib.request.Request(
                        current, headers={"Accept-Encoding": "identity"}
                    )
                    response = opener.open(request, timeout=60)
                except urllib.error.HTTPError as error:
                    try:
                        if error.code not in {301, 302, 303, 307, 308}:
                            raise ValueError("Expected HTTP 200") from None
                        location = error.headers.get("Location")
                    finally:
                        error.close()
                    if not location or hop == 5:
                        raise ValueError("Missing location or too many hops") from None
                    current = _url(location, base=current)
                else:
                    break
            if response is None:
                raise ValueError("No sample response")
            with response:
                _url(response.geturl())
                lengths = response.headers.get_all("Content-Length", [])
                encoding = response.headers.get("Content-Encoding", "identity")
                if (
                    response.status != 200
                    or response.headers.get_content_type()
                    in {
                        "text/html",
                        "application/xhtml+xml",
                    }
                    or encoding.strip().lower() != "identity"
                    or (
                        lengths
                        and (
                            len(lengths) != 1
                            or not re.fullmatch(r"[0-9]+", lengths[0].strip())
                            or not 0 < int(lengths[0]) <= byte_limit
                            or (
                                expected_size is not None
                                and int(lengths[0]) != expected_size
                            )
                        )
                    )
                ):
                    raise ValueError("Unexpected sample status, type or Content-Length")
                digest, size = hashlib.sha256(), 0
                with tempfile.NamedTemporaryFile(
                    dir=destination.parent,
                    prefix=f".{destination.name}.",
                    suffix=".part",
                    delete=False,
                ) as output:
                    temporary = Path(output.name)
                    while block := response.read(min(_CHUNK, byte_limit - size + 1)):
                        size += len(block)
                        if size > byte_limit:
                            raise ValueError("Sample exceeds pinned size")
                        if size == len(block) and block.lstrip().lower().startswith(
                            (b"<!doctype html", b"<html")
                        ):
                            raise ValueError("HTML is not a sample payload")
                        digest.update(block)
                        output.write(block)
                    metadata = {"byteSize": size, "sha256": digest.hexdigest()}
                    if (
                        size == 0
                        or (expected_size is not None and size != expected_size)
                        or (lengths and size != int(lengths[0]))
                        or (sha256 is not None and metadata["sha256"] != sha256)
                    ):
                        raise ValueError("Sample size or SHA-256 mismatch")
                    output.flush()
                    os.fsync(output.fileno())
            _publish(temporary, destination)
        except (OSError, http.client.HTTPException):
            # Upstream exceptions may contain signed URLs/credentials; never echo them.
            raise OSError("HTTPS sample acquisition failed") from None
        ledger["reservedBytes"] -= reservation - size  # Refund only after success.
        ledger["completed"] = [
            item for item in ledger["completed"] if item is not record
        ]
        ledger["completed"].append({"url": url, "path": relative, **metadata})
        _save_ledger(ledger_path, ledger)
        return metadata
    finally:
        lock.close()
        try:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        finally:
            lock_path.unlink()
