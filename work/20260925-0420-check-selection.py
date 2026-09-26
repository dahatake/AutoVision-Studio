"""G2Q-03C / 03D の出力 JSON から、閾値の選び方（work/20260925-0420-G2Q03-ExecutionPlan.md §1）を再計算する。

使い方: python work/20260925-0420-check-selection.py <出力 JSON>。合っていれば exit 0。
"""

import json
import math
import sys

PAIRS = [
    "torch vs onnxruntime-cpu",
    "torch vs onnxruntime-directml",
    "onnxruntime-cpu vs onnxruntime-directml",
]

d = json.load(open(sys.argv[1], encoding="utf-8"))
s = d["threshold_selection"]
c = s["candidates"]
scores = [x["score"] for x in c]
feasible = [x for x in c if x["coverage"] >= 0.5]
names = sorted(x.get("comparison") for x in d["comparisons"])
def ratio(v):
    return isinstance(v, float | int) and math.isfinite(v) and 0 <= v <= 1


ok = (
    scores == sorted(set(scores), reverse=True)
    and all(ratio(v) for v in scores + [x["coverage"] for x in c])
    and ratio(d["confidenceThreshold"])
    and bool(feasible)
    and all(x["metric"] is not None and ratio(x["metric"]) for x in feasible)
    and all(x["metric"] is None for x in c if x["coverage"] < 0.5)
    and names == sorted(PAIRS)
    and all(x["verdict"] == "PASS" for x in d["comparisons"])
)
if ok:
    best = max(feasible, key=lambda x: (x["metric"], x["coverage"], -x["score"]))
    i = scores.index(best["score"])
    lower = scores[i + 1] if i + 1 < len(scores) else 0.0
    t = d["confidenceThreshold"]
    ok = (
        s["selected_score"] == best["score"]
        and t == (best["score"] + lower) / 2
        and lower < t <= best["score"]
        and d.get("compared_detections", 1) >= 1
    )
sys.exit(0 if ok else 1)
