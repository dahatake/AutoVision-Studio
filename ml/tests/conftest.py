"""Keep pytest anchored to the ML project's configuration."""

from pathlib import Path

import pytest

_PROJECT_ROOT = Path(__file__).resolve().parents[1]


def pytest_configure(config: pytest.Config) -> None:
    expected_config = _PROJECT_ROOT / "pyproject.toml"
    if config.rootpath != _PROJECT_ROOT or config.inipath != expected_config:
        raise pytest.UsageError(
            "pytest must use ml/pyproject.toml as its configuration file"
        )
