"""Gate 2 終端化 run 3 の graph と契約を、1815 の終端化 run（Gate2Final2）から path を替えて作る（work/20260925-0620-Gate2Final3-Plan.md）。"""
import json, pathlib
R = [
 ("work/20260924-1815-Gate2-TerminalState-check.ps1", "work/20260925-0620-Gate2-TerminalState-check.ps1"),
 ("work/20260924-1815-Gate2-TerminalState.md", "work/20260925-0620-Gate2-TerminalState.md"),
 ("work/20260924-1815-Gate2-AtgReport.md", "work/20260925-0620-Gate2-AtgReport.md"),
 ("work/20260924-1815-Gate2-RemainTaskExecution.md", "work/20260925-0620-Gate2-RemainTaskExecution.md"),
 ("work/20260924-1815-Gate2Final2-", "work/20260925-0620-Gate2Final3-"),
]
def sub(s):
    for a, b in R:
        s = s.replace(a, b)
    return s
g = json.loads(sub(pathlib.Path("work/20260924-1815-Gate2Final2-atg-graph.json").read_text(encoding="utf-8")))
reports = ["work/20260924-1815-Gate2-AtgReport.md", "work/20260924-2230-Gate2Main3-Report.md", "work/20260925-0420-Gate2Main4-Report.md", "work/20260925-0420-Gate2Main5-Report.md", "work/20260925-0526-Gate2Main6-Report.md"]
graphs = ["work/20260924-1815-atg-graph-main2.json", "work/20260924-2230-atg-graph-main3.json", "work/20260925-0420-atg-graph-main4.json", "work/20260925-0420-atg-graph-main5.json", "work/20260925-0526-atg-graph-main6.json"]
n0 = g["nodes"][0]
assert n0["id"] == "G2F-00"
n0["contract"]["inputs"] = ["work/202609232120-Gate2-NodeInventory.md", "work/20260925-0620-Gate2Final3-Plan.md", "work/20260925-0620-Gate2-TerminalState-check.ps1"] + graphs + reports
c = json.loads(sub(pathlib.Path("work/20260924-1815-Gate2Final2-atg-contract.json").read_text(encoding="utf-8")))
c["objective"] = "Gate 2 終端化 run 3（main2〜main6 の後。work/20260925-0620-Gate2Final3-Plan.md）として、現在の Gate 2 の BLOCKED を記録する"
for p in graphs + reports + ["work/20260925-0620-Gate2Final3-Plan.md", "work/20260925-0620-Gate2-TerminalState-check.ps1"]:
    assert pathlib.Path(p).is_file(), p
pathlib.Path("work/20260925-0620-atg-graph-final3.json").write_text(json.dumps(g, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
pathlib.Path("work/20260925-0620-atg-contract-final3.json").write_text(json.dumps(c, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
