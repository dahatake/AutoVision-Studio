"""Gate 2 main10 (G2V-01 and the terminalization) and the TBD-09 run: contracts from the main9 contract."""
import json
from pathlib import Path

W = Path('work')
V = 'work/20260926-1100-Gate2Main10-verify.ps1'
PLAN = 'work/20260926-0955-OwnerRulings6-ExecutionPlan.md'
REVIEW = 'work/20260926-1100-Gate2Final-Review.md'


def node(nid, deps, write_set, inputs, outputs, duration):
    return {'id': nid, 'deps': deps, 'duration': duration, 'write_set': write_set + [REVIEW],
            'contract': {'inputs': [V, PLAN, *inputs], 'outputs': outputs + [REVIEW],
                         'verify_command': f'pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File {V} {nid}',
                         'timeout_seconds': 1800, 'max_attempts': 1, 'allowed_tools': ['editor', 'shell']}}


nodes = [
    node('G2V-01', [], ['package.json', 'package-lock.json', 'lock:root-version'],
         ['CONTRIBUTING.md', 'docs/model-governance/evidence/2026-09-25-owner-ruling-G2D-08.md', 'work/20260924-1815-GAL-V1-VersionDecision.md'],
         ['package.json', 'package-lock.json'], 100.0),
    node('G2F-00', ['G2V-01'], ['work/20260926-1100-Gate2-TerminalState.md', 'work/20260926-1100-Gate2-AtgReport.md'],
         ['work/202609232120-Gate2-NodeInventory.md', 'work/20260926-1100-merge-atg-report.py'],
         ['work/20260926-1100-Gate2-TerminalState.md', 'work/20260926-1100-Gate2-AtgReport.md'], 45.0),
    node('G2F-01m', ['G2F-00'], ['resources/models/manifest.json', 'scripts/models/manifest-schema.test.mjs', 'lock:model-manifest'],
         ['work/20260926-1100-Gate2-TerminalState.md'], ['resources/models/manifest.json', 'scripts/models/manifest-schema.test.mjs'], 100.0),
    node('G2F-01a1', ['G2F-01m'], ['docs/adr/0004-spike-decisions.md'], ['resources/models/manifest.json'], ['docs/adr/0004-spike-decisions.md'], 60.0),
    node('G2F-01a2', ['G2F-01a1'], ['docs/implementation-plan.md'], ['resources/models/manifest.json'], ['docs/implementation-plan.md'], 40.0),
    node('G2F-01a3', ['G2F-01a2'], ['work/20260926-1100-Gate2-RemainTaskExecution.md'], ['resources/models/manifest.json'],
         ['work/20260926-1100-Gate2-RemainTaskExecution.md'], 70.0),
    node('G2F-03', ['G2F-01a3'], ['CHANGELOG.md'], ['work/20260926-1100-Gate2-RemainTaskExecution.md'], ['CHANGELOG.md'], 55.0),
]
(W / '20260926-1100-atg-graph-main10.json').write_text(json.dumps({'nodes': nodes}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
c = json.loads((W / '20260926-0815-atg-contract-main9.json').read_text(encoding='utf-8'))
c['objective'] = 'G2V-01（製品版 0.1.12）と Gate 2 の終端化（G2F-00・01m・01a1〜01a3・03）を記録する（所有者の回答 2026-09-26 09:53、docs/model-governance/evidence/2026-09-26-owner-rulings-0953.md）'
c['non_goals'] = ['所有者の判断・利用者の session を生成・推定しない', '比較試験を合格扱いにしない。releaseStatus.assistQuality に値を入れない',
                  'test の上限の延長・skip・assert の緩和をしない', 'git tag を作らない。PKG-01 の照合の前に ready=true の manifest を出荷物へ使わない']
c['deliverables'] = sorted({p for n in nodes for p in n['contract']['outputs']})
c['acceptance_command'] = ("pwsh -NoLogo -NoProfile -Command \"$env:PATH = $env:LOCALAPPDATA + '\\npm-12.0.0;' + $env:PATH; "
                           "if ((npm --version) -ne '12.0.0') { exit 2 }; npm run verify:docs; if ($LASTEXITCODE) { exit $LASTEXITCODE }; "
                           "npm run verify:version; if ($LASTEXITCODE) { exit $LASTEXITCODE }; "
                           "node --test scripts/models/manifest-schema.test.mjs; exit $LASTEXITCODE\"")
(W / '20260926-1100-atg-contract-main10.json').write_text(json.dumps(c, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
t = dict(c)
t['objective'] = 'TBD-09（manifest の許諾 field 名の改名、schema 3.0.0）の T9-S〜T9-V を記録する（所有者の回答 2026-09-26 09:53）'
t['deliverables'] = sorted({p for n in json.loads((W / '20260924-1341-TBD09-atg-graph.json').read_text(encoding='utf-8'))['nodes'] for p in n['contract']['outputs']})
t['non_goals'] = ['field の意味と値を変えない', 'evidence を変えない', '互換の alias・変換 script を作らない']
(W / '20260926-1100-atg-contract-tbd09.json').write_text(json.dumps(t, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print('ok')
