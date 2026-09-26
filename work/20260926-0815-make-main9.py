"""Gate 2 main9: 所有者の回答（2026-09-26 07:48）の適用を記録する graph・契約を作る。

計画: work/20260926-0815-OwnerRulings5-ExecutionPlan.md。
- 比較試験の node（G2Q-04C / 04D / 05C / 05D / 06C / 06D）は実施せず、免除の記録を確認する node とする
  （Gate 2 計画 §8.14 の注記 2026-09-26）。
- G2A-02（OWL-ViT の承認）・G2A-03（OWL-ViT の manifest entry）・G2A-04（研究目的に限る表示）。
- G2V-01 は含めない（集約 npm test が通らず、GAL-V1 の 0.1.11 が未適用のため。計画 R-7）。
各 node の編集は node の begin の前に済ませている（完了条件の verify と敵対的レビューで確認する）。
"""
import json
from pathlib import Path

W = Path('work')
VERIFY = 'work/20260926-0815-Gate2Main9-verify.ps1'
PLAN = 'work/20260926-0815-OwnerRulings5-ExecutionPlan.md'
RULING = 'docs/model-governance/evidence/2026-09-26-owner-rulings.md'


def node(nid, deps, write_set, inputs, outputs, duration=20.0):
    return {
        'id': nid, 'deps': deps, 'duration': duration, 'write_set': write_set,
        'contract': {
            'inputs': [VERIFY, PLAN, RULING, *inputs], 'outputs': outputs,
            'verify_command': f'pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File {VERIFY} {nid}',
            'timeout_seconds': 1800, 'max_attempts': 1, 'allowed_tools': ['editor', 'shell'],
        },
    }


nodes = []
for nid in ['G2Q-04C', 'G2Q-04D', 'G2Q-05C', 'G2Q-05D', 'G2Q-06C', 'G2Q-06D']:
    nodes.append(node(nid, [], ['lock:trial-waiver', 'work/20260926-0815-Q1-Review.md'],
                      ['docs/model-governance/siglip-base-patch16-224-adoption.md',
                       'docs/model-governance/owlvit-base-patch32-adoption.md', 'resources/models/manifest.json'],
                      ['work/20260926-0815-Q1-Review.md'], 10.0))
nodes.append(node('G2A-02', [], ['docs/model-governance/owlvit-base-patch32-adoption.md', 'work/20260926-0815-A2-Review.md', 'lock:owlvit-record'],
                  ['docs/model-governance/adoption-template.md', 'docs/model-governance/evidence/2026-09-23-owner-risk-acceptance-c7-detection.md',
                   'docs/model-governance/evidence/2026-09-24-owner-ruling-G2D-06.md', 'spikes/models/owlvit-assist-result.md'],
                  ['docs/model-governance/owlvit-base-patch32-adoption.md', 'work/20260926-0815-A2-Review.md'], 100.0))
nodes.append(node('G2A-03', ['G2A-02'], ['lock:model-manifest', 'resources/models/manifest.json', 'scripts/models/manifest-schema.test.mjs', 'work/20260926-0815-A3-Review.md', 'lock:owlvit-record'],
                  ['docs/model-governance/owlvit-base-patch32-adoption.md'],
                  ['resources/models/manifest.json', 'scripts/models/manifest-schema.test.mjs', 'work/20260926-0815-A3-Review.md'], 100.0))
nodes.append(node('G2A-04', ['G2A-02'], ['src/renderer/features/settings/SettingsPage.tsx', 'src/renderer/features/settings/SettingsPage.test.tsx',
                                        'resources/licenses/owlvit-base-patch32.NOTICE.txt', 'work/20260926-0815-A4-Review.md', 'lock:owlvit-record'],
                  ['docs/model-governance/owlvit-base-patch32-adoption.md', 'resources/models/manifest.json'],
                  ['src/renderer/features/settings/SettingsPage.tsx', 'src/renderer/features/settings/SettingsPage.test.tsx',
                   'resources/licenses/owlvit-base-patch32.NOTICE.txt', 'work/20260926-0815-A4-Review.md'], 110.0))
(W / '20260926-0815-atg-graph-main9.json').write_text(json.dumps({'nodes': nodes}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

c = json.loads((W / '20260925-0745-atg-contract-main8.json').read_text(encoding='utf-8'))
c['objective'] = ('所有者の回答（2026-09-26 07:48、docs/model-governance/evidence/2026-09-26-owner-rulings.md）を Gate 2 に適用し記録する: '
                  '比較試験の node を免除（未実施のまま完了扱い）の記録で閉じ、OWL-ViT の採用記録の承認・manifest entry・研究目的に限る表示を行う')
c['non_goals'] = [
    '所有者の判断・利用者の session・gold label を生成・推定しない',
    '比較試験を実施・合格扱いにしない。releaseStatus.assistQuality に値を入れない。releaseStatus.ready を true にしない',
    'parity・性能の基準を変えない',
    '製品版を package.json・manifest に書き込まない（G2V-01 は対象外）',
]
c['deliverables'] = sorted({p for n in nodes for p in n['contract']['outputs']})
c['acceptance_command'] = ("pwsh -NoLogo -NoProfile -Command \"$env:PATH = $env:LOCALAPPDATA + '\\npm-12.0.0;' + $env:PATH; "
                           "if ((npm --version) -ne '12.0.0') { exit 2 }; npm run verify:docs; if ($LASTEXITCODE) { exit $LASTEXITCODE }; "
                           "node --test scripts/models/manifest-schema.test.mjs; if ($LASTEXITCODE) { exit $LASTEXITCODE }; "
                           "& .\\node_modules\\.bin\\vitest.cmd run src/renderer/features/settings/SettingsPage.test.tsx; exit $LASTEXITCODE\"")
(W / '20260926-0815-atg-contract-main9.json').write_text(json.dumps(c, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(len(nodes))
