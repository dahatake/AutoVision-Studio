"""C7D-02: backend parity and inference performance of the C7 detection assist model.

Model: Hugging Face ``google/owlvit-base-patch32`` revision
``cbc355fb364588351c5d51c7f74465e8e7ec6f72`` (``model.safetensors`` plus the
processor / tokenizer files of the same revision), read from
``vendor/models/_spike/owlvit-b32`` (git-ignored). The payload hashes are
recorded in ``work/20260923-1520-OWLViT-ControlledArtifact.md``.

fail-closed boundaries kept by this probe:

* ``model.safetensors`` must match the publisher LFS SHA-256.
* ``local_files_only=True`` and ``use_safetensors=True``; transformers' own
  ``OwlViTForObjectDetection`` is used and no remote code is executed.
* Tolerances are fixed before the run. Raw ``logits`` / ``pred_boxes`` must satisfy
  ``rtol <= 1e-3`` and ``atol <= 1e-4`` against PyTorch, and the post-processed
  detections must pass the SPI-12 / SPI-16 protocol reused from
  ``detection_checkpoint_parity.compare``. Either miss is ``FAIL``.
* The detection post-process (``to_detections``) is checked against the
  transformers ``post_process_object_detection`` on the PyTorch output.
* Parity uses five fixture images, not only the image used for tracing.
* The prompts name the fixture object (wheat heads, ``resources/samples/gwhd-2021``)
  plus one other text query so that labels are compared. The probe compares
  backends and makes no accuracy or quality claim.
* Measurement is evidence, not approval. The probe never edits the manifest.

G2Q-03D adds ``--mode goldset``: the 20-item detection gold set selects
``confidenceThreshold`` with policy A
(``docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03.md``; the
definition, fixed before the measurement, is
``work/20260925-0420-G2Q03-ExecutionPlan.md`` §1) with the schema boundary
``score >= threshold``, and the detection-level parity is measured at that threshold.
In goldset mode the detection-level parity uses the owner ruling G2Q-03D-T
(``docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03D-parity.md``)
instead of ``compare``: A1 raw ``logits`` / ``pred_boxes`` within ``rtol`` / ``atol``,
A2 the same detections (count, IoU >= 0.99 one-to-one, label, score tolerance), and
A3 each backend's own gold-set F1 within 0.005 of torch. The pixel box difference is
recorded but not judged. The parity mode keeps ``compare``.
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
from pathlib import Path
from typing import Any

import numpy as np
import onnx
import onnxruntime as ort
import torch
import transformers
from detection import (
    ANNOTATION_FILE,
    FIXTURE_DIR,
    REPO_ROOT,
    SCORE_FLOOR,
    SCORE_TOLERANCE,
    SEED,
    match_detections,
    sha256_file,
)
from detection import MATCH_IOU as PARITY_MATCH_IOU
from detection_checkpoint_parity import (
    CPU_PROVIDER,
    DML_PROVIDER,
    EVAL_IMAGES,
    MAX_P95_MS,
    MEASURED_PASSES,
    MIN_THROUGHPUT_FPS,
    WARMUP_PASSES,
    compare,
)
from grounding_dino_assist_parity import measure
from PIL import Image
from torch import nn
from transformers import AutoProcessor, OwlViTForObjectDetection

MODEL_DIR = REPO_ROOT / "vendor" / "models" / "_spike" / "owlvit-b32"
EXPECTED_SHA256 = "4dbe0399f0b7d7c8dddf1535a98769cc30743bebc877aea681998c8d984ce52b"
OPSET_VERSION = 17
PROMPTS = ["a photo of a wheat head", "a photo of a leaf"]
INPUT_NAMES = ["input_ids", "pixel_values", "attention_mask"]
OUTPUT_NAMES = ["logits", "pred_boxes"]
RTOL = 1.0e-3
ATOL = 1.0e-4
# Spike prompt of docs/model-governance/owlvit-base-patch32-adoption.md section 9.
GOLDSET_PROMPT = "a photo of a {label}"
COVERAGE_MIN = 0.5
MATCH_IOU = 0.5
THRESHOLD_POLICY = (
    "G2Q-03 policy A (docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03.md, "
    "definition work/20260925-0420-G2Q03-ExecutionPlan.md section 1): candidates are the "
    "torch patch box scores on the detection gold set; among candidates whose coverage "
    "(items with at least one box, score >= threshold) is >= 0.5, the largest pooled F1 "
    "(greedy 1:1 by descending IoU, IoU >= 0.5) wins, ties by larger coverage then smaller "
    "threshold; the threshold is the midpoint to the next lower candidate. "
    "Evidence: vendor/models/_spike/owlvit-goldset.json"
)
F1_TOLERANCE = 0.005
PARITY_POLICY = {
    "ruling": "docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03D-parity.md",
    "A1": f"raw logits and pred_boxes: np.allclose(rtol={RTOL}, atol={ATOL})",
    "A2": f"per-image detection count equal, one-to-one IoU >= {PARITY_MATCH_IOU} "
    f"match of every detection, 0 label mismatches, score diff <= {SCORE_TOLERANCE}",
    "A3": f"abs(F1_backend - F1_torch) <= {F1_TOLERANCE}, F1 from each backend's own "
    "boxes and scores (IoU >= 0.5, greedy 1:1 by descending IoU)",
    "pixel_box_diff": "recorded, not judged",
}


class Detector(nn.Module):
    def __init__(self, model: OwlViTForObjectDetection) -> None:
        super().__init__()
        self.model = model

    def forward(self, input_ids, pixel_values, attention_mask):
        output = self.model(
            input_ids=input_ids,
            pixel_values=pixel_values,
            attention_mask=attention_mask,
        )
        return output.logits, output.pred_boxes


def to_detections(logits: np.ndarray, boxes: np.ndarray, width: int, height: int):
    """Strict ``score > SCORE_FLOOR`` as in ``post_process_object_detection``,
    ordered by descending score."""
    xyxy, scores, labels = all_patches(logits, boxes, width, height)
    keep = scores > SCORE_FLOOR
    order = np.argsort(-scores[keep], kind="stable")
    return xyxy[keep][order], scores[keep][order], labels[keep][order]


def all_patches(logits: np.ndarray, boxes: np.ndarray, width: int, height: int):
    """Same as ``post_process_object_detection`` before its threshold: score =
    sigmoid(max over queries), ``cxcywh`` relative to the resized input scaled to
    the original image size. One entry per image patch."""
    class_logits = logits[0].max(axis=-1)
    scores = 1.0 / (1.0 + np.exp(-class_logits))
    labels = logits[0].argmax(axis=-1)
    cx, cy, w, h = boxes[0].T
    xyxy = np.stack(
        [
            (cx - w / 2) * width,
            (cy - h / 2) * height,
            (cx + w / 2) * width,
            (cy + h / 2) * height,
        ],
        axis=1,
    )
    return xyxy, scores, labels


def patch_diff(
    left: list[list[np.ndarray]],
    right: list[list[np.ndarray]],
    sizes: list[tuple],
) -> dict[str, Any]:
    """Unthresholded comparison over every patch, so parity is measured even when no
    patch reaches the score floor."""
    score_diff = box_diff = 0.0
    agree = total = 0
    for a, b, (width, height) in zip(left, right, sizes, strict=True):
        a_boxes, a_scores, a_labels = all_patches(a[0], a[1], width, height)
        b_boxes, b_scores, b_labels = all_patches(b[0], b[1], width, height)
        score_diff = max(score_diff, float(np.abs(a_scores - b_scores).max()))
        box_diff = max(box_diff, float(np.abs(a_boxes - b_boxes).max()))
        agree += int((a_labels == b_labels).sum())
        total += int(a_labels.size)
    return {
        "max_abs_score_diff": score_diff,
        "max_abs_box_diff_px": box_diff,
        "label_agreement": f"{agree}/{total}",
    }


def load_inputs(processor: Any) -> tuple[list[dict[str, np.ndarray]], list[tuple]]:
    coco = json.loads(ANNOTATION_FILE.read_text(encoding="utf-8"))
    records = sorted(coco["images"], key=lambda item: int(item["id"]))[-EVAL_IMAGES:]
    inputs, sizes = [], []
    for record in records:
        with Image.open(FIXTURE_DIR / "images" / record["file_name"]) as image:
            rgb = image.convert("RGB")
            encoded = processor(images=rgb, text=[PROMPTS], return_tensors="pt")
            sizes.append((rgb.width, rgb.height))
        inputs.append({name: encoded[name].numpy() for name in INPUT_NAMES})
    return inputs, sizes


def raw_diff(left: list[np.ndarray], right: list[np.ndarray]) -> dict[str, Any]:
    within = all(
        np.allclose(a, b, rtol=RTOL, atol=ATOL)
        for a, b in zip(left, right, strict=True)
    )
    return {
        "within_rtol_atol": within,
        "max_abs_diff": float(
            max(np.abs(a - b).max() for a, b in zip(left, right, strict=True))
        ),
    }


def environment(available: list[str]) -> dict[str, Any]:
    return {
        "python": platform.python_version(),
        "os": f"{platform.system()} {platform.version()}",
        "torch": torch.__version__,
        "transformers": transformers.__version__,
        "onnx": onnx.__version__,
        "onnxruntime": ort.__version__,
        "available_providers": available,
    }


def at_threshold(
    logits: np.ndarray, boxes: np.ndarray, width: int, height: int, threshold: float
):
    """Schema boundary ``score >= threshold``, ordered by descending score."""
    xyxy, scores, labels = all_patches(logits, boxes, width, height)
    keep = scores.astype(np.float64) >= threshold
    order = np.argsort(-scores[keep], kind="stable")
    return xyxy[keep][order], scores[keep][order], labels[keep][order]


def iou_pairs(patches: np.ndarray, gold: np.ndarray) -> list[tuple[float, int, int]]:
    """(IoU, patch, gold box) with IoU >= MATCH_IOU, by descending IoU."""
    left = np.maximum(patches[:, None, 0], gold[None, :, 0])
    top = np.maximum(patches[:, None, 1], gold[None, :, 1])
    right = np.minimum(patches[:, None, 2], gold[None, :, 2])
    bottom = np.minimum(patches[:, None, 3], gold[None, :, 3])
    inter = np.clip(right - left, 0, None) * np.clip(bottom - top, 0, None)
    area_p = (patches[:, 2] - patches[:, 0]) * (patches[:, 3] - patches[:, 1])
    area_g = (gold[:, 2] - gold[:, 0]) * (gold[:, 3] - gold[:, 1])
    iou = inter / (area_p[:, None] + area_g[None, :] - inter)
    p, g = np.nonzero(iou >= MATCH_IOU)
    return sorted(
        ((float(iou[i, j]), int(i), int(j)) for i, j in zip(p, g, strict=True)),
        key=lambda x: -x[0],
    )


def greedy_matches(pairs: list[tuple[float, int, int]], active: np.ndarray) -> int:
    used_p: set[int] = set()
    used_g: set[int] = set()
    for _, p, g in pairs:
        if active[p] and p not in used_p and g not in used_g:
            used_p.add(p)
            used_g.add(g)
    return len(used_p)


def sweep(scores: list[np.ndarray], pairs: list[list], gold_total: int) -> list[dict]:
    """Coverage and pooled F1 at every distinct score, lowering the threshold one
    candidate at a time; only items whose new boxes have an IoU pair are re-matched."""
    entries = sorted(
        (
            (float(s), item, patch)
            for item, values in enumerate(scores)
            for patch, s in enumerate(values)
        ),
        key=lambda x: -x[0],
    )
    paired = [{p for _, p, _ in item} for item in pairs]
    active = [np.zeros(len(values), dtype=bool) for values in scores]
    tp = [0] * len(scores)
    proposals = 0
    candidates = []
    index = 0
    while index < len(entries):
        score = entries[index][0]
        touched = set()
        while index < len(entries) and entries[index][0] == score:
            _, item, patch = entries[index]
            active[item][patch] = True
            proposals += 1
            if patch in paired[item]:
                touched.add(item)
            index += 1
        for item in touched:
            tp[item] = greedy_matches(pairs[item], active[item])
        coverage = sum(bool(mask.any()) for mask in active) / len(scores)
        metric = (
            2 * sum(tp) / (proposals + gold_total) if coverage >= COVERAGE_MIN else None
        )
        candidates.append({"score": score, "coverage": coverage, "metric": metric})
    return candidates


def select(candidates: list[dict]) -> tuple[Any, Any]:
    feasible = [item for item in candidates if item["metric"] is not None]
    if not feasible:
        return None, None
    best = max(
        feasible, key=lambda item: (item["metric"], item["coverage"], -item["score"])
    )
    index = candidates.index(best)
    lower = candidates[index + 1]["score"] if index + 1 < len(candidates) else 0.0
    return best["score"], (best["score"] + lower) / 2


def detection_parity(label: str, left: list, right: list) -> dict[str, Any]:
    """A2 of the owner ruling G2Q-03D-T: ``compare`` without its pixel box tolerance."""
    failures: list[str] = []
    counts = []
    matched = left_only = right_only = mismatches = 0
    box_diff = score_diff = 0.0
    for index, (a, b) in enumerate(zip(left, right, strict=True)):
        pairs, box, score, wrong = match_detections(a, b)
        n_left, n_right = int(a[1].size), int(b[1].size)
        if n_left != n_right:
            failures.append(f"{label} image {index}: {n_left} != {n_right} detections")
        counts.append((n_left, n_right))
        matched += pairs
        left_only += n_left - pairs
        right_only += n_right - pairs
        mismatches += wrong
        box_diff = max(box_diff, box)
        score_diff = max(score_diff, score)
    if left_only or right_only:
        failures.append(
            f"{label}: {left_only} left-only and {right_only} right-only detections"
        )
    if mismatches:
        failures.append(f"{label}: {mismatches} label mismatches")
    if score_diff > SCORE_TOLERANCE:
        failures.append(
            f"{label} max_abs_score_diff {score_diff:.3e} > {SCORE_TOLERANCE:.1e}"
        )
    return {
        "failures": failures,
        "per_image_detections": counts,
        "iou_matched_detections": matched,
        "left_only_detections": left_only,
        "right_only_detections": right_only,
        "label_mismatches": mismatches,
        "max_abs_score_diff": score_diff,
        "max_abs_box_diff_px_recorded": box_diff,
    }


def backend_f1(
    outputs: list, sizes: list[tuple], gold_boxes: list[np.ndarray], threshold: float
) -> dict[str, Any]:
    """Pooled gold-set F1 from one backend's own boxes and scores (A3)."""
    tp = proposals = 0
    for out, (width, height), gold in zip(outputs, sizes, gold_boxes, strict=True):
        xyxy, scores, _ = all_patches(out[0], out[1], width, height)
        active = scores.astype(np.float64) >= threshold
        tp += greedy_matches(iou_pairs(xyxy, gold), active)
        proposals += int(active.sum())
    gold_total = sum(len(gold) for gold in gold_boxes)
    return {
        "true_positives": tp,
        "proposals": proposals,
        "gold_boxes": gold_total,
        "f1": 2 * tp / (proposals + gold_total),
    }


