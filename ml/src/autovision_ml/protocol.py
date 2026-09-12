"""JOB-03: plan §3.3/§7; ADR-0001 §2.4–2.6.

Envelope foundation for FR-TRN-001/002 and 010–014, not a job runtime.
Fixed 64 KiB UTF-8 message limit (including LF/CRLF), nesting at most 64.
No I/O or dispatch: callers write encoded events to stdout and safe diagnostics
to stderr. DAT-01/AST-04/TRN-14 own command payload validation. JOB-04/05 own
sequence, exit/cancel and artifact containment/hash checks before any commit.
SPI-02 short IDs, mode and completed counter are deliberately not compatible.
"""

from __future__ import annotations

import json
import math
import re
from typing import Literal, Never, TypedDict, cast

WORKER_SCHEMA_VERSION = 1
MAX_WORKER_MESSAGE_BYTES = 65_536
_MAX_JSON_DEPTH = 64
_MAX_SAFE_INTEGER = 9_007_199_254_740_991
_INVALID_MESSAGE = "Invalid worker protocol message"
_UUID = re.compile(
    r"(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-"
    r"[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|"
    r"ffffffff-ffff-ffff-ffff-ffffffffffff)",
    re.IGNORECASE | re.ASCII,
)
_CODE = re.compile(r"[A-Z][A-Z0-9_]{0,63}")

type JsonValue = None | bool | int | float | str | list[JsonValue] | JsonObject
type JsonObject = dict[str, JsonValue]
type WorkerKind = Literal["scan-dataset", "assist", "train"]


class WorkerCorrelation(TypedDict):
    jobId: str
    projectId: str


class _Header(WorkerCorrelation):
    schemaVersion: Literal[1]


class WorkerRequest(_Header):
    kind: WorkerKind
    payload: JsonObject


class StartedEvent(_Header):
    type: Literal["started"]


class ProgressEvent(_Header):
    type: Literal["progress"]
    source: Literal["actual"]
    processed: int
    total: int | None


class WarningEvent(_Header):
    type: Literal["warning"]
    code: str


class CompletedEvent(_Header):
    type: Literal["completed"]
    resultManifest: str


class FailedEvent(_Header):
    type: Literal["failed"]
    code: str


class WorkerCancel(_Header):
    type: Literal["cancel"]


type WorkerEvent = (
    StartedEvent | ProgressEvent | WarningEvent | CompletedEvent | FailedEvent
)


def _invalid() -> Never:
    # External JSON type errors are protocol ValueErrors, not programmer errors.
    raise ValueError(_INVALID_MESSAGE)


def _valid_json(value: object, depth: int = 0) -> bool:
    if depth > _MAX_JSON_DEPTH:
        return False
    if value is None or type(value) is bool:
        return True
    if isinstance(value, str):
        return not any(0xD800 <= ord(char) <= 0xDFFF for char in value)
    if type(value) is int:
        return abs(value) <= _MAX_SAFE_INTEGER
    if type(value) is float:
        return math.isfinite(value) and abs(value) <= _MAX_SAFE_INTEGER
    if isinstance(value, list):
        items = cast(list[object], value)
        return all(_valid_json(item, depth + 1) for item in items)
    if isinstance(value, dict):
        mapping = cast(dict[object, object], value)
        return all(
            isinstance(key, str) and _valid_json(key) and _valid_json(item, depth + 1)
            for key, item in mapping.items()
        )
    return False


