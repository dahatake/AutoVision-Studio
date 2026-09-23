"""G2R-12: backend parity and inference performance of the C6 classification checkpoint.

Checkpoint: torchvision ``MobileNet_V3_Large_Weights.IMAGENET1K_V2``
(``mobilenet_v3_large-5c1a4163.pth``), retrieved into ``vendor/models/``
(git-ignored, never copied into the repository or the installer payload).

fail-closed boundaries kept by this probe:

* The probe aborts when the checkpoint SHA-256 differs from the value recorded
  in ``docs/model-governance/mobilenet-v3-large-imagenet1k-v2-adoption.md`` §1.
* The checkpoint is loaded with ``torch.load(weights_only=True)`` and
  ``load_state_dict(strict=True)``.
* Tolerances are the SPI-15 values (``classification.py``), fixed before the
  run. A measurement above tolerance is ``FAIL``; it is not retried looser.
* The fixture is ``resources/samples/beans`` (MIT). The checkpoint predicts the
  1000 ImageNet-1k classes, so the probe compares backends against each other
  and makes **no accuracy claim**.
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
import torchvision
from classification import (
    LOGIT_TOLERANCE,
    PROB_TOLERANCE,
    REPO_ROOT,
    SEED,
    load_fixture,
    sha256_file,
    softmax,
    split_indices,
    train_model,
)
from detection_checkpoint_parity import (
    CPU_PROVIDER,
    DML_PROVIDER,
    MEASURED_PASSES,
    WARMUP_PASSES,
    measure_latency,
)
from PIL import Image
from torch import nn
from torchvision.models import MobileNet_V3_Large_Weights, mobilenet_v3_large

CHECKPOINT_PATH = REPO_ROOT / "vendor" / "models" / "mobilenet_v3_large-5c1a4163.pth"
EXPECTED_SHA256 = "5c1a416349c4cf298f2a6a5e2600ed0ee55e604713578f5e74e6bc8bcaef7997"
IMAGENET_CLASS_COUNT = 1000
OPSET_VERSION = 17
TOP_K = 5
# Adoption record 11 acceptance criteria (POC-03), fixed before the run.
MAX_P95_MS = 100.0
MIN_THROUGHPUT_FPS = 10.0


def load_split() -> tuple[
    list[str], list[torch.Tensor], list[int], list[int], list[int]
]:
    """Every fixture image preprocessed with the published V2 transforms, plus the SPI-15 split."""
    classes, paths, labels = load_fixture()
    train_index, eval_index = split_indices(labels, len(classes))
    # Enum metadata only; building the transform never downloads anything.
    preprocess = MobileNet_V3_Large_Weights.IMAGENET1K_V2.transforms()
    images: list[torch.Tensor] = []
    for path in paths:
        with Image.open(path) as image:
            images.append(preprocess(image.convert("RGB")).unsqueeze(0).contiguous())
    return classes, images, labels, train_index, eval_index


def load_images() -> list[torch.Tensor]:
    """The SPI-15 eval split."""
    _, images, _, _, eval_index = load_split()
    return [images[index] for index in eval_index]


def load_state() -> tuple[dict[str, Any], dict[str, Any]]:
    if not CHECKPOINT_PATH.exists():
        raise SystemExit(f"checkpoint not found: {CHECKPOINT_PATH}")
    digest = sha256_file(CHECKPOINT_PATH)
    if digest != EXPECTED_SHA256:
        raise SystemExit(
            f"checkpoint SHA-256 {digest} does not match the recorded "
            f"{EXPECTED_SHA256}; refusing to run"
        )
    state = torch.load(CHECKPOINT_PATH, map_location="cpu", weights_only=True)
    checkpoint = {
        "path": CHECKPOINT_PATH.relative_to(REPO_ROOT).as_posix(),
        "sha256": digest,
        "byte_size": CHECKPOINT_PATH.stat().st_size,
        "loaded_with": "torch.load(weights_only=True)",
        "state_dict_entries": len(state),
        "strict_load": True,
    }
    return state, checkpoint


def build_model_and_onnx(
    artifact_dir: Path, sample: torch.Tensor
) -> tuple[Any, dict[str, Any], Path]:
    state, checkpoint = load_state()
    model = mobilenet_v3_large(weights=None, num_classes=IMAGENET_CLASS_COUNT)
    model.load_state_dict(state, strict=True)
    model.eval()

    onnx_path = artifact_dir / "classification-checkpoint.onnx"
    torch.onnx.export(
        model,
        (sample,),
        str(onnx_path),
        input_names=["images"],
        output_names=["logits"],
        opset_version=OPSET_VERSION,
        dynamo=False,
    )
    onnx.checker.check_model(onnx.load(str(onnx_path)))
    export = {
        "opset": OPSET_VERSION,
        "exporter": "torch.onnx.export(dynamo=False)",
        "input_shape": list(sample.shape),
        "onnx_bytes": onnx_path.stat().st_size,
        "onnx_sha256": sha256_file(onnx_path),
    }
    return model, {"checkpoint": checkpoint, "export": export}, onnx_path


def run_onnx(
    onnx_path: Path, provider: str, images: list[torch.Tensor]
) -> tuple[np.ndarray, list[str]]:
    session = ort.InferenceSession(str(onnx_path), providers=[provider])
    logits = [session.run(["logits"], {"images": image.numpy()})[0] for image in images]
    return np.concatenate(logits), session.get_providers()


def compare(label: str, left: np.ndarray, right: np.ndarray) -> dict[str, Any]:
    logit_diff = float(np.abs(left - right).max())
    prob_diff = float(np.abs(softmax(left) - softmax(right)).max())
    top1 = int((left.argmax(axis=1) == right.argmax(axis=1)).sum())
    left_topk = np.argsort(-left, axis=1, kind="stable")[:, :TOP_K]
    right_topk = np.argsort(-right, axis=1, kind="stable")[:, :TOP_K]
    topk = int(sum(set(a) == set(b) for a, b in zip(left_topk, right_topk)))
    failures: list[str] = []
    if logit_diff > LOGIT_TOLERANCE:
        failures.append(
            f"{label} max_abs_logit_diff {logit_diff:.3e} > {LOGIT_TOLERANCE:.1e}"
        )
    if prob_diff > PROB_TOLERANCE:
        failures.append(
            f"{label} max_abs_prob_diff {prob_diff:.3e} > {PROB_TOLERANCE:.1e}"
        )
    if top1 != left.shape[0]:
        failures.append(f"{label} top1_agreement {top1}/{left.shape[0]}")
    if topk != left.shape[0]:
        failures.append(f"{label} top{TOP_K}_set_agreement {topk}/{left.shape[0]}")
    return {
        "comparison": label,
        "verdict": "FAIL" if failures else "PASS",
        "failures": failures,
        "max_abs_logit_diff": logit_diff,
        "max_abs_prob_diff": prob_diff,
        "top1_agreement": f"{top1}/{left.shape[0]}",
        f"top{TOP_K}_set_agreement": f"{topk}/{left.shape[0]}",
    }


def run_transfer() -> dict[str, Any]:
    """Adoption record 11 accuracy: fine-tune from this checkpoint vs random init, same recipe."""
    classes, images, labels, train_index, eval_index = load_split()
    inputs = torch.cat(images)
    targets = torch.tensor(labels, dtype=torch.long)
    state, checkpoint = load_state()
    runs: dict[str, Any] = {}
    for init in ("checkpoint", "random"):
        torch.manual_seed(SEED)
        model = mobilenet_v3_large(weights=None, num_classes=IMAGENET_CLASS_COUNT)
        if init == "checkpoint":
            model.load_state_dict(state, strict=True)
        model.classifier[-1] = nn.Linear(model.classifier[-1].in_features, len(classes))
        losses = train_model(model, inputs[train_index], targets[train_index])
        model.eval()
        with torch.no_grad():
            predicted = model(inputs[eval_index]).argmax(dim=1)
        correct = int((predicted == targets[eval_index]).sum())
        runs[init] = {
            "eval_top1_correct": f"{correct}/{len(eval_index)}",
            "eval_top1_accuracy": correct / len(eval_index),
            "epoch_mean_loss": [round(value, 6) for value in losses],
        }
    passed = (
        runs["checkpoint"]["eval_top1_accuracy"] >= runs["random"]["eval_top1_accuracy"]
    )
    return {
        "verdict": "PASS" if passed else "FAIL",
        "criterion": "checkpoint-initialised eval top-1 accuracy >= random-initialised, identical recipe",
        "checkpoint": checkpoint,
        "recipe": "classification.train_model defaults (SPI-15), classifier[-1] replaced",
        "classes": classes,
        "train_images": len(train_index),
        "eval_images": len(eval_index),
        "runs": runs,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="G2R-12 C6 classification checkpoint probe"
    )
    parser.add_argument(
        "--mode", choices=("parity", "performance", "transfer"), default="parity"
    )
    parser.add_argument(
        "--artifact-dir",
        type=Path,
        help="directory that receives the exported ONNX model (git-ignored); parity/performance",
    )
    args = parser.parse_args()

    torch.manual_seed(SEED)
    torch.set_num_threads(1)
    if args.mode == "transfer":
        torch.use_deterministic_algorithms(True)
        result = {
            "task": "G2R-12 C6 classification transfer accuracy",
            **run_transfer(),
        }
        json.dump(result, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0 if result["verdict"] == "PASS" else 1

    if args.artifact_dir is None:
        parser.error("--artifact-dir is required in parity and performance mode")
    artifact_dir: Path = args.artifact_dir
    artifact_dir.mkdir(parents=True, exist_ok=True)

    available = ort.get_available_providers()
    if DML_PROVIDER not in available:
        raise SystemExit(f"{DML_PROVIDER} is not available ({available})")

    images = load_images()
    model, meta, onnx_path = build_model_and_onnx(artifact_dir, images[0])

    result: dict[str, Any] = {
        "task": f"G2R-12 C6 classification checkpoint {args.mode}",
        "environment": {
            "python": platform.python_version(),
            "os": f"{platform.system()} {platform.version()}",
            "machine": platform.machine(),
            "torch": torch.__version__,
            "torchvision": torchvision.__version__,
            "onnx": onnx.__version__,
            "onnxruntime": ort.__version__,
            "available_providers": available,
        },
        **meta,
        "fixture": {
            "directory": "resources/samples/beans",
            "eval_images": len(images),
            "preprocess": "MobileNet_V3_Large_Weights.IMAGENET1K_V2.transforms()",
            "domain_note": "out-of-domain for an ImageNet-1k checkpoint; backends only",
        },
    }

    if args.mode == "performance":
        providers = [
            measure_latency(onnx_path, CPU_PROVIDER, images),
            measure_latency(onnx_path, DML_PROVIDER, images),
        ]
        failures = [
            f"{item['provider']} p95 {item['p95_ms']} ms > {MAX_P95_MS} ms"
            for item in providers
            if item["p95_ms"] > MAX_P95_MS
        ] + [
            f"{item['provider']} {item['throughput_fps']} fps < {MIN_THROUGHPUT_FPS} fps"
            for item in providers
            if item["throughput_fps"] < MIN_THROUGHPUT_FPS
        ]
        result["verdict"] = "FAIL" if failures else "PASS"
        result["failures"] = failures
        result["measurement"] = {
            "warmup_passes": WARMUP_PASSES,
            "measured_passes": MEASURED_PASSES,
            "percentile_method": "nearest-rank",
            "criteria": {
                "max_p95_ms": MAX_P95_MS,
                "min_throughput_fps": MIN_THROUGHPUT_FPS,
            },
            "memory_note": "cumulative process peak working set; includes the resident eager model",
        }
        result["providers"] = providers
        json.dump(result, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 1 if failures else 0

    with torch.no_grad():
        torch_logits = np.concatenate([model(image).numpy() for image in images])
    cpu_logits, cpu_providers = run_onnx(onnx_path, CPU_PROVIDER, images)
    dml_logits, dml_providers = run_onnx(onnx_path, DML_PROVIDER, images)
    cpu_repeat, _ = run_onnx(onnx_path, CPU_PROVIDER, images)
    dml_repeat, _ = run_onnx(onnx_path, DML_PROVIDER, images)

    comparisons = [
        compare("torch vs onnxruntime-cpu", torch_logits, cpu_logits),
        compare("torch vs onnxruntime-directml", torch_logits, dml_logits),
        compare("onnxruntime-cpu vs onnxruntime-directml", cpu_logits, dml_logits),
    ]
    repeat = {
        "cpu_bitwise_identical": bool(np.array_equal(cpu_logits, cpu_repeat)),
        "directml_bitwise_identical": bool(np.array_equal(dml_logits, dml_repeat)),
    }
    failures = [failure for item in comparisons for failure in item["failures"]]
    failures += [
        f"repeat run not identical: {key}" for key, same in repeat.items() if not same
    ]
    result.update(
        {
            "verdict": "FAIL" if failures else "PASS",
            "failures": failures,
            "session_providers": {"cpu": cpu_providers, "directml": dml_providers},
            "tolerances": {"logit": LOGIT_TOLERANCE, "prob": PROB_TOLERANCE},
            "comparisons": comparisons,
            "repeat_run": repeat,
        }
    )
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
