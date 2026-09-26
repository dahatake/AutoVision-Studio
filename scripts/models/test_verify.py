"""PKG-01 release verifier tests (synthetic repository in tmp_path, plus the real manifest)."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
from typing import Any

import pytest

SCRIPT = Path(__file__).with_name("verify.py")
SPEC = importlib.util.spec_from_file_location("model_payload_verify", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
verifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verifier)

REPO = SCRIPT.resolve().parents[2]
PAYLOAD = b"approved model bytes"
RECORD = "docs/model-governance/m-adoption.md"


def write(root: Path, relative: str, data: bytes) -> str:
    path = root.joinpath(*relative.split("/"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def record_text(
    sha: str,
    approver: str = "owner",
    date: str = "2026-01-02",
    row: str = "承認対象 artifact",
) -> bytes:
    return (
        f"| 最終判定 | **承認** |\n| 承認者氏名 | {approver} |\n| 承認日 | {date} |\n"
        f"| {row} | `model.safetensors` SHA-256 `{sha}` |\n"
    ).encode()


@pytest.fixture
def repo(tmp_path: Path) -> tuple[Path, dict[str, Any]]:
    sha = write(tmp_path, "vendor/models/m/model.safetensors", PAYLOAD)
    record_sha = write(tmp_path, RECORD, record_text(sha))
    card_sha = write(tmp_path, "docs/model-governance/evidence/card.md", b"card")
    entry = {
        "id": "m",
        "category": "C7",
        "task": "detection",
        "sourcePath": "vendor/models/m/model.safetensors",
        "payloadPath": "resources/models/m/model.safetensors",
        "sha256": sha,
        "byteSize": len(PAYLOAD),
        "licenses": {
            "code": {"spdx": "Apache-2.0"},
            "checkpoint": {"spdx": "LicenseRef-AutoVisionStudio"},
        },
        "evidence": [
            {
                "kind": "model-card",
                "localPath": "docs/model-governance/evidence/card.md",
                "sha256": card_sha,
            }
        ],
        "approval": {
            "recordPath": RECORD,
            "recordSha256": record_sha,
            "approver": "owner",
            "date": "2026-01-02",
        },
        "inferenceConfig": {
            "scoreRange": {"minimum": 0, "maximum": 1},
            "confidenceThreshold": 0.5,
        },
    }
    quality = {
        "task": "detection",
        "modelId": "m",
        "recordPath": RECORD,
        "recordSha256": record_sha,
    }
    manifest = {
        "releaseStatus": {"ready": True, "assistQuality": [quality]},
        "models": [entry],
    }
    assert verifier.verify(tmp_path, manifest) == []
    return tmp_path, manifest


def rewrite_record(root: Path, entry: dict[str, Any], data: bytes) -> None:
    entry["approval"]["recordSha256"] = write(root, RECORD, data)


def problems_after(repo, change) -> list[str]:
    root, manifest = repo
    changed = copy.deepcopy(manifest)
    change(root, changed, changed["models"][0])
    return verifier.verify(root, changed)


def test_rejects_a_manifest_that_is_not_ready(repo):
    assert problems_after(
        repo, lambda r, m, e: m["releaseStatus"].update(ready=False)
    ) == ["releaseStatus.ready is not true"]


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("byteSize", len(PAYLOAD) + 1, "byte size"),
        ("sha256", "0" * 64, "SHA-256 does not match"),
        ("sourcePath", "vendor/models/m/missing.bin", "does not exist"),
        (
            "sourcePath",
            "resources/models/m/model.safetensors",
            "is not a plain path under vendor/models/",
        ),
        (
            "sourcePath",
            "vendor/models/../m/model.safetensors",
            "is not a plain path under vendor/models/",
        ),
        (
            "sourcePath",
            "vendor/models/m\\..\\m\\model.safetensors",
            "is not a plain path under vendor/models/",
        ),
        (
            "sourcePath",
            "vendor/models/./m/model.safetensors",
            "is not a plain path under vendor/models/",
        ),
        (
            "payloadPath",
            "vendor/models/m/model.safetensors",
            "is not a plain path under resources/models/",
        ),
        (
            "payloadPath",
            "resources/models/../../x",
            "is not a plain path under resources/models/",
        ),
        (
            "payloadPath",
            "resources/models/CON/model.safetensors",
            "is not a plain path under resources/models/",
        ),
        (
            "payloadPath",
            "resources/models/m./model.safetensors",
            "is not a plain path under resources/models/",
        ),
    ],
)
def test_rejects_source_and_payload_path_violations(repo, field, value, message):
    problems = problems_after(repo, lambda r, m, e: e.update({field: value}))
    assert any(message in p for p in problems), problems


def test_rejects_a_junction_on_the_way_to_the_source(repo, tmp_path_factory):
    root, _ = repo
    outside = tmp_path_factory.mktemp("outside")
    write(outside, "model.safetensors", PAYLOAD)
    try:
        import _winapi

        _winapi.CreateJunction(str(outside), str(root / "vendor" / "models" / "linked"))
    except (ImportError, OSError) as error:
        pytest.skip(f"junctions are not available: {error}")
    problems = problems_after(
        repo,
        lambda r, m, e: e.update(sourcePath="vendor/models/linked/model.safetensors"),
    )
    assert any("is not a regular file reached without links" in p for p in problems), (
        problems
    )


def test_rejects_duplicate_ids_and_payload_paths(repo):
    problems = problems_after(
        repo, lambda r, m, e: m["models"].append(copy.deepcopy(e))
    )
    assert "duplicate id: m" in problems
    assert "duplicate payloadPath: resources/models/m/model.safetensors" in problems


def test_rejects_payload_paths_that_differ_only_by_case(repo):
    def change(root, manifest, entry):
        other = copy.deepcopy(entry)
        other["id"] = "n"
        other["payloadPath"] = "resources/models/M/model.safetensors"
        manifest["models"].append(other)

    problems = problems_after(repo, change)
    assert "duplicate payloadPath: resources/models/m/model.safetensors" in problems


def test_run_fails_closed_on_deeply_nested_json(repo, capsys):
    root, _ = repo
    write(root, "resources/models/manifest.json", b"[" * 100_000 + b"]" * 100_000)
    assert verifier.run(root) == 1
    assert "manifest could not be verified: RecursionError" in capsys.readouterr().err


@pytest.mark.parametrize(
    "spdx",
    [
        "GPL-3.0-only",
        "unknown",
        "LicenseRef-AutoVisionStudio",
        "Apache-2.0 OR MIT",
        "https://example.com/license",
    ],
)
def test_rejects_code_licenses_outside_the_policy(repo, spdx):
    problems = problems_after(
        repo, lambda r, m, e: e["licenses"]["code"].update(spdx=spdx)
    )
    assert problems == [f"m code license {spdx} is not allowed"]


@pytest.mark.parametrize(
    "spdx", sorted(verifier.ALLOWED_SPDX | {"LicenseRef-AutoVisionStudio"})
)
def test_accepts_the_allowed_checkpoint_licenses(repo, spdx):
    assert (
        problems_after(
            repo, lambda r, m, e: e["licenses"]["checkpoint"].update(spdx=spdx)
        )
        == []
    )


@pytest.mark.parametrize("spdx", ["LicenseRef-Other", "LicenseRef-", "GPL-3.0-only"])
def test_accepts_only_the_product_license_ref_for_the_checkpoint(repo, spdx):
    problems = problems_after(
        repo, lambda r, m, e: e["licenses"]["checkpoint"].update(spdx=spdx)
    )
    assert problems == [f"m checkpoint license {spdx} is not allowed"]


def test_rejects_an_approval_record_that_does_not_match_the_entry(repo):
    def change(root, manifest, entry):
        entry["approval"]["approver"] = "someone else"
        rewrite_record(root, entry, "| 最終判定 | **保留** |\n".encode())
        manifest["releaseStatus"].pop("assistQuality")

    problems = problems_after(repo, change)
    assert "m record's 最終判定 is not 承認" in problems
    assert "m record has 0 承認者氏名 rows instead of 1" in problems
    assert "m record's approved artifact SHA-256 does not match the entry" in problems


@pytest.mark.parametrize(
    ("approver", "date", "row"),
    [
        ("not-owner", "2026-01-02", "承認対象 artifact"),
        ("owner", "2026-01-02 or later", "承認対象 artifact"),
        ("owner", "2026-01-02", "参考 SHA-256"),
    ],
)
def test_rejects_substring_matches_and_hashes_outside_the_artifact_field(
    repo, approver, date, row
):
    def change(root, manifest, entry):
        rewrite_record(root, entry, record_text(entry["sha256"], approver, date, row))
        manifest["releaseStatus"].pop("assistQuality")

    assert len(problems_after(repo, change)) == 1


def test_accepts_the_c6_record_format_with_bold_cells_and_notes(repo):
    def change(root, manifest, entry):
        record = (
            "| 最終判定 | **承認** |\n| 承認者氏名 | **owner**（repository owner） |\n| 承認日 | **2026-01-02** |\n"
            f"| checkpoint SHA-256 | **`{entry['sha256']}`** |\n"
        )
        rewrite_record(root, entry, record.encode())
        manifest["releaseStatus"].pop("assistQuality")

    assert problems_after(repo, change) == []


def test_rejects_a_record_changed_after_its_digest_was_pinned(repo):
    def change(root, manifest, entry):
        write(root, RECORD, record_text(entry["sha256"]) + "| 条件 | 変更 |\n".encode())
        manifest["releaseStatus"].pop("assistQuality")

    assert problems_after(repo, change) == [
        "m record: SHA-256 does not match approval.recordSha256"
    ]


def test_rejects_conflicting_rows_and_several_digests(repo):
    def conflicting(root, manifest, entry):
        rewrite_record(
            root,
            entry,
            record_text(entry["sha256"]) + "| 最終判定 | **却下** |\n".encode(),
        )
        manifest["releaseStatus"].pop("assistQuality")

    def several(root, manifest, entry):
        record = (
            record_text(entry["sha256"])
            .decode()
            .replace(
                f"SHA-256 `{entry['sha256']}`",
                f"SHA-256 `{entry['sha256']}` `{'0' * 64}`",
            )
        )
        rewrite_record(root, entry, record.encode())
        manifest["releaseStatus"].pop("assistQuality")

    assert problems_after(repo, conflicting) == [
        "m record has 2 最終判定 rows instead of 1"
    ]
    assert problems_after(repo, several) == [
        "m record's approved artifact SHA-256 does not match the entry"
    ]


def test_rejects_changed_evidence_and_a_missing_model_card(repo):
    def change(root, manifest, entry):
        write(root, "docs/model-governance/evidence/card.md", b"changed")
        entry["evidence"][0]["kind"] = "other"

    problems = problems_after(repo, change)
    assert (
        "m evidence docs/model-governance/evidence/card.md: SHA-256 does not match"
        in problems
    )
    assert "m has no model-card evidence" in problems


def test_rejects_a_threshold_outside_the_score_range(repo):
    problems = problems_after(
        repo, lambda r, m, e: e["inferenceConfig"].update(confidenceThreshold=1.5)
    )
    assert problems == ["m confidenceThreshold is outside scoreRange"]


def test_rejects_assist_quality_that_does_not_bind_the_c7_record(repo):
    def wrong_task(root, manifest, entry):
        manifest["releaseStatus"]["assistQuality"][0]["task"] = "classification"

    def wrong_hash(root, manifest, entry):
        manifest["releaseStatus"]["assistQuality"][0]["recordSha256"] = "0" * 64

    assert problems_after(repo, wrong_task) == [
        "assistQuality m does not name its C7 entry and record"
    ]
    assert problems_after(repo, wrong_hash) == [
        "assistQuality m: record SHA-256 does not match"
    ]


def test_checks_packaged_payload_bytes_only_when_a_payload_root_is_given(
    repo, tmp_path_factory
):
    root, manifest = repo
    package = tmp_path_factory.mktemp("package")
    assert any(
        "payload" in p and "does not exist" in p
        for p in verifier.verify(root, manifest, package)
    )
    write(package, "resources/models/m/model.safetensors", PAYLOAD)
    assert verifier.verify(root, manifest, package) == []
    write(package, "resources/models/m/model.safetensors", b"other bytes!!!!!!!!!")
    assert any(
        "m payload: SHA-256 does not match" in p
        for p in verifier.verify(root, manifest, package)
    )


@pytest.mark.parametrize(
    "text",
    ["not json", "{}", '{"releaseStatus": {"ready": true}, "models": [{"id": "m"}]}'],
)
def test_run_fails_closed_on_a_malformed_manifest(repo, text, capsys):
    root, _ = repo
    write(root, "resources/models/manifest.json", text.encode())
    assert verifier.run(root) == 1
    assert "manifest could not be verified" in capsys.readouterr().err


def test_run_rejects_a_ready_manifest_without_models(repo, capsys):
    root, _ = repo
    write(
        root,
        "resources/models/manifest.json",
        b'{"releaseStatus": {"ready": true}, "models": []}',
    )
    assert verifier.run(root) == 1
    assert "models is empty" in capsys.readouterr().err


def test_run_prints_the_source_to_payload_mapping(repo, capsys):
    root, manifest = repo
    write(root, "resources/models/manifest.json", json.dumps(manifest).encode())
    assert verifier.run(root) == 0
    payload = json.loads(capsys.readouterr().out)["payloads"][0]
    assert payload["sourcePath"] == "vendor/models/m/model.safetensors"
    assert payload["payloadPath"] == "resources/models/m/model.safetensors"
    assert payload["sha256"] == hashlib.sha256(PAYLOAD).hexdigest()
    assert payload["byteSize"] == len(PAYLOAD)


def test_the_actual_manifest_passes_with_the_local_approved_payloads():
    manifest = json.loads(
        (REPO / "resources" / "models" / "manifest.json").read_text(encoding="utf-8")
    )
    missing = [
        e["sourcePath"]
        for e in manifest["models"]
        if not REPO.joinpath(*e["sourcePath"].split("/")).is_file()
    ]
    if missing:
        pytest.skip(
            f"untracked approved payloads are not present on this machine: {missing}"
        )
    assert verifier.verify(REPO, manifest) == []
