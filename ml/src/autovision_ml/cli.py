"""Command-line entry point for the AutoVision Studio ML worker."""

from __future__ import annotations

import argparse
import json
import platform
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import cast

from autovision_ml import __version__


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="autovision-ml")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "health", help="Report application version and operating system."
    )
    probe = commands.add_parser("probe-hardware", help="Observe Windows hardware.")
    probe.add_argument("--disk-path", type=Path, required=True)
    scan = commands.add_parser(
        "scan-dataset", help="Scan local image inputs.", add_help=False
    )
    scan.add_argument("--request", type=Path, required=True)
    return parser


def _run_health() -> int:
    payload = {"version": __version__, "os": platform.system()}
    print(json.dumps(payload, separators=(",", ":")))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Run the requested worker command."""
    supplied = list(sys.argv[1:] if argv is None else argv)
    # Main's fixed argv shape only; malformed scan input must never echo paths.
    if supplied[:1] == ["scan-dataset"] and (
        len(supplied) != 3
        or supplied[1] != "--request"
        or not supplied[2]
        or supplied[2].startswith("-")
    ):
        print("INVALID_REQUEST", file=sys.stderr)
        return 2
    parser = _build_parser()
    arguments = parser.parse_args(supplied)

    if arguments.command == "health":
        return _run_health()

    if arguments.command == "scan-dataset":
        from autovision_ml.commands.scan_dataset import run_scan_dataset

        return run_scan_dataset(cast(Path, arguments.request))

    if arguments.command == "probe-hardware":
        from autovision_ml.commands.probe_hardware import probe_hardware

        payload = probe_hardware(disk_path=cast(Path, arguments.disk_path))
        print(json.dumps(payload, ensure_ascii=True, separators=(",", ":")))
        disk = cast(dict[str, object], payload["disk"])
        error = cast(dict[str, object] | None, disk["error"])
        if error is not None and error["code"] == "invalid-disk-path":
            return 2
        return 0 if payload["status"] == "ok" else 1

    parser.error(f"unsupported command: {arguments.command}")


if __name__ == "__main__":
    raise SystemExit(main())
