"""SPI-15 / G2-05: classification train -> ONNX export -> CPU inference parity probe.

fail-closed boundaries kept by this probe:

* No pretrained checkpoint is downloaded, loaded or bundled. SPI-11
  (``docs/model-governance/classification-base.md``) keeps every classification
  C6 candidate at ``HOLD``, so the probe builds the torchvision architecture
  code (C5) with randomly initialised weights only.
* The fixture is ``resources/samples/beans`` (MIT, rights reviewed in
  ``resources/samples/beans/ATTRIBUTION.txt``).
* The probe measures the train -> export -> CPU inference output difference.
  A measured difference above the declared tolerance is reported as a failure,
  never rounded away.
* ``--mode automl-mini-run`` measures the wall-clock cost of one Optuna trial
  on this Windows host so that D-15 can record a finite AutoML budget from a
  measurement instead of a guess. The mini-run optimises nothing that is
  released; its accuracy numbers are not a quality claim.
"""

from __future__ import annotations

import argparse
import hashlib
import json
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
from PIL import Image
from torch import Tensor, nn
from torchvision.models import mobilenet_v3_small

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / "resources" / "samples" / "beans" / "images"

IMAGE_SIZE = 128
SEED = 20260922
EPOCHS = 8
BATCH_SIZE = 8
LEARNING_RATE = 0.05
MOMENTUM = 0.9
EVAL_PER_CLASS = 5
OPSET_VERSION = 17
LOGIT_TOLERANCE = 1.0e-4
PROB_TOLERANCE = 1.0e-5
MINI_RUN_TRIALS = 8
MINI_RUN_EPOCHS = 4


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_fixture() -> tuple[list[str], list[Path], list[int]]:
    classes = sorted(p.name for p in FIXTURE_DIR.iterdir() if p.is_dir())
    if not classes:
        raise SystemExit(f"fixture classes not found under {FIXTURE_DIR}")
    paths: list[Path] = []
    labels: list[int] = []
    for index, name in enumerate(classes):
        for image_path in sorted((FIXTURE_DIR / name).iterdir()):
            if image_path.is_file():
                paths.append(image_path)
                labels.append(index)
    return classes, paths, labels


