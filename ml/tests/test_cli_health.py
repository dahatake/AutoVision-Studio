from __future__ import annotations

import json
import platform
import subprocess
import sys
import tomllib
from pathlib import Path

from autovision_ml import __version__


def _run_cli(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "autovision_ml.cli", *arguments],
        capture_output=True,
        check=False,
        text=True,
        timeout=10,
    )


def _assert_argparse_failure(result: subprocess.CompletedProcess[str]) -> None:
    assert result.returncode == 2
    assert result.stdout == ""
    assert "usage: autovision-ml" in result.stderr
    assert "error:" in result.stderr


def test_health_outputs_one_json_line_with_actual_os() -> None:
    result = _run_cli("health")

    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    lines = result.stdout.splitlines()
    assert len(lines) == 1
    assert result.stdout == f"{lines[0]}\n"
    assert json.loads(lines[0]) == {
        "version": __version__,
        "os": platform.system(),
    }


def test_package_version_matches_project_metadata() -> None:
    project_file = Path(__file__).resolve().parents[1] / "pyproject.toml"

    with project_file.open("rb") as file:
        project = tomllib.load(file)

    assert project["project"]["version"] == __version__


def test_unknown_command_is_rejected_by_argparse() -> None:
    result = _run_cli("unknown")

    _assert_argparse_failure(result)
    assert "invalid choice" in result.stderr


def test_missing_command_is_rejected_by_argparse() -> None:
    result = _run_cli()

    _assert_argparse_failure(result)
    assert "required" in result.stderr
