"""SPI-17 / G2-07: Annotation Assist quality baseline harness.

fail-closed boundaries kept by this harness:

* The baseline compares an assisted annotation session against a manual-only
  session on the same gold set. Both sessions must be recorded from real work;
  the harness never generates, estimates or simulates them.
* The precondition is an adoption candidate that passed every gate except the
  comparison trial (adoption record section 12). Its record is passed with
  ``--candidate-record`` and the expected SHA-256 with ``--candidate-sha256``;
  a missing record or a mismatching digest reports ``verdict=BLOCKED``. The
  harness binds the result to that record only; it does not judge the other
  gates, which remain the adoption record's own verdict (section 15).
  ``releaseStatus.ready`` is not a precondition. A passing result is recorded in
  ``releaseStatus.assistQuality``; since manifest schema 2.0.1 a ready manifest
  no longer requires it (the Version 1 comparison was waived on 2026-09-26).
* Final labels come only from the product's confirmed Dataset Revision
  manifests (``--assisted-revision`` / ``--manual-revision``). Each manifest's
  SHA-256 must equal the single ``revision_sha256: <hex>`` line of
  ``<session file>.meta.txt``. Every gold item must match exactly one revision
  item by ``imageSha256`` whose ``disposition`` is not ``excluded``, and the
  revision ``taskType`` must equal the gold set task, and every gold class
  name must be one of the revision schema's ``normalizedName`` values;
  otherwise the session is invalid and the harness stops without a verdict.
  ``outcome`` is never used to infer a final label.
* The gold set must have the item count fixed by the approved plan (60
  classification items, 20 detection items).
* Criteria are the owner-approved gold set plans (G2D-07C / G2D-07D):
  classification accuracy may drop by at most 1/60 overall and 1/20 per class;
  detection F1 (IoU >= 0.5, greedy one-to-one per item and class) may drop by
  at most 0.005; the assisted proposal coverage must be at least 0.5; and the
  median per-item seconds must be strictly shorter. PASS requires all of
  them. Quality is compared as exact fractions so boundaries do not round.
* ``--self-test`` only verifies the arithmetic on synthetic records; a
  self-test pass is not a quality baseline.

Session record format (JSON Lines, one object per gold-set item)::

    {"item_id": "...", "proposed": true, "outcome": "accept", "seconds": 4.5}

``outcome`` is ``accept`` / ``edit`` / ``reject`` for proposed items and
``manual`` for items the assist model did not propose.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import re
import statistics
import sys
import tempfile
from fractions import Fraction
from pathlib import Path
from typing import Any

OUTCOMES = ("accept", "edit", "reject", "manual")
TASKS = ("classification", "detection")
# Owner rulings G2D-07C / G2D-07D (docs/model-governance/evidence/).
CLASSIFICATION_DELTA = Fraction(1, 60)
CLASSIFICATION_CLASS_DELTA = Fraction(1, 20)
DETECTION_DELTA = Fraction(5, 1000)
DETECTION_IOU = 0.5
MIN_COVERAGE = Fraction(1, 2)
# Item counts fixed by the approved gold set plans (section 2 of each plan).
APPROVED_ITEM_COUNT = {"classification": 60, "detection": 20}


class RecordError(ValueError):
    """Raised when an input does not satisfy the documented format."""


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


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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


def check_candidate(record: Path | None, expected_sha256: str | None) -> list[str]:
    if record is None or expected_sha256 is None:
        return ["--candidate-record and --candidate-sha256 are both required"]
    if not record.is_file():
        return [f"candidate record {record} does not exist"]
    actual = sha256_file(record)
    if actual != expected_sha256.lower():
        return [f"candidate record SHA-256 {actual} != {expected_sha256.lower()}"]
    return []


def parse_goldset(goldset: dict[str, Any]) -> dict[str, Any]:
    task = goldset.get("task")
    items = goldset.get("items")
    if task not in TASKS or not isinstance(items, list) or not items:
        raise RecordError("gold set needs a task and a non-empty items list")
    ids = [item["item_id"] for item in items]
    if len(ids) != len(set(ids)) or len(ids) != goldset.get("expected_item_count"):
        raise RecordError("gold set item ids must be unique and match the count")
    if len(ids) != APPROVED_ITEM_COUNT[task]:
        raise RecordError(
            f"gold set has {len(ids)} items; the approved plan fixes "
            f"{APPROVED_ITEM_COUNT[task]}"
        )
    return goldset


def check_session_ids(goldset: dict[str, Any], records: list[dict[str, Any]]) -> None:
    gold_ids = {item["item_id"] for item in goldset["items"]}
    session_ids = {record["item_id"] for record in records}
    if session_ids != gold_ids:
        raise RecordError(
            f"gold set mismatch: {len(session_ids - gold_ids)} session item ids "
            f"are not in the gold set and {len(gold_ids - session_ids)} gold "
            "items are missing from the session"
        )


def load_revision(path: Path, session: Path) -> tuple[dict[str, Any], str]:
    meta = session.with_name(session.name + ".meta.txt").read_text(encoding="utf-8")
    recorded = re.findall(r"^revision_sha256: ([0-9a-f]{64})$", meta, re.MULTILINE)
    digest = sha256_file(path)
    if recorded != [digest]:
        raise RecordError(
            f"{path} SHA-256 {digest} is not the one in {session}.meta.txt"
        )
    return json.loads(path.read_text(encoding="utf-8")), digest


def final_labels(goldset: dict[str, Any], revision: dict[str, Any]) -> dict[str, Any]:
    """Resolve each gold item's confirmed final label from a revision manifest."""
    task = goldset["task"]
    if revision.get("taskType") != task:
        raise RecordError(f"revision taskType {revision.get('taskType')!r} != {task!r}")
    classes = {c["id"]: c["normalizedName"] for c in revision["schema"]["classes"]}
    gold_names = {
        name
        for gold in goldset["items"]
        for name in (
            [gold["label"]]
            if task == "classification"
            else [box["class"] for box in gold["boxes"]]
        )
    }
    # A gold name absent from the schema would score both sessions 0 and pass.
    if not gold_names <= set(classes.values()):
        raise RecordError("a gold class name is not a revision schema normalizedName")
    labels: dict[str, Any] = {}
    for gold in goldset["items"]:
        matches = [
            item
            for item in revision["items"]
            if item["imageSha256"] == gold["image_sha256"]
        ]
        if len(matches) != 1 or matches[0]["disposition"] == "excluded":
            raise RecordError(
                f"gold item {gold['item_id']} needs exactly one non-excluded "
                f"revision item, found {len(matches)}"
            )
        annotation = matches[0]["annotation"]
        if annotation.get("kind") != task:
            raise RecordError(f"gold item {gold['item_id']} annotation is not {task}")
        if task == "classification":
            class_id = annotation["classId"]
            if class_id is not None and class_id not in classes:
                raise RecordError(f"gold item {gold['item_id']} has an unknown class")
            labels[gold["item_id"]] = None if class_id is None else classes[class_id]
        else:
            boxes = []
            for rect in annotation["rectangles"]:
                if rect["classId"] not in classes:
                    raise RecordError(
                        f"gold item {gold['item_id']} has an unknown class"
                    )
                boxes.append(
                    {
                        "bbox": [rect["x"], rect["y"], rect["width"], rect["height"]],
                        "class": classes[rect["classId"]],
                    }
                )
            labels[gold["item_id"]] = boxes
    return labels


