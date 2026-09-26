"""Gate 2 main7（work/20260925-0745-Gate2Main7-Plan.md §4）の graph・契約を main3 の node 定義から作る。

変更点: 比較試験の node（G2Q-04〜06）を所有者の判断
docs/model-governance/evidence/2026-09-25-owner-ruling-assist-trial-deferral.md により外し、
G2A-01 / 02 の依存から除く。両者が共有しない lock（assist-result・adoption-template）を外して並列にする。
OWL-ViT は同判断の「既存の書面決定との関係」により保留とするため、G2A-03 は G2A-01 だけに依存させ、
OWL-ViT を承認した場合だけの G2A-04（計画 §8.18）を含めない。
"""
import json
from pathlib import Path

W = Path('work')
g3 = json.loads((W / '20260924-2230-atg-graph-main3.json').read_text(encoding='utf-8'))
c6 = json.loads((W / '20260925-0526-atg-contract-main6.json').read_text(encoding='utf-8'))
OLD, NEW = 'work/20260924-2230-Gate2Main3-', 'work/20260925-0745-Gate2Main7-'
RULING = 'docs/model-governance/evidence/2026-09-25-owner-ruling-assist-trial-deferral.md'
G2D08_OLD = 'docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-08.md'
G2D08_NEW = 'docs/model-governance/evidence/2026-09-25-owner-ruling-G2D-08.md'
DROP = {'lock:assist-result', 'lock:adoption-template'}


def fix(p):
    return p.replace(OLD, NEW).replace(G2D08_OLD, G2D08_NEW)


nodes = []
for n in g3['nodes']:
    if n['id'] not in ('G2A-01', 'G2A-02', 'G2A-03', 'G2D-08'):
        continue
    n['deps'] = [d for d in n['deps'] if d.startswith('G2A-') and d != 'G2A-02']
    n['write_set'] = [
        fix(p) for p in n['write_set']
        if p not in DROP and not (n['id'] == 'G2A-03' and p == 'lock:owlvit-record')
    ]
    c = n['contract']
    c['inputs'] = [fix(p) for p in c['inputs'] if p != 'spikes/models/assist-result.md'] + [
        RULING, 'work/20260925-0745-Gate2Main7-Plan.md']
    c['outputs'] = [fix(p) for p in c['outputs']]
    c['verify_command'] = fix(c['verify_command'])
    nodes.append(n)
assert [n['id'] for n in nodes] == ['G2A-01', 'G2A-02', 'G2A-03', 'G2D-08'], [n['id'] for n in nodes]
(W / '20260925-0745-atg-graph-main7.json').write_text(
    json.dumps({'nodes': nodes}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
c6['objective'] = (
    'Gate 2 の C7 採用の審査（G2A-01 / 02）、承認した C7 の manifest entry（G2A-03）、製品版の決定（G2D-08）を、'
    '所有者の判断 ' + RULING + '（比較試験を Gate 2 から外す）に従って行う。OWL-ViT は同判断により保留とする'
)
c6['non_goals'] = [
    '所有者の判断・利用者の session・gold label を生成・推定しない',
    '比較試験（NFR-ANN-006）を実施・合格扱いにしない。releaseStatus.ready を true にしない',
    'parity・性能・品質の基準を変えない',
    '製品版を package.json・manifest に書き込まない（G2V-01 は対象外）',
    '正本とノード一覧を変更しない',
]
c6['deliverables'] = sorted({p for n in nodes for p in n['contract']['outputs']})
(W / '20260925-0745-atg-contract-main7.json').write_text(
    json.dumps(c6, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
