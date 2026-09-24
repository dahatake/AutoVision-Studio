"""Gate 2 主 run の graph と root contract を正本 §7.1・§8 から作る（一時作業用）。"""
import json

V = "work/20260924-0730-Gate2Main-verify.ps1"
RJ = "work/20260924-0710-Gate2-SplitRejudgment.md"
EXTRACT = "work/202609232120-Gate2-RequirementExtract.md"
RULINGS = "docs/model-governance/evidence/2026-09-23-owner-rulings.md"
SIG = "docs/model-governance/siglip-base-patch16-224-adoption.md"
OWL = "docs/model-governance/owlvit-base-patch32-adoption.md"
TPL = "docs/model-governance/adoption-template.md"
AR = "spikes/models/assist-result.md"
MAN = "resources/models/manifest.json"
MT = "scripts/models/manifest-schema.test.mjs"
GS = "vendor/models/_spike/assist"
# 候補 fixture（正本 §8.9 は file を名指ししない。既存の sample を候補と読む実行主体の解釈）
FIX = {"C": ["resources/samples/beans/manifest.json"], "D": ["resources/samples/gwhd-2021/manifest.json", "resources/samples/gwhd-2021/annotations.coco.json"]}
CFG = {"C": "vendor/models/_spike/siglip-goldset.json", "D": "vendor/models/_spike/owlvit-goldset.json"}


def rv(i):
    return f"work/20260924-0730-Gate2Main-{i}-Review.md"


def ruling(i):
    return f"docs/model-governance/evidence/2026-09-24-owner-ruling-{i}.md"


nodes = []


def add(i, deps, dur, writes, inputs, outputs, timeout=1800, attempts=1, review=True):
    outs = list(outputs) + ([rv(i)] if review else [])
    ws = list(writes) + ([rv(i)] if review else [])
    nodes.append({
        "id": i, "deps": deps, "duration": float(dur), "write_set": ws,
        "contract": {
            "inputs": [V] + list(inputs), "outputs": outs,
            "verify_command": f"pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File {V} {i}",
            "timeout_seconds": timeout, "max_attempts": attempts, "allowed_tools": ["editor", "shell"],
        },
    })


def decision(i, deps, extra):
    add(i, deps, 40, [ruling(i)], [EXTRACT, RULINGS] + extra, [ruling(i)])


# 判断（§8.1）
decision("G2D-01", [], [TPL])
add("G2D-01T", ["G2D-01"], 35, [TPL], [TPL, ruling("G2D-01")], [TPL])
decision("G2D-05", ["G2D-01T"], [SIG])
decision("G2D-10", [], [AR])
decision("G2D-11", [], ["CONTRIBUTING.md"])
decision("G2D-02", [], [AR])
add("G2D-02R", ["G2D-02"], 30, [AR], [AR, ruling("G2D-02")], [AR])
decision("G2D-04", ["G2T-40"], ["work/20260924-0730-AssistSessionRecording.md"])
decision("G2D-12", [], ["docs/model-governance/mobilenet-v3-large-imagenet1k-v2-adoption.md"])
add("G2D-12T", ["G2D-12", "G2D-01T"], 40, [TPL], [TPL, ruling("G2D-12"), "docs/model-governance/mobilenet-v3-large-imagenet1k-v2-adoption.md"], [TPL])
decision("G2D-07C", ["G2Q-01C"], ["spikes/models/assist-goldset-plan-classification.md"])
decision("G2D-07D", ["G2Q-01D"], ["spikes/models/assist-goldset-plan-detection.md"])
decision("G2D-06", [], [OWL])
decision("G2D-08", ["G2A-03"], ["CONTRIBUTING.md"])