def accuracy(
    goldset: dict[str, Any], labels: dict[str, Any], label: str | None = None
) -> Fraction:
    items = [g for g in goldset["items"] if label is None or g["label"] == label]
    return Fraction(sum(labels[g["item_id"]] == g["label"] for g in items), len(items))


def iou(a: list[float], b: list[float]) -> float:
    width = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
    height = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    if width <= 0 or height <= 0:
        return 0.0
    inter = width * height
    return inter / (a[2] * a[3] + b[2] * b[3] - inter)


def detection_f1(goldset: dict[str, Any], labels: dict[str, Any]) -> Fraction:
    tp = fp = fn = 0
    for gold in goldset["items"]:
        truth = gold["boxes"]
        found = labels[gold["item_id"]]
        pairs = sorted(
            (
                (iou(t["bbox"], f["bbox"]), ti, fi)
                for ti, t in enumerate(truth)
                for fi, f in enumerate(found)
                if t["class"] == f["class"]
            ),
            reverse=True,
        )
        used_t: set[int] = set()
        used_f: set[int] = set()
        for value, ti, fi in pairs:
            if value < DETECTION_IOU:
                break
            if ti not in used_t and fi not in used_f:
                used_t.add(ti)
                used_f.add(fi)
        tp += len(used_t)
        fn += len(truth) - len(used_t)
        fp += len(found) - len(used_f)
    return Fraction(2 * tp, 2 * tp + fp + fn) if tp + fp + fn else Fraction(1)


