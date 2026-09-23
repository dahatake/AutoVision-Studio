"""SPI-16 / G2-06: detection train -> ONNX export -> CPU inference parity probe.

fail-closed boundaries kept by this probe:

* No pretrained checkpoint is downloaded, loaded or bundled. SPI-12
  (``docs/model-governance/detection-base.md``) keeps every detection C6
  candidate at ``HOLD``, so the probe builds the torchvision architecture code
  (C5) with randomly initialised weights and backbone only.
* The fixture is ``resources/samples/gwhd-2021`` (CC BY 4.0, rights reviewed in
  ``resources/samples/gwhd-2021/ATTRIBUTION.txt``).
* The probe measures the box / score / label difference and the AP@0.5
  difference between the trained PyTorch model and its exported ONNX model on
  the ONNX Runtime CPU execution provider. A measured difference above the
  declared tolerance is reported as a failure, never rounded away.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import onnx
import onnxruntime as ort
import optuna
import torch
import torchvision
from PIL import Image
from torch import Tensor, nn
from torchvision.models.detection import ssdlite320_mobilenet_v3_large

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / "resources" / "samples" / "gwhd-2021"
ANNOTATION_FILE = FIXTURE_DIR / "annotations.coco.json"

IMAGE_SIZE = 320
SEED = 20260922
EPOCHS = 60
BATCH_SIZE = 3
LEARNING_RATE = 0.01
MOMENTUM = 0.9
EVAL_IMAGES = 5
OPSET_VERSION = 17
SCORE_FLOOR = 0.05
IOU_THRESHOLD = 0.5
MATCH_IOU = 0.99
BOX_TOLERANCE = 1.0e-3
SCORE_TOLERANCE = 1.0e-4
AP_TOLERANCE = 1.0e-4
MINI_RUN_TRIALS = 8
MINI_RUN_EPOCHS = 3
MINI_RUN_BATCH_CANDIDATES = (2, 3, 4, 5)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_fixture() -> tuple[list[Tensor], list[Tensor], int]:
    """Return 320x320 image tensors, xyxy boxes scaled to the same size."""
    coco = json.loads(ANNOTATION_FILE.read_text(encoding="utf-8"))
    by_image: dict[int, list[list[float]]] = defaultdict(list)
    for annotation in coco["annotations"]:
        x, y, width, height = annotation["bbox"]
        by_image[annotation["image_id"]].append([x, y, x + width, y + height])

    images: list[Tensor] = []
    targets: list[Tensor] = []
    box_total = 0
    for record in sorted(coco["images"], key=lambda item: int(item["id"])):
        path = FIXTURE_DIR / "images" / record["file_name"]
        with Image.open(path) as image:
            rgb = image.convert("RGB").resize(
                (IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BILINEAR
            )
            array = np.asarray(rgb, dtype=np.float32) / 255.0
        images.append(torch.from_numpy(np.transpose(array, (2, 0, 1))).contiguous())
        scale_x = IMAGE_SIZE / float(record["width"])
        scale_y = IMAGE_SIZE / float(record["height"])
        boxes = torch.tensor(by_image[int(record["id"])], dtype=torch.float32)
        boxes[:, 0::2] *= scale_x
        boxes[:, 1::2] *= scale_y
        targets.append(boxes)
        box_total += boxes.shape[0]
    return images, targets, box_total


def train_model(
    model: nn.Module,
    images: list[Tensor],
    boxes: list[Tensor],
    epochs: int = EPOCHS,
    batch_size: int = BATCH_SIZE,
    learning_rate: float = LEARNING_RATE,
    device: torch.device | None = None,
) -> list[float]:
    target_device = device or torch.device("cpu")
    optimiser = torch.optim.SGD(
        [p for p in model.parameters() if p.requires_grad],
        lr=learning_rate,
        momentum=MOMENTUM,
    )
    generator = torch.Generator().manual_seed(SEED)
    losses: list[float] = []
    model.train()
    for _ in range(epochs):
        order = torch.randperm(len(images), generator=generator)
        epoch_loss = 0.0
        batches = 0
        for start in range(0, order.numel(), batch_size):
            selection = [int(i) for i in order[start : start + batch_size]]
            if len(selection) < 2:
                # BatchNorm rejects a single sample on 1x1 feature maps.
                raise SystemExit("train split must divide into batches of 2 or more")
            batch_images = [images[i].to(target_device) for i in selection]
            batch_targets = [
                {
                    "boxes": boxes[i].to(target_device),
                    "labels": torch.ones(
                        boxes[i].shape[0], dtype=torch.int64, device=target_device
                    ),
                }
                for i in selection
            ]
            optimiser.zero_grad()
            loss = sum(model(batch_images, batch_targets).values())
            loss.backward()
            optimiser.step()
            epoch_loss += float(loss.detach())
            batches += 1
        losses.append(epoch_loss / batches)
    return losses


def filter_detections(
    boxes: np.ndarray, scores: np.ndarray, labels: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    keep = scores >= SCORE_FLOOR
    boxes, scores, labels = boxes[keep], scores[keep], labels[keep]
    order = np.argsort(-scores, kind="stable")
    return boxes[order], scores[order], labels[order]


def iou_matrix(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    if left.shape[0] == 0 or right.shape[0] == 0:
        return np.zeros((left.shape[0], right.shape[0]), dtype=np.float64)
    lt = np.maximum(left[:, None, :2], right[None, :, :2])
    rb = np.minimum(left[:, None, 2:], right[None, :, 2:])
    wh = np.clip(rb - lt, 0.0, None)
    intersection = wh[..., 0] * wh[..., 1]
    left_area = (left[:, 2] - left[:, 0]) * (left[:, 3] - left[:, 1])
    right_area = (right[:, 2] - right[:, 0]) * (right[:, 3] - right[:, 1])
    union = left_area[:, None] + right_area[None, :] - intersection
    return np.where(union > 0, intersection / np.maximum(union, 1e-12), 0.0)


def match_detections(
    torch_det: tuple[np.ndarray, np.ndarray, np.ndarray],
    onnx_det: tuple[np.ndarray, np.ndarray, np.ndarray],
) -> tuple[int, float, float, int]:
    """Greedy IoU matching. Returns matched count, box diff, score diff, mismatches."""
    torch_boxes, torch_scores, torch_labels = torch_det
    onnx_boxes, onnx_scores, onnx_labels = onnx_det
    ious = iou_matrix(torch_boxes, onnx_boxes)
    taken: set[int] = set()
    matched = 0
    box_diff = 0.0
    score_diff = 0.0
    label_mismatch = 0
    for torch_index in range(torch_boxes.shape[0]):
        best_iou = MATCH_IOU
        best_index = -1
        for onnx_index in range(onnx_boxes.shape[0]):
            if onnx_index in taken:
                continue
            if ious[torch_index, onnx_index] >= best_iou:
                best_iou = float(ious[torch_index, onnx_index])
                best_index = onnx_index
        if best_index < 0:
            continue
        taken.add(best_index)
        matched += 1
        box_diff = max(
            box_diff,
            float(np.abs(torch_boxes[torch_index] - onnx_boxes[best_index]).max()),
        )
        score_diff = max(
            score_diff,
            abs(float(torch_scores[torch_index]) - float(onnx_scores[best_index])),
        )
        if int(torch_labels[torch_index]) != int(onnx_labels[best_index]):
            label_mismatch += 1
    return matched, box_diff, score_diff, label_mismatch


def average_precision(
    predictions: list[tuple[np.ndarray, np.ndarray]], ground_truth: list[np.ndarray]
) -> float:
    """VOC-style AP@0.5 for the single ``wheat_head`` class."""
    flat: list[tuple[float, int, int]] = []
    for image_index, (boxes, scores) in enumerate(predictions):
        for box_index in range(boxes.shape[0]):
            flat.append((float(scores[box_index]), image_index, box_index))
    flat.sort(key=lambda item: -item[0])

    matched: dict[int, set[int]] = {i: set() for i in range(len(ground_truth))}
    gt_total = sum(int(boxes.shape[0]) for boxes in ground_truth)
    if gt_total == 0:
        return 0.0
    true_positive = np.zeros(len(flat), dtype=np.float64)
    false_positive = np.zeros(len(flat), dtype=np.float64)

    for rank, (_, image_index, box_index) in enumerate(flat):
        candidate = predictions[image_index][0][box_index]
        targets = ground_truth[image_index]
        best_iou = 0.0
        best_index = -1
        for target_index in range(targets.shape[0]):
            if target_index in matched[image_index]:
                continue
            target = targets[target_index]
            left = max(candidate[0], target[0])
            top = max(candidate[1], target[1])
            right = min(candidate[2], target[2])
            bottom = min(candidate[3], target[3])
            intersection = max(0.0, right - left) * max(0.0, bottom - top)
            union = (
                (candidate[2] - candidate[0]) * (candidate[3] - candidate[1])
                + (target[2] - target[0]) * (target[3] - target[1])
                - intersection
            )
            iou = intersection / union if union > 0 else 0.0
            if iou > best_iou:
                best_iou = iou
                best_index = target_index
        if best_iou >= IOU_THRESHOLD and best_index >= 0:
            matched[image_index].add(best_index)
            true_positive[rank] = 1.0
        else:
            false_positive[rank] = 1.0

    cumulative_tp = np.cumsum(true_positive)
    cumulative_fp = np.cumsum(false_positive)
    recall = cumulative_tp / gt_total
    precision = cumulative_tp / np.maximum(cumulative_tp + cumulative_fp, 1e-12)
    ap = 0.0
    previous_recall = 0.0
    for index in range(len(flat)):
        if recall[index] > previous_recall:
            # VOC interpolated precision: max over every rank at or beyond index.
            ap += (recall[index] - previous_recall) * float(precision[index:].max())
            previous_recall = float(recall[index])
    return float(ap)


def run_automl_mini_run(device: torch.device) -> int:
    """D-15 / G2-08: measure the wall-clock cost of one detection AutoML trial."""
    images, boxes, _ = load_fixture()
    train_images = images[:-EVAL_IMAGES]
    train_boxes = boxes[:-EVAL_IMAGES]
    # A trailing batch of one sample makes BatchNorm fail on 1x1 feature maps.
    batch_sizes = [
        size
        for size in MINI_RUN_BATCH_CANDIDATES
        if len(train_images) % size != 1 and size <= len(train_images)
    ]
    if not batch_sizes:
        raise SystemExit(
            f"no batch size in {MINI_RUN_BATCH_CANDIDATES} divides "
            f"{len(train_images)} training images without a single-sample batch"
        )
    trials: list[dict[str, Any]] = []

    def objective(trial: optuna.Trial) -> float:
        learning_rate = trial.suggest_float("learning_rate", 1e-3, 1e-1, log=True)
        batch_size = trial.suggest_categorical("batch_size", batch_sizes)
        started = time.perf_counter()
        torch.manual_seed(SEED)
        model = ssdlite320_mobilenet_v3_large(
            weights=None, weights_backbone=None, num_classes=2
        ).to(device)
        losses = train_model(
            model,
            train_images,
            train_boxes,
            epochs=MINI_RUN_EPOCHS,
            batch_size=batch_size,
            learning_rate=learning_rate,
            device=device,
        )
        if device.type == "cuda":
            torch.cuda.synchronize()
        seconds = time.perf_counter() - started
        trials.append(
            {
                "number": trial.number,
                "learning_rate": round(learning_rate, 6),
                "batch_size": batch_size,
                "final_epoch_mean_loss": round(losses[-1], 6),
                "seconds": round(seconds, 3),
            }
        )
        return losses[-1]

    study_started = time.perf_counter()
    study = optuna.create_study(
        direction="minimize", sampler=optuna.samplers.TPESampler(seed=SEED)
    )
    study.optimize(objective, n_trials=MINI_RUN_TRIALS)
    study_seconds = time.perf_counter() - study_started

    durations = sorted(trial["seconds"] for trial in trials)
    median = (
        durations[len(durations) // 2]
        if len(durations) % 2
        else (durations[len(durations) // 2 - 1] + durations[len(durations) // 2]) / 2
    )
    not_covered = [
        "search-space quality",
        "detection accuracy (the loss is not a quality claim)",
        "DirectML training",
        "dataset sizes other than the measured fixture",
        "the production training pipeline, which is not implemented yet",
    ]
    if device.type != "cuda":
        not_covered.insert(2, "CUDA training")
    result: dict[str, Any] = {
        "task": "D-15 / G2-08 detection AutoML mini-run trial cost",
        "verdict": "MEASURED",
        "scope_limits": {
            "pretrained_checkpoint_used": False,
            "purpose": "wall-clock trial cost only",
            "not_covered": not_covered,
        },
        "environment": {
            "python": platform.python_version(),
            "os": f"{platform.system()} {platform.version()}",
            "machine": platform.machine(),
            "torch": torch.__version__,
            "torchvision": torchvision.__version__,
            "optuna": optuna.__version__,
            "device": device.type,
            "cuda_build": torch.version.cuda,
            "gpu": (
                torch.cuda.get_device_name(device) if device.type == "cuda" else None
            ),
            "torch_threads": torch.get_num_threads(),
        },
        "mini_run": {
            "architecture": "torchvision ssdlite320_mobilenet_v3_large",
            "sampler": "TPESampler",
            "seed": SEED,
            "trials": MINI_RUN_TRIALS,
            "epochs_per_trial": MINI_RUN_EPOCHS,
            "train_images": len(train_images),
            "image_size": IMAGE_SIZE,
            "search_space": {
                "learning_rate": "log-uniform 1e-3..1e-1",
                "batch_size": batch_sizes,
            },
            "per_trial": trials,
            "min_trial_seconds": durations[0],
            "median_trial_seconds": median,
            "max_trial_seconds": durations[-1],
            "total_study_seconds": round(study_seconds, 3),
            "best_value": round(float(study.best_value), 6),
        },
    }
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="SPI-16 detection parity probe")
    parser.add_argument(
        "--mode",
        choices=("parity", "automl-mini-run"),
        default="parity",
        help="parity: SPI-16 train/export parity. automl-mini-run: D-15 trial cost",
    )
    parser.add_argument(
        "--artifact-dir",
        type=Path,
        help="directory that receives the exported ONNX model (parity mode only)",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=EPOCHS,
        help="training epochs; raising this separates the detection scores",
    )
    parser.add_argument(
        "--device",
        choices=("cpu", "cuda"),
        default="cpu",
        help="device for the AutoML mini-run (D-15 requires CPU and accelerator)",
    )
    args = parser.parse_args()

    torch.manual_seed(SEED)
    torch.set_num_threads(1)

    if args.mode == "automl-mini-run":
        return run_automl_mini_run(torch.device(args.device))

    if args.device != "cpu":
        parser.error(
            "parity mode always runs on the CPU; --device applies to automl-mini-run"
        )
    if args.artifact_dir is None:
        parser.error("--artifact-dir is required in parity mode")
    artifact_dir: Path = args.artifact_dir
    artifact_dir.mkdir(parents=True, exist_ok=True)

    images, boxes, box_total = load_fixture()
    train_images = images[:-EVAL_IMAGES]
    train_boxes = boxes[:-EVAL_IMAGES]
    eval_images = images[-EVAL_IMAGES:]
    eval_boxes = boxes[-EVAL_IMAGES:]

    model = ssdlite320_mobilenet_v3_large(
        weights=None, weights_backbone=None, num_classes=2
    )
    train_started = time.perf_counter()
    losses = train_model(model, train_images, train_boxes, epochs=args.epochs)
    train_seconds = time.perf_counter() - train_started

    model.eval()
    torch_outputs: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    with torch.no_grad():
        for image in eval_images:
            output = model([image])[0]
            torch_outputs.append(
                filter_detections(
                    output["boxes"].numpy(),
                    output["scores"].numpy(),
                    output["labels"].numpy(),
                )
            )

    onnx_path = artifact_dir / "detection.onnx"
    export_started = time.perf_counter()
    torch.onnx.export(
        model,
        ([eval_images[0]],),
        str(onnx_path),
        input_names=["images"],
        output_names=["boxes", "scores", "labels"],
        opset_version=OPSET_VERSION,
        dynamo=False,
    )
    export_seconds = time.perf_counter() - export_started
    onnx.checker.check_model(onnx.load(str(onnx_path)))

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    onnx_outputs: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    infer_started = time.perf_counter()
    for image in eval_images:
        raw = session.run(None, {input_name: image.numpy()})
        onnx_outputs.append(filter_detections(raw[0], raw[1], raw[2]))
    infer_seconds = time.perf_counter() - infer_started

    failures: list[str] = []
    per_image: list[dict[str, Any]] = []
    max_box_diff = 0.0
    max_score_diff = 0.0
    label_mismatch = 0
    rank_label_mismatch = 0
    matched_box_diff = 0.0
    matched_score_diff = 0.0
    matched_total = 0
    torch_unmatched_total = 0
    onnx_unmatched_total = 0
    for index, (torch_det, onnx_det) in enumerate(zip(torch_outputs, onnx_outputs)):
        torch_boxes, torch_scores, torch_labels = torch_det
        onnx_boxes, onnx_scores, onnx_labels = onnx_det
        common = min(torch_boxes.shape[0], onnx_boxes.shape[0])
        box_diff = (
            float(np.abs(torch_boxes[:common] - onnx_boxes[:common]).max())
            if common
            else 0.0
        )
        score_diff = (
            float(np.abs(torch_scores[:common] - onnx_scores[:common]).max())
            if common
            else 0.0
        )
        mismatch = (
            int((torch_labels[:common] != onnx_labels[:common]).sum()) if common else 0
        )
        matched, pair_box_diff, pair_score_diff, pair_label_mismatch = match_detections(
            torch_det, onnx_det
        )
        max_box_diff = max(max_box_diff, box_diff)
        max_score_diff = max(max_score_diff, score_diff)
        label_mismatch += pair_label_mismatch
        rank_label_mismatch += mismatch
        matched_box_diff = max(matched_box_diff, pair_box_diff)
        matched_score_diff = max(matched_score_diff, pair_score_diff)
        matched_total += matched
        torch_unmatched = int(torch_boxes.shape[0]) - matched
        onnx_unmatched = int(onnx_boxes.shape[0]) - matched
        torch_unmatched_total += torch_unmatched
        onnx_unmatched_total += onnx_unmatched
        if torch_boxes.shape[0] != onnx_boxes.shape[0]:
            failures.append(
                f"image {index}: detection count {torch_boxes.shape[0]} (torch) "
                f"!= {onnx_boxes.shape[0]} (onnx) at score >= {SCORE_FLOOR}"
            )
        per_image.append(
            {
                "index": index,
                "torch_detections": int(torch_boxes.shape[0]),
                "onnx_detections": int(onnx_boxes.shape[0]),
                "ground_truth_boxes": int(eval_boxes[index].shape[0]),
                "score_min_max": [
                    round(float(torch_scores.min()), 6)
                    if torch_scores.shape[0]
                    else None,
                    round(float(torch_scores.max()), 6)
                    if torch_scores.shape[0]
                    else None,
                ],
                "rank_aligned_max_abs_box_diff": box_diff,
                "rank_aligned_max_abs_score_diff": score_diff,
                "iou_matched_detections": matched,
                "iou_matched_max_abs_box_diff": pair_box_diff,
                "iou_matched_max_abs_score_diff": pair_score_diff,
                "torch_only_detections": torch_unmatched,
                "onnx_only_detections": onnx_unmatched,
                "iou_matched_label_mismatches": pair_label_mismatch,
                "rank_aligned_label_mismatches": mismatch,
            }
        )

    ground_truth = [target.numpy() for target in eval_boxes]
    torch_ap = average_precision(
        [(det[0], det[1]) for det in torch_outputs], ground_truth
    )
    onnx_ap = average_precision(
        [(det[0], det[1]) for det in onnx_outputs], ground_truth
    )
    ap_diff = abs(torch_ap - onnx_ap)

    if matched_box_diff > BOX_TOLERANCE:
        failures.append(
            f"iou_matched_max_abs_box_diff {matched_box_diff:.3e} > tolerance {BOX_TOLERANCE:.1e}"
        )
    if matched_score_diff > SCORE_TOLERANCE:
        failures.append(
            f"iou_matched_max_abs_score_diff {matched_score_diff:.3e} "
            f"> tolerance {SCORE_TOLERANCE:.1e}"
        )
    if torch_unmatched_total or onnx_unmatched_total:
        failures.append(
            f"{torch_unmatched_total} torch-only and {onnx_unmatched_total} onnx-only "
            f"detections have no IoU>={MATCH_IOU} counterpart"
        )
    if label_mismatch:
        failures.append(
            f"{label_mismatch} label mismatches between IoU-matched torch/onnx pairs"
        )
    if ap_diff > AP_TOLERANCE:
        failures.append(f"ap50_diff {ap_diff:.3e} > tolerance {AP_TOLERANCE:.1e}")

    result: dict[str, Any] = {
        "task": "SPI-16 / G2-06 detection train-export parity",
        "verdict": "FAIL" if failures else "PASS",
        "failures": failures,
        "scope_limits": {
            "pretrained_checkpoint_used": False,
            "weight_initialisation": "random (torchvision default init, backbone included)",
            "reason": "SPI-12 keeps every detection C6 candidate at HOLD",
            "not_covered": [
                "approved base weight fine-tuning",
                "detection accuracy acceptance (the measured AP is not a quality claim)",
                "DirectML execution provider",
            ],
        },
        "environment": {
            "python": platform.python_version(),
            "os": f"{platform.system()} {platform.version()}",
            "machine": platform.machine(),
            "torch": torch.__version__,
            "torchvision": torchvision.__version__,
            "onnx": onnx.__version__,
            "onnxruntime": ort.__version__,
            "numpy": np.__version__,
            "providers": session.get_providers(),
        },
        "fixture": {
            "directory": FIXTURE_DIR.relative_to(REPO_ROOT).as_posix(),
            "category": "wheat_head",
            "image_count": len(images),
            "box_count": box_total,
            "train_images": len(train_images),
            "eval_images": len(eval_images),
            "image_size": IMAGE_SIZE,
        },
        "training": {
            "architecture": "torchvision ssdlite320_mobilenet_v3_large",
            "seed": SEED,
            "epochs": args.epochs,
            "batch_size": BATCH_SIZE,
            "learning_rate": LEARNING_RATE,
            "epoch_mean_loss": [round(value, 6) for value in losses],
            "seconds": round(train_seconds, 3),
        },
        "export": {
            "opset": OPSET_VERSION,
            "exporter": "torch.onnx.export(dynamo=False)",
            "onnx_bytes": onnx_path.stat().st_size,
            "onnx_sha256": sha256_file(onnx_path),
            "seconds": round(export_seconds, 3),
        },
        "parity": {
            "score_floor": SCORE_FLOOR,
            "match_iou": MATCH_IOU,
            "score_spread": (
                round(
                    max(
                        i["score_min_max"][1]
                        for i in per_image
                        if i["score_min_max"][1] is not None
                    )
                    - min(
                        i["score_min_max"][0]
                        for i in per_image
                        if i["score_min_max"][0] is not None
                    ),
                    6,
                )
                if any(i["score_min_max"][0] is not None for i in per_image)
                else None
            ),
            "tolerance_box": BOX_TOLERANCE,
            "tolerance_score": SCORE_TOLERANCE,
            "tolerance_ap": AP_TOLERANCE,
            "rank_aligned_max_abs_box_diff": max_box_diff,
            "rank_aligned_max_abs_score_diff": max_score_diff,
            "iou_matched_detections": matched_total,
            "iou_matched_max_abs_box_diff": matched_box_diff,
            "iou_matched_max_abs_score_diff": matched_score_diff,
            "torch_only_detections": torch_unmatched_total,
            "onnx_only_detections": onnx_unmatched_total,
            "iou_matched_label_mismatches": label_mismatch,
            "rank_aligned_label_mismatches": rank_label_mismatch,
            "torch_ap50": torch_ap,
            "onnx_ap50": onnx_ap,
            "ap50_abs_diff": ap_diff,
            "ap50_relative_diff": (ap_diff / torch_ap if torch_ap > 0 else None),
            "onnx_cpu_inference_seconds": round(infer_seconds, 3),
            "per_image": per_image,
        },
    }
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
