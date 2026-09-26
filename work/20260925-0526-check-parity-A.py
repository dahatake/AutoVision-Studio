"""G2Q-03D の出力 JSON の集計値を、所有者の判断 G2Q-03D-T の判定 A1〜A3 で検査する。

判定の定義: docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03D-parity.md。
JSON に書かれた集計値の検査であり、TP や IoU の対応付けそのものは再計算しない
（work/20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md §5.2）。
使い方: python work/20260925-0526-check-parity-A.py <出力 JSON>。合っていれば exit 0。
"""

import json
import math
import sys
from pathlib import Path

PAIRS = {
    "torch vs onnxruntime-cpu",
    "torch vs onnxruntime-directml",
    "onnxruntime-cpu vs onnxruntime-directml",
}
BACKENDS = {"torch", "onnxruntime-cpu", "onnxruntime-directml"}

d = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
comparisons = d["comparisons"]
f1 = d["f1_by_backend"]
at = d["threshold_selection"]["at_threshold"]


def a1_a2(c):
    counts = c["per_image_detections"]
    total = sum(left for left, _ in counts)
    return (
        c["failures"] == []
        and len(counts) == d["goldset"]["items"] > 0
        and total == sum(right for _, right in counts) == d["compared_detections"]
        and c["raw_outputs"]["logits"]["within_rtol_atol"] is True
        and c["raw_outputs"]["pred_boxes"]["within_rtol_atol"] is True
        and all(left == right for left, right in counts)
        and c["iou_matched_detections"] == total
        and c["left_only_detections"] == 0
        and c["right_only_detections"] == 0
        and c["label_mismatches"] == 0
        and 0 <= c["max_abs_score_diff"] <= 1.0e-4
    )


def f1_ok(v):
    x = v["f1"]
    return (
        isinstance(x, float | int)
        and math.isfinite(x)
        and 0 <= x <= 1
        and math.isclose(
            x, 2 * v["true_positives"] / (v["proposals"] + v["gold_boxes"])
        )
        and v["gold_boxes"] == at["gold_boxes"]
    )


ok = (
    d["verdict"] == "PASS"
    and d["failures"] == []
    and {c["comparison"] for c in comparisons} == PAIRS
    and len(comparisons) == 3
    and all(c["verdict"] == "PASS" and a1_a2(c) for c in comparisons)
    and set(f1) == BACKENDS
    and all(f1_ok(v) for v in f1.values())
    and f1["torch"]["true_positives"] == at["true_positives"]
    and f1["torch"]["proposals"] == at["proposals"]
    and all(
        abs(f1[k]["f1"] - f1["torch"]["f1"]) <= 0.005
        for k in ("onnxruntime-cpu", "onnxruntime-directml")
    )
)
print("parity A:", "OK" if ok else "NG", {k: v["f1"] for k, v in f1.items()})
sys.exit(0 if ok else 1)