# 外部前提（§8.5）
add("EXT-41", ["G2D-04"], 40, ["work/20260924-0730-EXT-41-Confirmation.md"], [ruling("G2D-04"), "work/20260924-0730-EXT-41-Plan.md", "work/20260924-0730-EXT-41-ExecutionRecord.md"], ["work/20260924-0730-EXT-41-Confirmation.md"], review=False)
add("EXT-X1", ["G2X-01a", "G2X-01b", "G2X-01c"], 40, ["work/20260924-0730-EXT-X1-Confirmation.md"],
    [f"work/20260924-0730-VitestFailure-{x}.md" for x in "abc"] + ["work/20260924-0730-EXT-X1-Plan.md", "work/20260924-0730-EXT-X1-ExecutionRecord.md"], ["work/20260924-0730-EXT-X1-Confirmation.md"], timeout=3600, review=False)

# 技術（§8.2〜8.8）
add("G2T-10", [], 130, ["spikes/models/classification_checkpoint_parity.py", "spikes/models/classification-checkpoint-result.md", "vendor/models/_spike/c6-cls-transfer.json"],
    ["spikes/models/classification_checkpoint_parity.py", "spikes/models/classification-checkpoint-result.md", "spikes/models/classification.py", "spikes/models/classification-result.md"],
    ["spikes/models/classification_checkpoint_parity.py", "spikes/models/classification-checkpoint-result.md", "vendor/models/_spike/c6-cls-transfer.json"], timeout=3600, attempts=2)
add("G2T-11", [], 160, ["spikes/models/detection_checkpoint_parity.py", "spikes/models/detection-checkpoint-parity-result.md", "vendor/models/_spike/c6-det-transfer.json"],
    [RJ, "spikes/models/detection_checkpoint_parity.py", "spikes/models/detection-checkpoint-parity-result.md", "spikes/models/detection.py", "spikes/models/detection-result.md", "docs/model-governance/ssdlite320-mobilenet-v3-large-coco-v1-adoption.md"],
    ["spikes/models/detection_checkpoint_parity.py", "spikes/models/detection-checkpoint-parity-result.md", "vendor/models/_spike/c6-det-transfer.json"], timeout=3600, attempts=2)
add("G2T-40", [], 140, ["work/20260924-0730-AssistSessionRecording.md"],
    ["src/shared/contracts/annotation.ts", "src/shared/contracts/annotation-ipc.ts", "src/main/annotations/workspace-service.ts", "src/main/annotations/save-draft.ts",
     "src/main/annotations/target-history.ts", "spikes/models/assist_benchmark.py", AR], ["work/20260924-0730-AssistSessionRecording.md"], attempts=2)
for s, rec in (("C", SIG), ("D", OWL)):
    add(f"G2T-60{s}", [], 45, [rec, f"vendor/models/_spike/advisories-{s}.txt"], [rec, "docs/security-vulnerability-policy.md", "docs/dependency-policy.md"],
        [rec, f"vendor/models/_spike/advisories-{s}.txt"], attempts=2)
    api = "siglip-base-patch16-224-hf-api-20260923.json" if s == "C" else "owlvit-base-patch32-hf-api-20260923.json"
    add(f"G2T-50{s}", [f"G2T-60{s}"], 65, [rec], [rec, f"docs/model-governance/evidence/{api}"], [rec], attempts=2)
for x, t in (("a", "src/main/samples/sample-assets.test.ts"), ("b", "src/main/data/reference-source.test.ts"), ("c", "src/main/data/copy-source.test.ts")):
    impl = t.replace(".test.ts", ".ts")
    extra = ["src/main/projects/project-directory.ts"] if x == "c" else []
    add(f"G2X-01{x}", [], 90, [f"work/20260924-0730-VitestFailure-{x}.md"], [RJ, t, impl] + extra, [f"work/20260924-0730-VitestFailure-{x}.md"], timeout=3600, attempts=2)

# 補助品質（§8.9〜8.15）
for s, task in (("C", "classification"), ("D", "detection")):
    plan = f"spikes/models/assist-goldset-plan-{task}.md"
    add(f"G2Q-01{s}", ["G2D-05"], 100, [plan], [EXTRACT, AR, "spikes/models/assist_benchmark.py"] + FIX[s], [plan], attempts=2)
    gs = f"{GS}/goldset-{task}.json"
    # 画像は件数が計画確定まで不明のため directory を write_set に置き、各 file の hash は manifest（出力）で束縛する
    add(f"G2Q-01{s}M", [f"G2D-07{s}"], 100, [f"lock:assist-goldset-{task}", f"{GS}/images-{task}/", gs, f"{gs}.check.txt"], [plan, ruling(f"G2D-07{s}")], [gs, f"{gs}.check.txt"], attempts=2)