def _object(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        _invalid()
    if not _valid_json(cast(dict[object, object], value)):
        _invalid()
    return cast(dict[str, object], value)


def _pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            _invalid()
        result[key] = value
    return result


def _constant(_value: str) -> Never:
    _invalid()


def _text(source: object) -> str:
    if not isinstance(source, (str, bytes)):
        _invalid()
    if len(source) > MAX_WORKER_MESSAGE_BYTES:
        _invalid()
    text = (
        source.decode("utf-8", errors="strict") if isinstance(source, bytes) else source
    )
    if len(text.encode("utf-8", errors="strict")) > MAX_WORKER_MESSAGE_BYTES:
        _invalid()
    return text


def _decode(source: str | bytes, *, line: bool) -> dict[str, object]:
    text = _text(source)
    if line:
        body = text[:-2] if text.endswith("\r\n") else text[:-1]
        if not text.endswith("\n") or "\n" in body or "\r" in body:
            _invalid()
    depth = 0
    for match in re.finditer(r'"(?:[^"\\]|\\[\s\S])*"|[{}\[\]]', text):
        token = match[0]
        if token in ("{", "["):
            depth += 1
            if depth > _MAX_JSON_DEPTH:
                _invalid()
        elif token in ("}", "]"):
            depth -= 1
    value: object = json.loads(text, object_pairs_hook=_pairs, parse_constant=_constant)
    return _object(value)


def _id(value: object) -> str:
    if not isinstance(value, str) or _UUID.fullmatch(value) is None:
        _invalid()
    return value.lower()


def _integer(value: object) -> int:
    # JSON has one number type, as in JS: 1.0 / 1e0 mean integer 1.
    # Booleans are never numbers; unsafe integers cannot round across languages.
    if type(value) not in (int, float):
        _invalid()
    number = cast(int | float, value)
    if not _valid_json(number) or number < 0 or int(number) != number:
        _invalid()
    return int(number)


def _header(value: dict[str, object], fields: set[str]) -> _Header:
    if set(value) != {"schemaVersion", "jobId", "projectId"} | fields:
        _invalid()
    if _integer(value["schemaVersion"]) != WORKER_SCHEMA_VERSION:
        _invalid()
    return {
        "schemaVersion": 1,
        "jobId": _id(value["jobId"]),
        "projectId": _id(value["projectId"]),
    }


def _request(value: dict[str, object]) -> WorkerRequest:
    header = _header(value, {"kind", "payload"})
    # Assign validated literals explicitly: both Pyright and mypy preserve
    # WorkerKind here, without trusting a cast of external JSON.
    supplied_kind = value["kind"]
    kind: WorkerKind
    if supplied_kind == "scan-dataset":
        kind = "scan-dataset"
    elif supplied_kind == "assist":
        kind = "assist"
    elif supplied_kind == "train":
        kind = "train"
    else:
        _invalid()
    payload = _object(value["payload"])
    return {
        **header,
        "kind": kind,
        "payload": cast(JsonObject, payload),
    }


def _event(value: dict[str, object]) -> WorkerEvent:
    event_type = value.get("type")
    if event_type == "started":
        return {**_header(value, {"type"}), "type": "started"}
    if event_type == "progress":
        header = _header(value, {"type", "source", "processed", "total"})
        if value["source"] != "actual":
            _invalid()
        processed = _integer(value["processed"])
        total = None if value["total"] is None else _integer(value["total"])
        # 0 is a known empty workload; only null means unknown. No fake ETA/%.
        if total is not None and processed > total:
            _invalid()
        return {
            **header,
            "type": "progress",
            "source": "actual",
            "processed": processed,
            "total": total,
        }
    if event_type in ("warning", "failed"):
        header = _header(value, {"type", "code"})
        code = value["code"]
        if not isinstance(code, str) or _CODE.fullmatch(code) is None:
            _invalid()
        if event_type == "warning":
            return {**header, "type": "warning", "code": code}
        return {**header, "type": "failed", "code": code}
    if event_type == "completed":
        header = _header(value, {"type", "resultManifest"})
        manifest = value["resultManifest"]
        if not isinstance(manifest, str) or not manifest:
            _invalid()
        # Untrusted locator, not an authorization or successful DB commit.
        return {**header, "type": "completed", "resultManifest": manifest}
    _invalid()


def _cancel(value: dict[str, object]) -> WorkerCancel:
    header = _header(value, {"type"})
    if value["type"] != "cancel":
        _invalid()
    return {**header, "type": "cancel"}


def _correlate(value: _Header, expected: WorkerCorrelation) -> None:
    if (
        set(expected) != {"jobId", "projectId"}
        or value["jobId"] != _id(expected["jobId"])
        or value["projectId"] != _id(expected["projectId"])
    ):
        _invalid()


def _encode(value: object, *, line: bool) -> str:
    text = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    text += "\n" if line else ""
    _decode(text, line=line)
    return text


def parse_worker_request(source: str | bytes) -> WorkerRequest:
    """Parse file contents only; no filesystem access or command dispatch."""
    try:
        return _request(_decode(source, line=False))
    except (ValueError, TypeError, RecursionError):
        raise ValueError(_INVALID_MESSAGE) from None


def encode_worker_request(value: object) -> str:
    """Encode validated request JSON, without an NDJSON terminator."""
    try:
        return _encode(_request(_object(value)), line=False)
    except (ValueError, TypeError, RecursionError):
        raise ValueError(_INVALID_MESSAGE) from None


def parse_worker_event_line(
    source: str | bytes, expected: WorkerCorrelation
) -> WorkerEvent:
    """Parse one terminated line and check both active correlation IDs."""
    try:
        event = _event(_decode(source, line=True))
        _correlate(event, expected)
        return event
    except (ValueError, TypeError, KeyError, RecursionError):
        raise ValueError(_INVALID_MESSAGE) from None


def encode_worker_event(value: object) -> str:
    """Return one Unicode JSON line ending in LF; never print diagnostics."""
    try:
        return _encode(_event(_object(value)), line=True)
    except (ValueError, TypeError, RecursionError):
        raise ValueError(_INVALID_MESSAGE) from None


def parse_worker_cancel_line(
    source: str | bytes, expected: WorkerCorrelation
) -> WorkerCancel:
    """Parse input control only; this does not cancel or acknowledge a job."""
    try:
        control = _cancel(_decode(source, line=True))
        _correlate(control, expected)
        return control
    except (ValueError, TypeError, KeyError, RecursionError):
        raise ValueError(_INVALID_MESSAGE) from None


def encode_worker_cancel(value: object) -> str:
    """Encode cancel control for stdin, not a stdout event."""
    try:
        return _encode(_cancel(_object(value)), line=True)
    except (ValueError, TypeError, RecursionError):
        raise ValueError(_INVALID_MESSAGE) from None
