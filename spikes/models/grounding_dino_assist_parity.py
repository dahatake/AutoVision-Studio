"""G2R-32: backend parity and inference performance of the C7 detection assist model.

Model: Hugging Face ``IDEA-Research/grounding-dino-tiny`` revision
``a2bb814dd30d776dcf7e30523b00659f4f141c71`` (``model.safetensors`` plus the
processor / tokenizer files of the same revision), read from
``vendor/models/_spike/gd-tiny`` (git-ignored). This is **not** the GitHub
release ``groundingdino_swint_ogc.pth``.

fail-closed boundaries kept by this probe:

* ``model.safetensors`` must match the publisher SHA-256 recorded in
  ``docs/model-governance/grounding-dino-tiny-adoption.md`` §1.
* ``local_files_only=True`` and ``use_safetensors=True``; transformers' own
  ``GroundingDinoForObjectDetection`` is used and no remote code is executed.
* Detections are compared with the SPI-12 / SPI-16 protocol reused from
  ``detection_checkpoint_parity.compare`` (score floor, IoU matching, box and
  score tolerances fixed before the run). A measurement above tolerance is
  ``FAIL``.
* The prompt names the fixture object (wheat heads, ``resources/samples/gwhd-2021``).
  The probe compares backends and makes no accuracy or quality claim.
* Measurement is evidence, not approval. The probe never edits the manifest.
"""

from __future__ import annotations

import argparse
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
import transformers
from detection import (
    ANNOTATION_FILE,
    FIXTURE_DIR,
    REPO_ROOT,
    SEED,
    filter_detections,
    sha256_file,
)
from detection_checkpoint_parity import (
    CPU_PROVIDER,
    DML_PROVIDER,
    EVAL_IMAGES,
    MEASURED_PASSES,
    WARMUP_PASSES,
    compare,
    peak_working_set_bytes,
    percentile,
)
from PIL import Image
from torch import nn
from transformers import AutoProcessor, GroundingDinoForObjectDetection

MODEL_DIR = REPO_ROOT / "vendor" / "models" / "_spike" / "gd-tiny"
EXPECTED_SHA256 = "1a2412ef99bd74bcd3c2a246fa1e48581f8889a1300c9051974741314fc042f3"
OPSET_VERSION = 17
PROMPT = "wheat head."
INPUT_NAMES = [
    "pixel_values",
    "input_ids",
    "attention_mask",
    "token_type_ids",
    "pixel_mask",
]


class Detector(nn.Module):
    def __init__(self, model: GroundingDinoForObjectDetection) -> None:
        super().__init__()
        self.model = model

    def forward(
        self, pixel_values, input_ids, attention_mask, token_type_ids, pixel_mask
    ):
        output = self.model(
            pixel_values=pixel_values,
            input_ids=input_ids,
            attention_mask=attention_mask,
            token_type_ids=token_type_ids,
            pixel_mask=pixel_mask,
        )
        return output.logits, output.pred_boxes


