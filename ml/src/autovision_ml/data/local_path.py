"""RV-LOCAL: Windows drive locality only, before caller filesystem access."""

from __future__ import annotations

import ctypes
import os
from pathlib import Path, PureWindowsPath


def require_local_path(path: Path) -> None:
    """Reject nonlocal drives; callers retain lexical and reparse checks."""
    if os.name != "nt":
        raise ValueError("LOCAL_PATH_REQUIRED")
    parsed = PureWindowsPath(path)
    if (
        not parsed.is_absolute()
        or len(parsed.drive) != 2
        or not parsed.drive[0].isascii()
        or not parsed.drive[0].isalpha()
        or parsed.drive[1] != ":"
        or ".." in parsed.parts
        or "\0" in str(path)
    ):
        raise ValueError("LOCAL_PATH_REQUIRED")
    # https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-getdrivetypew
    # Query afresh: a drive letter can be remapped between calls.
    kernel = ctypes.WinDLL("kernel32", winmode=0x800, use_last_error=True)
    drive_type = kernel.GetDriveTypeW
    drive_type.argtypes = [ctypes.c_wchar_p]
    drive_type.restype = ctypes.c_uint32
    # Removable, fixed, CD-ROM and RAM disk; all other results fail closed.
    if drive_type(parsed.anchor) not in (2, 3, 5, 6):
        raise ValueError("LOCAL_PATH_REQUIRED")
