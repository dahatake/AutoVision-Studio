"""G2Q-03D を所有者の判断 G2Q-03D-T（選択 A）の判定で測り直すための graph・契約を main4 から作る（main6）。

判定の定義: docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03D-parity.md、
work/20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md §3・§5。
"""
import json
from pathlib import Path

W = Path('work')
g4 = json.loads((W / '20260925-0420-atg-graph-main4.json').read_text(encoding='utf-8'))
c4 = json.loads((W / '20260925-0420-atg-contract-main4.json').read_text(encoding='utf-8'))
node = next(n for n in g4['nodes'] if n['id'] == 'G2Q-03D')
review = 'work/20260925-0526-Gate2Main6-G2Q-03D-Review.md'
node['write_set'] = [review if p.endswith('-G2Q-03D-Review.md') else p for p in node['write_set']]
contract = node['contract']
contract['outputs'] = [review if p.endswith('-G2Q-03D-Review.md') else p for p in contract['outputs']]
contract['inputs'] = [
    p for p in contract['inputs'] if p != 'work/20260925-0420-Gate2Main4-verify.ps1'
] + [
    'work/20260925-0526-Gate2Main6-verify.ps1',
    'work/20260925-0526-G2Q03D-BoxTolerance-Countermeasure.md',
    'docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03D-parity.md',
    'work/20260925-0526-check-parity-A.py',
]
contract['verify_command'] = (
    'pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File work/20260925-0526-Gate2Main6-verify.ps1 G2Q-03D'
)
(W / '20260925-0526-atg-graph-main6.json').write_text(
    json.dumps({'nodes': [node]}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
c4['objective'] = (
    'G2Q-03D の検出単位 parity を、所有者の判断 G2Q-03D-T（選択 A。'
    'docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03D-parity.md）の判定 A1〜A3 で測り直す。'
    '閾値の方針 A（docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03.md）は main4 と同じ'
)
c4['non_goals'] = [
    g.replace('の許容差の変更を除く）', 'の許容差の変更と、docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03D-parity.md による G2Q-03D の検出単位 parity の判定の変更を除く。後者の再測定の後は判定を変えない）')
    for g in c4['non_goals']
]
assert any('G2Q-03D-parity' in g for g in c4['non_goals'])
c4['deliverables'] = contract['outputs']
(W / '20260925-0526-atg-contract-main6.json').write_text(
    json.dumps(c4, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