def judge(
    goldset: dict[str, Any],
    assisted_records: list[dict[str, Any]],
    manual_records: list[dict[str, Any]],
    assisted_labels: dict[str, Any],
    manual_labels: dict[str, Any],
) -> dict[str, Any]:
    checks: dict[str, bool] = {}
    quality: dict[str, Any] = {}
    if goldset["task"] == "classification":
        qa, qm = accuracy(goldset, assisted_labels), accuracy(goldset, manual_labels)
        checks["quality_noninferior"] = qa >= qm - CLASSIFICATION_DELTA
        for label in sorted({g["label"] for g in goldset["items"]}):
            qa_c = accuracy(goldset, assisted_labels, label)
            qm_c = accuracy(goldset, manual_labels, label)
            checks[f"quality_noninferior[{label}]"] = (
                qa_c >= qm_c - CLASSIFICATION_CLASS_DELTA
            )
            quality[label] = {"assisted": str(qa_c), "manual_only": str(qm_c)}
        metric = "accuracy"
    else:
        qa, qm = (
            detection_f1(goldset, assisted_labels),
            detection_f1(goldset, manual_labels),
        )
        checks["quality_noninferior"] = qa >= qm - DETECTION_DELTA
        metric = "f1@iou0.5"
    proposed = sum(record["proposed"] for record in assisted_records)
    checks["assisted_coverage"] = (
        Fraction(proposed, len(assisted_records)) >= MIN_COVERAGE
    )
    median_a = statistics.median(float(r["seconds"]) for r in assisted_records)
    median_m = statistics.median(float(r["seconds"]) for r in manual_records)
    checks["median_seconds_shorter"] = median_a < median_m
    return {
        "verdict": "PASS" if all(checks.values()) else "FAIL",
        "checks": checks,
        "quality": {
            "metric": metric,
            "assisted": str(qa),
            "manual_only": str(qm),
            "per_class": quality,
        },
        "median_seconds": {"assisted": median_a, "manual_only": median_m},
    }


