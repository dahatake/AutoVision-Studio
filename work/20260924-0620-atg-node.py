"""ATG の 1 node を begin（node start と作業前の状態の保存）→ 作業 → end（書込み検査 → verify → handoff → finish）で進める補助（一時作業用）。

使い方:
  python work/20260924-0620-atg-node.py begin <graph> <state> <execution_id> <node_id>
  python work/20260924-0620-atg-node.py end <graph> <state> <execution_id> <node_id> <contract> <handoff_out> "<decision>" <ref1,ref2,...>

begin: node start を呼び、返った attempt と `git status --porcelain=v1 -uall` の全 path の内容の SHA-256 を <state>.<node_id>.pre.json に保存する。
end:   新しく出た path と内容が変わった path のうち write set の外のものがあれば node fail --class contract（exit 3）。
       verify が失敗したら node fail --class implementation --max-attempts <graph の値>（exit 4）。
       contract check の失敗、inputs/outputs の欠落は node fail --class contract（exit 3）。
       成功したら handoff を作って node finish する。
handoff の path は repository root 基準（ATG は handoff file の親 dir を基準にする: tools/atg/vendor/atg/cli.py の cmd_node_finish）。
このため node finish には repository root に置いた file を渡す。<handoff_out> へは node finish の前に copy し、finish 後に root の file を消す。
保存した handoff を再び node finish に渡すときは、repository root へ copy してから渡す。
"""
import hashlib, json, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = dict(os.environ, PYTHONPATH=os.path.join(ROOT, "tools", "atg", "vendor"))
ATG = [sys.executable, "-m", "atg"]


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def snapshot():
    out = subprocess.run(["git", "status", "--porcelain=v1", "-uall", "-z"], capture_output=True, check=True).stdout.decode("utf-8")
    parts = out.split("\0")
    paths, i = [], 0
    while i < len(parts):
        e = parts[i]
        i += 1
        if not e:
            continue
        paths.append(e[3:])
        if e[0] in "RC":
            paths.append(parts[i])
            i += 1
    return {p: (sha(p) if os.path.isfile(p) else None) for p in paths}


def covers(path, write_set):
    return any(path == r.rstrip("/") or path.startswith(r.rstrip("/") + "/") for r in write_set)


def atg(*args):
    r = subprocess.run(ATG + list(args), env=ENV, capture_output=True, text=True)
    sys.stdout.write(r.stdout)
    sys.stderr.write(r.stderr)
    return r


def fail(exe, state, node_id, cls, max_attempts, code):
    r = atg("node", "fail", "--class", cls, "--max-attempts", str(max_attempts), "--execution-id", exe, "--state", state, node_id)
    sys.exit(code if r.returncode == 0 else f"node fail exit={r.returncode}")


cmd, graph_p, state, exe, node_id = sys.argv[1:6]
graph = json.load(open(graph_p, encoding="utf-8"))
node = next(n for n in graph["nodes"] if n["id"] == node_id)
pre_p = f"{state}.{node_id}.pre.json"

if cmd == "begin":
    paths = snapshot()
    r = atg("node", "start", "--execution-id", exe, "--state", state, node_id)
    if r.returncode:
        sys.exit(r.returncode)
    try:
        attempt = json.loads(r.stdout)["attempt"]
        json.dump({"attempt": attempt, "paths": paths}, open(pre_p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    except Exception as e:
        print(f"begin error: {e!r}")
        fail(exe, state, node_id, "implementation", node["contract"]["max_attempts"], 4)
    sys.exit(0)

if cmd != "end":
    sys.exit(f"unknown command: {cmd}")

contract_p, out, decision, refs = sys.argv[6:10]
max_attempts = node["contract"]["max_attempts"]
try:
    pre = json.load(open(pre_p, encoding="utf-8"))
    post = snapshot()
except Exception as e:
    print(f"end error: {e!r}")
    fail(exe, state, node_id, "implementation", max_attempts, 4)
changed = sorted(p for p in set(pre["paths"]) | set(post) if pre["paths"].get(p, "absent") != post.get(p, "absent"))
violations = [p for p in changed if not covers(p, node["write_set"])]
print(json.dumps({"changed": changed, "violations": violations}, ensure_ascii=False))
if violations:
    fail(exe, state, node_id, "contract", max_attempts, 3)

v = subprocess.run(node["contract"]["verify_command"], shell=True)
print(f"verify exit={v.returncode}")
if v.returncode:
    fail(exe, state, node_id, "implementation", max_attempts, 4)

c = atg("contract", "check", contract_p)
if c.returncode:
    fail(exe, state, node_id, "contract", max_attempts, 3)
csha = json.loads(c.stdout)["sha256"]
missing = [p for p in node["contract"]["inputs"] + node["contract"]["outputs"] if not os.path.isfile(p)]
if missing:
    print(json.dumps({"missing": missing}, ensure_ascii=False))
    fail(exe, state, node_id, "contract", max_attempts, 3)
handoff = {
    "schema_version": 1, "execution_id": exe, "node_id": node_id, "attempt": pre["attempt"], "root_contract_sha256": csha,
    "input_artifacts": [{"path": p, "sha256": sha(p)} for p in node["contract"]["inputs"]],
    "decisions": [{"id": "D-001", "statement": decision, "source_refs": refs.split(",")}],
    "outputs": [{"path": p, "sha256": sha(p)} for p in node["contract"]["outputs"]],
    "verification": {"command": node["contract"]["verify_command"], "exit_code": 0, "evidence_path": node["contract"]["outputs"][0]},
    "risks": [], "blocked_reasons": [],
    "next_nodes": [n["id"] for n in graph["nodes"] if node_id in n["deps"]],
}
tmp = os.path.basename(out)
json.dump(handoff, open(tmp, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=2)
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
shutil.copyfile(tmp, out)
f = atg("node", "finish", "--handoff", tmp, "--execution-id", exe, "--state", state, node_id)
os.remove(tmp)
if f.returncode:
    fail(exe, state, node_id, "contract", max_attempts, f.returncode)
sys.exit(0)