def exportable_text_masks(input_ids: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    """Same result as transformers' ``generate_masks_with_special_tokens_and_transfer_map``
    (5.17.0) without the ops that block export: the TorchScript exporter has no opset 17
    symbolic for ``isin`` / ``cummax`` / ``cummin``, and ONNX Runtime has no bool
    ``EyeLike`` kernel. Prefix max / suffix min are written as masked reductions."""
    grounding_dino = transformers.models.grounding_dino.modeling_grounding_dino
    batch_size, seq_len = input_ids.shape
    special_tokens = torch.tensor(
        grounding_dino.SPECIAL_TOKENS, device=input_ids.device
    )
    special_mask = (input_ids.unsqueeze(-1) == special_tokens).any(dim=-1)
    indices = (
        torch.arange(seq_len, device=input_ids.device)
        .unsqueeze(0)
        .expand(batch_size, -1)
    )
    at_or_before = indices.unsqueeze(2) >= indices.unsqueeze(1)  # [i, j]: j <= i

    prev_candidates = torch.where(special_mask, indices, torch.full_like(indices, -1))
    prev_special = torch.where(at_or_before, prev_candidates.unsqueeze(1), -1).amax(
        dim=-1
    )
    next_candidates = torch.where(
        special_mask, indices, torch.full_like(indices, seq_len)
    )
    next_special = torch.where(
        at_or_before.transpose(1, 2), next_candidates.unsqueeze(1), seq_len
    ).amin(dim=-1)

    valid_block = (
        (next_special != 0) & (next_special != seq_len - 1) & (next_special != seq_len)
    )
    attention_mask = (
        next_special.unsqueeze(2) == next_special.unsqueeze(1)
    ) & valid_block.unsqueeze(1)
    attention_mask = (indices.unsqueeze(2) == indices.unsqueeze(1)) | attention_mask
    position_ids = torch.where(
        valid_block, indices - prev_special - 1, torch.zeros_like(indices)
    )
    return attention_mask, torch.clamp(position_ids, min=0).to(torch.long)


class export_text_masks:
    """Use ``exportable_text_masks`` while tracing only. Eager inference keeps the
    transformers original, so the parity comparison also covers the rewrite."""

    def __enter__(self) -> None:
        self.module = transformers.models.grounding_dino.modeling_grounding_dino
        self.saved = self.module.generate_masks_with_special_tokens_and_transfer_map
        self.module.generate_masks_with_special_tokens_and_transfer_map = (
            exportable_text_masks
        )

    def __exit__(self, *_: object) -> None:
        self.module.generate_masks_with_special_tokens_and_transfer_map = self.saved


def cast_grid_sample_grids_to_float(path: Path) -> int:
    """The TorchScript exporter types the deformable-attention sampling grid as
    float64, for which ONNX Runtime has no GridSample kernel. Eager PyTorch samples
    with a float32 grid, so a Cast to float32 restores the eager dtype."""
    model = onnx.load(str(path))
    inferred = onnx.shape_inference.infer_shapes(model)
    dtypes = {
        value.name: value.type.tensor_type.elem_type
        for value in list(inferred.graph.value_info) + list(inferred.graph.input)
    }
    patched = 0
    nodes = []
    for node in model.graph.node:
        if (
            node.op_type == "GridSample"
            and dtypes.get(node.input[1]) == onnx.TensorProto.DOUBLE
        ):
            cast_output = f"{node.input[1]}_as_float"
            nodes.append(
                onnx.helper.make_node(
                    "Cast", [node.input[1]], [cast_output], to=onnx.TensorProto.FLOAT
                )
            )
            node.input[1] = cast_output
            patched += 1
        nodes.append(node)
    del model.graph.node[:]
    model.graph.node.extend(nodes)
    onnx.save(model, str(path))
    return patched


def to_detections(logits: np.ndarray, boxes: np.ndarray, width: int, height: int):
    """Per-query score = max sigmoid over text tokens, as the processor post-process does."""
    probs = 1.0 / (1.0 + np.exp(-logits[0]))
    scores = probs.max(axis=-1)
    labels = probs.argmax(axis=-1)
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
    return filter_detections(xyxy, scores, labels)


def load_inputs(processor: Any) -> list[dict[str, np.ndarray]]:
    coco = json.loads(ANNOTATION_FILE.read_text(encoding="utf-8"))
    records = sorted(coco["images"], key=lambda item: int(item["id"]))[-EVAL_IMAGES:]
    inputs = []
    for record in records:
        with Image.open(FIXTURE_DIR / "images" / record["file_name"]) as image:
            encoded = processor(
                images=image.convert("RGB"), text=PROMPT, return_tensors="pt"
            )
        inputs.append({name: encoded[name].numpy() for name in INPUT_NAMES})
    return inputs


def measure(
    onnx_path: Path, provider: str, inputs: list[dict[str, np.ndarray]]
) -> dict[str, Any]:
    """Same protocol as detection_checkpoint_parity.measure_latency, for a multi-input graph."""
    session = ort.InferenceSession(str(onnx_path), providers=[provider])
    for _ in range(WARMUP_PASSES):
        for feed in inputs:
            session.run(None, feed)
    samples: list[float] = []
    for _ in range(MEASURED_PASSES):
        for feed in inputs:
            started = time.perf_counter()
            session.run(None, feed)
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


def main() -> int:
    parser = argparse.ArgumentParser(
        description="G2R-32 Grounding DINO tiny assist probe"
    )
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
    model = GroundingDinoForObjectDetection.from_pretrained(
        MODEL_DIR, local_files_only=True, use_safetensors=True
    ).eval()
    processor = AutoProcessor.from_pretrained(MODEL_DIR, local_files_only=True)
    inputs = load_inputs(processor)
    shapes = {name: list(inputs[0][name].shape) for name in INPUT_NAMES}
    if any(
        {name: list(feed[name].shape) for name in INPUT_NAMES} != shapes
        for feed in inputs
    ):
        raise SystemExit("fixture images do not share one processor output shape")
    height, width = shapes["pixel_values"][2:]

    sample_ids = torch.from_numpy(inputs[0]["input_ids"])
    original_masks = transformers.models.grounding_dino.modeling_grounding_dino.generate_masks_with_special_tokens_and_transfer_map(
        sample_ids
    )
    if not all(
        torch.equal(a, b)
        for a, b in zip(original_masks, exportable_text_masks(sample_ids))
    ):
        raise SystemExit("exportable_text_masks differs from the transformers original")

    detector = Detector(model)
    onnx_path = artifact_dir / "grounding-dino-tiny.onnx"
    with export_text_masks():
        torch.onnx.export(
            detector,
            tuple(torch.from_numpy(inputs[0][name]) for name in INPUT_NAMES),
            str(onnx_path),
            input_names=INPUT_NAMES,
            output_names=["logits", "pred_boxes"],
            opset_version=OPSET_VERSION,
            dynamo=False,
        )
    grid_casts = cast_grid_sample_grids_to_float(onnx_path)
    onnx.checker.check_model(str(onnx_path))

    result: dict[str, Any] = {
        "task": f"G2R-32 C7 detection assist {args.mode}",
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
            "loaded_with": "GroundingDinoForObjectDetection.from_pretrained(local_files_only, use_safetensors)",
        },
        "export": {
            "opset": OPSET_VERSION,
            "exporter": "torch.onnx.export(dynamo=False)",
            "input_shapes": shapes,
            "export_rewrites": {
                "text_masks": "exportable_text_masks (checked equal to the transformers original on the fixture input_ids)",
                "grid_sample_grid_float64_to_float32_casts": grid_casts,
            },
            "onnx_bytes": onnx_path.stat().st_size,
            "onnx_sha256": sha256_file(onnx_path),
        },
        "fixture": {
            "directory": "resources/samples/gwhd-2021",
            "eval_images": len(inputs),
            "prompt": PROMPT,
        },
    }

    if args.mode == "performance":
        result["verdict"] = "MEASURED"
        result["measurement"] = {
            "warmup_passes": WARMUP_PASSES,
            "measured_passes": MEASURED_PASSES,
            "percentile_method": "nearest-rank",
            "memory_note": "cumulative process peak working set; includes the resident eager model",
        }
        result["providers"] = [
            measure(onnx_path, CPU_PROVIDER, inputs),
            measure(onnx_path, DML_PROVIDER, inputs),
        ]
        json.dump(result, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    backends: dict[str, list[Any]] = {"torch": []}
    raw: dict[str, list[np.ndarray]] = {}
    with torch.no_grad():
        for feed in inputs:
            logits, boxes = detector(
                *(torch.from_numpy(feed[name]) for name in INPUT_NAMES)
            )
            backends["torch"].append(
                to_detections(logits.numpy(), boxes.numpy(), width, height)
            )
    providers: dict[str, list[str]] = {}
    repeat: dict[str, bool] = {}
    for key, provider in (
        ("onnxruntime-cpu", CPU_PROVIDER),
        ("onnxruntime-directml", DML_PROVIDER),
    ):
        session = ort.InferenceSession(str(onnx_path), providers=[provider])
        providers[key] = session.get_providers()
        first = [session.run(None, feed) for feed in inputs]
        second = [session.run(None, feed) for feed in inputs]
        repeat[key] = all(
            np.array_equal(a, b)
            for left, right in zip(first, second)
            for a, b in zip(left, right)
        )
        raw[key] = first
        backends[key] = [to_detections(out[0], out[1], width, height) for out in first]

    comparisons = [
        compare(
            "torch vs onnxruntime-cpu", backends["torch"], backends["onnxruntime-cpu"]
        ),
        compare(
            "torch vs onnxruntime-directml",
            backends["torch"],
            backends["onnxruntime-directml"],
        ),
        compare(
            "onnxruntime-cpu vs onnxruntime-directml",
            backends["onnxruntime-cpu"],
            backends["onnxruntime-directml"],
        ),
    ]
    failures = [failure for item in comparisons for failure in item["failures"]]
    failures += [
        f"repeat run not bitwise identical: {key}"
        for key, same in repeat.items()
        if not same
    ]
    torch_scores = np.concatenate([det[1] for det in backends["torch"]])
    result.update(
        {
            "verdict": "FAIL" if failures else "PASS",
            "failures": failures,
            "session_providers": providers,
            "comparisons": [
                {k: v for k, v in item.items() if k != "per_image"}
                for item in comparisons
            ],
            "repeat_run_bitwise_identical": repeat,
            "torch_detections_at_score_floor": int(torch_scores.size),
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
