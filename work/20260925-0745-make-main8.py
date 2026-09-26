"""G2A-01 を新しい実行 ID（main8）で記録し直し、G2A-03・G2D-08 を直列に行うための graph・契約を main7 から作る。

main7（実行 8c3df57e-0c2c-4806-9be9-7eb74c082560）では G2A-01 と G2A-02 を同じ worktree で並列に進めたため、
`work/20260924-0620-atg-node.py end` の書込み検査が G2A-02 の変更を G2A-01 の宣言外書込みとして数え、
G2A-01 を `--class contract` で失敗にした（再試行不可。work/20260925-0745-Gate2Main7-Acceptance.md）。
G2A-02 は main7 で終端済み（保留）のため含めない。node の定義は main7 と同じにする。
"""
import json
from pathlib import Path

W = Path('work')
g7 = json.loads((W / '20260925-0745-atg-graph-main7.json').read_text(encoding='utf-8'))
c7 = json.loads((W / '20260925-0745-atg-contract-main7.json').read_text(encoding='utf-8'))
nodes = [n for n in g7['nodes'] if n['id'] in ('G2A-01', 'G2A-03', 'G2D-08')]
assert [n['id'] for n in nodes] == ['G2A-01', 'G2A-03', 'G2D-08'], [n['id'] for n in nodes]
(W / '20260925-0745-atg-graph-main8.json').write_text(
    json.dumps({'nodes': nodes}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
c7['objective'] = (
    'G2A-01 を新しい実行 ID で記録し直し、G2A-03・G2D-08 を直列に行う（main7 の実行 '
    '8c3df57e-0c2c-4806-9be9-7eb74c082560 で、並列の G2A-02 の変更を宣言外書込みとして数えた補助 script の'
    '誤判定により G2A-01 が failed になったため）。node の定義と所有者の判断は main7 と同じ。OWL-ViT（G2A-02）は main7 で保留として終端済み'
)
c7['deliverables'] = sorted({p for n in nodes for p in n['contract']['outputs']})
(W / '20260925-0745-atg-contract-main8.json').write_text(
    json.dumps(c7, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
