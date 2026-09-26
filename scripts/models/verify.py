"""PKG-01: offline release verifier for resources/models/manifest.json.

It checks what JSON Schema cannot express (see the manifest schema $comment); the
schema itself is validated by scripts/models/manifest-schema.test.mjs, and both form
the PKG-01 gate. Nothing is downloaded, extracted, or modified: every file is read
locally, with SHA-256. Any malformed input fails closed (exit 1).
"""

from __future__ import annotations

import hashlib
import json
import ntpath
import re
import stat
import sys
from pathlib import Path
from typing import Any

CHUNK_BYTES = 1024**2
# docs/dependency-policy.md §2 (FR-LIC-002). Expressions and license URLs are not accepted.
ALLOWED_SPDX = frozenset(
    {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "PSF-2.0"}
)
# FR-LIC-016(3): the repository-local identifier, only for the checkpoint layer.
PRODUCT_LICENSE_REF = "LicenseRef-AutoVisionStudio"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def lexical_ok(relative: str, prefix: str) -> bool:
    parts = relative.split("/")
    return (
        relative.startswith(prefix)
        and "\\" not in relative
        and ":" not in relative
        and all(part not in ("", ".", "..") for part in parts)
        # Windows aliases: reserved device names and a trailing dot or space.
        and not any(
            ntpath.isreserved(part) or part.endswith((".", " ")) for part in parts
        )
    )


def is_link(info: Any) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
    )


def regular_file(
    root: Path, relative: str, prefix: str, problems: list[str], what: str
) -> Path | None:
    if not lexical_ok(relative, prefix):
        problems.append(f"{what}: {relative} is not a plain path under {prefix}")
        return None
    path = root
    parts = relative.split("/")
    for index, part in enumerate(parts):
        path = path / part
        try:
            info = path.lstat()
        except FileNotFoundError:
            problems.append(f"{what}: {relative} does not exist")
            return None
        last = index == len(parts) - 1
        if is_link(info) or not (
            stat.S_ISREG(info.st_mode) if last else stat.S_ISDIR(info.st_mode)
        ):
            problems.append(
                f"{what}: {relative} is not a regular file reached without links"
            )
            return None
    return path


def same_bytes(
    path: Path, size: int, sha256: str, problems: list[str], what: str
) -> None:
    if path.stat().st_size != size:
        problems.append(f"{what}: byte size {path.stat().st_size} != {size}")
    elif sha256_of(path) != sha256:
        problems.append(f"{what}: SHA-256 does not match")


def cells(record: str, label: str) -> list[str]:
    return re.findall(rf"^\| {re.escape(label)} \| (.+) \|\r?$", record, re.MULTILINE)


def plain(value: str) -> str:
    """Cell text without bold markers and without a trailing note in parentheses."""
    return re.split(r"[（(]", value.replace("**", ""), maxsplit=1)[0].strip()


# The C7 records state the artifact row; the C6 records state the checkpoint SHA-256 row.
ARTIFACT_FIELDS = (
    ("承認対象 artifact", re.compile(r"^`[^`]+` SHA-256 `([0-9a-f]{64})`$")),
    ("checkpoint SHA-256", re.compile(r"^(?:\*\*)?`([0-9a-f]{64})`(?:\*\*)?$")),
)


def approval_ok(record: str, entry: dict[str, Any]) -> list[str]:
    approval = entry["approval"]
    problems = []
    for label, value in (
        ("最終判定", "承認"),
        ("承認者氏名", approval["approver"]),
        ("承認日", approval["date"]),
    ):
        found = cells(record, label)
        if len(found) != 1:
            problems.append(f"record has {len(found)} {label} rows instead of 1")
        elif plain(found[0]) != value:
            problems.append(f"record's {label} is not {value}")
    artifacts = [
        (pattern, value)
        for label, pattern in ARTIFACT_FIELDS
        for value in cells(record, label)
    ]
    digest = artifacts[0][0].match(artifacts[0][1]) if len(artifacts) == 1 else None
    if not digest or digest.group(1) != entry["sha256"]:
        problems.append("record's approved artifact SHA-256 does not match the entry")
    return problems


