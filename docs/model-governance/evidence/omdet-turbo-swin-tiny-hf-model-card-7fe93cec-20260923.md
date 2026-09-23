---
license: apache-2.0
pipeline_tag: zero-shot-object-detection
---

# OmDet model 

The OmDet model was proposed in [Real-time Transformer-based Open-Vocabulary Detection with Efficient Fusion Head](https://arxiv.org/abs/2403.06892) by Tiancheng Zhao, Peng Liu, Xuan He, Lu Zhang, Kyusong Lee from Om AI Lab. 

# Github Repository
If you like our model, please consider following our project on GitHub [OmDet](https://github.com/om-ai-lab/OmDet) to receive updates and information about new model releases.

We also invite you to explore our latest work on the Agents Framework [OmAgent](https://github.com/om-ai-lab/OmAgent).

# Intended use cases

This model is intended for zero-shot (also called open-vocabulary) object detection.

# Usage

## Single image inference

Here's how to load the model and prepare the inputs to perform zero-shot object detection on a single image:

```python
import requests
from PIL import Image

from transformers import AutoProcessor, OmDetTurboForObjectDetection

processor = AutoProcessor.from_pretrained("omlab/omdet-turbo-swin-tiny-hf")
model = OmDetTurboForObjectDetection.from_pretrained("omlab/omdet-turbo-swin-tiny-hf")

url = "http://images.cocodataset.org/val2017/000000039769.jpg"
image = Image.open(requests.get(url, stream=True).raw)
classes = ["cat", "remote"]
inputs = processor(image, text=classes, return_tensors="pt")

outputs = model(**inputs)

# convert outputs (bounding boxes and class logits)
results = processor.post_process_grounded_object_detection(
    outputs,
    classes=classes,
    target_sizes=[image.size[::-1]],
    score_threshold=0.3,
    nms_threshold=0.3,
)[0]
for score, class_name, box in zip(
    results["scores"], results["classes"], results["boxes"]
):
    box = [round(i, 1) for i in box.tolist()]
    print(
        f"Detected {class_name} with confidence "
        f"{round(score.item(), 2)} at location {box}"
    )
```

## Batched images inference

OmDet-Turbo can perform batched multi-image inference, with support for different text prompts and classes in the same batch:

```python
>>> import torch
>>> import requests
>>> from io import BytesIO
>>> from PIL import Image
>>> from transformers import AutoProcessor, OmDetTurboForObjectDetection

>>> processor = AutoProcessor.from_pretrained("omlab/omdet-turbo-swin-tiny-hf")
>>> model = OmDetTurboForObjectDetection.from_pretrained("omlab/omdet-turbo-swin-tiny-hf")

>>> url1 = "http://images.cocodataset.org/val2017/000000039769.jpg"
>>> image1 = Image.open(BytesIO(requests.get(url1).content)).convert("RGB")
>>> classes1 = ["cat", "remote"]
>>> task1 = "Detect {}.".format(", ".join(classes1))

>>> url2 = "http://images.cocodataset.org/train2017/000000257813.jpg"
>>> image2 = Image.open(BytesIO(requests.get(url2).content)).convert("RGB")
>>> classes2 = ["boat"]
>>> task2 = "Detect everything that looks like a boat."

>>> url3 = "https://cdn.britannica.com/61/93061-050-99147DCE/Statue-of-Liberty-Island-New-York-Bay.jpg"
>>> image3 = Image.open(BytesIO(requests.get(url3).content)).convert("RGB")
>>> classes3 = ["statue", "trees"]
>>> task3 = "Focus on the foreground, detect statue and trees."

>>> inputs = processor(
...     images=[image1, image2, image3],
...     text=[classes1, classes2, classes3],
...     task=[task1, task2, task3],
...     return_tensors="pt",
... )

>>> with torch.no_grad():
...     outputs = model(**inputs)

>>> # convert outputs (bounding boxes and class logits)
>>> results = processor.post_process_grounded_object_detection(
...     outputs,
...     classes=[classes1, classes2, classes3],
...     target_sizes=[image1.size[::-1], image2.size[::-1], image3.size[::-1]],
...     score_threshold=0.2,
...     nms_threshold=0.3,
... )

>>> for i, result in enumerate(results):
...     for score, class_name, box in zip(
...         result["scores"], result["classes"], result["boxes"]
...     ):
...         box = [round(i, 1) for i in box.tolist()]
...         print(
...             f"Detected {class_name} with confidence "
...             f"{round(score.item(), 2)} at location {box} in image {i}"
...         )
Detected remote with confidence 0.77 at location [39.9, 70.4, 176.7, 118.0] in image 0
Detected cat with confidence 0.72 at location [11.6, 54.2, 314.8, 474.0] in image 0
Detected remote with confidence 0.56 at location [333.4, 75.8, 370.7, 187.0] in image 0
Detected cat with confidence 0.55 at location [345.2, 24.0, 639.8, 371.7] in image 0
Detected boat with confidence 0.32 at location [146.9, 219.8, 209.6, 250.7] in image 1
Detected boat with confidence 0.3 at location [319.1, 223.2, 403.2, 238.4] in image 1
Detected boat with confidence 0.27 at location [37.7, 220.3, 84.0, 235.9] in image 1
Detected boat with confidence 0.22 at location [407.9, 207.0, 441.7, 220.2] in image 1
Detected statue with confidence 0.73 at location [544.7, 210.2, 651.9, 502.8] in image 2
Detected trees with confidence 0.25 at location [3.9, 584.3, 391.4, 785.6] in image 2
Detected trees with confidence 0.25 at location [1.4, 621.2, 118.2, 787.8] in image 2
Detected statue with confidence 0.2 at location [428.1, 205.5, 767.3, 759.5] in image 2

```