def goldset(
    args: argparse.Namespace,
    model: OwlViTForObjectDetection,
    processor: Any,
    available: list[str],
    digest: str,
) -> int:
    path: Path = args.goldset
    gold = json.loads(path.read_text(encoding="utf-8"))
    items = gold["items"]
    if len(items) != gold["expected_item_count"]:
        raise SystemExit(f"{path}: {len(items)} items != {gold['expected_item_count']}")
    classes = sorted({box["class"] for item in items for box in item["boxes"]})
    queries = [GOLDSET_PROMPT.format(label=name.replace("_", " ")) for name in classes]
    inputs, sizes, gold_boxes = [], [], []
    for item in items:
        image_path = path.parent / item["image"]
        if sha256_file(image_path) != item["image_sha256"]:
            raise SystemExit(f"{image_path} SHA-256 != {item['image_sha256']}")
        with Image.open(image_path) as image:
            rgb = image.convert("RGB")
            encoded = processor(images=rgb, text=[queries], return_tensors="pt")
            sizes.append((rgb.width, rgb.height))
        inputs.append({name: encoded[name].numpy() for name in INPUT_NAMES})
        gold_boxes.append(
            np.array(
                [
                    [x, y, x + w, y + h]
                    for x, y, w, h in (box["bbox"] for box in item["boxes"])
                ],
                dtype=np.float64,
            )
        )

    onnx_path = args.artifact_dir / "owlvit-base-patch32-goldset.onnx"
    torch.onnx.export(
        Detector(model),
        tuple(torch.from_numpy(inputs[0][name]) for name in INPUT_NAMES),
        str(onnx_path),
        input_names=INPUT_NAMES,
        output_names=OUTPUT_NAMES,
        opset_version=OPSET_VERSION,
        dynamo=False,
    )
    onnx.checker.check_model(str(onnx_path))

    raw: dict[str, list] = {"torch": []}
    outputs = []
    with torch.no_grad():
        for feed in inputs:
            output = model(
                **{name: torch.from_numpy(feed[name]) for name in INPUT_NAMES}
            )
            outputs.append(output)
            raw["torch"].append([output.logits.numpy(), output.pred_boxes.numpy()])
    providers: dict[str, list[str]] = {}
    failures: list[str] = []
    for key, provider in (
        ("onnxruntime-cpu", CPU_PROVIDER),
        ("onnxruntime-directml", DML_PROVIDER),
    ):
        session = ort.InferenceSession(str(onnx_path), providers=[provider])
        providers[key] = session.get_providers()
        raw[key] = [session.run(OUTPUT_NAMES, feed) for feed in inputs]
        if providers[key][0] != provider:
            failures.append(
                f"{key} session providers {providers[key]} do not start with {provider}"
            )

    patches = [
        all_patches(out[0], out[1], w, h)
        for out, (w, h) in zip(raw["torch"], sizes, strict=True)
    ]
    pairs = [
        iou_pairs(xyxy, boxes)
        for (xyxy, _, _), boxes in zip(patches, gold_boxes, strict=True)
    ]
    gold_total = sum(len(boxes) for boxes in gold_boxes)
    candidates = sweep([scores for _, scores, _ in patches], pairs, gold_total)
    selected, threshold = select(candidates)

    comparisons = []
    f1_by_backend: dict[str, Any] = {}
    selection: dict[str, Any] = {}
    compared = 0
    if selected is None:
        failures.append(f"no candidate threshold reaches coverage >= {COVERAGE_MIN}")
    else:
        detections = {
            key: [
                at_threshold(out[0], out[1], w, h, threshold)
                for out, (w, h) in zip(values, sizes, strict=True)
            ]
            for key, values in raw.items()
        }
        compared = int(sum(det[1].size for det in detections["torch"]))
        if compared == 0:
            failures.append("torch has no detection at confidenceThreshold")
        for output, det, (width, height) in zip(
            outputs, detections["torch"], sizes, strict=True
        ):
            expected = processor.image_processor.post_process_object_detection(
                output, threshold=threshold, target_sizes=[(height, width)]
            )[0]
            order = torch.argsort(-expected["scores"], stable=True)
            if not (
                det[1].shape[0] == order.shape[0]
                and np.allclose(det[0], expected["boxes"][order].numpy())
                and np.allclose(det[1], expected["scores"][order].numpy())
            ):
                failures.append(
                    "at_threshold differs from post_process_object_detection"
                )
                break
        for left, right in (
            ("torch", "onnxruntime-cpu"),
            ("torch", "onnxruntime-directml"),
            ("onnxruntime-cpu", "onnxruntime-directml"),
        ):
            label = f"{left} vs {right}"
            item = detection_parity(label, detections[left], detections[right])
            numeric = {
                name: raw_diff(
                    [out[index] for out in raw[left]],
                    [out[index] for out in raw[right]],
                )
                for index, name in enumerate(OUTPUT_NAMES)
            }
            item_failures = item.pop("failures")
            item_failures += [
                f"{label} raw {name} exceeds rtol {RTOL:.0e} / atol {ATOL:.0e} "
                f"(max_abs_diff {diff['max_abs_diff']:.3e})"
                for name, diff in numeric.items()
                if not diff["within_rtol_atol"]
            ]
            failures += item_failures
            comparisons.append(
                {
                    **item,
                    "comparison": label,
                    "verdict": "FAIL" if item_failures else "PASS",
                    "failures": item_failures,
                    "raw_outputs": numeric,
                }
            )
        f1_by_backend = {
            key: backend_f1(values, sizes, gold_boxes, threshold)
            for key, values in raw.items()
        }
        for key in ("onnxruntime-cpu", "onnxruntime-directml"):
            delta = abs(f1_by_backend[key]["f1"] - f1_by_backend["torch"]["f1"])
            if delta > F1_TOLERANCE:
                failures.append(f"{key} |F1 - F1_torch| {delta:.4f} > {F1_TOLERANCE}")
        active = [scores.astype(np.float64) >= threshold for _, scores, _ in patches]
        tp = sum(greedy_matches(p, mask) for p, mask in zip(pairs, active, strict=True))
        proposals = int(sum(mask.sum() for mask in active))
        selection = {
            "items_with_boxes": int(sum(mask.any() for mask in active)),
            "proposals": proposals,
            "gold_boxes": gold_total,
            "true_positives": tp,
            "precision": tp / proposals,
            "recall": tp / gold_total,
            "f1": 2 * tp / (proposals + gold_total),
        }

    result = {
        "task": "G2Q-03D C7 detection assist goldset",
        "verdict": "FAIL" if failures else "PASS",
        "failures": failures,
        "environment": environment(available),
        "model": {
            "directory": MODEL_DIR.relative_to(REPO_ROOT).as_posix(),
            "safetensors_sha256": digest,
        },
        "goldset": {
            "path": path.resolve().relative_to(REPO_ROOT).as_posix(),
            "items": len(items),
            "classes": classes,
            "original_sizes_wh": sizes,
        },
        "goldset_sha256": sha256_file(path),
        "onnx_sha256": sha256_file(onnx_path),
        "export": {
            "opset": OPSET_VERSION,
            "exporter": "torch.onnx.export(dynamo=False)",
            "input_shapes": {name: list(inputs[0][name].shape) for name in INPUT_NAMES},
            "onnx_bytes": onnx_path.stat().st_size,
        },
        "prompt_rule": f'"{GOLDSET_PROMPT}" with {{label}} = the class name with "_" replaced by a space',
        "prompts": dict(zip(classes, queries, strict=True)),
        "seeds": {"torch": SEED},
        "confidenceThreshold": threshold,
        "thresholdPolicy": THRESHOLD_POLICY,
        "threshold_boundary": {
            "schema": "score >= threshold (manifest.schema.json confidenceThreshold)",
            "transformers_post_process_object_detection": "score > threshold",
            "decision": "the product post-process keeps score >= threshold (at_threshold); "
            "transformers' strict > is not used as the boundary",
        },
        "compared_detections": compared,
        "threshold_selection": {
            "boundary": "score >= threshold",
            "coverage_min": COVERAGE_MIN,
            "metric": "pooled F1 over all items, greedy 1:1 by descending IoU, IoU >= 0.5",
            "selected_score": selected,
            "at_threshold": selection,
            "candidates": candidates,
        },
        "session_providers": providers,
        "tolerances": {
            "raw_rtol": RTOL,
            "raw_atol": ATOL,
            "detections": "parity_policy A2 (IoU match, score tolerance; pixel box "
            "difference recorded only)",
            "f1": F1_TOLERANCE,
        },
        "parity_policy": PARITY_POLICY,
        "f1_by_backend": f1_by_backend,
        "comparisons": comparisons,
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(
        f"verdict {result['verdict']} confidenceThreshold {threshold} compared {compared} failures {failures}"
    )
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="C7D-02 / G2Q-03D OWL-ViT B/32 assist probe"
    )
    parser.add_argument(
        "--mode", choices=("parity", "performance", "goldset"), default="parity"
    )
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--goldset", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.mode == "goldset" and (args.goldset is None or args.output is None):
        parser.error("--mode goldset needs --goldset and --output")
    artifact_dir: Path = args.artifact_dir
    artifact_dir.mkdir(parents=True, exist_ok=True)

    available = ort.get_available_providers()
    if DML_PROVIDER not in available:
        raise SystemExit(f"{DML_PROVIDER} is not available ({available})")
    digest = sha256_file(MODEL_DIR / "model.safetensors")
    if digest != EXPECTED_SHA256:
        raise SystemExit(f"model.safetensors SHA-256 {digest} != {EXPECTED_SHA256}")

    torch.manual_seed(SEED)
    torch.set_num_threads(1)
    model = OwlViTForObjectDetection.from_pretrained(
        MODEL_DIR, local_files_only=True, use_safetensors=True
    ).eval()
    processor = AutoProcessor.from_pretrained(MODEL_DIR, local_files_only=True)
    if args.mode == "goldset":
        return goldset(args, model, processor, available, digest)
    inputs, sizes = load_inputs(processor)
    shapes = {name: list(inputs[0][name].shape) for name in INPUT_NAMES}

    detector = Detector(model)
    onnx_path = artifact_dir / "owlvit-base-patch32.onnx"
    torch.onnx.export(
        detector,
        tuple(torch.from_numpy(inputs[0][name]) for name in INPUT_NAMES),
        str(onnx_path),
        input_names=INPUT_NAMES,
        output_names=OUTPUT_NAMES,
        opset_version=OPSET_VERSION,
        dynamo=False,
    )
    onnx.checker.check_model(str(onnx_path))

    result: dict[str, Any] = {
        "task": f"C7D-02 C7 detection assist {args.mode}",
        "environment": environment(available),
        "model": {
            "directory": MODEL_DIR.relative_to(REPO_ROOT).as_posix(),
            "safetensors_sha256": digest,
            "loaded_with": "OwlViTForObjectDetection.from_pretrained(local_files_only, use_safetensors)",
            "processor": type(processor).__name__,
            "image_processor": type(processor.image_processor).__name__,
        },
        "export": {
            "opset": OPSET_VERSION,
            "exporter": "torch.onnx.export(dynamo=False)",
            "input_shapes": shapes,
            "onnx_bytes": onnx_path.stat().st_size,
            "onnx_sha256": sha256_file(onnx_path),
        },
        "fixture": {
            "directory": "resources/samples/gwhd-2021",
            "eval_images": len(inputs),
            "original_sizes_wh": sizes,
            "prompts": PROMPTS,
        },
    }

    if args.mode == "performance":
        providers = [
            measure(onnx_path, CPU_PROVIDER, inputs),
            measure(onnx_path, DML_PROVIDER, inputs),
        ]
        for item in providers:
            item["meets_p95_and_fps"] = (
                item["p95_ms"] <= MAX_P95_MS
                and item["throughput_fps"] >= MIN_THROUGHPUT_FPS
            )
        failures = [
            f"{item['provider']} p95 {item['p95_ms']} ms / {item['throughput_fps']} FPS "
            f"misses p95 <= {MAX_P95_MS} ms and >= {MIN_THROUGHPUT_FPS} FPS"
            for item in providers
            if not item["meets_p95_and_fps"]
        ]
        failures += [
            f"{item['provider']} session providers {item['session_providers']} "
            f"do not start with {item['provider']}"
            for item in providers
            if item["session_providers"][0] != item["provider"]
        ]
        result["verdict"] = "FAIL" if failures else "PASS"
        result["failures"] = failures
        result["measurement"] = {
            "warmup_passes": WARMUP_PASSES,
            "measured_passes": MEASURED_PASSES,
            "percentile_method": "nearest-rank",
            "per_image_path": "whole detector graph (text and vision towers) per image",
            "criteria": {"max_p95_ms": MAX_P95_MS, "min_fps": MIN_THROUGHPUT_FPS},
            "memory_note": "cumulative process peak working set; includes the resident eager model",
        }
        result["providers"] = providers
        json.dump(result, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 1 if failures else 0

    raw: dict[str, list[list[np.ndarray]]] = {"torch": []}
    reference_failures: list[str] = []
    with torch.no_grad():
        for feed, (width, height) in zip(inputs, sizes, strict=True):
            output = model(
                **{name: torch.from_numpy(feed[name]) for name in INPUT_NAMES}
            )
            raw["torch"].append([output.logits.numpy(), output.pred_boxes.numpy()])
            expected = processor.image_processor.post_process_object_detection(
                output, threshold=SCORE_FLOOR, target_sizes=[(height, width)]
            )[0]
            ours = to_detections(*raw["torch"][-1], width, height)
            order = torch.argsort(-expected["scores"], stable=True)
            if not (
                ours[1].shape[0] == order.shape[0]
                and np.allclose(ours[0], expected["boxes"][order].numpy())
                and np.allclose(ours[1], expected["scores"][order].numpy())
                and np.array_equal(ours[2], expected["labels"][order].numpy())
            ):
                reference_failures.append(
                    "to_detections differs from post_process_object_detection"
                )

    providers: dict[str, list[str]] = {}
    repeat: dict[str, bool] = {}
    for key, provider in (
        ("onnxruntime-cpu", CPU_PROVIDER),
        ("onnxruntime-directml", DML_PROVIDER),
    ):
        session = ort.InferenceSession(str(onnx_path), providers=[provider])
        providers[key] = session.get_providers()
        raw[key] = [session.run(OUTPUT_NAMES, feed) for feed in inputs]
        again = [session.run(OUTPUT_NAMES, feed) for feed in inputs]
        repeat[key] = all(
            np.array_equal(a, b)
            for left, right in zip(raw[key], again, strict=True)
            for a, b in zip(left, right, strict=True)
        )

    detections = {
        key: [
            to_detections(out[0], out[1], width, height)
            for out, (width, height) in zip(outputs, sizes, strict=True)
        ]
        for key, outputs in raw.items()
    }
    failures = list(reference_failures)
    comparisons = []
    for left, right in (
        ("torch", "onnxruntime-cpu"),
        ("torch", "onnxruntime-directml"),
        ("onnxruntime-cpu", "onnxruntime-directml"),
    ):
        label = f"{left} vs {right}"
        item = compare(label, detections[left], detections[right])
        numeric = {
            name: raw_diff(
                [out[index] for out in raw[left]], [out[index] for out in raw[right]]
            )
            for index, name in enumerate(OUTPUT_NAMES)
        }
        item_failures = list(item["failures"])
        item_failures += [
            f"{label} raw {name} exceeds rtol {RTOL:.0e} / atol {ATOL:.0e} "
            f"(max_abs_diff {diff['max_abs_diff']:.3e})"
            for name, diff in numeric.items()
            if not diff["within_rtol_atol"]
        ]
        failures += item_failures
        comparisons.append(
            {
                **{k: v for k, v in item.items() if k not in ("per_image", "failures")},
                "verdict": "FAIL" if item_failures else "PASS",
                "failures": item_failures,
                "raw_outputs": numeric,
                "all_patches": patch_diff(raw[left], raw[right], sizes),
                "per_image_detections": [
                    (entry["left_detections"], entry["right_detections"])
                    for entry in item["per_image"]
                ],
            }
        )
    failures += [
        f"repeat run not bitwise identical: {key}"
        for key, same in repeat.items()
        if not same
    ]
    failures += [
        f"{key} session providers {names} do not start with {provider}"
        for key, provider in (
            ("onnxruntime-cpu", CPU_PROVIDER),
            ("onnxruntime-directml", DML_PROVIDER),
        )
        if (names := providers[key])[0] != provider
    ]
    torch_scores = np.concatenate([det[1] for det in detections["torch"]])
    result.update(
        {
            "verdict": "FAIL" if failures else "PASS",
            "failures": failures,
            "tolerances": {
                "raw_rtol": RTOL,
                "raw_atol": ATOL,
                "detections": "detection_checkpoint_parity.compare (score floor, IoU match, box / score tolerances)",
            },
            "post_process_matches_transformers": not reference_failures,
            "session_providers": providers,
            "comparisons": comparisons,
            "repeat_run_bitwise_identical": repeat,
            "torch_detections_at_score_floor": int(torch_scores.size),
            "torch_max_score_all_patches": max(
                float(all_patches(out[0], out[1], w, h)[1].max())
                for out, (w, h) in zip(raw["torch"], sizes, strict=True)
            ),
            "observed_score_range_at_score_floor": [
                float(torch_scores.min()),
                float(torch_scores.max()),
            ]
            if torch_scores.size
            else None,
        }
    )
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
