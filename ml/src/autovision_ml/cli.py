"""Command-line entry point for the AutoVision Studio ML worker."""

from __future__ import annotations

import argparse
import json
import platform
from collections.abc import Sequence

from autovision_ml import __version__


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="autovision-ml")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "health", help="Report application version and operating system."
    )
    return parser


def _run_health() -> int:
    payload = {"version": __version__, "os": platform.system()}
    print(json.dumps(payload, separators=(",", ":")))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Run the requested worker command."""
    parser = _build_parser()
    arguments = parser.parse_args(argv)

    if arguments.command == "health":
        return _run_health()

    parser.error(f"unsupported command: {arguments.command}")


if __name__ == "__main__":
    raise SystemExit(main())
