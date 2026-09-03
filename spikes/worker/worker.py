"""SPI-02 Python worker for JSON input and NDJSON lifecycle probing."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, NoReturn, cast

SCHEMA_VERSION = 1


def emit(event: dict[str, object]) -> None:
    print(json.dumps(event, separators=(",", ":")), flush=True)


def fail(message: str) -> NoReturn:
    print(f"SPI-02 worker failed: {message}", file=sys.stderr, flush=True)
    raise SystemExit(2)


def read_object(source: str, label: str) -> dict[str, Any]:
    try:
        value = json.loads(source)
    except json.JSONDecodeError as error:
        fail(f"{label} is not valid JSON: {error.msg}")

    if not isinstance(value, dict):
        fail(f"{label} must be a JSON object")
    return cast(dict[str, Any], value)


def require_string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        fail(f"{label} must be a non-empty string")
    return value


def run(input_path: Path) -> int:
    try:
        payload = read_object(input_path.read_text(encoding="utf-8"), "input")
    except OSError as error:
        fail(f"input cannot be read: {error.strerror or error.__class__.__name__}")

    if payload.get("schemaVersion") != SCHEMA_VERSION:
        fail("unsupported input schemaVersion")

    job_id = require_string(payload.get("jobId"), "input jobId")
    mode = payload.get("mode")
    if mode not in {"complete", "await-cancel"}:
        fail("input mode must be complete or await-cancel")

    emit({"schemaVersion": SCHEMA_VERSION, "type": "started", "jobId": job_id})
    emit(
        {
            "schemaVersion": SCHEMA_VERSION,
            "type": "progress",
            "jobId": job_id,
            "completed": 1,
            "total": 2,
        }
    )

    if mode == "complete":
        print("SPI-02 diagnostic channel", file=sys.stderr, flush=True)
        emit(
            {
                "schemaVersion": SCHEMA_VERSION,
                "type": "progress",
                "jobId": job_id,
                "completed": 2,
                "total": 2,
            }
        )
        emit({"schemaVersion": SCHEMA_VERSION, "type": "completed", "jobId": job_id})
        return 0

    control_line = sys.stdin.readline()
    if not control_line:
        fail("cancel control was not received")
    control = read_object(control_line, "control")
    if (
        control.get("schemaVersion") != SCHEMA_VERSION
        or control.get("type") != "cancel"
        or control.get("jobId") != job_id
    ):
        fail("cancel control does not match the active job")

    emit(
        {
            "schemaVersion": SCHEMA_VERSION,
            "type": "warning",
            "jobId": job_id,
            "code": "CANCELLED",
        }
    )
    return 0


def main() -> int:
    if len(sys.argv) != 2:
        fail("exactly one input JSON path is required")
    return run(Path(sys.argv[1]))


if __name__ == "__main__":
    raise SystemExit(main())