def to_tensor(paths: list[Path]) -> Tensor:
    batch = np.empty((len(paths), 3, IMAGE_SIZE, IMAGE_SIZE), dtype=np.float32)
    for index, path in enumerate(paths):
        with Image.open(path) as image:
            rgb = image.convert("RGB").resize(
                (IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BILINEAR
            )
            array = np.asarray(rgb, dtype=np.float32) / 255.0
        batch[index] = np.transpose((array - 0.5) / 0.5, (2, 0, 1))
    return torch.from_numpy(batch)


def split_indices(labels: list[int], class_count: int) -> tuple[list[int], list[int]]:
    """Take the last EVAL_PER_CLASS items of each class as the eval split."""
    train: list[int] = []
    evaluation: list[int] = []
    for class_index in range(class_count):
        members = [i for i, label in enumerate(labels) if label == class_index]
        if len(members) <= EVAL_PER_CLASS:
            raise SystemExit(f"class {class_index} has too few fixture images")
        train.extend(members[:-EVAL_PER_CLASS])
        evaluation.extend(members[-EVAL_PER_CLASS:])
    return train, evaluation


def train_model(
    model: nn.Module,
    inputs: Tensor,
    targets: Tensor,
    epochs: int = EPOCHS,
    batch_size: int = BATCH_SIZE,
    learning_rate: float = LEARNING_RATE,
) -> list[float]:
    optimiser = torch.optim.SGD(model.parameters(), lr=learning_rate, momentum=MOMENTUM)
    criterion = nn.CrossEntropyLoss()
    generator = torch.Generator().manual_seed(SEED)
    losses: list[float] = []
    model.train()
    for _ in range(epochs):
        order = torch.randperm(inputs.shape[0], generator=generator)
        epoch_loss = 0.0
        batches = 0
        for start in range(0, order.numel(), batch_size):
            selection = order[start : start + batch_size]
            optimiser.zero_grad()
            loss = criterion(model(inputs[selection]), targets[selection])
            loss.backward()
            optimiser.step()
            epoch_loss += float(loss.detach())
            batches += 1
        losses.append(epoch_loss / batches)
    return losses


def softmax(values: np.ndarray) -> np.ndarray:
    shifted = values - values.max(axis=1, keepdims=True)
    exponent = np.exp(shifted)
    return exponent / exponent.sum(axis=1, keepdims=True)


def run_automl_mini_run(device: torch.device) -> int:
    """Measure the wall-clock cost of one Optuna trial on this Windows host."""
    import optuna

    optuna.logging.set_verbosity(optuna.logging.WARNING)

    classes, paths, labels = load_fixture()
    train_index, eval_index = split_indices(labels, len(classes))
    all_inputs = to_tensor(paths)
    all_targets = torch.tensor(labels, dtype=torch.long)
    train_inputs = all_inputs[train_index].to(device)
    train_targets = all_targets[train_index].to(device)
    eval_inputs = all_inputs[eval_index].to(device)
    eval_targets = all_targets[eval_index].to(device)

    trials: list[dict[str, Any]] = []

    def objective(trial: optuna.Trial) -> float:
        learning_rate = trial.suggest_float("learning_rate", 1e-3, 1e-1, log=True)
        batch_size = trial.suggest_categorical("batch_size", [4, 8, 16])
        started = time.perf_counter()
        torch.manual_seed(SEED)
        model = mobilenet_v3_small(weights=None, num_classes=len(classes)).to(device)
        train_model(
            model,
            train_inputs,
            train_targets,
            epochs=MINI_RUN_EPOCHS,
            batch_size=batch_size,
            learning_rate=learning_rate,
        )
        model.eval()
        with torch.no_grad():
            predicted = model(eval_inputs).argmax(dim=1)
        accuracy = float((predicted == eval_targets).float().mean())
        if device.type == "cuda":
            torch.cuda.synchronize()
        seconds = time.perf_counter() - started
        trials.append(
            {
                "number": trial.number,
                "learning_rate": round(learning_rate, 6),
                "batch_size": batch_size,
                "eval_accuracy": round(accuracy, 4),
                "seconds": round(seconds, 3),
            }
        )
        return accuracy

    study_started = time.perf_counter()
    study = optuna.create_study(
        direction="maximize", sampler=optuna.samplers.TPESampler(seed=SEED)
    )
    study.optimize(objective, n_trials=MINI_RUN_TRIALS)
    study_seconds = time.perf_counter() - study_started

    durations = sorted(trial["seconds"] for trial in trials)
    median = (
        durations[len(durations) // 2]
        if len(durations) % 2
        else (durations[len(durations) // 2 - 1] + durations[len(durations) // 2]) / 2
    )
    result: dict[str, Any] = {
        "task": "D-15 / G2-08 AutoML mini-run trial cost",
        "verdict": "MEASURED",
        "scope_limits": {
            "pretrained_checkpoint_used": False,
            "purpose": "wall-clock trial cost only",
            "not_covered": [
                "search-space quality",
                "accuracy acceptance (eval_accuracy is not a quality claim)",
                "DirectML training",
                "dataset sizes other than the measured fixture",
            ]
            + (["CUDA training"] if device.type == "cpu" else ["CPU training"]),
        },
        "environment": {
            "python": platform.python_version(),
            "os": f"{platform.system()} {platform.version()}",
            "machine": platform.machine(),
            "processor": platform.processor(),
            "torch": torch.__version__,
            "optuna": optuna.__version__,
            "device": device.type,
            "cuda_build": torch.version.cuda,
            "gpu": (
                torch.cuda.get_device_name(device) if device.type == "cuda" else None
            ),
            "torch_threads": torch.get_num_threads(),
        },
        "mini_run": {
            "sampler": "TPESampler",
            "seed": SEED,
            "trials": MINI_RUN_TRIALS,
            "epochs_per_trial": MINI_RUN_EPOCHS,
            "train_images": len(train_index),
            "eval_images": len(eval_index),
            "image_size": IMAGE_SIZE,
            "search_space": {
                "learning_rate": "log-uniform 1e-3..1e-1",
                "batch_size": [4, 8, 16],
            },
            "per_trial": trials,
            "min_trial_seconds": durations[0],
            "median_trial_seconds": median,
            "max_trial_seconds": durations[-1],
            "total_study_seconds": round(study_seconds, 3),
            "best_value": round(float(study.best_value), 4),
        },
    }
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="SPI-15 classification parity probe")
    parser.add_argument(
        "--mode",
        choices=("parity", "automl-mini-run"),
        default="parity",
        help="parity: SPI-15 train/export parity. automl-mini-run: D-15 trial cost",
    )
    parser.add_argument(
        "--device",
        choices=("cpu", "cuda"),
        default="cpu",
        help="device for the AutoML mini-run (D-15 requires CPU and CUDA budgets)",
    )
    parser.add_argument(
        "--artifact-dir",
        type=Path,
        help="directory that receives the exported ONNX model (parity mode only)",
    )
    args = parser.parse_args()

    device = torch.device(args.device)
    torch.manual_seed(SEED)
    torch.use_deterministic_algorithms(device.type == "cpu")
    if device.type == "cpu":
        torch.set_num_threads(1)

    if args.mode == "automl-mini-run":
        return run_automl_mini_run(device)

    if args.device != "cpu":
        parser.error(
            "parity mode always runs on the CPU; --device applies to automl-mini-run"
        )
    if args.artifact_dir is None:
        parser.error("--artifact-dir is required in parity mode")
    artifact_dir: Path = args.artifact_dir
    artifact_dir.mkdir(parents=True, exist_ok=True)

    classes, paths, labels = load_fixture()
    train_index, eval_index = split_indices(labels, len(classes))
    all_inputs = to_tensor(paths)
    all_targets = torch.tensor(labels, dtype=torch.long)

    model = mobilenet_v3_small(weights=None, num_classes=len(classes))
    train_started = time.perf_counter()
    losses = train_model(model, all_inputs[train_index], all_targets[train_index])
    train_seconds = time.perf_counter() - train_started

    model.eval()
    eval_inputs = all_inputs[eval_index].contiguous()
    with torch.no_grad():
        torch_logits = model(eval_inputs).numpy()

    onnx_path = artifact_dir / "classification.onnx"
    export_started = time.perf_counter()
    torch.onnx.export(
        model,
        (eval_inputs[:1],),
        str(onnx_path),
        input_names=["images"],
        output_names=["logits"],
        dynamic_axes={"images": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=OPSET_VERSION,
        dynamo=False,
    )
    export_seconds = time.perf_counter() - export_started
    onnx.checker.check_model(onnx.load(str(onnx_path)))

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    infer_started = time.perf_counter()
    onnx_logits = session.run(["logits"], {"images": eval_inputs.numpy()})[0]
    infer_seconds = time.perf_counter() - infer_started

    logit_diff = np.abs(torch_logits - onnx_logits)
    torch_probs = softmax(torch_logits)
    onnx_probs = softmax(onnx_logits)
    prob_diff = np.abs(torch_probs - onnx_probs)
    torch_top1 = torch_logits.argmax(axis=1)
    onnx_top1 = onnx_logits.argmax(axis=1)
    agreement = int((torch_top1 == onnx_top1).sum())

    max_logit_diff = float(logit_diff.max())
    max_prob_diff = float(prob_diff.max())
    failures: list[str] = []
    if max_logit_diff > LOGIT_TOLERANCE:
        failures.append(
            f"max_abs_logit_diff {max_logit_diff:.3e} > tolerance {LOGIT_TOLERANCE:.1e}"
        )
    if max_prob_diff > PROB_TOLERANCE:
        failures.append(
            f"max_abs_prob_diff {max_prob_diff:.3e} > tolerance {PROB_TOLERANCE:.1e}"
        )
    if agreement != len(eval_index):
        failures.append(
            f"top1_agreement {agreement}/{len(eval_index)} is not unanimous"
        )

    result: dict[str, Any] = {
        "task": "SPI-15 / G2-05 classification train-export parity",
        "verdict": "FAIL" if failures else "PASS",
        "failures": failures,
        "scope_limits": {
            "pretrained_checkpoint_used": False,
            "weight_initialisation": "random (torchvision default init)",
            "reason": "SPI-11 keeps every classification C6 candidate at HOLD",
            "not_covered": [
                "approved base weight fine-tuning",
                "accuracy or quality acceptance",
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
            "classes": classes,
            "image_count": len(paths),
            "train_images": len(train_index),
            "eval_images": len(eval_index),
            "image_size": IMAGE_SIZE,
        },
        "training": {
            "architecture": "torchvision mobilenet_v3_small",
            "seed": SEED,
            "epochs": EPOCHS,
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
            "tolerance_logit": LOGIT_TOLERANCE,
            "tolerance_prob": PROB_TOLERANCE,
            "max_abs_logit_diff": max_logit_diff,
            "mean_abs_logit_diff": float(logit_diff.mean()),
            "max_abs_prob_diff": max_prob_diff,
            "mean_abs_prob_diff": float(prob_diff.mean()),
            "top1_agreement": f"{agreement}/{len(eval_index)}",
            "onnx_cpu_inference_seconds": round(infer_seconds, 3),
        },
    }
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
