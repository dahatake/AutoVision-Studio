"""G2Q-03C を新しい実行 ID（main5）で記録し直すための graph・契約を main4 から作る。

main4 では G2Q-03C と G2Q-03D を同じ worktree で並列に進めたため、`work/20260924-0620-atg-node.py end` の
書込み検査が G2Q-03D の変更（owlvit の 2 file）を G2Q-03C の宣言外書込みとして数え、G2Q-03C を
`--class contract` で失敗にした（再試行不可）。G2Q-03C の node の定義は main4 と同じにする。
"""
import json
from pathlib import Path

W = Path('work')
g4 = json.loads((W / '20260925-0420-atg-graph-main4.json').read_text(encoding='utf-8'))
c4 = json.loads((W / '20260925-0420-atg-contract-main4.json').read_text(encoding='utf-8'))
nodes = [n for n in g4['nodes'] if n['id'] == 'G2Q-03C']
(W / '20260925-0420-atg-graph-main5.json').write_text(
    json.dumps({'nodes': nodes}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
c4['objective'] = (
    'G2Q-03C を新しい実行 ID で記録し直す（main4 の実行 84e8cb29-8aa9-40b6-bcab-411bfae30eff で、並列の '
    'G2Q-03D の変更を宣言外書込みとして数えた補助 script の誤判定により failed になったため）。node の定義・'
    '方針 A（docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03.md、'
    'work/20260925-0420-G2Q03-ExecutionPlan.md §1）は main4 と同じ'
)
c4['deliverables'] = nodes[0]['contract']['outputs']
(W / '20260925-0420-atg-contract-main5.json').write_text(
    json.dumps(c4, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
