"""SPI-17 / G2-07: Annotation Assist quality baseline harness.

fail-closed boundaries kept by this harness:

* The baseline compares an assisted annotation session against a manual-only
  session on the same gold set. Both sessions must be recorded from real work;
  the harness never generates, estimates or simulates them.
* An assisted session can only exist once an Annotation Assist Model (C7) is
  approved, so the harness refuses to report a baseline and exits with
  ``verdict=BLOCKED`` until the manifest holds an approved C7 entry for both
  classification and detection. ``releaseStatus.ready`` is not a precondition:
  the manifest can only become ready after this baseline has passed
  (``releaseStatus.assistQuality`` in ``manifest.schema.json``).
* ``--self-test`` only verifies the metric arithmetic on synthetic records; a
  self-test pass is not a quality baseline.
* Both sessions must list the same gold-set item ids exactly once. Time is
  compared by the median per-item seconds (POC-16); the mean is reported for
  information.

Session record format (JSON Lines, one object per gold-set item)::

    {"item_id": "...", "proposed": true, "outcome": "accept", "seconds": 4.5}

``outcome`` is ``accept`` / ``edit`` / ``reject`` for proposed items and
``manual`` for items the assist model did not propose.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPO_ROOT / "resources" / "models" / "manifest.json"
REQUIRED_ASSIST_TASKS = ("classification", "detection")
OUTCOMES = ("accept", "edit", "reject", "manual")


class RecordError(ValueError):
    """Raised when a session record does not satisfy the documented format."""


def parse_session(lines: list[str], source: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        record = json.loads(line)
        for field in ("item_id", "proposed", "outcome", "seconds"):
            if field not in record:
                raise RecordError(f"{source}:{line_number} is missing '{field}'")
        seconds = record["seconds"]
        if (
            not isinstance(record["item_id"], str)
            or not record["item_id"]
            or not isinstance(record["proposed"], bool)
            or isinstance(seconds, bool)
            or not isinstance(seconds, (int, float))
            or not math.isfinite(seconds)
            or seconds < 0
        ):
            raise RecordError(
                f"{source}:{line_number} needs a non-empty string item_id, a "
                "boolean proposed and finite non-negative seconds"
            )
        if record["item_id"] in seen:
            raise RecordError(
                f"{source}:{line_number} repeats item_id {record['item_id']!r}"
            )
        seen.add(record["item_id"])
        if record["outcome"] not in OUTCOMES:
            raise RecordError(
                f"{source}:{line_number} has unknown outcome {record['outcome']!r}"
            )
        if record["proposed"] != (record["outcome"] != "manual"):
            raise RecordError(
                f"{source}:{line_number} mixes proposed={record['proposed']!r} "
                f"with outcome={record['outcome']!r}"
            )
        records.append(record)
    if not records:
        raise RecordError(f"{source} contains no records")
    return records


def load_session(path: Path) -> list[dict[str, Any]]:
    return parse_session(path.read_text(encoding="utf-8").splitlines(), str(path))


def summarise(records: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(records)
    proposed = [r for r in records if r["outcome"] != "manual"]
    counts = {name: 0 for name in OUTCOMES}
    for record in records:
        counts[record["outcome"]] += 1
    proposed_count = len(proposed)
    total_seconds = sum(float(r["seconds"]) for r in records)
    return {
        "items": total,
        "proposed_items": proposed_count,
        "coverage": proposed_count / total,
        "accept_rate": counts["accept"] / proposed_count if proposed_count else None,
        "edit_rate": counts["edit"] / proposed_count if proposed_count else None,
        "reject_rate": counts["reject"] / proposed_count if proposed_count else None,
        "counts": counts,
        "total_seconds": round(total_seconds, 3),
        "seconds_per_item": round(total_seconds / total, 3),
        "median_seconds_per_item": round(
            statistics.median(float(r["seconds"]) for r in records), 3
        ),
    }


def check_manifest() -> dict[str, Any]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    entries = manifest.get("models", [])
    assist = {
        task: [
            entry
            for entry in entries
            if entry.get("category") == "C7" and entry.get("task") == task
        ]
        for task in REQUIRED_ASSIST_TASKS
    }
    blockers: list[str] = []
    for task, matches in assist.items():
        if not matches:
            blockers.append(f"no approved C7 {task} assist entry in the manifest")
    return {
        "manifest_path": MANIFEST_PATH.relative_to(REPO_ROOT).as_posix(),
        "release_ready": bool(manifest.get("releaseStatus", {}).get("ready", False)),
        "model_entry_count": len(entries),
        "approved_assist_entries": {
            task: len(matches) for task, matches in assist.items()
        },
        "blockers": blockers,
    }


def self_test() -> list[str]:
    """Verify the metric arithmetic only. This is not a quality baseline."""
    failures: list[str] = []
    assisted = [
        {"item_id": "a", "proposed": True, "outcome": "accept", "seconds": 2.0},
        {"item_id": "b", "proposed": True, "outcome": "edit", "seconds": 6.0},
        {"item_id": "c", "proposed": True, "outcome": "reject", "seconds": 8.0},
        {"item_id": "d", "proposed": False, "outcome": "manual", "seconds": 4.0},
    ]
    summary = summarise(assisted)
    expected = {
        "items": 4,
        "proposed_items": 3,
        "coverage": 0.75,
        "accept_rate": 1 / 3,
        "edit_rate": 1 / 3,
        "reject_rate": 1 / 3,
        "total_seconds": 20.0,
        "seconds_per_item": 5.0,
        "median_seconds_per_item": 5.0,
    }
    for key, value in expected.items():
        actual = summary[key]
        matches = (
            abs(float(actual) - value) <= 1e-9
            if isinstance(value, float)
            else actual == value
        )
        if not matches:
            failures.append(f"{key}: expected {value}, got {actual}")

    empty = summarise(
        [{"item_id": "a", "proposed": False, "outcome": "manual", "seconds": 1.0}]
    )
    if empty["accept_rate"] is not None or empty["coverage"] != 0.0:
        failures.append("zero-coverage session must report coverage 0 and null rates")

    for bad in (
        {"item_id": "x", "proposed": True, "outcome": "manual", "seconds": 1.0},
        {"item_id": "x", "proposed": True, "outcome": "unknown", "seconds": 1.0},
        {"item_id": "x", "proposed": True, "outcome": "accept"},
        {"item_id": "x", "proposed": "false", "outcome": "manual", "seconds": 1.0},
        {"item_id": "", "proposed": False, "outcome": "manual", "seconds": 1.0},
        {"item_id": "x", "proposed": False, "outcome": "manual", "seconds": -1},
        {"item_id": "x", "proposed": False, "outcome": "manual", "seconds": "1"},
        {"item_id": "x", "proposed": False, "outcome": "manual", "seconds": math.nan},
    ):
        try:
            parse_session([json.dumps(bad)], "self-test")
        except RecordError:
            continue
        failures.append(f"malformed record was accepted: {bad}")

    duplicate = {"item_id": "x", "proposed": False, "outcome": "manual", "seconds": 1}
    try:
        parse_session([json.dumps(duplicate)] * 2, "self-test")
    except RecordError:
        pass
    else:
        failures.append("a repeated item_id was accepted")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="SPI-17 assist quality baseline")
    parser.add_argument(
        "--assisted-session",
        type=Path,
        help="JSONL recorded from a real assisted annotation session",
    )
    parser.add_argument(
        "--manual-session",
        type=Path,
        help="JSONL recorded from a real manual-only session on the same gold set",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="verify the metric arithmetic only; does not produce a baseline",
    )
    args = parser.parse_args()

    if args.self_test:
        failures = self_test()
        json.dump(
            {
                "task": "SPI-17 / G2-07 assist quality baseline",
                "mode": "self-test",
                "verdict": "FAIL" if failures else "PASS",
                "failures": failures,
                "note": "metric arithmetic only; not an assist quality baseline",
            },
            sys.stdout,
            ensure_ascii=False,
            indent=2,
        )
        sys.stdout.write("\n")
        return 1 if failures else 0

    gate = check_manifest()
    if gate["blockers"]:
        json.dump(
            {
                "task": "SPI-17 / G2-07 assist quality baseline",
                "mode": "baseline",
                "verdict": "BLOCKED",
                "measured": None,
                "blockers": gate["blockers"],
                "manifest_gate": gate,
                "reason": (
                    "The manifest lacks an approved Annotation Assist Model (C7) "
                    "entry for every required task. Without an approved "
                    "checkpoint no assisted session can be recorded, so "
                    "coverage / accept / edit / reject / elapsed time stay "
                    "unmeasured."
                ),
            },
            sys.stdout,
            ensure_ascii=False,
            indent=2,
        )
        sys.stdout.write("\n")
        return 2

    if args.assisted_session is None or args.manual_session is None:
        parser.error("--assisted-session and --manual-session are both required")

    assisted_records = load_session(args.assisted_session)
    manual_records = load_session(args.manual_session)
    assisted_ids = {r["item_id"] for r in assisted_records}
    manual_ids = {r["item_id"] for r in manual_records}
    if assisted_ids != manual_ids:
        raise SystemExit(
            f"gold set mismatch: {len(assisted_ids - manual_ids)} item ids only in "
            f"the assisted session, {len(manual_ids - assisted_ids)} only in the "
            "manual-only session"
        )
    assisted = summarise(assisted_records)
    manual = summarise(manual_records)
    json.dump(
        {
            "task": "SPI-17 / G2-07 assist quality baseline",
            "mode": "baseline",
            "verdict": "MEASURED",
            "manifest_gate": gate,
            "assisted": assisted,
            "manual_only": manual,
            "seconds_delta_per_item": round(
                assisted["seconds_per_item"] - manual["seconds_per_item"], 3
            ),
            "median_seconds_delta_per_item": round(
                assisted["median_seconds_per_item"] - manual["median_seconds_per_item"],
                3,
            ),
        },
        sys.stdout,
        ensure_ascii=False,
        indent=2,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