def verify(
    root: Path, manifest: dict[str, Any], payload_root: Path | None = None
) -> list[str]:
    problems: list[str] = []
    if manifest["releaseStatus"]["ready"] is not True:
        problems.append("releaseStatus.ready is not true")
    models = manifest["models"]
    if not models:
        problems.append("models is empty")
    for key in ("id", "payloadPath"):
        # Windows file names are case-insensitive, so compare case-folded values.
        values = [entry[key].casefold() for entry in models]
        problems += [
            f"duplicate {key}: {v}"
            for v in sorted({v for v in values if values.count(v) > 1})
        ]
    for entry in models:
        name = entry["id"]
        source = regular_file(
            root, entry["sourcePath"], "vendor/models/", problems, f"{name} sourcePath"
        )
        if source:
            same_bytes(
                source,
                entry["byteSize"],
                entry["sha256"],
                problems,
                f"{name} sourcePath",
            )
        if not lexical_ok(entry["payloadPath"], "resources/models/"):
            problems.append(
                f"{name} payloadPath: {entry['payloadPath']} is not a plain path under resources/models/"
            )
        elif payload_root is not None:
            payload = regular_file(
                payload_root,
                entry["payloadPath"],
                "resources/models/",
                problems,
                f"{name} payload",
            )
            if payload:
                same_bytes(
                    payload,
                    entry["byteSize"],
                    entry["sha256"],
                    problems,
                    f"{name} payload",
                )
        if entry["licenses"]["code"]["spdx"] not in ALLOWED_SPDX:
            problems.append(
                f"{name} code license {entry['licenses']['code']['spdx']} is not allowed"
            )
        if entry["licenses"]["checkpoint"]["spdx"] not in ALLOWED_SPDX | {
            PRODUCT_LICENSE_REF
        }:
            problems.append(
                f"{name} checkpoint license {entry['licenses']['checkpoint']['spdx']} is not allowed"
            )
        record = regular_file(
            root,
            entry["approval"]["recordPath"],
            "docs/model-governance/",
            problems,
            f"{name} record",
        )
        if record and sha256_of(record) != entry["approval"].get("recordSha256"):
            problems.append(
                f"{name} record: SHA-256 does not match approval.recordSha256"
            )
        elif record:
            problems += [
                f"{name} {p}"
                for p in approval_ok(record.read_text(encoding="utf-8"), entry)
            ]
        for item in entry["evidence"]:
            copy = regular_file(
                root,
                item["localPath"],
                "docs/model-governance/",
                problems,
                f"{name} evidence",
            )
            if copy and sha256_of(copy) != item["sha256"]:
                problems.append(
                    f"{name} evidence {item['localPath']}: SHA-256 does not match"
                )
        if not any(item["kind"] == "model-card" for item in entry["evidence"]):
            problems.append(f"{name} has no model-card evidence")
        config = entry.get("inferenceConfig")
        if (
            config
            and not config["scoreRange"]["minimum"]
            <= config["confidenceThreshold"]
            <= config["scoreRange"]["maximum"]
        ):
            problems.append(f"{name} confidenceThreshold is outside scoreRange")
    for result in manifest["releaseStatus"].get("assistQuality", []):
        target = next((e for e in models if e["id"] == result["modelId"]), None)
        if (
            not target
            or target["category"] != "C7"
            or target["task"] != result["task"]
            or target["approval"]["recordPath"] != result["recordPath"]
        ):
            problems.append(
                f"assistQuality {result['modelId']} does not name its C7 entry and record"
            )
            continue
        record = regular_file(
            root,
            result["recordPath"],
            "docs/model-governance/",
            problems,
            "assistQuality record",
        )
        if record and sha256_of(record) != result["recordSha256"]:
            problems.append(
                f"assistQuality {result['modelId']}: record SHA-256 does not match"
            )
    return problems


def run(root: Path, payload_root: Path | None = None) -> int:
    try:
        manifest = json.loads(
            (root / "resources" / "models" / "manifest.json").read_text(
                encoding="utf-8"
            )
        )
        problems = verify(root, manifest, payload_root)
    except (
        OSError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
        RecursionError,
    ) as error:
        problems = [f"manifest could not be verified: {type(error).__name__}: {error}"]
    for problem in problems:
        print(problem, file=sys.stderr)
    if problems:
        return 1
    payloads = [
        {k: e[k] for k in ("sourcePath", "payloadPath", "sha256", "byteSize")}
        for e in manifest["models"]
    ]
    print(json.dumps({"verified": True, "payloads": payloads}, indent=2))
    return 0


def main(argv: list[str]) -> int:
    if len(argv) > 2:
        print("usage: verify.py [payload-root]", file=sys.stderr)
        return 2
    return run(
        Path(__file__).resolve().parents[2], Path(argv[1]) if len(argv) == 2 else None
    )


if __name__ == "__main__":
    sys.exit(main(sys.argv))
