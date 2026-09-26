"""Gate 2 main4 の graph・contract・verify を main3 から作る（計画 work/20260925-0420-G2Q03-ExecutionPlan.md §2 G）。"""
import json
from pathlib import Path

W = Path('work')
g3 = json.loads((W / '20260924-2230-atg-graph-main3.json').read_text(encoding='utf-8'))
c3 = json.loads((W / '20260924-2230-atg-contract-main3.json').read_text(encoding='utf-8'))
VERIFY = 'work/20260925-0420-Gate2Main4-verify.ps1'
RULING = 'docs/model-governance/evidence/2026-09-25-owner-ruling-G2Q-03.md'
PLAN = 'work/20260925-0420-G2Q03-ExecutionPlan.md'

nodes = []
for n in g3['nodes']:
    if n['id'] not in ('G2Q-03C', 'G2Q-03D'):
        continue
    n = json.loads(json.dumps(n, ensure_ascii=False)
                   .replace('work/20260924-2230-Gate2Main3-verify.ps1', VERIFY)
                   .replace('work/20260924-2230-Gate2Main3-', 'work/20260925-0420-Gate2Main4-'))
    n['deps'] = []  # G2Q-01CM / 01DM は main3 で succeeded（work/20260924-2230-Gate2Main3-Acceptance.md）
    n['contract']['inputs'] += [PLAN, RULING, 'work/20260925-0420-check-selection.py']
    nodes.append(n)

(W / '20260925-0420-atg-graph-main4.json').write_text(
    json.dumps({'nodes': nodes}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

contract = dict(c3)
contract['objective'] = (
    'G2Q-03C / 03D（gold set からの閾値・閾値方針・prompt 形式・seed の決定）を、所有者の判断 '
    f'{RULING}（方針 A、定義は {PLAN} §1）に基づいて新しい実行 ID で実行する'
)
contract['deliverables'] = [p for n in nodes for p in n['contract']['outputs']]
(W / '20260925-0420-atg-contract-main4.json').write_text(
    json.dumps(contract, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

v = (W / '20260924-2230-Gate2Main3-verify.ps1').read_text(encoding='utf-8')
rest = v.split('\n', 3)[3]
v = ('# Gate 2 main4（work/20260925-0420-G2Q03-ExecutionPlan.md §2 G）の各ノードの verify_command。\n'
     '# work/20260924-2230-Gate2Main3-verify.ps1 の複製で、差分は Review の path と、G2Q-03C / 03D の Selection（計画 §2 G）だけ。\n'
     '# 使い方: pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File work/20260925-0420-Gate2Main4-verify.ps1 <node ID>\n'
     + rest.replace('work\\20260924-2230-Gate2Main3-$id-Review.md', 'work\\20260925-0420-Gate2Main4-$id-Review.md')
     .replace("function IsPass(", "function Selection([string]$out) { & $PY work\\20260925-0420-check-selection.py $out; if ($LASTEXITCODE) { Fail $LASTEXITCODE } }\nfunction IsPass(", 1)
     .replace("IsPass $o; Ruff 'spikes\\models\\siglip", "IsPass $o; Selection $o; Ruff 'spikes\\models\\siglip")
     .replace("IsPass $o; Ruff 'spikes\\models\\owlvit", "IsPass $o; Selection $o; Ruff 'spikes\\models\\owlvit"))
assert v.count('Selection $o') == 2
(W / '20260925-0420-Gate2Main4-verify.ps1').write_text(v, encoding='utf-8', newline='')
print(len(nodes))
