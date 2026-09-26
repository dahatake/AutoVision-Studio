"""G2Q-03D（main6）の一時確認: goldset 専用の関数が backend 自身の box を使うこと。

work/20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md §5.3 の合成入力の確認。件数を変えずに
ONNX 側の 1 box だけが gold との IoU 0.5 の境界をまたぐとき、その backend の F1 が torch と異なり、
detection_parity は IoU 0.99 未満の対応を失敗にすることを確かめる。
使い方: spikes\\models で ..\\..\\vendor\\models\\_spike\\venv\\Scripts\\python.exe ..\\..\\work\\20260925-0526-check-f1-synthetic.py
"""

import sys

import numpy as np

sys.path.insert(0, ".")
from owlvit_assist_parity import all_patches, backend_f1, detection_parity

size = [(100, 100)]
gold = [np.array([[40.0, 40.0, 60.0, 60.0]])]
logits = np.array([[[5.0]]], dtype=np.float32)  # 1 patch, 1 query
same = np.array([[[0.5, 0.5, 0.2, 0.2]]], dtype=np.float32)  # IoU 1.0 with gold
shifted = np.array(
    [[[0.57, 0.5, 0.2, 0.2]]], dtype=np.float32
)  # IoU 260/540 = 0.48 < 0.5

torch_f1 = backend_f1([[logits, same]], size, gold, 0.5)
onnx_f1 = backend_f1([[logits, shifted]], size, gold, 0.5)
assert torch_f1["proposals"] == onnx_f1["proposals"] == 1
assert torch_f1["f1"] == 1.0 and onnx_f1["f1"] == 0.0, (torch_f1, onnx_f1)

det = [all_patches(logits, same, 100, 100)]
moved = [all_patches(logits, shifted, 100, 100)]
assert not detection_parity("same", det, det)["failures"]
bad = detection_parity("moved", det, moved)
assert bad["left_only_detections"] == 1 and bad["failures"], bad
print("synthetic A2/A3: OK", torch_f1["f1"], onnx_f1["f1"])
