from __future__ import annotations

from autovision_ml.data.split_dataset import (
    SplitItem,
    assert_hash_exclusive,
    split_dataset,
)


def _hash(index: int) -> str:
    return f"{index:064x}"


def _item(item_id: str, image_hash: str, class_id: str | None) -> SplitItem:
    return {"id": item_id, "imageSha256": image_hash, "classId": class_id}


def test_classification_split_is_seeded_stratified_and_hash_exclusive() -> None:
    items: list[SplitItem] = [
        _item(f"cat-{index}", _hash(index), "cat")
        for index in range(10)
    ] + [
        _item(f"dog-{index}", _hash(100 + index), "dog")
        for index in range(10)
    ]
    assignments = split_dataset(items, seed=7, task_type="classification")
    by_id = {assignment.item_id: assignment.split for assignment in assignments}

    assert {by_id[f"cat-{index}"] for index in range(10)} == {"train", "validation", "test"}
    assert {by_id[f"dog-{index}"] for index in range(10)} == {"train", "validation", "test"}
    assert assignments == split_dataset(items, seed=7, task_type="classification")
    assert_hash_exclusive(assignments, {item["id"]: item["imageSha256"] for item in items})


def test_duplicate_hashes_never_cross_splits() -> None:
    items: list[SplitItem] = [
        _item("a", _hash(1), "cat"),
        _item("b", _hash(1), "cat"),
        _item("c", _hash(2), "cat"),
    ]
    assignments = split_dataset(items, seed=3, task_type="classification")
    by_id = {assignment.item_id: assignment.split for assignment in assignments}

    assert by_id["a"] == by_id["b"]
    assert_hash_exclusive(assignments, {item["id"]: item["imageSha256"] for item in items})