def self_test() -> tuple[list[str], list[str]]:
    """Verify the arithmetic only. This is not a quality baseline."""
    failures: list[str] = []
    cases: list[str] = []
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
        failures.append("a repeated item_id was accepted")
    except RecordError:
        pass

    # Classification: 60 items, 20 per class; the manual-only session is all correct.
    names = ("p", "q", "r")
    cls_gold = {
        "task": "classification",
        "expected_item_count": 60,
        "items": [
            {"item_id": f"i{n}", "image_sha256": f"{n:064x}", "label": names[n // 20]}
            for n in range(60)
        ],
    }
    manual_cls = {g["item_id"]: g["label"] for g in cls_gold["items"]}
    records = [
        {"item_id": g["item_id"], "proposed": True, "outcome": "accept", "seconds": 1.0}
        for g in cls_gold["items"]
    ]
    slower = [dict(r, seconds=2.0) for r in records]
    one_wrong = dict(manual_cls, i0="q")
    two_wrong = dict(one_wrong, i20="p")
    # Manual misses one q and one r item; assisted misses two p items: overall
    # 58/60 vs 58/60 passes, so only the per-class 1/20 bound can fail it.
    manual_two_wrong = dict(manual_cls, i20="p", i40="p")
    same_class_two_wrong = dict(one_wrong, i1="q")
    if (
        judge(cls_gold, records, slower, one_wrong, manual_cls)["verdict"] != "PASS"
        or judge(cls_gold, records, slower, two_wrong, manual_cls)["verdict"] != "FAIL"
        or judge(cls_gold, records, slower, same_class_two_wrong, manual_two_wrong)[
            "checks"
        ]
        != {
            "quality_noninferior": True,
            "quality_noninferior[p]": False,
            "quality_noninferior[q]": True,
            "quality_noninferior[r]": True,
            "assisted_coverage": True,
            "median_seconds_shorter": True,
        }
    ):
        failures.append("classification delta 1/60 or per-class 1/20 boundary is wrong")
    # Detection: 201 gold boxes; 199 found and 0 extra gives F1 = 398/400 = 1 - 0.005.
    boxes = [{"bbox": [10.0 * n, 0.0, 5.0, 5.0], "class": "w"} for n in range(201)]
    det_gold = {
        "task": "detection",
        "expected_item_count": 1,
        "items": [{"item_id": "d", "image_sha256": "0" * 64, "boxes": boxes}],
    }
    det_records = [
        {"item_id": "d", "proposed": True, "outcome": "edit", "seconds": 1.0}
    ]
    det_slower = [dict(det_records[0], seconds=2.0)]
    exact = {"d": boxes}
    if (
        judge(det_gold, det_records, det_slower, {"d": boxes[:199]}, exact)["verdict"]
        != "PASS"
        or judge(det_gold, det_records, det_slower, {"d": boxes[:198]}, exact)[
            "verdict"
        ]
        != "FAIL"
        or detection_f1(det_gold, {"d": [dict(b, **{"class": "x"}) for b in boxes]})
        != 0
        or detection_f1(
            det_gold, {"d": [{"bbox": [0.0, 0.0, 5.0, 10.0], "class": "w"}]}
        )
        != Fraction(2, 202)
    ):
        failures.append("detection delta 0.005 boundary or IoU 0.5 matching is wrong")
    else:
        cases.append("quality-noninferiority-boundary")

    same_median = judge(cls_gold, records, records, manual_cls, manual_cls)
    faster = judge(cls_gold, records, slower, manual_cls, manual_cls)
    if same_median["checks"]["median_seconds_shorter"] or faster["verdict"] != "PASS":
        failures.append("equal medians must fail and a shorter median must pass")
    else:
        cases.append("median-boundary")

    half = [
        dict(r, proposed=n % 2 == 0, outcome="accept" if n % 2 == 0 else "manual")
        for n, r in enumerate(records)
    ]
    below = [
        dict(r, proposed=n < 29, outcome="accept" if n < 29 else "manual")
        for n, r in enumerate(records)
    ]
    if (
        judge(cls_gold, half, slower, manual_cls, manual_cls)["verdict"] != "PASS"
        or judge(cls_gold, below, slower, manual_cls, manual_cls)["verdict"] != "FAIL"
    ):
        failures.append("assisted coverage 0.5 boundary is wrong")
    else:
        cases.append("coverage-boundary")

    with tempfile.TemporaryDirectory() as tmp:
        record = Path(tmp) / "record.md"
        record.write_bytes(b"candidate")
        good = hashlib.sha256(b"candidate").hexdigest()
        if (
            check_candidate(record, good)
            or not check_candidate(record, "0" * 64)
            or not check_candidate(None, good)
            or not check_candidate(Path(tmp) / "missing.md", good)
        ):
            failures.append("candidate record SHA-256 check is wrong")
        else:
            cases.append("candidate-sha256-mismatch")

    rejected = 0
    for session in (records[1:], records + [dict(records[0], item_id="extra")]):
        try:
            check_session_ids(cls_gold, session)
        except RecordError:
            rejected += 1
    if rejected != 2:
        failures.append(
            "a session whose item ids differ from the gold set was accepted"
        )
    else:
        cases.append("goldset-session-id-mismatch")

    classes = [{"id": "c-p", "normalizedName": "p"}]
    one = {
        "task": "classification",
        "expected_item_count": 1,
        "items": [{"item_id": "i0", "image_sha256": "a" * 64, "label": "p"}],
    }
    item = {
        "imageSha256": "a" * 64,
        "disposition": "labeled",
        "annotation": {"kind": "classification", "classId": "c-p"},
    }
    revision = {
        "taskType": "classification",
        "schema": {"classes": classes},
        "items": [item],
    }
    if final_labels(one, revision) != {"i0": "p"}:
        failures.append("a valid revision item was not resolved to its class name")
    invalid = (
        dict(revision, taskType="detection"),
        dict(revision, items=[]),
        dict(revision, items=[item, item]),
        dict(revision, items=[dict(item, disposition="excluded")]),
        dict(
            revision,
            items=[dict(item, annotation={"kind": "classification", "classId": "zz"})],
        ),
        dict(revision, schema={"classes": [{"id": "c-p", "normalizedName": "P"}]}),
    )
    accepted = 0
    for bad_revision in invalid:
        try:
            final_labels(one, bad_revision)
            accepted += 1
        except RecordError:
            pass
    if accepted:
        failures.append(f"{accepted} invalid revision(s) were accepted")
    else:
        cases.append("revision-item-invalid")

    try:
        parse_goldset(cls_gold)
    except RecordError:
        failures.append("a gold set with the approved item count was rejected")
    try:
        parse_goldset(one)
        failures.append("a self-consistent truncated gold set was accepted")
    except RecordError:
        cases.append("goldset-count-fixed")
    return failures, cases


def main() -> int:
    parser = argparse.ArgumentParser(description="SPI-17 assist quality baseline")
    parser.add_argument(
        "--candidate-record", type=Path, help="adoption record of the candidate"
    )
    parser.add_argument(
        "--candidate-sha256", help="expected SHA-256 of the adoption record"
    )
    parser.add_argument("--goldset", type=Path, help="owner-approved gold set manifest")
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
        "--assisted-revision",
        type=Path,
        help="Dataset Revision manifest after the assisted session",
    )
    parser.add_argument(
        "--manual-revision",
        type=Path,
        help="Dataset Revision manifest after the manual-only session",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="verify the arithmetic only; does not produce a baseline",
    )
    args = parser.parse_args()

    if args.self_test:
        failures, cases = self_test()
        json.dump(
            {
                "task": "SPI-17 / G2-07 assist quality baseline",
                "mode": "self-test",
                "verdict": "FAIL" if failures else "PASS",
                "failures": failures,
                "cases": cases,
                "note": "arithmetic only; not an assist quality baseline",
            },
            sys.stdout,
            ensure_ascii=False,
            indent=2,
        )
        sys.stdout.write("\n")
        return 1 if failures else 0

    blockers = check_candidate(args.candidate_record, args.candidate_sha256)
    if blockers:
        json.dump(
            {
                "task": "SPI-17 / G2-07 assist quality baseline",
                "mode": "baseline",
                "verdict": "BLOCKED",
                "measured": None,
                "blockers": blockers,
                "reason": (
                    "No adoption candidate record with a matching SHA-256 was "
                    "given, so no assisted session can be attributed to a "
                    "candidate and nothing is measured."
                ),
            },
            sys.stdout,
            ensure_ascii=False,
            indent=2,
        )
        sys.stdout.write("\n")
        return 2

    required = (
        "goldset",
        "assisted_session",
        "manual_session",
        "assisted_revision",
        "manual_revision",
    )
    missing = [name for name in required if getattr(args, name) is None]
    if missing:
        parser.error(
            "missing: " + ", ".join("--" + name.replace("_", "-") for name in missing)
        )

    goldset = parse_goldset(json.loads(args.goldset.read_text(encoding="utf-8")))
    assisted_records = load_session(args.assisted_session)
    manual_records = load_session(args.manual_session)
    check_session_ids(goldset, assisted_records)
    check_session_ids(goldset, manual_records)
    assisted_revision, assisted_revision_sha = load_revision(
        args.assisted_revision, args.assisted_session
    )
    manual_revision, manual_revision_sha = load_revision(
        args.manual_revision, args.manual_session
    )
    result = judge(
        goldset,
        assisted_records,
        manual_records,
        final_labels(goldset, assisted_revision),
        final_labels(goldset, manual_revision),
    )
    json.dump(
        {
            "task": "SPI-17 / G2-07 assist quality baseline",
            "mode": "baseline",
            "gold_task": goldset["task"],
            **result,
            "environment": {
                "python": platform.python_version(),
                "platform": platform.platform(),
            },
            "assisted": summarise(assisted_records),
            "manual_only": summarise(manual_records),
            "session_sha256": {
                "assisted": sha256_file(args.assisted_session),
                "manual_only": sha256_file(args.manual_session),
            },
            "revision_sha256": {
                "assisted": assisted_revision_sha,
                "manual_only": manual_revision_sha,
            },
            "goldset_sha256": sha256_file(args.goldset),
            "candidate_sha256": sha256_file(args.candidate_record),
        },
        sys.stdout,
        ensure_ascii=False,
        indent=2,
    )
    sys.stdout.write("\n")
    return 0 if result["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
