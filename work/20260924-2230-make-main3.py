"""Gate 2 main3 の graph・contract・verify を main2 から作る（計画 work/20260924-2230-UserRulings3-ExecutionPlan.md §2 G）。"""
import json
import re
from pathlib import Path

W = Path('work')
g2 = json.loads((W / '20260924-1815-atg-graph-main2.json').read_text(encoding='utf-8'))
c2 = json.loads((W / '20260924-1815-atg-contract-main2.json').read_text(encoding='utf-8'))
nodes2 = {n['id']: n for n in g2['nodes']}

# main2 で終端しなかった（failed / blocked の）ノードだけ。main2 で成功したノードへの依存は外す
# （出典: work/20260924-1815-Gate2Final2-Acceptance.md）。
keep = ['EXT-X1', 'G2D-07C', 'G2D-07D', 'G2Q-01CM', 'G2Q-01DM', 'G2Q-02', 'G2Q-03C', 'G2Q-03D',
        'G2Q-04C', 'G2Q-04D', 'G2Q-05C', 'G2Q-05D', 'G2Q-06C', 'G2Q-06D',
        'G2A-01', 'G2A-02', 'G2A-03', 'G2A-04', 'G2D-08', 'G2V-01']
fixes = {
    'EXT-X1-F1': 'src/main/data/import-files.test.ts',
    'EXT-X1-F2': 'src/main/data/reference-source.test.ts',
    'EXT-X1-F3': 'src/main/ipc/import-handlers.test.ts',
}
VERIFY = 'work/20260924-2230-Gate2Main3-verify.ps1'


def rename(value):
    return value.replace('work/20260924-1815-Gate2Main2-', 'work/20260924-2230-Gate2Main3-') \
        .replace('work/20260924-1815-Gate2Main2-verify.ps1', VERIFY)


nodes = []
for fid, path in fixes.items():
    review = f'work/20260924-2230-Gate2Main3-{fid}-Review.md'
    nodes.append({
        'id': fid, 'deps': [], 'duration': 30.0, 'write_set': [path, review],
        'contract': {
            'inputs': [VERIFY, 'work/20260924-0730-EXT-X1-Plan.md', 'work/20260924-2230-EXT-X1-RootCause.md', path],
            'outputs': [path, review],
            'verify_command': f'pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File {VERIFY} {fid}',
            'timeout_seconds': 1800, 'max_attempts': 2, 'allowed_tools': ['editor', 'shell'],
        },
    })
for nid in keep:
    n = json.loads(rename(json.dumps(nodes2[nid], ensure_ascii=False)))
    n['deps'] = [d for d in n['deps'] if d in keep]
    if nid == 'EXT-X1':
        n['deps'] = list(fixes)
        n['write_set'] = ['work/20260924-0730-EXT-X1-Confirmation.md', 'work/20260924-2230-Gate2Main3-EXT-X1-Review.md']
        n['contract']['inputs'] += ['work/20260924-2230-EXT-X1-RootCause.md']
        n['contract']['outputs'] = list(n['write_set'])
    nodes.append(n)

graph = {'nodes': nodes}
(W / '20260924-2230-atg-graph-main3.json').write_text(json.dumps(graph, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

contract = dict(c2)
contract['objective'] = (
    'Gate 2 主 run の残り（main2 で終端しなかったノード）を、2026-09-24 22 時の所有者の回答'
    '（work/20260924-2230-UserRulings3-ExecutionPlan.md §1）に基づいて新しい実行 ID で実行し、'
    '所有者の判断・利用者の session を生成せずに静止まで進める'
)
contract['deliverables'] = [p for n in nodes for p in n['contract']['outputs']]
(W / '20260924-2230-atg-contract-main3.json').write_text(json.dumps(contract, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

v = (W / '20260924-1815-Gate2Main2-verify.ps1').read_text(encoding='utf-8')
v = v.replace('work\\20260924-1815-Gate2Main2-$id-Review.md', 'work\\20260924-2230-Gate2Main3-$id-Review.md')
v = re.sub(r'\A# .*\n# .*\n# .*\n',
           '# Gate 2 主 run の残り（main3、work/20260924-2230-UserRulings3-ExecutionPlan.md §2 G）の各ノードの verify_command。\n'
           '# work/20260924-1815-Gate2Main2-verify.ps1 の複製で、差分は Review の path と、EXT-X1 の修正ノード（EXT-X1-F1〜F3）の追加だけ。\n'
           '# 使い方: pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File work/20260924-2230-Gate2Main3-verify.ps1 <node ID>\n', v)
fix_cases = ''.join(
    f"  '{fid}' {{ Npm12; & .\\node_modules\\.bin\\vitest.cmd run {path}; if ($LASTEXITCODE) {{ Fail $LASTEXITCODE }}; Review '{fid}' }}\n"
    for fid, path in fixes.items())
v = v.replace("  'EXT-X1' { Confirmed 'EXT-X1'; Vitest3 }\n", fix_cases + "  'EXT-X1' { Confirmed 'EXT-X1'; Vitest3; Review 'EXT-X1' }\n")
(W / '20260924-2230-Gate2Main3-verify.ps1').write_text(v, encoding='utf-8', newline='')
print(len(nodes))
