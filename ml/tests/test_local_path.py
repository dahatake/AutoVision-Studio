"""RV-LOCAL drive-query boundary tests; not network-packet or TOCTOU evidence."""

from __future__ import annotations

import builtins
import ctypes
import importlib
import os
from collections.abc import Callable, Generator
from contextlib import ExitStack, contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

import pytest

from autovision_ml.data import local_path

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows local-drive boundary")


@pytest.fixture
def drive_api(monkeypatch: pytest.MonkeyPatch) -> tuple[Mock, Mock]:
    query = Mock(return_value=3)
    loader = Mock(return_value=SimpleNamespace(GetDriveTypeW=query))
    monkeypatch.setattr(ctypes, "WinDLL", loader, raising=False)
    return loader, query


@contextmanager
def _no_filesystem() -> Generator[None]:
    blocked = Mock(side_effect=AssertionError("filesystem access is forbidden"))
    with ExitStack() as stack:
        for target, names in (
            (Path, ("stat", "lstat", "exists", "resolve", "open")),
            (os, ("stat", "lstat", "open", "scandir")),
            (builtins, ("open",)),
        ):
            for name in names:
                stack.enter_context(patch.object(target, name, blocked))
        yield
    blocked.assert_not_called()


@pytest.mark.parametrize(
    "kind", [2, 3, 5, 6], ids=["removable", "fixed", "cdrom", "ramdisk"]
)
def test_local_types_use_typed_root_query_without_filesystem(
    drive_api: tuple[Mock, Mock], kind: int
) -> None:
    loader, query = drive_api
    path = Path("c:/private/not-created/image.png")
    require: Callable[[Path], object] = local_path.require_local_path

    def get_drive_type(root: str) -> int:
        assert root == "c:\\"
        assert query.argtypes == [ctypes.c_wchar_p]
        assert query.restype is ctypes.c_uint32
        return kind

    query.side_effect = get_drive_type
    with _no_filesystem():
        assert require(path) is None
    loader.assert_called_once_with("kernel32", winmode=0x800, use_last_error=True)
    query.assert_called_once_with("c:\\")


@pytest.mark.parametrize("kind", [0, 1, 4], ids=["unknown", "missing", "remote"])
def test_nonlocal_drive_types_reject_before_filesystem(
    drive_api: tuple[Mock, Mock], kind: int
) -> None:
    loader, query = drive_api
    query.return_value = kind
    with _no_filesystem(), pytest.raises(ValueError, match="^LOCAL_PATH_REQUIRED$"):
        local_path.require_local_path(Path("Z:/private/not-created"))
    loader.assert_called_once_with("kernel32", winmode=0x800, use_last_error=True)
    query.assert_called_once_with("Z:\\")


def test_unc_variants_never_load_dll_or_touch_filesystem(
    drive_api: tuple[Mock, Mock],
) -> None:
    loader, query = drive_api
    for text in (
        r"\\fixture-host.invalid\share\private",
        "//fixture-host.invalid/share/private",
        r"\\?\UNC\fixture-host.invalid\share\private",
        "//?/UNC/fixture-host.invalid/share/private",
        r"\\.\UNC\fixture-host.invalid\share\private",
    ):
        with _no_filesystem(), pytest.raises(ValueError, match="^LOCAL_PATH_REQUIRED$"):
            local_path.require_local_path(Path(text))
    loader.assert_not_called()
    query.assert_not_called()


@pytest.mark.parametrize(
    "text",
    [
        pytest.param(r"\\?\C:\private", id="extended-drive"),
        pytest.param(r"\\.\C:\private", id="device-drive"),
        pytest.param(r"C:private", id="drive-relative"),
        pytest.param("\u212a:\\private", id="non-ascii-drive"),
        pytest.param(r"C:\safe\..\private", id="parent-segment"),
        pytest.param("file:///C:/private", id="file-url"),
        pytest.param("C:/private\0", id="nul"),
    ],
)
def test_invalid_paths_never_load_dll_or_touch_filesystem(
    drive_api: tuple[Mock, Mock], text: str
) -> None:
    loader, query = drive_api
    with _no_filesystem(), pytest.raises(ValueError, match="^LOCAL_PATH_REQUIRED$"):
        local_path.require_local_path(Path(text))
    loader.assert_not_called()
    query.assert_not_called()


def test_non_windows_rejects_before_loading_dll(
    drive_api: tuple[Mock, Mock], monkeypatch: pytest.MonkeyPatch
) -> None:
    loader, query = drive_api
    path = Path("C:/private")
    monkeypatch.setattr(local_path, "os", SimpleNamespace(name="posix"))
    with _no_filesystem(), pytest.raises(ValueError, match="^LOCAL_PATH_REQUIRED$"):
        local_path.require_local_path(path)
    loader.assert_not_called()
    query.assert_not_called()


def test_drive_locality_is_not_cached_between_calls(
    drive_api: tuple[Mock, Mock],
) -> None:
    loader, query = drive_api
    query.side_effect = [3, 4]
    path = Path("Z:/private")
    require: Callable[[Path], object] = local_path.require_local_path
    with _no_filesystem():
        assert require(path) is None
        with pytest.raises(ValueError, match="^LOCAL_PATH_REQUIRED$"):
            local_path.require_local_path(path)
    assert loader.call_count == 2
    assert query.call_args_list == [call("Z:\\"), call("Z:\\")]


def test_api_permission_error_propagates_as_oserror(
    drive_api: tuple[Mock, Mock],
) -> None:
    loader, query = drive_api
    failure = PermissionError(5, "access denied")
    query.side_effect = failure
    with _no_filesystem(), pytest.raises(OSError) as raised:
        local_path.require_local_path(Path("Z:/private"))
    assert raised.value is failure
    loader.assert_called_once_with("kernel32", winmode=0x800, use_last_error=True)
    query.assert_called_once_with("Z:\\")


def test_import_does_not_load_windows_dll(drive_api: tuple[Mock, Mock]) -> None:
    loader, query = drive_api
    importlib.reload(local_path)
    loader.assert_not_called()
    query.assert_not_called()


def test_native_windows_temp_and_uncreated_lowercase_paths(tmp_path: Path) -> None:
    # Pytest supplies the directory; no test file or child directory is created.
    missing = Path(str(tmp_path).lower()) / "not-created" / "image.png"
    require: Callable[[Path], object] = local_path.require_local_path
    with _no_filesystem():
        assert require(tmp_path) is None
        assert require(missing) is None
