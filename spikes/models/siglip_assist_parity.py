"""G2R-22: backend parity and inference performance of the C7 classification assist model.

Model: Hugging Face ``google/siglip-base-patch16-224`` revision
``7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed`` (``model.safetensors`` plus the
processor / tokenizer files of the same revision), read from
``vendor/models/_spike/siglip`` (git-ignored).

The assist pipeline is split the way the product would run it: the text tower
embeds the project's label prompts once, and the vision tower runs per image.
The displayed score for one label is ``sigmoid(logit_scale.exp() * cos + logit_bias)``,
which is the SigLIP pairwise score and is independent per label.

fail-closed boundaries kept by this probe:

* ``model.safetensors`` must match the publisher SHA-256 recorded in
  ``docs/model-governance/siglip-base-patch16-224-adoption.md`` §1.
* ``local_files_only=True`` and ``use_safetensors=True``; no remote code.
* Tolerances are fixed before the run: the displayed score uses the repository
  score tolerance (``detection.SCORE_TOLERANCE``) and top-1 must agree on every
  image. A measurement above tolerance is ``FAIL``.
* The prompts name the beans fixture classes. The probe compares backends and
  reports top-1 agreement with the fixture labels for information only; it makes
  no accuracy or quality claim.
* Measurement is evidence, not approval. The probe never edits the manifest.

C7C-02 adds one CPU improvement candidate only: the fp32 vision ONNX is
converted with ``onnxruntime.quantization.quantize_dynamic`` (default settings,
int8 weights). The int8 model is held to the same score tolerance and top-1
rule as the fp32 backends and is measured on the CPU provider only.
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
from classification import load_fixture, sha256_file, split_indices
from detection import REPO_ROOT, SCORE_TOLERANCE, SEED
from detection_checkpoint_parity import (
    CPU_PROVIDER,
    DML_PROVIDER,
    MEASURED_PASSES,
    WARMUP_PASSES,
    measure_latency,
)
from onnxruntime.quantization import quantize_dynamic
from PIL import Image
from torch import nn
from transformers import AutoProcessor, SiglipModel

MODEL_DIR = REPO_ROOT / "vendor" / "models" / "_spike" / "siglip"
EXPECTED_SHA256 = "2c63cb7d1f2e95ba501893cbb8faeb4ea9a3af295498d35097126228659c2af8"
OPSET_VERSION = 17
TEXT_LENGTH = 64
PROMPTS = {
    "angular_leaf_spot": "a photo of a bean leaf with angular leaf spot.",
    "bean_rust": "a photo of a bean leaf with bean rust.",
    "healthy": "a photo of a healthy bean leaf.",
}


class VisionTower(nn.Module):
    def __init__(self, model: SiglipModel) -> None:
        super().__init__()
        self.vision = model.vision_model

    def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
        embeds = self.vision(pixel_values=pixel_values).pooler_output
        return embeds / embeds.norm(p=2, dim=-1, keepdim=True)


class TextTower(nn.Module):
    def __init__(self, model: SiglipModel) -> None:
        super().__init__()
        self.text = model.text_model

    def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
        embeds = self.text(input_ids=input_ids).pooler_output
        return embeds / embeds.norm(p=2, dim=-1, keepdim=True)


def sigmoid(values: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-values))


def export(
    module: nn.Module, sample: torch.Tensor, name: str, path: Path
) -> dict[str, Any]:
    torch.onnx.export(
        module,
        (sample,),
        str(path),
        input_names=[name],
        output_names=["embeds"],
        opset_version=OPSET_VERSION,
        dynamo=False,
    )
    onnx.checker.check_model(str(path))
    return {
        "input_shape": list(sample.shape),
        "onnx_bytes": path.stat().st_size,
        "onnx_sha256": sha256_file(path),
    }


def run(
    path: Path, provider: str, name: str, inputs: list[np.ndarray]
) -> tuple[np.ndarray, list[str]]:
    session = ort.InferenceSession(str(path), providers=[provider])
    outputs = [session.run(["embeds"], {name: value})[0] for value in inputs]
    return np.concatenate(outputs), session.get_providers()


def main() -> int:
    parser = argparse.ArgumentParser(description="G2R-22 SigLIP assist probe")
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
    model = SiglipModel.from_pretrained(
        MODEL_DIR,
        local_files_only=True,
        use_safetensors=True,
        attn_implementation="eager",
    ).eval()
    processor = AutoProcessor.from_pretrained(MODEL_DIR, local_files_only=True)

    classes, paths, labels = load_fixture()
    _, eval_index = split_indices(labels, len(classes))
    pil_images = []
    for index in eval_index:
        with Image.open(paths[index]) as image:
            pil_images.append(image.convert("RGB"))
    pixel_values = [
        processor(images=image, return_tensors="pt")["pixel_values"].contiguous()
        for image in pil_images
    ]
    input_ids = processor(
        text=[PROMPTS[name] for name in classes],
        padding="max_length",
        max_length=TEXT_LENGTH,
        return_tensors="pt",
    )["input_ids"]

    vision_path = artifact_dir / "siglip-vision.onnx"
    text_path = artifact_dir / "siglip-text.onnx"
    exports = {
        "vision": export(
            VisionTower(model), pixel_values[0], "pixel_values", vision_path
        ),
        "text": export(TextTower(model), input_ids, "input_ids", text_path),
    }
    vision_int8_path = artifact_dir / "siglip-vision-int8.onnx"
    quantize_dynamic(vision_path, vision_int8_path)
    exports["vision_int8"] = {
        "method": "onnxruntime.quantization.quantize_dynamic (defaults)",
        "onnx_bytes": vision_int8_path.stat().st_size,
        "onnx_sha256": sha256_file(vision_int8_path),
    }
    scale = float(model.logit_scale.exp())
    bias = float(model.logit_bias)

    result: dict[str, Any] = {
        "task": f"G2R-22 C7 classification assist {args.mode}",
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
            "loaded_with": "SiglipModel.from_pretrained(local_files_only, use_safetensors)",
            "logit_scale_exp": scale,
            "logit_bias": bias,
        },
        "export": {
            "opset": OPSET_VERSION,
            "exporter": "torch.onnx.export(dynamo=False)",
            **exports,
        },
        "fixture": {
            "directory": "resources/samples/beans",
            "eval_images": len(pil_images),
            "prompts": PROMPTS,
        },
    }

    if args.mode == "performance":
        result["verdict"] = "MEASURED"
        result["measurement"] = {
            "warmup_passes": WARMUP_PASSES,
            "measured_passes": MEASURED_PASSES,
            "percentile_method": "nearest-rank",
            "per_image_path": "vision tower only; label prompts are embedded once per label set",
            "memory_note": "cumulative process peak working set; includes the resident eager model",
        }
        result["vision"] = [
            measure_latency(vision_path, CPU_PROVIDER, pixel_values),
            measure_latency(vision_path, DML_PROVIDER, pixel_values),
        ]
        result["vision_int8"] = [
            measure_latency(vision_int8_path, CPU_PROVIDER, pixel_values)
        ]
        result["text_once_per_label_set"] = [
            measure_latency(text_path, CPU_PROVIDER, [input_ids]),
            measure_latency(text_path, DML_PROVIDER, [input_ids]),
        ]
        json.dump(result, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    with torch.no_grad():
        reference = model(
            input_ids=input_ids, pixel_values=torch.cat(pixel_values)
        ).logits_per_image.numpy()
        torch_image = VisionTower(model)(torch.cat(pixel_values)).numpy()
        torch_text = TextTower(model)(input_ids).numpy()
    torch_scores = sigmoid(torch_image @ torch_text.T * scale + bias)

    backends: dict[str, np.ndarray] = {"torch": torch_scores}
    providers: dict[str, list[str]] = {}
    repeat: dict[str, bool] = {}
    for key, provider, vision in (
        ("onnxruntime-cpu", CPU_PROVIDER, vision_path),
        ("onnxruntime-directml", DML_PROVIDER, vision_path),
        ("onnxruntime-cpu-int8", CPU_PROVIDER, vision_int8_path),
    ):
        image_embeds, providers[key] = run(
            vision, provider, "pixel_values", [p.numpy() for p in pixel_values]
        )
        text_embeds, _ = run(text_path, provider, "input_ids", [input_ids.numpy()])
        backends[key] = sigmoid(image_embeds @ text_embeds.T * scale + bias)
        again, _ = run(
            vision, provider, "pixel_values", [p.numpy() for p in pixel_values]
        )
        repeat[key] = bool(np.array_equal(image_embeds, again))

    failures: list[str] = []
    split_diff = float(np.abs(sigmoid(reference) - torch_scores).max())
    if split_diff > SCORE_TOLERANCE:
        failures.append(
            f"split towers vs SiglipModel.forward score diff {split_diff:.3e}"
        )
    comparisons = []
    for left, right in (
        ("torch", "onnxruntime-cpu"),
        ("torch", "onnxruntime-directml"),
        ("onnxruntime-cpu", "onnxruntime-directml"),
        ("torch", "onnxruntime-cpu-int8"),
    ):
        diff = float(np.abs(backends[left] - backends[right]).max())
        top1 = int(
            (backends[left].argmax(axis=1) == backends[right].argmax(axis=1)).sum()
        )
        item_failures = []
        if diff > SCORE_TOLERANCE:
            item_failures.append(
                f"{left} vs {right} max_abs_score_diff {diff:.3e} > {SCORE_TOLERANCE:.1e}"
            )
        if top1 != len(eval_index):
            item_failures.append(
                f"{left} vs {right} top1_agreement {top1}/{len(eval_index)}"
            )
        failures += item_failures
        comparisons.append(
            {
                "comparison": f"{left} vs {right}",
                "verdict": "FAIL" if item_failures else "PASS",
                "max_abs_score_diff": diff,
                "top1_agreement": f"{top1}/{len(eval_index)}",
            }
        )
    failures += [
        f"repeat run not bitwise identical: {key}"
        for key, same in repeat.items()
        if not same
    ]

    eval_labels = np.array([labels[i] for i in eval_index])
    result.update(
        {
            "verdict": "FAIL" if failures else "PASS",
            "failures": failures,
            "session_providers": providers,
            "tolerances": {"score": SCORE_TOLERANCE, "top1": "unanimous"},
            "split_towers_vs_forward_max_abs_score_diff": split_diff,
            "comparisons": comparisons,
            "repeat_run_bitwise_identical": repeat,
            "observed_score_range": [
                float(torch_scores.min()),
                float(torch_scores.max()),
            ],
            "information_only_top1_vs_fixture_label": f"{int((torch_scores.argmax(axis=1) == eval_labels).sum())}/{len(eval_index)}",
        }
    )
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
