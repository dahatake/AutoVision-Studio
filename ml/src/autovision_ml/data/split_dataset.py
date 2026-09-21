"""Deterministic dataset splitting for finalized revision items.

Pure data operation only: no filesystem access, no training scheduler and no
mutation. Identical image hashes are always assigned to the same split.
"""

from __future__ import annotations

import hashlib
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Literal, TypedDict

type SplitName = Literal["train", "validation", "test"]


class SplitItem(TypedDict):
    id: str
    imageSha256: str
    classId: str | None


@dataclass(frozen=True, slots=True)
class SplitAssignment:
    item_id: str
    split: SplitName


def _score(seed: int, key: str) -> int:
    digest = hashlib.sha256(f"{seed}:{key}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def _split_for_score(score: int) -> SplitName:
    bucket = score % 100
    if bucket < 80:
        return "train"
    if bucket < 90:
        return "validation"
    return "test"


def _validate_item(item: SplitItem) -> None:
    if (
        type(item.get("id")) is not str
        or type(item.get("imageSha256")) is not str
        or len(item["imageSha256"]) != 64
        or any(char not in "0123456789abcdef" for char in item["imageSha256"])
        or not (item.get("classId") is None or type(item.get("classId")) is str)
    ):
        raise ValueError("Invalid split item")


def split_dataset(
    items: Iterable[SplitItem],
    *,
    seed: int,
    task_type: Literal["classification", "detection"],
) -> tuple[SplitAssignment, ...]:
    """Return deterministic split assignments.

    Classification groups are processed per class to keep each class distributed
    as evenly as possible while preserving hash exclusivity. Detection uses the
    same hash-group assignment without class stratification.
    """

    if not 0 <= seed <= 9_007_199_254_740_991:
        raise ValueError("Invalid split seed")
    rows = list(items)
    for item in rows:
        _validate_item(item)
    if len({item["id"] for item in rows}) != len(rows):
        raise ValueError("Duplicate split item")
    if task_type == "classification" and any(item["classId"] is None for item in rows):
        raise ValueError("Classification split requires classId")
    groups: dict[str, list[SplitItem]] = defaultdict(list)
    for item in rows:
        groups[item["imageSha256"]].append(item)

    split_by_hash: dict[str, SplitName] = {}
    if task_type == "classification":
      by_class: dict[str, list[str]] = defaultdict(list)
      for image_hash, group in groups.items():
          class_ids = {item["classId"] for item in group}
          if len(class_ids) != 1:
              raise ValueError("Hash group crosses classes")
          by_class[next(iter(class_ids)) or ""].append(image_hash)
      for class_id, hashes in by_class.items():
          del class_id
          ordered = sorted(hashes, key=lambda value: (_score(seed, value), value))
          for index, image_hash in enumerate(ordered):
              bucket = index * 100 // len(ordered)
              split_by_hash[image_hash] = (
                  "train" if bucket < 80 else "validation" if bucket < 90 else "test"
              )
    else:
        for image_hash in groups:
            split_by_hash[image_hash] = _split_for_score(_score(seed, image_hash))

    assignments = [
        SplitAssignment(item_id=item["id"], split=split_by_hash[item["imageSha256"]])
        for item in rows
    ]
    return tuple(sorted(assignments, key=lambda assignment: assignment.item_id))


def assert_hash_exclusive(assignments: Iterable[SplitAssignment], hashes_by_id: Mapping[str, str]) -> None:
    seen: dict[str, SplitName] = {}
    for assignment in assignments:
        image_hash = hashes_by_id[assignment.item_id]
        previous = seen.setdefault(image_hash, assignment.split)
        if previous != assignment.split:
            raise ValueError("Image hash crosses splits")