add("G2Q-02", ["G2Q-01CM", "G2Q-01DM", "G2D-02R"], 160, ["spikes/models/assist_benchmark.py", AR],
    ["spikes/models/assist_benchmark.py", AR, "spikes/models/assist-goldset-plan-classification.md", "spikes/models/assist-goldset-plan-detection.md"],
    ["spikes/models/assist_benchmark.py", AR], attempts=2)
add("G2Q-03C", ["G2Q-01CM"], 125, ["spikes/models/siglip_assist_parity.py", "spikes/models/siglip-assist-result.md", "vendor/models/_spike/siglip-goldset.json"],
    ["spikes/models/siglip_assist_parity.py", "spikes/models/siglip-assist-result.md", "spikes/models/assist-goldset-plan-classification.md", SIG, f"{GS}/goldset-classification.json"],
    ["spikes/models/siglip_assist_parity.py", "spikes/models/siglip-assist-result.md", "vendor/models/_spike/siglip-goldset.json"], timeout=3600, attempts=2)
add("G2Q-03D", ["G2Q-01DM"], 180, ["spikes/models/owlvit_assist_parity.py", "spikes/models/owlvit-assist-result.md", "vendor/models/_spike/owlvit-goldset.json"],
    ["spikes/models/owlvit_assist_parity.py", "spikes/models/owlvit-assist-result.md", "spikes/models/assist-goldset-plan-detection.md", OWL, f"{GS}/goldset-detection.json"],
    ["spikes/models/owlvit_assist_parity.py", "spikes/models/owlvit-assist-result.md", "vendor/models/_spike/owlvit-goldset.json"], timeout=3600, attempts=2)
for s, task in (("C", "classification"), ("D", "detection")):
    plan = f"spikes/models/assist-goldset-plan-{task}.md"
    m = f"{GS}/manual-{task}.jsonl"
    a = f"{GS}/assisted-{task}.jsonl"
    add(f"G2Q-04{s}", ["EXT-41", "G2D-02R", f"G2Q-01{s}M"], 40, [m, f"{m}.meta.txt"], [plan, "work/20260924-0730-EXT-41-Confirmation.md"], [m, f"{m}.meta.txt"])
    add(f"G2Q-05{s}", [f"G2Q-03{s}", f"G2Q-04{s}"], 40, [a, f"{a}.meta.txt"], [plan, "work/20260924-0730-EXT-41-Confirmation.md", CFG[s]], [a, f"{a}.meta.txt"])
add("G2Q-06C", ["G2T-50C", "G2Q-02", "G2Q-05C"], 65, [AR, SIG, f"{GS}/benchmark-classification.json"],
    [AR, SIG, "spikes/models/assist-goldset-plan-classification.md", f"{GS}/assisted-classification.jsonl.meta.txt", f"{GS}/assisted-classification.jsonl", f"{GS}/manual-classification.jsonl", f"{GS}/goldset-classification.json"], [AR, SIG, f"{GS}/benchmark-classification.json"], attempts=2)
add("G2Q-06D", ["G2T-50D", "G2Q-02", "G2Q-05D", "G2Q-06C"], 65, [AR, OWL, f"{GS}/benchmark-detection.json"],
    [AR, OWL, "spikes/models/assist-goldset-plan-detection.md", f"{GS}/assisted-detection.jsonl.meta.txt", f"{GS}/assisted-detection.jsonl", f"{GS}/manual-detection.jsonl", f"{GS}/goldset-detection.json"], [AR, OWL, f"{GS}/benchmark-detection.json"], attempts=2)

