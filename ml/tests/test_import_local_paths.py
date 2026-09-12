"""RV-LOCAL / FR-SEC-003: remote-path lstat boundary, NOT packet evidence.

Structural UNC validity is not authorization. Local fixture paths and ancestors
use the original lstat; UNC attempts are intercepted before OS I/O. Mapped-drive
tests stub GetDriveTypeW and replace lstat with synthetic local-root metadata or
rejection, without filesystem/network I/O.
"""

import hashlib
import os
import stat
from collections.abc import Callable
from pathlib import Path
from unittest.mock import call, patch

import pytest

from autovision_ml.data import classification_import as classification
from autovision_ml.data import coco_import as coco
from autovision_ml.data import image_decode as decode
from autovision_ml.data import image_scan as scan
from autovision_ml.data import local_path
from autovision_ml.data.import_contract import (
    ScanImage,
    parse_scan_payload,
    parse_selection_manifest,
)

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows UNC boundary")
UNC = r"\\fixture-host.invalid\share\images"


def _image_metadata(path: str) -> ScanImage:
    raw = b"\x89PNG\r\n\x1a\nsynthetic-metadata-only"
    return {
        "key": "image:0",
        "sourcePath": path,
        "byteSize": len(raw),
        "mtimeNs": "1",
        "sha256": hashlib.sha256(raw).hexdigest(),
        "format": "png",
        "width": 13,
        "height": 9,
        "orientation": 1,
        "duplicateOf": None,
        "annotation": None,
    }


@pytest.mark.parametrize(
    ("reader", "kind", "field"),
    [
        (scan.enumerate_and_hash, "folder", "root"),
        (scan.enumerate_and_hash, "unlabeled", "selectionManifestPath"),
        (decode.decode_image, "unlabeled", "sourcePath"),
        (classification.import_classification, "csv", "root"),
        (classification.import_classification, "csv", "annotationPath"),
        (coco.import_coco, "coco", "root"),
        (coco.import_coco, "coco", "annotationPath"),
    ],
)
def test_unc_paths_rejected_before_lstat(
    tmp_path: Path, reader: Callable[..., object], kind: str, field: str
) -> None:
    assert not str(tmp_path).startswith("\\\\")
    root = UNC if field == "root" else str(tmp_path)
    image_path = str(Path(UNC if field == "sourcePath" else root) / "a.png")
    image = _image_metadata(image_path)
    reached: list[str] = []
    original_lstat = Path.lstat

    def guarded_lstat(path: Path) -> os.stat_result:
        if str(path).startswith("\\\\"):
            reached.append(str(path))
            raise PermissionError("NETWORK_IO_REACHED")
        return original_lstat(path)

    with patch.object(Path, "lstat", guarded_lstat):
        # Pure preflight must still accept UNC: DTO validation grants no access.
        kwargs: dict[str, object] = {"candidate": image}
        if reader is decode.decode_image:
            parse_selection_manifest(
                {"formatVersion": 1, "files": [image["sourcePath"]]}
            )
        else:
            source: dict[str, object] = {"format": kind, "root": root}
            if kind in ("csv", "coco"):
                name = "labels.csv" if kind == "csv" else "annotations.json"
                parent = Path(UNC) if field == "annotationPath" else tmp_path
                source["annotationPath"] = str(parent / name)
            elif field == "selectionManifestPath":
                source = {
                    "format": "unlabeled",
                    "selection": "files",
                    "selectionManifestPath": UNC + r"\selection.json",
                }
            task = "detection" if reader is coco.import_coco else "classification"
            validated = parse_scan_payload(
                {"taskType": task, "mode": "reference", "source": source}
            )["source"]
            kwargs = {"source": validated}
            if reader is not scan.enumerate_and_hash:
                kwargs["images"] = [image]  # Never fail early with NO_VALID_IMAGES.
        codes: set[str]
        try:
            result = reader(**kwargs)
        except ValueError as error:
            codes = {getattr(error, "code", str(error))}
        else:
            assert isinstance(
                result,
                (scan.ImageScan, classification.ClassificationImport, coco.CocoImport),
            )
            codes = {
                issue["code"] for issue in result.issues if issue["severity"] == "error"
            }
    rejected = "UNSAFE_PATH" in codes or codes == {"Invalid import contract"}
    assert reached or rejected, f"READ_STAGE_NOT_REACHED: {codes}"
    assert reached == [], f"NETWORK_IO_REACHED: {reached}"
    assert rejected


