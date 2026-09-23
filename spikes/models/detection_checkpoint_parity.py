"""SPI-12 / G2-02 DP-01 and DP-04: parity of the retrieved detection checkpoint.

What this probe measures:

* ``DP-01`` PyTorch eager output vs ONNX Runtime ``CPUExecutionProvider``.
* ``DP-04`` ONNX Runtime ``DmlExecutionProvider`` vs both of the above.

fail-closed boundaries kept by this probe:

* The checkpoint is read from ``vendor/models/`` (git-ignored, never copied into
  the repository or the installer payload). The probe aborts when the SHA-256
  does not match the value recorded in
  ``docs/model-governance/detection-base.md`` §14.
* A parity measurement is evidence, not an approval. It does not create a
  manifest entry, does not set ``releaseStatus.ready`` and does not supply the
  license identifier, NOTICE text or approver name that
  ``docs/dependency-policy.md`` §6.1 requires.
* Tolerances are fixed before the run and are the same values SPI-16 uses. A
  measurement above the tolerance is recorded as ``FAIL``; it is not retried
  with a looser bound.
* The fixture is ``resources/samples/gwhd-2021`` (CC BY 4.0). The checkpoint was
  trained on COCO, so the detections are out-of-domain. This probe compares
  backends against each other and makes **no accuracy claim**.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import math
import platform
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import onnx
import onnxruntime as ort
import torch
import torchvision
from detection import (
    BOX_TOLERANCE,
    IMAGE_SIZE,
    REPO_ROOT,
    SCORE_FLOOR,
    SCORE_TOLERANCE,
    SEED,
    average_precision,
    filter_detections,
    load_fixture,
    match_detections,
    sha256_file,
    train_model,
)
from torchvision.models.detection import ssdlite320_mobilenet_v3_large

CHECKPOINT_PATH = (
    REPO_ROOT / "vendor" / "models" / "ssdlite320_mobilenet_v3_large_coco-a79551df.pth"
)
EXPECTED_SHA256 = "a79551df90c79834bcd3bb3845ef9d966b5449a3a9b2833ae8404778ca5d65d2"
COCO_CLASS_COUNT = 91
EVAL_IMAGES = 5
OPSET_VERSION = 17
CPU_PROVIDER = "CPUExecutionProvider"
DML_PROVIDER = "DmlExecutionProvider"
WARMUP_PASSES = 5
MEASURED_PASSES = 20
# Adoption record 11 acceptance criteria (POC-03), fixed before the run.
MAX_P95_MS = 100.0
MIN_THROUGHPUT_FPS = 10.0

Detection = tuple[np.ndarray, np.ndarray, np.ndarray]


def load_checkpoint(path: Path) -> dict[str, Any]:
    """Restricted load of the retrieved checkpoint with a hash gate."""
    if not path.exists():
        raise SystemExit(f"checkpoint not found: {path}")
    digest = sha256_file(path)
    if digest != EXPECTED_SHA256:
        raise SystemExit(
            f"checkpoint SHA-256 {digest} does not match the recorded "
            f"{EXPECTED_SHA256}; refusing to run"
        )
    state_dict = torch.load(path, map_location="cpu", weights_only=True)
    return {"sha256": digest, "byte_size": path.stat().st_size, "state": state_dict}


def run_session(
    onnx_path: Path, provider: str, images: list[torch.Tensor]
) -> tuple[list[Detection], list[str], float]:
    session = ort.InferenceSession(str(onnx_path), providers=[provider])
    input_name = session.get_inputs()[0].name
    outputs: list[Detection] = []
    started = time.perf_counter()
    for image in images:
        raw = session.run(None, {input_name: image.numpy()})
        outputs.append(filter_detections(raw[0], raw[1], raw[2]))
    seconds = time.perf_counter() - started
    return outputs, session.get_providers(), seconds


class ProcessMemoryCounters(ctypes.Structure):
    """PROCESS_MEMORY_COUNTERS (psapi.h). Windows x64 MVP only."""

    _fields_ = [
        ("cb", ctypes.c_uint32),
        ("PageFaultCount", ctypes.c_uint32),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def peak_working_set_bytes() -> int:
    """Process-wide peak working set since start. It never resets, so a later
    call also covers everything measured before it."""
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    # Without explicit types the 64-bit pseudo-handle is truncated to int.
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    psapi.GetProcessMemoryInfo.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ProcessMemoryCounters),
        ctypes.c_uint32,
    ]
    psapi.GetProcessMemoryInfo.restype = ctypes.c_int

    counters = ProcessMemoryCounters()
    counters.cb = ctypes.sizeof(ProcessMemoryCounters)
    if not psapi.GetProcessMemoryInfo(
        kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb
    ):
        raise SystemExit(
            f"GetProcessMemoryInfo failed (error {ctypes.get_last_error()})"
        )
    return int(counters.PeakWorkingSetSize)


def percentile(sorted_values: list[float], fraction: float) -> float:
    """Nearest-rank percentile: the smallest value at or above the rank."""
    rank = math.ceil(fraction * len(sorted_values))
    return sorted_values[max(rank, 1) - 1]


def measure_latency(
    onnx_path: Path, provider: str, images: list[torch.Tensor]
) -> dict[str, Any]:
    """Per-image inference latency for one execution provider."""
    session = ort.InferenceSession(str(onnx_path), providers=[provider])
    input_name = session.get_inputs()[0].name
    payloads = [image.numpy() for image in images]

    for _ in range(WARMUP_PASSES):
        for payload in payloads:
            session.run(None, {input_name: payload})

    samples: list[float] = []
    for _ in range(MEASURED_PASSES):
        for payload in payloads:
            started = time.perf_counter()
            session.run(None, {input_name: payload})
            samples.append((time.perf_counter() - started) * 1000.0)

    ordered = sorted(samples)
    mean_ms = sum(samples) / len(samples)
    return {
        "provider": provider,
        "session_providers": session.get_providers(),
        "samples": len(samples),
        "min_ms": round(ordered[0], 3),
        "median_ms": round(percentile(ordered, 0.50), 3),
        "p95_ms": round(percentile(ordered, 0.95), 3),
        "max_ms": round(ordered[-1], 3),
        "mean_ms": round(mean_ms, 3),
        "throughput_fps": round(1000.0 / mean_ms, 2),
        "cumulative_process_peak_working_set_bytes": peak_working_set_bytes(),
    }


def compare(
    label: str, left: list[Detection], right: list[Detection]
) -> dict[str, Any]:
    """IoU-match two backends image by image and collect the worst differences."""
    failures: list[str] = []
    per_image: list[dict[str, Any]] = []
    max_box_diff = 0.0
    max_score_diff = 0.0
    left_unmatched_total = 0
    right_unmatched_total = 0
    label_mismatch_total = 0
    matched_total = 0

    for index, (left_det, right_det) in enumerate(zip(left, right)):
        matched, box_diff, score_diff, label_mismatch = match_detections(
            left_det, right_det
        )
        left_unmatched = int(left_det[0].shape[0]) - matched
        right_unmatched = int(right_det[0].shape[0]) - matched
        matched_total += matched
        left_unmatched_total += left_unmatched
        right_unmatched_total += right_unmatched
        label_mismatch_total += label_mismatch
        max_box_diff = max(max_box_diff, box_diff)
        max_score_diff = max(max_score_diff, score_diff)
        if left_det[0].shape[0] != right_det[0].shape[0]:
            failures.append(
                f"{label} image {index}: detection count "
                f"{left_det[0].shape[0]} != {right_det[0].shape[0]} "
                f"at score >= {SCORE_FLOOR}"
            )
        per_image.append(
            {
                "index": index,
                "left_detections": int(left_det[0].shape[0]),
                "right_detections": int(right_det[0].shape[0]),
                "iou_matched_detections": matched,
                "left_only_detections": left_unmatched,
                "right_only_detections": right_unmatched,
                "iou_matched_max_abs_box_diff": box_diff,
                "iou_matched_max_abs_score_diff": score_diff,
                "iou_matched_label_mismatches": label_mismatch,
            }
        )

    if max_box_diff > BOX_TOLERANCE:
        failures.append(
            f"{label} iou_matched_max_abs_box_diff {max_box_diff:.3e} "
            f"> tolerance {BOX_TOLERANCE:.1e}"
        )
    if max_score_diff > SCORE_TOLERANCE:
        failures.append(
            f"{label} iou_matched_max_abs_score_diff {max_score_diff:.3e} "
            f"> tolerance {SCORE_TOLERANCE:.1e}"
        )
    if left_unmatched_total or right_unmatched_total:
        failures.append(
            f"{label}: {left_unmatched_total} left-only and "
            f"{right_unmatched_total} right-only detections have no counterpart"
        )
    if label_mismatch_total:
        failures.append(
            f"{label}: {label_mismatch_total} label mismatches between matched pairs"
        )

    return {
        "comparison": label,
        "verdict": "FAIL" if failures else "PASS",
        "failures": failures,
        "iou_matched_detections": matched_total,
        "left_only_detections": left_unmatched_total,
        "right_only_detections": right_unmatched_total,
        "iou_matched_label_mismatches": label_mismatch_total,
        "iou_matched_max_abs_box_diff": max_box_diff,
        "iou_matched_max_abs_score_diff": max_score_diff,
        "per_image": per_image,
    }


def build_model_and_onnx(
    artifact_dir: Path, score_thresh: float | None = None
) -> tuple[Any, dict[str, Any], Path, float]:
    """Load the pinned checkpoint and export it once for the requested mode.

    ``score_thresh`` is the torchvision post-processing threshold; ``None`` keeps
    the torchvision default (0.001)."""
    checkpoint = load_checkpoint(CHECKPOINT_PATH)
    options = {} if score_thresh is None else {"score_thresh": score_thresh}
    model = ssdlite320_mobilenet_v3_large(
        weights=None, weights_backbone=None, num_classes=COCO_CLASS_COUNT, **options
    )
    model.load_state_dict(checkpoint["state"], strict=True)
    model.eval()

    onnx_path = artifact_dir / "detection-checkpoint.onnx"
    images, _, _ = load_fixture()
    export_started = time.perf_counter()
    torch.onnx.export(
        model,
        ([images[-EVAL_IMAGES]],),
        str(onnx_path),
        input_names=["images"],
        output_names=["boxes", "scores", "labels"],
        opset_version=OPSET_VERSION,
        dynamo=False,
    )
    export_seconds = time.perf_counter() - export_started
    onnx.checker.check_model(onnx.load(str(onnx_path)))
    return model, checkpoint, onnx_path, export_seconds


def run_performance(
    artifact_dir: Path, available: list[str], score_thresh: float | None
) -> int:
    """Adoption record 11: per-image inference latency, throughput and memory."""
    images, _, _ = load_fixture()
    eval_images = images[-EVAL_IMAGES:]
    _, checkpoint, onnx_path, export_seconds = build_model_and_onnx(
        artifact_dir, score_thresh
    )

    measurements = [
        measure_latency(onnx_path, CPU_PROVIDER, eval_images),
        measure_latency(onnx_path, DML_PROVIDER, eval_images),
    ]
    failures = [
        f"{item['provider']} p95 {item['p95_ms']} ms > {MAX_P95_MS} ms"
        for item in measurements
        if item["p95_ms"] > MAX_P95_MS
    ] + [
        f"{item['provider']} {item['throughput_fps']} fps < {MIN_THROUGHPUT_FPS} fps"
        for item in measurements
        if item["throughput_fps"] < MIN_THROUGHPUT_FPS
    ]
    result: dict[str, Any] = {
        "task": "SPI-12 / G2-02 checkpoint inference performance (adoption record 11)",
        "verdict": "FAIL" if failures else "PASS",
        "failures": failures,
        "criteria": {
            "max_p95_ms": MAX_P95_MS,
            "min_throughput_fps": MIN_THROUGHPUT_FPS,
        },
        "score_thresh": score_thresh
        if score_thresh is not None
        else "torchvision default",
        "scope_limits": {
            "poc03_complete": False,
            "measured": "per-image ONNX Runtime inference latency, throughput and "
            "process peak working set on the measured fixture",
            "not_measured": [
                "capture-to-display latency (requires the camera pipeline, INF phase)",
                "30-minute sustained run and frame drop rate (POC-03)",
                "installer size contribution (no installer is built yet)",
                "detection accuracy",
                (
                    "per-provider memory in isolation: the reported peak is the "
                    "cumulative process peak, measured in one process that also "
                    "keeps the eager PyTorch model and its state dict resident"
                ),
            ],
        },
        "environment": {
            "python": platform.python_version(),
            "os": f"{platform.system()} {platform.version()}",
            "machine": platform.machine(),
            "onnxruntime": ort.__version__,
            "available_providers": available,
            "torch_threads": torch.get_num_threads(),
        },
        "checkpoint": {
            "path": CHECKPOINT_PATH.relative_to(REPO_ROOT).as_posix(),
            "sha256": checkpoint["sha256"],
            "byte_size": checkpoint["byte_size"],
        },
        "export": {
            "opset": OPSET_VERSION,
            "onnx_bytes": onnx_path.stat().st_size,
            "onnx_sha256": sha256_file(onnx_path),
            "seconds": round(export_seconds, 3),
        },
        "measurement": {
            "images": len(eval_images),
            "image_size": IMAGE_SIZE,
            "warmup_passes": WARMUP_PASSES,
            "measured_passes": MEASURED_PASSES,
            "percentile_method": "nearest-rank",
        },
        "providers": measurements,
    }
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 1 if failures else 0


def run_transfer() -> int:
    """Adoption record 11 accuracy: fine-tune from this checkpoint vs random init, same recipe."""
    images, boxes, _ = load_fixture()
    train_images, train_boxes = images[:-EVAL_IMAGES], boxes[:-EVAL_IMAGES]
    eval_images, eval_boxes = images[-EVAL_IMAGES:], boxes[-EVAL_IMAGES:]
    checkpoint = load_checkpoint(CHECKPOINT_PATH)
    # The classification head is sized for 91 COCO classes and is re-initialised.
    transferable = {
        key: value
        for key, value in checkpoint["state"].items()
        if not key.startswith("head.classification_head.")
    }
    ground_truth = [target.numpy() for target in eval_boxes]
    runs: dict[str, Any] = {}
    for init in ("checkpoint", "random"):
        torch.manual_seed(SEED)
        model = ssdlite320_mobilenet_v3_large(
            weights=None, weights_backbone=None, num_classes=2
        )
        if init == "checkpoint":
            missing, unexpected = model.load_state_dict(transferable, strict=False)
            if unexpected or any(
                not key.startswith("head.classification_head.") for key in missing
            ):
                raise SystemExit(f"unexpected transfer keys: {missing} {unexpected}")
        losses = train_model(model, train_images, train_boxes)
        model.eval()
        with torch.no_grad():
            outputs = [model([image])[0] for image in eval_images]
        predictions = [
            filter_detections(
                out["boxes"].numpy(), out["scores"].numpy(), out["labels"].numpy()
            )[:2]
            for out in outputs
        ]
        runs[init] = {
            "eval_ap50": average_precision(predictions, ground_truth),
            "detections_at_score_floor": int(sum(p[0].shape[0] for p in predictions)),
            "epoch_mean_loss_first_last": [round(losses[0], 6), round(losses[-1], 6)],
        }
    passed = runs["checkpoint"]["eval_ap50"] >= runs["random"]["eval_ap50"]
    result = {
        "task": "SPI-12 / G2-02 checkpoint transfer accuracy (adoption record 11)",
        "verdict": "PASS" if passed else "FAIL",
        "criterion": "checkpoint-initialised eval AP@0.5 >= random-initialised, identical recipe",
        "checkpoint": {
            "sha256": checkpoint["sha256"],
            "byte_size": checkpoint["byte_size"],
        },
        "recipe": "detection.train_model defaults (SPI-16), num_classes=2",
        "train_images": len(train_images),
        "eval_images": len(eval_images),
        "eval_ground_truth_boxes": int(sum(t.shape[0] for t in ground_truth)),
        "runs": runs,
    }
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if passed else 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="SPI-12 / G2-02 checkpoint parity probe (DP-01, DP-04)"
    )
    parser.add_argument(
        "--mode",
        choices=("parity", "performance", "transfer"),
        default="parity",
        help=(
            "parity: DP-01 / DP-04 output agreement. performance: latency and "
            "memory. transfer: fine-tuning accuracy vs random init"
        ),
    )
    parser.add_argument(
        "--artifact-dir",
        type=Path,
        help="directory that receives the exported ONNX model (parity / performance)",
    )
    parser.add_argument(
        "--score-thresh",
        type=float,
        help="torchvision post-processing score threshold (default: torchvision 0.001)",
    )
    args = parser.parse_args()

    torch.manual_seed(SEED)
    torch.set_num_threads(1)
    if args.mode == "transfer":
        return run_transfer()

    if args.artifact_dir is None:
        parser.error("--artifact-dir is required in parity and performance mode")
    artifact_dir: Path = args.artifact_dir
    artifact_dir.mkdir(parents=True, exist_ok=True)

    available = ort.get_available_providers()
    if DML_PROVIDER not in available:
        raise SystemExit(
            f"{DML_PROVIDER} is not available in this onnxruntime build "
            f"({available}); DP-04 cannot be measured"
        )

    if args.mode == "performance":
        return run_performance(artifact_dir, available, args.score_thresh)

    images, boxes, _ = load_fixture()
    eval_images = images[-EVAL_IMAGES:]
    eval_boxes = boxes[-EVAL_IMAGES:]

    model, checkpoint, onnx_path, export_seconds = build_model_and_onnx(
        artifact_dir, args.score_thresh
    )

    torch_outputs: list[Detection] = []
    torch_started = time.perf_counter()
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
    torch_seconds = time.perf_counter() - torch_started

    cpu_outputs, cpu_providers, cpu_seconds = run_session(
        onnx_path, CPU_PROVIDER, eval_images
    )
    dml_outputs, dml_providers, dml_seconds = run_session(
        onnx_path, DML_PROVIDER, eval_images
    )

    comparisons = [
        compare("DP-01 torch vs onnxruntime-cpu", torch_outputs, cpu_outputs),
        compare("DP-04 torch vs onnxruntime-directml", torch_outputs, dml_outputs),
        compare(
            "DP-04 onnxruntime-cpu vs onnxruntime-directml", cpu_outputs, dml_outputs
        ),
    ]
    failures = [failure for item in comparisons for failure in item["failures"]]

    result: dict[str, Any] = {
        "task": "SPI-12 / G2-02 checkpoint parity (DP-01, DP-04)",
        "verdict": "FAIL" if failures else "PASS",
        "failures": failures,
        "scope_limits": {
            "approval_created": False,
            "manifest_modified": False,
            "accuracy_claim": False,
            "reason": (
                "A backend parity measurement is evidence only. The manifest entry "
                "still needs the checkpoint license identifier, the NOTICE text and "
                "the approver name required by docs/dependency-policy.md 6.1."
            ),
            "not_covered": [
                "detection accuracy on the checkpoint's own COCO domain",
                "latency, memory and thermal behaviour under sustained load",
                "the three remaining C6/C7 roles that Gate 2 also requires",
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
            "available_providers": available,
            "cpu_session_providers": cpu_providers,
            "directml_session_providers": dml_providers,
        },
        "checkpoint": {
            "path": CHECKPOINT_PATH.relative_to(REPO_ROOT).as_posix(),
            "sha256": checkpoint["sha256"],
            "byte_size": checkpoint["byte_size"],
            "loaded_with": "torch.load(weights_only=True)",
            "state_dict_entries": len(checkpoint["state"]),
            "architecture": "torchvision ssdlite320_mobilenet_v3_large",
            "num_classes": COCO_CLASS_COUNT,
            "strict_load": True,
        },
        "fixture": {
            "directory": "resources/samples/gwhd-2021",
            "eval_images": len(eval_images),
            "ground_truth_boxes": int(
                sum(int(target.shape[0]) for target in eval_boxes)
            ),
            "image_size": IMAGE_SIZE,
            "domain_note": "out-of-domain for a COCO checkpoint; backends only",
        },
        "export": {
            "opset": OPSET_VERSION,
            "exporter": "torch.onnx.export(dynamo=False)",
            "onnx_bytes": onnx_path.stat().st_size,
            "onnx_sha256": sha256_file(onnx_path),
            "seconds": round(export_seconds, 3),
        },
        "tolerances": {
            "box": BOX_TOLERANCE,
            "score": SCORE_TOLERANCE,
            "score_floor": SCORE_FLOOR,
        },
        "torchvision_score_thresh": args.score_thresh
        if args.score_thresh is not None
        else "torchvision default",
        "timing_seconds": {
            "torch_eager": round(torch_seconds, 3),
            "onnxruntime_cpu": round(cpu_seconds, 3),
            "onnxruntime_directml": round(dml_seconds, 3),
        },
        "comparisons": comparisons,
    }

    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
