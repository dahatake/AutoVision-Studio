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
    SEED,
    sha256_file,
)
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


def main() -> int:
    parser = argparse.ArgumentParser(description="C7D-02 OWL-ViT B/32 assist probe")
    parser.add_argument("--mode", choices=("parity", "performance"), default="parity")
    parser.add_argument("--artifact-dir", type=Path, required=True)
    args = parser.parse_args()
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
        "environment": {
            "python": platform.python_version(),
            "os": f"{platform.system()} {platform.version()}",
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "onnx": onnx.__version__,
            "onnxruntime": ort.__version__,
            "available_providers": available,
        },
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