@pytest.mark.parametrize(
    ("reader", "kind", "field"),
    [
        (scan.enumerate_and_hash, "folder", "root"),
        (scan.enumerate_and_hash, "unlabeled", "selectionManifestPath"),
        (decode.decode_image, "unlabeled", "sourcePath"),
        (classification.import_classification, "csv", "root"),
        (classification.import_classification, "csv", "annotationPath"),
        (coco.import_coco, "coco", "root"),
        (coco.import_coco, "coco", "annotationPath"),
    ],
    ids=[
        "scan-root",
        "scan-selection-manifest",
        "decode-source",
        "csv-root",
        "csv-annotation",
        "coco-root",
        "coco-annotation",
    ],
)
def test_mapped_remote_drives_rejected_before_lstat(
    reader: Callable[..., object], kind: str, field: str
) -> None:
    remote_root = Path(r"Z:\rv-local-fixture\images")
    root = (
        Path(r"C:\rv-local-fixture\images")
        if field == "annotationPath"
        else remote_root
    )
    rejected_path = str(root)
    kwargs: dict[str, object]
    if reader is decode.decode_image:
        image = _image_metadata(str(root / "a.png"))
        parse_selection_manifest({"formatVersion": 1, "files": [image["sourcePath"]]})
        kwargs = {"candidate": image}
    else:
        source: dict[str, object] = {"format": kind, "root": str(root)}
        if kind in ("csv", "coco"):
            name = "labels.csv" if kind == "csv" else "annotations.json"
            source["annotationPath"] = str(remote_root / name)
            rejected_path = str(source[field])
        elif field == "selectionManifestPath":
            source = {
                "format": "unlabeled",
                "selection": "files",
                "selectionManifestPath": str(root / "selection.json"),
            }
        task = "detection" if reader is coco.import_coco else "classification"
        validated = parse_scan_payload(
            {"taskType": task, "mode": "reference", "source": source}
        )["source"]
        kwargs = {"source": validated}
        if reader is not scan.enumerate_and_hash:
            kwargs["images"] = [_image_metadata(str(root / "a.png"))]
    local_nodes = (*reversed(root.parents), root) if field == "annotationPath" else ()
    directory = os.stat_result(
        (stat.S_IFDIR, 1, 1, 1, 0, 0, 0, 0, 0, 0), {"st_file_attributes": 0}
    )

    def guarded_lstat(path: Path) -> os.stat_result:
        if path in local_nodes:
            return directory
        raise AssertionError("FILESYSTEM_IO_REACHED")

    with (
        patch.object(local_path.ctypes, "WinDLL") as loader,
        patch.object(Path, "lstat", autospec=True, side_effect=guarded_lstat) as lstat,
    ):
        query = loader.return_value.GetDriveTypeW
        query.return_value = 4
        if field == "annotationPath":
            query.side_effect = [3, 4]
        if reader is decode.decode_image:
            with pytest.raises(decode.DecodeError) as raised:
                reader(**kwargs)
            assert raised.value.code == "UNSAFE_PATH"
            assert str(raised.value) == "Image decode rejected"
        elif reader in (classification.import_classification, coco.import_coco):
            error_type = (
                classification.ImportFormatError
                if reader is classification.import_classification
                else coco.CocoFormatError
            )
            with pytest.raises(error_type) as annotation_error:
                reader(**kwargs)
            error = annotation_error.value
            assert isinstance(
                error, (classification.ImportFormatError, coco.CocoFormatError)
            )
            assert error.code == "UNSAFE_PATH"
            assert error.source_path == rejected_path
            assert str(error) == (
                "Classification import rejected"
                if reader is classification.import_classification
                else "COCO import rejected"
            )
        else:
            result = reader(**kwargs)
            assert isinstance(result, scan.ImageScan)
            assert result.images == ()
            assert "UNSAFE_PATH" in {
                issue["code"] for issue in result.issues if issue["severity"] == "error"
            }
        if field == "annotationPath":
            assert loader.call_args_list == [
                call("kernel32", winmode=0x800, use_last_error=True),
                call("kernel32", winmode=0x800, use_last_error=True),
            ]
            assert query.call_args_list == [call(root.anchor), call(remote_root.anchor)]
            assert lstat.call_args_list == [call(node) for node in local_nodes]
        else:
            loader.assert_called_once_with(
                "kernel32", winmode=0x800, use_last_error=True
            )
            query.assert_called_once_with(root.anchor)
            lstat.assert_not_called()