# 採用・版（§8.16〜8.19）
RA = "docs/model-governance/evidence/2026-09-23-owner-risk-acceptance-c7-detection.md"
add("G2A-01", ["G2Q-06C", "G2D-12T"], 100, [SIG], [SIG, TPL, ruling("G2D-01"), "spikes/models/siglip-assist-result.md", AR], [SIG])
add("G2A-02", ["G2Q-06D", "G2D-12T", "G2D-06"], 100, [OWL], [OWL, TPL, RA, ruling("G2D-06"), "spikes/models/owlvit-assist-result.md", AR], [OWL])
add("G2A-03", ["G2A-01", "G2A-02"], 100, ["lock:model-manifest", MAN, MT], [RJ, SIG, OWL, MAN, MT], [MAN, MT], attempts=2)
add("G2A-04", ["G2A-03"], 110, ["src/renderer/features/settings/SettingsPage.tsx", "src/renderer/features/settings/SettingsPage.test.tsx", "resources/licenses/owlvit-base-patch32.NOTICE.txt"],
    [RJ, "src/renderer/features/settings/SettingsPage.tsx", "src/renderer/features/settings/SettingsPage.test.tsx", OWL, MAN],
    ["src/renderer/features/settings/SettingsPage.tsx", "src/renderer/features/settings/SettingsPage.test.tsx", "resources/licenses/owlvit-base-patch32.NOTICE.txt"], attempts=2)
add("G2V-01", ["G2D-08", "G2D-11", "G2D-10", "EXT-X1"], 100, ["lock:root-version", "lock:model-manifest", "package.json", "package-lock.json", MAN, "work/20260924-0730-G2V-01-tags-before.txt"],
    ["CONTRIBUTING.md", "package.json", MAN, ruling("G2D-08")], ["package.json", "package-lock.json", MAN, "work/20260924-0730-G2V-01-tags-before.txt"], timeout=3600)

LOCKS = {AR: "lock:assist-result", SIG: "lock:siglip-record", OWL: "lock:owlvit-record", MAN: "lock:model-manifest", TPL: "lock:adoption-template"}
for n in nodes:
    used = set(n["contract"]["inputs"]) | set(n["contract"]["outputs"])
    for path, key in LOCKS.items():
        if path in used and key not in n["write_set"]:
            n["write_set"].append(key)

graph = {"nodes": nodes}
json.dump(graph, open("work/202609232120-atg-graph-main.json", "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=2)

contract = {
    "objective": "Gate 2 主 run（正本 work/202609232120-RemainTaskExecutionPlan.md §7.1・§8、分割判定は work/20260924-0710-Gate2-SplitRejudgment.md）を、所有者の判断・利用者の session を生成せずに静止まで進める",
    "non_goals": [
        "所有者の判断・利用者の session・gold label を生成・推定しない",
        "parity・性能・品質の基準を測定後に変えない",
        "未承認 model を manifest に登録しない",
        "正本とノード一覧を変更しない",
    ],
    "deliverables": sorted({o for n in nodes for o in n["contract"]["outputs"]}),
    "acceptance_command": "pwsh -NoLogo -NoProfile -Command \"$env:PATH = $env:LOCALAPPDATA + '\\npm-12.0.0;' + $env:PATH; if ((npm --version) -ne '12.0.0') { exit 2 }; npm run verify:docs; if ($LASTEXITCODE) { exit $LASTEXITCODE }; node --test scripts/models/manifest-schema.test.mjs; exit $LASTEXITCODE\"",
    "baseline_policy": "既存の失敗は許容するが、新しい失敗を増やさない",
    "time_budget": "3540m",
    "execution_envelope": {
        "code_changes": "allowed_within_write_set",
        "dependency_additions": "declared_only",
        "external_network_writes": "deny",
        "production_deploy": "deny",
        "secret_read": "declared_refs_only",
    },
    "secret_policy": "秘密値は契約・引継ぎ・ログ・成果物へ保存せず、必要時は参照名のみを記録する",
}
json.dump(contract, open("work/202609232120-atg-contract-main.json", "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=2)
print(len(nodes))
