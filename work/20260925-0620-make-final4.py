"""Final4 の graph と契約を、Final3 から review・状態の path だけを替えて作る（work/20260925-0620-Gate2Final3-Plan.md §4）。"""
import json, pathlib
def sub(s):
    return s.replace("work/20260925-0620-Gate2Final3-", "work/20260925-0620-Gate2Final4-").replace("Gate 2 終端化 run 3（", "Gate 2 終端化 run 4（Final3 の失敗の後。")
g = json.loads(sub(pathlib.Path("work/20260925-0620-atg-graph-final3.json").read_text(encoding="utf-8")))
g["nodes"][0]["contract"]["inputs"] = [p.replace("work/20260925-0620-Gate2Final4-Plan.md", "work/20260925-0620-Gate2Final3-Plan.md") for p in g["nodes"][0]["contract"]["inputs"]]
c = json.loads(sub(pathlib.Path("work/20260925-0620-atg-contract-final3.json").read_text(encoding="utf-8")))
c["objective"] = c["objective"].replace("work/20260925-0620-Gate2Final4-Plan.md", "work/20260925-0620-Gate2Final3-Plan.md §4")
for n in g["nodes"]:
    for p in n["contract"].get("inputs", []):
        assert pathlib.Path(p).is_file() or "Review" in p or "RemainTaskExecution" in p, p
pathlib.Path("work/20260925-0620-atg-graph-final4.json").write_text(json.dumps(g, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
pathlib.Path("work/20260925-0620-atg-contract-final4.json").write_text(json.dumps(c, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
